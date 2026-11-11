"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedSugoiEngine = void 0;
const TranslationEngineOption_1 = require("./TranslationEngineOption");
const TranslationEngineWrapper_1 = require("./TranslationEngineWrapper");
try {
	window.transConfig = JSON.parse(localStorage.getItem('Config'));
} catch (e){
	console.log(e);
}
class RedSugoiEngine extends TranslationEngineWrapper_1.TranslationEngineWrapper {
    constructor(processor, thisAddon) {
        super(processor, thisAddon, {
            id: 'slr',
            name: 'SLR (SugoiV4 legacy)',
            languages: {
                en: 'English',
                ja: 'Japanese'
            },
            batchDelay: 1,
            description: thisAddon.package.description,
            mode: 'rowByRow'
        });
        this.aborted = false;
        this.paused = false;
        this.pauseQueue = [];
        this.urlUsage = [];
        this.optionUrls = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'urls',
            default: ['http://localhost:14366/'].join('\n'),
            description: "URLs for the Sugoi Translator servers. Place one per line. There will be an attempt to balance the load between servers such that every server has the same amount of active requests open, so it's also important to pick a good request count number to match your servers (usually two times the number of servers is good enough).\n",
            name: 'Sugoi Translator URLs',
            category: TranslationEngineWrapper_1.TranslationEngineOptionCategories.LIMITS,
            priority: -10,
            formType: 'textarea',
            formOptions: {
                height: '50px'
            },
            childForm: [
                {
                    type: 'actions',
                    title: 'Local Server Manager',
                    fieldHtmlClass: 'actionButtonSet',
                    items: [
                        {
                            type: 'button',
                            title: 'Open Sugoi Server Manager',
                            onClick: function () {
                                try {
                                    trans.sugoitrans.openServerManager();
                                }
                                catch (e) {
                                    alert("");
                                }
                            }
                        },
                        {
                            type: 'button',
                            title: 'Copy Sugoi Addon Server URLs',
                            onClick: (evt) => {
                                try {
                                    window.clicked = evt;
                                    var optionWindow = $(evt.target.parentNode.parentNode);
                                    let engine = this.getEngine();
                                    optionWindow.find(`[name="urls"]`).val(trans.sugoitrans.targetUrl);
                                    engine.update('urls', trans.sugoitrans.targetUrl);
                                }
                                catch (e) {
                                    alert("");
                                }
                            }
                        }
                    ]
                }
            ]
        });
        /* this.optionRemoveBreaks = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'removeBreaks',
            default: false,
            description: [
                'Sugoi Translator does not understand line breaks.',
                "This option replaces all line breaks with an space before translation. This hasn't been thoroughly tested, so there is no knowledge of whether this improves translation quality or not, but it should, in theory."
            ].join('\n'),
            name: 'Remove Line Breaks',
            category: TranslationEngineWrapper_1.TranslationEngineOptionCategories.OPTIONS
        }); */
        /**
         * Limits
         */
        this.optionMaxLength = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxTranslationLength',
            default: 5000,
            description: [
                'Maximum amount of characters that will be sent per server request.',
                "Sugoi translator can crash if you send text that is bigger than your RAM/VRAM can handle, so you can set an upper limit here. In general, the higher this number is, the faster the translation process will be - so long as you don't run out of memory. The default value is very conservative, feel free to increase it until your hardware cries.",
                "Note: if an atomic string (that can't be split) is larger than this amount, it will still be sent in full, but it will be sent alone."
            ].join('\n'),
            name: 'Request Character Limit',
            category: TranslationEngineWrapper_1.TranslationEngineOptionCategories.LIMITS,
            priority: -9
        });
        this.optionConcurrency = new TranslationEngineOption_1.TranslationEngineOption({
            wrapper: this,
            id: 'maxTranslationJobs',
            default: 1,
            description: 'Maximum amount of requests sent to the servers at the same time. The best number is the one that results in no downtime for the servers.',
            name: 'Maximum Request Count',
            category: TranslationEngineWrapper_1.TranslationEngineOptionCategories.LIMITS,
            priority: -8
        });
    }
    getUrl() {
        let urls = this.optionUrls.getValue().split(/\r?\n/g);
        if (this.urlUsage.length != urls.length) {
            this.urlUsage = new Array(urls.length).fill(0);
        }
        let leastUsed = this.urlUsage.indexOf(Math.min(...this.urlUsage));
        this.urlUsage[leastUsed]++;
        return {
            url: urls[leastUsed],
            index: leastUsed
        };
    }
    freeUrl(urlIndex) {
        this.urlUsage[urlIndex]--;
    }
    doTranslate(toTranslate, options) {
        this.resetStatus();
        let returnTranslations;
        let returnError;
        if (options.sl != 'ja') {
            this.error(`[SLR] The project specifies the source language as not being Japanese (${options.sl}). Since Sugoi Translator only supports Japanese as source, we will use Japanese instead.`);
        }
        if (options.tl != 'en') {
            this.error(`[SLR] The project specifies the destination language as not being English (${options.tl}). Since Sugoi Translator only supports English as destination, we will use English instead.`);
        }
        let translations = new Array(toTranslate.length);
        let translatingIndex = 0;
        let completeThreads = 0;
        let totalThreads = this.optionConcurrency.getValue();
        totalThreads = totalThreads < 1 ? 1 : totalThreads;
        let maximumBatchSize = this.optionMaxLength.getValue();
        let complete = () => {
            if (++completeThreads == totalThreads) {
                returnTranslations(translations);
            }
        };
        let translationProgress = document.createTextNode('0');
        let translatedCount = 0;
        let errorProgress = document.createTextNode('');
        let errorCount = 0;
        this.print(document.createTextNode('[SLR] Translating texts: '), translationProgress, document.createTextNode('/' + toTranslate.length), errorProgress);
        const updateTranslatedCount = (count) => {
            translatedCount += count;
            translationProgress.nodeValue = translatedCount.toString();
            options.progress(Math.round((100 * translatedCount) / toTranslate.length));
        };
        const updateErrorCount = (count) => {
            errorCount += count;
            errorProgress.nodeValue = ' (' + errorCount.toString() + ' failed translations)';
        };
        let serverScores = {};
        let startThread = () => {
            if (this.aborted) {
                returnError('Aborted.');
                return;
            }
            if (this.paused) {
                this.pauseQueue.push(() => {
                    startThread();
                });
                return;
            }
            let batchLength = 0;
            let batch = [];
            let batchIndexes = [];
            let toTranslateTrimmed = "";
            let toTranslateTrimmedCount = 0;
            while (translatingIndex < toTranslate.length) {
                let index = translatingIndex;
                if (toTranslate[index] !== undefined) {
                    toTranslateTrimmed = toTranslate[index];
                    if ( window.transConfig.japanesesource == true) {
                        toTranslateTrimmed = toTranslateTrimmed.replaceAll(/@@\d+@/g, "＃＃＃＃");
                        toTranslateTrimmed = toTranslateTrimmed.replaceAll(/[^\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}０１２３４５６７８９？！、。＃＄％＆［］＾＿｛｝｜（）＊＋－／＠＜＞：；…ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚー―◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ]/gu, "");
                    }
                    toTranslateTrimmedCount = toTranslateTrimmed.length;
                } else {
                    break;
                }
                    
                if (toTranslate[index] !== undefined &&
                    (batchLength == 0 ||
                        batchLength + toTranslate[index].length <= maximumBatchSize)) {
                    /* if (this.optionRemoveBreaks.getValue()) {
                        toTranslate[index] = toTranslate[index].replaceAll(/\r?\n/g, ' ');
                    } */
                    batch.push(toTranslate[index]);
                    batchIndexes.push(index);
                    batchLength += toTranslate[index].length;
                    translatingIndex++;
                }
                else {
                    break;
                }
            }
            if (batch.length == 0) {
                complete();
            }
            else {
                let myServer = this.getUrl();
                if (serverScores[myServer.url] == undefined) {
                    serverScores[myServer.url] = 0;
                }
                fetch(myServer.url, {
                    method: 'post',
                    body: JSON.stringify({ content: batch, message: 'translate sentences' }),
                    headers: { 'Content-Type': 'application/json' }
                })
                    .then(async (response) => {
                    if (response.ok) {
                        serverScores[myServer.url] += batch.length;
                        let result = await response.json();
                        console.log('[SLR] Fetched from ' + myServer.url, result);
                        if (result.length != batch.length) {
                            console.error('[SLR] MISMATCH ON RESPONSE:', batch, result);
                            throw new Error(`Received invalid response - length mismatch, check server stability.`);
                        }
                        else {
                            for (let i = 0; i < batch.length; i++) {
                                translations[batchIndexes[i]] = result[i];
                            }
                        }
                        updateTranslatedCount(batch.length);
                    }
                    else {
                        throw new Error(`${response.status.toString()} - ${response.statusText}`);
                    }
                })
                    .catch((error) => {
                    updateErrorCount(batch.length);
                    console.error('[SLR] ERROR ON FETCH USING ' + myServer, '   Payload: ' + batch.join('\n'), error);
                    this.error(`[SLR] Error while fetching from ${myServer.url} - ${error.name}: ${error.message}\n${' '.repeat(11)}If all fetch attempts fail on this server, check if it's still up.`);
                    // A failed sub-request must not leave undefined holes in the result:
                    // the text processor throws "Received too few translations" on holes,
                    // which makes the whole batch fall into onError - silently skipping
                    // insertIntoTables AND the PostBatch fixes/error checks for every row
                    // of the batch (including the successfully translated ones). Mirror
                    // DSLR: accept the original line with a TRANSLATIONFAIL marker so the
                    // batch still completes, postbatch runs, the persistent cache stays
                    // clean (addCache rejects TRANSLATIONFAIL entries) and the row is
                    // visibly flagged for a re-translation.
                    for (let i = 0; i < batch.length; i++) {
                        if (translations[batchIndexes[i]] == undefined) {
                            translations[batchIndexes[i]] = batch[i] + '　SHISAYE.TRANSLATIONFAIL　';
                        }
                    }
                })
                    .finally(() => {
                    this.freeUrl(myServer.index);
                    startThread();
                });
            }
        };
        return new Promise((resolve, reject) => {
            returnTranslations = resolve;
            returnError = reject;
            for (let i = 0; i < totalThreads; i++) {
                startThread();
            }
        });
    }
    resetStatus() {
        this.aborted = false;
        this.paused = false;
        this.pauseQueue = [];
    }
    abort() {
        this.aborted = true;
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
exports.RedSugoiEngine = RedSugoiEngine;
