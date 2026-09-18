import { useEffect, useMemo, useState } from 'react'
import {
  byTier, currentSeason, isMega, megaParts, reloadSeason, TIER_ORDER, tierClass,
  type DraftTier, type League, type LeaguePokemon,
} from '../../data/league'
import {
  claimPokemon, currentSeasonId, db, draftState, errorText, releasePokemon, type DraftState,
} from '../../data/supabase'
import { snakeDraft } from '../../lib/snakeDraft'
import { isSpectator, myPlayerId, subscribeIdentity } from '../../data/identity'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import { PokemonLink } from '../../components/PokemonLink'
import { Sprite } from '../../components/Sprite'

/**
 * How long ago something was, in the largest two units that say anything.
 *
 * A draft runs over days and a pick over hours, so one format has to carry
 * both — and seconds only earn their place in the minute after a pick lands,
 * which is the one time anybody is watching them.
 */
function since(from: number, now: number): string {
  const total = Math.max(0, Math.floor((now - from) / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor(total / 3600) % 24
  const mins = Math.floor(total / 60) % 60
  const secs = total % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${String(mins).padStart(2, '0')}m`
  if (mins) return `${mins}m ${String(secs).padStart(2, '0')}s`
  return `${secs}s`
}

/**
 * A clock counting up from a moment.
 *
 * Its own component with its own state, because it ticks every second and the
 * screen around it is twenty seats and everybody's rosters. Re-rendering that
 * once a second to move one digit would be the most expensive thing on the page.
 */
function Elapsed({ from, label }: { from: number; label: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="draft-clock" title={`Since ${new Date(from).toLocaleString()}`}>
      <em>{label}</em>
      <strong>{since(from, now)}</strong>
    </span>
  )
}

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
  const [identity, setIdentity] = useState(myPlayerId)
  useEffect(() => subscribeIdentity(setIdentity), [])
  /**
   * Whether this season can be edited at all. Season 4 is a finished record
   * read from a file — it has no rows in the database, and a write aimed at it
   * would land on whichever season the fallback names, which is somebody
   * else's. Nothing here offers to write to it.
   */
  const editable = currentSeason().source === 'database'
  /**
   * The player whose roster this screen may edit. Nobody, on a season that
   * cannot be edited or to somebody watching — in both cases the screen reads
   * the way it does for anyone who has not said who they are: everyone's teams,
   * none of them yours.
   */
  const me = editable && !isSpectator(identity) ? identity : ''
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

  /**
   * The order only means anything while a draft is running. After it closes the
   * numbers are still on the players, but nobody is "up" any more.
   */
  const [draft, setDraft] = useState<DraftState | null>(null)
  useEffect(() => {
    let live = true
    draftState().then((d) => { if (live) setDraft(d) }, () => {})
    return () => { live = false }
  }, [league])

  const order = useMemo(
    () => (draft?.status === 'active' ? snakeDraft(league.players, league.rosters) : null),
    [draft, league.players, league.rosters],
  )

  /**
   * What each coach has taken, in the order they took it.
   *
   * Nothing stores a draft as a sequence. `snakeDraft` works the round out from
   * how many Pokémon people are holding, deliberately — a stored pointer drifts
   * the moment anybody releases a pick or a player is restored halfway through,
   * where a count cannot. `draft_picks` exists and would say it outright, but
   * `claim_pokemon` has never written to it, so for a season drafted on the
   * site it is empty.
   *
   * The event log does say it. Every roster insert is recorded there with the
   * time it happened, by a trigger, so the order can be read without anything
   * new being written and without a second copy to fall out of step. Filtered
   * to what is still held, so a pick that was released and replaced shows the
   * replacement rather than something that has left the team.
   */
  const [takenInOrder, setTakenInOrder] = useState<Record<string, string[]>>({})
  /** When each pick landed, for the clock on whoever is up. */
  const [pickTimes, setPickTimes] = useState<string[]>([])
  useEffect(() => {
    let live = true
    db.from('events')
      .select('at,after')
      .eq('season_id', currentSeasonId())
      .eq('table_name', 'rosters')
      .eq('action', 'insert')
      .order('id', { ascending: true })
      .then(({ data }) => {
        if (!live) return
        const rows = (data ?? []) as {
          at: string
          after: { player_id?: string; pokemon_id?: string } | null
        }[]
        setPickTimes(rows.map((row) => row.at))
        const out: Record<string, string[]> = {}
        for (const row of rows) {
          const player = row.after?.player_id
          const mon = row.after?.pokemon_id
          if (!player || !mon) continue
          if (!league.rosters[player]?.some((pick) => pick.pokemon === mon)) continue
          const taken = (out[player] ??= [])
          // A Pokémon can be inserted more than once — released and taken
          // again, or an import that ran twice — and each one is logged. The
          // latest is when it was actually acquired, so earlier ones give way
          // rather than the same pick appearing at two places in the order.
          const earlier = taken.indexOf(mon)
          if (earlier >= 0) taken.splice(earlier, 1)
          taken.push(mon)
        }
        setTakenInOrder(out)
      }, () => {})
    return () => { live = false }
  }, [league])

  /**
   * When the coach who is up went on the clock: the last pick to land, or the
   * moment the draft opened if none has.
   *
   * Anything before the draft opened is ignored. A roster can be edited outside
   * one — this season had a pick the day before it started, since released —
   * and counting that would run the clock from before there was anything to be
   * on the clock for.
   */
  const onClockSince = useMemo(() => {
    const opened = draft?.started_at ? new Date(draft.started_at).getTime() : null
    if (opened == null || Number.isNaN(opened)) return null
    return pickTimes
      .map((at) => new Date(at).getTime())
      .filter((t) => !Number.isNaN(t) && t >= opened)
      .reduce((a, b) => Math.max(a, b), opened)
  }, [draft, pickTimes])

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

  // Everyone, where none of them is you — a finished season has no "else".
  const others = me ? league.players.filter((p) => p.id !== me) : league.players

  return (
    <div className="draft-teams">
      {/* The draft order is about the league and not about your team, so it
          sits outside the panel that holds yours and shows whoever is looking.
          Someone watching came to see whose turn it is as much as anybody. */}
      {order && (
        <section className="panel draft-order-panel">
          <div className="draft-order" aria-label={`Draft order, round ${order.round}`}>
            <h4>
              Draft order
              <span className="panel-note">Round {order.round}</span>
              {onClockSince != null && <Elapsed from={onClockSince} label="Current pick:" />}
              {draft?.started_at && (
                <Elapsed from={new Date(draft.started_at).getTime()} label="Entire draft:" />
              )}
            </h4>
            <ol>
              {order.seats.map((seat) => (
                <li
                  key={seat.player}
                  className={`${seat.isUp ? 'is-up' : ''}${seat.player === me ? ' is-me' : ''}`}
                  title={seat.isUp ? `${seat.name} is up` : undefined}
                >
                  <span className="draft-order-pos">{seat.order}</span>
                  <span className="draft-order-who">
                    <strong>{seat.name}</strong>
                    {/* How far along they are, which is also what decides
                        whose turn it is. */}
                    <em>{seat.picks} drafted</em>
                  </span>
                  {/* What they took this round, for the seats that have been.
                      The ones still to come show nothing rather than a dash:
                      the gap is the point, and it is where the strip is
                      waiting. */}
                  {(() => {
                    const id = takenInOrder[seat.player]?.[order.round - 1]
                    const mon = id ? dex[id] : null
                    if (!mon) return null
                    return (
                      <span className="draft-order-pick" title={mon.name}>
                        {/* The sprite alone. The strip is a row of chips read
                            at a glance for who is up, and a name on each one
                            is wider than the name of the person who took it.
                            The title says which, and the team below spells it
                            out. */}
                        <Sprite pokemon={mon} width={34} height={28} />
                      </span>
                    )
                  })()}
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {!me ? (
        editable && (
          <p className="panel-note">
            {isSpectator(identity)
              ? 'You are watching. Choose your name beside the season to edit a team.'
              : 'Say who you are, beside the season, to edit your team.'}
          </p>
        )
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
                    {budget == null && <th>Tier</th>}
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
                        {budget == null && (
                          <td>
                            <span className={tierClass(pick.tier)}>{pick.tier}</span>
                          </td>
                        )}
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
                        {budget == null
                          ? <span className={`${tierClass(entry.tier)} draft-tier`}>{entry.tier}</span>
                          : (
                            <span className="draft-cost" title={`Costs ${entry.points ?? 0}`}>
                              {entry.tier === 'Banned' ? '—' : entry.points ?? 0}
                            </span>
                          )}
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

      <h3 className="draft-others-head">{me ? 'Everyone else' : 'Teams'}</h3>
      <div className="draft-others">
        {others.map((p) => {
          const picks = [...(league.rosters[p.id] ?? [])].sort(byTierThenName)
          /**
           * What this team has spent, against what everyone gets.
           *
           * The same number your own panel leads with, because on a points
           * season it is the whole shape of a draft: who can still afford a
           * twenty and who is buying tens for the rest of the way. The costs
           * are already on every row here, but a column of them is not a
           * total, and adding eleven of them up is not reading.
           */
          const theirs = picks.reduce((total, pick) => total + (pick.points ?? 0), 0)
          return (
            <section key={p.id} className="panel draft-other">
              <header>
                <strong>{p.name}</strong>
                <span className="draft-other-count">{picks.length}</span>
                <span className="panel-note">{p.team ?? '—'}</span>
                {budget != null && (
                  <span
                    className={`draft-other-points${theirs > budget ? ' is-over' : ''}`}
                    title={`${budget - theirs} of ${budget} left`}
                  >
                    {theirs}/{budget}
                  </span>
                )}
              </header>
              <ul>
                {picks.map((pick) => {
                  const mon = dex[pick.pokemon]
                  return (
                    <li key={pick.pokemon}>
                      {budget == null
                        ? <span className={`${tierClass(pick.tier)} draft-tier`}>{pick.tier}</span>
                        : <span className="draft-cost">{pick.points ?? 0}</span>}
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
