"use strict";
/*
 * render.js — SEP text erasure (blur) + translation drawing.
 *
 * Rewritten to use Canvas 2D API instead of sharp. Canvas is available in
 * NW.js's mixed context and provides hardware-accelerated blur, text
 * rendering via opentype.js path.draw(ctx), and compositing — all without
 * any native Node modules.
 *
 * Phase 1 (blur): ctx.filter = 'blur(Npx)' to erase detected text regions.
 * Phase 2 (draw): opentype.js glyph paths drawn directly on the canvas.
 *
 * Input box JSON is SEP's PaddleOCR format:
 *   { "<imageBasename>": { "<boxId>": {
 *       text, top_left:[x,y], top_right:[x,y], bottom_right:[x,y], bottom_left:[x,y],
 *       angle_top?, angle_bottom?, color_override?, font_size_override?,
 *       erase_mode_override?, force_draw_override?, _changed?
 *   } } }
 *   During export SEP.js sets "_changed" (bool): false when the translation is
 *   identical to the original OCR text. buildBoxes() then skips such boxes so the
 *   already-correct text is left untouched (no erase, no redraw). A d{} override
 *   (or force_draw_override) forces the redraw anyway.
 *
 * Text-suffix override commands (parsed from the end of each box's text):
 *   c{r,g,b}|c{named}  - force draw color (e.g. c{255,0,0}, c{white})
 *   f{size}            - force font size in px  (e.g. f{18})
 *   r{mode}            - force erase mode for this box: none|blur|aot|lama
 *                        (also accepts "inpaint" → aot). The equivalent JSON
 *                        field is "erase_mode_override". Per-box override wins
 *                        over the global eraseMode option.
 *   d{}|d{force}       - force this box to be erased and redrawn even when the
 *                        translation is identical to the original OCR text (which
 *                        is otherwise left untouched). Accepts empty content or
 *                        1/true/yes/on/force/always. Equivalent JSON field:
 *                        "force_draw_override" (boolean true).
 */

var opentype = require("opentype.js");
var fs = require("fs");
var PNG = require("pngjs").PNG;

var _inpaint = null;
function getInpaint() {
    if (!_inpaint) _inpaint = require("./inpaint.js");
    return _inpaint;
}

var _fonts = {};

function registerFont(fontPath, family) {
    if (_fonts[family]) return;
    var buf = fs.readFileSync(fontPath);
    _fonts[family] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function getFont(family) {
    return _fonts[family] || Object.values(_fonts)[0];
}

function getCapHeightFU(font) {
    if (font._sepCapHeightFU != null) return font._sepCapHeightFU;
    var g = font.charToGlyph("H");
    font._sepCapHeightFU = (g && g.yMax) ? g.yMax : Math.round(font.ascender * 0.7);
    return font._sepCapHeightFU;
}

function measureText(text, font, size) {
    var width = font.getAdvanceWidth(text, size);
    var emHeight = (font.ascender - font.descender) * size / font.unitsPerEm;
    var ascent = font.ascender * size / font.unitsPerEm;
    var capHeight = getCapHeightFU(font) * size / font.unitsPerEm;
    return { width: width, height: emHeight, ascent: ascent, capHeight: capHeight };
}

var NAMED_COLORS = {
    red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255],
    yellow: [255, 255, 0], cyan: [0, 255, 255], magenta: [255, 0, 255],
    black: [0, 0, 0], white: [255, 255, 255],
};

