# AGENTS.md — Guide for AI coding assistants (and humans)

> ## ⚠ READ THIS FIRST — DO NOT SKIP
>
> The actual functionality of SLR Translator does **NOT** live in `www/js/`.
> It lives in **`www/core/`**.
>
> `www/core/` holds the **mandatory built-in core modules** (translation engine,
> RPG Maker parsers, batch, OCR, …). Each one has `"builtin": true` in its
> `package.json`: shipped, always loaded, cannot be removed.
>
> `www/js/`, by contrast, contains the **base editor + base/stub classes with
> empty hook points**. When you see a stub or an empty-looking handler in
> `www/js/`, the real implementation almost always lives in a file under
> `www/core/`. Do **not** assume a feature is "missing" or "unimplemented" just
> because `www/js/` only shows a stub.
>
> `www/addons/` is a **separate, empty-by-default folder for user-supplied
> addons** — NOT where the core lives.

## TL;DR rules

- Looking for translation / parsing / engine / batch / OCR logic? **Start in `www/core/`, not `www/js/`.**
- `www/core/<name>/package.json` is the source of truth for each module (entry point, flags, dependencies).
- Two source folders are scanned at startup (see `AddonLoader.getSourceDirs` in `www/js/addon.js`):
  1. `www/core/`  — mandatory built-ins, loaded **first** (`localConfig.core`).
  2. `www/addons/` — optional user addons, loaded second (`localConfig.addons`); empty by default.
