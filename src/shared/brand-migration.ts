// Released spellings are accepted only at migration/read boundaries. Current writers use the
// hyphenated canonical name, or a neutral alias where a provider only permits identifier syntax.
const SERVER_SUFFIXES = [
  'activity',
  'artifacts',
  'notebook',
  'skills',
  'plan',
  'literature',
  'library',
  'host-message',
  'reviewer'
] as const

export const legacyAppServerName = (canonical: string): string | undefined =>
  SERVER_SUFFIXES.some((suffix) => canonical === `open-science-${suffix}`)
    ? canonical.replace(/-/g, '_')
    : undefined

export const frameworkAppServerName = (canonical: string): string => {
  const suffix = SERVER_SUFFIXES.find((suffix) => canonical === `open-science-${suffix}`)
  return suffix ? `app_${suffix.replace(/-/g, '_')}` : canonical.replace(/[^a-zA-Z0-9_]/g, '_')
}

export const canonicalMigratedAppServerName = (name: string): string => {
  const suffix = SERVER_SUFFIXES.find(
    (suffix) =>
      name === `app_${suffix.replace(/-/g, '_')}` ||
      name === `open_science_${suffix.replace(/-/g, '_')}`
  )
  return suffix ? `open-science-${suffix}` : name
}

export const migrateLegacyToolName = (name: string): string => {
  for (const suffix of SERVER_SUFFIXES) {
    const previous = `mcp__open_science_${suffix.replace(/-/g, '_')}`
    if (name === previous || name.startsWith(`${previous}__`)) {
      return `mcp__app_${suffix.replace(/-/g, '_')}${name.slice(previous.length)}`
    }
  }
  return name
}

/** Reads only the owned structured metadata field; user text and payload values are untouched. */
export const readLiteraturePresentation = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const payload = Object.hasOwn(record, 'open-science-literature-presentation')
    ? record['open-science-literature-presentation']
    : record.openScienceLiteraturePresentation
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined
}

export const canonicalizeAppToolIdentity = (identity: string): string => {
  const prefix = identity.startsWith('mcp__') ? 'mcp__' : identity.startsWith('mcp.') ? 'mcp.' : ''
  const name = identity.slice(prefix.length)
  for (const suffix of SERVER_SUFFIXES) {
    for (const alias of [
      `app_${suffix.replace(/-/g, '_')}`,
      `open_science_${suffix.replace(/-/g, '_')}`
    ]) {
      if (name === alias || (name.startsWith(alias) && /^[_./]/.test(name.slice(alias.length)))) {
        return `${prefix}open-science-${suffix}${name.slice(alias.length)}`
      }
    }
  }
  return identity
}
