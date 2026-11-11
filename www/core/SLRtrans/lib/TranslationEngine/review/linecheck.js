"use strict";
// Windowed review for the engine's single-line phase. Pure orchestration: it
// takes the batch's line pairs and a model-call function and returns per-line
// verdicts. It never touches the grid or tags, so the engine can use it inside
// dslrengine's per-line processing and report flags to the batch layer.
//
// Flow: windowed QC (CLEAN or findings) -> one Judge call per finding ->
// per-line verdict { redo, why }. A cited row stays flagged while any of its
// findings keeps a hold on it: below-minSeverity and unadjudicated findings
// keep theirs, a judge's redo keeps its and sets the verdict, and only an
// explicit dismiss releases that finding's hold — so a row drops out of
// `flagged` exactly when every finding that cited it was dismissed.
// `windowsFailed` counts QC window calls that failed; `unreviewed` lists rows
// not served by any successful window — the caller must treat those rows as
// unreviewed (fail closed) instead of inferring "clean" from no findings.
const { parseFindings, windows } = require("./qc");
const { parseVerdict } = require("./judge");
const prompts = require("./prompts");

const SEV_RANK = { low: 0, medium: 1, high: 2 };
const DEFAULT_SPAN = 60;
// Neighbor rows each side of a retried row for the re-review window, so the
// re-check sees the same surrounding-lines context as the original windowed
// review instead of judging one isolated row.
const REREVIEW_RADIUS = 10;

function meetsSeverity(severity, minSeverity) {
    const need = SEV_RANK[minSeverity] == null ? 0 : SEV_RANK[minSeverity];
    const have = SEV_RANK[severity] == null ? 0 : SEV_RANK[severity];
    return have >= need;
}

// Re-reviews of an already-retried row judge against a progressively raised
// bar: the first re-review uses the configured minimum, then each further
// round raises it one rank, so a style nit that ordered round N cannot order
// round N+1 by itself — only a genuinely worse finding re-triggers, and the
// bar tightens the more attempts a row has already burned. `steps` is the
// number of ranks to raise (default 1, preserving the single-step contract);
// non-finite or negative steps clamp to 0, and the result caps at high.
// Unknown input escalates from low.
function escalateSeverity(minSeverity, steps) {
    const rank = SEV_RANK[minSeverity] == null ? 0 : SEV_RANK[minSeverity];
    const up = (steps == null) ? 1 : Math.max(0, Number(steps) || 0);
    const next = Math.min(SEV_RANK.high, rank + up);
    return next >= SEV_RANK.high ? "high" : (next >= SEV_RANK.medium ? "medium" : "low");
}

// Ranks to raise the bar for a re-review at a given fix-round count: the first
// re-review (round 1) uses the configured bar, then one extra rank per burned
// round. A missing/zero/negative/non-finite round reads as the first review,
// so an unknown caller never starts escalated.
function escalateStepsForRound(roundIndex) {
    return Math.max(0, (Number(roundIndex) || 0) - 1);
}

