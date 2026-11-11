/* Addon documentation collector.
   Reads the optional "docs" declaration from every user addon's package.json
   (the package.json of each folder under www/addons) and turns it into
   documentation-manifest sections
   — the same shape www/docs/manifest.js uses:
       [{ section: "Addons", pages: [{ id, title, file, keywords }] }]
   Loaded two ways:
     - as a classic script by the docs viewer (www/docs/index.html), whose inline
       boot appends the result to window.DOCS_MANIFEST before the sidebar builds;
     - via require() by www/core/docsChat/lib/DocIndex.js, so "Ask DSLR" can
       answer from addon pages as well.
   Node-safe on purpose (plain fs/path, both injectable) so it also runs under
   node --test. Best-effort throughout: broken addons are skipped, never thrown.
*/
"use strict";

/**
 * Collect the documentation sections declared by the addons in a directory.
 * The "docs" field of a package.json accepts:
 *   "docs": "docs.html"                      — one page, titled after the addon
 *   "docs": [{file, title?, keywords?}, ...] — one or more pages
 * Page files are relative to the addon folder; the returned manifest paths are
 * relative to www/docs/ ("../addons/<folder>/<file>") so the docs viewer's XHR
 * and DocIndex's reader resolve them identically. Page ids feed the hash router:
 * "addon-<folder>" for the first page, "addon-<folder>-2", "-3", ... after that.
 * @param {String} addonsDir - path to the www/addons directory
 * @param {Object} [fsLike]   - fs-compatible module (injected in tests)
 * @param {Object} [pathLike] - path-compatible module (injected in tests)
 * @returns {Array} manifest sections; [] when no addon declares docs
 */
function collectAddonDocSections(addonsDir, fsLike, pathLike) {
	var fsMod = fsLike || require("fs");
	var pathMod = pathLike || require("path");
	var pages = [];
	var names;
	try {
		names = fsMod.readdirSync(addonsDir).sort();
	} catch (e) {
		return []; // no addons folder or unreadable: built-in docs only
	}
	names.forEach(function (name) {
		var pkg;
		try {
			pkg = JSON.parse(fsMod.readFileSync(pathMod.join(addonsDir, name, "package.json"), "utf8"));
		} catch (e) {
			return; // not an addon folder (no or broken package.json)
		}
		var docs = pkg && pkg.docs;
		if (!docs) return;
		if (typeof docs === "string") docs = [{ file: docs }];
		if (!Array.isArray(docs)) return;
		docs.forEach(function (entry, i) {
			if (!entry || typeof entry.file !== "string" || !entry.file) return;
			pages.push({
				id: "addon-" + name + (i > 0 ? "-" + (i + 1) : ""),
				title: (typeof entry.title === "string" && entry.title)
					|| (typeof pkg.title === "string" && pkg.title)
					|| name,
				file: "../addons/" + name + "/" + entry.file.replace(/\\/g, "/"),
				keywords: ((typeof entry.keywords === "string" ? entry.keywords + " " : "")
					+ (typeof pkg.description === "string" ? pkg.description : "")
					+ " addon").trim()
			});
		});
	});
	return pages.length ? [{ section: "Addons", pages: pages }] : [];
}

if (typeof window !== "undefined") window.addonDocs = collectAddonDocSections;
if (typeof module !== "undefined" && module.exports) module.exports = collectAddonDocSections;
