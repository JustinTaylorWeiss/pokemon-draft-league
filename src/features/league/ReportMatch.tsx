import { useEffect, useState } from 'react'
import { fetchReplay, replayId, type ReplayGame } from '../../lib/parseReplay'
import { currentSeasonId, db, errorText, reportMatch, updateRow } from '../../data/supabase'
import { toId } from '../../data/load'
import type { League } from '../../data/league'

/**
 * Recording a match by pasting its replays.
 *
 * The replay log already knows who played, who won, and who knocked out what,
 * so the form asks for links and nothing else. Typing a result in by hand means
 * typing it in wrong eventually; reading it out of the battle does not.
 *
 * A series is best-of-three, so two links are enough only when they are a
 * sweep. If the first two games went one apiece there is a third game whether
 * or not it was pasted, and the form asks for it rather than recording a 1-1.
 */

interface Props {
  league: League
  onClose: () => void
  onSaved: () => void
}

/** A game with its two sides put in a stable order across the series. */
interface AlignedGame {
  game: ReplayGame
  /** The link it came from, kept so the match can point back at the replay. */
  link: string
  /** The side of this game's log belonging to the series' first account. */
  a: ReplayGame['a']
  b: ReplayGame['a']
  winner: 'a' | 'b' | null
}

const normalise = (account: string) => account.toLowerCase().replace(/\s+/g, '')
/** "1 and 3", or "1, 2 and 3". */
const listOf = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/** `Urshifu-Rapid-Strike` and `Urshifu-*` share a base, so they are one Pokémon. */
const baseName = (mon: string) => mon.split('-')[0].trim().toLowerCase()

