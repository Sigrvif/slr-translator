#!/usr/bin/env node
/*
 * dev/generate-third-party-notices.js
 *
 * Generates THIRD-PARTY-NOTICES.html — the license/credits list for every
 * component bundled with SLR Translator EXCEPT the NW.js/Chromium runtime,
 * which keeps its own generated credits.html.
 *
 * Run from the application root:  node dev/generate-third-party-notices.js
 *
 * - npm packages      : node_modules/ and www/core/<module>/node_modules (reads each
 *                       package.json + LICENSE file from disk)
 * - composer packages : www/php/composer.lock (+ vendor LICENSE file if present)
 * - everything else   : the curated list below (fonts, dictionaries, models,
 *                       vendored www/modules libraries, 3rdParty tools, runtimes)
 *
 * Entries marked VERIFY need manual attention before public distribution.
 * Regenerate this file after updating any bundled component.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUT = "THIRD-PARTY-NOTICES.html";

/* ------------------------------------------------------------------ utils */

let uid = 0;
const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const exists = (p) => { try { fs.accessSync(path.join(ROOT, p)); return true; } catch (e) { return false; } };
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8").trim() || null; } catch (e) { return null; } };
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch (e) { return null; } };

const LICENSE_FILES = ["LICENSE", "LICENCE", "LICENSE.txt", "LICENCE.txt", "LICENSE.md",
    "LICENCE.md", "LICENSE-MIT", "LICENSE.APACHE", "COPYING", "COPYING.txt", "COPYRIGHT", "NOTICE.md", "NOTICE"];

function findLicenseFile(dirRel) {
    for (const f of LICENSE_FILES) {
        const t = read(path.join(dirRel, f));
        if (t) return t;
    }
    return null;
}

function mit(holder) {
    return "MIT License\n\nCopyright (c) " + holder + "\n\n" +
"Permission is hereby granted, free of charge, to any person obtaining a copy\n" +
"of this software and associated documentation files (the \"Software\"), to deal\n" +
"in the Software without restriction, including without limitation the rights\n" +
"to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n" +
"copies of the Software, and to permit persons to whom the Software is\n" +
"furnished to do so, subject to the following conditions:\n" +
"\n" +
"The above copyright notice and this permission notice shall be included in all\n" +
"copies or substantial portions of the Software.\n" +
"\n" +
"THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n" +
"IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n" +
"FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n" +
"AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n" +
"LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n" +
"OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\n" +
"SOFTWARE.";
}

const ZLIB_TEXT = "Copyright (C) 1995-2017 Jean-loup Gailly and Mark Adler\n" +
"\n" +
"This software is provided 'as-is', without any express or implied\n" +
"warranty.  In no event will the authors be held liable for any damages\n" +
"arising from the use of this software.\n" +
"\n" +
"Permission is granted to anyone to use this software for any purpose,\n" +
"including commercial applications, and to alter it and redistribute it\n" +
"freely, subject to the following restrictions:\n" +
"\n" +
"1. The origin of this software must not be misrepresented; you must not\n" +
"   claim that you wrote the original software. If you use this software\n" +
"   in a product, an acknowledgment in the product documentation would be\n" +
"   appreciated but is not required.\n" +
"2. Altered source versions must be plainly marked as such, and must not be\n" +
"   misrepresented as being the original software.\n" +
"3. This notice may not be removed or altered from any source distribution.";

/* Canonical license texts reused from files already shipped in this package */
const APACHE2 = read("www/modules/jsoneditor/LICENSE");           // full Apache-2.0 text
const GPL3 = read("LICENSE.txt");                                  // the app's own GPLv3 text
const MECAB_GPL = read("3rdParty/MeCab/GPL");
const MECAB_LGPL = read("3rdParty/MeCab/LGPL");
const MECAB_BSD = read("3rdParty/MeCab/BSD");

