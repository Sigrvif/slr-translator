var thisAddon 	= this;
var appName 	= this.package.name;
var spawn 		= spawn || require('child_process').spawn;
var ws 			= ws || require('www/js/lib/shortcuts.js');
var ini 		= ini || require('ini')
var stripBom	= require('strip-bom');
var bCopy 		= require('www/js/lib/bigCopy.js');
var fse 		= fse || require('fs-extra');
var afs 		= afs || require('await-fs');
var pSpawn 		= require('promisify-child-process').spawn;
var ini 		= require("ini");
var pLimit 		= require('p-limit');


var {
    Worker,
    isMainThread,
    parentPort,
    workerData
} = require("worker_threads");

const decrypterPath = nwPath.join(common.getRootDir(), "3rdParty/RgssDecrypter/");
const thisPath  = thisAddon.getPathRelativeToRoot();
thisAddon.debugLevel = 0;

this.optionsForm = {
/* 		"booleanValue": {
			"type": "boolean",
			"title": t("Use legacy parser"),
			"description": t("Use the old parser. The old parser doesn't support some newly added features."),
			"HOOK": "thisAddon.config.useLegacyParser",
			"inlinetitle": t("Use old parser"),
			"fieldHtmlClass":"flipSwitch"
		}, */
		"eventThreadsConcurrency": {
			"type": "range",
			"maximum" : 16,
			"minimum" : 0,
			"indicator":true,
			"title": "Event's thread concurrency",
			"description": "<b>Warning! Experimental feature!</b><br />This option determines the maximum number of worker threads that can concurrently parse event data on the Map and CommonEvents. <b>Set to 0 to disable worker thread</b>. <br />This option has the potential to accelerate the parsing process in larger games. However, it is important to note that in smaller games, enabling this option may actually slow down the parsing process due to the higher execution overhead compared to the parsing time for each data.",
			"HOOK": "thisAddon.config.eventThreadsConcurrency",
			"onInput": function() {
				console.log("onInput");
			}
		},
		"numberOfCommandInEventToThread": {
			"type": "number",
			"minimum" : 0,
			"indicator":true,
			"title": "The minimum number of command in an event that allowed in thread worker",
			"description": ("<b>Warning! Experimental feature!</b><br />Thread workers incur overhead during execution, which means that processing blank events or events with a low number of commands can actually hinder the overall process. This option enables you to specify the minimum number of commands an event must have in order to be parsed in a worker thread. <br />It is important to note that even blank events contain one command, and it is more efficient to process such events in the main thread rather than in a worker thread. Therefore, it is recommended to set this number to a value <b>greater than 1</b>.<br />Set to 0 to disable splitting task based on commands."+
			"Note that a blank event actually contains one command, and you definitely want to process blank events in the main thread instead of a worker thread. You should set this number to a value greater than 1."),
			"HOOK": "thisAddon.config.numberOfCommandInEventToThread",
			"onInput": function() {
				console.log("onInput");
			}
		},
}

thisAddon.applyDefaults({
	eventThreadsConcurrency: 0,
	numberOfCommandInEventToThread: 2
});

var limit		= pLimit(parseInt(thisAddon.config.eventThreadsConcurrency)||1);

var {
    YAML,
    GameIniParser,
    RGSSParser,
    RMData,
    attachments,
	customTags
} = require("www/core/rmrgss/rmrgss.module.js");

var RMRAWVIEW = require("www/core/rmrgss/rmrgss.rawview.js");

thisAddon.GameIniParser = GameIniParser;
thisAddon.RGSSParser 	= RGSSParser;
thisAddon.RMData 		= RMData;



/**
 * @param  {} gameFile
 * @param  {} options
 * @class
 */
var RMUtil = function(gameFile, options) {
	if (common.isDir(gameFile)) {
		this.dirname = gameFile;
	} else {
		this.dirname = nwPath.dirname(gameFile);
	}
	this.options 	= options || {};
	this.engineCode = this.options.engineCode || "";
	this.writeMode 	= false;
	this.targetDir  = undefined;


	thisAddon.config.numberOfCommandInEventToThread = parseInt(thisAddon.config.numberOfCommandInEventToThread)
	thisAddon.config.eventThreadsConcurrency = parseInt(thisAddon.config.eventThreadsConcurrency);
}

RMUtil.translateEngineType = function(parserType) {
	if (parserType == "ace") return "rmvxace";
	if (parserType == "xp") return "rmxp";
	if (parserType == "vx") return "rmvx";
}

RMUtil.attachments = attachments;

/*
RMUtil.type = {};

if (isYamlVer2) {
	RMUtil.type.binary = {
		identify: value => value instanceof Uint8Array,
		// Buffer inherits from Uint8Array
		default: false,
		tag: '!binary',
	  
		resolve: (doc, node) => {
		  //const src = YAMLUtil.resolveString(doc, node);
		  return b64DecodeUnicode(doc);
		},
		options: YAMLUtil.binaryOptions,
		stringify: function (data, ctx, onComment, onChompKeep) {
		  // convert to plain
		  //console.log(arguments);
		  data.value = b64EncodeUnicode(data.value);
		  //type = "PLAIN"
		  return YAMLUtil.stringifyString(data, ctx, onComment, onChompKeep);
		}
	}
} else {
	// use legacy
	RMUtil.type.binary = {
		identify: value => value instanceof Uint8Array,
		// Buffer inherits from Uint8Array
		default: false,
		tag: '!binary',
	  
		resolve: (doc, node) => {
			const src = YAMLUtil.resolveString(doc, node);
			const result = b64DecodeUnicode(src);
			console.log("----Resolving binary", src, "result:", result);
	
			return result;
		},
		options: YAMLUtil.binaryOptions,
		stringify: function (data, ctx, onComment, onChompKeep) {
			// convert to plain
			//console.log(arguments);
			data.value = b64EncodeUnicode(data.value);
			//type = "PLAIN"
			return YAMLUtil.stringifyString(data, ctx, onComment, onChompKeep);
		}
	}
}
*/
RMUtil.customTags =  customTags;

RMUtil.prototype.unpackTo = async function(targetDir) {
	targetDir = targetDir || this.targetDir || this.options.targetDir || this.dirname;
	console.log("Unpacking RM data", this.dirname, "to", targetDir);
	var thisEngineType = await this.getEngineCode();
	await common.mkDir(targetDir);
	await RMUtil.runRvpacker("unpack", this.dirname, targetDir, thisEngineType);
	
	await ui.log(`Copy: ${nwPath.join(this.dirname, "Game.ini")} to ${targetDir}`);
	await common.copyFile(nwPath.join(this.dirname, "Game.ini"), targetDir);

	this.targetDir = targetDir;
	this.unpacked = true;
	return this;
}

RMUtil.prototype.repackTo = async function(targetDir, yamlFolder) {
	targetDir = targetDir || this.targetDir || this.options.targetDir || this.dirname;
	console.log("Repack project", this.dirname, "to", targetDir);
	if (await common.isDirectory(targetDir) == false) return console.warn(`ERROR: Directory ${targetDir} is not found!`);
	
	await common.mkDir(yamlFolder);
	var thisEngineType = await this.getEngineCode();
	await RMUtil.runRvpacker("pack", targetDir, yamlFolder, thisEngineType);

	//await ui.log(`Copy: ${nwPath.join(this.dirname, "Game.ini")} to ${targetDir}`);
	//await common.copyFile(nwPath.join(this.dirname, "Game.ini"), targetDir);

	console.log("Repack finished!");
	return this;
}

/**
 * Spawn the rvpacker.rb wrapper.
 * On Windows, non-ASCII characters in process arguments are transcoded using
 * the system ANSI code page (the active locale), so a Japanese project folder
 * on a non-Japanese locale becomes e.g. "????????" and rvpacker fails with
 * "<path> not found". To avoid this, the project and target paths are written
 * to a UTF-8 JSON manifest referenced by an ASCII-only path, which rvpacker.rb
 * reads back via --paths-file. This works on every locale.
 * @param {String} action - "unpack" or "pack"
 * @param {String} projectDir - value for -d/--project (project directory)
 * @param {String} targetDir - value for -T/--target (output directory)
 * @param {String} engineType - "ace" | "vx" | "xp"
 */
RMUtil.runRvpacker = async function(action, projectDir, targetDir, engineType) {
	var binPath = nwPath.join(thisPath, "bin/rvpacker/rvpacker.rb");
	var rubyExe = nwPath.join(common.getRootDir(), nw.App.manifest.localConfig.ruby);
	var exitCode = 0;
	var spawnOptions = {
		onData: function(buffer) {
			var _l = buffer.toString().split("\n");
			for (var _i = 0; _i < _l.length; _i++) {
				if (_l[_i] && !/\.rb:\d+:in /.test(_l[_i]) && !/Error converting.*\.rvdata2/.test(_l[_i])) ui.log(_l[_i]);
			}
		},
		onError: function(buffer) {
			var _l = buffer.toString().split("\n");
			for (var _i = 0; _i < _l.length; _i++) {
				if (_l[_i].trim()) ui.log(_l[_i].replace(/[\r\n]+$/, ""));
			}
		},
		onDone: function(result, code) {
			exitCode = code;
		}
	};

	var manifestBase = common.getStagePath();
	await common.mkDir(manifestBase);
	var manifestPath = nwPath.join(manifestBase, ".slr_rvp_paths_" + common.makeid(8) + ".json");
	await common.filePutContents(manifestPath, JSON.stringify({ project: projectDir, target: targetDir }), "utf8", false);
	try {
		await common.aSpawn(rubyExe, [binPath, "-a", action, "-t", engineType, "-V", "-f", "--paths-file", manifestPath], spawnOptions);
		// A non-zero Ruby exit would otherwise surface later as a misleading
		// "ENOENT ... data\YAML" scandir error when the YAML folder is missing.
		if (exitCode !== 0) throw new Error(`RVpacker "${action}" failed with exit code ${exitCode}. See the log for Ruby error messages.`);
	} finally {
		await common.unlink(manifestPath);
	}
}

