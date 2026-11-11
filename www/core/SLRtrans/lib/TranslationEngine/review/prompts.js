"use strict";

const DEFAULTS = {
    qcSystem: [
        "You are QC-reviewing an English translation of a Japanese game against its source.",
        "The Japanese source is the only truth. This is adult fiction: explicit content must be preserved faithfully — flag softening, euphemism, omission, or summary as category content-softening.",
        "",
        "Text is sent in an escaped form. Commands and placeholders appear as tokens such as: [[PLACEHOLDERS]] — the parenthesis after each says what it stands for.",
        "Keep every token byte-identical: never translate, rename, drop, or reorder it. But read each token for what it stands for instead of treating it as a meaningless code: character-name tokens always stand for a person's name (players can rename them), so judge pronouns, honorifics, POV, and agreement as if a name stood there; nameplate tokens are similar to character name tokens, but more often just label who is speaking and are not part of a sentence; variable tokens usually hold a number or quantity (rarely a name) — read them as a value unless the context clearly uses one as a name; image, color, and escaped-part tokens are pure codes, compare them for presence and position only.",
        "",
        "You are given lines as:",
        "@N｜speaker｜source",
        "> English translation",
        "⏎ inside a line is an in-text line break. Use the speaker column (and any nameplate token) to catch POV breaks — e.g. first-person narration translated as if said by someone else.",
        "Compare each pair. Report ONLY defects worth an editor's time: real mistranslations, dropped meaning, POV breaks, register mismatches, term drift, refusal/softening. Do not nitpick style; do not invent problems.",
        "Describe the defect only — never propose replacement wording or example rephrasings. A quoted suggestion is copied into the retranslation order verbatim, and past suggestions have ordered a fix one round and condemned it the next.",
        "Do not report missing, extra, or mismatched quotation marks or brackets: quote and placeholder balance is enforced by separate absolute checks and a repair pass. Flag a quote problem only if it changes the meaning or attribution of the line.",
        "",
        "Response contract — exactly one line per defect, nothing else:",
        "@N｜severity｜category｜note",
        "or, for one defect over a contiguous span:",
        "@START-END｜severity｜category｜note",
        "severity is one of: low, medium, high.",
        "category is one of: mistranslation, omission, pov, register, term-inconsistency, content-softening, refusal, other.",
        "note is a short explanation under 300 characters.",
        "Never describe a multi-line defect only in prose while citing one @N; use an explicit @START-END head (max 64 lines) or one finding per row.",
        "",
        "If nothing qualifies, reply with exactly: CLEAN",
        "Never reply with an empty response."
    ].join("\n"),
    qcUser: "[[CONTEXT]]\n\nReview these lines:\n\n[[ROWS]]",
    judgeSystem: [
        "You are adjudicating a QC finding for a Japanese-to-English game translation.",
        "The Japanese source is the only truth. Judge whether the finding is supported by the source — not by English style preferences.",
        "Text is sent in an escaped form; commands appear as tokens such as: [[PLACEHOLDERS]] — the parenthesis after each says what it stands for. ⏎ inside a line is an in-text line break.",
        "Judge token findings on the same terms: a finding is supported if the translation broke a token (dropped, renamed, moved) or mishandled what it stands for (wrong pronoun or agreement for a character name); dismiss findings that ask for a token to be translated, renamed, or removed — a retranslation must keep every token byte-identical.",
        "",
        "You are given the finding, the surrounding rows (>> marks the flagged line), and any glossary/cast context.",
        "Dismiss findings the source does not support. Confirm findings the source does support.",
        "For example, dismiss a finding that orders a specific English word choice when the translation already carries the source meaning — e.g. demanding an onomatopoeia be rendered literally as a non-word like \"tsun-tsun\", or preferring one faithful phrasing over another.",
        "For example, dismiss a finding that only counts quotation marks or brackets (missing/extra quote with no change in meaning or attribution) — balance is enforced by absolute checks, not by retranslation.",
        "For example, confirm a finding when the translation drops, adds, or reverses source meaning — even if the English reads smoothly — or when explicit source content was softened into vagueness.",
        "",
        "Response contract — exactly these lines, nothing else:",
        "VERDICT: dismiss",
        "  OR",
        "VERDICT: redo",
        "WHY: <one sentence stating what the retranslation must get right — a requirement, never a replacement phrase>",
        "WHY names the property to satisfy (explicitness, POV, preserved meaning), not wording to use: quoting a replacement phrase orders the translator to write it, even when it contradicts the standing rules.",
        "For redo, WHY is required. Never add preamble or commentary.",
        "Adult content: if the finding is about softening and the source confirms it, confirm the finding."
    ].join("\n"),
    judgeUser: "[[CONTEXT]]\n\n[[FINDING]]\n\n[[ROWS]]"
};

function placeholderSummary(r) {
    r = r || {};
    const example = (v) => v.replace("$1", "1");
    const parts = [
        ["character name", r.person],
        ["nameplate name", r.name],
        ["color", r.color],
        ["image", r.image],
        ["variable", r.variable],
        ["escaped part", r.at]
    ].filter(([, v]) => v && typeof v === "string");
    return parts.map(([label, v]) => example(v) + " (" + label + ")").join(", ");
}