/* Canonical license texts for bundled packages that ship no license file */
const KNOWN_TEXTS = {
    "json-schema": "json-schema\nCopyright (c) Kris Zyp (SitePen)\nDual licensed under the Academic Free License 2.1 or BSD 3-Clause.\n" +
        "https://spdx.org/licenses/AFL-2.1.html  /  https://spdx.org/licenses/BSD-3-Clause.html\n" +
        "Source: https://github.com/kriszyp/json-schema",
    "markbaker/complex": mit("Mark Baker (https://github.com/MarkBaker/PHPComplex)"),
    "markbaker/matrix": mit("Mark Baker (https://github.com/MarkBaker/PHPMatrix)"),
    "psr/simple-cache": mit("PHP-FIG (https://www.php-fig.org/)"),
};
const knownText = (key) => Object.prototype.hasOwnProperty.call(KNOWN_TEXTS, key) ? KNOWN_TEXTS[key] : undefined;

/* --------------------------------------------------------------- sections */

const sections = [];
const section = (title, note) => { sections.push({ title, note, entries: [] }); };
const entry = (e) => {
    if (e.cond && !e.cond()) return;
    sections[sections.length - 1].entries.push(e);
};

/* 1. Runtime components ------------------------------------------------ */

section("Runtime components",
    "Executed as separate programs alongside SLR Translator (kept at arm's length; see the GPLv3 aggregation rules).");

entry({
    name: "NW.js (Chromium + Node.js)", url: "https://nwjs.io",
    license: "MIT / BSD and others",
    text: "The complete, generated license list of the bundled NW.js / Chromium / Node.js runtime (including\n" +
          "the Windows nw.dll and the Linux lib/ shared libraries) ships as credits.html in this folder.",
});

entry({
    name: "PHP", cond: () => exists("php/license.txt"),
    license: "PHP License 3.01 (upgradable to PHP License 4 / BSD-3-Clause)",
    note: "PHP License 3.01 section 5 allows using this code under any later version; version 4 is BSD-3-Clause and GPL-compatible.\n" +
          "Linux builds additionally ship the licenses of PHP's bundled third-party libraries in php/license/.",
    text: read("php/license.txt"),
});

entry({
    name: "Ruby (Windows: RubyInstaller build of Ruby 2.6; Linux: bundled interpreter)",
    url: "https://www.ruby-lang.org/en/about/license/",
    license: "Ruby License OR BSD-2-Clause; RubyInstaller components (Windows build) BSD-3-Clause",
    text: "The Ruby interpreter is dual-licensed under the Ruby License and the 2-clause BSD License.\n" +
          "Full texts: https://www.ruby-lang.org/en/about/license.txt\n" +
          "RubyInstaller (Windows): https://github.com/rubyinstaller/rubyinstaller (BSD-3-Clause).",
});

entry({
    name: "llama.cpp (llama-server)",
    url: "https://github.com/ggml-org/llama.cpp",
    license: "MIT",
    text: "The bundled local inference runtime is llama.cpp (llama-server), built from the pinned upstream release.\n" +
          "License: MIT.\nFull text: https://github.com/ggml-org/llama.cpp/blob/master/LICENSE\n" +
          "Optional CUDA and ROCm acceleration packs are not bundled and are obtained separately under their vendors' terms.",
});

entry({
    name: "Microsoft Visual C++ Runtime (Windows: vcruntime140, vcruntime140_1, msvcp140)",
    url: "https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist",
    license: "Microsoft Software License Terms (Microsoft Visual C++ Redistributable)",
    // Any shipped payload version: the app-local MSVC DLLs sit at
    // runtime/<build>/win-x64/, and hardcoding a build here has already let the entry
    // silently disappear once (the llama/ -> runtime/ rename).
    cond: () => {
        try {
            return fs.readdirSync(path.join(ROOT, "runtime"))
                .some((d) => exists(path.join("runtime", d, "win-x64", "vcruntime140.dll")));
        } catch (e) { return false; }
    },
    text: "The Windows build ships the x64 Microsoft Visual C++ runtime DLLs beside llama-server.exe\n" +
          "(app-local deployment), so the Visual C++ Redistributable does not need to be installed separately.\n" +
          "License: Microsoft Software License Terms for the Microsoft Visual C++ Redistributable.\n" +
          "Details: https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist",
});

