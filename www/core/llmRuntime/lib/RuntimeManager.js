// www/core/llmRuntime/lib/RuntimeManager.js
"use strict";
const { parseDeviceList, selectBackend } = require("./Backend");
const Offload = require("./Offload");
const ModelArgs = require("./ModelArgs");
const ModelPool = require("./ModelPool");
const EvictionPolicy = require("./EvictionPolicy");
const FrontDoor = require("./FrontDoor");
const ReasoningCaps = require("./ReasoningCaps");
const RuntimeInfo = require("./RuntimeInfo");

const DEFAULT_CONFIG = {
    modelsDir: null,
    // One resident model by default. On a small GPU two
    // resident models compete for the same VRAM and starve each other into CPU offload, so the
    // second model is slower than if it had loaded alone. The front door's pool uses this as
    // its "models kept loaded" bound.
    modelsMax: 1,
    // 0 = never unload. llama.cpp's own default is disabled, and a sleeping model has to be
    // reloaded in full on the next request, so unloading is an explicit opt-in.
    sleepIdleSeconds: 0,
    host: "127.0.0.1",
    // The port to serve on when it is free. 1234 matches the convention most local-inference
    // users already have in their client config. null means "pick a free one", which is what
    // happens if a start explicitly clears it.
    port: 1234,
    // 0 = let llama.cpp choose (one thread per logical core). Setting it explicitly avoids
    // its -1 default, which measured markedly worse than a pinned count on a 6C/12T CPU.
    threads: 0,
    threadsBatch: 0,
    cacheRamMiB: 4096,
    cacheReuseChunk: 256,
    ctxCheckpoints: 16,
    // KV cache quantization shipped default. It is no longer passed through to
    // --cache-type-k/--cache-type-v here; the effective per-model value travels on each model
    // entry and ModelArgs emits it, and StartConfig always supplies one (falling back to
    // q8_0). These fields are a record only.
    // q8_0 roughly halves KV memory with negligible quality loss.
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    // Unified KV keeps one shared cache for all slots (the default, and what lets an
    // identical system prompt be reused across slots). KV offload keeps that cache in
    // VRAM next to the offloaded layers; both are switchable from the runtime card and are
    // emitted into every model child's arguments.
    kvUnified: true,
    kvOffload: true,
    slotSavePath: null,
    // Server-level arguments each model's own child receives. flash-attn is on in the shipped
    // settings; prompt caching and idle-slot caching are always requested; cacheReuseChunk is
    // the existing reuse setting.
    flashAttn: "on",
    cachePrompt: true,
    cacheIdleSlots: true,
    // Reasoning is a default, not a lock: measured on the pinned build, a request that carries
    // chat_template_kwargs.enable_thinking true still thinks even with --reasoning off. Off matches
    // what the DSLR engine already asks for per request and stops external clients that send no
    // thinking field from inheriting this model family's thinking-on template.
    reasoning: "off",
    // Extra directory the loader should search for GPU backend libraries, for a runtime
    // installed outside the system paths (a ROCm tree in a user folder, say). Prepended to
    // LD_LIBRARY_PATH on Linux and PATH on Windows.
    libDir: null,
    backendPreference: null,
    platformKey: null,
    // How long a model switch waits for the outgoing model's in-flight request(s) to finish
    // before evicting it anyway ("slow rather than crash"), in seconds. The editor option
    // `runtimeWaitIdleSeconds` maps here. 0 disables the wait: the switch evicts at once,
    // truncating the running generation. Generous and bounded: only a wedged/very long request
    // reaches the cap, and the switch then logs a warning and proceeds rather than hanging
    // forever. 30 minutes, because local models on consumer hardware can be slow.
    waitIdleSeconds: 1800
};

// Poll cadence for the wait-for-idle loop. Small enough that a switch proceeds promptly once
// the last stream chunk has been written, cheap enough to run while a request is generating.
const WAIT_FOR_IDLE_POLL_MS = 100;

// The environment for the spawned server when an extra library folder is configured. Returns
// null when there is nothing to add, so the child simply inherits this process's environment.
// The directory is prepended, so it wins over any system copy of the same library.
function buildSpawnEnv(libDir, platform, baseEnv) {
    if (!libDir) return null;
    const env = Object.assign({}, baseEnv || process.env);
    const isWindows = platform === "win32";
    const key = isWindows ? "Path" : "LD_LIBRARY_PATH";
    // The delimiter must come from the platform being described, not from the machine running
    // this code: the two differ, and a wrong one silently produces a single unusable entry.
    const delimiter = isWindows ? ";" : ":";
    // Windows environment blocks are case-insensitive and conventionally use "Path"; fall
    // back to whatever spelling is already present so we extend rather than duplicate it.
    const existingKey = Object.keys(env).find((k) => k.toLowerCase() === key.toLowerCase()) || key;
    const current = env[existingKey] || "";
    env[existingKey] = current ? libDir + delimiter + current : libDir;
    return env;
}

// The value that follows a flag in an argument list, or null. The pool builds each child's
// arguments with only host+port, so the model id (--alias) and the internal port (--port) are
// read back out of that list and the full argument list is rebuilt with the manager's globals.
function argValue(args, flag) {
    for (let i = 0; i < args.length - 1; i++) {
        if (args[i] === flag) return args[i + 1];
    }
    return null;
}

// Whether a probe result already contains a ROCm/HIP device.
function hasRocmDevice(devices) {
    return (devices || []).some((d) => d.kind === "rocm" || d.kind === "hip");
}

// Whether the standard HIP SDK location auto-probe can still change this start's outcome.
// Windows only - the SDK's bin folder is never on the PATH there, which is exactly the
// failure it heals. Only when a ROCm pack is installed but produced no device; never when
// the user named an extra library folder themselves (their folder wins, and a wrong one
// must surface as the error instead of being silently replaced); and only when ROCm would
// actually be chosen if it appeared - a strict rocm preference, or automatic mode without
// a CUDA device (CUDA outranks ROCm anyway). A forced CPU leaves ROCm nothing to win.
function rocmAutoProbeApplies({ platform, libDir, installed, devices, preference }) {
    if (platform !== "win32") return false;
    if (libDir) return false;
    if (!installed || installed.indexOf("rocm") === -1) return false;
    if (hasRocmDevice(devices)) return false;
    if (preference === "rocm") return true;
    if (preference) return false;
    return !devices.some((d) => d.kind === "cuda");
}