// Builds the re-review window around one batch position: the retried row's
// fresh translation plus its neighbors' batch translations, using real batch
// positions as indices so findings cite the same @N as the original review.
// Rows missing either wire side are skipped; radius defaults to
// REREVIEW_RADIUS and clamps at the batch edges. Optional opts:
// - settled: accepted per-row translations from the current run, indexed by
//   row (may be shorter than the batch). Processed rows contribute their
//   final text instead of the raw batch text.
// - suspect: rows whose text is about to change (pending redo). Served
//   source-only — discourse context, never ground truth to compare against.
//   The focused row itself is never suspect: its fresh text always wins.
function windowPairs(pos, sources, translations, currentDst, radius, opts) {
    const r = radius === undefined ? REREVIEW_RADIUS : radius;
    const settled = (opts && Array.isArray(opts.settled)) ? opts.settled : null;
    let suspect = null;
    try {
        if (opts && opts.suspect) suspect = new Set(opts.suspect);
    } catch (e) { suspect = null; }
    const out = [];
    const n = Math.max(
        Array.isArray(sources) ? sources.length : 0,
        Array.isArray(translations) ? translations.length : 0);
    for (let i = Math.max(0, pos - r); i <= Math.min(n - 1, pos + r); i++) {
        const src = Array.isArray(sources) ? sources[i] : null;
        if (src == null) continue;
        if (i === pos) {
            if (currentDst == null || currentDst === "") continue;
            out.push({ index: i, speaker: "", wireSrc: src, wireDst: currentDst });
            continue;
        }
        if (suspect && suspect.has(i)) {
            out.push({ index: i, speaker: "", wireSrc: src, wireDst: "", sourceOnly: true });
            continue;
        }
        const dst = (settled && i < settled.length && settled[i] != null && settled[i] !== "")
            ? settled[i]
            : (Array.isArray(translations) ? translations[i] : null);
        if (dst == null || dst === "") continue;
        out.push({ index: i, speaker: "", wireSrc: src, wireDst: dst });
    }
    return out;
}

