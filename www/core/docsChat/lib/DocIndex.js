// www/core/docsChat/lib/DocIndex.js
// Loads the built-in documentation (www/docs/) into a searchable in-memory index.
// Node-safe on purpose (regex tag stripping + entity decoding, no DOM) so it runs
// under node --test as well as in the NW.js renderer.
//
// The retrieval recipe mirrors the docs viewer's own search (www/docs/docs.js
// ensureIndex): fetch each fragment, strip tags, match tokens — plus keyword
// boosting from the manifest, which the viewer only feeds its own search box.
"use strict";
const fs = require("fs");
const path = require("path");

const ENTITIES = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'",
    "&apos;": "'", "&nbsp;": " "
};

function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/g, (m, code) => String.fromCodePoint(Number(code)))
        .replace(/&([a-z]+);/gi, (m, name) => {
            const key = ("&" + name.toLowerCase() + ";");
            return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
        });
}

// Convert a docs page fragment to readable plain text. Docs pages are clean
// hand-written HTML (h1-h3/h2 anchors, tables, lists, <code>, <div class="note">),
// so a conservative structure-aware strip is enough.
function htmlToText(html) {
    let text = String(html);
    // Drop scripts/styles entirely (none expected in docs pages; defensive).
    text = text.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "");
    // Structural tags -> text markers (before generic tag stripping).
    text = text
        .replace(/<h1[^>]*>/gi, "\n\n# ")
        .replace(/<h2[^>]*>/gi, "\n\n## ")
        .replace(/<h3[^>]*>/gi, "\n\n### ")
        .replace(/<h4[^>]*>/gi, "\n\n#### ")
        .replace(/<h5[^>]*>|<h6[^>]*>/gi, "\n\n#### ")
        .replace(/<li[^>]*>/gi, "\n- ")
        .replace(/<\/tr>/gi, "\n")
        .replace(/<\/t[dh]>/gi, " | ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|ul|ol|table|pre|blockquote)>/gi, "\n");
    // Everything left is noise: strip tags, keep inner text (code stays verbatim).
    text = text.replace(/<[^>]+>/g, "");
    text = decodeEntities(text);
    // Tidy whitespace: strip per-line, collapse 3+ newlines, trim.
    text = text.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n");
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
}

// The manifest is a JS file assigning window.DOCS_MANIFEST, not JSON. Evaluate it
// in a fresh function scope with a scratch "window" — works in Node and renderer,
// and touches nothing global.
function parseManifestSource(src) {
    const manifest = new Function("window", String(src) + "\nreturn window.DOCS_MANIFEST;")({});
    if (!Array.isArray(manifest)) throw new Error("Manifest did not evaluate to an array");
    const flat = [];
    for (const section of manifest) {
        for (const page of section.pages || []) {
            flat.push({
                id: page.id,
                title: page.title,
                file: page.file,
                section: section.section || "",
                keywords: page.keywords || ""
            });
        }
    }
    return flat;
}

// Words too common to carry meaning on their own. The chat's deterministic
// manual-vs-not mode split rides on search scores, so a question like
// "What's a good pancake recipe?" must NOT match pages merely because "what"
// and "good" appear in every body text.
const STOPWORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "am",
    "do", "does", "did", "have", "has", "had", "will", "would", "can", "could",
    "should", "shall", "may", "might", "must",
    "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she",
    "her", "it", "its", "we", "us", "our", "they", "them", "their",
    "this", "that", "these", "those", "there", "here",
    "what", "whatever", "when", "where", "which", "who", "whom", "whose", "why", "how",
    "of", "in", "on", "at", "to", "for", "with", "without", "from", "by", "about",
    "into", "over", "under", "after", "before", "between", "and", "or", "but",
    "nor", "so", "if", "then", "than", "as", "not", "no", "yes",
    "good", "best", "nice", "please", "tell", "give", "show", "get", "got",
    "use", "using", "used", "make", "made", "need", "want", "know", "like",
    "some", "any", "all", "more", "most", "other", "such", "only", "own",
    "same", "too", "very", "just", "also", "now", "out", "up", "down", "off",
    "again", "further", "once"
]);

