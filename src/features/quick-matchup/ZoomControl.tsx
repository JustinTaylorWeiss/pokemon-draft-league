/** Range of the zoom slider, as percentages. */
const MIN = 50
const MAX = 150

interface Props {
  /** The reader's chosen zoom, or null while the panel is auto-fitting. */
  value: number | null
  /** Scale the panel picked for itself, shown while `value` is null. */
  fitted: number
  onChange: (value: number | null) => void
}

/**
 * Zoom for the two panels meant to be read whole. Until it is touched it shows
 * and follows the scale the panel chose for itself, so it keeps re-fitting as
 * the window changes; moving it pins the zoom, and Fit hands control back.
 */
export function ZoomControl({ value, fitted, onChange }: Props) {
  const shown = Math.round((value ?? fitted) * 100)

  return (
    <label className="neutral-control zoom-control">
      <span>Zoom</span>
      <input
        type="range" min={MIN} max={MAX} step={5} value={Math.min(MAX, Math.max(MIN, shown))}
        aria-label="Zoom this panel"
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <output>{shown}%</output>
      {/* Only offered once there is something to undo. */}
      {value !== null && (
        <button type="button" className="link-btn" onClick={() => onChange(null)}>Fit</button>
      )}
    </label>
  )
}
