import { useEffect, useState } from 'react'

/**
 * How many items to mount in the first paint. The rest follow over the next
 * few frames.
 *
 * A full movepool is 200+ table rows, and a team's learned-moves grid is 300+
 * cards holding 800 sprites. Mounting either in one go is a single long task:
 * measured on a 6x-throttled CPU, opening Mew took 1.6s against 0.6s for a
 * 63-move Pokémon, and switching to Learned Moves took ~900ms. Splitting the
 * work does not make it smaller, but it keeps any one frame cheap, so the panel
 * appears immediately and stays responsive while the tail fills in.
 */
const CHUNK = 60

/**
 * Returns how many items of a long list to render right now, adding a fixed
 * chunk each frame until all of them are mounted. Pass `resetKey` so switching
 * to a different subject starts over rather than dumping the whole new list at
 * once.
 *
 * The step is deliberately constant. Doubling reaches the end in fewer frames
 * but makes each one bigger than the last, and the final frame is then the
 * worst single stall in the sequence — mounting the tail of a 310-card grid in
 * one go measured as a 1.2s task where the constant step keeps every frame at
 * roughly the cost of the first.
 */
export function useProgressiveList(total: number, resetKey?: unknown): number {
  const [limit, setLimit] = useState(CHUNK)

  useEffect(() => { setLimit(CHUNK) }, [resetKey])

  useEffect(() => {
    if (limit >= total) return
    const id = requestAnimationFrame(() => setLimit((n) => n + CHUNK))
    return () => cancelAnimationFrame(id)
  }, [limit, total])

  return limit
}
