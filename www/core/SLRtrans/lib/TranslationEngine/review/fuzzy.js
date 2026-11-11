"use strict";
// Repeated-content detection for review streams.
//
// The exact-match tiers (single characters, words/sentences, entries) only
// fire on back-to-back identical copies. A derailed reviewer instead re-issues
// content across the response: the same line verbatim ("Let's check @6 again.
// ... is the issue." many times) or the same row revisited over and over with
// wording drift. Both are counted across the whole accumulated response.
//
// Precision matters more than recall here: a false kill throws away a valid
// QC pass and forces a retry, so findings about DIFFERENT rows must never
// count as a loop — row numbers are identity, not filler. The key keeps
// digits; a second signal counts how often one row is revisited. Distinct
// rows sharing one wording ("extra quotation mark at the end of the line"
// for @5, @9, @14, ...) therefore stay clean, which was a real false
// positive.
//
// Pure and dependency-free for unit testing; the review stream reader calls
// fuzzyLoopReason via the shared repetition `inspect` hook, so a firing
// terminates the response exactly like any other repetition tier (finish
// "length" + penalty-bump retry, fail closed when attempts exhaust, loop
// output never becomes findings).
//
// Lines below MIN_LINE_CHARS never count: verdict tics like "Accurate." or
// "Category: content-softening." may legitimately repeat.
var MIN_LINE_CHARS = 24;

// Case- and whitespace-insensitive form of a line. Digits are preserved:
// "@5" and "@9" are different findings, not one repeated shape.
function lineKey(line) {
    return String(line == null ? "" : line)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

// The first row reference in a line (its primary subject). Findings and loop
// lines both lead with the row they are about, so this is the row being
// (re)discussed; later mentions inside a note are context, not the subject.
function primaryRowRef(line) {
    var m = String(line == null ? "" : line).match(/@(\d+)/);
    return m ? m[1] : null;
}

// Returns a human-readable reason when the response re-issues one line or
// revisits one row at least `limit` times, "" otherwise. Limits below 2
// disable the check (mirrors normalizeRepetitionLimit: 0/1 turn a tier off).
// The reason names the trigger (and the offending sample) so the log shows
// WHAT looped — otherwise a fast kill leaves no trace of its cause.
function fuzzyLoopReason(content, limit) {
    var lim = Math.floor(Number(limit) || 0);
    if (!(lim >= 2) || !content || typeof content !== "string") return "";
    var lineCounts = {};
    var rowCounts = {};
    var sample = {};
    var lines = content.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var key = lineKey(lines[i]);
        if (key.length < MIN_LINE_CHARS) continue;
        var c = (lineCounts[key] || 0) + 1;
        lineCounts[key] = c;
        if (c >= lim) {
            return "the same line was repeated at least " + c +
                " times in one response (repetition loop), e.g. \"" + key.slice(0, 120) + "\"";
        }
        var ref = primaryRowRef(lines[i]);
        if (ref !== null) {
            var rc = (rowCounts[ref] || 0) + 1;
            rowCounts[ref] = rc;
            if (rc >= lim) {
                var example = sample[ref] || key;
                return "the same row (@" + ref + ") was revisited at least " + rc +
                    " times in one response (repetition loop), e.g. \"" + example.slice(0, 120) + "\"";
            }
            if (!sample[ref]) sample[ref] = key;
        }
    }
    return "";
}

module.exports = { lineKey, primaryRowRef, fuzzyLoopReason, MIN_LINE_CHARS };
