// www/core/docsChat/tests/Persona.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Persona = require("../lib/Persona");

test("resolution matrix", () => {
    assert.equal(Persona.resolvePersona(undefined).mode, "default");
    assert.equal(Persona.resolvePersona("").mode, "default");
    assert.equal(Persona.resolvePersona("   ").mode, "default");
    assert.deepEqual(Persona.resolvePersona("off"), { mode: "off", text: null });
    assert.equal(Persona.resolvePersona("professional").mode, "professional");
    assert.equal(Persona.resolvePersona("You are Erika.").mode, "custom");
    assert.equal(Persona.resolvePersona("You are Erika.").text, "You are Erika.");
});

test("default persona names the tools and the table of contents", () => {
    for (const frag of ["search_docs", "read_doc", "list_docs", "table of contents"])
        assert.ok(Persona.DEFAULT_PERSONA.includes(frag), "missing fragment: " + frag);
});

test("buildSystemPrompt default: persona + TOC + tools", () => {
    const pages = [{ id: "dslr", title: "DSLR", section: "Translation Engines" }];
    const p = Persona.buildSystemPrompt(undefined, pages);
    assert.equal(p.toolsAllowed, true);
    assert.ok(p.text.startsWith(Persona.DEFAULT_PERSONA));
    assert.ok(p.text.includes("DSLR") && p.text.includes("dslr"));
});

test("manualMatch=false selects the off-manual persona variant (no shaming paragraph)", () => {
    const pages = [{ id: "dslr", title: "DSLR", section: "S" }];
    const p = Persona.buildSystemPrompt(undefined, pages, { manualMatch: false });
    assert.equal(p.toolsAllowed, true);
    assert.ok(p.text.startsWith(Persona.DEFAULT_PERSONA_OFF));
    assert.notEqual(Persona.DEFAULT_PERSONA_OFF, Persona.DEFAULT_PERSONA, "off variant must be its own text");
    assert.ok(p.text.includes("dslr"), "TOC still injected in off-manual mode");
    // The two variants must stay DIFFERENT texts (the split must select
    // something) — the prose itself belongs to the author and may change.
    assert.notEqual(Persona.DEFAULT_PERSONA_OFF, Persona.DEFAULT_PERSONA);
});

test("manualMatch=true (and default) selects the manual persona variant", () => {
    const pages = [{ id: "dslr", title: "DSLR", section: "S" }];
    const on = Persona.buildSystemPrompt(undefined, pages, { manualMatch: true });
    assert.ok(on.text.startsWith(Persona.DEFAULT_PERSONA));
    assert.ok(/merciless/.test(on.text));
    // omitted opts means manualMatch true (backward compatible)
    const dflt = Persona.buildSystemPrompt(undefined, pages);
    assert.ok(dflt.text.startsWith(Persona.DEFAULT_PERSONA));
});

test("custom personas ignore the mode split (used verbatim either way)", () => {
    const pages = [{ id: "dslr", title: "DSLR", section: "S" }];
    const a = Persona.buildSystemPrompt("You are Erika.", pages, { manualMatch: true });
    const b = Persona.buildSystemPrompt("You are Erika.", pages, { manualMatch: false });
    assert.ok(a.text.startsWith("You are Erika."));
    assert.ok(b.text.startsWith("You are Erika."));
});

test("buildSystemPrompt off: no persona text, no TOC, no tools", () => {
    const p = Persona.buildSystemPrompt("off", [{ id: "dslr", title: "DSLR", section: "S" }]);
    assert.equal(p.toolsAllowed, false);
    assert.equal(p.text, null);
});

test("buildSystemPrompt professional: professional prompt + TOC", () => {
    const p = Persona.buildSystemPrompt("professional", [{ id: "dslr", title: "DSLR", section: "S" }]);
    assert.equal(p.toolsAllowed, true);
    assert.ok(p.text.startsWith(Persona.PROFESSIONAL_PERSONA));
    assert.ok(p.text.includes("dslr"));
});

test("buildSystemPrompt custom: custom text + TOC still injected", () => {
    const p = Persona.buildSystemPrompt("You are Erika.", [{ id: "dslr", title: "DSLR", section: "S" }]);
    assert.equal(p.toolsAllowed, true);
    assert.ok(p.text.startsWith("You are Erika."));
    assert.ok(p.text.includes("dslr")); // TOC present
});

test("renderToc lists every page with section, title and id", () => {
    const toc = Persona.renderToc([
        { id: "dslr", title: "DSLR", section: "Translation Engines" },
        { id: "faq", title: "FAQ", section: "Reference" }
    ]);
    assert.ok(toc.includes("Translation Engines") && toc.includes("DSLR") && toc.includes("dslr"));
    assert.ok(toc.includes("Reference") && toc.includes("FAQ") && toc.includes("faq"));
});
