"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const StartConfig = require("../lib/StartConfig.js");
const ModelArgs = require("../lib/ModelArgs.js");
const { RuntimeManager, DEFAULT_CONFIG } = require("../lib/RuntimeManager.js");

// Minimal GGUF writer for the metadata paths: header plus a few string/uint32 keys.
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

function entry(id, extra) {
    return Object.assign({ id: id, contextSize: 32768, gpuLayers: "auto", modelPath: "/models/" + id }, extra || {});
}

function build(opts) {
    return StartConfig.buildStartConfig(Object.assign({
        opts: {}, entries: [entry("m1.gguf")], modelsDir: "/models", fs: fs
    }, opts || {}));
}

test("maps the recorded settings onto a manager config patch without touching any manager", () => {
    const cfg = build({ opts: {
        modelId: "m1.gguf", kvType: "q5_1", kvUnified: false, kvOffload: false,
        modelsMax: 2, sleepIdleSeconds: 300, threads: 6, threadsBatch: 3, port: 4567,
        backend: "cuda", libDir: ""
    } });
    assert.deepStrictEqual(cfg.managerConfigPatch, {
        kvUnified: false, kvOffload: false,
        modelsMax: 2, sleepIdleSeconds: 300, threads: 6, threadsBatch: 3,
        waitIdleSeconds: DEFAULT_CONFIG.waitIdleSeconds,
        port: 4567, backendPreference: "cuda", libDir: null,
        // The reasoning default travels on the patch exactly like the other server-level knobs.
        reasoning: "off"
    });
    // The cache type and the expert override moved from the manager patch to the entry.
    assert.strictEqual("cacheTypeK" in cfg.managerConfigPatch, false);
    assert.strictEqual("cacheTypeV" in cfg.managerConfigPatch, false);
    assert.strictEqual("overrideKv" in cfg.managerConfigPatch, false);
    assert.strictEqual(cfg.tunedTarget.kvTypeK, "q5_1");
    assert.strictEqual(cfg.tunedTarget.kvTypeV, "q5_1");
    assert.strictEqual(cfg.tunedTarget.overrideKv, null);
    assert.strictEqual(cfg.targetId, "m1.gguf");
    assert.strictEqual(cfg.tunedTarget.id, "m1.gguf");
    assert.strictEqual(cfg.forceCpu, false);
});

test("an empty settings object produces the shipped defaults", () => {
    const cfg = build({});
    assert.strictEqual(cfg.managerConfigPatch.kvUnified, true);
    assert.strictEqual(cfg.managerConfigPatch.kvOffload, true);
    assert.strictEqual(cfg.managerConfigPatch.modelsMax, DEFAULT_CONFIG.modelsMax);
    assert.strictEqual(cfg.managerConfigPatch.sleepIdleSeconds, 0);
    assert.strictEqual(cfg.managerConfigPatch.threads, 0);
    assert.strictEqual(cfg.managerConfigPatch.threadsBatch, 0);
    assert.strictEqual("overrideKv" in cfg.managerConfigPatch, false);
    assert.strictEqual(cfg.managerConfigPatch.backendPreference, null);
    // cacheTypeK/V and backendPreference are only in the patch when the settings name them;
    // the cache type and the expert override now live on the model entry.
    assert.strictEqual("cacheTypeK" in cfg.managerConfigPatch, false);
    assert.strictEqual("cacheTypeV" in cfg.managerConfigPatch, false);
    assert.strictEqual(cfg.tunedTarget.kvTypeK, "q8_0");
    assert.strictEqual(cfg.tunedTarget.kvTypeV, "q8_0");
    assert.strictEqual(cfg.tunedTarget.overrideKv, null);
    assert.strictEqual(cfg.kvType, "q8_0");
    // An unset KV type still reaches the entry as the shipped q8_0, so an untouched install does
    // not silently drop to llama.cpp's f16 default. The split keys replace the single kvType, and
    // ModelArgs (a later task) reads them to emit --cache-type-k/--cache-type-v.
    assert.strictEqual("kvType" in cfg.tunedTarget, false, "the retired single key must not survive on the entry");
});

test("an unknown reasoning value falls back to off in the manager patch", () => {
    const cfg = build({ opts: { reasoning: "sometimes" } });
    assert.strictEqual(cfg.managerConfigPatch.reasoning, "off");
});

test("reasoning maps the real values through and defaults an unset option to off", () => {
    assert.strictEqual(build({ opts: { reasoning: "on" } }).managerConfigPatch.reasoning, "on");
    assert.strictEqual(build({ opts: { reasoning: "auto" } }).managerConfigPatch.reasoning, "auto");
    assert.strictEqual(build({ opts: {} }).managerConfigPatch.reasoning, "off");
    assert.strictEqual(build({ opts: { reasoning: "" } }).managerConfigPatch.reasoning, "off");
});

test("an unknown kvType is ignored and an unknown backend restores the automatic order", () => {
    const cfg = build({ opts: { kvType: "bogus", backend: "auto" } });
    assert.strictEqual("cacheTypeK" in cfg.managerConfigPatch, false);
    assert.strictEqual("cacheTypeV" in cfg.managerConfigPatch, false);
    assert.strictEqual(cfg.tunedTarget.kvTypeK, "q8_0");
    assert.strictEqual(cfg.tunedTarget.kvTypeV, "q8_0");
    assert.strictEqual(cfg.kvType, "q8_0");
    assert.strictEqual(cfg.managerConfigPatch.backendPreference, null);
    const untouched = build({ opts: { backend: "metal" } });
    assert.strictEqual("backendPreference" in untouched.managerConfigPatch, false);
    assert.strictEqual(untouched.forceCpu, false);
});

