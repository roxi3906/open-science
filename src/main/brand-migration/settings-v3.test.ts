import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SettingsRepository } from '../settings/repository'
import { buildNotebookNetworkPolicy } from '../../shared/notebook-network'

it('preserves old network exclusions while saving only the new settings fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-science-settings-migration-'))
  try {
    const path = join(root, 'settings.json')
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        providers: [],
        notebookNetwork: {
          allowedDomains: [],
          disabledOpenScienceDomainGroups: ['literature'],
          disabledOpenScienceDomains: ['*.ebi.ac.uk'],
          disabledAppDomainGroups: ['clinical']
        }
      })
    )
    const repository = new SettingsRepository(root)
    const result = await repository.migrateBrandIdentity()
    expect(result.version).toBe(3)
    const policy = buildNotebookNetworkPolicy(result.notebookNetwork!)
    expect(policy.askDomains).toContain('api.crossref.org')
    expect(policy.askDomains).toContain('clinicaltrials.gov')
    expect(policy.askDomains).toContain('*.ebi.ac.uk')
    const saved = await readFile(path, 'utf8')
    expect(saved).not.toContain('disabledOpenScience')
    expect(JSON.parse(saved).notebookNetwork.disabledAppDomainGroups).toEqual([
      'clinical',
      'literature'
    ])
    await repository.migrateBrandIdentity()
    expect(await readFile(path, 'utf8')).toBe(saved)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
