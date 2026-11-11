"use strict";
const test = require("node:test");
const assert = require("node:assert");
const p = require("../prompts");

test("placeholderSummary uses the live replacer spellings", () => {
    const s = p.placeholderSummary({
        person: "{PERSON$1}", name: "{NAME$1}", color: "{C$1}",
        image: "{I$1}", variable: "{V$1}", at: "{%$1}"
    });
    assert.ok(s.includes("{PERSON1}"));
    assert.ok(s.includes("{C1}"));
    assert.ok(s.includes("{%1}"));
});

test("buildMessages substitutes the placeholder summary", () => {
    const out = p.buildMessages("qc", {
        person: "{PERSON$1}", name: "{NAME$1}", color: "{C$1}",
        image: "{I$1}", variable: "{V$1}", at: "{%$1}"
    });
    assert.ok(out.system.length > 0);
    assert.ok(!out.system.includes("[[PLACEHOLDERS]]"));
    assert.ok(out.system.includes("{C1}"));
});

test("prompt templates avoid jsonform/Underscore template delimiters", () => {
    // jsonform renders every option value through Underscore with
    // interpolate {{...}} and evaluate {[...]}. A default prompt containing those
    // is compiled as template code and throws at Options-render time (the
    // ReferenceError: PLACEHOLDERS regression). Markers must use another syntax.
    for (const [key, value] of Object.entries(p.DEFAULTS)) {
        assert.ok(!value.includes("{{"), key + " contains '{{'");
        assert.ok(!value.includes("{["), key + " contains '{['");
    }
    // And the substituted output must likewise never re-introduce them from a marker.
    const out = p.buildMessages("qc", { color: "{C$1}" });
    assert.ok(!out.system.includes("{{"));
    assert.ok(!out.system.includes("{["));
});

test("qc system prompt treats tokens as byte-identical but name-aware", () => {
    const sys = p.DEFAULTS.qcSystem;
    assert.ok(sys.includes("byte-identical"));
    assert.ok(sys.includes("character-name"));
    assert.ok(sys.includes("nameplate"));
    assert.ok(sys.includes("variable"));
    assert.ok(!sys.includes("opaque"));
});

test("qc findings must describe the defect, never propose replacement wording", () => {
    const sys = p.DEFAULTS.qcSystem;
    assert.ok(sys.includes("never propose replacement wording"), sys);
});

test("judge WHY must state a requirement, never a replacement phrase", () => {
    const sys = p.DEFAULTS.judgeSystem;
    assert.ok(sys.includes("never a replacement phrase"), sys);
});

test("judge system prompt gives concrete dismiss and confirm examples", () => {
    const sys = p.DEFAULTS.judgeSystem;
    assert.ok(sys.includes("For example, dismiss"), sys);
    assert.ok(sys.includes("For example, confirm"), sys);
});

test("qc skips pure quote and bracket balance findings", () => {
    const sys = p.DEFAULTS.qcSystem;
    assert.ok(sys.includes("Do not report missing, extra, or mismatched quotation marks"), sys);
});

test("judge dismisses pure quote-balance findings", () => {
    const sys = p.DEFAULTS.judgeSystem;
    assert.ok(sys.includes("only counts quotation marks"), sys);
});

test("qc system prompt explains the wire legends", () => {
    const sys = p.DEFAULTS.qcSystem;
    assert.ok(sys.includes("⏎"));
    assert.ok(sys.includes("speaker"));
});

test("renderQcUser scopes a re-review to the retried row only", () => {
    const rows = [
        { index: 16, speaker: "", wireSrc: "a", wireDst: "A" },
        { index: 17, speaker: "", wireSrc: "b", wireDst: "B" }
    ];
    const scoped = p.renderQcUser(rows, [], undefined, 17);
    assert.ok(scoped.includes("Only row @17 is under review"), scoped);
    const full = p.renderQcUser(rows, [], undefined);
    assert.ok(!full.includes("under review"), full);
});

test("review sections render through [[CONTEXT]]", () => {
    const rows = [{ index: 0, speaker: "", wireSrc: "a", wireDst: "b" }];
    const text = p.renderQcUser(rows, [["Glossary", "まおう = Demon King"]], undefined);
    assert.ok(text.includes("Glossary:\nまおう = Demon King"), text);
});

