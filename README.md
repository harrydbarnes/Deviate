# Deviate

Deviate is a static, daily timeline-guessing game for mobile and desktop. It is designed for GitHub Pages and has no accounts, server, or runtime data dependency beyond the committed puzzle file.

## Product decisions in this first pass

- The initial dataset is a curated actor and film-credit set in `data/people.json`. It is intentionally small enough to audit and easy to extend with a sourced dataset later.
- Each day is one mode: release year or age at release. The mode alternates deterministically by date so every puzzle stays internally consistent.
- Every puzzle has five rounds. The generator backtracks until it finds a nested chain with a non-degenerate range on every round.
- Score is the average of each round's absolute guess distance divided by that round's range, expressed as a percentage. Lower is better and 0.0 is perfect.
- `data/daily.json` is append-only in normal operation. Once a date is present, the generator will never rewrite it, so historical puzzles stay frozen if generation logic changes later.

## Local development

```bash
npm run check
npm run generate:today
python3 -m http.server 4173
```

Open `http://localhost:4173`. The app fetches `data/daily.json`, so it should be served over HTTP rather than opened directly as a file.

## Deployment

`deploy.yml` publishes the repository root to GitHub Pages on every push to `main`. `generate-puzzles.yml` runs shortly after midnight UTC, appends the new frozen puzzle, and commits it back to `main`. The next push then deploys the updated archive automatically.

For the first deployment, open the repository's **Settings → Pages** screen and choose **GitHub Actions** as the build and deployment source. GitHub does not allow the repository token to enable Pages on an otherwise empty repository. Once that one-time setting is made, rerun `Deploy Deviate` from the Actions tab and future pushes will deploy normally.

All player progress, streaks, scores and backup data are stored in browser `localStorage`. The share output contains only the date, score, direction glyphs and site URL, never the anchor clues.
