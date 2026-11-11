#!/usr/bin/env node
// Unit tests for Raw tab viewer logic. Run:  node dev/rawview-tests/run_tests.js
// Discovers test files test-*.js in this directory.
var fs = require("fs");
var path = require("path");

global.LNX = path.resolve(__dirname, "..", "..");
global.FIXTURES = path.join(__dirname, "fixtures");

global.testCount = 0;
global.failCount = 0;
global.test = function (name, fn) {
    global.testCount++;
    try {
        fn();
        console.log("PASS " + name);
    } catch (e) {
        global.failCount++;
        console.log("FAIL " + name + " :: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    }
};
global.assert = function (cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); };
global.eq = function (a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + ": " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
};

var files = fs.readdirSync(__dirname).filter(f => /^test-.*\.js$/.test(f)).sort();
if (files.length == 0) {
    console.log("No test files found (test-*.js). Nothing to do.");
    process.exit(0);
}
for (var f of files) require(path.join(__dirname, f));

console.log("\n" + (global.testCount - global.failCount) + "/" + global.testCount + " passed");
if (global.failCount > 0) process.exit(1);
