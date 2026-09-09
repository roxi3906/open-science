import { describe, expect, it } from 'vitest'

import { parseRemoteJobHandle, parseRemoteJobWorkdir } from './remote-job-handle'

const workdir = '~/.open-science/jobs/job-1'
const handle = {
  pid: 42,
  workdir,
  exit_code_path: `${workdir}/exit_code`,
  stdout_path: `${workdir}/stdout`,
  stderr_path: `${workdir}/stderr`
}

describe('remote Job handle validation', () => {
  it('returns a complete handle whose pid, workdir, and derived paths are safe', () => {
    expect(parseRemoteJobHandle(JSON.stringify(handle), workdir)).toEqual(handle)
  })

  it.each([
    undefined,
    '{bad json',
    JSON.stringify({ ...handle, pid: 1 }),
    JSON.stringify({ ...handle, pid: Number.MAX_SAFE_INTEGER + 1 }),
    JSON.stringify({ ...handle, workdir: '/other' }),
    JSON.stringify({ ...handle, exit_code_path: '/other/exit_code' }),
    JSON.stringify({ ...handle, stdout_path: '/other/stdout' }),
    JSON.stringify({ ...handle, stderr_path: '/other/stderr' })
  ])('rejects an incomplete or unsafe persisted handle', (raw) => {
    expect(parseRemoteJobHandle(raw, workdir)).toBeNull()
  })

  it.each([workdir, '~/.openscience/jobs/job-1'])(
    'preserves current and legacy persisted workdirs scoped to the safe Job id: %s',
    (persistedWorkdir) => {
      expect(parseRemoteJobWorkdir('job-1', persistedWorkdir)).toBe(persistedWorkdir)
      expect(parseRemoteJobWorkdir('job-1', undefined, persistedWorkdir)).toBe(persistedWorkdir)
      const persistedHandle = {
        pid: 42,
        workdir: persistedWorkdir,
        exit_code_path: `${persistedWorkdir}/exit_code`,
        stdout_path: `${persistedWorkdir}/stdout`,
        stderr_path: `${persistedWorkdir}/stderr`
      }
      expect(parseRemoteJobHandle(JSON.stringify(persistedHandle), persistedWorkdir)).toEqual(
        persistedHandle
      )
    }
  )

  it.each([
    ['job/1', workdir],
    ['job-1', '/scratch/unrelated'],
    ['job-1', '/scratch/../.open-science/jobs/job-1'],
    ['job-1', '/scratch/.open-science/jobs/job-1\nunsafe']
  ])('rejects an unsafe Job id or remote workdir', (jobId, raw) => {
    expect(parseRemoteJobWorkdir(jobId, raw)).toBeNull()
  })
})
