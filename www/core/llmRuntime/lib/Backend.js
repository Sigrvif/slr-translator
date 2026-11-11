"use strict";

const BACKEND_PRIORITY = ["cuda", "rocm", "vulkan", "cpu"];

const DEVICE_RE = /^([A-Za-z]+)(\d*):\s*(.*?)\s*\((\d+)\s*MiB[^)]*\)$/;

function parseDeviceList(stdout) {
    const devices = [];
    for (const raw of String(stdout || "").split(/\r?\n/)) {
        const match = raw.trim().match(DEVICE_RE);
        if (!match) continue;
        devices.push({
            kind: match[1].toLowerCase(),
            index: match[2] === "" ? null : Number(match[2]),
            token: `${match[1]}${match[2]}`,
            name: match[3],
            memoryMiB: Number(match[4])
        });
    }
    return devices;
}

function deviceKinds(backend) {
    if (backend === "cuda") return ["cuda"];
    if (backend === "rocm") return ["rocm", "hip"];
    if (backend === "vulkan") return ["vulkan"];
    return [];
}

function backendAvailable(backend, { installedBackends, devices }) {
    if (backend === "cpu") return true;
    if (!installedBackends.includes(backend)) return false;
    const kinds = deviceKinds(backend);
    return devices.some((device) => kinds.includes(device.kind));
}

// An explicit preference is strict: it is honoured exactly or reported as unusable, never
// silently degraded to another backend - a user who picks rocm must see the start fail with
// the reason, not watch the runtime come up on Vulkan anyway. Only automatic mode (no
// preference) walks the full priority order with CPU as its last resort.
function selectBackend({ installedBackends, devices, preference }) {
    if (preference) {
        if (!backendAvailable(preference, { installedBackends, devices })) {
            const reason = installedBackends.includes(preference)
                ? `no-device:${preference}`
                : `not-installed:${preference}`;
            return { backend: null, reason, device: null };
        }
        if (preference === "cpu") return { backend: "cpu", reason: "cpu-forced", device: null };
        const kinds = deviceKinds(preference);
        const match = devices.find((device) => kinds.includes(device.kind));
        return { backend: preference, reason: `device-available:${preference}`, device: match ? match.token : null };
    }
    for (const backend of BACKEND_PRIORITY) {
        if (!backendAvailable(backend, { installedBackends, devices })) continue;
        if (backend === "cpu") return { backend, reason: "cpu-fallback", device: null };
        const kinds = deviceKinds(backend);
        const match = devices.find((device) => kinds.includes(device.kind));
        return { backend, reason: `device-available:${backend}`, device: match ? match.token : null };
    }
    return { backend: "cpu", reason: "cpu-fallback", device: null };
}

module.exports = { BACKEND_PRIORITY, parseDeviceList, backendAvailable, selectBackend };
