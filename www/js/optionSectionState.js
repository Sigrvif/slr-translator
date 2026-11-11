/*
 * optionSectionState.js
 *
 * Pure helpers for the translator options form's collapsible sections. The options window
 * re-renders the whole form on a rebuild (model switch, stale-runtime-panel refresh), and a
 * fresh render collapses every section that is not flagged default-expanded - throwing away
 * which sections the user had opened. renderOptions captures the expanded section keys before
 * it empties the old DOM and re-expands them after the new render, so a rebuild keeps the
 * user's layout instead of resetting it.
 *
 * Only string parsing lives here so it can be unit-tested under Node; the DOM walking itself
 * stays in options.js.
 */
(function (root) {
	"use strict";

	// The section key from a fieldset's class attribute, or null. OptionFormBuilder builds the
	// class as "option-section option-section-<key>" plus the "option-section-default-expanded"
	// modifier for sections that start open; the first option-section-* class is therefore the
	// key, and the modifier must never be mistaken for one.
	function keyFromClass(classAttr) {
		var m = String(classAttr || "").match(/option-section-([A-Za-z0-9_-]+)/);
		if (!m || m[1] === "default-expanded") return null;
		return m[1];
	}

	var api = {
		keyFromClass: keyFromClass
	};

	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.optionSectionState = api;
})(typeof window !== "undefined" ? window : globalThis);
