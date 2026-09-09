// Frozen ownership signatures from released launchers. Read only: new launchers and receipts
// always use the current spelling. Exact signatures preserve the unmanaged-file safety boundary.
export const LEGACY_LAUNCHER_HEADER =
  'Open Science command-line launcher. Managed by the app. Format version: 1.'
export const LEGACY_POSIX_HEADER =
  '# Open Science command-line launcher. Managed by the app (Settings -> General -> Command line'
export const LEGACY_POSIX_BODIES = new Set([
  "# tool); edits will be overwritten on reinstall. Runs the app's Electron in Node mode.",
  '# tool); edits will be overwritten on reinstall. Mounts the AppImage for this CLI process.'
])
export const LEGACY_WINDOWS_HEADER =
  'rem Open Science command-line launcher. Managed by the app; edits are overwritten on reinstall.'
export const LEGACY_WINDOWS_PATH_OWNER = 'Open Science Windows PATH entry. Managed by the app.'
