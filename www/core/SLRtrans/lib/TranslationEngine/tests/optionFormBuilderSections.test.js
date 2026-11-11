"use strict";
// Section-level presentation helpers of OptionFormBuilder: per-section help
// text, one-time "Advanced"-style headings, and per-section appended nodes
// (e.g. the Quick Start "Test connection" button).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { OptionFormBuilder } = require("../OptionFormBuilder");

function stubOption(id) {
    return {
        _value: "",
        getId() { return id; },
        getFormType() { return "text"; },
        getType() { return "string"; },
        getValue() { return this._value; },
        setValue(v) { this._value = v; },
        getDefault() { return ""; },
        getName() { return id; },
        getDescription() { return ""; },
        getSchemaOptions() { return {}; },
        getFormOptions() { return {}; },
        getChildForm() { return []; }
    };
}

function build(sections, options, extra) {
    return OptionFormBuilder.build(Object.assign({
        storedOptions: options,
        engine: {},
        sections: sections,
        sectionOf: (opt) => ({ parent: opt.getId() })
    }, extra || {}));
}

function fieldsetByClass(form, cls) {
    return form.find((node) => node.type === "fieldset" && String(node.htmlClass).indexOf(cls) !== -1);
}

test("section help is emitted at the top of its section", () => {
    const { form } = build(
        [{ key: "a", title: "A", help: "A help line" }, { key: "b", title: "B" }],
        [stubOption("a"), stubOption("b")]
    );
    const a = fieldsetByClass(form, "option-section-a");
    assert.ok(a, "section a fieldset exists");
    assert.strictEqual(a.items[0].type, "help");
    assert.ok(a.items[0].helpvalue.indexOf("A help line") !== -1);
    assert.ok(a.items[0].helpvalue.indexOf("option-section-help-text") !== -1);
});

test("section heading is emitted once before consecutive sections sharing it", () => {
    const { form } = build(
        [
            { key: "a", title: "A" },
            { key: "b", title: "B", heading: "Advanced" },
            { key: "c", title: "C", heading: "Advanced" }
        ],
        [stubOption("a"), stubOption("b"), stubOption("c")]
    );
    const headings = form.filter((node) => node.type === "help" && String(node.htmlClass).indexOf("option-heading-row") !== -1);
    assert.strictEqual(headings.length, 1, "one Advanced heading");
    assert.ok(headings[0].helpvalue.indexOf("Advanced") !== -1);

    // The heading must sit immediately before the first section that declared it.
    const headingIndex = form.indexOf(headings[0]);
    assert.strictEqual(form.slice(headingIndex + 1).find((n) => n.type === "fieldset"), fieldsetByClass(form, "option-section-b"));
});

test("a section can opt out of the global collapse", () => {
    const { form } = build(
        [{ key: "a", title: "A", expandable: false }, { key: "b", title: "B" }],
        [stubOption("a"), stubOption("b")],
        { collapsible: true }
    );
    assert.strictEqual(fieldsetByClass(form, "option-section-a").expandable, false);
    assert.strictEqual(fieldsetByClass(form, "option-section-b").expandable, true);
});

test("a default-expanded section stays collapsible but is marked to start open", () => {
    const { form } = build(
        [{ key: "a", title: "A", expandable: true, defaultExpanded: true }, { key: "b", title: "B" }],
        [stubOption("a"), stubOption("b")],
        { collapsible: true }
    );
    const a = fieldsetByClass(form, "option-section-a");
    assert.strictEqual(a.expandable, true, "it keeps the collapse toggle");
    assert.ok(String(a.htmlClass).indexOf("option-section-default-expanded") !== -1,
        "options.js expands this class on render");
    assert.ok(String(fieldsetByClass(form, "option-section-b").htmlClass)
        .indexOf("option-section-default-expanded") === -1, "other sections are unaffected");
});

test("sectionAppend nodes are appended inside the section", () => {
    const { form } = build(
        [{ key: "a", title: "A" }],
        [stubOption("a")],
        { sectionAppend: { a: [{ type: "button", title: "Test connection" }] } }
    );
    const a = fieldsetByClass(form, "option-section-a");
    assert.strictEqual(a.items[a.items.length - 1].title, "Test connection");
});

test("a section whose content is only sectionAppend nodes is still emitted (array form)", () => {
    // Array form: nodes are appended at the section level. A section may be created by
    // sectionAppend alone even when it has no registered option.
    const { form } = build(
        [{ key: "permodel", title: "P" }, { key: "roles", title: "R" }],
        [stubOption("permodel")],
        {
            sectionAppend: {
                permodel: [{ type: "help", notitle: true, helpvalue: "These settings apply only to the model." }],
                roles: [{ type: "select", title: "Main model" }]
            }
        }
    );
    const p = fieldsetByClass(form, "option-section-permodel");
    assert.strictEqual(p.items[p.items.length - 1].helpvalue, "These settings apply only to the model.");
    const r = fieldsetByClass(form, "option-section-roles");
    assert.ok(r, "an append-only section must be emitted");
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].title, "Main model");
});