// Rec.601 luminance in [0,1] — used for text/background contrast decisions.
function luminance01(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

var VALID_ERASE_MODES = ["none", "blur", "aot", "lama"];

// TEMPORARY diagnostics for the solid/text-color features + LaMa parameters.
// Set to false (or delete the SEP-DIAG blocks) once issues are resolved.
var SEPDIAG = true;

// Matches one trailing override command token: <letter>{<content>} where
// content contains no braces, with optional separating whitespace before it.
// Anchored at the end so commands only apply as a suffix. Repeated stripping
// lets c{}/f{}/r{} coexist in any order without one swallowing another.
var TRAILING_CMD_RE = /\s*([cfdr])\{([^{}]*)\}$/;

function parseCommands(rawText) {
    // Only trim trailing whitespace — leading spaces and ideographic spaces
    // (U+3000) are preserved so users can deliberately shift text right.
    var cleaned = String(rawText).replace(/[\s\u3000]+$/, "");
    var colorOverride = null;
    var fontSizeOverride = null;
    var eraseOverride = null;
    var forceDraw = false;
    while (true) {
        var m = cleaned.match(TRAILING_CMD_RE);
        if (!m) break;
        var letter = m[1];
        var content = m[2];
        var consumed = false;
        if (letter === "c") {
            if (content.includes(",")) {
                var rgbParts = content.split(",").map(function (s) { return parseInt(s.trim(), 10); });
                if (rgbParts.length === 3 && rgbParts.every(function (x) { return !isNaN(x) && x >= 0 && x <= 255; })) {
                    colorOverride = rgbParts; consumed = true;
                }
            } else {
                var named = NAMED_COLORS[content.toLowerCase().trim()];
                if (named) { colorOverride = named; consumed = true; }
            }
        } else if (letter === "f") {
            var size = parseInt(content.trim(), 10);
            if (!isNaN(size) && size >= 6 && size <= 200) { fontSizeOverride = size; consumed = true; }
        } else if (letter === "r") {
            var eraseStr = content.trim().toLowerCase();
            if (eraseStr === "inpaint") eraseStr = "aot";
            if (VALID_ERASE_MODES.indexOf(eraseStr) !== -1) { eraseOverride = eraseStr; consumed = true; }
        } else if (letter === "d") {
            // Force this box to be erased + redrawn even when the translation
            // equals the original OCR text. Any of the truthy tokens (or empty)
            // enables it; anything else is left as literal text.
            var drawStr = content.trim().toLowerCase();
            if (drawStr === "" || drawStr === "1" || drawStr === "true" || drawStr === "yes" ||
                drawStr === "on" || drawStr === "force" || drawStr === "always") {
                forceDraw = true; consumed = true;
            }
        }
        if (!consumed) break;
        cleaned = cleaned.slice(0, cleaned.length - m[0].length).replace(/[\s\u3000]+$/, "");
    }
    return { cleaned: cleaned, colorOverride: colorOverride, fontSizeOverride: fontSizeOverride, eraseOverride: eraseOverride, forceDraw: forceDraw };
}

function groupBoxesByHeight(boxes, threshold) {
    if (!boxes.length) return {};
    threshold = threshold != null ? threshold : 0.20;
    var sorted = boxes.slice().sort(function (a, b) { return a.height - b.height; });
    var clusters = [[sorted[0]]];
    for (var i = 1; i < sorted.length; i++) {
        if (sorted[i].height === clusters[clusters.length - 1][0].height)
            clusters[clusters.length - 1].push(sorted[i]);
        else clusters.push([sorted[i]]);
    }
    var merged = [];
    var i = 0;
    while (i < clusters.length) {
        var group = clusters[i].slice();
        var groupHeight = clusters[i][0].height;
        var j = i + 1;
        while (j < clusters.length && Math.abs(clusters[j][0].height - groupHeight) <= groupHeight * threshold) {
            group = group.concat(clusters[j]); j++;
        }
        merged.push(group); i = j;
    }
    var groups = {};
    for (var g = 0; g < merged.length; g++)
        groups[merged[g].reduce(function (s, b) { return s + b.height; }, 0) / merged[g].length] = merged[g];
    return groups;
}

// Group boxes by similar angle. Returns array of groups (arrays of boxes).
// Each box gets its _angle set to the group's resolved angle.
//
// Horizontal text (angle ≈ 0°): snapped to 0° within `snapThresh`, then
// clustered + averaged exactly as before — unchanged behaviour for the common
// horizontal case.
//
// Vertical text (angle ≈ ±90°): snapped to exactly vertical within
// `vSnapThresh` (removes the slight tilt the detector leaves on tategaki
// columns). The SIGN of a near-vertical angle is unstable: detection noise
// flips a column across the ±90° fold, so two columns of the same block can
// land at +90° and -90°. As signed angles those differ by 180°, so without
// correction one line renders upside-down relative to the rest. All
// snapped-vertical boxes are therefore merged into one group and given a single
// consistent sign (majority vote), so every column in a block faces the same way.
function groupBoxesByAngle(boxes, snapThresh, groupThresh, vSnapThresh) {
    if (!boxes.length) return [boxes];
    if (snapThresh == null) snapThresh = 3.0;
    if (groupThresh == null) groupThresh = 5.0;
    if (vSnapThresh == null) vSnapThresh = snapThresh;

    var horiz = [], vert = [];
    for (var i = 0; i < boxes.length; i++) {
        var a = boxAngle(boxes[i], null);             // degrees in [-90, 90]
        if (Math.abs(a) < snapThresh) {
            a = 0;
        } else if (vSnapThresh > 0 && (90 - Math.abs(a)) <= vSnapThresh) {
            a = a >= 0 ? 90 : -90;                    // snap near-vertical to vertical
        }
        boxes[i]._angle = a;
        if (a === 90 || a === -90) vert.push(boxes[i]);
        else horiz.push(boxes[i]);
    }

    var groups = [];

    // --- horizontal / tilted: original signed-angle clustering + averaging ---
    if (horiz.length) {
        var sorted = horiz.slice().sort(function (a, b) { return a._angle - b._angle; });
        var hg = [[sorted[0]]];
        for (var i = 1; i < sorted.length; i++) {
            var lastG = hg[hg.length - 1];
            var avg = lastG.reduce(function (s, b) { return s + b._angle; }, 0) / lastG.length;
            if (Math.abs(sorted[i]._angle - avg) <= groupThresh) lastG.push(sorted[i]);
            else hg.push([sorted[i]]);
        }
        for (var gi = 0; gi < hg.length; gi++) {
            var ga = hg[gi].reduce(function (s, b) { return s + b._angle; }, 0) / hg[gi].length;
            for (var bi = 0; bi < hg[gi].length; bi++) hg[gi][bi]._angle = ga;
            groups.push(hg[gi]);
        }
    }

    // --- vertical: one consistent sign for all columns in the image ---
    if (vert.length) {
        var pos = 0, neg = 0;
        for (var vi = 0; vi < vert.length; vi++) { if (vert[vi]._angle > 0) pos++; else neg++; }
        var vAngle = pos >= neg ? 90 : -90;
        for (var vj = 0; vj < vert.length; vj++) vert[vj]._angle = vAngle;
        groups.push(vert);
    }

    return groups;
}

function calculateGroupFontSize(groupBoxes, font, minFontSize) {
    // Coerce to a number — SLR's option binding can deliver strings for number
    // fields, which would break the binary search (string "+" concatenates).
    // Enforce a sane floor: 0/missing/negative would yield unreadable 1-3px
    // text, so default those to 12.
    minFontSize = Number(minFontSize);
    if (!(minFontSize >= 1)) minFontSize = 12;
    if (!groupBoxes.length) return minFontSize;
    var smallestFS = 200;
    for (var i = 0; i < groupBoxes.length; i++) {
        var text = parseCommands(groupBoxes[i].text).cleaned;
        if (!text) continue;  // erase-only box (draws nothing) -> must not shrink the group's font
        var maxWidth = groupBoxes[i].width, maxHeight = groupBoxes[i].height;
        var low = minFontSize, high = 200, best = minFontSize;
        while (low <= high) {
            var mid = (low + high) >> 1;
            var m = measureText(text, font, mid);
            if (m.width <= maxWidth && m.capHeight <= maxHeight * 1.1) { best = mid; low = mid + 1; }
            else high = mid - 1;
        }
        if (best < smallestFS) smallestFS = best;
    }
    return smallestFS !== 200 ? smallestFS : minFontSize;
}

function processBox(boxData) {
    if (typeof boxData !== "object" || boxData === null) return null;
    // A missing/empty text field is skipped, but whitespace-only text (e.g.
    // " ") and command-only text (e.g. "d{}") are kept: they mean "erase the
    // original and draw nothing". The resulting message may be empty — the
    // draw phase skips empty messages, while the erase phases (solid fill /
    // blur / inpaint) still erase the box.
    if (!boxData.text) return null;
    var colorOverride = boxData.color_override != null ? boxData.color_override : null;
    var fontSizeOverride = boxData.font_size_override != null ? boxData.font_size_override : null;
    var eraseOverride = boxData.erase_mode_override != null ? String(boxData.erase_mode_override).toLowerCase() : null;
    if (eraseOverride === "inpaint") eraseOverride = "aot";
    if (eraseOverride != null && VALID_ERASE_MODES.indexOf(eraseOverride) === -1) eraseOverride = null;
    var forceDraw = boxData.force_draw_override === true;
    var message;
    if (colorOverride === null || fontSizeOverride === null || eraseOverride === null || !forceDraw) {
        var p = parseCommands(boxData.text);
        message = p.cleaned;
        if (colorOverride === null) colorOverride = p.colorOverride;
        if (fontSizeOverride === null) fontSizeOverride = p.fontSizeOverride;
        if (eraseOverride === null) eraseOverride = p.eraseOverride;
        if (!forceDraw) forceDraw = p.forceDraw;
    } else {
        message = parseCommands(boxData.text).cleaned;
    }
    // message may be empty (whitespace/command-only text) — that is a valid
    // "erase only" box, so it is not rejected here.
    return {
        message: message,
        x1: boxData.top_left[0], y1: boxData.top_left[1],
        x2: boxData.top_right[0], y2: boxData.top_right[1],
        x3: boxData.bottom_right[0], y3: boxData.bottom_right[1],
        x4: boxData.bottom_left[0], y4: boxData.bottom_left[1],
        colorOverride: colorOverride, fontSizeOverride: fontSizeOverride,
        eraseOverride: eraseOverride, forceDraw: forceDraw,
    };
}

function buildBoxes(imageBoxes, opts) {
    opts = opts || {};
    // Global "skip identical text" toggle. Defaults on (undefined !== false).
    var skipUnchanged = opts.skipUnchanged !== false;
    var boxes = [];
    var vals = Object.values(imageBoxes);
    for (var i = 0; i < vals.length; i++) {
        var boxData = vals[i];
        var r = processBox(boxData);
        if (!r) continue;
        // Skip boxes whose translation is identical to the original OCR text
        // (SEP.js marks these "_changed": false) so the already-correct text is
        // left untouched — no erase, no redraw. Bypassed when the global
        // "skipUnchanged" toggle is off, or when a d{...} override (or the
        // force_draw_override JSON field) forces the redraw.
        if (skipUnchanged && boxData._changed === false && !r.forceDraw) continue;
        // Actual edge lengths (Euclidean distance, not axis-aligned projections)
        var dxTop = r.x2 - r.x1, dyTop = r.y2 - r.y1;
        var width = Math.sqrt(dxTop * dxTop + dyTop * dyTop);
        var dxR = r.x3 - r.x2, dyR = r.y3 - r.y2;
        var height = Math.sqrt(dxR * dxR + dyR * dyR);
        // Center of the box (average of 4 corners)
        var cx = (r.x1 + r.x2 + r.x3 + r.x4) / 4;
        var cy = (r.y1 + r.y2 + r.y3 + r.y4) / 4;
        boxes.push({
            text: boxData.text, width: width, height: height,
            cx: cx, cy: cy, x1: r.x1, y1: r.y1,
            originalCoords: [r.x1, r.y1, r.x2, r.y2, r.x3, r.y3, r.x4, r.y4],
            colorOverride: r.colorOverride, fontSizeOverride: r.fontSizeOverride,
            eraseOverride: r.eraseOverride, raw: boxData,
        });
    }
    return boxes;
}

function angleFromGeometry(x1, y1, x2, y2, x3, y3, x4, y4) {
    var lmx = (x1 + x4) / 2, lmy = (y1 + y4) / 2;
    var rmx = (x2 + x3) / 2, rmy = (y2 + y3) / 2;
    var deg = Math.atan2(rmy - lmy, rmx - lmx) * 180 / Math.PI;
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
    return deg;
}

function boxAngle(box, imageBoxes) {
    var oc = box.originalCoords;
    return angleFromGeometry(oc[0], oc[1], oc[2], oc[3], oc[4], oc[5], oc[6], oc[7]);
}

// ---- Phase 1: blur-erase via box blur on raw pixels ----
// Custom separable box blur (reliable across browsers; CSS ctx.filter on
// drawImage is inconsistent in Chromium 89). Multiple passes approximate
// Gaussian blur — strong enough to obliterate text, preserves background texture.
function boxBlurH(data, w, h, r) {
    var tmp = new Uint8ClampedArray(data.length);
    var div = r * 2 + 1;
    for (var y = 0; y < h; y++) {
        var rs = 0, gs = 0, bs = 0;
        for (var x = -r; x <= r; x++) {
            var xx = Math.max(0, Math.min(w - 1, x));
            var idx = (y * w + xx) * 4;
            rs += data[idx]; gs += data[idx + 1]; bs += data[idx + 2];
        }
        var row = y * w;
        for (var x = 0; x < w; x++) {
            var oi = (row + x) * 4;
            tmp[oi] = rs / div; tmp[oi + 1] = gs / div; tmp[oi + 2] = bs / div; tmp[oi + 3] = 255;
            var xOut = Math.max(0, Math.min(w - 1, x - r));
            var xIn = Math.max(0, Math.min(w - 1, x + r + 1));
            var iOut = (row + xOut) * 4, iIn = (row + xIn) * 4;
            rs += data[iIn] - data[iOut];
            gs += data[iIn + 1] - data[iOut + 1];
            bs += data[iIn + 2] - data[iOut + 2];
        }
    }
    data.set(tmp);
}

function boxBlurV(data, w, h, r) {
    var tmp = new Uint8ClampedArray(data.length);
    var div = r * 2 + 1;
    for (var x = 0; x < w; x++) {
        var rs = 0, gs = 0, bs = 0;
        for (var y = -r; y <= r; y++) {
            var yy = Math.max(0, Math.min(h - 1, y));
            var idx = (yy * w + x) * 4;
            rs += data[idx]; gs += data[idx + 1]; bs += data[idx + 2];
        }
        for (var y = 0; y < h; y++) {
            var oi = (y * w + x) * 4;
            tmp[oi] = rs / div; tmp[oi + 1] = gs / div; tmp[oi + 2] = bs / div; tmp[oi + 3] = 255;
            var yOut = Math.max(0, Math.min(h - 1, y - r));
            var yIn = Math.max(0, Math.min(h - 1, y + r + 1));
            var iOut = (yOut * w + x) * 4, iIn = (yIn * w + x) * 4;
            rs += data[iIn] - data[iOut];
            gs += data[iIn + 1] - data[iOut + 1];
            bs += data[iIn + 2] - data[iOut + 2];
        }
    }
    data.set(tmp);
}

function blurPhase(ctx, boxes, imageBoxes, strength) {
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        // Erase every box in the group, including erase-only boxes whose
        // message is empty (e.g. " " / "d{}") — they must still be blurred.
        var BoxWidth = Math.max(box.width, 12);
        var BoxHeight = Math.max(box.height, 12);
        // Use grouped angle when available, fall back to per-box geometry
        var angleDeg = box._angle != null ? box._angle : boxAngle(box, imageBoxes);
        var shouldRotate = Math.abs(angleDeg) > 1;

        var pad = Math.max(BoxHeight * 0.3, 3);
        var r = Math.max(Math.round(BoxHeight * strength), 1);

        if (shouldRotate) {
            // Rotate source region to horizontal, blur, rotate back.
            var oc = box.originalCoords;
            var tlx = oc[0], tly = oc[1];
            var angle = angleDeg * Math.PI / 180;
            var tempW = Math.ceil(BoxWidth + pad * 2);
            var tempH = Math.ceil(BoxHeight + pad * 2);
            var tmp = document.createElement("canvas");
            tmp.width = tempW; tmp.height = tempH;
            var tmpCtx = tmp.getContext("2d");

            // Draw source onto temp, rotated so text is axis-aligned
            tmpCtx.translate(pad, pad);
            tmpCtx.rotate(-angle);
            tmpCtx.translate(-tlx, -tly);
            tmpCtx.drawImage(ctx.canvas, 0, 0);

            // Box blur on the axis-aligned temp
            var imgData = tmpCtx.getImageData(0, 0, tempW, tempH);
            boxBlurH(imgData.data, tempW, tempH, r);
            boxBlurV(imgData.data, tempW, tempH, r);
            boxBlurH(imgData.data, tempW, tempH, r);
            boxBlurV(imgData.data, tempW, tempH, r);
            tmpCtx.putImageData(imgData, 0, 0);

            // Draw blurred temp back onto source, inverse rotation
            ctx.save();
            ctx.translate(tlx, tly);
            ctx.rotate(angle);
            ctx.translate(-pad, -pad);
            ctx.drawImage(tmp, 0, 0);
            ctx.restore();
        } else {
            // Horizontal text — blur in place
            var W = ctx.canvas.width, H = ctx.canvas.height;
            var bL = Math.max(0, (box.cx - BoxWidth / 2 - pad) | 0);
            var bT = Math.max(0, (box.cy - BoxHeight / 2 - pad) | 0);
            var bW = Math.min(W - bL, Math.ceil(BoxWidth + pad * 2));
            var bH = Math.min(H - bT, Math.ceil(BoxHeight + pad * 2));
            if (bW < 1 || bH < 1) continue;
            var imgData2 = ctx.getImageData(bL, bT, bW, bH);
            boxBlurH(imgData2.data, bW, bH, r);
            boxBlurV(imgData2.data, bW, bH, r);
            boxBlurH(imgData2.data, bW, bH, r);
            boxBlurV(imgData2.data, bW, bH, r);
            ctx.putImageData(imgData2, bL, bT);
        }
    }
}

