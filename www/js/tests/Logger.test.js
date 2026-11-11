"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const nwPath = require("path");
const Logger = require("../Logger.js");

// The shutdown compression deletes the log after archiving it, but the debounced pool
// writer may still fire afterwards. With an empty pool it used to append a lone newline,
// recreating the file as a 1-byte stub that later rotated into an "almost empty" session
// archive. An empty pool must write nothing.
test("an empty pool write does not recreate a deleted log file", async () => {
	const dir = fs.mkdtempSync(nwPath.join(os.tmpdir(), "slrlog-"));
	const file = nwPath.join(dir, "trans.log");
	try {
		const logger = new Logger({ file: file });
		logger.log("session line");
		await logger.flushLogs();
		assert.strictEqual(fs.existsSync(file), true, "flushed line must be on disk");

		// The compression step deletes the log after archiving it.
		fs.unlinkSync(file);

		// Let the pending debounce (300 ms) fire after the deletion.
		await new Promise(function (r) { setTimeout(r, 450); });

		assert.strictEqual(fs.existsSync(file), false,
			"the empty-pool debounce write must not recreate the file");
	} finally {
		try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
	}
});

// Non-empty pool writes must keep working exactly as before.
test("a non-empty pool write appends to the log file", async () => {
	const dir = fs.mkdtempSync(nwPath.join(os.tmpdir(), "slrlog-"));
	const file = nwPath.join(dir, "trans.log");
	try {
		const logger = new Logger({ file: file });
		logger.log("first");
		await logger.flushLogs();
		const content = fs.readFileSync(file, "utf8");
		assert.ok(content.indexOf("first") !== -1, "the line must be written");
		assert.ok(content.endsWith("\n"), "the write must end at a line boundary");
	} finally {
		try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
	}
});

// The quit path logs one final trace ("closing main window") AFTER compressLogs
// has already deleted the log file. If a lingering child window (the docs
// viewer, which lives outside ui.windows) keeps the process alive, that line's
// 300ms debounce recreates the deleted file as a stub that later rotates into
// an "almost empty" session archive. A sealed logger must drop such lines.
test("a sealed logger drops lines instead of recreating the deleted log", async () => {
	const dir = fs.mkdtempSync(nwPath.join(os.tmpdir(), "slrlog-"));
	const file = nwPath.join(dir, "trans.log");
	try {
		const logger = new Logger({ file: file });
		logger.log("session line");
		await logger.flushLogs();
		assert.strictEqual(fs.existsSync(file), true);

		// Shutdown compression archived and deleted the log; the quit path
		// seals the logger, then logs its final trace.
		fs.unlinkSync(file);
		logger.sealed = true;
		logger.log("[quit] closing main window");

		await new Promise(function (r) { setTimeout(r, 450); });
		assert.strictEqual(fs.existsSync(file), false,
			"a sealed logger must not recreate the deleted log file");
	} finally {
		try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
	}
});
