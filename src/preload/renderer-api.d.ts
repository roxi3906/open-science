import type { AppApi } from '../shared/renderer-contract-catalog'

declare global {
  interface Window {
    api: AppApi
  }
}

export {}
