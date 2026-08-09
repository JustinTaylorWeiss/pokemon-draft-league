import type {
  AbilityDex, LearnsetDex, MoveDex, Pokemon, PokemonDex, TypeChart, TypeName,
} from './types'

/**
 * The dataset lives in public/data/ rather than being imported, so it stays out
 * of the JS bundle and gets cached as plain JSON. Learnsets are ~5x the size of
 * everything else combined, so nothing loads it until a view actually needs it.
 */
const cache = new Map<string, Promise<unknown>>()

function load<T>(name: string): Promise<T> {
  let pending = cache.get(name) as Promise<T> | undefined
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/${name}.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${name}.json: HTTP ${res.status}`)
      return res.json() as Promise<T>
    })
    // Don't cache rejections; a retry should be able to try the network again.
    pending.catch(() => cache.delete(name))
    cache.set(name, pending)
  }
  return pending
}

export const loadPokemon = () => load<PokemonDex>('pokemon')
export const loadMoves = () => load<MoveDex>('moves')
export const loadAbilities = () => load<AbilityDex>('abilities')
export const loadTypeChart = () => load<TypeChart>('typechart')
export const loadLearnsets = () => load<LearnsetDex>('learnsets')

/** Everything except learnsets — enough to render the dex and matchup grids. */
export function loadCore() {
  return Promise.all([loadPokemon(), loadMoves(), loadAbilities(), loadTypeChart()])
    .then(([pokemon, moves, abilities, typechart]) => ({ pokemon, moves, abilities, typechart }))
}

/**
 * Combined multiplier for an attacking type against a (possibly dual-type)
 * defender. Multiplicative, so a 2x/2x pairing correctly yields 4x.
 */
export function effectiveness(
  chart: TypeChart,
  attacking: TypeName,
  defending: TypeName[],
): number {
  return defending.reduce((mult, def) => mult * (chart.chart[attacking]?.[def] ?? 1), 1)
}

/**
 * Folds accents before stripping, so "Flabébé" lands on "flabebe" whichever
 * Unicode normalization the source used. Composed é would otherwise vanish
 * entirely and leave "flabb".
 */
export const toId = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Showdown's sprite filenames strip spaces inside a name but keep the hyphen
 * between species and forme: "Iron Treads" is irontreads, "Landorus-Therian" is
 * landorus-therian. Our dex ids strip everything, so alternate formes have to
 * be rebuilt from baseSpecies + forme or 143 of them 404.
 */
export function spriteName(pokemon: Pokemon): string {
  return pokemon.forme && pokemon.baseSpecies
    ? `${toId(pokemon.baseSpecies)}-${toId(pokemon.forme)}`
    : toId(pokemon.name)
}

/** Sprite URLs are derivable from the name, so we don't store them. */
export const spriteUrl = (pokemon: Pokemon, animated = false) =>
  animated
    ? `https://play.pokemonshowdown.com/sprites/ani/${spriteName(pokemon)}.gif`
    : `https://play.pokemonshowdown.com/sprites/gen5/${spriteName(pokemon)}.png`

export const artworkUrl = (num: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${num}.png`
