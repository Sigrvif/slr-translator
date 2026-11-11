"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ENTRY = path.join(__dirname, "..", "llmRuntime.js");
const MODULE_DIR = path.join(__dirname, "..");

// Evaluate llmRuntime.js the way the addon loader does: as an AsyncFunction body called
// with `this` set to the Addon instance. The entry uses bare globals (window, common,
// sys, logger, $, nw, require), so they are installed on globalThis for the whole
// evaluation AND for the assertions that follow (the runtime initialises lazily, so the
// first api access is what actually loads the lib modules). Globals are restored after.
async function withEntry(opts, run) {
    const src = fs.readFileSync(ENTRY, "utf8");
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fakeWindow = {};
    const sandbox = {
        window: fakeWindow,
        require: require,
        common: { getRootDir: () => opts.rootDir, aSpawn: () => Promise.resolve("") },
        sys: { log: () => {} },
        logger: { debug: () => {}, warn: () => {}, error: () => {} },
        $: () => ({ on: () => {} }),
        nw: { App: { manifest: { localConfig: { llama: "runtime" } } } }
    };
    // A test may need to replace a global (e.g. a fake nw.Window for the status window).
    for (const key of Object.keys(opts.extraGlobals || {})) {
        sandbox[key] = opts.extraGlobals[key];
    }
    const keys = Object.keys(sandbox);
    const saved = {};
    for (const key of keys) {
        saved[key] = Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined;
        globalThis[key] = sandbox[key];
    }
    try {
        const fn = new AsyncFunction(src);
        await fn.call({ fullPath: opts.fullPath }, {});
        return await run(fakeWindow.llmRuntime);
    } finally {
        for (const key of keys) {
            if (saved[key] === undefined) delete globalThis[key];
            else globalThis[key] = saved[key];
        }
    }
}

test("the addon entry evaluates and publishes a working api", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-entry-"));
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        assert.ok(api, "window.llmRuntime must be defined after evaluation");
        assert.strictEqual(api.loadError, null);
        assert.strictEqual(api.status().status, "stopped");
        assert.deepStrictEqual(api.targetModels(), []);
    });
});

test("a broken install still publishes the api and reports a load error", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-broken-"));
    await withEntry({ fullPath: path.join(root, "missing-module"), rootDir: root }, async (api) => {
        assert.ok(api, "window.llmRuntime must still be defined when loading fails");
        assert.match(String(api.loadError), /Could not initialise the bundled local runtime/);
        assert.throws(() => api.status(), /Could not initialise/);
    });
});

test("auto-start state round-trips through data/llama/laststart.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-autostart-"));
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        // Default is off, with no remembered settings.
        assert.deepStrictEqual(api.readStartState(), { autoStart: false, settings: null });
        assert.strictEqual(api.setAutoStart(true), true);
        assert.strictEqual(api.readStartState().autoStart, true);
        // Turning it back off keeps the file valid.
        assert.strictEqual(api.setAutoStart(false), false);
        assert.strictEqual(api.readStartState().autoStart, false);
        const written = JSON.parse(fs.readFileSync(path.join(root, "data", "llama", "laststart.json"), "utf8"));
        assert.strictEqual(written.autoStart, false);
    });
});

test("a corrupt auto-start file is ignored instead of throwing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-autostart-bad-"));
    const dir = path.join(root, "data", "llama");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "laststart.json"), "{ this is not json");
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        assert.deepStrictEqual(api.readStartState(), { autoStart: false, settings: null });
    });
});

test("autoStart does nothing when it was never enabled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-autostart-off-"));
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        const result = await api.autoStart();
        assert.strictEqual(result, null);
        assert.strictEqual(api.status().status, "stopped");
    });
});

// A stand-in for an NW.js window handle: only the members the addon touches.
function fakeNwWindow() {
    return {
        window: { setRuntimeStatus: () => {} },
        shown: 0,
        focused: 0,
        closed: 0,
        onTop: null,
        on: () => {},
        show() { this.shown++; },
        focus() { this.focused++; },
        hide() {},
        close() { this.closed++; },
        setAlwaysOnTop(v) { this.onTop = v; }
    };
}

test("the status window opens on demand, always on top, and closes cleanly", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-statuswin-"));
    const opened = [];
    await withEntry({
        fullPath: MODULE_DIR, rootDir: root,
        extraGlobals: {
            nw: {
                App: { manifest: { localConfig: { llama: "runtime" } } },
                Window: {
                    open: (url, options, cb) => {
                        const win = fakeNwWindow();
                        opened.push({ url, options, win });
                        if (cb) cb(win);
                        return win;
                    }
                }
            }
        }
    }, async (api) => {
        assert.strictEqual(api.statusWindowOpen(), false);
        api.showStatusWindow();
        assert.strictEqual(opened.length, 1);
        assert.strictEqual(opened[0].url, "www/runtimeStatus.html");
        assert.strictEqual(opened[0].options.always_on_top, true);
        // Frameless, so the page's own bar can follow night mode instead of an OS title bar.
        assert.strictEqual(opened[0].options.frame, false);
        assert.strictEqual(opened[0].win.onTop, true);
        assert.strictEqual(opened[0].win.shown, 1);
        assert.strictEqual(api.statusWindowOpen(), true);
        // Showing it again reuses the same window instead of opening a second one.
        api.showStatusWindow();
        assert.strictEqual(opened.length, 1);
        api.closeStatusWindow();
        assert.strictEqual(opened[0].win.closed, 1);
        assert.strictEqual(api.statusWindowOpen(), false);
    });
});

