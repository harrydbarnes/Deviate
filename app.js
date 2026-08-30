const DATA_URL = "./data/daily.json";
const SERVICE_WORKER_URL = "./service-worker.js";
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
  selectedOptionId: null,
  difficulty: "normal",
  hardAnswer: "",
  results: [],
  toastTimer: null,
  roundTransition: false,
};

let progress = readProgress();
let globalEventsBound = false;

init();

async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  if (!globalEventsBound) {
    bindGlobalEvents();
    globalEventsBound = true;
  }
  registerServiceWorker();

  try {
    const response = await fetch(DATA_URL);
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
        <button class="button button-primary" id="retry-button" type="button">Try again</button>
      </section>`;
    document.querySelector("#retry-button")?.addEventListener("click", init);
  }
}

function bindGlobalEvents() {
  const handleRouteChange = () => {
    state.route = getRoute();
    if (state.route === "daily") {
      state.puzzle = getDailyPuzzle();
      restorePuzzleState(state.puzzle);
    }
    renderRoute();
  };
  window.addEventListener("hashchange", handleRouteChange);
  window.addEventListener("popstate", handleRouteChange);

  document.querySelector(".wordmark").addEventListener("click", (event) => {
    event.preventDefault();
    goHome();
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(SERVICE_WORKER_URL).catch((error) => {
    console.warn("Deviate offline support could not start", error);
  });
}

function goHome() {
  const puzzle = getDailyPuzzle();
  if (!puzzle) return;
  state.route = "daily";
  state.puzzle = puzzle;
  state.screen = "intro";
  state.roundIndex = 0;
  state.guess = null;
  state.selectedOptionId = null;
  state.difficulty = "normal";
  state.hardAnswer = "";
  state.results = [];
  state.roundTransition = false;
  if (window.location.hash !== "#daily") {
    window.history.pushState({ route: "daily" }, "", `${window.location.pathname}${window.location.search}#daily`);
  }
  renderIntro();
  focusHeading("intro-heading");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeHelp() {
  if (typeof helpDialog.close === "function") helpDialog.close();
  else helpDialog.removeAttribute("open");
}

function focusHeading(id) {
  requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }));
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

function getPuzzleNumber(puzzle) {
  const explicit = Number(puzzle?.id ?? puzzle?.number ?? puzzle?.puzzleNumber);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const chronological = [...state.puzzles].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const fallback = chronological.findIndex((candidate) => candidate.date === puzzle?.date);
  return fallback >= 0 ? fallback + 1 : null;
}

function getPuzzleLabel(puzzle) {
  const number = getPuzzleNumber(puzzle);
  return number ? `Deviate #${number}` : "Deviate";
}

function normaliseDifficulty(difficulty, puzzle) {
  return puzzle?.mode === "middle" && difficulty === "hard" ? "hard" : "normal";
}

function getDifficultyLabel(difficulty) {
  return difficulty === "hard" ? "Hard mode" : "Normal mode";
}

function getCompletionBucket(difficulty = state.difficulty) {
  return difficulty === "hard" ? "hardCompleted" : "completed";
}

function getInProgressBucket(difficulty = state.difficulty) {
  return difficulty === "hard" ? "hardInProgress" : "inProgress";
}

function getCompletionRecord(puzzle, difficulty = state.difficulty) {
  if (!puzzle) return null;
  const bucket = getCompletionBucket(normaliseDifficulty(difficulty, puzzle));
  return progress[bucket]?.[puzzle.date] || null;
}

function getInProgressRecord(puzzle, difficulty = state.difficulty) {
  if (!puzzle) return null;
  const bucket = getInProgressBucket(normaliseDifficulty(difficulty, puzzle));
  return progress[bucket]?.[puzzle.date] || null;
}

function getPrimaryCompletedRecords() {
  const dates = new Set([
    ...Object.keys(progress.completed || {}),
    ...Object.keys(progress.hardCompleted || {}),
  ]);
  return [...dates]
    .map((date) => progress.completed?.[date] || progress.hardCompleted?.[date])
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));
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
  state.difficulty = normaliseDifficulty(state.difficulty, puzzle);
  const completed = getCompletionRecord(puzzle);
  const inProgress = getInProgressRecord(puzzle);

  if (completed) {
    state.screen = "complete";
    state.roundIndex = puzzle.rounds.length - 1;
    state.results = completed.results || [];
    state.guess = null;
    state.selectedOptionId = null;
    state.hardAnswer = "";
    return;
  }

  if (inProgress) {
    state.roundIndex = Math.min(inProgress.roundIndex || 0, puzzle.rounds.length - 1);
    state.results = Array.isArray(inProgress.results) ? inProgress.results : [];
    state.screen = inProgress.screen === "revealed" || state.results.length > state.roundIndex ? "revealed" : "playing";
    const savedGuess = Number(inProgress.guess);
    const lastGuess = Number(state.results.at(-1)?.guess);
    state.guess = inProgress.guess !== null && inProgress.guess !== undefined && Number.isFinite(savedGuess)
      ? savedGuess
      : state.screen === "revealed" && Number.isFinite(lastGuess) ? lastGuess : null;
    state.selectedOptionId = inProgress.selectedOptionId || null;
    state.hardAnswer = inProgress.hardAnswer || "";
    if (state.difficulty === "hard" && !state.selectedOptionId) {
      state.selectedOptionId = findHardOption(puzzle.rounds[state.roundIndex], state.hardAnswer)?.optionId || null;
    }
    return;
  }

  state.screen = "intro";
  state.roundIndex = 0;
  state.results = [];
  state.guess = null;
  state.selectedOptionId = null;
  state.hardAnswer = "";
}