function tokenize(text) {
    return String(text).toLowerCase().split(/[^a-z0-9_]+/)
        .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d{1,2}$/.test(t));
}

// Light stemmer so a query in one derived form matches text in another:
// "endpoints" -> "endpoint", "rotation"/"rotating" -> "rotat" ~ "rotate" ->
// "rotat", "translation" ~ "translate" ~ "translating" -> "translat".
// One suffix pass only — this is retrieval, not linguistics.
function stemToken(t) {
    if (t.length < 5) return t;
    let s = t.replace(/(ions|ion|ings|ing|ed|es|s)$/, "");
    if (s.length < 3) s = t;
    if (s.length >= 4 && /e$/.test(s)) s = s.slice(0, -1);
    return s;
}

function stemBlob(text) {
    return tokenize(text).map(stemToken).join(" ");
}

// Word -> occurrence count. Retrieval counts WHOLE WORDS only: substring
// counting made 2-char query tokens ("tp", "38") match inside unrelated words
// ("http"), which is how an off-manual question once scored 44 against a page.
function wordCountMap(text) {
    const map = Object.create(null);
    for (const word of tokenize(text).map(stemToken)) {
        map[word] = (map[word] || 0) + 1;
    }
    return map;
}

function snippetAround(text, lowerText, token, radius) {
    const idx = lowerText.indexOf(token);
    if (idx === -1) return text.slice(0, radius * 2).replace(/\s+/g, " ").trim();
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + token.length + radius);
    return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

function DocIndex(opts) {
    opts = opts || {};
    // Optional root of the user addons folder: when set, documentation pages
    // declared there (package.json "docs" field) are appended to the index.
    this.addonsRoot = opts.addonsRoot || null;
    this.readFileFn = opts.readFile || function (file) {
        return fs.readFileSync(path.join(opts.docsRoot || ".", file), "utf8");
    };
    this.pages = [];
}

DocIndex.prototype.init = function (manifestSource) {
    const src = manifestSource !== undefined
        ? manifestSource
        : this.readFileFn("manifest.js");
    const entries = parseManifestSource(src);
    // Documentation pages contributed by user addons. Best-effort on purpose:
    // a missing or broken addon page becomes an unreadable entry below, never
    // a rejected index — the built-in manual must always load.
    if (this.addonsRoot) {
        try {
            const collectAddonDocs = require("../../../js/addonDocs.js");
            for (const section of (collectAddonDocs(this.addonsRoot) || [])) {
                for (const page of (section.pages || [])) {
                    entries.push({
                        id: page.id,
                        title: page.title,
                        file: page.file,
                        section: section.section || "",
                        keywords: page.keywords || "",
                        addon: true
                    });
                }
            }
        } catch (e) { /* addon docs unavailable — built-in manual only */ }
    }
    this.pages = entries.map((entry) => {
        let html;
        if (entry.addon) {
            try { html = this.readFileFn(entry.file); } catch (e) { html = null; }
        } else {
            html = this.readFileFn(entry.file);
        }
        const base = (html === null || html === undefined)
            ? Object.assign({}, entry, { text: "(page could not be read: " + entry.file + ")" })
            : Object.assign({}, entry, { text: htmlToText(html) });
        // Stemmed word-count maps for retrieval, precomputed once.
        base._wTitle = wordCountMap(entry.title || "");
        base._wKeywords = wordCountMap(entry.keywords || "");
        base._wBody = wordCountMap(base.text);
        base._sBody = stemBlob(base.text);
        return base;
    });
    // Document frequency per stemmed token: lets rare, discriminating tokens
    // ("rotate") outweigh tokens present in every page ("translation") —
    // without this, generic words tie every candidate and the excerpt picker
    // injects the wrong pages.
    this._df = {};
    for (const page of this.pages) {
        const seen = new Set(
            Object.keys(page._wBody)
                .concat(Object.keys(page._wTitle), Object.keys(page._wKeywords))
        );
        for (const tok of seen) {
            if (!tok) continue;
            this._df[tok] = (this._df[tok] || 0) + 1;
        }
    }
    return Promise.resolve(this);
};

