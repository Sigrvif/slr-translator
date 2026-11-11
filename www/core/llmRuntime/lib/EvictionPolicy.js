// www/core/llmRuntime/lib/EvictionPolicy.js
//
// Which already-loaded models must stop so another can start. `loaded` is in least-recently-used
// order (oldest first). "models kept loaded" 1 is the shipped default: a request for a different
// model unloads the current one first, on the same port.
"use strict";

function planStart(input) {
    const opts = input || {};
    const loaded = (opts.loaded || []).slice();
    const maxLoaded = Number(opts.maxLoaded);
    const requested = opts.requested;
    if (loaded.indexOf(requested) !== -1) return [];
    if (!isFinite(maxLoaded) || maxLoaded <= 0) return [];
    const evict = [];
    let count = loaded.length;
    for (let i = 0; i < loaded.length && count >= maxLoaded; i++) {
        evict.push(loaded[i]);
        count--;
    }
    return evict;
}

module.exports = { planStart };
