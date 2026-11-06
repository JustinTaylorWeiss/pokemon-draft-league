import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * `useState` that outlives the page.
 *
 * For work rather than for views: the spread somebody is halfway through
 * writing, the moves they have named by hand, the search they have typed.
 * None of it belongs in the address bar — an EV spread is not a link you
 * would send anyone — and all of it was being thrown away by a reload,
 * which on a tool people leave open for an evening is most of the work.
 *
 * Storage is best-effort in both directions. A private window refuses to
 * write, a full one refuses too, and anything already stored may have been
 * written by a version of the page that has since changed its mind about
 * the shape. None of that is worth taking the tab down for, so a failure
 * either way leaves the value where it started.
 */

/** How a value that JSON cannot hold goes in and comes back. */
export interface Store<T> {
  save: (value: T) => unknown
  /**
   * Whatever was stored last time, which is to say anything at all: it
   * may have been written months ago by a page that has moved on since.
   */
  load: (raw: unknown) => T
}

const read = <T>(key: string, store: Store<T> | undefined, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return store ? store.load(parsed) : (parsed as T)
  } catch {
    return fallback
  }
}

export function useStored<T>(
  key: string,
  initial: T | (() => T),
  store?: Store<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(
    () => read(key, store, typeof initial === 'function' ? (initial as () => T)() : initial),
  )

  /*
   * Held rather than watched. A caller that builds its store inline —
   * `listOf<MoveTag>()` — hands over a new object every render, and a
   * store in the dependencies would make that a fresh write every
   * render. What it does never changes, only the object holding it.
   */
  const how = useRef(store)
  how.current = store

  /*
   * Not on the first run. What was just read is what is already there,
   * and writing it back would mean a page that has only been looked at
   * rewriting every key it touches.
   */
  const written = useRef(false)
  useEffect(() => {
    if (!written.current) { written.current = true; return }
    try {
      const held = how.current
      localStorage.setItem(key, JSON.stringify(held ? held.save(value) : value))
    } catch { /* private browsing, or no room — the work is still on screen */ }
  }, [key, value])

  return [value, setValue]
}

/** A `Set`, which JSON has no notion of, as the list it is made from. */
export const listOf = <T extends string>(): Store<Set<T>> => ({
  save: (value) => [...value],
  load: (raw) => new Set(
    (Array.isArray(raw) ? raw : []).filter((x): x is T => typeof x === 'string'),
  ),
})

/** The same again, for a Set held per Pokémon: `{ garchomp: Set{'Fire'} }`. */
export const listsOf = <T extends string>(): Store<Record<string, Set<T>>> => ({
  save: (value) => Object.fromEntries(
    Object.entries(value).map(([id, set]) => [id, [...set]]),
  ),
  load: (raw) => {
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, Set<T>> = {}
    for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(list)) {
        out[id] = new Set(list.filter((x): x is T => typeof x === 'string'))
      }
    }
    return out
  },
})

/**
 * One of a known handful, or the default where it is anything else.
 *
 * What was stored may have been written by a version of the page that
 * offered a choice this one no longer does.
 */
export const oneOf = <T extends string>(allowed: readonly T[], fallback: T): Store<T> => ({
  save: (value) => value,
  load: (raw) => (allowed.includes(raw as T) ? (raw as T) : fallback),
})
