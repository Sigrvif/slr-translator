"use strict";
/*
 * game.js — RPG Maker game image collection for SEP.
 *
 * detectGame(dir) recognizes XP/VX/VX Ace (packed or unpacked), MV, MZ and
 * pre-collected SEP staging folders. collect() copies/decrypts every
 * supported image of a game into a staging folder that mirrors the game's
 * folder structure, recording what it did in sep_manifest.json so export
 * can re-encrypt back into the original files. Encrypted videos (.rwebm,
 * third-party plugin encryption) are collected alongside the images —
 * decrypted to .webm for manual editing and re-encrypted by
 * encryptStaging(); they are never OCR'd. Self-contained: depends only on
 * Node built-ins + fs-extra; UI feedback is injected via
 * opts.logger / opts.progress. Runs in NW.js and plain Node.
 */

var gPath = require("path");
var fs = require("fs");
var os = require("os");
var fse = require("fs-extra");
var spawn = require("child_process").spawn;
var crypt = require(gPath.join(__dirname, "crypt.js"));

var PLAIN_EXTS = [".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tga", ".pcx"];
var ENC_EXTS = [".rpgmvp", ".png_"];
var PLAIN_VIDEO_EXTS = [".webm"];
var ENC_VIDEO_EXTS = [".rwebm"];
var VIDEO_EXTS = PLAIN_VIDEO_EXTS.concat(ENC_VIDEO_EXTS);
var RGSS_ARCHIVE_EXTS = [".rgssad", ".rgss2a", ".rgss3a"];
var MANIFEST_NAME = "sep_manifest.json";

function extLower(p) { return gPath.extname(p).toLowerCase(); }
function toRel(absPath, root) {
    return gPath.relative(gPath.resolve(root), gPath.resolve(absPath)).split(gPath.sep).join("/");
}

async function walkFiles(root) {
    var out = [];
    var entries = (await fse.readdir(root)).sort();
    for (var i = 0; i < entries.length; i++) {
        var p = gPath.join(root, entries[i]);
        var st;
        try { st = await fse.stat(p); } catch (e) { continue; }
        if (st.isDirectory()) {
            try { out = out.concat(await walkFiles(p)); } catch (e) { /* unreadable subdir — skip */ }
        } else if (st.isFile()) out.push(p);
    }
    return out;
}

// Scan a game root recursively. Returns { plain: [rel], encrypted: [rel],
// plainVideos: [rel], encryptedVideos: [rel] } where rel is a portable
// ("/"-separated) path relative to root.
async function scanImages(root) {
    var files = await walkFiles(root);
    var plain = [], encrypted = [], plainVideos = [], encryptedVideos = [];
    for (var i = 0; i < files.length; i++) {
        var ext = extLower(files[i]);
        var rel = toRel(files[i], root);
        if (ENC_EXTS.indexOf(ext) !== -1) encrypted.push(rel);
        else if (PLAIN_EXTS.indexOf(ext) !== -1) plain.push(rel);
        else if (ENC_VIDEO_EXTS.indexOf(ext) !== -1) encryptedVideos.push(rel);
        else if (PLAIN_VIDEO_EXTS.indexOf(ext) !== -1) plainVideos.push(rel);
    }
    return { plain: plain, encrypted: encrypted, plainVideos: plainVideos, encryptedVideos: encryptedVideos };
}

function readSystemJson(sysPath) {
    try { return JSON.parse(fs.readFileSync(sysPath, "utf8")); } catch (e) { return {}; }
}

