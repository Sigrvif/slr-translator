var fs0 = require("fs"), path0 = require("path");
if (!fs0.existsSync(path0.join(global.FIXTURES, "vxace"))) {
    console.log("SKIP test-rmrgss-logic.js (fixtures/vxace absent - see setup-fixtures.sh; fixtures are never committed)");
    return;
}

var fs = require("fs");
var path = require("path");
var RMRAW = require(path.join(global.LNX, "www/core/rmrgss/rmrgss.rawview.logic.js"));

function yaml(name) {
    return fs.readFileSync(path.join(global.FIXTURES, "vxace", name), "utf8");
}

test("parseContext splits fileName / segments", function () {
    var p = RMRAW.parseContext("Map003/events/3/pages/0/list/1/message/noPicture/bottom");
    eq(p.fileName, "Map003");
    eq(p.segments.length, 9);
    eq(p.segments[0], "events");
});

test("resolveNode walks map event context to the 101 command", function () {
    var doc = RMRAW.parseDocument(yaml("Map003.yaml"));
    var r = RMRAW.resolveNode(doc, ["events", "3", "pages", "0", "list", "1", "message", "noPicture", "bottom"]);
    eq(r.consumed, 6);
    eq(JSON.stringify(r.path), JSON.stringify(["events", 3, "pages", 0, "list", 1]));
    eq(RMRAW.commandCode(r.node), 101);
    eq(r.tail[0], "message");
});

test("resolveNode resolves plain DB field fully", function () {
    var doc = RMRAW.parseDocument(yaml("Actors.yaml"));
    var r = RMRAW.resolveNode(doc, ["1", "description"]);
    eq(r.consumed, 2);
    eq(r.tail.length, 0);
    assert(r.node.value.indexOf("マルク帝国軍の新任技術将校") === 0, "description value: " + r.node.value);
});

test("computeHighlight marks the message text", function () {
    var text = yaml("Map003.yaml");
    var doc = RMRAW.parseDocument(text);
    var r = RMRAW.resolveNode(doc, ["events", "3", "pages", "0", "list", "1", "message", "noPicture", "bottom"]);
    var h = RMRAW.computeHighlight(doc, r, "", "ace");
    eq(text.substring(h.start, h.end), "ああああ");
});

test("XP messages include the 101 header's first line (synthetic XP YAML)", function () {
    var yamlText = [
        "--- !ruby/object:RPG::Map",
        "events:",
        "  1: !ruby/object:RPG::Event",
        "    id: 1",
        "    name: XP Event",
        "    pages:",
        "    - !ruby/object:RPG::Event::Page",
        "      list:",
        "      - !ruby/object:RPG::EventCommand {i: 0, c: 101, p: [First line, 0, 2]}",
        "      - !ruby/object:RPG::EventCommand {i: 0, c: 401, p: [second line]}",
        "      - !ruby/object:RPG::EventCommand {i: 0, c: 401, p: [third line]}",
        "      - !ruby/object:RPG::EventCommand {i: 0, c: 0, p: []}",
        ""
    ].join("\n");
    var doc = RMRAW.parseDocument(yamlText);
    var segs = ["events", "1", "pages", "0", "list", "0", "message", "noPicture", "bottom"];
    var r = RMRAW.resolveNode(doc, segs);

    var h = RMRAW.computeHighlight(doc, r, "", "xp");
    var block = yamlText.substring(h.start, h.end);
    assert(block.indexOf("First line") === 0, "starts at header first line: " + block);
    assert(block.endsWith("third line"), "ends at last 401 text: " + block);

    var h2 = RMRAW.computeHighlight(doc, r, "", "vxace");
    var block2 = yamlText.substring(h2.start, h2.end);
    assert(block2.indexOf("second line") === 0, "VX/Ace starts at first 401: " + block2);
    assert(block2.endsWith("third line"), "VX/Ace ends at last 401 text: " + block2);
});