// The readable failure for a strict backend preference that cannot be used. Two distinct
// causes with different remedies - the pack is not installed at all, or it is installed but
// the loader found no matching device (a driver/runtime problem on the machine) - and both
// name what WAS seen, so a report built from this message is diagnosable without a log file.
function strictBackendError(backend, reason, installedBackends, devices) {
    const installed = (installedBackends || []).join(", ") || "(none)";
    const seen = (devices || []).length
        ? devices.map((d) => d.token + " " + d.name).join("; ")
        : "none";
    if (reason === "not-installed:" + backend) {
        return "The selected backend (" + backend + ") is not installed in this runtime " +
            "(installed: " + installed + "). Install its optional pack, or set the local " +
            "runtime backend back to auto.";
    }
    return "The selected backend (" + backend + ") is installed, but no matching device was " +
        "found (detected: " + seen + "). Check the GPU driver and the backend's own runtime " +
        "(for ROCm, the AMD HIP SDK), or set the local runtime backend back to auto.";
}

// A short diagnostic tail, so a chatty probe cannot blow up the error message.
function capProbeDetail(text) {
    const s = String(text || "").trim();
    return s.length > 4000 ? s.slice(0, 4000) + "\n(...)" : s;
}

// Which HIP SDK generation an installed Windows ROCm pack was built against, from the
// versioned HIP runtime DLL the pack ships (amdhip64_6.dll = HIP 6.x, amdhip64_7.dll =
// HIP 7.x). Null when no ROCm pack fingerprint is present.
function rocmPackGeneration(packFiles) {
    for (const name of packFiles || []) {
        const match = /^amdhip64_(\d+)\.dll$/i.exec(String(name));
        if (match) return Number(match[1]);
    }
    return null;
}

// The "why" behind a refused backend that IS installed: the device probe's own stderr names
// the library that failed to load (a HIP/Vulkan DLL the loader could not resolve), and a
// Windows ROCm pack whose HIP generation cannot work with the machine's SDK at all is named
// as such. Returns "" when there is nothing to add - a not-installed refusal needs no probe
// detail, and a pack without a recognisable generation gets no hint.
function backendFailureDetail(backend, reason, probeStderr, packFiles) {
    if (reason !== "no-device:" + backend) return "";
    const parts = [];
    const stderr = String(probeStderr || "").trim();
    if (stderr) parts.push("The device probe reported on stderr:\n" + capProbeDetail(stderr));
    if (backend === "rocm") {
        const generation = rocmPackGeneration(packFiles);
        if (generation === 7) {
            parts.push("The installed ROCm pack was built for HIP SDK 7.x, which AMD ships " +
                "for Windows 11 only. On Windows 10 use the ROCm 6 pack together with " +
                "HIP SDK 6.4.2.");
        } else if (generation === 6) {
            parts.push("This ROCm pack is built for HIP SDK 6.4.2. Its bin folder " +
                "(C:\\Program Files\\AMD\\ROCm\\6.4\\bin) must be on PATH, or set as the " +
                "extra library folder option, and the app restarted afterwards.");
        }
    }
    return parts.join("\n");
}

class RuntimeManager {
    constructor(deps) {
        this.resolvePayload = deps.resolvePayload;
        this.verifyPayload = deps.verifyPayload || function () { return []; };
        this.listDevices = deps.listDevices;
        // Optional: locates the HIP SDK's bin folder in its standard install locations, for
        // the ROCm auto-probe in start(). Injected like every other seam; absent means
        // "never probe", which keeps unit tests and exotic embedders on the plain path.
        this.standardLibDirs = deps.standardLibDirs || null;
        this.findFreePort = deps.findFreePort;
        this.writeFile = deps.writeFile;
        this.createServer = deps.createServer;
        this.createRouter = deps.createRouter;
        // File size of a model, used to decide whether it can stay entirely on the GPU. Injected
        // so this module stays free of direct filesystem access; null means "unknown", which
        // keeps mmap rather than guessing.
        this.modelBytes = deps.modelBytes || function () { return null; };
        this.waitForHealth = deps.waitForHealth;
        // How long a child may stay alive without becoming healthy before a start gives up on
        // it. Generous by design: a big model read from a cold disk loads for minutes, and the
        // health wait keeps waiting for exactly this long while the child is alive. Injectable
        // so tests can make the cap observable.
        this.healthHardCapMs = Number(deps.healthHardCapMs) > 0 ? Number(deps.healthHardCapMs) : 30 * 60 * 1000;
        this.onStatus = deps.onStatus || function () {};
        // Diagnostic channel (best effort). The wait-for-idle cap warning goes here; production
        // entry points wire it to their own logger, and a missing one is simply silence.
        this.log = deps.log || function () {};
        // The platform the start runs on, injectable so tests on any host can exercise the
        // Windows-specific behaviour (the standard HIP SDK location probe and the env the
        // probe and children are built for). Defaults to the real host platform.
        this._platform = deps.platform || process.platform;
        // Clock seam for the idle-unload policy. Tests inject a controllable clock; production
        // uses the wall clock.
        this._now = deps.now || function () { return Date.now(); };
        this.config = Object.assign({}, DEFAULT_CONFIG, deps.config || {});
        if (!this.config.platformKey) throw new Error("RuntimeManager config needs platformKey");
        // The public front door, the per-model pool, and the child servers the pool spawned.
        // They are all null when stopped or attached. `server` is a small front-door-shaped
        // handle so the console/app teardown paths that reach for manager.server keep working.
        this.frontDoor = null;
        this.pool = null;
        this.children = {};
        this.ports = {};
        // The chat template each running child reports on its own /props. The front door answers
        // /props itself (from the entry), so this cache is what lets it carry the loaded child's
        // template - which only exists once the model is running.
        this._chatTemplates = {};
        // The loaded child's whole /props document, captured when it became healthy (the same
        // read as the template). While a model is loaded this is what /props answers with, so a
        // context llama.cpp adjusted from the requested value is reported truthfully.
        this._childProps = {};
        // Reasoning capabilities derived from each loaded child's own /props at that same
        // capture: which template features the child advertises and which effort values its
        // validator accepts. Per loaded model, cleared wherever the stale /props are cleared,
        // so a reloaded model is judged by its own instance's facts, not a predecessor's.
        this._reasoningCaps = {};
        // Last time a request was routed to each loaded model (ms). Drives the idle-unload
        // policy; 0/absent sleepIdleSeconds means the map is never swept.
        this._lastUsed = {};
        this._idleTimer = null;
        this._lastChildId = null;
        this._defaultId = "";
        this._selectedDevice = null;
        this._activeServer = null;
        // Incremented by every start and by every teardown; a start checks its token after each
        // await so a stop() landing mid-start cancels it instead of completing to "ready".
        this._startSeq = 0;
        this._doorStarting = false;
        // Settled when the last loaded child exits on its own, or when the runtime is torn down.
        // It backs the compatibility `server.exitPromise` the console/app watch for server death.
        this._exitDeferred = null;
        this.server = null;
        this.client = null;
        this.state = {
            status: "stopped", backend: null, device: null,
            port: null, baseUrl: null, models: [], error: null,
            // Ownership is explicit, not inferred: a manager this window created owns whatever it
            // spawns. attachToRunning overrides these two fields when it adopts an external server.
            attached: false, owner: null
        };
    }

