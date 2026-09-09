export const LEGACY_WEB_COOKIE = 'open_science_web_token'
export const LEGACY_PAIRING_COOKIE = 'open_science_remote_pairing'
export const LEGACY_REMOTE_SESSION_COOKIE = 'open_science_remote_session'
export const LEGACY_PAIR_STATUS_PATH = '/__open_science_remote/pair/status'

// Presence takes precedence over validity: a malformed current cookie must not downgrade to a
// legacy credential. Duplicate credentials are ambiguous and are rejected as well.
export function readMigratingCookie(
  header: string | undefined,
  current: string,
  previous: string
): { value: string | undefined; legacy: boolean } {
  const entries = (header?.split(';') ?? []).map((part) => {
    const [name, ...value] = part.trim().split('=')
    return { name, value: value.join('=') }
  })
  const selected = entries.filter(({ name }) => name === current)
  const legacy = selected.length === 0
  const matches = legacy ? entries.filter(({ name }) => name === previous) : selected
  if (matches.length !== 1) return { value: undefined, legacy }
  try {
    return { value: decodeURIComponent(matches[0].value), legacy }
  } catch {
    return { value: undefined, legacy }
  }
}