test("an object sectionAppend renders a child with no registered options inside its parent", () => {
    // The Bundled Local Runtime card is ONE top-level fieldset whose option groups are keyed by
    // child, and one of those children (Role assignment) has appended nodes but no registered
    // option. The object form appends those nodes inside the child's own fieldset, after that
    // child's option items, while keeping the child order.
    const general = stubOption("generalOpt");
    const permodel = stubOption("permodelOpt");
    const { form } = build(
        [{ key: "localruntime", title: "Bundled Local Runtime" }],
        [permodel, general],
        {
            sectionOf: (opt) => {
                const id = opt.getId();
                if (id === "generalOpt") return { parent: "localruntime", child: "general" };
                if (id === "permodelOpt") return { parent: "localruntime", child: "permodel" };
                return { parent: "localruntime", child: "roles" };
            },
            childOrder: ["general", "permodel", "roles"],
            childTitle: (c) => ({
                general: "General settings (apply to every model)",
                permodel: "Per-model settings (for the selected model)",
                roles: "Role assignment (Main / Fallback / Glossary / Review)"
            })[c] || c,
            sectionAppend: {
                localruntime: {
                    general: [{ type: "button", title: "Start / Use Local Runtime" }],
                    permodel: [{ type: "select", title: "Model" }],
                    roles: [{ type: "select", title: "Main model" }]
                }
            }
        }
    );
    const tops = form.filter((node) => node.type === "fieldset" &&
        String(node.htmlClass).indexOf("option-section-localruntime") !== -1);
    assert.strictEqual(tops.length, 1, "exactly one top-level runtime fieldset");
    assert.strictEqual(tops[0].title, "Bundled Local Runtime");
    const childTitles = tops[0].items
        .filter((node) => node.type === "fieldset")
        .map((node) => node.title);
    assert.deepStrictEqual(childTitles, [
        "General settings (apply to every model)",
        "Per-model settings (for the selected model)",
        "Role assignment (Main / Fallback / Glossary / Review)"
    ], "the three sub-groups render inside the card, in childOrder");
    // The append-only roles child is present with its nodes (no registered option).
    const rolesChild = tops[0].items.find((node) => node.type === "fieldset" && node.title.indexOf("Role assignment") === 0);
    assert.strictEqual(rolesChild.items.length, 1);
    assert.strictEqual(rolesChild.items[0].title, "Main model");
    // Child-level nodes render after that child's own options.
    const generalChild = tops[0].items.find((node) => node.type === "fieldset" && node.title.indexOf("General settings") === 0);
    assert.strictEqual(generalChild.items[0].key, "generalOpt");
    assert.strictEqual(generalChild.items[generalChild.items.length - 1].title, "Start / Use Local Runtime");
});

test("a per-child { prepend, append } sectionAppend places prepend before and append after the child's options", () => {
    // The general sub-group of the runtime card uses the object form so the action buttons and
    // the status line lead the group, ahead of the server fields. The emitted `items` order must
    // be: every prepend node, then the child's option items, then every append node.
    const general = stubOption("generalOpt");
    const permodel = stubOption("permodelOpt");
    const { form } = build(
        [{ key: "localruntime", title: "Bundled Local Runtime" }],
        [general, permodel],
        {
            sectionOf: (opt) => {
                const id = opt.getId();
                if (id === "permodelOpt") return { parent: "localruntime", child: "permodel" };
                return { parent: "localruntime", child: "general" };
            },
            childOrder: ["general", "permodel"],
            childTitle: (c) => ({ general: "General settings", permodel: "Per-model settings" })[c] || c,
            sectionAppend: {
                localruntime: {
                    // Object form: the buttons/status lead the group, an append node trails it.
                    general: {
                        prepend: [
                            { type: "actions", title: "Start / Use Local Runtime" },
                            { type: "help", notitle: true, helpvalue: '<div class="runtimeStatusLine"></div>' }
                        ],
                        append: [{ type: "help", notitle: true, helpvalue: "trailing note" }]
                    },
                    // Plain-array per-child form is unchanged: nodes still land after the options.
                    permodel: [{ type: "select", title: "Model" }]
                }
            }
        }
    );
    const top = form.filter((node) => node.type === "fieldset" &&
        String(node.htmlClass).indexOf("option-section-localruntime") !== -1)[0];
    assert.ok(top, "one top-level runtime fieldset");
    const generalChild = top.items.find((node) => node.type === "fieldset" && node.title === "General settings");
    const permodelChild = top.items.find((node) => node.type === "fieldset" && node.title === "Per-model settings");
    assert.deepStrictEqual(generalChild.items.map((n) => n.title || n.helpvalue || n.key), [
        "Start / Use Local Runtime",
        '<div class="runtimeStatusLine"></div>',
        "generalOpt",
        "trailing note"
    ], "prepend nodes lead, options follow, append nodes trail");
    assert.deepStrictEqual(permodelChild.items.map((n) => n.title || n.helpvalue || n.key), [
        "permodelOpt",
        "Model"
    ], "the plain-array per-child form still appends after the child's options");
});