test("backend cpu forces the CPU start without setting a backend preference", () => {
    const cfg = build({ opts: { backend: "cpu" } });
    assert.strictEqual(cfg.forceCpu, true);
    assert.strictEqual("backendPreference" in cfg.managerConfigPatch, false);
});

test("modelsMax, sleep, threads and threadsBatch parsing restores defaults on blank values", () => {
    const cfg = build({ opts: { modelsMax: "", sleepIdleSeconds: "x", threads: 0, threadsBatch: 9 } });
    assert.strictEqual(cfg.managerConfigPatch.modelsMax, DEFAULT_CONFIG.modelsMax);
    assert.strictEqual(cfg.managerConfigPatch.sleepIdleSeconds, 0);
    assert.strictEqual(cfg.managerConfigPatch.threads, 0);
    assert.strictEqual(cfg.managerConfigPatch.threadsBatch, 0);
    assert.strictEqual(cfg.modelsMax, null);
    assert.strictEqual(cfg.threads, null);
    assert.strictEqual(cfg.threadsBatch, null);
});

test("a valid threads with a blank threadsBatch derives the batch count from threads", () => {
    const cfg = build({ opts: { threads: "4", threadsBatch: "" } });
    assert.strictEqual(cfg.managerConfigPatch.threads, 4);
    assert.strictEqual(cfg.managerConfigPatch.threadsBatch, 4);
});

test("KV cache knobs patch only in-range values and keep the default otherwise", () => {
    // cacheRam and ctx-checkpoints accept 0 (disable the prompt cache / no minimum spacing);
    // cache-reuse requires a positive value. Anything out of range is left out of the patch so
    // the RuntimeManager default stands.
    const cfg = build({ opts: { cacheRam: "2048", ctxCheckpoints: "4", cacheReuse: "128" } });
    assert.strictEqual(cfg.managerConfigPatch.cacheRamMiB, 2048);
    assert.strictEqual(cfg.managerConfigPatch.ctxCheckpoints, 4);
    assert.strictEqual(cfg.managerConfigPatch.cacheReuseChunk, 128);
    assert.strictEqual(cfg.cacheRamMiB, 2048);
    assert.strictEqual(cfg.ctxCheckpoints, 4);
    assert.strictEqual(cfg.cacheReuseChunk, 128);

    // 0 is valid for cache-ram and ctx-checkpoints, but not for cache-reuse.
    const zeros = build({ opts: { cacheRam: "0", ctxCheckpoints: "0", cacheReuse: "0" } });
    assert.strictEqual(zeros.managerConfigPatch.cacheRamMiB, 0);
    assert.strictEqual(zeros.managerConfigPatch.ctxCheckpoints, 0);
    assert.strictEqual("cacheReuseChunk" in zeros.managerConfigPatch, false);

    // Blank, negative and non-numeric values leave the field out of the patch entirely.
    for (const bad of ["", "  ", "abc", "-1", "-2048", null, undefined, NaN]) {
        const out = build({ opts: { cacheRam: bad, ctxCheckpoints: bad, cacheReuse: bad } });
        assert.strictEqual("cacheRamMiB" in out.managerConfigPatch, false, "cacheRam must stay unset for " + String(bad));
        assert.strictEqual("ctxCheckpoints" in out.managerConfigPatch, false, "ctxCheckpoints must stay unset for " + String(bad));
        assert.strictEqual("cacheReuseChunk" in out.managerConfigPatch, false, "cacheReuse must stay unset for " + String(bad));
    }
});

test("the card's draft/fit options reach the selected entry and fitTarget only accepts integers", () => {
    const cfg = build({ opts: {
        modelId: "m1.gguf",
        draftGpuLayers: "8", draftCpuMoe: true, draftCpuMoeLayers: 3,
        fitTarget: "512"
    } });
    assert.strictEqual(cfg.tunedTarget.draftGpuLayers, 8);
    // The broad draft MoE switch wins over the finer layer count, exactly as the target's own pair.
    assert.strictEqual(cfg.tunedTarget.draftCpuMoe, true);
    assert.strictEqual("draftCpuMoeLayers" in cfg.tunedTarget, false);
    assert.strictEqual(cfg.tunedTarget.fitTarget, 512);
    // A non-numeric fit margin is dropped entirely, so ModelArgs can never emit "--fit-target abc".
    const bad = build({ opts: { modelId: "m1.gguf", fitTarget: "abc" } });
    assert.strictEqual("fitTarget" in bad.tunedTarget, false);
    // 0 is a real value (documented as OOM-risky), not "unset".
    assert.strictEqual(build({ opts: { modelId: "m1.gguf", fitTarget: 0 } }).tunedTarget.fitTarget, 0);
    assert.strictEqual("fitTarget" in build({}).tunedTarget, false);
});

test("with profiles present the draft placement comes from the profile; fitTarget decorates the selected entry", () => {
    const entries = [entry("a.gguf"), entry("b.gguf")];
    const cfg = build({
        entries: entries,
        opts: { modelId: "b.gguf", draftGpuLayers: 99, fitTarget: 256 },
        profiles: { "a.gguf": {}, "b.gguf": { draftGpuLayers: 12 } }
    });
    // The card's global draft value no longer stomps the per-model one: the draft placement
    // trio is profile state, so the profile's own value stands (an untouched profile resolves
    // to the "auto" default). Before the move, opts.draftGpuLayers was stamped onto the
    // selected entry on every start, which made the setting server-wide despite the profiles.
    assert.strictEqual(cfg.tunedModels[0].draftGpuLayers, "auto");
    assert.strictEqual(cfg.tunedTarget.draftGpuLayers, 12);
    // The VRAM headroom stays a card-level setting and decorates only the selected entry.
    assert.strictEqual(cfg.tunedModels[0].fitTarget, undefined);
    assert.strictEqual(cfg.tunedTarget.fitTarget, 256);
    // The draft flags only reach the entry; ModelArgs gates their emission on the draft pairing.
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { device: null });
    assert.strictEqual(args.indexOf("--spec-draft-ngl"), -1, "no draft paired, so no draft flag");
    assert.strictEqual(args.indexOf("--fit-target"), -1, "no device, so no fit margin");
});

