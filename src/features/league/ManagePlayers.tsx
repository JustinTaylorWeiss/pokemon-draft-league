import { useEffect, useState } from 'react'
import { addPlayer, removePlayer } from '../../data/supabase'
import type { League } from '../../data/league'

/**
 * Adding and removing players.
 *
 * Behind the passphrase, because who is in the league determines the seeding,
 * the schedule and the rosters — this is the one edit that reaches everything
 * else. The check happens in the database; the field here just carries it.
 */

interface Props {
  league: League
  onClose: () => void
  onSaved: () => void
}

export function ManagePlayers({ league, onClose, onSaved }: Props) {
  const [passphrase, setPassphrase] = useState('')
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Both actions report the same way, so they share the wrapper. */
  async function run(action: () => Promise<unknown>, said: string) {
    if (!passphrase.trim()) {
      setError('The passphrase is needed for this.')
      return
    }
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await action()
      setDone(said)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  const played = (id: string) =>
    league.schedule.some((m) =>
      m.scoreA !== null && (m.a.includes(id) || m.b.includes(id)))

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal players-modal" role="dialog" aria-modal="true" aria-label="Add or remove players">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="report-title">Players</h2>
        <p className="report-lead">
          Changing who is in the league moves the seeding and the schedule with
          it, so this one needs the passphrase.
        </p>

        <label className="report-week players-pass">
          Passphrase
          <input
            type="password"
            value={passphrase}
            autoComplete="off"
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>

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
            onClick={() => run(
              async () => { await addPlayer(passphrase, name.trim(), team.trim()); setName(''); setTeam('') },
              `Added ${name.trim()}.`,
            )}
          >
            Add
          </button>
        </div>

        {error && <p className="report-error">{error}</p>}
        {done && <p className="report-done">{done}</p>}

        <ul className="players-list">
          {league.players.map((p) => (
            <li key={p.id}>
              <span className="players-name">{p.name}</span>
              <span className="players-team">{p.team ?? '—'}</span>
              {played(p.id) ? (
                // Removing them would leave their matches pointing at nobody.
                // The database refuses this too; saying so here saves the trip.
                <span className="players-locked" title="Remove or reassign their matches first">
                  has results
                </span>
              ) : confirming === p.id ? (
                <span className="players-confirm">
                  <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
                  <button
                    type="button"
                    className="players-remove"
                    disabled={busy}
                    onClick={() => run(() => removePlayer(passphrase, p.id), `Removed ${p.name}.`)}
                  >
                    Really remove
                  </button>
                </span>
              ) : (
                <button type="button" className="players-remove" onClick={() => setConfirming(p.id)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
