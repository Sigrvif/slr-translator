// www/core/llmRuntime/lib/FrontDoor.js
"use strict";
const http = require("http");
const RouteModel = require("./RouteModel");
const ReasoningCaps = require("./ReasoningCaps");

const MODEL_PATHS = { "/v1/chat/completions": true, "/v1/completions": true, "/completion": true,
    "/v1/embeddings": true, "/v1/responses": true, "/tokenize": true, "/detokenize": true, "/rerank": true };
const MAX_BODY = 64 * 1024 * 1024;
// The template's own effort validator is the only rejection worth recovering from: an error that
// names the reasoning effort means the value we sent was refused, not that the upstream failed.
const TEMPLATE_REJECTION = /reasoning effort/i;

function createFrontDoor(opts) {
    const o = opts || {};
    const log = o.logger || function () {};
    const defaultId = typeof o.defaultId === "function" ? o.defaultId : function () { return ""; };
    // What a model can do about reasoning, supplied by the manager from the loaded child's own
    // /props. The safe default (no effort support, accepted values unknown) applies to anything
    // the caller does not supply, so a request still gets its intent through the chat-template
    // channel rather than a tier we guessed at.
    const capsFor = typeof o.capsFor === "function" ? o.capsFor : function () {
        return { supportsEffort: false, supportsPreserve: false, efforts: null };
    };
    const sockets = new Set();
    // Per-model count of model-path requests currently being proxied to that model. The count
    // is authoritative for "is this model still generating": the pool reads it (through the
    // manager) to wait for a model to finish before evicting it, and the idle sweep reads it
    // before stopping an idle child. Only model paths count; status reads (/metrics, /slots,
    // /props, /v1/models, /health) never touch it.
    const active = {};

    function activeRequests(id) { return active[id] || 0; }
    // Count one accepted model-path request and arrange for exactly one decrement when its
    // response ends. `finish` and `close` both fire on a normal end, and `error` on a broken
    // one, so the `released` flag is what keeps the count from going negative.
    function trackActive(id, res) {
        active[id] = (active[id] || 0) + 1;
        let released = false;
        function release() {
            if (released) return;
            released = true;
            const next = (active[id] || 1) - 1;
            if (next > 0) active[id] = next; else delete active[id];
        }
        res.on("finish", release);
        res.on("close", release);
        res.on("error", release);
        return release;
    }

    function readBody(req, cb) {
        const chunks = [];
        let size = 0, done = false;
        req.on("data", function (c) {
            if (done) return;
            size += c.length;
            if (size > MAX_BODY) { done = true; cb({ tooLarge: true }); return; }
            chunks.push(c);
        });
        req.on("end", function () { if (!done) { done = true; cb({ body: Buffer.concat(chunks) }); } });
        req.on("error", function (err) { if (!done) { done = true; cb({ error: err }); } });
    }
    function sendJson(res, status, obj) {
        const text = JSON.stringify(obj);
        res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        res.end(text);
    }
    // The buffered request is decoded exactly once, and the parsed object drives both the model
    // route and the reasoning decision, so the two can never disagree about what the caller sent.
    // A body that does not parse as a JSON object yields null: such a request routes to the default
    // model and is forwarded byte-for-byte, exactly as before.
    function parseBody(body) {
        try {
            const j = JSON.parse(body.toString("utf8"));
            return j && typeof j === "object" ? j : null;
        } catch (e) { return null; }
    }
    function modelFromBody(parsed) {
        return parsed && typeof parsed.model === "string" ? parsed.model : "";
    }
    function scrubHopByHop(headers) {
        // The buffered path re-frames the request with an explicit content-length; forwarding the
        // client's connection-scoped framing headers would conflict with it upstream.
        delete headers["transfer-encoding"];
        delete headers["connection"];
        delete headers["keep-alive"];
        delete headers["upgrade"];
    }
    // Forward one buffered request. `onRejection` is optional and supplied only for a request that
    // actually carried a reasoning tier: when the upstream then answers non-2xx with the template's
    // effort validator, the error is withheld and the callback retries once without the tier. Absent
    // a callback — every status-path call, and a model request that sent no tier — the response is
    // written exactly as before, and a 2xx always streams unbuffered. `settled` is the record the
    // caller reads back to know a retry claimed the response.
    function proxy(req, res, body, target, onRejection, settled) {
        const headers = Object.assign({}, req.headers);
        if (body) { scrubHopByHop(headers); headers["content-length"] = String(body.length); }
        headers.host = "127.0.0.1:" + target.port;
        const up = http.request({ host: "127.0.0.1", port: target.port, method: req.method, path: req.url, headers: headers },
            function (upRes) {
                const status = upRes.statusCode || 502;
                if (onRejection && (status < 200 || status > 299)) {
                    // Buffer the error only so its body can be inspected for the effort validator; the
                    // client must see nothing until we know whether this rejection is recoverable.
                    const chunks = [];
                    upRes.on("data", function (c) { chunks.push(c); });
                    upRes.on("aborted", function () { if (!res.writableEnded) res.destroy(); });
                    upRes.on("error", function () { if (!res.writableEnded) res.destroy(); });
                    upRes.on("end", function () {
                        const text = Buffer.concat(chunks).toString("utf8");
                        // The callback returns true once its retry has taken over the client response;
                        // then the buffered error is dropped. A false return, a body that is not the
                        // effort validator, or a retry that cannot even be launched falls back to
                        // passing the genuine failure through untouched.
                        let handled = false;
                        if (TEMPLATE_REJECTION.test(text)) {
                            try { handled = onRejection() === true; } catch (e) { handled = false; }
                        }
                        if (handled) return;
                        if (res.headersSent || res.writableEnded) return;
                        res.writeHead(status, upRes.headers);
                        res.end(Buffer.concat(chunks));
                    });
                    return;
                }
                res.writeHead(status, upRes.headers);
                upRes.on("aborted", function () { if (!res.writableEnded) res.destroy(); });
                upRes.on("error", function () { if (!res.writableEnded) res.destroy(); });
                upRes.pipe(res);
            });
        up.on("error", function (err) {
            // Once headers are out a second writeHead throws; break the client response instead.
            if (res.headersSent || res.writableEnded) { if (!res.writableEnded) res.destroy(); return; }
            sendJson(res, 502, { error: { message: "model server error: " + err.message, type: "proxy_error" } });
        });
        res.on("close", function () { if (!res.writableEnded) up.destroy(); });
        // A retry has claimed the response as soon as it has launched its own upstream request; the
        // caller reads this to know the original error must not also be written.
        if (settled) settled.settled = true;
        if (body) up.end(body); else req.pipe(up);
    }

    const server = http.createServer(function (req, res) {
        try {
            const path = String(req.url || "").split("?")[0];
            if (req.method === "GET" && path === "/health") return sendJson(res, 200, { status: "ok" });
            if (req.method === "GET" && path === "/v1/models") return sendJson(res, 200, o.getModelsList());
            if (req.method === "GET" && path === "/props") {
                const q = String(req.url || "").split("?")[1] || "";
                const m = /(?:^|&)model=([^&]+)/.exec(q);
                const wanted = m ? decodeURIComponent(m[1]) : "";
                const route = RouteModel.routeModel({ requested: wanted, defaultId: defaultId(), knownIds: o.getModels() });
                if (route.error) return sendJson(res, 404, { error: { message: route.error.message, type: "invalid_request_error", code: route.error.code } });
                return sendJson(res, 200, o.getProps(route.id));
            }
            const wantsModel = !!MODEL_PATHS[path];
            if (!wantsModel) {
                // metrics/slots and anything else: proxy to the instance of the model named by
                // ?model=, else the default model's; 503 when that model is not loaded. These
                // must NOT start a model as a side effect of a status read.
                const query = String(req.url || "").split("?")[1] || "";
                const mm = /(?:^|&)model=([^&]+)/.exec(query);
                let wanted = "";
                if (mm) { try { wanted = decodeURIComponent(mm[1]); } catch (e) { wanted = mm[1]; } }
                const known = o.getModels();
                const fallback = (o.defaultId && known.indexOf(o.defaultId()) !== -1) ? o.defaultId() : known[0];
                const id = wanted || fallback;
                const target = id && o.loadedPort ? o.loadedPort(id) : null;
                if (!target) return sendJson(res, 503, { error: { message: "no model is loaded", type: "unavailable_error" } });
                return proxy(req, res, null, { port: target });
            }
            readBody(req, function (r) {
                if (r.tooLarge) return sendJson(res, 413, { error: { message: "request body too large to route" } });
                if (r.error) return sendJson(res, 400, { error: { message: "could not read request body" } });
                const parsed = parseBody(r.body);
                const route = RouteModel.routeModel({ requested: modelFromBody(parsed), defaultId: defaultId(), knownIds: o.getModels() });
                if (route.error) return sendJson(res, 404, { error: { message: route.error.message, type: "invalid_request_error", code: route.error.code } });
                // Accepted and routed: this request now counts as in flight for the model until
                // its response ends, so an eviction can wait for it rather than abort it.
                trackActive(route.id, res);
                // This is where every client's reasoning intent is decided, once, against the loaded
                // model's own capabilities. The body forwarded to the child may therefore differ from
                // the one received; a request that asks for nothing (or refuses) forwards the caller's
                // original buffer, so a silent client keeps the server's configured default.
                const decided = ReasoningCaps.normalizeReasoning(parsed, capsFor(route.id));
                const forward = decided.changed ? Buffer.from(JSON.stringify(decided.body)) : r.body;
                // Only a tier we actually forwarded can be named by the template's effort validator,
                // so that is the only case the bounded retry is armed for. A refusal is left
                // unchanged (changed is false) and must never arm it: `reasoning_effort: "none"` is
                // a non-empty string, and a retry would delete it and turn the refusal into an ask.
                // The retry passes no callback of its own, which is what keeps it from ever recurring.
                const carriedTier = decided.changed === true && !!decided.body &&
                    typeof decided.body.reasoning_effort === "string" &&
                    decided.body.reasoning_effort !== "" && decided.body.reasoning_effort !== "none";
                o.ensureModel(route.id).then(function (t) {
                    proxy(req, res, forward, t, carriedTier ? function retryWithoutTier() {
                        // The template refused the tier we sent. Retry the same request once without it
                        // so the caller still gets an answer: a rejected value must not become a failed
                        // request. Only a response that names the effort validator is treated this way.
                        const without = Object.assign({}, decided.body);
                        delete without.reasoning_effort;
                        const back = { settled: false };
                        proxy(req, res, Buffer.from(JSON.stringify(without)), t, null, back);
                        return back.settled === true;
                    } : null);
                })
                    .catch(function (err) { sendJson(res, 500, { error: { message: route.id + " failed to load: " + err.message } }); });
            });
        } catch (err) { sendJson(res, 500, { error: { message: String(err && err.message || err) } }); }
    });

    server.on("connection", function (socket) {
        sockets.add(socket);
        socket.on("close", function () { sockets.delete(socket); });
    });

    return {
        start: function () { return new Promise(function (resolve, reject) {
            server.on("error", reject);
            server.listen(o.port === undefined ? 0 : o.port, o.host || "127.0.0.1", function () { resolve({ port: server.address().port }); });
        }); },
        stop: function () { return new Promise(function (resolve) {
            server.close(function () { resolve(); });
            sockets.forEach(function (socket) { socket.destroy(); });
        }); },
        address: function () { return server.address(); },
        // How many model-path requests are currently in flight for `id`. Authoritative for the
        // pool's "wait before evicting" and the manager's idle sweep; status paths never count.
        activeRequests: activeRequests
    };
}
module.exports = { createFrontDoor, MODEL_PATHS, MAX_BODY };
