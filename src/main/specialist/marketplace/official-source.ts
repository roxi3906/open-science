import type { OfficialMarketplaceSourceConfig } from './service'
import { CURRENT_OFFICIAL_SOURCE_ID } from '../../brand-migration/marketplace'

export const OFFICIAL_MARKETPLACE_SOURCE: OfficialMarketplaceSourceConfig = {
  id: CURRENT_OFFICIAL_SOURCE_ID,
  name: 'Open-Science Specialist Marketplace',
  repositoryUrl: 'https://github.com/aipoch/openscience-specialist-marketplace',
  ref: 'published',
  metadataBaseUrls: [
    'https://statics.aipoch.com/open-science/specialist-marketplace/v1/',
    'https://raw.githubusercontent.com/aipoch/openscience-specialist-marketplace/published/'
  ],
  artifactBaseUrls: ['https://statics.aipoch.com/open-science/specialist-marketplace/v1/'],
  trustedKeys: {
    'openscience-marketplace-2026-08':
      'MCowBQYDK2VwAyEAKOudx9NtRJakg0xAQFzVdz/5+T/X/xG0F6pCwUu8SQk='
  }
}
