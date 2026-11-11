"use strict";
/*
 * SEP.js — SLR Translator 3 picture-translation (no Python).
 *
 * Pipeline:
 *   new project: scan a folder for PNG/JPG -> on-device OCR (PP-OCRv6 ONNX via
 *                lib/ocr.js) -> each detected text box becomes a translatable row.
 *   export:      translated rows are written back to the box data, the original
 *                text is erased (blur or AOT inpainting) and the translation is
 *                drawn (lib/render.js). Encrypted game images are re-encrypted
 *                into their original files plus a viewable copy under
 *                decrypted/; intermediate OCR box JSONs are not exported.
 *
 * All heavy lifting is in lib/ocr.js (onnxruntime-node), lib/render.js
 * (opentype.js + Canvas 2D), and lib/inpaint.js (AOT inpainting ONNX).
 * All three ship prebuilt binaries / pure JS in this modules's node_modules,
 * so the module is a self-contained, offline drop-in that runs on SLR's
 * bundled Node 15.12 (NW.js 0.52).
 *
 * Data model mirrors SLR2's SEP: SEPObj extends ParserBase; the OCR box JSON is
 *   { "<image>.png": { "<boxId>": { text, recognition_score, top_left, top_right,
 *                                   bottom_right, bottom_left } } }
 */

var thisAddon = this;
var appName = this.package.name;

var nwPath = nwPath || require("path");
var fs = require("fs");
var fse = require("fs-extra");
var PNG = require("pngjs").PNG;
var jpeg = require("jpeg-js");

var addonDir = nwPath.resolve(thisAddon.fullPath);
var modelsDir = nwPath.join(addonDir, "models");
function getFontPath() {
    // "StintUltraCondensed-Unifont.ttf" is the pre-rename name of SLRCondensedCJK-Regular.ttf
    var font = thisAddon.config.drawFont || "SLRCondensedCJK-Regular.ttf";
    if (font === "StintUltraCondensed-Unifont.ttf") font = "SLRCondensedCJK-Regular.ttf";
    return nwPath.join(addonDir, font);
}

// ORT (onnxruntime-node) and Canvas 2D both work natively inside NW.js.
// Image I/O uses pngjs/jpeg-js (pure JS). Sharp was the only module that
// deadlocked — it has been removed entirely.
var _ocr = null, _render = null;
function getOCR() {
    if (!_ocr) _ocr = require(nwPath.join(addonDir, "lib", "ocr.js"));
    return _ocr;
}
function getRender() {
    if (!_render) _render = require(nwPath.join(addonDir, "lib", "render.js"));
    return _render;
}
var _crypt = null, _game = null;
function getCrypt() {
    if (!_crypt) _crypt = require(nwPath.join(addonDir, "lib", "crypt.js"));
    return _crypt;
}
function getGame() {
    if (!_game) _game = require(nwPath.join(addonDir, "lib", "game.js"));
    return _game;
}
var _ortSession = null;
function getORT() {
    if (!_ortSession) _ortSession = require(nwPath.join(addonDir, "lib", "ort_session.js"));
    return _ortSession;
}
// Push the GPU preference into the shared session factory before any model is
// loaded, and route its provider/fallback messages into the in-app log so a
// CPU fallback is visible instead of silent. See lib/ort_session.js.
function applyGPUSetting() {
    try {
        var ortSession = getORT();
        ortSession.setLogger(function (message) {
            try { console.log(message); } catch (e) { }
            try { ui.log(message); } catch (e) { }
        });
        ortSession.setPreferGPU(thisAddon.config.useGPU !== false);
    } catch (e) { }
}

// Decide whether a translation actually changes the visible text. Cosmetic-only
// differences are treated as "no change" so the already-correct original is left
// on the image instead of being erased and redrawn:
//   - full-width <-> half-width forms (Ａ -> A, １ -> 1, …)  via Unicode NFKC
//   - letter case (B -> b)
//   - any whitespace (added/removed spaces, incl. ideographic space U+3000)
//   - any punctuation (., ! ? : ; 。 、 … etc.)
// A real translation (different letters/words) still counts as changed.
function sepTextChanged(original, translated) {
    function norm(s) {
        return String(s)
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[\s\u3000]+/g, "")
            .replace(/\p{P}/gu, "");
    }
    return norm(original) !== norm(translated);
}

// Japanese text detection (hiragana, katakana incl. halfwidth forms, CJK
// ideographs, iteration marks) — same ranges the engine uses for isolation.
var JP_TEXT_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f々〆〤]/;

