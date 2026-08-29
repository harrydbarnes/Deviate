# Deviate

Deviate is a static, daily timeline-guessing game for mobile and desktop. It is designed for GitHub Pages and has no accounts, server, or runtime data dependency beyond the committed puzzle file.

## Product decisions in this first pass

- The dataset is a frozen, denormalised set of 449 actors and 3,562 film credits in `data/people.json`. Each record has a stable slug, source ID, birth year, gender clue, popularity tier and at least four film credits with release year and character role.
- The catalogue build uses IMDb's public non-commercial TSV snapshots for dates, cast roles and birth years, with Wikidata's structured country-of-citizenship property for nationality. See [`data/SOURCES.md`](data/SOURCES.md) for the exact fields, transformations and rebuild commands.
- Each day is one mode: Middle mode is the default, release year appears regularly, and age at release is an occasional variation. The mode is selected deterministically by weekday so every puzzle stays internally consistent.
- Middle mode replaces the numeric guess with four film-credit choices. Years remain hidden and the goal is to choose the credit closest to the range midpoint.
- Every puzzle has five rounds. The generator backtracks until it finds a nested chain with a non-degenerate range on every round.
- Every frozen puzzle has a stable sequential number, displayed as `Deviate #N` in the game, archive and share result so players can identify the same daily line.
- New hidden clues favour A/B-tier actors and recognisable credits, using source recognition flags where available and a conservative familiar-title / repeated-lead fallback for the current snapshot. Targets distribute away from a free midpoint strategy where the data allows it, and avoid reusing a clue or actor within the recent rolling window.
- Deviate score is the average of each round's normalised distance, expressed as a percentage. Lower is better and 0.0 is perfect. Placement accuracy is the inverse percentage: `100 - Deviate score`.
- `data/daily.json` is append-only in normal operation. Once a date is present, the generator will never rewrite it, so historical puzzles stay frozen if generation logic changes later.

## Local development

```bash
npm run check
npm run generate:today
python3 -m http.server 4173
```

Open `http://localhost:4173`. The app fetches `data/daily.json`, so it should be served over HTTP rather than opened directly as a file.

To rebuild the catalogue after downloading the source snapshots, run `npm run build:data`, then `npm run enrich:data` and `npm run validate:data`. The checked-in actor index is only the candidate list; the large source snapshots stay out of the repository.

`npm run validate:puzzles` checks the frozen puzzle file, including the four-option structure and unique closest answer required by Middle mode.

## Deployment

`deploy.yml` publishes the repository root to GitHub Pages on every push to `main`. `generate-puzzles.yml` runs shortly after midnight UTC, appends the new frozen puzzle, and commits it back to `main`. The next push then deploys the updated archive automatically.

For the first deployment, open the repository's **Settings → Pages** screen and choose **GitHub Actions** as the build and deployment source. GitHub does not allow the repository token to enable Pages on an otherwise empty repository. Once that one-time setting is made, rerun `Deploy Deviate` from the Actions tab and future pushes will deploy normally.

All player progress, streaks, scores and backup data are stored in browser `localStorage`. A service worker caches the app shell and frozen puzzle catalogue so the latest loaded line remains playable without a connection. The header's `Today` badge links to [GameGrid](https://harrydbarnes.github.io/GameGrid/). The share output contains the puzzle number, date, Deviate score, placement accuracy, direction glyphs and site URL, never the anchor clues.
