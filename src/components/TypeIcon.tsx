import type { TypeName } from '../data/types'

/**
 * A glyph per type, drawn here rather than pulled from the games' own icon
 * files: those are Nintendo artwork, and this only needs eighteen shapes that
 * stay apart from each other at 16px.
 *
 * Each is a single filled path on a 24x24 grid using `currentColor`, so a chip
 * sets the colour and the glyph follows. They are deliberately blunt — a
 * droplet, a bolt, a leaf — because the job is being recognised in a table
 * header at a glance, not being detailed.
 */
const PATHS: Record<string, string> = {
  // Featureless ring: the type with no character of its own.
  Normal: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 3.6a5.4 5.4 0 110 10.8 5.4 5.4 0 010-10.8z',
  // Flame with an inner tongue.
  Fire: 'M12 2c1 3.2-.6 4.8-2.2 6.4C8 10.2 6.5 12 6.5 14.5A5.5 5.5 0 0012 20a5.5 5.5 0 005.5-5.5c0-3.6-2.4-5.6-3.8-8.2-.3 1.6-1.1 2.5-2 3.3.5-2.6.6-5.2.3-7.6zm0 10.4c1.2 1 1.9 1.9 1.9 3a1.9 1.9 0 11-3.8 0c0-1.1.7-2 1.9-3z',
  // Teardrop.
  Water: 'M12 2.5c3.4 4.2 6.5 7.7 6.5 11.2A6.5 6.5 0 0112 20a6.5 6.5 0 01-6.5-6.3c0-3.5 3.1-7 6.5-11.2z',
  // Lightning bolt.
  Electric: 'M13.8 2L5.5 13.2h4.9L9.4 22l8.9-11.9h-5.2L13.8 2z',
  // Leaf with a midrib.
  Grass: 'M20 3c-8.4-.7-14 2.6-14 8.6 0 2.3.9 4.2 2.3 5.5L5 20.4 6.6 22l3.2-3.2A7.6 7.6 0 0013 19.6C17.7 19.6 20.6 14 20 3zm-2.6 3.1c-.2 6.9-2.1 11-5.2 11.4a5.6 5.6 0 01-2.2-.4l7-7.7-1.4-1.3-7 7.7A5.7 5.7 0 018 12.2c0-3.6 3.2-6 9.4-6.1z',
  // Six even spokes, built by rotating one bar, so it is symmetric by construction rather than by eye.
  Ice: 'M10.85 3.0 L13.15 3.0 L13.15 21.0 L10.85 21.0ZM19.22 6.5 L20.37 8.5 L4.78 17.5 L3.63 15.5ZM20.37 15.5 L19.22 17.5 L3.63 8.5 L4.78 6.5ZM12 9.4a2.6 2.6 0 110 5.2 2.6 2.6 0 010-5.2Z',
  // A boxing glove: one rounded mass, a thumb lobe and a cuff. A bare fist
  // turns to mush at 16px; this keeps a silhouette.
  Fighting: 'M9.4 3h4.2a6.4 6.4 0 016.4 6.4v3.1a4.6 4.6 0 01-4.6 4.6H8.9a4.6 4.6 0 01-4.6-4.6v-.7H3.6a2.3 2.3 0 010-4.6h.8A6.4 6.4 0 019.4 3zM6.6 18.1h11v1.7A2.2 2.2 0 0115.4 22H8.8a2.2 2.2 0 01-2.2-2.2v-1.7z',
  // Droplet over two bubbles.
  Poison: 'M12 2.2c2.8 3.4 5.3 6.3 5.3 9.1a5.3 5.3 0 01-10.6 0c0-2.8 2.5-5.7 5.3-9.1zM7.6 17.6a2.2 2.2 0 110 4.4 2.2 2.2 0 010-4.4zm8.8.6a1.8 1.8 0 110 3.6 1.8 1.8 0 010-3.6z',
  // Three centred bands widening downward: strata seen edge-on.
  Ground: 'M7 5.2h10v3.4H7zM4.4 10.6h15.2V14H4.4zM1.8 16h20.4v3.4H1.8z',
  // A whole bird from above: body, two swept wings, forked tail. Nothing
  // else in the set is a creature, so unlike a wing or a feather it cannot
  // be mistaken for Grass's leaf however small it gets.
  Flying: 'M12 3.4c.85 0 1.5.8 1.5 1.8v4.3c3.5-1.7 7.2-2.2 11-1.4-2.4 3.2-6.1 5.2-11 6.2v2.4l1.9 3-3.4 1.9-3.4-1.9 1.9-3v-2.4C5.6 13.3 1.9 11.3-.5 8.1c3.8-.8 7.5-.3 11 1.4V5.2c0-1 .65-1.8 1.5-1.8z',
  // Spiral.
  Psychic: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 2.4a7.6 7.6 0 015.2 13.1c-1 .9-2.2 1.4-3.5 1.4-2.4 0-4.3-1.9-4.3-4.3 0-1.9 1.5-3.4 3.4-3.4 1.4 0 2.6 1.2 2.6 2.6a2 2 0 01-2 2c-.3 0-.6-.1-.8-.3.6 1 1.6 1 2.4.3.9-.8 1.4-2 1.4-3.2a4.5 4.5 0 00-4.5-4.5 5.5 5.5 0 00-5.5 5.5c0 1.4.4 2.7 1.2 3.8A7.6 7.6 0 0112 4.4z',
  // Beetle with antennae.
  Bug: 'M8.4 2.6l2.2 2.6a5.4 5.4 0 012.8 0l2.2-2.6 1.5 1.3-2 2.4c.6.5 1.1 1.2 1.4 2H20v2h-3.1c0 .3.1.7.1 1v.6h3.4v2H17v.6c0 .4 0 .8-.1 1.1H20v2h-3.5c-.9 1.8-2.6 3-4.5 3s-3.6-1.2-4.5-3H4v-2h3.1a6 6 0 01-.1-1.1V14H3.6v-2H7v-.6c0-.3 0-.7.1-1H4v-2h3.5c.3-.8.8-1.5 1.4-2l-2-2.4 1.5-1.3z',
  // Two chunky angular stones, both sitting on the ground line. Loose stones
  // drawn above a slope read as a sun and moon over a mountain instead.
  Rock: 'M2.4 20.6l2.6-8.4 5.4-2.8 3.4 4.6-1.2 6.6H2.4zM14.6 20.6l1.6-5.8 4.2-2 1.2 7.8h-7z',
  // Ghost with a wavy hem.
  Ghost: 'M12 2a7 7 0 00-7 7v11l2.3-2 2.3 2 2.4-2 2.4 2 2.3-2 2.3 2V9a7 7 0 00-7-7zM9.5 8.2a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm5 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  // Three claw rakes. A wing would collide with Flying and a flame with
  // Fire, so the mark a dragon leaves stands in for the dragon.
  Dragon: 'M3.4 4.2c2.1 3.3 3.2 7.9 3.5 13.8-2.6-4-3.8-8.8-3.5-13.8zM9.7 2.4c2.2 3.7 3.4 8.8 3.7 15.8-2.7-4.4-4-10-3.7-15.8zM16 4.2c2.1 3.3 3.2 7.9 3.5 13.8-2.6-4-3.8-8.8-3.5-13.8z',
  // Crescent moon.
  Dark: 'M14.8 2.4A9.8 9.8 0 0012 22a9.8 9.8 0 009.3-6.7 7.6 7.6 0 01-9.6-9.5c.3-1.2.9-2.4 1.7-3.4h1.4z',
  // Hex nut with a bore.
  Steel: 'M12 2l8.2 4.7v9.4L12 22l-8.2-5.9V6.7L12 2zm0 5.2a4.4 4.4 0 100 8.8 4.4 4.4 0 000-8.8z',
  // Four-pointed sparkle with a small companion.
  Fairy: 'M11 2.4l2 5.7 5.7 2-5.7 2-2 5.7-2-5.7-5.7-2 5.7-2 2-5.7zm7.4 12.2l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.5z',
  // Stellar: an eight-pointed burst, distinct from Fairy's four.
  Stellar: 'M12 2l1.8 6.4L20 6l-2.4 6L22 13.8l-6.4 1.8L18 22l-6-2.4L6 22l2.4-6.4L2 13.8 8.4 12 6 6l6.2 2.4L12 2z',
}

