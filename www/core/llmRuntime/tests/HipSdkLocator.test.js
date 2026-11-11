"use strict";
const test = require("node:test");
const assert = require("node:assert");
const HipSdkLocator = require("../lib/HipSdkLocator");

// The locator builds its paths with the host's path module, so running these tests on a
// POSIX host mixes forward slashes into the Windows-style inputs. Every path comparison
// therefore goes through a normalizer that maps both separators to "/" and lowercases,
// the way the Windows filesystem itself compares.
function norm(p) { return String(p).replace(/\\/g, "/").toLowerCase(); }

// A fake filesystem: `dirs` maps directory paths to their listing, `files` is the set of
// existing file paths. Both are matched case- and separator-insensitively.
function fakeFs({ dirs = {}, files = [] }) {
    const dirsNorm = {};
    for (const key of Object.keys(dirs)) dirsNorm[norm(key)] = dirs[key];
    const filesNorm = files.map(norm);
    return {
        existsSync: (p) => filesNorm.indexOf(norm(p)) !== -1,
        readdirSync: (p) => {
            const listing = dirsNorm[norm(p)];
            if (!listing) throw new Error("ENOENT: " + p);
            return listing;
        }
    };
}

const PF = "C:\\Program Files";
const ROCM = PF + "\\AMD\\ROCm";

function sdkSetup({ versions, withHipblas = [] }) {
    const dirs = {};
    const files = [];
    dirs[ROCM] = versions;
    for (const version of versions) {
        dirs[ROCM + "\\" + version] = ["bin"];
        if (withHipblas.indexOf(version) !== -1) {
            files.push(ROCM + "\\" + version + "\\bin\\hipblas.dll");
        }
    }
    return fakeFs({ dirs, files });
}

test("the SDK generation matching the installed pack is preferred over a newer one", () => {
    const fs = sdkSetup({ versions: ["6.4", "7.1"], withHipblas: ["6.4", "7.1"] });
    const dirs = HipSdkLocator.standardBinDirs({ platform: "win32", env: {}, fs, packGeneration: 6 });
    assert.deepStrictEqual(dirs.map(norm), [norm(ROCM + "\\6.4\\bin"), norm(ROCM + "\\7.1\\bin")]);
});

test("a bin folder without the marker library is not a candidate", () => {
    const fs = sdkSetup({ versions: ["6.4", "7.1"], withHipblas: ["7.1"] });
    const dirs = HipSdkLocator.standardBinDirs({ platform: "win32", env: {}, fs, packGeneration: 6 });
    assert.deepStrictEqual(dirs.map(norm), [norm(ROCM + "\\7.1\\bin")]);
});

test("within a generation the newer version comes first", () => {
    const fs = sdkSetup({ versions: ["6.2", "6.4"], withHipblas: ["6.2", "6.4"] });
    const dirs = HipSdkLocator.standardBinDirs({ platform: "win32", env: {}, fs, packGeneration: 6 });
    assert.deepStrictEqual(dirs.map(norm), [norm(ROCM + "\\6.4\\bin"), norm(ROCM + "\\6.2\\bin")]);
});

test("without a known pack generation the newest version wins", () => {
    const fs = sdkSetup({ versions: ["6.4", "7.1"], withHipblas: ["6.4", "7.1"] });
    const dirs = HipSdkLocator.standardBinDirs({ platform: "win32", env: {}, fs, packGeneration: null });
    assert.deepStrictEqual(dirs.map(norm), [norm(ROCM + "\\7.1\\bin"), norm(ROCM + "\\6.4\\bin")]);
});

test("an explicitly configured HIP_PATH outranks the standard location", () => {
    // A portable SDK in a nonstandard place, HIP_PATH pointing at its root (trailing
    // backslash included, as AMD's tooling writes it).
    const fs = fakeFs({ files: ["E:\\sdks\\rocm\\6.4\\bin\\hipblas.dll"] });
    const dirs = HipSdkLocator.standardBinDirs({
        platform: "win32", env: { HIP_PATH: "E:\\sdks\\rocm\\6.4\\" }, fs, packGeneration: 6
    });
    assert.deepStrictEqual(dirs.map(norm), ["e:/sdks/rocm/6.4/bin"]);
});

test("a missing or empty install root yields no candidates", () => {
    assert.deepStrictEqual(
        HipSdkLocator.standardBinDirs({ platform: "win32", env: {}, fs: fakeFs({}), packGeneration: 6 }),
        []
    );
});

test("non-Windows platforms get no candidates: the problem does not exist there", () => {
    const fs = sdkSetup({ versions: ["6.4"], withHipblas: ["6.4"] });
    assert.deepStrictEqual(
        HipSdkLocator.standardBinDirs({ platform: "linux", env: {}, fs, packGeneration: 6 }),
        []
    );
});

test("versionOf parses the version-shaped folder names the installer creates", () => {
    assert.deepStrictEqual(HipSdkLocator.versionOf("6.4"), [6, 4, 0]);
    assert.deepStrictEqual(HipSdkLocator.versionOf("6.4.2"), [6, 4, 2]);
    assert.strictEqual(HipSdkLocator.versionOf("Lambda"), null);
    assert.strictEqual(HipSdkLocator.versionOf(".."), null);
});
