"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TranslationEngineWrapper = exports.PatternExplanation = exports.TranslationEngineOptionCategories = void 0;
const mtl_text_processor_1 = require("@redsugoi/mtl-text-processor");
const _Constants_1 = require("./_Constants");
const TranslationEngineOption_1 = require("./TranslationEngineOption");
const CacheHandler_1 = require("./CacheHandler");
const RedPerformance_1 = require("./RedPerformance");
const OptionFormBuilder_1 = require("./OptionFormBuilder");
var TranslationEngineOptionCategories;
(function (TranslationEngineOptionCategories) {
    TranslationEngineOptionCategories["PATTERNS"] = "Patterns";
    TranslationEngineOptionCategories["LIMITS"] = "Limits";
    TranslationEngineOptionCategories["OPTIONS"] = "Options";
})(TranslationEngineOptionCategories = exports.TranslationEngineOptionCategories || (exports.TranslationEngineOptionCategories = {}));
const TranslationEngineOptionCategoriesPriority = {
    Options: 0,
    Limits: 1,
    Patterns: 999
};
exports.PatternExplanation = `You can have multiple patterns, separated by commas. A pattern is either a global Regular Expression or a function (wholeString : string, passCount : number) which returns a global regular expression / nothing.`;
class TranslationEngineWrapper {
    constructor(processorClass, thisAddon, extraOptions) {
        this.cache = new CacheHandler_1.CacheHandler(this);
        this.storedOptions = [];
        this.storedOptionsHash = {};
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
            default: mtl_text_processor_1.PlaceholderType.slrsugoi,
            category: TranslationEngineOptionCategories.OPTIONS,
            priority: -2,
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
            priority: -1.5,
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
            default: 'BREAK,SPLIT,ISOLATE,ESCAPE,CUT',
            description: [
                'The order in which the text processor goes through sentences. The same process can be done more than once, and function patterns can activate themselves on only a certain pass.',
                'The order Reddo made back then, as well as the names, are: BREAK,ISOLATE,CUT,SPLIT,ESCAPE',
                'Break is the process of separating sentences out of rows. Isolate is the process of finding inner sequences inside sentences and translating them separatedly. Cut is the process of removing symbols from the corners of each translatable sequence. Split is the process of further dividing sentences into smaller translatable parts. Escape is the process of replacing protected patterns with placeholders.',
                "It is not mandatory to have every process. In fact, you can have none. But by then you're not taking advantage of the text processor. Invalid inputs will be ignored - an error will be printed to the developer console (F12) in those cases."
            ].join('\n'),
            name: 'Processing Order',
            category: TranslationEngineOptionCategories.OPTIONS,
            priority: -1
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
            category: TranslationEngineOptionCategories.OPTIONS,
            priority : 11
        });
    
        public optionUseSplittingNext = new TranslationEngineOption<boolean>({
            wrapper: this,
            id: 'useSplittingNext',
            default: false,
            name:    'Start Sentence with Split',
            description: 'Split Patterns are added to the next sentence rather than the previous one.\nOnly in effect if "Splits are Translatable" is checked.',
            category: TranslationEngineOptionCategories.OPTIONS,
            priority : 12
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
            default: true,
            description: 'Adds white space around placeholders.\nThis is very useful if translating from a language that shares characters with the placeholders. e.g. instead of text%Atext it will send the translator text %A text, which is clearer.\nIn a way, the downside to this is that the end result might end up with more spaces than it should have, so a very minor downside, but a downside nonetheless.',
            name: 'Pad Placeholders',
            category: TranslationEngineOptionCategories.OPTIONS,
            priority: 0
        });
        this.optionUseCache = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'useCache',
            default: true,
            description: 'Stores translations in memory to avoid repeating work.\nThis only matches exact sentences, so there is no downside for this - no losses, only speed gains.',
            name: 'Cache',
            category: TranslationEngineOptionCategories.OPTIONS,
            priority: 499
        });
        this.optionCachePersistent = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'useCachePersistent',
            default: true,
            description: 'Saves cache to a file so that it can be used through multiple sessions.\nThere is no downside to having this on.',
            name: 'Persistent Cache',
            category: TranslationEngineOptionCategories.OPTIONS,
            priority: 500
        });
        this.optionCachePersistentSize = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'cachePersistentSize',
            default: 999,
            description: "The maximum size, in megabytes, that the cache can reach.\nThe value is used as an approximation. It is recommended to use a value that won't cause issues with regards to either memory or disk speed.\nFor reference: a small game will usually fill about 500KB of cache, a medium game will fill about 1MB of cache, and a large game might fill 2MB of cache. So the default value of 10MB is about 5 big games worth of cache.",
            name: 'Persistent Cache Size',
            category: TranslationEngineOptionCategories.OPTIONS,
            priority: 501
        });
        /**
         * Limits
         */
        this.optionMaxRequestLength = new TranslationEngineOption_1.TranslationEngineOption({
            category: TranslationEngineOptionCategories.LIMITS,
            id: 'maxRequestLength',
            name: 'Maximum Batch Size',
            description: 'The amount of characters that each batch will have under batch translations. Higher numbers are faster, but smaller numbers are safer - specially if saving project between each batch. Recommended value is what you should get translated in 10-30 secs, for minimal loss of work in case of errors/failure.',
            default: 20000,
            priority: 1,
            wrapper: this
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
                //'// Value reference',
                //[\\]*[_\-a-z]+\[[^\[\]]+?\]/gi.toString() + ',',
                '// MVMZ Variables',
                /(?<!%)\d+[%]\d*%?\d*%?/g.toString() + ',',
                /[%#]\d+\\+G/g.toString() + ',',
                /[　 ]*[%#]\d+[　 ]*/g.toString() + ',',
                '// VX Variables',
                /[%][sd](?![a-z])/g.toString() + ',',
                '// Placeholder',
                /_actor/g.toString() + ',',
                /_class/g.toString() + ',',
                /_key/g.toString() + ',',
                /_name/g.toString() + ',',
                /_num/g.toString() + ',',
                /_icon/g.toString() + ',',
                /_desc\d/g.toString() + ',',
                /_ABL/g.toString() + ',',
                /\\+WRK(?![\[<])/g.toString() + ',',
                /\\+n[w]?\[\d+\]/gi.toString() + ',',
                //'// RPG Maker conditional choice',
                //(\s*((if)|(en))\(.+?\)\s*)/gi.toString() + ',',
            ].join('\n'),
            description: 'Protected Patterns will replace every match with a placeholder. The placeholder will be replaced by the original value after translation.\n' +
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
                ////////////
                '// Cells that do not include Japanese or placeholders',
                /^[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ@]+$/g.toString() + ',',
                '// dialogue plugin',
                /(?<=^\$gameScreen\.OriginalMessage\(".*?",.*?".*?)[\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´]*",.*?\);$/gim.toString() + ',',
                /(?<=^\$gameScreen\.OriginalMessage\(".*?)",[ 　]*"[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“]*/gim.toString() + ',',
                /^\$gameScreen\.OriginalMessage\("/gim.toString() + ',',
                '//Custom Label',
                /^[　\s]*{"label":"[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ"]+"[^}]+}[\s　]*$/gm.toString() + ',',
                /^[　\s]*{"label":"(?=[^"]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^"]*"[^}]+}[\s　]*$)/gm.toString() + ',',
                /(?<=^[\s　]*{"label":"[^"]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^"]*)"[^}]+}[\s　]*$/gm.toString() + ',',
                '//OSW',
                /^OSW_.*?text \d+ [^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+$/g.toString() + ',',
                /^OSW_.*?text \d+ /g.toString() + ',',
                '//PSM SHOW POPUP',
                /^PSM_SHOW_POPUP.*\d+ [^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+$/g.toString() + ',',
                /(?<=^PSM_SHOW_POPUP.*\d+ [^ ]+) -[a-zA-Z]+?$/g.toString() + ',',
                /^PSM_SHOW_POPUP.*\d+ /g.toString() + ',',
                /^PSM_SHOW_POPUP /g.toString() + ',',
                /<Speech\/[\w+ ]+?\[\w+?\]\:/g.toString() + ',',
                /<Speech\/[\w+ ]+?\:/g.toString() + ',',
                /^<[\w+ ]+?\:[\w\+\-\: ]+>$/gm.toString() + ',',
                /^<SAC.*?\:[\w\+\-\: ]+>$/gm.toString() + ',',
                /^[\w+ ]+?\:[\w\+\-\: ]+$/gm.toString() + ',',
                /(?<=['"])[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+$/g.toString() + ',',
                '// FFF script stuff',
                /^\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /^\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /\\+F+?\[[^\]\r\n]+?\]\]+/gi.toString() + ',',
                /\\+A+?\[[^\]\r\n]+?\]\]+/gi.toString() + ',',
                /^\s\\+(?:F+|E+|A+)\[[^\]\r\n]+?\]\s*/g.toString() + ',',
                /\\+FH\[[^\]\r\n]+?\]+/gi.toString() + ',',
                ////////////
                '// Specific MV/MZ System entries',
                /^%1には効かなかった！$|^%1は %2 のダメージを受けた！$|^%1は%2を %3 奪われた！$|^%1の%2が %3 増えた！$|^%1の%2が %3 減った！$|^%1はダメージを受けていない！$|^ミス！　%1はダメージを受けていない！$|^%1の%2が %3 回復した！$|^%1の%2が上がった！$|^%1の%2が元に戻った！$|^%1の反撃！$|^%1の%2が下がった！$|^%1は戦いに敗れた。$|^%1が出現！$|^%1に %2 のダメージを与えた！$|^%1の%2を %3 奪った！$|^%1にダメージを与えられない！$|^ミス！　%1にダメージを与えられない！$|^%1は逃げ出した！$|^%1は攻撃をかわした！$|^次の%1まで$|^現在の%1$|^%1は%2 %3 に上がった！$|^%1は魔法を打ち消した！$|^%1は魔法を跳ね返した！$|^%1 の%2を獲得！$|^お金を %1\\G 手に入れた！$|^%1を手に入れた！$|^%1を覚えた！$|^%1たち$|^%1は先手を取った！$|^%1が%2をかばった！$|^%1は不意をつかれた！$|^%1は%2を使った！$|^%1の勝利！$/g.toString() + ',',
                '// Specific MV/MZ States entries',
                /^%1は倒れた！$|^%1を倒した！$|^%1は立ち上がった！$|^%1は毒にかかった！$|^%1に毒をかけた！$|^%1の毒が消えた！$|^%1は暗闇に閉ざされた！$|^%1を暗闇に閉ざした！$|^%1の暗闇が消えた！$|^%1は沈黙した！$|^%1を沈黙させた！$|^%1の沈黙が解けた！$|^%1は激昂した！$|^%1を激昂させた！$|^%1は我に返った！$|^%1は混乱した！$|^%1を混乱させた！$|^%1は魅了された！$|^%1を魅了した！$|^%1は眠った！$|^%1を眠らせた！$|^%1は眠っている。$|^%1は目を覚ました！$|^%1はしびれて動けなくなった！$|^%1を麻痺させた！$|^%1は体がしびれて動けない！$|^%1の麻痺が解けた！$|^%1はバランスを崩した！$|^%1はバランスを崩している……$|^%1は体勢を立て直した！$|^%1は狙われやすくなった！$|^%1は狙われにくくなった！$|^%1は炎の力を身にまとった。$|^%1は氷の力を身にまとった。$|^%1は雷の力を身にまとった%1は炎や氷の攻撃に強くなった$|^炎や氷に強くなっている$|^水のガードの効果が切れた$|^%1は分身して２回行動できるようになった$|^%1は分身している$|^%1の分身が切れた$/g.toString() + ',',
                '// Specific VX/Ace Scripts entries',
                /^所持数$|^購入する$|^売却する$|^やめる$|^持っている数$|^現在の経験値$|^どのファイルにセーブしますか？$|^どのファイルをロードしますか？$|^ファイル$|^会心の一撃！！$|^痛恨の一撃！！$|^しかし逃げることはできなかった！$|^戦闘に勝利した$|^%sが現れた！$|^%sの先制！$|^%sは退却した$|^%sは戦いに敗れた…$|^%s の経験値を獲得$|^%s\\\\G 手に入れた$|^%sを手に入れた$|^%sは%s %s に上がった$|^%sを覚えた$|^次の%sまで$|^%sは逃げてしまった。$|^お金を %s%s 手に入れた！$|^%sの攻撃！$|^%sは身を守っている。$|^%sは様子を見ている。$|^%sたち$|^%sが出現！$|^%sは先手を取った！$|^%sは不意をつかれた！$|^%sは逃げ出した！$|^%sの勝利！$|^%sは戦いに敗れた。$|^%s の経験値を獲得！$|^お金を %s\\\\G 手に入れた！$|^%sを手に入れた！$|^%sは%s %s に上がった！$|^%sを覚えた！$|^%sは%sを使った！$|^%sは %s のダメージを受けた！$|^%sの%sが %s 回復した！$|^%sの%sが %s 増えた！$|^%sの%sが %s 減った！$|^%sは%sを %s 奪われた！$|^%sはダメージを受けていない！$|^ミス！　%sはダメージを受けていない！$|^%sに %s のダメージを与えた！$|^%sの%sを %s 奪った！$|^%sにダメージを与えられない！$|^ミス！　%sにダメージを与えられない！$|^%sは攻撃をかわした！$|^%sは魔法を打ち消した！$|^%sは魔法を跳ね返した！$|^%sの反撃！$|^%sが%sをかばった！$|^%sの%sが上がった！$|^%sの%sが下がった！$|^%sの%sが元に戻った！$|^%sには効かなかった！$|^お金を %s%s 失った。$|^%sの%sが %s に下がってしまった。$/g.toString() + ',',
                '// Common plugin calls',
                /(^D_TEXT )|(^DW_[A-Z]+ )|(^addLog )|(^greedCommand )|(^ShowInfo )|(^text_indicator :)|(^.+?subject=)/g.toString() + ',',
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
                /^[　 ]*[〔⟨〖〘〚’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*\\+[abd-zABD-Z_]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*\\+[a-zA-Z_]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*/gim.toString() + ',',
                /[　 ]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*\\+[abd-zABD-Z_]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*\\+[a-zA-Z_]+\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*$/gim.toString() + ',',
                /[　 ]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*\\+[\w_]+(?<!(\\n)|(\\name)|(\\nw)|(\\c))\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\][〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*/gim.toString() + ',',
                /[　 ]*[〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“]*\\+[\w_]+(?<!(\\n)|(\\name)|(\\nw))\<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?\>[〕〗〙〛\’〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“]*[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])[\[<]?\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])[\[<]?\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])[\[<]?\\+[\w_]+\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])[\[<]?\\+[\w_]+\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])[\[<]?\\+[\w_]+[\[<][\[<]?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\d\>]+?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\>]*?[\]>][\]>]?[\]>]?(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*(?<= |^|　|[^\\])\\+[\w_]+(?= |$|　|[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ〔⟨〖〘〚\’〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“])[　 ]*/gim.toString() + ',',
                /[　 ]*\\[n](?![\[\<\w])[　 ]*/gim.toString() + ',',
                '// MZ Script text',
                /^テキスト-/g.toString() + ',',
                /^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*$/gim.toString() + ',',
                /^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\"?/gi.toString() + ',',
                '// Plugins',
                /\{[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\}]+?\|[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\}]+?\}/gm.toString() + ',',
                /\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]]+\/[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]]+\]/g.toString() + ',',
                /^\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]]+\]/g.toString() + ',',
                /^LL_GalgeChoiceWindowMV ?setChoices ?/gm.toString() + ',',
                /^LL_GalgeChoiceWindowMV ?setMessageText ?/g.toString() + ',',
                /BattleManager\._logWindow\.addText\(\'[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\'\)]*?\'\);/g.toString() + ',',
                //[%][sd](?![a-z])/g.toString() + ',',
                /<Custom \w+? Effect>[\s\S]*?<\/Custom \w+? Effect>/gi.toString() + ',',
                /\\+#/g.toString() + ',',
                //[%#]\d+\\+G/g.toString() + ',',
                /[#]\d+\\+G/g.toString() + ',',
                //(?<!%)\d+[%]\d*%?\d*%?/g.toString() + ',',
                //[　 ]*[%#]\d+[　 ]*/g.toString() + ',',
                /[　 ]*[#]\d+[　 ]*/g.toString() + ',',
                //@\d+(?=[^@]|$)/g.toString() + ',',
                /\\+FW[^\[<']/g.toString() + ',',
                /\\+rb\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+RB\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+G\<.*?\>/gi.toString() + ',',
                /\<DEP_.*?\>/gi.toString() + ',',
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
                //gi.toString() + ',',
                //gi.toString() + ',',
                '// VX Choice',
                /^選択肢\[\d\]：?/gi.toString() + ',',
                //^選択肢(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                '// PIC',
                /\\+PICN\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICN\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// pauses',
                /\\+!/gi.toString() + ',',
                /\\+\|/gi.toString() + ',',
                '// vo script stuff',
                /\\+vo\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// FFF script stuff',
                /\\+F+?\[[^\]\r\n]+?\]\]+/gi.toString() + ',',
                /\\+F+?\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+A+?\[[^\]\r\n]+?\]\]+/gi.toString() + ',',
                /\\+A+?\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+FH\[[^\]\r\n]+?\]+/gi.toString() + ',',
                /\[OFF\]/gi.toString() + ',',
                /\[ON\]/gi.toString() + ',',
                '// Get rid of useless spaces annoying Sugoi',
                /(?<=[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ❤♥♡…！？。、･♪])　(?=[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ❤♥♡…！？。、･♪])/g.toString() + ',',
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
                /\\+\$/gi.toString() + ',',
                /^SYSTEM/g.toString() + ',',
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
                /・・+/gi.toString() + ',',    
                '// Externmessage',
                /^:event\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+M\[[^\]\r\n]+?\]/gi.toString() + ',',                
                /^:name\[/gi.toString() + ',',
                '// wrap plugin',
                /<wrap>/g.toString() + ',',
                /(?<=[^a-zA-z]|^)wrap(?=[^a-zA-z]|$)/g.toString() + ',',
                '// Choice Help RightClick',
                /^選択肢ヘルプ\n/gi.toString() + ',',
                /^選択肢ヘルプ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                //^右クリック$/g.toString() + ',',
                /^<ActiveMessage:/gi.toString() + ',',
                '// Untranslatable SG Quests',
                /^<SG((手動)|(カテゴリ)|(ピクチャ))[\s\S]*?>/gi.toString() + ',',
                /^<Category:.+?>/gi.toString() + ',',
                '// Translatable SG Quest',
                /^<SG.+?:/gi.toString() + ',',
                '// item inserts',
                /\\+i\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// variable inserts',
                /\\+v\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+w\[[+-]?\d+?\]/gi.toString() + ',',
                '// Ihavenoidea inserts',
                /^メッセージ = /gi.toString() + ',',
                /^表示文字列 = /gi.toString() + ',',
                /\\+oc\[rgb\(.+\)\]/g.toString() + ',',
                /\\+VS\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]/gi.toString() + ',',
                /\\+NA\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]/gi.toString() + ',',
                /_S<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?>/gi.toString() + ',',
                /SG<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?>/gi.toString() + ',',
                /^_EventSetting = "[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\"]?";$/g.toString() + ',',
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
                /^[ ]?[<]?namePop[:]?[ |　][-]?[\d]*[ ]?/g.toString() + ',',
                /[ |　]?[\-]?[\d]*[ ]?[ ]?(?:red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)[>]?$/g.toString() + ',',
                /<namePop:/g.toString() + ',',
                /^[ 　]+$/g.toString() + ',',
                '// broken commands',
                /　*(?<!\\)[ 　]+(?<!\\)\w\[[^\]\r\n]?\]/gim.toString() + ',',
                '// Escaped Text',
                /^[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*?\/\/.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+.*$/gim.toString() + ',',
                //'// Potential Filenames', //too many false positives
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]*[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]*_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                '// Linebreaks',
                /[　 ]*\\+[n](?![\[\<a-zA-Z])[　 ]*/gim.toString() + ',',
                '//Lone Whitespace',
                /^[　 \s]+$/gim.toString() + ',',
            ].join('\n'),
            description: 'Splits sentences according to patterns.' +
                "\nSplitting is very similar to Protected Patterns - they match a pattern and protect it. Generally no benefit in using except in certain projects. You'll know it when you see it." +
                '\nThere are two differences: the first is that splitting leaves nothing to chance - the original position of the matched pattern, its contents, everything will be separated and not even sent to the translator at all.' +
                "\nThe second difference is that the sentence will be split (as the name implies) every time a pattern appears. So while this guarantees the pattern will absolutely be protected, the translator might miss out on contextual cues. This is best used for text that can't be translated (script calls, etc) or something that must survive the translation process no matter what." +
                '\nSplitting out untranslatable symbols that are not related to the sentence improves translation quality and speed with no downsides.' +
                exports.PatternExplanation,
            name: 'Aggressive Splitting',
            category: TranslationEngineOptionCategories.PATTERNS,
            priority: 1,
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
                '// Blank lines',
                /\s*\r?\n\s*\r?\n/g.toString() + ',',
                '// Current sentence ended with punctuation',
                /(?<=[─~\-<>\|\/！？。・…‥：；.?!;:\]\)}〕〗〙〛\’〝〞”｣〉》」』】）］＞>｝｠〟⟩\*"'`´◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#])(\s*\r?\n)/g.toString() +
                    ',',
                '// Next sentence starts with a symbol/opener/punctuaction for some reason',
                /(\r?\n\s*)(?=[─~\-<>\|\/！？。・…‥：；.?!;:〔〖〘〚\’〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]|[\w０１２３４５６７８９ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ]+[〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][wW]?\[[^\]\r\n]+?][〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][wW]?<.+?>[〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][aA][mM][eE]\[[^\]\r\n]+?][〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓]|\\[nN][aA][mM][eE]<.+?>[〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`：；;:<\\\/=〓])/g.toString() +
                    ','
            ].join('\n'),
            description: 'The core of Red Text Processor. Separates sentences according to when it looks like the previous sentence ended, sending them to the translator separatedly.\n' +
                '\nThe default rules are pretty solid, but feel free to change them. The behavior of these patterns is that whatever matches them will be removed and replaced by a simple line break.' +
                exports.PatternExplanation,
            name: 'Line Break Patterns',
            category: TranslationEngineOptionCategories.PATTERNS,
            priority: 2,
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
                 '// Names Catchall',
                /\\+[\w_]+<.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                /\\+[\w_]+(?<!\\G|\\fs|\\RB|\\rb|\\p|\\l|\\r|\\F|\\FF|\\FFF|\\FFFF|\\FFFFF|\\FFFFFF|\\FFFFFFF|\\FFFFFFFF|\\FFFFFFFFF|\\FFFFFFFFFF|\\A|\\AA|\\AAA|\\AAAA|\\AAAAA|\\AAAAAA|\\AAAAAAA|\\AAAAAAAA|\\AAAAAAAAA|\\AAAAAAAAAA|\\p|\\FH|\\SVVN|\\se|\\SE|\\_SE|\\M|\\i|\\v|\\oc|\\VS|\\NA|\\vs|\\na|\\PICN|\\PICE|\\picn|\\pice)\[[^\]\r\n]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/g.toString() + ',',
                '// plugin stuff',
                /BattleManager\._logWindow\.addText\('.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?'\);/gi.toString() + ',',
                /\\+VS\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/gi.toString() + ',',
                //(?<=\\VS)\[[^\[\]]+?\]/gi.toString() + ',',
                /^_EventSetting = ".*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?";$/g.toString() + ',',
                '// Isolate colored text',
                /\\+C\[[^\]\r\n]+?\].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\\+C\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// Isolate VX NA',
                /\\+NA\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/gi.toString() + ',',
                //(?<=\\NA)\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// Isolate MZ stacked text',
                /\{.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\|.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\}/gi.toString() + ',',
                '// Isolate MZ Text Scripts',
                /テキスト-.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                /^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\".*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\"\;$/gim.toString() + ',',
                '// Isolate SG Quest Scripts',
                /<SG.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                /_S<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
//                '// Carefully isolate quotes, except the ones that look like script',
//                /((?<![\w\\])((\[[^\[\]]+\])|(\([^\(]+\)))|(?<![\w\\])(\<[^\<\>]+\>))/gi.toString() + ',',
                /(?<![\w\\])\(.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\)/gi.toString() + ',',
                /(?<![\w\\])\[[^\]\r\n]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\]/gi.toString() + ',',
                /(?<![\w\\])<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>/gi.toString() + ',',
                /(?<=[a-zA-z]|^)['].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?[']/gi.toString() + ',',

                /\\+\".+?\\+\"/gi.toString() + ',',
                /\\+\'.+?\\+\'/gi.toString() + ',',
                '// Isolates matching quoted text',
                ..._Constants_1.isolationGroupsRegExp
            ].join('\n'),
            description: 'This finds text inside brackets and translates it separatedly.\n' +
                "The entire match will be isolated. This is best when paired with Cutting Corners patterns which also remove the boundary symbols - the translator doesn't benefit from seeing the quotes or brackets." +
                exports.PatternExplanation,
            name: 'Isolation Patterns',
            category: TranslationEngineOptionCategories.PATTERNS,
            priority: 4,
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
                "// Pure english, uncomment for sources that don't use english characters",
                //^[\x21-\x7E\* ]+$/g.toString() + ',',
                '// Common plugin calls',
                /(^D_TEXT )|(^DW_[A-Z]+ )|(^addLog )|(^greedCommand )|(^ShowInfo )|(^text_indicator :)|(^.+?subject=)/g.toString() + ',',
                '// files',
                /^.*mplus-1.*$/gi.toString() + ',',
                /^.*vl-gothic.*$/gi.toString() + ',',
                /^.+\.(png|jpg|ttf|woff|otf|txt|ini|rvdata|rgss|json|js|wav|ogg|mp3|mp4|m4a|bmp|exe).*$/gi.toString() + ',',
                 '//names catchall Jap',
                /\\+[a-zA-Z_]+\</gi.toString() + ',',
                '// Plugins',
                /BattleManager\._logWindow\.addText\(\'[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\)\']*?\'\);/g.toString() + ',',
                /BattleManager\._logWindow\.addText\(\'/g.toString() + ',',
                /<Custom \w+? Effect>[\s\S]*?<\/Custom \w+? Effect>/gi.toString() + ',',
                /\\+#/g.toString() + ',',
                //[%#]\d+\\G/g.toString() + ',',
                /[#]\d+\\+G/g.toString() + ',',
                //(?<!%)\d+[%]\d*%?\d*%?/g.toString() + ',',
                //[　 ]*[%#]\d+[　 ]*/g.toString() + ',',
                /[　 ]*[#]\d+[　 ]*/g.toString() + ',',
                //@\d+(?=[^@]|$)/g.toString() + ',',
                //[%][sd](?![a-z])/g.toString() + ',',
                /\\+rb\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+RB\[[^\]\r\n]*?\]/g.toString() + ',',
                /\\+G\<.*?\>/gi.toString() + ',',
                /^GabText /gm.toString() + ',',
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
                /^テキスト-/g.toString() + ',',
                /^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*$/gim.toString() + ',',
                /^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\"?/gi.toString() + ',',
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
                /^選択肢\[\d]：?/gi.toString() + ',',
                //^選択肢(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                '// PIC',
                /\\+PICN\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]\\+\^/gi.toString() + ',',
                /\\+PICN\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+PICE\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// pauses',
                /\\+!/gi.toString() + ',',
                /\\+\|/gi.toString() + ',',
                '// vo script stuff',
                /\\+vo\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// FFF script stuff',
                /\\+F+?\[[^\]\r\n]+?\]\]/gi.toString() + ',',
                /\\+F+?\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+A+?\[[^\]\r\n]+?\]\]/gi.toString() + ',',
                /\\+A+?\[[^\]\r\n]+?\]/gi.toString() + ',',
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
                /\\+\$/gi.toString() + ',',
                /^SYSTEM/g.toString() + ',',
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
                /・・+/gi.toString() + ',',    
                '// Externmessage',
                /^:event\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+M\[[^\]\r\n]+?\]/gi.toString() + ',',                
                /^:name\[/gi.toString() + ',',
                '// wrap plugin',
                /<wrap>/g.toString() + ',',
                /(?<=[^a-zA-z]|^)wrap(?=[^a-zA-z]|$)/g.toString() + ',',
                '// Choice Help RightClick',
                /^選択肢ヘルプ\n/gi.toString() + ',',
                /^選択肢ヘルプ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)/gi.toString() + ',',
                //^右クリック$/g.toString() + ',',
                /^<ActiveMessage:/gi.toString() + ',',
                '// Untranslatable SG Quests',
                /^<SG((手動)|(カテゴリ)|(ピクチャ))[\s\S]*?>/gi.toString() + ',',
                /^<Category:.+?>/gi.toString() + ',',
                '// Translatable SG Quest',
                /^<SG.+?:/gi.toString() + ',',
                /\\+oc\[rgb\(.+\)\]/g.toString() + ',',
                /\\+VS\[/gi.toString() + ',',
                /_CT>+/gi.toString() + ',',
                /\\+NA\[/gi.toString() + ',',
                '// item inserts',
                /\\+i\[[^\]\r\n]+?\]/gi.toString() + ',',
                '// variable inserts',
                /\\+v\[[^\]\r\n]+?\]/gi.toString() + ',',
                /\\+w\[[+-]?\d+?\]/gi.toString() + ',',
                '// Ihavenoidea inserts',
                /^メッセージ = /gi.toString() + ',',
                /^表示文字列 = /gi.toString() + ',',
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
                /^[ ]?[<]?namePop[:]?[ |　][-]?[\d]*[ ]?/g.toString() + ',',
                /[ |　]?[\-]?[\d]*[ ]?[ ]?(?:red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)[>]?$/g.toString() + ',',
                /<namePop:/g.toString() + ',',
                '// Comment?',
                /\/\/.+?$/g.toString() + ',',
                '//Specific pre defined translations',
                /\\+[a-zA-Z]\[\d+\]/gi.toString() + ',',
                /<\d+,\d+>/g.toString() + ',',
                /^カナ$/g.toString() + ',',
                /^決定$/g.toString() + ',',
                /^英数$/g.toString() + ',',
                /^かな$/g.toString() + ',',
                /【剣】/gi.toString() + ',',
                /【杖】/gi.toString() + ',',
                /【フレイル】/gi.toString() + ',',
                /【斧】/gi.toString() + ',',
                /【槍】/gi.toString() + ',',
                /【爪】/gi.toString() + ',',
                /【弓】/gi.toString() + ',',
                /【短剣】/gi.toString() + ',',
                /【グローブ】/gi.toString() + ',',
                /^なし$/gi.toString() + ',',
                /^続きから$/gi.toString() + ',',
                /^昼$/gi.toString() + ',',
                /^ボイス 音量$/gi.toString() + ',',
                /^ベリーハード$/gi.toString() + ',',
                /^身分$/gi.toString() + ',',
                /^状態$/gi.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はぁはぁ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)好きぃ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)大好きぃ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ヒール(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)MPを回復する。(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)弓(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)杖(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)木刀(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)のMPが自動回復する。[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着黒\（腹ボテ\）(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着白\（腹ボテ\）(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着赤\（腹ボテ\）(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着紫\（腹ボテ\）(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着青\（腹ボテ\）(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)素肌\（腹ボテ\）(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着大破・黒(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着大破・白(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着大破・赤(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着大破・紫(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着大破・青(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着黒(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着白(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着赤(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着紫(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修道着青(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)素肌(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んぶちゅれろぉ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)まったく(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)なんでもーー…あひぃんっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)フン(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)へいへ[ー～〜…~]い(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)わ[ー～〜…~]っ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひぇっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\(日\)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\(月\)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\(火\)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\(水\)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\(木\)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\(金\)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\(土\)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)朝(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)夕(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)夜(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)月(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)日(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はあっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ああっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やりぃ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んうーん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)へっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふんッ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)うぅーん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)えぇ～いいじゃんかよ～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んんぅッ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]゛[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)へぇ～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[うぅ]ん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ええ～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んんーッ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[うぅ][うぅ]ーん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)むうん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あぁ～(?=[三]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)わんわん(?=[交]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひゃ[ぁあ][ぃい](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)秋(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)夏(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)春(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)冬(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)にぶーいにぶー(?=[い]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)マワセ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)オカセ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はじめから(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)つづきから(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やあやあ♪[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)何度も何度も何度も(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)回(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)会議は長引き(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ほーん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)北西(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)北東(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)南西(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)南東(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)げぇむ終了(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う～ん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)今度こそ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)修得不可(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)未修得(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ロードメニュー(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)交換する(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あ～やわらけぇ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)いや～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*^セーブしますか？?[　 ❤♥♡…！？。、･♪]*$/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)おっおぉ～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)おいおい随分キツイじゃねえの(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あ～も～ちゃんと踏ん張っててよ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んぶちゅっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ジュポッジュポジュポッ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)クゥさぁ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)うぃ～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あーもーっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)盛大に潮吹いたな～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あ～やべ～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)キャーッ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ごっくんした精液量(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)うおっほぉ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /^ゲーム終了$/g.toString() + ',',
                /^全体 音量$/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ、ふん！(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)こ、ここ+んな事で(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)うあわああっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)いたた(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                
                '// special characters or punctuation',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)の耐久力と抵抗力が低下した。(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)どれぇ、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ちょっ、ちょっと！[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)コイツの乳搾りも、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あ、うう、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)何度も、何度も、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んっ、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やっ、やあぁっ、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やめっ[…]+あうっ、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)いしき、とびそーになりゅけど[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)オ、オノレッ、コノ、オレサマガっ、ニンゲンゴトキニっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)も、[も、]+もっと、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふう･･･[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)うぃーす、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やぁん、もう、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)マ、マ〇コ、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はぁ…+はぁ…+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やっ…+ああっ…+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)おうっ、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぅ、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)わーい[、！]?わーい(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ブランコ[！、]?ブランコ[ー～〜…~](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん～、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あ[ー～〜…~][、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ああ～[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~]+等と、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  [　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  [　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  [　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)偉大[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)おっ[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)えっ[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)どぷっ[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あっ[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふぅ[～]+っ?[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉおぁあ][～]+[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[～]+[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)こんなのッ[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)そうですねぇ[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ほぉッ[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふぅッ[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んぃっ[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ォ?[ぉお]?ッ[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぐ?[ぉお]?[ん]*っ[…]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ああ”[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あ”[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)おお”[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)お”[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん”[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んお”[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んあ”[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[わ]?[ぁあ][ぁあ]+[っッ]?[ー～〜…~]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[❤♥♡♪、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぎゃ[ぁあ][ぁあ]+[ー～〜…~]+[❤♥♡、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  [❤♥♡、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  [❤♥♡、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  [❤♥♡、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  [❤♥♡、][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                '// Variable  Predefined Translations',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひゅ[ー～〜…~]+[っッ]*、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひゅ[ー～〜…~]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ちょ、]*[ちょ][ちょ]*っと(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)きキ[キ]+き[き]+禁術は[あぁ][あぁ][あぁ]+[アァ][アァ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぁあ]+[ぃい]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+[ー～〜…~]+[ん]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う、う、う、嘘[ぁあ][ぁあ]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う、う、嘘[ぁあ][ぁあ]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う、嘘[ぁあ][ぁあ]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)嘘[ぁあ][ぁあ]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぁあ][ぁあ]+[ん]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ん]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',', 
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+ッくぅっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+ッくぅっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~]+ッくぅっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~]+ほ[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ほ[ぁあ][ぁあ]+んっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ][ぁあ]+[っほ]*[ぁあ]*[んっ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ケツマンコにずっぼ[ぁあ][ぁあ][ぁあ]+ん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う、う、う、嘘[ぉお][ぉお]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う、う、嘘[ぉお][ぉお]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う、嘘[ぉお][ぉお]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)嘘[ぉお][ぉお]+[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお]+[ん]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[ぉお][ぉお]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',', 
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+ッくぅっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[ぉお][ぉお]+ッくぅっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~]+ッくぅっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~]+ほ[ぉお][ぉお]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ほ[ぉお][ぉお]+んっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお][ぉお]+[ー～〜…~]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお][ぉお][ぉお]+[っほ]*[ぉお]*[んっ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ケツマンコにずっぼ[ぉお][ぉお][ぉお]+ん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[おっ]+ご[ぉお][ぉお]+[んっ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)しゅっぽ[ぉお][ぉお]+んっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(しゅっぽ)\1*[ぉお][ぉお]+んっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)どびゅ(びゅ)\1+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)しゅっぽ[ぉお]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひぅ[ん][ん]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)バカになる[ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ずる[ぅう][ぅう]+[ん]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぐぷ[ぅう][ぅう]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)なる[ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)びゅ[ー～〜…~][ー～〜…~]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)レロ(レロ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',            
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あえ[ー～〜…~]…(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)へこ(へこ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ｼｺ(ｼｺ)\1+[ｫ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ﾋｸ(ﾋｸ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)むっぎゅ[ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぶっちゅ[ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んっ(んっ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)じゅ[ー～〜…~]*[っッ]*ぶ[ぶ]+[ー～〜…~]*[っッ]*[ぶ]*[ー～〜…~]*[っッ]*[ぶ]*[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)じゅっる[ぅう]]ぅう]+んっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぐちゅぬっぶ[ぅう]?(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)びゅっ?(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んぶっ[ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んぶっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んぶっちゅ[ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んどっびゅ[ぅう][ぅう]+[んっ](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)じゅっぶ[ぅう][ぅう]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぐっり[ぃい][ぃい]+[んっ](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぅう][ぅう]+っ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉおっ]+ご[ぉお][ぉお]+[んっ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぐ]?[ずぬ]+っぶ[ぅう][ぅう]+[んっ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)経産婦のくせにぃ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はぁんっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)も[ぉお][ぉお]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ロード(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひゃ[ぅう][ぅう]+[ん]+ッ?(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぢゅる[る]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~]+ッ[ー～〜…~]*[っッ]*くは[ぁあ][ぁあ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はぁん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あむんっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ー～〜…~][ー～〜…~]+っ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+[ー～〜…~][ー～〜…~]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ビュ[ゥウ][ゥウ]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふぁ[ぃい][ぃい]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)お尻も[ぉお][ぉお]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)は[ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~][ー～〜…~]ぁ…*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)…*ぃ…*イ”*っでりゅ[ぅう]+[ー～〜…~]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+アタシも[ぉお]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~][ー～〜…~][ー～〜…~]+ッんは[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)は[ぁあ][ぁあ]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)こんにゃ感覚…?初めて[ぇえ][ぇえ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)初めて[ぇえ][ぇえ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)く[ぅう][ぅう]+[ん]+[ッっ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぅう]+[ん]+[ッっ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)が立ち上がってくださるとは(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん[ー～〜…~]っ♡+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あ[ー～〜…~]はいはい、そういうのは(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ぅう]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はいはい、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はいはい(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)む[ー～〜…~]+[っッ]*、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)む[ー～〜…~]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん[ー～〜…~]そんなこと言って、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ー～〜…~]む、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぐ[ぉお][ぉお]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+[ー～〜…~]+まじで生ハメ交尾たまんねぇ！[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+[ー～〜…~]+まじで生ハメ交尾たまんねぇ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお]+[ー～〜…~]+でたでた、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお]+[ー～〜…~]+でたでた(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ッっ]+[ぁあ]+が[ぁあ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふん[ー～〜…~]*[っッ]*、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふん[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふーん？[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)まったく[！]+[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)まったく[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)まったく[！]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)フンッ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)また(イク)\1+[ー～〜…~][ー～〜…~]+[ッっ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)むにぃ[ぃ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぅう][ぅう]+[ん][ん]+[ー～〜…~]*[ッっ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)クリ(クリ)\1+[ッっ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)卵が[ぁあ][ぁあ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(おー)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)まあ[まあ][まあ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひえ[え]+[ー～〜…~][ー～〜…~]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ココハ　?ドコ・・・[？]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ココハ　?ドコ・・・(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)いかにもな考古学者(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)いや[あぁ][あぁ]+、[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)いや[あぁ][あぁ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう]+わ[ぉおあぁ]+[ー～〜…~]+[ッっ]?(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[…]+。(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)？[？]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やっ、や[あぁ]+っ、(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ゥウ]オ[オ]+ (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)寝取らせ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぉお]+[～]+[…]+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふぅ[～]+[…]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ィ]+[ぃい][ぃい][ぃい]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]?[ー～〜…~]*[っッ]*[ひ]?[ぃい][ぃい]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]?[ー～〜…~]*[っッ]*[ひ]?[ぃい][ぃい]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぇえ][ぇえ][ぇえ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あっん[っん]+ン[ン]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ン]+[ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)きった[ぁあ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)きゃ[ぁあ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぐっ[―]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう]+[ぐっ][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あん(あん)\1+いうえ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)え[え]+い(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ク]?[ゥウ][ゥウ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん[ん]+ッ[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぅう]+ん[ん]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ][ぁあ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ー～〜…~]*[っッ]+[ぅう][ぅう]+[…]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ッ[ー～〜…~]*[っッ]ゥ[ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう]+[ぉお][ぉお]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)よよ[よ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ウ]?[ォオ][ォオ][ォオ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)宝珠(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)飲んでくださ[ぃい][ぃい]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)こ?、?壊れちゃ[うぅ][うぅ]+んいっひ[ぃい][ぃい]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)を\d+つ収穫した。(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふんふん[ふん]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぉお][ぉお]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぉお][ぉお]+[ー～〜…~]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[えぇ][えぇ][えぇ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふむ[ふむ][ふむ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ー～〜…~]+ん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぉお][ふぉお]+[ふぉお]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぃい][ぃい]+[ィイ][ィイ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ィイ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+ァ[アァ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ォ[ォ]+[ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[アァ][アァ]+[ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)っ[ぅう][ぅう]+ッ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[うぅ][うぅ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[うぅ]+[ー～〜…~]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)へえ[うぅ]+[ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[うぅ]+[ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+イク[うぅ]+[ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ぅう]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふ[ぁあ]+[ー～〜…~]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(駄目)\1+[ぇえ]+[ー～〜…~]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)止めろ[ぉお][ぉお][ぉお]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(メリ)\1+[ィイ][ィイ]+[ー～〜…~]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ほ[ぉお][ぉお]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ]+[えぇ][えぇ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ッん[ん]+っふ[ふ]+ん[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)赤ちゃんっ[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[アァ][アァ][アァ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう]+[あぁ][あぁ][あぁ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)あく[ぅう][ぅう][ぅう]+[ー～〜…~]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[、]+[ん]+[ー～〜…~]*[っッ]*[ん]*[ン]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[、]+[ん]+[ー～〜…~]*[っッ]*[ん]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[、]+[ん]+[ー～〜…~]*[っッ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ー～〜…~]*[っッ]*[ん]*[ン]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ー～〜…~]*[っッ]*[ん]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+[ー～〜…~]*[っッ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(おい)\1+なんだよ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)私(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぅう]+[ー～〜…~]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[アァ]+[あぁ][あぁ][あぁ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう]+[いぃ][いぃ][いぃ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぅう]+ぐ[ぅう]+[ー～〜…~]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん[いぃ][いぃ][いぃ]+[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)主人公(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(ぼそ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(たっる)\1+た～る(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(わー)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)グギギ[ギ]+ィ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ムム[ム]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)やめて[えぇ][えぇ][えぇ]+[ー～〜…~]*[っッ]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(そう)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ゲロロ[ロ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(おい)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う[え][え]+ん[っッ](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひ[え][え]+[っッ](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふあ[あぁ]+～(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)っく[ぅう][ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ん]+っふ[ぅう][ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)っ[ぅう][ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(ぐりゅ)\1+って[ぇえ](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ン[アァ][アァ][アァ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ヒ[ャ]+[アァ][アァ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん[ん]+[ぁあ][ぁあ]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ふふふ[ふ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ブィ[ー～〜…~][ー～〜…~][ー～〜…~]+ン(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[ー～〜…~](?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぁあ][ぁあ]+[　 ](?=[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ])[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(えっ)\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(おっ)\1+[おぉ]+[ー～〜…~]*(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う(ひょ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[おぉ]+[おぉ]+[ー～〜…~](いいぞ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ひあ[ぁあ]+っ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)んあ[あぁ]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(ふん)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(ほら)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(これ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(オイ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(あっ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[カ]+[っッ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ア[イィ][イィ][イィ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)イ[エェ][エェ]+[イィ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)。。。+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)う[あぁ]+わ[あぁ]+っ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)[ぅう][ぅう]+[おぉ]+[おぉ]+んっ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)す[ぅう][ぅう][ぅう]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)うひ[ん][ん]+っ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(ぐっぽ)\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)はっひゃ[あぁ][あぁ][あぁ]+[ー～〜…~]+ん(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ん[あぁ][あぁ][あぁ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ガァー(ハッ)\1+ハ(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ぎゃ[ぁあ][ぁあ]+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)  (?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|$)[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
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
                '//Preserve Circle Numbers',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*♡+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                /[　 ]*\\+C\[\d+]♡+\\+C\[\d+][　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 ]*♥+[　 ❤♥♡…！？。、･♪]*/g.toString() + ',',
                //[　 …]*[。、][　 …･]*/g.toString() + ',',
                '// Colors',
                /\\+C\[[^\]\r\n]+?\][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?\\+C\[[^\]\r\n]+?\]/gi.toString() + ',',
                /^(?:\s*\\+C\[[^\]\r\n]+?\])|(?:\\+C\[[^\]\r\n]+?\]\s*)$/gi.toString() + ',',
                '// Dialogue box pause',
                /[\.]\\+(?=[^a-zA-Z\\]|$)/gi.toString() + ',',
                '// First we grab the arguments portion of a info: call, then we grab the info itself, leaving only the text',
                /^info:.+?\K(,\d+)+$/gi.toString() + ',',
                /^info:/gi.toString() + ',',
                '// Names',
                /\\+[\w]+\[\\+n\[\d+\]\]/gi.toString() + ',',
                /\\+F\[\d+\]\\+M\[[^\]\r\n]*?\]\\+N<\\+N\[\d+\]>/gi.toString() + ',',
                /\\+[N]<\\+N\[\d+\]>/gi.toString() + ',',
                /\\+name\[\\+V\[\d+?\]\]\\+F+?\[\\+V\[\d+?\]\]/gi.toString() + ',',
                /\\+name\[\\+F+?\[\\+V\[\d+?\]\]/gi.toString() + ',',
                /\\+name\[\\+V\[\d+\]\]/gi.toString() + ',',
                //\\n</gi.toString() + ',',
                /\\+[n][w]?\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]\r\n]+?\]+/gi.toString() + ',',
                /\\+[n][w]?\<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\r\n\>]+?\>/gi.toString() + ',',
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
                /^_EventSetting = "?/g.toString() + ',',
                /[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*/gi.toString() + ',',
                '//Gold',
                /\\+G(?![a-zA-Z])/g.toString() + ',',
                /\\+\$(?![a-zA-Z])/g.toString() + ',',
                '// Stuff that shouldnt even be there',
                /else if[\s\S]*?\{[\s\S]*?\}/g.toString() + ',',
                /if[\s\S]*?\{[\s\S]*?\}/g.toString() + ',',
                '// Non Jap stuff',
                /「[「]+/gi.toString() + ',',
                /」[」]+/gi.toString() + ',',
                /(?<![\w\\])\([^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\)]+?\)/gi.toString() + ',',
                /(?<![\w\\])\[[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\]]+?\]/gi.toString() + ',',
                /(?<![\w\\])<[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\\>]+?>/gi.toString() + ',',
                /(?<=[a-zA-z]|^)['][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\']+?[']/gi.toString() + ',',
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
                /[`][^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+?[`]/gi.toString() + ',',
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
                /\s*\\+\^\s*$/g.toString() + ',',
                /^\\+>\s*(\s*\\C\[\d+?\]\s*)*/gi.toString() + ',',
                /\\+[a-zA-Z_]+\[/gi.toString() + ',',
                //'// Potential Filenames', //too many false positives
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]+_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]*[ 　\s]*/g.toString() + ',',
                //[ 　\s]*[^ 　\s]*_(?!logWindow\.addText|name|class|actor|num|key|icon|desc|TEXT|ABL)[^ 　\s]+[ 　\s]*/g.toString() + ',',
                '// Linebreaks',
                /[　 ]*\\+[n](?![\[\<])[　 ]*/gim.toString() + ',',
                '// divider',
                /\|/gim.toString() + ',',
                '// special linestarter',
                /^\\+>/gim.toString() + ',',
                '// Conditional choice RPG Maker at the end',
                /\s*((if)|(en))\(.+?\)\s*$/gi.toString() + ',',
                '// Conditional choice RPG Maker at the start',
                /^\s*((if)|(en))\(.+?\)\s*/gi.toString() + ',',
                '// Whitespace with linebreak at start',
                /^\s*\n\s*/gi.toString() + ',',
                '// Whitespace with linebreak at end',
                /\s*\n\s*$/gi.toString() + ',',
                '// Brackets at start',
                /^\[\w+\//gmi.toString() + ',',
                /^\s*\\+["']+/g.toString() + ',',
                /^\s*[〔⟨〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟"'´`“\’]+/g.toString() + ',',
                '// Brackets at end',
                /\/\w+]$/gmi.toString() + ',',            
                /\\+["']+\s*;?$/g.toString() + ',',
                /[\]\)}〕〗〙〛〝〞”｣〉》」』】）］＞>｝｠〟⟩"'`´\’]+\s*;?$/g.toString() + ',',
                '// Symbols at start',
                /(^\s*[\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=]+)/gmi.toString() +
                    ',',
                '// Symbols at end',
                /(?<=[~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=])[!?,\.？！、。;]+/gmi.toString() +
                    ',',
                /([<>◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=]+[!?,\.？！、。\s]*$)/gmi.toString() +
                    ',',
                /([\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=]+\s*$)/gmi.toString() +
                    ','
            ].join('\n'),
            description: 'These are to be used to match against text at either the start or the end of sentences. It works kind of like splitting - the matched symbol will be removed from the sentence before translation and added back later.\n' +
                'This is best used to remove symbols which offer no benefit to the translation process (like brackets or quotes), or to protect script calls.' +
                exports.PatternExplanation,
            name: 'Cutting Corners Patterns',
            category: TranslationEngineOptionCategories.PATTERNS,
            priority: 5,
            formType: 'ace',
            formOptions: {
                aceMode: 'javascript',
                aceTheme: 'twilight',
                height: '500px'
            }
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
        const getCacheKey = (text) => {
            return options.sl + options.tl + text;
        };
        this.processorInit();
        let process = this.processor.process(...rows);
        let toTranslate = process.getTranslatableLines();
        let translations = new Array(toTranslate.length);
        if (this.optionUseCache.getValue()) {
            this.cache.loadCache();
            // Remove cached lines
            for (let i = toTranslate.length - 1; i >= 0; i--) {
                let cacheKey = getCacheKey(toTranslate[i]);
                if (this.cache.hasCache(cacheKey)) {
                    translations[i] = this.cache.getCache(cacheKey);
                    toTranslate.splice(i, 1);
                }
            }
            if (toTranslate.length !== translations.length) {
                this.log(`[SLRTranslator] Skipped ${translations.length - toTranslate.length} sentences due to cache hits.`);
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
        this.log(`[SLRTranslator] Sending ${toTranslate.length} lines (processed from ${rows.length} rows) to ${this.getEngine().name}.`);
        let translatorPerformance = new RedPerformance_1.RedPerformance();
        this.doTranslate(toTranslate, options)
            .then((translatedLines) => {
            // toTranslate matches translatedLines
            // translations matches initial translatableLines
            let outerIndex = 0;
            let innerIndex = 0;
            while (outerIndex < translatedLines.length) {
                while (translations[innerIndex] != undefined) {
                    innerIndex++;
                }
                if (this.optionUseCache.getValue()) {
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
            options.onAfterLoading(result);
        })
            .catch((reason) => {
            options.onError(reason);
        })
            .finally(() => {
            ui.hideBusyOverlay();
            let start = '[SLRTranslator] ';
            let pad = ' '.repeat(start.length);
            this.log(`${start}Batch took: ${batchPerformance.end().getSeconds()} seconds.`);
            this.log(`${pad}Performance: ${Math.round((10 * result.sourceText.length) / translatorPerformance.end().getSeconds()) / 10} characters per second. ${Math.round((10 * rows.length) / batchPerformance.getSeconds()) / 10} rows per second.`);
            if (this.optionCachePersistent.getValue()) {
                this.log('[SLRTranslatorEngine] Saving translation cache to file.');
                this.cache.saveCache();
            }
            options.always();
        });
    }
    getEngine() {
        return this.translatorEngine;
    }
    getId() {
        return this.translatorEngine.id;
    }
    init() {
        const OptionFormBuilder = OptionFormBuilder_1.OptionFormBuilder;
        const sections = [
            { key: 'Options', title: 'Options' },
            { key: 'Limits', title: 'Limits' },
            { key: 'Patterns', title: 'Patterns' },
            { key: 'Prompts', title: 'Prompts' },
            { key: 'Placeholders', title: 'Placeholders' }
        ];
        this.translatorEngine.optionsForm = OptionFormBuilder.build({
            storedOptions: this.storedOptions,
            engine: this.translatorEngine,
            sections,
            sectionOf: (option) => ({ parent: option.getCategory() }),
            collapsible: true
        });
        this.translatorEngine.init();
    }
    addOption(option) {
        this.storedOptions.push(option);
        this.storedOptionsHash[option.getId()] = option;
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
            noRepeat: true,
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
exports.TranslationEngineWrapper = TranslationEngineWrapper;
