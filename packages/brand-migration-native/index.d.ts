/** Rename the OS key's lookup identity without exporting or changing its secret material.
 * Throws on conflicting keys, locked storage, or unsupported backends. Run before safeStorage
 * initializes and while both application identities are held by the migration owner.
 */
export function migrateKeyIdentity(
  previousName: string,
  currentName: string
): 'absent' | 'current' | 'migrated'

/** Hold an OS lock until the returned idempotent release function is called (or process exit). */
export function acquireMigrationLock(path: string): () => void

/** Same-filesystem directory rename which must never replace an existing target. */
export function renameDirectoryNoReplace(previousPath: string, currentPath: string): void
