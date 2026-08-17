import { useEffect, useMemo, useState } from 'react'
import {
  byTier, currentSeason, isMega, megaParts, reloadSeason, TIER_ORDER, tierClass,
  type DraftTier, type League, type LeaguePokemon,
} from '../../data/league'
import { claimPokemon, errorText, releasePokemon } from '../../data/supabase'
import { myPlayerId, subscribeIdentity } from '../../data/identity'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import { PokemonLink } from '../../components/PokemonLink'
import { Sprite } from '../../components/Sprite'

/**
 * Drafting, from one player's side of it.
 *
 * You say who you are and then edit only that roster; everyone else's is shown
 * but not touchable. There is no login, so this is a convenience rather than a
 * permission — the point is to make it hard to edit the wrong team by accident,
 * not to stop someone determined.
 *
 * Who you are is set once for the whole site, beside the season, rather than
 * here — it decides what the history records as well as which team this screen
 * edits, and two places to answer the same question is one too many.
 */

/** Best to worst, which is the order the board and the rules use. */
const TIER_PILLS = [...TIER_ORDER].reverse()

interface Props {
  league: League
  dex: Record<string, LeaguePokemon>
}

export function DraftTeams({ league, dex }: Props) {
  const [me, setMe] = useState(myPlayerId)
  useEffect(() => subscribeIdentity(setMe), [])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)

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
  /**
   * The Mega cap, and how much of it is used. Absent for a season that does not
   * limit them — which is every season that has none to draft.
   */
  const megaCap = league.meta.tierLimits?.Mega ?? null
  const megasHeld = mine.filter((pick) => isMega(dex[pick.pokemon])).length

  /**
   * On a points season the budget is the constraint and the tier is only a
   * colour, so the tier caps come down and this goes up in their place. The
   * Mega cap stays either way — it is a separate rule about what a team may
   * hold, not a restatement of the tier limits.
   */
  const budget = league.meta.pointsBudget
  const spent = mine.reduce((total, pick) => total + (pick.points ?? 0), 0)
  /** The board names who drafted a Pokémon, not their id. */
  const myName = league.players.find((p) => p.id === me)?.name ?? ''
  const byTierThenName = (a: { pokemon: string; tier: DraftTier }, b: typeof a) =>
    byTier(a.tier, b.tier) || (dex[a.pokemon]?.name ?? '').localeCompare(dex[b.pokemon]?.name ?? '')

  /**
   * What the board has, matching the search.
   *
   * Taken and banned Pokémon are listed rather than filtered out. Hiding them
   * makes a search for one look like a spelling mistake; showing them, greyed
   * and saying who has it, answers the question that was actually being asked.
   * Free ones come first, since those are the ones you can act on.
   */
  const available = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return Object.entries(league.board)
      .filter(([id, e]) => (dex[id]?.name ?? e.name).toLowerCase().includes(q))
      .sort(([aId, a], [bId, b]) => {
        const free = (e: typeof a) => (!e.draftedBy && e.tier !== 'Banned' ? 0 : 1)
        return free(a) - free(b)
          || byTier(a.tier, b.tier)
          || (dex[aId]?.name ?? '').localeCompare(dex[bId]?.name ?? '')
      })
      .slice(0, 24)
  }, [league.board, dex, query])

  const others = league.players.filter((p) => p.id !== me)

  return (
    <div className="draft-teams">
      {!me ? (
        <p className="panel-note">Say who you are, beside the season, to edit your team.</p>
      ) : (
        <section className="panel draft-mine">
          <div className="draft-head">
            <h3>
              Your team
              <span className="panel-note">
                {league.players.find((p) => p.id === me)?.name}
              </span>
              <span className="count">{mine.length} drafted</span>
            </h3>

            {/* The rule, where the picking happens. A tier with no entry in the
                league's limits has none — absent means unlimited rather than
                zero, which is why it is not simply printed as a number. */}
            <dl className="tier-limits">
              {budget != null && (
                <div className="points-budget">
                  <dt>Points</dt>
                  <dd
                    className={spent > budget ? 'is-over' : undefined}
                    title={`${budget - spent} of ${budget} left`}
                  >
                    {spent}/{budget}
                  </dd>
                </div>
              )}
              {/* Only where the season defines one. A Mega is not a tier — it
                  carries a tier of its own — so this is a second cap counted
                  over the same team, and a season with no Megas has no row. */}
              {megaCap != null && (
                <div>
                  <dt className="mega-badge">Mega</dt>
                  <dd
                    className={megasHeld > megaCap ? 'is-over' : undefined}
                    title={`Limit of ${megaCap}`}
                  >
                    {megasHeld}/{megaCap}
                  </dd>
                </div>
              )}
              {budget == null && TIER_PILLS.filter((t) => t !== 'Banned').map((t) => {
                const cap = league.meta.tierLimits?.[t]
                const held = mine.filter((pick) => pick.tier === t).length
                const over = cap != null && held > cap
                return (
                  <div key={t}>
                    <dt className={tierClass(t)}>{t}</dt>
                    {/* An uncapped tier still reads as a fraction, so the row
                        scans as one line of held-against-limit rather than one
                        number and a sentence. */}
                    <dd
                      className={over ? 'is-over' : undefined}
                      title={cap ? `Limit of ${cap}` : 'No limit on this tier'}
                    >
                      {held}/{cap ?? '∞'}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>

          {mine.length === 0 ? (
            <p className="draft-empty">Nothing drafted yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="stat-table draft-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    {budget != null && <th className="draft-col-pts">Pts</th>}
                    <th className="draft-col-name">Pokémon</th>
                    <th className="draft-col-types">Types</th>
                    <th className="draft-col-abil">Abilities</th>
                    {BST_ORDER.map((k) => <th key={k}>{STAT_LABELS[k]}</th>)}
                    <th>BST</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...mine].sort(byTierThenName).map((pick) => {
                    const mon = dex[pick.pokemon]
                    // The hidden ability is the one keyed "H", and reads as such.
                    const abilities = Object.entries(mon?.abilities ?? {})
                    return (
                      <tr key={pick.pokemon}>
                        <td>
                          <span className={tierClass(pick.tier)}>{pick.tier}</span>
                        </td>
                        {budget != null && (
                          <td className="draft-col-pts">
                            {/* What was paid, which is not always what the board
                                asks now — a re-pricing does not resettle a team. */}
                            {pick.points ?? <em className="none">—</em>}
                          </td>
                        )}
                        <th scope="row" className="draft-col-name">
                          <PokemonLink id={pick.pokemon} title={mon?.name ?? pick.pokemon}>
                            {mon && (
                              <Sprite pokemon={mon} width={40} height={33} />
                            )}
                          </PokemonLink>
                          <PokemonLink id={pick.pokemon}>
                            {mon ? megaParts(mon).name : pick.pokemon}
                          </PokemonLink>
                          {mon && megaParts(mon).badge && (
                            <span className="mega-badge">{megaParts(mon).badge}</span>
                          )}
                        </th>
                        <td className="draft-col-types">
                          {mon?.types.map((t) => <TypeChip key={t} type={t} />)}
                        </td>
                        <td className="draft-col-abil">
                          {/* Wrapped rather than making the cell itself a flex
                              box: a <td> that is display:flex stops being a
                              table cell and drops out of the row's alignment. */}
                          <span className="draft-abils">
                            {abilities.length === 0 ? '—' : abilities.map(([slot, name]) => (
                              <span
                                key={slot}
                                className={slot === 'H' ? 'draft-hidden-ability' : undefined}
                                title={slot === 'H' ? 'Hidden ability' : undefined}
                              >
                                {name}
                              </span>
                            ))}
                          </span>
                        </td>
                        {BST_ORDER.map((k) => (
                          <td key={k} className="draft-stat">{mon?.baseStats[k] ?? '—'}</td>
                        ))}
                        <td className="draft-bst">{mon?.bst ?? '—'}</td>
                        <td>
                          <button
                            type="button" className="draft-drop" disabled={busy}
                            onClick={() => run(() => releasePokemon(me, pick.pokemon))}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

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
                  const banned = entry.tier === 'Banned'
                  const taken = Boolean(entry.draftedBy)
                  const why = banned ? 'Banned'
                    : entry.draftedBy === myName ? 'On your team'
                    : taken ? `Drafted by ${entry.draftedBy}` : null
                  return (
                    <li key={id}>
                      {/* The row is the control. A separate Draft button on
                          every result was a small target repeated twenty times
                          for the only thing a result can do. */}
                      <button
                        type="button"
                        className={`draft-result${why ? ' is-gone' : ''}`}
                        disabled={busy || Boolean(why)}
                        title={why ?? `Draft ${mon?.name ?? entry.name}`}
                        onClick={() => run(async () => {
                          const msg = await claimPokemon(me, id)
                          setQuery('')
                          return msg
                        })}
                      >
                        <span className={`${tierClass(entry.tier)} draft-tier`}>{entry.tier}</span>
                        {mon && <Sprite pokemon={mon} width={36} height={30} />}
                        <span className="draft-name">{mon?.name ?? entry.name}</span>
                        {why && <span className="draft-taken">{why}</span>}
                      </button>
                    </li>
                  )
                })}
                {available.length === 0 && (
                  <li className="draft-empty">Nothing on the board matches that.</li>
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
                <span className="draft-other-count">{picks.length}</span>
                <span className="panel-note">{p.team ?? '—'}</span>
              </header>
              <ul>
                {picks.map((pick) => {
                  const mon = dex[pick.pokemon]
                  return (
                    <li key={pick.pokemon}>
                      <span className={`${tierClass(pick.tier)} draft-tier`}>{pick.tier}</span>
                      <PokemonLink id={pick.pokemon} title={mon?.name ?? pick.pokemon}>
                        {mon && <Sprite pokemon={mon} width={32} height={26} />}
                      </PokemonLink>
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