test("waitIdleSeconds maps to seconds; parallel slots are no longer a manager setting", () => {
    const cfg = build({ opts: { waitIdleSeconds: "120", parallel: 4 } });
    assert.strictEqual(cfg.managerConfigPatch.waitIdleSeconds, 120);
    assert.strictEqual(cfg.waitIdleSeconds, 120);
    // The old global parallel option is retired: it never reaches the manager patch.
    assert.strictEqual(cfg.managerConfigPatch.parallel, undefined);
    assert.strictEqual(cfg.parallel, undefined);
    // 0 is kept (disables the wait); empty/invalid restores the shipped 30 minutes.
    assert.strictEqual(build({ opts: { waitIdleSeconds: 0 } }).managerConfigPatch.waitIdleSeconds, 0);
    assert.strictEqual(build({ opts: { waitIdleSeconds: "" } }).managerConfigPatch.waitIdleSeconds, DEFAULT_CONFIG.waitIdleSeconds);
    assert.strictEqual(build({ opts: { waitIdleSeconds: "abc" } }).managerConfigPatch.waitIdleSeconds, DEFAULT_CONFIG.waitIdleSeconds);
});

test("a fractional waitIdleSeconds is a real cap (0.5 -> 500 ms) and does not disable the wait", () => {
    // parseInt("0.5") is 0, and 0 means "do not wait" - so a fractional value used to silently
    // disable the model-switch wait. Number() keeps it, and the manager turns it into 500 ms.
    const cfg = build({ opts: { waitIdleSeconds: "0.5" } });
    assert.strictEqual(cfg.managerConfigPatch.waitIdleSeconds, 0.5);
    assert.strictEqual(cfg.waitIdleSeconds, 0.5);
    const manager = new RuntimeManager({ config: { platformKey: "linux-x64", waitIdleSeconds: cfg.managerConfigPatch.waitIdleSeconds } });
    assert.strictEqual(manager._waitForIdleTimeoutMs(), 500);
    assert.ok(manager._waitForIdleTimeoutMs() > 0, "0.5 s must not disable the wait");
    // Whitespace-only is "not set", like an empty field.
    assert.strictEqual(build({ opts: { waitIdleSeconds: "   " } }).managerConfigPatch.waitIdleSeconds, DEFAULT_CONFIG.waitIdleSeconds);
});

test("a profile's parallelSlots reaches the entry; an invalid value leaves it unset", () => {
    const entries = [
        entry("a.gguf", { arch: "qwen35", modelPath: "/m/a.gguf" }),
        entry("b.gguf", { arch: "gemma4", modelPath: "/m/b.gguf" })
    ];
    const cfg = build({ entries: entries, profiles: { "a.gguf": { parallelSlots: 4 }, "b.gguf": {} } });
    const a = cfg.tunedModels.find(function (m) { return m.id === "a.gguf"; });
    const b = cfg.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    assert.strictEqual(a.parallelSlots, 4);
    assert.strictEqual("parallelSlots" in b, false, "a model without the setting must not carry the key");
    // The manager patch must not grow a global parallel field from the profile.
    assert.strictEqual(cfg.managerConfigPatch.parallel, undefined);
    // Invalid values (0, negative, fractional, string) leave the entry without the key.
    for (const bad of [0, -1, 2.5, "4", "", null, undefined, NaN]) {
        const out = build({ entries: [entry("a.gguf", { arch: "qwen35", modelPath: "/m/a.gguf" })],
            profiles: { "a.gguf": { parallelSlots: bad } } });
        assert.strictEqual("parallelSlots" in out.tunedTarget, false, "parallelSlots must stay unset for " + String(bad));
    }
});

test("only the model whose profile sets parallelSlots emits --parallel in its argv", () => {
    const entries = [
        entry("a.gguf", { arch: "qwen35", modelPath: "/m/a.gguf" }),
        entry("b.gguf", { arch: "gemma4", modelPath: "/m/b.gguf" })
    ];
    const cfg = build({ entries: entries, modelsDir: "/models",
        profiles: { "a.gguf": { parallelSlots: 3 }, "b.gguf": {} } });
    const a = cfg.tunedModels.find(function (m) { return m.id === "a.gguf"; });
    const b = cfg.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    const argsA = ModelArgs.buildModelArgs(a, { host: "127.0.0.1", port: 8730 });
    const argsB = ModelArgs.buildModelArgs(b, { host: "127.0.0.1", port: 8731 });
    assert.strictEqual(argsA[argsA.indexOf("--parallel") + 1], "3");
    assert.strictEqual(argsB.indexOf("--parallel"), -1, "the other model must not get --parallel");
});

test("a blank port uses the default port argument; an omitted argument reads DEFAULT_CONFIG", () => {
    assert.strictEqual(build({ opts: { port: "" }, defaultPort: 4321 }).managerConfigPatch.port, 4321);
    assert.strictEqual(build({ opts: {} }).managerConfigPatch.port, DEFAULT_CONFIG.port);
    assert.strictEqual(build({ opts: { port: " 8080 " } }).managerConfigPatch.port, 8080);
});