test("computeHighlight handles multi-line message blocks", function () {
    var text = yaml("CommonEvents.yaml");
    var doc = RMRAW.parseDocument(text);
    var found = null;
    var root = doc.getIn([], true);
    for (var i = 1; i < root.items.length && !found; i++) {
        var list = doc.getIn([i, "list"], true);
        if (!list || !list.items) continue;
        for (var k = 0; k < list.items.length; k++) {
            if (RMRAW.commandCode(list.items[k]) == 101 &&
                RMRAW.commandCode(list.items[k + 1]) == 401 &&
                RMRAW.commandCode(list.items[k + 2]) == 401) {
                found = { list: list, k: k, i: i };
                break;
            }
        }
    }
    assert(found, "fixture must contain a 101 + 2x401 run");
    var runEnd = found.k + 1;
    while (RMRAW.commandCode(found.list.items[runEnd + 1]) == 401) runEnd++;
    var segs = [String(found.i), "list", String(found.k), "message", "noPicture", "bottom"];
    var r = RMRAW.resolveNode(doc, segs);
    var h = RMRAW.computeHighlight(doc, r, "", "ace");
    var first401 = RMRAW.safeGetIn(doc, [found.i, "list", found.k + 1, "p", 0]);
    var last401 = RMRAW.safeGetIn(doc, [found.i, "list", runEnd, "p", 0]);
    eq(h.start, first401.range[0]);
    eq(h.end, last401.range[1]);
});

test("computeHighlight falls back to text match for wrong addcomm index (quirk)", function () {
    var text = yaml("CommonEvents.yaml");
    var doc = RMRAW.parseDocument(text);
    var root = doc.getIn([], true);
    var found = null;
    for (var i = 1; i < root.items.length && !found; i++) {
        var list = doc.getIn([i, "list"], true);
        if (!list || !list.items) continue;
        for (var k = 0; k < list.items.length; k++) {
            if (RMRAW.commandCode(list.items[k]) == 408) {
                var j = k, texts = [];
                while (RMRAW.commandCode(list.items[j]) == 408) {
                    texts.push(String(RMRAW.safeGetIn(doc, [i, "list", j, "p", 0]).value));
                    j++;
                }
                found = { list: list, k: k, j: j - 1, texts: texts, i: i };
                break;
            }
        }
    }
    assert(found, "fixture must contain a 408 run");
    var segs = [String(found.i), "list", "0", "addcomm"];
    var r = RMRAW.resolveNode(doc, segs);
    var h = RMRAW.computeHighlight(doc, r, found.texts.join("\n"), "ace");
    var wantStart = RMRAW.safeGetIn(doc, [found.i, "list", found.k, "p", 0]).range[0];
    var wantEnd = RMRAW.safeGetIn(doc, [found.i, "list", found.j, "p", 0]).range[1];
    eq(h.start, wantStart);
    eq(h.end, wantEnd);
});

test("describe decodes map event metadata", function () {
    var doc = RMRAW.parseDocument(yaml("Map003.yaml"));
    var segs = ["events", "3", "pages", "0", "list", "1", "message", "noPicture", "bottom"];
    var r = RMRAW.resolveNode(doc, segs);
    var rows = RMRAW.describe(doc, RMRAW.parseContext("Map003/events/3/pages/0/list/1/message/noPicture/bottom"), r, "map", null);
    var flat = rows.map(x => x.label + "=" + x.value).join("; ");
    assert(flat.indexOf("Event 3") != -1, flat);
    assert(flat.indexOf("Show Text") != -1, flat);
    assert(flat.indexOf("bottom") != -1, flat);
    assert(flat.indexOf("Command #") != -1, flat);
});

test("toTreeData replaces Table blobs and survives stringify", function () {
    var doc = RMRAW.parseDocument(yaml("Map003.yaml"));
    var tree = RMRAW.toTreeData(doc);
    assert(tree, "tree data");
    var s = JSON.stringify(tree);
    assert(s.indexOf("[Table data omitted]") != -1, "table placeholder present");
    assert(s.indexOf("ああああ") != -1, "event text still present");
});

