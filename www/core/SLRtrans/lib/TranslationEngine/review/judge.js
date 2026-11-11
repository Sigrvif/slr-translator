"use strict";
const VERDICT_RE = /^VERDICT[：:]\s*(\S+)\s*$/m;
const WHY_RE = /^WHY[：:]\s*(.+)$/m;

// v1 supports dismiss|redo only; a `fix` verdict is deferred until the
// deterministic gate stack can re-verify a proposed replacement, so it is
// treated as malformed and the finding stays unadjudicated (QC tag kept).
function parseVerdict(text) {
    const vm = VERDICT_RE.exec(text || "");
    if (!vm) return null;
    const verdict = vm[1].trim().toLowerCase();
    if (verdict !== "dismiss" && verdict !== "redo") return null;
    const wm = WHY_RE.exec(text);
    const why = wm ? wm[1].trim() : null;
    if (verdict === "redo" && !why) return null;
    return { verdict, why };
}

module.exports = { parseVerdict };
