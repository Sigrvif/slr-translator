// www/core/llmRuntime/lib/ModelInfo.js
//
// Content-based GGUF classification. Nothing here looks at a filename: a projector is identified
// by general.type, a DFlash/DSpark draft by its architecture plus the anchor/confidence keys, and
// an MTP head by nextn_predict_layers together with a tensor count far below one tensor per block.
"use strict";
const nodePath = require("path");
const GgufMeta = require("./GgufMeta");

const COMMON_KEYS = [
    "general.type", "general.architecture", "general.name", "general.basename", "general.size_label",
    "general.file_type", "general.quantized_by", "clip.has_vision_encoder", "clip.projector_type"
];
const ARCH_KEYS = ["block_count", "embedding_length", "expert_count", "expert_used_count", "context_length", "nextn_predict_layers", "attention.key_length", "attention.value_length"];
const DFLASH_KEYS = ["sample_from_anchor", "has_confidence_head", "block_size", "target_layers"];

function intOrNull(value) {
    return typeof value === "number" && isFinite(value) ? Math.trunc(value) : null;
}

// tensor_count is the third header field, immediately after magic and version, so this reads 24
// bytes and never touches the (potentially huge) metadata table.
function tensorCountOf(filePath, fs) {
    let fd = null;
    try {
        fd = fs.openSync(filePath, "r");
        const head = Buffer.alloc(24);
        const got = fs.readSync(fd, head, 0, 24, 0);
        if (got < 12) return null;
        if (head.slice(0, 4).toString("ascii") !== GgufMeta.GGUF_MAGIC) return null;
        const version = head.readUInt32LE(4);
        return version === 1 ? head.readUInt32LE(8) : Number(head.readBigUInt64LE(8));
    } catch (err) {
        return null;
    } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch (err) { /* already closed */ } }
    }
}

function flavorFromName(name) {
    const text = String(name || "").toLowerCase();
    if (text.indexOf("dspark") !== -1) return "dspark";
    if (text.indexOf("dflash") !== -1) return "dflash";
    return null;
}

// DSpark and DFlash releases tag themselves. The real DSpark file lists *both* tags, so the
// specific one wins regardless of where it appears in the array: membership, not position,
// matching flavorFromName's order-independent lookup.
function flavorFromTags(tags) {
    if (!Array.isArray(tags)) return null;
    for (let i = 0; i < tags.length; i++) {
        if (String(tags[i] || "").toLowerCase() === "dspark") return "dspark";
    }
    for (let i = 0; i < tags.length; i++) {
        if (String(tags[i] || "").toLowerCase() === "dflash") return "dflash";
    }
    return null;
}

