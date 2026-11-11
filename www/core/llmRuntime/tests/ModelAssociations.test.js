// www/core/llmRuntime/tests/ModelAssociations.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../lib/ModelAssociations");

function info(id, extra) { return Object.assign({ id: id, kind: "model", specType: null }, extra); }

const DFLASH = info("qwen35-4b-dflash-Q8_0.gguf", { kind: "draft", arch: "dflash", emb: 2560,
    embeddingLength: 2560, blockCount: 6, targetLayers: [2, 6, 10, 14, 18, 22, 26, 30],
    name: "Qwen3.5 4B DFlash", basename: "Qwen3.5", specType: "draft-dflash" });
const PAPERWITCH = info("qwen35-4b-paperwitch-q8.gguf", { arch: "qwen35", embeddingLength: 2560,
    blockCount: 32, name: "Model" });
const DSPARK = info("MiniCPM5-2B-DSpark-Q8_0.gguf", { kind: "draft", arch: "dflash",
    embeddingLength: 2048, blockCount: 5, targetLayers: [2, 11, 21, 31, 40],
    name: "MiniCPM5 2B DSpark", basename: "MiniCPM5", specType: "draft-dspark" });
const MINICPM = info("MiniCPM5-2B-heretic-abliterated-Q8_0.gguf", { arch: "llama",
    embeddingLength: 2048, blockCount: 42, name: "Raw_Model" });
// Same embedding length as the DSpark draft, a name that shares more tokens with it than the
// correct target does, and an id that sorts first. Without the exact layer anchor this decoy
// captures the draft.
const MINICPM_DECOY = info("AAA-MiniCPM5-2B-instruct-Q8_0.gguf", { arch: "llama",
    embeddingLength: 2048, blockCount: 24, name: "MiniCPM5 2B Instruct" });
const APEX = info("Qwen3.6-35B-A3B.APEX.gguf", { arch: "qwen35moe", embeddingLength: 2048,
    blockCount: 40, name: "Qwen36_Abliterated" });
// A second non-embedded sibling, so the head's name-similarity candidates are still exercised.
const APEX_MINI = info("Qwen3.6-35B-A3B-Mini.gguf", { arch: "qwen35moe", embeddingLength: 2048,
    blockCount: 40, name: "Qwen3.6-35B-A3B Uncensored" });
const GENESIS = info("Qwen3.6-35B-A3B-Genesis.gguf", { arch: "qwen35moe", embeddingLength: 2048,
    blockCount: 41, name: "Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive", basename: "KL0.0764", specType: "draft-mtp", mtpCapable: true });
const MTP_HEAD = info("mtp-Qwen3.6-35B-A3B-Q4_0.gguf", { kind: "mtp-head", arch: "qwen35moe",
    embeddingLength: 2048, blockCount: 41, name: "Qwen/Qwen3.6-35B-A3B", specType: "draft-mtp" });
const MMPROJ = info("mmproj-Qwen3.6-35B-A3B-Uncensored-Genesis-f16.gguf", { kind: "projector",
    arch: "clip", basename: "KL0.0764", vision: true, projectorType: "qwen3vl_merger" });

