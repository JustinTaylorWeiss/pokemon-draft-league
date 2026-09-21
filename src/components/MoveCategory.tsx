/**
 * What a move does with its power: hits, blasts, or neither.
 *
 * The three categories are the thing you scan a movepool for, and as "Phys",
 * "Spec" and "Stat" they were three grey words of near-identical length that
 * had to be read one at a time. A shape and a colour are told apart at a
 * glance, which is what a column of two hundred rows needs.
 *
 * Shaped like the badges the games use — a small filled tile, a white mark
 * inside it, one colour each — but drawn here rather than shipped: theirs are
 * Nintendo's artwork. The marks are this site's own hand: a struck point for
 * Physical, a core in a ring for Special, a turn back on itself for Status.
 * Each carries the category's name as text for anyone who cannot see it.
 */
export type Category = 'Physical' | 'Special' | 'Status'

const SHAPES: Record<Category, { key: string; path: React.ReactNode }> = {
  // A blow landing: four spikes struck out from a solid centre.
  Physical: {
    key: 'physical',
    path: (
      <>
        <path d="M8 1.5 9.6 6 14.5 8 9.6 10 8 14.5 6.4 10 1.5 8 6.4 6Z" fill="currentColor" />
      </>
    ),
  },
  // Energy held rather than thrown: a core inside a ring. Two arcs read as a
  // crescent at the size a table row gives it; a closed ring does not.
  Special: {
    key: 'special',
    path: (
      <>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="2.4" fill="currentColor" />
      </>
    ),
  },
  // Nothing struck, something changed: a turn back on itself.
  Status: {
    key: 'status',
    path: (
      <>
        <path
          d="M12.5 9.2A4.8 4.8 0 1 1 11 4.6" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        />
        <path d="M12.6 1.9V5.4H9.1Z" fill="currentColor" />
      </>
    ),
  },
}

/**
 * `label` puts the word beside the mark, for the places with room for it. The
 * name is on the element either way, so the column can be read without it.
 */
export function MoveCategory({ category, label }: { category: string; label?: boolean }) {
  const shape = SHAPES[category as Category]
  if (!shape) return <span className="move-cat">{category}</span>
  return (
    <span className={`move-cat cat-${shape.key}`} title={category}>
      <span className="move-cat-badge">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">{shape.path}</svg>
      </span>
      {label ? <span>{category}</span> : <span className="sr-only">{category}</span>}
    </span>
  )
}