test("an invalid port throws with normalizePort's reason naming the value", () => {
    for (const bad of [0, -1, 65536, 70000, 1.5, "1.5", "abc", "1e2", "0x50"]) {
        assert.throws(() => build({ opts: { port: bad } }),
            (err) => /invalid port/.test(err.message) && err.message.includes(String(bad)),
            "port " + String(bad));
    }
});

test("selects the requested model, else a paired draft, else the first entry", () => {
    const entries = [
        entry("a.gguf"),
        entry("b.gguf", { draftPath: "/models/draft.gguf", specType: "draft-dflash", specDraftNMax: 8 }),
        entry("c.gguf")
    ];
    assert.strictEqual(build({ entries, opts: { modelId: "c.gguf" } }).targetId, "c.gguf");
    assert.strictEqual(build({ entries, opts: {} }).targetId, "b.gguf");
    assert.strictEqual(build({ entries: [entry("z.gguf")], opts: {} }).targetId, "z.gguf");
});

test("tunes context length, draft bounds and offload onto the target entry only", () => {
    const entries = [
        entry("m1.gguf", { draftPath: "/models/draft.gguf", specType: "draft-dflash", specDraftNMax: 16 }),
        entry("m2.gguf")
    ];
    const cfg = build({ entries, opts: {
        modelId: "m1.gguf", contextLength: 1024, draftMax: 10, draftMin: 2, gpuLayers: 7, cpuMoe: true
    } });
    const target = cfg.tunedModels.find((e) => e.id === "m1.gguf");
    const other = cfg.tunedModels.find((e) => e.id === "m2.gguf");
    assert.strictEqual(target.contextSize, 1024);
    assert.strictEqual(target.specDraftNMax, 10);
    assert.strictEqual(target.specDraftNMin, 2);
    assert.strictEqual(target.gpuLayers, 7);
    assert.strictEqual(target.cpuMoe, true);
    assert.strictEqual(other.contextSize, 32768);
    assert.strictEqual(other.gpuLayers, "auto");
});

test("a below-minimum context length leaves the registry default in place", () => {
    const cfg = build({ opts: { contextLength: 100 } });
    assert.strictEqual(cfg.tunedTarget.contextSize, 32768);
});

test("buildStartConfig throws the no-models message for an empty model list", () => {
    assert.throws(() => build({ entries: [] }),
        /No GGUF models found in \/models\. Put GGUF files in data\/llama\/models\/\./);
});

test("an expert override is keyed by the model's architecture and checked against its metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "startcfg-moe-"));
    const p = path.join(root, "moe.gguf");
    writeTinyGguf(p, "gemma4", 128, 8);
    const entries = [entry("moe.gguf", { modelPath: p })];
    const cfg = build({ entries, opts: { expertCount: 8 } });
    assert.deepStrictEqual(cfg.tunedTarget.overrideKv, { "gemma4.expert_used_count": "int:8" });
    assert.strictEqual("overrideKv" in cfg.managerConfigPatch, false);
    assert.deepStrictEqual(cfg.expertInfo, { count: 8, available: 128, arch: "gemma4" });
});

test("expert overrides keep the addon's validation errors", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "startcfg-expert-"));
    const dense = path.join(root, "dense.gguf");
    const moe = path.join(root, "moe.gguf");
    const broken = path.join(root, "broken.gguf");
    writeTinyGguf(dense, "qwen35", null, null);
    writeTinyGguf(moe, "gemma4", 128, 8);
    fs.writeFileSync(broken, "not a gguf");
    assert.throws(() => build({ entries: [entry("dense.gguf", { modelPath: dense })], opts: { expertCount: 3 } }),
        /not a Mixture-of-Experts model/);
    assert.throws(() => build({ entries: [entry("moe.gguf", { modelPath: moe })], opts: { expertCount: 999 } }),
        /has only 128 experts, so 999 cannot be used\./);
    assert.throws(() => build({ entries: [entry("broken.gguf", { modelPath: broken })], opts: { expertCount: 3 } }),
        /Could not read the model's architecture/);
    assert.throws(() => build({ entries: [entry("nope.gguf", { modelPath: null })], opts: { expertCount: 3 } }),
        /no file path, so the expert count cannot be applied/);
    // A non-numeric or below-1 expertCount is simply not applied.
    const ignored = build({ entries: [entry("m1.gguf")], opts: { expertCount: "abc" } });
    assert.strictEqual(ignored.expertInfo, null);
    assert.strictEqual(ignored.tunedTarget.overrideKv, null);
});

test("an extra library folder must exist as a directory, and a blank one is cleared", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "startcfg-libdir-"));
    const real = path.join(root, "rocm");
    fs.mkdirSync(real, { recursive: true });
    assert.strictEqual(build({ opts: { libDir: real } }).managerConfigPatch.libDir, real);
    assert.strictEqual(build({ opts: { libDir: "  " } }).managerConfigPatch.libDir, null);
    assert.strictEqual(build({ opts: {} }).managerConfigPatch.libDir, null);
    const missing = path.join(root, "missing");
    assert.throws(() => build({ opts: { libDir: missing + "  " } }),
        new Error("The extra library folder does not exist: " + missing));
});

test("a saved chat template is picked up from the templates dir by the model id", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "startcfg-tpl-"));
    const templatesDir = path.join(root, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    const saved = path.join(templatesDir, "m1.gguf.jinja");
    fs.writeFileSync(saved, "{% for m in messages %}{{ m.content }}{% endfor %}");
    const cfg = build({ opts: {}, templatesDir: templatesDir });
    assert.strictEqual(cfg.tunedTarget.chatTemplatePath, saved);
    const none = build({ opts: {}, templatesDir: path.join(root, "empty") });
    assert.strictEqual(none.tunedTarget.chatTemplatePath, undefined);
    // A null templates dir reads as "no override" rather than throwing.
    const skipped = build({ opts: {}, templatesDir: null });
    assert.strictEqual(skipped.tunedTarget.chatTemplatePath, undefined);
});

