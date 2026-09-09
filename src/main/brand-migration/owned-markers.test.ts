import { expect, it } from 'vitest'
import { migrateCodexMarkers } from './owned-markers'
it('migrates complete owned route markers while preserving their saved user configuration', () => {
  const prefix = '# Open Science: '
  const userLine = 'model = "Open Science user model"'
  const text = [
    userLine,
    prefix + 'begin imported Codex route selection',
    prefix + 'preserved Codex config ' + JSON.stringify(userLine),
    'model_provider = "example"',
    prefix + 'end imported Codex route selection',
    prefix + 'begin Codex transport provider'
  ].join('\r\n')
  const next = migrateCodexMarkers(text)
  expect(next).toBe(
    [
      userLine,
      '# Open-Science: begin imported Codex route selection',
      '# Open-Science: preserved Codex config ' + JSON.stringify(userLine),
      'model_provider = "example"',
      '# Open-Science: end imported Codex route selection',
      prefix + 'begin Codex transport provider'
    ].join('\r\n')
  )
  expect(migrateCodexMarkers(next)).toBe(next)
})