// Recognize what the selected folder is.
async function detectGame(dir) {
    if (await fse.pathExists(gPath.join(dir, MANIFEST_NAME)))
        return { type: "sep-staging", label: "SEP staging folder" };

    var rootEntries;
    try { rootEntries = await fse.readdir(dir); } catch (e) { rootEntries = []; }

    var archives = rootEntries.filter(function (e) { return RGSS_ARCHIVE_EXTS.indexOf(extLower(e)) !== -1; });
    if (archives.length > 0)
        return { type: "rgss-packed", label: "RPG Maker XP/VX/VX Ace (packed)", archives: archives };

    var isWww = gPath.basename(gPath.resolve(dir)).toLowerCase() === "www";
    var mvSys = gPath.join(dir, "www", "data", "System.json");
    var rootSys = gPath.join(dir, "data", "System.json");
    var sysPath = null, engine = null;
    if (await fse.pathExists(mvSys)) { sysPath = mvSys; engine = "mv"; }
    else if (await fse.pathExists(rootSys)) { sysPath = rootSys; engine = isWww ? "mv" : "mz"; }
    if (sysPath) {
        var sys = readSystemJson(sysPath);
        var contentRoot = gPath.dirname(gPath.dirname(sysPath));
        if (await fse.pathExists(gPath.join(contentRoot, "js", "rmmz_core.js"))) engine = "mz";
        else if (await fse.pathExists(gPath.join(contentRoot, "js", "rpg_core.js"))) engine = "mv";
        return {
            type: engine,
            label: engine === "mv" ? "RPG Maker MV" : "RPG Maker MZ",
            systemPath: sysPath,
            encryptionKey: typeof sys.encryptionKey === "string" && sys.encryptionKey ? sys.encryptionKey : null,
            hasEncryptedImages: !!sys.hasEncryptedImages,
        };
    }

    var lower = rootEntries.map(function (e) { return e.toLowerCase(); });
    if (lower.indexOf("graphics") !== -1)
        return { type: "rgss", label: "RPG Maker XP/VX/VX Ace" };

    return { type: "generic", label: "" };
}

async function readManifest(dir) {
    var p = gPath.join(dir, MANIFEST_NAME);
    if (!(await fse.pathExists(p))) return null;
    try {
        var m = JSON.parse(await fse.readFile(p, "utf8"));
        return (m && m.version === 1 && m.files) ? m : null;
    } catch (e) { return null; }
}

async function writeManifest(dir, manifest) {
    await fse.ensureDir(dir);
    await fse.writeFile(gPath.join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 4));
}

function spawnEx(command, args, opts) {
    return new Promise(function (resolve, reject) {
        var child = spawn(command, args, opts || {});
        var stderr = "";
        child.stdout.on("data", function () {});
        child.stderr.on("data", function (d) { stderr += String(d); });
        child.on("error", function (e) { reject(new Error("Unable to run " + command + ": " + e.message)); });
        child.on("close", function (code) {
            if (code === 0) return resolve();
            reject(new Error(gPath.basename(command) + " exited with code " + code + (stderr ? "\n" + stderr.trim() : "")));
        });
    });
}

// Extract rgssad/rgss2a/rgss3a archives with the bundled CLI into
// <tempDir>/extracted and return that path. Unlike rmrgss.js, a missing
// binary or non-zero exit aborts with an error — a silent empty extraction
// must never be mistaken for an image-free game.
async function extractRgssArchives(gameRoot, archives, tempDir, opts) {
    var bin = gPath.join(opts.rgssDecrypterDir || "", process.platform === "win32" ? "RPGMakerDecrypter-cli.exe" : "RPGMakerDecrypter-cli");
    if (!(await fse.pathExists(bin)))
        throw new Error("RGSS decrypter not found: " + bin);
    var extractRoot = gPath.join(tempDir, "extracted");
    await fse.ensureDir(extractRoot);
    for (var i = 0; i < archives.length; i++) {
        if (opts.progress) opts.progress(-1, "Extracting " + archives[i] + " (" + (i + 1) + "/" + archives.length + ")");
        await spawnEx(bin, [gPath.join(gameRoot, archives[i]), "-o", extractRoot, "-w"], { cwd: extractRoot });
    }
    return extractRoot;
}

