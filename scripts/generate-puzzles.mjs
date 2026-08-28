import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PEOPLE_PATH = path.join(ROOT, "data", "people.json");
const OUTPUT_PATH = path.join(ROOT, "data", "daily.json");
const ROUND_COUNT = 5;
const GENERATOR_VERSION = "v1";

const dateFlagIndex = process.argv.indexOf("--date");
const dateArg = process.argv.find((argument) => argument.startsWith("--date="))?.split("=")[1] || (dateFlagIndex >= 0 ? process.argv[dateFlagIndex + 1] : undefined);
const date = dateArg || new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error(`Invalid date: ${date}`);
}

const people = JSON.parse(await fs.readFile(PEOPLE_PATH, "utf8"));
const existing = await readExisting();

if (existing.puzzles.some((puzzle) => puzzle.date === date)) {
  console.log(`Puzzle ${date} already frozen; nothing to change.`);
  process.exit(0);
}

const mode = hashString(`${date}:mode`) % 2 === 0 ? "year" : "age";
const puzzle = buildPuzzle(date, mode, people);
existing.puzzles.push(puzzle);
existing.puzzles.sort((a, b) => a.date.localeCompare(b.date));
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(existing, null, 2)}\n`);
console.log(`Generated and froze ${mode} puzzle ${date}.`);

async function readExisting() {
  try {
    const parsed = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
    return { schemaVersion: 1, puzzles: Array.isArray(parsed.puzzles) ? parsed.puzzles : [] };
  } catch {
    return { schemaVersion: 1, puzzles: [] };
  }
}

function buildPuzzle(puzzleDate, puzzleMode, sourcePeople) {
  const entries = sourcePeople.flatMap((person) => person.credits.map((credit, creditIndex) => ({
    id: `${person.id}:${creditIndex}`,
    personId: person.id,
    name: person.name,
    gender: person.gender,
    birthYear: person.birthYear,
    film: credit.film,
    year: credit.year,
    value: puzzleMode === "year" ? credit.year : credit.year - person.birthYear,
  }))).filter((entry) => puzzleMode === "year" ? entry.value >= 1950 : entry.value >= 12 && entry.value <= 80);

  const sorted = [...entries].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));
  const minValue = sorted[0].value;
  const maxValue = sorted[sorted.length - 1].value;
  const startAnchor = sorted.find((entry) => entry.value === minValue);
  const initialRange = { min: minValue, max: maxValue };
  const random = mulberry32(hashString(`${puzzleDate}:${puzzleMode}:${GENERATOR_VERSION}`));
  const rounds = buildChain({
    entries,
    random,
    mode: puzzleMode,
    depth: 0,
    range: initialRange,
    anchor: startAnchor,
    anchorSide: "left",
    usedPeople: new Set([startAnchor.personId]),
  });

  if (!rounds) {
    throw new Error(`Could not build a ${ROUND_COUNT}-round ${puzzleMode} puzzle for ${puzzleDate}`);
  }

  return {
    date: puzzleDate,
    mode: puzzleMode,
    generatorVersion: GENERATOR_VERSION,
    roundCount: ROUND_COUNT,
    rounds,
  };
}

function buildChain({ entries, random, mode, depth, range, anchor, anchorSide, usedPeople }) {
  const candidates = shuffle(entries.filter((entry) => {
    if (usedPeople.has(entry.personId)) return false;
    if (entry.value <= range.min || entry.value >= range.max) return false;
    const width = range.max - range.min;
    const margin = mode === "age"
      ? Math.max(0.25, Math.min(2, width * 0.04))
      : Math.max(1, Math.ceil(width * 0.08));
    return entry.value > range.min + margin && entry.value < range.max - margin;
  }), random);

  for (const target of candidates) {
    const midpoint = range.min + ((range.max - range.min) / 2);
    const targetOnLeft = target.value < midpoint;
    const nextRange = targetOnLeft ? { min: range.min, max: target.value } : { min: target.value, max: range.max };
    const nextAnchorSide = targetOnLeft ? "right" : "left";
    const round = {
      number: depth + 1,
      mode,
      range,
      anchor: fullEntry(anchor, mode),
      anchorSide,
      target: clueEntry(target),
      nextRange: depth === ROUND_COUNT - 1 ? null : nextRange,
    };

    if (depth === ROUND_COUNT - 1) return [round];

    const nextPeople = new Set(usedPeople);
    nextPeople.add(target.personId);
    const continuation = buildChain({
      entries,
      random,
      mode,
      depth: depth + 1,
      range: nextRange,
      anchor: target,
      anchorSide: nextAnchorSide,
      usedPeople: nextPeople,
    });
    if (continuation) return [round, ...continuation];
  }
  return null;
}

function fullEntry(entry, mode) {
  return {
    personId: entry.personId,
    name: entry.name,
    gender: entry.gender,
    film: entry.film,
    year: entry.year,
    value: entry.value,
    age: entry.year - entry.birthYear,
    valueLabel: mode === "year" ? String(entry.value) : `${(entry.year - entry.birthYear).toFixed(1)} yrs`,
  };
}

function clueEntry(entry) {
  return {
    personId: entry.personId,
    name: entry.name,
    gender: entry.gender,
    film: entry.film,
    year: entry.year,
    value: entry.value,
    age: entry.year - entry.birthYear,
  };
}

function shuffle(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