function startPuzzle(puzzle, difficulty = state.difficulty) {
  state.puzzle = puzzle;
  state.difficulty = normaliseDifficulty(difficulty, puzzle);
  restorePuzzleState(puzzle);
  if (state.screen === "complete") {
    renderSummary();
    return;
  }
  if (state.screen === "revealed") {
    renderGame();
    focusHeading("game-heading");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  state.screen = "playing";
  state.roundIndex = Math.min(state.results.length, puzzle.rounds.length - 1);
  state.guess = null;
  state.selectedOptionId = null;
  state.hardAnswer = "";
  state.roundTransition = false;
  saveInProgress();
  renderGame();
  focusHeading("game-heading");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderGame() {
  if (!state.puzzle) return;
  if (state.screen === "complete") return renderSummary();
  if (state.screen === "intro") return renderIntro();

  const puzzle = state.puzzle;
  const round = puzzle.rounds[state.roundIndex];
  const puzzleLabel = getPuzzleLabel(puzzle);
  const isMiddle = round.mode === "middle";
  const hardMode = isMiddle && state.difficulty === "hard";
  const selectedOption = isMiddle ? getSelectedOption(round) : null;
  const hasGuess = isMiddle ? Boolean(selectedOption) : state.guess !== null;
  const progressPercent = ((state.roundIndex + (state.screen === "revealed" ? 1 : 0)) / puzzle.rounds.length) * 100;
  const guess = isMiddle ? (selectedOption?.value ?? midpoint(round.range.min, round.range.max)) : state.guess ?? midpoint(round.range.min, round.range.max);
  const guessPercent = toPercent(guess, round.range.min, round.range.max);
  const truthPercent = toPercent(round.target.value, round.range.min, round.range.max);
  const contract = getContractStyle(round);
  const prompt = isMiddle ? "Which answer is closest to the middle?" : `Where does this ${round.mode === "year" ? "release year" : "age at release"} belong?`;
  const timelineInstruction = state.screen === "revealed"
    ? (round.nextRange ? "The warm line shows the narrower range for the next round." : "The final answer is now locked in.")
    : isMiddle ? hardMode ? "Type an actor or film from the cards." : "Pick the film credit you think sits closest to the midpoint." : "Drag the marker, or tap anywhere on the line.";
  const readout = isMiddle
    ? hardMode
      ? selectedOption ? state.screen === "revealed" ? "Answer revealed" : "Answer entered" : "Type an answer"
      : selectedOption ? `Choice ${optionIndex(round, selectedOption)}` : "Choose one"
    : hasGuess ? formatValue(guess, round.mode) : "Place a marker";
  const lineLabel = puzzle.date === getTodayKey() ? "Daily line" : "Archive line";

  app.innerHTML = `
    <section class="game-shell${state.roundTransition ? " is-round-entering" : ""}" aria-labelledby="game-heading">
      <div class="game-topline">
        <span class="round-count"><strong>${puzzleLabel}</strong> · ${lineLabel} · ${formatDate(puzzle.date, { day: "numeric", month: "long" })}</span>
        <span class="round-count">Round <strong>${state.roundIndex + 1}</strong> of <strong>${puzzle.rounds.length}</strong></span>
      </div>
      <div class="progress-track" aria-hidden="true" style="--progress:${progressPercent}%"><span></span></div>

      <div class="game-prompt">
        <div>
          <p class="eyebrow">${isMiddle ? "Choose the middle" : "Place the hidden value"}</p>
          <h1 id="game-heading" tabindex="-1">${prompt}</h1>
        </div>
        <span class="mode-pill">${getModeLabel(round.mode)}${hardMode ? " · Hard" : ""}</span>
      </div>

      <div class="anchor-grid">
        ${renderAnchor(round.anchor, round.mode, "Known anchor", round.anchorSide === "left" || round.anchorSide === "left edge" ? "Left edge" : "Right edge")}
        ${renderMystery(round.target, round.mode, state.screen === "revealed")}
      </div>

      <div class="timeline-panel">
        <div class="timeline-header">
          <p>${timelineInstruction}</p>
          <span class="guess-readout" id="guess-readout" aria-live="polite">${readout}</span>
        </div>
        ${isMiddle ? renderMiddleTimeline(round, state.screen === "revealed", selectedOption, contract) : renderValueTimeline(round, state.screen === "revealed", guess, guessPercent, truthPercent, contract, hasGuess)}
        ${isMiddle ? renderMiddleOptions(round, state.screen === "revealed", state.selectedOptionId, hardMode) : ""}
        ${hardMode ? renderHardAnswerInput(round, selectedOption, state.screen === "revealed") : ""}
        <div class="timeline-footer">
          <p class="scale-note">${state.screen === "revealed" ? (isMiddle ? `Closest answer: ${formatValue(round.target.value, round.mode)}` : `Answer: ${formatValue(round.target.value, round.mode)}`) : isMiddle ? hardMode ? "Enter one of the listed actors or films." : "Years stay hidden until you lock in." : "The exact value can sit anywhere between the anchors."}</p>
          ${state.screen === "revealed" ? `<button class="button button-primary" id="continue-button" type="button">${state.roundIndex === puzzle.rounds.length - 1 ? "See your summary" : "Continue to next line"}</button>` : `<button class="button button-primary" id="lock-button" type="button" ${(!isMiddle && !hasGuess) || (isMiddle && !selectedOption) ? "disabled" : ""}>Lock in guess</button>`}
        </div>
        ${state.screen === "revealed" ? renderRevealNote(round, state.results[state.results.length - 1]) : ""}
      </div>
    </section>`;

  if (state.screen !== "revealed") {
    if (isMiddle) {
      if (hardMode) {
        const input = document.querySelector("#hard-answer");
        input?.addEventListener("input", () => updateHardAnswer(round, input));
        input?.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          const lockButton = document.querySelector("#lock-button");
          if (lockButton && !lockButton.disabled) lockButton.click();
        });
        requestAnimationFrame(() => input?.focus({ preventScroll: true }));
      } else {
        document.querySelectorAll(".middle-option").forEach((option) => {
          option.addEventListener("click", () => {
            state.selectedOptionId = option.dataset.optionId;
            state.guess = null;
            renderGame();
            requestAnimationFrame(() => {
              [...document.querySelectorAll(".middle-option")].find((candidate) => candidate.dataset.optionId === state.selectedOptionId)?.focus({ preventScroll: true });
            });
          });
        });
      }
    } else {
      const input = document.querySelector("#timeline-input");
      input.addEventListener("input", (event) => {
        state.guess = Number(event.target.value);
        updateGuessReadout(round);
      });
      input.addEventListener("change", (event) => {
        state.guess = Number(event.target.value);
        updateGuessReadout(round);
      });
      requestAnimationFrame(() => input?.focus({ preventScroll: true }));
    }
    document.querySelector("#lock-button").addEventListener("click", lockGuess);
  } else {
    document.querySelector("#continue-button").addEventListener("click", continueAfterReveal);
  }
}