/* 2. Node.js packages --------------------------------------------------- */

section("Node.js packages",
    "Bundled under node_modules/ and www/core/*/node_modules/ (installed versions; license texts read from each package).");

const npmDirs = ["node_modules"];
try {
    for (const c of fs.readdirSync(path.join(ROOT, "www/core"))) {
        if (exists(path.join("www/core", c, "node_modules"))) npmDirs.push(path.join("www/core", c, "node_modules"));
    }
} catch (e) { /* no core */ }

for (const dir of npmDirs) {
    let names;
    try { names = fs.readdirSync(path.join(ROOT, dir)); } catch (e) { continue; }
    for (const n of names) {
        if (n.startsWith(".")) continue;
        if (n.startsWith("@")) {
            let subs = [];
            try { subs = fs.readdirSync(path.join(ROOT, dir, n)); } catch (e) { /* skip */ }
            for (const s of subs) {
                if (!s.startsWith(".")) scanNpm(path.join(dir, n, s));
            }
        } else {
            scanNpm(path.join(dir, n));
        }
    }
}

function scanNpm(pkgDir) {
    const pj = readJSON(path.join(pkgDir, "package.json"));
    if (!pj || !pj.name) return;
    const lic = Array.isArray(pj.license) ? pj.license.join(" OR ") : pj.license;
    const url = pj.homepage || (pj.repository && typeof pj.repository === "object" && pj.repository.url || "").replace(/^git\+/, "");
    const text = findLicenseFile(pkgDir) || knownText(pj.name);
    entry({
        name: pj.name + (pj.version ? " " + pj.version : ""),
        url: url || undefined,
        license: lic || (text ? "see license text" : "VERIFY: no license field or file found"),
        text: text || ("No license file shipped with this package — verify before distribution: https://www.npmjs.com/package/" + pj.name),
        verify: !lic && !text,
    });
}

/* 3. PHP (Composer) packages ------------------------------------------- */

section("PHP packages (Composer)",
    "Bundled under www/php/vendor/; versions and license identifiers from www/php/composer.lock.");

const lock = readJSON("www/php/composer.lock");
if (lock) {
    for (const p of (lock.packages || []).concat(lock.packages_dev || [])) {
        const lic = (p.license || []).join(" OR ") || "VERIFY: no license identifier";
        const vdir = path.join("www/php/vendor", p.name);
        const text = findLicenseFile(vdir) || knownText(p.name);
        entry({
            name: p.name + " " + p.version,
            url: p.homepage || (p.source && p.source.url) || undefined,
            license: lic,
            text: text || ("Composer package (" + lic + "). Full text: https://spdx.org/licenses/index.html\n" +
                "Package source: " + ((p.source && p.source.url) || "https://packagist.org/packages/" + p.name)),
            verify: !text,
        });
    }
}

/* 4. Vendored web libraries (www/modules) ------------------------------ */

section("Vendored web libraries (www/modules)",
    "Copied directly into www/modules/ rather than installed through npm; licenses listed here.");

entry({ name: "Ace editor", url: "https://github.com/ajaxorg/ace", license: "BSD-3-Clause (c) Ajax.org B.V.", text: read("www/modules/ace/LICENSE") });
entry({ name: "Bootstrap", url: "https://getbootstrap.com", license: "MIT", text: mit("2011-2023 Twitter, Inc. / Bootstrap authors") });
entry({ name: "form.io form builder bundle (formio.full.min.js)", url: "https://github.com/formio/formio.js",
    license: "MIT and third-party subcomponents — see bundled license text",
    note: "The extracted webpack license file lists all embedded subcomponents (signature_pad, json-patch, choices.js, DOMPurify, etc.).",
    text: read("www/modules/formio/formio.full.min.js.LICENSE.txt") });
