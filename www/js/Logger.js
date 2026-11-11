const fs = require("graceful-fs");
const nwPath = require("path");
const debounce = require("debounce");

// Redirects log events to a file or an in-memory array.
class Logger {
	constructor(options = {}) {
		this.options = options || {};
		this.file = options.file || undefined;
		this.output = [];
		this.baseStack = this.baseStack || 3;
		this.configKey = options.configKey || "Logger";
		this.config = options.config || {};
		this.groupDepth = 0;
		this.loadConfig();
		if (this.options.truncate) this.truncate();
	}
}

global.__LoggerPooler ||= {};

Logger.getFilePool = function (file) {
	global.__LoggerPooler[file] ||= [];
	return global.__LoggerPooler[file];
};
Logger.resetFilePool = function (file) {
	if (!file) return;
	if (!global.__LoggerPooler[file]) return;
	global.__LoggerPooler[file] = [];
};
Logger.appendFilePool = function (file, msg) {
	if (!file) return;
	global.__LoggerPooler[file] ||= [];
	global.__LoggerPooler[file].push(msg);
	return global.__LoggerPooler[file];
};
Logger.consumeFilePool = function (file) {
	if (!file) return;
	const pool = this.getFilePool(file);
	global.__LoggerPooler[file] = [];
	return pool;
};

Logger.prototype.saveConfig = function () {
	this.config = this.config || {};
	localStorage.setItem(this.configKey, JSON.stringify(this.config));
};

Logger.prototype.loadConfig = function () {
	try {
		this.config = JSON.parse(localStorage.getItem(this.configKey));
	} catch (e) {
		this.config = {};
	}
	return this.config;
};

Logger.prototype.setConfig = function (key, value) {
	this.config = this.config || {};
	this.config[key] = value;
	this.saveConfig();
};

Logger.prototype.unsetConfig = function (key, value) {
	this.config = this.config || {};
	delete this.config[key];
	this.saveConfig();
};

Logger.prototype.getConfig = function (key, defaultValue) {
	this.config = this.config || {};
	if (this.config[key] === undefined) return defaultValue;
	return this.config[key];
};

Logger.prototype.getCallerInfo = function () {
	var err = new Error();
	var stack = err.stack.split("\n");
	if (!stack[this.baseStack]) return "";
	if (stack[this.baseStack].includes("    at chrome-extension")) {
		stack[this.baseStack] = stack[this.baseStack].replace("    at ", "");
		return nwPath.basename(stack[this.baseStack]);
	}

	var match = stack[this.baseStack].match(/\((.*?)\)/);
	if (!match) return stack[this.baseStack];
	if (!match[1]) return stack[this.baseStack];

	return nwPath.basename(match[1]);
};

Logger.prototype.getStackCall = function () {
	var err = new Error();
	var stackStr = err.stack;
	var stack = stackStr.split("\n").slice(this.baseStack);
	return "\t" + stack.join("\n\t");
};

Logger.prototype.argumentsToArray = function (args) {
	args = Array.prototype.slice.call(args);
	return args;
};

Logger.prototype.stringifyValue = function (value) {
	if (value instanceof Error) {
		return value.stack || (value.name + ": " + value.message);
	}
	if (typeof value === "object" && value !== null) {
		try {
			return JSON.stringify(value, null, 2);
		} catch (e) {
			try {
				return String(value);
			} catch (e2) {
				return "[unserializable object]";
			}
		}
	}
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	return String(value);
};

Logger.prototype.formatArgs = function (args) {
	args = this.argumentsToArray(args);
	if (args.length === 0) return "";
	var first = args[0];
	if (typeof first !== "string") {
		return args.map(this.stringifyValue, this).join(" ");
	}
	var rest = args.slice(1);
	var result = "";
	var i = 0;
	var a = 0;
	while (i < first.length) {
		if (first[i] === "%" && i + 1 < first.length) {
			var spec = first[i + 1];
			if (spec === "c") {
				if (a < rest.length) a++;
				i += 2;
				continue;
			} else if (spec === "s") {
				result += a < rest.length ? String(rest[a++]) : "%s";
				i += 2;
				continue;
			} else if (spec === "d" || spec === "i") {
				result += a < rest.length ? parseInt(rest[a++], 10) : "%" + spec;
				i += 2;
				continue;
			} else if (spec === "f") {
				result += a < rest.length ? parseFloat(rest[a++]) : "%f";
				i += 2;
				continue;
			} else if (spec === "o" || spec === "O") {
				result += a < rest.length ? this.stringifyValue(rest[a++]) : "%" + spec;
				i += 2;
				continue;
			} else if (spec === "%") {
				result += "%";
				i += 2;
				continue;
			}
		}
		result += first[i];
		i++;
	}
	if (a < rest.length) {
		var extra = rest.slice(a).map(this.stringifyValue, this).join(" ");
		result += (result ? " " : "") + extra;
	}
	return result;
};

