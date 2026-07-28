import { describe, expect, it } from 'vitest'

import {
  isSensitiveLocalPath,
  resolveLocalPath,
  sortLocalEntries,
  validateLocalPath,
  type LocalDirEntry
} from './local-fs'

describe('validateLocalPath', () => {
  it('accepts absolute paths', () => {
    expect(validateLocalPath('/Users/roxi/Documents')).toBeUndefined()
    expect(validateLocalPath('/')).toBeUndefined()
  })

  it('rejects non-absolute or empty input', () => {
    expect(validateLocalPath('relative/path')).toBe('not_absolute')
    expect(validateLocalPath('')).toBe('not_absolute')
    // @ts-expect-error runtime guard for non-string IPC input
    expect(validateLocalPath(undefined)).toBe('not_absolute')
  })

  it('rejects paths with control characters', () => {
    expect(validateLocalPath('/Users/roxi/\x00evil')).toBe('control_chars')
    expect(validateLocalPath('/Users/roxi/\x1ffile')).toBe('control_chars')
  })
})

describe('isSensitiveLocalPath', () => {
  it('flags credential dirs and files', () => {
    expect(isSensitiveLocalPath('/Users/roxi/.ssh')).toBe(true)
    expect(isSensitiveLocalPath('/Users/roxi/project/.env')).toBe(true)
    expect(isSensitiveLocalPath('/Users/roxi/.env.local')).toBe(true)
    expect(isSensitiveLocalPath('/etc/ssl/private/server.key')).toBe(true)
    expect(isSensitiveLocalPath('/Users/roxi/cert.pem')).toBe(true)
  })

  it('flags suffix-less secret files (SSH keys, cloud credentials)', () => {
    expect(isSensitiveLocalPath('/Users/roxi/.ssh/id_rsa')).toBe(true)
    expect(isSensitiveLocalPath('/Users/roxi/.ssh/id_ed25519')).toBe(true)
    expect(isSensitiveLocalPath('/Users/roxi/.aws/credentials')).toBe(true)
    expect(isSensitiveLocalPath('/Users/roxi/.pgpass')).toBe(true)
    expect(isSensitiveLocalPath('/Users/roxi/keystore.p12')).toBe(true)
    // case-insensitive on the basename
    expect(isSensitiveLocalPath('/Users/roxi/.ssh/ID_RSA')).toBe(true)
  })

  it('does not flag lookalikes that are not secrets', () => {
    expect(isSensitiveLocalPath('/Users/roxi/.ssh/id_rsa.pub')).toBe(false)
    expect(isSensitiveLocalPath('/Users/roxi/credentials.md')).toBe(false)
  })

  it('treats ordinary files as non-sensitive', () => {
    expect(isSensitiveLocalPath('/Users/roxi/Documents/notes.md')).toBe(false)
    expect(isSensitiveLocalPath('/Users/roxi/data.csv')).toBe(false)
    expect(isSensitiveLocalPath('/')).toBe(false)
  })
})

describe('sortLocalEntries', () => {
  it('orders directories first, then case-insensitive alphabetical', () => {
    const entries: LocalDirEntry[] = [
      { name: 'zebra.txt', isDirectory: false, size: 1, mtimeMs: 0 },
      { name: 'Apple', isDirectory: true, size: 0, mtimeMs: 0 },
      { name: 'banana.md', isDirectory: false, size: 2, mtimeMs: 0 },
      { name: 'apricot', isDirectory: true, size: 0, mtimeMs: 0 }
    ]
    expect(sortLocalEntries(entries).map((e) => e.name)).toEqual([
      'Apple',
      'apricot',
      'banana.md',
      'zebra.txt'
    ])
  })

  it('does not mutate the input array', () => {
    const entries: LocalDirEntry[] = [
      { name: 'b', isDirectory: false, size: 0, mtimeMs: 0 },
      { name: 'a', isDirectory: false, size: 0, mtimeMs: 0 }
    ]
    sortLocalEntries(entries)
    expect(entries.map((e) => e.name)).toEqual(['b', 'a'])
  })
})

describe('resolveLocalPath', () => {
  it('returns absolute input unchanged', () => {
    expect(resolveLocalPath('/Users/roxi', '/etc/hosts')).toBe('/etc/hosts')
  })

  it('joins relative input onto cwd', () => {
    expect(resolveLocalPath('/Users/roxi', 'Documents')).toBe('/Users/roxi/Documents')
    expect(resolveLocalPath('/Users/roxi/', 'Documents')).toBe('/Users/roxi/Documents')
    expect(resolveLocalPath('/', 'etc')).toBe('/etc')
  })

  it('returns cwd for empty input', () => {
    expect(resolveLocalPath('/Users/roxi', '')).toBe('/Users/roxi')
  })
})
