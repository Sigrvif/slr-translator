// www/core/llmRuntime/lib/ModelAssociations.js
//
// Pairs drafts and projectors with target models using GGUF content only. The strong anchor for a
// DFlash/DSpark draft is its dflash.target_layers array: in the real files it starts at 2 and ends
// at blockCount-2, which selects the correct target even when several models share an embedding
// size. An MTP head has no such anchor, so it is scored by name and reported ambiguous on a tie.
"use strict";

function tokens(text) {
    return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(function (part) { return part.length > 1; });
}

function nameScore(a, b) {
    const left = tokens(a), right = tokens(b);
    if (!left.length || !right.length) return 0;
    const seen = {};
    for (let i = 0; i < left.length; i++) seen[left[i]] = true;
    let shared = 0;
    for (let i = 0; i < right.length; i++) if (seen[right[i]]) shared++;
    return Math.min(9, shared);
}

// Both signals must agree to dominate. The metadata name is the release's own label but is
// often generic - the gemma-4 quantizations all ship "Base_Model" - while the file name always
// carries the release tokens and is the only thing that knows which head shipped next to which
// model. Summing keeps a crafted metadata name decisive on its own and lets the file names
// break the generic-name ties; the per-side cap keeps the sum below the anchor tiers.
function pairNameScore(a, b) {
    return nameScore(a.name, b.name) + nameScore(a.id, b.id);
}

function scoreDraftTarget(draft, target) {
    if (!draft || !target || draft.kind !== "draft" || target.kind !== "model") return null;
    if (!draft.embeddingLength || !target.embeddingLength) return null;
    if (draft.embeddingLength !== target.embeddingLength) return null;
    const layers = draft.targetLayers;
    if (Array.isArray(layers) && layers.length && target.blockCount) {
        for (let i = 1; i < layers.length; i++) if (layers[i] <= layers[i - 1]) return null;
        if (layers[0] < 0 || layers[layers.length - 1] > target.blockCount - 1) return null;
        const exact = layers[0] === 2 && layers[layers.length - 1] === target.blockCount - 2;
        return (exact ? 900 : 500) + nameScore(draft.name, target.name);
    }
    return 100 + nameScore(draft.name, target.name);
}

function scoreMtpTarget(head, target, options) {
    if (!head || !target || head.kind !== "mtp-head" || target.kind !== "model") return null;
    // A model that already carries its own MTP head is its own spec source and is not paired
    // automatically: doing so would starve a sibling model that has no head of its own. The manual
    // picker passes allowEmbeddedHead to offer the choice anyway, because a user may prefer an
    // external head (for example a trimmed-vocabulary sidecar).
    if (target.mtpCapable && !(options && options.allowEmbeddedHead === true)) return null;
    if (!head.arch || !target.arch) return null;
    // An assistant head declares its own "<family>-assistant" architecture and its own, smaller
    // embedding (the gemma-4 head: 1024 against the model's 3840), so it matches on the family
    // alone. A head that shares the model's architecture must still agree on the embedding
    // length, which is what rejects a mismatched sibling model.
    const headIsAssistant = /-assistant$/.test(head.arch) && head.arch !== target.arch;
    if (headIsAssistant) {
        if (head.arch.slice(0, head.arch.length - "-assistant".length) !== target.arch) return null;
    } else if (head.arch !== target.arch || !head.embeddingLength || head.embeddingLength !== target.embeddingLength) {
        return null;
    }
    return 100 + pairNameScore(head, target);
}

