# Screenshot Catalog

Migrated from the legacy v2-era `doc/` pages into `www/docs/img/`. Only screenshots whose
feature/dialog demonstrably still exists in the v3 app were kept; v2-only workflows were
dropped. This catalog drives the docs content-writing tasks.

**Important caveat:** the implementer session could not render image pixels (no image-input
support in this model). Every KEEP decision below is based on (a) the caption/heading context
in the legacy HTML page that referenced the image, (b) verified v3 source evidence for the
shown feature, and (c) file dimension/size sanity checks (no corrupt or unusably tiny files
among the keepers). Content authors should spot-check legibility when embedding, and can
re-capture anything that looks dated.

## Kept images

| Final filename | Source | What it shows | v3 evidence | Suggested pages |
|---|---|---|---|---|
| mvex.png | doc/mvex.png (enginedetection.html) | File-structure example of an RPG Maker MV game (www folder) | www/js/Engines.js:157 (`Engines.detect`); www/core/rmmv/rmmv.js:1790 | engine-detection, engines-overview, mv |
| vxex.png | doc/vxex.png (enginedetection.html) | File structure showing Game.rgss3a (VX Ace) | www/core/rmrgss/rmrgss.js:1183 (`Game.rgss3a` → "ace") | engine-detection, engines-overview, ace |
| aceex.png | doc/aceex.png (enginedetection.html) | File structure showing Game.rgss2a (VX) | www/core/rmrgss/rmrgss.js:1185 (`Game.rgss2a` → "vx") | engine-detection, engines-overview, vx |
| mzex.png | doc/mzex.png (enginedetection.html) | File structure of an RPG Maker MZ game (lowercase data/js folders) | www/js/Engines.js:157; www/core/rmmz/ | engine-detection, engines-overview, mz |
| mvt1.png | doc/mvt1.png (mv.html) | New Project wizard slide: select RPGM parser for an MV game | www/trans.html:1137 ("Start a New Project"); www/js/ui.js:5923 (`NewProjectDialog`) | first-project, mv |
| mvt2.png | doc/mvt2.png (mv.html) | New Project wizard: pick the MV game executable / Create Project step | www/js/ui.js:5923; www/core/rmmv/rmmv.js (createProject flow) | first-project, mv |
| mvt3.png | doc/mvt3.png (mv.html, mz.html) | Project creation result / error review dialog ("Review any errors and click Close") | www/js/ui.js:6649 (new project dialog completion); rmrgss createProject error logging | first-project, mv, mz |
| mzt1.png | doc/mzt1.png (mz.html) | New Project wizard slide: select RPGM parser for an MZ game | www/trans.html:1137; www/js/ui.js:5923 | first-project, mz |
| mzt2.png | doc/mzt2.png (mz.html) | New Project wizard: pick the MZ game executable / Create Project step | www/js/ui.js:5923; www/core/rmmz/ | first-project, mz |
| vxt1.png | doc/vxt1.png (vx.html) | New Project wizard slide: select RPGM parser for a VX game | www/trans.html:1137; www/js/ui.js:5923 | first-project, vx |
| vxt2.png | doc/vxt2.png (vx.html) | New Project wizard: pick the VX game executable / Create Project step | www/js/ui.js:5923; www/core/rmrgss/rmrgss.js:1185 | first-project, vx |
| vxt3.png | doc/vxt3.png (vx.html) | Project creation result / error review dialog for VX | www/js/ui.js:6649 | first-project, vx |
| act1.png | doc/act1.png (ace.html) | New Project wizard slide: select RPGM parser for a VX Ace game | www/trans.html:1137; www/js/ui.js:5923 | first-project, ace |
| act2.png | doc/act2.png (ace.html) | New Project wizard: pick the VX Ace game executable / Create Project step | www/js/ui.js:5923; www/core/rmrgss/rmrgss.js:1183 | first-project, ace |
| act3.png | doc/act3.png (ace.html) | Project creation result / error review dialog for VX Ace | www/js/ui.js:6649 | first-project, ace |
| startpj5.png | doc/startpj5.png (mv/mz/vx/ace.html) | Menu/entry point to open the Batch Translation dialog | www/core/SLRbatch/BatchTranslation.html:4 ("SLR Batch Translation" addon dialog) | batch, first-project, mv, mz, vx, ace |
| startpj6.png | doc/startpj6.png (mv/mz/vx/ace.html) | Batch Translation dialog with default settings (translator select, source/target column, tag blacklist) | www/core/SLRbatch/BatchTranslation.html:9-72 (`redBatchTranslatorSelect`, source/target selects, colorTagSelector) | batch, mv, mz, vx, ace |
| startpj7.png | doc/startpj7.png (mv/mz/vx/ace.html) | Batch translation output/progress report window before closing | www/core/SLRbatch/transredbatch.js (batch progress reporting) | batch, mv, mz, vx, ace |
| startpj9.png | doc/startpj9.png (mv/mz/vx/ace.html) | Word-wrap action/entry used before applying translation | www/trans.html:958 (`#batchWraping` "Wrap text" dialog); www/trans.html:307 (wordWrapTable toggle) | editor-basics, mv, mz, vx, ace |
| startpj10.png | doc/startpj10.png (mv/mz/vx/ace.html) | Right-click context menu to select all modified objects | www/js/trans.js (selection); www/js/jQuery-contextMenu/ (context menu system) | editor-basics, mv, mz, vx, ace |
| startpj11.png | doc/startpj11.png (mv/mz/vx/ace.html) | Export Project button/menu entry | www/trans.html:233 (`button-export` "Export Project") | first-project, mv, mz, vx, ace |
| startpj12.png | doc/startpj12.png (mv/mz/vx/ace.html) | Export Project dialog: choose folder or zip format | www/trans.html:634 (`#dialogExport` "Export Project") | first-project, mv, mz, vx, ace |
| startpj13.png | doc/startpj13.png (mv/mz/vx/ace.html) | Export Options dialog with default settings | www/trans.html:972 (`#dialogExportPreparation` "Export Options") | first-project, mv, mz, vx, ace |
| mvt5.png | doc/mvt5.png (mv.html, mz.html) | Word-wrap-by-tag settings in the Export Options dialog (stint/pstint font options) | www/trans.html:988 (`wordWrapByTag` section in `#dialogExportPreparation`); www/core/SEP/SEP.js:37 (SLRCondensedCJK font) | mv, mz, editor-basics |
| mvt6.png | doc/mvt6.png (mv.html, mz.html) | Editor view reviewing plugins.js after translation | www/core/rmmv/rmmv.js:1790-1794 (plugins.js copy/parse), :2258 | mv, mz, script-editor |
| act4.png | doc/act4.png (ace.html, vx.html) | Word-wrap-by-tag settings for RGSS games ("size"/"psize" choices) | www/trans.html:988 (`wordWrapByTag`); www/core/rmrgss/rmrgss.js:241-247 (script parsing) | ace, vx, editor-basics |
| act5.png | doc/act5.png (ace.html, vx.html) | Editor view reviewing Scripts sections ("_.1", "_.2" split cells) in RGSS projects | www/core/rmrgss/rmrgss.js:241-247 (scripts structure) | ace, vx, script-editor |
| mvfont1.png | doc/mvfont1.png (mv.html) | MV game's fonts folder where a custom font is added (game-side, not app UI) | MV game structure (www/fonts); www/core/SEP/SEP.js:37 font handling precedent | mv |
| mvfont2.png | doc/mvfont2.png (mv.html) | Editing gamefont.css in the MV game to reference the new font | MV game file www/fonts/gamefont.css (engine-stable, not app UI) | mv |
| mzfont.png | doc/mzfont.png (mz.html) | MZ game's fonts folder where a custom font is added | MZ game structure (fonts/); engine-stable game-side file | mz |
| mzfont1.png | doc/mzfont1.png (mz.html) | Editing System.json in the MZ game's data folder | MZ game file data/System.json (engine-stable) | mz |
| mzfont2.png | doc/mzfont2.png (mz.html) | Single-line code strip showing fontSize / mainFontFilename values in System.json (wide strip: 2468x45) | MZ System.json keys (engine-stable); flagged: very short strip, verify legibility when embedding | mz |
| l1.png | doc/l1.png (locale.html) | Windows 10 locale settings: Settings > Time & Language > Region step | OS-level UI (stable); docs page locale exists | locale |
| l2.png | doc/l2.png (locale.html) | Windows 10: Additional date, time & regional settings / Region step | OS-level UI (stable) | locale |
| l3.png | doc/l3.png (locale.html) | Windows 10: Administrative tab / "Change system locale" step | OS-level UI (stable) | locale |
| l4.png | doc/l4.png (locale.html) | Windows 10: selecting Japanese as the system locale | OS-level UI (stable) | locale |
| tag-white.png | doc/white.png (tags.html) | White/no-color tag swatch: normal dialogue, safe to translate | www/js/consts.js:235-253 (`consts.tagColor`); www/js/ui.js:4846-4853 (tag selector) | color-tags |
| tag-gray.png | doc/gray.png (tags.html) | Gray tag swatch: no Japanese text, skipped by default | www/js/consts.js:240 (`gray`) | color-tags |
| tag-green.png | doc/green.png (tags.html) | Green tag swatch: partially safe, script bits escaped | www/js/consts.js:237 (`green`) | color-tags |
| tag-red.png | doc/red.png (tags.html) | Red tag swatch: not safe to translate, skipped | www/js/consts.js:236 (`red`); www/core/SLRbatch/BatchTranslation.html:72 (red default-excluded) | color-tags |
| tag-darkred.png | doc/darkred.png (tags.html) | Dark red tag swatch: red tag without Japanese text | www/js/consts.js:251 (`darkred`) | color-tags |
| tag-yellow.png | doc/yellow.png (tags.html) | Yellow tag swatch: needs manual verification, skipped | www/js/consts.js:236 (`yellow`) | color-tags |
| tag-gold.png | doc/gold.png (tags.html) | Gold tag swatch: yellow tag without Japanese text | www/js/consts.js:238 (`gold`) | color-tags |
| tag-blue.png | doc/blue.png (tags.html) | Blue tag swatch: escaped/comment dev notes, skipped | www/js/consts.js:237 (`blue`) | color-tags |
| tag-aqua.png | doc/aqua.png (tags.html) | Aqua tag swatch: blue tag without Japanese text | www/js/consts.js:250 (`aqua`) | color-tags |
| tag-purple.png | doc/purple.png (tags.html) | Purple tag swatch: LLM crash suspected | www/js/consts.js:239 (`purple`) | color-tags, errors |
| tag-indigo.png | doc/indigo.png (tags.html) | Indigo tag swatch: word wrapping issue | www/js/consts.js:249 (`indigo`) | color-tags |
| tag-num.png | doc/num.png (tags.html) | Number tag swatch: numeric entries (font sizes etc.) | www/js/consts.js:252 (`num`) | color-tags |
| tag-pink.png | doc/pink.png (tags.html) | Pink tag swatch: processing error, should not exist | www/js/consts.js:246 (`pink`) | color-tags, errors |
| searchbytag.png | doc/searchbytag.png (tags.html) | Find dialog using the "Target: Tag" option to search by color tag | www/find.html:76-83 (searchMode optgroup "Target:" with `tag` option); www/js/find.js:158-180 | color-tags, find-replace |