// headOf promotes one option to the top of its child group. It must reorder in
// place: the option stays in normal emission, so it renders exactly once and
// keeps whatever childForm/role-gate handling it had.
test("headOf moves the named option to the top of its child group", () => {
    const { form } = build(
        [{ key: "s", title: "S" }],
        [stubOption("a"), stubOption("b"), stubOption("c")],
        {
            sectionOf: (opt) => ({ parent: "s", child: opt.getId() === "c" ? "g2" : "g1" }),
            childOrder: ["g1", "g2"],
            headOf: { g1: "c" }
        }
    );
    const top = form.find((node) => node.type === "fieldset" &&
        String(node.htmlClass).indexOf("option-section-s") !== -1);
    const g1 = top.items.find((node) => node.type === "fieldset" && node.title === "g1");
    assert.deepStrictEqual(g1.items.map((n) => n.key), ["a", "b"],
        "an option that is not in this child stays in its own group");
});

test("headOf renders the promoted option first, exactly once, with no option lost", () => {
    const options = [stubOption("alfirst"), stubOption("target"), stubOption("zlast")];
    const { form } = build(
        [{ key: "s", title: "S" }],
        options,
        {
            sectionOf: (opt) => ({ parent: "s", child: "only" }),
            childOrder: ["only"],
            // A single child collapses into the section, so headOf must still apply.
            headOf: { only: "zlast" }
        }
    );
    const top = form.find((node) => node.type === "fieldset" &&
        String(node.htmlClass).indexOf("option-section-s") !== -1);
    const keys = [];
    const walk = (items) => {
        for (const n of items || []) {
            if (n.type === "fieldset") walk(n.items);
            else if (n.key) keys.push(n.key);
        }
    };
    walk(top.items);
    assert.deepStrictEqual(keys, ["zlast", "alfirst", "target"],
        "promoted option leads; every option rendered exactly once");
});

test("headOf naming an option that is not in the child leaves order untouched", () => {
    const { form } = build(
        [{ key: "s", title: "S" }],
        [stubOption("a"), stubOption("b")],
        {
            sectionOf: (opt) => ({ parent: "s", child: "g" }),
            childOrder: ["g"],
            headOf: { g: "does-not-exist", other: "a" }
        }
    );
    const top = form.find((node) => node.type === "fieldset" &&
        String(node.htmlClass).indexOf("option-section-s") !== -1);
    const keys = [];
    const walk = (items) => {
        for (const n of items || []) {
            if (n.type === "fieldset") walk(n.items);
            else if (n.key) keys.push(n.key);
        }
    };
    walk(top.items);
    assert.deepStrictEqual(keys, ["a", "b"], "no reorder when the head id is absent");
});

// --- Task 6: the new bundled-runtime options ----------------------------------------------
// The four draft/fit options and the three KV options are registered on the engine and routed
// to the "general" child of the one Bundled Local Runtime card, next to their existing
// siblings (the spec's "Per-model group" wording was written without reading the routing; the
// 'permodel' child is a custom jsonform panel, not where option objects render). The routing
// list is exported by the wrapper so placement is checkable here, and the engine's own
// declarations are read from source because the options are built in the constructor.
// Follow-up: the three draft placement ids are since retired into the per-model profiles
// (hidden via _retiredRuntimeProfileIds, seeded once from these card fields). They stay
// declared and mapped, so these source-level checks keep passing; the profiles own the UI now.
const ENGINE_DIR = path.join(__dirname, "..");

const NEW_RUNTIME_OPTION_IDS = [
    "runtimeDraftGpuLayers", "runtimeDraftCpuMoe", "runtimeDraftCpuMoeLayers", "runtimeFitTarget",
    "runtimeCacheRam", "runtimeCtxCheckpoints", "runtimeCacheReuse"
];
const NEW_DRAFT_FIT_IDS = NEW_RUNTIME_OPTION_IDS.slice(0, 4);
const NEW_KV_IDS = NEW_RUNTIME_OPTION_IDS.slice(4);

function engineDeclaresOption(id) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, "DSLREngine.js"), "utf8");
    return src.indexOf("id: '" + id + "'") !== -1;
}

