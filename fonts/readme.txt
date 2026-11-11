SLR Translator - Font collection folder
========================================

Put font files (.ttf, .otf, .woff, .woff2) into this folder to build your
personal font collection.

RPG Maker MV
------------
MV games load their main font through the entry in fonts/gamefont.css:

    @font-face {
        font-family: GameFont;
        src: url("mplus-1m-regular.ttf");
    }

When SLR Translator parses an MV game, this GameFont entry is collected as
an editable row (file "fonts/gamefont.css", tagged red/font). Change its
translation to the file name of one of your collected fonts (for example
"Arial.ttf") and on export the modified gamefont.css is written into the
export's fonts folder and, if a font with that name is found in this
folder, the font file is copied along automatically.

RPG Maker MZ
------------
MZ games load their fonts through the advanced section of data/System.json:

    "advanced": {
        "mainFontFilename": "mplus-1m-regular.ttf",
        "numberFontFilename": "mplus-1m-regular.ttf",
        ...
    }

Both entries are editable rows of data/System.json (tagged red/font).
Change their translation to the file name of one of your collected fonts
and on export the modified System.json is written and, if a font with that
name is found in this folder, the font file is copied into the export's
fonts folder automatically.

RPG Maker VX / VX Ace
---------------------
RGSS games load custom fonts from the "Fonts" folder next to the game
executable. Use the "!Main Injection" entry of the Scripts (virtual file
that is prepended to the start of Main on export) and set:

    Font.default_name = "FontName.ttf"

When Scripts is exported and the injection assigns a font FILE (with an
extension like .ttf/.otf) to Font.default_name, SLR Translator copies the
matching font from this folder into the export's Fonts folder
automatically. Assignments without a file extension (system font family
names such as "Segoe UI") are ignored.

Notes:
- The name must match the file name exactly (case is ignored).
- Sub folders are not searched; place fonts directly inside this folder.
