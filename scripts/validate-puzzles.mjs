import fs from "node:fs/promises";

const dailyPath = process.argv.find((argument) => argument.startsWith("--daily="))?.split("=")[1] || "data/daily.json";
const payload = JSON.parse(await fs.readFile(dailyPath, "utf8"));
const puzzles = payload?.puzzles;
const errors = [];
const dates = new Set();
const allowedModes = new Set(["year", "age", "middle"]);

if (!Array.isArray(puzzles)) {
  errors.push("Root value must contain a puzzles array.");
} else {
  for (const [puzzleIndex, puzzle] of puzzles.entries()) {
    const label = `Puzzle ${puzzleIndex + 1}`;
    if (!puzzle || typeof puzzle !== "object") {
      errors.push(`${label} is not an object.`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzle.date || "")) errors.push(`${label} has an invalid date.`);
    if (dates.has(puzzle.date)) errors.push(`Duplicate puzzle date: ${puzzle.date}.`);
    dates.add(puzzle.date);
    if (!allowedModes.has(puzzle.mode)) errors.push(`${label} has an invalid mode: ${puzzle.mode}.`);
    if (!Array.isArray(puzzle.rounds) || puzzle.rounds.length !== puzzle.roundCount) {
      errors.push(`${label} does not contain the declared round count.`);
      continue;
    }

    for (const [roundIndex, round] of puzzle.rounds.entries()) {
      const roundLabel = `${label}, round ${roundIndex + 1}`;
      if (!round || typeof round !== "object") {
        errors.push(`${roundLabel} is not an object.`);
        continue;
      }
      const min = Number(round.range?.min);
      const max = Number(round.range?.max);
      const value = Number(round.target?.value);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) errors.push(`${roundLabel} has an invalid range.`);
      if (!Number.isFinite(value) || value <= min || value >= max) errors.push(`${roundLabel} target is outside its range.`);
      if (roundIndex < puzzle.rounds.length - 1 && !round.nextRange) errors.push(`${roundLabel} is missing its next range.`);
      if (roundIndex === puzzle.rounds.length - 1 && round.nextRange) errors.push(`${roundLabel} should not have a next range.`);

      if (puzzle.mode === "middle") validateMiddleRound(round, roundLabel, errors);
      else if (round.options) errors.push(`${roundLabel} has middle-mode options in a value mode.`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({ puzzles: puzzles.length, dates: [...dates], errors: [] }, null, 2));

function validateMiddleRound(round, label, problemList) {
  if (!Array.isArray(round.options) || round.options.length !== 4) {
    problemList.push(`${label} must contain exactly four middle-mode options.`);
    return;
  }
  const optionIds = new Set();
  const midpoint = (Number(round.range.min) + Number(round.range.max)) / 2;
  const targetDistance = Math.abs(Number(round.target.value) - midpoint);
  let targetOptionCount = 0;
  for (const option of round.options) {
    if (!option?.optionId) problemList.push(`${label} has an option without an optionId.`);
    if (optionIds.has(option?.optionId)) problemList.push(`${label} repeats an optionId.`);
    optionIds.add(option?.optionId);
    if (option.optionId === round.target.optionId || Number(option.value) === Number(round.target.value)) targetOptionCount += 1;
    if (Math.abs(Number(option.value) - midpoint) < targetDistance) problemList.push(`${label} has an option closer to the midpoint than the answer.`);
  }
  if (targetOptionCount !== 1) problemList.push(`${label} does not identify exactly one closest option.`);
}