test("the status window is not opened while the runtime is stopped", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-statuswin-idle-"));
    const opened = [];
    await withEntry({
        fullPath: MODULE_DIR, rootDir: root,
        extraGlobals: {
            nw: {
                App: { manifest: { localConfig: { llama: "runtime" } } },
                Window: { open: (url, options, cb) => { opened.push(url); return fakeNwWindow(); } }
            }
        }
    }, async (api) => {
        // The ticker runs on its own; with the runtime stopped it must do nothing.
        await new Promise((r) => setTimeout(r, 50));
        assert.deepStrictEqual(opened, []);
        assert.strictEqual(api.statusWindowOpen(), false);
    });
});

// Minimal GGUF writer for the metadata tests: header plus a few string/uint32 keys.
function writeTinyGguf(filePath, arch, expertCount, expertUsed) {
    const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
    const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
    const str = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u64(b.length), b]); };
    const kvs = [
        { k: "general.architecture", t: 8, v: str(arch) },
        { k: "general.name", t: 8, v: str("Tiny Model") }
    ];
    if (expertCount !== null && expertCount !== undefined) kvs.push({ k: arch + ".expert_count", t: 4, v: u32(expertCount) });
    if (expertUsed !== null && expertUsed !== undefined) kvs.push({ k: arch + ".expert_used_count", t: 4, v: u32(expertUsed) });
    const parts = [Buffer.from("GGUF", "ascii"), u32(3), u64(0), u64(kvs.length)];
    for (const e of kvs) parts.push(str(e.k), u32(e.t), e.v);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.concat(parts));
}

test("modelMeta reads architecture and expert counts from the selected model", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-meta-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny-moe.gguf"), "gemma4", 128, 8);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        assert.deepStrictEqual(api.targetModels().map((m) => m.id), ["tiny-moe.gguf"]);
        assert.deepStrictEqual(api.modelMeta(), {
            arch: "gemma4", name: "Tiny Model", expertCount: 128, expertUsedCount: 8
        });
    });
});

test("modelInfos and associations expose content detection for the models directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-infos-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "a.gguf"), "qwen35", null, null);
    writeTinyGguf(path.join(root, "data", "llama", "models", "b.gguf"), "gemma4", 128, 8);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        const infos = api.modelInfos();
        assert.deepStrictEqual(infos.map((i) => i.id).sort(), ["a.gguf", "b.gguf"]);
        const assoc = api.associations();
        assert.deepStrictEqual(assoc.selectable.map((i) => i.id).sort(), ["a.gguf", "b.gguf"]);
        assert.deepStrictEqual(assoc.byTarget["b.gguf"], { draft: null, mmproj: null });
        // Detection is independent of the explicit registry override.
        assert.deepStrictEqual(api.readDrafts(), {});
    });
});

test("repeated targetModels() calls with an unchanged folder do not re-read any GGUF body", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-scancache-"));
    const models = path.join(root, "data", "llama", "models");
    writeTinyGguf(path.join(models, "a.gguf"), "qwen35", null, null);
    writeTinyGguf(path.join(models, "b.gguf"), "gemma4", 128, 8);

    // The entry requires the real fs module, so patching its openSync counts every GGUF body
    // read the content scan performs. The cheap signature (readdirSync + statSync) is
    // deliberately not counted, so a zero delta proves the second call reused the cache.
    const realOpenSync = fs.openSync;
    let ggufOpens = 0;
    fs.openSync = function (filePath) {
        if (/\.gguf$/i.test(String(filePath))) ggufOpens++;
        return realOpenSync.apply(fs, arguments);
    };
    try {
        await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
            const first = api.targetModels();
            assert.deepStrictEqual(first.map((m) => m.id), ["a.gguf", "b.gguf"]);
            const coldOpens = ggufOpens;
            assert.ok(coldOpens > 0, "the first scan must actually read the files");

            const second = api.targetModels();
            const third = api.targetModels();
            assert.strictEqual(ggufOpens, coldOpens, "an unchanged folder must never be re-read");
            assert.deepStrictEqual(second, first);
            assert.deepStrictEqual(third, first);
        });
    } finally {
        fs.openSync = realOpenSync;
    }
});

