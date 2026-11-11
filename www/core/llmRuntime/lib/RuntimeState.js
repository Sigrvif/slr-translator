// www/core/llmRuntime/lib/RuntimeState.js
"use strict";
const nwPath = require("path");

// Where a running runtime records that it is running, so a second starter can find it instead
// of loading a duplicate model. On a small card two resident copies of the same model exhaust
// VRAM and leave both slow, so "start a second one" is never the helpful answer.
//
// The record is a PID rather than a lock file because an unclean exit has to be recoverable:
// a stale record is detected by asking whether the process still exists, which a lock file
// cannot answer.
const STATE_VERSION = 1;

function statePath(dataDir) {
    return nwPath.join(dataDir, "runtime.json");
}

function readState(opts) {
    const path = opts.path;
    const fs = opts.fs;
    try {
        if (!fs.existsSync(path)) return null;
        const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed;
    } catch (err) {
        return null;
    }
}

function writeState(opts) {
    const state = Object.assign({ version: STATE_VERSION }, opts.state);
    try {
        opts.fs.writeFileSync(opts.path, JSON.stringify(state), "utf8");
    } catch (err) { /* the caller reports; an unwritable state file is not fatal to serving */ }
    return state;
}

function clearState(opts) {
    try {
        if (opts.fs.existsSync(opts.path)) opts.fs.unlinkSync(opts.path);
    } catch (err) { /* already gone */ }
}

// Signal 0 tests for existence without delivering a signal. EPERM means the process is there
// but owned by someone else - that still counts as alive, or a shared machine would start a
// second server.
function isProcessAlive(pid, killFn) {
    // An actual positive integer number, not something that merely coerces to one. The state
    // file is user-writable and its pid is later used to signal a process, so "4242", true or
    // [5] must not be accepted: on this engine isProcessAlive(true) would probe pid 1.
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
    const kill = killFn || process.kill;
    try {
        kill(pid, 0);
        return true;
    } catch (err) {
        return !!(err && err.code === "EPERM");
    }
}

// Whether a recorded runtime is really serving. Three independent checks, because the state
// file is just a file: the PID must exist, /health must answer, and the model the record names
// must actually be in /v1/models. A file left behind by a crash fails the second and third.
async function isRuntimeLive(state, opts) {
    const options = opts || {};
    if (!state || typeof state !== "object") return false;
    if (!state.baseUrl || !state.pid) return false;
    // Without a usable model id the /v1/models comparison below would degenerate and could be
    // satisfied vacuously (e.g. a stub entry with no id). Require a non-empty string, as strict
    // as RouterClient.selectModelStatus.
    if (typeof state.modelId !== "string" || state.modelId === "") return false;
    const verify = options.verifyProcess || (() => isProcessAlive(state.pid));
    if (!verify()) return false;
    const http = options.http;
    if (!http) return false;
    try {
        const health = await http.get(state.baseUrl.replace(/\/+$/, "") + "/health");
        // Two response shapes are in use in this tree: RouterClient.waitForHealth reports `status`,
        // while the editor's httpAdapter reports `statusCode`. Accept either, so a 5xx from a
        // runtime that is erroring or still loading is not read as live. A response that carries
        // neither field is not a failure here; the process and model checks below must still agree.
        const code = health && (health.statusCode != null ? health.statusCode : health.status);
        if (code != null && Number(code) >= 400) return false;
    } catch (err) {
        return false;
    }
    try {
        const res = await http.get(state.baseUrl.replace(/\/+$/, "") + "/v1/models");
        const list = (res && res.body && res.body.data) || [];
        // Only string ids participate. A malformed entry (id missing or not a string) must be
        // skipped rather than compared, or it could match a degenerate stem.
        const ids = list.map((m) => m && m.id).filter((id) => typeof id === "string");
        // A router can list one file under two names, so compare on the stem as the editor's
        // selectModelStatus does, rather than requiring an exact match.
        const stem = (s) => String(s || "").replace(/\.gguf$/i, "");
        return ids.some((id) => stem(id) === stem(state.modelId));
    } catch (err) {
        return false;
    }
}

module.exports = { STATE_VERSION, statePath, readState, writeState, clearState, isProcessAlive, isRuntimeLive };
