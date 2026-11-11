"use strict";
/**
 * enigmaUnpacker.js — cross-platform Enigma Virtual Box detection + unpacking.
 *
 * Wraps the bundled pure-Node port in 3rdParty/EnigmaNodeUnpacker/ so the app
 * can detect and unpack EnigmaVB-packed MV/MZ executables on any OS, replacing
 * the old Windows-only EnigmaVBUnpacker.exe.
 *
 *   common.enigma.isEnigmaPacked(exePath)   -> bool   (fast, header-only)
 *   common.enigma.unpack(exePath, outDir)   -> {ok, failed, total, version}
 *   common.enigma.findGameDir(outDir)       -> dir holding the real game
 */
var fs = require("fs");
var nwPath = require("path");

var _mods = null;
function mods() {
	if (_mods) return _mods;
	var dir = nwPath.join(common.getRootDir(), "3rdParty", "EnigmaNodeUnpacker");
	_mods = {
		pe: require(nwPath.join(dir, "pe-utils.js")),
		evb: require(nwPath.join(dir, "enigma-vb.js")),
	};
	return _mods;
}

/**
 * Fast header-only check: does exePath have both .enigma1 and .enigma2 PE
 * sections? Reads only the DOS/COFF headers + section table (~1 KB), so it is
 * cheap to run on any executable regardless of size.
 */
function isEnigmaPacked(exePath) {
	var fd;
	try {
		fd = fs.openSync(exePath, "r");
		var dos = Buffer.alloc(64);
		if (fs.readSync(fd, dos, 0, 64, 0) < 64) return false;
		if (dos.readUInt16LE(0) !== 0x5a4d) return false; // 'MZ'
		var peOff = dos.readUInt32LE(0x3c);
		var coff = Buffer.alloc(24);
		if (fs.readSync(fd, coff, 0, 24, peOff) < 24) return false;
		if (coff.readUInt32LE(0) !== 0x00004550) return false; // 'PE\0\0'
		var numSections = coff.readUInt16LE(6);
		var sizeOpt = coff.readUInt16LE(20);
		var tableOff = peOff + 24 + sizeOpt;
		var tableBuf = Buffer.alloc(numSections * 40);
		if (fs.readSync(fd, tableBuf, 0, tableBuf.length, tableOff) < tableBuf.length) return false;
		var has1 = false, has2 = false;
		for (var i = 0; i < numSections; i++) {
			var name = tableBuf.slice(i * 40, i * 40 + 8).toString("latin1").replace(/\0[\s\S]*$/, "");
			if (name === ".enigma1") has1 = true;
			if (name === ".enigma2") has2 = true;
		}
		return has1 && has2;
	} catch (e) {
		return false;
	} finally {
		try { if (fd !== undefined) fs.closeSync(fd); } catch (_) {}
	}
}

// Path-traversal-safe join (mirrors the unpacker's main.js).
function safeJoin(baseDir, virtualPath) {
	var parts = [];
	var segs = String(virtualPath).replace(/\//g, "\\").split("\\");
	for (var i = 0; i < segs.length; i++) {
		var raw = segs[i];
		if (!raw || raw === ".") continue;
		if (raw === "..") return null;
		if (raw.indexOf("\0") !== -1) return null;
		if (raw.length === 2 && raw[1] === ":") return null;
		parts.push(raw);
	}
	if (!parts.length) return null;
	return nwPath.join.apply(null, [baseDir].concat(parts));
}

/**
 * Unpack an EnigmaVB-packed executable into outDir (full extraction).
 * onProgress(done, total, ok, failed) is called periodically.
 */
async function unpack(exePath, outDir, onProgress) {
	var m = mods();
	var parsed = m.pe.parsePE(exePath);
	try {
		var e1 = parsed.findSection(".enigma1");
		if (!e1) throw new Error("Not an EnigmaVB-packed file (no .enigma1 section).");
		var hdr = m.evb.parseEnigmaHeader(parsed, e1);
		var ver = m.evb.detectVersion(parsed, e1, hdr);
		var label = ver[0], code = ver[1];
		if (!label) throw new Error("Could not detect the EnigmaVB version.");
		fs.mkdirSync(outDir, { recursive: true });
		var stream = new m.evb.Stream(parsed); // file-backed: works past 2 GiB, flat memory
		var up = new m.evb.Unpacker(stream, code, e1.rawOffset + hdr.evbPtr, hdr.compressedFlag);
		up.walk();

		var ok = 0, failed = 0, total = up.files.length;
		for (var i = 0; i < up.files.length; i++) {
			var entry = up.files[i];
			var outPath = safeJoin(outDir, entry.path);
			if (!outPath) { failed++; }
			else {
				try { if (up.extractFile(entry, outPath)) ok++; else failed++; }
				catch (e) { failed++; }
			}
			if (onProgress && ((i + 1) % 100 === 0 || i + 1 === total)) {
				try { onProgress(i + 1, total, ok, failed); } catch (_) {}
				// Yield to the event loop so the UI can paint the progress indicator.
				await new Promise(function (r) { setImmediate(r); });
			}
		}

		// Rename EnigmaVB's virtual root (e.g. "%DEFAULT FOLDER%") to a friendlier
		// name based on the source folder, so the "%" character never ends up in a path.
		try {
			var gameDir = findGameDir(outDir);
			if (gameDir !== outDir && nwPath.basename(gameDir).indexOf("%") !== -1) {
				var origName = nwPath.basename(nwPath.dirname(exePath)) || "Game";
				var target = nwPath.join(outDir, origName + " Unpacked");
				if (!fs.existsSync(target)) fs.renameSync(gameDir, target);
			}
		} catch (e) {}

		return { ok: ok, failed: failed, total: total, version: label };
	} finally {
		parsed.close();
	}
}

// True if d looks like an RPG Maker MV/MZ game root (with or without a www/
// folder — some MZ deployments drop www/ and place js/ at the root).
function looksLikeGameDir(d) {
	return fs.existsSync(nwPath.join(d, "www")) ||
		fs.existsSync(nwPath.join(d, "www", "js", "rpg_core.js")) ||
		fs.existsSync(nwPath.join(d, "www", "js", "rmmz_core.js")) ||
		fs.existsSync(nwPath.join(d, "js", "rpg_core.js")) ||
		fs.existsSync(nwPath.join(d, "js", "rmmz_core.js"));
}

/**
 * After unpacking, the real game lives under EnigmaVB's virtual root
 * ("%DEFAULT FOLDER%") or directly in outDir. Return the directory that holds
 * the game (MV www/, MZ js/rmmz_core.js, etc.), else outDir itself.
 */
function findGameDir(outDir) {
	try {
		var entries = fs.readdirSync(outDir);
		for (var i = 0; i < entries.length; i++) {
			var sub = nwPath.join(outDir, entries[i]);
			try { if (fs.statSync(sub).isDirectory() && looksLikeGameDir(sub)) return sub; } catch (e) {}
		}
		if (looksLikeGameDir(outDir)) return outDir;
	} catch (e) {}
	return outDir;
}

module.exports = { isEnigmaPacked: isEnigmaPacked, unpack: unpack, findGameDir: findGameDir };