export function ReportMatch({ league, onClose, onSaved }: Props) {
  const [week, setWeek] = useState(() => nextWeek(league))
  const [links, setLinks] = useState(['', '', ''])
  const [games, setGames] = useState<AlignedGame[] | null>(null)
  const [accounts, setAccounts] = useState<[string, string] | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [known, setKnown] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needThird, setNeedThird] = useState(false)
  /** Field indices holding a link that also appears in another field. */
  const [clashing, setClashing] = useState<Set<number>>(new Set())

  // Accounts already claimed by a player fill themselves in, so the mapping is
  // asked for once per person and never again.
  useEffect(() => {
    // This season's accounts only: the same person plays in more than one, and
    // a replay belongs to the season being reported on.
    db.from('players').select('id, showdown_account')
      .eq('season_id', currentSeasonId())
      .then(({ data }) => {
      const found: Record<string, string> = {}
      for (const row of (data ?? []) as { id: string; showdown_account: string | null }[]) {
        if (row.showdown_account) found[normalise(row.showdown_account)] = row.id
      }
      setKnown(found)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function read() {
    setError(null)
    setNeedThird(false)
    setClashing(new Set())

    // Kept with their field numbers, so a complaint can name the box it means
    // rather than a position in a filtered list.
    const entries = links
      .map((link, i) => ({ link: link.trim(), field: i + 1, index: i }))
      .filter((e) => e.link)

    if (entries.length < 2) {
      setError('Paste at least the first two games. The third is only needed if the series went to one.')
      return
    }

    // The same replay twice is the same game twice, and would record a result
    // that never happened — two of the same game reads as a 2-0. Compared by
    // replay id rather than by text, so the same game pasted once with a
    // trailing slash and once with a `?p2` still counts as the same game.
    const seenAt = new Map<string, number[]>()
    for (const e of entries) {
      const id = replayId(e.link) ?? e.link.toLowerCase()
      seenAt.set(id, [...(seenAt.get(id) ?? []), e.field])
    }
    const repeated = [...seenAt.values()].filter((fields) => fields.length > 1)
    if (repeated.length) {
      const fields = repeated.flat().sort((a, b) => a - b)
      setClashing(new Set(fields.map((f) => f - 1)))
      setError(
        `Game ${listOf(fields.map(String))} are the same replay. `
        + 'Each game needs its own link.',
      )
      return
    }

    const given = entries.map((e) => e.link)

    setBusy(true)
    try {
      const parsed = await Promise.all(given.map(fetchReplay))

      // Game one fixes which account is side A; later games may have the
      // players seated the other way round, so they are matched by account.
      const first = parsed[0]
      const pair: [string, string] = [first.a.account, first.b.account]
      const aligned: AlignedGame[] = parsed.map((g, i) => {
        const straight = normalise(g.a.account) === normalise(pair[0])
        const swapped = normalise(g.a.account) === normalise(pair[1])
        if (!straight && !swapped) {
          throw new Error(
            `Game ${i + 1} is between ${g.a.account} and ${g.b.account}, `
            + `but game 1 was ${pair[0]} vs ${pair[1]}. These are not the same series.`,
          )
        }
        return straight
          ? { game: g, link: given[i], a: g.a, b: g.b, winner: g.winner }
          : {
              game: g, link: given[i], a: g.b, b: g.a,
              winner: g.winner === 'a' ? 'b' : g.winner === 'b' ? 'a' : null,
            }
      })

      if (aligned.some((g) => !g.winner)) {
        throw new Error('One of those replays has no winner — it may have been a tie or an abandoned battle.')
      }

      const wonA = aligned.filter((g) => g.winner === 'a').length
      const wonB = aligned.length - wonA
      // Two games that split are not a result. There is a game three; it just
      // has not been pasted yet.
      if (aligned.length === 2 && wonA === wonB) {
        setNeedThird(true)
        throw new Error(
          `${pair[0]} and ${pair[1]} won one each, so this series went to a game 3. Paste its link too.`,
        )
      }

      setGames(aligned)
      setAccounts(pair)
      setMapping({
        [normalise(pair[0])]: known[normalise(pair[0])] ?? '',
        [normalise(pair[1])]: known[normalise(pair[1])] ?? '',
      })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!games || !accounts) return
    const playerA = mapping[normalise(accounts[0])]
    const playerB = mapping[normalise(accounts[1])]
    if (!playerA || !playerB) {
      setError('Say which league player each account belongs to.')
      return
    }
    if (playerA === playerB) {
      setError('Both accounts are pointing at the same player.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const nameOf = (id: string) => league.players.find((p) => p.id === id)?.name ?? id
      const summed = totals(games)

      // One id per Pokemon across the whole series. Team preview masks formes,
      // so the same Pokemon can be `Urshifu-*` in one game and
      // `Urshifu-Rapid-Strike` in another; the series totals have already
      // settled on the concrete name, and the games follow it rather than
      // filing the same Pokemon under two ids.
      const canonical = new Map(summed.map((l) => [`${l.side}-${baseName(l.pokemon)}`, toId(l.pokemon)]))
      const idOf = (side: 'a' | 'b', mon: string) =>
        canonical.get(`${side}-${baseName(mon)}`) ?? toId(mon)

      const lineOf = (side: 'a' | 'b') =>
        (l: { pokemon: string; kills: number; deaths: number; brought: boolean }) => ({
          pokemon_id: idOf(side, l.pokemon),
          kills: l.kills,
          deaths: l.deaths,
          brought: l.brought,
        })

      // Numbered in the order they were played, which is the order they were
      // pasted — game 1 in the first field. The score is left to the database,
      // which counts it from these.
      await reportMatch({
        week,
        label: `${nameOf(playerA)} vs ${nameOf(playerB)}`,
        sideA: [playerA],
        sideB: [playerB],
        games: games.map((g, i) => {
          const id = replayId(g.link)
          return {
            number: i + 1,
            winner: g.winner,
            replay_url: id ? `https://replay.pokemonshowdown.com/${id}` : g.link,
            survivors: g.game.survivors,
            a: g.a.lines.map(lineOf('a')),
            b: g.b.lines.map(lineOf('b')),
          }
        }),
        lines: summed.map((l) => ({
          side: l.side, pokemon_id: toId(l.pokemon), kills: l.kills, deaths: l.deaths,
        })),
      })

      // Remember the accounts, so the next report from these two fills itself in.
      for (const [account, player] of [[accounts[0], playerA], [accounts[1], playerB]] as const) {
        if (known[normalise(account)] !== player) {
          await updateRow('players', { id: player }, { showdown_account: account })
            .catch(() => {}) // Not worth failing a saved match over.
        }
      }

      onSaved()
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const scoreA = games ? games.filter((g) => g.winner === 'a').length : 0
  const scoreB = games ? games.length - scoreA : 0

  // No click-away close: the backdrop is easy to hit by accident, and hitting
  // it would throw away three pasted links and a parsed result. Closing is the
  // ✕, which nobody presses without meaning to.
  return (
    <div className="modal-backdrop">
      <div className="modal report-modal" role="dialog" aria-modal="true" aria-label="Record a match">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="report-title">Record a match</h2>
        <p className="report-lead">
          Paste the Showdown replays. Everything else — who won, and every
          knockout — is read out of the battle.
        </p>

        <label className="report-week">
          Week
          <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {weekOptions(league).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>

        <div className="report-links">
          {links.map((link, i) => (
            <label
              key={i}
              className={
                clashing.has(i) ? 'dupe-link' : needThird && i === 2 ? 'wants-link' : undefined
              }
            >
              <span>
                Game {i + 1}
                {i === 2 && <em>{needThird ? ' — needed' : ' — only if it went three'}</em>}
              </span>
              <input
                type="url"
                value={link}
                placeholder="https://replay.pokemonshowdown.com/…"
                onChange={(e) => setLinks(links.map((l, j) => (j === i ? e.target.value : l)))}
              />
            </label>
          ))}
        </div>

        {error && <p className="report-error">{error}</p>}

        {!games && (
          <div className="report-actions">
            <button type="button" className="report-go" onClick={read} disabled={busy}>
              {busy ? 'Reading replays…' : 'Read replays'}
            </button>
          </div>
        )}

        {games && accounts && (
          <>
            <div className="report-result">
              <h3>{scoreA}–{scoreB}</h3>
              <div className="report-sides">
                {([0, 1] as const).map((n) => (
                  <label key={n} className="report-map">
                    <span>{accounts[n]}</span>
                    <select
                      value={mapping[normalise(accounts[n])] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [normalise(accounts[n])]: e.target.value })}
                    >
                      <option value="">Which player?</option>
                      {league.players.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <table className="report-lines">
              <thead>
                <tr><th>Pokémon</th><th>Side</th><th>KOs</th><th>Fainted</th></tr>
              </thead>
              <tbody>
                {totals(games).map((l) => (
                  <tr key={`${l.side}-${l.pokemon}`}>
                    <td>{l.pokemon}</td>
                    <td>{l.side === 'a' ? accounts[0] : accounts[1]}</td>
                    <td>{l.kills}</td>
                    <td>{l.deaths}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="report-actions">
              <button type="button" className="report-back" onClick={() => setGames(null)}>Back</button>
              <button type="button" className="report-go" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save match'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Kills and deaths summed over every game in the series, per Pokémon.
 *
 * Merged on the base name rather than the exact one. Team preview masks some
 * formes, so the same Pokémon can be `Urshifu-*` in a game it sat out and
 * `Urshifu-Rapid-Strike` in one it played — two rows, and two different ids,
 * for one team slot. The concrete name wins, since that is the one that was
 * drafted. Species clause means a base name cannot belong to two Pokémon on
 * the same team, so this cannot merge two that are genuinely different.
 */
function totals(games: AlignedGame[]) {
  const acc = new Map<string, { side: 'a' | 'b'; pokemon: string; kills: number; deaths: number }>()
  for (const g of games) {
    for (const side of ['a', 'b'] as const) {
      for (const line of g[side].lines) {
        const key = `${side}-${baseName(line.pokemon)}`
        const row = acc.get(key) ?? { side, pokemon: line.pokemon, kills: 0, deaths: 0 }
        if (row.pokemon.includes('*') && !line.pokemon.includes('*')) row.pokemon = line.pokemon
        row.kills += line.kills
        row.deaths += line.deaths
        acc.set(key, row)
      }
    }
  }
  return [...acc.values()].sort((x, y) => x.side.localeCompare(y.side) || y.kills - x.kills)
}

const weekOptions = (league: League) =>
  Array.from({ length: league.meta.weeks ?? 9 }, (_, i) => i + 1)

/** Defaults to the week after the last one with a result in it. */
function nextWeek(league: League) {
  const played = league.schedule.filter((m) => m.scoreA !== null).map((m) => m.week)
  const last = played.length ? Math.max(...played) : 0
  return Math.min(last + 1, league.meta.weeks ?? 9) || 1
}
