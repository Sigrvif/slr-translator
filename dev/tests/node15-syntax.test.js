"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { findForeignSyntax } = require("../check-node15-syntax.js");

// Resolve acorn explicitly so the focused tests pass from any cwd (the shared dev/ directory has
// no node_modules above it). If this cannot resolve, the tests fail with a clear message rather
// than silently skipping.
function loadTestAcorn() {
    const candidates = [
        "acorn",
        path.resolve(__dirname, "..", "..", "node_modules", "acorn"),
        "/workspaces/dev/SLR Translator Linux/node_modules/acorn",
        "/workspaces/dev/SLR Translator/node_modules/acorn",
        path.resolve(process.cwd(), "node_modules", "acorn")
    ];
    const tried = [];
    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch (err) {
            tried.push(candidate + " -> " + err.message);
        }
    }
    throw new Error("node15-syntax.test.js: unable to resolve acorn; tried: " + tried.join("; "));
}

const acorn = loadTestAcorn();

function detect(source) {
    return findForeignSyntax(source, acorn);
}

// --- The rule set: runtime APIs the shipped engine lacks ---

test("flags the runtime APIs the shipped engine lacks", () => {
    const cases = [
        ["var x = [1,2].at(-1);", "Array.prototype.at"],
        ["var x = Object.hasOwn(o, 'k');", "Object.hasOwn"],
        ["var x = structuredClone(o);", "structuredClone"],
        ["var x = [1].findLast(f);", "Array.prototype.findLast"],
        ["var x = [1].toSorted();", "Array.prototype.toSorted"],
        ["var x = [1].group(f);", "Array.prototype.group"],
        ["var x = Object.groupBy(o, f);", "Object.groupBy"]
    ];
    for (const pair of cases) {
        assert.deepStrictEqual(detect(pair[0] + "\n"), [
            { line: 1, text: pair[0], rule: pair[1] }
        ], pair[0]);
    }
});

test("does not flag operators the shipped engine parses", () => {
    const ok = [
        "var a = b ?? c;",
        "var a = b?.c;",
        "var a = 1; a ??= 2;",
        "var a = 1; a ||= 2;",
        "var a = 1; a &&= 2;"
    ];
    for (const src of ok) {
        assert.deepStrictEqual(detect(src + "\n"), [], src);
    }
});

test("does not flag ordinary method calls and supported syntax", () => {
    const clean = [
        "var x = a && a.b ? a.b : null;",
        "const y = typeof a === 'string' ? a.trim() : '';",
        "if (!opt || opt.loadMode === undefined) return null;",
        "const z = list.filter(function (e) { return e && e.id; });",
        "const s = arr[arr.length - 1];",
        "var n = obj.grouping(x);",
        "var m = api.atlas(1);"
    ].join("\n");
    assert.deepStrictEqual(detect(clean), []);
});

test("does not flag inherited Object.prototype members used as ordinary calls", () => {
    const ok = [
        "var s = err.toString();",
        "var s = obj.hasOwnProperty('k');",
        "var s = arr.constructor(1);",
        "var s = x.valueOf();",
        "var s = x.toLocaleString();",
        "var s = x.isPrototypeOf(o);",
        "var s = x.propertyIsEnumerable('k');"
    ];
    for (const src of ok) {
        assert.deepStrictEqual(detect(src + "\n"), [], src);
    }
});

test("flags optional-chained calls to the missing runtime APIs", () => {
    const cases = [
        ["var x = arr?.at(0);", "Array.prototype.at"],
        ["var x = arr?.findLast(f);", "Array.prototype.findLast"],
        ["var x = Object?.hasOwn(o, 'k');", "Object.hasOwn"]
    ];
    for (const pair of cases) {
        assert.deepStrictEqual(detect(pair[0] + "\n"), [
            { line: 1, text: pair[0], rule: pair[1] }
        ], pair[0]);
    }
});

test("ignores API-looking text inside comments and string literals", () => {
    assert.deepStrictEqual(detect("// arr.findLast(f)\n"), []);
    assert.deepStrictEqual(detect("/* Object.hasOwn(o, k) */\n"), []);
    assert.deepStrictEqual(detect("const s = 'arr.toSorted()';\n"), []);
    assert.deepStrictEqual(detect("const s = 'a ?? b';\n"), []);
});

test("reports every offending line, not just the first", () => {
    const found = detect("const a = arr.findLast(f);\nconst d = arr.toSorted();\n");
    assert.deepStrictEqual(found.map((f) => f.line), [1, 2]);
});

// --- Template literals: interpolation is code, text is not ---

test("flags an API call inside a template interpolation", () => {
    const found = detect("var s = `x${a.findLast(f)}y`;\n");
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 1);
    assert.strictEqual(found[0].rule, "Array.prototype.findLast");
});

test("flags an API call inside nested template interpolations", () => {
    const found = detect("var s = `${ a ? `${b.at(0)}` : d }`;\n");
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 1);
});

