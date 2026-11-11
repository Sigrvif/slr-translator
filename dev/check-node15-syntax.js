// dev/check-node15-syntax.js
"use strict";
// NOTE: the filename is historical. This file does NOT check syntax.
//
// The shipped console runtime executes on the Node embedded in NW.js 89, which is Node 15.12.0
// (V8 8.9.255.24). Probing that engine shows it PARSES the modern operators some of us reach for
// out of habit: `??`, `?.`, `??=`, `||=` and `&&=` all load fine there. Flagging them would only
// push future code toward archaic syntax for no benefit, so this guard does NOT flag them, and
// tests lock that in so the wrong rule set cannot come back.
//
// What the shipped engine genuinely lacks is a set of runtime APIs: those references parse and
// then throw ("is not a function") when called, which is the realistic way shipped code breaks.
// This guard flags references to the missing APIs listed in MEMBER_RULES / structuredClone below.
//
// Syntax compatibility is NOT this guard's job and cannot be proven by a static check. It is
// enforced separately and categorically by running the console runtime on the real engine.
//
// Detection is done with acorn's tokenizer rather than a hand-rolled scanner. Comments, string
// literals, template-literal text (including `${}` interpolations), and regex literals all come
// back as distinct token types, so they are classified structurally instead of guessed at.
//
// If acorn cannot be loaded, or a file cannot be tokenized, the guard FAILS and exits non-zero.
// It must never print OK for a source it could not actually check.
//
// The guard's own source runs on Node 15.12.0, so it must not itself use the APIs it flags
// (Object.hasOwn, structuredClone, Array.prototype.at, Array.prototype.findLast, etc.).
const fs = require("fs");
const path = require("path");

// Load acorn from, in order: (a) normal resolution (works when this file lives in an app copy's
// dev/, e.g. <app>/node_modules/acorn), (b) <targetDir>/node_modules/acorn when a target dir was
// given (the documented invocation passes ".", the app root), (c) <scriptDir>/../node_modules/acorn
// (covers running the shared /workspaces/dev/dev copy), (d) <cwd>/node_modules/acorn. Throws a
// clear error listing every path tried if none load.
var cachedAcorn = null;

function loadAcorn(targetDir) {
    if (cachedAcorn) return cachedAcorn;
    var tried = [];

    try {
        cachedAcorn = require("acorn");
        return cachedAcorn;
    } catch (err) {
        tried.push("require('acorn') -> " + err.message);
    }

    if (targetDir) {
        var besideTarget = path.resolve(targetDir, "node_modules", "acorn");
        try {
            cachedAcorn = require(besideTarget);
            return cachedAcorn;
        } catch (err) {
            tried.push(besideTarget + " -> " + err.message);
        }
    }

    var besideScript = path.join(__dirname, "..", "node_modules", "acorn");
    try {
        cachedAcorn = require(besideScript);
        return cachedAcorn;
    } catch (err) {
        tried.push(besideScript + " -> " + err.message);
    }

    var besideCwd = path.join(process.cwd(), "node_modules", "acorn");
    try {
        cachedAcorn = require(besideCwd);
        return cachedAcorn;
    } catch (err) {
        tried.push(besideCwd + " -> " + err.message);
    }

    throw new Error("check-node15-syntax: unable to load acorn; tried: " + tried.join("; "));
}

// The runtime APIs the shipped engine lacks. Each entry is a member call: a "." token, then the
// name token, then a "(". `structuredClone` is a bare identifier call and is handled separately.
// These references parse fine, so a syntax check cannot catch them; they fail at call time.
// Null-prototype table and an own-property lookup: an ordinary object literal would inherit from
// Object.prototype, so a call like err.toString() would wrongly match an inherited member. Note we
// cannot use Object.hasOwn here - the guard runs on the engine that lacks it.
var MEMBER_RULES = Object.create(null);
MEMBER_RULES["hasOwn"] = "Object.hasOwn";
MEMBER_RULES["findLast"] = "Array.prototype.findLast";
MEMBER_RULES["toSorted"] = "Array.prototype.toSorted";
MEMBER_RULES["group"] = "Array.prototype.group";
MEMBER_RULES["groupBy"] = "Object.groupBy";
MEMBER_RULES["at"] = "Array.prototype.at";

