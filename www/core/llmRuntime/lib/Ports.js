// www/core/llmRuntime/lib/Ports.js
"use strict";
const net = require("net");

function probePort(port, host) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.on("error", () => resolve(false));
        server.listen({ port, host, exclusive: true }, () => {
            server.close(() => resolve(true));
        });
    });
}

async function findFreePort(opts) {
    const options = opts || {};
    const start = options.start === undefined ? 8730 : options.start;
    const end = options.end === undefined ? 8830 : options.end;
    const host = options.host || "127.0.0.1";
    const probe = options.probe || probePort;
    for (let port = start; port <= end; port++) {
        if (await probe(port, host)) return port;
    }
    throw new Error(`No free port in range ${start}-${end} on ${host}`);
}

// Resolve the port to serve on. A port the user (or the console launcher) asked for is used
// exactly or not at all: silently scanning forward would publish a different address than the
// one configured, and an external tool pointed at it would fail with no obvious cause. The scan
// is the fallback only when nothing specific was requested.
async function resolvePort(opts) {
    const options = opts || {};
    const probe = options.probe || probePort;
    const preferred = options.preferred === undefined ? null : options.preferred;
    if (preferred !== null && preferred !== "" && isFinite(Number(preferred))) {
        const port = Number(preferred);
        if (await probe(port, options.host || "127.0.0.1")) return port;
        throw new Error(`port ${port} is already in use`);
    }
    return findFreePort(options);
}

function describePortValue(value) {
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) return "an array";
    if (value !== null && typeof value === "object") return "an object";
    return String(value);
}

function portReason(value) {
    return "invalid port " + describePortValue(value) +
        " (must be a whole number between 1 and 65535)";
}

// Normalize a configured port into either a concrete port or "use the shipped default".
// Returns { ok: true, port: <number|null> } or { ok: false, reason: <string> }. The caller must
// refuse the start on a rejection - silently substituting 1234 would publish a different address
// than the one configured.
//
// Absent values (undefined, null, "" or whitespace only) mean "use the shipped default" and come
// back as { ok: true, port: null }. A string is trimmed first, so " 4321 " is accepted as 4321;
// after trimming it must be all digits, so "042" is accepted as 42 (a plain decimal spelling, not
// octal) while "1e2", "0x50", "0b101" and "1.5" are rejected. Numbers must be finite integers in
// range: 1.5, Infinity and NaN are rejected, as are booleans, objects and arrays.
function normalizePort(value) {
    if (value === undefined || value === null) return { ok: true, port: null };
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") return { ok: true, port: null };
        if (!/^[0-9]+$/.test(trimmed)) return { ok: false, reason: portReason(value) };
        const fromString = Number(trimmed);
        if (!isFinite(fromString) || fromString < 1 || fromString > 65535) {
            return { ok: false, reason: portReason(value) };
        }
        return { ok: true, port: fromString };
    }
    if (typeof value === "number") {
        if (!isFinite(value) || Math.floor(value) !== value || value < 1 || value > 65535) {
            return { ok: false, reason: portReason(value) };
        }
        return { ok: true, port: value };
    }
    return { ok: false, reason: portReason(value) };
}

module.exports = { probePort, findFreePort, resolvePort, normalizePort };
