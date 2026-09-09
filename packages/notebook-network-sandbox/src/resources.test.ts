import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const sha256 = (relativePath: string): string =>
  createHash('sha256')
    .update(readFileSync(resolve(packageRoot, relativePath)))
    .digest('hex')

describe('Notebook network sandbox resources', () => {
  it.each([
    [
      'vendor/windows/x64/notebook-appcontainer-host.exe',
      'fc69e24203359726048031f36a285c1718069e6b3f647dfdc716ad8f43ea7249'
    ],
    [
      'vendor/windows/arm64/notebook-appcontainer-host.exe',
      '7919cc95d121e20dbbe50c735f5565f4302b62038a3218d1f0a974eed7e6fff8'
    ]
  ])('verifies %s', (relativePath, expectedHash) => {
    expect(sha256(relativePath)).toBe(expectedHash)
  })
})