// ============================================================
// Solid-background detection + original text-colour detection
// ============================================================
// All three erasure methods (LaMa, AOT, blur) reconstruct the background by
// interpolation, which can leave faint artifacts or a slightly off colour on
// flat fills. When the text sits on a solid (flat) background we can do far
// better: sample the colour just OUTSIDE the text box (guaranteed background)
// and paint the box with that exact colour — a pixel-perfect, artifact-free
// fill that the models can't match.
//
// The same sampling pass also estimates the ORIGINAL text colour — the
// dominant interior colour that differs strongly from the background — so the
// translation can be drawn in the original colour instead of always white/black.
//
// Both are read from a single axis-aligned copy of each box plus a border
// "band" (the surrounding pixels). The band yields the background colour and a
// "solidness" measure (how flat it is); the box interior yields the text colour
// (dominant colour far from the background). This runs BEFORE erasure so the
// original pixels are still intact.

var SOLID_BAND_MIN = 5;        // minimum border-band width (px) around a box
var SOLID_BAND_FRAC = 0.4;     // band width = box height * this
var SOLID_BAND_MAX = 20;       // cap on band width
var SOLID_MIN_BG_PIXELS = 16;  // need at least this many band pixels to judge
var SOLID_ALPHA_VALID = 128;   // band/interior pixels need alpha >= this to count
var SOLID_CONSENSUS_FRAC = 0.75; // fraction of band pixels that must match the median
                                 // background colour (within tolerance) for "solid". Robust
                                 // to a few stray pixels (e.g. adjacent-line text in the band).

var TEXT_MIN_DIST = 40;        // Chebyshev distance from background to count as text
var TEXT_HIST_BITS = 4;        // bits/channel for the dominant-colour histogram (4096 bins)
var TEXT_PEAK_DOM = 0.15;      // peak bin must hold >= this fraction of total text weight

// Contrast-aware auto outline. The translation is drawn in the original text
// colour (or an auto white/black), but that colour is matched to the ORIGINAL
// background — after erasure the new background can differ, so the fill may end
// up with little contrast (white text on a white panel, black text on a dark
// picture, etc.). On a transparent sprite the in-game background is unknown
// entirely. The manual "Text outline thickness" option is all-or-nothing, so
// instead each box draws a SUBTLE inverse-colour outline automatically, only
// when the fill would not otherwise be readable. The outline colour is always
// the luminance inverse of the fill, so it contrasts with the background
// precisely when the fill fails to — guaranteeing legibility without ever
// outlining text that already reads fine.
var AUTO_OUTLINE_MIN_CONTRAST = 0.40; // min fill↔bg luminance gap; below this, outline
var AUTO_OUTLINE_DIVISOR = 18;        // auto outline px ≈ round(fontSize / this) (subtle)
var AUTO_OUTLINE_MAX_PX = 3;          // cap so large fonts don't get a heavy outline

// Scratch buffers for the dominant-colour histogram (4096 bins), reused per box.
var _textHistN = 1 << (3 * TEXT_HIST_BITS);
var _textHistW = new Float32Array(_textHistN);  // distance-weighted mass (peak selection)
var _textHistC = new Float32Array(_textHistN);  // unweighted pixel count (colour averaging)
var _textHistR = new Float32Array(_textHistN);  // unweighted R/G/B sums
var _textHistG = new Float32Array(_textHistN);
var _textHistB = new Float32Array(_textHistN);
// "Deep" (interior-of-ink) histogram, used only on transparent backgrounds to
// tell the fill apart from a surrounding outline. Same binning as above but
// restricted to opaque pixels whose 4 cardial neighbours are all opaque — this
// erodes the outline's outer edge + antialiased fringe (both touch the
// transparency) while keeping the enclosed fill intact.
var _textHistDW = new Float32Array(_textHistN); // deep alpha-weighted mass (peak selection)
var _textHistDC = new Float32Array(_textHistN); // deep unweighted pixel count (averaging)
var _textHistDR = new Float32Array(_textHistN); // deep unweighted R/G/B sums
var _textHistDG = new Float32Array(_textHistN);
var _textHistDB = new Float32Array(_textHistN);

