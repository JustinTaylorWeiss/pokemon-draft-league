import { useEffect, useMemo, useState } from 'react'
import { db, errorText, revertEvent, unlock } from '../../data/supabase'
import { DropPicker } from '../../components/DropPicker'
import { LoadingBall } from '../../components/LoadingBall'
import type { League } from '../../data/league'

/**
 * Everything that has been done, by whom, and when.
 *
 * The log is the reason editing can be open to everyone: nothing is anonymous
 * and nothing is silent. It reads from `events`, which every table writes to
 * through a trigger, so this cannot drift from what actually happened.
 *
 * Rows are grouped by transaction. One reported match writes fifty-odd rows —
 * the match, its lines, its games, their lines — all sharing a timestamp
 * because a function body is a single transaction. Listed one per row that
 * would bury everything else; collapsed, it is one line saying so.
 */

interface EventRow {
  id: number
  at: string
  actor: string | null
  action: 'insert' | 'update' | 'delete'
  table_name: string
  row_key: Record<string, unknown> | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  /** What the league was doing when this happened. Null for older rows. */
  phase: string | null
  /** The event this one undoes, if it is an undo. */
  reverts: number | null
}

/**
 * What a change is really about.
 *
 * A pick and a trade are the same write — a roster row and the board's claim —
 * and only the moment tells them apart. The trigger stamps the draft's status
 * as it happens, so a roster change made after somebody closed the draft is a
 * trade and one made while it was open is a pick.
 */
const KINDS = [
  { key: 'draft', label: 'Draft', tables: ['rosters', 'board', 'draft_picks', 'draft_state'] },
  { key: 'trades', label: 'Trades', tables: [] },
  { key: 'undos', label: 'Undos', tables: [] },
  { key: 'matches', label: 'Matches', tables: ['matches', 'match_lines', 'games', 'game_lines'] },
  { key: 'players', label: 'Players', tables: ['players'] },
  { key: 'league', label: 'League', tables: ['league_meta', 'rules_sections'] },
] as const

const ROSTER_TABLES = ['rosters', 'board', 'draft_picks']

function kindOf(table: string, phase: string | null, reverts?: number | null) {
  // An undo is an undo whatever it touched.
  if (reverts != null) return 'undos'
  // Drafting is what happens while the draft is open. A roster change at any
  // other time is a trade, whether the draft has ended or never began — the
  // only thing that makes a pick a pick is that a draft was running.
  //
  // A null phase is from before this was recorded, and stays with the draft
  // rather than being called a trade on no evidence.
  if (ROSTER_TABLES.includes(table) && phase !== null && phase !== 'active') return 'trades'
  return KINDS.find((k) => (k.tables as readonly string[]).includes(table))?.key ?? 'league'
}

/**
 * One transaction's worth of changes.
 *
 * `table` is the one the group is named after, not the only one it touched. A
 * claim writes the roster row and the board's claim together; both describe the
 * same act, and listing them separately said everything twice.
 */
interface Group {
  id: number
  at: string
  actor: string
  table: string
  phase: string | null
  reverts: number | null
  action: EventRow['action']
  rows: EventRow[]
}

/**
 * Which table a mixed transaction is really about.
 *
 * Earlier in this list wins: a match report writes matches, lines, games and
 * game lines at once, and it is a recorded match rather than four hundred
 * numbers.
 */
const LEADS = [
  'draft_state', 'matches', 'players', 'league_meta', 'rules_sections',
  'rosters', 'draft_picks', 'board', 'games', 'match_lines', 'game_lines',
]

const lead = (rows: EventRow[]) => {
  const tables = new Set(rows.map((r) => r.table_name))
  return LEADS.find((t) => tables.has(t)) ?? rows[0].table_name
}

const NAMES: Record<string, [string, string]> = {
  rosters: ['drafted', 'released'],
  board: ['added to the board', 'removed from the board'],
  matches: ['recorded a match', 'deleted a match'],
  games: ['added game detail', 'deleted game detail'],
  match_lines: ['added match detail', 'deleted match detail'],
  game_lines: ['added game detail', 'deleted game detail'],
  draft_picks: ['recorded a pick', 'removed a pick'],
  players: ['added', 'removed'],
  rules_sections: ['edited the rules', 'removed a rule'],
  league_meta: ['edited the league', 'edited the league'],
  draft_state: ['started the draft', 'changed the draft'],
}

