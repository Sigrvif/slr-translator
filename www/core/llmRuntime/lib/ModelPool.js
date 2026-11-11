// www/core/llmRuntime/lib/ModelPool.js
//
// Child lifecycle for per-model llama-server processes. One model id maps to at most one running
// child; concurrent requests for the same id share the single in-flight start. Starts are serialised
// through an internal promise chain so the capacity check and the spawn are atomic across different
// models too. When the configured limit is reached, the least-recently-used loaded model is stopped
// first (EvictionPolicy decides). Stopping a model mid-start cancels it: the child is killed and is
// never registered.
"use strict";
const ModelArgs = require("./ModelArgs");

function createModelPool(opts) {
    const o = opts || {};
    const log = o.onLog || function () {};
    const loaded = [];
    const inflight = {};
    const cancelled = {};
    // Children spawned for a start that has not finished its health wait yet. stopAll/stop must
    // be able to reach these too: a child is detached on Linux, so a start interrupted before it
    // registers would otherwise outlive the app as an orphan.
    const pending = {};
    // Per-id reject signal raced against the health wait, so a stop cancels an in-flight start
    // immediately instead of waiting out the health timeout.
    const cancelSignals = {};
    let chain = Promise.resolve();

    function findLoaded(id) {
        for (let i = 0; i < loaded.length; i++) if (loaded[i].id === id) return loaded[i];
        return null;
    }
    function removeLoaded(id) {
        for (let i = 0; i < loaded.length; i++) {
            if (loaded[i].id === id) { loaded.splice(i, 1); return; }
        }
    }
    function touch(entry) {
        removeLoaded(entry.id);
        loaded.push(entry);
    }
    function killChild(child, opts) {
        if (!child) return;
        try { if (typeof child.kill === "function") child.kill(opts); }
        catch (e) { log("could not stop child: " + (e && e.message ? e.message : e)); }
    }
    function limit() {
        return typeof o.maxLoaded === "function" ? o.maxLoaded() : o.maxLoaded;
    }
    function loadedIds() {
        const ids = [];
        for (let i = 0; i < loaded.length; i++) ids.push(loaded[i].id);
        return ids;
    }
    // True while any start is in flight (queued, spawning, or waiting for health). Callers use
    // this to tell "the pool is empty because a model is about to load" from "nothing is loaded".
    function busy() {
        for (const id in inflight) return true;
        for (const id in pending) return true;
        return false;
    }
    function enqueue(task) {
        const run = chain.then(task, task);
        chain = run.then(function () {}, function () {});
        return run;
    }
    function killRecord(record, opts) {
        if (!record) return;
        if (record.child) record.child.onExit = null;
        killChild(record.child, opts);
    }
    function cancellationSignal(id) {
        if (!cancelSignals[id]) {
            let reject;
            const promise = new Promise(function (resolve, rej) { reject = rej; });
            cancelSignals[id] = { promise: promise, reject: reject };
        }
        return cancelSignals[id];
    }
    function finishCancellation(id) {
        delete cancelSignals[id];
    }
    // Cancel an in-flight start for id: mark it, kill a spawned-but-unregistered child, and
    // reject its health wait so ensure() settles now rather than at the health timeout.
    function cancelStart(id, opts) {
        cancelled[id] = true;
        const record = pending[id];
        if (record) { delete pending[id]; killRecord(record, opts); }
        const signal = cancelSignals[id];
        if (signal) {
            delete cancelSignals[id];
            try { signal.reject(new Error("model start cancelled: " + id)); } catch (e) { /* already settled */ }
        }
    }
    function stopNow(id, opts) {
        const entry = findLoaded(id);
        if (entry) { removeLoaded(id); killRecord(entry, opts); }
        const inFlight = pending[id];
        if (inFlight) { delete pending[id]; killRecord(inFlight, opts); }
    }
    // Stop the models the eviction plan named. When a waitForIdle hook is injected, each
    // victim is only killed once that model reports no in-flight request, so a generation is
    // allowed to finish rather than being aborted ("slow rather than crash"). A rejected or
    // timed-out wait is logged and the eviction proceeds anyway, so a wedged hook can never
    // block a start forever. Without a hook this is exactly the old synchronous stop loop.
    function runEviction(evict, id) {
        const waitForIdle = typeof o.waitForIdle === "function" ? o.waitForIdle : null;
        let i = 0;
        function next() {
            if (i >= evict.length) return Promise.resolve();
            // A stop that landed mid-wait cancels the start; do not kill further victims.
            if (cancelled[id]) return Promise.resolve();
            const victim = evict[i++];
            if (!waitForIdle) { stopNow(victim); return next(); }
            return Promise.resolve()
                .then(function () { return waitForIdle(victim); })
                .then(function () { stopNow(victim); }, function (err) {
                    log("waitForIdle failed for " + victim + ": " +
                        (err && err.message ? err.message : err) + "; evicting anyway");
                    stopNow(victim);
                })
                .then(next);
        }
        return next();
    }
    function startNow(id, entry) {
        // A stop that landed before this queued task ran: never spawn at all.
        if (cancelled[id]) {
            delete cancelled[id];
            return Promise.reject(new Error("model start cancelled: " + id));
        }
        let evict = [];
        try { evict = o.planStart({ loaded: loadedIds(), requested: id, maxLoaded: limit() }) || []; }
        catch (e) { log("planStart failed: " + (e && e.message ? e.message : e)); evict = []; }
        return runEviction(evict, id)
            .then(function () {
                if (cancelled[id]) { delete cancelled[id]; throw new Error("model start cancelled: " + id); }
                return o.freePort();
            })
            .then(function (port) {
                // A stop during the port lookup: still do not spawn.
                if (cancelled[id]) { delete cancelled[id]; throw new Error("model start cancelled: " + id); }
                const args = ModelArgs.buildModelArgs(entry, { host: o.host || "127.0.0.1", port: port });
                const child = o.spawnChild(args);
                const record = { id: id, port: port, child: child };
                pending[id] = record;
                if (child) child.onExit = function () { removeLoaded(id); };
                const signal = cancellationSignal(id);
                return Promise.race([
                    // The id travels with the port: a port can be reused by the child replacing an
                    // evicted one before the evicted process has fully exited, so the waiter must
                    // watch the child it actually started, not whatever the port last mapped to.
                    Promise.resolve().then(function () { return o.healthWait(port, id); }),
                    signal.promise
                ])
                    .then(function () {
                        finishCancellation(id);
                        if (pending[id] === record) delete pending[id];
                        // A stop during the health wait cancels the start; kill the child (it may
                        // already be dead) and reject so the caller never reports it ready.
                        if (cancelled[id]) { killRecord(record); throw new Error("model start cancelled: " + id); }
                        loaded.push(record);
                        return { port: port };
                    })
                    .catch(function (err) {
                        finishCancellation(id);
                        if (pending[id] === record) delete pending[id];
                        killRecord(record);
                        delete cancelled[id];
                        throw err;
                    });
            });
    }
    function start(id, entry) {
        return enqueue(function () { return startNow(id, entry); });
    }

    function ensure(id, entry) {
        const existing = findLoaded(id);
        if (existing) { touch(existing); return Promise.resolve({ port: existing.port }); }
        if (inflight[id]) return inflight[id];
        const p = start(id, entry);
        inflight[id] = p;
        p.then(function () { if (inflight[id] === p) delete inflight[id]; },
               function () { if (inflight[id] === p) delete inflight[id]; });
        return p;
    }
    function stop(id) {
        if (inflight[id] && !findLoaded(id)) cancelStart(id);
        return enqueue(function () { stopNow(id); });
    }
    function stopAll(opts) {
        for (const id in inflight) cancelStart(id, opts);
        // Any pending child whose start is not (or no longer) tracked as in-flight.
        for (const id in pending) cancelStart(id, opts);
        const entries = loaded.slice();
        for (let i = 0; i < entries.length; i++) stopNow(entries[i].id, opts);
    }
    // Synchronous kill of every spawned child (loaded or still mid-load) for process-exit
    // paths: the async stop chain cannot run once the process is exiting, so each child
    // adapter's killSync (taskkill /F /T or a sync signal) is what actually reaps them.
    function stopAllSync() {
        const ids = Object.keys(pending);
        for (let i = 0; i < ids.length; i++) {
            const child = pending[ids[i]] && pending[ids[i]].child;
            if (child && typeof child.killSync === "function") child.killSync();
        }
        for (let i = 0; i < loaded.length; i++) {
            const child = loaded[i].child;
            if (child && typeof child.killSync === "function") child.killSync();
        }
    }

    return { ensure: ensure, loadedIds: loadedIds, busy: busy, stop: stop, stopAll: stopAll, stopAllSync: stopAllSync };
}

module.exports = { createModelPool };