// Dominant colour of the text fill. Text pixels are opaque interior pixels that
// differ from the (opaque) background; on a transparent background every opaque
// pixel counts. The fill is the significant colour cluster with the GREATEST
// luminance contrast against the background — the fill is virtually always the
// highest-contrast colour, so this picks it over a surrounding outline even
// when the outline is much thicker than the (thin) fill, and even when the
// border band itself lands on the outline (so the sampled "background" is the
// outline colour). e.g. thin white text + thick pink outline → white.
//
// On a TRANSPARENT background there is no background colour to contrast
// against, so the naive "biggest opaque cluster" rule can pick a surrounding
// OUTLINE over the fill: the outline's outer edge runs the whole glyph
// perimeter and its antialiased fringe often outnumbers the enclosed fill
// (e.g. white text with a thin black outline gets detected as black). To stay
// robust we also tally a "deep" histogram — opaque pixels whose 4 cardial
// neighbours are ALL opaque (at least one pixel inside the transparency). The
// fill is always deeper than the outline enclosing it, so the deep histogram
// favours the fill. When too few deep pixels survive (thin / 1px strokes with
// no real interior) we fall back to the full alpha-weighted histogram, leaving
// those previously-correct cases unchanged.
// Returns [r,g,b] or null.
function dominantTextColor(data, w, h, ix0, iy0, ix1, iy1, bgTransparent, bgR, bgG, bgB) {
    _textHistW.fill(0); _textHistC.fill(0);
    _textHistR.fill(0); _textHistG.fill(0); _textHistB.fill(0);
    var shift = 8 - TEXT_HIST_BITS;
    var totalW = 0, cntText = 0;
    var bgLum = bgTransparent ? 0 : luminance01(bgR, bgG, bgB);
    var useDeep = bgTransparent;
    if (useDeep) {
        _textHistDW.fill(0); _textHistDC.fill(0);
        _textHistDR.fill(0); _textHistDG.fill(0); _textHistDB.fill(0);
    }
    var deepTotal = 0;
    for (var ty = iy0; ty < iy1; ty++) {
        var rowOff = ty * w;
        var rowAbove = rowOff - w, rowBelow = rowOff + w;
        for (var tx = ix0; tx < ix1; tx++) {
            var ti = (rowOff + tx) * 4;
            var a = data[ti + 3];
            if (a < SOLID_ALPHA_VALID) continue;
            var rr = data[ti], gg = data[ti + 1], bb = data[ti + 2];
            if (!bgTransparent) {
                var dr = Math.abs(rr - bgR), dg = Math.abs(gg - bgG), db = Math.abs(bb - bgB);
                var dd = dr > dg ? dr : dg; if (db > dd) dd = db;
                if (dd < TEXT_MIN_DIST) continue;             // background-coloured pixel
            }
            var bin = ((rr >> shift) << (2 * TEXT_HIST_BITS)) | ((gg >> shift) << TEXT_HIST_BITS) | (bb >> shift);
            _textHistW[bin] += a;
            _textHistC[bin]++; _textHistR[bin] += rr; _textHistG[bin] += gg; _textHistB[bin] += bb;
            totalW += a; cntText++;
            if (useDeep) {
                // 4 cardial neighbours must all be opaque. The interior crop is
                // inset from the band, so these lookups never leave the crop.
                var aUp = (ty > 0) ? data[(rowAbove + tx) * 4 + 3] : 0;
                var aDn = (ty < h - 1) ? data[(rowBelow + tx) * 4 + 3] : 0;
                var aLt = (tx > 0) ? data[(rowOff + tx - 1) * 4 + 3] : 0;
                var aRt = (tx < w - 1) ? data[(rowOff + tx + 1) * 4 + 3] : 0;
                if (aUp >= SOLID_ALPHA_VALID && aDn >= SOLID_ALPHA_VALID &&
                    aLt >= SOLID_ALPHA_VALID && aRt >= SOLID_ALPHA_VALID) {
                    _textHistDC[bin]++;
                    _textHistDW[bin] += a;
                    _textHistDR[bin] += rr; _textHistDG[bin] += gg; _textHistDB[bin] += bb;
                    deepTotal++;
                }
            }
        }
    }
    // Trust the deep histogram only when it kept a healthy amount of ink;
    // otherwise (thin / 1px strokes — no real interior) fall back to the full
    // alpha-weighted histogram so behaviour is unchanged for those cases.
    var trustDeep = useDeep && deepTotal >= 16 && deepTotal >= 0.25 * cntText;
    // Pick the significant cluster (>=8 px) with the greatest luminance contrast
    // to the background. On a transparent background, prefer the dominant DEEP
    // cluster (the fill) when trustworthy; else the largest opaque cluster.
    var bestBin = -1, bestScore = -1, pickedDeep = false;
    if (trustDeep) {
        for (var bd = 0; bd < _textHistN; bd++) {
            if (_textHistDC[bd] < 8) continue;
            if (_textHistDW[bd] > bestScore) { bestScore = _textHistDW[bd]; bestBin = bd; }
        }
        if (bestBin >= 0) pickedDeep = true;
        else bestScore = -1; // no deep cluster qualified → fall through to full
    }
    if (bestBin < 0) {
        for (var b = 0; b < _textHistN; b++) {
            if (_textHistC[b] < 8) continue;
            var pc = _textHistC[b];
            var cR = _textHistR[b] / pc, cG = _textHistG[b] / pc, cB = _textHistB[b] / pc;
            var score = bgTransparent ? _textHistW[b] : Math.abs(luminance01(cR, cG, cB) - bgLum);
            if (score > bestScore) { bestScore = score; bestBin = b; }
        }
    }
    if (typeof SEPDIAG !== "undefined" && SEPDIAG && bestBin >= 0) {
        var pcD = pickedDeep ? _textHistDC[bestBin] : _textHistC[bestBin];
        var deepNote = useDeep ? (" deep=" + (deepTotal | 0) + (pickedDeep ? (" pick=" + (pcD | 0)) : "")) : "";
        console.log("[SEP-DIAG]   fill: textPx=" + cntText + " chosen=" +
            Math.round((pickedDeep ? _textHistDR[bestBin] : _textHistR[bestBin]) / (pcD || 1)) + "," +
            Math.round((pickedDeep ? _textHistDG[bestBin] : _textHistG[bestBin]) / (pcD || 1)) + "," +
            Math.round((pickedDeep ? _textHistDB[bestBin] : _textHistB[bestBin]) / (pcD || 1)) +
            " (score=" + bestScore.toFixed(3) + ", px=" + (_textHistC[bestBin] | 0) + deepNote + ")");
    }
    if (bestBin < 0 || cntText < 8) return null;
    // Average from the deep histogram when it drove the pick (true fill, free of
    // outline/antialiasing bleed); otherwise from the full histogram.
    var pc2, hR, hG, hB;
    if (pickedDeep) {
        pc2 = _textHistDC[bestBin] || 1;
        hR = _textHistDR[bestBin]; hG = _textHistDG[bestBin]; hB = _textHistDB[bestBin];
    } else {
        pc2 = _textHistC[bestBin] || 1;
        hR = _textHistR[bestBin]; hG = _textHistG[bestBin]; hB = _textHistB[bestBin];
    }
    return [
        Math.round(hR / pc2),
        Math.round(hG / pc2),
        Math.round(hB / pc2),
    ];
}

// Analyse the RGBA buffer of an axis-aligned "box + band" crop.
//   data       : Uint8ClampedArray RGBA, size w*h
//   interior   = [ix0,iy0,ix1,iy1] (the text box); the border band is the
//                surrounding frame (everything outside the interior).
// Returns { bgColor:[r,g,b,a], solid:bool, textColor:[r,g,b]|null, textConfident:bool }.
function analyzeRegion(data, w, h, ix0, iy0, ix1, iy1, opts) {
    var detectSolid = opts.detectSolid;
    var detectText = opts.detectText;
    var result = { bgColor: [255, 255, 255, 255], solid: false, transparent: false, textColor: null, textConfident: false };

    // --- 1. band pass: transparent vs opaque counts + opaque RGB histograms ---
    // Transparent band pixels are tallied separately (not into the RGB
    // histograms) so a transparent background is recognised as such, instead of
    // being misread from whatever opaque text bleeds into the band.
    var hR = new Uint32Array(256), hG = new Uint32Array(256), hB = new Uint32Array(256);
    var totalBand = 0, transpBand = 0, sA = 0, cnt = 0;
    for (var y = 0; y < h; y++) {
        var bandRow = (y < iy0 || y >= iy1);
        for (var x = 0; x < w; x++) {
            if (!bandRow && x >= ix0 && x < ix1) continue;  // skip interior → band only
            var i = (y * w + x) * 4;
            totalBand++;
            if (data[i + 3] < SOLID_ALPHA_VALID) { transpBand++; continue; }  // transparent
            hR[data[i]]++; hG[data[i + 1]]++; hB[data[i + 2]]++; sA += data[i + 3]; cnt++;
        }
    }
    if (totalBand < SOLID_MIN_BG_PIXELS) return result;

    // --- transparent background: erase the text to transparent ---
    // When the band is mostly transparent there is no background colour — the
    // opaque interior content is the text itself. Erase it to transparent
    // (destination-out in the fill) rather than painting a (wrong) colour.
    if ((transpBand / totalBand) >= SOLID_CONSENSUS_FRAC) {
        result.transparent = true;
        result.bgColor = [0, 0, 0, 0];
        result.solid = detectSolid;
        if (detectText) {
            var tc = dominantTextColor(data, w, h, ix0, iy0, ix1, iy1, true, 0, 0, 0);
            if (tc) { result.textColor = tc; result.textConfident = true; }
        }
        if (typeof SEPDIAG !== "undefined" && SEPDIAG) {
            console.log("[SEP-DIAG]   transparent bg; textColor=" + JSON.stringify(result.textColor));
        }
        return result;
    }

    if (cnt < SOLID_MIN_BG_PIXELS) return result;            // not enough opaque background to judge
    var half = cnt >> 1, acc, v;
    for (acc = 0, v = 0; v < 256; v++) { acc += hR[v]; if (acc > half) break; } var medR = v;
    for (acc = 0, v = 0; v < 256; v++) { acc += hG[v]; if (acc > half) break; } var medG = v;
    for (acc = 0, v = 0; v < 256; v++) { acc += hB[v]; if (acc > half) break; } var medB = v;
    var bgA = sA / cnt;
    if (detectSolid) {
        var thr = opts.solidThreshold, within = 0, cR = 0, cG = 0, cB = 0;
        for (var y2 = 0; y2 < h; y2++) {
            var bandRow2 = (y2 < iy0 || y2 >= iy1);
            for (var x2 = 0; x2 < w; x2++) {
                if (!bandRow2 && x2 >= ix0 && x2 < ix1) continue;
                var i2 = (y2 * w + x2) * 4;
                if (data[i2 + 3] < SOLID_ALPHA_VALID) continue;
                var dr = Math.abs(data[i2] - medR);
                var dg = Math.abs(data[i2 + 1] - medG);
                var db = Math.abs(data[i2 + 2] - medB);
                var d = dr > dg ? dr : dg; if (db > d) d = db;
                if (d <= thr) { within++; cR += data[i2]; cG += data[i2 + 1]; cB += data[i2 + 2]; }
            }
        }
        result.solid = (within / cnt) >= SOLID_CONSENSUS_FRAC;
        if (within > 0) result.bgColor = [Math.round(cR / within), Math.round(cG / within), Math.round(cB / within), Math.round(bgA)];
        else result.bgColor = [medR, medG, medB, Math.round(bgA)];
    } else {
        result.bgColor = [medR, medG, medB, Math.round(bgA)];
    }

    // --- 3. text colour: dominant colour of the text FILL (interior, not the outline) ---
    if (detectText) {
        var tc2 = dominantTextColor(data, w, h, ix0, iy0, ix1, iy1, false, medR, medG, medB);
        if (tc2) { result.textColor = tc2; result.textConfident = true; }
    }
    return result;
}

