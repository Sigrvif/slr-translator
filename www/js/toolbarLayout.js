/**
 * toolbarLayout.js
 *
 * Pure decision helpers for the responsive toolbar labels (Home ribbon workflow
 * group). The DOM side lives in ui.js: it hides labels one at a time while the
 * group is clipped, using sortLabelHideOrder() to pick the next one, then falls
 * back to short labels on the essential buttons using essentialFallbackOrder().
 *
 * Keeping the ordering rules pure means the priority/tie-break behaviour can be
 * unit tested without a browser (see www/js/tests/toolbarLayout.test.js).
 *
 * Item shape:
 *   {
 *     id,               // string, used as the key in the returned arrays
 *     priority,         // number, lower = more important, hidden LAST
 *     essential,        // if true the label is never hidden
 *     shortLabel        // optional short text available for essential buttons
 *   }
 */
(function (root) {
	"use strict";

	function toNumber(value, fallback) {
		var n = Number(value);
		return isNaN(n) ? fallback : n;
	}

	function normalize(items) {
		if (!Array.isArray(items)) return [];
		var out = [];
		for (var i = 0; i < items.length; i++) {
			var item = items[i];
			if (!item) continue;
			out.push({
				id: item.id !== undefined && item.id !== null ? String(item.id) : String(i),
				priority: toNumber(item.priority, 0),
				essential: item.essential === true,
				shortLabel: (item.shortLabel !== undefined && item.shortLabel !== null && item.shortLabel !== "") ? String(item.shortLabel) : null,
				index: i
			});
		}
		return out;
	}

	/**
	 * Order in which NON-essential labels should be hidden: least important
	 * first, so the last entry is the label that survives longest.
	 * Ties are broken rightmost-first (later buttons give up their label first).
	 *
	 * @param {Array} items
	 * @returns {string[]} ids
	 */
	function sortLabelHideOrder(items) {
		var normalized = normalize(items).filter(function (item) {
			return !item.essential;
		});
		normalized.sort(function (a, b) {
			if (a.priority !== b.priority) return b.priority - a.priority;
			return b.index - a.index;
		});
		return normalized.map(function (item) { return item.id; });
	}

	/**
	 * Order in which ESSENTIAL labels should drop from their full text to their
	 * short text when even a fully-hidden non-essential toolbar still overflows.
	 * Most important first. Items without a shortLabel are skipped.
	 *
	 * @param {Array} items
	 * @returns {string[]} ids
	 */
	function essentialFallbackOrder(items) {
		var normalized = normalize(items).filter(function (item) {
			return item.essential && item.shortLabel !== null;
		});
		normalized.sort(function (a, b) {
			if (a.priority !== b.priority) return a.priority - b.priority;
			return a.index - b.index;
		});
		return normalized.map(function (item) { return item.id; });
	}

	var api = {
		sortLabelHideOrder: sortLabelHideOrder,
		essentialFallbackOrder: essentialFallbackOrder
	};

	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.toolbarLayout = api;
})(typeof window !== "undefined" ? window : globalThis);
