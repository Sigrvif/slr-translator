"use strict";
const childProcess = require("child_process");

// How much of the model went into each memory buffer, from the loader's own per-buffer report.
// This is the only ground truth for placement: the "offloaded N/M layers to GPU" line counts
// LAYERS, and a Mixture-of-Experts model can have every layer assigned to the GPU while its
// expert tensors sit in host memory. Verified on a machine with no GPU at all, which still
// reports "offloaded 33/33 layers to GPU" while the whole model is in a CPU_Mapped buffer.
//
// A buffer is only VRAM when its name is neither the CPU's nor the backend's HOST buffer type.
// ggml names the latter "<Backend>_Host" - libggml-vulkan.so contains "Vulkan_Host", and CUDA
// and ROCm follow the same shape - and that is system RAM the backend can address, not VRAM.
// Counting it as GPU is what made a 18.4 GiB model on an 8 GiB card read as "18.9 GiB on GPU".
//
// A draft model loads as a second model in the same child process and opens its own buffer
// block. Its totals must be attributed separately instead of resetting the one running pair,
// or the status line would report the draft's much smaller placement as the whole model's.
const MODEL_BUFFER_RE = /load_tensors:\s+(\S+)\s+model buffer size\s*=\s*([\d.]+)\s*MiB/;
const LOAD_START_RE = /load_tensors:\s+loading model tensors/;
const HOST_BUFFER_RE = /cpu|host/i;
const REPACK_BUFFER_RE = /repack/i;

// Which model a buffer line belongs to. The engine announces the draft immediately before its
// own buffer block; every other load is the target. Order is not assumed: the draft may load
// before or after the target.
const DRAFT_ANNOUNCE_RE = /loading draft model '/;

function newModelBuffers() {
    return {
        target: { gpuMiB: 0, cpuMiB: 0, found: false },
        draft: { gpuMiB: 0, cpuMiB: 0, found: false },
        // Set by the announcement, consumed by the next load. The chosen model then persists
        // for that whole buffer block; a per-line "current" flag would be wrong, because the
        // load line clears it before the block's buffer lines arrive.
        _pendingDraft: false,
        _current: "target"
    };
}

// Fold one log line into the running per-model totals. A fresh load resets only the model it
// belongs to, so a draft cannot wipe the target's numbers. "REPACK" is skipped: it is a
// repacked copy of weights already counted, not extra model.
function applyModelBufferLine(state, line) {
    if (DRAFT_ANNOUNCE_RE.test(line)) { state._pendingDraft = true; return; }
    if (LOAD_START_RE.test(line)) {
        state._current = state._pendingDraft ? "draft" : "target";
        state._pendingDraft = false;              // the announcement belongs to this load only
        const s = state[state._current];
        s.gpuMiB = 0;
        s.cpuMiB = 0;
        s.found = false;
        return;
    }
    const m = MODEL_BUFFER_RE.exec(line);
    if (!m) return;
    if (REPACK_BUFFER_RE.test(m[1])) return;
    const s = state[state._current];
    if (HOST_BUFFER_RE.test(m[1])) s.cpuMiB += Number(m[2]);
    else s.gpuMiB += Number(m[2]);
    s.found = true;
}

// The shape the status line consumes: the target's numbers flattened, plus the draft's.
function flattenModelBuffers(state) {
    const t = state.target;
    const d = state.draft;
    return {
        gpuMiB: t.gpuMiB, cpuMiB: t.cpuMiB, found: t.found,
        draft: { gpuMiB: d.gpuMiB, cpuMiB: d.cpuMiB, found: d.found }
    };
}

// Whether one model's parsed split is physically possible on the card that was selected. More
// model in the "GPU" buffers than the card can hold means the buffer names were not what this
// code assumed, so the split must not be shown. This is the guard that would have caught a
// backend host buffer being counted as VRAM before it reached the status line.
function modelPlacementPossible(model, vramMiB) {
    if (!model || !model.found) return false;
    const vram = Number(vramMiB);
    if (!isFinite(vram) || vram <= 0) return true;  // unknown card: no basis to doubt the split
    return model.gpuMiB <= vram * 1.05;
}

// Whether a parsed buffer split is physically possible on the card that was selected. The
// target and the draft load as separate models in one child process, so each is checked against
// the card on its own: a draft larger than the card is exactly the mis-parse the target guard
// exists for, and checking only the flattened top level would leave it unchecked.
function placementLooksPossible(buffers, vramMiB) {
    if (!modelPlacementPossible(buffers, vramMiB)) return false;
    const draft = buffers.draft;
    if (draft && draft.found && !modelPlacementPossible(draft, vramMiB)) return false;
    return true;
}