test("does not flag API-looking text that is only template literal content", () => {
    assert.deepStrictEqual(detect("var s = `a.findLast(f)`;\n"), []);
});

test("keeps line numbers accurate for multi-line templates", () => {
    const found = detect("var s = `line one\ntext findLast\n${a.toSorted()}`;\n");
    assert.deepStrictEqual(found.map((f) => f.line), [3]);
});

// --- Regex literals must not cascade or be treated as code ---

test("does not cascade after a regex containing the block-comment opener", () => {
    const found = detect("var r = /[/*]/;\nvar q = a.findLast(f);\n");
    assert.deepStrictEqual(found.map((f) => f.line), [2]);
});

test("does not flag API-looking text inside regex literals", () => {
    assert.deepStrictEqual(detect("var r = /a.at(x)/;\n"), []);
    assert.deepStrictEqual(detect("var r = /\\.findLast\\(/;\n"), []);
    assert.deepStrictEqual(detect("var r = /a??/;\n"), []);
});

test("treats a slash after an expression as division, not a regex", () => {
    assert.deepStrictEqual(detect("var r = a / b;\n"), []);
});

test("handles division followed by a regex literal without swallowing later code", () => {
    assert.deepStrictEqual(detect("var r = a / /re/;\n"), []);
    const found = detect("var r = a / /re/;\nvar q = a.findLast(f);\n");
    assert.deepStrictEqual(found.map((f) => f.line), [2]);
});

test("treats a slash after a call or index expression as division", () => {
    assert.deepStrictEqual(detect("var r = f(x) / 2;\n"), []);
    assert.deepStrictEqual(detect("var r = a[0] / 2;\n"), []);
    assert.deepStrictEqual(detect("var r = { a: 1 } / 2;\n"), []);
});

// --- Division adjacent to a comment ---

test("keeps a line comment after division from hiding later code", () => {
    const found = detect("var x = a / b; // it's fine\nvar q = c.findLast(f);\n");
    assert.deepStrictEqual(found, [
        { line: 2, text: "var q = c.findLast(f);", rule: "Array.prototype.findLast" }
    ]);
});

test("keeps a block comment after division from hiding later code", () => {
    const found = detect("var x = a / b; /* do not do this */\nvar q = c.findLast(f);\n");
    assert.deepStrictEqual(found, [
        { line: 2, text: "var q = c.findLast(f);", rule: "Array.prototype.findLast" }
    ]);
});

test("does not flag API-looking text inside a line comment after division", () => {
    assert.deepStrictEqual(detect("var x = a / b; // note findLast here\n"), []);
});

test("does not flag API-looking text inside a block comment after division", () => {
    assert.deepStrictEqual(detect("var x = a / b; /* c.findLast(f) */\n"), []);
});

test("treats two division slashes on one line as division, not a regex", () => {
    assert.deepStrictEqual(detect("var x = a / b / c;\n"), []);
});

test("flags an API call after a postfix increment and division", () => {
    const found = detect("var q = a++ / b.findLast(c) / d;\n");
    assert.deepStrictEqual(found, [
        { line: 1, text: "var q = a++ / b.findLast(c) / d;", rule: "Array.prototype.findLast" }
    ]);
});

// --- Mechanics that must keep working ---

test("returns nothing for empty and comment-only input", () => {
    assert.deepStrictEqual(detect(""), []);
    assert.deepStrictEqual(detect("// just a comment\n"), []);
    assert.deepStrictEqual(detect("/* only a block comment */\n"), []);
});

test("keeps line numbers for late lines and CRLF sources", () => {
    const late = "var a = 1;\nvar b = 2;\nvar c = 3;\nvar d = arr.findLast(f);\n";
    assert.deepStrictEqual(detect(late).map((f) => f.line), [4]);

    const crlf = "var a = 1;\r\nvar b = arr.toSorted();\r\n";
    const found = detect(crlf);
    assert.deepStrictEqual(found.map((f) => f.line), [2]);
    assert.strictEqual(found[0].text, "var b = arr.toSorted();");
});

test("preserves line numbers across an escaped newline in a string", () => {
    const found = detect("var s = \"a\\\nb\";\nvar q = a.findLast(f);\n");
    assert.deepStrictEqual(found.map((f) => f.line), [3]);
});

test("does not flag API-looking text inside a URL-like string literal", () => {
    assert.deepStrictEqual(detect("var u = \"http://x.findLast(y)\";\n"), []);
});

test("any .at( call is reported (conservative; tokens cannot tell user methods apart)", () => {
    assert.strictEqual(detect("var x = registry.at(key);\n").length, 1);
});

test("throws instead of reporting OK when the source cannot be tokenized", () => {
    assert.throws(function () {
        detect("var x = @;\n");
    }, /Unexpected character/);
});

test("does not flag its own source", () => {
    const ownPath = path.join(__dirname, "..", "check-node15-syntax.js");
    const own = fs.readFileSync(ownPath, "utf8");
    assert.deepStrictEqual(detect(own), []);
});
