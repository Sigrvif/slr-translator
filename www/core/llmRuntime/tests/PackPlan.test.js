"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PackPlan = require("../lib/PackPlan");

test("assetName maps tag, platform and backend to the official asset name", () => {
    assert.strictEqual(PackPlan.assetName("b10964", "win-x64", "cpu"),
        "llama-b10964-bin-win-cpu-x64.zip");
    assert.strictEqual(PackPlan.assetName("b10964", "win-x64", "vulkan"),
        "llama-b10964-bin-win-vulkan-x64.zip");
    assert.strictEqual(PackPlan.assetName("b10964", "linux-x64", "cpu"),
        "llama-b10964-bin-ubuntu-x64.tar.gz");
    assert.strictEqual(PackPlan.assetName("b10964", "linux-x64", "vulkan"),
        "llama-b10964-bin-ubuntu-vulkan-x64.tar.gz");
});

test("pickAsset finds the asset or throws", () => {
    const assets = [{ name: "a.zip", browser_download_url: "http://x/a.zip", size: 1 }];
    assert.strictEqual(PackPlan.pickAsset(assets, "a.zip").browser_download_url, "http://x/a.zip");
    assert.throws(() => PackPlan.pickAsset(assets, "missing.zip"), /not found in release/);
});

test("shouldKeep keeps llama-server and every runtime library it links against", () => {
    const win = [
        "llama-server.exe", "llama-server-impl.dll", "llama.dll", "llama-common.dll",
        "mtmd.dll", "ggml-base.dll", "ggml.dll", "ggml-cpu-x64.dll", "ggml-vulkan.dll",
        "ggml-rpc.dll", "libomp.dll"
    ];
    for (const f of win) assert.ok(PackPlan.shouldKeep(f, "win-x64"), `win keep ${f}`);

    const linux = [
        "llama-server", "libllama.so", "libllama.so.0", "libllama.so.0.4.1",
        "libllama-server-impl.so", "libllama-common.so.0.4.1", "libmtmd.so.0",
        "libggml-base.so", "libggml-base.so.0.24.0", "libggml.so.0.24.0",
        "libggml-cpu-x64.so", "libggml-vulkan.so"
    ];
    for (const f of linux) assert.ok(PackPlan.shouldKeep(f, "linux-x64"), `linux keep ${f}`);
});

test("shouldKeep drops the CLI and tool binaries", () => {
    const winTools = [
        "llama-cli.exe", "llama-quantize.exe", "llama-bench.exe", "llama.exe",
        "llama-cli-impl.dll", "llama-bench-impl.dll", "llama-quantize-impl.dll",
        "LICENSE-LLVM-OpenMP"
    ];
    for (const f of winTools) assert.ok(!PackPlan.shouldKeep(f, "win-x64"), `win drop ${f}`);

    const linuxTools = [
        "llama-cli", "llama-quantize", "llama-bench", "llama",
        "libllama-cli-impl.so", "libllama-quantize-impl.so", "LICENSE"
    ];
    for (const f of linuxTools) assert.ok(!PackPlan.shouldKeep(f, "linux-x64"), `linux drop ${f}`);
});

test("buildManifest produces the shape resolvePayload validates", () => {
    const manifest = PackPlan.buildManifest({
        tag: "b10964", commit: "deadbeef", platformKey: "linux-x64",
        backends: ["cpu", "vulkan"], hashes: { "llama-server": "abc" }
    });
    assert.strictEqual(manifest.version, "b10964");
    assert.strictEqual(manifest.commit, "deadbeef");
    assert.deepStrictEqual(manifest.platforms["linux-x64"].backends, ["cpu", "vulkan"]);
    assert.strictEqual(manifest.platforms["linux-x64"].files["llama-server"], "abc");
});

