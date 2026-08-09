import type { ReactNode } from 'react'

interface Props {
  title: string
  /** Controls rendered on the right of the header, e.g. toggles. */
  actions?: ReactNode
  /** Intrinsic width; the container is flex-wrap, so widgets flow into rows. */
  width?: number
  children: ReactNode
  footnote?: ReactNode
}

/**
 * The panel shell every matchup widget sits in. DraftZone gives each widget a
 * fixed intrinsic width and lets a centered flex-wrap row pack them, which is
 * why the results page reads as an uneven two-up grid rather than a stack.
 */
export function Widget({ title, actions, width, children, footnote }: Props) {
  return (
    <section className="widget" style={width ? { width } : undefined}>
      <header className="widget-header">
        <span className="widget-label">{title}</span>
        {actions && <div className="widget-actions">{actions}</div>}
      </header>
      <div className="widget-body">{children}</div>
      {footnote && <p className="widget-note">{footnote}</p>}
    </section>
  )
}
