import { useMemo } from 'react'
import type { StatKey } from '../../data/types'
import { BST_ORDER, STAT_LABELS, summarize } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import type { Team } from './TeamEditor'
import { PokemonLink } from '../../components/PokemonLink'
import { usePokemonModal } from '../pokemon/PokemonModalContext'
import { useFitToBox } from '../../lib/useFitToBox'
import { Sprite } from '../../components/Sprite'
import { DraftValue } from '../../components/DraftValue'

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

/** `neutral` is owned by the parent card so the slider can live in its header. */
export function DraftSummaryBody({ team, neutral }: { team: Team; neutral: number }) {

  const rows = useMemo(
    () => [...team.members].sort((a, b) => b.pokemon.bst - a.pokemon.bst),
    [team.members],
  )

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
              <th className="col-name">Name</th>
              {showValue && <th className="col-value">{priced ? 'Pts' : 'Tier'}</th>}
              <th className="col-abil">Abilities</th>
              {BST_ORDER.map((k) => <th key={k}>{STAT_LABELS[k]}</th>)}
              <th>BST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, pokemon }) => {
              // All of them: the column is wide enough now that three names fit
              // the two lines it is held open to, so nothing has to be counted
              // off behind a "+N more".
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
                    {/* Pills, and inert ones: no tooltip and nothing of their
                        own to click. The row already opens the Pokémon, and a
                        control inside it that looks separately clickable but
                        does the same thing is just a smaller target for it. */}
                    <span className="ability-lines">
                      {abilityNames.map((name) => <span key={name}>{name}</span>)}
                    </span>
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
