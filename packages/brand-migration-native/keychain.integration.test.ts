import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// Creates only randomly named fixture entries. Never changes HOME, the default keychain, its
// search list, or any application credential. Opt in on a logged-in macOS test machine.
describe.skipIf(
  process.platform !== 'darwin' || process.env.RUN_BRAND_KEYCHAIN_MIGRATION_TESTS !== '1'
)('real Electron encryption identity migration', () => {
  it('reads old ciphertext, writes new ciphertext and reads it after a second restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'open-science-key-migration-'))
    const suffix = randomUUID()
    const previous = `Open Science Migration Test ${suffix}`
    const current = `Open-Science Migration Test ${suffix}`
    const require = createRequire(import.meta.url)
    const electron = require('electron') as string
    const binding = resolve('packages/brand-migration-native/index.cjs')
    const entry = join(directory, 'fixture.cjs')
    writeFileSync(
      entry,
      `const { app, safeStorage } = require('electron');
const input = JSON.parse(process.argv[2]);
app.setName(input.identity);
app.setPath('userData', input.profile);
app.disableHardwareAcceleration();
if (input.operation === 'migrate') {
  try {
    const status = require(${JSON.stringify(binding)}).migrateKeyIdentity(input.previous, input.identity);
    process.stdout.write(JSON.stringify({ status }) + '\\n');
    app.exit(0);
  } catch (error) { process.stderr.write(error.message); app.exit(2); }
} else {
  app.whenReady().then(() => {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Fixture keychain unavailable');
      const result = input.operation === 'encrypt'
        ? safeStorage.encryptString(input.text).toString('base64')
        : safeStorage.decryptString(Buffer.from(input.ciphertext, 'base64'));
      process.stdout.write(JSON.stringify({ result }) + '\\n');
      app.exit(0);
    } catch (error) { process.stderr.write(error.message); app.exit(2); }
  });
}
`
    )
    const run = (identity: string, input: Record<string, string>): Record<string, string> => {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const stdout = execFileSync(
        electron,
        [entry, JSON.stringify({ identity, profile: join(directory, 'profile'), ...input })],
        { env, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, string>
    }
    try {
      expect(run(current, { operation: 'migrate', previous })).toEqual({ status: 'absent' })
      const before = run(previous, { operation: 'encrypt', text: 'before-upgrade-fixture' }).result
      expect(run(current, { operation: 'migrate', previous })).toEqual({ status: 'migrated' })
      expect(run(current, { operation: 'decrypt', ciphertext: before }).result).toBe(
        'before-upgrade-fixture'
      )
      expect(run(current, { operation: 'migrate', previous })).toEqual({ status: 'current' })
      const after = run(current, { operation: 'encrypt', text: 'after-upgrade-fixture' }).result
      expect(run(current, { operation: 'decrypt', ciphertext: after }).result).toBe(
        'after-upgrade-fixture'
      )
      // A partially upgraded installation may already contain two different master keys.
      // Refusing that conflict must preserve ciphertext belonging to both identities.
      const conflicting = run(previous, { operation: 'encrypt', text: 'other-key-fixture' }).result
      expect(() => run(current, { operation: 'migrate', previous })).toThrow(
        'Both encryption identities already have keys. Neither key was changed.'
      )
      expect(run(previous, { operation: 'decrypt', ciphertext: conflicting }).result).toBe(
        'other-key-fixture'
      )
      expect(run(current, { operation: 'decrypt', ciphertext: after }).result).toBe(
        'after-upgrade-fixture'
      )
    } finally {
      for (const identity of [previous, current]) {
        try {
          execFileSync(
            '/usr/bin/security',
            ['delete-generic-password', '-s', `${identity} Safe Storage`, '-a', identity],
            { stdio: 'ignore', timeout: 5000 }
          )
        } catch {
          /* The absent half of a successfully renamed fixture is expected. */
        }
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }, 120_000)
})
