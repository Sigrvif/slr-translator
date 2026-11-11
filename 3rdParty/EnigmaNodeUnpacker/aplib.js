/**
 * aPLib decompressor — port of the x86 implementation in sub_47C1D0.
 *
 * The EnigmaVB loader uses a 4-byte magic header (0x505A384D "M8ZP" or
 * 0x905A384D "M8Z\x90") prepended to the compressed stream.  This magic IS
 * part of the compressed data — the first byte of the magic is the initial
 * literal byte that aPLib always outputs.  Callers should pass the ENTIRE
 * compressed buffer (including the magic) to decompress().
 *
 * Ported from unpacker/aplib.py which was reverse-engineered from
 * EnigmaVBUnpacker.exe sub_47C1D0.
 */

'use strict';

class AplibError extends Error {
  constructor(msg) { super(msg); this.name = 'AplibError'; }
}

/**
 * Decompress an aPLib-compressed buffer.
 *
 * @param {Buffer} data - compressed data (including M8ZP/M8Z90 magic)
 * @param {number|null} expectedSize - if given, pre-allocate output to this size
 * @returns {Buffer} decompressed data
 */
function decompress(data, expectedSize) {
  if (data.length === 0) throw new AplibError('empty input');

  const out = expectedSize && expectedSize > 0
    ? Buffer.alloc(expectedSize)
    : Buffer.alloc(data.length * 8);
  let outLen = 0;  // actual bytes written

  let si = 0;   // source index
  let di = 0;   // destination index

  // --- Bitstream state ---
  let tag = 0;
  let bitcount = 0;

  // --- Match state ---
  let lastOffset = 0;
  let lwm = 0;

  function getbit() {
    bitcount--;
    if (bitcount < 0) {
      if (si >= data.length) throw new AplibError('truncated bitstream');
      tag = data[si++];
      bitcount = 7;
    }
    const bit = (tag >> 7) & 1;
    tag = (tag << 1) & 0xFF;
    return bit;
  }

  function getgamma() {
    let result = 1;
    for (;;) {
      result = (result << 1) + getbit();
      if (getbit() === 0) break;
    }
    return result;
  }

  // For dynamic growth we use an array-based approach when expectedSize
  // is not provided; otherwise we write directly into the pre-allocated Buffer.
  const outArr = expectedSize ? null : [];
  function writeByte(b) {
    if (expectedSize) {
      out[di] = b;
    } else {
      outArr.push(b);
    }
    di++;
  }
  function readByte(offset) {
    if (expectedSize) {
      return out[offset];
    } else {
      return outArr[offset];
    }
  }

  // --- First byte: literal copy ---
  writeByte(data[0]);
  si = 1;
  di = 1;

  for (;;) {
    if (getbit() === 0) {
      // --- Literal byte ---
      if (si >= data.length) break;
      if (expectedSize && di >= expectedSize) break;
      writeByte(data[si]);
      si++;
      lwm = 0;
      continue;
    }

    // --- Match / pair ---
    if (getbit() === 1) {
      // Two decision bits set (11x)
      if (getbit() === 1) {
        // Three bits set (111): short match — 4-bit offset
        let offs = 0;
        for (let k = 0; k < 4; k++) offs = (offs << 1) | getbit();
        if (offs === 0) {
          writeByte(0);
        } else {
          writeByte(readByte(di - offs));
        }
        lwm = 0;
      } else {
        // Two bits set (110): medium match or end-of-stream
        if (si >= data.length) throw new AplibError('truncated medium match');
        const b = data[si++];
        const length = 2 + (b & 1);
        const offs = b >> 1;
        if (offs === 0) break;  // end of stream
        for (let k = 0; k < length; k++) writeByte(readByte(di - offs));
        lastOffset = offs;
        lwm = 1;
      }
    } else {
      // One bit set (10): long match
      let offs = getgamma();
      if (lwm === 0 && offs === 2) {
        // Repeat last offset
        offs = lastOffset;
        const length = getgamma();
        for (let k = 0; k < length; k++) writeByte(readByte(di - offs));
      } else {
        if (lwm === 0) offs -= 3;
        else offs -= 2;
        if (si >= data.length) throw new AplibError('truncated long match offset');
        const low = data[si++];
        offs = (offs << 8) + low;
        let length = getgamma();
        if (offs >= 32000) length++;
        if (offs >= 1280) length++;
        if (offs < 128) length += 2;
        for (let k = 0; k < length; k++) writeByte(readByte(di - offs));
        lastOffset = offs;
      }
      lwm = 1;
    }
  }

  if (expectedSize) {
    return out.subarray(0, Math.min(di, expectedSize));
  }
  return Buffer.from(outArr);
}

module.exports = { decompress, AplibError };