// Options form rendered under General Options (package.json optionsDisplay:"general").
this.optionsForm = {
    eraseMode: {
        type: "radio",
        title: "Text removal method",
        description: "How the original text is erased before drawing the translation. None draws the translation over the original text without erasing. Blur is fast and works well on plain backgrounds. AOT Inpaint uses a compact neural network (22 MB) to fill erased areas — good balance of quality and speed. LaMa Inpaint uses a larger FFT-based model (200 MB) with per-region 512×512 crops — potentially better reconstruction on complex textures, but slower (one model run per text region). You can override this per row by appending r{none}, r{blur}, r{aot}, or r{lama} to the translated text (e.g. \"Hello r{blur}\"). Note: when the translation is identical to the original OCR text, SEP leaves the already-correct text untouched (no erase, no redraw). Append d{} to a row to force it to be erased and redrawn anyway.",
        enum: ["none", "blur", "aot", "lama"],
        default: "lama",
        HOOK: "thisAddon.config.eraseMode",
    },
    skipUnchanged: {
        type: "boolean",
        title: "Skip identical text",
        description: "When enabled (default), text boxes whose translation matches the original OCR text are left untouched — the original is not erased and not redrawn, since it is already correct. Cosmetic-only differences (full-width vs. half-width characters like Ａ→A / １→1, letter case like B→b, whitespace, and punctuation) also count as identical. Disable to erase and redraw every box, even when the translation matches the original. Per-row d{} overrides (or the force_draw_override JSON field) force a redraw regardless of this setting.",
        default: true,
        HOOK: "thisAddon.config.skipUnchanged",
    },
    useGPU: {
        type: "boolean",
        title: "GPU acceleration (WebGPU)",
        description: "On: OCR and inpainting run on the GPU through ONNX Runtime's WebGPU execution provider, with DirectML tried as a Windows fallback, and drop back to CPU automatically whenever no usable GPU can be created. Both providers are already bundled with SEP — nothing extra to install — and work on most modern NVIDIA, AMD and Intel GPUs. Off: CPU only. Use this to compare speed on a machine with a GPU, or to rule out GPU-related problems or incorrect results. Restart to apply.",
        default: true,
        HOOK: "thisAddon.config.useGPU",
        onChange: function () { try { options.requestRestart(); } catch (e) { } }
    },
    inpaintDilation: {
        type: "number",
        title: "Inpaint mask expansion",
        description: "How many pixels to expand each text box when building the inpainting mask. Larger values ensure all text artifacts are covered; smaller values are faster. Only used when AOT or LaMa is selected.",
        default: 4,
        HOOK: "thisAddon.config.inpaintDilation",
    },
    inpaintMargin: {
        type: "number",
        title: "Inpaint context margin",
        description: "Extra pixels of surrounding image included around each text region when using LaMa inpainting. Higher values give the model more background context to reconstruct from, improving quality at texture boundaries. Koharu uses 128. Very high values may cause downscaling for large text groups. Only used when LaMa is selected.",
        default: 96,
        HOOK: "thisAddon.config.inpaintMargin",
    },
    scoreThreshold: {
        type: "number",
        title: "OCR score threshold",
        "description": "Detections with a recognition confidence below this value are discarded. 0.0 keeps everything (including noise); 0.5 is a good default for clean text.",
        default: 0.5,
        HOOK: "thisAddon.config.scoreThreshold",
    },
    discardNoTextObjects: {
        type: "boolean",
        title: "Discard images without detected text",
        description: "When enabled, images in which OCR finds no text at all (no boxes, or only boxes with empty text) are left out of new projects entirely — they get no rows and nothing of them is written on export. Keeps the project clean when a game folder contains many text-free images. To encrypt manually edited images without a project, use 'Encrypt only' on the staging folder (New Project -> SEP). Takes effect the next time a project is created.",
        default: true,
        HOOK: "thisAddon.config.discardNoTextObjects",
    },
    discardNonJapaneseObjects: {
        type: "boolean",
        title: "Discard images without Japanese text",
        description: "When enabled, images in which none of the detected text boxes contain Japanese characters (kanji/kana) are left out of new projects — e.g. images with only numbers, logos, or Latin-script text. Meant for Japanese-source image translation. Takes effect the next time a project is created.",
        default: false,
        HOOK: "thisAddon.config.discardNonJapaneseObjects",
    },
    enableVerticalOCR: {
        type: "boolean",
        title: "Vertical text OCR",
        description: "When enabled (default), text boxes detected at a steep angle (vertical text columns — common in Japanese tategaki) are recognised a second time in the vertical orientation PP-OCRv6 is trained for, and the higher-confidence result is kept. Boxes near horizontal — the vast majority of RPG Maker text — are recognised exactly once as before, so horizontal accuracy and speed are unchanged. Disable to force horizontal-only recognition (the previous behaviour).",
        default: true,
        HOOK: "thisAddon.config.enableVerticalOCR",
    },
    verticalAngleThreshold: {
        type: "number",
        title: "Vertical text angle threshold",
        description: "Boxes whose detected angle is within this many degrees of vertical (90°) get the second, vertical recognition pass. 30 is a good default: horizontal text (including text tilted up to ~30°) is recognised once; steeper / vertical columns get the extra pass. Lower values catch more near-vertical text at the cost of a second OCR pass on tilted text; higher values only trigger on clearly vertical columns. Only used when 'Vertical text OCR' is on.",
        default: 30,
        HOOK: "thisAddon.config.verticalAngleThreshold",
    },
    angleSnapThreshold: {
        type: "number",
        title: "Horizontal angle snap",
        description: "Text detected at an angle within this many degrees of horizontal is treated as perfectly horizontal (0 degrees). Helps correct slight detection errors on flat text lines.",
        default: 3.0,
        HOOK: "thisAddon.config.angleSnapThreshold",
    },
    angleGroupThreshold: {
        type: "number",
        title: "Angle grouping tolerance",
        description: "Boxes whose angles differ by less than this many degrees are grouped together and share the group's average angle. Ensures text in the same block renders at a consistent angle.",
        default: 5.0,
        HOOK: "thisAddon.config.angleGroupThreshold",
    },
    verticalAngleSnapThreshold: {
        type: "number",
        title: "Vertical angle snap",
        description: "Text detected within this many degrees of vertical (90°) is treated as perfectly vertical during drawing — the slight tilt the detector leaves on vertical (tategaki) columns is removed. In addition, all vertical columns are forced to share one orientation (chosen by majority), so a line never renders upside-down relative to its neighbours (which otherwise happens because +90° and -90° sit on the ±90° detection fold and detection noise flips the sign). 3° matches the horizontal snap. Increase to tolerate more tilt; 0 disables vertical snapping (columns keep their detected tilt and sign). Only affects how the translation is drawn and erased, not the OCR text.",
        default: 3.0,
        HOOK: "thisAddon.config.verticalAngleSnapThreshold",
    },
    heightGroupThreshold: {
        type: "number",
        title: "Font size grouping tolerance",
        description: "Boxes whose heights differ by less than this fraction (0.2 = 20%) are grouped together and share a uniform font size — the largest that fits all boxes in the group.",
        default: 0.2,
        HOOK: "thisAddon.config.heightGroupThreshold",
    },
    minFontSize: {
        type: "number",
        title: "Minimum font size",
        description: "Floor for the auto-calculated font size (in px). If translated text is too long to fit its box at this size, the text overflows the box rather than shrinking further, so it stays readable. Values below 1 (or left blank) fall back to 12. Per-row f{size} overrides are unaffected.",
        default: 12,
        HOOK: "thisAddon.config.minFontSize",
    },
    blurStrength: {
        type: "number",
        title: "Erase blur strength",
        description: "Multiplier for the blur radius used to erase original text. 1.0 is the default (radius = text box height). Higher values blur more aggressively; lower values keep more of the original texture. 0 disables blur entirely.",
        default: 1.0,
        HOOK: "thisAddon.config.blurStrength",
    },
    detectSolidBackground: {
        type: "boolean",
        title: "Detect solid-color backgrounds",
        description: "When enabled, text boxes sitting on a flat (solid) background are detected automatically and filled with that exact background colour instead of being processed by the inpainting/blur method. This produces a perfectly clean, artifact-free fill on solid UI panels, where LaMa/AOT/blur can leave faint colour casts or texture artifacts. Boxes on textured or gradient backgrounds are left untouched and handled normally by the selected method.",
        default: true,
        HOOK: "thisAddon.config.detectSolidBackground",
    },
    solidColorThreshold: {
        type: "number",
        title: "Solid background tolerance",
        description: "How much (0–255) the background colour may vary within the border around a text box and still be treated as 'solid'. Smaller = stricter (only near-perfectly flat fills qualify). Larger = more tolerant (catches slightly noisy flat fills such as low-quality JPEGs) but risks filling subtly textured areas. Only used when 'Detect solid-color backgrounds' is on.",
        default: 4,
        HOOK: "thisAddon.config.solidColorThreshold",
    },
    solidBoxMargin: {
        type: "number",
        title: "Solid box fill margin",
        description: "Extra pixels (can be negative) added to the box size when painting a solid-color fill over detected text, on top of the 'Inpaint mask expansion' value. 0 (default) keeps the fill tight to the OCR box. Increase it (e.g. 2–4) to cover small leftover bits of the original text caused by slightly-off text box detections; decrease it if the fill paints over nearby outlines such as a speech-bubble border. Only used when 'Detect solid-color backgrounds' is on; the fill never drops below 2 px of padding.",
        default: 0,
        HOOK: "thisAddon.config.solidBoxMargin",
    },
    autoBoxMargin: {
        type: "boolean",
        title: "Auto-grow fill to cover overflowing text",
        description: "When enabled (default), the solid-color fill is automatically grown to cover text that extends beyond the detected (OCR) box — e.g. wavy or extravagant fonts whose flourishes and stroke ends the text box missed. It measures only ink that is connected to the box's own text, so a neighbouring text line is not counted and will not be erased. Stacks with 'Solid box fill margin'. Disable if you prefer a fixed fill size or see any over-expansion on tightly packed text. Only used when 'Detect solid-color backgrounds' is on.",
        default: true,
        HOOK: "thisAddon.config.autoBoxMargin",
    },
    textBorderValue: {
        type: "number",
        title: "Text outline thickness",
        description: "Outline thickness drawn around the translated text (0 disables the outline). Restart to apply.",
        default: 0,
        HOOK: "thisAddon.config.textBorderValue",
        onChange: function () { try { options.requestRestart(); } catch (e) { } }
    },
    autoTextOutline: {
        type: "boolean",
        title: "Auto outline for low-contrast text",
        description: "When the 'Text outline thickness' is 0 (default), this draws a subtle outline around the translated text AUTOMATICALLY, but only when the text would otherwise be hard to read against its background. The original text colour is reused for the translation, but after erasure the new background can differ, so the fill can end up almost invisible (white text on a white panel, black text on a dark picture, etc.). On transparent images the in-game background is unknown, so the outline is always added there. The outline uses the inverse colour of the text and scales subtly with the font size, so already-readable text is left untouched. Disable to never auto-outline (text may become invisible in the cases above); the per-row c{color} / manual outline options are unaffected.",
        default: true,
        HOOK: "thisAddon.config.autoTextOutline",
    },
    detectTextColor: {
        type: "boolean",
        title: "Match original text color",
        description: "When enabled, the dominant colour of the original text is detected and reused for the translation, instead of always using white or black. Falls back to the automatic white/black choice when the original colour cannot be determined reliably or would not contrast with the background. Per-row c{r,g,b} / c{named} overrides always take priority.",
        default: true,
        HOOK: "thisAddon.config.detectTextColor",
    },
    drawFont: {
        type: "string",
        title: "Render font",
        description: "TrueType font file (in the SEP folder) used to draw translations. Restart to apply. Per-row overrides can be appended to the translated text: f{size} forces the font size in px (e.g. \"Hello f{18}\"), c{r,g,b} or c{named} forces the text color (e.g. \"Hello c{255,0,0}\" or \"Hello c{white}\"), and d{} forces a box to be erased and redrawn even when the translation is identical to the original. These stack with each other and with r{erase mode}.",
        default: "SLRCondensedCJK-Regular.ttf",
        HOOK: "thisAddon.config.drawFont",
        onChange: function () { try { options.requestRestart(); } catch (e) { } }
    }
};

thisAddon.applyDefaults({
    lowScore: 0.1,
    highScore: 0.95,
    applyBlur: true,
    infoText: "You need to restart SLR Translator to apply changes made here.",
    angleGroupThreshold: 15.0
}, function(key, val, stored) {
    if (key === "eraseMode") {
        if (val === "inpaint") return "aot";
        if (val === "blur" && stored.applyBlur === false) return "none";
    }
    if (key === "minFontSize") {
        var n = Number(val);
        if (!(n >= 1)) return 12;
    }
    return undefined;
});

