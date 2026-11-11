var fs0 = require("fs"), path0 = require("path");
if (!fs0.existsSync(path0.join(global.FIXTURES, "mv"))) {
    console.log("SKIP test-rmmv-logic.js (fixtures/mv absent - see setup-fixtures.sh; fixtures are never committed)");
    return;
}

var fs = require("fs");
var path = require("path");
var MVRAW = require(path.join(global.LNX, "www/core/rmmv/rawview-logic.js"));

function json(name) {
    return fs.readFileSync(path.join(global.FIXTURES, "mv", name), "utf8");
}

test("walker finds nested DB field value", function () {
    var raw = json("Actors.json");
    var root = JSON.parse(raw);
    var pretty = JSON.stringify(root, undefined, 2);
    var hit = MVRAW.findSnippet(pretty, root, ["1", "name"]);
    eq(pretty.substring(hit.start, hit.end), "\"りきまる\"");
});

test("walker stops at synthetic message tail", function () {
    var raw = json("Map002.json");
    var root = JSON.parse(raw);
    var pretty = JSON.stringify(root, undefined, 2);
    var segs = ["events", "2", "pages", "0", "list", "0", "message", "noPicture", "bottom"];
    var hit = MVRAW.findSnippet(pretty, root, segs);
    eq(hit.consumed, 6);
    var arr = JSON.parse("[" + pretty.substring(hit.start, hit.end) + "]");
    eq(arr[0].code, 101);
});

test("message snippet extends through following 401 commands", function () {
    var raw = json("Map002.json");
    var root = JSON.parse(raw);
    var pretty = JSON.stringify(root, undefined, 2);
    var list = root.events[2].pages[0].list;
    var n = 1;
    while (list[n] && list[n].code == 401) n++;
    var segs = ["events", "2", "pages", "0", "list", "0", "message", "noPicture", "bottom"];
    var hit = MVRAW.findSnippet(pretty, root, segs);
    var block = pretty.substring(hit.start, hit.end);
    var arr = JSON.parse("[" + block + "]");
    eq(arr.length, n);
    eq(arr[0].code, 101);
    for (var q = 1; q < arr.length; q++) eq(arr[q].code, 401);
    assert(block.indexOf("～アリスきょうかい～") != -1, "contains first 401 text");
});

test("describe decodes MV map event metadata", function () {
    var root = JSON.parse(json("Map002.json"));
    var parsed = MVRAW.parseContext("Map002/events/2/pages/0/list/0/message/noPicture/bottom");
    var rows = MVRAW.describe(root, parsed, null);
    var flat = rows.map(x => x.label + "=" + x.value).join("; ");
    assert(flat.indexOf("Event 2") != -1, flat);
    assert(flat.indexOf("Code 101") != -1, flat);
    assert(flat.indexOf("bottom") != -1 && flat.indexOf("no picture") != -1, flat);
    assert(flat.indexOf("Command #") != -1, flat);
});

test("walker tolerates unknown tail segments on non-list nodes", function () {
    var root = JSON.parse(json("Map002.json"));
    var pretty = JSON.stringify(root, undefined, 2);
    var hit = MVRAW.findSnippet(pretty, root, ["displayName"]);
    eq(hit.consumed, 1);
});

test("findSnippet extends comment blocks (synthetic fixture)", function () {
    var root = [{ name: "CE", list: [
        { code: 108, indent: 0, parameters: ["note: original"] },
        { code: 408, indent: 0, parameters: ["line two"] },
        { code: 0, indent: 0, parameters: [] }
    ] }];
    var pretty = JSON.stringify(root, undefined, 2);
    var hit = MVRAW.findSnippet(pretty, root, ["0", "list", "0", "comment"]);
    var arr = JSON.parse("[" + pretty.substring(hit.start, hit.end) + "]");
    eq(arr.length, 2);
    eq(arr[0].code, 108);
    eq(arr[1].code, 408);
});

test("walker handles CommonEvents-shaped roots with null entries", function () {
    var root = [null, { name: "Intro", list: [
        { code: 101, indent: 0, parameters: ["", 0, 0, 2] },
        { code: 401, indent: 0, parameters: ["hello"] },
        { code: 0, indent: 0, parameters: [] }
    ] }];
    var pretty = JSON.stringify(root, undefined, 2);
    var hit = MVRAW.findSnippet(pretty, root, ["1", "list", "0", "message", "noPicture", "bottom"]);
    eq(hit.consumed, 3);
    var arr = JSON.parse("[" + pretty.substring(hit.start, hit.end) + "]");
    eq(arr.length, 2);
    eq(arr[0].code, 101);
    eq(arr[1].code, 401);
});

test("findSnippet extends scrollingMessage blocks (synthetic fixture)", function () {
    var root = [{ list: [
        { code: 105, indent: 0, parameters: [2, false] },
        { code: 405, indent: 0, parameters: ["line one"] },
        { code: 405, indent: 0, parameters: ["line two"] },
        { code: 0, indent: 0, parameters: [] }
    ] }];
    var pretty = JSON.stringify(root, undefined, 2);
    var hit = MVRAW.findSnippet(pretty, root, ["0", "list", "0", "scrollingMessage"]);
    var arr = JSON.parse("[" + pretty.substring(hit.start, hit.end) + "]");
    eq(arr.length, 3);
    eq(arr[0].code, 105);
    eq(arr[2].parameters[0], "line two");
});

test("walker terminates on truncated beautified text", function () {
    var root = JSON.parse(json("Map002.json"));
    var pretty = JSON.stringify(root, undefined, 2);
    var truncated = pretty.substring(0, Math.floor(pretty.length / 2));
    var hit = MVRAW.findSnippet(truncated, root, ["events", "2", "pages", "0", "list", "0", "message", "noPicture", "bottom"]);
    // must return (not hang) — range may be shallow/whatever, just no infinite loop
    assert(hit && typeof hit.start == "number", "returned a hit without hanging");
});