// ============================================================================
// Main script injection (VX / VX Ace)
// A virtual "Scripts/!Main Injection" file object is added during toTrans.
// Whatever the user types into it is prepended to the very start of the Main
// script whenever Scripts is exported (see thisAddon.exportToFolder below).
// ============================================================================
var MAIN_INJECTION_KEY = "Scripts/!Main Injection";
var MAIN_INJECTION_PLACEHOLDER = "# Type the Ruby code to insert at the start of Main in the cells to the right. It is applied whenever Scripts is exported. Example: Font.default_size = 16";

RMUtil.prototype.findMainScriptFile = function(yamlFolder) {
	var mainParser = null;
	for (var p in this.parsed.scripts) {
		var fi = (this.parsed.scripts[p] && this.parsed.scripts[p].fileInfo) || {};
		if ((fi.filename || "").toLowerCase() == "main") { mainParser = this.parsed.scripts[p]; break; }
	}
	if (!mainParser) {
		for (var p2 in this.parsed.scripts) {
			var fi2 = (this.parsed.scripts[p2] && this.parsed.scripts[p2].fileInfo) || {};
			if ((fi2.filename || "").toLowerCase().indexOf("main") >= 0) { mainParser = this.parsed.scripts[p2]; break; }
		}
	}
	if (!mainParser || !mainParser.fileInfo || !mainParser.fileInfo.relPath) return null;
	return nwPath.join(yamlFolder, mainParser.fileInfo.relPath);
}

RMUtil.prototype.getMainInjectionCode = function(transData) {
	var files = (transData && transData.project && transData.project.files) || (transData && transData.files) || {};
	var inj = files[MAIN_INJECTION_KEY];
	if (!inj) return "";
	var row = (inj.data && inj.data[0]) || [];
	// SLR rule: the rightmost non-empty translation cell wins. Col 0 is the
	// locked original/label (excluded); cols 4 (Errors) and 5 (Overwrite) are
	// metadata that the batch pipeline may set, so they are excluded too.
	// We scan the translation-content columns 1..3 right-to-left.
	var code = "";
	if (Array.isArray(row)) {
		for (var n = Math.min(row.length - 1, 3); n >= 1; n--) {
			if (row[n]) { code = String(row[n]); break; }
		}
	}
	return (code || "").trim();
}

RMUtil.prototype.applyMainInjection = async function(transData, yamlFolder) {
	try {
		var code = this.getMainInjectionCode(transData);
		if (!code) return "";

		var mainFile = this.findMainScriptFile(yamlFolder);
		if (!mainFile || await common.isFileAsync(mainFile) == false) {
			await ui.log("Main injection: the Main script was not found, skipping injection.");
			return "";
		}
		var content = await common.fileGetContents(mainFile, "utf8");
		var injBlock = code + (/\n$/.test(code) ? "" : "\n");
		await common.filePutContents(mainFile, injBlock + content, "utf8", false);
		await ui.log("Main injection applied: code inserted at the start of " + nwPath.basename(mainFile));
		return code;
	} catch (e) {
		console.warn("applyMainInjection error:", e);
		await ui.log("Main injection failed: " + e.toString());
	}
	return "";
}

// ============================================================================
// Font shipping for the Main injection (VX / VX Ace)
// RGSS games load custom fonts from a "Fonts" folder next to the game
// executable. When the injected code sets Font.default_name to a font FILE
// (e.g. Font.default_name = "MyFont.ttf"), the matching file from SLR
// Translator's font collection folder is copied into the export's Fonts
// folder (see thisAddon.exportToFolder).
// ============================================================================

var FONT_FILE_PATTERN = /\.(ttf|otf|fon|ttc|woff2?)$/i;

/**
 * Extract every font file name assigned to Font.default_name inside the
 * injected Ruby code. Handles the string form as well as the array form
 * used by the VX Ace default scripts (["VL Gothic", ...]). Values without
 * a font file extension are system font family names and are ignored.
 * @param {String} code - Injected Ruby code
 * @returns {String[]} Unique font file names (may be empty)
 */
