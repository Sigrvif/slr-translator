"use strict";
// Deterministic glossary-conformance check for a single translated line.
//
// When the source contains a glossary term that has a defined translation, the
// translation must reflect it: the English term itself, an allowed gender
// indicator for character/name entries, or the GLOSSARYDIFF escape token. This
// is a presence check, not a correctness check — it catches dropped or renamed
// terms (e.g. Aida rendered as Ada) without any model call, so it works even
// when Review (QC/judge) is off.
//
// Pure and dependency-free so it can be unit tested without the app.

const ESCAPE_TOKEN = "GLOSSARYDIFF";

// The glossary extractor's catch-all bucket is too noisy to enforce; entries
// with no English have nothing to enforce.
const SKIP_TYPES = new Set(["unknown"]);

// Types whose English rendering may legitimately be a pronoun (a named
// character/place is often referred to by "he"/"she"/"they" rather than
// repeated). Gender-unknown name buckets get the same pronoun allowance.
const CHARACTER_TYPES = new Set([
    "female character", "male character", "character_id",
    "nameplate", "katakana", "quoted_name"
]);

// Reflexive and possessive forms are listed explicitly: word-boundary matching
// means "himself" would not satisfy "him" on its own. First-person forms
// (myself/ourself) are intentionally omitted — the source names a term here, so
// a first-person rendering is the rare case the escape token is for. "it/its"
// is also omitted: it would make the check near-useless for monster terms.
const PRONOUNS = [
    "he", "him", "his", "himself",
    "she", "her", "hers", "herself",
    "they", "them", "their", "theirs", "themselves"
];
const MALE_INDICATORS = [
    "man", "men", "male", "boy", "guy", "father", "dad", "daddy",
    "brother", "bro", "sir", "lord", "king", "prince", "master",
    "husband", "son", "uncle", "grandfather", "gentleman", "buddy", "pal", "fellow"
];
const FEMALE_INDICATORS = [
    "woman", "women", "female", "girl", "lady", "mother", "mom", "mommy",
    "sister", "sis", "madam", "queen", "princess", "mistress",
    "wife", "daughter", "aunt", "grandmother", "gal"
];

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text, word) {
    const re = new RegExp("(^|[^A-Za-z])" + escapeRegExp(word) + "([^A-Za-z]|$)", "i");
    return re.test(text);
}

function hasAnyWord(text, words) {
    const t = String(text == null ? "" : text);
    for (const w of words) if (hasWord(t, w)) return true;
    return false;
}

// One stemming step. "-es" is only dropped whole after a sibilant
// (boxes -> box, watches -> watch); after anything else the plural is just
// "-s", so "slimes" must reduce to "slime", not "slim". Short words (<=4 chars)
// are left alone so "king"/"thing" do not lose their tails.
function stemOnce(w) {
    if (w.length <= 4) return w;
    if (/ss$/.test(w)) return w;                                 // priestess, glass: never a plural
    if (/sses$/.test(w)) return w.slice(0, -2);                  // glasses -> glass, classes -> class
    if (/ies$/.test(w)) return w.slice(0, -3) + "y";             // parties -> party
    if (/(xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);   // boxes -> box, watches -> watch
    if (/es$/.test(w)) return w.slice(0, -1);                    // slimes -> slime (plural is just -s)
    if (/s$/.test(w)) return w.slice(0, -1);                     // priests -> priest, houses -> house
    if (/ation$/.test(w) && w.length > 6) return w.slice(0, -5); // transformation -> transform
    if (/ingly$/.test(w) && w.length > 7) return w.slice(0, -5);
    if (/edly$/.test(w) && w.length > 6) return w.slice(0, -4);
    if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3);   // brainwashing -> brainwash
    if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2);    // transformed -> transform
    if (/ment$/.test(w) && w.length > 5) return w.slice(0, -4);
    if (/ness$/.test(w) && w.length > 5) return w.slice(0, -4);
    return w;
}

// Light, conservative stemmer: applies the steps above until stable, so a
// different form of the glossary term still counts as present (Brainwashing /
// brainwashed, Transformation / transformations / transform, Slime / Slimes).
// The remaining stem must stay at least 3 characters.
function stem(word) {
    let w = String(word == null ? "" : word).toLowerCase();
    for (let i = 0; i < 4; i++) {
        const next = stemOnce(w);
        if (next === w) return w;
        if (next.length < 3) return w;
        w = next;
    }
    return w;
}

const TERM_STOPWORDS = new Set(["the", "of", "a", "an", "and", "or", "to", "in", "on"]);

function wordStems(text) {
    const out = new Set();
    const words = String(text == null ? "" : text).toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const w of words) out.add(stem(w));
    return out;
}

