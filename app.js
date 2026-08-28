const DATA_URL = "./data/daily.json";
const PROGRESS_KEY = "deviate-progress-v1";
const THEME_KEY = "deviate-theme-v1";
const ROUND_COUNT = 5;

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const helpDialog = document.querySelector("#help-dialog");

const state = {
  puzzles: [],
  puzzle: null,
  route: getRoute(),
  screen: "intro",
  roundIndex: 0,
  guess: null,
  results: [],
  toastTimer: null,
};

let progress = readProgress();

init();

async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  bindGlobalEvents();

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Puzzle data returned ${response.status}`);
    const payload = await response.json();
    state.puzzles = Array.isArray(payload.puzzles) ? payload.puzzles : [];
    if (!state.puzzles.length) throw new Error("No frozen puzzles found");
    renderRoute();
  } catch (error) {
    console.error(error);
    app.innerHTML = `
      <section class="error-state">
        <p class="eyebrow">The line is resting</p>
        <h1>Today's puzzle could not load.</h1>
        <p class="subheading">Check your connection and try refreshing the page.</p>
      </section>`;
  }
}

function bindGlobalEvents() {
  window.addEventListener("hashchange", () => {
    state.route = getRoute();
    if (state.route === "daily") {
      state.puzzle = getDailyPuzzle();
      restorePuzzleState(state.puzzle);
    }
    renderRoute();
  });

  document.querySelector("#theme-button").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  document.querySelector("#help-button").addEventListener("click", () => {
    if (typeof helpDialog.showModal === "function") helpDialog.showModal();
    else helpDialog.setAttribute("open", "");
  });
  document.querySelector("#close-help").addEventListener("click", closeHelp);
  document.querySelector("#understand-button").addEventListener("click", closeHelp);
  helpDialog.addEventListener("click", (event) => {
    if (event.target === helpDialog) closeHelp();
  });
  document.querySelector("#share-button").addEventListener("click", () => shareCurrentResult());
}

function closeHelp() {
  if (typeof helpDialog.close === "function") helpDialog.close();
  else helpDialog.removeAttribute("open");
}

function getRoute() {
  const route = window.location.hash.replace("#", "");
  return ["archive", "stats"].includes(route) ? route : "daily";
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDailyPuzzle() {
  const today = getTodayKey();
  return state.puzzles.find((puzzle) => puzzle.date === today) || state.puzzles[state.puzzles.length - 1];
}

function getPuzzle(date) {
  return state.puzzles.find((puzzle) => puzzle.date === date) || null;
}

function renderRoute() {
  if (state.route === "archive") return renderArchive();
  if (state.route === "stats") return renderStats();
  state.puzzle = state.puzzle || getDailyPuzzle();
  restorePuzzleState(state.puzzle);
  renderGame();
}

function restorePuzzleState(puzzle) {
  if (!puzzle) return;
  const completed = progress.completed?.[puzzle.date];
  const inProgress = progress.inProgress?.[puzzle.date];

  if (completed) {
    state.screen = "complete";
    state.roundIndex = puzzle.rounds.length - 1;
    state.results = completed.results || [];
    state.guess = null;
    return;
  }

  if (inProgress) {
    state.screen = "playing";
    state.roundIndex = Math.min(inProgress.roundIndex || 0, puzzle.rounds.length - 1);
    state.results = Array.isArray(inProgress.results) ? inProgress.results : [];
    state.guess = null;
    return;
  }

  state.screen = "intro";
  state.roundIndex = 0;
  state.results = [];
  state.guess = null;
}

function startPuzzle(puzzle) {
  state.puzzle = puzzle;
  restorePuzzleState(puzzle);
  if (state.screen === "complete") return renderSummary();
  state.screen = "playing";
  state.roundIndex = state.results.length;
  state.guess = null;
  saveInProgress();
  renderGame();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderGame() {
  if (!state.puzzle) return;
  if (state.screen === "complete") return renderSummary();
  if (state.screen === "intro") return renderIntro();

  const puzzle = state.puzzle;
  const round = puzzle.rounds[state.roundIndex];
  const progressPercent = ((state.roundIndex + (state.screen === "revealed" ? 1 : 0)) / puzzle.rounds.length) * 100;
  const guess = state.guess ?? midpoint(round.range.min, round.range.max);
  const guessPercent = toPercent(guess, round.range.min, round.range.max);
  const truthPercent = toPercent(round.target.value, round.range.min, round.range.max);
  const contract = getContractStyle(round);

  app.innerHTML = `
    <section class="game-shell" aria-labelledby="game-heading">
      <div class="game-topline">
        <span class="round-count"><strong>Daily line</strong> · ${formatDate(puzzle.date, { day: "numeric", month: "long" })}</span>
        <span class="round-count">Round <strong>${state.roundIndex + 1}</strong> of <strong>${puzzle.rounds.length}</strong></span>
      </div>
      <div class="progress-track" aria-hidden="true" style="--progress:${progressPercent}%"><span></span></div>

      <div class="game-prompt">
        <div>
          <p class="eyebrow">Place the hidden value</p>
          <h1 id="game-heading">Where does this ${round.mode === "year" ? "release year" : "age at release"} belong?</h1>
        </div>
        <span class="mode-pill">${round.mode === "year" ? "Release year" : "Age at release"}</span>
      </div>

      <div class="anchor-grid">
        ${renderAnchor(round.anchor, round.mode, "Known anchor", round.anchorSide === "left" || round.anchorSide === "left edge" ? "Left edge" : "Right edge")}
        ${renderMystery(round.target, round.mode, state.screen === "revealed")}
      </div>

      <div class="timeline-panel">
        <div class="timeline-header">
          <p>${state.screen === "revealed" ? (round.nextRange ? "The warm line shows the narrower range for the next round." : "The final answer is now locked in.") : "Drag the marker, or tap anywhere on the line."}</p>
          <span class="guess-readout" id="guess-readout">${formatValue(guess, round.mode)}</span>
        </div>
        <div class="timeline ${state.screen === "revealed" ? "is-revealed" : ""}" style="--guess:${guessPercent}%;--truth:${truthPercent}%;--contract-start:${contract.start}%;--contract-width:${contract.width}%">
          <div class="timeline-ticks" aria-hidden="true">
            <span>${formatValue(round.range.min, round.mode)}</span>
            <span>${formatValue(midpoint(round.range.min, round.range.max), round.mode)}</span>
            <span>${formatValue(round.range.max, round.mode)}</span>
          </div>
          <div class="timeline-axis" aria-hidden="true"></div>
          <div class="range-window" aria-hidden="true"></div>
          <div class="marker guess-marker" style="left:${guessPercent}%" aria-hidden="true"></div>
          <div class="marker truth-marker" style="left:${truthPercent}%" aria-hidden="true"></div>
          <span class="marker-label guess-label" style="--guess:${guessPercent}%">${state.screen === "revealed" ? "Your guess" : "Your marker"}</span>
          <span class="marker-label truth-label" style="--truth:${truthPercent}%">Answer</span>
          <input class="timeline-input" id="timeline-input" type="range" min="${round.range.min}" max="${round.range.max}" step="0.1" value="${guess}" aria-label="Place your guess on the timeline" ${state.screen === "revealed" ? "disabled" : ""} />
        </div>
        <div class="timeline-footer">
          <p class="scale-note">${state.screen === "revealed" ? `Answer: ${formatValue(round.target.value, round.mode)}` : "The exact value can sit anywhere between the anchors."}</p>
          ${state.screen === "revealed" ? `<button class="button button-primary" id="continue-button" type="button">${state.roundIndex === puzzle.rounds.length - 1 ? "See your summary" : "Continue to next line"}</button>` : `<button class="button button-primary" id="lock-button" type="button">Lock in guess</button>`}
        </div>
        ${state.screen === "revealed" ? renderRevealNote(round, state.results[state.results.length - 1]) : ""}
      </div>
    </section>`;

  if (state.screen !== "revealed") {
    const input = document.querySelector("#timeline-input");
    input.addEventListener("input", (event) => {
      state.guess = Number(event.target.value);
      updateGuessReadout(round);
    });
    input.addEventListener("change", (event) => {
      state.guess = Number(event.target.value);
      updateGuessReadout(round);
    });
    document.querySelector("#lock-button").addEventListener("click", lockGuess);
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  } else {
    document.querySelector("#continue-button").addEventListener("click", continueAfterReveal);
  }
}

function renderIntro() {
  const puzzle = state.puzzle;
  const record = progress.completed?.[puzzle.date];
  const inProgress = progress.inProgress?.[puzzle.date];
  const isFallback = puzzle.date !== getTodayKey();
  app.innerHTML = `
    <section class="intro-layout" aria-labelledby="intro-heading">
      <div class="intro-copy">
        <p class="eyebrow">${isFallback ? "Latest frozen line" : "Today's puzzle"}</p>
        <h1 id="intro-heading">Find your place in time.</h1>
        <p class="lede">A calm, five-round guessing game about actors, films and the space between two known points.</p>
        <div class="intro-meta" aria-label="Puzzle details">
          <span>${formatDate(puzzle.date, { weekday: "long", day: "numeric", month: "long" })}</span>
          <span>${puzzle.mode === "year" ? "Release year" : "Age at release"}</span>
          <span>${puzzle.rounds.length} rounds</span>
        </div>
        <div class="button-row">
          <button class="button button-primary" id="start-button" type="button">${record ? "View completed line" : inProgress ? "Resume today's line" : "Start today's line"}</button>
          <a class="button button-quiet" href="#archive">Browse archive</a>
        </div>
      </div>
      <div class="intro-aside" aria-label="How Deviate works">
        <div class="promise-card">
          <p class="card-kicker">The small promise</p>
          <h2>Every answer leaves a narrower line.</h2>
          <p>lower score = closer guess</p>
        </div>
        <div class="tip-card"><strong>One puzzle.</strong> Frozen forever once it goes live. Your record never leaves this browser.</div>
      </div>
    </section>`;
  document.querySelector("#start-button").addEventListener("click", () => {
    if (record) return renderSummary();
    startPuzzle(puzzle);
  });
}

function renderAnchor(anchor, mode, label, side) {
  return `
    <article class="anchor-card">
      <div class="anchor-topline"><span>${label}</span><span class="anchor-side">${side}</span></div>
      <p class="anchor-name">${escapeHtml(anchor.name)}</p>
      <p class="anchor-credit"><em>${escapeHtml(anchor.film)}</em> · ${anchor.year}</p>
      <p class="anchor-credit">${formatValue(anchor.value, mode)} · ${formatGender(anchor.gender)}</p>
    </article>`;
}

function renderMystery(target, mode, revealed) {
  return `
    <article class="anchor-card mystery ${revealed ? "revealed" : ""}">
      <div class="anchor-topline"><span>${revealed ? "Revealed" : "Mystery anchor"}</span><span class="anchor-side">Right edge</span></div>
      ${revealed ? `
        <p class="anchor-name">${escapeHtml(target.name)}</p>
        <p class="anchor-credit"><em>${escapeHtml(target.film)}</em> · ${target.year}</p>
        <p class="anchor-credit">${formatValue(target.value, mode)} · ${formatGender(target.gender)}</p>` : `
        <div class="anchor-clue">
          <p class="clue-label">The clue</p>
          <p class="clue-value">${formatGender(target.gender)}</p>
          <p class="clue-detail">One credit: <em>${escapeHtml(target.film)}</em></p>
        </div>`}
    </article>`;
}

function renderRevealNote(round, result) {
  if (!result) return "";
  const glyph = result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶";
  const relative = result.direction === "bullseye" ? "inside the bullseye" : result.direction === "left" ? "to the left of the answer" : "to the right of the answer";
  const nextRange = round.nextRange ? `${formatValue(round.nextRange.min, round.mode)} to ${formatValue(round.nextRange.max, round.mode)}` : "the line is complete";
  return `
    <div class="reveal-note" aria-live="polite">
      <span class="result-glyph" aria-hidden="true">${glyph}</span>
      <div>
        <p>Your marker landed <strong>${formatDistance(result.distance, round.mode)}</strong> ${relative}.</p>
        <p class="answer-detail">${escapeHtml(round.target.name)} · ${escapeHtml(round.target.film)} · ${formatValue(round.target.value, round.mode)} · Next range: ${nextRange}</p>
      </div>
    </div>`;
}

function updateGuessReadout(round) {
  const readout = document.querySelector("#guess-readout");
  const marker = document.querySelector(".guess-marker");
  const label = document.querySelector(".guess-label");
  if (!readout || !marker || !label) return;
  const value = state.guess ?? midpoint(round.range.min, round.range.max);
  const percent = toPercent(value, round.range.min, round.range.max);
  readout.textContent = formatValue(value, round.mode);
  marker.style.left = `${percent}%`;
  label.style.setProperty("--guess", `${percent}%`);
}

function lockGuess() {
  const puzzle = state.puzzle;
  const round = puzzle.rounds[state.roundIndex];
  const guess = clamp(state.guess ?? midpoint(round.range.min, round.range.max), round.range.min, round.range.max);
  const distance = Math.abs(guess - round.target.value);
  const normalized = clamp(distance / (round.range.max - round.range.min), 0, 1);
  const direction = normalized <= 0.05 ? "bullseye" : guess < round.target.value ? "left" : "right";

  state.guess = guess;
  state.results = [...state.results, {
    round: state.roundIndex + 1,
    guess,
    truth: round.target.value,
    distance,
    normalized,
    direction,
  }];
  state.screen = "revealed";
  saveInProgress();
  renderGame();
}

function continueAfterReveal() {
  if (state.roundIndex >= state.puzzle.rounds.length - 1) {
    completePuzzle();
    return;
  }
  state.roundIndex += 1;
  state.guess = null;
  state.screen = "playing";
  saveInProgress();
  renderGame();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function completePuzzle() {
  const score = calculateScore(state.results);
  progress.completed = progress.completed || {};
  progress.completed[state.puzzle.date] = {
    date: state.puzzle.date,
    mode: state.puzzle.mode,
    score,
    results: state.results,
    completedAt: new Date().toISOString(),
  };
  if (progress.inProgress) delete progress.inProgress[state.puzzle.date];
  writeProgress();
  state.screen = "complete";
  renderSummary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSummary() {
  const puzzle = state.puzzle || getDailyPuzzle();
  const record = progress.completed?.[puzzle.date] || { score: calculateScore(state.results), results: state.results };
  const results = record.results || [];
  const score = Number(record.score ?? calculateScore(results));
  const shareGlyphs = results.map((result) => result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶").join(" ");
  const heading = score <= 5 ? "Beautifully placed." : score <= 15 ? "A steady line." : score <= 30 ? "You found the shape of it." : "The line fought back.";

  app.innerHTML = `
    <section class="summary-shell" aria-labelledby="summary-heading">
      <div class="summary-topline">
        <span class="round-count"><strong>Line complete</strong> · ${formatDate(puzzle.date, { day: "numeric", month: "long", year: "numeric" })}</span>
        <span class="round-count">${puzzle.mode === "year" ? "Release year" : "Age at release"}</span>
      </div>
      <div class="summary-hero">
        <div>
          <p class="eyebrow">${heading}</p>
          <h1 id="summary-heading">${score.toFixed(1)}</h1>
        </div>
        <div class="summary-score">
          <p class="eyebrow">Distance score</p>
          <span class="score-value">${score.toFixed(1)}</span>
          <p>Lower is closer · perfect is 0.0</p>
        </div>
      </div>
      <div class="share-card">
        <div>
          <p>Your spoiler-free shape</p>
          <p class="share-glyphs" aria-label="Round results">${shareGlyphs || "No placements"}</p>
        </div>
        <button class="button" id="summary-share" type="button">Share result</button>
      </div>

      <div class="section-heading"><h2>Round by round</h2><span class="muted-copy">${results.length} placements</span></div>
      <div class="results-list">
        ${results.map((result, index) => renderResultRow(result, puzzle.rounds[index])).join("")}
      </div>
      <div class="button-row summary-actions">
        <a class="button button-primary" href="#daily">Back to today</a>
        <a class="button button-quiet" href="#stats">See stats</a>
        <a class="button button-quiet" href="#archive">Play another line</a>
      </div>
    </section>`;
  document.querySelector("#summary-share").addEventListener("click", () => shareCurrentResult());
}

function renderResultRow(result, round) {
  const glyph = result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶";
  return `
    <div class="result-row">
      <span class="result-number">0${result.round}</span>
      <div class="result-copy">
        <strong>${escapeHtml(round.target.name)} · ${escapeHtml(round.target.film)}</strong>
        <span>${formatValue(result.guess, round.mode)} guessed · ${formatValue(result.truth, round.mode)} true</span>
      </div>
      <div class="result-score"><strong><span class="round-glyph" aria-hidden="true">${glyph}</span>${(result.normalized * 100).toFixed(1)}</strong><span>distance</span></div>
    </div>`;
}

function renderArchive() {
  const puzzles = [...state.puzzles].sort((a, b) => b.date.localeCompare(a.date));
  const today = getTodayKey();
  app.innerHTML = `
    <section aria-labelledby="archive-heading">
      <div class="page-heading">
        <div><p class="eyebrow">No puzzle disappears</p><h1 id="archive-heading">Archive.</h1><p class="subheading">Every frozen line, ready to replay.</p></div>
        <a class="button button-quiet" href="#daily">Today's line</a>
      </div>
      <div class="archive-grid">
        ${puzzles.map((puzzle) => {
          const record = progress.completed?.[puzzle.date];
          const current = puzzle.date === today;
          return `<button class="archive-item" data-date="${puzzle.date}" type="button">
            <span class="archive-date">${current ? "Today" : formatDate(puzzle.date, { day: "numeric", month: "short" })}</span>
            <span class="archive-status">${record ? `${Number(record.score).toFixed(1)}` : "unplayed"}</span>
            <span class="archive-info"><strong>${puzzle.mode === "year" ? "Release year" : "Age at release"}</strong><span>${puzzle.rounds.length} rounds · ${record ? "completed" : "ready"}</span></span>
          </button>`;
        }).join("")}
      </div>
    </section>`;
  document.querySelectorAll(".archive-item").forEach((item) => {
    item.addEventListener("click", () => {
      const puzzle = getPuzzle(item.dataset.date);
      if (!puzzle) return;
      state.puzzle = puzzle;
      restorePuzzleState(puzzle);
      if (state.screen === "complete") return renderSummary();
      renderIntro();
    });
  });
}

function renderStats() {
  const records = Object.values(progress.completed || {}).sort((a, b) => a.date.localeCompare(b.date));
  const stats = getStats(records);
  app.innerHTML = `
    <section aria-labelledby="stats-heading">
      <div class="page-heading">
        <div><p class="eyebrow">Your local record</p><h1 id="stats-heading">Stats.</h1><p class="subheading">A history of finding the line.</p></div>
        <a class="button button-quiet" href="#daily">Play today's line</a>
      </div>
      <div class="stats-summary">
        <div class="stat-card"><p class="eyebrow">Current streak</p><strong>${stats.currentStreak}</strong><span>${stats.currentStreak === 1 ? "day" : "days"}</span></div>
        <div class="stat-card"><p class="eyebrow">Best streak</p><strong>${stats.bestStreak}</strong><span>${stats.bestStreak === 1 ? "day" : "days"}</span></div>
        <div class="stat-card"><p class="eyebrow">Average score</p><strong>${records.length ? stats.average.toFixed(1) : "n/a"}</strong><span>${records.length ? "lower is better" : "complete a line"}</span></div>
      </div>
      <div class="section-heading"><h2>Score distribution</h2><span class="muted-copy">${records.length} ${records.length === 1 ? "line" : "lines"}</span></div>
      ${records.length ? `<div class="distribution">${stats.distribution.map((bucket) => `<div class="distribution-row"><span>${bucket.label}</span><div class="distribution-bar"><span style="--bar-width:${bucket.width}%"></span></div><strong>${bucket.count}</strong></div>`).join("")}</div>` : `<div class="empty-card"><p>Your distribution will take shape after your first completed line.</p></div>`}
      <div class="data-actions">
        <button class="button" id="export-button" type="button">Export backup</button>
        <button class="button" id="import-button" type="button">Import backup</button>
        <input id="import-input" type="file" accept="application/json" hidden />
        <p class="muted-copy">Stats are stored locally. Importing replaces this browser's record.</p>
      </div>
    </section>`;
  document.querySelector("#export-button").addEventListener("click", exportProgress);
  document.querySelector("#import-button").addEventListener("click", () => document.querySelector("#import-input").click());
  document.querySelector("#import-input").addEventListener("change", importProgress);
}

function getStats(records) {
  const scores = records.map((record) => Number(record.score)).filter(Number.isFinite);
  const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const distribution = [
    { label: "0–5", min: 0, max: 5 },
    { label: "5–10", min: 5, max: 10 },
    { label: "10–20", min: 10, max: 20 },
    { label: "20–35", min: 20, max: 35 },
    { label: "35+", min: 35, max: Infinity },
  ].map((bucket) => ({
    ...bucket,
    count: scores.filter((score) => score >= bucket.min && score < bucket.max).length,
  }));
  const maxBucket = Math.max(1, ...distribution.map((bucket) => bucket.count));
  distribution.forEach((bucket) => bucket.width = (bucket.count / maxBucket) * 100);
  const dates = records.map((record) => record.date);
  return { average, distribution, currentStreak: calculateStreak(dates, true), bestStreak: calculateStreak(dates, false) };
}

function calculateStreak(dates, currentOnly) {
  if (!dates.length) return 0;
  const sorted = [...new Set(dates)].sort();
  let best = 1;
  let running = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    if (dayDifference(sorted[index - 1], sorted[index]) === 1) running += 1;
    else running = 1;
    best = Math.max(best, running);
  }
  if (!currentOnly) return best;
  const today = getTodayKey();
  const latest = sorted[sorted.length - 1];
  if (dayDifference(latest, today) > 1) return 0;
  let current = 1;
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    if (dayDifference(sorted[index - 1], sorted[index]) === 1) current += 1;
    else break;
  }
  return current;
}

function dayDifference(from, to) {
  const first = Date.parse(`${from}T00:00:00Z`);
  const second = Date.parse(`${to}T00:00:00Z`);
  return Math.round((second - first) / 86400000);
}

async function shareCurrentResult() {
  const puzzle = state.puzzle || getDailyPuzzle();
  const record = progress.completed?.[puzzle?.date];
  if (!record) {
    const url = window.location.href.split("#")[0];
    await copyText(`Deviate · a daily timeline game\n${url}`);
    return showToast("Link copied");
  }
  const glyphs = record.results.map((result) => result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶").join(" ");
  const shareText = `Deviate · ${formatDate(puzzle.date, { day: "numeric", month: "short", year: "numeric" })}\nScore ${Number(record.score).toFixed(1)} · lower is better\n${glyphs}\n${window.location.href.split("#")[0]}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Deviate result", text: shareText });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyText(shareText);
  showToast("Result copied");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `deviate-backup-${getTodayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Backup exported");
}

async function importProgress(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!isValidProgress(imported)) throw new Error("Invalid backup");
    progress = imported;
    writeProgress();
    showToast("Backup imported");
    renderStats();
  } catch (error) {
    showToast("That backup could not be read");
  } finally {
    event.target.value = "";
  }
}

function isValidProgress(value) {
  return value && typeof value === "object" && typeof value.completed === "object" && typeof value.inProgress === "object";
}

function saveInProgress() {
  progress.inProgress = progress.inProgress || {};
  progress.inProgress[state.puzzle.date] = {
    roundIndex: state.roundIndex,
    results: state.results,
    updatedAt: new Date().toISOString(),
  };
  writeProgress();
}

function readProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return {
      completed: parsed.completed && typeof parsed.completed === "object" ? parsed.completed : {},
      inProgress: parsed.inProgress && typeof parsed.inProgress === "object" ? parsed.inProgress : {},
    };
  } catch (error) {
    return { completed: {}, inProgress: {} };
  }
}

function writeProgress() {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

function applyTheme(theme) {
  const resolved = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = resolved;
  const button = document.querySelector("#theme-button");
  if (button) {
    button.setAttribute("aria-label", resolved === "dark" ? "Switch to light theme" : "Switch to dark theme");
    button.setAttribute("title", resolved === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
}

function getContractStyle(round) {
  if (!round.nextRange) return { start: 0, width: 100 };
  const rangeWidth = round.range.max - round.range.min;
  const start = toPercent(round.nextRange.min, round.range.min, round.range.max);
  const end = toPercent(round.nextRange.max, round.range.min, round.range.max);
  return { start, width: Math.max(0, end - start), rangeWidth };
}

function calculateScore(results) {
  if (!results.length) return 0;
  return (results.reduce((sum, result) => sum + Number(result.normalized || 0), 0) / results.length) * 100;
}

function formatValue(value, mode) {
  if (mode === "year") return `${Math.round(value)}`;
  return `${Number(value).toFixed(1)} yrs`;
}

function formatDistance(distance, mode) {
  return mode === "year" ? `${distance.toFixed(1)} years` : `${distance.toFixed(1)} years`;
}

function formatGender(gender) {
  return gender === "F" ? "Woman" : "Man";
}

function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${date}T00:00:00Z`));
}

function midpoint(min, max) { return min + ((max - min) / 2); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function toPercent(value, min, max) { return clamp(((value - min) / (max - min)) * 100, 0, 100); }

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
}
