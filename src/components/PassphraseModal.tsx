import { useEffect, useState } from 'react'
import { errorText } from '../data/supabase'

/**
 * The one place the league asks for its passphrase.
 *
 * Three screens need it — opening a draft, editing the schedule, undoing a
 * change — and each had grown its own inline form tucked under a button. A
 * gate should look the same everywhere it appears, or people stop recognising
 * it as one.
 *
 * No click-away close: the backdrop is easy to hit and hitting it would throw
 * away a half-typed passphrase. The ✕ and Escape both close it.
 */
export function PassphraseModal({
  title, note, action, onClose, onConfirm,
}: {
  title: string
  /** What the passphrase is about to allow, in a sentence. */
  note: string
  /** The word on the button — what happens, not "OK". */
  action: string
  onClose: () => void
  /** Rejects to show a message; resolving closes the modal. */
  onConfirm: (passphrase: string) => Promise<void>
}) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!passphrase.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(passphrase)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal passphrase-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="report-title">{title}</h2>
        <p className="report-lead">{note}</p>
        <form className="passphrase-form" onSubmit={submit}>
          <input
            type="password" value={passphrase} autoFocus autoComplete="off"
            placeholder="Passphrase"
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <button type="submit" className="report-go" disabled={busy || !passphrase.trim()}>
            {busy ? 'Checking…' : action}
          </button>
        </form>
        {error && <p className="report-error">{error}</p>}
      </div>
    </div>
  )
}
