// www/core/llmRuntime/tests/ModelRegistry.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ModelRegistry = require("../lib/ModelRegistry");

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "llmruntime-registry-"));
}

function writeFile(p, text) {
    fs.writeFileSync(p, text);
}

// Minimal in-memory fs for the content-detection tests. `existsSync` treats the models
// directory "/models" as present and any registered filename by suffix; every registered
// key is a GGUF whose detection is stubbed through `readInfo`, so no real bytes are read.
function fakeFs(files) {
    const names = Object.keys(files);
    return {
        existsSync: function (p) {
            return p === "/models" || names.some(function (n) { return p.endsWith(n); });
        },
        readdirSync: function () { return names.slice(); },
        readFileSync: function () { return "{}"; },
        statSync: function () { return { size: 1 }; }
    };
}

// Stub detection for the real-fs tests: every file is a plain selectable model, so the
// tests keep exercising the registry/pairing logic instead of GGUF parsing.
function stubReadInfo(filePath, overrides) {
    const id = path.basename(filePath);
    return Object.assign({
        id: id, kind: "model", arch: "qwen35", embeddingLength: 2560,
        blockCount: 6, name: id, specType: null
    }, overrides || {});
}

// The load-mode recommendation's VRAM accounting reads the entry's own model facts (layer
// count, attention widths) and the paired draft's expert count, so buildModelEntries must
// carry them from discovery onto the entry.
test("buildModelEntries carries the KV-sizing facts and the draft's expert count", () => {
    const dir = tmpDir();
    const modelsDir = path.join(dir, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    writeFile(path.join(modelsDir, "Target.gguf"), "target");
    writeFile(path.join(modelsDir, "Target-DFlash.gguf"), "draft");
    const entries = ModelRegistry.buildModelEntries({
        modelsDir,
        registryPath: path.join(dir, "drafts.json"),
        fs,
        onError: () => {},
        readInfo: (filePath) => /dflash/i.test(filePath)
            ? stubReadInfo(filePath, {
                kind: "draft", specType: "draft-dflash", targetLayers: [2, 4],
                expertCount: 64, embeddingLength: 2560
            })
            : stubReadInfo(filePath, {
                expertCount: null, attnKeyLength: 512, attnValueLength: 512
            })
    });
    const target = entries.find((e) => e.id === "Target.gguf");
    assert.strictEqual(target.blockCount, 6);
    assert.strictEqual(target.attnKeyLength, 512);
    assert.strictEqual(target.attnValueLength, 512);
    assert.strictEqual(target.expertCount, null);
    // The paired draft is a MoE: its flags are judged against its own expert count.
    assert.strictEqual(target.draftPath, path.join(modelsDir, "Target-DFlash.gguf"));
    assert.strictEqual(target.draftExpertCount, 64);
});

test("buildModelEntries reports a null draft expert count for a dense draft", () => {
    const dir = tmpDir();
    const modelsDir = path.join(dir, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    writeFile(path.join(modelsDir, "Target.gguf"), "target");
    writeFile(path.join(modelsDir, "Target-DFlash.gguf"), "draft");
    const entries = ModelRegistry.buildModelEntries({
        modelsDir,
        registryPath: path.join(dir, "drafts.json"),
        fs,
        onError: () => {},
        readInfo: (filePath) => /dflash/i.test(filePath)
            ? stubReadInfo(filePath, { kind: "draft", specType: "draft-dflash", targetLayers: [2, 4] })
            : stubReadInfo(filePath)
    });
    const target = entries.find((e) => e.id === "Target.gguf");
    assert.strictEqual(target.draftExpertCount, null);
});

test("buildModelEntries applies a valid draft pairing and hides the draft file", () => {
    const dir = tmpDir();
    const modelsDir = path.join(dir, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    writeFile(path.join(modelsDir, "Qwen3-4B.gguf"), "target");
    writeFile(path.join(modelsDir, "Qwen3-4B-DFlash.gguf"), "draft");
    const registryPath = path.join(dir, "drafts.json");
    writeFile(registryPath, JSON.stringify({
        "Qwen3-4B.gguf": {
            draft: "Qwen3-4B-DFlash.gguf",
            specType: "draft-dflash",
            specDraftNMax: 15
        }
    }));
    const errors = [];
    const entries = ModelRegistry.buildModelEntries({
        modelsDir, registryPath, fs, onError: (err) => errors.push(err),
        // Content detection: the DFlash file is a draft, so `associate` hides it and pairs it.
        readInfo: (filePath) => /dflash/i.test(filePath)
            ? stubReadInfo(filePath, {
                kind: "draft", specType: "draft-dflash", targetLayers: [2, 4]
            })
            : stubReadInfo(filePath)
    });
    // The draft file is paired with its target, so it is NOT emitted as its own model.
    assert.deepStrictEqual(entries.map((e) => e.id), ["Qwen3-4B.gguf"]);
    const target = entries.find((e) => e.id === "Qwen3-4B.gguf");
    assert.strictEqual(target.contextSize, 32768);
    assert.strictEqual(target.gpuLayers, "auto");
    assert.strictEqual(target.modelPath, path.join(modelsDir, "Qwen3-4B.gguf"));
    assert.strictEqual(target.draftPath, path.join(modelsDir, "Qwen3-4B-DFlash.gguf"));
    assert.strictEqual(target.specType, "draft-dflash");
    assert.strictEqual(target.specDraftNMax, 15);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(ModelRegistry.hasModels(entries), true);
});

test("buildModelEntries drops a pair whose draft file is missing and reports it", () => {
    const dir = tmpDir();
    const modelsDir = path.join(dir, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    writeFile(path.join(modelsDir, "Qwen3-4B.gguf"), "target");
    const registryPath = path.join(dir, "drafts.json");
    writeFile(registryPath, JSON.stringify({
        "Qwen3-4B.gguf": {
            draft: "missing-draft.gguf",
            specType: "draft-dspark",
            specDraftNMax: 8
        }
    }));
    const errors = [];
    const entries = ModelRegistry.buildModelEntries({
        modelsDir, registryPath, fs, onError: (err) => errors.push(err),
        readInfo: (filePath) => stubReadInfo(filePath)
    });
    // The pair is dropped, so the target's own file is still listed normally.
    assert.deepStrictEqual(entries.map((e) => e.id), ["Qwen3-4B.gguf"]);
    const target = entries.find((e) => e.id === "Qwen3-4B.gguf");
    // Every entry carries its absolute path so the preset always emits `model = <path>`;
    // without that the router spawns the model instance with no model and requests hang.
    assert.strictEqual(target.modelPath, path.join(modelsDir, "Qwen3-4B.gguf"));
    assert.strictEqual(target.draftPath, undefined);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /missing-draft\.gguf/);
});

test("buildModelEntries lists a draft file normally when its registry pair is invalid", () => {
    const dir = tmpDir();
    const modelsDir = path.join(dir, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    writeFile(path.join(modelsDir, "Qwen3-4B.gguf"), "target");
    writeFile(path.join(modelsDir, "Qwen3-4B-DFlash.gguf"), "draft");
    const registryPath = path.join(dir, "drafts.json");
    writeFile(registryPath, JSON.stringify({
        "Qwen3-4B.gguf": {
            draft: "Qwen3-4B-DFlash.gguf",
            specType: "not-a-draft",
            specDraftNMax: 15
        }
    }));
    const errors = [];
    const entries = ModelRegistry.buildModelEntries({
        modelsDir, registryPath, fs, onError: (err) => errors.push(err),
        // Both files are presented as plain models: this isolates the registry-invalid path,
        // proving the dropped pair does not hide the referenced file on its own.
        readInfo: (filePath) => stubReadInfo(filePath)
    });
    // loadRegistry dropped the pair, so the referenced file is not a draft and lists normally.
    assert.deepStrictEqual(entries.map((e) => e.id), ["Qwen3-4B-DFlash.gguf", "Qwen3-4B.gguf"]);
    assert.strictEqual(errors.length, 1);
});

test("loadRegistry tolerates a missing file and invalid JSON without throwing", () => {
    const dir = tmpDir();
    const missing = ModelRegistry.loadRegistry({
        registryPath: path.join(dir, "nope.json"), fs, onError: () => {}
    });
    assert.deepStrictEqual(missing, { pairs: {} });

    const registryPath = path.join(dir, "drafts.json");
    writeFile(registryPath, "{ not json");
    const errors = [];
    const invalid = ModelRegistry.loadRegistry({
        registryPath, fs, onError: (err) => errors.push(err)
    });
    assert.deepStrictEqual(invalid, { pairs: {} });
    assert.strictEqual(errors.length, 1);

    const arrayPath = path.join(dir, "array.json");
    writeFile(arrayPath, "[]");
    const wrongShape = ModelRegistry.loadRegistry({
        registryPath: arrayPath, fs, onError: (err) => errors.push(err)
    });
    assert.deepStrictEqual(wrongShape, { pairs: {} });
    assert.strictEqual(errors.length, 2);
});

test("buildModelEntries returns [] for a missing models directory", () => {
    const dir = tmpDir();
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: path.join(dir, "absent"), registryPath: path.join(dir, "drafts.json"),
        fs, onError: () => {}
    });
    assert.deepStrictEqual(entries, []);
    assert.strictEqual(ModelRegistry.hasModels(entries), false);
});

test("hasModels is false for empty and non-array input", () => {
    assert.strictEqual(ModelRegistry.hasModels([]), false);
    assert.strictEqual(ModelRegistry.hasModels(undefined), false);
    assert.strictEqual(ModelRegistry.hasModels([{ id: "a.gguf" }]), true);
});

test("selectTargetModel prefers the requested id, then a paired target, then the first entry", () => {
    const entries = [
        { id: "draft-target.gguf", draftPath: "/models/draft-target.gguf" },
        { id: "plain.gguf" }
    ];
    assert.strictEqual(
        ModelRegistry.selectTargetModel({ entries, preferredId: "plain.gguf" }),
        "plain.gguf"
    );
    assert.strictEqual(
        ModelRegistry.selectTargetModel({ entries }),
        "draft-target.gguf"
    );
    assert.strictEqual(
        ModelRegistry.selectTargetModel({ entries: [{ id: "plain.gguf" }] }),
        "plain.gguf"
    );
    assert.strictEqual(ModelRegistry.selectTargetModel({ entries: [] }), null);
    assert.strictEqual(ModelRegistry.selectTargetModel({}), null);
});

test("selectTargetModel falls through an unknown preferredId", () => {
    const entries = [
        { id: "a.gguf" },
        { id: "b.gguf", draftPath: "/models/b.gguf" }
    ];
    assert.strictEqual(
        ModelRegistry.selectTargetModel({ entries, preferredId: "missing.gguf" }),
        "b.gguf"
    );
    assert.strictEqual(
        ModelRegistry.selectTargetModel({ entries: [{ id: "a.gguf" }], preferredId: "missing.gguf" }),
        "a.gguf"
    );
});

test("buildModelEntries gives every entry an absolute modelPath, paired or not", () => {
    const dir = tmpDir();
    const modelsDir = path.join(dir, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    writeFile(path.join(modelsDir, "A.gguf"), "a");
    writeFile(path.join(modelsDir, "B.gguf"), "b");
    const entries = ModelRegistry.buildModelEntries({
        modelsDir,
        registryPath: path.join(dir, "no-such-registry.json"),
        fs,
        readInfo: (filePath) => stubReadInfo(filePath, { path: undefined })
    });
    assert.deepStrictEqual(entries.map((e) => e.modelPath), [
        path.join(modelsDir, "A.gguf"),
        path.join(modelsDir, "B.gguf")
    ]);
    for (const entry of entries) assert.strictEqual(entry.draftPath, undefined);
});

function pairedEntries() {
    return [
        {
            id: "target.gguf",
            modelPath: "/models/target.gguf",
            draftPath: "/models/draft.gguf",
            specType: "draft-dflash",
            specDraftNMax: 12
        },
        { id: "plain.gguf", modelPath: "/models/plain.gguf" }
    ];
}

test("applyRuntimeTuning sets both values on the paired entry only", () => {
    const entries = pairedEntries();
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries, modelId: "target.gguf", draftMax: 2, draftMin: 0
    });
    assert.notStrictEqual(tuned, entries);
    const target = tuned.find((e) => e.id === "target.gguf");
    assert.strictEqual(target.specDraftNMax, 2);
    assert.strictEqual(target.specDraftNMin, 0);
    // The unpaired entry is returned untouched.
    const plain = tuned.find((e) => e.id === "plain.gguf");
    assert.deepStrictEqual(plain, { id: "plain.gguf", modelPath: "/models/plain.gguf" });
});

test("applyRuntimeTuning does not mutate the input array or entries", () => {
    const entries = pairedEntries();
    ModelRegistry.applyRuntimeTuning({
        entries, modelId: "target.gguf", draftMax: 2, draftMin: 0
    });
    assert.strictEqual(entries[0].specDraftNMax, 12);
    assert.strictEqual(entries[0].specDraftNMin, undefined);
    assert.strictEqual(entries.length, 2);
});

test("applyRuntimeTuning ignores non-integer and out-of-range input", () => {
    for (const badMax of [0, -1, 2.5, "3", undefined, null]) {
        const tuned = ModelRegistry.applyRuntimeTuning({
            entries: pairedEntries(), modelId: "target.gguf", draftMax: badMax, draftMin: undefined
        });
        assert.strictEqual(tuned[0].specDraftNMax, 12, `draftMax ${String(badMax)} must be ignored`);
    }
    for (const badMin of [-1, 2.5, "0", undefined, null]) {
        const tuned = ModelRegistry.applyRuntimeTuning({
            entries: pairedEntries(), modelId: "target.gguf", draftMax: undefined, draftMin: badMin
        });
        assert.strictEqual(tuned[0].specDraftNMin, undefined, `draftMin ${String(badMin)} must be ignored`);
    }
});

test("applyRuntimeTuning clamps draftMin to draftMax", () => {
    const clamped = ModelRegistry.applyRuntimeTuning({
        entries: pairedEntries(), modelId: "target.gguf", draftMax: 5, draftMin: 9
    });
    assert.strictEqual(clamped[0].specDraftNMax, 5);
    assert.strictEqual(clamped[0].specDraftNMin, 5);
});

test("applyRuntimeTuning targets only the named model", () => {
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries: pairedEntries(), modelId: "missing.gguf", draftMax: 2, draftMin: 0
    });
    assert.strictEqual(tuned[0].specDraftNMax, 12);
    assert.strictEqual(tuned[0].specDraftNMin, undefined);
    // Naming an unpaired entry leaves everything untouched too.
    const unpaired = ModelRegistry.applyRuntimeTuning({
        entries: pairedEntries(), modelId: "plain.gguf", draftMax: 2, draftMin: 0
    });
    assert.strictEqual(unpaired[0].specDraftNMax, 12);
    assert.deepStrictEqual(unpaired[1], { id: "plain.gguf", modelPath: "/models/plain.gguf" });
});

