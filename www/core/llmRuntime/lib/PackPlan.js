"use strict";

const CODENAME = { "win-x64": "win", "linux-x64": "ubuntu" };

// Per-platform backend assets. Two things differ from the simple <os>-<backend> pattern the
// base payload uses:
//  - CUDA and ROCm carry a version suffix in the asset name (cuda-12.4, rocm-10.0), so the
//  backend has to be mapped to the exact variant the release publishes.
//  - CUDA on Windows is split in two: the backend build plus a separate CUDA runtime archive
//  (cudart/cublas/cublasLt). Both are needed for a self-contained, offline pack. Linux CUDA
//  is split the same way since upstream began publishing it (the runtime archive name just
//  also carries the release tag there).
const BACKEND_ASSETS = {
    "win-x64": {
        cpu: { variant: "cpu" },
        vulkan: { variant: "vulkan" },
        cuda: { variant: "cuda-12.4", cudart: "cuda-12.4" },
        rocm: { variant: "rocm-10.0" }
    },
    "linux-x64": {
        cpu: { variant: "" },
        vulkan: { variant: "vulkan" },
        cuda: { variant: "cuda-12.8", cudart: "cuda-12.8" },
        rocm: { variant: "rocm-10.0" }
    }
};

function backendAsset(platformKey, backend) {
    const table = BACKEND_ASSETS[platformKey];
    if (!table) throw new Error(`Unsupported platform key: ${platformKey}`);
    const entry = table[backend];
    if (!entry) {
        throw new Error(
            `Backend ${backend} is not published for ${platformKey}` +
            (backend === "cuda" && platformKey === "linux-x64"
                ? " (upstream ships no Linux CUDA build for this tag; use vulkan or rocm)"
                : "")
        );
    }
    return entry;
}

function availableBackends(platformKey) {
    const table = BACKEND_ASSETS[platformKey];
    if (!table) throw new Error(`Unsupported platform key: ${platformKey}`);
    return Object.keys(table);
}

function assetName(tag, platformKey, backend) {
    const entry = backendAsset(platformKey, backend);
    const os = CODENAME[platformKey];
    if (platformKey === "win-x64") {
        return `llama-${tag}-bin-${os}-${entry.variant}-x64.zip`;
    }
    const variant = entry.variant ? `-${entry.variant}` : "";
    return `llama-${tag}-bin-${os}${variant}-x64.tar.gz`;
}

// The CUDA runtime archive. Its name carries no release tag on Windows and is downloaded in
// addition to the backend build; the Linux one carries the tag. Without it a CUDA pack would
// depend on a system CUDA install, which the pack must never do.
function cudartAssetName(platformKey, backend, tag) {
    const entry = backendAsset(platformKey, backend);
    if (!entry.cudart) {
        throw new Error(`${backend} has no separate runtime archive on ${platformKey}`);
    }
    if (platformKey === "win-x64") {
        return `cudart-llama-bin-win-${entry.cudart}-x64.zip`;
    }
    if (!tag) throw new Error("The Linux CUDA runtime archive name needs the release tag");
    return `cudart-llama-${tag}-bin-ubuntu-${entry.cudart}-x64.tar.gz`;
}

function pickAsset(assets, name) {
    const found = (assets || []).find((a) => a.name === name);
    if (!found) throw new Error(`Asset ${name} not found in release`);
    return found;
}

// Runtime shared libraries llama-server links against. Derived from the real pinned
// b10964 archives (see task-11-report.md for the enumerated entries).
const RUNTIME_LIBS = new Set([
    "llama-server-impl", "llama", "llama-common", "mtmd", "libomp"
]);

// Runtime executables. Only the server itself, never the unified `llama` runner tool.
const RUNTIME_EXES = new Set(["llama-server"]);

// Vendor runtime libraries that ship inside the per-backend archives. The base payload is
// CPU+Vulkan, so only CUDA and ROCm ever arrive as drop-in packs. Matching is by lowercased
// component-name prefix, which covers the versioned Windows names (cudart64_12.dll,
// cublas64_12.dll, cublasLt64_12.dll, nvrtc64_120_0.dll) and the Linux sonames.
const BACKEND_LIB_PREFIXES = {
    cuda: ["cudart", "cublas", "nvrtc", "cuda"],
    // amd_ covers amd_comgr, which amdhip64 links against and which is easy to miss because
    // it does not start with "amdhip".
    rocm: ["amdhip64", "amd_", "rocblas", "hipblas", "hipblaslt", "rocsolver", "rocsparse",
        "rocrand", "hiprand", "hsa-runtime", "rocm"],
    vulkan: ["vulkan"]
};

