import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  legacyWindowsOwnershipRoot,
  retireLegacyWindowsOwnership
} from '../runtime/src/platform/windows-ownership-migration.js'

const installationId = '0123456789abcdef01234567'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const fixture = async (): Promise<{ current: string; legacy: string }> => {
  const base = await mkdtemp(join(tmpdir(), 'sandbox-brand-'))
  roots.push(base)
  const current = join(base, 'Aipoch', 'Open-Science', 'notebook-sandbox', installationId)
  const legacy = join(base, 'Aipoch', 'OpenScience', 'notebook-sandbox', installationId)
  return { current, legacy }
}

it('derives only the matching installation directory and preserves unrelated path components', () => {
  expect(
    legacyWindowsOwnershipRoot(
      `C:\\Open-Science\\Aipoch\\Open-Science\\notebook-sandbox\\${installationId}`,
      installationId
    )
  ).toBe(`C:\\Open-Science\\Aipoch\\OpenScience\\notebook-sandbox\\${installationId}`)
  expect(
    legacyWindowsOwnershipRoot(`C:\\Open-Science\\other\\${installationId}`, installationId)
  ).toBeUndefined()
  expect(
    legacyWindowsOwnershipRoot(`C:\\Open-Science\\notebook-sandbox\\${installationId}`, 'different')
  ).toBeUndefined()
})

it('passes an existing receipt directory to owned-resource removal without rewriting its evidence', async () => {
  const { current, legacy } = await fixture()
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, 'receipt.json'), 'original signed ownership evidence')
  const result = await retireLegacyWindowsOwnership(current, installationId, async (root) => {
    expect(root).toBe(legacy)
    expect(await readFile(join(root, 'receipt.json'), 'utf8')).toBe(
      'original signed ownership evidence'
    )
    return { cancelled: true }
  })
  expect(result.cancelled).toBe(true)
  expect(await readFile(join(legacy, 'receipt.json'), 'utf8')).toBe(
    'original signed ownership evidence'
  )
})

it('skips an absent legacy installation without invoking removal', async () => {
  const { current } = await fixture()
  await expect(
    retireLegacyWindowsOwnership(current, installationId, async () => {
      throw new Error('unexpected removal')
    })
  ).resolves.toEqual({ cancelled: false })
})

it('rejects symbolic ownership directories and propagates failed native verification', async () => {
  const { current, legacy } = await fixture()
  await mkdir(join(legacy, '..'), { recursive: true })
  await symlink(tmpdir(), legacy, 'dir')
  await expect(
    retireLegacyWindowsOwnership(current, installationId, async () => {
      throw new Error('unexpected removal')
    })
  ).rejects.toThrow('real directory')
  await rm(legacy)
  await mkdir(legacy)
  await writeFile(join(legacy, 'receipt.json'), 'invalid ownership')
  await expect(
    retireLegacyWindowsOwnership(current, installationId, async () => {
      throw new Error('ownership mismatch')
    })
  ).rejects.toThrow('ownership mismatch')
})
