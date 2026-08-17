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
