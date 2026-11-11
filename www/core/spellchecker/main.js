"use strict";
/**
 * Spell Checker (offline, English) — SLR Translator module.
 *
 * Loads a bundled hunspell dictionary (en-US) via nspell and underlines
 * misspelled words inline in the cell-text editor (#currentCellText) using a
 * transparent backdrop overlay. Runs entirely offline. Options are surfaced in
 * the General Options tab via package.json "optionsDisplay":"general".
 */
var thisAddon = this;
var fs = require("graceful-fs");
var path = require("path");
var nspell = null;
try { nspell = require("nspell"); } catch (e) { console.warn("[spellchecker] nspell unavailable:", e && e.message); }

// ---------------------------------------------------------------------------
// Options (rendered inside General Options by AddonsOption.renderAddonOptionsInto)
// ---------------------------------------------------------------------------
this.optionsForm = {
	spellCheckEnabled: {
		type: "boolean",
		title: "Enable spell checker",
		description: "Underline misspelled words in the cell text editor. Works fully offline using a bundled English (en-US) dictionary.",
		default: true,
		HOOK: "thisAddon.config.spellCheckEnabled",
		inlinetitle: "Enable spell checker",
		fieldHtmlClass: "flipSwitch",
		onChange: function () { try { options.requestRestart(); } catch (e) { } }
	},
	spellCheckWhitelist: {
		type: "string",
		title: "Extra allowed words",
		description: "Comma-separated words that should never be flagged as misspelled (names, terms, etc.). Changes apply after restart.",
		default: "",
		HOOK: "thisAddon.config.spellCheckWhitelist",
		onChange: function () { try { options.requestRestart(); } catch (e) { } }
	}
};

// ---------------------------------------------------------------------------
// Spell checker core
// ---------------------------------------------------------------------------
var SpellChecker = {
	spell: null,
	loading: false,
	whitelist: null,

	isEnabled: function () {
		var v = thisAddon.config.spellCheckEnabled;
		return v === undefined ? true : !!v;
	},

	getDictionaryPath: function () {
		if (thisAddon.fullPath) return path.join(thisAddon.fullPath, "dictionaries");
		return path.join("www", "core", "spellchecker", "dictionaries");
	},

	ensureLoaded: function (cb) {
		var self = this;
		if (this.spell) return cb(true);
		if (this.loading) { setTimeout(function () { self.ensureLoaded(cb); }, 50); return; }
		this.loading = true;
		try {
			var dir = this.getDictionaryPath();
			var aff = fs.readFileSync(path.join(dir, "en-US.aff"));
			var dic = fs.readFileSync(path.join(dir, "en-US.dic"));
			this.spell = nspell(aff, dic);
			this.refreshWhitelist();
			this.loading = false;
			cb(true);
		} catch (e) {
			console.warn("[spellchecker] failed to load dictionary:", e && e.message);
			this.loading = false;
			cb(false);
		}
	},

	refreshWhitelist: function () {
		this.whitelist = this.whitelist || new Set();
		this.whitelist.clear();
		var raw = (thisAddon.config.spellCheckWhitelist || "") + "";
		var self = this;
		raw.split(/[\s,;]+/).forEach(function (w) {
			w = w.trim();
			if (w) self.whitelist.add(w.toLowerCase());
		});
	},

	// Public API: add words to the whitelist at runtime (e.g. glossary terms).
	addWords: function (words) {
		this.whitelist = this.whitelist || new Set();
		if (!words) return;
		var self = this;
		words.forEach(function (w) { if (w) self.whitelist.add(String(w).toLowerCase()); });
	},

	shouldFlag: function (word) {
		if (!word || word.length < 2) return false;
		if (/[0-9]/.test(word)) return false;
		if (word === word.toUpperCase()) return false; // acronym
		if (this.whitelist && this.whitelist.has(word.toLowerCase())) return false;
		if (!this.spell) return false;
		try { return !this.spell.correct(word); } catch (e) { return false; }
	},

	suggest: function (word) {
		if (!this.spell) return [];
		try { return this.spell.suggest(word) || []; } catch (e) { return []; }
	}
};
thisAddon.spellChecker = SpellChecker;

