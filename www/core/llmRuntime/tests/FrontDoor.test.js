"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const FrontDoor = require("../lib/FrontDoor");

function getJson(port, path, method, body) {
    return new Promise(function (resolve, reject) {
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const headers = payload ? { "content-type": "application/json", "content-length": payload.length } : {};
        const req = http.request({ host: "127.0.0.1", port: port, path: path, method: method || "GET", headers: headers },
            function (res) {
                const chunks = [];
                res.on("data", function (c) { chunks.push(c); });
                res.on("end", function () {
                    const text = Buffer.concat(chunks).toString("utf8");
                    let parsed;
                    try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { body: text }; }
                    if (!parsed || typeof parsed !== "object") parsed = { body: parsed };
                    parsed.status = res.statusCode;
                    resolve(parsed);
                });
            });
        req.on("error", reject);
        if (payload) req.end(payload); else req.end();
    });
}

// Post an already-serialised payload so a test can prove the front door forwarded the caller's
// exact bytes (or did not), rather than comparing two re-serialisations of the same object.
function postRaw(port, path, payload) {
    return new Promise(function (resolve, reject) {
        const req = http.request({ host: "127.0.0.1", port: port, path: path, method: "POST",
            headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
            function (res) {
                const chunks = [];
                res.on("data", function (c) { chunks.push(c); });
                res.on("end", function () {
                    const text = Buffer.concat(chunks).toString("utf8");
                    let parsed;
                    try { parsed = JSON.parse(text); } catch (e) { parsed = { body: text }; }
                    if (!parsed || typeof parsed !== "object") parsed = { body: parsed };
                    parsed.status = res.statusCode;
                    resolve(parsed);
                });
            });
        req.on("error", reject);
        req.end(payload);
    });
}

function listen(server) {
    return new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
}
function close(server) {
    return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}
function waitFor(cond, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 2000);
    return new Promise(function (resolve, reject) {
        (function poll() {
            let ok = false;
            try { ok = !!cond(); } catch (err) { ok = false; }
            if (ok) { resolve(); return; }
            if (Date.now() > deadline) { reject(new Error("condition not met in time")); return; }
            setTimeout(poll, 5);
        })();
    });
}

function backend() {
    const srv = http.createServer((req, res) => {
        if (req.url === "/v1/chat/completions") {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write("data: {\"a\":1}\n\n");
            setTimeout(() => { res.write("data: {\"a\":2}\n\n"); res.end("data: [DONE]\n\n"); }, 40);
            return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ path: req.url, model: null }));
    });
    return srv;
}

function crashBackend() {
    const srv = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write("{\"partial\":");
        setTimeout(() => { res.socket.destroy(); }, 20);
    });
    return srv;
}

function echoBackend() {
    const srv = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") }));
        });
    });
    return srv;
}

// Answers the first request with a 500 whose message is `rejectMessage`, and every later request
// with a 200; records each request body in `seen` so a test can count attempts and inspect them.
function flakyBackend(rejectMessage) {
    const srv = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            srv.seen.push(Buffer.concat(chunks).toString("utf8"));
            if (srv.seen.length === 1) {
                res.writeHead(500, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: { message: rejectMessage } }));
                return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        });
    });
    srv.seen = [];
    return srv;
}

test("routes by the model field and streams the response unbuffered", async (t) => {
    const back = backend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf", "b.gguf"],
        ensureModel: async (id) => ({ port: backPort }),
        getProps: (id) => ({ model_alias: id, default_generation_settings: { n_ctx: 8192 } }),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const seen = [];
    await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: addr.port, path: "/v1/chat/completions", method: "POST",
            headers: { "content-type": "application/json" } }, (res) => {
            res.on("data", (b) => seen.push(Date.now()));
            res.on("end", resolve);
        });
        req.on("error", reject);
        req.end(JSON.stringify({ model: "b.gguf", stream: true, messages: [] }));
    });
    assert.ok(seen.length >= 3, "expected the SSE chunks to arrive separately");
    const props = await getJson(addr.port, "/props");
    assert.strictEqual(props.default_generation_settings.n_ctx, 8192);
    const notFound = await getJson(addr.port, "/v1/chat/completions", "POST", { model: "nope.gguf" });
    assert.strictEqual(notFound.status, 404);
});

