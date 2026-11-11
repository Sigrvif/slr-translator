# `www/core/` — THE CORE OF SLR TRANSLATOR

> ## This is the real application. Every folder here is mandatory.
>
> Each subfolder has `"builtin": true` in its `package.json`, which marks it as a
> **mandatory core module**: shipped, always loaded, cannot be disabled or
> removed (enforced in `../js/addon.js` — `loadPackage()` sets
> `isMandatory = true`).
>
> Optional, user-supplied addons go in **`../addons/`** (empty by default), not
> here.

## Why a separate `core/` folder?

This project was forked/merged from several older open-source editors whose
design was "generic editor + optional add-ons". SLR Translator now has a fixed
purpose, so the old "addons" are no longer optional — they **are** the core
(translation engine, RPG Maker parsers, batch, OCR, …). Splitting them into
`www/core/` makes that explicit and frees up `www/addons/` for genuine
third-party extensions.

## Core modules (all `builtin: true`)

| Folder          | package.json `name`   | autoload | What it does                                              | Entry                       |
|-----------------|-----------------------|----------|-----------------------------------------------------------|-----------------------------|
| `SLRtrans/`     | `SLR Engine Wrapper`  | no       | The translation engine.                                   | `lib/Main.js`               |
| `SLRbatch/`     | `SLR Batch and Tag`   | no       | Batch translator + glossary extractor.                    | `transredbatch.js`          |
| `rmmv/`         | `rmmv`                | no       | RPG Maker MV **and** MZ parser.                           | `rmmv.js`                   |
| `rmmz/`         | `rmmz`                | yes      | RPG Maker MZ support.                                     | `rmmz.js`                   |
| `rmrgss/`       | `rmrgss`              | no       | RGSS engines (RM XP / VX / VX Ace).                       | `rmrgss.js`                 |
| `ESParser/`     | `esparser`            | no       | ECMAScript parser for inspecting game JS.                 | `ESParser.js`               |
| `customParser/` | `custom-parser`       | no       | User-defined regex/JS text parsers.                       | `customParser.js`           |
| `SEP/`          | `SEP`                 | no       | OCR image text extraction (PP-OCRv4/ONNX) + redraw.       | `SEP.js`                    |
| `spellchecker/` | `spellchecker`        | yes      | Offline English (en-US) spell checking.                   | `main.js`                   |
| `nightMode/`    | `nightmode`           | yes      | Dark appearance.                                          | `main.js`                   |
| `transRikaikun/`| `transRikaikun`       | no       | Rikaikun-style Japanese dictionary popup on hover.        | `transRikaikun.js`          |

## `package.json` flags (per module)

- `builtin: true` — **core module, mandatory, not removable.** (True for every folder here.)
- `autoload: true` — auto-load every file in the folder.
- `autoload: false` — only the files listed in the `load` array are loaded.
- `main` — logical entry file; `load` — explicit list of files to execute.
- `dependencies` — npm deps installed inside the module's own `node_modules/`.

See `../js/addon.js` (`Addon` / `AddonLoader` / `AddonLoader.getSourceDirs`) for
the loader, `../addons/README.md` for how to write a user addon, and the root
`AGENTS.md` for the full architecture overview.