function renderValueTimeline(round, revealed, guess, guessPercent, truthPercent, contract, hasGuess) {
  const labelsClose = Math.abs(guessPercent - truthPercent) < 9;
  return `
    <div class="timeline ${revealed ? "is-revealed" : ""} ${hasGuess ? "" : "is-unplaced"} ${labelsClose ? "labels-close" : ""}" style="--guess:${guessPercent}%;--truth:${truthPercent}%;--contract-start:${contract.start}%;--contract-width:${contract.width}%">
      <div class="timeline-ticks" aria-hidden="true">
        <span>${formatValue(round.range.min, round.mode)}</span>
        <span>${formatValue(midpoint(round.range.min, round.range.max), round.mode)}</span>
        <span>${formatValue(round.range.max, round.mode)}</span>
      </div>
      <div class="timeline-axis" aria-hidden="true"></div>
      <div class="range-window" aria-hidden="true"></div>
      <div class="marker guess-marker ${hasGuess ? "" : "is-hidden"}" style="left:${guessPercent}%" aria-hidden="true"></div>
      <div class="marker truth-marker" style="left:${truthPercent}%" aria-hidden="true"></div>
      <span class="marker-label guess-label ${hasGuess ? "" : "is-hidden"}" style="--guess:${guessPercent}%">${revealed ? "Your guess" : "Your marker"}</span>
      <span class="marker-label truth-label" style="--truth:${truthPercent}%">Answer</span>
      <input class="timeline-input" id="timeline-input" type="range" min="${round.range.min}" max="${round.range.max}" step="0.1" value="${guess}" aria-label="Place your guess on the timeline" aria-valuetext="${hasGuess ? formatValue(guess, round.mode) : "No guess placed"}" ${revealed ? "disabled" : ""} />
    </div>`;
}

function renderMiddleTimeline(round, revealed, selectedOption, contract) {
  const markers = revealed ? round.options.map((option) => {
    const position = toPercent(option.value, round.range.min, round.range.max);
    const classes = [
      "middle-marker",
      option.optionId === selectedOption?.optionId ? "is-selected" : "",
      option.optionId === round.target.optionId ? "is-answer" : "",
    ].filter(Boolean).join(" ");
    return `<div class="${classes}" style="--option:${position}%"><span>${formatValue(option.value, "middle")}</span></div>`;
  }).join("") : "";
  return `
    <div class="timeline middle-timeline ${revealed ? "is-revealed" : ""}" style="--contract-start:${contract.start}%;--contract-width:${contract.width}%">
      <div class="timeline-ticks" aria-hidden="true">
        <span>${formatValue(round.range.min, "middle")}</span>
        <span>middle</span>
        <span>${formatValue(round.range.max, "middle")}</span>
      </div>
      <div class="timeline-axis" aria-hidden="true"></div>
      <div class="middle-centre-line" aria-hidden="true"></div>
      <div class="range-window" aria-hidden="true"></div>
      ${markers}
    </div>`;
}