test("a changed models folder transparently re-scans on the next targetModels()", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-scancache-change-"));
    const models = path.join(root, "data", "llama", "models");
    writeTinyGguf(path.join(models, "a.gguf"), "qwen35", null, null);

    const realOpenSync = fs.openSync;
    let ggufOpens = 0;
    fs.openSync = function (filePath) {
        if (/\.gguf$/i.test(String(filePath))) ggufOpens++;
        return realOpenSync.apply(fs, arguments);
    };
    try {
        await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
            assert.deepStrictEqual(api.targetModels().map((m) => m.id), ["a.gguf"]);
            const coldOpens = ggufOpens;
            // Adding a file changes the directory signature, so the next call must re-scan and
            // pick the new model up instead of serving the cached list.
            writeTinyGguf(path.join(models, "b.gguf"), "gemma4", null, null);
            assert.deepStrictEqual(api.targetModels().map((m) => m.id), ["a.gguf", "b.gguf"]);
            assert.ok(ggufOpens > coldOpens, "the changed folder must be read again");
        });
    } finally {
        fs.openSync = realOpenSync;
    }
});

test("a drafts.json-only change invalidates the cached entries and applies the new pairing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-registry-cache-"));
    const dataDir = path.join(root, "data", "llama");
    const models = path.join(dataDir, "models");
    writeTinyGguf(path.join(models, "m.gguf"), "qwen35", null, null);
    writeTinyGguf(path.join(models, "d1.gguf"), "qwen35", null, null);
    writeTinyGguf(path.join(models, "d2.gguf"), "qwen35", null, null);
    const registryPath = path.join(dataDir, "drafts.json");
    fs.writeFileSync(registryPath, JSON.stringify({
        "m.gguf": { draft: "d1.gguf", specType: "draft-dflash", specDraftNMax: 3 }
    }));
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        function target() {
            return api.targetModels().filter((e) => e.id === "m.gguf")[0];
        }
        assert.strictEqual(target().draftPath, path.join(models, "d1.gguf"));
        assert.strictEqual(target().specDraftNMax, 3);

        // Editing the documented override file alone (the models directory does not change at
        // all) must invalidate the cached entries. Before the registry was part of the entries
        // key this kept serving d1.gguf until the app restarted.
        fs.writeFileSync(registryPath, JSON.stringify({
            "m.gguf": { draft: "d2.gguf", specType: "draft-dflash", specDraftNMax: 12345 }
        }));
        const changed = target();
        assert.strictEqual(changed.draftPath, path.join(models, "d2.gguf"));
        assert.strictEqual(changed.specDraftNMax, 12345);
    });
});

// A general GGUF metadata writer for the association tests: string / uint32 / bool keys, enough
// to give a target an embedding length and a dflash draft the matching embedding length.
function writeMetaGguf(filePath, entries) {
    const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
    const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
    const str = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u64(b.length), b]); };
    const parts = [Buffer.from("GGUF", "ascii"), u32(3), u64(0), u64(entries.length)];
    for (const e of entries) {
        parts.push(str(e.k));
        if (e.t === "u32") parts.push(u32(4), u32(e.v));
        else if (e.t === "bool") { const b = Buffer.alloc(1); b.writeUInt8(e.v ? 1 : 0); parts.push(u32(7), b); }
        else if (e.t === "u32array") {
            const arr = [u32(4), u64(e.v.length)];
            for (const v of e.v) arr.push(u32(v));
            parts.push(u32(9), Buffer.concat(arr));
        } else parts.push(u32(8), str(e.v));
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.concat(parts));
}

test("the dflash target_layers anchor survives real GGUF bytes and beats a name-sorting decoy", async () => {
    // The C1 regression end-to-end: readModelFile is reached through the real GgufMeta reader,
    // so a requested numeric array must be materialised for the anchor to work at all.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-anchor-"));
    const models = path.join(root, "data", "llama", "models");
    writeMetaGguf(path.join(models, "MiniCPM5-2B-DSpark-Q8_0.gguf"), [
        { k: "general.architecture", t: "str", v: "dflash" },
        { k: "general.name", t: "str", v: "MiniCPM5 2B DSpark" },
        { k: "dflash.embedding_length", t: "u32", v: 2048 },
        { k: "dflash.block_count", t: "u32", v: 5 },
        { k: "dflash.sample_from_anchor", t: "bool", v: true },
        { k: "dflash.target_layers", t: "u32array", v: [2, 11, 21, 31, 40] }
    ]);
    // A same-embedding decoy whose name shares the draft's tokens and whose id sorts first.
    writeMetaGguf(path.join(models, "AAA-MiniCPM5-2B-instruct-Q8_0.gguf"), [
        { k: "general.architecture", t: "str", v: "llama" },
        { k: "general.name", t: "str", v: "MiniCPM5 2B Instruct" },
        { k: "llama.embedding_length", t: "u32", v: 2048 },
        { k: "llama.block_count", t: "u32", v: 24 }
    ]);
    writeMetaGguf(path.join(models, "MiniCPM5-2B-heretic-abliterated-Q8_0.gguf"), [
        { k: "general.architecture", t: "str", v: "llama" },
        { k: "general.name", t: "str", v: "Raw_Model" },
        { k: "llama.embedding_length", t: "u32", v: 2048 },
        { k: "llama.block_count", t: "u32", v: 42 }
    ]);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        const dspark = api.modelInfos().find((i) => i.id === "MiniCPM5-2B-DSpark-Q8_0.gguf");
        assert.deepStrictEqual(dspark.targetLayers, [2, 11, 21, 31, 40]);
        const assoc = api.associations();
        const correct = assoc.byTarget["MiniCPM5-2B-heretic-abliterated-Q8_0.gguf"];
        assert.strictEqual(correct.draft.id, "MiniCPM5-2B-DSpark-Q8_0.gguf");
        assert.strictEqual(correct.draft.ambiguous, false);
        assert.strictEqual(assoc.byTarget["AAA-MiniCPM5-2B-instruct-Q8_0.gguf"].draft, null);
    });
});

