"use strict";
const SEVERITIES = ["low", "medium", "high"];
const CATEGORIES = ["mistranslation", "omission", "pov", "register",
    "term-inconsistency", "content-softening", "refusal", "other"];
const SEV_RANK = { low: 0, medium: 1, high: 2 };
const MAX_TARGETS_PER_FINDING = 64;
// Hard ceiling for finding notes. Deliberately far above the QC system
// prompt's soft "short explanation" guidance: the prompt keeps notes tight,
// but anything the model does write must reach the judge whole — a cut-off
// fragment is worse than a long note, and a thousand characters are noise
// next to the windowed rows every judge call already carries. Overlong notes
// are cut at the last word boundary with an ellipsis, never sliced mid-word.
const NOTE_MAX = 1000;

function truncateNote(note) {
    const t = String(note == null ? "" : note);
    if (t.length <= NOTE_MAX) return t;
    const cut = t.slice(0, NOTE_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    const head = lastSpace > NOTE_MAX / 2 ? cut.slice(0, lastSpace) : cut;
    return head + "…";
}
const FINDING_RE = new RegExp(
    "^@(\\d+)(?:-(\\d+))?\\s*[｜|:：]\\s*" +
    "([^｜|:：]+?)\\s*[｜|:：]\\s*" +
    "([^｜|:：]+?)\\s*[｜|:：]\\s*(.+)$");
const NOTE_RANGE_RE = /(?:\blines?\s+|@)(\d+)\s*[-–—]\s*@?(\d+)/i;
const THINK_RE = /^\s*<think>[\s\S]*?<\/think>\s*/i;

function stripPreamble(text) {
    let t = String(text || "").replace(THINK_RE, "");
    const lines = t.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line === "CLEAN" || FINDING_RE.test(line)) return lines.slice(i).join("\n");
    }
    return t;
}

function windows(total, span, overlap) {
    overlap = overlap === undefined ? 10 : overlap;
    const win = span;
    const step = Math.max(win - overlap, 1);
    const out = [];
    let start = 0;
    while (start < total) {
        const end = Math.min(start + win, total);
        out.push([start, end]);
        if (end >= total) break;
        start += step;
    }
    return out;
}

function parseFindings(text, servedIs, cap) {
    cap = cap === undefined ? 25 : cap;
    const stripped = stripPreamble(text).trim();
    if (stripped === "CLEAN") return { findings: [], log: [] };
    if (!stripped) return { findings: [], log: ["empty response (not CLEAN)"] };

    const findings = [];
    const log = [];
    const seen = new Set();
    for (const raw of stripped.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const m = FINDING_RE.exec(line);
        if (!m) { log.push("malformed finding line: " + JSON.stringify(line)); continue; }
        const n = parseInt(m[1], 10);
        const end = m[2] === undefined ? null : parseInt(m[2], 10);
        const severity = m[3].trim();
        const category = m[4].trim();
        const note = m[5].trim();
        if (end !== null && (end < n || end - n + 1 > MAX_TARGETS_PER_FINDING)) {
            log.push("invalid or oversized target span: " + JSON.stringify(line)); continue;
        }
        const targets = end === null ? [n] : Array.from({ length: end - n + 1 }, (_, i) => n + i);
        const unserved = targets.filter((t) => !servedIs.has(t));
        if (unserved.length) { log.push("finding cites unserved line(s) " + unserved.join(",")); continue; }
        if (end === null) {
            const ranges = Array.from(note.matchAll(new RegExp(NOTE_RANGE_RE.source, "gi")))
                .map((r) => [parseInt(r[1], 10), parseInt(r[2], 10)]);
            if (ranges.some(([a, b]) => a !== b)) {
                log.push("multi-line note requires explicit @start-end target: " + JSON.stringify(line)); continue;
            }
        }
        if (!SEVERITIES.includes(severity) || !CATEGORIES.includes(category)) {
            log.push("bad enum in finding: " + JSON.stringify(line)); continue;
        }
        if (!note) { log.push("empty note in finding: " + JSON.stringify(line)); continue; }
        const key = targets.join(",") + "|" + category;
        if (seen.has(key)) continue;
        seen.add(key);
        const finding = { line: n, severity, category, note: truncateNote(note) };
        if (targets.length > 1) finding.targets = targets;
        findings.push(finding);
    }

    if (findings.length > cap) {
        findings.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
        const dropped = findings.slice(cap);
        findings.length = cap;
        log.push("findings cap exceeded, dropped " + dropped.length + " lowest-severity");
    }
    return { findings, log };
}

module.exports = { SEVERITIES, CATEGORIES, parseFindings, windows, stripPreamble, truncateNote, NOTE_MAX };
