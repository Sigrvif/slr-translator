// www/core/docsChat/tests/DocIndex.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const DocIndex = require("../lib/DocIndex");

const MANIFEST_SRC = `
window.DOCS_MANIFEST = [
	{ section: "Translation Engines", pages: [
		{ id: "dslr", title: "DSLR Translation Engine", file: "pages/dslr.html", keywords: "dslr endpoint api" },
		{ id: "llm-apis", title: "LLM APIs", file: "pages/llm-apis.html", keywords: "openai claude gemini glossary extractor" }
	]},
	{ section: "Reference", pages: [
		{ id: "faq", title: "FAQ", file: "pages/faq.html", keywords: "questions answers" },
		{ id: "mv", title: "RPG Maker MV", file: "pages/mv.html", keywords: "rmmv mv" },
		{ id: "generic", title: "Generic Setup", file: "pages/generic.html", keywords: "" },
		{ id: "specific", title: "Rotation Page", file: "pages/specific.html", keywords: "" }
	]}
];`;

const PAGES = {
    "pages/dslr.html": "<h1>DSLR</h1><h2>Endpoints</h2><p>Configure the &amp; test endpoint. What is a good way to start?</p><pre>if (a &lt; b) { x(); }</pre><ul><li>one</li><li>two</li></ul>",
    "pages/llm-apis.html": "<h1>LLM APIs</h1><p>The glossary extractor talks to any OpenAI-compatible endpoint.</p>",
    "pages/faq.html": "<h1>FAQ</h1><p>Why is the glossary empty? Because the extractor found no terms.</p>",
    "pages/mv.html": "<h1>RPG Maker MV</h1><p>Projects of the mv engine are parsed from their js files. Throughline note.</p>",
    "pages/generic.html": "<h1>Generic Setup</h1><p>Generic setup page about the endpoint and setup things. Connect over http; the 38 mark is noise. Throughline note.</p>",
    "pages/specific.html": "<h1>Rotation Page</h1><p>Generic setup page about the endpoint that also explains how models rotate between servers. Throughline note.</p>"
};

function makeIndex() {
    const index = new DocIndex({
        readFile: (file) => PAGES[file] !== undefined ? PAGES[file] : null
    });
    return index.init(MANIFEST_SRC).then(() => index);
}

test("parseManifestSource evaluates the manifest script and flattens sections", () => {
    const pages = DocIndex.parseManifestSource(MANIFEST_SRC);
    assert.equal(pages.length, 6);
    assert.deepEqual(pages[0], {
        id: "dslr", title: "DSLR Translation Engine", file: "pages/dslr.html",
        section: "Translation Engines", keywords: "dslr endpoint api"
    });
    assert.equal(pages[2].section, "Reference");
});