function scoreProjectorTarget(projector, target, modelCount) {
    if (!projector || !target || projector.kind !== "projector" || target.kind !== "model") return null;
    if (projector.basename && target.basename && projector.basename === target.basename) return 900;
    if (modelCount === 1) return 500;
    // Most quantized projectors declare no general.basename at all (the gemma-4 vision head
    // ships without one), and the flat score below used to tie every model in the folder, so
    // the projector landed on an arbitrary one and every other model showed "none detected".
    // The file names carry the release tokens, so a projector shipped next to its model
    // outranks the rest - and a projector sharing no release token with a model has no
    // evidence at all and must not claim it (a gemma vision head has no business on a qwen
    // model however few models the folder holds).
    const shared = pairNameScore(projector, target);
    return shared > 0 ? 100 + shared : null;
}

// Assign one side (draft or projector) per target. Each side claims only its own
// best-scoring target - a torn side claims the first of its tied tops and is flagged - so a
// draft whose layer anchor fits two models still belongs to the exact match and a decoy stays
// unclaimed. Several sides may claim the SAME target (a base model's head and a finetune's
// head can both top the finetune); the target keeps the side that scored highest FOR IT, so
// the winner no longer depends on readdirSync order. `candidates` lists the claiming side
// file ids best-first; `ambiguous` flags either kind of tie.
function assignWinners(contests, byTarget, slot) {
    const claimers = {};
    for (let c = 0; c < contests.length; c++) {
        const ranked = contests[c].ranked.slice().sort(function (a, b) {
            return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        });
        if (!ranked.length) continue;
        const torn = ranked.length > 1 && ranked[1].score === ranked[0].score;
        if (!claimers[ranked[0].id]) claimers[ranked[0].id] = [];
        claimers[ranked[0].id].push({ side: contests[c].side, score: ranked[0].score, ambiguous: torn });
    }
    const targetIds = Object.keys(claimers);
    for (let k = 0; k < targetIds.length; k++) {
        const hopefuls = claimers[targetIds[k]];
        hopefuls.sort(function (a, b) {
            return b.score - a.score || (a.side.id < b.side.id ? -1 : a.side.id > b.side.id ? 1 : 0);
        });
        const ties = hopefuls.filter(function (h) { return h.score === hopefuls[0].score; });
        const winner = {
            id: hopefuls[0].side.id,
            candidates: hopefuls.map(function (h) { return h.side.id; }),
            ambiguous: ties.length > 1 || hopefuls[0].ambiguous
        };
        if (slot === "draft") winner.specType = hopefuls[0].side.specType;
        byTarget[targetIds[k]][slot] = winner;
    }
}

function associate(infos) {
    const list = (infos || []).filter(Boolean);
    const models = list.filter(function (i) { return i.kind === "model"; });
    const drafts = list.filter(function (i) { return i.kind === "draft" || i.kind === "mtp-head"; });
    const projectors = list.filter(function (i) { return i.kind === "projector"; });
    const byTarget = {};
    for (let i = 0; i < models.length; i++) byTarget[models[i].id] = { draft: null, mmproj: null };

    const draftContests = [];
    for (let d = 0; d < drafts.length; d++) {
        const ranked = [];
        for (let t = 0; t < models.length; t++) {
            const score = drafts[d].kind === "draft"
                ? scoreDraftTarget(drafts[d], models[t])
                : scoreMtpTarget(drafts[d], models[t]);
            if (score !== null) ranked.push({ id: models[t].id, score: score });
        }
        draftContests.push({ side: drafts[d], ranked: ranked });
    }
    assignWinners(draftContests, byTarget, "draft");

    const projectorContests = [];
    for (let p = 0; p < projectors.length; p++) {
        const ranked = [];
        for (let t = 0; t < models.length; t++) {
            const score = scoreProjectorTarget(projectors[p], models[t], models.length);
            if (score !== null) ranked.push({ id: models[t].id, score: score });
        }
        projectorContests.push({ side: projectors[p], ranked: ranked });
    }
    assignWinners(projectorContests, byTarget, "mmproj");
    return { byTarget: byTarget, selectable: models, drafts: drafts, projectors: projectors };
}

module.exports = { nameScore, scoreDraftTarget, scoreMtpTarget, scoreProjectorTarget, associate };
