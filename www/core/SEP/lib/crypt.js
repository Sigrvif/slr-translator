"use strict";
/*
 * crypt.js — RPG Maker MV/MZ image encryption (pure Buffer functions).
 *
 * MV (.rpgmvp) and MZ (.png_) encrypt images identically: a 16-byte fake
 * header (RPGMV\0\0\0 + version + remain) is prepended and the first 16
 * payload bytes are XORed with the game's 16-byte key (System.json ->
 * encryptionKey, hex). Payloads are PNGs, so the key can also be derived
 * from any encrypted image. Mirrors the reference decrypter and rmmv.js's
 * RMMVDecrypter, but synchronous on Buffers for SEP's staging/export
 * pipelines. Runs in NW.js and plain Node.
 *
 * Encrypted videos (.rwebm) use a different, third-party scheme: the first
 * min(len, 1024) bytes of an otherwise plain WebM file are XORed with a
 * repeating ASCII key that ships inside the game's own JS (widespread
 * "RMMVSecure"-style video player plugins). decryptVideo/encryptVideo
 * implement that prefix XOR; key discovery lives in game.js.
 */

var RPG_HEADER = Buffer.from("5250474d560000000003010000000000", "hex");
var PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
var PNG_SIG = PNG_HEADER.slice(0, 8);

// WebM/Matroska files start with the EBML magic 0x1A45DFA3; used to
// validate video keys. Encrypted video players that only hide the header
// produce files without any special header, so there is no magic to detect
// the encrypted state itself — extension (.rwebm) is the trigger.
var EBML_MAGIC = Buffer.from("1a45dfa3", "hex");
var VIDEO_ENC_PREFIX_LEN = 1024;

// Keys tried when discovering the video XOR key (see game.js detectVideoKey).
// Third-party video plugins ship the same ASCII key in their JS; keep the
// list in sync with what is actually seen in games.
var VIDEO_XOR_KEYS = [
    "RMMVSecure123!@", // "webmplay"-style rwebm players (verified in the wild)
];

function parseKey(keyHex) {
    if (typeof keyHex !== "string" || !/^[0-9a-fA-F]{32}$/.test(keyHex))
        throw new Error("Invalid encryption key (expected 32 hex characters)");
    return Buffer.from(keyHex.toLowerCase(), "hex");
}

function isEncrypted(buf) {
    return Boolean(buf) && buf.length >= 32 && buf.slice(0, 16).equals(RPG_HEADER);
}

function decrypt(buf, keyHex) {
    if (!buf || buf.length < 32)
        throw new Error("Encrypted image is too short (< 32 bytes)");
    if (!buf.slice(0, 16).equals(RPG_HEADER))
        throw new Error("Not an RPG Maker MV/MZ encrypted image (bad header)");
    var key = parseKey(keyHex);
    var out = Buffer.from(buf.slice(16));
    for (var i = 0; i < 16; i++) out[i] = out[i] ^ key[i];
    if (!out.slice(0, 16).equals(PNG_HEADER))
        throw new Error("Decryption failed (wrong key or non-PNG payload)");
    return out;
}

function encrypt(pngBuf, keyHex) {
    if (!pngBuf || pngBuf.length < 16)
        throw new Error("PNG buffer is too short to encrypt (< 16 bytes)");
    var key = parseKey(keyHex);
    var out = Buffer.from(pngBuf);
    for (var i = 0; i < 16; i++) out[i] = out[i] ^ key[i];
    return Buffer.concat([RPG_HEADER, out]);
}

function deriveKey(encBuf) {
    if (!encBuf || encBuf.length < 32)
        throw new Error("Encrypted image is too short (< 32 bytes)");
    if (!encBuf.slice(0, 16).equals(RPG_HEADER))
        throw new Error("Not an RPG Maker MV/MZ encrypted image (bad header)");
    var key = Buffer.alloc(16);
    for (var i = 0; i < 16; i++) key[i] = encBuf[16 + i] ^ PNG_HEADER[i];
    return key.toString("hex");
}

// ---- encrypted videos (.rwebm): prefix XOR with a repeating ASCII key ----

function xorPrefix(buf, keyStr) {
    var out = Buffer.from(buf); // never mutate the caller's buffer
    var key = Buffer.from(String(keyStr), "utf8");
    if (key.length === 0) throw new Error("Empty video encryption key");
    var n = Math.min(out.length, VIDEO_ENC_PREFIX_LEN);
    for (var i = 0; i < n; i++) out[i] = out[i] ^ key[i % key.length];
    return out;
}

function decryptVideo(buf, keyStr) {
    if (!buf || buf.length < 4)
        throw new Error("Encrypted video is too short (< 4 bytes)");
    var out = xorPrefix(buf, keyStr);
    if (!out.slice(0, 4).equals(EBML_MAGIC))
        throw new Error("Video decryption failed (wrong key or not a WebM payload)");
    return out;
}

function encryptVideo(webmBuf, keyStr) {
    if (!webmBuf || webmBuf.length < 4)
        throw new Error("WebM buffer is too short to encrypt (< 4 bytes)");
    if (!webmBuf.slice(0, 4).equals(EBML_MAGIC))
        throw new Error("Not a WebM file (bad EBML header)");
    return xorPrefix(webmBuf, keyStr);
}

module.exports = {
    RPG_HEADER: RPG_HEADER,
    PNG_HEADER: PNG_HEADER,
    PNG_SIG: PNG_SIG,
    EBML_MAGIC: EBML_MAGIC,
    VIDEO_XOR_KEYS: VIDEO_XOR_KEYS,
    isEncrypted: isEncrypted,
    decrypt: decrypt,
    encrypt: encrypt,
    deriveKey: deriveKey,
    decryptVideo: decryptVideo,
    encryptVideo: encryptVideo,
};
