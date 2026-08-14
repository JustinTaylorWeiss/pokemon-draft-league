import { useEffect, useMemo, useState } from 'react'
import { spriteUrl } from '../../data/load'
import {
  byTier, currentSeason, reloadSeason, tierClass,
  type DraftTier, type League, type LeaguePokemon,
} from '../../data/league'
import { claimPokemon, errorText, releasePokemon } from '../../data/supabase'
import { TypeChip } from '../../components/TypeChip'
import { PokemonLink } from '../../components/PokemonLink'

/**
 * Drafting, from one player's side of it.
 *
 * You say who you are and then edit only that roster; everyone else's is shown
 * but not touchable. There is no login, so this is a convenience rather than a
 * permission — the point is to make it hard to edit the wrong team by accident,
 * not to stop someone determined.
 *
 * Who you are is remembered, because picking yourself out of twenty names on
 * every visit gets old immediately.
 */

const ME_KEY = 'league:me'

const readMe = () => {
  try { return localStorage.getItem(ME_KEY) ?? '' } catch { return '' }
}

interface Props {
  league: League
  dex: Record<string, LeaguePokemon>
}

export function DraftTeams({ league, dex }: Props) {
  const [me, setMe] = useState(readMe)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    try { localStorage.setItem(ME_KEY, me) } catch { /* private browsing */ }
  }, [me])

  const refresh = () => reloadSeason(currentSeason().id)

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setError(null)
    setSaid(null)
    try {
      setSaid(await action())
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const mine = me ? league.rosters[me] ?? [] : []
  const byTierThenName = (a: { pokemon: string; tier: DraftTier }, b: typeof a) =>
    byTier(a.tier, b.tier) || (dex[a.pokemon]?.name ?? '').localeCompare(dex[b.pokemon]?.name ?? '')

  /** Everything still on the board, which is what there is left to take. */
  const available = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return Object.entries(league.board)
      .filter(([id, e]) => !e.draftedBy && e.tier !== 'Banned'
        && (dex[id]?.name ?? e.name).toLowerCase().includes(q))
      .sort(([aId, a], [bId, b]) =>
        byTier(a.tier, b.tier) || (dex[aId]?.name ?? '').localeCompare(dex[bId]?.name ?? ''))
      .slice(0, 24)
  }, [league.board, dex, query])

  const others = league.players.filter((p) => p.id !== me)

  return (
    <div className="draft-teams">
      <div className="controls draft-who">
        <label>
          You are
          <select value={me} onChange={(e) => setMe(e.target.value)}>
            <option value="">Pick your name…</option>
            {league.players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {me && <span className="count">{mine.length} drafted</span>}
      </div>

      {!me ? (
        <p className="panel-note">Pick your name to edit your team.</p>
      ) : (
        <section className="panel draft-mine">
          <h3>
            Your team
            <span className="panel-note">
              {league.players.find((p) => p.id === me)?.name}
            </span>
          </h3>

          <ul className="draft-roster">
            {[...mine].sort(byTierThenName).map((pick) => {
              const mon = dex[pick.pokemon]
              return (
                <li key={pick.pokemon}>
                  <PokemonLink id={pick.pokemon} title={mon?.name ?? pick.pokemon}>
                    {mon && <img src={spriteUrl(mon)} alt="" width={40} height={33} loading="lazy" />}
                  </PokemonLink>
                  <span className={`${tierClass(pick.tier)} draft-tier`}>{pick.tier}</span>
                  <span className="draft-name">
                    <PokemonLink id={pick.pokemon}>{mon?.name ?? pick.pokemon}</PokemonLink>
                  </span>
                  <span className="draft-types">
                    {mon?.types.map((t) => <TypeChip key={t} type={t} />)}
                  </span>
                  <button
                    type="button" className="draft-drop" disabled={busy}
                    onClick={() => run(() => releasePokemon(me, pick.pokemon))}
                  >
                    Remove
                  </button>
                </li>
              )
            })}
            {mine.length === 0 && <li className="draft-empty">Nothing drafted yet.</li>}
          </ul>

          <div className="draft-add">
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the board to add a Pokémon…"
              aria-label="Search undrafted Pokémon"
            />
            {query.trim() && (
              <ul className="draft-results">
                {available.map(([id, entry]) => {
                  const mon = dex[id]
                  return (
                    <li key={id}>
                      {mon && <img src={spriteUrl(mon)} alt="" width={36} height={30} loading="lazy" />}
                      <span className={`${tierClass(entry.tier)} draft-tier`}>{entry.tier}</span>
                      <span className="draft-name">{mon?.name ?? entry.name}</span>
                      <button
                        type="button" className="draft-take" disabled={busy}
                        onClick={() => run(async () => {
                          const msg = await claimPokemon(me, id)
                          setQuery('')
                          return msg
                        })}
                      >
                        Draft
                      </button>
                    </li>
                  )
                })}
                {available.length === 0 && (
                  <li className="draft-empty">Nothing undrafted matches that.</li>
                )}
              </ul>
            )}
          </div>

          {error && <p className="report-error">{error}</p>}
          {said && <p className="report-done">{said}</p>}
        </section>
      )}

      <h3 className="draft-others-head">Everyone else</h3>
      <div className="draft-others">
        {others.map((p) => {
          const picks = [...(league.rosters[p.id] ?? [])].sort(byTierThenName)
          return (
            <section key={p.id} className="panel draft-other">
              <header>
                <strong>{p.name}</strong>
                <span className="panel-note">{p.team ?? '—'}</span>
                <span className="count">{picks.length}</span>
              </header>
              <ul>
                {picks.map((pick) => {
                  const mon = dex[pick.pokemon]
                  return (
                    <li key={pick.pokemon}>
                      <PokemonLink id={pick.pokemon} title={mon?.name ?? pick.pokemon}>
                        {mon && <img src={spriteUrl(mon)} alt="" width={32} height={26} loading="lazy" />}
                      </PokemonLink>
                      <span className={`${tierClass(pick.tier)} draft-tier`}>{pick.tier}</span>
                      <span className="draft-name">
                        <PokemonLink id={pick.pokemon}>{mon?.name ?? pick.pokemon}</PokemonLink>
                      </span>
                    </li>
                  )
                })}
                {picks.length === 0 && <li className="draft-empty">Nothing yet.</li>}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