test("candidateDraftsFor offers eligible draft FILE ids, never a target id", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-cand-draft-"));
    const models = path.join(root, "data", "llama", "models");
    // A GGIS target, a matching DFlash draft, and an unrelated target with a different embedding.
    writeMetaGguf(path.join(models, "ggis-main.gguf"), [
        { k: "general.architecture", t: "str", v: "ggis" },
        { k: "ggis.embedding_length", t: "u32", v: 4096 },
        { k: "ggis.block_count", t: "u32", v: 32 }
    ]);
    writeMetaGguf(path.join(models, "ggis-dflash.gguf"), [
        { k: "general.architecture", t: "str", v: "dflash" },
        { k: "dflash.embedding_length", t: "u32", v: 4096 },
        { k: "dflash.sample_from_anchor", t: "bool", v: false }
    ]);
    writeMetaGguf(path.join(models, "other.gguf"), [
        { k: "general.architecture", t: "str", v: "llama" },
        { k: "llama.embedding_length", t: "u32", v: 2048 }
    ]);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        const candidates = api.candidateDraftsFor("ggis-main.gguf");
        const draftIds = api.associations().drafts.map((d) => d.id);
        assert.ok(candidates.length >= 1, "the matching draft must be offered");
        assert.strictEqual(candidates[0].id, "ggis-dflash.gguf");
        assert.strictEqual(candidates[0].specType, "draft-dflash");
        assert.strictEqual(typeof candidates[0].score, "number");
        // Every offered id is a real draft FILE, so StartConfig can join + look it up.
        for (const c of candidates) {
            assert.ok(draftIds.indexOf(c.id) !== -1, c.id + " must be a member of associations().drafts");
            assert.notStrictEqual(c.id, "ggis-main.gguf", "the target's own id must never be offered as a draft");
            assert.notStrictEqual(c.id, "other.gguf");
        }
        // The detector's own candidate list references the draft FILES that claimed the target
        // (not target ids), and every one of them is a joinable draft file id.
        const detectionCandidates = api.associations().byTarget["ggis-main.gguf"].draft.candidates;
        for (const sideId of detectionCandidates) {
            assert.ok(draftIds.indexOf(sideId) !== -1, sideId + " must be a member of associations().drafts");
        }
    });
});

test("candidateDraftsFor offers an external head for an MTP-capable target and tags it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-cand-mtp-"));
    const models = path.join(root, "data", "llama", "models");
    // The target already carries its own MTP head (nextn present, no block_count), so automatic
    // pairing refuses an external one. The standalone head is compact: a real MTP head has 23
    // tensors for 41 declared blocks, far below one tensor per block, which is exactly how
    // classifyModel tells a head from a complete model.
    writeMetaGguf(path.join(models, "target.gguf"), [
        { k: "general.architecture", t: "str", v: "qwen35" },
        { k: "general.name", t: "str", v: "target" },
        { k: "qwen35.embedding_length", t: "u32", v: 5120 },
        { k: "qwen35.nextn_predict_layers", t: "u32", v: 1 }
    ]);
    writeMetaGguf(path.join(models, "head.gguf"), [
        { k: "general.architecture", t: "str", v: "qwen35" },
        { k: "general.name", t: "str", v: "target head" },
        { k: "qwen35.embedding_length", t: "u32", v: 5120 },
        { k: "qwen35.block_count", t: "u32", v: 41 },
        { k: "qwen35.nextn_predict_layers", t: "u32", v: 1 }
    ]);
    // writeMetaGguf writes a zero tensor count, but a head needs a non-zero count below two per
    // block; patch the header's tensor-count field so the file classifies as an mtp-head.
    const headBytes = Buffer.from(fs.readFileSync(path.join(models, "head.gguf")));
    headBytes.writeBigUInt64LE(BigInt(23), 8);
    fs.writeFileSync(path.join(models, "head.gguf"), headBytes);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        const list = api.candidateDraftsFor("target.gguf");
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].id, "head.gguf");
        assert.strictEqual(list[0].kind, "mtp-head");
        assert.strictEqual(list[0].embeddedHead, true);
        assert.strictEqual(list[0].specType, "draft-mtp");
    });
});

test("readDrafts returns the parsed registry, and {} for absent or corrupt files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-drafts-"));
    const dir = path.join(root, "data", "llama");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "drafts.json"), JSON.stringify({ "a.gguf": { draft: "d.gguf" } }));
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        assert.deepStrictEqual(api.readDrafts(), { "a.gguf": { draft: "d.gguf" } });
    });

    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-drafts-bad-"));
    const dir2 = path.join(root2, "data", "llama");
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, "drafts.json"), "{ not json");
    await withEntry({ fullPath: MODULE_DIR, rootDir: root2 }, async (api) => {
        assert.deepStrictEqual(api.readDrafts(), {});
    });
});