// The wrapper's general sub-group branch, read from source: the options are routed by a long
// `if (id === ...)` chain that no module can exercise without a window. The branch runs from
// runtimeDraftMax (its first id) to the return it decides, so membership is checkable here.
function runtimeGeneralBranchSrc() {
    const src = fs.readFileSync(path.join(ENGINE_DIR, "DSLRTranslationEngineWrapper.js"), "utf8");
    const mapStart = src.indexOf("const sectionOf = (option) => {");
    const mapEnd = src.indexOf("const sections = [", mapStart);
    assert.ok(mapStart !== -1 && mapEnd > mapStart, "sectionOf must be locatable in the wrapper");
    const mapSrc = src.slice(mapStart, mapEnd);
    const branch = mapSrc.match(/id === 'runtimeDraftMax'[\s\S]*?return \{ parent: 'localruntime', child: 'general' \};/);
    assert.ok(branch, "the general sub-group branch must exist in sectionOf");
    return branch[0];
}

// The seven new ids, mapped the way the wrapper maps them, plus a sentinel in another child so
// the general child is emitted as its own group rather than collapsing into the section.
function buildNewRuntimeOptionsForm() {
    const options = NEW_RUNTIME_OPTION_IDS.map((id) => stubOption(id)).concat([stubOption("sentinel")]);
    return build(
        [{ key: "localruntime", title: "Bundled Local Runtime" }],
        options,
        {
            sectionOf: (opt) => opt.getId() === "sentinel"
                ? { parent: "localruntime", child: "permodel" }
                : { parent: "localruntime", child: "general" },
            childOrder: ["general", "permodel"],
            childTitle: (c) => ({ general: "General settings", permodel: "Per-model settings" })[c] || c
        }
    );
}

test("the engine declares the seven new runtime options", () => {
    for (const id of NEW_RUNTIME_OPTION_IDS) {
        assert.ok(engineDeclaresOption(id), id + " is not declared by DSLREngine");
    }
});

test("the seven new runtime options render in the localruntime general child", () => {
    const { form } = buildNewRuntimeOptionsForm();
    const top = form.find((node) => node.type === "fieldset" &&
        String(node.htmlClass).indexOf("option-section-localruntime") !== -1);
    assert.ok(top, "the runtime card is emitted");
    const general = top.items.find((node) => node.type === "fieldset" && node.title === "General settings");
    assert.ok(general, "the general child is emitted");
    assert.deepStrictEqual(general.items.map((n) => n.key), NEW_RUNTIME_OPTION_IDS,
        "all seven render, in declaration order, inside the general child");
});

test("the four draft/fit ids are routed to the localruntime general child", () => {
    const branch = runtimeGeneralBranchSrc();
    for (const id of NEW_DRAFT_FIT_IDS) {
        assert.match(branch, new RegExp("id === '" + id + "'"),
            id + " is not routed to the runtime general child");
    }
});

test("the three KV ids are routed to the localruntime general child", () => {
    const branch = runtimeGeneralBranchSrc();
    for (const id of NEW_KV_IDS) {
        assert.match(branch, new RegExp("id === '" + id + "'"),
            id + " is not routed to the runtime general child");
    }
});

// --- sectionPrepend: card-level lead-in nodes ----------------------------------------------
// The runtime card's Start/Stop buttons and status line sit directly under the card legend,
// ABOVE the help text and the general/per-model/role sub-groups - they are the card's primary
// action, not a member of any sub-group.
test("sectionPrepend leads a child-axis section, before help and child groups", () => {
    const { form } = build(
        [{ key: "card", title: "Card", help: "card help" }],
        [stubOption("serverOpt"), stubOption("panelOpt")],
        {
            sectionOf: (opt) => opt.getId() === "serverOpt"
                ? { parent: "card", child: "general" }
                : { parent: "card", child: "permodel" },
            childOrder: ["general", "permodel"],
            childTitle: (c) => c,
            sectionPrepend: { card: [
                { type: "help", helpvalue: "lead buttons" },
                { type: "help", helpvalue: "lead status" }
            ] }
        }
    );
    const card = fieldsetByClass(form, "option-section-card");
    assert.ok(card, "the card is emitted");
    assert.strictEqual(card.items[0].helpvalue, "lead buttons");
    assert.strictEqual(card.items[1].helpvalue, "lead status");
    assert.match(card.items[2].helpvalue, /card help/);
    const groups = card.items.filter((n) => n.type === "fieldset");
    assert.deepStrictEqual(groups.map((g) => g.title), ["general", "permodel"],
        "the child groups follow the lead-in nodes");
});

test("a section carrying only lead-in nodes is still emitted", () => {
    const { form } = build(
        [{ key: "card", title: "Card" }],
        [],
        {
            sectionPrepend: { card: [{ type: "help", helpvalue: "lead" }] }
        }
    );
    const card = fieldsetByClass(form, "option-section-card");
    assert.ok(card, "a lead-in-only section must not be skipped");
    assert.strictEqual(card.items.length, 1);
});
