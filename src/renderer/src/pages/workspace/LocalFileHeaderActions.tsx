// Action cluster shown in the preview header for local ("This computer") files, replacing the
// artifact/upload "Download" button. Local files already live on disk, so the actions are
// filesystem-oriented: Reveal in Finder (primary) + a "…" menu (Reveal / Copy path / Open with
// default app). Kept in its own module so PreviewFileSurface stays source-neutral.
import { Check, ClipboardCopy, ExternalLink, FolderOpen, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Primary labeled action for the "Preview unavailable" fallback of a local file: opening it in its
// default OS app is the local analogue of the artifact/upload "Download" affordance.
export const LocalFileFallbackAction = ({
  path,
  className
}: {
  path: string
  className?: string
}): React.JSX.Element => (
  <Button
    type="button"
    variant="default"
    size="sm"
    className={className}
    onClick={() => void window.api.localFs.openPath(path)}
  >
    <ExternalLink className="size-4" aria-hidden="true" />
    <span>Open</span>
  </Button>
)

export const LocalFileHeaderActions = ({
  path,
  tooltipClassName
}: {
  path: string
  tooltipClassName?: string
}): React.JSX.Element => {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Clear any pending "Copied" reset when the header unmounts (tab closed within the 1.5s window).
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const reveal = (): void => {
    void window.api.localFs.reveal(path)
  }
  const copyPath = async (): Promise<void> => {
    await navigator.clipboard.writeText(path)
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1500)
  }
  const openWithDefault = (): void => {
    void window.api.localFs.openPath(path)
  }

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-text-100 hover:text-text-000"
              aria-label="Reveal in Finder"
              onClick={reveal}
            >
              <FolderOpen aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className={tooltipClassName}>Reveal in Finder</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-text-100 hover:text-text-000"
            aria-label="More actions"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={reveal} className="gap-2">
            <FolderOpen className="size-4" aria-hidden="true" />
            Reveal in Finder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyPath()} className="gap-2">
            {copied ? (
              <Check className="size-4 text-emerald-500" aria-hidden="true" />
            ) : (
              <ClipboardCopy className="size-4" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy path'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openWithDefault} className="gap-2">
            <ExternalLink className="size-4" aria-hidden="true" />
            Open with default app
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
