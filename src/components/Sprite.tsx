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
 * Three attempts, each for a different reason:
 *
 *  0. the still sprite, which is what almost everything has;
 *  1. the same URL cache-busted, which covers a dropped connection — a failed
 *     response can be cached, and a plain retry never leaves the browser;
 *  2. the animated one, which covers a Pokémon Showdown has drawn but has no
 *     still for. That is not hypothetical: of the 93 Mega and Primal formes,
 *     21 have no still sprite, and 11 of those do have an animated one. They
 *     are the Megas announced for Legends Z-A, which nobody has drawn in the
 *     older style yet.
 *
 * After that it falls back to the Pokémon's initial, which is quiet and says
 * nothing false. Ten of the Legends Z-A Megas have no sprite at all anywhere,
 * and inventing one — the base forme's artwork, say — would show the wrong
 * Pokémon rather than admit to a gap.
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

  if (tries > 2) {
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
      : spriteUrl(pokemon, true)

  return (
    <img
      className={className}
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
