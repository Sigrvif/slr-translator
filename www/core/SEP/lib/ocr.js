"use strict";
/*
 * ocr.js — PaddleOCR PP-OCRv6 detection + recognition via onnxruntime-node.
 * No Python, no sharp. Runs directly inside NW.js (ORT + Canvas both work;
 * only sharp deadlocked against Chromium's event loop).
 *
 * Pipeline:
 *   detection: DB postprocess (threshold -> connected components -> oriented bbox)
 *   recognition: text-line crop -> resize to (3,48,W) -> CTC decode
 *
 * Image I/O uses pngjs/jpeg-js (pure JS) + Canvas 2D (resize/crop/rotate).
 */

var ort = require("onnxruntime-node");
var ortSession = require("./ort_session.js");
var fs = require("fs");
var PNG = require("pngjs").PNG;
var jpeg = require("jpeg-js");

var MEAN = [0.485, 0.456, 0.406];
var STD = [0.229, 0.224, 0.225];
var DET_LIMIT_SIDE = 64;
var REC_H = 48;
var DET_THRESH = 0.30;
var DET_BOX_THRESH = 0.60;
var DET_UNCLIP = 2.0;
var DET_MIN_AREA = 12;

var _det = null, _rec = null, _chars = null;

async function loadModels(dir) {
    _det = await ortSession.createSession(dir + "/PP-OCRv6_medium_det.onnx");
    _rec = await ortSession.createSession(dir + "/PP-OCRv6_medium_rec.onnx");
    var raw = fs.readFileSync(dir + "/ppocrv6_dict.txt", "utf8");
    var lines = raw.split(/\r?\n/);
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    _chars = [""].concat(lines).concat([" "]);
    return { det: _det, rec: _rec, numChars: _chars.length };
}

// ---- image loading (pngjs / jpeg-js, pure JS) ----
function loadPixels(path) {
    var buf = fs.readFileSync(path);
    if (path.match(/\.jpe?g$/i)) {
        var jd = jpeg.decode(buf, { useTArray: true });
        return { width: jd.width, height: jd.height, data: jd.data };
    }
    var png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
}

// Flatten alpha onto an opaque background so the OCR detection model
// sees solid pixels. Transparent regions carry unpredictable RGB (often 0,0,0)
// which creates false text boxes and masks real text. Only the OCR pass is
// affected — exported images keep their original alpha (render.js reads the
// source PNG directly).
//
// The fill color is chosen from the CONTENT at transparency boundaries (not
// the global opaque average, which is skewed when large opaque regions with a
// different background coexist with small transparent text regions).
//   1. Semi-transparent pixels (anti-aliased text edges): PNG uses straight
//      alpha, so their RGB retains the original content color.
//   2. Hard binary mask fallback: opaque pixels that border transparent pixels
//      — these are the text/content pixels visible at transparent regions.
// The fill is the opposite of the sampled luminance for maximum contrast.
function flattenAlpha(pixels) {
    var data = pixels.data;
    var w = pixels.width, h = pixels.height;
    var n = w * h;
    var hasAlpha = false;
    for (var i = 0; i < n; i++) {
        if (data[i * 4 + 3] < 255) { hasAlpha = true; break; }
    }
    if (!hasAlpha) return;

    var sum = 0, count = 0;
    // Pass 1: semi-transparent pixels (anti-aliased edges).
    for (var i = 0; i < n; i++) {
        var a = data[i * 4 + 3];
        if (a > 0 && a < 255) {
            sum += 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
            count++;
        }
    }
    // Pass 2 (fallback for hard masks): opaque pixels bordering transparency.
    if (count === 0) {
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var idx = (y * w + x) * 4;
                if (data[idx + 3] < 128) continue;
                if ((x > 0 && data[idx - 4 + 3] < 128) ||
                    (x < w - 1 && data[idx + 4 + 3] < 128) ||
                    (y > 0 && data[idx - w * 4 + 3] < 128) ||
                    (y < h - 1 && data[idx + w * 4 + 3] < 128)) {
                    sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                    count++;
                }
            }
        }
    }
    var fill = (count > 0 && sum / count >= 128) ? 0 : 255;

    for (var i = 0; i < n; i++) {
        var idx = i * 4;
        var a = data[idx + 3] / 255;
        var ia = 1 - a;
        data[idx]     = data[idx]     * a + fill * ia;
        data[idx + 1] = data[idx + 1] * a + fill * ia;
        data[idx + 2] = data[idx + 2] * a + fill * ia;
        data[idx + 3] = 255;
    }
}

