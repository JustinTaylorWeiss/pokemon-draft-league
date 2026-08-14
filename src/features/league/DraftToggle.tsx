import { useEffect, useState } from 'react'
import { draftState, endDraft, errorText, startDraft, type DraftState } from '../../data/supabase'

/**
 * Opening and closing the draft.
 *
 * The one control here that needs the passphrase, because it says whether the
 * league is drafting or playing. Both directions are gated and neither clears
 * anything: closing a draft sets a flag, and the rosters it produced are the
 * season.
 *
 * The passphrase is asked for at the point of clicking rather than up front —
 * there is only one action behind it, so a separate unlock step would be a
 * screen that exists to be dismissed.
 */
export function DraftToggle({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<DraftState | null>(null)
  const [asking, setAsking] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { draftState().then(setState, () => {}) }, [])

  const active = state?.status === 'active'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!passphrase.trim()) return
    setBusy(true)
    setError(null)
    try {
      const next = active ? await endDraft(passphrase) : await startDraft(passphrase)
      setState(next as DraftState)
      setAsking(false)
      setPassphrase('')
      onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const label = state === null
    ? 'Draft'
    : active ? 'End draft' : state.status === 'complete' ? 'Reopen draft' : 'Start draft'

  return (
    <div className="draft-toggle">
      <span className={`draft-status is-${state?.status ?? 'unknown'}`}>
        {active ? 'Drafting' : state?.status === 'complete' ? 'Draft closed' : 'Not started'}
      </span>
      <button
        type="button"
        className={`draft-switch${active ? ' is-active' : ''}`}
        onClick={() => { setAsking((v) => !v); setError(null) }}
        aria-expanded={asking}
      >
        {label}
      </button>

      {asking && (
        <form className="draft-ask" onSubmit={submit}>
          <input
            type="password" value={passphrase} autoFocus autoComplete="off"
            placeholder="Passphrase"
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <button type="submit" disabled={busy || !passphrase.trim()}>
            {busy ? '…' : active ? 'End' : 'Start'}
          </button>
          {error && <p className="report-error">{error}</p>}
        </form>
      )}
    </div>
  )
}