    get status() {
        const out = Object.assign({}, this.state);
        // The pool is the source of truth for what is loaded right now, so a status read after
        // an on-demand load or an eviction reports the real set rather than the start snapshot.
        if (this.pool) out.loadedModels = this.pool.loadedIds();
        return out;
    }

    _set(patch) {
        this.state = Object.assign({}, this.state, patch);
        this.onStatus(Object.assign({}, this.state));
        return this.status;
    }

    // A durable status note (e.g. "GPU backend failed (...); running on CPU."). The previous
    // downgrade set the note only on the start's return value, which the status line never
    // reads - it polls this.state - so the fallback was invisible.
    setNote(note) {
        return this._set({ note: note || null });
    }

    // A start's cancellation check. Anything that stops the runtime (stop, teardown, a new
    // start) bumps _startSeq, so the in-flight start sees the mismatch and aborts.
    _assertLive(token) {
        if (this._startSeq !== token) {
            const err = new Error("runtime start was cancelled");
            err.cancelled = true;
            throw err;
        }
    }

    _newExitDeferred() {
        let resolve;
        const promise = new Promise(function (r) { resolve = r; });
        let settled = false;
        return {
            promise: promise,
            resolve: function (value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }
        };
    }

    _resolveExit(result) {
        if (this._exitDeferred) {
            this._exitDeferred.resolve(result || { code: null, signal: null });
        }
    }

    // Resolve the size-based half of the load-mode recommendation. The tuning pass in the
    // caller cannot know which GPU will be selected, so this runs here, where the device and
    // the models are both known. An entry that already carries a mode - an explicit choice, or
    // a tuning-time recommendation (experts kept on the CPU, or a manual partial layer count) -
    // is left exactly as it is.
    _applyLoadModeForFit(models, selection, device) {
        const list = Array.isArray(models) ? models : [];
        const vramMiB = device ? device.memoryMiB : null;
        const gpuActive = selection.backend !== "cpu" && !!device;
        const applied = {};
        const out = list.map((entry) => {
            if (!entry) return entry;
            if (entry.loadMode) {
                // Already decided during tuning: either the user's own choice, or the
                // expert/partial-offload recommendation. Keep whichever it was.
                applied[entry.id] = { mode: entry.loadMode, auto: entry.loadModeAuto === true };
                return entry;
            }
            // Every file the start reads - the target, the paired draft, the projector - plus
            // the KV cache it will allocate: the fit heuristic must see the whole load, not
            // just the model file, or a start with a big draft and context reads as "fits".
            const bytesOf = (p) => (p ? this.modelBytes(p) : null);
            const modelBytes = bytesOf(entry.modelPath);
            const draftBytes = bytesOf(entry.draftPath);
            const mmprojBytes = bytesOf(entry.mmprojPath);
            const mode = Offload.resolveLoadMode(undefined, entry, { gpuActive, vramMiB, modelBytes, draftBytes, mmprojBytes });
            // Nothing emitted means llama.cpp's own default, which is mmap. Recording it makes
            // the status line able to say what auto settled on rather than showing nothing.
            applied[entry.id] = { mode: mode || "mmap", auto: true };
            return mode ? Object.assign({}, entry, { loadMode: mode, loadModeAuto: true }) : entry;
        });
        this._pendingLoadModes = applied;
        return out;
    }

    // The globals every model child is started with. threads/threadsBatch are omitted when 0
    // ("let llama.cpp choose"), exactly as the old server args did: ModelArgs emits `--threads 0`
    // for a zero, and 0 is not the same as unset on the pinned engine.
    _globals(port, deviceToken) {
        const c = this.config;
        return {
            host: c.host,
            port: port,
            // The backend selection's device, so a configured GPU (or an explicit backend) reaches
            // each child exactly as it reached the old router. Omitted on the CPU path.
            device: deviceToken || undefined,
            threads: c.threads > 0 ? c.threads : undefined,
            threadsBatch: c.threadsBatch > 0 ? c.threadsBatch : undefined,
            cacheRamMiB: c.cacheRamMiB,
            ctxCheckpoints: c.ctxCheckpoints,
            // Server-level args the old router got and every child still needs.
            flashAttn: c.flashAttn,
            cacheReuseChunk: c.cacheReuseChunk,
            cachePrompt: c.cachePrompt,
            cacheIdleSlots: c.cacheIdleSlots,
            reasoning: c.reasoning,
            kvUnified: c.kvUnified,
            kvOffload: c.kvOffload,
            slotSavePath: c.slotSavePath
        };
    }

    _modelBuffers() {
        // The child whose model is currently served (the selected default while it is loaded,
        // else the most recently loaded one), not merely the last one spawned. With several
        // resident models the placement report must describe the instance the status line names.
        if (!this.pool) return null;
        const loaded = this.pool.loadedIds();
        if (!loaded.length) return null;
        let id = this._defaultId;
        if (!id || loaded.indexOf(id) === -1) id = loaded[loaded.length - 1];
        const record = this.children && this.children[id];
        return record && record.server ? record.server.modelBuffers : null;
    }

    // The engine's fit decision for the same child the placement report reads (raw lines; see
    // ServerProcess.newFitReport).
    _fitReport() {
        if (!this.pool) return null;
        const loaded = this.pool.loadedIds();
        if (!loaded.length) return null;
        let id = this._defaultId;
        if (!id || loaded.indexOf(id) === -1) id = loaded[loaded.length - 1];
        const record = this.children && this.children[id];
        return record && record.server ? record.server.fitReport : null;
    }

    // --- Idle unload (`unload after idle`, spec §3.3 as our policy) -------------------------
    //
    // This is deliberately the front door's own policy rather than a llama.cpp argument: each
    // model is a plain per-model server, and the old router's `--sleep-idle-seconds` (which the
    // preset parser never actually applied) is not passed to children. A loaded model's last
    // routed use is recorded; when it has been idle longer than the configured seconds the child
    // is stopped and the next request starts it again. 0/absent means never.

    _idleMs() {
        const s = Number(this.config.sleepIdleSeconds);
        return (isFinite(s) && s > 0) ? s * 1000 : 0;
    }

