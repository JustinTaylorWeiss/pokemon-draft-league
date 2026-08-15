import { useEffect, useRef, useState } from 'react'
import type { Player } from '../../data/league'

/**
 * Which player you are, in the top bar.
 *
 * Not a `<select>`. A native one opens wherever the browser decides — usually
 * over the control, with the current item under the pointer — and there is no
 * way to ask it to do otherwise. This always opens below the name, so the list
 * never covers the thing it belongs to.
 *
 * There is no "not set" choice: you are asked on arrival and the answer is
 * required, so offering a way back to nobody would only be a way to make every
 * later edit anonymous.
 */
export function WhoPicker({
  players, value, onPick,
}: {
  players: Player[]
  value: string
  onPick: (player: Player) => void
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

  const current = players.find((p) => p.id === value)

  return (
    <div className="who-picker" ref={box}>
      <button
        type="button"
        className="who-current"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Which player you are"
        onClick={() => setOpen((v) => !v)}
      >
        {current?.name ?? 'Choose'}
        <span className="who-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul className="who-list" role="listbox">
          {players.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={p.id === value}
                className={p.id === value ? 'is-current' : undefined}
                onClick={() => { onPick(p); setOpen(false) }}
              >
                {p.name}
                {p.team && <em>{p.team}</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
