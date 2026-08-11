import { useCallback, useEffect, useRef, useState } from 'react'

/** Sensible bounds for the row sprite, whatever the arithmetic asks for. */
const MIN_CELL = 28
/**
 * The type chips across the header are 3.3rem square. The row sprites stop
 * there, so the two runs of icons frame the grid at the same size rather than
 * the sprites outgrowing the labels they sit opposite.
 */
const MAX_CELL = 53
const DEFAULT_CELL = 40
/** Ignore adjustments smaller than this, so a settled layout stays settled. */
const DEAD_ZONE = 1.5

/**
 * Picks a row height that makes a wide table fill its box in both directions.
 *
 * The defensive chart is eighteen columns across, so scaling it to fit is
 * always width-bound and always leaves height unused. Growing the row sprites
 * adds height without adding much width, and the size where the two constraints
 * meet can be solved for rather than searched.
 *
 * With `H` and `W` the table's natural size at the current cell size, `R` rows,
 * and `d` the change in cell size, height scales as `H + R*d` and width as
 * `W + d`. Setting availH/(H + R*d) = availW/(W + d) and solving gives the `d`
 * below. It is solved fresh from a real measurement each time rather than
 * stepped toward, so there is nothing to oscillate.
 */
export function useFillHeight<T extends HTMLElement>(
  rowCount: number,
): [(el: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null)
  const [cell, setCell] = useState(DEFAULT_CELL)
  const cellRef = useRef(DEFAULT_CELL)

  const measure = useCallback(() => {
    // The box that constrains us is the scroll container the fit box sits in.
    const box = node?.parentElement?.parentElement
    if (!node || !box || rowCount < 1) return

    const fit = node.parentElement as HTMLElement
    // Natural size, with any fit scale removed.
    const prevZoom = fit.style.zoom
    fit.style.zoom = '1'
    const rect = node.getBoundingClientRect()
    const naturalH = rect.height
    const naturalW = rect.width
    fit.style.zoom = prevZoom

    const availH = box.clientHeight
    const availW = box.clientWidth
    if (!naturalH || !naturalW || !availH || !availW) return

    const denominator = availH - availW * rowCount
    if (Math.abs(denominator) < 1) return
    const delta = (availW * naturalH - availH * naturalW) / denominator

    const next = Math.max(MIN_CELL, Math.min(MAX_CELL, cellRef.current + delta))
    if (Math.abs(next - cellRef.current) < DEAD_ZONE) return
    cellRef.current = next
    setCell(next)
  }, [node, rowCount])

  useEffect(() => {
    const box = node?.parentElement?.parentElement
    if (!box || typeof ResizeObserver === 'undefined') return
    measure()
    // Only the container: the table's own size is what this hook changes, so
    // watching it would be watching its own output.
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [node, measure])

  return [setNode, Math.round(cell)]
}