test("applyRuntimeTuning tolerates a non-array entries argument", () => {
    assert.deepStrictEqual(
        ModelRegistry.applyRuntimeTuning({ entries: null, modelId: "a", draftMax: 2, draftMin: 0 }),
        []
    );
    assert.deepStrictEqual(
        ModelRegistry.applyRuntimeTuning({ modelId: "a", draftMax: 2, draftMin: 0 }),
        []
    );
});

test("applyRuntimeTuning applies contextSize alongside the draft values on a paired entry", () => {
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries: pairedEntries(), modelId: "target.gguf",
        draftMax: 3, draftMin: 1, contextLength: 8192
    });
    assert.strictEqual(tuned[0].specDraftNMax, 3);
    assert.strictEqual(tuned[0].specDraftNMin, 1);
    assert.strictEqual(tuned[0].contextSize, 8192);
});

test("applyRuntimeTuning applies contextSize to the selected entry even when it is unpaired", () => {
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries: pairedEntries(), modelId: "plain.gguf", contextLength: 16384
    });
    assert.strictEqual(tuned[1].contextSize, 16384);
    // The paired entry is not the target, so it keeps its registry values (none here).
    assert.strictEqual(tuned[0].contextSize, undefined);
});

test("applyRuntimeTuning ignores a non-integer or too-small contextLength", () => {
    for (const bad of [511, 512.5, "8192", undefined, null, NaN]) {
        const tuned = ModelRegistry.applyRuntimeTuning({
            entries: [{ id: "plain.gguf", contextSize: 32768 }], modelId: "plain.gguf",
            contextLength: bad
        });
        assert.strictEqual(tuned[0].contextSize, 32768, `contextLength ${String(bad)} must be ignored`);
    }
    // 512 is the smallest accepted value.
    const min = ModelRegistry.applyRuntimeTuning({
        entries: [{ id: "plain.gguf", contextSize: 32768 }], modelId: "plain.gguf",
        contextLength: 512
    });
    assert.strictEqual(min[0].contextSize, 512);
});

