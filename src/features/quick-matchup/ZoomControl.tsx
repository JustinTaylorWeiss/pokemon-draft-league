/** Range of the zoom slider, as percentages of the fitted size. */
const MIN = 50
const MAX = 150

interface Props {
  /** 1 means "as large as fits the card", which is what the reader sees as 100%. */
  value: number
  onChange: (value: number) => void
}

/**
 * Zoom for the two panels meant to be read whole.
 *
 * 100% is the size that fills the card, not the panel's unscaled size — the
 * scale that happens to produce is an implementation detail, and a slider
 * resting at 114% invites the question of what the missing 14% is. Moving it
 * scales relative to that, and Reset returns to filling the card.
 */
export function ZoomControl({ value, onChange }: Props) {
  const shown = Math.round(value * 100)

  return (
    <label className="neutral-control zoom-control">
      <span>Zoom</span>
      <input
        type="range" min={MIN} max={MAX} step={5}
        value={Math.min(MAX, Math.max(MIN, shown))}
        aria-label="Zoom this panel"
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <output>{shown}%</output>
      {/* Only offered once there is something to undo. */}
      {shown !== 100 && (
        <button type="button" className="link-btn" onClick={() => onChange(1)}>Reset</button>
      )}
    </label>
  )
}
