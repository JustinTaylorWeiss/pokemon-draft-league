# Pokémon Draft League

A custom site for organizing a Pokémon draft league.

> ### ⚠️ The league spreadsheet is read-only
>
> Nothing in this project may write to the league's Google Sheet. The only
> permitted access is an HTTP `GET` of its export URL. Never edit, append to,
> re-upload, or reshare it — not even to correct data an import flags as wrong.
> Report the problem and let a human change the sheet.
>
> Restated in `CLAUDE.md`, `scripts/import-league.mjs`,
> `src/lib/parseLeagueSheet.js`, and `.github/workflows/sync-sheet.yml`.

## Running it

```bash
npm install
npm run dev
```

## Data

| Command | What it does |
| --- | --- |
| `npm run import:league -- <file-or-url>` | Reads the league sheet into `public/data/league.json` |
| `npm run build:data` | Rebuilds the Gen 9 Pokémon dataset from Pokémon Showdown |

The site also has a **Refresh** button that re-reads the sheet in the browser,
so the data updates without a deploy.

## Credit

Pokémon data from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown)
and sprites from [PokéAPI](https://github.com/PokeAPI/sprites). Pokémon is a
trademark of Nintendo / Creatures Inc. / GAME FREAK Inc. This is an unofficial
fan project.