/**
 * Per-glyph correction for shapes that do not use much of the 24x24 grid and so
 * read small next to the rest. Each entry scales about the path's own bounding
 * box and re-centres it, rather than about the viewBox centre — Rock sits low
 * in its box, and scaling in place would only push it further down.
 */
const FIT: Record<string, { scale: number; cx: number; cy: number }> = {
  Rock: { scale: 1.2, cx: 11.9, cy: 15.05 },
  Fire: { scale: 1.22, cx: 12, cy: 11 },
}

interface Props {
  type: TypeName
  /** Pixel size of the square glyph. */
  size?: number
}

/** The glyph alone, with no chip around it. */
export function TypeIcon({ type, size = 16 }: Props) {
  const path = PATHS[type]
  if (!path) return null
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size}
      role="img" aria-label={type} focusable="false"
    >
      <title>{type}</title>
      <path
        d={path} fill="currentColor"
        transform={(() => {
          const fit = FIT[type]
          if (!fit) return undefined
          // Scale about the origin, then shift so the old bbox centre lands
          // back on the middle of the grid.
          const { scale, cx, cy } = fit
          return `translate(${(12 - cx * scale).toFixed(2)} ${(12 - cy * scale).toFixed(2)}) scale(${scale})`
        })()}
      />
    </svg>
  )
}

/**
 * The glyph on the type's colour, with the name under it. The label is what
 * makes the column readable without hovering; the icon is what makes it
 * identifiable before you read anything.
 */
export function TypeIconChip(
  { type, size, title, label = true }: Props & { title?: string; label?: boolean },
) {
  return (
    <span className={`type-icon-chip type-${type.toLowerCase()}`} title={title ?? type}>
      <TypeIcon type={type} size={size} />
      {label && <span className="type-icon-label">{type}</span>}
    </span>
  )
}