function renderMiddleOptions(round, revealed, selectedOptionId, hardMode = false) {
  return `
    <div class="middle-options${hardMode ? " hard-options" : ""}" aria-label="${hardMode ? "Possible middle mode answers" : "Middle mode answers"}">
      ${round.options.map((option, index) => {
        const isSelected = option.optionId === selectedOptionId;
        const isAnswer = option.optionId === round.target.optionId;
        const stateClass = revealed ? `${isSelected ? "is-selected" : ""} ${isAnswer ? "is-answer" : "is-distractor"}` : isSelected ? "is-selected" : "";
        const tag = hardMode ? "div" : "button";
        const attributes = hardMode ? "" : ` data-option-id="${escapeHtml(option.optionId)}" type="button" ${revealed ? "disabled" : ""}`;
        return `<${tag} class="middle-option ${hardMode ? "hard-option" : ""} ${stateClass}"${attributes}>
          ${hardMode ? "" : `<span class="option-letter">${String.fromCharCode(65 + index)}</span>`}
          <span class="option-copy"><strong>${escapeHtml(option.name)}</strong><span><em>${escapeHtml(option.film)}</em>${option.role ? ` · as ${escapeHtml(option.role)}` : ""}</span></span>
          <span class="option-value">${revealed ? formatValue(option.value, "middle") : "?"}</span>
        </${tag}>`;
      }).join("")}
    </div>`;
}

function renderHardAnswerInput(round, selectedOption, revealed) {
  const hasText = Boolean(state.hardAnswer.trim());
  const isMatch = Boolean(selectedOption);
  const hint = revealed
    ? isMatch ? "Matched answer" : "No answer matched"
    : isMatch ? "Ready to lock in" : hasText ? "Match a listed actor or film" : "Exact actor or film title";
  return `
    <div class="hard-answer-wrap">
      <label class="hard-answer-label" for="hard-answer">Your answer</label>
      <input class="hard-answer-input" id="hard-answer" type="text" value="${escapeHtml(state.hardAnswer)}" placeholder="Type an actor or film" autocomplete="off" autocapitalize="words" spellcheck="false" aria-describedby="hard-answer-hint" aria-invalid="${hasText && !isMatch ? "true" : "false"}" ${revealed ? "disabled" : ""} />
      <span class="hard-answer-hint" id="hard-answer-hint">${hint}</span>
    </div>`;
}