entry({ name: "Handsontable 6.2.2", url: "https://github.com/handsontable/handsontable",
    license: "MIT", note: "Locally modified (see www/modules/handsontable/changed.txt). 6.2.2 is the last MIT-licensed major version line.",
    text: mit("2012-2014 Marcin Warpechowski; 2015-2018 Handsoncode sp. z o.o.") });
entry({ name: "hash.js (Blixt hash handler)", url: "http://blixt.org/js", license: "MIT", text: mit("2009 Andreas Blixt <andreas@blixt.org>") });
entry({ name: "jQuery (1.10.2 / 1.11.0 / 1.12.3 / 1.12.4)", url: "https://jquery.org/license/", license: "MIT", text: mit("jQuery Foundation and other contributors") });
entry({ name: "jquery.mask", url: "https://github.com/igorescobar/jQuery-Mask-Plugin", license: "MIT", text: mit("Igor Escobar") });
entry({ name: "jquery.json (jQuery JSON plugin v2.5.1)", url: "https://github.com/Krinkle/jquery-json",
    license: "MIT", text: mit("2009-2011 Brantley Harris; 2010-2016 Timo Tijhof") });
entry({ name: "jQuery contextMenu 2.8.0", url: "https://github.com/swisnl/jQuery-contextMenu", license: "MIT", text: mit("2011-2019 SWIS BV and contributors") });
entry({ name: "jQuery UI (1.11.2 / 1.11.4.custom)", url: "https://jquery.org/license/", license: "MIT", text: mit("jQuery Foundation and other contributors") });
entry({ name: "jQuery UI Timepicker Addon", url: "https://github.com/trentrichardson/jQuery-Timepicker-Addon", license: "MIT", text: mit("Trent Richardson") });
entry({ name: "jquery.ui-contextmenu", license: "MIT (c) its author", text: "jquery.ui-contextmenu plugin, MIT licensed by its author." });
entry({ name: "jquery-visible", url: "https://github.com/customd/jquery-visible",
    license: "MIT", text: mit("2012 Digital Fusion (teamdf.com)") });
entry({ name: "json2.js", license: "Public Domain", text: (read("www/modules/json2.js") || "").split("*/")[0].replace(/^\/\*/, "").trim() + "\n\n(No rights reserved. See the file header of www/modules/json2.js.)" });
entry({ name: "JSON Editor (jsoneditor)", url: "https://github.com/josdejong/jsoneditor", license: "Apache-2.0 (c) Jos de Jong", text: read("www/modules/jsoneditor/LICENSE") || APACHE2 });
entry({ name: "JSONForm (and bundled deps: underscore, spectrum, jsv, bootstrap-wysihtml5, jquery.transloadit)",
    url: "https://github.com/jsonform/jsonform", license: "MIT",
    note: "The bundled dependency copies under www/modules/jsonform/deps/ are MIT licensed by their respective authors.",
    text: mit("Joshfire SAS and other contributors") });
entry({ name: "List.js", url: "https://listjs.com", license: "MIT", text: mit("Jonny Stromberg (javve)") });
entry({ name: "LZ-String", url: "https://github.com/pieroxy/lz-string", license: "MIT", text: mit("pieroxy") });
entry({ name: "Prism", url: "https://prismjs.com", license: "MIT", text: mit("Lea Verou") });
entry({ name: "Tagify", url: "https://github.com/yairEO/tagify", license: "MIT", text: mit("Yair Even Or") });
entry({ name: "thruallform.js", license: "Public snippet",
    text: "Small form-clearing helper snippet; no attribution claimed by its author." });

/* 5. Fonts --------------------------------------------------------------- */

section("Fonts");