test("per-model profiles are recorded in laststart.json for an auto-start replay", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-profiles-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        const profiles = {
            "tiny.gguf": { contextLength: 8192, kvType: "f16", specMode: "auto", draftId: null, mmprojMode: "auto" }
        };
        let err = null;
        try { await api.startLocal({ modelId: "tiny.gguf", profiles: profiles }); } catch (e) { err = e; }
        // The start itself cannot launch in this harness, but the per-model map must already be
        // recorded so the deferred auto-start replays each model's own settings.
        assert.ok(err, "expected the start to fail for want of a runtime payload");
        assert.deepStrictEqual(api.readStartState().settings.profiles, profiles);
        const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "llama", "laststart.json"), "utf8"));
        assert.deepStrictEqual(raw.settings.profiles, profiles);
    });
});

// Important 1 of the whole-feature review: saveStartState recorded every other server-level option
// but not reasoning, so autoStart (and the console) replayed settings without it and StartConfig
// fell back to "off" - a user's Auto/On choice was honoured on an explicit Start and silently lost
// after a restart. The recorded settings must round-trip the choice into a replay.
test("a non-default reasoning round-trips through laststart.json into a replay", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-reasoning-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        await attemptStart(api, { modelId: "tiny.gguf", reasoning: "auto" });
        const recorded = api.readStartState().settings;
        assert.strictEqual(recorded.reasoning, "auto", "the start must record the reasoning choice");
        const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "llama", "laststart.json"), "utf8"));
        assert.strictEqual(raw.settings.reasoning, "auto", "the on-disk record must carry it too");
        // A replay of exactly the recorded settings must produce "auto", not the "off" fallback.
        const StartConfig = require(path.join(MODULE_DIR, "lib", "StartConfig.js"));
        const replay = StartConfig.buildStartConfig({
            opts: recorded,
            entries: api.targetModels(),
            modelsDir: path.join(root, "data", "llama", "models"),
            fs: fs,
            profiles: recorded.profiles,
            associations: null
        });
        assert.strictEqual(replay.managerConfigPatch.reasoning, "auto");
    });
});

// Important 1 of Task 6: the three server-level KV limits and the per-model draft/fit values
// must survive into laststart.json, or an auto-start replay silently drops the user's values.
// Follow-up: the draft placement moved into the per-model profile, so it round-trips through
// the recorded profile map rather than the flat settings. Constraints carried from Tasks 3-5:
// the fit margin must stay an integer (or absent) so ModelArgs can never emit "--fit-target
// abc", and the KV scalars must be recorded.
test("the KV limits and the per-model draft/fit values round-trip into a replay", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-kvfit-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        const settings = {
            modelId: "tiny.gguf",
            cacheRam: 2048, ctxCheckpoints: 4, cacheReuse: 128,
            fitTarget: 256,
            profiles: { "tiny.gguf": { draftGpuLayers: 7, draftCpuMoeLayers: 3 } }
        };
        await attemptStart(api, settings);
        const recorded = api.readStartState().settings;
        assert.strictEqual(recorded.cacheRam, 2048, "cacheRam must be recorded");
        assert.strictEqual(recorded.ctxCheckpoints, 4, "ctxCheckpoints must be recorded");
        assert.strictEqual(recorded.cacheReuse, 128, "cacheReuse must be recorded");
        assert.strictEqual(recorded.fitTarget, 256, "the fit margin must be recorded");
        assert.strictEqual(recorded.profiles["tiny.gguf"].draftGpuLayers, 7,
            "the per-model draft placement must travel inside the recorded profile map");
        assert.strictEqual(recorded.profiles["tiny.gguf"].draftCpuMoeLayers, 3);
        const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "llama", "laststart.json"), "utf8"));
        assert.strictEqual(raw.settings.cacheRam, 2048);
        assert.strictEqual(raw.settings.fitTarget, 256);
        // A replay of exactly the recorded settings reproduces every value.
        const StartConfig = require(path.join(MODULE_DIR, "lib", "StartConfig.js"));
        const replay = StartConfig.buildStartConfig({
            opts: recorded,
            entries: api.targetModels(),
            modelsDir: path.join(root, "data", "llama", "models"),
            fs: fs,
            profiles: recorded.profiles,
            associations: null
        });
        assert.strictEqual(replay.managerConfigPatch.cacheRamMiB, 2048);
        assert.strictEqual(replay.managerConfigPatch.ctxCheckpoints, 4);
        assert.strictEqual(replay.managerConfigPatch.cacheReuseChunk, 128);
        assert.strictEqual(replay.tunedTarget.draftGpuLayers, 7);
        assert.strictEqual(replay.tunedTarget.draftCpuMoeLayers, 3);
        assert.strictEqual(replay.tunedTarget.fitTarget, 256);
    });
});