// Uses SLR3's global empty() (handles arrays/objects), not a local override.

// ============================================================
// JPEG helpers — metadata extraction + quality estimation + re-encoding
// ============================================================

// Parse JPEG markers to extract quantization tables, chroma subsampling,
// and image dimensions.  The DQT values are in zigzag scan order as stored
// in the file (per the JPEG spec).
function parseJpegMetadata(jpegBuffer) {
    var view = new Uint8Array(jpegBuffer);
    var i = 0;
    var quantizationTables = [];
    var subsampling = "unknown";
    var width = 0, height = 0;

    if (view[0] !== 0xFF || view[1] !== 0xD8)
        return { quantizationTables: [], subsampling: subsampling, width: width, height: height };
    i = 2;

    while (i < view.length - 1) {
        if (view[i] !== 0xFF) { i++; continue; }
        var marker = view[i + 1];
        if (marker === 0xFF) { i++; continue; }          // padding
        if ((marker >= 0xD0 && marker <= 0xD9) || marker === 0x01) { i += 2; continue; }
        if (i + 3 >= view.length) break;
        var length = (view[i + 2] << 8) | view[i + 3];
        if (i + 2 + length > view.length) break;

        switch (marker) {
            case 0xDB: // DQT
                var off = i + 4;
                while (off < i + 2 + length) {
                    var qtInfo = view[off++];
                    var precision = qtInfo >> 4;
                    var tableId = qtInfo & 0x0F;
                    var tSize = precision === 0 ? 64 : 128;
                    if (off + tSize > i + 2 + length) break;
                    var td = new Array(tSize);
                    for (var j = 0; j < tSize; j++) td[j] = view[off++];
                    quantizationTables.push({ id: tableId, precision: precision, data: td });
                }
                break;
            case 0xC0: case 0xC1: case 0xC2: case 0xC3:
            case 0xC5: case 0xC6: case 0xC7: case 0xC9:
            case 0xCA: case 0xCB: case 0xCD: case 0xCE: case 0xCF: // SOF
                height = (view[i + 5] << 8) | view[i + 6];
                width = (view[i + 7] << 8) | view[i + 8];
                var nc = view[i + 9];
                var sf0 = view[i + 11];   // Y component sampling factor
                var sf1 = nc >= 2 ? view[i + 14] : 0; // Cb component sampling factor
                var yh = (sf0 >> 4) & 0xF, yv = sf0 & 0xF;
                var ch = (sf1 >> 4) & 0xF, cv = sf1 & 0xF;
                if (yh === 2 && yv === 2 && ch === 1 && cv === 1) subsampling = "4:2:0";
                else if (yh === 2 && yv === 1 && ch === 1 && cv === 1) subsampling = "4:2:2";
                else if (yh === 1 && yv === 1 && ch === 1 && cv === 1) subsampling = "4:4:4";
                else subsampling = yh + ":" + yv + ":" + ch;
                break;
        }
        i += 2 + length;
    }
    return { quantizationTables: quantizationTables, subsampling: subsampling, width: width, height: height };
}

// Estimate the original JPEG quality from the luminance quantization table
// by comparing each coefficient against the IJG standard table (in zigzag
// order, matching the DQT byte layout).  Returns a quality 1–100.
// Falls back to 92 when the table is missing or uses a non-standard layout.
function estimateJpegQuality(lumaQTable) {
    var IJG_LUMA_NATURAL = [
        16, 11, 10, 16, 24, 40, 51, 61,
        12, 12, 14, 19, 26, 58, 60, 55,
        14, 13, 16, 24, 40, 57, 69, 56,
        14, 17, 22, 29, 51, 87, 80, 62,
        18, 22, 37, 56, 68,109,103, 77,
        24, 35, 55, 64, 81,104,113, 92,
        49, 64, 78, 87,103,121,120,101,
        72, 92, 95, 98,112,100,103, 99
    ];
    var ZigZag = [
         0, 1, 5, 6,14,15,27,28,
         2, 4, 7,13,16,26,29,42,
         3, 8,12,17,25,30,41,43,
         9,11,18,24,31,40,44,53,
        10,19,23,32,39,45,52,54,
        20,22,33,38,46,51,55,60,
        21,34,37,47,50,56,59,61,
        35,36,48,49,57,58,62,63
    ];
    if (!lumaQTable || lumaQTable.length < 64) return 92;

    // Build IJG luminance table in zigzag order to match DQT layout.
    var IJG_ZZ = new Array(64);
    for (var n = 0; n < 64; n++) IJG_ZZ[ZigZag[n]] = IJG_LUMA_NATURAL[n];

    var factors = [];
    for (var z = 0; z < 64; z++) {
        if (IJG_ZZ[z] > 0 && lumaQTable[z] > 0)
            factors.push(lumaQTable[z] * 100 / IJG_ZZ[z]);
    }
    if (factors.length === 0) return 92;

    factors.sort(function (a, b) { return a - b; });
    var mid = Math.floor(factors.length / 2);
    var medianSf = factors.length % 2 ? factors[mid] : (factors[mid - 1] + factors[mid]) / 2;

    var quality;
    if (medianSf < 100) quality = Math.round((200 - medianSf) / 2);
    else quality = Math.round(5000 / medianSf);
    return Math.max(1, Math.min(100, quality));
}

// lazy one-time model load
var _modelsLoaded = false;
async function ensureModels() {
    if (_modelsLoaded) return;
    applyGPUSetting();
    await ui.log("[SEP] Loading OCR models (PP-OCRv6_medium ONNX)...");
    await getOCR().loadModels(modelsDir);
    _modelsLoaded = true;
    await ui.log("[SEP] OCR models loaded.");
}

// ============================================================
// SEPObj — wraps an OCR box-JSON; registers each box text via ParserBase
// ============================================================
class SEPObj extends require("www/js/ParserBase.js").ParserBase {
    constructor(obj, options, callback) {
        super(obj, options, callback);
        this.transData = { data: [], context: [], tags: [], parameters: [], indexIds: {} };
    }
}

SEPObj.prototype.registerStringObject = function (obj, context, parameters, options) {
    return this.registerString(obj, context, parameters, options);
};

SEPObj.prototype.parse = function (obj, context, translationPair) {
    obj = obj || this.script;
    obj = common.clone(obj);
    translationPair = translationPair || this.translationPair;
    if (!Boolean(context)) context = [];
    if (Array.isArray(context) == false) context = [context];

    var self = this;
    var isWriteMode = this.options.writeMode;
    var fetchChild = (item, localContext) => {
        if (Array.isArray(localContext) == false) localContext = [localContext];
        if (typeof item === "object" && !Array.isArray(item)) {
            for (const key in item) {
                var newContext = common.clone(localContext);
                newContext.push(key);
                const value = item[key];
                if (value && typeof value === "object") {
                    if (key.match(/\.(png|jpe?g)$/i)) {
                        for (const boxKey in value) {
                            const box = value[boxKey];
                            if (box && typeof box === "object" && box.text !== undefined && box.recognition_score !== undefined) {
                                let boxContext = [...newContext, boxKey, "OCR Score: " + box.recognition_score];
                                var originalText = box.text;
                                box.text = self.registerStringObject(box.text, boxContext);
                                // During export, mark whether the text was actually translated
                                // so render.js can skip unchanged rows (no blur/redraw needed).
                                // Cosmetic-only differences (full-width, case, whitespace,
                                // punctuation) do NOT count as a change.
                                if (isWriteMode) box._changed = sepTextChanged(originalText, box.text);
                            }
                        }
                    } else if (value.text !== undefined && value.recognition_score !== undefined) {
                        let boxContext = [...newContext, "OCR Score: " + value.recognition_score];
                        var origText = value.text;
                        value.text = self.registerStringObject(value.text, boxContext);
                        if (isWriteMode) value._changed = sepTextChanged(origText, value.text);
                    } else {
                        fetchChild(value, newContext);
                    }
                }
            }
        }
    };
    fetchChild(obj, context);
    this.writableObj = obj;
    return this;
};

SEPObj.prototype.toString = function () {
    if (!this.writableObj) return "";
    return JSON.stringify(this.writableObj, null, this.options.beautifyOutput ? 4 : 0);
};

// ============================================================
// SEPParser — drives OCR (create) and render (export)
// ============================================================
function SEPParser(path, options) {
    this.path = path;
    this.options = options || {};
    this.options.files = this.options.files || [];
    this.writeMode = this.options.writeMode;
    this.translationPair = this.options.translationPair;
}

SEPParser.prototype.processThispath = function (relPath) {
    if (!this.options || empty(this.options.files)) return true;
    return this.options.files.includes(relPath);
};

