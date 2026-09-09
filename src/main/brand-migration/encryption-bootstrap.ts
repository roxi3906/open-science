import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type * as Native from '@aipoch/brand-migration-native'

export const ENCRYPTION_PROBE_ARG = '--open-science-encryption-migration-probe'
export const previousDesktopName = (packaged: boolean): string =>
  packaged ? 'Open Science' : 'Open Science (DEV)'

// KWallet's Chromium key is shared independently of the caller's product name. libsecret instead
// uses an application attribute. Ask this Electron build which backend it selected; reproducing
// Chromium's desktop/environment detection would risk migrating the wrong store.
export function migrateEncryptionIdentity(options: {
  platform: NodeJS.Platform
  packaged: boolean
  executable: string
  mainEntry: string
  previousName: string
  currentName: string
  passwordStore: string
  native: Pick<typeof Native, 'migrateKeyIdentity'>
}): void {
  if (options.platform === 'win32') return
  if (options.platform === 'linux') {
    const profile = mkdtempSync(join(tmpdir(), 'open-science-encryption-probe-'))
    try {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(
        options.executable,
        [
          ...(!options.packaged ? [options.mainEntry] : []),
          ENCRYPTION_PROBE_ARG,
          JSON.stringify({
            name: options.previousName,
            profile,
            passwordStore: options.passwordStore
          })
        ],
        {
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60_000,
          maxBuffer: 65_536
        }
      )
      if (result.error || result.status !== 0) {
        throw new Error(
          'Could not inspect the previous encryption backend. Unlock the credential store and retry migration.'
        )
      }
      const probe = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '') as {
        backend?: string
      }
      if (['kwallet', 'kwallet5', 'kwallet6', 'basic_text'].includes(probe.backend ?? '')) return
      if (probe.backend !== 'gnome_libsecret')
        throw new Error('The encryption backend could not be identified. Migration stopped.')
    } finally {
      rmSync(profile, { recursive: true, force: true })
    }
  }
  options.native.migrateKeyIdentity(options.previousName, options.currentName)
}

// Dedicated migration subprocess; no repositories, windows, credentials, or user profile are loaded.
export function runEncryptionProbe(): void {
  const require = createRequire(import.meta.url)
  const { app, safeStorage } = require('electron') as typeof import('electron')
  try {
    const offset = process.argv.indexOf(ENCRYPTION_PROBE_ARG)
    const input = JSON.parse(process.argv[offset + 1] ?? '') as {
      name: string
      profile: string
      passwordStore: string
    }
    if (
      ![previousDesktopName(true), previousDesktopName(false)].includes(input.name) ||
      !isAbsolute(input.profile) ||
      typeof input.passwordStore !== 'string'
    )
      throw new Error('Invalid encryption probe request.')
    app.setName(input.name)
    app.setPath('userData', input.profile)
    if (input.passwordStore) app.commandLine.appendSwitch('password-store', input.passwordStore)
    app.disableHardwareAcceleration()
    void app
      .whenReady()
      .then(() => {
        // Forces backend selection in the old identity, without requesting any stored ciphertext.
        safeStorage.isEncryptionAvailable()
        process.stdout.write(
          `${JSON.stringify({ backend: safeStorage.getSelectedStorageBackend() })}\n`
        )
        app.exit(0)
      })
      .catch(() => app.exit(2))
  } catch {
    app.exit(2)
  }
}
