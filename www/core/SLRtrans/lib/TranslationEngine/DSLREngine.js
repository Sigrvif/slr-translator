"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.DSLREngine = void 0;
exports.localRuntimeStopDecision = void 0;
exports.localRuntimeModelProfiles = void 0;
exports.runtimeChoiceOptions = void 0;
exports.runtimeFieldHints = void 0;
exports.runtimeHardwareNote = void 0;
exports.runtimeProfilePatch = void 0;
exports.rolePickerUpdates = void 0;
exports.roleReloadNote = void 0;
const TranslationEngineOption_1 = require("./TranslationEngineOption");
const ModelProfiles_1 = require("../../../llmRuntime/lib/ModelProfiles");
const RoleBinding_1 = require("./RoleBinding");
const DSLRTranslationEngineWrapper_1 = require("./DSLRTranslationEngineWrapper");
const EndpointHelpers_1 = require("./EndpointHelpers");
const ResponsesApiHelpers_1 = require("./ResponsesApiHelpers");
const EndpointHealth_1 = require("./endpointHealth");
const ReviewModel_1 = require("./review/model");
// How long a single review call will wait out a cooling endpoint before giving
// up and failing closed. Short enough not to stall the batch, long enough to
// ride out a first-offense 429 (10s) or an unstable-endpoint cooldown (30s).
const REVIEW_COOLDOWN_WAIT_CAP_MS = 30000;
try {
    window.transConfig = JSON.parse(localStorage.getItem('Config'));
} catch (e) {
    console.log(e);
}
function _estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    var cjkCount = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g) || []).length;
    var otherCount = text.length - cjkCount;
    return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}
function _trimToTokenBudget(text, maxTokens) {
    if (!text) return "";
    if (maxTokens <= 0) return "";
    if (_estimateTokens(text) <= maxTokens) return text;
    var lines = text.split("\n");
    var result = [];
    var tokenSum = 0;
    for (var i = 0; i < lines.length; i++) {
        var lineTokens = _estimateTokens(lines[i]) + 1;
        if (tokenSum + lineTokens > maxTokens) break;
        tokenSum += lineTokens;
        result.push(lines[i]);
    }
    return result.length > 0 ? result.join("\n") : "";
}
function _applyDSLRReplacers(text, engine) {
    if (!text) return text;
    var result = text;
    var nRep = engine.optionNameCommandReplacer && engine.optionNameCommandReplacer.getValue();
    if (nRep) result = result.replaceAll(/\\n\[(\d+)\]/gi, nRep);
    var nwRep = engine.optionCharacterCommandReplacer && engine.optionCharacterCommandReplacer.getValue();
    if (nwRep) result = result.replaceAll(/\\nw\[(\d+)\]/gi, nwRep);
    var iRep = engine.optionImageCommandReplacer && engine.optionImageCommandReplacer.getValue();
    if (iRep) result = result.replaceAll(/\\i\[(\d+)\]/gi, iRep);
    var vRep = engine.optionVariableCommandReplacer && engine.optionVariableCommandReplacer.getValue();
    if (vRep) result = result.replaceAll(/\\v\[(\d+)\]/gi, vRep);
    var cRep = engine.optionColorCommandReplacer && engine.optionColorCommandReplacer.getValue();
    if (cRep) result = result.replaceAll(/\\c\[(\d+)\]/gi, cRep);
    var pRep = engine.optionPlaceholderReplacer && engine.optionPlaceholderReplacer.getValue();
    if (pRep) result = result.replaceAll(/@(\d+)/gi, pRep);
    return result;
}
function _responseBodyIsStreamable(response) {
    try {
        if (!response || response.ok === false) return false;
        if (!response.body || typeof response.body.getReader !== 'function') return false;
        return true;
    } catch (e) {
        return false;
    }
}
// Decide whether the "Stop Local Runtime" button may stop the server. Ownership only: a
// runtime this window ATTACHED to (Start found one already running) belongs to the standalone
// console launcher (SLR Runtime), so stopping it from here cannot stop anything - it would
// only disconnect this window. Fails OPEN: a missing or stale status must never prevent a
// legitimate stop of a runtime this window owns. This pure function is the part under unit
// test; the Stop button's onClick consults it at click time and shows the message through
// the status line when it refuses.
function localRuntimeStopDecision(state) {
    if (!state || state.attached !== true) return { allowed: true, message: "" };
    return {
        allowed: false,
        message: 'The running runtime belongs to the SLR Runtime console launcher, not this window. ' +
            'Stopping it here would only disconnect this editor; stop the server from its console window (Ctrl+C or the --stop switch).'
    };
}
// Drop the legacy option values that are not real choices (empty string, null, undefined and
// the NaN the handler produces for an empty number field). ModelProfiles.migrate already skips
// "", null and undefined, but not NaN; a NaN would survive as NaN and JSON.stringify to null,
// which Task 9b's resolveProfile would then lay over the default. Normalising here keeps the
// seeded profile to the values the user actually chose.
function _sanitizeLegacyProfiles(legacy) {
    var out = {};
    var src = legacy && typeof legacy === "object" ? legacy : {};
    for (var key in src) {
        if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
        var value = src[key];
        if (value === undefined || value === null || value === "") continue;
        if (typeof value === "number" && isNaN(value)) continue;
        out[key] = value;
    }
    return out;
}
// Resolve the persisted per-model profile map the Start handler carries to the runtime. `raw`
// is the runtimeModelProfiles option's stored value (a JSON string, "" when never set). A
// missing, invalid, non-object or array value degrades to {} rather than throwing, so a corrupt
// config can never stop a start. When the resulting map is empty - the first start after
// per-model settings shipped - it is seeded once from the legacy model-level options plus the
// selected model's data/llama/drafts.json pairing via ModelProfiles.migrate; the caller persists
// what is returned. StartConfig then applies each model's own profile to its server arguments.
// Pure and unit-tested (dslrEngineRequest.test.js).
function localRuntimeModelProfiles(input) {
    var opts = input || {};
    var map = {};
    var raw = opts.raw;
    if (typeof raw === "string" && raw !== "") {
        try {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed;
        } catch (e) { map = {}; }
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        // Tolerate an already-parsed map as well as the stored JSON string.
        map = raw;
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) map = {};
    if (Object.keys(map).length === 0) {
        map = ModelProfiles_1.migrate({
            legacy: _sanitizeLegacyProfiles(opts.legacy),
            drafts: opts.drafts && typeof opts.drafts === "object" ? opts.drafts : {},
            selectedId: opts.selectedId
        });
    }
    return map;
}
// --- Task 11: per-model panel + role picker helpers ------------------------------------------
// The Models panel and the Role assignment panel are thin DOM shells around these three pure
// functions. Keeping the decisions here (rather than in the jsonform node callbacks) means the
// whole behaviour that matters - what the choice lists contain, how a typed field is coerced for
// the persisted profile map, and what option updates a role pick produces - is unit-tested.
//
// Field classes of a ModelProfiles profile. StartConfig requires Number.isInteger for
// contextLength / draftMax / draftMin and treats the other numerics strictly, so every numeric
// field is coerced to a real number (never NaN). A cleared field is never omitted:
// ModelProfiles.setProfile merges, so an omitted key would let a previously stored override
// survive and reappear. Most cleared numerics persist an explicit null (StartConfig ignores a
// non-integer/null and falls back to the default, and the panel shows null as empty); the
// empty-string classes below persist "" instead, because ModelProfiles.validate rejects null for
// those fields specifically.
var _INTEGER_PROFILE_FIELDS = {
    contextLength: true, cpuMoeLayers: true, mainGpu: true,
    expertCount: true, draftMax: true, draftMin: true, parallelSlots: true,
    draftCpuMoeLayers: true
};
var _BOOLEAN_PROFILE_FIELDS = { cpuMoe: true, draftCpuMoe: true };
var _STRING_PROFILE_FIELDS = {
    kvTypeK: true, kvTypeV: true, loadMode: true, splitMode: true, tensorSplit: true,
    overrideTensor: true
};
// Strings whose cleared state is the default's own empty string, not null. The stored profile is
// also checked against ModelProfiles.validate, and for these fields validate's raw-profile guard
// rejects null (e.g. "unknown draft cache type: null"): only "" or a real value is valid. The
// ordinary string class above keeps null because Validate accepts null there; these do not.
var _EMPTY_STRING_PROFILE_FIELDS = { draftKvType: true };
// Integers whose cleared state is also the empty string, for the same reason: validate's
// positiveIntOrEmpty accepts "" or a positive integer and rejects null, so a cleared batch size
// must store "". The integer class above keeps null because validate accepts null there.
var _EMPTY_INTEGER_PROFILE_FIELDS = { batchSize: true, ubatchSize: true, moeCacheMib: true, draftUbatchSize: true };
// The draft probability threshold is a fractional probability, so it is coerced separately below.
var _NUMBER_PROFILE_FIELDS = { specDraftPMin: true };
var _MODE_PROFILE_FIELDS = { specMode: true, mmprojMode: true };
var _ID_PROFILE_FIELDS = { draftId: true, mmprojId: true };
// The profile fields the per-model panel exposes, in their rtProfile_<field> form. Used by
// refreshPanelValues to republish the stored profile's display values at render time.
var _PANEL_PROFILE_FIELDS = [
    "contextLength", "parallelSlots", "kvTypeK", "kvTypeV", "batchSize", "ubatchSize",
    "gpuLayers", "cpuMoe", "cpuMoeLayers", "loadMode", "splitMode", "tensorSplit",
    "mainGpu", "overrideTensor", "expertCount", "moeCacheMib", "draftMax", "draftMin",
    "draftGpuLayers", "draftCpuMoe", "draftCpuMoeLayers", "draftUbatchSize", "draftKvType", "specDraftPMin"
];

function _profileInteger(raw) {
    if (raw === undefined || raw === null) return undefined;
    var text = String(raw).trim();
    if (text === "") return undefined;
    var n = Number(text);
    if (!isFinite(n)) return undefined;
    return Math.round(n);
}

// A real, unrounded number for the fractional profile fields (the draft probability threshold).
// Returns undefined for an empty/invalid field so the caller can clear the stored override.
function _profileNumber(raw) {
    if (raw === undefined || raw === null) return undefined;
    var text = String(raw).trim();
    if (text === "") return undefined;
    var n = Number(text);
    if (!isFinite(n)) return undefined;
    return n;
}

// Turn one raw form value into the profile patch ModelProfiles.setProfile should apply. Numeric
// fields coerce ("8192" -> 8192) and a cleared/invalid numeric field becomes an explicit null so
// the stored override is cleared. Strings trim, gpuLayers and draftGpuLayers are "auto" or an
// integer, booleans become real booleans, and the spec/projector mode and id fields normalize to
// the values StartConfig reads ("auto"/"off" and a draft/projector id or null). Unknown fields
// produce an empty patch.
function runtimeProfilePatch(field, raw) {
    var key = String(field === undefined || field === null ? "" : field);
    var patch = {};
    if (_INTEGER_PROFILE_FIELDS[key]) {
        var n = _profileInteger(raw);
        patch[key] = (n === undefined) ? null : n;
        return patch;
    }
    if (_EMPTY_INTEGER_PROFILE_FIELDS[key]) {
        var en = _profileInteger(raw);
        // An explicit 0 (or a negative) is not a usable batch size: ModelProfiles.validate's
        // positiveIntOrEmpty only accepts "" or a positive integer, so normalise those to "" and
        // never persist a value the profile's own validator rejects.
        patch[key] = (en === undefined || en <= 0) ? "" : en;
        return patch;
    }
    if (_NUMBER_PROFILE_FIELDS[key]) {
        // A fractional field (the draft probability threshold). Unlike the integer class, a
        // cleared field stores the default's own empty string, not null: ModelProfiles.validate
        // accepts "" as "flag off" but rejects null, and StartConfig's typeof-number guard
        // ignores both.
        var p = _profileNumber(raw);
        patch[key] = (p === undefined) ? "" : p;
        return patch;
    }
    if (_BOOLEAN_PROFILE_FIELDS[key]) {
        patch[key] = raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "on";
        return patch;
    }
    if (key === "gpuLayers" || key === "draftGpuLayers") {
        if (raw !== undefined && raw !== null) {
            var gtext = String(raw).trim();
            if (gtext.toLowerCase() === "auto") { patch[key] = "auto"; return patch; }
            var gl = _profileInteger(gtext);
            if (gl !== undefined) { patch[key] = gl; return patch; }
        }
        patch[key] = null;
        return patch;
    }
    if (_STRING_PROFILE_FIELDS[key]) {
        var text = (raw === undefined || raw === null) ? "" : String(raw).trim();
        patch[key] = (text === "") ? null : text;
        return patch;
    }
    if (_EMPTY_STRING_PROFILE_FIELDS[key]) {
        // The "Default" selection clears this field back to its empty-string default, which is
        // what ModelProfiles.validate accepts; null would be rejected as an unknown cache type.
        var etext = (raw === undefined || raw === null) ? "" : String(raw).trim();
        patch[key] = etext;
        return patch;
    }
    if (_MODE_PROFILE_FIELDS[key]) {
        patch[key] = (String(raw) === "off") ? "off" : "auto";
        return patch;
    }
    if (_ID_PROFILE_FIELDS[key]) {
        if (raw === undefined || raw === null) { patch[key] = null; return patch; }
        var id = String(raw).trim();
        if (id === "" || id === "auto" || id === "off" || id === "none") { patch[key] = null; return patch; }
        patch[key] = id;
        return patch;
    }
    return patch;
}

// Build the option lists (and current selections) for the speculative-decoding and vision-projector
// controls from the detection result (associations().byTarget[id]) plus the model's stored profile.
// `Auto` is labelled with what detection found (kind + file for a draft, file for a projector).
// The explicit candidates are FILE ids supplied by the caller (llmRuntime.candidateDraftsFor /
// candidateProjectorsFor); detection's own `.candidates` (the sides that claimed the model) are
// informational and are never used as select values, because the persisted draftId/mmprojId is
// joined to the models directory and looked up among the draft/projector files. A stored forced
// id that is no longer offered is kept so the select never loses the user's choice. `ambiguous`
// is surfaced as a note.
function runtimeChoiceOptions(input) {
    var opts = input || {};
    var detection = opts.detection || {};
    var profile = opts.profile || {};
    var draft = detection.draft || null;
    var mmproj = detection.mmproj || null;
    // The selected target's own facts. A model with a built-in MTP head IS speculative
    // decoding active with nothing paired, so the picker must not claim "none detected".
    var embeddedHead = !!(opts.info && opts.info.mtpCapable === true);

    function candidateIds(list) {
        var out = [];
        var items = Array.isArray(list) ? list : [];
        for (var c = 0; c < items.length; c++) {
            var item = items[c];
            var id = (item === null || item === undefined) ? "" : (typeof item === "string" ? item : item.id);
            if (id && out.indexOf(id) === -1) out.push(String(id));
        }
        return out;
    }
    // The chosen entry itself, not just its id: the candidate list carries `kind` /
    // `embeddedHead` from detection (Task 2), which is what tells whether an external file is
    // being used for a model that already has its own MTP head. The id list above is still what
    // the select offers; this is only for the note, so the raw list is read before reduction.
    function findCandidate(list, id) {
        var items = Array.isArray(list) ? list : [];
        for (var c = 0; c < items.length; c++) {
            var item = items[c];
            if (item && typeof item === "object" && String(item.id) === String(id)) return item;
        }
        return null;
    }
    var specCandidates = candidateIds(opts.draftCandidates);
    var specValue = "auto";
    if (profile.specMode === "off") specValue = "off";
    else if (profile.draftId) specValue = String(profile.draftId);
    var specOptions = [
        { value: "auto", title: draft ? "Auto (" + (draft.specType || "detected") + " \u00b7 " + draft.id + ")"
            : (embeddedHead ? "Auto (built-in MTP head)" : "Auto (none detected)") },
        { value: "off", title: "Off (no speculative decoding)" }
    ];
    for (var i = 0; i < specCandidates.length; i++) specOptions.push({ value: specCandidates[i], title: specCandidates[i] });
    if (specValue !== "auto" && specValue !== "off" && specCandidates.indexOf(specValue) === -1) {
        specOptions.push({ value: specValue, title: specValue + " (not detected)" });
    }

    var mmCandidates = candidateIds(opts.mmprojCandidates);
    var mmValue = "auto";
    if (profile.mmprojMode === "off") mmValue = "off";
    else if (profile.mmprojId) mmValue = String(profile.mmprojId);
    var mmOptions = [
        { value: "auto", title: mmproj ? "Auto (" + mmproj.id + ")" : "Auto (none detected)" },
        { value: "off", title: "Off (no vision projector)" }
    ];
    for (var j = 0; j < mmCandidates.length; j++) mmOptions.push({ value: mmCandidates[j], title: mmCandidates[j] });
    if (mmValue !== "auto" && mmValue !== "off" && mmCandidates.indexOf(mmValue) === -1) {
        mmOptions.push({ value: mmValue, title: mmValue + " (not detected)" });
    }

    var specAmbiguous = !!(draft && draft.ambiguous);
    var mmAmbiguous = !!(mmproj && mmproj.ambiguous);
    // Two honest notes can apply, so they are concatenated rather than one winning: the
    // ambiguity warning is about the picker's own list, the embedded-head one about the choice
    // the relaxation made.
    var specNotes = [];
    if (specAmbiguous) specNotes.push("Several draft files match this model; pick one explicitly to be sure.");
    var chosen = (specValue !== "auto" && specValue !== "off") ? findCandidate(opts.draftCandidates, specValue) : null;
    if (chosen && chosen.embeddedHead) {
        specNotes.push("This model already has an embedded MTP head; the external head is used instead.");
    } else if (embeddedHead && !draft) {
        specNotes.push("This model has a built-in MTP head and drafts for itself; no separate draft model is needed. The draft token fields bound the head's proposals.");
    }
    return {
        spec: {
            value: specValue,
            ambiguous: specAmbiguous,
            note: specNotes.join(" "),
            options: specOptions
        },
        mmproj: {
            value: mmValue,
            ambiguous: mmAmbiguous,
            note: mmAmbiguous ? "Several projector files match this model; pick one explicitly to be sure." : "",
            options: mmOptions
        }
    };
}

// Turn (role, chosen model id, port) into the engine option updates a role picker must apply:
// RoleBinding.bindingsFor for a real model, or clearing both the model and URL when the user
// picks the "not bundled" choice. Unknown roles throw via RoleBinding, as does bindingsFor.
function rolePickerUpdates(role, modelId, port) {
    var chosen = (modelId === undefined || modelId === null) ? "" : String(modelId).trim();
    if (chosen === "" || chosen === "none") {
        return [
            { id: RoleBinding_1.roleModelOption(role), value: "" },
            { id: RoleBinding_1.roleUrlOption(role), value: "" }
        ];
    }
    return RoleBinding_1.bindingsFor(role, chosen, port);
}

// The reload warning shown under the role pickers: only when the runtime may keep one model
// loaded (modelsMax === 1) and the roles point at more than one distinct local model, so a role
// switch forces a reload. Returns "" when no warning applies.
function roleReloadNote(modelIds, modelsMax) {
    if (Number(modelsMax) !== 1) return "";
    var list = modelIds || [];
    var seen = {};
    var distinct = 0;
    for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m === undefined || m === null || String(m).trim() === "") continue;
        var key = String(m);
        if (!Object.prototype.hasOwnProperty.call(seen, key)) { seen[key] = true; distinct++; }
    }
    if (distinct <= 1) return "";
    return "Roles use different local models. Because 'models kept loaded' is 1, switching roles reloads the model.";
}

// Group an integer's digits in threes for readability ("262144" -> "262,144"). A plain string
// helper on purpose: no Intl/locale dependency, so every machine shows the same text.
function _formatGroupedInt(value) {
    var n = (typeof value === "number" && isFinite(value)) ? Math.trunc(value) : null;
    if (n === null) return "";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function _hintInt(value) {
    return (typeof value === "number" && isFinite(value)) ? Math.trunc(value) : null;
}

// Short per-field sentences shown under the Models panel's inputs: the selected model's own
// limits (trained context, layer count, expert counts) and the effective value of a field left
// empty. `info` is that model's ModelInfo and may be null (no model / unreadable file); a fact
// that is not known is omitted rather than guessed. Pure, so the wording is unit-tested.
function runtimeFieldHints(input) {
    var opts = input || {};
    var info = opts.info || null;
    var out = {};

    // A model that drafts for itself: the draft token fields and the probability threshold
    // bound its built-in MTP head exactly as they would a paired draft file.
    var embeddedHead = !!(info && info.mtpCapable === true);

    var blockCount = info ? _hintInt(info.blockCount) : null;
    var contextLength = info ? _hintInt(info.contextLength) : null;
    var expertCount = info ? _hintInt(info.expertCount) : null;
    var expertUsedCount = info ? _hintInt(info.expertUsedCount) : null;

    var contextText = "";
    if (contextLength !== null) {
        contextText = "This model was trained for up to " + _formatGroupedInt(contextLength) + " tokens. ";
    }
    out.contextLength = contextText + "Shipped default: 32768.";

    var gpuText = "";
    if (blockCount !== null) {
        // The layer count is the number of transformer blocks; the output/embedding weights are
        // one more unit beyond it, and a count that stops at the blocks leaves them in system
        // RAM (measured: -ngl 32 of a 32-block model still held 0.7 GiB back). 'all' is the
        // engine's own spelling for every unit.
        gpuText = "This model has " + _formatGroupedInt(blockCount) + " layer blocks, plus its output weights as one more unit, so " +
            _formatGroupedInt(blockCount + 1) + " or 'all' places the whole model. ";
    }
    out.gpuLayers = gpuText + "auto lets llama.cpp fit as many as your VRAM allows; 0 keeps it all on the CPU.";

    if (info && expertCount !== null && expertCount > 0) {
        var moeText = "";
        if (blockCount !== null) moeText = "This model has " + _formatGroupedInt(blockCount) + " layers; ";
        moeText += "keeps the first N layers' experts in system RAM. Empty lets llama.cpp decide.";
        out.cpuMoe = moeText;
        out.cpuMoeLayers = moeText;
        out.moeCacheMib = "This model has " + _formatGroupedInt(expertCount) + " experts, so a cache pays off whenever they sit on the CPU.";
    } else if (info) {
        var noExpertWeights = "This model has no expert weights to offload; this setting is ignored.";
        out.cpuMoe = noExpertWeights;
        out.cpuMoeLayers = noExpertWeights;
        out.moeCacheMib = "This model has no expert weights, so there is nothing to cache; this setting is ignored.";
    }

    // The paired draft's placement hints need the DRAFT's own facts, not the target's. The
    // caller resolves the paired draft file (forced draftId first, then detection) in the same
    // modelInfos scan used for the target, so the layer count comes from the GGUF's metadata.
    var draftInfo = opts.draftInfo || null;
    var draftBlockCount = draftInfo ? _hintInt(draftInfo.blockCount) : null;
    var draftExpertCount = draftInfo ? _hintInt(draftInfo.expertCount) : null;
    if (!draftInfo) {
        // A built-in MTP head needs no placement of its own - it is part of the model file and
        // follows the model's own GPU layers - which is worth saying when there is one.
        var noDraft = (info && info.mtpCapable === true)
            ? "This model's built-in MTP head is part of the model file and follows its GPU layers; these fields affect only a paired draft model file."
            : "Only used when this model has a draft model paired; it is ignored otherwise.";
        out.draftGpuLayers = noDraft;
        out.draftCpuMoe = noDraft;
        out.draftCpuMoeLayers = noDraft;
        out.draftUbatchSize = (info && info.mtpCapable === true)
            ? "This model's built-in MTP head shares the model's own batch; this field affects only a paired draft model file."
            : "Only used when this model has a draft model paired; it is ignored otherwise.";
    } else {
        var draftLayerText = draftBlockCount !== null
            ? "The paired draft model has " + _formatGroupedInt(draftBlockCount) + " layer blocks, plus its output weights as one more unit, so " +
                _formatGroupedInt(draftBlockCount + 1) + " or 'all' places all of it. "
            : "";
        out.draftGpuLayers = draftLayerText +
            "auto lets llama.cpp fit as many as your VRAM allows; 0 keeps the draft on the CPU.";
        if (draftExpertCount !== null && draftExpertCount > 0) {
            var draftMoeText = draftBlockCount !== null
                ? "The paired draft model has " + _formatGroupedInt(draftBlockCount) + " layers; "
                : "";
            draftMoeText += "keeps the first N layers' experts in system RAM. Empty lets llama.cpp decide.";
            out.draftCpuMoe = draftMoeText;
            out.draftCpuMoeLayers = draftMoeText;
        } else {
            var draftNoExperts = "The paired draft model has no expert weights; this setting is ignored.";
            out.draftCpuMoe = draftNoExperts;
            out.draftCpuMoeLayers = draftNoExperts;
        }
    }

    if (info && expertCount !== null && expertCount > 0) {
        var expertText = "This model has " + _formatGroupedInt(expertCount) + " experts";
        if (expertUsedCount !== null) {
            expertText += " and activates " + _formatGroupedInt(expertUsedCount) + " per token by default. " +
                "Lower is faster; empty keeps " + _formatGroupedInt(expertUsedCount) + ".";
        } else {
            expertText += ". Lower is faster.";
        }
        out.expertCount = expertText;
    } else if (info) {
        out.expertCount = "This model has no mixture-of-experts; this setting is ignored.";
    }

    // The publisher's own release notes for this family recommend F16 K and V. It stays a hint:
    // on a small card the KV cache is the scarce resource, so the default remains q8_0. The
    // trigger reads the GGUF's own metadata in order - general.quantized_by (ModelInfo.publisher),
    // then general.name, then general.basename - so a file that derives from this family but omits
    // the publisher key still gets the hint. Metadata only: neither a path nor a file name is ever
    // consulted, and a file with none of the three gets the plain wording.
    var publisherText = "";
    if (info) {
        var publisherParts = [info.publisher, info.name, info.basename];
        for (var pi = 0; pi < publisherParts.length; pi++) {
            var part = publisherParts[pi];
            if (part !== undefined && part !== null && String(part) !== "") {
                publisherText = String(part);
                break;
            }
        }
    }
    var kvHint = "q8_0 halves KV memory with little quality loss.";
    if (publisherText.toLowerCase().indexOf("hauhaucs") !== -1) {
        kvHint = "This file's publisher recommends F16 K and V; q8_0 halves KV memory with little extra quality loss.";
    }
    out.kvTypeK = kvHint;
    out.kvTypeV = kvHint;
    // The field descriptions already state the defaults, so these hints carry only the part the
    // description does not: the interaction with the paired draft model.
    out.batchSize = "";
    out.ubatchSize = "";
    // p-min is read by the MTP head's own drafting loop, so it applies to a self-drafting
    // model too; the draft KV cache type needs a real draft file (an embedded head has no
    // separate cache) and stays draft-only.
    out.specDraftPMin = embeddedHead
        ? "Applies to this model's built-in MTP head as well, not only to a paired draft model."
        : "Only applies when a draft model is paired.";
    out.draftKvType = "Only applies when a draft model is paired.";

    out.mainGpu = "Empty uses the first GPU.";
    out.tensorSplit = "Empty divides the work evenly.";
    out.overrideTensor = "Empty means no tensor overrides.";
    // The draft detection carries no trained block size today, so do not invent a number.
    // A built-in MTP head drafts like a paired draft - the token fields bound its proposals
    // through the same spec flags - so the hint must say they apply rather than imply the
    // model has no speculation at all.
    var draftTokenHint = embeddedHead
        ? "This model drafts for itself with its built-in MTP head, and this field bounds that head exactly as it would a paired draft model."
        : "Only applies when a draft model is paired.";
    out.draftMax = draftTokenHint;
    out.draftMin = draftTokenHint;
    // The slots share the model's context, so the caveat belongs with the field's own hint.
    // llama.cpp's own default is 4.
    out.parallelSlots = "Slots share this model's context, so raising the count divides the context between concurrent requests; empty uses llama.cpp's default of 4.";
    return out;
}

// "This machine reports <n> logical CPUs." for the per-model intro and the two CPU-thread fields.
// Returns "" when the count is unknown/invalid so callers append nothing. Pure for testing.
function runtimeHardwareNote(cpuCount) {
    var n = _hintInt(cpuCount);
    if (n === null || n <= 0) return "";
    return "This machine reports " + _formatGroupedInt(n) + " logical CPUs.";
}

// navigator.hardwareConcurrency, guarded: absent in Node and any restricted context.
function _logicalCpuCount() {
    try {
        if (typeof navigator === "undefined" || !navigator) return null;
        var n = navigator.hardwareConcurrency;
        return (typeof n === "number" && isFinite(n) && n > 0) ? Math.trunc(n) : null;
    } catch (e) {
        return null;
    }
}
// Resolve the engine-wide repetition-loop tier thresholds (option ids
// 'repetitionCharLimit' / 'repetitionLimit' / 'repetitionEntryLimit' /
// 'repetitionSkeletonLimit'). Each
// value is normalized (missing/unreadable -> factory default; below 2 -> tier
// disabled). The tier defaults mirror the option defaults: 20 / 15 / 4 / 6.
function _repetitionLoopTiers(engine) {
    var read = function (opt, fallback) {
        try {
            return ResponsesApiHelpers_1.normalizeRepetitionLimit(opt ? opt.getValue() : undefined, fallback);
        } catch (e) {
            return fallback;
        }
    };
    return {
        charLimit: read(engine && engine.optionRepetitionCharLimit, 20),
        wordLimit: read(engine && engine.optionRepetitionLimit, 15),
        entryLimit: read(engine && engine.optionRepetitionEntryLimit, 4),
        skeletonLimit: read(engine && engine.optionRepetitionSkeletonLimit, 6)
    };
}
// Builds a streaming-response inspector for full-batch requests. Every original
// text carries a unique id ('--- {дivN} ---' section markers in divider mode,
// '"id": N' JSON entries in JSON full batch mode), so ANY repeated id is
// definite duplication and any id beyond the requested range is fabricated
// content - regardless of how repetitive the original text itself legitimately
// is. Fires after `repeatLimit` occurrences of the same id (leeway for
// glitches), or as soon as an id outside the requested range appears. Returns a
// reason string when fired, false otherwise.
function _makeBatchIdInspector(jsonMode, expectedCount, repeatLimit) {
    if (!expectedCount || expectedCount < 1 || !repeatLimit || repeatLimit < 2) return null;
    // The Cyrillic-д form is trusted loosely (it cannot occur in normal text and
    // even malformed looped markers keep it); the Latin 'div' variant is only
    // trusted in the full marker shape so stray words like "div5" inside
    // translations cannot trigger it.
    var re = jsonMode ? /"id"\s*:\s*(\d+)/g : /дiv(\d+)|---\s*\{div(\d+)\}\s*---/g;
    var label = jsonMode ? 'JSON entry id ' : 'section marker id ';
    // JSON ids are 0-based and дiv markers 1-based; one id above the 0-based
    // range is tolerated because some models number JSON ids from 1.
    var maxValid = expectedCount;
    var maxId = -1;
    var counts = new Map();
    var resolved = 0; // everything before this index has already been counted
    return function (content) {
        if (!content) return false;
        // Rescan with overlap so markers that only completed after the last call
        // are found; matches ending before `resolved` were already counted.
        re.lastIndex = Math.max(0, resolved - 40);
        var m;
        while ((m = re.exec(content)) !== null) {
            if (re.lastIndex <= resolved) continue;
            // A number at the very end of the streamed text may still be growing
            // ("дiv1" -> "дiv12"); only count complete numbers, i.e. ones that are
            // followed by any character (the greedy \d+ then guarantees a non-digit).
            if (re.lastIndex >= content.length) break;
            var num = parseInt(m[1] !== undefined ? m[1] : m[2], 10);
            resolved = re.lastIndex;
            if (!isFinite(num)) continue;
            if (num > maxId) maxId = num;
            var c = (counts.get(num) || 0) + 1;
            counts.set(num, c);
            if (c >= repeatLimit) {
                return label + num + ' appeared ' + c + ' times, but every id exists only once in the original';
            }
        }
        if (maxId > maxValid) {
            return label + maxId + ' was generated even though the original only contains ids up to ' + maxValid;
        }
        return false;
    };
}
async function _streamChatCompletion(response, onProgress, repetition) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';
    var rawAll = '';
    var content = '';
    var reasoning = '';
    var finishReason = null;
    var usage = null;
    var lastReported = -1;
    var sawDelta = false;
    var tokenCount = 0;
    var repLimit = 0;
    var repCfg = null;
    try {
        repCfg = ResponsesApiHelpers_1.resolveRepetitionConfig(repetition, 0);
        repLimit = repCfg.active ? 1 : 0;
    } catch (e) { repCfg = null; repLimit = 0; }
    var repetitionTriggered = false;
    var repetitionReasonStr = "";
    var processEvent = function (dataStr) {
        if (!dataStr) return;
        var parsed;
        try { parsed = JSON.parse(dataStr); } catch (e) { return; }
        if (parsed && parsed.usage) usage = parsed.usage;
        var choice = parsed && parsed.choices && parsed.choices[0];
        if (choice) {
            var delta = choice.delta || choice.message;
            if (delta) {
                if (delta.content) { content += delta.content; sawDelta = true; tokenCount++; }
                // 'reasoning_content' is the DeepSeek-style field; Ollama's OpenAI-compatible
                // endpoint instead streams the thinking trace as 'reasoning'. Accept both so
                // the token-progress preview shows the reasoning and it stays out of the
                // translation output.
                if (delta.reasoning_content) { reasoning += delta.reasoning_content; sawDelta = true; tokenCount++; }
                if (delta.reasoning) { reasoning += delta.reasoning; sawDelta = true; tokenCount++; }
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
        }
    };
    var flushBuffer = function () {
        var lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === ':') continue;
            if (line.slice(0, 5).toLowerCase() === 'data:') line = line.slice(5).trim();
            if (line === '[DONE]' || line === '') continue;
            processEvent(line);
        }
    };
    var report = function () {
        if (onProgress && tokenCount !== lastReported) {
            lastReported = tokenCount;
            onProgress(tokenCount, content, reasoning);
        }
    };
    while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        var text = decoder.decode(chunk.value, { stream: true });
        buffer += text;
        rawAll += text;
        flushBuffer();
        if (repLimit > 0 && !finishReason && sawDelta) {
            var repReason = ResponsesApiHelpers_1.repetitionReason(content, reasoning, repCfg);
            if (repReason) {
                console.error(`[DSLR] Excessive repetition detected in the streamed response (${repReason}). Terminating the response early; the retry will use an increased repetition penalty.`);
                repetitionReasonStr = repReason;
                finishReason = 'length';
                repetitionTriggered = true;
                try { await reader.cancel(); } catch (e) { /* already closed */ }
                break;
            }
        }
        report();
    }
    if (repetitionTriggered) {
        // Stream was cancelled mid-read: skip the final decoder flush, the tail
        // belongs to the aborted repetition loop anyway.
        report();
        var loopMessage = { content: content };
        if (reasoning) loopMessage.reasoning_content = reasoning;
        var loopResult = { choices: [{ index: 0, message: loopMessage, finish_reason: 'length' }], repetition_loop: true, repetition_loop_reason: repetitionReasonStr };
        return loopResult;
    }
    var finalText = decoder.decode();
    buffer += finalText;
    rawAll += finalText;
    flushBuffer();
    if (buffer.trim()) {
        var tail = buffer.trim();
        if (tail.slice(0, 5).toLowerCase() === 'data:') tail = tail.slice(5).trim();
        if (tail && tail !== '[DONE]') processEvent(tail);
        buffer = '';
    }
    if (usage && usage.completion_tokens != null) {
        tokenCount = usage.completion_tokens;
    }
    report();
    var result;
    if (sawDelta) {
        var message = { content: content };
        if (reasoning) message.reasoning_content = reasoning;
        result = { choices: [{ index: 0, message: message, finish_reason: finishReason || 'stop' }] };
        if (usage) result.usage = usage;
    } else {
        var trimmed = rawAll;
        try {
            trimmed = trimmed.replaceAll(/^[^{]+({)/g, '$1').replaceAll(/(})[^}]+$/g, '$1');
            result = JSON.parse(trimmed);
        } catch (e) {
            result = { choices: [{ index: 0, message: { content: '' }, finish_reason: finishReason || 'stop' }] };
        }
    }
    return result;
}
// Collapsed console logging for review traffic, mirroring the translation
// path's logCollapsed helper (which lives inside doTranslate and is not
// visible here). Console only — never the in-app log — and never the API key.
function _reviewLogCollapsed(title, content) {
    try {
        console.groupCollapsed(title);
        console.log(typeof content === "object" ? JSON.stringify(content, null, 2) : content);
        console.groupEnd();
    } catch (e) { /* console unavailable */ }
}
class LogBuffer {
  constructor(groupName, maxLogs = 10, maxTime = 5000) {
    this.groupName = groupName;
    this.maxLogs = maxLogs;
    this.maxTime = maxTime;
    this.logs = [];
    this.timer = null;
  }
  
  add(message) {
    this.logs.push(message);
    
    if (this.logs.length >= this.maxLogs) {
      this.flush();
    } else {
      this.resetTimer();
    }
  }
  
  resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.maxTime);
  }
  
  flush() {
    if (this.logs.length === 0) return;
    
    console.groupCollapsed(`${this.groupName} (${this.logs.length} entries)`);
    this.logs.forEach((log, index) => {
      console.log(`Entry ${index + 1}:`, log);
    });
    console.groupEnd();
    
    this.logs = [];
    if (this.timer) clearTimeout(this.timer);
  }
}
class DSLREngine extends DSLRTranslationEngineWrapper_1.DSLRTranslationEngineWrapper {
    constructor(processor, thisAddon) {
        super(processor, thisAddon, {
            id: 'dslr',
            name: 'DSLR (recommended)',
            languages: {
                en: 'English',
                ja: 'Japanese'
            },
            batchDelay: 1,
            description: thisAddon.package.description,
            mode: 'rowByRow'
        });
        // Exposed so the bundled local-runtime module can point this engine at its endpoint.
        if (!window.slrDSLREngineWrapper) window.slrDSLREngineWrapper = this;
        this.aborted = false;
        this.paused = false;
        this.pauseQueue = [];
        // Shared AbortController for all in-flight LLM requests of the current run (concurrent
        // batches each call doTranslate, but they must all be cancellable by one abort()).
        // Lazily created by _requestSignal(); aborted and cleared by abort().
        this._fetchAbort = null;
        // Preview-visibility coordination across concurrent doTranslate calls (one slot per
        // active stream; only the newest is visible — see _registerStreamPreview).
        this._streamPreviewStack = [];

        // The bundled local runtime lives in the www/core/llmRuntime module. If that module
        // failed to load (for example an incomplete copy of the app folder), the buttons below
        // must say so instead of throwing "Cannot read property ... of undefined".

        // Non-modal status line. Everything the runtime buttons report goes through here so
        // the options window keeps focus (the old alert() stole it). The text lives in a
        // closure variable and is written straight into the .runtimeStatusLine node, so it is
        // never stored on an option and never persists across sessions: a fresh launch always
        // recomputes it from the live runtime state.
        var runtimeStatusText = '';
        var lastOptionsWindow = null;

        function statusLineElement(win) {
            try {
                if (!win || !win.document) return null;
                var el = $(win.document).find('.runtimeStatusLine');
                return (el && el.length) ? el : null;
            } catch (e) { return null; }
        }
        // Same candidate list _rebuildAndRender uses to locate the Options window, plus the
        // last window that owned a status line and the main window's ui.windows.options
        // handle (the reliable path for the background ticker, which has no click event to
        // resolve the window from). The ui handle is last so a real event still wins.
        function optionsWindowCandidates(evt) {
            var cands = [];
            try {
                var optWin = (evt && evt.target && evt.target.ownerDocument) ? evt.target.ownerDocument.defaultView : null;
                if (optWin) cands.push(optWin);
            } catch (e) { /* ignore */ }
            if (lastOptionsWindow) cands.push(lastOptionsWindow);
            try { if (typeof window !== 'undefined') cands.push(window); } catch (e) { /* ignore */ }
            try { if (typeof window !== 'undefined' && window.opener) cands.push(window.opener); } catch (e) { /* ignore */ }
            try {
                if (typeof window !== 'undefined' && window.ui && window.ui.windows && window.ui.windows.options) {
                    cands.push(window.ui.windows.options);
                }
            } catch (e) { /* ignore */ }
            return cands;
        }
        function findOptionsWindow(evt) {
            var cands = optionsWindowCandidates(evt);
            for (var i = 0; i < cands.length; i++) {
                var w = cands[i];
                if (w && w.options && w.options.translatorMenu && typeof w.options.translatorMenu.renderOptions === 'function') {
                    lastOptionsWindow = w;
                    return w;
                }
            }
            return null;
        }
        // Find the live status line wherever it is actually rendered. The background ticker has
        // no click event, and more than one candidate exposes options.translatorMenu (the main
        // window does too), so search for the element itself rather than trusting the first
        // window that merely looks like the Options window. Handles both a DOM window and an
        // nw.Window-like handle (ui.windows.options).
        function windowDocument(w) {
            if (!w) return null;
            try { if (w.document) return w.document; } catch (e) { /* ignore */ }
            try { if (w.window && w.window.document) return w.window.document; } catch (e) { /* ignore */ }
            return null;
        }
        function findStatusElement() {
            var cands = optionsWindowCandidates(null);
            for (var i = 0; i < cands.length; i++) {
                var doc = windowDocument(cands[i]);
                if (!doc) continue;
                try {
                    var el = $(doc).find('.runtimeStatusLine');
                    if (el && el.length) { lastOptionsWindow = cands[i]; return el; }
                } catch (e) { /* ignore */ }
            }
            return null;
        }
        // The model <select> is rendered once from the option's titleMap, so a list that was
        // empty when the form was built stays empty until the field is rebuilt. Instead of
        // re-rendering the whole form (which steals focus and logs a warning when the Options
        // window cannot be resolved), repopulate the select in place. The option's
        // titleMap/enum are refreshed too so any later rebuild starts from the right list.
        function findRuntimeSelect(evt) {
            if (evt && evt.target) {
                try {
                    var near = $(evt.target).closest('.panelContent').find('[name="runtimeModel"]');
                    if (near && near.length) return near;
                } catch (e) { /* fall through */ }
            }
            var cands = optionsWindowCandidates(null);
            for (var i = 0; i < cands.length; i++) {
                var doc = windowDocument(cands[i]);
                if (!doc) continue;
                try {
                    var el = $(doc).find('[name="runtimeModel"]');
                    if (el && el.length) { lastOptionsWindow = cands[i]; return el; }
                } catch (e) { /* ignore */ }
            }
            return null;
        }
        function runtimeModelIds() {
            var rt = window.llmRuntime;
            if (!rt || rt.loadError) return [];
            try {
                var entries = rt.targetModels() || [];
                var ids = [];
                for (var i = 0; i < entries.length; i++) ids.push(entries[i].id);
                return ids;
            } catch (e) { return []; }
        }
        // The body lives on the prototype (_syncRuntimeModelSelect) so the Options-window gate
        // is unit-testable; this closure supplies the window-bound select lookup and the cached
        // model-id list. The select is resolved FIRST, so with the Options window closed the
        // model list is not requested at all - this is what keeps the 3s ticker cheap.
        function syncRuntimeModelSelect(evt) {
            return selfWrapper._syncRuntimeModelSelect(evt, {
                findRuntimeSelect: findRuntimeSelect,
                runtimeModelIds: runtimeModelIds
            });
        }
        // Resolve the live status line in place: the clicked button's own panel first (the
        // same pattern as the Quick Start "Test connection" status), then any candidate window
        // that actually contains the status line. No re-render, so focus and scroll survive.
        function statusElementFor(evt) {
            if (evt && evt.target) {
                try {
                    var near = $(evt.target).closest('.panelContent').find('.runtimeStatusLine');
                    if (near && near.length) {
                        // Remember which window owns it so the ticker can reach it later.
                        try {
                            var owner = evt.target.ownerDocument ? evt.target.ownerDocument.defaultView : null;
                            if (owner) lastOptionsWindow = owner;
                        } catch (e) { /* ignore */ }
                        return near;
                    }
                } catch (e) { /* fall through */ }
            }
            return findStatusElement();
        }
        function setRuntimeStatus(text) {
            runtimeStatusText = text;
            var el = statusElementFor(null);
            if (el) el.text(text);
            return el;
        }
        function refreshStatus(evt, text) {
            setRuntimeStatus(text);
            var el = statusElementFor(evt);
            if (el) {
                el.text(text);
                return;
            }
            // Last resort only: the status line is not in any reachable window.
            alert(text);
        }
        // Synchronous one-line summary, used when no detailed describeStatus() text exists
        // yet. Recomputed from the live runtime state every call, so it can never go stale.
        function runtimeSummary() {
            var rt = window.llmRuntime;
            if (!rt || rt.loadError) {
                var text = 'The bundled local runtime module is not loaded. Expected it at www/core/llmRuntime/.';
                try { if (rt && rt.loadError) text += ' ' + rt.loadError; } catch (e) { /* ignore */ }
                return text;
            }
            var s;
            try { s = rt.status(); } catch (e) { return 'Error: ' + ((e && e.message) || e); }
            if (!s) return 'Error: status unavailable';
            switch (s.status) {
                case 'stopped':
                    return 'Stopped. Use Start / Use Local Runtime to launch it.';
                case 'starting':
                    return 'Starting...';
                case 'ready':
                    return 'Running - ' + (s.backend || '-') +
                        (s.device ? ' (' + s.device + ')' : '') +
                        ' - ' + (s.baseUrl || '-') +
                        ' - ' + (s.modelId || '-');
                case 'error':
                    return 'Error: ' + (s.error || '');
                default:
                    return 'Status: ' + s.status;
            }
        }
        function localRuntime(evt) {
            var rt = window.llmRuntime;
            if (!rt) {
                refreshStatus(evt, "The bundled local runtime module is not loaded. Expected it at www/core/llmRuntime/ inside the app folder; this copy looks incomplete.");
                return null;
            }
            if (rt.loadError) {
                refreshStatus(evt, "The bundled local runtime failed to load: " + rt.loadError);
                return null;
            }
            return rt;
        }

        // Read an option's current value without ever throwing: a missing option, an
        // unavailable wrapper or a form that has not been built yet all fall back to the
        // supplied default. Used by the runtime action buttons, which run outside the form's
        // own change handling.
        function readOption(wrapper, name, fallback) {
            try {
                if (wrapper && wrapper[name] && typeof wrapper[name].getValue === 'function') {
                    var value = wrapper[name].getValue();
                    if (value !== undefined && value !== null && value !== '') return value;
                }
            } catch (e) { /* fall through to the default */ }
            return fallback;
        }

        // The auto-start flag is persisted by the runtime itself (data/llama/laststart.json)
        // rather than by the options store, so the addon can read it at app open before the
        // engine exists. This cheap comparison keeps the file in step with the checkbox
        // within one tick of it being changed.
        function syncAutoStart() {
            try {
                var rt = window.llmRuntime;
                if (!rt || rt.loadError || !rt.readStartState || !rt.setAutoStart) return;
                var wrapper = window.slrDSLREngineWrapper;
                if (!wrapper || !wrapper.optionRuntimeAutoStart) return;
                var wanted = wrapper.optionRuntimeAutoStart.getValue() === true;
                var current = rt.readStartState().autoStart === true;
                if (wanted !== current) rt.setAutoStart(wanted);
            } catch (e) { /* never let a tick break the app */ }
        }

        // One background ticker keeps the card's status line current while the Options
        // window is open, including live draft-acceptance numbers during a translation. It
        // writes in place only (never re-renders, which would steal focus and reset scroll)
        // and is fully guarded so a broken or missing runtime can never break the app.
        try {
            setInterval(function () {
                try {
                    syncRuntimeModelSelect(null);
                    syncAutoStart();
                    var el = findStatusElement();
                    if (!el) return;
                    var rt = window.llmRuntime;
                    var ready = false;
                    try {
                        ready = !!(rt && !rt.loadError && rt.status && rt.describeStatus && rt.status().status === 'ready');
                    } catch (e) { ready = false; }
                    if (ready) {
                        rt.describeStatus().then(function (text) {
                            try {
                                var live = findStatusElement();
                                if (live && text) live.text(text);
                            } catch (e) { /* ignore */ }
                        }).catch(function () {
                            try {
                                var fallback = findStatusElement();
                                if (fallback) fallback.text(runtimeSummary());
                            } catch (e) { /* ignore */ }
                        });
                        return;
                    }
                    el.text(runtimeSummary());
                } catch (e) { /* never let a tick break the app */ }
            }, 3000);
        } catch (e) { /* setInterval unavailable */ }

        this.optionApiUrl = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'apiUrl',
            default: 'http://127.0.0.1:1234/v1/chat/completions',
            description: "The API endpoint URL. It will automatically add 'v1/chat/completions' to the end if nothing similar is there (unless turned off).\nCaution: If you are not using LM Studio your endpoint likely does not support the repeat_penalty parameter and you should leave it empty.",
            name: 'API URL',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // Every runtime option is declared here in render order: the model picker, then
        // the draft tuning and the context/KV server settings. They all live in the dedicated
        // "Bundled Local Runtime" card.
        this.optionRuntimeModel = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeModel',
            default: '',
            description: "Selects which GGUF the bundled local runtime serves when you click Start / Use Local Runtime. Draft models are paired with their target by data/llama/drafts.json and are not listed here as selectable models (a draft cannot run on its own). The list fills in automatically; use Refresh Model List after adding or removing GGUF files in data/llama/models/.",
            name: 'Local runtime model',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: { enum: [] },
            formOptions: { titleMap: {} }
        });

        // Keep the picker populated automatically: the form builder calls getFormOptions()
        // every time it builds or re-renders the field, so refreshing the titleMap/enum here
        // means the user no longer has to press "Refresh Model List" just to see the models.
        var baseRuntimeFormOptions = this.optionRuntimeModel.getFormOptions.bind(this.optionRuntimeModel);
        var selfWrapper = this;
        this.optionRuntimeModel.getFormOptions = function () {
            var fo = baseRuntimeFormOptions();
            try {
                var rt = window.llmRuntime;
                if (rt && !rt.loadError) {
                    var entries = rt.targetModels() || [];
                    var titleMap = {};
                    var ids = [];
                    for (var i = 0; i < entries.length; i++) { titleMap[entries[i].id] = entries[i].id; ids.push(entries[i].id); }
                    fo.titleMap = titleMap;
                    selfWrapper.optionRuntimeModel.getSchemaOptions().enum = ids;
                    if (!selfWrapper.optionRuntimeModel.getValue() && ids.length) {
                        selfWrapper.optionRuntimeModel.setValue(rt.selectedModel() || ids[0]);
                    }
                }
            } catch (e) { /* keep whatever the form already had */ }
            return fo;
        };

        // Selecting a different model re-renders the card so the per-model panel (profile fields,
        // speculative-decoding and vision-projector controls) below shows that model's stored
        // settings. The form builder spreads formOptions AFTER its own onChange, so this replaces
        // the default setValue+update handler; the re-render is what keeps the panel in step.
        this.optionRuntimeModel.options.formOptions.onChange = function (evt) {
            try {
                var option = selfWrapper.optionRuntimeModel;
                var value = $(evt.target).val();
                option.setValue(value);
                selfWrapper.translatorEngine.update(option.getId(), option.getValue());
            } catch (e) { /* the re-render below still runs */ }
            try { selfWrapper._rebuildAndRender(evt); } catch (e) { /* ignore */ }
        };

        // Speculative-decoding draft tuning for the bundled runtime, declared between the
        // model picker and the server-context settings so the card renders in a natural
        // top-to-bottom order. They only take effect when the selected model has a draft
        // paired in data/llama/drafts.json; leaving a field empty falls back to that file's
        // value.
        this.optionRuntimeDraftMax = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeDraftMax',
            type: 'number',
            default: 2,
            description: "How many tokens the draft model proposes per speculative step when a draft model is paired; for a model with a built-in MTP head, this bounds the head's own proposals. Higher values are frequently slower, not faster: the target model must verify every proposed token, so each extra token adds work for a diminishing chance of a full acceptance. Measured on the bundled runtime, 2 was the fastest and values above about 3 were slower than running with no speculation at all. The draft's trained block size caps this value. Leave empty to use the value from data/llama/drafts.json.",
            name: 'Local runtime max draft tokens',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });
        this.optionRuntimeDraftMin = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeDraftMin',
            type: 'number',
            default: 0,
            description: "Minimum number of draft tokens to propose per speculative step when a draft model is paired; for a model with a built-in MTP head, this applies to the head's own proposals. 0 lets the runtime stop early as soon as the draft is uncertain, which avoids wasted verification work. Leave empty to use the value from data/llama/drafts.json.",
            name: 'Local runtime min draft tokens',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // Server-side context allocation. Unlike the per-request options, this is fixed when
        // llama-server starts, so it is a setting of the bundled runtime card, not the endpoint.
        this.optionRuntimeContextLength = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeContextLength',
            type: 'number',
            default: 32768,
            description: "The per-slot context the bundled llama-server allocates, in tokens. Larger values use more memory (the KV cache grows linearly with it) and let the model see more text at once. The model's trained context limit caps how high this can usefully go. This is a server-side setting applied when the runtime starts, not per request. Leave empty to fall back to 32768.",
            name: 'Local runtime context length',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // Server-side KV cache quantization. A lower precision cache trades a little quality
        // for memory and speed; q8_0 is the shipped default.
        this.optionRuntimeKvType = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeKvType',
            default: 'q8_0',
            description: "Quantization used for the bundled llama-server's KV cache. It trades a little quality for memory and speed, and is applied when the runtime starts (server-side, not per request). q8_0 roughly halves the KV memory with negligible quality loss and is the default; lower types (q5, q4) save more memory at a larger quality cost, while f16/bf16 keep the best quality at full memory. Quantized V values need flash attention, which the bundled runtime always enables.",
            name: 'Local runtime KV cache quantization',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: { enum: ['f16', 'bf16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0'] },
            formOptions: {
                titleMap: {
                    'f16': 'f16 (best quality, most memory)',
                    'bf16': 'bf16',
                    'q8_0': 'q8_0 (recommended, about half the KV memory)',
                    'q5_1': 'q5_1',
                    'q5_0': 'q5_0',
                    'q4_1': 'q4_1',
                    'q4_0': 'q4_0 (smallest, most quality loss)'
                }
            }
        });

        // Manual device placement. These mirror llama-server's own offload switches and are
        // applied when the runtime starts (server-side, not per request). The defaults are
        // deliberately "let llama.cpp decide": an untouched card produces exactly the same
        // command line as before these options existed.
        this.optionRuntimeBackend = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeBackend',
            default: 'auto',
            description: "Which compute backend the bundled runtime should use.\n\nauto picks the best available device in the order CUDA, ROCm, Vulkan, CPU, and only auto falls through to the next backend when one is unusable. Choose cpu to force everything onto the processor (useful to compare speed, or when a GPU driver misbehaves). The named backends require their optional pack to be installed: CUDA and ROCm ship separately as drop-in packs, while Vulkan is included. A named backend is strict: if it cannot start (the pack is missing, or no matching device was detected) the start fails with the exact reason - what is installed, what devices were detected, and the device probe's own error output, which names the library that failed to load - instead of silently running on another backend, and the device probe is always logged to the console. A start that runs out of GPU memory while loading is retried once with fewer GPU layers and says so in the status line; any other failure is shown as an error with llama-server's own output, because silently dropping to the CPU would trade a fast runtime for an unusably slow one.",
            name: 'Local runtime backend',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: { enum: ['auto', 'cpu', 'cuda', 'rocm', 'vulkan'] },
            formOptions: {
                titleMap: {
                    'auto': 'auto (CUDA, then ROCm, then Vulkan, then CPU)',
                    'cpu': 'cpu (no GPU)',
                    'cuda': 'cuda (NVIDIA, needs the CUDA pack)',
                    'rocm': 'rocm (AMD, needs the ROCm pack)',
                    'vulkan': 'vulkan (bundled)'
                }
            }
        });

        this.optionRuntimeGpuLayers = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeGpuLayers',
            default: 'auto',
            description: "How many of the model's layers to keep in VRAM, passed to llama.cpp as -ngl.\n\nauto lets llama.cpp fit as many layers as it can. A number sets an exact count, which is how you partially offload a model that does not fit: the rest stays in system RAM and is computed on the CPU. 0 keeps the whole model on the CPU. If a model is larger than your VRAM, lower this until it starts, then watch the token rate in Runtime Status to find the best split.",
            name: 'Local runtime GPU layers',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeCpuMoe = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeCpuMoe',
            default: false,
            description: "Keeps every Mixture-of-Experts (MoE) weight in system RAM while the rest of the model can still use the GPU. This is the usual way to run a large MoE model such as a 26B A4B on a small GPU: the attention and shared layers (which run for every token) sit in VRAM, while the expert weights (only a few of which are used per token) stay on the CPU.\n\nOnly affects MoE models; it is ignored for ordinary dense models. Use 'Local runtime MoE layers on CPU' instead if you want to keep only the first N layers' experts on the CPU.",
            name: 'Local runtime all MoE experts on CPU',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionRuntimeCpuMoeLayers = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeCpuMoeLayers',
            type: 'number',
            default: '',
            description: "Keeps the MoE expert weights of the first N layers in system RAM (-n-cpu-moe), leaving the experts of the remaining layers on the GPU. This is the finer-grained version of the all-experts-on-CPU switch: raise it until the model fits your VRAM. 0 disables it. Leave empty to let llama.cpp decide.\n\nOnly affects MoE models; ignored for ordinary dense models.\n\nIf both this and 'all MoE experts on CPU' are set, the broader switch wins and this one is ignored - llama.cpp accepts the pair but lets --cpu-moe take precedence.",
            name: 'Local runtime MoE layers on CPU',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // Placement and memory for the paired draft model, plus the VRAM margin llama.cpp's fit
        // leaves free. These are the card fields for features whose flags the runtime already
        // emits; the three draft options do nothing unless the selected model has a draft paired
        // in data/llama/drafts.json, and the fit margin does nothing without a GPU.
        this.optionRuntimeDraftGpuLayers = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeDraftGpuLayers',
            default: 'auto',
            description: "How many of the paired draft model's layers to keep in VRAM, passed to llama.cpp as --spec-draft-ngl.\n\nOnly used when the selected model has a draft model paired in data/llama/drafts.json; it is ignored otherwise. auto lets llama.cpp fit as many draft layers as it can and is the shipped default. A number sets an exact count, and 0 keeps the whole draft on the CPU. Raise or lower it only when the draft is competing with the target model for a card that is already full.",
            name: 'Local runtime draft GPU layers',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeDraftCpuMoe = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeDraftCpuMoe',
            default: false,
            description: "Keeps every Mixture-of-Experts (MoE) weight of the paired draft model in system RAM while the rest of the draft can still use the GPU (llama.cpp --spec-draft-cpu-moe).\n\nOnly used when the selected model has a draft model paired in data/llama/drafts.json, and only when that draft is an MoE model; it is ignored otherwise. It mirrors the target model's 'all MoE experts on CPU' switch, applied to the draft. If both this and 'draft MoE layers on CPU' are set, the broader switch wins and the layer count is ignored.",
            name: 'Local runtime draft all MoE experts on CPU',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionRuntimeDraftCpuMoeLayers = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeDraftCpuMoeLayers',
            type: 'number',
            default: '',
            description: "Keeps the MoE expert weights of the first N layers of the paired draft model in system RAM (llama.cpp --spec-draft-n-cpu-moe), leaving the draft's remaining experts on the GPU.\n\nOnly used when the selected model has a draft model paired in data/llama/drafts.json, and only when that draft is an MoE model; it is ignored otherwise. 0 disables it. Leave empty to let llama.cpp decide. It mirrors the target model's 'MoE layers on CPU' setting, applied to the draft. If both this and 'draft all MoE experts on CPU' are set, the broader switch wins and this one is ignored.",
            name: 'Local runtime draft MoE layers on CPU',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeFitTarget = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeFitTarget',
            type: 'number',
            default: 512,
            description: "The VRAM headroom, in MiB, that llama.cpp's fit leaves free on each device when it works out how many layers to offload (--fit-target).\n\nThe shipped default is 512, which leaves room for the KV cache and compute buffers without wasting much of the card. 0 lets fit use every last MiB, which is riskiest on a GPU shared with a display or another process. Larger values are more conservative.\n\nThis setting does nothing without a GPU: the flag is not sent on the CPU path, so the field is visible but inert there. Leave empty to use llama.cpp's own default.",
            name: 'Local runtime VRAM headroom (MiB)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeLoadMode = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeLoadMode',
            default: '',
            description: "How the model file is read from disk (llama.cpp --load-mode).\n\nauto is the recommended setting: the file is memory-mapped normally, but switches to 'none' whenever part of the model's weights is computed from system RAM, because the loader then reads those weights back through the mapping and prompt processing suffers badly. This is not specific to MoE models: measured on a Vulkan GPU with a 26B A4B whose experts sat on the CPU, the switch nearly doubled prompt processing (116 -> 198 tokens/s, generation unchanged); on a dense 12B with 8 of 49 layers on the CPU, mmap lost about 30% of prompt speed once the operating system had evicted the mapped pages, while 'none' stayed flat. Because a batch run lasts hours and the model stays loaded, the slower load is paid once and is normally worth it.\n\nauto switches to 'none' in these situations, dense or MoE alike:\n- Expert weights are kept on the CPU by an explicit setting (all MoE experts on CPU, MoE layers on CPU, or a tensor override) on a model that actually has experts. On a dense model those settings move nothing and the load mode is not changed either.\n- The GPU layers setting is a number below the model's full height: those layers live in system RAM by design.\n- The start will not fit in the selected GPU's memory, so llama.cpp offloads part of it on its own. This is the common case for a large model on a small card, and nothing in the options shows it, so it is worked out from the model file plus its paired draft and projector and an estimate of the KV cache against the card's VRAM. A start that only just fits the files is treated as not fitting, since the KV cache and compute buffers need room too.\n\nChoose 'mmap' to opt out and always memory-map the file. That is the right choice if the model is larger than your free RAM, since 'none' has to hold the whole model in memory while mmap can page from disk.\n\nLoading with 'none' takes much longer: a 26B A4B measured 8 seconds with mmap against 65-158 seconds without. On a pure CPU setup there is no GPU portion to contend with the mapping, so the switch buys nothing there and never happens automatically.\n\nmmap+mlock pins the mapped file in RAM so it is never paged out; that needs enough free memory for the whole model.",
            name: 'Local runtime load mode',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: { enum: ['', 'none', 'mmap', 'mlock', 'mmap+mlock', 'dio'] },
            formOptions: {
                titleMap: {
                    '': 'auto (recommended: none whenever part of the model runs from system RAM)',
                    'none': 'none (no mmap, slower to load)',
                    'mmap': 'mmap (opt out, always memory-map)',
                    'mlock': 'mlock (keep in RAM)',
                    'mmap+mlock': 'mmap+mlock',
                    'dio': 'dio (direct I/O)'
                }
            }
        });

        this.optionRuntimeSplitMode = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeSplitMode',
            default: '',
            description: "How to split the model across several GPUs (llama.cpp --split-mode). 'none' uses a single GPU (the one set below), 'layer' splits by layer, 'row' splits each weight by rows and 'tensor' splits weights and the KV cache. Leave on auto unless you are tuning a multi-GPU machine.",
            name: 'Local runtime split mode',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: { enum: ['', 'none', 'layer', 'row', 'tensor'] },
            formOptions: {
                titleMap: {
                    '': 'auto (llama.cpp default)',
                    'none': 'none (single GPU)',
                    'layer': 'layer',
                    'row': 'row',
                    'tensor': 'tensor (splits KV too)'
                }
            }
        });

        this.optionRuntimeTensorSplit = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeTensorSplit',
            default: '',
            description: "How to divide the model between several GPUs, as a comma-separated list of proportions (llama.cpp --tensor-split), for example 0.7,0.3 for two cards where the first should take 70%. Leave empty to divide evenly. Only matters with more than one GPU.",
            name: 'Local runtime tensor split',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeMainGpu = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeMainGpu',
            type: 'number',
            default: '',
            description: "Index of the GPU to use as the main device (llama.cpp --main-gpu). With split mode 'none' this is the card that runs the model; with 'row' it also holds the intermediate results and the KV cache. The index is the one the runtime reports for your devices. Leave empty for the first GPU.",
            name: 'Local runtime main GPU index',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeOverrideTensor = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeOverrideTensor',
            default: '',
            description: "Advanced escape hatch that forces matching tensors into a chosen buffer (llama.cpp --override-tensor), for example exps=CPU to put every expert tensor in system RAM, or a pattern ending in =CUDA0 to pin specific tensors to a GPU. Patterns are matched against tensor names, so this assumes you know the model's tensor layout. Leave empty for no overrides.",
            name: 'Local runtime tensor overrides',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeExpertCount = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeExpertCount',
            type: 'number',
            default: '',
            description: "How many experts a Mixture-of-Experts (MoE) model activates per token, passed to llama.cpp as a metadata override. Only affects MoE models; on an ordinary dense model this is refused with a clear message rather than silently ignored.\n\nLowering it below the model's own value is the real speed lever for large MoE models. Measured on a 26B A4B (Gemma 4, 128 experts, 8 per token) on the CPU: 3 experts gave about 26% faster generation and 44% faster prompt processing, and 2 experts about 33% and 56%. Quality drops as you go lower, so treat the model's own value as the safe default and lower it only as far as you are happy with the output.\n\nLeave empty to use the model's own value. The runtime reads the number of experts from the model file and refuses a value larger than the model has. The override key is built from the model's architecture (for example gemma4.expert_used_count); the generic llama.expert_used_count found in most tutorials does nothing for any model whose architecture is not literally 'llama', which is why this is handled automatically here.",
            name: 'Local runtime experts used per token',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeLibDir = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeLibDir',
            default: '',
            description: "An extra folder the runtime should search for GPU libraries. It is prepended to LD_LIBRARY_PATH on Linux and PATH on Windows when llama-server is launched, so the folder's copy of a library wins over any system one.\n\nFor the ROCm pack this field matters on BOTH systems, because the pack contains only llama.cpp's own HIP backend while the libraries it needs (hipblas, rocblas, hipblaslt) come from the installed ROCm / HIP SDK. On Windows the AMD installer does not put the SDK's bin folder on the PATH; the runtime probes the standard install location (C:\\Program Files\\AMD\\ROCm\\<version>\\bin) automatically and adopts a usable SDK it finds there, so this field is only needed when the SDK lives somewhere else - point it at that install's bin folder, or add the folder to the system PATH yourself and restart the app afterwards. On Linux the distribution's ROCm packages are found automatically, so the field is only needed for a custom install location (AMD's runfile installer accepts target=<directory>, including a folder in your home directory) - point it at that install's lib subdirectory.\n\nA folder that does not exist is refused when you press Start, so a typo is reported immediately rather than showing up later as \"no GPU found\".",
            name: 'Local runtime extra library folder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // Server-level resource settings. These are not tied to one model: they control how many
        // models stay resident, whether an idle model is unloaded, and how many CPU threads are
        // used. They apply when the runtime starts.
        this.optionRuntimeModelsMax = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeModelsMax',
            type: 'number',
            default: 1,
            description: "How many models the bundled runtime may keep loaded at the same time.\n\nThe default is 1. On a small GPU a second resident model competes for the same VRAM and can push itself onto the CPU, making it slower than if it had loaded on its own. Raise this only if you have VRAM to spare and switch between models often enough that reloading is the bigger cost. Leave empty to use 1.",
            name: 'Local runtime models kept loaded',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeSleepIdle = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeSleepIdle',
            type: 'number',
            default: 0,
            description: "How many seconds an idle model is kept before the runtime unloads it (llama.cpp --sleep-idle-seconds). 0 means it is never unloaded, which is llama.cpp's own default and the shipped setting.\n\nUnloading frees memory but makes the next request much slower, because the whole model has to be loaded again: expect tens of seconds, and considerably more with 'Load mode: none'. Only set this if holding a model in memory for hours is a problem on your machine. Leave empty to never unload.",
            name: 'Local runtime unload after idle (seconds)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeWaitIdleSeconds = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeWaitIdleSeconds',
            type: 'number',
            default: 1800,
            description: "How long a request for a different model waits for the current generation to finish before that model is evicted anyway, in seconds.\n\nOnly one model is kept loaded by default, so a request that needs a different model has to unload the one in use. Rather than aborting the generation that is still running, the runtime lets it finish first, then switches. Local models on consumer hardware can be slow, so the shipped default is 30 minutes (1800 seconds).\n\nSet 0 to not wait at all: the model is evicted immediately, which truncates the running generation. Any other value is the cap in seconds; if the generation is still running when it is reached, the runtime logs a warning and evicts anyway, so a switch can never hang forever. Leave empty to use the 30-minute default.",
            name: 'Local runtime model-switch wait (seconds)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // Retired as a global option: parallel slots are a per-model setting now (see the Models
        // panel). The declaration stays registered so an existing install's old value can still be
        // read and migrated into the selected model's profile; the field itself is hidden from the
        // general card (see the wrapper's retired runtime option ids).
        this.optionRuntimeParallelSlots = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeParallelSlots',
            type: 'number',
            default: '',
            description: "Retired global option: how many requests one model handles at once (llama.cpp --parallel). Now a per-model setting, migrated into the selected model's profile on the next start. Empty uses llama.cpp's default.",
            name: 'Local runtime parallel slots (moved to per-model settings)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        var runtimeThreadsCpuNote = runtimeHardwareNote(_logicalCpuCount());
        this.optionRuntimeThreads = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeThreads',
            type: 'number',
            default: '',
            description: "How many CPU threads llama.cpp uses for generation (--threads).\n\nLeft empty, llama.cpp's own default is one thread per logical core, which is not always the fastest: on a 6-core/12-thread CPU measured on the bundled runtime, generation fell from 4.6 to 1.3 tok/s at 12 threads. If your CPU has hyperthreading, try setting this to the number of physical cores. The batch thread count is set to the same value automatically. Leave empty to let llama.cpp decide." + (runtimeThreadsCpuNote ? " " + runtimeThreadsCpuNote : ""),
            name: 'Local runtime CPU threads',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeThreadsBatch = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeThreadsBatch',
            type: 'number',
            default: '',
            description: "How many CPU threads llama.cpp uses for prompt processing and batching (--threads-batch). Prompt processing scales differently from generation and sometimes prefers a different count. Leave empty to use the same value as 'Local runtime CPU threads', which is llama.cpp's own default." + (runtimeThreadsCpuNote ? " " + runtimeThreadsCpuNote : ""),
            name: 'Local runtime CPU threads (prompt)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimePort = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimePort',
            type: 'number',
            default: 1234,
            description: "The port the bundled runtime serves on (llama.cpp --port), on 127.0.0.1 only.\n\n1234 is the default because it is the convention most local-inference tools already use, so an existing client's configuration usually works unchanged. The same port is used whether the runtime is started from here or from the standalone console launcher (SLR Runtime), so a client pointed at it works either way.\n\nIf the port is already in use the runtime does not start, rather than quietly moving to a different one - a client would otherwise be left pointing at an address nothing is serving. Set a different port here, or free the one in use.",
            name: 'Local runtime port',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // The persisted per-model runtime settings, keyed by GGUF file name. Stored as a JSON
        // string because the option system persists scalars; it is seeded once from the legacy
        // model-level options on the first Start after per-model settings shipped, then carried
        // to the runtime, where StartConfig applies each model's own profile to its server
        // arguments. It is internal state, not a field a user edits: the card's own model fields
        // write into it as they change (Task 11).
        this.optionRuntimeModelProfiles = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeModelProfiles',
            default: '',
            description: "Persisted per-model runtime settings, keyed by model file name. Managed automatically.",
            name: 'Local runtime model profiles',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeKvUnified = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeKvUnified',
            default: true,
            description: "Keeps one shared KV cache for all parallel slots instead of one cache per slot (llama.cpp --kv-unified). This is the default and is what lets an identical system prompt be reused across requests, cutting prompt processing time substantially. Turning it off gives each slot its own cache, which uses more memory but can isolate very long concurrent requests.",
            name: 'Local runtime unified KV cache',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionRuntimeKvOffload = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeKvOffload',
            default: true,
            description: "Keeps the KV cache in VRAM next to the offloaded layers (llama.cpp --kv-offload, the default). Turn this off to keep the cache in system RAM, which frees VRAM for more model layers but makes every token slower because the cache has to be read over the bus.",
            name: 'Local runtime KV cache in VRAM',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        // Server-level KV cache limits. They apply to every model the runtime serves, because
        // they sit in the runtime's shared globals rather than on one model entry. The shipped
        // defaults are the values the runtime already used, so exposing them changes nothing
        // until they are edited.
        this.optionRuntimeCacheRam = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeCacheRam',
            type: 'number',
            default: 4096,
            description: "Upper limit, in MiB, on the RAM the runtime's prompt cache may use (llama.cpp --cache-ram).\n\nA larger cache keeps more prompts around to be reused, which speeds up repeated work, at the cost of system memory. 0 disables the prompt cache. The shipped default is 4096. This is a server-level setting, applied to every model the runtime serves; leave empty to use the default.",
            name: 'Local runtime prompt cache RAM (MiB)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeCtxCheckpoints = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeCtxCheckpoints',
            type: 'number',
            default: 16,
            description: "Maximum number of context checkpoints kept per slot (llama.cpp --ctx-checkpoints).\n\nA checkpoint lets the runtime resume a prompt from an earlier point instead of reprocessing it from the start, which helps when requests share a long prefix. More checkpoints use more memory; 0 removes the minimum spacing between them. The shipped default is 16. This is a server-level setting, applied to every model the runtime serves; leave empty to use the default.",
            name: 'Local runtime context checkpoints',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeCacheReuse = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeCacheReuse',
            type: 'number',
            default: 256,
            description: "Minimum chunk size, in tokens, for reusing a matching part of the KV cache between requests (llama.cpp --cache-reuse).\n\nA smaller chunk reuses more aggressively but can add overhead; a larger one only reuses longer matches. The shipped default is 256. 0 is not accepted for this flag, so leave the field empty to use the default. This is a server-level setting, applied to every model the runtime serves.",
            name: 'Local runtime KV cache reuse chunk',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRuntimeReasoning = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeReasoning',
            default: 'off',
            description: "Whether the bundled llama-server starts with thinking/reasoning enabled. This is a server-side default: 'off' starts every model without thinking, while a request that explicitly asks for reasoning still gets it and a request that asks for none is never given any; the served model's own chat template decides which effort values exist. 'auto' lets the model's own chat template decide, which for thinking models means thinking is on by default.",
            name: 'Local runtime reasoning',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: { enum: ['off', 'auto', 'on'] },
            formOptions: { titleMap: { off: 'Off (recommended)', auto: 'Auto (the model decides)', on: 'On' } }
        });

        this.optionRuntimeAutoStart = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'runtimeAutoStart',
            default: false,
            description: "When on, the bundled local runtime starts by itself the next time SLR Translator opens, using the model and settings of the last Start / Use Local Runtime press, and reconnects the engine to it. Off by default: starting a model loads gigabytes into memory and takes time, so it should only happen when you asked for it.\n\nThis takes effect at the next app start; the setting is remembered as soon as it is changed.",
            name: 'Start local runtime when the app opens',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        // Ask DSLR chat settings live here (in the engine card, next to the runtime
        // settings) because the chat is part of the DSLR engine: it talks to the
        // same endpoint. The docsChat core module reads these via getOptions().
        //
        // These persist IMMEDIATELY on change (not via the 100ms debounced
        // save): a quit racing the debounce silently lost chat option changes.
        const chatOptionPersist = (id, value) => {
            try {
                this["option" + id.charAt(0).toUpperCase() + id.slice(1)].setValue(value);
                this.getEngine().update(id, value);
                sys.saveConfig().catch(function (err) {
                    console.error("[chat] FAILED to save option " + id + ":", err);
                });
            } catch (e) {
                console.error("[chat] persist failed for " + id + ":", e);
            }
        };
        const chatFormOptions = (id) => ({
            onChange: function (evt) {
                const value = $(evt.target).prop("checked");
                chatOptionPersist(id, value);
            }
        });
        this.optionChatReadLength = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'chatReadLength',
            formOptions: chatFormOptions('chatReadLength'),
            default: '24000',
            description: "How many characters of a manual page the Ask DSLR chat assistant may read at once (documentation excerpts get half of this). The default is conservative for a 32k context; raise it for models with larger contexts.",
            name: 'Chat manual page read length',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });
        this.optionChatHistoryMessages = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'chatHistoryMessages',
            formOptions: chatFormOptions('chatHistoryMessages'),
            default: '20',
            description: "How many past chat messages the Ask DSLR assistant sends along with each new question. Higher values remember more of the conversation but fill the context faster.",
            name: 'Chat remembered messages',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });
        this.optionChatRemember = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'chatRemember',
            formOptions: chatFormOptions('chatRemember'),
            default: true,
            description: "Keep Ask DSLR conversations when the chat window or the app closes. Each conversation is its own topic-scoped chat: when you open the chat you choose between the remembered conversations and a new one, and a small follow-up on an old topic never drags unrelated history along. The 20 most recent are kept, stored as plain text (questions and answers only) in data/ask-dslr-history.json.",
            name: 'Remember chat conversations',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });
        this.optionChatKeepCount = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'chatKeepCount',
            formOptions: chatFormOptions('chatKeepCount'),
            default: '20',
            description: "How many remembered Ask DSLR conversations to keep. When the limit is reached, the oldest are dropped. Keeping more makes old topics searchable for longer but grows data/ask-dslr-history.json.",
            name: 'Chat conversations kept',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        // The status line is a form node (not an option), exactly like the Quick Start "Test
        // connection" status: it has no value, is never saved, and is written in place from
        // the buttons and the background ticker. The element carries white-space: pre-wrap so
        // the multi-line describeStatus() output renders without widening the window.
        this.localRuntimeStatusNode = {
            type: 'help',
            helpvalue: '<div class="runtimeStatusLine" style="white-space:pre-wrap;font-family:monospace"></div>',
            notitle: true
        };

        // The bundled-runtime action buttons. The wrapper places them (and the status line
        // below) in the general sub-group of the one Bundled Local Runtime card, ahead of the
        // per-model and role groups. Declared last so the handlers' references to the runtime
        // options above are easy to follow.
        this.localRuntimeActionNodes = [
            {
                type: 'actions',
                title: 'Bundled Local Runtime',
                fieldHtmlClass: 'actionButtonSet',
                items: [
                    {
                        type: 'button',
                        title: 'Start / Use Local Runtime',
                        onClick: function (evt) {
                            try {
                                var runtime = localRuntime(evt);
                                if (!runtime) return;
                                var wrapper = window.slrDSLREngineWrapper;
                                var modelId = readOption(wrapper, 'optionRuntimeModel', '');
                                // Runtime tuning: NaN (empty field) lets the registry keep the
                                // per-model value from data/llama/drafts.json or its default.
                                var draftMax = parseInt(readOption(wrapper, 'optionRuntimeDraftMax', ''), 10);
                                if (isNaN(draftMax)) draftMax = NaN;
                                var draftMin = parseInt(readOption(wrapper, 'optionRuntimeDraftMin', ''), 10);
                                if (isNaN(draftMin)) draftMin = NaN;
                                // Context length: an integer, or NaN when the field is empty
                                // (the runtime then falls back to 32768).
                                var contextLength = parseInt(readOption(wrapper, 'optionRuntimeContextLength', ''), 10);
                                if (isNaN(contextLength)) contextLength = NaN;
                                // Legacy model-level KV type. The card now edits the split K/V
                                // fields per model, so this value is only used to seed a profile
                                // that predates the split (ModelProfiles.migrate reads it as
                                // runtimeKvType).
                                var kvType = readOption(wrapper, 'optionRuntimeKvType', '');
                                // Manual device placement. Empty strings / NaN mean "leave it to
                                // llama.cpp", so an untouched card behaves exactly as before.
                                var backend = readOption(wrapper, 'optionRuntimeBackend', 'auto');
                                var gpuLayers = readOption(wrapper, 'optionRuntimeGpuLayers', 'auto');
                                var cpuMoe = readOption(wrapper, 'optionRuntimeCpuMoe', false) === true;
                                var cpuMoeLayers = parseInt(readOption(wrapper, 'optionRuntimeCpuMoeLayers', ''), 10);
                                if (isNaN(cpuMoeLayers)) cpuMoeLayers = undefined;
                                // The paired draft's placement. Retired as globals like the other
                                // model-level fields: these three values only seed the selected
                                // model's per-model profile below, which is what the runtime
                                // applies (--spec-draft-ngl / --spec-draft-cpu-moe family).
                                // 'auto' / false / empty mean "leave it to llama.cpp".
                                var draftGpuLayers = readOption(wrapper, 'optionRuntimeDraftGpuLayers', 'auto');
                                var draftCpuMoe = readOption(wrapper, 'optionRuntimeDraftCpuMoe', false) === true;
                                var draftCpuMoeLayers = parseInt(readOption(wrapper, 'optionRuntimeDraftCpuMoeLayers', ''), 10);
                                if (isNaN(draftCpuMoeLayers)) draftCpuMoeLayers = undefined;
                                // VRAM headroom for llama.cpp's fit. An empty field is left out
                                // entirely; StartConfig normalises it so only an integer (or
                                // nothing) ever reaches the entry ModelArgs emits verbatim.
                                var fitTarget = parseInt(readOption(wrapper, 'optionRuntimeFitTarget', ''), 10);
                                if (isNaN(fitTarget)) fitTarget = undefined;
                                var splitMode = readOption(wrapper, 'optionRuntimeSplitMode', '');
                                var tensorSplit = readOption(wrapper, 'optionRuntimeTensorSplit', '');
                                var mainGpu = parseInt(readOption(wrapper, 'optionRuntimeMainGpu', ''), 10);
                                if (isNaN(mainGpu)) mainGpu = undefined;
                                var overrideTensor = readOption(wrapper, 'optionRuntimeOverrideTensor', '');
                                var expertCount = parseInt(readOption(wrapper, 'optionRuntimeExpertCount', ''), 10);
                                var loadMode = readOption(wrapper, 'optionRuntimeLoadMode', '');
                                if (isNaN(expertCount)) expertCount = undefined;
                                var libDir = readOption(wrapper, 'optionRuntimeLibDir', '');
                                var kvUnified = readOption(wrapper, 'optionRuntimeKvUnified', true) !== false;
                                var kvOffload = readOption(wrapper, 'optionRuntimeKvOffload', true) !== false;
                                // Server-level KV cache limits, applied to every child. Passed raw:
                                // StartConfig parses and range-checks them, and a cleared field
                                // falls back to the runtime's shipped default.
                                var cacheRam = readOption(wrapper, 'optionRuntimeCacheRam', '');
                                var ctxCheckpoints = readOption(wrapper, 'optionRuntimeCtxCheckpoints', '');
                                var cacheReuse = readOption(wrapper, 'optionRuntimeCacheReuse', '');
                                var autoStart = readOption(wrapper, 'optionRuntimeAutoStart', false) === true;
                                var modelsMax = parseInt(readOption(wrapper, 'optionRuntimeModelsMax', ''), 10);
                                var sleepIdle = parseInt(readOption(wrapper, 'optionRuntimeSleepIdle', ''), 10);
                                var threads = parseInt(readOption(wrapper, 'optionRuntimeThreads', ''), 10);
                                var threadsBatch = parseInt(readOption(wrapper, 'optionRuntimeThreadsBatch', ''), 10);
                                var reasoning = readOption(wrapper, 'optionRuntimeReasoning', 'off');
                                // Seconds a model switch waits for the outgoing model's running
                                // generation; NaN lets StartConfig fall back to 30 minutes.
                                var waitIdleSeconds = parseInt(readOption(wrapper, 'optionRuntimeWaitIdleSeconds', ''), 10);
                                // Slots one model serves at once. Retired as a global: this value
                                // only seeds the selected model's per-model profile below, which
                                // is what the runtime applies (llama.cpp --parallel).
                                var parallelSlots = parseInt(readOption(wrapper, 'optionRuntimeParallelSlots', ''), 10);
                                // Passed raw: the runtime tells a blank field (use 1234) apart from an
                                // invalid one (1.5, 0, 70000, "abc") and refuses the latter. parseInt
                                // would fold both into NaN, making a typo silently start on 1234.
                                var port = readOption(wrapper, 'optionRuntimePort', '');
                                // Per-model profile map: parse the persisted JSON, seeding it once
                                // from this card's model-level values and the model's drafts.json
                                // pairing when it is empty. It is carried to the runtime, where
                                // each model's own profile decorates its server arguments.
                                // Persist the resolved map so the migration happens
                                // once and later edits build on it.
                                var profiles = localRuntimeModelProfiles({
                                    raw: readOption(wrapper, 'optionRuntimeModelProfiles', ''),
                                    legacy: {
                                        runtimeContextLength: contextLength, runtimeKvType: kvType,
                                        runtimeGpuLayers: gpuLayers, runtimeCpuMoe: cpuMoe,
                                        runtimeCpuMoeLayers: cpuMoeLayers, runtimeLoadMode: loadMode,
                                        runtimeSplitMode: splitMode, runtimeTensorSplit: tensorSplit,
                                        runtimeMainGpu: mainGpu, runtimeOverrideTensor: overrideTensor,
                                        runtimeExpertCount: expertCount,
                                        runtimeDraftMax: draftMax, runtimeDraftMin: draftMin,
                                        runtimeDraftGpuLayers: draftGpuLayers, runtimeDraftCpuMoe: draftCpuMoe,
                                        runtimeDraftCpuMoeLayers: draftCpuMoeLayers,
                                        runtimeParallelSlots: parallelSlots
                                    },
                                    drafts: (typeof runtime.readDrafts === 'function') ? runtime.readDrafts() : {},
                                    selectedId: modelId
                                });
                                // The per-model profile StartConfig will apply to the starting
                                // model, echoed so the user can confirm a forced draft took.
                                try { console.log("[runtime] start profile for " + modelId + ":", JSON.stringify(profiles[modelId] || null)); } catch (e) {}
                                try {
                                    if (wrapper && wrapper.optionRuntimeModelProfiles) {
                                        wrapper.optionRuntimeModelProfiles.setValue(JSON.stringify(profiles));
                                    }
                                } catch (e) { /* persistence is best effort; the map still reaches the start */ }
                                // The card is the only place a person types these values, and the
                                // runtime's own validator is the right authority on them: report what
                                // is wrong instead of letting the server silently clamp it to something
                                // else. The clamps in StartConfig stay, because the console and
                                // auto-start paths have nobody watching them.
                                var associations = (runtime && typeof runtime.associations === 'function')
                                    ? runtime.associations() : null;
                                var validation = ModelProfiles_1.validate(
                                    profiles[modelId],
                                    (associations && associations.byTarget) ? (associations.byTarget[modelId] || null) : null
                                );
                                if (!validation.ok) {
                                    refreshStatus(evt, "Cannot start the local runtime: " + validation.errors.join("; "));
                                    return;
                                }
                                // Immediate feedback: starting can take minutes on CPU.
                                refreshStatus(evt, 'Starting the local runtime...');
                                runtime.startLocal({
                                    modelId: modelId, draftMax: draftMax, draftMin: draftMin,
                                    contextLength: contextLength, kvType: kvType,
                                    backend: backend, gpuLayers: gpuLayers,
                                    cpuMoe: cpuMoe, cpuMoeLayers: cpuMoeLayers,
                                    fitTarget: fitTarget,
                                    splitMode: splitMode, tensorSplit: tensorSplit,
                                    mainGpu: mainGpu, overrideTensor: overrideTensor,
                                    expertCount: expertCount, libDir: libDir,
                                    loadMode: loadMode,
                                    modelsMax: modelsMax, sleepIdleSeconds: sleepIdle,
                                    threads: threads, threadsBatch: threadsBatch,
                                    reasoning: reasoning,
                                    waitIdleSeconds: waitIdleSeconds,
                                    cacheRam: cacheRam, ctxCheckpoints: ctxCheckpoints,
                                    cacheReuse: cacheReuse,
                                    port: port,
                                    kvUnified: kvUnified, kvOffload: kvOffload,
                                    autoStart: autoStart,
                                    profiles: profiles,
                                    // Content detection for the draft/projector pairing, so a
                                    // profile's forced draft id can carry its spec type. Guarded:
                                    // an older/partial api simply omits it and detection stands.
                                    associations: associations
                                }).then(function (state) {
                                    runtime.setSelectedModel(state.modelId);
                                    runtime.bindToDslr(state.modelId);
                                    // Repopulate the picker in place (no full re-render).
                                    syncRuntimeModelSelect(evt);
                                    if (wrapper && wrapper.optionRuntimeModel) {
                                        try { wrapper.optionRuntimeModel.setValue(state.modelId); } catch (e) { /* ignore */ }
                                    }
                                    // Full status (backend, URL, model, context, KV, spec decoding).
                                    if (runtime.describeStatus) return runtime.describeStatus();
                                    return null;
                                }).then(function (text) {
                                    refreshStatus(evt, text || 'Running.');
                                }).catch(function (err) {
                                    refreshStatus(evt, 'Failed to start: ' + ((err && err.message) || err));
                                });
                            } catch (e) {
                                refreshStatus(evt, 'Failed to start: ' + ((e && e.message) || e));
                            }
                        }
                    },
                    {
                        type: 'button',
                        title: 'Refresh Model List',
                        onClick: function (evt) {
                            try {
                                var runtime = localRuntime(evt);
                                if (!runtime) return;
                                var wrapper = window.slrDSLREngineWrapper;
                                var option = wrapper && wrapper.optionRuntimeModel;
                                if (!option) return;
                                var modelIds = runtimeModelIds();
                                syncRuntimeModelSelect(evt);
                                refreshStatus(evt, modelIds.length + ' local model' + (modelIds.length === 1 ? '' : 's') + ' found.');
                            } catch (e) {
                                refreshStatus(evt, 'Could not refresh the model list: ' + ((e && e.message) || e));
                            }
                        }
                    },
                    {
                        type: 'button',
                        title: 'Stop Local Runtime',
                        onClick: function (evt) {
                            var runtime = localRuntime(evt);
                            if (!runtime) return;
                            // An attached runtime is owned by the console launcher, not this
                            // window: refuse before stop() instead of silently disconnecting
                            // from a live server. Fail open if the status cannot be read.
                            var decision = { allowed: true, message: '' };
                            try {
                                decision = localRuntimeStopDecision(runtime.status());
                            } catch (e) { /* unreadable status must not block a legitimate stop */ }
                            if (!decision.allowed) {
                                refreshStatus(evt, decision.message);
                                return;
                            }
                            runtime.stop().then(function () {
                                refreshStatus(evt, 'Stopped.');
                            }).catch(function (err) {
                                refreshStatus(evt, 'Failed to stop: ' + ((err && err.message) || err));
                            });
                        }
                    },
                    {
                        type: 'button',
                        title: 'Runtime Status',
                        onClick: function (evt) {
                            var runtime = localRuntime(evt);
                            if (!runtime) return;
                            // Recompute the full status (including live speculative-decoding
                            // metrics) and show it in the non-modal status field.
                            if (runtime.describeStatus) {
                                runtime.describeStatus().then(function (text) {
                                    refreshStatus(evt, text || 'Status unavailable.');
                                }).catch(function (err) {
                                    refreshStatus(evt, 'Failed to read status: ' + ((err && err.message) || err));
                                });
                                return;
                            }
                            var s = runtime.status();
                            var text = 'Status: ' + s.status +
                                '\nBackend: ' + (s.backend || '-') +
                                (s.device ? ' (' + s.device + ')' : '') +
                                '\nURL: ' + (s.baseUrl || '-') +
                                '\nModels: ' + ((s.models && s.models.length) || 0);
                            if (s.error) text += '\nError: ' + s.error;
                            refreshStatus(evt, text);
                        }
                    },
                    {
                        type: 'button',
                        title: 'Status Window',
                        onClick: function (evt) {
                            var runtime = localRuntime(evt);
                            if (!runtime) return;
                            // The always-on-top status window follows the runtime by itself;
                            // this reopens it after it was closed by hand during a run.
                            if (!runtime.showStatusWindow) {
                                refreshStatus(evt, 'This copy of the runtime module has no status window support.');
                                return;
                            }
                            runtime.showStatusWindow();
                            refreshStatus(evt, 'Status window opened. It stays on top and follows the runtime until it stops.');
                        }
                    },
                    {
                        type: 'button',
                        title: 'Model Info',
                        onClick: function (evt) {
                            try {
                                var runtime = localRuntime(evt);
                                if (!runtime) return;
                                if (!runtime.modelMeta) {
                                    refreshStatus(evt, 'This copy of the runtime module cannot read model metadata.');
                                    return;
                                }
                                var meta = runtime.modelMeta();
                                if (!meta) {
                                    refreshStatus(evt, 'Could not read the selected model\'s metadata. Check that the GGUF file is complete.');
                                    return;
                                }
                                var text = 'Model: ' + (meta.name || '-') +
                                    '\nArchitecture: ' + meta.arch +
                                    '\nExperts per token: ' + (meta.expertUsedCount == null ? 'not a MoE model' : meta.expertUsedCount) +
                                    (meta.expertCount == null ? '' : '\nExperts total: ' + meta.expertCount) +
                                    '\n\nSet "Local runtime experts used per token" to change how many are activated, then press Start.';
                                refreshStatus(evt, text);
                            } catch (e) {
                                refreshStatus(evt, 'Could not read model info: ' + ((e && e.message) || e));
                            }
                        }
                    },
                    {
                        type: 'button',
                        title: 'Chat Template',
                        onClick: function (evt) {
                            var runtime = localRuntime(evt);
                            if (!runtime) return;
                            if (!runtime.showTemplateWindow) {
                                refreshStatus(evt, 'This copy of the runtime module has no chat template support.');
                                return;
                            }
                            runtime.showTemplateWindow();
                            refreshStatus(evt, 'Chat template window opened. A saved template replaces the model\'s own from the next Start.');
                        }
                    }
                ]
            }
        ];

        // The action buttons and the status line are NOT attached to the model picker any more.
        // They used to be the picker's childForm, which rendered them inside the per-model group;
        // the wrapper now places them in the general sub-group of the one Bundled Local Runtime
        // card through sectionAppend, so the picker keeps no childForm.
        this.optionDoNotFixURL = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'doNotFixURL',
            default: false,
            description: "Will skip URL checks and just send the request to whatever you put in.\nOtherwise it will try to adjust the URL if it does not see a supported ending.",
            name: 'Do not attempt to fix URL',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionApiKey = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'apiKey',
            default: '',
            description: "Your API key. Just leave this blank for something like LM Studio.\n\nCaution: It will be saved in plain text.",
            name: 'API Key',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'password'
        });

        this.optionModel = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'model',
            default: 'qwen35-4b-paperwitch-q8.gguf',
            description: "The model name your endpoint expects. No specific models are recommended here - model names and what is good change constantly, so use whatever your endpoint offers.\n\nWhen locally hosting and using Full Batch, set the model's context length to at least 12k.\n\nIf the model supports thinking/reasoning, disable it in the model template or with the reasoning options below. Thinking makes translation slow and expensive and does not help it.\n\nSmall models may fail to follow the complex batch instructions, especially at low quantization.",
            name: 'Model',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionEnableFallback = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableFallback',
            default: false,
            description: "Enable automatic fallback to a different LLM if the primary LLM gets stuck. For example to use a fast cheap model for general translation and an expensive large model to take care of the difficult parts.\nWhen the primary model fails a Full Batch even after its correction-prompt retries, the fallback model is tried on the SAME batch before it is split, so no context is lost. Only if the fallback model also fails is the batch split and handed back to the primary model.\nThe fallback model also steps in if the primary model keeps hitting server errors (for example its provider crashed or needs payment), so the primary is not retried endlessly.\n\nCaution: You need to make sure your local endpoint actually unloads the primary when loading the fallback and vice versa.\n\nCaution2: This could create some jarring transitions if the translation style of the fallback model is drastically different.",
            name: 'Enable Fallback LLM',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionLimitFallback = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'limitFallback',
            default: false,
            description: "Limit automatic fallback to single requests. With this disabled, the fallback model is tried on the whole failed batch before it is split. With this enabled, it instead only retries the individual failed request a few more times with the fallback model (2 times without aggressive correction prompts, 3 times with them), without retrying the entire Full Batch. This is good for very slow locally hosted LLM options.\n\nCaution: I do not recommend using this with limited free requests of a premium model. This would waste them very quickly.",
            name: 'Limit Fallback to Single Requests',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionApiUrl2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'apiUrl2',
            default: 'http://127.0.0.1:1234/v1/chat/completions',
            description: "The fallback API endpoint URL. It will automatically add 'v1/chat/completions' to the end if nothing similar is there (unless turned off).\nCaution: If you are not using LM Studio your endpoint likely does not support the repeat_penalty parameter and you should leave it empty.",
            name: 'Fallback API URL',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionDoNotFixURL2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'doNotFixURL2',
            default: false,
            description: "Will skip URL checks and just send the request to whatever you put in.\nOtherwise it will try to adjust the URL if it does not see a supported ending.",
            name: 'Fallback Do not attempt to fix URL',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionApiKey2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'apiKey2',
            default: '',
            description: "The fallback API key. Just leave this blank for something like LM Studio.\n\nCaution: It will be saved in plain text.",
            name: 'Fallback API Key',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'password'
        });

        this.optionModel2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'model2',
            default: 'qwen3.5-4b-paperwitch-heresy',
            description: "The fallback model to use for translation when the primary one fails completely. Use a model at least as capable as your primary, or it will likely fail too. No specific models are recommended here - use whatever your endpoint offers.\n\nWhen locally hosting and using this for Full Batch, set the context length to at least 12k.\n\nIf the model supports thinking/reasoning, disable it (see the fallback reasoning options below).",
            name: 'Fallback Model',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionTemperature = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'temperature',
            default: 0.1,
            description: "Lower values make translations more consistent, higher values more creative. Creative can mean that it tries to destroy everything. Keep it as low as your model can handle. Leave empty to not send the parameter at all.",
            name: 'temperature',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
        });

        this.optionTopK = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'top_k',
            type: 'number',
            default: null,
            description: "Top-K sampling: Only sample from the top K most likely tokens at each step. Lower values make output more predictable but less diverse. Set to 0 to disable. Leave empty to not send the parameter at all.\n\nCaution: Not usable with newest GPT models, check your model documentation.",
            name: 'top_k',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionTopP = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'top_p',
            type: 'number',
            default: null,
            description: "Top-P sampling (nucleus sampling): Only sample from tokens that make up the top P probability mass. Lower values make output more focused but less diverse. Set to 1.0 to disable. Leave empty to not send the parameter at all.\n\nCaution: Not usable with newest GPT models, check your model documentation.",
            name: 'top_p',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMinP = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'min_p',
            type: 'number',
            default: null,
            description: "Min-P sampling: Only sample from tokens with probability >= min_p. Helps prevent very low probability tokens from being selected. Set to 0 to disable. Leave empty to not send the parameter at all.\n\nCaution: Not usable with newest GPT models, check your model documentation.",
            name: 'min_p',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepeatPenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repeat_penalty',
            type: 'number',
            default: 1.05,
            description: "Penalty for repeated tokens. Values >1 discourage repetition, <1 encourage it. Leave empty to not send the parameter at all.\n\nCaution: Mainly for local models, not usable with newest GPT models, check your model documentation.\n\nCaution2: It considers placeholders repeated token, so values above 1.0 could actually prevent Full Batch from working.",
            name: 'repeat_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepetitionPenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repetition_penalty',
            type: 'number',
            default: null,
            description: "Same as Repeat Penalty, but used for different endpoints. Penalty for repeated tokens. Values >1 discourage repetition, <1 encourage it. Leave empty to not send the parameter at all.\n\nCaution: It considers placeholders repeated token, so values above 1.0 could actually prevent Full Batch from working.\n\nCaution: Not usable with LM Studio and old endpoints, check your model documentation.",
            name: 'repetition_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionFrequencyPenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'frequency_penalty',
            type: 'number',
            default: null,
            description: "Penalizes token based on how frequent they already were. Unlike Repetition Penalty this does not create a hard backstop. Typical range -2.0 to 2.0. Leave empty to not send the parameter at all.\n\nCaution: Not usable with LM Studio and old endpoints, check your model documentation.",
            name: 'frequency_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionPresencePenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'presence_penalty',
            type: 'number',
            default: null,
            description: "Penalizes token for simply having been present already. Typical range -2.0 to 2.0. Leave empty to not send the parameter at all.\n\nCaution: Not usable with LM Studio and old endpoints, check your model documentation.",
            name: 'presence_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepetitionCharLimit = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repetitionCharLimit',
            type: 'number',
            default: 20,
            description: "How many times a single character may be repeated back to back in a streamed LLM response before the model is considered stuck in a repetition loop. This covers drawn-out sounds like \"Ahhhhhhhh\" or long punctuation runs like \"………\".\n\nWhen the limit is reached the response is terminated immediately instead of generating on until it hits the token limit, and the request is retried exactly as if a \"length\" finish reason had occurred: the retry automatically sends an increased repeat_penalty / repetition_penalty / frequency_penalty, whichever of those parameters is set.\n\nThe other repetition tiers have their own options: 'Repetition Loop Threshold (Words & Sentences)', 'Repetition Loop Threshold (Entries)' and 'Repetition Loop Threshold (Repeated Content)'. All of them require response streaming to be active ('Enable Token Progress Display' on and 'Disable Stream' off), because the repetition has to be watched while the response is being generated.\n\nSet to 0 to disable this check.",
            name: 'Repetition Loop Threshold (Single Characters)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepetitionLimit = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repetitionLimit',
            type: 'number',
            default: 15,
            description: "How many times the same word, phrase, or sentence may be repeated back to back in a streamed LLM response before the model is considered stuck in a repetition loop. This covers repeated words and sound effects like \"Ah Ah Ah Ah\".\n\nWhen the limit is reached the response is terminated immediately instead of generating on until it hits the token limit, and the request is retried exactly as if a \"length\" finish reason had occurred: the retry automatically sends an increased repeat_penalty / repetition_penalty / frequency_penalty, whichever of those parameters is set.\n\nThe other repetition tiers have their own options: 'Repetition Loop Threshold (Single Characters)', 'Repetition Loop Threshold (Entries)' and 'Repetition Loop Threshold (Repeated Content)'. All of them require response streaming to be active ('Enable Token Progress Display' on and 'Disable Stream' off), because the repetition has to be watched while the response is being generated.\n\nSet to 0 to disable this check.",
            name: 'Repetition Loop Threshold (Words & Sentences)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepetitionEntryLimit = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repetitionEntryLimit',
            type: 'number',
            default: 4,
            description: "How many times structured content may be repeated back to back in a streamed LLM response before the model is considered stuck in a repetition loop. This covers full entries/sections that can never legitimately repeat: glossary term definitions, batch sections, whole blocks of distinct entries cycled as a group, and duplicated response ids ('--- {дivN} ---' section markers or JSON entry ids - every id exists exactly once in the original, so any repetition of it is duplication).\n\nWhen the limit is reached the response is terminated immediately instead of generating on until it hits the token limit, and the request is retried exactly as if a \"length\" finish reason had occurred: the retry automatically sends an increased repeat_penalty / repetition_penalty / frequency_penalty, whichever of those parameters is set.\n\nThis also controls the response id check, which fires after this many duplicated ids (or immediately on ids beyond the batch's range).\n\nThe other repetition tiers have their own options: 'Repetition Loop Threshold (Single Characters)', 'Repetition Loop Threshold (Words & Sentences)' and 'Repetition Loop Threshold (Repeated Content)'. All of them require response streaming to be active ('Enable Token Progress Display' on and 'Disable Stream' off), because the repetition has to be watched while the response is being generated.\n\nSet to 0 to disable this check (including the id check).",
            name: 'Repetition Loop Threshold (Entries)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepetitionSkeletonLimit = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repetitionSkeletonLimit',
            type: 'number',
            default: 6,
            description: "How many times the same content may be re-issued anywhere in a streamed LLM response before the model is considered stuck in a repetition loop. Unlike the other tiers this is not limited to back-to-back copies: it counts repeats across the whole response, which catches a derailed reviewer working through the same material over and over — the same line repeated verbatim (\"Let's check @6 again. ... is the issue.\" many times) or one row revisited again and again with slightly different wording.\n\nRow numbers are part of the comparison, so findings about DIFFERENT rows are never mistaken for a loop: a QC pass reporting \"extra quotation mark at the end of the line\" for @5, @9, @14 and so on is normal output, not repetition.\n\nCurrently applies to Review (QC/judge) streams only.\n\nWhen the limit is reached the response is terminated immediately instead of generating on until it hits the token limit, and the request is retried exactly as if a \"length\" finish reason had occurred: the retry automatically sends an increased repeat_penalty / repetition_penalty / frequency_penalty, whichever of those parameters is set.\n\nThe other repetition tiers have their own options: 'Repetition Loop Threshold (Single Characters)', 'Repetition Loop Threshold (Words & Sentences)' and 'Repetition Loop Threshold (Entries)'. All of them require response streaming to be active ('Enable Token Progress Display' on and 'Disable Stream' off), because the repetition has to be watched while the response is being generated.\n\nSet to 0 to disable this check.",
            name: 'Repetition Loop Threshold (Repeated Content)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });


        this.optionDisableStream = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'disableStream',
            default: false,
            description: "Stream is not supported, but usually already disabled by default. Enable this if you actually need to send the 'stream = false' parameter to disable it.",
            name: 'Disable Stream',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableTokenProgress = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableTokenProgress',
            default: true,
            description: "Shows a live 'Generating response: N tokens' counter that updates while the LLM is producing each response, giving you progress feedback between 'Sending Batch' and 'Batch completed'.\n\nInternally this enables response streaming to count tokens (and to feed the live preview when 'Enable Stream Preview Display' is on).\n\nCaution: This sends 'stream: true' and 'stream_options: { include_usage: true }' to the endpoint. Most endpoints (e.g. LM Studio) support this, but if your provider rejects streaming requests you should disable it.\n\nCaution2: This has no effect while 'Disable Stream' is enabled, since that explicitly forces stream off.",
            name: 'Enable Token Progress Display',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableStreamPreview = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableStreamPreview',
            default: true,
            description: "While the LLM is producing each response, the streamed text is shown as a live preview above the token counter (the counter stays below the growing preview so it remains in view), then the preview is removed from view once the response completes so the log does not grow. Disable this if you only want the token counter.\n\nWhen several responses are streaming at once (concurrent batches across the endpoint pool), the previews are hidden and only the token counters of all streams keep updating, so the console stays readable. Enable 'Stream All Concurrent Responses' to show every stream's preview at the same time instead.\n\nThe full request/response logging always stays in the F12 console.\n\nThis has no effect while 'Enable Token Progress Display' is disabled (that option drives the streaming both features run on), and no effect while 'Disable Stream' is enabled.",
            name: 'Enable Stream Preview Display',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionStreamAllPreviews = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'streamAllPreviews',
            default: false,
            description: "By default, while several responses are streaming at once (concurrent batches across the endpoint pool) no stream preview is shown and only the token counters keep updating, so the console stays readable.\n\nEnable this to show the live preview of every active stream at the same time instead. Each preview is labeled with its endpoint, so this is mainly useful if you run few but very slow connections and want to watch them all.\n\nThis has no effect while only a single response is streaming (its preview is always shown), no effect while 'Enable Stream Preview Display' is disabled, and no effect while 'Disable Stream' is enabled.",
            name: 'Stream All Concurrent Responses',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionChatTemplateKwargs = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'chat_template_kwargs',
            default: '',
            description: "This can be necessary on some models to turn off reasoning among other things.",
            name: 'chat_template_kwargs',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRequestDelay = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'requestDelay',
            default: 50,
            description: "Delay in milliseconds between API requests to prevent rate limiting.\nIf attempting an automatic retry due to an unacceptable response it will add 1000ms.\nIf attempting an automatic retry due to rate limiting, it will add 3000ms.\nIf attempting an automatic retry due to an unknown server error it will add 30000ms.\nIf a fallback model is enabled, the primary model only retries server errors about twice before switching to the fallback model, instead of using the full server-error retry count.",
            name: 'Request Delay',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxTokens = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxTokens',
            default: 8000,
            description: "Maximum number of tokens to generate in the response. If not using a reasoning model, it will automatically decrease this number based on the original text input, but it will not go above it. It will also never go below 100 so certain models don't complain.\n\nCaution: This will not increase Context Length. That needs to be adjusted in LM Studio or whatever you are using.\n\nCaution2: Some very niche models do not support 'max_tokens'. In that case you need to edit the engine js to use 'max_completion_tokens' instead.",
            name: 'Max Response Tokens',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });
        this.optionScaleMaxTokensResponses = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'scaleMaxTokensResponses',
            default: false,
            description: "On /responses endpoints the max output token limit is normally left uncapped (the full 'Max Response Tokens'), because some backends flakily ignore reasoning.effort and reason anyway, which would otherwise eat the whole (small) token budget and return no translation.\n\nEnable this to apply the normal input-size-based max-token scaling on /responses too. This is more efficient and limits token waste from repetition loops, but only turn it on once you have confirmed your backend reliably honors reasoning.effort:\"none\" (i.e. it no longer reasons). Otherwise reasoning can still starve the budget and produce empty results.",
            name: 'Scale Down Max Tokens on /responses',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });
        this.optionMaxContextLength = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxContextLength',
            default: 0,
            description: "The model's total context window in tokens (e.g., 8192, 32768, 128000). Set to 0 to disable.\n\nWhen set, the engine estimates the token cost of the system prompt + user text + response reserve, and dynamically trims Scene Context to fit within the budget. This prevents weaker models from running out of context length.\n\nCaution: Token estimation is approximate. Leave some headroom (set this a few thousand below the model's actual limit).",
            name: 'Context Length Limit',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionCacheFriendlyPrompts = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'cacheFriendlyPrompts',
            default: true,
            description: "Keeps the system message byte-identical across every request of a run so prefix/KV-cache servers (SGLang radix cache, vLLM automatic prefix caching, LM Studio, llama.cpp) can reuse it, which can dramatically cut prompt processing time.\n\nWhen disabled, the system prompt is assembled from the base prompt plus everything variable: the System Prompt Addition, the glossary, Scene Context and the previous-translations context. Because those change between batches, each request has a different system prompt and the cache is a miss every time.\n\nWhen enabled (default), the system message contains ONLY the constant translation rules (the base System/Batch System Prompt). Everything variable is moved out of the system prompt and sent as a separate user message right before the actual translation request instead. The model sees the same information, just in a different message, so translations are unaffected - only the request layout changes.\n\nApplies to the primary model, the fallback model and to Full Batch as well as line-by-line requests. The glossary/scene token budgeting of 'Context Length Limit' keeps working unchanged. Review (QC/judge) requests follow the same layout: with the option on, their glossary/scene context travels as a separate user message ahead of the review task instead of inside it; with it off, the context stays inside the review's user message. If a backend mishandles the split layout, turning this off restores the single-message requests.",
            name: 'KV-Cache Friendly Prompts (stable system prompt)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableReasoning = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableReasoning',
            default: false,
            description: "Legacy: enable usage of old reasoning models that cannot restrict reasoning and just dump their reasoning block into the response. This removes maxToken scaling (always allows the max amount to give it room to think) and tries to strip reasoning blocks from the response.\n\nFor modern reasoning models prefer 'Reasoning Format' below, which actually triggers reasoning and supports reasoning budgets.",
            name: 'Enable Reasoning (legacy)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionReasoningFormat = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'reasoningFormat',
            default: 'none',
            description: "How to trigger reasoning/thinking for the primary model.\n\nIf you are using the bundled local runtime (the model picker above), you can normally leave this on None. The runtime decides thinking per model on its own: the server-level 'Local runtime reasoning' option sets the default for every model, and each request is then checked against the served model's own chat template, which is read from the model itself. Selecting a format here matters mainly when the endpoint is NOT the bundled runtime, or when you want one endpoint to reason while the server default stays off. To ask for thinking on a bundled model, pick 'Qwen3 enable_thinking' - that is the switch the bundled runtime honours (it sets chat_template_kwargs.enable_thinking, which is a plain on/off). Note that the 'Reasoning Effort' level below is ignored there: the bundled route is on/off only, and an effort level on its own does nothing while the server-side default is Off. Pre-made formats so you don't have to hand-craft custom parameters:\n- None (disabled, recommended): turns thinking off using whatever disable parameter the endpoint understands - DeepSeek, /v4 or /responses URLs, the bundled local runtime, and Qwen-named models are handled automatically. Nothing is sent where no mechanism is known, so a provider can never be surprised by a field it does not accept.\n- Not enabled: never asks for thinking and never sends a disable parameter either. Choose this when a provider rejects fields it does not recognise and you want the request left completely alone.\n- OpenAI reasoning_effort: sends 'reasoning_effort' (o-series / GPT-5 / OpenRouter / Ollama; Ollama's OpenAI-compatible endpoint only honors this and the reasoning.effort object).\n- OpenAI-compatible thinking object: sends 'thinking: { type: \"enabled\", budget_tokens }' (LM Studio / vLLM / many gateways).\n- Gemini thinkingConfig: sends 'generationConfig.thinkingConfig.thinkingBudget' (native Google Gemini API).\n- Qwen3 enable_thinking: sets 'chat_template_kwargs.enable_thinking = true'. This is also the pick for asking a bundled local model to think.\n\nWhen a reasoning format (anything other than None or Not enabled) is selected, max_tokens is left uncapped (room to think), inline think blocks are stripped from the response if present, and structured 'reasoning_content' (or Ollama's 'reasoning') is shown in the stream preview but ignored automatically.\n\nCaution: Reasoning makes a full game translation drastically slower and more expensive. Leave on None unless you know what you are doing.",
            name: 'Reasoning Format',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: {
                enum: ['none', 'not_enabled', 'openai_effort', 'thinking_object', 'gemini', 'qwen']
            },
            formOptions: {
                titleMap: {
                    'none': 'None (disabled - turns thinking off where the endpoint allows)',
                    'not_enabled': 'Not enabled (sends no disable parameter)',
                    'openai_effort': "OpenAI reasoning_effort (o-series / GPT-5 / OpenRouter / Ollama)",
                    'thinking_object': "OpenAI-compatible thinking object (LM Studio / vLLM)",
                    'gemini': "Gemini thinkingConfig (native Google API)",
                    'qwen': "Qwen3 enable_thinking"
                }
            }
        });

        this.optionReasoningEffort = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'reasoningEffort',
            default: 'low',
            description: "Reasoning effort/intensity. Mapped to the effort string for OpenAI reasoning_effort, and to a default thinking-token budget tier for the thinking-object and Gemini formats (minimal=256, low=1024, medium=4096, high=16384, max=65536). 'max' matches the top tier of the OpenAI/DeepSeek/Ollama effort ladders. Ignored for Qwen3 (on/off only).",
            name: 'Reasoning Effort',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: {
                enum: ['minimal', 'low', 'medium', 'high', 'max']
            },
            formOptions: {
                titleMap: {
                    'minimal': 'Minimal',
                    'low': 'Low',
                    'medium': 'Medium',
                    'high': 'High',
                    'max': 'Max'
                }
            }
        });

        this.optionReasoningBudget = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'reasoningBudget',
            type: 'number',
            default: null,
            description: "Optional explicit reasoning token budget, overriding the effort-based tier. Only used by the thinking-object and Gemini formats. Leave empty to use the effort tier.\n\nCaution: For the thinking-object format, budget_tokens must be smaller than max_tokens. If your budget is at least as large as the current max_tokens, the engine automatically raises max_tokens to budget + 1024 to satisfy the endpoint.",
            name: 'Reasoning Budget (tokens)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionTemperature2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'temperature2',
            default: 0.0,
            description: "Lower values make translations more consistent, higher values more creative. Creative can mean that it tries to destroy everything. Keep it as low as your model can handle. Leave empty to not send the parameter at all.",
            name: 'Fallback Temperature',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
        });

        this.optionTopK2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'top_k2',
            type: 'number',
            default: null,
            description: "Top-K sampling: Only sample from the top K most likely tokens at each step. Lower values make output more predictable but less diverse. Set to 0 to disable. Leave empty to not send the parameter at all.\n\nCaution: Not usable with newest GPT models, check your model documentation.",
            name: 'Fallback Top K',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionTopP2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'top_p2',
            type: 'number',
            default: null,
            description: "Top-P sampling (nucleus sampling): Only sample from tokens that make up the top P probability mass. Lower values make output more focused but less diverse. Set to 1.0 to disable. Leave empty to not send the parameter at all.\n\nCaution: Not usable with newest GPT models, check your model documentation.",
            name: 'Fallback Top P',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMinP2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'min_p2',
            type: 'number',
            default: null,
            description: "Min-P sampling: Only sample from tokens with probability >= min_p. Helps prevent very low probability tokens from being selected. Set to 0 to disable. Leave empty to not send the parameter at all.\n\nCaution: Not usable with newest GPT models, check your model documentation.",
            name: 'Fallback Min P',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepeatPenalty2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repeat_penalty2',
            type: 'number',
            default: 1.05,
            description: "Penalty for repeated tokens. Values >1 discourage repetition, <1 encourage it. Leave empty to not send the parameter at all.\n\nCaution: Mainly for local models, not usable with newest GPT models, check your model documentation.\n\nCaution2: It considers placeholders repeated token, so this could actually prevent Full Batch from working.",
            name: 'Fallback Repeat Penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRepetitionPenalty2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'repetition_penalty2',
            type: 'number',
            default: null,
            description: "Same as Repeat Penalty, but used for different endpoints. Penalty for repeated tokens. Values >1 discourage repetition, <1 encourage it. Leave empty to not send the parameter at all.\n\nCaution: It considers placeholders repeated token, so values above 1.0 could actually prevent Full Batch from working.\n\nCaution2: Not usable with LM Studio and old endpoints, check your model documentation.",
            name: 'Fallback Repetition Penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionRequestDelay2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'requestDelay2',
            default: 50,
            description: "Delay in milliseconds between API requests to prevent rate limiting.\nThis needs to be at least 3000ms for the ':free' models to work.\nIf attempting an automatic retry due to an unacceptable response it will add 1000ms.\nIf attempting an automatic retry due to rate limiting, it will add 3000ms.\nIf attempting an automatic retry due to an unknown server error it will add 30000ms.\nIf a fallback model is enabled, the primary model only retries server errors about twice before switching to the fallback model, instead of using the full server-error retry count.",
            name: 'Fallback Request Delay',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxTokens2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxTokens2',
            default: 5000,
            description: "Maximum number of tokens to generate in the response. If not using a reasoning model, it will automatically decrease this number based on the original text input, but it will not go above it. It will also never go below 100 so certain models don't complain.\n\nCaution: This will not increase Context Length. That needs to be adjusted in LM Studio or whatever you are using.\n\nCaution2: Some very niche models do not support 'max_tokens'. In that case you need to edit the engine js to use 'max_completion_tokens' instead.",
            name: 'Fallback Max Response Tokens',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxContextLength2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxContextLength2',
            default: 0,
            description: "The fallback model's total context window in tokens (e.g., 8192, 32768, 128000). Set to 0 to disable.\n\nWhen set, the engine estimates the token cost of the system prompt + user text + response reserve, and dynamically trims Scene Context to fit within the budget. If the Fallback API URL is blank, the main endpoint's Context Length Limit is used instead.",
            name: 'Fallback Context Length Limit',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionFrequencyPenalty2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'frequency_penalty2',
            type: 'number',
            default: null,
            description: "Penalizes token based on how frequent they already were. Unlike Repetition Penalty this does not create a hard backstop. Typical range -2.0 to 2.0. Leave empty to not send the parameter at all.\n\nCaution: Not usable with LM Studio and old endpoints, check your model documentation.",
            name: 'Fallback Frequency Penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionPresencePenalty2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'presence_penalty2',
            type: 'number',
            default: null,
            description: "Penalizes token for simply having been present already. Typical range -2.0 to 2.0. Leave empty to not send the parameter at all.\n\nCaution: Not usable with LM Studio and old endpoints, check your model documentation.",
            name: 'Fallback Presence Penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionDisableStream2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'disableStream2',
            default: false,
            description: "Stream is not supported, but usually disabled by default. Enable this if you actually need to send the 'stream = false' parameter to disable it.",
            name: 'Fallback Disable Stream',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionChatTemplateKwargs2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'chat_template_kwargs2',
            default: '',
            description: "This can be necessary on some models to turn off reasoning among other things.",
            name: 'Fallback Chat Template Kwargs',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionEnableReasoning2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableReasoning2',
            default: false,
            description: "Legacy: enable usage of old reasoning models as the fallback model that cannot restrict reasoning and just dump their reasoning block into the response. This removes maxToken scaling (always allows the max amount to give it room to think) and tries to strip reasoning blocks from the response.\n\nFor modern reasoning models prefer 'Fallback Reasoning Format' below.",
            name: 'Enable Fallback Reasoning (legacy)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionReasoningFormat2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'reasoningFormat2',
            default: 'none',
            description: "How to trigger reasoning/thinking for the FALLBACK model. Pre-made formats so you don't have to hand-craft custom parameters:\n- None (disabled, recommended): turns thinking off using whatever disable parameter the endpoint understands - DeepSeek, /v4 or /responses URLs, the bundled local runtime, and Qwen-named models are handled automatically. Nothing is sent where no mechanism is known, so a provider can never be surprised by a field it does not accept.\n- Not enabled: never asks for thinking and never sends a disable parameter either. Choose this when a provider rejects fields it does not recognise and you want the request left completely alone.\n- OpenAI reasoning_effort: sends 'reasoning_effort' (o-series / GPT-5 / OpenRouter / Ollama; Ollama's OpenAI-compatible endpoint only honors this and the reasoning.effort object).\n- OpenAI-compatible thinking object: sends 'thinking: { type: \"enabled\", budget_tokens }' (LM Studio / vLLM / many gateways).\n- Gemini thinkingConfig: sends 'generationConfig.thinkingConfig.thinkingBudget' (native Google Gemini API).\n- Qwen3 enable_thinking: sets 'chat_template_kwargs.enable_thinking = true'.\n\nWhen a reasoning format (anything other than None or Not enabled) is selected, max_tokens is left uncapped (room to think), inline think blocks are stripped from the response if present, and structured 'reasoning_content' (or Ollama's 'reasoning') is shown in the stream preview but ignored automatically.\n\nCaution: Reasoning makes a full game translation drastically slower and more expensive. Leave on None unless you know what you are doing.",
            name: 'Fallback Reasoning Format',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: {
                enum: ['none', 'not_enabled', 'openai_effort', 'thinking_object', 'gemini', 'qwen']
            },
            formOptions: {
                titleMap: {
                    'none': 'None (disabled - turns thinking off where the endpoint allows)',
                    'not_enabled': 'Not enabled (sends no disable parameter)',
                    'openai_effort': "OpenAI reasoning_effort (o-series / GPT-5 / OpenRouter / Ollama)",
                    'thinking_object': "OpenAI-compatible thinking object (LM Studio / vLLM)",
                    'gemini': "Gemini thinkingConfig (native Google API)",
                    'qwen': "Qwen3 enable_thinking"
                }
            }
        });

        this.optionReasoningEffort2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'reasoningEffort2',
            default: 'low',
            description: "Reasoning effort/intensity for the fallback model. Mapped to the effort string for OpenAI reasoning_effort, and to a default thinking-token budget tier for the thinking-object and Gemini formats (minimal=256, low=1024, medium=4096, high=16384, max=65536). 'max' matches the top tier of the OpenAI/DeepSeek/Ollama effort ladders. Ignored for Qwen3 (on/off only).",
            name: 'Fallback Reasoning Effort',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: {
                enum: ['minimal', 'low', 'medium', 'high', 'max']
            },
            formOptions: {
                titleMap: {
                    'minimal': 'Minimal',
                    'low': 'Low',
                    'medium': 'Medium',
                    'high': 'High',
                    'max': 'Max'
                }
            }
        });

        this.optionReasoningBudget2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'reasoningBudget2',
            type: 'number',
            default: null,
            description: "Optional explicit reasoning token budget for the fallback model, overriding the effort-based tier. Only used by the thinking-object and Gemini formats. Leave empty to use the effort tier.\n\nCaution: For the thinking-object format, budget_tokens must be smaller than max_tokens. If your budget is at least as large as the current max_tokens, the engine automatically raises max_tokens to budget + 1024 to satisfy the endpoint.",
            name: 'Fallback Reasoning Budget (tokens)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionSystemPromptaddition = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'systemPromptaddition',
            default: "",
            description: "This will be added in a new line to the System Prompt. You can use this to add additional context for a specific project not covered by the glossary (or if you do not use one). Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: I recommend enabling the context messages when using this, or the results can be pretty bad.\n\nCaution2: This will disable writing to Clean Cache files, or reading from Clean Cache files. So you can safely add stuff here without potentially screwing up the Clean Cache.",
            name: 'Context Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionSystemPromptAdditionTrim = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'systemPromptadditionTrim',
            default: false,
            description: "This is somewhat obsolete because of the glossary system, but might be useful for someone who cannot use it for whatever reason. NOTE: This option was made by RTS23 on F95 and I neither modified it, nor did I check its functionality.\n\nReduce Context Prompt to only term entries found in the batch to be translated, and previous translations if Enable Context Messages is on.\nEnabling this option reduces input tokens, which may slightly reduce translation costs, time and might improve accuracy.\n\nCaution: Context Prompt must follow a specific format:\n- Give each term it's own line.\n- First quoted 'term' must be untranslated and at the start of the line.\n- Second quoted 'term' must be translated.\n- Details of a term must be on the same line that the term.\n- Special terms such as '\\N[1]' must be the only quoted 'term' on it's own line.\n- Double and single quotation marks work the same, but be consistent on each line.\n- Starting the line with '\/\/' makes it a comment and will never be parsed.\n- Lines that do not start with quotes and are not comments will always be parsed.",
            name: 'Trim Context Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRetry = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRetry',
            default: true,
            description: "Enable automatic retry when the LLM fails to provide an acceptable response.\nIt will try 12 more times with an additional assistant prompt including all context of the previous responses and tries, and an additional user retry prompt.\nIf the Full Batch step is activated and fails it will retry it two times with escalating prompts. If it then still fails and a fallback model is enabled, the fallback model is tried on the SAME batch before it is split, so no context is lost; only if the fallback also fails is the batch split (down to half its size, as long as that does not go below half the minimum batch lines) and handed back to the primary model, repeating until it runs out of batches and defaults to line by line translation.\nThis also enables automatic retry during server errors. It will try 4 more times while encountering an unknown error. 35 more times while encountering rate limiting. If a fallback model is enabled, the primary model only retries server errors about twice before the fallback model takes over, so a crashed or unavailable provider does not waste time.\n\nCaution: If you disable this entire batches will fail because of a single faulty translation.",
            name: 'Enable Retry',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionRetryPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'retryPrompt',
            default: `Your previous translation attempt failed because it didn't follow the rules. Please:\n\n` +
                `1. Carefully review the error details in the assistant message\n` +
                `2. Compare your response to the original Japanese text\n` +
                `3. Fix ALL identified issues in your new translation\n` +
                `4. Provide ONLY the corrected English translation`,
            description: `The additional user prompt sent during retries. Placeholders in this prompt will automatically be adjusted according to the set settings.\nIt will be combined with specific error details from the failed attempt.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.`,
            name: 'Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionContextPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'contextPrompt',
            default: `Use the previous translations from the file as context for your current translation:\n`,
            description: `The text prefix used when providing context of previous translations.\nThis will be added to the system prompt before the last successful translations when context is enabled.`,
            name: 'Context Prompt Prefix',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionEnableContext = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableContext',
            default: true,
            description: "Enable including previous translations as context.\n\nCaution: This wont do much without a project specific context prompt.\n\nCaution2:This can increase input token useage quite a bit.",
            name: 'Enable Context Messages',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableSceneContext = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableSceneContext',
            default: true,
            description: "When enabled, scene context from the Scene Graph (dialogue flow, speaker names, cross-file Common Event links) is appended to the system prompt for RPG Maker games. This gives the LLM awareness of the conversation scene each line belongs to.\n\nDisable this if your model struggles with the extra context or produces poor results.",
            name: 'Scene Context',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionCharacterGenders = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'characterGenders',
            default: '{}',
            description: "Map character IDs (\\n[1], \\n[2], etc.) to their genders for pronoun validation. Format: JSON object like {\"1\": \"female\", \"2\": \"male\"}. Used to validate that appropriate pronouns (she/her/herself) or (he/him/himself) are used when replacing \\N[] commands with pronouns. It will not accept pronouns as name placeholder substitute if left empty.\nCaution: Remember to actually tell the LLM about their gender in the Context Prompt or Glossary.",
            name: 'Name Placeholder Genders',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionContextHistoryLength = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'contextHistoryLength',
            default: 8,
            description: "Number of previous translations to keep as context. Higher values provide more context, but use a lot more input tokens.\n\nCaution: More does not equal better. Putting this higher can confuse the llm and make the translation worse.",
            name: 'Context History Length',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionEnableReject = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableReject',
            default: true,
            description: "Enable automatic rejection of bad responses.\nThis will also automatically include new prompts detailing the problem to the LLM when the additional context phase is reached during retry.\nOnly turn this off if you actually have a serious reason for it, because translation quality will be dreadful.\nTranslation will obviously still fail if there was no response from the LLM, that is actually possible to insert in a cell.",
            name: 'Enable Automatic Reject',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRemoveRepetition = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRemoveRepetition',
            default: true,
            description: "Enable automatic removal of Japanese characters that have already repeated 5 times in a row. This could make the translation less accurate, but excessive repetition can cause lot of LLMs to go into a failure loop of spamming the same character until they run out of tokens.",
            name: 'Enable Removal of Repeating Japanese',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRemoveInnerIDSP = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRemoveInnerIDSP',
            default: true,
            description: "Enable automatic removal of inner IDSP characters. This will not remove them at the start of a line to keep formatting.",
            name: 'Enable Removal Inner IDSP Characters',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRejectJapanese = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRejectJapanese',
            default: true,
            description: "Enable automatic rejection of responses with Japanese characters.",
            name: 'Enable Automatic Reject of Japanese',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionMaxLength = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxTranslationLength',
            default: 1600,
            description: "Maximum amount of characters that will be sent per request to the API, unless it would result in less than Min Sent Lines or more than Max Sent Lines for a Full Batch.\nWithout Full Batch it will never send more than 1 cell at a time, but cells can be very large.\n\nCaution: Only set this to a lower value than Maximum Batch Size if you have a good reason for it.",
            name: 'Request Character Limit',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMinLines = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'minLines',
            default: 0,
            description: "Minimum amount of translation requests sent to the LLM at the same time during Full Batch regardless of other values. Set to 0 to disable.\n\nCaution: A cell can contain multiple translation requests.\n\nCaution2: To ensure it never allows a batch below this value it might combine the last 2 batches, creating a potentially very large one.",
            name: 'Minimum Sent Translation Requests',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxLines = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxLines',
            default: 0,
            description: "In Full Batch, maximum amount of translation requests sent to the LLM at the same time regardless of other values. Set to 0 to disable.\n\nCaution: A cell can contain multiple translation requests.",
            name: 'Maximum Sent Translation Requests',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxPlaceholderCount = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxPlaceholderCount',
            default: 60,
            description: "Maximum number of placeholders (escaped control codes such as \\C[], \\N[], @n) allowed in a single request. This is independent of the character size: some models handle very large amounts of plain text just fine but fail to preserve many placeholders correctly and need excessive retries. Keep it lower for such models; raise it (or set 0 to disable) for models that preserve placeholders reliably and you want bigger requests. Only affects Full Batch.",
            name: 'Maximum Sent Placeholders',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxLength2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxTranslationLength2',
            default: 1600,
            description: "Maximum amount of characters that will be sent per request to the API, unless it would result in less than Min Sent Lines or more than Max Sent Lines for a Full Batch.\nWithout Full Batch it will never send more than 1 cell at a time, but cells can be very large.\n\nCaution: Only set this to a lower value than Maximum Batch Size if you have a good reason for it.",
            name: 'Fallback Request Character Limit',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMinLines2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'minLines2',
            default: 0,
            description: "Minimum amount of translation requests sent to the LLM at the same time during Full Batch regardless of other values. Set to 0 to disable.\n\nCaution: A cell can contain multiple translation requests.\n\nCaution2: To ensure it never allows a batch below this value it might combine the last 2 batches, creating a potentially very large one.",
            name: 'Fallback Minimum Sent Translation Requests',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxLines2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxLines2',
            default: 0,
            description: "In Full Batch, maximum amount of translation requests sent to the LLM at the same time regardless of other values. Set to 0 to disable.\n\nCaution: A cell can contain multiple translation requests.",
            name: 'Fallback Maximum Sent Translation Requests',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionMaxPlaceholderCount2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxPlaceholderCount2',
            default: 60,
            description: "Maximum amount of Placeholders and Commands allowed in each Full Batch. This will not overwrite the Minimum Sent Translation Requests. Set to 0 to disable.",
            name: 'Fallback Maximum Sent Placeholders',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionEnableFullBatch = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableFullBatch',
            default: true,
            description: "Send translations in batches before checking individual translations. This drastically increases speed and reduces token usage, but only works for LLM that understand the section marker logic or can provide structured JSON output. If it constantly fails batches it will actually be slower and use more tokens.\n\n Caution: Locally hosted LLMs need more context length than the standard LM Studio setting to handle batches.",
            name: 'Enable Full Batch Translation',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableJsonFullBatch = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableJsonFullBatch',
            default: true,
            description: "Send the batch as JSON and demand a specific JSON Schema for the response.\nCaution: The model and the endpoint need to actually support structured output for this to work. For example the official DeepSeek api does not support it.",
            name: 'Enable JSON Full Batch Translation',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableJsonObjectFullBatch = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableJsonObjectFullBatch',
            default: false,
            description: "Instead of a full JSON Schema, just send a json_object request. Some providers like the official DeepSeek api only support this.\nCaution: This option only does anything is JSON Full batch is enabled.",
            name: 'Limit JSON Full Batch to json_object Response Format',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionSystemPromptaddition2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'systemPromptaddition2',
            default: "",
            description: "This will be added in a new line to the System Prompt. You can use this to add additional context for a specific project not covered by the glossary (or if you do not use one). Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: I recommend enabling the context messages when using this, or the results can be pretty bad.\n\nCaution2: This will disable writing to Clean Cache files, or reading from Clean Cache files. So you can safely add stuff here without potentially screwing up the Clean Cache.",
            name: 'Fallback Context Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionSystemPromptAdditionTrim2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'systemPromptadditionTrim2',
            default: false,
            description: "This is somewhat obsolete because of the glossary system, but might be useful for someone who cannot use it for whatever reason. NOTE: This option was made by RTS23 on F95 and I neither modified it, nor did I check its functionality.\n\nReduce Context Prompt to only term entries found in the batch to be translated, and previous translations if Enable Context Messages is on.\nEnabling this option reduces input tokens, which may slightly reduce translation costs, time and might improve accuracy.\n\nCaution: Context Prompt must follow a specific format:\n- Give each term it's own line.\n- First quoted 'term' must be untranslated and at the start of the line.\n- Second quoted 'term' must be translated.\n- Details of a term must be on the same line that the term.\n- Special terms such as '\\N[1]' must be the only quoted 'term' on it's own line.\n- Double and single quotation marks work the same, but be consistent on each line.\n- Starting the line with '\/\/' makes it a comment and will never be parsed.\n- Lines that do not start with quotes and are not comments will always be parsed.",
            name: 'Fallback Trim Context Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRetry2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRetry2',
            default: true,
            description: "Enable automatic retry when the LLM fails to provide an acceptable response.\nIt will try 12 more times with an additional assistant prompt including all context of the previous responses and tries, and an additional user retry prompt.\nIf the Full Batch step is activated and fails it will retry it 2 times with escalating prompts. If it then still fails and a fallback model is enabled, the fallback model is tried on the SAME batch before it is split, so no context is lost; only if the fallback also fails is the batch split (down to half its size, as long as that does not go below half the minimum batch lines) and handed back to the primary model, repeating until it runs out of batches and defaults to line by line translation.\nThis also enables automatic retry during server errors. It will try 4 more times while encountering an unknown error. 35 more times while encountering rate limiting. If a fallback model is enabled, the primary model only retries server errors about twice before the fallback model takes over, so a crashed or unavailable provider does not waste time.\n\nCaution: If you disable this entire batches will fail because of a single faulty translation.",
            name: 'Fallback Enable Retry',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionRetryPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'retryPrompt2',
            default: `Your previous translation attempt failed because it didn't follow the rules. Please:\n\n` +
                `1. Carefully review the error details in the assistant message\n` +
                `2. Compare your response to the original Japanese text\n` +
                `3. Fix ALL identified issues in your new translation\n` +
                `4. Provide ONLY the corrected English translation`,
            description: `The additional user prompt sent during retries. Placeholders in this prompt will automatically be adjusted according to the set settings.\nIt will be combined with specific error details from the failed attempt.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.`,
            name: 'Fallback Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionContextPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'contextPrompt2',
            default: `Use the previous translations from the file as context for your current translation:\n`,
            description: `The text prefix used when providing context of previous translations.\nThis will be added to the system prompt before the last successful translations when context is enabled.`,
            name: 'Fallback Context Prompt Prefix',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionEnableContext2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableContext2',
            default: true,
            description: "Enable including previous translations as context.\n\nCaution: This wont do much without a project specific context prompt.\n\nCaution2:This can increase input token useage quite a bit.",
            name: 'Fallback Enable Context Messages',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionContextHistoryLength2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'contextHistoryLength2',
            default: 8,
            description: "Number of previous translations to keep as context. Higher values provide more context, but use a lot more input tokens.\n\nCaution: More does not equal better. Putting this higher can confuse the llm and make the translation worse.",
            name: 'Fallback Context History Length',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionEnableReject2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableReject2',
            default: true,
            description: "Enable automatic rejection of bad responses.\nThis will also automatically include new prompts detailing the problem to the LLM when the additional context phase is reached during retry.\nOnly turn this off if you actually have a serious reason for it, because translation quality will be dreadful.\nTranslation will obviously still fail if there was no response from the LLM, that is actually possible to insert in a cell.",
            name: 'Fallback Enable Automatic Reject',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRejectJapanese2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRejectJapanese2',
            default: true,
            description: "Enable automatic rejection of responses with Japanese characters.",
            name: 'Fallback Enable Automatic Reject of Japanese',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRejectGlossary = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRejectGlossary',
            default: true,
            description: "Enable automatic rejection of translations that drop a glossary term.\nWhen the source line contains a glossary term that has a defined translation, the translation must use it (or a matching pronoun/gender word for character and name entries), otherwise the line is rejected and retried with the missing terms listed.\nThis is a presence check, not a correctness check: it catches renamed or dropped terms (e.g. 'Aida' translated as 'Ada') without any model call, so it works even with Review (QC/judge) off.\nIf a different rendering is genuinely correct, the retry prompt lets the model authorize it by appending \"GLOSSARYDIFF\" at the end of its response (stripped before saving). Entries of type 'unknown' and entries without a translation are never enforced.\nTurn this off if the glossary contains terms that are commonly rendered with valid synonyms.",
            name: 'Reject Missing Glossary Terms',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRejectGlossary2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRejectGlossary2',
            default: true,
            description: "Fallback model: enable automatic rejection of translations that drop a glossary term.\nWhen the source line contains a glossary term that has a defined translation, the translation must use it (or a matching pronoun/gender word for character and name entries), otherwise the line is rejected and retried with the missing terms listed.\nThis is a presence check, not a correctness check: it catches renamed or dropped terms (e.g. 'Aida' translated as 'Ada') without any model call, so it works even with Review (QC/judge) off.\nIf a different rendering is genuinely correct, the retry prompt lets the model authorize it by appending \"GLOSSARYDIFF\" at the end of its response (stripped before saving). Entries of type 'unknown' and entries without a translation are never enforced.\nTurn this off if the glossary contains terms that are commonly rendered with valid synonyms.",
            name: 'Fallback Reject Missing Glossary Terms',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRemoveRepetition2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRemoveRepetition2',
            default: true,
            description: "Fallback model: enable automatic removal of Japanese characters that have already repeated 5 times in a row. This could make the translation less accurate, but excessive repetition can cause lot of LLMs to go into a failure loop of spamming the same character until they run out of tokens.",
            name: 'Fallback Enable Removal of Repeating Japanese',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableRemoveInnerIDSP2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableRemoveInnerIDSP2',
            default: true,
            description: "Fallback model: enable automatic removal of inner IDSP characters. This will not remove them at the start of a line to keep formatting.",
            name: 'Fallback Enable Removal Inner IDSP Characters',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableFullBatch2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableFullBatch2',
            default: true,
            description: "Send translations in batches before checking individual translations. This drastically increases speed and reduces token usage, but only works for LLM that understand the section marker logic or can provide structured JSON output. If it constantly fails batches it will actually be slower and use more tokens.\n\n Caution: Locally hosted LLMs need more context length than the standard LM Studio setting, or they could sometimes get a channel error (6144 should be enough).",
            name: 'Fallback Enable Full Batch Translation',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableJsonFullBatch2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableJsonFullBatch2',
            default: true,
            description: "Send the batch as JSON and demand a specific JSON Schema for the response.\nCaution: The model and the endpoint need to actually support structured output for this to work. For example the official DeepSeek api does not support it.",
            name: 'Fallback Enable JSON Full Batch Translation',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionEnableJsonObjectFullBatch2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'enableJsonObjectFullBatch2',
            default: false,
            description: "Instead of a full JSON Schema, just send a json_object request. Some providers like the official DeepSeek api only support this.\nCaution: This option only does anything is JSON Full batch is enabled.",
            name: 'Fallback Limit JSON Full Batch to json_object Response Format',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionJsonBatchSystemPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'jsonBatchSystemPrompt',
            default: `You are a professional Japanese-to-English translator for video game text. Follow these rules absolutely:

1. TRANSLATION STYLE:
- Translate literally but naturally
- Use casual English when appropriate
- Preserve all original tone, vulgarity and intensity
- Never add/remove content or soften meaning
- If the original has character repetition for emphasis, use normal English emphasis instead

2. JSON STRUCTURED OUTPUT:
- You will receive a JSON array with objects containing 'id' (index) and 'original' (original text)
- You must respond with ONLY a JSON array of translations
- Each object in your response must have the same index as the corresponding object in the request
- Do not add, remove, or reorder any entries
- The 'translated' field should contain only the English translation
- You must output a valid JSON matching this schema:
  {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            translated: { type: "string" }
          },
          required: ["id", "translated"]
        }
      }
    },
    required: ["translations"]
  }

3. FORMAT PRESERVATION:
- Keep all original formatting including:
  * Line breaks (exactly match input line count)
  * Special placholders (@1, @2, \\C[1], \\C[2], \\V[1], \\V[2], \\N[1], \\N[2], \\nw[1], \\nw[2], \\i[1], \\i[2] etc.)
  * Punctuation and symbols
  - \\N[1], \\N[2], etc. are placeholders for character names. When they are written like @1\\n[1]@2, @4\\N[2] @3, @2\\n[3] @3, @4\\N[4]@3, \\N[5]@1 etc. they are likely nameplates displayed above the text and you need to preserve them as such.
  - Japanese text inside nameplates needs to be translated. They can also look like this '\nw<Name>' or this '\n<Name>'.
  - \\i[1], \\i[2], etc are placeholders for small image inserts like emoji.
  - \\C[1], \\C[2], etc. are not part of the text, they change the color of the following text for emphasis. \\C[0] resets the color to default again, but never add \\C[0] unless it is present in the original text.
  - @1, @2, etc are placeholders for escaped parts of the text.
  - Examples: 
    Input: "\\C[8]\\N[12]\\C[0]には効かなかった！"
    Output: "It did not work on \\C[8]\\N[12]\\C[0]!"
    Input: "@1\\C[18]労働させられた・・・"
    Output: "@1\\C[18]I was forced to work・・・"

4. CONTENT RULES:
- Never add translator notes or alternatives
- Never repeat the Japanese text
- Preserve all placeholders and codes exactly
- Never remove or replace quotes. Example: Input: 'スピリット"複数"' Wrong Output: 'Multiple Spirits' Correct Output: 'Spirit "Multiple"'
- Never use backslash to escape characters unless it is present in the original text
- Never replace double quotes (") with something else like single quotes (')
- Never add response prefixes like "Suppression Complete:" or similar
- Respond ONLY with the translation
- Do not respond with rōmaji or romanization of Japanese
- Match line count exactly (1 line in = 1 line out)
- Never add extra formatting or lines
- If an object or animal is isolated capitalize its first letter and do not add punctuation
- Example:
  Input: "普段着"
  Correct: "Casual Clothes"
  Wrong: "Translation: casual clothes"  

Translate the Japanese text while strictly following all rules.`,
            description: `The system prompt that defines the full batch translation behavior. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt needs to preserve the section marker in its original positions, so the response can be converted back to the correct array later.`,
            name: 'JSON Batch System Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '300px'
            }
        });

        this.optionJsonBatchSystemPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'jsonBatchSystemPrompt2',
            default: `You are a professional Japanese-to-English translator for video game text. Follow these rules absolutely:

1. TRANSLATION STYLE:
- Translate literally but naturally
- Use casual English when appropriate
- Preserve all original tone, vulgarity and intensity
- Never add/remove content or soften meaning
- If the original has character repetition for emphasis, use normal English emphasis instead

2. JSON STRUCTURED OUTPUT:
- You will receive a JSON array with objects containing 'id' (index) and 'original' (original text)
- You must respond with ONLY a JSON array of translations
- Each object in your response must have the same index as the corresponding object in the request
- Do not add, remove, or reorder any entries
- The 'translated' field should contain only the English translation
- You must output a valid JSON matching this schema:
  {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            translated: { type: "string" }
          },
          required: ["id", "translated"]
        }
      }
    },
    required: ["translations"]
  }

3. FORMAT PRESERVATION:
- Keep all original formatting including:
  * Line breaks (exactly match input line count)
  * Special placholders (@1, @2, \\C[1], \\C[2], \\V[1], \\V[2], \\N[1], \\N[2], \\nw[1], \\nw[2], \\i[1], \\i[2] etc.)
  * Punctuation and symbols
  - \\N[1], \\N[2], etc. are placeholders for character names. When they are written like @1\\n[1]@2, @4\\N[2] @3, @2\\n[3] @3, @4\\N[4]@3, \\N[5]@1 etc. they are likely nameplates displayed above the text and you need to preserve them as such.
  - Japanese text inside nameplates needs to be translated. They can also look like this '\nw<Name>' or this '\n<Name>'.
  - \\i[1], \\i[2], etc are placeholders for small image inserts like emoji.
  - \\C[1], \\C[2], etc. are not part of the text, they change the color of the following text for emphasis. \\C[0] resets the color to default again, but never add \\C[0] unless it is present in the original text.
  - @1, @2, etc are placeholders for escaped parts of the text.
  - Examples: 
    Input: "\\C[8]\\N[12]\\C[0]には効かなかった！"
    Output: "It did not work on \\C[8]\\N[12]\\C[0]!"
    Input: "@1\\C[18]労働させられた・・・"
    Output: "@1\\C[18]I was forced to work・・・"

4. CONTENT RULES:
- Never add translator notes or alternatives
- Never repeat the Japanese text
- Preserve all placeholders and codes exactly
- Never remove or replace quotes. Example: Input: 'スピリット"複数"' Wrong Output: 'Multiple Spirits' Correct Output: 'Spirit "Multiple"'
- Never use backslash to escape characters unless it is present in the original text
- Never replace double quotes (") with something else like single quotes (')
- Never add response prefixes like "Suppression Complete:" or similar
- Respond ONLY with the translation
- Do not respond with rōmaji or romanization of Japanese
- Match line count exactly (1 line in = 1 line out)
- Never add extra formatting or lines
- If an object or animal is isolated capitalize its first letter and do not add punctuation
- Example:
  Input: "普段着"
  Correct: "Casual Clothes"
  Wrong: "Translation: casual clothes"  

Translate the Japanese text while strictly following all rules.`,
            description: `The system prompt that defines the full batch translation behavior. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt needs to preserve the section marker in its original positions, so the response can be converted back to the correct array later.`,
            name: 'Fallback JSON Batch System Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '300px'
            }
        });

        this.optionBatchSystemPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'batchSystemPrompt',
            default: `You are a professional Japanese-to-English translator for video game text. Follow these absolute rules:

1. TRANSLATE LITERALLY BUT NATURALLY:
- Preserve original tone, intensity and vulgarity
- Use casual English when appropriate
- Never add/remove content or soften meaning

2. BATCH PROCESSING RULES:
- Preserve ALL '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers exactly as written
- Maintain their original positions in the text
- Never modify, move or remove any section markers
- Maintain structural integrity and preserve positional relationships.
- Never merge or split lines around section markers
- Never add any notes or extra text
- The output must contain exactly the same number of section markers as the input

  Example:
  Input: 
  "\n--- {дiv1} ---\nCasual Clothes\n--- {дiv2} ---\nInner Armor\n--- {дiv3} ---\nMicro Bikini\n--- {дiv3} ---\nCompletely Naked"
  
  Wrong: 
  "\n--- {дiv1} ---\nCasual Clothes\n--- {дiv2} ---\nInner Armor\n\nMicro Bikini\n--- {дiv4} ---\nCompletely Naked"
  
3. PRESERVE ALL FORMATTING:
  - Maintain exact line count (1 line in = 1 line out)
  - Keep all special codes and placeholders @1, @2, \\C[1], \\C[2], \\V[1], \\V[2], \\N[1], \\N[2], \\nw[1], \\nw[2], \\i[1], \\i[2] etc. unchanged
  - Never add additional special codes or placeholders, or move them across a section marker.
  - \\N[1], \\N[2], etc. are placeholders for character names. When they are written like @1\\n[1]@2, @4\\N[2] @3, @2\\n[3] @3, @4\\N[4]@3, \\N[5]@1 etc. they are likely nameplates displayed above the text and you need to preserve them as such.
  - Japanese text inside nameplates needs to be translated. They can also look like this '\nw<Name>' or this '\n<Name>'.
  - \\i[1], \\i[2], etc are placeholders for small image inserts like emoji.
  - \\C[1], \\C[2], etc. are not part of the text, they change the color of the following text for emphasis. \\C[0] resets the color to default again, but never add \\C[0] unless it is present in the original text of that section.
  - @1, @2, etc are placeholders for escaped parts of the text.
  
4. CONTENT RULES:
- Never add translator notes or alternatives
- Never repeat the Japanese text
- Preserve all placeholders and codes exactly
- Never remove or replace quotes. Example: Input: 'スピリット"複数"' Wrong Output: 'Multiple Spirits' Correct Output: 'Spirit "Multiple"'
- Never use backslash to escape characters unless it is present in the original text
- Never replace double quotes (") with something else like single quotes (')
- Never add response prefixes like "Suppression Complete:" or similar
- Respond ONLY with the translation
- Do not respond with rōmaji or romanization of Japanese
- Match line count exactly (1 line in = 1 line out)
- Never add extra formatting or lines
- If an object or animal is isolated capitalize its first letter and do not add punctuation
- Example:
  Input: "普段着"
  Correct: "Casual Clothes"
  Wrong: "Translation: casual clothes"
  
Translate the Japanese text while strictly following all rules.`,
            description: `The system prompt that defines the full batch translation behavior. Placeholders in this prompt will automatically be adjusted according to the set settings. This needs to include instructions to preserve '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt needs to preserve the section marker in its original positions, so the response can be converted back to the correct array later.`,
            name: 'Section Marker Batch System Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '300px'
            }
        });

        this.optionBatchSystemPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'batchSystemPrompt2',
            default: `You are a professional Japanese-to-English translator for video game text. Follow these absolute rules:

1. TRANSLATE LITERALLY BUT NATURALLY:
- Preserve original tone, intensity and vulgarity
- Use casual English when appropriate
- Never add/remove content or soften meaning

2. BATCH PROCESSING RULES:
- Preserve ALL '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers exactly as written
- Maintain their original positions in the text
- Never modify, move or remove any section markers
- Maintain structural integrity and preserve positional relationships.
- Never merge or split lines around section markers
- Never add any notes or extra text
- The output must contain exactly the same number of section markers as the input

  Example:
  Input: 
  "\n--- {дiv1} ---\nCasual Clothes\n--- {дiv2} ---\nInner Armor\n--- {дiv3} ---\nMicro Bikini\n--- {дiv3} ---\nCompletely Naked"
  
  Wrong: 
  "\n--- {дiv1} ---\nCasual Clothes\n--- {дiv2} ---\nInner Armor\n\nMicro Bikini\n--- {дiv4} ---\nCompletely Naked"
  
3. PRESERVE ALL FORMATTING:
  - Maintain exact line count (1 line in = 1 line out)
  - Keep all special codes and placeholders @1, @2, \\C[1], \\C[2], \\V[1], \\V[2], \\N[1], \\N[2], \\nw[1], \\nw[2], \\i[1], \\i[2] etc. unchanged
  - Never add additional special codes or placeholders, or move them across a section marker.
  - \\N[1], \\N[2], etc. are placeholders for character names. When they are written like @1\\n[1]@2, @4\\N[2] @3, @2\\n[3] @3, @4\\N[4]@3, \\N[5]@1 etc. they are likely nameplates displayed above the text and you need to preserve them as such.
  - Japanese text inside nameplates needs to be translated. They can also look like this '\nw<Name>' or this '\n<Name>'.
  - \\i[1], \\i[2], etc are placeholders for small image inserts like emoji.
  - \\C[1], \\C[2], etc. are not part of the text, they change the color of the following text for emphasis. \\C[0] resets the color to default again, but never add \\C[0] unless it is present in the original text of that section.
  - @1, @2, etc are placeholders for escaped parts of the text.
  
4. CONTENT RULES:
- Never add translator notes or alternatives
- Never repeat the Japanese text
- Preserve all placeholders and codes exactly
- Never remove or replace quotes. Example: Input: 'スピリット"複数"' Wrong Output: 'Multiple Spirits' Correct Output: 'Spirit "Multiple"'
- Never use backslash to escape characters unless it is present in the original text
- Never replace double quotes (") with something else like single quotes (')
- Never add response prefixes like "Suppression Complete:" or similar
- Respond ONLY with the translation
- Do not respond with rōmaji or romanization of Japanese
- Match line count exactly (1 line in = 1 line out)
- Never add extra formatting or lines
- If an object or animal is isolated capitalize its first letter and do not add punctuation
- Example:
  Input: "普段着"
  Correct: "Casual Clothes"
  Wrong: "Translation: casual clothes"
  
Translate the Japanese text while strictly following all rules.`,
            description: `The system prompt that defines the full batch translation behavior. Placeholders in this prompt will automatically be adjusted according to the set settings. This needs to include instructions to preserve '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt needs to preserve the section marker in its original positions, so the response can be converted back to the correct array later.`,
            name: 'Fallback Section Marker Batch System Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '300px'
            }
        });

        this.optionSystemPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'systemPrompt',
            default: `You are a professional Japanese-to-English translator for video game text. Follow these rules absolutely:

1. TRANSLATION STYLE:
- Translate literally but naturally
- Use casual English when appropriate
- Preserve all original tone, vulgarity and intensity
- Never add/remove content or soften meaning
- If the original has character repetition for emphasis, use normal English emphasis instead

2. FORMAT PRESERVATION:
- Keep all original formatting including:
  * Line breaks (exactly match input line count)
  * Special placholders (@1, @2, \\C[1], \\C[2], \\V[1], \\V[2], \\N[1], \\N[2], \\nw[1], \\nw[2], \\i[1], \\i[2] etc.)
  * Punctuation and symbols
  - \\N[1], \\N[2], etc. are placeholders for character names. When they are written like @1\\n[1]@2, @4\\N[2] @3, @2\\n[3] @3, @4\\N[4]@3, \\N[5]@1 etc. they are likely nameplates displayed above the text and you need to preserve them as such.
  - Japanese text inside nameplates needs to be translated. They can also look like this '\nw<Name>' or this '\n<Name>'.
  - \\i[1], \\i[2], etc are placeholders for small image inserts like emoji.
  - \\C[1], \\C[2], etc. are not part of the text, they change the color of the following text for emphasis. \\C[0] resets the color to default again, but never add \\C[0] unless it is present in the original text.
  - @1, @2, etc are placeholders for escaped parts of the text.
  - Examples: 
    Input: "\\C[8]\\N[12]\\C[0]には効かなかった！"
    Output: "It did not work on \\C[8]\\N[12]\\C[0]!"
    Input: "@1\\C[18]労働させられた・・・"
    Output: "@1\\C[18]I was forced to work・・・"
  
3. CONTENT RULES:
- Never add translator notes or alternatives
- Never repeat the Japanese text
- Preserve all placeholders and codes exactly
- Never remove or replace quotes. Example: Input: 'スピリット"複数"' Wrong Output: 'Multiple Spirits' Correct Output: 'Spirit "Multiple"'
- Never use backslash to escape characters unless it is present in the original text
- Never replace double quotes (") with something else like single quotes (')
- Never add response prefixes like "Suppression Complete:" or similar
- Respond ONLY with the translation
- Do not respond with rōmaji or romanization of Japanese
- Match line count exactly (1 line in = 1 line out)
- Never add extra formatting or lines
- If an object or animal is isolated capitalize its first letter and do not add punctuation
- Example:
  Input: "普段着"
  Correct: "Casual Clothes"
  Wrong: "Translation: casual clothes"
  
Translate the Japanese text while strictly following all rules.`,
            description: `The universal system prompt that defines the translation behavior for line by line translation. Placeholder changes will automatically adjusted in the prompt. \n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nContext from previous translations will be automatically appended when enabled.\nDo not add project specific instructions here, use the 'Context Prompt' instead.`,
            name: 'System Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '300px'
            }
        });

        this.optionSystemPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'systemPrompt2',
            default: `You are a professional Japanese-to-English translator for video game text. Follow these rules absolutely:

1. TRANSLATION STYLE:
- Translate literally but naturally
- Use casual English when appropriate
- Preserve all original tone, vulgarity and intensity
- Never add/remove content or soften meaning
- If the original has character repetition for emphasis, use normal English emphasis instead

2. FORMAT PRESERVATION:
- Keep all original formatting including:
  * Line breaks (exactly match input line count)
  * Special placholders (@1, @2, \\C[1], \\C[2], \\V[1], \\V[2], \\N[1], \\N[2], \\nw[1], \\nw[2], \\i[1], \\i[2] etc.)
  * Punctuation and symbols
  - \\N[1], \\N[2], etc. are placeholders for character names. When they are written like @1\\n[1]@2, @4\\N[2] @3, @2\\n[3] @3, @4\\N[4]@3, \\N[5]@1 etc. they are likely nameplates displayed above the text and you need to preserve them as such.
  - Japanese text inside nameplates needs to be translated. They can also look like this '\nw<Name>' or this '\n<Name>'.
  - \\i[1], \\i[2], etc are placeholders for small image inserts like emoji.
  - \\C[1], \\C[2], etc. are not part of the text, they change the color of the following text for emphasis. \\C[0] resets the color to default again, but never add \\C[0] unless it is present in the original text.
  - @1, @2, etc are placeholders for escaped parts of the text.
  - Examples: 
    Input: "\\C[8]\\N[12]\\C[0]には効かなかった！"
    Output: "It did not work on \\C[8]\\N[12]\\C[0]!"
    Input: "@1\\C[18]労働させられた・・・"
    Output: "@1\\C[18]I was forced to work・・・"
  
3. CONTENT RULES:
- Never add translator notes or alternatives
- Never repeat the Japanese text
- Preserve all placeholders and codes exactly
- Never remove or replace quotes. Example: Input: 'スピリット"複数"' Wrong Output: 'Multiple Spirits' Correct Output: 'Spirit "Multiple"'
- Never use backslash to escape characters unless it is present in the original text
- Never replace double quotes (") with something else like single quotes (')
- Never add response prefixes like "Suppression Complete:" or similar
- Respond ONLY with the translation
- Do not respond with rōmaji or romanization of Japanese
- Match line count exactly (1 line in = 1 line out)
- Never add extra formatting or lines
- If an object or animal is isolated capitalize its first letter and do not add punctuation
- Example:
  Input: "普段着"
  Correct: "Casual Clothes"
  Wrong: "Translation: casual clothes"
  
Translate the Japanese text while strictly following all rules.`,
            description: `The universal system prompt that defines the translation behavior for line by line translation. Placeholder changes will automatically adjusted in the prompt.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nContext from previous translations will be automatically appended when enabled.\nDo not add project specific instructions here, use the 'Context Prompt' instead.`,
            name: 'Fallback System Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '300px'
            }
        });

        this.optionJsonBatchRetryPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'jsonBatchRetryPrompt',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. Make sure you respond with a valid JSON format.
2. Never add any notes, explanations or extra text
3. Never include the original text
4. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.
5. You must output a valid JSON matching this schema:
  {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            translated: { type: "string" }
          },
          required: ["id", "translated"]
        }
      }
    },
    required: ["translations"]
  }

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying if it cannot generate a detailed correction prompt for some reason. This will almost never be used.  Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nThese need to be different in order to avoid cache hits on certain providers.\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'JSON Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionJsonBatchRetryPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'jsonBatchRetryPrompt2',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. Make sure you respond with a valid JSON format.
2. Never add any notes, explanations or extra text
3. Never include the original text
4. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.
5. You must output a valid JSON matching this schema:
  {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            translated: { type: "string" }
          },
          required: ["id", "translated"]
        }
      }
    },
    required: ["translations"]
  }

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying if it cannot generate a detailed correction prompt for some reason. This will almost never be used. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nThese need to be different in order to avoid cache hits on certain providers.\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'Fallback JSON Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionAggressiveJsonBatchRetryPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'aggressiveJsonBatchRetryPrompt',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. Make sure you respond with a valid JSON format.
2. Never add any notes, explanations or extra text
3. Never include the original text
4. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.
7. Translate everything, never skip an entry

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying for the last time if it cannot generate a detailed correction prompt for some reason. This will almost never be used.  Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'Aggressive JSON Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionAggressiveJsonBatchRetryPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'aggressiveJsonBatchRetryPrompt2',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. Make sure you respond with a valid JSON format.
2. Never add any notes, explanations or extra text
3. Never include the original text
4. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.
7. Translate everything, never skip an entry

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying for the last time if it cannot generate a detailed correction prompt for some reason. This will almost never be used. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'Fallback Aggressive JSON Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionBatchRetryPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'batchRetryPrompt',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. If the count of '--- {дiv} ---' markers in your response differs from the request, or they are missing the text below them your response will be rejected
2. Preserve ALL '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers exactly as they appear in the original text, including the translation of their section
3. Never modify, move or remove any section markers
4. Never add any notes, explanations or extra text
5. Never include the original text
6. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying if it cannot generate a detailed correction prompt for some reason. This will almost never be used. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nThese need to be different in order to avoid cache hits on certain providers.\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'Section Marker Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionBatchRetryPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'batchRetryPrompt2',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. If the count of '--- {дiv} ---' markers in your response differs from the request, or they are missing the text below them your response will be rejected
2. Preserve ALL '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers exactly as they appear in the original text, including the translation of their section
3. Never modify, move or remove any section markers
4. Never add any notes, explanations or extra text
5. Never include the original text
6. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying if it cannot generate a detailed correction prompt for some reason. This will almost never be used. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nThese need to be different in order to avoid cache hits on certain providers.\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'Fallback Section Marker Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionAggressiveBatchRetryPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'aggressiveBatchRetryPrompt',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. If the count of '--- {дiv} ---' markers in your response differs from the request, or they are missing the text below them your response will be rejected
2. Preserve ALL '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers exactly as they appear in the original text, including the translation of their section
3. Never modify, move or remove any section markers
4. Never add any notes, explanations or extra text
5. Never include the original text
6. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.
7. Translate everything, never skip a section

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying for the last time if it cannot generate a detailed correction prompt for some reason. This will almost never be used. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'Aggressive Section Marker Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionAggressiveBatchRetryPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'aggressiveBatchRetryPrompt2',
            default: `Your response did not correctly follow the instructions.
CRITICAL INSTRUCTIONS:
1. If the count of '--- {дiv} ---' markers in your response differs from the request, or they are missing the text below them your response will be rejected
2. Preserve ALL '--- {дiv1} ---, --- {дiv2} ---, --- {дiv3} ---, etc.' section markers exactly as they appear in the original text, including the translation of their section
3. Never modify, move or remove any section markers
4. Never add any notes, explanations or extra text
5. Never include the original text
6. Preserve text codes and placeholders exactly as they were in the original. @1 as @1, \\N[1] as \\N[1], \\C[0] as \\C[0], etc.
7. Translate everything, never skip a section

Please provide a corrected translation while strictly following these rules.`,
            description: `The additional user prompt sent while retrying for the last time if it cannot generate a detailed correction prompt for some reason. This will almost never be used. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\n'MARKERSINRESPONSE' will automatically be replaced with the number of section markers in the last response of the LLM.\n'MARKERSINREQUEST' will automatically be replaced with the number of section markers in the original batch.`,
            name: 'Fallback Aggressive Section Marker Batch Retry Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '150px'
            }
        });

        this.optionJsonBatchUserPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'jsonBatchUserPrompt',
            default: "Please translate the following JSON array. Each object contains an 'id' and 'original' field. \nReturn a JSON array with the same structure, replacing the 'original' text with your translation.\nMaintain the exact same order and IDs - do not add, remove, or reorder any entries.\n\nTRANSLATIONREQUESTJSON\n\nRespond with ONLY the JSON array, no additional text.",
            description: "The full batch user prompt. You need to include TRANSLATIONREQUESTJSON to actually send the translation requests. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt will put the text to be translated directly afterwards.",
            name: 'JSON Batch User Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionJsonBatchUserPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'jsonBatchUserPrompt2',
            default: "Please translate the following JSON array. Each object contains an 'id' and 'original' field. \nReturn a JSON array with the same structure, replacing the 'original' text with your translation.\nMaintain the exact same order and IDs - do not add, remove, or reorder any entries.\n\nTRANSLATIONREQUESTJSON\n\nRespond with ONLY the JSON array, no additional text.",
            description: "The full batch user prompt. You need to include TRANSLATIONREQUESTJSON to actually send the translation requests. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt will put the text to be translated directly afterwards.",
            name: 'Fallback JSON Batch User Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionBatchUserPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'batchUserPrompt',
            default: "Translate these Japanese phrases to English:\n",
            description: "The full batch user prompt. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt will put the text to be translated directly afterwards.",
            name: 'Section Marker Batch User Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionBatchUserPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'batchUserPrompt2',
            default: "Translate these Japanese phrases to English:\n",
            description: "The full batch user prompt. Placeholders in this prompt will automatically be adjusted according to the set settings.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.\n\nIt will put the text to be translated directly afterwards.",
            name: 'Fallback Section Marker Batch User Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionUserPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'userPrompt',
            default: "Translate these Japanese phrases to English:\n",
            description: "The user prompt for line by line translation. Placeholders in this prompt will automatically be adjusted according to the set settings.\nIt will put the text to be translated directly afterwards.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.",
            name: 'User Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionUserPrompt2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'userPrompt2',
            default: "Translate these Japanese phrases to English:\n",
            description: "The user prompt for line by line translation. Placeholders in this prompt will automatically be adjusted according to the set settings.\nIt will put the text to be translated directly afterwards.\n\nCaution: If you change this the Clean Persistent Cache will no longer be clean. In that case you might want to delete/reset it, or turn it off.",
            name: 'Fallback User Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionNameCommandReplacer = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'nameCommandReplacer',
            default: "{PERSON$1}",
            description: "What gets send to the LLM instead of \\n[1], \\n[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: '\\n[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionImageCommandReplacer = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'imageCommandReplacer',
            default: "{I$1}",
            description: "What gets send to the LLM instead of \\i[1], \\i[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: '\\i[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionVariableCommandReplacer = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'variableCommandReplacer',
            default: "{V$1}",
            description: "What gets send to the LLM instead of \\v[1], \\v[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: '\\v[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionCharacterCommandReplacer = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'characterCommandReplacer',
            default: "{NAME$1}",
            description: "What gets send to the LLM instead of \\nw[1], \\nw[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: '\\nw[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionColorCommandReplacer = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'colorCommandReplacer',
            default: "{C$1}",
            description: "What gets send to the LLM instead of \\C[1], \\C[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: '\\C[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionPlaceholderReplacer = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'placeholderReplacer',
            default: "{%$1}",
            description: "What gets send to the LLM instead of @1, @2, etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: '@ Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionNameCommandReplacer2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'nameCommandReplacer2',
            default: "{PERSON$1}",
            description: "What gets send to the LLM instead of \\n[1], \\n[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: 'Fallback \\n[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });
        
        this.optionImageCommandReplacer2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'imageCommandReplacer2',
            default: "{I$1}",
            description: "What gets send to the LLM instead of \\i[1], \i\[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: 'Fallback \\i[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionVariableCommandReplacer2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'variableCommandReplacer2',
            default: "{V$1}",
            description: "What gets send to the LLM instead of \\v[1], \\v[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: 'Fallback \\v[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionCharacterCommandReplacer2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'characterCommandReplacer2',
            default: "{NAME$1}",
            description: "What gets send to the LLM instead of \\nw[1], \\nw[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: 'Fallback \\nw[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionColorCommandReplacer2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'colorCommandReplacer2',
            default: "{C$1}",
            description: "What gets send to the LLM instead of \\C[1], \\C[2], etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: 'Fallback \\C[] Command Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionPlaceholderReplacer2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'placeholderReplacer2',
            default: "{%$1}",
            description: "What gets send to the LLM instead of @1, @2, etc. '\\', '(', ')', '[', ']', and '/' will automatically be escaped. Must include at least one non-whitespace character, and a single occurance of '$1'. This will automatically adjsut the main prompts.\nCaution: You cannot use two '{' for some weird reason, and the new placeholder can not include the original.\nCaution2: If you change this old cache will no longer be used.",
            name: 'Fallback @ Placeholder',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '20px'
            }
        });

        this.optionReplaceLinebreaks = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'replaceLinebreaks',
            default: false,
            description: "Replaces \\n (linebreaks) with &lt;br&gt; before sending them to the LLM. You'll know if you need that.",
            name: 'Replace \\n with &lt;br&gt;',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PLACEHOLDERS,
            formType: 'checkbox'
        });

        this.optionCustomHeaders = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'customHeaders',
            default: '{}',
            description: "Custom headers to send with API requests in JSON format.\nExample: {\"X-Provider\": \"provider-id\", \"X-Billing-Mode\": \"paygo\"}\nThese headers will be added to all LLM API requests.",
            name: 'Custom Headers',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionCustomParameters = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'customParameters',
            default: '{}',
            description: "Custom parameters to send with API requests in JSON format.\nExample: {\"seed\": 42, \"logprobs\": false}\nThese parameters will be merged into the request body.",
            name: 'Custom Parameters',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionCustomHeaders2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'customHeaders2',
            default: '{}',
            description: "Custom headers to send with fallback API requests in JSON format.\nExample: {\"X-Provider\": \"provider-id\", \"X-Billing-Mode\": \"paygo\"}\nThese headers will be added to all LLM API requests.",
            name: 'Fallback Custom Headers',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionCustomParameters2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'customParameters2',
            default: '{}',
            description: "Custom parameters to send with fallback API requests in JSON format.\nExample: {\"seed\": 42, \"logprobs\": false}\nThese parameters will be merged into the request body.",
            name: 'Fallback Custom Parameters',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionGlossaryApiUrl = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryApiUrl',
            default: '',
            description: "API endpoint URL for glossary extraction.\n It will automatically add 'v1/chat/completions' to the end if nothing similar is there (unless turned off).\nIf left empty, the main translation endpoint (Endpoint 1) is used with all of its options; if set, ONLY the glossary options below are used (a blank glossary field is sent as blank, never copied from the main endpoint).",
            name: 'Glossary API URL',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryApiKey = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryApiKey',
            default: '',
            description: "API key for glossary extraction. Ignored while the Glossary API URL is blank (the main endpoint key is used); used only when a Glossary URL is set.",
            name: 'Glossary API Key',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'password'
        });

        this.optionGlossaryModel = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryModel',
            default: '',
            description: "Model to use for glossary extraction. Glossary creation can require a high context length, so set this model's context length accordingly.\nIgnored while the Glossary API URL is blank (the main endpoint model is used); used only when a Glossary URL is set.",
            name: 'Glossary Model',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryTemperature = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryTemperature',
            default: 0.1,
            description: "Temperature for glossary extraction. Lower values produce more consistent extractions. Leave empty to not send the parameter at all.",
            name: 'Glossary temperature',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
        });

        this.optionGlossaryMaxTokens = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryMaxTokens',
            default: 12000,
            description: "Maximum tokens for glossary extraction responses. This will automatically be increased with existing glossary size.",
            name: 'Glossary max_tokens Parameter',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryTokenCap = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryTokenCap',
            default: 24000,
            description: "Regardless of glossery size it will never send a max_token parameter higher than this value.",
            name: 'Glossary Absolute Token Cap',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryMaxContextLength = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryMaxContextLength',
            default: 0,
            description: "The glossary model's total context window in tokens (e.g., 8192, 32768, 128000). Set to 0 to disable.\n\nWhen set, the accumulated-glossary context sent with each extraction request is trimmed to fit within the budget (response reserve + prompts + the text chunk are never trimmed). If the Glossary API URL is blank, the main endpoint's Context Length Limit is used instead.",
            name: 'Glossary Context Length Limit',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryFilterAccumulatedByChunk = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryFilterAccumulatedByChunk',
            default: true,
            description: "Only send accumulated glossary terms that actually appear in the current chunk during Phase 2 LLM extraction.\n\nReduces input token cost significantly for large glossaries, especially with small context models.\n\nDisable only if you need the LLM to see the full glossary context on every chunk (may lose context for rare terms that don't appear in every chunk).",
            name: 'Glossary Filter Accumulated by Chunk',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryIncludeDialogue = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryIncludeDialogue',
            default: true,
            description: "Include rows tagged as dialogue (untagged, gray, purple, mediumpurple, indigo) in glossary extraction.\n\nThis should normally be enabled since dialogue is the primary source of proper nouns.",
            name: 'Glossary Include Dialogue Tags',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryIncludeScripts = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryIncludeScripts',
            default: true,
            description: "Also include rows tagged as translatable scripts (green, white, yellow, gold) in glossary extraction.\n\nRows tagged with excluded colors (red, blue, black, silver, pink, aqua, tan, darkred) are always skipped.",
            name: 'Glossary Include Script Tags',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryDisableJapaneseExtraction = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryDisableJapaneseExtraction',
            default: false,
            description: "Disable Japanese-specific local extraction patterns (katakana words, quoted kanji/kana names, RPG Maker placeholder IDs like \\N[1]).\n\nEnable this if you are translating a non-Japanese game where these patterns would produce false positives.",
            name: 'Disable Japanese Extraction',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryCustomTypes = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryCustomTypes',
            default: "",
            description: "Custom glossary term types (comma-separated).\n\nIf empty, uses the default types: female character, male character, monster, location, organization, skill, item, unknown.\n\nExample: person, place, weapon, spell, faction",
            name: 'Glossary Custom Types',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryTopP = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryTopP',
            type: 'number',
            default: null,
            description: "Top-P sampling for glossary extraction. Leave empty to not send the parameter at all.",
            name: 'Glossary top_p',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryDoNotFixURL = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryDoNotFixURL',
            default: false,
            description: "Skip URL checks for glossary extraction and just send the request to whatever you put in.",
            name: 'Glossary Do not attempt to fix URL',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryEnableJsonSchema = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryEnableJsonSchema',
            default: true,
            description: "Demand a specific JSON Schema response_format for glossary extraction, matching the {\"terms\": [...]} structure the prompt already asks for.\nCaution: The model and the endpoint need to actually support structured output for this to work. For example the official DeepSeek api does not support it.",
            name: 'Glossary Enable JSON Schema Response Format',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryEnableJsonObject = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryEnableJsonObject',
            default: false,
            description: "Instead of a full JSON Schema, just send a json_object response_format for glossary extraction. Some providers like the official DeepSeek api only support this.\nCaution: This option only does anything if JSON Schema Response Format is enabled.",
            name: 'Glossary Limit Response Format to json_object',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryReasoningFormat = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryReasoningFormat',
            default: 'none',
            description: "How to trigger reasoning/thinking for glossary extraction. Pre-made formats so you don't have to hand-craft custom parameters:\n- None (disabled, recommended): turns thinking off using whatever disable parameter the endpoint understands - DeepSeek, /v4 or /responses URLs, the bundled local runtime, and Qwen-named models are handled automatically. Nothing is sent where no mechanism is known, so a provider can never be surprised by a field it does not accept.\n- Not enabled: never asks for thinking and never sends a disable parameter either. Choose this when a provider rejects fields it does not recognise and you want the request left completely alone.\n- OpenAI reasoning_effort: sends 'reasoning_effort'.\n- OpenAI-compatible thinking object: sends 'thinking: { type: \"enabled\", budget_tokens }' (LM Studio / vLLM).\n- Gemini thinkingConfig: sends 'generationConfig.thinkingConfig.thinkingBudget'.\n- Qwen3 enable_thinking: sets 'chat_template_kwargs.enable_thinking = true'.\n\nCaution: Reasoning makes glossary extraction drastically slower and more expensive. Leave on None unless you know what you are doing.",
            name: 'Glossary Reasoning Format',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: {
                enum: ['none', 'not_enabled', 'openai_effort', 'thinking_object', 'gemini', 'qwen']
            },
            formOptions: {
                titleMap: {
                    'none': 'None (disabled - turns thinking off where the endpoint allows)',
                    'not_enabled': 'Not enabled (sends no disable parameter)',
                    'openai_effort': "OpenAI reasoning_effort (o-series / GPT-5 / OpenRouter / Ollama)",
                    'thinking_object': "OpenAI-compatible thinking object (LM Studio / vLLM)",
                    'gemini': "Gemini thinkingConfig (native Google API)",
                    'qwen': "Qwen3 enable_thinking"
                }
            }
        });

        this.optionGlossaryReasoningEffort = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryReasoningEffort',
            default: 'low',
            description: "Reasoning effort/intensity for glossary extraction. Mapped to the effort string for OpenAI reasoning_effort, and to a default thinking-token budget tier for the thinking-object and Gemini formats (minimal=256, low=1024, medium=4096, high=16384, max=65536). 'max' matches the top tier of the OpenAI/DeepSeek/Ollama effort ladders. Ignored for Qwen3 (on/off only).",
            name: 'Glossary Reasoning Effort',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'select',
            schemaOptions: {
                enum: ['minimal', 'low', 'medium', 'high', 'max']
            },
            formOptions: {
                titleMap: {
                    'minimal': 'Minimal',
                    'low': 'Low',
                    'medium': 'Medium',
                    'high': 'High',
                    'max': 'Max'
                }
            }
        });

        this.optionGlossaryReasoningBudget = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryReasoningBudget',
            type: 'number',
            default: null,
            description: "Optional explicit reasoning token budget for glossary extraction, overriding the effort-based tier. Only used by the thinking-object and Gemini formats. Leave empty to use the effort tier.\n\nCaution: For the thinking-object format, budget_tokens must be smaller than max_tokens. If your budget is at least as large as the current max_tokens, the engine automatically raises max_tokens to budget + 1024.",
            name: 'Glossary Reasoning Budget (tokens)',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryTopK = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryTopK',
            type: 'number',
            default: null,
            description: "Top-K sampling for glossary extraction. Leave empty to not send the parameter at all.",
            name: 'Glossary top_k',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryMinP = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryMinP',
            type: 'number',
            default: null,
            description: "Min-P sampling for glossary extraction. Leave empty to not send the parameter at all.",
            name: 'Glossary min_p',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryRepeatPenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryRepeatPenalty',
            type: 'number',
            default: 1.05,
            description: "ONLY FOR LM STUDIO, or very specific apis. Penalty for repeated tokens during glossary extraction. Values >1 discourage repetition. Leave empty to not send the parameter at all.",
            name: 'Glossary repeat_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryRepetitionPenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryRepetitionPenalty',
            type: 'number',
            default: null,
            description: "Repetition penalty for glossary extraction (different endpoint). Leave empty to not send the parameter at all.",
            name: 'Glossary repetition_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryFrequencyPenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryFrequencyPenalty',
            type: 'number',
            default: null,
            description: "Frequency penalty for glossary extraction. Leave empty to not send the parameter at all.",
            name: 'Glossary frequency_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryPresencePenalty = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryPresencePenalty',
            type: 'number',
            default: null,
            description: "Presence penalty for glossary extraction. Leave empty to not send the parameter at all.",
            name: 'Glossary presence_penalty',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryDisableStream = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryDisableStream',
            default: false,
            description: "Send 'stream = false' parameter with glossary extraction requests.",
            name: 'Glossary Disable Stream',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryEnableTokenProgress = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryEnableTokenProgress',
            default: true,
            description: "Shows a live 'Generating glossary response: N tokens' counter that updates while the LLM is producing each chunk's response during glossary extraction, so you can tell the tool is still working and has not crashed.\n\nInternally this enables response streaming to count tokens (and to feed the live preview when 'Glossary Enable Stream Preview Display' is on).\n\nCaution: This sends 'stream: true' and 'stream_options: { include_usage: true }' to the glossary endpoint. Most endpoints (e.g. LM Studio) support this, but if your provider rejects streaming requests you should disable it.\n\nCaution2: This has no effect while 'Glossary Disable Stream' is enabled, since that explicitly forces stream off.",
            name: 'Glossary Enable Token Progress Display',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryEnableStreamPreview = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryEnableStreamPreview',
            default: true,
            description: "While the LLM is producing each glossary chunk's response, the streamed text is shown as a live preview above the glossary token counter (the counter stays below the growing preview so it remains in view), then the preview is removed from view once the response completes so the log does not grow. Disable this if you only want the token counter.\n\nThe full request/response logging always stays in the F12 console.\n\nThis has no effect while 'Glossary Enable Token Progress Display' is disabled (that option drives the streaming both features run on), and no effect while 'Glossary Disable Stream' is enabled.",
            name: 'Glossary Enable Stream Preview Display',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryChatTemplateKwargs = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryChatTemplateKwargs',
            default: '',
            description: "chat_template_kwargs for glossary extraction. Can be necessary on some models to turn off reasoning.",
            name: 'Glossary chat_template_kwargs',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryRequestDelay = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryRequestDelay',
            default: 50,
            description: "Delay in milliseconds between glossary extraction API requests to prevent rate limiting.",
            name: 'Glossary Request Delay',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryCustomHeaders = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryCustomHeaders',
            default: '{}',
            description: "Custom HTTP headers for glossary extraction requests in JSON format.\nExample: {\"X-Custom-Header\": \"value\"}",
            name: 'Glossary Custom Headers',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionGlossaryCustomParameters = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryCustomParameters',
            default: '{}',
            description: "Custom parameters to send with glossary extraction API requests in JSON format.\nExample: {\"seed\": 42}\nThese parameters will be merged into the request body.",
            name: 'Glossary Custom Parameters',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '100px'
            }
        });

        this.optionGlossaryExtractionUserPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryExtractionUserPrompt',
            default: `You are analyzing Japanese video game text to build a translation glossary.
From the following text, extract ONLY proper nouns and recurring named entities, that are not obvious, and are not already in the known terms unless they need correction:
- Character names (people, creatures with names, titles, jobs)
- Place names (cities, regions, buildings, dungeons)
- Organization or faction names that are not used as name for an individual character
- Unique skill names, item names, or terminology that are proper nouns

Return a JSON object with this exact format:
{"terms": [{"japanese": "NAME", "english": "English translation if obvious, otherwise empty string", "type": "female character|male character|monster|location|organization|skill|item", "context": "brief note about usage"}]}


Text:
---`,
            description: "The user prompt sent to the LLM for glossary extraction. The text chunk is appended after this prompt followed by a JSON instruction.",
            name: 'Glossary Extraction User Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '200px'
            }
        });

        this.optionGlossaryExtractionJSONinstruction = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryExtractionJSONinstruction',
            default: `
---
Respond with ONLY the JSON object.`,
            description: "The end of the user prompt inserted after the text chunk.",
            name: 'Glossary Extraction JSON Instruction Ending',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '200px'
            }
        });

        this.optionGlossaryExtractionSystemPrompt = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryExtractionSystemPrompt',
            default: `You are a Japanese-to-English glossary extraction tool. Always respond with valid JSON only.
Return a JSON object with this exact format:
{"terms": [{"japanese": "NAME", "english": "English translation if obvious, otherwise empty string", "type": "female character|male character|monster|location|organization|skill|item", "context": "brief note about usage if not obvious, otherwise empty string"}]}

Rules:
- Only include terms that appear to be proper nouns or named entities
- Only include terms that are not in the already known terms unless they need correction derived from new information of the current text
- Do NOT include generic nouns, common words, or terms that appear only once without context
- Do NOT include template/format strings containing placeholders like %1, %2, \\x[n]
- Do NOT include full sentences, dialogue lines, or long phrases — only extract individual names/terms
- Do NOT include generic RPG Maker command codes like \\C[n] (color), \\G (gold), \\$ (money window)
- DO extract character name placeholders like \\N[n], \\V[n], \\I[n] when you can determine who they represent
- For \\N[n], \\V[n], \\I[n] placeholders or names: determine the character's gender from speech patterns, context, and surrounding text. Use "female character" or "male character" as type, and note speech patterns in context (e.g. "uses feminine speech: 〜わ, 〜ね, 〜の")
- Hermaphrodite or Futanari characters need to be classed as female character
- Only use "monster" if a being can not be identified as male or female, otherwise use "female character" or "male character"
- Try to identify descriptions used as names of NPCs like "Shopkeeper" as female or male given the context
- If you can confidently suggest an English translation that can be universally used given the context, include it in the "english" field
- The "english" field must be ONE word or a short phrase usable in every context — never alternatives. Do not use "/", "\\", "|", " or ", commas or parentheses to offer options, and do not write a definition. If no single rendering is confidently correct, leave the field empty
- Do NOT include slang terms or manners of speech that could be translated differently based on context
- Include the reading/context if helpful for translation consistency
- If a term does not fit one of the required types (female character|male character|monster|location|organization|skill|item) discard it
- If there is no new term to extract, or existing term to correct, just repeat a single existing term`,
            description: "The system prompt sent to the LLM for glossary extraction.",
            name: 'Glossary Extraction System Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '200px'
            }
        });

        this.optionGlossaryExtractionGlossaryText = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryExtractionGlossaryText',
            default: `
GLOSSARY (auto-generated - use these translations for consistency):`,
            description: "Prompt start for the Glossary sent during translation.",
            name: 'Glossary Prompt injection',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '200px'
            }
        });

        this.optionGlossaryExtractionAccumulatedGlossary = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryExtractionAccumulatedGlossary',
            default: `
Already known terms (do NOT re-extract or repeat these unless you need to make a correction derived from the current text):`,
            description: "Prompt start for the already collected terms.",
            name: 'Glossary Extraction Accumulated Glossary Prompt',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '200px'
            }
        });

        this.optionGlossaryChunkSize = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryChunkSize',
            type: 'number',
            default: 6000,
            description: "Maximum character count per text chunk sent to the LLM for glossary extraction. Larger chunks process fewer requests but may exceed context limits for small models. Smaller chunks are safer but slower.",
            name: 'Glossary Chunk Size',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        });

        this.optionGlossaryDeduplicateLines = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryDeduplicateLines',
            default: false,
            description: "When enabled, identical lines are only sent once to the LLM instead of repeatedly.\nThis drastically reduces token usage for RPG Maker projects where UI strings repeat hundreds of times.\nDisable this if you need the LLM to see every occurrence for context-dependent name identification.",
            name: 'Glossary Deduplicate Lines',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryStripCodesForDedup = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryStripCodesForDedup',
            default: true,
            description: "When enabled (and deduplication is on), RPG Maker codes like \\N[1], \\V[2], <tags> are stripped before comparing lines for duplicates.\nThis means \"\\N[1] attacks!\" and \"\\N[2] attacks!\" are treated as the same line.\nDisable this to treat lines as different if their RPG Maker codes differ.",
            name: 'Glossary Strip Codes for Dedup',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionSmartGlossary = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'smartGlossary',
            default: true,
            description: "When enabled, only glossary terms that actually appear in the text being translated are included in the system prompt.\nThis significantly reduces token usage for small models with low context length. Without this, the entire glossary is sent with every request.",
            name: 'Smart Glossary Filter',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionAutoGlossary = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'autoGlossary',
            default: true,
            description: "When enabled, automatically appends the generated glossary to the system prompt during translation. Generate a glossary first using the 'Glossary' button in the toolbar.\nThe glossary helps keep character names, place names, and other proper nouns consistent across translations.",
            name: 'Auto-Inject Glossary',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });

        this.optionGlossaryFormat = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'glossaryFormat',
            default: `The following glossary must be used for consistent translation. Always translate these terms the same way:\nGLOSSARYTEXT`,
            description: "The format template for injecting the glossary into the system prompt. Use GLOSSARYTEXT as a placeholder where the actual glossary content will be inserted.\nThe glossary is auto-generated from the project and helps maintain consistency for character names, places, and other proper nouns.",
            name: 'Glossary Prompt Format',
            category: DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories.PROMPTS,
            formType: 'ace',
            formOptions: {
                aceTheme: 'twilight',
                height: '80px'
            }
        });

        const ReviewOptions = require("./review/options");
        // TranslationEngineOption self-registers through the wrapper (www/js/Option.js
        // calls wrapper.addOption in its constructor), so do NOT also call addOption
        // here — that would push every review option twice and render duplicate fields.
        this.reviewOptions = ReviewOptions.createReviewOptions(
            this,
            TranslationEngineOption_1.TranslationEngineOption,
            DSLRTranslationEngineWrapper_1.TranslationEngineOptionCategories
        );
        this.reviewOptions.forEach((opt) => {
            const id = opt.getId();
            this["option" + id.charAt(0).toUpperCase() + id.slice(1)] = opt;
        });
        // The object registered with trans.registerEngine() — and therefore handed to
        // the batch translator — is this.translatorEngine, not this wrapper. Expose the
        // review option objects/entry points there so the batch adapter can read them
        // with .getValue() and invoke the review call. Defined non-enumerably so the
        // inner engine's own property set is unchanged.
        const _reviewDelegates = {
            reviewCompletion: (messages, opts) => this.reviewCompletion(messages, opts)
        };
        this.reviewOptions.forEach((opt) => {
            const id = opt.getId();
            _reviewDelegates["option" + id.charAt(0).toUpperCase() + id.slice(1)] = opt;
        });
        ["optionNameCommandReplacer", "optionCharacterCommandReplacer",
            "optionImageCommandReplacer", "optionVariableCommandReplacer",
            "optionColorCommandReplacer", "optionPlaceholderReplacer"].forEach((k) => {
            if (this[k]) _reviewDelegates[k] = this[k];
        });
        if (this.translatorEngine) {
            Object.keys(_reviewDelegates).forEach((k) => {
                if (k in this.translatorEngine) return;
                Object.defineProperty(this.translatorEngine, k, {
                    value: _reviewDelegates[k], writable: true, configurable: true, enumerable: false
                });
            });
        }

    }

    // Update the Options window's local-runtime model picker in place, and persist a selection
    // made through it. The <select> is resolved FIRST: this runs from the engine's 3s background
    // ticker, and with the Options window closed there is no element to fill, so the (potentially
    // expensive) model list must not be requested at all. `helpers` supplies the window-bound
    // lookup and the cached model-id list from the constructor closure. Returns false when there
    // is nothing to sync, true after the picker has been updated.
    _syncRuntimeModelSelect(evt, helpers) {
        var spec = helpers || {};
        var el = typeof spec.findRuntimeSelect === 'function' ? spec.findRuntimeSelect(evt) : null;
        if (!el) return false;
        var ids = typeof spec.runtimeModelIds === 'function' ? spec.runtimeModelIds() : [];
        var option = this.optionRuntimeModel;
        if (option) {
            try {
                var titleMap = {};
                for (var i = 0; i < ids.length; i++) titleMap[ids[i]] = ids[i];
                option.getFormOptions().titleMap = titleMap;
                option.getSchemaOptions().enum = ids;
            } catch (e) { /* ignore */ }
        }
        var current = el.val();
        if (el.find('option').length !== ids.length) {
            el.empty();
            for (var j = 0; j < ids.length; j++) {
                el.append($('<option></option>').val(ids[j]).text(ids[j]));
            }
        }
        var keep = null;
        for (var k = 0; k < ids.length; k++) { if (ids[k] === current) { keep = current; break; } }
        if (!keep) {
            try { keep = (window.llmRuntime && window.llmRuntime.selectedModel()) || ids[0] || ''; }
            catch (e) { keep = ids[0] || ''; }
        }
        if (keep) el.val(keep);
        try {
            // Only persist on an actual change: this runs from the 3s ticker, and
            // setValue() writes the config file.
            if (option && keep) {
                var existing = '';
                try { existing = option.getValue() || ''; } catch (e) { existing = ''; }
                if (existing !== keep) option.setValue(keep);
            }
        } catch (e) { /* ignore */ }
        return true;
    }

    // Build the per-model settings panel and the Role assignment panel as jsonform nodes for the
    // Bundled Local Runtime card (Task 11). The DOM assembly is deliberately thin: every value it
    // reads or writes is produced by the pure helpers above (runtimeChoiceOptions,
    // runtimeProfilePatch, rolePickerUpdates, roleReloadNote). Returns { nodes, schema, defaults }
    // so the wrapper can merge the extra schema keys into the built form.
    // Re-read the stored profile and republish the panel's render-time values onto
    // translatorEngine (the object the Options window renders through). Must run at RENDER
    // time: the panel builds during engine initialization, before this engine's config
    // section is loaded, so the build-time emission would always show stale values.
    refreshPanelValues() {
        var modelId = "";
        try { modelId = this.optionRuntimeModel ? (this.optionRuntimeModel.getValue() || "") : ""; } catch (e) { modelId = ""; }
        if (!modelId) return null;
        var raw = "";
        try { raw = this.optionRuntimeModelProfiles ? (this.optionRuntimeModelProfiles.getValue() || "") : ""; } catch (e) { raw = ""; }
        var map = localRuntimeModelProfiles({ raw: raw, legacy: {}, drafts: {}, selectedId: modelId });
        var profile = ModelProfiles_1.resolveProfile(map, modelId);
        var target = this.translatorEngine || this;
        target.rtSpecMode = (profile.specMode === "off") ? "off" : (profile.draftId ? String(profile.draftId) : "auto");
        target.rtMmprojMode = (profile.mmprojMode === "off") ? "off" : (profile.mmprojId ? String(profile.mmprojId) : "auto");
        for (var f = 0; f < _PANEL_PROFILE_FIELDS.length; f++) {
            var fieldName = _PANEL_PROFILE_FIELDS[f];
            var value = profile[fieldName];
            target["rtProfile_" + fieldName] = (value === undefined || value === null || value === "") ? "" : String(value);
        }
        return { modelId: modelId, specValue: target.rtSpecMode, draftId: profile.draftId };
    }

    // Close-time commit of the panel's live form values (see applyPanelValuesToProfiles),
    // called by the Options window on jsonForm.root.getFormValues().
    applyPanelFlush(values) {
        return applyPanelValuesToProfiles(this, values);
    }

    buildRuntimePanelNodes() {
        var self = this;
        var nodes = [];
        var schema = {};
        var defaults = {};
        // The role pickers are appended into the Role assignment sub-group of the runtime card,
        // so they are returned separately from the per-model nodes; both groups share the same
        // schema/defaults merge at the caller.
        var roleNodes = [];

        function esc(text) {
            return String(text === undefined || text === null ? "" : text)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        }
        function readOpt(opt) {
            try { return opt && typeof opt.getValue === "function" ? opt.getValue() : undefined; }
            catch (e) { return undefined; }
        }
        function fieldValue(value) {
            return (value === undefined || value === null || value === "") ? "" : String(value);
        }
        function selectOptionsFrom(opt) {
            var out = [];
            try {
                var values = (opt && opt.getSchemaOptions().enum) || [];
                var titleMap = (opt && opt.getFormOptions().titleMap) || {};
                for (var i = 0; i < values.length; i++) {
                    out.push({
                        value: values[i],
                        title: Object.prototype.hasOwnProperty.call(titleMap, values[i]) ? titleMap[values[i]] : values[i]
                    });
                }
            } catch (e) { /* leave the list empty */ }
            return out;
        }
        function runtimeApi() {
            try {
                var rt = (typeof window !== "undefined") ? window.llmRuntime : null;
                return (!rt || rt.loadError) ? null : rt;
            } catch (e) { return null; }
        }
        function liveModelId(fallback) {
            var value = "";
            try { value = self.optionRuntimeModel.getValue() || ""; } catch (e) { value = ""; }
            return value || fallback || "";
        }
        function readProfileMap(modelId) {
            try {
                return localRuntimeModelProfiles({
                    raw: self.optionRuntimeModelProfiles ? self.optionRuntimeModelProfiles.getValue() : "",
                    legacy: {
                        runtimeContextLength: readOpt(self.optionRuntimeContextLength),
                        runtimeKvType: readOpt(self.optionRuntimeKvType),
                        runtimeGpuLayers: readOpt(self.optionRuntimeGpuLayers),
                        runtimeCpuMoe: readOpt(self.optionRuntimeCpuMoe),
                        runtimeCpuMoeLayers: readOpt(self.optionRuntimeCpuMoeLayers),
                        runtimeLoadMode: readOpt(self.optionRuntimeLoadMode),
                        runtimeSplitMode: readOpt(self.optionRuntimeSplitMode),
                        runtimeTensorSplit: readOpt(self.optionRuntimeTensorSplit),
                        runtimeMainGpu: readOpt(self.optionRuntimeMainGpu),
                        runtimeOverrideTensor: readOpt(self.optionRuntimeOverrideTensor),
                        runtimeExpertCount: readOpt(self.optionRuntimeExpertCount),
                        runtimeDraftMax: readOpt(self.optionRuntimeDraftMax),
                        runtimeDraftMin: readOpt(self.optionRuntimeDraftMin),
                        runtimeDraftGpuLayers: readOpt(self.optionRuntimeDraftGpuLayers),
                        runtimeDraftCpuMoe: readOpt(self.optionRuntimeDraftCpuMoe),
                        runtimeDraftCpuMoeLayers: readOpt(self.optionRuntimeDraftCpuMoeLayers),
                        runtimeParallelSlots: readOpt(self.optionRuntimeParallelSlots)
                    },
                    drafts: panelDrafts,
                    selectedId: modelId
                });
            } catch (e) { return {}; }
        }
        // Apply one coerced patch to the selected model's profile, persist the map, and keep
        // the render-time values (see emitPanelValues) in step with it.
        function applyProfilePatch(modelId, patch) {
            if (!modelId || !patch || Object.keys(patch).length === 0) return;
            var next = ModelProfiles_1.setProfile(readProfileMap(modelId), modelId, patch);
            try {
                if (self.optionRuntimeModelProfiles) self.optionRuntimeModelProfiles.setValue(JSON.stringify(next));
            } catch (e) { /* persistence is best effort */ }
            emitPanelValues();
        }
        // Publish the panel's current values onto translatorEngine, the object the Options
        // window renders through (options.js assignDefault copies translatorEngine[key] onto
        // the schema default, which is what jsonform renders).
        function emitPanelValues() {
            try { if (typeof self.refreshPanelValues === "function") self.refreshPanelValues(); } catch (e) {}
            var renderTarget = self.translatorEngine || self;
            for (var r = 0; r < roleDefs.length; r++) {
                renderTarget["rtRole_" + roleDefs[r].role] = currentRoleModel(roleDefs[r].role);
            }
        }
        function addTo(target, key, node, schemaEntry, defaultValue) {
            node.key = key;
            if (node.value === undefined) node.value = "";
            target.push(node);
            schema[key] = schemaEntry || { type: "string" };
            defaults[key] = defaultValue === undefined ? "" : defaultValue;
        }
        function add(key, node, schemaEntry, defaultValue) {
            addTo(nodes, key, node, schemaEntry, defaultValue);
        }
        // Help/notice nodes are display-only: jsonform rejects a "help" node that carries a key
        // linking it to a schema entry, and the init error alert hangs the Options window. They are
        // pushed bare, with no key and nothing added to schema/defaults.
        function addHelp(node) {
            nodes.push(node);
        }

        var rt = runtimeApi();
        // Read the explicit drafts.json pairing once per panel build, not on every keystroke
        // (applyProfilePatch -> readProfileMap used to call readDrafts() each time).
        var panelDrafts = {};
        try { if (rt && typeof rt.readDrafts === "function") panelDrafts = rt.readDrafts() || {}; } catch (e) { panelDrafts = {}; }
        var ids = [];
        if (rt) {
            try {
                var entries = rt.targetModels() || [];
                for (var i = 0; i < entries.length; i++) {
                    var entryId = entries[i] && entries[i].id;
                    if (entryId && ids.indexOf(entryId) === -1) ids.push(entryId);
                }
            } catch (e) { ids = []; }
        }
        var selected = "";
        try { selected = self.optionRuntimeModel.getValue() || ""; } catch (e) { selected = ""; }
        if (selected === "" && ids.length) selected = ids[0];

        var profile = ModelProfiles_1.resolveProfile(readProfileMap(selected), selected);
        var detection = { draft: null, mmproj: null };
        if (rt && selected) {
            try {
                var assoc = (typeof rt.associations === "function") ? rt.associations() : null;
                if (assoc && assoc.byTarget && assoc.byTarget[selected]) detection = assoc.byTarget[selected];
            } catch (e) { /* detection stays empty */ }
        }
        // The selected model's own facts for the field hints AND the speculation picker: an
        // mtpCapable entry is what tells the picker the model drafts for itself. modelInfos()
        // is content detection over the models folder, so the selected target's info is found
        // by file id; a null result (no model, or an unreadable file) degrades to the
        // default-only wording. The paired draft's info is looked up the same way (forced
        // draftId first, then detection), so the draft placement fields can show the draft's
        // real layer count.
        var modelInfo = null;
        var infos = null;
        if (rt && selected && typeof rt.modelInfos === "function") {
            try {
                infos = rt.modelInfos() || [];
                for (var mi = 0; mi < infos.length; mi++) {
                    if (infos[mi] && infos[mi].id === selected) { modelInfo = infos[mi]; break; }
                }
            } catch (e) { modelInfo = null; }
        }
        var draftInfo = null;
        // detection.draft is the association OBJECT ({ id, specType, ... }), not a file id - the
        // id inside it is what matches modelInfos entries. A forced draftId is already a file id.
        var draftFileId = profile.draftId || (detection && detection.draft && detection.draft.id) || null;
        if (draftFileId && infos) {
            for (var di = 0; di < infos.length; di++) {
                if (infos[di] && infos[di].id === draftFileId) { draftInfo = infos[di]; break; }
            }
        }
        var choices = runtimeChoiceOptions({
            detection: detection,
            profile: profile,
            info: modelInfo,
            draftCandidates: (rt && selected && typeof rt.candidateDraftsFor === "function") ? rt.candidateDraftsFor(selected) : [],
            mmprojCandidates: (rt && selected && typeof rt.candidateProjectorsFor === "function") ? rt.candidateProjectorsFor(selected) : []
        });

        var hints = runtimeFieldHints({
            info: modelInfo, draftInfo: draftInfo, profile: profile,
            threads: readOpt(self.optionRuntimeThreads)
        });
        var cpuNote = runtimeHardwareNote(_logicalCpuCount());

        addHelp({
            type: "help", notitle: true,
            helpvalue: "<div class='rtModelsIntro'>These settings apply only to <b>" + esc(selected || "(no model selected)") +
                "</b>; they are stored per GGUF file and applied when that model's server starts." +
                (modelInfo && modelInfo.mtpCapable === true
                    ? " This model has a built-in speculative-decoding head (MTP) and drafts for itself; no separate draft model is needed."
                    : "") +
                (cpuNote ? " " + esc(cpuNote) : "") + "</div>"
        });

        // One profile field per ModelProfiles key the brief lists. Selects mirror the legacy
        // card's enum/titleMap so the choices read the same as before they moved here. The jsonform
        // NODE type picks the widget (select/text/number/checkbox); the schema entry must carry the
        // JSON-Schema DATA type (string/number/boolean), the same thing the option builder stores
        // from option.getType().
        var profileFields = [
            { field: "contextLength", key: "rtProfile_contextLength", type: "number", title: "Context length (tokens)", desc: "Per-model context allocated when the runtime starts.", value: fieldValue(profile.contextLength) },
            { field: "parallelSlots", key: "rtProfile_parallelSlots", type: "number", title: "Parallel slots", desc: "How many requests this model handles at once (llama.cpp --parallel). Empty uses llama.cpp's default; the context is shared between the slots, so raising it divides the context among concurrent requests.", value: fieldValue(profile.parallelSlots) },
            { field: "kvTypeK", key: "rtProfile_kvTypeK", type: "select", title: "K cache type", desc: "Quantization of the attention key cache for this model. It trades a little quality for memory and speed: q8_0 is the shipped default and roughly halves the KV memory with negligible quality loss, the lower q5/q4 types save more memory at a larger quality cost, and f16/bf16 keep the best quality at full memory.", options: selectOptionsFrom(this.optionRuntimeKvType), value: fieldValue(profile.kvTypeK) },
            { field: "kvTypeV", key: "rtProfile_kvTypeV", type: "select", title: "V cache type", desc: "Quantization of the attention value cache. Quantized V needs flash attention, which the bundled runtime always enables.", options: selectOptionsFrom(this.optionRuntimeKvType), value: fieldValue(profile.kvTypeV) },
            { field: "batchSize", key: "rtProfile_batchSize", type: "number", title: "Logical batch size", desc: "Prompt tokens processed per pass (llama.cpp --batch-size). Empty uses the runtime's default of 2048.", value: fieldValue(profile.batchSize) },
            { field: "ubatchSize", key: "rtProfile_ubatchSize", type: "number", title: "Physical batch size", desc: "Tokens in one compute step (llama.cpp --ubatch-size). Empty uses the default of 512; larger values raise peak memory, so keep it at or below the logical batch size.", value: fieldValue(profile.ubatchSize) },
            { field: "gpuLayers", key: "rtProfile_gpuLayers", type: "text", title: "GPU layers", desc: "Layers to keep in VRAM, or auto.", placeholder: "auto", value: fieldValue(profile.gpuLayers) },
            { field: "cpuMoe", key: "rtProfile_cpuMoe", type: "checkbox", title: "All MoE experts on CPU", desc: "Keep every MoE expert weight in system RAM for this model.", value: profile.cpuMoe === true },
            { field: "cpuMoeLayers", key: "rtProfile_cpuMoeLayers", type: "number", title: "MoE layers on CPU", desc: "Keep the first N layers' experts in system RAM. Empty lets llama.cpp decide.", value: fieldValue(profile.cpuMoeLayers) },
            { field: "moeCacheMib", key: "rtProfile_moeCacheMib", type: "number", title: "MoE GPU cache (MiB)", desc: "A cache in VRAM for the MoE expert weights that are kept in system RAM (llama.cpp --moe-cache-mib). Experts that fire often are mirrored onto the GPU instead of being re-read from RAM for every token, which can win back much of the speed the CPU placement costs. It only does anything while experts are on the CPU (MoE layers on CPU, or all MoE experts on CPU) and is ignored otherwise. Empty or 0 keeps the cache off. With several GPUs the cache is split between them like the layers (Tensor split).", value: fieldValue(profile.moeCacheMib) },
            { field: "loadMode", key: "rtProfile_loadMode", type: "select", title: "Load mode", desc: "How this model file is read from disk. auto switches to none whenever part of the model's weights is read from system RAM - experts kept on the CPU, or any partially offloaded load, dense or MoE.", options: selectOptionsFrom(this.optionRuntimeLoadMode), value: fieldValue(profile.loadMode) },
            { field: "splitMode", key: "rtProfile_splitMode", type: "select", title: "Split mode", desc: "How this model is split across several GPUs.", options: selectOptionsFrom(this.optionRuntimeSplitMode), value: fieldValue(profile.splitMode) },
            { field: "tensorSplit", key: "rtProfile_tensorSplit", type: "text", title: "Tensor split", desc: "Comma-separated proportions between GPUs, e.g. 0.7,0.3.", value: fieldValue(profile.tensorSplit) },
            { field: "mainGpu", key: "rtProfile_mainGpu", type: "number", title: "Main GPU index", desc: "Index of the main device. Empty uses the first GPU.", value: fieldValue(profile.mainGpu) },
            { field: "overrideTensor", key: "rtProfile_overrideTensor", type: "text", title: "Tensor overrides", desc: "Advanced llama.cpp --override-tensor patterns, e.g. exps=CPU.", value: fieldValue(profile.overrideTensor) },
            { field: "expertCount", key: "rtProfile_expertCount", type: "number", title: "Experts used per token", desc: "MoE experts activated per token; lower is faster for large MoE models.", value: fieldValue(profile.expertCount) },
            { field: "draftMax", key: "rtProfile_draftMax", type: "number", title: "Max draft tokens", desc: "Tokens the draft model proposes per speculative step.", value: fieldValue(profile.draftMax) },
            { field: "draftMin", key: "rtProfile_draftMin", type: "number", title: "Min draft tokens", desc: "Minimum draft tokens proposed per step.", value: fieldValue(profile.draftMin) },
            // The paired draft's own placement, per model like the draft itself. These were
            // server-wide card fields until the draft placement moved into profiles: a layer
            // count only means something relative to the model whose draft it is.
            { field: "draftGpuLayers", key: "rtProfile_draftGpuLayers", type: "text", title: "Draft GPU layers", desc: "Layers of the paired draft model to keep in VRAM (llama.cpp --spec-draft-ngl), or auto. Only used when this model has a draft paired. Raise or lower it only when the draft competes with the main model for a card that is already full.", placeholder: "auto", value: fieldValue(profile.draftGpuLayers) },
            { field: "draftCpuMoe", key: "rtProfile_draftCpuMoe", type: "checkbox", title: "Draft: all MoE experts on CPU", desc: "Keep every MoE expert weight of the paired draft model in system RAM (llama.cpp --spec-draft-cpu-moe). Only affects drafts that have expert weights.", value: profile.draftCpuMoe === true },
            { field: "draftCpuMoeLayers", key: "rtProfile_draftCpuMoeLayers", type: "number", title: "Draft MoE layers on CPU", desc: "Keep the first N layers' expert weights of the paired draft in system RAM (llama.cpp --spec-draft-n-cpu-moe). Empty lets llama.cpp decide.", value: fieldValue(profile.draftCpuMoeLayers) },
            { field: "draftUbatchSize", key: "rtProfile_draftUbatchSize", type: "number", title: "Draft physical batch size", desc: "Tokens the paired draft model processes in one compute step (llama.cpp --spec-draft-n-ubatch). Empty uses the same value as the model's own physical batch size. A smaller value trims the draft's VRAM use when it competes with the main model for a card that is already full. Only used when this model has a draft paired; it is ignored otherwise.", value: fieldValue(profile.draftUbatchSize) },
            // Advanced speculation knobs, kept at the end of the list next to the draft token
            // counts they belong with.
            { field: "specDraftPMin", key: "rtProfile_specDraftPMin", type: "number", title: "Draft probability threshold", desc: "Advanced. Drafts below this probability are dropped (llama.cpp --spec-draft-p-min). 0 disables the check and is the usual setting.", value: fieldValue(profile.specDraftPMin) },
            { field: "draftKvType", key: "rtProfile_draftKvType", type: "select", title: "Draft KV cache type", desc: "Advanced. KV cache type for the draft model, applied to both K and V. Empty uses the runtime's default.", options: [{ value: "", title: "Default" }].concat(selectOptionsFrom(this.optionRuntimeKvType)), value: fieldValue(profile.draftKvType) }
        ];
            // Read a panel control's committed value. jsonform passes the field's own node as
            // the second onChange argument; node.getValue() cannot be read off a detached or
            // wrong element when a re-render races the change event, unlike evt.target.
            function panelControlValue(evt, node, fallback) {
                try {
                    if (node && typeof node.getValue === "function") {
                        var v = node.getValue();
                        if (v !== undefined && v !== null) return v;
                    }
                } catch (e) { /* fall through to the DOM read */ }
                try { return $(evt.target).val(); } catch (e) { return fallback; }
            }
            for (var f = 0; f < profileFields.length; f++) {
                var def = profileFields[f];
                // The field's own explanation first, then the model-specific hint (its own limits and
                // the effective value when left empty). jsonform renders it under the input.
                var description = hints[def.field] ? (def.desc + " " + hints[def.field]) : def.desc;
                var fieldNode = { type: def.type, title: def.title, description: description, value: def.value };
                if (def.options) fieldNode.options = def.options;
                if (def.placeholder) fieldNode.placeholder = def.placeholder;
                fieldNode.onChange = (function (field) {
                    return function (evt, node) {
                        var raw;
                        try {
                            raw = (field === "cpuMoe")
                                ? (function () {
                                    try { return $(evt.target).prop("checked"); }
                                    catch (e) { return false; }
                                })()
                                : panelControlValue(evt, node, "");
                        } catch (e) { raw = ""; }
                        applyProfilePatch(liveModelId(selected), runtimeProfilePatch(field, raw));
                    };
                })(def.field);
            var dataType = (def.type === "number") ? "number" : (def.type === "checkbox") ? "boolean" : "string";
            add(def.key, fieldNode, { type: dataType, title: def.title, description: description, default: "" }, def.value);
        }

        // Speculative decoding: Auto / Off / an explicit detected candidate. The ambiguity note
        // is data from the detector, so it is shown verbatim above the two controls.
        var specNode = {
            type: "select", title: "Speculative decoding",
            description: "Auto pairs the draft model detected for this model; Off disables speculation; a file forces that draft.",
            value: choices.spec.value, options: choices.spec.options,
            onChange: function (evt, node) {
                var raw = panelControlValue(evt, node, "auto");
                if (raw === undefined || raw === null || raw === "") raw = "auto";
                applyProfilePatch(liveModelId(selected),
                    Object.assign(runtimeProfilePatch("specMode", raw), runtimeProfilePatch("draftId", raw)));
            }
        };
        add("rtSpecMode", specNode, { type: "string", title: "Speculative decoding", description: specNode.description, default: "auto" }, "auto");
        addHelp({
            type: "help", notitle: true,
            helpvalue: "<div class='rtSpecNote'>" + esc(choices.spec.note) + "</div>"
        });

        var mmprojNode = {
            type: "select", title: "Vision projector",
            description: "Auto uses the projector detected for this model; Off disables it; a file forces that projector.",
            value: choices.mmproj.value, options: choices.mmproj.options,
            onChange: function (evt, node) {
                var raw = panelControlValue(evt, node, "auto");
                if (raw === undefined || raw === null || raw === "") raw = "auto";
                applyProfilePatch(liveModelId(selected),
                    Object.assign(runtimeProfilePatch("mmprojMode", raw), runtimeProfilePatch("mmprojId", raw)));
            }
        };
        add("rtMmprojMode", mmprojNode, { type: "string", title: "Vision projector", description: mmprojNode.description, default: "auto" }, "auto");
        addHelp({
            type: "help", notitle: true,
            helpvalue: "<div class='rtMmprojNote'>" + esc(choices.mmproj.note) + "</div>"
        });

        // Role assignment: four pickers over the local target models (plus "not bundled"), each
        // applying RoleBinding's model+URL pair through the inner engine's update().
        var roleDefs = [
            { role: "main", label: "Main" }, { role: "fallback", label: "Fallback" },
            { role: "glossary", label: "Glossary" }, { role: "review", label: "Review" }
        ];
        function currentRoleModel(role) {
            try {
                var optId = RoleBinding_1.roleModelOption(role);
                var opt = self["option" + optId.charAt(0).toUpperCase() + optId.slice(1)];
                var value = opt ? opt.getValue() : "";
                return (value === undefined || value === null) ? "" : String(value);
            } catch (e) { return ""; }
        }
        var roleModelIds = [];
        var baseRoleOptions = [{ value: "", title: "(not bundled)" }];
        for (var r = 0; r < ids.length; r++) baseRoleOptions.push({ value: ids[r], title: ids[r] });
        // A fresh copy per picker: a "(not detected)" entry for one role's stale model must not
        // leak into the other three.
        function roleOptionsForRole(modelId) {
            var options = baseRoleOptions.slice();
            if (modelId && ids.indexOf(modelId) === -1 &&
                !options.some(function (option) { return option.value === modelId; })) {
                options.push({ value: modelId, title: modelId + " (not detected)" });
            }
            return options;
        }
        for (var k = 0; k < roleDefs.length; k++) {
            var roleDef = roleDefs[k];
            var current = currentRoleModel(roleDef.role);
            roleModelIds.push(current);
            addTo(roleNodes, "rtRole_" + roleDef.role, {
                type: "select", title: roleDef.label + " model",
                description: "Point the " + roleDef.label + " role at one of the bundled local models, or (not bundled).",
                value: current, options: roleOptionsForRole(current),
                onChange: (function (role) {
                    return function (evt) {
                        var raw; try { raw = $(evt.target).val(); } catch (e) { raw = ""; }
                        var port = 1234;
                        try {
                            var p = self.optionRuntimePort ? self.optionRuntimePort.getValue() : 1234;
                            if (p !== "" && p !== null && p !== undefined && isFinite(Number(p))) port = Number(p);
                        } catch (e) { port = 1234; }
                        var updates = rolePickerUpdates(role, raw, port);
                        for (var u = 0; u < updates.length; u++) {
                            try { self.translatorEngine.update(updates[u].id, updates[u].value); } catch (e) { /* per-setting best effort */ }
                        }
                        try { self._rebuildAndRender(evt); } catch (e) { /* ignore */ }
                    };
                })(roleDef.role)
            }, { type: "string", title: roleDef.label + " model", description: "Role model selection", default: "" }, current);
        }
        roleNodes.push({
            type: "help", notitle: true,
            helpvalue: "<div class='rtRoleNote'>" + esc(roleReloadNote(roleModelIds, readOpt(self.optionRuntimeModelsMax))) + "</div>"
        });

        // Publish the stored profile onto the engine before the form renders, so
        // assignDefault copies these into the schema defaults (see emitPanelValues).
        emitPanelValues();
        return { nodes: nodes, schema: schema, defaults: defaults, roleNodes: roleNodes };
    }

    // Whether the missing-glossary-term check runs for the active model: the
    // base option for the primary/pool path, the `2` option for the fallback.
    _rejectGlossaryOn(llmToUse) {
        var opt = (llmToUse === "model2") ? this.optionEnableRejectGlossary2 : this.optionEnableRejectGlossary;
        return !!(opt && typeof opt.getValue === "function" && opt.getValue() == true);
    }

    // Enforceable glossary entries for the missing-term check, built once and
    // reused until window.SLRGlossary is replaced or its term count changes, so
    // a large glossary is not re-scanned on every line.
    _glossaryCheckEntries() {
        try {
            var g = (typeof window !== "undefined") ? window.SLRGlossary : null;
            if (!g || typeof g !== "object") return [];
            var n = Object.keys(g).length;
            if (this._glossaryCheckCacheRef === g && this._glossaryCheckCacheN === n) {
                return this._glossaryCheckCache;
            }
            var GlossaryCheck = require("./glossaryCheck");
            this._glossaryCheckCache = GlossaryCheck.buildEntries(g);
            this._glossaryCheckCacheRef = g;
            this._glossaryCheckCacheN = n;
            return this._glossaryCheckCache;
        } catch (e) {
            return [];
        }
    }

    _buildGlossaryBlock(filterText) {
        try {
            if (this.optionAutoGlossary.getValue() !== true) return "";
            if (!window.SLRGlossaryText || !window.SLRGlossaryText.trim()) return "";
            var glossaryContent = window.SLRGlossaryText;
            if (this.optionSmartGlossary.getValue() == true && typeof GlossaryExtractor !== 'undefined') {
                var filtered = GlossaryExtractor.filterGlossaryForText(filterText || "");
                if (filtered && filtered.trim() !== "") glossaryContent = filtered;
                else glossaryContent = "";
            }
            if (!glossaryContent || !glossaryContent.trim()) return "";
            var glossaryFormat = this.optionGlossaryFormat.getValue();
            return glossaryFormat.replace("GLOSSARYTEXT", glossaryContent);
        } catch (e) {
            console.warn("[DSLR] Glossary block build failed:", e);
            return "";
        }
    }

    _buildSceneBlock(options) {
        try {
            if (this.optionEnableSceneContext.getValue() !== true) return "";
            if (!options || !options.sceneContext || !String(options.sceneContext).trim()) return "";
            return _applyDSLRReplacers(options.sceneContext, this);
        } catch (e) {
            console.warn("[DSLR] Scene block build failed:", e);
            return "";
        }
    }

    // Glossary + scene context for the review prompts, built with the same
    // blocks translation requests get so QC and the judge see the project's
    // terms and the scene's setting (e.g. which world the scene is set in).
    // Computed once per batch — smart-glossary filtered on the batch source —
    // and reused for the seed review and every re-review. Sections render via
    // the prompts' [[CONTEXT]] marker (appended when a custom template drops
    // it), so both QC and judge requests carry them.
    // fit ({ limit, reserve, systemText, userText }) trims the auxiliary
    // sections — scene first, then glossary — so sections + system + reviewed
    // rows + response reserve fit the Review Context Length Limit. The rows
    // under review are never trimmed; limit <= 0 (or no fit) keeps everything.
    _reviewSections(filterText, options, fit) {
        const out = [];
        try {
            const glossary = this._buildGlossaryBlock(filterText);
            if (glossary && String(glossary).trim()) out.push(["Glossary", glossary]);
        } catch (e) { }
        try {
            let scene = this._buildSceneBlock(options);
            if (scene && String(scene).trim()) {
                if (scene.indexOf("--- SCENE CONTEXT ---") === -1) {
                    scene = "--- SCENE CONTEXT ---\n" + scene;
                }
                out.push(["Scene context", scene]);
            }
        } catch (e) { }
        try {
            const limit = fit ? Number(fit.limit) : 0;
            if (limit > 0 && out.length > 0) {
                const reserve = fit ? (Number(fit.reserve) || 0) : 0;
                const fixed = _estimateTokens(String((fit && fit.systemText) || "")) +
                    _estimateTokens(String((fit && fit.userText) || ""));
                const budget = Math.floor(limit - reserve - fixed);
                const blocks = out.map((s, i) => ({
                    id: String(i), text: s[1], priority: s[0] === "Glossary" ? 1 : 0
                }));
                const fitted = this._fitContextBlocks(budget, blocks);
                const kept = [];
                for (let i = 0; i < out.length; i++) {
                    const t = fitted[String(i)];
                    if (t && String(t).trim() !== "") kept.push([out[i][0], t]);
                }
                return kept;
            }
        } catch (e) { /* fitting is best-effort: fall through untrimmed */ }
        return out;
    }

    // Resolved Review context-budget inputs for _reviewSections: whose Context
    // Length Limit applies (the dedicated Review value, or the translating
    // endpoint's when the Review URL is blank), the response reserve (the same
    // maxTokens resolution the review calls use) and the QC system text. The
    // caller adds the user (rows) text. Rows are never trimmed.
    _reviewSectionsFit(endpointNumber) {
        let limit = 0, reserve = 0, systemText = "";
        try {
            const url = this.optionReviewApiUrl ? this.optionReviewApiUrl.getValue() : "";
            if (ReviewModel_1.isUrlSet(url)) {
                limit = Number(this.optionReviewMaxContextLength ? this.optionReviewMaxContextLength.getValue() : 0) || 0;
                reserve = Number(this.optionReviewMaxTokens ? this.optionReviewMaxTokens.getValue() : 0) || 0;
            } else {
                limit = parseInt(this.getEndpointSetting(endpointNumber, 'maxContextLength')) || 0;
                reserve = parseInt(this.getEndpointSetting(endpointNumber, 'maxTokens')) || 0;
            }
        } catch (e) { /* resolution is best-effort */ }
        try {
            const ov = this._reviewPromptOverrides("Qc");
            systemText = (ov && ov.system) || "";
            if (!systemText) systemText = require("./review/prompts").DEFAULTS.qcSystem;
        } catch (e) { systemText = ""; }
        return { limit: limit, reserve: reserve, systemText: systemText };
    }

    // Fit context blocks into `budget` tokens. Lower priority is trimmed first.
    // blocks: [{ id, text, priority }]. Returns { id -> trimmedText }.
    _fitContextBlocks(budget, blocks) {
        var result = {};
        var order = blocks.slice().sort(function (a, b) { return a.priority - b.priority; });
        for (var i = 0; i < order.length; i++) result[order[i].id] = order[i].text;
        var total = 0;
        for (var j = 0; j < order.length; j++) total += _estimateTokens(order[j].text);
        if (total <= budget) return result;
        for (var k = 0; k < order.length; k++) {
            if (total <= budget) break;
            var b = order[k];
            if (!result[b.id]) continue;
            var overflow = total - budget;
            var curTok = _estimateTokens(result[b.id]);
            var keepTok = curTok - overflow;
            if (keepTok <= 0) {
                total -= curTok;
                result[b.id] = "";
            } else {
                var trimmed = _trimToTokenBudget(result[b.id], keepTok);
                total -= (curTok - _estimateTokens(trimmed));
                result[b.id] = trimmed;
            }
        }
        return result;
    }

    // Build the three dynamic context blocks (project summary, scene, glossary) and fit
    // them into a single budget derived from maxContextLength, accounting for the base
    // system prompt, the user message and the response reserve. Priority (trim-first):
    // summary (0) -> scene (1) -> glossary (2). Returns { summary, glossary, scene }.
    // llmToUse selects whose limit applies: the fallback model ("model2") runs on its
    // own endpoint, so Fallback Context Length Limit applies — or Main's limit when
    // the Fallback API URL is blank. Anything else uses the endpoint's own limit.
    _buildAndFitDynamicContext(baseSystemPrompt, userText, glossaryFilterText, options, endpointNumber, llmToUse) {
        var glossaryRaw = this._buildGlossaryBlock(glossaryFilterText);
        var sceneRaw = this._buildSceneBlock(options);
        if (sceneRaw) sceneRaw = "\n--- SCENE CONTEXT ---\n" + sceneRaw;
        var blocks = [
            { id: "scene", text: sceneRaw, priority: 0 },
            { id: "glossary", text: glossaryRaw, priority: 1 }
        ];
        var maxCtx = parseInt(this.getEndpointSetting(endpointNumber, 'maxContextLength')) || 0;
        if (llmToUse === "model2") {
            var fbUrl = "";
            try { fbUrl = this.optionApiUrl2 ? this.optionApiUrl2.getValue() : ""; } catch (e) { fbUrl = ""; }
            if (String(fbUrl || "").trim() !== "") {
                maxCtx = parseInt(this.optionMaxContextLength2 ? this.optionMaxContextLength2.getValue() : 0) || 0;
            } else {
                maxCtx = parseInt(this.optionMaxContextLength ? this.optionMaxContextLength.getValue() : 0) || 0;
            }
        }
        if (maxCtx <= 0) {
            return { glossary: glossaryRaw, scene: sceneRaw };
        }
        var respReserve = parseInt(this.getEndpointSetting(endpointNumber, 'maxTokens')) || 0;
        var baseTok = _estimateTokens(baseSystemPrompt);
        var userTok = _estimateTokens(userText);
        var budget = maxCtx - respReserve - baseTok - userTok;
        return this._fitContextBlocks(budget, blocks);
    }

    // True when the user enabled 'KV-Cache Friendly Prompts': the system message must
    // then stay byte-identical across requests (constant translation rules only) and
    // every per-request block (System Prompt Addition, glossary, scene context,
    // previous translations) is routed into a separate user message instead, so
    // prefix/KV-cache servers (SGLang radix cache etc.) always hit the cached prefix.
    _cacheFriendlyPromptsActive() {
        try {
            return this.optionCacheFriendlyPrompts ? this.optionCacheFriendlyPrompts.getValue() === true : false;
        } catch (e) {
            return false;
        }
    }

    // Review message layout honoring 'KV-Cache Friendly Prompts', mirroring
    // the translation requests: with it on, the system message stays the bare
    // stable prompt and the glossary/scene context travels as its own user
    // message ahead of the task. With it off, the long-standing 2-message
    // shape is kept (the context stays inside the task's user message).
    _reviewMessages(system, context, user) {
        const msgs = [{ role: "system", content: system }];
        if (this._cacheFriendlyPromptsActive() && context && String(context).trim() !== "") {
            msgs.push({ role: "user", content: context });
        }
        msgs.push({ role: "user", content: user });
        return msgs;
    }

    _reasoningFormatFor(llmToUse, endpointNumber) {
        if (llmToUse === "model2") {
            var opt2 = this.optionReasoningFormat2;
            if (!opt2) return "none";
            var v2 = opt2.getValue();
            return (v2 === undefined || v2 === null || v2 === "") ? "none" : v2;
        }
        var v = this.getEndpointSetting(endpointNumber, 'reasoningFormat');
        return (v === undefined || v === null || v === "") ? "none" : v;
    }
    _reasoningSettingsFor(llmToUse, endpointNumber) {
        if (llmToUse === "model2") {
            return {
                effort: (this.optionReasoningEffort2 && this.optionReasoningEffort2.getValue()) || "low",
                budget: this.optionReasoningBudget2 ? this.optionReasoningBudget2.getValue() : null
            };
        }
        return {
            effort: this.getEndpointSetting(endpointNumber, 'reasoningEffort') || "low",
            budget: this.getEndpointSetting(endpointNumber, 'reasoningBudget')
        };
    }
    _isReasoningActive(llmToUse, endpointNumber) {
        var format = this._reasoningFormatFor(llmToUse, endpointNumber);
        // Both "off" values leave reasoning inactive; they differ only in whether a disable
        // parameter is sent, which is not this method's business.
        if (format !== "none" && format !== "not_enabled") return true;
        if (llmToUse === "model2") return !!(this.optionEnableReasoning2 && this.optionEnableReasoning2.getValue() === true);
        return this.getEndpointSetting(endpointNumber, 'enableReasoning') === true;
    }
    _setEnableThinking(body, value) {
        if (!body || typeof body !== "object") return;
        var ctk = body.chat_template_kwargs;
        if (ctk && typeof ctk === "object" && !Array.isArray(ctk)) {
            ctk.enable_thinking = value;
            return;
        }
        if (typeof ctk === "string" && ctk.trim() !== "") {
            try {
                var parsed = JSON.parse(ctk);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    parsed.enable_thinking = value;
                    body.chat_template_kwargs = parsed;
                    return;
                }
            } catch (e) {}
        }
        body.chat_template_kwargs = { enable_thinking: value };
    }
    // chat_template_kwargs is entered as a JSON string in the options. It must be sent as an
    // OBJECT: the server ignores a string, which made the option look like it did nothing.
    // This mirrors what the Review path has always done. Malformed JSON sends nothing rather
    // than a broken value, so a typo cannot take the request down.
    _setChatTemplateKwargs(body, raw) {
        if (!body || typeof body !== "object") return;
        if (raw === undefined || raw === null || raw === "") return;
        if (typeof raw === "object") {
            if (!Array.isArray(raw)) body.chat_template_kwargs = raw;
            return;
        }
        if (typeof raw !== "string" || raw.trim() === "") return;
        try {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                body.chat_template_kwargs = parsed;
            }
        } catch (e) {
            console.error("[DSLR] Invalid chat_template_kwargs JSON, sending none: " + e.message);
        }
    }
    _modelForLlm(llmToUse, endpointNumber) {
        if (llmToUse === "model2") return (this.optionModel2 && this.optionModel2.getValue()) || "";
        return this.getEndpointSetting(endpointNumber, 'model') || "";
    }
    // Whether the request goes to a server on this machine. The bundled local runtime is
    // llama.cpp, which honors chat_template_kwargs.enable_thinking - verified against the
    // pinned build, where a Gemma 4 model that thinks by default (254 characters of
    // reasoning_content) stops entirely once the switch is sent. LM Studio and Ollama ignore
    // the field harmlessly. Cloud APIs are deliberately excluded: chat_template_kwargs is not
    // a standard field there and some reject unknown parameters outright.
    _isLocalEndpoint(apiUrl) {
        var u = String(apiUrl || "");
        return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(u);
    }
    // Whether this endpoint is the bundled runtime's front door. Decided by a sentinel this project
    // controls, never by address and never by a llama.cpp-family trait: the runtime's /v1/models list
    // stamps every entry owned_by "slrcpp" (RuntimeInfo.buildModelsList), which a stock llama.cpp,
    // LM Studio or Ollama server does not produce. Port 1234 is deliberately shared with those, so the
    // URL cannot tell them apart. The /props chat_template_caps object only says the server is
    // llama.cpp-family (a stock llama.cpp emits it too), so it must never decide ownership. Anything
    // unrecognisable, refused, unreadable or slow is NOT ours, so the engine asks for reasoning itself;
    // that direction cannot make an endpoint worse than it was before this feature, whereas a wrong
    // "ours" would silently strip the ask.
    _endpointIsOurs(apiUrl) {
        if (!this._isLocalEndpoint(apiUrl)) return Promise.resolve(false);
        var key = String(apiUrl || "");
        if (!this._oursCache) this._oursCache = {};
        if (Object.prototype.hasOwnProperty.call(this._oursCache, key)) return this._oursCache[key];
        var probe = null;
        try {
            probe = this._fetchForProbe(key);
        } catch (e) {
            probe = Promise.reject(e);
        }
        var answer = Promise.resolve(probe).then(function (res) {
            if (!res || res.ok !== true) return false;
            return Promise.resolve(res.json()).then(function (doc) {
                if (!doc || typeof doc !== "object") return false;
                var models = Array.isArray(doc.data) ? doc.data : [];
                for (var i = 0; i < models.length; i++) {
                    var model = models[i];
                    if (model && typeof model === "object" && model.owned_by === "slrcpp") return true;
                }
                return false;
            });
        }).catch(function () { return false; });
        this._oursCache[key] = answer;
        return answer;
    }
    // Drop a cached ownership answer so the next translation re-probes. The app deliberately shares
    // its loopback port with other local servers, so the same URL can be our runtime now and a
    // foreign server later; a stale "ours" would silently strip the engine's own reasoning ask. A
    // translation that failed — a transport-level failure being the clearest case — is the signal
    // that the server behind the URL may have changed, so the cache entry is dropped then and the
    // next request starts from a fresh probe. The cache is not expired on a timer: a successful run
    // never re-probes, which keeps the probe cost at one request per endpoint until something fails.
    _invalidateEndpointOwnership(apiUrl) {
        if (!this._oursCache) return;
        delete this._oursCache[String(apiUrl || "")];
    }
    // Single seam for the ownership probe so tests can substitute it. Production uses the same global
    // fetch the engine already posts its completions with; no new dependency is introduced. The probe
    // is bounded so a peer that accepts the connection and never answers cannot stall the first
    // translation: AbortController is used where the engine provides it (Chromium 89 in NW.js and
    // Node 15 both do), and only an engine without it falls back to an unbounded GET. An aborted or
    // timed-out probe rejects, which _endpointIsOurs turns into "not ours".
    _fetchForProbe(apiUrl) {
        var url = String(apiUrl || "").replace(/\/v1\/chat\/completions$/, "/v1/models");
        var timeoutMs = (typeof this._probeTimeoutMs === "number" && this._probeTimeoutMs > 0) ? this._probeTimeoutMs : 2000;
        if (typeof AbortController !== "function") return fetch(url, { method: "GET" });
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        return fetch(url, { method: "GET", signal: controller.signal }).then(function (res) {
            clearTimeout(timer);
            return res;
        }, function (err) {
            clearTimeout(timer);
            throw err;
        });
    }
    // Ownership is only consulted by the local reasoning branch, which an inactive format never
    // reaches, so a "none"/"not_enabled" request must not pay a probe whose answer it cannot use.
    _shouldProbeEndpointOwnership(apiUrl, llmToUse, endpointNumber) {
        if (!this._isLocalEndpoint(apiUrl)) return false;
        var format = this._reasoningFormatFor(llmToUse, endpointNumber);
        return format !== "none" && format !== "not_enabled";
    }
    // Whether a model name looks like a Qwen model. Qwen templates read enable_thinking, and
    // Qwen is also trained to honor the '/no_think' soft switch - which is the only thing that
    // works on a server that ignores chat_template_kwargs.
    _isQwenModel(modelName) {
        return !!(modelName && /^qwen/i.test(String(modelName)));
    }
    // Whether the Qwen '/no_think' soft switch applies to this request: a Qwen-named model with
    // reasoning not enabled. _applyQwenNoThink sends the switch; this also drives the response
    // cleanup, which strips a stray <think> block that the switch did not prevent so it cannot
    // leak into the translation. It used to be gated by the 'Qwen enable_thinking Auto-Control'
    // option, whose shipped default was exactly this, and that option no longer exists.
    _qwenNoThinkActive(llmToUse, endpointNumber) {
        if (this._isReasoningActive(llmToUse, endpointNumber)) return false;
        return this._isQwenModel(this._modelForLlm(llmToUse, endpointNumber));
    }
    // Turn thinking off using whatever mechanism the endpoint actually understands. Returns
    // true when something was sent. It deliberately sends nothing when no mechanism is known:
    // inventing a field for an unrecognised provider is how working requests start failing.
    //   - DeepSeek            -> thinking { type: "disabled" }
    //   - /v4/ or /responses  -> thinking { type: "disabled" }, plus reasoning_effort "none"
    //                            for the endpoints that ignore the thinking object
    //   - bundled local runtime / localhost -> chat_template_kwargs.enable_thinking = false,
    //                            which llama.cpp honors (verified against the pinned build)
    //   - Qwen-named model    -> the same switch; the caller additionally appends '/no_think'
    _applyThinkingDisable(body, apiUrl, modelName) {
        if (!body || typeof body !== "object") return false;
        var url = String(apiUrl || "");
        var isDeepSeek = /deepseek/i.test(url);
        var isResponses = ResponsesApiHelpers_1.isResponsesApiUrl(apiUrl);
        var isV4 = /\/v4\/((chat\/completions)|(message))/.test(url) || isResponses || isDeepSeek;
        var sent = false;
        if (isV4) {
            body.thinking = { type: "disabled" };
            // Ollama and other OpenAI-style endpoints ignore the thinking object and need
            // reasoning_effort "none"; DeepSeek accepts only its own documented enum.
            if (!isDeepSeek && !isResponses) body.reasoning_effort = "none";
            sent = true;
        }
        if (this._isLocalEndpoint(apiUrl) || this._isQwenModel(modelName)) {
            this._setEnableThinking(body, false);
            sent = true;
        }
        return sent;
    }
    // Append the Qwen3 '/no_think' soft switch, for a Qwen model while thinking is being
    // actively turned off. A server that ignores chat_template_kwargs still honors this.
    _applyQwenNoThink(messages, format, modelName) {
        if (format !== "none" || !this._isQwenModel(modelName)) return;
        if (!messages || !messages.length) return;
        var sys = null;
        for (var i = 0; i < messages.length; i++) {
            if (messages[i] && messages[i].role === "system") { sys = messages[i]; break; }
        }
        if (!sys || typeof sys.content !== "string") return;
        if (/(^|\s)\/no_think\s*$/.test(sys.content)) return;
        sys.content = sys.content.replace(/\s+$/, "") + "\n/no_think";
    }
    _applyReasoningParams(body, llmToUse, modelName, endpointNumber, apiUrl, endpointIsOurs) {
        if (!body || typeof body !== "object") return;
        var format = this._reasoningFormatFor(llmToUse, endpointNumber);
        // "Not enabled" is hands-off: no reasoning is asked for and no disable parameter is
        // sent either, so the request is left exactly as the provider's own default expects.
        if (format === "not_enabled") return;
        // "None" means disabled, so turn it off wherever the endpoint allows.
        if (format === "none") {
            this._applyThinkingDisable(body, apiUrl, modelName);
            return;
        }
        // An explicit reasoning format supersedes any stale disable field.
        if (body.reasoning_effort === "none") delete body.reasoning_effort;
        if (body.thinking && body.thinking.type === "disabled") delete body.thinking;
        // Reasoning intent for a local endpoint that IS our front door is normalised there, once, for
        // every client — it is the only place that knows the served model's own capabilities, and the
        // only place a third-party client's request also passes. Translating it here as well would give
        // two answers, so for that endpoint the intent (the requested effort included) is left as the
        // caller sent it. The qwen format above is the one exception: it sets enable_thinking for every
        // endpoint, so our front door receives that switch from the engine too. That is harmless and
        // idempotent, because the front door decides the same switch from the served model's own
        // capabilities. Whether a loopback endpoint is ours is decided by probing, never by address:
        // port 1234 is shared with other local servers. A local endpoint that is NOT ours has no
        // normaliser, so it gets the ask in the body itself (below).
        var settings = this._reasoningSettingsFor(llmToUse, endpointNumber);
        var effort = settings.effort || "low";
        var tierBudget = ({ minimal: 256, low: 1024, medium: 4096, high: 16384, max: 65536 })[effort];
        if (tierBudget === undefined) tierBudget = 1024;
        var rawBudget = settings.budget;
        var budget = (rawBudget !== undefined && rawBudget !== null && rawBudget !== "" && Number(rawBudget) > 0) ? Number(rawBudget) : tierBudget;
        if (format === "openai_effort") {
            body.reasoning_effort = effort;
        } else if (format === "thinking_object") {
            if (body.max_tokens !== undefined && body.max_tokens !== null && Number(budget) >= Number(body.max_tokens)) {
                body.max_tokens = budget + 1024;
            }
            body.thinking = { type: "enabled", budget_tokens: budget };
        } else if (format === "gemini") {
            if (!body.generationConfig || typeof body.generationConfig !== "object") body.generationConfig = {};
            if (!body.generationConfig.thinkingConfig || typeof body.generationConfig.thinkingConfig !== "object") body.generationConfig.thinkingConfig = {};
            body.generationConfig.thinkingConfig.thinkingBudget = budget;
        } else if (format === "qwen") {
            this._setEnableThinking(body, true);
        }
        // A loopback endpoint that is not our front door (LM Studio, a hand-run llama-server, anything
        // else on the shared port) has nothing to normalise the format's own field, so the engine asks
        // for reasoning the way it did before the front door existed: the template switch as well. The
        // ownership answer is resolved per request by the caller — never by address, which cannot tell
        // the two servers apart — and an unknown answer is treated as "not ours" so a failed probe can
        // only make the engine ask, never silently strip the ask.
        if (this._isLocalEndpoint(apiUrl) && endpointIsOurs !== true) {
            this._setEnableThinking(body, true);
        }
    }

    // Record token usage from a review completion into the run stats so the
    // quality summary can report what QC/Judge/Fix actually cost. Best-effort:
    // a missing/odd usage object must never break a review call.
    _recordReviewUsage(usage) {
        try {
            const s = this.getRunStats();
            s.reviewCalls = (s.reviewCalls || 0) + 1;
            if (usage) {
                const p = (usage.prompt_tokens != null) ? usage.prompt_tokens : usage.input_tokens;
                const c = (usage.completion_tokens != null) ? usage.completion_tokens : usage.output_tokens;
                s.reviewPromptTokens = (s.reviewPromptTokens || 0) + (Number(p) || 0);
                s.reviewCompletionTokens = (s.reviewCompletionTokens || 0) + (Number(c) || 0);
            }
        } catch (e) { /* stats are best-effort */ }
    }

    // Effective Review (QC/Judge/Fix) settings. All-or-nothing: a blank Review URL
    // means the translating endpoint is used wholesale (see
    // review/model.resolveReviewEndpoint); a set Review URL means ONLY these
    // Review values are used, with no per-option inheritance.
    _reviewSettings() {
        const g = (opt) => (opt && typeof opt.getValue === "function") ? opt.getValue() : undefined;
        return {
            apiUrl: g(this.optionReviewApiUrl),
            apiKey: g(this.optionReviewApiKey),
            model: g(this.optionReviewModel),
            doNotFixURL: g(this.optionReviewDoNotFixURL) === true,
            temperature: g(this.optionReviewTemperature),
            requestDelay: g(this.optionReviewRequestDelay),
            topK: g(this.optionReviewTopK),
            topP: g(this.optionReviewTopP),
            minP: g(this.optionReviewMinP),
            repeatPenalty: g(this.optionReviewRepeatPenalty),
            repetitionPenalty: g(this.optionReviewRepetitionPenalty),
            frequencyPenalty: g(this.optionReviewFrequencyPenalty),
            presencePenalty: g(this.optionReviewPresencePenalty),
            chatTemplateKwargs: g(this.optionReviewChatTemplateKwargs),
            customHeaders: g(this.optionReviewCustomHeaders),
            customParameters: g(this.optionReviewCustomParameters),
            reasoningFormat: g(this.optionReviewReasoningFormat),
            reasoningEffort: g(this.optionReviewReasoningEffort),
            reasoningBudget: g(this.optionReviewReasoningBudget),
            maxTokens: g(this.optionReviewMaxTokens),
            maxContextLength: g(this.optionReviewMaxContextLength),
            disableStream: g(this.optionReviewDisableStream) === true,
            enableTokenProgress: g(this.optionReviewEnableTokenProgress) !== false,
            enableStreamPreview: g(this.optionReviewEnableStreamPreview) !== false
        };
    }

    _applyReviewSampling(body, resolved, penaltyBump) {
        const bump = Number(penaltyBump) || 0;
        const setNum = (key, v, extra) => {
            if (v === undefined || v === null || v === "" || isNaN(Number(v))) return;
            body[key] = Number(v) + (extra || 0);
        };
        setNum("temperature", resolved.temperature);
        setNum("top_k", resolved.top_k);
        setNum("top_p", resolved.top_p);
        setNum("min_p", resolved.min_p);
        // Repetition penalties grow with the repetition-loop retry bump, exactly
        // like the translation path — and exactly like it, only parameters that
        // are actually set are sent and bumped.
        setNum("repeat_penalty", resolved.repeat_penalty, bump);
        setNum("repetition_penalty", resolved.repetition_penalty, bump);
        setNum("frequency_penalty", resolved.frequency_penalty, bump);
        setNum("presence_penalty", resolved.presence_penalty);
        if (resolved.chatTemplateKwargs) {
            try { body.chat_template_kwargs = JSON.parse(resolved.chatTemplateKwargs); }
            catch (e) { /* malformed JSON kwarg: send nothing rather than break the call */ }
        }
    }

    // Mirror the translation path's thinking suppression, driven by the Review Reasoning Format
    // so a separate review endpoint/model gets its own behavior. The mechanisms are the shared
    // endpoint-aware ones: "None" disables where the endpoint allows it, "Not enabled" sends
    // nothing, and any other format is handled by _applyReviewReasoning.
    _applyReviewThinking(body, apiUrl, resolved) {
        const format = resolved.reasoningFormat || "none";
        if (format !== "none") return;
        this._applyThinkingDisable(body, apiUrl, resolved.model);
    }

    _applyReviewReasoning(body, resolved) {
        const format = resolved.reasoningFormat || "none";
        if (format === "none" || format === "not_enabled") return;
        const effort = resolved.reasoningEffort || "low";
        const tierBudget = ({ minimal: 256, low: 1024, medium: 4096, high: 16384, max: 65536 })[effort];
        const tier = tierBudget === undefined ? 1024 : tierBudget;
        const rawBudget = resolved.reasoningBudget;
        const budget = (rawBudget !== undefined && rawBudget !== null && rawBudget !== "" && Number(rawBudget) > 0)
            ? Number(rawBudget) : tier;
        // An explicit reasoning format supersedes a thinking-disable "none".
        if (body.reasoning_effort === "none") delete body.reasoning_effort;
        if (format === "openai_effort") {
            body.reasoning_effort = effort;
        } else if (format === "thinking_object") {
            if (body.max_tokens !== undefined && body.max_tokens !== null && Number(budget) >= Number(body.max_tokens)) {
                body.max_tokens = budget + 1024;
            }
            body.thinking = { type: "enabled", budget_tokens: budget };
        } else if (format === "gemini") {
            if (!body.generationConfig || typeof body.generationConfig !== "object") body.generationConfig = {};
            if (!body.generationConfig.thinkingConfig || typeof body.generationConfig.thinkingConfig !== "object") {
                body.generationConfig.thinkingConfig = {};
            }
            body.generationConfig.thinkingConfig.thinkingBudget = budget;
        } else if (format === "qwen") {
            this._setEnableThinking(body, true);
        }
    }

    // The Qwen '/no_think' soft switch for Review. The parameter itself is sent by
    // _applyReviewThinking; this only adds the trained soft switch, which still works on a
    // server that ignores chat_template_kwargs.
    _applyReviewQwenThinking(body, messages, resolved, apiUrl) {
        if (!body || typeof body !== "object") return;
        if ((resolved.reasoningFormat || "none") !== "none") return;
        var isQwen = this._isQwenModel(resolved.model);
        if (!isQwen || !messages || !messages.length) return;
        var sys = null;
        for (var i = 0; i < messages.length; i++) {
            if (messages[i] && messages[i].role === "system") { sys = messages[i]; break; }
        }
        if (!sys || typeof sys.content !== "string") return;
        if (/(^|\s)\/no_think\s*$/.test(sys.content)) return;
        sys.content = sys.content.replace(/\s+$/, "") + "\n/no_think";
    }

    // Values of the configured `*CommandReplacer` options, for review prompt
    // rendering (the reviewer sees the same wire tokens as the translator).
    _reviewReplacers() {
        const get = (k) => {
            const o = this["option" + k];
            return o && typeof o.getValue === "function" ? o.getValue() : undefined;
        };
        return {
            person: get("NameCommandReplacer"),
            name: get("CharacterCommandReplacer"),
            color: get("ColorCommandReplacer"),
            image: get("ImageCommandReplacer"),
            variable: get("VariableCommandReplacer"),
            at: get("PlaceholderReplacer")
        };
    }

    _reviewPromptOverrides(role) {
        const get = (kind) => {
            const o = this["optionReview" + role + kind + "Prompt"];
            return o && typeof o.getValue === "function" ? o.getValue() : undefined;
        };
        return { system: get("System"), user: get("User") };
    }

    _reviewMinSeverity() {
        return (this.optionReviewMinSeverity && typeof this.optionReviewMinSeverity.getValue === "function")
            ? this.optionReviewMinSeverity.getValue() : "low";
    }

    // Whether QC findings are adjudicated by the judge. On by default: a
    // finding only orders a retranslation once the judge confirms it, so QC
    // false positives are filtered. Off: findings at or above the minimum
    // severity order the retry directly and the judge call is skipped.
    _reviewJudgeOn() {
        return !(this.optionReviewJudge && typeof this.optionReviewJudge.getValue === "function")
            ? true : this.optionReviewJudge.getValue() !== false;
    }

    // The bar a re-review judges against: the configured minimum on the first
    // re-review, then one rank higher for each further round the row has
    // already burned, capped at high — while Escalate Minimum Severity on
    // Re-Review is on (the default). With it off, every re-review uses the
    // configured minimum. roundIndex is the row's completed fix-round count
    // (1 for its first re-review); a missing index reads as the first
    // re-review, so a direct caller never silently starts escalated.
    _reviewRereviewMinSeverity(roundIndex) {
        const base = this._reviewMinSeverity();
        const on = (this.optionReviewEscalateMinSeverity &&
            typeof this.optionReviewEscalateMinSeverity.getValue === "function")
            ? this.optionReviewEscalateMinSeverity.getValue() : true;
        if (on === false) return base;
        const steps = require("./review/linecheck").escalateStepsForRound(roundIndex);
        return require("./review/linecheck").escalateSeverity(base, steps);
    }

    _reviewRoundsMax() {
        const raw = (this.optionReviewRetryRounds && typeof this.optionReviewRetryRounds.getValue === "function")
            ? Number(this.optionReviewRetryRounds.getValue()) : 5;
        return (isFinite(raw) && raw >= 0) ? raw : 5;
    }

    // QC + Judge for re-reviewing a retried row, with the same surrounding
    // context the original windowed review had: the row's fresh translation
    // plus its neighbors' batch translations (real batch positions as indices,
    // so findings cite the same @N). The window is context only — focusIndex
    // scopes QC, judge, logging, holds, and verdicts to the retried row, so
    // the re-check confirms that row's fix and nothing else. Returns the
    // row's verdict when the QC window call succeeded ({ redo, why } or null
    // for a clean/fully-dismissed row), a non-redo { redo: false } marker
    // when the row is still flagged without a redo (below-minSeverity or
    // unadjudicated finding — the caller keeps the flag), and undefined when
    // the review itself failed — the caller keeps a row's existing flag in
    // that case (fail closed) instead of mistaking "could not review" for
    // "reviewed clean". windowOpts is passed through to windowPairs:
    // { settled } feeds already-accepted rows' final text into the window
    // instead of their raw batch text, and { suspect } serves pending-redo
    // rows source-only (their text is about to change: context, never
    // ground truth). The re-review judges against a progressively escalated
    // bar — the configured Review Minimum Severity on the first re-review,
    // one rank higher per already-burned round after that while Escalate
    // Minimum Severity on Re-Review is on — so a style nit that ordered this
    // retry cannot order the next one by itself. roundIndex is the row's
    // completed fix-round count. history is the
    // row's prior attempts ({ text, why }), shown to QC and the judge so a
    // re-review sees what was already tried instead of re-litigating blind.
    async _reviewLineVerdict(pos, wireSrc, wireDst, endpointNumber, neighborSources, neighborTranslations, sections, windowOpts, history, roundIndex) {
        if (wireSrc == null || wireDst == null || wireDst === "") return null;
        const LineCheck = require("./review/linecheck");
        let pairs;
        try {
            pairs = LineCheck.windowPairs(pos, neighborSources, neighborTranslations, wireDst,
                undefined, windowOpts);
        } catch (e) {
            pairs = null;
        }
        if (!pairs || !pairs.length) {
            pairs = [{ index: pos, speaker: "", wireSrc: wireSrc, wireDst: wireDst }];
        }
        let out;
        try {
            out = await LineCheck.reviewWindows(
                pairs,
                {
                    callModel: async (system, user, kind, extra) => this.reviewCompletion(
                        this._reviewMessages(system, extra && extra.context, user),
                        { endpointNumber: endpointNumber, label: kind, reviewScale: "retry" }),
                    replacers: this._reviewReplacers(),
                    qcOverrides: this._reviewPromptOverrides("Qc"),
                    judgeOverrides: this._reviewPromptOverrides("Judge"),
                    judge: this._reviewJudgeOn(),
                    minSeverity: this._reviewRereviewMinSeverity(roundIndex),
                    focusIndex: pos,
                    history: Array.isArray(history) ? history : [],
                    cacheFriendly: this._cacheFriendlyPromptsActive(),
                    log: (m) => { try { this.log("[DSLRReview] " + m); } catch (e) { } },
                    sections: sections || []
                });
        } catch (e) {
            return undefined;
        }
        if (!out || out.windowsFailed > 0) return undefined;
        if (out.verdicts && out.verdicts[pos]) return out.verdicts[pos];
        // Cited but not redo: keep the row flagged without another retry.
        if (out.flagged && out.flagged.indexOf(pos) !== -1) return { redo: false, why: "" };
        return null;
    }

    // One chat completion against the selected endpoint/model.
    // Used by the review layer to run QC/judge prompts. Review responses are
    // small, and stream only for the live counter/preview (see the progress UI
    // below); disable both display toggles for plain non-streaming calls.
    //
    // Capacity: reviews must not bypass the endpoint pool. This
    // reserves the endpoint's in-flight slot for the whole call (including
    // retries), visible to the batch dispatcher's shared `endpointInFlight` map,
    // and releases it in `finally`. It also checks `response.ok` and retries with
    // the same delay family the translation path uses. The doTranslate rotation
    // path is embedded in its 7000-line request loop and is not directly callable,
    // so this uses explicit reserve/release + bounded backoff rather than rotation.
    // Per-call live display for one review request: a token counter plus an
    // optional streamed-text preview in the loading console, mirroring the
    // translation/glossary pair (counter teal, preview steel, preview above the
    // counter so the bottom-anchored console keeps the counter in view).
    // Unlike the batch pair — which persists hidden per doTranslate call — the
    // review pair is REMOVED when the call finishes, so dozens of short
    // QC/judge calls never pile up. Visibility across concurrent streams is
    // coordinated through the shared _registerStreamPreview stack (honoring the
    // existing 'Stream All Concurrent Responses' option).
    // Returns null when the display is off or the console is unavailable; every
    // method on the returned object null-guards, and end() is idempotent.
    _reviewProgressLines(showPreview) {
        const ui = {
            counterPre: null, counterNode: null, previewPre: null, previewNode: null,
            ctxNodes: [], slot: null, last: -1, done: false
        };
        const self = this;
        try {
            if (typeof document === "undefined") return null;
            const consoleEl = (typeof window !== "undefined" && window.$)
                ? window.$('#loadingOverlay .console')[0] : null;
            if (!consoleEl) return null;
            ui.counterNode = document.createTextNode('0');
            ui.counterPre = document.createElement('pre');
            ui.counterPre.style.whiteSpace = 'pre-wrap';
            ui.counterPre.style.color = '#66c2ff';
            ui.counterPre.style.fontWeight = 'bold';
            ui.counterPre.style.display = 'none';
            ui.counterPre.appendChild(document.createTextNode('[DSLRReview] Generating review response: '));
            ui.counterPre.appendChild(ui.counterNode);
            ui.counterPre.appendChild(document.createTextNode(' tokens'));
            const counterCtx = document.createTextNode('');
            ui.counterPre.appendChild(counterCtx);
            ui.ctxNodes.push(counterCtx);
            if (showPreview) {
                ui.previewNode = document.createTextNode('');
                const previewCtx = document.createTextNode('');
                ui.previewPre = document.createElement('pre');
                ui.previewPre.style.whiteSpace = 'pre-wrap';
                ui.previewPre.style.color = '#a8c7e0';
                ui.previewPre.style.display = 'none';
                const label = document.createElement('span');
                label.style.color = '#66c2ff';
                label.style.fontWeight = 'bold';
                label.appendChild(document.createTextNode('[DSLRReview] Streaming review response (live preview, full log in the F12 console)'));
                ui.previewPre.appendChild(label);
                ui.previewPre.appendChild(previewCtx);
                ui.previewPre.appendChild(document.createTextNode(':'));
                ui.previewPre.appendChild(ui.previewNode);
                ui.ctxNodes.push(previewCtx);
                consoleEl.appendChild(ui.previewPre);
            }
            consoleEl.appendChild(ui.counterPre);
            ui.slot = { pre: ui.previewPre };
        } catch (e) { return null; }
        ui.begin = function (ctx) {
            try {
                ui.last = -1;
                ui.done = false;
                if (ui.counterNode) ui.counterNode.nodeValue = '0';
                const suffix = ctx ? ' (' + ctx + ')' : '';
                for (const n of ui.ctxNodes) { try { n.nodeValue = suffix; } catch (e) { } }
                if (ui.previewNode) ui.previewNode.nodeValue = '';
                if (ui.counterPre) ui.counterPre.style.display = '';
                if (ui.previewPre) ui.previewPre.style.display = '';
                self._registerStreamPreview(ui.slot);
            } catch (e) { /* display is best-effort */ }
        };
        ui.update = function (tokens, content, reasoning) {
            try {
                if (ui.done || !ui.counterPre || ui.counterPre.style.display === 'none') return;
                if (tokens != null && tokens !== ui.last) {
                    ui.last = tokens;
                    if (ui.counterNode) ui.counterNode.nodeValue = String(tokens);
                }
                if (ui.previewPre && ui.previewNode && (content || reasoning)) {
                    ui.previewNode.nodeValue = '\n' + (reasoning ? reasoning + '\n' : '') + (content || '');
                }
            } catch (e) { /* display is best-effort */ }
        };
        ui.end = function () {
            try {
                if (ui.done) return;
                ui.done = true;
                self._unregisterStreamPreview(ui.slot);
                if (ui.counterPre && ui.counterPre.parentNode) ui.counterPre.parentNode.removeChild(ui.counterPre);
                if (ui.previewPre && ui.previewPre.parentNode) ui.previewPre.parentNode.removeChild(ui.previewPre);
            } catch (e) { /* display is best-effort */ }
        };
        return ui;
    }

    async reviewCompletion(messages, opts) {
        const options = opts || {};
        const requested = (options.endpointNumber && options.endpointNumber > 0)
            ? options.endpointNumber : 1;
        // Prefer a healthy endpoint: if the requested one is disabled or cooling
        // down and another active endpoint has spare capacity, start there.
        let endpointNumber = requested;
        try {
            if (typeof this._endpointAvailable === "function" && !this._endpointAvailable(endpointNumber)
                && this._hasMultipleEndpoints()) {
                const alt = this._nextAvailableEndpoint();
                if (alt !== null && alt !== undefined) endpointNumber = alt;
            }
        } catch (e) { endpointNumber = requested; }
        // Known-bad endpoint with nowhere else to go: wait out a short cooldown
        // instead of immediately re-running the whole retry loop, and fail
        // closed (review rows keep their flags) when the endpoint is hard
        // disabled or cooling down for longer than the cap. This is what stops
        // a dead endpoint shared with the translator from being re-hammered
        // once per reviewed row.
        try {
            if (typeof this._endpointAvailable === "function" && !this._endpointAvailable(endpointNumber)) {
                let alt = null;
                try {
                    if (this._hasMultipleEndpoints()) alt = this._nextAvailableEndpoint();
                } catch (e) { alt = null; }
                if (alt !== null && alt !== undefined) {
                    endpointNumber = alt;
                } else {
                    const remaining = (typeof this._endpointCooldownRemaining === "function")
                        ? this._endpointCooldownRemaining(endpointNumber) : 0;
                    if (remaining > 0 && remaining <= REVIEW_COOLDOWN_WAIT_CAP_MS) {
                        this.error("[DSLR] Review endpoint " + endpointNumber + " is cooling down; waiting " +
                            Math.round(remaining / 1000) + "s before the next attempt.");
                        await new Promise((r) => setTimeout(r, remaining));
                    } else {
                        throw new Error("[DSLR] Review endpoint " + endpointNumber +
                            (remaining > 0
                                ? " is still cooling down for " + Math.round(remaining / 1000) + "s"
                                : " is disabled") +
                            "; not reviewing this row (failing closed).");
                    }
                }
            }
        } catch (e) {
            // Only the deliberate fail-closed error reaches here; any
            // availability API problem is not a reason to skip the review.
            if (e && /failing closed/.test(String(e.message))) throw e;
        }
        this._incEndpointInFlight(endpointNumber);
        // Per-call live display (token counter + streamed preview). Created
        // lazily on the first attempt that streams; removed when the call ends
        // (end() is idempotent, and the outer finally covers every exit).
        let progressUI = null;
        try {
            const Retry = require("./review/retry");
            // Two independent failure budgets (see reviewRetryBudget): network
            // failures are expensive (escalating backoff), repetition loops are
            // cheap (flat 5s + a small penalty bump) and get more tries. The
            // loop bound is a safety net; the budgets end it first.
            let retryCounters = { net: 0, repeats: 0 };
            const MAX_ITERATIONS = Retry.REVIEW_NET_ATTEMPTS + Retry.REVIEW_REPEAT_ATTEMPTS + 1;
            let lastError = null;
            // Raised by +0.05 every time a streamed review response turns out
            // to be a repetition loop, mirroring the translation path: only
            // parameters that are actually set are bumped (see
            // _applyReviewSampling).
            let repPenaltyAddition = 0;
            for (let attempt = 0; attempt < MAX_ITERATIONS; attempt++) {
                // Another batch/review may have cooled down or disabled this endpoint
                // while we waited; move to a spare one when possible.
                try {
                    if (typeof this._endpointAvailable === "function" && !this._endpointAvailable(endpointNumber)
                        && this._hasMultipleEndpoints()) {
                        const alt = this._nextAvailableEndpoint();
                        if (alt !== null && alt !== undefined && alt !== endpointNumber) {
                            this._decEndpointInFlight(endpointNumber);
                            this._incEndpointInFlight(alt);
                            this.error("[DSLR] Review moving from endpoint " + endpointNumber +
                                " to " + alt + " (previous endpoint unavailable).");
                            endpointNumber = alt;
                        }
                    }
                } catch (e) { /* availability is best-effort */ }

                const batchEp = this.getEndpointSettings(endpointNumber);
                // The global streaming-display toggles are not per-endpoint settings, so
                // expose them on the fallback object: a blank Review URL must reuse the
                // translation run's display behaviour wholesale.
                try {
                    if (batchEp.enableTokenProgress === undefined && this.optionEnableTokenProgress)
                        batchEp.enableTokenProgress = this.optionEnableTokenProgress.getValue();
                    if (batchEp.enableStreamPreview === undefined && this.optionEnableStreamPreview)
                        batchEp.enableStreamPreview = this.optionEnableStreamPreview.getValue();
                } catch (e) { /* display fallback is best-effort */ }
                const resolved = ReviewModel_1.resolveReviewEndpoint(this._reviewSettings(), batchEp);
                const apiKey = resolved.apiKey;
                const apiUrl = EndpointHelpers_1.fixApiUrl(resolved.apiUrl, resolved.doNotFixURL);
                const model = resolved.model;
                let body = { model, messages };
                if (options.maxTokens) {
                    body.max_tokens = options.maxTokens;
                } else if (ReviewModel_1.isSet(resolved.maxTokens)) {
                    // Input-size downscaling, mirroring the translation paths:
                    // seed reviews (whole batch) scale like full-batch requests,
                    // re-review retries (one row) like single-line requests. The
                    // caller marks which one this is via opts.reviewScale.
                    let reviewInputChars = 0;
                    try {
                        for (const rm of (messages || [])) {
                            if (rm && rm.role === "user" && typeof rm.content === "string") {
                                reviewInputChars += rm.content.length;
                            }
                        }
                    } catch (e) { /* estimate is best-effort */ }
                    const reviewScaled = ReviewModel_1.reviewMaxTokensForInput(
                        resolved.maxTokens, reviewInputChars,
                        options.reviewScale === "retry" ? "retry" : "seed");
                    if (reviewScaled !== undefined) body.max_tokens = reviewScaled;
                }
                this._applyReviewSampling(body, resolved, repPenaltyAddition);
                this._applyReviewThinking(body, apiUrl, resolved);
                this._applyReviewReasoning(body, resolved);
                this._applyReviewQwenThinking(body, messages, resolved, apiUrl);
                const extraParams = ReviewModel_1.parseJsonObject(resolved.customParameters);
                for (const key of Object.keys(extraParams)) {
                    const value = extraParams[key];
                    if (value !== null && value !== undefined && value !== "") body[key] = value;
                }
                const reviewHeaders = ReviewModel_1.parseJsonObject(resolved.customHeaders);
                if (attempt === 0 && Number(resolved.requestDelay) > 0) {
                    await new Promise((r) => setTimeout(r, Number(resolved.requestDelay)));
                }
                const streamFlags = ReviewModel_1.reviewStreamFlags(resolved);
                if (!progressUI && streamFlags.useTokenProgress) {
                    progressUI = this._reviewProgressLines(streamFlags.showPreview);
                }
                if (streamFlags.disableStream) {
                    body.stream = false;
                } else if (streamFlags.useTokenProgress) {
                    body.stream = true;
                    body.stream_options = { include_usage: true };
                }
                const isResponsesApi = ResponsesApiHelpers_1.isResponsesApiUrl(apiUrl);
                if (isResponsesApi) body = ResponsesApiHelpers_1.toResponsesBody(body);
                // Repetition-loop guard, mirroring the translation streams: the
                // shared readers terminate a looping response early (finish
                // "length") instead of generating to the token limit. Like the
                // single-line path, only the character and word tiers apply —
                // review responses carry no structured entries. Inactive (0)
                // when both tiers are disabled, and moot when not streaming.
                const reviewTiers = _repetitionLoopTiers(this);
                const reviewRepetition = ReviewModel_1.reviewRepetitionConfig(reviewTiers);
                _reviewLogCollapsed("[DSLRReview] Request Body:", body);
                console.log("[DSLRReview] Request -> endpoint " + endpointNumber + " (" + apiUrl + ")" +
                    (options.label ? " [" + options.label + "]" : ""));
                try {
                    const response = await fetch(apiUrl, {
                        method: "POST",
                        headers: Object.assign(
                            { "Content-Type": "application/json" },
                            apiKey ? { "Authorization": "Bearer " + apiKey } : {},
                            reviewHeaders
                        ),
                        body: JSON.stringify(body),
                        signal: this._requestSignal()
                    });
                    if (!response.ok) {
                        // Drain the body (frees the connection) and keep a short snippet
                        // for diagnostics. A non-ok response must throw: the review layer
                        // treats a throw as "no findings"/"no fix", never as success.
                        let snippet = "";
                        try { snippet = String(await response.text()).slice(0, 300); } catch (e) { snippet = ""; }
                        const err = new Error("[DSLR] Review request failed on endpoint " + endpointNumber +
                            ": HTTP " + response.status + (snippet ? " — " + snippet : ""));
                        err.status = response.status;
                        const statusStr = String(response.status);
                        // Bad key/URL/permission never recovers by retrying: disable the
                        // endpoint for the rest of the job (shared with the translation
                        // dispatcher) and fail immediately instead of burning backoff.
                        if (ReviewModel_1.classifyReviewFailure(statusStr) === "unrecoverable") {
                            try { this._disableEndpoint(endpointNumber); } catch (e2) { }
                            this.error("[DSLR] Review endpoint " + endpointNumber + " returned HTTP " +
                                statusStr + " (unrecoverable); not retrying.");
                            throw err;
                        }
                        // Rate-limit/overload registers a shared cooldown so the
                        // translation dispatcher also backs off this endpoint.
                        if (ReviewModel_1.classifyReviewFailure(statusStr) === "rate-limit"
                            && typeof this._markEndpoint429 === "function") {
                            try { this._markEndpoint429(endpointNumber); } catch (e2) { }
                        }
                        throw err;
                    }
                    if (typeof this._resetEndpointStreak === "function") this._resetEndpointStreak(endpointNumber);
                    console.log("Response Status:\n" + response.status);
                    if (streamFlags.useTokenProgress && progressUI && _responseBodyIsStreamable(response)) {
                        progressUI.begin(options.label);
                        const streamed = isResponsesApi
                            ? await ResponsesApiHelpers_1.streamResponsesCompletion(response,
                                (t, c, r) => progressUI.update(t, c, r), reviewRepetition)
                            : await _streamChatCompletion(response,
                                (t, c, r) => progressUI.update(t, c, r), reviewRepetition);
                        progressUI.end();
                        // A repetition loop means the text is model garbage, not
                        // a verdict: never let it become findings. Retry with a
                        // raised penalty while attempts remain (same 5s wait as
                        // the translation path); when exhausted, throw so the
                        // review layer fails closed (flags kept, row unreviewed)
                        // instead of adjudicating loop output.
                        if (streamed && streamed.repetition_loop) {
                            repPenaltyAddition = repPenaltyAddition + 0.05;
                            retryCounters = Retry.reviewRetryBudget("repetition", retryCounters);
                            const loopReason = streamed.repetition_loop_reason ||
                                "the same text was repeated back to back too many times";
                            // Show what was actually generated before the kill: the
                            // reason names the trigger, this shows the content it
                            // fired on, so a fast termination is diagnosable
                            // (console only, like every other review payload).
                            try {
                                _reviewLogCollapsed("[DSLRReview] Content generated before the repetition kill:",
                                    (streamed.choices && streamed.choices[0] && streamed.choices[0].message
                                        && streamed.choices[0].message.content) || "");
                            } catch (e2) { /* console unavailable */ }
                            if (!retryCounters.retry) {
                                const exhausted = new Error("[DSLR] Review response stuck in a repetition loop (" +
                                    loopReason + "); attempts exhausted.");
                                // Tag it so the catch below does not mistake this
                                // for a network failure and recharge that budget.
                                exhausted.reviewRepetitionExhausted = true;
                                throw exhausted;
                            }
                            this.error("[DSLRReview] Repetition loop detected in the streamed response (" +
                                loopReason + "), terminated early; retrying with an increased repetition penalty in 5s (" +
                                retryCounters.repeats + "/" + Retry.REVIEW_REPEAT_ATTEMPTS + ").");
                            console.error("[DSLRReview] Repetition loop detected in a review response; terminated early (" +
                                loopReason + ").");
                            await new Promise((r) => setTimeout(r, 5000));
                            continue;
                        }
                        this._recordReviewUsage(streamed && streamed.usage);
                        const streamText = (streamed.choices && streamed.choices[0] && streamed.choices[0].message
                            && streamed.choices[0].message.content) || "";
                        _reviewLogCollapsed("[DSLRReview] Server Response:", streamText);
                        return streamText;
                    }
                    const raw = await response.text();
                    if (isResponsesApi) {
                        let usage = null;
                        try { const r = JSON.parse(raw); usage = r && r.usage; } catch (e) { usage = null; }
                        const text = ResponsesApiHelpers_1.parseResponsesText(raw);
                        this._recordReviewUsage(usage);
                        _reviewLogCollapsed("[DSLRReview] Server Response:", text);
                        return text;
                    }
                    const parsed = JSON.parse(raw);
                    this._recordReviewUsage(parsed && parsed.usage);
                    const outText = (parsed.choices && parsed.choices[0] && parsed.choices[0].message
                        && parsed.choices[0].message.content) || "";
                    _reviewLogCollapsed("[DSLRReview] Server Response:", outText);
                    return outText;
                } catch (e) {
                    lastError = e;
                    // Repetition-budget exhaustion is not a network failure: stop
                    // here instead of recharging the network budget and looping.
                    if (e && e.reviewRepetitionExhausted) break;
                    if (this.aborted) break;
                    const status = (e && e.status !== undefined) ? String(e.status) : "";
                    // Unrecoverable statuses never retry (the endpoint is already disabled).
                    if (ReviewModel_1.classifyReviewFailure(status) === "unrecoverable") break;
                    // Account this network-class failure against its own budget;
                    // repetition retries cannot have consumed it.
                    retryCounters = Retry.reviewRetryBudget("network", retryCounters);
                    if (!retryCounters.retry) {
                        // The endpoint produced nothing usable across the whole
                        // budget: cool it down so the next review call rotates
                        // away (or fails fast) instead of repeating this exact
                        // error loop. Only transport/server failures qualify —
                        // a 400 means the endpoint answered and the request was
                        // wrong, and 429 is already cooled down above. A success
                        // anywhere clears the streak.
                        if (EndpointHealth_1.isEndpointUnstableStatus(status)
                            && typeof this._markEndpointUnstable === "function") {
                            try { this._markEndpointUnstable(endpointNumber); } catch (e2) { }
                        }
                        break;
                    }
                    // On rate-limit/overload, rotate to a spare endpoint before waiting.
                    if (ReviewModel_1.classifyReviewFailure(status) === "rate-limit" && this._hasMultipleEndpoints()) {
                        let moved = false;
                        try {
                            const next = this._nextAvailableEndpoint();
                            if (next !== null && next !== undefined && next !== endpointNumber) {
                                this._decEndpointInFlight(endpointNumber);
                                this._incEndpointInFlight(next);
                                this.error("[DSLR] Review rotating endpoint " + endpointNumber +
                                    " -> " + next + " after HTTP " + status + ".");
                                endpointNumber = next;
                                moved = true;
                            }
                        } catch (e2) { moved = false; }
                        if (moved) {
                            await new Promise((r) => setTimeout(r, 500));
                            continue;
                        }
                    }
                    // Same backoff family as the translation path: 429/524 -> 3s,
                    // 400 -> 10s, other transport/server errors -> 30s, escalating per
                    // network attempt (x3 for rate-limit/server, x2 for 400), and never
                    // waiting less than the endpoint's configured request delay.
                    let base = 30000;
                    let scale = 3;
                    if (ReviewModel_1.classifyReviewFailure(status) === "rate-limit") { base = 3000; scale = 3; }
                    else if (status && /400/.test(status)) { base = 10000; scale = 2; }
                    const reqDelay = Number(resolved.requestDelay) > 0 ? Number(resolved.requestDelay) : 0;
                    const delay = Math.max(reqDelay, Math.round(base * Math.pow(scale, retryCounters.net - 1)));
                    this.error("[DSLR] Review request on endpoint " + endpointNumber + " failed (" +
                        (e && e.message ? e.message : e) + "); retrying in " + delay + "ms.");
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
            throw lastError || new Error("[DSLR] Review request failed.");
        } finally {
            try { if (progressUI) progressUI.end(); } catch (e) { }
            this._decEndpointInFlight(endpointNumber);
        }
    }

    async doTranslate(toTranslate, options) {
        this.resetStatus();
        let returnTranslations;
        let returnError;

        if (options.sl != 'ja') {
            this.error(`[DSLR] The project specifies the source language as not being Japanese (${options.sl}). Since this engine is optimized for Japanese to English, we will use Japanese instead.`);
            console.error(`[DSLR] The project specifies the source language as not being Japanese (${options.sl}). Since this engine is optimized for Japanese to English, we will use Japanese instead.`);
        }
        if (options.tl != 'en') {
            this.error(`[DSLR] The project specifies the destination language as not being English (${options.tl}). Since this engine is optimized for Japanese to English, we will use English instead.`);
            console.error(`[DSLR] The project specifies the destination language as not being English (${options.tl}). Since this engine is optimized for Japanese to English, we will use English instead.`);
        }

        let translations = new Array(toTranslate.length);
        let translatingIndex = 0;
        let completeThreads = 0;
        let totalThreads = 1
        totalThreads = totalThreads < 1 ? 1 : totalThreads;
        let maximumBatchSize = this.optionMaxRequestLengthDSLR.getValue();
        let sceneBreakSet = new Set(options.sceneBreaks || []);
        // Track which indices have been counted to prevent double-counting
        let countedIndices = new Set();

        let complete = () => {
            if (++completeThreads == 1) {
                // Expose this batch's token usage through the per-call options object (race-free
                // even with concurrent batches) so the batch translator can show one combined
                // total in the UI at the end, instead of a per-batch summary that clutters it.
                options._tokenUsage = {
                    prompt: totalPromptTokens,
                    completion: totalCompletionTokens,
                    total: totalTokens
                };
                // Per-batch token details go to the devtools console only now; the UI shows a
                // single combined total once the whole batch-translation job finishes.
                if (totalTokens >= 1) {
                    // Wall-clock rate for this chunk. It is an average over everything the chunk
                    // did - prompt processing, generation, retries and waiting - which is exactly
                    // what makes runs feel slow, so it is labelled as such.
                    var chunkSeconds = Math.max(0.001, (Date.now() - chunkStartedAt) / 1000);
                    console.log(`[DSLR] Final token summary:
- Prompt tokens: ${totalPromptTokens}
- Completion tokens: ${totalCompletionTokens} 
- Total tokens: ${totalTokens}
- Average speed: ${(totalCompletionTokens / chunkSeconds).toFixed(1)} tok/s generated, ${(totalPromptTokens / chunkSeconds).toFixed(1)} tok/s prompt (${chunkSeconds.toFixed(1)}s)`);
                }
                // Merge this chunk's statistics into the engine-wide accumulator so the batch
                // translator can print one summary covering the whole run (a run calls doTranslate
                // many times, once per chunk). complete() runs exactly once per doTranslate.
                if (!this._runStats) this.resetRunStats();
                var _s = this._runStats;
                _s.promptTokens += totalPromptTokens;
                _s.completionTokens += totalCompletionTokens;
                _s.elapsedMs = Date.now() - _s.startedAt;
                _s.linesTotal += toTranslate.length;
                _s.linesTranslated += translatedCount;
                _s.batchesSplit += dslrStats.batchesSplit;
                _s.fallbackHandovers += dslrStats.fallbackHandovers;
                _s.individualRetries += dslrStats.individualRetries;
                _s.batchCorrectionRetries += dslrStats.batchCorrectionRetries;
                _s.rateLimitRetries += dslrStats.rateLimitRetries;
                _s.serverErrors += Math.max(0, serverIssueCount - dslrStats.rateLimitRetries);
                var _failCount = 0;
                for (var _fi = 0; _fi < translations.length; _fi++) {
                    if (translations[_fi] && String(translations[_fi]).indexOf('SHISAYE.TRANSLATIONFAIL') !== -1) _failCount++;
                }
                _s.translationFails += _failCount;
                returnTranslations(translations);
            }
        };

        // Initialize progress tracking variables
        let translationProgress = document.createTextNode('0');
        let batchProgress = document.createTextNode('');
        let batchFails = document.createTextNode('');
        let fullBatchFails = document.createTextNode('');
        let serverIssues = document.createTextNode('');
        let translatedCount = 0;
        let batchProgressCount = 0;
        let batchFailCount = 0;
        let fullBatchFailCount = 0;
        let serverIssueCount = 0;
        let errorProgress = document.createTextNode('');
        let errorCount = 0;
        // Token usage tracking
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;
        // Wall-clock start of this chunk, used for its tokens/sec line in complete().
        let chunkStartedAt = Date.now();
        // Per-chunk quality/reliability statistics. Merged into this._runStats in complete()
        // so the batch translator can print one combined summary for the whole run. The
        // categories are split by how they affect translation quality:
        //  - batchesSplit / fallbackHandovers / individualRetries : context loss (quality impact)
        //  - batchCorrectionRetries                                  : recovered, costs time not quality
        //  - rateLimitRetries                                        : 429/overload waits, no quality impact
        //  (serverIssueCount is reused for "other server errors"; TRANSLATIONFAIL is counted from results)
        let dslrStats = {
            batchesSplit: 0,
            fallbackHandovers: 0,
            individualRetries: 0,
            batchCorrectionRetries: 0,
            rateLimitRetries: 0
        };
        
        // Print initial progress message with bright blue numbers
        const createBlueSpan = (textNode) => {
            const span = document.createElement('span');
            span.style.color = '#66c2ff';
            span.style.fontWeight = 'bold';
            span.appendChild(textNode);
            return span;
        };
        //Red version
        const createRedSpan = (textNode) => {
            const span = document.createElement('span');
            span.style.color = '#ff7b7b';
            span.style.fontWeight = 'bold';
            span.appendChild(textNode);
            return span;
        };        
        //Green version
        const createGreenSpan = (textNode) => {
            const span = document.createElement('span');
            span.style.color = '#66ffa3';
            span.style.fontWeight = 'bold';
            span.appendChild(textNode);
            return span;
        };
        const translationProgressSpan = createBlueSpan(translationProgress);
        const totalCountSpan = createBlueSpan(document.createTextNode(toTranslate.length.toString()));
        const translatingTextSpan = createBlueSpan(document.createTextNode('Translating texts: '));
        const fwslashTextSpan = createBlueSpan(document.createTextNode('/'));
        const errorProgressSpan = createRedSpan(errorProgress);
        const batchProgressSpan = createGreenSpan(batchProgress);
        const batchFailsSpan = createRedSpan(batchFails);
        const fullBatchFailsSpan = createRedSpan(fullBatchFails);
        const serverIssuesSpan = createRedSpan(serverIssues);

        this.print(document.createTextNode('[DSLR] '), translatingTextSpan, translationProgressSpan,
            fwslashTextSpan, totalCountSpan, errorProgressSpan,
            batchProgressSpan, batchFailsSpan, fullBatchFailsSpan, serverIssuesSpan);

        // Token generation progress line (updated live while an LLM response streams in).
        // Not appended to the console here: it is appended after the stream preview below
        // so it sits BELOW the growing preview text. The loading console is anchored to
        // its bottom, so the last line always stays in view — with the counter below the
        // preview it is never scrolled out of view while the preview grows.
        var tokenProgressNode = document.createTextNode('0');
        var counterCtxNode = document.createTextNode('');
        var tokenProgressPre = document.createElement('pre');
        tokenProgressPre.style.whiteSpace = 'pre-wrap';
        tokenProgressPre.style.color = '#66c2ff';
        tokenProgressPre.style.fontWeight = 'bold';
        tokenProgressPre.style.display = 'none';
        tokenProgressPre.appendChild(document.createTextNode('[DSLR] Generating response: '));
        tokenProgressPre.appendChild(tokenProgressNode);
        tokenProgressPre.appendChild(document.createTextNode(' tokens'));
        tokenProgressPre.appendChild(counterCtxNode);

        // Live preview of the streamed response (shown only while a response is actively
        // streaming, exactly like the token counter below; it is removed from view once the
        // response finishes so the log does not grow. The full request/response is logged to
        // the F12 devtools console). The text grows unbounded while streaming — appending to
        // a text node is cheap and the whole line disappears when the response completes.
        // Created only when the 'Enable Stream Preview Display' option is on; the show/
        // update/hide functions below null-guard, so the token counter works without it.
        // With concurrent batches no preview is shown by default while more than one stream
        // is active (engine-wide coordination, see _registerStreamPreview) so the console
        // stays readable; 'Stream All Concurrent Responses' shows every active stream's
        // preview at once instead.
        var streamTextNode = null;
        var streamTextPre = null;
        var streamCtxNode = null;
        if (!(this.optionEnableStreamPreview && this.optionEnableStreamPreview.getValue() === false)) {
            streamTextNode = document.createTextNode('');
            streamCtxNode = document.createTextNode('');
            streamTextPre = document.createElement('pre');
            streamTextPre.style.whiteSpace = 'pre-wrap';
            streamTextPre.style.color = '#a8c7e0';
            streamTextPre.style.display = 'none';
            var streamTextLabel = document.createElement('span');
            streamTextLabel.style.color = '#66c2ff';
            streamTextLabel.style.fontWeight = 'bold';
            streamTextLabel.appendChild(document.createTextNode('[DSLR] Streaming response (live preview, full log in the F12 console)'));
            streamTextPre.appendChild(streamTextLabel);
            streamTextPre.appendChild(streamCtxNode);
            streamTextPre.appendChild(document.createTextNode(':'));
            streamTextPre.appendChild(streamTextNode);
        }
        // Preview first, token counter below it (see the note on the counter above): the
        // counter is the last line of the pair, so the bottom-anchored console keeps it in
        // view even while the preview text above it grows unbounded.
        if (streamTextPre) $('#loadingOverlay .console')[0].appendChild(streamTextPre);
        $('#loadingOverlay .console')[0].appendChild(tokenProgressPre);
        var _tokenProgressLast = 0;
        var _previewSlot = { pre: streamTextPre };
        var _previewCoord = this;
        var showTokenProgress = function (ctx) {
            _tokenProgressLast = 0;
            tokenProgressNode.nodeValue = '0';
            if (ctx) {
                counterCtxNode.nodeValue = ' (' + ctx + ')';
                if (streamCtxNode) streamCtxNode.nodeValue = ' — ' + ctx;
            } else {
                counterCtxNode.nodeValue = '';
                if (streamCtxNode) streamCtxNode.nodeValue = '';
            }
            if (tokenProgressPre) tokenProgressPre.style.display = '';
            if (streamTextPre) streamTextNode.nodeValue = '';
            // Visibility is engine-coordinated: by default the preview is only shown
            // while it is the single active stream; while several streams are active
            // all previews stay hidden. With 'Stream All Concurrent Responses' enabled
            // every active stream's preview is shown at once.
            _previewCoord._registerStreamPreview(_previewSlot);
        };
        var updateTokenProgress = function (tokens, streamContent, streamReasoning) {
            if (tokens == null || tokenProgressPre == null || tokenProgressPre.style.display === 'none') return;
            if (tokens !== _tokenProgressLast) {
                _tokenProgressLast = tokens;
                tokenProgressNode.nodeValue = String(tokens);
            }
            // Text is updated even while this preview is hidden (other streams still
            // active): it must be current once they finish and this becomes the only
            // active stream whose preview is shown again.
            if (streamTextPre && streamTextNode && (streamContent || streamReasoning)) {
                streamTextNode.nodeValue = '\n' + (streamReasoning ? streamReasoning + '\n' : '') + (streamContent || '');
            }
        };
        var hideTokenProgress = function () {
            if (tokenProgressPre) tokenProgressPre.style.display = 'none';
            // Releases this stream's preview; if exactly one active stream remains,
            // its preview becomes visible again.
            _previewCoord._unregisterStreamPreview(_previewSlot);
        };
        const updateTranslatedCount = (count, indices = null) => {
            // If specific indices are provided, only count new ones
            if (indices) {
                let newCount = 0;
                for (const index of indices) {
                    if (!countedIndices.has(index)) {
                        countedIndices.add(index);
                        newCount++;
                    }
                }
                translatedCount += newCount;
            } else {
                // Fallback to old behavior if no indices provided
                translatedCount += count;
            }
            
            if (translationProgress) {
                translationProgress.nodeValue = translatedCount.toString();
            }
            if (options && options.progress) {
                options.progress(Math.round((100 * translatedCount) / toTranslate.length));
            }
        };

        const updateBatchProgressCount = (count) => {
            batchProgressCount += count;
            if (batchProgress) {
                batchProgress.nodeValue = ' (' + 'Accepted Translations: ' + batchProgressCount.toString() + ')';
            }
        };

        const updateBatchFailCount = (count) => {
            batchFailCount += count;
            dslrStats.individualRetries += count;
            if (batchFails) {
                batchFails.nodeValue = ' (' + 'Rejected Translations: ' + batchFailCount.toString() + ')';
            }
        };

        const updateFullBatchFailCount = (count) => {
            fullBatchFailCount += count;
            if (fullBatchFails) {
                fullBatchFails.nodeValue = ' (' + 'Rejected Batches: ' + fullBatchFailCount.toString() + ')';
            }
        };

        const updateServerIssueCount = (count) => {
            serverIssueCount += count;
            if (serverIssues) {
                serverIssues.nodeValue = ' (' + 'Server issues: ' + serverIssueCount.toString() + ')';
            }
        };

        const updateErrorCount = (count) => {
            errorCount += count;
            if (errorProgress) {
                errorProgress.nodeValue = ' (' + errorCount.toString() + ' failed translations)';
            }
        };

        // Recorders for the per-chunk quality/reliability statistics (see dslrStats above).
        const recordBatchSplit = () => { dslrStats.batchesSplit++; };
        const recordFallbackHandover = () => { dslrStats.fallbackHandovers++; };
        const recordBatchCorrectionRetry = () => { dslrStats.batchCorrectionRetries++; };
        const recordRateLimitRetry = () => { dslrStats.rateLimitRetries++; };

        function compareColorCommands(str1, str2) {
            // Get all \C[] commands from original (case-insensitive)
            const originalCommands = (str1.match(/\\+c\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());
            const outputCommands = (str2.match(/\\+c\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());

            // Check for any naked references (numbers in brackets without \C)
            const nakedRefs = originalCommands.some(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.includes(`[${num}]`) && !outputCommands.includes(cmd);
            });

            // Check for completely missing commands (no \c[] exists at all in str2)
            const missingCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+c\\[${num}\\]`, 'i')) === null;
            });

            // Check for modified commands (command exists but format changed, e.g., \I[2] vs \i[2])
            const modifiedCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+c\\[${num}\\]`, 'i')) !== null && 
                       !outputCommands.includes(cmd);
            });

            // Count occurrences of each command in original and output
            const countOccurrences = (arr) => {
                return arr.reduce((counts, cmd) => {
                    counts[cmd] = (counts[cmd] || 0) + 1;
                    return counts;
                }, {});
            };
            
            const originalCounts = countOccurrences(originalCommands);
            const outputCounts = countOccurrences(outputCommands);
            
            // Find commands that appear more times in output than in original
            const extraCommands = [];
            for (const cmd in outputCounts) {
                if (!originalCounts[cmd] || outputCounts[cmd] > originalCounts[cmd]) {
                    // Add the command as many times as it exceeds the original count
                    const excessCount = outputCounts[cmd] - (originalCounts[cmd] || 0);
                    for (let i = 0; i < excessCount; i++) {
                        extraCommands.push(cmd);
                    }
                }
            }

            const isMatch = missingCommands.length === 0 &&
                extraCommands.length === 0 &&
                !nakedRefs &&
                modifiedCommands.length === 0;

            return {
                isMatch: isMatch,
                differences: {
                    missingInSecondString: [...new Set(missingCommands)],
                    extraInSecondString: [...new Set(extraCommands)],
                    nakedReferences: nakedRefs ? ["Color commands transformed into naked references"] : [],
                    modifiedCommands: [...new Set(modifiedCommands)]
                }
            };
        }

        function comparePlaceholders(str1, str2) {
            // Get all @ placeholders from original
            const originalPlaceholders = (str1.match(/@\d+/g) || []);
            const outputPlaceholders = (str2.match(/@\d+/g) || []);

            const missingPlaceholders = originalPlaceholders.filter(ph => {
                const num = ph.match(/\d+/)[0];
                return str2.match(new RegExp(`@${num}(?!\\d)`)) === null;
            });

            // Count occurrences of each placeholder in original and output
            const countOccurrences = (arr) => {
                return arr.reduce((counts, ph) => {
                    counts[ph] = (counts[ph] || 0) + 1;
                    return counts;
                }, {});
            };
            
            const originalCounts = countOccurrences(originalPlaceholders);
            const outputCounts = countOccurrences(outputPlaceholders);
            
            // Find placeholders that appear more times in output than in original
            const extraPlaceholders = [];
            for (const ph in outputCounts) {
                if (!originalCounts[ph] || outputCounts[ph] > originalCounts[ph]) {
                    // Add the placeholder as many times as it exceeds the original count
                    const excessCount = outputCounts[ph] - (originalCounts[ph] || 0);
                    for (let i = 0; i < excessCount; i++) {
                        extraPlaceholders.push(ph);
                    }
                }
            }
            
            // Now it's only a match if there are no missing and no extra (including duplicates)
            const isMatch = missingPlaceholders.length === 0 && extraPlaceholders.length === 0;

            return {
                isMatch: isMatch,
                differences: {
                    missingInSecondString: [...new Set(missingPlaceholders)],
                    extraInSecondString: [...new Set(extraPlaceholders)]
                }
            };
        }
        let isMatch = false;

        function compareVariableCommands(str1, str2) {
            // Get all \V[] commands from original (case-insensitive)
            const originalCommands = (str1.match(/\\+v\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());
            const outputCommands = (str2.match(/\\+v\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());

            // Check for any naked references (numbers in brackets without \V)
            const nakedRefs = originalCommands.some(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.includes(`[${num}]`) && !outputCommands.includes(cmd);
            });

            // Check for completely missing commands (no \v[] exists at all in str2)
            const missingCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+v\\[${num}\\]`, 'i')) === null;
            });

            // Check for modified commands (command exists but format changed, e.g., \I[2] vs \i[2])
            const modifiedCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+v\\[${num}\\]`, 'i')) !== null && 
                       !outputCommands.includes(cmd);
            });

            // Count occurrences of each command in original and output
            const countOccurrences = (arr) => {
                return arr.reduce((counts, cmd) => {
                    counts[cmd] = (counts[cmd] || 0) + 1;
                    return counts;
                }, {});
            };
            
            const originalCounts = countOccurrences(originalCommands);
            const outputCounts = countOccurrences(outputCommands);
            
            // Find commands that appear more times in output than in original
            const extraCommands = [];
            for (const cmd in outputCounts) {
                if (!originalCounts[cmd] || outputCounts[cmd] > originalCounts[cmd]) {
                    // Add the command as many times as it exceeds the original count
                    const excessCount = outputCounts[cmd] - (originalCounts[cmd] || 0);
                    for (let i = 0; i < excessCount; i++) {
                        extraCommands.push(cmd);
                    }
                }
            }

            const isMatch = missingCommands.length === 0 &&
                extraCommands.length === 0 &&
                !nakedRefs &&
                modifiedCommands.length === 0;

            return {
                isMatch: isMatch,
                differences: {
                    missingInSecondString: [...new Set(missingCommands)],
                    extraInSecondString: [...new Set(extraCommands)],
                    nakedReferences: nakedRefs ? ["Variable commands transformed into naked references"] : [],
                    modifiedCommands: [...new Set(modifiedCommands)]
                }
            };
        }
        const characterGenders = JSON.parse(this.optionCharacterGenders.getValue() || '{}');
        function compareNameCommandsWithGender(str1, str2) {
            // Get all \N[] commands from original (case-insensitive)
            const originalCommands = (str1.match(/\\+n\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());
            const outputCommands = (str2.match(/\\+n\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());

            // Check for any naked references (numbers in brackets without \N)
            const nakedRefs = originalCommands.some(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.includes(`[${num}]`) && !outputCommands.includes(cmd);
            });

            // Check for modified commands (command exists but format changed)
            const modifiedCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+n\\[${num}\\]`, 'i')) !== null && 
                       !outputCommands.includes(cmd);
            });

            // Count occurrences of each command in original and output
            const countOccurrences = (arr) => {
                return arr.reduce((counts, cmd) => {
                    counts[cmd] = (counts[cmd] || 0) + 1;
                    return counts;
                }, {});
            };
            
            const originalCounts = countOccurrences(originalCommands);
            const outputCounts = countOccurrences(outputCommands);
            
            // Find commands that appear more times in output than in original
            const extraCommands = [];
            for (const cmd in outputCounts) {
                if (!originalCounts[cmd] || outputCounts[cmd] > originalCounts[cmd]) {
                    // Add the command as many times as it exceeds the original count
                    const excessCount = outputCounts[cmd] - (originalCounts[cmd] || 0);
                    for (let i = 0; i < excessCount; i++) {
                        extraCommands.push(cmd);
                    }
                }
            }

            // NEW: Gender-aware validation
            // Pronoun patterns for different genders
            const femalePronouns = /(?<=[^a-z]|^)(she|her|hers|herself)(?=[^a-z]|$)/gmi;
            const malePronouns = /(?<=[^a-z]|^)(he|him|his|himself)(?=[^a-z]|$)/gmi;
            
            // Get unique character IDs from original
            const originalIds = [...new Set(originalCommands.map(cmd => cmd.match(/\d+/)[0]))];
            
            // Check if each character ID is referenced in the output
            const missingCharacters = originalIds.filter(id => {
                const gender = characterGenders[id];
                // If \N[id] exists, it's fine regardless of pronouns
                if (str2.match(new RegExp(`\\\\n\\[${id}\\]`, 'i')) !== null) {
                    return false; // Command exists, character is referenced
                }
                
                // CHANGED: If gender is unknown or undefined, DO NOT accept pronoun replacement
                // Require the \N[id] command to be present
                if (gender === 'unknown' || gender === undefined) {
                    return true; // Character is missing - pronoun replacement not allowed without gender
                }
                
                let pronounPattern = "";
                if (gender === 'female') {
                    pronounPattern = /(?<=[^a-z]|^)(she|her|hers|herself)(?=[^a-z]|$)/gmi;
                } else if (gender === 'male') {
                    pronounPattern = /(?<=[^a-z]|^)(he|him|his|himself)(?=[^a-z]|$)/gmi;
                } else {
                    return true;
                }
                // If no \N[id] but has matching pronouns — valid replacement!
                if (str2.match(pronounPattern) != null) {
                    console.log("[DSLR] Compare function accepted a pronoun substitute for Name Placeholder.")
                    return false; // Pronoun used properly for gendered character
                }
                // Otherwise, missing reference
                return true;
            });

            const isMatch = missingCharacters.length === 0 &&
                extraCommands.length === 0 &&
                !nakedRefs &&
                modifiedCommands.length === 0;

            return {
                isMatch: isMatch,
                differences: {
                    missingInSecondString: [...new Set(missingCharacters.map(id => `\\N[${id}]`))],
                    extraInSecondString: [...new Set(extraCommands)],
                    nakedReferences: nakedRefs ? ["Name commands transformed into naked references"] : [],
                    modifiedCommands: [...new Set(modifiedCommands)]
                }
            };
        }


        function compareNameCommandsW(str1, str2) {
            // Get all \NW[] commands from original (case-insensitive)
            const originalCommands = (str1.match(/\\+nw\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());
            const outputCommands = (str2.match(/\\+nw\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());

            // Check for any naked references (numbers in brackets without \NW)
            const nakedRefs = originalCommands.some(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.includes(`[${num}]`) && !outputCommands.includes(cmd);
            });

            // Check for completely missing commands (no \nw[] exists at all in str2)
            const missingCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+nw\\[${num}\\]`, 'i')) === null;
            });

            // Check for modified commands (command exists but format changed, e.g., \I[2] vs \i[2])
            const modifiedCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+nw\\[${num}\\]`, 'i')) !== null && 
                       !outputCommands.includes(cmd);
            });

            // Count occurrences of each command in original and output
            const countOccurrences = (arr) => {
                return arr.reduce((counts, cmd) => {
                    counts[cmd] = (counts[cmd] || 0) + 1;
                    return counts;
                }, {});
            };
            
            const originalCounts = countOccurrences(originalCommands);
            const outputCounts = countOccurrences(outputCommands);
            
            // Find commands that appear more times in output than in original
            const extraCommands = [];
            for (const cmd in outputCounts) {
                if (!originalCounts[cmd] || outputCounts[cmd] > originalCounts[cmd]) {
                    // Add the command as many times as it exceeds the original count
                    const excessCount = outputCounts[cmd] - (originalCounts[cmd] || 0);
                    for (let i = 0; i < excessCount; i++) {
                        extraCommands.push(cmd);
                    }
                }
            }

            const isMatch = missingCommands.length === 0 &&
                extraCommands.length === 0 &&
                !nakedRefs &&
                modifiedCommands.length === 0;

            return {
                isMatch: isMatch,
                differences: {
                    missingInSecondString: [...new Set(missingCommands)],
                    extraInSecondString: [...new Set(extraCommands)],
                    nakedReferences: nakedRefs ? ["Name commands transformed into naked references"] : [],
                    modifiedCommands: [...new Set(modifiedCommands)]
                }
            };
        }

        function compareItemCommands(str1, str2) {
            // Get all \I[] commands from original (case-insensitive)
            const originalCommands = (str1.match(/\\+i\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());
            const outputCommands = (str2.match(/\\+i\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());

            // Check for any naked references (numbers in brackets without \I)
            const nakedRefs = originalCommands.some(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.includes(`[${num}]`) && !outputCommands.includes(cmd);
            });

            // Check for completely missing commands (no \i[] exists at all in str2)
            const missingCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+i\\[${num}\\]`, 'i')) === null;
            });

            // Check for modified commands (command exists but format changed, e.g., \I[2] vs \i[2])
            const modifiedCommands = originalCommands.filter(cmd => {
                const num = cmd.match(/\d+/)[0];
                return str2.match(new RegExp(`\\\\+i\\[${num}\\]`, 'i')) !== null && 
                       !outputCommands.includes(cmd);
            });

            // Count occurrences of each command in original and output
            const countOccurrences = (arr) => {
                return arr.reduce((counts, cmd) => {
                    counts[cmd] = (counts[cmd] || 0) + 1;
                    return counts;
                }, {});
            };
            
            const originalCounts = countOccurrences(originalCommands);
            const outputCounts = countOccurrences(outputCommands);
            
            // Find commands that appear more times in output than in original
            const extraCommands = [];
            for (const cmd in outputCounts) {
                if (!originalCounts[cmd] || outputCounts[cmd] > originalCounts[cmd]) {
                    // Add the command as many times as it exceeds the original count
                    const excessCount = outputCounts[cmd] - (originalCounts[cmd] || 0);
                    for (let i = 0; i < excessCount; i++) {
                        extraCommands.push(cmd);
                    }
                }
            }

            const isMatch = missingCommands.length === 0 &&
                extraCommands.length === 0 &&
                !nakedRefs &&
                modifiedCommands.length === 0;

            return {
                isMatch: isMatch,
                differences: {
                    missingInSecondString: [...new Set(missingCommands)],
                    extraInSecondString: [...new Set(extraCommands)],
                    nakedReferences: nakedRefs ? ["Item commands transformed into naked references"] : [],
                    modifiedCommands: [...new Set(modifiedCommands)]
                }
            };
        }

        function validateJSONTranslationComprehensive(
            originalJson,
            translatedJson,
            llmToUse,
            comrep1, comrep2, comrep3, comrep4, comrep5, comrep6,
            com2rep1, com2rep2, com2rep3, com2rep4, com2rep5, com2rep6,
            options = {}
        ) {
            const {
                minPreservation = 80,
                maxExtra = 10,
                maxQuoteIssues = 10,
                allowNakedRefs = false,
                checkContentPlacement = true,
                strictPlacement = true,
                // Per-line content/formatting checks (ported from the line-by-line
                // rejection heuristics) so issues like content being shifted between
                // text boxes are caught at batch level, where the correction can
                // address all affected boxes together instead of one box at a time.
                enablePerLineChecks = true,
                japaneseSource = false,
                rejectJapaneseModel1 = true,
                rejectJapaneseModel2 = true,
                maxJapaneseIssuePercent = 10,
                maxJapaneseIssueAbsolute = 3
            } = options;

            const startTime = Date.now();
            const TIMEOUT_MS = 300000; // 5 minutes

            // Check timeout and throw error to stop execution
            const checkTimeout = () => {
                if (Date.now() - startTime > TIMEOUT_MS) {
                    const error = new Error("Comprehensive validation timeout (5 minutes)");
                    error.isTimeout = true;
                    error.result = {
                        passed: false,
                        needsCorrection: true,
                        structuralIssues: {
                            missingIds: [],
                            extraIds: [],
                            duplicateIds: [],
                            untranslatedIds: [],
                            orderChanged: false
                        },
                        commandIssues: {
                            missingCommandsById: {},
                            extraCommandsById: {},
                            nakedReferences: [], // Store specific naked references found
                            hasNakedRefs: false,
                            preservationPercent: 0,
                            excessPercent: 0
                        },
                        stats: {
                            totalOriginalIds: 0,
                            totalTranslatedIds: 0,
                            commonIds: 0,
                            totalOriginalCommands: 0,
                            totalTranslatedCommands: 0,
                            preservedCommands: 0
                        },
                        correctionRequest: "Validation timeout after 5 minutes",
                        reasons: "Validation timeout"
                    };
                    throw error;
                }
            };

            // Parse JSON if needed
            let originalData, translatedData;
            try {
                checkTimeout();
                originalData = typeof originalJson === 'string' ? JSON.parse(originalJson) : originalJson;
                translatedData = typeof translatedJson === 'string' ? JSON.parse(translatedJson) : translatedJson;
            } catch (parseError) {
                return {
                    passed: false,
                    needsCorrection: true,
                    structuralIssues: {
                        missingIds: [],
                        extraIds: [],
                        duplicateIds: [],
                        untranslatedIds: [],
                        orderChanged: false,
                        parseError: parseError.message
                    },
                    commandIssues: {
                        missingCommandsById: {},
                        extraCommandsById: {},
                        nakedReferences: [], // Store specific naked references found
                        hasNakedRefs: false,
                        preservationPercent: 0,
                        excessPercent: 0
                    },
                    stats: {
                        totalOriginalIds: 0,
                        totalTranslatedIds: 0,
                        commonIds: 0,
                        totalOriginalCommands: 0,
                        totalTranslatedCommands: 0,
                        preservedCommands: 0
                    },
                    correctionRequest: `Invalid JSON format. Please ensure both inputs are valid JSON strings. Error: ${parseError.message}`,
                    reasons: "Invalid JSON format"
                };
            }

            // OPTIMIZATION: Early exit for identical data
            checkTimeout();
            if (JSON.stringify(originalData) === JSON.stringify(translatedData)) {
                return {
                    passed: true,
                    needsCorrection: false,
                    structuralIssues: {
                        missingIds: [],
                        extraIds: [],
                        duplicateIds: [],
                        untranslatedIds: [],
                        orderChanged: false
                    },
                    commandIssues: {
                        missingCommandsById: {},
                        extraCommandsById: {},
                        nakedReferences: [], // Store specific naked references found
                        hasNakedRefs: false,
                        preservationPercent: 100,
                        excessPercent: 0
                    },
                    perLineIssues: {
                        perLineIssuesById: {},
                        perLineIssueGroups: {},
                        hasPerLineIssues: false
                    },
                    stats: {
                        totalOriginalIds: 0,
                        totalTranslatedIds: 0,
                        commonIds: 0,
                        totalOriginalCommands: 0,
                        totalTranslatedCommands: 0,
                        preservedCommands: 0
                    },
                    correctionRequest: null,
                    reasons: "Data is identical"
                };
            }

            try {
                // Extract translations arrays
                checkTimeout();
                const originalTranslations = originalData.translations || [];
                const translatedTranslations = translatedData.translations || [];

                // Extract IDs from original and translated
                checkTimeout();
                const originalIds = originalTranslations.map(item => item.id).sort((a, b) => a - b);
                const translatedIds = translatedTranslations.map(item => item.id).sort((a, b) => a - b);

                // OPTIMIZATION: Use Set for O(1) lookups
                checkTimeout();
                const translatedIdSet = new Set(translatedIds);
                const originalIdSet = new Set(originalIds);

                // ========================================
                // PHASE 1: Structural Issues Check
                // ========================================

                // Find missing IDs (present in original but not in translated)
                checkTimeout();
                const missingIds = originalIds.filter(id => {
                    checkTimeout();
                    return !translatedIdSet.has(id);
                });

                // Find extra IDs (present in translated but not in original)
                checkTimeout();
                const extraIds = translatedIds.filter(id => {
                    checkTimeout();
                    return !originalIdSet.has(id);
                });

                // Find duplicate IDs (same id emitted more than once — a
                // truncated stub plus the real entry, for example). The
                // set-based extra/missing checks cannot see these (a duplicated
                // id is a member of the original set), so count them here and
                // name them as the actual defect — otherwise the duplicate's
                // own defects (order shift, missing quotes on a stub) are
                // reported as if they belonged to the real entry.
                checkTimeout();
                const duplicateIds = ResponsesApiHelpers_1.findDuplicateIds(translatedTranslations);

                // Find untranslated IDs (present in both but missing translation)
                checkTimeout();
                const untranslatedIds = [];
                for (const item of translatedTranslations) {
                    checkTimeout();
                    if (item.id !== undefined && item.translated === undefined) {
                        untranslatedIds.push(item.id);
                    }
                }

                // Check if order is preserved - only for IDs that exist in both arrays
                checkTimeout();
                let isOrderSame = true;

                if (missingIds.length === 0 && extraIds.length === 0) {
                    const originalOrder = originalTranslations.map(item => item.id);
                    const translatedOrder = translatedTranslations.map(item => item.id);
                    isOrderSame = JSON.stringify(originalOrder) === JSON.stringify(translatedOrder);
                } else {
                    const commonOriginalIds = originalTranslations
                        .filter(item => translatedIdSet.has(item.id))
                        .map(item => item.id);

                    const commonTranslatedIds = translatedTranslations
                        .filter(item => originalIdSet.has(item.id))
                        .map(item => item.id);

                    isOrderSame = JSON.stringify(commonOriginalIds) === JSON.stringify(commonTranslatedIds);
                }

                // ========================================
                // PHASE 2: Command Issues Check (Only for Common IDs)
                // ========================================

                // Helper function to extract commands from a string
                const extractCommands = (str) => {
                    const commands = [
                        ...(str.match(/\\+[nciv]w?\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase()),
                        ...(str.match(/@\d+/g) || [])
                    ];
                    return commands;
                };

                const extractQuotedPhrases = (str) => {
                    const results = [];
                    // Split on the " character itself, regardless of preceding backslashes.
                    // Odd-indexed segments are between quotes.
                    // Handles: "text", \"text\", \\"text\\", etc.
                    const parts = str.split('"');
                    for (let i = 1; i < parts.length - 1; i += 2) {
                        const content = parts[i];
                        if (content.length > 0) {
                            results.push({
                                original: `"${content}"`,
                                content: content
                            });
                        }
                    }
                    return results;
                };

                // Helper function to apply command replacements
                const applyCommandReplacements = (cmd, llmModel, replacements) => {
                    let result = cmd;

                    if (llmModel === "model1") {
                        if (replacements.comrep1 && replacements.comrep1 !== "") {
                            result = result.replaceAll(/\\n\[(\d+)\]/gi, replacements.comrep1);
                        }
                        if (replacements.comrep2 && replacements.comrep2 !== "") {
                            result = result.replaceAll(/\\nw\[(\d+)\]/gi, replacements.comrep2);
                        }
                        if (replacements.comrep3 && replacements.comrep3 !== "") {
                            result = result.replaceAll(/\\v\[(\d+)\]/gi, replacements.comrep3);
                        }
                        if (replacements.comrep4 && replacements.comrep4 !== "") {
                            result = result.replaceAll(/\\i\[(\d+)\]/gi, replacements.comrep4);
                        }
                        if (replacements.comrep5 && replacements.comrep5 !== "") {
                            result = result.replaceAll(/\\c\[(\d+)\]/gi, replacements.comrep5);
                        }
                        if (replacements.comrep6 && replacements.comrep6 !== "") {
                            result = result.replaceAll(/@(\d+)/gi, replacements.comrep6);
                        }
                    } else if (llmModel === "model2") {
                        if (replacements.com2rep1 && replacements.com2rep1 !== "") {
                            result = result.replaceAll(/\\n\[(\d+)\]/gi, replacements.com2rep1);
                        }
                        if (replacements.com2rep2 && replacements.com2rep2 !== "") {
                            result = result.replaceAll(/\\nw\[(\d+)\]/gi, replacements.com2rep2);
                        }
                        if (replacements.com2rep3 && replacements.com2rep3 !== "") {
                            result = result.replaceAll(/\\v\[(\d+)\]/gi, replacements.com2rep3);
                        }
                        if (replacements.com2rep4 && replacements.com2rep4 !== "") {
                            result = result.replaceAll(/\\i\[(\d+)\]/gi, replacements.com2rep4);
                        }
                        if (replacements.com2rep5 && replacements.com2rep5 !== "") {
                            result = result.replaceAll(/\\c\[(\d+)\]/gi, replacements.com2rep5);
                        }
                        if (replacements.com2rep6 && replacements.com2rep6 !== "") {
                            result = result.replaceAll(/(@\d+)/gi, replacements.com2rep6);
                        }
                    }

                    return result;
                };

                // Extract all commands from original and translated data
                checkTimeout();
                let originalCommands = [];
                let translatedCommands = [];

                // Process original data
                if (originalData.translations && Array.isArray(originalData.translations)) {
                    for (const item of originalData.translations) {
                        if (item.original) {
                            originalCommands = [...originalCommands, ...extractCommands(item.original)];
                        }
                    }
                }

                // Process translated data
                if (translatedData.translations && Array.isArray(translatedData.translations)) {
                    for (const item of translatedData.translations) {
                        if (item.translated) {
                            translatedCommands = [...translatedCommands, ...extractCommands(item.translated)];
                        }
                    }
                }

                // Build ID to commands maps for original and translated
                checkTimeout();
                const originalIdCommands = {};
                const translatedIdCommands = {};

                // Build original ID to commands map
                for (const item of originalData.translations) {
                    if (item.id !== undefined && item.original) {
                        originalIdCommands[item.id] = extractCommands(item.original);
                    }
                }

                // Build translated ID to commands map (only for IDs with translations)
                for (const item of translatedData.translations) {
                    if (item.id !== undefined && item.translated) {
                        translatedIdCommands[item.id] = new Set(extractCommands(item.translated));
                    }
                }

                // Find common IDs (exist in both and have translations)
                checkTimeout();
                const commonIds = originalIds.filter(id =>
                    translatedIdSet.has(id) &&
                    translatedIdCommands[id] !== undefined
                );

                // Find missing commands per ID (ONLY for common IDs)
                checkTimeout();
                const missingCommandsById = {};

                for (const id of commonIds) {
                    checkTimeout();

                    const originalCmds = originalIdCommands[id] || [];
                    const translatedCmdSet = translatedIdCommands[id] || new Set();

                    for (const cmd of originalCmds) {
                        checkTimeout();
                        if (!translatedCmdSet.has(cmd)) {
                            if (!missingCommandsById[id]) {
                                missingCommandsById[id] = [];
                            }

                            // Apply command replacements for the error message
                            let displayCmd = cmd;
                            if (cmd.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                                displayCmd = applyCommandReplacements(cmd, llmToUse, {
                                    comrep1, comrep2, comrep3, comrep4, comrep5, comrep6,
                                    com2rep1, com2rep2, com2rep3, com2rep4, com2rep5, com2rep6
                                });
                            }

                            missingCommandsById[id].push(displayCmd);
                        }
                    }
                }

                // Find extra commands per ID
                checkTimeout();
                const extraCommandsById = {};

                for (const item of translatedData.translations) {
                    if (item.id !== undefined && item.translated && originalIdCommands[item.id] !== undefined) {
                        const translatedCmds = extractCommands(item.translated);
                        const originalCmds = originalIdCommands[item.id] || [];
                        
                        for (const cmd of translatedCmds) {
                            if (!originalCmds.includes(cmd)) {
                                if (!extraCommandsById[item.id]) {
                                    extraCommandsById[item.id] = [];
                                }
                                
                                // Apply command replacements for the error message
                                let displayCmd = cmd;
                                if (cmd.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                                    displayCmd = applyCommandReplacements(cmd, llmToUse, {
                                        comrep1, comrep2, comrep3, comrep4, comrep5, comrep6,
                                        com2rep1, com2rep2, com2rep3, com2rep4, com2rep5, com2rep6
                                    });
                                }
                                
                                extraCommandsById[item.id].push(displayCmd);
                            }
                        }
                    }
                }

                // Define translatedCommandSet BEFORE using it
                checkTimeout();
                const translatedCommandSet = new Set(translatedCommands);

                // IMPROVED: Check for naked references with more specific patterns
                checkTimeout();
                const nakedReferences = [];
                let hasNakedRefs = false;
                
                if (!allowNakedRefs) {
                    // Check for obvious formatting errors in commands
                    for (const item of translatedData.translations) {
                        if (item.id !== undefined && item.translated) {
                            // Pattern 1: Commands with spaces (e.g., "\N [1]" instead of "\N[1]")
                            const spacedCommands = item.translated.match(/\\[nciv]w?\s+\[\d+\]/gi) || [];
                            for (const cmd of spacedCommands) {
                                nakedReferences.push({
                                    id: item.id,
                                    issue: `Incorrect spacing in command: "${cmd}" (should be "${cmd.replace(/\s+/, '')}")`
                                });
                            }
                            
                            // Pattern 2: Brackets without backslash (e.g., "N[1]" instead of "\N[1]")
                            const bracketRefs = item.translated.match(/(?<!\\)[nciv]w?\[\d+\]/gi) || [];
                            for (const ref of bracketRefs) {
                                nakedReferences.push({
                                    id: item.id,
                                    issue: `Missing backslash in command: "${ref}" (should be "\\${ref}")`
                                });
                            }
                            
                            // Pattern 3: Numbers in brackets without command prefix (only if they appear in original with commands)
                            const originalItem = originalTranslations.find(orig => orig.id === item.id);
                            if (originalItem && originalItem.original) {
                                const originalCmds = extractCommands(originalItem.original);
                                if (originalCmds.length > 0) {
                                    const nakedNumbers = item.translated.match(/(?<!\\[nciv]w?)\[\d+\]/gi) || [];
                                    for (const num of nakedNumbers) {
                                        // Only report if the number appears in original commands
                                        const numValue = num.match(/\d+/)[0];
                                        const hasMatchingOriginal = originalCmds.some(cmd => cmd.includes(`[${numValue}]`));
                                        if (hasMatchingOriginal) {
                                            nakedReferences.push({
                                                id: item.id,
                                                issue: `Naked reference: "${num}" (should have command prefix)`
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    hasNakedRefs = nakedReferences.length > 0;
                }

                // Check for missing quotes in translated text
                checkTimeout();
                const missingQuotesById = {};

                for (const item of translatedData.translations) {
                    if (item.id !== undefined && item.translated) {
                        const originalItem = originalTranslations.find(orig => orig.id === item.id);
                        
                        if (originalItem && originalItem.original) {
                            const originalQuotes = extractQuotedPhrases(originalItem.original);
                            
                            if (originalQuotes.length > 0) {
                                const translatedQuotes = extractQuotedPhrases(item.translated);
                                
                                // Count-based comparison: if the translation has fewer
                                // double-quoted phrases than the original, some quotes were
                                // lost or replaced (e.g. "..." → '...')
                                if (translatedQuotes.length < originalQuotes.length) {
                                    if (!missingQuotesById[item.id]) {
                                        missingQuotesById[item.id] = [];
                                    }
                                    
                                    const missingCount = originalQuotes.length - translatedQuotes.length;
                                    const originalPhraseList = originalQuotes
                                        .map(q => `"${q.content}"`)
                                        .join(', ');
                                    
                                    missingQuotesById[item.id].push({
                                        content: originalPhraseList,
                                        expected: `${originalQuotes.length} double-quoted phrase(s): ${originalPhraseList}`,
                                        found: translatedQuotes.length === 0 
                                            ? 'no double quotes in translation (may have been replaced with single quotes)'
                                            : `only ${translatedQuotes.length} double-quoted phrase(s), expected ${originalQuotes.length}`
                                    });
                                }
                            }
                        }
                    }
                }
                const hasMissingQuotes = Object.keys(missingQuotesById).length > 0;
                const quoteIssueCount = Object.keys(missingQuotesById).length;
                const quoteIssuePercent = translatedTranslations.length > 0
                    ? (quoteIssueCount / translatedTranslations.length) * 100
                    : 0;
                const hasTooManyQuoteIssues = quoteIssuePercent > maxQuoteIssues;
                // Calculate preservation and excess
                checkTimeout();
                const preservedCommands = originalCommands.filter(cmd =>
                    translatedCommandSet.has(cmd)
                );

                let preservationPercent = 0;
                let excessPercent = 0;

                if (originalCommands.length > 0) {
                    preservationPercent = (preservedCommands.length / originalCommands.length) * 100;

                    // Count occurrences to find extra commands
                    const countOccurrences = (arr) => {
                        const counts = new Map();
                        for (const cmd of arr) {
                            counts.set(cmd, (counts.get(cmd) || 0) + 1);
                        }
                        return counts;
                    };

                    const originalCounts = countOccurrences(originalCommands);
                    const translatedCounts = countOccurrences(translatedCommands);

                    const extraCommands = [];
                    for (const [cmd, translatedCount] of translatedCounts.entries()) {
                        const originalCount = originalCounts.get(cmd) || 0;
                        if (translatedCount > originalCount) {
                            const excessCount = translatedCount - originalCount;
                            for (let i = 0; i < excessCount; i++) {
                                checkTimeout();
                                extraCommands.push(cmd);
                            }
                        }
                    }

                    excessPercent = (extraCommands.length / originalCommands.length) * 100;
                } else {
                    // No original commands - check if there are too many extras
                    const maxAllowedExtra = Math.max(5, maxExtra);
                    if (translatedCommands.length > maxAllowedExtra) {
                        excessPercent = (translatedCommands.length / Math.max(1, originalCommands.length)) * 100;
                    }
                }

                // ========================================
                // PHASE 2.5: Per-line content & formatting checks
                // ========================================
                // These mirror the line-by-line rejection heuristics that previously
                // only ran AFTER a batch was already approved. Catching them here means
                // the whole batch can be corrected in one request. This is especially
                // important for "content shifting": when an LLM moves text from one box
                // to another, the per-box line/character counts diverge. Detecting that
                // at batch level lets the correction request name every affected box
                // together instead of silently producing broken scenes.
                checkTimeout();
                const perLineIssuesById = {};
                const perLineIssueGroups = {
                    japanese: [],
                    multilineShort: [],
                    tooManyChars: [],
                    tooFewChars: [],
                    weirdNumbers: [],
                    repeatedNumbers: [],
                    tooManyLines: [],
                    tooFewLines: [],
                    missingEscapeGt: [],
                    missingEscapeLt: [],
                    missingAngleCommand: []
                };
                let hasPerLineIssues = false;
                let hasOtherPerLineIssues = false;
                let hasJapaneseIssues = false;
                let hasTooManyJapaneseIssues = false;
                let japaneseIssueCount = 0;
                let japaneseIssuePercent = 0;

                if (enablePerLineChecks) {
                    const rejectJapaneseActive = japaneseSource && (
                        (llmToUse === "model1" && rejectJapaneseModel1) ||
                        (llmToUse === "model2" && rejectJapaneseModel2)
                    );

                    // Normalization that mirrors the line-by-line response cleanup so the
                    // comparisons here behave the same as the later per-line checks.
                    const normalizeForLineCheck = (orig, trans) => {
                        let t = trans;
                        try {
                            if (orig.match(/\n[\r 　]*\n/g) == null) {
                                t = t.replaceAll(/\n[\r 　]*\n/g, "");
                            }
                            // Convert stray literal "\n" (backslash-n that is NOT part of a
                            // \n[...] command) into real newlines, the way the LLM cleanup does.
                            if (orig.match(/\\+n(?!\[)/gi) == null) {
                                t = t.replaceAll(/\\+n(?!\[)/gi, "\n");
                            }
                            if (orig.match(/\\"/g) == null) {
                                t = t.replaceAll(/\\"/g, '"');
                            }
                            if (orig.match(/\\'/g) == null) {
                                t = t.replaceAll(/\\'/g, "'");
                            }
                            if (t.match(/\\[\[\{\(\]\}\)]/gi) != null && orig.match(/\\[\[\{\(\]\}\)]/gi) == null) {
                                t = t.replaceAll(/\\([\[\{\(\]\}\)])/g, "$1");
                            }
                            t = t.replaceAll(/[\s+　]+$/g, "");
                        } catch (e) {
                            return trans;
                        }
                        return t;
                    };

                    const trimLineBreaks = (s) => (s || "").replaceAll(/^[\n\r]+/g, "").replaceAll(/[\n\r]+$/g, "");

                    for (const item of translatedData.translations) {
                        checkTimeout();
                        if (item.id === undefined || !item.translated) continue;
                        const originalItem = originalTranslations.find(o => o.id === item.id);
                        if (!originalItem || !originalItem.original) continue;

                        const origRaw = originalItem.original;
                        const transRaw = item.translated;

                        // Priority 1 (highest): leftover Japanese characters.
                        if (rejectJapaneseActive) {
                            const transNoMarker = transRaw.match(/JPCHARDRAWING/g) != null
                                ? transRaw.replaceAll(/ *JPCHARDRAWING */g, "")
                                : transRaw;
                            if (transNoMarker.match(/[一-龠ぁ-ゔァ-ヴ々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null) {
                                let leftover = transNoMarker.match(/[一-龠ぁ-ゔァ-ヴ々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+/g);
                                if (Array.isArray(leftover)) {
                                    leftover = leftover.join(', ');
                                } else {
                                    leftover = "";
                                }
                                if (!perLineIssuesById[item.id]) perLineIssuesById[item.id] = [];
                                perLineIssuesById[item.id].push({
                                    type: "japanese",
                                    leftover: leftover,
                                    message: `Leftover Japanese characters${leftover ? ` ('${leftover}')` : ""}. Do not return the Japanese source text and translate nameplates too (e.g. \\n<神官> -> \\n<Priest>).`
                                });
                                perLineIssueGroups.japanese.push(item.id);
                                continue;
                            }
                        }

                        const orig = origRaw;
                        const trans = normalizeForLineCheck(origRaw, transRaw);
                        const origLineTrim = trimLineBreaks(orig);
                        const transLineTrim = trimLineBreaks(trans);
                        const origLines = origLineTrim.toString().split('\n').length;
                        const transLines = transLineTrim.toString().split('\n').length;
                        const origLen = orig.length;
                        const transLen = trans.length;

                        let issue = null;

                        // Multi-line translation for a very short original (1-4 chars).
                        if (origLineTrim.match(/^[\s]*[\S][\s]*$/g) != null && origLines < transLines) {
                            const c = origLineTrim.match(/[\S]/g);
                            issue = { type: "multilineShort", count: 1, message: `Original was a single character (${c}) but the translation spans multiple lines.` };
                        } else if (origLineTrim.match(/^[\s]*[\S][\S][\s]*$/g) != null && origLines < transLines) {
                            const c = origLineTrim.match(/[\S][\S]/g);
                            issue = { type: "multilineShort", count: 2, message: `Original was only 2 characters (${c}) but the translation spans multiple lines.` };
                        } else if (origLineTrim.match(/^[\s]*[\S][\S][\S][\s]*$/g) != null && origLines < transLines) {
                            const c = origLineTrim.match(/[\S][\S][\S]/g);
                            issue = { type: "multilineShort", count: 3, message: `Original was only 3 characters (${c}) but the translation spans multiple lines.` };
                        } else if (origLineTrim.match(/^[\s]*[\S][\S][\S][\S][\s]*$/g) != null && origLines < transLines) {
                            const c = origLineTrim.match(/[\S][\S][\S][\S]/g);
                            issue = { type: "multilineShort", count: 4, message: `Original was only 4 characters (${c}) but the translation spans multiple lines.` };
                        } else if ((origLen + 1) * 9 < transLen) {
                            issue = { type: "tooManyChars", origLen, transLen, message: `Translation is far too verbose (original ${origLen} chars, translation ${transLen} chars).` };
                        } else if ((transLen + 1) * 9 < origLen) {
                            issue = { type: "tooFewChars", origLen, transLen, message: `Translation is far too short/truncated (original ${origLen} chars, translation ${transLen} chars).` };
                        } else if (origRaw.match(/[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?\d/g) == null
                                   && trans.match(/[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９]/g) != null) {
                            issue = { type: "weirdNumbers", message: `Translation introduced a long unrelated number sequence not present in the original.` };
                        } else if (origRaw.match(/([\d０-９].?\s?)\1\1\1\1/g) == null
                                   && trans.match(/([\d０-９].?\s?)\1\1\1\1/g) != null) {
                            issue = { type: "repeatedNumbers", message: `Translation introduced a weirdly repeated number pattern (likely a broken placeholder).` };
                        } else if (origLines < transLines && origLen * 5 < transLen) {
                            issue = { type: "tooManyLines", origLines, transLines, message: `Translation has more lines AND far more characters than the original (original ${origLines} lines, translation ${transLines} lines). This usually means content was added or shifted in from another box.` };
                        } else if (origLines > transLines && origLen / 2 > transLen) {
                            issue = { type: "tooFewLines", origLines, transLines, message: `Translation has fewer lines AND far fewer characters than the original (original ${origLines} lines, translation ${transLines} lines). This usually means content was dropped or shifted out to another box.` };
                        } else if (orig.match(/\\>/g) != null && trans.match(/\\>/g) == null) {
                            issue = { type: "missingEscapeGt", message: `Translation lost a \\> command.` };
                        } else if (orig.match(/\\</g) != null && trans.match(/\\</g) == null) {
                            issue = { type: "missingEscapeLt", message: `Translation lost a \\< command.` };
                        } else if (orig.match(/\\\w+<.+?>/g) != null && trans.match(/\\\w+<.+?>/g) == null) {
                            const cmd = orig.match(/\\\w+<.+?>/);
                            issue = { type: "missingAngleCommand", command: cmd ? cmd[0] : "", message: `Translation lost a ${cmd ? cmd[0] : ""} command.` };
                        }

                        if (issue) {
                            if (!perLineIssuesById[item.id]) perLineIssuesById[item.id] = [];
                            perLineIssuesById[item.id].push(issue);
                            (perLineIssueGroups[issue.type] || (perLineIssueGroups[issue.type] = [])).push(item.id);
                        }
                    }

                    const perLineIssueCount = Object.keys(perLineIssuesById).length;

                    // Japanese gets its own lenient threshold (like quotes/maxExtra): a
                    // few artifacts must NOT reject the whole batch - they are still
                    // caught by the per-line checks and corrected individually. Only a
                    // significant amount of Japanese rejects the batch at batch level.
                    const japaneseIds = [...new Set(perLineIssueGroups.japanese || [])];
                    japaneseIssueCount = japaneseIds.length;
                    japaneseIssuePercent = translatedTranslations.length > 0
                        ? (japaneseIssueCount / translatedTranslations.length) * 100
                        : 0;
                    hasJapaneseIssues = japaneseIssueCount > 0;
                    hasTooManyJapaneseIssues = japaneseIssuePercent > maxJapaneseIssuePercent
                        && japaneseIssueCount >= maxJapaneseIssueAbsolute;

                    // Other per-line issues (content shifting, spurious numbers, missing
                    // control commands) are severe and fail the batch on any occurrence.
                    let otherIssueCount = 0;
                    for (const issues of Object.values(perLineIssuesById)) {
                        if (issues.some(i => i.type !== "japanese")) otherIssueCount++;
                    }
                    hasOtherPerLineIssues = otherIssueCount > 0;

                    hasPerLineIssues = hasOtherPerLineIssues || hasJapaneseIssues;
                }

                // ========================================
                // PHASE 3: Build Comprehensive Correction Request
                // ========================================

                checkTimeout();
                let correctionRequest = null;
                let reasons = "";
                let passed = false;

                // Determine if validation passed
                const hasStructuralIssues = missingIds.length > 0 ||
                                            extraIds.length > 0 ||
                                            duplicateIds.length > 0 ||
                                            untranslatedIds.length > 0 ||
                                            !isOrderSame;

                // Calculate the total number of extra commands
                const totalExtraCommands = Object.values(extraCommandsById).reduce((sum, cmds) => sum + cmds.length, 0);

                // Calculate the percentage of extra commands
                const extraCommandsPercent = originalCommands.length > 0 ? 
                                            (totalExtraCommands / originalCommands.length) * 100 : 
                                            (totalExtraCommands > 0 ? 999 : 0);

                // Check if extra commands exceed the threshold
                const hasTooManyExtraCommands = extraCommandsPercent > maxExtra;

                // Command issues include missing commands and naked references, but NOT extra commands or quotes
                // Extra commands are handled separately in the validation logic
                const hasCommandIssues = Object.keys(missingCommandsById).length > 0 ||
                                         hasNakedRefs;

                const preservationMet = originalCommands.length === 0 || preservationPercent >= minPreservation;

                // Validation passes if:
                // 1. No structural issues
                // 2. No command issues (missing commands or naked refs)
                // 3. Preservation is met
                // 4. Either no extra commands OR extra commands are within threshold
                // 5. Either no missing quotes OR quote issues are within threshold
                // 6. No severe per-line issues (content shifting, spurious numbers, missing control commands)
                // 7. Either no leftover Japanese OR Japanese is within the lenient threshold
                if (!hasStructuralIssues && !hasCommandIssues && preservationMet && 
                    (totalExtraCommands === 0 || extraCommandsPercent <= maxExtra) &&
                    (!hasMissingQuotes || !hasTooManyQuoteIssues) &&
                    !hasOtherPerLineIssues &&
                    (!hasJapaneseIssues || !hasTooManyJapaneseIssues)) {
                    passed = true;
                    reasons = originalCommands.length === 0
                        ? "All checks passed. No commands/placeholders to preserve."
                        : `All checks passed. Preserved ${preservationPercent.toFixed(1)}% of commands.`;
                } else {
                    passed = false;

                    // Build correction request with prioritized sections
                    let sections = [];

                    // Priority 1: Completely missing translations
                    if (missingIds.length > 0) {
                        let section = "🚨 MISSING TRANSLATIONS:\n";
                        for (const id of missingIds) {
                            const originalItem = originalTranslations.find(item => item.id === id);
                            if (originalItem) {
                                section += `  ID ${id}: "${originalItem.original}" → [NEEDS TRANSLATION]\n`;
                            }
                        }
                        sections.push(section);
                    }

                    // Priority 2: Untranslated IDs (present but empty)
                    if (untranslatedIds.length > 0) {
                        sections.push(`🚨 UNTRANSLATED ITEMS:\n  IDs: ${untranslatedIds.join(', ')}\n`);
                    }

                    // Priority 3: Extra IDs to remove
                    if (extraIds.length > 0) {
                        sections.push(`⚠️ EXTRA ITEMS (remove these):\n  IDs: ${extraIds.join(', ')}\n`);
                    }

                    // Priority 3b: Duplicate IDs (keep only one copy of each).
                    // Placed before Order/Quotes so the model drops the stub
                    // instead of "fixing" the duplicate's own defects.
                    if (duplicateIds.length > 0) {
                        sections.push(`🔁 DUPLICATE ITEMS (keep only one copy of each):\n  IDs: ${duplicateIds.join(', ')}\n`);
                    }

                    // Priority 4: Order issues (only if no missing/extra IDs)
                    if (!isOrderSame && missingIds.length === 0 && extraIds.length === 0) {
                        sections.push("⚠️ ORDER ISSUE:\n  The order of translations does not match the original.\n");
                    }

                    // Priority 5: Missing commands (only for translated IDs)
                    if (Object.keys(missingCommandsById).length > 0) {
                        let section = "🚨 MISSING COMMANDS:\n";
                        for (const [id, cmds] of Object.entries(missingCommandsById)) {
                            section += `  ID ${id}: Missing ${cmds.join(', ')}\n`;
                        }
                        sections.push(section);
                    }

                    // Priority 6: Extra commands (ALWAYS include if there are any, but indicate severity)
                    if (totalExtraCommands > 0) {
                        let section = hasTooManyExtraCommands ? 
                            "🚨 WRONG EXTRA COMMANDS/PLACEHOLDERS (replace or remove these):\n" : 
                            "⚠️ EXTRA COMMANDS/PLACEHOLDERS (replace or remove these):\n";
                            
                        for (const [id, cmds] of Object.entries(extraCommandsById)) {
                            section += `  ID ${id}: Extra ${cmds.join(', ')}\n`;
                        }
                        //section += `  Total: ${totalExtraCommands} extra commands (${extraCommandsPercent.toFixed(1)}%, max ${maxExtra}%)\n`;
                        sections.push(section);
                    }

                    // Priority 7: Low preservation
                    if (originalCommands.length > 0 && preservationPercent < minPreservation) {
                        sections.push(`🚨 LOW PRESERVATION:\n  Only ${preservationPercent.toFixed(1)}% of original commands/placeholders preserved (need ≥${minPreservation}%)\n`);
                    }

                    // Priority 8: Naked references (IMPROVED)
                    if (hasNakedRefs) {
                        let section = "🚨 NAKED REFERENCES:\n";
                        for (const ref of nakedReferences) {
                            section += `  ID ${ref.id}: ${ref.issue}\n`;
                        }
                        sections.push(section);
                    }

                    // Priority 9: Missing Quotes
                    if (hasMissingQuotes) {
                        let section = "🚨 MISSING QUOTES:\n";
                        for (const [id, quotes] of Object.entries(missingQuotesById)) {
                            for (const quote of quotes) {
                                section += `  ID ${id}: Missing quotes around "${quote.content}" (found: "${quote.found}", expected: "${quote.expected}")\n`;
                            }
                        }
                        sections.push(section);
                    }

                    // Priority 10: Leftover Japanese characters
                    if (perLineIssueGroups.japanese.length > 0) {
                        let section = "🚨 LEFTOVER JAPANESE TEXT:\n";
                        section += "  These translations still contain Japanese. Do not echo the source text; translate nameplates too.\n";
                        for (const id of [...new Set(perLineIssueGroups.japanese)]) {
                            for (const issue of perLineIssuesById[id]) {
                                if (issue.type === "japanese") {
                                    section += `  ID ${id}: ${issue.message}\n`;
                                }
                            }
                        }
                        sections.push(section);
                    }

                    // Priority 11: Content placement / box shifting
                    // (multilineShort, tooManyChars, tooFewChars, tooManyLines, tooFewLines)
                    const placementTypes = ["multilineShort", "tooManyChars", "tooFewChars", "tooManyLines", "tooFewLines"];
                    const placementIds = placementTypes
                        .flatMap(t => perLineIssueGroups[t] || []);
                    if (placementIds.length > 0) {
                        const uniquePlacementIds = [...new Set(placementIds)].sort((a, b) => a - b);

                        // Look up the actual original and translated text per id so we can
                        // show the model EXACTLY what each box should contain vs. what it wrote.
                        const origById = {};
                        const transById = {};
                        for (const item of originalTranslations) {
                            if (item.id !== undefined) origById[item.id] = item.original || "";
                        }
                        for (const item of translatedData.translations) {
                            if (item.id !== undefined) transById[item.id] = item.translated || "";
                        }
                        const countLines = (s) => (s == null ? 0 : s.toString().split('\n').length);
                        const clip = (s, n) => {
                            s = (s == null ? "" : String(s)).replaceAll(/\s+/g, " ").trim();
                            return s.length > n ? s.slice(0, n) + "…" : s;
                        };

                        // Split affected boxes into "too short" (text bled OUT) and "too long"
                        // (text bled IN). When both exist, that is the classic shift signature.
                        const shortTypes = ["multilineShort", "tooFewChars", "tooFewLines"];
                        const longTypes = ["tooManyChars", "tooManyLines"];
                        const shortIds = uniquePlacementIds.filter(id =>
                            (perLineIssuesById[id] || []).some(i => shortTypes.includes(i.type)));
                        const longIds = uniquePlacementIds.filter(id =>
                            (perLineIssuesById[id] || []).some(i => longTypes.includes(i.type)));
                        const looksLikeShift = shortIds.length > 0 && longIds.length > 0;

                        let section = "🚨 CONTENT PLACEMENT / TEXT BOX SHIFTING:\n";
                        section += "You let text bleed from one box into another. Each text box must contain ONLY the translation of its OWN original line, and must keep the SAME number of lines as that original. In RPG Maker, CG/SE events fire at specific boxes, so any text placed in the wrong box breaks the scene.\n";
                        section += "\nHOW TO FIX: for EACH box listed below, IGNORE your previous translation of it and re-translate ONLY that box's original text from scratch. Do not reuse or carry over any text from any other box.\n";

                        if (shortIds.length === 1 && longIds.length === 1) {
                            section += `\nThis is a shift: text was moved FROM box ID ${shortIds[0]} (now too short) INTO box ID ${longIds[0]} (now too long). Move it back - re-translate ID ${shortIds[0]}'s original into ID ${shortIds[0]}, and ID ${longIds[0]}'s original into ID ${longIds[0]}.\n`;
                        } else if (looksLikeShift) {
                            section += `\nThis is a shift: the ${shortIds.length} box(es) marked TOO SHORT had their text moved INTO the ${longIds.length} box(es) marked TOO LONG. Put the text back - re-translate each box's own original independently.\n`;
                        }

                        section += "\nAffected boxes (re-translate each one's ORIGINAL by itself):\n";
                        for (const id of uniquePlacementIds) {
                            const issues = (perLineIssuesById[id] || []).filter(i => placementTypes.includes(i.type));
                            const tag = issues.some(i => shortTypes.includes(i.type)) ? "TOO SHORT (text is missing)" : "TOO LONG (has extra text from another box)";
                            const o = origById[id];
                            const t = transById[id];
                            section += `  ID ${id} [${tag}]\n`;
                            section += `    original (${countLines(o)} line(s), ${(o || "").length} chars): ${clip(o, 100)}\n`;
                            section += `    your translation (${countLines(t)} line(s), ${(t || "").length} chars): ${clip(t, 100)}\n`;
                        }

                        section += "\nExample of the mistake and the fix:\n";
                        section += "  original box A = \"今日は良い天気ですね\"    original box B = \"行ってきます\"\n";
                        section += "  WRONG (text of A bled into B):  A = \"Today\"   B = \"is nice weather. I'm leaving.\"\n";
                        section += "  CORRECT (each box re-translates its own original): A = \"The weather is nice today.\"  B = \"I'm off.\"\n";

                        sections.push(section);
                    }

                    // Priority 12: Spurious numbers
                    const numberIds = [...new Set([
                        ...(perLineIssueGroups.weirdNumbers || []),
                        ...(perLineIssueGroups.repeatedNumbers || [])
                    ])];
                    if (numberIds.length > 0) {
                        let section = "🚨 SPURIOUS NUMBERS:\n";
                        for (const id of numberIds) {
                            for (const issue of perLineIssuesById[id]) {
                                if (issue.type === "weirdNumbers" || issue.type === "repeatedNumbers") {
                                    section += `  ID ${id}: ${issue.message}\n`;
                                }
                            }
                        }
                        sections.push(section);
                    }

                    // Priority 13: Missing escape / angle commands (\>, \<, \w+<...>)
                    const escapeIds = [...new Set([
                        ...(perLineIssueGroups.missingEscapeGt || []),
                        ...(perLineIssueGroups.missingEscapeLt || []),
                        ...(perLineIssueGroups.missingAngleCommand || [])
                    ])];
                    if (escapeIds.length > 0) {
                        let section = "🚨 MISSING CONTROL COMMANDS:\n";
                        for (const id of escapeIds) {
                            for (const issue of perLineIssuesById[id]) {
                                if (issue.type === "missingEscapeGt" || issue.type === "missingEscapeLt" || issue.type === "missingAngleCommand") {
                                    section += `  ID ${id}: ${issue.message}\n`;
                                }
                            }
                        }
                        sections.push(section);
                    }

                    // Combine all sections
                    let correctionFooter = "\nPlease provide a corrected version that addresses all the issues above.";
                    if (placementIds.length > 0) {
                        correctionFooter = "\nRe-output the COMPLETE JSON for EVERY box. For boxes NOT listed above, repeat your previous translation UNCHANGED. For each box listed above, provide a FRESH translation of its OWN original text only, keeping the same number of lines as that original. Do not move any text between boxes.";
                    }
                    correctionRequest = "Please correct the following translation issues:\n\n" +
                                        sections.join("\n") + correctionFooter;

                    // Build reasons summary
                    const reasonParts = [];
                    if (missingIds.length > 0) reasonParts.push(`${missingIds.length} missing IDs`);
                    if (extraIds.length > 0) reasonParts.push(`${extraIds.length} extra IDs`);
                    if (duplicateIds.length > 0) reasonParts.push(`${duplicateIds.length} duplicate IDs`);
                    if (untranslatedIds.length > 0) reasonParts.push(`${untranslatedIds.length} untranslated IDs`);
                    if (!isOrderSame) reasonParts.push("order changed");
                    if (Object.keys(missingCommandsById).length > 0) reasonParts.push(`${Object.keys(missingCommandsById).length} IDs with missing commands`);
                    if (totalExtraCommands > 0) reasonParts.push(`${totalExtraCommands} extra commands (${extraCommandsPercent.toFixed(1)}%)`);
                    if (hasNakedRefs) reasonParts.push(`${nakedReferences.length} naked references`);
                    if (hasMissingQuotes) {
                        const totalMissingQuotes = Object.values(missingQuotesById).reduce((sum, arr) => sum + arr.length, 0);
                        reasonParts.push(`${totalMissingQuotes} missing quotes (${quoteIssuePercent.toFixed(1)}%, max ${maxQuoteIssues}%)`);
                    }
                    if (preservationPercent < minPreservation && originalCommands.length > 0) reasonParts.push(`low preservation (${preservationPercent.toFixed(1)}%)`);
                    if (placementIds.length > 0) reasonParts.push(`${[...new Set(placementIds)].length} boxes with content placement issues`);
                    if (hasJapaneseIssues) reasonParts.push(`${japaneseIssueCount} boxes with leftover Japanese (${japaneseIssuePercent.toFixed(1)}%, max ${maxJapaneseIssuePercent}%${hasTooManyJapaneseIssues ? " [over threshold]" : ""})`);
                    if (numberIds.length > 0) reasonParts.push(`${numberIds.length} boxes with spurious numbers`);
                    if (escapeIds.length > 0) reasonParts.push(`${escapeIds.length} boxes with missing control commands`);

                    reasons = reasonParts.join(", ");
                }

                // ========================================
                // Return Comprehensive Result
                // ========================================

                return {
                    passed,
                    needsCorrection: !passed,

                    // Structural issues
                    structuralIssues: {
                        missingIds: [...new Set(missingIds)],
                        extraIds: [...new Set(extraIds)],
                        duplicateIds: [...new Set(duplicateIds)],
                        untranslatedIds: [...new Set(untranslatedIds)],
                        orderChanged: !isOrderSame
                    },

                    // Command issues (only for translated IDs)
                    commandIssues: {
                        missingCommandsById,
                        extraCommandsById,
                        nakedReferences,
                        missingQuotesById,  // NEW
                        hasNakedRefs,
                        hasMissingQuotes,  // NEW
                        quoteIssuePercent,  // NEW
                        preservationPercent,
                        excessPercent
                    },

                    // Per-line content & formatting issues (content shifting, leftover
                    // Japanese, spurious numbers, missing control commands, etc.)
                    perLineIssues: {
                        perLineIssuesById,
                        perLineIssueGroups,
                        hasPerLineIssues,
                        hasOtherPerLineIssues,
                        hasJapaneseIssues,
                        hasTooManyJapaneseIssues,
                        japaneseIssueCount,
                        japaneseIssuePercent
                    },

                    // Stats
                    stats: {
                        totalOriginalIds: originalIds.length,
                        totalTranslatedIds: translatedIds.length,
                        commonIds: commonIds.length,
                        totalOriginalCommands: originalCommands.length,
                        totalTranslatedCommands: translatedCommands.length,
                        preservedCommands: preservedCommands.length
                    },

                    correctionRequest,
                    reasons
                };

            } catch (error) {
                // Handle timeout errors
                if (error.isTimeout) {
                    return error.result;
                }
                throw error; // Re-throw other errors
            }
        }

        function checkCommandPreservation(str1, str2, llmToUse, comrep1, comrep2, comrep3, comrep4, comrep5, comrep6, com2rep1, com2rep2, com2rep3, com2rep4, com2rep5, com2rep6, options = {}) {
            const {
                minPreservation = 80,
                maxExtra = 20,
                allowNakedRefs = false,
                checkContentPlacement = true,
                strictPlacement = true
            } = options;
            
            const startTime = Date.now();
            const TIMEOUT_MS = 300000; // 5 minutes
            
            // Check timeout and throw error to stop execution
            const checkTimeout = () => {
                if (Date.now() - startTime > TIMEOUT_MS) {
                    const error = new Error("Response validation timeout (5 minutes)");
                    error.isTimeout = true;
                    error.result = {
                        passed: false,
                        originalPreservation: 0,
                        outputExcess: 0,
                        hasNakedRefs: false,
                        hasMisplacedContent: false,
                        misplacedDetails: [],
                        stats: {
                            totalOriginal: 0,
                            totalOutput: 0,
                            preservedCount: 0,
                            extraCommandCount: 0
                        },
                        reasons: "Response validation failed due to timeout."
                    };
                    throw error;
                }
            };
            
            // OPTIMIZATION: Early exit for identical strings
            checkTimeout();
            if (str1 === str2) {
                return {
                    passed: true,
                    originalPreservation: 100,
                    outputExcess: 0,
                    hasNakedRefs: false,
                    hasMisplacedContent: false,
                    misplacedDetails: [],
                    stats: {
                        totalOriginal: 0,
                        totalOutput: 0,
                        preservedCount: 0,
                        extraCommandCount: 0
                    },
                    reasons: "Strings are identical"
                };
            }
            
            try {
                // OPTIMIZATION: Use Set for O(1) lookups
                checkTimeout();
                const extractCommands = (str) => {
                    const commands = [
                        ...(str.match(/\\+[nciv]w?\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase()),
                        ...(str.match(/@\d+/g) || [])
                    ];
                    return commands;
                };
                
                const originalCommands = extractCommands(str1);
                const outputCommands = extractCommands(str2);
                
                // OPTIMIZATION: Convert to Set for O(1) lookups
                const outputCommandSet = new Set(outputCommands);
                
                // Check for naked references if not allowed
                let hasNakedRefs = false;
                if (!allowNakedRefs) {
                    checkTimeout();
                    const cmdRefs = (str1.match(/\\+[nciv]w?\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase());
                    hasNakedRefs = cmdRefs.some(cmd => {
                        const num = cmd.match(/\d+/)[0];
                        return str2.includes(`[${num}]`) && !outputCommandSet.has(cmd);
                    });
                }
                
                // OPTIMIZED: Check content placement between дiv markers using O(n) algorithm
                let hasMisplacedContent = false;
                let misplacedDetails = [];
                
                if (checkContentPlacement) {
                    checkTimeout();
                    const extractSections = (str) => {
                        const sections = {};
                        const lines = str.split('\n');
                        let currentMarker = null;
                        let currentContent = [];
                        
                        for (const line of lines) {
                            checkTimeout();
                            const markerMatch = line.match(/^---\s*\{дiv(\d+)\}\s*---$/);
                            if (markerMatch) {
                                // Save previous section if exists
                                if (currentMarker !== null) {
                                    sections[currentMarker] = currentContent.join('\n').trim();
                                }
                                // Start new section
                                currentMarker = markerMatch[1];
                                currentContent = [];
                            } else if (currentMarker !== null) {
                                currentContent.push(line);
                            }
                        }
                        
                        // Save last section
                        if (currentMarker !== null) {
                            sections[currentMarker] = currentContent.join('\n').trim();
                        }
                        
                        return sections;
                    };
                    
                    const originalSections = extractSections(str1);
                    const outputSections = extractSections(str2);
                    
                    // OPTIMIZATION: Build command-to-section mapping for O(1) lookups
                    // This replaces the O(n² × m) nested loops with O(n + m)
                    // Build: section → Set<commands>
                    checkTimeout();
                    const outputSectionCommands = {};
                    for (const [marker, content] of Object.entries(outputSections)) {
                        checkTimeout();
                        const commands = [
                            ...(content.match(/\\+[nciv]w?\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase()),
                            ...(content.match(/@\d+/g) || [])
                        ];
                        outputSectionCommands[marker] = new Set(commands);
                    }
                    // Now check each command with per-section Set lookup
                    for (const [marker, content] of Object.entries(originalSections)) {
                        checkTimeout();
                        const originalCommands = [
                            ...(content.match(/\\+[nciv]w?\[\d+\]/gi) || []).map(cmd => cmd.toLowerCase()),
                            ...(content.match(/@\d+/g) || [])
                        ];

                        // Check if output section exists
                        if (!outputSections[marker]) {
                            if (originalCommands.length > 0) {
                                misplacedDetails.push(`Section дiv${marker} with commands ${originalCommands.join(', ')} missing from output`);
                                hasMisplacedContent = true;
                            }
                            continue;
                        }

                        // Get commands in this output section
                        const outputCmdSet = outputSectionCommands[marker] || new Set();

                        // Check each command's presence
                        for (let cmd of originalCommands) {
                            checkTimeout();
                            if (!outputCmdSet.has(cmd)) {
                                if (llmToUse == "model1" && cmd.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                                    if (comrep1 && comrep1 != "") {
                                        cmd = cmd.replaceAll(/\\n\[(\d+)\]/gi, comrep1);
                                    }
                                    if (comrep2 && comrep2 != "") {
                                        cmd = cmd.replaceAll(/\\nw\[(\d+)\]/gi, comrep2);
                                    }
                                    if (comrep3 && comrep3 != "") {
                                        cmd = cmd.replaceAll(/\\v\[(\d+)\]/gi, comrep3);
                                    }
                                    if (comrep4 && comrep4 != "") {
                                        cmd = cmd.replaceAll(/\\i\[(\d+)\]/gi, comrep4);
                                    }
                                    if (comrep5 && comrep5 != "") {
                                        cmd = cmd.replaceAll(/\\c\[(\d+)\]/gi, comrep5);
                                    }
                                    if (comrep6 && comrep6 != "") {
                                        cmd = cmd.replaceAll(/@(\d+)/gi, comrep6);
                                    }
                                } else if (llmToUse == "model2" && cmd.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                                    if (com2rep1 && com2rep1 != "") {
                                        cmd = cmd.replaceAll(/\\n\[(\d+)\]/gi, com2rep1);
                                    }
                                    if (com2rep2 && com2rep2 != "") {
                                        cmd = cmd.replaceAll(/\\nw\[(\d+)\]/gi, com2rep2);
                                    }
                                    if (com2rep3 && com2rep3 != "") {
                                        cmd = cmd.replaceAll(/\\v\[(\d+)\]/gi, com2rep3);
                                    }
                                    if (com2rep4 && com2rep4 != "") {
                                        cmd = cmd.replaceAll(/\\i\[(\d+)\]/gi, com2rep4);
                                    }
                                    if (com2rep5 && com2rep5 != "") {
                                        cmd = cmd.replaceAll(/\\c\[(\d+)\]/gi, com2rep5);
                                    }
                                    if (com2rep6 && com2rep6 != "") {
                                        cmd = cmd.replaceAll(/(@\d+)/gi, com2rep6);
                                    }
                                }
                                misplacedDetails.push(`Command ${cmd} from section --- {дiv${marker}} --- missing from translation.`);
                                hasMisplacedContent = true;
                            }
                            // If present, it's OK — no need to check *where else* unless strict mode
                            // (If you want to forbid extra copies elsewhere, add more logic here)
                        }
                    }
                }
                
                // Handle case when there are no original commands
                checkTimeout();
                if (originalCommands.length === 0) {
                    const maxAllowedExtra = Math.max(5, maxExtra);
                    const passed = outputCommands.length <= maxAllowedExtra && !hasNakedRefs && !hasMisplacedContent;
                    
                    return {
                        passed,
                        hasNakedRefs,
                        hasMisplacedContent,
                        misplacedDetails,
                        originalPreservation: 100,
                        outputExcess: outputCommands.length > 0 ? (outputCommands.length / Math.max(1, originalCommands.length)) * 100 : 0,
                        stats: {
                            totalOriginal: originalCommands.length,
                            totalOutput: outputCommands.length,
                            preservedCount: 0,
                            extraCommandCount: outputCommands.length
                        },
                        reasons: hasNakedRefs ? 
                            "Contains naked references (not allowed)" :
                        hasMisplacedContent ?
                            `Content is misplaced: ${misplacedDetails.join(', ')}` :
                        outputCommands.length > maxAllowedExtra ?
                            `Output has ${outputCommands.length} extra commands (max ${maxAllowedExtra} allowed)` :
                            "OK - No original commands to preserve"
                    };
                }
                
                // OPTIMIZATION: Calculate preservation using Set for O(1) lookups
                checkTimeout();
                const preservedCommands = originalCommands.filter(cmd => 
                    outputCommandSet.has(cmd)
                );
                const originalPreservation = (preservedCommands.length / originalCommands.length) * 100;
                
                // OPTIMIZATION: Use Map for efficient counting
                checkTimeout();
                const countOccurrences = (arr) => {
                    const counts = new Map();
                    for (const cmd of arr) {
                        counts.set(cmd, (counts.get(cmd) || 0) + 1);
                    }
                    return counts;
                };
                
                const originalCounts = countOccurrences(originalCommands);
                const outputCounts = countOccurrences(outputCommands);
                
                // Find extra commands
                checkTimeout();
                const extraCommands = [];
                for (const [cmd, outputCount] of outputCounts.entries()) {
                    const originalCount = originalCounts.get(cmd) || 0;
                    if (outputCount > originalCount) {
                        const excessCount = outputCount - originalCount;
                        for (let i = 0; i < excessCount; i++) {
                            checkTimeout();
                            extraCommands.push(cmd);
                        }
                    }
                }
                
                const outputExcess = (extraCommands.length / originalCommands.length) * 100;
                
                // Check all conditions
                const isPreserved = originalPreservation >= minPreservation;
                const notTooManyExtra = outputExcess <= maxExtra;
                const noIllegalNakedRefs = !hasNakedRefs;
                const contentCorrectlyPlaced = !hasMisplacedContent;
                
                let passed;
                let reasons;
                
                if (strictPlacement) {
                    // Priority 1: No misplaced content
                    if (!contentCorrectlyPlaced) {
                        passed = false;
                        reasons = `Content is misplaced: ${misplacedDetails.join(', ')}`;
                    }
                    // Priority 2: No naked references
                    else if (!noIllegalNakedRefs) {
                        passed = false;
                        reasons = "Contains naked references (not allowed)";
                    }
                    // Priority 3: Preservation requirements
                    else if (!isPreserved) {
                        passed = false;
                        reasons = `Only ${originalPreservation.toFixed(1)}% preserved (need ≥${minPreservation}%)`;
                    }
                    // Priority 4: Extra commands limit
                    else if (!notTooManyExtra) {
                        passed = false;
                        reasons = `${outputExcess.toFixed(1)}% extra commands (max ${maxExtra}% allowed)`;
                    }
                    // All checks passed
                    else {
                        passed = true;
                        reasons = `Preserved ${originalPreservation.toFixed(1)}% of original, added ${outputExcess.toFixed(1)}% extra`;
                    }
                } else {
                    // Original logic - all checks have equal priority
                    passed = isPreserved && notTooManyExtra && noIllegalNakedRefs && contentCorrectlyPlaced;
                    
                    if (!noIllegalNakedRefs) {
                        reasons = "Contains naked references (not allowed)";
                    } else if (!isPreserved) {
                        reasons = `Only ${originalPreservation.toFixed(1)}% preserved (need ≥${minPreservation}%)`;
                    } else if (!notTooManyExtra) {
                        reasons = `${outputExcess.toFixed(1)}% extra commands (max ${maxExtra}% allowed)`;
                    } else if (!contentCorrectlyPlaced) {
                        reasons = `Content is misplaced: ${misplacedDetails.join(', ')}`;
                    } else {
                        reasons = `Preserved ${originalPreservation.toFixed(1)}% of original, added ${outputExcess.toFixed(1)}% extra`;
                    }
                }
                
                return {
                    passed,
                    originalPreservation,
                    outputExcess,
                    hasNakedRefs,
                    hasMisplacedContent,
                    misplacedDetails,
                    stats: {
                        totalOriginal: originalCommands.length,
                        totalOutput: outputCommands.length,
                        preservedCount: preservedCommands.length,
                        extraCommandCount: extraCommands.length
                    },
                    reasons
                };
            } catch (error) {
                // Handle timeout errors
                if (error.isTimeout) {
                    return error.result;
                }
                throw error; // Re-throw other errors
            }
        }

        function generateCorrectionRequest(originalText, translatedText, validationResult) {
            // If validation passed, no correction needed
            if (validationResult.passed) {
                return null;
            }
            
            // Start building the correction request
            let correctionPrompt = "Please correct the following translation issues:\n\n";
            
            // Add specific instructions based on failure reasons
            if (validationResult.hasMisplacedContent) {
                correctionPrompt += "🚨 ISSUES:\n";
                
                validationResult.misplacedDetails.forEach(detail => {
                    correctionPrompt += `  - ${detail}\n`;
                });
                
                correctionPrompt += "\nPlease ensure each piece of content is preserved under the correct section marker as in the original.\n\n";
            }
            
            if (validationResult.originalPreservation < 80) {
                correctionPrompt += "🚨 LOW PRESERVATION:\n";
                correctionPrompt += `Only ${validationResult.originalPreservation.toFixed(1)}% of original commands were preserved (need ≥80%).\n`;
                correctionPrompt += "Please ensure all original commands and placeholders are maintained in the translation.\n\n";
            }
            
            if (validationResult.outputExcess > 20) {
                correctionPrompt += "🚨 WRONG EXTRA COMMANDS (replace or remove these):\n";
                //correctionPrompt += `The translation has ${validationResult.outputExcess.toFixed(1)}% extra commands (max 20% allowed).\n`;
                correctionPrompt += "Please remove unnecessary commands that weren't in the original.\n\n";
            }
            
            correctionPrompt += "Please provide a corrected version that addresses all the issues above.";
            
            return correctionPrompt;
        }

        function validateAndRequestCorrection(originalText, translatedText, llmToUse, comrep1, comrep2, comrep3, comrep4, comrep5, comrep6, com2rep1, com2rep2, com2rep3, com2rep4, com2rep5, com2rep6) {
            // Strict validation - content placement is most important
            const validationResult = checkCommandPreservation(originalText, translatedText, llmToUse, comrep1, comrep2, comrep3, comrep4, comrep5, comrep6, com2rep1, com2rep2, com2rep3, com2rep4, com2rep5, com2rep6, {
                minPreservation: 80,
                maxExtra: 20,
                allowNakedRefs: false,
                checkContentPlacement: true,
                strictPlacement: true
            });
            
            // DEBUG: Log the validation result to see what's happening
            console.log("Validation result:", validationResult);
            
            if (!validationResult.passed) {
                // Generate correction request
                const correctionRequest = generateCorrectionRequest(originalText, translatedText, validationResult);
                
                // Return the correction request for further processing
                return {
                    needsCorrection: true,
                    validationResult,
                    correctionRequest
                };
            }
            
            // Validation passed
            return {
                needsCorrection: false,
                validationResult
            };
        }

        function compareLineHeaders(str1, str2) {
            const startTime = Date.now();
            const TIMEOUT_MS = 300000; // 5 minutes
            
            // Check timeout and throw error to stop execution
            const checkTimeout = () => {
                if (Date.now() - startTime > TIMEOUT_MS) {
                    const error = new Error("Line headers comparison timeout (5 minutes)");
                    error.isTimeout = true;
                    error.result = {
                        isMatch: false,
                        differences: {
                            missingInSecondString: [],
                            extraInSecondString: [],
                            orderChanged: false
                        },
                        timeout: true
                    };
                    throw error;
                }
            };
            
            try {
                // OPTIMIZATION: Early exit for identical strings
                checkTimeout();
                if (str1 === str2) {
                    return {
                        isMatch: true,
                        differences: {
                            missingInSecondString: [],
                            extraInSecondString: [],
                            orderChanged: false
                        }
                    };
                }
                
                checkTimeout();
                const originalLineHeaders = (str1.match(/дiv\d+/g) || []);
                const outputLineHeaders = (str2.match(/дiv\d+/g) || []);

                // OPTIMIZATION: Use Set for O(1) lookups
                checkTimeout();
                const outputHeaderSet = new Set(outputLineHeaders);
                
                const missingLineHeaders = originalLineHeaders.filter(ph => {
                    checkTimeout();
                    return !outputHeaderSet.has(ph);
                });

                // OPTIMIZATION: Use Map for efficient counting
                checkTimeout();
                const countOccurrences = (arr) => {
                    const counts = new Map();
                    for (const ph of arr) {
                        counts.set(ph, (counts.get(ph) || 0) + 1);
                    }
                    return counts;
                };
                
                const originalCounts = countOccurrences(originalLineHeaders);
                const outputCounts = countOccurrences(outputLineHeaders);
                
                // Find extra headers
                checkTimeout();
                const extraLineHeaders = [];
                for (const [ph, outputCount] of outputCounts.entries()) {
                    const originalCount = originalCounts.get(ph) || 0;
                    if (outputCount > originalCount) {
                        const excessCount = outputCount - originalCount;
                        for (let i = 0; i < excessCount; i++) {
                            checkTimeout();
                            extraLineHeaders.push(ph);
                        }
                    }
                }
                
                checkTimeout();
                const isOrderSame = JSON.stringify(originalLineHeaders) === JSON.stringify(outputLineHeaders);
                const isMatch = missingLineHeaders.length === 0 && extraLineHeaders.length === 0 && isOrderSame;

                return {
                    isMatch: isMatch,
                    differences: {
                        missingInSecondString: [...new Set(missingLineHeaders)],
                        extraInSecondString: [...new Set(extraLineHeaders)],
                        orderChanged: !isOrderSame
                    }
                };
                
            } catch (error) {
                // Handle timeout errors
                if (error.isTimeout) {
                    return error.result;
                }
                throw error; // Re-throw other errors
            }
        }
        function logCollapsed(title, content) {
            console.groupCollapsed(title);
            console.log(typeof content === 'object' ? JSON.stringify(content, null, 2) : content);
            console.groupEnd();
        }
        function errorCollapsed(title, content) {
            console.groupCollapsed(`%c${title}`, 'color: #ff7b7b; background: #290000; font-weight: bold; padding: 2px 6px;');
            console.error(typeof content === 'object' ? JSON.stringify(content, null, 2) : content);
            console.groupEnd();
        }
        // Hepler function to get custom headers
        function getCustomHeaders(retryCount, llmToUse, header1, header2) {
            const header = (llmToUse == "model2" || retryCount > 10) ? header2 : header1;
            
            if (!header) {
                return {};
            }
            
            // If header is already an object, use it directly
            if (typeof header === 'object' && header !== null) {
                // Check if it's not an empty object
                return Object.keys(header).length > 0 ? header : {};
            }
            
            // If header is a string, try to parse it
            if (typeof header === 'string' && header.trim() !== '') {
                try {
                    const parsed = JSON.parse(header);
                    return typeof parsed === 'object' && parsed !== null ? parsed : {};
                } catch (e) {
                    console.error(`[DSLR] Invalid custom headers JSON: ${e.message}`);
                }
            }
            
            return {};
        }
        function getCustomParams(retryCount, llmToUse, para1, para2) {
            const para = (llmToUse == "model2" || retryCount > 10) ? para2 : para1;
            
            if (!para) {
                return {};
            }
            
            // If para is already an object, use it directly
            if (typeof para === 'object' && para !== null) {
                // Check if it's not an empty object
                return Object.keys(para).length > 0 ? para : {};
            }
            
            // If para is a string, try to parse it
            if (typeof para === 'string' && para.trim() !== '') {
                try {
                    const parsed = JSON.parse(para);
                    return typeof parsed === 'object' && parsed !== null ? parsed : {};
                } catch (e) {
                    console.error(`[DSLR] Invalid custom headers JSON: ${e.message}`);
                }
            }
            
            return {};
        }
        // Trim lines with context terms that do not appear in the translation batch
        // context_prompt:    String user Context Prompt following a specific format of quoted
        //                    terms at the start of each line. Lines not following the format
        //                    will be always parsed if key is "0", never otherwise.
        // search_text:       Array of strings containing the text to match terms with.
        // key:               Integer for indexing quotted element from context_prompt to match.
        function trimLinesMatchTerms(context_prompt, search_text, key) {
            let matchLines = "";
            let textLine = "";
            // Unroll untranslated text to a single string
            for (let i = 0; i < search_text.length; i++) {
                textLine += search_text[i];
            }
            // Split lines of the Context Prompt
            const PromptLines = context_prompt.split('\n');
            for (let i = 0; i < PromptLines.length; i++) {
                let PromptLine = PromptLines[i];
                // Only try to find a match on lines with propper Context Prompt format
                if (PromptLine.charAt(0) == '"' || PromptLine.charAt(0) == "'") {
                    // Get the quoted term by double quoted "" or single '' at the start of the line
                    let term = PromptLine.match(/"([^"]*)"/g);
                    if (term == null) {
                        term = PromptLine.match(/'([^']*)'/g);
                    }
                    if (term != undefined && term != "" && term != null) {
                        // In cases where there is not enough terms, use the first
                        do {
                            term.push(term[0]);
                        } while (term.length <= key);
                        // If there were a quoted term, escape special characters and search it on the batch text
                        term = term[key].replaceAll(/'/g,"").replaceAll(/"/g,"").replaceAll(/\\/g,"\\\\").replaceAll(/\[/g,"\\\[").replaceAll(/\]/g,"\\\]");
                        term = textLine.match(term);
                        // On match, append the line of the term to be parsed
                        if (term != undefined && term != "" && term != null) {
                            matchLines += PromptLine + '\n';
                        }
                    }
                } else {
                    // If there were no quoted term, append the line of the term to be parsed if it's not a comment
                    if (PromptLine != undefined && PromptLine != "" && PromptLine != null && key == 0) {
                        if ( !(PromptLine[0] == '/' && PromptLine[1] == '/') ) {
                            matchLines += PromptLine + '\n';
                        }
                    }
                }
            }
            return matchLines;
        }

        // Erase lines from str1 that are found in str2
        function deDuplicateLines(str1, str2) {
            const lines1 = str1.split('\n');
            const lines2 = str2.split('\n');
            const lines1m2 = lines1.filter((item) => !lines2.includes(item));
            let result = "";
            for (let i = 0; i < lines1m2.length; i++) {
                result += lines1m2[i] + '\n';
            }
            return result;
        }
        var llmToUse = "model1";
        var persistentBatch = [];
        var persistentBatchLength = 0;
        var persistentBatchIndexes = [];
        var toTranslateLast;
        var translatingIndexLast;
        // True once a recovery chain has split the batch at least once. The fallback
        // branch consults this so that, after a split, handing the batch to the
        // fallback retries the SAME (already-split) batch instead of re-expanding it
        // back to the full original batch (which caused an infinite split/hand-off loop).
        var splitActive = false;
        // 1-based endpoint assigned by the batch dispatcher (default 1 = primary). Mutable:
        // on a 429 the engine may rotate this batch to a different endpoint (key).
        let endpointNumber = (options && options.endpointNumber) ? options.endpointNumber : 1;
        // Resolved per-endpoint settings for the PRIMARY path. When llmToUse flips to "model2",
        // the fallback reads still use optionXxx2 inside the branches below.
        let ep = this.getEndpointSettings(endpointNumber);
        // 429 rotation bookkeeping (per batch): a bound on total rotations before falling back.
        let rotationCount = 0;
        const MAX_429_ROTATIONS = 30;
        // Small pause before retrying on a different endpoint after a 429: the next key may hit
        // the same API, and a request in the same second can itself look rate-limited.
        const ROTATION_429_DELAY_MS = 1000;
        // When no endpoint has spare capacity, re-check this often (waits for an in-flight batch to finish).
        const ROTATION_POLL_MS = 2000;
        // Rotation pacing before retrying on a different endpoint: the larger URL-group delay when
        // endpoints are grouped by URL (they likely hit the same provider, so back-to-back trips its limit).
        const _rotDelayMs = this._groupByUrl()
            ? (parseInt(this.optionUrlGroupRotationDelay.getValue(), 10) || 5000)
            : ROTATION_429_DELAY_MS;
        const startThread = async (completeBatchFailure) => {
            if (this.aborted) {
                returnError('Aborted.');
                return;
            }
            if (this.paused) {
                this.pauseQueue.push(() => {
                    // Preserve the continuation argument: startThread(false) is the
                    // fallback-handover path, and re-running it argument-less would
                    // silently change what the resumed thread does.
                    startThread(completeBatchFailure);
                });
                return;
            }
            // A normal advance (no recovery argument) starts processing a fresh batch,
            // so clear any split state carried over from the previous batch's recovery.
            if (completeBatchFailure !== false && completeBatchFailure !== true) {
                splitActive = false;
            }
            let activeLLM = "Not Set"
            if (llmToUse == "model1") {
                activeLLM = ep.model;
            } else if (llmToUse == "model2") {
                activeLLM = this.optionModel2.getValue();
            }
            if (activeLLM == "Not Set") {
                this.error("[DSLR] Unable to register LLM name.")
                console.error("[DSLR] Unable to register LLM name. llmToUse value got screwed up.")
                throw new Error("[DSLR] Unable to register LLM name. llmToUse value got screwed up.")
            }
            const translationBuffer = new LogBuffer("Accepted Translations");
            //this used to be customizable in the options menu, but nobody used it and it jsut made this way harder than it had to be
            var CustomDividerValue = "\n--- {дiv} ---\n";
            var CustomDividerCleanupRegex = /[\n \-{]*дiv\d*[}\n \-]*/g;
            var CustomDividerRemainsValue = "дiv";
            let batchLength = 0;
            let currentPlaceholderCount = 0;
            let maxPlaceholderCount = Math.max(0, this.optionMaxPlaceholderCount.getValue() - 1);
            let fullBFail = "No";
            let batch = [];
            let batchIndexes = [];
            let lastSuccessfulTranslations = [];
            let lastOriginalTexts = []; // Track original Japanese texts alongside translations
            let toTranslateTrimmed = "";
            let toTranslateToPush = "";
            let toTranslateTrimmedCount = 0;
            let customDividerLength = CustomDividerValue.length;
            let minBatchLines = this.optionMinLines.getValue() || 0;
            let maxBatchLines = Math.max(0, this.optionMaxLines.getValue() - 1);
            if (llmToUse == "model2" && completeBatchFailure == false) {
                maxPlaceholderCount = Math.max(0, this.optionMaxPlaceholderCount2.getValue() - 1);
                minBatchLines = this.optionMinLines2.getValue() || 0;
                if (splitActive && persistentBatch.length > 0) {
                    // We are mid-recovery and the batch was already split. Retry the SAME
                    // (already-split) batch the primary just failed on instead of rebuilding
                    // the full original batch, otherwise the fallback/split cycle never makes
                    // progress and loops forever between the full and split sizes.
                    maxBatchLines = persistentBatch.length - 1;
                } else {
                    maxBatchLines = Math.max(0, this.optionMaxLines2.getValue() - 1);
                }
                toTranslate = toTranslateLast;
                translatingIndex = translatingIndexLast;
            } else if (llmToUse == "model2" && completeBatchFailure == true) {
                maxPlaceholderCount = Math.max(0, this.optionMaxPlaceholderCount2.getValue() - 1);
                minBatchLines = this.optionMinLines2.getValue() || 0;
                if (parseInt(persistentBatch.length * 0.5) < minBatchLines && parseInt(persistentBatch.length * 0.75) >= minBatchLines) {
                    maxBatchLines = parseInt(persistentBatch.length * 0.75);
                } else {
                    maxBatchLines = parseInt(persistentBatch.length * 0.5);
                }
                toTranslate = toTranslateLast;
                translatingIndex = translatingIndexLast;
            } else if (llmToUse == "model1" && completeBatchFailure == true) {
                if (parseInt(persistentBatch.length * 0.5) < minBatchLines && parseInt(persistentBatch.length * 0.75) >= minBatchLines) {
                    maxBatchLines = parseInt(persistentBatch.length * 0.75);
                } else {
                    maxBatchLines = parseInt(persistentBatch.length * 0.5);
                }
                toTranslate = toTranslateLast;
                translatingIndex = translatingIndexLast;
            }
            toTranslateLast = toTranslate;
            translatingIndexLast = translatingIndex;
            while (translatingIndex < toTranslate.length) {
                let index = translatingIndex;
                if (toTranslate[index] !== undefined) {
                    toTranslateTrimmed = toTranslate[index];
                    toTranslateToPush = toTranslate[index];
                    if (llmToUse == "model2" ? this.optionEnableRemoveRepetition2.getValue() : this.optionEnableRemoveRepetition.getValue()) {
                        toTranslateToPush = toTranslateToPush.replaceAll(/([一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ])\1\1\1\1\1+/g, "$1$1$1$1$1");
                    }
                    if (llmToUse == "model2" ? this.optionEnableRemoveInnerIDSP2.getValue() : this.optionEnableRemoveInnerIDSP.getValue()) {
                        toTranslateToPush = toTranslateToPush.replaceAll(/(?<!^|　)　/g, "");
                    }
                    toTranslateTrimmedCount = toTranslateToPush.length;
                } else {
                    break;
                }
                if (ep.enableFullBatch == false) {
                    batch.push(toTranslateToPush);
                    batchIndexes.push(index);
                    translatingIndex++;
                //Make The second last batch smaller to allow the last batch to reach minimum sent lines, unless there's still more than half of the allowed character limit left 
                } else if (batch.length >= minBatchLines && (toTranslate.length - translatingIndex) == minBatchLines && (batchLength + toTranslateTrimmedCount) > (maximumBatchSize / 2)) {
                    console.log("[DSLR] Reduced the current batch size to make last batch reach Minimum Sent Lines.");
                    break;
                //Combine the last 2 batches if it is unable to allocate the minimum sent lines amount for the last unless that would go over the maximum sent lines limit or significantly over the character target.
                } else if (toTranslate[index] !== undefined && (batch.length <= maxBatchLines || maxBatchLines == 0) && (currentPlaceholderCount <= maxPlaceholderCount || maxPlaceholderCount == 0 || batch.length <= minBatchLines || (toTranslate.length - translatingIndex) < minBatchLines) && (batchLength == 0 || batchLength + toTranslateTrimmedCount <= maximumBatchSize || batch.length <= minBatchLines || (toTranslate.length - translatingIndex) < minBatchLines)) {
                    batch.push(toTranslateToPush);
                    batchIndexes.push(index);
                    batchLength += toTranslateTrimmedCount;
                    batchLength += customDividerLength + 2;
                    if (toTranslateToPush.match(/@\d+|\\+[nvic][w]?\[\d+\]/gi) != null) {
                        currentPlaceholderCount += toTranslateToPush.match(/@\d+|\\+[nvic][w]?\[\d+\]/gi).length;
                    }
                    translatingIndex++;
                } else {
                    if (sceneBreakSet.size > 0 && batchIndexes.length > 1) {
                        var rewindPos = -1;
                        for (var rbi = batchIndexes.length - 1; rbi >= 1; rbi--) {
                            if (sceneBreakSet.has(batchIndexes[rbi])) {
                                rewindPos = rbi;
                                break;
                            }
                        }
                        if (rewindPos > 0) {
                            translatingIndex = batchIndexes[rewindPos];
                            batch.length = rewindPos;
                            batchIndexes.length = rewindPos;
                        }
                    }
                    break;
                }
            }
            let batchWasNeverBigEnough = false;
            if (toTranslate.length < minBatchLines && batch.length != 0 && toTranslate != undefined && completeBatchFailure != true) {
                console.error(`[DSLR] Batch sent to DSLR only had ${toTranslate.length} translation requests. Unable to fulfill the Minimum Sent Translation Requests requirement of ${minBatchLines}.`);
                this.error(`[DSLR] Batch sent to DSLR only had ${toTranslate.length} translation requests. Unable to fulfill the Minimum Sent Translation Requests requirement of ${minBatchLines}.`);
                batchWasNeverBigEnough = true;
            }
            if (batch.length == 0 && (llmToUse == "model1" || this.optionEnableFallback.getValue() == false)) {
                complete();
                return;
            } else if (batch.length == 0 && llmToUse == "model2") {
                console.error("[DSLR] Fallback logic did not work. Batch ended up empty.");
                this.error("[DSLR] Fallback logic did not work. Batch ended up empty.");
                this.aborted = true;
            } else if (batch.length < minBatchLines && (toTranslate.length - translatingIndex + batch.length) < minBatchLines && completeBatchFailure != true && batchWasNeverBigEnough == false) {
                console.error(`[DSLR] Unable to fulfill Minimum Sent Translation Requests requirement of ${minBatchLines}.`);
                this.error(`[DSLR] Unable to fulfill Minimum Sent Translation Requests requirement of ${minBatchLines}. This is normal if the last batch was split after several rejections, or if combining the last 2 batches would have exceeded the Maximum Sent Request value.`);
            }
            if (window.transConfig.japanesesource == true && batch.toString().match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) == null) {
                for (let i = 0; i < batch.length; i++) {
                    translations[batchIndexes[i]] = batch[i];
                }
                // Update count with the specific indices that were processed
                updateTranslatedCount(0, batchIndexes);
                this.log(`[DSLR] Skipped batch of ${batch.length} translation requests because it did not include any Japanese.`);
                console.log(`[DSLR] Skipped batch of ${batch.length} translation requests because it did not include any Japanese.`);
                startThread();
            }
            var llmName = this.optionModel.getValue() || 'Unspecified LLM';
            if (llmToUse == "model2" && this.optionEnableFallback.getValue() == true) {
                llmName = this.optionModel2.getValue() || 'Unspecified LLM';
                llmName = llmName.replaceAll(/^.*[\\\/]+/g, "");
                llmName = llmName.replaceAll(/:.*$/g, "");
                llmName = llmName.replaceAll(/[\?\"\<\>|]/g, "");
                if (llmName == "" && this.optionModel2.getValue() != "") {
                    console.error("[DSLR] Weird model name, trimming less.");
                    llmName = this.optionModel2.getValue().replaceAll(/[\?\"\<\>|\\\/]/g, "-");
                    if (llmName == "" || llmName.match(/[^\-]/g) == null) {
                        console.error("[DSLR] Unusable model name. using 'Unspecified LLM'.");
                        llmName = "Unspecified LLM";
                    }
                } else if (llmName == "" && this.optionModel2.getValue() == "") {
                    console.error("[DSLR] No model name found. Using 'Unspecified LLM'.");
                    llmName = "Unspecified LLM";
                }
            } else {
                llmName = llmName.replaceAll(/^.*[\\\/]+/g, "");
                llmName = llmName.replaceAll(/:.*$/g, "");
                llmName = llmName.replaceAll(/[\?\"\<\>|]/g, "");
                if (llmName == "" && this.optionModel.getValue() != "") {
                    console.error("[DSLR] Weird model name, trimming less.");
                    llmName = this.optionModel.getValue().replaceAll(/[\?\"\<\>|\\\/]/g, "-");
                    if (llmName == "" || llmName.match(/[^\-]/g) == null) {
                        console.error("[DSLR] Unusable model name. using 'Unspecified LLM'.");
                        llmName = "Unspecified LLM";
                    }
                } else if (llmName == "" && this.optionModel.getValue() == "") {
                    console.error("[DSLR] No model name found. Using 'Unspecified LLM'.");
                    llmName = "Unspecified LLM";
                }
            }
            persistentBatch = batch;
            persistentBatchLength = batchLength;
            persistentBatchIndexes = batchIndexes;
            var llmTemp = ep.temperature;
            var llmTopK = ep['top_k'];
            var llmTopP = ep['top_p'];
            var llmMinP = ep['min_p'];
            var llmReqDelay = ep.requestDelay;
            var llmRepeatPen = ep.repeat_penalty;
            var llmRepetitionPen = ep.repetition_penalty;
            var freqPen = ep.frequency_penalty;
            var presPen = ep.presence_penalty;
            var chatTempKwargs = ep.chat_template_kwargs;
            var llmStream = "";
            if (ep.disableStream == true) {
                llmStream = false;
            }
            let BatchSystemPromptValue = ep.batchSystemPrompt;
            let BatchUserPromptValue = ep.batchUserPrompt;
            let jsonBatchUserPromptValue = "";
            let BatchRetryPrompt = ep.batchRetryPrompt;
            let AggressiveBatchRetryPrompt = ep.aggressiveBatchRetryPrompt;
            var RetryPrompt = ep.retryPrompt;
            var SystemPromptValue = ep.systemPrompt;
            var UserPromptValue = ep.userPrompt;
            var SystemPromptAdditionValue = ep.systemPromptaddition;
            if (llmToUse == "model2") {
                BatchSystemPromptValue = this.optionBatchSystemPrompt2.getValue();
                if (this.optionEnableJsonFullBatch2.getValue()) {
                    BatchSystemPromptValue = this.optionJsonBatchSystemPrompt2.getValue();
                }
                BatchUserPromptValue = this.optionBatchUserPrompt2.getValue();
                BatchRetryPrompt = this.optionBatchRetryPrompt2.getValue();
                AggressiveBatchRetryPrompt = this.optionAggressiveBatchRetryPrompt2.getValue();
                RetryPrompt = this.optionRetryPrompt2.getValue();
                SystemPromptValue = this.optionSystemPrompt2.getValue();
                UserPromptValue = this.optionUserPrompt2.getValue();
                SystemPromptAdditionValue = this.optionSystemPromptaddition2.getValue();
            }
            if (ep.enableJsonFullBatch && llmToUse == "model1") {
                BatchSystemPromptValue = ep.jsonBatchSystemPrompt;
                BatchUserPromptValue = ep.jsonBatchUserPrompt;
                BatchRetryPrompt = ep.jsonBatchRetryPrompt;
                AggressiveBatchRetryPrompt = ep.aggressiveJsonBatchRetryPrompt;
            } else if (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") {
                BatchSystemPromptValue = this.optionJsonBatchSystemPrompt2.getValue();
                BatchUserPromptValue = this.optionJsonBatchUserPrompt2.getValue();
                BatchRetryPrompt = this.optionJsonBatchRetryPrompt2.getValue();
                AggressiveBatchRetryPrompt = this.optionAggressiveJsonBatchRetryPrompt2.getValue();
            }
            var batchwassuccessfull = "not done";
            var batchforbatchtrans = [];
            var tjsonRequest = "";
            var tjsonRequestOrigPlaceholder = "";
            var jsonRequest = "";
            var jsonRequestOrigPlaceholder = "";
            var batchforbatchtransLineLogic = "";
            var batchforbatchtransLineLogicOrigPlaceholder = "";
            var batchforbatchtransLineLogicForCounting = "";
            var batchforbatchtransOrigPlaceholder = batch;
            var responseBeforeCleanupOrigPlaceholder = "";
            var jsonResponseOrigPlaceholder = "";
            var jsonResponse = "";
            var jsonData = "";
            var jsonData2 = "";
            var responseBeforeCleanup = "";
            var nameCommandRestore = "";
            var characterCommandRestore = "";
            var imageCommandRestore = "";
            var variableCommandRestore = "";
            var colorCommandRestore = "";
            var placeholderRestore = "";
            var nameCommandRestore2 = "";
            var characterCommandRestore2 = "";
            var imageCommandRestore2 = "";
            var variableCommandRestore2 = "";
            var colorCommandRestore2 = "";
            var placeholderRestore2 = "";
            var originalPlacolderText = "";
            if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                nameCommandRestore = this.optionNameCommandReplacer.getValue().replaceAll(/\\/g, "\\\\");
                nameCommandRestore = nameCommandRestore.replaceAll(/\[/g, "\\[");
                nameCommandRestore = nameCommandRestore.replaceAll(/\]/g, "\\]");
                nameCommandRestore = nameCommandRestore.replaceAll(/\(/g, "\\(");
                nameCommandRestore = nameCommandRestore.replaceAll(/\)/g, "\\)");
                nameCommandRestore = nameCommandRestore.replaceAll(/\//g, "\\\/");
                nameCommandRestore = nameCommandRestore.replaceAll(/\$1/g, "(\\d+)");
                nameCommandRestore = new RegExp(nameCommandRestore, 'gi');
                BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                SystemPromptValue = SystemPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                UserPromptValue = UserPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                RetryPrompt = RetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
            }
            if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                characterCommandRestore = this.optionCharacterCommandReplacer.getValue().replaceAll(/\\/g, "\\\\");
                characterCommandRestore = characterCommandRestore.replaceAll(/\[/g, "\\[");
                characterCommandRestore = characterCommandRestore.replaceAll(/\]/g, "\\]");
                characterCommandRestore = characterCommandRestore.replaceAll(/\(/g, "\\(");
                characterCommandRestore = characterCommandRestore.replaceAll(/\)/g, "\\)");
                characterCommandRestore = characterCommandRestore.replaceAll(/\//g, "\\\/");
                characterCommandRestore = characterCommandRestore.replaceAll(/\$1/g, "(\\d+)");
                characterCommandRestore = new RegExp(characterCommandRestore, 'gi');
                BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                SystemPromptValue = SystemPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                UserPromptValue = UserPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                RetryPrompt = RetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
            }
            if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                imageCommandRestore = this.optionImageCommandReplacer.getValue().replaceAll(/\\/g, "\\\\");
                imageCommandRestore = imageCommandRestore.replaceAll(/\[/g, "\\[");
                imageCommandRestore = imageCommandRestore.replaceAll(/\]/g, "\\]");
                imageCommandRestore = imageCommandRestore.replaceAll(/\(/g, "\\(");
                imageCommandRestore = imageCommandRestore.replaceAll(/\)/g, "\\)");
                imageCommandRestore = imageCommandRestore.replaceAll(/\//g, "\\\/");
                imageCommandRestore = imageCommandRestore.replaceAll(/\$1/g, "(\\d+)");
                imageCommandRestore = new RegExp(imageCommandRestore, 'gi');
                BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                SystemPromptValue = SystemPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                UserPromptValue = UserPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                RetryPrompt = RetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
            }
            if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                variableCommandRestore = this.optionVariableCommandReplacer.getValue().replaceAll(/\\/g, "\\\\");
                variableCommandRestore = variableCommandRestore.replaceAll(/\[/g, "\\[");
                variableCommandRestore = variableCommandRestore.replaceAll(/\]/g, "\\]");
                variableCommandRestore = variableCommandRestore.replaceAll(/\(/g, "\\(");
                variableCommandRestore = variableCommandRestore.replaceAll(/\)/g, "\\)");
                variableCommandRestore = variableCommandRestore.replaceAll(/\//g, "\\\/");
                variableCommandRestore = variableCommandRestore.replaceAll(/\$1/g, "(\\d+)");
                variableCommandRestore = new RegExp(variableCommandRestore, 'gi');
                BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                SystemPromptValue = SystemPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                UserPromptValue = UserPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                RetryPrompt = RetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
            }
            if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                colorCommandRestore = this.optionColorCommandReplacer.getValue().replaceAll(/\\/g, "\\\\");
                colorCommandRestore = colorCommandRestore.replaceAll(/\[/g, "\\[");
                colorCommandRestore = colorCommandRestore.replaceAll(/\]/g, "\\]");
                colorCommandRestore = colorCommandRestore.replaceAll(/\(/g, "\\(");
                colorCommandRestore = colorCommandRestore.replaceAll(/\)/g, "\\)");
                colorCommandRestore = colorCommandRestore.replaceAll(/\//g, "\\\/");
                colorCommandRestore = colorCommandRestore.replaceAll(/\$1/g, "(\\d+)");
                colorCommandRestore = new RegExp(colorCommandRestore, 'gi');
                BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                SystemPromptValue = SystemPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                UserPromptValue = UserPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                RetryPrompt = RetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
            }
            if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                placeholderRestore = this.optionPlaceholderReplacer.getValue().replaceAll(/\\/g, "\\\\");
                placeholderRestore = placeholderRestore.replaceAll(/\[/g, "\\[");
                placeholderRestore = placeholderRestore.replaceAll(/\]/g, "\\]");
                placeholderRestore = placeholderRestore.replaceAll(/\(/g, "\\(");
                placeholderRestore = placeholderRestore.replaceAll(/\)/g, "\\)");
                placeholderRestore = placeholderRestore.replaceAll(/\//g, "\\\/");
                placeholderRestore = placeholderRestore.replaceAll(/\$1/g, "(\\d+)");
                placeholderRestore = new RegExp(placeholderRestore, 'gi');
                BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                BatchUserPromptValue = BatchUserPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                BatchRetryPrompt = BatchRetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                SystemPromptValue = SystemPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                UserPromptValue = UserPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                RetryPrompt = RetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
            }
            if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                nameCommandRestore2 = this.optionNameCommandReplacer2.getValue().replaceAll(/\\/g, "\\\\");
                nameCommandRestore2 = nameCommandRestore2.replaceAll(/\[/g, "\\[");
                nameCommandRestore2 = nameCommandRestore2.replaceAll(/\]/g, "\\]");
                nameCommandRestore2 = nameCommandRestore2.replaceAll(/\(/g, "\\(");
                nameCommandRestore2 = nameCommandRestore2.replaceAll(/\)/g, "\\)");
                nameCommandRestore2 = nameCommandRestore2.replaceAll(/\//g, "\\\/");
                nameCommandRestore2 = nameCommandRestore2.replaceAll(/\$1/g, "(\\d+)");
                nameCommandRestore2 = new RegExp(nameCommandRestore2, 'gi');
                if (llmToUse == "model2") {
                    BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                    BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                    BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                    AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                    SystemPromptValue = SystemPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                    UserPromptValue = UserPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                    SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                    RetryPrompt = RetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                }
            }
            if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                characterCommandRestore2 = this.optionCharacterCommandReplacer2.getValue().replaceAll(/\\/g, "\\\\");
                characterCommandRestore2 = characterCommandRestore2.replaceAll(/\[/g, "\\[");
                characterCommandRestore2 = characterCommandRestore2.replaceAll(/\]/g, "\\]");
                characterCommandRestore2 = characterCommandRestore2.replaceAll(/\(/g, "\\(");
                characterCommandRestore2 = characterCommandRestore2.replaceAll(/\)/g, "\\)");
                characterCommandRestore2 = characterCommandRestore2.replaceAll(/\//g, "\\\/");
                characterCommandRestore2 = characterCommandRestore2.replaceAll(/\$1/g, "(\\d+)");
                characterCommandRestore2 = new RegExp(characterCommandRestore2, 'gi');
                if (llmToUse == "model2") {
                    BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                    BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                    BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                    AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                    SystemPromptValue = SystemPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                    UserPromptValue = UserPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                    SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                    RetryPrompt = RetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                }
            }
            if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                imageCommandRestore2 = this.optionImageCommandReplacer2.getValue().replaceAll(/\\/g, "\\\\");
                imageCommandRestore2 = imageCommandRestore2.replaceAll(/\[/g, "\\[");
                imageCommandRestore2 = imageCommandRestore2.replaceAll(/\]/g, "\\]");
                imageCommandRestore2 = imageCommandRestore2.replaceAll(/\(/g, "\\(");
                imageCommandRestore2 = imageCommandRestore2.replaceAll(/\)/g, "\\)");
                imageCommandRestore2 = imageCommandRestore2.replaceAll(/\//g, "\\\/");
                imageCommandRestore2 = imageCommandRestore2.replaceAll(/\$1/g, "(\\d+)");
                imageCommandRestore2 = new RegExp(imageCommandRestore2, 'gi');
                if (llmToUse == "model2") {
                    BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                    BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                    BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                    AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                    SystemPromptValue = SystemPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                    UserPromptValue = UserPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                    SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                    RetryPrompt = RetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                }
            }
            if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                variableCommandRestore2 = this.optionVariableCommandReplacer2.getValue().replaceAll(/\\/g, "\\\\");
                variableCommandRestore2 = variableCommandRestore2.replaceAll(/\[/g, "\\[");
                variableCommandRestore2 = variableCommandRestore2.replaceAll(/\]/g, "\\]");
                variableCommandRestore2 = variableCommandRestore2.replaceAll(/\(/g, "\\(");
                variableCommandRestore2 = variableCommandRestore2.replaceAll(/\)/g, "\\)");
                variableCommandRestore2 = variableCommandRestore2.replaceAll(/\//g, "\\\/");
                variableCommandRestore2 = variableCommandRestore2.replaceAll(/\$1/g, "(\\d+)");
                variableCommandRestore2 = new RegExp(variableCommandRestore2, 'gi');
                if (llmToUse == "model2") {
                    BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                    BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                    BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                    AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                    SystemPromptValue = SystemPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                    UserPromptValue = UserPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                    SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                    RetryPrompt = RetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                }
            }
            if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                colorCommandRestore2 = this.optionColorCommandReplacer2.getValue().replaceAll(/\\/g, "\\\\");
                colorCommandRestore2 = colorCommandRestore2.replaceAll(/\[/g, "\\[");
                colorCommandRestore2 = colorCommandRestore2.replaceAll(/\]/g, "\\]");
                colorCommandRestore2 = colorCommandRestore2.replaceAll(/\(/g, "\\(");
                colorCommandRestore2 = colorCommandRestore2.replaceAll(/\)/g, "\\)");
                colorCommandRestore2 = colorCommandRestore2.replaceAll(/\//g, "\\\/");
                colorCommandRestore2 = colorCommandRestore2.replaceAll(/\$1/g, "(\\d+)");
                colorCommandRestore2 = new RegExp(colorCommandRestore2, 'gi');
                if (llmToUse == "model2") {
                    BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                    BatchUserPromptValue = BatchUserPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                    BatchRetryPrompt = BatchRetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                    AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                    SystemPromptValue = SystemPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                    UserPromptValue = UserPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                    SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                    RetryPrompt = RetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                }
            }
            if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                placeholderRestore2 = this.optionPlaceholderReplacer2.getValue().replaceAll(/\\/g, "\\\\");
                placeholderRestore2 = placeholderRestore2.replaceAll(/\[/g, "\\[");
                placeholderRestore2 = placeholderRestore2.replaceAll(/\]/g, "\\]");
                placeholderRestore2 = placeholderRestore2.replaceAll(/\(/g, "\\(");
                placeholderRestore2 = placeholderRestore2.replaceAll(/\)/g, "\\)");
                placeholderRestore2 = placeholderRestore2.replaceAll(/\//g, "\\\/");
                placeholderRestore2 = placeholderRestore2.replaceAll(/\$1/g, "(\\d+)");
                placeholderRestore2 = new RegExp(placeholderRestore2, 'gi');
                if (llmToUse == "model2") {
                    BatchSystemPromptValue = BatchSystemPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                    BatchUserPromptValue = BatchUserPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                    BatchRetryPrompt = BatchRetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                    AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                    SystemPromptValue = SystemPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                    UserPromptValue = UserPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                    SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                    RetryPrompt = RetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                }
            }
            var BatchSystemPrompt = BatchSystemPromptValue;
            // KV-Cache Friendly Prompts: everything that can change between requests is
            // collected here (instead of being appended to the system prompt) and sent as
            // its own user message, so the system message stays identical across requests.
            // BatchSystemPrompt always keeps the full combined prompt (base + addition),
            // because the context token budget below is computed from it in both modes.
            var BatchVariableContext = "";
            var _cacheFriendly = this._cacheFriendlyPromptsActive();
            var lastRejectReason = "";
            var lastResponseForServerError = "";
            var lastCorrectionPromptForServerError = "";
            var lastCorrectionRequest = "";
            var lastCorrectionPromptForServerError2 = "";
            var thereWasServerError = false;
            var newtranslatedLines = [];
            var retryPromptAddition = "";
            var abortTranslation = "false";
            if (SystemPromptAdditionValue != undefined && SystemPromptAdditionValue != "" && SystemPromptAdditionValue != null) {
                if ((this.optionSystemPromptAdditionTrim.getValue() == true && llmToUse == "model1") || (this.optionSystemPromptAdditionTrim2.getValue() == true && llmToUse == "model2")) {
                    SystemPromptAdditionValue = trimLinesMatchTerms(SystemPromptAdditionValue, batch, 0);
                }
                BatchSystemPrompt = BatchSystemPromptValue + SystemPromptAdditionValue;
                if (_cacheFriendly) BatchVariableContext += SystemPromptAdditionValue;
            }
            var _fbUserText = BatchUserPromptValue + (Array.isArray(toTranslate) ? toTranslate.join("\n") : String(toTranslate));
            var _fbGlossaryFilter = Array.isArray(batch) ? batch.join("\n") : String(batch);
            var _fitted = this._buildAndFitDynamicContext(BatchSystemPrompt, _fbUserText, _fbGlossaryFilter, options, endpointNumber, llmToUse);
            if (_fitted.glossary) {
                if (_cacheFriendly) BatchVariableContext += _fitted.glossary;
                else BatchSystemPrompt = BatchSystemPrompt + _fitted.glossary;
            }
            if (_fitted.scene) {
                if (_cacheFriendly) BatchVariableContext += _fitted.scene;
                else BatchSystemPrompt = BatchSystemPrompt + _fitted.scene;
            }
            var apiKey = ep.apiKey;
            var apiUrl = EndpointHelpers_1.fixApiUrl(ep.apiUrl, ep.doNotFixURL);
            if (!apiUrl) {
                this.error("[DSLR] No api url entry found.");
                console.error("[DSLR] No api url entry found.");
            }
            var translatedLines = [];
            // Full Batch Processing
            if ((ep.enableFullBatch == true && batch.length > 1 && llmToUse == "model1") || (this.optionEnableFullBatch2.getValue() == true && batch.length > 1 && llmToUse == "model2")) {
                this.log(`[DSLR] Sending batch of ${batch.length} translation requests to ${llmName}.`);
                try {
                    let errorBody = ""
                    let maxRetries = this.optionEnableRetry.getValue() ? 2 : 0;
                    if (llmToUse == "model2") {
                        maxRetries = this.optionEnableRetry2.getValue() ? 2 : 0;
                    }
                    let batchretryDelay = 5000; // 5 seconds between retries
                    let retryCount = 0;
                    let lengthproblem = 'false';
                    let placeholderproblem = 'false';
                    let commandproblem = 'false';
                    let wrongorder = 'false';
                    let batchCommandCorrectionRequest = "";
                    let problemExplainerPromptAddition = "";
                    let problemExplainerErrorAddition = "";
                    let RefusalRetryCount = 0;
                    let MaxRefusalRetries = 2;
                    let serverRetryCount = 0;
                    // When a fallback model is configured, don't waste minutes hammering a
                    // crashed/auth-failed/dead primary provider with escalating delays: cap its
                    // server-error retries low so the fallback model takes over quickly instead.
                    let serverFallbackActive = (llmToUse == "model1" && this.optionEnableFallback.getValue() == true && this.optionLimitFallback.getValue() == false);
                    let MaxserverRetries = serverFallbackActive ? 2 : 5;
                    let MaxserverRetriesFTF = serverFallbackActive ? 2 : 6;
                    let MaxserverRetries429 = serverFallbackActive ? 2 : 12;
                    let MaxserverRetries400 = 2;
                    let serverRetriesdelay = 30000;
                    let Retries429Delay = 3000;
                    let Retries400Delay = 10000;
                    responseBeforeCleanup = "";
                    jsonData = "";
                    jsonData2 = "";
                    let translatedText;
                    let TextOrig;
                    batchforbatchtrans = [];
                    batchforbatchtransOrigPlaceholder = [];
                    for (let i = 0; i < batch.length; i++) {
                        let originalText = batch[i];
                        let trimmedOriginalText = originalText;
                        trimmedOriginalText = trimmedOriginalText.replaceAll(/^\s*[\n\r]/g, "");
                        trimmedOriginalText = trimmedOriginalText.replaceAll(/[\n\r]\s*;?$/g, "");
                        trimmedOriginalText = trimmedOriginalText.replaceAll(/^\s*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+/g, "");
                        if (trimmedOriginalText.match(/\\[cdinvw]\[[^\]\r\n]+\]\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$|\\[n][w]\[[^\]\r\n]+\]\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$/gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/(\\[cdinvw])\[([^\]]+)\](\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$)/gi, "$1SHIBRACK$2SHIBRACK$3");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/(\\[n][w])\[([^\]]+)\](\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$)/gi, "$1SHIBRACK$2SHIBRACK$3");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+\s*;?$/gi, "");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/SHIBRACK(.*?)SHIBRACK/g, "\[$1\]");
                        } else {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+\s*;?$/gi, "");
                        }
                        if (trimmedOriginalText.match(/^[^〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“]+?[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+[^\s]/g) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^([^〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“]+?)([\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+)([^\s])/g, '"$1"$3');
                        }
                        if (trimmedOriginalText.match(/^[^〔⟨〖〘〚｢〈《「『【（［\[\({＜<｛｟]+?[\]\)}〕〗〙〛｣〉》」』】）］＞>｝｠⟩]+(?!\s*;?$)/g) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^([^〔⟨〖〘〚｢〈《「『【（［\[\({＜<｛｟]+?)([\]\)}〕〗〙〛｣〉》」』】）］＞>｝｠⟩]+)(?!\s*;?$)/g, '"$1"');
                        }
                        if (trimmedOriginalText.match(/^(?:[^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]|\\+[civn]w?\[\d+\])+([〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“])[^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+?$/g) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^((?:[^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]|\\+[civn]w?\[\d+\])+)[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“]([^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+?)$/g, '$1"$2"');
                        }
                        if (trimmedOriginalText.match(/^D_TEXT .*? \d+$/gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^D_TEXT /gi, "");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/ \d+$/gi, "");
                        } else if (trimmedOriginalText.match(/^D_TEXT /gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^D_TEXT /gi, "");
                        } else if (trimmedOriginalText.match(/(?<=[\.?!,？！、。\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]) \d+$/gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/ \d+$/gi, "");
                        }
                        if (this.optionReplaceLinebreaks.getValue()) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/\n/g, "<br>");
                        }
                        batchforbatchtransOrigPlaceholder.push(trimmedOriginalText);
                        if (llmToUse == "model1" && trimmedOriginalText.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                            if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                            }
                            if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                            }
                            if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                            }
                            if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                            }
                            if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                            }
                            if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                            }
                        } else if (llmToUse == "model2" && trimmedOriginalText.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                            if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                            }
                            if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                            }
                            if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                            }
                            if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                            }
                            if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                            }
                            if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/(@\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                            }
                        }
                        batchforbatchtrans.push(trimmedOriginalText);
                    }
                    if (batch.length != batchforbatchtrans.length) {
                        console.error(`[DSLR] Initial batch went fubar after removing brackets.`);
                        throw new Error(`[DSLR] Initial batch went fubar after removing brackets.`);
                    }
                    tjsonRequest = {
                      translations: batchforbatchtrans.map((text, index) => ({
                        id: index,
                        original: text
                      }))
                    };
                    tjsonRequestOrigPlaceholder = {
                      translations: batchforbatchtransOrigPlaceholder.map((text, index) => ({
                        id: index,
                        original: text
                      }))
                    };
                    // Convert back to JSON
                    jsonRequest = JSON.stringify(tjsonRequest, null, 2);
                    jsonRequestOrigPlaceholder = JSON.stringify(tjsonRequestOrigPlaceholder, null, 2);
                    batchforbatchtransLineLogic = batchforbatchtrans.reduce((acc, item, index) => {
                      if (index > 0) acc.push('\n');
                      acc.push(`--- {дiv${index + 1}} ---`, '\n', item);
                      return acc;
                    }, []).join('');
                    batchforbatchtransLineLogicOrigPlaceholder = batchforbatchtransOrigPlaceholder.reduce((acc, item, index) => {
                      if (index > 0) acc.push('\n');
                      acc.push(`--- {дiv${index + 1}} ---`, '\n', item);
                      return acc;
                    }, []).join('');
                    let maxTokenValue = this.optionMaxTokens.getValue();
                    if (llmToUse == "model2") {
                        maxTokenValue = this.optionMaxTokens2.getValue();
                        apiKey = this.optionApiKey2.getValue();
                        apiUrl = EndpointHelpers_1.fixApiUrl(this.optionApiUrl2.getValue(), this.optionDoNotFixURL2.getValue());
                        if (!apiUrl) {
                            this.error("[DSLR] No api url entry found.");
                            console.error("[DSLR] No api url entry found.");
                        }
                        llmTemp = this.optionTemperature2.getValue();
                        llmTopK = this.optionTopK2.getValue();
                        llmTopP = this.optionTopP2.getValue();
                        llmMinP = this.optionMinP2.getValue();
                        llmReqDelay = this.optionRequestDelay2.getValue();
                        llmRepeatPen = this.optionRepeatPenalty2.getValue();
                        llmRepetitionPen = this.optionRepetitionPenalty2.getValue();
                        freqPen = this.optionFrequencyPenalty2.getValue();
                        presPen = this.optionPresencePenalty2.getValue();
                        chatTempKwargs = this.optionChatTemplateKwargs2.getValue();
                        if (this.optionDisableStream2.getValue() == true) {
                            llmStream = false;
                        }
                    } else if (llmToUse == "model1") {
                        maxTokenValue = ep.maxTokens;
                        apiKey = ep.apiKey;
                        apiUrl = EndpointHelpers_1.fixApiUrl(ep.apiUrl, ep.doNotFixURL);
                        llmTemp = ep.temperature;
                        llmTopK = ep['top_k'];
                        llmTopP = ep['top_p'];
                        llmMinP = ep['min_p'];
                        llmReqDelay = ep.requestDelay;
                        llmRepeatPen = ep.repeat_penalty;
                        llmRepetitionPen = ep.repetition_penalty;
                        freqPen = ep.frequency_penalty;
                        presPen = ep.presence_penalty;
                        chatTempKwargs = ep.chat_template_kwargs;
                        if (ep.disableStream == true) { llmStream = false; }
                    }
                    if (this._isReasoningActive(llmToUse, endpointNumber)) {
                        console.log("[DSLR] Reasoning enabled (" + this._reasoningFormatFor(llmToUse, endpointNumber) + ").");
                    } else {
                        if (maxTokenValue > batchforbatchtransLineLogic.length * 1.5 && ep.enableReasoning == false && (!ResponsesApiHelpers_1.isResponsesApiUrl(apiUrl) || this.optionScaleMaxTokensResponses.getValue())) {
                            maxTokenValue = batchforbatchtransLineLogic.length * 1.5;
                            maxTokenValue = parseInt(maxTokenValue);
                            if (maxTokenValue < 500) {
                                maxTokenValue = 500;
                            }
                        }
                    }
                    let sectionMarkerUserPrompt = BatchUserPromptValue + batchforbatchtransLineLogic;
                    let jsonUserPromptFront = BatchUserPromptValue.match(/^[\s\S]+(?=TRANSLATIONREQUESTJSON)/);
                    let jsonUserPromptBack = BatchUserPromptValue.match(/(?<=TRANSLATIONREQUESTJSON)[\s\S]+$/);
                    let jsonUserPrompt = BatchUserPromptValue;
                    if (jsonUserPromptFront != null && jsonUserPromptBack != null) {
                        jsonUserPrompt = jsonUserPromptFront + jsonRequest + jsonUserPromptBack;
                    } else if (jsonUserPromptFront != null && jsonUserPromptBack == null) {
                        jsonUserPrompt = jsonUserPromptFront + jsonRequest;
                    } else if (jsonUserPromptFront == null && jsonUserPromptBack != null) {
                        jsonUserPrompt = jsonRequest + jsonUserPromptBack;
                    } else if (jsonUserPromptFront == null && jsonUserPromptBack == null) {
                        jsonUserPrompt = jsonRequest;
                    }
                    var repPenaltyAddition = 0;
                    // Centralized recovery decision for when the current model has exhausted
                    // its correction-prompt retries on a batch. Hands the SAME batch to the
                    // fallback model before splitting (so the expensive model only runs when
                    // the cheap one truly cannot cope, and no context is lost by splitting
                    // prematurely). Only splits once the fallback also fails (or is disabled).
                    const attemptRecovery = (reasonMsg) => {
                        if (llmToUse == "model1" && this.optionEnableFallback.getValue() == true && this.optionLimitFallback.getValue() == false) {
                            this.error(`[DSLR] ${reasonMsg} Handing the batch to the fallback model before splitting it.`);
                            console.error(`[DSLR] ${reasonMsg} Handing the batch to the fallback model before splitting it.`);
                            llmToUse = "model2";
                            fullBFail = "Yes";
                            updateFullBatchFailCount(1);
                            recordFallbackHandover();
                            startThread(false);
                            return;
                        }
                        if (llmToUse == "model2") {
                            llmToUse = "model1";
                        }
                        // Mirror the split sizing startThread(true) will apply (model1 settings,
                        // since llmToUse is model1 here): the rebuilt batch can hold at most
                        // maxBatchLines + 1 lines. Splitting only makes progress if that is
                        // strictly smaller than the current batch. The old check
                        // (batch.length >= minBatchLines) was always true with the default
                        // minLines of 0, so a 2 line batch was "split" into the same 2 line
                        // batch forever (and a 1 line batch even re-expanded, since a
                        // maxBatchLines of 0 means unlimited), never reaching the line by
                        // line fallback below.
                        const splitMinLines = this.optionMinLines.getValue() || 0;
                        const halfSplit = parseInt(batch.length * 0.5);
                        const threeQuarterSplit = parseInt(batch.length * 0.75);
                        const splitCeiling = (halfSplit < splitMinLines && threeQuarterSplit >= splitMinLines) ? threeQuarterSplit : halfSplit;
                        if (batch.length >= splitMinLines && splitCeiling + 1 < batch.length) {
                            this.error(`[DSLR] ${reasonMsg} Splitting the batch into smaller requests, which is easier for less capable models.`);
                            console.error(`[DSLR] ${reasonMsg} Splitting the batch into smaller requests.`);
                            fullBFail = "Yes";
                            updateFullBatchFailCount(1);
                            splitActive = true;
                            recordBatchSplit();
                            startThread(true);
                            return;
                        }
                        this.error(`[DSLR] ${reasonMsg} Batch is too small to split, trying line by line instead.`);
                        console.error(`[DSLR] ${reasonMsg} Batch is too small to split, trying line by line instead.`);
                        batchwassuccessfull = "false";
                    };
                    // Re-resolve request-critical params for the CURRENT endpoint. The combined resolution
                    // above (apiKey = ep.apiKey ...) runs ONCE before this retry loop, so after a rotation
                    // changes ep/llmToUse we must call these to actually use the new endpoint's URL/key.
                    const _resolveFromEp = () => {
                        apiKey = ep.apiKey;
                        apiUrl = EndpointHelpers_1.fixApiUrl(ep.apiUrl, ep.doNotFixURL);
                        activeLLM = ep.model;
                        maxTokenValue = ep.maxTokens;
                        llmTemp = ep.temperature;
                        llmTopK = ep['top_k'];
                        llmTopP = ep['top_p'];
                        llmMinP = ep['min_p'];
                        llmReqDelay = ep.requestDelay;
                        llmRepeatPen = ep.repeat_penalty;
                        llmRepetitionPen = ep.repetition_penalty;
                        freqPen = ep.frequency_penalty;
                        presPen = ep.presence_penalty;
                        chatTempKwargs = ep.chat_template_kwargs;
                        llmStream = (ep.disableStream == true) ? false : "";
                    };
                    const _resolveFromFallback = () => {
                        apiKey = this.optionApiKey2.getValue();
                        apiUrl = EndpointHelpers_1.fixApiUrl(this.optionApiUrl2.getValue(), this.optionDoNotFixURL2.getValue());
                        activeLLM = this.optionModel2.getValue();
                        maxTokenValue = this.optionMaxTokens2.getValue();
                        llmTemp = this.optionTemperature2.getValue();
                        llmTopK = this.optionTopK2.getValue();
                        llmTopP = this.optionTopP2.getValue();
                        llmMinP = this.optionMinP2.getValue();
                        llmReqDelay = this.optionRequestDelay2.getValue();
                        llmRepeatPen = this.optionRepeatPenalty2.getValue();
                        llmRepetitionPen = this.optionRepetitionPenalty2.getValue();
                        freqPen = this.optionFrequencyPenalty2.getValue();
                        presPen = this.optionPresencePenalty2.getValue();
                        chatTempKwargs = this.optionChatTemplateKwargs2.getValue();
                        llmStream = (this.optionDisableStream2.getValue() == true) ? false : "";
                    };
                    while (retryCount <= maxRetries && !this.aborted) {
                        if (serverRetryCount > 0) {
                            serverRetriesdelay = serverRetriesdelay * 3;
                            Retries429Delay = Retries429Delay * 3;
                            Retries400Delay = Retries400Delay * 2;
                        }
                        if (thereWasServerError) {
                            responseBeforeCleanup = lastResponseForServerError;
                            responseBeforeCleanup = lastResponseForServerError;
                            problemExplainerPromptAddition = lastCorrectionPromptForServerError;
                            batchCommandCorrectionRequest = lastCorrectionPromptForServerError2;
                        }
                        let messages = [{
                            role: "system",
                            // KV-Cache Friendly Prompts: send only the constant base prompt so
                            // the system message is byte-identical for every request; otherwise
                            // the full combined prompt as before.
                            content: _cacheFriendly ? BatchSystemPromptValue : BatchSystemPrompt
                        }];
                        // KV-Cache Friendly Prompts: the per-batch context (System Prompt
                        // Addition, glossary, scene context) rides in its own user message
                        // instead of the system prompt, which stays constant for every request.
                        if (_cacheFriendly && BatchVariableContext && String(BatchVariableContext).trim() !== "") {
                            messages.push({
                                role: "user",
                                content: BatchVariableContext
                            });
                        }
                        if (retryCount == 0) {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                        } else if (retryCount == 1 && problemExplainerPromptAddition != "" && problemExplainerPromptAddition != undefined) {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "assistant",
                                content: responseBeforeCleanup
                            });
                            messages.push({
                                role: "user",
                                content: problemExplainerPromptAddition + `\n\nPlease carefully review the error and provide a corrected translation.`
                            });
                        } else if (retryCount == 1 && batchCommandCorrectionRequest != "" && batchCommandCorrectionRequest != undefined) {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "assistant",
                                content: responseBeforeCleanup
                            });
                            messages.push({
                                role: "user",
                                content: batchCommandCorrectionRequest + `\n\nPlease carefully review the error and provide a corrected translation.`
                            });
                        } else if (retryCount == 1 && responseBeforeCleanup != undefined && responseBeforeCleanup != "") {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "user",
                                content: BatchRetryPrompt
                            });
                            messages.push({
                                role: "assistant",
                                content: responseBeforeCleanup
                            });
                            messages.push({
                                role: "user",
                                content: BatchRetryPrompt
                            });
                        } else if (retryCount == 1) {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "user",
                                content: BatchRetryPrompt
                            });
                        } else if (retryCount == 2 && problemExplainerPromptAddition != "" && problemExplainerPromptAddition != undefined) {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "assistant",
                                content: responseBeforeCleanup
                            });
                            messages.push({
                                role: "user",
                                content: problemExplainerPromptAddition + `\n\nPlease carefully review the error and provide a corrected translation.`
                            });
                        } else if (retryCount == 2 && batchCommandCorrectionRequest != "" && batchCommandCorrectionRequest != undefined) {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "assistant",
                                content: responseBeforeCleanup
                            });
                            messages.push({
                                role: "user",
                                content: batchCommandCorrectionRequest + `\n\nPlease carefully review the error and provide a corrected translation.`
                            });
                        } else if (retryCount == 2 && responseBeforeCleanup != undefined && responseBeforeCleanup != "") {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "assistant",
                                content: responseBeforeCleanup
                            });
                            messages.push({
                                role: "user",
                                content: AggressiveBatchRetryPrompt
                            });
                        } else if (retryCount == 2) {
                            messages.push({
                                role: "user",
                                content: (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2") ? jsonUserPrompt : sectionMarkerUserPrompt
                            });
                            messages.push({
                                role: "user",
                                content: AggressiveBatchRetryPrompt
                            });
                        }
                        var batchresult = "";
                        var compareLineHeadersResult = [];
                        compareLineHeadersResult.isMatch = false;
                        compareLineHeadersResult.differences = {
                            missingInSecondString: [],
                            extraInSecondString: [],
                            orderChanged: false
                        };
                        var commandCheck = [];
                        var jsonValidationResult = [];
                        jsonValidationResult.needsCorrection = true;
                        commandCheck.needsCorrection = true;
                        let response = "";
                        let body = "";
                        let rstatus = "";
                        var endpointIsOurs = false;
                        if (this._shouldProbeEndpointOwnership(apiUrl, llmToUse, endpointNumber)) {
                            // Resolve endpoint ownership once for this request, before the body is
                            // built: the reasoning decision is synchronous and needs the answer as a
                            // value. Cached per URL, so only the first request pays the probe.
                            endpointIsOurs = await this._endpointIsOurs(apiUrl);
                        }
                        try {
                            if (((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) && ((!ep.enableJsonObjectFullBatch && llmToUse == "model1") || (!this.optionEnableJsonObjectFullBatch2.getValue() && llmToUse == "model2"))) {
                                body = {
                                    model: activeLLM,
                                    messages: messages,
                                    response_format: {
                                        type: "json_schema",
                                        json_schema: {
                                            name: "translation_response",
                                            schema: {
                                                type: "object",
                                                properties: {
                                                    translations: {
                                                        type: "array",
                                                        items: {
                                                            type: "object",
                                                            properties: {
                                                                id: { type: "integer" },
                                                                translated: { type: "string" }
                                                            },
                                                            required: ["id", "translated"],
                                                            additionalProperties: false
                                                        }
                                                    }
                                                },
                                                required: ["translations"],
                                                additionalProperties: false
                                            }
                                        }
                                    }
                                };
                            } else if (((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) && ((ep.enableJsonObjectFullBatch && llmToUse == "model1") || (this.optionEnableJsonObjectFullBatch2.getValue() && llmToUse == "model2"))) {
                                body = {
                                    model: activeLLM,
                                    messages: messages,
                                    response_format: {
                                        type: 'json_object'
                                    }
                                };
                            } else {
                                body = {
                                    model: activeLLM,
                                    messages: messages
                                };
                            }
                            if (llmTemp !== undefined && llmTemp !== null && llmTemp !== "") body.temperature = llmTemp;
                            if (llmTopK !== undefined && llmTopK !== null && llmTopK !== "") body.top_k = llmTopK;
                            if (llmTopP !== undefined && llmTopP !== null && llmTopP !== "") body.top_p = llmTopP;
                            if (llmMinP !== undefined && llmMinP !== null && llmMinP !== "") body.min_p = llmMinP;
                            if (llmRepeatPen !== undefined && llmRepeatPen !== null && llmRepeatPen !== "") body.repeat_penalty = llmRepeatPen + repPenaltyAddition;
                            if (llmRepetitionPen !== undefined && llmRepetitionPen !== null && llmRepetitionPen !== "") body.repetition_penalty = llmRepetitionPen + repPenaltyAddition;
                            if (maxTokenValue != undefined) body.max_tokens = maxTokenValue;
                            if (freqPen !== undefined && freqPen !== null && freqPen !== "") body.frequency_penalty = freqPen + repPenaltyAddition;
                            if (presPen !== undefined && presPen !== null && presPen !== "") body.presence_penalty = presPen;
                            this._setChatTemplateKwargs(body, chatTempKwargs);
                            if (llmStream != undefined && llmStream != "" && llmStream != null) body.stream = llmStream;
                            const customParams = getCustomParams(retryCount, llmToUse, ep.customParameters, this.optionCustomParameters2.getValue());
                            for (const [key, value] of Object.entries(customParams)) {
                                if (value !== null && value !== undefined && value !== '') {
                                    body[key] = value;
                                }
                            }
                            this._applyReasoningParams(body, llmToUse, activeLLM, endpointNumber, apiUrl, endpointIsOurs);
                            this._applyQwenNoThink(messages, this._reasoningFormatFor(llmToUse, endpointNumber), activeLLM);
                            let isResponsesApi = ResponsesApiHelpers_1.isResponsesApiUrl(apiUrl);
                            let useTokenProgress = this.optionEnableTokenProgress && this.optionEnableTokenProgress.getValue() === true && body.stream !== false;
                            // Repetition-loop tiers (characters / words / entries), each independently
                            // customizable and disableable. Full-batch responses carry unique ids
                            // ('--- {дivN} ---' markers, or '"id": N' JSON entries): repeated or
                            // out-of-range ids are definite duplication even when the original text
                            // legitimately repeats, so the batch stream additionally gets an id
                            // inspector driven by the entries tier.
                            let repetitionTiers = _repetitionLoopTiers(this);
                            let repetitionConfig = repetitionTiers.charLimit > 0 || repetitionTiers.wordLimit > 0 || repetitionTiers.entryLimit > 0
                                ? {
                                    charLimit: repetitionTiers.charLimit,
                                    wordLimit: repetitionTiers.wordLimit,
                                    entryLimit: repetitionTiers.entryLimit,
                                    inspect: null
                                }
                                : 0;
                            if (repetitionTiers.entryLimit > 0) {
                                const jsonBatchMode = (ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2");
                                repetitionConfig.inspect = _makeBatchIdInspector(jsonBatchMode, batchforbatchtransOrigPlaceholder.length, repetitionTiers.entryLimit);
                            }
                            if (useTokenProgress) {
                                body.stream = true;
                                body.stream_options = { include_usage: true };
                            }
                            if (isResponsesApi) {
                                body = ResponsesApiHelpers_1.toResponsesBody(body);
                            }
                            //console.log("Request Body:\n" + JSON.stringify(body));
                            logCollapsed("Request Body:", body);
                            console.log("[DSLR] Request -> endpoint " + endpointNumber + " (" + apiUrl + ")" + (llmToUse == "model2" ? " [FALLBACK]" : ""));
                            response = await fetch(apiUrl, {
                                method: 'POST',
                                headers: Object.assign({
                                    'Content-Type': 'application/json'
                                },
                                apiKey ? {
                                    'Authorization': `Bearer ${apiKey}`
                                } : {},
                                getCustomHeaders(retryCount, llmToUse, ep.customHeaders, this.optionCustomHeaders2.getValue())
                                ),
                                body: JSON.stringify(body),
                                signal: this._requestSignal()
                            });
                            if (response.status == undefined) {
                                response.status = "Response did not Include a status code.";
                            }
                            if (response.statusText == undefined) {
                                response.statusText = "";
                            }
                            rstatus = response.status.toString();
                            errorBody = JSON.stringify(body);
                            console.log("Response Status:\n" + response.status);
                            if (JSON.stringify(Object.fromEntries(response.headers.entries())) != undefined) {
                                //console.log("Response Headers:\n" + JSON.stringify(Object.fromEntries(response.headers.entries())));
                                console.groupCollapsed("Response Headers:");
                                console.log(JSON.stringify(Object.fromEntries(response.headers.entries())));
                                console.groupEnd();
                            } else {
                                console.log("Response Headers:\n" + "Respone had no headers.");
                            }
                            let fullResponseText = "";
                            let responseTrimmed = "";
                            try {
                                if (useTokenProgress && _responseBodyIsStreamable(response)) {
                                    showTokenProgress('endpoint ' + endpointNumber + (llmToUse == "model2" ? ' · fallback' : ''));
                                    batchresult = isResponsesApi ? await ResponsesApiHelpers_1.streamResponsesCompletion(response, updateTokenProgress, repetitionConfig) : await _streamChatCompletion(response, updateTokenProgress, repetitionConfig);
                                    fullResponseText = JSON.stringify(batchresult);
                                    hideTokenProgress();
                                } else {
                                    fullResponseText = await response.text();
                                    if (isResponsesApi) {
                                        batchresult = ResponsesApiHelpers_1.parseResponsesText(fullResponseText);
                                    } else {
                                        responseTrimmed = fullResponseText.replaceAll(/^[^{]+({)/g, "$1");
                                        responseTrimmed = responseTrimmed.replaceAll(/(})[^}]+$/g, "$1");
                                        batchresult = JSON.parse(responseTrimmed);
                                    }
                                }
                            } catch(error) {
                                hideTokenProgress();
                                if (this.aborted) continue; // user abort: skip retry delay, the loop condition exits
                                errorCollapsed("Broken Server Response:", fullResponseText);
                                updateServerIssueCount(1);
                                serverRetryCount++;
                                if (serverRetryCount <= MaxserverRetriesFTF) {
                                    if (error.message != undefined && error.message != [] && error.message != "" && error.message != {}) {
                                        this.error(`[DSLR] Serious response error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error.message}`);
                                        console.error(`[DSLR] Serious response error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error.message}`);
                                    } else if (error != undefined && error != [] && error != "" && error != {}) {
                                        this.error(`[DSLR] Serious response error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error}`);
                                        console.error(`[DSLR] Serious response error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error}`);
                                    } else {
                                        this.error(`[DSLR] Serious response error, waiting ${serverRetriesdelay / 1000} seconds then retrying.`);
                                        console.error(`[DSLR] Serious response error, waiting ${serverRetriesdelay / 1000} seconds then retrying.`);
                                    }
                                    thereWasServerError = true;
                                    await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                    continue;
                                } else {
                                    if (error.message != undefined && error.message != [] && error.message != "" && error.message != {}) {
                                        this.error(`[DSLR] Failed after multiple attempts. Error: ${error.message}`);
                                        console.error(`[DSLR] Failed after multiple attempts. Error: ${error.message}`);
                                    } else if (error != undefined && error != [] && error != "" && error != {}) {
                                        this.error(`[DSLR] Failed after multiple attempts. Error: ${error}`);
                                        console.error(`[DSLR] Failed after multiple attempts. Error: ${error}`);
                                    } else {
                                        this.error(`[DSLR] Failed after multiple attempts.`);
                                        console.error(`[DSLR] Failed after multiple attempts.`);
                                    }
                                    batchwassuccessfull = "false";
                                    abortTranslation = "true";
                                    break;
                                }
                            }
                            logCollapsed("Server Response (normalized):", batchresult);
                            // Track token usage from batch API call
                            if (batchresult.usage) {
                                totalPromptTokens += batchresult.usage.prompt_tokens;
                                totalCompletionTokens += batchresult.usage.completion_tokens;
                                totalTokens += batchresult.usage.total_tokens;
                                //console.log(`[DSLR] Batch token totals - Prompt: ${batchresult.usage.prompt_tokens}, Completion: ${batchresult.usage.completion_tokens}, Total: ${batchresult.usage.total_tokens}`);
                                logCollapsed("Batch token totals:", `Prompt: ${batchresult.usage.prompt_tokens}, Completion: ${batchresult.usage.completion_tokens}, Total: ${batchresult.usage.total_tokens}`);
                            }
                            if (response.ok) this._resetEndpointStreak(endpointNumber);
                            if (!response.ok) {
                                // 429 -> rotate to another endpoint (key) with escalating cooldown, before the normal wait-and-retry.
                                if (llmToUse == "model1" && maxRetries > 0 && rotationCount < MAX_429_ROTATIONS &&
                                    (this._isUnrecoverableStatus(rstatus) || (rstatus.match(/429/g) != null && this._hasMultipleEndpoints()))) {
                                    rotationCount++;
                                    if (this._isUnrecoverableStatus(rstatus)) this._disableEndpoint(endpointNumber);
                                    else this._markEndpoint429(endpointNumber);
                                    // Release this batch's slot on the bad endpoint while we look for another.
                                    this._decEndpointInFlight(endpointNumber);
                                    options._epSlot = 0;
                                    this.pendingRotations = (this.pendingRotations || 0) + 1;
                                    // Find an endpoint with spare capacity, polling until one frees up or the budget runs out.
                                    let _next = this._nextAvailableEndpoint();
                                    while (_next === null && rotationCount < MAX_429_ROTATIONS) {
                                        const _cdWait = this._cooldownWaitMs();
                                        const _waitMs = _cdWait > 0 ? Math.min(_cdWait, 60000) : ROTATION_POLL_MS;
                                        this.error(`[DSLR] No endpoint with spare capacity — waiting ${Math.round(_waitMs / 1000)}s before retrying.`);
                                        await new Promise(resolve => setTimeout(resolve, _waitMs));
                                        rotationCount++;
                                        _next = this._nextAvailableEndpoint();
                                    }
                                    this.pendingRotations = Math.max(0, (this.pendingRotations || 0) - 1);
                                    if (_next !== null) {
                                        this._incEndpointInFlight(_next);
                                        options._epSlot = _next;
                                        endpointNumber = _next;
                                        ep = this.getEndpointSettings(endpointNumber);
                                        _resolveFromEp();
                                        thereWasServerError = true;
                                        await new Promise(resolve => setTimeout(resolve, Math.max(llmReqDelay, _rotDelayMs)));
                                        continue;
                                    } else if (this.optionEnableFallback && this.optionEnableFallback.getValue() == true) {
                                        llmToUse = "model2";
                                        _resolveFromFallback();
                                        thereWasServerError = true;
                                        this.error('[DSLR] No primary endpoint available — switching to the fallback model.');
                                        await new Promise(resolve => setTimeout(resolve, Math.max(llmReqDelay, _rotDelayMs)));
                                        continue;
                                    } else {
                                        // No fallback: re-acquire the original slot (bookkeeping balance) and fall through.
                                        this._incEndpointInFlight(endpointNumber);
                                        options._epSlot = endpointNumber;
                                    }
                                }
                                this.error(`[DSLR] Response failed ok test. Response Error Status: ` + response.status + ` ` + response.statusText);
                                console.error(`[DSLR] Response failed ok test. Response Error Status: ` + response.status + ` ` + response.statusText);
                                errorCollapsed("Request:", body);
                                updateServerIssueCount(1);
                                serverRetryCount++;
                                if (serverRetryCount <= MaxserverRetries429 && rstatus.match(/429|524/g) != null) {
                                    if (maxRetries > 0) {
                                        this.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying.`);
                                        console.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying.`);
                                        thereWasServerError = true;
                                        recordRateLimitRetry();
                                        await new Promise(resolve => setTimeout(resolve, Retries429Delay));
                                        continue;
                                    } else {
                                        this.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                        console.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                        batchwassuccessfull = "false";
                                        abortTranslation = "true";
                                        break;
                                    }
                                } else if (serverRetryCount <= MaxserverRetries400 && rstatus.match(/400/g) != null) {
                                    if (maxRetries > 0) {
                                        this.error(`[DSLR] Server/LLM Issue, waiting ${Retries400Delay / 1000} seconds, then retrying. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                        console.error(`[DSLR] Server/LLM Issue, waiting ${Retries400Delay / 1000} seconds, then retrying.`);
                                        errorCollapsed("Request sent to endpoint:", errorBody);
                                        thereWasServerError = true;
                                        await new Promise(resolve => setTimeout(resolve, Retries400Delay));
                                        continue;
                                    } else {
                                        this.error(`[DSLR] Server issue prevented response, but retries are disabled. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                        console.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                        errorCollapsed("Request sent to endpoint:", errorBody);
                                        batchwassuccessfull = "false";
                                        abortTranslation = "true";
                                        break;
                                    }
                                } else if (serverRetryCount <= MaxserverRetries && rstatus.match(/429/g) == null && rstatus.match(/400/g) == null) {
                                    if (maxRetries > 0) {
                                        this.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                        console.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                        thereWasServerError = true;
                                        await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                        continue;
                                    } else {
                                        this.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                        console.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                        batchwassuccessfull = "false";
                                        abortTranslation = "true";
                                        break;
                                    }
                                } else if (rstatus.match(/400/g) != null) {
                                    this.error(`[DSLR] Failed to get a usable Full Batch due to a 400 Error Status. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                    console.error(`[DSLR] Failed to get a usable Full Batch due to a 400 Error Status. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                    errorCollapsed("Request:", body);
                                    batchwassuccessfull = "false";
                                    break;
                                } else {
                                    this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                    console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                    errorCollapsed("Request:", body);
                                    batchwassuccessfull = "false";
                                    abortTranslation = "true";
                                    break;
                                }
                            } else {
                                console.log(`[DSLR] Response passed ok test. Response Status: ` + response.status + ` ` + response.statusText);
                            }
                            if (batchresult.choices[0]?.finish_reason == "content_filter") {
                                updateServerIssueCount(1);
                                this.error(`[DSLR] content_filter finish reason. The enpoint likely just charged you for completion tokens it refused to send you.\nAborting the translation to prevent it from scamming you further.` + `\n\n` + "Server Response (normalized):\n" + JSON.stringify(batchresult, null, 2));
                                console.error(`[DSLR] content_filter finish reason. The enpoint likely just charged you for completion tokens it refused to send you.\nAborting the translation to prevent it from scamming you further.`);
                                errorCollapsed("Original Text:", body);
                                errorCollapsed("Server Response (normalized):", batchresult);
                                batchwassuccessfull = "false";
                                abortTranslation = "true";
                                break;
                            }
                            //console.log("Server Response (normalized):\n" + JSON.stringify(batchresult, null, 2));
                            if (batchresult == "" || batchresult == undefined) {
                                if (serverRetryCount <= MaxserverRetries) {
                                    this.error(`[DSLR] Response undefined or empty. Response Error Status: ` + response.status + ` ` + response.statusText);
                                    console.error(`[DSLR] Response undefined or empty. Response Error Status: ` + response.status + ` ` + response.statusText);
                                    errorCollapsed("Original Text:", body);
                                    updateServerIssueCount(1);
                                    serverRetryCount++;
                                    if (maxRetries > 0) {
                                        this.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                        console.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                        thereWasServerError = true;
                                        await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                        continue;
                                    } else {
                                        this.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                        console.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                        abortTranslation = "true";
                                        break;
                                    }
                                } else {
                                    updateServerIssueCount(1);
                                    this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                    console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                    errorCollapsed("Request:", body);
                                    batchwassuccessfull = "false";
                                    abortTranslation = "true";
                                    break;
                                }
                            }
                        } catch (error) {
                            if (this.aborted) continue;
                            // A failed request (a connection error in particular) may mean the server
                            // behind a shared loopback port has been swapped out; drop the cached
                            // ownership answer so the retry (or the next request) probes again.
                            this._invalidateEndpointOwnership(apiUrl);
                            updateServerIssueCount(1);
                            serverRetryCount++;
                            if (serverRetryCount <= MaxserverRetriesFTF) {
                                if (error.message != undefined && error.message != [] && error.message != "" && error.message != {}) {
                                    this.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error.message}`);
                                    console.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error.message}`);
                                } else if (error != undefined && error != [] && error != "" && error != {}) {
                                    this.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error}`);
                                    console.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error}`);
                                } else {
                                    this.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying.`);
                                    console.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying.`);
                                }
                                thereWasServerError = true;
                                await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                continue;
                            } else {
                                if (error.message != undefined && error.message != [] && error.message != "" && error.message != {}) {
                                    this.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error.message}`);
                                    console.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error.message}`);
                                } else if (error != undefined && error != [] && error != "" && error != {}) {
                                    this.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error}`);
                                    console.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error}`);
                                } else {
                                    this.error(`[DSLR] Failed to connect to API after multiple attempts.`);
                                    console.error(`[DSLR] Failed to connect to API after multiple attempts.`);
                                }
                                batchwassuccessfull = "false";
                                abortTranslation = "true";
                                break;
                            }
                        }
                        if (batchresult.choices[0]?.message?.content == undefined || batchresult.choices[0]?.message?.content == "") {
                            if (batchresult.content && Array.isArray(batchresult.content)) {
                                responseBeforeCleanup = batchresult.content
                                    .filter(block => block && block.type === 'text')
                                    .map(block => block.text || '')
                                    .join('');
                            } else if (batchresult.choices[0]?.finish_reason == "content_filter") {
                                updateServerIssueCount(1);
                                this.error(`[DSLR] content_filter finish reason. The enpoint likely just charged you for completion tokens it refused to send you.\nAborting the translation to prevent it from scamming you further.` + `\n\n` + "Server Response (normalized):\n" + JSON.stringify(batchresult, null, 2));
                                console.error(`[DSLR] content_filter finish reason. The enpoint likely just charged you for completion tokens it refused to send you.\nAborting the translation to prevent it from scamming you further.`);
                                errorCollapsed("Original Text:", body);
                                errorCollapsed("Server Response (normalized):", batchresult);
                                batchwassuccessfull = "false";
                                abortTranslation = "true";
                                break;
                            } else {
                                if (serverRetryCount <= MaxserverRetries) {
                                    this.error(`[DSLR] Response in wrong format. Response Error Status: ` + response.status + ` ` + response.statusText);
                                    console.error(`[DSLR] Response in wrong format. Response Error Status: ` + response.status + ` ` + response.statusText);
                                    errorCollapsed("Original Text:", body);
                                    errorCollapsed("Server Response (normalized):", batchresult);
                                    updateServerIssueCount(1);
                                    serverRetryCount++;
                                    if (serverRetryCount <= MaxserverRetries429 && rstatus.match(/429|524/g) != null) {
                                        if (maxRetries > 0) {
                                            this.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying.`);
                                            console.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying.`);
                                            thereWasServerError = true;
                                            recordRateLimitRetry();
                                            await new Promise(resolve => setTimeout(resolve, Retries429Delay));
                                            continue;
                                        } else {
                                            this.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                            console.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                            batchwassuccessfull = "false";
                                            abortTranslation = "true";
                                            break;
                                        }
                                    } else if (batchresult.choices[0]?.finish_reason == "abort" && maxRetries > 0) {
                                        this.error(`[DSLR] Waiting ${Retries429Delay / 1000} seconds, then retrying, because of "abort" finish reason. The endpoint aborted the response for some reason.`);
                                        console.error(`[DSLR] Waiting ${Retries429Delay / 1000} seconds, then retrying, because of "abort" finish reason. The endpoint aborted the response for some reason.`);
                                        errorCollapsed("Original Text:", body);
                                        errorCollapsed("Server Response (normalized):", batchresult);
                                        thereWasServerError = true;
                                        await new Promise(resolve => setTimeout(resolve, Retries429Delay));
                                        continue;
                                    } else if (batchresult.choices[0]?.finish_reason == "length" && maxRetries > 0) {
                                        // The repetition guard reports the same "length" finish reason after
                                        // terminating a looping response early, but that is a much more specific
                                        // (and certain) problem than real token exhaustion, so it gets its own
                                        // unambiguous message instead of the generic "length" one.
                                        const loopReason = batchresult.repetition_loop_reason || `the same text was repeated back to back too many times`;
                                        const lengthErrorMsg = batchresult.repetition_loop
                                            ? `[DSLR] Waiting 5 seconds, then retrying, because the model was stuck repeating itself. A repetition loop was detected in the streamed response (${loopReason}), so the response was terminated early.\n[DSLR] If the parameter is not empty, it will now automatically increase values like repeat_penalty for the next attempt.`
                                            : `[DSLR] Waiting 5 seconds, then retrying, because of "length" finish reason. This indicates that the model ran out of context either because not enough context length was allocated, or because the model got stuck endlessly repeating something.\n[DSLR] If the parameter is not empty, it will now automatically increase values like repeat_penalty for the next attempt.`;
                                        this.error(lengthErrorMsg);
                                        console.error(lengthErrorMsg);
                                        errorCollapsed("Original Text:", body);
                                        errorCollapsed("Server Response (normalized):", batchresult);
                                        if (batchresult.repetition_loop) {
                                            // Show what was generated before the kill; the
                                            // normalized result above buries it in the envelope.
                                            errorCollapsed("Content generated before the repetition kill:",
                                                ResponsesApiHelpers_1.chatContentOf(batchresult));
                                        }
                                        repPenaltyAddition = repPenaltyAddition + 0.05;
                                        thereWasServerError = true;
                                        await new Promise(resolve => setTimeout(resolve, 5000));
                                        continue;
                                    } else if (maxRetries > 0) {
                                        this.error(`[DSLR] Waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                        console.error(`[DSLR] Waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                        thereWasServerError = true;
                                        await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                        continue;
                                    } else {
                                        this.error(`[DSLR] Response issue prevented response, but retries are disabled.`);
                                        console.error(`[DSLR] Response issue prevented response, but retries are disabled.`);
                                        abortTranslation = "true";
                                        break;
                                    }
                                } else {
                                    updateServerIssueCount(1);
                                    this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                    console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                    errorCollapsed("Request:", body);
                                    batchwassuccessfull = "false";
                                    abortTranslation = "true";
                                    break;
                                }
                            }
                        } else if (batchresult.choices[0]?.finish_reason == "abort" && maxRetries > 0) {
                            if (serverRetryCount <= MaxserverRetries) {
                                updateServerIssueCount(1);
                                serverRetryCount++;
                                this.error(`[DSLR] Retrying because of "abort" finish reason. The endpoint aborted the response for some reason.`);
                                console.error(`[DSLR] Retrying because of "abort" finish reason. The endpoint aborted the response for some reason.`);
                                errorCollapsed("Original Text:", body);
                                errorCollapsed("Server Response (normalized):", batchresult);
                                thereWasServerError = true;
                                await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                continue;
                            } else {
                                updateServerIssueCount(1);
                                this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                errorCollapsed("Request:", body);
                                batchwassuccessfull = "false";
                                abortTranslation = "true";
                                break;
                            }
                        } else if (batchresult.choices[0]?.finish_reason == "length" && maxRetries > 0) {
                            if (serverRetryCount <= MaxserverRetries) {
                                updateServerIssueCount(1);
                                serverRetryCount++;
                                // See the batch-level "length" handler above: a repetition-loop
                                // termination is reported with its own explicit message.
                                const loopReason = batchresult.repetition_loop_reason || `the same text was repeated back to back too many times`;
                                const lengthErrorMsg = batchresult.repetition_loop
                                    ? `[DSLR] Waiting 5 seconds, then retrying, because the model was stuck repeating itself. A repetition loop was detected in the streamed response (${loopReason}), so the response was terminated early.\n[DSLR] If the parameter is not empty, it will now automatically increase values like repeat_penalty for the next attempt.`
                                    : `[DSLR] Waiting 5 seconds, then retrying, because of "length" finish reason. This indicates that the model ran out of context either because not enough context length was allocated, or because the model got stuck endlessly repeating something.\n[DSLR] If the parameter is not empty, it will now automatically increase values like repeat_penalty for the next attempt.`;
                                this.error(lengthErrorMsg);
                                console.error(lengthErrorMsg);
                                errorCollapsed("Original Text:", body);
                                errorCollapsed("Server Response (normalized):", batchresult);
                                if (batchresult.repetition_loop) {
                                    errorCollapsed("Content generated before the repetition kill:",
                                        ResponsesApiHelpers_1.chatContentOf(batchresult));
                                }
                                repPenaltyAddition = repPenaltyAddition + 0.05;
                                thereWasServerError = true;
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                continue;
                            } else {
                                updateServerIssueCount(1);
                                this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                errorCollapsed("Request:", body);
                                batchwassuccessfull = "false";
                                abortTranslation = "true";
                                break;
                            }
                        } else {
                            responseBeforeCleanup = batchresult.choices[0]?.message?.content;
                        }
                        if (responseBeforeCleanup == "" || responseBeforeCleanup == undefined) {
                            if (serverRetryCount <= MaxserverRetries) {
                                this.error(`[DSLR] Response did not include usable content. Response Error Status: ` + response.status + ` ` + response.statusText);
                                console.error(`[DSLR] Response did not include usable content. Response Error Status: ` + response.status + ` ` + response.statusText);
                                errorCollapsed("Original Text:", body);
                                updateServerIssueCount(1);
                                serverRetryCount++;
                                if (maxRetries > 0) {
                                    this.error(`[DSLR] LLM response Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                    console.error(`[DSLR] LLM response Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                    thereWasServerError = true;
                                    await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                    continue;
                                } else {
                                    this.error(`[DSLR] LLM response issue, but retries are disabled.`);
                                    console.error(`[DSLR] LLM response issue, but retries are disabled.`);
                                    abortTranslation = "true";
                                    break;
                                }
                            } else {
                                updateServerIssueCount(1);
                                this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                errorCollapsed("Request:", body);
                                batchwassuccessfull = "false";
                                abortTranslation = "true";
                                break;
                            }
                        }
                        lastResponseForServerError = responseBeforeCleanup;
                        if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                            try {
                                if (responseBeforeCleanup.match(/^[^{]+({[\s\S]+})[^}]*$/gi) != null || responseBeforeCleanup.match(/^[^{]*({[\s\S]+})[^}]+$/gi) != null) {
                                    console.error(`[DSLR] The LLM did not provide a valid JSON. Attempting to fix it.`);
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[^{]*({[\s\S]+})[^}]*$/gi, "$1");
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/(?<!\\)\\(.\[\d+\])/gi, "\\\\$1");
                                    errorCollapsed("Changed Reponse:", responseBeforeCleanup);
                                } else if (responseBeforeCleanup.match(/(?<!\\)\\.\[\d+\]/gi) != null) {
                                    console.error(`[DSLR] The LLM did not provide a valid JSON. Attempting to fix it.`);
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[^{]*({[\s\S]+})[^}]*$/gi, "$1");
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/(?<!\\)\\(.\[\d+\])/gi, "\\\\$1");
                                    errorCollapsed("Changed Reponse:", responseBeforeCleanup);
                                }
                                jsonData = JSON.parse(responseBeforeCleanup);
                                let keydetectiontest = jsonData;
                                const ALLOWED_KEYS = new Set(["id", "translated"]);

                                // --- Pre-processing: detect and rename a consistent alternative key ---

                                const entriesWithoutTranslated = keydetectiontest.translations.filter(e => !("translated" in e));

                                if (entriesWithoutTranslated.length > 0) {
                                    // All entries must be missing "translated" for auto-rename to apply
                                    const allMissing = entriesWithoutTranslated.length === keydetectiontest.translations.length;

                                    if (!allMissing) {
                                        // Some have "translated", some don't — inconsistent, abort
                                        const badIndex = keydetectiontest.translations.findIndex(
                                            (e, i) => !("translated" in e)
                                        );
                                        throw new Error(
                                            `Inconsistent translation keys: entry at index ${badIndex} is missing "translated" ` +
                                            `but other entries have it.`
                                        );
                                    }

                                    // Find the one key (other than "id") that appears in every entry
                                    const candidateKeys = new Set(
                                        entriesWithoutTranslated.flatMap(e => Object.keys(e)).filter(k => k !== "id")
                                    );

                                    // The key must be the SAME one across ALL entries and there must be exactly one
                                    const consistentKey = [...candidateKeys].find(key =>
                                        entriesWithoutTranslated.every(e => key in e)
                                    );

                                    if (candidateKeys.size !== 1 || !consistentKey) {
                                        throw new Error(
                                        `Cannot auto-detect alternative translation key. ` +
                                        `Found candidates: [${[...candidateKeys].join(", ")}]. ` +
                                        `Expected exactly one consistent key across all entries.`
                                        );
                                    }

                                        // Rename the consistent alternative key to "translated"
                                        for (const entry of keydetectiontest.translations) {
                                            entry.translated = entry[consistentKey];
                                            delete entry[consistentKey];
                                        }

                                        console.error(`[DSLR] Auto-renamed "${consistentKey}" to "translated" across all entries because the model did not follow the json schema.`);
                                }

                                // --- Validation and cleanup ---

                                keydetectiontest.translations = keydetectiontest.translations.map((entry, index) => {
                                    const keys = Object.keys(entry);

                                    if (!("id" in entry)) {
                                        throw new Error(
                                            `Translation entry at index ${index} is missing "id". ` +
                                            `Got keys: [${keys.join(", ")}]`
                                        );
                                    }

                                    if (!("translated" in entry)) {
                                        throw new Error(
                                            `Translation entry at index ${index} is missing "translated". ` +
                                            `Got keys: [${keys.join(", ")}]`
                                        );
                                    }

                                    const unexpected = keys.filter(k => !ALLOWED_KEYS.has(k));
                                    if (unexpected.length > 0) {
                                        throw new Error(
                                            `Translation entry at index ${index} has unexpected keys: ${unexpected.join(", ")}. ` +
                                            `Only "id" and "translated" are allowed.`
                                        );
                                    }

                                    const cleaned = {};
                                    for (const key of ALLOWED_KEYS) {
                                        cleaned[key] = entry[key];
                                    }
                                    return cleaned;
                                });

                                jsonData = keydetectiontest;
                                jsonData2 = keydetectiontest;
                                //jsonData.translations = jsonData.translations.map(({ id, translated }) => ({ id, translated }));
                                //jsonData2.translations = jsonData2.translations.map(({ id, translated }) => ({ id, translated }));
                                // Apply replaceAll to each translated field
                                // Convert back to JSON
                                jsonResponse = JSON.stringify(jsonData, null, 2);
                                lastResponseForServerError = jsonResponse;
                                responseBeforeCleanup = jsonResponse;
                                translatedLines = jsonData.translations.map(item => item.translated);
                                jsonData2.translations.forEach(item => {
                                    if (llmToUse == "model1") {
                                        if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                            item.translated = item.translated.replaceAll(nameCommandRestore, "\\n[$1]");
                                        }
                                        if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                            item.translated = item.translated.replaceAll(characterCommandRestore, "\\nw[$1]");
                                        }
                                        if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                            item.translated = item.translated.replaceAll(imageCommandRestore, "\\i[$1]");
                                        }
                                        if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                            item.translated = item.translated.replaceAll(variableCommandRestore, "\\v[$1]");
                                        }
                                        if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                            item.translated = item.translated.replaceAll(colorCommandRestore, "\\C[$1]");
                                        }
                                        if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                            item.translated = item.translated.replaceAll(placeholderRestore, "@$1");
                                        }
                                    } else if (llmToUse == "model2") {
                                        if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                            item.translated = item.translated.replaceAll(nameCommandRestore2, "\\n[$1]");
                                        }
                                        if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                            item.translated = item.translated.replaceAll(characterCommandRestore2, "\\nw[$1]");
                                        }
                                        if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                            item.translated = item.translated.replaceAll(imageCommandRestore2, "\\i[$1]");
                                        }
                                        if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                            item.translated = item.translated.replaceAll(variableCommandRestore2, "\\v[$1]");
                                        }
                                        if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                            item.translated = item.translated.replaceAll(colorCommandRestore2, "\\C[$1]");
                                        }
                                        if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                            item.translated = item.translated.replaceAll(placeholderRestore2, "@$1");
                                        }
                                    }
                                });
                                jsonResponseOrigPlaceholder = JSON.stringify(jsonData2, null, 2);
                            } catch (err) {
                                // The server responded (HTTP 200) and returned a parseable
                                // envelope, but the LLM's own output was unusable: it was not
                                // valid JSON or failed the schema/structure validation. This is a
                                // model/content problem, NOT a server or connection issue, so it
                                // must NOT use the escalating server-issue delays. Instead retry a
                                // few times with a JSON correction prompt, and if the model still
                                // cannot comply, split the batch (a smaller batch is far easier
                                // for less capable models to format correctly).
                                var jsonErr = (err && err.message) ? err.message : String(err);
                                updateFullBatchFailCount(1);
                                this.error(`[DSLR] The response could not be parsed into valid JSON. ${jsonErr}`);
                                console.error(`[DSLR] Response was not valid JSON / failed schema validation. Error: ${jsonErr}\nResponse Error Status: ` + response.status + ` ` + response.statusText);
                                errorCollapsed("Request:", jsonRequest || body);
                                errorCollapsed("Reponse:", batchresult);
                                problemExplainerErrorAddition = `The response was not valid JSON and could not be repaired. Error: ${jsonErr}`;
                                problemExplainerPromptAddition = BatchRetryPrompt;
                                retryCount++;
                                recordBatchCorrectionRetry();
                                if (maxRetries > 0 && retryCount <= maxRetries) {
                                    this.error(`[DSLR] (${retryCount}/${maxRetries}) Retrying Full Batch with a correction prompt because the response was not valid JSON.`);
                                    console.error(`[DSLR] Retrying Full Batch with a correction prompt because the response was not valid JSON.`);
                                    await new Promise(resolve => setTimeout(resolve, batchretryDelay));
                                    continue;
                                } else {
                                    errorCollapsed("Request:", jsonRequest || body);
                                    attemptRecovery(`${llmName} could not produce valid JSON for this batch even after retries.`);
                                    break;
                                }
                            }
                        }
                        problemExplainerPromptAddition = "";
                        problemExplainerErrorAddition = "";
                        var cleanedOriginalText;
                        if ((!ep.enableJsonFullBatch && llmToUse == "model1") || (!this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                            //Get rid of reasoning text
                            if (this._qwenNoThinkActive(llmToUse, endpointNumber) && responseBeforeCleanup.match(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi) != null) {
                                responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi, "");
                                console.log("[DSLR] Stripped a stray <think> block from a Qwen response (/no_think was sent).");
                            }
                            if (this._isReasoningActive(llmToUse, endpointNumber)) {
                                if (responseBeforeCleanup.match(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?<reasoning>[\s\S]*?<(?:\/|\\)reasoning>\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<reasoning>[\s\S]*?<(?:\/|\\)reasoning>\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?<thinking>[\s\S]*?<(?:\/|\\)thinking>\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<thinking>[\s\S]*?<(?:\/|\\)thinking>\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?<thought>[\s\S]*?<(?:\/|\\)thought>\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<thought>[\s\S]*?<(?:\/|\\)thought>\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?<reason>[\s\S]*?<(?:\/|\\)reason>\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<reason>[\s\S]*?<(?:\/|\\)reason>\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?<deepthink>[\s\S]*?<(?:\/|\\)deepthink>\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<deepthink>[\s\S]*?<(?:\/|\\)deepthink>\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?:think:[\s\S]*?:think:\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?:reasoning:[\s\S]*?:reasoning:\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?:reasoning:[\s\S]*?:reasoning:\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?:thinking:[\s\S]*?:thinking:\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?:thinking:[\s\S]*?:thinking:\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?:thought:[\s\S]*?:thought:\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?:thought:[\s\S]*?:thought:\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?:reason:[\s\S]*?:reason:\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?:reason:[\s\S]*?:reason:\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?:think:[\s\S]*?:think:\s*/gi, "");
                                } else if (responseBeforeCleanup.match(/^[\s\S]*?:deepthink:[\s\S]*?:deepthink:\s*/gi) != null) {
                                    responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?:deepthink:[\s\S]*?:deepthink:\s*/gi, "");
                                } else {
                                    console.log(`[DSLR] Reasoning enabled, but no known think block detected. Using broad universal pattern to try to clean it anyway.`);
                                    logCollapsed("Response before cleaning:", responseBeforeCleanup);
                                    if (responseBeforeCleanup.match(/^[\s\S]*?<.*?>[\s\S]*?<(?:\/|\\).*>\s*/gi) != null) {
                                        responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?<.*?>[\s\S]*?<(?:\/|\\).*?>\s*/gi, "");
                                        this.log(`[DSLR] Detected and deleted "something" with the <> <\/> or <> <\\> pattern, because no other reasoning block was found.`);
                                        console.log(`[DSLR] Detected and deleted "something" with the <> <\/> or <> <\\> pattern.`);
                                    } else if (responseBeforeCleanup.match(/^[\s\S]*?:.*?:[\s\S]*?:.*?:\s*/gi) != null) {
                                        responseBeforeCleanup = responseBeforeCleanup.replaceAll(/^[\s\S]*?:.*?:[\s\S]*?:.*?:\s*/gi, "");
                                        this.log(`[DSLR] Detected and deleted "something" with the :: :: pattern, because no other reasoning block was found.`);
                                        console.log(`[DSLR] Detected and deleted "something" with the :: :: pattern.`);
                                    } else {
                                        console.error(`[DSLR] Unable to detect anything.`);
                                    }
                                }
                            }
                            //Also accept d instead of д
                            responseBeforeCleanup = responseBeforeCleanup.replaceAll(/\n--- {div(\d+)} ---\n/g, "\n--- {дiv$1} ---\n");
                            //Make responses with empty translatons fail
                            responseBeforeCleanup = responseBeforeCleanup.replaceAll(/[\n \-{]*дiv\d*}? ?-?-?-?\n?([\n \-{]*дiv\d*[}\n \-]*)/g, "$1");
                            // Divider Cleanup
                            let removeFirstDiv = responseBeforeCleanup.replaceAll(/^[\n \-{]*дiv\d*[}\n \-]*/g, "");
                            translatedText = removeFirstDiv.replaceAll(CustomDividerCleanupRegex, CustomDividerRemainsValue);
                            let removeFirstDivOrig = batchforbatchtransLineLogic.replaceAll(/^[\n \-{]*дiv\d*[}\n \-]*/g, "");
                            TextOrig = removeFirstDivOrig.replaceAll(CustomDividerCleanupRegex, CustomDividerRemainsValue);
                            //Remove empty lines if there are none in the original
                            cleanedOriginalText = batchforbatchtrans.join(CustomDividerValue);
                            cleanedOriginalText = cleanedOriginalText.replaceAll(CustomDividerCleanupRegex, CustomDividerRemainsValue);
                            if (cleanedOriginalText.match(/\n[\r 　]*\n/g) == null) {
                                translatedText = translatedText.replaceAll(/\n[\r 　]*\n/g, "");
                            }
                            translatedLines = translatedText.split(CustomDividerRemainsValue);
                            batchforbatchtransLineLogicForCounting = TextOrig.split(CustomDividerRemainsValue);
                            if (batchforbatchtransLineLogicForCounting.length != batch.length) {
                                this.error(`[DSLR] Input got seriously screwed up somehow.\n\nOriginal Input:\n${JSON.stringify(batch)}\n\nScrewed up Input:\n${JSON.stringify(responseBeforeCleanup)}`);
                                console.error(`[DSLR] Input got seriously screwed up somehow.`);
                                errorCollapsed("Original Input:", batch);
                                errorCollapsed("Screwed up Input:", responseBeforeCleanup);
                                abortTranslation = "true";
                                break;
                            }
                        }
                        if (responseBeforeCleanup == batchforbatchtransLineLogic && RefusalRetryCount <= MaxRefusalRetries && (batchforbatchtransLineLogic.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null || japanesesource == false)) {
                            updateFullBatchFailCount(1);
                            RefusalRetryCount++;
                            if (maxRetries > 0) {
                                this.error(`[DSLR] Server/LLM just sent back the input, retrying.`);
                                console.error(`[DSLR] Server/LLM just sent back the input, retrying.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                thereWasServerError = true;
                                await new Promise(resolve => setTimeout(resolve, batchretryDelay));
                                continue;
                            } else {
                                this.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled. ${llmName}'s response = ${responseBeforeCleanup}`);
                                console.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                abortTranslation = "true";
                                break;
                            }
                        } else if (responseBeforeCleanup == batchforbatchtransLineLogic && (batchforbatchtransLineLogic.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null || japanesesource == false)) {
                            updateFullBatchFailCount(1);
                            RefusalRetryCount = 0;
                            retryCount++;
                            recordBatchCorrectionRetry();
                            if (maxRetries > 0 && retryCount <= maxRetries) {
                                this.error(`[DSLR] Server/LLM just sent back the input, retrying the current request one last time.`);
                                console.error(`[DSLR] Server/LLM just sent back the input,  retrying the current request one last time.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                thereWasServerError = true;
                                await new Promise(resolve => setTimeout(resolve, batchretryDelay));
                                continue;
                            } else if (maxRetries > 0) {
                                this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                errorCollapsed("Request:", body);
                                batchwassuccessfull = "false";
                                break;
                            } else {
                                this.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled. ${llmName}'s response = ${responseBeforeCleanup}`);
                                console.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                abortTranslation = "true";
                                break;
                            }
                        }
                        if (responseBeforeCleanup.match(/(^\s*抱歉，我无法协助完成您的请求。\s*$)|(^\s*对不起，我无法协助完成您的请求。\s*$)|(^\s*抱歉，我无法协助翻译这些内容。\s*$)|(^\s*(?:I'm sorry, but |I am sorry, but |Sorry, but |Sorry, )?(?:I|I'm|I am) (?:can't|cannot|unable to) assist with (?:this|that) request.\s*$)/gi) != null && RefusalRetryCount <= MaxRefusalRetries) {
                            updateFullBatchFailCount(1);
                            RefusalRetryCount++;
                            if (maxRetries > 0) {
                                this.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                console.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                thereWasServerError = true;
                                await new Promise(resolve => setTimeout(resolve, batchretryDelay));
                                continue;
                            } else {
                                this.error(`[DSLR] LLM refused to generate a response, but retries are disabled. ${llmName}'s response = ${responseBeforeCleanup}`);
                                console.error(`[DSLR] LLM refused to generate a response, but retries are disabled.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                abortTranslation = "true";
                                break;
                            }
                        } else if (responseBeforeCleanup.match(/(^\s*抱歉，我无法协助完成您的请求。\s*$)|(^\s*对不起，我无法协助完成您的请求。\s*$)|(^\s*抱歉，我无法协助翻译这些内容。\s*$)|(^\s*(?:I'm sorry, but |I am sorry, but |Sorry, but |Sorry, )?(?:I|I'm|I am) (?:can't|cannot|unable to) assist with (?:this|that) request.\s*$)/gi) != null) {
                            updateFullBatchFailCount(1);
                            RefusalRetryCount = 0;
                            retryCount++;
                            recordBatchCorrectionRetry();
                            if (maxRetries > 0 && retryCount <= maxRetries) {
                                this.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                console.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                thereWasServerError = true;
                                await new Promise(resolve => setTimeout(resolve, batchretryDelay));
                                continue;
                            } else if (maxRetries > 0) {
                                this.error(`[DSLR] Failed to get a usable Full Batch.`);
                                console.error(`[DSLR] Failed to get a usable Full Batch.`);
                                errorCollapsed("Request:", body);
                                batchwassuccessfull = "false";
                                break;
                            } else {
                                this.error(`[DSLR] LLM refused to generate a response, but retries are disabled. ${llmName}'s response = ${responseBeforeCleanup}`);
                                console.error(`[DSLR] LLM refused to generate a response, but retries are disabled.`);
                                errorCollapsed("Request Contents:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                abortTranslation = "true";
                                break;
                            }
                        }
                        console.log(`[DSLR]Response passed server issue related tests.`);
                        repPenaltyAddition = 0;
                        thereWasServerError = false;
                        var ResponseDivderCount = translatedLines.length - 1;
                        var BatchDivderCount = batch.length - 1;
                        AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/MARKERSINRESPONSE/g, ResponseDivderCount);
                        AggressiveBatchRetryPrompt = AggressiveBatchRetryPrompt.replaceAll(/MARKERSINREQUEST/g, BatchDivderCount);
                        BatchRetryPrompt = BatchRetryPrompt.replaceAll(/MARKERSINRESPONSE/g, ResponseDivderCount);
                        BatchRetryPrompt = BatchRetryPrompt.replaceAll(/MARKERSINREQUEST/g, BatchDivderCount);
                        lengthproblem = 'false';
                        placeholderproblem = 'false';
                        commandproblem = 'false';
                        wrongorder = 'false';
                        batchCommandCorrectionRequest = "";
                        let ResponseWithoutWhitespace = responseBeforeCleanup.replaceAll(/\s/g, "");
                        responseBeforeCleanupOrigPlaceholder = responseBeforeCleanup;
                        if (llmToUse == "model1") {
                            if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(nameCommandRestore, "\\n[$1]");
                            }
                            if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(characterCommandRestore, "\\nw[$1]");
                            }
                            if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(imageCommandRestore, "\\i[$1]");
                            }
                            if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(variableCommandRestore, "\\v[$1]");
                            }
                            if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(colorCommandRestore, "\\C[$1]");
                            }
                            if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(placeholderRestore, "@$1");
                            }
                        } else if (llmToUse == "model2") {
                            if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(nameCommandRestore2, "\\n[$1]");
                            }
                            if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(characterCommandRestore2, "\\nw[$1]");
                            }
                            if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(imageCommandRestore2, "\\i[$1]");
                            }
                            if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(variableCommandRestore2, "\\v[$1]");
                            }
                            if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(colorCommandRestore2, "\\C[$1]");
                            }
                            if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                responseBeforeCleanupOrigPlaceholder = responseBeforeCleanupOrigPlaceholder.replaceAll(placeholderRestore2, "@$1");
                            }
                        }
                            try {
                                if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                    jsonValidationResult = validateJSONTranslationComprehensive(
                                        jsonRequestOrigPlaceholder, 
                                        jsonResponseOrigPlaceholder,
                                        llmToUse,
                                        this.optionNameCommandReplacer.getValue(),
                                        this.optionCharacterCommandReplacer.getValue(),
                                        this.optionImageCommandReplacer.getValue(),
                                        this.optionVariableCommandReplacer.getValue(),
                                        this.optionColorCommandReplacer.getValue(),
                                        this.optionPlaceholderReplacer.getValue(),
                                        this.optionNameCommandReplacer2.getValue(),
                                        this.optionCharacterCommandReplacer2.getValue(),
                                        this.optionImageCommandReplacer2.getValue(),
                                        this.optionVariableCommandReplacer2.getValue(),
                                        this.optionColorCommandReplacer2.getValue(),
                                        this.optionPlaceholderReplacer2.getValue(),
                                        {
                                            minPreservation: 80,
                                            maxExtra: 10,
                                            maxQuoteIssues: 10,
                                            allowNakedRefs: false,
                                            checkContentPlacement: true,
                                            strictPlacement: true,
                                            enablePerLineChecks: true,
                                            japaneseSource: window.transConfig.japanesesource == true,
                                            rejectJapaneseModel1: this.optionEnableRejectJapanese.getValue() == true,
                                            rejectJapaneseModel2: this.optionEnableRejectJapanese2.getValue() == true,
                                            maxJapaneseIssuePercent: 10,
                                            maxJapaneseIssueAbsolute: 3
                                        }
                                    );
                                    if (jsonValidationResult != undefined && jsonValidationResult.needsCorrection != true) {
                                        console.log("Batch Validation result:", jsonValidationResult);
                                    }
                                } else {
                                    compareLineHeadersResult = compareLineHeaders(
                                        batchforbatchtransLineLogic, 
                                        responseBeforeCleanup
                                    );
                                }
                                if (jsonValidationResult.needsCorrection == true && ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2"))) {
                                    let correctionRequest = jsonValidationResult.correctionRequest;
                                    console.error("Batch Validation result:", jsonValidationResult);
                                    if (correctionRequest != undefined && correctionRequest != "" && correctionRequest != []) {
                                        problemExplainerPromptAddition = correctionRequest;
                                        lastCorrectionPromptForServerError = problemExplainerPromptAddition;
                                        problemExplainerErrorAddition = `The response failed batch response validation.\nCorrection request sent to LLM:\n'${correctionRequest}'`;
                                    } else {
                                        this.error(`[DSLR] Something went very wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                        console.error(`[DSLR] Something went very wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                    }
                                } else if (!compareLineHeadersResult.isMatch && ((!ep.enableJsonFullBatch && llmToUse == "model1") || (!this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2"))) {
                                    const {
                                        missingInSecondString,
                                        extraInSecondString
                                    } = compareLineHeadersResult.differences;
                                    let missin = missingInSecondString.join(', ');
                                    let extraa = extraInSecondString.join(', ');
                                    if (missin != undefined && missin != "" && missin != [] && extraa != undefined && extraa != "" && extraa != []) {
                                        missin = missin.replaceAll(/дiv(\d+)/g, "--- {дiv$1} ---");
                                        extraa = extraa.replaceAll(/дiv(\d+)/g, "--- {дiv$1} ---");
                                        problemExplainerPromptAddition = `Your response did not correctly preserve section markers. Make sure you also include the translation matching the text of the original marker below it. It was missing these markers: '${missin}' and had these extra markers: '${extraa}'`;
                                        problemExplainerErrorAddition = `The response did not correctly preserve section markers. It was missing these markers: '${missin}' and had these extra markers: '${extraa}'`;
                                        lastCorrectionPromptForServerError = problemExplainerPromptAddition;
                                    } else if (missin != undefined && missin != "" && missin != []) {
                                        missin = missin.replaceAll(/дiv(\d+)/g, "--- {дiv$1} ---");
                                        problemExplainerPromptAddition = `Your response did not correctly preserve section markers. It was missing these sections '${missin}'`;
                                        problemExplainerErrorAddition = `The response did not correctly preserve section markers. It was missing these sections '${missin}'`;
                                        lastCorrectionPromptForServerError = problemExplainerPromptAddition;
                                    } else if (extraa != undefined && extraa != "" && extraa != []) {
                                        extraa = extraa.replaceAll(/дiv(\d+)/g, "--- {дiv$1} ---");
                                        problemExplainerPromptAddition = `Your response wrongly added additional section markers. It had these addtional markers: '${extraa}'`;
                                        problemExplainerErrorAddition = `The response wrongly added additional section markers. It had these addtional markers: '${extraa}'`;
                                        lastCorrectionPromptForServerError = problemExplainerPromptAddition;
                                    } else if (compareLineHeadersResult.differences.orderChanged) {
                                        problemExplainerPromptAddition = `Your response did not preserve the original order of the section markers.`;
                                        wrongorder = "true";
                                        lastCorrectionPromptForServerError = problemExplainerPromptAddition;
                                    } else {
                                        this.error(`[DSLR] Something went wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                        console.error(`[DSLR] Something went wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                    }
                                    if (wrongorder == "false" && translatedLines.length === batch.length && ((missin == undefined || missin == "" || missin == []) && (extraa == undefined || extraa == "" || extraa == []))) {
                                        this.error(`[DSLR] Something went very wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                        console.error(`[DSLR] Something went very wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                    }
                                } else if (responseBeforeCleanup.length >= batchforbatchtransLineLogic.length * 10 || responseBeforeCleanup.length * 2 <= batchforbatchtransLineLogic.length) {
                                    lengthproblem = 'true';
                                } else {
                                    if ((!ep.enableJsonFullBatch && llmToUse == "model1") || (!this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        console.log('[DSLR] Batch passed line header check.');
                                        commandCheck = validateAndRequestCorrection(
                                            batchforbatchtransLineLogicOrigPlaceholder, 
                                            responseBeforeCleanupOrigPlaceholder,
                                            llmToUse,
                                            this.optionNameCommandReplacer.getValue(),
                                            this.optionCharacterCommandReplacer.getValue(),
                                            this.optionImageCommandReplacer.getValue(),
                                            this.optionVariableCommandReplacer.getValue(),
                                            this.optionColorCommandReplacer.getValue(),
                                            this.optionPlaceholderReplacer.getValue(),
                                            this.optionNameCommandReplacer2.getValue(),
                                            this.optionCharacterCommandReplacer2.getValue(),
                                            this.optionImageCommandReplacer2.getValue(),
                                            this.optionVariableCommandReplacer2.getValue(),
                                            this.optionColorCommandReplacer2.getValue(),
                                            this.optionPlaceholderReplacer2.getValue()
                                        );
                                    }
                                    if (commandCheck.needsCorrection == true && ((!ep.enableJsonFullBatch && llmToUse == "model1") || (!this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2"))) {
                                        commandproblem = "true";
                                        batchCommandCorrectionRequest = commandCheck.correctionRequest;
                                        lastCorrectionPromptForServerError2 = batchCommandCorrectionRequest;
                                    } else if (batchforbatchtransLineLogic.match(/\\\w+<.+?>/g) != null && responseBeforeCleanup.match(/\\\w+<.+?>/g) == null) {
                                            commandproblem = "true";
                                    } else if (translatedLines.length === batch.length && lengthproblem == 'false' && placeholderproblem == 'false' && commandproblem == 'false' && wrongorder == "false" && (problemExplainerErrorAddition == "" || problemExplainerErrorAddition == undefined) && (batchCommandCorrectionRequest == "" || batchCommandCorrectionRequest == undefined)) {
                                        break; // Success - exit retry loop
                                    } else {
                                        this.error(`[DSLR] Something went wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                        console.error(`[DSLR] Something went wrong during batch response evaluation. Attempt will fail without correct error message.`);
                                    }
                                }
                            } catch (error) {
                                console.error("[DSLR]Batch Validation failed:", error);
                                // Handle timeout gracefully
                            }

                        if (retryCount <= maxRetries) {
                            retryCount++;
                            recordBatchCorrectionRetry();
                            if (problemExplainerErrorAddition == "" && problemExplainerErrorAddition == undefined) {
                                lastCorrectionRequest = "";
                            }
                            if (maxRetries > 0 && retryCount == 1) {
                                //Full Batch attempts
                                if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                    errorBody = jsonRequest;
                                } else if (errorBody == "") {
                                    errorBody = batchforbatchtransLineLogic;
                                }
                                if (lengthproblem == 'false' && placeholderproblem == 'false' && commandproblem == 'false' && wrongorder == "false" && (problemExplainerErrorAddition == "" || problemExplainerErrorAddition == undefined) && (batchCommandCorrectionRequest == "" || batchCommandCorrectionRequest == undefined)) {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to batch validation failing completely. This is a serious error, please report it.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to batch validation failing. This is a serious error, please report it. (Received ${translatedLines.length}, Expected ${batch.length})`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                } else if (problemExplainerErrorAddition != "" && problemExplainerErrorAddition != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt.`);
                                        errorCollapsed("Reason:", problemExplainerErrorAddition);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    } else {
                                        this.error(`[DSLR] (${retryCount}/2)  Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt.`);
                                        errorCollapsed("Reason:", problemExplainerErrorAddition);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                    lastCorrectionRequest = problemExplainerPromptAddition;
                                } else if (batchCommandCorrectionRequest != "" && batchCommandCorrectionRequest != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request sent to LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    } else {
                                        this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request sent to LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                } else if (wrongorder == 'true') {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to response putting translations in the wrong order.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to response putting translations in the wrong order.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                } else if (lengthproblem == 'true') {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to serious response length difference.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to serious response length difference.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                } else if (commandproblem == 'true') {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                }
                            } else if (maxRetries > 0 && retryCount == 2) {
                                if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                    errorBody = jsonRequest;
                                } else if (errorBody == "") {
                                    errorBody = batchforbatchtransLineLogic;
                                }
                                if (lengthproblem == 'false' && placeholderproblem == 'false' && commandproblem == 'false' && wrongorder == "false" && (problemExplainerErrorAddition == "" || problemExplainerErrorAddition == undefined) && (batchCommandCorrectionRequest == "" || batchCommandCorrectionRequest == undefined)) {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to batch validation failing completely. This is a serious error, please report it.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt due to batch validation failing. This is a serious error, please report it. (Received ${translatedLines.length}, Expected ${batch.length})`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                } else if (problemExplainerErrorAddition != "" && problemExplainerErrorAddition != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        let newProbs = problemExplainerPromptAddition.split("\n");
                                        let oldProbs = lastCorrectionRequest.split("\n");
                                        if (newProbs.length >= oldProbs.length && (batch.length * 0.75) >= minBatchLines) {
                                            this.error(`[DSLR] Did not receive usable response, and it did not improve compared to the last even though it received specific instructions.\n[DSLR] (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                            console.error(`[DSLR] Did not receive usable response, and it did not improve compared to the last even though it received specific instructions.`);
                                            errorCollapsed("Reason:", problemExplainerErrorAddition);
                                            errorCollapsed("Request:", errorBody);
                                            errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                            attemptRecovery("Did not receive an improved usable response after correction prompts.");
                                            break;
                                        }
                                        this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt.`);
                                        errorCollapsed("Reason:", problemExplainerErrorAddition);
                                        errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    } else {
                                        this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt.`);
                                        errorCollapsed("Reason:", problemExplainerErrorAddition);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                    lastCorrectionRequest = problemExplainerPromptAddition;
                                } else if (batchCommandCorrectionRequest != "" && batchCommandCorrectionRequest != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request sent to LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    } else {
                                        this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with new prompt. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request sent to LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                } else if (wrongorder == 'true') {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with the aggressive prompt and specific error explanation prompt due to response putting translations in the wrong order.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with the aggressive prompt and specific error explanation prompt due to response putting translations in the wrong order.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                } else if (lengthproblem == 'true') {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with the aggressive prompt due to serious response length difference.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with the aggressive prompt due to serious response length difference.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] AgressiveBatchRetryPrompt:\n${AggressiveBatchRetryPrompt}`);
                                } else if (commandproblem == 'true') {
                                    this.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with the aggressive prompt due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    console.error(`[DSLR] (${retryCount}/2) Retrying Full Batch with the aggressive prompt due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] AgressiveBatchRetryPrompt:\n${AggressiveBatchRetryPrompt}`);
                                }
                            } else if (maxRetries > 0 && retryCount >= 3 && batch.length >= minBatchLines) {
                                if (errorBody == "") {
                                    errorBody = batchforbatchtransLineLogic;
                                }
                                // Set when this response improved over the last correction attempt. The
                                // recovery tail at the end of this branch must then do a normal retry
                                // (the retryCount decrement in the improvement case grants the extra
                                // attempt) instead of handing the batch to fallback/split.
                                let improvementExtraTry = false;
                                if (lengthproblem == 'false' && placeholderproblem == 'false' && commandproblem == 'false' && wrongorder == "false" && (problemExplainerErrorAddition == "" || problemExplainerErrorAddition == undefined)) {
                                    this.error(`[DSLR] Full Batch failed due to batch validation failing completely. This is a serious error, please report it.`);
                                    console.error(`[DSLR] Full Batch failed due to batch validation failing completely. This is a serious error, please report it. (Received ${translatedLines.length}, Expected ${batch.length})`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] AgressiveBatchRetryPrompt:\n${AggressiveBatchRetryPrompt}`);
                                } else if (problemExplainerErrorAddition != "" && problemExplainerErrorAddition != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        let newProbs = problemExplainerPromptAddition.split("\n");
                                        let oldProbs = lastCorrectionRequest.split("\n");
                                        if (newProbs.length < oldProbs.length) {
                                            this.error(`[DSLR] Trying an additional time even though the response still failed the batch validation test (View the console (F12) for details.), because the response improved compared to the last.`);
                                            console.error(`[DSLR] Trying an additional time even though the response still failed the batch validation test, because the response improved compared to the last.`);
                                            errorCollapsed("Reason:", problemExplainerErrorAddition);
                                            errorCollapsed("Request:", errorBody);
                                            errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                            retryCount = retryCount - 1;
                                            improvementExtraTry = true;
                                        } else {
                                            this.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                            console.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test.`);
                                            errorCollapsed("Correction request that would have been sent to the LLM:", problemExplainerPromptAddition);
                                            errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        }
                                    } else {
                                        this.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request that would have been sent to the LLM:", problemExplainerPromptAddition);
                                        errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                    lastCorrectionRequest = problemExplainerPromptAddition;
                                } else if (batchCommandCorrectionRequest != "" && batchCommandCorrectionRequest != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        this.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request that would have been sent to the LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    } else {
                                        this.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] Full Batch failed. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request that would have been sent to the LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                } else if (wrongorder == 'true') {
                                    this.error(`[DSLR] Full Batch failed due to response putting translations in the wrong order.`);
                                    console.error(`[DSLR] Full Batch failed due to response putting translations in the wrong order.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                } else if (lengthproblem == 'true') {
                                    this.error(`[DSLR] Full Batch failed due to serious response length difference.`);
                                    console.error(`[DSLR] Full Batch failed due to serious response length difference.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] AgressiveBatchRetryPrompt:\n${AggressiveBatchRetryPrompt}`);
                                } else if (commandproblem == 'true') {
                                    this.error(`[DSLR] Full Batch failed due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    console.error(`[DSLR] Full Batch failed due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] AgressiveBatchRetryPrompt:\n${AggressiveBatchRetryPrompt}`);
                                }
                                if (improvementExtraTry) {
                                    // The response improved over the last correction attempt, so use the
                                    // extra try granted by the retryCount decrement and retry the batch
                                    // normally instead of splitting it.
                                    updateFullBatchFailCount(1);
                                    await new Promise(resolve => setTimeout(resolve, batchretryDelay));
                                    continue;
                                }
                                this.error(`[DSLR] Did not receive usable Full Batch response after all retries.`);
                                console.error(`[DSLR] Did not receive usable Full Batch response after all retries.`);
                                attemptRecovery("Did not receive a usable Full Batch response after all retries.");
                                break;
                            } else if (maxRetries == 0) {
                                if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                    errorBody = jsonRequest;
                                } else if (errorBody == "") {
                                    errorBody = batchforbatchtransLineLogic;
                                }
                                if (lengthproblem == 'false' && placeholderproblem == 'false' && commandproblem == 'false' && wrongorder == "false" && (problemExplainerErrorAddition == "" || problemExplainerErrorAddition == undefined) && (batchCommandCorrectionRequest == "" || batchCommandCorrectionRequest == undefined)) {
                                    this.error(`[DSLR] Full Batch failed due to batch validation failing completely and retries are disabled. This is a serious error, please report it.`);
                                    console.error(`[DSLR] Full Batch failed due to batch validation failing completely and retries are disabled. This is a serious error, please report it. (Received ${translatedLines.length}, Expected ${batch.length})`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                } else if (problemExplainerErrorAddition != "" && problemExplainerErrorAddition != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        this.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request that would have been sent to the LLM:", problemExplainerPromptAddition);
                                        errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    } else {
                                        this.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request that would have been sent to the LLM:", problemExplainerPromptAddition);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                    lastCorrectionRequest = problemExplainerPromptAddition;
                                } else if (batchCommandCorrectionRequest != "" && batchCommandCorrectionRequest != undefined) {
                                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                                        this.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request that would have been sent to the LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                    } else {
                                        this.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test. View the console (F12) for details.)`);
                                        console.error(`[DSLR] Full Batch failed and retries are disabled. (Reason: The response failed the batch validation test.`);
                                        errorCollapsed("Correction request that would have been sent to the LLM:", batchCommandCorrectionRequest);
                                        errorCollapsed("Request:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                        //console.log(`[DSLR] BatchRetryPrompt:\n${BatchRetryPrompt}`);
                                    }
                                } else if (wrongorder == 'true') {
                                    this.error(`[DSLR] Retries disabled - failing immediately due to response putting translations in the wrong order.`);
                                    console.error(`[DSLR] Retries disabled - failing immediately due to serious response length difference.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                } else if (lengthproblem == 'true') {
                                    this.error(`[DSLR] Retries disabled - failing immediately due to response putting translations in the wrong order.`);
                                    console.error(`[DSLR] Retries disabled - failing immediately due to serious response length difference.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                } else if (commandproblem == 'true') {
                                    this.error(`[DSLR] Retries disabled - failing immediately due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    console.error(`[DSLR] Retries disabled - failing immediately due to significant failure to correctly preserve commands/placeholders (or their set replacements) in the response.`);
                                    errorCollapsed("Request:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                                }
                                batchwassuccessfull = "false";
                                updateFullBatchFailCount(1);
                                break;
                            }
                            updateFullBatchFailCount(1);
                            await new Promise(resolve => setTimeout(resolve, batchretryDelay));
                            continue;
                        }
                        if (errorBody == "") {
                            errorBody = batchforbatchtransLineLogic;
                        }
                        this.error(`[DSLR] Full Batch step failed. Received ${translatedLines.length} translations for ${batch.length} requests.`);
                        console.error(`[DSLR] Full Batch step failed. Received ${translatedLines.length} translations for ${batch.length} requests. Or ${ResponseDivderCount} Dividers for ${BatchDivderCount} Dividers in the original.`);
                        errorCollapsed("Request:", errorBody);
                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                        batchwassuccessfull = "false";
                        updateFullBatchFailCount(1);
                        break;
                    }
                    // If we get here, we have a valid response. Only apply this line-count
                    // check when no failure/recovery path has already decided the outcome
                    // (they set "false" before breaking out of the retry loop). Otherwise a
                    // rejected response whose line count happens to match would overwrite
                    // that decision and log a bogus "Received usable Full Batch response".
                    if (batchwassuccessfull == "not done") {
                        if (translatedLines.length === batch.length) {
                            batchwassuccessfull = "true";
                        } else {
                            batchwassuccessfull = "false";
                            updateFullBatchFailCount(1);
                        }
                    }
                } catch (error) {
                    updateErrorCount(batch.length);
                    this.error(`[DSLR] Error during translation: ${error.message}`);
                    console.error('[DSLR] Translation error:', error);
                    batchwassuccessfull = "false";
                    abortTranslation = "true";
                    updateFullBatchFailCount(1);
                }
            }

            if (SystemPromptAdditionValue != null && SystemPromptAdditionValue != undefined && SystemPromptAdditionValue != "") {
                SystemPromptAdditionValue = "\n" + SystemPromptAdditionValue;
                if ((this.optionSystemPromptAdditionTrim.getValue() == true && llmToUse == "model1") || (this.optionSystemPromptAdditionTrim2.getValue() == true && llmToUse == "model2")) {
                    SystemPromptAdditionValue = trimLinesMatchTerms(SystemPromptAdditionValue, batch, 0);
                }
            }
            if ((batchwassuccessfull == "true" || batchwassuccessfull == "false" || (this.optionEnableFullBatch.getValue() == false && llmToUse == "model1") || (this.optionEnableFullBatch2.getValue() == false && llmToUse == "model2") || batchwassuccessfull == "not done") && abortTranslation == "false" && this.aborted == false && fullBFail == "No") {
                if (batchwassuccessfull == "true") {
                    this.log(`[DSLR] Received usable Full Batch response. Now checking individual translations.`);
                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                        console.log(`[DSLR] Received usable Full Batch response. Now checking individual translations.`);
                        logCollapsed("Request:", jsonRequest);
                        logCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                    } else {
                        console.log(`[DSLR] Received usable Full Batch response. Now checking individual translations.`);
                        logCollapsed("Request:", batchforbatchtransLineLogic);
                        logCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                    }
                } else if (batchwassuccessfull == "false") {
                    this.error(`[DSLR] Did not receive usable Full Batch response. Now trying individual requests instead.`);
                    if ((ep.enableJsonFullBatch && llmToUse == "model1") || (this.optionEnableJsonFullBatch2.getValue() && llmToUse == "model2")) {
                        console.error(`[DSLR] Did not receive usable Full Batch response. Now trying individual requests instead.`);
                        errorCollapsed("Request:", jsonRequest);
                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                    } else {
                        console.error(`[DSLR] Did not receive usable Full Batch response. Now trying individual requests instead.`);
                        errorCollapsed("Request:", batchforbatchtransLineLogic);
                        errorCollapsed(`${llmName}'s response:`, responseBeforeCleanup);
                    }
                } else if (this.optionEnableFullBatch.getValue() == false) {
                    this.log(`[DSLR] Full Batch Translation Disabled. Sending individual requests instead.`);
                } else if (batchwassuccessfull == "not done") {
                    this.log(`[DSLR] Full Batch Translation unnecessary. Sending the individual request instead.`);
                }
                //Single Translation Request Processing
                // Review pass seed: windowed QC -> Judge over this batch's wire pairs,
                // producing per-line verdicts. The reviewer then acts as an ordinary
                // per-line check below (retried in RequestLoop like any other rejection).
                let reviewState = null;
                const _reviewOn = !!(this.optionReviewTranslations && this.optionReviewTranslations.getValue() === true);
                const _reviewAutoFixOn = _reviewOn && !!(this.optionReviewAutoFix && this.optionReviewAutoFix.getValue() === true);
                if (_reviewOn) {
                    reviewState = { seedApplied: false, verdicts: {}, flagged: new Set(), rounds: {}, reviewed: new Set(), unreviewed: new Set(), sections: [], exhaustNoted: new Set(), attempts: {} };
                    if (!this._reviewJudgeOn()) {
                        this.log("[DSLRReview] Judge disabled — QC findings at or above the minimum severity order retranslations directly (no judge call).");
                    }
                    try {
                        if (batchwassuccessfull == "true" && Array.isArray(translatedLines)
                            && Array.isArray(batchforbatchtrans)
                            && translatedLines.length === batch.length
                            && batchforbatchtrans.length === batch.length) {
                            const LineCheck = require("./review/linecheck");
                            // Validation-known rows skip the seed: leftover-Japanese
                            // and missing-quote rows the batch validator tolerated
                            // are fixed by the single-line structural pass first —
                            // each attempt re-runs the structural checks before any
                            // review verdict — and the fixed text re-reviews on the
                            // first structurally-clean attempt via the normal
                            // unreviewed path. So QC never re-reports problems the
                            // validator already knows about. Skipped rows join
                            // `unreviewed` (existing fail-closed semantics: no
                            // verdict, no flag, no tag from the seed).
                            try {
                                const _seedSkips = ResponsesApiHelpers_1.validationSeedSkips(jsonValidationResult)
                                    .filter((rp) => rp >= 0 && rp < batch.length);
                                for (const sp of _seedSkips) reviewState.unreviewed.add(sp);
                                if (_seedSkips.length) {
                                    this.log("[DSLRReview] skipping seed review for " + _seedSkips.length +
                                        " row(s) with validation-known issues (@" + _seedSkips.join(",@") +
                                        "); they re-review after the single-line fix pass.");
                                }
                            } catch (e) { /* advisory only */ }
                            const reviewPairs = [];
                            for (let rp = 0; rp < batch.length; rp++) {
                                if (reviewState.unreviewed.has(rp)) continue;
                                reviewPairs.push({ index: rp, speaker: "",
                                    wireSrc: batchforbatchtrans[rp], wireDst: translatedLines[rp] });
                            }
                            try {
                                reviewState.sections = this._reviewSections(
                                    (batchforbatchtrans || []).join("\n"), options,
                                    (() => {
                                        try {
                                            const f = this._reviewSectionsFit(endpointNumber);
                                            f.userText = (batchforbatchtrans || []).join("\n") + "\n" +
                                                (translatedLines || []).join("\n");
                                            return f;
                                        } catch (e) { return null; }
                                    })()) || [];
                            } catch (e) { reviewState.sections = []; }
                            const seeded = await LineCheck.reviewWindows(reviewPairs, {
                                callModel: async (system, user, kind, extra) => this.reviewCompletion(
                                    this._reviewMessages(system, extra && extra.context, user),
                                    { endpointNumber: endpointNumber, label: kind, reviewScale: "seed" }),
                                replacers: this._reviewReplacers(),
                                qcOverrides: this._reviewPromptOverrides("Qc"),
                                judgeOverrides: this._reviewPromptOverrides("Judge"),
                                judge: this._reviewJudgeOn(),
                                minSeverity: this._reviewMinSeverity(),
                                cacheFriendly: this._cacheFriendlyPromptsActive(),
                                log: (m) => { try { this.log("[DSLRReview] " + m); } catch (e) { } },
                                sections: reviewState.sections
                            });
                            reviewState.seedApplied = true;
                            reviewState.verdicts = seeded.verdicts || {};
                            for (const fp of (seeded.flagged || [])) reviewState.flagged.add(fp);
                            for (const up of (seeded.unreviewed || [])) reviewState.unreviewed.add(up);
                            // Seed attempt log: every reviewed row's batch text plus
                            // the verdict it drew, so retries have a history for
                            // the no-progress guard, best-of acceptance, and the
                            // re-review prompts. Unreviewed rows get no entry —
                            // "could not review" is not an attempt.
                            try {
                                for (let rp = 0; rp < batch.length; rp++) {
                                    if (reviewState.unreviewed.has(rp)) continue;
                                    if (translatedLines[rp] == null || translatedLines[rp] === "") continue;
                                    reviewState.attempts[rp] = [{
                                        text: translatedLines[rp],
                                        verdict: reviewState.verdicts[rp] || null
                                    }];
                                }
                            } catch (e) { /* attempt log is advisory only */ }
                            (seeded.log || []).forEach((l) => { try { this.log("[DSLRReview] " + l); } catch (e) { } });
                        }
                    } catch (e) {
                        this.error("[DSLR] Review pass failed: " + (e && e.message));
                    }
                    try { options._reviewStateByIndex = {}; } catch (e) { }
                }
                BatchProcessing: for (let i = 0; i < batch.length; i++) {
                    try {
                        let dtextOriginalText = "";
                        let errorBody = "";
                        let translationsuccessful = false;
                        let maxRetries = this.optionEnableRetry.getValue() ? 10 : 0;
                        if (this.optionEnableRetry.getValue() == true && this.optionLimitFallback.getValue() == true && this.optionEnableFallback.getValue() == true) {
                            maxRetries = 15;
                        }
                        let retryDelay = 1000; // additional 1 second between retries
                        let retryCount = 0;
                        let rejectValue = this.optionEnableReject.getValue();
                        if (llmToUse == "model2") {
                            rejectValue = this.optionEnableReject2.getValue();
                        }
                        let RefusalRetryCount = 0;
                        let MaxRefusalRetries = 2;
                        let serverRetryCount = 0;
                        let MaxserverRetries = 5;
                        let MaxserverRetriesFTF = 6;
                        let MaxserverRetries429 = 12;
                        let MaxserverRetries400 = 2;
                        let serverRetriesdelay = 30000;
                        let Retries429Delay = 3000;
                        let Retries400Delay = 10000;
                        let responseText;
                        let unchangedResponse;
                        let originalText = batch[i];
                        originalPlacolderText = "";
                        let translatedText = translatedLines[i];
                        let bracketsatfront = originalText.match(/^\s*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+/g);
                        let bracketsatfrontincludesshortener = false;
                        if (bracketsatfront != null) {
                            if (bracketsatfront.includes("\'") && originalText.match(/^[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“]*?[\'].*?[\'].*[^\s]/g) != null) {
                                bracketsatfrontincludesshortener = true;
                            }
                        }
                        let bracketsatback = originalText;
                        let bracketsatbackincludesshortener = false;
                        if (bracketsatback.match(/\\[cdinvw]\[[^\]\r\n]+\]\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$|\\[n][w]\[[^\]\r\n]+\]\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$/gi) != null) {
                            bracketsatback = bracketsatback.replaceAll(/(\\[cdinvw])\[([^\]]+)\](\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$)/gi, "$3");
                            bracketsatback = bracketsatback.replaceAll(/(\\[n][w])\[([^\]]+)\](\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$)/gi, "$3");
                            bracketsatback = bracketsatback.match(/[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+\s*;?$/gi);
                        } else {
                            bracketsatback = originalText.match(/(?<!\\[cdinvw]\[\d|\\[n][w]\[\d)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+\s*;?$/gi);
                        }
                        if (bracketsatback != null) {
                            if (bracketsatback.includes("\'") && originalText.match(/[\'].*?[\'][\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"`´]*\s*;?$/g) != null) {
                                bracketsatbackincludesshortener = true;
                            }
                        }
                        let trimmedOriginalText = originalText;
                        trimmedOriginalText = trimmedOriginalText.replaceAll(/^\s*[\n\r]/g, "");
                        trimmedOriginalText = trimmedOriginalText.replaceAll(/[\n\r]\s*;?$/g, "");
                        trimmedOriginalText = trimmedOriginalText.replaceAll(/^\s*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+/g, "");
                        if (trimmedOriginalText.match(/\\[cdinvw]\[[^\]\r\n]+\]\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$|\\[n][w]\[[^\]\r\n]+\]\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$/gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/(\\[cdinvw])\[([^\]]+)\](\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$)/gi, "$1SHIBRACK$2SHIBRACK$3");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/(\\[n][w])\[([^\]]+)\](\s*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*\s*;?$)/gi, "$1SHIBRACK$2SHIBRACK$3");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+\s*;?$/gi, "");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/SHIBRACK(.*?)SHIBRACK/g, "\[$1\]");
                        } else {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+\s*;?$/gi, "");
                        }
                        if (trimmedOriginalText.match(/^[^〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“]+?[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+[^\s]/g) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^([^〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“]+?)([\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+)([^\s])/g, '"$1"$3');
                        }
                        if (trimmedOriginalText.match(/^[^〔⟨〖〘〚｢〈《「『【（［\[\({＜<｛｟]+?[\]\)}〕〗〙〛｣〉》」』】）］＞>｝｠⟩]+(?!\s*;?$)/g) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^([^〔⟨〖〘〚｢〈《「『【（［\[\({＜<｛｟]+?)([\]\)}〕〗〙〛｣〉》」』】）］＞>｝｠⟩]+)(?!\s*;?$)/g, '"$1"');
                        }
                        if (trimmedOriginalText.match(/^(?:[^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]|\\+[civn]w?\[\d+\])+([〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“])[^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+?$/g) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^((?:[^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]|\\+[civn]w?\[\d+\])+)[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟'´`“]([^\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´]+?)$/g, '$1"$2"');
                        }
                        dtextOriginalText = trimmedOriginalText;
                        if (trimmedOriginalText.match(/^D_TEXT .*? \d+$/gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^D_TEXT /gi, "");
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/ \d+$/gi, "");
                        } else if (trimmedOriginalText.match(/^D_TEXT /gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/^D_TEXT /gi, "");
                        } else if (trimmedOriginalText.match(/(?<=[\.?!,？！、。\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]) \d+$/gi) != null) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/ \d+$/gi, "");
                        }
                        if (this.optionReplaceLinebreaks.getValue()) {
                            trimmedOriginalText = trimmedOriginalText.replaceAll(/\n/g, "<br>");
                        }
                        originalPlacolderText = trimmedOriginalText;
                        if (llmToUse == "model1" && trimmedOriginalText.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                            if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                            }
                            if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                            }
                            if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                            }
                            if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                            }
                            if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                            }
                            if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                            }
                        } else if (llmToUse == "model2" && trimmedOriginalText.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                            if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                            }
                            if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                            }
                            if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                            }
                            if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                            }
                            if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                            }
                            if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                trimmedOriginalText = trimmedOriginalText.replaceAll(/(@\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                            }
                        }
                        if (trimmedOriginalText == null || trimmedOriginalText == undefined || trimmedOriginalText == "") {
                            console.error('[DSLR] Input batch was fubar after trimming. Something went seriously wrong.');
                            errorCollapsed("Original Text:", originalText);
                            errorCollapsed("Whole Batch:", batch);
                            this.error(`[DSLR] Input batch was fubar after trimming. Something went seriously wrong.`);
                            break BatchProcessing;
                            break;
                        }
                        let maxTokenValue = this.optionMaxTokens.getValue();
                        if (llmToUse == "model2") {
                            maxTokenValue = this.optionMaxTokens2.getValue();
                            apiKey = this.optionApiKey2.getValue();
                            apiUrl = EndpointHelpers_1.fixApiUrl(this.optionApiUrl2.getValue(), this.optionDoNotFixURL2.getValue());
                            if (!apiUrl) {
                                this.error("[DSLR] No api url entry found.");
                                console.error("[DSLR] No api url entry found.");
                            }
                            llmTemp = this.optionTemperature2.getValue();
                            llmTopK = this.optionTopK2.getValue();
                            llmTopP = this.optionTopP2.getValue();
                            llmMinP = this.optionMinP2.getValue();
                            llmReqDelay = this.optionRequestDelay2.getValue();
                            llmRepeatPen = this.optionRepeatPenalty2.getValue();
                            llmRepetitionPen = this.optionRepetitionPenalty2.getValue();
                            freqPen = this.optionFrequencyPenalty2.getValue();
                            presPen = this.optionPresencePenalty2.getValue();
                            chatTempKwargs = this.optionChatTemplateKwargs2.getValue();
                            if (this.optionDisableStream2.getValue() == true) {
                                llmStream = false;
                            }
                        } else if (llmToUse == "model1") {
                            maxTokenValue = ep.maxTokens;
                            apiKey = ep.apiKey;
                            apiUrl = EndpointHelpers_1.fixApiUrl(ep.apiUrl, ep.doNotFixURL);
                            llmTemp = ep.temperature;
                            llmTopK = ep['top_k'];
                            llmTopP = ep['top_p'];
                            llmMinP = ep['min_p'];
                            llmReqDelay = ep.requestDelay;
                            llmRepeatPen = ep.repeat_penalty;
                            llmRepetitionPen = ep.repetition_penalty;
                            freqPen = ep.frequency_penalty;
                            presPen = ep.presence_penalty;
                            chatTempKwargs = ep.chat_template_kwargs;
                            if (ep.disableStream == true) { llmStream = false; }
                        }
                        if (this._isReasoningActive(llmToUse, endpointNumber)) {
                            console.log("[DSLR] Reasoning enabled (" + this._reasoningFormatFor(llmToUse, endpointNumber) + ").");
                        } else {
                            if (maxTokenValue > trimmedOriginalText.length * 3.5 && (!ResponsesApiHelpers_1.isResponsesApiUrl(apiUrl) || this.optionScaleMaxTokensResponses.getValue())) {
                                maxTokenValue = trimmedOriginalText.length * 3.5;
                                maxTokenValue = parseInt(maxTokenValue);
                                if (maxTokenValue < 100) {
                                    maxTokenValue = 100;
                                }
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 5));
                        RequestLoop: while (retryCount <= maxRetries && !this.aborted) {
                            if (serverRetryCount > 0) {
                                serverRetriesdelay = serverRetriesdelay * 3;
                                Retries429Delay = Retries429Delay * 3;
                                Retries400Delay = Retries400Delay * 2;
                            }
                            translationsuccessful = false;
                            if (this.aborted) {
                                break BatchProcessing;
                                break;
                            }
                            if (i > 0) {
                                await new Promise(resolve => setTimeout(resolve, 5));
                            }
                            //Make sure messages use the right model Name after successfull fallback
                            if (llmToUse == "model1") {
                                llmName = this.optionModel.getValue() || 'Unspecified LLM';
                                llmName = llmName.replaceAll(/^.*[\\\/]+/g, "");
                                llmName = llmName.replaceAll(/:.*$/g, "");
                                llmName = llmName.replaceAll(/[\?\"\<\>|]/g, "");
                                if (llmName == "" && this.optionModel.getValue() != "") {
                                    console.error("[DSLR] Weird model name, trimming less.");
                                    llmName = this.optionModel.getValue().replaceAll(/[\?\"\<\>|\\\/]/g, "-");
                                    if (llmName == "" || llmName.match(/[^\-]/g) == null) {
                                        console.error("[DSLR] Unusable model name. using 'Unspecified LLM'.");
                                        llmName = "Unspecified LLM";
                                    }
                                } else if (llmName == "" && this.optionModel.getValue() == "") {
                                    console.error("[DSLR] No model name found. Using 'Unspecified LLM'.");
                                    llmName = "Unspecified LLM";
                                }
                            }
                            if (llmToUse == "model1" && trimmedOriginalText.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                                if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                                }
                                if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                                }
                                if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                                }
                                if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                                }
                                if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                                }
                                if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                                }
                            } else if (llmToUse == "model2" && trimmedOriginalText.match(/\\[nvic][w]?\[\d+\]|@\d+/gi) != null) {
                                if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                                }
                                if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                                }
                                if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                                }
                                if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                                }
                                if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                                }
                                if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                                }
                            }
                            //Skip first request if we already have a checkable response
                            if ((retryCount < 1 && ep.enableFullBatch == true && batchwassuccessfull == "true" && translatedText != undefined && translatedText != "" && llmToUse == "model1") || (retryCount < 1 && this.optionEnableFullBatch2.getValue() == true && batchwassuccessfull == "true" && translatedText != undefined && translatedText != "" && llmToUse == "model2")) {
                                //console.log("[DSLR] Skipping first try, checking Full Batch entry instead.");
                                responseText = translatedText;
                                unchangedResponse = translatedText;
                            } else if (window.transConfig.japanesesource == true && trimmedOriginalText.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) == null) {
                                console.log("[DSLR] Skipping request, There was no Japanese to translate.");
                                responseText = trimmedOriginalText;
                                unchangedResponse = trimmedOriginalText;
                            } else {
                                // Add delay between requests
                                if (i > 0) {
                                    await new Promise(resolve => setTimeout(resolve, llmReqDelay));
                                }
                                let orgtempah = llmTemp;
                                if (retryCount >= 7) {
                                    if (orgtempah < 0.5 && orgtempah != null && orgtempah !== "") {
                                    llmTemp = llmTemp + 0.1;
                                    } else if (orgtempah >= 0.5 && orgtempah != null && orgtempah !== "") {
                                        llmTemp = llmTemp - 0.1;
                                    }
                                    if (llmRepeatPen == 1.0 && llmRepeatPen != null) {
                                        llmRepeatPen = 1.1;
                                    }
                                    if (llmRepetitionPen == 1.0 && llmRepetitionPen != null) {
                                        llmRepetitionPen = 1.1;
                                    }
                                    if (freqPen == 1.0 && freqPen != null) {
                                        freqPen = 1.1;
                                    }
                                    if (llmTopK < 40 && llmTopK != null && llmTopK !== "") {
                                        llmTopK = llmTopK + 5;
                                    }
                                }
                                if (retryCount >= 8) {
                                    if (orgtempah < 0.5 && orgtempah != null && orgtempah !== "") {
                                    llmTemp = llmTemp + 0.1;
                                    } else if (orgtempah >= 0.5 && orgtempah != null && orgtempah !== "") {
                                        llmTemp = llmTemp - 0.1;
                                    }
                                    if (llmTopK < 40 && llmTopK != null && llmTopK !== "") {
                                        llmTopK = llmTopK + 5;
                                    }
                                }
                                if (retryCount >= 9) {
                                    if (orgtempah < 0.5 && orgtempah != null && orgtempah !== "") {
                                    llmTemp = llmTemp + 0.1;
                                    } else if (orgtempah >= 0.5 && orgtempah != null && orgtempah !== "") {
                                        llmTemp = llmTemp - 0.1;
                                    }
                                    if (llmRepeatPen == 1.0 && llmRepeatPen != null) {
                                        llmRepeatPen = 1.1;
                                    }
                                    if (llmRepetitionPen == 1.0 && llmRepetitionPen != null) {
                                        llmRepetitionPen = 1.1;
                                    }
                                    if (freqPen == 1.0 && freqPen != null) {
                                        freqPen = 1.1;
                                    }
                                    if (llmTopK < 40 && llmTopK != null && llmTopK !== "") {
                                        llmTopK = llmTopK + 5;
                                    }
                                }
                                if (retryCount >= 10) {
                                    if (orgtempah < 0.5 && orgtempah != null && orgtempah !== "") {
                                    llmTemp = llmTemp + 0.1;
                                    } else if (orgtempah >= 0.5 && orgtempah != null && orgtempah !== "") {
                                        llmTemp = llmTemp - 0.1;
                                    }
                                    if (llmTopK < 40 && llmTopK != null && llmTopK !== "") {
                                        llmTopK = llmTopK + 5;
                                    }
                                }
                                if (retryCount >= 11 && this.optionLimitFallback.getValue() == true  && this.optionEnableFallback.getValue() == true) {
                                    RetryPrompt = this.optionRetryPrompt2.getValue();
                                    SystemPromptValue = this.optionSystemPrompt2.getValue();
                                    UserPromptValue = this.optionUserPrompt2.getValue();
                                    SystemPromptAdditionValue = this.optionSystemPromptaddition2.getValue();
                                    if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                                    }
                                    if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                                    }
                                    if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                                    }
                                    if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                                    }
                                    if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                                    }
                                    if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                                    }
                                    maxTokenValue = this.optionMaxTokens2.getValue();
                                    activeLLM = this.optionModel2.getValue();
                                    apiKey = this.optionApiKey2.getValue();
                                    apiUrl = EndpointHelpers_1.fixApiUrl(this.optionApiUrl2.getValue(), this.optionDoNotFixURL2.getValue());
                                    if (!apiUrl) {
                                        this.error("[DSLR] No api url entry found.");
                                        console.error("[DSLR] No api url entry found.");
                                    }
                                    llmTemp = this.optionTemperature2.getValue();
                                    llmTopK = this.optionTopK2.getValue();
                                    llmTopP = this.optionTopP2.getValue();
                                    llmMinP = this.optionMinP2.getValue();
                                    llmReqDelay = this.optionRequestDelay2.getValue();
                                    llmRepeatPen = this.optionRepeatPenalty2.getValue();
                                    llmRepetitionPen = this.optionRepetitionPenalty2.getValue();
                                    freqPen = this.optionFrequencyPenalty2.getValue();
                                    presPen = this.optionPresencePenalty2.getValue();
                                    chatTempKwargs = this.optionChatTemplateKwargs2.getValue();
                                    if (this.optionDisableStream2.getValue() == true) {
                                        llmStream = false;
                                    }
                                    llmName = this.optionModel2.getValue() || 'Unspecified LLM';
                                    llmName = llmName.replaceAll(/^.*[\\\/]+/g, "");
                                    llmName = llmName.replaceAll(/:.*$/g, "");
                                    llmName = llmName.replaceAll(/[\?\"\<\>|]/g, "");
                                    if (llmName == "" && this.optionModel2.getValue() != "") {
                                        console.error("[DSLR] Weird model name, trimming less.");
                                        llmName = this.optionModel2.getValue().replaceAll(/[\?\"\<\>|\\\/]/g, "-");
                                        if (llmName == "" || llmName.match(/[^\-]/g) == null) {
                                            console.error("[DSLR] Unusable model name. using 'Unspecified LLM'.");
                                            llmName = "Unspecified LLM";
                                        }
                                    } else if (llmName == "" && this.optionModel2.getValue() == "") {
                                        console.error("[DSLR] No model name found. Using 'Unspecified LLM'.");
                                        llmName = "Unspecified LLM";
                                    }
                                } else if (activeLLM == this.optionModel2.getValue() && llmToUse == "model1") {
                                    RetryPrompt = ep.retryPrompt;
                                    SystemPromptValue = ep.systemPrompt;
                                    UserPromptValue = ep.userPrompt;
                                    SystemPromptAdditionValue = ep.systemPromptaddition;
                                    if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                                    }
                                    if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                                    }
                                    if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                                    }
                                    if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                                    }
                                    if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                                    }
                                    if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                        SystemPromptValue = SystemPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                                        UserPromptValue = UserPromptValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                                        SystemPromptAdditionValue = SystemPromptAdditionValue.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                                        RetryPrompt = RetryPrompt.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                                    }
                                    maxTokenValue = ep.maxTokens;
                                    activeLLM = ep.model;
                                    apiKey = ep.apiKey;
                                    apiUrl = EndpointHelpers_1.fixApiUrl(ep.apiUrl, ep.doNotFixURL);
                                    llmTemp = ep.temperature;
                                    llmTopK = ep['top_k'];
                                    llmTopP = ep['top_p'];
                                    llmMinP = ep['min_p'];
                                    llmReqDelay = ep.requestDelay;
                                    llmRepeatPen = ep.repeat_penalty;
                                    llmRepetitionPen = ep.repetition_penalty;
                                    freqPen = ep.frequency_penalty;
                                    presPen = ep.presence_penalty;
                                    chatTempKwargs = ep.chat_template_kwargs;
                                    if (ep.disableStream == true) { llmStream = false; }
                                    llmName = this.optionModel.getValue() || 'Unspecified LLM';
                                    llmName = llmName.replaceAll(/^.*[\\\/]+/g, "");
                                    llmName = llmName.replaceAll(/:.*$/g, "");
                                    llmName = llmName.replaceAll(/[\?\"\<\>|]/g, "");
                                    if (llmName == "" && this.optionModel.getValue() != "") {
                                        console.error("[DSLR] Weird model name, trimming less.");
                                        llmName = this.optionModel.getValue().replaceAll(/[\?\"\<\>|\\\/]/g, "-");
                                        if (llmName == "" || llmName.match(/[^\-]/g) == null) {
                                            console.error("[DSLR] Unusable model name. using 'Unspecified LLM'.");
                                            llmName = "Unspecified LLM";
                                        }
                                    } else if (llmName == "" && this.optionModel.getValue() == "") {
                                        console.error("[DSLR] No model name found. Using 'Unspecified LLM'.");
                                        llmName = "Unspecified LLM";
                                    }
                                }
                                // Build system prompt with optional context
                                // KV-Cache Friendly Prompts: systemContent is still assembled as the
                                // full combined prompt (so the context token budget below is identical
                                // in both modes); when the toggle is on, the message construction
                                // splits it into the constant base prompt plus a separate user
                                // message carrying everything per-request.
                                var _cacheFriendlySL = this._cacheFriendlyPromptsActive();
                                let systemContent = SystemPromptValue + '\n' + SystemPromptAdditionValue;
                                // Build the previous-translations block as a string first. It is treated as fixed
                                // overhead for the context budget (it has its own Context History Length cap),
                                // so it is counted but never auto-trimmed by the unified fitter.
                                var _prevTransTrimAddition = "";
                                var _prevTransBlock = "";
                                if ((this.optionEnableContext.getValue() && lastSuccessfulTranslations.length > 0 && llmToUse == "model1") || (this.optionEnableContext2.getValue() && lastSuccessfulTranslations.length > 0 && llmToUse == "model2")) {
                                    // Build context pairs of original + translation
                                    let contextPairs = [];
                                    for (let i = 0; i < lastSuccessfulTranslations.length; i++) {
                                        if (lastOriginalTexts[i] && lastSuccessfulTranslations[i]) {
                                            // Strip placeholders and color codes for cleaner context.
                                            // Removed that stripping because the original text is also included now.
                                            let original = lastOriginalTexts[i];
/*                                                 .replace(/@\d+/g, '')
                                                .replace(/\\C\[\d+\]/g, ''); */
                                            let translation = lastSuccessfulTranslations[i];
/*                                                 .replace(/@\d+/g, '')
                                                .replace(/\\C\[\d+\]/g, ''); */
                                            contextPairs.push(`Original: ${original}\nTranslation: ${translation}`);
                                        }
                                    }

                                    if ((this.optionSystemPromptAdditionTrim.getValue() == true && llmToUse == "model1") || (this.optionSystemPromptAdditionTrim2.getValue() == true && llmToUse == "model2")) {
                                        // Add optional context trimmed lines by translated term for previous translations
                                        let SystemPromptAdditionValue2 = SystemPromptAdditionValue;
                                        const SystemPromptAdditionPastValue = trimLinesMatchTerms(SystemPromptAdditionValue2, lastSuccessfulTranslations, 1);
                                        _prevTransTrimAddition = deDuplicateLines(SystemPromptAdditionPastValue, SystemPromptAdditionValue);
                                    }

                                    let contpValue = this.optionContextPrompt.getValue();
                                    if (llmToUse == "model2") {
                                        contpValue = this.optionContextPrompt2.getValue();
                                    }

                                    _prevTransBlock = contpValue +
                                        "\n\n--- PREVIOUS TRANSLATIONS ---\n" +
                                        contextPairs.join("\n---\n") +
                                        "\n--- END CONTEXT ---\n";
                                }

                                // Unified context budget: summary / glossary / scene share the room left after the
                                // base prompt, previous-translations, the user message and the response reserve.
                                var _slFixedBase = systemContent + _prevTransTrimAddition + _prevTransBlock;
                                var _slUserText = UserPromptValue + (trimmedOriginalText || "");
                                var _fittedSL = this._buildAndFitDynamicContext(_slFixedBase, _slUserText, originalText || trimmedOriginalText, options, endpointNumber, llmToUse);
                                if (_fittedSL.glossary) systemContent += _fittedSL.glossary;
                                if (_prevTransTrimAddition) systemContent += _prevTransTrimAddition;
                                if (_prevTransBlock) systemContent += _prevTransBlock;
                                if (_fittedSL.scene) systemContent += _fittedSL.scene;

                                let messages;
                                if (_cacheFriendlySL) {
                                    // KV-Cache Friendly Prompts: the system message keeps only the constant
                                    // base prompt; everything after it (System Prompt Addition, glossary,
                                    // previous translations, scene context) is per-request context and rides
                                    // in its own user message instead, so the system message is
                                    // byte-identical for every request and prefix/KV-cache servers can
                                    // reuse it.
                                    var _slVariableContext = systemContent.slice(SystemPromptValue.length).replace(/^\r?\n+/, "");
                                    messages = [{
                                        role: "system",
                                        content: SystemPromptValue
                                    }];
                                    if (_slVariableContext.trim() !== "") {
                                        messages.push({
                                            role: "user",
                                            content: _slVariableContext
                                        });
                                    }
                                } else {
                                    messages = [{
                                        role: "system",
                                        content: systemContent
                                    }];
                                }

                                messages.push({
                                    role: "user",
                                    content: UserPromptValue + trimmedOriginalText
                                });
                                // Include all previous failed attempts as context when retrying
                                if (retryCount >= 1 && responseText) {
                                    // Include full error context in assistant message
                                    if (window.transConfig.japanesesource == true && window.transConfig.englishtarget == true) {
                                        messages.push({
                                            role: "assistant",
                                            content: `[Failed Attempt ${retryCount}]\n` +
                                                `Original Japanese: ${trimmedOriginalText}\n` +
                                                `Error: ${lastRejectReason}\n` +
                                                `Incorrect Translation: ${unchangedResponse}\n\n` +
                                                `Please carefully review the error and provide a corrected translation that:\n` +
                                                `1. Exactly matches the original's line count and formatting\n` +
                                                `2. Preserves all special codes and placeholders\n` +
                                                `3. Contains only the direct English translation\n` +
                                                `4. Avoids all previous mistakes listed above`
                                        });
                                    } else {
                                        messages.push({
                                            role: "assistant",
                                            content: `[Failed Attempt ${retryCount}]\n` +
                                                `Original Text: ${trimmedOriginalText}\n` +
                                                `Error: ${lastRejectReason}\n` +
                                                `Incorrect Translation: ${unchangedResponse}\n\n` +
                                                `Please carefully review the error and provide a corrected translation that:\n` +
                                                `1. Exactly matches the original's line count and formatting\n` +
                                                `2. Preserves all special codes and placeholders\n` +
                                                `3. Contains only the direct translation\n` +
                                                `4. Avoids all previous mistakes listed above`
                                        });
                                    }
                                    // Make retry prompt more specific
                                    messages.push({
                                        role: "user",
                                        content: `[Retry ${retryCount + 1}] ${RetryPrompt}\n\n` +
                                            `SPECIFIC INSTRUCTIONS FOR THIS RETRY:\n` +
                                            `${retryPromptAddition}\n\n` +
                                            `Translate this again while strictly following ALL rules:\n` +
                                            `${trimmedOriginalText}`
                                    });
                                }
                                var singleresult = "";
                                let response = "";
                                let body = "";
                                let rstatus = "";
                                var endpointIsOurs = false;
                                if (this._shouldProbeEndpointOwnership(apiUrl, llmToUse, endpointNumber)) {
                                    // Resolve endpoint ownership once for this request, before the body
                                    // is built: the reasoning decision is synchronous and needs the
                                    // answer as a value. Cached per URL, so only the first request pays
                                    // the probe.
                                    endpointIsOurs = await this._endpointIsOurs(apiUrl);
                                }
                                try {
                                    body = {
                                        model: activeLLM,
                                        messages: messages
                                    };

                                    if (llmTemp !== undefined && llmTemp !== null && llmTemp !== "") body.temperature = llmTemp;
                                    if (llmTopK !== undefined && llmTopK !== null && llmTopK !== "") body.top_k = llmTopK;
                                    if (llmTopP !== undefined && llmTopP !== null && llmTopP !== "") body.top_p = llmTopP;
                                    if (llmMinP !== undefined && llmMinP !== null && llmMinP !== "") body.min_p = llmMinP;
                                    if (llmRepeatPen !== undefined && llmRepeatPen !== null && llmRepeatPen !== "") body.repeat_penalty = llmRepeatPen;
                                    if (llmRepetitionPen !== undefined && llmRepetitionPen !== null && llmRepetitionPen !== "") body.repetition_penalty = llmRepetitionPen;
                                    if (maxTokenValue != undefined) body.max_tokens = maxTokenValue;
                                    if (freqPen !== undefined && freqPen !== null && freqPen !== "") body.frequency_penalty = freqPen;
                                    if (presPen !== undefined && presPen !== null && presPen !== "") body.presence_penalty = presPen;
                                    this._setChatTemplateKwargs(body, chatTempKwargs);
                                    if (llmStream != undefined && llmStream != "" && llmStream != null) body.stream = llmStream;
                                    const customParams = getCustomParams(retryCount, llmToUse, ep.customParameters, this.optionCustomParameters2.getValue());
                                    for (const [key, value] of Object.entries(customParams)) {
                                        if (value !== null && value !== undefined && value !== '') {
                                            body[key] = value;
                                        }
                                    }
                                    this._applyReasoningParams(body, llmToUse, activeLLM, endpointNumber, apiUrl, endpointIsOurs);
                                    this._applyQwenNoThink(messages, this._reasoningFormatFor(llmToUse, endpointNumber), activeLLM);
                                    let isResponsesApi = ResponsesApiHelpers_1.isResponsesApiUrl(apiUrl);
                                    let useTokenProgress = this.optionEnableTokenProgress && this.optionEnableTokenProgress.getValue() === true && body.stream !== false;
                                    // Individual-line responses are no structured entries, so only the
                                    // character and word/sentence tiers apply here (a single line can
                                    // legitimately contain repeated text; the entries tier is for batch
                                    // sections, JSON entries and glossary terms).
                                    let singleRepetitionTiers = _repetitionLoopTiers(this);
                                    let repetitionConfig = singleRepetitionTiers.charLimit > 0 || singleRepetitionTiers.wordLimit > 0
                                        ? { charLimit: singleRepetitionTiers.charLimit, wordLimit: singleRepetitionTiers.wordLimit, entryLimit: 0 }
                                        : 0;
                                    if (useTokenProgress) {
                                        body.stream = true;
                                        body.stream_options = { include_usage: true };
                                    }
                                    if (isResponsesApi) {
                                        body = ResponsesApiHelpers_1.toResponsesBody(body);
                                    }
                                    //console.log("Request Body:\n" + JSON.stringify(body));
                                    logCollapsed("Request Body:", body);
                                    console.log("[DSLR] Request -> endpoint " + endpointNumber + " (" + apiUrl + ")" + (llmToUse == "model2" ? " [FALLBACK]" : ""));
                                    response = await fetch(apiUrl, {
                                        method: 'POST',
                                    headers: Object.assign({
                                        'Content-Type': 'application/json'
                                    },
                                    apiKey ? {
                                        'Authorization': `Bearer ${apiKey}`
                                    } : {},
                                    getCustomHeaders(retryCount, llmToUse, ep.customHeaders, this.optionCustomHeaders2.getValue())
                                    ),
                                        body: JSON.stringify(body),
                                        signal: this._requestSignal()
                                    });
                                    if (response.status == undefined) {
                                        response.status = "Response did not Include a status code.";
                                    }
                                    if (response.statusText == undefined) {
                                        response.statusText = "";
                                    }
                                    errorBody = JSON.stringify(body);
                                    console.log("Response Status:\n" + response.status);
                                    if (JSON.stringify(Object.fromEntries(response.headers.entries())) != undefined) {
                                        //console.log("Response Headers:\n" + JSON.stringify(Object.fromEntries(response.headers.entries())));
                                        console.groupCollapsed("Response Headers:");
                                        console.log(JSON.stringify(Object.fromEntries(response.headers.entries())));
                                        console.groupEnd();
                                    } else {
                                        console.log("Response Headers:\n" + "Respone had no headers.");
                                    }
                                    if (useTokenProgress && _responseBodyIsStreamable(response)) {
                                        showTokenProgress('endpoint ' + endpointNumber + ' · individual retry' + (llmToUse == "model2" ? ' · fallback' : ''));
                                        singleresult = isResponsesApi ? await ResponsesApiHelpers_1.streamResponsesCompletion(response, updateTokenProgress, repetitionConfig) : await _streamChatCompletion(response, updateTokenProgress, repetitionConfig);
                                        hideTokenProgress();
                                    } else if (isResponsesApi) {
                                        singleresult = ResponsesApiHelpers_1.parseResponsesText(await response.text());
                                    } else {
                                        singleresult = await response.json();
                                    }
                                    // Log and track token usage (accumulates across both batch and individual processing)
                                    if (singleresult.usage) {
                                        totalPromptTokens += singleresult.usage.prompt_tokens;
                                        totalCompletionTokens += singleresult.usage.completion_tokens;
                                        totalTokens += singleresult.usage.total_tokens;
                                        console.log(`[DSLR] Current token totals - Prompt: ${totalPromptTokens}, Completion: ${totalCompletionTokens}, Total: ${totalTokens}`);
                                    }
                                    // The individual-line path has no dedicated "length" retry handling, so a
                                    // repetition-loop termination (finish reason "length" + repetition_loop flag)
                                    // would otherwise pass silently. State clearly what happened; the partial
                                    // response then goes through the normal validation, which retries it with
                                    // an increased repetition penalty if the truncated line fails the checks.
                                    if (singleresult.repetition_loop == true) {
                                        const singleLoopReason = singleresult.repetition_loop_reason || `the same text was repeated back to back too many times`;
                                        this.error(`[DSLR] The model was stuck repeating itself while translating a single line. A repetition loop was detected in the streamed response (${singleLoopReason}), so the response was terminated early. The truncated response will be validated and retried with an increased repetition penalty if it does not pass.`);
                                        console.error(`[DSLR] Repetition loop detected in an individual-line response; it was terminated early (${singleLoopReason}).`);
                                        // Show what was generated before the kill. This path has
                                        // no dedicated retry handler, so the partial text is the
                                        // only record of what the model was looping on.
                                        errorCollapsed("Content generated before the repetition kill:",
                                            ResponsesApiHelpers_1.chatContentOf(singleresult));
                                    }
                                    if (response.ok) this._resetEndpointStreak(endpointNumber);
                                    if (!response.ok) {
                                        lastRejectReason = llmName + "'s response failed ok test. Response Error Status: " + response.status + ` ` + response.statusText;
                                        console.error(`[DSLR] ${llmName}'s response failed ok test. Response Error Status: ` + response.status + ` ` + response.statusText);
                                        errorCollapsed("Request:", body);
                                        updateServerIssueCount(1);
                                        serverRetryCount++;
                                        rstatus = response.status.toString();
                                        if (llmToUse == "model1" && maxRetries > 0 && rotationCount < MAX_429_ROTATIONS &&
                                            (this._isUnrecoverableStatus(rstatus) || (rstatus.match(/429/g) != null && this._hasMultipleEndpoints()))) {
                                            rotationCount++;
                                            if (this._isUnrecoverableStatus(rstatus)) this._disableEndpoint(endpointNumber);
                                            else this._markEndpoint429(endpointNumber);
                                            this._decEndpointInFlight(endpointNumber);
                                            options._epSlot = 0;
                                            this.pendingRotations = (this.pendingRotations || 0) + 1;
                                            let _next = this._nextAvailableEndpoint();
                                            while (_next === null && rotationCount < MAX_429_ROTATIONS) {
                                                const _cdWait = this._cooldownWaitMs();
                                                const _waitMs = _cdWait > 0 ? Math.min(_cdWait, 60000) : ROTATION_POLL_MS;
                                                this.error(`[DSLR] No endpoint with spare capacity — waiting ${Math.round(_waitMs / 1000)}s before retrying.`);
                                                await new Promise(resolve => setTimeout(resolve, _waitMs));
                                                rotationCount++;
                                                _next = this._nextAvailableEndpoint();
                                            }
                                            this.pendingRotations = Math.max(0, (this.pendingRotations || 0) - 1);
                                            if (_next !== null) {
                                                this._incEndpointInFlight(_next);
                                                options._epSlot = _next;
                                                endpointNumber = _next;
                                                ep = this.getEndpointSettings(endpointNumber);
                                                _resolveFromEp();
                                                thereWasServerError = true;
                                                await new Promise(resolve => setTimeout(resolve, Math.max(llmReqDelay, _rotDelayMs)));
                                                continue;
                                            } else if (this.optionEnableFallback && this.optionEnableFallback.getValue() == true) {
                                                llmToUse = "model2";
                                                _resolveFromFallback();
                                                thereWasServerError = true;
                                                this.error('[DSLR] No primary endpoint available — switching to the fallback model.');
                                                await new Promise(resolve => setTimeout(resolve, Math.max(llmReqDelay, _rotDelayMs)));
                                                continue;
                                            } else {
                                                this._incEndpointInFlight(endpointNumber);
                                                options._epSlot = endpointNumber;
                                            }
                                        }
                                        if (serverRetryCount <= MaxserverRetries429 && rstatus.match(/429/g) != null) {
                                            if (maxRetries > 0) {
                                                this.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying. Reason: `, lastRejectReason);
                                                console.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying. Reason: `, lastRejectReason);
                                                recordRateLimitRetry();
                                                await new Promise(resolve => setTimeout(resolve, Retries429Delay));
                                                continue;
                                            } else {
                                                this.error(`[DSLR] Server issue prevented response, but retries are disabled. Reason: `, lastRejectReason);
                                                console.error(`[DSLR] Server issue prevented response, but retries are disabled. Reason: `, lastRejectReason);
                                                break BatchProcessing;
                                                break;
                                            }
                                        } else if (serverRetryCount <= MaxserverRetries400 && rstatus.match(/400/g) != null) {
                                            if (maxRetries > 0) {
                                                this.error(`[DSLR] Server/LLM Issue, waiting ${Retries400Delay / 1000} seconds, then retrying. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                                console.error(`[DSLR] Server/LLM Issue, waiting ${Retries400Delay / 1000} seconds, then retrying.`);
                                                errorCollapsed("Request Body:", body);
                                                await new Promise(resolve => setTimeout(resolve, Retries400Delay));
                                                continue;
                                            } else {
                                                this.error(`[DSLR] Server issue prevented response, but retries are disabled. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                                console.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                                errorCollapsed("Request Body:", body);
                                                batchwassuccessfull = "false";
                                                break;
                                            }
                                        } else if (serverRetryCount <= MaxserverRetries && rstatus.match(/429/g) == null && rstatus.match(/400/g) == null) {
                                            if (maxRetries > 0) {
                                                this.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying. Reason: `, lastRejectReason);
                                                console.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying. Reason: `, lastRejectReason);
                                                await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                                continue;
                                            } else {
                                                this.error(`[DSLR] Server issue prevented response, but retries are disabled. Reason: `, lastRejectReason);
                                                console.error(`[DSLR] Server issue prevented response, but retries are disabled. Reason: `, lastRejectReason);
                                                break BatchProcessing;
                                                break;
                                            }
                                        } else if (rstatus.match(/400/g) != null) {
                                            this.error(`[DSLR] Failed to get a usable Full Batch due to a 400 Error Status. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                            console.error(`[DSLR] Failed to get a usable Full Batch due to a 400 Error Status. The '400 Bad Request' error can be misleading.\n[DSLR] Unless you've for example sent repeat_penalty to a provider other than LM Studio, then the request was most likely perfectly fine, but the LLM/endpoint crashed.`);
                                            errorCollapsed("Request:", body);
                                            batchwassuccessfull = "false";
                                            break;
                                        } else {
                                            this.error(`[DSLR] Failed to get a usable translation.\nLast reason:\n` + lastRejectReason + `\n\nRequest:\n\n` + JSON.stringify(body));
                                            console.error(`[DSLR] Failed to get a usable translation.\nLast reason:\n` + lastRejectReason);
                                            errorCollapsed("Request Body:", body);
                                            break BatchProcessing;
                                            break;
                                        }
                                    }
                                    //console.log("Server Response (normalized):\n" + JSON.stringify(singleresult, null, 2));
                                    logCollapsed("Server Response (normalized):", singleresult);
                                    if (singleresult == "" || singleresult == undefined) {
                                        if (serverRetryCount <= MaxserverRetries) {
                                            lastRejectReason = llmName + "'s response undefined or empty. Response Error Status: " + response.status + ` ` + response.statusText;
                                            console.error(`[DSLR] ${llmName}'s response undefined or empty. Response Error Status: ` + response.status + ` ` + response.statusText);
                                            errorCollapsed("Request:", body);
                                            updateServerIssueCount(1);
                                            serverRetryCount++;
                                            if (maxRetries > 0) {
                                                this.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying. Reason: `, lastRejectReason);
                                                console.error(`[DSLR] Server Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying. Reason: `, lastRejectReason);
                                                await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                                continue;
                                            } else {
                                                this.error(`[DSLR] Server issue prevented response, but retries are disabled. Reason: `, lastRejectReason);
                                                console.error(`[DSLR] Server issue prevented response, but retries are disabled. Reason: `, lastRejectReason);
                                                break BatchProcessing;
                                                break;
                                            }
                                        } else {
                                            updateServerIssueCount(1);
                                            this.error(`[DSLR] Failed to get a usable translation.\n\nRequest:\n\n` + JSON.stringify(body));
                                            console.error(`[DSLR] Failed to get a usable translation.`);
                                            errorCollapsed("Request Body:", body);
                                            break BatchProcessing;
                                            break;
                                        }
                                    }
                                } catch (error) {
                                    hideTokenProgress();
                                    if (this.aborted) continue; // user abort: skip retry delay, the loop condition exits
                                    // A failed request (a connection error in particular) may mean the
                                    // server behind a shared loopback port has been swapped out; drop
                                    // the cached ownership answer so the retry (or the next request)
                                    // probes again instead of trusting a stale "ours".
                                    this._invalidateEndpointOwnership(apiUrl);
                                    updateServerIssueCount(1);
                                    serverRetryCount++;
                                    if (serverRetryCount <= MaxserverRetriesFTF) {
                                        if (error.message != undefined && error.message != [] && error.message != "" && error.message != {}) {
                                            this.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error.message}`);
                                            console.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error.message}`);
                                        } else if (error != undefined && error != [] && error != "" && error != {}) {
                                            this.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error}`);
                                            console.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying. Error: ${error}`);
                                        } else {
                                            this.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying.`);
                                            console.error(`[DSLR] Serious connection error, waiting ${serverRetriesdelay / 1000} seconds then retrying.`);
                                        }
                                        await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                        continue;
                                    } else {
                                        if (error.message != undefined && error.message != [] && error.message != "" && error.message != {}) {
                                            this.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error.message}`);
                                            console.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error.message}`);
                                        } else if (error != undefined && error != [] && error != "" && error != {}) {
                                            this.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error}`);
                                            console.error(`[DSLR] Failed to connect to API after multiple attempts. Error: ${error}`);
                                        } else {
                                            this.error(`[DSLR] Failed to connect to API after multiple attempts.`);
                                            console.error(`[DSLR] Failed to connect to API after multiple attempts.`);
                                        }
                                        batchwassuccessfull = "false";
                                        abortTranslation = "true";
                                        break;
                                    }
                                }
                                if (singleresult.choices[0]?.message?.content == undefined || singleresult.choices[0]?.message?.content == "") {
                                    if (singleresult.content && Array.isArray(singleresult.content)) {
                                        responseText = singleresult.content
                                            .filter(block => block && block.type === 'text')
                                            .map(block => block.text || '')
                                            .join('');
                                    } else if (singleresult.choices[0]?.finish_reason == "content_filter") {
                                        updateServerIssueCount(1);
                                        this.error(`[DSLR] content_filter finish reason. The enpoint likely just charged you for completion tokens it refused to send you. Aborting the translation to prevent it from scamming you further.` + `\n\n` + "Server Response (normalized):\n" + JSON.stringify(batchresult, null, 2));
                                        console.error(`[DSLR] content_filter finish reason. The enpoint likely just charged you for completion tokens it refused to send you. Aborting the translation to prevent it from scamming you further.`);
                                        errorCollapsed("Original Text:", body);
                                        errorCollapsed("Server Response (normalized):", singleresult);
                                        break;
                                    } else {
                                        if (serverRetryCount <= MaxserverRetries) {
                                            this.error(`[DSLR] Response in wrong format. Response Error Status: ` + response.status + ` ` + response.statusText);
                                            console.error(`[DSLR] Response in wrong format. Response Error Status: ` + response.status + ` ` + response.statusText);
                                            errorCollapsed("Original Text:", body);
                                            errorCollapsed("Server Response (normalized):", singleresult);
                                            updateServerIssueCount(1);
                                            serverRetryCount++;
                                            if (serverRetryCount <= MaxserverRetries429 && rstatus.match(/429|524/g) != null) {
                                                if (maxRetries > 0) {
                                                    this.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying.`);
                                                    console.error(`[DSLR] Server Overload Issue, waiting ${Retries429Delay / 1000} seconds, then retrying.`);
                                                    recordRateLimitRetry();
                                                    await new Promise(resolve => setTimeout(resolve, Retries429Delay));
                                                    continue;
                                                } else {
                                                    this.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                                    console.error(`[DSLR] Server issue prevented response, but retries are disabled.`);
                                                    batchwassuccessfull = "false";
                                                    break;
                                                }
                                            } else if (maxRetries > 0) {
                                                this.error(`[DSLR] Waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                                console.error(`[DSLR] Waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                                await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                                continue;
                                            } else {
                                                this.error(`[DSLR] Response issue prevented response, but retries are disabled.`);
                                                console.error(`[DSLR] Response issue prevented response, but retries are disabled.`);
                                                break;
                                            }
                                        } else {
                                            updateServerIssueCount(1);
                                            this.error(`[DSLR] Failed to get a usable translation.\n\nRequest:\n\n` + JSON.stringify(body));
                                            console.error(`[DSLR] Failed to get a usable translation.`);
                                            errorCollapsed("Request Body:", body);
                                            break BatchProcessing;
                                            break;
                                        }
                                    }
                                } else {
                                    responseText = singleresult.choices[0]?.message?.content;
                                }
                                if (responseText == "" || responseText == undefined) {
                                    if (serverRetryCount <= MaxserverRetries) {
                                        this.error(`[DSLR] Response did not include usable content. Response Error Status: ` + response.status + ` ` + response.statusText);
                                        console.error(`[DSLR] Response did not include usable content. Response Error Status: ` + response.status + ` ` + response.statusText);
                                        errorCollapsed("Original Text:", body);
                                        updateServerIssueCount(1);
                                        serverRetryCount++;
                                        if (maxRetries > 0) {
                                            this.error(`[DSLR] LLM response Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                            console.error(`[DSLR] LLM response Issue, waiting ${serverRetriesdelay / 1000} seconds, then retrying.`);
                                            await new Promise(resolve => setTimeout(resolve, serverRetriesdelay));
                                            continue;
                                        } else {
                                            this.error(`[DSLR] LLM response issue, but retries are disabled.`);
                                            console.error(`[DSLR] LLM response issue, but retries are disabled.`);
                                            break;
                                        }
                                    } else {
                                        updateBatchFailCount(1);
                                        this.error('[DSLR] Failed to get a usable translation.\nLast reason:\n' + llmName + 'response was not readable, but retries are disabled. \n\nRequest:\n' + errorBody);
                                        console.error('[DSLR] Failed to get a usable translation.\nLast reason:\n' + llmName + 'response was not readable, but retries are disabled.');
                                        errorCollapsed("Request Body:", errorBody);
                                        break BatchProcessing;
                                        break;
                                    }
                                }
                                //Get rid of reasoning text
                                if (this._qwenNoThinkActive(llmToUse, endpointNumber) && responseText.match(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi) != null) {
                                    responseText = responseText.replaceAll(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi, "");
                                    console.log("[DSLR] Stripped a stray <think> block from a Qwen response (/no_think was sent).");
                                }
                                if (this._isReasoningActive(llmToUse, endpointNumber)) {
                                    if (responseText.match(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?<reasoning>[\s\S]*?<(?:\/|\\)reasoning>\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?<reasoning>[\s\S]*?<(?:\/|\\)reasoning>\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?<thinking>[\s\S]*?<(?:\/|\\)thinking>\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?<thinking>[\s\S]*?<(?:\/|\\)thinking>\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?<thought>[\s\S]*?<(?:\/|\\)thought>\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?<thought>[\s\S]*?<(?:\/|\\)thought>\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?<reason>[\s\S]*?<(?:\/|\\)reason>\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?<reason>[\s\S]*?<(?:\/|\\)reason>\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?<deepthink>[\s\S]*?<(?:\/|\\)deepthink>\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?<deepthink>[\s\S]*?<(?:\/|\\)deepthink>\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?:think:[\s\S]*?:think:\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?:reasoning:[\s\S]*?:reasoning:\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?:reasoning:[\s\S]*?:reasoning:\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?:thinking:[\s\S]*?:thinking:\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?:thinking:[\s\S]*?:thinking:\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?:thought:[\s\S]*?:thought:\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?:thought:[\s\S]*?:thought:\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?:reason:[\s\S]*?:reason:\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?:reason:[\s\S]*?:reason:\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?:think:[\s\S]*?:think:\s*/gi, "");
                                    } else if (responseText.match(/^[\s\S]*?:deepthink:[\s\S]*?:deepthink:\s*/gi) != null) {
                                        responseText = responseText.replaceAll(/^[\s\S]*?:deepthink:[\s\S]*?:deepthink:\s*/gi, "");
                                    } else {
                                        this.log(`[DSLR] Reasoning enabled, but no known think block detected. Using broad universal pattern to try to clean it anyway.`);
                                        console.log(`[DSLR] Reasoning enabled, but no known think block detected. Using broad universal pattern to try to clean it anyway.\n\n\nResponse before cleaning =\n${unchangedResponse}`);
                                        if (responseText.match(/^[\s\S]*?<.*?>[\s\S]*?<(?:\/|\\).*>\s*/gi) != null) {
                                            responseText = responseText.replaceAll(/^[\s\S]*?<.*?>[\s\S]*?<(?:\/|\\).*?>\s*/gi, "");
                                            this.log(`[DSLR] Detected and deleted "something" with the <> <\/> or <> <\\> pattern, because no other reasoning block was found.`);
                                            console.log(`[DSLR] Detected and deleted "something" with the <> <\/> or <> <\\> pattern.`);
                                        } else if (responseText.match(/^[\s\S]*?:.*?:[\s\S]*?:.*?:\s*/gi) != null) {
                                            responseText = responseText.replaceAll(/^[\s\S]*?:.*?:[\s\S]*?:.*?:\s*/gi, "");
                                            this.log(`[DSLR] Detected and deleted "something" with the :: :: pattern, because no other reasoning block was found.`);
                                            console.log(`[DSLR] Detected and deleted "something" with the :: :: pattern.`);
                                        } else {
                                            console.error(`[DSLR] Unable to detect anything.`);
                                        }
                                    }
                                }
                            }
                            if (errorBody == "") {
                                errorBody = trimmedOriginalText;
                            }
                            if (responseText == undefined || responseText == null || responseText == "") {
                                if (retryCount < maxRetries) {
                                    updateBatchFailCount(1);
                                    retryCount++;
                                    if (maxRetries > 0) {
                                        this.error('[DSLR] ' + llmName + 's response was not readable.');
                                        console.error('[DSLR] ' + llmName + 's response was not readable.');
                                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                                        continue;
                                    } else {
                                        this.error('[DSLR] ' + llmName + 's response was not readable, but retries are disabled.');
                                        console.error('[DSLR] ' + llmName + 's response was not readable, but retries are disabled.');
                                        break BatchProcessing;
                                        break;
                                    }
                                } else {
                                    updateBatchFailCount(1);
                                    this.error('[DSLR] Failed to get a usable translation.\nLast reason:\n' + llmName + 'response was not readable, but retries are disabled. \n\nRequest:\n' + errorBody);
                                    console.error('[DSLR] Failed to get a usable translation.\nLast reason:\n' + llmName + 'response was not readable, but retries are disabled.');
                                    errorCollapsed("Request Body:", errorBody);
                                    break BatchProcessing;
                                    break;
                                }
                            }
                            unchangedResponse = responseText;
                            if (responseText == trimmedOriginalText && trimmedOriginalText.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null && window.transConfig.japanesesource == true && RefusalRetryCount <= MaxRefusalRetries) {
                                updateBatchFailCount(1);
                                RefusalRetryCount++;
                                if (maxRetries > 0) {
                                    this.error(`[DSLR] Server/LLM just sent back the input, retrying.`);
                                    console.error(`[DSLR] Server/LLM just sent back the input, retrying.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                                    continue;
                                } else {
                                    this.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled. ${llmName}'s response = ${unchangedResponse}`);
                                    console.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    break BatchProcessing;
                                    break;
                                }
                            } else if (responseText == trimmedOriginalText && trimmedOriginalText.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null && window.transConfig.japanesesource == true) {
                                updateBatchFailCount(1);
                                RefusalRetryCount = 0;
                                retryCount++;
                                if (maxRetries > 0 && retryCount <= maxRetries) {
                                    this.error(`[DSLR] Server/LLM just sent back the input, retrying the current request one last time.`);
                                    console.error(`[DSLR] Server/LLM just sent back the input, retrying the current request one last time.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                                    continue;
                                } else if (maxRetries > 0) {
                                    this.error(`[DSLR] Failed to get a usable translation.\n\nRequest:\n\n` + errorBody);
                                    console.error(`[DSLR] Failed to get a usable translation.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    break BatchProcessing;
                                    break;
                                } else {
                                    this.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled. ${llmName}'s response = ${unchangedResponse}`);
                                    console.error(`[DSLR] Server/LLM just sent back the input, but retries are disabled.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    break BatchProcessing;
                                    break;
                                }
                            }
                            if (responseText.match(/(^\s*抱歉，我无法协助完成您的请求。\s*$)|(^\s*对不起，我无法协助完成您的请求。\s*$)|(^\s*抱歉，我无法协助翻译这些内容。\s*$)|(^\s*(?:I'm sorry, but |I am sorry, but |Sorry, but |Sorry, )?(?:I|I'm|I am) (?:can't|cannot|unable to) assist with (?:this|that) request.\s*$)/gi) != null && RefusalRetryCount <= MaxRefusalRetries) {
                                updateBatchFailCount(1);
                                RefusalRetryCount++;
                                if (maxRetries > 0) {
                                    this.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                    console.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                                    continue;
                                } else {
                                    this.error(`[DSLR] LLM refused to generate a response, but retries are disabled. ${llmName}'s response = ${unchangedResponse}`);
                                    console.error(`[DSLR] LLM refused to generate a response, but retries are disabled.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    break BatchProcessing;
                                    break;
                                }
                            } else if (responseText.match(/(^\s*抱歉，我无法协助完成您的请求。\s*$)|(^\s*对不起，我无法协助完成您的请求。\s*$)|(^\s*抱歉，我无法协助翻译这些内容。\s*$)|(^\s*(?:I'm sorry, but |I am sorry, but |Sorry, but |Sorry, )?(?:I|I'm|I am) (?:can't|cannot|unable to) assist with (?:this|that) request.\s*$)/gi) != null) {
                                updateBatchFailCount(1);
                                RefusalRetryCount = 0;
                                retryCount++;
                                if (maxRetries > 0 && retryCount <= maxRetries) {
                                    this.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                    console.error(`[DSLR] LLM refused to generate a response, retrying.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                                    continue;
                                } else if (maxRetries > 0) {
                                    this.error(`[DSLR] Failed to get a usable translation.\n\nRequest:\n\n` + errorBody);
                                    console.error(`[DSLR] Failed to get a usable translation.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    break BatchProcessing;
                                    break;
                                } else {
                                    this.error(`[DSLR] LLM refused to generate a response, but retries are disabled. ${llmName}'s response = ${unchangedResponse}`);
                                    console.error(`[DSLR] LLM refused to generate a response, but retries are disabled.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    break BatchProcessing;
                                    break;
                                }
                            }
                            if (trimmedOriginalText == undefined || trimmedOriginalText == null || trimmedOriginalText == "") {
                                updateBatchFailCount(1);
                                this.error('[DSLR] Corrupted Request. Something went very wrong.');
                                console.error('[DSLR] Corrupted Request. Something went very wrong.');
                                break BatchProcessing;
                                break;
                            }
                            //Remove empty lines if there are none in the original
                            if (trimmedOriginalText.match(/\n[\r 　]*\n/g) == null) {
                                responseText = responseText.replaceAll(/\n[\r 　]*\n/g, "");
                            }
                            //replace \n with linebreaks if the used LLM added those for some reason
                            if (trimmedOriginalText.match(/\\+n(?!\[)/gi) == null) {
                                responseText = responseText.replaceAll(/\\+n(?!\[)/gi, "\n");
                            }
                            //Remove escaped quotes if there were none in the original
                            if (trimmedOriginalText.match(/\\"/g) == null) {
                                responseText = responseText.replaceAll(/\\"/g, '"');
                            }
                            if (trimmedOriginalText.match(/\\'/g) == null) {
                                responseText = responseText.replaceAll(/\\'/g, "'");
                            }
                            retryPromptAddition = "";
                            let originallinebreaktrim = trimmedOriginalText.replaceAll(/^[\n\r]+/g, "");
                            originallinebreaktrim = originallinebreaktrim.replaceAll(/[\n\r]+$/g, "");
                            let responselinebreaktrim = responseText.replaceAll(/^[\n\r]+/g, "");
                            responselinebreaktrim = responselinebreaktrim.replaceAll(/[\n\r]+$/g, "");
                            if (responseText.match(/\\[\[\{\(\]\}\)]/gi) != null && trimmedOriginalText.match(/\\[\[\{\(\]\}\)]/gi) == null) {
                                responseText = responseText.replaceAll(/\\([\[\{\(\]\}\)])/g, "$1");
                            }
                            responseText = responseText.replaceAll(/[\s+　]+$/g, "");
                            let allreadyfked = false;
                            if (responseText == undefined && rejectValue == true) {
                                allreadyfked = true;
                                console.error('[DSLR] ' + llmName + 'response was unreadable');
                                errorCollapsed("Request Body:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                lastRejectReason = llmName + "'s response was unreadable.";
                            } else if (responseText == "" && rejectValue == true) {
                                allreadyfked = true;
                                console.error('[DSLR] ' + llmName + '\'s response was empty.');
                                errorCollapsed("Request Body:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                lastRejectReason = llmName + "'s response was empty.";
                            } else if (rejectValue == true) {
                                let responseOrigPlaceholder = responseText;
                                if (llmToUse == "model1" && retryCount <= 10) {
                                    if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(nameCommandRestore, "\\n[$1]");
                                    }
                                    if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(characterCommandRestore, "\\nw[$1]");
                                    }
                                    if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(imageCommandRestore, "\\i[$1]");
                                    }
                                    if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(variableCommandRestore, "\\v[$1]");
                                    }
                                    if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(colorCommandRestore, "\\C[$1]");
                                    }
                                    if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(placeholderRestore, "@$1");
                                    }
                                } else if (llmToUse == "model2" || retryCount > 10) {
                                    if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(nameCommandRestore2, "\\n[$1]");
                                    }
                                    if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(characterCommandRestore2, "\\nw[$1]");
                                    }
                                    if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(imageCommandRestore2, "\\i[$1]");
                                    }
                                    if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(variableCommandRestore2, "\\v[$1]");
                                    }
                                    if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(colorCommandRestore2, "\\C[$1]");
                                    }
                                    if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                        responseOrigPlaceholder = responseOrigPlaceholder.replaceAll(placeholderRestore2, "@$1");
                                    }
                                }
                                const placeholderResult = comparePlaceholders(originalPlacolderText, responseOrigPlaceholder);
                                const colorCommandResult = compareColorCommands(originalPlacolderText, responseOrigPlaceholder);
                                const variableCommandResult = compareVariableCommands(originalPlacolderText, responseOrigPlaceholder);
                                const nameCommandResult = compareNameCommandsWithGender(originalPlacolderText, responseOrigPlaceholder);
                                const nameCommandResultW = compareNameCommandsW(originalPlacolderText, responseOrigPlaceholder);
                                const itemCommandResult = compareItemCommands(originalPlacolderText, responseOrigPlaceholder);
                                if (responseText.match(/\\/gi) != null && trimmedOriginalText.match(/\\/gi) == null && responseText.match(/\\[cinv][w]?\[\d+\]/gi) == null && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response added \\ that were not present in the original.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response added \\ that were not present in the original.";
                                    retryPromptAddition = "\nDO NOT use backslashes that were not in the original text.";
                                } else if (responseText.match(/japanese.*translat.*/gi) != null && responseText.match(/translat.*Japanese.*/gi) != null && trimmedOriginalText.match(/(?:日本語|日本人|邦人|倭人|日本側|日本の).*翻訳/g) == null && trimmedOriginalText.match(/翻訳.*(?:日本語|日本人|邦人|倭人|日本側|日本の)/g) == null && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response added "I will translate Japanese:" type message.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response added 'I will translate Japanese for you:' type message.";
                                    retryPromptAddition = "\nDO NOT add any introductory phrases like 'I will translate this' or similar. Only provide the direct translation.";
                                } else if (!placeholderResult.isMatch) {
                                    console.error(`Placeholder comparison did not find a match. Original text with original placeholders "${originalPlacolderText}" Response text with original placeholders "${responseOrigPlaceholder}".`);
                                    allreadyfked = true;
                                    const {
                                        missingInSecondString,
                                        extraInSecondString
                                    } = placeholderResult.differences;
                                    let missin = missingInSecondString.join(', ');
                                    let extraa = extraInSecondString.join(', ');
                                    if (this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "" && llmToUse == "model1" && retryCount <= 10) {
                                        missin = missin.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                                        extraa = extraa.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer.getValue());
                                    } else if (this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                        missin = missin.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                                        extraa = extraa.replaceAll(/@(\d+)/gi, this.optionPlaceholderReplacer2.getValue());
                                    }
                                    if (extraInSecondString.length > 0 && missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these problems: Additional placeholders: ' + extraa + " Missing placeholders: " + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these problems: Additional placeholders: " + extraa + " Missing placeholders: " + missin;
                                        retryPromptAddition = "\nPLACEHOLDER ERROR: You must preserve all @ placeholders exactly. Your response had these issues:\n- Added placeholders: " + extraa + "\n- Missing placeholders: " + missin + "\nInclude all original placeholders and don't add any new ones.";
                                    } else if (extraInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these additional placeholders: ' + extraa);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these additional placeholders: " + extraa;
                                        retryPromptAddition = "\nPLACEHOLDER ERROR: You added these extra placeholders that weren't in the original: " + extraa + "\nOnly include placeholders that were present in the original source text.";
                                    } else if (missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response was missing these placeholders: ' + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response was missing these placeholders: " + missin;
                                        retryPromptAddition = "\nPLACEHOLDER ERROR: You missed these required placeholders: " + missin + "\nYou must include all placeholders from the original text exactly as they appear.";
                                    }
                                } else if (!colorCommandResult.isMatch) {
                                    allreadyfked = true;
                                    const {
                                        missingInSecondString,
                                        extraInSecondString
                                    } = colorCommandResult.differences;
                                    let missin = missingInSecondString.join(', ');
                                    let extraa = extraInSecondString.join(', ');
                                    if (originalPlacolderText.match(/\\C\[\d+\]/g) != null) {
                                        missin = missin.replaceAll(/c/g, "C");
                                    }
                                    if (responseOrigPlaceholder.match(/\\C\[\d+\]/g) != null) {
                                        extraa = extraa.replaceAll(/c/g, "C");
                                    }
                                    if (this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "" && llmToUse == "model1" && retryCount <= 10) {
                                        missin = missin.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                                        extraa = extraa.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer.getValue());
                                    } else if (this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                        missin = missin.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                                        extraa = extraa.replaceAll(/\\c\[(\d+)\]/gi, this.optionColorCommandReplacer2.getValue());
                                    }
                                    if (extraInSecondString.length > 0 && missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these problems: Additional color codes: ' + extraa + " Missing color codes: " + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these problems: Additional color codes: " + extraa + " Missing color codes: " + missin;
                                        retryPromptAddition = "\nCOLOR CODE ERROR: You must preserve all color codes exactly. Your response had these issues:\n- Added color codes: " + extraa + "\n- Missing color codes: " + missin + "\nInclude all original color codes and don't add any new ones.";
                                    } else if (extraInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these additional color codes: ' + extraa);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these additional color codes: " + extraa;
                                        retryPromptAddition = "\nCOLOR CODE ERROR: You added these extra color codes that weren't in the original: " + extraa + "\nOnly include color codes that were present in the original source text.";
                                    } else if (missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response was missing these color codes: ' + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response was missing these color codes: " + missin;
                                        retryPromptAddition = "\nCOLOR CODE ERROR: You missed these required color codes: " + missin + "\nYou must include all color codes from the original text exactly as they appear.";
                                    }
                                } else if (!variableCommandResult.isMatch) {
                                    allreadyfked = true;
                                    const {
                                        missingInSecondString,
                                        extraInSecondString
                                    } = variableCommandResult.differences;
                                    let missin = missingInSecondString.join(', ');
                                    let extraa = extraInSecondString.join(', ');
                                    if (originalPlacolderText.match(/\\V\[\d+\]/g) != null) {
                                        missin = missin.replaceAll(/v/g, "V");
                                    }
                                    if (responseOrigPlaceholder.match(/\\V\[\d+\]/g) != null) {
                                        extraa = extraa.replaceAll(/v/g, "V");
                                    }
                                    if (this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "" && llmToUse == "model1" && retryCount <= 10) {
                                        missin = missin.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                                        extraa = extraa.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer.getValue());
                                    } else if (this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                        missin = missin.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                                        extraa = extraa.replaceAll(/\\v\[(\d+)\]/gi, this.optionVariableCommandReplacer2.getValue());
                                    }
                                    if (extraInSecondString.length > 0 && missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these problems: Additional variable placeholders: ' + extraa + " Missing variable placeholders: " + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these problems: Additional variable placeholders: " + extraa + " Missing variable placeholders: " + missin;
                                        retryPromptAddition = "\nVARIABLE PLACEHOLDERS ERROR: You must preserve all variable placeholders exactly. Your response had these issues:\n- Added variable placeholders: " + extraa + "\n- Missing variable placeholders: " + missin + "\nInclude all original variable placeholders and don't add any new ones.";
                                    } else if (extraInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these additional variable placeholders: ' + extraa);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these additional variable placeholders: " + extraa;
                                        retryPromptAddition = "\nVARIABLE PLACEHOLDERS ERROR: You added these extra variable placeholders that weren't in the original: " + extraa + "\nOnly include variable placeholders that were present in the original source text.";
                                    } else if (missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response was missing these variable placeholders: ' + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response was missing these variable placeholders: " + missin;
                                        retryPromptAddition = "\nVARIABLE PLACEHOLDERS ERROR: You missed these required variable placeholders: " + missin + "\nYou must include all variable placeholders from the original text exactly as they appear.";
                                    }
                                } else if (!nameCommandResult.isMatch) {
                                    allreadyfked = true;
                                    const {
                                        missingInSecondString,
                                        extraInSecondString
                                    } = nameCommandResult.differences;
                                    let missin = missingInSecondString.join(', ');
                                    let extraa = extraInSecondString.join(', ');
                                    if (originalPlacolderText.match(/\\N\[\d+\]/g) != null) {
                                        missin = missin.replaceAll(/n/g, "N");
                                    }
                                    if (responseOrigPlaceholder.match(/\\N\[\d+\]/g) != null) {
                                        extraa = extraa.replaceAll(/n/g, "N");
                                    }
                                    if (this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "" && llmToUse == "model1" && retryCount <= 10) {
                                        missin = missin.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                                        extraa = extraa.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer.getValue());
                                    } else if (this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                        missin = missin.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                                        extraa = extraa.replaceAll(/\\n\[(\d+)\]/gi, this.optionNameCommandReplacer2.getValue());
                                    }
                                    if (extraInSecondString.length > 0 && missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these problems: Additional name placeholders: ' + extraa + " Missing name placeholders: " + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these problems: Additional name placeholders: " + extraa + " Missing name placeholders: " + missin;
                                        retryPromptAddition = "\nNAME PLACEHOLDER ERROR: You must preserve all name placeholders exactly. Your response had these issues:\n- Added name placeholders: " + extraa + "\n- Missing name placeholders: " + missin + "\nInclude all original name placeholders and don't add any new ones.";
                                    } else if (extraInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these additional name placeholders: ' + extraa);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these additional name placeholders: " + extraa;
                                        retryPromptAddition = "\nNAME PLACEHOLDER ERROR: You added these extra name placeholders that weren't in the original: " + extraa + "\nOnly include name placeholders that were present in the original source text.";
                                    } else if (missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response was missing these name placeholders: ' + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response was missing these name placeholders: " + missin;
                                        retryPromptAddition = "\nNAME PLACEHOLDER ERROR: You missed these required name placeholders: " + missin + "\nYou must include all name placeholders from the original text exactly as they appear.";
                                    }
                                } else if (!nameCommandResultW.isMatch) {
                                    allreadyfked = true;
                                    const {
                                        missingInSecondString,
                                        extraInSecondString
                                    } = nameCommandResultW.differences;
                                    let missin = missingInSecondString.join(', ');
                                    let extraa = extraInSecondString.join(', ');
                                    if (originalPlacolderText.match(/\\NW\[\d+\]/g) != null) {
                                        missin = missin.replaceAll(/nw/g, "NW");
                                    }
                                    if (responseOrigPlaceholder.match(/\\NW\[\d+\]/g) != null) {
                                        extraa = extraa.replaceAll(/nw/g, "NW");
                                    }
                                    if (this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "" && llmToUse == "model1" && retryCount <= 10) {
                                        missin = missin.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                                        extraa = extraa.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer.getValue());
                                    } else if (this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                        missin = missin.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                                        extraa = extraa.replaceAll(/\\nw\[(\d+)\]/gi, this.optionCharacterCommandReplacer2.getValue());
                                    }
                                    if (extraInSecondString.length > 0 && missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these problems: Additional name placeholders: ' + extraa + " Missing name placeholders: " + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these problems: Additional name placeholders: " + extraa + " Missing name placeholders: " + missin;
                                        retryPromptAddition = "\nNAME PLACEHOLDER ERROR: You must preserve all name placeholders exactly. Your response had these issues:\n- Added name placeholders: " + extraa + "\n- Missing name placeholders: " + missin + "\nInclude all original name placeholders and don't add any new ones.";
                                    } else if (extraInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these additional name placeholders: ' + extraa);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these additional name placeholders: " + extraa;
                                        retryPromptAddition = "\nNAME PLACEHOLDER ERROR: You added these extra name placeholders that weren't in the original: " + extraa + "\nOnly include name placeholders that were present in the original source text.";
                                    } else if (missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response was missing these name placeholders: ' + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response was missing these name placeholders: " + missin;
                                        retryPromptAddition = "\nNAME PLACEHOLDER ERROR: You missed these required name placeholders: " + missin + "\nYou must include all name placeholders from the original text exactly as they appear.";
                                    }
                                } else if (!itemCommandResult.isMatch) {
                                    allreadyfked = true;
                                    const {
                                        missingInSecondString,
                                        extraInSecondString
                                    } = itemCommandResult.differences;
                                    let missin = missingInSecondString.join(', ');
                                    let extraa = extraInSecondString.join(', ');
                                    if (originalPlacolderText.match(/\\I\[\d+\]/g) != null) {
                                        missin = missin.replaceAll(/i/g, "I");
                                    }
                                    if (responseOrigPlaceholder.match(/\\I\[\d+\]/g) != null) {
                                        extraa = extraa.replaceAll(/i/g, "I");
                                    }
                                    if (this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "" && llmToUse == "model1" && retryCount <= 10) {
                                        missin = missin.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                                        extraa = extraa.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer.getValue());
                                    } else if (this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                        missin = missin.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                                        extraa = extraa.replaceAll(/\\i\[(\d+)\]/gi, this.optionImageCommandReplacer2.getValue());
                                    }
                                    if (extraInSecondString.length > 0 && missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these problems: Additional image placeholders: ' + extraa + " Missing image placeholders: " + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these problems: Additional image placeholders: " + extraa + " Missing image placeholders: " + missin;
                                        retryPromptAddition = "\nIMAGE PLACEHOLDER ERROR: You must preserve all image placeholders exactly. Your response had these issues:\n- Added image placeholders: " + extraa + "\n- Missing image placeholders: " + missin + "\nInclude all original image placeholders and don't add any new ones.";
                                    } else if (extraInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response had these additional image placeholders: ' + extraa);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response had these additional image placeholders: " + extraa;
                                        retryPromptAddition = "\nIMAGE PLACEHOLDER ERROR: You added these extra image placeholders that weren't in the original: " + extraa + "\nOnly include image placeholders that were present in the original source text.";
                                    } else if (missingInSecondString.length > 0) {
                                        console.error('[DSLR] ' + llmName + '\'s response was missing these image placeholders: ' + missin);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        lastRejectReason = llmName + "'s response was missing these image placeholders: " + missin;
                                        retryPromptAddition = "\nIMAGE PLACEHOLDER ERROR: You missed these required image placeholders: " + missin + "\nYou must include all image placeholders from the original text exactly as they appear.";
                                    }
                                } else if (responseText.match(/JPCHARDRAWING/g) == null && (responseText.match(/[一-龠ぁ-ゔァ-ヴ々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null && rejectValue == true && this.optionEnableRejectJapanese.getValue() == true && llmToUse == "model1" && window.transConfig.japanesesource == true) || (responseText.match(/[一-龠ぁ-ゔァ-ヴ々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null && rejectValue == true && this.optionEnableRejectJapanese2.getValue() == true && llmToUse == "model2" && window.transConfig.japanesesource == true)) {
                                    // removed 'ー' because some stupid llms refuse to view it as a Japanese character
                                    allreadyfked = true;
                                    let currentplaceholderthing1 = this.optionPlaceholderReplacer.getValue().replaceAll(/\$/g, "1");
                                    let currentplaceholderthing2 = this.optionPlaceholderReplacer.getValue().replaceAll(/\$/g, "2");
                                    if (currentplaceholderthing1 == undefined || currentplaceholderthing1 == "") {
                                        currentplaceholderthing1 = "@1";
                                        currentplaceholderthing2 = "@2";
                                    }
                                    let leftoverJapanese = responseText.match(/[一-龠ぁ-ゔァ-ヴ々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+/g);
                                    if (Array.isArray(leftoverJapanese)) {
                                        leftoverJapanese = leftoverJapanese.join(', ');
                                    } else if (leftoverJapanese == undefined || leftoverJapanese == null) {
                                        leftoverJapanese = "";
                                    }
                                    console.error('[DSLR] ' + llmName + '\'s response had Japanese text.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had Japanese text.";
                                    retryPromptAddition = `\nYour response had these Japanese characters '${leftoverJapanese}'. Do not respond with the Japanese source text, or any other additions. Only respond with the English translation. If you have to use Japanese characters to draw shapes/emoticons in order to translate accurately, add "JPCHARDRAWING" at the end of your response. You need to translate nameplates. Examples: Wrong:'${currentplaceholderthing1}神官${currentplaceholderthing2}' Correct:'${currentplaceholderthing1}Priest${currentplaceholderthing2}' Wrong:'${currentplaceholderthing1}\\n<神官>${currentplaceholderthing2}' Correct:'${currentplaceholderthing1}\\n<Priest>${currentplaceholderthing2}'.`;
                                    if (leftoverJapanese == "") {
                                        retryPromptAddition = `\nYour response had these Japanese characters. Do not respond with the Japanese source text, or any other additions. Only respond with the English translation. If you have to use Japanese characters to draw shapes/emoticons in order to translate accurately, add "JPCHARDRAWING" at the end of your response. You need to translate nameplates. Examples: Wrong: '崩壊NPC姦ver0.91.2' Correct: 'Collapsed NPC Rape ver0.91.2' Wrong:'${currentplaceholderthing1}神官${currentplaceholderthing2}' Correct:'${currentplaceholderthing1}Priest${currentplaceholderthing2}' Wrong:'${currentplaceholderthing1}\\n<神官>${currentplaceholderthing2}' Correct:'${currentplaceholderthing1}\\n<Priest>${currentplaceholderthing2}'.`;
                                    }
                                } else if (allreadyfked != true && rejectValue == true && this._rejectGlossaryOn(llmToUse) && responseText.match(/GLOSSARYDIFF/gi) == null) {
                                    // Glossary conformance: when the source line contains a
                                    // glossary term with a defined translation, the translation
                                    // must reflect it (the term, an allowed pronoun/gender word
                                    // for character entries) or authorize a deviation with the
                                    // GLOSSARYDIFF escape. Presence check only — no model call.
                                    let _gMissing = [];
                                    try {
                                        const _gEntries = this._glossaryCheckEntries();
                                        if (_gEntries && _gEntries.length) {
                                            const _gResult = require("./glossaryCheck").checkLine(
                                                trimmedOriginalText, responseText, _gEntries);
                                            if (!_gResult.ok) _gMissing = _gResult.missing;
                                        }
                                    } catch (e) { _gMissing = []; }
                                    if (_gMissing.length) {
                                        allreadyfked = true;
                                        const _gList = _gMissing.map((m) => "'" + m.ja + "' = '" + m.en + "'").join(", ");
                                        lastRejectReason = "The translation did not use required glossary term(s): " + _gList;
                                        console.error('[DSLR] ' + lastRejectReason);
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        retryPromptAddition = "\nGLOSSARY ERROR: The original contains glossary term(s) your translation does not use: " + _gList + ". Use the glossary translation exactly as given. If a different rendering is genuinely correct here, add \"GLOSSARYDIFF\" at the end of your response.";
                                    }
                                }
                                if (responseText.match(/JPCHARDRAWING/g) != null) {
                                    responseText = responseText.replaceAll(/ *JPCHARDRAWING */g, "");
                                }
                                if (responseText.match(/GLOSSARYDIFF/gi) != null) {
                                    responseText = responseText.replaceAll(/ *GLOSSARYDIFF */gi, "");
                                }
                                if (allreadyfked != true && originallinebreaktrim.match(/^[\s]*[\S][\s]*$/g) != null && originallinebreaktrim.toString().split('\n').length < responselinebreaktrim.toString().split('\n').length && rejectValue == true) {
                                    allreadyfked = true;
                                    let originalcharacter = originallinebreaktrim.match(/[\S]/g);
                                    console.error('[DSLR] ' + llmName + '\'s response had multiple lines even though the original was just this single character:' + originalcharacter);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had multiple lines even though the original was just this single character:" + originalcharacter;
                                    retryPromptAddition = "\nThe original text was a single character: " + originalcharacter + "\nYour response must be a single line translation without any additional text or line breaks.";
                                } else if (originallinebreaktrim.match(/^[\s]*[\S][\S][\s]*$/g) != null && originallinebreaktrim.toString().split('\n').length < responselinebreaktrim.toString().split('\n').length && rejectValue == true) {
                                    allreadyfked = true;
                                    let originalcharacter = originallinebreaktrim.match(/[\S][\S]/g);
                                    console.error('[DSLR] ' + llmName + '\'s response had multiple lines even though the original was just 2 characters:' + originalcharacter);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had multiple lines even though the original was just these 2 characters:" + originalcharacter;
                                    retryPromptAddition = "\nThe original text was only 2 characters: " + originalcharacter + "\nYour response must be a single line translation without any additional text or line breaks.";
                                } else if (originallinebreaktrim.match(/^[\s]*[\S][\S][\S][\s]*$/g) != null && originallinebreaktrim.toString().split('\n').length < responselinebreaktrim.toString().split('\n').length && rejectValue == true) {
                                    allreadyfked = true;
                                    let originalcharacter = originallinebreaktrim.match(/[\S][\S][\S]/g);
                                    console.error('[DSLR] ' + llmName + '\'s response had multiple lines even though the original was just 3 characters:' + originalcharacter);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had multiple lines even though the original was just these 3 characters:" + originalcharacter;
                                    retryPromptAddition = "\nThe original text was only 3 characters: " + originalcharacter + "\nYour response must be a single line translation without any additional text or line breaks.";
                                } else if (originallinebreaktrim.match(/^[\s]*[\S][\S][\S][\S][\s]*$/g) != null && originallinebreaktrim.toString().split('\n').length < responselinebreaktrim.toString().split('\n').length && rejectValue == true) {
                                    allreadyfked = true;
                                    let originalcharacter = originallinebreaktrim.match(/[\S][\S][\S][\S]/g);
                                    console.error('[DSLR] ' + llmName + '\'s response had multiple lines even though the original was just 4 characters:' + originalcharacter);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had multiple lines even though the original was just these 4 characters:" + originalcharacter;
                                    retryPromptAddition = "\nThe original text was only 4 characters: " + originalcharacter + "\nYour response must be a single line translation without any additional text or line breaks.";
                                } else if ((trimmedOriginalText.length + 1) * 9 < responseText.length && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response had way too many characters. The original only had ' + trimmedOriginalText.length + " characters, but the response had " + responseText.length + ' characters.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had way too many characters. The original only had " + trimmedOriginalText.length + " characters, but the response had " + responseText.length + " characters.";
                                    retryPromptAddition = "\nYour translation was too verbose. The original had " + trimmedOriginalText.length + " characters, but your response had " + responseText.length + " characters. Provide a more concise translation that matches the original's length more closely.";
                                } else if ((responseText.length + 1) * 9 < trimmedOriginalText.length && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response had way too few characters. The original had ' + trimmedOriginalText.length + " characters, but the response only had " + responseText.length + ' characters.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had way too few characters. The original had " + trimmedOriginalText.length + " characters, but the response only had " + responseText.length + " characters.";
                                    retryPromptAddition = "\nYour translation was incomplete. The original had " + trimmedOriginalText.length + " characters, but your response only had " + responseText.length + " characters. Provide a more complete translation that captures all the original content.";
                                } else if (trimmedOriginalText.match(/[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?\d/g) == null && responseText.match(/[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９].\s?[\d０-９]/g) != null && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response had weird unrelated numbers.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had weird unrelated numbers.";
                                    retryPromptAddition = "\nDO NOT add any numbers that weren't in the original text. Only include numbers that were present in the original source text.";
                                } else if (trimmedOriginalText.match(/([\d０-９].?\s?)\1\1\1\1/g) == null && responseText.match(/([\d０-９].?\s?)\1\1\1\1/g) != null && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response had weird repeated numbers.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had weird repeated numbers. Probably related to broken placeholders.";
                                    retryPromptAddition = "\nDO NOT add any numbers that weren't in the original text. Only include numbers that were present in the original source text.";
                                } else if (trimmedOriginalText.match(/\\\w+\[\w+\]/gi) != null && responseText.match(/\\\w+\[\w+\]/gi) == null && rejectValue == true) {
                                    allreadyfked = true;
                                    let screwup = trimmedOriginalText.match(/\\\w+\[\w+\]/gi);
                                    console.error('[DSLR] ' + llmName + '\'s response screwed up this command: ' + screwup);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response screwed up this command: " + screwup;
                                    retryPromptAddition = "\nYour response did not correctly preserve this command: " + screwup;
                                } else if (originallinebreaktrim.toString().split('\n').length < responselinebreaktrim.toString().split('\n').length && trimmedOriginalText.length * 5 < responseText.length && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response had too many lines and significantly more characters, suggesting wrongly added content.. Original linecount: ' + originallinebreaktrim.toString().split('\n').length + "  " + "Response linecount: " + responselinebreaktrim.toString().split('\n').length);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had too many lines and significantly more characters, suggesting wrongly added content. Original linecount: " + originallinebreaktrim.toString().split('\n').length + "  " + "Response linecount: " + responselinebreaktrim.toString().split('\n').length;
                                    retryPromptAddition = "\nYour response had incorrect line breaks. The original had " + originallinebreaktrim.toString().split('\n').length + " lines, but your response had " + responselinebreaktrim.toString().split('\n').length + " lines. Match the original's line count exactly.";
                                } else if (originallinebreaktrim.toString().split('\n').length > responselinebreaktrim.toString().split('\n').length && trimmedOriginalText.length / 2 > responseText.length && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response had too few lines and significantly less characters, suggesting missing content. Original linecount: ' + originallinebreaktrim.toString().split('\n').length + "  " + "Response linecount: " + responselinebreaktrim.toString().split('\n').length);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response had too few lines and significantly less characters, suggesting missing content. Original linecount: " + originallinebreaktrim.toString().split('\n').length + "  " + "Response linecount: " + responselinebreaktrim.toString().split('\n').length;
                                    retryPromptAddition = "\nYour response was missing line breaks. The original had " + originallinebreaktrim.toString().split('\n').length + " lines, but your response had " + responselinebreaktrim.toString().split('\n').length + " lines. Match the original's line count exactly.";
                                } else if (trimmedOriginalText.match(/\\>/g) != null && responseText.match(/\\>/g) == null && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response did not preserve a \\> command.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response did not preserve a \\> command.";
                                    retryPromptAddition = "\nYour response was missing a \\> command.";
                                } else if (trimmedOriginalText.match(/\\</g) != null && responseText.match(/\\</g) == null && rejectValue == true) {
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response did not preserve a \\< command.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response did not preserve a \\< command.";
                                    retryPromptAddition = "\nYour response was missing a \\< command.";
                                } else if (trimmedOriginalText.match(/\\\w+<.+?>/g) != null && responseText.match(/\\\w+<.+?>/g) == null && rejectValue == true) {
                                    allreadyfked = true;
                                    let originalcommand = trimmedOriginalText.match(/\\\w+<.+?>/);
                                    console.error('[DSLR] ' + llmName + `'s response did not correctly preserve a ${originalcommand} command.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + `'s response did not correctly preserve a ${originalcommand} command.`;
                                    retryPromptAddition = `\nYour response did not correctly preserve a ${originalcommand} command.`;
                                } else if (trimmedOriginalText.match(/\"/g) != null && responseText.match(/\"/g) == null && rejectValue == true) {
                                    allreadyfked = true;
                                    let currentplaceholderthing1 = this.optionPlaceholderReplacer.getValue().replaceAll(/\$/g, "1");
                                    let currentplaceholderthing2 = this.optionPlaceholderReplacer.getValue().replaceAll(/\$/g, "2");
                                    if (currentplaceholderthing1 == undefined || currentplaceholderthing1 == "") {
                                        currentplaceholderthing1 = "@1";
                                        currentplaceholderthing2 = "@2";
                                    }
                                    console.error('[DSLR] ' + llmName + `'s response did not correctly preserve quotes.`);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + `'s response did not correctly preserve quotes.`;
                                    retryPromptAddition = `\nYour response did not correctly preserve necessary quotes. '"' need to be preserved.\nExamples:\n\nInput: ${currentplaceholderthing1}ニーナ${currentplaceholderthing2}"はい、かしこまりました"\nOutput:\nWrong: ${currentplaceholderthing1}Nina${currentplaceholderthing2} Yes, understood.\nCorrect: ${currentplaceholderthing1}Nina${currentplaceholderthing2} "Yes, understood."\n\nInput: "…"${currentplaceholderthing2}エミリー${currentplaceholderthing1}\nOutput:\nWrong: ... ${currentplaceholderthing2}Emily${currentplaceholderthing1}\nCorrect: "..." ${currentplaceholderthing2}Emily${currentplaceholderthing1}`;
                                }/*  else if (((trimmedOriginalText.match(/[0０]/gi) != null && responseText.match(/0|０|zero|null|nothing/gi) == null) || (trimmedOriginalText.match(/[1１]/gi) != null && responseText.match(/1|１|one|once|sing|first|ten|hundred|thousand|illion|single/gi) == null) || (trimmedOriginalText.match(/[2２]/gi) != null && responseText.match(/2|２|two|twice|again|repeat|twent|second|double|pair/gi) == null) || (trimmedOriginalText.match(/[3３]/gi) != null && responseText.match(/3|３|three|thrice|third|thirt|triple|trouple/gi) == null) || (trimmedOriginalText.match(/[4４]/gi) != null && responseText.match(/4|４|four|quadrouple/gi) == null) || (trimmedOriginalText.match(/[5５]/gi) != null && responseText.match(/5|５|five|fift|penta/gi) == null) || (trimmedOriginalText.match(/[6６]/gi) != null && responseText.match(/6|６|six/gi) == null) || (trimmedOriginalText.match(/[7７]/gi) != null && responseText.match(/7|７|seven/gi) == null) || (trimmedOriginalText.match(/[8８]/gi) != null && responseText.match(/8|８|eight|octo/gi) == null) || (trimmedOriginalText.match(/[9９]/gi) != null && responseText.match(/9|９|nine/gi) == null)) && rejectValue == true) {
                                    //Disabled until I can refine and test it more
                                    allreadyfked = true;
                                    console.error('[DSLR] ' + llmName + '\'s response did not preserve numbers from the original.\n');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    lastRejectReason = llmName + "'s response did not preserve numbers from the original.";
                                    retryPromptAddition = "\nYour response was missing numbers from the original.";
                                } */
                            }
                            // Reviewer as an ordinary per-line check. Runs only after the
                            // structural checks passed; uses the seeded windowed verdict on
                            // the first attempt and a neighbor-windowed re-review on retries,
                            // focused on the retried row alone (neighbors are context, never
                            // verdict targets), and rejects exactly like the other checks so
                            // RequestLoop retries the line with the judge's feedback.
                            if (reviewState && allreadyfked == false) {
                                const _rpos = i;
                                const _wasReviewed = reviewState.reviewed.has(_rpos) || reviewState.flagged.has(_rpos);
                                let _rverdict = null;      // null = reviewed clean; undefined = review failed
                                let _rreviewRan = false;   // whether a QC call actually completed for this attempt
                                try {
                                    if (reviewState.seedApplied && retryCount === 0) {
                                        _rverdict = reviewState.verdicts[_rpos] || null;
                                        _rreviewRan = !reviewState.unreviewed.has(_rpos);
                                    } else if (!reviewState.seedApplied || _wasReviewed) {
                                        // Freshest neighbor text: rows already accepted in this
                                        // run contribute their final text (newtranslatedLines
                                        // holds rows 0..i-1 in order); rows carrying a pending
                                        // redo are suspect — not yet reached, about to change —
                                        // so they serve as source-only context, never ground
                                        // truth to judge the retried row against.
                                        let _rsettled = null;
                                        try {
                                            if (Array.isArray(newtranslatedLines)
                                                && newtranslatedLines.length) {
                                                _rsettled = newtranslatedLines;
                                            }
                                        } catch (e) { _rsettled = null; }
                                        let _rsuspects = [];
                                        try {
                                            const _rv = reviewState.verdicts || {};
                                            for (const _rk of Object.keys(_rv)) {
                                                const _rj = Number(_rk);
                                                if (_rj > _rpos && _rv[_rk] && _rv[_rk].redo) {
                                                    _rsuspects.push(_rj);
                                                }
                                            }
                                        } catch (e) { _rsuspects = []; }
                                        // Attempt history for this row (seed text
                                        // first, then every reviewed retry): feeds
                                        // the re-review prompts and the guards.
                                        let _rprior = [];
                                        try {
                                            if (reviewState.attempts && Array.isArray(reviewState.attempts[_rpos])) {
                                                _rprior = reviewState.attempts[_rpos];
                                            }
                                        } catch (e) { _rprior = []; }
                                        const _rlastText = _rprior.length ? _rprior[_rprior.length - 1].text : null;
                                        let _rhistory = [];
                                        try {
                                            _rhistory = _rprior.map((a) => ({
                                                text: a.text, why: (a.verdict && a.verdict.why) || ""
                                            }));
                                        } catch (e) { _rhistory = []; }
                                        let _rnoProgress = false;
                                        try {
                                            _rnoProgress = _rlastText != null &&
                                                require("./review/retry").isNoProgress(_rlastText, responseText);
                                        } catch (e) { _rnoProgress = false; }
                                        if (_rnoProgress) {
                                            // The retranslation is the text the
                                            // reviewer already ruled on: another
                                            // QC/judge round trip would just
                                            // re-spend calls to reach the same
                                            // verdict. Keep the text and its
                                            // flag, stop retrying this row.
                                            _rverdict = { redo: false, why: "" };
                                            _rreviewRan = true;
                                            this.log("[DSLRReview] no progress @" + _rpos +
                                                " — retranslation identical to the reviewed text; " +
                                                "keeping it flagged as-is.");
                                        } else {
                                            _rverdict = await this._reviewLineVerdict(
                                                _rpos,
                                                (Array.isArray(batchforbatchtrans) && batchforbatchtrans[_rpos] != null)
                                                    ? batchforbatchtrans[_rpos] : trimmedOriginalText,
                                                responseText, endpointNumber,
                                                batchforbatchtrans, translatedLines,
                                                reviewState.sections,
                                                { settled: _rsettled, suspect: _rsuspects },
                                                _rhistory,
                                                reviewState.rounds[_rpos] || 0);
                                            _rreviewRan = _rverdict !== undefined;
                                            if (_rreviewRan) {
                                                // Log this reviewed attempt for the
                                                // history, no-progress, and best-of
                                                // guards below.
                                                try {
                                                    _rprior.push({ text: responseText, verdict: _rverdict });
                                                    reviewState.attempts[_rpos] = _rprior;
                                                } catch (e) { /* advisory only */ }
                                            }
                                        }
                                        // The re-review saw this row clean: release the flag
                                        // so a dismissed/retried row can actually lose its QC tag.
                                        if (_rreviewRan && !_rverdict) reviewState.flagged.delete(_rpos);
                                    }
                                } catch (e) { _rverdict = undefined; _rreviewRan = false; }
                                reviewState.reviewed.add(_rpos);
                                if (_rverdict && _rverdict.redo) reviewState.flagged.add(_rpos);
                                // Same-complaint early exit: the last two reviewed
                                // attempts drew the same ruling in different words,
                                // so the model cannot fix this row — another
                                // retranslation + re-review would just re-spend
                                // calls to reach the same verdict. Accept as-is
                                // with the flag kept (same end state as
                                // exhaustion, at least one round earlier). Needs
                                // a completed retry behind it (two reviewed
                                // attempts) before it can fire.
                                if (_rverdict && _rverdict.redo && (reviewState.rounds[_rpos] || 0) >= 1) {
                                    let _rsame = false;
                                    try {
                                        const _rlog = (reviewState.attempts && reviewState.attempts[_rpos]) || [];
                                        _rsame = _rlog.length >= 2 &&
                                            require("./review/retry").sameComplaint(
                                                _rlog[_rlog.length - 2].verdict,
                                                _rlog[_rlog.length - 1].verdict);
                                    } catch (e) { _rsame = false; }
                                    if (_rsame) {
                                        this.log("[DSLRReview] same complaint @" + _rpos +
                                            " — the ruling repeats the previous round's; " +
                                            "keeping it flagged as-is.");
                                        try {
                                            const _rbest = require("./review/retry").chooseBest(
                                                reviewState.attempts && reviewState.attempts[_rpos]);
                                            if (_rbest !== undefined && _rbest !== responseText) {
                                                responseText = _rbest;
                                                this.log("[DSLRReview] best-of @" + _rpos +
                                                    " — keeping the best-reviewed attempt instead of the last retry.");
                                            }
                                        } catch (e) { /* advisory only */ }
                                        _rverdict = { redo: false, why: "" };
                                    }
                                }
                                if (rejectValue == true && _reviewAutoFixOn && _rverdict && _rverdict.redo
                                    && (reviewState.rounds[_rpos] || 0) < this._reviewRoundsMax()) {
                                    reviewState.rounds[_rpos] = (reviewState.rounds[_rpos] || 0) + 1;
                                    allreadyfked = true;
                                    lastRejectReason = "The reviewer confirmed a translation problem: " + _rverdict.why;
                                    retryPromptAddition = "\nREVIEWER FEEDBACK: " + _rverdict.why +
                                        "\nTranslate the line accurately while preserving every command and placeholder exactly.";
                                } else if (_rverdict && _rverdict.redo && (reviewState.rounds[_rpos] || 0) > 0
                                    && (reviewState.rounds[_rpos] || 0) >= this._reviewRoundsMax()
                                    && !reviewState.exhaustNoted.has(_rpos)) {
                                    // The judge still confirms a problem but the review is out
                                    // of retries for this row: say so in red, once per row, so
                                    // the "Retry was successful" line below cannot read as a
                                    // clean review. The row stays flagged; its translation
                                    // passed all absolute checks and is accepted as-is.
                                    reviewState.exhaustNoted.add(_rpos);
                                    // Best-of acceptance: keep the best-ranked attempt
                                    // seen for this row (earliest wins ties, so the
                                    // original survives when nothing beat it) instead
                                    // of whatever the last retry happened to produce.
                                    try {
                                        const _rbest = require("./review/retry").chooseBest(
                                            reviewState.attempts && reviewState.attempts[_rpos]);
                                        if (_rbest !== undefined && _rbest !== responseText) {
                                            responseText = _rbest;
                                            this.log("[DSLRReview] best-of @" + _rpos +
                                                " — keeping the best-reviewed attempt instead of the last retry.");
                                        }
                                    } catch (e) { /* advisory only */ }
                                    this.error("[DSLR] Review ran out of retries for this row " +
                                        "(Review Retry Rounds exhausted) although the reviewer still confirms a problem. " +
                                        "The row stays flagged for manual review; its translation passed all absolute " +
                                        "checks and is accepted as-is.");
                                    console.error("[DSLR] Review ran out of retries for this row although " +
                                        "the reviewer still confirms a problem; keeping it flagged.");
                                }
                                // Latest review state per line for the batch layer's QC tag
                                // tagging (the engine never touches grid tags). Overwritten
                                // each attempt so only the final outcome is applied. A
                                // skipped/failed review publishes nothing for the line: the
                                // previous state stands (fail closed) instead of guessing.
                                try {
                                    if (_rreviewRan && batchIndexes && batchIndexes[_rpos] != null) {
                                        if (!options._reviewStateByIndex) options._reviewStateByIndex = {};
                                        options._reviewStateByIndex[batchIndexes[_rpos]] =
                                            (!allreadyfked && !reviewState.flagged.has(_rpos)) ? "clear" : "flag";
                                    }
                                } catch (e) { }
                            }
                            if (allreadyfked == false) {
                                if (originalText.match(/^\s*[\n\r]/g) != null) {
                                    responseText = originalText.match(/^\s*[\n\r]/g) + responseText;
                                }
                                if (originalText.match(/[\n\r]\s*;?$/g) != null) {
                                    responseText = responseText + originalText.match(/[\n\r]\s*;?$/g);
                                }
                                if (this.optionReplaceLinebreaks.getValue()) {
                                    trimmedOriginalText = trimmedOriginalText.replaceAll(/<br>/g, "\n");
                                }
                                if (llmToUse == "model1" && retryCount <= 10) {
                                    if (originalPlacolderText.match(/\\N\[\d+\]/g) != null && this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(nameCommandRestore, "\\N[$1]");
                                    } else if (originalPlacolderText.match(/\\n\[\d+\]/g) != null && this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(nameCommandRestore, "\\n[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\NW\[\d+\]/g) != null && this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(characterCommandRestore, "\\NW[$1]");
                                    } else if (originalPlacolderText.match(/\\nw\[\d+\]/g) != null && this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(characterCommandRestore, "\\nw[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\I\[\d+\]/g) != null && this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(imageCommandRestore, "\\I[$1]");
                                    } else if (originalPlacolderText.match(/\\i\[\d+\]/g) != null && this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(imageCommandRestore, "\\i[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\V\[\d+\]/g) != null && this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(variableCommandRestore, "\\V[$1]");
                                    } else if (originalPlacolderText.match(/\\v\[\d+\]/g) != null && this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(variableCommandRestore, "\\v[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\C\[\d+\]/g) != null && this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(colorCommandRestore, "\\C[$1]");
                                    } else if (originalPlacolderText.match(/\\c\[\d+\]/g) != null && this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(colorCommandRestore, "\\c[$1]");
                                    }
                                    if (originalPlacolderText.match(/@\d+/g) != null && this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                        responseText = responseText.replaceAll(placeholderRestore, "@$1");
                                    }
                                } else if (llmToUse == "model2" || retryCount > 10) {
                                    if (originalPlacolderText.match(/\\N\[\d+\]/g) != null && this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(nameCommandRestore2, "\\N[$1]");
                                    } else if (originalPlacolderText.match(/\\n\[\d+\]/g) != null && this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(nameCommandRestore2, "\\n[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\NW\[\d+\]/g) != null && this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(characterCommandRestore2, "\\NW[$1]");
                                    } else if (originalPlacolderText.match(/\\nw\[\d+\]/g) != null && this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(characterCommandRestore2, "\\nw[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\I\[\d+\]/g) != null && this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(imageCommandRestore2, "\\I[$1]");
                                    } else if (originalPlacolderText.match(/\\i\[\d+\]/g) != null && this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(imageCommandRestore2, "\\i[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\V\[\d+\]/g) != null && this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(variableCommandRestore2, "\\V[$1]");
                                    } else if (originalPlacolderText.match(/\\v\[\d+\]/g) != null && this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(variableCommandRestore2, "\\v[$1]");
                                    }
                                    if (originalPlacolderText.match(/\\C\[\d+\]/g) != null && this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(colorCommandRestore2, "\\C[$1]");
                                    } else if (originalPlacolderText.match(/\\c\[\d+\]/g) != null && this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(colorCommandRestore2, "\\c[$1]");
                                    }
                                    if (originalPlacolderText.match(/@\d+/g) != null && this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                        responseText = responseText.replaceAll(placeholderRestore2, "@$1");
                                    }
                                }

                                if (bracketsatfront != undefined && bracketsatfront != null) {
                                    responseText = bracketsatfront + responseText;
                                }
                                if (bracketsatback != undefined && bracketsatback != null) {
                                    responseText = responseText + bracketsatback;
                                }
                                //remove empty lines not present in original
                                if (originalText.match(/\n[ 　]*\n/g) == null && responseText.match(/\n[ 　]*\n/g) != null) {
                                    responseText = responseText.replaceAll(/\n[ 　]*\n/g, "");
                                }
                                // Peeling the bracket onion
                                let originalOnionText = originalText;
                                let layers = [];
                                const frontBracketRegex = /^\s*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]/;
                                const endBracketRegex = /(?<!\\[cinv]w?)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]\s*;?$/;

                                // Remove layers until no more matching brackets are found
                                while (true) {
                                    // Check for front and end brackets
                                    let originalOnionfront = originalOnionText.match(frontBracketRegex);
                                    let originalOnionend = originalOnionText.match(endBracketRegex);

                                    // If no more brackets, break the loop
                                    if (originalOnionfront === null || originalOnionend === null) {
                                        break;
                                    }
                                    // Process front bracket
                                    let originalOnionfrontreg = originalOnionfront[0];
                                    if (originalOnionfront[0].includes('(') || originalOnionfront[0].includes(')') ||
                                        originalOnionfront[0].includes('[') || originalOnionfront[0].includes(']')) {
                                        originalOnionfrontreg = '\\' + originalOnionfront[0];
                                    }

                                    // Process end bracket
                                    let originalOnionendreg = originalOnionend[0];
                                    if (originalOnionend[0].includes('(') || originalOnionend[0].includes(')') ||
                                        originalOnionend[0].includes('[') || originalOnionend[0].includes(']')) {
                                        originalOnionendreg = '\\' + originalOnionend[0];
                                    }

                                    // Check if response has matching brackets
                                    let responseOnionfront = responseText.match(originalOnionfrontreg);
                                    let responseOnionend = responseText.match(originalOnionendreg);

                                    if (responseOnionfront && responseOnionend) {
                                        // Store the layer for later re-adding
                                        layers.push({
                                            front: originalOnionfront[0],
                                            end: originalOnionend[0]
                                        });

                                        // Remove the layer from both texts
                                        responseText = responseText.replace(frontBracketRegex, "").replace(endBracketRegex, "");
                                        originalOnionText = originalOnionText.replace(frontBracketRegex, "").replace(endBracketRegex, "");
                                    } else {
                                        break;
                                    }
                                }
                                //lonely bracket at front
                                if (originalOnionText.match(/^[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“][^\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟´`“]*[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]/gm) != null && responseText.match(/\"[\s\S]+"/gm) != null) {
                                    if (responseText.match(/^[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“][^\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“]/gm) != null && responseText.match(/^[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“][^\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟´`“]*[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]/gm) == null) {
                                        let firstmatch = originalOnionText.match(/^[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“]/m);
                                        let secondmatch = originalOnionText.match(/(?<!^)(?<!\\+[civn]w?\[\d+)[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]/m);
                                        responseText = responseText.replaceAll(/^[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟´`“]/g, "");
                                        if (firstmatch != null) {
                                            if (firstmatch.toString().includes('(') || firstmatch.toString().includes(')') || firstmatch.toString().includes('[') || firstmatch.toString().includes(']')) {
                                                firstmatch = '\\' + firstmatch;
                                            }
                                            responseText = responseText.replace("\"", firstmatch);
                                        }
                                        if (secondmatch != null) {
                                            if (secondmatch.toString().includes('(') || secondmatch.toString().includes(')') || secondmatch.toString().includes('[') || secondmatch.toString().includes(']')) {
                                                secondmatch = '\\' + secondmatch;
                                            }
                                            responseText = responseText.replace("\"", secondmatch);
                                        }
                                    }
                                } else if (bracketsatfrontincludesshortener == true) {
                                    let firstmatch = originalOnionText.match(/^'/m);
                                    if (firstmatch == null) {
                                        firstmatch = originalOnionText.match(/^[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“]*(')/m);
                                        let secondmatch = originalOnionText.match(/'.*?(')/m);
                                        if (firstmatch != null && secondmatch != null) {
                                            if (firstmatch.toString().includes('(') || firstmatch.toString().includes(')') || firstmatch.toString().includes('[') || firstmatch.toString().includes(']')) {
                                                firstmatch = '\\' + firstmatch;
                                            }
                                            responseText = responseText.replace("\"", firstmatch[1]);
                                            if (secondmatch.toString().includes('(') || secondmatch.toString().includes(')') || secondmatch.toString().includes('[') || secondmatch.toString().includes(']')) {
                                                secondmatch = '\\' + secondmatch;
                                            }
                                            responseText = responseText.replace("\"", secondmatch[1]);
                                        }
                                    } else {
                                        let secondmatch = originalOnionText.match(/(?<!^)'/m);
                                        responseText = responseText.replaceAll(/^[']/g, "");
                                        if (firstmatch != null && secondmatch != null) {
                                            if (firstmatch.toString().includes('(') || firstmatch.toString().includes(')') || firstmatch.toString().includes('[') || firstmatch.toString().includes(']')) {
                                                firstmatch = '\\' + firstmatch;
                                            }
                                            responseText = responseText.replace("\"", firstmatch);
                                            if (secondmatch.toString().includes('(') || secondmatch.toString().includes(')') || secondmatch.toString().includes('[') || secondmatch.toString().includes(']')) {
                                                secondmatch = '\\' + secondmatch;
                                            }
                                            responseText = responseText.replace("\"", secondmatch);
                                        }
                                    }
                                }
                                //lonely bracket at the end
                                if (originalOnionText.match(/(?<!\\[cinv]w?|\\[cinv]w?\[\d+)[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“][^\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟´`“]*?[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]$/gm) != null && (responseText.match(/\"[\s\S]+"/gm) != null || responseText.match(/(?<![a-zA-Z])\'[\s\S]+(?<![a-zA-Z])'/gm) != null || responseText.match(/\([\s\S]+\)/gm) != null)) {
                                    if (originalOnionText.match(/[^\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´](?<!\\[cinv]w?\[\d+)[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]$/gm) != null && responseText.match(/(?<!\\[cinv]w?)[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“][^\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟´`“]*?[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]$/gm) == null) {
                                        let firstmatch = originalOnionText.match(/(?<!\\[cinv]w?\[\d+)[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]$/m);
                                        let secondmatch = originalOnionText.match(/(?<!\\+[civn]w?)[\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“](?=[^\(\[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜<｛｟´`“]+?$)/m);
                                        responseText = responseText.replaceAll(/(?<!\\[cinv]w?)[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]$/g, "");
                                        if (firstmatch != null && secondmatch != null) {
                                            if (firstmatch.toString().includes('(') || firstmatch.toString().includes(')') || firstmatch.toString().includes('[') || firstmatch.toString().includes(']')) {
                                                firstmatch = '\\' + firstmatch;
                                            }
                                            if (secondmatch.toString().includes('(') || secondmatch.toString().includes(')') || secondmatch.toString().includes('[') || secondmatch.toString().includes(']')) {
                                                secondmatch = '\\' + secondmatch;
                                            }
                                            if (responseText.match(/\"(?=[^"]*$)/) != null) {
                                                responseText = responseText.replace(/\"(?=[^"]*$)/, firstmatch);
                                                responseText = responseText.replace(/\"(?=[^"]*$)/, secondmatch);
                                            } else if (originalOnionText.match(/(?<![a-zA-Z])\'/gi) == null && responseText.match(/(?<![a-zA-Z])\'/gi) != null) {
                                                responseText = responseText.replace(/(?<![a-zA-Z]|^)\'/, firstmatch);
                                                responseText = responseText.replace(/(?<![a-zA-Z]|^)\'/, secondmatch);
                                            } else if (originalOnionText.match(/[\(\)]/g) == null && responseText.match(/[\(\)]/g) != null) {
                                                responseText = responseText.replace(/(?<!^)\(/, firstmatch);
                                                responseText = responseText.replace(/(?<!^)\)/, secondmatch);
                                            }
                                        }
                                    }
                                } else if (bracketsatbackincludesshortener == true) {
                                    let firstmatch = originalOnionText.match(/'$/m);
                                    if (firstmatch == null) {
                                        firstmatch = originalOnionText.match(/(')(?<!\\[cinv]w?)[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩`´]*$/m);
                                        let secondmatch = originalOnionText.match(/(').*?'/m);
                                        if (firstmatch != null && secondmatch != null) {
                                            if (firstmatch.toString().includes('(') || firstmatch.toString().includes(')') || firstmatch.toString().includes('[') || firstmatch.toString().includes(']')) {
                                                firstmatch = '\\' + firstmatch;
                                            }
                                            responseText = responseText.replace(/\"(?=[^"]*$)/, firstmatch[1]);
                                            if (secondmatch.toString().includes('(') || secondmatch.toString().includes(')') || secondmatch.toString().includes('[') || secondmatch.toString().includes(']')) {
                                                secondmatch = '\\' + secondmatch;
                                            }
                                            responseText = responseText.replace(/\"(?=[^"]*$)/, secondmatch[1]);
                                        }
                                    } else {
                                        let secondmatch = originalOnionText.match(/'(?!$)/m);
                                        responseText = responseText.replaceAll(/^[']/g, "");
                                        if (firstmatch != null && secondmatch != null) {
                                            if (firstmatch.toString().includes('(') || firstmatch.toString().includes(')') || firstmatch.toString().includes('[') || firstmatch.toString().includes(']')) {
                                                firstmatch = '\\' + firstmatch;
                                            }
                                            responseText = responseText.replace(/\"(?=[^"]*$)/, firstmatch);
                                            if (secondmatch.toString().includes('(') || secondmatch.toString().includes(')') || secondmatch.toString().includes('[') || secondmatch.toString().includes(']')) {
                                                secondmatch = '\\' + secondmatch;
                                            }
                                            responseText = responseText.replace(/\"(?=[^"]*$)/, secondmatch);
                                        }
                                    }
                                }
                                //Get rid of additional quotation marks
                                if (responseText.match(/\"/g) != null && originalOnionText.match(/\"/g) == null && originalOnionText.match(/[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g) == null) {
                                    responseText.replaceAll(/\"/g, "");
                                //Fix fixable inner brackets
                                } else if (responseText.match(/\"/g) != null && originalOnionText.match(/\"/g) == null && originalOnionText.match(/[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g) != null) {
                                    let originalBracketCount = originalOnionText;
                                    originalBracketCount = originalBracketCount.replaceAll(/[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g, "\"");
                                    originalBracketCount = originalBracketCount.split('"');
                                    originalBracketCount = originalBracketCount.length - 1;
                                    let responseBracketCount = responseText;
                                    responseBracketCount = responseBracketCount.split('"');
                                    responseBracketCount = responseBracketCount.length - 1;
                                    if (originalBracketCount == responseBracketCount) {
                                        let textSource = originalOnionText;
                                        let responseDestination = responseText;
                                        let leMatch = textSource.match(/[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/);
                                        while (leMatch != null) {
                                            responseDestination = responseDestination.replace(/"/, leMatch);
                                            textSource = textSource.replace(/[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/, "");
                                            leMatch = textSource.match(/[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/);
                                        }
                                        if (responseDestination.match(/\"/g) == null && textSource.match(/[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g) == null) {
                                            responseText = responseDestination;
                                        }
                                    }
                                }
                                // Add layers back in reverse order
                                try {
                                    for (let i = layers.length - 1; i >= 0; i--) {
                                        responseText = layers[i].front + responseText + layers[i].end;
                                    }
                                } catch (error) {
                                    console.error('Error:', error);
                                }
                                // remove addtional "" again
                                if (responseText.match(/\"/g) != null && originalText.match(/\"/g) == null) {
                                    if (responseText.match(/\[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g) != null || originalText.match(/\[\)\]}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚\’〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g) == null) {
                                        responseText = responseText.replaceAll(/\"/g, "");
                                    }
                                }
                                if (responseText.match(/\\[\[\{\(\]\}\)]/gi) != null && trimmedOriginalText.match(/\\[\[\{\(\]\}\)]/gi) == null) {
                                    responseText = responseText.replaceAll(/\\([\[\{\(\]\}\)])/g, "$1");
                                }
                                if (dtextOriginalText.match(/^D_TEXT /gi) != null && responseText.match(/^D_TEXT /gi) == null) {
                                    if (dtextOriginalText.match(/^D_TEXT .*? \d+$/gi) != null) {
                                        let dtext = dtextOriginalText.match(/^D_TEXT /gi);
                                        let fontnumbah = dtextOriginalText.match(/ \d+$/gi);
                                        responseText = dtext + responseText + fontnumbah;
                                    } else {
                                        let dtext = dtextOriginalText.match(/^D_TEXT /gi);
                                        responseText = dtext + responseText;
                                    }
                                }
                                if (dtextOriginalText.match(/(?<=[\.?!,？！、。\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]) \d+$/gi) != null && responseText.match(/(?<=[\.?!,？！、。\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]) \d+$/gi) == null) {
                                        let fontnumbah = dtextOriginalText.match(/ \d+$/gi);
                                        responseText = responseText + fontnumbah;
                                }
                                if (responseText != "" && responseText != undefined && responseText != null) {
                                    if (responseText.match(/\S/g) != null) {
                                        translationsuccessful = true;
                                    }
                                } else {
                                    console.error('[DSLR] ' + llmName + '\'s response was fubar.');
                                    lastRejectReason = llmName + "'s response was fubar.";
                                }
                            }
                            if (retryCount < maxRetries && translationsuccessful != true) {
                                updateBatchFailCount(1);
                                retryCount++;
                                if (maxRetries > 0 && retryCount < 11 && retryCount >= 1) {
                                    this.error(`[DSLR] (${retryCount}/${maxRetries}) Retrying single translation with full failure context. Reason: `, lastRejectReason);
                                    console.error(`[DSLR] (${retryCount}/${maxRetries}) Retrying single translation with full failure context. Reason:` + lastRejectReason);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                } else if (maxRetries > 10 && retryCount == 11) {
                                    this.error(`[DSLR] (${retryCount}/${maxRetries}) Primary model failed. Retrying single translation with fallback model. Reason: `, lastRejectReason);
                                    console.error(`[DSLR] (${retryCount}/${maxRetries}) Primary model failed. Retrying single translation with fallback model. Reason:` + lastRejectReason);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                } else if (maxRetries > 10 && retryCount >= 12) {
                                    this.error(`[DSLR] (${retryCount}/${maxRetries}) Retrying single translation with full failure context. Reason: `, lastRejectReason);
                                    console.error(`[DSLR] (${retryCount}/${maxRetries}) Retrying single translation with full failure context. Reason:` + lastRejectReason);
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                } else {
                                    this.error(`[DSLR] Unacceptable response received, but retries are disabled. Reason: `, lastRejectReason);
                                    console.error(`[DSLR] Unacceptable response received, but retries are disabled. Reason: `, lastRejectReason);
                                    break BatchProcessing;
                                    break;
                                }
                                await new Promise(resolve => setTimeout(resolve, retryDelay));
                                continue;
                            } else if (translationsuccessful == true) {
                                //console.log('Translation accepted.\nRequest:\n\n' + errorBody + '\n\nResponse:\n\n' + unchangedResponse);
                                translationBuffer.add('Translation accepted.\nRequest:\n\n' + errorBody + '\n\nResponse:\n\n' + unchangedResponse);
                                // Store successful translation and original text in history
                                lastSuccessfulTranslations.push(unchangedResponse);
                                lastOriginalTexts.push(trimmedOriginalText);
                                let maxHistory = this.optionContextHistoryLength.getValue();
                                if (llmToUse == "model2") {
                                    maxHistory = this.optionContextHistoryLength2.getValue();
                                }
                                if (lastSuccessfulTranslations.length > maxHistory) {
                                    lastSuccessfulTranslations.shift();
                                    lastOriginalTexts.shift();
                                }
                                newtranslatedLines.push(responseText);
                                updateBatchProgressCount(1);
                                // Update count using the specific index
                                updateTranslatedCount(0, [batchIndexes[i]]);
                                if (retryCount >= 11 && this.optionLimitFallback.getValue() == true) {
                                    this.log(`[DSLR] (${retryCount}/${maxRetries}) Retry with fallback LLM ${llmName} was successful. Now switching back to primary model.`);
                                    console.log(`[DSLR] Retry with fallback LLM ${llmName} was successful. Now switching back to primary model.\nAccepted translation:\n${unchangedResponse}`);
                                } else if (retryCount >= 11 && this.optionLimitFallback.getValue() == false) {
                                    this.log(`[DSLR] (${retryCount}/${maxRetries}) Retry with fallback LLM was successful.`);
                                    console.log("[DSLR] Retry with fallback LLM was successful.\nAccepted translation:\n" + unchangedResponse);
                                } else if (retryCount >= 1) {
                                    this.log(`[DSLR] (${retryCount}/${maxRetries}) Retry was successful.`);
                                    console.log("[DSLR] Retry was successful.\nAccepted translation:\n" + unchangedResponse);
                                }
                                break;
                            } else if (llmToUse == "model2" || this.optionEnableFallback.getValue() == false || (this.optionEnableFallback.getValue() == true && this.optionLimitFallback.getValue() == true)) {
                                updateBatchFailCount(1);
                                this.error(`[DSLR] Failed to get a usable translation.\nLast reason:\n` + lastRejectReason + `\nRequest:\n` + errorBody + `\nLast response:\n` + unchangedResponse);
                                console.error(`[DSLR] Failed to get a usable translation.\nLast reason:\n` + lastRejectReason);
                                errorCollapsed("Request Body:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                this.error(`[DSLR] No recovery options left. The translation, or if there was none the original text, will be accepted with the added error code '　SHISAYE.TRANSLATIONFAIL　' to prevent a complete failure.`);
                                console.error(`[DSLR] No recovery options left. The translation, or if there was none the original text, will be accepted with the added error code '　SHISAYE.TRANSLATIONFAIL　' to prevent a complete failure.`);
                                if (responseText != "" && responseText != undefined) {
                                    if (responseText.match(/\w/) != null) {
                                        if (llmToUse == "model1") {
                                            if (originalPlacolderText.match(/\\N\[\d+\]/g) != null && this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(nameCommandRestore, "\\N[$1]");
                                            } else if (originalPlacolderText.match(/\\n\[\d+\]/g) != null && this.optionNameCommandReplacer.getValue() && this.optionNameCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(nameCommandRestore, "\\n[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\NW\[\d+\]/g) != null && this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(characterCommandRestore, "\\NW[$1]");
                                            } else if (originalPlacolderText.match(/\\nw\[\d+\]/g) != null && this.optionCharacterCommandReplacer.getValue() && this.optionCharacterCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(characterCommandRestore, "\\nw[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\I\[\d+\]/g) != null && this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(imageCommandRestore, "\\I[$1]");
                                            } else if (originalPlacolderText.match(/\\i\[\d+\]/g) != null && this.optionImageCommandReplacer.getValue() && this.optionImageCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(imageCommandRestore, "\\i[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\V\[\d+\]/g) != null && this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(variableCommandRestore, "\\V[$1]");
                                            } else if (originalPlacolderText.match(/\\v\[\d+\]/g) != null && this.optionVariableCommandReplacer.getValue() && this.optionVariableCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(variableCommandRestore, "\\v[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\C\[\d+\]/g) != null && this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(colorCommandRestore, "\\C[$1]");
                                            } else if (originalPlacolderText.match(/\\c\[\d+\]/g) != null && this.optionColorCommandReplacer.getValue() && this.optionColorCommandReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(colorCommandRestore, "\\c[$1]");
                                            }
                                            if (originalPlacolderText.match(/@\d+/g) != null && this.optionPlaceholderReplacer.getValue() && this.optionPlaceholderReplacer.getValue() != "") {
                                                responseText = responseText.replaceAll(placeholderRestore, "@$1");
                                            }
                                        } else if (llmToUse == "model2") {
                                            if (originalPlacolderText.match(/\\N\[\d+\]/g) != null && this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(nameCommandRestore2, "\\N[$1]");
                                            } else if (originalPlacolderText.match(/\\n\[\d+\]/g) != null && this.optionNameCommandReplacer2.getValue() && this.optionNameCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(nameCommandRestore2, "\\n[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\NW\[\d+\]/g) != null && this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(characterCommandRestore2, "\\NW[$1]");
                                            } else if (originalPlacolderText.match(/\\nw\[\d+\]/g) != null && this.optionCharacterCommandReplacer2.getValue() && this.optionCharacterCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(characterCommandRestore2, "\\nw[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\I\[\d+\]/g) != null && this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(imageCommandRestore2, "\\I[$1]");
                                            } else if (originalPlacolderText.match(/\\i\[\d+\]/g) != null && this.optionImageCommandReplacer2.getValue() && this.optionImageCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(imageCommandRestore2, "\\i[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\V\[\d+\]/g) != null && this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(variableCommandRestore2, "\\V[$1]");
                                            } else if (originalPlacolderText.match(/\\v\[\d+\]/g) != null && this.optionVariableCommandReplacer2.getValue() && this.optionVariableCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(variableCommandRestore2, "\\v[$1]");
                                            }
                                            if (originalPlacolderText.match(/\\C\[\d+\]/g) != null && this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(colorCommandRestore2, "\\C[$1]");
                                            } else if (originalPlacolderText.match(/\\c\[\d+\]/g) != null && this.optionColorCommandReplacer2.getValue() && this.optionColorCommandReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(colorCommandRestore2, "\\c[$1]");
                                            }
                                            if (originalPlacolderText.match(/@\d+/g) != null && this.optionPlaceholderReplacer2.getValue() && this.optionPlaceholderReplacer2.getValue() != "") {
                                                responseText = responseText.replaceAll(placeholderRestore2, "@$1");
                                            }
                                        }
                                        console.error('Bad translation accepted.');
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        responseText = responseText + '　SHISAYE.TRANSLATIONFAIL　';
                                        newtranslatedLines.push(responseText);
                                    } else {
                                        console.error('No translation to accept, using original text.');
                                        errorCollapsed("Request Body:", errorBody);
                                        errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                        responseText = originalText + '　SHISAYE.TRANSLATIONFAIL　';
                                        newtranslatedLines.push(responseText);              
                                    }                                        
                                } else {
                                    console.error('No translation to accept, using original text.');
                                    errorCollapsed("Request Body:", errorBody);
                                    errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                    responseText = originalText + '　SHISAYE.TRANSLATIONFAIL　';
                                    newtranslatedLines.push(responseText);        
                                }
                                updateBatchProgressCount(1);
                                updateTranslatedCount(0, [batchIndexes[i]]);
                                break;
                            } else {
                                updateBatchFailCount(1);
                                this.error(`[DSLR] Failed to get a usable translation.\nLast reason:\n` + lastRejectReason + `\nRequest:\n` + errorBody + `\nLast response:\n` + unchangedResponse);
                                console.error(`[DSLR] Failed to get a usable translation.\nLast reason:\n` + lastRejectReason);
                                errorCollapsed("Request Body:", errorBody);
                                errorCollapsed(`${llmName}'s response:`, unchangedResponse);
                                break BatchProcessing;
                                break;
                            }

                            this.error(`[DSLR] Unacceptable response escaped checks somehow. Batch Failed.`, lastRejectReason);
                            console.error(`[DSLR] Unacceptable response escaped checks somehow. Batch Failed.`, lastRejectReason);
                            break BatchProcessing;
                            break;
                        }

                    } catch (error) {
                        updateErrorCount(batch.length);
                        this.error(`[DSLR] Error during translation: ${error.message}\nBatch:\n` + batch);
                        console.error('[DSLR] Translation error:', error);
                        errorCollapsed("Batch:", errbatchorBody);
                    }
                }
            }
            if (newtranslatedLines.length === batch.length) {
                for (let i = 0; i < batch.length; i++) {
                    translations[batchIndexes[i]] = newtranslatedLines[i];
                }
                // Update count with the specific indices that were processed
                updateTranslatedCount(0, batchIndexes);
                if (ep.enableFullBatch == true) {
                    this.log(`[DSLR] Batch of ${batch.length} translations completed.`);
                    console.log(`[DSLR] Batch of ${batch.length} translations completed.`);
                }
                if (llmToUse == "model2") {
                    this.log(`[DSLR] Retry with fallback LLM ${llmName} was successful. Now switching back to primary model.`);              
                    console.log(`[DSLR] Retry with fallback LLM ${llmName} was successful. Now switching back to primary model.`);              
                    llmToUse = "model1";
                }
                startThread();
            } else {
                if (this.aborted) {
                    returnError('Aborted.');
                    return;
                }
                if (llmToUse == "model1" && this.optionEnableFallback.getValue() == true  && this.optionLimitFallback.getValue() == false && fullBFail == "No") {
                    this.error(`[DSLR] All translation attempts failed. Retrying with fallback model.`);
                    console.error(`[DSLR] All translation attempts failed. Retrying with fallback model. - only got ${newtranslatedLines.length} out of ${batch.length} translations.`);
                    llmToUse = "model2";
                    recordFallbackHandover();
                    startThread(false);
                } else if (fullBFail == "No"){
                    this.error(`[DSLR] Batch failed - only got ${newtranslatedLines.length} out of ${batch.length} translations. This suggests a serious error, because it means even the last ditch recovery of using the original text to fill in failed.`);
                    console.error(`[DSLR] Batch failed - only got ${newtranslatedLines.length} out of ${batch.length} translations. This suggests a serious error, because it means even the last ditch recovery of using the original text to fill in failed.`);
                    throw new Error(`[DSLR] Batch failed - only got ${newtranslatedLines.length} out of ${batch.length} translations. This suggests a serious error, because it means even the last ditch recovery of using the original text to fill in failed.`);
                    this.aborted = true;
                }
                // Update count only for indices that have valid translations
/*                 const successfulIndices = [];
                for (let i = 0; i < newtranslatedLines.length; i++) {
                    if (newtranslatedLines[i] !== undefined) {
                        successfulIndices.push(batchIndexes[i]);
                    }
                }
                updateTranslatedCount(0, successfulIndices); */
            }
        };

        return new Promise((resolve, reject) => {
            returnTranslations = resolve;
            returnError = reject;
            for (let i = 0; i < 1; i++) {
                startThread();
            }
        });
    }

    resetStatus() {
        this.aborted = false;
        this.paused = false;
        this.pauseQueue = [];
    }

    // Quality/reliability statistics accumulated across every doTranslate() call during a
    // batch-translation run. The batch translator resets these at the start of a run and prints
    // getRunSummary() once at the end, so a whole game's worth of struggling is visible at a
    // glance instead of having to scroll every per-batch log entry.
    resetRunStats() {
        this._runStats = {
            linesTranslated: 0,
            linesTotal: 0,
            translationFails: 0,
            batchesSplit: 0,
            fallbackHandovers: 0,
            individualRetries: 0,
            batchCorrectionRetries: 0,
            rateLimitRetries: 0,
            serverErrors: 0,
            reviewCalls: 0,
            reviewPromptTokens: 0,
            reviewCompletionTokens: 0,
            // Throughput accounting. The token totals and the wall-clock start let the run
            // summary report an average tokens/sec for the whole job, which is the number a
            // user actually feels (it includes prompt processing, retries and waiting).
            promptTokens: 0,
            completionTokens: 0,
            startedAt: Date.now(),
            elapsedMs: 0
        };
    }

    getRunStats() {
        if (!this._runStats) this.resetRunStats();
        return this._runStats;
    }

    getRunSummary() {
        if (!this._runStats) this.resetRunStats();
        var s = this._runStats;
        var pct = (s.linesTotal > 0) ? Math.round(100 * s.linesTranslated / s.linesTotal) : 0;
        var pl = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
        var lines = [
            '[DSLR] ─── Translation Quality Summary ───',
            '[DSLR] Translated ' + s.linesTranslated + '/' + s.linesTotal + ' lines (' + pct + '%) · ' + pl(s.translationFails, 'unrecoverable failure') + ' [TRANSLATIONFAIL]',
            '[DSLR] Context loss (quality impact): ' + pl(s.batchesSplit, 'batch split') + ', ' + pl(s.fallbackHandovers, 'fallback handover') + ', ' + pl(s.individualRetries, 'single-line rejection'),
            '[DSLR] Recoverable (time/cost only): ' + pl(s.batchCorrectionRetries, 'full-batch correction') + ', ' + pl(s.rateLimitRetries, 'rate-limit (429) wait') + ', ' + pl(s.serverErrors, 'other server error')
        ];
        if (s.reviewCalls > 0) {
            lines.push('[DSLR] Review (QC/judge): ' + pl(s.reviewCalls, 'call') + ' · prompt ' +
                (s.reviewPromptTokens || 0) + ' · completion ' + (s.reviewCompletionTokens || 0) + ' tokens');
        }
        if (s.elapsedMs > 0 && ((s.promptTokens || 0) > 0 || (s.completionTokens || 0) > 0)) {
            var seconds = s.elapsedMs / 1000;
            var rate = function (tokens) { return (tokens / seconds).toFixed(1); };
            var minutes = Math.floor(seconds / 60);
            var rest = Math.round(seconds % 60);
            var duration = minutes > 0 ? (minutes + 'm ' + rest + 's') : (rest + 's');
            lines.push('[DSLR] Throughput (average over the whole run, including prompt processing, retries and waiting): ' +
                rate(s.completionTokens || 0) + ' tok/s generated, ' + rate(s.promptTokens || 0) + ' tok/s prompt · ' +
                (s.promptTokens || 0) + ' prompt + ' + (s.completionTokens || 0) + ' completion tokens in ' + duration);
        }
        return lines;
    }

    // Multi-stream preview coordination. Concurrent batches each run doTranslate with their
    // own token-counter and preview nodes on this shared engine instance. Showing every
    // growing preview at once would flood the console, so by default no preview is shown
    // while more than one stream is active — only the token counters of all streams keep
    // updating. Once the count drops back to a single active stream, that stream's preview
    // is shown again. The 'Stream All Concurrent Responses' option opts out of the
    // coordination and shows every active stream's preview at the same time.
    _registerStreamPreview(slot) {
        if (!slot || !slot.pre) return;
        if (!this._streamPreviewStack) this._streamPreviewStack = [];
        if (this._streamPreviewStack.indexOf(slot) === -1) this._streamPreviewStack.push(slot);
        this._refreshStreamPreviews();
    }

    _unregisterStreamPreview(slot) {
        var stack = this._streamPreviewStack;
        if (!stack || !slot) return;
        var idx = stack.indexOf(slot);
        if (idx !== -1) stack.splice(idx, 1);
        // The removed slot itself must be hidden: _refreshStreamPreviews only touches
        // the slots still in the stack, and this one just left it.
        if (slot.pre) slot.pre.style.display = 'none';
        this._refreshStreamPreviews();
    }

    _refreshStreamPreviews() {
        var stack = this._streamPreviewStack;
        if (!stack) return;
        if (this.optionStreamAllPreviews && this.optionStreamAllPreviews.getValue() === true) {
            // 'Stream All Concurrent Responses': every active stream's preview is visible.
            for (var i = 0; i < stack.length; i++) {
                stack[i].pre.style.display = '';
            }
            return;
        }
        // Default: previews only while exactly one stream is active (multiple growing
        // previews at once would flood the console; the token counters of all streams
        // keep updating either way).
        var top = stack.length === 1 ? stack[0] : null;
        for (var i = 0; i < stack.length; i++) {
            stack[i].pre.style.display = (stack[i] === top) ? '' : 'none';
        }
    }

    // Signal for LLM fetches. All requests of a run share one controller so a single
    // abort() can cancel every in-flight request (the endpoint — e.g. LM Studio — then
    // stops generating). Recreated lazily after an abort for the next run.
    _requestSignal() {
        if (!this._fetchAbort || this._fetchAbort.signal.aborted) {
            this._fetchAbort = new AbortController();
        }
        return this._fetchAbort.signal;
    }

    abort() {
        this.aborted = true;
        if (this._fetchAbort) {
            try { this._fetchAbort.abort(); } catch (e) { /* already aborted */ }
            this._fetchAbort = null;
        }
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
        this.pauseQueue.forEach((action) => {
            action();
        });
        this.pauseQueue = [];
    }
}

// Commit the panel's live form values into the selected model's persisted profile. The
// Options window calls this on close with jsonForm.root.getFormValues(), so a pick lands
// even if a field's change event never fired. The two select keys drive their mode+id pair
// like their own onChange handlers; every "rtProfile_<field>" key is coerced through
// runtimeProfilePatch; anything else is ignored.
function applyPanelValuesToProfiles(engine, values) {
    var input = (values && typeof values === "object") ? values : {};
    if (!engine) return null;
    var modelId = "";
    try { modelId = engine.optionRuntimeModel ? (engine.optionRuntimeModel.getValue() || "") : ""; } catch (e) { modelId = ""; }
    if (!modelId) return null;
    var raw = "";
    try { raw = engine.optionRuntimeModelProfiles ? (engine.optionRuntimeModelProfiles.getValue() || "") : ""; } catch (e) { raw = ""; }
    var patch = {};
    if (typeof input.rtSpecMode !== "undefined") {
        var specRaw = (input.rtSpecMode === null || input.rtSpecMode === "") ? "auto" : input.rtSpecMode;
        Object.assign(patch, runtimeProfilePatch("specMode", specRaw), runtimeProfilePatch("draftId", specRaw));
    }
    if (typeof input.rtMmprojMode !== "undefined") {
        var mmRaw = (input.rtMmprojMode === null || input.rtMmprojMode === "") ? "auto" : input.rtMmprojMode;
        Object.assign(patch, runtimeProfilePatch("mmprojMode", mmRaw), runtimeProfilePatch("mmprojId", mmRaw));
    }
    for (var key in input) {
        if (String(key).indexOf("rtProfile_") !== 0) continue;
        var field = String(key).slice("rtProfile_".length);
        if (!field) continue;
        Object.assign(patch, runtimeProfilePatch(field, input[key]));
    }
    if (Object.keys(patch).length === 0) return null;
    var map = localRuntimeModelProfiles({ raw: raw, legacy: {}, drafts: {}, selectedId: modelId });
    var next = ModelProfiles_1.setProfile(map, modelId, patch);
    try {
        if (engine.optionRuntimeModelProfiles) engine.optionRuntimeModelProfiles.setValue(JSON.stringify(next));
    } catch (e) { /* persistence is best effort */ }
    // Keep the render-time values in step (options.js assignDefault copies
    // translatorInfo[key] onto the schema default, and translatorInfo is translatorEngine):
    // the next Options render must show the flushed values even before the next panel rebuild
    // re-emits them. Display strings mirror the panel's own fieldValue().
    try {
        var renderTarget = engine.translatorEngine || engine;
        if (typeof input.rtSpecMode !== "undefined") {
            renderTarget.rtSpecMode = (patch.specMode === "off") ? "off" : (patch.draftId ? String(patch.draftId) : "auto");
        }
        if (typeof input.rtMmprojMode !== "undefined") {
            renderTarget.rtMmprojMode = (patch.mmprojMode === "off") ? "off" : (patch.mmprojId ? String(patch.mmprojId) : "auto");
        }
        for (var patchedField in patch) {
            var patchedValue = patch[patchedField];
            renderTarget["rtProfile_" + patchedField] = (patchedValue === undefined || patchedValue === null || patchedValue === "") ? "" : String(patchedValue);
        }
    } catch (e) { /* render defaults are best effort */ }
    return { modelId: modelId, patch: patch };
}

exports.DSLREngine = DSLREngine;
exports.localRuntimeStopDecision = localRuntimeStopDecision;
exports.localRuntimeModelProfiles = localRuntimeModelProfiles;
exports.runtimeChoiceOptions = runtimeChoiceOptions;
exports.runtimeFieldHints = runtimeFieldHints;
exports.runtimeHardwareNote = runtimeHardwareNote;
exports.runtimeProfilePatch = runtimeProfilePatch;
exports.applyPanelValuesToProfiles = applyPanelValuesToProfiles;
exports.rolePickerUpdates = rolePickerUpdates;
exports.roleReloadNote = roleReloadNote;
