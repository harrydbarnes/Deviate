import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PEOPLE_PATH = path.join(ROOT, "data", "people.json");
const OUTPUT_PATH = path.join(ROOT, "data", "daily.json");
const ROUND_COUNT = 5;
const MIDDLE_OPTION_COUNT = 4;
const MODES = ["year", "age", "middle"];
const WEEKLY_MODE_SCHEDULE = ["middle", "middle", "year", "middle", "middle", "year", "age"];
const GENERATOR_VERSION = "v5";
const RECENT_WINDOW_DAYS = 60;
const MAX_TARGET_USES_IN_WINDOW = 2;
const FAMILIAR_TITLE_PATTERNS = [
  /avengers|iron man|captain america|thor|guardians of the galaxy|black panther/i,
  /fast & furious|the fast and the furious|fast five|fast x|furious|mission: impossible|top gun|matrix|terminator|star trek|star wars|pirates of the caribbean/i,
  /harry potter|lord of the rings|hobbit|batman|dark knight|superman|spider-man|x-men|deadpool|wolverine|jurassic|jumanji|hunger games|twilight/i,
  /james bond|casino royale|skyfall|spectre|no time to die|goldeneye|die another day|quantum of solace|world is not enough/i,
  /lion king|beauty and the beast|cinderella|frozen|moana|toy story|shrek|kung fu panda|despicable me|minions|incredibles|finding nemo|ratatouille/i,
  /pulp fiction|fight club|forrest gump|shawshank|gladiator|titanic|inception|interstellar|memento|django|once upon a time|kill bill|reservoir dogs|departed|goodfellas|casino|godfather|silence of the lambs|se7en|american psycho|wolf of wall street|social network/i,
  /hangover|mean girls|bridesmaids|superbad|notebook|love actually|bridget jones|notting hill|pretty woman|la la land|greatest showman|bohemian rhapsody|rocketman|mamma mia|devil wears prada|the help|little women|star is born/i,
  /mad max|rocky|rambo|die hard|lethal weapon|predator|alien|exorcist|shining|scream|quiet place|conjuring|saw|sixth sense|green mile|saving private ryan|catch me if you can|cast away|sleepless in seattle/i,
  /speed|men in black|charlie's angels|king kong|moulin rouge|les misérables|american hustle|closer|chicago|moneyball|silver linings playbook|eternal sunshine|argo|about a boy|as good as it gets|romeo \+ juliet/i,
];

const dateFlagIndex = process.argv.indexOf("--date");
const dateArg = process.argv.find((argument) => argument.startsWith("--date="))?.split("=")[1] || (dateFlagIndex >= 0 ? process.argv[dateFlagIndex + 1] : undefined);
const requestedMode = process.argv.find((argument) => argument.startsWith("--mode="))?.split("=")[1];
const date = dateArg || new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error(`Invalid date: ${date}`);
}

if (requestedMode && !MODES.includes(requestedMode)) {
  throw new Error(`Invalid mode: ${requestedMode}. Expected ${MODES.join(", ")}.`);
}

const people = JSON.parse(await fs.readFile(PEOPLE_PATH, "utf8"));
const existing = await readExisting();

if (existing.puzzles.some((puzzle) => puzzle.date === date)) {
  console.log(`Puzzle ${date} already frozen; nothing to change.`);
  process.exit(0);
}

const mode = requestedMode || scheduledMode(date);
const recentUsage = getRecentUsage(existing.puzzles, date);
const puzzle = buildPuzzle(date, mode, people, recentUsage);
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

function buildPuzzle(puzzleDate, puzzleMode, sourcePeople, recentUsage) {
  const entries = sourcePeople.flatMap((person) => person.filmography.map((credit, creditIndex) => ({
    id: `${person.id}:${creditIndex}`,
    personId: person.id,
    name: person.name,
    gender: person.gender,
    birthYear: person.birthYear,
    nationality: person.nationality,
    popularityTier: person.popularityTier,
    sourceRank: person.sourceRank,
    recognitionTier: getRecognitionTier(credit),
    film: credit.title,
    year: credit.releaseYear,
    role: credit.role,
    creditType: credit.creditType,
    value: puzzleMode === "age" ? credit.releaseYear - person.birthYear : credit.releaseYear,
  }))).filter((entry) => {
    if (puzzleMode === "age") return entry.value >= 12 && entry.value <= 80;
    return entry.value >= 1950;
  });
  const titleCounts = new Map();
  for (const entry of entries) {
    const key = normaliseTitle(entry.film);
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  for (const entry of entries) {
    entry.titleFrequency = titleCounts.get(normaliseTitle(entry.film)) || 1;
  }

  const targetEntries = entries.filter(isCasualTarget);
  if (targetEntries.length < 100) {
    throw new Error(`Only ${targetEntries.length} casual target credits are available for ${puzzleMode}.`);
  }

  const sorted = [...targetEntries].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));
  const startAnchor = sorted[0];
  const initialRange = { min: sorted[0].value, max: sorted.at(-1).value };
  const random = mulberry32(hashString(`${puzzleDate}:${puzzleMode}:${GENERATOR_VERSION}`));
  const searchState = { nodes: 0, maxNodes: 500000 };
  const rounds = buildChain({
    entries: targetEntries,
    random,
    searchState,
    puzzleDate,
    recentUsage,
    mode: puzzleMode,
    depth: 0,
    range: initialRange,
    anchor: startAnchor,
    anchorSide: "left",
    usedPeople: new Set([startAnchor.personId]),
  });

  if (!rounds) {
    throw new Error(`Could not build a ${ROUND_COUNT}-round ${puzzleMode} puzzle for ${puzzleDate} after ${searchState.nodes} search nodes`);
  }

  return {
    date: puzzleDate,
    mode: puzzleMode,
    generatorVersion: GENERATOR_VERSION,
    roundCount: ROUND_COUNT,
    rounds,
  };
}

