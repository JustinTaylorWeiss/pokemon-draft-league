import { useEffect, useState } from 'react'
import {
  addPlayer, currentSeasonId, db, errorText, removePlayer, restorePlayer, unlock,
} from '../../data/supabase'
import type { League } from '../../data/league'

/**
 * Adding and removing players.
 *
 * Behind the passphrase, because who is in the league determines the seeding,
 * the schedule and the rosters — this is the one edit that reaches everything
 * else. The passphrase is asked for up front rather than at the point of
 * clicking, so nobody fills in a form only to find they cannot submit it.
 *
 * Unlocking is a convenience and not the boundary. Every action re-checks the
 * passphrase in the database, which is where the check has to happen: a browser
 * can be made to show any screen it likes.
 *
 * Removing is hiding. The row and the results stay exactly where they are, so
 * removing the wrong person costs a click to undo rather than a season.
 */

interface Props {
  league: League
  onClose: () => void
  onSaved: () => void
}

interface Roster {
  id: string
  name: string
  team: string | null
  hidden: boolean
}

export function ManagePlayers({ league, onClose, onSaved }: Props) {
  const [passphrase, setPassphrase] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [roster, setRoster] = useState<Roster[] | null>(null)
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Read directly rather than from the league, which by design has already
  // dropped the hidden players this screen needs to show.
  //
  // Scoped to the season, and it has to be: player ids are per season, so the
  // same `nolan` exists in each one. Unscoped, this listed every season's copy
  // and hiding one left the others visible — the same person showing up under
  // both Players and Hidden at once, with a Remove button that never finished.
  async function loadRoster() {
    const { data } = await db.from('players')
      .select('id, name, team, hidden')
      .eq('season_id', currentSeasonId())
      .order('seed')
    setRoster((data ?? []) as Roster[])
  }

  async function tryUnlock() {
    if (!passphrase.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (await unlock(passphrase)) {
        setUnlocked(true)
        await loadRoster()
      } else {
        setError('That passphrase is not right.')
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  /** Every action reports the same way, so they share the wrapper. */
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const said = await action()
      setDone(typeof said === 'string' ? said : 'Done.')
      await loadRoster()
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  // No click-away close: the backdrop is easy to hit by accident, and hitting
  // it would throw away a form that took real effort to fill in — or, here, a
  // passphrase. Closing is the ✕, which nobody presses without meaning to.
  const shell = (children: React.ReactNode) => (
    <div className="modal-backdrop">
      <div className="modal players-modal" role="dialog" aria-modal="true" aria-label="Add or remove players">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  )

  if (!unlocked) {
    return shell(
      <>
        <h2 className="report-title">Players</h2>
        <p className="report-lead one-line">
          Adding or removing players needs the passphrase.
        </p>
        <form
          className="players-gate"
          onSubmit={(e) => { e.preventDefault(); tryUnlock() }}
        >
          <input
            type="password"
            value={passphrase}
            autoFocus
            autoComplete="off"
            placeholder="Passphrase"
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <button type="submit" className="report-go" disabled={busy || !passphrase.trim()}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
        {error && <p className="report-error">{error}</p>}
      </>,
    )
  }

  const active = roster?.filter((p) => !p.hidden) ?? []
  const hidden = roster?.filter((p) => p.hidden) ?? []

  return shell(
    <>
      <h2 className="report-title">Players</h2>
      <p className="report-lead">
        Removing a player hides them from the site. Their row and their results
        stay in the database, so it can be undone.
      </p>

      <div className="players-add">
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New player" />
        </label>
        <label>
          <span>Team <em>optional</em></span>
          <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team name" />
        </label>
        <button
          type="button"
          className="report-go"
          disabled={busy || !name.trim()}
          onClick={() => run(async () => {
            const added = name.trim()
            await addPlayer(passphrase, added, team.trim())
            setName('')
            setTeam('')
            return `Added ${added}.`
          })}
        >
          Add
        </button>
      </div>

      {error && <p className="report-error">{error}</p>}
      {done && <p className="report-done">{done}</p>}

      <ul className="players-list">
        {active.map((p) => (
          <li key={p.id}>
            <span className="players-name">{p.name}</span>
            <span className="players-team">{p.team ?? '—'}</span>
            <button
              type="button"
              className="players-remove"
              disabled={busy}
              onClick={() => run(() => removePlayer(passphrase, p.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {hidden.length > 0 && (
        <>
          <h3 className="players-hidden-head">
            Hidden <span>— not shown on the site, results still on record</span>
          </h3>
          <ul className="players-list players-hidden">
            {hidden.map((p) => (
              <li key={p.id}>
                <span className="players-name">{p.name}</span>
                <span className="players-team">{p.team ?? '—'}</span>
                <button
                  type="button"
                  className="players-restore"
                  disabled={busy}
                  onClick={() => run(() => restorePlayer(passphrase, p.id))}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* The league prop is what the rest of the site is showing; if it and the
          roster disagree the page behind this one is simply stale. */}
      {roster && active.length !== league.players.length && (
        <p className="report-lead">The page behind will catch up when you close this.</p>
      )}
    </>,
  )
}
