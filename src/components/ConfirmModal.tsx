import { useEffect } from 'react'

/**
 * A yes-or-no before something that is hard to take back.
 *
 * Built like [[PassphraseModal]] and for the same reason: a gate should look
 * the same everywhere it appears, or people stop recognising one. Same
 * backdrop, same ✕, same Escape, and the same refusal to close on a
 * click-away — the backdrop is the easiest thing on the screen to hit by
 * accident, which is exactly the accident this is here to prevent.
 *
 * The button says what will happen rather than "OK", so the last thing read
 * before the click is the thing being agreed to.
 */
export function ConfirmModal({
  title, note, action, danger = false, busy = false, onClose, onConfirm,
}: {
  title: string
  /** What is about to happen, in a sentence. */
  note: string
  /** The word on the button — what happens, not "OK". */
  action: string
  /** Red, for anything that takes something away. */
  danger?: boolean
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop">
      <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="report-title">{title}</h2>
        <p className="report-lead">{note}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-no" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {/* Focused on open, so Enter agrees and Escape does not — and so a
              keyboard lands on the choice rather than on the ✕. */}
          <button
            type="button" autoFocus disabled={busy}
            className={`report-go${danger ? ' is-danger' : ''}`}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : action}
          </button>
        </div>
      </div>
    </div>
  )
}