test("templateFileName sanitises path-hostile model ids like the editor does", () => {
    assert.strictEqual(StartConfig.templateFileName("a/b\\c:d*e?f\"g<h>i|j.gguf"), "a_b_c_d_e_f_g_h_i_j.gguf.jinja");
    assert.strictEqual(StartConfig.templateFileName("../../evil.gguf"), ".._.._evil.gguf.jinja");
    assert.strictEqual(StartConfig.templateFileName(""), "model.jinja");
    assert.strictEqual(StartConfig.templateFileName(null), "model.jinja");
    assert.strictEqual(StartConfig.templateFileName("trailing..."), "trailing.jinja");
});

test("cache type and the expert override travel with each model entry, not the manager", () => {
    const out = build({
        entries: [
            entry("a.gguf", { arch: "qwen35moe", modelPath: "/m/a.gguf", expertCount: 256 }),
            entry("b.gguf", { arch: "qwen35moe", modelPath: "/m/b.gguf" })
        ],
        opts: { modelId: "a.gguf", kvType: "q8_0", expertCount: 3 }
    });
    const a = out.tunedModels.find(function (m) { return m.id === "a.gguf"; });
    const b = out.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    assert.strictEqual(a.kvTypeK, "q8_0");
    assert.strictEqual(a.kvTypeV, "q8_0");
    assert.deepStrictEqual(a.overrideKv, { "qwen35moe.expert_used_count": "int:3" });
    assert.strictEqual(b.kvTypeK, "q8_0");
    assert.strictEqual(b.kvTypeV, "q8_0");
    assert.strictEqual(b.overrideKv, undefined);
    assert.strictEqual(out.managerConfigPatch.cacheTypeK, undefined);
    assert.strictEqual(out.managerConfigPatch.overrideKv, undefined);
});

// --- Per-model profiles (Task 9b) --------------------------------------------------------

test("profiles decorate every model section with that model's own settings", () => {
    const entries = [
        entry("a.gguf", { arch: "qwen35", modelPath: "/m/a.gguf" }),
        entry("b.gguf", { arch: "gemma4", modelPath: "/m/b.gguf" })
    ];
    const profiles = {
        "a.gguf": { contextLength: 8192, kvType: "q5_1", gpuLayers: 12, cpuMoeLayers: 4 },
        "b.gguf": { contextLength: 4096, kvType: "f16", gpuLayers: 0, mainGpu: 1 }
    };
    const cfg = build({ entries: entries, opts: { modelId: "b.gguf" }, profiles: profiles });
    const a = cfg.tunedModels.find(function (m) { return m.id === "a.gguf"; });
    const b = cfg.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    // Not just the selected target: each entry carries its own profile.
    assert.strictEqual(a.contextSize, 8192);
    assert.strictEqual(a.kvTypeK, "q5_1");
    assert.strictEqual(a.kvTypeV, "q5_1");
    assert.strictEqual(a.gpuLayers, 12);
    assert.strictEqual(a.cpuMoeLayers, 4);
    assert.strictEqual(b.contextSize, 4096);
    assert.strictEqual(b.kvTypeK, "f16");
    assert.strictEqual(b.kvTypeV, "f16");
    assert.strictEqual(b.gpuLayers, 0);
    assert.strictEqual(b.mainGpu, 1);
    // The status scalar describes the selected entry.
    assert.strictEqual(cfg.kvType, "f16");
    assert.strictEqual(cfg.tunedTarget.id, "b.gguf");
    // Each model's own server arguments carry the profile: the retired INI split into sections,
    // the per-model argv does the same per child. The cache-type flags are read from the split
    // entry keys by ModelArgs in a later task; StartConfig's own contract is the keys above.
    const argsA = ModelArgs.buildModelArgs(a, { host: "127.0.0.1", port: 8730 });
    const argsB = ModelArgs.buildModelArgs(b, { host: "127.0.0.1", port: 8731 });
    assert.strictEqual(argsA[argsA.indexOf("-c") + 1], "8192");
    assert.strictEqual(argsA[argsA.indexOf("-ngl") + 1], "12");
    assert.strictEqual(argsA[argsA.indexOf("--n-cpu-moe") + 1], "4");
    assert.strictEqual(argsB[argsB.indexOf("-c") + 1], "4096");
    assert.strictEqual(argsB[argsB.indexOf("-ngl") + 1], "0");
    assert.strictEqual(argsB[argsB.indexOf("--main-gpu") + 1], "1");
});

test("a profile's resolved defaults own the runtime keys; a below-minimum context is ignored", () => {
    const entries = [entry("a.gguf", { contextSize: 16384, gpuLayers: 3 })];
    const cfg = build({ entries: entries, profiles: { "a.gguf": { kvType: "q4_0" } } });
    // resolveProfile fills every key, so a stored profile's absent keys use the shipped defaults.
    assert.strictEqual(cfg.tunedTarget.contextSize, 32768);
    assert.strictEqual(cfg.tunedTarget.gpuLayers, "auto");
    assert.strictEqual(cfg.tunedTarget.kvTypeK, "q4_0");
    assert.strictEqual(cfg.tunedTarget.kvTypeV, "q4_0");
    // A below-minimum context length is ignored, leaving the entry's detected value in place.
    const low = build({ entries: entries, profiles: { "a.gguf": { contextLength: 100 } } });
    assert.strictEqual(low.tunedTarget.contextSize, 16384);
});

