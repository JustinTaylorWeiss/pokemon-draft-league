import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Never shrink past this. Below it the text stops being readable, at which
 * point scrolling is the better answer than a table nobody can read.
 */
const MIN_SCALE = 0.6

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
export function useFitToBox<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null)
  const [scale, setScale] = useState(1)
  // Held in a ref as well so measure() can read it without being re-created.
  const scaleRef = useRef(1)

  const measure = useCallback(() => {
    const box = node?.parentElement
    if (!node || !box) return

    // Read the natural height with zoom off, so the measurement never depends
    // on the scale already applied.
    node.style.zoom = '1'
    const natural = node.getBoundingClientRect().height
    const available = box.clientHeight

    // Scaling rounds row heights up, so dividing by the exact space available
    // lands a few pixels over it and the box scrolls anyway. Aim slightly under.
    const next = natural > available && natural > 0
      ? Math.max(MIN_SCALE, (available - CUSHION) / natural)
      : 1

    node.style.zoom = next === 1 ? '' : String(next)
    if (Math.abs(next - scaleRef.current) > 0.005) {
      scaleRef.current = next
      setScale(next)
    }
  }, [node])

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

  return [setNode, scale]
}