function classifyModel(meta, tensorCount) {
    if (!meta || typeof meta !== "object") return null;
    const arch = meta["general.architecture"] || null;
    const info = {
        kind: "model",
        arch: arch,
        name: meta["general.name"] || null,
        basename: meta["general.basename"] || null,
        sizeLabel: meta["general.size_label"] || null,
        blockCount: arch ? intOrNull(meta[arch + ".block_count"]) : null,
        embeddingLength: arch ? intOrNull(meta[arch + ".embedding_length"]) : null,
        expertCount: arch ? intOrNull(meta[arch + ".expert_count"]) : null,
        expertUsedCount: arch ? intOrNull(meta[arch + ".expert_used_count"]) : null,
        contextLength: arch ? intOrNull(meta[arch + ".context_length"]) : null,
        nextn: arch ? intOrNull(meta[arch + ".nextn_predict_layers"]) : null,
        // The per-layer attention KV widths, in elements. Together with the block count and
        // context length they size the KV cache a start will allocate, which is what the
        // load-mode recommendation's VRAM accounting estimates from.
        attnKeyLength: arch ? intOrNull(meta[arch + ".attention.key_length"]) : null,
        attnValueLength: arch ? intOrNull(meta[arch + ".attention.value_length"]) : null,
        // The GGUF's quantization enum (general.file_type). Exposed raw: the names in
        // llama.cpp's llama_ftype enum are version-dependent, so the number is the value the
        // file actually declares. RuntimeInfo surfaces it as /v1/models meta.ftype.
        fileType: intOrNull(meta["general.file_type"]),
        // The publisher who released the quant (general.quantized_by), surfaced in the UI as a
        // hint of where a file came from.
        publisher: meta["general.quantized_by"] || null,
        tensorCount: typeof tensorCount === "number" ? tensorCount : null,
        specType: null,
        mtpCapable: false,
        targetLayers: null,
        vision: meta["clip.has_vision_encoder"] === true,
        projectorType: meta["clip.projector_type"] || null,
        flavorSource: "none"
    };
    if (meta["general.type"] === "mmproj" || (arch === "clip" && info.vision)) {
        info.kind = "projector";
        return info;
    }
    if (arch === "dflash") {
        info.kind = "draft";
        info.targetLayers = Array.isArray(meta["dflash.target_layers"]) ? meta["dflash.target_layers"].slice() : null;
        const anchor = meta["dflash.sample_from_anchor"];
        const confidence = meta["dflash.has_confidence_head"];
        if (anchor === true || confidence === true) {
            info.specType = "draft-dspark";
            info.flavorSource = "keys";
        } else if (anchor === false || confidence === false) {
            info.specType = "draft-dflash";
            info.flavorSource = "keys";
        } else {
            const tagged = flavorFromTags(meta["general.tags"]);
            if (tagged) {
                info.specType = tagged === "dspark" ? "draft-dspark" : "draft-dflash";
                info.flavorSource = "tags";
            } else {
                const named = flavorFromName(info.name);
                info.specType = named === "dspark" ? "draft-dspark" : "draft-dflash";
                info.flavorSource = named ? "name" : "none";
            }
        }
        return info;
    }
    if (info.nextn !== null && info.nextn >= 1) {
        info.specType = "draft-mtp";
        // A whole model has roughly 9-22 tensors per block; an MTP head has far fewer (the real
        // file: 23 tensors for 41 declared blocks). Below two per block it cannot be a model.
        // A dedicated "<arch>-assistant" architecture is head-only whatever the ratio says: the
        // gemma-4 heads declare "gemma4-assistant" with their own 4 blocks and 49 tensors -
        // 12 per block, comfortably inside whole-model territory - so only the architecture
        // separates them from a real model that carries an embedded head.
        const assistantArch = typeof arch === "string" && /-assistant$/.test(arch);
        const complete = !assistantArch
            && !(info.blockCount && info.tensorCount && info.tensorCount < info.blockCount * 2);
        if (complete) info.mtpCapable = true;
        else info.kind = "mtp-head";
        return info;
    }
    return info;
}

function readModelFile({ filePath, fs, readMetadata }) {
    const read = readMetadata || GgufMeta.readMetadata;
    if (!filePath || !fs) return null;
    const common = read({ filePath: filePath, fs: fs, keys: COMMON_KEYS });
    const arch = common["general.architecture"];
    if (!arch) return null;
    const keys = ARCH_KEYS.map(function (key) { return arch + "." + key; });
    if (arch === "dflash") {
        for (let i = 0; i < DFLASH_KEYS.length; i++) keys.push("dflash." + DFLASH_KEYS[i]);
        // DSpark vs DFlash is decided by the release tags when the anchor/confidence keys are
        // absent, so the tag array is only read for draft architectures.
        keys.push("general.tags");
    }
    const extra = read({ filePath: filePath, fs: fs, keys: keys });
    const info = classifyModel(Object.assign({}, common, extra), tensorCountOf(filePath, fs));
    if (!info) return null;
    let bytes = null;
    try { bytes = fs.statSync(filePath).size; } catch (err) { bytes = null; }
    info.id = nodePath.basename(filePath);
    info.path = filePath;
    info.bytes = bytes;
    return info;
}

module.exports = { COMMON_KEYS, ARCH_KEYS, DFLASH_KEYS, intOrNull, tensorCountOf, classifyModel, readModelFile };
