const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// Only schema-owned fields move. Never rewrite credentials, user messages, paths, or arbitrary
// strings containing the brand. A partial migration unions exclusions so permissions cannot widen.
export function migrateSettingsV2(value: Record<string, unknown>): Record<string, unknown> {
  const network = value.notebookNetwork
  if (!isRecord(network)) return { ...value, version: 3 }
  const {
    disabledOpenScienceDomainGroups: legacyGroups,
    disabledOpenScienceDomains: legacyDomains,
    ...current
  } = network
  const merge = (previous: unknown, next: unknown): unknown[] => [
    ...new Set([...(Array.isArray(previous) ? previous : []), ...(Array.isArray(next) ? next : [])])
  ]
  return {
    ...value,
    version: 3,
    notebookNetwork: {
      ...current,
      disabledAppDomainGroups: merge(legacyGroups, current.disabledAppDomainGroups),
      disabledAppDomains: merge(legacyDomains, current.disabledAppDomains)
    }
  }
}