test("startLocal refuses an expert count on a model that has no experts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-meta-dense-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "dense.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        await assert.rejects(
            api.startLocal({ modelId: "dense.gguf", expertCount: 3 }),
            /not a Mixture-of-Experts model/
        );
    });
});

test("startLocal refuses an expert count larger than the model has", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-meta-toobig-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny-moe.gguf"), "gemma4", 128, 8);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        await assert.rejects(
            api.startLocal({ modelId: "tiny-moe.gguf", expertCount: 999 }),
            /has only 128 experts/
        );
    });
});

test("a chat template override round-trips through data/llama/templates", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-template-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "gemma4", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        assert.strictEqual(api.hasCustomTemplate(), false);
        // With no override and no running runtime there is nothing to show.
        const before = await api.readTemplate();
        assert.strictEqual(before.source, "unavailable");
        assert.strictEqual(before.text, "");

        const savedPath = api.saveTemplate(null, "{% for m in messages %}{{ m.content }}{% endfor %}");
        assert.strictEqual(api.hasCustomTemplate(), true);
        assert.strictEqual(savedPath.indexOf(path.join(root, "data", "llama", "templates")), 0);

        const after = await api.readTemplate();
        assert.strictEqual(after.source, "custom");
        assert.match(after.text, /messages/);
        assert.strictEqual(after.modelId, "tiny.gguf");

        assert.strictEqual(api.clearTemplate(), true);
        assert.strictEqual(api.hasCustomTemplate(), false);
        const reverted = await api.readTemplate();
        assert.strictEqual(reverted.source, "unavailable");
    });
});

test("saveTemplate refuses an empty template and keeps the file inside the templates dir", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-template-guard-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "gemma4", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        assert.throws(() => api.saveTemplate(null, "   "), /empty/);
        assert.throws(() => api.saveTemplate(null, ""), /empty/);
        // A path-like model id must not escape the templates directory: the separators are
        // neutralised, so the file still lands directly inside it.
        const savedPath = api.saveTemplate("../../evil.gguf", "x");
        assert.strictEqual(path.dirname(savedPath), path.join(root, "data", "llama", "templates"));
        assert.strictEqual(api.hasCustomTemplate("../../evil.gguf"), true);
    });
});

test("startLocal refuses an extra library folder that does not exist", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-libdir-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        await assert.rejects(
            api.startLocal({ modelId: "tiny.gguf", libDir: path.join(root, "no-such-folder") }),
            /extra library folder does not exist/i
        );
        // A real directory passes validation and gets as far as launching the server, which
        // cannot work in a test - so the failure must not be the validation one.
        const realDir = path.join(root, "rocm-lib");
        fs.mkdirSync(realDir, { recursive: true });
        let err = null;
        try { await api.startLocal({ modelId: "tiny.gguf", libDir: realDir }); } catch (e) { err = e; }
        assert.ok(err, "expected the start to fail for want of a runtime payload");
        assert.doesNotMatch(String(err.message), /extra library folder/i);
    });
});

test("startLocal with force drops a previously attached runtime and proceeds to an owned start", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-force-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        // The state attachToRunning leaves behind: ready and externally owned.
        api.manager.state = Object.assign({}, api.manager.state, {
            status: "ready", attached: true, owner: "external",
            baseUrl: "http://127.0.0.1:1234", port: 1234, modelId: "m1"
        });
        let err = null;
        try { await api.startLocal({ modelId: "tiny.gguf", force: true }); } catch (e) { err = e; }
        // It must reach the real start path (which fails here for want of a payload), not refuse
        // with "Runtime is already ready".
        assert.ok(err, "expected the forced start to fail for want of a usable runtime payload");
        assert.doesNotMatch(String(err.message), /already (ready|starting)/);
        const state = api.status();
        assert.strictEqual(state.attached, false);
        assert.strictEqual(state.owner, null);
        assert.strictEqual(state.baseUrl, null);
        assert.strictEqual(state.port, null);
    });
});

test("a vanished attachment does not wedge the next normal start", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-wedge-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        // The exact wedge sequence: the editor attached to the console launcher (attachToRunning
        // set ready + external owner), then the launcher exited normally and DELETED its
        // runtime.json record. The state still claims ready/attached, and there is no record on
        // disk for the next attach to find or clear.
        api.manager.state = Object.assign({}, api.manager.state, {
            status: "ready", attached: true, owner: "external",
            baseUrl: "http://127.0.0.1:1234", port: 1234, modelId: "m1"
        });
        assert.strictEqual(fs.existsSync(path.join(root, "data", "llama", "runtime.json")), false);
        let err = null;
        try { await api.startLocal({ modelId: "tiny.gguf" }); } catch (e) { err = e; }
        // The normal (non-force) start must reach the real start path (which fails here for want
        // of a payload), not refuse with "Runtime is already ready" and wedge the editor.
        assert.ok(err, "expected the start to fail for want of a usable runtime payload");
        assert.doesNotMatch(String(err.message), /already (ready|starting)/);
        const state = api.status();
        assert.strictEqual(state.attached, false);
        assert.strictEqual(state.owner, null);
        assert.strictEqual(state.baseUrl, null);
        assert.strictEqual(state.port, null);
    });
});