// Resolve the decryption key: System.json key if it decrypts one of the
// first encrypted images, else derive it from the first image. Note a
// derived key always "decrypts" its own source image by construction (the
// derivation XORs the first 16 payload bytes back to the PNG header), so it
// is cross-checked against the next image when one exists; with a single
// encrypted image the per-file skip during collection is the safety net.
async function resolveKey(gameInfo, encryptedAbs, logger) {
    if (encryptedAbs.length === 0) return null;
    if (gameInfo && gameInfo.encryptionKey) {
        var tryCount = Math.min(encryptedAbs.length, 3);
        for (var i = 0; i < tryCount; i++) {
            var buf;
            try { buf = await fse.readFile(encryptedAbs[i]); } catch (e) { continue; }
            try {
                crypt.decrypt(buf, gameInfo.encryptionKey);
                return gameInfo.encryptionKey;
            } catch (e) { /* try the next image */ }
        }
        if (logger) logger("System.json key does not match the encrypted images — deriving key from image");
    }
    var derived = crypt.deriveKey(await fse.readFile(encryptedAbs[0]));
    if (encryptedAbs.length > 1) {
        try {
            crypt.decrypt(await fse.readFile(encryptedAbs[1]), derived);
        } catch (e) {
            if (logger) logger("Derived key does not match other encrypted images — using it anyway; corrupt files will be skipped");
        }
    }
    return derived;
}

// Resolve the XOR key used by encrypted videos (.rwebm). Unlike images,
// there is no key in System.json: third-party video player plugins embed a
// fixed ASCII key in the game's own JS, so every candidate of crypt.js's
// VIDEO_XOR_KEYS is verified against an actual encrypted file (the result
// must start with the WebM/EBML magic after decryption). Only the header
// bytes are read; whole videos are never loaded for key discovery.
async function resolveVideoKey(encryptedVideoAbs, logger) {
    if (encryptedVideoAbs.length === 0) return null;
    var head;
    try { head = await fse.readFile(encryptedVideoAbs[0]); } catch (e) { return null; }
    for (var i = 0; i < crypt.VIDEO_XOR_KEYS.length; i++) {
        var key = crypt.VIDEO_XOR_KEYS[i];
        try {
            var probe = crypt.decryptVideo(head, key); // full buffer is fine: prefix XOR only
            void probe;
            if (encryptedVideoAbs.length > 1) {
                // cross-check against a second file to avoid a lucky match
                var head2 = await fse.readFile(encryptedVideoAbs[1]);
                crypt.decryptVideo(head2, key);
            }
            return key;
        } catch (e) { /* try next candidate */ }
    }
    if (logger) logger("Encrypted videos found but no known key matches them — they are copied unmodified and cannot be re-encrypted");
    return null;
}

