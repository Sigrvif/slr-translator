"use strict";

/** EnigmaVB unpacker — port of enigma_vb.py.
 *
 * Implements header parsing, version detection, file-table walking (codes 1-7),
 * file extraction (raw / single-block aPLib / chunked aPLib), and PE rebuild.
 */

const fs = require("fs");
const path = require("path");
const { decompress: aplibDecompress } = require("./aplib.js");
const { X86_TABLE, X64_TABLE } = require("./version-tables.js");
const { PE, rebuildPE, writeAll } = require("./pe-utils.js");

const MAGIC_MZ8P = 0x505a384d;
const MAGIC_MZ8X = 0x905a384d;

// ---------------------------------------------------------------------------
// Stream — read-only cursor over a Buffer or a file-backed PE
// ---------------------------------------------------------------------------
// Passing a PE keeps memory flat regardless of exe size: small reads are
// served from a 64 KiB read-ahead cache and larger reads go straight to the
// file. (A Buffer is still accepted for legacy in-memory use.) Note that
// fs.readFileSync() cannot read files larger than 2 GiB at all.

const STREAM_CACHE = 1 << 16; // 64 KiB

class Stream {
  constructor(source, pos = 0) {
    this.pos = pos;
    if (Buffer.isBuffer(source)) {
      this.data = source;
    } else {
      this.src = source; // file-backed PE ({ readAt, size })
      this._cache = null;
      this._cacheStart = 0;
    }
  }
  seek(pos) { this.pos = pos; }
  read(n) {
    let b;
    if (this.data) {
      const end = this.pos + n;
      if (end > this.data.length) throw new Error(`read past EOF at 0x${this.pos.toString(16)}+0x${n.toString(16)}`);
      b = this.data.subarray(this.pos, end);
    } else if (n === 0) {
      return Buffer.alloc(0);
    } else if (n >= STREAM_CACHE) {
      b = this.src.readAt(this.pos, n); // may throw past EOF
      this._cache = null;
    } else {
      const cs = this.pos - this._cacheStart;
      if (!this._cache || cs < 0 || cs + n > this._cache.length) {
        this._cache = this.src.readAt(this.pos, Math.min(STREAM_CACHE, this.src.size - this.pos)); // may throw past EOF
        this._cacheStart = this.pos;
      }
      const off = this.pos - this._cacheStart;
      if (off + n > this._cache.length) {
        throw new Error(`read past EOF at 0x${this.pos.toString(16)}+0x${n.toString(16)}`);
      }
      b = this._cache.subarray(off, off + n);
    }
    this.pos += n;
    return b;
  }
  u8() { return this.read(1)[0]; }
  u16() { return this.read(2).readUInt16LE(0); }
  u32() { return this.read(4).readUInt32LE(0); }
  u64() {
    const lo = this.read(4).readUInt32LE(0);
    const hi = this.read(4).readUInt32LE(0);
    return BigInt(lo) | (BigInt(hi) << 32n);
  }
}

// ---------------------------------------------------------------------------
// Header parsing (sub_47AA9C)
// ---------------------------------------------------------------------------

function parseEnigmaHeader(pe, e1) {
  const isX64 = pe.isPE32Plus;
  const base = e1.rawOffset;

  const flagsOff = base + (isX64 ? 0x8c : 0x74);
  const flags = pe.readAt(flagsOff, 4);
  const allLeOne = flags[0] <= 1 && flags[1] <= 1 && flags[2] <= 1 && flags[3] <= 1;
  let b4Base;
  if (isX64) {
    b4Base = allLeOne ? 0 : 4;   // inverted from x86
  } else {
    b4Base = allLeOne ? 4 : 0;
  }

  const primary = isX64 ? 0xb4 : 0x9c;
  const search = [
    [0x00, 0x00, 0x00],
    [isX64 ? 0x08 : 0x0c, isX64 ? 0x00 : 0x04, 0x00],
    [isX64 ? 0x14 : 0x38, isX64 ? 0x04 : 0x00, 0x00],
    [0x40, 0x00, isX64 ? 0x00 : 0x00],
    [isX64 ? 0x50 : 0x7c, isX64 ? 0x00 : 0x04, isX64 ? 0x10 : 0x08],
    [0x8c, 0x04, 0x10], // x64 only
  ];

  let chosen = null;
  for (const [b8, bc, b4Extra] of search) {
    const ptrOff = base + primary + b8;
    if (ptrOff + 4 > pe.size) continue;
    const ptr = pe.readAt(ptrOff, 4).readUInt32LE(0);
    const sigOff = base + ptr;
    if (sigOff + 4 > pe.size) continue;
    const sig = pe.readAt(sigOff, 4).readUInt32LE(0);
    if (sig === 0x00425645) { // "EVB\0"
      chosen = { evbPtr: ptr, b8, bc, b4: b4Base + b4Extra };
      break;
    }
  }
  if (!chosen) throw new Error("EVB signature not found; not an EnigmaVB-packed file?");

  const { evbPtr, b8, bc, b4 } = chosen;

  const compressedFlag = pe.readAt(base + b4 + (isX64 ? 0x8c : 0x70), 1)[0];
  const dataSize = pe.readAt(base + b4 + (isX64 ? 0x88 : 0x6c), 4).readUInt32LE(0);
  const loaderUncSize = pe.readAt(base + b4 + (isX64 ? 0x98 : 0x74), 4).readUInt32LE(0);
  const loaderCompSize = pe.readAt(base + b4 + (isX64 ? 0x9c : 0x78), 4).readUInt32LE(0);

  return { isX64, b4, b8, bc, evbPtr, compressedFlag, dataSize, loaderUncSize, loaderCompSize };
}

