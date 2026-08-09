import { useEffect, useState } from 'react'

/**
 * Live height of an element, tracked through content changes.
 *
 * Used to cap one card at the height of the column beside it: flexbox can grow
 * a short item to match its row but cannot shrink a tall one, so the number has
 * to be measured.
 *
 * Returns a callback ref rather than taking a RefObject because the measured
 * element mounts later than this hook — the results view only renders once both
 * teams are loaded, and an effect keyed on a ref object would have already run
 * and found nothing.
 */
export function useElementHeight<T extends HTMLElement>(): [(el: T | null) => void, number | null] {
  const [node, setNode] = useState<T | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setHeight(Math.round(entry.contentRect.height))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return [setNode, height]
}
