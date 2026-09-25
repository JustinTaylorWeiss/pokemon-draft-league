import type { TypeName } from '../data/types'

interface Props {
  type: TypeName
  /** Rendered dim when the Pokémon has no move of this type. */
  muted?: boolean
  onClick?: () => void
  /**
   * The chip's box while the reader is on it, and null when they leave, for
   * anchoring a HoverTip. Focus counts as hovering: these are buttons, and a
   * keyboard has to be able to read what a mouse can.
   */
  onHover?: (rect: DOMRect | null) => void
}

export function TypeChip({ type, muted, onClick, onHover }: Props) {
  const cls = `type-chip type-${type.toLowerCase()}${muted ? ' is-muted' : ''}`
  // The label is wrapped rather than left as a bare text node: as an anonymous
  // flex item it ignored the chip's justify-content and sat against the left
  // padding, which shows once the chip has a fixed width wider than the word.
  const label = <span className="type-chip-text">{type}</span>
  const hover = onHover && {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => onHover(e.currentTarget.getBoundingClientRect()),
    onMouseLeave: () => onHover(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => onHover(e.currentTarget.getBoundingClientRect()),
    onBlur: () => onHover(null),
  }
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} {...hover}>{label}</button>
  ) : (
    <span className={cls} {...hover}>{label}</span>
  )
}
