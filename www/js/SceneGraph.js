var SceneGraph = (function() {

	var RM_ENGINES = ["rmmv", "rmmz", "rmvxace", "rmvx", "rmxp"];
	var RGSS_ENGINES = ["rmvxace", "rmvx", "rmxp"];

	var CODE = {
		END: 0,
		SHOW_TEXT: 101,
		SHOW_TEXT_BODY: 401,
		SHOW_CHOICES: 102,
		WHEN_CHOICE: 402,
		WHEN_CANCEL: 403,
		END_CHOICES: 404,
		SCROLL_TEXT: 105,
		SCROLL_TEXT_BODY: 405,
		CALL_CE: 117,
		CONDITIONAL: 111,
		ELSE: 411,
		BRANCH_END: 412,
		LOOP: 112,
		REPEAT: 413,
		BREAK_LOOP: 113,
		EXIT_EVENT: 115,
		LABEL: 118,
		JUMP_LABEL: 119,
		TRANSFER: 201,
		SCRIPT: 355,
		SCRIPT_CONT: 655,
		PLUGIN_CMD: 356,
		CHANGE_NAME: 320,
		CHANGE_NICKNAME: 324,
		CHANGE_PROFILE: 325,
		CONTROL_VAR: 122,
		WAIT: 230,
		SHOW_PICTURE: 231,
		ERASE_PICTURE: 235,
		PLAY_SE: 250,
	};

	var DIALOGUE_KINDS = {
		"message": "dialogue",
		"scrollingMessage": "scrolling",
		"Show Choices": "choice",
		"Show Text Attributes": "speaker",
	};

	function _cleanControlCodes(text) {
		var result = text;
		result = result.replace(/\\nw<[^>]*>/gi, '');
		result = result.replace(/\\[a-z]{1,3}\[\d+\]/gi, function(m) {
			if (/^\\n\[\d+\]$/i.test(m)) return m;
			return '';
		});
		result = result.replace(/\\[!^$.|><\\]/g, '');
		result = result.replace(/\\[{}]/g, '');
		result = result.replace(/[ \t]{2,}/g, ' ');
		return result.trim();
	}

	function _stripDialogueBrackets(text) {
		var lines = text.split('\n');
		for (var li = 0; li < lines.length; li++) {
			var line = lines[li];
			if (line.length > 2 && line.charAt(0) === '「' && line.charAt(line.length - 1) === '」') {
				lines[li] = line.substring(1, line.length - 1);
			} else if (line.length > 2 && line.charAt(0) === '『' && line.charAt(line.length - 1) === '』') {
				lines[li] = line.substring(1, line.length - 1);
			}
		}
		return lines.join('\n');
	}

	var _scenes = {};
	var _sceneOrder = [];
	var _rowMap = {};
	var _ceLinks = {};
	var _ceCallers = {};
	var _mapNames = {};
	var _built = false;
	var _stats = {};
	var _cryptoAddon = null;
	var _cryptoResolved = false;
	var _cryptoParams = null;
	var _cryptoParamsTried = false;

	function _reset() {
		_scenes = {};
		_sceneOrder = [];
		_rowMap = {};
		_ceLinks = {};
		_ceCallers = {};
		_mapNames = {};
		_built = false;
		_stats = {};
		_cryptoAddon = null;
		_cryptoResolved = false;
		_cryptoParams = null;
		_cryptoParamsTried = false;
	}

	function _isRMGame() {
		try {
			return RM_ENGINES.indexOf(trans.project.gameEngine) !== -1;
		} catch (e) {
			return false;
		}
	}

	function _isRGSSEngine() {
		var engine = "";
		try { engine = trans.project.gameEngine; } catch(e) {}
		return RGSS_ENGINES.indexOf(engine) !== -1;
	}

	function _getStagingDataPath() {
		try {
			return trans.getStagingDataPath();
		} catch (e) {
			return null;
		}
	}

	function _getGameDataPath() {
		var engine = "";
		try { engine = trans.project.gameEngine; } catch(e) {}

		// RGSS engines (XP/VX/VX Ace) all unpack to the same rvpacker YAML layout
		if (_isRGSSEngine()) {
			try {
				var stagingPath = nwPath.resolve(trans.project.cache.cachePath);
				var yamlPath = nwPath.join(stagingPath, "data", "YAML");
				if (fs.existsSync(nwPath.join(yamlPath, "CommonEvents.yaml"))) return yamlPath;
				yamlPath = nwPath.join(stagingPath, "data", "data", "YAML");
				if (fs.existsSync(nwPath.join(yamlPath, "CommonEvents.yaml"))) return yamlPath;
			} catch(e) {}
			return null;
		}

		try {
			if (trans.project.loc) {
				var gameData = nwPath.join(trans.project.loc, "data");
				if (fs.existsSync(nwPath.join(gameData, "System.json"))) return gameData;
			}
		} catch (e) {}

		try {
			var stagingPath2 = nwPath.resolve(trans.project.cache.cachePath);
			var stagedData = nwPath.join(stagingPath2, "data", "data");
			if (fs.existsSync(nwPath.join(stagedData, "System.json"))) return stagedData;
			stagedData = nwPath.join(stagingPath2, "data");
			if (fs.existsSync(nwPath.join(stagedData, "System.json"))) return stagedData;
		} catch (e) {}

		try {
			return trans.getStagingDataPath();
		} catch (e) {}

		return null;
	}

	// The rmmv core module decrypts protected MV/MZ data containers
	// (uid/bid/data wrappers). SceneGraph reuses it so encrypted games
	// get scene tracing too.
	function _getCryptoAddon() {
		if (_cryptoResolved) return _cryptoAddon;
		_cryptoResolved = true;
		try {
			if (typeof addonLoader !== "undefined" && addonLoader && addonLoader.addons) {
				for (var dir in addonLoader.addons) {
					var addon = addonLoader.addons[dir];
					if (addon && addon.RMMZDataCrypto) {
						_cryptoAddon = addon;
						break;
					}
				}
			}
		} catch (e) {}
		return _cryptoAddon;
	}

	function _resolveCryptoParams() {
		if (_cryptoParamsTried) return _cryptoParams;
		_cryptoParamsTried = true;
		_cryptoParams = null;

		try {
			if (trans.project.rmmzCryptoParams) {
				_cryptoParams = trans.project.rmmzCryptoParams;
				return _cryptoParams;
			}
		} catch (e) {}

		var addon = _getCryptoAddon();
		if (!addon) return _cryptoParams;

		try {
			if (addon.RMMVGames && addon.RMMVGames._lastCryptoParams) {
				_cryptoParams = addon.RMMVGames._lastCryptoParams;
				return _cryptoParams;
			}
		} catch (e) {}

		var engine = "";
		try { engine = trans.project.gameEngine; } catch (e) {}

		var jsDirs = [];
		try {
			if (trans.project.loc) {
				jsDirs.push(nwPath.join(trans.project.loc, "js"));
				jsDirs.push(nwPath.join(trans.project.loc, "www", "js"));
			}
		} catch (e) {}
		try {
			var stagingPath = nwPath.resolve(trans.project.cache.cachePath);
			jsDirs.push(nwPath.join(stagingPath, "js"));
			jsDirs.push(nwPath.join(stagingPath, "data", "js"));
		} catch (e) {}

		for (var i = 0; i < jsDirs.length; i++) {
			try {
				var params = addon.RMMZDataCrypto.detectParamsSync(jsDirs[i], engine);
				if (params) {
					_cryptoParams = params;
					break;
				}
			} catch (e) {}
		}
		return _cryptoParams;
	}

	function _isEncryptedWrapper(obj) {
		return !!(obj && typeof obj === "object" && obj.uid && obj.bid && obj.data && typeof obj.data === "string");
	}

	function _readJSON(fullPath) {
		try {
			var text = fs.readFileSync(fullPath, "utf-8");
			var obj = JSON.parse(text);
			if (_isEncryptedWrapper(obj)) {
				var addon = _getCryptoAddon();
				if (!addon || !addon.RMMZDataCrypto) return null;
				obj = addon.RMMZDataCrypto.decrypt(obj, fullPath, _resolveCryptoParams());
			}
			return obj;
		} catch (e) {
			return null;
		}
	}

	function _getSpeakerFromParams(params, isMZ) {
		if (!Array.isArray(params)) return "";
		if (isMZ) {
			if (params.length > 4 && typeof params[4] === "string" && params[4].length > 0) {
				return params[4];
			}
			if (params.length > 0 && typeof params[0] === "string" && params[0].length > 0) {
				return params[0];
			}
		} else {
			if (params.length > 0 && typeof params[0] === "string" && params[0].length > 0) {
				return params[0];
			}
			if (params.length > 4 && typeof params[4] === "string" && params[4].length > 0) {
				return params[4];
			}
		}
		return "";
	}

	function _loadMapNames(stagingDataPath) {
		var miPath = nwPath.join(stagingDataPath, "MapInfos.json");
		var mi = _readJSON(miPath);
		if (!Array.isArray(mi)) return;
		for (var i = 0; i < mi.length; i++) {
			if (mi[i] && typeof mi[i] === "object") {
				var id = mi[i].id;
				var name = mi[i].name || "";
				if (id !== undefined) {
					var mapId = "Map" + String(id).padStart(3, "0");
					_mapNames[mapId] = name;
				}
			}
		}
	}

	function _makeSceneId(fileBase, eventIndex, pageIndex) {
		if (pageIndex !== undefined) {
			return fileBase + "#" + eventIndex + "#" + pageIndex;
		}
		return fileBase + "#" + eventIndex;
	}

	function _analyzeScene(cmdList, sceneData, isMZ) {
		var currentSpeaker = "";
		var currentHeaderIndex = -1;
		var order = 0;

		for (var i = 0; i < cmdList.length; i++) {
			var cmd = cmdList[i];
			if (!cmd) continue;
			var code = cmd.code;
			var params = cmd.parameters || [];
			var indent = cmd.indent || 0;

			if (code === CODE.SHOW_TEXT) {
				currentSpeaker = _getSpeakerFromParams(params, isMZ);
				currentHeaderIndex = i;
			}
			else if (code === CODE.SHOW_TEXT_BODY) {
				sceneData.speakersByListIndex[i] = currentSpeaker;
				if (currentHeaderIndex >= 0) {
					sceneData.speakersByListIndex[currentHeaderIndex] = currentSpeaker;
					sceneData.orderByListIndex[currentHeaderIndex] = order;
				}
				sceneData.orderByListIndex[i] = order;
				sceneData.kindsByListIndex[i] = "dialogue";
				order++;
			}
			else if (code === CODE.SCROLL_TEXT) {
				currentSpeaker = "";
				currentHeaderIndex = i;
			}
			else if (code === CODE.SCROLL_TEXT_BODY) {
				sceneData.speakersByListIndex[i] = "";
				sceneData.orderByListIndex[i] = order;
				sceneData.kindsByListIndex[i] = "scrolling";
				order++;
			}
			else if (code === CODE.SHOW_CHOICES) {
				var choices = params[0] || [];
				for (var c = 0; c < choices.length; c++) {
					sceneData.speakersByListIndex["c" + i + "_" + c] = "";
					sceneData.orderByListIndex["c" + i + "_" + c] = order;
					sceneData.kindsByListIndex["c" + i + "_" + c] = "choice";
					order++;
				}
			}
			else if (code === CODE.WHEN_CHOICE) {
				sceneData.orderByListIndex[i] = order;
				sceneData.kindsByListIndex[i] = "choiceBranch";
			}
			else if (code === CODE.CALL_CE) {
				var ceId = params[0];
				if (ceId !== undefined && ceId > 0) {
					sceneData.ceCalls.push({
						target: ceId,
						atListIndex: i,
						atOrder: order,
						indent: indent,
					});
				}
			}
			else if (code === CODE.TRANSFER) {
				var direct = params[0];
				var mapId = params[1];
				if (mapId !== undefined && mapId > 0) {
					var mapFile = "Map" + String(mapId).padStart(3, "0");
					sceneData.transfers.push({
						target: mapFile,
						atListIndex: i,
						atOrder: order,
					});
				}
			}
			else if (code === CODE.CONDITIONAL) {
				sceneData.hasBranches = true;
			}
			else if (code === CODE.SHOW_TEXT && currentSpeaker) {
				sceneData.speakersByListIndex[i] = currentSpeaker;
			}
		}

		sceneData.totalOrders = order;
	}

	function _buildMapScenes(stagingDataPath, isMZ) {
		try {
			var entries = fs.readdirSync(stagingDataPath);
		} catch (e) {
			return;
		}

		for (var e = 0; e < entries.length; e++) {
			var fname = entries[e];
			if (!/^Map\d{3}\.json$/.test(fname)) continue;
			if (fname === "MapInfos.json") continue;

			var fullPath = nwPath.join(stagingDataPath, fname);
			var mapData = _readJSON(fullPath);
			if (!mapData || !mapData.events) continue;

			var fileBase = fname.replace(/\.json$/, "");
			var mapName = _mapNames[fileBase] || "";

			var events = mapData.events;
			for (var evIdx = 1; evIdx < events.length; evIdx++) {
				var ev = events[evIdx];
				if (!ev || typeof ev !== "object") continue;
				var pages = ev.pages || [];
				for (var pgIdx = 0; pgIdx < pages.length; pgIdx++) {
					var page = pages[pgIdx];
					if (!page || !page.list || page.list.length < 2) continue;

					var hasDialogue = false;
					for (var ci = 0; ci < page.list.length; ci++) {
						var c = page.list[ci];
						if (c && (c.code === CODE.SHOW_TEXT_BODY || c.code === CODE.SCROLL_TEXT_BODY || c.code === CODE.SHOW_CHOICES || c.code === CODE.CALL_CE)) {
							hasDialogue = true;
							break;
						}
					}
					if (!hasDialogue && !(page.list.length === 1 && page.list[0].code === 0)) continue;

					var sceneId = _makeSceneId(fileBase, evIdx, pgIdx);
					var scene = {
						id: sceneId,
						type: "map",
						file: fileBase,
						fileKey: "data/" + fname,
						eventIndex: evIdx,
						pageIndex: pgIdx,
						eventName: ev.name || "",
						mapName: mapName,
						label: "",
						speakersByListIndex: {},
						orderByListIndex: {},
						kindsByListIndex: {},
						ceCalls: [],
						transfers: [],
						hasBranches: false,
						totalOrders: 0,
						rowCount: 0,
					};

					_analyzeScene(page.list, scene, isMZ);
					scene.label = _buildSceneLabel(scene);
					_scenes[sceneId] = scene;
					_sceneOrder.push(sceneId);

					for (var cc = 0; cc < scene.ceCalls.length; cc++) {
						var ceTarget = scene.ceCalls[cc].target;
						if (!_ceLinks[sceneId]) _ceLinks[sceneId] = [];
						_ceLinks[sceneId].push(scene.ceCalls[cc]);
						var ceKey = "CommonEvents#" + ceTarget;
						if (!_ceCallers[ceKey]) _ceCallers[ceKey] = [];
						_ceCallers[ceKey].push({
							sceneId: sceneId,
							file: fileBase,
							eventIndex: evIdx,
							pageIndex: pgIdx,
						});
					}
				}
			}
		}
	}

	function _buildCommonEventScenes(stagingDataPath, isMZ) {
		var cePath = nwPath.join(stagingDataPath, "CommonEvents.json");
		var ceData = _readJSON(cePath);
		if (!Array.isArray(ceData)) return;

		var fileBase = "CommonEvents";

		for (var ceIdx = 1; ceIdx < ceData.length; ceIdx++) {
			var ce = ceData[ceIdx];
			if (!ce || typeof ce !== "object") continue;
			var cmdList = ce.list;
			if (!cmdList || cmdList.length < 2) continue;

			var hasDialogue = false;
			for (var ci = 0; ci < cmdList.length; ci++) {
				var c = cmdList[ci];
				if (c && (c.code === CODE.SHOW_TEXT_BODY || c.code === CODE.SCROLL_TEXT_BODY || c.code === CODE.SHOW_CHOICES || c.code === CODE.CALL_CE)) {
					hasDialogue = true;
					break;
				}
			}
			if (!hasDialogue) continue;

			var sceneId = _makeSceneId(fileBase, ceIdx);
			var scene = {
				id: sceneId,
				type: "commonevent",
				file: fileBase,
				fileKey: "data/CommonEvents.json",
				eventIndex: ceIdx,
				pageIndex: undefined,
				eventName: ce.name || "",
				mapName: "",
				label: "",
				speakersByListIndex: {},
				orderByListIndex: {},
				kindsByListIndex: {},
				ceCalls: [],
				transfers: [],
				hasBranches: false,
				totalOrders: 0,
				rowCount: 0,
				callers: [],
			};

			_analyzeScene(cmdList, scene, isMZ);
			scene.callers = _ceCallers[sceneId] || [];
			scene.label = _buildSceneLabel(scene);
			_scenes[sceneId] = scene;
			_sceneOrder.push(sceneId);

			for (var cc = 0; cc < scene.ceCalls.length; cc++) {
				var ceTarget = scene.ceCalls[cc].target;
				if (!_ceLinks[sceneId]) _ceLinks[sceneId] = [];
				_ceLinks[sceneId].push(scene.ceCalls[cc]);
				var ceKey = "CommonEvents#" + ceTarget;
				if (!_ceCallers[ceKey]) _ceCallers[ceKey] = [];
				_ceCallers[ceKey].push({
					sceneId: sceneId,
					file: fileBase,
					eventIndex: ceIdx,
				});
			}
		}
	}

	function _buildSceneLabel(scene) {
		var parts = [];
		if (scene.type === "map") {
			if (scene.mapName) parts.push(scene.mapName);
			parts.push(scene.file);
			if (scene.eventName) parts.push("\"" + scene.eventName + "\"");
			parts.push("Ev" + scene.eventIndex + "/Pg" + scene.pageIndex);
		} else {
			parts.push("CommonEvent");
			parts.push("#" + scene.eventIndex);
			if (scene.eventName) parts.push("\"" + scene.eventName + "\"");
		}
		return parts.join(" ");
	}

	function _parseContext(ctxStr) {
		if (typeof ctxStr !== "string") return null;
		var parts = ctxStr.split("/");
		if (parts.length < 2) return null;

		var info = {
			fileBase: parts[0],
			eventIndex: -1,
			pageIndex: undefined,
			listIndex: -1,
			kind: "",
			raw: ctxStr,
		};

		if (parts.length >= 7 && parts[1] === "events") {
			info.eventIndex = parseInt(parts[2]) || 0;
			if (parts[3] === "pages") {
				info.pageIndex = parseInt(parts[4]) || 0;
				if (parts[5] === "list") {
					var _listOff = (parts[6] === "list") ? 1 : 0;
					if (parts.length >= 7 + _listOff) {
						info.listIndex = parseInt(parts[6 + _listOff]) || 0;
						info.kind = parts[7 + _listOff] || "";
					}
				}
			}
		}
		else if (parts.length >= 4 && parts[0] === "CommonEvents") {
			info.eventIndex = parseInt(parts[1]) || 0;
			if (parts[2] === "list" && parts.length >= 4) {
				info.listIndex = parseInt(parts[3]) || 0;
				info.kind = parts[4] || "";
			}
		}
		else if (parts.length >= 6 && parts[0] === "Troops") {
			info.eventIndex = parseInt(parts[1]) || 0;
			if (parts[2] === "pages") {
				info.pageIndex = parseInt(parts[3]) || 0;
				if (parts[4] === "list" && parts.length >= 6) {
					info.listIndex = parseInt(parts[5]) || 0;
					info.kind = parts[6] || "";
				}
			}
		}

		if (info.eventIndex < 0 && info.listIndex < 0) return null;

		if (parts[0] === "Troops") info.fileBase = parts[0];
		if (info.kind === "Show Text Attributes" && parts.length > 0) {
			var lastPart = parts[parts.length - 1];
			if (lastPart === "actorName") info.kind = "speaker";
		}

		info.isDialogue = (info.kind === "message" || info.kind === "scrollingMessage" || info.kind === "Show Choices" || info.kind === "speaker");

		return info;
	}

	function _stripYAMLQuotes(str) {
		str = str.trim();
		if (str.length >= 2 && ((str[0] === '"' && str[str.length-1] === '"') || (str[0] === "'" && str[str.length-1] === "'"))) {
			return str.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
		}
		return str;
	}

	// Decodes a base64 !binary payload. Psych emits !binary for marshal
	// strings tagged ASCII-8BIT; the bytes themselves are usually UTF-8
	// (RGSS3 and most RGSS1/2 games) — fall back to Shift_JIS for games that
	// store CP932.
	function _decodeBinaryString(b64) {
		try {
			var bytes = Buffer.from(b64, "base64");
			if (typeof TextDecoder !== "undefined") {
				try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) {}
				try { return new TextDecoder("shift_jis").decode(bytes); } catch (e) {}
			}
			return bytes.toString("utf8");
		} catch (e) {
			return "";
		}
	}

	// Reads a YAML scalar that may be a !binary block (base64 on following,
	// deeper-indented lines) or a plain/quoted scalar on the same line.
	function _readYAMLScalarText(lines, li, raw) {
		raw = (raw || "").trim();
		if (raw.indexOf("!binary") === 0) {
			var curLine = lines[li] || "";
			var indent = curLine.length - curLine.replace(/^\s+/, "").length;
			var b64 = "";
			for (var k = li + 1; k < lines.length; k++) {
				var l = lines[k];
				if (l.trim() === "") break;
				var lIndent = l.length - l.replace(/^\s+/, "").length;
				if (lIndent <= indent) break;
				var t = l.trim();
				if (!/^[A-Za-z0-9+/=]+$/.test(t)) break;
				b64 += t;
			}
			return _decodeBinaryString(b64);
		}
		return _stripYAMLQuotes(raw);
	}

	function _unescapeYAMLString(str) {
		var result = '';
		for (var i = 0; i < str.length; i++) {
			if (str[i] === '\\' && i + 1 < str.length) {
				var nx = str[i + 1];
				if (nx === '\\') { result += '\\'; i++; }
				else if (nx === 'n') { result += '\n'; i++; }
				else if (nx === 't') { result += '\t'; i++; }
				else if (nx === '"') { result += '"'; i++; }
				else if (nx === "'") { result += "'"; i++; }
				else { result += str[i]; }
			} else {
				result += str[i];
			}
		}
		return result;
	}

	function _parseVXAceParams(paramStr) {
		paramStr = paramStr.trim();
		if (paramStr.length < 2 || paramStr[0] !== '[') return [];
		paramStr = paramStr.slice(1, -1).trim();
		if (!paramStr) return [];
		var params = [];
		var i = 0;
		while (i < paramStr.length) {
			while (i < paramStr.length && paramStr[i] === ' ') i++;
			if (i >= paramStr.length) break;
			if (paramStr[i] === '"' || paramStr[i] === "'") {
				var q = paramStr[i]; i++;
				var s = i;
				while (i < paramStr.length && paramStr[i] !== q) {
					if (paramStr[i] === '\\' && q === '"') i++;
					i++;
				}
				var rawStr = paramStr.slice(s, i);
				params.push(q === '"' ? _unescapeYAMLString(rawStr) : rawStr);
				i++;
		} else if (paramStr[i] === '[') {
			var d = 1; var as = i; i++;
			while (i < paramStr.length && d > 0) {
				if (paramStr[i] === '[') d++;
				else if (paramStr[i] === ']') d--;
				i++;
			}
			var arrStr = paramStr.slice(as, i);
			// quoted strings and inline !binary "b64" entries, in order
			var arrVals = [];
			var arrRe = /"((?:[^"\\]|\\.)*)"|!binary\s+"([A-Za-z0-9+/=]+)"/g;
			var am;
			while ((am = arrRe.exec(arrStr)) !== null) {
				if (am[1] !== undefined) arrVals.push(_unescapeYAMLString(am[1]));
				else arrVals.push(_decodeBinaryString(am[2]));
			}
			params.push(arrVals);
		} else {
			var ns = i;
			while (i < paramStr.length && paramStr[i] !== ',') i++;
			var tok = paramStr.slice(ns, i).trim();
			var bm = tok.match(/^!binary\s+"([A-Za-z0-9+/=]+)"$/);
			if (bm) {
				params.push(_decodeBinaryString(bm[1]));
			} else {
				var num = parseInt(tok);
				if (!isNaN(num) && String(num) === tok) params.push(num);
				else params.push(tok);
			}
		}
			while (i < paramStr.length && (paramStr[i] === ',' || paramStr[i] === ' ')) i++;
		}
		return params;
	}

	function _parseVXAceEventCommand(line) {
		var m = line.match(/RPG::EventCommand\s*\{i:\s*(\d+),\s*c:\s*(\d+),\s*p:\s*(\[.*\])\s*\}\s*$/);
		if (!m) return null;
		return { indent: parseInt(m[1]), code: parseInt(m[2]), parameters: _parseVXAceParams(m[3]) };
	}

	function _readVXAceMapYAML(filePath) {
		var text;
		try { text = fs.readFileSync(filePath, 'utf-8'); } catch(e) { return null; }
		var lines = text.split('\n');
		var events = {};
		var curEv = null;
		var curPg = -1;
		var displayName = '';

		for (var li = 0; li < lines.length; li++) {
			var line = lines[li];
			var dnM = line.match(/^display_name:\s*(.*)$/);
			if (dnM) { displayName = _readYAMLScalarText(lines, li, dnM[1]); }

			var evM = line.match(/^\s+(\d+):\s*!ruby\/object:RPG::Event\s*$/);
			if (evM) {
				curEv = parseInt(evM[1]);
				events[curEv] = { name: '', pages: [] };
				curPg = -1;
				continue;
			}
			if (curEv !== null) {
				var nmM = line.match(/^\s{4,}name:\s*(.*)$/);
				if (nmM && events[curEv]) { events[curEv].name = _readYAMLScalarText(lines, li, nmM[1]); continue; }
			}
			if (curEv !== null && /RPG::Event::Page\s*$/.test(line)) {
				curPg++;
				if (events[curEv]) events[curEv].pages.push({ list: [] });
				continue;
			}
			if (curEv !== null && curPg >= 0) {
				var cmd = _parseVXAceEventCommand(line);
				if (cmd && events[curEv] && events[curEv].pages[curPg]) {
					events[curEv].pages[curPg].list.push(cmd);
				}
			}
		}
		return { events: events, displayName: displayName };
	}

	function _readVXAceCommonEventsYAML(filePath) {
		var text;
		try { text = fs.readFileSync(filePath, 'utf-8'); } catch(e) { return null; }
		var lines = text.split('\n');
		var result = [];
		var curCE = null;
		var inList = false;

		for (var li = 0; li < lines.length; li++) {
			var line = lines[li];
			var ceM = line.match(/^-\s*!ruby\/object:RPG::CommonEvent\s*$/);
			if (ceM) {
				curCE = { id: 0, name: '', list: [] };
				result.push(curCE);
				inList = false;
				continue;
			}
			if (curCE) {
				var idM = line.match(/^\s+id:\s*(\d+)/);
				if (idM) { curCE.id = parseInt(idM[1]); continue; }
				var nmM = line.match(/^\s+name:\s*(.*)$/);
				if (nmM) { curCE.name = _readYAMLScalarText(lines, li, nmM[1]); continue; }
				if (/^\s+list:\s*$/.test(line)) { inList = true; continue; }
				if (inList) {
					if (/RPG::EventCommand/.test(line)) {
						var cmd = _parseVXAceEventCommand(line);
						if (cmd) curCE.list.push(cmd);
					} else if (/^\s{2,}\w+:/.test(line) && !/RPG::/.test(line)) {
						inList = false;
					}
				}
			}
		}
		return result;
	}

	function _readVXAceMapInfosYAML(filePath) {
		var text;
		try { text = fs.readFileSync(filePath, 'utf-8'); } catch(e) { return null; }
		var result = {};
		var lines = text.split('\n');
		var curId = null;
		for (var li = 0; li < lines.length; li++) {
			var line = lines[li];
			var idM = line.match(/^(\d+):\s*!ruby\/object:RPG::MapInfo/);
			if (idM) { curId = parseInt(idM[1]); continue; }
			if (curId !== null) {
				var nmM = line.match(/^\s+name:\s*(.*)$/);
				if (nmM) { result[curId] = _readYAMLScalarText(lines, li, nmM[1]); curId = null; }
			}
		}
		return result;
	}

	function _extractVXAceSpeaker(text) {
		if (!text || typeof text !== 'string') return '';
		var nameCmd = text.match(/^\\n\[(\d+)\]/i);
		if (nameCmd) return '\\N[' + nameCmd[1] + ']';
		var m = text.match(/^([^\n「」『』\\]+)\n[「『]/);
		if (m && m[1].trim().length > 0 && m[1].trim().length <= 20) return m[1].trim();
		return '';
	}

	function _buildVXAceMapScenes(yamlPath, isXP) {
		try {
			var entries = fs.readdirSync(yamlPath);
		} catch (e) { return; }

		for (var e = 0; e < entries.length; e++) {
			var fname = entries[e];
			if (!/^Map\d{3}\.yaml$/.test(fname)) continue;
			if (fname === "MapInfos.yaml") continue;

			var mapData = _readVXAceMapYAML(nwPath.join(yamlPath, fname));
			if (!mapData || !mapData.events) continue;

			var fileBase = fname.replace(/\.yaml$/, "");
			// VX Ace maps carry display_name; XP/VX maps don't — fall back to MapInfos
			var mapName = mapData.displayName || _mapNames[fileBase] || "";

			var evIds = Object.keys(mapData.events).map(function(k){return parseInt(k);}).sort(function(a,b){return a-b;});
			for (var ei = 0; ei < evIds.length; ei++) {
				var evId = evIds[ei];
				var ev = mapData.events[evId];
				if (!ev || !ev.pages) continue;
				for (var pgIdx = 0; pgIdx < ev.pages.length; pgIdx++) {
					var page = ev.pages[pgIdx];
					if (!page.list || page.list.length < 2) continue;

					var hasContent = false;
					for (var ci = 0; ci < page.list.length; ci++) {
						var c = page.list[ci];
						if (c && (c.code === CODE.SHOW_TEXT_BODY || c.code === CODE.SCROLL_TEXT_BODY || c.code === CODE.SHOW_CHOICES || c.code === CODE.CALL_CE)) {
							hasContent = true; break;
						}
					}
					if (!hasContent) continue;

					var sceneId = _makeSceneId(fileBase, evId, pgIdx);
					var scene = _createSceneObject("map", fileBase, "YAML/" + fname, evId, pgIdx, ev.name || "", mapName);
					_analyzeSceneVXAce(page.list, scene, isXP);
					_registerScene(scene, yamlPath);
				}
			}
		}
	}

	function _buildVXAceCommonEventScenes(yamlPath, isXP) {
		var ceData = _readVXAceCommonEventsYAML(nwPath.join(yamlPath, "CommonEvents.yaml"));
		if (!ceData) return;

		var fileBase = "CommonEvents";
		for (var cei = 0; cei < ceData.length; cei++) {
			var ce = ceData[cei];
			if (!ce || !ce.list || ce.list.length < 2) continue;

			var hasContent = false;
			for (var ci = 0; ci < ce.list.length; ci++) {
				var c = ce.list[ci];
				if (c && (c.code === CODE.SHOW_TEXT_BODY || c.code === CODE.SCROLL_TEXT_BODY || c.code === CODE.SHOW_CHOICES || c.code === CODE.CALL_CE)) {
					hasContent = true; break;
				}
			}
			if (!hasContent) continue;

			var sceneId = _makeSceneId(fileBase, ce.id);
			var scene = _createSceneObject("commonevent", fileBase, "YAML/CommonEvents.yaml", ce.id, undefined, ce.name || "", "");
			_analyzeSceneVXAce(ce.list, scene, isXP);
			_registerScene(scene, yamlPath);
		}
	}

	function _createSceneObject(type, fileBase, fileKey, eventIndex, pageIndex, eventName, mapName) {
		return {
			id: _makeSceneId(fileBase, eventIndex, pageIndex),
			type: type,
			file: fileBase,
			fileKey: fileKey,
			eventIndex: eventIndex,
			pageIndex: pageIndex,
			eventName: eventName,
			mapName: mapName,
			label: "",
			speakersByListIndex: {},
			orderByListIndex: {},
			kindsByListIndex: {},
			ceCalls: [],
			transfers: [],
			hasBranches: false,
			totalOrders: 0,
			rowCount: 0,
			callers: [],
		};
	}

	function _registerScene(scene, dataPath) {
		scene.label = _buildSceneLabel(scene);
		_scenes[scene.id] = scene;
		_sceneOrder.push(scene.id);
		for (var cc = 0; cc < scene.ceCalls.length; cc++) {
			var ceTarget = scene.ceCalls[cc].target;
			if (!_ceLinks[scene.id]) _ceLinks[scene.id] = [];
			_ceLinks[scene.id].push(scene.ceCalls[cc]);
			var ceKey = "CommonEvents#" + ceTarget;
			if (!_ceCallers[ceKey]) _ceCallers[ceKey] = [];
			_ceCallers[ceKey].push({
				sceneId: scene.id,
				file: scene.file,
				eventIndex: scene.eventIndex,
				pageIndex: scene.pageIndex,
			});
		}
	}

	function _analyzeSceneVXAce(cmdList, sceneData, isXP) {
		var currentHeaderIndex = -1;
		var order = 0;

		for (var i = 0; i < cmdList.length; i++) {
			var cmd = cmdList[i];
			if (!cmd) continue;
			var code = cmd.code;
			var params = cmd.parameters || [];
			var indent = cmd.indent || 0;

			if (code === CODE.SHOW_TEXT) {
				currentHeaderIndex = i;
				// XP quirk: the 101 header itself carries the first text line
				// (VX/VX Ace 101s only carry window attributes)
				if (isXP && typeof params[0] === "string" && params[0].length > 0) {
					sceneData.speakersByListIndex[i] = _extractVXAceSpeaker(params[0]);
					sceneData.orderByListIndex[i] = order;
					sceneData.kindsByListIndex[i] = "dialogue";
					order++;
				}
			}
			else if (code === CODE.SHOW_TEXT_BODY) {
				var speaker = _extractVXAceSpeaker(params[0]);
				sceneData.speakersByListIndex[i] = speaker;
				if (currentHeaderIndex >= 0) {
					if (!sceneData.speakersByListIndex[currentHeaderIndex]) {
						sceneData.speakersByListIndex[currentHeaderIndex] = speaker;
					}
					sceneData.orderByListIndex[currentHeaderIndex] = order;
				}
				sceneData.orderByListIndex[i] = order;
				sceneData.kindsByListIndex[i] = "dialogue";
				order++;
			}
			else if (code === CODE.SCROLL_TEXT) {
				currentHeaderIndex = i;
			}
			else if (code === CODE.SCROLL_TEXT_BODY) {
				sceneData.speakersByListIndex[i] = "";
				sceneData.orderByListIndex[i] = order;
				sceneData.kindsByListIndex[i] = "scrolling";
				order++;
			}
			else if (code === CODE.SHOW_CHOICES) {
				var choices = params[0] || [];
				if (!Array.isArray(choices)) choices = [];
				for (var c = 0; c < choices.length; c++) {
					var cKey = "c" + i + "_" + c;
					sceneData.speakersByListIndex[cKey] = "";
					sceneData.orderByListIndex[cKey] = order;
					sceneData.kindsByListIndex[cKey] = "choice";
					order++;
				}
			}
			else if (code === CODE.CALL_CE) {
				var ceId = params[0];
				if (ceId !== undefined && ceId > 0) {
					sceneData.ceCalls.push({
						target: ceId,
						atListIndex: i,
						atOrder: order,
						indent: indent,
					});
				}
			}
			else if (code === CODE.TRANSFER) {
				var mapId = params[1];
				if (mapId !== undefined && mapId > 0) {
					sceneData.transfers.push({
						target: "Map" + String(mapId).padStart(3, "0"),
						atListIndex: i,
						atOrder: order,
					});
				}
			}
			else if (code === CODE.CONDITIONAL) {
				sceneData.hasBranches = true;
			}
		}
		sceneData.totalOrders = order;
	}

	function _loadVXAceMapNames(yamlPath) {
		var mi = _readVXAceMapInfosYAML(nwPath.join(yamlPath, "MapInfos.yaml"));
		if (!mi) return;
		for (var id in mi) {
			var mapId = "Map" + String(parseInt(id)).padStart(3, "0");
			_mapNames[mapId] = mi[id] || "";
		}
	}

	function _mapRowsToScenes() {
		if (!trans.project || !trans.project.files) return;

		var totalMapped = 0;
		var totalUnmapped = 0;

		for (var fileKey in trans.project.files) {
			var fileObj = trans.project.files[fileKey];
			if (!fileObj.data || !fileObj.context) continue;

			var fileBase = nwPath.basename(fileKey).replace(/\.(json|yaml|rvdata2)$/, "");

			for (var rowIdx = 0; rowIdx < fileObj.data.length; rowIdx++) {
				var contexts = fileObj.context[rowIdx];
				if (!contexts || !Array.isArray(contexts) || contexts.length === 0) {
					totalUnmapped++;
					continue;
				}

				var ctxStr = contexts[0];
				var parsed = _parseContext(ctxStr);
				if (!parsed) {
					totalUnmapped++;
					continue;
				}

				var sceneId = null;
				var orderInScene = -1;
				var kind = parsed.kind;
				var speaker = "";

				if (parsed.kind === "message" || parsed.kind === "scrollingMessage" || parsed.kind === "speaker" || parsed.kind === "Show Choices") {
					var lookupId = null;
					if (parsed.pageIndex !== undefined) {
						lookupId = _makeSceneId(parsed.fileBase, parsed.eventIndex, parsed.pageIndex);
					} else {
						lookupId = _makeSceneId(parsed.fileBase, parsed.eventIndex);
					}

					var scene = _scenes[lookupId];
					if (scene) {
						sceneId = lookupId;
						var lookupKey = String(parsed.listIndex);
						if (parsed.kind === "Show Choices" && parsed.listIndex >= 0) {
							var choiceSubIdx = ctxStr.match(/\/(\d+)from\d+$/);
							if (choiceSubIdx) {
								lookupKey = "c" + parsed.listIndex + "_" + (parseInt(choiceSubIdx[1]) - 1);
							}
						}
						orderInScene = scene.orderByListIndex[lookupKey];
						if (orderInScene === undefined) orderInScene = parsed.listIndex;
						speaker = scene.speakersByListIndex[lookupKey] || scene.speakersByListIndex[String(parsed.listIndex)] || "";
						scene.rowCount++;
					}
				}

				_rowMap[fileKey + "|" + rowIdx] = {
					sceneId: sceneId,
					orderInScene: orderInScene,
					kind: kind,
					speaker: speaker,
					fileKey: fileKey,
					rowIndex: rowIdx,
				};

				if (sceneId) totalMapped++;
				else totalUnmapped++;
			}
		}

		_stats.totalMapped = totalMapped;
		_stats.totalUnmapped = totalUnmapped;
	}

	function build() {
		_reset();

		if (!_isRMGame()) {
			console.log("[SceneGraph] Not an RPG Maker game, skipping.");
			return false;
		}

		var gameDataPath = _getGameDataPath();
		if (!gameDataPath || !fs.existsSync(gameDataPath)) {
			console.log("[SceneGraph] Game data path not found. Tried loc and staging paths.");
			return false;
		}

		var isRGSS = _isRGSSEngine();
		var isMZ = trans.project.gameEngine === "rmmz";
		var isXP = trans.project.gameEngine === "rmxp";

		console.log("[SceneGraph] Building scene graph from:", gameDataPath, isRGSS ? "(RGSS: XP/VX/VX Ace)" : "(MV/MZ)");

		if (isRGSS) {
			_loadVXAceMapNames(gameDataPath);
			_buildVXAceMapScenes(gameDataPath, isXP);
			_buildVXAceCommonEventScenes(gameDataPath, isXP);
		} else {
			_loadMapNames(gameDataPath);
			_buildMapScenes(gameDataPath, isMZ);
			_buildCommonEventScenes(gameDataPath, isMZ);
		}
		_mapRowsToScenes();

		_built = true;
		_stats.totalScenes = _sceneOrder.length;
		_stats.scenesWithCECalls = 0;
		_stats.scenesWithCallers = 0;
		for (var i = 0; i < _sceneOrder.length; i++) {
			var sid = _sceneOrder[i];
			if (_scenes[sid].ceCalls.length > 0) _stats.scenesWithCECalls++;
			if (_scenes[sid].type === "commonevent" && _scenes[sid].callers.length > 0) _stats.scenesWithCallers++;
		}

		console.log("[SceneGraph] Built: " + _stats.totalScenes + " scenes, " +
			_stats.totalMapped + " rows mapped, " +
			_stats.scenesWithCECalls + " scenes with Common Event calls.");
		return true;
	}

	function isAvailable() {
		return _built;
	}

	function reset() {
		_reset();
	}

	function getRowSceneInfo(file, rowIndex) {
		return _rowMap[file + "|" + rowIndex] || null;
	}

	function getOrderedRows(selectedFiles) {
		if (!_built) return null;

		var fileSet = {};
		for (var i = 0; i < selectedFiles.length; i++) {
			fileSet[selectedFiles[i]] = true;
		}

		var result = [];
		var seenRows = {};

		for (var si = 0; si < _sceneOrder.length; si++) {
			var sceneId = _sceneOrder[si];
			var scene = _scenes[sceneId];
			if (!scene) continue;

			var sceneRows = [];
			for (var key in _rowMap) {
				var info = _rowMap[key];
				if (!info || info.sceneId !== sceneId) continue;
				if (!fileSet[info.fileKey]) continue;

				var parts = key.split("|");
				var fileKey = info.fileKey;
				var rowIndex = info.rowIndex;
				if (seenRows[fileKey + "|" + rowIndex]) continue;
				seenRows[fileKey + "|" + rowIndex] = true;
				sceneRows.push({
					file: fileKey,
					rowIndex: rowIndex,
					sceneId: sceneId,
					orderInScene: info.orderInScene,
					kind: info.kind,
					speaker: info.speaker,
				});
			}

			sceneRows.sort(function(a, b) {
				return (a.orderInScene || 0) - (b.orderInScene || 0);
			});

			result = result.concat(sceneRows);
		}

		var noScene = [];
		for (var fk in trans.project.files) {
			if (!fileSet[fk]) continue;
			var fileObj = trans.project.files[fk];
			if (!fileObj.data) continue;
			for (var ri = 0; ri < fileObj.data.length; ri++) {
				var mapKey = fk + "|" + ri;
				if (seenRows[mapKey]) continue;
				if (!_rowMap[mapKey] || !_rowMap[mapKey].sceneId) {
					noScene.push({ file: fk, rowIndex: ri, sceneId: null, orderInScene: -1 });
				}
			}
		}
		result = result.concat(noScene);

		return result;
	}

	function getScene(sceneId) {
		return _scenes[sceneId] || null;
	}

	function getAllScenes() {
		var result = [];
		for (var i = 0; i < _sceneOrder.length; i++) {
			result.push(_scenes[_sceneOrder[i]]);
		}
		return result;
	}

	function getSceneLabel(sceneId) {
		var scene = _scenes[sceneId];
		return scene ? scene.label : "";
	}

	function getSceneDialogue(sceneId) {
		var scene = _scenes[sceneId];
		if (!scene) return [];

		var result = [];
		for (var key in _rowMap) {
			var info = _rowMap[key];
			if (!info || info.sceneId !== sceneId) continue;

			var fileObj = trans.project.files[info.fileKey];
			if (!fileObj || !fileObj.data) continue;
			var rowData = fileObj.data[info.rowIndex];
			if (!rowData || !rowData[0]) continue;

			result.push({
				file: info.fileKey,
				rowIndex: info.rowIndex,
				text: rowData[0],
				speaker: info.speaker || "",
				kind: info.kind,
				order: info.orderInScene,
			});
		}

		result.sort(function(a, b) {
			return (a.order || 0) - (b.order || 0);
		});

		return result;
	}

	function getLinkedSceneIds(sceneId) {
		var scene = _scenes[sceneId];
		if (!scene || !scene.ceCalls.length) return [];

		var result = [];
		for (var i = 0; i < scene.ceCalls.length; i++) {
			var ceId = "CommonEvents#" + scene.ceCalls[i].target;
			if (_scenes[ceId]) {
				result.push({
					sceneId: ceId,
					scene: _scenes[ceId],
					atOrder: scene.ceCalls[i].atOrder,
					indent: scene.ceCalls[i].indent,
				});
			}
		}
		return result;
	}

	function getCallerScenes(sceneId) {
		var scene = _scenes[sceneId];
		if (!scene || scene.type !== "commonevent") return [];

		var callers = _ceCallers[sceneId] || [];
		var result = [];
		for (var i = 0; i < callers.length; i++) {
			var callerScene = _scenes[callers[i].sceneId];
			if (callerScene) {
				result.push({
					sceneId: callers[i].sceneId,
					scene: callerScene,
				});
			}
		}
		return result;
	}

	function getSceneAIContext(sceneId, textProcessor) {
		var scene = _scenes[sceneId];
		if (!scene) return "";

		var lines = [];
		var dialogue = getSceneDialogue(sceneId);

		if (scene.type === "map") {
			var locParts = [];
			if (scene.mapName) locParts.push(scene.mapName);
			locParts.push(scene.file);
			if (scene.eventName) locParts.push("Event: " + scene.eventName);
			lines.push("[Scene: " + locParts.join(" / ") + "]");
		} else {
			lines.push("[Common Event #" + scene.eventIndex + (scene.eventName ? " \"" + scene.eventName + "\"" : "") + "]");
		}

		if (scene.callers && scene.callers.length > 0) {
			var callerLabels = [];
			for (var i = 0; i < scene.callers.length; i++) {
				var cs = _scenes[scene.callers[i].sceneId];
				if (cs) callerLabels.push(cs.label);
			}
			if (callerLabels.length > 0) {
				lines.push("[Called from: " + callerLabels.join("; ") + "]");
			}
		}

		var linked = getLinkedSceneIds(sceneId);
		if (linked.length > 0) {
			var linkLabels = [];
			for (var j = 0; j < linked.length; j++) {
				linkLabels.push(linked[j].scene.label);
			}
			lines.push("[Continues to: " + linkLabels.join("; ") + "]");
		}

		if (scene.hasBranches) {
			lines.push("[Note: This scene contains conditional branches — not all lines may appear in a single playthrough.]");
		}

		var prevSpeaker = "";
		var renderLine = function(d) {
			var prefix = "";
			if (d.kind === "choice") {
				prefix = "[choice] ";
			} else if (d.speaker && d.speaker !== prevSpeaker) {
				prefix = "[" + d.speaker + "] ";
				prevSpeaker = d.speaker;
			}
			var displayText = d.text;
			if (typeof textProcessor === 'function') {
				displayText = textProcessor(d.text);
			} else {
				displayText = _cleanControlCodes(d.text);
			}
			displayText = _stripDialogueBrackets(displayText);
			if (displayText.length > 120) displayText = displayText.substring(0, 117) + "...";
			return prefix + displayText;
		};

		for (var k = 0; k < dialogue.length; k++) {
			if (dialogue[k].kind === "speaker") continue;
			lines.push(renderLine(dialogue[k]));
		}

		return lines.join("\n");
	}

	function getStats() {
		return _stats;
	}

	return {
		build: build,
		isAvailable: isAvailable,
		reset: reset,
		getRowSceneInfo: getRowSceneInfo,
		getOrderedRows: getOrderedRows,
		getScene: getScene,
		getAllScenes: getAllScenes,
		getSceneLabel: getSceneLabel,
		getSceneDialogue: getSceneDialogue,
		getLinkedSceneIds: getLinkedSceneIds,
		getCallerScenes: getCallerScenes,
		getSceneAIContext: getSceneAIContext,
		getStats: getStats,
		CODE: CODE,
	};

})();