// Measure how far the box's OWN text ink extends beyond the OCR box edges.
// Flood-fills the single connected ink component seeded from the box interior
// (8-connectivity), so only ink physically joined to the interior text counts —
// a separate adjacent text line sitting in the surrounding band is ignored
// (counting it would over-grow the fill and, with source-atop, recolour/erase
// that neighbouring text). Returns per-side bleed in px (distance beyond the
// box edge), each capped at `cap` (= sampled band width). Used to grow the
// solid fill so it fully covers wavy / extravagant fonts whose glyph
// flourishes overshoot the (too-tight) OCR box.
function measureConnectedInkExtent(data, w, h, ix0, iy0, ix1, iy1, transparent, bgR, bgG, bgB, thr, cap) {
    var n = w * h;
    var ink = new Uint8Array(n);
    if (transparent) {
        for (var i = 0; i < n; i++) if (data[i * 4 + 3] >= SOLID_ALPHA_VALID) ink[i] = 1;
    } else {
        for (var i2 = 0; i2 < n; i2++) {
            var o = i2 * 4;
            if (data[o + 3] < SOLID_ALPHA_VALID) continue;
            var dr = Math.abs(data[o] - bgR), dg = Math.abs(data[o + 1] - bgG), db = Math.abs(data[o + 2] - bgB);
            var d = dr > dg ? dr : dg; if (db > d) d = db;
            if (d > thr) ink[i2] = 1;
        }
    }
    // BFS over ink (8-connectivity) seeded from interior ink pixels. Reuse the
    // ink buffer as the visited set: 0 = background, 1 = ink unvisited, 2 = visited.
    var stack = new Int32Array(n);
    var sp = 0;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = iy0; y < iy1; y++) {
        var row = y * w;
        for (var x = ix0; x < ix1; x++) {
            var idx = row + x;
            if (ink[idx] === 1) {
                ink[idx] = 2; stack[sp++] = idx;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
    }
    while (sp > 0) {
        var cur = stack[--sp];
        var cy = (cur / w) | 0;
        var cx = cur - cy * w;
        for (var dy = -1; dy <= 1; dy++) {
            var ny = cy + dy; if (ny < 0 || ny >= h) continue;
            var nrow = ny * w;
            for (var dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                var nx = cx + dx; if (nx < 0 || nx >= w) continue;
                var nidx = nrow + nx;
                if (ink[nidx] === 1) {
                    ink[nidx] = 2; stack[sp++] = nidx;
                    if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
                    if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;
                }
            }
        }
    }
    if (maxX < 0) return { left: 0, top: 0, right: 0, bottom: 0 };
    return {
        left: Math.min(cap, Math.max(0, ix0 - minX)),
        right: Math.min(cap, Math.max(0, maxX - (ix1 - 1))),
        top: Math.min(cap, Math.max(0, iy0 - minY)),
        bottom: Math.min(cap, Math.max(0, maxY - (iy1 - 1))),
    };
}

// Per-image pre-pass: detect solid backgrounds (fill them with the exact
// background colour) and estimate the original text colour for every box.
// Modifies `ctx` (paints solid boxes) and annotates each box with
// _solidFilled / _detectedTextColor / _textConfident / _bgColor.
function analyzeAndEraseSolid(ctx, boxes, opts) {
    var detectSolid = opts.detectSolidBackground !== false;
    var detectText = opts.detectTextColor !== false;
    if ((!detectSolid && !detectText) || !boxes || !boxes.length) return;

    var solidThreshold = Number(opts.solidColorThreshold != null ? opts.solidColorThreshold : 8);
    var eraseMode = opts.eraseMode || "blur";
    var dilation = Number(opts.inpaintDilation); if (!(dilation >= 0)) dilation = 4;
    // User-tunable extra padding (px) added to the solid fill box on top of the
    // dilation value. Defaults to 0 (unchanged behaviour). Positive enlarges the
    // fill to cover leftover text fringes from slightly-off OCR boxes; negative
    // shrinks it. Floor at 2px still applies (see fPad below).
    var boxMargin = Number(opts.solidBoxMargin); if (!isFinite(boxMargin)) boxMargin = 0;
    // When on (default), grow the solid fill by the measured ink bleed beyond
    // the OCR box, so wavy/extravagant fonts are fully covered (see below).
    var autoBoxMargin = opts.autoBoxMargin !== false;
    var analyzeOpts = { detectSolid: detectSolid, detectText: detectText, solidThreshold: solidThreshold };
    // Solid (non-transparent) backgrounds are erased in a second, pixel-exact
    // ImageData pass after the loop (see end of this function). Each entry
    // records the device-space box polygon needed to write the bg colour + alpha
    // directly, which works for horizontal, rotated and vertical text alike.
    var deferredSolid = [];

    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        box._solidFilled = false;
        box._transparentBg = false;
        box._detectedTextColor = null;
        box._textConfident = false;

        var BoxW = Math.max(box.width, 4);
        var BoxH = Math.max(box.height, 4);
        var angleDeg = box._angle != null ? box._angle : 0;
        var shouldRotate = Math.abs(angleDeg) > 0.1;

        var pad = Math.round(BoxH * SOLID_BAND_FRAC);
        if (pad < SOLID_BAND_MIN) pad = SOLID_BAND_MIN;
        if (pad > SOLID_BAND_MAX) pad = SOLID_BAND_MAX;

        var iw = Math.ceil(BoxW), ih = Math.ceil(BoxH);
        var tempW = iw + 2 * pad, tempH = ih + 2 * pad;
        var ix0 = pad, iy0 = pad;
        var ix1 = Math.min(pad + iw, tempW), iy1 = Math.min(pad + ih, tempH);

        // Axis-aligned copy: rotate the source so the box is horizontal in temp.
        var oc = box.originalCoords;
        var tlx = oc[0], tly = oc[1];
        var angle = angleDeg * Math.PI / 180;
        var tmp = document.createElement("canvas");
        tmp.width = tempW; tmp.height = tempH;
        var tmpCtx = tmp.getContext("2d");
        tmpCtx.translate(pad, pad);
        if (shouldRotate) tmpCtx.rotate(-angle);
        tmpCtx.translate(-tlx, -tly);
        tmpCtx.drawImage(ctx.canvas, 0, 0);
        var imgData = tmpCtx.getImageData(0, 0, tempW, tempH);

        var r = analyzeRegion(imgData.data, tempW, tempH, ix0, iy0, ix1, iy1, analyzeOpts);
        box._bgColor = r.bgColor;
        if (r.textConfident) { box._detectedTextColor = r.textColor; box._textConfident = true; }

        // Paint solid boxes with the exact background colour. The fill padding
        // has three contributions: the dilation value, a user margin
        // (solidBoxMargin), and — when autoBoxMargin is on — the measured ink
        // bleed beyond the OCR box (so wavy/extravagant fonts whose glyphs
        // overshoot the too-tight OCR box are fully covered). Only ink
        // CONNECTED to the box's own text is measured, so a neighbouring text
        // line in the band is never counted. source-atop recolours only opaque
        // pixels, so on a solid bg the fill is invisible outside the text — but
        // it WILL erase any opaque ink it overlaps, hence the connectivity guard.
        if (r.solid) {
            var eff = box.eraseOverride || eraseMode;
            if (eff === "inpaint") eff = "aot";
            if (eff !== "none") {
                var bleed = 0;
                if (autoBoxMargin) {
                    var ibg = r.bgColor;
                    var ext = measureConnectedInkExtent(imgData.data, tempW, tempH, ix0, iy0, ix1, iy1,
                        r.transparent, ibg[0], ibg[1], ibg[2], solidThreshold, pad);
                    bleed = Math.max(ext.left, ext.top, ext.right, ext.bottom);
                    if (SEPDIAG) console.log("[SEP-DIAG]   inkExtent bleed=" + bleed +
                        " L" + ext.left + " T" + ext.top + " R" + ext.right + " B" + ext.bottom +
                        " => fPad=" + Math.max(2, Math.round(dilation * 1.0) + boxMargin, bleed + 1));
                }
                var fPad = Math.max(2, Math.round(dilation * 1.0) + boxMargin, bleed + 1);
                if (r.transparent) {
                    // Transparent background: cut the text out to transparent. The
                    // canvas destination-out is orientation-agnostic here — cutting
                    // to alpha 0 leaves a transparent hole with no ghost and no seam
                    // regardless of rotation, so it stays on ctx.
                    var fX = -BoxW / 2 - fPad, fY = -BoxH / 2 - fPad;
                    ctx.save();
                    ctx.translate(box.cx, box.cy);
                    if (shouldRotate) ctx.rotate(angle);
                    ctx.globalCompositeOperation = "destination-out";
                    ctx.fillStyle = "#000";
                    ctx.fillRect(fX, fY, BoxW + 2 * fPad, BoxH + 2 * fPad);
                    ctx.restore();
                    box._transparentBg = true;
                } else {
                    // Solid background: defer to the pixel-exact ImageData pass
                    // below. Writing the bg colour + alpha directly to every content
                    // pixel inside the box polygon has no antialiased edges, so it is
                    // seam-free and ghost-free for horizontal, rotated AND vertical
                    // text — something canvas compositing cannot do for rotated rects.
                    deferredSolid.push({
                        cx: box.cx, cy: box.cy, hw: BoxW / 2 + fPad, hh: BoxH / 2 + fPad,
                        angle: angle, bg: r.bgColor,
                    });
                }
                box._solidFilled = true;
            }
        }
    }

    // ---- Pass 2: pixel-exact solid-background erase via ImageData ----
    // Solid backgrounds are erased by writing the exact bg colour AND its alpha
    // directly to every content pixel inside each box polygon. Direct pixel
    // writes have no antialiased edges, so this is seam-free and ghost-free for
    // horizontal, rotated AND vertical text. Only content pixels
    // (alpha >= SOLID_ALPHA_VALID) are written, so the fill never extends into
    // transparent areas such as a panel edge — the same property source-atop
    // gave, but without its alpha-preservation "ghost" on semi-transparent
    // panels. The ImageData is captured AFTER the loop so the transparent-bg
    // cuts performed on ctx above are preserved, then written back once here.
    if (deferredSolid.length) {
        var cW = ctx.canvas.width, cH = ctx.canvas.height;
        var fullImg = ctx.getImageData(0, 0, cW, cH);
        var fd = fullImg.data;
        for (var di = 0; di < deferredSolid.length; di++) {
            var s = deferredSolid[di];
            var bg = s.bg;
            var bgA = (bg[3] != null && isFinite(bg[3])) ? bg[3] : 255;
            var fR = bg[0], fG = bg[1], fB = bg[2];
            var ca = Math.cos(s.angle), sa = Math.sin(s.angle);
            var hw = s.hw, hh = s.hh;
            // Device-space AABB of the rotated rect (iterate only these pixels).
            var aabbHX = Math.abs(ca) * hw + Math.abs(sa) * hh;
            var aabbHY = Math.abs(sa) * hw + Math.abs(ca) * hh;
            var x0 = Math.max(0, Math.floor(s.cx - aabbHX));
            var x1 = Math.min(cW, Math.ceil(s.cx + aabbHX) + 1);
            var y0 = Math.max(0, Math.floor(s.cy - aabbHY));
            var y1 = Math.min(cH, Math.ceil(s.cy + aabbHY) + 1);
            for (var py = y0; py < y1; py++) {
                var dy = py - s.cy;
                var saDy = sa * dy, caDy = ca * dy;
                var rowBase = py * cW;
                for (var px = x0; px < x1; px++) {
                    var dx = px - s.cx;
                    // Un-rotate to box-local axis-aligned coords; inside if within half-extents.
                    var lx = ca * dx + saDy;
                    if (lx > hw || lx < -hw) continue;
                    var ly = -sa * dx + caDy;
                    if (ly > hh || ly < -hh) continue;
                    var pidx = (rowBase + px) * 4;
                    if (fd[pidx + 3] < SOLID_ALPHA_VALID) continue;  // not content -> leave untouched
                    fd[pidx] = fR; fd[pidx + 1] = fG; fd[pidx + 2] = fB; fd[pidx + 3] = bgA;
                }
            }
            if (SEPDIAG) console.log("[SEP-DIAG]   solidFill(imgData) bgA=" + bgA +
                " half=" + hw.toFixed(1) + "x" + hh.toFixed(1) + " angle=" + (s.angle * 180 / Math.PI).toFixed(1));
        }
        ctx.putImageData(fullImg, 0, 0);
    }
}

