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
  // Six-spoke snowflake.
  Ice: 'M11 2h2v5.1l2.1-2.1 1.4 1.4L13 9.9v2.3l2-1.2 3.6-2.1.9 1.7-3.1 1.8 2.7.7-.5 1.9-4-1.1-2 1.1 2 1.1 4-1.1.5 1.9-2.7.7 3.1 1.8-.9 1.7-3.6-2.1-2-1.2v2.3l3.5 3.5-1.4 1.4L13 17v5h-2v-5l-2.1 2.1-1.4-1.4L11 14.1v-2.3l-2 1.2-3.6 2.1-.9-1.7 3.1-1.8-2.7-.7.5-1.9 4 1.1 2-1.1-2-1.1-4 1.1-.5-1.9 2.7-.7L4.5 9.6l.9-1.7L9 10l2 1.2V8.9L7.5 5.4 8.9 4 11 6.1V2z',
  // Clenched fist.
  Fighting: 'M6 8.5c0-1.1.9-2 2-2 .5 0 1 .2 1.3.5V5.2a1.9 1.9 0 013.8 0v1.1a1.9 1.9 0 013.7.6v.9a1.9 1.9 0 011.7 1.9v3.5c0 4-3 6.8-6.8 6.8S4.6 17.2 4.6 13.4v-2c0-1 .8-1.8 1.8-1.8h-.4v-1zm2.4 4.9c0 2.4 1.6 4 3.9 4s3.9-1.6 3.9-4v-2H8.4v2z',
  // Droplet over two bubbles.
  Poison: 'M12 2.2c2.8 3.4 5.3 6.3 5.3 9.1a5.3 5.3 0 01-10.6 0c0-2.8 2.5-5.7 5.3-9.1zM7.6 17.6a2.2 2.2 0 110 4.4 2.2 2.2 0 010-4.4zm8.8.6a1.8 1.8 0 110 3.6 1.8 1.8 0 010-3.6z',
  // Cracked ground in layers.
  Ground: 'M3 7h18l-1.6 3.4h-5.6L15 7.6 12.6 12h4.9L15.9 15h-5l1.5-2.9L9.6 15H3.6L5.2 12h5.3l1.4-2.6L9.5 7.6 8.6 10.4H3.9L3 7zm1.5 10h15l-1 3h-13l-1-3z',
  // Single feathered wing.
  Flying: 'M2 9.5c4.5-1.2 8.6-.6 12.3 1.8 2 1.3 3.9 2 5.7 2 .8 0 1.6-.1 2.4-.4-1.3 3.5-4 5.3-8 5.3-2.9 0-5.4-1-7.4-2.9C5 13.4 3.3 11.6 2 9.5zm5.6 2.1c1.6 1.9 3.3 3.3 5.1 4.2-1.6-2.1-3.3-3.5-5.1-4.2z',
  // Spiral.
  Psychic: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 2.4a7.6 7.6 0 015.2 13.1c-1 .9-2.2 1.4-3.5 1.4-2.4 0-4.3-1.9-4.3-4.3 0-1.9 1.5-3.4 3.4-3.4 1.4 0 2.6 1.2 2.6 2.6a2 2 0 01-2 2c-.3 0-.6-.1-.8-.3.6 1 1.6 1 2.4.3.9-.8 1.4-2 1.4-3.2a4.5 4.5 0 00-4.5-4.5 5.5 5.5 0 00-5.5 5.5c0 1.4.4 2.7 1.2 3.8A7.6 7.6 0 0112 4.4z',
  // Beetle with antennae.
  Bug: 'M8.4 2.6l2.2 2.6a5.4 5.4 0 012.8 0l2.2-2.6 1.5 1.3-2 2.4c.6.5 1.1 1.2 1.4 2H20v2h-3.1c0 .3.1.7.1 1v.6h3.4v2H17v.6c0 .4 0 .8-.1 1.1H20v2h-3.5c-.9 1.8-2.6 3-4.5 3s-3.6-1.2-4.5-3H4v-2h3.1a6 6 0 01-.1-1.1V14H3.6v-2H7v-.6c0-.3 0-.7.1-1H4v-2h3.5c.3-.8.8-1.5 1.4-2l-2-2.4 1.5-1.3z',
  // Angular boulder cluster.
  Rock: 'M4 19l3.4-8.2L11 6.2l4.6 1.5L21 12.4 19.4 19H4zm5-7.6L6.9 16.6h4.4L9 11.4zm2.6-2.8l2.5 6.6 3.6-1.3-3-3.6-3.1-1.7z',
  // Ghost with a wavy hem.
  Ghost: 'M12 2a7 7 0 00-7 7v11l2.3-2 2.3 2 2.4-2 2.4 2 2.3-2 2.3 2V9a7 7 0 00-7-7zM9.5 8.2a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm5 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  // Clawed dragon jaw.
  Dragon: 'M3 6.4l5.4 1.2 2-3.6 2.2 3.4L18 5.7l-1.4 4 4.4 1.6-3.8 2.2 2.4 3.3-4.4-.4-.6 4.3-3.2-3-3 3.2-.9-4.3-4.4.1 2.2-3.5L1.9 11l4.3-1.4L3 6.4zm9 4.2a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z',
  // Crescent moon.
  Dark: 'M14.8 2.4A9.8 9.8 0 0012 22a9.8 9.8 0 009.3-6.7 7.6 7.6 0 01-9.6-9.5c.3-1.2.9-2.4 1.7-3.4h1.4z',
  // Hex nut with a bore.
  Steel: 'M12 2l8.2 4.7v9.4L12 22l-8.2-5.9V6.7L12 2zm0 5.2a4.4 4.4 0 100 8.8 4.4 4.4 0 000-8.8z',
  // Four-pointed sparkle with a small companion.
  Fairy: 'M11 2.4l2 5.7 5.7 2-5.7 2-2 5.7-2-5.7-5.7-2 5.7-2 2-5.7zm7.4 12.2l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.5z',
  // Stellar: an eight-pointed burst, distinct from Fairy's four.
  Stellar: 'M12 2l1.8 6.4L20 6l-2.4 6L22 13.8l-6.4 1.8L18 22l-6-2.4L6 22l2.4-6.4L2 13.8 8.4 12 6 6l6.2 2.4L12 2z',
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
      <path d={path} fill="currentColor" />
    </svg>
  )
}

/** The glyph on the type's colour, for headers where a word will not fit. */
export function TypeIconChip({ type, size, title }: Props & { title?: string }) {
  return (
    <span className={`type-icon-chip type-${type.toLowerCase()}`} title={title ?? type}>
      <TypeIcon type={type} size={size} />
    </span>
  )
}
