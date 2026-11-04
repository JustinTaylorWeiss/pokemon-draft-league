import { Fragment, useMemo, useState } from 'react'
import type { Game, GameLine, LeaguePokemon, MoveTally } from '../../data/league'
import type { MoveDex } from '../../data/types'
import { Sprite } from '../../components/Sprite'
import { PokemonLink } from '../../components/PokemonLink'
import { luckLabel, luckNote } from '../../lib/luck'
import { addTallies, byUse, luckFor, perUse, useMoveDex } from './moveStats'

/** The same Pokémon's line across several games, added up. */
interface Rolled {
  pokemon: string
  kills: number
  deaths: number
  /** Games it was actually sent out in, which is not the same as games played. */
  games: number
  moves: MoveTally[]
}

function roll(lines: GameLine[][]): Rolled[] {
  const by = new Map<string, Rolled>()
  for (const game of lines) {
    for (const l of game) {
      const row = by.get(l.pokemon)
        ?? { pokemon: l.pokemon, kills: 0, deaths: 0, games: 0, moves: [] as MoveTally[] }
      row.kills += l.kills
      row.deaths += l.deaths
      if (l.brought) row.games += 1
      addTallies(row.moves, l.moves)
      by.set(l.pokemon, row)
    }
  }
  return [...by.values()]
    // Sent out first, then by what they did. A bench row is still listed,
    // because "did not bring it" is a fact about the match too.
    .filter((r) => r.games || r.kills || r.deaths)
    .sort((x, y) => y.kills - x.kills || x.deaths - y.deaths
      || y.moves.length - x.moves.length || x.pokemon.localeCompare(y.pokemon))
}

/**
 * One row per move, with the Pokémon's own figures spanning its moves.
 *
 * The move numbers were a list inside a single cell, which left four facts
 * floating with no heading over any of them. They are columns now, which is
 * what they always were — and the two-row heading is what lets a Pokémon's
 * knockouts and a move's knockouts both be called KOs without the reader
 * having to guess which is which.
 */