/** A sentence for one group, rather than a table name and a verb. */
function describe(g: Group, names: Map<string, string>): string {
  const rows = g.rows.filter((r) => r.table_name === g.table)
  const n = rows.length
  const key = (r: EventRow) => {
    const k = r.row_key ?? {}
    return String(k.pokemon_id ?? k.id ?? k.player_id ?? '')
  }
  const subject = names.get(key(rows[0])) ?? key(rows[0])

  if (g.table === 'rosters') {
    // The filter already says whether this was a draft or a trade; the line
    // only has to say what happened to the Pokémon.
    const traded = g.phase !== null && g.phase !== 'active'
    const verb = g.action === 'insert' ? (traded ? 'picked up' : 'drafted')
      : g.action === 'delete' ? 'released'
      : 'changed'
    const mons = rows.map((r) => names.get(String(r.row_key?.pokemon_id ?? '')) ?? r.row_key?.pokemon_id)
    return `${verb} ${mons.slice(0, 4).join(', ')}${n > 4 ? ` and ${n - 4} more` : ''}`
  }
  if (g.table === 'draft_state') {
    const status = String(rows[0].after?.status ?? '')
    return status === 'active' ? 'started the draft'
      : status === 'complete' ? 'ended the draft' : 'changed the draft'
  }
  if (g.table === 'matches') {
    if (g.action === 'insert') return `recorded ${n === 1 ? 'a match' : `${n} matches`}`
    if (g.action === 'delete') return `deleted ${n === 1 ? 'a match' : `${n} matches`}`
    return `edited ${n === 1 ? 'a match' : `${n} matches`}`
  }
  if (g.table === 'players') {
    if (g.action === 'insert') return `added ${subject}`
    if (g.action === 'delete') return `removed ${subject}`
    const hid = rows[0].after?.hidden
    const was = rows[0].before?.hidden
    if (hid !== was) return hid ? `hid ${subject}` : `restored ${subject}`
    return `edited ${subject}`
  }
  if (g.table === 'board' && g.action === 'update') {
    const claim = rows[0].after?.drafted_by
    const mon = names.get(String(rows[0].row_key?.pokemon_id ?? '')) ?? subject
    const traded = g.phase !== null && g.phase !== 'active'
    if (claim) return traded ? `picked up ${mon}` : `claimed ${mon}`
    if (rows[0].before?.drafted_by) return `released ${mon}`
    return `edited ${mon}`
  }

  const [added, removed] = NAMES[g.table] ?? [`changed ${g.table}`, `changed ${g.table}`]
  const verb = g.action === 'delete' ? removed : added
  return n > 1 ? `${verb} (${n})` : verb
}

/** "3 minutes ago", and the full stamp on hover. */
function ago(iso: string, now: number) {
  const secs = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString()
}

const PAGE = 400