test("applyRuntimeTuning does not mutate the input when tuning context only", () => {
    const entries = [{ id: "plain.gguf", contextSize: 32768 }];
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries, modelId: "plain.gguf", contextLength: 4096
    });
    assert.notStrictEqual(tuned, entries);
    assert.notStrictEqual(tuned[0], entries[0]);
    assert.strictEqual(entries[0].contextSize, 32768);
});

test("applyRuntimeTuning applies offload settings to the selected entry only", () => {
    const entries = [
        { id: "a.gguf", contextSize: 4096, gpuLayers: "auto" },
        { id: "b.gguf", contextSize: 4096, gpuLayers: "auto" }
    ];
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries, modelId: "b.gguf",
        offload: { gpuLayers: 24, cpuMoeLayers: 10, splitMode: "layer", mainGpu: 0 }
    });
    assert.strictEqual(tuned[0].gpuLayers, "auto");
    assert.strictEqual(tuned[0].cpuMoeLayers, undefined);
    assert.strictEqual(tuned[1].gpuLayers, 24);
    assert.strictEqual(tuned[1].cpuMoeLayers, 10);
    assert.strictEqual(tuned[1].splitMode, "layer");
    assert.strictEqual(tuned[1].mainGpu, 0);
    // The originals are untouched.
    assert.strictEqual(entries[1].gpuLayers, "auto");
    assert.strictEqual(entries[1].cpuMoeLayers, undefined);
});

