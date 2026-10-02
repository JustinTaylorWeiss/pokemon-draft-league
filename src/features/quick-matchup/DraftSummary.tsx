import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StatKey } from '../../data/types'
import { BST_ORDER, STAT_LABELS, summarize } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { usePokemonModal } from '../pokemon/PokemonModalContext'
import { useFitToBox } from '../../lib/useFitToBox'
import { Sprite } from '../../components/Sprite'
import { DraftValue } from '../../components/DraftValue'
import { byTier } from '../../data/league'

/**
 * Colors a stat relative to the neutral value: below is red, above is green.
 * The scale saturates 60 points out from neutral so the extremes stay readable.
 */
function heat(value: number, neutral: number): string {
  const spread = Math.max(-1, Math.min(1, (value - neutral) / 60))
  const alpha = Math.abs(spread) * 0.55
  return spread >= 0
    ? `rgba(46, 160, 120, ${alpha.toFixed(3)})`
    : `rgba(200, 60, 70, ${alpha.toFixed(3)})`
}

/**
 * Which column the two rosters are read down, and which way.
 *
 * Owned by the card rather than by either table, the way `neutral` is,
 * because the point of sorting here is to compare: two rosters each in
 * their own order are two lists, and two rosters in the same order are a
 * matchup. Clicking a heading on one side moves both.
 */
export type SummaryKey = StatKey | 'bst' | 'name' | 'value'
export interface SummarySort { key: SummaryKey; dir: 1 | -1 }
export const BY_BST: SummarySort = { key: 'bst', dir: -1 }

/**
 * Two Pokémon under one column, as a comparator.
 *
 * Out here rather than inside the table so it can be read and tested on
 * its own — the direction is the easy thing to get backwards, and it is
 * invisible either way until someone notices the weakest Pokémon at the
 * top of a column they asked for the strongest of.
 *
 * `dir` is 1 for ascending throughout, which is what the heading's
 * aria-sort claims, so every branch subtracts in ascending order and
 * lets `dir` do the flipping.
 */
export function bySummary({ key, dir }: SummarySort) {
  type Entry = { pokemon: { name: string; bst: number; baseStats: Record<StatKey, number>;
    points?: number | null; draftTier?: string | null } }
  const of = (e: Entry) => (key === 'bst' ? e.pokemon.bst : e.pokemon.baseStats[key as StatKey])
  return (a: Entry, b: Entry): number => {
    const tie = a.pokemon.name.localeCompare(b.pokemon.name)
    if (key === 'name') return tie * dir
    if (key === 'value') {
      /* Priced seasons sort on the price and tiered ones on the band.
         Either way something off the board sorts last whichever way the
         column is pointing, rather than counting as free or as worst. */
      const ap = a.pokemon.points
      const bp = b.pokemon.points
      if (ap != null || bp != null) {
        if (ap == null || bp == null) return ap == null ? 1 : -1
        return (ap - bp) * dir || tie
      }
      const at = a.pokemon.draftTier ?? null
      const bt = b.pokemon.draftTier ?? null
      if (!at || !bt) return at ? -1 : bt ? 1 : 0
      return byTier(at, bt) * dir || tie
    }
    return (of(a) - of(b)) * dir || tie
  }
}

/** Numbers open highest-first, which is what anyone wants of a stat; names A–Z. */
export const nextSummarySort = (prev: SummarySort, key: SummaryKey): SummarySort =>
  (prev.key === key
    ? { key, dir: (prev.dir === 1 ? -1 : 1) as 1 | -1 }
    : { key, dir: key === 'name' ? 1 : -1 })

/** `neutral` is owned by the parent card so the slider can live in its header. */
/**
 * A Pokemon's abilities, as running text that stops where the cell does.
 *
 * Pills read as controls and they were not, and three of them on two lines
 * wrapped into a row sized for two — so the third was sliced through the
 * middle, which looked like a rendering fault rather than a limit. Plain
 * underlined names flow like the sentence they are, and what does not fit is
 * counted off rather than cut in half.
 *
 * Measured rather than guessed. How many fit depends on the column's width and
 * on the names themselves — "Marvel Scale, Competitive, Cute Charm" against
 * "Blaze" — so the only honest answer comes from asking the box whether it
 * overflowed. It only ever drops names, one per pass, so it settles in at most
 * two and cannot oscillate. The observer puts them all back when the column
 * changes width, and the measuring starts again from there.
 */
function Abilities({ names }: { names: string[] }) {
  const box = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(names.length)
  const all = names.join('\u0000')

  // A different Pokemon, or a wider column, gets a fresh count to shrink from.
  useLayoutEffect(() => { setShown(names.length) }, [all, names.length])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setShown(names.length))
    ro.observe(el)
    return () => ro.disconnect()
  }, [names.length])

  // Re-runs on its own result, which is the loop: drop one, look again, stop
  // when it fits. Bounded by the count, since it only ever goes down.
  useLayoutEffect(() => {
    const el = box.current
    // One name always stays, however narrow it gets: "+3 more" on its own
    // names nothing.
    if (el && shown > 1 && el.scrollHeight > el.clientHeight) setShown(shown - 1)
  }, [shown, all])

  const hidden = names.length - shown
  return (
    <span className="ability-lines" ref={box} title={names.join(', ')}>
      {names.slice(0, shown).map((name, i) => (
        <Fragment key={name}>
          {i > 0 && ', '}
          <span className="ability">{name}</span>
        </Fragment>
      ))}
      {hidden > 0 && <span className="ability-more">{`, +${hidden} more\u2026`}</span>}
    </span>
  )
}

