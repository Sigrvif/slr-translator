# `www/js/` — base editor, shared infrastructure, and STUB classes

> ## ⚠ STOP — These are mostly base classes and EMPTY hook points, NOT the whole app
>
> This folder is the **generic editor core + shared utilities + base/stub class
> definitions** inherited from the upstream projects SLR Translator was merged
> from. Many files here define a class with **empty handler hooks**; the actual
> RPG Maker translation behavior that fills those hooks lives in
> **`../core/`**.
>
> **Do NOT assume a feature is missing or unimplemented** just because you only
> see a stub here. Always check `../core/` (and read the root `AGENTS.md`)
> before drawing conclusions about how the tool works.

## What lives here

- **Base classes with empty hook points** that core modules implement/override:
  - `Engines.js` — base `Engine` class; defines hooks like `onLoadTrans`,
    `onUnloadTrans`, `exportHandler`. The RPG Maker engines in `../core/rmmv`,
    `rmmz`, `rmrgss` fill these.
  - `TranslatorEngine.js` — translation engine base.
  - `trans.js` — bootstrap that loads/evals `trans-full.js` (the real Trans
    table logic lives in `trans-full.js`, not here).
  - `trans-full.js` — the actual translation grid/session core.
- **The addon system itself:**
  - `addon.js` — the `Addon` and `AddonLoader` classes that discover and load
    modules from **two** source folders: `../core/` (mandatory built-ins,
    loaded first) and `../addons/` (optional user addons). See
    `AddonLoader.getSourceDirs`.
- **Shared editor infrastructure (real, used everywhere):**
  - `common.js`, `sys.js`, `ui.js`, `Logger.js`, `Option.js`, `modalDialog.js`,
    `preload.js`, `langDB.js`, `LangTools.js`, …
- **Window-specific scripts:** `find.js`, `options.js`, `note.js`,
  `rowProperties.js`, `scriptEditor.js`, `automationEditor.js`, … (one per
  `www/*.html` window).

## Rule of thumb

> If a function/handler here looks empty or like a placeholder, its real
> implementation is almost certainly in `../core/<some-module>/`.
> Grep across **both** `www/js/` and `www/core/` before assuming anything.

See the root `AGENTS.md` for the full architecture overview and the list of
core modules.