// The same per-model guard, applied the way the status line needs it. The target decides
// whether a split is shown at all, but an implausible draft is dropped on its own rather than
// hiding a valid target split with it: return null when the target is not plausible, otherwise
// the object with an implausible draft's `found` cleared so only its line disappears.
function sanitiseBuffers(buffers, vramMiB) {
    if (!modelPlacementPossible(buffers, vramMiB)) return null;
    const draft = buffers.draft;
    if (draft && draft.found && !modelPlacementPossible(draft, vramMiB)) {
        return {
            gpuMiB: buffers.gpuMiB, cpuMiB: buffers.cpuMiB, found: buffers.found,
            draft: { gpuMiB: draft.gpuMiB, cpuMiB: draft.cpuMiB, found: false }
        };
    }
    return buffers;
}

// --- Engine fit report ------------------------------------------------------------------
//
// llama.cpp's --fit decides the layer split by MEASURING candidate placements (a metadata-only
// dry build per candidate) against the device's actual free memory minus the target margin,
// and prints its whole decision at trace verbosity - which the runtime always requests. The
// Offload lines show the outcome; these lines are the reasoning behind it: how much memory the
// device really had free, what the full model measured, and what was placed. Captured as raw
// lines rather than parsed into numbers, so the wording the user sees is the engine's own and
// cannot drift from it.
const FIT_LINE_RE = /common_params_fit_impl/;
// The decisive lines, out of the many a layer search prints. Trial measurements ("id=0,
// n_layer=..") are skipped; these are the summary and decision lines.
const FIT_DECISIVE_RES = [
    /projected to use \d+ MiB of (?:device|host) memory vs/,
    /will leave \d+ >= \d+ MiB of (?:free device|system) memory/,
    /cannot meet free memory target/,
    /entire model can be fit by reducing context/,
    /with only dense weights in device memory there/,
    /- .+: +\d+ layers?(?: \(\d+ overflowing\))?, +\d+ MiB used, +\d+ MiB free$/
];
// What the loader actually counted: the per-model "offloaded N/M layers" line. The status
// card echoes the requested count, so when the request and the loader disagree (a flag that
// never reached the child, an 'all' that fell back), this line is the arbiter. Entries carry
// the model they belong to (the ingest loop knows the current buffer block) and the parsed
// numbers, so the renderer can phrase assignment without re-parsing.
const OFFLOADED_RE = /load_tensors:\s+offloaded (\d+)\/(\d+) layers to GPU/;
// The per-trial memory breakdown table (total/free/model/context/compute per device) is
// printed once per measurement; only the LAST table - the winning placement - is kept.
const FIT_BREAKDOWN_MAX = 12;

function newFitReport() {
    return { lines: [], offloaded: [], breakdown: [] };
}

function applyFitLine(report, line, currentModel) {
    const text = String(line || "");
    const m = OFFLOADED_RE.exec(text);
    if (m) {
        report.offloaded.push({
            model: currentModel === "draft" ? "draft" : "target",
            n: Number(m[1]),
            m: Number(m[2])
        });
        if (report.offloaded.length > 4) report.offloaded.shift();
        return report;
    }
    if (text.indexOf("common_memory_breakdown_print: |") !== -1) {
        if (text.indexOf("memory breakdown [MiB]") !== -1) {
            report.breakdown.length = 0;
        } else if (report.breakdown.length < FIT_BREAKDOWN_MAX) {
            report.breakdown.push(text.trim());
        }
        return report;
    }
    if (!FIT_LINE_RE.test(text)) return report;
    for (const re of FIT_DECISIVE_RES) {
        if (re.test(text)) {
            const trimmed = text.trim();
            if (report.lines[report.lines.length - 1] !== trimmed) {
                report.lines.push(trimmed);
                if (report.lines.length > 24) report.lines.shift();
            }
            break;
        }
    }
    return report;
}

class ServerProcess {
    constructor(opts) {
        if (!opts || !opts.serverBinary) throw new Error("ServerProcess needs a serverBinary");
        this.serverBinary = opts.serverBinary;
        this.args = opts.args || [];
        this.cwd = opts.cwd;
        // Extra environment for the child (used to point the loader at an out-of-tree GPU
        // library folder). null means "inherit this process's environment".
        this.env = opts.env || null;
        this.spawn = opts.spawn || childProcess.spawn;
        this.killTree = opts.killTree || defaultKillTree;
        this.killTreeSync = opts.killTreeSync || defaultKillTreeSync;
        this.onLog = opts.onLog || function () {};
        this.detached = opts.detached === undefined ? process.platform !== "win32" : opts.detached;
        this.child = null;
        this.exitPromise = null;
        this.exitResult = null;
        // Placement totals, accumulated from the log and attributed per model so a draft's
        // buffer block cannot overwrite the target's. Read through the `modelBuffers` getter.
        this._modelBuffers = newModelBuffers();
        // The engine's own fit decision, as raw log lines (see newFitReport above).
        this._fitReport = newFitReport();
        this._logCarry = "";
    }

