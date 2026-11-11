"use strict";
const test = require("node:test");
const assert = require("node:assert");
const RuntimeState = require("../lib/RuntimeState.js");

function fakeFs(initial) {
    const files = Object.assign({}, initial || {});
    return {
        files,
        existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
        readFileSync: (p) => files[p],
        writeFileSync: (p, text) => { files[p] = text; },
        unlinkSync: (p) => { delete files[p]; }
    };
}

const STATE = {
    version: 1, pid: 4242, port: 1234,
    baseUrl: "http://127.0.0.1:1234", modelId: "m1",
    startedAt: "2026-09-25T11:00:00.000Z"
};

test("statePath lives beside the other runtime data", () => {
    assert.strictEqual(RuntimeState.statePath("/app/data/llama"), "/app/data/llama/runtime.json");
});

test("writeState then readState round-trips", () => {
    const fs = fakeFs();
    RuntimeState.writeState({ path: "/d/runtime.json", fs: fs, state: STATE });
    assert.deepStrictEqual(RuntimeState.readState({ path: "/d/runtime.json", fs: fs }), STATE);
});

test("readState returns null for absent, unparseable and non-object files", () => {
    assert.strictEqual(RuntimeState.readState({ path: "/d/x.json", fs: fakeFs() }), null);
    assert.strictEqual(RuntimeState.readState({ path: "/d/x.json", fs: fakeFs({ "/d/x.json": "not json" }) }), null);
    assert.strictEqual(RuntimeState.readState({ path: "/d/x.json", fs: fakeFs({ "/d/x.json": "[1,2]" }) }), null);
});

test("clearState removes the file and tolerates it already being gone", () => {
    const fs = fakeFs({ "/d/x.json": "{}" });
    RuntimeState.clearState({ path: "/d/x.json", fs: fs });
    assert.strictEqual(fs.existsSync("/d/x.json"), false);
    RuntimeState.clearState({ path: "/d/x.json", fs: fakeFs() }); // must not throw
});

test("isProcessAlive is true only for a live process", () => {
    const alive = () => {};
    const gone = () => { const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; };
    const denied = () => { const e = new Error("EPERM"); e.code = "EPERM"; throw e; };
    assert.strictEqual(RuntimeState.isProcessAlive(4242, alive), true);
    assert.strictEqual(RuntimeState.isProcessAlive(4242, gone), false);
    // EPERM means the process exists but belongs to another user: still alive.
    assert.strictEqual(RuntimeState.isProcessAlive(4242, denied), true);
});

