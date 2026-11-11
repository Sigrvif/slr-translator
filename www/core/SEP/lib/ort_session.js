"use strict";
/*
 * ort_session.js — shared ONNX Runtime session factory for SEP.
 *
 * Prefers GPU execution and transparently falls back to CPU:
 *   WebGPU  ->  DirectML (Windows only)  ->  CPU
 *
 * Why WebGPU first: the native WebGPU execution provider is already compiled
 * into the onnxruntime-node library SEP ships (Windows x64 and Linux x64), so
 * enabling it adds no files and no download. It dispatches through Dawn to
 * D3D12 (Windows) or Vulkan (Linux) and works on NVIDIA, AMD, Intel and Apple
 * GPUs alike, without any vendor SDK on the user's machine.
 *
 * Safety: onnxruntime 1.27 crashes at process exit if a WebGPU device was
 * requested but no adapter could be created (observed: segfault after a failed
 * requestAdapter on a machine without Vulkan). We therefore only offer WebGPU
 * after a cheap capability check confirms a GPU/Vulkan stack is present; when
 * the check fails we go straight to CPU. If a session still cannot be created
 * on the preferred provider we retry the next one, and remember the result.
 *
 * The provider list is cached after the first successful session, so every
 * later model in the same run reuses it without probing again.
 */

var ort = require("onnxruntime-node");
var fs = require("fs");
var os = require("os");
var path = require("path");

var _preferGPU = true;
var _resolved = null;        // provider list that worked, e.g. ["webgpu", "cpu"]
var _resolvedLabel = null;   // human-readable name of the active provider

// Let the host disable GPU acceleration before the first session is created.
function setPreferGPU(value) {
    var next = value !== false;
    if (next !== _preferGPU) {
        _preferGPU = next;
        _resolved = null;
        _resolvedLabel = null;
    }
}

function getActiveProvider() {
    return _resolvedLabel;
}

// Which providers the installed onnxruntime-node actually bundles. Returns
// null when the API is unavailable (older runtimes) so callers stay permissive.
function bundledBackends() {
    try {
        var list = ort.listSupportedBackends() || [];
        var set = {};
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].bundled) set[list[i].name] = true;
        }
        return set;
    } catch (e) {
        return null;
    }
}

// The Vulkan loader is detected by looking it up on the standard library
// search paths. Do NOT use process.dlopen() for this: it only accepts Node
// addons and rejects ordinary system libraries with "Module did not
// self-register" even when they are perfectly loadable, which would keep the
// GPU gate shut on every Linux machine.
function findVulkanLoader() {
    var names = ["libvulkan.so.1", "libvulkan.so"];
    var dirs = [
        "/usr/lib", "/usr/lib64", "/lib", "/lib64",
        "/usr/lib/x86_64-linux-gnu", "/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu", "/lib/aarch64-linux-gnu",
        "/usr/local/lib", "/usr/local/lib64"
    ];
    var extra = process.env.LD_LIBRARY_PATH;
    if (extra) {
        var parts = extra.split(":");
        for (var i = 0; i < parts.length; i++) if (parts[i]) dirs.push(parts[i]);
    }
    for (var d = 0; d < dirs.length; d++) {
        for (var n = 0; n < names.length; n++) {
            var candidate = path.join(dirs[d], names[n]);
            try { if (fs.existsSync(candidate)) return candidate; } catch (e) { }
        }
    }
    return null;
}

function hasGPUDeviceNode() {
    try {
        var entries = fs.readdirSync("/dev/dri");
        for (var i = 0; i < entries.length; i++) {
            if (/^(card|renderD)/.test(entries[i])) return true;
        }
    } catch (e) { /* no /dev/dri */ }
    var nvidia = ["/dev/nvidiactl", "/dev/nvidia0"];
    for (var j = 0; j < nvidia.length; j++) {
        try { if (fs.existsSync(nvidia[j])) return true; } catch (e) { }
    }
    return false;
}

// A usable GPU under Linux needs the Vulkan loader plus a DRM (or NVIDIA)
// device node. A missing loader is what makes Dawn's adapter request fail, and
// a failed request is what crashes at exit — so both are required up front.
// Returns null when GPU is usable, otherwise a short reason.
function linuxGPUSkipReason() {
    if (process.env.SLR_SEP_FORCE_GPU === "1") return null;
    if (!findVulkanLoader()) return "no Vulkan loader (libvulkan.so.1) found";
    if (!hasGPUDeviceNode()) return "no GPU device node under /dev/dri";
    return null;
}