// OCR every image in this.path, writing one <name>.json + <name>.png per image into tmp.
SEPParser.prototype.runOCR = async function (tmpPath) {
    await ensureModels();
    await fse.ensureDir(tmpPath);
    await fse.emptyDir(tmpPath);

    const baseDir = nwPath.resolve(this.path);
    const allItems = await common.readDir(this.path);
    const manifest = await getGame().readManifest(this.path);
    this.manifest = manifest;
    const imageFiles = allItems.filter((f) => {
        const ext = nwPath.extname(f).toLowerCase();
        if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg" && ext !== ".bmp" &&
            ext !== ".webp" && ext !== ".tga" && ext !== ".pcx") return false;
        // game/staging folders (manifest present) are scanned recursively;
        // generic folders keep today's top-level-only behavior
        return manifest ? true : nwPath.dirname(f) === baseDir;
    });

    let processed = 0;
    let missingEnc = 0;
    let discardedNoText = 0;
    let discardedNoJapanese = 0;
    for (const imgPath of imageFiles) {
        const ext = nwPath.extname(imgPath).toLowerCase();
        const relPath = common.getRelativePath(imgPath, baseDir); // "/"-separated (common normalizes)
        const pngRel = relPath.slice(0, relPath.length - ext.length) + ".png";
        const destPng = nwPath.join(tmpPath, pngRel);
        await fse.ensureDir(nwPath.dirname(destPng));
        ui.loadingProgress(Math.round(processed / Math.max(imageFiles.length, 1) * 100),
            "[SEP] OCR: " + nwPath.basename(imgPath), { consoleOnly: true, mode: "consoleOutput" });

        // normalize to PNG in tmp, capturing source metadata for re-encoding on export
        let workPath = imgPath;
        let srcMeta = null;
        if (ext === ".jpg" || ext === ".jpeg") {
            const jpgBuf = await fse.readFile(imgPath);
            const jd = jpeg.decode(jpgBuf, { useTArray: true });
            const png = new PNG({ width: jd.width, height: jd.height, colorType: 6, bitDepth: 8, inputColorType: 6, inputHasAlpha: true });
            png.data = Buffer.from(jd.data);
            workPath = destPng;
            await new Promise((res, rej) => png.pack().pipe(fse.createWriteStream(workPath)).on("finish", res).on("error", rej));

            // Extract JPEG metadata for loss-minimising re-encoding on export.
            var jmd = parseJpegMetadata(jpgBuf);
            var lumaTable = null;
            for (var ti = 0; ti < jmd.quantizationTables.length; ti++) {
                if (jmd.quantizationTables[ti].id === 0 && jmd.quantizationTables[ti].data.length >= 64) {
                    lumaTable = jmd.quantizationTables[ti].data;
                    break;
                }
            }
            srcMeta = {
                format: "jpeg",
                originalExt: ext === ".jpeg" ? "jpeg" : "jpg",
                estimatedQuality: estimateJpegQuality(lumaTable),
                subsampling: jmd.subsampling,
            };
            if (jd.exifBuffer && jd.exifBuffer.length > 0)
                srcMeta.exifB64 = Buffer.from(jd.exifBuffer).toString("base64");
        } else if (ext === ".bmp" || ext === ".tga" || ext === ".pcx") {
            // Decode via render.js pure-JS codecs, normalize to PNG for OCR.
            var rawBuf = await fse.readFile(imgPath);
            var decoded;
            if (ext === ".bmp") decoded = getRender().readBmp(rawBuf);
            else if (ext === ".tga") decoded = getRender().readTga(rawBuf);
            else decoded = getRender().readPcx(rawBuf);
            var fmtPng = new PNG({ width: decoded.width, height: decoded.height, colorType: 6, bitDepth: 8, inputColorType: 6, inputHasAlpha: true });
            fmtPng.data = decoded.data;
            workPath = destPng;
            await new Promise((res, rej) => fmtPng.pack().pipe(fse.createWriteStream(workPath)).on("finish", res).on("error", rej));
            srcMeta = { format: ext.substring(1), originalExt: ext.substring(1) };
        } else if (ext === ".webp") {
            // Decode via Canvas (Chromium native WebP support).
            var webpBuf = await fse.readFile(imgPath);
            var wpDecoded = await getRender().decodeImageAsync(webpBuf, "image/webp");
            var wpPng = new PNG({ width: wpDecoded.width, height: wpDecoded.height, colorType: 6, bitDepth: 8, inputColorType: 6, inputHasAlpha: true });
            wpPng.data = wpDecoded.data;
            workPath = destPng;
            await new Promise((res, rej) => wpPng.pack().pipe(fse.createWriteStream(workPath)).on("finish", res).on("error", rej));
            srcMeta = { format: "webp", originalExt: "webp" };
        } else {
            await fse.copy(imgPath, destPng);
        }

        // OCR -> box regions
        const regions = await getOCR().ocrImage(workPath, {
            enableVerticalOCR: thisAddon.config.enableVerticalOCR,
            verticalAngleThreshold: thisAddon.config.verticalAngleThreshold,
        });
        // Filter by score threshold (configurable via addon options)
        const threshold = thisAddon.config.scoreThreshold || 0;
        const boxes = {};
        let bi = 0;
        regions.forEach((r) => {
            if (r.score < threshold) return;
            boxes["b" + bi] = {
                text: r.text,
                recognition_score: Number(r.score).toFixed(3),
                top_left: r.top_left, top_right: r.top_right,
                bottom_right: r.bottom_right, bottom_left: r.bottom_left,
            };
            bi++;
        });
        // Optional project filters (SEP options): images with no usable text
        // never become objects. Without a JSON they are not part of the
        // project and are not written on export — encrypt such images (e.g.
        // manually edited ones) with "Encrypt only" on the staging folder.
        var hasText = false, hasJapanese = false;
        for (var bk in boxes) {
            var btxt = String(boxes[bk].text || "");
            if (btxt.trim() !== "") hasText = true;
            if (JP_TEXT_RE.test(btxt)) hasJapanese = true;
        }
        if (!hasText && thisAddon.config.discardNoTextObjects) { discardedNoText++; continue; }
        if (!hasJapanese && thisAddon.config.discardNonJapaneseObjects) { discardedNoJapanese++; continue; }

        // build SEP box JSON: { "<imageRelPath>.png": { "b0": {...} } }
        const jsonPath = nwPath.join(tmpPath, pngRel.slice(0, -4) + ".json");
        var data = { [pngRel]: boxes };
        if (srcMeta) data.srcMeta = srcMeta;
        var encEntry = (manifest && manifest.files) ? manifest.files[pngRel] : null;
        if (manifest && !encEntry && (manifest.engine === "mv" || manifest.engine === "mz")) missingEnc++;
        if (encEntry && encEntry.encrypted && manifest.encryptionKey) {
            data.srcMeta = Object.assign({}, data.srcMeta, {
                encInfo: { keyHex: manifest.encryptionKey, encExt: encEntry.encExt, origPath: encEntry.origPath },
            });
        }
        await common.filePutContents(jsonPath, JSON.stringify(data, null, 4), "utf8", false);
        processed++;
    }
    await ui.log("[SEP] OCR complete: " + processed + " image(s).");
    if (discardedNoText > 0) await ui.log("[SEP] Discarded " + discardedNoText + " image(s) without detected text (project filter).");
    if (discardedNoJapanese > 0) await ui.log("[SEP] Discarded " + discardedNoJapanese + " image(s) without Japanese text (project filter).");
    if (processed === 0 && (discardedNoText + discardedNoJapanese) > 0)
        await ui.log("[SEP] Warning: every image was discarded by the project filters — check the SEP options.");
    if (missingEnc > 0) await ui.log("[SEP] Warning: " + missingEnc + " image(s) have no encryption record — export will write them decrypted. Re-collect the game folder to restore encryption info.");
};

// Read box JSONs from a folder -> SEPObj per file -> translatable rows.
SEPParser.prototype.parse = async function (sourceDir) {
    sourceDir = sourceDir || this.tmpPath;
    var folderList = await common.readDir(sourceDir);
    var files = {};
    for (var i = 0; i < folderList.length; i++) {
        var filePath = folderList[i];
        var relativePath = common.getRelativePath(filePath, sourceDir);
        if (this.processThispath(relativePath) == false) continue;
        if (nwPath.extname(filePath).toLowerCase() !== ".json") continue;

        var content = await common.fileGetContents(filePath);
        if (!common.isJSON(content)) continue;
        var currentData = JSON.parse(content);
        if (empty(currentData)) continue;

        var sepTranslate = new SEPObj(currentData, {
            translationPair: this.translationPair,
            translationInfo: this.options.translationInfo,
            writeMode: this.writeMode,
            beautifyOutput: true,
        });
        if (this.writeMode) sepTranslate.assignTranslationPair(relativePath, this.options.translationDatas);
        await sepTranslate.parse(undefined, relativePath.split("/"));

        files[relativePath] = {
            extension: "json",
            dataType: "json",
            filename: nwPath.basename(filePath, ".json"),
            basename: nwPath.basename(filePath),
            path: relativePath, relPath: relativePath,
            dirname: "/" + nwPath.dirname(relativePath),
            ...sepTranslate.transData,
        };
        if (this.writeMode) files[relativePath].sepTranslate = sepTranslate;
    }
    return files;
};

