import { createCarousel } from "./modules/carousel.js";
import { applyVerseTextCleanup, buildWordFrequency, loadFootnoteRules } from "./modules/footnote_cleanup.js";

const DATA_URLS = Object.freeze([
  "../../data/lxxde_elb_bible_all.json",
  "./data/lxxde_elb_bible_all.json",
  "/data/lxxde_elb_bible_all.json",
  "/leseraum-github/public/data/lxxde_elb_bible_all.json",
]);
const FOOTNOTE_RULES_URLS = Object.freeze([
  "../../data/footnote_rules.json",
  "./data/footnote_rules.json",
  "/data/footnote_rules.json",
  "/leseraum-github/public/data/footnote_rules.json",
]);
const BASE_RING_CIRCUMFERENCE_FALLBACK = 2 * Math.PI * 21; // r=21
const BOOK_RING_CIRCUMFERENCE_FALLBACK = 2 * Math.PI * 25.5; // r=25.5
const BOOK_PROGRESS_SEGMENT_THRESHOLD = 50;
const BOOK_RING_RADIUS = 25.5;
const BOOK_RING_CENTER = 24;
const SVG_NS = "http://www.w3.org/2000/svg";
const READ_CHAPTERS_STORAGE_KEY = "lxxde_read_chapters_v1";
const VERSE_HIGHLIGHTS_STORAGE_KEY = "lxxde_verse_highlights_v1";
const VERSE_COMMENTS_STORAGE_KEY = "lxxde_verse_comments_v1";
const MARKER_DOUBLE_PRESS_WINDOW_MS = 340;
const HIGHLIGHT_LONG_PRESS_MS = 400;
const READING_MODE_WPM = 180;
const VERSE_HIGHLIGHT_COLORS = Object.freeze(["purple", "blue", "red"]);
const HIGHLIGHT_CYCLE_COLORS = Object.freeze(["", ...VERSE_HIGHLIGHT_COLORS]);
const VERSE_BROWSE_CYCLE_COLORS = Object.freeze(["purple", "blue", "red", ""]);
const VERSE_HIGHLIGHT_CLASS_NAMES = Object.freeze(
  VERSE_HIGHLIGHT_COLORS.map((color) => `is-highlight-${color}`),
);
const HIGHLIGHT_COLOR_LABELS = Object.freeze({
  "": "Aus",
  purple: "Lila",
  blue: "Blau",
  red: "Rot",
});
const LOCAL_TTS_ROOT = "/output/tts";
const LOCAL_TTS_FORMATS = Object.freeze(["wav", "mp3", "m4a"]);
const LOCAL_TTS_TIMING_SUFFIX = ".timing.json";
const HIGHLIGHT_QUERY_ALIASES = Object.freeze({
  purple: "purple",
  pruple: "purple",
  purble: "purple",
  lila: "purple",
  blue: "blue",
  blau: "blue",
  red: "red",
  rot: "red",
});

const state = {
  data: null,
  bookIndex: 1,
  chapter: 1,
  query: "",
  searchOpen: false,
  progressRatio: 0,
  isAtChapterEnd: false,
  readChapters: {},
  verseHighlights: {},
  verseComments: {},
  searchVerseRef: null,
  pendingVerseScroll: false,
  browseSession: null,
  activeHighlightColor: "",
  lastMarkerPressVerseKey: "",
  lastMarkerPressAt: 0,
  readingModeOpen: false,
  readingModeRunning: false,
  readingTimer: 0,
  readingTimerResolve: null,
  readingLoopToken: 0,
  readingVerseIndex: 0,
  ttsRootPath: LOCAL_TTS_ROOT,
  ttsAvailableUrlCache: {},
  ttsTimingCache: {},
  ttsCurrentAudioEl: null,
  ttsLastErrorAt: 0,
};

const ui = {
  headerEl: null,
  articleHostEl: null,
  bookCarousel: null,
  chapterCarousel: null,
  hoveredVerseEl: null,
  referenceVerseEl: null,
  readingVerseEl: null,
  readingWordEl: null,
  booksBound: false,
  chapterItemsBookIndex: null,
  searchTimer: 0,
  commentCardEl: null,
  commentCardVerseKey: "",
};

const readerEl = document.querySelector(".reader");
const versesEl = document.getElementById("verses");
const scrollTopEl = document.getElementById("scroll-top");
const progressRingSvgEl = document.querySelector(".progress-ring");
const progressRingEl = document.getElementById("progress-ring");
const progressBookFillEl = document.getElementById("progress-book-fill");
const progressBookSegmentsEl = document.getElementById("progress-book-segments");
const progressBookCurrentEl = document.getElementById("progress-book-current");
const readModePillEl = document.getElementById("read-mode-pill");
const readerStopEl = document.getElementById("reader-stop");
const searchPillEl = document.getElementById("search-pill");
const searchToggleEl = document.getElementById("search-toggle");
const searchInputEl = document.getElementById("search-input");
const highlightToggleEl = document.getElementById("highlight-toggle");
let baseRingCircumference = BASE_RING_CIRCUMFERENCE_FALLBACK;
let baseBookRingCircumference = BOOK_RING_CIRCUMFERENCE_FALLBACK;
let progressUpdateRaf = 0;
let footnoteRules = null;
let highlightLongPressTimer = 0;
let highlightLongPressTriggered = false;
let highlightSuppressNextClick = false;
let searchLongPressTimer = 0;
let searchLongPressTriggered = false;
let searchSuppressNextClick = false;
let commentSaveTimer = 0;
let marginNotesResizeTimer = 0;