test("htmlToText decodes entities and preserves code blocks verbatim", () => {
    const text = DocIndex.htmlToText(PAGES["pages/dslr.html"]);
    assert.ok(text.includes("the & test endpoint"), "entity not decoded: " + text);
    assert.ok(text.includes("if (a < b) { x(); }"), "code block not verbatim: " + text);
    assert.ok(!text.includes("&lt;") && !text.includes("&amp;"), "raw entities survived: " + text);
    assert.ok(text.includes("- one"), "list item not rendered: " + text);
    assert.ok(/#{1,2}\s/.test(text), "heading marker missing: " + text);
});

test("readDoc returns page text; unknown page_id returns error object, does not throw", () => {
    return makeIndex().then((index) => {
        const page = index.readDoc("dslr");
        assert.equal(page.page_id, "dslr");
        assert.equal(page.title, "DSLR Translation Engine");
        assert.ok(page.text.includes("OpenAI") === false || true); // text is non-empty
        assert.ok(page.text.length > 0);
        assert.deepEqual(index.readDoc("nope"), { error: "Unknown page_id 'nope'. Use list_docs for valid ids." });
    });
});

test("listDocs returns id/title/section without heavy page text", () => {
    return makeIndex().then((index) => {
        const docs = index.listDocs();
        assert.equal(docs.length, 6);
        assert.deepEqual(Object.keys(docs[0]).sort(), ["id", "section", "title"]);
    });
});

test("search ranks keyword matches above plain-text mentions and returns snippets", () => {
    return makeIndex().then((index) => {
        const hits = index.search("glossary");
        assert.ok(hits.length >= 1);
        assert.equal(hits[0].page_id, "llm-apis", "keyword hit should outrank body-only hit: " + JSON.stringify(hits));
        // faq mentions glossary only in body text - present but ranked lower
        const faqHit = hits.find((h) => h.page_id === "faq");
        assert.ok(faqHit, "body-only mention should still be found");
        assert.ok(hits.indexOf(faqHit) > 0);
        assert.ok(faqHit.snippet.toLowerCase().includes("glossary"), "snippet should contain the match");
        assert.ok(!hits.some((h) => h.page_id === "dslr"), "unrelated page should be absent");
    });
});

test("search with no matching tokens returns empty array", () => {
    return makeIndex().then((index) => {
        assert.deepEqual(index.search("zzzznothing"), []);
    });
});

test("stopword-only queries match nothing even though every page contains the words", () => {
    return makeIndex().then((index) => {
        // "what is a good" appears verbatim in the dslr page body — these
        // words must not produce a manual match on their own (the mode split
        // depends on it: "What's a good pancake recipe?" must NOT look manual).
        assert.deepEqual(index.search("what is a good"), []);
        assert.deepEqual(index.search("What's a good pancake recipe?"), []);
    });
});

test("short but meaningful tokens (engine names) still match", () => {
    return makeIndex().then((index) => {
        const hits = index.search("mv games");
        assert.ok(hits.length >= 1 && hits[0].page_id === "mv", JSON.stringify(hits));
    });
});

test("matching is word-boundary: a short token cannot match inside a longer word", () => {
    return makeIndex().then((index) => {
        // The generic fixture body contains "http" — "tp" lives inside it as a
        // substring. A query typo must not match the page through that.
        const hits = index.search("tp");
        assert.deepEqual(hits, [], "substring matches must not count: " + JSON.stringify(hits.map((h) => h.page_id)));
        // ...but a real 2-letter word (engine name) still matches as a word.
        const mv = index.search("which engine is mv");
        assert.ok(mv.some((h) => h.page_id === "mv"), JSON.stringify(mv.map((h) => h.page_id)));
    });
});

test("one-and-two digit tokens are ignored (caliber/chapter noise, not signal)", () => {
    return makeIndex().then((index) => {
        // The generic fixture body contains a literal "38" — must not match.
        assert.deepEqual(index.search("38"), []);
        assert.deepEqual(index.search("38 57"), []);
        // ...and must not change what a query without the digits returns.
        assert.deepEqual(index.search("38 special ammunition"), index.search("special ammunition"));
    });
});

test("stemming: plural and derived forms match their base words", () => {
    return makeIndex().then((index) => {
        // The mv fixture body says "parsed from their js files" and the page is
        // about engine projects — a query in derived forms must still hit it.
        const hits = index.search("parsing the mv project files");
        assert.ok(hits.length >= 1 && hits[0].page_id === "mv", JSON.stringify(hits));
        // "endpoints" (plural query) vs "endpoint" (singular body) in llm-apis
        const api = index.search("compatible endpoints");
        assert.ok(api.some((h) => h.page_id === "llm-apis"), JSON.stringify(api.map((h) => h.page_id)));
    });
});

test("tokens present in a third or more of pages are ambient, not rare evidence", () => {
    return makeIndex().then((index) => {
        // "throughline" is in 3 of 6 fixture pages (50%) — ambient prose, like
        // "common"/"english" in the real manual; "rotate" is in one page. A
        // question matching both must carry exactly ONE rare token.
        const hits = index.search("throughline rotate");
        assert.ok(hits.length >= 1);
        const specific = hits.find((h) => h.page_id === "specific");
        assert.ok(specific, JSON.stringify(hits.map((h) => h.page_id)));
        assert.equal(specific.rareTokens, 1, "ambient words must not count as rare evidence");
        assert.equal(specific.strongRareMatch, true, "rotate also appears in the page title (Rotation Page)");
    });
});

test("rare discriminating tokens outweigh tokens that appear in several pages", () => {
    return makeIndex().then((index) => {
        // Production failure shape: "setup"/"endpoint" appear in MANY pages and
        // tie every candidate; "rotate" appears in ONE page. The page holding
        // the rare token must win — a tie broken by manifest order injects the
        // wrong pages into the chat's excerpts.
        const hits = index.search("setup endpoint rotate");
        assert.ok(hits.length >= 2, JSON.stringify(hits));
        assert.equal(hits[0].page_id, "specific", JSON.stringify(hits.map((h) => h.page_id + ":" + h.score.toFixed(1))));
        const generic = hits.find((h) => h.page_id === "generic");
        if (generic) assert.ok(hits[0].score > generic.score * 1.1, "specific " + hits[0].score + " vs generic " + generic.score);
    });
});

/* --- addon-contributed docs pages (addonsRoot) --- */

const fs = require("fs");
const os = require("os");
const nodePath = require("path");

function makeAddonsFixture() {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "slr-docindex-addons-"));
    fs.mkdirSync(nodePath.join(dir, "zdx"), { recursive: true });
    fs.writeFileSync(nodePath.join(dir, "zdx", "package.json"), JSON.stringify({
        name: "zdx", title: "ZDX Fixture", description: "zdx fixture addon",
        docs: "docs.html"
    }));
    fs.writeFileSync(nodePath.join(dir, "zdx", "docs.html"),
        "<h1>ZDX</h1><p>The zirconium parakeet explains this addon.</p>");
    fs.mkdirSync(nodePath.join(dir, "ghost"), { recursive: true });
    fs.writeFileSync(nodePath.join(dir, "ghost", "package.json"), JSON.stringify({
        name: "ghost", title: "Ghost", docs: "missing.html"
    }));
    return dir;
}