entry({ name: "VL PGothic (www/fonts/VL-PGothic-Regular.ttf)", url: "https://github.com/daisukesuzuki/VLGothic",
    license: "BSD-3-Clause (c) Wada Laboratory Univ. of Tokyo, /efont/, M+ FONTS PROJECT, Daisuke Suzuki, Project Vine",
    note: "The complete BSD license text ships as www/fonts/VL-PGothic-LICENSE.txt.",
    text: read("www/fonts/VL-PGothic-LICENSE.txt") });
entry({ name: "M+ 1m (www/fonts/mplus-1m-regular.ttf, mplus-1m-regular-extra.ttf)",
    url: "https://mplusfonts.github.io/",
    license: "M+ FONT LICENSE (2014 generation; permissive, public-domain-style)",
    note: "Copyright (c) 2014 M+ FONTS PROJECT. The license text ships as www/fonts/MPLUS-FONT-LICENSE.txt.",
    text: read("www/fonts/MPLUS-FONT-LICENSE.txt") });
entry({ name: "Fontello icon fonts (www/fonts/fontello.ttf/.eot/.svg, appbar.ttf, toolbar.ttf)",
    url: "https://fontello.com", license: "SIL Open Font License 1.1 (fontello builds); icon sets (c) their respective authors",
    note: "Custom fontello builds. The embedded icon sets and their authors are identified in www/fonts/LICENSE.txt\n" +
          "(Iconic, Font Awesome, Typicons, Elusive, Entypo, Modern Pictograms, Web Symbols, Fontelico, MFG Labs —\n" +
          "declared SIL OFL by the fontello metadata). The OFL text ships as fonts/OFL.txt.",
    text: (read("www/fonts/LICENSE.txt") || "") + "\n\n--- SIL Open Font License 1.1 ---\n" + (read("fonts/OFL.txt") || "") });
entry({ name: "Stint Ultra Condensed, renamed copy (fonts/sucr.ttf; byte-identical to StintUltraCondensed-Regular.ttf)",
    url: "https://fonts.google.com/specimen/Stint+Ultra+Condensed",
    license: "SIL Open Font License 1.1 (c) 2011 Brian J. Bonislawsky DBA Astigmatic (AOETI)",
    note: "Unmodified copy of Stint Ultra Condensed Regular, shipped under a shortened file name for convenience.\n" +
          "The license text ships as fonts/OFL.txt.",
    text: read("fonts/OFL.txt") });
entry({ name: "SLR Condensed CJK, formerly StintUltraCondensed-Unifont (www/core/SEP/SLRCondensedCJK-Regular.ttf)",
    url: "https://fonts.google.com/specimen/Stint+Ultra+Condensed",
    license: "SIL Open Font License 1.1 (Stint Ultra Condensed) + GNU Unifont licenses (glyphs)",
    note: "Modified Version under the OFL: Unifont glyphs merged into Stint Ultra Condensed for CJK coverage.\n" +
          "\"Stint Ultra Condensed\" is a Reserved Font Name, so per OFL condition 3 the merged font's internal\n" +
          "name (and file name) were changed to \"SLR Condensed CJK\"; the original copyright notice is kept in the\n" +
          "font's name table and in \"SLRCondensedCJK-Regular NOTICE.txt\" / \"STINT OFL.txt\" in the SEP folder.\n" +
          "The license text also ships as fonts/OFL.txt.",
    text: (read("fonts/OFL.txt") || "") + "\n\n--- Unifont ---\n" +
          "Unifont glyphs: Copyright (c) Unifont contributors (Paul Hardy et al.) — GNU GPLv2+ with the font-embedding\n" +
          "exception; newer Unifont releases are additionally available under BSD-2-Clause.\n" +
          "See https://unifoundry.com/unifont/index.html" });

/* 6. Dictionaries and language data ------------------------------------- */

section("Dictionaries and language data");