// Collect every supported image (and encrypted video, for the collect/
// encrypt-only workflow — videos are never OCR'd) of a game into
// stagingDir, preserving the game's folder structure. Encrypted images are
// stored decrypted as .png; encrypted videos (.rwebm) as .webm. Refresh
// semantics: never deletes from staging; re-collected files overwrite; the
// manifest is rebuilt from this run (stale entries drop).
async function collect(gameRoot, stagingDir, opts) {
    opts = opts || {};
    var logger = opts.logger || function () {};
    var progress = opts.progress || function () {};
    var gameInfo = await detectGame(gameRoot);
    if (gameInfo.type === "generic") throw new Error("Not an RPG Maker game folder: " + gameRoot);
    if (gameInfo.type === "sep-staging") throw new Error("Folder is already a SEP staging folder: " + gameRoot);

    // Staging safety: never touch an existing folder that is not ours
    if (await fse.pathExists(stagingDir)) {
        if (!(await fse.pathExists(gPath.join(stagingDir, MANIFEST_NAME))))
            throw new Error("Staging folder already exists and is not a SEP staging folder:\n" + stagingDir);
    }

    var scanRoot = gameRoot;
    var tempDir = null;
    if (gameInfo.type === "rgss-packed") {
        tempDir = fs.mkdtempSync(gPath.join(os.tmpdir(), "sep_rgss_"));
        try {
            scanRoot = await extractRgssArchives(gameRoot, gameInfo.archives, tempDir, opts);
        } catch (e) {
            await fse.remove(tempDir).catch(function () {});
            throw e;
        }
    }

    try {
        var scan = await scanImages(scanRoot);
        var encryptedAbs = scan.encrypted.map(function (r) { return gPath.join(scanRoot, r); });
        var keyHex = await resolveKey(gameInfo, encryptedAbs, logger);
        var encVideoAbs = scan.encryptedVideos.map(function (r) { return gPath.join(scanRoot, r); });
        var videoKey = await resolveVideoKey(encVideoAbs, logger);
        // create the staging dir only after key resolution succeeded, so an
        // abort leaves nothing behind that would block a later retry
        await fse.ensureDir(stagingDir);

        // Write a minimal manifest up-front so an interrupted first collect still
        // leaves a recognizable staging folder (refresh heals it); rewritten below.
        await writeManifest(stagingDir, {
            version: 1,
            engine: gameInfo.type,
            gameRoot: gPath.resolve(gameRoot),
            encryptionKey: keyHex,
            videoEncryptionKey: videoKey,
            files: {},
        });

        var manifest = {
            version: 1,
            engine: gameInfo.type,
            gameRoot: gPath.resolve(gameRoot),
            encryptionKey: keyHex,
            videoEncryptionKey: videoKey,
            files: {},
        };
        var counts = { plain: 0, encrypted: 0, videos: 0, skipped: 0 };
        var all = scan.plain.map(function (r) { return { rel: r, enc: false, video: false }; })
            .concat(scan.encrypted.map(function (r) { return { rel: r, enc: true, video: false }; }))
            .concat(scan.plainVideos.map(function (r) { return { rel: r, enc: false, video: true }; }))
            .concat(scan.encryptedVideos.map(function (r) { return { rel: r, enc: videoKey != null, video: true }; }));
        for (var i = 0; i < all.length; i++) {
            var item = all[i];
            var srcAbs = gPath.join(scanRoot, item.rel);
            progress(Math.round((i + 1) / Math.max(all.length, 1) * 100), item.rel);
            try {
                if (item.enc && !item.video) {
                    var png = crypt.decrypt(await fse.readFile(srcAbs), keyHex);
                    var outRel = item.rel.replace(/\.[^./]+$/, "") + ".png";
                    var dst = gPath.join(stagingDir, outRel);
                    await fse.ensureDir(gPath.dirname(dst));
                    await fse.writeFile(dst, png);
                    manifest.files[outRel] = { encrypted: true, encExt: extLower(srcAbs), origPath: item.rel };
                    counts.encrypted++;
                } else if (item.video && item.enc) {
                    var webm = crypt.decryptVideo(await fse.readFile(srcAbs), videoKey);
                    var outRelV = item.rel.replace(/\.[^./]+$/, "") + ".webm";
                    var dstV = gPath.join(stagingDir, outRelV);
                    await fse.ensureDir(gPath.dirname(dstV));
                    await fse.writeFile(dstV, webm);
                    manifest.files[outRelV] = {
                        encrypted: true, video: true, encExt: extLower(srcAbs), origPath: item.rel,
                    };
                    counts.videos++;
                } else {
                    var dst2 = gPath.join(stagingDir, item.rel);
                    await fse.ensureDir(gPath.dirname(dst2));
                    await fse.copy(srcAbs, dst2, { overwrite: true });
                    manifest.files[item.rel] = { encrypted: false, video: item.video };
                    if (item.video) counts.videos++;
                    else counts.plain++;
                }
            } catch (e) {
                counts.skipped++;
                logger("Skipped " + item.rel + ": " + e.message);
            }
        }
        await writeManifest(stagingDir, manifest);
        logger("Collected " + (counts.plain + counts.encrypted) + " image(s) and " + counts.videos +
            " video(s) into " + stagingDir + " (" + counts.encrypted + " images and " +
            scan.encryptedVideos.length + " videos decrypted, " + counts.skipped + " skipped)");
        return { manifest: manifest, counts: counts, stagingDir: stagingDir, gameInfo: gameInfo };
    } finally {
        if (tempDir) await fse.remove(tempDir).catch(function () {});
    }
}

