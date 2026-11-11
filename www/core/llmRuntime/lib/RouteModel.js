// www/core/llmRuntime/lib/RouteModel.js
//
// Which model a request must be served by. The public port serves several models, so the request's
// own "model" field decides; an absent name uses the default (selected) model, and an unknown name
// is a clear 404 rather than a guess.
"use strict";

function routeModel(input) {
    const opts = input || {};
    const known = opts.knownIds || [];
    const requested = (opts.requested === undefined || opts.requested === null) ? "" : String(opts.requested).trim();
    if (requested === "") {
        if (opts.defaultId && known.indexOf(opts.defaultId) !== -1) return { id: opts.defaultId };
        if (known.length) return { id: known[0] };
        return { error: { code: "model_not_found", message: "No local model is configured; add a GGUF to data/llama/models." } };
    }
    if (known.indexOf(requested) !== -1) return { id: requested };
    // Clean-name fallback: registry ids are raw filenames, so they carry ".gguf",
    // but basically every other OpenAI-compatible endpoint exposes models under
    // extensionless names and users/configs habitually use those. An exact id
    // always wins; only an unknown name with the extension missing is retried
    // against ids with ".gguf" stripped.
    const stripped = requested.replace(/\.gguf$/i, "");
    if (stripped !== requested) {
        if (known.indexOf(stripped) !== -1) return { id: stripped };
    } else {
        for (let i = 0; i < known.length; i++) {
            if (known[i].replace(/\.gguf$/i, "") === requested) return { id: known[i] };
        }
    }
    return { error: { code: "model_not_found", message: "model '" + requested + "' not found" } };
}

module.exports = { routeModel };