test("applyRuntimeTuning ignores offload values the preset parser would reject", () => {
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries: [{ id: "a.gguf", contextSize: 4096, gpuLayers: "auto" }],
        modelId: "a.gguf",
        offload: { gpuLayers: "plenty", cpuMoeLayers: -1, splitMode: "diagonal", tensorSplit: "x,y" }
    });
    assert.strictEqual(tuned[0].gpuLayers, "auto");
    assert.strictEqual(tuned[0].cpuMoeLayers, undefined);
    assert.strictEqual(tuned[0].splitMode, undefined);
    assert.strictEqual(tuned[0].tensorSplit, undefined);
});

test("applyRuntimeTuning carries the fit margin scalar onto the selected entry only", () => {
    const entries = [
        { id: "a.gguf", contextSize: 4096, gpuLayers: "auto" },
        { id: "b.gguf", contextSize: 4096, gpuLayers: "auto" }
    ];
    const tuned = ModelRegistry.applyRuntimeTuning({ entries, modelId: "b.gguf", fitTarget: 512 });
    assert.strictEqual(tuned[0].fitTarget, undefined);
    assert.strictEqual(tuned[1].fitTarget, 512);
    // 0 is meaningful (maximum control); empty, negative and non-numeric values leave the key
    // absent so ModelArgs omits the flag and the engine's own default stands.
    assert.strictEqual(ModelRegistry.applyRuntimeTuning({ entries, modelId: "b.gguf", fitTarget: 0 })[1].fitTarget, 0);
    for (const bad of ["", -1, "abc", null, undefined]) {
        assert.strictEqual(
            ModelRegistry.applyRuntimeTuning({ entries, modelId: "b.gguf", fitTarget: bad })[1].fitTarget,
            undefined, String(bad)
        );
    }
    assert.strictEqual(entries[1].fitTarget, undefined);
});

