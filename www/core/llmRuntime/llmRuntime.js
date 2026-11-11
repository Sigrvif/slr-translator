// www/core/llmRuntime/llmRuntime.js
"use strict";
var thisAddon = this;
var nwPath = require("path");
var fs = require("fs");

var addonDir = nwPath.resolve(thisAddon.fullPath);
function lib(name) { return require(nwPath.join(addonDir, "lib", name)); }

// Pinned deliberately. Updating the runtime means shipping a new runtime/<version>/ dir
// and bumping this constant, never editing the payload in place.
var RUNTIME_VERSION = "b12110";

// Matches RuntimeManager.DEFAULT_CONFIG.port. Kept here so a blank option restores the shipped
// default explicitly instead of leaving a previous start's port in place. The settings mapping
// itself (lib/StartConfig.js) reads RuntimeManager's DEFAULT_CONFIG directly; this constant is
// only the editor's explicit way to name the same value.
var DEFAULT_CONFIG_PORT = 1234;

// Nothing heavier than this runs while the addon script is being evaluated. The lib modules
// and the manager are built on first use (see ensureRuntime). Loading them eagerly made the
// whole module fail to load if anything in that chain threw, which left window.llmRuntime
// undefined and produced "Cannot read property 'status' of undefined" when a button was
// clicked. Deferring it keeps the module loadable and turns any failure into a readable
// error from the button that needs it.
var _rt = null;
var _loadError = null;
var _tried = false;