test("serves /health and /v1/models and answers 503 for status paths without starting a model", async (t) => {
    let ensured = 0;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        ensureModel: async () => { ensured += 1; return { port: 1 }; },
        getProps: (id) => ({ model_alias: id, default_generation_settings: { n_ctx: 4096 } }),
        getModelsList: () => ({ object: "list", data: [{ id: "a.gguf", object: "model" }] }),
        loadedPort: () => null,
        defaultId: () => ""
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const health = await getJson(addr.port, "/health");
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(health, { status: "ok", status: 200 });
    const models = await getJson(addr.port, "/v1/models");
    assert.strictEqual(models.status, 200);
    assert.deepStrictEqual(models.data, [{ id: "a.gguf", object: "model" }]);
    const metrics = await getJson(addr.port, "/metrics");
    assert.strictEqual(metrics.status, 503);
    const slots = await getJson(addr.port, "/slots");
    assert.strictEqual(slots.status, 503);
    assert.strictEqual(ensured, 0, "status paths must not start a model");
});

test("a loaded instance is proxied for /metrics and /props honors an explicit model name", async (t) => {
    const back = backend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf", "b.gguf"],
        defaultId: () => "b.gguf",
        ensureModel: async () => ({ port: backPort }),
        getProps: (id) => ({ model_alias: id, default_generation_settings: { n_ctx: 2048 } }),
        getModelsList: () => ({ object: "list", data: [] }),
        loadedPort: () => backPort
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const metrics = await getJson(addr.port, "/metrics");
    assert.strictEqual(metrics.status, 200);
    assert.strictEqual(metrics.path, "/metrics");
    const props = await getJson(addr.port, "/props?model=" + encodeURIComponent("a.gguf"));
    assert.strictEqual(props.status, 200);
    assert.strictEqual(props.model_alias, "a.gguf");
    const badProps = await getJson(addr.port, "/props?model=nope.gguf");
    assert.strictEqual(badProps.status, 404);
});

test("an upstream failure after headers are sent does not write a second response", async (t) => {
    const back = crashBackend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] }),
        loadedPort: () => backPort
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const outcome = await new Promise((resolve) => {
        const req = http.request({ host: "127.0.0.1", port: addr.port, path: "/metrics", method: "GET" }, (res) => {
            res.on("end", () => resolve("end"));
            res.on("aborted", () => resolve("aborted"));
            res.on("error", () => resolve("error"));
            res.resume();
        });
        req.on("error", () => resolve("req-error"));
        req.end();
    });
    assert.notStrictEqual(outcome, "end", "the client must see a broken response, not a complete one");
});

test("the buffered proxy path drops transfer-encoding and sets a correct content-length", async (t) => {
    const back = echoBackend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const payload = JSON.stringify({ model: "a.gguf", stream: false, messages: [] });
    const echo = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: addr.port, path: "/v1/chat/completions", method: "POST",
            headers: { "content-type": "application/json", "transfer-encoding": "chunked" } }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
    assert.strictEqual(echo.headers["transfer-encoding"], undefined, "transfer-encoding must be stripped");
    assert.strictEqual(echo.headers["content-length"], String(Buffer.byteLength(payload)));
    assert.strictEqual(echo.body, payload);
});

test("a request body over the cap is rejected with 413 without starting a model", async (t) => {
    let ensured = 0;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => { ensured += 1; return { port: 1 }; },
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const big = Buffer.alloc(FrontDoor.MAX_BODY + 1, 0x20);
    const status = await new Promise((resolve) => {
        const req = http.request({ host: "127.0.0.1", port: addr.port, path: "/v1/chat/completions", method: "POST",
            headers: { "content-type": "application/json", "content-length": big.length } }, (res) => {
            const code = res.statusCode;
            res.resume();
            res.on("end", () => resolve(code));
            res.on("error", () => resolve(code));
        });
        req.on("error", () => resolve(0));
        req.end(big);
    });
    assert.strictEqual(status, 413);
    assert.strictEqual(ensured, 0);
});

