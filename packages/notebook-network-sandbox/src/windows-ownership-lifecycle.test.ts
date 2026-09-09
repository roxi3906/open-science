import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const execution = vi.hoisted(() => ({ commands: [] as string[], cancelRemoval: false }))
vi.mock('node:child_process', () => ({
  // Only the external native/elevation processes are replaced; migration checks use real files.
  spawn: (_program: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    const elevated = args.includes('-EncodedCommand')
    const command = elevated
      ? Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
      : args.join('|')
    execution.commands.push(command)
    const cancelled = elevated && command.includes("@('remove',") && execution.cancelRemoval
    process.nextTick(() => child.emit('close', cancelled ? 1223 : 0))
    return child
  }
}))

import {
  installWindowsAppContainer,
  removeWindowsAppContainer
} from '../runtime/src/platform/windows-appcontainer.js'
const installationId = '0123456789abcdef01234567'
const roots: string[] = []
afterEach(async () => {
  execution.commands = []
  execution.cancelRemoval = false
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const fixture = async (): Promise<{ current: string; legacy: string }> => {
  const base = await mkdtemp(join(tmpdir(), 'sandbox-lifecycle-'))
  roots.push(base)
  const current = join(base, 'Aipoch', 'Open-Science', 'notebook-sandbox', installationId)
  const legacy = join(base, 'Aipoch', 'OpenScience', 'notebook-sandbox', installationId)
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, 'receipt.json'), '{}')
  return { current, legacy }
}

it('finishes verified legacy removal before preparing the new setup', async () => {
  const { current, legacy } = await fixture()
  await expect(installWindowsAppContainer('host.exe', installationId, current)).resolves.toEqual({
    cancelled: false
  })
  expect(execution.commands).toEqual([
    `prepare-remove|${installationId}|${legacy}`,
    expect.stringContaining(`'remove', '${installationId}', '${legacy}'`),
    `finish-remove|${installationId}|${legacy}`,
    `prepare-setup|${installationId}|${current}`,
    expect.stringContaining(`'setup', '${installationId}', '${current}'`),
    `finish-setup|${installationId}|${current}`
  ])
})

it('does not prepare a new profile after the user cancels legacy cleanup', async () => {
  const { current, legacy } = await fixture()
  execution.cancelRemoval = true
  await expect(installWindowsAppContainer('host.exe', installationId, current)).resolves.toEqual({
    cancelled: true
  })
  expect(execution.commands).toEqual([
    `prepare-remove|${installationId}|${legacy}`,
    expect.stringContaining(`'remove', '${installationId}', '${legacy}'`)
  ])
})

it('explicit uninstall removes both generations using their own receipt directory', async () => {
  const { current, legacy } = await fixture()
  await expect(removeWindowsAppContainer('host.exe', installationId, current)).resolves.toEqual({
    cancelled: false
  })
  expect(execution.commands).toEqual([
    `prepare-remove|${installationId}|${legacy}`,
    expect.stringContaining(`'remove', '${installationId}', '${legacy}'`),
    `finish-remove|${installationId}|${legacy}`,
    `prepare-remove|${installationId}|${current}`,
    expect.stringContaining(`'remove', '${installationId}', '${current}'`),
    `finish-remove|${installationId}|${current}`
  ])
})