test("profiles' specMode off drops every speculation key", () => {
    const entries = [entry("a.gguf", {
        draftPath: "/models/d.gguf", specType: "draft-dflash", specDraftNMax: 8, specDraftNMin: 1
    })];
    const cfg = build({ entries: entries, profiles: { "a.gguf": { specMode: "off" } } });
    const a = cfg.tunedTarget;
    assert.strictEqual("specType" in a, false);
    assert.strictEqual("draftPath" in a, false);
    assert.strictEqual("specDraftNMax" in a, false);
    assert.strictEqual("specDraftNMin" in a, false);
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args.indexOf("--spec-type"), -1);
    assert.strictEqual(args.indexOf("--model-draft"), -1);
});

test("a profile's MoE GPU cache and draft ubatch reach argv; the draft one needs a draft", () => {
    // With a draft paired, both profile knobs ride the entry into argv. The target is a MoE
    // model (expertCount from GGUF detection): the cache flag is refused outright on a dense
    // model upstream, so it only ever rides an expert-carrying entry.
    const entries = [entry("a.gguf", { expertCount: 128, draftPath: "/models/d.gguf", specType: "draft-dflash" })];
    const cfg = build({
        entries: entries,
        profiles: { "a.gguf": { moeCacheMib: 2048, draftUbatchSize: 256 } }
    });
    let args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args[args.indexOf("--moe-cache-mib") + 1], "2048");
    assert.strictEqual(args[args.indexOf("--spec-draft-n-ubatch") + 1], "256");

    // Without a draft the draft's batch flag is dropped from the entry entirely (it only tunes
    // the draft context), while the MoE cache stays: it is a placement knob, not a spec one.
    const plain = build({
        entries: [entry("a.gguf", { expertCount: 128 })],
        profiles: { "a.gguf": { moeCacheMib: 2048, draftUbatchSize: 256 } }
    });
    assert.strictEqual("draftUbatchSize" in plain.tunedTarget, false);
    args = ModelArgs.buildModelArgs(plain.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args.indexOf("--spec-draft-n-ubatch"), -1);
    assert.strictEqual(args[args.indexOf("--moe-cache-mib") + 1], "2048");

    // A dense model ignores a stored cache value entirely - the key never reaches the entry, so
    // the start cannot be refused upstream ("MoE cache requires a MoE model").
    const dense = build({
        entries: [entry("a.gguf")],
        profiles: { "a.gguf": { moeCacheMib: 2048 } }
    });
    assert.strictEqual("moeCacheMib" in dense.tunedTarget, false);
    args = ModelArgs.buildModelArgs(dense.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args.indexOf("--moe-cache-mib"), -1);

    // Empty/zero/non-positive values never reach the child: upstream's own defaults stand.
    const untouched = build({ entries: [entry("a.gguf", { expertCount: 128 })], profiles: { "a.gguf": { moeCacheMib: "", draftUbatchSize: 0 } } });
    args = ModelArgs.buildModelArgs(untouched.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args.indexOf("--moe-cache-mib"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-n-ubatch"), -1);
});

test("a forced draftId emits that draft with its detected spec type and the profile bounds", () => {
    const entries = [entry("a.gguf"), entry("b.gguf")];
    const associations = {
        byTarget: {
            "a.gguf": { draft: { id: "chosen.gguf", specType: "draft-dspark" }, mmproj: null },
            "b.gguf": { draft: null, mmproj: null }
        },
        drafts: [{ id: "chosen.gguf", specType: "draft-dspark" }],
        projectors: []
    };
    const cfg = build({
        entries: entries, modelsDir: "/models", associations: associations,
        profiles: { "a.gguf": { draftId: "chosen.gguf", draftMax: 5, draftMin: 2 } }
    });
    const a = cfg.tunedTarget;
    assert.strictEqual(a.draftPath, path.join("/models", "chosen.gguf"));
    assert.strictEqual(a.specType, "draft-dspark");
    assert.strictEqual(a.specDraftNMax, 5);
    assert.strictEqual(a.specDraftNMin, 2);
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args[args.indexOf("--spec-type") + 1], "draft-dspark");
    assert.strictEqual(args[args.indexOf("--model-draft") + 1], path.join("/models", "chosen.gguf"));
    assert.strictEqual(args[args.indexOf("--spec-draft-n-max") + 1], "5");
    assert.strictEqual(args[args.indexOf("--spec-draft-n-min") + 1], "2");
});

test("an embedded MTP head keeps spec-type with no model-draft even with profiles", () => {
    const entries = [entry("a.gguf", { specType: "draft-mtp", mtpCapable: true })];
    const cfg = build({ entries: entries, profiles: { "a.gguf": {} } });
    assert.strictEqual(cfg.tunedTarget.specType, "draft-mtp");
    assert.strictEqual("draftPath" in cfg.tunedTarget, false);
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args[args.indexOf("--spec-type") + 1], "draft-mtp");
    assert.strictEqual(args.indexOf("--model-draft"), -1);
});