    // Buffer lines can be split across reads, so the trailing partial line is carried over.
    _ingestLog(text) {
        const s = this._logCarry + String(text || "");
        const idx = s.lastIndexOf("\n");
        if (idx === -1) {
            this._logCarry = s.slice(-512);
            return;
        }
        const complete = s.slice(0, idx);
        this._logCarry = s.slice(idx + 1).slice(-512);
        for (const line of complete.split("\n")) {
            applyModelBufferLine(this._modelBuffers, line);
            // The offloaded line is attributed like the buffers: it belongs to the block being
            // loaded, which applyModelBufferLine has just updated for this same line.
            applyFitLine(this._fitReport, line, this._modelBuffers._current);
        }
    }

    get running() {
        return this.child !== null;
    }

    // The placement the status line reads: the target's numbers flattened onto the top level
    // (the shape callers already expected), plus the draft's own totals under `draft`.
    get modelBuffers() {
        return flattenModelBuffers(this._modelBuffers);
    }

    // The engine's fit decision, as captured raw lines (see newFitReport).
    get fitReport() {
        return this._fitReport;
    }

    start() {
        if (this.child) throw new Error("llama-server is already running");
        const spawnOptions = {
            cwd: this.cwd,
            detached: this.detached,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        };
        if (this.env) spawnOptions.env = this.env;
        const child = this.spawn(this.serverBinary, this.args, spawnOptions);
        this.child = child;
        this.exitResult = null;
        this._modelBuffers = newModelBuffers();
        this._fitReport = newFitReport();
        this._logCarry = "";
        if (child.stdout) child.stdout.on("data", (d) => { this._ingestLog(d.toString()); this.onLog("stdout", d.toString()); });
        if (child.stderr) child.stderr.on("data", (d) => { this._ingestLog(d.toString()); this.onLog("stderr", d.toString()); });
        this.exitPromise = new Promise((resolve) => {
            child.on("exit", (code, signal) => {
                this.exitResult = { code, signal };
                this.child = null;
                resolve(this.exitResult);
            });
        });
        return child;
    }

    async stop(opts) {
        const timeoutMs = (opts && opts.timeoutMs) || 10000;
        const child = this.child;
        if (!child) return this.exitResult;
        await this.killTree(child, timeoutMs);
        let timer = null;
        await Promise.race([
            this.exitPromise,
            new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs + 1000); })
        ]);
        if (timer) clearTimeout(timer);
        return this.exitResult;
    }

    // Synchronous tree kill for process-exit paths, where no async I/O can run anymore: a
    // normal stop() schedules taskkill through exec and waits on events, none of which
    // completes once the process is exiting. Mid-load or not, the child must die here.
    killNow() {
        const child = this.child;
        if (!child) return;
        try { this.killTreeSync(child); } catch (err) { /* already gone */ }
    }
}

function defaultKillTreeSync(child) {
    const pid = child && child.pid;
    if (typeof pid !== "number" || pid <= 0) return;
    if (process.platform === "win32") {
        try { childProcess.execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" }); }
        catch (err) { /* already gone */ }
        return;
    }
    try { process.kill(-pid, "SIGKILL"); } catch (err) { /* already gone */ }
    try { process.kill(pid, "SIGKILL"); } catch (err) { /* already gone */ }
}

function defaultKillTree(child, timeoutMs) {
    return new Promise((resolve) => {
        const pid = child.pid;
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        if (process.platform === "win32") {
            childProcess.exec(`taskkill /pid ${pid} /T /F`, finish);
            return;
        }
        try { process.kill(-pid, "SIGTERM"); } catch (err) { /* already gone */ }
        const timer = setTimeout(() => {
            try { process.kill(-pid, "SIGKILL"); } catch (err) { /* already gone */ }
            finish();
        }, timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
        child.once("exit", () => { clearTimeout(timer); finish(); });
    });
}

// Expose the pure helpers on the class too, so tests can drive a parser instance directly.
ServerProcess.newModelBuffers = newModelBuffers;
ServerProcess.applyModelBufferLine = applyModelBufferLine;
ServerProcess.flattenModelBuffers = flattenModelBuffers;
ServerProcess.newFitReport = newFitReport;
ServerProcess.applyFitLine = applyFitLine;

module.exports = { ServerProcess, defaultKillTree, applyModelBufferLine, placementLooksPossible, sanitiseBuffers, MODEL_BUFFER_RE, newModelBuffers, flattenModelBuffers, newFitReport, applyFitLine };
