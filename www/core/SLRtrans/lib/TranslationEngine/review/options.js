"use strict";
const TOGGLE_IDS = ["reviewTranslations", "reviewAutoFix", "reviewJudge"];
const PROMPT_IDS = [
    "reviewQcSystemPrompt", "reviewQcUserPrompt",
    "reviewJudgeSystemPrompt", "reviewJudgeUserPrompt"
];
const CONNECTION_IDS = [
    "reviewApiUrl", "reviewApiKey", "reviewModel",
    "reviewDoNotFixURL"
];
const SAMPLING_IDS = [
    "reviewTemperature", "reviewRequestDelay",
    "reviewTopK", "reviewTopP", "reviewMinP",
    "reviewRepeatPenalty", "reviewRepetitionPenalty",
    "reviewFrequencyPenalty", "reviewPresencePenalty",
    "reviewChatTemplateKwargs", "reviewCustomHeaders", "reviewCustomParameters",
    "reviewReasoningFormat", "reviewReasoningEffort", "reviewReasoningBudget"
];
const LIMITS_IDS = ["reviewMaxTokens", "reviewMaxContextLength"];
// Display toggles for the Review calls' own streaming UI: the live token
// counter in the loading console and the streamed-response preview above it.
// Mirrors the translation/glossary pair (Disable Stream / Enable Token
// Progress Display / Enable Stream Preview Display).
const DISPLAY_IDS = [
    "reviewDisableStream", "reviewEnableTokenProgress", "reviewEnableStreamPreview"
];
// Behavioural knobs that sit next to the two toggles in Retry & Quality Control.
const RETRY_IDS = [...TOGGLE_IDS, "reviewRetryRounds", "reviewMinSeverity", "reviewEscalateMinSeverity"];
const REVIEW_OPTION_IDS = [
    ...RETRY_IDS, ...PROMPT_IDS, ...CONNECTION_IDS, ...SAMPLING_IDS, ...LIMITS_IDS,
    ...DISPLAY_IDS
];

// Review options mirror the Glossary role's connection/sampling/limits set.
// Placement: toggles sit at the Retry section level; prompts, connection,
// sampling and limits options get the `review` child group of their concern.
// The three display toggles live with the other sampling options.
function concernFor(id) {
    if (RETRY_IDS.includes(id)) return { parent: "retry" };
    if (PROMPT_IDS.includes(id)) return { parent: "prompts", child: "review" };
    if (CONNECTION_IDS.includes(id)) return { parent: "connection", child: "review" };
    if (SAMPLING_IDS.includes(id)) return { parent: "sampling", child: "review" };
    if (LIMITS_IDS.includes(id)) return { parent: "limits", child: "review" };
    if (DISPLAY_IDS.includes(id)) return { parent: "sampling", child: "review" };
    return null;
}

