// www/core/llmRuntime/lib/GgufMeta.js
//
// Minimal GGUF metadata reader. The bundled runtime needs the model's architecture because
// llama.cpp's metadata overrides are keyed by the full metadata name, e.g.
// "gemma4.expert_used_count" - the generic "llama.expert_used_count" from most tutorials is
// silently ignored for any model whose architecture is not literally "llama".
//
// Only the metadata table is read, and reading stops as soon as the requested keys have been
// found, so a multi-gigabyte model costs a few milliseconds: the huge tokenizer arrays sit
// after the keys this app asks for. Nothing here throws; a file that cannot be read or is not
// GGUF simply yields no keys.
"use strict";

const GGUF_MAGIC = "GGUF";

// Metadata value type ids, in GGUF's fixed order.
const T_UINT8 = 0;
const T_INT8 = 1;
const T_UINT16 = 2;
const T_INT16 = 3;
const T_UINT32 = 4;
const T_INT32 = 5;
const T_FLOAT32 = 6;
const T_BOOL = 7;
const T_STRING = 8;
const T_ARRAY = 9;
const T_UINT64 = 10;
const T_INT64 = 11;
const T_FLOAT64 = 12;

// Fixed byte size per scalar type; undefined for string and array.
const SCALAR_SIZE = {
    [T_UINT8]: 1, [T_INT8]: 1, [T_UINT16]: 2, [T_INT16]: 2,
    [T_UINT32]: 4, [T_INT32]: 4, [T_FLOAT32]: 4, [T_BOOL]: 1,
    [T_UINT64]: 8, [T_INT64]: 8, [T_FLOAT64]: 8
};

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

// The longest requested array the reader will materialise. A real tokenizer/merge table can hold
// hundreds of thousands of entries, so anything bigger is skipped rather than read into memory.
const MAX_ARRAY_LENGTH = 4096;

// A numeric scalar is any fixed-size type except bool; strings are read separately (when
// requested and bounded), so this predicate only decides the numeric materialisation path.
function isNumericElementType(type) {
    return type !== T_BOOL && SCALAR_SIZE[type] !== undefined;
}

// A small buffered forward-only reader over a file descriptor. Reads never go past the byte
// budget, so a scan that would have to walk a huge tokenizer array gives up instead of
// reading a multi-gigabyte file.
function createReader(fd, fs, maxBytes) {
    const bufferSize = 256 * 1024;
    const buf = Buffer.alloc(bufferSize);
    let length = 0;    // valid bytes in buf
    let pos = 0;       // read cursor inside buf
    let filePos = 0;   // absolute file offset of buf[0]

    function consumed() { return filePos + pos; }

    function refill() {
        if (pos > 0) {
            const remaining = length - pos;
            if (remaining > 0) buf.copy(buf, 0, pos, length);
            filePos += pos;
            length = remaining;
            pos = 0;
        }
        if (length >= buf.length) return false;
        const room = maxBytes - (filePos + length);
        if (room <= 0) return false;
        const want = Math.min(buf.length - length, room);
        const read = fs.readSync(fd, buf, length, want, filePos + length);
        length += read;
        return read > 0;
    }

    function ensure(n) {
        while (length - pos < n) {
            if (!refill()) return false;
        }
        return true;
    }

    return {
        get consumed() { return consumed(); },
        bytes(n) {
            if (!ensure(n)) return null;
            const out = Buffer.from(buf.subarray(pos, pos + n));
            pos += n;
            return out;
        },
        u32() {
            const b = this.bytes(4);
            if (!b) return null;
            return b.readUInt32LE(0);
        },
        u64() {
            const b = this.bytes(8);
            if (!b) return null;
            return Number(b.readBigUInt64LE(0));
        },
        string(lenSize) {
            const len = lenSize === 4 ? this.u32() : this.u64();
            if (len === null || len === undefined) return null;
            const b = this.bytes(len);
            return b === null ? null : b.toString("utf8");
        },
        // Advance n bytes without materialising them.
        skip(n) {
            let left = n;
            while (left > 0) {
                if (length - pos === 0 && !refill()) return false;
                const take = Math.min(left, length - pos);
                pos += take;
                left -= take;
            }
            return true;
        }
    };
}

function readScalar(reader, type, lenSize) {
    switch (type) {
        case T_UINT8: { const b = reader.bytes(1); return b ? b.readUInt8(0) : null; }
        case T_INT8: { const b = reader.bytes(1); return b ? b.readInt8(0) : null; }
        case T_UINT16: { const b = reader.bytes(2); return b ? b.readUInt16LE(0) : null; }
        case T_INT16: { const b = reader.bytes(2); return b ? b.readInt16LE(0) : null; }
        case T_UINT32: return reader.u32();
        case T_INT32: { const b = reader.bytes(4); return b ? b.readInt32LE(0) : null; }
        case T_FLOAT32: { const b = reader.bytes(4); return b ? b.readFloatLE(0) : null; }
        case T_BOOL: { const b = reader.bytes(1); return b ? b.readUInt8(0) !== 0 : null; }
        case T_STRING: return reader.string(lenSize);
        case T_UINT64: return reader.u64();
        case T_INT64: { const b = reader.bytes(8); return b ? Number(b.readBigInt64LE(0)) : null; }
        case T_FLOAT64: { const b = reader.bytes(8); return b ? b.readDoubleLE(0) : null; }
        default: throw new Error("Unknown GGUF metadata type " + type);
    }
}

