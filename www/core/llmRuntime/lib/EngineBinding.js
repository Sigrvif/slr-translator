// www/core/llmRuntime/lib/EngineBinding.js
"use strict";

function bindEngine(wrapper, opts) {
    const options = opts || {};
    if (!wrapper || typeof wrapper.getEngine !== "function") {
        throw new Error("bindEngine needs an engine wrapper with getEngine()");
    }
    if (!wrapper.optionApiUrl || typeof wrapper.optionApiUrl.setValue !== "function") {
        throw new Error("bindEngine needs wrapper.optionApiUrl with setValue()");
    }
    wrapper.optionApiUrl.setValue(options.apiUrl);
    const engine = wrapper.getEngine();
    if (!engine || typeof engine.update !== "function") {
        throw new Error("bindEngine needs a wrapper whose getEngine() has update()");
    }
    engine.update("apiUrl", options.apiUrl);
    const modelId = options.modelId === undefined ? null : options.modelId;
    if (modelId) {
        if (wrapper.optionModel && typeof wrapper.optionModel.setValue === "function") {
            wrapper.optionModel.setValue(modelId);
        }
        engine.update("model", modelId);
    }
    return { apiUrl: options.apiUrl, modelId };
}

module.exports = { bindEngine };