function rootDir() {
    try {
        if (typeof common !== "undefined" && common.getRootDir) return common.getRootDir();
    } catch (err) { /* fall through to the process working directory */ }
    try { return process.cwd(); } catch (err) { return "."; }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// The pinned llama-server exits 1 when --slot-save-path points at a directory that
// does not exist, so the data tree (including models and slots) is created before
// every start. Existing directories are left untouched.
function dataDir() {
    var dir = nwPath.join(rootDir(), "data", "llama");
    ensureDir(dir);
    ensureDir(nwPath.join(dir, "models"));
    ensureDir(nwPath.join(dir, "slots"));
    return dir;
}

// The install directory for the pinned payload. `localConfig.llama` lets a packager
// rename it; the default matches the shipped layout.
function runtimeDirName() {
    var config = (typeof nw !== "undefined" && nw.App && nw.App.manifest && nw.App.manifest.localConfig) || {};
    return config.llama || "runtime";
}

// Where the model actually ended up, from the loader's per-buffer report (see
// ServerProcess.applyModelBufferLine). The layer count it also prints is only layer assignment,
// so it is deliberately not used: a MoE model can show every layer on the GPU while its experts
// are in the CPU buffer.
function modelBuffers() {
    try {
        var rt = ensureRuntime();
        var server = rt.manager && rt.manager.server;
        var b = server && server.modelBuffers;
        // Sanity-checked against the card that was selected, so a buffer name this code did not
        // expect can never be reported as VRAM. The target and the draft are checked separately:
        // an implausible draft is dropped alone, leaving a valid target split in place.
        var vram = rt.manager.status && rt.manager.status.deviceMemoryMiB;
        return lib("ServerProcess.js").sanitiseBuffers(b, vram);
    } catch (err) { return null; }
}

// The engine's own fit decision, captured raw from the child log (see ServerProcess). Shown
// verbatim in the status: it is the reasoning behind the placement, not a value to re-parse.
function fitReport() {
    try {
        var rt = ensureRuntime();
        var server = rt.manager && rt.manager.server;
        return server && server.fitReport ? server.fitReport : null;
    } catch (err) { return null; }
}

function httpAdapter() {
    var request = require("postman-request");
    function call(method, url, body) {
        return new Promise(function (resolve, reject) {
            var options = { method: method, url: url, json: true, timeout: 30000 };
            if (body !== undefined) options.body = body;
            request(options, function (err, res, responseBody) {
                if (err) return reject(err);
                resolve({ status: res.statusCode, body: responseBody });
            });
        });
    }
    return {
        get: function (url) { return call("GET", url); },
        post: function (url, body) { return call("POST", url, body); }
    };
}

function listDevices(serverBinary, env) {
    // stdout carries the device list; stderr carries the backend loaders' own failures ("the
    // specified module could not be found" for a HIP DLL the SDK does not provide), which is
    // exactly what a "pack installed but no device found" report must show. aSpawn echoes
    // stderr to the console and the onError hook, so both channels are captured here and
    // handed back separately. `env` (when given) is the exact environment the spawned server
    // children get, so a backend whose libraries live in the extra library folder is visible
    // to the probe too; without it the child inherits this process's environment. The probe
    // never rejects: a spawn failure still resolves with whatever was printed, so the start
    // can go on to auto's CPU fallback or fail with the probe's own output in the error
    // instead of dying on the probe itself.
    return new Promise(function (resolve) {
        var stderr = "";
        var opts = {
            cwd: nwPath.dirname(serverBinary),
            onError: function (chunk) {
                // aSpawn also feeds spawn errors (binary missing, not executable) through
                // onError; their message is diagnostic, the object itself is not.
                if (chunk instanceof Error) { stderr += String((chunk && chunk.message) || chunk); return; }
                stderr += chunk;
            }
        };
        if (env) opts.env = env;
        common.aSpawn(serverBinary, ["--list-devices"], opts).then(function (stdout) {
            resolve({ stdout: String(stdout || ""), stderr: stderr });
        }, function () {
            resolve({ stdout: "", stderr: stderr });
        });
    });
}

function ensureRuntime() {
    if (_tried) {
        if (_loadError) throw new Error(_loadError);
        return _rt;
    }
    _tried = true;
    try {
        var Payload = lib("Payload.js");
        var ModelRegistry = lib("ModelRegistry.js");
        var Offload = lib("Offload.js");
        var GgufMeta = lib("GgufMeta.js");
        var Ports = lib("Ports.js");
        var StartConfig = lib("StartConfig.js");
        var RouterClient = lib("RouterClient.js");
        var ServerProcess = lib("ServerProcess.js").ServerProcess;
        var EngineBinding = lib("EngineBinding.js");
        var RuntimeManager = lib("RuntimeManager.js").RuntimeManager;
        var HipSdkLocator = lib("HipSdkLocator.js");

        var platformKey = Payload.platformDir(process.platform, process.arch);
        var modelsDir = nwPath.join(dataDir(), "models");
        var slotSavePath = nwPath.join(dataDir(), "slots");

        // llama-server prints "srv update_slots: all slots are idle" several times per second
        // while idle. The lines carry no new information, so they are dropped from the debug
        // log (an idle session used to accumulate thousands of entries). The raw text still
        // reaches the fit/offload parsers and the stderr tail used for error reports. Chunks
        // can split a line mid-way (a lone timestamp arriving ahead of its text), so a
        // trailing partial line is carried over and judged with its remainder next time.
        var _idleCarry = "";
        function dropIdleSpam(text) {
            var s = _idleCarry + String(text || "");
            _idleCarry = "";
            var complete = s;
            if (s.charAt(s.length - 1) !== "\n") {
                var cut = s.lastIndexOf("\n");
                if (cut === -1) { _idleCarry = s; return ""; }
                _idleCarry = s.slice(cut + 1);
                complete = s.slice(0, cut + 1);
            }
            var kept = complete.split("\n").filter(function (line) {
                return line.indexOf("update_slots: all slots are idle") === -1;
            });
            while (kept.length && kept[kept.length - 1] === "") kept.pop();
            return kept.join("\n");
        }

        var manager = new RuntimeManager({
            resolvePayload: function () {
                return Payload.resolvePayload({
                    rootDir: rootDir(),
                    version: RUNTIME_VERSION,
                    platform: process.platform,
                    arch: process.arch,
                    fs: fs,
                    dirName: runtimeDirName()
                });
            },
            verifyPayload: function (payload) {
                return Payload.verifyPayload({
                    dir: payload.dir,
                    manifest: payload.manifest,
                    platformKey: platformKey,
                    fs: fs,
                    crypto: require("crypto"),
                    onError: function (err) { sys.log && sys.log(err.message); }
                });
            },
            listDevices: listDevices,
            // The HIP SDK's bin folder in its standard install locations, best match first
            // (the generation matching the installed pack, then the newer version). The
            // manager probes it when a ROCm pack finds no device on Windows and adopts the
            // result for the probe and the server children.
            standardLibDirs: function (probeOpts) {
                return HipSdkLocator.standardBinDirs({
                    platform: process.platform,
                    env: process.env,
                    fs: fs,
                    packGeneration: probeOpts && probeOpts.packGeneration
                });
            },
            findFreePort: function (opts) { return Ports.resolvePort(opts); },
            writeFile: function (p, text) { fs.writeFileSync(p, text, "utf8"); },
            createServer: function (opts) {
                return new ServerProcess({
                    serverBinary: opts.serverBinary,
                    args: opts.args,
                    cwd: opts.cwd,
                    env: opts.env,
                    onLog: function (stream, text) {
                        // The manager captures each child's stderr tail through this hook so a
                        // failed load can report the loader's own message; logging stays as it
                        // was. A throwing hook must never break the child.
                        if (opts && typeof opts.onLog === "function") {
                            try { opts.onLog(stream, text); } catch (e) { /* logging is best effort */ }
                        }
                        if (typeof logger !== "undefined" && logger.debug) {
                            var logged = dropIdleSpam(text);
                            if (logged) logger.debug("[llama/" + stream + "] " + logged);
                        }
                    }
                });
            },
            createRouter: function (baseUrl) {
                return RouterClient.createRouterClient({ http: httpAdapter(), baseUrl: baseUrl });
            },
            // Used to tell whether a model can stay entirely on the GPU. A file that does not
            // fit has to compute some weights on the CPU, which is when the load mode matters.
            modelBytes: function (modelPath) {
                try { return fs.statSync(modelPath).size; } catch (err) { return null; }
            },
            waitForHealth: RouterClient.waitForHealth,
            onStatus: function (s) { window.llmRuntimeStatus = s; },
            // Diagnostics (backend/device detection, selection, start failures) go to the
            // console ALWAYS - success or failure - and to the log file when it is enabled.
            // They used to travel only through the file logger, so on an install without
            // log-to-file a silent backend downgrade left nothing to diagnose from anywhere.
            log: function (msg) {
                try { console.warn("[llmRuntime] " + msg); } catch (e) { /* console is best effort */ }
                if (typeof logger !== "undefined" && logger.warn) logger.warn("[llmRuntime] " + msg);
            },
            config: {
                platformKey: platformKey,
                modelsDir: modelsDir,
                slotSavePath: slotSavePath,
                cacheRamMiB: 4096,
                cacheReuseChunk: 256,
                ctxCheckpoints: 16
            }
        });

        _rt = {
            Payload: Payload,
            ModelRegistry: ModelRegistry,
            Offload: Offload,
            GgufMeta: GgufMeta,
            Ports: Ports,
            StartConfig: StartConfig,
            RouterClient: RouterClient,
            ServerProcess: ServerProcess,
            EngineBinding: EngineBinding,
            RuntimeManager: RuntimeManager,
            platformKey: platformKey,
            manager: manager
        };
    } catch (err) {
        _loadError = "Could not initialise the bundled local runtime from " + addonDir +
            ": " + ((err && err.message) || err);
        if (typeof logger !== "undefined" && logger.error) logger.error("[llmRuntime] " + _loadError);
        throw new Error(_loadError);
    }
    return _rt;
}

function dslrWrapper() {
    return window.slrDSLREngineWrapper || null;
}

function registryPath() {
    return nwPath.join(dataDir(), "drafts.json");
}

function selectedPath() {
    return nwPath.join(dataDir(), "selected.json");
}

function templatesDir() {
    var dir = nwPath.join(dataDir(), "templates");
    ensureDir(dir);
    return dir;
}

// A saved chat template is stored per model, named after the model file. The id is already a
// filename, but it can still contain characters a path must not, so it is sanitised.
function templateFileName(modelId) {
    var base = String(modelId || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.+$/, "");
    return (base || "model") + ".jinja";
}

function templatePath(modelId) {
    return nwPath.join(templatesDir(), templateFileName(modelId));
}

// --- Model scan cache ---------------------------------------------------------------------
// Every scan below reads each GGUF's metadata table, which over a folder of multi-GB files is
// seconds of work, and the engine's background ticker asks for the model list repeatedly. The
// models directory changes rarely, so a signature of its listing (names, sizes, mtime, ctime -
// never file bodies) is enough to reuse the previous result; the entries slot additionally keys
// on the drafts.json registry stat, because buildModelEntries folds that file in. See
// lib/ScanCache.js.
var _scanCache = null;

function scanCache() {
    if (!_scanCache) _scanCache = lib("ScanCache.js").createCache();
    return _scanCache;
}

function modelsDirectory() {
    return ensureRuntime().manager.config.modelsDir;
}

function scanSignature() {
    return lib("ScanCache.js").directorySignature({ dir: modelsDirectory(), fs: fs });
}

// The registry file (data/llama/drafts.json) is folded into the ENTRIES key only: the infos and
// associations slots are pure content detection and never read it. Before the cache existed the
// ticker picked up a live drafts.json edit within a few seconds, so the entries key must move
// with the file or a hand-edited pairing would go unnoticed until the models directory changed
// or the app restarted. Existence + size + mtime + ctime, from a stat - never a body read; an
// absent file is a stable, cacheable token.
function registrySignature() {
    try {
        var stat = fs.statSync(registryPath());
        return "present:" + stat.size + ":" + stat.mtimeMs + ":" + stat.ctimeMs;
    } catch (err) {
        return "absent";
    }
}

// The entries slot is keyed by BOTH the models directory and the registry file, so an edit to
// either invalidates it. If the directory listing is unreadable the whole key is null, which
// makes the slot bypass the cache exactly as the directory signature does.
function entriesSignature() {
    var dirSignature = scanSignature();
    if (dirSignature === null || dirSignature === undefined) return null;
    return dirSignature + "|registry:" + registrySignature();
}

function computeModelInfos(dir) {
    var ModelInfo = lib("ModelInfo.js");
    var names;
    try { names = fs.readdirSync(dir); } catch (err) { return []; }
    var out = [];
    for (var i = 0; i < names.length; i++) {
        if (!/\.gguf$/i.test(names[i])) continue;
        var info = ModelInfo.readModelFile({ filePath: nwPath.join(dir, names[i]), fs: fs });
        if (info) out.push(info);
    }
    return out;
}

function modelInfosFor(signature) {
    return scanCache().read("infos", signature, function () {
        return computeModelInfos(modelsDirectory());
    });
}

// Serve buildModelEntries' readInfo seam from the cached ModelInfo list, so a targetModels()
// call on an unchanged folder never re-reads a body. A file the cached scan did not see (added
// between the signature and this read) falls back to a real read, exactly as before the cache.
function cachedInfoFor(filePath) {
    var base = nwPath.basename(filePath);
    var infos = modelInfosFor(scanSignature());
    for (var i = 0; i < infos.length; i++) {
        if (infos[i].id === base) return infos[i];
    }
    return lib("ModelInfo.js").readModelFile({ filePath: filePath, fs: fs });
}

// The router lists every GGUF file by name, including drafts, so we must not bind
// its models[0]. targetModels() is the list of files that are valid standalone
// targets (draft-only files are excluded by ModelRegistry). The expensive content scan is
// cached by the models-directory signature; only a changed folder recomputes it.
function targetModels() {
    var rt = ensureRuntime();
    var signature = entriesSignature();
    return scanCache().read("entries", signature, function () {
        return rt.ModelRegistry.buildModelEntries({
            modelsDir: rt.manager.config.modelsDir,
            registryPath: registryPath(),
            fs: fs,
            onError: function (err) {
                if (typeof logger !== "undefined" && logger.warn) logger.warn("[llama] " + err.message);
            },
            readInfo: cachedInfoFor
        });
    });
}

function discoverModels() {
    return targetModels();
}

function readSelectedModelId() {
    try {
        var p = selectedPath();
        if (!fs.existsSync(p)) return null;
        var parsed = JSON.parse(fs.readFileSync(p, "utf8"));
        if (parsed && typeof parsed.id === "string") return parsed.id;
    } catch (err) { /* missing/invalid selection falls through to the default */ }
    return null;
}

function selectedModel() {
    var rt = ensureRuntime();
    return rt.ModelRegistry.selectTargetModel({
        entries: targetModels(),
        preferredId: readSelectedModelId()
    });
}

function setSelectedModel(id) {
    dataDir();
    fs.writeFileSync(selectedPath(), JSON.stringify({ id: id || "" }), "utf8");
}

// Raw Prometheus exposition from the runtime's /metrics endpoint. Resolves to null when the
// runtime is not running, when metrics are unavailable, or on any error. It never rejects
// and never throws. The router can briefly reset the connection for /metrics?model= right
// after a completion, so a failed request is retried once before giving up.
function fetchMetricsText(modelId) {
    try {
        var rt = ensureRuntime();
        var client = rt.manager.client;
        if (!client || typeof client.metrics !== "function") return Promise.resolve(null);
        function once(id) {
            return client.metrics(id).then(function (res) {
                if (res && res.status === 400 && !id) {
                    // A multi-model router needs a model name; retry with the bound/selected id.
                    var retryId = null;
                    try { retryId = selectedModel(); } catch (e) { retryId = null; }
                    if (retryId) return once(retryId);
                }
                var text = res && res.body;
                if (text && typeof text === "object") text = JSON.stringify(text);
                return text === undefined || text === null ? "" : String(text);
            });
        }
        var id = modelId || readSelectedModelId() || null;
        function attempt(remaining) {
            return once(id).catch(function () {
                if (remaining <= 0) return null;
                return new Promise(function (resolve) { setTimeout(resolve, 250); })
                    .then(function () { return attempt(remaining - 1); });
            });
        }
        return Promise.resolve(attempt(1));
    } catch (err) {
        return Promise.resolve(null);
    }
}

// Live speculative-decoding metrics for a model. Resolves to null when unavailable.
function metrics(modelId) {
    return fetchMetricsText(modelId).then(function (text) {
        if (text === null) return null;
        return ensureRuntime().RouterClient.parseSpecMetrics(text);
    });
}

// Throughput (tokens/sec) and prompt-cache reuse for a model. Resolves to null when the
// exposition carries no runtime counters.
function runtimeMetrics(modelId) {
    return fetchMetricsText(modelId).then(function (text) {
        if (text === null) return null;
        return ensureRuntime().RouterClient.parseRuntimeMetrics(text);
    });
}

// The targetModels() entry the runtime is bound to (the remembered selection, or the
// default pick). Returns null when there are no models.
function currentTargetEntry() {
    var rt = ensureRuntime();
    var entries = targetModels();
    var boundId = readSelectedModelId();
    var chosen = rt.ModelRegistry.selectTargetModel({ entries: entries, preferredId: boundId });
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === (boundId || chosen)) return entries[i];
    }
    return null;
}