test("a dflash draft pairs with the target whose layer indices end at blockCount-2", () => {
    const r = M.associate([DFLASH, PAPERWITCH]);
    assert.strictEqual(r.byTarget[PAPERWITCH.id].draft.id, DFLASH.id);
    assert.strictEqual(r.byTarget[PAPERWITCH.id].draft.ambiguous, false);
});
test("the exact layer anchor outranks a same-embedding target that does not match it", () => {
    const r = M.associate([DSPARK, MINICPM, GENESIS]);
    assert.strictEqual(r.byTarget[MINICPM.id].draft.id, DSPARK.id);
    assert.strictEqual(r.byTarget[GENESIS.id].draft, null);
});
test("the exact layer anchor beats a same-embedding decoy whose name sorts first", () => {
    // The C1 regression at the association level: the decoy shares the draft's name tokens and
    // its id sorts first, so only the materialised target_layers anchor can reject it.
    const r = M.associate([DSPARK, MINICPM_DECOY, MINICPM]);
    assert.strictEqual(r.byTarget[MINICPM.id].draft.id, DSPARK.id);
    assert.strictEqual(r.byTarget[MINICPM.id].draft.ambiguous, false);
    // candidates lists the draft FILE ids that claimed this target, best-first: only the
    // exact anchor claimed it, and the decoy (which the anchor rejects) claimed nothing.
    assert.deepStrictEqual(r.byTarget[MINICPM.id].draft.candidates, [DSPARK.id]);
    assert.strictEqual(r.byTarget[MINICPM_DECOY.id].draft, null);
});
test("an mtp head is auto-picked by name similarity among non-embedded targets", () => {
    const r = M.associate([MTP_HEAD, APEX, APEX_MINI, GENESIS]);
    const slot = r.byTarget[APEX_MINI.id].draft;
    assert.strictEqual(slot.id, MTP_HEAD.id);
    // Per spec §4.2 "ambiguous" means an equal top score. The head's name shares tokens with the
    // APEX_MINI name and none with "Qwen36_Abliterated", so it is a pick, not a tie. candidates
    // lists the head files that claimed this target - here only this one.
    assert.strictEqual(slot.ambiguous, false);
    assert.deepStrictEqual(slot.candidates, [MTP_HEAD.id]);
});
test("an embedded-mtp model is never given an external mtp head", () => {
    // The I2 regression: Genesis already carries its own head, so it must be left alone and the
    // external head must pair with the sibling that actually needs it.
    const r = M.associate([MTP_HEAD, GENESIS, APEX]);
    assert.strictEqual(r.byTarget[GENESIS.id].draft, null);
    assert.strictEqual(r.byTarget[APEX.id].draft.id, MTP_HEAD.id);
    assert.strictEqual(r.byTarget[APEX.id].draft.ambiguous, false);
});
test("scoreMtpTarget returns null for a target that already has an embedded head", () => {
    assert.strictEqual(M.scoreMtpTarget(MTP_HEAD, GENESIS), null);
    assert.strictEqual(typeof M.scoreMtpTarget(MTP_HEAD, APEX), "number");
});
test("scoreMtpTarget still refuses an mtpCapable target by default", () => {
    const head = { kind: "mtp-head", arch: "qwen35", embeddingLength: 5120, name: "head" };
    const target = { kind: "model", arch: "qwen35", embeddingLength: 5120, mtpCapable: true, name: "target" };
    assert.strictEqual(M.scoreMtpTarget(head, target), null);
});
test("scoreMtpTarget admits an mtpCapable target when the caller opts in", () => {
    const head = { kind: "mtp-head", arch: "qwen35", embeddingLength: 5120, name: "head" };
    const target = { kind: "model", arch: "qwen35", embeddingLength: 5120, mtpCapable: true, name: "target" };
    assert.strictEqual(M.scoreMtpTarget(head, target, { allowEmbeddedHead: true }), 100);
});
test("the opt-in does not change ordinary eligibility", () => {
    const head = { kind: "mtp-head", arch: "qwen35", embeddingLength: 5120, name: "head" };
    const wrongArch = { kind: "model", arch: "llama", embeddingLength: 5120, mtpCapable: false, name: "t" };
    assert.strictEqual(M.scoreMtpTarget(head, wrongArch, { allowEmbeddedHead: true }), null);
    const noHead = { kind: "model", arch: "qwen35", embeddingLength: 5120, mtpCapable: false, name: "t" };
    assert.strictEqual(M.scoreMtpTarget(head, noHead, { allowEmbeddedHead: true }), 100);
});
test("a projector pairs by basename, else by a single model in the directory", () => {
    const withBase = M.associate([MMPROJ, GENESIS, APEX]);
    assert.strictEqual(withBase.byTarget[GENESIS.id].mmproj.id, MMPROJ.id);
    const single = M.associate([MMPROJ, MINICPM]);
    assert.strictEqual(single.byTarget[MINICPM.id].mmproj.id, MMPROJ.id);
});
test("selectable models never include drafts, heads or projectors", () => {
    const r = M.associate([DFLASH, DSPARK, MTP_HEAD, MMPROJ, PAPERWITCH, MINICPM, APEX, GENESIS]);
    const ids = r.selectable.map(function (i) { return i.id; });
    assert.deepStrictEqual(ids.sort(), [APEX.id, GENESIS.id, MINICPM.id, PAPERWITCH.id].sort());
    assert.strictEqual(r.drafts.length, 3);
    assert.strictEqual(r.projectors.length, 1);
});