async function reviewWindows(pairs, deps) {
    const verdicts = {};
    const holds = new Map();
    const covered = new Set();
    const log = [];
    const usable = (pairs || []).filter((p) => p && p.wireSrc != null && p.wireDst != null);
    if (!usable.length) return { verdicts: {}, flagged: [], log, windowsFailed: 0, unreviewed: [] };
    const span = deps.span || DEFAULT_SPAN;
    const minSeverity = deps.minSeverity || "low";
    // Re-review scope: when set, only this row is under verdict — the rest of
    // the window is context. Findings that do not touch it are dropped before
    // judging or logging, so the re-check confirms the retried row's fix and
    // nothing else. Undefined (batch review) keeps the full-window behavior.
    const focus = (deps.focusIndex === undefined || deps.focusIndex === null)
        ? null : deps.focusIndex;
    // KV-cache parity with translation requests: when deps.cacheFriendly is
    // set, the glossary/scene sections travel as a separate context payload
    // (the caller sends it as its own user message ahead of the task) instead
    // of inside the task message. The task then renders without sections.
    const splitContext = deps.cacheFriendly === true
        && Array.isArray(deps.sections) && deps.sections.length > 0;
    const taskSections = splitContext ? [] : (deps.sections || []);
    const callExtra = { context: splitContext ? prompts.sectionsToText(deps.sections) : null };
    // Attempt history for the row under verdict (re-reviews only): prior
    // translations plus the ruling each one drew, so QC and the judge see
    // what was already tried instead of re-litigating blind.
    const history = Array.isArray(deps.history) ? deps.history : [];
    // Judge disabled: QC findings at or above the minimum severity order the
    // retry directly instead of being adjudicated. The verdict is built from
    // the finding itself (note as the requirement), so the downstream retry
    // loop is unchanged — only the extra judge call per finding is removed.
    const judgeOn = deps.judge !== false;
    const logMsg = (m) => { if (typeof deps.log === "function") deps.log(m); };
    const maxIndex = Math.max.apply(null, usable.map((p) => p.index));
    const spans = windows(maxIndex + 1, span);
    const byIndex = {};
    for (const p of usable) byIndex[p.index] = p;
    let windowsFailed = 0;

    for (const [start, end] of spans) {
        const windowRows = usable.filter((p) => p.index >= start && p.index < end);
        if (!windowRows.length) continue;
        const served = new Set(windowRows.map((p) => p.index));
        const qcMsg = prompts.buildMessages("qc", deps.replacers || {}, deps.qcOverrides);
        let qcText;
        try {
            qcText = await deps.callModel(qcMsg.system,
                prompts.renderQcUser(windowRows, taskSections, qcMsg.userTemplate, focus, history),
                "QC", callExtra);
        } catch (e) {
            windowsFailed++;
            log.push("review qc window failed: " + (e && e.message));
            continue;
        }
        const { findings, log: qcLog } = parseFindings(qcText, served);
        qcLog.forEach((l) => log.push("review qc: " + l));
        for (const p of windowRows) covered.add(p.index);

        for (const finding of findings) {
            const targets = finding.targets || [finding.line];
            // Out of scope for a focused re-review: not the row being
            // retried, so never judge it, log it, or hold it.
            if (focus !== null && targets.indexOf(focus) === -1) continue;
            // A span touching focus is about the focused row: record holds
            // and verdicts on it alone.
            const owned = (focus !== null) ? [focus] : targets;
            for (const t of owned) holds.set(t, (holds.get(t) || 0) + 1);
            logMsg("finding @" + targets.join(",") + " [" + finding.severity + "/" +
                finding.category + "]" + (finding.note ? " " + finding.note : ""));
            if (!meetsSeverity(finding.severity, minSeverity)) continue;
            if (!judgeOn) {
                // No judge call: the QC finding itself orders the retry. The
                // worst-severity finding on a row wins and its note becomes the
                // retranslation requirement; ties keep the earliest (matching
                // the judge path's first-redo-wins rule).
                logMsg("judge off @" + targets.join(",") + " — QC finding orders the retry");
                for (const t of owned) {
                    if (!byIndex[t]) continue;
                    const prev = verdicts[t];
                    if (!prev || !prev.redo) {
                        verdicts[t] = { redo: true, why: finding.note || "", sev: finding.severity || "low", cat: finding.category || "other" };
                    } else if ((SEV_RANK[finding.severity] || 0) > (SEV_RANK[prev.sev] || 0)) {
                        prev.sev = finding.severity;
                        prev.cat = finding.category || "other";
                        prev.why = finding.note || "";
                    }
                }
                continue;
            }
            // Judge the finding against the window (which already carries the
            // surrounding lines), matching the reviewer's source-is-truth contract.
            const judgeMsg = prompts.buildMessages("judge", deps.replacers || {}, deps.judgeOverrides);
            let judgeText;
            try {
                judgeText = await deps.callModel(judgeMsg.system,
                    prompts.renderJudgeUser(finding, windowRows, taskSections, judgeMsg.userTemplate, history),
                    "judge", callExtra);
            } catch (e) {
                log.push("review judge failed: " + (e && e.message));
                continue;
            }
            const verdict = parseVerdict(judgeText);
            if (!verdict) continue;
            logMsg("judge @" + targets.join(",") + ": " + verdict.verdict +
                (verdict.why ? " — " + verdict.why : ""));
            if (verdict.verdict === "dismiss") {
                for (const t of owned) {
                    const left = (holds.get(t) || 0) - 1;
                    if (left > 0) holds.set(t, left); else holds.delete(t);
                }
                continue;
            }
            for (const t of owned) {
                if (!byIndex[t]) continue;
                // First redo wins; a second finding only strengthens it — and
                // raises the recorded severity to the worst confirmed finding,
                // so callers can rank attempts (best-of acceptance) and spot a
                // repeating complaint (same-complaint early exit). The recorded
                // category tracks the finding that set the worst severity.
                const prev = verdicts[t];
                if (!prev || !prev.redo) {
                    verdicts[t] = { redo: true, why: verdict.why || "", sev: finding.severity || "low", cat: finding.category || "other" };
                } else if ((SEV_RANK[finding.severity] || 0) > (SEV_RANK[prev.sev] || 0)) {
                    prev.sev = finding.severity;
                    prev.cat = finding.category || "other";
                }
            }
        }
    }
    return {
        verdicts,
        flagged: Array.from(holds.keys()).sort((a, b) => a - b),
        log,
        windowsFailed,
        unreviewed: usable.map((p) => p.index).filter((idx) => !covered.has(idx))
    };
}

module.exports = { reviewWindows, meetsSeverity, escalateSeverity, escalateStepsForRound, windowPairs, DEFAULT_SPAN, REREVIEW_RADIUS };