test("runtimeExtraFiles lists the app-local MSVC runtime for Windows only", () => {
    assert.deepStrictEqual(PackPlan.runtimeExtraFiles("win-x64"),
        ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"]);
    assert.deepStrictEqual(PackPlan.runtimeExtraFiles("linux-x64"), []);
    assert.throws(() => PackPlan.runtimeExtraFiles("mac-arm64"), /Unsupported platform key/);

    const first = PackPlan.runtimeExtraFiles("win-x64");
    first.push("extra.dll");
    assert.deepStrictEqual(PackPlan.runtimeExtraFiles("win-x64"),
        ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"]);
});

test("planExtraFiles resolves the three Windows files and rejects missing ones", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packplan-"));
    try {
        const names = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];
        for (const n of names) fs.writeFileSync(path.join(dir, n), n);

        const planned = PackPlan.planExtraFiles({ platformKey: "win-x64", vcruntimeDir: dir, fs, path });
        assert.deepStrictEqual(planned.map((p) => p.name), names);
        assert.deepStrictEqual(planned.map((p) => p.source), names.map((n) => path.join(dir, n)));

        assert.deepStrictEqual(
            PackPlan.planExtraFiles({ platformKey: "linux-x64", vcruntimeDir: null, fs, path }), []);

        assert.throws(
            () => PackPlan.planExtraFiles({ platformKey: "win-x64", vcruntimeDir: null, fs, path }),
            /Required runtime file .* not found/);

        fs.rmSync(path.join(dir, "msvcp140.dll"));
        assert.throws(
            () => PackPlan.planExtraFiles({ platformKey: "win-x64", vcruntimeDir: dir, fs, path }),
            /Required runtime file .* not found/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("shouldKeep accepts vendor libraries only for the backend being packaged", () => {
    // CUDA on Windows: versioned runtime DLLs plus the backend itself.
    assert.strictEqual(PackPlan.shouldKeep("ggml-cuda.dll", "win-x64", "cuda"), true);
    assert.strictEqual(PackPlan.shouldKeep("cudart64_12.dll", "win-x64", "cuda"), true);
    assert.strictEqual(PackPlan.shouldKeep("cublas64_12.dll", "win-x64", "cuda"), true);
    assert.strictEqual(PackPlan.shouldKeep("cublasLt64_12.dll", "win-x64", "cuda"), true);
    assert.strictEqual(PackPlan.shouldKeep("nvrtc64_120_0.dll", "win-x64", "cuda"), true);
    // ROCm libraries are not kept while packaging CUDA, and vice versa.
    assert.strictEqual(PackPlan.shouldKeep("amdhip64.dll", "win-x64", "cuda"), false);
    assert.strictEqual(PackPlan.shouldKeep("rocblas.dll", "win-x64", "cuda"), false);
    assert.strictEqual(PackPlan.shouldKeep("ggml-hip.dll", "win-x64", "rocm"), true);
    assert.strictEqual(PackPlan.shouldKeep("amdhip64.dll", "win-x64", "rocm"), true);
    assert.strictEqual(PackPlan.shouldKeep("cudart64_12.dll", "win-x64", "rocm"), false);
    // Linux sonames.
    assert.strictEqual(PackPlan.shouldKeep("libggml-cuda.so", "linux-x64", "cuda"), true);
    assert.strictEqual(PackPlan.shouldKeep("libcublas.so.12", "linux-x64", "cuda"), true);
    assert.strictEqual(PackPlan.shouldKeep("libamdhip64.so", "linux-x64", "rocm"), true);
    // Without a backend argument the old behaviour is unchanged.
    assert.strictEqual(PackPlan.shouldKeep("cudart64_12.dll", "win-x64"), false);
    // Tools stay excluded no matter the backend.
    assert.strictEqual(PackPlan.shouldKeep("llama-quantize.exe", "win-x64", "cuda"), false);
});

test("buildPackDescriptor records the backend, platform and file hashes", () => {
    const descriptor = PackPlan.buildPackDescriptor({
        backend: "cuda", platformKey: "win-x64", tag: "b10964", commit: "abc",
        files: { "ggml-cuda.dll": "hash" }
    });
    assert.deepStrictEqual(descriptor, {
        backend: "cuda", platformKey: "win-x64", version: "b10964", commit: "abc",
        files: { "ggml-cuda.dll": "hash" }
    });
    assert.throws(() => PackPlan.buildPackDescriptor({ platformKey: "win-x64" }), /backend/);
    assert.throws(() => PackPlan.buildPackDescriptor({ backend: "cuda" }), /platformKey/);
});

test("assetName resolves the versioned CUDA and ROCm asset names", () => {
    assert.strictEqual(PackPlan.assetName("b10964", "win-x64", "cuda"),
        "llama-b10964-bin-win-cuda-12.4-x64.zip");
    assert.strictEqual(PackPlan.assetName("b10964", "win-x64", "rocm"),
        "llama-b10964-bin-win-rocm-10.0-x64.zip");
    assert.strictEqual(PackPlan.assetName("b10964", "linux-x64", "rocm"),
        "llama-b10964-bin-ubuntu-rocm-10.0-x64.tar.gz");
});

test("cudartAssetName gives the companion CUDA runtime archive", () => {
    // The CUDA runtime is a second download; the Windows name carries no release tag, the
    // Linux one does.
    assert.strictEqual(PackPlan.cudartAssetName("win-x64", "cuda"),
        "cudart-llama-bin-win-cuda-12.4-x64.zip");
    for (const backend of ["rocm", "vulkan", "cpu"]) {
        assert.throws(() => PackPlan.cudartAssetName("win-x64", backend), /no separate runtime archive/, backend);
    }
});

test("Linux CUDA resolves to the upstream build since it began publishing one", () => {
    // The b10964-era packs had to self-build Linux CUDA because upstream published none;
    // upstream now ships ubuntu-cuda, so the variant maps like any other backend.
    assert.strictEqual(PackPlan.assetName("b11429", "linux-x64", "cuda"),
        "llama-b11429-bin-ubuntu-cuda-12.8-x64.tar.gz");
    assert.strictEqual(PackPlan.cudartAssetName("linux-x64", "cuda", "b11429"),
        "cudart-llama-b11429-bin-ubuntu-cuda-12.8-x64.tar.gz");
    assert.throws(() => PackPlan.cudartAssetName("linux-x64", "cuda", null), /needs the release tag/);
    assert.deepStrictEqual(PackPlan.availableBackends("linux-x64"), ["cpu", "vulkan", "cuda", "rocm"]);
    assert.deepStrictEqual(PackPlan.availableBackends("win-x64"), ["cpu", "vulkan", "cuda", "rocm"]);
});

test("an unknown platform key is rejected", () => {
    assert.throws(() => PackPlan.assetName("b10964", "mac-x64", "cpu"), /Unsupported platform key/);
    assert.throws(() => PackPlan.availableBackends("mac-x64"), /Unsupported platform key/);
});

test("the ROCm filter keeps amd_comgr, which amdhip64 links against", () => {
    // amd_comgr does not start with "amdhip", so a naive prefix list drops it and the backend
    // then fails to load.
    for (const name of ["amd_comgr.dll", "amdhip64_7.dll", "rocm_kpack.dll", "ggml-hip.dll"]) {
        assert.strictEqual(PackPlan.shouldKeep(name, "win-x64", "rocm"), true, name);
    }
    // Linux sonames go through the lib/.so stripping, so the same rule has to hold there.
    assert.strictEqual(PackPlan.shouldKeep("libamdhip64.so.7", "linux-x64", "rocm"), true);
    assert.strictEqual(PackPlan.shouldKeep("libamd_comgr.so.2", "linux-x64", "rocm"), true);
    // A CUDA pack must never drag in AMD libraries, or the reverse.
    assert.strictEqual(PackPlan.shouldKeep("amd_comgr.dll", "win-x64", "cuda"), false);
    assert.strictEqual(PackPlan.shouldKeep("cudart64_12.dll", "win-x64", "rocm"), false);
});
