// Running jobs keep their durable execution paths until they settle; moving a live cwd would break
// polling, PID ownership checks, and output collection. New submissions always persist the new path.
const LEGACY_JOB_MARKER = '/.openscience/jobs/'
const CURRENT_JOB_MARKER = '/.open-science/jobs/'
export const remoteJobMarker = (workdir: string): string | undefined =>
  [CURRENT_JOB_MARKER, LEGACY_JOB_MARKER].find((marker) => workdir.includes(marker))
export const legacyRemoteJobWorkdir = (root: string | undefined, id: string): string =>
  `${root?.trim() || '~'}${LEGACY_JOB_MARKER}${id}`

export const migratedSlurmJobName = (id: string, workdir: string): string =>
  workdir.includes(LEGACY_JOB_MARKER) ? `openscience-${id}` : `open-science-${id}`
