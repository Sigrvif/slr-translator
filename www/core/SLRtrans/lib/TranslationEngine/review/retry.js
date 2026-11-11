"use strict";
// Pure helpers for the review retry loop: no-progress detection and
// best-of acceptance across a row's attempts. No model calls, no app state —
// the engine keeps the per-row attempt log ({ text, verdict }) and delegates
// every decision here so the logic is unit-testable.
//
// An attempt's verdict is the reviewWindows shape: null = reviewed clean,
// { redo: false } = still flagged without a redo order, { redo: true, sev }
// = judge-confirmed problem at the finding's worst severity, undefined =
// the review itself failed (fail closed).
const SEV_RANK = { low: 0, medium: 1, high: 2 };

// Boilerplate of the judge's WHY template style: articles, auxiliaries, and
// the ruling verbs every WHY is built from. Stripped before comparing two
// rulings so "The translation must accurately convey ..." and "The
// retranslation must accurately reflect ..." do not match on template alone.
const BOILERPLATE = new Set(
    ("the a an and or of to in on for with while without rather than as that " +
     "this these those was were are is be been being by from at it its their " +
     "his her our your my he she they we you him them us must accurately " +
     "convey conveys preserve preserves preserving render renders rendered " +
     "reflect reflects capture captures capturing match matches matching " +
     "keep keeps keeping use uses using maintain maintains state states " +
     "specific intended original source japanese english sentence phrase " +
     "wording text context translation retranslation").split(" "));

// Content-bearing tokens of a WHY ruling: lowercase alphanumerics, length 3+,
// boilerplate removed. Non-ASCII (quoted Japanese) drops out; the romaji
// anchors weak-model rulings lean on survive.
function rulingTokens(why) {
    const out = new Set();
    const words = String(why == null ? "" : why).toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const w of words) {
        if (w.length < 3 || BOILERPLATE.has(w)) continue;
        out.add(w);
    }
    return out;
}

// True when two consecutive redo verdicts make the same complaint in
// different words: one category plus a ruling-word overlap (Jaccard >= 0.4)
// over at least three content tokens a side. Guards the early exit that
// stops a doomed third round: same defect twice means the model cannot fix
// it, so another retranslation + re-review would just re-spend calls.
function sameComplaint(prev, next) {
    if (!prev || !next || prev.redo !== true || next.redo !== true) return false;
    if (!prev.cat || prev.cat !== next.cat) return false;
    if (!prev.why || !next.why) return false;
    const a = rulingTokens(prev.why);
    const b = rulingTokens(next.why);
    if (a.size < 3 || b.size < 3) return false;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared / (a.size + b.size - shared) >= 0.4;
}

// Whitespace-insensitive form for comparing two translations: a retry that
// only reshuffles spaces or line breaks made no progress.
function normalizeAttempt(text) {
    return String(text == null ? "" : text).replace(/\s+/g, "");
}

// True when the new translation is the same text the reviewer already
// ruled on (modulo whitespace): another QC/judge round trip would just
// re-spend calls to reach the same verdict.
function isNoProgress(prevText, nextText) {
    const a = normalizeAttempt(prevText);
    const b = normalizeAttempt(nextText);
    return a !== "" && a === b;
}

// Lower is better: clean (0), kept-flag without redo (1), redo by severity
// (low 2 < medium 3 < high 4), failed review last (5).
function rankAttempt(attempt) {
    const v = attempt ? attempt.verdict : undefined;
    if (v === null) return 0;
    if (v === undefined) return 5;
    if (!v.redo) return 1;
    return 2 + (SEV_RANK[v.sev] == null ? 0 : SEV_RANK[v.sev]);
}

// The text of the best-ranked attempt; earliest wins ties, so the original
// translation survives when nothing beat it. Undefined when there is no
// usable attempt.
function chooseBest(attempts) {
    let best = undefined;
    let bestRank = Infinity;
    for (const a of (Array.isArray(attempts) ? attempts : [])) {
        if (!a || a.text == null || a.text === "") continue;
        const r = rankAttempt(a);
        if (r < bestRank) {
            bestRank = r;
            best = a.text;
        }
    }
    return best;
}

// The two review-call failure budgets, counted independently. Network-class
// failures (transport, recoverable HTTP) are expensive: each retry waits the
// escalating backoff, so the budget stays small. Repetition loops retry with a
// flat 5s wait and a small penalty bump, so they get more chances to escape
// without a long tail. Counters are "failures of this kind so far"; the budget
// is the total attempts of that kind.
const REVIEW_NET_ATTEMPTS = 3;
const REVIEW_REPEAT_ATTEMPTS = 5;

// Accounts one failed review attempt and reports whether another is worth
// making. A repetition retry never consumes a network attempt and vice versa.
// Unknown kinds fall back to the conservative network budget, and missing or
// non-finite counters read as 0.
function reviewRetryBudget(kind, counters) {
    const net = Math.max(0, Math.trunc(Number(counters && counters.net)) || 0);
    const repeats = Math.max(0, Math.trunc(Number(counters && counters.repeats)) || 0);
    if (kind === "repetition") {
        const next = repeats + 1;
        return { retry: next < REVIEW_REPEAT_ATTEMPTS, net: net, repeats: next };
    }
    const next = net + 1;
    return { retry: next < REVIEW_NET_ATTEMPTS, net: next, repeats: repeats };
}

module.exports = {
    normalizeAttempt, isNoProgress, rankAttempt, chooseBest, rulingTokens, sameComplaint,
    reviewRetryBudget, REVIEW_NET_ATTEMPTS, REVIEW_REPEAT_ATTEMPTS
};
