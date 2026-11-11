// www/core/llmRuntime/tests/ModelInfo.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ModelInfo = require("../lib/ModelInfo");

// A minimal real GGUF writer, including a numeric array value, so readModelFile can be exercised
// through the genuine GgufMeta reader instead of a pre-classified map.
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }
function u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }
function f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; }
function str(s) { const b = Buffer.from(s, "utf8"); return Buffer.concat([u64(b.length), b]); }
function bool(v) { return Buffer.from([v ? 1 : 0]); }
function u32Array(values) {
    const parts = [u32(4), u64(values.length)];
    for (const v of values) parts.push(u32(v));
    return Buffer.concat(parts);
}

function writeDflashGguf(filePath) {
    const kvs = [
        [str("general.architecture"), u32(8), str("dflash")],
        [str("general.name"), u32(8), str("MiniCPM5 2B DSpark")],
        [str("dflash.block_count"), u32(4), u32(5)],
        [str("dflash.embedding_length"), u32(4), u32(2048)],
        [str("dflash.sample_from_anchor"), u32(7), bool(true)],
        [str("dflash.target_layers"), u32(9), u32Array([2, 4])]
    ];
    const parts = [Buffer.from("GGUF", "ascii"), u32(3), u64(0), u64(kvs.length)];
    for (const kv of kvs) parts.push(kv[0], kv[1], kv[2]);
    fs.writeFileSync(filePath, Buffer.concat(parts));
    return filePath;
}

function writeMoeGguf(filePath) {
    const kvs = [
        [str("general.architecture"), u32(8), str("qwen35moe")],
        [str("general.name"), u32(8), str("Qwen3.6 35B A3B")],
        [str("general.file_type"), u32(4), u32(7)],
        [str("qwen35moe.block_count"), u32(4), u32(41)],
        [str("qwen35moe.embedding_length"), u32(4), u32(2048)],
        [str("qwen35moe.expert_count"), u32(4), u32(256)],
        [str("qwen35moe.expert_used_count"), u32(4), u32(8)],
        [str("qwen35moe.context_length"), u32(4), u32(262144)]
    ];
    const parts = [Buffer.from("GGUF", "ascii"), u32(3), u64(0), u64(kvs.length)];
    for (const kv of kvs) parts.push(kv[0], kv[1], kv[2]);
    fs.writeFileSync(filePath, Buffer.concat(parts));
    return filePath;
}

// A tiny writer for arbitrary scalar fields (numbers and strings), for the cases the DFlash and
// MoE writers do not cover. The numeric width is chosen from the value, mirroring the reader's own
// vocabulary (GgufMeta.test.js): a small unsigned integer is written u32, a larger one u64 so it is
// never truncated, and a non-integer is f32.
function writeModelGguf(filePath, fields) {
    const kvs = [];
    for (const key of Object.keys(fields)) {
        const value = fields[key];
        if (typeof value === "number") {
            if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) kvs.push([str(key), u32(4), u32(value)]);
            else if (Number.isInteger(value)) kvs.push([str(key), u32(10), u64(value)]);
            else kvs.push([str(key), u32(6), f32(value)]);
        } else {
            kvs.push([str(key), u32(8), str(value)]);
        }
    }
    const parts = [Buffer.from("GGUF", "ascii"), u32(3), u64(0), u64(kvs.length)];
    for (const kv of kvs) parts.push(kv[0], kv[1], kv[2]);
    fs.writeFileSync(filePath, Buffer.concat(parts));
    return filePath;
}

function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modelinfo-"));
    return path.join(dir, name || "model.gguf");
}

const DFSPARK = {
    "general.architecture": "dflash", "general.type": "model", "general.name": "MiniCPM5 2B DSpark",
    "general.basename": "MiniCPM5", "dflash.block_count": 5, "dflash.embedding_length": 2048,
    "dflash.sample_from_anchor": true, "dflash.has_confidence_head": true,
    "dflash.target_layers": [2, 11, 21, 31, 40]
};
const DFLASH = {
    "general.architecture": "dflash", "general.type": "model", "general.name": "Qwen3.5 4B DFlash",
    "general.basename": "Qwen3.5", "dflash.block_count": 6, "dflash.embedding_length": 2560,
    "dflash.target_layers": [2, 6, 10, 14, 18, 22, 26, 30]
};
const MTP_HEAD = {
    "general.architecture": "qwen35moe", "general.type": "model", "general.name": "Qwen/Qwen3.6-35B-A3B",
    "qwen35moe.block_count": 41, "qwen35moe.embedding_length": 2048, "qwen35moe.nextn_predict_layers": 1
};
const MTP_MODEL = {
    "general.architecture": "qwen35moe", "general.type": "model", "general.name": "Qwen3.6-35B-A3B-Uncensored",
    "qwen35moe.block_count": 41, "qwen35moe.embedding_length": 2048, "qwen35moe.nextn_predict_layers": 1
};
const PLAIN = {
    "general.architecture": "llama", "general.type": "model", "general.name": "Raw_Model",
    "llama.block_count": 42, "llama.embedding_length": 2048
};
const MMPROJ = {
    "general.architecture": "clip", "general.type": "mmproj", "general.name": "KL0.0764 3Ref",
    "general.basename": "KL0.0764", "clip.has_vision_encoder": true, "clip.projector_type": "qwen3vl_merger"
};

