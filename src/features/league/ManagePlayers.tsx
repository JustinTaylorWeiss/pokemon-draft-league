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
 * What removing does depends on whether the season has started. Before its
 * first match nothing refers to a player, so removing them deletes them — a
 * hidden row with nothing behind it is only something to explain. Once a match
 * is on record, removing is hiding: the row and the results stay exactly where
 * they are, so removing the wrong person costs a click to undo rather than a
 * season. The database makes the same call from the same fact; this only words
 * the buttons to match, and asks once before the one that is for keeps.
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
  /** Who is being asked "for keeps?" — one row at a time. */
  const [confirming, setConfirming] = useState<string | null>(null)

  /**
   * A season has started once it has a match on record, played or scheduled —
   * the same test the database applies, from the same rows.
   */
  const started = league.schedule.length > 0

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
    setConfirming(null)
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

  /**
   * The remove button, or the question it turns into. Hiding is undoable and
   * goes straight through; deleting is not, so it asks once, in place.
   */
  const remover = (p: Roster) => {
    if (started) {
      return (
        <button
          type="button"
          className="players-remove"
          disabled={busy}
          onClick={() => run(() => removePlayer(passphrase, p.id))}
        >
          Remove
        </button>
      )
    }
    if (confirming === p.id) {
      return (
        <span className="players-confirm">
          <button
            type="button"
            className="players-remove"
            disabled={busy}
            onClick={() => run(() => removePlayer(passphrase, p.id))}
          >
            Delete for good
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(null)}>
            Keep
          </button>
        </span>
      )
    }
    return (
      <button
        type="button"
        className="players-remove"
        disabled={busy}
        onClick={() => setConfirming(p.id)}
      >
        {p.hidden ? 'Delete' : 'Remove'}
      </button>
    )
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
        {started
          ? 'Removing a player hides them from the site. Their row and their results stay in the database, so it can be undone.'
          : 'Nothing has been played yet, so removing a player deletes them for good. Any draft picks of theirs go back on the board.'}
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
            {remover(p)}
          </li>
        ))}
      </ul>

      {hidden.length > 0 && (
        <>
          <h3 className="players-hidden-head">
            Hidden
            <span>
              {started
                ? ' — not shown on the site, results still on record'
                : ' — hidden before the season; delete them, or bring them back'}
            </span>
          </h3>
          <ul className="players-list players-hidden">
            {hidden.map((p) => (
              <li key={p.id}>
                <span className="players-name">{p.name}</span>
                <span className="players-team">{p.team ?? '—'}</span>
                {/* Before the season a hidden row is a leftover, and can go the
                    same way a removal now goes. */}
                {!started && remover(p)}
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
