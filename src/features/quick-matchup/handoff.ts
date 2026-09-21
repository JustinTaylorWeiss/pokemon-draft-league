/**
 * One team, sent to Quick Matchup to be read on its own.
 *
 * The matchup tool answers "how do these two sides meet". A coach looking at
 * their own roster is asking something smaller and more common: what am I
 * fast against, what am I weak to, what can I actually learn. Every one of
 * those readings is about a single team — only Coverage needs somebody to
 * cover — so the tool can answer it with one side filled and the other left
 * out entirely.
 *
 * Held here rather than passed: the draft screen and the matchup tool are
 * never mounted at the same time, so there is nothing to hand over directly.
 *
 * Deliberately not consumed on read. A one-shot was the first attempt and it
 * broke under StrictMode, which mounts twice — the first mount took the team,
 * the second found nothing and restored the saved two-team state over the top.
 * A value that simply stays set until something replaces or clears it cannot
 * lose that race, however many times a component mounts.
 */
export interface SoloTeam {
  /** What the side is called once it lands — a coach's team, or their name. */
  name: string
  /** Dex ids, in the order they should appear. */
  ids: string[]
}

let solo: SoloTeam | null = null
const listeners = new Set<() => void>()

const notify = () => { for (const fn of listeners) fn() }

/** The team being read on its own, if the tool is in that mode. */
export const soloTeam = () => solo

/** Shows a team by itself, and asks whoever owns the view to bring the tool up. */
export function showSolo(team: SoloTeam) {
  solo = team
  notify()
}

/** Back to comparing two sides, with whatever was last built there. */
export function clearSolo() {
  solo = null
  notify()
}

export function subscribeSolo(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