DocIndex.prototype.listDocs = function () {
    return this.pages.map((p) => ({ id: p.id, title: p.title, section: p.section }));
};

DocIndex.prototype.readDoc = function (pageId) {
    const page = this.pages.find((p) => p.id === pageId);
    if (!page) return { error: "Unknown page_id '" + pageId + "'. Use list_docs for valid ids." };
    return { page_id: page.id, title: page.title, text: page.text };
};

DocIndex.prototype.search = function (query, maxHits) {
    maxHits = maxHits === undefined ? 5 : maxHits;
    const rawTokens = tokenize(query);
    if (rawTokens.length === 0) return [];
    const tokens = rawTokens.map(stemToken);
    const n = this.pages.length;
    const idf = (tok) => Math.log(1 + n / (1 + (this._df ? (this._df[tok] || 0) : 0)));
    const results = [];
    // Rarity bar: a token present in more than ~30% of the manual's pages is
    // the corpus's own ambient vocabulary ("word" 21/39, "english" 16/39,
    // "common" 13/39, "japanese" 24/39) — it is NOT evidence that a question
    // is about the manual. Calibrated so domain terms like "fallback" (11/39)
    // still count as rare.
    const rareMax = Math.max(2, Math.floor(this.pages.length * 0.30));
    for (const page of this.pages) {
        let score = 0;
        let matchedTokens = 0;
        let strongMatch = false;
        let rareTokens = 0;
        let strongRareMatch = false;
        let bestToken = null;
        let bestIdf = -1;
        for (const token of tokens) {
            const titleHits = (page._wTitle && page._wTitle[token]) || 0;
            const keywordHits = (page._wKeywords && page._wKeywords[token]) || 0;
            const bodyHits = (page._wBody && page._wBody[token]) || 0;
            if (titleHits + keywordHits + bodyHits === 0) continue;
            matchedTokens += 1;
            if (titleHits + keywordHits > 0) strongMatch = true;
            const isRare = (this._df[token] || 0) <= rareMax;
            if (isRare) {
                rareTokens += 1;
                if (titleHits + keywordHits > 0) strongRareMatch = true;
            }
            const weight = idf(token);
            score += (5 * titleHits + 3 * keywordHits + Math.min(5, bodyHits)) * weight;
            if (weight > bestIdf) { bestIdf = weight; bestToken = token; }
        }
        if (score <= 0) continue;
        // Snippet: around the rarest matching token; stemmed-only matches may
        // not appear verbatim in the raw text, so fall back to the page head.
        let snippet;
        const rawHit = bestToken && page.text.toLowerCase().indexOf(bestToken) !== -1
            ? bestToken
            : rawTokens[tokens.indexOf(bestToken)] && page.text.toLowerCase().indexOf(rawTokens[tokens.indexOf(bestToken)]) !== -1
                ? rawTokens[tokens.indexOf(bestToken)]
                : null;
        if (rawHit) snippet = snippetAround(page.text, page.text.toLowerCase(), rawHit, 80);
        else snippet = page.text.slice(0, 160).replace(/\s+/g, " ").trim();
        results.push({
            page_id: page.id,
            title: page.title,
            score: score,
            matchedTokens: matchedTokens,
            strongMatch: strongMatch,
            rareTokens: rareTokens,
            strongRareMatch: strongRareMatch,
            snippet: snippet
        });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxHits);
};

module.exports = DocIndex;
// Static helpers on the constructor so tests (and future callers) can use them
// without an index instance.
module.exports.htmlToText = htmlToText;
module.exports.parseManifestSource = parseManifestSource;
