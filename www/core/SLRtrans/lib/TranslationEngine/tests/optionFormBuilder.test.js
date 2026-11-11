"use strict";
// OptionFormBuilder is DOM-free at build time (jQuery is only touched inside
// the onChange closures), so it loads under plain node with stub options.
const test = require("node:test");
const assert = require("node:assert");
const { OptionFormBuilder } = require("../OptionFormBuilder");

function stubOpt(id, value) {
    return {
        getId: () => id,
        getType: () => typeof value === "boolean" ? "boolean" : "string",
        getFormType: () => undefined,
        getValue: () => value,
        getDefault: () => "",
        getName: () => id,
        getDescription: () => id + " description",
        getFormOptions: () => ({}),
        getSchemaOptions: () => ({}),
        getChildForm: () => []
    };
}

const sections = [{ key: "connection", title: "Connection & Model" }];
const sectionOf = (option) => {
    const id = option.getId();
    if (id === "apiUrl") return { parent: "connection", child: "ep1" };
    if (id === "glossaryApiUrl" || id === "glossaryModel") return { parent: "connection", child: "glossary" };
    return { parent: "connection" };
};
const GATES = [{ urlId: "glossaryApiUrl", child: "glossary", label: "Glossary" }];

function buildWith(glossaryUrl) {
    const storedOptions = [
        stubOpt("apiUrl", "http://main.example/v1"),
        stubOpt("glossaryApiUrl", glossaryUrl),
        stubOpt("glossaryModel", "gloss-model")
    ];
    return OptionFormBuilder.build({
        storedOptions,
        engine: {},
        sections,
        sectionOf,
        childOrder: ["ep1", "glossary"],
        childTitle: (c) => c,
        roleGates: GATES
    });
}

function findGroup(form, child) {
    const section = form.find((n) => n && n.type === "fieldset");
    assert.ok(section, "section fieldset emitted");
    return section.items.find((n) => n && n.type === "fieldset" &&
        String(n.htmlClass || "").split(" ").includes("option-role-" + child));
}

test("role group with blank gate URL is marked inactive with a notice", () => {
    const built = buildWith("");
    const group = findGroup(built.form, "glossary");
    assert.ok(group, "glossary group emitted");
    assert.ok(String(group.htmlClass).split(" ").includes("option-role-inactive"),
        "inactive class present, got: " + group.htmlClass);
    const notice = group.items.find((n) => n && n.type === "help");
    assert.ok(notice, "inactive notice emitted");
    assert.ok(String(notice.helpvalue).includes("Glossary"),
        "notice names the role, got: " + notice.helpvalue);
});

test("role group with a set gate URL stays active without a notice", () => {
    const built = buildWith("http://gloss.example/v1");
    const group = findGroup(built.form, "glossary");
    assert.ok(group, "glossary group emitted");
    assert.ok(!String(group.htmlClass).split(" ").includes("option-role-inactive"),
        "no inactive class, got: " + group.htmlClass);
    assert.strictEqual(group.items.find((n) => n && n.type === "help"), undefined);
});

test("main group is never gated", () => {
    const built = buildWith("");
    const group = findGroup(built.form, "ep1");
    assert.ok(group, "ep1 group emitted");
    assert.ok(!String(group.htmlClass).split(" ").includes("option-role-inactive"));
});

test("role gates are exposed for the live onChange toggle", () => {
    const built = buildWith("");
    assert.deepStrictEqual(built.roleGates, GATES);
});

test("no roleGates param keeps every group active", () => {
    const built = OptionFormBuilder.build({
        storedOptions: [stubOpt("apiUrl", "http://main.example/v1"), stubOpt("glossaryApiUrl", ""), stubOpt("glossaryModel", "x")],
        engine: {},
        sections,
        sectionOf,
        childOrder: ["ep1", "glossary"],
        childTitle: (c) => c
    });
    const group = findGroup(built.form, "glossary");
    assert.ok(!String(group.htmlClass).split(" ").includes("option-role-inactive"));
});
