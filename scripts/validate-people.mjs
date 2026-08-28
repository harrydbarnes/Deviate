import fs from "node:fs/promises";
import process from "node:process";

const PEOPLE_PATH = process.argv.find((argument) => argument.startsWith("--people="))?.split("=")[1] || "data/people.json";
const people = JSON.parse(await fs.readFile(PEOPLE_PATH, "utf8"));
const errors = [];
const warnings = [];
const currentYear = new Date().getUTCFullYear();
const ids = new Set();
const names = new Map();
const sourceIds = new Set();
const tiers = new Set();
const allYears = [];

if (!Array.isArray(people)) errors.push("Root value must be an array.");
if (people.length < 300 || people.length > 500) errors.push(`Actor count must be 300–500; found ${people.length}.`);

for (const [index, person] of people.entries()) {
  const label = `Actor ${index + 1}`;
  if (!person || typeof person !== "object") {
    errors.push(`${label} is not an object.`);
    continue;
  }
  for (const field of ["id", "name", "birthYear", "popularityTier", "filmography", "sourceId"]) {
    if (!(field in person)) errors.push(`${label} (${person.name || "unnamed"}) is missing ${field}.`);
  }
  if (ids.has(person.id)) errors.push(`Duplicate id: ${person.id}.`);
  ids.add(person.id);
  if (sourceIds.has(person.sourceId)) errors.push(`Duplicate sourceId: ${person.sourceId}.`);
  sourceIds.add(person.sourceId);
  const nameKey = normalise(person.name);
  if (!names.has(nameKey)) names.set(nameKey, []);
  names.get(nameKey).push(person);
  if (!Number.isInteger(person.birthYear) || person.birthYear < 1870 || person.birthYear > currentYear) {
    errors.push(`${person.name || label} has an invalid birthYear: ${person.birthYear}.`);
  }
  if (person.gender !== undefined && !["female", "male", "other"].includes(person.gender)) {
    errors.push(`${person.name || label} has an invalid gender: ${person.gender}.`);
  }
  if (person.nationality !== undefined && (typeof person.nationality !== "string" || !person.nationality.trim())) {
    errors.push(`${person.name || label} has an invalid nationality.`);
  }
  if (!["A", "B", "C"].includes(person.popularityTier)) {
    errors.push(`${person.name || label} has an invalid popularityTier: ${person.popularityTier}.`);
  }
  tiers.add(person.popularityTier);
  if (!Array.isArray(person.filmography) || person.filmography.length < 4) {
    errors.push(`${person.name || label} needs at least four filmography entries.`);
    continue;
  }
  const credits = new Set();
  for (const credit of person.filmography) {
    if (!credit || typeof credit !== "object") {
      errors.push(`${person.name || label} has a malformed filmography entry.`);
      continue;
    }
    if (!credit.title || typeof credit.title !== "string") errors.push(`${person.name || label} has a film credit without a title.`);
    if (!Number.isInteger(credit.releaseYear) || credit.releaseYear < 1900 || credit.releaseYear > currentYear + 1) {
      errors.push(`${person.name || label} has an invalid releaseYear: ${credit.releaseYear}.`);
    } else {
      allYears.push(credit.releaseYear);
    }
    if (!credit.role || typeof credit.role !== "string") errors.push(`${person.name || label} has a film credit without a role.`);
    if (!["lead", "supporting"].includes(credit.creditType)) errors.push(`${person.name || label} has an invalid creditType.`);
    const creditKey = `${credit.title.toLowerCase()}|${credit.releaseYear}`;
    if (credits.has(creditKey)) errors.push(`${person.name || label} repeats ${credit.title} (${credit.releaseYear}).`);
    credits.add(creditKey);
  }
}

for (const [name, matches] of names) {
  if (matches.length > 1 && !matches.every((person) => person.ambiguousName)) {
    errors.push(`Ambiguous actor name is not flagged: ${name}.`);
  }
}

const minYear = Math.min(...allYears);
const maxYear = Math.max(...allYears);
if (maxYear - minYear < 60) errors.push(`Release-year coverage is only ${maxYear - minYear} years; at least 60 are required.`);
if (minYear > 1950 || maxYear < currentYear - 10) errors.push(`Release years do not cover the required historical-to-current span (${minYear}–${maxYear}).`);
if (tiers.size !== 3) errors.push(`Expected all popularity tiers A, B and C; found ${[...tiers].sort().join(", ")}.`);

const nationalityCount = people.filter((person) => typeof person.nationality === "string" && person.nationality.trim()).length;
if (nationalityCount < people.length * 0.95) warnings.push(`Nationality coverage is ${nationalityCount}/${people.length}; unresolved records remain intentionally blank.`);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  actors: people.length,
  filmographyEntries: people.reduce((total, person) => total + person.filmography.length, 0),
  releaseYearRange: [minYear, maxYear],
  tiers: [...tiers].sort(),
  nationalityCoverage: `${nationalityCount}/${people.length}`,
  warnings,
}, null, 2));

function normalise(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
