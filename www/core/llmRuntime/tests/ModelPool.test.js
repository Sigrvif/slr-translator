"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ModelPool = require("../lib/ModelPool");
const EvictionPolicy = require("../lib/EvictionPolicy");

function fakeSpawn() {
    const children = [];
    return {
        children: children,
        spawn: function (args) {
            const child = { args: args, alive: true, killed: false, onExit: null };
            child.kill = function () { child.killed = true; child.alive = false; };
            children.push(child);
            return child;
        }
    };
}
function poolOf(spawner, maxLoaded) {
    return ModelPool.createModelPool({
        spawnChild: spawner.spawn,
        freePort: function () { return Promise.resolve(41000 + spawner.children.length); },
        healthWait: function () { return Promise.resolve(); },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return maxLoaded; }
    });
}

test("two concurrent requests for one model spawn exactly one child", async () => {
    const spawner = fakeSpawn();
    const pool = poolOf(spawner, 1);
    const [a, b] = await Promise.all([pool.ensure("a.gguf", { id: "a.gguf" }), pool.ensure("a.gguf", { id: "a.gguf" })]);
    assert.strictEqual(spawner.children.length, 1);
    assert.strictEqual(a.port, b.port);
    assert.deepStrictEqual(pool.loadedIds(), ["a.gguf"]);
});
test("at models kept loaded 1 a new model stops the previous child", async () => {
    const spawner = fakeSpawn();
    const pool = poolOf(spawner, 1);
    await pool.ensure("a.gguf", { id: "a.gguf" });
    await pool.ensure("b.gguf", { id: "b.gguf" });
    assert.strictEqual(spawner.children[0].killed, true);
    assert.deepStrictEqual(pool.loadedIds(), ["b.gguf"]);
});
test("stopAll kills every child", async () => {
    const spawner = fakeSpawn();
    const pool = poolOf(spawner, 0);
    await pool.ensure("a.gguf", { id: "a.gguf" });
    await pool.ensure("b.gguf", { id: "b.gguf" });
    pool.stopAll();
    assert.deepStrictEqual(pool.loadedIds(), []);
    assert.strictEqual(spawner.children.every(function (c) { return c.killed; }), true);
});
// The process-exit path cannot await the async stop chain, so stopAllSync must reach every
// spawned child - loaded or still mid-load - through the adapter's synchronous kill.
test("stopAllSync kills loaded and pending children synchronously", async () => {
    const spawner = fakeSpawn();
    const syncKilled = [];
    const spawn = function (args) {
        const child = spawner.spawn(args);
        child.killSync = function () { syncKilled.push(child); };
        return child;
    };
    // b's health wait hangs until released: its child exists but is still mid-load.
    const gates = [];
    const pool = ModelPool.createModelPool({
        spawnChild: spawn,
        freePort: function () { return Promise.resolve(46000 + spawner.children.length); },
        healthWait: function (port, id) {
            if (id !== "b.gguf") return Promise.resolve();
            return new Promise(function (resolve, reject) { gates.push(reject); });
        },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return 2; }
    });
    await pool.ensure("a.gguf", { id: "a.gguf" });
    const loading = pool.ensure("b.gguf", { id: "b.gguf" });
    await new Promise(function (r) { setImmediate(r); });
    pool.stopAllSync();
    assert.strictEqual(syncKilled.length, 2, "both the loaded and the mid-load child must be reached synchronously");
    // Release the health wait as a failure (the sync kill just ended that child): the start
    // must settle without ever registering the mid-load child as loaded.
    gates.forEach(function (reject) { reject(new Error("killed")); });
    await loading.then(function () { throw new Error("expected rejection"); }, function () {});
    assert.deepStrictEqual(pool.loadedIds(), ["a.gguf"]);
});
// The compatibility server handle's stop({ timeoutMs }) is a real shutdown grace: the pool
// must hand it to every child's own kill, not silently drop it.
test("stopAll forwards a stop grace to every child", async () => {
    const spawner = fakeSpawn();
    const seen = [];
    const spawn = function (args) {
        const child = spawner.spawn(args);
        child.kill = function (opts) { seen.push(opts); child.killed = true; child.alive = false; };
        return child;
    };
    const pool = ModelPool.createModelPool({
        spawnChild: spawn,
        freePort: function () { return Promise.resolve(45000 + spawner.children.length); },
        healthWait: function () { return Promise.resolve(); },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return 2; }
    });
    await pool.ensure("a.gguf", { id: "a.gguf" });
    await pool.ensure("b.gguf", { id: "b.gguf" });
    pool.stopAll({ timeoutMs: 1234 });
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(seen.every(function (o) { return o && o.timeoutMs === 1234; }), true);
});
test("a child that exits on its own is no longer reported loaded", async () => {
    const spawner = fakeSpawn();
    const pool = poolOf(spawner, 0);
    await pool.ensure("a.gguf", { id: "a.gguf" });
    spawner.children[0].onExit && spawner.children[0].onExit();
    assert.deepStrictEqual(pool.loadedIds(), []);
});