function substitute(template, vars) {
    let out = String(template || "");
    for (const key of Object.keys(vars)) {
        // Marker syntax deliberately avoids {{...}} / {[...]}: jsonform runs every
        // option value through Underscore with those as its interpolate/evaluate
        // delimiters, so a default prompt containing {{PLACEHOLDERS}} is compiled
        // as template code and throws ReferenceError when the Options form renders.
        out = out.split("[[" + key + "]]").join(vars[key] == null ? "" : String(vars[key]));
    }
    return out.replace(/\n{3,}/g, "\n\n").trim();
}

function buildMessages(role, replacers, overrides) {
    const summary = placeholderSummary(replacers);
    const systemTpl = (overrides && overrides.system) || DEFAULTS[role + "System"] || "";
    const userTpl = (overrides && overrides.user) || DEFAULTS[role + "User"] || "";
    return { system: substitute(systemTpl, { PLACEHOLDERS: summary }), userTemplate: userTpl };
}

function sectionsToText(sections) {
    if (!sections || !sections.length) return "";
    return sections
        .filter((s) => s && s[1])
        .map((s) => s[0] + ":\n" + s[1])
        .join("\n\n");
}

// Custom templates may drop the [[CONTEXT]] marker; glossary/scene context
// must still reach the reviewer, so append it instead of losing it silently.
function appendMissingSections(text, template, sections) {
    if (!sections || !sections.length) return text;
    if (String(template || "").indexOf("[[CONTEXT]]") !== -1) return text;
    const extra = sectionsToText(sections);
    return extra ? text + "\n\n" + extra : text;
}

function renderRows(rows) {
    return rows.map((r) => {
        const src = String(r.wireSrc == null ? "" : r.wireSrc).replace(/\n/g, "⏎");
        const dst = String(r.wireDst == null ? "" : r.wireDst).replace(/\n/g, "⏎");
        return "@" + r.index + "｜" + (r.speaker || "") + "｜" + src + "\n> " + dst;
    }).join("\n");
}

function renderJudgeRows(rows, targets) {
    return rows.map((r) => {
        const marker = targets.includes(r.index) ? ">>" : "  ";
        const src = String(r.wireSrc == null ? "" : r.wireSrc).replace(/\n/g, "⏎");
        const dst = String(r.wireDst == null ? "" : r.wireDst).replace(/\n/g, "⏎");
        return marker + " @" + r.index + "｜" + (r.speaker || "") + "｜" + src +
            "\n" + marker + " > " + dst;
    }).join("\n");
}

function renderFinding(finding) {
    const targets = finding.targets || [finding.line];
    const label = targets.length === 1 ? String(targets[0])
        : Math.min.apply(null, targets) + "-" + Math.max.apply(null, targets);
    return "FINDING @" + label + ": " + finding.severity + "｜" +
        finding.category + "｜" + finding.note;
}

// Prior attempts for the row under verdict, so a re-review (and its judge)
// sees what was already tried and ordered instead of re-litigating blind:
// entries are { text, why }. Kept short — the last three attempts, 300 chars
// each, newlines folded — so the history can neither flood the window nor
// smuggle a full alternative translation in for copying.
function renderHistory(history, label) {
    const list = Array.isArray(history) ? history.filter((h) => h) : [];
    if (!list.length) return "";
    const trim = (v) => String(v == null ? "" : v).replace(/\n/g, "⏎").slice(0, 300);
    const recent = list.slice(-3);
    const lines = recent.map((h, i) => {
        const n = list.length - recent.length + i + 1;
        const ruling = h.why ? trim(h.why) : "flagged without a redo order";
        return "Attempt " + n + " translation: " + trim(h.text) +
            "\nAttempt " + n + " ruling: " + ruling;
    });
    return "Previous attempts for @" + label + " — already tried: do not " +
        "repeat their rejected wording, and do not re-order what a previous " +
        "round already settled.\n" + lines.join("\n");
}

function renderQcUser(rows, sections, template, focusIndex, history) {
    const tpl = template || DEFAULTS.qcUser;
    let text = appendMissingSections(substitute(tpl, {
        CONTEXT: sectionsToText(sections), ROWS: renderRows(rows)
    }), tpl, sections);
    // Re-review scope: the retried row is the only verdict target; the rest
    // of the window is context for judging it. Lives in the user message so
    // it applies even with a customized QC system prompt.
    if (typeof focusIndex === "number") {
        text += "\n\nOnly row @" + focusIndex + " is under review — the other " +
            "rows are context for judging it, not review targets. Report " +
            "findings only for @" + focusIndex + ". If nothing qualifies for " +
            "@" + focusIndex + ", reply CLEAN.";
        if ((rows || []).some((r) => r && r.sourceOnly)) {
            text += " Rows shown without a translation are source-only " +
                "context, not review targets.";
        }
    }
    if (typeof focusIndex === "number") {
        const hist = renderHistory(history, focusIndex);
        if (hist) text += "\n\n" + hist;
    }
    return text;
}

function renderJudgeUser(finding, rows, sections, template, history) {
    const tpl = template || DEFAULTS.judgeUser;
    const targets = finding.targets || [finding.line];
    let text = appendMissingSections(substitute(tpl, {
        CONTEXT: sectionsToText(sections),
        FINDING: renderFinding(finding),
        ROWS: renderJudgeRows(rows, targets)
    }), tpl, sections);
    const hist = renderHistory(history, targets.length === 1 ? targets[0]
        : Math.min.apply(null, targets) + "-" + Math.max.apply(null, targets));
    if (hist) text += "\n\n" + hist;
    return text;
}

module.exports = {
    DEFAULTS, placeholderSummary, substitute, buildMessages,
    renderQcUser, renderJudgeUser, sectionsToText
};