    _touchUse(id) {
        if (id) this._lastUsed[id] = this._now();
    }

    _startIdleTimer() {
        this._stopIdleTimer();
        const idleMs = this._idleMs();
        if (!idleMs) return;
        const self = this;
        // Checking several times per idle window keeps the actual unload close to the configured
        // value without polling hard; the cap keeps a long (minutes) window cheap.
        const period = Math.max(100, Math.min(idleMs, 1000));
        this._idleTimer = setInterval(function () { self._sweepIdle(); }, period);
        if (this._idleTimer && typeof this._idleTimer.unref === "function") this._idleTimer.unref();
    }

    _stopIdleTimer() {
        if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null; }
    }

    // Stop every loaded child idle beyond the configured seconds. Returns a promise that settles
    // after the stops have been queued through the pool, so a caller (a test, or teardown) can
    // observe the result. Never throws.
    //
    // A candidate is only stopped when its own /slots says it is not working: `_touchUse` fires
    // when a request is *routed*, so a generation that runs longer than the idle window would
    // otherwise be killed mid-stream. A child whose /slots cannot be read is treated as working
    // for this tick (conservative), so an in-flight response is never truncated.
    _sweepIdle() {
        const idleMs = this._idleMs();
        const pool = this.pool;
        if (!idleMs || !pool || this.state.status !== "ready") return Promise.resolve();
        const loaded = pool.loadedIds();
        const now = this._now();
        // Forget tracking for models that are no longer loaded (evicted, stopped, failed).
        for (const id in this._lastUsed) {
            if (loaded.indexOf(id) === -1) delete this._lastUsed[id];
        }
        const self = this;
        const checks = [];
        for (let i = 0; i < loaded.length; i++) {
            const id = loaded[i];
            const last = this._lastUsed[id];
            if (last === undefined) { this._lastUsed[id] = now; continue; }
            if (now - last >= idleMs) checks.push(self._idleStopIfFree(id));
        }
        return Promise.all(checks);
    }

    // Whether a child's own /slots reports any slot mid-work. The real server answers an array
    // of slot objects; anything else (or no array) counts as "not known to be busy".
    _slotsBusy(slots) {
        if (!Array.isArray(slots)) return false;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot && slot.is_processing === true) return true;
        }
        return false;
    }

    // Stop one idle candidate only if its child is not generating. Probing is bounded by the
    // caller's cadence; a failed probe refreshes last-used so the next tick re-checks rather
    // than risking a mid-stream kill.
    _idleStopIfFree(id) {
        const self = this;
        if (!this.pool || this.pool.loadedIds().indexOf(id) === -1) return Promise.resolve();
        // The front door's in-flight count is authoritative: a model with a request being
        // proxied right now is working, whatever its /slots says. Refresh and skip this tick.
        const active = (this.frontDoor && typeof this.frontDoor.activeRequests === "function")
            ? this.frontDoor.activeRequests(id) : 0;
        if (active > 0) { self._touchUse(id); return Promise.resolve(); }
        const childPort = this.ports ? this.ports[id] : undefined;
        const client = childPort === undefined ? null
            : this.createRouter("http://" + this.config.host + ":" + childPort);
        const probe = (client && typeof client.slots === "function")
            ? Promise.resolve().then(function () { return client.slots(); })
            : Promise.reject(new Error("no /slots probe"));
        return probe.then(function (slots) {
            if (self._slotsBusy(slots)) {
                // Still generating: not idle. Refresh so the next tick re-checks after it ends.
                self._touchUse(id);
                return;
            }
            // Re-check under the settled probe: a request may have routed here meanwhile.
            if (!self.pool || self.pool.loadedIds().indexOf(id) === -1) return;
            const last = self._lastUsed[id];
            if (last !== undefined && self._now() - last < self._idleMs()) return;
            delete self._lastUsed[id];
            return Promise.resolve(self.pool.stop(id)).catch(function () { /* best effort */ });
        }, function () {
            // /slots unreachable: be conservative and never stop on this tick.
            self._touchUse(id);
        });
    }

    // The model id whose child is on `port`. The pool hands healthWait the internal port it
    // allocated, and spawnChild has already recorded which id owns it. A port is reused after
    // its previous model is evicted (the shipped "models kept loaded" of 1 makes that the normal
    // case), so the mapping for a dead child must be ignored: otherwise healthWait for the new
    // child would race the evicted child's already-resolved exitPromise and report "llama-server
    // exited before becoming healthy" on a perfectly good load.
    _idForPort(port) {
        const wanted = Number(port);
        for (const id in this.ports) {
            if (Number(this.ports[id]) !== wanted) continue;
            const record = this.children && this.children[id];
            const child = record && record.server && record.server.child;
            if (child && child.pid) return id;
        }
        return null;
    }

    // The tail of a child's stderr, kept so a failed load can report the loader's own message
    // through the front door instead of only "health timeout".
    _stderrTail(id) {
        const record = this.children && this.children[id];
        return record && record.stderrTail ? String(record.stderrTail.text || "").trim() : "";
    }

    _waitForIdleTimeoutMs() {
        // An explicit millisecond cap (tests and advanced callers) wins over the option's
        // seconds. 0 is meaningful here: it disables the wait. Anything else that is not a
        // non-negative number falls through to the option.
        const rawMs = this.config.waitForIdleTimeoutMs;
        if (rawMs !== undefined && rawMs !== null) {
            const ms = Number(rawMs);
            if (isFinite(ms) && ms >= 0) return ms;
        }
        // `runtimeWaitIdleSeconds`: empty or invalid uses the shipped 30 minutes; 0 disables the
        // wait. Only a non-negative number is accepted.
        const rawSeconds = this.config.waitIdleSeconds;
        const seconds = (rawSeconds === "" || rawSeconds === null || rawSeconds === undefined)
            ? NaN : Number(rawSeconds);
        if (isFinite(seconds) && seconds >= 0) return seconds * 1000;
        return 30 * 60 * 1000;
    }

    // Wait until no request is being proxied to `id`. The front door's per-model count is
    // authoritative, so this polls it until it reaches 0. The wait is bounded by the configured
    // cap: on a cap hit it logs a warning and resolves anyway, so the pool evicts and the switch
    // completes rather than hanging on a wedged request. It never rejects - the pool's start
    // must always be allowed to proceed.
    _waitForIdle(id) {
        const self = this;
        if (!this.frontDoor || typeof this.frontDoor.activeRequests !== "function") return Promise.resolve();
        if (this.frontDoor.activeRequests(id) === 0) return Promise.resolve();
        const timeoutMs = this._waitForIdleTimeoutMs();
        // 0 disables the wait: the switch evicts at once, truncating any running generation.
        if (timeoutMs <= 0) return Promise.resolve();
        return new Promise(function (resolve) {
            const started = Date.now();
            function tick() {
                const active = (self.frontDoor && typeof self.frontDoor.activeRequests === "function")
                    ? self.frontDoor.activeRequests(id) : 0;
                if (active === 0) { resolve(); return; }
                if (Date.now() - started >= timeoutMs) {
                    self.log("waitForIdle timeout for " + id + ": " + active +
                        " request(s) still in flight after " + timeoutMs + " ms; evicting anyway");
                    resolve();
                    return;
                }
                const timer = setTimeout(tick, WAIT_FOR_IDLE_POLL_MS);
                if (timer && typeof timer.unref === "function") timer.unref();
            }
            const timer = setTimeout(tick, WAIT_FOR_IDLE_POLL_MS);
            if (timer && typeof timer.unref === "function") timer.unref();
        });
    }

    async start(models, opts) {
        if (this.state.status === "starting" || this.state.status === "ready") {
            throw new Error(`Runtime is already ${this.state.status}`);
        }
        const token = ++this._startSeq;
        let attemptedBackend = null;
        // A restart starts from a clean policy state: no timer from a previous run, no stale
        // use times or cached child documents.
        this._stopIdleTimer();
        this._lastUsed = {};
            this._childProps = {};
            this._reasoningCaps = {};
            this._set({ status: "starting", error: null, note: null });
        let door = null;
        let pool = null;
        try {
            const payload = this.resolvePayload();
            const bad = this.verifyPayload(payload);
            if (bad.length) throw new Error(`Runtime payload is corrupted: ${bad.join(", ")}`);
            const installed = payload.manifest.platforms[this.config.platformKey].backends;
            const packFileNames = (payload.packs && payload.packs.files)
                ? Object.keys(payload.packs.files) : null;
            const preference = (opts && opts.forceCpu) ? "cpu" : this.config.backendPreference;
            // The library folder the probe and the server children run with: the user's extra
            // folder when set, possibly widened by the standard HIP SDK location probe below.
            let effectiveLibDir = this.config.libDir || null;
            // The device probe must run with the same library search path as the spawned
            // server children, or a backend whose libraries live in that folder stays
            // invisible to the selection even though the model server itself would have
            // loaded it fine.
            const envFor = (libDir) => buildSpawnEnv(libDir, this._platform) || undefined;
            // The probe returns { stdout, stderr } in production: the device list prints on
            // stdout, but a backend DLL that fails to load reports on stderr, which is the
            // single most useful line when a pack is installed yet finds no device. A plain
            // string (tests, older callers) is accepted and treated as stdout-only.
            let probe = await this.listDevices(payload.serverBinary, envFor(effectiveLibDir));
            let rawDevices = typeof probe === "string" ? probe : String((probe && probe.stdout) || "");
            let probeStderr = typeof probe === "string" ? "" : String((probe && probe.stderr) || "");
            let devices = parseDeviceList(rawDevices);
            this._assertLive(token);
            // The Windows HIP SDK never adds its bin folder to the PATH, so a correctly
            // installed ROCm pack still finds no device when this process lacks the folder.
            // Probe the standard install location once and adopt it for this start - the
            // probe AND the server children - when it holds a usable SDK, instead of failing
            // (explicit rocm) or silently staying on a lower-priority backend (auto). The
            // adoption is always logged, so a "Backend: rocm" can be traced to the folder
            // that made it possible.
            let autoLibDir = null;
            if (rocmAutoProbeApplies({
                platform: this._platform, libDir: this.config.libDir,
                installed, devices, preference
            })) {
                const candidates = this.standardLibDirs
                    ? this.standardLibDirs({ packGeneration: rocmPackGeneration(packFileNames) })
                    : [];
                if (candidates.length) {
                    autoLibDir = candidates[0];
                    this.log("no ROCm device detected; retrying the device probe with the HIP SDK found at " + autoLibDir);
                    effectiveLibDir = autoLibDir;
                    this._assertLive(token);
                    probe = await this.listDevices(payload.serverBinary, envFor(effectiveLibDir));
                    rawDevices = typeof probe === "string" ? probe : String((probe && probe.stdout) || "");
                    probeStderr = typeof probe === "string" ? "" : String((probe && probe.stderr) || "");
                    devices = parseDeviceList(rawDevices);
                } else {
                    this.log("no ROCm device detected, and no usable HIP SDK in the standard install location");
                }
            }
            const selection = selectBackend({
                installedBackends: installed,
                devices,
                preference: preference
            });
            // Detection used to be invisible: when it found nothing, the start went to CPU and
            // nothing recorded why. Log what was seen and why the choice was made, so a
            // "Backend: cpu" on a machine with a working GPU can be diagnosed from the log.
            this.log("devices: " + (devices.length
                ? devices.map(function (d) { return d.token + " " + d.name + " " + d.memoryMiB + " MiB"; }).join("; ")
                : "(none detected)") +
                " -> backend " + selection.backend + " (" + selection.reason + ")" +
                (opts && opts.forceCpu ? " [CPU forced]" : "") +
                (autoLibDir ? " [HIP SDK: " + autoLibDir + "]" : ""));
            // When the device probe printed something that parsed to nothing, the format has
            // drifted (or the output went to stderr): show the raw text, or the "none detected"
            // line above would hide the actual output from whoever is diagnosing the machine.
            if (!devices.length && rawDevices.trim()) {
                this.log("--list-devices output could not be parsed:\n" + rawDevices.trim());
            }
            // Backend load failures travel on the probe's stderr even when OTHER backends
            // listed fine. With nothing detected, stderr is where the reason lives; surface
            // it so automatic mode's CPU fallback is explainable too.
            if (!devices.length && probeStderr.trim()) {
                this.log("the device probe reported on stderr:\n" + probeStderr.trim());
            }
            // A specific backend was picked and cannot be used: the start ends here with the
            // reason instead of silently running on another backend. Only automatic mode
            // (no preference) falls through the priority order.
            if (!selection.backend) {
                let message = strictBackendError(preference, selection.reason, installed, devices);
                const detail = backendFailureDetail(preference, selection.reason, probeStderr, packFileNames);
                if (detail) message += "\n" + detail;
                if (autoLibDir) {
                    message += "\nThe HIP SDK found at " + autoLibDir + " was probed as well, " +
                        "but still produced no ROCm device.";
                }
                this.log("the requested backend is not usable: " + message);
                throw new Error(message);
            }
            attemptedBackend = selection.backend;
            const device = (devices || []).find((d) => d.token === selection.device) || null;
            // The public port is used exactly or the start fails: scanning forward would
            // publish an address the user did not configure. The same exact-or-fail rule the
            // single router used applies to the front door.
            const port = await this.findFreePort({
                preferred: this.config.port,
                start: 8730, end: 8830, host: this.config.host
            });
            this._assertLive(token);
            // The effective entries (StartConfig already applied every model's profile and the
            // runtime tuning). The size-based load-mode recommendation is resolved here because
            // only now is the selected device known.
            const resolvedModels = this._applyLoadModeForFit(models, selection, device);
            this._selectedDevice = selection.device || null;

            const entryById = {};
            const ids = [];
            for (let i = 0; i < resolvedModels.length; i++) {
                const entry = resolvedModels[i];
                if (entry && entry.id) { entryById[entry.id] = entry; ids.push(entry.id); }
            }
            this._defaultId = (opts && opts.defaultId) ? String(opts.defaultId) : (ids[0] || "");

            const self = this;
            const host = this.config.host;
            // The children run with the same library folder the (possibly retried) device
            // probe saw: the user's extra folder, or the standard HIP SDK location the
            // auto-probe adopted.
            const spawnEnv = buildSpawnEnv(effectiveLibDir, this._platform);
            const ports = this.ports = {};
            const children = this.children = {};
            const exitDeferred = this._exitDeferred = this._newExitDeferred();

            pool = ModelPool.createModelPool({
                host: host,
                maxLoaded: function () { return self.config.modelsMax; },
                planStart: EvictionPolicy.planStart,
                // A switch never aborts the outgoing model's in-flight generation: the pool
                // waits for it to drain, bounded by waitForIdleTimeoutMs, before evicting.
                waitForIdle: function (id) { return self._waitForIdle(id); },
                // Production wiring: Ports.resolvePort for a free internal port.
                freePort: function () {
                    return self.findFreePort({ start: 8730, end: 8830, host: host });
                },
                // Production wiring: RouterClient.waitForHealth against the child's own port. The
                // pool passes the id it just spawned; the port lookup is only a fallback.
                healthWait: function (childPort, childId) {
                    const id = childId || self._idForPort(childPort);
                    const record = id ? self.children[id] : null;
                    const client = self.createRouter("http://" + host + ":" + childPort);
                    // A large model can take several minutes to load from a cold disk: the
                    // engine's fit alone runs for seconds, then every tensor is read. The
                    // health timeout is therefore a chunk budget, not the whole budget - as
                    // long as the child process is still alive it is still loading, so keep
                    // waiting. A single 120 s wait killed healthy slow loads, and the start
                    // then fell back to CPU: "Backend: cpu" on machines with a working GPU,
                    // plus the whole model read from disk twice. A child that exits still
                    // fails the load at once (the exited race below, with its exit reason),
                    // and the hard cap stops a wedged child from hanging the start forever.
                    const CHUNK_MS = 120000;
                    const HARD_CAP_MS = self.healthHardCapMs;
                    const startedAt = Date.now();
                    const alive = function () {
                        return !((record && record.server && record.server.running === false));
                    };
                    let firstError = null;
                    const ready = (async function () {
                        for (;;) {
                            if (Date.now() - startedAt > HARD_CAP_MS) {
                                throw new Error("llama-server did not become healthy within " +
                                    Math.round((Date.now() - startedAt) / 1000) + " s (last: " +
                                    (firstError ? firstError.message : "waiting") + ")");
                            }
                            try {
                                return await self.waitForHealth(client, { timeoutMs: CHUNK_MS });
                            } catch (err) {
                                if (!firstError) firstError = err;
                                if (!alive()) throw err;
                                // Still running: it is loading. Wait another chunk.
                            }
                        }
                    })();
                    // A child that exits before becoming healthy fails the load at once instead
                    // of waiting out the health timeout; a short pause lets its final stderr
                    // flush so the tail is in hand when the error is built. The child's own
                    // stderr travels with the error IN FULL (message + err.stderrTail) - a
                    // trimmed version of the server's account of its own death hides exactly
                    // the line that names the cause, so a failed start shows WHY it died.
                    const exited = (record && record.server && record.server.exitPromise)
                        ? record.server.exitPromise.then(function (result) {
                            return new Promise(function (resolve) { setTimeout(resolve, 150); }).then(function () {
                                const tail = record && record.stderrTail ? String(record.stderrTail.text || "").trim() : "";
                                const err = new Error("llama-server exited before becoming healthy" +
                                    (result && result.code != null ? " (exit code " + result.code + ")" : "") +
                                    (result && result.signal ? " (signal " + result.signal + ")" : "") +
                                    (tail ? "\n" + tail : ""));
                                err.stderrTail = tail;
                                throw err;
                            });
                        })
                        : new Promise(function () {});
                    return Promise.race([ready, exited]).then(function (res) {
                        // Best effort: capture the running child's own /props so a /props read
                        // through the front door can answer with the instance's real document
                        // (and its chat template). Never fail a load over this - an older build
                        // without --jinja may not expose it.
                        if (id && typeof client.props === "function") {
                            return Promise.resolve().then(function () { return client.props(); })
                                .then(function (props) {
                                    if (props && typeof props === "object" && !Array.isArray(props)) {
                                        self._childProps[id] = props;
                                        // Reasoning capabilities are a per-model fact read from
                                        // the child itself, at the same capture as the template:
                                        // which template features it advertises, and which effort
                                        // values its own validator accepts.
                                        self._reasoningCaps[id] = ReasoningCaps.fromProps(props);
                                    }
                                    if (props && typeof props.chat_template === "string") {
                                        self._chatTemplates[id] = props.chat_template;
                                    }
                                    return res;
                                }, function () { return res; });
                        }
                        return res;
                    });
                },
                spawnChild: function (poolArgs) {
                    // The pool emitted { host, port }; read the model id and the internal port
                    // back out and rebuild the full argv with the manager's globals.
                    const id = argValue(poolArgs, "--alias");
                    const childPort = Number(argValue(poolArgs, "--port"));
                    const entry = entryById[id];
                    const args = ModelArgs.buildModelArgs(entry, self._globals(childPort, self._selectedDevice));
                    // A previous attempt for this id (normally a failed load) may still leave a
                    // record with its stderr tail. The fresh child must not inherit it, and the
                    // old child's cached /props must not be served for the new instance; its
                    // reasoning capabilities must die with them, or the new instance would be
                    // judged by its predecessor's facts.
                    delete children[id];
                    delete self._chatTemplates[id];
                    delete self._childProps[id];
                    delete self._reasoningCaps[id];
                    // Keep the tail of the child's own stderr. A load failure reports this
                    // VERBATIM to the client ("<id> failed to load: <this>"), and the
                    // start-retry parser reads the fit's decision lines out of it - those print
                    // EARLY in the load (before the multi-KB metadata dump), so the window must
                    // span from them to the child's death (a real failed start measured
                    // ~19 KB; large MoE dumps run bigger, hence the 256 KiB bound). stderr
                    // only; stdout is not an error channel.
                    const stderrTail = { text: "" };
                    const server = self.createServer({
                        serverBinary: payload.serverBinary, args: args, cwd: payload.dir, env: spawnEnv,
                        onLog: function (stream, text) {
                            if (stream !== "stderr") return;
                            stderrTail.text = (stderrTail.text + String(text || "")).slice(-262144);
                        }
                    });
                    server.start();
                    ports[id] = childPort;
                    children[id] = { server: server, args: args, port: childPort, stderrTail: stderrTail };
                    self._lastChildId = id;
                    // The child the compatibility `server` handle reports: its pid is the pid the
                    // console records for orphan recovery.
                    self._activeServer = server;
                    const adapter = {
                        pid: server && server.child ? server.child.pid : null,
                        server: server,
                        onExit: null,
                        killed: false,
                        kill: function (opts) {
                            adapter.killed = true;
                            if (self._activeServer === server) self._activeServer = null;
                            try {
                                const stopping = server.stop(opts);
                                if (stopping && typeof stopping.catch === "function") stopping.catch(function () {});
                            } catch (err) { /* best effort */ }
                        },
                        killSync: function () {
                            adapter.killed = true;
                            if (self._activeServer === server) self._activeServer = null;
                            try { if (server && typeof server.killNow === "function") server.killNow(); }
                            catch (err) { /* best effort */ }
                        }
                    };
                    // A real child's own exit must reach the pool (removing it from `loaded`) and
                    // settle the compatibility exitPromise once nothing is loaded and nothing is
                    // starting, which is the "the server died" signal the console watches.
                    if (server.exitPromise && typeof server.exitPromise.then === "function") {
                        server.exitPromise.then(function (result) {
                            if (adapter.onExit) adapter.onExit();
                            if (self._activeServer === server) self._activeServer = null;
                            // Drop the dead child's port mapping so a later child that reuses the
                            // port is the one _idForPort resolves.
                            if (self.ports[id] === childPort) delete self.ports[id];
                            // The dead child's cached documents are no longer valid. A newer child
                            // that already replaced this id keeps its own cache.
                            if (!self.children[id] || self.children[id].server === server) {
                                delete self._chatTemplates[id];
                                delete self._childProps[id];
                                delete self._reasoningCaps[id];
                                delete self._lastUsed[id];
                            }
                            // A deliberately killed child (the pool evicted it or cleaned up a
                            // failed load) must never settle the compatibility exitPromise: the
                            // runtime is not dead, and the console watching that promise would
                            // otherwise stop the whole runtime and make the failure unretryable.
                            if (!adapter.killed && self.state.status === "ready" && self.pool &&
                                self.pool.loadedIds().length === 0 && !self.pool.busy()) {
                                self._resolveExit(result);
                            }
                        }, function () { /* an exit error is not a start failure */ });
                    }
                    return adapter;
                }
            });

            door = FrontDoor.createFrontDoor({
                host: host,
                port: port,
                getModels: function () { return ids.slice(); },
                ensureModel: function (id) {
                    // Every request routed to a loaded model is its last use; the idle-unload
                    // sweep stops a child that has gone longer than sleepIdleSeconds without one.
                    self._touchUse(id);
                    return pool.ensure(id, entryById[id]).catch(function (err) {
                        // Surface the failed child's own stderr, in full. The front door turns
                        // this into "<id> failed to load: <message>", and the retained tail is
                        // the server's own account of why it died - cutting it to an excerpt
                        // hides the line that names the cause.
                        const tail = self._stderrTail(id);
                        const wrapped = new Error(tail ||
                            (err && err.message) || "failed to load");
                        wrapped.cause = err;
                        wrapped.stderrTail = tail;
                        throw wrapped;
                    });
                },
                // Read-only: must never start a model as a side effect of a status read.
                loadedPort: function (id) {
                    if (pool.loadedIds().indexOf(id) === -1) return null;
                    return ports[id] === undefined ? null : ports[id];
                },
                defaultId: function () { return self._defaultId; },
                // Per-model reasoning capabilities derived from each loaded child's own /props.
                // The front door reads these to decide how a request asking for reasoning is
                // honoured; the safe default (no effort support) applies to anything unknown.
                capsFor: function (id) { return self.capsFor(id); },
                getProps: function (id) {
                    // While the model is loaded, answer with its own /props, captured from its
                    // port when it became healthy: llama.cpp may adjust n_ctx from the value we
                    // requested, and clients must be told the real one. Only an unloaded model
                    // (or a child that never exposed /props) falls back to the configured entry.
                    if (pool.loadedIds().indexOf(id) !== -1 && self._childProps[id]) {
                        return self._childProps[id];
                    }
                    const props = RuntimeInfo.buildProps(entryById[id], { totalSlots: 1 });
                    // The loaded child's own template, captured when it became healthy, so
                    // readTemplate can read it through the front door's /props.
                    const template = self._chatTemplates[id];
                    if (typeof template === "string" && template) props.chat_template = template;
                    return props;
                },
                getModelsList: function () {
                    return RuntimeInfo.buildModelsList(resolvedModels, pool.loadedIds());
                }
            });

            // Publish the handles BEFORE the awaits. A stop() arriving while the door is starting
            // or a model is loading can then tear them down; because the front door may still be
            // in listen(), its stop is deferred to the start routine's cancellation path.
            this.pool = pool;
            this.frontDoor = door;
            this.server = this._makeServerHandle(exitDeferred);
            this._doorStarting = true;
            try {
                await door.start();
            } finally {
                this._doorStarting = false;
            }
            this._assertLive(token);

            // Preload the selected (default) model, exactly as the old router loaded a model at
            // start. A request for another model evicts it under `models kept loaded`. A failure
            // here (health timeout, child exit) rejects the start and the catch below tears the
            // door and any child down, so a failed start leaves nothing running. A stop() landing
            // mid-load cancels the pool child and the token check below aborts the start.
            const defaultEntryId = entryById[this._defaultId] ? this._defaultId : (ids[0] || null);
            if (defaultEntryId) {
                await pool.ensure(defaultEntryId, entryById[defaultEntryId]);
                // The preloaded model counts as just used, so idle unload does not stop it the
                // moment the sweep first runs.
                this._touchUse(defaultEntryId);
            }
            this._assertLive(token);

            const baseUrl = `http://${this.config.host}:${port}`;
            this.client = this.createRouter(baseUrl);
            // Arm the idle-unload policy for this run (a no-op when sleepIdleSeconds is 0).
            this._startIdleTimer();
            return this._set({
                status: "ready", backend: selection.backend, device: selection.device,
                // Why this backend was chosen ("device-available:vulkan", "cpu-fallback", ...).
                // describeStatus's callers could never explain a "Backend: cpu" before, because
                // the reason was computed and then dropped.
                backendReason: selection.reason,
                port, baseUrl, models: ids, error: null,
                // A successful start is always owned by this window. Setting ownership here (as
                // well as in stop and the error path) means a previous attach cannot leak its
                // attached/owner flags into an owned run through Object.assign's merge.
                attached: false, owner: null,
                // Which load modes were chosen for this start, so the caller can report them.
                loadModes: this._pendingLoadModes || {},
                // Size of the selected card, so the caller can sanity-check any placement it
                // reads back from the server's log against what can physically fit.
                deviceMemoryMiB: device ? device.memoryMiB : null,
                // The front door is up, with the selected model preloaded. Other models load on
                // demand and are evicted by `models kept loaded`.
                frontDoor: true,
                loadedModels: pool.loadedIds()
            });
        } catch (err) {
            // A failed start is a diagnostic event in its own right: log it even though the
            // error also travels to the caller, so the console carries the failure even when
            // nobody is watching the status field. A deliberate stop landing mid-start is not
            // a failure and must not read as one.
            if (!err || !err.cancelled) {
                this.log("start failed: " + String((err && err.message) || err));
            }
            // Idempotent cleanup: a concurrent stop() may already have torn these down.
            this._stopIdleTimer();
            if (pool) { try { pool.stopAll(); } catch (e) { /* best effort */ } }
            if (door) {
                try { await door.stop(); } catch (e) { /* best effort */ }
            }
            if (this.pool === pool) this.pool = null;
            if (this.frontDoor === door) this.frontDoor = null;
            this._activeServer = null;
            this.server = null;
            this.client = null;
            this.children = {};
            this.ports = {};
            this._chatTemplates = {};
            this._childProps = {};
            this._reasoningCaps = {};
            this._lastUsed = {};
            this._lastChildId = null;
            this._defaultId = "";
            this._resolveExit();
            // Only report the error if this start is still the current one; a stop() that
            // cancelled it already reported "stopped".
            if (this._startSeq === token) {
                this._set({
                    status: "error", error: String((err && err.message) || err), backend: attemptedBackend,
                    attached: false, owner: null
                });
            }
            throw err;
        }
    }

    // The compatibility `server` handle: the console/app read `child` (for the pid to record) and
    // watch `exitPromise` for a server death. `child` is the currently loaded model child, and
    // `exitPromise` settles when the last loaded child exits or the runtime is torn down.
    _makeServerHandle(exitDeferred) {
        const self = this;
        return {
            opts: {},
            get child() { return self._activeServer ? self._activeServer.child : null; },
            get modelBuffers() { return self._modelBuffers(); },
            get fitReport() { return self._fitReport(); },
            get exitPromise() { return exitDeferred.promise; },
            // stop({ timeoutMs }) is honoured: the grace reaches every child's own stop (see
            // ModelPool.killChild), so a caller that budgets a short shutdown gets it.
            stop: function (opts) { return self._teardown(opts); }
        };
    }

    // Stop the front door and every model child. Ownership rules are unchanged: an attached
    // runtime has neither a door nor a pool here, so nothing it does not own is ever stopped.
    // Also cancels any in-flight start via the sequence bump. `opts` (optional `{ timeoutMs }`)
    // is the stop grace handed to every child, so `server.stop({ timeoutMs })` is honoured.
    async _teardown(opts) {
        this._startSeq++;
        this._stopIdleTimer();
        const pool = this.pool;
        if (pool) {
            this.pool = null;
            try { pool.stopAll(opts); } catch (err) { /* best effort */ }
        }
        const door = this.frontDoor;
        if (door && !this._doorStarting) {
            // Only close a door whose listen() has settled: closing mid-listen would leave the
            // start promise pending forever. A door still starting is closed by the start's
            // cancellation path after listen() completes.
            this.frontDoor = null;
            try { await door.stop(); } catch (err) { /* best effort */ }
        }
        this._activeServer = null;
        this.children = {};
        this.ports = {};
        this._chatTemplates = {};
        this._childProps = {};
        this._reasoningCaps = {};
        this._lastUsed = {};
        this._lastChildId = null;
        this._defaultId = "";
        this.server = null;
        this.client = null;
        this._resolveExit();
    }

    // Synchronous child kill for process-exit paths that cannot await the door. The async
    // pool stop is still issued (it does the bookkeeping), but the sync pass is what can
    // actually complete during exit, so no llama-server - loaded or mid-load - outlives it.
    stopAllChildren() {
        if (this.pool) {
            try { this.pool.stopAll(); } catch (err) { /* best effort */ }
            try { if (typeof this.pool.stopAllSync === "function") this.pool.stopAllSync(); } catch (err) { /* best effort */ }
        }
    }

    // What the loaded child for this model can do about reasoning, derived from the child's own
    // /props when it became healthy. A model that is not loaded, or whose /props never arrived,
    // reports no effort support: the safe direction, because the request is then honoured through
    // the chat-template channel every supporting template reads. Never throws, never undefined.
    capsFor(id) {
        const caps = id ? this._reasoningCaps[id] : null;
        return caps || { supportsEffort: false, supportsPreserve: false, efforts: null };
    }

    // The pids of every currently loaded model child, in pool (LRU) order. The console records
    // them so a --stop that finds the launcher already dead can stop all of them, not just the
    // one the compatibility `server` handle reports. Empty when nothing is loaded or stopped.
    loadedChildPids() {
        const ids = this.pool ? this.pool.loadedIds() : [];
        const out = [];
        for (let i = 0; i < ids.length; i++) {
            const record = this.children && this.children[ids[i]];
            const child = record && record.server && record.server.child;
            const pid = child && child.pid;
            if (typeof pid === "number" && pid > 0) out.push(pid);
        }
        return out;
    }

    async stop() {
        await this._teardown();
        return this._set({
            status: "stopped", backend: null, device: null,
            port: null, baseUrl: null, models: [], error: null,
            // Stopping is a full ownership reset, so a later start cannot inherit an old attach.
            attached: false, owner: null,
            frontDoor: false, loadedModels: []
        });
    }
}

module.exports = { RuntimeManager, DEFAULT_CONFIG, buildSpawnEnv, argValue };