export function History({ league }: { league: League }) {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** One kind at a time, or everything. */
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  /**
   * Undoing reaches backwards through other people's work, so it is asked for
   * once and then stays open while you work through the log. The passphrase is
   * kept only to send with each undo — the database checks it every time, so
   * this unlock is a convenience and not the boundary.
   */
  const [passphrase, setPassphrase] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  async function tryUnlock(e: React.FormEvent) {
    e.preventDefault()
    setUndoError(null)
    try {
      if (await unlock(passphrase)) { setUnlocked(true); setAsking(false) }
      else setUndoError('That passphrase is not right.')
    } catch (err) {
      setUndoError(errorText(err))
    }
  }

  /**
   * Undoes a whole transaction, newest write first.
   *
   * A claim writes two rows and a match report writes dozens; undoing only the
   * one the line is named after would leave the rest standing. Reverse order
   * matters — the later writes have to come off before the earlier ones.
   */
  async function undo(g: Group) {
    setBusy(g.id)
    setUndoError(null)
    try {
      for (const row of [...g.rows].sort((a, b) => b.id - a.id)) {
        await revertEvent(passphrase, row.id)
      }
      setLimit((n) => n) // keep the window
      const { data } = await db.from('events').select('*')
        .not('actor', 'in', '("generated","import")')
        .order('id', { ascending: false }).limit(limit)
      setEvents((data ?? []) as EventRow[])
      setNow(Date.now())
    } catch (err) {
      setUndoError(errorText(err))
    } finally {
      setBusy(null)
    }
  }
  const [limit, setLimit] = useState(PAGE)
  // Stamped when the log is read, so "3 min ago" is measured from the same
  // moment for every row rather than from whenever each one happens to render.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // The invented season's rows are not things anybody did, and a log of what
    // people did should not be mostly a script talking to itself.
    db.from('events').select('*')
      .not('actor', 'in', '("generated","import")')
      .order('id', { ascending: false }).limit(limit)
      .then(({ data, error: err }) => {
        if (err) setError(errorText(err))
        else setEvents((data ?? []) as EventRow[])
        setNow(Date.now())
      })
  }, [limit])

  /** Names for the ids the log stores, so it reads in words. */
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of league.players) m.set(p.id, p.name)
    for (const [id, e] of Object.entries(league.board)) m.set(id, e.name)
    return m
  }, [league.players, league.board])

  /**
   * Grouped by transaction. Everything a function body writes shares an exact
   * timestamp, which is what makes this reliable rather than a guess about
   * things that happened close together.
   */
  /**
   * Events that some later undo reverses.
   *
   * An undo is an ordinary event carrying the id it reverses, so the set of
   * undone changes is read straight off the log rather than tracked separately.
   */
  const undone = useMemo(() => {
    const ids = new Set<number>()
    for (const e of events ?? []) if (e.reverts != null) ids.add(e.reverts)
    return ids
  }, [events])

  const groups = useMemo(() => {
    const out: Group[] = []
    for (const e of events ?? []) {
      const last = out[out.length - 1]
      if (last && last.at === e.at && last.actor === (e.actor ?? 'anonymous')) {
        last.rows.push(e)
      } else {
        out.push({
          id: e.id, at: e.at, actor: e.actor ?? 'anonymous',
          table: e.table_name, phase: e.phase, reverts: e.reverts,
          action: e.action, rows: [e],
        })
      }
    }
    // The naming table can only be chosen once the whole group is collected.
    for (const g of out) {
      g.table = lead(g.rows)
      g.action = g.rows.find((r) => r.table_name === g.table)?.action ?? g.action
      g.reverts = g.rows.find((r) => r.reverts != null)?.reverts ?? null
    }
    return out
  }, [events])

  const q = query.trim().toLowerCase()
  const shown = groups.filter((g) => {
    if (kind && kindOf(g.table, g.phase, g.reverts) !== kind) return false
    if (!q) return true
    // Searched on what the row actually reads as, so looking for a Pokémon or
    // a person finds it without knowing which table it came from.
    return `${g.actor} ${describe(g, names)}`.toLowerCase().includes(q)
  })

  if (error) return <p className="error">Could not read the history: {error}</p>
  if (!events) return <LoadingBall label="Reading the history…" inline />

  return (
    <div className="history">
      <div className="controls history-controls">
        <input
          type="search" className="history-search" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the history…" aria-label="Search the history"
        />
        <DropPicker
          className="history-picker"
          ariaLabel="Filter the history"
          items={[
            { id: '', label: 'Everything', note: `${groups.length} changes` },
            ...KINDS.map((k) => {
              const n = groups.filter((g) => kindOf(g.table, g.phase, g.reverts) === k.key).length
              return { id: k.key, label: k.label, note: `${n} change${n === 1 ? '' : 's'}` }
            }),
          ]}
          value={kind}
          onPick={(item) => setKind(item.id)}
        />
        <span className="count">{shown.length} shown</span>
        {[...undone].length > 0 && (
          <span className="history-key">
            <span className="history-key-swatch" aria-hidden="true" />
            Undone
          </span>
        )}

        {unlocked ? (
          <span className="undo-ready">Undo enabled</span>
        ) : (
          <button type="button" className="undo-unlock" onClick={() => setAsking((v) => !v)}>
            Revert changes
          </button>
        )}
        {asking && !unlocked && (
          <form className="undo-ask" onSubmit={tryUnlock}>
            <input
              type="password" value={passphrase} autoFocus autoComplete="off"
              placeholder="Passphrase" onChange={(e) => setPassphrase(e.target.value)}
            />
            <button type="submit" disabled={!passphrase.trim()}>Unlock</button>
          </form>
        )}
      </div>
      {undoError && <p className="report-error">{undoError}</p>}

      <section className="panel">
        <ul className="history-list">
          {shown.map((g) => (
            <li
              key={g.id}
              className={`kind-${kindOf(g.table, g.phase, g.reverts)}${
                g.rows.some((r) => undone.has(r.id)) ? ' is-undone' : ''}`}
            >
              <span className="history-actor">{g.actor}</span>
              <span className="history-what">{describe(g, names)}</span>
              <span className="history-when" title={new Date(g.at).toLocaleString()}>
                {ago(g.at, now)}
              </span>
              {unlocked && (() => {
                // Undoing an undone change puts it back — the same call either
                // way, since an undo is just another change that can be undone.
                const isUndone = g.rows.some((r) => undone.has(r.id))
                return (
                  <button
                    type="button" className={`history-undo${isUndone ? ' is-redo' : ''}`}
                    disabled={busy !== null}
                    title={isUndone
                      ? 'Put this change back'
                      : g.rows.length > 1
                        ? `Undo all ${g.rows.length} changes this made`
                        : 'Undo this change'}
                    onClick={() => undo(g)}
                  >
                    {busy === g.id ? '…' : isUndone ? 'Redo' : 'Undo'}
                  </button>
                )
              })()}
            </li>
          ))}
          {shown.length === 0 && <li className="history-empty">Nothing of that kind yet.</li>}
        </ul>
      </section>

      {events.length >= limit && (
        <div className="history-more">
          <button type="button" onClick={() => setLimit((n) => n + PAGE)}>
            Load older
          </button>
        </div>
      )}
    </div>
  )
}