function getCircleLength(circleEl, fallback) {
  if (!circleEl || typeof circleEl.getTotalLength !== "function") return fallback;
  try {
    const value = Number(circleEl.getTotalLength());
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function initializeProgressRings() {
  baseRingCircumference = getCircleLength(progressRingEl, BASE_RING_CIRCUMFERENCE_FALLBACK);
  if (progressRingEl) {
    progressRingEl.style.strokeDasharray = String(baseRingCircumference);
    progressRingEl.style.strokeDashoffset = String(baseRingCircumference);
  }

  baseBookRingCircumference = getCircleLength(progressBookFillEl, BOOK_RING_CIRCUMFERENCE_FALLBACK);
  if (progressBookFillEl) {
    progressBookFillEl.style.strokeDasharray = String(baseBookRingCircumference);
    progressBookFillEl.style.strokeDashoffset = String(baseBookRingCircumference);
  }
}

function getVerseText(verse) {
  if (typeof verse?.text_clean === "string") return verse.text_clean;
  if (typeof verse?.de_clean === "string") return verse.de_clean;
  if (typeof verse?.text === "string") return verse.text;
  if (typeof verse?.de === "string") return verse.de;
  return "";
}

function getBooks() {
  return state.data?.books ?? [];
}

function getBookByIndex(bookIndex) {
  return getBooks().find((book) => Number(book.book_index) === Number(bookIndex)) ?? null;
}

function getCurrentBook() {
  return getBookByIndex(state.bookIndex);
}

function getCurrentChapterData() {
  const book = getCurrentBook();
  if (!book) return null;
  return book.chapters.find((chapter) => Number(chapter.chapter) === Number(state.chapter)) ?? null;
}

function clampSelection() {
  const books = getBooks();
  if (!books.length) {
    state.bookIndex = 1;
    state.chapter = 1;
    return;
  }

  if (!books.some((book) => Number(book.book_index) === Number(state.bookIndex))) {
    state.bookIndex = Number(books[0].book_index);
  }

  const currentBook = getCurrentBook();
  if (!currentBook) return;

  const chapterNumbers = currentBook.chapters.map((c) => Number(c.chapter));
  if (!chapterNumbers.includes(Number(state.chapter))) {
    state.chapter = Number(chapterNumbers[0] || 1);
  }
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const book = Number(params.get("book"));
  const chapter = Number(params.get("chapter"));

  if (Number.isInteger(book) && book > 0) {
    state.bookIndex = book;
  }

  if (Number.isInteger(chapter) && chapter > 0) {
    state.chapter = chapter;
  }
}

function writeHash() {
  const params = new URLSearchParams();
  params.set("book", String(state.bookIndex));
  params.set("chapter", String(state.chapter));
  window.history.replaceState(null, "", `#${params.toString()}`);
}

function getChapterKey(bookIndex, chapter) {
  return `${Number(bookIndex)}:${Number(chapter)}`;
}

function getVerseKey(bookIndex, chapter, verse) {
  return `${Number(bookIndex)}:${Number(chapter)}:${Number(verse)}`;
}

function loadReadChapters() {
  try {
    const raw = window.localStorage.getItem(READ_CHAPTERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistReadChapters() {
  try {
    window.localStorage.setItem(READ_CHAPTERS_STORAGE_KEY, JSON.stringify(state.readChapters));
  } catch {
    // no-op (private mode/storage disabled)
  }
}

function normalizeHighlightToken(token) {
  const normalized = String(token ?? "").trim().toLowerCase();
  return HIGHLIGHT_QUERY_ALIASES[normalized] ?? null;
}

function loadVerseHighlights() {
  try {
    const raw = window.localStorage.getItem(VERSE_HIGHLIGHTS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const cleaned = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedColor = normalizeHighlightToken(value);
      if (!normalizedColor) continue;
      cleaned[key] = normalizedColor;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function persistVerseHighlights() {
  try {
    window.localStorage.setItem(VERSE_HIGHLIGHTS_STORAGE_KEY, JSON.stringify(state.verseHighlights));
  } catch {
    // no-op (private mode/storage disabled)
  }
}

function loadVerseComments() {
  try {
    const raw = window.localStorage.getItem(VERSE_COMMENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistVerseComments() {
  try {
    window.localStorage.setItem(VERSE_COMMENTS_STORAGE_KEY, JSON.stringify(state.verseComments));
  } catch {
    // no-op
  }
}

function getVerseComment(bookIndex, chapter, verse) {
  return state.verseComments[getVerseKey(bookIndex, chapter, verse)] ?? "";
}

function setVerseComment(bookIndex, chapter, verse, text) {
  const key = getVerseKey(bookIndex, chapter, verse);
  const trimmed = String(text ?? "").trim();

  if (!trimmed) {
    if (!state.verseComments[key]) return false;
    delete state.verseComments[key];
    persistVerseComments();
    return true;
  }

  if (state.verseComments[key] === trimmed) return false;
  state.verseComments[key] = trimmed;
  persistVerseComments();
  return true;
}

function getVerseHighlight(bookIndex, chapter, verse) {
  return state.verseHighlights[getVerseKey(bookIndex, chapter, verse)] ?? "";
}

function setVerseHighlight(bookIndex, chapter, verse, nextColor) {
  const key = getVerseKey(bookIndex, chapter, verse);
  const normalizedColor = normalizeHighlightToken(nextColor);

  if (!normalizedColor) {
    if (!state.verseHighlights[key]) return false;
    delete state.verseHighlights[key];
    persistVerseHighlights();
    syncHighlightToggleUi();
    return true;
  }

  if (state.verseHighlights[key] === normalizedColor) return false;
  state.verseHighlights[key] = normalizedColor;
  persistVerseHighlights();
  syncHighlightToggleUi();
  return true;
}

function isChapterRead(bookIndex, chapter) {
  return Boolean(state.readChapters[getChapterKey(bookIndex, chapter)]);
}

function unmarkChapterRead(bookIndex, chapter) {
  const key = getChapterKey(bookIndex, chapter);
  if (!state.readChapters[key]) return;
  delete state.readChapters[key];
  persistReadChapters();
}

function markChaptersFromStart(bookIndex, targetChapter) {
  const book = getBookByIndex(bookIndex);
  if (!book?.chapters?.length) return;

  const chapterLimit = Number(targetChapter);
  if (!Number.isInteger(chapterLimit) || chapterLimit <= 0) return;

  let changed = false;
  for (const chapterEntry of book.chapters) {
    const chapter = Number(chapterEntry.chapter);
    if (chapter > chapterLimit) continue;

    const key = getChapterKey(bookIndex, chapter);
    if (!state.readChapters[key]) {
      state.readChapters[key] = true;
      changed = true;
    }
  }

  if (changed) persistReadChapters();
}

function isBookRead(bookIndex) {
  const book = getBookByIndex(bookIndex);
  if (!book?.chapters?.length) return false;

  return book.chapters.every((chapter) => isChapterRead(bookIndex, Number(chapter.chapter)));
}

function normalizeBookToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseVerseSearchQuery(query) {
  const match = String(query ?? "")
    .trim()
    .match(/^([^,]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
  if (!match) return null;

  return {
    bookToken: match[1].trim(),
    chapter: Number(match[2]),
    verse: Number(match[3]),
  };
}

function resolveVerseSearchQuery(query) {
  const parsed = parseVerseSearchQuery(query);
  if (!parsed) return null;

  const targetBookToken = normalizeBookToken(parsed.bookToken);
  if (!targetBookToken) return null;

  const books = getBooks();
  if (!books.length) return null;

  let matchedBook =
    books.find((book) => normalizeBookToken(book.book) === targetBookToken) ??
    null;

  if (!matchedBook) {
    const startsWithMatches = books.filter((book) => normalizeBookToken(book.book).startsWith(targetBookToken));
    if (startsWithMatches.length === 1) {
      matchedBook = startsWithMatches[0];
    }
  }

  if (!matchedBook) return null;

  const chapterData =
    matchedBook.chapters.find((chapter) => Number(chapter.chapter) === parsed.chapter) ?? null;

  if (!chapterData) return null;

  const verseExists = chapterData.verses.some((verse) => Number(verse.verse) === parsed.verse);

  return {
    bookIndex: Number(matchedBook.book_index),
    chapter: parsed.chapter,
    verse: parsed.verse,
    verseExists,
  };
}

function getBrowseMode() {
  return String(state.browseSession?.mode ?? "");
}

function isBrowseModeActive() {
  return Boolean(getBrowseMode());
}

function isHighlightBrowseModeActive() {
  return getBrowseMode() === "highlight";
}

function isCommentBrowseModeActive() {
  return getBrowseMode() === "comments";
}

function isBrowseResultsView() {
  return Boolean(state.browseSession?.viewingResults);
}

function getBrowseColor() {
  if (!isHighlightBrowseModeActive()) return "";
  return state.browseSession?.color ?? "";
}

function getBrowseFilterText() {
  return String(state.browseSession?.filterText ?? "");
}

function setBrowseFilterText(value) {
  if (!state.browseSession) return;
  state.browseSession.filterText = String(value ?? "");
}

function setBrowseResultsScrollTop(value) {
  if (!state.browseSession) return;
  state.browseSession.resultsScrollTop = Math.max(0, Number(value) || 0);
}

function restoreVersesScrollTop(scrollTop) {
  const nextTop = Math.max(0, Number(scrollTop) || 0);
  requestAnimationFrame(() => {
    versesEl.scrollTop = nextTop;
    requestAnimationFrame(() => {
      versesEl.scrollTop = nextTop;
    });
  });
}

function openBrowseResults({ restoreScroll = true } = {}) {
  if (!state.browseSession) return false;

  state.browseSession.viewingResults = true;
  state.searchVerseRef = null;
  state.pendingVerseScroll = false;
  searchInputEl.value = getBrowseFilterText();
  setSearchOpen(true);
  refreshReaderView({ resetScroll: false });
  if (restoreScroll) {
    restoreVersesScrollTop(state.browseSession.resultsScrollTop);
  }
  return true;
}

function enterBrowseMode(color) {
  const normalized = normalizeHighlightToken(color);
  if (!normalized) return false;

  if (isCommentBrowseModeActive()) {
    exitBrowseMode();
  }

  stopReadingMode();
  state.browseSession = {
    mode: "highlight",
    color: normalized,
    filterText: "",
    resultsScrollTop: 0,
    viewingResults: true,
  };

  state.query = "";
  state.searchVerseRef = null;
  state.pendingVerseScroll = false;
  searchInputEl.value = "";
  setSearchOpen(true);
  refreshReaderView({ resetScroll: true });
  syncHighlightToggleUi();
  return true;
}

function enterCommentBrowseMode() {
  if (isCommentBrowseModeActive()) return false;

  if (isHighlightBrowseModeActive()) {
    exitBrowseMode();
  }

  stopReadingMode();
  state.browseSession = {
    mode: "comments",
    filterText: "",
    resultsScrollTop: 0,
    viewingResults: true,
  };

  state.query = "";
  state.searchVerseRef = null;
  state.pendingVerseScroll = false;
  searchInputEl.value = "";
  setSearchOpen(true);
  refreshReaderView({ resetScroll: true });
  syncHighlightToggleUi();
  return true;
}

function exitBrowseMode() {
  if (!state.browseSession) return false;

  state.browseSession = null;
  state.searchVerseRef = null;
  state.pendingVerseScroll = false;
  state.query = "";
  searchInputEl.value = "";
  setSearchOpen(false);
  refreshReaderView({ resetScroll: false });
  syncHighlightToggleUi();
  return true;
}

function canReturnToBrowseResults() {
  return isBrowseModeActive() && !isBrowseResultsView();
}

function navigateFromBrowseResultRow(rowEl) {
  const bookIndex = Number(rowEl?.dataset.bookIndex);
  const chapter = Number(rowEl?.dataset.chapter);
  const verse = Number(rowEl?.dataset.verse);
  if (!Number.isInteger(bookIndex) || !Number.isInteger(chapter) || !Number.isInteger(verse)) return false;
  if (!state.browseSession || !state.browseSession.viewingResults) return false;

  setBrowseResultsScrollTop(versesEl.scrollTop);
  state.browseSession.viewingResults = false;

  state.bookIndex = bookIndex;
  state.chapter = chapter;
  state.searchVerseRef = { bookIndex, chapter, verse, verseExists: true };
  state.pendingVerseScroll = true;

  setSearchOpen(false);
  writeHash();
  refreshReaderView({ resetScroll: true });
  return true;
}

/* ─── Toast ─── */

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  readerEl.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));

  setTimeout(() => {
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 1600);
}

/* ─── Search ─── */

function setSearchOpen(open) {
  state.searchOpen = open;
  searchPillEl.classList.toggle("open", open);

  if (open) {
    if (isBrowseModeActive()) {
      searchInputEl.value = getBrowseFilterText();
    }
    requestAnimationFrame(() => {
      searchInputEl.focus();
      searchInputEl.select();
    });
  } else {
    searchInputEl.blur();
    if (!isBrowseModeActive() && state.query) {
      state.query = "";
      state.searchVerseRef = null;
      state.pendingVerseScroll = false;
      searchInputEl.value = "";
      refreshReaderView({ resetScroll: false });
    }
  }

  syncBrowseUi();
  updateReadingModeUI();
}

/* ─── Progress ring ─── */

function updateProgress() {
  const maxScroll = Math.max(0, versesEl.scrollHeight - versesEl.clientHeight);
  const rawRatio = maxScroll <= 0 ? 0 : versesEl.scrollTop / maxScroll;
  const remaining = maxScroll - versesEl.scrollTop;
  const nearBottom = maxScroll > 0 && remaining <= 8;
  const progressRatio = Math.max(0, Math.min(1, nearBottom ? 1 : rawRatio));
  state.progressRatio = progressRatio;
  state.isAtChapterEnd = maxScroll <= 0 || nearBottom || progressRatio >= 0.995;

  const offset = baseRingCircumference * (1 - progressRatio);
  if (progressRingEl) {
    progressRingEl.style.strokeDashoffset = String(offset);
  }
  updateReadingModeUI();
}

function scheduleProgressUpdate() {
  if (progressUpdateRaf) return;
  progressUpdateRaf = requestAnimationFrame(() => {
    progressUpdateRaf = 0;
    updateProgress();
  });
}

function updateReadIndicators() {
  const bookItems = ui.bookCarousel?.el.querySelectorAll(".carousel-item") ?? [];
  for (const item of bookItems) {
    const bookIndex = Number(item.dataset.value);
    item.classList.toggle("is-read", isBookRead(bookIndex));
  }

  const chapterItems = ui.chapterCarousel?.el.querySelectorAll(".carousel-item") ?? [];
  for (const item of chapterItems) {
    const chapter = Number(item.dataset.value);
    item.classList.toggle("is-read", isChapterRead(state.bookIndex, chapter));
  }

  updateBookProgressRing();
}

function getCurrentBookChapterNumbers() {
  const book = getCurrentBook();
  if (!book?.chapters?.length) return [];

  return book.chapters
    .map((chapter) => Number(chapter.chapter))
    .filter((chapter) => Number.isInteger(chapter) && chapter > 0)
    .sort((a, b) => a - b);
}

function getReadChapterCount(bookIndex, chapterNumbers) {
  let count = 0;
  for (const chapter of chapterNumbers) {
    if (isChapterRead(bookIndex, chapter)) count += 1;
  }
  return count;
}

function toArcPoint(radius, angleRad) {
  return {
    x: BOOK_RING_CENTER + radius * Math.cos(angleRad),
    y: BOOK_RING_CENTER + radius * Math.sin(angleRad),
  };
}

function describeArcPath(radius, startAngleRad, endAngleRad) {
  const sweep = Math.max(0, endAngleRad - startAngleRad);
  if (sweep <= 1e-4) return "";

  const start = toArcPoint(radius, startAngleRad);
  const end = toArcPoint(radius, endAngleRad);
  const largeArcFlag = sweep > Math.PI ? 1 : 0;

  return [
    "M",
    start.x.toFixed(3),
    start.y.toFixed(3),
    "A",
    String(radius),
    String(radius),
    "0",
    String(largeArcFlag),
    "1",
    end.x.toFixed(3),
    end.y.toFixed(3),
  ].join(" ");
}

function renderSegmentedBookRing(chapterNumbers) {
  if (!progressBookSegmentsEl) return;

  const total = chapterNumbers.length;
  const fullSweep = Math.PI * 2;
  const segmentSweep = total > 0 ? fullSweep / total : fullSweep;
  const gapSweep = 0.25;
  const currentChapter = Number(state.chapter);
  const segmentEls = [];
  const fragment = document.createDocumentFragment();

  for (let idx = 0; idx < total; idx += 1) {
    const chapter = chapterNumbers[idx];
    const start = -Math.PI / 2 + idx * segmentSweep + gapSweep / 2;
    const end = -Math.PI / 2 + (idx + 1) * segmentSweep - gapSweep / 2;
    if (end <= start) continue;

    const segmentEl = document.createElementNS(SVG_NS, "path");
    segmentEl.classList.add("progress-book-segment");
    segmentEl.classList.add(isChapterRead(state.bookIndex, chapter) ? "is-read" : "is-unread");
    if (chapter === currentChapter) {
      segmentEl.classList.add("is-current");
    }

    const path = describeArcPath(BOOK_RING_RADIUS, start, end);
    segmentEl.setAttribute("d", path);

    const segmentLength = Math.max(1, (end - start) * BOOK_RING_RADIUS);
    segmentEl.style.strokeDasharray = String(segmentLength);
    segmentEl.style.strokeDashoffset = String(segmentLength);
    segmentEl.style.transitionDelay = `${Math.min(320, idx * 7)}ms`;
    fragment.appendChild(segmentEl);
    segmentEls.push(segmentEl);
  }

  progressBookSegmentsEl.replaceChildren(fragment);
  if (progressBookCurrentEl) {
    progressBookCurrentEl.setAttribute("d", "");
  }

  requestAnimationFrame(() => {
    for (const segmentEl of segmentEls) {
      segmentEl.style.strokeDashoffset = "0";
    }
  });
}

function renderDenseBookRing(chapterNumbers, readCount) {
  if (!progressBookFillEl) return;

  const total = chapterNumbers.length;
  const ratio = total > 0 ? Math.max(0, Math.min(1, readCount / total)) : 0;
  progressBookFillEl.style.strokeDashoffset = String(baseBookRingCircumference * (1 - ratio));

  if (progressBookCurrentEl) {
    progressBookCurrentEl.setAttribute("d", "");
  }
}

function updateBookProgressRing() {
  if (!progressRingSvgEl || !progressBookFillEl || !progressBookSegmentsEl || !progressBookCurrentEl) return;

  const chapterNumbers = getCurrentBookChapterNumbers();
  const totalChapters = chapterNumbers.length;
  const readCount = getReadChapterCount(state.bookIndex, chapterNumbers);
  const segmented = totalChapters > 0 && totalChapters <= BOOK_PROGRESS_SEGMENT_THRESHOLD;

  progressRingSvgEl.classList.toggle("is-book-segmented", segmented);
  progressRingSvgEl.classList.toggle("is-book-dense", !segmented);

  if (segmented) {
    progressBookFillEl.style.strokeDashoffset = String(baseBookRingCircumference);
    renderSegmentedBookRing(chapterNumbers);
    return;
  }

  progressBookSegmentsEl.replaceChildren();
  renderDenseBookRing(chapterNumbers, readCount);
}

/* ─── Search and filtering ─── */

function filterVerses(verses) {
  if (!state.query) return verses;
  if (parseVerseSearchQuery(state.query)) return verses;
  if (state.query.startsWith("/")) return verses;
  const needle = state.query.toLowerCase();
  return verses.filter((verse) => getVerseText(verse).toLowerCase().includes(needle));
}

function appendVerseTextTokens(segment, text, needle = "") {
  const tokens = String(text).match(/\s+|\S+/g) ?? [];
  const normalizedNeedle = needle.trim().toLowerCase();

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      segment.appendChild(document.createTextNode(token));
      continue;
    }

    const word = document.createElement("span");
    word.className = "word-token";
    word.dataset.raw = token;
    word.textContent = token;

    if (normalizedNeedle && token.toLowerCase().includes(normalizedNeedle)) {
      word.classList.add("search-highlight-token");
    }

    segment.appendChild(word);
  }
}

function applyVerseHighlightClass(segment, color) {
  segment.classList.remove(...VERSE_HIGHLIGHT_CLASS_NAMES);
  if (!color) {
    delete segment.dataset.highlightColor;
    return;
  }

  segment.classList.add(`is-highlight-${color}`);
  segment.dataset.highlightColor = color;
}

function getColorSearchResults(color, { textFilter = "" } = {}) {
  const normalizedColor = normalizeHighlightToken(color);
  if (!normalizedColor) return [];
  const normalizedTextFilter = String(textFilter ?? "").trim().toLowerCase();

  const results = [];
  for (const book of getBooks()) {
    const bookIndex = Number(book.book_index);
    const bookName = String(book.book ?? "");

    for (const chapterEntry of book.chapters ?? []) {
      const chapter = Number(chapterEntry.chapter);
      for (const verseEntry of chapterEntry.verses ?? []) {
        const verse = Number(verseEntry.verse);
        if (getVerseHighlight(bookIndex, chapter, verse) !== normalizedColor) continue;
        const verseText = getVerseText(verseEntry).trim();
        if (normalizedTextFilter && !verseText.toLowerCase().includes(normalizedTextFilter)) continue;

        results.push({
          bookIndex,
          bookName,
          chapter,
          verse,
          text: verseText,
        });
      }
    }
  }

  return results;
}

function getCommentSearchResults({ textFilter = "" } = {}) {
  const normalizedTextFilter = String(textFilter ?? "").trim().toLowerCase();
  const results = [];

  for (const book of getBooks()) {
    const bookIndex = Number(book.book_index);
    const bookName = String(book.book ?? "");

    for (const chapterEntry of book.chapters ?? []) {
      const chapter = Number(chapterEntry.chapter);
      for (const verseEntry of chapterEntry.verses ?? []) {
        const verse = Number(verseEntry.verse);
        const commentText = getVerseComment(bookIndex, chapter, verse).trim();
        if (!commentText) continue;

        const verseText = getVerseText(verseEntry).trim();
        if (normalizedTextFilter) {
          const inComment = commentText.toLowerCase().includes(normalizedTextFilter);
          const inVerse = verseText.toLowerCase().includes(normalizedTextFilter);
          if (!inComment && !inVerse) continue;
        }

        results.push({
          bookIndex,
          bookName,
          chapter,
          verse,
          commentText,
          verseText,
        });
      }
    }
  }

  return results;
}

function appendHighlightedText(container, text, needle = "") {
  const source = String(text ?? "");
  const normalizedNeedle = String(needle ?? "").trim();
  if (!normalizedNeedle) {
    container.textContent = source;
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerNeedle = normalizedNeedle.toLowerCase();

  let cursor = 0;
  while (cursor < source.length) {
    const hitIndex = lowerSource.indexOf(lowerNeedle, cursor);
    if (hitIndex < 0) {
      container.appendChild(document.createTextNode(source.slice(cursor)));
      break;
    }

    if (hitIndex > cursor) {
      container.appendChild(document.createTextNode(source.slice(cursor, hitIndex)));
    }

    const mark = document.createElement("mark");
    mark.className = "search-highlight";
    mark.textContent = source.slice(hitIndex, hitIndex + lowerNeedle.length);
    container.appendChild(mark);
    cursor = hitIndex + lowerNeedle.length;
  }
}

/* ─── DOM building ─── */

function createParagraph() {
  const p = document.createElement("p");
  p.className = "reading-paragraph";
  return p;
}

function createVerseSegmentNode({ bookIndex, chapter, verse, text, textSearchNeedle = "" }) {
  const segment = document.createElement("span");
  segment.className = "verse-segment";
  segment.dataset.bookIndex = String(bookIndex);
  segment.dataset.chapter = String(chapter);
  segment.dataset.verse = String(verse);
  segment.dataset.text = String(text ?? "").trim();

  const markerWrap = document.createElement("span");
  markerWrap.className = "verse-marker-wrap";

  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = "verse-marker-button";
  marker.setAttribute("aria-label", `Vers ${String(verse)} hervorheben`);
  marker.textContent = String(verse);
  if (Number(verse) === 1) {
    markerWrap.classList.add("is-first-verse-marker");
    marker.classList.add("is-first-verse");
  }
  markerWrap.appendChild(marker);
  segment.appendChild(markerWrap);
  appendVerseTextTokens(segment, ` ${segment.dataset.text}`, textSearchNeedle);
  applyVerseHighlightClass(segment, getVerseHighlight(bookIndex, chapter, Number(verse)));
  if (getVerseComment(bookIndex, chapter, Number(verse))) {
    segment.classList.add("has-comment");
  }
  return segment;
}

function buildReadingArticle(verses) {
  const article = document.createElement("article");
  article.className = "reading-article enter-fade";
  const hasVerseRefQuery = Boolean(parseVerseSearchQuery(state.query));
  const textSearchNeedle =
    state.query && !hasVerseRefQuery && !state.query.startsWith("/")
      ? state.query
      : "";

  let paragraph = createParagraph();
  let paragraphIndex = 0;

  verses.forEach((verse, idx) => {
    if (idx > 0 && idx % 4 === 0) {
      paragraph.style.animationDelay = `${paragraphIndex * 60}ms`;
      article.appendChild(paragraph);
      paragraph = createParagraph();
      paragraphIndex += 1;
    }

    const segment = createVerseSegmentNode({
      bookIndex: state.bookIndex,
      chapter: state.chapter,
      verse: Number(verse.verse),
      text: getVerseText(verse),
      textSearchNeedle,
    });

    paragraph.appendChild(segment);
    paragraph.appendChild(document.createTextNode(" "));
  });

  if (paragraph.childNodes.length > 0) {
    paragraph.style.animationDelay = `${paragraphIndex * 60}ms`;
    article.appendChild(paragraph);
  }

  requestAnimationFrame(() => {
    article.classList.remove("enter-fade");
  });

  return article;
}

function buildColorSearchArticle(results) {
  const article = document.createElement("article");
  article.className = "reading-article search-results-article enter-fade";

  results.forEach((result, idx) => {
    const row = document.createElement("p");
    row.className = "search-result-row";
    row.style.animationDelay = `${idx * 26}ms`;
    row.dataset.bookIndex = String(result.bookIndex);
    row.dataset.chapter = String(result.chapter);
    row.dataset.verse = String(result.verse);
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    const ref = document.createElement("span");
    ref.className = "search-result-ref";
    ref.textContent = `${result.bookName} ${result.chapter},${result.verse}`;
    row.appendChild(ref);

    const segment = createVerseSegmentNode({
      bookIndex: result.bookIndex,
      chapter: result.chapter,
      verse: result.verse,
      text: result.text,
      textSearchNeedle: getBrowseFilterText(),
    });
    row.appendChild(segment);
    article.appendChild(row);
  });

  requestAnimationFrame(() => {
    article.classList.remove("enter-fade");
  });

  return article;
}

function buildCommentSearchArticle(results) {
  const article = document.createElement("article");
  article.className = "reading-article search-results-article enter-fade";
  const textNeedle = getBrowseFilterText();

  results.forEach((result, idx) => {
    const row = document.createElement("p");
    row.className = "search-result-row comment-result-row";
    row.style.animationDelay = `${idx * 26}ms`;
    row.dataset.bookIndex = String(result.bookIndex);
    row.dataset.chapter = String(result.chapter);
    row.dataset.verse = String(result.verse);
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    const ref = document.createElement("span");
    ref.className = "search-result-ref";
    ref.textContent = `${result.bookName} ${result.chapter},${result.verse}`;

    const commentPreview = document.createElement("span");
    commentPreview.className = "comment-result-preview";
    appendHighlightedText(commentPreview, result.commentText, textNeedle);

    const versePreview = document.createElement("span");
    versePreview.className = "comment-result-verse-text";
    appendHighlightedText(versePreview, result.verseText, textNeedle);

    row.append(ref, commentPreview, versePreview);
    article.appendChild(row);
  });

  requestAnimationFrame(() => {
    article.classList.remove("enter-fade");
  });

  return article;
}

function renderMessage(message) {
  ui.articleHostEl.innerHTML = "";
  const msg = document.createElement("p");
  msg.className = "empty-state";
  msg.textContent = message;
  ui.articleHostEl.appendChild(msg);
}

function setHoveredVerse(segment) {
  if (ui.hoveredVerseEl === segment) return;
  ui.hoveredVerseEl?.classList.remove("is-hovered");
  ui.hoveredVerseEl = segment;
  ui.hoveredVerseEl?.classList.add("is-hovered");
}

function clearReferenceVerse() {
  ui.referenceVerseEl?.classList.remove("is-reference-hit");
  ui.referenceVerseEl = null;
}

function setReferenceVerse(segment) {
  if (ui.referenceVerseEl === segment) return;
  clearReferenceVerse();
  ui.referenceVerseEl = segment;
  ui.referenceVerseEl?.classList.add("is-reference-hit");
}

function pulseReferenceVerse(segment) {
  if (!segment) return;
  segment.classList.remove("is-reference-pulse");
  // Force style recalculation so repeated jumps retrigger the animation.
  void segment.offsetWidth;
  segment.classList.add("is-reference-pulse");
  segment.addEventListener(
    "animationend",
    () => {
      segment.classList.remove("is-reference-pulse");
    },
    { once: true },
  );
}

function resetMarkerPressTracking() {
  state.lastMarkerPressVerseKey = "";
  state.lastMarkerPressAt = 0;
}

function getNextHighlightCycleColor(color) {
  const normalized = color ? normalizeHighlightToken(color) : "";
  const currentIndex = Math.max(0, HIGHLIGHT_CYCLE_COLORS.indexOf(normalized ?? ""));
  const nextIndex = (currentIndex + 1) % HIGHLIGHT_CYCLE_COLORS.length;
  return HIGHLIGHT_CYCLE_COLORS[nextIndex];
}

function getNextBrowseVerseCycleColor(color) {
  const normalized = color ? normalizeHighlightToken(color) : "";
  const currentIndex = Math.max(0, VERSE_BROWSE_CYCLE_COLORS.indexOf(normalized ?? ""));
  const nextIndex = (currentIndex + 1) % VERSE_BROWSE_CYCLE_COLORS.length;
  return VERSE_BROWSE_CYCLE_COLORS[nextIndex];
}

function pulseHighlightToggle() {
  highlightToggleEl.classList.remove("is-browse-pulse");
  void highlightToggleEl.offsetWidth;
  highlightToggleEl.classList.add("is-browse-pulse");
  highlightToggleEl.addEventListener(
    "animationend",
    () => {
      highlightToggleEl.classList.remove("is-browse-pulse");
    },
    { once: true },
  );
}

function pulseSearchToggle() {
  searchPillEl.classList.remove("is-browse-pulse");
  void searchPillEl.offsetWidth;
  searchPillEl.classList.add("is-browse-pulse");
  searchPillEl.addEventListener(
    "animationend",
    () => {
      searchPillEl.classList.remove("is-browse-pulse");
    },
    { once: true },
  );
}

function syncBrowseUi() {
  const browseMode = getBrowseMode();
  const highlightBrowse = browseMode === "highlight";
  const commentBrowse = browseMode === "comments";
  const browseColor = getBrowseColor();

  highlightToggleEl.classList.toggle("is-browse-mode", highlightBrowse);
  highlightToggleEl.classList.toggle("is-comment-browse", commentBrowse);
  searchPillEl.classList.toggle("is-browse-mode", highlightBrowse);
  searchPillEl.classList.toggle("is-comment-browse", commentBrowse);

  if (highlightBrowse) {
    highlightToggleEl.dataset.browseColor = browseColor;
    searchPillEl.dataset.browseColor = browseColor;
    searchToggleEl.setAttribute("aria-label", "Suche");
    searchInputEl.placeholder = "In Markierungen suchen...";
  } else if (commentBrowse) {
    delete highlightToggleEl.dataset.browseColor;
    delete searchPillEl.dataset.browseColor;
    searchToggleEl.setAttribute("aria-label", "Kommentare durchsuchen");
    searchInputEl.placeholder = "In Notizen suchen...";
  } else {
    delete highlightToggleEl.dataset.browseColor;
    delete searchPillEl.dataset.browseColor;
    searchToggleEl.setAttribute("aria-label", "Suche");
    searchInputEl.placeholder = "Textsuche";
  }
}

function syncHighlightToggleUi() {
  const color = state.activeHighlightColor || "";
  if (color) {
    highlightToggleEl.dataset.activeColor = color;
  } else {
    delete highlightToggleEl.dataset.activeColor;
  }

  const label = HIGHLIGHT_COLOR_LABELS[color] ?? HIGHLIGHT_COLOR_LABELS[""];
  const highlightBrowseActive = isHighlightBrowseModeActive();
  const commentBrowseActive = isCommentBrowseModeActive();
  if (highlightBrowseActive) {
    highlightToggleEl.setAttribute("aria-label", `Markierungen durchsuchen: ${label}. Tippen zum Beenden`);
    highlightToggleEl.setAttribute("title", `Markierungen durchsuchen: ${label}`);
  } else if (commentBrowseActive) {
    highlightToggleEl.setAttribute("aria-label", "Kommentarsuche beenden");
    highlightToggleEl.setAttribute("title", "Kommentarsuche beenden");
  } else {
    highlightToggleEl.setAttribute("aria-label", `Markierungsfarbe: ${label}. Tippen zum Wechseln, lang drücken zum Durchsuchen`);
    highlightToggleEl.setAttribute("title", `Markierungsfarbe: ${label}`);
  }

  syncBrowseUi();
  updateReadingModeUI();
}

function setActiveHighlightColor(color) {
  state.activeHighlightColor = color ? normalizeHighlightToken(color) ?? "" : "";
  syncHighlightToggleUi();
}

function cycleActiveHighlightColor() {
  setActiveHighlightColor(getNextHighlightCycleColor(state.activeHighlightColor));
}

function handleVerseMarkerPress(markerButtonEl) {
  const segmentEl = markerButtonEl.closest(".verse-segment");
  if (!segmentEl) return;

  const bookIndex = Number(segmentEl.dataset.bookIndex);
  const chapter = Number(segmentEl.dataset.chapter);
  const verse = Number(segmentEl.dataset.verse);

  if (isHighlightBrowseModeActive() && !isBrowseResultsView()) {
    const currentColor = getVerseHighlight(bookIndex, chapter, verse);
    const nextColor = getNextBrowseVerseCycleColor(currentColor);
    const changed = setVerseHighlight(bookIndex, chapter, verse, nextColor);
    if (changed) {
      applyVerseHighlightClass(segmentEl, nextColor);
    }
    resetMarkerPressTracking();
    return;
  }

  // If a highlight color is active, apply it.
  if (state.activeHighlightColor) {
    const color = state.activeHighlightColor;
    const changed = setVerseHighlight(bookIndex, chapter, verse, color);
    if (changed) {
      applyVerseHighlightClass(segmentEl, color);
    }
    resetMarkerPressTracking();
    return;
  }

  // Double-press to remove highlight
  const verseKey = getVerseKey(bookIndex, chapter, verse);
  const now = performance.now();
  const isDoublePress =
    state.lastMarkerPressVerseKey === verseKey && now - state.lastMarkerPressAt <= MARKER_DOUBLE_PRESS_WINDOW_MS;

  state.lastMarkerPressVerseKey = verseKey;
  state.lastMarkerPressAt = now;

  if (isDoublePress) {
    const changed = setVerseHighlight(bookIndex, chapter, verse, "");
    if (changed) {
      applyVerseHighlightClass(segmentEl, "");
    }
    resetMarkerPressTracking();
  }
}

function handleVerseSegmentPress(segmentEl) {
  if (!segmentEl || !ui.articleHostEl?.contains(segmentEl)) return;
  resetMarkerPressTracking();
  if (state.readingModeRunning) return;
  if (isBrowseResultsView()) return;
  openCommentCard(segmentEl);
}

function normalizeTtsRootPath(path) {
  const trimmed = String(path ?? "").trim();
  if (!trimmed) return LOCAL_TTS_ROOT;
  return trimmed.replace(/\/+$/, "");
}

function getBookNameForSegment(segment) {
  const bookIndex = Number(segment?.dataset.bookIndex);
  const book = getBookByIndex(bookIndex);
  return String(book?.book ?? "").trim();
}

function getChapterAudioFolderCandidates(bookName, chapter) {
  const base = String(bookName ?? "").trim();
  const chapterNumber = Number(chapter);
  if (!base || !Number.isInteger(chapterNumber) || chapterNumber <= 0) return [];

  const deaccented = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const variants = [
    base,
    base.replace(/\//g, "_"),
    base.replace(/\s+/g, "_"),
    base.replace(/[\\/]/g, "_").replace(/\s+/g, "_"),
    deaccented,
    deaccented.replace(/\//g, "_"),
    deaccented.replace(/\s+/g, "_"),
    deaccented.replace(/[\\/]/g, "_").replace(/\s+/g, "_"),
  ];

  const folders = [];
  for (const variant of variants) {
    const normalized = variant.trim();
    if (!normalized) continue;
    const folder = `${normalized}_${chapterNumber}`;
    if (!folders.includes(folder)) {
      folders.push(folder);
    }
  }

  return folders;
}

function getVerseAudioBasenames(verse) {
  const verseNumber = Number(verse);
  if (!Number.isInteger(verseNumber) || verseNumber <= 0) return [];
  const padded = String(verseNumber).padStart(3, "0");
  if (padded === String(verseNumber)) return [padded];
  return [padded, String(verseNumber)];
}

function getLocalTtsAudioCandidates(segment) {
  const root = normalizeTtsRootPath(state.ttsRootPath);
  const bookName = getBookNameForSegment(segment);
  const chapter = Number(segment?.dataset.chapter);
  const verse = Number(segment?.dataset.verse);
  if (!bookName || !Number.isInteger(chapter) || !Number.isInteger(verse)) return [];

  const folders = getChapterAudioFolderCandidates(bookName, chapter);
  const basenames = getVerseAudioBasenames(verse);
  if (!folders.length || !basenames.length) return [];

  const urls = [];
  for (const folder of folders) {
    const encodedFolder = folder
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");

    for (const basename of basenames) {
      for (const ext of LOCAL_TTS_FORMATS) {
        urls.push(`${root}/${encodedFolder}/${encodeURIComponent(`${basename}.${ext}`)}`);
      }
    }
  }

  return urls;
}

async function hasLocalTtsFile(url) {
  if (Object.prototype.hasOwnProperty.call(state.ttsAvailableUrlCache, url)) {
    return Boolean(state.ttsAvailableUrlCache[url]);
  }

  try {
    const response = await fetch(url, { method: "HEAD", cache: "force-cache" });
    const ok = response.ok;
    state.ttsAvailableUrlCache[url] = ok;
    return ok;
  } catch {
    state.ttsAvailableUrlCache[url] = false;
    return false;
  }
}

async function resolveLocalTtsAudioUrl(segment) {
  const candidates = getLocalTtsAudioCandidates(segment);
  for (const candidate of candidates) {
    if (await hasLocalTtsFile(candidate)) {
      return candidate;
    }
  }
  return "";
}

function showTtsErrorToast(error) {
  const now = Date.now();
  if (now - state.ttsLastErrorAt < 6000) return;
  state.ttsLastErrorAt = now;

  const msg = error instanceof Error ? error.message : String(error ?? "Unbekannter Fehler");
  showToast(`TTS Fehler: ${msg.slice(0, 88)}`);
}

function stopActiveTtsAudio() {
  if (!state.ttsCurrentAudioEl) return;

  try {
    state.ttsCurrentAudioEl.pause();
    state.ttsCurrentAudioEl.src = "";
    state.ttsCurrentAudioEl.load();
  } catch {
    // no-op
  }

  state.ttsCurrentAudioEl = null;
  clearReadingWordHighlight();
}

function clearReadingWordHighlight() {
  ui.readingWordEl?.classList.remove("is-reading-word");
  ui.readingWordEl = null;
}

function setReadingWordHighlight(wordEl) {
  if (ui.readingWordEl !== wordEl) {
    ui.readingWordEl?.classList.remove("is-reading-word");
    ui.readingWordEl = wordEl;
    ui.readingWordEl?.classList.add("is-reading-word");
  }
}

function getLocalTtsTimingCandidates(audioUrl) {
  const url = String(audioUrl ?? "").trim();
  if (!url) return [];

  const queryIndex = url.indexOf("?");
  const hashIndex = url.indexOf("#");
  let suffixStart = url.length;
  if (queryIndex >= 0) suffixStart = Math.min(suffixStart, queryIndex);
  if (hashIndex >= 0) suffixStart = Math.min(suffixStart, hashIndex);

  const pathOnly = url.slice(0, suffixStart);
  const urlSuffix = url.slice(suffixStart);
  const extensionIndex = pathOnly.lastIndexOf(".");
  const lastSlash = pathOnly.lastIndexOf("/");
  if (extensionIndex <= lastSlash) {
    return [`${pathOnly}${LOCAL_TTS_TIMING_SUFFIX}${urlSuffix}`];
  }

  const withoutExt = pathOnly.slice(0, extensionIndex);
  return [`${withoutExt}${LOCAL_TTS_TIMING_SUFFIX}${urlSuffix}`];
}

async function resolveLocalTtsTimingPayload(audioUrl) {
  if (Object.prototype.hasOwnProperty.call(state.ttsTimingCache, audioUrl)) {
    return state.ttsTimingCache[audioUrl];
  }

  const candidates = getLocalTtsTimingCandidates(audioUrl);
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "force-cache" });
      if (!response.ok) continue;
      const payload = await response.json();
      state.ttsTimingCache[audioUrl] = payload;
      return payload;
    } catch {
      // no-op
    }
  }

  state.ttsTimingCache[audioUrl] = null;
  return null;
}

function sanitizeTimingTrack(track, durationHint = 0) {
  const maxDuration = Number.isFinite(durationHint) && durationHint > 0 ? durationHint : 0;
  const rows = [];
  let cursor = 0;

  for (let index = 0; index < track.length; index += 1) {
    const row = track[index];
    const rawStart = Number(row?.start);
    const rawEnd = Number(row?.end);
    let start = Number.isFinite(rawStart) ? rawStart : cursor;
    let end = Number.isFinite(rawEnd) ? rawEnd : start;

    start = Math.max(0, start);
    end = Math.max(start, end);

    if (start < cursor) {
      start = cursor;
      end = Math.max(start, end);
    }

    if (maxDuration > 0) {
      start = Math.min(start, maxDuration);
      end = Math.min(Math.max(start, end), maxDuration);
    }

    rows.push({ start, end });
    cursor = end;
  }

  return rows;
}

function getWordTokenWeight(wordEl) {
  const raw = String(wordEl?.dataset?.raw ?? wordEl?.textContent ?? "").trim();
  if (!raw) return 1;
  const normalized = raw.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");
  return Math.max(1, normalized.length || raw.length);
}

function buildEstimatedTimingTrack(wordEls, durationSeconds) {
  if (!wordEls.length) return [];
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (duration <= 0) {
    return wordEls.map(() => ({ start: 0, end: 0 }));
  }

  const weights = wordEls.map(getWordTokenWeight);
  const totalWeight = Math.max(1, weights.reduce((sum, value) => sum + value, 0));

  let cursor = 0;
  const rows = [];
  for (let index = 0; index < wordEls.length; index += 1) {
    if (index === wordEls.length - 1) {
      rows.push({ start: cursor, end: duration });
      break;
    }

    const nextCursor = cursor + (duration * weights[index]) / totalWeight;
    rows.push({ start: cursor, end: nextCursor });
    cursor = nextCursor;
  }

  return sanitizeTimingTrack(rows, duration);
}

function buildTimingTrackFromPayload(payload, wordEls) {
  if (!payload || !wordEls.length) return [];
  const rawWords = Array.isArray(payload.words) ? payload.words : [];
  if (!rawWords.length) return [];

  const durationHint = Number(payload.audio_seconds);
  if (rawWords.length !== wordEls.length) {
    return buildEstimatedTimingTrack(wordEls, durationHint);
  }

  const mapped = rawWords.map((word) => ({
    start: Number(word?.start),
    end: Number(word?.end),
  }));
  return sanitizeTimingTrack(mapped, durationHint);
}

function getActiveWordIndex(timingTrack, currentSeconds) {
  if (!timingTrack.length) return -1;
  const current = Number(currentSeconds);
  if (!Number.isFinite(current) || current < 0) return -1;

  for (let index = 0; index < timingTrack.length; index += 1) {
    const row = timingTrack[index];
    if (current >= row.start && current < row.end) {
      return index;
    }
  }

  if (current >= timingTrack[timingTrack.length - 1].end) {
    return timingTrack.length - 1;
  }
  return -1;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function playTtsAudioUrl(audioUrl, segment, loopToken) {
  const url = String(audioUrl ?? "").trim();
  if (!url) throw new Error("Keine lokale Audio-Datei gefunden.");

  const audioEl = new Audio(url);
  audioEl.preload = "auto";
  state.ttsCurrentAudioEl = audioEl;
  const wordEls = getWordTokens(segment);
  const timingPayload = await resolveLocalTtsTimingPayload(url);
  let timingTrack = buildTimingTrackFromPayload(timingPayload, wordEls);
  let activeWordIndex = -1;
  let playbackError = null;
  const startedAt = performance.now();

  audioEl.addEventListener(
    "error",
    () => {
      playbackError = new Error("Lokale TTS Audio-Datei konnte nicht abgespielt werden.");
    },
    { once: true },
  );

  try {
    await audioEl.play();
    while (state.readingModeRunning && state.readingLoopToken === loopToken && !audioEl.ended) {
      if (playbackError) throw playbackError;
      if (performance.now() - startedAt > 180000) {
        throw new Error("TTS Audio Timeout.");
      }

      if (!timingTrack.length && wordEls.length && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        timingTrack = buildEstimatedTimingTrack(wordEls, audioEl.duration);
      }

      if (timingTrack.length && wordEls.length) {
        const nextIndex = getActiveWordIndex(timingTrack, audioEl.currentTime);
        if (nextIndex !== activeWordIndex) {
          activeWordIndex = nextIndex;
          if (nextIndex >= 0 && nextIndex < wordEls.length) {
            setReadingWordHighlight(wordEls[nextIndex]);
          } else {
            clearReadingWordHighlight();
          }
        }
      }

      await sleep(80);
    }
  } finally {
    clearReadingWordHighlight();
    if (state.ttsCurrentAudioEl === audioEl) {
      state.ttsCurrentAudioEl = null;
    }
    audioEl.pause();
    audioEl.src = "";
    audioEl.load();
  }
}

async function trySpeakVerseSegment(segment, loopToken) {
  const audioUrl = await resolveLocalTtsAudioUrl(segment);
  if (!audioUrl) return false;

  try {
    await playTtsAudioUrl(audioUrl, segment, loopToken);
    return true;
  } catch (error) {
    showTtsErrorToast(error);
    return false;
  }
}

function getReadableVerseSegments() {
  return [...(ui.articleHostEl?.querySelectorAll(".verse-segment") ?? [])];
}

function getWordTokens(segment) {
  return [...(segment?.querySelectorAll(".word-token") ?? [])];
}

function getCurrentReadingVerseIndex() {
  const segments = getReadableVerseSegments();
  if (!segments.length) return -1;

  if (hasActiveReadingCursor()) {
    const indexFromCursor = segments.indexOf(ui.readingVerseEl);
    if (indexFromCursor >= 0) return indexFromCursor;
  }

  if (!Number.isInteger(state.readingVerseIndex)) return 0;
  return Math.max(0, Math.min(state.readingVerseIndex, segments.length - 1));
}

function getFirstVisibleVerseIndex() {
  const segments = getReadableVerseSegments();
  if (!segments.length) return -1;

  const containerRect = versesEl.getBoundingClientRect();
  const thresholdTop = containerRect.top + 56;

  for (let index = 0; index < segments.length; index += 1) {
    const rect = segments[index].getBoundingClientRect();
    if (rect.bottom >= thresholdTop) {
      return index;
    }
  }

  return segments.length - 1;
}

function clearReadingHighlight() {
  ui.readingVerseEl?.classList.remove("is-reading-current");
  ui.readingVerseEl = null;
  clearReadingWordHighlight();
}

function setReadingHighlight(segment) {
  if (ui.readingVerseEl !== segment) {
    ui.readingVerseEl?.classList.remove("is-reading-current");
    ui.readingVerseEl = segment;
    ui.readingVerseEl?.classList.add("is-reading-current");
  }
}

function clearReadingTimer() {
  if (state.readingTimer) {
    window.clearTimeout(state.readingTimer);
    state.readingTimer = 0;
  }

  if (typeof state.readingTimerResolve === "function") {
    const resolve = state.readingTimerResolve;
    state.readingTimerResolve = null;
    resolve();
  }
}

function waitForReadingDelay(ms) {
  clearReadingTimer();
  return new Promise((resolve) => {
    state.readingTimerResolve = () => {
      state.readingTimerResolve = null;
      resolve();
    };

    state.readingTimer = window.setTimeout(() => {
      state.readingTimer = 0;
      state.readingTimerResolve?.();
    }, Math.max(0, ms));
  });
}

function isAtTopOfChapter() {
  return state.progressRatio <= 0.001;
}

function isAtEndOfChapter() {
  return state.isAtChapterEnd;
}

function hasActiveReadingCursor() {
  return Boolean(ui.readingVerseEl && ui.articleHostEl?.contains(ui.readingVerseEl));
}

function updateReadingModeUI() {
  if (!readModePillEl) return;
  const atTop = isAtTopOfChapter();
  const atEnd = isAtEndOfChapter();
  const hasReadCursor = hasActiveReadingCursor();
  const canReturnBrowse = canReturnToBrowseResults() && !state.searchOpen;
  const returnBrowseLabel = isCommentBrowseModeActive()
    ? "Zur Kommentarliste zurückkehren"
    : "Zur Markierungsliste zurückkehren";
  if (!atTop && state.readingModeOpen && !state.readingModeRunning && !hasReadCursor) {
    state.readingModeOpen = false;
  }

  readModePillEl.classList.toggle("open", state.readingModeOpen);
  readModePillEl.classList.toggle("at-start", atTop);
  readModePillEl.classList.toggle("at-end", atEnd);
  readModePillEl.classList.toggle("is-running", state.readingModeRunning);
  readModePillEl.classList.toggle("has-cursor", hasReadCursor);
  readModePillEl.classList.toggle("can-return-search", canReturnBrowse);

  if (readerStopEl) readerStopEl.disabled = !state.readingModeRunning && !hasReadCursor;
  if (scrollTopEl) {
    const label = state.readingModeRunning
      ? "Lesemodus pausieren"
      : canReturnBrowse
        ? returnBrowseLabel
      : hasReadCursor && state.readingModeOpen
        ? "Lesemodus fortsetzen"
      : atEnd
        ? "Nächstes Kapitel"
      : hasReadCursor
          ? "Zur Lesestelle"
        : atTop
          ? "Lesemodus starten"
          : "Nach oben";
    if (scrollTopEl.getAttribute("aria-label") !== label) {
      scrollTopEl.setAttribute("aria-label", label);
    }
  }
}

function scrollToCurrentReadVerse() {
  if (!hasActiveReadingCursor()) return false;
  const segment = ui.readingVerseEl;
  segment.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

function skipReadingVerse(step) {
  const delta = Number(step);
  if (!Number.isInteger(delta) || delta === 0) return false;

  const segments = getReadableVerseSegments();
  if (!segments.length) return false;

  const maxIndex = segments.length - 1;
  const currentIndex = getCurrentReadingVerseIndex();
  if (currentIndex < 0) return false;

  const targetIndex = currentIndex + delta;
  if (targetIndex < 0) {
    return false;
  }
  if (targetIndex > maxIndex) {
    stopReadingMode();
    setReadingModeOpen(false);
    return false;
  }
  if (targetIndex === currentIndex) return false;

  const shouldResumePlayback = state.readingModeRunning;
  if (shouldResumePlayback) {
    pauseReadingMode();
  }

  state.readingVerseIndex = targetIndex;
  const didApply = applyReadingCursor({ scrollIntoView: true });
  updateReadingModeUI();
  if (!didApply) return false;

  if (shouldResumePlayback) {
    startReadingMode();
  }
  return true;
}

function setReadingModeOpen(open) {
  const next = Boolean(open);
  if (state.readingModeOpen === next) return;
  state.readingModeOpen = next;
  if (!next && state.readingModeRunning) {
    pauseReadingMode();
  }
  updateReadingModeUI();
}

function applyReadingCursor({ scrollIntoView = false } = {}) {
  const segments = getReadableVerseSegments();
  if (!segments.length) {
    clearReadingHighlight();
    return false;
  }

  state.readingVerseIndex = Math.max(0, state.readingVerseIndex);

  if (state.readingVerseIndex >= segments.length) {
    clearReadingHighlight();
    return false;
  }

  const segment = segments[state.readingVerseIndex];
  setReadingHighlight(segment);

  if (scrollIntoView) {
    segment.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return true;
}

function stopReadingMode({ resetCursor = true } = {}) {
  state.readingLoopToken += 1;
  clearReadingTimer();
  stopActiveTtsAudio();
  state.readingModeRunning = false;
  clearReadingHighlight();

  if (resetCursor) {
    state.readingVerseIndex = 0;
  }

  updateReadingModeUI();
}

function getVerseReadingDelay(segment) {
  const wordCount = getWordTokens(segment).length || 1;
  return Math.max(400, Math.round((wordCount / READING_MODE_WPM) * 60000));
}

function pauseReadingMode() {
  state.readingLoopToken += 1;
  clearReadingTimer();
  stopActiveTtsAudio();
  state.readingModeRunning = false;
  updateReadingModeUI();
}

async function runReadingModeLoop(loopToken) {
  while (state.readingModeRunning && state.readingLoopToken === loopToken) {
    if (!applyReadingCursor({ scrollIntoView: true })) {
      stopReadingMode();
      return;
    }

    const segments = getReadableVerseSegments();
    const segment = segments[state.readingVerseIndex];
    if (!segment) {
      stopReadingMode();
      return;
    }

    const usedTts = await trySpeakVerseSegment(segment, loopToken);
    if (!state.readingModeRunning || state.readingLoopToken !== loopToken) return;

    if (!usedTts) {
      await waitForReadingDelay(getVerseReadingDelay(segment));
      if (!state.readingModeRunning || state.readingLoopToken !== loopToken) return;
    }

    state.readingVerseIndex += 1;
    if (state.readingVerseIndex >= segments.length) {
      stopReadingMode();
      return;
    }
  }
}

function startReadingMode() {
  if (isCommentBrowseModeActive()) return;

  const segments = getReadableVerseSegments();
  if (!segments.length) return;

  if (!hasActiveReadingCursor()) {
    const firstVisibleIndex = getFirstVisibleVerseIndex();
    state.readingVerseIndex = firstVisibleIndex >= 0 ? firstVisibleIndex : 0;
  }

  state.readingModeOpen = true;
  state.readingModeRunning = true;
  updateReadingModeUI();

  if (!applyReadingCursor({ scrollIntoView: true })) {
    stopReadingMode();
    return;
  }

  state.readingLoopToken += 1;
  const loopToken = state.readingLoopToken;
  runReadingModeLoop(loopToken).catch((error) => {
    showTtsErrorToast(error);
    stopReadingMode({ resetCursor: false });
  });
}

function syncActiveVerseSelectionAfterRender() {
  setHoveredVerse(null);

  if (
    state.searchVerseRef &&
    state.searchVerseRef.bookIndex === state.bookIndex &&
    state.searchVerseRef.chapter === state.chapter
  ) {
    const referenceSegment = ui.articleHostEl?.querySelector(
      `.verse-segment[data-verse="${String(state.searchVerseRef.verse)}"]`,
    );

    if (referenceSegment) {
      setReferenceVerse(referenceSegment);

      if (state.pendingVerseScroll) {
        referenceSegment.scrollIntoView({ behavior: "smooth", block: "center" });
        pulseReferenceVerse(referenceSegment);
      }
    } else {
      clearReferenceVerse();
    }
  } else {
    clearReferenceVerse();
  }

  state.pendingVerseScroll = false;
}

/* ─── Margin Notes ─── */

function clearMarginNotes() {
  const existing = ui.articleHostEl?.querySelector(".margin-notes-host");
  if (existing) existing.remove();
}

function renderMarginNotes() {
  clearMarginNotes();
  if (!ui.articleHostEl) return;

  const segments = ui.articleHostEl.querySelectorAll(".verse-segment");
  if (!segments.length) return;

  const notes = [];
  for (const seg of segments) {
    const bookIndex = Number(seg.dataset.bookIndex);
    const chapter = Number(seg.dataset.chapter);
    const verse = Number(seg.dataset.verse);
    const comment = getVerseComment(bookIndex, chapter, verse);
    if (!comment) continue;
    notes.push({ seg, verse, comment, key: getVerseKey(bookIndex, chapter, verse) });
  }

  if (!notes.length) return;

  const host = document.createElement("div");
  host.className = "margin-notes-host";
  ui.articleHostEl.appendChild(host);

  const hostRect = ui.articleHostEl.getBoundingClientRect();
  const noteEls = [];

  for (const note of notes) {
    const el = document.createElement("div");
    el.className = "margin-note";
    el.dataset.verseKey = note.key;

    const ref = document.createElement("span");
    ref.className = "margin-note-ref";
    ref.textContent = String(note.verse);

    const text = document.createElement("span");
    text.className = "margin-note-text";
    text.textContent = note.comment;

    el.appendChild(ref);
    el.appendChild(text);
    host.appendChild(el);

    const segRect = note.seg.getBoundingClientRect();
    const rawTop = segRect.top - hostRect.top;
    noteEls.push({ el, rawTop });
  }

  // collision pass
  const gap = 8;
  let lastBottom = -Infinity;
  for (const item of noteEls) {
    let top = item.rawTop;
    if (top < lastBottom + gap) {
      top = lastBottom + gap;
    }
    item.el.style.top = `${top}px`;
    lastBottom = top + item.el.offsetHeight;
  }

  // clicking a margin note opens the comment card for that verse
  host.addEventListener("click", (e) => {
    const noteEl = e.target.closest(".margin-note");
    if (!noteEl) return;
    const key = noteEl.dataset.verseKey;
    if (!key) return;
    const parts = key.split(":");
    const seg = ui.articleHostEl.querySelector(
      `.verse-segment[data-book-index="${parts[0]}"][data-chapter="${parts[1]}"][data-verse="${parts[2]}"]`,
    );
    if (seg) openCommentCard(seg);
  });
}

/* ─── Comment Card ─── */

function closeCommentCard({ flush = true } = {}) {
  if (!ui.commentCardEl) return;

  if (flush && commentSaveTimer) {
    window.clearTimeout(commentSaveTimer);
    commentSaveTimer = 0;
    const textarea = ui.commentCardEl.querySelector(".comment-card-input");
    if (textarea && ui.commentCardVerseKey) {
      const parts = ui.commentCardVerseKey.split(":").map(Number);
      setVerseComment(parts[0], parts[1], parts[2], textarea.value);
    }
  }

  const card = ui.commentCardEl;
  card.classList.add("closing");
  card.addEventListener("transitionend", () => card.remove(), { once: true });
  setTimeout(() => { if (card.parentNode) card.remove(); }, 200);

  ui.commentCardEl = null;
  ui.commentCardVerseKey = "";

  // refresh indicators and margin notes
  refreshCommentVisuals();
}

function refreshCommentVisuals() {
  const segments = ui.articleHostEl?.querySelectorAll(".verse-segment") ?? [];
  for (const seg of segments) {
    const bookIndex = Number(seg.dataset.bookIndex);
    const chapter = Number(seg.dataset.chapter);
    const verse = Number(seg.dataset.verse);
    seg.classList.toggle("has-comment", Boolean(getVerseComment(bookIndex, chapter, verse)));
  }
  renderMarginNotes();
}

function openCommentCard(segmentEl) {
  closeCommentCard({ flush: true });

  const bookIndex = Number(segmentEl.dataset.bookIndex);
  const chapter = Number(segmentEl.dataset.chapter);
  const verse = Number(segmentEl.dataset.verse);
  const verseKey = getVerseKey(bookIndex, chapter, verse);
  const existing = getVerseComment(bookIndex, chapter, verse);

  const card = document.createElement("div");
  card.className = "comment-card";

  const header = document.createElement("div");
  header.className = "comment-card-header";

  const refLabel = document.createElement("span");
  refLabel.className = "comment-card-ref";
  refLabel.textContent = `Vers ${verse}`;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "comment-card-delete";
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  deleteBtn.setAttribute("aria-label", "Kommentar löschen");

  header.appendChild(refLabel);
  header.appendChild(deleteBtn);

  const textarea = document.createElement("textarea");
  textarea.className = "comment-card-input";
  textarea.placeholder = "Notiz schreiben\u2026";
  textarea.value = existing;
  textarea.rows = 3;

  card.appendChild(header);
  card.appendChild(textarea);

  // Position the card
  ui.articleHostEl.appendChild(card);

  const hostRect = ui.articleHostEl.getBoundingClientRect();
  const segRect = segmentEl.getBoundingClientRect();
  let top = segRect.top - hostRect.top;

  // Place to the right of the content area
  const articleEl = ui.articleHostEl.querySelector(".reading-article");
  if (articleEl) {
    const articleRect = articleEl.getBoundingClientRect();
    const rightEdge = articleRect.right - hostRect.left;
    card.style.left = `${rightEdge + 20}px`;
  } else {
    card.style.left = `calc(50% + 360px)`;
  }

  // Prevent overflowing below viewport
  const maxTop = Math.max(0, hostRect.height - card.offsetHeight - 16);
  top = Math.min(top, maxTop);
  card.style.top = `${top}px`;

  ui.commentCardEl = card;
  ui.commentCardVerseKey = verseKey;

  requestAnimationFrame(() => {
    card.classList.add("visible");
    textarea.focus();
  });

  // Auto-grow textarea
  const autoGrow = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  };
  if (existing) autoGrow();

  textarea.addEventListener("input", () => {
    autoGrow();
    window.clearTimeout(commentSaveTimer);
    commentSaveTimer = window.setTimeout(() => {
      commentSaveTimer = 0;
      setVerseComment(bookIndex, chapter, verse, textarea.value);
      refreshCommentVisuals();
    }, 500);
  });

  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setVerseComment(bookIndex, chapter, verse, "");
    closeCommentCard({ flush: false });
  });

  // Escape closes card
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeCommentCard({ flush: true });
      window.removeEventListener("keydown", onKeyDown, true);
    }
  };
  window.addEventListener("keydown", onKeyDown, true);

  // Click outside closes card
  const onClickOutside = (e) => {
    if (!card.contains(e.target)) {
      closeCommentCard({ flush: true });
      document.removeEventListener("pointerdown", onClickOutside, true);
    }
  };
  // Delay to avoid catching the current click
  setTimeout(() => {
    document.addEventListener("pointerdown", onClickOutside, true);
  }, 0);
}

function ensureLayout() {
  if (ui.headerEl && ui.articleHostEl) return;

  ui.headerEl = document.createElement("header");
  ui.headerEl.className = "chapter-heading";

  ui.bookCarousel = createCarousel({
    className: "book-carousel",
    onCommit: (value) => {
      const newIndex = Number(value);
      if (newIndex === Number(state.bookIndex)) return;

      state.bookIndex = newIndex;
      state.chapter = 1;
      writeHash();
      refreshReaderView({ resetScroll: true });
    },
  });

  ui.chapterCarousel = createCarousel({
    className: "chapter-carousel",
    onCommit: (value) => {
      const newChapter = Number(value);
      if (newChapter === Number(state.chapter)) return;

      state.chapter = newChapter;
      writeHash();
      refreshReaderView({ resetScroll: true });
    },
  });

  ui.chapterCarousel.el.addEventListener("dblclick", (event) => {
    const item = event.target.closest(".carousel-item");
    if (!item) return;

    const chapter = Number(item.dataset.value);
    if (chapter !== Number(state.chapter)) return;

    if (isChapterRead(state.bookIndex, chapter)) {
      unmarkChapterRead(state.bookIndex, chapter);
    } else {
      markChaptersFromStart(state.bookIndex, chapter);
    }
    updateReadIndicators();
  });

  ui.headerEl.append(ui.bookCarousel.el, ui.chapterCarousel.el);

  ui.articleHostEl = document.createElement("div");
  ui.articleHostEl.className = "article-host";

  versesEl.innerHTML = "";
  versesEl.append(ui.headerEl, ui.articleHostEl);
}

function syncCarousels() {
  ensureLayout();

  if (!ui.booksBound) {
    const bookItems = getBooks().map((book) => ({
      label: book.book,
      value: String(book.book_index),
    }));
    ui.bookCarousel.setItems(bookItems);
    ui.booksBound = true;
  }

  ui.bookCarousel.scrollToValue(String(state.bookIndex), "auto");

  if (ui.chapterItemsBookIndex !== Number(state.bookIndex)) {
    const currentBook = getCurrentBook();
    const chapterItems = (currentBook?.chapters ?? []).map((chapter) => ({
      label: String(chapter.chapter),
      value: String(chapter.chapter),
    }));

    ui.chapterCarousel.setItems(chapterItems);
    ui.chapterItemsBookIndex = Number(state.bookIndex);
  }

  ui.chapterCarousel.scrollToValue(String(state.chapter), "auto");
  updateReadIndicators();
}

/* ─── Navigation helpers ─── */

function goToAdjacentChapter(direction) {
  const books = getBooks();
  if (!books.length) return false;

  const bookPos = books.findIndex((book) => Number(book.book_index) === Number(state.bookIndex));
  if (bookPos < 0) return false;

  const currentBook = books[bookPos];
  const chapterNumbers = currentBook.chapters.map((chapter) => Number(chapter.chapter)).sort((a, b) => a - b);
  const chapterPos = chapterNumbers.findIndex((value) => value === Number(state.chapter));
  if (chapterPos < 0) return false;

  if (direction < 0) {
    if (chapterPos > 0) {
      state.chapter = chapterNumbers[chapterPos - 1];
      return true;
    }
    if (bookPos > 0) {
      const prevBook = books[bookPos - 1];
      const prevChapters = prevBook.chapters.map((chapter) => Number(chapter.chapter)).sort((a, b) => a - b);
      state.bookIndex = Number(prevBook.book_index);
      state.chapter = prevChapters[prevChapters.length - 1] || 1;
      return true;
    }
    return false;
  }

  if (chapterPos < chapterNumbers.length - 1) {
    state.chapter = chapterNumbers[chapterPos + 1];
    return true;
  }

  if (bookPos < books.length - 1) {
    const nextBook = books[bookPos + 1];
    const nextChapters = nextBook.chapters.map((chapter) => Number(chapter.chapter)).sort((a, b) => a - b);
    state.bookIndex = Number(nextBook.book_index);
    state.chapter = nextChapters[0] || 1;
    return true;
  }

  return false;
}

/* ─── Main render ─── */

function refreshUI({
  resetScroll = false,
  resetMarkerTracking = false,
  stopReadingPlayback = false,
} = {}) {
  closeCommentCard({ flush: true });
  if (resetMarkerTracking) {
    resetMarkerPressTracking();
  }
  if (stopReadingPlayback) {
    stopReadingMode();
  }
  clampSelection();
  ensureLayout();
  syncCarousels();

  if (isBrowseModeActive() && isBrowseResultsView()) {
    let hasAnyResults = true;
    let browseResults = [];

    if (isCommentBrowseModeActive()) {
      const allCommentResults = getCommentSearchResults();
      browseResults = getCommentSearchResults({ textFilter: getBrowseFilterText() });
      hasAnyResults = allCommentResults.length > 0;
    } else {
      browseResults = getColorSearchResults(getBrowseColor(), { textFilter: getBrowseFilterText() });
    }

    if (!browseResults.length) {
      renderMessage(hasAnyResults ? "Keine Treffer." : "Keine Kommentare vorhanden.");
      syncActiveVerseSelectionAfterRender();
      if (resetScroll) {
        versesEl.scrollTop = 0;
        setBrowseResultsScrollTop(0);
      }
      updateProgress();
      return;
    }

    ui.articleHostEl.innerHTML = "";
    if (isCommentBrowseModeActive()) {
      ui.articleHostEl.appendChild(buildCommentSearchArticle(browseResults));
    } else {
      ui.articleHostEl.appendChild(buildColorSearchArticle(browseResults));
    }
    syncActiveVerseSelectionAfterRender();

    if (resetScroll) {
      versesEl.scrollTop = 0;
      setBrowseResultsScrollTop(0);
    }

    updateProgress();
    return;
  }

  const chapterData = getCurrentChapterData();
  if (!chapterData || !Array.isArray(chapterData.verses)) {
    renderMessage("Kapitel nicht verfügbar.");
    syncActiveVerseSelectionAfterRender();
    return;
  }

  const filtered = filterVerses(chapterData.verses);
  if (!filtered.length) {
    renderMessage("Keine Treffer.");
    syncActiveVerseSelectionAfterRender();
    return;
  }

  ui.articleHostEl.innerHTML = "";
  ui.articleHostEl.appendChild(buildReadingArticle(filtered));
  syncActiveVerseSelectionAfterRender();

  if (resetScroll) {
    versesEl.scrollTop = 0;
  }

  updateProgress();

  requestAnimationFrame(() => {
    renderMarginNotes();
  });
}

function refreshReaderView({ resetScroll = false } = {}) {
  refreshUI({
    resetScroll,
    resetMarkerTracking: true,
    stopReadingPlayback: true,
  });
}

/* ─── Data loading ─── */

async function loadData() {
  if (!footnoteRules) {
    footnoteRules = await loadFootnoteRulesWithFallback(FOOTNOTE_RULES_URLS);
  }

  const data = await loadDatasetWithFallback(DATA_URLS);
  if (!Array.isArray(data?.books) || !data.books.length) {
    throw new Error("Dataset ist leer oder ungültig.");
  }

  const wordFrequency = buildWordFrequency(data);
  applyVerseTextCleanup(data, { wordFrequency, rules: footnoteRules });
  state.data = data;
}

async function loadFootnoteRulesWithFallback(urls) {
  let lastError = "Footnote-Regeln konnten nicht geladen werden.";
  for (const url of urls) {
    try {
      return await loadFootnoteRules(url);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

async function loadDatasetWithFallback(urls) {
  let lastError = "Dataset konnte nicht geladen werden.";
  let lastStatus = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastStatus = res.status;
        lastError = `Dataset konnte nicht geladen werden (${res.status}).`;
        continue;
      }
      return await res.json();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (lastStatus !== null) {
    throw new Error(`Dataset konnte nicht geladen werden (${lastStatus}).`);
  }
  throw new Error(lastError);
}

/* ─── Events ─── */

function setupEvents() {
  versesEl.addEventListener("scroll", () => {
    if (isBrowseModeActive() && isBrowseResultsView()) {
      setBrowseResultsScrollTop(versesEl.scrollTop);
    }
    scheduleProgressUpdate();
  }, { passive: true });

  versesEl.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") {
        return;
      }

      if (state.searchOpen) {
        setHoveredVerse(null);
        return;
      }

      const segment = event.target.closest(".verse-segment");
      if (!segment || !ui.articleHostEl?.contains(segment)) {
        setHoveredVerse(null);
        return;
      }

      setHoveredVerse(segment);
    },
    { passive: true },
  );

  versesEl.addEventListener("pointerleave", () => {
    setHoveredVerse(null);
  });

  versesEl.addEventListener("click", (event) => {
    const markerButton = event.target.closest(".verse-marker-button");
    if (markerButton && ui.articleHostEl?.contains(markerButton)) {
      event.preventDefault();
      event.stopPropagation();
      const markerResultRow = markerButton.closest(".search-result-row");
      if (markerResultRow && ui.articleHostEl?.contains(markerResultRow)) {
        navigateFromBrowseResultRow(markerResultRow);
        return;
      }
      handleVerseMarkerPress(markerButton);
      return;
    }

    const resultRow = event.target.closest(".search-result-row");
    if (resultRow && ui.articleHostEl?.contains(resultRow)) {
      event.preventDefault();
      event.stopPropagation();
      navigateFromBrowseResultRow(resultRow);
      return;
    }

    const segment = event.target.closest(".verse-segment");
    if (segment && ui.articleHostEl?.contains(segment)) {
      handleVerseSegmentPress(segment);
    }
  });

  versesEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const resultRow = event.target.closest(".search-result-row");
    if (!resultRow || !ui.articleHostEl?.contains(resultRow)) return;
    event.preventDefault();
    event.stopPropagation();
    navigateFromBrowseResultRow(resultRow);
  });

  highlightToggleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (isHighlightBrowseModeActive()) return;
    if (!state.activeHighlightColor) return;

    highlightLongPressTriggered = false;
    window.clearTimeout(highlightLongPressTimer);
    highlightLongPressTimer = window.setTimeout(() => {
      highlightLongPressTriggered = true;
      highlightSuppressNextClick = true;
      pulseHighlightToggle();
      if (isCommentBrowseModeActive()) {
        exitBrowseMode();
      }
      enterBrowseMode(state.activeHighlightColor);
    }, HIGHLIGHT_LONG_PRESS_MS);
  });

  const cancelHighlightLongPress = () => {
    window.clearTimeout(highlightLongPressTimer);
    highlightLongPressTimer = 0;
  };
  highlightToggleEl.addEventListener("pointerup", cancelHighlightLongPress);
  highlightToggleEl.addEventListener("pointercancel", cancelHighlightLongPress);
  highlightToggleEl.addEventListener("pointerleave", cancelHighlightLongPress);

  highlightToggleEl.addEventListener("click", (event) => {
    event.stopPropagation();
    cancelHighlightLongPress();

    if (highlightSuppressNextClick || highlightLongPressTriggered) {
      highlightSuppressNextClick = false;
      highlightLongPressTriggered = false;
      return;
    }

    if (isBrowseModeActive()) {
      exitBrowseMode();
      return;
    }

    cycleActiveHighlightColor();
  });

  searchToggleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (isCommentBrowseModeActive()) return;

    searchLongPressTriggered = false;
    window.clearTimeout(searchLongPressTimer);
    searchLongPressTimer = window.setTimeout(() => {
      searchLongPressTriggered = true;
      searchSuppressNextClick = true;
      pulseSearchToggle();
      if (isHighlightBrowseModeActive()) {
        exitBrowseMode();
      }
      enterCommentBrowseMode();
    }, HIGHLIGHT_LONG_PRESS_MS);
  });

  const cancelSearchLongPress = () => {
    window.clearTimeout(searchLongPressTimer);
    searchLongPressTimer = 0;
  };
  searchToggleEl.addEventListener("pointerup", cancelSearchLongPress);
  searchToggleEl.addEventListener("pointercancel", cancelSearchLongPress);
  searchToggleEl.addEventListener("pointerleave", cancelSearchLongPress);

  scrollTopEl.addEventListener("click", (event) => {
    event.stopPropagation();
    const hasReadCursor = hasActiveReadingCursor();

    if (state.readingModeRunning) {
      pauseReadingMode();
      return;
    }

    if (canReturnToBrowseResults()) {
      openBrowseResults({ restoreScroll: true });
      return;
    }

    if (isCommentBrowseModeActive()) {
      return;
    }

    if (hasReadCursor) {
      if (!state.readingModeOpen) {
        scrollToCurrentReadVerse();
        setReadingModeOpen(true);
        return;
      }

      startReadingMode();
      return;
    }

    if (isAtEndOfChapter()) {
      const moved = goToAdjacentChapter(1);
      if (moved) {
        writeHash();
        refreshReaderView({ resetScroll: true });
      } else {
        showToast("Letztes Kapitel erreicht");
      }
      return;
    }

    if (!isAtTopOfChapter()) {
      if (state.readingModeOpen) {
        setReadingModeOpen(false);
      }
      versesEl.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!state.readingModeOpen) {
      setReadingModeOpen(true);
      startReadingMode();
      return;
    }

    startReadingMode();
  });

  readerStopEl?.addEventListener("click", (event) => {
    event.stopPropagation();
    stopReadingMode();
    setReadingModeOpen(false);
  });

  searchToggleEl.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelSearchLongPress();

    if (searchSuppressNextClick || searchLongPressTriggered) {
      searchSuppressNextClick = false;
      searchLongPressTriggered = false;
      return;
    }

    if (isCommentBrowseModeActive()) {
      if (!state.searchOpen || !isBrowseResultsView()) {
        openBrowseResults({ restoreScroll: true });
      } else {
        exitBrowseMode();
      }
      return;
    }

    if (isHighlightBrowseModeActive()) {
      if (!state.searchOpen || !isBrowseResultsView()) {
        openBrowseResults({ restoreScroll: true });
      } else {
        setSearchOpen(false);
      }
      return;
    }

    setSearchOpen(!state.searchOpen);
  });

  searchInputEl.addEventListener("input", () => {
    const inputValue = searchInputEl.value;

    if (isBrowseModeActive()) {
      setBrowseFilterText(inputValue);
      if (isBrowseResultsView()) {
        setBrowseResultsScrollTop(0);
        refreshReaderView({ resetScroll: true });
      }
      return;
    }

    state.query = inputValue.trim();
    clearTimeout(ui.searchTimer);
    ui.searchTimer = window.setTimeout(() => {
      if (state.query.startsWith("/")) {
        return;
      }

      const verseTarget = resolveVerseSearchQuery(state.query);
      if (verseTarget) {
        const chapterChanged =
          Number(state.bookIndex) !== verseTarget.bookIndex || Number(state.chapter) !== verseTarget.chapter;

        state.bookIndex = verseTarget.bookIndex;
        state.chapter = verseTarget.chapter;
        state.searchVerseRef = verseTarget;
        state.pendingVerseScroll = verseTarget.verseExists;
        writeHash();
        refreshReaderView({ resetScroll: chapterChanged });
        return;
      }

      state.searchVerseRef = null;
      state.pendingVerseScroll = false;
      refreshReaderView({ resetScroll: true });
    }, 80);
  });

  searchInputEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const value = searchInputEl.value.trim();
    if (!value.startsWith("/")) return;

    event.preventDefault();

    const ttsRootMatch = value.match(/^\/ttsroot\s+(.+)$/i);
    if (ttsRootMatch) {
      state.ttsRootPath = normalizeTtsRootPath(ttsRootMatch[1]);
      state.ttsAvailableUrlCache = {};
      state.ttsTimingCache = {};
      searchInputEl.value = "";
      if (!isBrowseModeActive()) {
        state.query = "";
      } else {
        setBrowseFilterText("");
      }
      setSearchOpen(false);
      showToast(`TTS Pfad gesetzt: ${state.ttsRootPath}`);
      return;
    }

    if (isBrowseModeActive()) {
      return;
    }

    searchInputEl.value = "";
    state.query = "";
    showToast("Unbekannter Befehl");
  });

  document.addEventListener("click", (event) => {
    if (state.searchOpen && !searchPillEl.contains(event.target)) {
      setSearchOpen(false);
    }

    if (state.readingModeOpen && !readModePillEl?.contains(event.target)) {
      setReadingModeOpen(false);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (isBrowseModeActive()) {
        exitBrowseMode();
        return;
      }

      if (state.searchOpen) {
        setSearchOpen(false);
        return;
      }

      if (state.readingModeOpen) {
        setReadingModeOpen(false);
        return;
      }
    }

    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (state.readingModeOpen) {
        event.preventDefault();
        skipReadingVerse(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
    }

    if (event.key === "ArrowLeft") {
      goToAdjacentChapter(-1);
      writeHash();
      refreshReaderView({ resetScroll: true });
    } else if (event.key === "ArrowRight") {
      goToAdjacentChapter(1);
      writeHash();
      refreshReaderView({ resetScroll: true });
    }
  });

  window.addEventListener("resize", () => {
    syncCarousels();
    updateProgress();
    window.clearTimeout(marginNotesResizeTimer);
    marginNotesResizeTimer = window.setTimeout(() => {
      renderMarginNotes();
    }, 150);
  });

  window.addEventListener("hashchange", () => {
    parseHash();
    refreshReaderView({ resetScroll: true });
  });
}

async function init() {
  try {
    await loadData();
    initializeProgressRings();
    state.readChapters = loadReadChapters();
    state.verseHighlights = loadVerseHighlights();
    state.verseComments = loadVerseComments();
    parseHash();
    clampSelection();
    setupEvents();
    syncHighlightToggleUi();
    ensureLayout();
    refreshReaderView({ resetScroll: true });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        syncCarousels();
      });
    }
  } catch (error) {
    versesEl.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = `Fehler beim Laden: ${error instanceof Error ? error.message : "Unbekannt"}`;
    versesEl.appendChild(msg);
  }
}

init();
