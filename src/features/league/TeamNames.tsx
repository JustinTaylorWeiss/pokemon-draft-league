import { useEffect, useState } from 'react'
import { errorText, setTeamName } from '../../data/supabase'
import type { League } from '../../data/league'

/**
 * Renaming teams.
 *
 * Open to everyone, unlike adding and removing players: a team's name is the
 * one thing about a player that changes nothing else — not the seeding, not
 * the schedule, not a roster — and the schema has always left it open. Each
 * change is stamped with whoever the site thinks you are, like every other
 * edit, so the history still says who renamed what.
 *
 * Every player's team is a field here rather than one player at a time. At the
 * start of a season half the league names its team in the same afternoon, and
 * one form beats reopening this eight times.
 */
interface Props {
  league: League
  onClose: () => void
  onSaved: () => void
}

export function TeamNames({ league, onClose, onSaved }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(league.players.map((p) => [p.id, p.team ?? ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Only what actually changed is written; the rest is left alone. */
  const changed = league.players.filter((p) => (drafts[p.id] ?? '').trim() !== (p.team ?? ''))

  async function save() {
    if (!changed.length || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    let saved = 0
    try {
      for (const p of changed) {
        // Blank means no team, the same way adding a player without one does.
        await setTeamName(p.id, drafts[p.id].trim() || null)
        saved++
      }
      setDone(saved === 1 ? `Saved ${changed[0].name}'s team name.` : `Saved ${saved} team names.`)
    } catch (e) {
      // One request per row, so a failure part-way leaves the earlier ones
      // standing. Say so, rather than implying nothing went through.
      setError(saved ? `${errorText(e)} (${saved} of ${changed.length} saved.)` : errorText(e))
    } finally {
      if (saved) onSaved()
      setBusy(false)
    }
  }

  // No click-away close, for the same reason as the players screen: the
  // backdrop is easy to hit, and hitting it would throw away typing.
  return (
    <div className="modal-backdrop">
      <div className="modal players-modal" role="dialog" aria-modal="true" aria-label="Team names">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="report-title">Team names</h2>
        <p className="report-lead">
          Anyone can change these. Each change is recorded against your name.
        </p>

        <form className="team-names" onSubmit={(e) => { e.preventDefault(); save() }}>
          {league.players.length === 0 ? (
            <p className="report-lead">No players yet.</p>
          ) : (
            <ul className="players-list">
              {league.players.map((p) => (
                <li key={p.id}>
                  <label className="players-name" htmlFor={`team-name-${p.id}`}>{p.name}</label>
                  <input
                    id={`team-name-${p.id}`}
                    value={drafts[p.id] ?? ''}
                    placeholder="No team name"
                    disabled={busy}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  />
                </li>
              ))}
            </ul>
          )}

          {error && <p className="report-error">{error}</p>}
          {done && <p className="report-done">{done}</p>}

          <div className="report-actions">
            <button type="button" className="report-back" onClick={onClose}>Close</button>
            <button type="submit" className="report-go" disabled={busy || !changed.length}>
              {busy ? 'Saving…' : changed.length > 1 ? `Save ${changed.length} changes` : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
