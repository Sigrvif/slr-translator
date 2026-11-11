// Raw tab rendering for rmrgss engines (XP / VX / VX Ace): YAML data files + Game.ini.
// DOM-dependent; pure logic lives in rmrgss.rawview.logic.js.

var RMRAW = require("www/core/rmrgss/rmrgss.rawview.logic.js");
var RMData = require("www/core/rmrgss/rmrgss.module.js").RMData;

var RMRAWVIEW = {};

RMRAWVIEW.token = function (rawViewer) {
	// re-entrancy guard: the raw tab can dispatch a new render while a slow
	// previous one (first prism/jsoneditor load) is still in flight
	rawViewer._rmRawToken = (rawViewer._rmRawToken || 0) + 1;
	var myToken = rawViewer._rmRawToken;
	return function () { return rawViewer._rmRawToken === myToken; };
};

RMRAWVIEW.warnMissingFile = function (rawViewer) {
	rawViewer.clear();
	rawViewer.scrollToTop();
	var $warningMsg = $(`<div class="rawViewerMsg rawViewerWarn">${`Unable to find the file related to the data`}<br />
        ${`To fix this correct the <b>Raw material location</b> field at the <a href="#" class="openProjectProperties">Project properties</a>`}</div>`);
	$warningMsg.find(".openProjectProperties").on("click", function () {
		ui.openProjectProperties();
	});
	rawViewer.append($warningMsg);
};

RMRAWVIEW.loadYaml = async function (rawViewer, activePath) {
	// per-project cache of parsed docs, capped to the most recent 16 files
	var projectId = (trans.project && trans.project.projectId) || "";
	if (rawViewer.rmYamlCacheProject != projectId) {
		rawViewer.rmYamlCache = {};
		rawViewer.rmYamlCacheProject = projectId;
	}
	rawViewer.rmYamlCache = rawViewer.rmYamlCache || {};
	var keys = Object.keys(rawViewer.rmYamlCache);
	if (keys.length >= 16) delete rawViewer.rmYamlCache[keys[0]];
	if (rawViewer.rmYamlCache[activePath]) return rawViewer.rmYamlCache[activePath];
	var doc = RMRAW.parseDocument(await rawViewer.openFile(activePath));
	var entry = { doc: doc };
	rawViewer.rmYamlCache[activePath] = entry;
	return entry;
};

RMRAWVIEW.addTree = async function (rawViewer, entry, contexts, alive) {
	var treeData;
	try { treeData = RMRAW.toTreeData(entry.doc); } catch (e) { treeData = null; }
	if (!treeData) return;
	if (alive && !alive()) return;
	var $section = rawViewer.addTreeSection("YAML data tree");
	var $wrapper = $section.find(".jsonViewerWrapper");
	try {
		await rawViewer.loadJSONEditorLibrary();
		if (alive && !alive()) {
			$section.remove();
			return;
		}
		var editor = new JSONEditor($wrapper[0], { mode: "view" });
		editor.set(treeData);
		var helper = new JsonEditorHelper(editor, $wrapper);
		editor.collapseAll();
		var parsed = RMRAW.parseContext(contexts[0]);
		var resolved = RMRAW.resolveNode(entry.doc, parsed.segments);
		var expand = RMRAW.treeExpandPath(treeData, resolved.path);
		if (expand.length > 0) {
			// paths ending at scalar leaves (or stale trees) never mutate the DOM,
			// which would leave expandPoint's observer promise pending forever
			await Promise.race([
				helper.expandPoint(expand).catch(e2 => console.warn("tree expand failed", e2)),
				new Promise(raceDone => setTimeout(raceDone, 1500))
			]);
		}
	} catch (e) {
		console.warn("YAML tree rendering failed", e);
		$section.remove();
	}
};

