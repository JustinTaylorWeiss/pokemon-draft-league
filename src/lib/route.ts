import { useEffect, useState } from 'react'

/**
 * Where you are, in the address bar.
 *
 * Two names: which of the four main views, and which tab inside it. Written
 * as `#/matchup/evs`, so a link to a particular tab is a link somebody can
 * send and a reload lands back where it was rather than at the start.
 *
 * In the hash rather than the path because the site is served as static
 * files from GitHub Pages: a path is a request for a file that is not there,
 * and the fix for that is a 404 page pretending to be the app. A hash never
 * reaches the server.
 *
 * Nothing here knows what a valid view or tab is. The shell reads both,
 * falls back where it does not recognise one, and writes back what it
 * settled on — so a bad link corrects itself rather than showing nothing.
 */
export interface Route {
  view: string
  tab: string
}

const read = (): Route => {
  const [view = '', tab = ''] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { view, tab }
}

export function useRoute() {
  const [here, setHere] = useState(read)

  // Back and forward are the browser's, and the address bar is editable.
  useEffect(() => {
    const moved = () => setHere(read())
    window.addEventListener('hashchange', moved)
    return () => window.removeEventListener('hashchange', moved)
  }, [])

  /*
   * `replace` for a correction the reader did not ask for — landing on
   * `#/league` and being settled onto its first tab should not leave the
   * half-address in the history to go back to. A click pushes, so Back
   * steps through tabs the way it steps through pages.
   */
  const go = (next: Partial<Route>, replace = false) => {
    const to = { ...read(), ...next }
    const hash = `#/${[to.view, to.tab].filter(Boolean).join('/')}`
    if (hash !== window.location.hash) {
      if (replace) {
        const { pathname, search } = window.location
        window.history.replaceState(null, '', pathname + search + hash)
      } else {
        window.location.hash = hash
      }
    }
    setHere(to)
  }

  return [here, go] as const
}
