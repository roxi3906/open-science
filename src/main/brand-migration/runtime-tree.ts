import { RuntimeOperationJournal, operationJournalPath } from '../notebook/operation-journal'
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  unlink
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const execute = promisify(execFile)

async function relocateRuntimeLinks(source: string, target: string): Promise<void> {
  const links: string[] = []
  const sourceRoots = [resolve(source), await realpath(source)]
  const targetRoot = await realpath(target)
  const within = (root: string, path: string): boolean => {
    const suffix = relative(root, path)
    return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
  }
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isSymbolicLink()) links.push(path)
    }
  }
  await visit(target)
  // Rewrite every owned absolute link before resolving link chains. Never follow a copied link
  // during traversal, and leave the original tree untouched if any target cannot be verified.
  for (const path of links) {
    const value = await readlink(path)
    if (!isAbsolute(value)) continue
    const sourceRoot = sourceRoots.find((root) => within(root, value))
    if (!sourceRoot) continue
    const destination = resolve(target, relative(sourceRoot, value))
    const directory = (await stat(value)).isDirectory()
    await unlink(path)
    await symlink(relative(dirname(path), destination), path, directory ? 'junction' : 'file')
  }
  for (const path of links) {
    if (!within(targetRoot, await realpath(path)))
      throw new Error('A runtime link points outside the migrated runtime tree.')
  }
}

export async function preserveRuntimeTree(
  from: string,
  to: string,
  script: string,
  pythonOverride?: string
): Promise<void> {
  const source = join(from, 'runtime')
  const target = join(to, 'runtime')
  if (!existsSync(source)) return
  const state = await new RuntimeOperationJournal(operationJournalPath(source)).readState()
  if (state === 'corrupt' || state.records.length)
    throw new Error('An unfinished runtime operation must be recovered before migration.')
  const prefixes: string[] = []
  const inspect = async (directory: string): Promise<void> => {
    const state = await lstat(directory)
    if (!state.isDirectory() || state.isSymbolicLink())
      throw new Error('Runtime root is not a direct directory.')
    if (existsSync(join(directory, 'conda-meta', 'history'))) {
      prefixes.push(directory)
      return
    }
    if (existsSync(join(directory, 'bin', 'python')) || existsSync(join(directory, 'python.exe'))) {
      throw new Error('A materialized runtime has no verified conda metadata.')
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'pkgs') await inspect(join(directory, entry.name))
    }
  }
  await inspect(source)
  const python =
    pythonOverride ??
    prefixes
      .flatMap((prefix) => [join(prefix, 'bin', 'python'), join(prefix, 'python.exe')])
      .find(existsSync)
  if (prefixes.length && !python)
    throw new Error(
      'Runtime migration requires the managed Python interpreter; the original environments were preserved.'
    )
  await mkdir(target, { recursive: true })
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: false,
    verbatimSymlinks: true,
    filter: (path) => !prefixes.some((prefix) => path === prefix || path.startsWith(prefix + sep))
  })
  for (const prefix of prefixes) {
    const destination = resolve(target, relative(source, prefix))
    await mkdir(dirname(destination), { recursive: true })
    await execute(python!, ['-I', '-S', '-B', script, prefix, destination], {
      timeout: 15 * 60_000,
      maxBuffer: 1_048_576,
      windowsHide: true
    })
    const migratedPython = [
      join(destination, 'bin', 'python'),
      join(destination, 'python.exe')
    ].find(existsSync)
    if (migratedPython) {
      // Copy verification cannot detect a loader/signature failure. Check in a fresh process before
      // committing the data-root pointer, with site hooks disabled and no bytecode writes.
      await execute(
        migratedPython,
        [
          '-I',
          '-S',
          '-B',
          '-c',
          'import os, sys, ssl, sqlite3, ctypes; assert os.path.realpath(sys.prefix) == os.path.realpath(sys.argv[1])',
          destination
        ],
        { timeout: 30_000, maxBuffer: 1_048_576, windowsHide: true }
      )
    }
  }
  await relocateRuntimeLinks(source, target)
}
