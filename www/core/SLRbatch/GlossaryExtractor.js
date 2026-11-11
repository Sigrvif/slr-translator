"use strict";

window.SLRGlossary = null;
window.SLRGlossaryText = "";

function _glossaryLogCollapsed(title, content) {
    console.groupCollapsed("[DSLRGlossary] " + title);
    console.log(typeof content === 'object' ? JSON.stringify(content, null, 2) : content);
    console.groupEnd();
}

function _glossaryErrorCollapsed(title, content) {
    console.groupCollapsed("%c[DSLRGlossary] " + title, 'color: #ff7b7b; background: #290000; font-weight: bold; padding: 2px 6px;');
    console.error(typeof content === 'object' ? JSON.stringify(content, null, 2) : content);
    console.groupEnd();
}

// Assistant text of a chat-shaped result, for logging what a model had
// generated when a repetition kill cut the stream short. Uses the shared
// helper when present, falls back to an inline read so the log never throws.
function _chatContentOf(result) {
    try {
        if (window.ResponsesApiHelpers && window.ResponsesApiHelpers.chatContentOf) {
            return window.ResponsesApiHelpers.chatContentOf(result);
        }
        var choice = result && result.choices && result.choices[0];
        var msg = choice && choice.message;
        return (msg && typeof msg.content === "string") ? msg.content : "";
    } catch (e) { return ""; }
}

class GlossaryExtractor {
    constructor() {
        this.DEFAULT_CHUNK_SIZE = 3000;
        this.DEFAULT_EXTRACTION_PROMPT = ``;
        this.MAX_SERVER_RETRIES = 10;
        this.INITIAL_RETRY_DELAY = 5000;
        this._aborted = false;
        this._abortController = null;
        this._paused = false;
    }

