// www/core/llmRuntime/lib/HipSdkLocator.js
"use strict";
const nodePath = require("path");

// The first library ggml-hip.dll needs from the installed SDK; a bin folder without it
// cannot serve a ROCm pack even though the folder itself exists (a leftover or partial
// install must not be adopted).
const MARKER_LIBRARY = "hipblas.dll";

// "6.4", "6.4.2", ... as [major, minor, patch]; null for anything else (the AMD install
// root only ever holds version-named SDK folders, so anything else is not a candidate).
function versionOf(name) {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(name));
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function isUsableSdkBin(fs, bin) {
    try { return fs.existsSync(nodePath.join(bin, MARKER_LIBRARY)); } catch (err) { return false; }
}

// Candidate HIP SDK bin folders in their standard install locations, best first. An
// explicitly configured HIP_PATH outranks everything (the environment set it on purpose);
// after that, the SDK generation matching the installed pack wins, then the newer version.
// Empty on non-Windows - where the problem does not exist, because ROCm installs into the
// loader's default paths - and when no usable SDK is installed.
function standardBinDirs({ platform, env, fs, packGeneration }) {
    if (platform !== "win32") return [];
    const candidates = [];
    const seen = {};
    const push = function (bin, major, version) {
        if (!isUsableSdkBin(fs, bin)) return;
        const key = String(bin).toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        candidates.push({ bin: bin, major: major || 0, version: version || [0, 0, 0] });
    };
    const hipPath = env && env.HIP_PATH;
    if (hipPath) {
        const clean = String(hipPath).replace(/[\\/]+$/, "");
        const version = versionOf(nodePath.basename(clean));
        push(nodePath.join(clean, "bin"), version ? version[0] : 0, version);
    }
    // The default install root: one <major>.<minor>[.<patch>] subfolder per installed SDK.
    // ProgramW6432 is always the 64-bit path; ProgramFiles equals it on a 64-bit process
    // and the literal is the last-resort fallback when neither is set.
    const programFiles = (env && (env.ProgramW6432 || env.ProgramFiles)) || "C:\\Program Files";
    const base = nodePath.join(programFiles, "AMD", "ROCm");
    let entries = null;
    try { entries = fs.readdirSync(base); } catch (err) { entries = null; }
    if (entries) {
        for (const name of entries) {
            const version = versionOf(name);
            if (!version) continue;
            push(nodePath.join(base, name, "bin"), version[0], version);
        }
    }
    const rank = function (candidate) {
        const generationMatch = packGeneration ? (candidate.major === packGeneration ? 0 : 1) : 0;
        return [generationMatch, -candidate.version[0], -candidate.version[1], -candidate.version[2]];
    };
    candidates.sort(function (a, b) {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) {
            if (ra[i] !== rb[i]) return ra[i] - rb[i];
        }
        return 0;
    });
    return candidates.map(function (candidate) { return candidate.bin; });
}

module.exports = { standardBinDirs, versionOf, MARKER_LIBRARY };