// ---------------------------------------------------------------------------
// Inline highlighter for a textarea (transparent backdrop overlay technique)
// ---------------------------------------------------------------------------
function SpellCheckHighlighter($ta, checker) {
	this.$ta = $ta;
	this.checker = checker;
	this.$backdrop = null;
	this.timer = null;
	this.lastValue = "\x00";
	this.bg = null;
	this.attached = false;
}
SpellCheckHighlighter.prototype.attach = function () {
	if (this.attached || !this.$ta || !this.$ta.length) return;
	var $ta = this.$ta;
	$ta.wrap('<div class="spellcheck-wrapper"></div>');
	this.$backdrop = $('<div class="spellcheck-backdrop" aria-hidden="true"></div>');
	$ta.before(this.$backdrop);
	this.attached = true;

	var self = this;
	$ta.on("input.sc change.sc paste.sc cut.sc keyup.sc", function () { self.schedule(); });
	$ta.on("scroll.sc", function () { self.syncScroll(); });
	$ta.on("focus.sc", function () { self.schedule(); });
	$(window).on("resize.sc", function () { self.schedule(); });
	// Safety net for programmatic value changes (cell navigation).
	this.interval = setInterval(function () { if (self.$ta.val() !== self.lastValue) self.schedule(); }, 1000);
	this.refresh();
};
SpellCheckHighlighter.prototype.detach = function () {
	if (!this.attached) return;
	this.$ta.off(".sc");
	$(window).off(".sc");
	if (this.interval) clearInterval(this.interval);
	this.$ta.removeClass("spellcheck-active");
	if (this.$backdrop) this.$backdrop.remove();
	if (this.$ta.parent(".spellcheck-wrapper").length) this.$ta.unwrap();
	this.$backdrop = null;
	this.bg = null;
	this.attached = false;
};
SpellCheckHighlighter.prototype.schedule = function () {
	if (this.timer) clearTimeout(this.timer);
	var self = this;
	this.timer = setTimeout(function () { self.refresh(); }, 220);
};
SpellCheckHighlighter.prototype.syncStyle = function () {
	if (!this.$backdrop || !this.$ta.length) return;
	var ta = this.$ta[0];
	var cs = window.getComputedStyle(ta);
	var b = this.$backdrop[0];
	var props = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "letterSpacing", "wordSpacing", "textIndent", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing", "whiteSpace", "wordWrap", "overflowWrap", "tabSize", "textTransform"];
	for (var i = 0; i < props.length; i++) b.style[props[i]] = cs[props[i]];
	b.style.width = ta.clientWidth + "px";
	b.style.height = ta.clientHeight + "px";
};
SpellCheckHighlighter.prototype.syncScroll = function () {
	if (!this.$backdrop || !this.$ta.length) return;
	this.$backdrop[0].scrollTop = this.$ta[0].scrollTop;
	this.$backdrop[0].scrollLeft = this.$ta[0].scrollLeft;
};
SpellCheckHighlighter.prototype.refresh = function () {
	if (!this.$backdrop || !this.$ta.length) return;
	var ta = this.$ta[0];
	var editable = !ta.readOnly && !ta.disabled;
	if (!editable || !this.checker.spell) {
		// keep the field's normal (solid) appearance; no underlines while locked.
		this.$ta.removeClass("spellcheck-active");
		this.$backdrop.empty();
		this.lastValue = this.$ta.val();
		return;
	}
	// Capture the original background once (before making the textarea transparent).
	if (this.bg === null) {
		this.bg = window.getComputedStyle(ta).backgroundColor;
		if (!this.bg || this.bg === "transparent" || this.bg === "rgba(0, 0, 0, 0)") this.bg = "#212131";
	}
	this.$backdrop[0].style.backgroundColor = this.bg;
	this.$ta.addClass("spellcheck-active");
	this.syncStyle();

	var text = this.$ta.val() || "";
	this.lastValue = text;
	if (text.length > 20000) { this.$backdrop.empty(); return; }

	var html = "";
	var last = 0;
	var re = /[A-Za-z][A-Za-z']*[A-Za-z]|[A-Za-z]/g;
	var m;
	while ((m = re.exec(text)) !== null) {
		var word = m[0];
		var start = m.index;
		html += esc(text.slice(last, start));
		var core = word.replace(/^'+|'+$/g, "");
		if (core && this.checker.shouldFlag(core)) html += '<span class="spellcheck-error">' + esc(word) + "</span>";
		else html += esc(word);
		last = start + word.length;
	}
	html += esc(text.slice(last));
	this.$backdrop.html(html + "\n");
	this.syncScroll();
};
function esc(s) {
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Bootstrap (main window only)
// ---------------------------------------------------------------------------
(function () {
	if (typeof window === "undefined" || window.opener || typeof $ === "undefined") return; // main window only
	if (!document.getElementById("spellchecker-styles")) {
		var style = document.createElement("style");
		style.id = "spellchecker-styles";
		style.textContent = [
			".spellcheck-wrapper { position: relative; display: block; height: 100%; }",
			".spellcheck-backdrop { position:absolute; top:0; left:0; z-index:1; overflow:hidden; pointer-events:none; margin:0; color: transparent; }",
			".spellcheck-backdrop .spellcheck-error { text-decoration: underline wavy #e53935; text-decoration-skip-ink: none; text-underline-offset: 1px; }",
			"textarea.spellcheck-active, input.spellcheck-active { background-color: transparent !important; position: relative; z-index: 2; }"
		].join("\n");
		document.head.appendChild(style);
	}

	var highlighter = null;
	function apply() {
		var $ta = $("#currentCellText");
		if (!SpellChecker.isEnabled()) {
			if (highlighter) { highlighter.detach(); highlighter = null; }
			return;
		}
		if ($ta.length === 0) return;
		SpellChecker.ensureLoaded(function (ok) {
			if (!ok || !SpellChecker.isEnabled()) { if (highlighter) { highlighter.detach(); highlighter = null; } return; }
			if (!highlighter) {
				highlighter = new SpellCheckHighlighter($ta, SpellChecker);
				highlighter.attach();
			} else {
				SpellChecker.refreshWhitelist();
				highlighter.schedule();
			}
		});
	}
	function waitForEditor() {
		if ($("#currentCellText").length > 0) { apply(); return; }
		setTimeout(waitForEditor, 300);
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForEditor);
	else waitForEditor();
	$(window).on("focus", function () { if (highlighter) { SpellChecker.refreshWhitelist(); highlighter.schedule(); } else { apply(); } });
})();