## Dropped images

| Source | Reason |
|---|---|
| enigma1.png, enigma2.png, enigma3.png, enigma4.png (enigma.html) | Show the external Windows-only EnigmaVBUnpacker.exe GUI workflow. v3 replaced it with built-in cross-platform auto-detection/unpacking (www/js/lib/enigmaUnpacker.js:1-33, www/js/Engines.js:146-149, www/core/rmrgss/rmrgss.js:1892-1903), so the external-tool steps are obsolete and misleading. encrypted-games needs fresh v3 screenshots of the automatic flow. |
| ace_1.jpg ... ace_6.jpg (alldecrypter.html; ace_6 unreferenced) | Show the external "RPG Maker All Decrypter" GUI used to manually extract .rgss3a/.rgss2a. v3 auto-decrypts rgss archives during project creation with the bundled RPGMakerDecrypter-cli (www/core/rmrgss/rmrgss.js:1488-1509), so the manual external workflow no longer exists. ace_6.jpg was additionally an unreferenced orphan. |
| dbutton1.png ... dbutton4.png (debugbutton.html) | Documented a custom JavaScript debug button enabled by editing the v2 trans.js source at "approximately line 1600" and adding code "at approximately line 7000". v3 www/js/trans.js is only 283 lines and contains no such commented-out button code — the hack is version-locked to v2. (Custom parsers themselves do exist in v3 at www/core/customParser/, but these images show the source-edit button, not parsers.) |
| cellerror1.png, cellerror2.png, cellerror3.png (orphans) | Not referenced by any legacy doc page (errorlist.html has no images), and content could not be pixel-verified. Purpose/step unknown; lean-drop per policy. The errors page should get fresh, captioned error screenshots instead. |
| mvt4.png (orphan) | Not referenced by any legacy page (mv.html jumps mvt3 → shared startpj images → mvt5). Which flow step it depicts is unknown and unverifiable; likely a superseded duplicate of the MV walkthrough. |

## Judgment calls worth flagging

- **Enigma + All Decrypter drops:** the underlying *needs* (unpack Enigma-packed exes, extract
  rgss archives) are fully handled inside v3 now, but the `encrypted-games`, `ace`, `vx`, and
  `xp` pages will need NEW screenshots of the automatic in-app flow — none were migrated.
- **Engine walkthrough leans:** mvt*/mzt*/vxt*/act* project-setup shots and the shared
  startpj* batch/export shots were kept under the "core stable flow" exception even though
  exact wizard wording may differ in v3; captions will be rewritten anyway. mvt3 doubles as
  the MZ "review errors" shot in the legacy docs (mz.html reused it).
- **Locale shots (l1-l4):** Windows 10 OS dialogs, stable and app-version-independent; kept,
  but they show Win10 only (legacy page notes Win11 needs different steps).
- **Game-side font shots (mvfont1/2, mzfont/1/2):** show files inside the *game*, not the
  translator app, so they cannot be stale app UI; mzfont2 is a very wide 45px-tall code strip —
  re-capture if legibility is poor.
- **Pixel verification was impossible in this session** (model without image input). All
  keepers passed dimension/size sanity checks and have verified v3 feature evidence, but a
  human pass over legibility is recommended before publishing.
