import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import zlib from "node:zlib";

const ROOT = process.cwd();
const DEFAULTS = {
  actors: path.join(ROOT, "data", "actor-index.json"),
  names: path.join(ROOT, "data", "source", "name.basics.tsv.gz"),
  titles: path.join(ROOT, "data", "source", "title.basics.tsv.gz"),
  principals: path.join(ROOT, "data", "source", "title.principals.tsv.gz"),
  overrides: path.join(ROOT, "data", "people-overrides.json"),
  output: path.join(ROOT, "data", "people.json"),
};
const MAX_ACTORS = 500;
const MIN_RELEASE_YEAR = 1900;
const MAX_RELEASE_YEAR = new Date().getUTCFullYear() + 1;

const options = parseOptions(process.argv.slice(2));
const actorIndex = JSON.parse(await fs.readFile(options.actors, "utf8"));
const overrides = await readJsonIfPresent(options.overrides, {});

if (!Array.isArray(actorIndex) || actorIndex.length === 0) {
  throw new Error(`Expected a non-empty actor index at ${options.actors}`);
}

const candidates = actorIndex
  .map((candidate, index) => ({
    name: String(candidate.name || "").trim(),
    rating: Number(candidate.rating) || 0,
    sourceRank: index + 1,
  }))
  .filter((candidate) => candidate.name);
const candidateKeys = new Map();
for (const candidate of candidates) {
  const key = nameKey(candidate.name);
  if (!candidateKeys.has(key)) candidateKeys.set(key, []);
  candidateKeys.get(key).push(candidate);
}

const nameMatches = new Map();
let nameRows = 0;
for await (const fields of tsvRows(options.names)) {
  if (fields.header) continue;
  nameRows += 1;
  const name = fields.values[1];
  const matches = candidateKeys.get(nameKey(name));
  if (!matches) continue;

  const birthYear = parseYear(fields.values[2]);
  const professions = splitList(fields.values[4]);
  const isActor = professions.includes("actor") || professions.includes("actress");
  if (!isActor || !birthYear) continue;

  const match = {
    nconst: fields.values[0],
    name,
    birthYear,
    professions,
    knownForTitles: new Set(splitList(fields.values[5])),
  };
  const key = nameKey(name);
  if (!nameMatches.has(key)) nameMatches.set(key, []);
  nameMatches.get(key).push(match);
}

const matchedPeople = [...nameMatches.values()].flat();
const selectedIds = new Set(matchedPeople.map((person) => person.nconst));
const creditsByPerson = new Map(matchedPeople.map((person) => [person.nconst, []]));
const neededTitles = new Set();
let principalRows = 0;

for await (const fields of tsvRows(options.principals)) {
  if (fields.header) continue;
  principalRows += 1;
  const [tconst, orderingText, nconst, category, , characters] = fields.values;
  if (!selectedIds.has(nconst) || !["actor", "actress"].includes(category)) continue;
  const role = parseRole(characters);
  if (!role) continue;
  const ordering = Number(orderingText);
  if (!Number.isInteger(ordering)) continue;
  creditsByPerson.get(nconst).push({ tconst, ordering, role });
  neededTitles.add(tconst);
}

const titleById = new Map();
let titleRows = 0;
for await (const fields of tsvRows(options.titles)) {
  if (fields.header) continue;
  titleRows += 1;
  const [tconst, titleType, primaryTitle, , isAdult, startYear] = fields.values;
  if (!neededTitles.has(tconst) || titleType !== "movie" || isAdult !== "0") continue;
  const releaseYear = parseYear(startYear);
  if (!releaseYear || releaseYear < MIN_RELEASE_YEAR || releaseYear > MAX_RELEASE_YEAR) continue;
  titleById.set(tconst, { title: primaryTitle, releaseYear });
}

const available = [];
for (const candidate of candidates) {
  const matches = nameMatches.get(nameKey(candidate.name)) || [];
  const rankedMatches = matches
    .map((person) => ({
      ...person,
      filmography: selectFilmography(person, creditsByPerson.get(person.nconst) || [], titleById),
    }))
    .filter((person) => person.filmography.length >= 4)
    .sort((a, b) => b.filmography.length - a.filmography.length || a.nconst.localeCompare(b.nconst));
  const person = rankedMatches[0];
  if (!person) continue;
  available.push({
    ...candidate,
    ...person,
    ambiguousName: rankedMatches.length > 1,
    candidateMatches: rankedMatches.length,
  });
}

const selected = available.slice(0, MAX_ACTORS);
if (selected.length < 300) {
  throw new Error(`Only ${selected.length} usable actors were built; at least 300 are required.`);
}

