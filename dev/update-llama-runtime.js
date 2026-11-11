"use strict";
// One-shot runtime update: cuts the base payloads into the app copies, builds the optional
// backend packs into the packs folder, bumps the version pins and verifies the result.
//
// Usage: node dev/update-llama-runtime.js [--tag <bNNNNN>] [--no-packs] [--keep-old]
//          [--packs-only] [--verify-only] [--root <devpod root>]
//
// Tag resolution: with no --tag, the newest vX.Y.Z release is read (releases/latest), and its
// nightly-tag.txt names the bNNNNN build it graduated - so the default is always a stable
// release's exact binaries, never an hours-old prerelease. --tag pins any bNNNNN explicitly
// (prereleases allowed on purpose; that is what the flag is for).
//
// Layout (overridable with --root, default: the parent of this app copy):
//   <root>/SLR Translator          <- Windows app copy (gets runtime/<tag>/win-x64)
//   <root>/SLR Translator Linux    <- Linux app copy   (gets runtime/<tag>/linux-x64)
//   <root>/Optional Runtime Packs  <- pack archives land here
//
// What it does per run:
//   1. base payload per app copy via dev/fetch-llama-runtime.js (CPU + Vulkan + manifest),
//      reusing the MSVC runtime DLLs already in the old payload for the Windows cut,
//   2. optional packs (win: CUDA + ROCm, linux: CUDA + ROCm) cut into a staging tree so the
//      shipped base stays clean - then 7z'd into the packs folder with a generated INSTALL.txt,
//   3. RUNTIME_VERSION bumped in both app copies (llmRuntime.js and dev/slr-runtime.js),
//   4. verification: manifest hashes re-checked, --version/--list-devices run (linux), and
//      every flag ModelArgs emits checked against the new binaries' --help (linux) or the
//      binary strings (win),
//   5. old runtime/<tag> dirs removed unless --keep-old (the app only ever loads the pinned
//      version; the packs folder keeps the old archives).
//
// Not automated on purpose: the release notes review (flag/behaviour changes between builds
// are a human judgement) and the docs, which do not name build numbers.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const childProcess = require("child_process");
const PackPlan = require("../www/core/llmRuntime/lib/PackPlan");

// The flags www/core/llmRuntime/lib/ModelArgs.js can emit. A build that renamed or removed
// one of these dies at argv parse on every start, which is the one breakage no amount of
// hashing catches - so the updater checks them against the new binaries directly. Keep this
// list in sync when ModelArgs grows a flag.
const MODEL_ARGS_FLAGS = [
    "-m", "--alias", "--host", "--port", "--device", "--fit-target", "--jinja", "--offline",
    "--metrics", "--no-webui", "--reasoning", "--flash-attn", "-c", "-ngl", "--verbosity",
    "--cache-type-k", "--cache-type-v", "--batch-size", "--ubatch-size", "--load-mode",
    "--chat-template-file", "--mmproj", "--model-draft", "--spec-draft-type-k",
    "--spec-draft-type-v", "--spec-type", "--spec-draft-n-max", "--spec-draft-n-min",
    "--spec-draft-p-min", "--spec-draft-ngl", "--spec-draft-cpu-moe", "--spec-draft-n-cpu-moe",
    "--spec-draft-n-ubatch", "--cpu-moe", "--n-cpu-moe", "--moe-cache-mib",
    "--split-mode", "--tensor-split", "--main-gpu",
    "--override-tensor", "--override-kv", "--threads", "--threads-batch", "--parallel",
    "--cache-ram", "--cache-reuse", "--cache-prompt", "--cache-idle-slots",
    "--ctx-checkpoints", "--slot-save-path", "--kv-unified", "--no-kv-unified",
    "--kv-offload", "--no-kv-offload"
];

const PACKS = [
    { platform: "win-x64", backend: "cuda", os: "win" },
    { platform: "win-x64", backend: "rocm", os: "win" },
    { platform: "linux-x64", backend: "cuda", os: "linux" },
    { platform: "linux-x64", backend: "rocm", os: "linux" }
];

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
}
function flag(name) { return process.argv.includes(`--${name}`); }

function log(step, msg) { console.log(`[update] ${step}: ${msg}`); }

