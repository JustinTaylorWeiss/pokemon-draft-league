import { tierClass, type LeaguePokemon } from '../data/league'

/**
 * What a Pokémon is worth in the season being looked at.
 *
 * Some seasons price their board and some band it into tiers, and every screen
 * that shows one has to show the other. Rather than plumb the season's mode
 * into the Dex, the matchup tool and the modal, the answer is read off the
 * entry: a priced season fills in `points`, a tiered one leaves it null. One
 * fact, checked where it is needed.
 *
 * A banned Pokémon on a priced season has no cost — it cannot be bought — so it
 * falls through to its tier and says "Banned", which is the useful thing to
 * know about it anyway.
 */
export function DraftValue({ mon, fallback }: {
  mon: LeaguePokemon
  /** Shown when the league has no opinion — the Dex uses Smogon's tier here. */
  fallback?: string | null
}) {
  if (mon.points != null) {
    return <span className="draft-cost" title={`Costs ${mon.points} points`}>{mon.points}</span>
  }
  if (mon.draftTier) {
    return <span className={tierClass(mon.draftTier)}>{mon.draftTier}</span>
  }
  return fallback ? <span className="tier">{fallback}</span> : null
}
