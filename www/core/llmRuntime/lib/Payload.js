"use strict";
const nodePath = require("path");

const PLATFORM_DIRS = { win32: "win-x64", linux: "linux-x64" };

function platformDir(platform, arch) {
    const dir = PLATFORM_DIRS[platform];
    if (!dir) throw new Error(`Unsupported platform: ${platform} (expected win32 or linux)`);
    if (arch !== "x64") throw new Error(`Unsupported arch: ${arch} (expected x64)`);
    return dir;
}

function serverBinaryName(platform) {
    return platform === "win32" ? "llama-server.exe" : "llama-server";
}

function runtimeRoot(rootDir, version, dirName) {
    return nodePath.join(rootDir, dirName || "runtime", version);
}

function manifestPath(rootDir, version, dirName) {
    return nodePath.join(runtimeRoot(rootDir, version, dirName), "manifest.json");
}

function validateManifest(manifest, platformKey) {
    if (!manifest || typeof manifest !== "object") {
        throw new Error("Runtime manifest is not an object");
    }
    if (!manifest.version) throw new Error('Runtime manifest missing "version"');
    if (!manifest.platforms || !manifest.platforms[platformKey]) {
        throw new Error(`Runtime manifest has no entry for ${platformKey}`);
    }
    const entry = manifest.platforms[platformKey];
    if (!Array.isArray(entry.backends) || entry.backends.length === 0) {
        throw new Error(`Runtime manifest for ${platformKey} lists no backends`);
    }
    if (!entry.files || typeof entry.files !== "object") {
        throw new Error(`Runtime manifest for ${platformKey} has no file checksums`);
    }
}

function readManifest(fp, fs) {
    if (!fs.existsSync(fp)) throw new Error(`Runtime manifest not found: ${fp}`);
    return JSON.parse(fs.readFileSync(fp, "utf8"));
}

// Drop-in backend packs (CUDA, ROCm). A pack installs its libraries directly into the
// platform dir, so llama.cpp's own loader finds them next to the executable, and leaves a
// descriptor at llama/<tag>/packs/<backend>.json. Merging it here means an installed pack
// widens the backend list and has its files checksum-verified like everything else. A pack
// whose descriptor is unreadable or names another platform is skipped rather than fatal,
// so a stray file can never stop the base runtime from starting.
function readPacks({ root, platformKey, fs }) {
    const dir = nodePath.join(root, "packs");
    const backends = [];
    const files = {};
    if (!fs.existsSync(dir)) return { backends, files };
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch (err) {
        return { backends, files };
    }
    for (const name of names) {
        if (!/\.json$/i.test(name)) continue;
        let pack;
        try {
            pack = JSON.parse(fs.readFileSync(nodePath.join(dir, name), "utf8"));
        } catch (err) {
            continue;
        }
        if (!pack || pack.platformKey !== platformKey) continue;
        if (typeof pack.backend !== "string" || !pack.backend) continue;
        if (!pack.files || typeof pack.files !== "object") continue;
        if (backends.indexOf(pack.backend) === -1) backends.push(pack.backend);
        Object.assign(files, pack.files);
    }
    return { backends, files };
}

function mergePacks(manifest, platformKey, packs) {
    const entry = manifest.platforms[platformKey];
    const backends = entry.backends.slice();
    for (const backend of packs.backends) {
        if (backends.indexOf(backend) === -1) backends.push(backend);
    }
    const platforms = Object.assign({}, manifest.platforms);
    platforms[platformKey] = Object.assign({}, entry, {
        backends: backends,
        files: Object.assign({}, entry.files, packs.files)
    });
    return Object.assign({}, manifest, { platforms: platforms });
}

function resolvePayload({ rootDir, version, platform, arch, fs, dirName }) {
    if (!version) throw new Error("A pinned runtime version is required");
    const key = platformDir(platform, arch);
    const root = runtimeRoot(rootDir, version, dirName);
    const manifest = readManifest(manifestPath(rootDir, version, dirName), fs);
    validateManifest(manifest, key);
    const dir = nodePath.join(root, key);
    const packs = readPacks({ root, platformKey: key, fs });
    const merged = mergePacks(manifest, key, packs);
    const serverBinary = nodePath.join(dir, serverBinaryName(platform));
    if (!fs.existsSync(serverBinary)) {
        throw new Error(`Runtime server binary not found: ${serverBinary}`);
    }
    return { root, dir, manifest: merged, serverBinary, packs };
}

function sha256File(filePath, fs, crypto) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifyPayload({ dir, manifest, platformKey, fs, crypto, onError }) {
    const expected = manifest.platforms[platformKey].files || {};
    const bad = [];
    for (const rel of Object.keys(expected)) {
        const fp = nodePath.join(dir, rel);
        if (!fs.existsSync(fp)) { bad.push(rel); continue; }
        if (sha256File(fp, fs, crypto) !== expected[rel]) bad.push(rel);
    }
    if (bad.length && typeof onError === "function") {
        onError(new Error(`Runtime payload checksum mismatch: ${bad.join(", ")}`));
    }
    return bad;
}

module.exports = {
    platformDir, serverBinaryName, runtimeRoot, manifestPath,
    validateManifest, readManifest, readPacks, mergePacks, resolvePayload, sha256File, verifyPayload
};
