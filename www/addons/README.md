# `www/addons/` — user-supplied addons (empty by default)

> ## This folder is for YOUR addons. It is intentionally empty.
>
> The actual **core** functionality of SLR Translator (translation engine, RPG
> Maker parsers, batch, OCR, …) lives in **`../core/`**, not here.
>
> Drop a third-party / user-created addon into this folder (one subfolder per
> addon, each containing a `package.json`) and SLR Translator will load it
> automatically on startup, alongside the core modules.

## How loading works

- On startup, the addon loader (`../js/addon.js`) scans **two** directories, in
  this order:
  1. `www/core/`  — mandatory built-in core modules (loaded first; always on).
  2. `www/addons/` — **this folder**; optional user addons (loaded second).
- Every subfolder that contains a `package.json` is loaded as an addon.
- If a user addon has the same folder name as a core module, the **core** one
  wins (it is loaded first and registered under that name).

## Enabling, disabling, removing

There is no addon manager and no on/off switch — by design:

- **Enable**: place the addon's folder in `www/addons/` (or open a `.tap`
  package with SLR Translator, which extracts it here) and restart.
- **Disable / remove**: delete the addon's folder and restart. Nothing else
  is kept behind except the addon's own settings in `data/config.json`
  (harmless if it returns later).

## Making your own addon

Create a subfolder here, e.g. `www/addons/myAddon/`, with at minimum:

```jsonc
// www/addons/myAddon/package.json
{
    "name": "my-addon",          // unique id (case-insensitive)
    "title": "My Addon",
    "description": "What it does.",
    "version": "1.0.0",
    "main": "main.js",
    "autoload": true             // true: load every file in the folder
                                 // false: load only the files listed in "load"
    // "load": ["main.js"]       // used when autoload is false
    // omit "builtin": true      // only the shipped core modules set this
}
```

```js
// www/addons/myAddon/main.js
const thisAddon = this;          // `this` is the Addon instance

// Register an engine, hook into the UI, add parsers, etc.
// Core base classes / hook points you can extend live in ../js/
// (e.g. Engines.js, TranslatorEngine.js, trans-full.js).
```

### Flags

- `autoload: true`  — auto-load every file in the folder.
- `autoload: false` — load only files listed in the `load` array.
- `builtin: true`   — **do not set this** for user addons. It marks a module as
  mandatory core (cannot be removed). User addons are controlled purely by
  their folder's presence.
- `optionsDisplay`  — `"general"` adds a settings section to the Options →
  General tab, `"tab"` gives the addon its own Options tab. Set one of these
  **only if** the addon also exposes an `optionsForm` (or `optionsFormHtml`) —
  addons without settings never appear in the Options dialog.
- `docs`            — ship a page in the offline documentation:
  `"docs": "docs.html"` (one page) or an array of
  `{ "file", "title?", "keywords?" }` objects. The pages appear under their own
  "Addons" section in the documentation sidebar, in the docs search, and in the
  index "Ask DSLR" answers from. See Help → User Addons → "Shipping a
  documentation page".
- `dependencies`    — npm deps; install them into your addon's own
  `node_modules/` (use `this.require("<module>")` / `this.globalizeNodeModules()`).

## Adding a game engine

An addon can add support for a whole new game engine (including non-RPG-Maker
games) in pure JavaScript — detection, project creation and export:

```js
const thisAddon = this;
engines.add("myengine", { title: "My Engine" });

// 1. make the New Project dialog recognize the game
Engines.registerDetector(async (gamepath) => {
	// return "myengine" when gamepath is recognized, else false
});

// 2. build the project in JS (PHP is not involved)
engines.addHandler("myengine", "createProject", async (args) => {
	const cache = await common.initStaging();
	// read the game's files, copy them into cache.cachePath + "/data",
	// and return the project object:
	return { gameEngine, gameTitle, loc, projectId, parser, cache, files };
});

// 3. write translations back; return true to halt the default exporter
engines.addHandler("myengine", "exportHandler", async (targetPath, options) => {
	// write files, then:
	return true;
});
```

The full contract (project object structure, staging, optional handlers, a
complete example engine) is in the built-in documentation:
Help → User Addons → "Adding a game engine". The custom parser module
(`../core/customParser/`) is the reference implementation.

See `../core/README.md` for the list of core modules, and the root `AGENTS.md`
for the full architecture overview.