test("isProcessAlive rejects nonsense pids", () => {
    const alive = () => {};
    assert.strictEqual(RuntimeState.isProcessAlive(0, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive(null, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive(undefined, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive("abc", alive), false);
    // Numeric strings must not be coerced into a pid: the state file is user-writable and the
    // pid is later used to signal a process.
    assert.strictEqual(RuntimeState.isProcessAlive("4242", alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive("  42  ", alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive("0x10", alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive("1e3", alive), false);
    // On the shipped engine true would coerce to 1 (pid 1 exists), so it must be rejected.
    assert.strictEqual(RuntimeState.isProcessAlive(true, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive(false, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive([5], alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive({}, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive(NaN, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive(1.5, alive), false);
    assert.strictEqual(RuntimeState.isProcessAlive(-1, alive), false);
    // A Symbol coerces by throwing; it must be rejected without throwing.
    assert.strictEqual(RuntimeState.isProcessAlive(Symbol(), alive), false);
});

test("isProcessAlive is true for this process and on EPERM", () => {
    // A real, live pid must still read alive, using the real process.kill.
    assert.strictEqual(RuntimeState.isProcessAlive(process.pid), true);
    const denied = () => { const e = new Error("EPERM"); e.code = "EPERM"; throw e; };
    assert.strictEqual(RuntimeState.isProcessAlive(process.pid, denied), true);
});

test("isRuntimeLive requires a live process, a healthy server, and the recorded model", async () => {
    const http = {
        get: async (url) => {
            if (url.endsWith("/health")) return { statusCode: 200, body: { status: "ok" } };
            if (url.endsWith("/v1/models")) return { body: { data: [{ id: "m1" }] } };
            throw new Error("unexpected " + url);
        }
    };
    assert.strictEqual(await RuntimeState.isRuntimeLive(STATE, { http: http, verifyProcess: () => true }), true);
    assert.strictEqual(await RuntimeState.isRuntimeLive(STATE, { http: http, verifyProcess: () => false }), false);
});

test("isRuntimeLive is false when the server does not answer", async () => {
    const http = { get: async () => { throw new Error("ECONNREFUSED"); } };
    assert.strictEqual(await RuntimeState.isRuntimeLive(STATE, { http: http, verifyProcess: () => true }), false);
});

test("isRuntimeLive is false when the recorded model is not served", async () => {
    const http = {
        get: async (url) => {
            if (url.endsWith("/health")) return { statusCode: 200, body: { status: "ok" } };
            return { body: { data: [{ id: "something-else" }] } };
        }
    };
    assert.strictEqual(await RuntimeState.isRuntimeLive(STATE, { http: http, verifyProcess: () => true }), false);
});

test("isRuntimeLive rejects a malformed state", async () => {
    const http = { get: async () => ({ statusCode: 200, body: {} }) };
    assert.strictEqual(await RuntimeState.isRuntimeLive(null, { http: http, verifyProcess: () => true }), false);
    assert.strictEqual(await RuntimeState.isRuntimeLive({ pid: 1 }, { http: http, verifyProcess: () => true }), false);
});

test("isRuntimeLive rejects a state without a usable modelId", async () => {
    const http = {
        get: async (url) => {
            if (url.endsWith("/health")) return { statusCode: 200, body: { status: "ok" } };
            // A stub entry with no id: with no modelId to compare, this must not read as live.
            return { body: { data: [{}] } };
        }
    };
    const base = { pid: 4242, baseUrl: "http://127.0.0.1:1234" };
    assert.strictEqual(await RuntimeState.isRuntimeLive(base, { http: http, verifyProcess: () => true }), false);
    assert.strictEqual(
        await RuntimeState.isRuntimeLive(Object.assign({}, base, { modelId: "" }), { http: http, verifyProcess: () => true }),
        false);
    assert.strictEqual(
        await RuntimeState.isRuntimeLive(Object.assign({}, base, { modelId: 7 }), { http: http, verifyProcess: () => true }),
        false);
    assert.strictEqual(
        await RuntimeState.isRuntimeLive(Object.assign({}, base, { modelId: { id: "m1" } }), { http: http, verifyProcess: () => true }),
        false);
});

test("isRuntimeLive skips non-string model ids instead of letting them match", async () => {
    const http = {
        get: async (url) => {
            if (url.endsWith("/health")) return { statusCode: 200, body: { status: "ok" } };
            return { body: { data: [null, {}, { id: 42 }, { id: "m1" }] } };
        }
    };
    assert.strictEqual(await RuntimeState.isRuntimeLive(STATE, { http: http, verifyProcess: () => true }), true);
});

// The /health response shape differs between the manager's RouterClient (which reports `status`)
// and the editor's httpAdapter (which reports `statusCode`). Both must gate a 5xx identically, or
// the editor could attach to a server that is erroring or still loading while the model list
// independently lists the model.
function healthHttp(health, modelId) {
    return {
        get: async (url) => {
            if (url.endsWith("/health")) return health;
            return { body: { data: [{ id: modelId || "m1" }] } };
        }
    };
}

test("isRuntimeLive rejects a 5xx /health reported as status or statusCode", async () => {
    for (const health of [{ status: 500 }, { statusCode: 500 }, { status: 503 }, { statusCode: 503 }]) {
        assert.strictEqual(
            await RuntimeState.isRuntimeLive(STATE, { http: healthHttp(health), verifyProcess: () => true }),
            false,
            JSON.stringify(health));
    }
});

test("isRuntimeLive accepts a healthy /health reported as status or statusCode", async () => {
    for (const health of [{ status: 200 }, { statusCode: 200 }]) {
        assert.strictEqual(
            await RuntimeState.isRuntimeLive(STATE, { http: healthHttp(health), verifyProcess: () => true }),
            true,
            JSON.stringify(health));
    }
});

test("a /health response with no status field is governed by the model check", async () => {
    // Neither field present: the health answer is not treated as an error, so the process and
    // model checks decide. A matching model is live; a different one is not.
    assert.strictEqual(
        await RuntimeState.isRuntimeLive(STATE, { http: healthHttp({ body: { status: "ok" } }), verifyProcess: () => true }),
        true);
    assert.strictEqual(
        await RuntimeState.isRuntimeLive(STATE, { http: healthHttp({ body: { status: "ok" } }, "other"), verifyProcess: () => true }),
        false);
});
