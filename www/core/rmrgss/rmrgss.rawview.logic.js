// Pure, DOM-free logic for the rmrgss Raw tab viewer (RM XP / VX / VX Ace).
// Required from rmrgss.rawview.js at runtime; required directly by node tests.

var RMRAW = (function () {
	var YAML;
	try {
		YAML = require("@rmrgss/yaml"); // browser: alias registered by rmrgss.module.js
	} catch (e) {
		YAML = require(__dirname + "/node_modules/yaml"); // plain node (tests)
	}

	var BLOCK_KINDS = {
		message:			{ header: 101, body: 401, label: "Show Text" },
		scrollingMessage:	{ header: 105, body: 405, label: "Show Scrolling Text" },
		vxcomm:				{ header: 108, body: 108, label: "Comment" },
		addcomm:			{ header: 408, body: 408, label: "Additional Comment" }
	};

	// command codes whose translatable text sits at a fixed parameter index
	var TEXT_PARAM = { 122: 4, 320: 1, 324: 1, 325: 1 };

	function parseDocument(text) {
		return YAML.parseDocument(text);
	}

	function parseContext(contextString) {
		var parts = String(contextString || "").split("/");
		var segments = parts.slice(1);
		// map/troops contexts carry a doubled 'list' segment (the parent context passed
		// to fetchCommandList already ends with 'list' and the command push adds another)
		var out = [];
		for (var i = 0; i < segments.length; i++) {
			if (segments[i] === "") continue; // undefined headerIndex joined as empty segment
			if (segments[i] == "list" && out.length && out[out.length - 1] == "list") continue;
			out.push(segments[i]);
		}
		return { fileName: parts[0], segments: out };
	}

	function toPathValue(segment) {
		return /^\d+$/.test(segment) ? parseInt(segment, 10) : segment;
	}

	function safeGetIn(doc, path) {
		try { return doc.getIn(path, true); } catch (e) { return undefined; }
	}

	function isSeq(node) {
		return node && node.constructor && node.constructor.name == "YAMLSeq";
	}

	function scalarValue(node) {
		if (!node) return undefined;
		if (node.value === undefined) {
			// collection nodes (YAMLMap/YAMLSeq) have .items instead of .value
			if (node.items !== undefined) return undefined;
			return node; // plain value passed through
		}
		return node.value;
	}

	function commandCode(node) {
		if (!node || !node.getIn) return undefined;
		var c = node.getIn(["c"], true);
		return c ? c.value : undefined;
	}

	function resolveNode(doc, segments) {
		// longest-prefix walk: deepest node reachable via getIn
		var path = [];
		var node = doc.contents;
		var consumed = 0;
		for (var i = 0; i < segments.length; i++) {
			var nextPath = path.concat([toPathValue(segments[i])]);
			var next = safeGetIn(doc, nextPath);
			if (next === undefined || next === null) break;
			path = nextPath;
			node = next;
			consumed = i + 1;
		}
		return { node: node, path: path, consumed: consumed, tail: segments.slice(consumed) };
	}

	function paramTextNode(cmdNode, idx) {
		if (!cmdNode || !cmdNode.getIn) return null;
		var p = cmdNode.getIn(["p"], true);
		if (!p || !p.getIn) return null;
		var t = p.getIn([idx], true);
		if (!t || typeof t.value != "string") return null;
		return t;
	}

	function blockSpan(listNode, index, kind) {
		var items = listNode.items;
		var header = items[index];
		if (!header) return null;
		var bodyCode = BLOCK_KINDS[kind] ? BLOCK_KINDS[kind].body : null;
		var end = index;
		if (bodyCode !== null) {
			for (var i = index + 1; i < items.length; i++) {
				if (commandCode(items[i]) != bodyCode) break;
				end = i;
			}
		}
		return { startIndex: index, endIndex: end, headerCode: commandCode(header) };
	}

	function blockTextSpan(listNode, startIndex, endIndex, includeHeader) {
		// from the first non-empty text param to the last text param of the block.
		// includeHeader: header's p[0] carries text (XP 101 first line; 108/408 comments);
		// for VX/Ace messages p[0] on the 101 header is the face name and must be skipped.
		var first = null, last = null;
		for (var i = (includeHeader ? startIndex : startIndex + 1); i <= endIndex; i++) {
			var t = paramTextNode(listNode.items[i], 0);
			if (!t) continue;
			if (!first && t.value !== "") first = t;
			last = t;
		}
		if (!first || !last) {
			return { start: listNode.items[startIndex].range[0], end: listNode.items[endIndex].range[1] };
		}
		return { start: first.range[0], end: last.range[1] };
	}

	function normalizeText(s) {
		return String(s || "").replace(/\r\n/g, "\n").trim();
	}

	function findCommentRun(listNode, code, rowText) {
		// quirk mitigation: locate a run of `code` commands whose joined text
		// matches the row's original text
		var want = normalizeText(rowText);
		if (!want) return null;
		var items = listNode.items;
		var i = 0;
		while (i < items.length) {
			if (commandCode(items[i]) == code) {
				var j = i, texts = [];
				while (j < items.length && commandCode(items[j]) == code) {
					var t = paramTextNode(items[j], 0);
					texts.push(t ? t.value : "");
					j++;
				}
				if (normalizeText(texts.join("\n")) == want) {
					return { startIndex: i, endIndex: j - 1, headerCode: code };
				}
				i = j;
			} else {
				i++;
			}
		}
		return null;
	}

	function computeHighlight(doc, resolved, rowText, engineCode) {
		// engineCode: "xp" | "vx" | "vxace" (derived from trans.project.gameEngine)
		var node = resolved.node;
		if (!resolved.consumed) return null; // nothing resolved: skip rather than highlight the whole file
		if (!node || !node.range) return null;
		var tail = resolved.tail || [];
		var kind = BLOCK_KINDS[tail[0]] ? tail[0] : null;

		if (kind) {
			var listPath = resolved.path.slice(0, -1);
			var idx = resolved.path[resolved.path.length - 1];
			var listNode = safeGetIn(doc, listPath);
			// header text: XP 101 carries the first line; 108/408 carry comment text;
			// VX/Ace 101/105 headers carry no text (p[0] is the face name / params)
			var includeHeader = (kind == "vxcomm" || kind == "addcomm" || (kind == "message" && engineCode == "xp"));
			if (listNode && isSeq(listNode) && typeof idx == "number") {
				var span = blockSpan(listNode, idx, kind);
				if (span && span.headerCode == BLOCK_KINDS[kind].header) {
					return blockTextSpan(listNode, span.startIndex, span.endIndex, includeHeader);
				}
			}
			if (kind == "vxcomm" || kind == "addcomm") {
				// quirk mitigation: the stored index may be wrong (last 101) or missing entirely
				// (undefined joined as an empty segment) — locate the run by joined-text match;
				// with a missing index the resolved node itself is the list
				var altList = (isSeq(node) ? node : (listNode && isSeq(listNode) ? listNode : null));
				if (altList) {
					var alt = findCommentRun(altList, BLOCK_KINDS[kind].header, rowText);
					if (alt) return blockTextSpan(altList, alt.startIndex, alt.endIndex, true);
				}
			}
			return { start: node.range[0], end: node.range[1] };
		}

		var code = commandCode(node);
		if (code !== undefined) {
			if (code == 102) {
				var choices = node.getIn(["p", 0], true);
				if (choices && choices.range) return { start: choices.range[0], end: choices.range[1] };
			}
			var pIdx = TEXT_PARAM[code];
			if (pIdx !== undefined) {
				var t = paramTextNode(node, pIdx);
				if (t) return { start: t.range[0], end: t.range[1] };
			}
			return { start: node.range[0], end: node.range[1] };
		}

		return { start: node.range[0], end: node.range[1] };
	}

	function commandSuffix(tail) {
		if (tail[0] == "message" && tail.length >= 3) {
			return " (" + tail[2] + ", " + (tail[1] == "hasPicture" ? "with picture" : "no picture") + ")";
		}
		return "";
	}

	function describe(doc, parsed, resolved, dataType, eventCodes) {
		var segs = parsed.segments;
		var tail = resolved.tail || [];
		var kind = BLOCK_KINDS[tail[0]] ? tail[0] : null;
		var rows = [{ label: "File", value: parsed.fileName + ".yaml" }];

		function scalar(path) {
			var v = scalarValue(safeGetIn(doc, path));
			return v === undefined || v === null ? "" : String(v);
		}

		if (segs[0] == "events" && segs[2] == "pages") {
			rows.push({ label: "Event", value: "Event " + segs[1] + " \u300C" + scalar(["events", toPathValue(segs[1]), "name"]) + "\u300D" });
			rows.push({ label: "Page", value: String(parseInt(segs[3], 10) + 1) });
		} else if (dataType == "commonevents" || dataType == "troops") {
			rows.push({ label: "Entry", value: parsed.fileName + " " + segs[0] + " \u300C" + scalar([toPathValue(segs[0]), "name"]) + "\u300D" });
			if (segs[1] == "pages") rows.push({ label: "Page", value: String(parseInt(segs[2], 10) + 1) });
		} else if (dataType == "map" && (segs[0] == "display_name" || segs[0] == "note")) {
			rows.push({ label: "Field", value: segs[0] == "display_name" ? "Map display name" : "Map note" });
		} else if (dataType == "system") {
			rows.push({ label: "Section", value: segs.join(" / ") });
		} else {
			var namePath = resolved.path.length > 1 ? resolved.path.slice(0, -1).concat(["name"]) : null;
			var entryName = namePath ? scalar(namePath) : "";
			if (entryName) rows.push({ label: "Entry", value: parsed.fileName + " " + segs[0] + " \u300C" + entryName + "\u300D" });
			var field = resolved.path.length ? resolved.path[resolved.path.length - 1] : tail[0];
			if (field !== undefined && typeof field != "number") rows.push({ label: "Field", value: String(field) });
		}

		if (kind) {
			rows.push({ label: "Command", value: BLOCK_KINDS[kind].label + commandSuffix(tail) });
		} else {
			var code = commandCode(resolved.node);
			if (code !== undefined) {
				var name = (eventCodes && eventCodes[String(code)]) || ("Code " + code);
				rows.push({ label: "Command", value: name + commandSuffix(tail) });
			} else if (tail[0]) {
				rows.push({ label: "Command", value: tail[0] + commandSuffix(tail) });
			}
		}

		var listPos = resolved.path.lastIndexOf("list");
		if (listPos != -1 && typeof resolved.path[listPos + 1] == "number") {
			rows.push({ label: "Command #", value: String(resolved.path[listPos + 1] + 1) });
		}
		return rows;
	}

	function looksLikeTable(v) {
		return v && typeof v == "object" && !Array.isArray(v) &&
			("dim" in v) && ("data" in v) && Array.isArray(v.data);
	}

	function sanitizeTree(v, depth, seen) {
		if (depth > 64) return "[Depth limit reached]";
		if (v === null || v === undefined) return v;
		if (typeof v == "string") {
			if (v.length > 4096 || /[\u0000-\u0008\u000E-\u001F]/.test(v)) return "[" + v.length + " chars omitted]";
			return v;
		}
		if (typeof v != "object") return v;
		if (seen.indexOf(v) != -1) return "[Repeated reference]";
		seen = seen.concat([v]);
		if (looksLikeTable(v)) return "[Table data omitted]";
		if (Array.isArray(v)) {
			if (v.length > 20000) return "[" + v.length + " items omitted]";
			var out = [];
			for (var i = 0; i < v.length; i++) out.push(sanitizeTree(v[i], depth + 1, seen));
			return out;
		}
		var obj = {};
		for (var key in v) {
			// guard the renderer: assigning these keys corrupts the target object
			if (key == "__proto__" || key == "constructor" || key == "prototype") continue;
			obj[key] = sanitizeTree(v[key], depth + 1, seen);
		}
		return obj;
	}

	function toTreeData(doc) {
		var js;
		try { js = doc.toJSON(); } catch (e) { return null; }
		try { return sanitizeTree(js, 0, []); } catch (e) { return null; }
	}

	function treeExpandPath(treeData, path) {
		// convert YAML paths to jsoneditor child indexes: object keys become their
		// ordinal among that object's keys, array segments stay numeric indices.
		// Only container nodes are targeted: expanding a scalar leaf never mutates
		// the DOM, which would leave JsonEditorHelper.expandPoint pending forever.
		var out = [];
		var cur = treeData;
		for (var i = 0; i < path.length; i++) {
			var seg = path[i];
			var next;
			if (Array.isArray(cur)) {
				if (typeof seg != "number" || seg < 0 || seg >= cur.length) break;
				next = cur[seg];
				if (next === null || typeof next != "object") break;
				out.push(seg);
				cur = next;
			} else if (cur && typeof cur == "object") {
				var ord = Object.keys(cur).indexOf(String(seg));
				if (ord == -1) break;
				next = cur[String(seg)];
				if (next === null || typeof next != "object") break;
				out.push(ord);
				cur = next;
			} else {
				break;
			}
		}
		return out;
	}

	function findIniEntry(iniText, category, key) {
		var re = /^(?:\uFEFF)?\[([^\]]+)\][ \t]*$|^([^=\r\n\[;]+?)[ \t]*=[ \t]*([^\r\n]*)/gm;
		var m;
		var inCat = false;
		while ((m = re.exec(iniText)) !== null) {
			if (m[1] !== undefined) {
				inCat = (m[1].trim() == category);
				continue;
			}
			if (!inCat) continue;
			if (m[2].trim() != key) continue;
			var valueStart = m.index + m[0].indexOf("=") + 1;
			var end = m.index + m[0].length;
			while (end > valueStart && (iniText.charAt(end - 1) == " " || iniText.charAt(end - 1) == "\t")) end--;
			return {
				start: valueStart,
				end: end,
				lineStart: m.index,
				line: 1 + (iniText.substring(0, m.index).match(/\r\n|\n/g) || []).length
			};
		}
		return null;
	}

	return {
		parseDocument: parseDocument,
		parseContext: parseContext,
		toPathValue: toPathValue,
		resolveNode: resolveNode,
		safeGetIn: safeGetIn,
		scalarValue: scalarValue,
		commandCode: commandCode,
		computeHighlight: computeHighlight,
		describe: describe,
		toTreeData: toTreeData,
		findIniEntry: findIniEntry,
		findCommentRun: findCommentRun,
		treeExpandPath: treeExpandPath,
		BLOCK_KINDS: BLOCK_KINDS
	};
})();

if (typeof module != "undefined") module.exports = RMRAW;