entry({ name: "English (US) hunspell dictionary (www/core/spellchecker/dictionaries/en-US.aff, en-US.dic)",
    url: "http://wordlist.sourceforge.net",
    license: "SCOWL/wordlist permissive license (c) 2000-2018 Kevin Atkinson; Ispell BSD (c) 1993 Geoff Kuenning; + public-domain components (see bundled text)",
    note: "SCOWL 2020.12.07 en_US build (size 60), the same dictionary distributed by the LibreOffice dictionaries\n" +
          "project. Not part of the hunspell engine repository: hunspell's GPL/LGPL/MPL tri-license covers only the\n" +
          "C++ engine, which is not bundled here (the spell-checking engine used is nspell, MIT, listed above).\n" +
          "The complete copyright, sources and credits text ships as README_en_US.txt next to the dictionary files.",
    text: read("www/core/spellchecker/dictionaries/README_en_US.txt") });
entry({ name: "MeCab + IPADIC (3rdParty/MeCab, including dic/ipadic)",
    url: "https://taku910.github.io/mecab/",
    license: "GPL-2.0 / LGPL-2.1 / BSD triple license (choose one)",
    note: "IPADIC is distributed under the same licensing terms as MeCab.",
    text: [MECAB_GPL && "--- GPL ---\n" + MECAB_GPL, MECAB_LGPL && "--- LGPL ---\n" + MECAB_LGPL, MECAB_BSD && "--- BSD ---\n" + MECAB_BSD].filter(Boolean).join("\n\n") ||
          "See the GPL, LGPL and BSD files shipped in 3rdParty/MeCab/." });
entry({ name: "rikaikun (www/core/transRikaikun — heavily modified)",
    url: "https://github.com/melinkc/rikaikun",
    license: "GPL-3.0 (c) rikaikun contributors",
    note: "Integrated into SLR Translator (GPLv3) with extensive modifications.",
    text: GPL3 });
entry({ name: "EDRDG dictionary data (transRikaikun data/dict.dat, kanji.dat, names.dat, radicals.dat)",
    url: "https://www.edrdg.org/",
    license: "Creative Commons Attribution-ShareAlike (c) EDRDG",
    text: "These dictionary files are derived from the JMdict, KANJIDIC2, ENAMDICT and RADKFILE\n" +
          "files of the Electronic Dictionary Research and Development Group.\n\n" +
          "Required attribution: \"This product uses data from the Electronic Dictionary Research\n" +
          "and Development Group.\" (https://www.edrdg.org/)\n\n" +
          "License: https://www.edrdg.org/edrdg/licence.html" });

/* 7. OCR / neural network models ---------------------------------------- */

section("OCR / neural network models (www/core/SEP/models)");

entry({ name: "PP-OCR detection & recognition models (PP-OCRv6_medium_det.onnx, PP-OCRv6_medium_rec.onnx, ppocrv6_dict.txt)",
    url: "https://github.com/PaddlePaddle/PaddleOCR",
    license: "Apache-2.0 (c) PaddlePaddle Authors", text: APACHE2 });
entry({ name: "LaMa inpainting model (lama_fp32.onnx)",
    url: "https://github.com/advimman/lama",
    license: "Apache-2.0 (c) Samsung Research", text: APACHE2 });
entry({ name: "AOT inpainting model (aot_inpainting.onnx)",
    url: "https://github.com/zyddnys/manga-image-translator",
    license: "GPL-3.0 (upstream project); format conversions tagged MIT by their publishers",
    note: "Provenance chain: the AOT inpainting generator comes from zyddnys/manga-image-translator (GPL-3.0),\n" +
          "was converted to safetensors by mayocream (model card tagged MIT, noting upstream terms govern),\n" +
          "and converted to ONNX by ogkalu (tagged MIT). The converters' MIT tags cover their conversion\n" +
          "artifacts only; the upstream model terms remain GPL-3.0, which matches this application's license,\n" +
          "so the model is distributed here under GPLv3.",
    text: GPL3 });

/* 8. Helper tools (3rdParty) --------------------------------------------- */

section("Helper tools (3rdParty)",
    "Bundled for user convenience and executed as separate tools; they keep their own licenses.");

