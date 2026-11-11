// www/core/llmRuntime/lib/RuntimeInfo.js
//
// The two answers llama.cpp's router gets wrong: the model's real context window, and which models
// exist. /props must never report n_ctx 0 (clients then assume ~4096), and /v1/models must carry
// meta.n_ctx per model. Pure functions over the effective entries.
"use strict";

function effectiveContext(entry) {
    const configured = Number(entry && entry.contextSize);
    // A configured context below 512 is treated as unset: 512 is the shipped minimum, so any
    // smaller value (or 0/NaN) means "not really configured" and the trained context is used.
    if (isFinite(configured) && configured >= 512) return configured;
    const trained = Number(entry && entry.contextLengthTrain);
    return (isFinite(trained) && trained > 0) ? trained : 0;
}

function buildProps(entry, globals) {
    const e = entry || {};
    const g = globals || {};
    return {
        default_generation_settings: { n_ctx: effectiveContext(e) },
        model_path: e.modelPath || "none",
        model_alias: e.id || "",
        total_slots: (g.totalSlots === undefined ? 1 : g.totalSlots),
        build_info: g.buildInfo || "slrcpp"
    };
}

function buildModelsList(entries, loadedIds) {
    const loaded = loadedIds || [];
    const data = [];
    for (const e of (entries || [])) {
        if (!e || !e.id) continue;
        data.push({
            id: e.id,
            object: "model",
            owned_by: "slrcpp",
            created: e.created || 0,
            status: { value: loaded.indexOf(e.id) === -1 ? "unloaded" : "loaded" },
            architecture: { input_modalities: e.hasVision ? ["text", "image"] : ["text"], output_modalities: ["text"] },
            meta: {
                n_ctx: effectiveContext(e),
                n_ctx_train: e.contextLengthTrain || 0,
                n_params: e.nParams || 0,
                size: e.bytes || 0,
                ftype: e.ftype || "",
                arch: e.arch || ""
            }
        });
    }
    return { object: "list", data: data };
}

module.exports = { effectiveContext, buildProps, buildModelsList };
