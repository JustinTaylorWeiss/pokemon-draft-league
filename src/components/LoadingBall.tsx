/**
 * Something to watch while data loads, rather than a line of text.
 *
 * Used for every wait long enough to notice. `inline` is for a panel inside a
 * page that has already drawn — it takes the space it is given rather than
 * half the viewport, so a tab loading its own data does not shove the page
 * around.
 */
export function LoadingBall({ label = 'Loading…', inline = false }: {
  label?: string
  inline?: boolean
}) {
  return (
    <div className={`loading-stage${inline ? ' is-inline' : ''}`} role="status" aria-live="polite">
      <div className="pokeball" aria-hidden="true">
        <span className="pokeball-top" />
        <span className="pokeball-band" />
        <span className="pokeball-button" />
      </div>
      <p>{label}</p>
    </div>
  )
}