RMRAWVIEW.handleDataFile = async function (rawViewer, selectedCell) {
	var alive = RMRAWVIEW.token(rawViewer);
	try {
		var obj = trans.getSelectedObject();
		var row = selectedCell.fromRow;
		var contexts = (obj.context && obj.context[row]) || [];

		rawViewer.clear();
	rawViewer.scrollToTop();
		if (contexts.length == 0) {
			rawViewer.append(`<div class="rawViewerMsg">No context data for this row.</div>`);
			return;
		}

		var activePath = await rawViewer.findActiveFile(obj);
		if (!alive()) return;
		if (!activePath) return RMRAWVIEW.warnMissingFile(rawViewer);

		var entry = await RMRAWVIEW.loadYaml(rawViewer, activePath);
		if (!alive()) return;
		var rowText = (obj.data && obj.data[row] && obj.data[row][0]) || "";
		var engineCode = String(trans.project.gameEngine || "").replace(/^rm/, "");

		await rawViewer.ensurePrism();
		if (!alive()) return;
		try { require("@rmrgss/prismjs/components/prism-yaml"); } catch (e) {
			console.warn("prism-yaml unavailable", e);
		}

		var eventCodes = (RMData && RMData.RPGM_EVENT_CODE) || null;

		for (var c = 0; c < contexts.length; c++) {
			if (!alive()) return;
			var parsed = RMRAW.parseContext(contexts[c]);
			var resolved = RMRAW.resolveNode(entry.doc, parsed.segments);
			var $meta = rawViewer.addMetaBlock(RMRAW.describe(entry.doc, parsed, resolved, obj.dataType, eventCodes));
			var target = RMRAW.computeHighlight(entry.doc, resolved, rowText, engineCode);
			if (!target) continue;
			var elm = await rawViewer.addTextPreviewFromFileOffset(activePath, target.start, target.end, { language: "yaml" });
			if (!alive()) {
				// a newer render took over while this snippet was in flight
				if ($meta) $meta.remove();
				elm.remove();
				return;
			}
			elm.data("path", activePath);
			rawViewer.addContextMenu(elm, { path: activePath, offsetStart: target.start, offsetEnd: target.end });
		}

		await RMRAWVIEW.addTree(rawViewer, entry, contexts, alive);
	} catch (e) {
		console.warn("Raw view rendering failed", e);
		rawViewer.clear();
	rawViewer.scrollToTop();
		rawViewer.append(`<div class="rawViewerMsg">Unable to render the raw view for this row. See console (F12) for details.</div>`);
	}
};

RMRAWVIEW.handleIniFile = async function (rawViewer, selectedCell) {
	var alive = RMRAWVIEW.token(rawViewer);
	try {
		var obj = trans.getSelectedObject();
		var row = selectedCell.fromRow;
		var contexts = (obj.context && obj.context[row]) || [];

		rawViewer.clear();
	rawViewer.scrollToTop();
		if (contexts.length == 0) {
			rawViewer.append(`<div class="rawViewerMsg">No context data for this row.</div>`);
			return;
		}

		var activePath = await rawViewer.findActiveFile(obj);
		if (!alive()) return;
		if (!activePath) return RMRAWVIEW.warnMissingFile(rawViewer);

		var text = await rawViewer.openFile(activePath);
		if (!alive()) return;
		await rawViewer.ensurePrism();
		if (!alive()) return;
		try { require("@rmrgss/prismjs/components/prism-ini"); } catch (e) {
			console.warn("prism-ini unavailable", e);
		}

		var found = 0;
		for (var c = 0; c < contexts.length; c++) {
			if (!alive()) return;
			var parts = contexts[c].split("/");
			var category = parts[1];
			var key = parts[2];
			var $meta = rawViewer.addMetaBlock([
				{ label: "File", value: "Game.ini" },
				{ label: "Section", value: "[" + category + "]" },
				{ label: "Key", value: key }
			]);
			var hit = RMRAW.findIniEntry(text, category, key);
			if (!hit) continue;
			found++;
			var elm = await rawViewer.addTextPreviewFromFileOffset(activePath, hit.start, hit.end, { language: "ini" });
			if (!alive()) {
				if ($meta) $meta.remove();
				elm.remove();
				return;
			}
			elm.data("path", activePath);
			rawViewer.addContextMenu(elm, { path: activePath, offsetStart: hit.start, offsetEnd: hit.end });
		}
		if (found == 0) rawViewer.append(`<div class="rawViewerMsg">Entry not found in Game.ini.</div>`);
	} catch (e) {
		console.warn("Raw view rendering failed", e);
		rawViewer.clear();
	rawViewer.scrollToTop();
		rawViewer.append(`<div class="rawViewerMsg">Unable to render the raw view for this entry. See console (F12) for details.</div>`);
	}
};

if (typeof module != "undefined") module.exports = RMRAWVIEW;
