// www/core/llmRuntime/tests/ReasoningCaps.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ReasoningCaps = require("../lib/ReasoningCaps");

const REAL_TEMPLATE = [
    "{%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}",
    "{%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}",
    "    {{- raise_exception('Unexpected reasoning effort') }}",
    "{%- endif %}"
].join("\n");

test("fromProps reads the advertised capabilities", () => {
    const caps = ReasoningCaps.fromProps({ chat_template_caps: {
        supports_reasoning_effort: true, supports_preserve_reasoning: true } });
    assert.strictEqual(caps.supportsEffort, true);
    assert.strictEqual(caps.supportsPreserve, true);
});

test("fromProps treats missing or malformed capability data as no support", () => {
    assert.strictEqual(ReasoningCaps.fromProps({}).supportsEffort, false);
    assert.strictEqual(ReasoningCaps.fromProps(null).supportsEffort, false);
    assert.strictEqual(ReasoningCaps.fromProps({ chat_template_caps: null }).supportsEffort, false);
    assert.strictEqual(ReasoningCaps.fromProps({ chat_template_caps: "nope" }).supportsEffort, false);
});

test("fromProps reads the effort values the template's own validator accepts", () => {
    const caps = ReasoningCaps.fromProps({ chat_template: REAL_TEMPLATE, chat_template_caps: {
        supports_reasoning_effort: true } });
    assert.deepStrictEqual(caps.efforts, ["xhigh", "medium", "low"]);
});

test("fromProps leaves efforts null when the template's values cannot be read", () => {
    const caps = ReasoningCaps.fromProps({ chat_template: "{{ messages }}", chat_template_caps: {
        supports_reasoning_effort: true } });
    assert.strictEqual(caps.efforts, null);
});

test("fromProps returns null efforts when a guard value is not a plain value name", () => {
    for (const template of [
        "{%- if reasoning_effort not in ('xhigh-2', 'medium') %}{%- endif %}",
        "{%- if reasoning_effort not in ('level_2', 'medium') %}{%- endif %}"
    ]) {
        const caps = ReasoningCaps.fromProps({ chat_template: template, chat_template_caps: {
            supports_reasoning_effort: true } });
        assert.strictEqual(caps.efforts, null);
    }
});

// A partial list is worse than no list: the caller would drop a tier the model actually accepts.
// An unquoted entry in the guard cannot be read as a value, so the whole list must yield null.
test("fromProps returns null efforts when any non-empty guard entry is unquoted", () => {
    for (const template of [
        "{%- if reasoning_effort not in ('xhigh', medium) %}{%- endif %}",
        "{%- if reasoning_effort not in (low, 'medium') %}{%- endif %}",
        "{%- if reasoning_effort not in (xhigh, medium) %}{%- endif %}"
    ]) {
        const caps = ReasoningCaps.fromProps({ chat_template: template, chat_template_caps: {
            supports_reasoning_effort: true } });
        assert.strictEqual(caps.efforts, null, template);
    }
    // A purely empty entry (a trailing comma) carries no value and is still readable.
    const trailing = ReasoningCaps.fromProps({
        chat_template: "{%- if reasoning_effort not in ('xhigh', 'medium',) %}{%- endif %}",
        chat_template_caps: { supports_reasoning_effort: true }
    });
    assert.deepStrictEqual(trailing.efforts, ["xhigh", "medium"]);
});

test("a silent body is left alone so the server default applies", () => {
    const body = { messages: [] };
    const r = ReasoningCaps.normalizeReasoning(body, { supportsEffort: true, efforts: ["low"] });
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.body, body);
    assert.deepStrictEqual(r.body, { messages: [] });
});

test("an explicit refusal stands and is never overridden", () => {
    const off = { messages: [], chat_template_kwargs: { enable_thinking: false } };
    assert.strictEqual(ReasoningCaps.normalizeReasoning(off, { supportsEffort: true }).changed, false);
    const none = { messages: [], reasoning_effort: "none" };
    assert.strictEqual(ReasoningCaps.normalizeReasoning(none, { supportsEffort: true }).changed, false);
    const disabled = { messages: [], thinking: { type: "disabled" } };
    assert.strictEqual(ReasoningCaps.normalizeReasoning(disabled, { supportsEffort: true }).changed, false);
});