function buildChain({ entries, random, searchState, puzzleDate, recentUsage, mode, depth, range, anchor, anchorSide, usedPeople }) {
  if (searchState.nodes >= searchState.maxNodes) return null;
  searchState.nodes += 1;

  const midpoint = midpointOf(range);
  const remainingRounds = ROUND_COUNT - depth - 1;
  const minimumNextWidth = minimumWidthForRounds(remainingRounds);
  const candidates = getChainCandidates({ entries, range, mode, usedPeople, minimumNextWidth, recentUsage });

  if (mode === "middle") {
    const middleChoices = chooseMiddleTargets({
      candidates,
      entries,
      range,
      midpoint,
      mode,
      random,
      recentUsage,
      usedPeople,
    });
    for (const middleChoice of middleChoices) {
      const target = middleChoice.target;
      const nextRange = target.value < midpoint ? { min: range.min, max: target.value } : { min: target.value, max: range.max };
      const nextAnchorSide = target.value < midpoint ? "right" : "left";
      const round = {
        number: depth + 1,
        mode,
        range,
        anchor: fullEntry(anchor, mode),
        anchorSide,
        target: { ...clueEntry(target), optionId: target.id },
        options: middleChoice.options,
        nextRange: depth === ROUND_COUNT - 1 ? null : nextRange,
      };

      if (depth === ROUND_COUNT - 1) return [round];

      const nextPeople = new Set(usedPeople);
      nextPeople.add(target.personId);
      const continuation = buildChain({
        entries,
        random,
        searchState,
        puzzleDate,
        recentUsage,
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

  const preferredPosition = preferredPositionFor(puzzleDate, mode, depth);
  const orderedCandidates = [...candidates]
    .sort((left, right) => positionScore(left, range, preferredPosition) - positionScore(right, range, preferredPosition));

  for (const target of orderedCandidates) {
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
      searchState,
      puzzleDate,
      recentUsage,
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

function getChainCandidates({ entries, range, mode, usedPeople, minimumNextWidth, recentUsage }) {
  const midpoint = midpointOf(range);
  const width = range.max - range.min;
  const margin = mode === "age"
    ? Math.max(0.25, Math.min(2, width * 0.04))
    : Math.max(0.5, width * 0.08);
  const available = entries.filter((entry) => {
    if (usedPeople.has(entry.personId)) return false;
    if (entry.value <= range.min || entry.value >= range.max) return false;
    const targetOnLeft = entry.value < midpoint;
    const nextWidth = targetOnLeft ? entry.value - range.min : range.max - entry.value;
    return entry.value > range.min + margin
      && entry.value < range.max - margin
      && nextWidth >= minimumNextWidth;
  });

  const fresh = available.filter((entry) => !recentUsage.clueKeys.has(clueKey(entry)) && (recentUsage.actorCounts.get(entry.personId) || 0) < MAX_TARGET_USES_IN_WINDOW);
  if (fresh.length) return fresh;
  return [];
}

function chooseMiddleTargets({ candidates, entries, range, midpoint, mode, random, recentUsage, usedPeople }) {
  const ordered = shuffle(candidates, random).sort((left, right) => Math.abs(left.value - midpoint) - Math.abs(right.value - midpoint));
  const choices = [];
  for (const target of ordered) {
    const options = buildMiddleOptions({ target, entries, range, midpoint, mode, random, recentUsage, usedPeople });
    if (options) choices.push({ target, options });
    if (choices.length >= 80) break;
  }
  return choices;
}

function buildMiddleOptions({ target, entries, range, midpoint, mode, random, recentUsage, usedPeople }) {
  const width = range.max - range.min;
  const targetDistance = Math.abs(target.value - midpoint);
  const candidates = entries.filter((entry) => {
    if (!isCasualTarget(entry)) return false;
    if (entry.id === target.id || usedPeople.has(entry.personId)) return false;
    if (entry.value <= range.min || entry.value >= range.max) return false;
    return true;
  });
  const freshOptions = candidates.filter((entry) => !recentUsage.clueKeys.has(clueKey(entry)));
  const pool = freshOptions.length >= MIDDLE_OPTION_COUNT - 1 ? freshOptions : candidates;
  const gap = mode === "age" ? Math.max(0.5, width * 0.03) : Math.max(1, width * 0.03);
  const withGap = pool.filter((entry) => Math.abs(entry.value - midpoint) > targetDistance + gap);
  const farther = withGap.length >= MIDDLE_OPTION_COUNT - 1
    ? withGap
    : pool.filter((entry) => Math.abs(entry.value - midpoint) > targetDistance + 0.01);
  if (farther.length < MIDDLE_OPTION_COUNT - 1) return null;

  const shuffled = shuffle(farther, random);
  const left = shuffled.find((entry) => entry.value < midpoint);
  const right = shuffled.find((entry) => entry.value > midpoint);
  const selected = [];
  if (left) selected.push(left);
  if (right && !selected.some((entry) => entry.personId === right.personId)) selected.push(right);
  for (const entry of shuffled) {
    if (selected.length >= MIDDLE_OPTION_COUNT - 1) break;
    if (!selected.some((chosen) => chosen.personId === entry.personId)) selected.push(entry);
  }
  if (selected.length < MIDDLE_OPTION_COUNT - 1) return null;

  return shuffle([target, ...selected.slice(0, MIDDLE_OPTION_COUNT - 1)], random)
    .map((entry) => ({ ...clueEntry(entry), optionId: entry.id }));
}

function minimumWidthForRounds(rounds) {
  return rounds === 0 ? 0 : 3 * (2 ** (rounds - 1));
}

function preferredPositionFor(dateValue, mode, depth) {
  const seed = hashString(`${dateValue}:${mode}:position:${depth}`);
  const distance = 0.22 + ((seed % 12) / 100);
  return seed % 2 === 0 ? 0.5 - distance : 0.5 + distance;
}

function scheduledMode(dateValue) {
  const day = new Date(`${dateValue}T00:00:00Z`).getUTCDay();
  return WEEKLY_MODE_SCHEDULE[day];
}

function positionScore(entry, range, preferredPosition) {
  const position = (entry.value - range.min) / (range.max - range.min);
  const centrePenalty = Math.abs(position - 0.5) < 0.08 ? 0.25 : 0;
  return Math.abs(position - preferredPosition) + centrePenalty;
}

function isCasualTarget(entry) {
  if (!entry || !["A", "B"].includes(entry.popularityTier)) return false;
  if (entry.recognitionTier === "deep-cut") return false;
  if (["popular", "known"].includes(entry.recognitionTier)) return true;
  if (titleLooksFamiliar(entry.film)) return true;
  return entry.creditType === "lead" && entry.titleFrequency >= 2;
}

function titleLooksFamiliar(title) {
  return FAMILIAR_TITLE_PATTERNS.some((pattern) => pattern.test(title || ""));
}

function normaliseTitle(title) {
  return String(title || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function getRecognitionTier(credit) {
  if (["popular", "known", "standard", "deep-cut"].includes(credit.recognitionTier)) return credit.recognitionTier;
  if (credit.knownFor === true) return "known";
  return "standard";
}

function getRecentUsage(puzzles, puzzleDate) {
  const clueKeys = new Set();
  const actorCounts = new Map();
  for (const puzzle of puzzles) {
    const age = dayDifference(puzzle.date, puzzleDate);
    if (!Number.isFinite(age) || age < 1 || age > RECENT_WINDOW_DAYS) continue;
    for (const round of puzzle.rounds || []) {
      const target = round.target;
      if (!target?.personId || !target.film || !Number.isFinite(target.year)) continue;
      clueKeys.add(clueKey(target));
      actorCounts.set(target.personId, (actorCounts.get(target.personId) || 0) + 1);
    }
  }
  return { clueKeys, actorCounts };
}

function clueKey(entry) {
  return `${entry.personId}|${String(entry.film || entry.title).trim().toLowerCase()}|${entry.year}`;
}

function dayDifference(from, to) {
  const first = Date.parse(`${from}T00:00:00Z`);
  const second = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return NaN;
  return Math.round((second - first) / 86400000);
}

function fullEntry(entry, mode) {
  return {
    personId: entry.personId,
    name: entry.name,
    gender: entry.gender,
    nationality: entry.nationality,
    popularityTier: entry.popularityTier,
    film: entry.film,
    year: entry.year,
    role: entry.role,
    creditType: entry.creditType,
    value: entry.value,
    age: entry.year - entry.birthYear,
    valueLabel: mode === "age" ? `${(entry.year - entry.birthYear).toFixed(1)} yrs` : String(entry.value),
  };
}

function clueEntry(entry) {
  return {
    personId: entry.personId,
    name: entry.name,
    gender: entry.gender,
    nationality: entry.nationality,
    popularityTier: entry.popularityTier,
    film: entry.film,
    role: entry.role,
    creditType: entry.creditType,
    year: entry.year,
    value: entry.value,
    age: entry.year - entry.birthYear,
  };
}

function midpointOf(range) {
  return range.min + ((range.max - range.min) / 2);
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
