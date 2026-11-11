#!/usr/bin/env python3
"""
dev/rename-merged-font.py
Rebuilds the 'name' table of the merged Stint Ultra Condensed + Unifont font
(www/core/SEP/StintUltraCondensed-Unifont.ttf).

Why: the font is a Modified Version under the SIL Open Font License, so per OFL
condition 3 it must not present the Reserved Font Name "Stint Ultra Condensed"
as its primary name. The original merge also left the name table corrupted
(record string offsets shifted). This script replaces the whole name table with
clean records under a new family name, rebuilds the sfnt (offsets, table
checksums, head.checkSumAdjustment) and writes the result to a new file.

Pure stdlib; run from the application root:
    python3 dev/rename-merged-font.py <input.ttf> <output.ttf>
"""
import struct
import sys

FAMILY = "SLR Condensed CJK"
SUBFAMILY = "Regular"
FULL = "SLR Condensed CJK"
PS = "SLRCondensedCJK-Regular"
UNIQUE = "SLR: SLR Condensed CJK Regular: 2026"
VERSION = "Version 1.000;SLR-merge"
COPYRIGHT = (
    'Copyright (c) 2011 by Brian J. Bonislawsky DBA Astigmatic (AOETI) '
    '(astigma@astigmatic.com), with Reserved Font Name "Stint Ultra Condensed". '
    "Modified Version: merged with GNU Unifont glyphs for SLR Translator; "
    "internal name changed per the OFL Reserved Font Name terms."
)

# (platformID, encodingID, languageID, nameID) -> string
RECORDS = []
for pid, eid, lid in ((3, 1, 0x0409), (1, 0, 0)):
    for nid, s in ((0, COPYRIGHT), (1, FAMILY), (2, SUBFAMILY), (3, UNIQUE),
                   (4, FULL), (5, VERSION), (6, PS)):
        RECORDS.append((pid, eid, lid, nid, s))


def checksum(data):
    if len(data) % 4:
        data = data + b"\0" * (4 - len(data) % 4)
    return sum(struct.unpack(">%dI" % (len(data) // 4), data)) & 0xFFFFFFFF


def main(src, dst):
    d = open(src, "rb").read()
    sfnt, num = struct.unpack(">IH", d[:6])
    tabs = []
    for i in range(num):
        tag, cs, off, ln = struct.unpack(">4sIII", d[12 + 16 * i:12 + 16 * i + 16])
        tabs.append([tag, d[off:off + ln]])

    # ---- build the new name table ------------------------------------
    n = len(RECORDS)
    header = struct.pack(">HHH", 0, n, 6 + 12 * n)
    recs, storage = b"", b""
    for pid, eid, lid, nid, s in RECORDS:
        enc = s.encode("utf-16-be") if pid == 3 else s.encode("mac-roman")
        recs += struct.pack(">6H", pid, eid, lid, nid, len(enc), len(storage))
        storage += enc
    new_name = header + recs + storage

    for t in tabs:
        if t[0] == b"name":
            t[1] = new_name

    # ---- reassemble the sfnt ------------------------------------------
    es = max(n.bit_length() - 1 for _ in [0])
    es = (num).bit_length() - 1
    sr = 16 * (1 << es)
    rs = num * 16 - sr
    out = bytearray(struct.pack(">IHHHH", sfnt, num, sr, es, rs))

    dir_len = 12 + 16 * num
    offset = dir_len
    dirent = b""
    body = b""
    head_off = None
    for tag, data in tabs:
        dirent += struct.pack(">4sIII", tag, checksum(data), offset, len(data))
        if tag == b"head":
            head_off = offset
        body += data
        pad = (-len(data)) % 4
        body += b"\0" * pad
        offset += len(data) + pad
    out += dirent + body

    # head.checkSumAdjustment
    if head_off is None:
        sys.exit("no head table?!")
    out[head_off + 8:head_off + 12] = b"\0\0\0\0"
    adj = (0xB1B0AFBA - checksum(bytes(out))) & 0xFFFFFFFF
    out[head_off + 8:head_off + 12] = struct.pack(">I", adj)

    open(dst, "wb").write(bytes(out))
    print("wrote", dst, len(out), "bytes; name table", len(new_name), "bytes,", n, "records")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