test("findIniEntry locates key under section", function () {
    var ini = fs.readFileSync(path.join(global.FIXTURES, "vxace", "Game.ini"), "utf8");
    var hit = RMRAW.findIniEntry(ini, "Game", "RTP");
    assert(hit, "found");
    eq(ini.substring(hit.start, hit.end).trim(), "RPGVXAce");
    var miss = RMRAW.findIniEntry(ini, "Nope", "RTP");
    eq(miss, null);
});

test("choices highlight covers the choice array (102)", function () {
    var text = yaml("CommonEvents.yaml");
    var doc = RMRAW.parseDocument(text);
    var root = doc.getIn([], true);
    var found = null;
    for (var i = 1; i < root.items.length && !found; i++) {
        var list = doc.getIn([i, "list"], true);
        if (!list || !list.items) continue;
        for (var k = 0; k < list.items.length; k++) {
            if (RMRAW.commandCode(list.items[k]) == 102) {
                found = { list: list, k: k, i: i };
                break;
            }
        }
    }
    assert(found, "fixture must contain a 102 command");
    var segs = [String(found.i), "list", String(found.k), "Show Choices"];
    var r = RMRAW.resolveNode(doc, segs);
    var h = RMRAW.computeHighlight(doc, r, "", "ace");
    var choices = RMRAW.safeGetIn(doc, [found.i, "list", found.k, "p", 0]);
    eq(h.start, choices.range[0]);
    eq(h.end, choices.range[1]);
    var block = text.substring(h.start, h.end);
    assert(block.indexOf("いいえ") != -1 && block.indexOf("はい") != -1, "covers choice strings: " + block);
});

test("122 with numeric operand falls back to whole command range", function () {
    var text = yaml("CommonEvents.yaml");
    var doc = RMRAW.parseDocument(text);
    var root = doc.getIn([], true);
    var found = null;
    for (var i = 1; i < root.items.length && !found; i++) {
        var list = doc.getIn([i, "list"], true);
        if (!list || !list.items) continue;
        for (var k = 0; k < list.items.length; k++) {
            if (RMRAW.commandCode(list.items[k]) == 122) {
                found = { list: list, k: k, i: i };
                break;
            }
        }
    }
    assert(found, "fixture must contain a 122 command");
    var cmd = found.list.items[found.k];
    var segs = [String(found.i), "list", String(found.k), "Control Variables"];
    var r = RMRAW.resolveNode(doc, segs);
    var h = RMRAW.computeHighlight(doc, r, "", "ace");
    eq(h.start, cmd.range[0]);
    eq(h.end, cmd.range[1]);
});

test("resolveNode returns consumed 0 when nothing resolves", function () {
    var doc = RMRAW.parseDocument(yaml("Map003.yaml"));
    var r = RMRAW.resolveNode(doc, ["nope", "also-nope"]);
    eq(r.consumed, 0);
    eq(r.path.length, 0);
    eq(r.tail.length, 2);
});

test("computeHighlight returns null for a rangeless resolution", function () {
    var doc = RMRAW.parseDocument("");
    var r = RMRAW.resolveNode(doc, ["anything"]);
    var h = RMRAW.computeHighlight(doc, r, "", "ace");
    eq(h, null);
});

test("findIniEntry tolerates a BOM", function () {
    var ini = fs.readFileSync(path.join(global.FIXTURES, "vxace", "Game.ini"), "utf8");
    var bommed = "\uFEFF" + ini;
    var hit = RMRAW.findIniEntry(bommed, "Game", "RTP");
    assert(hit, "found with BOM");
    eq(bommed.substring(hit.start, hit.end).trim(), "RPGVXAce");
});

test("computeHighlight returns null when nothing resolved (no whole-file snippet)", function () {
    var doc = RMRAW.parseDocument(yaml("Map003.yaml"));
    var r = RMRAW.resolveNode(doc, ["bogus"]);
    eq(r.consumed, 0);
    var h = RMRAW.computeHighlight(doc, r, "", "ace");
    eq(h, null);
});

