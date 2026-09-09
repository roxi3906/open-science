import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateWindowsCliProfile, type WindowsCliProfileMigration } from './windows-cli-profile'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function fixture(): {
  options: WindowsCliProfileMigration
  path: () => string | null
  receipt: string
} {
  const root = mkdtempSync(join(tmpdir(), 'open-science-cli-path-'))
  roots.push(root)
  const previousProfile = join(root, 'Open Science')
  const currentProfile = join(root, 'Open-Science')
  const stateDirectory = join(root, 'migration')
  const previousBin = join(previousProfile, 'bin')
  const currentBin = join(currentProfile, 'bin')
  mkdirSync(currentBin, { recursive: true })
  mkdirSync(stateDirectory)
  writeFileSync(
    join(currentBin, 'open-science.cmd'),
    '@echo off\r\nrem Open Science command-line launcher. Managed by the app. Format version: 1.\r\n'
  )
  const receipt = join(currentBin, '.open-science-path-receipt')
  writeFileSync(
    receipt,
    JSON.stringify({
      version: 1,
      owner: 'Open Science Windows PATH entry. Managed by the app.',
      binDir: previousBin,
      beforePath: 'C:\\Tools',
      afterPath: `C:\\Tools;${previousBin}`
    })
  )
  let path: string | null = `C:\\Tools;${previousBin};D:\\Later`
  return {
    receipt,
    path: () => path,
    options: {
      previousProfile,
      currentProfile,
      stateDirectory,
      readUserPath: () => path,
      compareAndSetUserPath: (before, after) => {
        if (path !== before) throw new Error('Path changed')
        path = after
      }
    }
  }
}
describe('Windows profile CLI migration', () => {
  it.each([undefined, 'prepared', 'path-ready', 'receipt-ready'] as const)(
    'repairs a moved launcher receipt and preserves other PATH entries after %s',
    (phase) => {
      const { options, path, receipt } = fixture()
      if (phase)
        expect(() =>
          migrateWindowsCliProfile({
            ...options,
            onProgress: (current) => {
              if (current === phase) throw new Error('interrupted')
            }
          })
        ).toThrow('interrupted')
      migrateWindowsCliProfile(options)
      expect(path()).toBe(`C:\\Tools;D:\\Later;${join(options.currentProfile, 'bin')}`)
      const saved = readFileSync(receipt, 'utf8')
      expect(JSON.parse(saved)).toMatchObject({
        binDir: join(options.currentProfile, 'bin'),
        beforePath: 'C:\\Tools;D:\\Later',
        afterPath: path()
      })
      expect(saved).not.toContain('Open Science')
      migrateWindowsCliProfile(options)
      expect(readFileSync(receipt, 'utf8')).toBe(saved)
    }
  )
  it('does not change PATH if a receipt was replaced after interruption', () => {
    const { options, path, receipt } = fixture()
    const originalPath = path()
    expect(() =>
      migrateWindowsCliProfile({
        ...options,
        onProgress: (phase) => {
          if (phase === 'prepared') throw new Error('interrupted')
        }
      })
    ).toThrow('interrupted')
    writeFileSync(receipt, 'unrelated')
    expect(() => migrateWindowsCliProfile(options)).toThrow(/receipt/i)
    expect(path()).toBe(originalPath)
  })
  it('refuses an unrelated launcher without changing PATH or its receipt', () => {
    const { options, path, receipt } = fixture()
    const original = path()
    const saved = readFileSync(receipt, 'utf8')
    writeFileSync(
      join(options.currentProfile, 'bin', 'open-science.cmd'),
      '@echo off\r\necho unrelated'
    )
    expect(() => migrateWindowsCliProfile(options)).toThrow(/unmanaged/i)
    expect(path()).toBe(original)
    expect(readFileSync(receipt, 'utf8')).toBe(saved)
  })
})
