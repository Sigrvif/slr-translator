"use strict";
/*
 * inpaint.js — AOT (Aggregated Contextual Transformations) inpainting for SEP.
 *
 * Erases original text by filling masked regions with plausible background
 * content, using a lightweight 22 MB ONNX model. Much higher quality than blur
 * for complex backgrounds (gradients, textures, patterns).
 *
 * Model: AOTGenerator trained by zyddnys/manga-image-translator.
 *   Input  "image": 1×3×H×W float32 — masked RGB normalized to [-1, 1]
 *   Input  "mask":  1×1×H×W float32 — binary hole mask [0, 1] (1 = erase)
 *   Output "inpainted": 1×3×H×W float32 — filled RGB in [-1, 1]
 *
 * Pipeline (matching koharu / manga-image-translator):
 *   1. Resize full image to max-side 1024 (aspect preserved, Triangle filter).
 *   2. Draw binary mask from OCR text boxes; dilate (L∞ square, configurable r).
 *   3. Pad to multiple of 8 (min 68 px) via symmetric reflection (right/bottom).
 *   4. Normalize RGB (px/127.5 − 1), black out holes (img × (1 − mask)).
 *   5. Forward through AOT → denormalize ((out + 1) × 127.5).
 *   6. Crop padding, resize back to original (cubic), blend only masked pixels.
 */

var ort = require("onnxruntime-node");
var ortSession = require("./ort_session.js");

var _sessions = {};

function ensureModel(modelPath) {
    if (!_sessions[modelPath]) {
        _sessions[modelPath] = ortSession.createSession(modelPath);
    }
    return _sessions[modelPath];
}

function ceilMultiple(n, m) {
    return Math.ceil(n / m) * m;
}

// Symmetric reflection index (numpy "symmetric" mode).
// For index i >= n, mirror: 2*n-1-i. Only valid for i < 2*n.
function reflectIdx(i, n) {
    if (i < n) return i;
    return 2 * n - 1 - i;
}

// Separable L∞ (Chebyshev / square) morphological dilation on a single-channel
// Uint8 array. O(w*h*r) — fine for small radii (max ~8) and ≤1024 images.
function dilateMask(mask, w, h, r) {
    if (r <= 0) return;
    var tmp = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
        var off = y * w;
        for (var x = 0; x < w; x++) {
            var x0 = x - r; if (x0 < 0) x0 = 0;
            var x1 = x + r; if (x1 >= w) x1 = w - 1;
            var mx = 0;
            for (var xx = x0; xx <= x1; xx++) {
                var v = mask[off + xx];
                if (v > mx) { mx = v; if (mx >= 255) break; }
            }
            tmp[off + x] = mx;
        }
    }
    for (var y2 = 0; y2 < h; y2++) {
        var y0 = y2 - r; if (y0 < 0) y0 = 0;
        var y1 = y2 + r; if (y1 >= h) y1 = h - 1;
        for (var x2 = 0; x2 < w; x2++) {
            var my = 0;
            for (var yy = y0; yy <= y1; yy++) {
                var v2 = tmp[yy * w + x2];
                if (v2 > my) { my = v2; if (my >= 255) break; }
            }
            mask[y2 * w + x2] = my;
        }
    }
}

var MIN_DIM = 68;
var PAD_MULT = 8;
var MAX_SIDE = 100000;

// --- Alpha-aware inpainting (transparent-background handling) ---
// Both models consume RGB only and ignore alpha. On images with transparency,
// the RGB under transparent pixels is undefined (usually black), which starves
// the model of context, and the per-pixel alpha is never rewritten by the
// blend-back, so removed text stays opaque. The helpers below fix both:
//   * fillTransparentRGB  — diffuse plausible RGB into transparent regions so
//                           the model sees real background instead of a void;
//   * restoreAlphaField   — estimate the background alpha *under* the text by
//                           diffusing alpha from non-mask pixels inward, so the
//                           erased area reveals the true background opacity
//                           (independent of RGB colour/shade — never keyed).
var ALPHA_FILL_THRESH = 8;      // alpha < this ⇒ transparent (fill target / unknown)
var DIFFUSE_ITERS = 64;         // diffusion iterations (iterative Laplace solve)
var DIFFUSE_RADIUS_RGB = 3;     // box-blur radius for RGB context fill
var DIFFUSE_RADIUS_ALPHA = 2;   // box-blur radius for alpha restore (crisper edges)

