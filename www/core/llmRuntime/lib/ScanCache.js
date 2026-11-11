// www/core/llmRuntime/lib/ScanCache.js
//
// Cheap signature caching for the GGUF model scan. buildModelEntries/modelInfos read each
// file's metadata table (a bounded prefix, but seconds in aggregate over a multi-GB folder),
// and the engine's background ticker asks for the model list repeatedly. This module computes
// a signature from the directory listing alone - the name, size and mtime of every .gguf, no
// file bodies - and caches each expensive result against it, so an unchanged folder never
// triggers a second content scan. Pure and synchronous; every readdir/stat failure degrades to
// a fresh, uncached compute rather than throwing.
"use strict";
var nodePath = require("path");

// The signature for a models directory: one `name:size:mtime:ctime` token per .gguf, sorted and
// joined. Only the directory listing and a stat per file are read, so this is milliseconds even
// when the files themselves are multi-gigabyte. ctime is included because it changes on any
// inode modification and cannot be restored by a user/tool: a same-size, timestamp-preserving
// replacement (restore/copy that preserves mtime) still moves the ctime, so it is noticed.
// Returns null when the listing (or a stat) cannot be read, which tells the cache to bypass
// itself instead of caching a value it cannot key reliably.
function directorySignature(opts) {
    var dir = opts && opts.dir;
    var fs = opts && opts.fs;
    if (!dir || !fs) return null;
    var names;
    try {
        names = fs.readdirSync(dir);
    } catch (err) {
        return null;
    }
    var entries = [];
    try {
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (!/\.gguf$/i.test(name)) continue;
            var stat = fs.statSync(nodePath.join(dir, name));
            var mtime = (stat.mtimeMs !== undefined && stat.mtimeMs !== null)
                ? stat.mtimeMs
                : (stat.mtime && typeof stat.mtime.getTime === "function" ? stat.mtime.getTime() : 0);
            var ctime = (stat.ctimeMs !== undefined && stat.ctimeMs !== null)
                ? stat.ctimeMs
                : (stat.ctime && typeof stat.ctime.getTime === "function" ? stat.ctime.getTime() : 0);
            entries.push(name + ":" + stat.size + ":" + mtime + ":" + ctime);
        }
    } catch (err) {
        return null;
    }
    entries.sort();
    return entries.join("|");
}

// A tiny signature-keyed memo. Each key holds one entry, so a per-key result is recomputed only
// when the directory signature changes. A null/undefined signature means "not cacheable": the
// value is computed fresh and nothing is stored, so an unreadable folder can never serve a stale
// list. An empty signature (an empty directory) is a real value and is cached normally.
function createCache() {
    var slots = {};
    function cacheable(signature) {
        return signature !== null && signature !== undefined;
    }
    return {
        read: function (key, signature, compute) {
            var slot = slots[key];
            if (cacheable(signature) && slot && slot.signature === signature) return slot.value;
            var value = compute();
            if (cacheable(signature)) slots[key] = { signature: signature, value: value };
            else delete slots[key];
            return value;
        },
        clear: function () {
            slots = {};
        }
    };
}

module.exports = { directorySignature: directorySignature, createCache: createCache };