// The port options are applied to manager.config before the (here impossible) server launch, so
// they can be asserted even though every start in this harness ends in a missing-payload error.
async function attemptStart(api, opts) {
    try { await api.startLocal(opts); } catch (e) { return e; }
    return null;
}

test("a blank port start uses 1234 and does not keep a previous explicit port", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-port-blank-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        await attemptStart(api, { modelId: "tiny.gguf", port: 4321 });
        assert.strictEqual(api.manager.config.port, 4321);

        // A blank value restores the shipped default rather than leaving 4321 in place.
        await attemptStart(api, { modelId: "tiny.gguf", port: "" });
        assert.strictEqual(api.manager.config.port, 1234);
        // The state file records what was actually used, not null (the launcher reads this).
        assert.strictEqual(api.readStartState().settings.port, 1234);
        const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "llama", "laststart.json"), "utf8"));
        assert.strictEqual(raw.settings.port, 1234);

        // Same for a value that is absent entirely.
        await attemptStart(api, { modelId: "tiny.gguf", port: 4321 });
        await attemptStart(api, { modelId: "tiny.gguf" });
        assert.strictEqual(api.manager.config.port, 1234);
    });
});

test("an invalid configured port rejects the start with a message naming the value", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-port-bad-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "tiny.gguf"), "qwen35", null, null);
    await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
        for (const bad of [0, -1, 65536, 70000, 1.5, "1.5", "abc", "1e2", "0x50", "0b101", Infinity, NaN]) {
            const err = await attemptStart(api, { modelId: "tiny.gguf", port: bad });
            assert.ok(err, "port " + String(bad) + " must reject the start");
            assert.match(String(err.message), /invalid port/, "port " + String(bad) + ": " + err.message);
        }
        assert.match(String((await attemptStart(api, { modelId: "tiny.gguf", port: 70000 })).message), /70000/);
        assert.match(String((await attemptStart(api, { modelId: "tiny.gguf", port: "abc" })).message), /"abc"/);

        // It must not overwrite a previously applied valid port.
        await attemptStart(api, { modelId: "tiny.gguf", port: 4321 });
        assert.strictEqual(api.manager.config.port, 4321);
        await attemptStart(api, { modelId: "tiny.gguf", port: 0 });
        assert.strictEqual(api.manager.config.port, 4321);
        // And a fresh invalid attempt does not quietly start on the default either.
        assert.notStrictEqual(String((await attemptStart(api, { modelId: "tiny.gguf", port: 70000 })).message), "");
    });
});

// --- Model switch against a console-owned runtime (the Start takeover) -------------------

const http = require("node:http");
const childProcess = require("node:child_process");

// A stand-in console runtime: a real HTTP endpoint answering /health and /v1/models, because
// attachToRunning probes through the addon's real httpAdapter. Unref'd so it can never hold
// the test process open.
function fakeConsoleRuntime(modelId) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            res.setHeader("Content-Type", "application/json");
            if (req.url === "/health") { res.end(JSON.stringify({ status: "ok" })); return; }
            if (req.url === "/v1/models") { res.end(JSON.stringify({ data: [{ id: modelId, object: "model" }] })); return; }
            res.statusCode = 404;
            res.end("{}");
        });
        server.unref();
        server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    });
}

// A genuinely alive process for the record's pid: the liveness probes only signal 0, so the
// stub has to exist, and a takeover has to have something real to wait for.
function spawnStubLauncher() {
    return childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
}

function writeConsoleRecord(root, stub, fake, modelId) {
    const dir = path.join(root, "data", "llama");
    fs.mkdirSync(dir, { recursive: true });
    const recordPath = path.join(dir, "runtime.json");
    fs.writeFileSync(recordPath, JSON.stringify({
        version: 1, pid: stub.pid, port: fake.port,
        baseUrl: "http://127.0.0.1:" + fake.port, modelId: modelId,
        startedAt: new Date().toISOString()
    }));
    return recordPath;
}

test("a start naming the model the console runtime serves attaches instead of taking over", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-attach-match-"));
    const stub = spawnStubLauncher();
    const fake = await fakeConsoleRuntime("console-model.gguf");
    const recordPath = writeConsoleRecord(root, stub, fake, "console-model.gguf");
    const killed = [];
    try {
        await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
            const state = await api.startLocal({
                modelId: "console-model.gguf",
                externalStop: (pid) => { killed.push(pid); }
            });
            assert.strictEqual(state.attached, true);
            assert.strictEqual(state.owner, "external");
            assert.strictEqual(state.modelId, "console-model.gguf");
            assert.deepStrictEqual(killed, [], "a matching model must attach, never kill the console runtime");
            assert.strictEqual(fs.existsSync(recordPath), true, "an attach leaves the record in place");
        });
    } finally {
        fake.server.close();
        stub.kill("SIGKILL");
    }
});

