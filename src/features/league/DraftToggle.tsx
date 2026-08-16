import { useState } from 'react'
import { endDraft, startDraft, type DraftState } from '../../data/supabase'
import { PassphraseModal } from '../../components/PassphraseModal'

/**
 * Opening and closing the draft.
 *
 * The one control on this bar that says whether the league is drafting or
 * playing, so it is the one behind the passphrase. Neither direction clears
 * anything: closing a draft sets a flag, and the rosters it produced are the
 * season.
 *
 * The status is owned by the bar rather than by this button, because the
 * "draft mode" marker sits at the other end of it.
 */
export function DraftToggle({
  state, setState, onChanged,
}: {
  state: DraftState | null
  setState: (s: DraftState | null) => void
  onChanged: () => void
}) {
  const [asking, setAsking] = useState(false)
  const active = state?.status === 'active'

  return (
    <>
      <button
        type="button"
        className={`draft-switch${active ? ' is-active' : ''}`}
        onClick={() => setAsking(true)}
      >
        {/* One name for opening it, whether or not it has been open before —
            "reopen" described the league's past rather than the button. */}
        {active ? 'End draft' : 'Open draft'}
      </button>

      {asking && (
        <PassphraseModal
          title={active ? 'End the draft' : 'Open the draft'}
          note={active
            ? 'Closing a draft clears nothing. The rosters it produced stay exactly as they are, and roster changes after this are recorded as trades.'
            : 'While a draft is open, roster changes are recorded as picks rather than trades.'}
          action={active ? 'End draft' : 'Open draft'}
          onClose={() => setAsking(false)}
          onConfirm={async (passphrase) => {
            const next = active ? await endDraft(passphrase) : await startDraft(passphrase)
            setState(next as DraftState)
            setAsking(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}
