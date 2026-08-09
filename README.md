# Pokémon Draft League

A static site for running a Pokémon draft league: browse the dex, see every
player's drafted team, and check weekly matchups. Friends log in with a league
code — there is no backend, so everything runs in the browser and deploys to
GitHub Pages.

**Generation 9 only.** Anything that predates Scarlet/Violet is stripped out at
build time.

## Getting started

```bash
npm install
npm run dev
```

## Quick Matchup

Build two teams, then analyze the matchup. Modelled on
[Pokémon DraftZone's](https://pokemondraftzone.com/tools/quick-matchup) tool of
the same name, with five panels:

| Panel | What it answers |
| --- | --- |
| **Draft Summary** | Stat table, heat-mapped against an adjustable neutral value, plus effective bulk |
| **Speed Tiers** | Both teams' speeds interleaved at Lv 100, so you can read off who outruns whom |
| **Defensive Type Chart** | Per-Pokémon weaknesses and resistances, with weak/resist/delta totals |
| **Coverage** | Which opponents each Pokémon can hit super-effectively |
| **Learned Moves** | Every move the team can learn, filterable by role (setup, hazard control, …) |

Teams persist in `localStorage`, so a refresh does not lose them.

### Where this matches DraftZone, and where it does not

Two calculations were verified directly against their output on the same teams:

- **Speed tiers** — identical on every case checked (Dragapult 252+ → 421,
  Iron Valiant 252+ under Quark Drive → 546).
- **Defensive type chart** — weakness and resistance counts match on all 18
  columns, including ability effects like Water Absorb.

Two deliberately differ:

- **Coverage.** Their percentages come from a curated movepool that is not
  published, and no rule I tested reproduced them. This version is explicit
  instead: it counts attacking moves at or above a base-power floor you choose,
  and every type chip can be toggled off to model a specific set. At the default
  of 75 BP, a wide-movepool Pokémon legitimately threatens most teams.
- **"CST".** Their summary has a column that runs slightly above BST
  (Zamazenta 660 → 666) with no published weighting. Rather than invent a
  formula, this shows physical and special bulk — HP × the matching defense —
  which BST hides because HP multiplies with defenses instead of adding to them.

## The dataset

`npm run build:data` regenerates `public/data/` from
[Pokémon Showdown's](https://play.pokemonshowdown.com/data/) battle data. The
committed output is what ships, so you only need to re-run this when a patch
changes tiers or adds Pokémon.

Showdown is the source rather than PokéAPI because it is already organized
around competitive play — base stats, abilities, learnsets, and Smogon tiers —
instead of lore and flavor text. A single PokéAPI `/pokemon` record is ~362 KB
because it repeats every move's learn data once per game version; the entire
dataset here is smaller than four of those records.

| File | Raw | Gzipped | Contents |
| --- | ---: | ---: | --- |
| `pokemon.json` | 275 KB | 45 KB | 876 Pokémon — stats, types, abilities, tiers |
| `moves.json` | 130 KB | 19 KB | 685 moves — power, accuracy, category |
| `learnsets.json` | 819 KB | 95 KB | Gen 9 learn data for 818 Pokémon |
| `abilities.json` | 38 KB | 10 KB | 310 abilities with descriptions |
| `typechart.json` | 4 KB | 0.6 KB | 19×19 effectiveness multipliers |
| **Total** | **1.24 MB** | **169 KB** | |

`learnsets.json` is ~5× everything else combined, so `loadCore()` skips it.
Call `loadLearnsets()` only from views that need move coverage.

### What gets dropped

Filtering to Gen 9 removes roughly two-thirds of the source data:

- **641 of 1517 Pokémon** — Megas, past-gen-only species, and CAP fakemon
- **269 of 954 moves** — moves cut from Scarlet/Violet
- **174,263 of 225,240 learnset entries** — every pre-Gen-9 learn source

What remains is 733 species plus 143 alternate formes (regionals, Paradox forms,
Ogerpon masks, and similar).

### Notes on the shape

- `accuracy: true` means the move bypasses accuracy checks, not 100%.
- Learn sources drop the redundant generation digit: `"M"` is a TM, `"L45"` is
  level 45, `"E"` is an egg move, `"T"` is a tutor.
- Showdown stores the type chart inverted, as damage *taken*. The build script
  flips it, so `chart[attacking][defending]` is a plain multiplier.
- Sprites are derived from the Pokémon's id rather than stored — see
  `spriteUrl()` and `artworkUrl()` in `src/data/load.ts`.

## Deploying

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes to GitHub Pages. Enable it once under **Settings → Pages → Source →
GitHub Actions**.

`vite.config.ts` sets `base` to `/pokemon-draft-league/` for production. Rename
the repo and that needs to change too.

## Data credit

Pokémon data from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown)
and sprites from [PokéAPI](https://github.com/PokeAPI/sprites). Pokémon is a
trademark of Nintendo / Creatures Inc. / GAME FREAK Inc. This is an unofficial
fan project.
