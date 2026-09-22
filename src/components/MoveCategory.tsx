/**
 * What a move does with its power: hits, blasts, or neither.
 *
 * The badge the games use, as closely as it can be made without shipping
 * theirs: a filled tile, wider than tall, one colour per category, the mark
 * and the short name in white inside it. The marks are drawn here — a burst
 * for Physical, a trail of spheres for Special, bars for Status — because the
 * games' are Nintendo's artwork.
 *
 * "Phys", "Spec" and "Stat" were the whole of it before, three grey
 * abbreviations of near-identical length that a two-hundred-row movepool made
 * you read one at a time. The colour is what is actually scanned now; the
 * word is there for anyone reading a single row, and the full name is on the
 * element for anyone who cannot see either.
 */
export type Category = 'Physical' | 'Special' | 'Status'

const MARKS: Record<Category, { key: string; short: string; mark: React.ReactNode }> = {
  // A blow landing: four points struck out from a centre, sides drawn in so
  // it reads as an impact rather than a star.
  Physical: {
    key: 'physical',
    short: 'PHYS',
    mark: (
      <path
        d="M8 0.6C8.9 4.5 11.5 7.1 15.4 8 11.5 8.9 8.9 11.5 8 15.4 7.1 11.5 4.5 8.9 0.6 8 4.5 7.1 7.1 4.5 8 0.6Z"
        fill="currentColor"
      />
    ),
  },
  // Energy thrown rather than landed: three spheres trailing off, each
  // smaller than the last.
  Special: {
    key: 'special',
    short: 'SPEC',
    mark: (
      <>
        <circle cx="4.8" cy="11" r="3.5" fill="currentColor" />
        <circle cx="10.4" cy="7" r="2.5" fill="currentColor" />
        <circle cx="13.8" cy="3.8" r="1.7" fill="currentColor" />
      </>
    ),
  },
  // Nothing struck, numbers moved: three bars off one baseline, rising.
  // Curves were tried first and lost — a turning arrow read as the letter C,
  // a swirl as a blot — because eleven pixels cannot hold a curve's gap open.
  Status: {
    key: 'status',
    short: 'STAT',
    mark: (
      <>
        <rect x="1.4" y="9.6" width="3.4" height="4.8" fill="currentColor" />
        <rect x="6.3" y="6.6" width="3.4" height="7.8" fill="currentColor" />
        <rect x="11.2" y="3.6" width="3.4" height="10.8" fill="currentColor" />
      </>
    ),
  },
}

export function MoveCategory({ category }: { category: string }) {
  const m = MARKS[category as Category]
  if (!m) return <span className="move-cat-text">{category}</span>
  return (
    <span className={`move-cat cat-${m.key}`} title={category}>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">{m.mark}</svg>
      <span aria-hidden="true">{m.short}</span>
      <span className="sr-only">{category}</span>
    </span>
  )
}
