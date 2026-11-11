"use strict";

/** Minimal PE parser for locating .enigma1/.enigma2 sections.
 *
 * Port of pe_utils.py. Only implements what the unpacker needs:
 *   - section table read
 *   - optional header field reads
 *   - PE rebuilder (strip last two sections)
 *
 * The packed exe is NOT loaded into memory: only the DOS/COFF/section
 * headers are read up front and everything else is fetched on demand via
 * readAt(). Node's fs.readFileSync() refuses to read files larger than
 * 2 GiB (ERR_FS_FILE_TOO_LARGE) on every architecture, and buffering a
 * multi-GiB packed exe in RAM would be wasteful even where it works.
 */

const fs = require("fs");

const PE_SIG = Buffer.from([0x50, 0x45, 0x00, 0x00]); // "PE\0\0"
const COPY_CHUNK = 1 << 20; // 1 MiB streaming copy chunk

class Section {
  constructor(opts) {
    Object.assign(this, opts);
  }
}

class PE {
  /** Open filePath as a file-backed PE (headers parsed eagerly, data read
   *  on demand via readAt()). A Buffer may be passed instead for legacy
   *  in-memory use. Call close() when done with a file-backed PE. */
  constructor(filePathOrData) {
    this.fd = null;
    if (Buffer.isBuffer(filePathOrData)) {
      this._data = filePathOrData;
      this.size = filePathOrData.length;
      this._parse();
    } else {
      this.fd = fs.openSync(filePathOrData, "r");
      try {
        this.size = fs.fstatSync(this.fd).size;
        this._parse();
      } catch (e) {
        this.close();
        throw e;
      }
    }
  }

  _parse() {
    const dos = this.readAt(0, 0x40);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE file"); // 'MZ'
    this.peOffset = dos.readUInt32LE(0x3c);
    if (this.readAt(this.peOffset, 4).compare(PE_SIG) !== 0) {
      throw new Error("not a PE file");
    }

    // COFF header (right after the PE signature)
    const coff = this.readAt(this.peOffset + 4, 20);
    this.numSections = coff.readUInt16LE(2);
    this.optSize = coff.readUInt16LE(16);
    this.optStart = this.peOffset + 24;
    this.sectionTable = this.optStart + this.optSize;

    const opt = this.readAt(this.optStart, this.optSize);
    this.optMagic = opt.readUInt16LE(0);
    this.isPE32Plus = this.optMagic === 0x20b;

    const table = this.readAt(this.sectionTable, this.numSections * 40);
    this.sections = [];
    for (let i = 0; i < this.numSections; i++) {
      const base = i * 40;
      const nameBytes = table.subarray(base, base + 8);
      const nameEnd = nameBytes.indexOf(0);
      this.sections.push(new Section({
        name: (nameEnd >= 0 ? nameBytes.subarray(0, nameEnd) : nameBytes).toString("latin1"),
        virtualSize: table.readUInt32LE(base + 8),
        virtualAddress: table.readUInt32LE(base + 12),
        rawSize: table.readUInt32LE(base + 16),
        rawOffset: table.readUInt32LE(base + 20),
        characteristics: table.readUInt32LE(base + 36),
      }));
    }
  }

  /** Read `length` bytes at absolute file offset and return them as a new
   *  Buffer. Throws (rather than returning a short read) past EOF. */
  readAt(offset, length) {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new Error(`read past EOF at 0x${offset.toString(16)}+0x${length.toString(16)}`);
    }
    if (length === 0) return Buffer.alloc(0);
    if (this._data) return Buffer.from(this._data.subarray(offset, offset + length));
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const n = fs.readSync(this.fd, buf, done, length - done, offset + done);
      if (n <= 0) throw new Error(`unexpected EOF at 0x${(offset + done).toString(16)}`);
      done += n;
    }
    return buf;
  }

  close() {
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } finally { this.fd = null; }
    }
  }

  findSection(name) {
    return this.sections.find(s => s.name === name) || null;
  }
}

function parsePE(filePath) {
  return new PE(filePath);
}

/** Write buf[offset, offset+length) fully to fd. Never issues a single
 *  write larger than 1 MiB: fs.writeSync() rejects lengths > 2^31-1
 *  (ERR_OUT_OF_RANGE) and partial writes are possible on some platforms. */
function writeAll(fd, buf, offset = 0, length = buf.length - offset) {
  let done = 0;
  while (done < length) {
    const n = fs.writeSync(fd, buf, offset + done, Math.min(1 << 20, length - done));
    done += n;
  }
}

/** Rebuild _unpacked.exe: remove .enigma1/.enigma2, patch header.
 *  Streams the stub copy from the packed file in 1 MiB chunks so neither
 *  memory use nor a single write ever scales with the file size. */
function rebuildPE(pe, e1, e2, outPath) {
  const coffOff = pe.peOffset + 4;
  const optOff = pe.optStart;
  const newNum = pe.numSections - 2;

  // Truncate to end of new last section
  const lastKept = pe.sections[pe.sections.length - 3] || pe.sections[0];
  const endOfData = Math.min(lastKept.rawOffset + lastKept.rawSize, pe.size);

  // Patch SizeOfImage
  let newSizeOfImage = lastKept.virtualAddress + lastKept.virtualSize;
  const sectionAlign = pe.readAt(optOff + 32, 4).readUInt32LE(0);
  if (sectionAlign > 0) {
    newSizeOfImage = (newSizeOfImage + sectionAlign - 1) & ~(sectionAlign - 1);
  }

  const outFd = fs.openSync(outPath, "w");
  try {
    // 1. Copy [0, endOfData) from the packed exe
    let off = 0;
    while (off < endOfData) {
      const n = Math.min(COPY_CHUNK, endOfData - off);
      writeAll(outFd, pe.readAt(off, n));
      off += n;
    }

    // 2. Patch NumberOfSections
    const w = Buffer.alloc(4);
    w.writeUInt16LE(newNum, 0);
    fs.writeSync(outFd, w, 0, 2, coffOff + 2);

    // 3. Patch SizeOfImage
    w.writeUInt32LE(newSizeOfImage >>> 0, 0);
    fs.writeSync(outFd, w, 0, 4, optOff + 56);

    // 4. Zero out removed section entries
    const zero = Buffer.alloc(40);
    for (let i = newNum; i < pe.numSections; i++) {
      fs.writeSync(outFd, zero, 0, 40, pe.sectionTable + i * 40);
    }
  } finally {
    fs.closeSync(outFd);
  }
}

module.exports = { PE, Section, parsePE, rebuildPE, writeAll };