function renderIntro() {
  const puzzle = state.puzzle;
  const puzzleLabel = getPuzzleLabel(puzzle);
  state.difficulty = normaliseDifficulty(state.difficulty, puzzle);
  const record = getCompletionRecord(puzzle);
  const inProgress = getInProgressRecord(puzzle);
  const isDaily = puzzle.date === getTodayKey();
  const isMiddle = puzzle.mode === "middle";
  const lineDescription = isDaily ? "today's line" : "this frozen line";
  const lede = puzzle.mode === "middle"
    ? "A calm, five-round challenge about actors, films and choosing the credit closest to the middle."
    : "A calm, five-round guessing game about actors, films and the space between two known points.";
  app.innerHTML = `
    <section class="intro-layout" aria-labelledby="intro-heading">
      <div class="intro-copy">
        <p class="eyebrow">${isDaily ? "Today's puzzle" : "Frozen archive line"}</p>
        <h1 id="intro-heading" tabindex="-1">Find your place in time.</h1>
        <p class="lede">${lede}</p>
        <div class="intro-meta" aria-label="Puzzle details">
          <span>${puzzleLabel}</span>
          <span>${formatDate(puzzle.date, { weekday: "long", day: "numeric", month: "long" })}</span>
          <span>${getModeLabel(puzzle.mode)}</span>
          <span>${puzzle.rounds.length} rounds</span>
        </div>
        ${isMiddle ? `
          <div class="difficulty-picker" role="group" aria-label="Choose difficulty">
            <p class="clue-label">Difficulty</p>
            <div class="difficulty-options">
              <button class="difficulty-option ${state.difficulty === "normal" ? "is-selected" : ""}" data-difficulty="normal" type="button" aria-pressed="${state.difficulty === "normal"}">
                <strong>Normal</strong><span>Choose from four</span>
              </button>
              <button class="difficulty-option ${state.difficulty === "hard" ? "is-selected" : ""}" data-difficulty="hard" type="button" aria-pressed="${state.difficulty === "hard"}">
                <strong>Hard</strong><span>Type an actor or film</span>
              </button>
            </div>
          </div>` : ""}
        <div class="button-row">
          <button class="button button-primary" id="start-button" type="button">${record ? state.difficulty === "hard" ? "View hard line" : "View completed line" : inProgress ? `Resume ${state.difficulty === "hard" ? "hard line" : lineDescription}` : `Start ${state.difficulty === "hard" ? "hard line" : lineDescription}`}</button>
          <a class="button button-quiet" href="#archive">Browse archive</a>
        </div>
      </div>
      <div class="intro-aside" aria-label="How Deviate works">
        <div class="promise-card">
          <p class="card-kicker">The small promise</p>
          <h2>Every answer leaves a narrower line.</h2>
          <p>Deviate score: lower is closer</p>
        </div>
        <div class="tip-card"><strong>One puzzle.</strong> Frozen forever once it goes live. Your record never leaves this browser.</div>
      </div>
    </section>`;
  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      state.difficulty = normaliseDifficulty(button.dataset.difficulty, puzzle);
      state.screen = "intro";
      state.roundIndex = 0;
      state.guess = null;
      state.selectedOptionId = null;
      state.hardAnswer = "";
      state.results = [];
      restorePuzzleState(puzzle);
      renderIntro();
      focusHeading("intro-heading");
    });
  });
  document.querySelector("#start-button").addEventListener("click", () => {
    if (record) return renderSummary();
    startPuzzle(puzzle, state.difficulty);
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
  if (mode === "middle") {
    return `
      <article class="anchor-card mystery ${revealed ? "revealed" : ""}">
        <div class="anchor-topline"><span>${revealed ? "Middle found" : "Answer set"}</span><span class="anchor-side">Right edge</span></div>
        ${revealed ? `
          <p class="anchor-name">${escapeHtml(target.name)}</p>
          <p class="anchor-credit"><em>${escapeHtml(target.film)}</em> · ${target.year}</p>
          <p class="anchor-credit">${formatValue(target.value, mode)} · closest to middle</p>` : `
          <div class="anchor-clue">
            <p class="clue-label">The challenge</p>
            <p class="clue-value">Pick the closest</p>
            <p class="clue-detail">Four film credits · release years hidden</p>
          </div>`}
      </article>`;
  }
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
          <p class="clue-detail">One credit: <em>${escapeHtml(target.film)}</em>${mode === "age" && target.role ? ` · as ${escapeHtml(target.role)}` : ""}</p>
        </div>`}
    </article>`;
}

function renderRevealNote(round, result) {
  if (!result) return "";
  const glyph = result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶";
  const relative = round.mode === "middle"
    ? result.direction === "bullseye" ? "inside the bullseye" : result.direction === "left" ? "to the left of the middle" : "to the right of the middle"
    : result.direction === "bullseye" ? "inside the bullseye" : result.direction === "left" ? "to the left of the answer" : "to the right of the answer";
  const nextRange = round.nextRange ? `${formatValue(round.nextRange.min, round.mode)} to ${formatValue(round.nextRange.max, round.mode)}` : "the line is complete";
  const answerDetail = round.mode === "middle"
    ? `Closest answer: ${escapeHtml(round.target.name)} · ${escapeHtml(round.target.film)} · ${formatValue(round.target.value, round.mode)}`
    : `${escapeHtml(round.target.name)} · ${escapeHtml(round.target.film)} · ${formatValue(round.target.value, round.mode)}`;
  return `
    <div class="reveal-note" aria-live="polite">
      <span class="result-glyph" aria-hidden="true">${glyph}</span>
      <div>
        <p>Your ${round.mode === "middle" ? "choice" : "marker"} landed <strong>${formatDistance(result.distance, round.mode)}</strong> ${relative}.</p>
        <p class="answer-detail">${answerDetail}</p>
        <p class="range-detail">${round.nextRange ? `Next range: ${nextRange}` : "Final round complete."}</p>
      </div>
    </div>`;
}

function updateGuessReadout(round) {
  const readout = document.querySelector("#guess-readout");
  const marker = document.querySelector(".guess-marker");
  const label = document.querySelector(".guess-label");
  const timeline = document.querySelector(".timeline");
  const input = document.querySelector("#timeline-input");
  if (!readout || !marker || !label) return;
  const value = state.guess ?? midpoint(round.range.min, round.range.max);
  const percent = toPercent(value, round.range.min, round.range.max);
  readout.textContent = formatValue(value, round.mode);
  marker.style.left = `${percent}%`;
  label.style.setProperty("--guess", `${percent}%`);
  timeline?.classList.remove("is-unplaced");
  marker.classList.remove("is-hidden");
  label.classList.remove("is-hidden");
  input?.setAttribute("aria-valuetext", formatValue(value, round.mode));
  const lockButton = document.querySelector("#lock-button");
  if (lockButton) lockButton.disabled = false;
}

function updateHardAnswer(round, input) {
  state.hardAnswer = input.value;
  const selected = findHardOption(round, state.hardAnswer);
  state.selectedOptionId = selected?.optionId || null;
  state.guess = null;
  const lockButton = document.querySelector("#lock-button");
  if (lockButton) lockButton.disabled = !selected;
  const readout = document.querySelector("#guess-readout");
  if (readout) readout.textContent = selected ? "Answer entered" : "Type an answer";
  const hint = document.querySelector("#hard-answer-hint");
  if (hint) hint.textContent = selected ? "Ready to lock in" : input.value.trim() ? "Match a listed actor or film" : "Exact actor or film title";
  input.setAttribute("aria-invalid", input.value.trim() && !selected ? "true" : "false");
}

function lockGuess() {
  const puzzle = state.puzzle;
  const round = puzzle.rounds[state.roundIndex];
  if (round.mode === "middle") {
    const selected = getSelectedOption(round);
    if (!selected) {
      showToast(state.difficulty === "hard" ? "Type one of the listed answers" : "Choose an answer first");
      return;
    }
    const middle = midpoint(round.range.min, round.range.max);
    const distance = Math.abs(selected.value - middle);
    const normalized = clamp(distance / Math.max((round.range.max - round.range.min) / 2, 0.0001), 0, 1);
    const direction = normalized <= 0.05 ? "bullseye" : selected.value < middle ? "left" : "right";
    state.guess = selected.value;
    state.results = [...state.results, {
      round: state.roundIndex + 1,
      guess: selected.value,
      truth: round.target.value,
      middle,
      distance,
      normalized,
      direction,
      optionId: selected.optionId,
      optionName: selected.name,
      optionFilm: selected.film,
      answerText: state.hardAnswer.trim(),
    }];
    state.screen = "revealed";
    saveInProgress();
    renderGame();
    return;
  }
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
  state.selectedOptionId = null;
  state.hardAnswer = "";
  state.screen = "playing";
  state.roundTransition = true;
  saveInProgress();
  renderGame();
  window.scrollTo({ top: 0, behavior: "smooth" });
  requestAnimationFrame(() => {
    const shell = document.querySelector(".game-shell");
    shell?.classList.add("is-round-entered");
    focusHeading("game-heading");
    window.setTimeout(() => {
      state.roundTransition = false;
    }, 900);
  });
}

function completePuzzle() {
  const score = calculateScore(state.results);
  const difficulty = normaliseDifficulty(state.difficulty, state.puzzle);
  const completionBucket = getCompletionBucket(difficulty);
  const inProgressBucket = getInProgressBucket(difficulty);
  progress[completionBucket] = progress[completionBucket] || {};
  progress[completionBucket][state.puzzle.date] = {
    date: state.puzzle.date,
    mode: state.puzzle.mode,
    difficulty,
    puzzleNumber: getPuzzleNumber(state.puzzle),
    score,
    accuracy: calculateAccuracy(score),
    results: state.results,
    completedAt: new Date().toISOString(),
  };
  if (progress[inProgressBucket]) delete progress[inProgressBucket][state.puzzle.date];
  writeProgress();
  state.screen = "complete";
  state.roundTransition = false;
  renderSummary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSummary() {
  const puzzle = state.puzzle || getDailyPuzzle();
  const puzzleLabel = getPuzzleLabel(puzzle);
  const record = getCompletionRecord(puzzle) || { score: calculateScore(state.results), results: state.results, difficulty: state.difficulty };
  const results = record.results || [];
  const score = getRecordScore(record, results);
  const accuracy = calculateAccuracy(score);
  const shareGlyphs = results.map((result) => result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶").join(" ");
  const heading = score <= 5 ? "Beautifully placed." : score <= 15 ? "A steady line." : score <= 30 ? "You found the shape of it." : "The line fought back.";

  app.innerHTML = `
    <section class="summary-shell" aria-labelledby="summary-heading">
      <div class="summary-topline">
        <span class="round-count"><strong>${puzzleLabel}</strong> · <strong>Line complete</strong> · ${formatDate(puzzle.date, { day: "numeric", month: "long", year: "numeric" })}</span>
        <span class="round-count">${getModeLabel(puzzle.mode)} · ${getDifficultyLabel(state.difficulty)}</span>
      </div>
      <div class="summary-hero">
        <div>
          <p class="eyebrow">${heading} · Deviate score</p>
          <h1 id="summary-heading" tabindex="-1">${formatScore(score)}</h1>
        </div>
        <div class="summary-score">
          <p class="eyebrow">Placement accuracy</p>
          <span class="score-value">${formatAccuracy(accuracy)}</span>
          <p>Higher is better · ideal placement is 100%</p>
        </div>
      </div>
      <div class="share-card">
        <div>
          <p>Your spoiler-free result</p>
          <p class="share-metrics"><strong>${puzzleLabel} · ${formatScore(score)}</strong><span>${formatAccuracy(accuracy)} accuracy</span></p>
          <p class="share-glyphs" aria-label="Round results">${shareGlyphs || "No placements"}</p>
          <p class="share-legend" aria-label="Result key"><span aria-hidden="true">◀</span> left · <span aria-hidden="true">◎</span> bullseye · <span aria-hidden="true">▶</span> right</p>
        </div>
        <div class="share-actions">
          <button class="button" id="summary-share" type="button">Share result</button>
          <button class="button button-quiet" id="summary-share-answers" type="button">Share with answers</button>
        </div>
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
  document.querySelector("#summary-share-answers").addEventListener("click", () => shareCurrentResult(true));
  focusHeading("summary-heading");
}

function renderResultRow(result, round) {
  const glyph = result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶";
  if (round.mode === "middle") {
    const selected = round.options?.find((option) => option.optionId === result.optionId);
    return `
      <div class="result-row">
        <span class="result-number">0${result.round}</span>
        <div class="result-copy">
          <strong>${escapeHtml(selected?.name || result.optionName || "Selected answer")} · ${escapeHtml(selected?.film || result.optionFilm || "Film credit")}</strong>
          <span>${formatValue(result.guess, "middle")} chosen · closest was ${formatValue(result.truth, "middle")}</span>
        </div>
        <div class="result-score"><strong><span class="round-glyph" aria-hidden="true">${glyph}</span>${formatScore(result.normalized * 100)}</strong><span>deviation</span></div>
      </div>`;
  }
  return `
    <div class="result-row">
      <span class="result-number">0${result.round}</span>
      <div class="result-copy">
        <strong>${escapeHtml(round.target.name)} · ${escapeHtml(round.target.film)}</strong>
        <span>${formatValue(result.guess, round.mode)} guessed · ${formatValue(result.truth, round.mode)} true</span>
      </div>
      <div class="result-score"><strong><span class="round-glyph" aria-hidden="true">${glyph}</span>${formatScore(result.normalized * 100)}</strong><span>deviation</span></div>
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
          const record = progress.completed?.[puzzle.date] || progress.hardCompleted?.[puzzle.date];
          const current = puzzle.date === today;
          return `<button class="archive-item" data-date="${puzzle.date}" type="button">
            <span class="archive-date">${current ? "Today" : formatDate(puzzle.date, { day: "numeric", month: "short" })}</span>
            <span class="archive-status">${getPuzzleLabel(puzzle)} · ${record ? `${formatScore(getRecordScore(record))}${record.difficulty === "hard" ? " · hard" : ""}` : "unplayed"}</span>
            <span class="archive-info"><strong>${getModeLabel(puzzle.mode)}</strong><span>${puzzle.rounds.length} rounds · ${record ? "completed" : "ready"}</span></span>
          </button>`;
        }).join("")}
      </div>
    </section>`;
  document.querySelectorAll(".archive-item").forEach((item) => {
    item.addEventListener("click", () => {
      const puzzle = getPuzzle(item.dataset.date);
      if (!puzzle) return;
      state.puzzle = puzzle;
      state.difficulty = progress.completed?.[puzzle.date] ? "normal" : progress.hardCompleted?.[puzzle.date] ? "hard" : "normal";
      restorePuzzleState(puzzle);
      if (state.screen === "complete") return renderSummary();
      renderIntro();
    });
  });
}

function renderStats() {
  const records = getPrimaryCompletedRecords();
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
        <div class="stat-card"><p class="eyebrow">Average Deviate</p><strong>${records.length ? formatScore(stats.average) : "n/a"}</strong><span>${records.length ? `${formatAccuracy(stats.averageAccuracy)} placement accuracy` : "complete a line"}</span></div>
      </div>
      <div class="section-heading"><h2>Deviate score distribution</h2><span class="muted-copy">${records.length} ${records.length === 1 ? "line" : "lines"}</span></div>
      ${records.length ? `<div class="distribution">${stats.distribution.map((bucket) => `<div class="distribution-row"><span>${bucket.label}</span><div class="distribution-bar"><span style="--bar-width:${bucket.width}%"></span></div><strong>${bucket.count}</strong></div>`).join("")}</div>` : `<div class="empty-card"><p>Your distribution will take shape after your first completed line.</p></div>`}
      ${stats.modeBreakdown.length ? `<div class="section-heading"><h2>By mode</h2><span class="muted-copy">Average score</span></div><div class="mode-stats">${stats.modeBreakdown.map((mode) => `<div class="mode-stat"><p class="eyebrow">${getModeLabel(mode.mode)}</p><strong>${formatScore(mode.average)}</strong><span>${mode.count} ${mode.count === 1 ? "line" : "lines"} · ${formatAccuracy(mode.averageAccuracy)}</span></div>`).join("")}</div>` : ""}
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
  const averageAccuracy = scores.length ? scores.reduce((sum, score) => sum + calculateAccuracy(score), 0) / scores.length : 0;
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
  const modeBreakdown = ["middle", "year", "age"].map((mode) => {
    const modeScores = records.filter((record) => record.mode === mode).map((record) => Number(record.score)).filter(Number.isFinite);
    if (!modeScores.length) return null;
    const modeAverage = modeScores.reduce((sum, score) => sum + score, 0) / modeScores.length;
    return { mode, count: modeScores.length, average: modeAverage, averageAccuracy: calculateAccuracy(modeAverage) };
  }).filter(Boolean);
  return { average, averageAccuracy, distribution, modeBreakdown, currentStreak: calculateStreak(dates, true), bestStreak: calculateStreak(dates, false) };
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

async function shareCurrentResult(includeAnswers = false) {
  const puzzle = state.puzzle || getDailyPuzzle();
  const puzzleLabel = getPuzzleLabel(puzzle);
  const record = getCompletionRecord(puzzle) || getCompletionRecord(puzzle, "normal") || progress.hardCompleted?.[puzzle?.date];
  if (!record) {
    const url = window.location.href.split("#")[0];
    await copyText(`${puzzleLabel} · a daily timeline game\n${url}`);
    return showToast("Link copied");
  }
  const glyphs = record.results.map((result) => result.direction === "bullseye" ? "◎" : result.direction === "left" ? "◀" : "▶").join(" ");
  const score = getRecordScore(record);
  const accuracy = calculateAccuracy(score);
  const shareText = [
    `${puzzleLabel} · ${formatDate(puzzle.date, { day: "numeric", month: "short", year: "numeric" })} · ${getModeLabel(puzzle.mode)}${record.difficulty === "hard" ? " · Hard mode" : ""}`,
    `Deviate score ${formatScore(score)}`,
    `Placement accuracy ${formatAccuracy(accuracy)}`,
    glyphs,
    ...(includeAnswers ? ["", "Answers", ...record.results.map((result, index) => formatSharedAnswer(result, puzzle.rounds[index], index))] : []),
    window.location.href.split("#")[0],
  ].join("\n");
  if (navigator.share) {
    try {
      await navigator.share({ title: `${puzzleLabel} ${includeAnswers ? "answers" : "result"}`, text: shareText });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyText(shareText);
  showToast(includeAnswers ? "Answers copied" : "Result copied");
}

function formatSharedAnswer(result, round, index) {
  const answerValue = round.mode === "age"
    ? `${formatValue(result.truth, round.mode)} at release`
    : `${formatValue(result.truth, round.mode)} release year`;
  const answer = `${round.target.name} · ${round.target.film} · answer: ${answerValue}`;
  if (round.mode === "middle") {
    const choice = result.optionName && result.optionFilm ? `${result.optionName} · ${result.optionFilm}` : "unknown choice";
    return `${String(index + 1).padStart(2, "0")}. ${answer} · your choice: ${choice}`;
  }
  return `${String(index + 1).padStart(2, "0")}. ${answer} · guessed: ${formatValue(result.guess, round.mode)}`;
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
    progress = normaliseProgress(imported);
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
  return value
    && typeof value === "object"
    && value.completed && typeof value.completed === "object" && !Array.isArray(value.completed)
    && value.inProgress && typeof value.inProgress === "object" && !Array.isArray(value.inProgress)
    && (value.hardCompleted === undefined || (value.hardCompleted && typeof value.hardCompleted === "object" && !Array.isArray(value.hardCompleted)))
    && (value.hardInProgress === undefined || (value.hardInProgress && typeof value.hardInProgress === "object" && !Array.isArray(value.hardInProgress)));
}

function saveInProgress() {
  const difficulty = normaliseDifficulty(state.difficulty, state.puzzle);
  const bucket = getInProgressBucket(difficulty);
  progress[bucket] = progress[bucket] || {};
  progress[bucket][state.puzzle.date] = {
    roundIndex: state.roundIndex,
    results: state.results,
    guess: state.guess,
    selectedOptionId: state.selectedOptionId,
    hardAnswer: difficulty === "hard" ? state.hardAnswer : "",
    difficulty,
    screen: state.screen,
    updatedAt: new Date().toISOString(),
  };
  writeProgress();
}

function readProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return normaliseProgress({
      completed: parsed.completed && typeof parsed.completed === "object" ? parsed.completed : {},
      inProgress: parsed.inProgress && typeof parsed.inProgress === "object" ? parsed.inProgress : {},
      hardCompleted: parsed.hardCompleted && typeof parsed.hardCompleted === "object" ? parsed.hardCompleted : {},
      hardInProgress: parsed.hardInProgress && typeof parsed.hardInProgress === "object" ? parsed.hardInProgress : {},
    });
  } catch (error) {
    return normaliseProgress({ completed: {}, inProgress: {} });
  }
}

function normaliseProgress(value) {
  return {
    completed: value.completed && typeof value.completed === "object" && !Array.isArray(value.completed) ? value.completed : {},
    inProgress: value.inProgress && typeof value.inProgress === "object" && !Array.isArray(value.inProgress) ? value.inProgress : {},
    hardCompleted: value.hardCompleted && typeof value.hardCompleted === "object" && !Array.isArray(value.hardCompleted) ? value.hardCompleted : {},
    hardInProgress: value.hardInProgress && typeof value.hardInProgress === "object" && !Array.isArray(value.hardInProgress) ? value.hardInProgress : {},
  };
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

function getSelectedOption(round) {
  return round.options?.find((option) => option.optionId === state.selectedOptionId) || null;
}

function normaliseAnswer(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findHardOption(round, answer) {
  const normalised = normaliseAnswer(answer);
  if (!normalised) return null;
  return round?.options?.find((option) => [option.name, option.film].some((value) => normaliseAnswer(value) === normalised)) || null;
}

function optionIndex(round, option) {
  const index = round.options?.findIndex((candidate) => candidate.optionId === option.optionId) ?? -1;
  return index >= 0 ? String.fromCharCode(65 + index) : "?";
}

function getModeLabel(mode) {
  if (mode === "year") return "Release year";
  if (mode === "age") return "Age at release";
  if (mode === "middle") return "Middle mode";
  return "Timeline";
}

function getRecordScore(record, results = []) {
  const storedScore = Number(record?.score);
  return Number.isFinite(storedScore) ? clamp(storedScore, 0, 100) : calculateScore(results);
}

function calculateScore(results) {
  if (!results.length) return 0;
  return (results.reduce((sum, result) => sum + Number(result.normalized || 0), 0) / results.length) * 100;
}

function calculateAccuracy(score) {
  return clamp(100 - Number(score), 0, 100);
}

function formatScore(score) {
  return Number(score).toFixed(1);
}

function formatAccuracy(accuracy) {
  return `${Number(accuracy).toFixed(1)}%`;
}

function formatValue(value, mode) {
  if (mode === "year" || mode === "middle") return `${Math.round(value)}`;
  return `${Number(value).toFixed(1)} yrs`;
}

function formatDistance(distance, mode) {
  return mode === "year" ? `${distance.toFixed(1)} years` : `${distance.toFixed(1)} years`;
}

function formatGender(gender) {
  if (gender === "F" || gender === "female") return "Woman";
  if (gender === "M" || gender === "male") return "Man";
  return "Actor";
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
