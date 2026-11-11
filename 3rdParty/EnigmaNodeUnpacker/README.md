# EnigmaVB Unpacker (Node.js)

A pure Node.js tool for unpacking executables packed with **Enigma Virtual Box**
v4.10 – v10.80.

**Zero external dependencies** — uses only Node.js built-in modules (`fs`, `path`).
Requires Node.js 14+ (uses `BigInt` for 64-bit offsets).

---

## Quick Start

```bash
# Unpack a file — output goes to <filename>_unpacked/
node main.js packed.exe

# Specify output directory
node main.js packed.exe -o /tmp/output

# Skip rebuilding the _unpacked.exe (extract virtual files only)
node main.js packed.exe --no-exe
```

### Usage

```
node main.js <packed.exe> [-o <output_dir>] [--no-exe]

Arguments:
  <packed.exe>        Path to the EnigmaVB-packed executable.

Options:
  -o, --output <dir>  Output directory (default: <input>_unpacked).
  --no-exe            Skip rebuilding the _unpacked.exe stub file.
  -h, --help          Show help.
```

### Output

The output directory contains:

```
output_dir/
├── packed_unpacked.exe       # Original PE with .enigma1/.enigma2 stripped
├── %DEFAULT FOLDER%/         # The embedded virtual file tree
│   ├── Game.exe
│   ├── audio/
│   │   ├── bgm/
│   │   └── se/
│   ├── data/
│   └── ...
└── (other root-level files extracted from .enigma1)
```

The `%DEFAULT FOLDER%` placeholder is preserved from the original EnigmaVB
container — it is the virtual root directory name chosen by the packer.

---

## How It Works

The tool reverses the following steps performed by the original
EnigmaVBUnpacker.exe (a Delphi GUI application):

### 1. PE Parsing & Section Location

Reads the packed PE file and locates the `.enigma1` and `.enigma2` sections
(appended by Enigma Virtual Box). The `.enigma1` section contains the file
table and embedded files; `.enigma2` contains the loader stub.

### 2. EVB Signature Search

Searches the `.enigma1` section header for the `"EVB\0"` signature using a
ladder of candidate offset positions (the exact ladder differs between x86 and
x64 executables and across EnigmaVB versions). The search also determines the
`b4` offset addend, which is computed **inversely** for x86 vs x64:
- **x86**: `b4 = 4` if all flag bytes ≤ 1, else `b4 = 0`
- **x64**: `b4 = 4` if any flag byte > 1, else `b4 = 0`

### 3. Version Detection

A small "loader PE" is aPLib-compressed and stored at the end of the data
area (`.enigma1 + evb_ptr + data_size`). The tool decompresses it and extracts
a version hash:

| Architecture | Hash source |
|---|---|
| **x86** | `TimeDateStamp` field of the loader PE's resource directory (`.rsrc + 4`) |
| **x64** | `SizeOfCode` field of the loader PE's optional header (`pe_off + 0x1C`) |

The hash is looked up in a hardcoded table (64 entries for x86, 52 for x64)
to determine the EnigmaVB version string (e.g. `"8.20"`, `"9.50"`) and an
internal **format code** (1–7).

### 4. File-Table Walking

The file table format depends on the version code:

| Code | EnigmaVB versions | File-table format |
|------|-------------------|-------------------|
| 1 | 4.10 – 4.50 | 32-bit count, simple records, 32-bit stored size |
| 2 | 4.60 – 4.90 | Same as code 1 |
| 3 | 5.00 – 5.80 | Same as code 1 |
| 4 | 6.00 – 6.50 | Simple records, chunked compression |
| 5 | 6.60 – 7.90 | 64-bit count, 64-bit data offsets, chunked compression |
| 6 | 8.00 – 8.20 | Same as code 5 |
| 7 | 9.00 – 10.80 | Recursive node table (`sub_476F1C`-style), chunked compression |

Each record in the file table contains:
- A 4-byte record size
- Two 4-byte fields (purpose unknown — possibly version/timestamp metadata)
- A 4-byte sub-record count (for folders)
- A null-terminated UTF-16LE name string
- A 1-byte type: `1` = drive folder, `2` = file, `3` = folder

For **files** (type 2), additional fields follow:
- 2 flag bytes
- 8-byte uncompressed size
- 3 × 8-byte timestamps (creation, access, write — stored as Delphi TDateTime)
- 4-byte file attributes
- 1 flag byte
- A second null-terminated UTF-16LE string (unused for path — possibly original name)
- 4 or 8-byte stored (compressed) size

For **folders** (types 1, 3): sub-records follow immediately. In code 7,
type-3 folders have additional metadata (1 byte + 3×8 bytes + 4 bytes).

### 5. File Extraction

Depending on the compression flag and version code:

- **Uncompressed** (`compressed_flag = 0`): Raw byte-for-byte copy from the
  data area.
- **Single-block aPLib** (codes 1–3, compressed): Decompress the stored data
  in one shot (the decompressed file must fit in a single Buffer; chunked
  formats used by codes 4–7 have no such limit).
- **Chunked aPLib** (codes 4–7, compressed): The file data is preceded by a
  chunk table (12-byte entries: 8-byte offset + 4-byte size). Each chunk
  decompresses to at most 64 KiB. Chunks are decompressed sequentially and
  written directly to disk — no whole-file buffer, so decompressed files may
  exceed 2 GiB.

