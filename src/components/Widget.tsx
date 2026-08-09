import type { ReactNode } from 'react'

export interface WidgetTab {
  key: string
  label: string
}

interface Props {
  /** Used when the widget shows a single panel. Ignored if `tabs` is given. */
  title?: string
  /** Turns the header into a tab strip so two panels can share one card. */
  tabs?: WidgetTab[]
  active?: string
  onTab?: (key: string) => void
  /** Controls rendered on the right of the header, e.g. toggles. */
  actions?: ReactNode
  /** Intrinsic width; the container is flex-wrap, so widgets flow into rows. */
  width?: number
  children: ReactNode
  footnote?: ReactNode
  /** Extra classes, e.g. to let a card stretch to the row's full height. */
  className?: string
  /** Caps the card so a long body scrolls instead of outgrowing its neighbour. */
  maxHeight?: number | null
}

/**
 * The panel shell every matchup widget sits in. DraftZone gives each widget a
 * fixed intrinsic width and lets a centered flex-wrap row pack them, which is
 * why the results page reads as an uneven two-up grid rather than a stack.
 */
export function Widget({
  title, tabs, active, onTab, actions, width, children, footnote, className, maxHeight,
}: Props) {
  return (
    <section
      className={`widget${className ? ` ${className}` : ''}`}
      style={{ ...(width && { width }), ...(maxHeight && { maxHeight }) }}
    >
      {tabs ? (
        <>
          {/* Tabs split the title bar evenly, each underlining its own half. */}
          <div className="widget-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key} type="button" role="tab"
                aria-selected={active === t.key}
                className={active === t.key ? 'is-active' : ''}
                onClick={() => onTab?.(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {actions && <div className="widget-toolbar">{actions}</div>}
        </>
      ) : (title || actions) ? (
        <header className="widget-header">
          {title && <span className="widget-label">{title}</span>}
          {actions && <div className="widget-actions">{actions}</div>}
        </header>
      ) : null}
      <div className="widget-body">{children}</div>
      {footnote && <p className="widget-note">{footnote}</p>}
    </section>
  )
}
