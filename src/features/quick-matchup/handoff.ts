/**
 * Sending a team to Quick Matchup from somewhere else in the app.
 *
 * The matchup tool can already pull any drafted roster in — it has a picker for
 * exactly that. What it cannot do is be reached from the team you are looking
 * at, so seeing your own roster analysed meant leaving the draft screen, going
 * to another tab, and finding your name in a list of twenty. This is that trip,
 * as a button.
 *
 * A message rather than a shared store: the two screens never exist at once —
 * switching view unmounts one and mounts the other — so there is no state to
 * keep in step, only a thing to hand over. `take` empties it, so a handoff is
 * spent once and a later visit to the tool gets whatever was last saved
 * instead of re-loading a team from a button pressed yesterday.
 */
export interface MatchupHandoff {
  /** What the side is called once it lands — a coach's name, or their team's. */
  name: string
  /** Dex ids, in the order they should appear. */
  ids: string[]
}

let pending: MatchupHandoff | null = null
const listeners = new Set<() => void>()

/** Hands a team over and asks whoever owns the view to show the tool. */
export function sendToMatchup(team: MatchupHandoff) {
  pending = team
  for (const fn of listeners) fn()
}

/** The team waiting, if any, clearing it on the way out. */
export function takeMatchup(): MatchupHandoff | null {
  const team = pending
  pending = null
  return team
}

export function subscribeMatchup(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
