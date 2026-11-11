// Pure, DOM-free logic for the MV/MZ Raw tab alignment (beautified JSON snippets).

var MVRAW = (function () {

	var BLOCK_CODES = {
		message:			{ header: 101, body: 401 },
		scrollingMessage:	{ header: 105, body: 405 },
		comment:			{ header: 108, body: 408 }
	};

	function parseContext(contextString) {
		var parts = String(contextString || "").split("/");
		return { fileName: parts[0], segments: parts.slice(1) };
	}

	function valueAt(root, segments) {
		var cur = root;
		for (var i = 0; i < segments.length; i++) {
			if (cur === null || cur === undefined) return undefined;
			var seg = segments[i];
			if (Array.isArray(cur)) {
				var idx = /^\d+$/.test(seg) ? parseInt(seg, 10) : NaN;
				if (!(idx >= 0 && idx < cur.length)) return undefined;
				cur = cur[idx];
			} else if (typeof cur == "object") {
				if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
				cur = cur[seg];
			} else {
				return undefined;
			}
		}
		return cur;
	}

	function resolveSegments(root, segments) {
		for (var n = segments.length; n > 0; n--) {
			if (valueAt(root, segments.slice(0, n)) !== undefined) return n;
		}
		return 0;
	}

	function isWs(c) { return c == " " || c == "\t" || c == "\n" || c == "\r"; }
	function skipWs(s, i) { while (i < s.length && isWs(s.charAt(i))) i++; return i; }

	function scanString(s, i) {
		// i at opening quote; returns index just past closing quote
		i++;
		while (i < s.length) {
			var c = s.charAt(i);
			if (c == "\\") { i += 2; continue; }
			if (c == '"') return i + 1;
			i++;
		}
		return i;
	}

	function scanBracket(s, i, open, close) {
		var depth = 0;
		while (i < s.length) {
			var c = s.charAt(i);
			if (c == '"') { i = scanString(s, i); continue; }
			if (c == open) depth++;
			else if (c == close) { depth--; if (depth == 0) return i + 1; }
			i++;
		}
		return i;
	}

	function scanValue(s, i) {
		i = skipWs(s, i);
		var start = i;
		var c = s.charAt(i);
		if (c == "{") return { start: start, end: scanBracket(s, i, "{", "}") };
		if (c == "[") return { start: start, end: scanBracket(s, i, "[", "]") };
		if (c == '"') return { start: start, end: scanString(s, i) };
		while (i < s.length && ",}] \t\r\n".indexOf(s.charAt(i)) == -1) i++;
		return { start: start, end: i };
	}

	function parseKey(s, i) {
		var end = scanString(s, i);
		var name = null;
		try { name = JSON.parse(s.substring(i, end)); } catch (e) {}
		return { end: end, name: name };
	}

	function memberRanges(s, containerStart) {
		// members of the object/array whose opening bracket is at containerStart
		var isObj = s.charAt(containerStart) == "{";
		var i = containerStart + 1;
		var out = [];
		for (;;) {
			i = skipWs(s, i);
			var c = s.charAt(i);
			if (c === "" || c == "}" || c == "]") break;
			var key = null;
			if (isObj) {
				var k = parseKey(s, i);
				key = k.name;
				i = skipWs(s, k.end);
				i++; // colon
			}
			var r = scanValue(s, i);
			out.push({ key: key, range: r });
			i = skipWs(s, r.end);
			if (s.charAt(i) == ",") i++;
		}
		return out;
	}

	function findRange(s, containerStart, seg) {
		var members = memberRanges(s, containerStart);
		if (members.length > 0 && members[0].key === null) {
			var idx = parseInt(seg, 10);
			if (isNaN(idx) || idx < 0 || idx >= members.length) return null;
			return members[idx].range;
		}
		for (var i = 0; i < members.length; i++) {
			if (members[i].key === seg) return members[i].range;
		}
		return null;
	}

	function findNode(s, root, segments) {
		var consumed = resolveSegments(root, segments);
		var segs = segments.slice(0, consumed);
		var range = scanValue(s, 0);
		for (var i = 0; i < segs.length; i++) {
			var next = findRange(s, range.start, segs[i]);
			if (!next) {
				consumed = i;
				break;
			}
			range = next;
		}
		return { start: range.start, end: range.end, consumed: consumed };
	}

	function findSnippet(s, root, segments) {
		var hit = findNode(s, root, segments);
		var tail = segments.slice(hit.consumed);
		var kind = BLOCK_CODES[tail[0]] ? tail[0] : null;
		if (!kind) return hit;

		var segs = segments.slice(0, hit.consumed);
		var headerIdx = segs[segs.length - 1];
		if (typeof headerIdx != "string" || !/^\d+$/.test(headerIdx)) return hit;
		var listSegs = segs.slice(0, -1);
		var listValue = valueAt(root, listSegs);
		if (!Array.isArray(listValue)) return hit;

		var idx = parseInt(headerIdx, 10);
		if (!(listValue[idx] && listValue[idx].code == BLOCK_CODES[kind].header)) return hit;
		var listRange = findNode(s, root, listSegs);
		var members = memberRanges(s, listRange.start);
		var endRange = members[idx] ? members[idx].range : null;
		if (!endRange) return hit;
		for (var i = idx + 1; i < listValue.length; i++) {
			if (!members[i]) break;
			if (listValue[i] && listValue[i].code == BLOCK_CODES[kind].body) endRange = members[i].range;
			else break;
		}
		return { start: hit.start, end: endRange.end, consumed: hit.consumed };
	}

	function messageSuffix(tail) {
		if (tail[0] == "message" && tail.length >= 3) {
			return " (" + tail[2] + ", " + (tail[1] == "hasPicture" ? "with picture" : "no picture") + ")";
		}
		return "";
	}

	function describe(root, parsed, eventCodes) {
		var segs = parsed.segments;
		var rows = [{ label: "File", value: parsed.fileName + ".json" }];

		function val(pathSegs) {
			var v = valueAt(root, pathSegs);
			return v === undefined || v === null ? "" : String(v);
		}

		if (segs[0] == "events" && segs[2] == "pages") {
			rows.push({ label: "Event", value: "Event " + segs[1] + " \u300C" + val(["events", segs[1], "name"]) + "\u300D" });
			rows.push({ label: "Page", value: String(parseInt(segs[3], 10) + 1) });
		} else if (parsed.fileName.toLowerCase() == "commonevents" || parsed.fileName.toLowerCase() == "troops") {
			rows.push({ label: "Entry", value: parsed.fileName + " " + segs[0] + " \u300C" + val([segs[0], "name"]) + "\u300D" });
			if (segs[1] == "pages") rows.push({ label: "Page", value: String(parseInt(segs[2], 10) + 1) });
		} else if (segs[0] == "displayName" || segs[0] == "note") {
			rows.push({ label: "Field", value: segs[0] == "displayName" ? "Map display name" : "Map note" });
		} else if (parsed.fileName.toLowerCase() == "system") {
			rows.push({ label: "Section", value: segs.join(" / ") });
		} else {
			var entryName = val([segs[0], "name"]);
			if (entryName) rows.push({ label: "Entry", value: parsed.fileName + " " + segs[0] + " \u300C" + entryName + "\u300D" });
			if (segs.length > 1) rows.push({ label: "Field", value: segs[segs.length - 1] });
		}

		for (var i = 0; i < segs.length; i++) {
			if (segs[i] == "list" && /^\d+$/.test(segs[i + 1] || "")) {
				rows.push({ label: "Command #", value: String(parseInt(segs[i + 1], 10) + 1) });
				var cmd = valueAt(root, segs.slice(0, i + 2));
				if (cmd && cmd.code !== undefined) {
					var name = (eventCodes && eventCodes[String(cmd.code)]) || ("Code " + cmd.code);
					rows.push({ label: "Command", value: name + messageSuffix(segs.slice(i + 2)) });
				}
				break;
			}
		}
		return rows;
	}

	return {
		parseContext: parseContext,
		valueAt: valueAt,
		findSnippet: findSnippet,
		describe: describe
	};
})();

if (typeof module != "undefined") module.exports = MVRAW;
