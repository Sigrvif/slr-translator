"use strict";
/**
 * nightModeEarly.js - include this FIRST in a window's <head>.
 *
 * Child windows (Options, Find, editors, ...) open with the browser's default
 * white canvas and only get the night-mode stylesheet once the nightMode
 * addon injects it on window ready - so in a dark room the window flashes
 * white until the heavy scripts finish loading.
 *
 * The night-mode stylesheet starts with an unscoped `html { filter: invert(92%) }`,
 * so merely loading it turns that white canvas dark. This reads the stored
 * setting (default ON, see core/nightMode/main.js) and loads it up front.
 * The addon still adds its own copy and the body.nightMode class later; a
 * duplicate stylesheet is harmless and `off()` removes every .nightModeCss link.
 */
(function () {
	try {
		var cfg = JSON.parse(localStorage.getItem("Config") || "{}");
		var nightmode = cfg && cfg.addons && cfg.addons.package && cfg.addons.package.nightmode;
		var active = !nightmode || nightmode.isActive !== false;
		if (!active) return;
		// Add the class as well as the stylesheet. Loading only the CSS applies
		// the raw html filter but not the .nightMode rules (the counter-inverts
		// for the intro/loading overlays and the colour-variable overrides), which
		// made those overlays flash bright during load.
		document.documentElement.classList.add("nightMode");
		var link = document.createElement("link");
		link.rel = "stylesheet";
		link.type = "text/css";
		link.className = "nightModeCss";
		link.href = "core/nightMode/css/!nightMode.css";
		(document.head || document.documentElement).appendChild(link);
	} catch (e) {
		/* config not ready yet - leave the default background */
	}
})();
