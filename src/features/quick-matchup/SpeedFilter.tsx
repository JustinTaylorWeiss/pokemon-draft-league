import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Row keys to offer, already grouped the way they should be displayed. */
  rows: { stages: string[]; spreads: string[]; modifiers: string[] }
  oneName: string
  twoName: string
  filterOne: Set<string>
  filterTwo: Set<string>
  onChange: (side: 'one' | 'two', key: string, on: boolean) => void
  onReset: () => void
}

/**
 * DraftZone's speed tiers filter: one row per spread, stage and multiplier,
 * with a checkbox on each side of the label so the two teams can be filtered
 * independently — the left box is team one, the right is team two.
 */
export function SpeedFilter({ rows, oneName, twoName, filterOne, filterTwo, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Click-away and Escape both close, the way a menu is expected to behave.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = [rows.stages, rows.spreads, rows.modifiers].filter((g) => g.length)

  return (
    <div className="speed-filter" ref={wrapRef}>
      <button
        type="button"
        className={`filter-btn${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label="Filter speed tiers"
        onClick={() => setOpen((v) => !v)}
      >
        {/* Three shrinking bars — the standard filter glyph, drawn rather than
            pulled from an icon font. */}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M1 3h14M3.5 8h9M6 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
        <span>Filter</span>
      </button>

      {open && (
        <div className="filter-pop" role="group" aria-label="Speed tier filters">
          <div className="filter-pop-head">
            <span className="filter-side one" title={oneName}>{oneName}</span>
            <button type="button" className="link-btn" onClick={onReset}>Reset</button>
            <span className="filter-side two" title={twoName}>{twoName}</span>
          </div>

          {groups.map((group, gi) => (
            <div className="filter-group" key={gi}>
              {group.map((key) => (
                <div className="option-row" key={key}>
                  <input
                    type="checkbox" className="cb-one" checked={filterOne.has(key)}
                    aria-label={`${key} for ${oneName}`}
                    onChange={(e) => onChange('one', key, e.target.checked)}
                  />
                  <span className="filter-label">{key}</span>
                  <input
                    type="checkbox" className="cb-two" checked={filterTwo.has(key)}
                    aria-label={`${key} for ${twoName}`}
                    onChange={(e) => onChange('two', key, e.target.checked)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
