# Pokémon Draft League — project instructions

## The league spreadsheet is READ-ONLY. Never write to it.

The master sheet is:

```
https://docs.google.com/spreadsheets/d/1xnKp-XtR9o-zJy1BNS78PxXy891zv_n4rawKto6rlyE/edit
```

**The share link grants edit access. Do not use it.** This project reads from
that sheet and never writes to it, under any circumstances.

That means, without exception:

- **Never** edit, add, delete, rename, reorder, or reformat any cell, row,
  column, sheet, or tab.
- **Never** issue a write, append, update, clear, batchUpdate, or delete call
  against the Sheets/Drive API for this document.
- **Never** re-upload, overwrite, or "sync back" a modified copy of the file.
- **Never** change sharing, permissions, or ownership.
- **Never** fix data in the sheet, even when the import reports an error,
  a name that will not resolve, or numbers that contradict each other.
  Report the problem to the user and let a human make the change.

The only permitted access is an HTTP **GET** of the export URL:

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=xlsx
```

`scripts/import-league.mjs` is the single place that touches the sheet, and it
only ever fetches and parses. If a task seems to call for changing the sheet,
it does not — say so and stop.

## How the data flows

The sheet is the source of truth for the league. Where it and the Showdown
dataset disagree, the sheet wins — see `mergeDex()` in `src/data/league.ts`.

- `npm run import:league -- <file-or-url>` → `public/data/league.json`
- `npm run build:data` → the Pokémon dataset in `public/data/`

Both write only into this repo. Neither writes anywhere else.
