import { Fragment, useEffect, useMemo, useState } from 'react'
import { loadPokemon } from '../../data/load'
import type { PokemonDex } from '../../data/types'
import {
  byId, byTier, currentSeason, loadLeague, megaParts, mergeDex, reloadSeason, subscribeLeague,
  tierClass,
  totalsFromMatches, type Standing,
  type GameLine, type League, type LeaguePokemon, type Match, type MatchStat,
  type PokemonTotals,
} from '../../data/league'
import { BST_ORDER, STAT_LABELS } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import type { LeagueTab } from './tabs'
import './league.css'
import { PokemonLink } from '../../components/PokemonLink'
import { LoadingBall } from '../../components/LoadingBall'
import { PassphraseModal } from '../../components/PassphraseModal'
import { ManagePlayers } from './ManagePlayers'
import { DraftToggle } from './DraftToggle'
import { draftState, type DraftState } from '../../data/supabase'
import { errorText, removeWeek, scheduleMatch, unlock, unscheduleMatch } from '../../data/supabase'
import { DropPicker } from '../../components/DropPicker'
import { DraftTeams } from './DraftTeams'
import { History } from './History'
import { Sprite } from '../../components/Sprite'
import { ruleFor } from '../../lib/awards'

export function LeagueView({ tab }: { tab: LeagueTab }) {
  const [league, setLeague] = useState<League | null>(null)
  const [rawDex, setRawDex] = useState<PokemonDex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([loadLeague(), loadPokemon()]).then(
      ([l, d]) => { setLeague(l); setRawDex(d) },
      (err: Error) => setError(err.message),
    )
    // A sheet refresh republishes the league; pick it up without a reload.
    return subscribeLeague(setLeague)
  }, [])

  /** Sheet values win over the Showdown dataset everywhere they overlap. */
  const dex = useMemo(
    () => (rawDex ? mergeDex(rawDex, league) : null),
    [rawDex, league],
  )

  if (error) {
    return (
      <p className="error">
        Could not load the league sheet: {error}. Run <code>npm run import:league -- &lt;file-or-url&gt;</code> first.
      </p>
    )
  }
  if (!league || !dex) return <LoadingBall label="Loading league…" />

  return (
    <div className="league">
      {tab === 'standings' && <Standings league={league} dex={dex} />}
      {tab === 'matches' && <Matches league={league} dex={dex} />}
      {tab === 'board' && <Board league={league} dex={dex} />}
      {tab === 'my-team' && <DraftTeams league={league} dex={dex} />}
      {tab === 'history' && <History league={league} />}
      {tab === 'stats' && <Stats league={league} dex={dex} />}
      {tab === 'rules' && <Rules league={league} />}
    </div>
  )
}

/** Podium markers for the top three, keyed by rank. */
const MEDALS: Record<number, { icon: string; label: string }> = {
  1: { icon: '🥇', label: '1st' },
  2: { icon: '🥈', label: '2nd' },
  3: { icon: '🥉', label: '3rd' },
}

/**
 * A never-fainted Pokémon has an infinite K/D, and `Infinity - Infinity` is
 * NaN, so ratios are compared through a finite stand-in rather than silently
 * losing their ordering.
 */
const finite = (n: number) => (n === Infinity ? Number.MAX_VALUE : n)

/**
 * The ranking shown when no column is sorted. Each step only decides the rows
 * the one before it left tied.
 */
const byPowerRanking = (a: PokemonTotals, b: PokemonTotals) =>
  b.diff - a.diff
  || finite(b.kd) - finite(a.kd)
  || b.killsPerGame - a.killsPerGame
  || b.kills - a.kills
  || b.gamesPlayed - a.gamesPlayed
  || a.deaths - b.deaths

/** The same order, said in words, for the header. */
const POWER_RANKING_NOTE = 'Diff → K/D → KOs/game → KOs → games → fewest deaths'

type StatSort = 'kills' | 'deaths' | 'diff' | 'gamesPlayed' | 'killsPerGame' | 'kd' | 'name' | 'tier'