test("applyRuntimeTuning applies a saved chat template to the selected entry only", () => {
    const entries = [
        { id: "a.gguf", contextSize: 4096, gpuLayers: "auto" },
        { id: "b.gguf", contextSize: 4096, gpuLayers: "auto" }
    ];
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries, modelId: "b.gguf", chatTemplatePath: "/templates/b.gguf.jinja"
    });
    assert.strictEqual(tuned[0].chatTemplatePath, undefined);
    assert.strictEqual(tuned[1].chatTemplatePath, "/templates/b.gguf.jinja");
    assert.strictEqual(entries[1].chatTemplatePath, undefined);
});

test("applyRuntimeTuning leaves the template alone when no path is given", () => {
    for (const chatTemplatePath of [undefined, null, "", 0]) {
        const tuned = ModelRegistry.applyRuntimeTuning({
            entries: [{ id: "a.gguf", contextSize: 4096 }], modelId: "a.gguf", chatTemplatePath
        });
        assert.strictEqual(tuned[0].chatTemplatePath, undefined, String(chatTemplatePath));
    }
});

test("buildModelEntries hides drafts and projectors and attaches their pairing", () => {
    const memFs = fakeFs({
        "target.gguf": null, "q35-dflash.gguf": null, "mmproj-x.gguf": null
    });
    // readModelFile is injected so the test does not need real GGUF bytes.
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: "/models", registryPath: "/none", fs: memFs, onError: function () {},
        readInfo: function (filePath) {
            if (/dflash/.test(filePath)) return { id: "q35-dflash.gguf", kind: "draft", specType: "draft-dflash",
                embeddingLength: 2560, blockCount: 6, targetLayers: [2, 4], name: "dflash" };
            if (/mmproj/.test(filePath)) return { id: "mmproj-x.gguf", kind: "projector", basename: "T", vision: true };
            return { id: "target.gguf", kind: "model", arch: "qwen35", embeddingLength: 2560, blockCount: 6,
                name: "T", specType: null };
        }
    });
    assert.deepStrictEqual(entries.map(function (e) { return e.id; }), ["target.gguf"]);
    assert.match(entries[0].draftPath, /q35-dflash\.gguf$/);
    assert.strictEqual(entries[0].specType, "draft-dflash");
    assert.match(entries[0].mmprojPath, /mmproj-x\.gguf$/);
});
test("an embedded mtp head yields a spec type with no draft path", () => {
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: "/models", registryPath: "/none", fs: fakeFs({ "genesis.gguf": null }),
        onError: function () {},
        readInfo: function () { return { id: "genesis.gguf", kind: "model", arch: "qwen35moe",
            embeddingLength: 2048, blockCount: 41, name: "Genesis", specType: "draft-mtp", mtpCapable: true }; }
    });
    assert.strictEqual(entries[0].specType, "draft-mtp");
    assert.strictEqual(entries[0].draftPath, undefined);
    assert.strictEqual(entries[0].mtpCapable, true);
    // The embedded head drafts like a detected draft, so it carries the same recommended
    // default bound instead of llama.cpp's own (3).
    assert.strictEqual(entries[0].specDraftNMax, 2);
});
test("applyRuntimeTuning also tunes a model that drafts for itself", () => {
    // An embedded MTP head has no draftPath, but the same draft bounds govern it (the
    // server reads n-max/n-min in the MTP loop itself), so the tuning must reach it.
    const entries = [
        { id: "self.gguf", modelPath: "/models/self.gguf", specType: "draft-mtp", mtpCapable: true, specDraftNMax: 2 },
        { id: "plain.gguf", modelPath: "/models/plain.gguf" }
    ];
    const tuned = ModelRegistry.applyRuntimeTuning({
        entries, modelId: "self.gguf", draftMax: 3, draftMin: 1
    });
    const self = tuned.find((e) => e.id === "self.gguf");
    assert.strictEqual(self.specDraftNMax, 3);
    assert.strictEqual(self.specDraftNMin, 1);
    // A model with neither a paired draft nor a head stays untouched.
    const plain = tuned.find((e) => e.id === "plain.gguf");
    assert.deepStrictEqual(plain, { id: "plain.gguf", modelPath: "/models/plain.gguf" });
});
test("an embedded-mtp sibling keeps its own head and the external head pairs with the other", () => {
    // The I2 regression end-to-end through buildModelEntries: the folder holds an embedded-head
    // model (Genesis), a sibling without one (APEX) and the shared external head file. The head
    // must go to APEX, while Genesis is its own spec source with no draftPath.
    const memFs = fakeFs({
        "Qwen3.6-35B-A3B-Genesis.gguf": null,
        "Qwen3.6-35B-A3B.APEX.gguf": null,
        "mtp-Qwen3.6-35B-A3B-Q4_0.gguf": null
    });
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: "/models", registryPath: "/none", fs: memFs, onError: function () {},
        readInfo: function (filePath) {
            const id = path.basename(filePath);
            if (/^mtp-/.test(id)) return { id: id, kind: "mtp-head", arch: "qwen35moe",
                embeddingLength: 2048, blockCount: 41, name: "Qwen/Qwen3.6-35B-A3B", specType: "draft-mtp" };
            if (/Genesis/.test(id)) return { id: id, kind: "model", arch: "qwen35moe",
                embeddingLength: 2048, blockCount: 41, name: "Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive",
                specType: "draft-mtp", mtpCapable: true };
            return { id: id, kind: "model", arch: "qwen35moe", embeddingLength: 2048,
                blockCount: 40, name: "Qwen36_Abliterated", specType: null };
        }
    });
    const genesis = entries.find((e) => /Genesis/.test(e.id));
    const apex = entries.find((e) => /APEX/.test(e.id));
    assert.strictEqual(genesis.specType, "draft-mtp");
    assert.strictEqual(genesis.mtpCapable, true);
    assert.strictEqual(genesis.draftPath, undefined);
    assert.strictEqual(apex.specType, "draft-mtp");
    assert.match(apex.draftPath, /mtp-Qwen3\.6-35B-A3B-Q4_0\.gguf$/);
});
test("buildModelEntries sorts selectable entries by id regardless of readdir order", () => {
    // The fake fs reports names in reverse-alphabetical order, so readdirSync order is not sorted.
    const memFs = fakeFs({ "c.gguf": null, "b.gguf": null, "a.gguf": null });
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: "/models", registryPath: "/none", fs: memFs, onError: function () {},
        readInfo: function (filePath) { return stubReadInfo(filePath); }
    });
    // selectTargetModel falls back to entries[0], so this order must be deterministic (ascending).
    assert.deepStrictEqual(entries.map(function (e) { return e.id; }), ["a.gguf", "b.gguf", "c.gguf"]);
});