test("review sections append when the template lacks [[CONTEXT]]", () => {
    const rows = [{ index: 0, speaker: "", wireSrc: "a", wireDst: "b" }];
    const text = p.renderQcUser(rows, [["Glossary", "まおう = Demon King"]],
        "Review these rows:\n\n[[ROWS]]");
    assert.ok(text.includes("まおう = Demon King"), text);
});

test("judge user message carries review sections too", () => {
    const rows = [{ index: 12, speaker: "", wireSrc: "a", wireDst: "b" }];
    const finding = { line: 12, severity: "medium", category: "mistranslation", note: "x" };
    const text = p.renderJudgeUser(finding, rows, [["Scene context", "fantasy world"]], undefined);
    assert.ok(text.includes("fantasy world"), text);
});

test("re-review scope marks translationless rows as source-only context", () => {
    const rows = [
        { index: 16, speaker: "", wireSrc: "a", wireDst: "A" },
        { index: 17, speaker: "", wireSrc: "b", wireDst: "B" },
        { index: 18, speaker: "", wireSrc: "c", wireDst: "", sourceOnly: true }
    ];
    const text = p.renderQcUser(rows, [], undefined, 17);
    assert.ok(text.includes("Only row @17 is under review"), text);
    assert.ok(text.includes("without a translation"), text);
    const plain = p.renderQcUser(rows.slice(0, 2), [], undefined, 17);
    assert.ok(!plain.includes("without a translation"), plain);
});

test("judge system prompt adjudicates tokens on the same terms", () => {
    const sys = p.DEFAULTS.judgeSystem;
    assert.ok(sys.includes("byte-identical"));
    assert.ok(sys.includes("⏎"));
    assert.ok(!sys.includes("opaque"));
});

test("renderQcUser marks each row with @index and both wire sides", () => {
    const text = p.renderQcUser([
        { index: 4, speaker: "しほ", wireSrc: "{%1}しほ{%2}", wireDst: "{%1}Shiho{%2}" }
    ], [["CAST", "しほ = Shiho"]]);
    assert.ok(text.includes("@4"));
    assert.ok(text.includes("{%1}しほ{%2}"));
    assert.ok(text.includes("> {%1}Shiho{%2}"));
    assert.ok(text.includes("CAST"));
});

test("renderJudgeUser includes the finding and ± rows", () => {
    const rows = [3, 4, 5].map((i) => ({
        index: i, speaker: "", wireSrc: "src" + i, wireDst: "dst" + i
    }));
    const text = p.renderJudgeUser(
        { line: 4, severity: "high", category: "pov", note: "wrong POV" }, rows, []);
    assert.ok(text.includes("FINDING @4"));
    assert.ok(text.includes("wrong POV"));
    assert.ok(text.includes(">> @4"));
});

test("renderQcUser shows prior attempts for the focused row", () => {
    const rows = [
        { index: 16, speaker: "", wireSrc: "a", wireDst: "A" },
        { index: 17, speaker: "", wireSrc: "b", wireDst: "B2" }
    ];
    const history = [
        { text: "B1", why: "keep it explicit" },
        { text: "B2", why: "keep it casual" }
    ];
    const text = p.renderQcUser(rows, [], undefined, 17, history);
    assert.ok(text.includes("Previous attempts for @17"), text);
    assert.ok(text.includes("B1"), text);
    assert.ok(text.includes("keep it explicit"), text);
    const plain = p.renderQcUser(rows, [], undefined, 17);
    assert.ok(!plain.includes("Previous attempts"), plain);
});

test("renderJudgeUser shows prior attempts with the finding", () => {
    const rows = [{ index: 4, speaker: "", wireSrc: "src4", wireDst: "dst4" }];
    const history = [{ text: "dst-old", why: "keep it explicit" }];
    const text = p.renderJudgeUser(
        { line: 4, severity: "high", category: "content-softening", note: "soft" },
        rows, [], undefined, history);
    assert.ok(text.includes("Previous attempts for @4"), text);
    assert.ok(text.includes("dst-old"), text);
    assert.ok(text.includes("keep it explicit"), text);
});