function Stats({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  // dir 0 is the power ranking above; a column cycles through both directions
  // and back to it.
  const [sort, setSort] = useState<{ key: StatSort; dir: 1 | -1 | 0 }>({ key: 'kills', dir: 0 })

  const toggleSort = (key: StatSort) =>
    setSort((prev) => {
      // Numbers open highest-first; the name column opens A-Z.
      const first: 1 | -1 = key === 'name' || key === 'tier' ? 1 : -1
      if (prev.key !== key) return { key, dir: first }
      if (prev.dir === first) return { key, dir: (first === 1 ? -1 : 1) as 1 | -1 }
      if (prev.dir !== 0) return { key, dir: 0 }
      return { key, dir: first }
    })
  const [query, setQuery] = useState('')
  /**
   * Which board is showing: the computed ranking, or one of the league's own
   * awards. The ranking stays first because it covers every Pokémon — an award
   * only names its podium, so a list of awards alone could not answer "how did
   * mine do".
   */
  const [award, setAward] = useState<string | null>(null)

  const awards = league.awards ?? []
  // With no Ranking tab to fall back to, the first award is what the tab opens
  // on. A season with no awards has nothing to open, and shows the plain
  // ranking instead.
  const showing = awards.find((a) => a.title === award) ?? awards[0] ?? null

  const pickTab = (title: string) => {
    setAward(title)
    // Otherwise a column sorted on one tab silently overrides the next tab's
    // own order, and the award would look like it ranked by something else.
    setSort({ key: 'kills', dir: 0 })
  }

  const matches = useMemo(() => league.matchStats ?? [], [league.matchStats])

  /** The whole season, always: a ranking of the season is the point. */
  const totals = useMemo(() => Object.values(totalsFromMatches(matches)), [matches])

  /**
   * An award is a ranking with a different first step, so it replaces the power
   * ranking rather than sitting beside it: on an award tab, "no column sorted"
   * means "in this award's order". Picking a column still works and still wins,
   * exactly as it does on the Ranking tab.
   */
  const rule = showing ? ruleFor(showing) : null

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = showing && rule?.only ? totals.filter(rule.only) : totals
    return pool
      .filter((t) => !q || dex[t.pokemon]?.name.toLowerCase().includes(q))
      // KOs per game breaks ties: two Pokémon on the same total are separated
      // by how few games it took. The tiebreak keeps its own direction so it
      // stays meaningful when the column is flipped.
      .sort((a, b) => {
        const nameA = dex[a.pokemon]?.name ?? ''
        const nameB = dex[b.pokemon]?.name ?? ''
        if (!sort.dir && rule) return rule.compare(a, b) || nameA.localeCompare(nameB)
        if (!sort.dir) return byPowerRanking(a, b) || nameA.localeCompare(nameB)
        if (sort.key === 'name') return nameA.localeCompare(nameB) * sort.dir
        // Best tier first, not "Banned, High, Low, Mid, Top" alphabetically.
        if (sort.key === 'tier') {
          return byTier(dex[a.pokemon]?.draftTier ?? null, dex[b.pokemon]?.draftTier ?? null) * sort.dir
            || nameA.localeCompare(nameB)
        }
        // dir -1 is descending, so subtract in ascending order and flip.
        return (finite(a[sort.key]) - finite(b[sort.key])) * sort.dir
          || b.killsPerGame - a.killsPerGame
          || nameA.localeCompare(nameB)
      })
  }, [totals, sort, query, dex, showing, rule])

  if (!matches.length) {
    // Two different situations wearing the same words. A spreadsheet season with
    // no stats means the tab has not been filled in and the import needs
    // re-running; a season edited on the site means nobody has played yet, and
    // telling those people to re-run an import they have nothing to do with is
    // just confusing.
    return (
      <p className="panel-note">
        {currentSeason().source === 'sheet'
          ? 'No match stats in the sheet yet. Re-run the import once they are filled in.'
          : 'No matches played yet. Records show up here once matches are reported.'}
      </p>
    )
  }

  const conflicts = Object.entries(league.pokemonStats ?? {}).filter(([id, s]) => {
    const t = totals.find((x) => x.pokemon === id)
    return t && (s.kills || s.deaths) && (s.kills !== t.kills || s.deaths !== t.deaths)
  }).length

  return (
    <div className="stats-view">
      {/* Only the spreadsheet season has awards; a database season shows the
          ranking on its own rather than an empty row of tabs. */}
      <section className="panel stats-panel">
      {awards.length > 0 && (
        <nav className="award-tabs" aria-label="Awards">
          {awards.map((a) => (
            <button
              key={a.title} type="button"
              className={showing?.title === a.title ? 'is-active' : ''}
              onClick={() => pickTab(a.title)}
            >
              {a.title}
            </button>
          ))}
        </nav>
      )}
        {/* The award's write-up, above the ranking it describes. */}
        {showing?.blurb && <p className="award-blurb">{showing.blurb}</p>}

        <div className="controls stats-search">
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Pokémon…" aria-label="Search stats"
          />
          <span className="count">{rows.length} Pokémon</span>
          {/* What the order actually is, whether that is the power ranking or
              the award whose tab is open. Dropped once a column is picked,
              since the chain would then describe something that is not
              happening. */}
          {!sort.dir && (
            <p className="sort-note">{rule ? rule.note : POWER_RANKING_NOTE}</p>
          )}
        </div>

        <div className="table-scroll">
          <table className="stat-table stats-table">
            <thead>
              <tr>
                <th className="rank-col">#</th>
                {/* Left to right in the order the power ranking applies them:
                    every column past the tier is one of its steps. */}
                {([['name', 'Pokémon'], ['tier', 'Tier'], ['diff', 'Diff'], ['kd', 'K/D'],
                   ['killsPerGame', 'KOs/Game'], ['kills', 'KOs'], ['gamesPlayed', 'Games'],
                   ['deaths', 'Deaths']] as [StatSort, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    className={`sortable${key === 'name' ? ' col-name' : ''}${
                      sort.dir ? (sort.key === key ? ' is-sorted' : '')
                        // With no column picked, the award's own stat is what
                        // the order is by, so it is the one marked.
                        : (rule?.highlight === key ? ' is-sorted' : '')}`}
                    aria-sort={sort.key === key && sort.dir
                      ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" onClick={() => toggleSort(key)} title="Click to cycle ascending, descending, off">
                      {label}
                      <span className="sort-arrow">
                        {sort.key === key ? (sort.dir === 1 ? '▲' : sort.dir === -1 ? '▼' : '') : ''}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const mon = dex[t.pokemon]
                // Same podium treatment as the standings table.
                const medal = MEDALS[i + 1]
                return (
                  <tr key={t.pokemon} className={medal ? `medal-row medal-${i + 1}` : ''}>
                    {/* Position under the current sort — the power ranking. */}
                    <td className="rank-col">
                      {medal ? <span className="medal" title={medal.label}>{medal.icon}</span> : i + 1}
                    </td>
                    <th scope="row" className="col-name">
                      {mon && (
                        <PokemonLink id={t.pokemon} title={mon.name}>
                          <Sprite pokemon={mon} width={40} height={32} />
                        </PokemonLink>
                      )}
                      <span className="stats-name">
                        <PokemonLink id={t.pokemon}>{mon?.name ?? t.pokemon}</PokemonLink>
                      </span>
                      {/* Each type gets its own track so the chips line up down
                          the table instead of trailing each name. */}
                      <span className="stats-type">
                        {mon?.types[0] && <TypeChip type={mon.types[0]} />}
                      </span>
                      <span className="stats-type">
                        {mon?.types[1] && <TypeChip type={mon.types[1]} />}
                      </span>
                    </th>
                    <td>
                      {mon?.draftTier
                        ? <span className={tierClass(mon.draftTier)}>{mon.draftTier}</span>
                        : <em className="none">—</em>}
                    </td>
                    <td className={t.diff > 0 ? 'pos' : t.diff < 0 ? 'neg' : ''}>
                      {t.diff > 0 ? `+${t.diff}` : t.diff}
                    </td>
                    {/* A Pokémon that has never fainted has no ratio to give,
                        which is better said than rounded to a number. */}
                    <td title={t.deaths ? undefined : 'Never fainted'}>
                      {!t.kills && !t.deaths ? '—' : t.kd === Infinity ? '∞' : t.kd.toFixed(2)}
                    </td>
                    <td>{t.killsPerGame.toFixed(2)}</td>
                    <td>{t.kills}</td>
                    <td>{t.gamesPlayed}</td>
                    <td>{t.deaths}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="panel-note">
          Totalled from the match log, which is the complete record.
          {conflicts > 0 && ` The sheet's Pokémon Stats tab disagrees on ${conflicts} of these — it is still being filled in.`}
        </p>
      </section>
    </div>
  )
}

function Rules({ league }: { league: League }) {
  const rules = league.rules
  if (!rules?.sections.length) {
    return (
      <p className="panel-note">
        {currentSeason().source === 'sheet'
          ? 'No rules found in the sheet. Re-run the import to pick them up.'
          : 'No rules written for this season yet.'}
      </p>
    )
  }

  return (
    <div className="rulebook">
      {(rules.title || rules.subtitle) && (
        <section className="panel rulebook-head">
          {rules.title && <h2>{rules.title}</h2>}
          {rules.subtitle && <p className="panel-note">{rules.subtitle}</p>}
        </section>
      )}

      <div className="rulebook-grid">
        {rules.sections.map((section) => (
          <section key={section.heading} className="panel rule-section">
            <h3>{section.heading}</h3>
            {section.notes.map((note) => (
              <p key={note} className="rule-callout">{note}</p>
            ))}
            <dl>
              {section.items.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      {rules.footer && <p className="panel-note rulebook-footer">{rules.footer}</p>}
    </div>
  )
}

/**
 * The league's tiebreak order, applied in full.
 *
 * Points are not among the steps because a point is a win, so ranking on both
 * would be ranking on the same number twice.
 *
 * Head-to-head sits last and only separates two players level on everything
 * else, so it is resolved from the schedule rather than stored: whoever won
 * more of the series they played against each other.
 */
function rankStandings(league: League): Standing[] {
  const headToHead = (a: Standing, b: Standing) => {
    let wins = 0
    for (const m of league.schedule) {
      if (m.scoreA === null || m.scoreB === null) continue
      const aOnA = m.a.includes(a.player), bOnB = m.b.includes(b.player)
      const aOnB = m.b.includes(a.player), bOnA = m.a.includes(b.player)
      if (aOnA && bOnB) wins += m.scoreA > m.scoreB ? 1 : m.scoreA < m.scoreB ? -1 : 0
      else if (aOnB && bOnA) wins += m.scoreB > m.scoreA ? 1 : m.scoreB < m.scoreA ? -1 : 0
    }
    return wins
  }

  const rate = (won: number, total: number) => (total ? won / total : 0)

  return [...league.standings]
    .sort((a, b) =>
      rate(b.wins, b.wins + b.losses) - rate(a.wins, a.wins + a.losses)
      || b.gamesWon - a.gamesWon
      || a.gamesLost - b.gamesLost
      || b.monDiff - a.monDiff
      || headToHead(b, a)
      || a.name.localeCompare(b.name))
    .map((s, i) => ({ ...s, rank: i + 1 }))
}

function Standings({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  const ranked = rankStandings(league)
  const editable = currentSeason().source === 'database'
  const [managing, setManaging] = useState(false)
  /** A Pokémon belongs to one player, so its league totals are that player's. */
  const totals = useMemo(() => totalsFromMatches(league.matchStats ?? []), [league.matchStats])
  /** Which player's team is open. The ranking is also the way into a roster. */
  const [team, setTeam] = useState<string | null>(null)
  /** A cost column only means something where costs are what limit a team. */
  const onPoints = league.meta.pointsBudget != null
  return (
    <section className="panel">
      <div className="standings-head">
        {editable && (
          <div className="standings-actions">
            <button type="button" onClick={() => setManaging(true)}>Add / remove players</button>
            <span className="count">{league.players.length} players</span>
          </div>
        )}
        {/* The tiebreaks in the order they apply, sitting where the columns they
            refer to are — one line, so it reads as a caption and not a paragraph. */}
        <p className="sort-note">
          Match Win % → Game Wins → Fewest Game Losses → Diff → Head-to-head
        </p>
      </div>
      {managing && (
        <ManagePlayers
          league={league}
          onClose={() => setManaging(false)}
          onSaved={() => reloadSeason(currentSeason().id)}
        />
      )}
      <div className="table-scroll">
        <table className="stat-table standings-table">
          <thead>
            <tr>
              {/* The record first, then the columns the sort applies, in the
                  order it applies them. Head-to-head has no column — it is read
                  from the schedule. */}
              <th>#</th><th className="col-name">Player</th><th className="col-abil">Team</th>
              <th title="Matches won">W</th><th title="Matches lost">L</th>
              <th title="Series won as a share of series played">Match Win %</th>
              <th title="Games won">GW</th><th title="Games lost">GL</th>
              <th title="Pokémon remaining differential">Diff</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => {
              const played = s.wins + s.losses
              const medal = MEDALS[s.rank]
              const showing = team === s.player
              const picks = [...(league.rosters[s.player] ?? [])].sort(
                (a, b) => byTier(a.tier, b.tier)
                  || (totals[b.pokemon]?.diff ?? 0) - (totals[a.pokemon]?.diff ?? 0)
                  || (dex[a.pokemon]?.name ?? '').localeCompare(dex[b.pokemon]?.name ?? ''),
              )
              return (
                <Fragment key={s.player}>
                <tr
                  className={`${medal ? `medal-row medal-${s.rank}` : ''}${showing ? ' is-open' : ''} clickable`}
                  onClick={() => setTeam(showing ? null : s.player)}
                  // The whole row is the target, which a <tr> cannot be on its
                  // own — so it takes focus and answers the keys a button would.
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setTeam(showing ? null : s.player)
                    }
                  }}
                  aria-expanded={showing}
                >
                  <td className="rank-cell">
                    {medal ? <span className="medal" title={medal.label}>{medal.icon}</span> : s.rank}
                  </td>
                  <th scope="row" className="col-name">
                    <span className="player-caret" aria-hidden="true">{showing ? '▾' : '▸'}</span>
                    <span>{s.name}</span>
                  </th>
                  <td className="col-abil">{s.team ?? <em className="none">TBD</em>}</td>
                  <td>{s.wins}</td>
                  <td>{s.losses}</td>
                  <td><strong>{played ? `${Math.round((s.wins / played) * 100)}%` : '—'}</strong></td>
                  <td>{s.gamesWon}</td>
                  <td>{s.gamesLost}</td>
                  <td className={s.monDiff > 0 ? 'pos' : s.monDiff < 0 ? 'neg' : ''}>
                    {s.monDiff > 0 ? `+${s.monDiff}` : s.monDiff}
                  </td>
                </tr>
                {showing && (
                  <tr className="team-row">
                    <td colSpan={9}>
                      {picks.length === 0
                        ? <p className="panel-note">No team drafted yet.</p>
                        : (
                          <table className="team-table">
                            <thead>
                              <tr>
                                {!onPoints && <th>Tier</th>}
                                {onPoints && <th className="team-col-pts">Pts</th>}
                                <th className="team-col-name">Pokémon</th>
                                <th className="team-col-types">Types</th>
                                <th>Games</th>
                                <th>KOs</th>
                                <th>KOs/Game</th>
                                <th>Deaths</th>
                                <th title="KOs per death">K/D</th>
                                <th title="KOs minus deaths">Diff</th>
                              </tr>
                            </thead>
                            <tbody>
                              {picks.map((pick) => {
                                const mon = dex[pick.pokemon]
                                if (!mon) return null
                                const t = totals[pick.pokemon]
                                return (
                                  <tr key={pick.pokemon}>
                                    {!onPoints && (
                                      <td>
                                        <span className={tierClass(pick.tier)}>{pick.tier}</span>
                                      </td>
                                    )}
                                    {onPoints && (
                                      <td className="team-col-pts">
                                        {pick.points ?? <em className="none">—</em>}
                                      </td>
                                    )}
                                    <th scope="row" className="team-col-name">
                                      <PokemonLink id={pick.pokemon} title={mon.name}>
                                        <Sprite pokemon={mon} width={40} height={32} />
                                      </PokemonLink>
                                      <PokemonLink id={pick.pokemon}>{megaParts(mon).name}</PokemonLink>
                                      {megaParts(mon).badge && (
                                        <span className="mega-badge">{megaParts(mon).badge}</span>
                                      )}
                                    </th>
                                    <td className="team-col-types">
                                      {mon.types.map((ty) => <TypeChip key={ty} type={ty} />)}
                                    </td>
                                    {/* Counts are zero when nothing happened —
                                        that is the answer, not missing data.
                                        The rates are the ones with no answer:
                                        both divide by something that is zero. */}
                                    <td>{t?.gamesPlayed ?? 0}</td>
                                    <td>{t?.kills ?? 0}</td>
                                    <td>{t?.gamesPlayed ? t.killsPerGame.toFixed(2) : '—'}</td>
                                    <td>{t?.deaths ?? 0}</td>
                                    <td>
                                      {!t || (!t.kills && !t.deaths)
                                        ? '—'
                                        : t.kd === Infinity ? '∞' : t.kd.toFixed(2)}
                                    </td>
                                    <td className={t && t.diff > 0 ? 'pos' : t && t.diff < 0 ? 'neg' : ''}>
                                      {t && t.diff > 0 ? `+${t.diff}` : (t?.diff ?? 0)}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            {onPoints && (
                              // The sum is the whole point of a budget, and a
                              // column of costs without one makes the reader
                              // add nine numbers up themselves.
                              <tfoot>
                                <tr>
                                  <td />
                                  <td className="team-col-pts">
                                    {picks.reduce((sum, p) => sum + (p.points ?? 0), 0)}
                                  </td>
                                  <td className="team-col-name">
                                    of {league.meta.pointsBudget} spent
                                  </td>
                                  <td colSpan={7} />
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        )}
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * The matches, and the games inside them.
 *
 * A match is a best-of-three, so its 2-1 is a summary of three battles that
 * each had their own story. Any game reported from a replay can be opened to
 * see who knocked out what, and links back to the replay itself.
 *
 * Matches imported from the spreadsheet have no games underneath — the sheet
 * never recorded them — so they render exactly as they always did.
 */
function Matches({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  const people = useMemo(() => byId(league.players), [league.players])
  const weeks = useMemo(
    () => [...new Set(league.schedule.map((m) => m.week))].sort((a, b) => a - b),
    [league.schedule],
  )
  /**
   * Weeks the reader has opened. Everything starts folded: a season is eight
   * weeks of five matches, and all of it at once is a wall rather than a page.
   */
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  /** The fixture being built, per week. */
  const [adding, setAdding] = useState<Record<number, { a: string[]; b: string[] }>>({})
  // The spreadsheet season is read at its source, so there is nothing to edit.
  const editable = currentSeason().source === 'database'

  /**
   * The per-Pokémon lines for a match that has no games under it.
   *
   * Matches imported from the spreadsheet only ever recorded series totals —
   * one set of numbers covering all two or three games — so they cannot be
   * split into games without inventing them. They are shown as one row for the
   * match instead, and said to be that.
   *
   * `matchStats` and `schedule` describe the same matches in the same order,
   * which is how the importer joins them.
   */
  const statsFor = useMemo(() => {
    const map = new Map<Match, MatchStat | undefined>()
    league.schedule.forEach((m, i) => map.set(m, league.matchStats?.[i]))
    return map
  }, [league.schedule, league.matchStats])
  const label = (ids: string[]) => ids.map((p) => people[p]?.name ?? p).join(' + ')
  const toggle = (w: number) => setOpen((prev) => {
    const next = new Set(prev)
    if (!next.delete(w)) next.add(w)
    return next
  })

  const refresh = () => reloadSeason(currentSeason().id)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setScheduleError(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setScheduleError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const played = league.schedule.filter((m) => m.scoreA !== null).length
  const total = league.schedule.length
  /** A new week goes after the last one, which is where a season grows. */
  const nextWeek = weeks.length ? Math.max(...weeks) + 1 : 1

  return (
    <div className="schedule">
      <div className="matches-head">
        <div className="season-progress">
          {/* Counted from the weeks that exist rather than the season's stated
              length: a week is real once it has a fixture in it. */}
          <span className="season-length">
            {weeks.length} week{weeks.length === 1 ? '' : 's'}
          </span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: total ? `${Math.round((played / total) * 100)}%` : '0%' }}
            />
          </div>
          <span className="progress-label">
            {played} of {total} matches played
          </span>
        </div>

        {editable && (
          <div className="matches-actions">
            {editing ? (
              <button type="button" className="record-btn is-done" onClick={() => setEditing(false)}>
                Done
              </button>
            ) : (
              <button type="button" className="record-btn" onClick={() => setAsking((v) => !v)}>
                Edit match schedule
              </button>
            )}
          </div>
        )}
      </div>

      {asking && !editing && (
        <PassphraseModal
          title="Edit the schedule"
          note="Adding a fixture is harmless. Removing one takes its games and its results with it, which is why this is asked for."
          action="Edit schedule"
          onClose={() => setAsking(false)}
          onConfirm={async (entered) => {
            if (!await unlock(entered)) throw new Error('That passphrase is not right.')
            setPassphrase(entered)
            setEditing(true)
            setAsking(false)
          }}
        />
      )}
      {scheduleError && <p className="report-error">{scheduleError}</p>}

      {editing && (
        <div className="week-add">
          <button
            type="button" disabled={busy}
            onClick={() => setOpen((prev) => new Set([...prev, nextWeek]))}
          >
            Add week {nextWeek}
          </button>
          <span className="panel-note">
            A week exists once it has a match in it.
          </span>
        </div>
      )}

      {[...new Set([...weeks, ...(editing ? [...open].filter((w) => !weeks.includes(w)) : [])])]
        .sort((a, b) => a - b).map((w) => {
        const isOpen = open.has(w)
        const inWeek = league.schedule.filter((m) => m.week === w)
        const done = inWeek.filter((m) => m.scoreA !== null).length
        const draft = adding[w] ?? { a: [], b: [] }
        const taken = new Set([...draft.a, ...draft.b])
        return (
        <section key={w} className={`panel week-panel${isOpen ? '' : ' is-shut'}`}>
          <button
            type="button"
            className="week-head"
            aria-expanded={isOpen}
            onClick={() => toggle(w)}
          >
            <span className="week-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            <span className="week-name">Week {w}</span>
            <span className={`week-count${done === inWeek.length && inWeek.length ? ' is-done' : ''}`}>
              {done}/{inWeek.length} matches completed
            </span>
          </button>
          {isOpen && editing && (
            <div className="week-edit">
              <div className="fixture-build">
                {(['a', 'b'] as const).map((side) => (
                  <span key={side} className="fixture-pick">
                    {draft[side].map((id) => (
                      <button
                        key={id} type="button" className="fixture-chip"
                        title="Remove from this side"
                        onClick={() => setAdding({
                          ...adding,
                          [w]: { ...draft, [side]: draft[side].filter((x) => x !== id) },
                        })}
                      >
                        {people[id]?.name ?? id} ✕
                      </button>
                    ))}
                    <select
                      value=""
                      aria-label={side === 'a' ? 'Add to the first side' : 'Add to the second side'}
                      onChange={(e) => {
                        if (!e.target.value) return
                        setAdding({
                          ...adding,
                          [w]: { ...draft, [side]: [...draft[side], e.target.value] },
                        })
                      }}
                    >
                      <option value="">{side === 'a' ? '+ player' : '+ player'}</option>
                      {league.players.filter((p) => !taken.has(p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {side === 'a' && <em>vs</em>}
                  </span>
                ))}
                <button
                  type="button" className="fixture-add"
                  disabled={busy || !draft.a.length || !draft.b.length}
                  onClick={() => run(async () => {
                    await scheduleMatch(passphrase, w, draft.a, draft.b)
                    setAdding({ ...adding, [w]: { a: [], b: [] } })
                  })}
                >
                  Add match
                </button>
              </div>
              {inWeek.length > 0 && (
                <button
                  type="button" className="week-remove" disabled={busy}
                  title={`Remove all ${inWeek.length} matches in week ${w}`}
                  onClick={() => run(() => removeWeek(passphrase, w))}
                >
                  Remove week {w}
                </button>
              )}
            </div>
          )}
          {isOpen && (
          <ul className="match-list">
            {inWeek.map((m, i) => {
              const done = m.scoreA !== null && m.scoreB !== null
              // Outline the result: green on the winner, red on the loser.
              const cls = (isA: boolean) => {
                if (!done) return 'side'
                if (m.scoreA === m.scoreB) return 'side drew'
                const won = isA ? m.scoreA! > m.scoreB! : m.scoreB! > m.scoreA!
                return `side ${won ? 'won' : 'lost'}`
              }
              const games = m.games ? [...m.games].sort((x, y) => x.number - y.number) : []
              return (
                <li key={i} className={`match-card${games.length ? ' has-games' : ''}`}>
                  <h4 className="match-title">
                    Match {i + 1}
                    {editing && m.id != null && (
                      <button
                        type="button" className="match-remove" disabled={busy}
                        title="Remove this match"
                        onClick={() => run(() => unscheduleMatch(passphrase, m.id!))}
                      >
                        Remove
                      </button>
                    )}
                  </h4>
                  <div className="match-row">
                    <span className={cls(true)}>{label(m.a)}</span>
                    <span className="score">{done ? `${m.scoreA} – ${m.scoreB}` : 'vs'}</span>
                    <span className={cls(false)}>{label(m.b)}</span>
                  </div>

                  {games.map((g) => (
                    <div key={g.number} className="game-row">
                      <GameTeam lines={g.a} dex={dex} align="left" won={g.winner === 'a'} />
                      <span className="game-label">
                        {g.replayUrl ? (
                          <a
                            className="game-pill"
                            href={g.replayUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            title="Watch this game on Pokémon Showdown"
                          >
                            Game {g.number}<span className="game-arrow" aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <span className="game-pill is-plain">Game {g.number}</span>
                        )}
                      </span>
                      <GameTeam lines={g.b} dex={dex} align="right" won={g.winner === 'b'} />
                    </div>
                  ))}

                  {/* No games recorded, but the match's own totals are known. */}
                  {games.length === 0 && seriesLines(statsFor.get(m)) && (
                    <div className="game-row">
                      <GameTeam
                        lines={seriesLines(statsFor.get(m))!.a} dex={dex} align="left"
                        won={m.scoreA !== null && m.scoreB !== null && m.scoreA > m.scoreB}
                      />
                      <span className="game-label">
                        <span
                          className="game-pill is-plain"
                          title="Totals for the whole match; the games were not recorded separately"
                        >
                          Match
                        </span>
                      </span>
                      <GameTeam
                        lines={seriesLines(statsFor.get(m))!.b} dex={dex} align="right"
                        won={m.scoreA !== null && m.scoreB !== null && m.scoreB > m.scoreA}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          )}
        </section>
        )
      })}
    </div>
  )
}

/**
 * Turns a match's series totals into the same shape a game's lines have.
 *
 * There is no record of who was brought, only of who scored or fainted, so a
 * Pokémon that played the whole series without doing either is counted as
 * benched. Over two or three games that is unlikely but not impossible.
 */
function seriesLines(stat: MatchStat | undefined) {
  if (!stat || (!stat.a.lines.length && !stat.b.lines.length)) return null
  const side = (lines: MatchStat['a']['lines']): GameLine[] =>
    lines.map((l) => ({
      pokemon: l.pokemon, kills: l.kills, deaths: l.deaths,
      brought: Boolean(l.kills || l.deaths),
    }))
  return { a: side(stat.a.lines), b: side(stat.b.lines) }
}

/**
 * One side's six Pokémon for one game: the ones brought, a gap, then the bench.
 *
 * A Pokémon that fainted is greyed out, so the state of the team at the end of
 * the game reads at a glance. Brought-but-idle and benched look identical in
 * the numbers — both are 0/0 — which is why the replay's switch-ins are
 * recorded rather than inferred.
 */
function GameTeam({
  lines, dex, align, won,
}: {
  lines: GameLine[]
  dex: Record<string, LeaguePokemon>
  align: 'left' | 'right'
  won: boolean
}) {
  const played = lines.filter((l) => l.brought)
  const bench = lines.filter((l) => !l.brought)
  const mon = (l: GameLine) => {
    const entry = dex[l.pokemon]
    const name = entry?.name ?? l.pokemon
    return (
      <PokemonLink
        key={l.pokemon}
        id={l.pokemon}
        title={`${name} — ${l.kills} KO${l.kills === 1 ? '' : 's'}, ${
          l.deaths ? 'knocked out' : 'survived'}`}
      >
        {entry && (
          <Sprite pokemon={entry} className={l.deaths ? 'is-fainted' : undefined} width={40} height={33} />
        )}
      </PokemonLink>
    )
  }
  return (
    <div className={`game-team ${align}`}>
      {/* The ones that played are boxed together, in the colour of the result;
          the bench sits outside it. */}
      <span className={`game-brought ${won ? 'won' : 'lost'}`}>{played.map(mon)}</span>
      {bench.length > 0 && <span className="game-bench">{bench.map(mon)}</span>}
    </div>
  )
}

/** Board columns, in display order. `get` returns the value each one sorts on. */
const BOARD_COLUMNS = [
  { key: 'name', label: 'Pokémon', numeric: false },
  { key: 'tier', label: 'Tier', numeric: false },
  // Only on a points season. Beside the tier, because on those seasons the tier
  // is the colour and this is the rule.
  { key: 'points', label: 'Pts', numeric: true },
  { key: 'bst', label: 'BST', numeric: true },
  ...BST_ORDER.map((k) => ({ key: k, label: STAT_LABELS[k], numeric: true })),
  { key: 'draftedBy', label: 'Drafted by', numeric: false },
  { key: 'note', label: 'Note', numeric: false },
] as const

type SortKey = (typeof BOARD_COLUMNS)[number]['key']

/** Draft-board order, best first — matches how the sheet groups its sections. */
const TIER_PILLS = ['Top', 'High', 'Mid', 'Low', 'Banned'] as const

function Board({ league, dex }: { league: League; dex: Record<string, LeaguePokemon> }) {
  const [query, setQuery] = useState('')
  const editable = currentSeason().source === 'database'
  const [draft, setDraft] = useState<DraftState | null>(null)
  useEffect(() => { if (editable) draftState().then(setDraft, () => {}) }, [editable])
  // Empty set means "no filter" rather than "show nothing", so the board starts
  // complete and each pill narrows it.
  const [tiers, setTiers] = useState<Set<string>>(new Set())
  const [avail, setAvail] = useState<Set<'available' | 'drafted'>>(new Set())
  // dir 0 is the board's own order — best tier first, strongest within it —
  // rather than "unsorted". It is what the board looks like before anyone
  // touches a column, so no column is marked as doing it.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 | 0 }>({ key: 'tier', dir: 0 })

  /** A cost column only means something where costs are what limit a team. */
  const onPoints = league.meta.pointsBudget != null
  // On a points season the cost is the whole ranking, so the tier goes: it is
  // not a second opinion to weigh, it is the thing points replaced. `Banned`
  // still lives in the column underneath — it is what stops a pick — and shows
  // as a badge on the row instead.
  const columns = useMemo(
    () => BOARD_COLUMNS.filter((c) => (c.key === 'points' ? onPoints : c.key !== 'tier' || !onPoints)),
    [onPoints],
  )

  const toggleIn = <T,>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })

  const toggleSort = (key: SortKey) =>
    setSort((prev) => {
      // Numbers are most useful highest-first; text reads better A–Z.
      const first: 1 | -1 = BOARD_COLUMNS.find((c) => c.key === key)?.numeric ? -1 : 1
      if (prev.key !== key) return { key, dir: first }
      if (prev.dir === first) return { key, dir: (first === 1 ? -1 : 1) as 1 | -1 }
      if (prev.dir !== 0) return { key, dir: 0 }
      return { key, dir: first }
    })

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = Object.entries(league.board)
      .filter(([id, e]) => {
        if (tiers.size && !tiers.has(e.tier)) return false
        if (avail.size && !avail.has(e.draftedBy ? 'drafted' : 'available')) return false
        if (!q) return true
        return e.name.toLowerCase().includes(q) || dex[id]?.types.some((t) => t.toLowerCase() === q)
      })
      .map(([id, e]) => ({ id, entry: e, mon: dex[id] }))

    const { key, dir } = sort
    // Dearest first where points are the ranking; best tier first where they
    // are not. Either way it is "strongest at the top" in that season's terms.
    const byBoardOrder = (a: typeof list[number], b: typeof list[number]) =>
      (onPoints
        ? (b.entry.points ?? -1) - (a.entry.points ?? -1)
        : byTier(a.entry.tier, b.entry.tier))
      || (b.mon?.bst ?? 0) - (a.mon?.bst ?? 0)
      || a.entry.name.localeCompare(b.entry.name)
    if (!dir) return list.sort(byBoardOrder)
    return list.sort((a, b) => {
      // Within a tier the strongest first, and that tiebreak keeps its own
      // direction — flipping the tier order should not also flip BST.
      if (key === 'tier') {
        return byTier(a.entry.tier, b.entry.tier) * dir
          || (b.mon?.bst ?? 0) - (a.mon?.bst ?? 0)
      }
      if (key === 'points') {
        // Priceless is not free: a Banned Pokemon has no cost because it cannot
        // be drafted at all, so it sorts to the end either way.
        const av = a.entry.points, bv = b.entry.points
        if ((av == null) !== (bv == null)) return av == null ? 1 : -1
        return ((av ?? 0) - (bv ?? 0)) * dir || a.entry.name.localeCompare(b.entry.name)
      }
      if (key === 'bst') return ((a.mon?.bst ?? 0) - (b.mon?.bst ?? 0)) * dir
      if (key === 'name') return a.entry.name.localeCompare(b.entry.name) * dir
      if (key === 'draftedBy' || key === 'note') {
        // Empty cells sort last regardless of direction; they carry no signal.
        const av = a.entry[key] ?? '', bv = b.entry[key] ?? ''
        if (!av !== !bv) return av ? -1 : 1
        return av.localeCompare(bv) * dir
      }
      return ((a.mon?.baseStats[key] ?? 0) - (b.mon?.baseStats[key] ?? 0)) * dir
    })
  }, [league.board, dex, query, tiers, avail, sort, onPoints])

  const counts = useMemo(() => {
    const c: Record<string, number> = { available: 0, drafted: 0 }
    for (const e of Object.values(league.board)) {
      c[e.tier] = (c[e.tier] ?? 0) + 1
      c[e.draftedBy ? 'drafted' : 'available']++
    }
    return c
  }, [league.board])

  return (
    <>
      {/* Search and its filters share one row, so the whole control set reads
          left to right instead of stacking. */}
      <div className="board-controls">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the board…" aria-label="Search draft board"
        />
        {/* One tier at a time, or all of them. Five toggles that could be in
            any combination made a board nobody could describe; a tier is the
            thing people actually want to look at.

            Gone on a points season, which has no tiers to filter by. Sorting
            the Pts column is what narrows the board there. */}
        {!onPoints && (
          <DropPicker
            className="tier-picker"
            ariaLabel="Filter by draft tier"
            items={[
              { id: '', label: 'All tiers', note: `${Object.keys(league.board).length} Pokémon` },
              ...TIER_PILLS.map((t) => ({
                id: t, label: t, note: `${counts[t] ?? 0} Pokémon`,
              })),
            ]}
            value={[...tiers][0] ?? ''}
            onPick={(item) => setTiers(item.id ? new Set([item.id]) : new Set())}
          />
        )}
        <span className="pill-divider" aria-hidden="true" />
        <div className="pill-group" role="group" aria-label="Filter by availability">
          {(['available', 'drafted'] as const).map((a) => (
            <button
              key={a} type="button"
              className={`pill pill-${a}${avail.has(a) ? ' is-active' : ''}`}
              aria-pressed={avail.has(a)}
              onClick={() => toggleIn(setAvail, a)}
            >
              {a === 'available' ? 'Available' : 'Drafted'}<em>{counts[a]}</em>
            </button>
          ))}
        </div>
        {(tiers.size > 0 || avail.size > 0) && (
          <button
            type="button" className="pill pill-clear"
            onClick={() => { setTiers(new Set()); setAvail(new Set()) }}
          >
            Clear
          </button>
        )}
        {/* Explains the row colouring in the table below. */}
        <dl className="board-key">
          <div><dt className="swatch-open" /><dd>available</dd></div>
          <div><dt className="swatch-taken" /><dd>taken</dd></div>
        </dl>
        <span className="count">{rows.length} shown</span>
        {/* The "draft mode enabled" indicator used to sit here. It says
            something about the whole League section rather than this tab, so it
            lives in the bar above now. The button that opens the draft stays
            with the board it acts on. */}
        {editable && (
          <div className="board-draft">
            <DraftToggle
              state={draft}
              setState={setDraft}
              onChanged={() => reloadSeason(currentSeason().id)}
            />
          </div>
        )}
      </div>

      <section className="panel">
        <div className="table-scroll">
          <table className="stat-table board-table">
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = sort.key === c.key && sort.dir !== 0
                  return (
                    <th
                      key={c.key}
                      className={`sortable${c.key === 'name' ? ' col-name' : ''}${c.key === 'draftedBy' || c.key === 'note' ? ' col-abil' : ''}${active ? ' is-sorted' : ''}`}
                      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" onClick={() => toggleSort(c.key)} title="Click to cycle ascending, descending, off">
                        {c.label}
                        <span className="sort-arrow">{active ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map(({ id, entry, mon }) => (
                <tr key={id} className={entry.draftedBy ? 'row-taken' : 'row-open'}>
                  <th scope="row" className="col-name">
                    {mon && (
                      <PokemonLink id={id} title={entry.name}>
                        <Sprite pokemon={mon} width={40} height={32} />
                      </PokemonLink>
                    )}
                    <span>
                      {/* Season 5 drafts a Mega apart from what it evolves
                          from, so the board holds both. The badge carries the
                          forme so the name does not have to say it twice.

                          Its own row, because the cell stacks its children —
                          left alone the badge would sit on a line of its own
                          between the name and the types. */}
                      <span className="pick-name-row">
                        <PokemonLink id={id} className="pick-name">
                          {mon ? megaParts(mon).name : entry.name}
                        </PokemonLink>
                        {mon && megaParts(mon).badge && (
                          <span className="mega-badge">{megaParts(mon).badge}</span>
                        )}
                      </span>
                      {mon && (
                        <span className="row-types">
                          {mon.types.map((t) => <TypeChip key={t} type={t} />)}
                        </span>
                      )}
                    </span>
                  </th>
                  {!onPoints && (
                    <td><span className={tierClass(entry.tier)}>{entry.tier}</span></td>
                  )}
                  {onPoints && (
                    <td className="board-points">
                      {entry.tier === 'Banned'
                        ? <span className="banned-badge">Banned</span>
                        : entry.points ?? <em className="none">—</em>}
                    </td>
                  )}
                  <td>{mon?.bst ?? '—'}</td>
                  {BST_ORDER.map((k) => <td key={k}>{mon?.baseStats[k] ?? '—'}</td>)}
                  <td className="col-abil">{entry.draftedBy ?? <em className="none">available</em>}</td>
                  <td className="col-abil">{entry.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 300 && (
          <p className="panel-note">Showing the first 300 of {rows.length}. Narrow your search to see more.</p>
        )}
      </section>
    </>
  )
}