// ---- Phase 2: text-draw via opentype.js + Canvas ----
// Draws text character-by-character (font.getPath with text is broken in opentype.js 1.3.4,
// and path.draw() fills with path.fill="black" by default — must trace manually).
function drawTextOnCanvas(ctx, text, font, size, x, baseline, border) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
        var g = font.charToGlyph(text[i]);
        var path = g.getPath(cx, baseline, size);
        // Manual trace (avoids path.fill="black" default in opentype.js draw)
        ctx.beginPath();
        for (var j = 0; j < path.commands.length; j++) {
            var cmd = path.commands[j];
            if (cmd.type === 'M') ctx.moveTo(cmd.x, cmd.y);
            else if (cmd.type === 'L') ctx.lineTo(cmd.x, cmd.y);
            else if (cmd.type === 'Q') ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
            else if (cmd.type === 'C') ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
            else if (cmd.type === 'Z') ctx.closePath();
        }
        if (border > 0) ctx.stroke();
        ctx.fill();
        cx += g.advanceWidth * size / font.unitsPerEm;
    }
}

function drawPhase(ctx, boxes, imageBoxes, opts) {
    var font = getFont(opts.family);
    if (!font) throw new Error("No font registered for render");
    var border = opts.border;
    var snapThresh = opts.angleSnapThreshold != null ? opts.angleSnapThreshold : 3.0;
    var groupThresh = opts.angleGroupThreshold != null ? opts.angleGroupThreshold : 5.0;
    var heightThresh = opts.heightGroupThreshold != null ? opts.heightGroupThreshold : 0.20;
    var vSnapThresh = opts.verticalAngleSnapThreshold != null ? opts.verticalAngleSnapThreshold : snapThresh;

    // Two-level grouping: first by angle, then by height within each angle group.
    // This ensures text in the same block shares a consistent angle AND font size.
    var angleGroups = groupBoxesByAngle(boxes, snapThresh, groupThresh, vSnapThresh);
    for (var ag = 0; ag < angleGroups.length; ag++) {
        var hGroups = groupBoxesByHeight(angleGroups[ag], heightThresh);
        var hkeys = Object.keys(hGroups);
        for (var hi = 0; hi < hkeys.length; hi++) {
            var fs_ = calculateGroupFontSize(hGroups[hkeys[hi]], font, opts.minFontSize);
            for (var bi = 0; bi < hGroups[hkeys[hi]].length; bi++)
                hGroups[hkeys[hi]][bi].fontSize = fs_;
        }
    }

    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var parsed = parseCommands(box.text);
        var message = parsed.cleaned;
        if (!message) continue;
        var angleDeg = box._angle != null ? box._angle : boxAngle(box, imageBoxes);
        var shouldRotate = Math.abs(angleDeg) > 0.1;
        var fontSize = box.fontSizeOverride != null ? box.fontSizeOverride : (box.fontSize || 12);

        var colorOverride = box.colorOverride != null ? box.colorOverride : parsed.colorOverride;
        // Sample background at box center (post-erase) for contrast decisions.
        var sx = Math.min(ctx.canvas.width - 1, Math.max(0, box.cx | 0));
        var sy = Math.min(ctx.canvas.height - 1, Math.max(0, box.cy | 0));
        var px = ctx.getImageData(sx, sy, 1, 1).data;
        var bgTransparent = px[3] < SOLID_ALPHA_VALID;
        var bgLum = bgTransparent ? 0 : luminance01(px[0], px[1], px[2]);
        var textColor, borderColor;
        if (colorOverride !== null) {
            textColor = Array.isArray(colorOverride) ? colorOverride : (NAMED_COLORS[String(colorOverride).toLowerCase()] || [255, 255, 255]);
            borderColor = luminance01(textColor[0], textColor[1], textColor[2]) > 0.5 ? [0, 0, 0] : [255, 255, 255];
        } else {
            // Reuse the detected original text colour when it is available and
            // still contrasts with the (now-erased) background; otherwise fall
            // back to the automatic white/black pick.
            var detected = (opts.detectTextColor !== false && box._textConfident && box._detectedTextColor) ? box._detectedTextColor : null;
            if (bgTransparent) {
                // Transparent background (text erased to transparent): no
                // background colour to contrast against, so use the detected
                // original text colour directly, defaulting to white.
                textColor = detected || [255, 255, 255];
                borderColor = luminance01(textColor[0], textColor[1], textColor[2]) > 0.5 ? [0, 0, 0] : [255, 255, 255];
            } else {
                if (detected && Math.abs(luminance01(detected[0], detected[1], detected[2]) - bgLum) >= 0.20) {
                    textColor = detected;
                    borderColor = luminance01(textColor[0], textColor[1], textColor[2]) > 0.5 ? [0, 0, 0] : [255, 255, 255];
                } else {
                    if (bgLum > 0.5) { textColor = [0, 0, 0]; borderColor = [255, 255, 255]; }
                    else { textColor = [255, 255, 255]; borderColor = [0, 0, 0]; }
                }
            }
        }

        // Effective outline thickness. The manual "Text outline thickness"
        // option is always applied when > 0. When it is 0 (the default) a
        // subtle inverse-colour outline is drawn AUTOMATICALLY whenever the
        // fill would not contrast enough with the background it sits on — or
        // whenever the background is transparent (final in-game colour unknown),
        // so the text can never become invisible. See AUTO_OUTLINE_* constants.
        var effBorder = border;
        if (effBorder <= 0 && opts.autoTextOutline !== false) {
            var textLum = luminance01(textColor[0], textColor[1], textColor[2]);
            if (bgTransparent || Math.abs(textLum - bgLum) < AUTO_OUTLINE_MIN_CONTRAST)
                effBorder = Math.min(AUTO_OUTLINE_MAX_PX, Math.max(1, Math.round(fontSize / AUTO_OUTLINE_DIVISOR)));
        }

        var BoxWidth = Math.max(box.width, 12);
        var BoxHeight = Math.max(box.height, 12);
        var m = measureText(message, font, fontSize);

        ctx.save();
        ctx.fillStyle = "rgb(" + textColor.join(",") + ")";
        if (effBorder > 0) {
            ctx.strokeStyle = "rgb(" + borderColor.join(",") + ")";
            ctx.lineWidth = effBorder * 2;
            ctx.lineJoin = "round";
        }

        // Use box center for positioning (works for both rotated and horizontal)
        ctx.translate(box.cx, box.cy);
        if (shouldRotate) ctx.rotate(angleDeg * Math.PI / 180);

        // Left-align text within the box, vertically centered.
        var startX = -BoxWidth / 2;
        var baseline = m.capHeight / 2;
        drawTextOnCanvas(ctx, message, font, fontSize, startX, baseline, effBorder);
        ctx.restore();
    }
}

// ---- BMP codec (pure JS, no dependencies) ----

// Decode a BMP buffer to RGBA pixel data.
// Supports 24-bit (BGR) and 32-bit (BGRA), uncompressed (BI_RGB),
// both top-down and bottom-up row orders.
function readBmp(buf) {
    if (buf[0] !== 0x42 || buf[1] !== 0x4D) throw new Error("Not a BMP file");
    var dataOffset = buf.readUInt32LE(10);
    var width = buf.readInt32LE(18);
    var heightRaw = buf.readInt32LE(22);
    var bpp = buf.readUInt16LE(28);
    var compression = buf.readUInt32LE(30);
    if (compression !== 0) throw new Error("Compressed BMP not supported (compression=" + compression + ")");
    if (bpp !== 24 && bpp !== 32) throw new Error("Only 24/32-bit BMP supported, got " + bpp + "-bit");
    var topDown = heightRaw < 0;
    var height = Math.abs(heightRaw);
    var bytesPerPixel = bpp / 8;
    var rowSize = Math.floor((bpp * width + 31) / 32) * 4; // rows padded to 4-byte boundary
    var data = Buffer.alloc(width * height * 4);
    for (var y = 0; y < height; y++) {
        var srcY = topDown ? y : (height - 1 - y);
        var rowOffset = dataOffset + srcY * rowSize;
        for (var x = 0; x < width; x++) {
            var si = rowOffset + x * bytesPerPixel;
            var di = (y * width + x) * 4;
            data[di] = buf[si + 2];     // R (from BGR)
            data[di + 1] = buf[si + 1]; // G
            data[di + 2] = buf[si];     // B (from BGR)
            data[di + 3] = bpp === 32 ? buf[si + 3] : 255;
        }
    }
    return { width: width, height: height, data: data };
}

