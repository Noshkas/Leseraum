const WORD_PATTERN = /[A-Za-zÄÖÜäöüß]+/g;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Ungültiges ${label}.`);
  }
}

function normalizeRules(rawRules) {
  assertObject(rawRules, "Footnote-Regelset");

  const suffixPatternRaw = String(rawRules.suffix_pattern ?? "").trim();
  if (!suffixPatternRaw) {
    throw new Error("Footnote-Regelset fehlt: suffix_pattern");
  }

  const protectedWords = Array.isArray(rawRules.protected_words)
    ? rawRules.protected_words.filter((item) => typeof item === "string" && item.trim())
    : [];

  assertObject(rawRules.manual_token_map, "manual_token_map");

  const manualTokenMap = {};
  for (const [token, replacement] of Object.entries(rawRules.manual_token_map)) {
    if (typeof token !== "string" || typeof replacement !== "string") continue;
    manualTokenMap[token] = replacement;
  }

  return {
    suffixPattern: new RegExp(suffixPatternRaw, "g"),
    protectedWords: new Set(protectedWords),
    manualTokenMap,
  };
}

export async function loadFootnoteRules(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Footnote-Regeln konnten nicht geladen werden (${response.status}).`);
  }

  const rawRules = await response.json();
  return normalizeRules(rawRules);
}

export function buildWordFrequency(data) {
  const counts = Object.create(null);

  for (const book of data?.books ?? []) {
    for (const chapter of book?.chapters ?? []) {
      for (const verse of chapter?.verses ?? []) {
        const text =
          typeof verse?.text === "string" ? verse.text : typeof verse?.de === "string" ? verse.de : "";
        if (!text) continue;

        const words = text.match(WORD_PATTERN) ?? [];
        for (const word of words) {
          counts[word] = (counts[word] ?? 0) + 1;
        }
      }
    }
  }

  return counts;
}

function shouldStripFootnoteSuffix(word, base, suffix, wordFrequency, rules) {
  if (!wordFrequency) return false;
  if (rules.protectedWords.has(word)) return false;

  const wordCount = wordFrequency[word] ?? 0;
  const baseCount = wordFrequency[base] ?? 0;
  if (!baseCount) return false;

  if (suffix === "b" || suffix === "c") {
    return baseCount >= Math.max(6, wordCount * 3);
  }

  const isLowercase = word[0] === word[0].toLowerCase();
  if (isLowercase) {
    return word.length >= 3;
  }

  return baseCount >= 30 && baseCount >= wordCount * 15;
}

export function cleanInlineFootnoteMarkers(text, { wordFrequency, rules }) {
  const source = String(text ?? "");
  if (!source) return "";

  return source.replace(rules.suffixPattern, (full, base, suffix) => {
    if (rules.manualTokenMap[full]) {
      return rules.manualTokenMap[full];
    }

    const normalizedSuffix = String(suffix).toLowerCase();
    return shouldStripFootnoteSuffix(full, base, normalizedSuffix, wordFrequency, rules) ? base : full;
  });
}

export function applyVerseTextCleanup(data, { wordFrequency, rules }) {
  for (const book of data?.books ?? []) {
    for (const chapter of book?.chapters ?? []) {
      for (const verse of chapter?.verses ?? []) {
        if (typeof verse?.text === "string") {
          verse.text_clean = cleanInlineFootnoteMarkers(verse.text, { wordFrequency, rules });
        }
        if (typeof verse?.de === "string") {
          verse.de_clean = cleanInlineFootnoteMarkers(verse.de, { wordFrequency, rules });
        }
      }
    }
  }
}
