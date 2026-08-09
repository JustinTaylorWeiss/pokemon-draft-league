import type { TypeName } from '../data/types'

interface Props {
  type: TypeName
  /** Rendered dim when the Pokémon has no move of this type. */
  muted?: boolean
  onClick?: () => void
  title?: string
}

export function TypeChip({ type, muted, onClick, title }: Props) {
  const cls = `type-chip type-${type.toLowerCase()}${muted ? ' is-muted' : ''}`
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title}>{type}</button>
  ) : (
    <span className={cls} title={title}>{type}</span>
  )
}
