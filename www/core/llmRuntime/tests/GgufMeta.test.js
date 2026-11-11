"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const GgufMeta = require("../lib/GgufMeta");

// --- a tiny GGUF v3 writer, just enough to exercise the reader ---------------------------

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }
function u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }
function str(s) { const b = Buffer.from(s, "utf8"); return Buffer.concat([u64(b.length), b]); }
function i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; }
function f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; }

// One scalar element, used for the array case. Type ids match GGUF's fixed order.
function scalarBuffer(type, value) {
    switch (type) {
        case 0: { const b = Buffer.alloc(1); b.writeUInt8(value); return b; }         // uint8
        case 1: { const b = Buffer.alloc(1); b.writeInt8(value); return b; }          // int8
        case 2: { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }      // uint16
        case 3: { const b = Buffer.alloc(2); b.writeInt16LE(value); return b; }       // int16
        case 4: return u32(value);
        case 5: return i32(value);
        case 6: return f32(value);
        case 7: return Buffer.from([value ? 1 : 0]);                                  // bool
        case 8: return str(value);
        case 10: return u64(value);
        case 11: { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(value)); return b; }
        case 12: { const b = Buffer.alloc(8); b.writeDoubleLE(value); return b; }
        default: throw new Error("unsupported scalar type " + type);
    }
}

// kvs: array of { key, type, value } where value is a JS value (or an array for type 9, whose
// element type defaults to string and can be overridden with `elementType`).
function kvBuffer(entry) {
    const head = Buffer.concat([str(entry.key), u32(entry.type)]);
    switch (entry.type) {
        case 4: return Buffer.concat([head, u32(entry.value)]);          // uint32
        case 5: return Buffer.concat([head, i32(entry.value)]);          // int32
        case 6: return Buffer.concat([head, f32(entry.value)]);          // float32
        case 7: return Buffer.concat([head, Buffer.from([entry.value ? 1 : 0])]); // bool
        case 8: return Buffer.concat([head, str(entry.value)]);          // string
        case 9: {                                                        // array
            const elementType = entry.elementType === undefined ? 8 : entry.elementType;
            const parts = [head, u32(elementType), u64(entry.value.length)];
            for (const item of entry.value) parts.push(scalarBuffer(elementType, item));
            return Buffer.concat(parts);
        }
        default: throw new Error("unsupported test type " + entry.type);
    }
}

function writeGguf(filePath, kvs, version) {
    const v = version || 3;
    const parts = [Buffer.from("GGUF", "ascii"), u32(v), u64(0), u64(kvs.length)];
    for (const entry of kvs) parts.push(kvBuffer(entry));
    fs.writeFileSync(filePath, Buffer.concat(parts));
    return filePath;
}

function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ggufmeta-"));
    return path.join(dir, name || "model.gguf");
}

const T_UINT32 = 4;
const T_STRING = 8;
const T_ARRAY = 9;

// A model whose metadata carries a large string array before the keys we want, so skipping is
// exercised the same way the tokenizer table exercises it in a real file.
function moeKvs() {
    return [
        { key: "general.architecture", type: T_STRING, value: "gemma4" },
        { key: "general.name", type: T_STRING, value: "Test MoE" },
        { key: "tokenizer.ggml.tokens", type: T_ARRAY, value: ["a", "b", "c", "d"] },
        { key: "gemma4.expert_count", type: T_UINT32, value: 128 },
        { key: "gemma4.expert_used_count", type: T_UINT32, value: 8 }
    ];
}

test("readMetadata finds the requested keys and skips arrays on the way", () => {
    const file = writeGguf(tmpFile(), moeKvs());
    const meta = GgufMeta.readMetadata({
        filePath: file, fs,
        keys: ["general.architecture", "gemma4.expert_used_count"]
    });
    assert.deepStrictEqual(meta, { "general.architecture": "gemma4", "gemma4.expert_used_count": 8 });
});