test("concurrent starts for different models respect the capacity limit", async () => {
    const spawner = fakeSpawn();
    const pool = poolOf(spawner, 1);
    await Promise.all([pool.ensure("a.gguf", { id: "a.gguf" }), pool.ensure("b.gguf", { id: "b.gguf" })]);
    assert.strictEqual(spawner.children.length, 2);
    assert.strictEqual(spawner.children.filter(function (c) { return c.alive; }).length, 1);
    assert.strictEqual(pool.loadedIds().length, 1);
});
test("stopping a model during its in-flight start kills it and does not register it", async () => {
    const spawner = fakeSpawn();
    let release;
    const gate = new Promise(function (r) { release = r; });
    let started = false;
    const pool = ModelPool.createModelPool({
        spawnChild: spawner.spawn,
        freePort: function () { return Promise.resolve(42000 + spawner.children.length); },
        healthWait: function () { started = true; return gate; },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return 1; }
    });
    const p = pool.ensure("a.gguf", { id: "a.gguf" }).then(function () { return "resolved"; }, function () { return "cancelled"; });
    while (!started) await new Promise(function (r) { setTimeout(r, 0); });
    pool.stop("a.gguf");
    release();
    const outcome = await p;
    assert.strictEqual(outcome, "cancelled");
    assert.strictEqual(spawner.children[0].killed, true);
    assert.deepStrictEqual(pool.loadedIds(), []);
});
test("a failed start kills the spawned child and lets a retry start", async () => {
    const spawner = fakeSpawn();
    const pool = ModelPool.createModelPool({
        spawnChild: spawner.spawn,
        freePort: function () { return Promise.resolve(43000 + spawner.children.length); },
        healthWait: function () {
            return spawner.children.length === 1 ? Promise.reject(new Error("health timeout")) : Promise.resolve();
        },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return 1; }
    });
    await assert.rejects(pool.ensure("a.gguf", { id: "a.gguf" }), /health timeout/);
    assert.strictEqual(spawner.children[0].killed, true);
    assert.deepStrictEqual(pool.loadedIds(), []);
    await pool.ensure("a.gguf", { id: "a.gguf" });
    assert.strictEqual(spawner.children.length, 2);
    assert.deepStrictEqual(pool.loadedIds(), ["a.gguf"]);
});

// stopAll must reach a child that is spawned but still waiting for health: it is detached on
// Linux, so leaving it to the cancelled check (which only runs when health settles) would leak
// it when the wait never settles.
// A switch must not abort the outgoing model's in-flight generation: with a waitForIdle hook the
// eviction is held until that model reports idle, and the old child stays alive (serving) until
// then. Without a hook the pool behaves exactly as before (covered by the eviction test above).
test("an eviction does not kill the old child until waitForIdle resolves", async () => {
    const spawner = fakeSpawn();
    let release = null;
    const gate = new Promise(function (r) { release = r; });
    const waited = [];
    const pool = ModelPool.createModelPool({
        spawnChild: spawner.spawn,
        freePort: function () { return Promise.resolve(46000 + spawner.children.length); },
        healthWait: function () { return Promise.resolve(); },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return 1; },
        waitForIdle: function (id) { waited.push(id); return gate; }
    });
    await pool.ensure("a.gguf", { id: "a.gguf" });
    let resolved = false;
    const p = pool.ensure("b.gguf", { id: "b.gguf" }).then(function (r) { resolved = true; return r; });
    while (waited.length === 0) await new Promise(function (r) { setTimeout(r, 0); });
    assert.strictEqual(waited[0], "a.gguf");
    // The wait is pending: the old child is still alive and the new one has not spawned.
    assert.strictEqual(spawner.children[0].killed, false, "the old child must not be killed yet");
    assert.strictEqual(spawner.children.length, 1, "the new child must not spawn before the wait");
    assert.strictEqual(resolved, false);
    release();
    await p;
    assert.strictEqual(spawner.children[0].killed, true, "after the wait the old child is evicted");
    assert.deepStrictEqual(pool.loadedIds(), ["b.gguf"]);
});

// A rejected (timed-out) waitForIdle is logged and must not wedge the start: the eviction
// proceeds and the new model loads.
test("a rejecting waitForIdle is logged and the start still proceeds", async () => {
    const spawner = fakeSpawn();
    const logs = [];
    const pool = ModelPool.createModelPool({
        spawnChild: spawner.spawn,
        freePort: function () { return Promise.resolve(47000 + spawner.children.length); },
        healthWait: function () { return Promise.resolve(); },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return 1; },
        onLog: function (line) { logs.push(line); },
        waitForIdle: function () { return Promise.reject(new Error("waitForIdle timeout")); }
    });
    await pool.ensure("a.gguf", { id: "a.gguf" });
    await pool.ensure("b.gguf", { id: "b.gguf" });
    assert.strictEqual(spawner.children[0].killed, true, "the eviction must still happen");
    assert.deepStrictEqual(pool.loadedIds(), ["b.gguf"]);
    assert.strictEqual(logs.some(function (l) { return /waitForIdle failed/.test(l); }), true,
        "the failed wait must be logged");
});

test("stopAll kills an in-flight spawn and makes ensure reject", async () => {
    const spawner = fakeSpawn();
    let release;
    const gate = new Promise(function (r) { release = r; });
    const pool = ModelPool.createModelPool({
        spawnChild: spawner.spawn,
        freePort: function () { return Promise.resolve(44000 + spawner.children.length); },
        healthWait: function () { return gate; },
        planStart: EvictionPolicy.planStart,
        maxLoaded: function () { return 2; }
    });
    const outcome = pool.ensure("a.gguf", { id: "a.gguf" })
        .then(function () { return "resolved"; }, function () { return "cancelled"; });
    while (spawner.children.length === 0) await new Promise(function (r) { setTimeout(r, 0); });
    assert.strictEqual(pool.busy(), true);
    pool.stopAll();
    assert.strictEqual(spawner.children[0].killed, true, "the in-flight child must be killed");
    assert.deepStrictEqual(pool.loadedIds(), []);
    release();
    assert.strictEqual(await outcome, "cancelled");
    assert.strictEqual(pool.busy(), false);
});
