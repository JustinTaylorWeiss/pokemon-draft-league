import { Fragment, useMemo, useState } from 'react'
import type { Game, GameLine, LeaguePokemon, MoveTally } from '../../data/league'
import type { MoveDex } from '../../data/types'
import { Sprite } from '../../components/Sprite'
import { PokemonLink } from '../../components/PokemonLink'
import { VERDICT_LABEL, luckNote } from '../../lib/luck'
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

function Rows({ rows, dex, moves }: {
  rows: Rolled[]
  dex: Record<string, LeaguePokemon>
  moves: MoveDex | null
}) {
  return (
    <table className="detail-table">
      <thead>
        <tr>
          <th className="detail-mon">Pokémon</th>
          <th title="Knockouts scored">KOs</th>
          <th title="Times it fainted">Fainted</th>
          <th title="Misses against what its moves' listed accuracy says to expect">Luck</th>
          <th className="detail-moves">Moves</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const mon = dex[r.pokemon]
          const luck = luckFor(r.moves, moves)
          return (
            <tr key={r.pokemon}>
              {/* An inner span does the laying out, not the cell: a `th`
                  told to be a flex container stops being a table cell and
                  its border stops short of the row. */}
              <th scope="row" className="detail-mon">
                <span className="detail-mon-inner">
                  <PokemonLink id={r.pokemon} title={mon?.name ?? r.pokemon}>
                    {mon && <Sprite pokemon={mon} width={32} height={26} />}
                  </PokemonLink>
                  <PokemonLink id={r.pokemon}>{mon?.name ?? r.pokemon}</PokemonLink>
                </span>
              </th>
              <td className={r.kills ? 'pos' : ''}>{r.kills}</td>
              <td className={r.deaths ? 'neg' : ''}>{r.deaths}</td>
              <td className={`detail-luck is-${luck.verdict}`} title={luckNote(luck)}>
                {VERDICT_LABEL[luck.verdict]}
                {luck.verdict !== 'none' && (
                  <small>{luck.misses} of {luck.expected.toFixed(1)}</small>
                )}
              </td>
              <td className="detail-moves">
                {r.moves.length ? (
                  /* Every line fills all six tracks, blanks included, so the
                     numbers line up down the list instead of each row
                     ending wherever its own facts run out. */
                  <ul className="move-tally">
                    {[...r.moves].sort(byUse).map((m) => (
                      <li key={m.name}>
                        <span className="tally-name">{m.name}</span>
                        <span className="tally-used">×{m.used}</span>
                        <span className="tally-kos">{m.kos > 0 ? `${m.kos} KO` : ''}</span>
                        <span className="tally-dmg">{m.damage > 0 ? `${m.damage}%` : ''}</span>
                        <span className="tally-rate" title="Damage per use">
                          {m.damage > 0 ? `${perUse(m)}%/use` : ''}
                        </span>
                        <span className="tally-miss" title={luckNote(luckFor([m], moves))}>
                          {m.misses > 0 ? `${m.misses} miss` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <em className="none">{'—'}</em>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
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
