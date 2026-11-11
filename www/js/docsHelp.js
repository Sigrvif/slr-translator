/* Opens (or focuses) the offline documentation window with an optional deep link.
   Usable from any app window (trans.html, options.html, ...) — only requires `nw`.
   nw.Window.open resolves URLs against the APP ROOT, hence "www/docs/index.html". */
(function () {
	"use strict";
	if (typeof nw === "undefined") return;

	var docsWin = null;

	// The quit path (ui.js) triggers "beforeClose" on the main window before
	// compressing logs and force-closing everything registered in ui.windows.
	// The docs viewer deliberately lives outside that registry (singleton by
	// window id), so it must close itself here — otherwise it keeps the
	// process alive after the main window is gone.
	if (typeof $ !== "undefined") {
		$(window).on("beforeClose", function () {
			try {
				if (docsWin) docsWin.close(true);
			} catch (e) {
				docsWin = null;
			}
		});
	}

	var ENGINE_PAGES = {
		rmmv: "mv", rmmz: "mz", rmvxace: "ace", rmvx: "vx", rmxp: "xp"
	};

	function fallbackOpen() {
		try { nw.Shell.openItem("www/docs/index.html"); } catch (e) { console.error("docsHelp fallback failed", e); }
	}

	function open(pageId, anchor) {
		// encode: addon-contributed page ids may contain characters that are
		// percent-encoded in a URL hash (the docs router decodes them again)
		var hash = pageId ? "#" + encodeURIComponent(pageId) + (anchor ? "/" + encodeURIComponent(anchor) : "") : "";
		if (docsWin) {
			try {
				if (hash) docsWin.window.location.hash = hash;
				docsWin.focus();
				return;
			} catch (e) {
				docsWin = null; // window was closed; reopen below
			}
		}
		try {
			nw.Window.open("www/docs/index.html" + hash, {
				id: "docs",
		frame: false,
				width: 1100,
				height: 750,
				title: "SLR Translator — Documentation",
				resizable: true,
				// Hidden until loaded: otherwise the window flashes white while
				// the docs page and its assets load.
				show: false
			}, function (win) {
				if (!win) { fallbackOpen(); return; }
				docsWin = win;
				win.on("closed", function () { docsWin = null; });
				var revealed = false;
				var reveal = function () {
					if (revealed) return;
					revealed = true;
					var showIt = function () {
						try { win.show(); } catch (e) {}
						try { win.focus(); } catch (e) {}
					};
					// One painted frame first, so the window is never presented
					// as the default white canvas.
					var w = null;
					try { w = win.window; } catch (e) {}
					if (w && typeof w.requestAnimationFrame === "function") {
						w.requestAnimationFrame(function () { w.requestAnimationFrame(showIt); });
					} else {
						setTimeout(showIt, 30);
					}
				};
				try { win.on("loaded", reveal); } catch (e) {}
				setTimeout(reveal, 15000);
				/* hardening: if NW reused an existing window for this id, re-apply the hash */
				try { if (hash) win.window.location.hash = hash; } catch (e) {}
			});
		} catch (e) {
			fallbackOpen();
		}
	}

	function openForEngine(engineId) {
		open(ENGINE_PAGES[engineId] || "overview");
	}

	window.docsHelp = { open: open, openForEngine: openForEngine };
})();