// ---- Canvas helpers ----
function canvasFromPixels(pixels) {
    var c = document.createElement("canvas");
    c.width = pixels.width;
    c.height = pixels.height;
    var ctx = c.getContext("2d");
    var imageData = ctx.createImageData(pixels.width, pixels.height);
    imageData.data.set(pixels.data);
    ctx.putImageData(imageData, 0, 0);
    return c;
}

function resizeCanvas(srcCanvas, dstW, dstH) {
    var c = document.createElement("canvas");
    c.width = dstW;
    c.height = dstH;
    c.getContext("2d").drawImage(srcCanvas, 0, 0, dstW, dstH);
    return c;
}

function canvasToRGBFloat(canvas, mean, std) {
    var w = canvas.width, h = canvas.height;
    var rgba = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var out = new Float32Array(3 * h * w);
    for (var i = 0; i < h * w; i++) {
        out[0 * h * w + i] = (rgba[i * 4] / 255 - mean[0]) / std[0];
        out[1 * h * w + i] = (rgba[i * 4 + 1] / 255 - mean[1]) / std[1];
        out[2 * h * w + i] = (rgba[i * 4 + 2] / 255 - mean[2]) / std[2];
    }
    return out;
}

function canvasToRGBFloat01(canvas) {
    var w = canvas.width, h = canvas.height;
    var rgba = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var out = new Float32Array(3 * h * w);
    for (var i = 0; i < h * w; i++) {
        out[0 * h * w + i] = rgba[i * 4] / 255;
        out[1 * h * w + i] = rgba[i * 4 + 1] / 255;
        out[2 * h * w + i] = rgba[i * 4 + 2] / 255;
    }
    return out;
}

function round32(v) { return Math.max(32, Math.ceil(v / 32) * 32); }

// ---- detection ----
async function detect(srcCanvas) {
    var srcW = srcCanvas.width, srcH = srcCanvas.height;
    var ratio = DET_LIMIT_SIDE / Math.min(srcW, srcH);
    ratio = Math.max(1, ratio);
    var W = round32(srcW * ratio), H = round32(srcH * ratio);

    var resized = resizeCanvas(srcCanvas, W, H);
    var tensorData = canvasToRGBFloat(resized, MEAN, STD);
    var res = await _det.run({ x: new ort.Tensor("float32", tensorData, [1, 3, H, W]) });
    var out = res[_det.outputNames[0]];
    var oh = out.dims[2], ow = out.dims[3];
    var prob = out.data;

    var bin = new Uint8Array(oh * ow);
    for (var i = 0; i < prob.length; i++) bin[i] = prob[i] > DET_THRESH ? 1 : 0;

    var comp = new Int32Array(oh * ow).fill(-1);
    var comps = [];
    var label = 0;
    for (var y = 0; y < oh; y++) {
        for (var x = 0; x < ow; x++) {
            var idx = y * ow + x;
            if (!bin[idx] || comp[idx] !== -1) continue;
            var stack = [idx]; comp[idx] = label;
            var pts = []; var sum = 0;
            while (stack.length) {
                var p = stack.pop(); var py = (p / ow) | 0, px = p - py * ow;
                pts.push([px, py]); sum += prob[p];
                var n = [px > 0 ? p - 1 : -1, px < ow - 1 ? p + 1 : -1, py > 0 ? p - ow : -1, py < oh - 1 ? p + ow : -1];
                for (var ni = 0; ni < 4; ni++) {
                    var q = n[ni];
                    if (q >= 0 && bin[q] && comp[q] === -1) { comp[q] = label; stack.push(q); }
                }
            }
            comps.push({ pts: pts, sum: sum, count: pts.length });
            label++;
        }
    }

    var sxRatio = srcW / ow, syRatio = srcH / oh;
    var boxes = [];
    for (var ci = 0; ci < comps.length; ci++) {
        var c = comps[ci];
        if (c.count < DET_MIN_AREA) continue;
        if (c.sum / c.count < DET_BOX_THRESH) continue;
        var obb = pcaOBB(c.pts);
        if (!obb) continue;
        var nw = obb.w * DET_UNCLIP, nh = obb.h * DET_UNCLIP;
        var corners = rectCorners(obb.cx, obb.cy, nw, nh, obb.angle);
        var scaled = corners.map(function (p) { return [p[0] * sxRatio, p[1] * syRatio]; });
        var recMargin = 4;
        var rw = (obb.w + recMargin * 2) * sxRatio;
        var rh = (obb.h + recMargin * 2) * syRatio;
        boxes.push({
            points: scaled,
            cx: obb.cx * sxRatio, cy: obb.cy * syRatio,
            w: nw * sxRatio, h: nh * syRatio,
            recW: rw, recH: rh,
            angle: obb.angle,
        });
    }
    return boxes;
}