// Direct3D 12 (including the WARP software adapter) is always present on
// Windows 10 1903+, which is also DirectML's floor.
function windowsGPUAvailable() {
    try {
        var major = parseInt(String(os.release()).split(".")[0], 10);
        return major >= 10;
    } catch (e) {
        return false;
    }
}

// Provider/fallback messages are routed here. SEP.js installs a logger that
// forwards them to the in-app log (ui.log); the default keeps them on the
// console for standalone use.
var _log = function (message) { console.log(message); };
function setLogger(fn) {
    if (typeof fn === "function") _log = fn;
}

function labelFor(eps) {
    if (eps[0] === "webgpu") return "WebGPU (GPU)";
    if (eps[0] === "dml") return "DirectML (GPU)";
    return "CPU";
}

// One line per model session so the provider is visible beyond the first
// resolution — notably for the inpainting models created during export.
function logSession(modelPath, label) {
    var name = modelPath ? path.basename(modelPath) : "model";
    _log("[SEP] " + name + ": " + label);
}

// Decide which providers to try, plus an optional reason why GPU is skipped so
// the UI can explain "GPU acceleration unavailable (...); using CPU.".
function gpuPlan() {
    if (!_preferGPU) return { attempts: [["cpu"]], note: null };
    if (process.env.SLR_SEP_DISABLE_GPU === "1") {
        return { attempts: [["cpu"]], note: "disabled by SLR_SEP_DISABLE_GPU" };
    }
    var bundled = bundledBackends();
    var hasWebGPU = !bundled || bundled.webgpu;
    var hasDML = !bundled || bundled.dml;
    var attempts = [];
    if (process.platform === "win32") {
        if (!windowsGPUAvailable()) return { attempts: [["cpu"]], note: "requires Windows 10 or newer" };
        if (hasWebGPU) attempts.push(["webgpu", "cpu"]);
        if (hasDML) attempts.push(["dml", "cpu"]);
    } else if (process.platform === "linux") {
        var skipReason = linuxGPUSkipReason();
        if (skipReason) return { attempts: [["cpu"]], note: skipReason };
        if (hasWebGPU) attempts.push(["webgpu", "cpu"]);
    }
    if (attempts.length === 0) {
        return { attempts: [["cpu"]], note: "no GPU execution provider is bundled for this platform" };
    }
    attempts.push(["cpu"]);
    return { attempts: attempts, note: null };
}

function withProviders(sessionOptions, providers) {
    var merged = {};
    for (var key in sessionOptions) {
        if (Object.prototype.hasOwnProperty.call(sessionOptions, key)) merged[key] = sessionOptions[key];
    }
    merged.executionProviders = providers;
    return merged;
}

function firstLine(err) {
    if (err && err.message) return String(err.message).split("\n")[0];
    return String(err);
}

// Native EP errors are long (they embed the ORT source path). Keep the useful
// phrase for the UI and truncate anything else.
function shortReason(err) {
    var s = firstLine(err);
    var known = s.match(/Failed to get a WebGPU adapter:[\s\S]*|Failed to create a WebGPU device:[\s\S]*/);
    if (known) return known[0];
    if (s.length > 160) s = s.slice(0, 157) + "...";
    return s;
}

async function createSession(modelPath, sessionOptions) {
    sessionOptions = sessionOptions || {};
    if (_resolved) {
        var cached = await ort.InferenceSession.create(modelPath, withProviders(sessionOptions, _resolved));
        logSession(modelPath, _resolvedLabel);
        return cached;
    }
    var plan = gpuPlan();
    var attempts = plan.attempts;
    if (plan.note) _log("[SEP] GPU acceleration unavailable (" + plan.note + "); using CPU.");
    var lastErr = null;
    for (var i = 0; i < attempts.length; i++) {
        var providers = attempts[i];
        try {
            var session = await ort.InferenceSession.create(modelPath, withProviders(sessionOptions, providers));
            _resolved = providers;
            _resolvedLabel = labelFor(providers);
            _log("[SEP] ONNX Runtime execution provider: " + _resolvedLabel);
            return session;
        } catch (e) {
            lastErr = e;
            _log("[SEP] " + labelFor(providers) + " unavailable (" + shortReason(e) + "), falling back...");
        }
    }
    throw lastErr;
}

module.exports = {
    createSession: createSession,
    setPreferGPU: setPreferGPU,
    setLogger: setLogger,
    getActiveProvider: getActiveProvider,
};
