const CODEX_BLOCKS = [
  'imported Codex route selection',
  'imported Codex provider',
  'Codex transport route selection',
  'Codex transport provider'
] as const
const LEGACY_PREFIX = '# Open Science: '
const CURRENT_PREFIX = '# Open-Science: '
export const LEGACY_RIS_LITERAL_PREFIX = 'Open Science literal creator: '

/** Only call for application developer instructions, never arbitrary user or tool content. */
export function migrateArtifactInstructionTags(contents: string): string {
  return contents.replace(
    /<open_science_artifact_instructions>([\s\S]*?)<\/open_science_artifact_instructions>/g,
    '<open-science-artifact-instructions>$1</open-science-artifact-instructions>'
  )
}

export function migrateCodexMarkers(contents: string): string {
  const lines = contents.split(/\r?\n/)
  for (const block of CODEX_BLOCKS) {
    const previousBegin = `${LEGACY_PREFIX}begin ${block}`
    const previousEnd = `${LEGACY_PREFIX}end ${block}`
    let start = lines.indexOf(previousBegin)
    while (start >= 0) {
      const end = lines.indexOf(previousEnd, start + 1)
      if (end < 0) break // Incomplete ownership evidence cannot authorize rewriting a user block.
      lines[start] = `${CURRENT_PREFIX}begin ${block}`
      lines[end] = `${CURRENT_PREFIX}end ${block}`
      for (let i = start + 1; i < end; i++) {
        if (lines[i].startsWith(`${LEGACY_PREFIX}preserved Codex config `)) {
          lines[i] = CURRENT_PREFIX + lines[i].slice(LEGACY_PREFIX.length)
        }
      }
      start = lines.indexOf(previousBegin, end + 1)
    }
  }
  return lines.join(contents.includes('\r\n') ? '\r\n' : '\n')
}
