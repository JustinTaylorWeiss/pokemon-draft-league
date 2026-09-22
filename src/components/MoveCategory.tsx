/**
 * What a move does with its power: hits, blasts, or neither.
 *
 * The badge the games use, as closely as it can be made without shipping
 * theirs: a filled tile, wider than tall, one colour per category, the mark
 * and the short name in white inside it. The marks follow the games' own —
 * a burst for Physical, rings for Special, a split oval for Status — but are
 * drawn here, because the games' are Nintendo's artwork.
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
  // Energy radiating rather than landing: a ring around a core, which is
  // the games' rings of a thrown blast with one ring's worth of room.
  Special: {
    key: 'special',
    short: 'SPEC',
    mark: (
      <>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="2.4" fill="currentColor" />
      </>
    ),
  },
  // Nothing struck, something turned over: the games' oval split by an
  // S-curve, one half solid. Straight bars stood here first and read fine
  // but read as nothing in particular — this is the shape the games taught.
  Status: {
    key: 'status',
    short: 'STAT',
    mark: (
      <g transform="translate(8 8) scale(1.26 1) translate(-8 -8)">
        <circle cx="8" cy="8" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 3.45A4.55 4.55 0 0 1 8 12.55 2.275 2.275 0 0 1 8 8 2.275 2.275 0 0 0 8 3.45Z"
          fill="currentColor"
        />
      </g>
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
