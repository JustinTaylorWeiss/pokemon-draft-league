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

const ID_KEY = 'league:me'

let listeners = new Set<(id: string) => void>()

export function myPlayerId(): string {
  try {
    return localStorage.getItem(ID_KEY) ?? ''
  } catch {
    return ''
  }
}

/** `name` is what the history will show; the id is what the app works with. */
export function setMyPlayer(id: string, name: string) {
  try {
    localStorage.setItem(ID_KEY, id)
  } catch {
    // Private browsing. The choice holds for this page and no longer.
  }
  setActor(name || 'anonymous')
  for (const fn of listeners) fn(id)
}

export function subscribeIdentity(fn: (id: string) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Whether anyone has said who they are yet, which is what prompts the ask. */
export const knowsWhoTheyAre = () => myPlayerId() !== ''