// Encode RGBA pixel data to a 32-bit BGRA BMP buffer (BI_RGB, bottom-up).
function writeBmp(imageData) {
    var w = imageData.width, h = imageData.height;
    var rowSize = w * 4; // 32-bit: always 4-byte aligned
    var pixelSize = rowSize * h;
    var fileSize = 14 + 40 + pixelSize;
    var buf = Buffer.alloc(fileSize);
    buf.write("BM", 0);
    buf.writeUInt32LE(fileSize, 2);
    buf.writeUInt32LE(14 + 40, 10); // data offset
    buf.writeUInt32LE(40, 14);      // DIB header size
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);        // positive = bottom-up
    buf.writeUInt16LE(1, 26);       // planes
    buf.writeUInt16LE(32, 28);      // bits per pixel
    buf.writeUInt32LE(0, 30);       // compression = BI_RGB
    buf.writeUInt32LE(pixelSize, 34);
    var src = imageData.data;
    for (var y = 0; y < h; y++) {
        var srcY = h - 1 - y;       // flip to bottom-up
        for (var x = 0; x < w; x++) {
            var si = (srcY * w + x) * 4;
            var di = 54 + (y * w + x) * 4;
            buf[di] = src[si + 2];     // B
            buf[di + 1] = src[si + 1]; // G
            buf[di + 2] = src[si];     // R
            buf[di + 3] = src[si + 3]; // A
        }
    }
    return buf;
}

// Insert an EXIF APP1 segment right after the SOI marker of a JPEG buffer.
// exifBuffer is the raw TIFF data (without "Exif\0" prefix, as returned by
// jpeg-js decode).  The "Exif\0" header is prepended automatically.
function insertExifIntoJpeg(jpegBuf, exifBuffer) {
    if (!exifBuffer || exifBuffer.length === 0) return jpegBuf;
    var payload = Buffer.alloc(exifBuffer.length + 5);
    payload.write("Exif", 0, "ascii");
    payload[4] = 0x00;
    exifBuffer.copy(payload, 5);
    var segLen = payload.length + 2; // +2 for the length field itself
    var header = Buffer.alloc(4);
    header[0] = 0xFF; header[1] = 0xE1; // APP1 marker
    header[2] = (segLen >> 8) & 0xFF;
    header[3] = segLen & 0xFF;
    // Insert after SOI (first 2 bytes), before the rest of the JPEG.
    return Buffer.concat([jpegBuf.slice(0, 2), header, payload, jpegBuf.slice(2)]);
}

// ---- TGA (Targa) codec (pure JS) ----

// Decode a TGA buffer to RGBA pixel data.
// Supports uncompressed (type 2) and RLE (type 10) truecolor, 24/32-bit.
function readTga(buf) {
    var idLength = buf[0];
    var imageType = buf[2];
    var width = buf.readUInt16LE(12);
    var height = buf.readUInt16LE(14);
    var pixelDepth = buf[16];
    var descriptor = buf[17];
    if (imageType !== 2 && imageType !== 10)
        throw new Error("Only uncompressed/RLE truecolor TGA supported (type " + imageType + ")");
    if (pixelDepth !== 24 && pixelDepth !== 32)
        throw new Error("Only 24/32-bit TGA supported, got " + pixelDepth + "-bit");
    var topDown = (descriptor & 0x20) !== 0;
    var bpp = pixelDepth / 8;
    var dataOffset = 18 + idLength;
    var totalPixels = width * height;
    var raw = Buffer.alloc(totalPixels * 4);

    if (imageType === 2) {
        // Uncompressed
        for (var p = 0; p < totalPixels; p++) {
            var si = dataOffset + p * bpp;
            raw[p * 4] = buf[si + 2];         // R
            raw[p * 4 + 1] = buf[si + 1];     // G
            raw[p * 4 + 2] = buf[si];         // B
            raw[p * 4 + 3] = pixelDepth === 32 ? buf[si + 3] : 255;
        }
    } else {
        // RLE (type 10)
        var offset = dataOffset;
        var written = 0;
        while (written < totalPixels) {
            var packet = buf[offset++];
            var count = (packet & 0x7F) + 1;
            if (packet & 0x80) {
                // RLE packet: one pixel repeated
                var b = buf[offset++], g = buf[offset++], r = buf[offset++];
                var a = pixelDepth === 32 ? buf[offset++] : 255;
                for (var i = 0; i < count && written < totalPixels; i++) {
                    raw[written * 4] = r; raw[written * 4 + 1] = g;
                    raw[written * 4 + 2] = b; raw[written * 4 + 3] = a;
                    written++;
                }
            } else {
                // Raw packet: count individual pixels
                for (var i = 0; i < count && written < totalPixels; i++) {
                    var b = buf[offset++], g = buf[offset++], r = buf[offset++];
                    var a = pixelDepth === 32 ? buf[offset++] : 255;
                    raw[written * 4] = r; raw[written * 4 + 1] = g;
                    raw[written * 4 + 2] = b; raw[written * 4 + 3] = a;
                    written++;
                }
            }
        }
    }

    // Flip rows if bottom-up (default TGA orientation)
    if (!topDown) {
        var flipped = Buffer.alloc(raw.length);
        for (var y = 0; y < height; y++) {
            var srcY = height - 1 - y;
            raw.copy(flipped, y * width * 4, srcY * width * 4, (srcY + 1) * width * 4);
        }
        raw = flipped;
    }
    return { width: width, height: height, data: raw };
}

// Encode RGBA pixel data to an uncompressed 32-bit BGRA TGA (bottom-up).
function writeTga(imageData) {
    var w = imageData.width, h = imageData.height;
    var buf = Buffer.alloc(18 + w * h * 4);
    buf[0] = 0;            // No ID
    buf[1] = 0;            // No color map
    buf[2] = 2;            // Uncompressed truecolor
    buf.writeUInt16LE(0, 12); // Width
    buf.writeUInt16LE(0, 14); // (filled below)
    buf.writeUInt16LE(w, 12);
    buf.writeUInt16LE(h, 14);
    buf[16] = 32;          // 32-bit
    buf[17] = 0x08;        // 8 bits alpha, origin bottom-left
    var src = imageData.data;
    for (var y = 0; y < h; y++) {
        var srcY = h - 1 - y;
        for (var x = 0; x < w; x++) {
            var si = (srcY * w + x) * 4;
            var di = 18 + (y * w + x) * 4;
            buf[di] = src[si + 2];     // B
            buf[di + 1] = src[si + 1]; // G
            buf[di + 2] = src[si];     // R
            buf[di + 3] = src[si + 3]; // A
        }
    }
    return buf;
}

// ---- PCX codec (pure JS) ----

// Decode a PCX buffer to RGBA pixel data.
// Supports 8-bit indexed (1 plane + palette), 24-bit (3 planes), and
// 32-bit (4 planes), with RLE encoding.
function readPcx(buf) {
    if (buf[0] !== 10) throw new Error("Not a PCX file");
    var bitsPerPlane = buf[3];
    var width = buf.readInt16LE(8) - buf.readInt16LE(4) + 1;
    var height = buf.readInt16LE(10) - buf.readInt16LE(6) + 1;
    var numPlanes = buf[65];
    var bytesPerScanline = buf.readUInt16LE(66);
    var totalBpp = bitsPerPlane * numPlanes;
    if (totalBpp !== 8 && totalBpp !== 24 && totalBpp !== 32)
        throw new Error("Only 8/24/32-bit PCX supported, got " + totalBpp + "-bit");

    var srcOff = 128;
    // Decode one RLE-compressed scanline for one plane.
    function decodeScanline() {
        var result = Buffer.alloc(bytesPerScanline);
        var written = 0;
        while (written < bytesPerScanline) {
            var b = buf[srcOff++];
            if ((b & 0xC0) === 0xC0) {
                var cnt = b & 0x3F;
                var val = buf[srcOff++];
                result.fill(val, written, written + cnt);
                written += cnt;
            } else {
                result[written++] = b;
            }
        }
        return result;
    }

    var data = Buffer.alloc(width * height * 4);
    if (numPlanes === 1 && bitsPerPlane === 8) {
        // 8-bit indexed — palette is last 769 bytes (0x0C + 256×3 RGB)
        var palOff = buf.length - 769;
        if (buf[palOff] !== 0x0C) throw new Error("8-bit PCX palette marker not found");
        for (var y = 0; y < height; y++) {
            var sl = decodeScanline();
            for (var x = 0; x < width; x++) {
                var pi = sl[x] * 3;
                var di = (y * width + x) * 4;
                data[di] = buf[palOff + 1 + pi];
                data[di + 1] = buf[palOff + 1 + pi + 1];
                data[di + 2] = buf[palOff + 1 + pi + 2];
                data[di + 3] = 255;
            }
        }
    } else {
        // 24-bit (3 planes: R,G,B) or 32-bit (4 planes: R,G,B,A)
        for (var y = 0; y < height; y++) {
            var planes = [];
            for (var p = 0; p < numPlanes; p++) planes.push(decodeScanline());
            for (var x = 0; x < width; x++) {
                var di = (y * width + x) * 4;
                data[di] = planes[0][x];     // R
                data[di + 1] = planes[1][x]; // G
                data[di + 2] = planes[2][x]; // B
                data[di + 3] = numPlanes === 4 ? planes[3][x] : 255;
            }
        }
    }
    return { width: width, height: height, data: data };
}