test("an unknown model is 404 with model_not_found, and an absent model routes to the default", async (t) => {
    const back = backend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const ensured = [];
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf", "b.gguf"],
        defaultId: () => "b.gguf",
        ensureModel: async (id) => { ensured.push(id); return { port: backPort }; },
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const unknown = await getJson(addr.port, "/v1/chat/completions", "POST", { model: "nope.gguf", messages: [] });
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(unknown.error.code, "model_not_found");
    const routed = await getJson(addr.port, "/v1/chat/completions", "POST", { messages: [] });
    assert.strictEqual(routed.status, 200);
    assert.deepStrictEqual(ensured, ["b.gguf"]);
});

// Task 10: each loaded model's own instance is reached by ?model=, not whatever happens to be
// the default, and a status read never starts a model.
test("metrics and slots route to the model named by ?model=, and never start one", async (t) => {
    function tagged(tag) {
        return http.createServer((req, res) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ tag: tag, path: req.url }));
        });
    }
    const a = tagged("a"), b = tagged("b");
    await listen(a); await listen(b);
    t.after(() => close(a)); t.after(() => close(b));
    const pa = a.address().port, pb = b.address().port;
    let ensured = 0;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf", "b.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => { ensured += 1; return { port: pa }; },
        getProps: (id) => ({ model_alias: id }),
        getModelsList: () => ({ object: "list", data: [] }),
        loadedPort: (id) => id === "a.gguf" ? pa : id === "b.gguf" ? pb : null
    });
    const addr = await door.start();
    t.after(() => door.stop());
    assert.strictEqual((await getJson(addr.port, "/metrics?model=b.gguf")).tag, "b");
    assert.strictEqual((await getJson(addr.port, "/slots?model=b.gguf")).tag, "b");
    assert.strictEqual((await getJson(addr.port, "/metrics?model=a.gguf")).tag, "a");
    // No query: the default model.
    assert.strictEqual((await getJson(addr.port, "/metrics")).tag, "a");
    // A model that is not loaded is a 503, never a start.
    const missing = await getJson(addr.port, "/slots?model=c.gguf");
    assert.strictEqual(missing.status, 503);
    assert.strictEqual(ensured, 0, "a status read must never start a model");
});

test("stop() settles and destroys idle keep-alive sockets", async (t) => {
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "",
        ensureModel: async () => { return { port: 1 }; },
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    t.after(() => agent.destroy());
    const socket = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: addr.port, path: "/health", agent: agent }, (res) => {
            res.resume();
            res.on("end", () => resolve(req.socket));
        });
        req.on("error", reject);
        req.end();
    });
    assert.ok(socket, "expected a live socket");
    const closed = new Promise((resolve) => { if (socket.destroyed) resolve(); else socket.on("close", resolve); });
    await Promise.race([
        door.stop(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("stop() did not settle")), 1500))
    ]);
    await Promise.race([
        closed,
        new Promise((_, reject) => setTimeout(() => reject(new Error("keep-alive socket stayed open")), 1500))
    ]);
    assert.strictEqual(socket.destroyed, true);
});

// activeRequests is the authoritative "is this model still generating" signal the pool waits on
// before evicting. It must count exactly the accepted model-path request, from routing until the
// response ends, and status reads must never touch it.
test("activeRequests is 0 -> 1 while a model request is in flight -> 0 after it completes", async (t) => {
    let release = null;
    const gate = new Promise((r) => { release = r; });
    const back = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: {\"n\":1}\n\n");
        gate.then(() => { res.end("data: [DONE]\n\n"); });
    });
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        getProps: (id) => ({ model_alias: id }),
        getModelsList: () => ({ object: "list", data: [] }),
        loadedPort: () => backPort
    });
    const addr = await door.start();
    t.after(() => door.stop());
    assert.strictEqual(door.activeRequests("a.gguf"), 0);
    const done = new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: addr.port, path: "/v1/chat/completions", method: "POST",
            headers: { "content-type": "application/json" } }, (res) => { res.resume(); res.on("end", resolve); });
        req.on("error", reject);
        req.end(JSON.stringify({ model: "a.gguf", stream: true, messages: [] }));
    });
    await waitFor(() => door.activeRequests("a.gguf") === 1);
    assert.strictEqual(door.activeRequests("a.gguf"), 1);
    // Status paths are answered by the front door itself and must never count as in-flight work.
    await getJson(addr.port, "/props?model=a.gguf");
    await getJson(addr.port, "/v1/models");
    await getJson(addr.port, "/health");
    assert.strictEqual(door.activeRequests("a.gguf"), 1, "status paths must not increment the count");
    release();
    await done;
    await waitFor(() => door.activeRequests("a.gguf") === 0);
    assert.strictEqual(door.activeRequests("a.gguf"), 0);
});

