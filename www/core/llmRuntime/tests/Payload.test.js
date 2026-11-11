"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Payload = require("../lib/Payload");

function tmpRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "llmruntime-"));
}

function writePayload(root, version, platformKey, files, dirName) {
    const runtimeDir = path.join(root, dirName || "runtime", version);
    const dir = path.join(runtimeDir, platformKey);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { version, commit: "testcommit", platforms: {} };
    manifest.platforms[platformKey] = { backends: ["cpu", "vulkan"], files: {} };
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content);
        manifest.platforms[platformKey].files[name] =
            crypto.createHash("sha256").update(content).digest("hex");
    }
    fs.writeFileSync(
        path.join(runtimeDir, "manifest.json"),
        JSON.stringify(manifest, null, 2)
    );
    return manifest;
}

test("platformDir maps supported platforms and rejects others", () => {
    assert.strictEqual(Payload.platformDir("win32", "x64"), "win-x64");
    assert.strictEqual(Payload.platformDir("linux", "x64"), "linux-x64");
    assert.throws(() => Payload.platformDir("darwin", "arm64"), /Unsupported platform/);
    assert.throws(() => Payload.platformDir("linux", "arm64"), /Unsupported arch/);
});

test("serverBinaryName differs on Windows", () => {
    assert.strictEqual(Payload.serverBinaryName("win32"), "llama-server.exe");
    assert.strictEqual(Payload.serverBinaryName("linux"), "llama-server");
});

test("resolvePayload reads and validates the pinned manifest", () => {
    const root = tmpRoot();
    writePayload(root, "b10964", "linux-x64", { "llama-server": "bin" });
    const resolved = Payload.resolvePayload({
        rootDir: root, version: "b10964", platform: "linux", arch: "x64", fs
    });
    assert.strictEqual(resolved.dir, path.join(root, "runtime", "b10964", "linux-x64"));
    assert.strictEqual(resolved.serverBinary, path.join(resolved.dir, "llama-server"));
    assert.deepStrictEqual(resolved.manifest.platforms["linux-x64"].backends, ["cpu", "vulkan"]);
});

test("resolvePayload reads a custom runtime directory name", () => {
    const root = tmpRoot();
    writePayload(root, "b10964", "linux-x64", { "llama-server": "bin" }, "runtime");
    const resolved = Payload.resolvePayload({
        rootDir: root, version: "b10964", platform: "linux", arch: "x64", fs, dirName: "runtime"
    });
    assert.strictEqual(resolved.root, path.join(root, "runtime", "b10964"));
    assert.strictEqual(resolved.dir, path.join(root, "runtime", "b10964", "linux-x64"));
    assert.strictEqual(resolved.serverBinary, path.join(resolved.dir, "llama-server"));
    assert.strictEqual(Payload.runtimeRoot(root, "b10964", "runtime"), path.join(root, "runtime", "b10964"));
    assert.strictEqual(Payload.runtimeRoot(root, "b10964"), path.join(root, "runtime", "b10964"));
});

test("resolvePayload throws when the manifest is missing", () => {
    const root = tmpRoot();
    assert.throws(
        () => Payload.resolvePayload({
            rootDir: root, version: "b10964", platform: "linux", arch: "x64", fs
        }),
        /Runtime manifest not found/
    );
});

test("verifyPayload reports corrupted files", () => {
    const root = tmpRoot();
    const manifest = writePayload(root, "b10964", "linux-x64", {
        "llama-server": "good", "libggml-cpu.so": "good"
    });
    const dir = path.join(root, "runtime", "b10964", "linux-x64");
    fs.writeFileSync(path.join(dir, "llama-server"), "tampered");
    const bad = Payload.verifyPayload({ dir, manifest, platformKey: "linux-x64", fs, crypto });
    assert.deepStrictEqual(bad, ["llama-server"]);
});

// Write a pack descriptor (and optionally its library file) next to a payload.
function writePack(root, version, descriptor, libName, libContent) {
    const runtimeDir = path.join(root, "runtime", version);
    const dir = path.join(runtimeDir, descriptor.platformKey);
    if (libName !== undefined) fs.writeFileSync(path.join(dir, libName), libContent);
    const packsDir = path.join(runtimeDir, "packs");
    fs.mkdirSync(packsDir, { recursive: true });
    fs.writeFileSync(path.join(packsDir, descriptor.backend + ".json"), JSON.stringify(descriptor, null, 2));
}

test("resolvePayload merges an installed drop-in pack into the manifest", () => {
    const root = tmpRoot();
    writePayload(root, "b10964", "linux-x64", { "llama-server": "x", "libggml-cpu.so": "y" });
    const hash = crypto.createHash("sha256").update("cuda").digest("hex");
    writePack(root, "b10964", {
        backend: "cuda", platformKey: "linux-x64", version: "b10964",
        files: { "libggml-cuda.so": hash }
    }, "libggml-cuda.so", "cuda");

    const payload = Payload.resolvePayload({
        rootDir: root, version: "b10964", platform: "linux", arch: "x64", fs
    });
    assert.deepStrictEqual(payload.manifest.platforms["linux-x64"].backends, ["cpu", "vulkan", "cuda"]);
    assert.strictEqual(payload.manifest.platforms["linux-x64"].files["libggml-cuda.so"], hash);
    assert.deepStrictEqual(payload.packs.backends, ["cuda"]);
    // The pack's file is verified alongside the base payload.
    const bad = Payload.verifyPayload({
        dir: payload.dir, manifest: payload.manifest, platformKey: "linux-x64", fs, crypto
    });
    assert.deepStrictEqual(bad, []);
});

test("resolvePayload ignores a pack for another platform or a broken descriptor", () => {
    const root = tmpRoot();
    writePayload(root, "b10964", "linux-x64", { "llama-server": "x" });
    writePack(root, "b10964", { backend: "cuda", platformKey: "win-x64", files: { "ggml-cuda.dll": "h" } });
    writePack(root, "b10964", { backend: "rocm", platformKey: "linux-x64", files: "not-an-object" });
    const packsDir = path.join(root, "runtime", "b10964", "packs");
    fs.writeFileSync(path.join(packsDir, "broken.json"), "{ not json");

    const payload = Payload.resolvePayload({
        rootDir: root, version: "b10964", platform: "linux", arch: "x64", fs
    });
    assert.deepStrictEqual(payload.manifest.platforms["linux-x64"].backends, ["cpu", "vulkan"]);
    assert.deepStrictEqual(payload.packs.backends, []);
});

test("readPacks does not duplicate a backend that is already in the base manifest", () => {
    const root = tmpRoot();
    writePayload(root, "b10964", "linux-x64", { "llama-server": "x" });
    writePack(root, "b10964", {
        backend: "vulkan", platformKey: "linux-x64", files: { "libggml-vulkan.so": "h" }
    });
    const payload = Payload.resolvePayload({
        rootDir: root, version: "b10964", platform: "linux", arch: "x64", fs
    });
    assert.deepStrictEqual(payload.manifest.platforms["linux-x64"].backends, ["cpu", "vulkan"]);
});