const usedIds = new Set();
const people = selected.map((person, index) => {
  const baseId = slugify(person.name);
  const id = uniqueId(baseId, person.birthYear, person.nconst, usedIds);
  const gender = inferGender(person.professions);
  const override = overrides[person.nconst] || overrides[nameKey(person.name)] || {};
  const record = {
    id,
    name: person.name,
    ...(gender ? { gender } : {}),
    birthYear: person.birthYear,
    ...(override.nationality ? { nationality: override.nationality } : {}),
    popularityTier: index < 120 ? "A" : index < 320 ? "B" : "C",
    filmography: person.filmography,
    sourceId: person.nconst,
    sourceRank: person.sourceRank,
  };
  if (person.ambiguousName) record.ambiguousName = true;
  return record;
});

await fs.mkdir(path.dirname(options.output), { recursive: true });
await fs.writeFile(options.output, `${JSON.stringify(people, null, 2)}\n`);

console.log(JSON.stringify({
  output: options.output,
  actors: people.length,
  genderCoverage: people.filter((person) => person.gender).length,
  nationalityCoverage: people.filter((person) => person.nationality).length,
  filmographyEntries: people.reduce((total, person) => total + person.filmography.length, 0),
  releaseYearRange: [
    Math.min(...people.flatMap((person) => person.filmography.map((credit) => credit.releaseYear))),
    Math.max(...people.flatMap((person) => person.filmography.map((credit) => credit.releaseYear))),
  ],
  sourceRows: { names: nameRows, principals: principalRows, titles: titleRows },
}, null, 2));

function parseOptions(argumentsList) {
  const parsed = { ...DEFAULTS };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) continue;
    const [rawKey, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argumentsList[index + 1];
    if (inlineValue === undefined) index += 1;
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in parsed) || !value) throw new Error(`Unknown or missing option: ${argument}`);
    parsed[key] = value;
  }
  return parsed;
}

async function readJsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function* tsvRows(filePath) {
  if (!fsSync.existsSync(filePath)) throw new Error(`Missing source snapshot: ${filePath}`);
  const input = fsSync.createReadStream(filePath);
  const decompressed = filePath.endsWith(".gz") ? input.pipe(zlib.createGunzip()) : input;
  const lines = readline.createInterface({ input: decompressed, crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      yield { header: true, values: line.split("\t") };
      continue;
    }
    yield { header: false, values: line.split("\t") };
  }
}

function selectFilmography(person, rows, titles) {
  const deduped = new Map();
  for (const row of rows) {
    const title = titles.get(row.tconst);
    if (!title) continue;
    const key = `${row.tconst}:${title.releaseYear}`;
    if (!deduped.has(key)) deduped.set(key, {
      title: title.title,
      releaseYear: title.releaseYear,
      role: row.role,
      creditType: row.ordering <= 2 ? "lead" : "supporting",
      knownFor: person.knownForTitles.has(row.tconst),
      ordering: row.ordering,
    });
  }
  const entries = [...deduped.values()]
    .sort((a, b) => Number(b.knownFor) - Number(a.knownFor) || a.releaseYear - b.releaseYear || a.ordering - b.ordering || a.title.localeCompare(b.title));
  const chosen = spreadSelect(entries, 8);
  return chosen
    .sort((a, b) => a.releaseYear - b.releaseYear || a.title.localeCompare(b.title))
    .map(({ title, releaseYear, role, creditType, knownFor }) => ({
      title,
      releaseYear,
      role,
      creditType,
      recognitionTier: knownFor ? "known" : "standard",
    }));
}

function spreadSelect(entries, limit) {
  if (entries.length <= limit) return entries;
  const known = entries.filter((entry) => entry.knownFor).slice(0, Math.min(4, limit));
  const remaining = entries.filter((entry) => !known.includes(entry));
  const chosen = [...known];
  const step = remaining.length / Math.max(1, limit - chosen.length);
  for (let index = 0; chosen.length < limit && index < remaining.length; index += Math.max(1, step)) {
    const entry = remaining[Math.floor(index)];
    if (entry && !chosen.includes(entry)) chosen.push(entry);
  }
  return chosen.slice(0, limit);
}

function parseRole(value) {
  if (!value || value === "\\N") return null;
  try {
    const roles = JSON.parse(value);
    if (!Array.isArray(roles)) return null;
    return roles.find((role) => typeof role === "string" && role.trim())?.trim() || null;
  } catch {
    return null;
  }
}

function inferGender(professions) {
  const hasActor = professions.includes("actor");
  const hasActress = professions.includes("actress");
  if (hasActress && !hasActor) return "female";
  if (hasActor && !hasActress) return "male";
  return undefined;
}

function parseYear(value) {
  return /^\d{4}$/.test(value || "") ? Number(value) : null;
}

function splitList(value) {
  return value && value !== "\\N" ? value.split(",").filter(Boolean) : [];
}

function nameKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function slugify(value) {
  return nameKey(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "actor";
}

function uniqueId(baseId, birthYear, sourceId, used) {
  const options = [baseId, `${baseId}-${birthYear}`, `${baseId}-${sourceId.toLowerCase()}`];
  const availableId = options.find((option) => !used.has(option));
  const id = availableId || `${baseId}-${sourceId.toLowerCase()}`;
  used.add(id);
  return id;
}