test("a profile's draft bounds and p-min reach an embedded MTP head; the draft KV type does not", () => {
    // The MTP drafting loop reads n-max/n-min/p-min itself, so those profile fields apply to a
    // self-drafting model. The draft KV type needs a real draft file (an embedded head's
    // context derives from the target's), so it still does not reach one.
    const entries = [entry("a.gguf", { specType: "draft-mtp", mtpCapable: true, specDraftNMax: 2 })];
    const cfg = build({
        entries: entries, modelsDir: "/models",
        profiles: { "a.gguf": { draftMax: 4, draftMin: 1, specDraftPMin: 0.05, draftKvType: "q8_0" } }
    });
    const t = cfg.tunedTarget;
    assert.strictEqual(t.specType, "draft-mtp");
    assert.strictEqual("draftPath" in t, false);
    assert.strictEqual(t.specDraftNMax, 4);
    assert.strictEqual(t.specDraftNMin, 1);
    assert.strictEqual(t.specDraftPMin, 0.05);
    assert.strictEqual("draftKvType" in t, false);
    const args = ModelArgs.buildModelArgs(t, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args[args.indexOf("--spec-draft-n-max") + 1], "4");
    assert.strictEqual(args[args.indexOf("--spec-draft-n-min") + 1], "1");
    assert.strictEqual(args[args.indexOf("--spec-draft-p-min") + 1], "0.05");
    assert.strictEqual(args.indexOf("--model-draft"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-type-k"), -1);
});

test("specMode off still strips every speculation key from an embedded-head model", () => {
    const entries = [entry("a.gguf", { specType: "draft-mtp", mtpCapable: true, specDraftNMax: 2 })];
    const cfg = build({
        entries: entries, modelsDir: "/models", profiles: { "a.gguf": { specMode: "off", draftMax: 4 } }
    });
    const t = cfg.tunedTarget;
    assert.strictEqual("specType" in t, false);
    assert.strictEqual("mtpCapable" in t, false);
    assert.strictEqual("specDraftNMax" in t, false);
    assert.strictEqual("specDraftPMin" in t, false);
    const args = ModelArgs.buildModelArgs(t, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args.indexOf("--spec-type"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-n-max"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-p-min"), -1);
});

test("mmprojMode off drops the detected projector and mmprojId forces one", () => {
    const entries = [entry("a.gguf", { mmprojPath: "/models/detected.mmproj" })];
    const off = build({
        entries: entries, modelsDir: "/models", profiles: { "a.gguf": { mmprojMode: "off" } }
    });
    assert.strictEqual("mmprojPath" in off.tunedTarget, false);
    const forced = build({
        entries: entries, modelsDir: "/models", profiles: { "a.gguf": { mmprojId: "chosen.mmproj" } }
    });
    assert.strictEqual(forced.tunedTarget.mmprojPath, path.join("/models", "chosen.mmproj"));
    // The default "auto" keeps whatever detection found.
    const kept = build({ entries: entries, modelsDir: "/models", profiles: { "a.gguf": {} } });
    assert.strictEqual(kept.tunedTarget.mmprojPath, "/models/detected.mmproj");
});

test("a profile's expert count is applied per entry, keyed by that entry's architecture", () => {
    const entries = [
        entry("a.gguf", { arch: "qwen35moe", expertCount: 256, modelPath: "/m/a.gguf" }),
        entry("b.gguf", { arch: "gemma4", expertCount: 128, modelPath: "/m/b.gguf" })
    ];
    const cfg = build({ entries: entries, profiles: { "a.gguf": { expertCount: 4 }, "b.gguf": { expertCount: 8 } } });
    const a = cfg.tunedModels.find(function (m) { return m.id === "a.gguf"; });
    const b = cfg.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    assert.deepStrictEqual(a.overrideKv, { "qwen35moe.expert_used_count": "int:4" });
    assert.deepStrictEqual(b.overrideKv, { "gemma4.expert_used_count": "int:8" });
    assert.deepStrictEqual(cfg.overrideKv, { "qwen35moe.expert_used_count": "int:4" });
    assert.deepStrictEqual(cfg.expertInfo, { count: 4, available: 256, arch: "qwen35moe" });
});

test("a bad profile expert count throws only for the selected model", () => {
    const entries = [
        entry("a.gguf", { arch: "qwen35", expertCount: null, modelPath: "/m/a.gguf" }),
        entry("b.gguf", { arch: "gemma4", expertCount: 128, modelPath: "/m/b.gguf" })
    ];
    const profiles = { "a.gguf": { expertCount: 3 }, "b.gguf": { expertCount: 3 } };
    // The selected model's bad value must reject the start with the historical message.
    assert.throws(
        () => build({ entries: entries, opts: { modelId: "a.gguf" }, profiles: profiles }),
        /not a Mixture-of-Experts model/
    );
    // The same map with a valid model selected leaves the bad non-target override off.
    const ok = build({ entries: entries, opts: { modelId: "b.gguf" }, profiles: profiles });
    const a = ok.tunedModels.find(function (m) { return m.id === "a.gguf"; });
    assert.strictEqual(a.overrideKv, undefined);
    const b = ok.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    assert.deepStrictEqual(b.overrideKv, { "gemma4.expert_used_count": "int:3" });
});

test("no profiles map keeps the legacy single-model behaviour byte-for-byte", () => {
    const entries = [
        entry("a.gguf", { draftPath: "/models/d.gguf", specType: "draft-dflash", specDraftNMax: 16 }),
        entry("b.gguf")
    ];
    const opts = { modelId: "a.gguf", contextLength: 1024, draftMax: 10, draftMin: 2, gpuLayers: 7 };
    const withKey = build({ entries: entries, opts: opts, profiles: undefined, associations: null });
    const withoutKey = build({ entries: entries, opts: opts });
    assert.deepStrictEqual(withKey, withoutKey);
    // Every entry keeps the legacy cache type, and the non-target keeps the registry values.
    const b = withKey.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    assert.strictEqual(b.contextSize, 32768);
    assert.strictEqual(b.gpuLayers, "auto");
});

// RuntimeInfo reads these facts for /v1/models meta and the /props fallback, so whatever path
// StartConfig takes (profiles or the legacy single-model tuning) they must survive onto the
// effective entries the manager serves.
test("the GGUF fact fields survive both profile and legacy tuning", () => {
    const facts = { contextLengthTrain: 131072, bytes: 2674565120, hasVision: true, ftype: "7", arch: "qwen35" };
    const entries = [entry("a.gguf", facts)];
    for (const built of [
        build({ entries: entries, profiles: { "a.gguf": { contextLength: 4096 } } }),
        build({ entries: entries, opts: { modelId: "a.gguf", contextLength: 4096 } })
    ]) {
        const a = built.tunedTarget;
        assert.strictEqual(a.contextSize, 4096);
        assert.strictEqual(a.contextLengthTrain, 131072);
        assert.strictEqual(a.bytes, 2674565120);
        assert.strictEqual(a.hasVision, true);
        assert.strictEqual(a.ftype, "7");
        assert.strictEqual(a.arch, "qwen35");
    }
    // An untouched non-target still carries its own facts.
    const multi = build({ entries: [entry("a.gguf"), entry("b.gguf", facts)], opts: { modelId: "a.gguf" } });
    const b = multi.tunedModels.find(function (m) { return m.id === "b.gguf"; });
    assert.strictEqual(b.contextLengthTrain, 131072);
    assert.strictEqual(b.ftype, "7");
});

test("a profile's split KV types and batch sizes reach the entry", () => {
    const cfg = build({
        entries: [entry("a.gguf", { draftPath: "/models/d.gguf" })],
        profiles: { "a.gguf": { kvTypeK: "f16", kvTypeV: "q8_0", batchSize: 1024, ubatchSize: 256,
            specDraftPMin: 0.25, draftKvType: "f16" } },
        associations: { byTarget: {}, drafts: [] }
    });
    const e = cfg.tunedTarget;
    assert.strictEqual(e.kvTypeK, "f16");
    assert.strictEqual(e.kvTypeV, "q8_0");
    assert.strictEqual(e.batchSize, 1024);
    assert.strictEqual(e.ubatchSize, 256);
    assert.strictEqual(e.specDraftPMin, 0.25);
    assert.strictEqual(e.draftKvType, "f16");
    assert.strictEqual(e.kvType, undefined);
});

test("an unknown KV type in a profile falls back to the default on the entry", () => {
    const cfg = build({
        entries: [entry("a.gguf")],
        profiles: { "a.gguf": { kvTypeK: "nope", kvTypeV: "nope" } }
    });
    assert.strictEqual(cfg.tunedTarget.kvTypeK, "q8_0");
    assert.strictEqual(cfg.tunedTarget.kvTypeV, "q8_0");
});

// Important 2 of the whole-feature review: the ubatch <= effective batch guard lived only in
// ModelProfiles.validate, which at the time had no production caller, so batchSize="" +
// ubatchSize=4096 reached the child as --ubatch-size 4096. The Start handler now calls the
// validator (DSLREngine.js), and this live path still clamps it for the non-interactive paths
// (console replay, auto-start), which nobody watches. Keep the guard.
test("a profile's ubatchSize is clamped to the effective batch so argv can never exceed it", () => {
    // No logical batch size set: the effective batch is the runtime's own default (2048), so an
    // oversized physical batch is clamped to that rather than reaching the child as 4096.
    const unset = build({
        entries: [entry("a.gguf", { draftPath: "/models/d.gguf" })],
        profiles: { "a.gguf": { batchSize: "", ubatchSize: 4096 } }
    });
    assert.strictEqual(unset.tunedTarget.ubatchSize, 2048);
    let args = ModelArgs.buildModelArgs(unset.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args[args.indexOf("--ubatch-size") + 1], "2048");
    assert.strictEqual(args.indexOf("--batch-size"), -1);
    // An explicit logical batch size lowers the bound: the physical size may not exceed it.
    const explicit = build({
        entries: [entry("a.gguf", { draftPath: "/models/d.gguf" })],
        profiles: { "a.gguf": { batchSize: 1024, ubatchSize: 4096 } }
    });
    assert.strictEqual(explicit.tunedTarget.ubatchSize, 1024);
    args = ModelArgs.buildModelArgs(explicit.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args[args.indexOf("--batch-size") + 1], "1024");
    assert.strictEqual(args[args.indexOf("--ubatch-size") + 1], "1024");
    // A physical size already at or below the effective batch is left alone.
    const ok = build({
        entries: [entry("a.gguf", { draftPath: "/models/d.gguf" })],
        profiles: { "a.gguf": { batchSize: 4096, ubatchSize: 256 } }
    });
    assert.strictEqual(ok.tunedTarget.ubatchSize, 256);
});

// Minor 3 / spec 3.3: "off" drops every speculation key, and a draft KV type or p-min with no
// --model-draft is meaningless, so neither may survive onto an entry that has no draft.
test("draft-only profile keys are dropped under specMode off", () => {
    const entries = [entry("a.gguf", { draftPath: "/models/d.gguf", specType: "draft-dflash" })];
    const cfg = build({ entries, profiles: { "a.gguf": { specMode: "off", specDraftPMin: 0.25, draftKvType: "f16" } } });
    assert.strictEqual("specDraftPMin" in cfg.tunedTarget, false);
    assert.strictEqual("draftKvType" in cfg.tunedTarget, false);
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args.indexOf("--spec-draft-p-min"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-type-k"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-type-v"), -1);
});

test("draft-only profile keys are dropped when the entry has no draft model", () => {
    const cfg = build({ entries: [entry("a.gguf")], profiles: { "a.gguf": { specDraftPMin: 0.25, draftKvType: "f16" } } });
    assert.strictEqual("specDraftPMin" in cfg.tunedTarget, false);
    assert.strictEqual("draftKvType" in cfg.tunedTarget, false);
    const args = ModelArgs.buildModelArgs(cfg.tunedTarget, { host: "127.0.0.1", port: 8730 });
    assert.strictEqual(args.indexOf("--spec-draft-p-min"), -1);
    assert.strictEqual(args.indexOf("--spec-draft-type-k"), -1);
});
