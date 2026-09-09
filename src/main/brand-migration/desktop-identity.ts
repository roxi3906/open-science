import type * as Native from '@aipoch/brand-migration-native'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

type Phase = 'prepared' | 'key-ready' | 'profile-ready' | 'complete'
type FileIdentity = { device: string; inode: string }
type PendingRecord = {
  version: 1
  phase: Exclude<Phase, 'complete'>
  name: string
  source: string
  target: string
  sourceIdentity?: FileIdentity
}
type CompleteRecord = { version: 1; phase: 'complete'; name: string; target: string }
type MigrationRecord = PendingRecord | CompleteRecord

export type DesktopIdentityMigrationOptions = {
  stateDirectory: string
  previousProfile: string
  currentProfile: string
  currentName: string
  hasLegacySettings: boolean
  migrateKey: () => void
  native: Pick<typeof Native, 'acquireMigrationLock' | 'renameDirectoryNoReplace'>
  afterProfileMove?: () => void
  onProgress?: (phase: Phase) => void
}

const directoryIdentity = (path: string): FileIdentity | undefined => {
  try {
    const stat = lstatSync(path, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('The desktop profile is not a direct directory.')
    }
    return { device: String(stat.dev), inode: String(stat.ino) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const sameIdentity = (left: FileIdentity | undefined, right: FileIdentity): boolean =>
  left?.device === right.device && left.inode === right.inode

const readRecord = (
  path: string,
  options: DesktopIdentityMigrationOptions
): MigrationRecord | undefined => {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 1_048_576 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('Invalid desktop migration journal.')
    const record = JSON.parse(readFileSync(fd, 'utf8')) as MigrationRecord
    if (
      record.version !== 1 ||
      record.name !== options.currentName ||
      record.target !== options.currentProfile ||
      !['prepared', 'key-ready', 'profile-ready', 'complete'].includes(record.phase) ||
      (record.phase !== 'complete' &&
        (record.source !== options.previousProfile ||
          (record.sourceIdentity !== undefined &&
            (typeof record.sourceIdentity.device !== 'string' ||
              typeof record.sourceIdentity.inode !== 'string'))))
    ) {
      throw new Error('The desktop migration journal does not match this installation.')
    }
    return record
  } finally {
    closeSync(fd)
  }
}

const syncDirectory = (directory: string): void => {
  // Windows fsync requires a file handle. The complete journal contents are flushed below;
  // the native directory move additionally uses MOVEFILE_WRITE_THROUGH on Windows.
  if (process.platform === 'win32') return
  const fd = openSync(directory, constants.O_RDONLY)
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

const writeRecord = (directory: string, record: MigrationRecord): void => {
  const temporary = join(directory, `.desktop-identity-${randomUUID()}.tmp`)
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    try {
      writeFileSync(fd, JSON.stringify(record))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, join(directory, 'desktop-identity.json'))
    syncDirectory(directory)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** Synchronous pre-ready migration. Caller holds the old Electron single-instance lock and keeps
 * the returned release function alive until the new single-instance lock has been acquired.
 */
export function migrateDesktopIdentity(options: DesktopIdentityMigrationOptions): () => void {
  mkdirSync(options.stateDirectory, { recursive: true, mode: 0o700 })
  const release = options.native.acquireMigrationLock(
    join(options.stateDirectory, 'desktop-identity.lock')
  )
  try {
    let record = readRecord(join(options.stateDirectory, 'desktop-identity.json'), options)
    const previous = directoryIdentity(options.previousProfile)
    const current = directoryIdentity(options.currentProfile)
    if (previous && current)
      throw new Error(
        'Desktop profile conflict: both old and new directories exist. Neither was replaced.'
      )
    if (record?.phase === 'complete') {
      if (previous)
        throw new Error(
          'Desktop profile conflict: a previous installation has recreated its profile.'
        )
      if (!current)
        throw new Error(
          'The migrated desktop profile is missing. No empty replacement was created.'
        )
      return release
    }
    if (!record) {
      record = {
        version: 1,
        phase: 'prepared',
        name: options.currentName,
        source: options.previousProfile,
        target: options.currentProfile,
        ...(previous ? { sourceIdentity: previous } : {})
      }
      writeRecord(options.stateDirectory, record)
      options.onProgress?.('prepared')
    }
    if (record.sourceIdentity && !sameIdentity(previous ?? current, record.sourceIdentity)) {
      throw new Error('Desktop profile conflict: the original migration source cannot be located.')
    }
    if (record.phase === 'prepared') {
      // Rename the existing master key once, before Chromium or application stores can read it.
      // A crash after the native operation is safe: retry finds the same key at its new identity.
      if (record.sourceIdentity || options.hasLegacySettings) options.migrateKey()
      record = { ...record, phase: 'key-ready' }
      writeRecord(options.stateDirectory, record)
      options.onProgress?.('key-ready')
    }
    if (record.sourceIdentity) {
      if (previous) {
        if (!sameIdentity(previous, record.sourceIdentity))
          throw new Error('Desktop profile conflict: the migration source changed.')
        options.native.renameDirectoryNoReplace(options.previousProfile, options.currentProfile)
      } else if (!sameIdentity(current, record.sourceIdentity)) {
        throw new Error(
          'The original desktop profile cannot be located. Migration stopped without creating an empty replacement.'
        )
      }
    } else {
      if (previous)
        throw new Error('Desktop profile conflict: a legacy profile appeared during migration.')
      mkdirSync(options.currentProfile, { recursive: true, mode: 0o700 })
    }
    if (
      record.sourceIdentity &&
      !sameIdentity(directoryIdentity(options.currentProfile), record.sourceIdentity)
    ) {
      throw new Error('The moved profile identity could not be verified.')
    }
    // Persist the directory rename before advancing the journal. Identity checks above recover
    // a crash between the rename and this checkpoint without recopying or clobbering files.
    syncDirectory(join(options.currentProfile, '..'))
    record = { ...record, phase: 'profile-ready' }
    writeRecord(options.stateDirectory, record)
    options.onProgress?.('profile-ready')
    options.afterProfileMove?.()
    const complete: CompleteRecord = {
      version: 1,
      phase: 'complete',
      name: options.currentName,
      target: options.currentProfile
    }
    writeRecord(options.stateDirectory, complete)
    options.onProgress?.('complete')
    return release
  } catch (error) {
    release()
    throw error
  }
}
