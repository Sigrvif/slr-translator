// www/core/SLRtrans/lib/TranslationEngine/RoleBinding.js
//
// Maps a DSLR role to the two engine options that point it at a model: the model name and the API
// URL. Kept pure so the role table is testable without an engine instance.
"use strict";

const ROLES = Object.freeze({
    main: Object.freeze({ model: "model", url: "apiUrl" }),
    fallback: Object.freeze({ model: "model2", url: "apiUrl2" }),
    glossary: Object.freeze({ model: "glossaryModel", url: "glossaryApiUrl" }),
    review: Object.freeze({ model: "reviewModel", url: "reviewApiUrl" })
});

function hasRole(role) {
    return Object.prototype.hasOwnProperty.call(ROLES, role);
}
function roleModelOption(role) {
    if (!hasRole(role)) throw new Error("unknown role: " + role);
    return ROLES[role].model;
}
function roleUrlOption(role) {
    if (!hasRole(role)) throw new Error("unknown role: " + role);
    return ROLES[role].url;
}
function localUrl(port) {
    return "http://127.0.0.1:" + String(port) + "/v1/chat/completions";
}
function bindingsFor(role, modelId, port) {
    return [
        { id: roleModelOption(role), value: String(modelId) },
        { id: roleUrlOption(role), value: localUrl(port) }
    ];
}

module.exports = { ROLES, roleModelOption, roleUrlOption, localUrl, bindingsFor };
