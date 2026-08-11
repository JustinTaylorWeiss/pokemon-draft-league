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
   * The card's zoom slider, relative to the fitted size: 1 means "as large as
   * fits". The fitted size is the baseline the reader sees as 100%, because the
   * raw scale it works out to is an implementation detail — a panel reading
   * 114% because that is what filled the card is a number nobody asked for.
   */
  multiplier = 1,
): (el: T | null) => void {
  const [node, setNode] = useState<T | null>(null)

  const measure = useCallback(() => {
    const box = node?.parentElement
    if (!node || !box) return

    // Read the natural size with zoom off, so the measurement never depends on
    // the scale already applied.
    node.style.zoom = '1'
    const rect = node.getBoundingClientRect()
    const naturalH = rect.height
    const naturalW = rect.width

    // Fit means fit, in both directions and in both senses: a panel with room
    // to spare grows into it rather than stopping at 100%. Zoom scales width
    // too, so a table that would run past the card's edge is what caps it.
    // Scaling rounds sizes up, so aim a few pixels under the space available.
    const fitted = naturalH > 0 && naturalW > 0
      ? Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min(
          (box.clientHeight - CUSHION) / naturalH,
          (box.clientWidth - CUSHION) / naturalW,
        )),
      )
      : 1

    // Anything above 1 on the slider scales past the fitted size and lets the
    // panel scroll, which is the point of being able to zoom in.
    const applied = fitted * multiplier
    node.style.zoom = applied === 1 ? '' : String(applied)
  }, [node, multiplier])

  useEffect(() => {
    const box = node?.parentElement
    if (!box || typeof ResizeObserver === 'undefined') return
    measure()
    // Only the container is observed. Watching the content itself would see the
    // zoom this hook applies and feed back into another measurement.
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [node, measure])

  // Content can change height without the container resizing — a different
  // roster, or the type chart's Abilities toggle adding a row of zeroes.
  useEffect(measure)

  return setNode
}
