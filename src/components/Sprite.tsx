import { useEffect, useState } from 'react'
import { artworkUrl, spriteUrl } from '../data/load'
import type { Pokemon } from '../data/types'

/**
 * A Pokémon sprite that survives a dropped request, and a missing drawing.
 *
 * Sprites come from play.pokemonshowdown.com, a couple of hundred at a time on
 * some pages, and occasionally one does not arrive. A plain `<img>` shows the
 * browser's broken-image glyph from then on and never tries again, which reads
 * as "this Pokémon is broken" rather than "that request failed".
 *
 * Four attempts, each for a different reason:
 *
 *  0. the still sprite, which is what almost everything has;
 *  1. the same URL cache-busted, which covers a dropped connection — a failed
 *     response can be cached, and a plain retry never leaves the browser;
 *  2. the animated one, which covers a Pokémon Showdown has drawn but has no
 *     still for. That is not hypothetical: of the 93 Mega and Primal formes,
 *     16 have no still sprite, and 11 of those do have an animated one. They
 *     are the Megas announced for Legends Z-A, which nobody has drawn in the
 *     older style yet;
 *  3. the official artwork, for the five Megas — Heatran, Darkrai, Zygarde,
 *     Magearna and Zeraora — Showdown has not drawn in either style. PokeAPI
 *     has each of them, so a real picture of the right Pokémon exists and only
 *     this component was not looking at it.
 *
 * That last one is taken ONLY where the drawing is the Pokémon's own. Thirty-one
 * formes have no artwork of their own and wear their base's: every Arceus plate,
 * Vivillon's patterns, the Tera Ogerpons. Showing one of those here would be
 * showing the wrong Pokémon, which is worse than admitting to a gap — so they
 * fall through to the initial, which is quiet and says nothing false.
 */
export function Sprite({
  pokemon, width = 40, height = 33, className,
}: {
  pokemon: Pokemon
  width?: number
  height?: number
  className?: string
}) {
  const still = spriteUrl(pokemon)
  const [tries, setTries] = useState(0)

  // A different Pokémon in the same slot starts over.
  useEffect(() => { setTries(0) }, [still])

  /**
   * Whether the artwork is this Pokémon's and not its base's. A species is
   * always its own; a forme only where the build found it one of its own.
   */
  const ownArtwork = !pokemon.baseSpecies || pokemon.artId != null

  if (tries > (ownArtwork ? 3 : 2)) {
    return (
      <span
        className={`sprite-missing${className ? ` ${className}` : ''}`}
        style={{ width, height }}
        title={pokemon.name}
        aria-label={pokemon.name}
      >
        {pokemon.name.slice(0, 1)}
      </span>
    )
  }

  const src = tries === 0 ? still
    : tries === 1 ? `${still}?retry=1`
      : tries === 2 ? spriteUrl(pokemon, true)
        : artworkUrl(pokemon)

  return (
    <img
      // Artwork is a large square and a sprite box usually is not, so it is
      // fitted rather than stretched into one.
      className={`${className ?? ''}${tries === 3 ? ' is-artwork' : ''}`.trim() || undefined}
      src={src}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      onError={() => setTries((n) => n + 1)}
    />
  )
}

/**
 * The official artwork, with the sprite chain above standing behind it.
 *
 * PokeAPI has a drawing for nearly everything, filed under its own id where a
 * forme's differs from its base's (see `artId`). Where the drawing is missing
 * the sprite takes over — and where that is missing too, the initial — so
 * nothing ever shows a broken image at the top of its own page.
 */
export function Artwork({
  pokemon, size = 150, className,
}: {
  pokemon: Pokemon
  size?: number
  className?: string
}) {
  const src = artworkUrl(pokemon)
  const [failed, setFailed] = useState(false)

  // A different Pokémon in the same slot starts over.
  useEffect(() => { setFailed(false) }, [src])

  if (failed) {
    return (
      <Sprite
        pokemon={pokemon}
        width={size}
        height={size}
        className={className ? `${className} is-sprite` : 'is-sprite'}
      />
    )
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  )
}
