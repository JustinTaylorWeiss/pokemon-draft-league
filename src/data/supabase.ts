import { createClient } from '@supabase/supabase-js'

/**
 * The league database.
 *
 * Both values are safe in the repo. The publishable key identifies the project
 * and grants nothing on its own — every table's access rules apply to it just
 * as they do to any other caller, and the passphrase-gated action is not
 * reachable through it at all. This is the same posture as the sheet link that
 * already ships in the bundle.
 *
 * The `service_role` key is the opposite of that and must never appear here or
 * anywhere the browser can see. Nothing in this app needs it.
 */
const SUPABASE_URL = 'https://skborcymmwraaycgygga.supabase.co'
const SUPABASE_KEY = 'sb_publishable_oGfMOvaA4kh1tvmws_iA7Q_PMbZUjPq'

export const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

/**
 * Who the browser says is editing. Not authentication and not trusted — it is
 * stamped onto every change so the history reads "Nolan changed this on
 * Tuesday" rather than "someone changed this", which is the difference between
 * a log you can act on and one you can only stare at.
 */
const ACTOR_KEY = 'league:actor'

export function currentActor(): string {
  try {
    return localStorage.getItem(ACTOR_KEY) || 'anonymous'
  } catch {
    return 'anonymous'
  }
}

export function setActor(name: string) {
  try {
    localStorage.setItem(ACTOR_KEY, name)
  } catch {
    // Private browsing. Edits still work; they are just logged as anonymous.
  }
}

/**
 * Raised when a write is refused.
 *
 * Row-level security denies by filtering rows rather than by raising, so a
 * forbidden write returns success having changed nothing. Trusting the absence
 * of an error would mean silently losing edits, so every write goes through the
 * helpers below and every one checks what actually came back.
 */
export class WriteRefused extends Error {
  constructor(what: string) {
    super(`${what} did not go through. Nothing was changed.`)
    this.name = 'WriteRefused'
  }
}

type Row = Record<string, unknown>

/** Inserts rows, stamping the actor, and confirms they landed. */
export async function insertRows<T extends Row>(table: string, rows: T[]): Promise<T[]> {
  if (!rows.length) return []
  const stamped = rows.map((r) => ({ ...r, edited_by: currentActor() }))
  const { data, error } = await db.from(table).insert(stamped).select()
  if (error) throw error
  if (!data?.length) throw new WriteRefused(`Adding to ${table}`)
  return data as T[]
}

/** Updates one row by its key columns, and confirms the row actually changed. */
export async function updateRow<T extends Row>(
  table: string,
  key: Row,
  patch: T,
): Promise<T> {
  let query = db.from(table).update({ ...patch, edited_by: currentActor() })
  for (const [col, value] of Object.entries(key)) query = query.eq(col, value as never)
  const { data, error } = await query.select()
  if (error) throw error
  if (!data?.length) throw new WriteRefused(`Editing ${table}`)
  return data[0] as T
}

/**
 * Deletes one row by its key columns.
 *
 * The actor is written first so the delete trigger has someone to record: it
 * reads `edited_by` off the row being removed, and a row deleted without that
 * step is logged as anonymous.
 */
export async function deleteRow(table: string, key: Row): Promise<void> {
  await updateRow(table, key, {} as Row).catch(() => {
    // The stamp is a nicety; a row that cannot be stamped can still be deleted.
  })
  let query = db.from(table).delete()
  for (const [col, value] of Object.entries(key)) query = query.eq(col, value as never)
  const { data, error } = await query.select()
  if (error) throw error
  if (!data?.length) throw new WriteRefused(`Removing from ${table}`)
}

/** Puts a row back the way it was before one event, and records the undo. */
export async function revertEvent(eventId: number): Promise<number> {
  const { data, error } = await db.rpc('revert_event', {
    event_id: eventId,
    who: currentActor(),
  })
  if (error) throw error
  return data as number
}

/** Opens the draft. The passphrase is checked by the database, not here. */
export async function startDraft(passphrase: string) {
  const { data, error } = await db.rpc('start_draft', {
    passphrase,
    who: currentActor(),
  })
  if (error) throw error
  return data
}

/**
 * Adds a player. Gated, and not by this function — `players` has no insert
 * policy at all, so this RPC is the only way in and it does the check itself.
 */
export async function addPlayer(passphrase: string, name: string, team?: string) {
  const { data, error } = await db.rpc('add_player', {
    passphrase, name, team: team || null, who: currentActor(),
  })
  if (error) throw error
  return data
}

/** Removes a player. Refuses if they appear in a recorded match. */
export async function removePlayer(passphrase: string, playerId: string) {
  const { data, error } = await db.rpc('remove_player', {
    passphrase, player_id: playerId, who: currentActor(),
  })
  if (error) throw error
  return data as string
}