Logger.prototype.getIndent = function () {
	if (!this.groupDepth || this.groupDepth <= 0) return "";
	var indent = "";
	for (var i = 0; i < this.groupDepth; i++) indent += "\u2502   ";
	return indent;
};

Logger.prototype.openGroup = function (args, collapsed) {
	var title = this.formatArgs(args);
	if (!title) title = collapsed ? "(collapsed group)" : "(group)";
	this.writeLog(this.getIndent() + "[GROUP\u25BC]\t" + title);
	this.groupDepth = (this.groupDepth || 0) + 1;
};

Logger.prototype.closeGroup = function () {
	if (this.groupDepth && this.groupDepth > 0) this.groupDepth--;
	this.writeLog(this.getIndent() + "[GROUP\u25B2]");
};

Logger.prototype.getOutput = function () {
	return this.output;
};

Logger.prototype.rotateSessions = function (file, keepTotal) {
	file = file || this.file;
	if (!file) return;
	keepTotal = keepTotal || this.getConfig("keepSessions") || 3;
	if (keepTotal < 1) keepTotal = 1;
	var backups = keepTotal - 1;
	if (backups >= 1) {
		try { fs.unlinkSync(file + "." + backups); } catch (e) {}
	}
	for (var i = backups - 1; i >= 1; i--) {
		try { fs.renameSync(file + "." + i, file + "." + (i + 1)); } catch (e) {}
	}
	if (backups >= 1) {
		try { fs.renameSync(file, file + ".1"); } catch (e) {}
	}
};

Logger.prototype.truncate = function (file) {
	file = file || this.file;
	if (!file) {
		if (!this.output) return;
		this.output = [];
		return;
	}
	this.rotateSessions(file);
	Logger.resetFilePool(file);
	try {
		fs.writeFileSync(file, "Log started at: " + Date() + "\n");
	} catch (e) {}
};

const writePoolToFile = async function (file) {
	let pool = Logger.consumeFilePool(file);
	// An empty pool must write nothing: the trailing-partial-line convention used to make
	// this append a lone newline, which recreated the log file as a 1-byte stub after the
	// shutdown compression had deleted it (the debounce firing after flushLogs). That stub
	// then rotated into an "almost empty" session archive at the next start.
	if (!pool || !pool.length) return;
	await fs.promises.writeFile(file, pool.join("\n") + "\n", { flag: "a" });
};

const debouncedWriteToFile = debounce((file) => writePoolToFile(file), 300);

Logger.prototype.writeLog = async function (msg, file) {
	// Sealed after the shutdown compression archived and deleted the log: any
	// line logged afterwards (the quit path's final trace) must be dropped,
	// not buffered — its debounced write would recreate the deleted file as a
	// stub whenever a lingering child window keeps the process alive.
	if (this.sealed) return;
	file = file || this.file;
	if (!file) {
		if (!Array.isArray(this.output)) return;
		this.output.push(msg);
		return;
	}
	Logger.appendFilePool(file, msg + "");
	debouncedWriteToFile(file);
};

Logger.prototype.log = async function () {
	var lineInfo = this.getCallerInfo();
	var msg = "[INFO]\t" + this.getIndent() + this.formatArgs(arguments) + "\t-->" + lineInfo;
	this.writeLog(msg);
};

Logger.prototype.warn = async function () {
	var lineInfo = this.getCallerInfo();
	var msg = "[WARN]\t" + this.getIndent() + this.formatArgs(arguments) + "\t-->" + lineInfo;
	this.writeLog(msg);
	this.writeLog(this.getIndent() + this.getStackCall());
};