test("readMetadata materialises a requested bounded array of numeric scalars", () => {
    // The C1 regression: dflash.target_layers is an array, and the old reader skipped every
    // array, so a requested array key never reached the caller. This is the exact real shape.
    const file = writeGguf(tmpFile(), [
        { key: "general.architecture", type: T_STRING, value: "dflash" },
        { key: "tokenizer.ggml.tokens", type: T_ARRAY, value: ["a", "b", "c"] },
        { key: "dflash.target_layers", type: T_ARRAY, elementType: T_UINT32, value: [2, 11, 21, 31, 40] }
    ]);
    const meta = GgufMeta.readMetadata({ filePath: file, fs, keys: ["dflash.target_layers"] });
    assert.deepStrictEqual(meta, { "dflash.target_layers": [2, 11, 21, 31, 40] });
});

test("a requested, bounded string array is materialised (general.tags)", () => {
    const file = writeGguf(tmpFile("tags.gguf"), [
        { key: "general.architecture", type: T_STRING, value: "qwen35" },
        { key: "general.tags", type: T_ARRAY, elementType: T_STRING,
          value: ["speculative-decoding", "dspark", "dflash", "text-generation"] }
    ]);
    const meta = GgufMeta.readMetadata({ filePath: file, fs, keys: ["general.tags"] });
    assert.deepStrictEqual(meta, { "general.tags": ["speculative-decoding", "dspark", "dflash", "text-generation"] });
});

test("a string array longer than the cap is still skipped, not read", () => {
    const many = [];
    for (let i = 0; i < 5000; i++) many.push("t" + i);
    const file = writeGguf(tmpFile("big-tags.gguf"), [
        { key: "general.tags", type: T_ARRAY, elementType: T_STRING, value: many }
    ]);
    const meta = GgufMeta.readMetadata({ filePath: file, fs, keys: ["general.tags"] });
    assert.deepStrictEqual(meta, {});
});

test("readMetadata still skips unrequested and non-numeric arrays", () => {
    // A real tokenizer/merge table has tens of thousands of entries, so even a requested string
    // array only stays skipped when it exceeds the cap; a small requested string array is now
    // materialised (see the general.tags test above).
    const merges = [];
    for (let i = 0; i < 5000; i++) merges.push("a" + i + " b");
    const file = writeGguf(tmpFile(), [
        // Requested, but an oversized string array (a tokenizer table): must stay skipped.
        { key: "tokenizer.ggml.merges", type: T_ARRAY, value: merges },
        // Requested, but bool is not a numeric scalar: must stay skipped.
        { key: "dflash.flags", type: T_ARRAY, elementType: 7, value: [true, false] },
        { key: "general.architecture", type: T_STRING, value: "dflash" }
    ]);
    const meta = GgufMeta.readMetadata({
        filePath: file, fs, keys: ["tokenizer.ggml.merges", "dflash.flags", "general.architecture"]
    });
    assert.deepStrictEqual(meta, { "general.architecture": "dflash" });
});

test("readMetadata refuses to materialise an oversized requested array", () => {
    const big = [];
    for (let i = 0; i < 4097; i++) big.push(i);
    const file = writeGguf(tmpFile(), [
        { key: "dflash.target_layers", type: T_ARRAY, elementType: T_UINT32, value: big },
        { key: "general.architecture", type: T_STRING, value: "dflash" }
    ]);
    const meta = GgufMeta.readMetadata({
        filePath: file, fs, keys: ["dflash.target_layers", "general.architecture"]
    });
    assert.deepStrictEqual(meta, { "general.architecture": "dflash" });
});

test("readModelInfo reports architecture and expert counts", () => {
    const file = writeGguf(tmpFile(), moeKvs());
    assert.deepStrictEqual(GgufMeta.readModelInfo({ filePath: file, fs }), {
        arch: "gemma4",
        name: "Test MoE",
        expertCount: 128,
        expertUsedCount: 8
    });
});

test("readModelInfo reports null counts for a dense model", () => {
    const file = writeGguf(tmpFile(), [
        { key: "general.architecture", type: T_STRING, value: "qwen35" },
        { key: "general.name", type: T_STRING, value: "Dense" },
        { key: "qwen35.block_count", type: T_UINT32, value: 30 }
    ]);
    assert.deepStrictEqual(GgufMeta.readModelInfo({ filePath: file, fs }), {
        arch: "qwen35", name: "Dense", expertCount: null, expertUsedCount: null
    });
});

