/* SLR Translator offline docs shell: hash router + client search. Vanilla JS, no dependencies. */
(function () {
	"use strict";

	var flat = [];            // [{id, title, file, section, index, keywords}]
	var indexLoaded = false;  // search index (fragment text) loaded?
	var indexLoading = false; // search index fetch batch in progress?
	var pendingCallbacks = [];// ensureIndex callers waiting for the batch
	var searchIndex = [];     // [{page, text}]
	var navSeq = 0;           // route() guard: ignore stale loadFile callbacks
	var MAX_HITS = 30;        // search result cap

	/* --- zoom (reading column scales; sidebar stays fixed) --- */
	var ZOOM_KEY = "docsZoom";
	var ZOOM_MIN = 70, ZOOM_MAX = 180, ZOOM_STEP = 10;
	var zoomLevel = 100;

	function applyZoom() {
		document.documentElement.style.setProperty("--docs-zoom", String(zoomLevel / 100));
		var label = document.getElementById("zoomLevel");
		if (label) label.textContent = zoomLevel + "%";
		try { localStorage.setItem(ZOOM_KEY, String(zoomLevel)); } catch (e) { /* private mode etc. */ }
	}

	function setZoom(v) {
		zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v)));
		applyZoom();
	}

	function initZoom() {
		var stored = null;
		try { stored = parseInt(localStorage.getItem(ZOOM_KEY), 10); } catch (e) { /* private mode etc. */ }
		if (!isNaN(stored)) zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, stored));
		applyZoom();
		document.getElementById("zoomIn").addEventListener("click", function () { setZoom(zoomLevel + ZOOM_STEP); });
		document.getElementById("zoomOut").addEventListener("click", function () { setZoom(zoomLevel - ZOOM_STEP); });
		document.getElementById("zoomLevel").addEventListener("click", function () { setZoom(100); });
		document.addEventListener("keydown", function (e) {
			if (!e.ctrlKey || e.altKey) return;
			var k = e.key;
			if (k === "=" || k === "+" || e.keyCode === 61 || e.keyCode === 187) { e.preventDefault(); setZoom(zoomLevel + ZOOM_STEP); }
			else if (k === "-" || e.keyCode === 173 || e.keyCode === 189) { e.preventDefault(); setZoom(zoomLevel - ZOOM_STEP); }
			else if (k === "0" || e.keyCode === 48) { e.preventDefault(); setZoom(100); }
		});
		document.addEventListener("wheel", function (e) {
			if (!e.ctrlKey) return;
			e.preventDefault();
			setZoom(zoomLevel + (e.deltaY < 0 ? 5 : -5));
		}, { passive: false });
	}

	function init() {
		window.DOCS_MANIFEST.forEach(function (sec) {
			sec.pages.forEach(function (p) {
				flat.push({ id: p.id, title: p.title, file: p.file, section: sec.section, index: flat.length, keywords: p.keywords || "" });
			});
		});
		buildSidebar();
		window.addEventListener("hashchange", route);
		document.getElementById("searchBox").addEventListener("input", onSearchInput);
		document.getElementById("searchBox").addEventListener("keydown", function (e) {
			if (e.key === "Escape") {
				var box = document.getElementById("searchResults");
				if (box) box.classList.add("hidden");
			}
		});
		initZoom();
		route();
	}

	function byId(id) {
		for (var i = 0; i < flat.length; i++) if (flat[i].id === id) return flat[i];
		return null;
	}

	/* --- router --- */
	function route() {
		var seq = ++navSeq;
		var srb = document.getElementById("searchResults");
		if (srb) srb.classList.add("hidden");
		var rawHash = location.hash.replace(/^#/, "");
		// ids/anchors may contain characters the browser percent-encodes in the
		// hash (addon folder names are not restricted) — decode before matching
		var hash = rawHash;
		try { hash = decodeURIComponent(rawHash); } catch (e) { /* literal % sequence */ }
		var parts = hash.split("/");
		var page = byId(parts[0]);
		if (!page) {
			if (parts[0]) console.warn("Unknown docs page:", parts[0]);
			page = flat[0];
		}
		var anchor = parts[1] || "";
		document.title = page.title + " — SLR Translator Documentation";
		loadFile(page.file, function (html) {
			if (seq !== navSeq) return;
			var content = document.getElementById("content");
			if (html === null) {
				content.innerHTML = "<div class='docsError'>Could not load <code>" + page.file + "</code>. The documentation package is incomplete.</div>";
				return;
			}
			content.innerHTML = html;
			setActive(page);
			renderPager(page);
			if (anchor) {
				var el = document.getElementById(anchor);
				if (el) el.scrollIntoView(); else console.warn("Unknown anchor:", anchor);
			} else {
				document.getElementById("mainColumn").scrollTop = 0;
			}
		});
	}

	function loadFile(file, cb) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", file, true);
		xhr.onload = function () {
			/* file:// XHR in NW.js reports status 0 on success — do not gate on 2xx */
			cb(xhr.responseText !== "" && xhr.responseText !== null ? xhr.responseText : null);
		};
		xhr.onerror = function () { cb(null); };
		xhr.send();
	}

	/* --- sidebar --- */
	function buildSidebar() {
		var nav = document.getElementById("pageNav");
		var html = "";
		window.DOCS_MANIFEST.forEach(function (sec) {
			html += "<div class='navSection'>" + esc(sec.section) + "</div>";
			sec.pages.forEach(function (p) {
				html += "<a class='navLink' href='#" + esc(p.id) + "' data-page='" + esc(p.id) + "'>" + esc(p.title) + "</a>";
			});
		});
		nav.innerHTML = html;
	}

	function setActive(page) {
		var links = document.querySelectorAll(".navLink");
		for (var i = 0; i < links.length; i++) links[i].classList.remove("active");
		var el = document.querySelector(".navLink[data-page='" + page.id + "']");
		if (el) el.classList.add("active");
	}

	function renderPager(page) {
		var pager = document.getElementById("pager");
		var prev = flat[page.index - 1], next = flat[page.index + 1];
		pager.innerHTML =
			(prev ? "<a class='pagerPrev' href='#" + esc(prev.id) + "'>← " + esc(prev.title) + "</a>" : "<span></span>") +
			(next ? "<a class='pagerNext' href='#" + esc(next.id) + "'>" + esc(next.title) + " →</a>" : "<span></span>");
	}

	/* --- search --- */
	function ensureIndex(cb) {
		if (indexLoaded) return cb();
		if (indexLoading) { pendingCallbacks.push(cb); return; }
		indexLoading = true;
		pendingCallbacks.push(cb);
		var pending = flat.length;
		searchIndex = flat.map(function (p) { return { page: p, text: "" }; });
		flat.forEach(function (p, i) {
			loadFile(p.file, function (html) {
				if (html === null) console.warn("Failed to load docs fragment for search index:", p.file);
				var tmp = document.createElement("div");
				tmp.innerHTML = html || "";
				searchIndex[i].text = (p.title + " " + p.keywords + " " + tmp.textContent).toLowerCase();
				if (--pending === 0) {
					indexLoaded = true;
					indexLoading = false;
					var cbs = pendingCallbacks;
					pendingCallbacks = [];
					cbs.forEach(function (fn) { fn(); });
				}
			});
		});
	}

	function onSearchInput() {
		var input = this;
		var q = input.value.trim().toLowerCase();
		var box = document.getElementById("searchResults");
		if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
		ensureIndex(function () {
			var tokens = q.split(/\s+/);
			var hits = [];
			searchIndex.forEach(function (e) {
				if (hits.length >= MAX_HITS) return;
				for (var t = 0; t < tokens.length; t++) {
					if (e.text.indexOf(tokens[t]) === -1) return;
				}
				hits.push(e.page);
			});
			if (!hits.length) {
				box.innerHTML = "<div class='searchNone'>No results for “" + esc(input.value) + "”</div>";
			} else {
				var html = "";
				hits.forEach(function (p) {
					html += "<a class='searchHit' href='#" + esc(p.id) + "'><span class='hitSection'>" + esc(p.section) + "</span>" + esc(p.title) + "</a>";
				});
				box.innerHTML = html;
			}
			box.classList.remove("hidden");
		});
	}

	function esc(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	document.addEventListener("DOMContentLoaded", init);
})();
