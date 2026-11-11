"use strict";
/**
 * childWindowFrame.js — a themed title bar for the frameless child windows
 * (Options, Docs, Note, the editor/modal windows, ...).
 *
 * The windows are opened with `frame:false`, so the OS no longer draws a title
 * bar (which follows the system theme and was white on Windows in night mode).
 * This injects a bar with the window title and minimize / maximize / close
 * buttons, and wraps the existing page content below it.
 *
 * Colours are authored for the light theme; night mode's whole-page
 * invert(92%) turns them dark automatically, so no night-specific palette is
 * needed here (except the close-button hover, which would otherwise go teal).
 */
(function () {
	if (typeof nw === "undefined" || typeof document === "undefined") return;
	// The main app window has its own application bar.
	if (document.body && document.body.getAttribute("data-window") === "trans") return;

	var BAR_HEIGHT = 26;

	function injectCss() {
		if (document.getElementById("cwfStyles")) return;
		var style = document.createElement("style");
		style.id = "cwfStyles";
		style.textContent =
			"html.cwf, html.cwf body { height:100%; margin:0; }" +
			"html.cwf body { display:flex; flex-direction:column; overflow:hidden; }" +
			"#cwfBar { flex:0 0 " + BAR_HEIGHT + "px; display:flex; align-items:center;" +
				" background:#f3f3f3; color:#333; border-bottom:1px solid rgba(0,0,0,.15);" +
				" font:12px Tahoma, Arial, sans-serif; user-select:none; -webkit-app-region:drag; }" +
			"#cwfBar .cwf-title { flex:1 1 auto; padding-left:10px; overflow:hidden;" +
				" white-space:nowrap; text-overflow:ellipsis; }" +
			"#cwfBar .cwf-controls { display:flex; -webkit-app-region:no-drag; }" +
			"#cwfBar button { -webkit-app-region:no-drag; width:40px; height:" + BAR_HEIGHT + "px;" +
				" border:0; background:transparent; color:inherit; cursor:pointer;" +
				" font:13px Tahoma, Arial, sans-serif; line-height:1; padding:0; }" +
			"#cwfBar button:hover { background:rgba(0,0,0,.12); }" +
			"#cwfBar .cwf-close:hover { background:#e81123; color:#fff; }" +
			"#cwfContent { flex:1 1 auto; position:relative; min-height:0; overflow:auto; }" +
			"#cwfContent > * { box-sizing:border-box; }" +
			".nightMode #cwfBar .cwf-close:hover { background:#28dccd; color:#000; }" +
			// Always-dark windows (the docs, which author their own dark theme and
			// are not subject to the page invert) get a dark bar directly.
			'html[data-cwf="dark"] #cwfBar { background:#1e1e1e; color:#e0e0e0;' +
				" border-bottom-color:rgba(255,255,255,.12); }" +
			'html[data-cwf="dark"] #cwfBar button:hover { background:rgba(255,255,255,.15); }';
		document.head.appendChild(style);
	}

	function mount() {
		if (!document.body || document.getElementById("cwfBar")) return;
		var win = nw.Window.get();
		injectCss();

		var bar = document.createElement("div");
		bar.id = "cwfBar";
		bar.innerHTML = '<span class="cwf-title"></span><span class="cwf-controls">' +
			'<button class="cwf-min" title="Minimize">&#x2013;</button>' +
			'<button class="cwf-max" title="Maximize">&#x25A1;</button>' +
			'<button class="cwf-close" title="Close">&#x2715;</button></span>';
		bar.querySelector(".cwf-title").textContent = document.title || "";
		document.body.insertBefore(bar, document.body.firstChild);

		// Move everything else into a content wrapper that sits under the bar.
		var content = document.createElement("div");
		content.id = "cwfContent";
		var nodes = Array.prototype.slice.call(document.body.childNodes);
		for (var i = 0; i < nodes.length; i++) {
			if (nodes[i] !== bar) content.appendChild(nodes[i]);
		}
		document.body.appendChild(content);
		document.documentElement.classList.add("cwf");

		var maxBtn = bar.querySelector(".cwf-max");
		var closeBtn = bar.querySelector(".cwf-close");
		var minBtn = bar.querySelector(".cwf-min");

		var applyMaxState = function (isMax) {
			maxBtn.textContent = isMax ? "\u2750" : "\u25A1";
			maxBtn.title = isMax ? "Restore" : "Maximize";
		};

		minBtn.addEventListener("click", function () { try { win.minimize(); } catch (e) {} });
		closeBtn.addEventListener("click", function () { try { win.close(); } catch (e) {} });
		maxBtn.addEventListener("click", function () {
			try {
				if (bar.getAttribute("data-maxed") === "1") win.restore();
				else win.maximize();
			} catch (e) {}
		});
		bar.addEventListener("dblclick", function () {
			try {
				if (bar.getAttribute("data-maxed") === "1") win.restore();
				else win.maximize();
			} catch (e) {}
		});
		try {
			win.on("maximize", function () { bar.setAttribute("data-maxed", "1"); applyMaxState(true); });
			win.on("restore", function () { bar.setAttribute("data-maxed", "0"); applyMaxState(false); });
		} catch (e) {}
		applyMaxState(false);

		// Keep the title in sync if the page changes it later.
		try {
			var titleEl = document.querySelector("title");
			if (titleEl && typeof MutationObserver !== "undefined") {
				new MutationObserver(function () {
					bar.querySelector(".cwf-title").textContent = document.title || "";
				}).observe(titleEl, { childList: true });
			}
		} catch (e) {}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", mount);
	} else {
		mount();
	}
})();