// ---------------------------------------------------------------------------
// Version detection (sub_47869C)
// ---------------------------------------------------------------------------

function detectVersion(pe, e1, hdr) {
  const base = e1.rawOffset;

  if (hdr.loaderUncSize === 0) return [null, null];

  const pos0 = base + hdr.evbPtr + hdr.dataSize;
  let pos = -1;
  for (const delta of [0, 0x0a]) {
    const p = pos0 + delta;
    if (p + 4 > pe.size) continue;
    const magic = pe.readAt(p, 4).readUInt32LE(0);
    if (magic === MAGIC_MZ8P || magic === MAGIC_MZ8X) { pos = p; break; }
  }
  if (pos < 0) return [null, null];

  if (pos + hdr.loaderCompSize > pe.size) return [null, null];
  const comp = pe.readAt(pos, hdr.loaderCompSize);
  let dec;
  try {
    dec = aplibDecompress(comp, hdr.loaderUncSize);
  } catch { return [null, null]; }

  if (dec.subarray(0, 2).toString("latin1") !== "MZ") return [null, null];

  const hashVal = extractVersionHash(dec, hdr.isX64);
  if (hashVal === null) return [null, null];

  const table = hdr.isX64 ? X64_TABLE : X86_TABLE;
  const entry = table.find(e => e[0] === hashVal);
  if (entry) return [entry[1], entry[2]];
  return [null, null];
}

