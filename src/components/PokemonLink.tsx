import type { ReactNode } from 'react'
import { usePokemonModal } from '../features/pokemon/PokemonModalContext'

interface Props {
  /** Dex id, the key everything else joins on. */
  id: string
  children: ReactNode
  className?: string
  title?: string
}

/**
 * Wraps any Pokémon name or sprite so clicking it opens the detail modal.
 * Renders a button rather than an anchor: there is no URL to navigate to, and
 * a button gets keyboard activation for free.
 */
export function PokemonLink({ id, children, className, title }: Props) {
  const { open } = usePokemonModal()
  return (
    <button
      type="button"
      className={`mon-link${className ? ` ${className}` : ''}`}
      onClick={(e) => { e.stopPropagation(); open(id) }}
      title={title}
    >
      {children}
    </button>
  )
}