test("a start naming a different model takes the console runtime over and starts the requested model", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-attach-switch-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "other.gguf"), "qwen35", null, null);
    const stub = spawnStubLauncher();
    const fake = await fakeConsoleRuntime("console-model.gguf");
    const recordPath = writeConsoleRecord(root, stub, fake, "console-model.gguf");
    const killed = [];
    try {
        await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
            let err = null;
            try {
                await api.startLocal({
                    modelId: "other.gguf", port: 5678,
                    externalStop: (pid) => {
                        killed.push(pid);
                        return new Promise((resolve) => { stub.once("exit", resolve); stub.kill("SIGKILL"); });
                    }
                });
            } catch (e) { err = e; }
            // The owned start of the requested model really ran: it fails here for want of a
            // runtime payload, never with the "already ready" refusal an un-reset attach state
            // would produce.
            assert.ok(err, "expected the owned start to fail for want of a usable runtime payload");
            assert.doesNotMatch(String(err.message), /already (ready|starting)/);
            // The external stop went through the record's launcher pid, the takeover cleared the
            // record, and the owned start applied the requested model's config (the port patch
            // lands before the launch attempt, so it is observable even though the launch itself
            // cannot run in this harness).
            assert.deepStrictEqual(killed, [stub.pid]);
            assert.strictEqual(fs.existsSync(recordPath), false, "the takeover must clear the record");
            assert.strictEqual(api.manager.config.port, 5678);
            assert.strictEqual(api.status().attached, false);
            assert.strictEqual(api.status().owner, null);
        });
    } finally {
        fake.server.close();
        stub.kill("SIGKILL");
    }
});

test("an autoStart pass with a mismatched model attaches instead of killing the console runtime", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-attach-autostart-"));
    const stub = spawnStubLauncher();
    const fake = await fakeConsoleRuntime("console-model.gguf");
    const recordPath = writeConsoleRecord(root, stub, fake, "console-model.gguf");
    const killed = [];
    try {
        await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
            // autoStart() runs with no click three seconds after app open and passes the
            // recorded settings on; when the registry now resolves a different target than
            // the console serves, the conservative choice is to serve what is running.
            const state = await api.startLocal({
                modelId: "other.gguf", autoStart: true,
                externalStop: (pid) => { killed.push(pid); }
            });
            assert.strictEqual(state.attached, true);
            assert.strictEqual(state.owner, "external");
            assert.strictEqual(state.modelId, "console-model.gguf", "the attach serves the model actually running");
            assert.deepStrictEqual(killed, [], "an autoStart mismatch must never kill the console runtime");
            assert.strictEqual(fs.existsSync(recordPath), true, "the console session stays recorded");
        });
    } finally {
        fake.server.close();
        stub.kill("SIGKILL");
    }
});

test("a takeover whose launcher will not die fails the start with a clear message", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmrt-attach-timeout-"));
    writeTinyGguf(path.join(root, "data", "llama", "models", "other.gguf"), "qwen35", null, null);
    const stub = spawnStubLauncher();
    const fake = await fakeConsoleRuntime("console-model.gguf");
    const recordPath = writeConsoleRecord(root, stub, fake, "console-model.gguf");
    const killed = [];
    try {
        await withEntry({ fullPath: MODULE_DIR, rootDir: root }, async (api) => {
            await assert.rejects(
                api.startLocal({
                    modelId: "other.gguf",
                    externalStop: (pid) => { killed.push(pid); },
                    externalStopWaitMs: 500
                }),
                (err) => {
                    const message = String(err.message);
                    assert.match(message, /Could not take over the console runtime on port/);
                    assert.match(message, /did not stop within/);
                    assert.ok(message.includes(String(fake.port)), "the error must name the port: " + message);
                    assert.doesNotMatch(message, /already (ready|starting)/);
                    return true;
                }
            );
            assert.deepStrictEqual(killed, [stub.pid]);
            // Fail-safe: the launcher still runs, so the record must survive - it still
            // describes a live runtime, and clearing it would hide that.
            assert.strictEqual(fs.existsSync(recordPath), true);
        });
    } finally {
        fake.server.close();
        stub.kill("SIGKILL");
    }
});

// A start that dies for lack of GPU memory is retried once with a layer count derived from
// the dead child's own stderr, and stays on the GPU; any other failure (and a failed retry)
// is a hard error carrying the child's output. The old GPU->CPU fallback is retired on
// purpose: it silently traded a fast runtime for an unusably slow CPU one.
test("an out-of-memory start is retried with fewer GPU layers; other failures stay hard", () => {
    const src = fs.readFileSync(ENTRY, "utf8");
    assert.match(src, /isAllocFailure/, "the retry must be gated on the child's own error signature");
    assert.match(src, /computeFallbackGpuLayers/, "the retry's layer count must come from the failed start's log");
    assert.match(src, /rt\.manager\.setNote\(state\.note\)/,
        "the retry note must reach the manager's live state, not just the return value");
    assert.match(src, /failureAdvice/, "a failed start must tell the user which setting to lower");
    assert.doesNotMatch(src, /retrying on CPU/,
        "the GPU->CPU fallback is retired: a hard error beats a silent, very slow CPU start");
});
