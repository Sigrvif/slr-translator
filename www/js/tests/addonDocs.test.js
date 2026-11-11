"use strict";
/* collectAddonDocSections (www/js/addonDocs.js): turns the optional "docs"
   declaration of user addon package.json files into documentation-manifest
   sections. Pure filesystem scan — exercised here against a temp addons dir. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const collectAddonDocSections = require("../addonDocs.js");

function makeAddonsDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "slr-addon-docs-"));
}

function writeAddon(dir, name, pkg, files) {
    const folder = path.join(dir, name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify(pkg));
    for (const [file, content] of Object.entries(files || {})) {
        fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
        fs.writeFileSync(path.join(folder, file), content);
    }
    return folder;
}

test("string docs form yields one page titled and keyworded from the package", () => {
    const dir = makeAddonsDir();
    writeAddon(dir, "alpha", {
        name: "alpha", title: "Alpha Tool", description: "Does alpha things.",
        docs: "docs.html"
    }, { "docs.html": "<h1>Alpha</h1>" });

    const sections = collectAddonDocSections(dir);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].section, "Addons");
    assert.equal(sections[0].pages.length, 1);
    const page = sections[0].pages[0];
    assert.equal(page.id, "addon-alpha");
    assert.equal(page.title, "Alpha Tool");
    assert.equal(page.file, "../addons/alpha/docs.html");
    assert.match(page.keywords, /alpha things/);
    assert.match(page.keywords, /addon$/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("array docs form yields numbered ids, per-page titles and keywords", () => {
    const dir = makeAddonsDir();
    writeAddon(dir, "beta", {
        name: "beta", title: "Beta",
        docs: [
            { file: "docs.html" },
            { file: "advanced.html", title: "Beta Advanced", keywords: "deep dive" },
            { file: "sub/page.html", title: "Nested" }
        ]
    }, {});

    const sections = collectAddonDocSections(dir);
    const pages = sections[0].pages;
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.map((p) => p.id), ["addon-beta", "addon-beta-2", "addon-beta-3"]);
    // first page has no explicit title: falls back to the package title
    assert.equal(pages[0].title, "Beta");
    assert.equal(pages[1].title, "Beta Advanced");
    assert.match(pages[1].keywords, /deep dive/);
    // subfolder files keep their path, slashes normalized
    assert.equal(pages[2].file, "../addons/beta/sub/page.html");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("title falls back to the folder name when the package has none", () => {
    const dir = makeAddonsDir();
    writeAddon(dir, "gamma", { name: "gamma", docs: "docs.html" }, {});
    const sections = collectAddonDocSections(dir);
    assert.equal(sections[0].pages[0].title, "gamma");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("addons without docs, broken manifests and non-array junk are skipped", () => {
    const dir = makeAddonsDir();
    writeAddon(dir, "plain", { name: "plain", title: "No Docs Here" }, {});
    fs.mkdirSync(path.join(dir, "broken"));
    fs.writeFileSync(path.join(dir, "broken", "package.json"), "{ not json");
    writeAddon(dir, "junk", { name: "junk", docs: { file: "x.html" } }, {});
    fs.mkdirSync(path.join(dir, "notanaddon")); // no package.json at all

    assert.deepEqual(collectAddonDocSections(dir), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("missing or unreadable addons directory yields no sections", () => {
    assert.deepEqual(collectAddonDocSections(path.join(os.tmpdir(), "slr-no-such-addons-dir")), []);
});

test("pages are collected in folder-name order and backslashes normalize", () => {
    const dir = makeAddonsDir();
    writeAddon(dir, "zeta", { name: "zeta", docs: "docs.html" }, {});
    writeAddon(dir, "eta", { name: "eta", docs: [{ file: "win\\path.html" }] }, {});

    const pages = collectAddonDocSections(dir)[0].pages;
    assert.deepEqual(pages.map((p) => p.id), ["addon-eta", "addon-zeta"]);
    assert.equal(pages[0].file, "../addons/eta/win/path.html");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("array entries without a usable file field are dropped individually", () => {
    const dir = makeAddonsDir();
    writeAddon(dir, "delta", {
        name: "delta",
        docs: [{ title: "No File" }, "not-an-object", { file: "real.html" }]
    }, {});
    const pages = collectAddonDocSections(dir)[0].pages;
    assert.deepEqual(pages.map((p) => p.file), ["../addons/delta/real.html"]);
    fs.rmSync(dir, { recursive: true, force: true });
});
