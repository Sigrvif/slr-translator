"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../glossaryCheck");

function gloss(obj) {
    const g = {};
    for (const [ja, v] of Object.entries(obj)) {
        g[ja] = Object.assign({ japanese: ja, english: "", type: "unknown" }, v);
    }
    return g;
}

test("buildEntries skips entries without a translation and type unknown", () => {
    const entries = G.buildEntries(gloss({
        "神官": { english: "Priest", type: "male character" },
        "アイーダ": { english: "Aida", type: "female character" },
        "なにか": { english: "", type: "item" },
        "謎": { english: "Mystery", type: "unknown" },
        "壊れた": { english: "Broken" } // no type -> unknown
    }));
    const ja = entries.map((e) => e.ja).sort();
    assert.deepStrictEqual(ja, ["アイーダ", "神官"]);
});

test("buildEntries sorts longest Japanese first", () => {
    const entries = G.buildEntries(gloss({
        "アイ": { english: "Ai", type: "item" },
        "アイーダ": { english: "Aida", type: "female character" }
    }));
    assert.strictEqual(entries[0].ja, "アイーダ");
    assert.strictEqual(entries[1].ja, "アイ");
});

test("findSourceTerms uses longest-match and never double-counts a substring", () => {
    const entries = G.buildEntries(gloss({
        "アイ": { english: "Ai", type: "item" },
        "アイーダ": { english: "Aida", type: "female character" }
    }));
    const found = G.findSourceTerms("アイーダは笑った", entries);
    assert.deepStrictEqual(found.map((e) => e.ja), ["アイーダ"]);
});

test("findSourceTerms finds every distinct term present", () => {
    const entries = G.buildEntries(gloss({
        "神官": { english: "Priest", type: "male character" },
        "アイーダ": { english: "Aida", type: "female character" }
    }));
    const found = G.findSourceTerms("アイーダと神官", entries).map((e) => e.ja).sort();
    assert.deepStrictEqual(found, ["アイーダ", "神官"]);
});

test("containsTerm tolerates inflections and possessives but not mid-word hits", () => {
    assert.strictEqual(G.containsTerm("The Priests arrived.", "Priest"), true);
    assert.strictEqual(G.containsTerm("the priest", "Priest"), true);
    assert.strictEqual(G.containsTerm("Aida's Bar", "Aida"), true);
    assert.strictEqual(G.containsTerm("The priestess spoke.", "Priest"), false);
    assert.strictEqual(G.containsTerm("Demon Kings rule", "Demon King"), true);
});

test("stem matching absorbs inflections of the glossary term", () => {
    assert.strictEqual(G.containsTerm("It was brainwashed.", "Brainwashing"), true);
    assert.strictEqual(G.containsTerm("The brainwashing continued.", "Brainwashing"), true);
    assert.strictEqual(G.containsTerm("She transformed.", "Transformation"), true);
    assert.strictEqual(G.containsTerm("The transformation began.", "Transformation"), true);
    assert.strictEqual(G.containsTerm("He transforms.", "Transformation"), true);
});

test("stem reduces plurals correctly (-es only after a sibilant)", () => {
    assert.strictEqual(G.stem("slimes"), "slime");
    assert.strictEqual(G.stem("houses"), "house");
    assert.strictEqual(G.stem("cakes"), "cake");
    assert.strictEqual(G.stem("cases"), "case");
    assert.strictEqual(G.stem("boxes"), "box");
    assert.strictEqual(G.stem("watches"), "watch");
    assert.strictEqual(G.stem("priests"), "priest");
    assert.strictEqual(G.stem("priestess"), "priestess");
    assert.strictEqual(G.stem("glasses"), "glass");
    assert.strictEqual(G.stem("classes"), "class");
    assert.strictEqual(G.stem("transformations"), "transform");
});

test("a plural form of the term still matches the singular glossary entry", () => {
    assert.strictEqual(G.containsTerm("Slimes are weak to fire", "Slime"), true);
    assert.strictEqual(G.containsTerm("The slimes attacked", "Slime"), true);
    assert.strictEqual(G.containsTerm("Boxes everywhere", "Box"), true);
});

test("stem matching stays word-based, so priest does not satisfy priestess", () => {
    assert.strictEqual(G.containsTerm("The priestess spoke.", "Priest"), false);
    assert.strictEqual(G.containsTerm("The priests spoke.", "Priest"), true);
});