function pcaOBB(pts) {
    var n = pts.length;
    if (n < 4) return null;
    var mx = 0, my = 0;
    for (var i = 0; i < n; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= n; my /= n;
    var sxx = 0, syy = 0, sxy = 0;
    for (var i = 0; i < n; i++) {
        var dx = pts[i][0] - mx, dy = pts[i][1] - my;
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= n; syy /= n; sxy /= n;
    var trace = sxx + syy, det = sxx * syy - sxy * sxy;
    var disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
    var lam1 = trace / 2 + disc;
    var ang;
    if (Math.abs(sxy) > 1e-9) ang = Math.atan2(lam1 - sxx, sxy);
    else ang = sxx >= syy ? 0 : Math.PI / 2;
    var cos = Math.cos(ang), sin = Math.sin(ang);
    var minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (var i = 0; i < n; i++) {
        var dx = pts[i][0] - mx, dy = pts[i][1] - my;
        var a = dx * cos + dy * sin;
        var b = -dx * sin + dy * cos;
        if (a < minA) minA = a; if (a > maxA) maxA = a;
        if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
    var w = maxA - minA + 1, h = maxB - minB + 1;
    var ca = (minA + maxA) / 2, cb = (minB + maxB) / 2;
    var cx = mx + ca * cos - cb * sin;
    var cy = my + ca * sin + cb * cos;
    var W = w, H = h, A = ang;
    if (W < H) { var t = W; W = H; H = t; A += Math.PI / 2; }
    A = ((A + Math.PI / 2) % Math.PI) - Math.PI / 2;
    return { cx: cx, cy: cy, w: W, h: H, angle: A };
}

function rectCorners(cx, cy, w, h, angle) {
    var cos = Math.cos(angle), sin = Math.sin(angle);
    var hw = w / 2, hh = h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(function (p) {
        return [cx + p[0] * cos - p[1] * sin, cy + p[0] * sin + p[1] * cos];
    });
}

// ---- recognition ----
// angleOffset (radians) is added to the deskew rotation.
//   0        -> standard horizontal deskew (text rotated to horizontal).
//   Math.PI  -> the 180°-flipped "vertical" orientation: this reproduces the
//               vertical-text crop PaddleOCR produces via np.rot90 (CCW) in
//               get_rotate_crop_image — the column reads left→right with every
//               glyph lying on its left side (head pointing left). PP-OCRv6's
//               recognition model is trained on exactly this orientation for
//               vertical text, so this is the rotation that lets it decode
//               vertical (tategaki) columns. The plain deskew rotates vertical
//               columns the opposite way (CW, head-right, reversed order) which
//               the model cannot read — hence the separate vertical pass.
async function recognize(srcCanvas, box, angleOffset) {
    angleOffset = angleOffset || 0;
    var recW_px = box.recW || box.w;
    var recH_px = box.recH || box.h;
    var margin = 4;
    var cropW = Math.ceil(recW_px + margin * 2);
    var cropH = Math.ceil(recH_px + margin * 2);
    if (cropW < 2) cropW = 2; if (cropH < 2) cropH = 2;

    // Transform-based deskew crop: draw source rotated to horizontal on a
    // tight canvas. This avoids AABB background corners that degrade OCR.
    var cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW; cropCanvas.height = cropH;
    var cropCtx = cropCanvas.getContext("2d");
    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, cropW, cropH);
    cropCtx.save();
    cropCtx.translate(cropW / 2, cropH / 2);
    cropCtx.rotate(-box.angle + angleOffset);  // deskew (+ optional vertical flip)
    cropCtx.translate(-box.cx, -box.cy);
    cropCtx.drawImage(srcCanvas, 0, 0);
    cropCtx.restore();

    // Resize to rec height
    var recW = Math.round((REC_H / cropH) * cropW);
    if (recW < 1) recW = 1;
    if (recW > REC_H * 100) recW = REC_H * 100;

    var resized = resizeCanvas(cropCanvas, recW, REC_H);
    // PP-OCRv6 has normalization baked in: raw [0,1] RGB
    var tensorData = canvasToRGBFloat01(resized);

    var res = await _rec.run({ x: new ort.Tensor("float32", tensorData, [1, 3, REC_H, recW]) });
    return ctcDecode(res[_rec.outputNames[0]]);
}

function ctcDecode(out) {
    var dims = out.dims;
    var T = dims.length === 3 ? dims[1] : dims[0];
    var C = dims[dims.length - 1];
    var data = out.data;
    var blank = 0;
    var chars = [], prev = -1, confSum = 0, confN = 0;
    for (var t = 0; t < T; t++) {
        var row = t * C;
        var best = 0, bestv = -Infinity;
        for (var c = 0; c < C; c++) {
            if (data[row + c] > bestv) { bestv = data[row + c]; best = c; }
        }
        if (best !== blank && best !== prev && best < _chars.length) {
            chars.push(_chars[best]);
            confSum += bestv; confN++;
        }
        prev = best;
    }
    return { text: chars.join(""), score: confN ? confSum / confN : 0 };
}

// Choose the better of two recognition results. Used to pick between the
// horizontal and vertical recognition passes for vertical-looking boxes.
// "Better" = higher mean confidence; on a near-tie the longer (more complete)
// reading wins, so a short spuriously-confident misdetection cannot beat a
// full correct reading. `b` is preferred on ties because it is only ever the
// vertical candidate (called for boxes already deemed vertical-looking).
function pickBetter(a, b) {
    var aOk = a && a.text && a.text.trim();
    var bOk = b && b.text && b.text.trim();
    if (!aOk && !bOk) return a;
    if (!aOk) return b;
    if (!bOk) return a;
    if (a.text === b.text) return a.score >= b.score ? a : b;
    if (Math.abs(a.score - b.score) < 0.1) return b.text.length >= a.text.length ? b : a;
    return b.score > a.score ? b : a;
}

// ---- top-level ----
async function ocrImage(path, opts) {
    if (!_det) throw new Error("OCR models not loaded; call loadModels(dir) first");
    opts = opts || {};
    // Vertical-text support. pcaOBB always returns landscape boxes (W >= H)
    // with angle in [-90°, 90°]: angle ≈ 0° is a horizontal text line, angle
    // ≈ ±90° is a vertical text column. For boxes that are far from horizontal
    // (|angle| >= verticalAngleThreshold), run a second recognition pass in
    // the vertical orientation (angleOffset = π) and keep the better result.
    // Boxes near horizontal — the vast majority of RPG Maker text — are
    // recognised exactly once, so horizontal accuracy and speed are unchanged.
    var enableVertical = opts.enableVerticalOCR !== false;
    var vertThreshDeg = Number(opts.verticalAngleThreshold);
    if (!(vertThreshDeg > 0)) vertThreshDeg = 30;
    var vertThresh = vertThreshDeg * Math.PI / 180;

    var pixels = loadPixels(path);
    flattenAlpha(pixels);
    var srcCanvas = canvasFromPixels(pixels);

    var boxes = await detect(srcCanvas);
    var results = [];
    for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var rec = await recognize(srcCanvas, box, 0);
        if (enableVertical && Math.abs(box.angle) > vertThresh) {
            var recV = await recognize(srcCanvas, box, Math.PI);
            rec = pickBetter(rec, recV);
        }
        if (!rec.text.trim()) continue;
        var renderW = box.recW || (box.w / DET_UNCLIP);
        var renderH = box.recH || (box.h / DET_UNCLIP);
        var rcorners = rectCorners(box.cx, box.cy, renderW, renderH, box.angle);
        results.push({
            text: rec.text, score: rec.score,
            top_left: rcorners[0], top_right: rcorners[1],
            bottom_right: rcorners[2], bottom_left: rcorners[3],
            cx: box.cx, cy: box.cy, w: renderW, h: renderH, angle: box.angle,
        });
    }
    return results;
}

module.exports = { loadModels: loadModels, detect: detect, recognize: recognize, ocrImage: ocrImage, ctcDecode: ctcDecode, pcaOBB: pcaOBB, pickBetter: pickBetter };
