"use strict";
// Release-time helper. Downloads the pinned llama.cpp prebuilt assets, trims them to the
// server + backend libraries, hashes what it keeps, and writes <engine dir>/<tag>/<platform>/
// plus <engine dir>/<tag>/manifest.json. Run manually; it is not part of the app.
//
// Usage: node dev/fetch-llama-runtime.js --tag b10964 --commit <sha> --platform linux|win
//          [--backend cpu|vulkan|cuda|rocm] [--pack]
//          [--vcruntime-dir <dir>] [--out <app root>] [--dir <name>]
//
// Without --backend the base payload is installed: CPU and Vulkan, plus manifest.json.
// With --backend and --pack, an optional drop-in pack is installed instead: only that
// backend's own libraries are added to the existing payload (files already present are left
// alone) and a descriptor is written to <engine dir>/<tag>/packs/<backend>.json, which the app
// merges at start-up. --pack requires the base payload to be installed first.
// --vcruntime-dir points at the directory holding the app-local MSVC runtime DLLs
// (vcruntime140.dll, vcruntime140_1.dll, msvcp140.dll); it is required for a Windows base
// install and unused for Linux and for packs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const childProcess = require("child_process");
const PackPlan = require("../www/core/llmRuntime/lib/PackPlan");

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    return process.argv[i + 1];
}

// The engine directory the app resolves from localConfig.llama, overridable with --dir. A
// missing or unparsable package.json falls back to the shipped "runtime".
function resolveDirName(appRoot) {
    const override = arg("dir");
    if (override) return override;
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
        const config = (manifest && manifest.localConfig) || {};
        if (typeof config.llama === "string" && config.llama) return config.llama;
    } catch (err) { /* fall back to the shipped default */ }
    return "runtime";
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, { headers: { "user-agent": "slr-runtime-fetch" } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                return download(res.headers.location, dest).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                return reject(new Error(`Download failed ${res.statusCode}: ${url}`));
            }
            res.pipe(file);
            file.on("finish", () => file.close(resolve));
        }).on("error", reject);
    });
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "user-agent": "slr-runtime-fetch" } }, (res) => {
            let body = "";
            res.on("data", (d) => { body += d; });
            res.on("end", () => resolve(JSON.parse(body)));
        }).on("error", reject);
    });
}

function extract(archive, dest) {
    // tar does not create the destination directory the way 7za's -o switch does; without
    // this it fails on every fresh temp dir and the 7za fallback below quietly mangles the
    // symlinks (that is exactly how a broken payload got cut once).
    fs.mkdirSync(dest, { recursive: true });
    // Linux tarballs must be extracted with tar when it is available: 7za (16.02 at least)
    // turns tar symlinks into tiny regular files containing the link path and drops the
    // executable bit, which leaves a payload whose .so.0 names are broken stubs (measured on
    // the dev pod; the loader then fails with "file too short"). tar preserves both.
    if (/\.(tar\.gz|tgz)$/i.test(archive)) {
        try {
            childProcess.execFileSync("tar", ["--version"], { stdio: "ignore" });
            childProcess.execFileSync("tar", ["xzf", archive, "-C", dest], { stdio: "inherit" });
            return;
        } catch (err) {
            if (!process.env.SLR_7ZA && childProcess.spawnSync("7za", ["--help"]).status !== 0) {
                throw new Error(`Extracting ${archive} needs tar or 7za; neither is available`);
            }
            // fall through to 7za, and post-process the symlink stubs it leaves behind.
        }
    }
    const sevenZip = process.env.SLR_7ZA || "7za";
    childProcess.execFileSync(sevenZip, ["x", archive, `-o${dest}`, "-y"], { stdio: "inherit" });
    // 7-Zip treats .gz as a single-file compressor, so a .tar.gz only yields the inner .tar on
    // the first pass. The second pass is what actually produces the files; without it a Linux
    // payload or pack silently ends up empty (the only entry found is the .tar itself, which
    // matches nothing we keep).
    if (/\.(tar\.gz|tgz)$/i.test(archive)) {
        const innerName = path.basename(archive).replace(/\.tgz$/i, ".tar").replace(/\.gz$/i, "");
        const inner = path.join(dest, innerName);
        if (!fs.existsSync(inner)) {
            throw new Error(`Expected ${innerName} inside ${archive} after the first extraction pass`);
        }
        childProcess.execFileSync(sevenZip, ["x", inner, `-o${dest}`, "-y"], { stdio: "inherit" });
        fs.rmSync(inner, { force: true });
    }
}

// Archives are not laid out uniformly: the Windows zips are flat, while the Linux
// tarballs nest everything under a top-level directory. Walk the extracted tree so
// both shapes are found.
function walkFiles(dir) {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...walkFiles(fp));
        else found.push(fp);
    }
    return found;
}