test("isUnusableEnglish flags alternatives and non-terms", () => {
    const bad = ["Charm/talisman", "Charm or talisman", "talisman (charm)", "お札", "A|B",
        "a charm used to ward off evil spirits and bad luck around the home"];
    for (const e of bad) assert.strictEqual(G.isUnusableEnglish(e), true, e);
    for (const e of ["Charm", "Talisman", "", "Demon King", "Aida", "Brainwashing"]) {
        assert.strictEqual(G.isUnusableEnglish(e), false, e);
    }
});

test("buildEntries skips entries whose translation is unusable", () => {
    const entries = G.buildEntries(gloss({
        "御札": { english: "Charm/talisman", type: "item" },
        "洗脳": { english: "Brainwashing", type: "skill" }
    }));
    assert.deepStrictEqual(entries.map((e) => e.ja), ["洗脳"]);
});

test("a missing term with no allowance is reported", () => {
    const entries = G.buildEntries(gloss({
        "神官": { english: "Priest", type: "male character" }
    }));
    const r = G.checkLine("神官が来た", "The cleric arrived.", entries);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.missing.map((m) => m.ja), ["神官"]);
});

test("a present term passes", () => {
    const entries = G.buildEntries(gloss({
        "神官": { english: "Priest", type: "male character" }
    }));
    assert.strictEqual(G.checkLine("神官が来た", "The Priest arrived.", entries).ok, true);
});

test("character entries pass on any pronoun (low false positives)", () => {
    const entries = G.buildEntries(gloss({
        "アイーダ": { english: "Aida", type: "female character" },
        "神官": { english: "Priest", type: "male character" }
    }));
    assert.strictEqual(G.checkLine("アイーダは笑った", "She laughed.", entries).ok, true);
    assert.strictEqual(G.checkLine("神官が来た", "He came.", entries).ok, true);
    assert.strictEqual(G.checkLine("神官が来た", "They came.", entries).ok, true);
});

test("reflexive and possessive pronouns count", () => {
    const entries = G.buildEntries(gloss({
        "アイーダ": { english: "Aida", type: "female character" },
        "神官": { english: "Priest", type: "male character" },
        "守衛": { english: "Guard", type: "character_id" }
    }));
    assert.strictEqual(G.checkLine("アイーダが自分でやった", "She did it herself.", entries).ok, true);
    assert.strictEqual(G.checkLine("神官が自分でやった", "He did it himself.", entries).ok, true);
    assert.strictEqual(G.checkLine("守衛が自分でやった", "They did it themselves.", entries).ok, true);
});

test("gender nouns pass only for the matching character gender", () => {
    const entries = G.buildEntries(gloss({
        "神官": { english: "Priest", type: "male character" },
        "巫女": { english: "Shrine Maiden", type: "female character" }
    }));
    assert.strictEqual(G.checkLine("神官が来た", "The man arrived.", entries).ok, true);
    assert.strictEqual(G.checkLine("巫女が来た", "The woman arrived.", entries).ok, true);
    // A male-character term rendered with only a female noun is still missing.
    assert.strictEqual(G.checkLine("神官が来た", "The woman arrived.", entries).ok, false);
});

test("non-character terms get no pronoun allowance", () => {
    const entries = G.buildEntries(gloss({
        "アイーダのさかば": { english: "Aida's Bar", type: "location" }
    }));
    assert.strictEqual(G.checkLine("アイーダのさかば", "She went there.", entries).ok, false);
    assert.strictEqual(G.checkLine("アイーダのさかば", "Aida's Bar", entries).ok, true);
});

test("the escape token authorizes any deviation and is stripped", () => {
    const entries = G.buildEntries(gloss({
        "神官": { english: "Priest", type: "male character" }
    }));
    assert.strictEqual(G.checkLine("神官が来た", "The cleric arrived. GLOSSARYDIFF", entries).ok, true);
    assert.strictEqual(G.hasEscape("the cleric arrived. glossarydiff"), true);
    assert.strictEqual(G.stripEscape("The cleric arrived. GLOSSARYDIFF"), "The cleric arrived.");
});

test("unknown and untranslated entries are never enforced", () => {
    const entries = G.buildEntries(gloss({
        "謎": { english: "Mystery", type: "unknown" },
        "なにか": { english: "", type: "item" }
    }));
    assert.strictEqual(G.checkLine("謎となにか", "Something else entirely.", entries).ok, true);
});