function backendLibrary(name, backend) {
    const prefixes = BACKEND_LIB_PREFIXES[backend];
    if (!prefixes) return false;
    const lower = String(name).toLowerCase();
    return prefixes.some((prefix) => lower.indexOf(prefix) === 0);
}

// Tool/CLI binaries that must never be packaged, even if a future component
// prefix would otherwise pull them in.
const TOOL_COMPONENTS = new Set([
    "llama-cli", "llama-quantize", "llama-bench", "llama-embedding", "llama-perf",
    "llama-run", "llama-gguf", "llama-gguf-split", "llama-tokenize", "llama-tts",
    "llama-batched", "llama-lookup", "llama-lookup-create", "llama-lookup-stats",
    "llama-passkey", "llama-retrieval", "llama-save-load-state", "llama-simple",
    "llama-speculative", "llama-speculative-simple", "llama-parallel", "llama-gguf-hash",
    "llama-completion", "llama-fit-params", "llama-imatrix", "llama-perplexity",
    "llama-results", "llama-mtmd-debug", "llama-batched-bench"
]);

function componentName(name, platformKey) {
    const base = String(name).split(/[\\/]/).pop();
    if (platformKey === "win-x64") return base.replace(/\.(dll|exe)$/i, "");
    const so = base.indexOf(".so");
    if (so === -1) return base;
    const lib = base.slice(0, so);
    return lib.indexOf("lib") === 0 ? lib.slice(3) : lib;
}

function isLibrary(base, platformKey) {
    return platformKey === "win-x64" ? /\.dll$/i.test(base) : base.indexOf(".so") !== -1;
}

function shouldKeep(name, platformKey, backend) {
    if (platformKey !== "win-x64" && platformKey !== "linux-x64") return false;
    const base = String(name).split(/[\\/]/).pop();
    if (platformKey === "linux-x64" && /\.exe$/i.test(base)) return false;
    const lower = componentName(base, platformKey).toLowerCase();
    if (!lower) return false;
    if (TOOL_COMPONENTS.has(lower)) return false;
    if (lower.indexOf("ggml") === 0) return true;
    // Vendor runtime libraries are kept only for the backend being packaged, so a CUDA
    // pack never drags in ROCm's libraries (or the reverse).
    if (backend && isLibrary(base, platformKey) && backendLibrary(lower, backend)) return true;
    if (isLibrary(base, platformKey)) return RUNTIME_LIBS.has(lower);
    return RUNTIME_EXES.has(lower);
}

// The descriptor a drop-in pack leaves behind at llama/<tag>/packs/<backend>.json. The
// runtime merges it with the base manifest, so an installed pack widens the backend list
// and its files are checksum-verified like the rest of the payload.
function buildPackDescriptor({ backend, platformKey, tag, commit, files }) {
    if (!backend) throw new Error("Pack descriptor needs a backend");
    if (!platformKey) throw new Error("Pack descriptor needs a platformKey");
    return {
        backend: backend,
        platformKey: platformKey,
        version: tag || null,
        commit: commit || null,
        files: files || {}
    };
}

function buildManifest({ tag, commit, platformKey, backends, hashes }) {
    const manifest = { version: tag, commit: commit, platforms: {} };
    manifest.platforms[platformKey] = { backends: backends, files: hashes };
    return manifest;
}

// Extra runtime files that are not inside the llama.cpp archives but must ship with the
// payload. Windows needs the app-local MSVC runtime so the VC++ Redistributable is optional.
const RUNTIME_EXTRA_FILES = {
    "win-x64": ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"],
    "linux-x64": []
};

function runtimeExtraFiles(platformKey) {
    const list = RUNTIME_EXTRA_FILES[platformKey];
    if (!list) throw new Error(`Unsupported platform key: ${platformKey}`);
    return list.slice();
}

// Resolve the extra files to copy. Throws (rather than silently omitting them) when a
// required file is missing, so a Windows build cannot ship without the runtime.
function planExtraFiles({ platformKey, vcruntimeDir, fs, path }) {
    const names = runtimeExtraFiles(platformKey);
    const planned = [];
    for (const name of names) {
        const source = vcruntimeDir ? path.join(vcruntimeDir, name) : null;
        if (!source || !fs.existsSync(source)) {
            throw new Error(`Required runtime file ${name} not found in --vcruntime-dir (${vcruntimeDir || "not set"})`);
        }
        planned.push({ name, source });
    }
    return planned;
}

module.exports = {
    assetName, cudartAssetName, availableBackends, backendAsset, pickAsset,
    shouldKeep, buildManifest, buildPackDescriptor, runtimeExtraFiles, planExtraFiles
};