SEPParser.prototype.toTrans = async function () {
    this.tmpPath = nwPath.join(common.getTempDir(), "slr_sep_" + common.makeid(8));
    await ui.log("[SEP] Running OCR on: " + this.path);
    await this.runOCR(this.tmpPath);

    this.trans = {
        projectId: common.makeid(10),
        cache: {},
        gameEngine: "SEP",
        gameTitle: nwPath.basename(this.path),
        loc: this.path,
        parser: appName,
        parserVersion: thisAddon.package.version,
        files: await this.parse(this.tmpPath),
        sepGame: this.manifest ? { engine: this.manifest.engine, gameRoot: this.manifest.gameRoot } : undefined,
    };
    this.trans.cache = await this.createCache(this.trans.projectId);
    await fse.remove(this.tmpPath);
    return this.trans;
};

SEPParser.prototype.createCache = async function (id) {
    var cacheInfo = { cacheID: id, cachePath: nwPath.join(common.getStagePath(), this.trans.projectId) };
    var cacheData = nwPath.join(cacheInfo.cachePath, "data");
    await common.mkDir(cacheData);
    await common.filePutContents(nwPath.join(cacheInfo.cachePath, "gameInfo.json"),
        JSON.stringify({ Title: this.trans.gameTitle, title: this.trans.gameTitle }), "UTF8");
    // stage PNGs + box JSONs from tmp into the cache
    await fse.copy(this.tmpPath, cacheData, {
        filter: (src) => {
            // Directories always pass (names may contain dots); files must be
            // staged PNGs or OCR box JSONs.
            if (fs.statSync(src).isDirectory()) return true;
            const ext = nwPath.extname(src).toLowerCase();
            return ext === ".png" || ext === ".json";
        },
    });
    await common.filePutContents(nwPath.join(cacheInfo.cachePath, "initial.json"), JSON.stringify(this.trans), "UTF8");
    return cacheInfo;
};

SEPParser.createProject = async function (sourceDir, options = {}) {
    var parser = new SEPParser(sourceDir, options);
    var transData = await parser.toTrans();
    trans.openFromTransObj({ project: transData }, { isNew: true });
};

// ---- export: render translated boxes back onto images ----
async function renderExport(cacheDataDir, targetDir, transData, options, asZip) {
    options = options || {};
    applyGPUSetting();
    options.writeMode = true;
    options.translationDatas = options.translationDatas || trans.getTranslationData(transData, options);

    var tmpPath = nwPath.join(common.getTempDir(), "slr_sep_" + common.makeid(8));
    await fse.ensureDir(tmpPath);
    await fse.emptyDir(tmpPath);

    var parser = new SEPParser(cacheDataDir, options);
    var fileData = await parser.parse(cacheDataDir);

    // write translated box JSONs into tmp
    for (var relPath in fileData) {
        var jsonOut = nwPath.join(tmpPath, relPath);
        await fse.ensureDir(nwPath.dirname(jsonOut));
        await common.filePutContents(jsonOut, fileData[relPath].sepTranslate.toString(), "utf8", false);
    }
    // copy matching source PNGs into tmp (one per JSON)
    var jsonFiles = (await common.readDir(tmpPath)).filter((f) => f.toLowerCase().endsWith(".json"));
    for (var jf of jsonFiles) {
        var jfRel = common.getRelativePath(jf, tmpPath);
        var pngRel2 = jfRel.slice(0, -5) + ".png";
        var srcPng = nwPath.join(cacheDataDir, pngRel2);
        if (await common.isFileAsync(srcPng)) {
            var cpDst = nwPath.join(tmpPath, pngRel2);
            await fse.ensureDir(nwPath.dirname(cpDst));
            await fse.copy(srcPng, cpDst);
        }
    }

    // render each image (erase + draw), re-encoding to the original format (JPEG/BMP)
    var fontPath = getFontPath();
    var pngs = (await common.readDir(tmpPath))
        .filter((f) => f.toLowerCase().endsWith(".png"))
        .map((f) => common.getRelativePath(f, tmpPath));
    var outputFiles = [];
    for (var i = 0; i < pngs.length; i++) {
        var pngRel = pngs[i];
        var pngFullPath = nwPath.join(tmpPath, pngRel);
        var jsonPath2 = nwPath.join(tmpPath, pngRel.slice(0, -4) + ".json");
        ui.loadingProgress(Math.round(i / Math.max(pngs.length, 1) * 100),
            "[SEP] Rendering: " + nwPath.basename(pngRel), { consoleOnly: true, mode: "consoleOutput" });
        var jsonData = {};
        if (await common.isFileAsync(jsonPath2)) {
            try { jsonData = JSON.parse(await common.fileGetContents(jsonPath2)); } catch (e) { jsonData = {}; }
        }
        // Strip srcMeta so applyToImage only sees box data.
        var srcMeta = jsonData.srcMeta || null;
        var boxData = {};
        for (var jk in jsonData) { if (jk !== "srcMeta") boxData[jk] = jsonData[jk]; }

        // Determine output format + filename based on source metadata.
        var renderOpts = {
            fontPath: fontPath,
            fontFamily: "SEPFont",
            border: thisAddon.config.textBorderValue,
            eraseMode: thisAddon.config.eraseMode || "blur",
            skipUnchanged: thisAddon.config.skipUnchanged,
            inpaintDilation: thisAddon.config.inpaintDilation,
            inpaintMargin: thisAddon.config.inpaintMargin,
            modelPath: nwPath.join(modelsDir, "aot_inpainting.onnx"),
            lamaModelPath: nwPath.join(modelsDir, "lama_fp32.onnx"),
            applyBlur: thisAddon.config.applyBlur,
            blurStrength: thisAddon.config.blurStrength,
            angleSnapThreshold: thisAddon.config.angleSnapThreshold,
            angleGroupThreshold: thisAddon.config.angleGroupThreshold,
            verticalAngleSnapThreshold: thisAddon.config.verticalAngleSnapThreshold,
            heightGroupThreshold: thisAddon.config.heightGroupThreshold,
            minFontSize: thisAddon.config.minFontSize,
            detectSolidBackground: thisAddon.config.detectSolidBackground,
            solidColorThreshold: thisAddon.config.solidColorThreshold,
            solidBoxMargin: thisAddon.config.solidBoxMargin,
            autoBoxMargin: thisAddon.config.autoBoxMargin,
            detectTextColor: thisAddon.config.detectTextColor,
            autoTextOutline: thisAddon.config.autoTextOutline,
        };
        var outRel = pngRel;
        if (srcMeta && srcMeta.encInfo) {
            outRel = srcMeta.encInfo.origPath; // e.g. "img/system/Window.rpgmvp"
        } else if (srcMeta && srcMeta.format === "jpeg") {
            renderOpts.outputFormat = "jpeg";
            renderOpts.jpegQuality = srcMeta.estimatedQuality || 92;
            if (srcMeta.exifB64) renderOpts.exifBuffer = Buffer.from(srcMeta.exifB64, "base64");
            var jpegExt = srcMeta.originalExt === "jpeg" ? ".jpeg" : ".jpg";
            outRel = pngRel.slice(0, -4) + jpegExt;
        } else if (srcMeta) {
            renderOpts.outputFormat = srcMeta.format;
            outRel = pngRel.slice(0, -4) + "." + srcMeta.originalExt;
        }

        var outBuf = await getRender().applyToImage(pngFullPath, boxData, renderOpts);
        if (srcMeta && srcMeta.encInfo) {
            // Encrypted game image: besides the re-encrypted original, write a
            // viewable PNG copy under decrypted/ (mirroring the original
            // structure) so the rendered result can be checked without a game.
            var decRel = "decrypted/" + srcMeta.encInfo.origPath.replace(/\.[^./]+$/, "") + ".png";
            var decAbs = nwPath.join(tmpPath, decRel);
            await fse.ensureDir(nwPath.dirname(decAbs));
            await fse.writeFile(decAbs, outBuf);
            outputFiles.push(decRel);
            outBuf = getCrypt().encrypt(outBuf, srcMeta.encInfo.keyHex);
        }
        var outAbs = nwPath.join(tmpPath, outRel);
        await fse.ensureDir(nwPath.dirname(outAbs));
        await fse.writeFile(outAbs, outBuf);
        if (outRel !== pngRel) await fse.remove(pngFullPath);
        outputFiles.push(outRel);
    }

    // Box JSONs are intermediate OCR data — never part of the export (they
    // used to leak into zip exports alongside the rendered images).
    var jsonLeftovers = (await common.readDir(tmpPath)).filter((f) => nwPath.extname(f).toLowerCase() === ".json");
    for (var jlo = 0; jlo < jsonLeftovers.length; jlo++) await fse.remove(jsonLeftovers[jlo]);

    if (asZip) {
        var zipPath = (options.targetPath || "sep.zip").replace(/\.json$/i, ".zip");
        await common.mkDir(nwPath.dirname(zipPath));
        var _7z = require("7zip-min");
        await new Promise((res, rej) => _7z.cmd(["a", "-tzip", zipPath, tmpPath + nwPath.sep + "*"],
            (err) => err ? rej(err) : res()));
        await fse.remove(tmpPath);
        return zipPath;
    } else {
        await common.mkDir(targetDir);
        for (var of_ of outputFiles) {
            var tDst = nwPath.join(targetDir, of_);
            await fse.ensureDir(nwPath.dirname(tDst));
            await fse.copy(nwPath.join(tmpPath, of_), tDst);
        }
        await fse.remove(tmpPath);
        return targetDir;
    }
}

