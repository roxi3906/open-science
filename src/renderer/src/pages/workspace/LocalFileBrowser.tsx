// Local ("This computer") file browser modal. Opened from the Files-panel Artifacts dropdown's
// "This computer" entry. Forked from the remote FileBrowserModal chrome (back/up/refresh, editable
// address bar, Go-to dropdown with a fixed Home + pin/unpin bookmarks) but:
//   - transport is window.api.localFs (node:fs in main), not SSH
//   - opening a file does NOT show an inline detail panel; it opens a standalone preview-workbench
//     tab (source:'local') that renders through the shared preview pipeline with a dedicated header
//   - bookmarks persist under the reserved LOCAL_BOOKMARKS_KEY in the compute bookmark store
import {
  ArrowLeft,
  ArrowUp,
  Bookmark,
  ChevronDown,
  Folder,
  File,
  Home,
  MapPin,
  RefreshCw,
  X
} from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { LocalDirEntry, LocalRoots } from '../../../../shared/local-fs'
import {
  isSensitiveLocalPath,
  LOCAL_BOOKMARKS_KEY,
  resolveLocalPath,
  validateLocalPath
} from '../../../../shared/local-fs'
import { Button } from '@/components/ui/button'
import { dialogOverlayClassName, dialogPanelClassName } from '@/components/ui/dialog-chrome'
import { cn } from '@/lib/utils'
import { usePreviewWorkbenchStore } from '@/stores/preview-workbench-store'

import { createPreviewFileItemFromLocal, LOCAL_PREVIEW_SESSION_ID } from './preview-file-item'

