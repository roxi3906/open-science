import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateDesktopIdentity, type DesktopIdentityMigrationOptions } from './desktop-identity'

const require = createRequire(import.meta.url)
const native =
  require('@aipoch/brand-migration-native') as typeof import('@aipoch/brand-migration-native')
let root: string
let options: DesktopIdentityMigrationOptions
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'open-science-profile-migration-'))
  options = {
    stateDirectory: join(root, '.open-science'),
    previousProfile: join(root, 'Open Science'),
    currentProfile: join(root, 'Open-Science'),
    currentName: 'Open-Science',
    hasLegacySettings: true,
    migrateKey: vi.fn(),
    native
  }
  mkdirSync(options.previousProfile)
  writeFileSync(join(options.previousProfile, 'Cookies'), 'encrypted-cookie-fixture')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('desktop identity upgrade', () => {
  it('does not silently recreate a profile missing after a completed migration', () => {
    migrateDesktopIdentity(options)()
    rmSync(options.currentProfile, { recursive: true })
    expect(() => migrateDesktopIdentity(options)).toThrow(/profile.*missing/i)
    expect(existsSync(options.currentProfile)).toBe(false)
  })

  it('moves the complete profile without changing encrypted data and does not repeat key migration', () => {
    migrateDesktopIdentity(options)()
    expect(existsSync(options.previousProfile)).toBe(false)
    expect(readFileSync(join(options.currentProfile, 'Cookies'), 'utf8')).toBe(
      'encrypted-cookie-fixture'
    )
    expect(options.migrateKey).toHaveBeenCalledTimes(1)
    migrateDesktopIdentity(options)()
    expect(options.migrateKey).toHaveBeenCalledTimes(1)
    expect(
      readFileSync(join(options.stateDirectory, 'desktop-identity.json'), 'utf8')
    ).not.toContain('Open Science')
  })

  it.each(['prepared', 'key-ready', 'profile-ready', 'complete'] as const)(
    'recovers an interruption after %s without losing the original profile',
    (phase) => {
      expect(() =>
        migrateDesktopIdentity({
          ...options,
          onProgress: (current) => {
            if (current === phase) throw new Error('interrupted')
          }
        })
      ).toThrow('interrupted')
      migrateDesktopIdentity(options)()
      expect(existsSync(options.previousProfile)).toBe(false)
      expect(readFileSync(join(options.currentProfile, 'Cookies'), 'utf8')).toBe(
        'encrypted-cookie-fixture'
      )
    }
  )

  it('does not migrate keys or overwrite a conflicting destination profile', () => {
    mkdirSync(options.currentProfile)
    writeFileSync(join(options.currentProfile, 'Cookies'), 'different-cookie-fixture')
    expect(() => migrateDesktopIdentity(options)).toThrow(/conflict/i)
    expect(options.migrateKey).not.toHaveBeenCalled()
    expect(readFileSync(join(options.previousProfile, 'Cookies'), 'utf8')).toBe(
      'encrypted-cookie-fixture'
    )
    expect(readFileSync(join(options.currentProfile, 'Cookies'), 'utf8')).toBe(
      'different-cookie-fixture'
    )
  })

  it('leaves the old profile in place when the keychain is locked or contains conflicting keys', () => {
    expect(() =>
      migrateDesktopIdentity({
        ...options,
        migrateKey: () => {
          throw new Error('keychain locked')
        }
      })
    ).toThrow('keychain locked')
    expect(existsSync(options.currentProfile)).toBe(false)
    expect(readFileSync(join(options.previousProfile, 'Cookies'), 'utf8')).toBe(
      'encrypted-cookie-fixture'
    )
    migrateDesktopIdentity(options)()
  })
})