// Encode RGBA pixel data to a 24-bit RLE PCX (3 planes).
function writePcx(imageData) {
    var w = imageData.width, h = imageData.height;
    var bps = w + (w & 1); // bytes per scanline per plane (must be even)
    var src = imageData.data;
    var chunks = [];
    for (var y = 0; y < h; y++) {
        for (var p = 0; p < 3; p++) {
            var plane = Buffer.alloc(bps);
            for (var x = 0; x < w; x++) plane[x] = src[(y * w + x) * 4 + p];
            // RLE encode this plane
            var encoded = [];
            var i = 0;
            while (i < bps) {
                var val = plane[i];
                var run = 1;
                while (i + run < bps && plane[i + run] === val && run < 63) run++;
                if (run > 1 || val >= 0xC0) { encoded.push(0xC0 | run, val); }
                else { encoded.push(val); }
                i += run;
            }
            chunks.push(Buffer.from(encoded));
        }
    }
    var pixelData = Buffer.concat(chunks);
    var buf = Buffer.alloc(128 + pixelData.length);
    buf[0] = 10;            // Manufacturer (ZSoft)
    buf[1] = 5;             // Version 5
    buf[2] = 1;             // RLE encoding
    buf[3] = 8;             // 8 bits per pixel per plane
    buf.writeInt16LE(0, 4); // Left
    buf.writeInt16LE(0, 6); // Top
    buf.writeInt16LE(w - 1, 8);  // Right
    buf.writeInt16LE(h - 1, 10); // Bottom
    buf[65] = 3;            // 3 planes (RGB)
    buf.writeUInt16LE(bps, 66); // Bytes per scanline
    pixelData.copy(buf, 128);
    return buf;
}

// ---- Canvas-based async image decoder (for WebP and other native formats) ----

// Decode an image buffer using the browser's native decoder via a blob URL
// and canvas.  Works for WebP, GIF (first frame), ICO, and any other format
// Chromium supports.  Returns { width, height, data (RGBA Buffer) }.
async function decodeImageAsync(buf, mime) {
    var blobUrl = window.URL.createObjectURL(new Blob([buf], { type: mime }));
    try {
        var img = new Image();
        await new Promise(function (res, rej) {
            img.onload = res;
            img.onerror = function () { rej(new Error("Image decode failed")); };
            img.src = blobUrl;
        });
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height, data: Buffer.from(imageData.data) };
    } finally {
        window.URL.revokeObjectURL(blobUrl);
    }
}

// ---- main entry: process one image ----
async function applyToImage(pngPath, boxData, opts) {
    opts = opts || {};
    var fontFamily = opts.fontFamily || "SEPFont";
    registerFont(opts.fontPath, fontFamily);
    var border = opts.border != null ? opts.border : 1;
    var applyBlur = opts.applyBlur !== false;
    var blurStrength = opts.blurStrength != null ? opts.blurStrength : 1.0;
    var eraseMode = opts.eraseMode || "blur";
    if (eraseMode === "inpaint") eraseMode = "aot";

    var imageBoxes;
    if (boxData && typeof boxData === "object") {
        imageBoxes = (boxData.text && boxData.top_left) ? boxData : Object.values(boxData)[0];
    }
    var boxes = buildBoxes(imageBoxes || {}, { skipUnchanged: opts.skipUnchanged });

    // Load image to canvas
    var buf = fs.readFileSync(pngPath);
    var png = PNG.sync.read(buf);
    var canvas = document.createElement("canvas");
    canvas.width = png.width;
    canvas.height = png.height;
    var ctx = canvas.getContext("2d");
    var imageData = ctx.createImageData(png.width, png.height);
    imageData.data.set(png.data);
    ctx.putImageData(imageData, 0, 0);

    // Angle grouping must run before BOTH erase and draw so that _angle is set.
    var snapThresh = opts.angleSnapThreshold != null ? opts.angleSnapThreshold : 3.0;
    var groupThresh = opts.angleGroupThreshold != null ? opts.angleGroupThreshold : 5.0;
    var vSnapThresh = opts.verticalAngleSnapThreshold != null ? opts.verticalAngleSnapThreshold : snapThresh;
    groupBoxesByAngle(boxes, snapThresh, groupThresh, vSnapThresh);

    // Solid-background detection + original text-colour detection (runs before
    // erasure so it reads the original pixels). Solid boxes are painted with
    // their exact background colour and skipped by the model/blur below.
    analyzeAndEraseSolid(ctx, boxes, {
        detectSolidBackground: opts.detectSolidBackground,
        solidColorThreshold: opts.solidColorThreshold,
        detectTextColor: opts.detectTextColor,
        inpaintDilation: opts.inpaintDilation,
        solidBoxMargin: opts.solidBoxMargin,
        autoBoxMargin: opts.autoBoxMargin,
        eraseMode: eraseMode,
    });

    if (SEPDIAG) {
        var _solid = 0, _text = 0;
        for (var _i = 0; _i < boxes.length; _i++) {
            if (boxes[_i]._solidFilled) _solid++;
            if (boxes[_i]._textConfident) _text++;
        }
        console.log("[SEP-DIAG] " + pngPath + " | boxes=" + boxes.length +
            " eraseMode=" + eraseMode + " (" + typeof eraseMode + ")" +
            " margin=" + opts.inpaintMargin + " (" + typeof opts.inpaintMargin + ")" +
            " dilation=" + opts.inpaintDilation + " (" + typeof opts.inpaintDilation + ")" +
            " | detectSolid=" + opts.detectSolidBackground + " (" + typeof opts.detectSolidBackground + ")" +
            " solidThresh=" + opts.solidColorThreshold + " (" + typeof opts.solidColorThreshold + ")" +
            " solidBoxMargin=" + opts.solidBoxMargin + " (" + typeof opts.solidBoxMargin + ")" +
            " autoBoxMargin=" + opts.autoBoxMargin + " (" + typeof opts.autoBoxMargin + ")" +
            " detectText=" + opts.detectTextColor + " (" + typeof opts.detectTextColor + ")" +
            " => solidFilled=" + _solid + " textColor=" + _text);
        for (var _j = 0; _j < boxes.length && _j < 25; _j++) {
            var _b = boxes[_j];
            console.log("[SEP-DIAG]   box[" + _j + "] w=" + _b.width.toFixed(1) + " h=" + _b.height.toFixed(1) +
                " solid=" + _b._solidFilled + " transp=" + !!_b._transparentBg + " bg=" + JSON.stringify(_b._bgColor) +
                " textConf=" + _b._textConfident + " textColor=" + JSON.stringify(_b._detectedTextColor));
        }
    }

    // Partition boxes by effective erase mode so a per-box r{...} override
    // (or "erase_mode_override" JSON field) can use a different method than
    // the global eraseMode. Each erase function only consumes the boxes it is
    // given, so passing subsets is safe.
    var eraseGroups = { none: [], blur: [], aot: [], lama: [] };
    for (var gi = 0; gi < boxes.length; gi++) {
        if (boxes[gi]._solidFilled) continue;   // already painted a solid fill
        var eff = boxes[gi].eraseOverride || eraseMode;
        if (eff === "inpaint") eff = "aot";
        if (!eraseGroups[eff]) eff = eraseMode;   // unknown override → fall back to global
        if (eraseGroups[eff]) eraseGroups[eff].push(boxes[gi]);
    }
    if (eraseGroups.lama.length && opts.lamaModelPath) {
        await getInpaint().inpaintLama(canvas, eraseGroups.lama, {
            modelPath: opts.lamaModelPath,
            dilation: opts.inpaintDilation,
            margin: opts.inpaintMargin,
        });
    }
    if (eraseGroups.aot.length && opts.modelPath) {
        await getInpaint().inpaint(canvas, eraseGroups.aot, {
            modelPath: opts.modelPath,
            dilation: opts.inpaintDilation,
            margin: opts.inpaintMargin,
        });
    }
    if (eraseGroups.blur.length && blurStrength > 0) {
        blurPhase(ctx, eraseGroups.blur, imageBoxes, blurStrength);
    }
    // eraseGroups.none: leave the original pixels untouched (text drawn over).

    drawPhase(ctx, boxes, imageBoxes, {
        family: fontFamily, border: border,
        minFontSize: opts.minFontSize,
        detectTextColor: opts.detectTextColor,
        autoTextOutline: opts.autoTextOutline,
        angleSnapThreshold: snapThresh,
        angleGroupThreshold: groupThresh,
        verticalAngleSnapThreshold: vSnapThresh,
        heightGroupThreshold: opts.heightGroupThreshold,
    });

    // Encode output in the requested format.
    var outData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var format = opts.outputFormat || "png";

    if (format === "jpeg") {
        // Use the native Chromium JPEG encoder via canvas.toDataURL — faster
        // than pure-JS jpeg-js and uses 4:2:0 subsampling (smaller files).
        var jq = (opts.jpegQuality != null ? opts.jpegQuality : 92) / 100;
        var dataUrl = canvas.toDataURL("image/jpeg", jq);
        var jpegBuf = Buffer.from(dataUrl.substring(dataUrl.indexOf(",") + 1), "base64");
        if (opts.exifBuffer && opts.exifBuffer.length > 0)
            jpegBuf = insertExifIntoJpeg(jpegBuf, opts.exifBuffer);
        return jpegBuf;
    }

    if (format === "bmp") {
        return writeBmp(outData);
    }

    if (format === "webp") {
        var wq = (opts.jpegQuality != null ? opts.jpegQuality : 90) / 100;
        var wUrl = canvas.toDataURL("image/webp", wq);
        return Buffer.from(wUrl.substring(wUrl.indexOf(",") + 1), "base64");
    }

    if (format === "tga") {
        return writeTga(outData);
    }

    if (format === "pcx") {
        return writePcx(outData);
    }

    // Default: PNG via pngjs (avoids base64 overhead of toDataURL)
    var outPng = new PNG({ width: canvas.width, height: canvas.height });
    outPng.data = Buffer.from(outData.data);
    return PNG.sync.write(outPng);
}

module.exports = {
    registerFont: registerFont, parseCommands: parseCommands,
    groupBoxesByHeight: groupBoxesByHeight, calculateGroupFontSize: calculateGroupFontSize,
    processBox: processBox, buildBoxes: buildBoxes,
    measureText: measureText, applyToImage: applyToImage,
    analyzeAndEraseSolid: analyzeAndEraseSolid, analyzeRegion: analyzeRegion,
    readBmp: readBmp, writeBmp: writeBmp,
    readTga: readTga, writeTga: writeTga,
    readPcx: readPcx, writePcx: writePcx,
    decodeImageAsync: decodeImageAsync,
};