test('map contexts with doubled list segment resolve to the command', function () {
    var text = yaml('Map003.yaml');
    var doc = RMRAW.parseDocument(text);
    var r = RMRAW.resolveNode(doc, RMRAW.parseContext('Map003/events/3/pages/0/list/list/1/message/noPicture/bottom').segments);
    eq(r.consumed, 6);
    eq(JSON.stringify(r.path), JSON.stringify(['events', 3, 'pages', 0, 'list', 1]));
    eq(RMRAW.commandCode(r.node), 101);
    var h = RMRAW.computeHighlight(doc, r, '', 'ace');
    eq(text.substring(h.start, h.end), 'ああああ');
});

test('single list contexts are unaffected by the collapse', function () {
    var p1 = RMRAW.parseContext('CommonEvents/50/list/6/Show Choices');
    eq(p1.segments.join('/'), '50/list/6/Show Choices');
    var p2 = RMRAW.parseContext('Map003/display_name');
    eq(p2.segments.join('/'), 'display_name');
});

test("empty headerIndex in comment contexts still finds the run (live-data shape)", function () {
    var text = yaml("CommonEvents.yaml");
    var doc = RMRAW.parseDocument(text);
    // real stored context shape: "CommonEvents/1/list//addcomm" (undefined index)
    var parsed = RMRAW.parseContext("CommonEvents/1/list//addcomm");
    eq(parsed.segments.join("/"), "1/list/addcomm");
    var r = RMRAW.resolveNode(doc, parsed.segments);
    eq(r.consumed, 2);                       // resolves to the list seq itself
    // the text-match fallback must locate the first 408 run in that list
    var list = doc.getIn([1, "list"], true);
    var k = 0;
    while (k < list.items.length && RMRAW.commandCode(list.items[k]) != 408) k++;
    assert(k < list.items.length, "list must contain a 408");
    var j = k, texts = [];
    while (j < list.items.length && RMRAW.commandCode(list.items[j]) == 408) {
        texts.push(String(RMRAW.safeGetIn(doc, [1, "list", j, "p", 0]).value));
        j++;
    }
    var h = RMRAW.computeHighlight(doc, r, texts.join("\n"), "ace");
    var wantStart = RMRAW.safeGetIn(doc, [1, "list", k, "p", 0]).range[0];
    var wantEnd = RMRAW.safeGetIn(doc, [1, "list", j - 1, "p", 0]).range[1];
    eq(h.start, wantStart);
    eq(h.end, wantEnd);
});

test('treeExpandPath converts object keys to ordinals, not raw ids (Map004 shape)', function () {
    // events hash keyed 1 and 11 — event 1 is ordinal 0, event 11 is ordinal 1
    var tree = { parallax_name: '', height: 30, events: {
        1: { id: 1, name: 'EV1', pages: [{ list: [{ c: 101 }, { c: 401 }, { c: 0 }] }] },
        11: { id: 11, name: 'EV11', pages: [{ list: [{ c: 0 }] }] }
    } };
    // event 1, page 0, command 1
    var e1 = RMRAW.treeExpandPath(tree, ['events', 1, 'pages', 0, 'list', 1]);
    eq(e1[0], 2);                       // ordinal of 'events' among root keys
    eq(e1[1], 0);                       // event 1 is the FIRST child, not childs[1]
    eq(e1[2], 2);                       // ordinal of 'pages' within the event (id, name, pages)
    eq(e1[3], 0);                       // array index
    eq(e1[4], 0);                       // ordinal of 'list' within the page
    eq(e1[5], 1);                       // command index
    // event 11 must map to ordinal 1
    var e11 = RMRAW.treeExpandPath(tree, ['events', 11, 'pages', 0, 'list', 0]);
    eq(e11[1], 1);
    // scalar leaves are never targeted
    var scalar = RMRAW.treeExpandPath(tree, ['events', 1, 'name']);
    eq(scalar.length, 2);               // stops at the event object
    // null array entries are never targeted
    var withNull = [null, { list: [{ c: 0 }] }];
    eq(RMRAW.treeExpandPath(withNull, [1, 'list', 0]).length, 3);
    eq(RMRAW.treeExpandPath(withNull, [0, 'list', 0]).length, 0);
});