Logger.prototype.error = async function () {
	if (typeof arguments[4] == "object") {
		try {
			if (arguments[4].stack) {
				var msg = "[ERROR]\t" + this.getIndent() + arguments[4].message + ` at ${arguments[1]} ${arguments[2]}:${arguments[3]}`;
				this.writeLog(msg);
				this.writeLog(this.getIndent() + "\t" + arguments[4].stack.split("\n").join("\n\t"));
				return;
			}
		} catch (e) {
		}
	}
	var lineInfo = this.getCallerInfo();
	var msg = "[ERROR]\t" + this.getIndent() + this.formatArgs(arguments) + "\t-->" + lineInfo;
	this.writeLog(msg);
	this.writeLog(this.getIndent() + this.getStackCall());
};

Logger.prototype.debug = async function () {
	var lineInfo = this.getCallerInfo();
	var msg = "[DEBUG]\t" + this.getIndent() + this.formatArgs(arguments) + "\t-->" + lineInfo;
	this.writeLog(msg);
};

Logger.prototype.trace = async function () {
	var lineInfo = this.getCallerInfo();
	var msg = "[TRACE]\t" + this.getIndent() + this.formatArgs(arguments) + "\t-->" + lineInfo;
	this.writeLog(msg);
	this.writeLog(this.getIndent() + this.getStackCall());
};

Logger.prototype.replaceConsole = function () {
	if (this.consoleIsReplaced) return;
	this.baseStack = 4;
	this.groupDepth = 0;
	this.forwardToConsole = true;
	var that = this;
	this.consoleLog = console.log;
	this.consoleInfo = console.info;
	this.consoleDebug = console.debug;
	this.consoleWarn = console.warn;
	this.consoleError = console.error;
	this.consoleTrace = console.trace;
	this.consoleGroup = console.group;
	this.consoleGroupCollapsed = console.groupCollapsed;
	this.consoleGroupEnd = console.groupEnd;

	console.log = function () { that.log.apply(that, arguments); if (that.forwardToConsole) that.consoleLog.apply(console, arguments); };
	console.info = function () { that.log.apply(that, arguments); if (that.forwardToConsole) that.consoleInfo.apply(console, arguments); };
	console.debug = function () { that.debug.apply(that, arguments); if (that.forwardToConsole) that.consoleDebug.apply(console, arguments); };
	console.warn = function () { that.warn.apply(that, arguments); if (that.forwardToConsole) that.consoleWarn.apply(console, arguments); };
	console.error = function () { that.error.apply(that, arguments); if (that.forwardToConsole) that.consoleError.apply(console, arguments); };
	console.trace = function () { that.trace.apply(that, arguments); if (that.forwardToConsole) that.consoleTrace.apply(console, arguments); };
	console.group = function () { that.openGroup(arguments, false); if (that.forwardToConsole) that.consoleGroup.apply(console, arguments); };
	console.groupCollapsed = function () { that.openGroup(arguments, true); if (that.forwardToConsole) that.consoleGroupCollapsed.apply(console, arguments); };
	console.groupEnd = function () { that.closeGroup(); if (that.forwardToConsole) that.consoleGroupEnd.apply(console, arguments); };

	window.onerror = function (message, file, line, col, error) {
		that.error.apply(that, arguments);
		that.consoleError("Error Occured:", arguments);
		return false;
	};
	window.addEventListener("error", function (e) {
		that.error.apply(that, [e.error.message]);
		that.consoleError("Error", e.error.message, e);
		return false;
	});
	window.addEventListener("unhandledrejection", function (e) {
		that.error.apply(that, [e.reason.message]);
		that.consoleError("Unhandled rejection: " + e.reason.message);
	});

	this.consoleIsReplaced = true;
};

Logger.prototype.restoreConsole = function () {
	console.log = this.consoleLog;
	console.info = this.consoleInfo;
	console.debug = this.consoleDebug;
	console.warn = this.consoleWarn;
	console.error = this.consoleError;
	console.trace = this.consoleTrace;
	if (this.consoleGroup !== undefined) console.group = this.consoleGroup;
	if (this.consoleGroupCollapsed !== undefined) console.groupCollapsed = this.consoleGroupCollapsed;
	if (this.consoleGroupEnd !== undefined) console.groupEnd = this.consoleGroupEnd;
	this.consoleIsReplaced = false;
};