// Architecture and expert counts for a model file, read from its GGUF metadata. Returns null
// when the file cannot be read. The architecture is what keys the expert-count override, and
// the counts tell the UI what the model actually offers.
function modelMeta(modelId) {
    var rt = ensureRuntime();
    var entries = targetModels();
    var chosen = rt.ModelRegistry.selectTargetModel({
        entries: entries, preferredId: modelId || readSelectedModelId()
    });
    var entry = null;
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === chosen) { entry = entries[i]; break; }
    }
    if (!entry || !entry.modelPath) return null;
    return rt.GgufMeta.readModelInfo({ filePath: entry.modelPath, fs: fs });
}

// Every GGUF in the models directory as a classified ModelInfo (kind: model / draft /
// mtp-head / projector), WITHOUT the target/draft pairing or the per-model registry overlay
// buildModelEntries applies. This is content detection only, which is what the per-model
// settings UI needs to show what a folder actually holds. Never throws: an unreadable folder
// or file is simply skipped.
function modelInfos() {
    return modelInfosFor(scanSignature());
}

// The content-based draft/projector associations for the models directory. This is the
// detection the per-model settings are keyed against; it does not read drafts.json (that
// explicit registry is a separate override, exposed by readDrafts).
function associations() {
    var ModelAssociations = lib("ModelAssociations.js");
    var signature = scanSignature();
    return scanCache().read("associations", signature, function () {
        return ModelAssociations.associate(modelInfosFor(signature));
    });
}

