import { lstat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Derive only the installation's sibling receipt directory, never an arbitrary replacement in
// a user-selected path. Native removal still verifies the receipt, SID, token and WFP identities.
export const legacyWindowsOwnershipRoot = (
  root: string,
  installationId: string
): string | undefined => {
  if (!/^[a-f0-9]{24}$/.test(installationId)) return undefined
  const suffix = new RegExp(
    `([\\\\/])Open-Science([\\\\/])notebook-sandbox([\\\\/])${installationId}$`,
    'i'
  )
  return suffix.test(root)
    ? root.replace(suffix, `$1OpenScience$2notebook-sandbox$3${installationId}`)
    : undefined
}

export const retireLegacyWindowsOwnership = async (
  root: string,
  installationId: string,
  remove: (legacyRoot: string) => Promise<{ cancelled: boolean }>
): Promise<{ cancelled: boolean }> => {
  const legacyRoot = legacyWindowsOwnershipRoot(root, installationId)
  if (!legacyRoot) return { cancelled: false }
  try {
    // Reject junctions in the brand/lease path as well as at the receipt directory itself.
    let parent = legacyRoot
    for (let depth = 0; depth < 3; depth++, parent = dirname(parent)) {
      const stat = await lstat(parent)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Legacy Notebook ownership must be a real directory.')
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { cancelled: false }
    throw error
  }
  const names = await readdir(legacyRoot)
  if (!names.some((name) => ['receipt.json', 'creating.json', 'acl-state.json'].includes(name))) {
    let leases: string[] = []
    try {
      const leaseRoot = join(legacyRoot, 'acl-leases')
      const stat = await lstat(leaseRoot)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Legacy Notebook ACL leases must be a real directory.')
      }
      leases = await readdir(leaseRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!leases.some((name) => name.endsWith('.json'))) return { cancelled: false }
  }
  // The native journal makes removal retryable. Cancellation or any unverified cleanup blocks
  // creation at the new location instead of abandoning the old installation's ACLs or filters.
  return remove(legacyRoot)
}
