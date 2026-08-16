import { useEffect, useState } from 'react'
import { spriteUrl } from '../data/load'
import type { Pokemon } from '../data/types'

/**
 * A Pokémon sprite that survives a dropped request.
 *
 * Sprites come from play.pokemonshowdown.com, a couple of hundred at a time on
 * some pages, and occasionally one does not arrive. A plain `<img>` shows the
 * browser's broken-image glyph from then on and never tries again, which reads
 * as "this Pokémon is broken" rather than "that request failed".
 *
 * One retry covers a dropped connection; after that it falls back to the
 * Pokémon's initial, which is quiet and says nothing false.
 */
export function Sprite({
  pokemon, width = 40, height = 33, className,
}: {
  pokemon: Pokemon
  width?: number
  height?: number
  className?: string
}) {
  const src = spriteUrl(pokemon)
  const [tries, setTries] = useState(0)

  // A different Pokémon in the same slot starts over.
  useEffect(() => { setTries(0) }, [src])

  if (tries > 1) {
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

  return (
    <img
      className={className}
      // The retry is cache-busted: a failed response can otherwise be cached
      // and the second attempt never leaves the browser.
      src={tries === 0 ? src : `${src}?retry=1`}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      onError={() => setTries((n) => n + 1)}
    />
  )
}