// Copy a kept entry into the payload. Symlinked shared libraries (lib*.so -> lib*.so.0 ->
// lib*.so.0.x.y) are recreated as symlinks so the SONAME the loader needs stays present; the
// manifest hash is always taken from the resolved file contents. The executable bit is copied
// from the source, because a payload cut on a filesystem (or via an extractor) that dropped it
// would ship a llama-server the app cannot spawn.
function storeEntry(src, target, hashes) {
    const name = path.basename(src);
    const dst = path.join(target, name);
    const mode = fs.statSync(src).mode & 0o777;
    if (fs.lstatSync(src).isSymbolicLink()) {
        fs.rmSync(dst, { force: true });
        fs.symlinkSync(fs.readlinkSync(src), dst);
    } else {
        fs.rmSync(dst, { force: true });
        fs.copyFileSync(src, dst);
        if (mode & 0o111) fs.chmodSync(dst, mode);
    }
    hashes[name] = crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex");
}

// Download and extract every archive a backend needs into one directory. CUDA on Windows is
// split across two archives (the backend build plus the CUDA runtime), so a backend is not
// necessarily a single download.
async function fetchBackendArchives({ tag, platformKey, backend, release, tmp }) {
    const spec = PackPlan.backendAsset(platformKey, backend);   // throws for unsupported combos
    const out = path.join(tmp, backend);
    const archives = [PackPlan.assetName(tag, platformKey, backend)];
    if (spec.cudart) archives.push(PackPlan.cudartAssetName(platformKey, backend, tag));
    for (const name of archives) {
        const asset = PackPlan.pickAsset(release.assets, name);
        const archive = path.join(tmp, name);
        await download(asset.browser_download_url, archive);
        extract(archive, out);
    }
    return out;
}

async function main() {
    const tag = arg("tag");
    const commit = arg("commit", "unknown");
    const platform = arg("platform");
    const backendArg = arg("backend");
    const pack = process.argv.includes("--pack");
    const appRoot = path.resolve(arg("out", path.join(__dirname, "..")));
    if (!tag || !platform) throw new Error("Usage: --tag <tag> --platform linux|win [--backend cpu|vulkan|cuda|rocm] [--pack] [--commit <sha>] [--vcruntime-dir <dir>] [--out <app root>] [--dir <name>]");
    if (pack && ["cuda", "rocm"].indexOf(backendArg) === -1) {
        throw new Error("--pack needs --backend cuda or --backend rocm");
    }

    const platformKey = platform === "win" ? "win-x64" : "linux-x64";
    const release = await fetchJson(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${tag}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llama-fetch-"));
    const dirName = resolveDirName(appRoot);
    const target = path.join(appRoot, dirName, tag, platformKey);
    const manifestPath = path.join(appRoot, dirName, tag, "manifest.json");

    if (pack) {
        // Additive install: the base payload already owns the shared libraries, so only the
        // backend's own new files are copied and everything already present is left as it is.
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`Install the base payload first: ${manifestPath} not found`);
        }
        const base = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const known = (base.platforms && base.platforms[platformKey] && base.platforms[platformKey].files) || {};
        const out = await fetchBackendArchives({ tag, platformKey, backend: backendArg, release, tmp });
        const files = {};
        let skipped = 0;
        for (const src of walkFiles(out)) {
            const baseName = path.basename(src);
            if (!PackPlan.shouldKeep(baseName, platformKey, backendArg)) continue;
            if (known[baseName]) { skipped++; continue; }
            storeEntry(src, target, files);
        }
        const packsDir = path.join(appRoot, dirName, tag, "packs");
        fs.mkdirSync(packsDir, { recursive: true });
        fs.writeFileSync(
            path.join(packsDir, `${backendArg}.json`),
            JSON.stringify(PackPlan.buildPackDescriptor({ backend: backendArg, platformKey, tag, commit, files }), null, 2)
        );
        console.log(`Wrote ${backendArg} pack: ${Object.keys(files).length} new file(s), ${skipped} already present`);
        return;
    }

    const backends = backendArg ? [backendArg] : ["cpu", "vulkan"];
    fs.mkdirSync(target, { recursive: true });
    const hashes = {};
    for (const backend of backends) {
        const out = await fetchBackendArchives({ tag, platformKey, backend, release, tmp });
        for (const src of walkFiles(out)) {
            if (!PackPlan.shouldKeep(path.basename(src), platformKey, backend)) continue;
            storeEntry(src, target, hashes);
        }
    }

    for (const extra of PackPlan.planExtraFiles({ platformKey, vcruntimeDir: arg("vcruntime-dir"), fs, path })) {
        fs.copyFileSync(extra.source, path.join(target, extra.name));
        hashes[extra.name] = crypto.createHash("sha256").update(fs.readFileSync(extra.source)).digest("hex");
    }

    fs.writeFileSync(
        manifestPath,
        JSON.stringify(PackPlan.buildManifest({ tag, commit, platformKey, backends, hashes }), null, 2)
    );
    console.log(`Wrote ${target} with ${Object.keys(hashes).length} files`);
}

main().catch((err) => { console.error(err); process.exit(1); });