test("a refusal wins when a body both asks for and refuses reasoning", () => {
    const mixed = { messages: [], reasoning_effort: "medium", thinking: { type: "disabled" } };
    const r1 = ReasoningCaps.normalizeReasoning(mixed, { supportsEffort: true, efforts: ["medium"] });
    assert.strictEqual(r1.changed, false);
    assert.strictEqual(r1.body, mixed);
    const mixed2 = { messages: [], reasoning_effort: "none", chat_template_kwargs: { enable_thinking: true } };
    const r2 = ReasoningCaps.normalizeReasoning(mixed2, { supportsEffort: true });
    assert.strictEqual(r2.changed, false);
    assert.strictEqual(r2.body, mixed2);
});

test("every shape of 'asks for reasoning' turns reasoning on", () => {
    const caps = { supportsEffort: true, efforts: ["low", "medium", "xhigh"] };
    const bodies = [
        { messages: [], reasoning_effort: "medium" },
        { messages: [], thinking: { type: "enabled" } },
        { messages: [], generationConfig: { thinkingConfig: { thinkingBudget: 1024 } } },
        { messages: [], chat_template_kwargs: { enable_thinking: true } }
    ];
    for (const body of bodies) {
        const r = ReasoningCaps.normalizeReasoning(body, caps);
        assert.strictEqual(r.changed, true);
        assert.strictEqual(r.body.chat_template_kwargs.enable_thinking, true);
    }
});

test("a change never mutates the caller's body or its nested kwargs", () => {
    const body = { messages: [], reasoning_effort: "low", chat_template_kwargs: { temperature: 0.7 } };
    const r = ReasoningCaps.normalizeReasoning(body, { supportsEffort: true, efforts: ["low"] });
    assert.strictEqual(r.changed, true);
    assert.notStrictEqual(r.body, body);
    assert.strictEqual(r.body.chat_template_kwargs.enable_thinking, true);
    assert.strictEqual(body.chat_template_kwargs.enable_thinking, undefined);
    assert.deepStrictEqual(body, { messages: [], reasoning_effort: "low", chat_template_kwargs: { temperature: 0.7 } });
});

test("the tier is kept only when the model advertises it and accepts the value", () => {
    const caps = { supportsEffort: true, efforts: ["low", "medium", "xhigh"] };
    const kept = ReasoningCaps.normalizeReasoning({ messages: [], reasoning_effort: "medium" }, caps);
    assert.strictEqual(kept.body.reasoning_effort, "medium");
    assert.strictEqual(kept.droppedEffort, false);
    const rejected = ReasoningCaps.normalizeReasoning({ messages: [], reasoning_effort: "high" }, caps);
    assert.strictEqual(rejected.body.reasoning_effort, undefined);
    assert.strictEqual(rejected.droppedEffort, true);
    assert.strictEqual(rejected.body.chat_template_kwargs.enable_thinking, true);
});

test("an unsupported model gets no tier but still gets the request", () => {
    const r = ReasoningCaps.normalizeReasoning({ messages: [], reasoning_effort: "high" },
        { supportsEffort: false, efforts: null });
    assert.strictEqual(r.body.reasoning_effort, undefined);
    assert.strictEqual(r.droppedEffort, true);
    assert.strictEqual(r.body.chat_template_kwargs.enable_thinking, true);
});

test("advertised support with unreadable values sends the tier and defers to the retry", () => {
    const r = ReasoningCaps.normalizeReasoning({ messages: [], reasoning_effort: "high" },
        { supportsEffort: true, efforts: null });
    assert.strictEqual(r.body.reasoning_effort, "high");
    assert.strictEqual(r.droppedEffort, false);
});

test("normalizeReasoning never throws on a non-object body", () => {
    for (const bad of [null, undefined, "x", 42, []]) {
        const r = ReasoningCaps.normalizeReasoning(bad, { supportsEffort: true });
        assert.strictEqual(r.changed, false);
    }
});