// The real gemma-4 folder: quantized models whose metadata names are all generic ("Base_Model"),
// heads shipped under their own "gemma4-assistant" architecture with a smaller embedding, and a
// vision projector without general.basename. Only the file names know what shipped together.
const GEMMA_HERETIC = info("gemma-4-12b-it-qat-heretic-volta-Q4_0.gguf", { arch: "gemma4",
    embeddingLength: 3840, blockCount: 48, name: "Base_Model" });
const GEMMA_OBLI = info("Gemma-4-12B-OBLITERATED-v2-Q8_0.gguf", { arch: "gemma4",
    embeddingLength: 3840, blockCount: 48, name: "Gemma-4-12B-OBLITERATED-v2" });
const GEMMA_MTP_HERETIC = info("mtp-gemma-4-12b-it-qat-heretic-volta-Q4_0.gguf", { kind: "mtp-head",
    arch: "gemma4-assistant", embeddingLength: 1024, blockCount: 4, name: "Mtp_Model", specType: "draft-mtp" });
const GEMMA_MTP_BASE = info("mtp-gemma-4-12b-it.gguf", { kind: "mtp-head",
    arch: "gemma4-assistant", embeddingLength: 1024, blockCount: 4, name: "Gemma 4 12B It Assistant", specType: "draft-mtp" });
const GEMMA_MMPROJ = info("mmproj-gemma-4-12b-it-qat-heretic-volta-F16.gguf", { kind: "projector",
    arch: "clip", name: "Base_Model", vision: true, projectorType: "gemma4" });

test("an assistant-architecture head pairs with its family despite the smaller embedding", () => {
    // scoreMtpTarget used to require arch equality (gemma4-assistant vs gemma4) and an equal
    // embedding (1024 vs 3840); both are wrong for a head shipped under its own architecture.
    const score = M.scoreMtpTarget(GEMMA_MTP_HERETIC, GEMMA_HERETIC);
    assert.strictEqual(typeof score, "number");
    assert.strictEqual(M.scoreMtpTarget(GEMMA_MTP_HERETIC, PAPERWITCH), null);
});
test("the head shipped with a model outranks the base model's head for it", () => {
    // Both heads claim a gemma4 target; the finetune's tokens (qat, heretic, volta) must win
    // for the finetune, and the base head must not steal it by readdir order.
    const r = M.associate([GEMMA_MTP_BASE, GEMMA_MTP_HERETIC, GEMMA_HERETIC, GEMMA_OBLI]);
    assert.strictEqual(r.byTarget[GEMMA_HERETIC.id].draft.id, GEMMA_MTP_HERETIC.id);
    assert.strictEqual(r.byTarget[GEMMA_HERETIC.id].draft.ambiguous, false);
    // The base head's own top is the base-family model (its metadata name says so), so it
    // claims the obliterated build instead - a plausible family pairing, deterministically.
    assert.strictEqual(r.byTarget[GEMMA_OBLI.id].draft.id, GEMMA_MTP_BASE.id);
    assert.strictEqual(r.byTarget[GEMMA_OBLI.id].draft.ambiguous, false);
});
test("a projector without basename pairs by file-name tokens and never claims a stranger", () => {
    // The gemma-4 vision head declares no general.basename and a generic name, so with more
    // than one model in the folder the old flat score tied everything: the projector landed on
    // an arbitrary target and the model it shipped with showed "none detected".
    const r = M.associate([GEMMA_MMPROJ, GEMMA_HERETIC, GEMMA_OBLI, PAPERWITCH]);
    assert.strictEqual(r.byTarget[GEMMA_HERETIC.id].mmproj.id, GEMMA_MMPROJ.id);
    assert.strictEqual(r.byTarget[GEMMA_HERETIC.id].mmproj.ambiguous, false);
    // No release token is shared with the qwen model: no evidence, no claim at all.
    assert.strictEqual(r.byTarget[PAPERWITCH.id].mmproj, null);
});