    abort() {
        this._aborted = true;
        this._paused = false;
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    pause() {
        this._paused = true;
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    _checkAborted() {
        if (this._paused) throw new Error("[DSLRGlossary] Paused by user");
        if (this._aborted) throw new Error("[DSLRGlossary] Aborted by user");
    }

    _checkPaused() {
        if (this._paused) throw new Error("[DSLRGlossary] Paused by user");
    }

    // Detect a raw browser abort (thrown by our own AbortController when Pause/Abort is
    // clicked while a request is in flight). _fetchWithRetry translates these, but the
    // stream-reader path (_streamGlossaryResponse / response.text()) lets the raw
    // AbortError ("The user aborted a request.") escape, which otherwise gets reported
    // as a permanent chunk failure instead of a clean user pause.
    _asUserAbort(err) {
        if (!err) return false;
        if (err.name === "AbortError") return true;
        var msg = String(err.message || "");
        return msg.indexOf("user aborted a request") !== -1 || msg.indexOf("The operation was aborted") !== -1;
    }

    // Map a raw browser abort to the proper user-facing error. Only our own Pause/Abort
    // buttons drive the AbortController, so any raw abort is a user action; default to
    // Paused (checkpoints progress, offers Resume) unless the abort flag is set.
    _toUserAbortError(err) {
        return new Error(this._aborted ? "[DSLRGlossary] Aborted by user" : "[DSLRGlossary] Paused by user");
    }

    // Pause/abort-aware sleep. Resolves early (within ~250ms) when the user pauses or
    // aborts, instead of blocking for the full backoff/retry delay. The caller's next
    // _checkAborted() then throws the Paused/Aborted error so progress gets saved. This
    // is what makes the Pause button responsive during long provider-down backoffs.
    _sleep(ms) {
        var self = this;
        return new Promise(function (resolve) {
            var poller = null;
            var timer = setTimeout(function () {
                if (poller) clearInterval(poller);
                resolve();
            }, ms);
            poller = setInterval(function () {
                if (self._paused || self._aborted) {
                    clearTimeout(timer);
                    clearInterval(poller);
                    resolve();
                }
            }, 250);
        });
    }

    _saveProgress(accumulatedGlossary, chunkIdx, totalChunks, localEntities, settings) {
        window.SLRGlossaryProgress = {
            accumulatedGlossary: accumulatedGlossary,
            processedChunks: chunkIdx + 1,
            totalChunks: totalChunks,
            localEntities: localEntities,
            settings: {
                chunkSize: settings.chunkSize || this.DEFAULT_CHUNK_SIZE,
                deduplicateLines: settings.deduplicateLines,
                stripCodesForDedup: settings.stripCodesForDedup,
                includeDialogue: settings.includeDialogue,
                includeScripts: settings.includeScripts
            },
            savedAt: new Date().toISOString()
        };
        console.log("[DSLRGlossary] Progress saved: " + (chunkIdx + 1) + "/" + totalChunks + " chunks, " + Object.keys(accumulatedGlossary).length + " terms");
    }

    static hasProgress() {
        return window.SLRGlossaryProgress && window.SLRGlossaryProgress.accumulatedGlossary && window.SLRGlossaryProgress.processedChunks < window.SLRGlossaryProgress.totalChunks;
    }

    static clearProgress() {
        window.SLRGlossaryProgress = null;
    }

    extractLocalEntities() {
        var glossary = {};
        var files = trans.getAllFiles();
        var actorNames = {};
        var sourceCol = 0;
        var disableJapanese = false;
        var engine = this._getDslrEngine();
        if (engine) {
            try { disableJapanese = !!engine.getOptions('glossaryDisableJapaneseExtraction'); } catch (e) {}
        }

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var data = trans.project.files[file].data;
            var contexts = trans.project.files[file].context;

            for (var k = 0; k < data.length; k++) {
                var row = data[k];
                var context = contexts[k];
                if (!row || !row[sourceCol]) continue;
                var sourceText = row[sourceCol];
                if (!sourceText || sourceText.trim() === "") continue;

                if (!disableJapanese) {
                    var nameplateMatches = sourceText.matchAll(/\\([NnVvIi])\[(\d+)\]/g);
                    for (var match of nameplateMatches) {
                        var placeholderType = match[1].toUpperCase();
                        var id = match[2];
                        var lookupKey = placeholderType + "[" + id + "]";
                        if (!actorNames[lookupKey]) {
                            actorNames[lookupKey] = { frequency: 0 };
                        }
                        actorNames[lookupKey].frequency++;
                    }

                    var nwMatches = sourceText.matchAll(/\\n[w]?<([^>]+)>/g);
                    for (var nwMatch of nwMatches) {
                        var name = nwMatch[1];
                        if (this._containsJapanese(name)) {
                            if (!glossary[name]) {
                                glossary[name] = { type: "nameplate", frequency: 0 };
                            }
                            glossary[name].frequency++;
                        }
                    }

                    var katakanaMatches = sourceText.matchAll(/[\u30A1-\u30F4\u30FC]{2,}/g);
                    for (var katMatch of katakanaMatches) {
                        var word = katMatch[0];
                        if (this._isCommonKatakana(word)) continue;
                        if (!glossary[word]) {
                            glossary[word] = { type: "katakana", frequency: 0 };
                        }
                        glossary[word].frequency++;
                    }

                    var quotedKanjiMatches = sourceText.matchAll(/[「『]([一-龠々〆〤ヶ][一-龠ぁ-ゔァ-ヴー々〆〤ヶ]*)[」』]/g);
                    for (var qMatch of quotedKanjiMatches) {
                        var qName = qMatch[1];
                        if (!glossary[qName]) {
                            glossary[qName] = { type: "quoted_name", frequency: 0 };
                        }
                        glossary[qName].frequency++;
                    }

                    var quotedOtherMatches = sourceText.matchAll(/[「『]([ぁ-ゔァ-ヴー]{2,})[」』]/g);
                    for (var qoMatch of quotedOtherMatches) {
                        var qoName = qoMatch[1];
                        if (!glossary[qoName]) {
                            glossary[qoName] = { type: "quoted_name", frequency: 0 };
                        }
                        glossary[qoName].frequency++;
                    }
                }
            }
        }

        var result = {};
        for (var key in glossary) {
            if (glossary[key].frequency >= 2) {
                result[key] = glossary[key];
            }
        }
        result._actorIds = actorNames;

        return result;
    }

    _containsJapanese(text) {
        return /[一-龠ぁ-ゔァ-ヴー々〆〤ヶ]/.test(text);
    }

    _isCommonKatakana(word) {
        var common = [
            "ダメージ", "メッセージ", "システム", "キャラクター", "グラフィック",
            "パラメータ", "コマンド", "セーブ", "ロード", "スタート",
            "ゲームオーバー", "レベル", "ポイント", "マジック", "スキル",
            "アイテム", "ウェポン", "アーマー", "アクセサリ", "バトル",
            "メニュー", "コンティニュー", "エクストラ", "オプション", "コンフィグ",
            "タイトル", "サウンド", "ボリューム", "ウィンドウ", "カーソル",
            "フルスクリーン", "フォント", "バージョン", "アップデート", "パーティ",
            "メンバー", "フラグ", "スイッチ", "イベント", "マップ",
            "シーン", "エリア", "ダンジョン", "フィールド", "ショップ",
            "インベントリ", "クエスト", "ミッション", "トーク", "チャプター",
            "エピソード", "フェーズ", "スペル", "キャンプ", "ポーズ",
            "ムービー", "キャンセル", "オーケー", "ノー", "イエス",
            "プラス", "マイナス", "タイプ", "モード", "フェイス",
            "カラー", "ブラック", "ホワイト", "レッド", "ブルー",
            "グリーン", "イエロー", "ピンク", "パープル", "オレンジ",
            "ゴールド", "シルバー", "ノーマル", "スペシャル", "エラー",
            "ワーニング", "セレクト", "デフォルト", "ポジション", "ベース",
            "チャージ", "リミット", "ブレイク", "ターン", "ラウンド",
            "カウント", "ボーナス", "ペナルティ", "コスト", "パワー",
            "スピード", "ヒット", "ミス", "クリティカル", "ガード",
            "プロテクト", "リカバリー", "サポート", "アタック", "ディフェンス",
            "ヒール", "エスケープ", "リセット", "コンプリート", "ゲーム",
            "プレイヤー", "エネミー", "ボス", "ユニット", "チーム",
            "リーダー", "メンバー", "パートナー", "フレンド", "ライバル"
        ];
        return common.indexOf(word) !== -1;
    }

    // The glossary options (glossaryApiUrl, glossaryModel, enableJsonFullBatch, ...)
    // live on the DSLR engine. An engine counts as DSLR only if it actually exposes
    // one of those options — either as a direct property the option form emits onto
    // it, or as a schema entry. This is required because the user's ACTIVE translator
    // can be a different engine (e.g. RedSugoi), and returning that blindly made the
    // glossary read a foreign option set and report "no API URL configured" even
    // though the DSLR defaults were perfectly valid.
    _isDslrEngine(engine) {
        if (!engine) return false;
        if (engine.glossaryApiUrl !== undefined || engine.enableJsonFullBatch !== undefined) return true;
        var schema = engine.optionsForm && engine.optionsForm.schema;
        return !!(schema && (schema.glossaryApiUrl || schema.enableJsonFullBatch));
    }

    _getDslrEngine() {
        try {
            var resolve = function (id) {
                if (!id) return null;
                if (trans.engines && trans.engines[id]) return trans.engines[id];
                if (typeof TranslatorEngine !== "undefined" && TranslatorEngine.translators && TranslatorEngine.translators[id]) return TranslatorEngine.translators[id];
                if (typeof trans.getTranslatorEngine === "function") return trans.getTranslatorEngine(id);
                return null;
            };

            // Prefer the user's active translator, but ONLY when it actually IS the
            // DSLR engine. Otherwise we'd read the wrong (glossary-less) option set.
            var activeId = null;
            try { activeId = (trans.project && trans.project.options && trans.project.options.translator) || (typeof sys !== "undefined" && sys.config && sys.config.translator) || null; } catch (e2) {}
            if (activeId) {
                var ae = resolve(activeId);
                if (this._isDslrEngine(ae)) return ae;
            }

            // Scan every registered engine and return the first one that owns the
            // glossary/full-batch options (i.e. the DSLR engine).
            var ids = [];
            if (Array.isArray(trans.translator)) ids = ids.concat(trans.translator);
            if (trans.engines) ids = ids.concat(Object.keys(trans.engines));
            if (typeof TranslatorEngine !== "undefined" && TranslatorEngine.translators) ids = ids.concat(Object.keys(TranslatorEngine.translators));
            var seen = {};
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                if (!id || seen[id]) continue;
                seen[id] = true;
                var engine = resolve(id);
                if (this._isDslrEngine(engine)) return engine;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    _getApiSettings() {
        var engine = this._getDslrEngine();
        if (!engine) {
            console.error("[DSLRGlossary] No DSLR engine found");
            return null;
        }

        // Read a DSLR glossary option from the DSLR engine found by _getDslrEngine().
        // This mirrors TranslatorEngine.getOptions' resolution (config -> defaultConfig ->
        // engine[id] -> schema.default) but treats "" as unset for string options, so an
        // empty stored value falls through to the factory default instead of reading "".
        // See www/js/Option.js (HOW THE OPTION SYSTEM WORKS, esp. §4-§6). `engine` here is
        // the INNER translator engine (it owns getOptions/optionsForm.schema); the option
        // objects themselves live on the wrapper, which is why we resolve values rather than
        // calling option.getValue() directly.
        var getOpt = function(id, fallback) {
            try {
                var val = engine ? engine[id] : undefined;
                if (val !== null && val !== undefined && val !== "") return val;
                val = engine && engine.getOptions ? engine.getOptions(id) : null;
                if (val !== null && val !== undefined && val !== "") return val;
                var schema = engine && engine.optionsForm && engine.optionsForm.schema;
                if (schema && schema[id] && schema[id].default !== undefined && schema[id].default !== "") return schema[id].default;
            } catch (e) {}
            return fallback;
        };

        var settings = {};
        settings.apiUrl = getOpt('glossaryApiUrl', '');
        settings.apiKey = getOpt('glossaryApiKey', '');
        settings.model = getOpt('glossaryModel', '');
        settings.doNotFixURL = getOpt('glossaryDoNotFixURL', false);
        settings.enableJsonSchema = getOpt('glossaryEnableJsonSchema', true);
        settings.enableJsonObject = getOpt('glossaryEnableJsonObject', false);
        settings.reasoningFormat = getOpt('glossaryReasoningFormat', 'none');
        settings.reasoningEffort = getOpt('glossaryReasoningEffort', 'low');
        settings.reasoningBudget = getOpt('glossaryReasoningBudget', null);
        settings.temperature = getOpt('glossaryTemperature', 0.0);
        settings.maxTokens = getOpt('glossaryMaxTokens', 2000);
        settings.topK = getOpt('glossaryTopK', null);
        settings.topP = getOpt('glossaryTopP', null);
        settings.minP = getOpt('glossaryMinP', null);
        settings.repeatPenalty = getOpt('glossaryRepeatPenalty', null);
        settings.repetitionPenalty = getOpt('glossaryRepetitionPenalty', null);
        settings.frequencyPenalty = getOpt('glossaryFrequencyPenalty', null);
        settings.presencePenalty = getOpt('glossaryPresencePenalty', null);
        // Same repetition-loop tier options as translation streaming (they are global
        // engine options): single characters / words & sentences / entries, each
        // independently disabled with 0.
        settings.repetitionCharLimit = 20;
        settings.repetitionLimit = 15;
        settings.repetitionEntryLimit = 4;
        try {
            if (window.ResponsesApiHelpers && window.ResponsesApiHelpers.normalizeRepetitionLimit) {
                settings.repetitionCharLimit = window.ResponsesApiHelpers.normalizeRepetitionLimit(getOpt('repetitionCharLimit', 20), 20);
                settings.repetitionLimit = window.ResponsesApiHelpers.normalizeRepetitionLimit(getOpt('repetitionLimit', 15), 15);
                settings.repetitionEntryLimit = window.ResponsesApiHelpers.normalizeRepetitionLimit(getOpt('repetitionEntryLimit', 4), 4);
            }
        } catch (e) {
            settings.repetitionCharLimit = 20;
            settings.repetitionLimit = 15;
            settings.repetitionEntryLimit = 4;
        }
        settings.disableStream = getOpt('glossaryDisableStream', false);
        settings.enableTokenProgress = getOpt('glossaryEnableTokenProgress', true);
        settings.enableStreamPreview = getOpt('glossaryEnableStreamPreview', true);
        settings.chatTemplateKwargs = getOpt('glossaryChatTemplateKwargs', '');
        settings.requestDelay = getOpt('glossaryRequestDelay', 50);
        settings.customHeaders = getOpt('glossaryCustomHeaders', '');
        settings.customParameters = getOpt('glossaryCustomParameters', '');
        // All-or-nothing endpoint fallback: a blank Glossary API URL means "use the
        // main (Endpoint 1) endpoint wholesale". Every glossary connection/sampling/
        // limits endpoint value above is then ignored and replaced by the main
        // endpoint's value. A set Glossary URL means "use ONLY the glossary values"
        // (no per-option inheritance): a blank glossary field stays blank / unsent.
        // Glossary behaviour options without a main counterpart (JSON modes, token
        // cap, chunking, prompts, filters, ...) always stay glossary-owned.
        var _glossaryUrlSet = settings.apiUrl !== undefined && settings.apiUrl !== null &&
            String(settings.apiUrl).trim() !== "";
        if (!_glossaryUrlSet) {
            settings.apiUrl = getOpt('apiUrl', '');
            settings.apiKey = getOpt('apiKey', '');
            settings.model = getOpt('model', '');
            settings.doNotFixURL = getOpt('doNotFixURL', false);
            settings.temperature = getOpt('temperature', 0.1);
            settings.maxTokens = getOpt('maxTokens', 8000);
            settings.topK = getOpt('top_k', null);
            settings.topP = getOpt('top_p', null);
            settings.minP = getOpt('min_p', null);
            settings.repeatPenalty = getOpt('repeat_penalty', null);
            settings.repetitionPenalty = getOpt('repetition_penalty', null);
            settings.frequencyPenalty = getOpt('frequency_penalty', null);
            settings.presencePenalty = getOpt('presence_penalty', null);
            settings.disableStream = getOpt('disableStream', false);
            settings.enableTokenProgress = getOpt('enableTokenProgress', true);
            settings.enableStreamPreview = getOpt('enableStreamPreview', true);
            settings.chatTemplateKwargs = getOpt('chat_template_kwargs', '');
            settings.requestDelay = getOpt('requestDelay', 50);
            settings.customHeaders = getOpt('customHeaders', '{}');
            settings.customParameters = getOpt('customParameters', '{}');
            settings.reasoningFormat = getOpt('reasoningFormat', 'none');
            settings.reasoningEffort = getOpt('reasoningEffort', 'low');
            settings.reasoningBudget = getOpt('reasoningBudget', null);
        }
        settings.maxConcurrent = getOpt('glossaryMaxConcurrent', 1);
        settings.chunkSize = getOpt('glossaryChunkSize', this.DEFAULT_CHUNK_SIZE);
        settings.deduplicateLines = getOpt('glossaryDeduplicateLines', true);
        settings.stripCodesForDedup = getOpt('glossaryStripCodesForDedup', true);
        settings.extractionUserPrompt = getOpt('glossaryExtractionUserPrompt', this.DEFAULT_EXTRACTION_PROMPT);
        settings.glossaryExtractionJSONinstruction = getOpt('glossaryExtractionJSONinstruction', '');
        settings.extractionSystemPrompt = getOpt('glossaryExtractionSystemPrompt', '');
        settings.glossaryExtractionGlossaryText = getOpt('glossaryExtractionGlossaryText', '');
        settings.glossaryExtractionAccumulatedGlossary = getOpt('glossaryExtractionAccumulatedGlossary', '');
        settings.glossaryTokenCap = getOpt('glossaryTokenCap', 8000);
        // Glossary Context Length Limit. A set Glossary API URL means the
        // glossary's own limit applies; a blank one means "same backend as
        // main", so the main endpoint's Context Length Limit applies instead.
        // 0/disabled keeps every accumulated term (today's behaviour).
        settings.maxContextLength = _glossaryUrlSet
            ? getOpt('glossaryMaxContextLength', 0)
            : getOpt('maxContextLength', 0);
        settings.filterAccumulatedByChunk = getOpt('glossaryFilterAccumulatedByChunk', true);
        settings.includeDialogue = getOpt('glossaryIncludeDialogue', true);
        settings.includeScripts = getOpt('glossaryIncludeScripts', false);

        if (!settings.apiUrl || String(settings.apiUrl).trim() === "") {
            console.error("[DSLRGlossary] No API URL available");
            return null;
        }

        return settings;
    }

    // Read one DSLR command-replacer value (e.g. 'nameCommandReplacer' -> "{PERSON$1}") from
    // the DSLR engine. Uses the same config -> getOptions -> schema-default resolution as
    // _getApiSettings, so it works whether _getDslrEngine returns the wrapper or the inner
    // engine. Returns "" when nothing is configured.
    _getDslrReplacer(id) {
        var engine = this._getDslrEngine();
        if (!engine) return "";
        try {
            var val = engine[id];
            if (val !== null && val !== undefined && val !== "") return String(val);
            if (typeof engine.getOptions === "function") {
                val = engine.getOptions(id);
                if (val !== null && val !== undefined && val !== "") return String(val);
            }
            var schema = engine.optionsForm && engine.optionsForm.schema;
            if (schema && schema[id] && schema[id].default !== undefined && schema[id].default !== "") return String(schema[id].default);
        } catch (e) {}
        return "";
    }

    // Forward replacement: turn raw RPG Maker control codes (\N[1], \nw[1], \i[1], \v[1],
    // \C[1], @1) into the LLM-safe tokens the user configured on the DSLR engine
    // (e.g. {PERSON1}, {NAME1}, {I1}, {V1}, {C1}, {%1}). Mirrors DSLR's _applyDSLRReplacers
    // EXACTLY (same regexes, same order) so the glossary sends the SAME tokens the
    // translation engine does. Many models corrupt raw "\n[1]" (reading it as a line break),
    // so every game string must be converted before it reaches the LLM.
    _applyDslrReplacers(text) {
        if (!text) return text;
        var result = String(text);
        var nRep = this._getDslrReplacer('nameCommandReplacer');
        if (nRep) result = result.replaceAll(/\\n\[(\d+)\]/gi, nRep);
        var nwRep = this._getDslrReplacer('characterCommandReplacer');
        if (nwRep) result = result.replaceAll(/\\nw\[(\d+)\]/gi, nwRep);
        var iRep = this._getDslrReplacer('imageCommandReplacer');
        if (iRep) result = result.replaceAll(/\\i\[(\d+)\]/gi, iRep);
        var vRep = this._getDslrReplacer('variableCommandReplacer');
        if (vRep) result = result.replaceAll(/\\v\[(\d+)\]/gi, vRep);
        var cRep = this._getDslrReplacer('colorCommandReplacer');
        if (cRep) result = result.replaceAll(/\\c\[(\d+)\]/gi, cRep);
        var pRep = this._getDslrReplacer('placeholderReplacer');
        if (pRep) result = result.replaceAll(/@(\d+)/gi, pRep);
        return result;
    }

    // Reverse of _applyDslrReplacers: turn the LLM-safe tokens back into raw RPG Maker
    // control codes so the glossary menu / stored glossary shows the ORIGINAL form. The
    // tokens are user-configurable and not permanent, so they must never be persisted.
    // Mirrors DSLR's restore-regex construction exactly. The case-insensitive forward apply
    // loses the original letter case, so restored codes use the uppercase canonical form
    // (\N, \NW, \I, \V, \C) that local entity extraction already normalises to — matching
    // DSLR's own lossy restore path.
    _restoreDslrReplacers(text) {
        if (!text) return text;
        var self = this;
        var buildRestoreRegex = function (repValue) {
            var esc = String(repValue).replaceAll(/\\/g, "\\\\")
                .replaceAll(/\[/g, "\\[").replaceAll(/\]/g, "\\]")
                .replaceAll(/\(/g, "\\(").replaceAll(/\)/g, "\\)")
                .replaceAll(/\//g, "\\\/");
            esc = esc.replaceAll(/\$1/g, "(\\d+)");
            return new RegExp(esc, 'gi');
        };
        var result = String(text);
        var restore = function (id, target) {
            var rep = self._getDslrReplacer(id);
            if (!rep) return;
            try { result = result.replaceAll(buildRestoreRegex(rep), target); } catch (e) {}
        };
        restore('nameCommandReplacer', "\\N[$1]");
        restore('characterCommandReplacer', "\\NW[$1]");
        restore('imageCommandReplacer', "\\I[$1]");
        restore('variableCommandReplacer', "\\V[$1]");
        restore('colorCommandReplacer', "\\C[$1]");
        restore('placeholderReplacer', "@$1");
        return result;
    }

    _setGlossaryEnableThinking(body, value) {
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
    _applyGlossaryReasoningParams(body, settings) {
        if (!body || typeof body !== "object") return;
        var fmt = settings.reasoningFormat || "none";
        var eff = settings.reasoningEffort || "low";
        var tierBudget = ({ minimal: 256, low: 1024, medium: 4096, high: 16384, max: 65536 })[eff];
        if (tierBudget === undefined) tierBudget = 1024;
        // An explicit reasoning format supersedes a previously applied thinking-disable
        // (reasoning_effort:"none"), so drop the stale "none" before applying the format.
        if (fmt !== "none" && body.reasoning_effort === "none") delete body.reasoning_effort;
        var rb = settings.reasoningBudget;
        var budget = (rb !== null && rb !== undefined && rb !== "" && Number(rb) > 0) ? Number(rb) : tierBudget;
        if (fmt === "openai_effort") {
            body.reasoning_effort = eff;
        } else if (fmt === "thinking_object") {
            if (body.max_tokens !== undefined && body.max_tokens !== null && Number(budget) >= Number(body.max_tokens)) {
                body.max_tokens = budget + 1024;
            }
            body.thinking = { type: "enabled", budget_tokens: budget };
        } else if (fmt === "gemini") {
            if (!body.generationConfig || typeof body.generationConfig !== "object") body.generationConfig = {};
            if (!body.generationConfig.thinkingConfig || typeof body.generationConfig.thinkingConfig !== "object") body.generationConfig.thinkingConfig = {};
            body.generationConfig.thinkingConfig.thinkingBudget = budget;
        } else if (fmt === "qwen") {
            this._setGlossaryEnableThinking(body, true);
        }
        // "Not enabled" is hands-off: no reasoning asked for and no disable parameter sent.
        if (fmt === "not_enabled") return;
        if (fmt === "none") this._applyGlossaryThinkingDisable(body, settings);
    }
    // Turn thinking off using whatever mechanism the endpoint understands, mirroring
    // DSLREngine._applyThinkingDisable. Nothing is sent when no mechanism is known, so an
    // unrecognised provider is never handed a field it may reject.
    _applyGlossaryThinkingDisable(body, settings) {
        var apiUrl = String((settings && settings.apiUrl) || "");
        var model = String((settings && settings.model) || "");
        var isDeepSeekApi = /deepseek/i.test(apiUrl);
        var isResponsesApiUrl = !!(window.ResponsesApiHelpers && window.ResponsesApiHelpers.isResponsesApiUrl(apiUrl));
        var isV4 = apiUrl.match(/\/v4\//i) != null || isResponsesApiUrl || isDeepSeekApi;
        var isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(apiUrl);
        var isQwen = /^qwen/i.test(model);
        if (isV4) {
            body.thinking = { type: "disabled" };
            // Ollama/OpenAI-style endpoints ignore the thinking object and need
            // reasoning_effort:"none" instead; DeepSeek only accepts its documented enum.
            if (!isDeepSeekApi && !isResponsesApiUrl) {
                body.reasoning_effort = "none";
            }
        }
        if (isLocal || isQwen) {
            this._setGlossaryEnableThinking(body, false);
            // LM Studio ignores chat_template_kwargs, so also use the Qwen3 /no_think soft switch.
            if (isQwen && Array.isArray(body.messages) && body.messages[0] && body.messages[0].role === "system" && typeof body.messages[0].content === "string" && !/(^|\s)\/no_think\s*$/.test(body.messages[0].content)) {
                body.messages[0].content = body.messages[0].content.replace(/\s+$/, "") + "\n/no_think";
            }
        }
    }
    _fixApiUrl(url, doNotFix) {
        if (!url) return url;
        if (doNotFix) return url;
        if (url.match(/http/gi) == null) {
            url = url.replaceAll(/^h?t?t?p?s?:?\/?\/?(.+)/gi, "https://$1");
        }
        // Responses API endpoint (/responses) is valid as-is; do not append chat/completions.
        if (url.match(/\/responses(?:\/|\?|#|$)/i) != null) return url;
        if (url.match(/\/v\d\/?c?h?a?t?\/?c?o?m?p?l?e?t?i?o?n?s?\/?$/gi) != null && url.match(/\/v\d\/chat\/completions$|\/v\d\/message$|\/message$/gi) == null) {
            url = url.replaceAll(/\/(v\d)\/?c?h?a?t?\/?c?o?m?p?l?e?t?i?o?n?s?\/?$/gi, "/$1/chat/completions");
        } else if (url.match(/\/v\d\/chat\/completions$/gi) == null) {
            if (url.match(/\/$/g) == null) {
                url = url + "/";
            }
            url = url.replaceAll(/(.+)\/$/gi, "$1/v1/chat/completions");
        }
        return url;
    }

    buildTextChunks(chunkSize, deduplicateLines, stripCodesForDedup, includeDialogue, includeScripts) {
        var DIALOGUE_TAGS = { 'gray': true, 'purple': true, 'mediumpurple': true, 'indigo': true };
        var SCRIPT_TAGS = { 'green': true, 'white': true, 'yellow': true, 'gold': true };

        var files = trans.getAllFiles();
        var seenNormalized = {};
        var sourceCol = 0;
        var totalLines = 0;
        var deduplicatedLines = 0;
        var skippedByTag = 0;

        // Scene-ordered chunking: order kept rows by their scene's narrative order (then
        // by order within the scene) so each chunk is a coherent run of dialogue instead of
        // raw file/list order. This is a SECONDARY ordering only — the proper-noun-first
        // bucketing below is preserved, so high-yield name lines still lead; within each
        // bucket the lines are just arranged by scene. When the Scene Graph is unavailable
        // (or a row has no scene) the sort key falls back to file/row order, i.e. the
        // previous behaviour, so this is strictly optional and never worse than before.
        var sceneRank = null;
        try {
            if (typeof SceneGraph !== 'undefined' && SceneGraph.isAvailable && SceneGraph.isAvailable() && typeof SceneGraph.getAllScenes === 'function') {
                var allScenes = SceneGraph.getAllScenes() || [];
                sceneRank = {};
                for (var sri = 0; sri < allScenes.length; sri++) {
                    if (allScenes[sri] && allScenes[sri].id) sceneRank[allScenes[sri].id] = sri;
                }
            }
        } catch (e) { sceneRank = null; }
        var NO_SCENE_RANK = 0x7fffffff;

        // Collect records carrying a 5-tuple sort key instead of bare strings, so we can
        // sort by scene without losing the text. Key:
        //   [ hasScene(0|1), sceneRank, orderInScene, fileIdx, rowIdx ]
        // Scene rows (0) come first ordered by global scene order then in-scene order;
        // scene-less rows (1) follow in file/row order. With no Scene Graph every row is
        // (1, NO_SCENE_RANK, 0, fileIdx, rowIdx) -> pure file/row order (unchanged).
        var priorityRecords = [];
        var normalRecords = [];

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var fileObj = trans.project.files[file];
            var data = fileObj.data;
            var fileTags = fileObj.tags || [];
            for (var k = 0; k < data.length; k++) {
                var row = data[k];
                if (!row || !row[sourceCol]) continue;
                var text = row[sourceCol];
                if (!text || text.trim() === "") continue;

                var rowTags = fileTags[k];
                if (rowTags && Array.isArray(rowTags) && rowTags.length > 0) {
                    var hasDialogue = false;
                    var hasScript = false;
                    for (var ti = 0; ti < rowTags.length; ti++) {
                        if (DIALOGUE_TAGS[rowTags[ti]]) hasDialogue = true;
                        if (SCRIPT_TAGS[rowTags[ti]]) hasScript = true;
                    }
                    if (!hasDialogue && !hasScript) {
                        skippedByTag++;
                        continue;
                    }
                    if (hasDialogue && !includeDialogue) {
                        skippedByTag++;
                        continue;
                    }
                    if (hasScript && !includeScripts && !hasDialogue) {
                        skippedByTag++;
                        continue;
                    }
                }

                var trimmed = text.trim();
                if (!this._containsJapanese(trimmed)) continue;

                var normalized = trimmed.replace(/\\[A-Za-z]+\[\d+\]/g, '').replace(/\\[A-Za-z]+/g, '').replace(/<[^>]+>/g, '').trim();
                if (!normalized || normalized.length < 2) continue;

                totalLines++;

                if (deduplicateLines !== false) {
                    var dedupKey = (stripCodesForDedup !== false) ? normalized : trimmed;
                    if (seenNormalized[dedupKey]) continue;
                    seenNormalized[dedupKey] = true;
                }

                deduplicatedLines++;

                var hasScene = 1, sRank = NO_SCENE_RANK, oInScene = 0;
                if (sceneRank) {
                    try {
                        var sinfo = SceneGraph.getRowSceneInfo(file, k);
                        if (sinfo && sinfo.sceneId && sceneRank[sinfo.sceneId] !== undefined) {
                            hasScene = 0;
                            sRank = sceneRank[sinfo.sceneId];
                            oInScene = (typeof sinfo.orderInScene === "number") ? sinfo.orderInScene : 0;
                        }
                    } catch (e2) { /* no scene -> tail, file order */ }
                }

                var rec = { text: trimmed, k: [hasScene, sRank, oInScene, i, k] };
                if (this._isLikelyProperNounLine(normalized)) {
                    priorityRecords.push(rec);
                } else {
                    normalRecords.push(rec);
                }
            }
        }

        this._lastChunkStats = { total: totalLines, deduplicated: deduplicatedLines, removed: totalLines - deduplicatedLines, skippedByTag: skippedByTag };

        var cmpRecords = function (a, b) {
            var ka = a.k, kb = b.k;
            for (var c = 0; c < 5; c++) {
                if (ka[c] !== kb[c]) return ka[c] < kb[c] ? -1 : 1;
            }
            return 0;
        };
        priorityRecords.sort(cmpRecords);
        normalRecords.sort(cmpRecords);

        var allTexts = [];
        for (var pi = 0; pi < priorityRecords.length; pi++) allTexts.push(priorityRecords[pi].text);
        for (var ni = 0; ni < normalRecords.length; ni++) allTexts.push(normalRecords[ni].text);

        var chunks = [];
        var currentChunk = "";
        for (var ci = 0; ci < allTexts.length; ci++) {
            if (currentChunk.length + allTexts[ci].length + 1 > chunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = "";
            }
            currentChunk += allTexts[ci] + "\n";
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    _isLikelyProperNounLine(text) {
        if (/\\[Nn]\[\d+\]/.test(text)) return true;

        var katakanaRuns = text.match(/[ァ-ヴー]{2,}/g);
        if (katakanaRuns) {
            for (var i = 0; i < katakanaRuns.length; i++) {
                if (!this._isCommonKatakana(katakanaRuns[i])) return true;
            }
        }

        if (/^[\s\n]*[一-龠々〆〤ヶ][一-龠ぁ-ゔァ-ヴー々〆〤ヶ]{0,4}[\s\n]*$/.test(text)) return true;

        var quotedMatches = text.match(/[「『][一-龠ぁ-ゔァ-ヴー々〆〤ヶ]{2,}[」』]/g);
        if (quotedMatches && quotedMatches.length > 0) return true;

        return false;
    }

    _isTemplateString(text) {
        if (/%\d+/.test(text)) return true;
        if (/\\[Vv]\[\d+\]/.test(text)) return true;
        if (/\\[Xx]\[\d+\]/.test(text)) return true;
        if (text.length > 30) return true;
        return false;
    }

    // An LLM "english" that offers alternatives or is not a single term is
    // unusable for a glossary (and would make the missing-term check reject
    // correct translations). Such terms are dropped entirely at extraction.
    // Keep this predicate in sync with isUnusableEnglish in
    // SLRtrans/lib/TranslationEngine/glossaryCheck.js, which guards the check.
    _isUnusableGlossaryEnglish(english) {
        var e = String(english == null ? "" : english).trim();
        if (!e) return false;
        if (/[\/\\|｜／]/.test(e)) return true;              // option separators
        if (/[\(\)\[\]（）]/.test(e)) return true;           // parenthetical options
        if (/\bor\b/i.test(e)) return true;                  // "charm or talisman"
        if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(e)) return true; // Japanese left in
        if (e.length > 60) return true;                      // a definition, not a term
        return false;
    }

    _countTermInProject(term) {
        var count = 0;
        var files = trans.getAllFiles();
        var sourceCol = 0;
        var cleanTerm = term.replace(/\\[A-Za-z]+\[\d+\]/g, '').trim();
        if (!cleanTerm || cleanTerm.length < 2) return 1;

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var data = trans.project.files[file].data;
            for (var k = 0; k < data.length; k++) {
                var row = data[k];
                if (!row || !row[sourceCol]) continue;
                var text = row[sourceCol];
                if (!text) continue;
                var idx = 0;
                while ((idx = text.indexOf(term, idx)) !== -1) {
                    count++;
                    idx += term.length;
                }
            }
        }
        return count > 0 ? count : 1;
    }

    _readJSON(fullPath) {
        try {
            var fs = require("fs");
            return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        } catch (e) {
            return null;
        }
    }

    // Locate the game's data directory (the folder holding System.json/Actors.json for
    // MV/MZ, or the YAML folder for rmvxace). Mirrors ProjectSummary's locator so the
    // glossary can read authoritative character data directly from the game files.
    _locateGameDataDir() {
        var fs = require("fs");
        var nwPath = require("path");
        var engine = "";
        try { engine = trans.project.gameEngine; } catch (e) {}

        if (engine === "rmvxace") {
            try {
                var yamlStaging = nwPath.resolve(trans.project.cache.cachePath);
                var yamlDirs = [
                    nwPath.join(yamlStaging, "data", "YAML"),
                    nwPath.join(yamlStaging, "data", "data", "YAML")
                ];
                for (var i = 0; i < yamlDirs.length; i++) {
                    if (fs.existsSync(nwPath.join(yamlDirs[i], "System.yaml"))) {
                        return { dir: yamlDirs[i], yaml: true };
                    }
                }
            } catch (e) {}
            return null;
        }

        try {
            if (trans.project.loc) {
                var gameData = nwPath.join(trans.project.loc, "data");
                if (fs.existsSync(nwPath.join(gameData, "System.json"))) {
                    return { dir: gameData, yaml: false };
                }
            }
        } catch (e) {}

        try {
            var sp = nwPath.resolve(trans.project.cache.cachePath);
            var cands = [nwPath.join(sp, "data", "data"), nwPath.join(sp, "data")];
            for (var j = 0; j < cands.length; j++) {
                if (fs.existsSync(nwPath.join(cands[j], "System.json"))) {
                    return { dir: cands[j], yaml: false };
                }
            }
        } catch (e) {}

        try {
            if (typeof trans.getStagingDataPath === "function") {
                var sdp = trans.getStagingDataPath();
                if (sdp && fs.existsSync(nwPath.join(sdp, "System.json"))) {
                    return { dir: sdp, yaml: false };
                }
            }
        } catch (e) {}

        return null;
    }

    _cleanActorText(text) {
        if (!text) return "";
        var s = String(text);
        s = s.replace(/\\[a-z]{1,3}\[\d+\]/gi, '');   // \C[n], \V[n] etc. styling inside names
        s = s.replace(/<[^>]+>/g, '');                 // <br> / tag markup
        s = s.replace(/[ \t]{2,}/g, ' ');
        return s.trim();
    }

    // Read Actors.json (+ Classes.json for class names) and return two lookups:
    //   byIndex: actor array index -> {role, profile, name}   (matches \N[n] / \Nw[n])
    //   byName:  actor name        -> {role, profile, name}   (matches named glossary terms)
    // rmvxace (YAML) has no Actors.json in the staging dir, so it yields no profiles —
    // consistent with the old Summary behaviour.
    _readActorProfiles() {
        var dataDir = this._locateGameDataDir();
        if (!dataDir || dataDir.yaml) return null;
        var nwPath = require("path");

        var actorsRaw = this._readJSON(nwPath.join(dataDir.dir, "Actors.json"));
        if (!Array.isArray(actorsRaw)) return null;

        var classesRaw = this._readJSON(nwPath.join(dataDir.dir, "Classes.json"));
        var classes = {};
        if (Array.isArray(classesRaw)) {
            for (var ci = 0; ci < classesRaw.length; ci++) {
                if (classesRaw[ci] && classesRaw[ci].name) {
                    classes[ci] = this._cleanActorText(classesRaw[ci].name);
                }
            }
        }

        var byIndex = {};
        var byName = {};
        for (var i = 0; i < actorsRaw.length; i++) {
            var a = actorsRaw[i];
            if (!a || typeof a !== "object") continue;
            var name = this._cleanActorText(a.name);
            var role = "";
            if (a.classId && classes[a.classId]) role = classes[a.classId];
            else if (a.nickname) role = this._cleanActorText(a.nickname);
            var profile = (a.profile || "").trim();
            if (profile.length > 160) profile = profile.substring(0, 157) + "...";
            if (!role && !profile && !name) continue;
            var entry = { role: role, profile: profile, name: name };
            byIndex[String(i)] = entry;
            if (name) byName[name] = entry;
        }
        return { byIndex: byIndex, byName: byName };
    }

    // Fold each character glossary entry's authoritative role/profile (from Actors.json)
    // into a single `profile` field as a stable, idempotent string ("Role: X. Profile: Y").
    // This is the single piece of the old Project Summary that was genuinely unique
    // (authoritative character descriptions) and not already produced by the glossary.
    // `profile` is a SEPARATE field from `note` so the LLM's per-chunk note updates can
    // never overwrite it. Runs once at the end of generation (and on the seed glossary
    // before Phase 2 so the LLM sees it during extraction).
    _attachActorProfiles(glossary) {
        try {
            var profiles = this._readActorProfiles();
            if (!profiles) return;
            var byIndex = profiles.byIndex || {};
            var byName = profiles.byName || {};
            var idRe = /^\\[NnVvIi]w?\[(\d+)\]$/;
            var keys = Object.keys(glossary);
            var attached = 0;
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var entry = glossary[key];
                if (!entry) continue;
                if (entry.profile) continue; // already profiled

                var prof = null;
                var m = String(entry.japanese || key).match(idRe);
                if (m) {
                    prof = byIndex[m[1]];
                } else {
                    prof = byName[entry.japanese || key];
                }
                if (!prof || (!prof.role && !prof.profile)) continue;

                var parts = [];
                if (prof.role) parts.push("Role: " + prof.role);
                if (prof.profile) parts.push("Profile: " + prof.profile);
                entry.profile = parts.join(". ");
                if (!entry.source || entry.source === "local") {
                    entry.source = "local+llm"; // Elevate source so Phase 2 LLM sees it
                }
                attached++;
            }
            if (attached > 0) console.log("[DSLRGlossary] Attached Actors.json role/profile to " + attached + " character entries.");
        } catch (e) {
            console.warn("[DSLRGlossary] Actor profile attach failed:", e);
        }
    }

    _responseBodyIsStreamable(response) {
        try {
            if (!response || response.ok === false) return false;
            if (!response.body || typeof response.body.getReader !== 'function') return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    async _streamGlossaryResponse(response, onProgress, repetition) {
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
        // Repetition-loop guard (shared implementation from ResponsesApiHelpers).
        // Accepts a plain threshold (legacy) or the three-tier config object
        // { charLimit, wordLimit, entryLimit }; each tier is independently
        // disableable with 0. Missing helpers (engine addon absent) disable the guard.
        var repLimit = 0;
        var repCfg = null;
        var buildReason = null;
        try {
            if (window.ResponsesApiHelpers && window.ResponsesApiHelpers.resolveRepetitionConfig) {
                repCfg = window.ResponsesApiHelpers.resolveRepetitionConfig(repetition, 0);
                repLimit = repCfg.active ? 1 : 0;
            }
            if (window.ResponsesApiHelpers && window.ResponsesApiHelpers.repetitionReason) {
                buildReason = window.ResponsesApiHelpers.repetitionReason;
            }
        } catch (e) { repCfg = null; repLimit = 0; buildReason = null; }
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
                    // 'reasoning_content' is DeepSeek-style; Ollama streams the trace as 'reasoning'.
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
            if (repLimit > 0 && buildReason && !finishReason && sawDelta) {
                var repReason = buildReason(content, reasoning, repCfg);
                if (repReason) {
                    console.error("[DSLRGlossary] Excessive repetition detected in the streamed glossary response (" + repReason + "). Terminating the response early; the retry will use an increased repetition penalty.");
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
            // belongs to the aborted repetition loop anyway. The "length" finish
            // reason makes the chunk loop retry with an increased penalty.
            report();
            var loopMessage = { content: content };
            if (reasoning) loopMessage.reasoning_content = reasoning;
            return { choices: [{ index: 0, message: loopMessage, finish_reason: 'length' }], repetition_loop: true, repetition_loop_reason: repetitionReasonStr };
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
            // No streamed deltas were seen (the endpoint ignored stream:true and returned a
            // normal JSON body). Fall back to parsing the raw body so the caller is unaffected.
            var trimmed = rawAll;
            try {
                trimmed = trimmed.replaceAll(/^[^{]+({)/g, '$1').replaceAll(/(})[^}]+$/g, '$1');
                result = JSON.parse(trimmed);
            } catch (e) {
                // Trimmed body still wasn't valid JSON: hand the raw text back as content so the
                // downstream regex extractor (_parseExtractionResponse) gets a final chance.
                result = { choices: [{ index: 0, message: { content: rawAll }, finish_reason: finishReason || 'stop' }] };
            }
        }
        return result;
    }

    async _readGlossaryResponseJson(response) {
        // Some providers wrap the JSON envelope in stray text ("Sure! Here is ... {...} Done."),
        // which makes response.json() throw. Read the raw text, trim any leading non-"{" and
        // trailing non-"}" characters, then parse — matching DSLR's behaviour exactly.
        var fullText = await response.text();
        var trimmed = fullText.replaceAll(/^[^{]+({)/g, "$1").replaceAll(/(})[^}]+$/g, "$1");
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            // Still unparseable: hand the raw text back as message content so the downstream
            // regex extractor (_parseExtractionResponse) gets a final chance to pull the
            // {"terms": ...} object out of it instead of failing the whole chunk.
            _glossaryErrorCollapsed("Glossary response was not valid JSON after trimming; attempting raw-content extraction", { trimmed: trimmed, error: e.message });
            return { choices: [{ index: 0, message: { content: fullText }, finish_reason: "stop" }] };
        }
    }

    async _fetchWithRetry(apiUrl, headers, body, logCallback, errorLogCallback) {
        if (!errorLogCallback) errorLogCallback = logCallback;
        var retryDelay = this.INITIAL_RETRY_DELAY;
        for (var attempt = 0; attempt <= this.MAX_SERVER_RETRIES; attempt++) {
            this._checkAborted();
            try {
                var fetchOpts = {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify(body)
                };
                if (this._abortController) {
                    fetchOpts.signal = this._abortController.signal;
                }
                var response = await fetch(apiUrl, fetchOpts);

                if (response.ok) {
                    return response;
                }

                if (response.status === 429 || response.status === 503 || response.status === 500 || response.status === 524) {
                    if (attempt < this.MAX_SERVER_RETRIES) {
                        _glossaryErrorCollapsed("Server error " + response.status + " (retry " + (attempt + 1) + "/" + this.MAX_SERVER_RETRIES + ")", { url: apiUrl, status: response.status, statusText: response.statusText });
                        errorLogCallback("[DSLRGlossary] Server returned " + response.status + " (model may be loading). Waiting " + (retryDelay / 1000) + "s before retry " + (attempt + 1) + "/" + this.MAX_SERVER_RETRIES + "...");
                        await this._sleep(retryDelay);
                        retryDelay = retryDelay * 2;
                        continue;
                    }
                }

                _glossaryErrorCollapsed("API request failed (non-retryable)", { url: apiUrl, status: response.status, statusText: response.statusText, body: body });
                throw new Error("[DSLRGlossary] API request failed: " + response.status + " " + response.statusText);
            } catch (error) {
                if (error.name === "AbortError") {
                    if (this._paused) throw new Error("[DSLRGlossary] Paused by user");
                    throw new Error("[DSLRGlossary] Aborted by user");
                }
                if (error.message && error.message.indexOf("Paused by user") !== -1) {
                    throw error;
                }
                if (error.message && error.message.indexOf("[DSLRGlossary] API request failed") === -1 && attempt < this.MAX_SERVER_RETRIES) {
                    _glossaryErrorCollapsed("Connection error (retry " + (attempt + 1) + "/" + this.MAX_SERVER_RETRIES + ")", { url: apiUrl, error: error.message });
                    errorLogCallback("[DSLRGlossary] Connection error: " + error.message + ". Waiting " + (retryDelay / 1000) + "s before retry " + (attempt + 1) + "/" + this.MAX_SERVER_RETRIES + "...");
                    await this._sleep(retryDelay);
                    retryDelay = retryDelay * 2;
                    continue;
                }
                throw error;
            }
        }
        throw new Error("[DSLRGlossary] Max retries exceeded");
    }

    async extractChunkWithLLM(chunk, settings, logCallback, errorLogCallback, accumulatedGlossary) {
        var self = this;
        var apiUrl = this._fixApiUrl(settings.apiUrl, settings.doNotFixURL);
        var headers = {
            "Content-Type": "application/json"
        };
        if (settings.apiKey && settings.apiKey.trim() !== "") {
            headers["Authorization"] = "Bearer " + settings.apiKey;
        }
        try {
            var customHeaders = {};
            if (settings.customHeaders && settings.customHeaders.trim() !== "" && settings.customHeaders.trim() !== "{}") {
                customHeaders = JSON.parse(settings.customHeaders);
            }
            for (var hKey in customHeaders) {
                headers[hKey] = customHeaders[hKey];
            }
        } catch (e) {
            logCallback("[DSLRGlossary] Failed to parse glossary custom headers: " + e.message);
        }

        var glossaryContext = "";
        if (accumulatedGlossary && Object.keys(accumulatedGlossary).length > 0) {
            var gLines = [settings.glossaryExtractionAccumulatedGlossary];
            var gKeys = Object.keys(accumulatedGlossary);
            var chunkForFilter = settings.filterAccumulatedByChunk ? chunk.replace(/\s*SLRContextID.*?SLRContextID/g, "") : null;
            for (var gi = 0; gi < gKeys.length; gi++) {
                var gEntry = accumulatedGlossary[gKeys[gi]];
                if (!gEntry.source || gEntry.source.indexOf("llm") === -1) continue;
                if (chunkForFilter) {
                    var searchTerm = gEntry.japanese || gKeys[gi];
                    if (searchTerm && chunkForFilter.indexOf(searchTerm) === -1) continue;
                }
                var gLine = "- " + gEntry.japanese;
                if (gEntry.english) gLine += " = " + gEntry.english;
                if (gEntry.profile) gLine += " [" + gEntry.profile + "]";
                if (gEntry.type) gLine += " (" + gEntry.type + ")";
                    if (gEntry.note) gLine += " " + gEntry.note;
                    gLine = self._applyDslrReplacers(gLine);
                    gLines.push(gLine);
            }
            if (gLines.length > 1) {
                glossaryContext = gLines.join("\n") + "\n\n";
            }
        }

        var maxContentRetries = this.MAX_SERVER_RETRIES;
        var repPenaltyAddition = 0;

        var maxTok = settings.maxTokens;
        if ((settings.maxTokens + (glossaryContext.length / 4)) < settings.glossaryTokenCap) {
            maxTok = settings.maxTokens + (glossaryContext.length / 4);
        } else {
            maxTok = settings.glossaryTokenCap;
        }
        maxTok = parseInt(maxTok);
        // Glossary Context Length Limit: trim the accumulated-glossary context
        // so system + prompts + text chunk + accumulated context + response
        // reserve fit. The chunk under extraction is never trimmed.
        var _gCtxLimit = Number(settings.maxContextLength) || 0;
        if (_gCtxLimit > 0 && glossaryContext) {
            var _gFixed = ((settings.extractionSystemPrompt || "").length +
                (settings.extractionUserPrompt || "").length +
                (settings.glossaryExtractionJSONinstruction || "").length +
                String(chunk || "").length) / 4;
            var _gBudget = Math.floor(_gCtxLimit - maxTok - _gFixed);
            glossaryContext = GlossaryExtractor.fitTextToTokenBudget(glossaryContext, _gBudget);
        }
        for (var contentRetry = 0; contentRetry <= maxContentRetries; contentRetry++) {
            self._checkAborted();
            var llmChunk = self._applyDslrReplacers(chunk);
            var userContent = settings.extractionUserPrompt + glossaryContext + llmChunk + settings.glossaryExtractionJSONinstruction;
            var body = {
                model: settings.model,
                messages: [
                    {
                        role: "system",
                        content: settings.extractionSystemPrompt
                    },
                    {
                        role: "user",
                        content: userContent
                    }
                ],
                max_tokens: maxTok
            };

            if (settings.enableJsonSchema && !settings.enableJsonObject) {
                body.response_format = {
                    type: "json_schema",
                    json_schema: {
                        name: "glossary_extraction",
                        schema: {
                            type: "object",
                            properties: {
                                terms: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            japanese: { type: "string" },
                                            english: { type: "string" },
                                            type: { type: "string" },
                                            context: { type: "string" }
                                        },
                                        required: ["japanese", "english", "type", "context"],
                                        additionalProperties: false
                                    }
                                }
                            },
                            required: ["terms"],
                            additionalProperties: false
                        }
                    }
                };
            } else if (settings.enableJsonSchema && settings.enableJsonObject) {
                body.response_format = {
                    type: "json_object"
                };
            }

            if (settings.temperature !== null && settings.temperature !== undefined) {
                body.temperature = settings.temperature;
            }
            if (settings.topK !== null && settings.topK !== undefined) {
                body.top_k = settings.topK;
            }
            if (settings.topP !== null && settings.topP !== undefined) {
                body.top_p = settings.topP;
            }
            if (settings.minP !== null && settings.minP !== undefined) {
                body.min_p = settings.minP;
            }
            if (settings.repeatPenalty !== null && settings.repeatPenalty !== undefined) {
                body.repeat_penalty = settings.repeatPenalty + repPenaltyAddition;
            }
            if (settings.repetitionPenalty !== null && settings.repetitionPenalty !== undefined) {
                body.repetition_penalty = settings.repetitionPenalty + repPenaltyAddition;
            }
            if (settings.frequencyPenalty !== null && settings.frequencyPenalty !== undefined) {
                body.frequency_penalty = settings.frequencyPenalty + repPenaltyAddition;
            }
            if (settings.presencePenalty !== null && settings.presencePenalty !== undefined) {
                body.presence_penalty = settings.presencePenalty;
            }
            if (settings.disableStream === true) {
                body.stream = false;
            }
            if (settings.chatTemplateKwargs && settings.chatTemplateKwargs.trim() !== "") {
                body.chat_template_kwargs = settings.chatTemplateKwargs;
            }

            try {
                var customParams = {};
                if (settings.customParameters && settings.customParameters.trim() !== "" && settings.customParameters.trim() !== "{}") {
                    customParams = JSON.parse(settings.customParameters);
                }
                for (var pKey in customParams) {
                    if (customParams[pKey] !== null && customParams[pKey] !== undefined && customParams[pKey] !== '') {
                        body[pKey] = customParams[pKey];
                    }
                }
            } catch (e) {
                logCallback("[DSLRGlossary] Failed to parse glossary custom parameters: " + e.message);
            }

            self._applyGlossaryReasoningParams(body, settings);

            this._checkAborted();

            if (settings.requestDelay && settings.requestDelay > 0) {
                await this._sleep(settings.requestDelay);
            }
            this._checkAborted();

            var isResponsesApi = false;
            try { isResponsesApi = !!(window.ResponsesApiHelpers && window.ResponsesApiHelpers.isResponsesApiUrl(apiUrl)); } catch (e) { isResponsesApi = false; }
            var useTokenProgress = settings.enableTokenProgress !== false && settings.disableStream !== true;
            if (useTokenProgress) {
                body.stream = true;
                body.stream_options = { include_usage: true };
            }
            if (isResponsesApi) {
                body = window.ResponsesApiHelpers.toResponsesBody(body);
            }

            _glossaryLogCollapsed("Chunk Request Body", body);

            // Live token progress line (mirrors DSLR's enableTokenProgress). A dedicated <pre>
            // line is created in the loading console and its text node is updated as tokens
            // stream in, so the user can see each glossary request is alive and progressing
            // rather than appearing frozen. The line is hidden again once the response is done.
            // A second <pre> shows a live preview of the streamed response text while it is
            // still generating; it grows unbounded and is hidden together with the counter.
            var tokenProgressPre = null;
            var tokenProgressNode = null;
            var tokenProgressLast = 0;
            if (useTokenProgress) {
                try {
                    var consoleEl = window.$ ? $('#loadingOverlay .console')[0] : null;
                    if (consoleEl) {
                        tokenProgressNode = document.createTextNode('0');
                        tokenProgressPre = document.createElement('pre');
                        tokenProgressPre.style.whiteSpace = 'pre-wrap';
                        tokenProgressPre.style.color = '#66c2ff';
                        tokenProgressPre.style.fontWeight = 'bold';
                        tokenProgressPre.style.display = 'none';
                        tokenProgressPre.appendChild(document.createTextNode('[DSLRGlossary] Generating glossary response: '));
                        tokenProgressPre.appendChild(tokenProgressNode);
                        tokenProgressPre.appendChild(document.createTextNode(' tokens'));
                    }
                } catch (e) { tokenProgressPre = null; tokenProgressNode = null; }
            }
            // The stream preview is a separate toggle ('Glossary Enable Stream Preview Display');
            // the show/update/hide functions below null-guard, so the counter works without it.
            var streamTextPre = null;
            var streamTextNode = null;
            if (useTokenProgress && settings.enableStreamPreview !== false) {
                try {
                    var consoleEl2 = window.$ ? $('#loadingOverlay .console')[0] : null;
                    if (consoleEl2) {
                        streamTextNode = document.createTextNode('');
                        streamTextPre = document.createElement('pre');
                        streamTextPre.style.whiteSpace = 'pre-wrap';
                        streamTextPre.style.color = '#a8c7e0';
                        streamTextPre.style.display = 'none';
                        var streamTextLabel = document.createElement('span');
                        streamTextLabel.style.color = '#66c2ff';
                        streamTextLabel.style.fontWeight = 'bold';
                        streamTextLabel.appendChild(document.createTextNode('[DSLRGlossary] Streaming glossary response (live preview, full log in the F12 console):'));
                        streamTextPre.appendChild(streamTextLabel);
                        streamTextPre.appendChild(streamTextNode);
                    }
                } catch (e) { streamTextPre = null; streamTextNode = null; }
            }
            // Append order: preview first, counter after — the counter sits BELOW the growing
            // preview text, so the bottom-anchored loading console keeps it in view while the
            // preview grows (same counter/preview order as the DSLR engine).
            try {
                var consoleAppendEl = window.$ ? $('#loadingOverlay .console')[0] : null;
                if (consoleAppendEl) {
                    if (streamTextPre) consoleAppendEl.appendChild(streamTextPre);
                    if (tokenProgressPre) consoleAppendEl.appendChild(tokenProgressPre);
                }
            } catch (e) { /* console unavailable: the progress lines are simply not shown */ }
            var showTokenProgress = function () {
                tokenProgressLast = 0;
                if (tokenProgressNode) tokenProgressNode.nodeValue = '0';
                if (tokenProgressPre) tokenProgressPre.style.display = '';
                if (streamTextPre) {
                    if (streamTextNode) streamTextNode.nodeValue = '';
                    streamTextPre.style.display = '';
                }
            };
            var updateTokenProgress = function (tokens, streamContent, streamReasoning) {
                if (tokens == null || !tokenProgressPre || tokenProgressPre.style.display === 'none') return;
                if (tokens !== tokenProgressLast) {
                    tokenProgressLast = tokens;
                    tokenProgressNode.nodeValue = String(tokens);
                }
                if (streamTextPre && streamTextNode && streamTextPre.style.display !== 'none' && (streamContent || streamReasoning)) {
                    streamTextNode.nodeValue = '\n' + (streamReasoning ? streamReasoning + '\n' : '') + (streamContent || '');
                }
            };
            var hideTokenProgress = function () {
                if (tokenProgressPre) tokenProgressPre.style.display = 'none';
                if (streamTextPre) streamTextPre.style.display = 'none';
            };

            var result;
            try {
                var response = await this._fetchWithRetry(apiUrl, headers, body, logCallback, errorLogCallback);
                if (useTokenProgress && this._responseBodyIsStreamable(response)) {
                    showTokenProgress();
                    // All three tiers apply to glossary responses (entries are glossary terms),
                    // each independently disabled with 0.
                    result = isResponsesApi ? await window.ResponsesApiHelpers.streamResponsesCompletion(response, updateTokenProgress, { charLimit: settings.repetitionCharLimit, wordLimit: settings.repetitionLimit, entryLimit: settings.repetitionEntryLimit }) : await this._streamGlossaryResponse(response, updateTokenProgress, { charLimit: settings.repetitionCharLimit, wordLimit: settings.repetitionLimit, entryLimit: settings.repetitionEntryLimit });
                } else if (isResponsesApi) {
                    result = window.ResponsesApiHelpers.parseResponsesText(await response.text());
                } else {
                    result = await this._readGlossaryResponseJson(response);
                }
            } catch (error) {
                // A raw AbortError escapes when Pause/Abort fires while the response body is
                // streaming or being read (unlike _fetchWithRetry, the reader does not translate
                // it). Normalize it so the chunk loop takes the pause path, not the
                // "failed permanently" error path.
                if (this._asUserAbort(error)) throw this._toUserAbortError(error);
                throw error;
            } finally {
                hideTokenProgress();
            }
            _glossaryLogCollapsed("Chunk Response (normalized)", result);

            if (!result.choices || !result.choices[0]) {
                if (contentRetry < maxContentRetries) {
                    _glossaryErrorCollapsed("No choices in response (retrying)", { request: body, response: result });
                    errorLogCallback("[DSLRGlossary] No choices in response, retrying (" + (contentRetry + 1) + "/" + maxContentRetries + ")...");
                    await this._sleep(5000);
                    continue;
                }
                _glossaryErrorCollapsed("No choices in response (final)", { request: body, response: result });
                throw new Error("[DSLRGlossary] No choices in API response after " + maxContentRetries + " retries");
            }

            var choice = result.choices[0];
            var finishReason = choice.finish_reason;

            if (finishReason === "abort") {
                if (contentRetry < maxContentRetries) {
                    _glossaryErrorCollapsed("\"abort\" finish reason (retrying)", { request: body, response: result });
                    errorLogCallback("[DSLRGlossary] \"abort\" finish reason, retrying in 5s (" + (contentRetry + 1) + "/" + maxContentRetries + ")...");
                    await this._sleep(5000);
                    continue;
                }
                _glossaryErrorCollapsed("\"abort\" finish reason (final)", { request: body, response: result });
                throw new Error("[DSLRGlossary] \"abort\" finish reason persisted after " + maxContentRetries + " retries");
            }

            if (finishReason === "length") {
                // The repetition guard reports the same "length" finish reason after terminating
                // a looping response early, but that is a much more specific (and certain)
                // problem than real token exhaustion, so it gets its own unambiguous message.
                var wasRepetitionLoop = result.repetition_loop === true;
                var loopReasonText = result.repetition_loop_reason || "the same text was repeated back to back too many times";
                if (contentRetry < maxContentRetries) {
                    repPenaltyAddition += 0.05;
                    var penaltyMsg;
                    if (wasRepetitionLoop) {
                        _glossaryErrorCollapsed("Repetition loop detected (retrying, penalty +" + repPenaltyAddition.toFixed(2) + ")", { request: body, response: result });
                        _glossaryErrorCollapsed("Content generated before the repetition kill", _chatContentOf(result));
                        penaltyMsg = "[DSLRGlossary] Repetition loop detected (" + loopReasonText + "), so the response was terminated early. Increasing penalty by 0.05 and retrying in 5s (" + (contentRetry + 1) + "/" + maxContentRetries + ")...";
                        if (settings.repeatPenalty === null && settings.repetitionPenalty === null && settings.frequencyPenalty === null) {
                            penaltyMsg = "[DSLRGlossary] Repetition loop detected (" + loopReasonText + "), so the response was terminated early. Retrying in 5s (" + (contentRetry + 1) + "/" + maxContentRetries + ")... (No penalty parameter set, cannot increase)";
                        }
                    } else {
                        _glossaryErrorCollapsed("\"length\" finish reason (retrying, penalty +" + repPenaltyAddition.toFixed(2) + ")", { request: body, response: result });
                        penaltyMsg = "[DSLRGlossary] \"length\" finish reason (response cut off). Increasing penalty by 0.05 and retrying in 5s (" + (contentRetry + 1) + "/" + maxContentRetries + ")...";
                        if (settings.repeatPenalty === null && settings.repetitionPenalty === null && settings.frequencyPenalty === null) {
                            penaltyMsg = "[DSLRGlossary] \"length\" finish reason (response cut off). Retrying in 5s (" + (contentRetry + 1) + "/" + maxContentRetries + ")... (No penalty parameter set, cannot increase)";
                        }
                    }
                    errorLogCallback(penaltyMsg);
                    await this._sleep(5000);
                    continue;
                }
                if (wasRepetitionLoop) {
                    _glossaryErrorCollapsed("Repetition loop persisted (attempting partial parse)", { request: body, response: result });
                    _glossaryErrorCollapsed("Content generated before the repetition kill", _chatContentOf(result));
                    errorLogCallback("[DSLRGlossary] Repetition loop persisted after " + maxContentRetries + " retries. Attempting to parse partial response...");
                } else {
                    _glossaryErrorCollapsed("\"length\" finish reason persisted (attempting partial parse)", { request: body, response: result });
                    errorLogCallback("[DSLRGlossary] \"length\" finish reason persisted after " + maxContentRetries + " retries. Attempting to parse partial response...");
                }
            }

            var content = "";
            if (choice.message && choice.message.content) {
                content = choice.message.content;
                if (settings.model && /^qwen/i.test(String(settings.model)) && (!settings.reasoningFormat || settings.reasoningFormat === "none") && content.match(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi) != null) {
                    content = content.replaceAll(/^[\s\S]*?<think>[\s\S]*?<(?:\/|\\)think>\s*/gi, "");
                    console.log("[DSLRGlossary] Stripped a stray <think> block from a Qwen response (/no_think was sent).");
                }
            } else {
                if (contentRetry < maxContentRetries) {
                    _glossaryErrorCollapsed("Empty message content (retrying)", { request: body, response: result });
                    errorLogCallback("[DSLRGlossary] Empty message content, retrying (" + (contentRetry + 1) + "/" + maxContentRetries + ")...");
                    await this._sleep(5000);
                    continue;
                }
                _glossaryErrorCollapsed("Empty message content (final)", { request: body, response: result });
                throw new Error("[DSLRGlossary] Empty message content after " + maxContentRetries + " retries");
            }

            var parsedTerms = self._parseExtractionResponse(content);
            if (parsedTerms.length === 0 && finishReason !== "length") {
                content = content.replaceAll(/^[^{]*({[\s\S]+})[^}]*$/gi, "$1");
                content = content.replaceAll(/(?<!\\)\\(.\[\d+\])/gi, "\\\\$1");
                var jsonMatch = content.match(/\{[\s\S]*"terms"[\s\S]*\}/);
                if (!jsonMatch && contentRetry < maxContentRetries) {
                    _glossaryErrorCollapsed("No terms extracted, no JSON found (retrying)", { request: body, rawContent: content });
                    errorLogCallback("[DSLRGlossary] Response contained no extractable terms or valid JSON, retrying (" + (contentRetry + 1) + "/" + maxContentRetries + ")...");
                    await this._sleep(5000);
                    continue;
                }
            }

            for (var ri = 0; ri < parsedTerms.length; ri++) {
                var rt = parsedTerms[ri];
                if (!rt) continue;
                if (rt.japanese) rt.japanese = self._restoreDslrReplacers(rt.japanese);
                if (rt.english) rt.english = self._restoreDslrReplacers(rt.english);
                if (rt.context) rt.context = self._restoreDslrReplacers(rt.context);
            }
            // Drop terms whose translation is not a single usable rendering
            // (e.g. "Charm/talisman"): alternatives defeat the glossary and would
            // make the missing-term check reject correct translations.
            var _beforeEnglishFilter = parsedTerms.length;
            parsedTerms = parsedTerms.filter(function (t) {
                return t && !self._isUnusableGlossaryEnglish(t.english);
            });
            if (parsedTerms.length < _beforeEnglishFilter) {
                _glossaryLogCollapsed("Dropped " + (_beforeEnglishFilter - parsedTerms.length) +
                    " term(s) with an ambiguous or multi-option translation", parsedTerms);
            }
            _glossaryLogCollapsed("Chunk Extracted Terms (" + parsedTerms.length + ")", parsedTerms);
            return parsedTerms;
        }

        throw new Error("[DSLRGlossary] Max content retries exceeded");
    }

    _parseExtractionResponse(content) {
        var terms = [];
        try {
            content = content.replaceAll(/^[^{]*({[\s\S]+})[^}]*$/gi, "$1");
            content = content.replaceAll(/(?<!\\)\\(.\[\d+\])/gi, "\\\\$1");
            var jsonMatch = content.match(/\{[\s\S]*"terms"[\s\S]*\}/);
            if (jsonMatch) {
                var parsed = JSON.parse(jsonMatch[0]);
                if (parsed.terms && Array.isArray(parsed.terms)) {
                    terms = parsed.terms;
                }
            }
        } catch (e) {
            console.warn("[DSLRGlossary] Failed to parse LLM response:", e);
            var termMatches = content.matchAll(/"japanese"\s*:\s*"([^"]+)"/g);
            for (var m of termMatches) {
                terms.push({ japanese: m[1], english: "", type: "unknown", context: "" });
            }
        }
        return terms;
    }

    mergeGlossaries(localEntities, llmResults) {
        var merged = {};

        for (var key in localEntities) {
            if (key === '_actorIds') continue;
            var entry = localEntities[key];
            if (entry.frequency >= 2) {
                merged[key] = {
                    japanese: key,
                    english: "",
                    type: entry.type,
                    frequency: entry.frequency,
                    source: "local"
                };
            }
        }

        var actorIds = localEntities._actorIds || {};
        for (var aKey in actorIds) {
            var actorEntry = actorIds[aKey];
            merged["\\" + aKey] = {
                japanese: "\\" + aKey,
                english: "",
                type: "character_id",
                frequency: actorEntry.frequency,
                source: "local"
            };
        }

        for (var i = 0; i < llmResults.length; i++) {
            var terms = llmResults[i];
            for (var j = 0; j < terms.length; j++) {
                var term = terms[j];
                if (!term.japanese) continue;
                var key = term.japanese;
                if (merged[key]) {
                    merged[key].source = "local+llm";
                    if (term.type) merged[key].type = term.type;
                    if (term.context) merged[key].note = term.context;
                    if (term.english && !merged[key].english) merged[key].english = term.english;
                } else {
                    merged[key] = {
                        japanese: key,
                        english: term.english || "",
                        type: term.type || "unknown",
                        frequency: 1,
                        source: "llm",
                        note: term.context || ""
                    };
                }
            }
        }

        var filtered = {};
        for (var key in merged) {
            var entry = merged[key];
            if (this._isTemplateString(entry.japanese)) continue;
            if (entry.source === "llm" && entry.frequency <= 1 && !entry.note && !entry.english) continue;
            filtered[key] = entry;
        }

        return filtered;
    }

    _sortGlossaryKeys(glossary) {
        var typeOrder = {
            "character_id": 1,
            "female character": 2,
            "male character": 3,
            "monster": 4,
            "location": 5,
            "organization": 6,
            "item": 7,
            "skill": 8,
            "unknown": 9
        };
        return Object.keys(glossary).sort(function(a, b) {
            var typeA = typeOrder[glossary[a].type] || 99;
            var typeB = typeOrder[glossary[b].type] || 99;
            if (typeA !== typeB) return typeA - typeB;
            return (glossary[b].frequency || 0) - (glossary[a].frequency || 0);
        });
    }

    formatGlossaryText(glossary) {
        var headerText = "";
        var engine = this._getDslrEngine();
        if (engine) {
            try {
                headerText = engine.getOptions('glossaryExtractionGlossaryText') || "";
            } catch (e) {}
        }
        var lines = [headerText];
        var sortedKeys = this._sortGlossaryKeys(glossary);
        var currentType = "";

        for (var i = 0; i < sortedKeys.length; i++) {
            var key = sortedKeys[i];
            var entry = glossary[key];
            var hasEnglish = entry.english && entry.english.trim() !== "";
            var hasNote = entry.note && entry.note.trim() !== "";
            var hasProfile = entry.profile && entry.profile.trim() !== "";
            if (!hasEnglish && !hasNote && !hasProfile) continue;

            var entryType = entry.type || "unknown";
            if (entryType !== currentType) {
                currentType = entryType;
                lines.push("\n[" + currentType.toUpperCase() + "]");
            }

            var line = "- '" + entry.japanese + "'";
            if (hasEnglish) {
                line += "' = '" + entry.english + "'";
            }
            if (hasProfile) {
                line += " [" + entry.profile + "]";
            }
            if (hasNote) {
                line += " " + entry.note;
            }
            lines.push(line);
        }

        if (lines.length <= 2) return "";
        lines.push("");
        return lines.join("\n");
    }

    _getTypes() {
        var engine = this._getDslrEngine();
        if (engine) {
            try {
                var custom = engine.getOptions('glossaryCustomTypes');
                if (custom && typeof custom === "string" && custom.trim() !== "") {
                    var customTypes = custom.split(",").map(function(t) { return t.trim(); }).filter(function(t) { return t.length > 0; });
                    if (customTypes.length > 0) return customTypes;
                }
            } catch (e) {}
        }
        return ["female character", "male character", "monster", "location", "organization", "skill", "item", "character_id", "nameplate", "katakana", "quoted_name", "unknown"];
    }

    // Build and append all glossary-table cells for one row onto `tr`. Centralised so the
    // three render sites (initial table, "+ Add Term", import-rebuild) stay identical and
    // a new column never drifts between them. Inputs/selects carry `dataset.field` so
    // _readTableGlossary reads them by field name rather than fragile positional index.
    _buildRowCells(tr, entry, key) {
        entry = entry || {};
        var inputStyle = "width:100%;border:1px solid #ccc;padding:2px 4px;font-size:12px;";
        var selectStyle = "width:100%;border:1px solid #ccc;padding:2px;font-size:12px;";

        var tdJa = document.createElement("td");
        tdJa.style.cssText = "padding:3px 6px;";
        var inputJa = document.createElement("input");
        inputJa.type = "text";
        inputJa.value = entry.japanese || "";
        if (key !== undefined && key !== null) inputJa.dataset.key = key;
        inputJa.dataset.field = "japanese";
        inputJa.style.cssText = inputStyle;
        tdJa.appendChild(inputJa);
        tr.appendChild(tdJa);

        var tdEn = document.createElement("td");
        tdEn.style.cssText = "padding:3px 6px;";
        var inputEn = document.createElement("input");
        inputEn.type = "text";
        inputEn.value = entry.english || "";
        if (key !== undefined && key !== null) inputEn.dataset.key = key;
        inputEn.dataset.field = "english";
        inputEn.style.cssText = inputStyle;
        tdEn.appendChild(inputEn);
        tr.appendChild(tdEn);

        var tdType = document.createElement("td");
        tdType.style.cssText = "padding:3px 6px;";
        var selectType = document.createElement("select");
        if (key !== undefined && key !== null) selectType.dataset.key = key;
        selectType.dataset.field = "type";
        selectType.style.cssText = selectStyle;
        var types = this._getTypes();
        for (var t = 0; t < types.length; t++) {
            var opt = document.createElement("option");
            opt.value = types[t];
            opt.textContent = types[t];
            if (entry.type === types[t]) opt.selected = true;
            selectType.appendChild(opt);
        }
        tdType.appendChild(selectType);
        tr.appendChild(tdType);

        var tdSource = document.createElement("td");
        tdSource.style.cssText = "padding:3px 6px;font-size:11px;color:#666;";
        var sourceLabel = entry.source || "manual";
        if (entry.frequency && entry.frequency > 1) {
            sourceLabel += " (" + entry.frequency + "x)";
        }
        tdSource.textContent = sourceLabel;
        tr.appendChild(tdSource);

        var tdProfile = document.createElement("td");
        tdProfile.style.cssText = "padding:3px 6px;";
        var inputProfile = document.createElement("input");
        inputProfile.type = "text";
        inputProfile.value = entry.profile || "";
        if (key !== undefined && key !== null) inputProfile.dataset.key = key;
        inputProfile.dataset.field = "profile";
        inputProfile.style.cssText = inputStyle;
        inputProfile.placeholder = "Role: ... Profile: ...";
        tdProfile.appendChild(inputProfile);
        tr.appendChild(tdProfile);

        var tdNote = document.createElement("td");
        tdNote.style.cssText = "padding:3px 6px;";
        var inputNote = document.createElement("input");
        inputNote.type = "text";
        inputNote.value = entry.note || "";
        if (key !== undefined && key !== null) inputNote.dataset.key = key;
        inputNote.dataset.field = "note";
        inputNote.style.cssText = inputStyle;
        tdNote.appendChild(inputNote);
        tr.appendChild(tdNote);
    }

    _buildTableBody(glossary) {
        var tbody = document.createElement("tbody");
        var sortedKeys = this._sortGlossaryKeys(glossary);

        for (var i = 0; i < sortedKeys.length; i++) {
            var key = sortedKeys[i];
            var entry = glossary[key];
            var tr = document.createElement("tr");
            tr.style.cssText = "border-bottom:1px solid #eee;" + (i % 2 === 0 ? "background:#f9f9f9;" : "");
            this._buildRowCells(tr, entry, key);
            tbody.appendChild(tr);
        }
        return tbody;
    }

    _addNewRow(tbody) {
        var tr = document.createElement("tr");
        tr.style.cssText = "border-bottom:1px solid #eee;background:#e0ffe0;";
        this._buildRowCells(tr, { source: "manual", type: "unknown" }, null);
        tbody.appendChild(tr);
        tr.querySelector("input[data-field='japanese']").focus();
    }

    _readTableGlossary(tbody, originalGlossary) {
        var editedGlossary = {};
        var rows = tbody.querySelectorAll("tr");
        for (var r = 0; r < rows.length; r++) {
            var fields = rows[r].querySelectorAll("input[data-field], select[data-field]");
            if (fields.length < 3) continue;
            var fieldVals = {};
            for (var fi = 0; fi < fields.length; fi++) {
                var f = fields[fi];
                var fname = f.dataset.field;
                if (!fname) continue;
                fieldVals[fname] = (f.value || "").trim();
            }
            var jaValue = fieldVals.japanese || "";
            if (!jaValue) continue;
            var origKey = null;
            var jaInput = rows[r].querySelector("input[data-field='japanese']");
            if (jaInput) origKey = jaInput.dataset.key;
            var origEntry = origKey ? originalGlossary[origKey] : null;
            editedGlossary[jaValue] = {
                japanese: jaValue,
                english: fieldVals.english || "",
                type: fieldVals.type || "unknown",
                frequency: origEntry ? origEntry.frequency : 1,
                source: origEntry ? origEntry.source : "manual",
                profile: fieldVals.profile || "",
                note: fieldVals.note || ""
            };
        }
        console.log("[DSLRGlossary] _readTableGlossary: read " + Object.keys(editedGlossary).length + " terms from " + rows.length + " table rows");
        return editedGlossary;
    }

    // `notice` (optional) renders a warning bar above the table. The extraction
    // flow passes one asking the user to review/delete bad auto-generated terms;
    // the plain "edit existing glossary" path passes none.
    _buildEditWindow(glossary, onSave, onCancel, onRegenerate, notice) {
        var self = this;
        var overlay = document.createElement("div");
        var _doneFired = false;
        var _fireDone = function () {
            if (_doneFired) return;
            _doneFired = true;
            try { if (typeof self.onEditorDone === 'function') self.onEditorDone(); } catch (e) {}
        };
        // Invisible modal scrim: it still captures clicks, but no other window's
        // backdrop brightens/dims the app, so this one must not either (the old
        // rgba(170,170,170,0.3) read as a bright wash under night mode).
        overlay.className = "ui-widget-overlay ui-front";
        overlay.style.cssText = "opacity:1;background-color:transparent;z-index:9999;position:fixed;top:0;left:0;right:0;bottom:0;";

        var container = document.createElement("div");
        container.className = "slrGlossaryWindow";
        var initW = Math.min(Math.round(window.innerHeight * 16 / 9 * 0.9), window.innerWidth - 40);
        var initH = Math.min(Math.round(window.innerHeight * 0.9), window.innerHeight - 40);
        initW = Math.max(initW, 600);
        initH = Math.max(initH, 400);
        container.style.cssText = "background-color:white;width:" + initW + "px;height:" + initH + "px;min-width:600px;min-height:400px;display:flex;flex-direction:column;position:fixed;left:" + Math.max(0, Math.round((window.innerWidth - initW) / 2)) + "px;top:" + Math.max(0, Math.round((window.innerHeight - initH) / 2)) + "px;box-shadow:0 4px 24px rgba(0,0,0,0.3);";
        container.dataset.origW = initW;
        container.dataset.origH = initH;

        var header = document.createElement("div");
        // Same theme variables as the batch window's title bar, so the bar stays
        // dark under night mode instead of inverting to white.
        header.style.cssText = "background-color:var(--dialog-title-bg, black);color:var(--dialog-title-fg, white);line-height:30px;padding-left:10px;padding-right:10px;display:flex;justify-content:space-between;align-items:center;cursor:default;user-select:none;";
        var title = document.createElement("h1");
        title.style.cssText = "margin:0px;font-size:14px;";
        title.textContent = "Edit Glossary (" + Object.keys(glossary).length + " terms)";
        header.appendChild(title);
        container.appendChild(header);

        var helpText = document.createElement("div");
        helpText.style.cssText = "padding:6px 10px;background:#ffffcc;font-size:11px;border-bottom:1px solid #ccc;";
        helpText.textContent = "Edit translations and notes. To delete a term, clear its Original field. Changes saved on 'Save Glossary'.";
        container.appendChild(helpText);

        if (notice) {
            var noticeBar = document.createElement("div");
            noticeBar.style.cssText = "padding:6px 10px;background:#ffe0e0;color:#8a1f11;font-size:11px;font-weight:bold;border-bottom:1px solid #e0a0a0;";
            noticeBar.textContent = notice;
            container.appendChild(noticeBar);
        }

        var tableContainer = document.createElement("div");
        tableContainer.style.cssText = "flex:1;overflow:auto;padding:0;";

        var table = document.createElement("table");
        table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;";
        var thead = document.createElement("thead");
        thead.innerHTML = "<tr class='slrGlossaryThead' style='background:#333;color:white;position:sticky;top:0;'>" +
            "<th style='padding:4px 8px;text-align:left;width:20%;'>Original</th>" +
            "<th style='padding:4px 8px;text-align:left;width:20%;'>Translation</th>" +
            "<th style='padding:4px 8px;text-align:left;width:11%;'>Type</th>" +
            "<th style='padding:4px 8px;text-align:left;width:9%;'>Source</th>" +
            "<th style='padding:4px 8px;text-align:left;width:22%;'>Role / Profile</th>" +
            "<th style='padding:4px 8px;text-align:left;width:18%;'>Note</th>" +
            "</tr>";
        table.appendChild(thead);

        var tbody = self._buildTableBody(glossary);
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);

        var addRow = document.createElement("div");
        addRow.style.cssText = "padding:6px 10px;border-top:1px solid #ccc;background:#f0f0f0;";
        var addBtn = document.createElement("button");
        addBtn.textContent = "+ Add Term";
        addBtn.style.cssText = "padding:3px 12px;font-size:12px;cursor:pointer;";
        addBtn.addEventListener("click", function() {
            self._addNewRow(tbody);
        });
        addRow.appendChild(addBtn);
        container.appendChild(addRow);

        var buttonBar = document.createElement("div");
        buttonBar.style.cssText = "text-align:right;padding:8px 10px;border-top:1px solid #ccc;background:#f0f0f0;display:flex;justify-content:space-between;align-items:center;";

        var leftButtons = document.createElement("div");

        var exportBtn = document.createElement("button");
        exportBtn.textContent = "Export";
        exportBtn.title = "Export glossary to a JSON file for sharing or backup";
        exportBtn.style.cssText = "padding:3px 12px;font-size:12px;cursor:pointer;margin-right:4px;";
        exportBtn.addEventListener("click", function() {
            var currentGlossary = self._readTableGlossary(tbody, glossary);
            GlossaryExporter.exportToFile(currentGlossary);
        });
        leftButtons.appendChild(exportBtn);

        var importBtn = document.createElement("button");
        importBtn.textContent = "Import";
        importBtn.title = "Import glossary from a JSON file and merge with current terms";
        importBtn.style.cssText = "padding:3px 12px;font-size:12px;cursor:pointer;margin-right:4px;";
        importBtn.addEventListener("click", function() {
            GlossaryExporter.importFromFile(function(result) {
                if (!result) return;
                var currentGlossary = self._readTableGlossary(tbody, glossary);
                var merged;
                if (result.merge) {
                    merged = GlossaryExporter.mergeGlossaryObjects(currentGlossary, result.data);
                } else {
                    merged = GlossaryExporter.mergeGlossaryObjects({}, result.data);
                }
                while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
                var sortedKeys = self._sortGlossaryKeys(merged);
                for (var si = 0; si < sortedKeys.length; si++) {
                    var sk = sortedKeys[si];
                    var sentry = merged[sk];

                    var tr = document.createElement("tr");
                    tr.style.cssText = "border-bottom:1px solid #eee;background:#e0ffe0;";
                    self._buildRowCells(tr, sentry, sk);
                    tbody.appendChild(tr);
                }
                glossary = merged;
                title.textContent = "Edit Glossary (" + Object.keys(merged).length + " terms)";
            });
        });
        leftButtons.appendChild(importBtn);

        if (onRegenerate) {
            var regenBtn = document.createElement("button");
            regenBtn.textContent = "Generate New";
            regenBtn.title = "Discard current glossary and generate a new one from scratch";
            regenBtn.style.cssText = "padding:3px 12px;font-size:12px;cursor:pointer;color:#c00;margin-right:4px;";
            regenBtn.addEventListener("click", function() {
                document.body.removeChild(overlay);
                onRegenerate(null);
            });
            leftButtons.appendChild(regenBtn);

            var buildBtn = document.createElement("button");
            buildBtn.textContent = "Build From Existing";
            buildBtn.title = "Generate a new glossary using current terms as a base. The LLM will keep existing entries and add/correct based on the current project text.";
            buildBtn.style.cssText = "padding:3px 12px;font-size:12px;cursor:pointer;color:#0066cc;margin-right:4px;";
            buildBtn.addEventListener("click", function() {
                var currentGlossary = self._readTableGlossary(tbody, glossary);
                document.body.removeChild(overlay);
                onRegenerate(currentGlossary);
            });
            leftButtons.appendChild(buildBtn);

            var resumeBtn = document.createElement("button");
            resumeBtn.textContent = "Resume Generation";
            resumeBtn.title = "Resume a previously paused generation from where it left off";
            resumeBtn.style.cssText = "padding:3px 12px;font-size:12px;cursor:pointer;color:#008800;margin-right:4px;";
            if (!GlossaryExtractor.hasProgress()) {
                resumeBtn.disabled = true;
                resumeBtn.style.cssText += "opacity:0.4;cursor:default;";
            }
            resumeBtn.addEventListener("click", function() {
                var progress = window.SLRGlossaryProgress;
                if (!progress) return;
                document.body.removeChild(overlay);
                onRegenerate(progress.accumulatedGlossary, progress);
            });
            leftButtons.appendChild(resumeBtn);
        }

        buttonBar.appendChild(leftButtons);

        var rightButtons = document.createElement("div");

        var cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = "padding:4px 16px;cursor:pointer;";
        cancelBtn.addEventListener("click", function() {
            document.body.removeChild(overlay);
            if (onCancel) onCancel();
            _fireDone();
        });
        rightButtons.appendChild(cancelBtn);

        var saveBtn = document.createElement("button");
        saveBtn.textContent = "Save Glossary";
        saveBtn.style.cssText = "margin-left:8px;padding:4px 16px;cursor:pointer;font-weight:bold;";
        saveBtn.addEventListener("click", function() {
            var editedGlossary = self._readTableGlossary(tbody, glossary);
            document.body.removeChild(overlay);
            if (onSave) onSave(editedGlossary);
            _fireDone();
        });
        rightButtons.appendChild(saveBtn);

        buttonBar.appendChild(rightButtons);
        container.appendChild(buttonBar);

        var closeBtn = document.createElement("span");
        closeBtn.textContent = "\u00D7";
        closeBtn.style.cssText = "cursor:pointer;font-size:18px;padding:0 6px;user-select:none;line-height:30px;";
        closeBtn.title = "Close";
        closeBtn.addEventListener("click", function() {
            if (document.body.contains(overlay)) {
                document.body.removeChild(overlay);
                if (onCancel) onCancel();
                _fireDone();
            }
        });
        header.appendChild(closeBtn);

        var isDragging = false;
        var dragStartX = 0;
        var dragStartY = 0;
        var containerStartX = 0;
        var containerStartY = 0;

        header.addEventListener("mousedown", function(e) {
            if (e.target === closeBtn) return;
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            var rect = container.getBoundingClientRect();
            containerStartX = rect.left;
            containerStartY = rect.top;
            e.preventDefault();
        });

        document.addEventListener("mousemove", function(e) {
            if (!isDragging) return;
            var dx = e.clientX - dragStartX;
            var dy = e.clientY - dragStartY;
            var newLeft = containerStartX + dx;
            var newTop = containerStartY + dy;
            container.style.position = "fixed";
            container.style.left = newLeft + "px";
            container.style.top = newTop + "px";
            container.style.margin = "0";
        });

        document.addEventListener("mouseup", function() {
            isDragging = false;
        });

        function makeResizeHandle(edgeSet) {
            var handle = document.createElement("div");
            handle.style.cssText = "position:absolute;z-index:10;";
            var dirs = edgeSet.split("-");
            if (dirs.indexOf("right") !== -1) {
                handle.style.right = "0";
                handle.style.width = "6px";
                handle.style.top = "0";
                handle.style.bottom = "0";
                handle.style.cursor = "e-resize";
            }
            if (dirs.indexOf("bottom") !== -1) {
                handle.style.bottom = "0";
                handle.style.height = "6px";
                handle.style.left = "0";
                handle.style.right = "0";
                handle.style.cursor = "s-resize";
            }
            if (dirs.indexOf("left") !== -1) {
                handle.style.left = "0";
                handle.style.width = "6px";
                handle.style.top = "0";
                handle.style.bottom = "0";
                handle.style.cursor = "w-resize";
            }
            if (dirs.indexOf("top") !== -1) {
                handle.style.top = "0";
                handle.style.height = "6px";
                handle.style.left = "0";
                handle.style.right = "0";
                handle.style.cursor = "n-resize";
            }
            if (edgeSet === "right-bottom" || edgeSet === "bottom-right") {
                handle.style.width = "14px";
                handle.style.height = "14px";
                handle.style.right = "0";
                handle.style.bottom = "0";
                handle.style.top = "auto";
                handle.style.left = "auto";
                handle.style.cursor = "se-resize";
            }

            var resizing = false;
            var startMouseX = 0;
            var startMouseY = 0;
            var startW = 0;
            var startH = 0;
            var startLeft = 0;
            var startTop = 0;

            handle.addEventListener("mousedown", function(e) {
                e.preventDefault();
                e.stopPropagation();
                resizing = true;
                startMouseX = e.clientX;
                startMouseY = e.clientY;
                var rect = container.getBoundingClientRect();
                startW = rect.width;
                startH = rect.height;
                startLeft = rect.left;
                startTop = rect.top;
            });

            document.addEventListener("mousemove", function(e) {
                if (!resizing) return;
                var dx = e.clientX - startMouseX;
                var dy = e.clientY - startMouseY;

                var newW = startW;
                var newH = startH;
                var newLeft = startLeft;
                var newTop = startTop;

                if (dirs.indexOf("right") !== -1) {
                    newW = Math.max(600, startW + dx);
                }
                if (dirs.indexOf("bottom") !== -1) {
                    newH = Math.max(400, startH + dy);
                }
                if (dirs.indexOf("left") !== -1) {
                    var proposedW = Math.max(600, startW - dx);
                    newLeft = startLeft + (startW - proposedW);
                    newW = proposedW;
                }
                if (dirs.indexOf("top") !== -1) {
                    var proposedH = Math.max(400, startH - dy);
                    newTop = startTop + (startH - proposedH);
                    newH = proposedH;
                }

                container.style.width = newW + "px";
                container.style.height = newH + "px";
                container.style.position = "fixed";
                container.style.left = newLeft + "px";
                container.style.top = newTop + "px";
                container.style.margin = "0";
            });

            document.addEventListener("mouseup", function() {
                resizing = false;
            });

            return handle;
        }

        container.appendChild(makeResizeHandle("right"));
        container.appendChild(makeResizeHandle("bottom"));
        container.appendChild(makeResizeHandle("right-bottom"));
        container.appendChild(makeResizeHandle("left"));
        container.appendChild(makeResizeHandle("top"));

        overlay.addEventListener("mousedown", function(e) {
            if (e.target === overlay) {
                if (document.body.contains(overlay)) {
                    document.body.removeChild(overlay);
                    if (onCancel) onCancel();
                }
            }
        });

        overlay.appendChild(container);
        return overlay;
    }

    _applyGlossary(glossary) {
        if (!glossary || typeof glossary !== "object") {
            console.error("[DSLRGlossary] _applyGlossary called with invalid glossary:", glossary);
            return;
        }
        var glossaryText = this.formatGlossaryText(glossary);
        window.SLRGlossary = glossary;
        window.SLRGlossaryText = glossaryText;
        var keyCount = Object.keys(glossary).length;
        console.log("[DSLRGlossary] _applyGlossary: set window.SLRGlossary with " + keyCount + " terms. Keys sample:", Object.keys(glossary).slice(0, 3));
        console.log("[DSLRGlossary] _applyGlossary: window.SLRGlossary === glossary?", window.SLRGlossary === glossary);
    }

    openExistingEditor(logCallback, errorLogCallback) {
        var self = this;
        if (!logCallback) logCallback = function(msg) { console.log(msg); };
        if (!errorLogCallback) errorLogCallback = this._errorLogCallback || logCallback;
        var glossary = window.SLRGlossary || {};

        var editWindow = self._buildEditWindow(
            glossary,
            function onSave(editedGlossary) {
                self._applyGlossary(editedGlossary);
                var count = Object.keys(editedGlossary).length;
                logCallback("[DSLRGlossary] Glossary updated. " + count + " terms saved.");
            },
            function onCancel() {
            },
            function onRegenerate(seedGlossary, progress) {
                var progressCallback = self._progressCallback || function() {};
                var abortOnConsoleClose = function() {
                    self.abort();
                };
                ui.showLoading({
                    buttons: [
                        {
                            text: "Pause",
                            onClick: function() {
                                self.pause();
                            }
                        },
                        {
                            text: "Abort",
                            onClick: function() {
                                if (confirm("Are you sure you want to abort?")) {
                                    self.abort();
                                    ui.hideLoading();
                                }
                            }
                        }
                    ]
                });
                ui.one("loadingConsoleClosed", abortOnConsoleClose);

                if (progress) {
                    logCallback("[DSLRGlossary] Resuming generation from chunk " + (progress.processedChunks + 1) + "/" + progress.totalChunks + "...");
                    ui.loadingProgress(0, "[DSLRGlossary] Resuming generation...");
                } else if (seedGlossary && Object.keys(seedGlossary).length > 0) {
                    ui.loadingProgress(0, "[DSLRGlossary] Starting glossary generation...");
                    logCallback("[DSLRGlossary] Building from existing glossary (" + Object.keys(seedGlossary).length + " terms as seed)...");
                } else {
                    window.SLRGlossary = null;
                    window.SLRGlossaryText = "";
                    ui.loadingProgress(0, "[DSLRGlossary] Starting glossary generation...");
                    logCallback("[DSLRGlossary] Starting glossary generation...");
                }
                self._startGeneration(logCallback, errorLogCallback, seedGlossary, progress).then(function(newGlossary) {
                    ui.off("loadingConsoleClosed", abortOnConsoleClose);
                    var count = newGlossary ? Object.keys(newGlossary).length : 0;
                    logCallback("[DSLRGlossary] Generation complete. New glossary has " + count + " terms.");
                    logCallback("[DSLRGlossary] The glossary will be automatically injected into the system prompt during translation.");
                    ui.loadingProgress(100, "[DSLRGlossary] Glossary saved! " + count + " terms.");
                    ui.showCloseButton();
                }).catch(function(err) {
                    ui.off("loadingConsoleClosed", abortOnConsoleClose);
                    if (err && err.message && err.message.indexOf("Aborted by user") !== -1) {
                        logCallback("[DSLRGlossary] Generation aborted by user.");
                        return;
                    }
                    var isUserPause = err && err.message && err.message.indexOf("Paused by user") !== -1;
                    var isErrorPause = err && err.message && err.message.indexOf("Paused due to error") !== -1;
                    if (isUserPause || isErrorPause) {
                        if (isErrorPause) {
                            // An API/parse error (e.g. a non-retryable 402) stopped generation. Keep the
                            // loading console OPEN so the error stays visible — closing it and opening the
                            // editor was indistinguishable from a normal finish unless F12 was open. Surface
                            // a "Resume Generation" button so the user can retry later after fixing the cause.
                            // The user-initiated pause branch below still opens the editor as before.
                            errorLogCallback("[DSLRGlossary] Generation paused due to an error. Partial results have been saved.");
                            logCallback("[DSLRGlossary] Fix the issue (e.g. API key, URL, or credits), then click 'Resume Generation' to continue from where it stopped.");
                            self._paused = false;
                            if (window.SLRGlossaryProgress && window.SLRGlossaryProgress.accumulatedGlossary) {
                                self._applyGlossary(window.SLRGlossaryProgress.accumulatedGlossary);
                            }
                            try { $("#loadingOverlay .loadingBarProgress").addClass("error"); } catch (eCss) {}
                            ui.loadingClearButton();
                            ui.loadingProgress(100, "[DSLRGlossary] Generation paused due to an error.");
                            var resumeErrBtn = ui.LoadingAddButton("Resume Generation", function () {
                                var progress = window.SLRGlossaryProgress;
                                if (!progress) return;
                                onRegenerate(progress.accumulatedGlossary, progress);
                            });
                            if (resumeErrBtn) resumeErrBtn.css({ color: "#008800", fontWeight: "bold" });
                            ui.showCloseButton();
                            return;
                        } else {
                            logCallback("[DSLRGlossary] Generation paused. Opening editor with partial results...");
                            self._paused = false;
                            self._applyGlossary(window.SLRGlossaryProgress.accumulatedGlossary);
                            ui.hideLoading();
                            self.openExistingEditor(logCallback, errorLogCallback);
                            return;
                        }
                    }
                    errorLogCallback("[DSLRGlossary] Generation failed: " + (err ? err.message : "Unknown error"));
                    console.error("[DSLRGlossary] Generation error:", err);
                    ui.loadingProgress(100, "[DSLRGlossary] Error: " + (err ? err.message : "Unknown error"));
                    ui.showCloseButton();
                });
            }
        );
        document.body.appendChild(editWindow);
    }

    async generate(progressCallback, logCallback, errorLogCallback) {
        if (!progressCallback) progressCallback = function() {};
        if (!logCallback) logCallback = function(msg) { console.log(msg); };
        if (!errorLogCallback) errorLogCallback = logCallback;

        this._progressCallback = progressCallback;
        this._logCallback = logCallback;
        this._errorLogCallback = errorLogCallback;

        if (window.SLRGlossary && Object.keys(window.SLRGlossary).length > 0) {
            logCallback("[DSLRGlossary] Existing glossary found (" + Object.keys(window.SLRGlossary).length + " terms). Opening editor...");
            console.log("[DSLRGlossary] generate() found existing glossary. First 5 keys:", Object.keys(window.SLRGlossary).slice(0, 5));
        } else {
            logCallback("[DSLRGlossary] Opening glossary editor...");
        }

        this.openExistingEditor(logCallback, errorLogCallback);
        return window.SLRGlossary || {};
    }

    async _startGeneration(logCallback, errorLogCallback, seedGlossary, resumeProgress) {
        var self = this;
        var progressCallback = this._progressCallback || function() {};
        if (!logCallback) logCallback = this._logCallback || function(msg) { console.log(msg); };
        if (!errorLogCallback) errorLogCallback = this._errorLogCallback || logCallback;

        this._aborted = false;
        this._paused = false;
        this._abortController = new AbortController();

        var localEntities;
        var settings;
        var chunks;
        var accumulatedGlossary;
        var startChunkIdx = 0;
        var maxChunks = 0;
        var llmResults = [];

        if (resumeProgress && resumeProgress.accumulatedGlossary) {
            logCallback("[DSLRGlossary] Resuming from saved progress (" + resumeProgress.processedChunks + "/" + resumeProgress.totalChunks + " chunks done)...");
            progressCallback(0, "[DSLRGlossary] Resuming generation...");

            accumulatedGlossary = resumeProgress.accumulatedGlossary;
            startChunkIdx = resumeProgress.processedChunks;
            localEntities = resumeProgress.localEntities;

            settings = this._getApiSettings();
            if (settings) {
                var pSettings = resumeProgress.settings || {};
                chunks = this.buildTextChunks(
                    pSettings.chunkSize || settings.chunkSize || this.DEFAULT_CHUNK_SIZE,
                    pSettings.deduplicateLines !== undefined ? pSettings.deduplicateLines : settings.deduplicateLines,
                    pSettings.stripCodesForDedup !== undefined ? pSettings.stripCodesForDedup : settings.stripCodesForDedup,
                    pSettings.includeDialogue !== undefined ? pSettings.includeDialogue : settings.includeDialogue,
                    pSettings.includeScripts !== undefined ? pSettings.includeScripts : settings.includeScripts
                );
                maxChunks = chunks.length;
                logCallback("[DSLRGlossary] Rebuilt " + maxChunks + " chunks. Resuming from chunk " + (startChunkIdx + 1) + ".");
                GlossaryExtractor.clearProgress();
            } else {
                logCallback("[DSLRGlossary] No API settings available. Cannot resume.");
                return accumulatedGlossary;
            }
        } else {
            logCallback("[DSLRGlossary] Phase 1: Local entity extraction...");
            progressCallback(0, "[DSLRGlossary] Phase 1: Extracting local entities...");
            localEntities = this.extractLocalEntities();

            var localCount = 0;
            for (var key in localEntities) {
                if (key !== '_actorIds') localCount++;
            }
            var actorCount = Object.keys(localEntities._actorIds || {}).length;
            logCallback("[DSLRGlossary] Phase 1 complete: Found " + localCount + " local entities and " + actorCount + " character IDs.");

            settings = this._getApiSettings();

            if (settings) {
                logCallback("[DSLRGlossary] Phase 2: Sequential LLM extraction with accumulated glossary...");
                chunks = this.buildTextChunks(settings.chunkSize || this.DEFAULT_CHUNK_SIZE, settings.deduplicateLines, settings.stripCodesForDedup, settings.includeDialogue, settings.includeScripts);
                var totalChars = 0;
                for (var ci = 0; ci < chunks.length; ci++) totalChars += chunks[ci].length;
                var chunkStats = this._lastChunkStats || {};
                var dedupInfo = "";
                if (settings.deduplicateLines !== false && chunkStats.removed > 0) {
                    dedupInfo = " (" + chunkStats.deduplicated + "/" + chunkStats.total + " unique lines, " + chunkStats.removed + " duplicates removed)";
                }
                var tagInfo = "";
                if (chunkStats.skippedByTag > 0) {
                    tagInfo = " (" + chunkStats.skippedByTag + " rows skipped by tag filter)";
                }
                logCallback("[DSLRGlossary] Built " + chunks.length + " text chunks" + (dedupInfo ? dedupInfo : "") + (tagInfo ? tagInfo : "") + ".");
                maxChunks = chunks.length;

                accumulatedGlossary = {};
                for (var key in localEntities) {
                    if (key === '_actorIds') continue;
                    var le = localEntities[key];
                    if (le.frequency >= 2) {
                        accumulatedGlossary[key] = {
                            japanese: key,
                            english: "",
                            type: le.type,
                            frequency: le.frequency,
                            source: "local"
                        };
                    }
                }
                var actorIds = localEntities._actorIds || {};
                for (var aKey in actorIds) {
                    var actorEntry = actorIds[aKey];
                    accumulatedGlossary["\\" + aKey] = {
                        japanese: "\\" + aKey,
                        english: "",
                        type: "character_id",
                        frequency: actorEntry.frequency,
                        source: "local"
                    };
                }

                var localGlossaryCount = Object.keys(accumulatedGlossary).length;
                logCallback("[DSLRGlossary] Starting with " + localGlossaryCount + " locally extracted terms as seed glossary.");
                this._attachActorProfiles(accumulatedGlossary);

                if (seedGlossary && Object.keys(seedGlossary).length > 0) {
                    var seedCount = 0;
                    for (var sKey in seedGlossary) {
                        var seedEntry = seedGlossary[sKey];
                        if (!seedEntry || !seedEntry.japanese) continue;
                        var mergedEntry = {
                            japanese: seedEntry.japanese,
                            english: seedEntry.english || "",
                            type: seedEntry.type || "other",
                            frequency: seedEntry.frequency || 1,
                            source: seedEntry.source || "seed",
                            note: seedEntry.note || ""
                        };
                        if (accumulatedGlossary[sKey]) {
                            mergedEntry.frequency = Math.max(accumulatedGlossary[sKey].frequency || 0, mergedEntry.frequency);
                            if (!accumulatedGlossary[sKey].english && mergedEntry.english) {
                                accumulatedGlossary[sKey] = mergedEntry;
                            }
                        } else {
                            accumulatedGlossary[sKey] = mergedEntry;
                            seedCount++;
                        }
                    }
                    logCallback("[DSLRGlossary] Merged " + seedCount + " additional seed terms from existing glossary. Total: " + Object.keys(accumulatedGlossary).length + " terms.");
                }
            } else {
                logCallback("[DSLRGlossary] Phase 2: Skipped (no API URL configured). Using local-only extraction.");
            }
        }

        var chunksFailed = 0;

        if (maxChunks > 0 && chunks && settings) {
            for (var chunkIdx = startChunkIdx; chunkIdx < maxChunks; chunkIdx++) {
                self._checkAborted();
                var chunkProgress = Math.round(30 + (60 * chunkIdx) / maxChunks);
                progressCallback(chunkProgress, "[DSLRGlossary] Phase 2: Extracting chunk " + (chunkIdx + 1) + "/" + maxChunks + " (glossary: " + Object.keys(accumulatedGlossary).length + " terms)...");

                try {
                    var terms = await self.extractChunkWithLLM(chunks[chunkIdx], settings, logCallback, errorLogCallback, accumulatedGlossary);

                    for (var ti = 0; ti < terms.length; ti++) {
                        var term = terms[ti];
                        if (!term.japanese) continue;
                        var tKey = term.japanese;
                        if (self._isTemplateString(tKey)) continue;
                        if (accumulatedGlossary[tKey]) {
                            accumulatedGlossary[tKey].source = accumulatedGlossary[tKey].source.indexOf("llm") === -1 ? accumulatedGlossary[tKey].source + "+llm" : accumulatedGlossary[tKey].source;
                            accumulatedGlossary[tKey].frequency = (accumulatedGlossary[tKey].frequency || 1) + 1;
                            if (term.type) accumulatedGlossary[tKey].type = term.type;
                            if (term.context) accumulatedGlossary[tKey].note = term.context;
                            if (term.english && !accumulatedGlossary[tKey].english) accumulatedGlossary[tKey].english = term.english;
                        } else {
                            var tFreq = self._countTermInProject(tKey);
                            accumulatedGlossary[tKey] = {
                                japanese: tKey,
                                english: term.english || "",
                                type: term.type || "unknown",
                                frequency: tFreq,
                                source: "llm",
                                note: term.context || ""
                            };
                        }
                    }
                    llmResults.push(terms);
                } catch (err) {
                    // Belt-and-suspenders: any raw browser abort that slipped past the earlier
                    // translation (e.g. from ResponsesApiHelpers streaming) can only come from
                    // our own Pause/Abort buttons, so treat it as a user pause, not a failure.
                    if (self._asUserAbort(err)) err = self._toUserAbortError(err);
                    if (err && err.message && err.message.indexOf("Aborted by user") !== -1) throw err;
                    if (err && err.message && err.message.indexOf("Paused by user") !== -1) {
                        // _saveProgress stores (idx + 1) as processedChunks, so pass (chunkIdx - 1)
                        // to record the last GOOD chunk; the interrupted chunk is retried on resume.
                        // For chunk 0 this is -1 -> processedChunks 0 (same convention as the
                        // failure path below); the old `chunkIdx > 0 ? chunkIdx - 1 : 0` wrongly
                        // marked chunk 0 as done, making Resume skip it.
                        self._saveProgress(accumulatedGlossary, chunkIdx - 1, maxChunks, localEntities, settings);
                        throw err;
                    }
                    errorLogCallback("[DSLRGlossary] ERROR: Chunk " + (chunkIdx + 1) + " failed permanently: " + err.message);
                    // Treat a permanent failure like a user-initiated pause: checkpoint progress so the
                    // user can resume and RETRY this exact chunk after fixing the underlying issue.
                    // _saveProgress stores (idx + 1) as processedChunks, so pass (chunkIdx - 1) to record
                    // the last GOOD chunk. For chunk 0 this is -1 -> processedChunks 0, so the failed
                    // first chunk is retried on resume; the old `chunkIdx > 0 ? chunkIdx - 1 : 0` wrongly
                    // marked chunk 0 as done, which made Resume skip it (and disabled the button when
                    // the whole project was a single chunk).
                    self._saveProgress(accumulatedGlossary, chunkIdx - 1, maxChunks, localEntities, settings);
                    var failPause = new Error("[DSLRGlossary] Paused due to error: " + (err && err.message ? err.message : "Unknown error"));
                    failPause.isFailurePause = true;
                    throw failPause;
                }

                if (chunkIdx < maxChunks - 1 && (chunkIdx + 1) % 5 === 0) {
                    logCallback("[DSLRGlossary] Progress: " + (chunkIdx + 1) + "/" + maxChunks + " chunks done. Glossary now has " + Object.keys(accumulatedGlossary).length + " terms.");
                }

                self._checkPaused();
                self._saveProgress(accumulatedGlossary, chunkIdx, maxChunks, localEntities, settings);
            }

            var totalLlmTerms = 0;
            for (var i = 0; i < llmResults.length; i++) {
                totalLlmTerms += llmResults[i].length;
            }
            logCallback("[DSLRGlossary] Phase 2 complete: Extracted " + totalLlmTerms + " new terms from " + (llmResults.length) + "/" + maxChunks + " chunks. " + chunksFailed + " chunks failed.");
        }

        logCallback("[DSLRGlossary] Phase 3: Merging glossaries...");
        progressCallback(90, "[DSLRGlossary] Phase 3: Merging glossaries...");
        var finalGlossary;
        if (resumeProgress && accumulatedGlossary && Object.keys(accumulatedGlossary).length > 0) {
            finalGlossary = accumulatedGlossary;
        } else {
            finalGlossary = this.mergeGlossaries(localEntities, llmResults);
        }

        // Fold authoritative Actors.json role/profile into character entries. This is the
        // only piece of the former Project Summary that the glossary did not already cover.
        this._attachActorProfiles(finalGlossary);

        var finalCount = Object.keys(finalGlossary).length;
        logCallback("[DSLRGlossary] Merged glossary has " + finalCount + " terms. Opening editor — review the terms and remove any bad ones.");

        progressCallback(95, "[DSLRGlossary] Opening glossary editor...");

        var reviewNotice = "Review the generated terms before saving and delete any that look wrong — especially a Translation that offers alternatives (\"A\"/\"B\", \"A or B\", \"A (B)\"), contains Japanese characters, or reads as a definition. An ambiguous entry makes the translator reject correct lines. To delete a term, clear its Original field.";

        return new Promise(function(resolve) {
            var editWindow = self._buildEditWindow(
                finalGlossary,
                function onSave(editedGlossary) {
                    self._applyGlossary(editedGlossary);
                    var saveCount = Object.keys(editedGlossary).length;
                    logCallback("[DSLRGlossary] Glossary saved with " + saveCount + " terms after user editing.");
                    progressCallback(100, "[DSLRGlossary] Done! Glossary saved with " + saveCount + " terms.");
                    resolve(editedGlossary);
                },
                function onCancel() {
                    self._applyGlossary(finalGlossary);
                    logCallback("[DSLRGlossary] Editing cancelled. Unedited glossary stored with " + finalCount + " terms.");
                    progressCallback(100, "[DSLRGlossary] Done! Glossary stored with " + finalCount + " terms (unedited).");
                    resolve(finalGlossary);
                },
                undefined,
                reviewNotice
            );
            document.body.appendChild(editWindow);
        });
    }

    static getGlossary() {
        return window.SLRGlossary;
    }

    static getGlossaryText() {
        return window.SLRGlossaryText;
    }

    static filterGlossaryForText(text) {
        var glossary = window.SLRGlossary;
        if (!glossary || typeof glossary !== "object") return "";
        if (!text || typeof text !== "string") return "";
        var filtered = {};
        var keys = Object.keys(glossary);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var entry = glossary[key];
            var searchTerm = entry.japanese || key;
            if (searchTerm && text.indexOf(searchTerm) !== -1) {
                filtered[key] = entry;
            }
        }
        if (Object.keys(filtered).length === 0) return "";
        var extractor = new GlossaryExtractor();
        return extractor.formatGlossaryText(filtered);
    }

    static clearGlossary() {
        window.SLRGlossary = null;
        window.SLRGlossaryText = "";
    }

    // Trim auxiliary context text to a token budget (chars/4 estimate),
    // keeping head lines. A non-positive budget yields "" (no room left for
    // auxiliary context — the caller still sends the essential payload whole).
    static fitTextToTokenBudget(text, budgetTokens) {
        if (!text) return "";
        var budget = Math.floor(Number(budgetTokens) || 0);
        if (budget <= 0) return "";
        var est = Math.ceil(String(text).length / 4);
        if (est <= budget) return text;
        var lines = String(text).split("\n");
        var result = [];
        var tokenSum = 0;
        for (var i = 0; i < lines.length; i++) {
            var lineTokens = Math.ceil(lines[i].length / 4) + 1;
            if (tokenSum + lineTokens > budget) break;
            tokenSum += lineTokens;
            result.push(lines[i]);
        }
        return result.length > 0 ? result.join("\n") : "";
    }
}

var GlossaryExporter = {
    EXPORT_VERSION: 1,

    exportToFile: function(glossary) {
        if (!glossary || Object.keys(glossary).length === 0) {
            alert("No glossary terms to export.");
            return;
        }
        var exportData = {
            version: this.EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            termCount: Object.keys(glossary).length,
            glossary: glossary
        };
        var json = JSON.stringify(exportData, null, 2);

        var $elm = $('<input type="file" class="glossaryExport hidden" nwsaveas="glossary.json" accept=".json,application/json" autocomplete="off" />');
        $elm.on("input", function() {
            var filePath = $(this).val();
            if (!filePath) return;
            var fs = require("fs");
            fs.writeFile(filePath, json, "utf8", function(err) {
                if (err) {
                    alert("Export failed: " + err.message);
                } else {
                    alert("Exported " + Object.keys(glossary).length + " terms to " + filePath);
                }
            });
        });
        $(window).one("focus.glossaryExport", function() {
            setTimeout(function() {
                if (!$elm.val()) $elm.remove();
            }, 3000);
        });
        $elm.click();
    },

    importFromFile: function(callback) {
        if (typeof callback !== "function") return;

        var $elm = $('<input type="file" class="glossaryImport hidden" accept=".json,application/json" autocomplete="off" />');
        $elm.on("input", function() {
            var filePath = $(this).val();
            if (!filePath) { callback(null); return; }
            var fs = require("fs");
            fs.readFile(filePath, "utf8", function(err, data) {
                if (err) {
                    alert("Import failed: " + err.message);
                    callback(null);
                    return;
                }
                try {
                    var parsed = JSON.parse(data);
                    var glossaryData = null;

                    if (parsed && parsed.glossary && typeof parsed.glossary === "object") {
                        glossaryData = parsed.glossary;
                    } else if (parsed && typeof parsed === "object" && !parsed.version) {
                        glossaryData = parsed;
                    } else {
                        alert("Invalid glossary file format.");
                        callback(null);
                        return;
                    }

                    var validCount = 0;
                    for (var key in glossaryData) {
                        var entry = glossaryData[key];
                        if (entry && (entry.japanese || entry.english || entry.note)) {
                            validCount++;
                        }
                    }
                    if (validCount === 0) {
                        alert("No valid glossary terms found in file.");
                        callback(null);
                        return;
                    }

                    var choice = confirm("Found " + validCount + " terms. Click OK to merge with current glossary, or Cancel to replace entirely.");
                    callback({ data: glossaryData, merge: choice, count: validCount });
                } catch (e) {
                    alert("Failed to parse glossary file: " + e.message);
                    callback(null);
                }
            });
        });
        $(window).one("focus.glossaryImport", function() {
            setTimeout(function() {
                if (!$elm.val()) { $elm.remove(); callback(null); }
            }, 3000);
        });
        $elm.click();
    },

    mergeGlossaryObjects: function(existing, imported, preferImported) {
        var result = {};
        for (var key in existing) {
            if (existing[key]) result[key] = Object.assign({}, existing[key]);
        }
        for (var key in imported) {
            var imp = imported[key];
            if (!imp) continue;
            if (result[key]) {
                var res = result[key];
                if (preferImported !== false) {
                    if (imp.english) res.english = imp.english;
                    if (imp.type) res.type = imp.type;
                    if (imp.note) res.note = imp.note;
                    if (imp.profile) res.profile = imp.profile;
                } else {
                    if (!res.english && imp.english) res.english = imp.english;
                    if (!res.type && imp.type) res.type = imp.type;
                    if (!res.note && imp.note) res.note = imp.note;
                    if (!res.profile && imp.profile) res.profile = imp.profile;
                }
                res.frequency = Math.max(res.frequency || 0, imp.frequency || 0);
                if (imp.source) res.source = res.source ? res.source + "+imported" : "imported";
            } else {
                result[key] = Object.assign({}, imp);
                if (!result[key].source) result[key].source = "imported";
            }
        }
        return result;
    }
};

window.GlossaryExporter = GlossaryExporter;

window.GlossaryExtractor = GlossaryExtractor;
