import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { lstat, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isLegacyDataRoot } from './data-root-names'
import { preserveRuntimeTree } from './runtime-tree'
import {
  commitDataRootSwitch,
  discardStagedCopy,
  runDataRootMigration
} from '../storage/migration-service'
import { readMigrationMarker } from '../storage/migration-marker'
import { DataRootCleanupJournal } from '../storage/data-root-cleanup'
import { dataRootForParent } from '../storage-root'
import type { Logger } from '../logger'
import { KernelProcessLifecycleOwner } from '../notebook/kernel-process-lifecycle.windows-posix'
import { ShellProcessOwnershipRegistry } from '../notebook/shell-process-ownership.windows-posix'

export async function migrateDataRootBrand(options: {
  currentDataRoot: string
  configRoot: string
  packaged: boolean
  setDataRoot: (target: string) => Promise<void>
  runtimeScript: string
  logger: Logger
}): Promise<string> {
  const source = options.currentDataRoot
  if (!isLegacyDataRoot(source, options.packaged) || !existsSync(source)) return source
  const sourceState = await lstat(source)
  if (!sourceState.isDirectory() || sourceState.isSymbolicLink())
    throw new Error('Data migration requires a direct, owned data directory.')
  const native = createRequire(import.meta.url)(
    '@aipoch/brand-migration-native'
  ) as typeof import('@aipoch/brand-migration-native')
  const release = native.acquireMigrationLock(join(options.configRoot, 'data-root-brand.lock'))
  const parent = dirname(source)
  const target = dataRootForParent(parent)
  try {
    // A stopped Electron process does not prove its kernel/Shell descendants have exited. Reuse
    // their durable ownership/start-token fences before any inventory, copy, or source retirement.
    await new KernelProcessLifecycleOwner({ storageRoot: source }).recover()
    const shellProcesses = new ShellProcessOwnershipRegistry(source)
    await shellProcesses.recover()
    if (shellProcesses.hasReceipts())
      throw new Error('Previous Shell process ownership is unresolved.')
    let marker = await readMigrationMarker(target)
    if (marker?.status === 'copying' && marker.source === source && marker.target === target) {
      const discarded = await discardStagedCopy(
        { currentDataRoot: source, expectedToken: marker.token, allowIncomplete: true },
        parent
      )
      if (!discarded.ok) throw new Error(discarded.error)
      marker = null
    }
    if (!marker) {
      const copied = await runDataRootMigration(
        {
          currentDataRoot: source,
          logger: options.logger,
          runtime: { disconnect: async () => {} },
          notebook: { shutdownAll: async () => ({ reaped: true }) },
          preserveRuntimeTree: (from, to) => preserveRuntimeTree(from, to, options.runtimeScript)
        },
        parent,
        { signal: new AbortController().signal, onProgress: () => {} }
      )
      if (!copied.ok) throw new Error(copied.error)
      marker = await readMigrationMarker(target)
    }
    if (!marker || !marker.runtimeCopyInventory)
      throw new Error('Data migration has no verified complete runtime receipt.')
    const committed = await commitDataRootSwitch(
      {
        currentDataRoot: source,
        expectedToken: marker.token,
        setDataRoot: options.setDataRoot,
        cleanupJournal: new DataRootCleanupJournal(options.configRoot),
        logger: options.logger
      },
      parent
    )
    if (!committed.ok) throw new Error(committed.error)
    // Only an empty source shell can be retired here. Owned deferred cleanup remains journaled.
    try {
      await rmdir(join(source, 'shell-process-ownership'))
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error
    }
    try {
      await rmdir(source)
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error
    }
    return target
  } finally {
    release()
  }
}