### 6. PE Rebuild

The `_unpacked.exe` is produced by:
1. Copying the original PE data
2. Removing the last two sections (`.enigma1` and `.enigma2`)
3. Patching `NumberOfSections` and `SizeOfImage` in the PE header
4. Truncating the file to the end of the new last section

> **Note:** The original EnigmaVBUnpacker performs additional PE header
> patching (TLS callback fixup, exception/debug directory adjustments) that
> this port does not fully replicate. The resulting `_unpacked.exe` is
> usually runnable but may differ slightly from the original tool's output.

---

## File Layout

| File | Purpose |
|------|---------|
| `main.js` | CLI entry point — argument parsing, orchestration, progress display |
| `enigma-vb.js` | Core logic — header parsing, version detection, file-table walker, extractor, PE rebuilder |
| `aplib.js` | aPLib decompressor (port of `sub_47C1D0` from the original binary) |
| `pe-utils.js` | Minimal PE parser — section table read, optional header fields, PE rebuild |
| `version-tables.js` | x86 (64 entries) + x64 (52 entries) hash → version-code lookup tables |
| `package.json` | Package metadata, `bin` entry for `npx`/global install |

---

## Security

The tool includes **path-traversal protection** (matching the original
EnigmaVBUnpacker's `sub_40982C` check). Virtual paths from the archive are
sanitized before writing to disk:

- `..` components are rejected (prevents directory escape)
- Forward-slash `/` traversal is also caught (important on Linux)
- Null bytes in filenames are rejected
- Windows drive-letter prefixes (`C:`) are rejected

Unsafe paths are skipped with a warning, and the original packed file is never
modified.

---

## Verified Compatibility

The tool has been tested against real EnigmaVB-packed executables with
byte-perfect (SHA-256) verification against the original EnigmaVBUnpacker
output:

| Test file | Arch | Version | Code | Files | Match |
|-----------|------|---------|------|-------|-------|
| Game_boxed.exe | x86 | 8.20 | 6 | 1542 | 100% |
| 悪逆無道の徒花よ.exe | x64 | 9.50 | 7 | 1879 | 100% |

Both x86 (PE32) and x64 (PE32+) executables are supported. Files with
Japanese (UTF-16LE) filenames are extracted correctly on all platforms.

---

## Performance

| Test file | Size | Files | Node.js time |
|-----------|------|-------|--------------|
| Game_boxed.exe (x86 8.20) | 385 MB packed → 340 MB unpacked | 1542 | ~0.5s |
| 悪逆無道の徒花よ.exe (x64 9.50) | 961 MB packed → 957 MB unpacked | 1879 | ~1.0s |

The packed exe is **not** loaded into memory: only the PE headers are parsed
up front and all data (file table, embedded files) is read from disk on
demand through a 64 KiB read-ahead window. Extracted files are decompressed
and written chunk-by-chunk. Memory use stays flat (a few MiB) regardless of
exe size, and packed exes **and** embedded files larger than 2 GiB are
supported.

> **History:** versions before 1.1.0 read the whole exe with
> `fs.readFileSync()`, which refuses files larger than 2 GiB
> (`ERR_FS_FILE_TOO_LARGE`) on **every** architecture — 32-bit and 64-bit
> alike — and failed single-shot `fs.writeSync()` calls with
> `ERR_OUT_OF_RANGE` for decompressed files past 2 GiB. If you need to unpack
> files that large, use 1.1.0 or newer.

---

## Programmatic API

The modules can be used programmatically:

```javascript
const { parsePE } = require('./pe-utils.js');
const { parseEnigmaHeader, detectVersion, Unpacker, Stream } = require('./enigma-vb.js');

const pe = parsePE('packed.exe');        // file-backed: only headers are read
try {
  const e1 = pe.findSection('.enigma1');
  const hdr = parseEnigmaHeader(pe, e1);
  const [label, code] = detectVersion(pe, e1, hdr);
  console.log(`EnigmaVB ${label} (code ${code})`);

  const stream = new Stream(pe);        // reads on demand from the file
  const up = new Unpacker(stream, code, e1.rawOffset + hdr.evbPtr, hdr.compressedFlag);
  up.walk();

  for (const file of up.files) {
    console.log(file.path, file.size);
    // up.extractFile(file, outputPath);
  }
} finally {
  pe.close();
}
```

---

## Limitations

- **Registry virtualisation**: EnigmaVB can embed registry entries alongside
  files. The original tool extracts these; this port parses but does not
  write them to disk (they are not files).
- **PE rebuild fidelity**: The `_unpacked.exe` is functional but may not be
  byte-identical to the original tool's output (see note in section 6 above).
- **Large files**: Supported well past 2 GiB — the exe is parsed and read
  file-backed (never buffered whole), and extraction streams to disk. The
  only residual limit is single-block aPLib (codes 1–3, compressed), where
  one member must decompress into a single Buffer.
- **Untested versions**: Only codes 6 (v8.20) and 7 (v9.50) have been tested
  against real data. Codes 1–5 are implemented per the disassembly but have
  no test files available.

## Credits
Made by Shisaye
anime-sharing.com