async function inpaint(canvas, boxes, opts) {
    opts = opts || {};
    if (!boxes || boxes.length === 0) return;

    // Union bbox of all text boxes (axis-aligned, ignoring rotation) for the
    // alpha-aware preprocessing. Generous margins are added later, so the
    // rotation approximation is fine.
    var bbMinX = Infinity, bbMinY = Infinity, bbMaxX = -Infinity, bbMaxY = -Infinity;
    for (var bi0 = 0; bi0 < boxes.length; bi0++) {
        var b0 = boxes[bi0];
        var pw0 = b0.width * 0.05, ph0 = b0.height * 0.2;
        var x0b = b0.cx - b0.width / 2 - pw0, x1b = b0.cx + b0.width / 2 + pw0;
        var y0b = b0.cy - b0.height / 2 - ph0, y1b = b0.cy + b0.height / 2 + ph0;
        if (x0b < bbMinX) bbMinX = x0b; if (x1b > bbMaxX) bbMaxX = x1b;
        if (y0b < bbMinY) bbMinY = y0b; if (y1b > bbMaxY) bbMaxY = y1b;
    }
    var dilationA = Number(opts.dilation != null ? opts.dilation : 4);
    var ctxMarginA = Number(opts.margin != null ? opts.margin : 64);
    var pfMarginA = dilationA + ctxMarginA + 32;

    var session = await ensureModel(opts.modelPath);

    var origW = canvas.width, origH = canvas.height;
    var ctx = canvas.getContext("2d");

    var longer = Math.max(origW, origH);
    var scale = longer > MAX_SIDE ? MAX_SIDE / longer : 1.0;
    var sw = Math.max(1, Math.round(origW * scale));
    var sh = Math.max(1, Math.round(origH * scale));

    var pw = Math.max(ceilMultiple(sw, PAD_MULT), MIN_DIM);
    var ph = Math.max(ceilMultiple(sh, PAD_MULT), MIN_DIM);

    // --- Resize image to scaled size ---
    var imgC = document.createElement("canvas");
    imgC.width = sw; imgC.height = sh;
    var imgCx = imgC.getContext("2d");
    imgCx.imageSmoothingEnabled = true;
    imgCx.imageSmoothingQuality = "medium";
    imgCx.drawImage(canvas, 0, 0, origW, origH, 0, 0, sw, sh);
    var imgPx = imgCx.getImageData(0, 0, sw, sh).data;

    // Diffuse plausible RGB into transparent pixels so the model sees real
    // background context instead of an undefined black void (scaled coords).
    fillTransparentRGB(imgPx, sw, sh,
        (bbMinX - pfMarginA) * scale, (bbMinY - pfMarginA) * scale,
        (bbMaxX + pfMarginA) * scale, (bbMaxY + pfMarginA) * scale,
        ALPHA_FILL_THRESH, DIFFUSE_ITERS, DIFFUSE_RADIUS_RGB);

    // --- Build mask at scaled size via canvas ---
    var maskC = document.createElement("canvas");
    maskC.width = sw; maskC.height = sh;
    var maskCx = maskC.getContext("2d");
    maskCx.fillStyle = "#000";
    maskCx.fillRect(0, 0, sw, sh);
    maskCx.fillStyle = "#fff";
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var angleDeg = box._angle != null ? box._angle : 0;
        var padH = box.height * 0.2;
        var padW = box.width * 0.05;
        var bw = Math.max((box.width + padW * 2) * scale, 2);
        var bh = Math.max((box.height + padH * 2) * scale, 2);
        maskCx.save();
        maskCx.translate(box.cx * scale, box.cy * scale);
        if (Math.abs(angleDeg) > 0.1) maskCx.rotate(angleDeg * Math.PI / 180);
        maskCx.fillRect(-bw / 2, -bh / 2, bw, bh);
        maskCx.restore();
    }
    var maskPx = maskCx.getImageData(0, 0, sw, sh).data;
    var maskGray = new Uint8Array(sw * sh);
    for (var mi = 0; mi < sw * sh; mi++) maskGray[mi] = maskPx[mi * 4];

    // Quick exit if nothing to erase
    var hasMask = false;
    for (var ci = 0; ci < maskGray.length; ci++) { if (maskGray[ci] > 0) { hasMask = true; break; } }
    if (!hasMask) return;

    // --- Dilate mask ---
    var dilation = Number(opts.dilation != null ? opts.dilation : 4);
    dilateMask(maskGray, sw, sh, dilation);

    // --- Build NCHW tensors with padding + normalization ---
    var plane = pw * ph;
    var imageInput = new Float32Array(3 * plane);
    var maskInput = new Float32Array(plane);

    for (var py = 0; py < ph; py++) {
        var sy = py < sh ? py : reflectIdx(py, sh);
        if (sy < 0) sy = 0; else if (sy >= sh) sy = sh - 1;
        for (var px = 0; px < pw; px++) {
            var sx = px < sw ? px : reflectIdx(px, sw);
            if (sx < 0) sx = 0; else if (sx >= sw) sx = sw - 1;

            var sIdx = (sy * sw + sx) * 4;
            var di = py * pw + px;

            var m = maskGray[sy * sw + sx] / 255.0;
            var mInv = 1.0 - m;

            imageInput[di]             = (imgPx[sIdx]     / 127.5 - 1.0) * mInv;
            imageInput[plane + di]     = (imgPx[sIdx + 1] / 127.5 - 1.0) * mInv;
            imageInput[2 * plane + di] = (imgPx[sIdx + 2] / 127.5 - 1.0) * mInv;
            maskInput[di] = m;
        }
    }

    // --- Run model ---
    var feeds = {};
    feeds[session.inputNames[0]] = new ort.Tensor("float32", imageInput, [1, 3, ph, pw]);
    feeds[session.inputNames[1]] = new ort.Tensor("float32", maskInput, [1, 1, ph, pw]);
    var result = await session.run(feeds);
    var out = result[session.outputNames[0]].data;

    // --- Bilinear resize + blend directly into original canvas ---
    // Bypasses Canvas drawImage entirely for the upscale — its smoothing
    // can be unreliable for offscreen canvases in NW.js 0.52 (Chromium 89).
    // Model output (Float32Array, NCHW) is sampled with bilinear interpolation
    // at each original-resolution pixel; the mask is sampled the same way to
    // create a smooth feather at erase boundaries.

    // Find mask bounding box (scaled coords) to limit the iteration region.
    var mMinX = sw, mMinY = sh, mMaxX = 0, mMaxY = 0;
    for (var by = 0; by < sh; by++) {
        for (var bx = 0; bx < sw; bx++) {
            if (maskGray[by * sw + bx] > 0) {
                if (bx < mMinX) mMinX = bx;
                if (bx > mMaxX) mMaxX = bx;
                if (by < mMinY) mMinY = by;
                if (by > mMaxY) mMaxY = by;
            }
        }
    }

    var origData = ctx.getImageData(0, 0, origW, origH);
    var od = origData.data;

    // Alpha-aware preprocessing on the full-res buffer too: pre-fill RGB for
    // clean feather edges, and estimate the background alpha under the text.
    fillTransparentRGB(od, origW, origH,
        bbMinX - pfMarginA, bbMinY - pfMarginA, bbMaxX + pfMarginA, bbMaxY + pfMarginA,
        ALPHA_FILL_THRESH, DIFFUSE_ITERS, DIFFUSE_RADIUS_RGB);
    var restoredAlphaA = null;
    if (sw === origW && sh === origH) {
        restoredAlphaA = new Uint8Array(origW * origH);
        for (var ai2 = 0; ai2 < origW * origH; ai2++) restoredAlphaA[ai2] = od[ai2 * 4 + 3];
        restoreAlphaField(od, maskGray, origW, origH,
            bbMinX - dilationA - 8, bbMinY - dilationA - 8,
            bbMaxX + dilationA + 8, bbMaxY + dilationA + 8,
            restoredAlphaA, DIFFUSE_ITERS, DIFFUSE_RADIUS_ALPHA);
    }

    var invScale = 1.0 / scale;

    // Original-res coordinate bounds (expand 2px for feather margin)
    var oMinX = Math.max(0, Math.floor((mMinX - 2) * invScale));
    var oMaxX = Math.min(origW - 1, Math.ceil((mMaxX + 3) * invScale));
    var oMinY = Math.max(0, Math.floor((mMinY - 2) * invScale));
    var oMaxY = Math.min(origH - 1, Math.ceil((mMaxY + 3) * invScale));

    for (var oy = oMinY; oy <= oMaxY; oy++) {
        var sfy = oy * scale;
        var sy0 = sfy | 0;
        if (sy0 >= sh) sy0 = sh - 1;
        var sy1 = sy0 + 1; if (sy1 >= sh) sy1 = sh - 1;
        var fy = sfy - sy0;
        var ify = 1.0 - fy;

        for (var ox = oMinX; ox <= oMaxX; ox++) {
            var sfx = ox * scale;
            var sx0 = sfx | 0;
            if (sx0 >= sw) sx0 = sw - 1;
            var sx1 = sx0 + 1; if (sx1 >= sw) sx1 = sw - 1;
            var fx = sfx - sx0;
            var ifx = 1.0 - fx;

            // Bilinear mask sample → smooth alpha at boundaries
            var m00 = maskGray[sy0 * sw + sx0];
            var m01 = maskGray[sy0 * sw + sx1];
            var m10 = maskGray[sy1 * sw + sx0];
            var m11 = maskGray[sy1 * sw + sx1];
            var mTop = m00 * ifx + m01 * fx;
            var mBot = m10 * ifx + m11 * fx;
            var alpha = (mTop * ify + mBot * fy) / 255.0;
            if (alpha <= 0.001) continue;

            // Bilinear sample model output (NCHW: plane offsets per channel)
            var i00 = sy0 * pw + sx0, i01 = sy0 * pw + sx1;
            var i10 = sy1 * pw + sx0, i11 = sy1 * pw + sx1;

            var rT = out[i00]             * ifx + out[i01]             * fx;
            var rB = out[i10]             * ifx + out[i11]             * fx;
            var gT = out[plane + i00]     * ifx + out[plane + i01]     * fx;
            var gB = out[plane + i10]     * ifx + out[plane + i11]     * fx;
            var bT = out[2 * plane + i00] * ifx + out[2 * plane + i01] * fx;
            var bB = out[2 * plane + i10] * ifx + out[2 * plane + i11] * fx;

            // Denormalize [-1,1] → [0,255]
            var r = (rT * ify + rB * fy + 1.0) * 127.5;
            var g = (gT * ify + gB * fy + 1.0) * 127.5;
            var b = (bT * ify + bB * fy + 1.0) * 127.5;

            var di = (oy * origW + ox) * 4;
            if (alpha >= 0.999) {
                od[di]     = r < 0 ? 0 : r > 255 ? 255 : r;
                od[di + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
                od[di + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
            } else {
                var ia = 1.0 - alpha;
                od[di]     = od[di]     * ia + (r < 0 ? 0 : r > 255 ? 255 : r) * alpha;
                od[di + 1] = od[di + 1] * ia + (g < 0 ? 0 : g > 255 ? 255 : g) * alpha;
                od[di + 2] = od[di + 2] * ia + (b < 0 ? 0 : b > 255 ? 255 : b) * alpha;
            }

            // Blend the restored background alpha with the same feather factor.
            if (restoredAlphaA) {
                od[di + 3] = od[di + 3] * (1.0 - alpha) + restoredAlphaA[oy * origW + ox] * alpha;
            }
        }
    }
    ctx.putImageData(origData, 0, 0);
}

// ============================================================
// LaMa inpainting — fixed 512×512 input, per-region crops
// ============================================================
// LaMa (big-lama via Carve ONNX export) uses FFT-based FFC convolutions
// and has a HARD-CODED 512×512 input shape.  Instead of resizing the
// whole image (which destroys detail), we crop a 512×512 window around
// each text region (grouping nearby boxes), run the model at native
// resolution, and paste back only the masked pixels.
//
// Input:  image 1×3×512×512 float32 — raw [0,255] (no normalization)
//         mask  1×1×512×512 float32 — {0,1}, 1 = hole
// Output: output 1×3×512×512 float32 — raw [0,255]
// The model masks the image internally (no manual masking needed).

var LAMA_CROP = 512;

function groupBoxesForCrop(boxes, maxDist) {
    if (!boxes.length) return [];
    var groups = [], assigned = new Array(boxes.length).fill(false);
    for (var i = 0; i < boxes.length; i++) {
        if (assigned[i]) continue;
        var group = [boxes[i]];
        assigned[i] = true;
        var changed = true;
        while (changed) {
            changed = false;
            for (var j = 0; j < boxes.length; j++) {
                if (assigned[j]) continue;
                for (var k = 0; k < group.length; k++) {
                    if (Math.abs(boxes[j].cx - group[k].cx) < maxDist &&
                        Math.abs(boxes[j].cy - group[k].cy) < maxDist) {
                        group.push(boxes[j]);
                        assigned[j] = true;
                        changed = true;
                        break;
                    }
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

function reflectClamp(i, n) {
    if (i < 0) i = -i - 1;
    else if (i >= n) i = 2 * n - 1 - i;
    if (i < 0) i = 0; else if (i >= n) i = n - 1;
    return i;
}

// Box-blur a single-channel mask within a bounding box (feathering).
function featherMask(mask, w, h, r, bx0, by0, bx1, by1) {
    bx0 = Math.max(0, bx0 - r); by0 = Math.max(0, by0 - r);
    bx1 = Math.min(w - 1, bx1 + r); by1 = Math.min(h - 1, by1 + r);
    var bw = bx1 - bx0 + 1;
    var tmp = new Float32Array(bw * (by1 - by0 + 1));
    // Horizontal pass
    for (var y = by0; y <= by1; y++) {
        var soff = y * w, doff = (y - by0) * bw;
        for (var x = bx0; x <= bx1; x++) {
            var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
            var sum = 0;
            for (var xx = x0; xx <= x1; xx++) sum += mask[soff + xx];
            tmp[doff + (x - bx0)] = sum / (x1 - x0 + 1);
        }
    }
    // Vertical pass
    for (var x = bx0; x <= bx1; x++) {
        var dx = x - bx0;
        for (var y = by0; y <= by1; y++) {
            var y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
            var sum = 0;
            for (var yy = y0; yy <= y1; yy++) sum += tmp[(yy - by0) * bw + dx];
            mask[y * w + x] = sum / (y1 - y0 + 1);
        }
    }
}

function clampi(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// Separable box blur on a contiguous Float32Array of size w*h with edge clamp
// (replicate border). Running-sum implementation: O(w*h) regardless of radius.
// Horizontal pass writes into t1; vertical pass writes the result back into buf.
function boxBlurF32(buf, w, h, r, t1) {
    var win = 2 * r + 1;
    // Horizontal: buf -> t1
    for (var y = 0; y < h; y++) {
        var ry = y * w, sum = 0, k;
        for (k = -r; k <= r; k++) { var ch = k < 0 ? 0 : (k >= w ? w - 1 : k); sum += buf[ry + ch]; }
        t1[ry] = sum / win;
        for (var x = 1; x < w; x++) {
            var add = x + r; if (add >= w) add = w - 1;
            var sub = x - 1 - r; if (sub < 0) sub = 0;
            sum += buf[ry + add] - buf[ry + sub];
            t1[ry + x] = sum / win;
        }
    }
    // Vertical: t1 -> buf
    for (var x = 0; x < w; x++) {
        var sum = 0, k;
        for (k = -r; k <= r; k++) { var cv = k < 0 ? 0 : (k >= h ? h - 1 : k); sum += t1[cv * w + x]; }
        buf[x] = sum / win;
        for (var y = 1; y < h; y++) {
            var add = y + r; if (add >= h) add = h - 1;
            var sub = y - 1 - r; if (sub < 0) sub = 0;
            sum += t1[add * w + x] - t1[sub * w + x];
            buf[y * w + x] = sum / win;
        }
    }
}

// Iterative diffusion: blur the field, then restore "known" samples to their
// fixed seed values (Dirichlet boundary). Repeated passes converge toward a
// smooth harmonic interpolation of the seeds across the unknown region.
function diffuseField(buf, known, seed, n, w, h, iters, r) {
    var t1 = new Float32Array(n);
    for (var it = 0; it < iters; it++) {
        boxBlurF32(buf, w, h, r, t1);
        for (var i = 0; i < n; i++) if (known[i]) buf[i] = seed[i];
    }
}

// Fill the RGB of transparent pixels (alpha < thresh) inside the bbox by
// diffusing colour inward from opaque (alpha >= thresh) neighbours. Modifies
// `data` (RGBA, Uint8ClampedArray) in place; opaque pixels are untouched.
function fillTransparentRGB(data, w, h, bx0, by0, bx1, by1, thresh, iters, r) {
    bx0 = clampi(bx0, 0, w - 1); by0 = clampi(by0, 0, h - 1);
    bx1 = clampi(bx1, 0, w - 1); by1 = clampi(by1, 0, h - 1);
    var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, n = bw * bh;
    if (n <= 0) return;
    var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    var sR = new Float32Array(n), sG = new Float32Array(n), sB = new Float32Array(n);
    var known = new Uint8Array(n), anyKnown = false, anyUnknown = false;
    var sumR = 0, sumG = 0, sumB = 0, cntK = 0;
    for (var y = 0; y < bh; y++) {
        var gy = by0 + y;
        for (var x = 0; x < bw; x++) {
            var si = (gy * w + (bx0 + x)) * 4, di = y * bw + x;
            if (data[si + 3] >= thresh) {
                var rr = data[si], gg = data[si + 1], bb = data[si + 2];
                R[di] = rr; G[di] = gg; B[di] = bb;
                sR[di] = rr; sG[di] = gg; sB[di] = bb;
                known[di] = 1; anyKnown = true;
                sumR += rr; sumG += gg; sumB += bb; cntK++;
            } else { anyUnknown = true; }
        }
    }
    if (!anyKnown || !anyUnknown) return;
    // Seed unknown pixels with the mean known colour: this removes the dominant
    // constant error mode, so the diffusion converges much faster to the smooth
    // harmonic fill (important for larger transparent gaps).
    var meanR = sumR / cntK, meanG = sumG / cntK, meanB = sumB / cntK;
    for (var u = 0; u < n; u++) {
        if (!known[u]) { R[u] = meanR; G[u] = meanG; B[u] = meanB; }
    }
    diffuseField(R, known, sR, n, bw, bh, iters, r);
    diffuseField(G, known, sG, n, bw, bh, iters, r);
    diffuseField(B, known, sB, n, bw, bh, iters, r);
    for (var y2 = 0; y2 < bh; y2++) {
        var gy2 = by0 + y2;
        for (var x2 = 0; x2 < bw; x2++) {
            var di2 = y2 * bw + x2;
            if (known[di2]) continue;
            var si2 = (gy2 * w + (bx0 + x2)) * 4;
            var rr = R[di2], gg = G[di2], bb = B[di2];
            data[si2]     = rr < 0 ? 0 : rr > 255 ? 255 : rr;
            data[si2 + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
            data[si2 + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        }
    }
}

// Estimate the background alpha inside the text mask by diffusing alpha from
// non-mask pixels inward. `outAlpha` is a full w*h buffer pre-seeded with the
// original alpha; only mask pixels are overwritten with the restored estimate.
function restoreAlphaField(data, mask, w, h, bx0, by0, bx1, by1, outAlpha, iters, r) {
    bx0 = clampi(bx0, 0, w - 1); by0 = clampi(by0, 0, h - 1);
    bx1 = clampi(bx1, 0, w - 1); by1 = clampi(by1, 0, h - 1);
    var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, n = bw * bh;
    if (n <= 0) return;
    var A = new Float32Array(n), seedA = new Float32Array(n), known = new Uint8Array(n);
    var anyKnown = false, mean = 0, cnt = 0;
    for (var y = 0; y < bh; y++) {
        var gy = by0 + y;
        for (var x = 0; x < bw; x++) {
            var gx = bx0 + x, mi = gy * w + gx, di = y * bw + x;
            if (mask[mi] === 0) {
                var a = data[mi * 4 + 3];
                A[di] = a; seedA[di] = a; known[di] = 1; anyKnown = true;
                mean += a; cnt++;
            }
        }
    }
    if (!anyKnown) return;
    var initUnk = cnt ? mean / cnt : 0;
    for (var i = 0; i < n; i++) if (!known[i]) A[i] = initUnk;
    diffuseField(A, known, seedA, n, bw, bh, iters, r);
    for (var y2 = 0; y2 < bh; y2++) {
        var gy2 = by0 + y2;
        for (var x2 = 0; x2 < bw; x2++) {
            var mi2 = gy2 * w + (bx0 + x2);
            if (mask[mi2] !== 0) {
                var v = A[y2 * bw + x2];
                outAlpha[mi2] = v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0;
            }
        }
    }
}

async function inpaintLama(canvas, boxes, opts) {
    opts = opts || {};
    if (!boxes || boxes.length === 0) return;

    var session = await ensureModel(opts.modelPath);
    var origW = canvas.width, origH = canvas.height;
    var ctx = canvas.getContext("2d");
    var dilation = Number(opts.dilation != null ? opts.dilation : 4);

    // --- Build binary mask at original resolution ---
    var maskC = document.createElement("canvas");
    maskC.width = origW; maskC.height = origH;
    var maskCx = maskC.getContext("2d");
    maskCx.fillStyle = "#000";
    maskCx.fillRect(0, 0, origW, origH);
    maskCx.fillStyle = "#fff";
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var angleDeg = box._angle != null ? box._angle : 0;
        var padH = box.height * 0.2;
        var padW = box.width * 0.05;
        maskCx.save();
        maskCx.translate(box.cx, box.cy);
        if (Math.abs(angleDeg) > 0.1) maskCx.rotate(angleDeg * Math.PI / 180);
        maskCx.fillRect(-(box.width + padW * 2) / 2, -(box.height + padH * 2) / 2,
                        box.width + padW * 2, box.height + padH * 2);
        maskCx.restore();
    }
    var maskPx = maskCx.getImageData(0, 0, origW, origH).data;
    var maskBinary = new Uint8Array(origW * origH);
    for (var mi = 0; mi < origW * origH; mi++) maskBinary[mi] = maskPx[mi * 4];
    dilateMask(maskBinary, origW, origH, dilation);

    var hasMask = false;
    var mbMinX = origW, mbMinY = origH, mbMaxX = 0, mbMaxY = 0;
    for (var ci = 0; ci < maskBinary.length; ci++) {
        if (maskBinary[ci] > 0) {
            hasMask = true;
            var cy = (ci / origW) | 0, cx = ci - cy * origW;
            if (cx < mbMinX) mbMinX = cx; if (cx > mbMaxX) mbMaxX = cx;
            if (cy < mbMinY) mbMinY = cy; if (cy > mbMaxY) mbMaxY = cy;
        }
    }
    if (!hasMask) return;

    // --- Feathered mask for smooth blend edges ---
    var maskBlend = new Uint8Array(maskBinary);
    featherMask(maskBlend, origW, origH, 3, mbMinX, mbMinY, mbMaxX, mbMaxY);

    // --- Read original image ---
    var origData = ctx.getImageData(0, 0, origW, origH);
    var od = origData.data;
    var plane = LAMA_CROP * LAMA_CROP;

    // --- Alpha-aware preprocessing (transparent backgrounds) ---
    // (1) Diffuse plausible RGB into transparent pixels near the text so the
    //     model has real context instead of an undefined black void.
    var ctxMarginL = Number(opts.margin != null ? opts.margin : 64);
    var pfMarginL = dilation + ctxMarginL + 32;
    fillTransparentRGB(od, origW, origH,
        mbMinX - pfMarginL, mbMinY - pfMarginL, mbMaxX + pfMarginL, mbMaxY + pfMarginL,
        ALPHA_FILL_THRESH, DIFFUSE_ITERS, DIFFUSE_RADIUS_RGB);
    // (2) Estimate the background alpha under the text by diffusing alpha from
    //     the surrounding (non-mask) pixels. Applied during blend-back so the
    //     erased area shows the true background opacity, never the text's own.
    var restoredAlpha = new Uint8Array(origW * origH);
    for (var ai = 0; ai < origW * origH; ai++) restoredAlpha[ai] = od[ai * 4 + 3];
    restoreAlphaField(od, maskBinary, origW, origH,
        mbMinX - dilation - 8, mbMinY - dilation - 8,
        mbMaxX + dilation + 8, mbMaxY + dilation + 8,
        restoredAlpha, DIFFUSE_ITERS, DIFFUSE_RADIUS_ALPHA);

    var groups = groupBoxesForCrop(boxes, 256);

    for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var bi = 0; bi < group.length; bi++) {
            var b = group[bi];
            minX = Math.min(minX, b.cx - b.width / 2);
            maxX = Math.max(maxX, b.cx + b.width / 2);
            minY = Math.min(minY, b.cy - b.height / 2);
            maxY = Math.max(maxY, b.cy + b.height / 2);
        }

        // Scale: 1.0 if the group + margin fits in 512px, else downscale
        var contextMargin = Number(opts.margin != null ? opts.margin : 64);
        var margin = dilation + contextMargin;
        var regionW = (maxX - minX) + 2 * margin;
        var regionH = (maxY - minY) + 2 * margin;
        var scale = Math.min(1.0, LAMA_CROP / Math.max(regionW, regionH));
        var invScale = 1.0 / scale;
        var cropOrigSize = LAMA_CROP * invScale;
        var cropX = (minX + maxX) / 2 - cropOrigSize / 2;
        var cropY = (minY + maxY) / 2 - cropOrigSize / 2;

        // --- Build 512×512 tensors (bilinear with symmetric reflection) ---
        var imgIn = new Float32Array(3 * plane);
        var maskIn = new Float32Array(plane);
        for (var py = 0; py < LAMA_CROP; py++) {
            var oy = cropY + py * invScale;
            var oy0 = Math.floor(oy), oy1 = oy0 + 1;
            var fy = oy - oy0, ify = 1.0 - fy;
            oy0 = reflectClamp(oy0, origH); oy1 = reflectClamp(oy1, origH);

            for (var px = 0; px < LAMA_CROP; px++) {
                var ox = cropX + px * invScale;
                var ox0 = Math.floor(ox), ox1 = ox0 + 1;
                var fx = ox - ox0, ifx = 1.0 - fx;
                ox0 = reflectClamp(ox0, origW); ox1 = reflectClamp(ox1, origW);

                var di = py * LAMA_CROP + px;
                var i00 = (oy0 * origW + ox0) * 4;
                var i01 = (oy0 * origW + ox1) * 4;
                var i10 = (oy1 * origW + ox0) * 4;
                var i11 = (oy1 * origW + ox1) * 4;

                // Bilinear RGB → [0, 1]
                imgIn[di]             = ((od[i00]   * ifx + od[i01]   * fx) * ify + (od[i10]   * ifx + od[i11]   * fx) * fy) / 255.0;
                imgIn[plane + di]     = ((od[i00+1] * ifx + od[i01+1] * fx) * ify + (od[i10+1] * ifx + od[i11+1] * fx) * fy) / 255.0;
                imgIn[2 * plane + di] = ((od[i00+2] * ifx + od[i01+2] * fx) * ify + (od[i10+2] * ifx + od[i11+2] * fx) * fy) / 255.0;

                // Bilinear mask
                var m00 = maskBinary[oy0 * origW + ox0], m01 = maskBinary[oy0 * origW + ox1];
                var m10 = maskBinary[oy1 * origW + ox0], m11 = maskBinary[oy1 * origW + ox1];
                maskIn[di] = ((m00 * ifx + m01 * fx) * ify + (m10 * ifx + m11 * fx) * fy) / 255.0;
            }
        }

        // --- Run LaMa ---
        var feeds = {
            image: new ort.Tensor("float32", imgIn, [1, 3, LAMA_CROP, LAMA_CROP]),
            mask: new ort.Tensor("float32", maskIn, [1, 1, LAMA_CROP, LAMA_CROP]),
        };
        var result = await session.run(feeds);
        var out = result.output.data;

        // --- Blend back: bilinear from 512×512 to original, feathered mask ---
        var by0 = Math.max(0, Math.floor(cropY));
        var by1 = Math.min(origH, Math.ceil(cropY + cropOrigSize));
        var bx0 = Math.max(0, Math.floor(cropX));
        var bx1 = Math.min(origW, Math.ceil(cropX + cropOrigSize));

        for (var oy2 = by0; oy2 < by1; oy2++) {
            var ry = (oy2 - cropY) * scale;
            var ry0 = ry | 0, ry1 = Math.min(LAMA_CROP - 1, ry0 + 1);
            var fry = ry - ry0, ifry = 1.0 - fry;
            var r0off = ry0 * LAMA_CROP, r1off = ry1 * LAMA_CROP;

            for (var ox2 = bx0; ox2 < bx1; ox2++) {
                var origIdx = oy2 * origW + ox2;
                var m = maskBlend[origIdx] / 255.0;
                if (m < 0.01) continue;

                var rx = (ox2 - cropX) * scale;
                var rx0 = rx | 0, rx1 = Math.min(LAMA_CROP - 1, rx0 + 1);
                var frx = rx - rx0, ifrx = 1.0 - frx;

                var di = origIdx * 4;
                var im = 1.0 - m;

                for (var c = 0; c < 3; c++) {
                    var base = c * plane;
                    var v = (out[base + r0off + rx0] * ifrx + out[base + r0off + rx1] * frx) * ifry +
                            (out[base + r1off + rx0] * ifrx + out[base + r1off + rx1] * frx) * fry;
                    v = v < 0 ? 0 : v > 255 ? 255 : v;
                    od[di + c] = od[di + c] * im + v * m;
                }

                // Blend the restored background alpha with the same feather
                // factor, so removed text reveals the underlying opacity.
                od[di + 3] = od[di + 3] * im + restoredAlpha[origIdx] * m;
            }
        }
    }

    ctx.putImageData(origData, 0, 0);
}

module.exports = {
    inpaint: inpaint,
    inpaintLama: inpaintLama,
    ensureModel: ensureModel,
};