test("readModelInfo returns null when the file has no architecture", () => {
    const file = writeGguf(tmpFile(), [{ key: "general.name", type: T_STRING, value: "No arch" }]);
    assert.strictEqual(GgufMeta.readModelInfo({ filePath: file, fs }), null);
});

test("readMetadata returns nothing for a missing file or a non-GGUF file", () => {
    assert.deepStrictEqual(
        GgufMeta.readMetadata({ filePath: path.join(os.tmpdir(), "definitely-not-here.gguf"), fs, keys: ["general.architecture"] }),
        {}
    );
    const notGguf = tmpFile("plain.bin");
    fs.writeFileSync(notGguf, "this is not a GGUF file at all");
    assert.deepStrictEqual(GgufMeta.readMetadata({ filePath: notGguf, fs, keys: ["general.architecture"] }), {});
    assert.strictEqual(GgufMeta.readModelInfo({ filePath: notGguf, fs }), null);
});

test("readMetadata stops at the byte budget instead of scanning a huge file", () => {
    const file = writeGguf(tmpFile(), moeKvs());
    // A budget far too small to reach the expert keys: it must give up quietly, not throw.
    const meta = GgufMeta.readMetadata({
        filePath: file, fs, keys: ["gemma4.expert_used_count"], maxBytes: 8
    });
    assert.deepStrictEqual(meta, {});
});

test("readMetadata with no keys requested does no work", () => {
    const file = writeGguf(tmpFile(), moeKvs());
    assert.deepStrictEqual(GgufMeta.readMetadata({ filePath: file, fs, keys: [] }), {});
});

test("readMetadata handles a GGUF v1 header, where lengths and counts are 32-bit", () => {
    // v1 uses u32 for the string length and the kv count; build one by hand.
    const parts = [Buffer.from("GGUF", "ascii"), u32(1), u64(0), u32(1)];
    const key = Buffer.from("general.architecture", "utf8");
    parts.push(u32(key.length), key, u32(T_STRING));
    const value = Buffer.from("llama", "utf8");
    parts.push(u32(value.length), value);
    const file = tmpFile("v1.gguf");
    fs.writeFileSync(file, Buffer.concat(parts));
    assert.deepStrictEqual(
        GgufMeta.readMetadata({ filePath: file, fs, keys: ["general.architecture"] }),
        { "general.architecture": "llama" }
    );
});

test("expertUsedCountKey builds the architecture-prefixed metadata key", () => {
    assert.strictEqual(GgufMeta.expertUsedCountKey("gemma4"), "gemma4.expert_used_count");
    assert.strictEqual(GgufMeta.expertUsedCountKey("llama"), "llama.expert_used_count");
    assert.strictEqual(GgufMeta.expertUsedCountKey(""), null);
    assert.strictEqual(GgufMeta.expertUsedCountKey(null), null);
});

test("a Qwen MoE model keys off its real architecture, not a guessed 'qwen'", () => {
    // llama.cpp resolves the key as "<arch>.expert_used_count", and Qwen MoE architectures are
    // qwen2moe / qwen3moe / qwen35moe. A hand-written "qwen.expert_used_count" would be
    // silently ignored, which is why the app reads the architecture from the file.
    const file = writeGguf(tmpFile(), [
        { key: "general.architecture", type: T_STRING, value: "qwen3moe" },
        { key: "general.name", type: T_STRING, value: "Qwen3.6 35B A3B" },
        { key: "qwen3moe.expert_count", type: T_UINT32, value: 128 },
        { key: "qwen3moe.expert_used_count", type: T_UINT32, value: 8 }
    ]);
    const info = GgufMeta.readModelInfo({ filePath: file, fs });
    assert.strictEqual(info.arch, "qwen3moe");
    assert.strictEqual(info.expertCount, 128);
    assert.strictEqual(info.expertUsedCount, 8);
    assert.strictEqual(GgufMeta.expertUsedCountKey(info.arch), "qwen3moe.expert_used_count");
    assert.notStrictEqual(GgufMeta.expertUsedCountKey(info.arch), "qwen.expert_used_count");
});
