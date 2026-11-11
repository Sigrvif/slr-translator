"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Backend = require("../lib/Backend");

const SAMPLE = [
    "Available devices:",
    "  Vulkan0: AMD Radeon RX 7900 XTX (24576 MiB, 24576 MiB free)",
    "  CUDA0: NVIDIA GeForce RTX 4090 (24564 MiB, 24000 MiB free)",
    "  CPU: AMD Ryzen 9 7950X (131072 MiB, 131072 MiB free)",
    ""
].join("\n");

test("parseDeviceList extracts gpu kinds, indices, device tokens and memory", () => {
    const devices = Backend.parseDeviceList(SAMPLE);
    assert.deepStrictEqual(devices, [
        { kind: "vulkan", index: 0, token: "Vulkan0", name: "AMD Radeon RX 7900 XTX", memoryMiB: 24576 },
        { kind: "cuda", index: 0, token: "CUDA0", name: "NVIDIA GeForce RTX 4090", memoryMiB: 24564 },
        { kind: "cpu", index: null, token: "CPU", name: "AMD Ryzen 9 7950X", memoryMiB: 131072 }
    ]);
});

test("selectBackend prefers cuda, then rocm, then vulkan, then cpu", () => {
    const devices = Backend.parseDeviceList(SAMPLE);
    const cuda = Backend.selectBackend({ installedBackends: ["cpu", "vulkan", "cuda"], devices });
    assert.strictEqual(cuda.backend, "cuda");
    assert.strictEqual(cuda.device, "CUDA0");

    const vulkan = Backend.selectBackend({ installedBackends: ["cpu", "vulkan"], devices });
    assert.strictEqual(vulkan.backend, "vulkan");
    assert.strictEqual(vulkan.device, "Vulkan0");

    const cpu = Backend.selectBackend({ installedBackends: ["cpu"], devices });
    assert.strictEqual(cpu.backend, "cpu");
    assert.strictEqual(cpu.device, null);
});

test("an explicit preference is honoured even when a higher-priority backend is available", () => {
    const devices = Backend.parseDeviceList(SAMPLE);
    // auto would pick CUDA here; the preference must win over the priority order.
    const vulkan = Backend.selectBackend({
        installedBackends: ["cpu", "vulkan", "cuda"], devices, preference: "vulkan"
    });
    assert.strictEqual(vulkan.backend, "vulkan");
    assert.strictEqual(vulkan.device, "Vulkan0");
    assert.strictEqual(vulkan.reason, "device-available:vulkan");
});

test("an installed preference with no matching device is refused, not fallen through", () => {
    const devices = Backend.parseDeviceList(SAMPLE);
    const chosen = Backend.selectBackend({
        installedBackends: ["cpu", "vulkan", "rocm"], devices, preference: "rocm"
    });
    assert.strictEqual(chosen.backend, null);
    assert.strictEqual(chosen.reason, "no-device:rocm");
    assert.strictEqual(chosen.device, null);
});

test("a preference whose pack is not installed is refused, not fallen through", () => {
    const devices = Backend.parseDeviceList(SAMPLE);
    const chosen = Backend.selectBackend({
        installedBackends: ["cpu", "vulkan"], devices, preference: "rocm"
    });
    assert.strictEqual(chosen.backend, null);
    assert.strictEqual(chosen.reason, "not-installed:rocm");
});

test("a forced cpu preference reports cpu-forced, not cpu-fallback", () => {
    const devices = Backend.parseDeviceList(SAMPLE);
    const chosen = Backend.selectBackend({
        installedBackends: ["cpu", "vulkan"], devices, preference: "cpu"
    });
    assert.strictEqual(chosen.backend, "cpu");
    assert.strictEqual(chosen.reason, "cpu-forced");
    assert.strictEqual(chosen.device, null);
});

test("no devices at all falls back to cpu", () => {
    assert.strictEqual(
        Backend.selectBackend({ installedBackends: ["cpu"], devices: [] }).backend,
        "cpu"
    );
});
