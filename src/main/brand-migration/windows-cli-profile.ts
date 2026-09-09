import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  isManagedCliLauncher,
  parseWindowsPathJournal,
  WINDOWS_PATH_RECEIPT_OWNER
} from '../cli-install/launcher'

export type WindowsCliProfileMigration = {
  stateDirectory: string
  previousProfile: string
  currentProfile: string
  readUserPath: () => string | null
  compareAndSetUserPath: (before: string | null, after: string | null) => void
  onProgress?: (phase: 'prepared' | 'path-ready' | 'receipt-ready') => void
}
type Pending = {
  version: 1
  phase: 'pending'
  previous: string
  current: string
  receiptPath: string
  originalReceipt: string
  nextReceipt: string | null
  beforePath: string | null
  afterPath: string | null
}
type Complete = { version: 1; phase: 'complete'; current: string }
const normalize = (path: string): string => path.replace(/[\\/]+$/, '').toLowerCase()
const readOwnedFile = (path: string): string | undefined => {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const state = fstatSync(fd)
    if (
      !state.isFile() ||
      state.nlink !== 1 ||
      state.size > 1_048_576 ||
      (process.getuid && state.uid !== process.getuid())
    )
      throw new Error('Untrusted CLI migration file.')
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}
const writeDurable = (path: string, contents: string): void => {
  const temporary = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try {
    try {
      writeFileSync(fd, contents)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

// Called while the desktop migration lock is held, after moving its entire profile but before
// committing that move. A separate durable journal bridges the filesystem and registry writes.
export function migrateWindowsCliProfile(options: WindowsCliProfileMigration): void {
  const journalPath = join(options.stateDirectory, 'windows-cli-profile.json')
  const previousBin = join(options.previousProfile, 'bin')
  const currentBin = join(options.currentProfile, 'bin')
  const receiptPath = join(currentBin, '.open-science-path-receipt')
  const pendingPath = join(currentBin, '.open-science-path-pending')
  const saved = readOwnedFile(journalPath)
  let record: Pending | Complete | undefined = saved ? JSON.parse(saved) : undefined
  if (
    record &&
    (record.version !== 1 ||
      record.current !== currentBin ||
      !['pending', 'complete'].includes(record.phase))
  )
    throw new Error('Invalid Windows CLI migration journal.')
  if (record?.phase === 'complete') return
  if (!record) {
    const receipt = readOwnedFile(receiptPath)
    const pending = readOwnedFile(pendingPath)
    if (receipt === undefined && pending === undefined) return
    if (receipt !== undefined && pending !== undefined)
      throw new Error('Conflicting Windows PATH journals.')
    const directory = lstatSync(currentBin)
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('Untrusted CLI directory.')
    const shim = readOwnedFile(join(currentBin, 'open-science.cmd'))
    if (!shim || !isManagedCliLauncher(shim))
      throw new Error('Unmanaged CLI launcher; PATH was not changed.')
    const originalReceipt = (receipt ?? pending)!
    if (parseWindowsPathJournal(originalReceipt, currentBin)) return
    if (!parseWindowsPathJournal(originalReceipt, previousBin))
      throw new Error('Invalid legacy PATH receipt.')
    const beforePath = options.readUserPath()
    const parts = (beforePath ?? '').split(';').filter(Boolean)
    const hadPrevious = parts.some((part) => normalize(part) === normalize(previousBin))
    const hadCurrent = parts.some((part) => normalize(part) === normalize(currentBin))
    const withoutPrevious = parts.filter((part) => normalize(part) !== normalize(previousBin))
    const shouldAdd = !hadCurrent && (hadPrevious || pending !== undefined)
    const afterPath =
      hadPrevious || shouldAdd
        ? [...withoutPrevious, ...(shouldAdd ? [currentBin] : [])].join(';')
        : beforePath
    const nextReceipt = shouldAdd
      ? JSON.stringify({
          version: 1,
          owner: WINDOWS_PATH_RECEIPT_OWNER,
          binDir: currentBin,
          beforePath: withoutPrevious.join(';'),
          afterPath
        })
      : null
    record = {
      version: 1,
      phase: 'pending',
      previous: previousBin,
      current: currentBin,
      receiptPath: receipt !== undefined ? receiptPath : pendingPath,
      originalReceipt,
      nextReceipt,
      beforePath,
      afterPath
    }
    writeDurable(journalPath, JSON.stringify(record))
    options.onProgress?.('prepared')
  }
  if (
    record.previous !== previousBin ||
    ![receiptPath, pendingPath].includes(record.receiptPath) ||
    typeof record.originalReceipt !== 'string' ||
    !parseWindowsPathJournal(record.originalReceipt, previousBin) ||
    (record.nextReceipt !== null &&
      (typeof record.nextReceipt !== 'string' ||
        !parseWindowsPathJournal(record.nextReceipt, currentBin))) ||
    (record.beforePath !== null && typeof record.beforePath !== 'string') ||
    (record.afterPath !== null && typeof record.afterPath !== 'string')
  )
    throw new Error('Invalid Windows CLI migration journal.')
  const existing = readOwnedFile(record.receiptPath)
  const published = readOwnedFile(receiptPath)
  if (
    existing !== undefined &&
    existing !== record.originalReceipt &&
    existing !== record.nextReceipt
  ) {
    throw new Error('PATH receipt changed during migration.')
  }
  if (
    published !== undefined &&
    published !== record.originalReceipt &&
    published !== record.nextReceipt
  )
    throw new Error('The new PATH receipt is already owned by another operation.')
  const userPath = options.readUserPath()
  if (userPath !== record.afterPath) {
    if (userPath !== record.beforePath)
      throw new Error('User PATH changed during migration. No unrelated entries were overwritten.')
    options.compareAndSetUserPath(record.beforePath, record.afterPath)
  }
  if (options.readUserPath() !== record.afterPath)
    throw new Error('Could not verify the migrated user PATH.')
  options.onProgress?.('path-ready')
  if (record.nextReceipt !== null) {
    if (
      published !== undefined &&
      published !== record.originalReceipt &&
      published !== record.nextReceipt
    ) {
      throw new Error('The new PATH receipt is already owned by another operation.')
    }
    if (published !== record.nextReceipt) writeDurable(receiptPath, record.nextReceipt)
  } else if (existing !== undefined) unlinkSync(record.receiptPath)
  if (record.receiptPath !== receiptPath && readOwnedFile(record.receiptPath) !== undefined)
    unlinkSync(record.receiptPath)
  options.onProgress?.('receipt-ready')
  writeDurable(
    journalPath,
    JSON.stringify({ version: 1, phase: 'complete', current: currentBin } satisfies Complete)
  )
}

const literal = (value: string | null): string =>
  value === null ? '$null' : `'${value.replace(/'/g, "''")}'`
const powershell = (script: string): string => {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${script}`],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 1_048_576 }
  )
  if (result.error || result.status !== 0)
    throw new Error('Could not safely migrate the Windows user PATH.')
  return result.stdout.trim()
}
export const windowsUserPath = {
  readUserPath: (): string | null =>
    JSON.parse(
      powershell(
        "ConvertTo-Json -Compress -InputObject ([Environment]::GetEnvironmentVariable('Path', 'User'))"
      )
    ),
  compareAndSetUserPath: (before: string | null, after: string | null): void => {
    powershell(
      `if ([Environment]::GetEnvironmentVariable('Path', 'User') -cne ${literal(before)}) { throw 'PATH changed' }; [Environment]::SetEnvironmentVariable('Path', ${literal(after)}, 'User')`
    )
  }
}