test("buildModelEntries carries the GGUF facts RuntimeInfo needs", () => {
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: "/models", registryPath: "/none",
        fs: fakeFs({ "m.gguf": null }), onError: function () {},
        readInfo: function (filePath) {
            return stubReadInfo(filePath, {
                contextLength: 131072, bytes: 2674565120, vision: true, fileType: 7
            });
        }
    });
    assert.strictEqual(entries[0].contextLengthTrain, 131072);
    assert.strictEqual(entries[0].bytes, 2674565120);
    assert.strictEqual(entries[0].hasVision, true);
    assert.strictEqual(entries[0].ftype, "7");
});

test("applyRuntimeTuning carries draft offload fields onto the paired entry", () => {
    const entries = [{ id: "m", draftPath: "/d.gguf", specDraftNMax: 2 }];
    const out = ModelRegistry.applyRuntimeTuning({
        entries: entries, modelId: "m",
        offload: { draftGpuLayers: 99, draftCpuMoe: true }
    });
    assert.strictEqual(out[0].draftGpuLayers, 99);
    assert.strictEqual(out[0].draftCpuMoe, true);
});

test("buildModelEntries leaves the facts null/empty when the GGUF does not declare them", () => {
    const entries = ModelRegistry.buildModelEntries({
        modelsDir: "/models", registryPath: "/none",
        fs: fakeFs({ "m.gguf": null }), onError: function () {},
        readInfo: function (filePath) { return stubReadInfo(filePath); }
    });
    assert.strictEqual(entries[0].contextLengthTrain, null);
    assert.strictEqual(entries[0].bytes, null);
    assert.strictEqual(entries[0].hasVision, false);
    assert.strictEqual(entries[0].ftype, "");
});