var extractInjectionFontNames = function(code) {
	var names = [];
	if (!code) return names;
	var assignPattern = /Font\s*\.\s*default_name\s*=([^\r\n]*)/g;
	var assignMatch;
	while ((assignMatch = assignPattern.exec(code)) !== null) {
		var valuePart = assignMatch[1];
		var stringPattern = /(["'])([^"'\r\n]*)\1/g;
		var stringMatch;
		while ((stringMatch = stringPattern.exec(valuePart)) !== null) {
			var fontName = stringMatch[2].trim();
			if (!fontName) continue;
			if (!FONT_FILE_PATTERN.test(fontName)) continue; // family name, not a file
			if (fontName.replaceAll("\\", "/").includes("/")) continue;
			if (!names.some((n) => n.toLowerCase() == fontName.toLowerCase())) names.push(fontName);
		}
	}
	return names;
}

/**
 * Copy the font files referenced by Font.default_name assignments of the
 * injected code into the Fonts folder of the exported game. Fonts are looked
 * up in SLR Translator's own font collection folder first, then in the Fonts
 * folder(s) of the original game.
 * @param {String} destinationDir - Root folder of the exported game
 * @param {String[]} fontNames - Font file names to ship
 */
thisAddon.exportMainInjectionFonts = async function(destinationDir, fontNames) {
	if (empty(fontNames)) return;

	var userFontDir = nwPath.join(nw.process.cwd(), "fonts");
	try {
		if (await common.isDirectory(userFontDir) == false) await common.mkDir(userFontDir);
	} catch (e) {
		console.warn("Unable to create the font collection folder", userFontDir, e);
	}

	// lookup folders: SLR's font collection, then the original game location
	var sourceDirs = [userFontDir];
	try {
		if (trans.project && trans.project.loc) {
			sourceDirs.push(nwPath.join(trans.project.loc, "Fonts"));
			sourceDirs.push(nwPath.join(trans.project.loc, "fonts"));
		}
	} catch (e) {}

	for (var i=0; i<fontNames.length; i++) {
		var fontFile = fontNames[i];
		var source = false;
		for (var d=0; d<sourceDirs.length; d++) {
			try {
				var entries = await fs.promises.readdir(sourceDirs[d]);
			} catch (e) { continue; }
			for (var e2=0; e2<entries.length; e2++) {
				if (entries[e2].toLowerCase() != fontFile.toLowerCase()) continue;
				var candidate = nwPath.join(sourceDirs[d], entries[e2]);
				if (await common.isFileAsync(candidate)) { source = candidate; break; }
			}
			if (source) break;
		}

		if (!source) {
			await ui.logError(`The Main injection sets Font.default_name to "${fontFile}" but this font was not found in SLR Translator's fonts folder (${userFontDir}) nor in the game's Fonts folder. Copy the font file there manually, otherwise the game will fall back to a default font.`);
			continue;
		}

		var targetFontsDir = nwPath.join(destinationDir, "Fonts");
		await common.mkDir(targetFontsDir);
		await common.copyFile(source, nwPath.join(targetFontsDir, fontFile));
		await ui.log(`Font included into the export: ${fontFile}`);
	}
}

/**
 * Set the RMUtil with the previously unpacked game using RMUtil.prototype.unpackTo
 * Root directory of the game or cache where folder "YAML" and "Scripts" are placed
 * @param  {String} targetDir
 */
RMUtil.prototype.setUnpackedDir = async function(targetDir) {
	targetDir = targetDir || this.targetDir || this.options.targetDir || this.dirname;
	ui.log("Set unpacked dir to :"+targetDir);

	this.targetDir = targetDir;
	this.unpacked = true;

	// check existance of extracted tes
	var dataExtension = await this.getDataExtension();
	var tesDir 	= nwPath.join(targetDir, "main."+dataExtension);
	this.hasTes	= false;
	if (await common.isDir(tesDir)) {
		this.hasTes 		= true;
		this.tesExtractPath = tesDir;
	}
	return this;	
}

RMUtil.prototype.addFiles = async function(files) {
	if (typeof files == "string") files = [files];

	this.contents = this.contents || {
		yaml:[],
		scripts:[],
		gameIni: ""
	};
	this.parsed = this.parsed ||{
		document:{},
		scripts:{}
	};

	for (var i=0; i<files.length; i++) {
		var extName = nwPath.extname(files[i]).toLowerCase();
		if (extName == ".yaml") {
			this.contents.yaml.push(files[i]);
		} else if (extName == ".rb") {
			this.contents.scripts.push(files[i]);
		} else if (extName == ".ini") {
			this.contents.gameIni = files[i];
		} else {
			console.warn("Unknown handler file with extension : ", extName);
		}

	}

	/*
	for (var i=0; i<this.contents.yaml.length; i++) {
		if (nwPath.extname(this.contents.yaml[i]) !== ".yaml") continue;
		this.parsed.document[this.contents.yaml[i]] = YAML.parseDocument(await common.fileGetContents(this.contents.yaml[i], "utf8"), {customTags: RMUtil.customTags});
	}
	*/
	return this;
}

RMUtil.prototype.toObj = async function(targetDir) {
	targetDir = targetDir || this.targetDir || this.options.targetDir || this.dirname;;
	if (!this.unpacked) await this.unpackTo(targetDir);

	this.contents = {
		yaml	:[],
		scripts	:[],
		gameIni	:nwPath.join(targetDir, "Game.ini")
	};
	this.parsed = {
		document:{},
		scripts	:{}
	};

	this.contents.yaml 		= await common.readDir(nwPath.join(targetDir, "YAML"));
	this.contents.scripts 	= await common.readDir(nwPath.join(targetDir, "Scripts"));
	
	this.targetDir 			= targetDir;
	return this;
}

function capitalizeFirstLetter(string) {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

RMUtil.prototype.parseScript = async function(options) {
	options = options || this.options || {};
	options.translationDatas = options.translationDatas || this.options.translationDatas || {};
	if (this.contents.scripts.length) {
		console.log("Parsing script");
		ui.log("Start parsing scripts");
	}

	for (var i=0; i<this.contents.scripts.length; i++) {
		var scriptPath = this.contents.scripts[i];
		if (nwPath.extname(scriptPath) !== ".rb") continue;

		var fileInfo = {};
		var relativePath 		= common.getRelativePathFromNode(scriptPath, "Scripts", true);
		fileInfo.extension 		= nwPath.extname(scriptPath).toLowerCase().substring(1);
		fileInfo.dataType 		= "ruby";
		fileInfo.filename 		= nwPath.basename(scriptPath, nwPath.extname(scriptPath));
		fileInfo.basename 		= nwPath.basename(scriptPath);
		fileInfo.path 			= relativePath;
		fileInfo.relPath		= relativePath;
		fileInfo.dirname 		= "/"+nwPath.dirname(relativePath);

		this.parsed.scripts[scriptPath] = new RGSSParser(await common.fileGetContents(scriptPath, "utf8"), options)
		var rgssParser = this.parsed.scripts[scriptPath];
		rgssParser.fileInfo		= fileInfo;
		rgssParser.assignTranslationPair(relativePath);

		//var relativePath 		= common.getRelativePath(scriptPath, this.dirname);
		//var relativePath 		= common.getRelativePathFromNode(scriptPath, "Scripts", true);
		await ui.log(`Parsing : ${relativePath}`);

		rgssParser.parse();
	}
	return this;
}

RMUtil.prototype.parseGameIni = async function(options) {
	if (!this.contents.gameIni) return this;
	console.log("Parsing Game.ini");
	ui.log("Parsing Game.ini");
	options = options || this.options || {};
	options.translationDatas = options.translationDatas || this.options.translationDatas || {};
	var scriptPath = this.contents.gameIni;

	var fileInfo = {};
	// todo determine relative path
	var relativePath 		= "Game.ini"
	fileInfo.extension 		= "ini";
	fileInfo.dataType 		= "ini";
	//fileInfo.filename 		= nwPath.basename(scriptPath, nwPath.extname(scriptPath));
	fileInfo.filename 		= "Game.ini";
	fileInfo.basename 		= nwPath.basename(scriptPath);
	fileInfo.path 			= relativePath;
	fileInfo.relPath		= relativePath;
	fileInfo.dirname 		= "/"

	this.parsed.gameIni = new GameIniParser(await common.fileGetContents(scriptPath), options)
	var iniParser 		= this.parsed.gameIni;
	iniParser.fileInfo		= fileInfo;

	await ui.log(`Parsing : ${scriptPath}`);

	iniParser.assignTranslationPair(relativePath);


	await iniParser.parse();
	console.log("Game.ini parser:", iniParser);
	this.gameTitle = iniParser.gameTitle;
	await ui.log("detected game title:"+this.gameTitle);
	return this;
}

RMUtil.prototype.parseThisPath = function(path) {
	if (empty(this.options.files)) return true;
	if (this.options.files.includes(path)) return true;
	path = path.replaceAll("\\", "/");
	if (this.options.files.includes(path)) return true;

	var mergedPath = "|"+this.options.files.join("|");
	if (path == "YAML/Scripts.yaml") {
		if (mergedPath.includes("|Scripts/")) return true;
	//} else if (path.includes("YAML/System.yaml")) {
	//	if (mergedPath.includes("|main.rvdata2/")) return true;
	} else if (path.includes("YAML/main.yaml")) {
		if (mergedPath.includes("|main.rvdata2/")) return true;
	}

	return false;
}

RMUtil.detectMode = function(file) {
	if (nwPath.basename(file).toLowerCase == "scripts.yaml") {
		return "script";
	} else if (nwPath.basename(file).toLowerCase == "main.yaml") {
		return "tes";
	} else if (nwPath.extname(file).toLowerCase == ".ini") {
		return "ini";
	} else if (nwPath.extname(file).toLowerCase == ".yaml") {
		return "data";
	}
}

RMUtil.fetchCommandListWorker = async function(rmData, commands, baseContext=[], options={}) {
	// if not using worker
	if (thisAddon.debugLevel > 1) console.log("fetchCommandListWorker", arguments);
	//return await rmData.fetchCommandList(commands, baseContext);
	if (!thisAddon.config.eventThreadsConcurrency) {
		if (thisAddon.debugLevel > 1) console.log("eventThreadsConcurrency is disabled sending event in one batch");
		return await rmData.fetchCommandList(commands, baseContext);
	}
	if (thisAddon.debugLevel > 1) console.log("using worker");
	if (commands?.items.length <= thisAddon.config.numberOfCommandInEventToThread) {
		var result = await rmData.fetchCommandList(commands, baseContext);
		if (thisAddon.debugLevel > 1) console.log("Expected result is", result);
	
		return result;
	}

	async function fetchFromWorker(parameter) {
		return new Promise((resolve, reject) => {
			var worker = new Worker("./www/core/rmrgss/rmrgss.thread.js", {workerData: parameter});
			worker.on("message", msg => {
				if (thisAddon.debugLevel > 1) console.log(`--Worker message received: `, msg);
				resolve(msg)
			});
			worker.on("error", err => {
				console.error(err)
				reject()
			});
			worker.on("exit", code => {
				if (thisAddon.debugLevel > 1) console.log(`--Worker exited with code :`, code);
				resolve()	
			});
		})
	}


	var docEventList = rmData.script.newDocumentIn(options.documentPath);
	if (thisAddon.debugLevel > 1) console.log("docEventList", docEventList);
	var param = {
		command: "parseEventList",
		baseContext: baseContext,
		rmDataProperties: {
			options: {
				options: rmData.options?.options,
				engineType:rmData.options?.engineType,
			},
			translationPair:rmData.translationPair,
			translationInfo:rmData.translationInfo
		},
		yamlList : docEventList.toString(),
	}
	if (thisAddon.debugLevel > 1) console.log("Generated parameter", param)

	var workerResult = await fetchFromWorker(param);
	if (thisAddon.debugLevel > 1) console.log("workerResult", workerResult)

	rmData.importTransData(workerResult?.result);
	
	if (thisAddon.debugLevel > 1) console.log("current rmData:", rmData);
	// if workerResult.translatedCommands is empty, then thread do not send back the new translation commands because there are no translations
	// this is to save execution time. Return back the original commands
	if (!workerResult?.result?.translatedCommands) return commands.items;

	var listDoc = YAML.parseDocument(workerResult?.result?.translatedCommands);
	rmData.script.anchors.map = {...rmData.script.anchors.map, ...listDoc.anchors.map}
	if (thisAddon.debugLevel > 1) console.log("Original yaml list:", commands);
	if (thisAddon.debugLevel > 1) console.log("Translated yaml list:", listDoc.contents.items);
	if (thisAddon.debugLevel > 1) console.log("translated yamlData", listDoc);

	return listDoc.contents.items;
}

RMUtil.prototype.parse = async function(files, mode, options) {
	if (thisAddon.debugLevel > 1) console.log("Parsing with arg", arguments);
	mode 	= mode || "all"; // all, data, ini, script, tes
	options = options || this.options || {};
	options.translationDatas = options.translationDatas || this.options.translationDatas || {};
	if (thisAddon.debugLevel > 1) console.log("Parsing option is", options);
	// resets Attachments
	RMUtil.attachments = {};

	//if (!this.parsed) return console.warn("Trying to dump unparsed project");
	if (!this.parsed) await this.toObj();
	//this.parsed.yaml = {};
	this.parsed.rmdata = {};
	//ui.log("Start parsing game data");

	//return console.warn("Process halted");

	files = files || this.contents.yaml;

	if (mode == "all" || mode == "data") {
		for (var ci=0; ci<files.length; ci++) {
			var path 			= files[ci];
			var relativePath 	= common.getRelativePathFromNode(path, "YAML", true);
			
			if (this.parseThisPath(relativePath) == false) {
				console.log("Skipping ", relativePath);
				continue;
			}
	
			
			if (nwPath.extname(path) !== ".yaml") continue;
			//Skip Animations Tilesets and (not)MapInfos
			if (relativePath === "YAML/Animations.yaml") continue;
			if (relativePath === "YAML/Tilesets.yaml") continue;
			//if (relativePath === "YAML/MapInfos.yaml") continue;
		this.parsed.document[path] = YAML.parseDocument(await common.fileGetContents(path, "utf8"), {customTags: RMUtil.customTags});
	
			var thisObj = this.parsed.document[path];
			if (empty(thisObj)) continue;
			//var basename = nwPath.basename(path)
			//var filename = basename.substring(0, basename.length - nwPath.extname(path).length);
	
			//this.parsed.yaml[path]  = YAML.stringify(thisObj);
			//var relativePath 		= common.getRelativePath(path, this.dirname);
	
			await ui.log(`Parsing : ${relativePath}`);
	
			var fileInfo = {};
			fileInfo.extension 		= nwPath.extname(path).toLowerCase().substring(1);
			fileInfo.dataType 		= RMData.determineType(path);
			fileInfo.filename 		= nwPath.basename(path, nwPath.extname(path));
			fileInfo.basename 		= nwPath.basename(path);
			fileInfo.path 			= relativePath;
			fileInfo.relPath		= relativePath;
			fileInfo.dirname 		= "/"+nwPath.dirname(relativePath);
			
			var rmData 				= new RMData(thisObj, options);
			rmData.engineCode		= this.engineCode;
			rmData.fileInfo			= fileInfo;
			rmData.assignTranslationPair(relativePath);
			/*
			if (!empty(options.translationDatas)) {
				var translationData = RMData.selectTranslationData(options.translationDatas, relativePath);
				console.log("current file:", relativePath);
				console.log("Translation Data:", translationData);
				translationData = translationData || {};
				rmData.translationPair = translationData.translationPair || {};
				rmData.translationInfo = translationData.info || {};
			}
			*/
	
			this.parsed.rmdata[path] = rmData;
	
		var $THISFETCH;
		switch (fileInfo.dataType) {
				case "actors":
					$THISFETCH = rmData.fetchCommonData(thisObj, ["name", "description", "nickname", "note"], [fileInfo.filename]);
					break
				case "items":
				case "armors":
				case "weapons":
					$THISFETCH = rmData.fetchCommonData(thisObj, ["name", "description", "note"], [fileInfo.filename]);
					break;
				case "skills":
					$THISFETCH = rmData.fetchCommonData(thisObj, ["name", "description", "message1", "message2", "note"], [fileInfo.filename]);
					break;
				case "states":
					//$THISFETCH = rmData.fetchCommonData(thisObj, ["name", "message1", "message2", "message3", "message4", "note"], [fileInfo.filename]);
					$THISFETCH = rmData.fetchCommonData(thisObj, ["message1", "message2", "message3", "message4", "note"], [fileInfo.filename]);
					break;
				case "classes":
				case "enemies":
				//Skipping Animations Tilesets and (not)MapInfos
/* 				case "tilesets":
					$THISFETCH = rmData.fetchCommonData(thisObj, ["name", "note"], [fileInfo.filename]);
					break;
				case "animations": */
				case "mapinfos":
					$THISFETCH = rmData.fetchCommonData(thisObj, ["name"], [fileInfo.filename]);
					break;
				case "commonevents":
					if (empty(thisObj)) continue;
	
					var cePage = thisObj.getIn([]);
					if (!cePage) continue;
					if (empty(cePage.items)) continue;

					var pool = []
					var processCommonEvents = async (i) => {
						if (thisAddon.debugLevel > 1) await ui.log(`Handling common event's page ${i}/${cePage.items.length-1}`);
						var currentPage = cePage.getIn([i]);
						if (empty(currentPage)) return;
						// name
						//rmData.registerStringObject(currentPage, "name", [fileInfo.filename, i, "name"], [], {currentAddress:[i, "name"]})
						
						// command list
						var commandListData = cePage.getIn([i, "list"]);
						if (empty(commandListData)) return;
						//var newCommandList = await rmData.fetchCommandList(commandListData, [fileInfo.filename, i]);
						var newCommandList = await RMUtil.fetchCommandListWorker(rmData, commandListData, [fileInfo.filename, i], {
							documentPath:[i, "list"]
						});
						if (thisAddon.debugLevel > 1) console.log("New command list:", newCommandList);
						commandListData.items = newCommandList;
					}

					/*
					for (var i=0; i<cePage.items.length; i++) {
						await ui.log(`Handling common event's page ${i}/${cePage.items.length-1}`);
						var currentPage = cePage.getIn([i]);
						if (empty(currentPage)) continue;
						// name
						rmData.registerStringObject(currentPage, "name", [fileInfo.filename, i, "name"], [], {currentAddress:[i, "name"]})
						
						// command list
						var commandListData = cePage.getIn([i, "list"]);
						if (empty(commandListData)) continue;
						var newCommandList = await rmData.fetchCommandList(commandListData, [fileInfo.filename, i]);
						if (thisAddon.debugLevel > 1) console.log("New command list:", newCommandList);
						commandListData.items = newCommandList;
					}
					*/
					for (var i=0; i<cePage.items.length; i++) {
						(()=>{
							var index = i;
							pool.push(limit(async ()=> {return processCommonEvents(index)}));
						})()
					}
					await Promise.all(pool)
					break;
				case "troops":
					if (empty(thisObj)) continue;
	
					//rmmvData.fetchCommonData($currentData, ["name"], [$fileInfo['filename']]);
					var troopData = thisObj.getIn([]);
					if (!troopData) continue;
					if (empty(troopData.items)) continue;
	
					for (let i=1; i < troopData.items.length;i++) {
						if (empty(thisObj.getIn([i]))) continue;
						// register name
						rmData.registerStringObject(thisObj.getIn([i]), "name", [fileInfo.filename, i, "name"], [], {currentAddress:[i, "name"]})
						
						var pages = thisObj.getIn([i, 'pages']);
						if (empty(pages)) continue;
	
						// fetch event pages content
						if (empty(pages.items)) continue;
						for (var pageId=0; pageId<pages.items.length; pageId++) {
							var oldCommands = thisObj.getIn([i, "pages", pageId, "list"]);
							if (!oldCommands) continue;
							var newCommand  = await rmData.fetchCommandList(oldCommands, [fileInfo.filename, i, "pages", pageId, "list"]);	
							oldCommands.items = newCommand;
						}
	
					}
					break;
				case "map":
					// fetch map name
					rmData.registerStringObject(thisObj, 'display_name', [fileInfo.filename, "display_name"], [], {currentAddress:["display_name"]})
	
					// fetch map note
					rmData.registerStringObject(thisObj, 'note', [fileInfo.filename, "note"], [], {currentAddress:["note"]})
	
					var docEvts = thisObj.getIn(["events"]);
					if (empty(docEvts.items)) break;
					//if (docEvts.items.length<2) break;
	
					var pool = []
				var processEvent = async (pages, evtId, pageId) => {
					if (thisAddon.debugLevel > 1) console.log("Processing event:", evtId, "page:", pageId);
						var oldCommands = pages.getIn([pageId, "list"]);
						if (!Boolean(oldCommands)) return;
						//var newCommand  = await rmData.fetchCommandList(oldCommands, [fileInfo.filename, "events", evtId, "pages", pageId, "list"]);	
						var newCommand  = await RMUtil.fetchCommandListWorker(rmData, oldCommands, [fileInfo.filename, "events", evtId, "pages", pageId, "list"], {
							documentPath:["events", evtId, "pages", pageId, "list"]
						});	
					oldCommands.items = newCommand;
					if (thisAddon.debugLevel > 1) console.log("oldCommands.items", oldCommands.items);
					return "evtId "+evtId+" page "+pageId+" completed!"
					}

					// iterate events
					for (var index=0; index<docEvts.items.length; index++) {
						//var thisEvtData = thisObj.getIn(["events", evtId]);
						var thisEvtData = YAML.getFromIndex(thisObj.getIn(["events"]), index);
						if (empty(thisEvtData)) continue;
						var evtId = thisEvtData.get("id");
						// fetch event name
						//rmData.registerStringObject(thisEvtData, 'name', [fileInfo.filename, "events", evtId, "name"], [], {currentAddress : ["events", evtId, "name"]})
					
						// fetch event pages content
						var pages = thisEvtData.getIn(['pages']);
						if (empty(pages)) continue;
	
						// fetch event pages content
						if (empty(pages.items)) continue;
						/*
						for (var pageId=0; pageId<pages.items.length; pageId++) {
							var oldCommands = pages.getIn([pageId, "list"]);
							if (!Boolean(oldCommands)) continue;
							//var newCommand  = await rmData.fetchCommandList(oldCommands, [fileInfo.filename, "events", evtId, "pages", pageId, "list"]);	
							var newCommand  = await RMUtil.fetchCommandListWorker(rmData, oldCommands, [fileInfo.filename, "events", evtId, "pages", pageId, "list"]);	
							oldCommands.items = newCommand;
							console.log("oldCommands.items", oldCommands.items);
						}
						*/
						for (var pageId=0; pageId<pages.items.length; pageId++) {
							(()=> {
								var thisPages = pages;
								var thisEvtId = evtId;
								var thisPageId = pageId;
								pool.push(limit(async ()=> {return processEvent(thisPages, thisEvtId, thisPageId)}));
							})()
						}
					}
					if (thisAddon.debugLevel > 1) console.log("Executing pool", pool);
					await Promise.all(pool)

					break;	
				case "system":
					rmData.fetchSystem(thisObj,  [fileInfo.filename]);
					break;
			}
	
		if (this.writeMode) {
			// storing document as a plain string is better than storing as obj
			try {
				if (thisAddon.debugLevel > 1) console.log("Parsed document", this.parsed.document[path]);
				this.parsed.document[path] = this.parsed.document[path].toString();

				} catch (e) {
					console.warn("Unable to convert document to string", e)
					this.parsed.document[path] = "";

				}
			} else {
				// remove if not write mode
				this.parsed.document[path] = "processed";
			}
		}
	}
	
	if (mode == "all" || mode == "script") {
		if (empty(this.parsed.scripts)) {
			if (this.parseThisPath("YAML/Scripts.yaml")) await this.parseScript(options);
		}
	}

	if (mode == "all" || mode == "tes") {
		if (empty(this.parsed.tesData)) {
			if (this.parseThisPath("YAML/main.yaml")) await this.tesParse(options);
		}
	}

	if (mode == "all" || mode == "ini") {
		if (this.parseThisPath("Game.ini")) await this.parseGameIni(options);
	}



	this.isParsed = true;
	//return this;
}



RMUtil.prototype.toYaml = async function(outputDirectory) {
	if (!outputDirectory) return console.warn("Please set toYaml arguments[0] with output directory");
	await common.mkDir(nwPath.join(outputDirectory, "YAML"));
	await common.mkDir(nwPath.join(outputDirectory, "Scripts"));
	ui.log("Writing data files");

	var writeDocument = async (path) => {
		var thisObj = this.parsed.document[path];
		var targetPath = nwPath.join(outputDirectory, "YAML", nwPath.basename(path));
		await ui.log("Writing : "+targetPath);
		try {
			// Weather effect confuses YAML parser
			// this is a quick dirty way to fix the error on the weather effect
			var yamlString = thisObj.toString();
			yamlString = yamlString.replaceAll(`, p: [ !!str ':storm',`, `, p: [! ':storm',`);
			yamlString = yamlString.replaceAll(`, p: [ !!str ':rain',`, `, p: [! ':rain',`);
			yamlString = yamlString.replaceAll(`, p: [ !!str ':snow',`, `, p: [! ':snow',`);
			yamlString = yamlString.replaceAll(`, p: [ !!str ':none',`, `, p: [! ':none',`);
			await common.filePutContents(targetPath, yamlString, "utf8", false);
		} catch (e) {
			ui.log("Can not write "+targetPath+" See console log for more information");
			console.warn(e);
		}
	};

	if (!this.isParsed) {
		if (!this.parsed) await this.toObj();
		for (var ci=0; ci<this.contents.yaml.length; ci++) {
			await this.parse([this.contents.yaml[ci]], "data");
			for (var path in this.parsed.document) {
				await writeDocument(path);
				delete this.parsed.document[path];
			}
		}
		await this.parse(undefined, "script");
		await this.parse(undefined, "tes");
		await this.parse(undefined, "ini");
		this.isParsed = true;
	} else {
		for (var path in this.parsed.document) {
			await writeDocument(path);
		}
	}

	ui.log("Writing scripts");
	for (var path in this.parsed.scripts) {
		var thisObj = this.parsed.scripts[path];
		var targetPath = nwPath.join(outputDirectory, "Scripts", nwPath.basename(path));
		await ui.log("Writing : "+targetPath);

		await common.filePutContents(targetPath, thisObj.writableData.join(""), "utf8", false);
	}

	return this;
}

RMUtil.prototype.dumpIniFile = async function(outputDirectory) {
	if (empty(this.parsed.gameIni)) return this;
	var translated = this.parsed.gameIni.toString();
	await common.filePutContents(nwPath.join(outputDirectory, "Game.ini"), translated, "utf8", false);
	return this;
}

/**
 * Generate trans data from a RM project
 * @param  {} cacheInfo
 */
 RMUtil.prototype.toTrans = async function(cacheInfo) {
	await ui.log("Creating project");
	cacheInfo 				= cacheInfo || await RMUtil.createCacheFolder();
	this.options 			= this.options || {};
	this.options.targetDir 	= nwPath.join(cacheInfo.cachePath, "data/");

	// Get parsable files from the project
	if (!this.contents) await this.toObj();

	this.trans = {
		projectId		: cacheInfo.cacheID,
		cache			: cacheInfo,
		gameEngine		: RMUtil.translateEngineType(this.engineCode),
		gameTitle		: this.gameTitle || "",
		loc				: this.dirname,
		parser			: 'rmrgss',
		parserVersion	: thisAddon.package.version,
		attachments		: RMUtil.attachments,
		files			: {}
	}

	console.log("current content", this.contents);
	await ui.log("Generating trans data from Game.ini");
	if (this.contents.gameIni) {
		await this.parse([this.contents.gameIni], "ini");
		var gameIni 	= this.parsed.gameIni;
		var thisRelPath = this.parsed.gameIni.fileInfo.relPath;
		this.trans.files[thisRelPath] = Object.assign({}, gameIni.transData, gameIni.fileInfo);
		this.trans.gameTitle = this.gameTitle || "";
	}

	await ui.log("Generating trans data from RMData");
	for (var i in this.contents.yaml) {
		var file = this.contents.yaml[i];
		await this.parse([file], "data");
		var thisData 	= this.parsed.rmdata[file];
		if (empty(thisData)) continue;
		var thisRelPath = thisData.fileInfo.relPath
		//Add objects except animations (not)mapinfos and tilesets
		//if (thisRelPath.includes('Animations') != true && thisRelPath.includes('MapInfos') != true && thisRelPath.includes('Tilesets') != true) {
		if (thisRelPath.includes('Animations') != true && thisRelPath.includes('Tilesets') != true) {
		this.trans.files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
		}
		// removing rendered data
		this.parsed.rmdata[i] = {};
		thisData = undefined;
	}

	await ui.log("Generating trans data from Script");
	await this.parse(undefined, "script");
	for (var i in this.parsed.scripts) {
		var thisData = this.parsed.scripts[i];
		var thisRelPath = thisData.fileInfo.relPath
		this.trans.files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
	}
	this.parsed.scripts = {};

	// Add a virtual "Main injection" object for VX / VX Ace games. The user types
	// Ruby code into it; that code is prepended to the start of the Main script
	// whenever Scripts is exported (see RMUtil.applyMainInjection).
	var _injEngine = this.engineCode || "";
	if (_injEngine == "ace" || _injEngine == "vx" || _injEngine == "rmvxace" || _injEngine == "rmvx") {
		this.trans.files[MAIN_INJECTION_KEY] = {
			relPath		: MAIN_INJECTION_KEY,
			path		: MAIN_INJECTION_KEY,
			dirname		: "/Scripts",
			filename	: "!Main Injection",
			basename	: "!Main Injection",
			extension	: "",
			dataType	: "ruby",
			data		: [[MAIN_INJECTION_PLACEHOLDER, ""]],
			context		: [[]],
			tags		: [[]],
			parameters	: [],
			indexIds	: {},
			mainInjection: true
		};
		await ui.log("Added Main injection object for " + _injEngine + " project");
	}

	await this.parse(undefined, "tes");
	if (this.parsed.tesData) {
		await ui.log("Generating trans data from TES data");
		for (var i in this.parsed.tesData) {
			var thisData = this.parsed.tesData[i];
			var thisRelPath = thisData.fileInfo.relPath
			this.trans.files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
		}
		this.parsed.tesData = undefined;
	}

	await ui.log("generating initial.json");
	await common.filePutContents(nwPath.join(cacheInfo.cachePath, "initial.json"), JSON.stringify(this.trans), 'utf8', false);
	
	await ui.log("generating game information");
	var gameInfo = {
		title : this.gameTitle,
		Title : this.gameTitle,
		engine : this.engineCode,
		tes : await this.tesHasTes()
	}
	await common.filePutContents(nwPath.join(cacheInfo.cachePath, "gameInfo.json"), JSON.stringify(gameInfo, undefined, 2), 'utf8', false);

	await ui.log("done converting to trans");

	return this.trans;
}


RMUtil.prototype.toTrans_legacy = async function(cacheInfo) {
	await ui.log("Creating project");
	cacheInfo 				= cacheInfo || await RMUtil.createCacheFolder();
	this.options 			= this.options || {};
	this.options.targetDir 	= nwPath.join(cacheInfo.cachePath, "data/");

	if (!this.isParsed) await this.parse();

	this.trans = {
		projectId		: cacheInfo.cacheID,
		cache			: cacheInfo,
		gameEngine		: RMUtil.translateEngineType(this.engineCode),
		gameTitle		: this.gameTitle || "",
		loc				: this.dirname,
		parser			: 'rmrgss',
		parserVersion	: thisAddon.package.version,
		attachments		: RMUtil.attachments,
		files			: {}
	}

	await ui.log("Generating trans data from Game.ini");
	var gameIni = this.parsed.gameIni;
	var thisRelPath = this.parsed.gameIni.fileInfo.relPath;
	this.trans.files[thisRelPath] = Object.assign({}, gameIni.transData, gameIni.fileInfo);

	await ui.log("Generating trans data from RMData");
	for (var i in this.parsed.rmdata) {
		var thisData = this.parsed.rmdata[i];
		var thisRelPath = thisData.fileInfo.relPath
		this.trans.files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
	}

	await ui.log("Generating trans data from Script");
	for (var i in this.parsed.scripts) {
		var thisData = this.parsed.scripts[i];
		var thisRelPath = thisData.fileInfo.relPath
		this.trans.files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
	}

	if (this.parsed.tesData) {
		await ui.log("Generating trans data from TES data");
		for (var i in this.parsed.tesData) {
			var thisData = this.parsed.tesData[i];
			var thisRelPath = thisData.fileInfo.relPath
			this.trans.files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
		}
	}

	await ui.log("generating initial.json");
	await common.filePutContents(nwPath.join(cacheInfo.cachePath, "initial.json"), JSON.stringify(this.trans), 'utf8', false);
	
	await ui.log("generating game information");
	var gameInfo = {
		title : this.gameTitle,
		Title : this.gameTitle,
		engine : this.engineCode,
		tes : await this.tesHasTes()
	}
	await common.filePutContents(nwPath.join(cacheInfo.cachePath, "gameInfo.json"), JSON.stringify(gameInfo, undefined, 2), 'utf8', false);

	await ui.log("done converting to trans");
	console.log("RMUtil data:", this);
	return this.trans;
}


RMUtil.prototype.detectEngineType = async function() {
	if (this.options.engineType) {
		var gameEngines ={
			"rmvxace" : "ace",
			"rmvx" : "vx",
			"rmxp" : "xp"
		}
		return gameEngines[this.options.engineType]
	}
	if (await common.isFileAsync(nwPath.join(this.dirname, "Game.rgss3a"))) return "ace";
	if (await common.isFileAsync(nwPath.join(this.dirname, "Data/System.rvdata2"))) return "ace";
	if (await common.isFileAsync(nwPath.join(this.dirname, "Game.rgss2a"))) return "vx";
	if (await common.isFileAsync(nwPath.join(this.dirname, "Data/System.rvdata"))) return "vx";
	if (await common.isFileAsync(nwPath.join(this.dirname, "Game.rgssad"))) return "xp";
	if (await common.isFileAsync(nwPath.join(this.dirname, "Data/System.rxdata"))) return "xp";
	if (await common.isFileAsync(nwPath.join(this.dirname, "Game.rvproj2"))) return "ace";
	
}

RMUtil.prototype.getEngineCode = async function() {
	if (this.engineCode) return this.engineCode;
	this.engineCode = await this.detectEngineType();
	return this.engineCode;
}

RMUtil.createCacheFolder = async function(id) {
	await ui.log("Generating staging directory");

	id = id || common.makeid(10);

	var cacheInfo = {
		cacheID: id,
		cachePath: nwPath.join(common.getStagePath(), id)
	}

	var cacheFolderData = nwPath.join(cacheInfo.cachePath, "data");
	await common.mkDir(cacheFolderData);
	await ui.log(`New staging directory with id ${id} has been created!`);
	
	return cacheInfo;
}

RMUtil.prototype.getDataExtension = async function() {
	var engine = await this.getEngineCode();
	if (engine == "ace") return "rvdata2";
	if (engine == "vx") return "rvdata";
	if (engine == "xp") return "rxdata";
	
}

// TES Utility


RMUtil.prototype.tesHasTes = async function() {
	if (typeof this.hasTes !== "undefined") return this.hasTes;
	var dataExtension = await this.getDataExtension();
	var expectedPath = nwPath.join(this.dirname, "Data/main."+dataExtension);
	console.log("Expected path:", expectedPath);
	if (await common.isFileAsync(expectedPath)) {
		await ui.log("Encrypted TES data detected at: "+expectedPath);
		console.log("TES data detected!");
		this.hasTes = true;
		return true;
	}
	console.log("No TES data detected. Process accordingly!");
	return false;
}

RMUtil.prototype.tesExtractTo = async function(targetDir) {
	if (!await this.tesHasTes()) return this;

	targetDir = targetDir || this.targetDir || this.options.targetDir || this.dirname;
	console.log("Unpack main data", this.dirname, "to", targetDir);
	var thisEngineType = await this.getEngineCode();
	await common.mkDir(targetDir);

	var absolutePath = nwPath.resolve(targetDir);

	var binPath = nwPath.join(common.getRootDir(), "3rdParty/TES-Patcher/TES_Patcher.rb");
	var options = {
		cwd: this.dirname, // Important! set current directory to the Game's root folder
onData: function(buffer) {
			var _l = buffer.toString().split("\n");
			for (var _i = 0; _i < _l.length; _i++) {
				if (_l[_i] && !/\.rb:\d+:in /.test(_l[_i])) ui.log(_l[_i]);
			}
		}
	}	
	await common.aSpawn(	nwPath.join(common.getRootDir(), nw.App.manifest.localConfig.ruby), [binPath, "-e", absolutePath, "-a", "102"], options);
	this.tesExtractPath = targetDir;
	return this;
}

RMUtil.prototype.tesBuildTo = async function(destinationDir, options) {
	//TODO
	options = options || this.options;
	if (!await this.tesHasTes()) return this;
	if (empty(this.parsed.tesData)) return this;

	await ui.log("Start building TES data with destination: "+destinationDir);
	console.log("Current rmUtil:", this);
	// set extract path
	//var folderName 		= "main."+await this.getDataExtension();
	//this.tesExtractPath = nwPath.join(this.targetDir, folderName);

	// parse data
	//await ui.log("Parsing TES scripts:"+this.tesExtractPath);
	//if (!this.tesIsParsed) await this.tesParse(options);

	var tmpDirBase 		= nwPath.join(nw.process.env.TEMP, "slr_tes_"+common.generateId());
	var dumpDir 		= await common.mkDir(nwPath.join(tmpDirBase, "translated"));
	//var fakeGameDirData	= await common.mkDir(nwPath.join(tmpDirBase, "gameRoot", "data"));

	await ui.log("Dumping TES scripts into "+dumpDir);
	for (var path in this.parsed.tesData) {
		var thisObj 	= this.parsed.tesData[path];
		var targetPath 	= nwPath.join(dumpDir, nwPath.basename(path));
		await ui.log("Writing "+targetPath);
		await common.filePutContents(targetPath, thisObj.toString(), "utf8", false);
	}

	await ui.log("Generating stagging path:"+fakeGameDir);

	var cacheGame = nwPath.join(this.tesExtractPath, "../gameRoot");
	ui.log("copy "+cacheGame+" to "+tmpDirBase);
	await bCopy(cacheGame, tmpDirBase, {overwrite:true});

	var fakeGameDir		= nwPath.join(tmpDirBase, "gameRoot");

	var binPath 		= nwPath.join(__dirname, "3rdParty/TES-Patcher/TES_Patcher.rb");


	// TODO here
	await ui.log("Compiling TES scripts to:"+destinationDir);
	var spawnOpt = {
		// Important! set current directory to the root folder of the game where Data/scripts.rvdata2 and Data/main.rvdata2 is existed
		cwd: tmpDirBase, 
onData: function(buffer) {
			var _l = buffer.toString().split("\n");
			for (var _i = 0; _i < _l.length; _i++) {
				if (_l[_i] && !/\.rb:\d+:in /.test(_l[_i])) ui.log(_l[_i]);
			}
		}
	}	
	// <bundled ruby> <bundled TES-Patcher/TES_Patcher.rb> -p "location/of/the/scripts"
	await common.aSpawn(	nwPath.join(common.getRootDir(), nw.App.manifest.localConfig.ruby), [binPath, "-p", dumpDir], spawnOpt);

	//await common.mkDir(destinationDir);
	await ui.log("Copy main.rvdata2 to:"+nwPath.join(destinationDir, "Data"));
	await common.copyFile(nwPath.join(tmpDirBase, "main."+await this.getDataExtension()), nwPath.join(destinationDir, "Data"))
	ui.log("Done processing TES!");
	return this;

}

RMUtil.prototype.tesCopyRequiredFiles = async function() {
	if (!await this.tesHasTes()) return;
	if (!this.tesExtractTo) return console.warn("this.tesExtractTo is required in tesCopyRequiredFiles");
	var gameData = nwPath.join(this.targetDir, "gameRoot/Data");
	await common.mkDir(gameData);

	var fileToCopy 		= ["main", "Scripts"];
	var dataExtension 	= await this.getDataExtension();
	for (var i=0; i<fileToCopy.length; i++) {
		var source = nwPath.join(this.dirname, "Data", fileToCopy[i]+"."+dataExtension);
		await ui.log("Copying :"+source+" to "+gameData);
		await common.copyFile(source, gameData);
	}
}

RMUtil.prototype.tesParse = async function(options) {
	options = options || this.options || {}
	if (!await this.tesHasTes()) return this;
	ui.log("Parsing TES data");
	var folderName = "main."+await this.getDataExtension();
	if (!this.tesExtractPath) {
		// extract if not yet extracted
		await this.tesExtractTo(nwPath.join(this.targetDir, folderName));
	}
	this.contents.tesFiles 	= await common.readDir(this.tesExtractPath);
	this.parsed.tesData 	= {};
	var RmTransFile 		= require("www/core/rmrgss/RmTransFile.js");

	for (var i=0; i<this.contents.tesFiles.length; i++) {
		var scriptPath = this.contents.tesFiles[i];
		if (nwPath.extname(scriptPath) !== ".txt") continue;

		var fileInfo = {};
		var relativePath 		= common.getRelativePathFromNode(scriptPath, folderName, true);
		fileInfo.extension 		= nwPath.extname(scriptPath).toLowerCase().substring(1);
		fileInfo.dataType 		= "text";
		fileInfo.filename 		= nwPath.basename(scriptPath, nwPath.extname(scriptPath));
		fileInfo.basename 		= nwPath.basename(scriptPath);
		fileInfo.path 			= relativePath;
		fileInfo.relPath		= relativePath;
		fileInfo.dirname 		= "/"+nwPath.dirname(relativePath);

		this.parsed.tesData[scriptPath] = new RmTransFile(await common.fileGetContents(scriptPath, "utf8"), options)
		var tesParser 			= this.parsed.tesData[scriptPath];
		tesParser.fileInfo		= fileInfo;
		tesParser.assignTranslationPair(relativePath);

		await ui.log(`Parsing : ${relativePath}`);
		/*
		if (!empty(options.translationDatas)) {
			var translationData = RMData.selectTranslationData(options.translationDatas, relativePath);
			console.log("current file:", relativePath);
			console.log("Translation Data:", translationData);
			translationData 			= translationData || {};
			tesParser.translationPair 	= translationData.translationPair || {};
			tesParser.translationInfo 	= translationData.info || {};
		}
		*/

		tesParser.parse();
	}
	this.tesIsParsed = true;
	return this;

}

thisAddon.RMUtil = RMUtil;








xSpawn = async function(command, args, options) {
	args = args || [];
	if (Array.isArray(args) == false) args = [args];
	options = options||{};
	options.args = options.args||{};
	options.onData = options.onData||function(result, e) {};
	options.onDone = options.onDone||function(result, e) {};
	options.onError = options.onError||function(result, e) {};
	//options.onReceive = options.onReceive||function(result, e) {};
	var resolver;
	var rejecter;
	var thisPromise = new Promise((resolve, reject)=>{
		resolver = resolve;
		rejecter = reject;
	});	
	
	
	var maxOutputBuffer = 64 * 1024 * 1024;
	var outputBuffer = "";
	var child = spawn(command, args, options);
	
	child.stdout.on('data', function (data) {
		//console.log('stdout: ' + data);
		if (outputBuffer.length < maxOutputBuffer) {
			outputBuffer += data;
		}
		//console.log("Received buffer : "+data);
		options.onData.call(this, data);
		//options.onReceive.call(this, data);
	});

	child.stderr.on('data', function (data) {
		console.log('stderr: ' + data);
		options.onError.call(this, data);
		
	});

	child.on('close', function (code) {
		console.log('child process exited with code ' + code);
		//console.log("data is : "+outputBuffer);
		var result = php.evalResult(outputBuffer)
		options.onDone.call(this, result);
		resolver(result);
	});

	child.on('error', function (err) {
		console.error('spawn error:', err);
		options.onError.call(this, err);
		rejecter(err);
	});

	return thisPromise;
}




var RMRGSS = function(exeFile) {
	this.file 	= exeFile;
	this.dir 	= nwPath.dirname(this.file);
}

RMRGSS.prototype.init = async function() {
	
}

RMRGSS.prototype.type = async function() {
	return await Engines.detect(this.file);
}

RMRGSS.prototype.extractTo = async function(to, onProgress) {
	// to is dirname
	console.log("Extracting to ", to);
	var report = function(msg) { if (onProgress) { try { onProgress(msg); } catch (_) {} } };

	report("Copying game files...");
	var copyCount = 0;
	await bCopy(this.dir, to, {overwrite:true, onAfterCopy: async function () {
		copyCount++;
		if (copyCount % 50 === 0) report("Copying game files... (" + copyCount + " files)");
	}});
	report("Copied " + copyCount + " files.");

	var dirContent = await afs.readdir(this.dir);
	var monitor = [".rgss3a", ".rgss2a", ".rgssad"]
	var archiveCount = 0;
	for (var k in dirContent) if (monitor.includes(nwPath.extname(dirContent[k]).toLowerCase())) archiveCount++;
	var arcIdx = 0;
	var decName = (process.platform === 'win32') ? "RPGMakerDecrypter-cli.exe" : "RPGMakerDecrypter-cli";
	for (var i in dirContent) {
		var ext = nwPath.extname(dirContent[i]);
		if (monitor.includes(ext.toLowerCase()) == false) continue;
		arcIdx++;
		report("Decrypting " + dirContent[i] + " (" + arcIdx + "/" + archiveCount + ")...");
		var result = await xSpawn(nwPath.join(decrypterPath, decName), [nwPath.join(to, dirContent[i]), "-o", to, "-w"], {
			cwd : to
		});

		fs.unlinkSync(nwPath.join(to, dirContent[i]));
		console.log("Unlink done");
	}

	report("Extraction complete.");

}

RMRGSS.prototype.isPacked = async function() {
	var dirContent = await afs.readdir(this.dir);
	for (var i in dirContent) {
		var ext = nwPath.extname(dirContent[i]);
		//vxace archive
		if (ext.toLowerCase() == ".rgss3a") return true;
		//vx archive
		if (ext.toLowerCase() == ".rgss2a") return true;
		//xp archive
		if (ext.toLowerCase() == ".rgssad") return true;
	}
	return false;
}

window.RMRGSS = RMRGSS;


thisAddon.createProject = async function(exeFile, options) {
	options = options || {};
	await ui.log("Creating project");
	try {
		var rmUtil = new RMUtil(exeFile, options)	
		rmUtil.writeMode = false;
		await rmUtil.toTrans();
		await rmUtil.tesCopyRequiredFiles()
		trans.openFromTransObj({project:rmUtil.trans}, {isNew:true});
		console.log("rmUtil:", rmUtil);
		return rmUtil;
	} catch (e) {
		console.error(e);
		ui.logError("Error occured! Please see console window(F12) for more information", e.toString());
	}
}

thisAddon.exportToFolder = async function(destinationDir, transData, options) {
	transData 			= transData || trans.getSaveData();
	options 			= options || {};
	options.engineType	= options.engineType || transData.project.gameEngine || trans.project.gameEngine;
	options.translationDatas = options.translationDatas || trans.getTranslationData(transData, options);
	//var currentGamePath = transData.project.loc;

	try {
		if (! await common.isDirectory(transData.project.cache.cachePath)) {
			ui.log("Error: Unable to find directory:"+transData.project.cache.cachePath);
			return;
		}
	
		if (empty(transData)) {
			ui.log("Error: Trans data is blank!");
			return console.warn("trans data is blank");
		}
	
		var stagingData		= nwPath.join(transData.project.cache.cachePath, "data");
	
		await ui.log("Export to folder"+destinationDir);
		var rmUtil = new RMUtil(destinationDir, options);
		rmUtil.writeMode = true;
		await rmUtil.setUnpackedDir(stagingData);
		console.log("RMUtil is:", rmUtil);
		var tmpDir = nwPath.join(nw.process.env.TEMP, "slr_"+common.generateId());
		await ui.log("Translate raw data into: "+tmpDir);
	await common.mkDir(tmpDir);
	await rmUtil.toYaml(tmpDir);

	var injectedCode = await rmUtil.applyMainInjection(transData, tmpDir);

	// ship font files referenced by Font.default_name assignments of the
	// injected code along with the export
	var injectedFonts = extractInjectionFontNames(injectedCode);
	if (!empty(injectedFonts)) {
		await thisAddon.exportMainInjectionFonts(destinationDir, injectedFonts);
	}

	await ui.log("Repack to: "+destinationDir);
	await rmUtil.repackTo(destinationDir, tmpDir);

		await rmUtil.tesBuildTo(destinationDir, options);

		await ui.log("Writing ini file to: "+destinationDir);
		await rmUtil.dumpIniFile(destinationDir);

		return true;
	} catch (e) {
		console.error(e);
		ui.logError("Error occured! Please see console window(F12) for more information", e.toString());
	}

}

thisAddon.exportToFolderThread = async function(destinationDir, transData, options) {
	return await this.exportToFolder(destinationDir, transData, options);
}

thisAddon.exportAsZip = async function(targetPath, transData, options) {
	transData 			= transData || trans.getSaveData();
	options 			= options || {};
	options.engineType	= options.engineType || transData.project.gameEngine || trans.project.gameEngine;
	options.translationDatas = options.translationDatas || trans.getTranslationData(transData, options);

	// todo
	var tmpDir = nwPath.join(nw.process.env.TEMP, "slr_"+common.generateId());
	try {
		await fse.remove(tmpDir); 
		await common.mkDir(tmpDir, {recursive:true});
	} catch(e) {
		console.warn("Unable to create directory ", tmpDir);
		console.error(e);
		return;
	}

	await this.exportToFolderThread(tmpDir, transData, options);
	await ui.log("Zipping temporary data");
	var _7z = require('7zip-min');

	return new Promise((resolve, reject) => {
		_7z.cmd(['a', '-tzip', targetPath, tmpDir + nwPath.sep + "*"], err => {
			// done
			console.log("process done");
			resolve(targetPath);
		});	
	})

}

/*
thisAddon.yamlFileToTrans = async function(targetDir, file) {
	var rmUtil = new RMUtil(targetDir)
	await rmUtil.setUnpackedDir(targetDir);
	await rmUtil.addFiles([file]);
	await rmUtil.parse();
	var files = {};
	for (var i in rmUtil.parsed.rmdata) {
		var thisData = rmUtil.parsed.rmdata[i];
		var thisRelPath = thisData.fileInfo.relPath
		files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
	}
	return files	
}
*/


thisAddon.yamlToTrans = async function(targetDir, file, mode) {
	mode = mode || RMUtil.detectMode(file);
	var result = {
		attachments		: {},
		files			: {}
	}
	var rmUtil = new RMUtil(targetDir)
	await rmUtil.setUnpackedDir(targetDir);
	await rmUtil.addFiles([file]);
	await rmUtil.parse([file], mode);
	for (var i in rmUtil.parsed.rmdata) {
		var thisData = rmUtil.parsed.rmdata[i];
		var thisRelPath = thisData.fileInfo.relPath
		result.files[thisRelPath] = Object.assign({}, thisData.transData, thisData.fileInfo);
	}
	result.attachments 	= RMUtil.attachments;
	if (rmUtil.gameTitle) result.gameTitle = rmUtil.gameTitle;
	return result;
}

thisAddon.createProjectThread = async function(exeFile, options) {
	return await this.createProject(exeFile, options);
}



var drawProjectCreator = function() {
	var $slide = $(`<h1><span>RPG Maker XP, VX, Ace, MV & MZ Parser Ver. ${thisAddon.package.version}</span></h1>
	<div class="fieldgroup">
	<div class="dialogSectionBlock fieldgroup">
		<h2>${('Select the game')}</h2>
		<div class="info">${('Select the executable file from your original game (Game.exe on Windows, or the nw / Game / start.sh launcher of a Linux port).')}</div>
		<label><input type="dvSelectPath" class="rpgMakerLocation" /></label>
	</div>		
		<div class="dialogSectionBlock fieldgroup detectedTypeWrapper hidden">
			<h2>${('Detected engine / type')}</h2>
			<div class="info"></div>
			<label><input type="text" class="detectedType" readonly="readonly" /></label>
		</div>	
		<div class="dialogSectionBlock fieldgroup createCopyWrapper hidden">
			<label class="flex fullWidth">
				<div class="flexMain">
					<div class="label">${('Create a development copy ')}<span class="copyIsRequired">${('(required)')}</span></div>
					<div class="info">${('Will create an editable copy of your game (required for some project)')}</div>
				</div>
				<div>
					<input type="checkbox" class="createCopy flipSwitch"> 
				</div>
			</label>
		</div>			
		<div class="fieldgroup devLocationWrapper">
			<h2>${('Set development directory')}</h2>
			<div class="info">${('SLR Translator will generate an extracted, ready to translate copy of your game in this directory.')}</div>
			<label><input type="dvSelectPath" class="devLocation" nwdirectory /></label>
		</div>		
		<div class="fieldgroup devLocationTypeWrapper hidden">
			<h2>${(`Development directory's Engine Type`)}</h2>
			<div class="info">${('The detected engine type of the source materials in the development directory.')}</div>
			<label><input type="text" class="devLocationType fullWidth" /></label>
		</div>		
		<div class="fieldgroup devLocationExeWrapper hidden">
			<h2>${(`Development directory's Executable`)}</h2>
			<div class="info">${('Path of the Executable of the source materials in the development directory.')}</div>
			<label><input type="text" class="devLocationExe fullWidth" /></label>
		</div>
		<div class="actionButtons">
		<!--
			<button class="selectRPGExe"><i class="icon-doc-inv"></i>${('Create project!')}</button>
		-->
			<button class="createProjectFromRPGM"><i class="icon-doc-inv"></i>${(`Create project!`)}</button>
		</div>
	</div>`);
	
	ui.newProjectDialog.addMenu({
		icon 			: thisAddon.getWebLocation()+"/SLRicon.png",
		descriptionBar 	: `<h2>${'RPG Maker XP, VX, Ace, MV & MZ Parser'}</h2>
						   <p>${'Start translation from RPG Maker game using SLR parsing.'}</p>`,
		actionBar		: "",
		goToSlide		: "rmrgss",
		at				: 1,
		slides 			: {"rmrgss": $slide}
	})

	var initializeSlide = ($slide)=> {
		var resetSlide = ()=> {
			console.log("initializing slide");
			$slide.find(".rpgMakerLocation").val("");
			$slide.find(".devLocation").val("");
			$slide.find(".devLocationWrapper").addClass("hidden");
			$slide.find(".detectedTypeWrapper").addClass("hidden");
			$slide.find(".devLocationTypeWrapper").addClass("hidden");
			$slide.find(".devLocationExeWrapper").addClass("hidden");
			// initializing create a copy
			$slide.find(".createCopyWrapper").addClass("hidden");
			$slide.find(".createCopy").prop("checked", false);
			$slide.find(".createCopy").prop("disabled", false);
			$slide.find(".copyIsRequired").addClass("hidden");
			
			$slide.find(".detectedType").val("");
			$slide.find(".devLocationType").val("");
			$slide.find(".devLocationExe").val("");
			$slide.find(".devLocationWrapper").removeClass("mandatory");
			$slide.find(".createProjectFromRPGM").prop("disabled", true);
		};
		resetSlide();

		if ($slide.hasClass("isInitialized")) return;

		$slide.find(".rpgMakerLocation").on("change", async function(e) {
			var loc = $(this).val();
			console.log("analyzing path : ", loc);
			var projectType = await Engines.detect(loc);
	
			$slide.find(".detectedTypeWrapper").removeClass("hidden");
			$slide.find(".detectedType").val(projectType);
			$slide.find(".devLocation").val("");

			if (!Boolean(projectType)) return alert("Error!\r\nSLR Translator is unable to detect the type of "+loc);

			if (["rmvxace", "rmvx", "rmxp"].includes(projectType)) {

				console.log("RPG Maker - RSS Variant");
				ui._thisGame = new RMRGSS(loc);
				if (await ui._thisGame.isPacked()) {
					// packed container: a development copy is mandatory (it gets decrypted)
					$slide.find(".createCopyWrapper").removeClass("hidden");
					$slide.find(".createCopy").prop("checked", true);
					$slide.find(".createCopy").prop("disabled", true);
					$slide.find(".copyIsRequired").removeClass("hidden");
	
					$slide.find(".devLocationWrapper").addClass("mandatory");
					
					$slide.find(".createCopy").trigger("change");
					return;
				}
			}

			if (projectType == "enigma") {
				// Enigma Virtual Box packed executable: a development copy is mandatory (it gets unpacked)
				$slide.find(".createCopyWrapper").removeClass("hidden");
				$slide.find(".createCopy").prop("checked", true);
				$slide.find(".createCopy").prop("disabled", true);
				$slide.find(".copyIsRequired").removeClass("hidden");
				$slide.find(".devLocationWrapper").addClass("mandatory");
				$slide.find(".createCopy").trigger("change");
				return;
			}

			$slide.find(".createProjectFromRPGM").prop("disabled", false);
		});
		$slide.find(".createCopy").on("change", async function(e) {

			
			if ($(this).prop("checked")) {
				$slide.find(".devLocationWrapper").removeClass("hidden");
			} else {
				$slide.find(".devLocationWrapper").addClass("hidden");
			}
			
		})
		
		
		$slide.find(".devLocation").on("change", async function(e) {
			var to 		= $(this).val();
			var from 	= $slide.find(".rpgMakerLocation").val();
			var detectedType = $slide.find(".detectedType").val().toLowerCase()
	
			if (common.isRelated(nwPath.dirname(from)+"/", to+"/")) {
				alert(`${nwPath.dirname(from)}\r\nis related to\r\n${to}\r\n`+"You should change the path!\r\nThe Dev directory should not inside the original game's directory, as this will cause problem if you inject the game latter.");
				$(this).val("");
				return;
			}

			if (["rmvxace", "rmvx", "rmxp"].includes(detectedType)) {
	
				var conf = confirm("Copy & extract data into "+to+" ?")
				if (!conf) {
					$(this).val("");
					return 
				}
				ui.showLoading();
				ui.loadingProgress("Dev copy", "Creating development copy...", {consoleOnly:false, mode:'consoleOutput'});
				await new Promise(function(r){ setTimeout(r, 50); }); // let the loading screen paint
				ui._thisGame 		= ui._thisGame || new RMRGSS(from);
				var thisEngine 		= $slide.find(".detectedType").val();
				var unpackedDir 	= nwPath.join(to, (nwPath.basename(ui._thisGame.dir) || "Game") + " Unpacked");
				var devExecutable 	= nwPath.join(unpackedDir, nwPath.basename(from));
				try {
					await ui._thisGame.extractTo(unpackedDir, function(msg) {
						ui.loadingProgress("Dev copy", msg, {consoleOnly:false, mode:'consoleOutput'});
					});
				} catch (err) {
					ui.loadingEnd("Failed", "Dev copy failed: "+(err && err.message ? err.message : err), {error:true});
					return;
				}
				ui.hideLoading();
				
				$slide.find(".devLocationTypeWrapper").removeClass("hidden");
				$slide.find(".devLocationType").val(thisEngine);
				$slide.find(".devLocationExeWrapper").removeClass("hidden");
				$slide.find(".devLocationExe").val(devExecutable);

			}

			if (detectedType == "enigma") {
				var conf = confirm("This game is packed with Enigma Virtual Box.\r\nUnpack it into "+to+"?\r\nThis may take a while depending on the game size.");
				if (!conf) { $(this).val(""); return; }
				ui.showLoading();
				ui.loadingProgress("Unpacking Enigma", "Reading package (this may take a moment for large games)...", {consoleOnly:false, mode:'consoleOutput'});
				await new Promise(function(r){ setTimeout(r, 50); }); // let the loading screen paint first
				var enigma = require("www/js/lib/enigmaUnpacker.js");
				var unpackResult;
				try {
					unpackResult = await enigma.unpack(from, to, function(done, total, ok, failed) {
						ui.loadingProgress("Unpacking Enigma", done+"/"+total+" files extracted ("+ok+" ok)", {consoleOnly:false, mode:'consoleOutput'});
					});
				} catch (err) {
					ui.loadingEnd("Failed", "Enigma unpack failed: "+(err && err.message ? err.message : err), {error:true});
					return;
				}
				await ui.log("EnigmaVB "+unpackResult.version+" unpacked: "+unpackResult.ok+"/"+unpackResult.total+" files, "+unpackResult.failed+" failed");
				var gameDir = enigma.findGameDir(to);
				var realType = await Engines.detect(gameDir);
				var devExecutable = nwPath.join(gameDir, "Game.exe");
				$slide.find(".detectedType").val(realType);
				$slide.find(".devLocationTypeWrapper").removeClass("hidden");
				$slide.find(".devLocationType").val(realType);
				$slide.find(".devLocationExeWrapper").removeClass("hidden");
				$slide.find(".devLocationExe").val(devExecutable);
				ui.hideLoading();
			}

			$slide.find(".createProjectFromRPGM").prop("disabled", false)
			
		});
		
		$slide.find(".createProjectFromRPGM").on("click", async function(e) {
			if ($(this).prop("disabled")) return;

			console.log("Creating a new project from RMRGSS addon");
			var master 	= $slide.find(".rpgMakerLocation").val();
			var devExe 	= $slide.find(".devLocationExe").val();
			
			var targetPath = devExe || master;
			var engineType = $slide.find(".devLocationType").val() ||  $slide.find(".detectedType").val(); // determined type

			ui.showLoading();
			ui.loadingProgress("Processing", "Creating a new project", {consoleOnly:false, mode:'consoleOutput'});
			await ui.log(`This window will look like it hangs. Open console log(F12) if you're using the dev version to see what's happening in the background.`);
			await ui.log("Target path:", targetPath);
			await ui.log("Engine type:", engineType);
			await ui.newProjectDialog.close();


			await common.benchmark(async ()=>{
				await engines.getEngine(engineType).triggerHandler("rmCreateProject", thisAddon, [targetPath]);
			})
			var pluginsPending = false;
			try {
				pluginsPending = Boolean(trans._pendingPluginLoad) && !trans.project.pluginIsFetched;
			} catch (e) {}
			if (pluginsPending) {
				await ui.log("Basic game data parsed. Parsing additional plugins, the project creation isn't done yet...");
			} else {
				ui.loadingProgress("Finished", "Done!", {consoleOnly:false, mode:'consoleOutput'});
				ui.loadingEnd("Done!");
			}
			return common.halt();
						
		});

		$slide.addClass("isInitialized");
	}
	
	$(document).on("newProjectSlideChange", async (e, slideInfo) => {
		if (slideInfo.id !== "rmrgss") return;
		initializeSlide(slideInfo.elm);
	});

}


function init() {
	var supportedEngines = ["rmxp", "rmvx", "rmvxace"];
	engines.addHandler(supportedEngines, "onLoadTrans", 
	() => {
		console.log("Executing onloadtrans");
		ui.translationByContext.dataLocation = "contextTranslation";
	});

	drawProjectCreator();

	engines.addHandler(supportedEngines, 'rmCreateProject', async function(targetPath) {
		await ui.log("Handling RGSS Based RPG Maker");
		await thisAddon.createProjectThread(targetPath);
	});

	engines.addHandler(supportedEngines, 'exportHandler', async function(targetPath, options) {
		if (trans.project.parser != "rmrgss") return;
	
		if (options.mode !== "dir" && options.mode !== "zip") return false;
		console.log("Export handler", arguments);

		ui.showLoading();
		ui.loadingProgress("Processing", "Export into : "+targetPath, {consoleOnly:false, mode:'consoleOutput'});
		await ui.log("Target directory:", targetPath);
		await ui.log("Options : ", options);
		await ui.log("Origin path is cache path");
		var originPath = nwPath.join(trans.project.cache.cachePath, "data");

		if (await await common.isDirectory(targetPath)) {
			await thisAddon.exportToFolderThread(targetPath, undefined, options);
		} else {
			await thisAddon.exportAsZip(targetPath, undefined, options);
		}
		ui.loadingProgress("Finished", "Done!", {consoleOnly:false, mode:'consoleOutput'});
		ui.loadingEnd();
		return common.halt();
	});
	
	engines.addHandler(supportedEngines, 'onLoadSnippet', async function(selectedCell) {
		var obj = trans.getSelectedObject();
		if (!obj) return;
		// fresh projects store 'yaml', imported .slrproj projects store '.yaml'
		var rmFileExt = String(obj.extension || "").replace(/^\./, "");
		if (rmFileExt == "yaml") return RMRAWVIEW.handleDataFile(this, selectedCell);
		if (obj.dataType == "ini") return RMRAWVIEW.handleIniFile(this, selectedCell);
		this.commonHandleFile(selectedCell, "ruby");
	});
}


$(document).ready(function() {
	ui.onReady(function() {
		init();
	});
});