function extractVersionHash(peData, isX64) {
  if (peData.length < 0x40) return null;
  const peOff = peData.readUInt32LE(0x3c);
  if (peOff + 24 > peData.length) return null;
  const optOff = peOff + 24;

  if (isX64) {
    // SizeOfCode at peOff + 0x1C
    if (peOff + 0x1c + 4 > peData.length) return null;
    return peData.readUInt32LE(peOff + 0x1c);
  }

  // x86: TimeDateStamp at .rsrc+4
  if (optOff + 0x70 + 8 > peData.length) return null;
  const resRva = peData.readUInt32LE(optOff + 0x70);
  if (resRva === 0) return null;

  const numSec = peData.readUInt16LE(peOff + 6);
  const optSize = peData.readUInt16LE(peOff + 20);
  const secTbl = optOff + optSize;
  for (let i = 0; i < numSec; i++) {
    const so = secTbl + i * 40;
    if (so + 40 > peData.length) break;
    const va = peData.readUInt32LE(so + 12);
    const vs = peData.readUInt32LE(so + 8);
    const rs = peData.readUInt32LE(so + 16);
    const ro = peData.readUInt32LE(so + 20);
    if (va <= resRva && resRva < va + Math.max(vs, rs, 1)) {
      const fileOff = ro + (resRva - va);
      if (fileOff + 8 <= peData.length) return peData.readUInt32LE(fileOff + 4);
      break;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// File-table walker
// ---------------------------------------------------------------------------

class FileEntry {
  constructor(opts) { Object.assign(this, opts); }
}

class Unpacker {
  constructor(stream, code, dataBase, compressedFlag) {
    this.s = stream;
    this.code = code;
    this.dataBase = dataBase;
    this.compressedFlag = compressedFlag;
    this.qword4861C4 = 0n;
    this.files = [];
  }

  // ---- wide-string helpers ----

  readWideStringBuf(buf, off) {
    const chars = [];
    let end = off;
    while (end + 2 <= buf.length) {
      const ch = buf.readUInt16LE(end);
      end += 2;
      if (ch === 0) break;
      chars.push(ch);
    }
    return [String.fromCodePoint(...chars), end];
  }

  readWideStringStream() {
    const chars = [];
    for (;;) {
      const ch = this.s.u16();
      if (ch === 0) break;
      chars.push(ch);
    }
    return String.fromCodePoint(...chars);
  }

  // ---- top-level walk (sub_479888) ----

  walk() {
    const s = this.s;
    let start, endRecords;

    if ([1, 2, 3, 4].includes(this.code)) {
      s.seek(this.dataBase + 0x28);
      endRecords = BigInt(s.u32());
      start = 0x43;
    } else if ([5, 6].includes(this.code)) {
      s.seek(this.dataBase + 0x30);
      endRecords = s.u64();
      start = 0x53;
    } else if (this.code === 7) {
      s.seek(this.dataBase + 0x30);
      endRecords = s.u64();
      s.seek(this.dataBase + 0x40);
      this.qword4861C4 = s.u64() + 0x44n;
      start = 0x53;
    } else {
      throw new Error(`unsupported version code ${this.code}`);
    }

    let pos = BigInt(start);
    if (this.code === 7) {
      while (pos < this.qword4861C4) {
        pos = BigInt(this.walkRecordCode7(Number(pos), ""));
      }
    } else {
      while (pos < endRecords) {
        pos = BigInt(this.walkRecordCode1_6(Number(pos), ""));
      }
    }
  }

  // ---- code 1-6 walker (sub_4777EC) ----

  walkRecordCode1_6(recOff, pathPrefix) {
    const s = this.s;
    s.seek(this.dataBase + recOff);
    const recSize = s.u32();
    if (recSize > 0x10000000) throw new Error(`record size too large: 0x${recSize.toString(16)}`);
    const buf = s.read(recSize);
    let off = 0;

    off += 4; // field1
    off += 4; // field2
    const subCount = buf.readUInt32LE(off); off += 4;
    let name; [name, off] = this.readWideStringBuf(buf, off);
    const recType = buf[off]; off += 1;

    if (recType === 2) {
      return this.handleFileCode1_6(buf, off, recOff, recSize, pathPrefix, name);
    } else if (recType === 1 || recType === 3) {
      const nextOff = recOff + 4 + recSize;
      const subPrefix = pathPrefix + name + "\\";
      let cur = nextOff;
      for (let i = 0; i < subCount; i++) {
        cur = this.walkRecordCode1_6(cur, subPrefix);
      }
      return cur;
    }
    return recOff + 4 + recSize;
  }

  handleFileCode1_6(buf, off, recOff, recSize, pathPrefix, name) {
    off += 1; // var_3B
    off += 1; // var_3A
    const size = buf.readBigUInt64LE(off); off += 8;
    const t1 = buf.readBigUInt64LE(off); off += 8;
    const t2 = buf.readBigUInt64LE(off); off += 8;
    const t3 = buf.readBigUInt64LE(off); off += 8;
    const attr = buf.readUInt32LE(off); off += 4;
    off += 1; // var_15
    let secondName; [secondName, off] = this.readWideStringBuf(buf, off);

    let storedSize;
    if (this.code <= 4) {
      storedSize = BigInt(buf.readUInt32LE(off)); off += 4;
    } else {
      storedSize = buf.readBigUInt64LE(off); off += 8;
    }

    const dataPos = this.dataBase + recOff + 4 + recSize;
    const isChunked = this.code >= 4;
    const isCompressed = !!this.compressedFlag;

    this.files.push(new FileEntry({
      path: pathPrefix + name,
      size, dataPos, storedSize, attr,
      isCompressed, isChunked, times: [t1, t2, t3],
    }));
    return Number(BigInt(recOff) + 4n + BigInt(recSize) + storedSize);
  }

  // ---- code 7 walker (sub_476F1C) ----

  walkRecordCode7(recOff, pathPrefix) {
    const s = this.s;
    s.seek(this.dataBase + recOff);
    s.u32(); // field1
    s.u32(); // field2
    const subCount = s.u32();
    const name = this.readWideStringStream();
    const recType = s.u8();

    if (recType === 2) {
      return this.handleFileCode7(recOff, pathPrefix, name);
    } else if (recType === 1) {
      const subPrefix = pathPrefix + name + "\\";
      let nextOff = s.pos - this.dataBase;
      for (let i = 0; i < subCount; i++) {
        nextOff = this.walkRecordCode7(nextOff, subPrefix);
      }
      return nextOff;
    } else if (recType === 3) {
      s.u8();  s.u64(); s.u64(); s.u64(); s.u32();
      const subPrefix = pathPrefix + name + "\\";
      let nextOff = s.pos - this.dataBase;
      for (let i = 0; i < subCount; i++) {
        nextOff = this.walkRecordCode7(nextOff, subPrefix);
      }
      return nextOff;
    }
    return s.pos - this.dataBase;
  }

  handleFileCode7(recOff, pathPrefix, name) {
    const s = this.s;
    s.u8(); s.u8();
    const size = s.u64();
    const t1 = s.u64(), t2 = s.u64(), t3 = s.u64();
    const attr = s.u32();
    s.u8();
    this.readWideStringStream(); // second name
    const dataRel = s.u64();
    const storedSize = s.u64();
    const metaEndRel = s.pos - this.dataBase;

    const dataPos = Number(BigInt(this.dataBase) + this.qword4861C4 + dataRel);
    this.files.push(new FileEntry({
      path: pathPrefix + name,
      size, dataPos, storedSize, attr,
      isCompressed: !!this.compressedFlag, isChunked: true,
      times: [t1, t2, t3],
    }));
    return metaEndRel;
  }

  // ---- extraction (sub_4769E8) ----

  extractFile(entry, outPath) {
    const s = this.s;
    fs.mkdirSync(path.dirname(outPath) || ".", { recursive: true });

    const size = Number(entry.size);
    const storedSize = Number(entry.storedSize);

    if (size === 0 && storedSize === 0) {
      fs.writeFileSync(outPath, Buffer.alloc(0));
      return true;
    }

    if (!this.compressedFlag) {
      s.seek(entry.dataPos);
      const fd = fs.openSync(outPath, "w");
      try {
        let remaining = storedSize;
        while (remaining > 0) {
          const chunk = s.read(Math.min(remaining, 1 << 20));
          writeAll(fd, chunk);
          remaining -= chunk.length;
        }
      } finally {
        fs.closeSync(fd);
      }
      return true;
    }

    if (!entry.isChunked) {
      s.seek(entry.dataPos);
      const comp = s.read(storedSize);
      try {
        const dec = aplibDecompress(comp, size);
        const fd = fs.openSync(outPath, "w");
        try {
          writeAll(fd, dec); // chunked write: single fs.writeSync caps at 2 GiB
        } finally {
          fs.closeSync(fd);
        }
        return true;
      } catch (e) {
        process.stderr.write(`[x] decompress failed for ${entry.path}: ${e.message}\n`);
        return false;
      }
    }

    // chunked aPLib: decompress chunk-by-chunk straight to disk so neither
    // memory use nor any single write scales with the file size (files that
    // decompress past 2 GiB used to fail with ERR_OUT_OF_RANGE).
    s.seek(entry.dataPos);
    const fd = fs.openSync(outPath, "w");
    let written = 0;
    let ok = true;
    let rethrow = null;
    try {
      while (written < size) {
        const chunkOff = Number(s.u64());
        const chunkSize = s.u32();
        const savedPos = s.pos;
        const baseOff = this.code === 7
          ? Number(BigInt(this.dataBase) + this.qword4861C4 + BigInt(chunkOff))
          : entry.dataPos + chunkOff;
        s.seek(baseOff);
        const comp = s.read(chunkSize);
        s.seek(savedPos);
        try {
          const dec = aplibDecompress(comp, 0x10000);
          const take = Math.min(dec.length, size - written);
          writeAll(fd, dec.subarray(0, take));
          written += take;
        } catch (e) {
          process.stderr.write(`[x] chunk decompress failed for ${entry.path}: ${e.message}\n`);
          ok = false;
          break;
        }
      }
    } catch (e) {
      ok = false; // e.g. corrupt chunk table (read past EOF) — no partial file
      rethrow = e;
    } finally {
      fs.closeSync(fd);
    }
    if (!ok) {
      try { fs.unlinkSync(outPath); } catch (_) {}
      if (rethrow) throw rethrow;
      return false;
    }
    return true;
  }
}

module.exports = {
  Stream, parseEnigmaHeader, detectVersion, Unpacker, FileEntry,
  rebuildPE,
};
