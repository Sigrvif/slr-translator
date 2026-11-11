"use strict";
/*
 * Multi-line support for the Find window (Find / Replace / Put tabs).
 *
 * The Find and Replace fields are textareas (newlines via Alt+Enter or paste)
 * and the grid/replace engines match raw substrings, so those two only needed
 * the UI change. The Put engine used to route multi-line keywords into an
 * exact whole-cell index lookup that found nothing unless the keyword was the
 * complete cell; findPut now matches a sequence of lines inside a cell
 * (line-aligned) and replaces those lines in the target column.
 *
 * common.js is requireable from Node. trans-full.js is not (it is a browser
 * script), so Trans.prototype.findPut is extracted verbatim from the source
 * and evaluated here — the test still runs the real production code.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const nwPath = require("path");

// bootstrap the NW.js-ish globals common.js expects at load time
global.window = global;
global.nw = { process: { env: {} }, App: { manifest: { version: "test" } }, Window: { get() {} }, Shell: {} };

const common = require("../common.js");

const JS_ROOT = nwPath.resolve(__dirname, ".."); // .../www/js
const transFullSrc = fs.readFileSync(nwPath.join(JS_ROOT, "trans-full.js"), "utf8");

// --- extract Trans.prototype.findPut verbatim ------------------------------
const startMarker = " Trans.prototype.findPut = function";
const start = transFullSrc.indexOf(startMarker);
assert.ok(start !== -1, "findPut not found in trans-full.js");
const end = transFullSrc.indexOf("class TransProjectHook", start);
assert.ok(end !== -1 && end - start > 1000, "findPut extraction boundaries broken");
const findPutSrc = transFullSrc.substring(start, end);
assert.ok(findPutSrc.includes("common.linesIndex"), "findPut must use common.linesIndex");

// --- minimal Trans stand-in with the production findPut --------------------
function Trans() {
    this.keyColumn = 0;
}
eval(findPutSrc.replace(" Trans.prototype.findPut", "Trans.prototype.findPut"));
Trans.prototype.getAllFiles = function () { return Object.keys(this.project.files); };
Trans.prototype.findAndInsert = function () { throw new Error("rowByRow fallback must not run in these tests"); };
Trans.prototype.hasTags = function () { return false; };
Trans.prototype.slrFixResultFiles = function () {};
Trans.prototype.refreshGrid = function () {};
const trans = new Trans();

function makeProject() {
    return {
        files: {
            "Map001.json": {
                lineBreak: "\n",
                data: [
                    ["Hello\\nWorld", ""],                    // literal \n, not a line break
                    ["multi\nline\noriginal", ""],            // 3-line cell
                    ["single line", ""],
                    ["trailing\n\nempty lines\n\n", ""],      // empty lines inside
                    ["日本語\nテキスト\nです", ""],
                ]
            }
        }
    };
}

function freshTrans() {
    trans.project = makeProject();
    return trans;
}

// ---------------------------------------------------------------------------
// common.linesIndex
// ---------------------------------------------------------------------------

test("linesIndex finds a single line (same contract as lineIndex)", () => {
    assert.equal(common.linesIndex("a\nb\nc", ["b"], true), 1);
    assert.equal(common.linesIndex("a\nb\nc", ["x"], true), -1);
});

test("linesIndex finds a line sequence line-aligned only", () => {
    assert.equal(common.linesIndex("a\nb\nc", ["b", "c"], true), 1);
    // "b\nc" is a plain substring of the cell but "xb" is not the line "b"
    assert.equal(common.linesIndex("xb\nc", ["b", "c"], true), -1);
    assert.equal(common.linesIndex("xb\nxc", ["b", "c"], true), -1);
});

test("linesIndex is case-insensitive by default and ignores trailing whitespace", () => {
    assert.equal(common.linesIndex("A\nB\nC", ["b", "c"]), 1);
    assert.equal(common.linesIndex("A \nB\nC", ["a", "b"]), 0);
    // but leading whitespace still matters
    assert.equal(common.linesIndex("A\nB\nC", [" a", "b"]), -1);
});

test("linesIndex rejects non-string haystacks and empty needles", () => {
    assert.equal(common.linesIndex(null, ["a"]), -1);
    assert.equal(common.linesIndex("a", []), -1);
    assert.equal(common.linesIndex("a", "a"), -1);
});

// ---------------------------------------------------------------------------
// common.replaceLinesAt
// ---------------------------------------------------------------------------

test("replaceLinesAt replaces a run of lines", () => {
    assert.equal(
        common.replaceLinesAt("a\nb\nc", "X\nY", 1, 2, {}),
        "a\nX\nY"
    );
});

test("replaceLinesAt expands the run when value has more lines", () => {
    assert.equal(
        common.replaceLinesAt("a\nb\nc", "X\nY\nZ", 0, 1, {}),
        "X\nY\nZ\nb\nc"
    );
});

test("replaceLinesAt strips carriage returns and honors the join lineBreak", () => {
    assert.equal(
        common.replaceLinesAt("a\r\nb\r\nc\r\nd", "X\r\nY", 1, 2, { lineBreak: "\r\n" }),
        "a\r\nX\r\nY\r\nd"
    );
});

// ---------------------------------------------------------------------------
// Trans.prototype.findPut — the real production function
// ---------------------------------------------------------------------------

test("put with a single line keeps the line-matched behavior", () => {
    const t = freshTrans();
    const result = t.findPut("line", "REPLACED", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 1);
    // "line" sits at line index 1 of the original; the (empty) target cell
    // gets its line 1 replaced, exactly like the pre-existing behavior
    assert.deepEqual(t.project.files["Map001.json"].data[1], ["multi\nline\noriginal", "\nREPLACED"]);
});

test("put with the full multi-line cell rewrites the whole target cell", () => {
    const t = freshTrans();
    const result = t.findPut("Multi\nLine\nOriginal", "TRANSLATED", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 1);
    assert.equal(t.project.files["Map001.json"].data[1][1], "TRANSLATED");
});

test("put with a partial multi-line block replaces just those lines", () => {
    const t = freshTrans();
    const result = t.findPut("multi\nline", "TRANSLATED", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 1);
    // the empty target cell has a single line; replacing the 2 matched lines
    // collapses it to the put text
    assert.deepEqual(t.project.files["Map001.json"].data[1], ["multi\nline\noriginal", "TRANSLATED"]);
});

test("put matches case-insensitively by default and ignores \\r", () => {
    const t = freshTrans();
    const result = t.findPut("MULTI\r\nLINE", "TRANSLATED", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 1);
    assert.equal(t.project.files["Map001.json"].data[1][1], "TRANSLATED");
});

test("put with case sensitive mode skips non-matching case", () => {
    const t = freshTrans();
    const result = t.findPut("MULTI\nLINE", "TRANSLATED", 1, { caseSensitive: true, files: "*", lineMatch: true });
    assert.equal(result.count, 0);
    assert.equal(t.project.files["Map001.json"].data[1][1], "");
});

test("put replaces lines that contain empty lines", () => {
    const t = freshTrans();
    const result = t.findPut("trailing\n\nempty lines", "新", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 1);
    assert.deepEqual(t.project.files["Map001.json"].data[3], ["trailing\n\nempty lines\n\n", "新"]);
});

test("put block replaces the matched run of lines in the target cell", () => {
    const t = freshTrans();
    t.project.files["Map001.json"].data[1][1] = "keep0\nkeep1\nkeep2\nkeep3";
    // the keyword matches lines 0-2 of the original, so lines 0-2 of the
    // target (the aligned run) are replaced by the 2 put lines
    t.findPut("multi\nline\noriginal", "X\nY", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(t.project.files["Map001.json"].data[1][1], "X\nY\nkeep3");
});

test("put with a multi-line keyword does not touch the original column", () => {
    const t = freshTrans();
    const before = JSON.stringify(t.project.files["Map001.json"].data.map(r => r[0]));
    t.findPut("multi\nline", "T", 1, { caseSensitive: false, files: "*", lineMatch: true });
    const after = JSON.stringify(t.project.files["Map001.json"].data.map(r => r[0]));
    assert.equal(after, before);
});

test("put with a multi-line keyword works on CRLF files", () => {
    const t = freshTrans();
    t.project.files["Map001.json"].lineBreak = "\r\n";
    const result = t.findPut("multi\nline", "X\nY", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 1);
    assert.equal(t.project.files["Map001.json"].data[1][1], "X\r\nY");
});

test("put with no match reports count 0 and changes nothing", () => {
    const t = freshTrans();
    const result = t.findPut("multi\nNOT-THERE", "T", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 0);
    assert.deepEqual(t.project.files["Map001.json"].data[1], ["multi\nline\noriginal", ""]);
});

test("put ignores an invalid target column instead of writing into NaN", () => {
    const t = freshTrans();
    const result = t.findPut("multi\nline", "T", NaN, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result, false);
});

test("literal \\n sequences in a cell are not line breaks", () => {
    const t = freshTrans();
    const result = t.findPut("Hello\nWorld", "T", 1, { caseSensitive: false, files: "*", lineMatch: true });
    assert.equal(result.count, 0);
});
