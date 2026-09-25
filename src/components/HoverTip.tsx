import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A card floated over whatever the reader is pointing at.
 *
 * The browser's own `title` can hold a list, but it renders it as a wall of
 * plain text after a second's delay, in a box no stylesheet can reach — no
 * columns, no emphasis on the moves a Pokémon actually runs. This is the same
 * information with the shape left in.
 *
 * Rendered through a portal onto `body` rather than beside its anchor,
 * because every panel that would use one sits inside a scrollport
 * (`.widget-body` scrolls on x), and a box positioned inside a scrollport is
 * clipped by it. On `body` there is nothing to clip it, and `position: fixed`
 * against the anchor's viewport rect puts it in the right place anyway.
 */
export function HoverTip({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  // Measured, not guessed: the card's height decides whether it fits above the
  // anchor, and its width decides how far the centre has to move to keep it on
  // screen. In a layout effect so the reader never sees the unplaced frame.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 8
    const above = rect.top - height - gap
    setAt({
      top: above >= gap ? above : rect.bottom + gap,
      left: Math.min(Math.max(rect.left + rect.width / 2 - width / 2, gap), innerWidth - width - gap),
    })
  }, [rect])

  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className={`hover-tip${at ? '' : ' is-placing'}`}
      style={at ?? undefined}
    >
      {children}
    </div>,
    document.body,
  )
}