Logger.prototype.loadState = function (force) {
	try {
		var loggingEnabled = this.getConfig("replaceConsole", nw.App.manifest.localConfig.logToFile === true);
		if (force || loggingEnabled) {
			this.replaceConsole();
		}
		if (loggingEnabled && this.getConfig("truncate", true)) {
			this.truncate();
		}
	} catch (e) {
		// do nothing
	}
};

Logger.prototype.flushLogs = async function () {
	var pool = global.__LoggerPooler || {};
	for (var file in pool) {
		if (pool[file] && pool[file].length > 0) {
			try { await writePoolToFile(file); } catch (e) {}
		}
	}
};

// Runs 7z to add `srcPath` into `archivePath` while reporting percent progress.
// Spawns the bundled 7za binary directly (with -bsp1) so we can parse the percent
// output it streams to stdout/stderr. Falls back to 7zip-min's cmd() (no progress)
// when the binary cannot be spawned. Resolves to true on success, false otherwise.
Logger.prototype._run7zWithProgress = function (archivePath, srcPath, onPercent, _7zFallback) {
	return new Promise(function (resolve) {
		var path7za;
		try { path7za = require("7zip-bin").path7za; } catch (e) {}

		var fallback = function () {
			if (_7zFallback && _7zFallback.cmd) {
				_7zFallback.cmd(["a", "-t7z", "-mx=5", archivePath, srcPath], function (err) {
					if (onPercent) { try { onPercent(100); } catch (e2) {} }
					resolve(!err);
				});
			} else {
				resolve(false);
			}
		};

		if (!path7za) { fallback(); return; }

		var child;
		try {
			child = require("child_process").spawn(path7za, ["a", "-t7z", "-mx=5", "-bsp1", "-y", archivePath, srcPath], { windowsHide: true });
		} catch (e) {
			fallback();
			return;
		}

		var lastPercent = -1;
		var sawPercent = false;
		var scan = function (data) {
			if (!onPercent) return;
			var str = "";
			try { str = data.toString(); } catch (e) { return; }
			// 7za emits "<percent>%" tokens (separated by spaces when piped, or by
			// carriage returns when writing to a terminal) as it compresses.
			var matches = str.match(/(\d+)%/g);
			if (!matches) return;
			sawPercent = true;
			for (var k = 0; k < matches.length; k++) {
				var p = parseInt(matches[k], 10);
				if (!isNaN(p) && p >= 0 && p <= 100 && p > lastPercent) {
					lastPercent = p;
					try { onPercent(p); } catch (e) {}
				}
			}
		};

		child.stdout.on("data", scan);
		child.stderr.on("data", scan);
		child.on("error", function () { fallback(); });
		child.on("exit", function (code) {
			// Small files finish without emitting any percent line; jump to 100.
			if (onPercent && (!sawPercent || lastPercent < 100)) {
				try { onPercent(100); } catch (e) {}
			}
			resolve(code === 0);
		});
	});
};