- `"builtin": true`  → core module, mandatory, not removable (enforced in `www/js/addon.js` → `Addon.prototype.isBuiltin` / `loadPackage` sets `isMandatory`).
- `"autoload": true` → its files are auto-loaded from the folder; `false` → only files listed in the `"load"` array are loaded.
- A handler in `www/js/` that looks empty (`onLoadTrans`, `exportHandler`, …) is a **hook** that a core module implements. Find the implementation in `www/core/`.
- **A detailed built-in user documentation exists in `www/docs/`.** Any user-visible change (feature, UI, setting, engine, error code, …) **must also update the docs** — in **both** the Windows and Linux copies. See ["Built-in documentation"](#built-in-documentation-wwwdocs--always-update-it) below.

## Repository layout

```
SLR Translator Linux/
├─ AGENTS.md                ← you are here (AI guidance)
├─ package.json             ← app manifest; localConfig.core = "www/core", localConfig.addons = "www/addons"
├─ main.js                  ← nw.js (NW.js) bootstrap / window host; installAddon() extracts zips into www/addons
└─ www/
   ├─ js/                   ← LAYER 1: base editor + base/stub classes + shared infra
   │  ├─ addon.js           ←   Addon / AddonLoader (scans www/core THEN www/addons; see getSourceDirs)
   │  ├─ Engines.js         ←   base Engine class + EMPTY handler hooks (filled by core modules)
   │  ├─ trans.js           ←   bootstrap that loads/evals trans-full.js (real Trans logic)
   │  ├─ trans-full.js      ←   Trans table core (translation grid/session logic)
   │  ├─ TranslatorEngine.js←   translation engine base
   │  ├─ common.js, sys.js, ui.js, …  ← base editor infrastructure (real, shared)
   │  └─ README.md          ← READ IT — explains the stub/base nature of this folder
   │
   ├─ core/                 ← LAYER 2: THE REAL APP — mandatory built-in modules (all builtin: true)
   │  ├─ README.md          ← READ IT — what each core module is
   │  ├─ SLRtrans/          ←   translation engine wrapper
   │  ├─ SLRbatch/          ←   batch translator + glossary extractor
   │  ├─ rmmv/              ←   RPG Maker MV & MZ parser
   │  ├─ rmmz/              ←   RPG Maker MZ support
   │  ├─ rmrgss/            ←   RGSS engines (RM XP / VX / VX Ace)
   │  ├─ ESParser/          ←   ECMAScript parser
   │  ├─ customParser/      ←   regex/JS custom text parser
   │  ├─ SEP/               ←   OCR-based image text extraction (PNG/JPG)
   │  ├─ spellchecker/      ←   offline spell checking
   │  ├─ nightMode/         ←   dark UI
   │  └─ transRikaikun/     ←   Japanese dictionary popup on hover
   │
   ├─ addons/               ← LAYER 3: optional USER addons (EMPTY by default)
   │  └─ README.md          ← how to drop in your own addon
   │
   ├─ docs/                 ← BUILT-IN USER DOCUMENTATION (opened via the Help menu)
   │  ├─ manifest.js        ←   sections, page order, sidebar, search keywords
   │  ├─ pages/*.html       ←   one page per topic (engines, editor, batch, OCR, …)
   │  ├─ index.html, docs.js, docs.css  ← offline docs viewer
   │  └─ img/               ←   screenshots used by the pages
   │
   ├─ modules/, lib/, helper/, engine/   ← shared utilities
   ├─ php/, rb/             ← server-side helpers (PHP / Ruby)
   └─ *.html                ← UI windows (index.html is the main window)
```

## Core modules in `www/core/` (all `builtin: true`)

| Folder        | package.json `name`     | What it really is                                              |
|---------------|-------------------------|----------------------------------------------------------------|
| `SLRtrans/`   | `SLR Engine Wrapper`    | The translation engine (`lib/Main.js`).                        |
| `SLRbatch/`   | `SLR Batch and Tag`     | Batch translator + glossary extractor.                         |
| `rmmv/`       | `rmmv`                  | RPG Maker MV **and** MZ parser.                                |
| `rmmz/`       | `rmmz`                  | RPG Maker MZ support.                                          |
| `rmrgss/`     | `rmrgss`                | RGSS-based engines (RM XP, VX, VX Ace).                        |
| `ESParser/`   | `esparser`              | ECMAScript parser used to inspect game JS.                     |
| `customParser/`| `custom-parser`        | User-defined regex/JS text parsers.                            |
| `SEP/`        | `SEP`                   | OCR image text extraction (PP-OCRv6 / ONNX) + redraw on export.|
| `spellchecker/`| `spellchecker`        | Offline English (en-US) spell checking.                        |
| `nightMode/`  | `nightmode`             | Dark appearance.                                               |
| `transRikaikun/`| `transRikaikun`       | Rikaikun-style Japanese dictionary popup.                      |
| `docsChat/`   | `docsChat`             | "Ask DSLR" chat — talks to the DSLR endpoint with tool access to `www/docs`. |

## How modules are loaded

- `www/js/addon.js` defines `Addon` and `AddonLoader`. On startup (`$(document).ready`), `addonLoader.loadAll()` scans every subfolder of **both** `www/core/` and `www/addons/` (core first) and loads each one that has a `package.json`.
- Each `Addon` remembers the base directory it came from (`this.basePath`), so core modules resolve paths under `www/core/` and user addons under `www/addons/`.
- For each module, `package.json` controls behavior:
  - `main` — logical entry file.
  - `load` — explicit array of files to load (when `autoload` is false).
  - `autoload: true` — auto-load every file in the folder.
  - `builtin: true` — marks a CORE module: `loadPackage()` sets `config.isMandatory = true`, so it cannot be removed (see `Addon.prototype.isBuiltin`). **Only set this for shipped core modules.**
- Scripts run inside an `Addon` instance (`this` = the module), so they extend/override the base classes defined in `www/js/` (e.g. registering an `Engine` and filling its `exportHandler` hook).
- Collisions: if a user addon folder name matches a core module name, the core one wins (loaded first).

## Game-engine addons (JS-only engines)

A user addon can add a complete new game engine in pure JavaScript — no PHP,
no core changes. The dispatch lives in the base editor:

- `Engines.registerDetector(fn)` (`www/js/Engines.js`) — detection for the New Project dialog.
- `Trans.prototype.createProject` (`www/js/trans-full.js`) — if the detected engine has a `createProject` handler, `Trans.prototype.createProjectFromEngine` builds the project from the handler's returned project object (applied via `openFromTransObj`); otherwise the legacy PHP backend runs (the “RPG Maker XP, VX, VXAce, MV or MZ” legacy-parser slide; the current SLR parser slide and custom parser are pure JS, +Ruby for RGSS binaries).
- `engines.addHandler(<name>, "exportHandler", fn)` — the engine writes translations back itself and returns `true` to halt the PHP default export.
- `common.initStaging()` (`www/js/common.js`) — creates the staging cache (`{cacheID, cachePath}` with a `data/` subfolder and `gameInfo.json` marker).
- Reference implementation + user-facing contract: `www/core/customParser/` and `www/docs/pages/addons.html` (#adding-a-game-engine).
- `ui.startProject` (`www/js/ui.js`) resolves the engine first and bypasses the PHP existence check for JS-handled engines.

## Addon documentation pages

A user addon can ship pages in the offline docs via the optional `package.json`
`"docs"` field (`"docs.html"` or an array of `{file, title?, keywords?}`). Both
docs consumers read the same collector, `www/js/addonDocs.js`
(`collectAddonDocSections(addonsDir)`):

- The docs viewer (`www/docs/index.html`) loads it as a classic script and
  appends the collected "Addons" section to `window.DOCS_MANIFEST` before
  `docs.js` builds the sidebar. It locates `www/addons` through the main app's
  `www/...` module alias (mixed context) or `nw.App.startPath` — the docs window
  runs on a `chrome-extension://` origin, NOT `file://`, so URL-to-path
  conversion does not work there.
- "Ask DSLR" (`www/core/docsChat/lib/DocIndex.js`, `addonsRoot` option) appends
  the same pages to the chat index; a missing addon page degrades to an
  unreadable entry instead of rejecting the index.
- Page ids are `addon-<folder>` (+ `-2`, `-3`, …); file paths are returned
  docs-relative (`../addons/<folder>/<file>`). Unit tests:
  `www/js/tests/addonDocs.test.js`, DocIndex tests in
  `www/core/docsChat/tests/DocIndex.test.js`.

## Built-in documentation (`www/docs/`) — ALWAYS update it

SLR Translator ships a **detailed built-in user documentation**. It is hand-written
(not auto-generated), opened from inside the app (Help menu → `docsHelp.open()` in
`www/js/docsHelp.js`, incl. deep links like `#batch`), and rendered by the offline
viewer `www/docs/index.html` + `docs.js`. This is the documentation users actually
read — treat it as part of the product, not an afterthought.

Structure:

- `www/docs/manifest.js` — single source of truth for sections, page order, sidebar
  navigation and search keywords. **Adding/removing/renaming a page requires an
  entry here** (placed in the correct section).
- `www/docs/pages/*.html` — one page per topic (engines, editor features, batch
  translation, OCR, addons, settings, error codes, FAQ, …).
- `www/docs/img/` — screenshots/diagrams referenced by the pages.

**Mandatory rule:** whenever you add, change, or remove user-visible behavior —
UI, settings, engines, parsers, batch/OCR/glossary features, shortcuts, error
codes, file formats — you **must update the matching docs page(s) in the same
change**, not "later". If no matching page exists, create one and register it in
`manifest.js`.

Like all shared source, documentation edits must be applied to **both** on-disk
copies: `SLR Translator` (Windows) **and** `SLR Translator Linux` (Linux).

## Development environment notes (dev pod / headless)

- The app **never uses system interpreters**: PHP is `php/bin/php`, Ruby is `ruby/bin/ruby`, the local-LLM engine is `runtime/` (llama.cpp). On Linux, launch via `SLR Translator.sh` — it sets `LD_LIBRARY_PATH`/`PHPRC` and runs from the app directory so relative paths resolve.
- **7z is bundled**: archive / addon / backend-pack extraction uses `7zip-min` (→ `7zip-bin`'s `7za` inside `node_modules`). A missing system `p7zip` is expected — do not install one or treat it as a gap. (Linux `.tar.gz` payloads are extracted with system `tar` instead: 7za 16.02 turns tar symlinks into stub files.)
- **Runtime updates**: `node dev/update-llama-runtime.js` performs the whole llama.cpp refresh — resolves the newest stable `vX.Y.Z` release to its `bNNNNN` build, cuts the base payloads into BOTH app copies, builds the optional CUDA/ROCm pack archives into `../Optional Runtime Packs`, bumps the `RUNTIME_VERSION` pins, verifies the result (manifest hashes, `ModelArgs` flag drift against the new binaries, `--list-devices` format) and prunes the previous payload. `--tag bNNNNN` pins a specific build, `--verify-only` re-checks the current payload without downloading. Reviewing the upstream release notes between builds stays manual on purpose, and so is the **ROCm 6 pack** (Windows 10 / HIP SDK 6.4.2): upstream publishes no HIP-6 Windows assets, so it needs a custom `ggml-hip.dll` build per runtime version — `dev/build-rocm6-pack.ps1` automates that recipe on the Windows build box. Without it, Windows 10 AMD users fall back to the bundled Vulkan backend.
- **Releases**: `dev/pack-release.sh` builds both release archives — it verifies the two trees agree on the version and that `www/` is in sync, then packs both with `.git` and `vendor-source/` excluded.
- **Tests** run with `npm test` (`node --test`) on the *system* Node — which is NOT the app's bundled NW.js runtime. One assertion in `www/core/llmRuntime/tests/FrontDoor.test.js` (SSE chunks arriving as separate `data` events) depends on the runner's Node major: Node ≥ 25 coalesces trailing chunked writes, so it fails on modern Node while passing on Node ≤ 24. The shipped app is unaffected (its NW.js runtime is frozen).
- **Headless GUI**: `xvfb-run -a ./SLR\ Translator.sh` boots the full app inside the dev pod; `data/logs/trans.log` shows startup progress (last line `Running addonLoader.onReady` = all core modules loaded).
- **GPU**: local-model inference uses llama.cpp's **Vulkan** backend. The dev container ships `vulkan-radeon` (RADV) for the AMD GPU; without it, llama.cpp silently falls back to CPU.

## Before you conclude something is "missing" or "just a stub"

1. Did you check `www/core/`? (Most behavior lives there.)
2. Did you grep across **both** `www/js/` and `www/core/`?
3. If a method/handler looks empty in `www/js/`, search for its name in `www/core/` — it is almost certainly implemented by a core module.
4. Remember there are two synced copies of this project on disk:
   - `SLR Translator` (Windows)
   - `SLR Translator Linux` (Linux)
   Keep them in sync when changing shared source.

## Common task → entry points

- "How does translation work?" → `www/core/SLRtrans/lib/Main.js` (+ base in `www/js/TranslatorEngine.js`, `www/js/trans-full.js`).
- "How are RPG Maker games parsed/injected?" → `www/core/rmmv/`, `www/core/rmmz/`, `www/core/rmrgss/` (+ base `Engine`/hooks in `www/js/Engines.js`).
- "How are modules discovered/loaded?" → `www/js/addon.js`.
- "How do I write a user addon?" → `www/addons/README.md`; "how do I add a new game engine?" → "Game-engine addons" above + `www/docs/pages/addons.html`.
- "Where is feature X documented?" → `www/docs/pages/*.html` (+ `www/docs/manifest.js`); user-visible changes must keep these up to date.
- "How does the UI/editor work?" → `www/js/ui.js`, `www/index.html`, and the other `www/*.html` windows.