entry({ name: "EnigmaNodeUnpacker", url: "https://github.com/", license: "MIT (c) 2026 Shisaye",
    text: read("3rdParty/EnigmaNodeUnpacker/LICENSE") });
entry({ name: "RPGMakerDecrypter CLI (RgssDecrypter/RPGMakerDecrypter-cli)", license: "MIT (c) 2016 Reisen Usagi",
    text: read("3rdParty/RgssDecrypter/LICENSE") });
entry({ name: "TES-Patcher (modified; vendored openrgss library)", url: "https://github.com/Sinflower/TES-Patcher",
    license: "MIT (c) 2017 Sinflower (TES-Patcher); openrgss: MIT lineage (c) 2013 Howard Jeng et al.",
    note: "The openrgss RGSS runtime classes under 3rdParty/TES-Patcher/openrgss/ are not part of upstream TES-Patcher.\n" +
          "They originate from the openrgss project by Howard Jeng, Andrew Kesterson and Solistra — the same authors and\n" +
          "MIT license ((c) 2013 Howard Jeng) as the RGSS library bundled inside the rvpacker gem (see ruby/.../rvpacker-*/LICENSE\n" +
          "on Linux builds; the standalone openrgss repository is offline). Attribution text below reproduces that MIT notice.",
    text: read("3rdParty/TES-Patcher/LICENSE") + "\n\n--- openrgss (per rvpacker gem lineage) ---\n" +
          mit("2013 Howard Jeng, Andrew Kesterson, Solistra (openrgss)") });
entry({ cond: () => exists("3rdParty/GnuWin32/bin/file.exe"),
    name: "GnuWin32 file.exe + magic1.dll (3rdParty/GnuWin32)",
    url: "https://gnuwin32.sourceforge.net/packages/file.htm",
    license: "BSD-style (c) Ian F. Darwin, Christos Zoulas and contributors",
    text: "The file(1) utility, (c) Ian F. Darwin, Christos Zoulas and contributors, BSD-style license.\n" +
          "Full text: https://dtrt.org/code/file/LICENSE  /  the GnuWin32 package manifest." });
entry({ cond: () => exists("3rdParty/GnuWin32/bin/regex2.dll"),
    name: "GNU regex (GnuWin32 regex2.dll)", url: "https://www.gnu.org/software/regex/",
    license: "LGPL-2.1-or-later (c) Free Software Foundation",
    text: "GNU regex library, (c) Free Software Foundation, LGPL-2.1-or-later.\n" +
          "Full text: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html" });
entry({ cond: () => exists("3rdParty/GnuWin32/bin/zlib1.dll"),
    name: "zlib (GnuWin32 zlib1.dll)", url: "https://zlib.net/", license: "zlib (c) Jean-loup Gailly and Mark Adler",
    text: ZLIB_TEXT });

/* 9. Collaborator source archives (vendor-source/) ----------------------- */

section("Collaborator source archives (vendor-source/)",
    "Pristine source archives from the project's early collaborative development (2022), preserved for provenance.\n" +
    "They are reference material, not runtime assets - nothing in the application loads them.");

entry({ cond: () => exists("vendor-source/transRedBatch-0.13.zip"),
    name: "transRedBatch 0.13 (vendor-source/transRedBatch-0.13.zip)",
    license: "GPL-3.0 (c) Reddo",
    note: "Original collaborator source (Reddo, 2022). Parts of today's batch translation code in\n" +
          "www/core/SLRbatch derive from it.",
    text: GPL3 });

entry({ cond: () => exists("vendor-source/transRedSugoi-1.4.zip"),
    name: "transRedSugoi 1.4 (vendor-source/transRedSugoi-1.4.zip)",
    license: "GPL-3.0 (c) Reddo",
    note: "Original collaborator source (Reddo, 2022). Parts of today's engine wrappers in\n" +
          "www/core/SLRtrans/lib/TranslationEngine derive from it; Reddo's option ordering is still\n" +
          "quoted in TranslationEngineWrapper.js.",
    text: GPL3 });