function fetchText(url, redirects) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "user-agent": "slr-runtime-update" } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 5) {
                res.resume();
                return resolve(fetchText(res.headers.location, (redirects || 0) + 1));
            }
            if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> ${res.statusCode}`));
            let body = "";
            res.on("data", (d) => { body += d; });
            res.on("end", () => resolve(body));
        }).on("error", reject);
    });
}

function fetchJson(url) { return fetchText(url).then((t) => JSON.parse(t)); }

// The default target: the newest graduated vX.Y.Z, resolved to the bNNNNN build it points at.
async function resolveDefaultTag() {
    const latest = await fetchJson("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest");
    const nightly = (await fetchText(
        `https://github.com/ggml-org/llama.cpp/releases/download/${latest.tag_name}/nightly-tag.txt`
    )).trim();
    if (!/^b\d+$/.test(nightly)) {
        throw new Error(`${latest.tag_name}'s nightly-tag.txt does not name a build: "${nightly}"`);
    }
    return { tag: nightly, version: latest.tag_name, stable: true };
}

function run(cmd, args, opts) {
    childProcess.execFileSync(cmd, args, Object.assign({ stdio: "inherit" }, opts));
}

function sevenZip() {
    if (process.env.SLR_7ZA) return process.env.SLR_7ZA;
    const bundled = path.join(__dirname, "..", "node_modules", "7zip-bin", process.platform, "x64", "7za");
    return fs.existsSync(bundled) ? bundled : "7za";
}

function appCopies(root) {
    const win = path.join(root, "SLR Translator");
    const linux = path.join(root, "SLR Translator Linux");
    for (const dir of [win, linux]) {
        if (!fs.existsSync(path.join(dir, "package.json"))) {
            throw new Error(`Expected an app copy at ${dir} (pass --root <devpod root> otherwise)`);
        }
    }
    return { win, linux };
}

// The MSVC runtime DLLs for a Windows cut, reused from the payload already shipped.
function findVcruntimeDir(appRoot, newTag) {
    const runtimeRoot = path.join(appRoot, "runtime");
    if (!fs.existsSync(runtimeRoot)) return null;
    for (const name of fs.readdirSync(runtimeRoot)) {
        if (name === newTag) continue;
        const dir = path.join(runtimeRoot, name, "win-x64");
        if (fs.existsSync(path.join(dir, "vcruntime140.dll"))) return dir;
    }
    return null;
}

function cutBase(fetchScript, appRoot, platform, tag, commit) {
    const extra = platform === "win"
        ? ["--vcruntime-dir", findVcruntimeDir(appRoot, tag) || ""]
        : [];
    if (platform === "win" && !extra[1]) {
        throw new Error("No existing win-x64 payload to reuse the MSVC runtime DLLs from; " +
            "cut the first Windows payload with dev/fetch-llama-runtime.js --vcruntime-dir");
    }
    log(platform, `cutting base payload ${tag}`);
    run(process.execPath, [fetchScript, "--tag", tag, "--commit", commit,
        "--platform", platform, "--out", appRoot, "--dir", "runtime"].concat(extra));
}

// Cut one backend pack into a throwaway tree (so the app copy's base payload stays clean),
// then pack exactly the pack's own files + descriptor + a generated INSTALL.txt. See
// buildPack below; kept separate from the base cut because packs must never touch the
// shipped payload.