// Re-encrypt a staging folder's images and videos into targetDir, following
// sep_manifest.json: every image still present in staging whose manifest
// entry says it was encrypted is encrypted with the recorded key and
// written to its original path (e.g. img/pictures/foo.rpgmvp); encrypted
// videos (.rwebm) are re-encrypted with the recorded video key. Plain
// (never encrypted) files are not copied — the game already has them.
// Intended for manually edited images/videos: no OCR, no translation, no
// project. Staged files deleted during pruning are skipped, not an error.
async function encryptStaging(stagingDir, targetDir, opts) {
    opts = opts || {};
    var logger = opts.logger || function () {};
    var progress = opts.progress || function () {};
    var manifest = await readManifest(stagingDir);
    if (!manifest) throw new Error("Not a SEP staging folder (manifest missing or invalid):\n" + stagingDir);
    if (!manifest.encryptionKey && !manifest.videoEncryptionKey)
        throw new Error("Staging folder has no encryption key (no encrypted images or videos were collected)");

    var encRels = [];
    for (var rel in manifest.files) {
        if (manifest.files[rel] && manifest.files[rel].encrypted) encRels.push(rel);
    }
    encRels.sort();

    var counts = { encrypted: 0, videos: 0, missing: 0, skipped: 0 };
    for (var i = 0; i < encRels.length; i++) {
        var outRel = encRels[i];
        var entry = manifest.files[outRel];
        var src = gPath.join(stagingDir, outRel);
        progress(Math.round((i + 1) / Math.max(encRels.length, 1) * 100), outRel);
        if (!(await fse.pathExists(src))) { counts.missing++; continue; }
        try {
            var buf = await fse.readFile(src);
            if (entry.video) {
                if (!manifest.videoEncryptionKey)
                    throw new Error("staging folder has no video encryption key");
                if (!buf.slice(0, 4).equals(crypt.EBML_MAGIC))
                    throw new Error("not a WebM file (saved in another format during editing?)");
                var dstV = gPath.join(targetDir, entry.origPath);
                await fse.ensureDir(gPath.dirname(dstV));
                await fse.writeFile(dstV, crypt.encryptVideo(buf, manifest.videoEncryptionKey));
                counts.videos++;
            } else {
                if (!buf.slice(0, 8).equals(crypt.PNG_SIG))
                    throw new Error("not a PNG file (saved in another format during editing?)");
                var dst = gPath.join(targetDir, entry.origPath);
                await fse.ensureDir(gPath.dirname(dst));
                await fse.writeFile(dst, crypt.encrypt(buf, manifest.encryptionKey));
                counts.encrypted++;
            }
        } catch (e) {
            counts.skipped++;
            logger("Skipped " + outRel + ": " + e.message);
        }
    }
    logger("Encrypted " + counts.encrypted + " image(s) and " + counts.videos + " video(s) into " +
        targetDir + " (" + counts.missing + " missing, " + counts.skipped + " skipped)");
    return { counts: counts, manifest: manifest, targetDir: targetDir };
}

module.exports = {
    MANIFEST_NAME: MANIFEST_NAME,
    PLAIN_EXTS: PLAIN_EXTS,
    ENC_EXTS: ENC_EXTS,
    VIDEO_EXTS: VIDEO_EXTS,
    detectGame: detectGame,
    scanImages: scanImages,
    readManifest: readManifest,
    writeManifest: writeManifest,
    collect: collect,
    encryptStaging: encryptStaging,
};
