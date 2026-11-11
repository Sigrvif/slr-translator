"use strict";
/**
 * fileAssoc.js — file-extension association for SLR, cross-platform.
 *
 * Windows: registers extensions (.slrproj / .json) via the standard registry
 * entries; elevation (UAC) is delegated to "windows-elevate".
 *
 * Linux: installs a .desktop entry + custom MIME types and registers them as
 * the default handler through xdg-mime (the desktop-standard equivalent of
 * the Windows registry FileExts/Classes keys).
 *
 * Public API (unchanged from the original module):
 *   new Association(extensions, { iconIndex, defaultIconIndex })
 *   .getAssociation()            -> { ext: boolean } for each managed extension
 *   .setExtension(desiredArray)  -> associate the given extensions, unassociate the rest
 */

var fs = require("fs");
var nwPath = require("path");
var child_process = require("child_process");

var IS_WIN = (process.platform === "win32");
var IS_LINUX = (process.platform === "linux");

/* ------------------------------------------------------------------ Windows */

function exeBaseName() {
	return nw.process.execPath.replace(/^.*[\\\/]/, "");
}

function regAdd(key, name, type, value) {
	var escaped = String(value).replace(/"/g, '\\"');
	var namePart = name ? ' /v "' + name + '"' : " /ve";
	return 'REG ADD "' + key + '"' + namePart + " /t " + type + ' /d "' + escaped + '" /f';
}

function regDelete(key) {
	return 'REG DELETE "' + key + '" /f';
}

/* -------------------------------------------------------------------- Linux */

function homeDataDir() {
	var home = nw.process.env.HOME || nw.process.env.HOMEPATH || ".";
	return nwPath.join(home, ".local", "share", "applications");
}

function desktopFilePath() {
	return nwPath.join(homeDataDir(), "slr-translator.desktop");
}

function launcherPath() {
	// nw.process.execPath is the bundled "nw" binary, which lives next to the
	// launcher script. Prefer the .sh launcher so paths/env are set up.
	var dir = nwPath.dirname(nw.process.execPath);
	var sh = nwPath.join(dir, "SLR Translator.sh");
	try { if (fs.existsSync(sh)) return sh; } catch (e) {}
	return nw.process.execPath;
}

function ensureDesktopFile(self) {
	try {
		var dir = homeDataDir();
		fs.mkdirSync(dir, { recursive: true });
		var appDir = nwPath.dirname(nw.process.execPath);
		var icon = nwPath.join(appDir, "icon.png");
		var content = [
			"[Desktop Entry]",
			"Type=Application",
			"Name=SLR Translator",
			"Comment=RPG Maker translation tool",
			'Exec="' + launcherPath() + '" %f',
			"Terminal=false",
			"Categories=Utility;Translation;",
			"MimeType=" + self.extensions.map(function (e) { return "application/x-" + e; }).join(";") + ";"
		];
		if (fs.existsSync(icon)) content.push('Icon=' + icon);
		fs.writeFileSync(desktopFilePath(), content.join("\n") + "\n");
		child_process.exec('update-desktop-database "' + dir + '"', function () {});
		return true;
	} catch (e) {
		console.error("fileAssoc: could not write .desktop file", e);
		return false;
	}
}

function installMimeForExt(ext) {
	// Register a custom MIME type for the extension via xdg-mime.
	var mime = "application/x-" + ext;
	var xml =
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">\n' +
		'  <mime-type type="' + mime + '">\n' +
		'    <comment>SLR Translator project (' + ext + ')</comment>\n' +
		'    <glob pattern="*.' + ext + '"/>\n' +
		'  </mime-type>\n' +
		'</mime-info>\n';
	var tmp = nwPath.join(nw.process.env.TMPDIR || "/tmp", "slr-" + ext + ".xml");
	try {
		fs.writeFileSync(tmp, xml);
		child_process.exec('xdg-mime install --mode user "' + tmp + '"', function () {});
		child_process.exec('xdg-mime default slr-translator.desktop ' + mime, function () {});
	} catch (e) {
		console.error("fileAssoc: xdg-mime failed for ." + ext, e);
	}
}

function removeMimeForExt(ext) {
	var mime = "application/x-" + ext;
	// Best-effort: drop the user default for this mime type.
	try {
		child_process.exec('xdg-mime undefault slr-translator.desktop ' + mime, function () {});
	} catch (e) {}
}

/* ----------------------------------------------------------------- Common */

function Association(extensions, options) {
	options = options || {};
	if (!Array.isArray(extensions)) extensions = [extensions];
	this.extensions = extensions;
	this.iconIndex = options.iconIndex || {};
	this.defaultIconIndex = options.defaultIconIndex || 0;
	this.pauseAfter = true;
}

Association.prototype.iconFor = function (ext) {
	var idx = this.iconIndex[ext];
	return (typeof idx === "number") ? idx : this.defaultIconIndex;
};

Association.prototype.hasAssociation = function (ext) {
	if (typeof ext !== "string") return false;
	if (IS_WIN) {
		var key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\." + ext;
		try {
			var out = child_process.execSync('REG QUERY "' + key + '" /v Application').toString();
		} catch (e) {
			return false;
		}
		return out.indexOf(exeBaseName()) !== -1;
	}
	// On Linux, query the user default application for the mime type.
	try {
		var mime = "application/x-" + ext;
		var out2 = child_process.execSync('xdg-mime query default ' + mime).toString().trim();
		return out2 === "slr-translator.desktop";
	} catch (e) {
		return false;
	}
};

Association.prototype.getAssociation = function (extensions) {
	extensions = extensions || this.extensions;
	if (!Array.isArray(extensions)) extensions = [extensions];
	var result = {};
	for (var i = 0; i < extensions.length; i++) {
		result[extensions[i]] = this.hasAssociation(extensions[i]);
	}
	return result;
};

Association.prototype.assignLines = function (ext) {
	var app = nw.process.execPath;
	var exe = exeBaseName();
	var file = ext + "File";
	var icon = app + "," + this.iconFor(ext);
	var open = '"' + app + '" "%1"';
	var fileExts = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\." + ext;
	var lines = [];
	lines.push(regAdd(fileExts, "Application", "REG_SZ", exe));
	lines.push(regAdd(fileExts + "\\OpenWithList", "a", "REG_SZ", exe));
	lines.push(regAdd(fileExts + "\\OpenWithList", "MRUList", "REG_SZ", "a"));
	lines.push(regAdd("HKCR\\." + ext, null, "REG_SZ", file));
	lines.push(regAdd("HKCR\\" + file + "\\DefaultIcon", null, "REG_EXPAND_SZ", icon));
	lines.push(regAdd("HKCR\\" + file + "\\shell\\open\\command", null, "REG_SZ", open));
	lines.push(regAdd("HKCU\\Software\\Classes\\." + ext, null, "REG_SZ", file));
	lines.push(regAdd("HKCU\\Software\\Classes\\" + file + "\\DefaultIcon", null, "REG_EXPAND_SZ", icon));
	lines.push(regAdd("HKCU\\Software\\Classes\\" + file + "\\shell\\open\\command", null, "REG_SZ", open));
	lines.push(regAdd("HKCR\\Applications\\" + exe + "\\shell\\open\\command", null, "REG_SZ", open));
	lines.push(regAdd("HKCU\\Software\\Classes\\Applications\\" + exe + "\\shell\\open\\command", null, "REG_SZ", open));
	return lines;
};

Association.prototype.unassignLines = function (ext) {
	var file = ext + "File";
	var fileExts = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\." + ext;
	var lines = [];
	lines.push(regDelete(fileExts));
	lines.push(regDelete("HKCR\\." + ext));
	lines.push(regDelete("HKCR\\" + file));
	lines.push(regDelete("HKCU\\Software\\Classes\\." + ext));
	lines.push(regDelete("HKCU\\Software\\Classes\\" + file));
	return lines;
};

Association.prototype.runBatch = function (batch, elevated) {
	var tmp = (nw.process.env.TMP || nw.process.env.TEMP || nw.process.env.APPDATA) + "\\slr_associate.bat";
	fs.writeFileSync(tmp, batch);
	if (elevated) {
		try {
			require("windows-elevate").exec(tmp, "", function (err) {
				if (err) console.error("file association: elevated run failed", err);
			});
		} catch (e) {
			console.error("file association: windows-elevate unavailable", e);
		}
	} else {
		try {
			child_process.execSync('"' + tmp + '"');
		} catch (e) {
			return false;
		}
	}
	return tmp;
};

Association.prototype.setExtension = function (desired) {
	if (!Array.isArray(desired)) desired = [desired];

	if (IS_LINUX) {
		// Linux: .desktop entry + xdg-mime per extension.
		ensureDesktopFile(this);
		var want = {};
		for (var d = 0; d < desired.length; d++) want[desired[d]] = true;
		for (var j = 0; j < this.extensions.length; j++) {
			var ext = this.extensions[j];
			if (want[ext]) installMimeForExt(String(ext).toLowerCase());
			else removeMimeForExt(String(ext).toLowerCase());
		}
		return "";
	}

	if (!IS_WIN) {
		console.log("file association is not supported on this platform");
		return "";
	}

	// Windows registry path.
	var wantW = {};
	for (var i = 0; i < desired.length; i++) wantW[desired[i]] = true;
	var lines = [];
	for (var k = 0; k < this.extensions.length; k++) {
		var e = this.extensions[k];
		if (!wantW[e]) lines = lines.concat(this.unassignLines(e));
	}
	for (var m = 0; m < desired.length; m++) {
		if (desired[m]) lines = lines.concat(this.assignLines(String(desired[m]).toLowerCase()));
	}

	if (lines.length === 0) return "";
	lines.push("ie4uinit.exe -ClearIconCache");
	lines.push("ie4uinit.exe -show");
	if (this.pauseAfter) lines.push("pause");

	var batch = lines.join("\r\n");
	this.runBatch(batch, true);
	return batch;
};

module.exports = Association;