// The draft/MTP FILE candidates eligible for one target, scored with the same content scorers
// ModelAssociations.associate uses to auto-pick. Returns [{ id, specType, score, kind,
// embeddedHead }] sorted by score desc then id; non-eligible files are excluded. Automatic
// pairing still refuses an external head for an mtpCapable target (associate never opts in);
// this manual list relaxes that veto, and embeddedHead marks exactly the entries admitted that
// way so the UI can explain the trade. The UI's explicit draft choice must be a file name:
// StartConfig joins modelsDir + profile.draftId and looks the id up in associations.drafts. The
// detector's candidate list is TARGET ids (ModelAssociations.pick returns target ids), so it
// must never be used as an explicit draft id. Never throws.
function candidateDraftsFor(modelId) {
    var list = [];
    if (!modelId) return list;
    var ModelAssociations = lib("ModelAssociations.js");
    var infos = modelInfos();
    var target = null;
    for (var i = 0; i < infos.length; i++) {
        if (infos[i] && infos[i].id === modelId) { target = infos[i]; break; }
    }
    if (!target || target.kind !== "model") return list;
    for (var d = 0; d < infos.length; d++) {
        var item = infos[d];
        if (!item) continue;
        var score = null;
        var embeddedHead = false;
        if (item.kind === "draft") {
            score = ModelAssociations.scoreDraftTarget(item, target);
        } else if (item.kind === "mtp-head") {
            // The manual picker offers an external head even when the target has its own; the
            // UI explains the trade. Automatic pairing still refuses it.
            score = ModelAssociations.scoreMtpTarget(item, target, { allowEmbeddedHead: true });
            embeddedHead = score !== null && target.mtpCapable === true;
        }
        if (score === null) continue;
        list.push({ id: item.id, specType: item.specType, score: score, kind: item.kind, embeddedHead: embeddedHead });
    }
    list.sort(function (a, b) { return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return list;
}

// The projector FILE candidates eligible for one target, scored the same way. specType is always
// null (a vision projector has no speculative kind). Never throws.
function candidateProjectorsFor(modelId) {
    var list = [];
    if (!modelId) return list;
    var ModelAssociations = lib("ModelAssociations.js");
    var infos = modelInfos();
    var target = null;
    var modelCount = 0;
    for (var i = 0; i < infos.length; i++) {
        if (!infos[i]) continue;
        if (infos[i].kind === "model") modelCount++;
        if (infos[i].id === modelId) target = infos[i];
    }
    if (!target || target.kind !== "model") return list;
    for (var p = 0; p < infos.length; p++) {
        var item = infos[p];
        if (!item || item.kind !== "projector") continue;
        var score = ModelAssociations.scoreProjectorTarget(item, target, modelCount);
        if (score === null) continue;
        list.push({ id: item.id, specType: null, score: score });
    }
    list.sort(function (a, b) { return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return list;
}

// The raw data/llama/drafts.json content as an object, or {} when the file is absent,
// unreadable, corrupt or not an object. Never throws: a broken registry must not stop a start.
function readDrafts() {
    try {
        var p = registryPath();
        if (!fs.existsSync(p)) return {};
        var parsed = JSON.parse(fs.readFileSync(p, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return parsed;
    } catch (err) { return {}; }
}

// Which model a template operation applies to: the one asked for, else the remembered
// selection, else the same default a start would bind (a paired model first, otherwise the
// first file). Returns null only when there are no models at all.
function templateModelId(explicit) {
    if (explicit) return explicit;
    var id = readSelectedModelId();
    if (id) return id;
    try { return selectedModel(); } catch (err) { return null; }
}

// The chat template the runtime will actually use for a model: a saved override when one
// exists, otherwise the model's own template as the running server reports it. `/props` only
// answers while the model is loaded, so when the runtime is not running and no override is
// saved the result says "unavailable" rather than inventing a template.
function readTemplate(modelId) {
    var rt = ensureRuntime();
    var id = templateModelId(modelId);
    var saved = null;
    if (id) {
        try {
            var p = templatePath(id);
            if (fs.existsSync(p)) saved = fs.readFileSync(p, "utf8");
        } catch (err) { saved = null; }
    }
    if (saved !== null) {
        return Promise.resolve({ modelId: id, source: "custom", text: saved, path: templatePath(id) });
    }
    var client = rt.manager.client;
    if (!client || !id) {
        return Promise.resolve({ modelId: id, source: "unavailable", text: "", path: null });
    }
    return client.props(id).then(function (props) {
        var text = props && props.chat_template;
        return { modelId: id, source: text ? "model" : "none", text: text || "", path: null };
    }).catch(function () {
        return { modelId: id, source: "unavailable", text: "", path: null };
    });
}

// Save an override for a model. It takes effect the next time the runtime starts, because the
// template is handed to llama-server when it launches.
function saveTemplate(modelId, text) {
    var id = templateModelId(modelId);
    if (!id) throw new Error("Select a local model first.");
    if (typeof text !== "string" || text.trim() === "") throw new Error("The template is empty.");
    dataDir();
    var p = templatePath(id);
    fs.writeFileSync(p, text, "utf8");
    return p;
}

// Drop the override so the model's own template is used again.
function clearTemplate(modelId) {
    var id = templateModelId(modelId);
    if (!id) return false;
    try {
        var p = templatePath(id);
        if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
    } catch (err) { /* nothing to remove */ }
    return false;
}

function hasCustomTemplate(modelId) {
    var id = templateModelId(modelId);
    if (!id) return false;
    try { return fs.existsSync(templatePath(id)); } catch (err) { return false; }
}

// Full, human-readable runtime status (state + model + speculative decoding + measured
// draft acceptance). Resolves to a multi-line string.
function describeStatus() {
    var rt = ensureRuntime();
    var state = rt.manager.status;
    var entry = null;
    try { entry = currentTargetEntry(); } catch (e) { entry = null; }
    // The registry always holds the per-model defaults from drafts.json. When the running
    // server was started with the UI's runtime tuning, overlay those applied values so the
    // status line reflects what the server actually uses.
    var kvType = null;
    var kv = null;
    var expert = null;
    var template = null;
    var libDir = null;
    if (entry && _rt.lastStart && _rt.lastStart.modelId === entry.id) {
        kvType = _rt.lastStart.kvType || null;
        expert = _rt.lastStart.expert || null;
        template = _rt.lastStart.template || null;
        libDir = _rt.lastStart.libDir || null;
        entry = Object.assign({}, entry, _rt.lastStart.offload || {}, {
            contextSize: _rt.lastStart.contextSize != null ? _rt.lastStart.contextSize : entry.contextSize,
            specDraftNMax: _rt.lastStart.specDraftNMax,
            specDraftNMin: _rt.lastStart.specDraftNMin,
            // The applied draft/projector: a forced draftId replaces the registry's detected
            // pairing, and an explicit Off clears it (specOff drives the wording).
            draftPath: _rt.lastStart.draftPath,
            specType: _rt.lastStart.specType,
            mmprojPath: _rt.lastStart.mmprojPath,
            specOff: _rt.lastStart.specOff
        });
        kv = { type: kvType, unified: _rt.lastStart.kvUnified, offload: _rt.lastStart.kvOffload };
    }
    var modelId = (entry && entry.id) || state.modelId || readSelectedModelId() || null;
    // Which model the pool actually has loaded: the status line names it, and it is the one
    // /slots?model= must target through the front door (a status read never loads a model).
    var loadedId = loadedIdFor(modelId, state.loadedModels);
    var buffers = modelBuffers();
    var fit = fitReport();
    var slotsP = (loadedId && rt.manager.client && typeof rt.manager.client.slots === "function")
        ? rt.manager.client.slots(loadedId).catch(function () { return null; })
        : Promise.resolve(null);
    return Promise.all([fetchMetricsText(modelId), progress(modelId), slotsP]).then(function (both) {
        var text = both[0];
        var prog = both[1];
        var R = ensureRuntime().RouterClient;
        var spec = text === null ? null : R.parseSpecMetrics(text);
        var perf = text === null ? null : R.parseRuntimeMetrics(text);
        return lib("RuntimeStatus.js").describe({
            state: state, entry: entry, metrics: spec, runtime: perf,
            kvType: kvType, kv: kv, progress: prog, expert: expert,
            buffers: buffers,
            fit: fit,
            template: template, libDir: libDir,
            server: serverSettings(),
            // The loaded model's own /slots body, read through the front door: its n_ctx and
            // is_processing are what the status line shows.
            loadedId: loadedId, slots: both[2]
        });
    });
}

// The loaded model to report and to read /slots from. The bound/selected model is preferred when
// it is loaded; otherwise the most recently loaded one is used. Returns null when nothing is
// loaded, so a status read targets no instance (and the front door answers 503 rather than
// starting one).
function loadedIdFor(boundId, loadedIds) {
    var list = Array.isArray(loadedIds) ? loadedIds : [];
    if (!list.length) return null;
    if (boundId && list.indexOf(boundId) !== -1) return boundId;
    return list[list.length - 1];
}

// Live progress for the bound model: its load state from the front door's /v1/models ("unloaded",
// "loading", "loaded") and prompt-processing progress from the slots. Resolves to null when
// the runtime is not running. Never rejects.
// The phase (prompt vs generating) is what the elapsed timer keys off, so it is tracked here
// and reset whenever the activity stops. The slot data itself now carries real prompt
// progress, which RuntimeStatus renders as a percentage.
var _phase = { kind: null, since: 0 };

function withPhaseElapsed(activity) {
    if (!activity) {
        _phase = { kind: null, since: 0 };
        return null;
    }
    if (_phase.kind !== activity.phase) _phase = { kind: activity.phase, since: Date.now() };
    activity.elapsedMs = Date.now() - _phase.since;
    return activity;
}

// The front door's /v1/models carries each model's load state (status.value). Parse it into the
// same {id, status} shape selectModelStatus already matches against, so the existing stem/exact
// matching keeps working.
function parseFrontModelStatuses(body) {
    var data = body && body.data;
    var out = [];
    if (!Array.isArray(data)) return out;
    for (var i = 0; i < data.length; i++) {
        var entry = data[i];
        if (!entry || typeof entry.id !== "string") continue;
        out.push({ id: entry.id, status: (entry.status && entry.status.value) || "unknown" });
    }
    return out;
}

// GET /v1/models from the front door. Resolves to null when the runtime is not running or the
// request fails; never rejects.
function fetchModelsList() {
    try {
        var rt = ensureRuntime();
        var base = rt.manager.status && rt.manager.status.baseUrl;
        if (!base) return Promise.resolve(null);
        return httpAdapter().get(base + "/v1/models").then(function (res) {
            return res && res.body;
        }).catch(function () { return null; });
    } catch (err) {
        return Promise.resolve(null);
    }
}

function progress(modelId) {
    try {
        var rt = ensureRuntime();
        var client = rt.manager.client;
        if (!client) return Promise.resolve(null);
        var state = rt.manager.status;
        var id = modelId || loadedIdFor(null, state.loadedModels) || readSelectedModelId() || null;
        // The old router's /models endpoint does not exist on the front door; its own /v1/models
        // is the source of a model's load state now. While a start is in flight the model is not
        // in that list yet, which is exactly what the pool's busy() reports as "loading".
        var statuses = fetchModelsList().then(function (body) {
            var R = ensureRuntime().RouterClient;
            var mine = R.selectModelStatus(parseFrontModelStatuses(body), id);
            var status = mine ? mine.status : null;
            if (status !== "loaded" && rt.manager.pool && rt.manager.pool.busy()) status = "loading";
            return status;
        });
        var slots = id ? client.slots(id).catch(function () { return null; }) : Promise.resolve(null);
        return Promise.all([statuses, slots]).then(function (res) {
            var R = ensureRuntime().RouterClient;
            return {
                model: res[0],
                activity: withPhaseElapsed(R.parseSlotActivity(res[1]))
            };
        });
    } catch (err) {
        return Promise.resolve(null);
    }
}

// The offload fields a start actually applied, taken from the tuned entry. Only the ones
// with a value are copied, so describeStatus can overlay exactly what the server was told.
function offloadOfEntry(entry) {
    if (!entry) return {};
    var out = {};
    if (entry.gpuLayers !== undefined) out.gpuLayers = entry.gpuLayers;
    // The draft's placement and the fit margin travel with the tuned entry too, so the status
    // line (describeDraftOffload reads draftGpuLayers) and the auto-start replay report what the
    // server was actually told rather than the option defaults.
    var keys = ["cpuMoe", "cpuMoeLayers", "splitMode", "tensorSplit", "mainGpu", "overrideTensor", "loadMode", "loadModeAuto",
        "draftGpuLayers", "draftCpuMoe", "draftCpuMoeLayers", "fitTarget"];
    for (var i = 0; i < keys.length; i++) {
        if (entry[keys[i]] !== undefined) out[keys[i]] = entry[keys[i]];
    }
    return out;
}

function lastStartPath() {
    return nwPath.join(dataDir(), "laststart.json");
}

// The server-level settings the running process was started with, for the status line. Falls
// back to the manager's live config so a runtime started outside the UI (auto-start, or a
// direct startLocal call) still reports the truth rather than nothing.
function serverSettings() {
    var s = (_rt && _rt.lastStart) || {};
    var cfg = (_rt && _rt.manager && _rt.manager.config) || {};
    return {
        modelsMax: s.modelsMax != null ? s.modelsMax : cfg.modelsMax,
        sleepIdleSeconds: s.sleepIdleSeconds != null ? s.sleepIdleSeconds : (cfg.sleepIdleSeconds || 0),
        hasSleepSetting: s.sleepIdleSeconds != null || cfg.sleepIdleSeconds != null,
        threads: s.threads != null ? s.threads : (cfg.threads || 0),
        threadsBatch: s.threadsBatch != null ? s.threadsBatch : (cfg.threadsBatch || 0)
    };
}

// Remember the settings a start used (and the auto-start flag), so the runtime can be
// brought back the same way on the next app open. Best effort: a failure to persist must
// never fail a start.
function saveStartState(settings, autoStart) {
    try {
        dataDir();
        var previous = readStartState();
        var payload = {
            autoStart: autoStart === undefined ? !!previous.autoStart : !!autoStart,
            settings: settings || previous.settings || null
        };
        fs.writeFileSync(lastStartPath(), JSON.stringify(payload), "utf8");
        return payload;
    } catch (err) {
        return { autoStart: false, settings: null };
    }
}

function readStartState() {
    try {
        var p = lastStartPath();
        if (!fs.existsSync(p)) return { autoStart: false, settings: null };
        var parsed = JSON.parse(fs.readFileSync(p, "utf8"));
        if (!parsed || typeof parsed !== "object") return { autoStart: false, settings: null };
        return {
            autoStart: parsed.autoStart === true,
            settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : null
        };
    } catch (err) {
        return { autoStart: false, settings: null };
    }
}

function setAutoStart(enabled) {
    return saveStartState(null, enabled === true).autoStart;
}

// The model-id stem comparison RuntimeState.isRuntimeLive uses: a router can list one file
// under two names (with and without ".gguf"), so ids compare on the stem.
function modelIdStem(id) {
    return String(id || "").replace(/\.gguf$/i, "");
}

// External takeover, step 1: stop the console-owned launcher. The record's pid is the
// LAUNCHER's, not llama-server's. On Linux one SIGTERM reaches the launcher's own signal
// handler, which stops the server cleanly and its console prints Stopped. On Windows SIGTERM
// is a bare TerminateProcess of the launcher and would orphan the half-loaded server, so the
// same taskkill tree kill ServerProcess's defaultKillTree uses reaches the child.
// `killer` (opts.externalStop) replaces the whole stop for tests: called with the pid, it
// may return a promise or throw.
function stopExternalLauncher(pid, killer) {
    if (killer) return Promise.resolve().then(function () { return killer(pid); });
    if (process.platform === "win32") {
        return new Promise(function (resolve, reject) {
            require("child_process").exec("taskkill /pid " + pid + " /T /F", function (err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }
    try {
        process.kill(pid, "SIGTERM");
    } catch (err) {
        // Already gone (ESRCH): the goal - a dead launcher - is achieved.
        if (!(err && err.code === "ESRCH")) throw err;
    }
    return Promise.resolve();
}

// External takeover, step 2: wait, bounded, until the launcher pid is gone, so the port is
// actually released before the owned start binds it. Polls the same liveness probe the live
// check used; the timeout is the takeover's whole time budget.
function waitPidGone(pid, timeoutMs) {
    var RuntimeState = lib("RuntimeState.js");
    var deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve, reject) {
        function poll() {
            if (!RuntimeState.isProcessAlive(pid)) return resolve();
            if (Date.now() >= deadline) {
                return reject(new Error("the console runtime (pid " + pid + ") did not stop within " +
                    Math.round(timeoutMs / 1000) + " s; its port stays busy"));
            }
            setTimeout(poll, 200);
        }
        poll();
    });
}

// A requested model switch against a console-owned runtime: stop the console launcher (the
// record's pid), wait bounded for it to leave the port, and clear the record, so the owned
// start of the requested model can bind it. Bounded throughout; a launcher that will not die
// is a thrown error (the Start handler shows it) rather than a guaranteed port conflict. The
// manager's attached state is dropped by the shared reset at the top of startLocalInner -
// this takeover returns null into it, the same way an opts.force start arrives there.
// Injected by tests: opts.externalStop (the killer) and opts.externalStopWaitMs (the budget).
function takeOverExternalRuntime(state, statePath, opts) {
    var RuntimeState = lib("RuntimeState.js");
    var killer = opts && typeof opts.externalStop === "function" ? opts.externalStop : null;
    var timeoutMs = 10000;
    if (opts && opts.externalStopWaitMs != null && Number(opts.externalStopWaitMs) > 0) {
        timeoutMs = Number(opts.externalStopWaitMs);
    }
    return Promise.resolve()
        .then(function () { return stopExternalLauncher(state.pid, killer); })
        .then(function () { return waitPidGone(state.pid, timeoutMs); })
        .then(function () {
            // The console clears its own record on a clean Linux teardown; clearing again is
            // harmless (clearState tolerates an absent file). On Windows the tree-killed
            // launcher left the file on disk, so this is the clear that matters.
            RuntimeState.clearState({ path: statePath, fs: fs });
        })
        .catch(function (err) {
            throw new Error("Could not take over the console runtime on port " + state.port +
                " (pid " + state.pid + "): " + ((err && err.message) || err));
        });
}

// Attach to a runtime another process is already serving, instead of spawning a second one. A
// second copy of the same model on a small card exhausts VRAM and makes both slower, so this is
// always preferable to starting when something is already live.
//
// An attached runtime is NOT owned by this window: it must never be stopped or rebound from
// here, only disconnected. The manager records that, and the UI reads it.
//
// Exception - a requested model switch: when an explicit Start press (opts.autoStart falsy)
// names a model the record is NOT serving, attaching would silently ignore what the user
// asked for, so the console runtime is taken over instead (stopped through its ownership
// record, port freed) and null is returned for the owned start. An autoStart pass with a
// mismatched model attaches instead - nobody pressed anything, so nothing gets killed. Only
// a live-verified record (pid, /health, model in /v1/models) is ever signalled, and only
// when its pid is usable; every record/read failure keeps today's attach-or-null behaviour
// rather than killing blind.
function attachToRunning(opts) {
    var rt = ensureRuntime();
    var RuntimeState = lib("RuntimeState.js");
    var statePath = RuntimeState.statePath(dataDir());
    var state = RuntimeState.readState({ path: statePath, fs: fs });
    if (!state) return Promise.resolve(null);
    return RuntimeState.isRuntimeLive(state, { http: httpAdapter() }).then(function (live) {
        if (!live) {
            // A record that no longer answers is cleared, so the next start is not blocked by it.
            if (RuntimeState.isProcessAlive(state.pid)) return null;
            RuntimeState.clearState({ path: statePath, fs: fs });
            return null;
        }
        var requested = opts && typeof opts.modelId === "string" && opts.modelId !== "" ? opts.modelId : null;
        // The takeover answers an EXPLICIT Start press only. autoStart() reaches this path too,
        // three seconds after app open with no click; if the registry now resolves a different
        // target than the console serves (the recorded file was deleted, drafts.json changed
        // the order), killing the console session then would punish nobody for anything - so
        // an autoStart pass attaches instead and serves what is actually running.
        var explicitPress = !(opts && opts.autoStart === true);
        if (requested && explicitPress && modelIdStem(state.modelId) !== modelIdStem(requested)) {
            if (!RuntimeState.isProcessAlive(state.pid)) return null;
            return { takeover: true };
        }
        rt.manager.state = Object.assign({}, rt.manager.state, {
            status: "ready", baseUrl: state.baseUrl, port: state.port,
            modelId: state.modelId, attached: true, owner: "external", error: null
        });
        return { attached: true, baseUrl: state.baseUrl, modelId: state.modelId };
    }).catch(function () { return null; }).then(function (result) {
        // Deliberately outside the fail-safe catch above: a failed takeover must surface (the
        // Start handler shows it) rather than degrade into a start that is guaranteed to hit
        // the occupied port.
        if (!result || !result.takeover) return result;
        return takeOverExternalRuntime(state, statePath, opts).then(function () {
            return null; // the owned start of the requested model proceeds in startLocal
        });
    });
}

function startLocal(opts) {
    var rt = ensureRuntime();
    dataDir();
    // An explicit user start (`opts.force`) bypasses attach and claims this window's own runtime.
    // The shared reset at the top of startLocalInner drops a stale attachment first; if the
    // external server still holds the port the start then fails on that real reason, which is
    // the correct outcome rather than a silent no-op.
    if (opts && opts.force) return startLocalInner(opts);
    // If another process is already serving the requested model, attach to it rather than
    // loading a second copy; a different model is a switch, which attachToRunning resolves by
    // taking the external runtime over before returning null into the owned start.
    return attachToRunning(opts).then(function (attachedState) {
        if (attachedState) return rt.manager.status;
        return startLocalInner(opts);
    });
}

function startLocalInner(opts) {
    var rt = ensureRuntime();
    // One shared reset for every owned start. When this window has no live server of its own
    // but the state still claims an attachment, that claim is stale and must be dropped, or
    // manager.start refuses with "Runtime is already ready" and the editor wedges: the status
    // says ready (attached), Stop refuses because attached is still true, and no normal start
    // is possible. It goes stale when the console launcher exits normally and deletes its
    // runtime.json record - attachToRunning then finds no record at all and returns WITHOUT
    // touching the manager (its dead-record clear only runs when a record still exists) - and
    // it is how the explicit `opts.force` start bypasses attach. Covers every owned start
    // attempt that follows a dead or vanished attachment.
    if (!rt.manager.server && rt.manager.state.attached) {
        rt.manager.state = { status: "stopped", attached: false, owner: null, error: null,
            baseUrl: null, port: null, modelId: null };
    }
    // The pure settings mapping shared with the console launcher (lib/StartConfig.js): from
    // the requested options and the discovered models it resolves the target, applies the
    // runtime tuning, validates everything that can be rejected up front (port, expert count,
    // extra library folder) and returns the manager config patch. A throw here means nothing
    // was applied, so a rejected start cannot leave half-updated config behind.
    // Per-model profiles from the engine option, plus the draft/projector associations needed to
    // resolve a forced draft's spec type. When the associations were not handed in (an auto-start
    // pass, which replays the persisted settings), they are recomputed here so auto-start keeps
    // the per-model choices too. Profiles stay absent for a start that never had them, which
    // keeps the legacy single-model behaviour.
    var startProfiles = opts && opts.profiles;
    var startAssociations = opts && opts.associations;
    if (startProfiles && !startAssociations) {
        try { startAssociations = associations(); } catch (e) { startAssociations = null; }
    }
    var cfg = rt.StartConfig.buildStartConfig({
        opts: opts,
        entries: targetModels(),
        modelsDir: rt.manager.config.modelsDir,
        templatesDir: templatesDir(),
        fs: fs,
        defaultPort: DEFAULT_CONFIG_PORT,
        profiles: startProfiles,
        associations: startAssociations
    });
    Object.assign(rt.manager.config, cfg.managerConfigPatch);
    var tunedTarget = cfg.tunedTarget;
    var applied = offloadOfEntry(tunedTarget);
    // Remember what this start actually applied so describeStatus() can report it even
    // though targetModels() still returns the drafts.json/registry defaults.
    _rt.lastStart = {
        modelId: cfg.targetId,
        contextSize: tunedTarget ? tunedTarget.contextSize : null,
        kvType: cfg.kvType,
        kvUnified: cfg.kvUnified,
        kvOffload: cfg.kvOffload,
        offload: applied,
        expert: cfg.expertInfo,
        template: (tunedTarget && tunedTarget.chatTemplatePath) || null,
        libDir: cfg.libDir,
        modelsMax: cfg.modelsMax,
        sleepIdleSeconds: cfg.sleepIdleSeconds,
        threads: cfg.threads,
        threadsBatch: cfg.threadsBatch,
        waitIdleSeconds: cfg.waitIdleSeconds,
        parallel: cfg.parallel,
        port: cfg.port,
        loadMode: applied.loadMode,
        specDraftNMax: tunedTarget ? tunedTarget.specDraftNMax : undefined,
        specDraftNMin: tunedTarget ? tunedTarget.specDraftNMin : undefined,
        // The speculation/projector choice this start actually applied. The registry entry
        // describeStatus() overlays still carries the drafts.json defaults, so without these
        // the status line names the detected draft even when the server was started with a
        // forced draftId (or with speculation explicitly off).
        draftPath: tunedTarget ? (tunedTarget.draftPath || null) : null,
        specType: tunedTarget ? (tunedTarget.specType || null) : null,
        mmprojPath: tunedTarget ? (tunedTarget.mmprojPath || null) : null,
        specOff: !!(startProfiles && startProfiles[cfg.targetId] &&
            startProfiles[cfg.targetId].specMode === "off")
    };
    // Persist the same settings (plus the auto-start flag) so the runtime can be restored
    // the same way on the next app open.
    saveStartState({
        modelId: cfg.targetId,
        draftMax: opts && opts.draftMax,
        draftMin: opts && opts.draftMin,
        contextLength: tunedTarget ? tunedTarget.contextSize : (opts && opts.contextLength),
        kvType: cfg.kvType,
        kvUnified: cfg.kvUnified,
        kvOffload: cfg.kvOffload,
        // The server-level reasoning choice is recorded like every other server-level option, so
        // an auto-start replay (and the console launcher reading the same file) resolves the
        // user's Auto/On instead of StartConfig's "off" fallback. Without this the choice was
        // honoured only on an explicit Start and silently lost after a restart.
        reasoning: cfg.managerConfigPatch.reasoning,
        backend: cfg.backend === undefined ? "auto" : cfg.backend,
        gpuLayers: applied.gpuLayers,
        cpuMoe: applied.cpuMoe,
        cpuMoeLayers: applied.cpuMoeLayers,
        // The paired draft's placement and the fit margin are part of what was applied, so they
        // are recorded too; otherwise an auto-start replay would drop the card's draft/fit
        // choices even though the first start honoured them.
        draftGpuLayers: applied.draftGpuLayers,
        draftCpuMoe: applied.draftCpuMoe,
        draftCpuMoeLayers: applied.draftCpuMoeLayers,
        fitTarget: applied.fitTarget,
        splitMode: applied.splitMode,
        tensorSplit: applied.tensorSplit,
        mainGpu: applied.mainGpu,
        overrideTensor: applied.overrideTensor,
        expertCount: cfg.expertInfo ? cfg.expertInfo.count : undefined,
        libDir: cfg.libDir,
        loadMode: applied.loadMode,
        modelsMax: cfg.modelsMax,
        sleepIdleSeconds: cfg.sleepIdleSeconds,
        threads: cfg.threads,
        threadsBatch: cfg.threadsBatch,
        // The three server-level KV cache limits. They are parsed by StartConfig from settings,
        // so without this an auto-start replay dropped the user's values back to the shipped
        // defaults (null when the value was blank/invalid, which replays as the default).
        cacheRam: cfg.cacheRamMiB,
        ctxCheckpoints: cfg.ctxCheckpoints,
        cacheReuse: cfg.cacheReuseChunk,
        waitIdleSeconds: cfg.waitIdleSeconds,
        parallel: cfg.parallel,
        port: cfg.port,
        // The per-model profile map travels with the recorded settings, so an auto-start pass
        // replays every model's own settings instead of only the selected model's.
        profiles: startProfiles
    }, opts && opts.autoStart);
    function bindTarget(state) {
        // Parity with the console launcher's record: the result also carries the server's own
        // pid (the launcher records it so --stop can reach a server whose launcher is gone).
        state.serverPid = rt.manager.server && rt.manager.server.child ? rt.manager.server.child.pid : null;
        state.modelId = cfg.targetId;
        // The manager resolves the recommended load mode once it knows which GPU is in use, so
        // fold what it actually applied into lastStart. Without this the status line would stop
        // reporting the mode for anything resolved automatically.
        try {
            var modes = state && state.loadModes;
            var record = modes && modes[cfg.targetId];
            if (record && _rt.lastStart) {
                _rt.lastStart.offload = Object.assign({}, _rt.lastStart.offload, {
                    loadMode: record.mode,
                    loadModeAuto: record.auto === true
                });
            }
        } catch (e) { /* status is best-effort */ }
        return state;
    }
    // The front door routes a request with no model field to the selected model, so the
    // manager is told which one this start bound. forceCpu only adds to it.
    var startOpts = { defaultId: cfg.targetId };
    if (cfg.forceCpu) startOpts.forceCpu = true;

    // A start whose child died for lack of GPU memory is the one failure a knob fixes without
    // giving up the GPU: the dead child's stderr states how much did not fit and how the model
    // was placed, so ONE retry runs with a lower --gpu-layers count derived from it. Anything
    // else - and a retry that fails the same way - is a hard error carrying the child's own
    // last lines, so the user sees why the GPU refused. There is deliberately no CPU fallback:
    // a model this size on the CPU is not a translation runtime anyone would call working, and
    // a silent switch to it hides the problem instead of solving it.
    var AllocFallback = lib("AllocFallback.js");
    function enrichStartError(err) {
        var tail = err && typeof err.stderrTail === "string" ? err.stderrTail : "";
        var advice = "";
        try {
            advice = AllocFallback.failureAdvice(tail, tunedTarget || null);
        } catch (e) { advice = ""; }
        if (!advice) return err;
        var withAdvice = new Error(((err && err.message) || String(err)) + "\n" + advice);
        withAdvice.stderrTail = tail;
        return withAdvice;
    }
    function retryWithFewerGpuLayers(err) {
        if (cfg.forceCpu) return null;
        if (!rt.manager.status.backend || rt.manager.status.backend === "cpu") return null;
        var tail = err && typeof err.stderrTail === "string" ? err.stderrTail : "";
        if (!tail || !AllocFallback.isAllocFailure(tail)) return null;
        var plan = null;
        try { plan = AllocFallback.computeFallbackGpuLayers(tail, tunedTarget || null); } catch (e) { plan = null; }
        if (!plan) return null;
        var retryModels = cfg.tunedModels.map(function (m) {
            return m.id === cfg.targetId ? Object.assign({}, m, { gpuLayers: plan.layers }) : m;
        });
        if (typeof logger !== "undefined" && logger.warn) {
            logger.warn("[llmRuntime] start ran out of GPU memory (need to reduce by " +
                Math.round(plan.reduceMiB) + " MiB at " + plan.perLayerMiB.toFixed(1) +
                " MiB/layer); retrying with " + plan.layers + " GPU layers (was " + plan.current + ")");
        }
        return rt.manager.start(retryModels, startOpts).then(function (state) {
            state.note = "GPU ran out of memory at " + plan.current + " layers; running with " +
                plan.layers + ". Set the model's GPU layers to keep this permanently.";
            // The status line polls the manager's live state, not this return value, so the
            // note must reach the manager or it exists for nobody.
            rt.manager.setNote(state.note);
            if (_rt.lastStart) {
                _rt.lastStart.offload = Object.assign({}, _rt.lastStart.offload, { gpuLayers: plan.layers });
            }
            return bindTarget(state);
        });
    }
    return rt.manager.start(cfg.tunedModels, startOpts).then(bindTarget).catch(function (err) {
        var retried = null;
        try { retried = retryWithFewerGpuLayers(err); } catch (e) { retried = null; }
        if (retried) return retried.catch(function (err2) { throw enrichStartError(err2); });
        throw enrichStartError(err);
    });
}

// Bring the runtime back the way it was last started, when the user enabled auto-start.
// Never throws and never rejects: a failure at app open must not disturb the app.
function tryBind(modelId, attempt) {
    try {
        if (dslrWrapper()) {
            api.bindToDslr(modelId);
            return;
        }
    } catch (err) { /* the engine may still be loading; retry below */ }
    if (attempt >= 15) return;
    setTimeout(function () { tryBind(modelId, attempt + 1); }, 2000);
}

function autoStart() {
    var state = readStartState();
    if (!state.autoStart || !state.settings) return Promise.resolve(null);
    var rt = ensureRuntime();
    if (rt.manager.status.status === "ready" || rt.manager.status.status === "starting") {
        return Promise.resolve(rt.manager.status);
    }
    var models;
    try { models = targetModels(); } catch (err) { return Promise.resolve(null); }
    if (!rt.ModelRegistry.hasModels(models)) return Promise.resolve(null);
    var started;
    try {
        started = startLocal(Object.assign({}, state.settings, { autoStart: true }));
    } catch (err) {
        return Promise.resolve(null);
    }
    return started.then(function (s) {
        // Bind the engine as soon as the wrapper exists, so translation works without a click.
        tryBind(s.modelId, 0);
        return s;
    }).catch(function () { return null; });
}

// --- Runtime status window -------------------------------------------------------------
// A small always-on-top window that lives exactly as long as the runtime does. It is a real
// NW.js window rather than an in-page panel, so it keeps showing live progress while a
// translation runs and never covers the editor. The main window owns it: it pushes the same
// describeStatus() text the options card shows, so there is one source of truth.
var _statusWin = null;
var _statusTimer = null;
// Set when the user closes the window by hand: it must stay closed for this run rather than
// popping back open on the next tick. Reset when the runtime stops.
var _statusSuppressed = false;

function statusWindowOpen() {
    try {
        if (_statusWin && _statusWin.window) return true;
    } catch (err) { /* window is gone */ }
    _statusWin = null;
    return false;
}

function pushStatusText(text) {
    try {
        if (!statusWindowOpen()) return;
        var target = _statusWin.window;
        if (target && typeof target.setRuntimeStatus === "function") target.setRuntimeStatus(text);
    } catch (err) { /* the window may be closing */ }
}

function refreshStatusWindow() {
    if (!statusWindowOpen()) return;
    describeStatus().then(pushStatusText).catch(function () { /* keep the last text */ });
}

function closeStatusWindow() {
    var win = _statusWin;
    _statusWin = null;
    if (!win) return;
    // Hide first: close(true) has proven unreliable on some NW builds for a window whose
    // close listener already fired, and a hidden zombie at least stops bothering the user
    // (and stops keeping the process visibly alive) even when the close cannot complete.
    try { win.hide(); } catch (err) { /* already gone */ }
    try { win.close(true); } catch (err) { /* already gone */ }
}

function showStatusWindow() {
    _statusSuppressed = false;
    if (typeof nw === "undefined" || !nw.Window) return null;
    if (statusWindowOpen()) {
        try { _statusWin.show(); } catch (e) { /* ignore */ }
        try { _statusWin.focus(); } catch (e) { /* ignore */ }
        refreshStatusWindow();
        return _statusWin;
    }
    try {
        nw.Window.open("www/runtimeStatus.html", {
            id: "runtimeStatus",
            // Sized for the busiest state the card reaches - ready plus the generation and
            // throughput lines - without resizing: ~108 monospace columns keep even the Fit
            // line to two wrapped rows, and 560 px holds the full ready list with the
            // activity lines added.
            width: 760,
            height: 560,
            min_width: 320,
            min_height: 160,
            resizable: true,
            always_on_top: true,
            // Frameless: the page draws its own title bar, so the window follows night mode
            // like the other windows instead of keeping an OS-themed native title bar.
            frame: false,
            show: false
        }, function (win) {
            if (!win) return;
            _statusWin = win;
            try { win.setAlwaysOnTop(true); } catch (e) { /* ignore */ }
            try { win.show(); } catch (e) { /* ignore */ }
            // Closing the window hides it for this run only; the runtime keeps running.
            try {
                win.on("close", function () {
                    _statusSuppressed = true;
                    try { win.hide(); } catch (e) { /* ignore */ }
                    try { win.close(true); } catch (e) { /* ignore */ }
                });
            } catch (e) { /* ignore */ }
            refreshStatusWindow();
        });
    } catch (err) {
        _statusWin = null;
    }
    return _statusWin;
}

// One ticker for the whole addon: it keeps the status window in step with the runtime,
// opening it when the runtime becomes ready and closing it when the runtime stops. It never
// throws, so a broken window or a dead server cannot disturb the app.
function statusTick() {
    try {
        var rt = ensureRuntime();
        var state = rt.manager.status;
        if (state.status === "ready") {
            if (!statusWindowOpen() && !_statusSuppressed) showStatusWindow();
            else refreshStatusWindow();
            return;
        }
        if (state.status === "stopped" || state.status === "error") {
            _statusSuppressed = false;
            closeStatusWindow();
        }
    } catch (err) { /* never let a tick break the app */ }
}

function startStatusTicker() {
    if (_statusTimer) return;
    try {
        _statusTimer = setInterval(statusTick, 2000);
        // In NW.js this never matters; under a plain Node test runner it keeps the process
        // from being held open by the ticker.
        if (_statusTimer && typeof _statusTimer.unref === "function") _statusTimer.unref();
    } catch (err) { _statusTimer = null; }
}

// --- Chat template window ---------------------------------------------------------------
// Opened on demand from the runtime card. It is deliberately NOT tied to the runtime's state:
// a template can be edited and saved before the runtime is ever started, and it is applied at
// the next start. The page talks back through window.opener.llmRuntime, the same way the app's
// other child windows talk to the main window.
var _templateWin = null;

function templateWindowOpen() {
    try {
        if (_templateWin && _templateWin.window) return true;
    } catch (err) { /* window is gone */ }
    _templateWin = null;
    return false;
}

function showTemplateWindow() {
    if (typeof nw === "undefined" || !nw.Window) return null;
    if (templateWindowOpen()) {
        try { _templateWin.show(); } catch (e) { /* ignore */ }
        try { _templateWin.focus(); } catch (e) { /* ignore */ }
        return _templateWin;
    }
    try {
        nw.Window.open("www/chatTemplate.html", {
            id: "chatTemplate",
            width: 720,
            height: 560,
            min_width: 420,
            min_height: 320,
            resizable: true,
            frame: false,
            show: false
        }, function (win) {
            if (!win) return;
            _templateWin = win;
            try { win.show(); } catch (e) { /* ignore */ }
            try {
                win.on("close", function () {
                    try { win.hide(); } catch (e) { /* ignore */ }
                    try { win.close(true); } catch (e) { /* ignore */ }
                });
            } catch (e) { /* ignore */ }
        });
    } catch (err) {
        _templateWin = null;
    }
    return _templateWin;
}

function closeTemplateWindow() {
    var win = _templateWin;
    _templateWin = null;
    if (!win) return;
    try { win.close(true); } catch (err) { /* already gone */ }
}

var api = {
    version: RUNTIME_VERSION,
    start: function (models) { var rt = ensureRuntime(); dataDir(); return rt.manager.start(models || []); },
    stop: function () { var rt = ensureRuntime(); return rt.manager.stop(); },
    // Quit-path stop: closes the status window first (it must never outlive the app - while
    // it exists it keeps the whole process, and with it llama-server, alive), then stops the
    // owned runtime, bounded by timeoutMs so a wedged kill can never hang the app's shutdown.
    // After the bounded wait the children are killed synchronously regardless: the async
    // stop chain can wedge on a model still mid-load, but taskkill /F cannot be wedged.
    stopForQuit: function (timeoutMs) {
        closeStatusWindow();
        if (!_rt) return Promise.resolve();
        var attached = false;
        var stopping = null;
        try {
            // An attached runtime belongs to another process and must never be stopped here.
            attached = !!(_rt.manager && _rt.manager.status && _rt.manager.status.attached);
            if (!attached) stopping = _rt.manager.stop();
        } catch (err) { stopping = null; }
        if (attached) return Promise.resolve();
        return new Promise(function (resolve) {
            var done = false;
            var timer = null;
            var finish = function () {
                if (done) return;
                done = true;
                if (timer) clearTimeout(timer);
                try {
                    if (_rt && _rt.manager && typeof _rt.manager.stopAllChildren === "function") {
                        _rt.manager.stopAllChildren();
                    }
                } catch (err) { /* best effort */ }
                resolve();
            };
            timer = setTimeout(finish, timeoutMs || 5000);
            if (timer && typeof timer.unref === "function") timer.unref();
            if (stopping && typeof stopping.then === "function") stopping.then(finish, finish);
            else finish();
        });
    },
    status: function () { var rt = ensureRuntime(); return rt.manager.status; },
    discoverModels: discoverModels,
    targetModels: targetModels,
    selectedModel: selectedModel,
    setSelectedModel: setSelectedModel,
    metrics: metrics,
    runtimeMetrics: runtimeMetrics,
    modelMeta: modelMeta,
    modelInfos: modelInfos,
    associations: associations,
    candidateDraftsFor: candidateDraftsFor,
    candidateProjectorsFor: candidateProjectorsFor,
    readDrafts: readDrafts,
    progress: progress,
    describeStatus: describeStatus,
    startLocal: startLocal,
    attachToRunning: attachToRunning,
    readStartState: readStartState,
    setAutoStart: setAutoStart,
    autoStart: autoStart,
    showStatusWindow: showStatusWindow,
    closeStatusWindow: closeStatusWindow,
    statusWindowOpen: statusWindowOpen,
    readTemplate: readTemplate,
    saveTemplate: saveTemplate,
    clearTemplate: clearTemplate,
    hasCustomTemplate: hasCustomTemplate,
    showTemplateWindow: showTemplateWindow,
    closeTemplateWindow: closeTemplateWindow,
    bindEngine: function (wrapper, opts) {
        return ensureRuntime().EngineBinding.bindEngine(wrapper, opts);
    },
    bindToDslr: function (modelId) {
        var rt = ensureRuntime();
        if (!modelId) throw new Error("No local model is loaded to bind");
        var wrapper = dslrWrapper();
        if (!wrapper) throw new Error("DSLR engine wrapper is not available");
        var base = rt.manager.status.baseUrl;
        if (!base) throw new Error("Local runtime is not running");
        return rt.EngineBinding.bindEngine(wrapper, {
            apiUrl: base + "/v1/chat/completions",
            modelId: modelId
        });
    }
};

// Read-only probe used by the engine options to explain a broken install instead of
// throwing. Accessing it attempts initialisation once and returns the reason or null.
Object.defineProperty(api, "loadError", {
    enumerable: true,
    get: function () {
        try { ensureRuntime(); return null; } catch (err) { return _loadError; }
    }
});
Object.defineProperty(api, "manager", {
    enumerable: true,
    get: function () { return ensureRuntime().manager; }
});

window.llmRuntime = api;

// The status window follows the runtime's state from here on: it appears when the runtime
// becomes ready and disappears when it stops.
startStatusTicker();

// Auto-start, if the user turned it on, is deferred so the window and the engine wrapper
// have a chance to finish loading first. It is wrapped so a failure can never break startup.
try {
    setTimeout(function () {
        try { api.autoStart(); } catch (err) { /* never break startup */ }
    }, 3000);
} catch (err) { /* setTimeout unavailable */ }

$(window).on("beforeClose", function () {
    try {
        // The status window must never outlive the app: close it now, synchronously, instead
        // of waiting for the state ticker. If anything in the stop chain stalls, that window
        // would keep the whole process - and with it llama-server - alive, uncloseable.
        closeStatusWindow();
        // An attached runtime belongs to another process: this window may disconnect from it but
        // must never stop it, so the ownership recorded by attachToRunning is honoured here too.
        if (_rt && _rt.manager && _rt.manager.status.attached) return;
        if (_rt) _rt.manager.stop();
    } catch (err) { /* best effort */ }
});

process.on("exit", function () {
    try {
        // Only children this window spawned are ours; an attached runtime is not, and must never
        // be stopped from here. The front door lives in this process, so killing every pooled
        // model child synchronously is what prevents a detached llama-server surviving exit:
        // async kills (taskkill through exec) cannot run once the process is exiting.
        if (_rt && _rt.manager && _rt.manager.status && _rt.manager.status.attached) return;
        if (_rt && _rt.manager && typeof _rt.manager.stopAllChildren === "function") {
            _rt.manager.stopAllChildren();
        }
    } catch (err) { /* best effort */ }
});