// ============================================================
// New-project UI
// ============================================================
SEPParser.drawNewProject = async function () {
    var $slide = $(`
        <h1><i class="icon-plus-circled"></i>SEP</h1>
        <div class="blockBox infoBlock withIcon">
            <h2>SEP v` + thisAddon.package.version + `</h2>
            <div class="dialogSectionBlock">
                <h2 data-tran="">${t("Select folder")}</h2>
                <div class="info" data-tran="">${t("Select a folder with images, or an RPG Maker game folder (XP/VX/VX Ace, MV, MZ). For games, SEP collects all images (decrypting them if needed) while keeping the game's folder structure, and re-encrypts them on export, adding viewable copies in a decrypted folder. Works fully offline.")}</div>
                <div class="openDir"></div>
                <div class="sepGameInfo" style="margin-top:10px;"></div>
                <div class="sepFileList" style="margin-top:10px;max-height:200px;overflow-y:auto;"></div>
                <div class="sepGameActions" style="margin-top:10px;"></div>
            </div>
        </div>`);
    var $button = $('<input type="dvSelectPath" nwdirectory class="form-control selectDataFolder" name="selectDataFolder" value="" />');
    $slide.find(".openDir").append($button);
    var $gameInfo = $slide.find(".sepGameInfo");
    var $fileList = $slide.find(".sepFileList");
    var $actions = $slide.find(".sepGameActions");

    var state = { mode: "generic", stagingDir: null, manifest: null };
    var stagingDirFor = function (dir) {
        var abs = nwPath.resolve(dir);
        return nwPath.join(nwPath.dirname(abs), nwPath.basename(abs) + "_sep");
    };
    var collectOpts = function (label) {
        label = label || "Collect";
        return {
            logger: function (m) { ui.log("[SEP] " + m); },
            progress: function (pct, name) {
                ui.loadingProgress(pct < 0 ? undefined : pct, "[SEP] " + (pct < 0 ? name : label + ": " + name),
                    { consoleOnly: true, mode: "consoleOutput" });
            },
            rgssDecrypterDir: nwPath.join(common.getRootDir(), "3rdParty", "RgssDecrypter"),
        };
    };

    // Scan for images when a folder is selected
    $button.on("change", async function () {
        var dir = $(this).val();
        var $input = $(this);
        state.mode = "generic";
        state.stagingDir = null;
        state.manifest = null;
        $gameInfo.empty();
        $actions.empty();
        if (!dir || !(await common.isDir(dir))) { $fileList.empty(); return; }
        if ($input.val() !== dir) return;
        $fileList.html('<div style="padding:8px;opacity:0.7;">' + t("Scanning...") + '</div>');
        try {
            var detect = await getGame().detectGame(dir);
            if ($input.val() !== dir) return;

            if (detect.type === "generic") {
                // plain image folder — exactly the old flat scan
                var baseDir = nwPath.resolve(dir);
                var allItems = await common.readDir(dir);
                var images = allItems.filter(function (f) {
                    var ext = nwPath.extname(f).toLowerCase();
                    return [".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tga", ".pcx"].indexOf(ext) !== -1 && nwPath.dirname(f) === baseDir;
                });
                if (images.length === 0) {
                    $fileList.html('<div style="padding:8px;color:#c00;">' + t("No image files (PNG, JPG, JPEG, BMP, WebP, TGA, PCX) found in this folder.") + '</div>');
                } else {
                    var html = '<div style="margin-bottom:6px;font-weight:bold;">' + images.length + " " + t("image(s) detected:") + '</div>';
                    html += '<ul style="list-style:none;padding:0;margin:0;">';
                    images.forEach(function (f) {
                        html += '<li style="padding:2px 8px;border-bottom:1px solid rgba(0,0,0,0.05);">' + common.htmlEntities(nwPath.basename(f)) + '</li>';
                    });
                    html += '</ul>';
                    $fileList.html(html);
                }
                return;
            }

            if (detect.type === "sep-staging") {
                state.mode = "staging";
                var manifest = await getGame().readManifest(dir);
                state.manifest = manifest;
                if ($input.val() !== dir) return;
                var scan = await getGame().scanImages(dir);
                if ($input.val() !== dir) return;
                var left = scan.plain.length + scan.encrypted.length;
                var leftVid = scan.plainVideos.length + scan.encryptedVideos.length;
                $gameInfo.html('<div style="padding:8px;"><b>' + t("SEP staging folder") + '</b> — ' +
                    t("engine") + ': ' + common.htmlEntities(manifest ? manifest.engine : "?") + '<br>' +
                    left + t(" image(s) remaining") + (leftVid > 0 ? ', ' + leftVid + t(" video(s)") : '') + '.<br>' +
                    t('"Start project" runs OCR on the images still present; deleted images are ignored. Export re-encrypts into the original structure and adds viewable copies in a decrypted folder.') +
                    '<br>' + t('"Encrypt only" re-encrypts the images (and encrypted videos) still present into a folder of your choice (e.g. the game folder) without OCR — for manually edited files.') +
                    '</div>');
                if (manifest && (manifest.engine === "mv" || manifest.engine === "mz") &&
                    empty(manifest.files) && left > 0) {
                    $gameInfo.append('<div style="color:#c00;">' +
                        t("Collection was interrupted before it finished: encryption info is missing. Start the project from the game folder again (or use Collect only) to restore it — otherwise exported images will be decrypted PNGs that the game cannot load.") +
                        '</div>');
                }
                if (manifest && (manifest.encryptionKey || manifest.videoEncryptionKey) &&
                    (manifest.engine === "mv" || manifest.engine === "mz")) {
                    $actions.html('<button class="sepEncryptOnly btn btn-default" style="margin-right:8px;">' + t("Encrypt only") + '</button>');
                } else {
                    $actions.empty();
                }
                $fileList.empty();
                return;
            }

            // game folder (mv / mz / rgss / rgss-packed)
            state.mode = "game";
            if (detect.type === "rgss-packed") {
                $gameInfo.html('<div style="padding:8px;"><b>' + t("RPG Maker XP/VX/VX Ace (packed)") + '</b><br>' +
                    t("Archive(s)") + ': ' + common.htmlEntities(detect.archives.join(", ")) + '<br>' +
                    t("Images are extracted from the archive before OCR. Note: export writes the decrypted folder structure — it cannot re-pack the archive.") +
                    '</div>');
                $fileList.empty();
            } else {
                var scan2 = await getGame().scanImages(dir);
                if ($input.val() !== dir) return;
                var vidCount = scan2.plainVideos.length + scan2.encryptedVideos.length;
                $gameInfo.html('<div style="padding:8px;"><b>' + t(detect.label) + '</b><br>' +
                    scan2.plain.length + t(" plain / ") + scan2.encrypted.length + t(" encrypted image(s)") +
                    (vidCount > 0 ? ' / ' + vidCount + t(" video(s)") : '') +
                    (scan2.encrypted.length > 0 ? ' — ' + t("encrypted images are decrypted automatically and re-encrypted on export (viewable copies are added to a decrypted folder)") : '') +
                    (scan2.encryptedVideos.length > 0 ? ' — ' + t("encrypted videos are collected decrypted for manual translation; they are not OCR'd and can be re-encrypted with \"Encrypt only\"") : '') +
                    '<br>' + t('"Start project" collects all of them and runs OCR on every image (not recommended can take ages). Use "Collect only" to collect them in a folder in which you can manually remove images without text before starting.') +
                    '</div>');
                $fileList.empty();
            }
            $actions.html('<button class="sepCollectOnly btn btn-default" style="margin-right:8px;">' + t("Collect only") + '</button>');
        } catch (e) {
            $fileList.html('<div style="padding:8px;color:#c00;">' + common.htmlEntities(e.message) + '</div>');
        }
    });

    // "Collect only" — stage everything, then let the user prune by hand
    $actions.on("click", ".sepCollectOnly", async function () {
        var dir = $button.val();
        if (!dir || state.mode !== "game") return;
        var $btn = $(this);
        $btn.prop("disabled", true);
        ui.showLoading();
        ui.loadingProgress("Processing", "[SEP] Collecting: " + dir, { consoleOnly: false, mode: "consoleOutput" });
        try {
            var result = await getGame().collect(dir, stagingDirFor(dir), collectOpts());
            ui.loadingProgress("Finished", "[SEP] Collected " + (result.counts.plain + result.counts.encrypted) +
                " image(s)" + (result.counts.videos > 0 ? " and " + result.counts.videos + " video(s)" : "") + ".",
                { consoleOnly: false, mode: "consoleOutput" });
            setTimeout(function () { ui.hideLoading(true); }, 500);
            // Switch to staging mode so "Start project" resumes THIS staging
            // folder (respecting the user's pruning) instead of re-collecting
            // the game and restoring pruned files.
            state.mode = "staging";
            state.stagingDir = result.stagingDir;
            state.manifest = result.manifest || null;
            $gameInfo.html('<div style="padding:8px;">' +
                t("Collected") + ' ' + (result.counts.plain + result.counts.encrypted) + ' ' + t("image(s)") +
                ' (' + result.counts.encrypted + ' ' + t("decrypted") +
                (result.counts.videos > 0 ? ', ' + result.counts.videos + ' ' + t("video(s)") : '') +
                (result.counts.skipped > 0 ? ', ' + result.counts.skipped + ' ' + t("skipped") : '') + ').<br>' +
                t("Remove the images without text here — now or later (you can close SLR Translator). Then start a SEP project on this folder:") +
                '<br><b>' + common.htmlEntities(result.stagingDir) + '</b><br>' +
                t("Manually edited images and videos can be re-encrypted from this folder with \"Encrypt only\" — no project needed.") + '</div>');
            $actions.html('<button class="sepOpenStaging btn btn-default" style="margin-right:8px;">' + t("Open staging folder") + '</button>' +
                (result.manifest && (result.manifest.encryptionKey || result.manifest.videoEncryptionKey)
                    ? '<button class="sepEncryptOnly btn btn-default" style="margin-right:8px;">' + t("Encrypt only") + '</button>'
                    : ''));
            $actions.find(".sepOpenStaging").on("click", function () {
                try { nw.Shell.openItem(result.stagingDir); } catch (e) { console.warn(e); }
            });
            $fileList.empty();
        } catch (e) {
            var msg = (e && e.message) ? e.message : String(e);
            ui.loadingProgress("Error!", "[SEP] " + msg, { consoleOnly: false, mode: "consoleOutput", classStr: "stderr" });
            ui.showCloseButton();
            $gameInfo.html('<div style="padding:8px;color:#c00;">' + common.htmlEntities(msg) + '</div>');
            $btn.prop("disabled", false);
        }
    });

    // "Encrypt only" — re-encrypt the images of a staging folder into a
    // chosen folder (picker defaults to the recorded game folder) without
    // OCR/translation. For manually edited images; also covers images with
    // no detected text that the project filters (SEP options) left out.
    $actions.on("click", ".sepEncryptOnly", async function () {
        // Prefer the remembered staging dir: after "Collect only" the path
        // input still holds the game folder, not the staging folder.
        var dir = state.stagingDir || $button.val();
        if (!dir || state.mode !== "staging") return;
        var manifest = state.manifest;
        if (!manifest || (!manifest.encryptionKey && !manifest.videoEncryptionKey)) return;
        try {
            (ui.dvField || new DVField()).fileSelector({
                dir: true,
                default: manifest.gameRoot || "",
                onSelect: async function (targetDir) {
                    if (!targetDir) return;
                    ui.showLoading();
                    ui.loadingProgress("Processing", "[SEP] Encrypting into: " + targetDir, { consoleOnly: false, mode: "consoleOutput" });
                    try {
                        var result = await getGame().encryptStaging(dir, targetDir, collectOpts("Encrypt"));
                        ui.loadingProgress("Finished", "[SEP] Encrypted " + result.counts.encrypted + " image(s)" +
                            (result.counts.videos > 0 ? " and " + result.counts.videos + " video(s)" : "") +
                            ((result.counts.missing + result.counts.skipped) > 0
                                ? " (" + result.counts.missing + " " + t("missing") + ", " + result.counts.skipped + " " + t("skipped") + ")"
                                : "") + ".", { consoleOnly: false, mode: "consoleOutput" });
                        setTimeout(function () { ui.hideLoading(true); }, 500);
                    } catch (e) {
                        var msg = (e && e.message) ? e.message : String(e);
                        ui.loadingProgress("Error!", "[SEP] " + msg, { consoleOnly: false, mode: "consoleOutput", classStr: "stderr" });
                        ui.showCloseButton();
                    }
                }
            });
        } catch (e) {
            console.warn(e);
        }
    });

    ui.newProjectDialog.addMenu({
        icon: thisAddon.getWebLocation() + "/icon.png",
        descriptionBar: `<h2>SEP</h2><p>${t("Start a new translation project from pictures (PNG/JPG/BMP/WebP/TGA/PCX) or an RPG Maker game folder. Encrypted videos (rwebm) are collected decrypted alongside the images for manual translation and can be re-encrypted with \"Encrypt only\".")}<br />${t("On-device OCR extracts the text — fully offline, no Python.")}</p>`,
        actionBar: "",
        goToSlide: "SEPTranslate",
        at: 3,
        slides: {
            SEPTranslate: ui.newProjectDialog.newSlide("SEPTranslate", $slide, {
                buttons: [{
                    text: t("Start project"),
                    click: async function () {
                        var sourceDir = $button.val();
                        if (await common.isDir(sourceDir) == false) return alert(t("Invalid directory:\n" + sourceDir));
                        ui.showLoading();
                        await ui.newProjectDialog.close();
                        await common.wait(300);
                        try {
                            if (state.mode === "game") {
                                ui.loadingProgress("Processing", "[SEP] Collecting game images: " + sourceDir, { consoleOnly: false, mode: "consoleOutput" });
                                var result = await getGame().collect(sourceDir, stagingDirFor(sourceDir), collectOpts());
                                sourceDir = result.stagingDir;
                            } else if (state.mode === "staging" && state.stagingDir) {
                                // resuming a staging folder created by "Collect only"
                                sourceDir = state.stagingDir;
                            }
                            ui.loadingProgress("Processing", "[SEP] Creating project: " + sourceDir, { consoleOnly: false, mode: "consoleOutput" });
                            await SEPParser.createProject(sourceDir);
                            ui.loadingProgress("Finished", "All process finished!", { consoleOnly: false, mode: "consoleOutput" });
                            setTimeout(function () { ui.hideLoading(true); }, 800);
                        } catch (e) {
                            var msg = (e && e.message) ? e.message : String(e);
                            ui.loadingProgress("Error!", "[SEP] " + msg, { consoleOnly: false, mode: "consoleOutput", classStr: "stderr" });
                            ui.showCloseButton();
                        }
                    },
                }],
            }),
        },
    });
};