// A client that disconnects mid-stream must release the count (close/finish/error guard), or an
// eviction would wait out the whole cap for a request that is already gone.
test("an aborted client request decrements activeRequests instead of sticking at 1", async (t) => {
    const back = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: {\"n\":1}\n\n");
        const iv = setInterval(function () { try { res.write("data: {\"n\":2}\n\n"); } catch (err) { /* closed */ } }, 20);
        res.on("close", function () { clearInterval(iv); });
    });
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        getProps: (id) => ({ model_alias: id }),
        getModelsList: () => ({ object: "list", data: [] }),
        loadedPort: () => backPort
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const req = http.request({ host: "127.0.0.1", port: addr.port, path: "/v1/chat/completions", method: "POST",
        headers: { "content-type": "application/json" } });
    req.on("error", function () { /* expected after destroy */ });
    req.end(JSON.stringify({ model: "a.gguf", stream: true, messages: [] }));
    await waitFor(() => door.activeRequests("a.gguf") === 1);
    assert.strictEqual(door.activeRequests("a.gguf"), 1);
    req.destroy();
    await waitFor(() => door.activeRequests("a.gguf") === 0);
    assert.strictEqual(door.activeRequests("a.gguf"), 0, "an aborted request must release the count");
});

// ---------------------------------------------------------------------------
// Reasoning intent (Task 3). The front door is the one place every client's request passes, so it
// decides there what a request's reasoning intent means against the loaded model's own capabilities
// and forwards a body that actually asks for reasoning. A request that asks for nothing (or refuses)
// must still reach the child byte-for-byte, and a tier the template refuses must be retried once
// without it rather than failing the caller.
// ---------------------------------------------------------------------------
test("a request that asks for reasoning reaches the model asking for it", async (t) => {
    const back = echoBackend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        capsFor: () => ({ supportsEffort: true, supportsPreserve: false, efforts: ["low", "medium", "xhigh"] }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const echo = await getJson(addr.port, "/v1/chat/completions", "POST",
        { model: "a.gguf", messages: [], reasoning_effort: "medium" });
    assert.strictEqual(echo.status, 200);
    const sent = JSON.parse(echo.body);
    assert.strictEqual(sent.chat_template_kwargs.enable_thinking, true,
        "a request that asks for reasoning must reach the child asking for it");
    assert.strictEqual(sent.reasoning_effort, "medium", "an accepted tier must be kept");
});

test("a silent request body is forwarded unchanged", async (t) => {
    const back = echoBackend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        capsFor: () => ({ supportsEffort: true, supportsPreserve: false, efforts: ["low", "medium", "xhigh"] }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const payload = '{ "model" : "a.gguf", "messages" : [] }';
    const echo = await postRaw(addr.port, "/v1/chat/completions", payload);
    assert.strictEqual(echo.status, 200);
    assert.strictEqual(echo.body, payload, "a silent body must be forwarded byte-for-byte");
});

test("a request that refuses reasoning is forwarded unchanged", async (t) => {
    const back = echoBackend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        capsFor: () => ({ supportsEffort: true, supportsPreserve: false, efforts: ["low", "medium", "xhigh"] }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const payload = '{ "model" : "a.gguf", "messages" : [], "chat_template_kwargs" : { "enable_thinking" : false } }';
    const echo = await postRaw(addr.port, "/v1/chat/completions", payload);
    assert.strictEqual(echo.status, 200);
    assert.strictEqual(echo.body, payload, "an explicit refusal must be forwarded byte-for-byte");
});

test("a tier the model does not accept is dropped and the answer still arrives", async (t) => {
    const back = echoBackend();
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        capsFor: () => ({ supportsEffort: true, supportsPreserve: false, efforts: ["low", "medium", "xhigh"] }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const echo = await getJson(addr.port, "/v1/chat/completions", "POST",
        { model: "a.gguf", messages: [], reasoning_effort: "high" });
    assert.strictEqual(echo.status, 200, "dropping a tier must still answer");
    const sent = JSON.parse(echo.body);
    assert.strictEqual(sent.reasoning_effort, undefined, "an unaccepted tier must not reach the child");
    assert.strictEqual(sent.chat_template_kwargs.enable_thinking, true, "the reasoning intent must survive");
});

test("an upstream template rejection is retried once without the tier", async (t) => {
    const back = flakyBackend("Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.");
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        // supportsEffort with no readable list: the tier is sent as-is and the retry is the net.
        capsFor: () => ({ supportsEffort: true, supportsPreserve: false, efforts: null }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const answer = await getJson(addr.port, "/v1/chat/completions", "POST",
        { model: "a.gguf", messages: [], reasoning_effort: "high" });
    assert.strictEqual(answer.status, 200, "a rejected tier must become an answer, not a failure");
    assert.strictEqual(answer.ok, true);
    assert.strictEqual(back.seen.length, 2, "the template rejection must be retried exactly once");
    const retried = JSON.parse(back.seen[1]);
    assert.strictEqual(retried.reasoning_effort, undefined, "the retry must carry no tier");
    assert.strictEqual(retried.chat_template_kwargs.enable_thinking, true, "the retry keeps the reasoning intent");
});

test("a genuine upstream error is never retried", async (t) => {
    const back = flakyBackend("the model server hit an internal error");
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        capsFor: () => ({ supportsEffort: true, supportsPreserve: false, efforts: null }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const answer = await getJson(addr.port, "/v1/chat/completions", "POST",
        { model: "a.gguf", messages: [], reasoning_effort: "high" });
    assert.strictEqual(answer.status, 500, "an unrelated upstream error must pass through untouched");
    assert.strictEqual(back.seen.length, 1, "only a template rejection may be retried");
});

// A refusal must never arm the retry. `reasoning_effort: "none"` is a non-empty string, so the old
// arming condition treated it as a forwarded tier; the retry then deleted it, turning the refusal
// into an ask. The upstream here rejects with the template's own effort validator, which is exactly
// the error that used to trigger that retry.
test("a template rejection does not turn a refusal into an ask", async (t) => {
    const back = flakyBackend("Unexpected reasoning effort. Supported types are xhigh (default), medium, and low.");
    await listen(back);
    t.after(() => close(back));
    const backPort = back.address().port;
    const door = FrontDoor.createFrontDoor({
        host: "127.0.0.1", port: 0,
        getModels: () => ["a.gguf"],
        defaultId: () => "a.gguf",
        ensureModel: async () => ({ port: backPort }),
        capsFor: () => ({ supportsEffort: true, supportsPreserve: false, efforts: null }),
        getProps: () => ({}),
        getModelsList: () => ({ object: "list", data: [] })
    });
    const addr = await door.start();
    t.after(() => door.stop());
    const payload = '{ "model" : "a.gguf", "messages" : [], "reasoning_effort" : "none", "chat_template_kwargs" : { "enable_thinking" : true } }';
    const answer = await postRaw(addr.port, "/v1/chat/completions", payload);
    assert.strictEqual(back.seen.length, 1, "a refusal must never be retried");
    assert.strictEqual(back.seen[0], payload,
        "the refusal must reach the child byte-for-byte, not be stripped into an ask");
    assert.strictEqual(answer.status, 500,
        "the genuine rejection passes through when the request carried no real tier");
});
