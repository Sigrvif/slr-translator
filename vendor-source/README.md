# vendor-source — collaborator source archives

Pristine source archives from the project's early collaborative development
(2022), preserved for provenance and license compliance. Reddo ("Reddo9999")
worked with the project directly at the time and is credited in the About
page and the options dialog.

| Archive | What it is |
|---|---|
| `transRedBatch-0.13.zip` | Original addon source by Reddo; parts of today's batch translation code in `www/core/SLRbatch` derive from it |
| `transRedSugoi-1.4.zip` | Original addon source by Reddo; parts of today's engine wrappers in `www/core/SLRtrans/lib/TranslationEngine` derive from it (Reddo's option ordering is still quoted in `TranslationEngineWrapper.js`) |
| `mtl-text-processor-main.zip` | Pristine upstream snapshot (GitHub main branch, 2022) of the `mtl-text-processor` npm package — the copy under `www/core/SLRtrans/node_modules/` has been directly edited since and no longer matches it |

All three are GPLv3-licensed (full license text inside each archive), the
same license as SLR Translator itself, so derivation and redistribution are
unproblematic — they just need to stay named, which
`THIRD-PARTY-NOTICES.html` ("Collaborator source archives" section) does.

These archives are reference material, not runtime assets: nothing in the
application loads them, and they do not need to ship in release packages.
Regenerate the notices with `node dev/generate-third-party-notices.js` after
changing anything in this folder.