test("classifyModel marks an mmproj by general.type", () => {
    const info = ModelInfo.classifyModel(MMPROJ, 334);
    assert.strictEqual(info.kind, "projector");
    assert.strictEqual(info.vision, true);
    assert.strictEqual(info.projectorType, "qwen3vl_merger");
});
test("classifyModel distinguishes DSpark from DFlash by the anchor/confidence keys", () => {
    assert.strictEqual(ModelInfo.classifyModel(DFSPARK, 62).specType, "draft-dspark");
    assert.strictEqual(ModelInfo.classifyModel(DFSPARK, 62).flavorSource, "keys");
    assert.strictEqual(ModelInfo.classifyModel(DFLASH, 69).specType, "draft-dflash");
    // The DFlash fixture carries no anchor/confidence keys, so the flavor is corroborated from
    // the model name and the provenance is "name", not "keys".
    assert.strictEqual(ModelInfo.classifyModel(DFLASH, 69).flavorSource, "name");
});
test("classifyModel calls a compact nextn file an mtp-head and a full one mtp-capable", () => {
    const head = ModelInfo.classifyModel(MTP_HEAD, 23);
    assert.strictEqual(head.kind, "mtp-head");
    assert.strictEqual(head.specType, "draft-mtp");
    assert.strictEqual(head.mtpCapable, false);
    const full = ModelInfo.classifyModel(MTP_MODEL, 753);
    assert.strictEqual(full.kind, "model");
    assert.strictEqual(full.mtpCapable, true);
    assert.strictEqual(full.specType, "draft-mtp");
});
test("classifyModel calls a dedicated -assistant architecture a head whatever the tensor ratio", () => {
    // The real gemma-4 MTP heads declare "gemma4-assistant" with their OWN block count of 4
    // and 49 tensors - 12 per block, comfortably inside whole-model territory - so the
    // tensor-ratio test alone would offer them as standalone models. The architecture is the
    // separator: an assistant release is a head, never a target.
    const GEMMA4_ASSISTANT = {
        "general.architecture": "gemma4-assistant", "general.type": "model",
        "general.name": "Gemma 4 12B It Assistant", "general.basename": "gemma-4",
        "gemma4-assistant.block_count": 4, "gemma4-assistant.embedding_length": 1024,
        "gemma4-assistant.nextn_predict_layers": 4
    };
    const info = ModelInfo.classifyModel(GEMMA4_ASSISTANT, 49);
    assert.strictEqual(info.kind, "mtp-head");
    assert.strictEqual(info.specType, "draft-mtp");
    assert.strictEqual(info.mtpCapable, false);
});
test("classifyModel leaves a plain model with no spec type", () => {
    const info = ModelInfo.classifyModel(PLAIN, 381);
    assert.strictEqual(info.kind, "model");
    assert.strictEqual(info.specType, null);
    assert.strictEqual(info.mtpCapable, false);
});
test("classifyModel falls back to the model name when the flavor keys are absent", () => {
    const named = Object.assign({}, DFLASH, { "general.name": "Something DSpark rocket" });
    const info = ModelInfo.classifyModel(named, 69);
    assert.strictEqual(info.specType, "draft-dspark");
    assert.strictEqual(info.flavorSource, "name");
});
test("a dflash file whose tags say dspark is draft-dspark (flavour from tags)", () => {
    const info = ModelInfo.classifyModel({
        "general.architecture": "dflash", "general.type": "model", "general.name": "Source",
        "general.tags": ["speculative-decoding", "dspark", "dflash", "specforge", "sglang"],
        "dflash.block_count": 5, "dflash.embedding_length": 5120,
        "dflash.target_layers": [5, 17, 29, 41, 53]
    }, 62);
    assert.strictEqual(info.kind, "draft");
    assert.strictEqual(info.specType, "draft-dspark");
    assert.strictEqual(info.flavorSource, "tags");
});
test("tags naming only dflash give draft-dflash", () => {
    const info = ModelInfo.classifyModel({
        "general.architecture": "dflash", "general.type": "model", "general.name": "Source",
        "general.tags": ["dflash", "speculative-decoding"], "dflash.embedding_length": 5120
    }, 62);
    assert.strictEqual(info.specType, "draft-dflash");
    assert.strictEqual(info.flavorSource, "tags");
});
test("tag precedence is by membership, not position: dflash-then-dspark is still draft-dspark", () => {
    const info = ModelInfo.classifyModel({
        "general.architecture": "dflash", "general.type": "model", "general.name": "Source",
        "general.tags": ["dflash", "dspark"], "dflash.embedding_length": 5120
    }, 62);
    assert.strictEqual(info.specType, "draft-dspark");
    assert.strictEqual(info.flavorSource, "tags");
});
test("explicit flavour keys still win over tags", () => {
    const info = ModelInfo.classifyModel({
        "general.architecture": "dflash", "general.type": "model", "general.name": "Source",
        "general.tags": ["dspark"], "dflash.sample_from_anchor": false,
        "dflash.embedding_length": 5120
    }, 62);
    assert.strictEqual(info.specType, "draft-dflash");
    assert.strictEqual(info.flavorSource, "keys");
});

