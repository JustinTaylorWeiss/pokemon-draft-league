import type { League } from '../data/league'

/** Parses a SheetJS workbook of the league sheet. Never writes to the sheet. */
export function parseLeagueSheet(
  workbook: unknown,
  dex: unknown,
): { league: League; warnings: string[]; statOverrides: number }