function ruleForTokens(tokens, i) {
    var tok = tokens[i];
    if (tok.type.label !== "name") return null;
    var next = i + 1 < tokens.length ? tokens[i + 1] : null;
    if (!next || next.type.label !== "(") return null;
    var prev = i > 0 ? tokens[i - 1] : null;
    // `?.` is a member-access operator here too, so `x.at(0)` and `x?.at(0)` both match.
    // `?.` alone (a?.b) is not a rule; it only matters when a flaggable name follows.
    if (prev && (prev.type.label === "." || prev.type.label === "?.")) {
        if (Object.prototype.hasOwnProperty.call(MEMBER_RULES, tok.value)) {
            return MEMBER_RULES[tok.value];
        }
        return null;
    }
    if (tok.value === "structuredClone") return "structuredClone";
    return null;
}

// `acornOverride` lets callers (tests) inject a resolved acorn explicitly; when omitted, acorn is
// loaded on demand. The public signature findForeignSyntax(sourceText) keeps working.
function findForeignSyntax(sourceText, acornOverride) {
    var src = String(sourceText || "");
    var acorn = acornOverride || loadAcorn();
    var rawLines = src.split("\n");
    var found = [];
    var seenLines = {};

    var tokens = [];
    var tokenizer = acorn.tokenizer(src, { ecmaVersion: 2022, locations: true });
    for (;;) {
        var token = tokenizer.getToken();
        if (token.type.label === "eof") break;
        tokens.push(token);
    }

    for (var i = 0; i < tokens.length; i++) {
        var tok = tokens[i];
        var rule = ruleForTokens(tokens, i);

        if (!rule) continue;

        var line = tok.loc.start.line;
        if (seenLines[line]) continue; // one report per line, as before
        seenLines[line] = true;
        found.push({ line: line, text: (rawLines[line - 1] || "").trim(), rule: rule });
    }

    return found;
}

// The files the console runtime ships. Kept explicit rather than globbed so the guard cannot
// silently stop covering a file because it was renamed.
const TARGETS = [
    "www/core/llmRuntime/lib/ConsoleApp.js",
    "www/core/llmRuntime/lib/RuntimeState.js",
    "www/core/llmRuntime/lib/StartConfig.js",
    "www/core/llmRuntime/lib/Ports.js",
    "www/core/llmRuntime/lib/RuntimeManager.js",
    "www/core/llmRuntime/lib/RuntimeStatus.js",
    "dev/slr-runtime.js"
];

function checkFiles(dir, list) {
    const results = [];
    // Resolve acorn for this target dir before touching files, so a missing tokenizer always
    // fails loudly even when no target file exists.
    const acorn = loadAcorn(dir);
    for (const rel of list) {
        const full = path.join(dir, rel);
        if (!fs.existsSync(full)) continue;
        const found = findForeignSyntax(fs.readFileSync(full, "utf8"), acorn);
        for (const f of found) results.push({ file: rel, line: f.line, text: f.text, rule: f.rule });
    }
    return results;
}

function main(argv) {
    const dir = argv[2] || process.cwd();
    var results;
    try {
        results = checkFiles(dir, TARGETS);
    } catch (err) {
        console.log("Node 15 syntax check: ERROR");
        console.log("  " + (err && err.message ? err.message : String(err)));
        return 2;
    }
    if (!results.length) {
        console.log("Node 15 syntax check: OK");
        return 0;
    }
    console.log("Node 15 syntax check: FAILED");
    for (const r of results) {
        console.log("  " + r.file + ":" + r.line + "  " + r.rule + "  " + r.text);
    }
    return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { findForeignSyntax, checkFiles, TARGETS, loadAcorn };