// Formats a byte count as a short human-readable string.
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(1)} GB`
}

// Human-readable relative time from a mtime; empty when unknown (mtimeMs 0).
const relativeTime = (mtimeMs: number): string => {
  if (!mtimeMs) return ''
  const sec = Math.round((Date.now() - mtimeMs) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

// Parent path (removes the last component); returns '/' at the root.
const parentPath = (p: string): string => {
  if (p === '/') return '/'
  const idx = p.replace(/\/$/, '').lastIndexOf('/')
  return idx <= 0 ? '/' : p.slice(0, idx)
}

type BrowserState =
  | { kind: 'loading' }
  | { kind: 'ok'; entries: LocalDirEntry[]; resolvedPath: string; truncated: boolean }
  | { kind: 'error'; detail: string }

// Go-to dropdown: Home is fixed at the top (never removable); pinned folders follow with Unpin (✕).
const GoToMenu = ({
  home,
  bookmarks,
  currentPath,
  isBookmarked,
  onNavigate,
  onPinCurrent,
  onRemoveBookmark
}: {
  home: string | undefined
  bookmarks: string[]
  currentPath: string
  isBookmarked: boolean
  onNavigate: (path: string) => void
  onPinCurrent: () => void
  onRemoveBookmark: (path: string) => void
}): React.JSX.Element => (
  <div
    className="absolute left-0 top-full z-10 mt-1 min-w-[240px] rounded-lg border border-border bg-popover p-1 shadow-md"
    role="listbox"
    aria-label="Go-to locations"
  >
    {home ? (
      <button
        type="button"
        onClick={() => onNavigate(home)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
      >
        <Home className="size-3.5 text-muted-foreground" />
        <span className="flex-1 truncate">Home</span>
      </button>
    ) : null}
    {!isBookmarked && currentPath ? (
      <button
        type="button"
        onClick={onPinCurrent}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
      >
        <Bookmark className="size-3.5 text-muted-foreground" />
        <span className="flex-1 truncate">Pin current folder</span>
      </button>
    ) : null}
    {bookmarks.length > 0 ? (
      <>
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pinned
        </div>
        {bookmarks.map((path) => (
          <div key={path} className="flex items-center rounded hover:bg-accent">
            <button
              type="button"
              onClick={() => onNavigate(path)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"
            >
              <Bookmark className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{path.split('/').pop() || path}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemoveBookmark(path)}
              aria-label={`Unpin ${path}`}
              className="mr-1 rounded p-0.5 text-muted-foreground hover:bg-background"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </>
    ) : null}
  </div>
)

// Directory listing table: dirs first, single-click opens (navigate for dirs, preview tab for files).
const LocalListing = ({
  state,
  onOpenEntry
}: {
  state: BrowserState
  onOpenEntry: (entry: LocalDirEntry) => void
}): React.JSX.Element => {
  if (state.kind === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-destructive">
        {state.detail}
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {state.truncated ? (
        <div className="bg-amber-50 px-4 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          Showing the first entries only — this directory is very large.
        </div>
      ) : null}
      {state.entries.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Empty folder
        </div>
      ) : (
        <ul role="listbox" aria-label="Directory contents">
          {state.entries.map((entry) => (
            <li key={entry.name}>
              <button
                type="button"
                onClick={() => onOpenEntry(entry)}
                className="grid w-full grid-cols-[1fr_80px_64px] items-center gap-2 px-4 py-1.5 text-left text-[13px] hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {entry.isDirectory ? (
                    <Folder className="size-4 shrink-0 text-sky-500" />
                  ) : (
                    <File className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {entry.isDirectory ? '' : formatSize(entry.size)}
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {relativeTime(entry.mtimeMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const LocalFileBrowser = ({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element => {
  const [roots, setRoots] = useState<LocalRoots | null>(null)
  const [cwd, setCwd] = useState('')
  const [state, setState] = useState<BrowserState>({ kind: 'loading' })
  const [history, setHistory] = useState<string[]>([])
  const [addressInput, setAddressInput] = useState('')
  const [addressEditing, setAddressEditing] = useState(false)
  const [bookmarks, setBookmarks] = useState<string[]>([])
  const [gotoOpen, setGotoOpen] = useState(false)
  const upsertAndActivateItem = usePreviewWorkbenchStore((s) => s.upsertAndActivateItem)
  // Mirrors cwd so navigate() can read the previous location without depending on it (keeps the
  // callback identity stable) and without side effects inside a state updater (StrictMode-safe).
  const cwdRef = useRef('')

  // Loads one directory; pushes the previous cwd onto history unless replacing (back/refresh).
  const navigate = useCallback(async (target: string, pushHistory = true): Promise<void> => {
    setState({ kind: 'loading' })
    try {
      const listing = await window.api.localFs.listDir(target)
      const previous = cwdRef.current
      if (pushHistory && previous && previous !== listing.resolvedPath) {
        setHistory((h) => [...h, previous])
      }
      cwdRef.current = listing.resolvedPath
      setState({
        kind: 'ok',
        entries: listing.entries,
        resolvedPath: listing.resolvedPath,
        truncated: listing.truncated
      })
      setCwd(listing.resolvedPath)
      setAddressInput(listing.resolvedPath)
    } catch (err) {
      setState({ kind: 'error', detail: (err as Error).message ?? 'Failed to list directory.' })
    }
  }, [])

  // On open: fetch roots + bookmarks, then land in Home.
  useEffect(() => {
    if (!open) return
    void (async () => {
      const [fetchedRoots, fetchedBookmarks] = await Promise.all([
        window.api.localFs.getRoots(),
        window.api.compute.bookmarksGet(LOCAL_BOOKMARKS_KEY)
      ])
      setRoots(fetchedRoots)
      setBookmarks(fetchedBookmarks)
      setHistory([])
      cwdRef.current = ''
      await navigate(fetchedRoots.home, false)
    })()
  }, [open, navigate])

  const listing = state.kind === 'ok' ? state : null
  const currentPath = listing?.resolvedPath ?? cwd
  const isAtRoot = currentPath === '/'

  const handleBack = (): void => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    void navigate(prev, false)
  }

  const handleAddressSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const resolved = resolveLocalPath(currentPath, addressInput.trim())
    if (validateLocalPath(resolved)) {
      setState({
        kind: 'error',
        detail: 'Path must be absolute and contain no control characters.'
      })
      return
    }
    setAddressEditing(false)
    void navigate(resolved)
  }

  // Directory → navigate in; file → open a preview-workbench tab. Sensitive paths (credential dirs
  // like .ssh, private keys, dotenv files) warn first, whether entering or opening.
  const handleOpenEntry = (entry: LocalDirEntry): void => {
    const path = `${currentPath.replace(/\/$/, '')}/${entry.name}`
    if (isSensitiveLocalPath(path)) {
      const prompt = entry.isDirectory
        ? `"${entry.name}" may contain credentials or secrets. Open this folder anyway?`
        : `"${entry.name}" may contain credentials or secrets. Open it anyway?`
      if (!window.confirm(prompt)) return
    }
    if (entry.isDirectory) {
      void navigate(path)
      return
    }
    upsertAndActivateItem(
      createPreviewFileItemFromLocal({
        sessionId: LOCAL_PREVIEW_SESSION_ID,
        path,
        name: entry.name,
        size: entry.size,
        mtimeMs: entry.mtimeMs
      })
    )
    onClose()
  }

  const isBookmarked = bookmarks.includes(currentPath)

  const handleToggleBookmark = async (): Promise<void> => {
    const next = isBookmarked
      ? bookmarks.filter((b) => b !== currentPath)
      : [...bookmarks, currentPath]
    setBookmarks(next)
    await window.api.compute.bookmarksSet(LOCAL_BOOKMARKS_KEY, next)
  }

  const handleRemoveBookmark = async (path: string): Promise<void> => {
    const next = bookmarks.filter((b) => b !== path)
    setBookmarks(next)
    await window.api.compute.bookmarksSet(LOCAL_BOOKMARKS_KEY, next)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={cn(dialogOverlayClassName, 'z-[70]')} />
        <Dialog.Content
          className={dialogPanelClassName(
            'z-[70] flex w-[min(860px,calc(100vw-2rem))] h-[min(600px,calc(100vh-4rem))] flex-col overflow-hidden p-0'
          )}
          aria-label="Local file browser"
        >
          {/* Header: machine chip + close */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              This computer
            </span>
            {roots ? (
              <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {roots.machineName}
              </span>
            ) : null}
            <div className="flex-1" />
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close file browser">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          {/* Toolbar */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={history.length === 0}
              onClick={handleBack}
              aria-label="Go back"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isAtRoot}
              onClick={() => void navigate(parentPath(currentPath))}
              aria-label="Go up one level"
            >
              <ArrowUp className="size-4" />
            </Button>

            {/* Go-to dropdown: fixed Home + pinned bookmarks */}
            <div className="relative">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setGotoOpen(!gotoOpen)}
                aria-haspopup="listbox"
                aria-expanded={gotoOpen}
              >
                <MapPin className="size-3.5" />
                Go to
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
              {gotoOpen ? (
                <GoToMenu
                  home={roots?.home}
                  bookmarks={bookmarks}
                  currentPath={currentPath}
                  isBookmarked={isBookmarked}
                  onNavigate={(path) => {
                    setGotoOpen(false)
                    void navigate(path)
                  }}
                  onPinCurrent={() => {
                    setGotoOpen(false)
                    void handleToggleBookmark()
                  }}
                  onRemoveBookmark={(path) => void handleRemoveBookmark(path)}
                />
              ) : null}
            </div>

            {/* Editable address bar */}
            <form onSubmit={handleAddressSubmit} className="flex-1">
              {addressEditing ? (
                <input
                  autoFocus
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  onBlur={handleAddressSubmit}
                  className="w-full rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/50"
                  aria-label="Directory path"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddressEditing(true)}
                  className="flex w-full items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-left font-mono text-xs text-foreground hover:bg-muted/70"
                >
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{currentPath || '…'}</span>
                </button>
              )}
            </form>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void navigate(currentPath, false)}
              aria-label="Refresh directory"
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void handleToggleBookmark()}
              aria-label={isBookmarked ? 'Remove bookmark' : 'Pin this folder'}
            >
              <Bookmark className={cn('size-4', isBookmarked && 'fill-current text-primary')} />
            </Button>
          </div>

          {/* Listing */}
          <LocalListing state={state} onOpenEntry={handleOpenEntry} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
