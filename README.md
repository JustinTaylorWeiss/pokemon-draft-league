# Pokémon Draft League

A custom site for organizing a Pokémon draft league.

> ### ⚠️ The league spreadsheet is read-only
>
> Nothing in this project may write to the league's Google Sheet. The only
> permitted access is an HTTP `GET` of its export URL. Never edit, append to,
> re-upload, or reshare it — not even to correct data an import flags as wrong.
> Report the problem and let a human change the sheet.
>
> Restated in `CLAUDE.md`, `scripts/import-league.mjs` and
> `src/lib/parseLeagueSheet.js`.
>
> The site itself no longer reads the sheet at all. Season 4 is finished, so it
> is served from the JSON in the build and nothing fetches Google — not on a
> button, not on page load, and not on a schedule.

## Running it

```bash
npm install
npm run dev
```

## Data

| Command | What it does |
| --- | --- |
| `npm run import:league -- <file-or-url>` | Reads the league sheet into `public/data/league.json`. Season 4 is finished and this has been run for the last time; it stays for provenance and for a future season that starts on a sheet |
| `npm run build:data` | Rebuilds the Pokémon dataset from Pokémon Showdown |
| `npm run snapshot` | Copies the live league before anything changes it — see `supabase/README.md` |

Season 5 is edited on the site and reads Supabase directly, so it is always
current. Season 4 is a frozen record: no refresh button, no background re-read,
no hourly sync — the file in the build is the season as it finished.

## Credit

Pokémon data from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown)
and sprites from [PokéAPI](https://github.com/PokeAPI/sprites). Pokémon is a
trademark of Nintendo / Creatures Inc. / GAME FREAK Inc. This is an unofficial
fan project.
