"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DSLRTranslationEngineWrapper = exports.PatternExplanation = exports.TranslationEngineOptionCategories = void 0;
const mtl_text_processor_1 = require("@redsugoi/mtl-text-processor");
const _Constants_1 = require("./_Constants");
const TranslationEngineOption_1 = require("./TranslationEngineOption");
const CacheHandler_1 = require("./CacheHandler");
const RedPerformance_1 = require("./RedPerformance");
const OptionFormBuilder_1 = require("./OptionFormBuilder");
const EndpointHelpers_1 = require("./EndpointHelpers");
const EndpointHealth_1 = require("./endpointHealth");
// The repetition-loop tier thresholds are described as a set and share one section. Keeping the
// ids in one place means adding a fifth tier cannot silently leave it behind in Other Options,
// which is what happened to the fourth: the section map listed only three of them.
const REPETITION_TIER_IDS = ["repetitionLimit", "repetitionCharLimit", "repetitionEntryLimit", "repetitionSkeletonLimit"];
// Section keys that render with `defaultExpanded` (options.js opens them on render).
// Only Quick Start: the Bundled Local Runtime card starts collapsed because most
// users never open it, and an always-open card pushes the other sections off screen.
const DEFAULT_EXPANDED_SECTION_KEYS = ["quickstart"];
// Quality-control toggles that are shared across the whole endpoint pool (every
// endpoint uses Endpoint 1's value) but have their own Fallback counterpart. They
// must NOT be materialized as per-endpoint ep{N}_* clones: the engine reads the
// base/`2` options directly, so an endpoint clone would be dead UI.
const FALLBACK_ONLY_SETTINGS = [
    "enableRetry", "enableReject", "enableRejectJapanese", "enableRejectGlossary",
    "enableRemoveRepetition", "enableRemoveInnerIDSP"
];
exports.FALLBACK_ONLY_SETTINGS = FALLBACK_ONLY_SETTINGS;
var TranslationEngineOptionCategories;
(function (TranslationEngineOptionCategories) {
    TranslationEngineOptionCategories["PATTERNS"] = "Patterns";
    TranslationEngineOptionCategories["LIMITS"] = "Limits";
    TranslationEngineOptionCategories["OPTIONS"] = "Options";
    TranslationEngineOptionCategories["PROMPTS"] = "Prompts";
    TranslationEngineOptionCategories["PLACEHOLDERS"] = "Placeholders";
})(TranslationEngineOptionCategories = exports.TranslationEngineOptionCategories || (exports.TranslationEngineOptionCategories = {}));
const TranslationEngineOptionCategoriesPriority = {
    Options: 0,
    Prompts: 1,
    Dividers: 2,
    Placeholders: 3,
    Limits: 4,
    Patterns: 5
};
exports.PatternExplanation = `You can have multiple patterns, separated by commas. A pattern is either a global Regular Expression or a function (wholeString : string, passCount : number) which returns a global regular expression / nothing.`;
// A usable bundled runtime exists only when window.llmRuntime is present AND did not report a
// load error. The per-model Options panel is built once during addon load, before the
// llmRuntime addon has run, so that first build is marked stale and rebuilt when the Options
// window renders (see onBeforeRenderOptions). Pure and window-agnostic so both the build and
// the render hook reach the same verdict and the decision is unit-testable.
function runtimeIsUsable(win) {
    try {
        return !!(win && win.llmRuntime && !win.llmRuntime.loadError);
    } catch (e) { return false; }
}
function runtimePanelIsStale(win) {
    return !runtimeIsUsable(win);
}
function shouldRebuildStaleRuntimePanel(stale, win) {
    return !!stale && runtimeIsUsable(win);
}
class DSLRTranslationEngineWrapper {
    constructor(processorClass, thisAddon, extraOptions) {
        this.cache = new CacheHandler_1.CacheHandler(this);
        this.storedOptions = [];
        this.storedOptionsHash = {};
        this.endpointCooldown = {};
        this.endpointDisabled = new Set();
        this.endpointInFlight = {};
        this.pendingRotations = 0;
        this._urlGroupLastPick = {};
        /**
         *
         *
         * OPTIONS
         *
         *
         */
        this.optionPlaceholderType = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'placeholderType',
            default: mtl_text_processor_1.PlaceholderType.wolfStyle,
            category: TranslationEngineOptionCategories.OPTIONS,
            name: 'Placeholder Type',
            description: [
                'Protected patterns will be replaced by a symbol from this list before translation.',
                'The ideal type depends on the translator being used. For Sugoi I obviously recommend SLR Special / %A. Google has some innate support for HTML Tags and '
            ].join('\n'),
            formType: 'select',
            schemaOptions: {
                enum: Object.values(mtl_text_processor_1.PlaceholderType)
            },
            formOptions: {
                titleMap: { ..._Constants_1.PlaceholderTypeNames }
            }
        });
        this.optionPlaceholderRecoveryType = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'placeholderRecoveryType',
            default: mtl_text_processor_1.PlaceholderRecoveryType.GUESS,
            category: TranslationEngineOptionCategories.OPTIONS,
            name: 'Placeholder Recovery type',
            description: [
                "Defines how to proceed when the placeholder can't be found for recovery.",
                "\"Guess\" means placing it at the space nearest to the position on the original string, and is the recommended setting. With any option except Throw Away, Placeholders will not be lost in translation. The upside is that you won't be losing text, the downside is that a sentence which lost its placeholders will be corrupted in some way - but that's hardly a real downside, given that it's even more corrupted without the placeholder recovery process."
            ].join('\n'),
            formType: 'select',
            schemaOptions: {
                enum: [
                    mtl_text_processor_1.PlaceholderRecoveryType.ADD_AT_END,
                    mtl_text_processor_1.PlaceholderRecoveryType.ADD_AT_START,
                    mtl_text_processor_1.PlaceholderRecoveryType.GUESS,
                    mtl_text_processor_1.PlaceholderRecoveryType.PERFECT_ONLY
                ]
            },
            formOptions: {
                titleMap: {
                    [mtl_text_processor_1.PlaceholderRecoveryType.ADD_AT_END]: 'Insert unrecoverable placeholder at end',
                    [mtl_text_processor_1.PlaceholderRecoveryType.ADD_AT_START]: 'Insert unrecoverable placeholder at the start',
                    [mtl_text_processor_1.PlaceholderRecoveryType.PERFECT_ONLY]: 'Throw away unrecoverable placeholders',
                    [mtl_text_processor_1.PlaceholderRecoveryType.GUESS]: 'Guess'
                }
            }
        });
        this.optionProcessingOrder = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'processingOrder',
            default: 'SPLIT,ESCAPE,ISOLATE,CUT,SPLIT',
            //default: 'SPLIT,ESCAPE,ISOLATE,CUT,SPLIT',
            description: [
                'The order in which the text processor goes through sentences. The same process can be done more than once, and function patterns can activate themselves on only a certain pass.',
                'Break is the process of separating sentences out of rows. Isolate is the process of finding inner sequences inside sentences and translating them separatedly. Cut is the process of removing symbols from the corners of each translatable sequence. Split is the process of further dividing sentences into smaller translatable parts. Escape is the process of replacing protected patterns with placeholders.',
                "It is not mandatory to have every process. In fact, you can have none. But by then you're not taking advantage of the text processor. Invalid inputs will be ignored - an error will be printed to the developer console (F12) in those cases."
            ].join('\n'),
            name: 'Processing Order',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionOptionsPreset1 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'optionsPreset1',
            default: `{
                "model": "deepseek/deepseek-v4.1-flash",
                "apiUrl": "https://nano-gpt.com/api/v1/chat/completions",
                "apiKey": "",
                "enableJsonObjectFullBatch": true,
                "repeat_penalty": "",
                "glossaryEnableJsonObject": true,
                "glossaryRepeatPenalty": "",
                "reviewTranslations": true,
                "reviewAutoFix": true
            }`,
            description: `You can specify an options preset using the same format as the config.json from the data folder, and then switch to it by clicking the Apply Custom Options 1 button. This will only touch options you specified and leave the rest on its current value.\nDefault: Example Nano-GPT DeepSeek values when other values are default.`,
            name: 'Options Preset 1',
            category: TranslationEngineOptionCategories.PATTERNS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '200px'
            }
        });
        this.optionOptionsPreset2 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'optionsPreset2',
            default: `{
                "model": "gemma4:31b-cloud",
                "apiUrl": "https://ollama.com/v1/chat/completions",
                "apiKey": "",
                "reviewTranslations": true,
                "reviewAutoFix": true
            }`,
            description: `You can specify an options preset using the same format as the config.json from the data folder, and then switch to it by clicking the Apply Custom Options 2 button. This will only touch options you specified and leave the rest on its current value.\nDefault: Example Ollama values when other values are default.`,
            name: 'Options Preset 2',
            category: TranslationEngineOptionCategories.PATTERNS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '200px'
            }
        });
        this.optionOptionsPreset3 = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'optionsPreset3',
            default: `{}`,
            description: `You can specify an options preset using the same format as the config.json from the data folder, and then switch to it by clicking the Apply Custom Options 3 button. This will only touch options you specified and leave the rest on its current value.\nDefault: {}`,
            name: 'Options Preset 3',
            category: TranslationEngineOptionCategories.PATTERNS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '200px'
            }
        });
        /* public optionUseProtectedPatterns = new TranslationEngineOption<boolean>({
            wrapper: this,
            id: 'useProtectedPatterns',
            default: true,
            description:    'Protects patterns by replacing them with placeholders.\n' +
                            'It\'s important to select a Placeholder Type that works well with your translator. Sugoi works pretty well with MV-Style (%A). Google and DeepL have some innate support for both HTML Tags and Curly Brackets.\n' +
                            'The main idea of the placeholder is to protect something that you don\'t want the translator to touch while still giving the translator the contextual cue of a symbol.',
            name: 'Protect Patterns',
            category: TranslationEngineOptionCategories.OPTIONS
        });
    
        public optionUseSplittingTranslatable = new TranslationEngineOption<boolean>({
            wrapper: this,
            id: 'useSplittingTranslatable',
            default: false,
            name : 'Translate Splits',
            description:    'Normally, splits are not sent to the translator, but they split the sentence in two.\nThis changes the behavior so that splits are also translated.',
            category: TranslationEngineOptionCategories.OPTIONS
        });
    
        public optionUseSplittingNext = new TranslationEngineOption<boolean>({
            wrapper: this,
            id: 'useSplittingNext',
            default: false,
            name:    'Start Sentence with Split',
            description: 'Split Patterns are added to the next sentence rather than the previous one.\nOnly in effect if "Splits are Translatable" is checked.',
            category: TranslationEngineOptionCategories.OPTIONS
        }); */
        /* public optionUseProtectedCorners = new TranslationEngineOption<boolean>({
            wrapper: this,
            id: 'useProtectedCorners',
            default: true,
            description:
                'Removes patterns from the corners of sentences, not sending those to the translator.',
            name: 'Split Ends',
            category: TranslationEngineOptionCategories.OPTIONS
        }); */
        this.optionPadPlaceholder = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'padPlaceholder',
            default: false,
            description: 'THIS HAS NO EFFECT IF THE "@ Placeholder" SETTING IS ACTIVE. Adds white space around placeholders. This does not refer to the dividers.\nThis is very useful if translating from a language that shares characters with the placeholders. e.g. instead of text%Atext it will send the translator text %A text, which is clearer.\nIn a way, the downside to this is that the end result might end up with more spaces than it should have, so a very minor downside, but a downside nonetheless.',
            name: 'Pad Placeholders',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionUseBatchCache = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'useBatchCache',
            default: true,
            description: 'Stores translations in memory to avoid repeating work and potentially wasting money.\nThis only matches exact batches with more than 4 entries.\nThis will make a temporary session cache for that purpose like the normal cache, but unless you change a prompt during the session this is very unlikely to have a downside.\n\nCaution: If Line Cache is enabled this option does nothing.',
            name: 'Batch Cache',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionUseLineCache = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'useLineCache',
            default: false,
            description: 'Stores translations in memory to avoid repeating work.\nThis only matches exact sentences.\nThis will reduce token usage much further than BatchCache, but will likely make the translation worse because the LLM will miss out on context.',
            name: 'Line Cache',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionCleanCachePersistent = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'useCleanCachePersistent',
            default: false,
            description: 'Saves cache to a file so that it can be used through multiple sessions preventing it from potentially wasting money. Unlike normal persistant cache this will only save to cache if there is no Context Prompt.\n\nCaution: Clean Cache files will be ignored if normal Persistant Cache is enabled.\n\nCaution2:Turning this off does not delete already cached translations. You need to move or delete the cache file to achieve that.',
            name: 'Clean Persistent Cache',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionCachePersistent = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'useCachePersistent',
            default: false,
            description: 'Saves cache to a file so that it can be used through multiple sessions.\n\nCaution:This can actually lead to pretty bad translations if it reuses an old translation that does not fit the context of the current project.\n\nCaution2:Turning this off does not delete already cached translations. You need to move or delete the cache file to achieve that.',
            name: 'Persistent Cache',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionCachePersistentSize = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'cachePersistentSize',
            default: 999,
            description: "The maximum size, in megabytes, that the cache can reach.\nThe value is used as an approximation. It is recommended to use a value that won't cause issues with regards to either memory or disk speed.\nFor reference: a small game will usually fill about 500KB of cache, a medium game will fill about 1MB of cache, and a large game might fill 2MB of cache. So the default value of 10MB is about 5 big games worth of cache.",
            name: 'Persistent Cache Size',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        /**
         * Limits
         */
        this.optionMaxRequestLengthDSLR = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxRequestLengthDSLR',
            default: 5000,
            name: 'Maximum Scene Size',
            description: 'The largest a single standalone scene may be, in characters. A "long" scene (see Scene Threshold, below) is isolated and sent whole, up to this size, for the best translation quality - a coherent large request is far less likely to fail than a fragmented one. This is also the per-request character ceiling the engine splits by, so only a scene that genuinely exceeds it ever gets split (and only at scene boundaries). Short scenes and non-scene text are packed to the smaller Target Request Size instead, so this value mainly matters for big scenes.\nTune per model: small local models ~4000, large hosted models ~30000. Measured before escaping - escaping only ever shrinks the real request, so the actual send is always at or below this.',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionTargetRequestSize = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'targetRequestSize',
            default: 2000,
            name: 'Target Request Size',
            description: 'The comfortable size (in characters) of a single request for your model. This is the packing ceiling for everything that is NOT a standalone large scene: grouped small scenes and non-scene text (menus, items, system terms) are batched up to this size so each batch maps to roughly one request - not tiny (no wasted input tokens), not ballooned (no overload / context bleed). A lone scene that is "long" (see Scene Threshold) is allowed to exceed this, up to Maximum Scene Size, so it can be sent whole. Tune per model: ~1500 for a small local model, ~3000 balanced, ~8000+ for a large hosted model. Measured before escaping. Set to 0 to disable (everything packs up to Maximum Scene Size).',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionSceneShortMaxRows = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'sceneShortMaxRows',
            default: 15,
            name: 'Scene Threshold',
            description: 'Scenes with fewer than this many rows are considered "short" and will be merged with adjacent scenes to avoid tiny API requests. Scenes with this many rows or more are considered "long": they are isolated in their own batch and sent whole (up to Maximum Scene Size) for the best LLM context. Set to 0 to disable scene isolation (all scenes merge until the character limit).',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionMaxScenesPerGroup = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxScenesPerGroup',
            default: 7,
            name: 'Max Scenes per Grouped Batch',
            description: 'Maximum number of separate scenes that may be merged into a single grouped batch. Caps context bleed by never showing the model more than this many scenes at once, even if they would still fit under Target Request Size. Only affects batches that merge multiple scenes; a single scene is never split by this. Set to 0 to disable.',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionMaxNonSceneRows = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxNonSceneRows',
            default: 80,
            name: 'Max Rows per Non-Scene Batch',
            description: 'Maximum number of non-scene rows (menus, items, skills, system terms) allowed in a single batch. Non-scene text is made up of independent short strings, so the Target Request Size character cap alone can pack hundreds of tiny rows into one batch - and the per-row formatting overhead then blows up the actual request size. This row cap prevents that. Only affects non-scene batches: grouped scenes are limited by Max Scenes per Grouped Batch, and lone large scenes are sent whole. Set to 0 to disable.',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionMaxSingleLineScenesRows = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxSingleLineScenesRows',
            default: 40,
            name: 'Max Rows per Single-Line Scene Batch',
            description: 'Maximum number of rows packed into a single batch made up of one-line scenes - scenes that are their own scene with just one line (e.g. an NPC remark like "Good morning!" or inspecting an object and reading "The basket is empty."). Such scenes carry almost no internal context, so they pack far more densely than ordinary multi-line scenes without hurting quality, up to this many rows per batch, while still respecting Target Request Size. They get their own packing stream that runs after the ordinary (2+ line) grouped scenes and before the non-scene text, so single-line scenes never dilute the context of a real conversation scene and never cause tiny under-filled requests. Only affects batches that merge multiple single-line scenes: ordinary grouped scenes use Max Scenes per Grouped Batch, lone large scenes are sent whole, and non-scene text uses Max Rows per Non-Scene Batch. Set to 0 to disable (single-line scenes then pack like ordinary short scenes under the Scene Threshold).',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        /**
         *
         *
         * PATTERNS
         *
         *
         */
        this.optionProtectedPatterns = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'protectedPatterns',
            default: [
                '// Nameplate Madness',
                '// This inefficient and stupid looking repetition is necessary because if you do the exact same thing in one pattern NodeJS will claim there\'s "catastrophic backtracking" even though there clearly isn\'t',
                '// Start Front',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\*c?\[?\d*\]?[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<)/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*[ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?(?<!\\[cinv]w?\[\d+)[>\]][ 　]*(?<!\\[cinv]w?\[\d+))/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=\\+nw?\[\d+\][ 　]*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+)/gi.toString() + ',',
                /^[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+[ 　]*(?=.*?[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*[\r\n]+[ 　]*(?!$|\r|\n| |　))/gi.toString() + ',',
                '// Start Back',
                /(?<=^@1.*?)[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\</gi.toString() + ',',
                /(?<=^@1.*?)[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\</gi.toString() + ',',
                /(?<=^@1.*?)[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\</gi.toString() + ',',
                /(?<=^@1.*?)[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\</gi.toString() + ',',
                /(?<=^@1.*?)[ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\</gi.toString() + ',',
                /(?<=^@1.*?)[ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\</gi.toString() + ',',
                /(?<=^@1.*?)[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\</gi.toString() + ',',
                /(?<=^@1.*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?/gi.toString() + ',',
                /(?<=^@1.*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?/gi.toString() + ',',
                /(?<=^@1.*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?/gi.toString() + ',',
                /(?<=^@1.*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?/gi.toString() + ',',
                /(?<=^@1.*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?/gi.toString() + ',',
                /(?<=^@1\\+nw?\[\d+\])[ 　]*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*\\?<?/gi.toString() + ',',
                /(?<=^@1.*?)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*[\r\n]+[ 　]*(?!$|\r|\n| |　)/gi.toString() + ',',
                '// End Back',
                /(?<=[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\+c\[\d+\][ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=[ 　]*\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*)(?=％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??(?:[Ａ-Ｚａ-ｚ０-９\/？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]+|\\nw?\[\d+\]|\\+c\[\d+\])??[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\<[ 　]*\\*c?\[?\d*\]?[ 　]*$/gi.toString() + ',',
                /(?<=\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*[ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+c\[\d+\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=(?<!nw?\[)\\+nw?[<\[](?!\d+\]).*?)(?<!\\[cinv]w?\[\d+)[>\]][ 　]*(?<!\\[cinv]w?\[\d+)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+[ 　]*\\nw?\[\d+\])[ 　]*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*[ 　]*\\?<?[ 　]*$/gi.toString() + ',',
                /(?<=[\r\n]+[ 　]*(?!$|\r|\n| |　)[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+.*?)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*$/gi.toString() + ',',
                '// End Front',
                /\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?=.*?@[13][ 　]*$)/gi.toString() + ',',
                /\\>[ 　]*\\+c\[\d+\][ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=.*?@[13][ 　]*$)/gi.toString() + ',',
                /\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?=.*?@[13][ 　]*$)/gi.toString() + ',',
                /\\>[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?=.*?@[13][ 　]*$)/gi.toString() + ',',
                /\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*\\+c\[\d+\][ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?@[13][ 　]*$)/gi.toString() + ',',
                /\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*[ 　]*(?<!nw?\[)\\+nw?[<\[](?!\d+\])(?=.*?@[13][ 　]*$)/gi.toString() + ',',
                /\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+[ 　]*(?=\\+nw?\[\d+\]@[13][ 　]*$)/gi.toString() + ',',
                /[\r\n]+[ 　]*(?!$|\r|\n| |　)[ 　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+.*?(?=.*?@[13][ 　]*$)/gi.toString() + ',',
                '// dialogue plugin',
                /(?<=^\$gameScreen\.OriginalMessage\(".*?",.*?".*?)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*",.*?\);$/gim.toString() + ',',
                /(?<=^\$gameScreen\.OriginalMessage\(".*?)",[ 　]*"[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*/gim.toString() + ',',
                /^\$gameScreen\.OriginalMessage\("/gim.toString() + ',',
                '// Leftover Modifier',
                /(?<=\\+nw?[<\[].*?(?<!\\+[cinv]w?\[\d+)[>\]][　 ]*|\\+nw?\[\d+\][　 ]*)\\+[FA]+[H]?\[[^\]]+\]/gi.toString() + ',',
                '//DSLR Placeholder Replacements',
                /{PERSON\d+}/gi.toString() + ',',
                /{I\d+}/gi.toString() + ',',
                /{V\d+}/gi.toString() + ',',
                /{NAME\d+}/gi.toString() + ',',
                /{C\d+}/gi.toString() + ',',
                /{%\d+}/gi.toString() + ',',
                '//Section Marker Full Batch Dividers',
                /[\n \-{]*дiv\d*[}\n \-]*/g.toString() + ',',
                /дiv/g.toString() + ',',
                /д/g.toString() + ',',
                /\n?--- {div\d+} ---\n?/g.toString() + ',',
                //'// Value reference',
                //[\\]*[_\-abdefghjklmopqrstuxyz]+\[[^\[\]]+?\]/gi.toString() + ',',
                '// MVMZ Variables',
                /(?<!%)\d+[%]\d*%?\d*%?/g.toString() + ',',
                /[%#]\d+\\+G(?![a-zA-Z])/g.toString() + ',',
                /[　 ]*[%#]\d+[　 ]*/g.toString() + ',',
                '// VX Variables',
                /[%][sd](?![a-z])/g.toString() + ',',
                '// Placeholder',
                /\\+I\[(?:_actor|_class|_key|_name|_num|_icon|_desc|_ABL)\]/gi.toString() + ',',
                /_actor/g.toString() + ',',
                /_class/g.toString() + ',',
                /_key/g.toString() + ',',
                /_name/g.toString() + ',',
                /_num/g.toString() + ',',
                /_icon/g.toString() + ',',
                /_desc\d/g.toString() + ',',
                /_ABL/g.toString() + ',',
                /\\+WRK(?![\[<])/g.toString() + ',',
                /[#]\d+\\+G(?![a-zA-Z])/g.toString() + ',',
                /\\+G(?![a-zA-Z])/g.toString() + ',',
                /\\+\$(?![a-zA-Z])/g.toString() + ',',
                /\\+!/gi.toString() + ',',
                /\\+\|/gi.toString() + ',',
                //\\+[abdefghjklmopqrstuxyz]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]/gi.toString() + ',',
                //\\+n[w]?\[\d+\]/gi.toString() + ',',
                //\\+v\[\d+\]/gi.toString() + ',',
                //\\+i\[\d+\]/gi.toString() + ',',
                //\\+[\w]+\[\\+n\[\d+\]\]/gi.toString() + ',',
                //'// RPG Maker conditional choice',
                //(\s*((if)|(en))\(.+?\)\s*)/gi.toString() + ',',
                '// broken commands',
                /(?<!\\)[ 　]+(?<!\\)[civn]w?\[[^\]\r\n]?\]/gim.toString() + ',',
                /\/[civn]w?\[[^\]\r\n]?\]/gim.toString() + ',',
                /\\+\[\d+\]/gim.toString() + ','
            ].join('\n'),
            description: "\nIF YOU ARE TRANSLATING FROM SOMETHING OTHER THAN JAPANESE CHANGE ALL \"一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\" BITS TO WHATEVER YOUR SOURCE LANGUAGE IS!" +
                '\nProtected Patterns will replace every match with a placeholder. The placeholder will be replaced by the original value after translation.\n' +
                exports.PatternExplanation +
                '\nTo disable, you can comment out every pattern or leave it empty.',
            name: 'Protected Patterns',
            formType: 'ace',
            category: TranslationEngineOptionCategories.PATTERNS,
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '150px'
            }
        });
        this.optionSplittingPatterns = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'splittingPatterns',
            default: [
                //'// Lines that do not include Japanese',
                //^[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+$/gim.toString() + ',',
                '// Empty lines',
                /^[　\s]*$/gm.toString() + ',',
                /^\s+$/gm.toString() + ',',
                /^\s+$/gm.toString() + ',',
                /^\s*[\n\r]+/gm.toString() + ',',
                /[\n\r]+\s*$/gm.toString() + ',',
                //yoshiitech ExternMessage
/*                 /"?'pan':\d+}\)/g.toString() + ',',
                /^"?\d+\)/gm.toString() + ',',
                /"?:\w+\[.*?\]/g.toString() + ',',
                /"?:\w+/g.toString() + ',',
                /"?\w+　*：/g.toString() + ',', */
                ////////////
                '// Cells that do not include Japanese or placeholders',
                /^[　\s]*(?!.*\\+[niv]w?\[\d+\])[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ@]+[　\s]*$/gi.toString() + ',',
                '// dialogue plugin',
                /(?<=^\$gameScreen\.OriginalMessage\(".*?",.*?".*?)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*",.*?\);$/gim.toString() + ',',
                '//Item Power Label',
                /^[　\s]*【[<>=+\-\/*ж]+】/g.toString() + ',',
                '//$ at start or end',
                /^[　\s]*\\+\$(?![a-zA-Z])/g.toString() + ',',
                
                //'//plivemaker',
                //["\s]*<[^<>]*>["\s]*/g.toString() + ',',
                
                /\\+\$[　\s]*$/g.toString() + ',',
                '//Custom Label',
                /^[　\s]*{"label":"[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ"]+"[^}]+}[\s　]*$/gm.toString() + ',',
                /^[　\s]*{"label":"(?=[^"]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^"]*"[^}]+}[\s　]*$)/gm.toString() + ',',
                /(?<=^[\s　]*{"label":"[^"]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^"]*)"[^}]+}[\s　]*$/gm.toString() + ',',
                '//CommonPopup',
                /^CommonPopup add text:[　 ]*[^ 一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+ .+/gm.toString() + ',',
                /(?<=^CommonPopup add text:[　 ]*[^ ]+) .+/gm.toString() + ',',
                /^CommonPopup add text:[　 ]*/gm.toString() + ',',
                '//OSW',
                /^OSW_.*?text \d+ [^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+[　 ]*\/\/.*$/gm.toString() + ',',
                /^OSW_.*?text \d+ [^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+$/gm.toString() + ',',
                /^OSW_.*?text \d+ /gm.toString() + ',',
                '//PSM SHOW POPUP',
                /^PSM_SHOW_POPUP.*\d+ [^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+[　 ]*\/\/.*$/gm.toString() + ',',
                /^PSM_SHOW_POPUP.*\d+ [^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+$/gm.toString() + ',',
                /(?<=^PSM_SHOW_POPUP.*\d+ [^ ]+) -[a-zA-Z]+?$/gm.toString() + ',',
                /^PSM_SHOW_POPUP.*\d+ /gm.toString() + ',',
                /^PSM_SHOW_POPUP /gm.toString() + ',',
                '//sac',
                /<Speech\/[\w+ ]+?\[\w+?\]\:/g.toString() + ',',
                /<Speech\/[\w+ ]+?\:/g.toString() + ',',
                /^[\"\'\`\’]?<[\w+ ]+?\:[\w\+\-\: ]+>[\"\'\`\’]?[\"\'\`\’]?$/gm.toString() + ',',
                /^[\"\'\`\’]?<SAC.*?\:[\w\+\-\: ]+>[\"\'\`\’]?[\"\'\`\’]?$/gm.toString() + ',',
                /^[\"\'\`\’]?[\w+ ]+?\:[\w\+\-\: ]+[\"\'\`\’]?[\"\'\`\’]?$/gm.toString() + ',',
                /(?<=['"])[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+$/g.toString() + ',',
                '// FFF script stuff',
                /^[\"\'\`\’]?\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /^[\"\'\`\’]?\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /^[\"\'\`\’]?\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /(?<!\\nw?<.*?>[　 ]*|\\nw?\[\d+\][　 ]*)\\+F+?\[[^\]\r\n]+?\]\]+/gi.toString() + ',',
                /(?<!\\nw?<.*?>[　 ]*|\\nw?\[\d+\][　 ]*)\\+A+?\[[^\]\r\n]+?\]\]+/gi.toString() + ',',
                /(?<!\\nw?<.*?>[　 ]*|\\nw?\[\d+\][　 ]*)\\+FH\[[^\]\r\n]+?\]+/gi.toString() + ',',
                /(?<!\\nw?<.*?>[　 ]*|\\nw?\[\d+\][　 ]*)\\+[FA]+\[+[^\]]+\]+/gi.toString() + ',',
                /(?<!\\nw?<.*?>[　 ]*|\\nw?\[\d+\][　 ]*)\\+FH\[+[^\]]+\]+/gi.toString() + ',',
                ////////////
                '// If Target Language is not English remove everything below this until the other message',
                '// Specific MV/MZ System entries',
                /^%1には効かなかった！$|^%1は %2 のダメージを受けた！$|^%1は%2を %3 奪われた！$|^%1の%2が %3 増えた！$|^%1の%2が %3 減った！$|^%1はダメージを受けていない！$|^ミス！　%1はダメージを受けていない！$|^%1の%2が %3 回復した！$|^%1の%2が上がった！$|^%1の%2が元に戻った！$|^%1の反撃！$|^%1の%2が下がった！$|^%1は戦いに敗れた。$|^%1が出現！$|^%1に %2 のダメージを与えた！$|^%1の%2を %3 奪った！$|^%1にダメージを与えられない！$|^ミス！　%1にダメージを与えられない！$|^%1は逃げ出した！$|^%1は攻撃をかわした！$|^次の%1まで$|^現在の%1$|^%1は%2 %3 に上がった！$|^%1は魔法を打ち消した！$|^%1は魔法を跳ね返した！$|^%1 の%2を獲得！$|^お金を %1\\G 手に入れた！$|^%1を手に入れた！$|^%1を覚えた！$|^%1たち$|^%1は先手を取った！$|^%1が%2をかばった！$|^%1は不意をつかれた！$|^%1は%2を使った！$|^%1の勝利！$/g.toString() + ',',
                '// Specific MV/MZ States entries',
                /^%1は倒れた！$|^%1を倒した！$|^%1は立ち上がった！$|^%1は毒にかかった！$|^%1に毒をかけた！$|^%1の毒が消えた！$|^%1は暗闇に閉ざされた！$|^%1を暗闇に閉ざした！$|^%1の暗闇が消えた！$|^%1は沈黙した！$|^%1を沈黙させた！$|^%1の沈黙が解けた！$|^%1は激昂した！$|^%1を激昂させた！$|^%1は我に返った！$|^%1は混乱した！$|^%1を混乱させた！$|^%1は魅了された！$|^%1を魅了した！$|^%1は眠った！$|^%1を眠らせた！$|^%1は眠っている。$|^%1は目を覚ました！$|^%1はしびれて動けなくなった！$|^%1を麻痺させた！$|^%1は体がしびれて動けない！$|^%1の麻痺が解けた！$|^%1はバランスを崩した！$|^%1はバランスを崩している……$|^%1は体勢を立て直した！$|^%1は狙われやすくなった！$|^%1は狙われにくくなった！$|^%1は炎の力を身にまとった。$|^%1は氷の力を身にまとった。$|^%1は雷の力を身にまとった%1は炎や氷の攻撃に強くなった$|^炎や氷に強くなっている$|^水のガードの効果が切れた$|^%1は分身して２回行動できるようになった$|^%1は分身している$|^%1の分身が切れた$/g.toString() + ',',
                '// Specific VX/Ace Scripts entries',
                /^所持数$|^購入する$|^売却する$|^やめる$|^持っている数$|^現在の経験値$|^どのファイルにセーブしますか？$|^どのファイルをロードしますか？$|^ファイル$|^会心の一撃！！$|^痛恨の一撃！！$|^しかし逃げることはできなかった！$|^戦闘に勝利した$|^%sが現れた！$|^%sの先制！$|^%sは退却した$|^%sは戦いに敗れた…$|^%s の経験値を獲得$|^%s\\\\G 手に入れた$|^%sを手に入れた$|^%sは%s %s に上がった$|^%sを覚えた$|^次の%sまで$|^%sは逃げてしまった。$|^お金を %s%s 手に入れた！$|^%sの攻撃！$|^%sは身を守っている。$|^%sは様子を見ている。$|^%sたち$|^%sが出現！$|^%sは先手を取った！$|^%sは不意をつかれた！$|^%sは逃げ出した！$|^%sの勝利！$|^%sは戦いに敗れた。$|^%s の経験値を獲得！$|^お金を %s\\\\G 手に入れた！$|^%sを手に入れた！$|^%sは%s %s に上がった！$|^%sを覚えた！$|^%sは%sを使った！$|^%sは %s のダメージを受けた！$|^%sの%sが %s 回復した！$|^%sの%sが %s 増えた！$|^%sの%sが %s 減った！$|^%sは%sを %s 奪われた！$|^%sはダメージを受けていない！$|^ミス！　%sはダメージを受けていない！$|^%sに %s のダメージを与えた！$|^%sの%sを %s 奪った！$|^%sにダメージを与えられない！$|^ミス！　%sにダメージを与えられない！$|^%sは攻撃をかわした！$|^%sは魔法を打ち消した！$|^%sは魔法を跳ね返した！$|^%sの反撃！$|^%sが%sをかばった！$|^%sの%sが上がった！$|^%sの%sが下がった！$|^%sの%sが元に戻った！$|^%sには効かなかった！$|^お金を %s%s 失った。$|^%sの%sが %s に下がってしまった。$/g.toString() + ',',
                '//Specific pre defined translations',
                /^[　 ]*カナ[　 ]*$/g.toString() + ',',
                /^[　 ]*決定[　 ]*$/g.toString() + ',',
                /^[　 ]*英数[　 ]*$/g.toString() + ',',
                /^[　 ]*かな[　 ]*$/g.toString() + ',',
                /^[　 ]*【剣】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【杖】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【フレイル】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【斧】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【槍】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【爪】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【弓】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【短剣】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【グローブ】[　 ]*$/gi.toString() + ',',
                /^[　 ]*なし[　 ]*$/gi.toString() + ',',
                /^[　 ]*続きから[　 ]*$/gi.toString() + ',',
                /^[　 ]*昼[　 ]*$/gi.toString() + ',',
                /^[　 ]*ボイス 音量[　 ]*$/gi.toString() + ',',
                /^[　 ]*ベリーハード[　 ]*$/gi.toString() + ',',
                /^[　 ]*身分[　 ]*$/gi.toString() + ',',
                /^[　 ]*状態[　 ]*$/gi.toString() + ',',
                /^[　 ]*はぁはぁ[　 ]*$/g.toString() + ',',
                /^[　 ]*好きぃ[　 ]*$/g.toString() + ',',
                /^[　 ]*大好きぃ[　 ]*$/g.toString() + ',',
                /^[　 ]*ヒール[　 ]*$/g.toString() + ',',
                /^[　 ]*MPを回復する。[　 ]*$/g.toString() + ',',
                /^[　 ]*弓[　 ]*$/g.toString() + ',',
                /^[　 ]*杖[　 ]*$/g.toString() + ',',
                /^[　 ]*木刀[　 ]*$/g.toString() + ',',
                /^[　 ]*のMPが自動回復する。[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着黒\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着白\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着赤\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着紫\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着青\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*素肌\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・黒[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・白[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・赤[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・紫[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・青[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着黒[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着白[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着赤[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着紫[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着青[　 ]*$/g.toString() + ',',
                /^[　 ]*素肌[　 ]*$/g.toString() + ',',
                /^[　 ]*んぶちゅれろぉ[　 ]*$/g.toString() + ',',
                /^[　 ]*まったく[　 ]*$/g.toString() + ',',
                /^[　 ]*なんでもーー…あひぃんっ[　 ]*$/g.toString() + ',',
                /^[　 ]*フン[　 ]*$/g.toString() + ',',
                /^[　 ]*ひぇっ[　 ]*$/g.toString() + ',',
                /^[　 ]*\(日\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(月\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(火\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(水\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(木\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(金\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(土\)[　 ]*$/g.toString() + ',',
                /^[　 ]*朝[　 ]*$/g.toString() + ',',
                /^[　 ]*夕[　 ]*$/g.toString() + ',',
                /^[　 ]*夜[　 ]*$/g.toString() + ',',
                /^[　 ]*月[　 ]*$/g.toString() + ',',
                /^[　 ]*日[　 ]*$/g.toString() + ',',
                /^[　 ]*はあっ[　 ]*$/g.toString() + ',',
                /^[　 ]*ああっ[　 ]*$/g.toString() + ',',
                /^[　 ]*やっ[　 ]*$/g.toString() + ',',
                /^[　 ]*やりぃ[　 ]*$/g.toString() + ',',
                /^[　 ]*んうーん[　 ]*$/g.toString() + ',',
                /^[　 ]*へっ[　 ]*$/g.toString() + ',',
                /^[　 ]*ふんッ[　 ]*$/g.toString() + ',',
                /^[　 ]*うぅーん[　 ]*$/g.toString() + ',',
                /^[　 ]*えぇ～いいじゃんかよ～[　 ]*$/g.toString() + ',',
                /^[　 ]*んんぅッ[　 ]*$/g.toString() + ',',
                /^[　 ]*へぇ～[　 ]*$/g.toString() + ',',
                /^[　 ]*ええ～[　 ]*$/g.toString() + ',',
                /^[　 ]*んんーッ[　 ]*$/g.toString() + ',',
                /^[　 ]*むうん[　 ]*$/g.toString() + ',',
                /^[　 ]*秋[　 ]*$/g.toString() + ',',
                /^[　 ]*夏[　 ]*$/g.toString() + ',',
                /^[　 ]*春[　 ]*$/g.toString() + ',',
                /^[　 ]*冬[　 ]*$/g.toString() + ',',
                /^[　 ]*マワセ[　 ]*$/g.toString() + ',',
                /^[　 ]*オカセ[　 ]*$/g.toString() + ',',
                /^[　 ]*はじめから[　 ]*$/g.toString() + ',',
                /^[　 ]*つづきから[　 ]*$/g.toString() + ',',
                /^[　 ]*やあやあ♪[　 ]*$/g.toString() + ',',
                /^[　 ]*何度も何度も何度も[　 ]*$/g.toString() + ',',
                /^[　 ]*回[　 ]*$/g.toString() + ',',
                /^[　 ]*会議は長引き[　 ]*$/g.toString() + ',',
                /^[　 ]*ほーん[　 ]*$/g.toString() + ',',
                /^[　 ]*北西[　 ]*$/g.toString() + ',',
                /^[　 ]*北東[　 ]*$/g.toString() + ',',
                /^[　 ]*南西[　 ]*$/g.toString() + ',',
                /^[　 ]*南東[　 ]*$/g.toString() + ',',
                /^[　 ]*げぇむ終了[　 ]*$/g.toString() + ',',
                /^[　 ]*う～ん[　 ]*$/g.toString() + ',',
                /^[　 ]*今度こそ[　 ]*$/g.toString() + ',',
                /^[　 ]*修得不可[　 ]*$/g.toString() + ',',
                /^[　 ]*未修得[　 ]*$/g.toString() + ',',
                /^[　 ]*ロードメニュー[　 ]*$/g.toString() + ',',
                /^[　 ]*交換する[　 ]*$/g.toString() + ',',
                /^[　 ]*あ～やわらけぇ[　 ]*$/g.toString() + ',',
                /^[　 ]*いや～[　 ]*$/g.toString() + ',',
                /^[　 ]*セーブしますか？?[　 ]*$/g.toString() + ',',
                /^[　 ]*おっおぉ～[　 ]*$/g.toString() + ',',
                /^[　 ]*おいおい随分キツイじゃねえの[　 ]*$/g.toString() + ',',
                /^[　 ]*あ～も～ちゃんと踏ん張っててよ[　 ]*$/g.toString() + ',',
                /^[　 ]*んぶちゅっ[　 ]*$/g.toString() + ',',
                /^[　 ]*ジュポッジュポジュポッ[　 ]*$/g.toString() + ',',
                /^[　 ]*クゥさぁ[　 ]*$/g.toString() + ',',
                /^[　 ]*うぃ～[　 ]*$/g.toString() + ',',
                /^[　 ]*あーもーっ[　 ]*$/g.toString() + ',',
                /^[　 ]*盛大に潮吹いたな～[　 ]*$/g.toString() + ',',
                /^[　 ]*あ～やべ～[　 ]*$/g.toString() + ',',
                /^[　 ]*キャーッ[　 ]*$/g.toString() + ',',
                /^[　 ]*ごっくんした精液量[　 ]*$/g.toString() + ',',
                /^[　 ]*うおっほぉ[　 ]*$/g.toString() + ',',
                /^[　 ]*ゲーム終了[　 ]*$/g.toString() + ',',
                /^[　 ]*全体 音量[　 ]*$/g.toString() + ',',
                /^[　 ]*ふ、ふん！[　 ]*$/g.toString() + ',',
                /^[　 ]*こ、ここ+んな事で[　 ]*$/g.toString() + ',',
                /^[　 ]*うあわああっ[　 ]*$/g.toString() + ',',
                /^[　 ]*いたた[　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                '// If Target Language is not English remove everything above this until the other message',
                '// Common plugin calls',
                '// D_TEXT is handled by DSLR itself because of the font size value',
                /(^[\"\'\`\’]?DW_[A-Z]+ )|(^[\"\'\`\’]?addLog )|(^[\"\'\`\’]?greedCommand )|(^[\"\'\`\’]?ShowInfo )|(^[\"\'\`\’]?text_indicator :)|(^.+?subject=)/g.toString() + ',',
                '// files',
                /^.*mplus-1.*$/gi.toString() + ',',
                /^.*vl-gothic.*$/gi.toString() + ',',
                /^.+\.(png|jpg|ttf|woff|otf|txt|ini|rvdata|rgss|json|js|wav|ogg|mp3|mp4|m4a|bmp|exe).*$/gi.toString() + ',',
                '//Complicated Stuff',
                /(\s*((if)|(en))\(.+?\)\s*)/gi.toString() + ',',
                //[\\]*[_\-a-z]+\[[^\[\]]+?\]/gi.toString() + ',',
                /else if[\s\S]*?\{[\s\S]*?\}/g.toString() + ',',
                /if[\s\S]*?\{[\s\S]*?\}/g.toString() + ',',
                '// If',
                /\\+[n]\[\\+[\w]\[\d+\]\]?.+if\(v\[\d+\] \!\= \d+\) en\(s\[\d+\]\)/gi.toString() + ',',
                /\\+[n]\[\\+[\w]\[\d+\]\]?/gi.toString() + ',',
                /if\(v\[\d+\] ?[>=<\-+!?]+ ?\d+\)/gi.toString() + ',',
                /if\([\w]\[\d+\] \!\= \d+\) en\([\w]\[\d+\]\)/gi.toString() + ',',
                /if\([\w]\[\d+\]/gi.toString() + ',',
                /[en|if]+\([\w]\[\d+\][ \>\=\d&|true|false]*v?\[?\d*\]?[ \>\=\d&|true|false]*\)/gi.toString() + ',',
                /\!\= \d+\)/gi.toString() + ',',
                /if\([\w]/gi.toString() + ',',
                /if\([\w]\[\d+\]==true\)/gi.toString() + ',',
                /if\([\w]\[\d+\]==false\)/gi.toString() + ',',
                /if\([\w]\[\d+\]/gi.toString() + ',',
                /if\([\w]/gi.toString() + ',',
/*                 '//Weird one-off quest plugin',
                /<quest \d+:/gi.toString() + ',',
                /<\/quest>/gi.toString() + ',',
                /\| \|\d+>/gi.toString() + ',', */
                '//Command catchall',
                /^[　 ]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*\\+[abd-zABD-Z_]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*\\+[a-zA-Z_]+(?<!\\nw?<.*?>\\+[AF]+[H]?|\\nw?\[\d+\]\\+[AF]+[H]?)\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*/gim.toString() + ',',
                /[　 ]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*\\+[abd-zABD-Z_]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*\\+[a-zA-Z_]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*$/gim.toString() + ',',
                /[　 ]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*\\+[\w_]+(?<!(\\n)|(\\name)|(\\nw?)|(\\c)|(\\v)|(\\i)|(\\nw?<.*?>[　 ]*\\+[FA]+[H]?)|(\\nw?\[\d+\][　 ]*\\+[FA]+[H]?))\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*/gim.toString() + ',',
                /[　 ]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*(?<!\\nw?<.*?>|\\nw?\[\d+\])\\+[\w_]+(?<!(\\n)|(\\name)|(\\nw?))\<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?\>[〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\\[\<])[\[<]?\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\\[\<])[\[<]?\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\\[\<])[\[<]?\\+[\w_]+\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\\[\<])[\[<]?\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\\[\<])(?<!\\nw?<.*?>|\\nw?\[\d+\])\\+(?![civn]\[|nw?[\[<])[\w]+[\[<][\[<]?[\[<]?(?!\\[vin]\[\d+\])[^\]>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d][\]>][\]>]?[^\]>]*?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*\\[n](?![\[\<\w])[　 ]*/gim.toString() + ',',
                '// MZ Script text',
                /^[\"\'\`\’]?テキスト-/g.toString() + ',',
                /^[\"\'\`\’]?\$gameVariables\.value\(\d+\)\[\d+\] ?= ?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*[\"\'\`\’]?$/gim.toString() + ',',
                /^[\"\'\`\’]?\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\"?/gim.toString() + ',',
                '// Plugins',
                /<\d+,\d+>/g.toString() + ',',
                /\{[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\}]+?\|[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\}]+?\}/gm.toString() + ',',
                /\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]]+\/[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]]+\]/g.toString() + ',',
                /^[\"\'\`\’]?\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]]+\]/g.toString() + ',',
                /^[\"\'\`\’]?LL_GalgeChoiceWindowMV ?setChoices ?/gm.toString() + ',',
                /^[\"\'\`\’]?LL_GalgeChoiceWindowMV ?setMessageText ?/gm.toString() + ',',
                /BattleManager\._logWindow\.addText\(\'[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\'\)]*?\'\);/gm.toString() + ',',
                //[%][sd](?![a-z])/g.toString() + ',',
                /<Custom \w+? Effect>[\s\S]*?<\/Custom \w+? Effect>[　 ]*\/\/.*/gi.toString() + ',',
                /<Custom \w+? Effect>[\s\S]*?<\/Custom \w+? Effect>/gi.toString() + ',',
                /\\+#/g.toString() + ',',
                //[%#]\d+\\+G/g.toString() + ',',
                //[#]\d+\\+G/g.toString() + ',',
                //(?<!%)\d+[%]\d*%?\d*%?/g.toString() + ',',
                //[　 ]*[%#]\d+[　 ]*/g.toString() + ',',
                /[　 ]*[#]\d+[　 ]*/g.toString() + ',',
                //@\d+(?=[^@]|$)/g.toString() + ',',
                /\\+FW[^\[<']/g.toString() + ',',
                /\\+rb\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+RB\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+G\<.*?\>[　 ]*\/\/.*/gi.toString() + ',',
                /\\+G\<.*?\>/gi.toString() + ',',
                /\<DEP_.*?\>[　 ]*\/\/.*/gi.toString() + ',',
                /\<DEP_.*?\>/gi.toString() + ',',
                /id: \d+/gm.toString() + ',',
                /secretTitle: ?/g.toString() + ',',
                /secretText: ?/g.toString() + ',',
                /title: ?/g.toString() + ',',
                /<hzExState.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<hzExState.+?>/gi.toString() + ',',
                /<seal_escape>[　 ]*\/\/.*/gi.toString() + ',',
                /<seal_escape>/gi.toString() + ',',
                /\\+set\[\d+\]/gi.toString() + ',',
                /回想シーン解放コード：[０１２３４５６７８９]+/g.toString() + ',',
                '//Ace parameters confirmed to be untranslatable',
                /\\+[p|r|l]\[[^\]\r\n]+\]/g.toString() + ',',
                /(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)バトラーグラフィック=.*/gi.toString() + ',',
                '//Ace parameters assumed to be untranslatable',
                /\[オートステート：\d+?\][　 ]*\/\/.*/gi.toString() + ',',
                /\[オートステート：\d+?\]/gi.toString() + ',',
                /<エンカウント:\d+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<エンカウント:\d+?>/gi.toString() + ',',
                /<属性強化 \d+?\-\d+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<属性強化 \d+?\-\d+?>/gi.toString() + ',',
                //gi.toString() + ',',
                //gi.toString() + ',',
                '// VX Choice',
                /^[\"\'\`\’]?選択肢\[\d\]：?/gi.toString() + ',',
                //^選択肢(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                '// PIC',
                /\\+PICN\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICN\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]/gi.toString() + ',',
/*                 '// pauses',
                /\\+!/gi.toString() + ',',
                /\\+\|/gi.toString() + ',', */
                '// vo script stuff',
                /\\+vo\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\[OFF\]/gi.toString() + ',',
                /\[ON\]/gi.toString() + ',',
                '// I dunno man',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[０１２３４５６７８９]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[０１２３４５６７８９]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[0123456789]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[0123456789]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[０１２３４５６７８９]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[０１２３４５６７８９]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[0123456789]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[0123456789]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)id: \d+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)icon: \d+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)secret: true(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)secret: false(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /<アイテムカラー:\d+>/gi.toString() + ',',
                //<強化対象盾>/gi.toString() + ',',
                //<宝珠抽出盾>/gi.toString() + ',',
                /<FEATURE.+>[　 ]*\/\/.*/gi.toString() + ',',
                /<FEATURE.+>/gi.toString() + ',',
                /<BATK:.+>[　 ]*\/\/.*/gi.toString() + ',',
                /<BATK:.+>/gi.toString() + ',',
                /<BMDF:.+>[　 ]*\/\/.*/gi.toString() + ',',
                /<BMDF:.+>/gi.toString() + ',',
                /<BDEF:.+>[　 ]*\/\/.*/gi.toString() + ',',
                /<BDEF:.+>/gi.toString() + ',',
                /<使用効果追加.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<使用効果追加.+?>/gi.toString() + ',',
                /\\+SVVN\[[^\]\r\n]+?\]/gi.toString() + ',',
                //<宝珠>/gi.toString() + ',',
                /<被弾時最大MP割合増減:.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<被弾時最大MP割合増減:.+?>/gi.toString() + ',',
                /<ドロップ率増減:.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<ドロップ率増減:.+?>/gi.toString() + ',',
                /<攻撃ID変更:.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<攻撃ID変更:.+?>/gi.toString() + ',',
                /<行動後反撃率:.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<行動後反撃率:.+?>/gi.toString() + ',',
                /<戦闘開始時発動 \d+?,\d+?%>[　 ]*\/\/.*/gi.toString() + ',',
                /<戦闘開始時発動 \d+?,\d+?%>/gi.toString() + ',',
                /<わざタイプ.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<わざタイプ.+?>/gi.toString() + ',',
                /<成長:.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<成長:.+?>/gi.toString() + ',',
                /<UM:.+?>[　 ]*\/\/.*/gi.toString() + ',',
                /<UM:.+?>/gi.toString() + ',',
                /\\+NEXT/g.toString() + ',',
                /(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ターン消費無し:\d+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                //<未鑑定装備>/gi.toString() + ',',
                /<図鑑特徴:/gi.toString() + ',',
                /<図鑑説明:/gi.toString() + ',',
                /<変数変更:.+?>/gi.toString() + ',',
                /<使用条件:.+?>/gi.toString() + ',',
                /<スキルポイント.+?>/gi.toString() + ',',
                /<保存禁止>/gi.toString() + ',',
                /<所持制限:\d+>/gi.toString() + ',',
                /<自動蘇生:.+?>/gi.toString() + ',',
                /<獲得金額率増減:.+?>/gi.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)title:[　 \n]*/g.toString() + ',',
                /.*SceneManager.*/gi.toString() + ',',
                /.*\$game(?!screen).*/gi.toString() + ',',
                /^\$gameScreen\.OriginalMessage\([^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*?\);$/gi.toString() + ',',
                /[　 ]*[・]?\\+\.・[\\\.・]+[　 \n]*/gi.toString() + ',',
                /[　 ]*[・]?\\+\.・[　 \n]*/gi.toString() + ',',
                /[　 ]*[・]?\\+\.[　 \n]*/gi.toString() + ',',
                /\\+\[\"\'\`\’]?$/gi.toString() + ',',
                /^[\"\'\`\’]?SYSTEM/g.toString() + ',',
                /\\+se\[[^\]\r\n]+\]:?/gi.toString() + ',',
                /_SE\[[^\]\r\n]+\]/g.toString() + ',',
                /\\+sm\[[^\]\r\n]+\]:/gi.toString() + ',',
                /<book\:no>/gi.toString() + ',',    
                /<fsOffsetY:.+>/gi.toString() + ',',    
                /<fsOffsetX:.+>/gi.toString() + ',',    
                /<BE.+>/gi.toString() + ',',    
                /<MaxSlipDamage:.+>/gi.toString() + ',',    
                /<desc.+?:/gi.toString() + ',',    
                /<ステートヘルプ>/gi.toString() + ',',    
                /<永続ステート>/gi.toString() + ',',    
                '// Make text Bigger or Smaller effect',
                /\\+[{}]/gi.toString() + ',',    
                '// special dots',
                //・・+/gi.toString() + ',',    
                '// Externmessage',
                /^[\"\'\`\’]?:event\[[^\]\r\n]+?\]/gim.toString() + ',',
                /\\+M\[[^\]\r\n]+?\]/gi.toString() + ',',                
                /^[\"\'\`\’]?:name\[/gim.toString() + ',',
                '// wrap plugin',
                /<wrap>/g.toString() + ',',
                /(?<=[^a-zA-z]|^)wrap(?=[^a-zA-z]|$)/g.toString() + ',',
                '// Choice Help RightClick',
                /^[\"\'\`\’]?選択肢ヘルプ\n/gi.toString() + ',',
                /^[\"\'\`\’]?選択肢ヘルプ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                //^右クリック$/g.toString() + ',',
                /^[\"\'\`\’]?<ActiveMessage:/gim.toString() + ',',
                '// Untranslatable SG Quests',
                /^<composite:[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?>[　 ]*$/gm.toString() + ',',
                /^<composite:[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?>[　 ]*\/\/.*/gm.toString() + ',',
                /^[\"\'\`\’]?<SG((手動)|(カテゴリ)|(ピクチャ))[\s\S]*?>[　 ]*$/gim.toString() + ',',
                /^[\"\'\`\’]?<SG((手動)|(カテゴリ)|(ピクチャ))[\s\S]*?>[　 ]*\/\/.*/gim.toString() + ',',
                /^[\"\'\`\’]?<Category:.+?>[　 ]*$/gim.toString() + ',',
                /^[\"\'\`\’]?<Category:.+?>[　 ]*\/\/.*/gim.toString() + ',',
                '// Translatable SG Quest',
                /^[\"\'\`\’]?<SG.+?:/gim.toString() + ',',
                '// item inserts',
                //\\+i\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// variable inserts',
                //\\+v\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+w\[[+-]?\d+?\]/gi.toString() + ',',
                '// Ihavenoidea inserts',
                /^[\"\'\`\’]?メッセージ = /gim.toString() + ',',
                /^[\"\'\`\’]?表示文字列 = /gim.toString() + ',',
                /\\+oc\[rgb\(.+\)\]/g.toString() + ',',
                /\\+VS\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]/gi.toString() + ',',
                /\\+NA\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]/gi.toString() + ',',
                /_S<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?>/gi.toString() + ',',
                /SG<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?>/gi.toString() + ',',
                /^[\"\'\`\’]?_EventSetting = "[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\"]?";[\"\'\`\’]?$/gm.toString() + ',',
                /_CT>+/gi.toString() + ',',
/*                 /\\+s</gi.toString() + ',',
                /\\+s\[/gi.toString() + ',',
                /\\+p\[/gi.toString() + ',',
                /\\+b\[/gi.toString() + ',', */
                /DW_目標設定[ |　]?/g.toString() + ',',
                /\|\d\|\d\>/g.toString() + ',',
                /\<quest \d+\:/g.toString() + ',',
                /\<\/quest\>/g.toString() + ',',
                /\\+x1bI[\d]+/g.toString() + ',',
                /^[\"\'\`\’]?[ ]?[<]?namePop[:]?[ |　][-]?[\d]*[ ]?/gm.toString() + ',',
                /[ |　]?[\-]?[\d]*[ ]?[ ]?(?:red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)[>]?[\"\'\`\’]?$/g.toString() + ',',
                /<namePop:/g.toString() + ',',
                /^[ 　]+$/g.toString() + ',',
                '// Escaped Text',
                /^[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*?\/\/.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+.*$/gim.toString() + ',',
                //'// Potential Filenames', //too many false positives
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]*[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]*_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                '// Linebreaks',
                /[　 ]*\\+[n](?![\[\<a-zA-Z])[　 ]*/gim.toString() + ',',
                '// Colors',
                //\c\[\d+\]/gi.toString() + ',',
                '// Cornerbrackets',
                //[｢「『｣」』]/g.toString() + ',',
                '//Lone Whitespace',
                /^[　 \s]+$/gim.toString() + ',',
            ].join('\n'),
            description: "\nIF YOU ARE TRANSLATING FROM SOMETHING OTHER THAN JAPANESE CHANGE ALL \"一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\" BITS TO WHATEVER YOUR SOURCE LANGUAGE IS!\nIF YOU ARE TRANSLATING TO SOMETHING OTHER THAN ENGLISH REMOVE ALL THE PRE-DEFINED TRANSLATIONS!" +
                '\nSplits sentences according to patterns.' +
                "\nSplitting is very similar to Protected Patterns - they match a pattern and protect it. Generally no benefit in using except in certain projects. You'll know it when you see it." +
                '\nThere are two differences: the first is that splitting leaves nothing to chance - the original position of the matched pattern, its contents, everything will be separated and not even sent to the translator at all.' +
                "\nThe second difference is that the sentence will be split (as the name implies) every time a pattern appears. So while this guarantees the pattern will absolutely be protected, the translator might miss out on contextual cues. This is best used for text that can't be translated (script calls, etc) or something that must survive the translation process no matter what." +
                '\nSplitting out untranslatable symbols that are not related to the sentence improves translation quality and speed with no downsides.' +
                exports.PatternExplanation,
            name: 'Aggressive Splitting',
            category: TranslationEngineOptionCategories.PATTERNS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '500px'
            }
        });
        this.optionBreakPatterns = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'linebreakPatterns',
            default: [
                //'// Blank lines',
                //\s*\r?\n\s*\r?\n/g.toString() + ',',
                //'// Current sentence ended with punctuation',
                //(?<!(?:^[\s　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+[ 　]*\\*c?\[?\d*\]?[ 　]*(?:\\+n\[\d+\]|[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*|\\+n[w]?<[^>]+?>[ 　]*|\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*)[ 　]*\\*c?\[?\d*\]?[ 　]*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+nw?\[\d+\][ 　]*\\?<?[ 　]*))(?<=[─~\-<>\|\/：；;:\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩\*"'`´◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#])(\s*\r?\n)(?!(?:^[\s　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+[ 　]*\\*c?\[?\d*\]?[ 　]*(?:\\+n\[\d+\]|[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*|\\+n[w]?<[^>]+?>[ 　]*|\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*)[ 　]*\\*c?\[?\d*\]?[ 　]*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+nw?\[\d+\][ 　]*\\?<?[ 　]*))/gmi.toString() +
                //    ',',
                //'// Next sentence starts with a symbol/opener/punctuaction for some reason',
                //(?<!(?:^[\s　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+[ 　]*\\*c?\[?\d*\]?[ 　]*(?:\\+n\[\d+\]|[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*|\\+n[w]?<[^>]+?>[ 　]*|\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*)[ 　]*\\*c?\[?\d*\]?[ 　]*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+nw?\[\d+\][ 　]*\\?<?[ 　]*))(\r?\n\s*)(?!(?:^[\s　]*\\?>?[ 　]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+[ 　]*\\*c?\[?\d*\]?[ 　]*(?:\\+n\[\d+\]|[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+[Ａ-Ｚａ-ｚ０-９？！＃＄％＆\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ 　]*|\\+n[w]?<[^>]+?>[ 　]*|\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*)[ 　]*\\*c?\[?\d*\]?[ 　]*[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+n[w]?<[^>]+?>[ 　]*\\+[FA]+[h]?\[[^\]]+?\][ 　]*\\?<?[ 　]*)|(?:^[\s　]*\\?>?[ 　]*\\+nw?\[\d+\][ 　]*\\?<?[ 　]*))(?=[─~\-<>\|\/：；;:〔〖〘〚\’〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]|[\w０１２３４５６７８９ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ]+[〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][wW]?\[[^\]\r\n]+?][〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][wW]?<.+?>[〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][aA][mM][eE]\[[^\]\r\n]+?][〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][aA][mM][eE]<.+?>[〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓])/gmi.toString() +
                //    ','
            ].join('\n'),
            description: 'The core of Red Text Processor, but basically just murders context for DSLR. Separates sentences according to when it looks like the previous sentence ended, sending them to the translator separatedly.\n' +
                '\nThe default rules are pretty solid, but feel free to change them. The behavior of these patterns is that whatever matches them will be removed and replaced by a simple line break.' +
                exports.PatternExplanation,
            name: 'Line Break Patterns',
            category: TranslationEngineOptionCategories.PATTERNS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '100px'
            }
        });
        this.optionIsolatePatterns = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'isolatePatterns',
            default: [
                 // '// Names Catchall',
                /\\+[\w_]+(?<!\\n|\\nw)<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                //\\+[\w_]+<[^\>\r\n]+?>/gi.toString() + ',',
                /\\+[\w_]+(?<!\\G|\\fs|\\RB|\\rb|\\p|\\l|\\r|\\F|\\FF|\\FFF|\\FFFF|\\FFFFF|\\FFFFFF|\\FFFFFFF|\\FFFFFFFF|\\FFFFFFFFF|\\FFFFFFFFFF|\\A|\\AA|\\AAA|\\AAAA|\\AAAAA|\\AAAAAA|\\AAAAAAA|\\AAAAAAAA|\\AAAAAAAAA|\\AAAAAAAAAA|\\p|\\FH|\\SVVN|\\se|\\SE|\\_SE|\\M|\\oc|\\VS|\\NA|\\vs|\\na|\\PICN|\\PICE|\\picn|\\pice|\\c|\\C)\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^\]]*?\]/g.toString() + ',',
                //\\+[\w_]+(?<!\\G|\\fs|\\RB|\\rb|\\p|\\l|\\r|\\F|\\FF|\\FFF|\\FFFF|\\FFFFF|\\FFFFFF|\\FFFFFFF|\\FFFFFFFF|\\FFFFFFFFF|\\FFFFFFFFFF|\\A|\\AA|\\AAA|\\AAAA|\\AAAAA|\\AAAAAA|\\AAAAAAA|\\AAAAAAAA|\\AAAAAAAAA|\\AAAAAAAAAA|\\p|\\FH|\\SVVN|\\se|\\SE|\\_SE|\\M|\\oc|\\VS|\\NA|\\vs|\\na|\\PICN|\\PICE|\\picn|\\pice|\\c|\\C|\\i|\\I|\\v|\\V)\[[^\]\r\n]*?[^\]\r\n\d]+?[^\]\r\n]*?\]/g.toString() + ',',
                // '// plugin stuff',
                //BattleManager\._logWindow\.addText\('.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?'\);/gi.toString() + ',',
                /\\+VS\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/gi.toString() + ',',
                //(?<=\\VS)\[[^\[\]]+?\]/gi.toString() + ',',
                //^_EventSetting = ".*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?";$/g.toString() + ',',
                //'// Isolate colored text',
                //\\+C\[[^\]\r\n]+?\].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\\+C\[[^\]\r\n]+?\]/gi.toString() + ',',
                // '// Isolate VX NA',
                /\\+NA\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/gi.toString() + ',',
                //(?<=\\NA)\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// Isolate MZ stacked text',
                /\{.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\|.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\}/gi.toString() + ',',
                '// Isolate MZ Text Scripts',
                /テキスト-.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                //^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\".*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\"\;$/gim.toString() + ',',
                // '// Isolate SG Quest Scripts',
                /<SG.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                /_S<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
//                '// Carefully isolate quotes, except the ones that look like script',
//                /((?<![\w\\])((\[[^\[\]]+\])|(\([^\(]+\)))|(?<![\w\\])(\<[^\<\>]+\>))/gi.toString() + ',',
                //(?<![\w\\])\(.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\)/gi.toString() + ',',
                //(?<![\w\\])\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/gi.toString() + ',',
                //(?<![\w\\])<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                //(?<=[a-zA-z]|^)['].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?[']/gi.toString() + ',',
                //\\\".+?\\\"/gi.toString() + ',',
                //\\\'.+?\\\'/gi.toString() + ',',
//                '// Isolates matching quoted text',
//                ..._Constants_1.isolationGroupsRegExp
            ].join('\n'),
            description: "\nIF YOU ARE TRANSLATING FROM SOMETHING OTHER THAN JAPANESE CHANGE ALL \"一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\" BITS TO WHATEVER YOUR SOURCE LANGUAGE IS!" +
                '\nThis option has de-duplication, do not use it on something repeated for context.\n' +
                "The entire match will be isolated. This is best when paired with Cutting Corners patterns which also remove the boundary symbols - the translator doesn't benefit from seeing the quotes or brackets." +
                exports.PatternExplanation,
            name: 'Isolation Patterns',
            category: TranslationEngineOptionCategories.PATTERNS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '100px'
            }
        });
        this.optionSplitEndsPatterns = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'splitEndsPatterns',
default: [
                //"// Pure english, uncomment for sources that don't use english characters",
                //^[\x21-\x7E\* ]+$/g.toString() + ',',
                '// Cells that do not include Japanese or placeholders',
                /^[　\s]*(?!.*\\+[niv]w?\[\d+\])[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ@]+[　\s]*$/gi.toString() + ',',
                //'// Remove isolation pattern placeholders at start or end. This is to deal with \\n<> nameplate spam, but might cause issues.',
                //^\s*@\d+|@\d+\s*$/g.toString() + ',',
                '// Common plugin calls',
                '// D_TEXT is handled by DSLR itself because of the font size value',
                /((^DW_[A-Z]+ )|(^addLog )|(^greedCommand )|(^ShowInfo )|(^text_indicator :)|(^.+?subject=))/g.toString() + ',',
                '// files',
                /^.*mplus-1.*$/gi.toString() + ',',
                /^.*vl-gothic.*$/gi.toString() + ',',
                /^.+\.(png|jpg|ttf|woff|otf|txt|ini|rvdata|rgss|json|js|wav|ogg|mp3|mp4|m4a|bmp|exe).*$/gi.toString() + ',',
                '//This existing causes significant issues with deepseek for whatever reason',
                /\\+<$/g.toString() + ',',
                /^\\?>?[　 ]*\\+</gm.toString() + ',',
                '// The isolated patterns are bad for big LLMs block',
                /^\\+[\w_]+(?<!\\n|\\nw)(?=<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>)/gi.toString() + ',',
                /^\\+[\w_]+(?<!\\G|\\fs|\\RB|\\rb|\\p|\\l|\\r|\\F|\\FF|\\FFF|\\FFFF|\\FFFFF|\\FFFFFF|\\FFFFFFF|\\FFFFFFFF|\\FFFFFFFFF|\\FFFFFFFFFF|\\A|\\AA|\\AAA|\\AAAA|\\AAAAA|\\AAAAAA|\\AAAAAAA|\\AAAAAAAA|\\AAAAAAAAA|\\AAAAAAAAAA|\\p|\\FH|\\SVVN|\\se|\\SE|\\_SE|\\M|\\oc|\\VS|\\NA|\\vs|\\na|\\PICN|\\PICE|\\picn|\\pice|\\c|\\C|\\i|\\I|\\v|\\V|\\n|\\N|\\nw|\\NW)(?=\[[^\]]*[^\d\]])/g.toString() + ',',
                '// plugin stuff',
                /^BattleManager\._logWindow\.addText(?=\()/gim.toString() + ',',
                /\\+VS(?=\[)/gim.toString() + ',',
                /\\+NA(?=\[)/gim.toString() + ',',
                //(?<=\\VS)\[[^\[\]]+?\]/gi.toString() + ',',
                /^_EventSetting = ".*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?";[\"\'\`\’]?$/gm.toString() + ',',
                //'// Isolate colored text',
                //\\+C\[[^\]\r\n]+?\].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\\+C\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]/g.toString() + ',',
                
                '// Isolate VX NA',
                /^[\"\'\`\’]?\\+NA(?=\[)/gim.toString() + ',',
                //(?<=\\NA)\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// Isolate MZ stacked text',
                //\{.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\|.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\}/gi.toString() + ',',
                '// Isolate MZ Text Scripts',
                //^テキスト-.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gim.toString() + ',',
                /^[\"\'\`\’]?\$gameVariables\.value\(\d+\)\[\d+\] ?= ?(?=\")/gim.toString() + ',',
                '// Isolate SG Quest Scripts',
                //<SG.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                /^[\"\'\`\’]?_S(?=\<)/gim.toString() + ',',
//                '// Carefully isolate quotes, except the ones that look like script',
//                /((?<![\w\\])((\[[^\[\]]+\])|(\([^\(]+\)))|(?<![\w\\])(\<[^\<\>]+\>))/gi.toString() + ',',
                //(?<![\w\\])\(.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\)/gi.toString() + ',',
                //(?<![\w\\])\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/gi.toString() + ',',
                //(?<![\w\\])<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                //(?<=[a-zA-z]|^)['].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?[']/gi.toString() + ',',
                //\\\".+?\\\"/gi.toString() + ',',
                //\\\'.+?\\\'/gi.toString() + ',',
                '// Plugins',
                /BattleManager\._logWindow\.addText\(\'[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\'\)]*?\'\);/g.toString() + ',',
                /BattleManager\._logWindow\.addText\(\'/g.toString() + ',',
                /<Custom \w+? Effect>[\s\S]*?<\/Custom \w+? Effect>/gi.toString() + ',',
                /\\+#/g.toString() + ',',
                //[%#]\d+\\G/g.toString() + ',',
                /[#]\d+\\+G(?![a-zA-Z])/g.toString() + ',',
                //(?<!%)\d+[%]\d*%?\d*%?/g.toString() + ',',
                //[　 ]*[%#]\d+[　 ]*/g.toString() + ',',
                /[　 ]*[#]\d+[　 ]*/g.toString() + ',',
                //@\d+(?=[^@]|$)/g.toString() + ',',
                //[%][sd](?![a-z])/g.toString() + ',',
                /\\+rb\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+RB\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+G\<.*?\>/gi.toString() + ',',
                /^[\"\'\`\’]?GabText /gm.toString() + ',',
                /id: \d+/gm.toString() + ',',
                /secretTitle: ?/g.toString() + ',',
                /secretText: ?/g.toString() + ',',
                /title: ?/g.toString() + ',',
                /<hzExState.+?>/gi.toString() + ',',
                /<seal_escape>/gi.toString() + ',',
                /\\+set\[\d+\]/gi.toString() + ',',
                /回想シーン解放コード：[０１２３４５６７８９]+/g.toString() + ',',
                '//Ace parameters confirmed to be untranslatable',
                /\\+[p|r|l]\[[^\]\r\n]+\]/g.toString() + ',',
                /(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)バトラーグラフィック=.*/gi.toString() + ',',
                '//Ace parameters assumed to be untranslatable',
                /\[オートステート：\d+?\]/gi.toString() + ',',
                /<エンカウント:\d+?>/gi.toString() + ',',
                /<属性強化 \d+?\-\d+?>/gi.toString() + ',',
                '// MZ Script text',
                /^[\"\'\`\’]?テキスト-/g.toString() + ',',
                /^[\"\'\`\’]?\$gameVariables\.value\(\d+\)\[\d+\] ?= ?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*[\"\'\`\’]?$/gim.toString() + ',',
                /^[\"\'\`\’]?\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\"?/gim.toString() + ',',
                '// If',
                /\\+[n]\[\\+[\w]\[\d+\]\]?.+if\(v\[\d+\] \!\= \d+\) en\(s\[\d+\]\)/gi.toString() + ',',
                /\\+[n]\[\\+[\w]\[\d+\]\]?/gi.toString() + ',',
                /if\(v\[\d+\] ?[>=<\-+!?]+ ?\d+\)/gi.toString() + ',',
                /if\([\w]\[\d+\] \!\= \d+\) en\([\w]\[\d+\]\)/gi.toString() + ',',
                /if\([\w]\[\d+\]/gi.toString() + ',',
                /[en|if]+\([\w]\[\d+\][ \>\=\d&|true|false]*v?\[?\d*\]?[ \>\=\d&|true|false]*\)/gi.toString() + ',',
                /\!\= \d+\)/gi.toString() + ',',
                /if\([\w]/gi.toString() + ',',
                /if\([\w]\[\d+\]==true\)/gi.toString() + ',',
                /if\([\w]\[\d+\]==false\)/gi.toString() + ',',
                /if\([\w]\[\d+\]/gi.toString() + ',',
                /if\([\w]/gi.toString() + ',',
                //gi.toString() + ',',
                //gi.toString() + ',',
                '// VX Choice',
                /^[\"\'\`\’]?選択肢\[\d]：?/gim.toString() + ',',
                //^選択肢(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                '// PIC',
                /\\+PICN\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICN\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]/gi.toString() + ',',
/*                 '// pauses',
                /\\+!/gi.toString() + ',',
                /\\+\|/gi.toString() + ',', */
                '// vo script stuff',
                /\\+vo\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// FFF script stuff',
                /\\+F+?\[[^\]\r\n]+?\]\]/gi.toString() + ',',
                /\\+F+?\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+A+?\[[^\]\r\n]+?\]\]/gi.toString() + ',',
                /\\+A+?\[[^\]\r\n]+?\]/gi.toString() + ',',
                /^[\"\'\`\’]?\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /^[\"\'\`\’]?\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /^[\"\'\`\’]?\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /\\+FH\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\[OFF\]/gi.toString() + ',',
                /\[ON\]/gi.toString() + ',',
                '// I dunno man',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[０１２３４５６７８９]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[０１２３４５６７８９]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[0123456789]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[0123456789]+\n(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[０１２３４５６７８９]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[０１２３４５６７８９]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ID[0123456789]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ＩＤ[0123456789]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)id: \d+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)icon: \d+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)secret: true(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)secret: false(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 \n]*/g.toString() + ',',
                /<アイテムカラー:\d+>/gi.toString() + ',',
                //<強化対象盾>/gi.toString() + ',',
                //<宝珠抽出盾>/gi.toString() + ',',
                /<FEATURE.+>/gi.toString() + ',',
                /<BATK:.+>/gi.toString() + ',',
                /<BMDF:.+>/gi.toString() + ',',
                /<BDEF:.+>/gi.toString() + ',',
                /<使用効果追加.+?>/gi.toString() + ',',
                /\\+SVVN\[[^\]\r\n]+?\]/gi.toString() + ',',
                //<宝珠>/gi.toString() + ',',
                /<被弾時最大MP割合増減:.+?>/gi.toString() + ',',
                /<ドロップ率増減:.+?>/gi.toString() + ',',
                /<攻撃ID変更:.+?>/gi.toString() + ',',
                /<行動後反撃率:.+?>/gi.toString() + ',',
                /<戦闘開始時発動 \d+?,\d+?%>/gi.toString() + ',',
                /<わざタイプ.+?>/gi.toString() + ',',
                /<成長:.+?>/gi.toString() + ',',
                /<UM:.+?>/gi.toString() + ',',
                /\\+NEXT/g.toString() + ',',
                /(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ターン消費無し:\d+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                //<未鑑定装備>/gi.toString() + ',',
                /<図鑑特徴:/gi.toString() + ',',
                /<図鑑説明:/gi.toString() + ',',
                /<変数変更:.+?>/gi.toString() + ',',
                /<使用条件:.+?>/gi.toString() + ',',
                /<スキルポイント.+?>/gi.toString() + ',',
                /<保存禁止>/gi.toString() + ',',
                /<所持制限:\d+>/gi.toString() + ',',
                /<自動蘇生:.+?>/gi.toString() + ',',
                /<獲得金額率増減:.+?>/gi.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)title:[　 \n]*/g.toString() + ',',
                /.*SceneManager.*/gi.toString() + ',',
                /.*\$game.*/gi.toString() + ',',
                /[　 ]*[・]?\\+\.・[\\\.・]+[　 \n]*/gi.toString() + ',',
                /[　 ]*[・]?\\+\.・[　 \n]*/gi.toString() + ',',
                /[　 ]*[・]?\\+\.[　 \n]*/gi.toString() + ',',
                /\\+\[\"\'\`\’]?$/gi.toString() + ',',
                /^[\"\'\`\’]?SYSTEM/g.toString() + ',',
                /\\+se\[[^\]\r\n]+\]:/gi.toString() + ',',
                /_SE\[[^\]\r\n]+\]/g.toString() + ',',
                /\\+sm\[[^\]\r\n]+\]:/gi.toString() + ',',
                /<book\:no>/gi.toString() + ',',    
                /<fsOffsetY:.+>/gi.toString() + ',',    
                /<fsOffsetX:.+>/gi.toString() + ',',    
                /<BE.+>/gi.toString() + ',',    
                /<MaxSlipDamage:.+>/gi.toString() + ',',    
                /<desc.+?:/gi.toString() + ',',    
                /<ステートヘルプ>/gi.toString() + ',',    
                /<永続ステート>/gi.toString() + ',',    
                '// Make text Bigger or Smaller effect',
                /\\+[{}]/gi.toString() + ',',    
                '// special dots',
                //・・+/gi.toString() + ',',    
                '// Externmessage',
                /^[\"\'\`\’]?:event\[[^\]\r\n]+?\]/gim.toString() + ',',
                /\\+M\[[^\]\r\n]+?\]/gi.toString() + ',',                
                /^[\"\'\`\’]?:name\[/gim.toString() + ',',
                '// wrap plugin',
                /<wrap>/g.toString() + ',',
                /(?<=[^a-zA-z]|^)wrap(?=[^a-zA-z]|$)/g.toString() + ',',
                '// Choice Help RightClick',
                /^[\"\'\`\’]?選択肢ヘルプ\n/gi.toString() + ',',
                /^[\"\'\`\’]?選択肢ヘルプ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                //^右クリック$/g.toString() + ',',
                /^[\"\'\`\’]?<ActiveMessage:/gim.toString() + ',',
                '// Untranslatable SG Quests',
                /^[\"\'\`\’]?<SG((手動)|(カテゴリ)|(ピクチャ))[\s\S]*?>/gim.toString() + ',',
                /^[\"\'\`\’]?<Category:.+?>/gim.toString() + ',',
                '// Translatable SG Quest',
                /^[\"\'\`\’]?<SG.+?:/gim.toString() + ',',
                /\\+oc\[rgb\(.+\)\]/g.toString() + ',',
                /\\+VS\[/gi.toString() + ',',
                /_CT>+/gi.toString() + ',',
                /\\+NA\[/gi.toString() + ',',
                '// item inserts',
                //\\+i\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// variable inserts',
                //\\+v\[[^\]\r\n]+?\]/gi.toString() + ',',
                //\\+w\[[+-]?\d+?\]/gi.toString() + ',',
                '// Ihavenoidea inserts',
                /^[\"\'\`\’]?メッセージ = /gim.toString() + ',',
                /^[\"\'\`\’]?表示文字列 = /gim.toString() + ',',
                /\\+oc\[rgb\(.+\)\]/g.toString() + ',',
                /\\+VS\[/gi.toString() + ',',
/*                 /\\+s</gi.toString() + ',',
                /\\+s\[/gi.toString() + ',',
                /\\+p\[/gi.toString() + ',',
                /\\+b\[/gi.toString() + ',', */
                /DW_目標設定[ |　]?/g.toString() + ',',
                /\|\d\|\d\>/g.toString() + ',',
                /\<quest \d+\:/g.toString() + ',',
                /\<\/quest\>/g.toString() + ',',
                /\\+x1bI[\d]+/g.toString() + ',',
                /^[\"\'\`\’]?[ ]?[<]?namePop[:]?[ |　][-]?[\d]*[ ]?/gm.toString() + ',',
                /[ |　]?[\-]?[\d]*[ ]?[ ]?(?:red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)[>]?[\"\'\`\’]?$/g.toString() + ',',
                /<namePop:/g.toString() + ',',
                '// Comment?',
                /\/\/.+?[\"\'\`\’]?$/g.toString() + ',',
                '// If Target Language is not English remove everything below this until the other message',
                '// Specific MV/MZ System entries',
                /^%1には効かなかった！$|^%1は %2 のダメージを受けた！$|^%1は%2を %3 奪われた！$|^%1の%2が %3 増えた！$|^%1の%2が %3 減った！$|^%1はダメージを受けていない！$|^ミス！　%1はダメージを受けていない！$|^%1の%2が %3 回復した！$|^%1の%2が上がった！$|^%1の%2が元に戻った！$|^%1の反撃！$|^%1の%2が下がった！$|^%1は戦いに敗れた。$|^%1が出現！$|^%1に %2 のダメージを与えた！$|^%1の%2を %3 奪った！$|^%1にダメージを与えられない！$|^ミス！　%1にダメージを与えられない！$|^%1は逃げ出した！$|^%1は攻撃をかわした！$|^次の%1まで$|^現在の%1$|^%1は%2 %3 に上がった！$|^%1は魔法を打ち消した！$|^%1は魔法を跳ね返した！$|^%1 の%2を獲得！$|^お金を %1\\G 手に入れた！$|^%1を手に入れた！$|^%1を覚えた！$|^%1たち$|^%1は先手を取った！$|^%1が%2をかばった！$|^%1は不意をつかれた！$|^%1は%2を使った！$|^%1の勝利！$/g.toString() + ',',
                '// Specific MV/MZ States entries',
                /^%1は倒れた！$|^%1を倒した！$|^%1は立ち上がった！$|^%1は毒にかかった！$|^%1に毒をかけた！$|^%1の毒が消えた！$|^%1は暗闇に閉ざされた！$|^%1を暗闇に閉ざした！$|^%1の暗闇が消えた！$|^%1は沈黙した！$|^%1を沈黙させた！$|^%1の沈黙が解けた！$|^%1は激昂した！$|^%1を激昂させた！$|^%1は我に返った！$|^%1は混乱した！$|^%1を混乱させた！$|^%1は魅了された！$|^%1を魅了した！$|^%1は眠った！$|^%1を眠らせた！$|^%1は眠っている。$|^%1は目を覚ました！$|^%1はしびれて動けなくなった！$|^%1を麻痺させた！$|^%1は体がしびれて動けない！$|^%1の麻痺が解けた！$|^%1はバランスを崩した！$|^%1はバランスを崩している……$|^%1は体勢を立て直した！$|^%1は狙われやすくなった！$|^%1は狙われにくくなった！$|^%1は炎の力を身にまとった。$|^%1は氷の力を身にまとった。$|^%1は雷の力を身にまとった%1は炎や氷の攻撃に強くなった$|^炎や氷に強くなっている$|^水のガードの効果が切れた$|^%1は分身して２回行動できるようになった$|^%1は分身している$|^%1の分身が切れた$/g.toString() + ',',
                '// Specific VX/Ace Scripts entries',
                /^所持数$|^購入する$|^売却する$|^やめる$|^持っている数$|^現在の経験値$|^どのファイルにセーブしますか？$|^どのファイルをロードしますか？$|^ファイル$|^会心の一撃！！$|^痛恨の一撃！！$|^しかし逃げることはできなかった！$|^戦闘に勝利した$|^%sが現れた！$|^%sの先制！$|^%sは退却した$|^%sは戦いに敗れた…$|^%s の経験値を獲得$|^%s\\\\G 手に入れた$|^%sを手に入れた$|^%sは%s %s に上がった$|^%sを覚えた$|^次の%sまで$|^%sは逃げてしまった。$|^お金を %s%s 手に入れた！$|^%sの攻撃！$|^%sは身を守っている。$|^%sは様子を見ている。$|^%sたち$|^%sが出現！$|^%sは先手を取った！$|^%sは不意をつかれた！$|^%sは逃げ出した！$|^%sの勝利！$|^%sは戦いに敗れた。$|^%s の経験値を獲得！$|^お金を %s\\\\G 手に入れた！$|^%sを手に入れた！$|^%sは%s %s に上がった！$|^%sを覚えた！$|^%sは%sを使った！$|^%sは %s のダメージを受けた！$|^%sの%sが %s 回復した！$|^%sの%sが %s 増えた！$|^%sの%sが %s 減った！$|^%sは%sを %s 奪われた！$|^%sはダメージを受けていない！$|^ミス！　%sはダメージを受けていない！$|^%sに %s のダメージを与えた！$|^%sの%sを %s 奪った！$|^%sにダメージを与えられない！$|^ミス！　%sにダメージを与えられない！$|^%sは攻撃をかわした！$|^%sは魔法を打ち消した！$|^%sは魔法を跳ね返した！$|^%sの反撃！$|^%sが%sをかばった！$|^%sの%sが上がった！$|^%sの%sが下がった！$|^%sの%sが元に戻った！$|^%sには効かなかった！$|^お金を %s%s 失った。$|^%sの%sが %s に下がってしまった。$/g.toString() + ',',
                '//Specific pre defined translations',
                //\\+[a-zA-Z]\[\d+\]/gi.toString() + ',',
                /<\d+,\d+>/g.toString() + ',',
                /^[　 ]*カナ[　 ]*$/g.toString() + ',',
                /^[　 ]*決定[　 ]*$/g.toString() + ',',
                /^[　 ]*英数[　 ]*$/g.toString() + ',',
                /^[　 ]*かな[　 ]*$/g.toString() + ',',
                /^[　 ]*【剣】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【杖】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【フレイル】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【斧】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【槍】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【爪】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【弓】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【短剣】[　 ]*$/gi.toString() + ',',
                /^[　 ]*【グローブ】[　 ]*$/gi.toString() + ',',
                /^[　 ]*なし[　 ]*$/gi.toString() + ',',
                /^[　 ]*続きから[　 ]*$/gi.toString() + ',',
                /^[　 ]*昼[　 ]*$/gi.toString() + ',',
                /^[　 ]*ボイス 音量[　 ]*$/gi.toString() + ',',
                /^[　 ]*ベリーハード[　 ]*$/gi.toString() + ',',
                /^[　 ]*身分[　 ]*$/gi.toString() + ',',
                /^[　 ]*状態[　 ]*$/gi.toString() + ',',
                /^[　 ]*はぁはぁ[　 ]*$/g.toString() + ',',
                /^[　 ]*好きぃ[　 ]*$/g.toString() + ',',
                /^[　 ]*大好きぃ[　 ]*$/g.toString() + ',',
                /^[　 ]*ヒール[　 ]*$/g.toString() + ',',
                /^[　 ]*MPを回復する。[　 ]*$/g.toString() + ',',
                /^[　 ]*弓[　 ]*$/g.toString() + ',',
                /^[　 ]*杖[　 ]*$/g.toString() + ',',
                /^[　 ]*木刀[　 ]*$/g.toString() + ',',
                /^[　 ]*のMPが自動回復する。[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着黒\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着白\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着赤\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着紫\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着青\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*素肌\（腹ボテ\）[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・黒[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・白[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・赤[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・紫[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着大破・青[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着黒[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着白[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着赤[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着紫[　 ]*$/g.toString() + ',',
                /^[　 ]*修道着青[　 ]*$/g.toString() + ',',
                /^[　 ]*素肌[　 ]*$/g.toString() + ',',
                /^[　 ]*んぶちゅれろぉ[　 ]*$/g.toString() + ',',
                /^[　 ]*まったく[　 ]*$/g.toString() + ',',
                /^[　 ]*なんでもーー…あひぃんっ[　 ]*$/g.toString() + ',',
                /^[　 ]*フン[　 ]*$/g.toString() + ',',
                /^[　 ]*ひぇっ[　 ]*$/g.toString() + ',',
                /^[　 ]*\(日\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(月\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(火\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(水\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(木\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(金\)[　 ]*$/g.toString() + ',',
                /^[　 ]*\(土\)[　 ]*$/g.toString() + ',',
                /^[　 ]*朝[　 ]*$/g.toString() + ',',
                /^[　 ]*夕[　 ]*$/g.toString() + ',',
                /^[　 ]*夜[　 ]*$/g.toString() + ',',
                /^[　 ]*月[　 ]*$/g.toString() + ',',
                /^[　 ]*日[　 ]*$/g.toString() + ',',
                /^[　 ]*はあっ[　 ]*$/g.toString() + ',',
                /^[　 ]*ああっ[　 ]*$/g.toString() + ',',
                /^[　 ]*やっ[　 ]*$/g.toString() + ',',
                /^[　 ]*やりぃ[　 ]*$/g.toString() + ',',
                /^[　 ]*んうーん[　 ]*$/g.toString() + ',',
                /^[　 ]*へっ[　 ]*$/g.toString() + ',',
                /^[　 ]*ふんッ[　 ]*$/g.toString() + ',',
                /^[　 ]*うぅーん[　 ]*$/g.toString() + ',',
                /^[　 ]*えぇ～いいじゃんかよ～[　 ]*$/g.toString() + ',',
                /^[　 ]*んんぅッ[　 ]*$/g.toString() + ',',
                /^[　 ]*へぇ～[　 ]*$/g.toString() + ',',
                /^[　 ]*ええ～[　 ]*$/g.toString() + ',',
                /^[　 ]*んんーッ[　 ]*$/g.toString() + ',',
                /^[　 ]*むうん[　 ]*$/g.toString() + ',',
                /^[　 ]*秋[　 ]*$/g.toString() + ',',
                /^[　 ]*夏[　 ]*$/g.toString() + ',',
                /^[　 ]*春[　 ]*$/g.toString() + ',',
                /^[　 ]*冬[　 ]*$/g.toString() + ',',
                /^[　 ]*マワセ[　 ]*$/g.toString() + ',',
                /^[　 ]*オカセ[　 ]*$/g.toString() + ',',
                /^[　 ]*はじめから[　 ]*$/g.toString() + ',',
                /^[　 ]*つづきから[　 ]*$/g.toString() + ',',
                /^[　 ]*やあやあ♪[　 ]*$/g.toString() + ',',
                /^[　 ]*何度も何度も何度も[　 ]*$/g.toString() + ',',
                /^[　 ]*回[　 ]*$/g.toString() + ',',
                /^[　 ]*会議は長引き[　 ]*$/g.toString() + ',',
                /^[　 ]*ほーん[　 ]*$/g.toString() + ',',
                /^[　 ]*北西[　 ]*$/g.toString() + ',',
                /^[　 ]*北東[　 ]*$/g.toString() + ',',
                /^[　 ]*南西[　 ]*$/g.toString() + ',',
                /^[　 ]*南東[　 ]*$/g.toString() + ',',
                /^[　 ]*げぇむ終了[　 ]*$/g.toString() + ',',
                /^[　 ]*う～ん[　 ]*$/g.toString() + ',',
                /^[　 ]*今度こそ[　 ]*$/g.toString() + ',',
                /^[　 ]*修得不可[　 ]*$/g.toString() + ',',
                /^[　 ]*未修得[　 ]*$/g.toString() + ',',
                /^[　 ]*ロードメニュー[　 ]*$/g.toString() + ',',
                /^[　 ]*交換する[　 ]*$/g.toString() + ',',
                /^[　 ]*あ～やわらけぇ[　 ]*$/g.toString() + ',',
                /^[　 ]*いや～[　 ]*$/g.toString() + ',',
                /^[　 ]*セーブしますか？?[　 ]*$/g.toString() + ',',
                /^[　 ]*おっおぉ～[　 ]*$/g.toString() + ',',
                /^[　 ]*おいおい随分キツイじゃねえの[　 ]*$/g.toString() + ',',
                /^[　 ]*あ～も～ちゃんと踏ん張っててよ[　 ]*$/g.toString() + ',',
                /^[　 ]*んぶちゅっ[　 ]*$/g.toString() + ',',
                /^[　 ]*ジュポッジュポジュポッ[　 ]*$/g.toString() + ',',
                /^[　 ]*クゥさぁ[　 ]*$/g.toString() + ',',
                /^[　 ]*うぃ～[　 ]*$/g.toString() + ',',
                /^[　 ]*あーもーっ[　 ]*$/g.toString() + ',',
                /^[　 ]*盛大に潮吹いたな～[　 ]*$/g.toString() + ',',
                /^[　 ]*あ～やべ～[　 ]*$/g.toString() + ',',
                /^[　 ]*キャーッ[　 ]*$/g.toString() + ',',
                /^[　 ]*ごっくんした精液量[　 ]*$/g.toString() + ',',
                /^[　 ]*うおっほぉ[　 ]*$/g.toString() + ',',
                /^[　 ]*ゲーム終了[　 ]*$/g.toString() + ',',
                /^[　 ]*全体 音量[　 ]*$/g.toString() + ',',
                /^[　 ]*ふ、ふん！[　 ]*$/g.toString() + ',',
                /^[　 ]*こ、ここ+んな事で[　 ]*$/g.toString() + ',',
                /^[　 ]*うあわああっ[　 ]*$/g.toString() + ',',
                /^[　 ]*いたた[　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                //^[　 ]*  [　 ]*$/g.toString() + ',',
                '//Temp',
                /* /[\w]+_[\w]+/gi.toString() + ',',
                /[\w]+,/gi.toString() + ',',
                /,[\w]+/gi.toString() + ',',
                /[\w]+/gi.toString() + ',', */
                //'// Specific VX/Ace Scripts entries',
                //^所持数$|^購入する$|^売却する$|^やめる$|^持っている数$|^現在の経験値$|^どのファイルにセーブしますか？$|^どのファイルをロードしますか？$|^ファイル$|^会心の一撃！！$|^痛恨の一撃！！$|^しかし逃げることはできなかった！$|^戦闘に勝利した$|^%sが現れた！$|^%sの先制！$|^%sは退却した$|^%sは戦いに敗れた…$|^%s の経験値を獲得$|^%s\\\\G 手に入れた$|^%sを手に入れた$|^%sは%s %s に上がった$|^%sを覚えた$|^次の%sまで$|^%sは逃げてしまった。$|^お金を %s%s 手に入れた！$|^%sの攻撃！$|^%sは身を守っている。$|^%sは様子を見ている。$|^%sたち$|^%sが出現！$|^%sは先手を取った！$|^%sは不意をつかれた！$|^%sは逃げ出した！$|^%sの勝利！$|^%sは戦いに敗れた。$|^%s の経験値を獲得！$|^お金を %s\\\\G 手に入れた！$|^%sを手に入れた！$|^%sは%s %s に上がった！$|^%sを覚えた！$|^%sは%sを使った！$|^%sは %s のダメージを受けた！$|^%sの%sが %s 回復した！$|^%sの%sが %s 増えた！$|^%sの%sが %s 減った！$|^%sは%sを %s 奪われた！$|^%sはダメージを受けていない！$|^ミス！　%sはダメージを受けていない！$|^%sに %s のダメージを与えた！$|^%sの%sを %s 奪った！$|^%sにダメージを与えられない！$|^ミス！　%sにダメージを与えられない！$|^%sは攻撃をかわした！$|^%sは魔法を打ち消した！$|^%sは魔法を跳ね返した！$|^%sの反撃！$|^%sが%sをかばった！$|^%sの%sが上がった！$|^%sの%sが下がった！$|^%sの%sが元に戻った！$|^%sには効かなかった！$|^お金を %s%s 失った。$|^%sの%sが %s に下がってしまった。$/g.toString() + ',',
                //^  $/g.toString() + ',',
                //^  $/g.toString() + ',',
                //^  $/g.toString() + ',',
                //^  $/g.toString() + ',',
                //^  $/g.toString() + ',',
                '// If Target is not English remove everything above this until the other message',
                '//Preserve Circle Numbers',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*♡+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*♥+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 …]*[。、][　 …･]*/g.toString() + ',',
                //'// Colors',
                //\\+C\[[^\]\r\n]+?\][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?\\+C\[[^\]\r\n]+?\]/gi.toString() + ',',
                //^[\"\'\`\’]?(\s*\\+C\[\d+?\])|\\+C\[\d+?\]\s*[\"\'\`\’]?$/gi.toString() + ',',
                //\c\[\d+\]/gi.toString() + ',',
                '// Dialogue box pause',
                /[\.]\\+(?=[^a-zA-Z\\]|$)/gi.toString() + ',',
                '// First we grab the arguments portion of a info: call, then we grab the info itself, leaving only the text',
                /^[\"\'\`\’]?info:.+?\K(,\d+)+[\"\'\`\’]?$/gim.toString() + ',',
                /^[\"\'\`\’]?info:/gim.toString() + ',',
                '// Names',
                //\\+[\w]+\[\\+n\[\d+\]\]/gi.toString() + ',',
                /\\+F\[\d+\]\\+M\[[^\]\r\n]*?\]\\+N<\\+N\[\d+\]>/gim.toString() + ',',
                //\\+[N]<\\+N\[\d+\]>/gi.toString() + ',',
                /\\+name\[\\+V\[\d+?\]\]\\+F+?\[\\+V\[\d+?\]\]/gim.toString() + ',',
                /\\+name\[\\+F+?\[\\+V\[\d+?\]\]/gim.toString() + ',',
                /\\+name\[\\+V\[\d+\]\]/gim.toString() + ',',
                //\\+nw?</gi.toString() + ',',
                //\\+nw?\[(?=[^\]]*[^\d\]])/gi.toString() + ',',
                //\\+[n][w]\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]+/gi.toString() + ',',
                //\\+[n][w]?\<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?\>/gi.toString() + ',',
                //\\n\[/gi.toString() + ',',
/*                 '// Placeholder',
                /_actor/g.toString() + ',',
                /_class/g.toString() + ',',
                /_key/g.toString() + ',',
                /_name/g.toString() + ',',
                /_num/g.toString() + ',',
                /_icon/g.toString() + ',',
                /_desc\d/g.toString() + ',',
                /_SE/g.toString() + ',',
                /_ABL/g.toString() + ',', */
                /^[\"\'\`\’]?_EventSetting = "?/gm.toString() + ',',
                /[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*/gim.toString() + ',',
                '//Gold',
                /\\+G(?![a-zA-Z])/g.toString() + ',',
                '// Stuff that shouldnt even be there',
                /else if[\s\S]*?\{[\s\S]*?\}/g.toString() + ',',
                /if[\s\S]*?\{[\s\S]*?\}/g.toString() + ',',
/*                 '// Non Jap stuff',
                /「[「]+/gi.toString() + ',',
                /」[」]+/gi.toString() + ',',
                /(?<![\w\\])\([^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?\)/gi.toString() + ',',
                /(?<![\w\\])\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]/gi.toString() + ',',
                /(?<![\w\\])<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?>/gi.toString() + ',',
                /(?<=[a-zA-z]|^)['][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[']/gi.toString() + ',',
                /[（][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[）]/gi.toString() + ',',
                /[⟨][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[⟩]/gi.toString() + ',',
                /[〔][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〕]/gi.toString() + ',',
                /[〖][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〗]/gi.toString() + ',',
                /[〘][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〙]/gi.toString() + ',',
                /[〚][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〛]/gi.toString() + ',',
                /[｢][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[｣]/gi.toString() + ',',
                /[「][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[」]/gi.toString() + ',',
                /[〈][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〉]/gi.toString() + ',',
                /[『][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[』]/gi.toString() + ',',
                /[【][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[】]/gi.toString() + ',',
                /[［][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[］]/gi.toString() + ',',
                /[《][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[》]/gi.toString() + ',',
                /[{][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[}]/gi.toString() + ',',
                /[〝][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〞]/gi.toString() + ',',
                /[〞][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〝]/gi.toString() + ',',
                /[〞][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〞]/gi.toString() + ',',
                /[〝][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〟]/gi.toString() + ',',
                /[〟][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〟]/gi.toString() + ',',
                /[〝][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[〝]/gi.toString() + ',',
                /[＜][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[＞]/gi.toString() + ',',
                /[｛][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[｝]/gi.toString() + ',',
                /[｟][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[｠]/gi.toString() + ',',
                /["][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?["]/gi.toString() + ',',
                /[“][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[”]/gi.toString() + ',',
                /[´][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[´]/gi.toString() + ',',
                /[`][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[`]/gi.toString() + ',', */
/*                 /(?<=[\]]|<|^)[０１２３４５６７８９？！＃＄％＆［］＾＿｛｝｜（）＊＋－ー／＠＜＞：；…。、~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ\|a-zA-Z1234567890\]\[\(\)\-!?§#&,\.\{\}\$\%\@\"\:\;\=\^\+\-\_\*\>\<→←↑↓\\\/\'　 ]+(?=[\\|\n]|>|$)/gi.toString() + ',',
                /(?<=[\]]|<|^)【[０１２３４５６７８９？！＃＄％＆［］＾＿｛｝｜（）＊＋－ー／＠＜＞：；…。、~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ\|a-zA-Z1234567890\]\[\(\)\-!?§#&,\.\{\}\$\%\@\"\:\;\=\^\+\-\_\*\>\<→←↑↓\\\/\'　 ]+】(?=[\\|\n]|>|$)/gi.toString() + ',',
                /(?<=[\]]|<|^)\[[０１２３４５６７８９？！＃＄％＆［］＾＿｛｝｜（）＊＋－ー／＠＜＞：；…。、~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ\|a-zA-Z1234567890\]\[\(\)\-!?§#&,\.\{\}\$\%\@\"\:\;\=\^\+\-\_\*\>\<→←↑↓\\\/\'　 ]+](?=[\\|\n]|>|$)/gi.toString() + ',',
                /(?<=\\name|\\nw|\\n)[０１２３４５６７８９？！＃＄％＆［］＾＿｛｝｜（）＊＋－ー／＠＜＞：；…。、~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ\|a-zA-Z1234567890\]\[\(\)\-!?§#&,\.\{\}\$\%\@\"\:\;\=\^\+\-\_\*\>\<→←↑↓\\\/\'　 ]+/gi.toString() + ',',
                /(?<=\\name|\\nw|\\n)【[０１２３４５６７８９？！＃＄％＆［］＾＿｛｝｜（）＊＋－ー／＠＜＞：；…。、~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ\|a-zA-Z1234567890\]\[\(\)\-!?§#&,\.\{\}\$\%\@\"\:\;\=\^\+\-\_\*\>\<→←↑↓\\\/\'　 ]+】/gi.toString() + ',',
                /(?<=\\name|\\nw|\\n)\[[０１２３４５６７８９？！＃＄％＆［］＾＿｛｝｜（）＊＋－ー／＠＜＞：；…。、~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ\|a-zA-Z1234567890\]\[\(\)\-!?§#&,\.\{\}\$\%\@\"\:\;\=\^\+\-\_\*\>\<→←↑↓\\\/\'　 ]+]/gi.toString() + ',', */
                '// Leave Latin Alone',
                //(^|[\[\(\{\"\'\<\>])[０１２３４５６７８９？！＃＄％＆［］＾＿｛｝｜（）＊＋－ー／＠＜＞：；…。、~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ\|a-zA-Z1234567890\]\[\(\)\-!?§#&,\.\{\}\$\%\@\"\:\;\=\^\+\-\_\*\>\<→←↑↓\\\/\'　 ]+([\]\)\}\"\'\<\>]|$)/gim.toString() + ',',
                /^[ 　]+$/g.toString() + ',',
                '// Game Specific',
                /\s*\\+\^\s*[\"\'\`\’]?$/g.toString() + ',',
                /^[\"\'\`\’]?\\+>\s*(\s*\\C\[\d+?\]\s*)*/gi.toString() + ',',
                /^[\"\'\`\’]?\\+[abdefghjklmopqrstuwxyz_]+?\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]/gim.toString() + ',',
                /\\+[abdefghjklmopqrstuwxyz_]+?\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][\"\'\`\’]?$/gi.toString() + ',',
                //'// Potential Filenames', //too many false positives
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]*[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]*_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                '// Linebreaks',
                /[　 ]*\\+[n](?![\[\<])[　 ]*/gim.toString() + ',',
                '// divider',
                /\|/gim.toString() + ',',
                '// special linestarter',
                /^[\"\'\`\’]?\\+>/gim.toString() + ',',
                '// Conditional choice RPG Maker at the end',
                /\s*((if)|(en))\(.+?\)\s*[\"\'\`\’]?$/gi.toString() + ',',
                '// Conditional choice RPG Maker at the start',
                /^[\"\'\`\’]?\s*((if)|(en))\(.+?\)\s*/gim.toString() + ',',
                '// Whitespace with linebreak at start',
                /^[\"\'\`\’]?\s*\n\s*/gi.toString() + ',',
                '// Whitespace with linebreak at end',
                /\s*\n\s*[\"\'\`\’]?$/gi.toString() + ',',
                '// Brackets at start',
                /^[\"\'\`\’]?\[\w+\//gmi.toString() + ',',
                /^[\"\'\`\’]?\s*\\+["']+/g.toString() + ',',
                //^\s*[〔⟨〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]+/g.toString() + ',',
                '// Brackets at end',
                /\/\w+][\"\'\`\’]?$/gmi.toString() + ',',            
                /\\+["']+\s*;?[\"\'\`\’]?$/g.toString() + ',',
                //[\]\)}〕〗〙〛〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]+\s*;?$/g.toString() + ',',
                
                '// Symbols at start',
                /(^\s*[\-\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ\-\+=]+)/gmi.toString() +
                    ',',
                '// Symbols at end',
                /(?<=[\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ\+=;])[!?,\.？！、。;]+/gmi.toString() +
                    ',',
                /([◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ\+=]+[!?,\.？！、。\s;]*$)/gmi.toString() +
                    ',',
                /([\-\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ\-\+=;]+\s*$)/gmi.toString() +
                    ','
            ].join('\n'),
            description: "\nIF YOU ARE TRANSLATING FROM SOMETHING OTHER THAN JAPANESE CHANGE ALL \"一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\" BITS TO WHATEVER YOUR SOURCE LANGUAGE IS!\nIF YOU ARE TRANSLATING TO SOMETHING OTHER THAN ENGLISH REMOVE ALL THE PRE-DEFINED TRANSLATIONS!" +
                '\nThese are to be used to match against text at either the start or the end of sentences. It works kind of like splitting - the matched symbol will be removed from the sentence before translation and added back later.\n' +
                'This is best used to remove symbols which offer no benefit to the translation process (like brackets or quotes), or to protect script calls.' +
                exports.PatternExplanation,
            name: 'Cutting Corners Patterns',
            category: TranslationEngineOptionCategories.PATTERNS,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '500px'
            }
        });
        this.optionEndpointCount = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this, id: 'endpointCount', type: 'number', default: 1,
            name: 'Endpoint Count', category: TranslationEngineOptionCategories.OPTIONS,
            description: 'Internal: number of parallel endpoint cards. Changed via Add/Delete buttons.'
        });
        this.optionEndpointWeight = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this, id: 'endpointWeight', type: 'number', default: 1,
            name: 'Endpoint Weight',
            description: 'How many concurrent batches this endpoint (the primary) may handle at once. Total concurrency = sum of all endpoint weights.',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.optionGroupByUrl = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this, id: 'groupByUrl', default: false,
            name: 'Group Endpoints by URL',
            description: 'When on, endpoints that share the same API URL share a single concurrency pool: the pool allows at most the HIGHEST weight among them at once (not the sum), and batches rotate across the keys. Use this when several keys hit the same provider that rate-limits globally (per IP/total) rather than per key. With this off, each endpoint is independent (per-key limits).',
            category: TranslationEngineOptionCategories.OPTIONS,
            formType: 'checkbox'
        });
        this.optionUrlGroupRotationDelay = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this, id: 'urlGroupRotationDelay', type: 'number', default: 5000,
            name: 'URL-Group Rotation Delay',
            description: 'When Group Endpoints by URL is on, milliseconds to wait between a failed request on one key and the retry on another key in the same group (so they do not fire back-to-back).',
            category: TranslationEngineOptionCategories.OPTIONS
        });
        this.processor = new processorClass();
        this.translatorEngine = new TranslatorEngine({
            author: thisAddon.package.author.name,
            version: thisAddon.package.version,
            ...extraOptions,
            optionsForm: {
                schema: {},
                form: []
            }
        });
        this.translatorEngine.optionsForm;
        this.translatorEngine.translate = (text, options) => {
            this.translate(text, options);
        };
        // Bridge for the Options window's close-time flush: info there is this
        // translatorEngine, while the per-model panel logic lives on the engine.
        this.translatorEngine.applyPanelFlush = (values) => this.applyPanelFlush(values);
        this.translatorEngine.abortTranslation = () => {
            this.abort();
        };
        this.translatorEngine.abort = this.translatorEngine.abortTranslation;
        this.translatorEngine.pause = () => {
            this.pause();
        };
        this.translatorEngine.resume = () => {
            this.resume();
        };
        // Quick Start "Test connection" (see testConnection below). Delegated
        // because the registered engine object, not the wrapper, is what the
        // options window holds as translatorInfo.
        this.translatorEngine.testConnection = () => this.testConnection();
        this.translatorEngine.getActiveEndpoints = () => this.getActiveEndpoints();
        this.translatorEngine.totalSpareCapacity = () => this.totalSpareCapacity();
        this.translatorEngine.getPendingRotations = () => this.pendingRotations || 0;
        this.translatorEngine.getTotalConcurrency = () => this.getTotalConcurrency();
        this.translatorEngine.resetEndpointState = () => this._resetEndpointState();
        // Per-run quality/reliability summary (implemented by DSLREngine: resetRunStats/
        // getRunStats/getRunSummary). These MUST be delegated here because this.translatorEngine
        // — not the wrapper itself — is the object registered via trans.registerEngine() and
        // handed to the batch translator. Without the delegates, the batch translator's
        // `typeof === 'function'` guards silently never fire and the summary is never printed.
        this.translatorEngine.resetRunStats = () => { if (this.resetRunStats) this.resetRunStats(); };
        this.translatorEngine.getRunStats = () => (this.getRunStats ? this.getRunStats() : null);
        this.translatorEngine.getRunSummary = () => (this.getRunSummary ? this.getRunSummary() : null);
        // The Options dialog holds the registered engine, not this wrapper, so expose the
        // stale-runtime rebuild hook there for options.translatorMenu.renderOptions to call.
        this.translatorEngine.onBeforeRenderOptions = () => this.onBeforeRenderOptions();
        this.translatorEngine.pickEndpointIndex = (activeList) => {
            if (!this._groupByUrl()) {
                // Per-endpoint capacity (independent endpoints): most spare, tie -> lowest number.
                let bestIdx = -1, bestFree = 0;
                for (let i = 0; i < activeList.length; i++) {
                    if (!this._endpointAvailable(activeList[i].number)) continue;
                    const inUse = (this.endpointInFlight && this.endpointInFlight[activeList[i].number]) || 0;
                    const free = activeList[i].weight - inUse;
                    if (free <= 0) continue;
                    if (bestIdx === -1 || free > bestFree || (free === bestFree && activeList[i].number < activeList[bestIdx].number)) {
                        bestIdx = i; bestFree = free;
                    }
                }
                return bestIdx;
            }
            // Grouped by URL: each group's cap = max weight; pick the group with the most spare,
            // then round-robin across keys within that group to even out usage.
            const groups = {};
            for (let i = 0; i < activeList.length; i++) {
                if (!this._endpointAvailable(activeList[i].number)) continue;
                const key = this._normalizeUrl(activeList[i].url);
                (groups[key] = groups[key] || []).push({ idx: i, number: activeList[i].number, weight: activeList[i].weight });
            }
            let bestKey = null, bestSpare = 0;
            for (const key in groups) {
                const members = groups[key];
                let cap = 0, inUse = 0;
                for (let j = 0; j < members.length; j++) {
                    if (members[j].weight > cap) cap = members[j].weight;
                    inUse += (this.endpointInFlight[members[j].number] || 0);
                }
                const spare = cap - inUse;
                if (spare <= 0) continue;
                if (bestKey === null || spare > bestSpare || (spare === bestSpare && key < bestKey)) {
                    bestKey = key; bestSpare = spare;
                }
            }
            if (bestKey === null) return -1;
            const members = groups[bestKey].sort((a, b) => a.number - b.number);
            const last = (this._urlGroupLastPick[bestKey]) || -1;
            let chosen = members[0];
            for (let j = 0; j < members.length; j++) {
                if (members[j].number > last) { chosen = members[j]; break; }
            }
            this._urlGroupLastPick[bestKey] = chosen.number;
            return chosen.idx;
        };
        // Listen for changes
        /* this.translatorEngine.on('update', (evt: Event, obj: { key: string; value: any }) => {
            let option = this.storedOptionsHash[obj.key];
            if (typeof option != 'undefined') {
                option.setValue(obj.value);
            }
            this.translatorEngine[obj.key] = obj.value;
        }); */
    }
    translate(rows, translationOptions) {
        if (document.getElementById('loadingOverlay').classList.contains('hidden')) {
            ui.showBusyOverlay();
        }
        let batchPerformance = new RedPerformance_1.RedPerformance();
        let savedSL, savedTL;
        try {
            savedSL = trans.getSl();
            savedTL = trans.getTl();
        }
        catch (e) {
            savedSL = 'ja';
            savedTL = 'en';
        }
        let options = Object.assign({
            onAfterLoading: () => { },
            onError: () => { },
            always: () => { },
            progress: () => { },
            sl: savedSL,
            tl: savedTL
        }, translationOptions);
        // Reserve a capacity slot on the assigned endpoint for this batch's lifetime. The engine
        // owns the in-flight map (the dispatcher only reads it); on 429/unrecoverable rotation the
        // slot is moved, and options._epSlot tracks the currently-held endpoint (0 = none held).
        options._epSlot = (translationOptions && translationOptions.endpointNumber) ? translationOptions.endpointNumber : 1;
        this._incEndpointInFlight(options._epSlot);
        const getCacheKey = (text) => {
            return options.sl + options.tl + text;
        };
        this.processorInit();
        let process = this.processor.process(...rows);
        let toTranslate = process.getTranslatableLines();
        let temptoTranslate = process.getTranslatableLines();
        let _lineToRow = null;
        if (process.lines) {
            _lineToRow = [];
            for (let i = 0; i < process.lines.length; i++) {
                let cnt = process.lines[i].getTranslatableStrings().length;
                for (let j = 0; j < cnt; j++) _lineToRow.push(i);
            }
            if (_lineToRow.length !== toTranslate.length) _lineToRow = null;
        }
        // Expose the translatable-line -> batch-row mapping to the caller. It is mutated
        // in place by the cache-hit removals below, so after those it stays aligned with
        // the toTranslate array handed to doTranslate(). The review layer uses it to map
        // served line indexes to grid rows when applying purple tags. Consumers must
        // fail closed when this is null.
        if (translationOptions) translationOptions._lineToRow = _lineToRow;
        let translations = new Array(toTranslate.length);
        let temptranslations = new Array(toTranslate.length);
        let entireBatchWasCached = false;
        if (this.optionUseLineCache.getValue()) {
            this.cache.loadCache();
            // Remove cached lines
            for (let i = toTranslate.length - 1; i >= 0; i--) {
                let cacheKey = getCacheKey(toTranslate[i]);
                if (this.cache.hasCache(cacheKey)) {
                    translations[i] = this.cache.getCache(cacheKey);
                    toTranslate.splice(i, 1);
                    if (_lineToRow) _lineToRow.splice(i, 1);
                }
            }
            if (toTranslate.length !== translations.length) {
                this.log(`[SLRTranslator] Skipped ${translations.length - toTranslate.length} translation requests due to cache hits.`);
            }
        }
        if (!this.optionUseLineCache.getValue() && this.optionUseBatchCache.getValue()) {
            this.cache.loadCache();
            // Check if all match
            for (let i = temptoTranslate.length - 1; i >= 0; i--) {
                let cacheKey = getCacheKey(temptoTranslate[i]);
                if (this.cache.hasCache(cacheKey)) {
                    temptranslations[i] = this.cache.getCache(cacheKey);
                    temptoTranslate.splice(i, 1);
                }
            }
            if (temptoTranslate.length < 1) {
                entireBatchWasCached = true;
                this.cache.loadCache();
            // Remove cached lines
                for (let i = toTranslate.length - 1; i >= 0; i--) {
                    let cacheKey = getCacheKey(toTranslate[i]);
                    if (this.cache.hasCache(cacheKey)) {
                        translations[i] = this.cache.getCache(cacheKey);
                        toTranslate.splice(i, 1);
                    }
                }
                this.log(`[SLRTranslator] Entire Batch was found in cache. Not sending anything to DSLR.`);
            } else {
                entireBatchWasCached = false;
            }
        }
        /**
         * Rules for the main wrapper class:
         * "I don't care how the translation is done"
         * "I don't care how many lines it can translate at once"
         * "I just throw stuff around"
         * If there is a need for delay, doTranslate should handle it.
         * If there is a max length, doTranslate should handle it.
         * Any calls for external servers, etc, doTranslate handles it.
         */
        let result = {
            sourceText: rows.join(),
            translationText: '',
            source: rows,
            translation: []
        };
        this.log(`[SLRTranslator] Sending ${toTranslate.length} translation requests (processed from ${rows.length} rows) to ${this.getEngine().name}.`);
        if (Array.isArray(options.sceneBreaks) && options.sceneBreaks.length > 0) {
            if (!_lineToRow) {
                options.sceneBreaks = null;
            } else {
                var _finalBreaks = [];
                var _seenRows = {};
                for (var li = 0; li < _lineToRow.length; li++) {
                    var rowIdx = _lineToRow[li];
                    if (options.sceneBreaks.indexOf(rowIdx) !== -1 && !_seenRows[rowIdx]) {
                        _seenRows[rowIdx] = true;
                        _finalBreaks.push(li);
                    }
                }
                options.sceneBreaks = _finalBreaks;
            }
        }
        let translatorPerformance = new RedPerformance_1.RedPerformance();
        this.doTranslate(toTranslate, options)
            .then((translatedLines) => {
            // Release the slot BEFORE onAfterLoading: the dispatcher starts the next batch inside
            // onAfterLoading (batchComplete -> startNextBatches), so it must already see the freed slot.
            if (options._epSlot > 0) { this._decEndpointInFlight(options._epSlot); options._epSlot = 0; }
            // toTranslate matches translatedLines
            // translations matches initial translatableLines
            let outerIndex = 0;
            let innerIndex = 0;
            while (outerIndex < translatedLines.length) {
                while (translations[innerIndex] != undefined) {
                    innerIndex++;
                }
                if (this.optionUseLineCache.getValue()) {
                    if (translatedLines[outerIndex] !== undefined) {
                        let cacheKey = getCacheKey(toTranslate[outerIndex]);
                        this.cache.addCache(cacheKey, translatedLines[outerIndex]);
                    }
                }
                if (!this.optionUseLineCache.getValue() && this.optionUseBatchCache.getValue()) {
                    if (translatedLines[outerIndex] !== undefined) {
                        let cacheKey = getCacheKey(toTranslate[outerIndex]);
                        this.cache.addCache(cacheKey, translatedLines[outerIndex]);
                    }
                }
                translations[innerIndex++] = translatedLines[outerIndex++];
            }
            process.setTranslatedLines(...translations);
            let translatedRows = process.getTranslatedLines();
            process.getWarnings().forEach((warning) => {
                const startMessage = '[SLRTranslator] Processor Warning: ';
                let pad = ' '.repeat(startMessage.length);
                this.error([
                    `${startMessage}${warning.message}`,
                    `${pad}Original: ${warning.originalSentence}`,
                    `${pad}Current: ${warning.currentSentence}`,
                    `${pad}Placeholders: ${warning.placeholders}`
                ].join('\n'));
            });
            result.translationText = translatedRows.join();
            result.translation = translatedRows;
            let start2 = '[SLRTranslator] ';
            let pad2 = ' '.repeat(start2.length);
            this.log(`${start2}The batch of ${toTranslate.length} translation requests took: ${batchPerformance.end().getSeconds()} seconds.`);
            this.log(`${pad2}Performance: ${Math.round((10 * result.sourceText.length) / translatorPerformance.end().getSeconds()) / 10} characters per second. ${Math.round((10 * rows.length) / batchPerformance.getSeconds()) / 10} rows per second.`);
            if (this.optionCachePersistent.getValue()) {
                this.log('[SLRTranslatorEngine] Saving translation cache to Cache file.');
            } else if (this.optionCleanCachePersistent.getValue() && this.optionSystemPromptaddition.getValue() == "" && !(options.sceneContext && String(options.sceneContext).trim() !== "") && !(this.optionAutoGlossary && this.optionAutoGlossary.getValue() === true && window.SLRGlossaryText && String(window.SLRGlossaryText).trim() !== "")) {
                this.log('[SLRTranslatorEngine] Saving translation cache to Clean Cache file.');
            }
            result.usage = options._tokenUsage || null;
            // Publish the engine's per-line review outcomes back to the caller's
            // options object. `options` is a copy made by Object.assign, so fields
            // added by doTranslate (like `_reviewStateByIndex`) are not visible on
            // `translationOptions` unless bridged here. Without this bridge the
            // batch layer sees no review state and silently applies no QC tags.
            if (translationOptions) {
                translationOptions._reviewStateByIndex = options._reviewStateByIndex;
            }
            options.onAfterLoading(result);
        })
            .catch((reason) => {
                if (options._epSlot > 0) { this._decEndpointInFlight(options._epSlot); options._epSlot = 0; }
                //options.onError(reason);
                this.error(`Error: ` + reason);
            })
            .finally(() => {
                ui.hideBusyOverlay();
                if (this.optionCachePersistent.getValue()) {
                    //this.log('[SLRTranslatorEngine] Saving translation cache to Cache file.');
                    this.cache.saveCache();
                } else if (this.optionCleanCachePersistent.getValue() && this.optionSystemPromptaddition.getValue() == "" && !(options.sceneContext && String(options.sceneContext).trim() !== "") && !(this.optionAutoGlossary && this.optionAutoGlossary.getValue() === true && window.SLRGlossaryText && String(window.SLRGlossaryText).trim() !== "")) {
                //this.log('[SLRTranslatorEngine] Saving translation cache to Clean Cache file.');
                this.cache.saveCache();
            }
            options.always();
        });
    }
    /**
     * Send a minimal completion to the primary endpoint to validate the
     * configured API URL, key and model. Returns { ok, message } and never
     * throws, so the options window can show the result inline.
     */
    async testConnection() {
        const rawUrl = this.optionApiUrl ? this.optionApiUrl.getValue() : "";
        const doNotFix = this.optionDoNotFixURL ? this.optionDoNotFixURL.getValue() : false;
        const apiKey = this.optionApiKey ? this.optionApiKey.getValue() : "";
        const model = this.optionModel ? this.optionModel.getValue() : "";
        const url = EndpointHelpers_1.fixApiUrl(rawUrl, doNotFix);
        if (!url) return { ok: false, message: 'No API URL set.' };
        if (!model) return { ok: false, message: 'No model set.' };

        const headers = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
        const isResponses = /\/responses(?:\/|\?|#|$)/i.test(url);
        const body = isResponses
            ? { model: model, input: "ping", max_output_tokens: 16, stream: false }
            : { model: model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false };

        try {
            const res = await fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body) });
            if (res.ok) {
                let data = null;
                try { data = await res.json(); } catch (e) { /* an empty body is still a success */ }
                const used = (data && data.model) ? data.model : model;
                return { ok: true, message: 'Connected - ' + used + ' replied.' };
            }
            let detail = "";
            try { detail = await res.text(); } catch (e) { /* no body */ }
            detail = String(detail || "").replace(/\s+/g, " ").slice(0, 300);
            return { ok: false, message: 'HTTP ' + res.status + (detail ? ' - ' + detail : "") };
        } catch (e) {
            return { ok: false, message: 'Could not reach ' + url + ' - ' + ((e && e.message) || e) };
        }
    }
    getEngine() {
        return this.translatorEngine;
    }
    getId() {
        return this.translatorEngine.id;
    }
    init() {
        this._buildOptionsForm();
    }
    // Called by options.translatorMenu.renderOptions just before it builds the jsonform. The
    // form is first built during addon load, before window.llmRuntime has loaded, so the
    // per-model hints and the spec/projector Auto labels come out empty. When that happened
    // and the runtime is available now, rebuild the form so THIS render is complete. Once the
    // flag is cleared the hook is a no-op, so a good build is never rebuilt twice.
    onBeforeRenderOptions() {
        try {
            if (shouldRebuildStaleRuntimePanel(this._runtimePanelStale, (typeof window !== "undefined") ? window : null)) {
                this._buildOptionsForm();
            }
            // Refresh the panel's values on every render (the panel may have been built before
            // this engine's config was loaded), then re-apply the translatorEngine's current
            // values onto the schema defaults, exactly like options.js assignDefault does.
            if (typeof this.refreshPanelValues === "function") this.refreshPanelValues();
            const form = this.translatorEngine && this.translatorEngine.optionsForm;
            if (form && form.schema) {
                for (const key in form.schema) {
                    if (typeof this.translatorEngine[key] !== "undefined") {
                        form.schema[key].default = this.translatorEngine[key];
                    }
                }
                // jsonform renders a form element's own `value` when one is set, preempting
                // the schema default. The panel nodes are built once per app run, so their
                // captured values must be re-pointed at the refreshed defaults on every
                // render, or a re-opened Options window shows the build-time pick.
                const panelNodes = (this._runtimePanelNodes || []).concat(this._runtimePanelRoleNodes || []);
                for (const node of panelNodes) {
                    if (node && node.key && form.schema[node.key] &&
                        typeof form.schema[node.key].default !== "undefined") {
                        node.value = form.schema[node.key].default;
                    }
                }
            }
        } catch (e) { /* never let a stale-panel rebuild break the options render */ }
    }
    _buildOptionsForm() {
        const OptionFormBuilder = OptionFormBuilder_1.OptionFormBuilder;

        // Materialize endpoint 2..endpointCount BEFORE the visible-options snapshot,
        // so generated ep{N}_* options are included in the form (fixes the prior
        // ordering bug where generation ran AFTER the snapshot).
        const _epCount = Math.max(1, parseInt(this.optionEndpointCount.getValue(), 10) || 1);
        for (let n = 2; n <= _epCount; n++) this.generateEndpointOptions(n);

        // "+ Add Endpoint" button renders at the very top of the form (prepend), above all
        // endpoint cards, rather than inside Endpoint 1's card.
        const addEndpointNode = {
            type: 'actions',
            fieldHtmlClass: 'actionButtonSet',
            items: [{
                type: 'button',
                title: '+ Add Endpoint',
                onClick: (evt) => { this.addEndpoint(); this._rebuildAndRender(evt); }
            }]
        };

        // Quick Start: "Test connection" runs a tiny completion against the
        // primary endpoint settings so a new user can confirm URL/key/model
        // before translating. The status line is updated in place.
        const quickStartTestNode = {
            type: 'actions',
            fieldHtmlClass: 'actionButtonSet quickStartActions',
            items: [{
                type: 'button',
                title: 'Test connection',
                onClick: async (evt) => {
                    const button = evt.target;
                    if (button.disabled) return;
                    button.disabled = true;
                    const $status = $(button).closest('.panelContent').find('.quickStartTestStatus');
                    $status.removeClass('ok err').text('Testing...');
                    try {
                        const engine = this.translatorEngine;
                        const result = (engine && typeof engine.testConnection === 'function')
                            ? await engine.testConnection()
                            : { ok: false, message: 'Connection test is not available for this engine.' };
                        $status.text(result.message).addClass(result.ok ? 'ok' : 'err');
                    } catch (e) {
                        $status.text('Test failed: ' + ((e && e.message) || e)).addClass('err');
                    } finally {
                        button.disabled = false;
                    }
                }
            }]
        };
        const quickStartStatusNode = {
            type: 'help',
            helpvalue: '<div class="quickStartTestStatus"></div>',
            notitle: true
        };

        // Glossary-prefixed options that are actually the Glossary engine's own
        // counterpart of a main/fallback option. They land under the matching
        // concern in the "Glossary" role instead of the glossary-behaviour section.
        const glossaryRoleConcern = {
            glossaryApiUrl: 'connection', glossaryApiKey: 'connection', glossaryModel: 'connection',
            glossaryDoNotFixURL: 'connection', glossaryDisableV4Thinking: 'connection', glossaryAlwaysSendDisableThinking: 'connection',
            glossaryEnableJsonSchema: 'connection', glossaryEnableJsonObject: 'connection',
            glossaryTemperature: 'sampling', glossaryRequestDelay: 'sampling',
            glossaryTopK: 'sampling', glossaryTopP: 'sampling', glossaryMinP: 'sampling',
            glossaryRepeatPenalty: 'sampling', glossaryRepetitionPenalty: 'sampling', glossaryFrequencyPenalty: 'sampling', glossaryPresencePenalty: 'sampling',
            glossaryDisableStream: 'sampling', glossaryChatTemplateKwargs: 'sampling', glossaryCustomHeaders: 'sampling', glossaryCustomParameters: 'sampling',
            glossaryReasoningFormat: 'sampling', glossaryReasoningEffort: 'sampling', glossaryReasoningBudget: 'sampling',
            glossaryMaxTokens: 'limits', glossaryTokenCap: 'limits', glossaryMaxContextLength: 'limits'
        };
        const concernOf = (id) => {
            const b = id.endsWith('2') ? id.slice(0, -1) : id;
            // Strip the ep{N}_ prefix so endpoint-scoped options land in the same
            // concern as their primary counterpart (ep2_apiUrl -> connection).
            const base = b.replace(/^ep\d+_/, '');
            if (['apiUrl', 'apiKey', 'model', 'doNotFixURL', 'enableFullBatch', 'enableJsonFullBatch', 'enableJsonObjectFullBatch', 'enableFallback', 'limitFallback', 'endpointWeight', 'weight', 'groupByUrl', 'urlGroupRotationDelay'].includes(base)) return 'connection';
            if (['temperature', 'requestDelay', 'top_k', 'top_p', 'min_p', 'repeat_penalty', 'repetition_penalty', 'frequency_penalty', 'presence_penalty', 'enableReasoning', 'reasoningFormat', 'reasoningEffort', 'reasoningBudget', 'enableTokenProgress', 'enableStreamPreview', 'streamAllPreviews', 'disableStream', 'chat_template_kwargs', 'customHeaders', 'customParameters'].includes(base)) return 'sampling';
            if (['characterGenders', 'systemPromptaddition', 'systemPromptadditionTrim', 'enableContext', 'enableSceneContext', 'contextHistoryLength', 'contextPrompt'].includes(base)) return 'context';
            if (['enableRetry', 'enableReject', 'enableRejectJapanese', 'enableRejectGlossary', 'enableRemoveRepetition', 'enableRemoveInnerIDSP'].includes(base)) return 'retry';
            if (['useBatchCache', 'useLineCache', 'useCleanCachePersistent', 'useCachePersistent', 'cachePersistentSize'].includes(base)) return 'caching';
            if (['maxRequestLengthDSLR', 'targetRequestSize', 'sceneShortMaxRows', 'maxScenesPerGroup', 'maxNonSceneRows', 'maxSingleLineScenesRows', 'maxTokens', 'scaleMaxTokensResponses', 'maxContextLength', 'maxTranslationLength', 'minLines', 'maxLines', 'maxPlaceholderCount'].includes(base)) return 'limits';
            if (['processingOrder', 'padPlaceholder', 'placeholderType', 'placeholderRecoveryType'].includes(base)) return 'processing';
            if (base.endsWith('Replacer') || base === 'replaceLinebreaks') return 'placeholders';
            if (/Patterns$/.test(base)) return 'patterns';
            if (base.startsWith('optionsPreset')) return 'presets';
            if (base.includes('Prompt') || base.includes('prompt')) return 'prompts';
            return 'misc';
        };
        // Concerns that have per-engine variants get the Main/Fallback/Glossary
        // sub-grouping so the triplicated options are clearly labelled.
        const roleAxisConcerns = new Set(['connection', 'context', 'sampling', 'retry', 'prompts', 'placeholders']);
        const ReviewOptions = require("./review/options");
        const sectionOf = (option) => {
            const id = option.getId();
            if (ReviewOptions.REVIEW_OPTION_IDS.includes(id)) {
                return ReviewOptions.concernFor(id);
            }
            if (id in glossaryRoleConcern) return { parent: glossaryRoleConcern[id], child: 'glossary' };
            if (id === 'smartGlossary' || id === 'autoGlossary' || id.startsWith('glossary')) return { parent: 'glossary' };
            // Global endpoint-concurrency options live in Connection but at the section (General) level,
            // not inside a specific endpoint card.
            if (id === 'groupByUrl' || id === 'urlGroupRotationDelay') return { parent: 'connection' };
            // The repetition-loop tier thresholds are one global set of values shared by every
            // endpoint, the fallback and glossary extraction, so they sit at the Sampling
            // section level.
            if (REPETITION_TIER_IDS.indexOf(id) !== -1) return { parent: 'sampling' };
            // The KV-cache prompt toggle is one global switch for primary, fallback and every
            // endpoint alike, so it sits at the section level of System Prompt & Context.
            if (id === 'cacheFriendlyPrompts') return { parent: 'context' };
            // The primary endpoint's three essentials are promoted to the Quick Start
            // section at the very top, so they aren't buried in Endpoint 1's group.
            if (id === 'apiUrl' || id === 'apiKey' || id === 'model') return { parent: 'quickstart' };
            // The model picker belongs with the per-model settings it controls, so it heads the
            // per-model sub-group of the one Bundled Local Runtime card.
            if (id === 'runtimeModel') return { parent: 'localruntime', child: 'permodel' };
            // Every remaining bundled-runtime setting here is server-side and applies to every
            // model the runtime serves (port, backend, extra library folder, models kept loaded,
            // unload after idle, threads, model-switch wait, unified KV, KV in VRAM, the VRAM
            // headroom and the KV cache limits), so it goes in the general sub-group. The
            // model-level fields, including the whole draft placement trio, live in the per-model
            // profiles (hidden here; see _retiredRuntimeProfileIds). Parallel slots moved to the
            // per-model panel too.
            if (id === 'runtimeDraftMax' || id === 'runtimeDraftMin' ||
                id === 'runtimeDraftGpuLayers' || id === 'runtimeDraftCpuMoe' ||
                id === 'runtimeDraftCpuMoeLayers' || id === 'runtimeFitTarget' ||
                id === 'runtimeContextLength' || id === 'runtimeKvType' ||
                id === 'runtimeBackend' || id === 'runtimeGpuLayers' || id === 'runtimeCpuMoe' ||
                id === 'runtimeCpuMoeLayers' || id === 'runtimeSplitMode' || id === 'runtimeTensorSplit' ||
                id === 'runtimeMainGpu' || id === 'runtimeOverrideTensor' || id === 'runtimeLoadMode' ||
                id === 'runtimeExpertCount' || id === 'runtimeLibDir' ||
                id === 'runtimeModelsMax' || id === 'runtimeSleepIdle' ||
                id === 'runtimeWaitIdleSeconds' ||
                id === 'runtimeThreads' || id === 'runtimeThreadsBatch' ||
                id === 'runtimeReasoning' ||
                id === 'runtimePort' || id === 'runtimeModelProfiles' ||
                id === 'runtimeKvUnified' || id === 'runtimeKvOffload' ||
                id === 'runtimeCacheRam' || id === 'runtimeCtxCheckpoints' ||
                id === 'runtimeCacheReuse' ||
                id === 'runtimeAutoStart') return { parent: 'localruntime', child: 'general' };
            // The Ask DSLR chat settings card: chat-specific, not translation
            // options, so it keeps its own section right after the runtime card.
            if (id === 'chatReadLength' || id === 'chatHistoryMessages' || id === 'chatRemember' || id === 'chatKeepCount') return { parent: 'askdslr' };
            const parent = concernOf(id);
            if (!roleAxisConcerns.has(parent)) return { parent };
            const m = id.match(/^ep(\d+)_/);
            if (m) return { parent, child: 'ep' + m[1] };
            return { parent, child: id.endsWith('2') ? 'fallback' : 'ep1' };
        };
        // Section order doubles as the "essentials first, advanced last" layout:
        // Quick Start and everything a normal run needs come first; the power-user
        // sections follow under a single "Advanced" heading.
        const sections = [
            // Quick Start is collapsible like every other section, but starts
            // expanded so a new user sees it without a click (defaultExpanded ->
            // OptionFormBuilder marks the fieldset). Bundled Local Runtime does
            // NOT start expanded: most users never use the bundled runtime, and
            // an always-open card pushes the rest of the options off screen.
            { key: 'quickstart', title: 'Quick Start', expandable: true, defaultExpanded: DEFAULT_EXPANDED_SECTION_KEYS.indexOf('quickstart') !== -1, help: 'These three fields are all you need. Fill them in, press <b>Test connection</b>, then close this window - everything further down is optional.' },
            // One Bundled Local Runtime card holding three titled sub-groups: the server-level
            // "general" settings, the per-GGUF "permodel" settings and the "roles" pickers. The
            // child titles below name each sub-group. Collapsed by default (see above); its
            // legend is still visible and the options filter auto-expands it on a match.
            { key: 'localruntime', title: 'Bundled Local Runtime', expandable: true, help: '<b>General settings</b> apply to every model the bundled llama-server serves. <b>Per-model settings</b> are stored per GGUF file and applied when <b>that</b> model\'s server starts. <b>Role assignment</b> points each DSLR role at one of the bundled local models, or leaves it on its own endpoint.' },
            { key: 'askdslr', title: 'Ask DSLR Chat', expandable: true, help: 'Settings for the <b>Ask DSLR</b> chat (the toolbar button). The chat talks to this engine\'s endpoint.' },
            { key: 'connection', title: 'Connection & Model', help: '<b>Endpoint 1 (Primary)</b> is the one you set up above. <b>Fallback</b>, <b>Glossary</b> and <b>Review</b> are optional extra models - leave their API URL blank to disable them, and their groups stay greyed out until a URL is set.' },
            { key: 'context', title: 'System Prompt & Context' },
            { key: 'retry', title: 'Retry & Quality Control' },
            { key: 'glossary', title: 'Glossary Extraction' },
            { key: 'limits', title: 'Batching & Limits' },
            { key: 'sampling', title: 'Sampling & Generation', heading: 'Advanced' },
            { key: 'caching', title: 'Caching', heading: 'Advanced' },
            { key: 'processing', title: 'Text Processing', heading: 'Advanced' },
            { key: 'placeholders', title: 'Placeholders', heading: 'Advanced' },
            { key: 'patterns', title: 'Patterns', heading: 'Advanced' },
            { key: 'prompts', title: 'Prompts', heading: 'Advanced' },
            { key: 'misc', title: 'Other Options', heading: 'Advanced' },
            { key: 'presets', title: 'Custom Presets', heading: 'Advanced' }
        ];
        const childTitles = {
            general: 'General settings (apply to every model)',
            permodel: 'Per-model settings (for the selected model)',
            roles: 'Role assignment (Main / Fallback / Glossary / Review)',
            ep1: 'Endpoint 1 (Primary)', fallback: 'Fallback', glossary: 'Glossary', review: 'Review'
        };
        for (let n = 2; n <= _epCount; n++) childTitles['ep' + n] = 'Endpoint ' + n;
        const actionNodes = [
            {
                type: 'actions',
                title: 'ApplyCustomPreset1',
                fieldHtmlClass: 'actionButtonSet',
                items: [
                    {
                        type: 'button',
                        title: 'Apply Custom Preset 1 (click then close options to apply)',
                        onClick: (evt) => {
                            this.storedOptions.forEach((option) => {
                                try {
                                    const preset1 = JSON.parse(this.optionOptionsPreset1.getValue() || '{}');
                                    if (preset1[option.getId()] !== undefined && option.getId() != "optionsPreset1" && option.getId() != "optionsPreset2" && option.getId() != "optionsPreset3") {
                                        option.setValue(preset1[option.getId()]);
                                    }
                                }
                                catch (e) { }
                            });
                        }
                    }
                ]
            },
            {
                type: 'actions',
                title: 'ApplyCustomPreset2',
                fieldHtmlClass: 'actionButtonSet',
                items: [
                    {
                        type: 'button',
                        title: 'Apply Custom Preset 2 (click then close options to apply)',
                        onClick: (evt) => {
                            this.storedOptions.forEach((option) => {
                                try {
                                    const preset2 = JSON.parse(this.optionOptionsPreset2.getValue() || '{}');
                                    if (preset2[option.getId()] !== undefined && option.getId() != "optionsPreset1" && option.getId() != "optionsPreset2" && option.getId() != "optionsPreset3") {
                                        option.setValue(preset2[option.getId()]);
                                    }
                                }
                                catch (e) { }
                            });
                        }
                    }
                ]
            },
            {
                type: 'actions',
                title: 'ApplyCustomPreset3',
                fieldHtmlClass: 'actionButtonSet',
                items: [
                    {
                        type: 'button',
                        title: 'Apply Custom Preset 3 (click then close options to apply)',
                        onClick: (evt) => {
                            this.storedOptions.forEach((option) => {
                                try {
                                    const preset3 = JSON.parse(this.optionOptionsPreset3.getValue() || '{}');
                                    if (preset3[option.getId()] !== undefined && option.getId() != "optionsPreset1" && option.getId() != "optionsPreset2" && option.getId() != "optionsPreset3") {
                                        option.setValue(preset3[option.getId()]);
                                    }
                                }
                                catch (e) { }
                            });
                        }
                    }
                ]
            },
            {
                type: 'actions',
                title: 'Reset All Options to default',
                fieldHtmlClass: 'actionButtonSet',
                items: [
                    {
                        type: 'button',
                        title: 'Reset all settings to default except Custom Presets (click then close options to apply)',
                        onClick: (evt) => {
                            this.storedOptions.forEach((option) => {
                                try {
                                    // These don't work unfortunately. We'd need to reach the Ace Editor variable somehow. icba.
                                    //(<any> window).clicked = evt;
                                    //var $optionWindow = $((evt.target).parentNode.parentNode);
                                    //$optionWindow.find(`[name="${option.getId()}"]`).val(option.getDefault());
                                    if (option.getId() != "optionsPreset1" && option.getId() != "optionsPreset2" && option.getId() != "optionsPreset3" && option.getValue() != option.getDefault()) {
                                        option.setValue(option.getDefault());
                                    }
                                }
                                catch (e) { }
                            });
                        }
                    }
                ]
            }
        ];
        // Retired limit options are kept as internal guardrails (engine logic + retry/fallback
        // still reference them) but hidden from the UI. Scene-aware batching in SLRbatch plus
        // Maximum Scene Size now govern request sizing, so these are no longer user-facing.
        const _retiredOptionIds = new Set(['maxTranslationLength', 'minLines', 'maxLines', 'maxTranslationLength2', 'minLines2', 'maxLines2', 'endpointCount']);
        // The model-level runtime fields are now per-model profile state written through the Models
        // panel, so their global card fields are hidden. They stay registered (the Start handler
        // still reads them once to seed an empty profile map) but no longer render. The draft
        // placement trio joined them: a draft layer count only means something relative to the
        // model whose draft it is, so a server-wide field was the wrong home.
        const _retiredRuntimeProfileIds = ['runtimeContextLength', 'runtimeKvType', 'runtimeGpuLayers',
            'runtimeCpuMoe', 'runtimeCpuMoeLayers', 'runtimeLoadMode', 'runtimeSplitMode', 'runtimeTensorSplit',
            'runtimeMainGpu', 'runtimeOverrideTensor', 'runtimeExpertCount', 'runtimeDraftMax', 'runtimeDraftMin',
            'runtimeDraftGpuLayers', 'runtimeDraftCpuMoe', 'runtimeDraftCpuMoeLayers',
            'runtimeParallelSlots', 'runtimeModelProfiles'];
        for (const retiredId of _retiredRuntimeProfileIds) _retiredOptionIds.add(retiredId);
        const _visibleOptions = this.storedOptions.filter((o) => !_retiredOptionIds.has(o.getId()));
        // Role gates for the inactive-role gray-out: a role's options do
        // nothing while its API URL is blank, so its groups render dimmed
        // with a notice until the URL is filled. Endpoint 1 (Primary) is
        // always active and never gated.
        const _roleGates = [
            { urlId: 'apiUrl2', child: 'fallback', label: 'Fallback' },
            { urlId: 'glossaryApiUrl', child: 'glossary', label: 'Glossary' },
            { urlId: 'reviewApiUrl', child: 'review', label: 'Review' }
        ];
        for (let n = 2; n <= _epCount; n++) {
            _roleGates.push({ urlId: 'ep' + n + '_apiUrl', child: 'ep' + n, label: 'Endpoint ' + n });
        }
        // Task 11 + 18: materialise the per-model settings panel and the role pickers BEFORE the form
        // is built, then append their nodes to the one Bundled Local Runtime card via sectionAppend
        // (the same materialise-before-render pattern the endpoint generation uses above). The card
        // is one top-level section with three child groups: the general server settings
        // (`general`), the per-model nodes (`permodel`) and the role pickers (`roles`). The
        // Start/Stop buttons and the status line sit ABOVE the child groups, directly under the
        // card legend (sectionPrepend): they are the primary action for the whole card, and
        // nesting them in "General settings" buried them one level below their meaning.
        const runtimePanels = (typeof this.buildRuntimePanelNodes === 'function') ? this.buildRuntimePanelNodes() : null;
        // Keep the panel's node objects reachable for onBeforeRenderOptions: their captured
        // `value` is what jsonform renders, so each render has to re-point them at the current
        // schema defaults (see onBeforeRenderOptions).
        this._runtimePanelNodes = (runtimePanels && runtimePanels.nodes) ? runtimePanels.nodes : [];
        this._runtimePanelRoleNodes = (runtimePanels && runtimePanels.roleNodes) ? runtimePanels.roleNodes : [];
        const _runtimeLeadNodes = [];
        if (Array.isArray(this.localRuntimeActionNodes)) {
            for (const node of this.localRuntimeActionNodes) _runtimeLeadNodes.push(node);
        }
        if (this.localRuntimeStatusNode) _runtimeLeadNodes.push(this.localRuntimeStatusNode);
        const _sectionAppend = {
            quickstart: [quickStartTestNode, quickStartStatusNode],
            connection: [addEndpointNode],
            localruntime: {
                permodel: (runtimePanels && runtimePanels.nodes) ? runtimePanels.nodes : [],
                roles: (runtimePanels && runtimePanels.roleNodes) ? runtimePanels.roleNodes : []
            }
        };
        const _sectionPrepend = { localruntime: _runtimeLeadNodes };
        this.translatorEngine.optionsForm = OptionFormBuilder.build({
            storedOptions: _visibleOptions,
            engine: this.translatorEngine,
            sections,
            sectionOf,
            childOrder: (function () { const o = ['general', 'permodel', 'roles']; for (let n = 1; n <= _epCount; n++) o.push('ep' + n); o.push('fallback', 'glossary', 'review'); return o; })(),
            childTitle: (c) => childTitles[c] || c,
            // Reasoning Format is the most important field of every role group (it decides whether the
            // model thinks at all, which dominates every sampling value below it), so it leads each
            // group instead of sitting in the middle of the sampling fields. Declarative per child so a
            // future "head this group" request is a data change, not another special case.
            headOf: {
                ep1: 'reasoningFormat',
                fallback: 'reasoningFormat2',
                glossary: 'glossaryReasoningFormat',
                review: 'reviewReasoningFormat'
            },
            collapsible: true,
            roleGates: _roleGates,
            sectionPrepend: _sectionPrepend,
            sectionAppend: _sectionAppend,
            append: { nodes: actionNodes }
        });
        // The per-model panel and role pickers are jsonform nodes with their own schema keys
        // (built by the engine's pure helpers), so merge those keys into the built form. Without
        // this jsonform would not render the extra fields.
        if (runtimePanels) {
            for (const panelKey of Object.keys(runtimePanels.schema)) {
                this.translatorEngine.optionsForm.schema[panelKey] = runtimePanels.schema[panelKey];
            }
            for (const panelKey of Object.keys(runtimePanels.defaults)) {
                this.translatorEngine.optionsForm.defaults[panelKey] = runtimePanels.defaults[panelKey];
            }
        }
        // Remember whether this build had a usable runtime. buildRuntimePanelNodes degrades to
        // default-only hints and an empty model list while window.llmRuntime is not loaded yet,
        // which is the case on the first build (it runs during addon load, before the llmRuntime
        // addon). onBeforeRenderOptions rebuilds when the Options window later renders.
        try {
            this._runtimePanelStale = runtimePanelIsStale((typeof window !== "undefined") ? window : null);
        } catch (e) {
            this._runtimePanelStale = true;
        }
        this.translatorEngine.init();
    }
    addOption(option) {
        this.storedOptions.push(option);
        this.storedOptionsHash[option.getId()] = option;
    }
    // User-facing setting ids that are per-endpoint = those with a `2` (fallback) variant,
    // minus retired limit ids. Derived from registered options so it never goes stale.
    _getEndpointSettingsList() {
        if (this._endpointSettingsCache) return this._endpointSettingsCache;
        const retired = new Set(['maxTranslationLength', 'minLines', 'maxLines']);
        const set = new Set();
        for (const id of Object.keys(this.storedOptionsHash)) {
            if (!id.endsWith('2') || id.length < 2) continue;
            if (id.startsWith('glossary') || id.startsWith('ep')) continue;
            const base = id.slice(0, -1);
            if (!this.storedOptionsHash[base]) continue;     // no base option -> not a fallback pair
            if (retired.has(base)) continue;
            if (FALLBACK_ONLY_SETTINGS.indexOf(base) !== -1) continue;  // shared across endpoints
            set.add(base);
        }
        this._endpointSettingsCache = Array.from(set);
        return this._endpointSettingsCache;
    }
    // Clone the factory default of `settingId` from its `2` (fallback) variant if present, else base.
    _getEndpointDefault(settingId) {
        const fb = this.storedOptionsHash[settingId + '2'];
        if (fb) return fb.getDefault();
        const base = this.storedOptionsHash[settingId];
        return base ? base.getDefault() : '';
    }
    // Generate the ep{N}_* option objects for endpoint number N (N >= 2) and register them.
    // URL/key default to '' (blank) so an unconfigured endpoint is excluded from the pool.
    generateEndpointOptions(N) {
        for (const settingId of this._getEndpointSettingsList()) {
            const id = 'ep' + N + '_' + settingId;
            if (this.storedOptionsHash[id]) continue;            // already exists
            const base = this.storedOptionsHash[settingId];
            if (!base) continue;
            const blankUrl = (settingId === 'apiUrl' || settingId === 'apiKey');
            const opt = new TranslationEngineOption_1.TranslationEngineOption({
                wrapper: this,
                id: id,
                type: base.getType(),
                default: blankUrl ? '' : this._getEndpointDefault(settingId),
                name: 'Endpoint ' + N + ' ' + (base.getName().replace(/^Fallback\s+/, '')),
                description: base.getDescription(),
                category: base.getCategory(),
                formType: base.getFormType(),
                formOptions: base.getFormOptions(),
                schemaOptions: base.getSchemaOptions()
            });
            this[id + '_opt'] = opt;
        }
        if (!this.storedOptionsHash['ep' + N + '_weight']) {
            const w = new TranslationEngineOption_1.TranslationEngineOption({
                wrapper: this, id: 'ep' + N + '_weight', type: 'number', default: 1,
                name: 'Endpoint ' + N + ' Weight',
                description: 'How many concurrent batches this endpoint may handle.',
                category: TranslationEngineOptionCategories.OPTIONS
            });
            this['ep' + N + '_weight_opt'] = w;
            w.options.childForm = [{
                type: 'button',
                title: 'Delete Endpoint ' + N,
                onClick: (evt) => { this.deleteEndpoint(N); this._rebuildAndRender(evt); }
            }];
        }
    }
    // Remove all ep{N}_* options for endpoint N (N >= 2).
    removeEndpointOptions(N) {
        const ids = ['weight', ...this._getEndpointSettingsList()].map(s => 'ep' + N + '_' + s);
        for (const id of ids) {
            this.storedOptions = this.storedOptions.filter(o => o.getId() !== id);
            delete this.storedOptionsHash[id];
            delete this[id + '_opt'];
        }
    }
    // Resolve a single templated setting for an endpoint (1-based). epNumber 1 -> base option.
    // The live-fallback rule lives in EndpointHelpers.resolveEndpointValue
    // (unit-tested): an additional endpoint reads its own epN_* option when
    // present and NEVER live-follows Main when it is missing.
    getEndpointSetting(epNumber, settingId) {
        const n = (epNumber === undefined || epNumber === null || epNumber < 1) ? 1 : epNumber;
        const key = (n === 1) ? settingId : ('ep' + n + '_' + settingId);
        const readOpt = (id) => {
            const o = this.storedOptionsHash[id];
            if (!o) return undefined;
            let value, def;
            try { value = o.getValue(); } catch (e) { return undefined; }
            try { def = o.getDefault(); } catch (e) { def = undefined; }
            return { value: value, def: def };
        };
        const values = {};
        const own = readOpt(key);
        if (own !== undefined) values[key] = own;
        if (key !== settingId) {
            const base = readOpt(settingId);
            if (base !== undefined) values[settingId] = base;
        }
        return EndpointHelpers_1.resolveEndpointValue(values, this._getEndpointSettingsList(), n, settingId);
    }
    // Resolve ALL templated settings for an endpoint into a plain object keyed by setting id.
    getEndpointSettings(epNumber) {
        const out = {};
        for (const s of this._getEndpointSettingsList()) out[s] = this.getEndpointSetting(epNumber, s);
        return out;
    }
    // Dense active-endpoint list [{number, weight}] for the dispatcher (URL non-blank, weight clamped).
    getActiveEndpoints() {
        const count = Math.max(1, parseInt(this.optionEndpointCount.getValue(), 10) || 1);
        const raw = [];
        for (let n = 1; n <= count; n++) {
            const url = this.getEndpointSetting(n, 'apiUrl');
            const weight = (n === 1)
                ? this.optionEndpointWeight.getValue()
                : this.getEndpointSetting(n, 'weight');
            raw.push({ number: n, url: url, weight: weight });
        }
        return EndpointHelpers_1.buildActiveEndpointList(raw);
    }
    // --- escalations cooldown (429 rate limits and repeated request failures) ---
    // Per-endpoint cooldown so a quota-blocked or unreachable key isn't hammered. Each
    // consecutive failure grows the cooldown; a successful request resets the streak. Both
    // rate limiting and plain transport/server failures share the schedule and streak store,
    // so the review layer and the translation dispatcher back off the same endpoint together.
    static get ENDPOINT_429_SCHEDULE() {
        return EndpointHealth_1.ENDPOINT_COOLDOWN_SCHEDULE;
    }
    // Shared streak bump: returns the applied cooldown so callers can log it.
    _markEndpointCooldown(n, label) {
        if (!this.endpointCooldown) this.endpointCooldown = {};
        const c = this.endpointCooldown[n] || { until: 0, streak: 0 };
        c.streak += 1;
        const ms = EndpointHealth_1.cooldownForStreak(c.streak);
        c.until = Date.now() + ms;
        this.endpointCooldown[n] = c;
        this.error('[DSLR] Endpoint ' + n + ' ' + (label || 'rate-limited (429)') +
            '. Cooldown ' + Math.round(ms / 1000) + 's (streak ' + c.streak + ').');
        return ms;
    }
    _markEndpoint429(n) {
        return this._markEndpointCooldown(n, 'rate-limited (429)');
    }
    // Repeated transport/server failures are not a permanent misconfiguration (unlike 401/403/404),
    // but they are also not worth re-hammering: cool the endpoint down so the next review call
    // rotates away instead of re-running the full backoff, and so the translation dispatcher skips
    // it too.
    _markEndpointUnstable(n) {
        return this._markEndpointCooldown(n, 'unreachable (repeated request failures)');
    }
    _resetEndpointStreak(n) {
        if (this.endpointCooldown) delete this.endpointCooldown[n];
    }
    // Milliseconds left on this endpoint's cooldown (0 when available).
    _endpointCooldownRemaining(n) {
        const c = this.endpointCooldown && this.endpointCooldown[n];
        if (!c) return 0;
        return EndpointHealth_1.cooldownRemainingMs(c.until);
    }
    // An unrecoverable status (bad key/URL/permission) won't fix itself by retrying, so disable
    // the endpoint for the whole job (skipped until restart).
    _disableEndpoint(n) {
        if (!this.endpointDisabled) this.endpointDisabled = new Set();
        this.endpointDisabled.add(n);
        if (this.endpointCooldown) delete this.endpointCooldown[n];
        this.error('[DSLR] Endpoint ' + n + ' disabled for the rest of this job (unrecoverable status).');
    }
    // HTTP statuses that mean the endpoint/key is misconfigured and won't recover by retrying
    // (so the endpoint is disabled rather than cooled down). 429 stays a transient cooldown.
    _isUnrecoverableStatus(rstatus) {
        return /^(401|403|404)$/.test(String(rstatus));
    }
    _endpointAvailable(n) {
        if (this.endpointDisabled && this.endpointDisabled.has(n)) return false;
        const c = this.endpointCooldown && this.endpointCooldown[n];
        return !c || Date.now() >= c.until;
    }
    _incEndpointInFlight(n) {
        if (!this.endpointInFlight) this.endpointInFlight = {};
        this.endpointInFlight[n] = (this.endpointInFlight[n] || 0) + 1;
    }
    _decEndpointInFlight(n) {
        if (this.endpointInFlight && this.endpointInFlight[n]) {
            this.endpointInFlight[n]--;
            if (this.endpointInFlight[n] <= 0) delete this.endpointInFlight[n];
        }
    }
    // Reset all per-job ephemeral endpoint state. Called at the start of each translation job so a
    // stale 429 cooldown / in-flight count / disabled flag from an aborted previous job can't
    // dead-lock the dispatcher (which would otherwise see zero spare capacity and never dispatch
    // the first batch). Safe against late slot releases from the previous job: _decEndpointInFlight
    // no-ops once the key is gone.
    _resetEndpointState() {
        this.endpointCooldown = {};
        this.endpointDisabled = new Set();
        this.endpointInFlight = {};
        this._urlGroupLastPick = {};
        this.pendingRotations = 0;
        if (this.translatorEngine) this.translatorEngine.pendingRotations = 0;
    }
    _hasMultipleEndpoints() {
        try { return this.getActiveEndpoints().length > 1; } catch (e) { return false; }
    }
    // Next active endpoint whose cooldown has expired AND has spare capacity (inFlight < weight).
    _groupByUrl() {
        return !!(this.optionGroupByUrl && this.optionGroupByUrl.getValue() === true);
    }
    _normalizeUrl(url) {
        return String(url || '').toLowerCase().replace(/\/+$/, '');
    }
    // Group active endpoints by normalized URL -> { url: [{number, weight}] }.
    _endpointGroups() {
        const groups = {};
        const active = this.getActiveEndpoints();
        for (let i = 0; i < active.length; i++) {
            const key = this._normalizeUrl(active[i].url);
            (groups[key] = groups[key] || []).push(active[i]);
        }
        return groups;
    }
    _nextAvailableEndpoint() {
        const active = this.getActiveEndpoints();
        if (!this._groupByUrl()) {
            for (let i = 0; i < active.length; i++) {
                const num = active[i].number;
                if (!this._endpointAvailable(num)) continue;
                if (((this.endpointInFlight && this.endpointInFlight[num]) || 0) < active[i].weight) return num;
            }
            return null;
        }
        // Grouped: an endpoint is usable if its URL group has spare capacity (cap = max weight).
        const groups = {};
        for (let i = 0; i < active.length; i++) {
            if (!this._endpointAvailable(active[i].number)) continue;
            const key = this._normalizeUrl(active[i].url);
            (groups[key] = groups[key] || []).push(active[i]);
        }
        for (const key in groups) {
            const members = groups[key];
            let cap = 0, inUse = 0;
            for (let j = 0; j < members.length; j++) {
                if (members[j].weight > cap) cap = members[j].weight;
                inUse += (this.endpointInFlight[members[j].number] || 0);
            }
            if (inUse < cap) return members[0].number; // the failed key is on cooldown, so it's excluded
        }
        return null;
    }
    // Total spare capacity (dispatcher reserves this for pending rotations). Group-aware.
    totalSpareCapacity() {
        const active = this.getActiveEndpoints();
        if (!this._groupByUrl()) {
            let spare = 0;
            for (let i = 0; i < active.length; i++) {
                if (!this._endpointAvailable(active[i].number)) continue;
                const inUse = (this.endpointInFlight && this.endpointInFlight[active[i].number]) || 0;
                spare += Math.max(0, active[i].weight - inUse);
            }
            return spare;
        }
        const groups = this._endpointGroups();
        let spare = 0;
        for (const key in groups) {
            const members = groups[key];
            let cap = 0, inUse = 0, anyAvail = false;
            for (let j = 0; j < members.length; j++) {
                if (this._endpointAvailable(members[j].number)) anyAvail = true;
                if (members[j].weight > cap) cap = members[j].weight;
                inUse += (this.endpointInFlight[members[j].number] || 0);
            }
            if (anyAvail) spare += Math.max(0, cap - inUse);
        }
        return spare;
    }
    // Total concurrency cap. Grouped: sum of per-group max weights; else sum of weights.
    getTotalConcurrency() {
        const active = this.getActiveEndpoints();
        if (active.length === 0) return 1;
        if (!this._groupByUrl()) {
            let sum = 0; for (let i = 0; i < active.length; i++) sum += active[i].weight; return sum;
        }
        const groups = this._endpointGroups();
        let sum = 0;
        for (const key in groups) {
            const members = groups[key];
            let cap = 0;
            for (let j = 0; j < members.length; j++) if (members[j].weight > cap) cap = members[j].weight;
            sum += cap;
        }
        return Math.max(1, sum);
    }
    // Ms until the earliest active endpoint's cooldown expires (0 if one is available now). Capped at 1h.
    _cooldownWaitMs() {
        const active = this.getActiveEndpoints();
        let minWait = null;
        for (let i = 0; i < active.length; i++) {
            const num = active[i].number;
            if (this.endpointDisabled && this.endpointDisabled.has(num)) continue; // disabled: never wait for it
            const c = this.endpointCooldown && this.endpointCooldown[num];
            if (!c) return 0;
            const wait = c.until - Date.now();
            if (wait <= 0) return 0;
            if (minWait === null || wait < minWait) minWait = wait;
        }
        return minWait === null ? 0 : Math.min(minWait, 3600000);
    }
    // Bump endpointCount and materialize the new endpoint's options. Re-render is
    // driven by the caller's button onClick (via _rebuildAndRender).
    addEndpoint() {
        let n = Math.max(1, parseInt(this.optionEndpointCount.getValue(), 10) || 1) + 1;
        this.optionEndpointCount.setValue(n);
        this.translatorEngine.update('endpointCount', n);
        this.generateEndpointOptions(n);
        // The new endpoint starts as a frozen copy of Main's live values —
        // except URL and key, which stay blank so it only joins the pool once
        // pointed somewhere with real credentials — and never live-follows
        // Main afterwards.
        try {
            const templateIds = this._getEndpointSettingsList();
            const baseValues = {};
            for (const sid of templateIds) {
                const b = this.storedOptionsHash[sid];
                if (!b) continue;
                try {
                    const v = b.getValue();
                    if (v !== undefined) baseValues[sid] = v;
                } catch (e) { /* per-setting best-effort */ }
            }
            const copies = EndpointHelpers_1.endpointCopyValues(baseValues, templateIds, n);
            for (const id in copies) {
                const target = this.storedOptionsHash[id];
                if (!target) continue;
                try {
                    target.setValue(copies[id]);
                    this.translatorEngine.update(id, copies[id]);
                } catch (e) { /* per-setting best-effort */ }
            }
        } catch (e) { /* copy is best-effort */ }
    }
    // Delete endpoint N (>= 2): shift higher endpoints down, drop the tail, then
    // the caller's onClick rebuilds + re-renders.
    deleteEndpoint(N) {
        if (N < 2) return;                       // endpoint 1 and fallback are not deletable
        const count = parseInt(this.optionEndpointCount.getValue(), 10) || 1;
        const settings = ['weight', ...this._getEndpointSettingsList()];
        const readVal = (k, name) => this.storedOptionsHash['ep' + k + '_' + name]
            ? this.storedOptionsHash['ep' + k + '_' + name].getValue() : '';
        const writeVal = (k, name, v) => {
            const id = 'ep' + k + '_' + name;
            if (this.storedOptionsHash[id]) {
                this.storedOptionsHash[id].setValue(v);
                this.translatorEngine.update(id, v);
            }
        };
        const newCount = EndpointHelpers_1.shiftEndpointsDown(count, N, settings, readVal, writeVal);
        this.removeEndpointOptions(newCount + 1);
        this.optionEndpointCount.setValue(newCount);
        this.translatorEngine.update('endpointCount', newCount);
    }
    // Rebuild the options form in place, then ask the options dialog to re-render it.
    // The options dialog runs in a SEPARATE NW.js window whose `options` global is NOT
    // visible from this (main-window) module, so resolve that window from the clicked
    // element (evt.target.ownerDocument.defaultView) and call ITS renderOptions — the same
    // render path used when the dialog first opens.
    _rebuildAndRender(evt) {
        this._buildOptionsForm();
        let optWin = null;
        try {
            optWin = (evt && evt.target && evt.target.ownerDocument) ? evt.target.ownerDocument.defaultView : null;
        } catch (e) { optWin = null; }
        const candidates = [
            optWin,
            (typeof window !== 'undefined') ? window : null,
            (typeof window !== 'undefined' && window.opener) ? window.opener : null
        ];
        let rendered = false;
        for (const w of candidates) {
            if (w && w.options && w.options.translatorMenu && typeof w.options.translatorMenu.renderOptions === 'function') {
                try {
                    // No $elm arg: renderOptions defaults to $("#<id> .pluginOptions") in its own window.
                    w.options.translatorMenu.renderOptions(this.translatorEngine);
                    rendered = true;
                    break;
                } catch (e) {
                    console.error('[DSLR] endpoint re-render failed:', e);
                }
            }
        }
        if (!rendered) {
            console.warn('[DSLR] Endpoint list changed but the options dialog could not be re-rendered live. Close and reopen the Options window to see the change.');
        }
    }
    getPatterns(str) {
        try {
            let arr = eval('[\n' + str + '\n]');
            return arr;
        }
        catch (e) {
            console.error('Failed to parse patterns:', str, e);
            return [];
        }
    }
    getProcessingOrder() {
        // 'BREAK,ISOLATE,CUT,SPLIT,ESCAPE'
        const namesToType = {
            break: mtl_text_processor_1.TextProcessorOrderType.BREAK_LINES,
            isolate: mtl_text_processor_1.TextProcessorOrderType.ISOLATE_SENTENCES,
            escape: mtl_text_processor_1.TextProcessorOrderType.ESCAPE_SYMBOLS,
            cut: mtl_text_processor_1.TextProcessorOrderType.CUT_CORNERS,
            split: mtl_text_processor_1.TextProcessorOrderType.AGGRESSIVE_SPLITTING
        };
        let orderStringArray = this.optionProcessingOrder
            .getValue()
            .toLowerCase()
            .replaceAll(/[\.,;\/\|\\]/g, ',')
            .split(',');
        let order = [];
        orderStringArray.forEach((orderString) => {
            let type = namesToType[orderString];
            if (type !== undefined) {
                order.push(type);
            }
            else {
                console.error("Can't find process type: " + orderString);
            }
        });
        return order;
    }
    processorInit() {
        this.processor.setOptions({
            placeholderRecoveryType: this.optionPlaceholderRecoveryType.getValue(),
            protectedPatternsPad: this.optionPadPlaceholder.getValue(),
            aggressiveSplittingPatterns: this.getPatterns(this.optionSplittingPatterns.getValue()),
            aggressiveSplittingTranslatable: false,
            agressiveSplittingNext: false,
            placeholderType: this.optionPlaceholderType.getValue(),
            noRepeat: false,
            mergeSequentialPlaceholders: true,
            maintainScripts: true,
            recoverPadding: true,
            trim: true,
            trimLines: true,
            protectedPatterns: this.getPatterns(this.optionProtectedPatterns.getValue()),
            processingOrder: this.getProcessingOrder(),
            isolateSymbolsPatterns: this.getPatterns(this.optionIsolatePatterns.getValue()),
            lineBreakPatterns: this.getPatterns(this.optionBreakPatterns.getValue()),
            lineBreakReplacement: '\n',
            protectCornersPatterns: this.getPatterns(this.optionSplitEndsPatterns.getValue())
        });
    }
    log(...texts) {
        let elements = [];
        texts.forEach((text) => {
            elements.push(document.createTextNode(text));
        });
        this.print(...elements);
    }
    error(...texts) {
        let elements = [];
        texts.forEach((text) => {
            elements.push(document.createTextNode(text));
        });
        this.printError(...elements);
    }
    print(...elements) {
        let consoleWindow = $('#loadingOverlay .console')[0];
        let pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        elements.forEach((element) => {
            pre.appendChild(element);
        });
        consoleWindow.appendChild(pre);
    }
    printError(...elements) {
        let consoleWindow = $('#loadingOverlay .console')[0];
        let pre = document.createElement('pre');
        pre.style.color = '#ff7b7b';
        pre.style.fontWeight = 'bold';
        pre.style.whiteSpace = 'pre-wrap';
        elements.forEach((element) => {
            pre.appendChild(element);
        });
        consoleWindow.appendChild(pre);
    }
}
exports.DSLRTranslationEngineWrapper = DSLRTranslationEngineWrapper;
exports.REPETITION_TIER_IDS = REPETITION_TIER_IDS;
exports.DEFAULT_EXPANDED_SECTION_KEYS = DEFAULT_EXPANDED_SECTION_KEYS;
exports.runtimeIsUsable = runtimeIsUsable;
exports.runtimePanelIsStale = runtimePanelIsStale;
exports.shouldRebuildStaleRuntimePanel = shouldRebuildStaleRuntimePanel;
