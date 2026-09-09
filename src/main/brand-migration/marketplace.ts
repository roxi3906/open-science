export const CURRENT_OFFICIAL_SOURCE_ID = 'open-science-official'
export const LEGACY_OFFICIAL_SOURCE_ID = 'openscience-official'
export const currentMarketplaceSourceId = (id: string): string =>
  id === LEGACY_OFFICIAL_SOURCE_ID ? CURRENT_OFFICIAL_SOURCE_ID : id