function makeAddonIndex() {
    const dir = makeAddonsFixture();
    const pages = Object.assign({}, PAGES, {
        "../addons/zdx/docs.html": "<h1>ZDX</h1><p>The zirconium parakeet explains this addon.</p>"
    });
    const index = new DocIndex({
        readFile: (file) => pages[file] !== undefined ? pages[file] : null,
        addonsRoot: dir
    });
    return index.init(MANIFEST_SRC).then(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        return index;
    });
}

test("addon docs pages join the index, are searchable and readable", () => {
    return makeAddonIndex().then((index) => {
        const listed = index.listDocs();
        const addonPage = listed.find((p) => p.id === "addon-zdx");
        assert.ok(addonPage, "addon page missing from listDocs: " + JSON.stringify(listed));
        assert.equal(addonPage.section, "Addons");
        assert.equal(listed.filter((p) => p.section === "Addons").length, 2); // zdx + ghost

        const hits = index.search("zirconium parakeet");
        assert.ok(hits.length >= 1);
        assert.equal(hits[0].page_id, "addon-zdx", JSON.stringify(hits.map((h) => h.page_id)));

        const doc = index.readDoc("addon-zdx");
        assert.equal(doc.title, "ZDX Fixture");
        assert.ok(doc.text.includes("zirconium parakeet"), doc.text);
    });
});

test("a declared-but-missing addon page degrades to an unreadable entry, not a rejection", () => {
    return makeAddonIndex().then((index) => {
        const doc = index.readDoc("addon-ghost");
        assert.match(doc.text, /page could not be read/);
        // and the built-in manual is untouched
        assert.ok(index.readDoc("dslr").text.length > 0);
    });
});

test("no addonsRoot keeps the index manifest-only", () => {
    return makeIndex().then((index) => {
        assert.ok(index.listDocs().every((p) => p.section !== "Addons"));
    });
});
