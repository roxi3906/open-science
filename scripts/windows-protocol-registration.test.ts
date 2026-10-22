import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { compileNsisProbe } from './fixtures/windows-update-notice/nsis-probe'

const hook = readFileSync('build/installer.nsh', 'utf8')
const install = hook.match(/!macro customInstall\n([\s\S]*?)!macroend/)?.[1] ?? ''
const key = 'Software\\Classes\\open-science'

describe('Windows installer protocol association', () => {
  it('checks the association on the owning desktop startup before initializing the backend', () => {
    const source = readFileSync('src/main/index.ts', 'utf8')
    const registration = source.indexOf('ensureWindowsProtocolRegistration(app)')
    expect(registration).toBeGreaterThan(source.indexOf('await app.whenReady()'))
    expect(registration).toBeLessThan(source.indexOf('await connectDesktopRuntimeForStartup('))
    expect(source).toContain("from './windows-protocol-registration'")
  })

  it('uses the same post-install hook for fresh, overwrite and updater installations', () => {
    const config = load(readFileSync('electron-builder.yml', 'utf8')) as {
      nsis: { include: string }
    }
    expect(readFileSync(config.nsis.include, 'utf8')).toContain('\\installer.nsh"')
    const require = createRequire(import.meta.url)
    const builderRoot = dirname(require.resolve('app-builder-lib/package.json'))
    const section = readFileSync(join(builderRoot, 'templates/nsis/installSection.nsh'), 'utf8')
    expect(section.indexOf('!insertmacro customInstall')).toBeGreaterThan(
      section.indexOf('!insertmacro installApplicationFiles')
    )
    expect(install).not.toContain('isUpdated')
    expect(install).not.toContain('IfSilent')
    expect(install).toContain(`WriteRegStr HKCU "${key}" "" "URL:Open-Science"`)
    expect(install).toContain(`WriteRegStr HKCU "${key}" "URL Protocol" ""`)
    expect(install).toContain(
      `WriteRegStr HKCU "${key}\\shell\\open\\command" "" '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "%1"'`
    )
    expect(install.indexOf('WriteRegStr')).toBeLessThan(install.indexOf('Push "installed"'))
    expect(install).toContain('!insertmacro quitFailedUpdate')
  })
})

// The native CI lane requires tooling; portable runs explicitly skip these registry tests.
describe.skipIf(
  process.platform !== 'win32' ||
    (!process.env.OPEN_SCIENCE_MAKENSIS &&
      process.env.OPEN_SCIENCE_REQUIRE_NATIVE_PROTOCOL_TESTS !== '1')
)('native NSIS protocol uninstall', () => {
  beforeAll(() => {
    expect(process.env.OPEN_SCIENCE_MAKENSIS, 'Native protocol tests require NSIS').toBeTruthy()
  })

  it.each([
    { name: 'preserves the association during update', updated: true, otherOwner: false },
    { name: 'preserves an association owned by another install', updated: false, otherOwner: true },
    { name: 'deletes its own association on normal uninstall', updated: false, otherOwner: false }
  ])(
    '$name',
    ({ updated, otherOwner }) => {
      const root = mkdtempSync(join(tmpdir(), 'nsis protocol-'))
      const fixtureKey = `Software\\Classes\\open-science-test-${randomUUID()}`
      const registryKey = `HKCU\\${fixtureKey}`
      const run = (
        exe: string,
        args: string[],
        windowsVerbatimArguments = false
      ): SpawnSyncReturns<string> => {
        const result = spawnSync(exe, args, {
          encoding: 'utf8',
          windowsHide: true,
          windowsVerbatimArguments,
          timeout: 30_000,
          env: { ...process.env, TEMP: root, TMP: root }
        })
        expect(result.error).toBeUndefined()
        return result
      }
      const query = (): SpawnSyncReturns<string> =>
        run('reg.exe', ['query', registryKey, '/s', '/reg:32'])
      try {
        // Keep every instruction and guard in the production hook. Only its registry namespace
        // changes; the unrelated cleanup processes use the same successful stubs as the fixture.
        writeFileSync(join(root, 'installer.nsh'), hook.replaceAll(key, fixtureKey))
        mkdirSync(join(root, 'resources'))
        for (const script of [
          'windows-runtime-cache-uninstall.ps1',
          'windows-update-handoff-uninstall.ps1',
          'windows-notebook-sandbox-uninstall.ps1'
        ]) {
          writeFileSync(join(root, 'resources', script), 'exit 0\r\n')
        }
        const executable = compileNsisProbe(
          root,
          [
            'SilentUnInstall silent',
            '!define BUILD_UNINSTALLER',
            '!define APP_EXECUTABLE_FILENAME "fixture.exe"',
            `!define isUpdated '"${updated ? 1 : 0}" == "1"'`,
            `!include "${join(root, 'installer.nsh')}"`,
            'Section',
            'WriteUninstaller "$EXEDIR\\uninstall.exe"',
            'SectionEnd',
            'Section "Uninstall"',
            '!insertmacro customUnInstall',
            'SectionEnd'
          ].join('\n')
        )
        const owner = otherOwner ? join(root, 'other install') : root
        const command = `"${join(owner, 'fixture.exe')}" "%1"`
        for (const args of [
          [registryKey, '/v', 'URL Protocol', '/d', ''],
          [`${registryKey}\\shell\\open\\command`, '/ve', '/d', command]
        ]) {
          const seed = run('reg.exe', ['add', ...args, '/f', '/reg:32'])
          expect(seed.status, seed.stdout + seed.stderr).toBe(0)
        }
        const before = query()
        expect(before.status, before.stderr).toBe(0)
        expect(before.stdout).toContain(command)
        const install = run(executable, [])
        expect(install.status, install.stdout + install.stderr).toBe(0)
        // NSIS requires the final _?= argument unquoted, even for paths with spaces. It prevents
        // a detached temporary uninstaller, so the registry assertions wait for actual cleanup.
        const uninstall = run(join(root, 'uninstall.exe'), ['/S', `_?=${root}`], true)
        expect(uninstall.status, uninstall.stdout + uninstall.stderr).toBe(0)
        const after = query()
        if (updated || otherOwner) {
          expect(after.status, after.stderr).toBe(0)
          expect(after.stdout).toBe(before.stdout)
        } else {
          expect(after.status, after.stdout + after.stderr).toBe(1)
        }
      } finally {
        try {
          run('reg.exe', ['delete', registryKey, '/f', '/reg:32'])
          expect(query().status, `Failed to clean up ${registryKey}`).toBe(1)
        } finally {
          rmSync(root, { recursive: true, force: true })
        }
      }
    },
    120_000
  )
})
