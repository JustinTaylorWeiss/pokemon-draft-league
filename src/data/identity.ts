import { currentSeason } from './league'
import { setActor } from './supabase'

/**
 * Who is using the site.
 *
 * Not authentication — there is no login and this is a self-declaration. It
 * does two jobs: it decides which roster the draft screen lets you edit, and
 * it is stamped onto every change so the history reads "Nolan drafted
 * Charizard" rather than "someone did".
 *
 * Those were two separate settings, chosen in two places, which could disagree
 * — you could be editing Nolan's team while every edit was logged as anonymous.
 * One choice now sets both.
 */

/**
 * Watching, rather than being one of the players.
 *
 * The site asks who you are before it will let you past, because every change
 * is stamped with a name and the draft screen has to know whose roster is
 * yours. That is the wrong question for most of the people who open it — the
 * league is public, and somebody reading the board is not any of the coaches
 * and should not have to pick one of them to look at it.
 *
 * Stored like any other answer, so it sticks and the question stops being
 * asked. It is deliberately not a row in `players`: a season's players are its
 * standings, its schedule and its draft order, and a spectator is in none of
 * those. Adding one would put an 0-0 team in the table and a seat in the order
 * that never picks.
 */
export const SPECTATOR = 'spectator'

/** Whether this identity is watching rather than playing. */
export const isSpectator = (id: string) => id === SPECTATOR

/**
 * Kept per season, because who you are is a fact about a season and not about
 * you. The same person is a different player in each one — a different roster
 * to edit, a different set of matches — and the ids do not settle it, since a
 * season copied from another has the same slugs in it. One shared answer would
 * silently carry "you are Nolan" into a season Nolan is not playing in.
 */
const keyFor = (season: string) => `league:me:${season}`

/** What the single-season version wrote, before there was more than one. */
const LEGACY_KEY = 'league:me'

let listeners = new Set<(id: string) => void>()

export function myPlayerId(): string {
  const season = currentSeason().id
  try {
    const own = localStorage.getItem(keyFor(season))
    if (own !== null) return own

    // The old answer belongs to whichever season is open when it is first
    // asked for, and only that one. Moved rather than read in place, so it
    // cannot also answer for every other season.
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      localStorage.setItem(keyFor(season), legacy)
      localStorage.removeItem(LEGACY_KEY)
      return legacy
    }
    return ''
  } catch {
    return ''
  }
}

/** `name` is what the history will show; the id is what the app works with. */
export function setMyPlayer(id: string, name: string) {
  try {
    localStorage.setItem(keyFor(currentSeason().id), id)
  } catch {
    // Private browsing. The choice holds for this page and no longer.
  }
  setActor(name || 'anonymous')
  for (const fn of listeners) fn(id)
}

/**
 * Forgets the current season's answer, for when the player it names is no
 * longer in the league. Leaving it would keep stamping edits with somebody the
 * season has removed.
 */
export function forgetMyPlayer() {
  try {
    localStorage.removeItem(keyFor(currentSeason().id))
  } catch {
    // Nothing was stored, so nothing to forget.
  }
  setActor('anonymous')
  for (const fn of listeners) fn('')
}

export function subscribeIdentity(fn: (id: string) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Whether anyone has said who they are yet, which is what prompts the ask. */
export const knowsWhoTheyAre = () => myPlayerId() !== ''
