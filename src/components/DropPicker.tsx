import { useEffect, useRef, useState } from 'react'

/**
 * A picker whose list always opens below it.
 *
 * Not a `<select>`, and that is the whole point: a native one opens wherever
 * the browser decides — usually over the control, with the current item under
 * the pointer — and nothing in CSS asks it to do otherwise. This anchors the
 * list under the button so it never covers what it belongs to.
 *
 * Shared by the two pickers in the top bar rather than written twice: the
 * click-away and Escape handling is the fiddly part and only wants one home.
 */

export interface DropItem {
  id: string
  label: string
  /** A second line under the label — a team, a format, a hint. */
  note?: string | null
}

export function DropPicker({
  items, value, onPick, ariaLabel, className, placeholder = 'Choose',
}: {
  items: DropItem[]
  value: string
  onPick: (item: DropItem) => void
  ariaLabel: string
  /** Distinguishes the two in CSS; behaviour is identical. */
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const current = items.find((i) => i.id === value)

  return (
    <div className={`drop-picker${className ? ` ${className}` : ''}`} ref={box}>
      <button
        type="button"
        className="drop-current"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="drop-label">{current?.label ?? placeholder}</span>
        <span className="drop-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul className="drop-list" role="listbox">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={item.id === value}
                className={item.id === value ? 'is-current' : undefined}
                onClick={() => { onPick(item); setOpen(false) }}
              >
                {item.label}
                {item.note && <em>{item.note}</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