// The English term is "present" when every significant word of it appears with
// the same stem in the translation. Stemming absorbs inflections (Brainwashing /
// brainwashed, Transformation / transformed, Priest / Priests, Aida / Aida's)
// while staying word-based, so "priest" still does not satisfy "priestess".
function containsTerm(translation, en) {
    const term = String(en == null ? "" : en).trim();
    if (!term) return false;
    const termWords = term.toLowerCase().match(/[a-z0-9]+/g) || [];
    if (!termWords.length) return false;
    const significant = termWords.filter((w) => w.length >= 3 && !TERM_STOPWORDS.has(w));
    const need = significant.length ? significant : termWords;
    const present = wordStems(translation);
    for (const w of need) if (!present.has(stem(w))) return false;
    return true;
}

// An English rendering that offers alternatives or is not a single term is
// unusable for enforcement (and for a glossary in general): separators, "or",
// parenthetical options, leftover Japanese, or a definition-length phrase.
// Empty is fine — the term stays in the glossary without a translation.
function isUnusableEnglish(en) {
    const e = String(en == null ? "" : en).trim();
    if (!e) return false;
    if (/[\/\\|｜／]/.test(e)) return true;
    if (/[\(\)\[\]（）]/.test(e)) return true;
    if (/\bor\b/i.test(e)) return true;
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(e)) return true;
    if (e.length > 60) return true;
    return false;
}

// Build the enforceable entry list from window.SLRGlossary, longest Japanese
// first so a compound term is matched before its substrings.
function buildEntries(glossary) {
    const out = [];
    if (!glossary || typeof glossary !== "object") return out;
    for (const key of Object.keys(glossary)) {
        const e = glossary[key];
        if (!e || typeof e !== "object") continue;
        const ja = (e.japanese != null && e.japanese !== "") ? e.japanese : key;
        const en = e.english;
        const type = String(e.type == null ? "" : e.type).toLowerCase();
        if (!ja || !en || !String(en).trim()) continue;
        if (SKIP_TYPES.has(type)) continue;
        if (isUnusableEnglish(en)) continue;   // ambiguous/multi-option/definition text
        out.push({ ja: String(ja), en: String(en).trim(), type: type });
    }
    out.sort(function (a, b) { return b.ja.length - a.ja.length; });
    return out;
}

// Every glossary term whose Japanese occurs in the source, longest match wins.
// A match fully contained inside an accepted longer match is dropped, so "アイ"
// cannot also fire when "アイーダ" matched.
function findSourceTerms(source, entries) {
    const src = String(source == null ? "" : source);
    if (!src || !Array.isArray(entries) || !entries.length) return [];
    const matches = [];
    for (const e of entries) {
        if (!e.ja) continue;
        let from = 0;
        let idx;
        while ((idx = src.indexOf(e.ja, from)) !== -1) {
            matches.push({ start: idx, end: idx + e.ja.length, entry: e });
            from = idx + 1;
        }
    }
    matches.sort(function (a, b) {
        return (b.end - b.start) - (a.end - a.start) || a.start - b.start;
    });
    const used = [];
    const accepted = [];
    const seen = new Set();
    for (const m of matches) {
        let contained = false;
        for (const u of used) {
            if (m.start >= u.start && m.end <= u.end) { contained = true; break; }
        }
        if (contained) continue;
        used.push(m);
        if (!seen.has(m.entry.ja)) { seen.add(m.entry.ja); accepted.push(m.entry); }
    }
    return accepted;
}

function hasEscape(translation) {
    return String(translation == null ? "" : translation)
        .toLowerCase().indexOf(ESCAPE_TOKEN.toLowerCase()) !== -1;
}

function stripEscape(translation) {
    return String(translation == null ? "" : translation)
        .replace(/ *GLOSSARYDIFF */gi, "");
}

// Returns { ok, missing } where missing lists the entries the translation does
// not reflect. The escape token authorizes any deviation on the line.
function checkLine(source, translation, entries) {
    if (hasEscape(translation)) return { ok: true, missing: [] };
    const terms = findSourceTerms(source, entries);
    const missing = [];
    for (const e of terms) {
        if (containsTerm(translation, e.en)) continue;
        if (CHARACTER_TYPES.has(e.type) && hasAnyWord(translation, PRONOUNS)) continue;
        if (e.type === "male character" && hasAnyWord(translation, MALE_INDICATORS)) continue;
        if (e.type === "female character" && hasAnyWord(translation, FEMALE_INDICATORS)) continue;
        missing.push(e);
    }
    return { ok: missing.length === 0, missing: missing };
}

module.exports = {
    ESCAPE_TOKEN, SKIP_TYPES, CHARACTER_TYPES, PRONOUNS, MALE_INDICATORS, FEMALE_INDICATORS,
    buildEntries, findSourceTerms, containsTerm, hasAnyWord, hasEscape, stripEscape, checkLine,
    stem, isUnusableEnglish
};
