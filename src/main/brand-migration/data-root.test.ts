import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Logger } from '../logger'

vi.mock('electron', () => ({ app: { getPath: () => '/home/user', isPackaged: true } }))
vi.mock('../storage/remote-data-root', () => ({
  inspectWindowsStoragePath: () => ({ isRemote: false, supportsHardLinks: true })
}))
import { migrateDataRootBrand } from './data-root'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

it('blocks migration when a previous kernel process receipt cannot be verified', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-science-root-process-fence-'))
  roots.push(root)
  const source = join(root, 'OpenScience')
  const configRoot = join(root, '.open-science')
  await mkdir(join(source, 'runtime', 'kernel-processes'), { recursive: true })
  await mkdir(configRoot)
  await writeFile(
    join(source, 'runtime', 'kernel-processes', 'unknown.active.1.json'),
    'corrupt receipt'
  )
  const setDataRoot = vi.fn(async () => {})
  await expect(
    migrateDataRootBrand({
      currentDataRoot: source,
      configRoot,
      packaged: true,
      setDataRoot,
      logger,
      runtimeScript: 'unused'
    })
  ).rejects.toThrow(/KERNEL_STARTUP_FENCE/)
  expect(setDataRoot).not.toHaveBeenCalled()
  expect(
    await readFile(join(source, 'runtime', 'kernel-processes', 'unknown.active.1.json'), 'utf8')
  ).toBe('corrupt receipt')
})

it('moves released data to the current root once and preserves user file contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-science-root-migration-'))
  roots.push(root)
  const source = join(root, 'OpenScience')
  const target = join(root, 'Open-Science')
  const configRoot = join(root, '.open-science')
  await mkdir(join(source, 'workspaces', 'session-1'), { recursive: true })
  await mkdir(configRoot)
  await writeFile(
    join(source, 'workspaces', 'session-1', 'research.txt'),
    'OpenScience is quoted research text'
  )
  const setDataRoot = vi.fn(async () => {})
  const options = {
    currentDataRoot: source,
    configRoot,
    packaged: true,
    setDataRoot,
    logger,
    runtimeScript: 'unused-no-runtime'
  }
  await expect(migrateDataRootBrand(options)).resolves.toBe(target)
  expect(setDataRoot).toHaveBeenCalledExactlyOnceWith(target)
  expect(await readFile(join(target, 'workspaces', 'session-1', 'research.txt'), 'utf8')).toBe(
    'OpenScience is quoted research text'
  )
  expect(existsSync(join(source, 'workspaces'))).toBe(false)
  await expect(migrateDataRootBrand({ ...options, currentDataRoot: target })).resolves.toBe(target)
  expect(setDataRoot).toHaveBeenCalledTimes(1)
})

it('preserves the source and current directory when a destination conflict exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-science-root-conflict-'))
  roots.push(root)
  const source = join(root, 'OpenScience')
  const target = join(root, 'Open-Science')
  const configRoot = join(root, '.open-science')
  await mkdir(join(source, 'workspaces'), { recursive: true })
  await mkdir(target)
  await mkdir(configRoot)
  await writeFile(join(source, 'workspaces', 'original.txt'), 'original')
  await writeFile(join(target, 'unrelated.txt'), 'unrelated')
  const setDataRoot = vi.fn(async () => {})
  await expect(
    migrateDataRootBrand({
      currentDataRoot: source,
      configRoot,
      packaged: true,
      setDataRoot,
      logger,
      runtimeScript: 'unused'
    })
  ).rejects.toThrow()
  expect(setDataRoot).not.toHaveBeenCalled()
  expect(await readFile(join(source, 'workspaces', 'original.txt'), 'utf8')).toBe('original')
  expect(await readFile(join(target, 'unrelated.txt'), 'utf8')).toBe('unrelated')
})
