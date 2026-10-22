import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

// Shared by the handoff and protocol regressions; callers own and clean up their fixture root.
export function compileNsisProbe(root: string, instructions: string): string {
  const source = join(root, 'probe.nsi')
  const executable = join(root, 'probe.exe')
  writeFileSync(
    source,
    [
      'Unicode true',
      'RequestExecutionLevel user',
      'SilentInstall silent',
      `OutFile "${executable}"`,
      '!include LogicLib.nsh',
      instructions
    ].join('\n')
  )
  const compiler = process.env.OPEN_SCIENCE_MAKENSIS
  if (!compiler) throw new Error('Set OPEN_SCIENCE_MAKENSIS to the cached NSIS compiler.')
  const compile = spawnSync(compiler, [process.platform === 'win32' ? '/V2' : '-V2', source], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000
  })
  expect(compile.error).toBeUndefined()
  expect(compile.status, compile.stdout + compile.stderr).toBe(0)
  return executable
}
