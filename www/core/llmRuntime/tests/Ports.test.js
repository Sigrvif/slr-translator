// www/core/llmRuntime/tests/Ports.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Ports = require("../lib/Ports");

test("findFreePort returns the first port the probe accepts", async () => {
    const taken = new Set([8730, 8731]);
    const port = await Ports.findFreePort({
        start: 8730, end: 8735, probe: async (p) => !taken.has(p)
    });
    assert.strictEqual(port, 8732);
});

test("findFreePort rejects when the range is exhausted", async () => {
    await assert.rejects(
        () => Ports.findFreePort({ start: 8730, end: 8731, probe: async () => false }),
        /No free port/
    );
});

test("probePort reports false for a port that is already bound", async () => {
    const net = require("node:net");
    const held = net.createServer();
    await new Promise((resolve) => held.listen({ port: 0, host: "127.0.0.1" }, resolve));
    const inUse = held.address().port;
    try {
        assert.strictEqual(await Ports.probePort(inUse, "127.0.0.1"), false);
    } finally {
        await new Promise((resolve) => held.close(resolve));
    }
});

test("resolvePort uses the preferred port when it is free", async () => {
    const port = await Ports.resolvePort({
        preferred: 1234, start: 8730, end: 8735, probe: async () => true
    });
    assert.strictEqual(port, 1234);
});

test("resolvePort fails loudly when the preferred port is taken, without drifting", async () => {
    const probed = [];
    await assert.rejects(
        () => Ports.resolvePort({
            preferred: 1234, start: 8730, end: 8735,
            probe: async (p) => { probed.push(p); return p !== 1234; }
        }),
        /port 1234 is already in use/i
    );
    // The scan range must not have been consulted: drifting would publish an address the
    // user did not ask for.
    assert.deepStrictEqual(probed, [1234]);
});

test("resolvePort scans when no preferred port is set", async () => {
    const taken = new Set([8730, 8731]);
    const port = await Ports.resolvePort({
        preferred: null, start: 8730, end: 8735, probe: async (p) => !taken.has(p)
    });
    assert.strictEqual(port, 8732);
});

// normalizePort is the single decision behind the "configured port is used exactly or the start
// fails" rule. These tests drive the real helper, not a copy of its arithmetic.

test("normalizePort treats absent values as the shipped default", () => {
    for (const absent of [undefined, null, "", "   ", "\t\n"]) {
        assert.deepStrictEqual(Ports.normalizePort(absent), { ok: true, port: null }, JSON.stringify(absent));
    }
});

test("normalizePort accepts a plain decimal integer in 1..65535", () => {
    assert.deepStrictEqual(Ports.normalizePort(4321), { ok: true, port: 4321 });
    assert.deepStrictEqual(Ports.normalizePort("4321"), { ok: true, port: 4321 });
    assert.deepStrictEqual(Ports.normalizePort(1), { ok: true, port: 1 });
    assert.deepStrictEqual(Ports.normalizePort(65535), { ok: true, port: 65535 });
    // Documented decision: the string is trimmed before the digits are checked.
    assert.deepStrictEqual(Ports.normalizePort(" 4321 "), { ok: true, port: 4321 });
    // A leading zero is a plain decimal spelling, not octal.
    assert.deepStrictEqual(Ports.normalizePort("042"), { ok: true, port: 42 });
});

test("normalizePort rejects everything else, with a reason naming the value", () => {
    const invalid = [0, -1, 65536, 70000, 1.5, "1.5", "abc", "1e2", "0x50", "0b101",
        Infinity, NaN, true, false, {}, []];
    for (const value of invalid) {
        const result = Ports.normalizePort(value);
        assert.strictEqual(result.ok, false, String(value));
        assert.strictEqual(typeof result.reason, "string");
        assert.match(result.reason, /between 1 and 65535/, String(value));
    }
    // The offending value is named so the Start handler's error is actionable.
    assert.match(Ports.normalizePort("abc").reason, /"abc"/);
    assert.match(Ports.normalizePort(70000).reason, /70000/);
    assert.match(Ports.normalizePort(1.5).reason, /1\.5/);
    assert.match(Ports.normalizePort(Infinity).reason, /Infinity/);
    assert.match(Ports.normalizePort({}).reason, /an object/);
    assert.match(Ports.normalizePort([]).reason, /an array/);
});
