/**
 * Whose turn it is in a snake draft, worked out from the teams themselves.
 *
 * Nothing records the picks in sequence, and it does not need to: how far the
 * draft has got is exactly how many Pokémon people are holding. That makes the
 * board self-correcting — a pick released, a trade, a player restored halfway
 * through — where a stored pointer would drift out of step with the rosters the
 * moment anybody did something out of turn.
 *
 * Snake means the order reverses every round: 1..N, then N..1, then 1..N. So
 * the round is the smallest roster anybody holds, plus one, and whose turn it is
 * is the first of the people still on that smallest roster — reading the order
 * forwards on odd rounds and backwards on even ones.
 */

export interface DraftSeat {
  player: string
  name: string
  team: string | null
  /** Where they sit in the order, 1-based. */
  order: number
  picks: number
  /** Whether the draft is waiting on them right now. */
  isUp: boolean
}

export interface SnakeDraft {
  seats: DraftSeat[]
  /** 1-based, and simply the round everybody is at or ahead of. */
  round: number
  /** The seat the draft is waiting on, if there is one. */
  upNext: DraftSeat | null
}

export function snakeDraft(
  players: { id: string; name: string; team?: string | null; draftOrder?: number | null }[],
  rosters: Record<string, { pokemon: string }[]>,
): SnakeDraft | null {
  const drawn = players
    .filter((p) => p.draftOrder != null)
    .sort((a, b) => (a.draftOrder as number) - (b.draftOrder as number))

  if (!drawn.length) return null

  const seats = drawn.map((p) => ({
    player: p.id,
    name: p.name,
    team: p.team ?? null,
    order: p.draftOrder as number,
    picks: rosters[p.id]?.length ?? 0,
    isUp: false,
  }))

  const fewest = Math.min(...seats.map((s) => s.picks))
  const round = fewest + 1

  // Odd rounds run down the order, even rounds back up it. Only the people who
  // have not taken this round's pick yet are still in contention for it.
  const waiting = seats.filter((s) => s.picks === fewest)
  const inRoundOrder = round % 2 === 1 ? waiting : [...waiting].reverse()
  const up = inRoundOrder[0] ?? null

  if (up) {
    const seat = seats.find((s) => s.player === up.player)
    if (seat) seat.isUp = true
  }

  return { seats, round, upNext: up ? seats.find((s) => s.player === up.player) ?? null : null }
}
