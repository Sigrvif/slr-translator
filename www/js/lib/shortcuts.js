// windows-shortcuts wrapper that is safe to load on non-Windows platforms.
// On Windows it proxies the real "windows-shortcuts" module; elsewhere it
// exposes a no-op stub with a compatible shape so callers don't crash.
"use strict";

var IS_WIN = (process.platform === "win32");

function stub(err) {
	var e = err || new Error("windows-shortcuts is only available on Windows");
	function noop() {}
	function noopCb() { return function (cb) { if (typeof cb === "function") cb(e); }; }
	return {
		create: function (path, options, cb) { if (typeof options === "function") { options(e); } else if (typeof cb === "function") { cb(e); } },
		edit: function (path, options, cb) { if (typeof cb === "function") cb(e); },
		query: function (path, cb) { if (typeof cb === "function") cb(e); },
		exists: noop
	};
}

if (IS_WIN) {
	try {
		module.exports = require("windows-shortcuts");
	} catch (e) {
		module.exports = stub(e);
	}
} else {
	module.exports = stub();
}
