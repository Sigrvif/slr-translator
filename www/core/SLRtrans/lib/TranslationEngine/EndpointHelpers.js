"use strict";
// Pure, runtime-free helpers for DSLR parallel endpoints.
// No window/DOM/require-of-www-js, so they can be unit-tested in plain Node.

// Clamp a single weight to a positive integer (min 1).
function clampWeight(w) {
    var n = Math.floor(Number(w));
    if (!isFinite(n) || n < 1) return 1;
    return n;
}

// raw: [{ number, url, weight }, ...] -> dense active list [{ number, weight }],
// preserving endpoint numbers, dropping blank URLs, clamping weights.
function buildActiveEndpointList(raw) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
        var e = raw[i] || {};
        var url = (e.url == null ? "" : String(e.url)).trim();
        if (!url) continue;
        out.push({ number: e.number, weight: clampWeight(e.weight) });
    }
    return out;
}

// Total concurrency = sum of active weights, minimum 1 (never starve the scheduler).
function totalConcurrency(activeList) {
    var sum = 0;
    for (var i = 0; i < activeList.length; i++) sum += activeList[i].weight;
    return Math.max(1, sum);
}

// Pick the entry index to schedule next: most free capacity (weight - inFlight),
// tie-broken by lowest endpoint number. Returns -1 if none has capacity.
function pickEndpointIndex(activeList, inFlight) {
    var bestIdx = -1;
    var bestFree = 0;
    for (var i = 0; i < activeList.length; i++) {
        var free = activeList[i].weight - (inFlight[i] || 0);
        if (free <= 0) continue;
        if (bestIdx === -1 || free > bestFree ||
            (free === bestFree && activeList[i].number < activeList[bestIdx].number)) {
            bestIdx = i;
            bestFree = free;
        }
    }
    return bestIdx;
}

// On delete of endpoint K (K>=2): shift ep{N}_* -> ep{N-1}_* for N=K+1..count.
// readValue(n,name)/writeValue(n,name,v) are provided by the caller.
// Returns the new endpoint count.
function shiftEndpointsDown(count, deletedK, settings, readValue, writeValue) {
    for (var n = deletedK + 1; n <= count; n++) {
        for (var s = 0; s < settings.length; s++) {
            var name = settings[s];
            writeValue(n - 1, name, readValue(n, name));
        }
    }
    return count - 1;
}

// Normalize an API URL. Mirrors the (currently triplicated) inline logic in DSLREngine.
function fixApiUrl(rawUrl, doNotFix) {
    var url = rawUrl == null ? "" : String(rawUrl);
    if (!url) return "";
    if (doNotFix) return url;
    if (!/http/gi.test(url)) {
        url = url.replace(/^h?t?t?p?s?:?\/?\/?(.+)/gi, "https://$1");
    }
    // Responses API endpoint (/responses) is valid as-is; do not append chat/completions.
    if (/\/responses(?:\/|\?|#|$)/i.test(url)) return url;
    if (/\/v\d\/?c?h?a?t?\/?c?o?m?p?l?e?t?i?o?n?s?\/?$/gi.test(url) &&
        !/\/v\d\/chat\/completions$|\/v\d\/message$|\/message$/gi.test(url)) {
        url = url.replace(/\/(v\d)\/?c?h?a?t?\/?c?o?m?p?l?e?t?i?o?n?s?\/?$/gi, "/$1/chat/completions");
    } else if (!/\/v\d\/chat\/completions$/gi.test(url)) {
        if (!/\/$/g.test(url)) url = url + "/";
        url = url.replace(/(.+)\/$/gi, "$1/v1/chat/completions");
    }
    return url;
}

// Effective value of setting `id` for endpoint `n` (1-based; <1 normalizes
// to 1). values: { [id]: { value: live value, def: factory default } }.
// Endpoint 1 IS Main. An additional endpoint reads its own epN_* option when
// present; when missing it NEVER live-follows Main: per-endpoint settings
// (templateIds = settings with a `2` fallback twin) resolve to the factory
// default, while true globals (no twin) keep Main's live value. Unknown ids
// yield undefined.
function resolveEndpointValue(values, templateIds, n, id) {
    var num = (n === undefined || n === null || n < 1) ? 1 : n;
    var key = (num === 1) ? id : ("ep" + num + "_" + id);
    var own = values ? values[key] : undefined;
    if (own !== undefined) return own.value;
    var base = values ? values[id] : undefined;
    if (base === undefined) return undefined;
    if (num === 1) return base.value;
    if (templateIds && templateIds.indexOf(id) !== -1) return base.def;
    return base.value;
}

// Identity fields are the endpoint itself, not its configuration: a fresh
// endpoint starts with a blank URL and key (inactive until pointed somewhere
// with real credentials — the dominant setup is same URL, different key for
// multiple account limits, so a copied key would only ever be a stale trap).
var ENDPOINT_COPY_SKIP = ["apiUrl", "apiKey"];

// New endpoint N as a frozen copy of Main's live values: baseValues is
// { [settingId]: live Main value }. Returns { [epN_settingId]: value } for
// the caller to write. Never live-follows Main afterwards.
function endpointCopyValues(baseValues, templateIds, n) {
    var out = {};
    var ids = templateIds || [];
    for (var i = 0; i < ids.length; i++) {
        var sid = ids[i];
        if (ENDPOINT_COPY_SKIP.indexOf(sid) !== -1) continue;
        if (!baseValues || baseValues[sid] === undefined) continue;
        out["ep" + n + "_" + sid] = baseValues[sid];
    }
    return out;
}

module.exports = {
    clampWeight: clampWeight,
    buildActiveEndpointList: buildActiveEndpointList,
    totalConcurrency: totalConcurrency,
    pickEndpointIndex: pickEndpointIndex,
    shiftEndpointsDown: shiftEndpointsDown,
    fixApiUrl: fixApiUrl,
    resolveEndpointValue: resolveEndpointValue,
    endpointCopyValues: endpointCopyValues
};
