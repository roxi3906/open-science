import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const binding = require('./index.cjs') as typeof import('./index')
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'open-science-migration-fs-'))
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('migration filesystem ownership', () => {
  it('preserves both directory trees when a migration destination already exists', () => {
    const previous = join(directory, 'previous')
    const current = join(directory, 'current')
    mkdirSync(previous)
    mkdirSync(current)
    writeFileSync(join(previous, 'state.json'), 'original')
    writeFileSync(join(current, 'state.json'), 'conflicting')
    expect(() => binding.renameDirectoryNoReplace(previous, current)).toThrow()
    expect(readFileSync(join(previous, 'state.json'), 'utf8')).toBe('original')
    expect(readFileSync(join(current, 'state.json'), 'utf8')).toBe('conflicting')
    rmSync(current, { recursive: true })
    binding.renameDirectoryNoReplace(previous, current)
    expect(readFileSync(join(current, 'state.json'), 'utf8')).toBe('original')
  })

  it('excludes another process and releases ownership when the owner exits', () => {
    const path = join(directory, 'migration.lock')
    const nativePath = resolve('packages/brand-migration-native/index.cjs')
    const child = `const release = require(${JSON.stringify(nativePath)}).acquireMigrationLock(${JSON.stringify(path)});`
    const release = binding.acquireMigrationLock(path)
    try {
      expect(() => execFileSync(process.execPath, ['-e', child], { stdio: 'pipe' })).toThrow()
    } finally {
      release()
      release()
    }
    execFileSync(process.execPath, ['-e', child], { stdio: 'pipe' })
    const acquiredAfterExit = binding.acquireMigrationLock(path)
    acquiredAfterExit()
  })
})