/** One heading, which is also the control for sorting by it. */
function Head({ k, sort, onSort, className, children }: {
  k: SummaryKey
  sort: SummarySort
  onSort: (key: SummaryKey) => void
  className?: string
  children: ReactNode
}) {
  const on = sort.key === k
  return (
    <th
      className={`sortable${on ? ' is-sorted' : ''}${className ? ` ${className}` : ''}`}
      aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" onClick={() => onSort(k)} title="Sort both rosters by this">
        {children}
        <span className="sort-arrow">{on ? (sort.dir === 1 ? '\u25b2' : '\u25bc') : ''}</span>
      </button>
    </th>
  )
}

export function DraftSummaryBody({ team, neutral, sort, onSort }: {
  team: Team
  neutral: number
  sort: SummarySort
  onSort: (key: SummaryKey) => void
}) {
  const rows = useMemo(() => [...team.members].sort(bySummary(sort)), [team.members, sort])

  const totals = useMemo(() => {
    const cols: Record<string, number[]> = {}
    for (const k of BST_ORDER) cols[k] = rows.map((r) => r.pokemon.baseStats[k])
    cols.bst = rows.map((r) => r.pokemon.bst)
    return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, summarize(v)]))
  }, [rows])

  /**
   * What the team is worth in the league's own terms — a cost where the season
   * prices its board, a tier where it bands it. Read off the entries rather
   * than passed in: a priced season fills in `points` and a tiered one does not.
   *
   * Only shown when at least one member is on the board, since a scratch team of
   * whatever you fancy has no league value to total.
   */
  const priced = rows.some((r) => r.pokemon.points != null)
  const tiered = !priced && rows.some((r) => r.pokemon.draftTier)
  const showValue = priced || tiered
  const spent = rows.reduce((sum, r) => sum + (r.pokemon.points ?? 0), 0)

  // Any part of a row opens that Pokemon, not just its name and sprite.
  const { open } = usePokemonModal()

  // Width only, like the defensive chart. Fitting the height too meant a taller
  // row was immediately cancelled by a smaller scale — the rows kept their
  // rendered size and everything else shrank instead. Rows are the size they
  // are now, and a roster too tall for the card scrolls.
  const fitRef = useFitToBox<HTMLDivElement>('width')

  if (!rows.length) return null

  return (
    <div className="fit-box fit-wide" ref={fitRef}>
    <table className="stat-table summary-table">
          <thead>
            <tr>
              {/* Abilities is the one heading that is not a button: there
                  is no order to put a list of names in that anybody wants
                  a roster read down. */}
              <Head k="name" sort={sort} onSort={onSort} className="col-name">Name</Head>
              {showValue && (
                <Head k="value" sort={sort} onSort={onSort} className="col-value">
                  {priced ? 'Pts' : 'Tier'}
                </Head>
              )}
              <th className="col-abil">Abilities</th>
              {BST_ORDER.map((k) => (
                <Head key={k} k={k} sort={sort} onSort={onSort}>{STAT_LABELS[k]}</Head>
              ))}
              <Head k="bst" sort={sort} onSort={onSort}>BST</Head>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, pokemon }) => {
              const abilityNames = Object.values(pokemon.abilities)
              return (
                <tr key={id} className="row-link" onClick={() => open(id)}>
                  <th scope="row" className="col-name">
                    {/* An inner flex row, not a flex cell: making the `th`
                        itself a flex container drops it out of the table's
                        layout and it stops filling the row. */}
                    <span className="name-cell">
                      <PokemonLink id={id} title={pokemon.name}>
                        <Sprite pokemon={pokemon} width={44} height={36} />
                      </PokemonLink>
                      <span className="name-stack">
                        <PokemonLink id={id}>{pokemon.name}</PokemonLink>
                        <span className="row-types">
                          {pokemon.types.map((t) => <TypeChip key={t} type={t} />)}
                        </span>
                      </span>
                    </span>
                  </th>
                  {showValue && (
                    <td className="col-value"><DraftValue mon={pokemon} /></td>
                  )}
                  <td className="col-abil">
                    <Abilities names={abilityNames} />
                  </td>
                  {BST_ORDER.map((k: StatKey) => (
                    <td key={k} style={{ background: heat(pokemon.baseStats[k], neutral) }}>
                      {pokemon.baseStats[k]}
                    </td>
                  ))}
                  <td style={{ background: heat(pokemon.bst / 6, neutral) }}>{pokemon.bst}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {(['average', 'median', 'max'] as const).map((agg) => (
              <tr key={agg}>
                <th scope="row" colSpan={showValue ? 3 : 2} className="agg-label">
                  {agg}
                  {/* The spend belongs on one row, not repeated down three that
                      are about stat spreads. */}
                  {priced && agg === 'average' && (
                    <span className="agg-spent">{spent} pts drafted</span>
                  )}
                </th>
                {BST_ORDER.map((k) => (
                  <td key={k} style={{ background: heat(totals[k][agg], neutral) }}>{totals[k][agg]}</td>
                ))}
                <td style={{ background: heat(totals.bst[agg] / 6, neutral) }}>{totals.bst[agg]}</td>
              </tr>
            ))}
          </tfoot>
    </table>
    </div>
  )
}