test("readModelFile materialises dflash.target_layers through the real GGUF reader", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modelinfo-target-layers-"));
    const file = writeDflashGguf(path.join(dir, "MiniCPM5-2B-DSpark-Q8_0.gguf"));
    const info = ModelInfo.readModelFile({ filePath: file, fs: fs });
    assert.strictEqual(info.kind, "draft");
    assert.strictEqual(info.arch, "dflash");
    assert.strictEqual(info.specType, "draft-dspark");
    // The C1 regression: before the fix this was always null because every array was skipped.
    assert.deepStrictEqual(info.targetLayers, [2, 4]);
});

test("readModelFile exposes the publisher from general.quantized_by", () => {
    const file = writeModelGguf(tmpFile("pub.gguf"), {
        "general.architecture": "qwen35", "general.type": "model",
        "general.quantized_by": "HauhauCS", "qwen35.block_count": 4
    });
    const info = ModelInfo.readModelFile({ filePath: file, fs: fs });
    assert.strictEqual(info.publisher, "HauhauCS");
});

test("readModelFile reads context_length and expert_used_count through the real GGUF reader", () => {
    assert.ok(ModelInfo.ARCH_KEYS.indexOf("context_length") !== -1);
    assert.ok(ModelInfo.ARCH_KEYS.indexOf("expert_used_count") !== -1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modelinfo-moe-"));
    const file = writeMoeGguf(path.join(dir, "qwen35moe-Q8_0.gguf"));
    const info = ModelInfo.readModelFile({ filePath: file, fs: fs });
    assert.strictEqual(info.arch, "qwen35moe");
    assert.strictEqual(info.blockCount, 41);
    assert.strictEqual(info.contextLength, 262144);
    assert.strictEqual(info.expertCount, 256);
    assert.strictEqual(info.expertUsedCount, 8);
    assert.strictEqual(info.fileType, 7);
});

test("a numeric metadata value above 2^32 survives the round trip through the real GGUF reader", () => {
    const file = writeModelGguf(tmpFile("big.gguf"), {
        "general.architecture": "qwen35", "general.type": "model",
        "qwen35.context_length": 1099511627776
    });
    const info = ModelInfo.readModelFile({ filePath: file, fs: fs });
    assert.strictEqual(info.contextLength, 1099511627776);
});

test("classifyModel reports null context_length and expert_used_count when absent", () => {
    const info = ModelInfo.classifyModel(PLAIN, 381);
    assert.strictEqual(info.contextLength, null);
    assert.strictEqual(info.expertUsedCount, null);
});

// The per-layer attention KV widths feed the load-mode recommendation's VRAM accounting
// (the KV cache estimate), so they travel the same discovery path as the block count.
test("classifyModel exposes the attention K/V widths and reports null when absent", () => {
    const withWidths = ModelInfo.classifyModel(Object.assign({}, PLAIN, {
        "llama.attention.key_length": 512,
        "llama.attention.value_length": 512
    }), 381);
    assert.strictEqual(withWidths.attnKeyLength, 512);
    assert.strictEqual(withWidths.attnValueLength, 512);
    const bare = ModelInfo.classifyModel(PLAIN, 381);
    assert.strictEqual(bare.attnKeyLength, null);
    assert.strictEqual(bare.attnValueLength, null);
});

test("readModelFile materialises the attention widths through the real GGUF reader", () => {
    const file = writeModelGguf(tmpFile("attn.gguf"), {
        "general.architecture": "gemma4", "general.type": "model",
        "gemma4.block_count": 48, "gemma4.embedding_length": 3840,
        "gemma4.attention.key_length": 512, "gemma4.attention.value_length": 512
    });
    const info = ModelInfo.readModelFile({ filePath: file, fs: fs });
    assert.strictEqual(info.blockCount, 48);
    assert.strictEqual(info.attnKeyLength, 512);
    assert.strictEqual(info.attnValueLength, 512);
});

test("classifyModel exposes the GGUF general.file_type enum", () => {
    assert.ok(ModelInfo.COMMON_KEYS.indexOf("general.file_type") !== -1);
    const info = ModelInfo.classifyModel(Object.assign({}, PLAIN, { "general.file_type": 7 }), 381);
    assert.strictEqual(info.fileType, 7);
    // Absent -> null, so the registry can emit "".
    assert.strictEqual(ModelInfo.classifyModel(PLAIN, 381).fileType, null);
});
