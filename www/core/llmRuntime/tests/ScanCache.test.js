"use strict";
// The directory-signature cache behind the GGUF scan. buildModelEntries/modelInfos read every
// model's metadata table (seconds over a multi-GB folder), and the engine ticker asks for the
// model list repeatedly, so these helpers are what make an unchanged folder free to re-ask for.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ScanCache = require(path.join(__dirname, "..", "lib", "ScanCache.js"));

function tmpModels(names) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scancache-"));
    for (const name of names) fs.writeFileSync(path.join(dir, name), Buffer.from("GGUF" + name));
    return dir;
}

test("directorySignature ignores non-GGUF files and is stable for an unchanged folder", () => {
    const dir = tmpModels(["a.gguf", "b.gguf", "notes.txt"]);
    const one = ScanCache.directorySignature({ dir: dir, fs: fs });
    const two = ScanCache.directorySignature({ dir: dir, fs: fs });
    assert.strictEqual(typeof one, "string");
    assert.strictEqual(one, two);
    // "notes.txt" must not contribute a token.
    assert.strictEqual(one.indexOf("notes.txt"), -1);
    assert.ok(one.indexOf("a.gguf:") !== -1);
    assert.ok(one.indexOf("b.gguf:") !== -1);
});

test("directorySignature changes with name, size or mtime", () => {
    const dir = tmpModels(["a.gguf"]);
    const base = ScanCache.directorySignature({ dir: dir, fs: fs });

    // Size change (and mtime, which changes with it).
    fs.writeFileSync(path.join(dir, "a.gguf"), Buffer.from("GGUF" + "a".repeat(64)));
    const bigger = ScanCache.directorySignature({ dir: dir, fs: fs });
    assert.notStrictEqual(bigger, base);

    // Pure mtime change, same size.
    const before = fs.statSync(path.join(dir, "a.gguf")).mtimeMs;
    fs.utimesSync(path.join(dir, "a.gguf"), new Date(before + 5000), new Date(before + 5000));
    const touched = ScanCache.directorySignature({ dir: dir, fs: fs });
    assert.notStrictEqual(touched, bigger);

    // Add and remove a file.
    fs.writeFileSync(path.join(dir, "b.gguf"), Buffer.from("GGUFb"));
    const added = ScanCache.directorySignature({ dir: dir, fs: fs });
    assert.notStrictEqual(added, touched);
    fs.unlinkSync(path.join(dir, "b.gguf"));
    const removed = ScanCache.directorySignature({ dir: dir, fs: fs });
    assert.notStrictEqual(removed, added);
    assert.strictEqual(removed, touched);
});

test("directorySignature includes ctime, so a timestamp-preserving replacement is noticed", () => {
    const dir = tmpModels(["a.gguf"]);
    const filePath = path.join(dir, "a.gguf");
    const before = ScanCache.directorySignature({ dir: dir, fs: fs });
    const stat = fs.statSync(filePath);
    // A chmod changes neither size nor mtime, only ctime: the token must still move, which is
    // what catches a restore/copy that preserves the original timestamps and size.
    const current = stat.mode & 0o777;
    fs.chmodSync(filePath, current === 0o600 ? 0o644 : 0o600);
    const after = ScanCache.directorySignature({ dir: dir, fs: fs });
    assert.notStrictEqual(after, before);
    assert.strictEqual(fs.statSync(filePath).size, stat.size);
    assert.strictEqual(fs.statSync(filePath).mtimeMs, stat.mtimeMs);
});

test("directorySignature never throws and returns null when the listing cannot be read", () => {
    // Missing arguments, a missing directory and a stat failure all degrade to null.
    assert.strictEqual(ScanCache.directorySignature({}), null);
    assert.strictEqual(ScanCache.directorySignature({ dir: "/no/such/dir", fs: null }), null);
    assert.strictEqual(
        ScanCache.directorySignature({ dir: path.join(os.tmpdir(), "definitely-absent-" + Date.now()), fs: fs }),
        null
    );
    assert.strictEqual(ScanCache.directorySignature({
        dir: "/whatever",
        fs: { readdirSync: () => { throw new Error("boom"); } }
    }), null);
    assert.strictEqual(ScanCache.directorySignature({
        dir: "/whatever",
        fs: { readdirSync: () => ["x.gguf"], statSync: () => { throw new Error("boom"); } }
    }), null);
});

test("an unchanged signature returns the cached value without recomputing", () => {
    const cache = ScanCache.createCache();
    let computes = 0;
    const first = cache.read("k", "sig-a", () => { computes++; return { n: 1 }; });
    const second = cache.read("k", "sig-a", () => { computes++; return { n: 2 }; });
    assert.strictEqual(computes, 1, "the second read must not recompute");
    assert.strictEqual(second, first, "the identical object must be returned");
});

test("a changed signature recomputes and replaces the cached value", () => {
    const cache = ScanCache.createCache();
    let computes = 0;
    const first = cache.read("k", "sig-a", () => { computes++; return computes; });
    const changed = cache.read("k", "sig-b", () => { computes++; return computes; });
    assert.strictEqual(computes, 2);
    assert.strictEqual(first, 1);
    assert.strictEqual(changed, 2);
    // Switching back to the old signature still recomputes: only the latest value is held.
    const back = cache.read("k", "sig-a", () => { computes++; return computes; });
    assert.strictEqual(computes, 3);
    assert.strictEqual(back, 3);
});

test("a null signature bypasses the cache instead of serving a stale value", () => {
    const cache = ScanCache.createCache();
    let computes = 0;
    const first = cache.read("k", null, () => { computes++; return computes; });
    const second = cache.read("k", null, () => { computes++; return computes; });
    assert.strictEqual(computes, 2);
    assert.strictEqual(first, 1);
    assert.strictEqual(second, 2);
    // The uncacheable read must not have stored anything under the key.
    const cached = cache.read("k", "sig", () => { computes++; return computes; });
    assert.strictEqual(cached, 3);
    assert.strictEqual(cache.read("k", "sig", () => { computes++; return computes; }), 3);
    assert.strictEqual(computes, 3);
});

test("an empty direct-entry signature is a real, cacheable value", () => {
    const dir = tmpModels([]);
    const signature = ScanCache.directorySignature({ dir: dir, fs: fs });
    assert.strictEqual(signature, "");
    const cache = ScanCache.createCache();
    let computes = 0;
    cache.read("k", signature, () => { computes++; return []; });
    cache.read("k", signature, () => { computes++; return []; });
    assert.strictEqual(computes, 1);
});

test("clear drops every cached value", () => {
    const cache = ScanCache.createCache();
    let computes = 0;
    cache.read("k", "sig", () => { computes++; return computes; });
    cache.clear();
    cache.read("k", "sig", () => { computes++; return computes; });
    assert.strictEqual(computes, 2);
});