entry({ cond: () => exists("vendor-source/mtl-text-processor-main.zip"),
    name: "mtl-text-processor 0.7.0 - pristine upstream snapshot (vendor-source/mtl-text-processor-main.zip)",
    url: "https://www.npmjs.com/package/mtl-text-processor",
    license: "GPL-3.0 (c) reddo9999",
    note: "Pristine GitHub main-branch snapshot (2022) of the mtl-text-processor package. The copy under\n" +
          "www/core/SLRtrans/node_modules/ (also listed above in the Node.js packages section) has been\n" +
          "directly edited since and no longer matches this archive.",
    text: GPL3 });

/* ---------------------------------------------------------------- render */

function renderEntry(e) {
    const id = "n" + (++uid);
    let html = '<div class="product' + (e.verify ? ' verify' : '') + '">\n';
    html += '<span class="title">' + esc(e.name) + '</span>\n';
    if (e.url) html += '<span class="homepage"><a href="' + esc(e.url) + '">homepage</a></span>\n';
    html += '<input type="checkbox" hidden id="' + id + '">\n';
    html += '<label class="show" for="' + id + '" tabindex="0"></label>\n';
    html += '<div class="licence">\n';
    if (e.license) html += '<h3>' + esc(e.license) + '</h3>\n';
    if (e.note) html += '<p class="note">' + esc(e.note).replace(/\n/g, "<br>") + '</p>\n';
    if (e.text) html += '<pre>' + esc(e.text) + '</pre>\n';
    html += '</div>\n</div>\n\n';
    return html;
}

let body = "";
for (const s of sections) {
    if (!s.entries.length) continue;
    body += '<h2 class="sectionTitle">' + esc(s.title) + '</h2>\n';
    if (s.note) body += '<p class="sectionNote">' + esc(s.note) + '</p>\n';
    for (const e of s.entries) body += renderEntry(e);
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>SLR Translator - Third Party Notices</title>
<style>
body { font-family: sans-serif; font-size: 84%; max-width: 1020px; margin: 2em auto; color: #222; }
.page-title { font-size: 164%; font-weight: bold; }
.sectionTitle { font-size: 125%; margin-top: 2em; border-bottom: 1px solid #ccc; }
.sectionNote { color: #555; }
.product { background: #eef4fe; border-radius: 5px; margin-top: 12px; overflow: auto; padding: 2px; }
.product.verify { background: #fdeeee; }
.product .title { float: left; font-size: 110%; font-weight: bold; margin: 3px; }
.product .homepage { float: right; margin: 3px; text-align: right; }
.product .homepage::before { content: " - "; }
.product .show { float: right; margin: 3px; text-decoration: underline; cursor: pointer; }
.licence { border-radius: 3px; clear: both; padding: 16px; }
.licence h3 { margin-top: 0; }
.licence pre { white-space: pre-wrap; }
input + label + div { display: none; }
input + label::after { content: "show license"; }
input:checked + label + div { display: block; }
input:checked + label::after { content: "hide license"; }
.intro { margin: 1em 0 2em 0; }
</style>
</head>
<body>
<span class="page-title">SLR Translator &mdash; Third Party Notices</span>
<p class="intro">SLR Translator is licensed under the GNU General Public License, version 3
(see LICENSE.txt). This file lists every other component bundled with the application, together
with its license. The bundled NW.js/Chromium runtime keeps its own generated list in
credits.html. Entries marked in red require manual verification before public distribution.
This file is generated by dev/generate-third-party-notices.js &mdash; do not edit by hand.</p>
${body}
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, OUT), html);

let total = 0, verify = 0;
for (const s of sections) { total += s.entries.length; verify += s.entries.filter((e) => e.verify).length; }
console.log(OUT + ": " + sections.length + " sections, " + total + " entries (" + verify + " marked VERIFY).");
