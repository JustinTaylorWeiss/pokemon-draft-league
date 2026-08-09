import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface ModalApi {
  /** Opens the detail view for a dex id. */
  open: (id: string) => void
  close: () => void
  /** Currently open dex id, or null. */
  openId: string | null
}

const Ctx = createContext<ModalApi | null>(null)

/**
 * One modal for the whole site: any Pokémon name or sprite anywhere can open
 * it, so the state lives above every view rather than being duplicated per
 * panel.
 */
export function PokemonModalProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)

  const open = useCallback((id: string) => setOpenId(id), [])
  const close = useCallback(() => setOpenId(null), [])

  const api = useMemo(() => ({ open, close, openId }), [open, close, openId])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function usePokemonModal(): ModalApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePokemonModal used outside PokemonModalProvider')
  return ctx
}