async function main() {
    const noPacks = flag("no-packs");
    const packsOnly = flag("packs-only");
    const verifyOnly = flag("verify-only");
    const keepOld = flag("keep-old");
    const root = path.resolve(arg("root", path.join(__dirname, "..", "..")));
    const copies = appCopies(root);
    const packsDir = path.join(root, "Optional Runtime Packs");
    const fetchScript = path.join(__dirname, "fetch-llama-runtime.js");
    // The fetch script extracts Windows zips with 7za; hand it the bundled binary (Linux
    // tarballs go through tar inside the fetch script itself).
    if (!process.env.SLR_7ZA) process.env.SLR_7ZA = sevenZip();

    let tag = arg("tag");
    let version = null;
    if (tag) {
        log("tag", `pinned to ${tag} by --tag (prereleases allowed)`);
    } else {
        const resolved = await resolveDefaultTag();
        tag = resolved.tag;
        version = resolved.version;
        log("tag", `latest stable ${resolved.version} -> build ${tag}`);
    }
    const release = await fetchJson(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${tag}`);
    // Every bNNNNN tag is flagged prerelease (only the vX.Y.Z markers are not), so the flag
    // itself is not a stop; what matters is HOW the tag was chosen - the default came through
    // the latest vX.Y.Z, an explicit --tag is the operator's own call.
    if (release.prerelease) log("tag", "note: this b-tag is flagged prerelease (normal for build tags)");
    const commit = (release.target_commitish || "").slice(0, 12) || "unknown";
    log("tag", `${tag} commit ${commit}${version ? ` (=${version})` : ""}`);

    if (!verifyOnly && !packsOnly) {
        cutBase(fetchScript, copies.win, "win", tag, commit);
        cutBase(fetchScript, copies.linux, "linux", tag, commit);
    }

    if (!verifyOnly && !noPacks) {
        for (const spec of PACKS) {
            await buildPack(fetchScript, spec, { tag, commit, packsDir, copies });
        }
    }

    if (!verifyOnly) bumpVersions(copies, tag);
    verify(copies, tag, packsOnly);
    if (!verifyOnly && !keepOld && !packsOnly) pruneOld(copies, tag);

    console.log(`\n[update] done: ${tag}${version ? ` (= ${version})` : ""}`);
    console.log("[update] remaining manual steps:");
    console.log("[update]   - review the release notes between the old and new build, run the app once,");
    console.log("[update]     and ship both app copies plus the new pack archives.");
    console.log("[update]   - the ROCm 6 pack (Windows 10, HIP SDK 6.4.2) is a CUSTOM build - upstream");
    console.log("[update]     publishes no HIP-6 Windows assets, so this script cannot cut it. If Windows 10");
    console.log("[update]     ROCm support is kept, run dev/build-rocm6-pack.ps1 -Tag " + tag + " on the Windows");
    console.log("[update]     build box (recipe: old sources/rocm6-pack-build/REPORT.md).");
}

// --- packs ---------------------------------------------------------------------------------

async function buildPack(fetchScript, spec, ctx) {
    const { tag, commit, packsDir, copies } = ctx;
    const appRoot = spec.platform === "win-x64" ? copies.win : copies.linux;
    const staging = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "slr-pack-"));
    const stagingTagDir = path.join(staging, "runtime", ctx.tag);
    fs.mkdirSync(path.join(stagingTagDir, spec.platform), { recursive: true });
    // --pack needs the base manifest present (it skips files the base already owns) but must
    // not ship inside the archive, so a copy is parked outside the packed tree.
    const realManifest = path.join(appRoot, "runtime", tag, "manifest.json");
    if (!fs.existsSync(realManifest)) {
        throw new Error(`Base payload for ${tag} missing (${realManifest}); run without --packs-only first`);
    }
    fs.mkdirSync(path.join(staging, "manifest-park"), { recursive: true });
    fs.copyFileSync(realManifest, path.join(staging, "manifest-park", "manifest.json"));
    fs.copyFileSync(realManifest, path.join(stagingTagDir, "manifest.json"));

    run(process.execPath, [fetchScript, "--tag", tag, "--commit", commit,
        "--platform", spec.os, "--backend", spec.backend, "--pack",
        "--out", staging, "--dir", "runtime"]);
    fs.rmSync(path.join(stagingTagDir, "manifest.json"), { force: true });

    const descriptor = JSON.parse(fs.readFileSync(path.join(stagingTagDir, "packs", `${spec.backend}.json`), "utf8"));
    const files = Object.keys(descriptor.files).sort();
    fs.writeFileSync(path.join(staging, "INSTALL.txt"), installText(spec, tag, commit, files));

    if (!fs.existsSync(packsDir)) fs.mkdirSync(packsDir, { recursive: true });
    const archiveName = packArchiveName(spec, tag);
    const archive = path.join(packsDir, archiveName);
    if (fs.existsSync(archive)) fs.rmSync(archive);
    log(`${spec.platform}/${spec.backend}`, `packing ${files.length} files -> ${archiveName}`);
    run(sevenZip(), ["a", "-t7z", `-mmt=on`, archive,
        path.join("runtime", tag), "INSTALL.txt"],
        { cwd: staging });
    fs.rmSync(staging, { recursive: true, force: true });
}

function packArchiveName(spec, tag) {
    const osName = spec.platform === "win-x64" ? "win" : "linux";
    const backend = spec.backend === "cuda" ? "CUDA" : "ROCm";
    return `SLR-Translator-${backend}-pack-${tag}-${osName}-x64.7z`;
}

function installText(spec, tag, commit, files) {
    const osName = spec.platform === "win-x64" ? "Windows" : "Linux";
    const backendName = spec.backend === "cuda" ? "CUDA" : "ROCm";
    const gpu = spec.backend === "cuda"
        ? "NVIDIA" : "AMD";
    const lines = [];
    lines.push(`SLR Translator - ${backendName} runtime pack - llama.cpp ${tag} - ${osName} x64`);
    lines.push("");
    lines.push("WHAT THIS IS");
    lines.push(`  GPU acceleration for the bundled local runtime on ${gpu} cards, using ${backendName}.`);
    lines.push(`  The base app ships CPU and Vulkan; this pack adds the ${backendName} backend.`);
    lines.push("");
    lines.push("REQUIREMENTS");
    lines.push("  - An SLR Translator version whose bundled runtime build matches this pack (" + tag + ").");
    lines.push(`  - A 64-bit ${osName} system with a ${gpu} GPU and its normal driver.`);
    if (spec.backend === "cuda") {
        lines.push("    No CUDA Toolkit installation is required; the CUDA runtime libraries are inside this pack.");
    } else {
        // The ROCm pack is deliberately NOT self-contained: it carries llama.cpp's HIP backend
        // plus the HIP runtime and its compiler companion, and the BLAS libraries come from the
        // installed ROCm / HIP SDK. The old text claimed the opposite, which is exactly the
        // misunderstanding that leaves a pack installed with no usable ROCm device.
        if (spec.platform === "win-x64") {
            lines.push("    The BLAS libraries this backend needs (hipblas, rocblas, hipblaslt) are NOT inside this");
            lines.push("    pack; they come from the installed AMD HIP SDK. The app probes the SDK's standard");
            lines.push("    install location (C:\\Program Files\\AMD\\ROCm\\<version>\\bin) on its own; if the SDK");
            lines.push("    lives somewhere else, put its bin folder on PATH or in the app's \"Local runtime extra");
            lines.push("    library folder\" option and restart the app afterwards.");
        } else {
            lines.push("    The BLAS libraries this backend needs (hipblas, rocblas, libamdhip64) are NOT inside this");
            lines.push("    pack; they come from the installed ROCm - on Linux usually the distribution's ROCm");
            lines.push("    packages.");
        }
    }
    lines.push("");
    lines.push("HOW TO INSTALL");
    lines.push("  Extract this archive into the SLR Translator folder, so the files land next to the");
    lines.push("  existing runtime folder. It adds:");
    for (const f of files) lines.push(`      runtime/${tag}/${spec.platform}/${f}`);
    lines.push(`      runtime/${tag}/packs/${spec.backend}.json`);
    lines.push("  Nothing else is overwritten. Restart the app afterwards.");
    lines.push("");
    lines.push("HOW TO USE");
    lines.push("  In the DSLR engine options, open the Bundled Local Runtime card, set \"Local runtime");
    lines.push(`  backend\" to auto or ${spec.backend}, then press Start / Use Local Runtime. Runtime Status lists the`);
    lines.push("  installed backends and reports which one was chosen. In automatic mode a backend that");
    lines.push("  cannot be loaded is skipped and another one runs; with this backend explicitly selected,");
    lines.push("  the start fails and reports why, including the device probe's own error output.");
    lines.push("");
    lines.push("ABOUT THIS BUILD");
    lines.push(`  Cut from the official llama.cpp prebuilt ${backendName} assets of release ${tag} (commit ${commit}).`);
    lines.push("");
    lines.push("HOW TO REMOVE");
    lines.push(`  Delete runtime/${tag}/packs/${spec.backend}.json and the files listed above.`);
    return lines.join("\n") + "\n";
}

// --- version pins, verification, pruning ----------------------------------------------------

function bumpVersions(copies, tag) {
    const targets = [];
    for (const dir of [copies.win, copies.linux]) {
        targets.push(path.join(dir, "www", "core", "llmRuntime", "llmRuntime.js"));
        targets.push(path.join(dir, "dev", "slr-runtime.js"));
    }
    for (const file of targets) {
        if (!fs.existsSync(file)) { log("bump", `skipping missing ${file}`); continue; }
        const before = fs.readFileSync(file, "utf8");
        const after = before.replace(/(RUNTIME_VERSION\s*=\s*)"b\d+"/, `$1"${tag}"`);
        if (after === before) {
            if (!before.includes(`"${tag}"`)) throw new Error(`No RUNTIME_VERSION pin found in ${file}`);
            log("bump", `${path.relative(path.join(__dirname, "..", ".."), file)} already at ${tag}`);
        } else {
            fs.writeFileSync(file, after);
            log("bump", `${path.relative(path.join(__dirname, "..", ".."), file)} -> ${tag}`);
        }
    }
}

// Run llama-server in the payload dir and capture stdout+stderr: the version banner and the
// device list print on stderr, the help on stdout, so callers must not pick one channel.
function captureRun(dir, args) {
    const res = childProcess.spawnSync("./llama-server", args,
        { cwd: dir, env: Object.assign({}, process.env, { LD_LIBRARY_PATH: dir }), encoding: "utf8" });
    return (res.stdout || "") + (res.stderr || "");
}

function verify(copies, tag, packsOnly) {
    for (const [platformKey, appRoot, runnable] of [["win-x64", copies.win, false], ["linux-x64", copies.linux, true]]) {
        if (packsOnly) continue;
        const dir = path.join(appRoot, "runtime", tag, platformKey);
        const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, "runtime", tag, "manifest.json"), "utf8"));
        const files = manifest.platforms[platformKey].files;
        const bad = [];
        for (const name of Object.keys(files)) {
            const fp = path.join(dir, name);
            let ok = false;
            try {
                const st = fs.lstatSync(fp);
                const target = st.isSymbolicLink() ? fs.realpathSync(fp) : fp;
                ok = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") === files[name];
            } catch (err) { ok = false; }
            if (!ok) bad.push(name);
        }
        if (bad.length) throw new Error(`${platformKey}: checksum mismatch for ${bad.join(", ")}`);
        log(platformKey, `${Object.keys(files).length} files hash-verified`);

        // Flag drift: a renamed/removed flag kills every start at argv parse.
        const missing = [];
        if (runnable) {
            const help = captureRun(dir, ["--help"]);
            // The help lists aliases mid-line ("-lv, --verbosity, --log-verbosity N"), so a
            // plain substring is the honest test: a renamed or removed flag disappears
            // entirely, which is exactly what this check exists to catch.
            for (const f of MODEL_ARGS_FLAGS) if (!help.includes(f)) missing.push(f);
        } else {
            // The Windows binaries cannot run here; the flag names live in llama-common.dll.
            const lib = fs.readFileSync(path.join(dir, "llama-common.dll"));
            for (const f of MODEL_ARGS_FLAGS) if (lib.indexOf(Buffer.from(f.replace(/^-+/, ""), "ascii")) === -1) missing.push(f);
        }
        if (missing.length) {
            throw new Error(`${platformKey}: the new build does not know these ModelArgs flags: ${missing.join(", ")}`);
        }
        log(platformKey, `all ${MODEL_ARGS_FLAGS.length} ModelArgs flags known to the new build`);

        if (runnable) {
            const version = captureRun(dir, ["--version"]);
            if (!version.includes(tag.slice(1))) throw new Error(`${platformKey}: --version does not report build ${tag}: ${version.trim()}`);
            const devices = captureRun(dir, ["--list-devices"]);
            if (!/^.+:\s+.+\(\d+ MiB, \d+ MiB free\)/m.test(devices.replace("Available devices:\n", ""))) {
                throw new Error(`${platformKey}: --list-devices output no longer matches the Backend parser:\n${devices}`);
            }
            log(platformKey, `--version ok (${version.split("\n")[0].trim()}), --list-devices format ok`);
        }
    }
}

function pruneOld(copies, tag) {
    for (const dir of [copies.win, copies.linux]) {
        const runtimeRoot = path.join(dir, "runtime");
        for (const name of fs.readdirSync(runtimeRoot)) {
            if (/^b\d+$/.test(name) && name !== tag) {
                fs.rmSync(path.join(runtimeRoot, name), { recursive: true, force: true });
                log("prune", `${path.basename(dir)}/runtime/${name}`);
            }
        }
    }
}

if (require.main === module) {
    main().catch((err) => { console.error(`[update] FAILED: ${err.message}`); process.exit(1); });
}

// Exported so tooling can regenerate or verify a pack's INSTALL.txt (the archive patching
// step) without running the whole updater.
module.exports = { installText };