// ============================================================
// init / handler registration
// ============================================================
var supportedEngines = ["SEP"];

function injectRawPreviewCss() {
    if ($("style#sepRawPreviewCss").length) return;
    $("head").append(`
    <style id="sepRawPreviewCss">
        #previewRawData .sepRawPreview { padding: 8px; }
        #previewRawData .sepImgWrap {
            position: relative; display: inline-block; line-height: 0;
            max-width: 100%; vertical-align: top;
        }
        #previewRawData .sepPreviewImg {
            display: block; max-width: 100%; height: auto;
            border: 1px solid #ccc; background: #fff;
        }
        #previewRawData .sepHighlightOverlay {
            position: absolute; left: 0; top: 0;
            width: 100%; height: 100%; pointer-events: none;
        }
        /* Night mode: html is inverted(92%). Counter-invert the image (and its
           highlight overlay) so the preview reads as roughly the true colors
           and the red highlight stays reddish. */
        .nightMode #previewRawData .sepPreviewImg,
        .nightMode #previewRawData .sepHighlightOverlay { filter: invert(100%); }
        .nightMode #previewRawData .sepPreviewImg { background: #000; border-color: #444; }
    </style>`);
}

function init() {
    injectRawPreviewCss();
    SEPParser.drawNewProject();

    // Raw tab preview: show the source image a box was OCR'd from, with the
    // detected quadrilateral highlighted. `this` is the RawViewer instance.
    engines.addHandler(supportedEngines, "onLoadSnippet", async function (selectedCell) {
        var rv = this;
        var obj = trans.getSelectedObject();
        if (!obj || !Array.isArray(obj.context)) { rv.clear(); return; }
        var ctxArr = obj.context[selectedCell.fromRow];
        if (!ctxArr || (Array.isArray(ctxArr) && ctxArr.length === 0)) { rv.clear(); return; }

        // Context entries are "/"-joined: "<jsonRelPath>/<imageRelKey>/<boxId>/OCR Score: x".
        // The json path and the image key may themselves contain slashes, so
        // reconstruct them from token runs instead of taking single tokens.
        var ctxStr = Array.isArray(ctxArr) ? ctxArr[0] : String(ctxArr);
        var toks = String(ctxStr).split("/");
        var jsonEnd = -1, imgEnd = -1;
        for (var i = 0; i < toks.length; i++) {
            if (jsonEnd < 0) {
                if (/\.json$/i.test(toks[i])) jsonEnd = i;
                continue;
            }
            if (imgEnd < 0 && /\.(png|jpe?g)$/i.test(toks[i])) { imgEnd = i; break; }
        }
        if (jsonEnd < 0 || imgEnd < 0) { rv.clear(); return; }
        var jsonName = toks.slice(0, jsonEnd + 1).join("/");
        var imageKey = toks.slice(jsonEnd + 1, imgEnd + 1).join("/");
        var boxKey = toks.length > imgEnd + 1 ? toks[imgEnd + 1] : null;

        // Cache data dir holds the normalized PNG + the OCR box JSON.
        var cacheDataDir = null;
        try {
            if (trans.project && trans.project.cache && trans.project.cache.cachePath)
                cacheDataDir = nwPath.join(trans.project.cache.cachePath, "data");
        } catch (e) { cacheDataDir = null; }

        // Locate the source image: staged PNG first, then original folder.
        var imgPath = null;
        if (cacheDataDir) {
            var p = nwPath.join(cacheDataDir, imageKey);
            if (await common.isFileAsync(p)) imgPath = p;
        }
        if (!imgPath && trans.project && trans.project.loc) {
            var baseName = nwPath.basename(imageKey, nwPath.extname(imageKey));
            var candidates = [imageKey, baseName + ".png", baseName + ".jpg", baseName + ".jpeg", baseName + ".bmp", baseName + ".webp", baseName + ".tga", baseName + ".pcx"];
            for (var ci = 0; ci < candidates.length; ci++) {
                var cp = nwPath.join(trans.project.loc, candidates[ci]);
                if (await common.isFileAsync(cp)) { imgPath = cp; break; }
            }
        }
        if (!imgPath) {
            rv.clear();
            rv.append('<div class="rawViewerMsg">Source image not found for: ' + common.htmlEntities(imageKey) + "</div>");
            return;
        }

        // Read the OCR box (corner coordinates) from the staged JSON, if present.
        var box = null;
        if (cacheDataDir && jsonName) {
            var jsonPath = nwPath.join(cacheDataDir, jsonName);
            if (await common.isFileAsync(jsonPath)) {
                try {
                    var jsonData = JSON.parse(await common.fileGetContents(jsonPath));
                    var imgBoxes = jsonData[imageKey] || jsonData;
                    if (imgBoxes && boxKey && imgBoxes[boxKey]) box = imgBoxes[boxKey];
                } catch (e) { box = null; }
            }
        }

        rv.clear();
        var $wrapper = $('<div class="sepRawPreview"></div>');
        var pathLabel = imageKey + (boxKey ? "  \u203a  " + boxKey : "");
        $wrapper.append(
            '<div class="snippetInfo flex"><span class="snippetPath">'
            + common.htmlEntities(pathLabel)
            + '</span>'
            + (box && box.recognition_score != null ? '<span class="lineNumber">OCR: ' + box.recognition_score + '</span>' : '')
            + '</div>'
        );

        var $imgWrap = $('<div class="sepImgWrap"></div>');
        var $img = $('<img class="sepPreviewImg" alt="" />');
        var $overlay = $('<canvas class="sepHighlightOverlay"></canvas>');
        $imgWrap.append($img).append($overlay);
        $wrapper.append($imgWrap);
        rv.append($wrapper);

        // Load image via a blob URL (cross-platform, no file:// scheme).
        var buf;
        try {
            buf = await fse.readFile(imgPath);
        } catch (e) {
            rv.clear();
            rv.append('<div class="rawViewerMsg">Unable to read image: ' + common.htmlEntities(imageKey) + "</div>");
            return;
        }
        var mime = /\.jpe?g$/i.test(imgPath) ? "image/jpeg" : "image/png";
        var blobUrl = window.URL.createObjectURL(new Blob([buf], { type: mime }));

        var drawHighlight = function () {
            var natW = $img[0].naturalWidth, natH = $img[0].naturalHeight;
            if (!natW) return;
            // Match the overlay's backing store to the image's rendered size
            // (capped to display dimensions) so 8K sources stay cheap.
            var dispW = $img[0].clientWidth || natW;
            var dispH = Math.round(dispW * (natH / natW));
            dispW = Math.round(dispW);
            var can = $overlay[0];
            can.width = Math.max(1, dispW);
            can.height = Math.max(1, dispH);
            var octx = can.getContext("2d");
            octx.clearRect(0, 0, can.width, can.height);
            if (!box || !box.top_left || !box.bottom_right) return;
            var sx = can.width / natW, sy = can.height / natH;
            var pts = [box.top_left, box.top_right, box.bottom_right, box.bottom_left];
            octx.beginPath();
            octx.moveTo(pts[0][0] * sx, pts[0][1] * sy);
            for (var pi = 1; pi < pts.length; pi++) octx.lineTo(pts[pi][0] * sx, pts[pi][1] * sy);
            octx.closePath();
            octx.fillStyle = "rgba(255,70,70,0.28)";
            octx.fill();
            octx.lineWidth = Math.max(1.5, can.width / 600);
            octx.strokeStyle = "rgba(255,45,45,0.95)";
            octx.stroke();
        };

        $img.on("load", function () {
            drawHighlight();
            if (blobUrl) { window.URL.revokeObjectURL(blobUrl); }
        });
        $img.on("error", function () {
            if (blobUrl) { window.URL.revokeObjectURL(blobUrl); }
            $imgWrap.empty().append('<div class="rawViewerMsg">Unable to display image: ' + common.htmlEntities(imageKey) + "</div>");
        });

        // Redraw the highlight when the layout changes (window/panel resize).
        $(window).off("resize.sepRawPreview");
        $(window).on("resize.sepRawPreview", function () { drawHighlight(); });

        $img.attr("src", blobUrl);
    });

    engines.addHandler(supportedEngines, "exportHandler", async function (targetPath, options) {
        if (options.mode !== "dir" && options.mode !== "zip") return false;
        ui.showLoading();
        ui.loadingProgress("Processing", "[SEP] Export: " + targetPath, { consoleOnly: false, mode: "consoleOutput" });
        var transData = trans.getSaveData();
        var cacheDataDir = nwPath.join(transData.project.cache.cachePath, "data");
        options.translationDatas = trans.getTranslationData(undefined, options);
        try {
            if (options.mode == "dir") {
                await renderExport(cacheDataDir, targetPath, transData, options, false);
            } else {
                options.targetPath = targetPath;
                await renderExport(cacheDataDir, targetPath, transData, options, true);
            }
            ui.loadingProgress("Finished", "All process finished!", { consoleOnly: false, mode: "consoleOutput" });
            setTimeout(function () { ui.hideLoading(true); ui.closeExportDialog(); }, 800);
        } catch (e) {
            var msg = (e && e.message) ? e.message : String(e);
            ui.loadingProgress("Error!", "[SEP] " + msg, { consoleOnly: false, mode: "consoleOutput", classStr: "stderr" });
            ui.showCloseButton();
        }
        return common.halt();
    });
}

$(document).ready(function () {
    ui.onReady(function () {
        init();
    });
});

thisAddon.SEPObj = SEPObj;
thisAddon.SEPParser = SEPParser;