// Read a bounded array of numeric scalars once its element type and count are known. Returns
// null if the file ends early, so the caller can stop scanning.
function readNumericArray(reader, elementType, count, lenSize) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const value = readScalar(reader, elementType, lenSize);
        if (value === null) return null;
        out.push(value);
    }
    return out;
}

// Read a bounded array of strings, mirroring readNumericArray. Only a requested array at or below
// MAX_ARRAY_LENGTH is ever materialised, so a tokenizer/merge table is still skipped rather than
// walked into memory.
function readStringArray(reader, count, lenSize) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const value = reader.string(lenSize);
        if (value === null) return null;
        out.push(value);
    }
    return out;
}

// Skip an array value once its element type and count have been read. Fixed-size element types
// are skipped in one go; string arrays have to be walked, which is exactly why the caller stops
// as soon as its keys are found.
function skipArrayElements(reader, elementType, count, lenSize) {
    const size = SCALAR_SIZE[elementType];
    if (size !== undefined) return reader.skip(size * count);
    if (elementType === T_STRING) {
        for (let i = 0; i < count; i++) {
            if (reader.string(lenSize) === null) return false;
        }
        return true;
    }
    if (elementType === T_ARRAY) throw new Error("Nested GGUF arrays are not supported");
    throw new Error("Unknown GGUF array element type " + elementType);
}

// Read the named metadata keys from a GGUF file. Returns an object holding only the keys that
// were found (possibly empty). `maxBytes` bounds how far into the file it will look.
function readMetadata({ filePath, fs, keys, maxBytes }) {
    const wanted = {};
    for (const key of keys || []) wanted[key] = true;
    const found = {};
    const remaining = Object.keys(wanted).length;
    if (!filePath || remaining === 0) return found;
    let fd = null;
    try {
        fd = fs.openSync(filePath, "r");
        const reader = createReader(fd, fs, maxBytes || DEFAULT_MAX_BYTES);
        const magic = reader.bytes(4);
        if (!magic || magic.toString("ascii") !== GGUF_MAGIC) return found;
        const version = reader.u32();
        if (version === null || version < 1 || version > 3) return found;
        const lenSize = version === 1 ? 4 : 8;
        reader.u64();                       // tensor count
        const kvCount = version === 1 ? reader.u32() : reader.u64();
        if (kvCount === null) return found;
        let seen = 0;
        for (let i = 0; i < kvCount; i++) {
            const key = reader.string(lenSize);
            if (key === null) break;
            const type = reader.u32();
            if (type === null) break;
            if (type === T_ARRAY) {
                const elementType = reader.u32();
                const count = reader.u64();
                if (elementType === null || count === null) break;
                // A requested key that is a small array of numeric scalars or strings (e.g.
                // dflash.target_layers, general.tags) is materialised. Every other array -
                // tokenizer strings, merge lists, oversized arrays - is skipped exactly as
                // before, so only requested, bounded arrays ever cost memory.
                const wantedArray = wanted[key] &&
                    !Object.prototype.hasOwnProperty.call(found, key);
                if (wantedArray && isNumericElementType(elementType) && count <= MAX_ARRAY_LENGTH) {
                    const values = readNumericArray(reader, elementType, count, lenSize);
                    if (values === null) break;
                    found[key] = values;
                    seen++;
                    if (seen >= remaining) break;
                    continue;
                }
                if (wantedArray && elementType === T_STRING && count <= MAX_ARRAY_LENGTH) {
                    const values = readStringArray(reader, count, lenSize);
                    if (values === null) break;
                    found[key] = values;
                    seen++;
                    if (seen >= remaining) break;
                    continue;
                }
                if (!skipArrayElements(reader, elementType, count, lenSize)) break;
                continue;
            }
            const value = readScalar(reader, type, lenSize);
            if (value === null) break;
            if (wanted[key] && !Object.prototype.hasOwnProperty.call(found, key)) {
                found[key] = value;
                seen++;
                if (seen >= remaining) break;
            }
        }
        return found;
    } catch (err) {
        return found;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (err) { /* already closed */ }
        }
    }
}

// Architecture and expert counts for a model file. Returns null when the file is not a
// readable GGUF or does not name an architecture.
function readModelInfo({ filePath, fs }) {
    const meta = readMetadata({
        filePath, fs,
        keys: ["general.architecture", "general.name"]
    });
    const arch = meta["general.architecture"];
    if (!arch) return null;
    // Expert counts are arch-prefixed, so they need a second pass now that the arch is known.
    const expertKeys = [arch + ".expert_count", arch + ".expert_used_count"];
    const experts = readMetadata({ filePath, fs, keys: expertKeys });
    const expertCount = experts[arch + ".expert_count"];
    const expertUsedCount = experts[arch + ".expert_used_count"];
    return {
        arch: arch,
        name: meta["general.name"] || null,
        expertCount: typeof expertCount === "number" ? expertCount : null,
        expertUsedCount: typeof expertUsedCount === "number" ? expertUsedCount : null
    };
}

// The metadata key llama.cpp expects for an expert-count override on this architecture.
function expertUsedCountKey(arch) {
    if (!arch) return null;
    return arch + ".expert_used_count";
}

module.exports = {
    GGUF_MAGIC,
    readMetadata,
    readModelInfo,
    expertUsedCountKey
};
