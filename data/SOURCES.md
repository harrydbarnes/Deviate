# Deviate dataset sources

`people.json` is a frozen, denormalised snapshot for the game. It contains 449 actors and 3,562 film credits.

## Inputs

- [IMDb non-commercial datasets](https://developer.imdb.com/non-commercial-datasets/)
  - [`name.basics.tsv.gz`](https://datasets.imdbws.com/name.basics.tsv.gz) supplies the IMDb name ID, display name, birth year and primary professions.
  - [`title.basics.tsv.gz`](https://datasets.imdbws.com/title.basics.tsv.gz) supplies film titles and release years.
  - [`title.principals.tsv.gz`](https://datasets.imdbws.com/title.principals.tsv.gz) supplies cast order and character names.
- [Algolia's public actor index](https://github.com/algolia/datasets/blob/master/movies/actors.json) supplies the initial candidate list and a repeatable popularity ordering. The checked-in copy is `actor-index.json`.
- [Wikidata](https://www.wikidata.org/) supplies nationality from the structured `P27` (country of citizenship) property, matched through IMDb IDs (`P345`). If no supported citizenship value is available, the nationality field is left out rather than guessed.

The snapshot was built on 28 August 2026. The generated records use movie titles with `titleType=movie`, `isAdult=0` and a four-digit IMDb `startYear`. Roles come from IMDb's character array. `creditType` is a transparent derived field: cast ordering 1 or 2 is labelled `lead`; later cast positions are labelled `supporting`. Rebuilt records also carry an optional `recognitionTier`: `known` when the credit is in IMDb's `knownForTitles`, otherwise `standard`.

Gender is also a source-derived game clue: `actor` maps to `male` and `actress` maps to `female`. The source does not provide a reliable public self-described non-binary field, so no `other` values are inferred.

Popularity tiers are operational game buckets based on the source order after validation: the first 120 usable records are A, the next 200 are B and the remainder are C. They are difficulty knobs, not claims about an actor's cultural importance.

## Rebuilding

The large IMDb snapshots are intentionally not committed. Download them into `data/source/`, then run:

```bash
mkdir -p data/source
curl -fsSL https://datasets.imdbws.com/name.basics.tsv.gz -o data/source/name.basics.tsv.gz
curl -fsSL https://datasets.imdbws.com/title.basics.tsv.gz -o data/source/title.basics.tsv.gz
curl -fsSL https://datasets.imdbws.com/title.principals.tsv.gz -o data/source/title.principals.tsv.gz
npm run build:data
npm run enrich:data
npm run validate:data
```

The build and enrichment scripts retain IMDb IDs in `sourceId` so records can be audited without exposing any prose biography or plot text. The puzzle generator uses this structured recognition signal when present. The current checked-in catalogue predates that optional field, so legacy records use a conservative fallback: familiar franchise or mainstream title matches, plus repeated lead credits that appear across the structured cast snapshot. Deep-cut credits are excluded from new puzzles. This affects future generation only; frozen puzzle dates are never rewritten.
