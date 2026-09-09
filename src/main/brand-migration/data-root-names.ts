import { basename } from 'node:path'
export const legacyDataFolderName = (packaged: boolean): string =>
  packaged ? 'OpenScience' : 'OpenScience-DEV'
export const isLegacyDataRoot = (path: string, packaged: boolean): boolean => {
  const name = basename(path)
  const previous = legacyDataFolderName(packaged)
  return process.platform === 'win32'
    ? name.toLowerCase() === previous.toLowerCase()
    : name === previous
}
