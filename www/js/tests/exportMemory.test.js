"use strict";
/*
 * Export memory hardening:
 *  1. ParserBase.disableAccumulators — export/write mode parsers only need the
 *     translated return value of registerString, not the translation-table
 *     accumulators (translatableTexts / transData / writableData). Those
 *     accumulators are what make exporting a huge CommonEvents.json cost
 *     hundreds of MB of extra heap.
 *  2. common.writeJSONStream — serialize a top-level JSON array straight to a
 *     file in chunks instead of building one giant JSON.stringify string (and
 *     applies the exact same marker cleanup filePutContents applies).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const nwPath = require("path");

// bootstrap the NW.js-ish globals common.js expects at load time
global.window = global;
global.nw = { process: { env: {} }, App: { manifest: { version: "test" } }, Window: { get() {} }, Shell: {} };

const common = require("../common.js");
const { ParserBase } = require("../ParserBase.js");

// registerStringObject lives on RMMVData (www/core/rmmv/rmmv.js); reproduced
// here verbatim so the test runs against the base class alone
class TestParser extends ParserBase {
    registerStringObject(obj, key, context, parameters, options) {
        var translation = this.registerString(obj[key], context, parameters, options);
        obj[key] = translation;
        return translation;
    }
}

function tempDir() {
    return fs.mkdtempSync(nwPath.join(os.tmpdir(), "slrexport-"));
}

// ---------------------------------------------------------------------------
// 1. ParserBase.disableAccumulators
// ---------------------------------------------------------------------------

test("registerString accumulates rows by default (control)", () => {
    const p = new TestParser("script", {});
    p.setTranslationPair({ "こんにちは": "hello" });
    const out = p.registerString("こんにちは", ["ctx"]);
    assert.equal(out, "hello");
    assert.equal(p.translatableTexts.length, 1);
    assert.equal(p.transData.data.length, 1);
    assert.equal(p.writableData.length, 1);
});

test("registerString with disableAccumulators leaves the accumulators empty", () => {
    const p = new TestParser("script", { disableAccumulators: true });
    p.setTranslationPair({ "こんにちは": "hello" });
    const out = p.registerString("こんにちは", ["ctx"]);
    // the translation itself must still work
    assert.equal(out, "hello");
    // but nothing may be accumulated
    assert.equal(p.translatableTexts.length, 0, "translatableTexts must stay empty");
    assert.equal(p.transData.data.length, 0, "transData.data must stay empty");
    assert.equal(p.writableData.length, 0, "writableData must stay empty");
});

test("registerStringObject with disableAccumulators still writes the translation into the target object", () => {
    const p = new TestParser("script", { disableAccumulators: true });
    p.setTranslationPair({ "はい": "Yes" });
    const target = { name: "はい" };
    const out = p.registerStringObject(target, "name", ["ctx"]);
    assert.equal(out, "Yes");
    assert.equal(target.name, "Yes");
});

test("registerString with disableAccumulators still returns the original when no translation exists", () => {
    const p = new TestParser("script", { disableAccumulators: true });
    p.setTranslationPair({});
    const out = p.registerString("テスト", ["ctx"]);
    assert.equal(out, "テスト");
});

// ---------------------------------------------------------------------------
// 2. common.writeJSONStream
// ---------------------------------------------------------------------------

const sampleEvents = [
    null,
    { id: 1, name: "イベント", switchId: 1, trigger: 0, list: [
        { code: 101, indent: 0, parameters: ["", 0, 0, 2, ""] },
        { code: 401, indent: 0, parameters: ["「セリフのテスト」\nsecond \"line\" with \\backslash"] },
        { code: 0, indent: 0, parameters: [] },
    ] },
    { id: 2, name: "numeric marker row", list: [
        { code: 122, indent: 1, parameters: [501, 501, 0, 4, "0　　　　SLRnumbah"] },
        { code: 122, indent: 0, parameters: [502, 502, 0, 4, "1500　　　　SLRnumbah"] },
    ] },
    { id: 3, name: "empties", list: [], note: "", flags: {} },
];

test("common.writeJSONStream must exist", () => {
    assert.equal(typeof common.writeJSONStream, "function");
});

async function assertStreamMatchesFilePutContents(data, indent, label) {
    const dir = tempDir();
    try {
        const referenceFile = nwPath.join(dir, "reference.json");
        const streamFile = nwPath.join(dir, "stream.json");
        await common.filePutContents(referenceFile, JSON.stringify(data, undefined, indent), "UTF-8", false);
        assert.equal(typeof common.writeJSONStream, "function", "writeJSONStream must exist (test: " + label + ")");
        await common.writeJSONStream(streamFile, data, { indent: indent, encoding: "UTF-8", bom: false });
        const reference = fs.readFileSync(referenceFile);
        const streamed = fs.readFileSync(streamFile);
        assert.ok(streamed.length > 0, label + ": streamed file must not be empty");
        assert.deepEqual(streamed, reference, label + ": streamed output must be byte-identical to the filePutContents reference");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test("writeJSONStream matches filePutContents (compact array with edge values)", async () => {
    await assertStreamMatchesFilePutContents(sampleEvents, undefined, "compact");
});

test("writeJSONStream matches filePutContents (indented array)", async () => {
    await assertStreamMatchesFilePutContents(sampleEvents, 2, "indent2");
});

test("writeJSONStream matches filePutContents (empty array)", async () => {
    await assertStreamMatchesFilePutContents([], 2, "empty-indent");
    await assertStreamMatchesFilePutContents([], undefined, "empty-compact");
});

test("writeJSONStream matches filePutContents (array with undefined entries)", async () => {
    const arr = [{ a: 1 }, undefined, { b: "x" }];
    const dir = tempDir();
    try {
        const referenceFile = nwPath.join(dir, "reference.json");
        const streamFile = nwPath.join(dir, "stream.json");
        await common.filePutContents(referenceFile, JSON.stringify(arr, undefined, 2), "UTF-8", false);
        await common.writeJSONStream(streamFile, arr, { indent: 2, encoding: "UTF-8", bom: false });
        assert.deepEqual(fs.readFileSync(streamFile), fs.readFileSync(referenceFile));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("writeJSONStream matches filePutContents (non-array top level falls back)", async () => {
    const obj = { gameTitle: "テスト", advanced: { mainFontFilename: "mplus.ttf" }, num: [1, 2, 3] };
    await assertStreamMatchesFilePutContents(obj, 2, "object-indent");
    await assertStreamMatchesFilePutContents(obj, undefined, "object-compact");
});

test("writeJSONStream matches filePutContents (BOM requested)", async () => {
    const dir = tempDir();
    try {
        const referenceFile = nwPath.join(dir, "reference.json");
        const streamFile = nwPath.join(dir, "stream.json");
        await common.filePutContents(referenceFile, JSON.stringify(sampleEvents, undefined, 2), "UTF-8", true);
        await common.writeJSONStream(streamFile, sampleEvents, { indent: 2, encoding: "UTF-8", bom: true });
        const reference = fs.readFileSync(referenceFile);
        const streamed = fs.readFileSync(streamFile);
        assert.deepEqual(streamed.slice(0, 3), Buffer.from([0xEF, 0xBB, 0xBF]), "BOM must be written");
        assert.deepEqual(streamed, reference, "BOM output must be byte-identical");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// deterministic fuzz: random event-like structures must serialize identically
test("writeJSONStream matches JSON.stringify on fuzzed structures (compact + indent)", async () => {
    let seed = 0x9E3779B9;
    const rnd = () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const chars = "abcXYZ 0.-_\"\\\n\t日本語セルフ«§";
    const randString = () => {
        let s = "";
        const n = Math.floor(rnd() * 30);
        for (let i = 0; i < n; i++) s += chars[Math.floor(rnd() * chars.length)];
        return s;
    };
    const randValue = (depth) => {
        const r = rnd();
        if (depth <= 0 || r < 0.35) {
            if (r < 0.1) return Math.floor(rnd() * 100000);
            if (r < 0.2) return rnd() < 0.5;
            if (r < 0.25) return null;
            return randString();
        }
        if (r < 0.7) {
            const arr = [];
            const n = Math.floor(rnd() * 6);
            for (let i = 0; i < n; i++) arr.push(randValue(depth - 1));
            return arr;
        }
        const obj = {};
        const n = Math.floor(rnd() * 5) + 1;
        for (let i = 0; i < n; i++) obj["k" + i + randString().slice(0, 3)] = randValue(depth - 1);
        return obj;
    };
    const fuzz = [];
    for (let e = 0; e < 400; e++) {
        const ev = { id: e + 1, name: randString(), list: [] };
        const n = Math.floor(rnd() * 5);
        for (let i = 0; i < n; i++) ev.list.push({ code: Math.floor(rnd() * 700), indent: Math.floor(rnd() * 4), parameters: [randValue(3)] });
        if (rnd() < 0.1) fuzz.push(null); else fuzz.push(ev);
    }
    await assertStreamMatchesFilePutContents(fuzz, undefined, "fuzz-compact");
    await assertStreamMatchesFilePutContents(fuzz, 2, "fuzz-indent");
});