Logger.prototype._compressLogFile = async function (file, _7z, keepTotal, onProgress) {
	var backups = keepTotal - 1;
	if (backups < 0) backups = 0;

	// Enumerate the sources that will actually be compressed so we can report
	// accurate (done/total) progress. The order is preserved exactly from the
	// original implementation: backup logs first, then the current log file.
	// Anything under this size is not a session: a flush artifact stub or a stray
	// newline. Such a file is dropped instead of being archived as an empty session.
	var emptyLogSize = function (path) {
		try { return fs.statSync(path).size < 32; } catch (e) { return false; }
	};

	var backupSources = [];
	for (var j = backups; j >= 1; j--) {
		var rotated = file + "." + j;
		if (!fs.existsSync(rotated)) continue;
		if (emptyLogSize(rotated)) {
			try { fs.unlinkSync(rotated); } catch (e) {}
			continue;
		}
		backupSources.push(rotated);
	}
	var currentSource = fs.existsSync(file) ? file : null;
	if (currentSource && emptyLogSize(file)) {
		try { fs.unlinkSync(file); } catch (e) {}
		currentSource = null;
	}

	var total = backupSources.length + (currentSource ? 1 : 0);
	var done = 0;
	var that = this;

	var report = function (label, percent) {
		if (onProgress) onProgress({ done: done, total: total, current: label, percent: percent });
	};

	// Phase 1: compress existing plain backup logs into .7z and drop the originals.
	for (var s = 0; s < backupSources.length; s++) {
		var src = backupSources[s];
		var label = nwPath.basename(src);
		report(label, 0);
		var ok = await that._run7zWithProgress(src + ".7z", src, function (p) { report(label, p); }, _7z);
		if (ok) {
			try { fs.unlinkSync(src); } catch (e) {}
		}
		done++;
		// Note: no extra report here. _run7zWithProgress already reports 100% via
		// its exit handler; reporting again with the incremented `done` would
		// double-count the finished file and make overall progress non-monotonic.
	}

	// Phase 2: rotate the existing .7z archives (fast filesystem ops, no progress).
	if (backups >= 1) {
		try { fs.unlinkSync(file + "." + backups + ".7z"); } catch (e) {}
	}
	for (var i = backups - 1; i >= 1; i--) {
		try { fs.renameSync(file + "." + i + ".7z", file + "." + (i + 1) + ".7z"); } catch (e) {}
	}
	if (backups >= 1) {
		try { fs.renameSync(file + ".7z", file + ".1.7z"); } catch (e) {}
	}

	// Phase 3: compress the current log file.
	if (currentSource) {
		var label = nwPath.basename(file);
		report(label, 0);
		var ok = await that._run7zWithProgress(file + ".7z", file, function (p) { report(label, p); }, _7z);
		if (ok) {
			try { fs.unlinkSync(file); } catch (e) {}
		}
		done++;
	}
};

Logger.prototype.compressLogs = async function (onProgress) {
	var file = this.file;
	if (!file) return;

	var _7z;
	try { _7z = require("7zip-min"); } catch (e) { return; }

	var keepTotal = this.getConfig("keepSessions") || 3;
	if (keepTotal < 1) keepTotal = 1;

	var logsDir = nwPath.dirname(file);
	var logBases = {};
	logBases[file] = true;

	if (fs.existsSync(logsDir)) {
		try {
			var entries = fs.readdirSync(logsDir);
			for (var e = 0; e < entries.length; e++) {
				var entry = entries[e];
				if (entry.endsWith(".7z")) continue;
				var match = entry.match(/^(.+\.log)(?:\.\d+)?$/);
				if (!match) continue;
				logBases[nwPath.join(logsDir, match[1])] = true;
			}
		} catch (e) {}
	}

	var bases = Object.keys(logBases);
	var basesTotal = bases.length;
	var basesDone = 0;
	var that = this;

	if (onProgress) onProgress({
		phase: "start", basesDone: 0, basesTotal: basesTotal,
		filesDone: 0, filesTotal: 0, current: "", percent: 0, overall: 0
	});

	for (var b = 0; b < bases.length; b++) {
		var base = bases[b];
		var baseIndex = basesDone;
		try {
			await that._compressLogFile(base, _7z, keepTotal, function (info) {
				if (!onProgress) return;
				// Map this base's internal (done/total, percent) into an overall
				// percentage across all log bases so the UI shows one smooth bar.
				var withinFraction = info.total > 0 ? (info.done + info.percent / 100) / info.total : 1;
				var overall = basesTotal > 0
					? Math.min(100, Math.round(((baseIndex + withinFraction) / basesTotal) * 100))
					: 100;
				onProgress({
					phase: "compressing",
					basesDone: baseIndex,
					basesTotal: basesTotal,
					filesDone: info.done,
					filesTotal: info.total,
					current: info.current,
					percent: info.percent,
					overall: overall
				});
			});
		} catch (e) {}
		basesDone++;
	}

	if (onProgress) onProgress({
		phase: "done", basesDone: basesDone, basesTotal: basesTotal,
		filesDone: 0, filesTotal: 0, current: "", percent: 100, overall: 100
	});
};

module.exports = Logger;
