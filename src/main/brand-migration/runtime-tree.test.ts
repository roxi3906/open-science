import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { preserveRuntimeTree } from './runtime-tree'

let root: string
let source: string
let target: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-science-runtime-links-'))
  source = join(root, 'OpenScience')
  target = join(root, 'Open-Science')
  await mkdir(join(source, 'runtime'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('runtime links during data-root migration', () => {
  it('keeps internal absolute links usable after the original root is removed', async () => {
    await mkdir(join(source, 'runtime', 'store'))
    await writeFile(join(source, 'runtime', 'store', 'value'), 'preserved runtime data')
    await symlink(join(source, 'runtime', 'store'), join(source, 'runtime', 'current'))
    await preserveRuntimeTree(source, target, 'unused-without-conda-prefixes')
    await rm(source, { recursive: true })
    expect(await readFile(join(target, 'runtime', 'current', 'value'), 'utf8')).toBe(
      'preserved runtime data'
    )
  })

  it('refuses links escaping the owned runtime tree and preserves the source', async () => {
    const outside = join(root, 'external-user-file')
    await writeFile(outside, 'user content')
    await symlink(outside, join(source, 'runtime', 'external'))
    await expect(
      preserveRuntimeTree(source, target, 'unused-without-conda-prefixes')
    ).rejects.toThrow(/link.*outside/i)
    expect(await readFile(join(source, 'runtime', 'external'), 'utf8')).toBe('user content')
  })
})