function createReviewOptions(wrapper, Option, categories) {
    const OPTS = categories.OPTIONS;
    const PROMPTS = categories.PROMPTS;
    const mk = (id, def, description, name, extra) =>
        new Option(Object.assign({ wrapper, id, default: def, description, name, category: OPTS }, extra));
    const prompts = require("./prompts").DEFAULTS;
    const inherit = " If the Review API URL is blank, the translation endpoint is used with all of its options and this field is ignored; if the Review API URL is set, only the Review fields are used (a blank field is sent as blank, never copied from translation).";
    const REASONING_FORMAT_EXTRA = {
        formType: "select",
        schemaOptions: { enum: ["none", "not_enabled", "openai_effort", "thinking_object", "gemini", "qwen"] },
        formOptions: { titleMap: { none: "None (disabled - turns thinking off where the endpoint allows)", not_enabled: "Not enabled (sends no disable parameter)", openai_effort: "OpenAI reasoning_effort (o-series / GPT-5 / OpenRouter / Ollama)", thinking_object: "OpenAI-compatible thinking object (LM Studio / vLLM)", gemini: "Gemini thinkingConfig (native Google API)", qwen: "Qwen3 enable_thinking" } }
    };
    const REASONING_EFFORT_EXTRA = {
        formType: "select",
        schemaOptions: { enum: ["minimal", "low", "medium", "high", "max"] },
        formOptions: { titleMap: { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", max: "Max" } }
    };

    return [
        // Toggles
        mk("reviewTranslations", false,
            "After each batch, ask the model to review the translations against the source and tag suspect rows medium purple. Runs independently of the built-in length-ratio purple check, which stays active.",
            "Review Translations (tag suspicions medium purple)", { formType: "checkbox" }),
        mk("reviewAutoFix", false,
            "Judge every medium-purple-flagged row from Review Translations and retranslate the confirmed ones through the normal translator, then re-check them. Has no effect unless Review Translations is on.",
            "Auto-Fix Flagged Translations", { formType: "checkbox" }),
        mk("reviewJudge", true,
            "Adjudicate QC findings with the Judge model before acting on them. On (default): each finding is judged, and only a confirmed redo orders a retranslation, so QC false positives are filtered out. Off: every finding at or above Review Minimum Severity orders the retranslation directly and the Judge call is skipped entirely (the Review: Judge prompts are unused) — faster and cheaper, meant for setups where the Review model is the same as the translation model, at the cost of QC false positives each costing a retranslation and re-review. Has no effect unless Review Translations is on.",
            "Judge QC Findings", { formType: "checkbox" }),
        mk("reviewRetryRounds", 5,
            "How many times a judge-confirmed line may be retranslated and re-reviewed within a batch before it is left medium purple. 0 = flag medium purple only, never retranslate.",
            "Review Retry Rounds", { type: "number" }),
        mk("reviewMinSeverity", "low",
            "Only findings at or above this severity trigger a retranslation; lower-severity findings still tag the row medium purple.",
            "Review Minimum Severity", { formType: "select", schemaOptions: { enum: ["low", "medium", "high"] }, formOptions: { titleMap: { low: "Low (retranslate any finding)", medium: "Medium and above", high: "High only" } } }),
        mk("reviewEscalateMinSeverity", true,
            "Re-reviews raise the bar progressively: the first re-review judges at Review Minimum Severity, then each further round one rank higher (Low→Medium→High, capped at High), so a style nit that ordered one retry cannot order the next by itself and the bar tightens as a row burns attempts. Disable to re-review every round at Review Minimum Severity.",
            "Escalate Minimum Severity on Re-Review", { formType: "checkbox" }),

        // Prompts
        mk("reviewQcSystemPrompt", prompts.qcSystem,
            "System prompt for the semantic review (QC) call. Uses the same escaped placeholder form as translation.",
            "Review: QC System Prompt", { category: PROMPTS, formType: "ace", formOptions: { aceTheme: "twilight", height: "300px" } }),
        mk("reviewQcUserPrompt", prompts.qcUser,
            "User prompt wrapper for the review call. [[ROWS]] and [[CONTEXT]] are replaced with the rendered lines.",
            "Review: QC User Prompt", { category: PROMPTS, formType: "ace", formOptions: { aceTheme: "twilight", height: "120px" } }),
        mk("reviewJudgeSystemPrompt", prompts.judgeSystem,
            "System prompt for adjudicating one QC finding.",
            "Review: Judge System Prompt", { category: PROMPTS, formType: "ace", formOptions: { aceTheme: "twilight", height: "220px" } }),
        mk("reviewJudgeUserPrompt", prompts.judgeUser,
            "User prompt wrapper for the judge call. [[FINDING]], [[ROWS]] and [[CONTEXT]] are replaced.",
            "Review: Judge User Prompt", { category: PROMPTS, formType: "ace", formOptions: { aceTheme: "twilight", height: "120px" } }),

        // Connection
        mk("reviewApiUrl", "",
            "API endpoint URL for Review (QC/Judge/Fix) calls." + inherit +
            " The URL is normalized like the translation endpoint unless 'Do not attempt to fix URL' is set.",
            "Review API URL", {}),
        mk("reviewApiKey", "",
            "API key for Review calls." + inherit,
            "Review API Key", { formType: "password" }),
        mk("reviewModel", "",
            "Model to use for Review (QC/Judge/Fix)." + inherit + " Point this at a stronger or uncensored model if you have one.",
            "Review Model", {}),
        mk("reviewDoNotFixURL", false,
            "Skip URL normalization for Review and send the request to the Review API URL as typed.",
            "Review Do not attempt to fix URL", { formType: "checkbox" }),
        // Sampling
        mk("reviewTemperature", null,
            "Temperature for Review calls." + inherit,
            "Review temperature", { type: "number" }),
        mk("reviewRequestDelay", null,
            "Delay in milliseconds before the first Review request and as the floor for retry backoff." + inherit,
            "Review Request Delay", { type: "number" }),
        mk("reviewTopK", null,
            "Top-K sampling for Review calls. Leave empty to not send the parameter." + inherit,
            "Review top_k", { type: "number" }),
        mk("reviewTopP", null,
            "Top-P sampling for Review calls. Leave empty to not send the parameter." + inherit,
            "Review top_p", { type: "number" }),
        mk("reviewMinP", null,
            "Min-P sampling for Review calls. Leave empty to not send the parameter." + inherit,
            "Review min_p", { type: "number" }),
        mk("reviewRepeatPenalty", null,
            "repeat_penalty for Review calls (LM Studio / specific APIs)." + inherit,
            "Review repeat_penalty", { type: "number" }),
        mk("reviewRepetitionPenalty", null,
            "repetition_penalty for Review calls." + inherit,
            "Review repetition_penalty", { type: "number" }),
        mk("reviewFrequencyPenalty", null,
            "frequency_penalty for Review calls." + inherit,
            "Review frequency_penalty", { type: "number" }),
        mk("reviewPresencePenalty", null,
            "presence_penalty for Review calls." + inherit,
            "Review presence_penalty", { type: "number" }),
        mk("reviewChatTemplateKwargs", "",
            "chat_template_kwargs for Review calls (JSON)." + inherit,
            "Review chat_template_kwargs", {}),
        mk("reviewCustomHeaders", "{}",
            "Custom HTTP headers for Review requests in JSON format. Merged over the base headers.",
            "Review Custom Headers", { formType: "ace", formOptions: { aceTheme: "twilight", height: "100px" } }),
        mk("reviewCustomParameters", "{}",
            "Custom parameters for Review requests in JSON format, merged into the request body.",
            "Review Custom Parameters", { formType: "ace", formOptions: { aceTheme: "twilight", height: "100px" } }),
        mk("reviewReasoningFormat", "none",
            "How to trigger reasoning/thinking for Review calls.\n- None (disabled, recommended): turns thinking off using whatever disable parameter the endpoint understands; nothing is sent where no mechanism is known.\n- Not enabled: never asks for thinking and never sends a disable parameter either.\n- OpenAI reasoning_effort\n- OpenAI-compatible thinking object\n- Gemini thinkingConfig\n- Qwen3 enable_thinking\n\nCaution: reasoning makes every review call slower and more expensive.",
            "Review Reasoning Format", REASONING_FORMAT_EXTRA),
        mk("reviewReasoningEffort", "low",
            "Reasoning effort for Review calls. Maps to the effort string or a budget tier (minimal=256, low=1024, medium=4096, high=16384, max=65536).",
            "Review Reasoning Effort", REASONING_EFFORT_EXTRA),
        mk("reviewReasoningBudget", null,
            "Optional explicit reasoning token budget for Review calls, overriding the effort tier. Only used by the thinking-object and Gemini formats.",
            "Review Reasoning Budget (tokens)", { type: "number" }),

        // Limits
        mk("reviewMaxTokens", null,
            "Maximum tokens for Review responses. Seed reviews (whole batch) scale this down by input size like full-batch requests (chars x 1.5, 1000 floor); re-review retries (one row) scale it like single-line requests (chars x 3.5, 500 floor)." + inherit,
            "Review max_tokens Parameter", { type: "number" }),
        mk("reviewMaxContextLength", 0,
            "The Review model's total context window in tokens. When set, the glossary/scene sections carried by Review requests are trimmed to fit within the budget (response reserve + prompts + reviewed rows are never trimmed). Set to 0 to disable." + inherit,
            "Review Context Length Limit", { type: "number" }),

        // Streaming display (token counter + live preview in the loading
        // console). Same contract as the translation and glossary paths: the
        // counter drives streaming, the preview is display-only, and Disable
        // Stream forces both off.
        mk("reviewDisableStream", false,
            "Disables streaming for Review calls. Enable this only if your provider rejects streaming requests; review calls then behave exactly as before (single non-streaming request, no live counter or preview).",
            "Review Disable Stream", { formType: "checkbox" }),
        mk("reviewEnableTokenProgress", true,
            "Shows a live '[DSLRReview] Generating review response: N tokens' counter in the loading console while a Review call is generating. Internally this enables response streaming to count tokens. Sends 'stream: true' and 'stream_options: { include_usage: true }' (chat completions); most endpoints support this, but if your provider rejects streaming requests, disable it here or enable 'Review Disable Stream'.",
            "Review Enable Token Progress Display", { formType: "checkbox" }),
        mk("reviewEnableStreamPreview", true,
            "While a Review call is generating, shows its streamed text as a live preview above the token counter; the preview is removed once the call completes so the log does not grow. Disable this if you only want the token counter. Has no effect while 'Review Enable Token Progress Display' is off (that option drives the streaming both features run on).",
            "Review Enable Stream Preview Display", { formType: "checkbox" })
    ];
}

module.exports = {
    REVIEW_OPTION_IDS, DISPLAY_IDS, concernFor, createReviewOptions,
    TOGGLE_IDS, PROMPT_IDS, CONNECTION_IDS, SAMPLING_IDS, LIMITS_IDS
};
