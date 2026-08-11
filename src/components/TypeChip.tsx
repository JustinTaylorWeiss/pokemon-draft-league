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
  // The label is wrapped rather than left as a bare text node: as an anonymous
  // flex item it ignored the chip's justify-content and sat against the left
  // padding, which shows once the chip has a fixed width wider than the word.
  const label = <span className="type-chip-text">{type}</span>
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title}>{label}</button>
  ) : (
    <span className={cls} title={title}>{label}</span>
  )
}
