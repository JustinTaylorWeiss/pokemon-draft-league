import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react'

/**
 * A tab the thing that opened the modal wants to put in it.
 *
 * The modal knows about a Pokémon; it knows nothing about how one is being
 * built on the page behind it, and should not have to. So the opener says
 * what to call the tab and fills it in itself, through `slot`.
 */
export interface ModalTab {
  /** What the tab says. */
  label: string
  /** Which Pokémon it was opened for, so a stale panel never shows. */
  id: string
}

interface ModalApi {
  /** Opens the detail view for a dex id, with an extra tab where one is given. */
  open: (id: string, tab?: ModalTab | null) => void
  close: () => void
  /** Currently open dex id, or null. */
  openId: string | null
  /** The extra tab this one was opened with, if any. */
  tab: ModalTab | null
  /**
   * Where that tab's content goes.
   *
   * The modal puts an empty box in the page and says where it is; whoever
   * asked for the tab renders into it from where it lives, so the panel
   * stays part of the page that owns its state rather than becoming a
   * copy of it that has to be kept up to date.
   */
  slot: HTMLElement | null
  setSlot: (el: HTMLElement | null) => void
}

const Ctx = createContext<ModalApi | null>(null)

/**
 * One modal for the whole site: any Pokémon name or sprite anywhere can open
 * it, so the state lives above every view rather than being duplicated per
 * panel.
 */
export function PokemonModalProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useState<ModalTab | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  // Both at once, so the modal's first render already knows whether it has
  // a second tab and which one to open on.
  const open = useCallback((id: string, next: ModalTab | null = null) => {
    setOpenId(id)
    setTab(next)
  }, [])
  const close = useCallback(() => { setOpenId(null); setTab(null) }, [])

  const api = useMemo(
    () => ({ open, close, openId, tab, slot, setSlot }),
    [open, close, openId, tab, slot],
  )
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function usePokemonModal(): ModalApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePokemonModal used outside PokemonModalProvider')
  return ctx
}
