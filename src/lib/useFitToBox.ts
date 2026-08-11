import { useCallback, useEffect, useState } from 'react'

/**
 * Never shrink past this. Below it the text stops being readable, at which
 * point scrolling is the better answer than a table nobody can read.
 */
const MIN_SCALE = 0.6

/**
 * A sanity ceiling only. The slider reads relative to whatever this works out
 * to, so capping low would just mean "100%" quietly failing to fill the card.
 */
const MAX_SCALE = 2.4

/** Pixels of slack left below the fitted content, to absorb that rounding. */
const CUSHION = 4

/**
 * Scales an element down just enough to fit its parent's height, and leaves it
 * alone when it already fits.
 *
 * Used by the two panels that are meant to be taken in at a glance — the draft
 * summary and the defensive type chart. Both are a fixed number of rows decided
 * by the roster, so on a short window they would otherwise be a scrolling box
 * where the whole point is seeing every row at once.
 *
 * Uses `zoom` rather than `transform: scale()` because zoom shrinks the layout
 * box too. A transform only changes what is painted, so the parent would keep
 * reserving the unscaled height and carry on scrolling.
 */
export function useFitToBox<T extends HTMLElement>(
  /**
   * `both` keeps the panel inside the box in both directions, so it never
   * scrolls. `width` fits the width only and lets the container scroll
   * vertically — right for a table whose columns are fixed but whose rows grow
   * with the roster, since shrinking to fit twenty rows would leave the first
   * two unreadable.
   */
  axis: 'both' | 'width' = 'both',
): (el: T | null) => void {
  const [node, setNode] = useState<T | null>(null)

  const measure = useCallback(() => {
    const box = node?.parentElement
    if (!node || !box) return

    // Read the natural size with zoom off, so the measurement never depends on
    // the scale already applied. scrollWidth/Height are the floor: this element
    // is width-constrained and can scroll, so its own box stops growing at the
    // container's edge while the content inside carries on.
    node.style.zoom = '1'
    const rect = node.getBoundingClientRect()
    const naturalH = Math.max(rect.height, node.scrollHeight)
    const naturalW = Math.max(rect.width, node.scrollWidth)

    // A panel with room to spare grows into it rather than stopping at 100%.
    // Scaling rounds sizes up, so aim a few pixels under the space available.
    const byWidth = (box.clientWidth - CUSHION) / naturalW
    const byHeight = (box.clientHeight - CUSHION) / naturalH
    const fitted = naturalH > 0 && naturalW > 0
      ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, axis === 'width' ? byWidth : Math.min(byWidth, byHeight)))
      : 1

    node.style.zoom = fitted === 1 ? '' : String(fitted)
  }, [node, axis])

  useEffect(() => {
    const box = node?.parentElement
    if (!box || typeof ResizeObserver === 'undefined') return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    // The content is watched too, via the child rather than the zoomed element
    // itself: `zoom` does not change a descendant's own layout box, so this
    // sees real content changes without seeing the scale applied above it.
    // Without this, anything that resizes the panel through CSS alone leaves
    // the old scale in place and the panel silently overflows.
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    return () => observer.disconnect()
  }, [node, measure])

  // Content can change height without the container resizing — a different
  // roster, or the type chart's Abilities toggle adding a row of zeroes.
  useEffect(measure)

  return setNode
}
