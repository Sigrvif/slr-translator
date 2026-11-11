"use strict";
/**
 * modalDialog.js — modal dialog helper for SLR.
 *
 * Reimplementation of showModalDialog: opens a child NW window as a modal
 * (dark backdrop over the opener; refocus + chime when the background is
 * clicked/focused), injects dialogArguments into the child window, and resolves
 * the returned promise when the child closes.
 *
 * Exposed as window.showModalDialog and exports.showModalDialog, so callers can
 * use either `showModalDialog(...)` or `var {showModalDialog} = require("www/js/modalDialog.js")`.
 */

var validOptionKeys = [
	"id", "title", "width", "height", "toolbar", "icon", "position",
	"min_width", "min_height", "max_width", "max_height", "as_desktop",
	"resizable", "always_on_top", "visible_on_all_workspaces", "fullscreen",
	"show_in_taskbar", "frame", "show", "kiosk", "transparent", "new_instance",
	"mixed_context", "inject_js_start", "inject_js_end"
];

var audioCtx;

function playChime() {
	try {
		var ctx = audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());
		var osc = ctx.createOscillator();
		var gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = 880;
		gain.gain.value = 0.08;
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start();
		osc.stop(ctx.currentTime + 0.12);
	} catch (e) {}
}

function parseOptions(options) {
	options = options || {};
	var result;
	if (typeof options === "string") {
		result = {};
		var pairs = options.split(";");
		for (var i = 0; i < pairs.length; i++) {
			if (!pairs[i]) continue;
			var kv = pairs[i].split(":");
			if (kv.length === 0) continue;
			var value = kv[1] ? kv[1].trim() : "";
			if (value === "off" || value === "no" || value === "0") value = false;
			else if (value === "on" || value === "yes" || value === "1") value = true;
			result[kv[0].trim()] = value;
		}
	} else {
		result = options;
	}
	if (result.center) result.position = "center";
	if (result.dialogheight) result.height = result.dialogheight;
	if (result.dialogwidth) result.width = result.dialogwidth;
	return result;
}

function filterOptions(options) {
	var result = {};
	for (var key in options) {
		if (validOptionKeys.indexOf(key) !== -1) result[key] = options[key];
	}
	return result;
}

var showModalDialog = async function (uri, dialogArguments, options) {
	if (!nw) return false;

	options = parseOptions(options);

	var win = nw.Window.get();
	var overlay = document.createElement("div");
	overlay.style.cssText = "position:fixed;width:100vw;height:100vh;top:0;left:0;z-index:9999999;background:rgba(0,0,0,0.3);";
	document.body.appendChild(overlay);

	var popupWindow;
	var focusOnPopup = function () {
		if (!popupWindow) return;
		try {
			if (!popupWindow.window) return;
			popupWindow.focus();
			playChime();
		} catch (e) {}
	};

	var onFocus = function (e) { focusOnPopup(e); };
	var clearModal = function () {
		popupWindow = undefined;
		overlay.removeEventListener("click", focusOnPopup);
		try { win.removeListener("focus", onFocus); } catch (e) {}
		overlay.remove();
	};

	win.on("focus", onFocus);
	overlay.addEventListener("click", focusOnPopup);

	var popupOptions = filterOptions(options);
	// Open hidden and reveal once painted, so the dialog never flashes the
	// default white canvas while its scripts load.
	popupOptions.show = false;
	// Frameless: childWindowFrame.js draws a themed title bar instead of the
	// OS one (which follows the system theme and is white on Windows).
	popupOptions.frame = false;

	return new Promise(function (resolve) {
		nw.Window.open(uri, popupOptions, function (new_win) {
			new_win.window.dialogArguments = dialogArguments;
			popupWindow = new_win;

			var revealed = false;
			var reveal = function () {
				if (revealed) return;
				revealed = true;
				var showIt = function () {
					try { new_win.show(); } catch (e) {}
					try { new_win.focus(); } catch (e) {}
				};
				var w = null;
				try { w = new_win.window; } catch (e) {}
				if (w && typeof w.requestAnimationFrame === "function") {
					w.requestAnimationFrame(function () { w.requestAnimationFrame(showIt); });
				} else {
					setTimeout(showIt, 30);
				}
			};
			try { new_win.on("loaded", reveal); } catch (e) {}
			setTimeout(reveal, 15000);

			if (options.dialogleft) new_win.x = parseInt(options.dialogleft);
			if (options.dialogtop) new_win.y = parseInt(options.dialogtop);

			new_win.on("loaded", function () {
				new_win.window.dialogArguments = dialogArguments;
			});

			new_win.on("closed", function () {
				new_win = undefined;
				clearModal();
				resolve();
			});
		});
	});
};

window.showModalDialog = showModalDialog;
exports.showModalDialog = showModalDialog;