function Rows({ rows, dex, moves }: {
  rows: Rolled[]
  dex: Record<string, LeaguePokemon>
  moves: MoveDex | null
}) {
  return (
    <div className="detail-scroll">
      <table className="detail-table">
        <thead>
          <tr>
            <th className="detail-mon" rowSpan={2}>Pokémon</th>
            <th rowSpan={2} title="Knockouts scored">KOs</th>
            <th rowSpan={2} title="Times it fainted">Fainted</th>
            <th
              rowSpan={2}
              title="Where its accuracy rolls landed in the range they could have: higher is luckier"
            >
              Luck
            </th>
            <th colSpan={6} className="detail-group">Each move</th>
          </tr>
          <tr>
            <th className="detail-move">Move</th>
            <th title="Times clicked">Used</th>
            <th title="Knockouts this move finished">KOs</th>
            <th title="Percentage points of the other side's health, added across targets">%</th>
            <th title="That damage spread over the times it was clicked">%/use</th>
            <th title="Accuracy rolls it lost">Miss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mon = dex[r.pokemon]
            const luck = luckFor(r.moves, moves)
            const clicked = [...r.moves].sort(byUse)
            // A Pokemon that was brought and never moved still gets a row, so
            // its knockouts and faints are not dropped for want of a move.
            const lines = clicked.length ? clicked : [null]
            return (
              <Fragment key={r.pokemon}>
                {lines.map((m, i) => (
                  <tr key={m?.name ?? '—'} className={i === 0 ? 'detail-first' : undefined}>
                    {i === 0 && (
                      <>
                        {/* An inner span does the laying out, not the cell: a
                            `th` told to be a flex container stops being a
                            table cell and its border stops short of the row. */}
                        <th scope="rowgroup" className="detail-mon" rowSpan={lines.length}>
                          <span className="detail-mon-inner">
                            <PokemonLink id={r.pokemon} title={mon?.name ?? r.pokemon}>
                              {mon && <Sprite pokemon={mon} width={32} height={26} />}
                            </PokemonLink>
                            <PokemonLink id={r.pokemon}>{mon?.name ?? r.pokemon}</PokemonLink>
                          </span>
                        </th>
                        <td className={r.kills ? 'pos' : ''} rowSpan={lines.length}>{r.kills}</td>
                        <td className={r.deaths ? 'neg' : ''} rowSpan={lines.length}>{r.deaths}</td>
                        <td
                          className={`detail-luck is-${luck.verdict}`}
                          rowSpan={lines.length} title={luckNote(luck)}
                        >
                          {luckLabel(luck)}
                        </td>
                      </>
                    )}
                    {m ? (
                      <>
                        <td className="detail-move">{m.name}</td>
                        <td>{m.used}</td>
                        <td className={m.kos ? 'pos' : ''}>{m.kos || '—'}</td>
                        <td>{m.damage ? `${m.damage}%` : '—'}</td>
                        <td>{m.damage ? `${perUse(m)}%` : '—'}</td>
                        {/* A column of noughts is most of this column, so
                            only a miss is drawn in a colour that asks to be
                            looked at. */}
                        <td
                          className={m.misses ? 'neg' : 'quiet'}
                          title={m.rolls ? luckNote(luckFor([m], moves)) : undefined}
                        >
                          {m.rolls ? m.misses : '—'}
                        </td>
                      </>
                    ) : (
                      <td className="detail-move none" colSpan={6}>Did not move</td>
                    )}
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Everything the replays said about one match, game by game and then added up.
 *
 * Behind a toggle because it is a great deal at once — four rosters' worth of
 * rows for a three-game series — and the card above it already answers the
 * question most people have, which is who won.
 *
 * The move columns are empty for anything reported before the reader started
 * keeping them. That is said once, rather than by drawing a table of dashes:
 * a match with no move record and a match where nobody moved would otherwise
 * look the same.
 */
export function MatchDetails({
  games, aLabel, bLabel, dex,
}: {
  games: Game[]
  aLabel: string
  bLabel: string
  dex: Record<string, LeaguePokemon>
}) {
  const [open, setOpen] = useState(false)
  const moves = useMoveDex(open)
  const totals = useMemo(() => ({
    a: roll(games.map((g) => g.a)),
    b: roll(games.map((g) => g.b)),
  }), [games])

  const anyMoves = games.some((g) => [...g.a, ...g.b].some((l) => l.moves.length))

  if (!games.length) return null

  return (
    <div className="match-details">
      <button
        type="button" className="detail-toggle" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="detail-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        {open ? 'Hide details' : 'View details'}
      </button>

      {open && (
        <div className="detail-body">
          {!anyMoves && (
            <p className="detail-note">
              No move record for this match — it was reported before the reader
              started keeping them. Reporting it again from the same replays
              fills it in.
            </p>
          )}

          {games.map((g) => (
            <Fragment key={g.number}>
              <h5 className="detail-head">
                Game {g.number}
                {g.winner && (
                  <span className="detail-won">
                    {g.winner === 'a' ? aLabel : bLabel} won
                    {g.survivors != null && `, ${g.survivors} left standing`}
                  </span>
                )}
                {g.replayUrl && (
                  <a
                    className="detail-replay" href={g.replayUrl}
                    target="_blank" rel="noreferrer noopener"
                  >
                    Replay<span aria-hidden="true"> ↗</span>
                  </a>
                )}
              </h5>
              {([[aLabel, g.a], [bLabel, g.b]] as const).map(([name, lines]) => (
                <div className="detail-side" key={name}>
                  <h6>{name}</h6>
                  <Rows rows={roll([lines])} dex={dex} moves={moves} />
                </div>
              ))}
            </Fragment>
          ))}

          <h5 className="detail-head detail-overall">The match</h5>
          {([[aLabel, totals.a], [bLabel, totals.b]] as const).map(([name, rows]) => (
            <div className="detail-side" key={name}>
              <h6>{name}</h6>
              <Rows rows={rows} dex={dex} moves={moves} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
