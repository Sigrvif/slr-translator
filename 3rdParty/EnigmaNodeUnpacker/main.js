#!/usr/bin/env node
"use strict";

/** Enigma Virtual Box unpacker — Node.js port.
 *
 * Usage:
 *   node main.js <packed.exe> [-o <output_dir>] [--no-exe]
 *
 * Supports Enigma Virtual Box v4.10 – v10.80 (codes 1–7, x86 and x64).
 * Pure Node.js — no external dependencies, works on Linux/macOS/Windows.
 */

const fs = require("fs");
const path = require("path");
const { parsePE } = require("./pe-utils.js");
const {
  parseEnigmaHeader, detectVersion, Unpacker, Stream, rebuildPE,
} = require("./enigma-vb.js");

function parseArgs(argv) {
  const args = { input: null, output: null, noExe: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") { args.output = argv[++i]; }
    else if (a === "--no-exe") { args.noExe = true; }
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node main.js <packed.exe> [-o <output_dir>] [--no-exe]");
      process.exit(0);
    }
    else if (!args.input) { args.input = a; }
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (!args.input) {
    console.error("Usage: node main.js <packed.exe> [-o <output_dir>] [--no-exe]");
    process.exit(1);
  }
  return args;
}

function safeJoin(baseDir, virtualPath) {
  const parts = [];
  for (const raw of virtualPath.replace(/\//g, "\\").split("\\")) {
    if (!raw || raw === ".") continue;
    if (raw === "..") return null;
    if (raw.includes("\0")) return null;
    if (raw.length === 2 && raw[1] === ":") return null;
    parts.push(raw);
  }
  if (!parts.length) return null;
  return path.join(baseDir, ...parts);
}

function main() {
  const args = parseArgs(process.argv);
  const inPath = path.resolve(args.input);
  const inName = path.basename(inPath);
  const outDir = path.resolve(args.output || path.join(path.dirname(inPath), inName + "_unpacked"));

  console.log(`[+] Filename: ${inPath}`);

  const pe = parsePE(inPath);
  try {
    const e1 = pe.findSection(".enigma1");
    const e2 = pe.findSection(".enigma2");
    if (!e1 || !e2) {
      console.error("[x] Missing .enigma1 or .enigma2 section; not an EnigmaVB file.");
      process.exitCode = 1;
      return;
    }

    const arch = pe.isPE32Plus ? "x64" : "x86";
    console.log(`[+] ${arch} executable`);
    console.log(`    .enigma1: 0x${e1.rawSize.toString(16)} bytes at 0x${e1.rawOffset.toString(16)}`);
    console.log(`    .enigma2: 0x${e2.rawSize.toString(16)} bytes at 0x${e2.rawOffset.toString(16)}`);

    const hdr = parseEnigmaHeader(pe, e1);
    const [label, code] = detectVersion(pe, e1, hdr);
    if (!label) {
      console.error("[!] Could not detect EnigmaVB version; aborting.");
      process.exitCode = 1;
      return;
    }
    console.log(`[+] EnigmaVB version: ${label} (code ${code})`);
    console.log(`[+] Embedded files are ${hdr.compressedFlag ? "compressed" : "not compressed"}`);

    const stream = new Stream(pe); // file-backed: works past 2 GiB, flat memory
    const dataBase = e1.rawOffset + hdr.evbPtr;
    const up = new Unpacker(stream, code, dataBase, hdr.compressedFlag);
    up.walk();

    const totalFiles = up.files.length;
    const totalBytes = up.files.reduce((s, f) => s + Number(f.size), 0);
    console.log(`[+] Found ${totalFiles} files (${(totalBytes / (1 << 20)).toFixed(1)} MiB)`);

    fs.mkdirSync(outDir, { recursive: true });
    console.log(`[+] Extracting to: ${outDir}`);

    let ok = 0, failed = 0;
    const start = Date.now();
    for (let i = 0; i < up.files.length; i++) {
      const entry = up.files[i];
      const outPath = safeJoin(outDir, entry.path);
      if (!outPath) {
        console.error(`[x] Refusing unsafe path: ${JSON.stringify(entry.path)}`);
        failed++;
        continue;
      }
      try {
        if (up.extractFile(entry, outPath)) ok++;
        else failed++;
      } catch (ex) {
        console.error(`[x] ${entry.path}: ${ex.message}`);
        failed++;
      }
      if ((i + 1) % 200 === 0 || i + 1 === totalFiles) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const pct = ((100 * (i + 1) / totalFiles)).toFixed(0);
        process.stdout.write(`\r[i] ${i + 1}/${totalFiles} (${pct}%) ${ok} ok, ${failed} failed, ${elapsed}s`);
      }
    }
    console.log();

    if (!args.noExe) {
      const ext = path.extname(inName);
      const stem = path.basename(inName, ext);
      const exeOut = path.join(outDir, stem + "_unpacked" + ext);
      try {
        rebuildPE(pe, e1, e2, exeOut);
        console.log(`[+] Unpacked main file: ${path.basename(exeOut)}`);
      } catch (ex) {
        console.error(`[x] PE rebuild failed: ${ex.message}`);
      }
    }

    console.log(`[+] Finished!  ${ok} files extracted, ${failed} failed.`);
    process.exitCode = failed === 0 ? 0 : 2;
  } finally {
    pe.close();
  }
}

main();
