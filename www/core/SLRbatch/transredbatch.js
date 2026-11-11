"use strict";
try {
	window.transConfig = JSON.parse(localStorage.getItem('Config'));
} catch (e){
	console.log(e);
}
var slrFixDest = 1;
var slrFixErrCol = 4;
// Append one or more SHISAYE.* error codes to a row's Errors column (col slrFixErrCol),
// deduplicated so re-runs / multiple checks accumulate instead of overwriting each other.
// `markedText` is whatever an error check produced (inline-marked text or a bare code);
// any SHISAYE.<NAME> tokens found in it are appended to the Errors cell.
function slrAddErr(file, k, markedText) {
	if (markedText == null) return;
	let row = trans.project.files[file] && trans.project.files[file].data[k];
	if (!row) return;
	let codes = String(markedText).match(/SHISAYE\.[A-Za-z0-9._\$]+/g);
	if (!codes || codes.length == 0) return;   // nothing to report
	let cur = row[slrFixErrCol];
	if (cur == null || cur === "") {
		// First error on this cell: store the inline-marked text verbatim so the user
		// can see exactly where the problem is (e.g. "...under　SHISAYE.X　Key Items...").
		row[slrFixErrCol] = String(markedText);
		return;
	}
	// Additional errors: append the code marker(s), deduplicated, so multiple problems
	// on one cell are not lost (the first error keeps its inline context).
	cur = String(cur);
	for (let i = 0; i < codes.length; i++) {
		let marker = "　" + codes[i] + "　";
		if (cur.indexOf(marker) === -1) cur += marker;
	}
	row[slrFixErrCol] = cur;
}
class RedBatchTranslatorWindow {
    constructor(parent) {
        this.$monster = $(`
    <div class='ui-widget-overlay ui-front' style='opacity: 1; background-color: rgba(170, 170, 170, 0.3); display: flex; justify-content: center; align-items: center;'><div style='background-color: white; width: 600px; font-size: 1.2ex; position: relative;'><div style='background-color: var(--dialog-title-bg, black); color: var(--dialog-title-fg, white); line-height: 30px; padding-left: 10px;'><h1 style='margin:0px'>Start Translation</h1></div><div style='padding: 10px;'><h2 style='margin: 0px;'>Select Translator<select id='redBatchTranslatorSelect' style='margin-left: 2ex'></select></h2><div class='batchTranslatorHint'>Cheapest path: fill in the Quick Start box (API URL, key, model) in the engine options, then press Start Translation. A Glossary and the QC/Judge review improve quality on capable models but use many more tokens. <a href='#' id='redBatchTranslatorConfigure'>Configure translation engine</a></div><hr><div class='flex col-2'><div class='fieldmember sourceCol'><h2 style='margin:0px'>Source column</h2><label class='columnSelector'><select id='redBatchTranslatorSourceSelect'></select></label><div class='smallInfo'>Which column is the source text to translate for?<br>(default is key column / leftmost column).</div></div><div class='fieldmember'><h2 style='margin:0px'>Target column</h2><label class='targetCol'><select id='redBatchTranslatorDestinationSelect'></select></label><div class='smallInfo'>Which column is the translated text put into.<br>(Can not same with source column)</div></div></div><hr><h2 style='margin: 0px; margin-bottom: 1ex;'>Options</h2><label class='flex fullWidth bottomSpace'><div class='flexMain'><h3 class='label' style='margin: 0px;'>Save on each Batch</h3><div class='info'>If checked, the project is saved after every batch translation.</div></div><div><input class='flipSwitch translateOther' id='redBatchTranslatorSave' type='checkbox' value='1'></div></label><label class='flex fullWidth bottomSpace'><div class='flexMain'><h3 class='label' style='margin: 0px;'>Ignore translated</h3><div class='info'>If checked, rows with translations will not be translated.</div></div><div><input class='flipSwitch translateOther' id='redBatchTranslatorIgnore' type='checkbox' value='1'></div></label><label class='flex fullWidth bottomSpace'><div class='flexMain'><h3 class='label' style='margin: 0px;'>Strict Whitelist</h3><div class='info'>If checked, rows with no tags can fail the whitelist.</div></div><div><input class='flipSwitch translateOther' id='redBatchTranslatorStrict' type='checkbox' value='1'></div></label><hr><div class='options fieldgroup' id='redBatchTranslatorBlacklist'><div class='fieldmember'><h2 style='margin: 0px;'>Blacklist</h2><div class='info'>Rows that have any of the selected tags will not be translated</div><div class='colorTagSelector'><div class='uiTags uiTagsWrapper rendered' data-mark='unknown'><input checked='true' class='colorTagSelector tagSelector red' name='tagSelector' style='background-color: rgb(255, 0, 0);' title='red' type='checkbox' value='red'><input checked='true' class='colorTagSelector tagSelector yellow' name='tagSelector' style='background-color: rgb(255, 255, 0);' title='yellow' type='checkbox' value='yellow'><input class='colorTagSelector tagSelector green' name='tagSelector' style='background-color: rgb(0, 128, 0);' title='green' type='checkbox' value='green'><input checked='true' class='colorTagSelector tagSelector blue' name='tagSelector' style='background-color: rgb(0, 0, 255);' title='blue' type='checkbox' value='blue'><input checked='true' class='colorTagSelector tagSelector gold' name='tagSelector' style='background-color: rgb(212, 175, 55);' title='gold' type='checkbox' value='gold'><input class='colorTagSelector tagSelector purple' name='tagSelector' style='background-color: rgb(128, 0, 128);' title='purple' type='checkbox' value='purple'><input class='colorTagSelector tagSelector mediumpurple' name='tagSelector' style='background-color: rgb(147, 112, 219);' title='mediumpurple' type='checkbox' value='mediumpurple'><input class='colorTagSelector tagSelector black' name='tagSelector' style='background-color: rgb(0, 0, 0);' title='black' type='checkbox' value='black'><input checked='true' class='colorTagSelector tagSelector gray' name='tagSelector' style='background-color: rgb(128, 128, 128);' title='gray' type='checkbox' value='gray'><input class='colorTagSelector tagSelector white' name='tagSelector' style='background-color: rgb(255, 255, 255);' title='white' type='checkbox' value='white'><input class='colorTagSelector tagSelector silver' name='tagSelector' style='background-color: rgb(192, 192, 192);' title='silver' type='checkbox' value='silver'><input class='colorTagSelector tagSelector pink' name='tagSelector' style='background-color: rgb(255, 192, 203);' title='pink' type='checkbox' value='pink'><input class='colorTagSelector tagSelector indigo' name='tagSelector' style='background-color: rgb(75, 0, 130);' title='indigo' type='checkbox' value='indigo'><input checked='true' class='colorTagSelector tagSelector aqua' name='tagSelector' style='background-color: rgb(0, 255, 255);' title='aqua' type='checkbox' value='aqua'><input class='colorTagSelector tagSelector tan' name='tagSelector' style='background-color: rgb(210, 180, 140);' title='tan' type='checkbox' value='tan'><input checked='true' class='colorTagSelector tagSelector darkred' name='tagSelector' style='background-color: rgb(139, 0, 0);' title='darkred' type='checkbox' value='darkred'></div></div></div></div><hr><div class='options fieldgroup' id='redBatchTranslatorWhitelist'><div class='fieldmember'><h2 style='margin: 0px;'>Whitelist</h2><div class='info'>If any of the following colors is selected, only rows with that color will be translated. This overrides the Blacklist.</div><div class='colorTagSelector'><div class='uiTags uiTagsWrapper rendered' data-mark='unknown'><input class='colorTagSelector tagSelector red' name='tagSelector' style='background-color: rgb(255, 0, 0);' title='red' type='checkbox' value='red'><input class='colorTagSelector tagSelector yellow' name='tagSelector' style='background-color: rgb(255, 255, 0);' title='yellow' type='checkbox' value='yellow'><input class='colorTagSelector tagSelector green' name='tagSelector' style='background-color: rgb(0, 128, 0);' title='green' type='checkbox' value='green'><input class='colorTagSelector tagSelector blue' name='tagSelector' style='background-color: rgb(0, 0, 255);' title='blue' type='checkbox' value='blue'><input class='colorTagSelector tagSelector gold' name='tagSelector' style='background-color: rgb(212, 175, 55);' title='gold' type='checkbox' value='gold'><input class='colorTagSelector tagSelector purple' name='tagSelector' style='background-color: rgb(128, 0, 128);' title='purple' type='checkbox' value='purple'><input class='colorTagSelector tagSelector mediumpurple' name='tagSelector' style='background-color: rgb(147, 112, 219);' title='mediumpurple' type='checkbox' value='mediumpurple'><input class='colorTagSelector tagSelector black' name='tagSelector' style='background-color: rgb(0, 0, 0);' title='black' type='checkbox' value='black'><input class='colorTagSelector tagSelector gray' name='tagSelector' style='background-color: rgb(128, 128, 128);' title='gray' type='checkbox' value='gray'><input class='colorTagSelector tagSelector white' name='tagSelector' style='background-color: rgb(255, 255, 255);' title='white' type='checkbox' value='white'><input class='colorTagSelector tagSelector silver' name='tagSelector' style='background-color: rgb(192, 192, 192);' title='silver' type='checkbox' value='silver'><input class='colorTagSelector tagSelector pink' name='tagSelector' style='background-color: rgb(255, 192, 203);' title='pink' type='checkbox' value='pink'><input class='colorTagSelector tagSelector indigo' name='tagSelector' style='background-color: rgb(75, 0, 130);' title='indigo' type='checkbox' value='indigo'><input class='colorTagSelector tagSelector aqua' name='tagSelector' style='background-color: rgb(0, 255, 255);' title='aqua' type='checkbox' value='aqua'><input class='colorTagSelector tagSelector tan' name='tagSelector' style='background-color: rgb(210, 180, 140);' title='tan' type='checkbox' value='tan'><input class='colorTagSelector tagSelector darkred' name='tagSelector' style='background-color: rgb(139, 0, 0);' title='darkred' type='checkbox' value='darkred'></div></div></div></div></div><div class='ui-dialog-buttonset' style='text-align: right; position: absolute; bottom: 4px; right: 4px;'><button class='ui-button ui-widget ui-state-default ui-corner-all ui-button-text-only' icon='ui-icon-close' id='redBatchTranslatorClose' role='button' type='button'><span class='ui-button-text'>Cancel</span></button><button class='ui-button ui-widget ui-state-default ui-corner-all ui-button-text-only' icon='ui-icon-plus' id='redBatchTranslatorTranslate' role='button' type='button'><span class='ui-button-text'>Translate Now</span></button></div></div></div>
    `);
        this.openedBefore = false;
        this.parent = parent;
        this.monster = this.$monster[0];
        // Search the monster for our elements
        this.selectTrans = this.$monster.find("#redBatchTranslatorSelect")[0];
        this.selectSource = this.$monster.find("#redBatchTranslatorSourceSelect")[0];
        this.selectDestination = this.$monster.find("#redBatchTranslatorDestinationSelect")[0];
        this.checkSave = this.$monster.find("#redBatchTranslatorSave")[0];
        this.checkIgnore = this.$monster.find("#redBatchTranslatorIgnore")[0];
        this.checkStrict = this.$monster.find("#redBatchTranslatorStrict")[0];
        this.blacklistContainer = this.$monster.find("#redBatchTranslatorBlacklist")[0];
        this.whitelistContainer = this.$monster.find("#redBatchTranslatorWhitelist")[0];
        // Buttons
        this.$monster.find("#redBatchTranslatorConfigure")[0].addEventListener("click", (ev) => {
            ev.preventDefault();
            if (typeof ui !== "undefined" && typeof ui.openOptionsWindow === "function") {
                ui.openOptionsWindow({ tab: "dslr" });
            }
        });
        this.$monster.find("#redBatchTranslatorClose")[0].addEventListener("click", () => {
            this.close();
        });
        this.$monster.find("#redBatchTranslatorTranslate")[0].addEventListener("click", () => {
            this.close();
            this.translate();
        });
    }
    open() {
        this.updateColumns();
        this.updateTranslatorsSelect();
        // Show
        document.body.appendChild(this.monster);
    }
    translate() {
        let files = trans.getCheckedFiles();
        if (files.length == 0) {
            files = trans.getAllFiles();
        }
        let options = {
            translator: this.selectTrans.value,
            source: parseInt(this.selectSource.value),
            destination: parseInt(this.selectDestination.value),
            ignoreTranslated: this.checkIgnore.checked,
            strict: this.checkStrict.checked,
            saveOnEachBatch: this.checkSave.checked,
            blacklist: this.getTags(this.blacklistContainer),
            whitelist: this.getTags(this.whitelistContainer),
            files: files
        };
        this.parent.translateProject(options);
    }
    getTags(container) {
        let tags = [];
        let elements = container.getElementsByClassName("tagSelector");
        for (let i = 0; i < elements.length; i++) {
            let element = elements[i];
            if (element.checked) {
                tags.push(element.title);
            }
        }
        return tags;
    }
    close() {
        document.body.removeChild(this.monster);
    }
    updateColumns() {
        let oldSource = this.selectSource.value != "" ? this.selectSource.value : "0";
        let oldDestination = this.selectDestination.value != "" ? this.selectDestination.value : "1";
        // Remove old
        while (this.selectSource.firstChild) {
            this.selectSource.removeChild(this.selectSource.firstChild);
        }
        while (this.selectDestination.firstChild) {
            this.selectDestination.removeChild(this.selectDestination.firstChild);
        }
        // Array of names = trans.colHeaders
        for (let i = 0; i < trans.colHeaders.length; i++) {
            this.selectSource.appendChild($(`<option value="${i}">${trans.colHeaders[i]}</option>`)[0]);
            if (i > 0) {
                this.selectDestination.appendChild($(`<option value="${i}">${trans.colHeaders[i]}</option>`)[0]);
            }
        }
        this.selectSource.value = oldSource;
        this.selectDestination.value = oldDestination;
        document.addEventListener("keydown", (ev) => {
            if (this.monster.parentNode == document.body && ev.key == "Escape") {
                ev.preventDefault();
                this.parent.close();
            }
        });
    }
    getDefaultTranslator() {
        return (trans.project && trans.project.options && trans.project.options.translator) || sys.config.translator || "dslr";
    }
    updateTranslatorsSelect() {
        let oldTrans = this.selectTrans.value == "" || !this.openedBefore ? this.getDefaultTranslator() : this.selectTrans.value;
        if (oldTrans == "") {
            oldTrans = "slr";
        }
        this.openedBefore = true;
        // Remove old
        while (this.selectTrans.firstChild) {
            this.selectTrans.removeChild(this.selectTrans.firstChild);
        }
        let transOptions = [];
        for (let i = 0; i < trans.translator.length; i++) {
            let id = trans.translator[i];
            let engine = trans.getTranslatorEngine ? trans.getTranslatorEngine(id) : trans[id];
            if (!engine) {
                console.warn("Can not process translator for:", id);
                continue;
            }
            let name = engine.name;
            let option = document.createElement("option");
            option.value = id;
            option.appendChild(document.createTextNode(name));
            transOptions.push(option);
        }
        transOptions.sort((a, b) => {
            let na = a.innerText.toUpperCase();
            let nb = b.innerText.toUpperCase();
            if (na > nb)
                return 1;
            else if (na < nb)
                return -1;
            return 0;
        });
        transOptions.forEach((option) => {
            this.selectTrans.appendChild(option);
        });
        this.selectTrans.value = oldTrans;
    }
}
class RedBatchTranslatorRow {
    constructor(file, index) {
        this.location = [file, index];
    }
    getValue(source) {
        return trans.project.files[this.location[0]].data[this.location[1]][source];
    }
    isEmpty(source) {
        let value = this.getValue(source);
        return value == undefined || value == null || value == "";
    }
    isTranslated() {
        let cells = trans.project.files[this.location[0]].data[this.location[1]];
        let dataLength = cells.length;
        for (let i = 1; i < dataLength; i++) {
            if (cells[i] != null && cells[i] != undefined && cells[i].trim() != "") {
                return true;
            }
        }
        return false;
    }
    setValue(text, destination) {
        trans.project.files[this.location[0]].data[this.location[1]][destination] = text;
    }
    getTags() {
        // trans.project.files["data/Armors.json"].tags[i]
        let tags = trans.project.files[this.location[0]].tags[this.location[1]];
        if (tags == undefined) {
            return [];
        }
        return tags;
    }
}
/// <reference path="RedBatchTranslator/RedBatchTranslatorWindow.ts" />
/// <reference path="RedBatchTranslator/RedBatchTranslatorRow.ts" />
class RedBatchTranslator {
    constructor() {
        this.saving = false;
        this.saveAgain = false;
        this.window = new RedBatchTranslatorWindow(this);
    }
    open() {
        this.window.open();
    }
    close() {
        this.window.close();
    }
    refresh() {
        trans.refreshGrid();
        trans.evalTranslationProgress();
    }
    translateProject(options) {
        let aborted = false;
        // Pause/Resume state. Pausing gates the dispatcher (no new batches start) and asks
        // the engine to hold in-flight batches at their next chunk boundary (between LLM
        // requests). The currently streaming request cannot be interrupted without a real
        // abort, so it finishes; everything after it waits for Resume.
        let batchPaused = false;
        // Assigned once the batch loop is defined so the Resume button can re-kick the
        // dispatcher (the loop's consts live inside the init setTimeout below).
        let startNextBatchesFn = null;
        // Engine-level pause (DSLR and RedSugoi implement pause()/resume() on the registered
        // engine object). Defensive: engines without pause support still pause through the
        // dispatcher gate alone.
        const enginePause = (on) => {
            try {
                if (on && typeof translatorEngine.pause === 'function') translatorEngine.pause();
                if (!on && typeof translatorEngine.resume === 'function') translatorEngine.resume();
            } catch (e) { /* engine without usable pause support; dispatcher gating still applies */ }
        };
        ui.showLoading({
            buttons: [{
                text: "Abort",
                onClick: () => {
                    if (confirm("Are you sure you want to abort?")) {
                        aborted = true; // :/
                        trans.abortTranslation();
                        // If we were paused, release the engine's pause queue so no
                        // continuation stays wedged: queued threads see the abort flag
                        // and reject immediately.
                        if (batchPaused) enginePause(false);
                        // trans.abortTranslation() no longer closes the loading window, so
                        // show what the run achieved so far and keep the window open: the
                        // Close button (not the abort) is what actually closes it now.
                        // Drop the now-dead Abort/Pause buttons so only Close remains.
                        // Run the post-run checks too: an aborted run still leaves
                        // translated rows (and their purple/mediumpurple tags) behind,
                        // and without this the error/tag alerts would never fire.
                        printRunSummary();
                        runPostRunChecks();
                        ui.loadingClearButton();
                        ui.showCloseButton();
                        this.refresh();
                    }
                }
            }, {
                text: "Pause",
                onClick: (button) => {
                    batchPaused = !batchPaused;
                    if (batchPaused) {
                        enginePause(true);
                        if (button) $(button).text("Resume");
                        ui.log(`[SLRBatchTranslator] Paused. In-flight batches finish their current request, but no new work starts until Resume.`);
                    } else {
                        enginePause(false);
                        if (button) $(button).text("Pause");
                        ui.log(`[SLRBatchTranslator] Resumed.`);
                        if (startNextBatchesFn) startNextBatchesFn();
                    }
                }
            }, ]
        });
        ui.loadingProgress(0, "Starting up...");
        ui.log(`[SLRBatchTranslator] Beginning translation at ${new Date()}`);
        let consoleWindow = $("#loadingOverlay .console")[0];
        let pre = document.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.appendChild(document.createTextNode(JSON.stringify({
            ...options,
            files: options.files.join("; ")
        }, undefined, 4)));
        consoleWindow.appendChild(pre);
        let translatorEngine = trans.getTranslatorEngine ? trans.getTranslatorEngine(options.translator) : trans[options.translator];
        // Whether the DSLR engine runs the semantic review this run (it reports
        // per-line outcomes on the options side-channel; the batch layer applies
        // them as the `mediumpurple` QC tag). The legacy `purple` heuristics run
        // independently of this — the two tag systems flag different things.
        this._reviewOn = !!(translatorEngine && translatorEngine.optionReviewTranslations
            && typeof translatorEngine.optionReviewTranslations.getValue === "function"
            && translatorEngine.optionReviewTranslations.getValue() === true);
        // DSLR exposes a per-run quality/reliability summary (splits, fallbacks, single-line
        // retries, correction retries, rate-limit/server issues, TRANSLATIONFAIL count) so the
        // whole run can be judged at a glance and compared across models/quantizations.
        // Printed at most once per run: right away when the user aborts (after an abort the
        // dispatcher never loops again — in-flight batches reject without a callback — so
        // waiting for the batch loop would never print), or at finalize on a completed run.
        let runSummaryPrinted = false;
        const printRunSummary = () => {
            if (runSummaryPrinted) return;
            runSummaryPrinted = true;
            if (typeof translatorEngine.getRunSummary !== 'function') return;
            var _qLines = translatorEngine.getRunSummary();
            if (_qLines && _qLines.length) {
                for (var _qli = 0; _qli < _qLines.length; _qli++) ui.log(_qLines[_qli]);
            }
        };
        // Same once-guard: post-run error/tag alerts (SHISAYE codes, purple and
        // mediumpurple rows) must fire at most once per run, whether the run
        // completed or was aborted — an aborted run still leaves flagged rows
        // behind that the user otherwise never hears about.
        let postRunChecksDone = false;
        // Fresh tag tracking for this run, so the post-run purple/mediumpurple
        // alert only fires for tags added below — never for tags left over
        // from earlier runs. An aborted run keeps its tracking, so rows it
        // managed to tag still alert.
        slrBeginTagRun();
        const runPostRunChecks = () => {
            if (postRunChecksDone) return;
            postRunChecksDone = true;
            if (trans.batchCheckCells && typeof trans.batchCheckCells.checkCells === "function") {
                trans.batchCheckCells.checkCells();
            }
        };
        let rows = [];
        ui.loadingProgress(0, "");
        ui.log("[SLRBatchTranslator] If the Process seems stuck at this point, it is likely just loading large amounts of existing translations from cache, or it cannot actually see anything to translate.");
        setTimeout(() => {
        // Iterate through rows and add them up
        for (let i = 0; i < options.files.length; i++) {
            console.log(`[SLRBatchTranslator] Working on ${options.files[i]}...`);
            let file = options.files[i];
            if (trans.project.files[file] && trans.project.files[file].mainInjection) continue;
            let data = trans.project.files[file].data;
            for (let k = 0; k < data.length; k++) {
                let row = new RedBatchTranslatorRow(file, k);
                // Repeating work?
                if (options.ignoreTranslated && row.isTranslated()) {
                    continue;
                }
                // Empty row?
                if (row.isEmpty(options.source)) {
                    continue;
                }
                if (options.blacklist.length == 0 && options.whitelist.length == 0) {
                    // Everyone is allowed
                    rows.push(row);
                } else if (options.whitelist.length > 0) {
                    // Only if your name is on the list
                    let tags = row.getTags();
                    if (tags.length == 0) {
                        if (!options.strict) {
                            // No tags, no strict, means we allow it through
                            rows.push(row);
                        }
                    } else {
                        for (let t = 0; t < tags.length; t++) {
                            if (options.whitelist.indexOf(tags[t]) != -1) {
                                rows.push(row);
                                break;
                            }
                        }
                    }
                } else {
                    // DISCRIMINATION ON
                    let tags = row.getTags();
                    let clear = true;
                    for (let t = 0; t < tags.length; t++) {
                        if (options.blacklist.indexOf(tags[t]) != -1) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        rows.push(row);
                    }
                }
            }
        }
        // rows = Array of rows that need translating
        var rowSceneIds = {};
        if (typeof SceneGraph !== 'undefined') {
            if (!SceneGraph.isAvailable()) {
                try { SceneGraph.build(); } catch(e) { console.warn("[SceneGraph] build failed:", e); }
            }
            if (SceneGraph.isAvailable()) {
                var orderedRows = SceneGraph.getOrderedRows(options.files);
                if (orderedRows && orderedRows.length > 0) {
                    var orderMap = {};
                    for (var oi = 0; oi < orderedRows.length; oi++) {
                        var oKey = orderedRows[oi].file + "|" + orderedRows[oi].rowIndex;
                        orderMap[oKey] = oi;
                        rowSceneIds[oKey] = orderedRows[oi].sceneId;
                    }
                    rows.sort(function(a, b) {
                        var keyA = a.location[0] + "|" + a.location[1];
                        var keyB = b.location[0] + "|" + b.location[1];
                        var orderA = orderMap[keyA] !== undefined ? orderMap[keyA] : 999999999;
                        var orderB = orderMap[keyB] !== undefined ? orderMap[keyB] : 999999999;
                        return orderA - orderB;
                    });
                    var sg = SceneGraph.getStats();
                    ui.loadingProgress(undefined, "Scene-aware ordering: " + (sg.totalScenes||0) + " scenes, " + (sg.totalMapped||0) + " rows mapped");
                }
            }
        }
        let batches = [];
        let batchesRows = [];
        let batchesSceneIds = [];
        let batchesSceneBreaks = [];
        let currentSceneIds = [];
        let currentSceneBreaks = [];
        let prevSceneId = undefined;
        // Scene-grouping options now live in the DSLR engine options (they only meaningfully
        // affect DSLR). OptionFormBuilder emits them onto the engine as direct properties, so
        // read them from there. For non-DSL engines they are undefined -> fallbacks preserve
        // the original behavior.
        let sceneShortMaxRows = parseInt(translatorEngine.sceneShortMaxRows);
        if (isNaN(sceneShortMaxRows)) sceneShortMaxRows = 15;
        let targetRequestSize = parseInt(translatorEngine.targetRequestSize);
        if (isNaN(targetRequestSize)) targetRequestSize = 0;
        let maxScenesPerGroup = parseInt(translatorEngine.maxScenesPerGroup);
        if (isNaN(maxScenesPerGroup)) maxScenesPerGroup = 0;
        let maxNonSceneRows = parseInt(translatorEngine.maxNonSceneRows);
        if (isNaN(maxNonSceneRows)) maxNonSceneRows = 0;
        let maxSingleLineScenesRows = parseInt(translatorEngine.maxSingleLineScenesRows);
        if (isNaN(maxSingleLineScenesRows)) maxSingleLineScenesRows = 0;
        let maxLength = 0;
        if (translatorEngine.id == 'dslr') {
            maxLength = translatorEngine.maxRequestLengthDSLR;
        } else {
            maxLength = translatorEngine.maxRequestLength;
        }
        let currentBatch = [];
        let currentBatchRows = [];
        let currentSize = 0;
        let addToBatches = () => {
            batches.push(currentBatch);
            batchesRows.push(currentBatchRows);
            batchesSceneIds.push(currentSceneIds);
            batchesSceneBreaks.push(currentSceneBreaks);
            currentBatchRows = [];
            currentBatch = [];
            currentSceneIds = [];
            currentSceneBreaks = [];
            currentSize = 0;
        };
        // Two scenes are "related" when they are likely to share narrative context, so merging
        // them into one batch is safe. Used only ABOVE the row floor (see grouping ruleset), so it
        // can never cause tiny requests on its own. When the SceneGraph is unavailable or has no
        // data for a scene, returns true so it never blocks a merge.
        let _scenesAreRelated = (sceneIdA, sceneIdB) => {
            if (!sceneIdA || !sceneIdB || sceneIdA === sceneIdB) return true;
            if (typeof SceneGraph === 'undefined' || !SceneGraph.isAvailable()) return true;
            var a = SceneGraph.getScene(sceneIdA);
            var b = SceneGraph.getScene(sceneIdB);
            if (!a || !b) return true;
            // Same event, different page (e.g. map event page 0 vs 1)
            if (a.file === b.file && a.eventIndex === b.eventIndex) return true;
            // Common Event call link in either direction
            var aLinks = SceneGraph.getLinkedSceneIds(sceneIdA) || [];
            for (var i = 0; i < aLinks.length; i++) { if (aLinks[i].sceneId === sceneIdB) return true; }
            var bLinks = SceneGraph.getLinkedSceneIds(sceneIdB) || [];
            for (var j = 0; j < bLinks.length; j++) { if (bLinks[j].sceneId === sceneIdA) return true; }
            // Caller relationship (a Common Event and the scene that calls it)
            if (a.type === 'commonevent' || b.type === 'commonevent') {
                var aCallers = SceneGraph.getCallerScenes(sceneIdA) || [];
                for (var k = 0; k < aCallers.length; k++) { if (aCallers[k].sceneId === sceneIdB) return true; }
                var bCallers = SceneGraph.getCallerScenes(sceneIdB) || [];
                for (var l = 0; l < bCallers.length; l++) { if (bCallers[l].sceneId === sceneIdA) return true; }
            }
            // Map transfer continuity: A transfers to B's map or B transfers to A's map
            if (a.transfers && b.file) {
                for (var m = 0; m < a.transfers.length; m++) { if (a.transfers[m].target === b.file) return true; }
            }
            if (b.transfers && a.file) {
                for (var n = 0; n < b.transfers.length; n++) { if (b.transfers[n].target === a.file) return true; }
            }
            return false;
        };
        // Reorder the scene-sorted rows into four streams so each packs with its own ruleset
        // without interfering with the others:
        //   1. "big" scenes (rowCount >= sceneShortMaxRows) -> isolated, batched first
        //   2. "small" scenes (2+ rows, below threshold) -> grouped to fill the floor/cap/size limits
        //   3. "single-line" scenes (exactly 1 row) -> packed densely (40 rows by default)
        //   4. non-scene (UI/system) rows -> packed last
        // Pulling big scenes ahead of the small-scene stream means a big scene can no longer
        // prematurely flush a small-scene group that is still below its row floor, so small
        // groups fill their limits fully instead of emitting tiny requests. Single-line scenes
        // carry almost no internal context (they are basically button labels that happen to be
        // scenes), so they get their own dense packing stream rather than diluting a real
        // conversation scene or producing under-filled requests.
        (function () {
            var _sgReady = (typeof SceneGraph !== 'undefined' && SceneGraph.isAvailable());
            // Only carve out the single-line stream when scene isolation is active and the
            // single-line row cap is enabled; otherwise single-line scenes stay in the ordinary
            // small-scene stream and pack exactly as before.
            var _separateSingle = (sceneShortMaxRows > 0 && maxSingleLineScenesRows > 0 && _sgReady);
            var _bigRows = [], _smallRows = [], _singleRows = [], _nonSceneRows = [];
            var _bigScenes = {}, _smallScenes = {}, _singleScenes = {};
            for (var ri = 0; ri < rows.length; ri++) {
                var rk = rows[ri].location[0] + "|" + rows[ri].location[1];
                var sid = rowSceneIds[rk] || null;
                if (!sid) { _nonSceneRows.push(rows[ri]); continue; }
                var _sc = null;
                if (sceneShortMaxRows > 0 && _sgReady) _sc = SceneGraph.getScene(sid);
                if (_sc && _sc.rowCount >= sceneShortMaxRows) {
                    _bigRows.push(rows[ri]); _bigScenes[sid] = true;
                } else if (_separateSingle && _sc && _sc.rowCount === 1) {
                    _singleRows.push(rows[ri]); _singleScenes[sid] = true;
                } else {
                    _smallRows.push(rows[ri]); _smallScenes[sid] = true;
                }
            }
            rows = _bigRows.concat(_smallRows).concat(_singleRows).concat(_nonSceneRows);
            ui.log("[SLRBatchTranslator] Scene packing: " + Object.keys(_bigScenes).length + " big scene(s), " + Object.keys(_smallScenes).length + " small scene(s), " + Object.keys(_singleScenes).length + " single-line scene(s), " + _nonSceneRows.length + " non-scene row(s) [threshold: " + sceneShortMaxRows + " rows].");
        })();
        // Classify a scene into a packing tier: 'big' (>= Scene Threshold rows), 'single' (exactly
        // 1 row, only when the single-line stream is active), 'small' (everything else / unknown),
        // or 'none' (no scene). Used at scene boundaries to apply the right ruleset per stream.
        let _sceneTier = function(sceneId) {
            if (!sceneId) return 'none';
            if (sceneShortMaxRows <= 0 || typeof SceneGraph === 'undefined' || !SceneGraph.isAvailable()) return 'small';
            var sc = SceneGraph.getScene(sceneId);
            if (!sc) return 'small';
            if (sc.rowCount >= sceneShortMaxRows) return 'big';
            if (sc.rowCount === 1 && maxSingleLineScenesRows > 0) return 'single';
            return 'small';
        };
        for (let i = 0; i < rows.length; i++) {
            let text = rows[i].getValue(options.source);
            let trimmedtext = text
            //This turned out to not make it any more accurate in the end.
/*             if (window.transConfig.japanesesource == true) {
                if (translatorEngine.id == 'dslr') {
                    trimmedtext = trimmedtext.replaceAll(/\\[cin][w]?\[\d+\]/gi, "＃＃＃＃＃");
                    trimmedtext = trimmedtext.replaceAll(/@\d/g, "＃＃");
                } else if (translatorEngine.id == 'slr') {
                    trimmedtext = trimmedtext.replaceAll(/@@\d+@/g, "＃＃＃＃");
                }
                trimmedtext = trimmedtext.replaceAll(/[^\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}０１２３４５６７８９？！、。＃＄％＆［］＾＿｛｝｜（）＊＋－／＠＜＞：；…ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚー―◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ]/gu, "");
            } */
            let trimmedtextcount = trimmedtext.length;
            // A lone "large" scene may grow up to the Maximum Scene Size (maxLength) and is sent
            // whole. Everything else (grouped small scenes and non-scene/UI text) packs to the
            // smaller Target Request Size so each batch maps to roughly one model request.
            let _isLoneLargeScene = false;
            if (currentSceneIds.length === 1 && typeof SceneGraph !== 'undefined' && SceneGraph.isAvailable()) {
                var _lgScene = SceneGraph.getScene(currentSceneIds[0]);
                if (_lgScene && _lgScene.rowCount >= sceneShortMaxRows) _isLoneLargeScene = true;
            }
            let effectiveMaxLength = (targetRequestSize > 0 && !_isLoneLargeScene) ? targetRequestSize : maxLength;
            if (currentSize > 0 && (currentSize + trimmedtextcount) > effectiveMaxLength) {
                addToBatches();
            }
            // Non-scene (UI/system) text is independent short strings. A character cap alone can
            // pack hundreds of tiny rows into one batch, and the per-row formatting overhead then
            // blows up the actual request. Cap the row count so that can't happen. Grouped scenes
            // are already limited by Max Scenes per Grouped Batch and lone large scenes go whole.
            if (currentSceneIds.length === 0 && maxNonSceneRows > 0 && currentBatch.length >= maxNonSceneRows) {
                addToBatches();
            }
            const row = rows[i];
            if (!row || !row.getValue) {
                ui.log(`[SLRBatchTranslator] Skipping invalid row at index ${i}`);
                continue;
            }
            var _rowKey = row.location[0] + "|" + row.location[1];
            var _rowSceneId = rowSceneIds[_rowKey] || null;
            if (_rowSceneId !== prevSceneId) {
                // Keep scene dialogue and non-scene (UI/system) text in separate batches so
                // neither pollutes the other's context.
                var _crossingSceneBoundary = (!!prevSceneId) !== (!!_rowSceneId);
                if (currentBatch.length > 0 && _crossingSceneBoundary) {
                    addToBatches();
                } else if (sceneShortMaxRows > 0 && currentBatch.length > 0) {
                    var _incomingTier = _sceneTier(_rowSceneId);
                    // A batch is tier-homogeneous (streams are flushed on any tier change), so the
                    // first scene in it describes the batch's tier.
                    var _batchTier = (currentSceneIds.length > 0) ? _sceneTier(currentSceneIds[0]) : 'none';
                    if (_incomingTier === 'big' || _batchTier === 'big') {
                        // Either side is a "long" scene: isolate it for better LLM context.
                        addToBatches();
                    } else if (_incomingTier !== _batchTier) {
                        // Crossing between the small (2+ line) and single-line scene streams: keep
                        // them in separate batches so each packs under its own ruleset.
                        addToBatches();
                    } else if (_batchTier === 'single') {
                        // Single-line scene stream: these scenes carry almost no internal context,
                        // so pack them densely by row count - no row floor and no per-group scene
                        // cap needed, only the Target Request Size and this row cap apply.
                        var _singleFull = (maxSingleLineScenesRows > 0 && currentBatch.length >= maxSingleLineScenesRows);
                        if (_singleFull) {
                            addToBatches();
                        } else {
                            currentSceneBreaks.push(currentBatch.length);
                        }
                    } else {
                        // Small (2+ line) scene stream. Decide merge vs flush by the ruleset:
                        // 1. Below the row floor -> always keep merging (never emit tiny requests),
                        //    regardless of relatedness or scene count.
                        // 2. Floor met -> respect the scene cap and relatedness.
                        var _groupMetFloor = currentBatch.length >= sceneShortMaxRows;
                        if (!_groupMetFloor) {
                            if (_rowSceneId) currentSceneBreaks.push(currentBatch.length);
                        } else {
                            var _groupFullScenes = (maxScenesPerGroup > 0 && currentSceneIds.length >= maxScenesPerGroup);
                            var _related = (!_rowSceneId) ? true : _scenesAreRelated(prevSceneId, _rowSceneId);
                            if (_groupFullScenes || !_related) {
                                addToBatches();
                            } else {
                                currentSceneBreaks.push(currentBatch.length);
                            }
                        }
                    }
                } else if (currentBatch.length > 0) {
                    // sceneShortMaxRows == 0: scene isolation disabled, merge everything; still
                    // honour the scene cap if set.
                    var _groupFullScenes0 = (maxScenesPerGroup > 0 && currentSceneIds.length >= maxScenesPerGroup);
                    if (_groupFullScenes0) {
                        addToBatches();
                    } else if (_rowSceneId) {
                        currentSceneBreaks.push(currentBatch.length);
                    }
                }
                prevSceneId = _rowSceneId;
            }
            if (_rowSceneId && currentSceneIds.indexOf(_rowSceneId) === -1) {
                currentSceneIds.push(_rowSceneId);
            }
            
            currentBatch.push(text);
            currentBatchRows.push(row);
            currentSize += trimmedtextcount;
        }
        if (currentSize > 0) {
            addToBatches();
        }
        var _isDslr = (translatorEngine.id == 'dslr');
        var _activeEndpoints = _isDslr && typeof translatorEngine.getActiveEndpoints === 'function'
            ? translatorEngine.getActiveEndpoints() : null;
        var _useWeightedPool = !!(_activeEndpoints && _activeEndpoints.length);
        var MAX_CONCURRENT_BATCHES = _useWeightedPool
            ? Math.min(translatorEngine.getTotalConcurrency(), batches.length || 1)
            : (window.transConfig.MaxConcurrentBatches || 1);
        
        let batchIndex = 0;
        let activeBatches = 0;
        let completedBatches = 0;
        // Cumulative token usage across all batches for a single end-of-job UI summary.
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;
        let batchStart = Date.now();
        // Character accounting for a rough time-remaining estimate. Batches vary wildly in size,
        // so "batches processed" alone is misleading; tracking characters translated gives a much
        // better sense of progress. Throughput is measured from completed work and reflects the
        // actual (possibly concurrent) rate, then applied to the remaining characters.
        var batchCharSizes = batches.map(function(b) {
            var total = 0;
            for (var ci = 0; ci < b.length; ci++) total += (b[ci] ? b[ci].length : 0);
            return total;
        });
        var totalChars = 0;
        for (var ti = 0; ti < batchCharSizes.length; ti++) totalChars += batchCharSizes[ti];
        var completedChars = 0;
        // Throughput sample: only batches that did real LLM work count toward the rate estimate.
        // A cached batch finishes in a fraction of a second; if it were included it would make the
        // estimate collapse to an overly-optimistic figure. Excluding such batches biases the
        // estimate slightly conservative, which is the safer direction.
        var realChars = 0;
        var realBatchDurationMs = 0;
        var batchStartTime = {};
        var CACHE_HIT_RATE = 1000; // chars/sec above which a batch can only be a cache hit
        var _humanizeDuration = function(sec) {
            sec = Math.max(0, Math.round(sec));
            if (sec < 60) return sec + "s";
            if (sec < 3600) return Math.round(sec / 60) + "m";
            var h = Math.floor(sec / 3600);
            var m = Math.round((sec % 3600) / 60);
            if (m >= 60) { h += 1; m -= 60; }
            return m > 0 ? (h + "h " + m + "m") : (h + "h");
        };
        var _formatEta = function() {
            if (realChars <= 0 || realBatchDurationMs <= 0 || totalChars <= 0) return "";
            var remainingChars = totalChars - completedChars;
            if (remainingChars <= 0) return "";
            // Per-stream throughput from real (non-cached) batches, then scaled by the effective
            // concurrency so the estimate reflects parallel requests from the very first completed
            // batch (instead of only converging to the aggregate rate after several waves). The
            // factor is capped by how many batches are actually left to run.
            var singleRate = realChars / (realBatchDurationMs / 1000);
            var remainingBatches = batches.length - completedBatches;
            var effectiveConcurrency = Math.min(
                _useWeightedPool ? translatorEngine.getTotalConcurrency() : MAX_CONCURRENT_BATCHES,
                Math.max(1, remainingBatches)
            );
            var charsPerSec = singleRate * effectiveConcurrency;
            if (charsPerSec <= 0) return "";
            var remainingSec = remainingChars / charsPerSec;
            return "~" + _humanizeDuration(remainingSec) + " remaining (" + Math.round(charsPerSec) + " chars/s)";
        };

        // ------------------------------------------------------------------

        // Apply the engine's per-line review outcomes to the grid as the
        // `mediumpurple` QC tag: review flags a row, a later clean review of the
        // same row clears it — only the QC tag is touched, never the legacy
        // `purple` or any other tag the row carries. `_lineToRow` maps a served
        // line index to its batch-row position, and the row carries its grid
        // location. The engine reports outcomes by served line index.
        //
        // A grid row usually spans SEVERAL served lines (the text processor
        // splits a message box into translatable lines), so states are aggregated
        // per grid row before anything is written: the row is flagged when ANY of
        // its lines is flagged, and only cleared when EVERY line of the row was
        // reviewed and came back clean. Applying per line with last-write-wins
        // would let a later clean line hide an earlier flagged one.
        const _reviewApplyTags = (index, translateOptions) => {
            try {
                const stateMap = translateOptions && translateOptions._reviewStateByIndex;
                const lineToRow = translateOptions && translateOptions._lineToRow;
                if (!stateMap || !lineToRow) return;
                const rows = batchesRows[index] || [];
                const total = {};   // row pos -> # served lines of the row
                const seen = {};    // row pos -> # lines with a published outcome
                const flagged = {}; // row pos -> any line flagged
                for (let t = 0; t < lineToRow.length; t++) {
                    total[lineToRow[t]] = (total[lineToRow[t]] || 0) + 1;
                }
                for (const key of Object.keys(stateMap)) {
                    const t = parseInt(key, 10);
                    const pos = lineToRow[t];
                    if (pos == null || pos < 0 || pos >= rows.length) continue;
                    seen[pos] = (seen[pos] || 0) + 1;
                    if (stateMap[key] === "flag") flagged[pos] = true;
                }
                for (const posKey of Object.keys(total)) {
                    const pos = parseInt(posKey, 10);
                    if (pos < 0 || pos >= rows.length) continue;
                    const rowObj = rows[pos];
                    const loc = rowObj && rowObj.location;
                    if (!loc) continue;
                    const file = loc[0], gridRow = loc[1];
                    if (!trans.project.files[file]) continue;
                    if (flagged[pos]) {
                        slrFlagTag(file, gridRow, "mediumpurple");
                    } else if (seen[pos] === total[pos]) {
                        slrUnflagTag(file, gridRow, "mediumpurple");
                    }
                    // else: some lines of the row were never reviewed (failed QC
                    // call, TRANSLATIONFAIL) — leave the row's tags untouched.
                }
            } catch (e) {
                ui.log("[DSLRReview] Failed to apply review tags: " + (e && e.message));
            }
        };
        const processBatch = (index, epSlot) => {
            if (index >= batches.length || !batches[index]) {
                ui.log(`[SLRBatchTranslator] Invalid batch index ${index}`);
                batchComplete(index, epSlot);
                return;
            }

            batchStartTime[index] = Date.now();
            activeBatches++;
            ui.log(`[SLRBatchTranslator] Starting batch ${index + 1} of ${batches.length}`);
            
            var sceneContext = null;
            var sceneBreaks = (batchesSceneBreaks[index] && batchesSceneBreaks[index].length > 0) ? batchesSceneBreaks[index] : null;
            var batchSceneIds = batchesSceneIds[index];
            if (batchSceneIds && batchSceneIds.length > 0 && typeof SceneGraph !== 'undefined' && SceneGraph.isAvailable()) {
                var _sceneTextProcessor = null;
                if (translatorEngine.processor && typeof translatorEngine.processorInit === 'function') {
                    translatorEngine.processorInit();
                    var _processor = translatorEngine.processor;
                    _sceneTextProcessor = function(rawText) {
                        var p = _processor.process(rawText);
                        var processed = p.getTranslatableLines();
                        return processed.length > 0 ? processed.join("\n") : rawText;
                    };
                }
                if (batchSceneIds.length === 1) {
                    sceneContext = SceneGraph.getSceneAIContext(batchSceneIds[0], _sceneTextProcessor);
                } else {
                    var _mergedCtx = [];
                    for (var _si = 0; _si < batchSceneIds.length; _si++) {
                        var _ctx = SceneGraph.getSceneAIContext(batchSceneIds[_si], _sceneTextProcessor);
                        if (_ctx) _mergedCtx.push(_ctx);
                    }
                    sceneContext = _mergedCtx.length > 0 ? _mergedCtx.join("\n\n") : null;
                }
            }

            var translateOptions = {
                endpointNumber: _useWeightedPool ? _activeEndpoints[epSlot].number : undefined,
                sceneContext: sceneContext,
                sceneBreaks: sceneBreaks,
                onError: (error) => {
                    ui.log(`[SLRBatchTranslator] Batch ${index + 1} failed: ${error.message || 'Unknown error'}`);
                    batchComplete(index, epSlot);
                },
                onAfterLoading: (result) => {
                    this.insertIntoTables(result, batchesRows, index, options.destination);
                    if (result && result.usage) {
                        totalPromptTokens += (result.usage.prompt || 0);
                        totalCompletionTokens += (result.usage.completion || 0);
                        totalTokens += (result.usage.total || 0);
                    }
                    // The engine already ran the review inside its single-line phase and
                    // reported per-line outcomes on the options side-channel; apply the
                    // purple tags those decisions imply (the engine never touches tags).
                    _reviewApplyTags(index, translateOptions);
                    batchComplete(index, epSlot);
                },
                progress: (perc) => {
                    // Individual batch progress could be tracked here if needed
                }
            };
            try {
                translatorEngine.translate(batches[index], translateOptions);
            } catch (error) {
                ui.log(`[SLRBatchTranslator] Error in batch ${index + 1}: ${error.message}`);
                batchComplete(index, epSlot);
            }
        };

        const batchComplete = (index, epSlot) => {
            activeBatches--;
            completedBatches++;
            var _batchChars = (batchCharSizes[index] || 0);
            completedChars += _batchChars;
            // A batch that finished at an impossible-for-an-LLM rate is a cache hit; exclude it
            // from the throughput sample so it can't drag the time estimate down to "a few seconds".
            var _dur = (batchStartTime[index] !== undefined) ? (Date.now() - batchStartTime[index]) : 0;
            var _apparentRate = (_dur > 0) ? (_batchChars / (_dur / 1000)) : Infinity;
            if (_apparentRate <= CACHE_HIT_RATE) {
                realChars += _batchChars;
                realBatchDurationMs += _dur;
            }
            updateProgress();
            if (options.saveOnEachBatch) {
                ui.log(`[SLRBatchTranslator] Saving project...`);
                this.saveProject();
            }
            if (completedBatches === batches.length) {
                finalizeTranslation();
            } else {
                startNextBatches();
            }
        };

        const updateProgress = () => {
            const progress = Math.round((completedBatches / batches.length) * 100);
            var msg = `Processed ${completedBatches} of ${batches.length} batches`;
            var eta = _formatEta();
            if (eta) msg += " · " + eta;
            ui.loadingProgress(progress, msg);
        };

        const finalizeTranslation = () => {
            let batchEnd = Date.now();
            ui.log(`[SLRBatchTranslator] Finished all batches at ${new Date()}`);
            ui.log(`[SLRBatchTranslator] Took ${Math.round(10 * (batchEnd - batchStart) / 1000) / 10} seconds.`);
            if (totalTokens >= 1) {
                ui.log(`[SLRBatchTranslator] Total token usage - Prompt: ${totalPromptTokens}, Completion: ${totalCompletionTokens}, Total: ${totalTokens}`);
            }
            printRunSummary();
            // If the last in-flight batch completed while paused, release the engine
            // pause so nothing stays held for the next run.
            if (batchPaused) enginePause(false);
        ui.loadingProgress(100, "Finished!");
            runPostRunChecks();
            // The run is over — Abort/Pause would be dead buttons now, so swap them for Close.
            ui.loadingClearButton();
            ui.showCloseButton();
            this.refresh();
            
            if (options.saveOnEachBatch) {
                this.saveProject();
            }
        };

        const startNextBatches = () => {
            // While paused, no new batches are dispatched; the Resume button calls this
            // again to continue.
            if (batchPaused) return;
            try {
                if (_useWeightedPool) {
                    while (batchIndex < batches.length) {
                        if (aborted) {
                            ui.log(`[SLRBatchTranslator] Translation aborted.`);
                            // Summary + Close button were already shown by the Abort button
                            // handler (after an abort the dispatcher never gets another
                            // callback from in-flight batches, so the handler is the only
                            // reliable place to print them).
                            ui.showCloseButton();
                            this.refresh();
                            return;
                        }
                        if (!batches[batchIndex]) {
                            ui.log(`[SLRBatchTranslator] Skipping invalid batch index ${batchIndex}`);
                            batchComplete(batchIndex, null);
                            batchIndex++;
                            continue;
                        }
                        if (translatorEngine.totalSpareCapacity() <= translatorEngine.getPendingRotations()) break;
                        const slot = translatorEngine.pickEndpointIndex(_activeEndpoints);
                        if (slot < 0) break;
                        const currentIndex = batchIndex++;
                        processBatch(currentIndex, slot);
                    }
                } else {
                    while (activeBatches < MAX_CONCURRENT_BATCHES && batchIndex < batches.length) {
                        if (aborted) {
                            ui.log(`[SLRBatchTranslator] Translation aborted.`);
                            // Summary + Close button were already shown by the Abort button
                            // handler (after an abort the dispatcher never gets another
                            // callback from in-flight batches, so the handler is the only
                            // reliable place to print them).
                            ui.showCloseButton();
                            this.refresh();
                            return;
                        }
                        const currentIndex = batchIndex++;
                        if (currentIndex < batches.length && batches[currentIndex]) {
                            processBatch(currentIndex, null);
                        } else {
                            ui.log(`[SLRBatchTranslator] Skipping invalid batch index ${currentIndex}`);
                            batchComplete(currentIndex, null);
                        }
                    }
                }
            } catch (error) {
                ui.log(`[SLRBatchTranslator] Error starting batches: ${error.message}`);
            }
        };

        // Expose the dispatcher to the Resume button (declared before the init setTimeout).
        startNextBatchesFn = startNextBatches;

        // Start initial batches
        // Reset per-job endpoint state so a stale 429 cooldown / in-flight count / disabled flag
        // from an aborted previous job can't leave the dispatcher with zero spare capacity (which
        // would prevent the first batch from ever dispatching).
        if (typeof translatorEngine.resetEndpointState === 'function') translatorEngine.resetEndpointState();
        if (typeof translatorEngine.resetRunStats === 'function') translatorEngine.resetRunStats();
        startNextBatches();
        }, 100); // Increased delay to 100ms for better initialization
    }
    insertIntoTables(result, batchesRows, myBatch, destination) {
        let text = document.createTextNode(`[SLRBatchTranslator] Inserting into tables...`);
        this.print(text);
        
        // Validate all inputs
        if (!result || !result.translation || !batchesRows || !batchesRows[myBatch]) {
            ui.log(`[SLRBatchTranslator] Invalid input data for batch ${myBatch + 1}!`);
            return;
        }

        // Ensure we don't exceed either array length
        const maxLength = Math.min(result.translation.length, batchesRows[myBatch].length);
        if (maxLength === 0) {
            ui.log(`[SLRBatchTranslator] No valid rows to process in batch ${myBatch + 1}!`);
            return;
        }

        for (let i = 0; i < maxLength; i++) {
            try {
                const row = batchesRows[myBatch][i];
                const translation = result.translation[i];
                
                if (!row || !row.getValue) {
                    ui.log(`[SLRBatchTranslator] Invalid row object at index ${i} in batch ${myBatch + 1}`);
                    continue;
                }
                
                if (!translation) {
                    ui.log(`[SLRBatchTranslator] Empty translation at index ${i} in batch ${myBatch + 1}`);
                    continue;
                }

                row.setValue(translation, destination);
                if (row.location) {
                    trans.batchCheckCells.fixTranslatedCell(row.location[0], row.location[1], destination);
                }
            } catch (error) {
                ui.log(`[SLRBatchTranslator] Error inserting translation ${i} in batch ${myBatch + 1}: ${error.message}`);
            }
        }
    }
    saveProject() {
        if (this.saving) {
            this.saveAgain = true;
        } else {
            this.saving = true;
            trans.autoSave().finally(() => {
                this.saving = false;
                if (this.saveAgain) {
                    this.saveAgain = false;
                    this.saveProject();
                }
            });
        }
    }
    log(...texts) {
        let elements = [];
        texts.forEach(text => {
            elements.push(document.createTextNode(text));
        });
        this.print(...elements);
    }
    error(...texts) {
        let elements = [];
        texts.forEach(text => {
            elements.push(document.createTextNode(text));
        });
        this.printError(...elements);
    }
    print(...elements) {
        let consoleWindow = $("#loadingOverlay .console")[0];
        let pre = document.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        elements.forEach(element => {
            pre.appendChild(element);
        });
        consoleWindow.appendChild(pre);
    }
    printError(...elements) {
        let consoleWindow = $("#loadingOverlay .console")[0];
        let pre = document.createElement("pre");
        pre.style.color = "red";
        pre.style.fontWeight = "bold";
        pre.style.whiteSpace = "pre-wrap";
        elements.forEach(element => {
            pre.appendChild(element);
        });
        consoleWindow.appendChild(pre);
    }
}

// Shared decoration for the workflow toolbar buttons: optional text label,
// responsive-collapse metadata (see www/js/toolbarLayout.js + ui.toolbarLabelFit)
// and the classes the main window's enable/disable logic looks for.
function applyWorkflowButtonOptions(button, options) {
    options = options || {};
    if (options.className) {
        options.className.split(/\s+/).forEach(function (cls) {
            if (cls) button.classList.add(cls);
        });
    }
    if (options.id) button.setAttribute("data-button-id", options.id);
    if (options.label) {
        let label = document.createElement("span");
        label.className = "menu-button-label";
        label.textContent = options.label;
        button.appendChild(label);
        button.setAttribute("data-label", options.label);
        if (options.priority !== undefined && options.priority !== null) button.setAttribute("data-label-priority", options.priority);
        if (options.essential) button.setAttribute("data-label-essential", "true");
        if (options.shortLabel) button.setAttribute("data-label-short", options.shortLabel);
    }
}
class RedButtonManagerButton {
    constructor(name, icon, title, action) {
        this.name = name;
        this.icon = icon;
        this.title = title;
        this.action = action;
    }
    setIcon(icon) {
        this.icon = icon;
        if (this.element != undefined) {
            this.element.children[0].className = icon;
        }
    }
    getButton() {
        if (this.element != undefined) {
            return this.element;
        } else {
            let button = document.createElement("button");
            button.classList.add("menu-button");
            button.dataset.tranattr = "title";
            button.title = this.title;
            let icon = document.createElement("i");
            icon.classList.add(this.icon);
            button.appendChild(icon);
            icon.style.color = "#76ffff";
            button.addEventListener("click", this.action);
            this.element = button;
            return button;
        }
    }
}
class GreenButtonManagerButton {
    constructor(name, icon, title, action, options) {
        this.name = name;
        this.icon = icon;
        this.title = title;
        this.action = action;
        this.options = options || {};
    }
    setIcon(icon) {
        this.icon = icon;
        if (this.element != undefined) {
            this.element.children[0].className = icon;
        }
    }
    getButton() {
        if (this.element != undefined) {
            return this.element;
        } else {
            let button = document.createElement("button");
            button.classList.add("menu-button");
            button.dataset.tranattr = "title";
            button.title = this.title;
            let icon = document.createElement("i");
            icon.classList.add(this.icon);
            button.appendChild(icon);
            icon.style.color = "#a496d2";
            applyWorkflowButtonOptions(button, this.options);
            button.addEventListener("click", this.action);
            this.element = button;
            return button;
        }
    }
}
class BlackButtonManagerButton {
    constructor(name, icon, title, action, options) {
        this.name = name;
        this.icon = icon;
        this.title = title;
        this.action = action;
        this.options = options || {};
    }
    setIcon(icon) {
        this.icon = icon;
        if (this.element != undefined) {
            this.element.children[0].className = icon;
        }
    }
    getButton() {
        if (this.element != undefined) {
            return this.element;
        } else {
            let button = document.createElement("button");
            button.classList.add("menu-button");
            button.dataset.tranattr = "title";
            button.title = this.title;
            let icon = document.createElement("i");
            icon.classList.add(this.icon);
            button.appendChild(icon);
            icon.style.color = "#000";
            applyWorkflowButtonOptions(button, this.options);
            button.addEventListener("click", this.action);
            this.element = button;
            return button;
        }
    }
}
class BlueButtonManagerButton {
    constructor(name, icon, title, action, options) {
        this.name = name;
        this.icon = icon;
        this.title = title;
        this.action = action;
        this.options = options || {};
    }
    setIcon(icon) {
        this.icon = icon;
        if (this.element != undefined) {
            this.element.children[0].className = icon;
        }
    }
    getButton() {
        if (this.element != undefined) {
            return this.element;
        } else {
            let button = document.createElement("button");
            button.classList.add("menu-button");
            button.dataset.tranattr = "title";
            button.title = this.title;
            let icon = document.createElement("i");
            icon.classList.add(this.icon);
            button.appendChild(icon);
            icon.style.color = "#ffd633";
            applyWorkflowButtonOptions(button, this.options);
            button.addEventListener("click", this.action);
            this.element = button;
            return button;
        }
    }
}
/// <reference path="RedBatchTranslator.ts" />
/// <reference path="RedButtonManager.ts" />
var thisAddon = this;
var thisAddonOptions;
(function(thisAddonOptions) {
    thisAddonOptions["alwaysMerge"] = "alwaysMerge";
    thisAddonOptions["fontFamily"] = "fontFamily";
    thisAddonOptions["longContexts"] = "longContexts";
    thisAddonOptions["shortContexts"] = "shortContexts";
    thisAddonOptions["mergeContexts"] = "mergeContexts";
    thisAddonOptions["longLength"] = "longLength";
    thisAddonOptions["shortLength"] = "shortLength";
    thisAddonOptions["textCommands"] = "textCommands";
    thisAddonOptions["replaceCommands"] = "replaceCommands";
})(thisAddonOptions || (thisAddonOptions = {}));
thisAddon.optionsForm = {
    [thisAddonOptions.fontFamily]: {
        "type": "string",
        "title": "Font Family",
        "description": "When wrapping texts, this is the font which will be used to decide length. Ideally, use one that looks as similar as possible to the game's.\nDefault='mplus-1m-regular'",
        "default": "mplus-1m-regular",
        "HOOK": "thisAddon.config." + thisAddonOptions.fontFamily
    },
    [thisAddonOptions.mergeContexts]: {
        "type": "string",
        "title": "Merge Wrap Contexts",
        "description": "Instead of breaking lines into smaller lines, the remainder of one line will be added to the start of the next line (after padding) in these contexts. This should result in less overall lines, which is good when you don't have the benefit of just making a second message.\nDefault='description'",
        "HOOK": "thisAddon.config." + thisAddonOptions.mergeContexts,
        "default": [
            "description"
        ].join(",")
    },
    [thisAddonOptions.alwaysMerge]: {
        "type": "boolean",
        "title": "Always Merge",
        "description": `Applies the processing of merging with the next line on every wrappable context, for those who like compact text.`,
        "default": false,
        "HOOK": "thisAddon.config." + thisAddonOptions.alwaysMerge
    },
    [thisAddonOptions.shortContexts]: {
        "type": "string",
        "title": "Short Contexts",
        "description": "These contexts will wrap to the short length type. These should be used when showing pictures, or when the game simply has a smaller message box.\nDefault='hasPicture'",
        "default": [
            "hasPicture", //"Dialogue", // Why a uppercase DIalogue? I don't remember! Need to find out if this is correct.
        ].join(","),
        "HOOK": "thisAddon.config." + thisAddonOptions.shortContexts
    },
    [thisAddonOptions.shortLength]: {
        "type": "number",
        "title": "Short Length",
        "description": `The length to wrap short contexts to. This length is measured in square, monospace characters, using japanese characters as basis.\nWhat this means is that you are defining how long your sentences can be in amount of japanese characters. This is useful because proportional fonts will change width depending on the characters used, so wrapping to character count isn't very accurate. 24 is the number of japanese characters that fit in default MV message window with picture.\nDefault='20'\nCounting assist: ０１２３４５６７８９`,
        "default": 20,
        "HOOK": "thisAddon.config." + thisAddonOptions.shortLength
    },
    [thisAddonOptions.longContexts]: {
        "type": "string",
        "title": "Long Wrap Contexts",
        "description": "These contexts will wrap to the long length. So ideally these are the full screen contexts.\nDefault='dialogue,message1,message2,message3,description,message,noPicture,scrollingMessage'",
        "HOOK": "thisAddon.config." + thisAddonOptions.longContexts,
        "default": [
            "dialogue", "message1", "message2", "message3", "description",
            "message", "noPicture", "scrollingMessage", "Show Text"
        ].join(",")
    },
    [thisAddonOptions.wrappablecells]: {
        "type": "string",
        "title": "Long Wrap Contexts",
        "description": "These contexts can be wrapped most of the time. Only used for the cwrapable command right now.\nDefault='dialogue,message1,message2,message3,description,message,noPicture,hasPicture,scrollingMessage'",
        "HOOK": "thisAddon.config." + thisAddonOptions.wrappablecells,
        "default": [
            "dialogue", "message1", "message2", "message3", "description",
            "message", "noPicture", "hasPicture", "scrollingMessage", "Show Text"
        ].join(",")
    },
    [thisAddonOptions.longLength]: {
        "type": "number",
        "title": "Long Length",
        "description": `The length to wrap long contexts to. This length is measured in square, monospace characters, using japanese characters as basis.\nWhat this means is that you are defining how long your sentences can be in amount of japanese characters. This is useful because proportional fonts will change width depending on the characters used, so wrapping to character count isn't very accurate. 28 is the number of japanese characters that fit in default MV message window without picture.\nDefault='24'\nCounting assist: ０１２３４５６７８９`,
        "default": 24,
        "HOOK": "thisAddon.config." + thisAddonOptions.longLength
    },
    [thisAddonOptions.textCommands]: {
        "type": "object",
        "title": "Text Commands to Process",
        "description": `Define RPG Maker text commands that should be processed during text wrapping.

These commands will be detected and replaced with their actual text representation to calculate accurate line lengths.

• Put each command pattern on a new line
• Use SHISAYE_INT as a placeholder for numbers/variables
• Commands will be matched in the order listed

Examples:
\\\C[SHISAYE_INT]    - Color codes
\\\N[SHISAYE_INT]    - Name displays
\\\V[SHISAYE_INT]    - Variable values
\\\P[SHISAYE_INT]    - Party member names`,
        "HOOK": "thisAddon.config." + thisAddonOptions.textCommands,
        "default": "\\C[SHISAYE_INT]",
        "formType": "ace",
        "formOptions": {
            "aceTheme": "twilight",
            "height": "156px"
        }
    },
    [thisAddonOptions.replaceCommands]: {
        "type": "object",
        "title": "Text Command Replacements",
        "description": `Define the actual text that should replace each command during width calculation.

• Each line corresponds to a command from the list above
• Use commas to separate replacement values for different indices
• Empty entries mean the command adds no width

Format:
Line 1: Replacements for first command (e.g., \\C[0], \\C[1], \\C[2])
Line 2: Replacements for second command (e.g., \\N[0], \\N[1], \\N[2])

Example where:
- \\C[0] has no text (empty)
- \\N[0] is empty, \\N[1] = "Hero", \\N[2] = "LongestPossibleName"
- \\V[0] = "100", \\V[1] = "VariableText"

Input:
,                           (for \\C[x])
,Hero,LongestPossibleName   (for \\N[x])
100,VariableText            (for \\V[x])`,
        "HOOK": "thisAddon.config." + thisAddonOptions.replaceCommands,
        "default": ",",
        "formType": "ace",
        "formOptions": {
            "aceTheme": "twilight",
            "height": "156px"
        }
    },
};
thisAddon.applyDefaults();

function cleanContexts(str) {
    str = str.replaceAll(/[,\.;\-]/g, ",").replaceAll(/ /g, "").toLowerCase();
    return str.split(",");
}
const measurer = document.createElement("pre");
measurer.style.fontSize = "24px";
measurer.style.fontFamily = "mplus-1m-regular";
measurer.style.setProperty("all", "revert", "important");
measurer.style.setProperty("position", "position", "important");
measurer.style.setProperty("visibility", "hidden", "important");
measurer.style.setProperty("width", "max-content", "important");

function measureTextPxWidth(text) {
    measurer.innerText = text;
    document.body.appendChild(measurer);
    let width = measurer.getBoundingClientRect().width;
    document.body.removeChild(measurer);
    console.log(`Width of text "${text}" is ${width}`);
    return width;
}
let japaneseLength = measureTextPxWidth("。");
let wordWrapNoPicture = 24 * japaneseLength; // MV Size is 28 characters, have to check against the others. 
let wordWrapPicture = 20 * japaneseLength;
let PCancelled = "No"

function updateValues() {
    if (measurer.style.fontFamily != thisAddon.config[thisAddonOptions.fontFamily]) {
        measurer.style.fontFamily = thisAddon.config[thisAddonOptions.fontFamily];
        sizes = {};
    }
    japaneseLength = measureTextPxWidth("。");
    wordWrapNoPicture = parseInt(thisAddon.config[thisAddonOptions.longLength]) * japaneseLength;
    wordWrapPicture = parseInt(thisAddon.config[thisAddonOptions.shortLength]) * japaneseLength;
    var wrapPrompt = prompt("Please enter the maximum monospace character amount per line. -4 for Avatar picture contexts.\n\nLeave this on default for a best effort wrap without planned font changes outside of the tool. (Default is 24/20 characters.)\n(May cause text to escape the screen in menus, but is still better than no wrapping.)\n\nType in \"stint\" (without quotes) for a best effort wrap for Stint Ultra Condensed Font. (52/46)\n\nType in \"size\" (without quotes) for a best effort wrap for a font size of 16. (40/36)\n\nYou can add a \"p\" (without quotes) prefix to \"stint\" or \"size\" if you are dealing with an unusually small dialogue box and the picture context is not present. (46/46 36/36)\n\nYou can type in \"clear\" to clear all cells in the \"Wrapped Translations\" row.\n\nYou can also clear all Error[4] rows in case it's all false positives you need to clean upo.\n\nYou can also type in \"nuke\" to clear all cells in all rows. (Caution: This can not be undone.)\n\nYou can type in \"cwrapable\" to copy Original Texts[0] into Initial Translations[0] if they match wrapable contexts. (Will skip if the cells 1,2,3, or 4 are filled.)\n\nYou can type in \"ceverything\" to copy Original Texts[0] into Initial Translations[0] regardless of context. (Will still skip if cell 1,2,3, or 4 are filled.)\n\nYou can change the default wrap value in the options menu.", "default");
    if (wrapPrompt == null) {
        PCancelled = "Yes";
    } else {
        PCancelled = "No"
    }
    if (wrapPrompt > 0) {
        if (wrapPrompt > 5) {
            var pwrapPrompt = parseInt(wrapPrompt) - 4;
        } else {
            var pwrapPrompt = parseInt(wrapPrompt);
        }
        wordWrapNoPicture = parseInt(wrapPrompt) * japaneseLength;
        wordWrapPicture = parseInt(pwrapPrompt) * japaneseLength;
    }
    switch (wrapPrompt) {
        case "stint" || "STINT" || "Stint":
            wordWrapNoPicture = parseInt(52) * japaneseLength;
            wordWrapPicture = parseInt(46) * japaneseLength;
            break;
        case "pstint" || "PSTINT" || "PStint":
            wordWrapNoPicture = parseInt(46) * japaneseLength;
            wordWrapPicture = parseInt(46) * japaneseLength;
            break;
        case "size" || "SIZE" || "Size":
            wordWrapNoPicture = parseInt(40) * japaneseLength;
            wordWrapPicture = parseInt(36) * japaneseLength;
            break;
        case "psize" || "PSIZE" || "PSize":
            wordWrapNoPicture = parseInt(36) * japaneseLength;
            wordWrapPicture = parseInt(36) * japaneseLength;
            break;
        case "clear" || "CLEAR" || "Clear":
            clearwrapped()
            PCancelled = "Yes";
            break;
        case "nuke" || "NUKE" || "Nuke":
            nukeitall()
            PCancelled = "Yes";
            break;
        case "ignoreallerrors" || "IGNOREALLERRORS" || "IgnoreAllErrors":
            ignoreallerrors()
            PCancelled = "Yes";
            break;
        case "cwrapable" || "CWRAPABLE" || "Cwrapable"|| "CWrapable"|| "cWrapable":
            copyWrapableText()
            PCancelled = "Yes";
            break;
        case "ceverything" || "CEVERYTHING" || "Ceverything"|| "CEverything"|| "ceverything":
            copyEverythingforWrap()
            PCancelled = "Yes";
            break;
        default:
            break;
    }
}

function clearwrapped() {
    let files = trans.getAllFiles();
            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                let data = trans.project.files[file].data;
                let contexts = trans.project.files[file].context;
                for (let k = 0; k < data.length; k++) {
                    let row = data[k];
                    let context = contexts[k];
                    if (context == undefined || row == undefined || context.length == 0 || row[3] == undefined || row[3] == "")
                        continue;
                    trans.project.files[file].data[k][3] = "";
                }
            }
}

function nukeitall() {
    let files = trans.getAllFiles();
            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                let data = trans.project.files[file].data;
                let contexts = trans.project.files[file].context;
                for (let k = 0; k < data.length; k++) {
                    let row = data[k];
                    let context = contexts[k];
                    if (context == undefined || row == undefined || context.length == 0)
                        continue;
                    trans.project.files[file].data[k][1] = "";
                    trans.project.files[file].data[k][2] = "";
                    trans.project.files[file].data[k][3] = "";
                    trans.project.files[file].data[k][4] = "";
                    trans.project.files[file].data[k][5] = "";
                }
            }
}
function ignoreallerrors() {
    let files = trans.getAllFiles();
            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                let data = trans.project.files[file].data;
                let contexts = trans.project.files[file].context;
                for (let k = 0; k < data.length; k++) {
                    let row = data[k];
                    let context = contexts[k];
                    if (context == undefined || row == undefined || context.length == 0)
                        continue;
                    trans.project.files[file].data[k][4] = "";
                }
            }
}
function copyWrapableText() {
    let files = trans.getAllFiles();
            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                let data = trans.project.files[file].data;
                let contexts = trans.project.files[file].context;
                for (let k = 0; k < data.length; k++) {
                    let row = data[k];
                    let context = contexts[k];
                    if (context == undefined || row == undefined || context.length == 0)
                        continue;
                    let contextString = context.join().toLowerCase();
                    let ncontextString = context.join();
                    let wrappablecells = new RegExp(`(${thisAddon.config[thisAddonOptions.wrappablecells].split(",").join(")|(")})`);
                    if (contextString.match(/parameters\/quest\s*\d+\/json\//gi) == null && contextString.match(/parameters\/baseAchievementData\/.*?json.*?\//gi) == null) {
                        if (contextString.match(wrappablecells) != null || ncontextString.match(wrappablecells) != null) {
                            if (trans.project.files[file].data[k][1] == "" || trans.project.files[file].data[k][1] == undefined) {
                                if (trans.project.files[file].data[k][2] == "" || trans.project.files[file].data[k][2] == undefined) {
                                    if (trans.project.files[file].data[k][3] == "" || trans.project.files[file].data[k][3] == undefined) {
                                        if (trans.project.files[file].data[k][4] == "" || trans.project.files[file].data[k][4] == undefined) {
                                            trans.project.files[file].data[k][1] = trans.project.files[file].data[k][0];
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
}
function copyEverythingforWrap() {
    let files = trans.getAllFiles();
            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                let data = trans.project.files[file].data;
                let contexts = trans.project.files[file].context;
                for (let k = 0; k < data.length; k++) {
                    let row = data[k];
                    let context = contexts[k];
                    if (context == undefined || row == undefined || context.length == 0)
                        continue;
                    if (trans.project.files[file].data[k][1] == "" || trans.project.files[file].data[k][1] == undefined) {
                        if (trans.project.files[file].data[k][2] == "" || trans.project.files[file].data[k][2] == undefined) {
                            if (trans.project.files[file].data[k][3] == "" || trans.project.files[file].data[k][3] == undefined) {
                                if (trans.project.files[file].data[k][4] == "" || trans.project.files[file].data[k][4] == undefined) {
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][0];
                                }
                            }
                        }
                    }
                }
            }
}

function getPadAtLine(line) {
    if (line === undefined) {
        return "";
    }
    let match = line.match(/^\s+/);
    if (match !== null) {
        return match[0];
    } else {
        return "";
    }
}
/* function equatePad (origin : string, translation : string) {
    let splitTranslation = translation.split(/\r?\n/g);
    let splitOrigin = origin.split(/\r?\n/g);

    for (let line = 0; line < splitTranslation.length; line++) {
        splitTranslation[line] = getPadAtLine(splitOrigin, line) + splitTranslation[line].trim();
    }

    return splitTranslation.join("\n");
} */
let sizes = {};

function getSize(text) {
    if (sizes[text] == undefined) {
        sizes[text] = measureTextPxWidth(text);
    }
    return sizes[text];
}

function isTrue(value) {
    return (value === "1" || value === "true" || value === 1 || value === true);
}

function isValidSentenceBreak(text, breakIndex, punctuation) {
    if (breakIndex === -1) return false;
    
    // For periods, check if it's part of an ellipsis or abbreviation
    if (punctuation === ". ") {
        // Check if there are multiple dots before this period (ellipsis)
        let beforePeriod = text.substring(Math.max(0, breakIndex - 2), breakIndex);
        if (beforePeriod === "..") {
            // This is the third dot of an ellipsis, don't break here
            return false;
        }
        // Check if there are multiple dots after this period (ellipsis)
        let afterPeriod = text.substring(breakIndex + 2, Math.min(breakIndex + 5, text.length));
        if (afterPeriod.startsWith("..")) {
            // This is the first dot of an ellipsis, don't break here
            return false;
        }
        
        // Check if this period is part of a common abbreviation
        // Get the text before the period (up to 3 characters)
        let prefix = text.substring(Math.max(0, breakIndex - 3), breakIndex).toLowerCase();
        
        // List of common abbreviations that should not be treated as sentence breaks
        const abbreviations = [
            'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 
            'gen', 'col', 'capt', 'lt', 'sgt', 'st',
            'ave', 'blvd', 'rd', 'jr', 'sr', 'phd',
            'etc', 'vs', 'eg', 'ie', 'approx', 'est',
            'no', 'tel', 'fax', 'co', 'ltd', 'inc',
            'dept', 'sec', 'min', 'max', 'fig', 'ref',
            'ct'
        ];
        
        // Check if the prefix matches any abbreviation (with or without preceding space)
        for (let abbr of abbreviations) {
            if (prefix === abbr || prefix.endsWith(' ' + abbr)) {
                return false; // This is an abbreviation, not a sentence break
            }
        }
    }
    
    return true;
}

function wrapTo(text, length, mergeWithNext) {
    let lines = text.split(/\r?\n/g);
    let newLines = [];
    let lucky10 = length / 10;
    let lucky13 = length / 13;
    let lucky15 = length / 15;
    let lucky20 = length / 20;
    let lucky55 = length / 55;
    let closestSpace = -1;
    for (let i = 0; i < lines.length; i++) {
        let currentSize = 0;
        let originalPad = getPadAtLine(lines[i]);
        let nextPad = getPadAtLine(lines[i + 1]);
        if (nextPad.length < originalPad.length) {
            nextPad = originalPad;
        }
        let padSize = getSize(nextPad);
        if (padSize >= length / 2) {
            // the pad is too large for us to work with
            nextPad = "  ";
        }
        let charAt;
        for (charAt = 0; charAt < lines[i].length; charAt++) {
            if (thisAddon.config[thisAddonOptions.replaceCommands] != '' && thisAddon.config[thisAddonOptions.replaceCommands] != undefined) {
                let textCommands = thisAddon.config[thisAddonOptions.textCommands].split('\n');
                let replaceCommands = thisAddon.config[thisAddonOptions.replaceCommands].split('\n');
                // Replace Text Command codes while skipping them
                let textCommand = false;
                for (let code = 0; code < textCommands.length; code++) {
                    let regex = '^' + textCommands[code].replace("\\","\\\\").replace("SHISAYE_INT", "(\\d+)").replace("[","\\[").replace("]","\\]");
                    let textMatch = lines[i].substring(charAt).match(regex);
                    if (textMatch != null) {
                        let textIndex = textMatch[1];
                        let textList = [];
                        if (code < replaceCommands.length) {
                            textList = replaceCommands[code].split(',');
                        }
                        if (textIndex < textList.length) {
                            currentSize += getSize(textList[textIndex]);
                        }
                        charAt += textMatch[0].length - 1;
                        textCommand = true;
                        break;
                    }
                }
                if (textCommand == false) {
                    currentSize += getSize(lines[i].charAt(charAt));
                }
            } else {
                currentSize += getSize(lines[i].charAt(charAt));
            }
            if (currentSize > length) {
                break;
            }
        }
        if (currentSize > length) {
            let closest1 = lines[i].lastIndexOf(". ", charAt);
            let closest2 = lines[i].lastIndexOf("! ", charAt);
            let closest3 = lines[i].lastIndexOf("? ", charAt);
            let closest4 = lines[i].lastIndexOf(", ", charAt);
            
            // Validate break points to avoid breaking within ellipses
            let validClosest1 = isValidSentenceBreak(lines[i], closest1, ". ") ? closest1 : -1;
            let validClosest2 = isValidSentenceBreak(lines[i], closest2, "! ") ? closest2 : -1;
            let validClosest3 = isValidSentenceBreak(lines[i], closest3, "? ") ? closest3 : -1;
            let validClosest4 = isValidSentenceBreak(lines[i], closest4, ", ") ? closest4 : -1;
            
            if (currentSize / 1.1 < length && Math.max(validClosest1, validClosest2, validClosest3) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3) > lucky55) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3);
            } else if (currentSize / 1.1 < length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > lucky55) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3, validClosest4);
            } else if (currentSize / 1.5 < length && Math.max(validClosest1, validClosest2, validClosest3) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3) > lucky20) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3);
            } else if (currentSize / 1.5 < length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > lucky20) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3, validClosest4);
            } else if (currentSize / 2.0 < length && Math.max(validClosest1, validClosest2, validClosest3) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3) > lucky15) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3);
            } else if (currentSize / 2.0 < length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > lucky15) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3, validClosest4);
            } else if (currentSize / 2.5 < length && Math.max(validClosest1, validClosest2, validClosest3) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3) > lucky13) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3);
            } else if (currentSize / 2.5 < length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > lucky13) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3, validClosest4);
            } else if (Math.max(validClosest1, validClosest2, validClosest3) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3) > lucky10) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3);
            } else if (Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > originalPad.length && Math.max(validClosest1, validClosest2, validClosest3, validClosest4) > lucky10) {
                closestSpace = Math.max(validClosest1, validClosest2, validClosest3, validClosest4);
            } else {
                closestSpace = lines[i].lastIndexOf(" ", charAt);
                if (closestSpace <= originalPad.length) {
                    closestSpace = lines[i].lastIndexOf("　", charAt);
                    if (closestSpace <= originalPad.length) {
                        closestSpace = "itsfuckedyall";
                        //alert("The system was unable to find a suitable spot for a line break in this line:\n\n" + lines[i]);
                    }
                }
            }
            if (closestSpace != "itsfuckedyall") {
            newLines.push(lines[i].substring(0, closestSpace));
            if (charAt < lines[i].length) {
                if (mergeWithNext || isTrue(thisAddon.config[thisAddonOptions.alwaysMerge])) {
                    if (lines[i + 1] === undefined) {
                        lines[i + 1] = "";
                    }
                    lines[i + 1] = nextPad + lines[i].substring(closestSpace).trim() + " " + lines[i + 1].trim();
                } else {
                    lines[i] = nextPad + lines[i--].substring(closestSpace).trim();
                }
            }
            }
            else {
                newLines.push(lines[i]);
            }
        } else {
            newLines.push(lines[i]);
        }
    }
    return newLines.join("\n");
}
$(document).ready(() => {
    trans.RedBatchTranslatorInstance = new RedBatchTranslator();
    // The labelled workflow group lives in www/trans.html. Fall back to creating
    // it (against the top toolbar) so an older markup copy still works.
    let buttonContainer = document.querySelector('.toolbar-content[data-id="toolbar-workflow"]');
    if (!buttonContainer) {
        let toolbarContainer = document.body.getElementsByClassName("toolbar mainToolbar")[0];
        buttonContainer = document.createElement("div");
        buttonContainer.className = "toolbar-content toolbar-workflow";
        buttonContainer.setAttribute("data-id", "toolbar-workflow");
        buttonContainer.setAttribute("data-responsive-labels", "true");
        toolbarContainer.appendChild(buttonContainer);
    }
    //Uncomment this and one other part further down if you want an extra button to run stuff when the in-tool custom script stuff doesn't work for whatever reason.
/*     let debugButton = new RedButtonManagerButton("debugProject", "icon-commenting", "Run code without the broken custom script system", () => {
        trans.debugScript.debugCells();
    }); */
    
    let translateButton = new BlueButtonManagerButton("batchTranslate", "icon-language-1", "Start Translation\nTranslate the whole project in one go - this is the main translation step.\n(The actual translation process.)", () => {
        trans.RedBatchTranslatorInstance.open();
    }, {
        id: "batchTranslate",
        className: "batch-translate",
        label: "Start Translation",
        shortLabel: "Translate",
        priority: 0,
        essential: true
    });
    let wrapButton = new BlackButtonManagerButton("wrapProject", "icon-commenting", "Automatic Word Wrapping\n(Only works with English in column 1 and 2, and will replace column 3.)", () => {
        updateValues();
        ui.loadingProgress(0, "");
        ui.showLoading2();
        ui.loadingProgress(0, "");
        ui.log("Processing...");
        setTimeout(() => {
        let mergeable = new RegExp(`(${thisAddon.config[thisAddonOptions.mergeContexts].split(",").join(")|(")})`);
        let wrappableLong = new RegExp(`(${thisAddon.config[thisAddonOptions.longContexts].split(",").join(")|(")})`);
        let wrappableShort = new RegExp(`(${thisAddon.config[thisAddonOptions.shortContexts].split(",").join(")|(")})`);
        let files = trans.getAllFiles();
        let WasWrappedNormally = "No";
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            console.log("Wrapping " + file + " - Progress: " + (i + 1) + "/" + files.length);
            let data = trans.project.files[file].data;
            let contexts = trans.project.files[file].context;
            for (let k = 0; k < data.length; k++) {
                let row = data[k];
                let context = contexts[k];
                // Skip empty / untranslated lines
                if (context == undefined || row == undefined || context.length == 0)
                    continue;
                if (PCancelled == "Yes")
                    continue;
                //Skip wrapping if Overwrite cell is filled
                if (row[4] != undefined && row[4] != "" && row[4] != null)
                    continue;
                if (row[2] != undefined && row[2] != "" && row[2] != null) {
                    WasWrappedNormally = "No";
                    let contextString = context.join().toLowerCase();
                    let ncontextString = context.join();
                    if (contextString.match(/parameters\/quest\s*\d+\/json\//gi) == null && contextString.match(/line\/\d+\/Show.Choices/gi) == null && contextString.match(/parameters\/baseAchievementData\/.*?json.*?\//gi) == null && contextString.match(/JSON\/NameInputMessage/gi) == null) {
                        let shouldMerge = contextString.match(mergeable) != null;
                        if (contextString.match(wrappableLong) != null || ncontextString.match(wrappableLong) != null) {
                            let Beforewrapmod = trans.project.files[file].data[k][2];
                            if (trans.project.files[file].data[k][0].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null && trans.project.files[file].data[k][2].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null) {
                                while (trans.project.files[file].data[k][2].match(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g) != null) {
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g, "$1SHISAYESPC$2")
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/[ ]*SHISAYESPC[ ]*(?=[」』）｣]|$)/gmi, "");
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/[ ]*SHISAYESPC[ ]*([─~\-<>\|\/！？。・…‥：；、.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´\*◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]+)$/gmi, "$1");
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/[ ]*SHISAYESPC[ ]*([^」』）｣])/gmi, " $1");
                                }
                            }
                            trans.project.files[file].data[k][3] = wrapTo(row[2], wordWrapNoPicture, shouldMerge);
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\S+\s*?)[\r\n]+$/g, "$1");
                            trans.project.files[file].data[k][2] = Beforewrapmod;
                            WasWrappedNormally = "Yes";
                        } else if (contextString.match(wrappableShort) != null || ncontextString.match(wrappableShort) != null) {
                            let Beforewrapmod = trans.project.files[file].data[k][2];
                            if (trans.project.files[file].data[k][0].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null && trans.project.files[file].data[k][2].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null) {
                                while (trans.project.files[file].data[k][2].match(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g) != null) {
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g, "$1SHISAYESPC$2")
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/[ ]*SHISAYESPC[ ]*(?=[」』）｣]|$)/gmi, "");
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/[ ]*SHISAYESPC[ ]*([─~\-<>\|\/！？。・…‥：；、.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´\*◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]+)$/gmi, "$1");
                                    trans.project.files[file].data[k][2] = trans.project.files[file].data[k][2].replaceAll(/[ ]*SHISAYESPC[ ]*([^」』）｣])/gmi, " $1");
                                }
                            }
                            trans.project.files[file].data[k][3] = wrapTo(row[2], wordWrapPicture, shouldMerge);
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\S+\s*?)[\r\n]+$/g, "$1");
                            trans.project.files[file].data[k][2] = Beforewrapmod;
                            WasWrappedNormally = "Yes";
                        }
                    }
                } else if (row[1] != undefined && row[1] != "" && row[1] != null) {
                    WasWrappedNormally = "No";
                    let contextString = context.join().toLowerCase();
                    let ncontextString = context.join();
                    if (contextString.match(/parameters\/quest\s*\d+\/json\//gi) == null && contextString.match(/line\/\d+\/Show.Choices/gi) == null && contextString.match(/parameters\/baseAchievementData\/.*?json.*?\//gi) == null && contextString.match(/JSON\/NameInputMessage/gi) == null) {
                        let shouldMerge = contextString.match(mergeable) != null;
                        if (contextString.match(wrappableLong) != null || ncontextString.match(wrappableLong) != null) {
                            let Beforewrapmod = trans.project.files[file].data[k][1];
                            if (trans.project.files[file].data[k][0].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null && trans.project.files[file].data[k][1].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null) {
                                while (trans.project.files[file].data[k][1].match(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g) != null) {
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g, "$1SHISAYESPC$2")
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/[ ]*SHISAYESPC[ ]*(?=[」』）｣]|$)/gmi, "");
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/[ ]*SHISAYESPC[ ]*([─~\-<>\|\/！？。・…‥：；、.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´\*◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]+)$/gmi, "$1");
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/[ ]*SHISAYESPC[ ]*([^」』）｣])/gmi, " $1");
                                }
                            }
                            trans.project.files[file].data[k][3] = wrapTo(row[1], wordWrapNoPicture, shouldMerge);
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\S+\s*?)[\r\n]+$/g, "$1");
                            trans.project.files[file].data[k][1] = Beforewrapmod;
                            WasWrappedNormally = "Yes";
                        } else if (contextString.match(wrappableShort) != null || ncontextString.match(wrappableShort) != null) {
                            let Beforewrapmod = trans.project.files[file].data[k][1];
                            if (trans.project.files[file].data[k][0].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null && trans.project.files[file].data[k][1].match(/(?:^.*\n[　 ]*[｢（「『]|^[　 ]*[｢（「『])|[｣）」』]\s*$/g) != null) {
                                while (trans.project.files[file].data[k][1].match(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g) != null) {
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/^(.*\n?[　 ]*[｢（「『][\s\S]*?)[　 ]*\n[　 ]*([\s\S]*[｣）」』]\s*)$/g, "$1SHISAYESPC$2")
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/[ ]*SHISAYESPC[ ]*(?=[」』）｣]|$)/gmi, "");
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/[ ]*SHISAYESPC[ ]*([─~\-<>\|\/！？。・…‥：；、.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´\*◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]+)$/gmi, "$1");
                                    trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/[ ]*SHISAYESPC[ ]*([^」』）｣])/gmi, " $1");
                                }
                            }
                            trans.project.files[file].data[k][3] = wrapTo(row[1], wordWrapPicture, shouldMerge);
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\S+\s*?)[\r\n]+$/g, "$1");
                            trans.project.files[file].data[k][1] = Beforewrapmod;
                            WasWrappedNormally = "Yes";
                        }
                    }
                }
                //Check if stuff has less lines than the original cells and try to fix it
                if (row[4] == undefined || row[4] == "" || row[4] == null) {
                    let row0noemptylines = trans.project.files[file].data[k][0].replaceAll(/[\n][\n]+/gmi, "");
                    row0noemptylines = row0noemptylines.replaceAll(/[\n]$/gmi, "");
                    let row0count = row0noemptylines.split(/\r\n|\r|\n/).length;
                    let row0lines = row0noemptylines.split(/\r\n|\r|\n/);
                    let row0noemptynocommands = row0noemptylines
                    row0noemptynocommands = row0noemptynocommands.replaceAll(/^\\ow\[\d+\]/g, "");
                    row0noemptynocommands = row0noemptynocommands.replaceAll(/\\c\[\d+\]/gi, "");
                    let contextString = context.join().toLowerCase();
                    //For stuff in row 2 if there is stuff in row 2
                    if (row[2] != undefined && row[2] != "" && row[2] != null) {
                        let row2count = trans.project.files[file].data[k][2].split(/\r\n|\r|\n/).length;
                        if (row0count > row2count) {
                            let wrapattempt = trans.project.files[file].data[k][2];
                            //command stuff at the start of lines
                            if (row0noemptylines.match(/^[ 　]*\\/gmi) != null && row0noemptylines.match(/^[ 　]*\\.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+.*\\/gmi) == null && row0noemptylines.match(/^[ 　]*[^ 　\\]/gmi) == null) {
                                wrapattempt = wrapattempt.replaceAll(/[\r\n]+/gm, " ");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/g, "");
                                if (trans.project.files[file].data[k][0].match(/^[ 　]*\\[\w_]\[[\w_]+\]/gmi) != null) {
                                    let wraplinecounter = 0;
                                    let wraplinecounter2 = 0;
                                    let thingcounter = 1;
                                    let wrapprogress = "";
                                    let regexvar = '^()(.*?)\\\\';
                                    while (wraplinecounter2 < row0count) {
                                        wraplinecounter2 = wraplinecounter2 + 1;
                                        let row0thingcount = row0lines[wraplinecounter].split(/\\[\w_]\[[\w_]+\]/).length;
                                        wraplinecounter = wraplinecounter + 1;
                                        while (thingcounter < row0thingcount) {
                                            thingcounter = thingcounter + 1;
                                            regexvar = regexvar.replaceAll(/(\)\(\.\*\?\))\\\\/gi, "[ 　]*\\\\+[\\w_]+\\[[\\w_]+\\][^\\w\\n\\r]*$1\\\\");
                                        }
                                        thingcounter = 1;
                                        wrapattempt = wrapattempt.replaceAll(new RegExp(regexvar, "gi"), "$1$2\n\\");
                                        regexvar = '^()(.*?)\\\\';
                                        let wrapattemptsplit = wrapattempt.split(/\r\n|\r|\n/);
                                        if (wrapattempt.match(/\n/gim) != null) {
                                            wrapprogress = wrapprogress + "\n" + wrapattemptsplit[0];
                                            wrapattempt = wrapattemptsplit[1];
                                        }
                                        else {
                                            wrapprogress = wrapprogress + "\n" + wrapattempt;
                                        }
                                        }
                                    wrapprogress = wrapprogress.replaceAll(/^\s+/g, "");
                                    wrapattempt = wrapprogress;
                                }
                                else if (trans.project.files[file].data[k][0].match(/^[ 　]*\\[a-z]+[ 　]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/gmi) != null) {
                                    wrapattempt = wrapattempt.replaceAll(/(\\[a-z])/gi, "\n$1");
                                }
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                                wrapattempt = wrapattempt.replaceAll(/^\n/g, "");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                            }
                            //Single variables at the end of lines
                            else if (row0noemptylines.match(/\\v\[\d+\][　 回mlkgｋｇGＧｍｌ＄％$%#€]*$/gmi) != null && row0noemptylines.match(/\\v\[\d+\].*\\v\[\d+\]/gmi) == null && row0noemptylines.match(/[^v\\\[\]　 回mlkgｋｇGＧｍｌ＄％$%#€]+$/gmi) == null) {
                                wrapattempt = wrapattempt.replaceAll(/[\r\n]+/gm, " ");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/g, "");
                                wrapattempt = wrapattempt.replaceAll(/((?:\\v\[\d+\][ 　]*ct)|(?:\\v\[\d+\][ 　]*ml)|(?:\\v\[\d+\][ 　]*$)|(?:\\v\[\d+\][ 　]*kg)|(?:\\v\[\d+\][ 　]*g)|(?:\\v\[\d+\][ 　]*G)|(?:\\v\[\d+\][ 　]*$)|(?:\\v\[\d+\][ 　]*€)|(?:\\v\[\d+\][ 　]*%)|(?:\\v\[\d+\][ 　]*回)|(?:\\v\[\d+\][ 　]*％)|(?:\\v\[\d+\][ 　]*Ｇ)|(?:\\v\[\d+\][ 　]*ｍｌ)|(?:\\v\[\d+\][ 　]*ｇ)|(?:\\v\[\d+\][ 　]*ｋｇ)|(?:\\v\[\d+\][ 　]*(?=[^ 　回mlkgｋｇGＧｍｌ＄％$%#€])))/gm, "\n$1");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                                wrapattempt = wrapattempt.replaceAll(/^\n/g, "");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                            }
                            if (row0count == wrapattempt.split(/\r\n|\r|\n/).length) {
                                trans.project.files[file].data[k][3] = wrapattempt;
                                slrUnflagTag(file, k, "indigo");
                            }
                            else if (row0noemptynocommands.match(/[\\\[\]\(\)\{\}\$\=\/\'\"\´\`]/gmi) == null && row0noemptynocommands.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/gmi) != null && WasWrappedNormally == "No") {
                                let shouldMerge = contextString.match(mergeable) != null;
                                trans.project.files[file].data[k][3] = wrapTo(row[2], wordWrapNoPicture, shouldMerge);
                            }
                            else if (WasWrappedNormally == "No") {
                                // Wrap-failure indigo flag. Array-aware: adds only
                                // `indigo` and leaves the row's other tags (purple,
                                // the QC tag, red, …) untouched.
                                slrFlagTag(file, k, "indigo");
                            }
                        }
                    }
                    //For stuff in row 1 if there is stuff in row 1 and nothing in row 2
                    else if (row[1] != undefined && row[1] != "" && row[1] != null) {
                        let row1count = trans.project.files[file].data[k][1].split(/\r\n|\r|\n/).length;
                        if (row0count > row1count) {
                            let wrapattempt = trans.project.files[file].data[k][1];
                            //command stuff at the start of lines
                            if (row0noemptylines.match(/^[ 　]*\\/gmi) != null && row0noemptylines.match(/^[ 　]*\\.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+.*\\/gmi) == null && row0noemptylines.match(/^[ 　]*[^ 　\\]/gmi) == null) {
                                wrapattempt = wrapattempt.replaceAll(/[\r\n]+/gm, " ");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/g, "");
                                if (trans.project.files[file].data[k][0].match(/^[ 　]*\\[\w_]\[[\w_]+\]/gmi) != null) {
                                    let wraplinecounter = 0;
                                    let wraplinecounter2 = 0;
                                    let thingcounter = 1;
                                    let wrapprogress = "";
                                    let regexvar = '^()(.*?)\\\\';
                                    while (wraplinecounter2 < row0count) {
                                        wraplinecounter2 = wraplinecounter2 + 1;
                                        let row0thingcount = row0lines[wraplinecounter].split(/\\[\w_]\[[\w_]+\]/).length;
                                        wraplinecounter = wraplinecounter + 1;
                                        while (thingcounter < row0thingcount) {
                                            thingcounter = thingcounter + 1;
                                            regexvar = regexvar.replaceAll(/(\)\(\.\*\?\))\\\\/gi, "[ 　]*\\\\+[\\w_]+\\[[\\w_]+\\][^\\w\\n\\r]*$1\\\\");
                                        }
                                        thingcounter = 1;
                                        wrapattempt = wrapattempt.replaceAll(new RegExp(regexvar, "gi"), "$1$2\n\\");
                                        regexvar = '^()(.*?)\\\\';
                                        let wrapattemptsplit = wrapattempt.split(/\r\n|\r|\n/);
                                        if (wrapattempt.match(/\n/gim) != null) {
                                            wrapprogress = wrapprogress + "\n" + wrapattemptsplit[0];
                                            wrapattempt = wrapattemptsplit[1];
                                        }
                                        else {
                                            wrapprogress = wrapprogress + "\n" + wrapattempt;
                                        }
                                        }
                                    wrapprogress = wrapprogress.replaceAll(/^\s+/g, "");
                                    wrapattempt = wrapprogress;
                                }
                                else if (trans.project.files[file].data[k][0].match(/^[ 　]*\\[a-z]+[ 　]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/gmi) != null) {
                                    wrapattempt = wrapattempt.replaceAll(/(\\[a-z])/gi, "\n$1");
                                }
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                                wrapattempt = wrapattempt.replaceAll(/^\n/g, "");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                            }
                            //Single variables at the end of lines
                            else if (row0noemptylines.match(/\\v\[\d+\][　 回mlkgｋｇGＧｍｌ＄％$%#€]*$/gmi) != null && row0noemptylines.match(/\\v\[\d+\].*\\v\[\d+\]/gmi) == null && row0noemptylines.match(/[^v\\\[\]　 回mlkgｋｇGＧｍｌ＄％$%#€]+$/gmi) == null) {
                                wrapattempt = wrapattempt.replaceAll(/[\r\n]+/gm, " ");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/g, "");
                                wrapattempt = wrapattempt.replaceAll(/((?:\\v\[\d+\][ 　]*ct)|(?:\\v\[\d+\][ 　]*ml)|(?:\\v\[\d+\][ 　]*$)|(?:\\v\[\d+\][ 　]*kg)|(?:\\v\[\d+\][ 　]*g)|(?:\\v\[\d+\][ 　]*G)|(?:\\v\[\d+\][ 　]*$)|(?:\\v\[\d+\][ 　]*€)|(?:\\v\[\d+\][ 　]*%)|(?:\\v\[\d+\][ 　]*回)|(?:\\v\[\d+\][ 　]*％)|(?:\\v\[\d+\][ 　]*Ｇ)|(?:\\v\[\d+\][ 　]*ｍｌ)|(?:\\v\[\d+\][ 　]*ｇ)|(?:\\v\[\d+\][ 　]*ｋｇ)|(?:\\v\[\d+\][ 　]*(?=[^ 　回mlkgｋｇGＧｍｌ＄％$%#€])))/gm, "\n$1");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                                wrapattempt = wrapattempt.replaceAll(/^\n/g, "");
                                wrapattempt = wrapattempt.replaceAll(/^[ 　]+/gm, "");
                            }
                            if (row0count == wrapattempt.split(/\r\n|\r|\n/).length) {
                                trans.project.files[file].data[k][3] = wrapattempt;
                                slrUnflagTag(file, k, "indigo");
                            }
                            else if (row0noemptynocommands.match(/[\\\[\]\(\)\{\}\$\=\/\'\"\´\`]/gmi) == null && row0noemptynocommands.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/gmi) != null && WasWrappedNormally == "No") {
                                let shouldMerge = contextString.match(mergeable) != null;
                                trans.project.files[file].data[k][3] = wrapTo(row[1], wordWrapNoPicture, shouldMerge);
                            }
                            else if (WasWrappedNormally == "No") {
                                // Wrap-failure indigo flag. Array-aware: adds only
                                // `indigo` and leaves the row's other tags (purple,
                                // the QC tag, red, …) untouched.
                                slrFlagTag(file, k, "indigo");
                            }
                        }
                    }
                }
                //Put punctuation in the right line again after using it as guide for wrapping.
                if (row[3] != undefined && row[3] != "" && row[3] != null) {
                    trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(.+?)[ 　]*([\r\n]+)[ 　]*([,!?]+[ 　]*)/g, "$1$3$2");
                    trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(.+?)(?<![ 　]mr|[ 　]mrs|[ 　]ms|[ 　]dr|[ 　]prof|[ 　]rev|[ 　]gen|[ 　]col|[ 　]capt|[ 　]lt|[ 　]sgt|[ 　]st|[ 　]ave|[ 　]blvd|[ 　]rd|[ 　]jr|[ 　]sr|[ 　]phd|[ 　]etc|[ 　]vs|[ 　]eg|[ 　]ie|[ 　]approx|[ 　]est|[ 　]no|[ 　]tel|[ 　]fax|[ 　]co|[ 　]ltd|[ 　]inc|[ 　]dept|[ 　]sec|[ 　]min|[ 　]max|[ 　]fig|[ 　]ref|[ 　]ct)[ 　]*([\r\n]+)[ 　]*((?<!\.)[\.](?!\.)[ 　]*)/gi, "$1$3$2");
                    trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(.+?)[ 　]*([\r\n]+)[ 　]*([\.]+[^\w]*)\s*$/g, "$1$3$2");
                }
                if (row[3] != undefined && row[3] != "" && row[3] != null) {
                    //Make sure stuff that should start with \> starts with \> 
                    if (trans.project.files[file].data[k][0].match(/^[ 　]*\\+>/gm) != null && trans.project.files[file].data[k][0].match(/\\+>.*\\+>/gi) == null && trans.project.files[file].data[k][0].match(/^[ 　]*[^ 　\\]/gim) == null) {
                        if (trans.project.files[file].data[k][3].match(/^[ 　]*[^ 　\\]/gim) != null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/\\>/gim, "");
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gim, "\\>$1");
                        }
                    }
                            
                    //Preserve or remove whitespace, but not more than 5 and not on single lines
                    if (trans.project.files[file].data[k][0].match(/^[　]/gm) != null && trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+/g) != null) {
                        let origwhite1 = 0;
                        let origwhite2 = 0;
                        let origwhite3 = 0;
                        let origwhite4 = 0;
                        if (trans.project.files[file].data[k][0].match(/^[　]/g) != null) {
                            origwhite1 = trans.project.files[file].data[k][0].replaceAll(/^([　]+)[\s\S]*/g, "$1");
                            origwhite1 = origwhite1.length;
                        }
                        if (trans.project.files[file].data[k][0].match(/^.+[\r\n]+[　]/g) != null) {
                            origwhite2 = trans.project.files[file].data[k][0].replaceAll(/^.+?[\r\n]+([　]+)[\s\S]*/g, "$1");
                            origwhite2 = origwhite2.length;
                        }
                        if (trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+[\r\n]+[　]/g) != null) {
                            origwhite3 = trans.project.files[file].data[k][0].replaceAll(/^.+?[\r\n]+.+?[\r\n]+([　]+)[\s\S]*/g, "$1");
                            origwhite3 = origwhite3.length;
                        }
                        if (trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+[\r\n]+.+[\r\n]+[　]/g) != null) {
                            origwhite4 = trans.project.files[file].data[k][0].replaceAll(/^.+?[\r\n]+.+?[\r\n]+.+?[\r\n]+([　]+)[\s\S]*/g, "$1");
                            origwhite4 = origwhite4.length;
                        }
                        if (origwhite2 > 0 && trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+[\r\n]+.+[\r\n]+.+$/g) != null && origwhite1 == origwhite2 && origwhite2 == origwhite3 && origwhite3 == origwhite4) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^[　 ]+/gm, "");
                            if (origwhite2 == 1) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　$1");
                            } else if (origwhite2 == 2) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　$1");
                            } else if (origwhite2 == 3) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　$1");
                            } else if (origwhite2 == 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　　$1");
                            } else if (origwhite2 > 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　　　$1");
                            }
                        } else if (origwhite2 > 0 && trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+[\r\n]+.+$/g) != null && origwhite1 == origwhite2 && origwhite2 == origwhite3) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^[　 ]+/gm, "");
                            if (origwhite2 == 1) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　$1");
                            } else if (origwhite2 == 2) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　$1");
                            } else if (origwhite2 == 3) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　$1");
                            } else if (origwhite2 == 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　　$1");
                            } else if (origwhite2 > 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　　　$1");
                            }
                        } else if (origwhite2 > 0 && trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+$/g) != null && origwhite1 == origwhite2) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^[　 ]+/gm, "");
                            if (origwhite2 == 1) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　$1");
                            } else if (origwhite2 == 2) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　$1");
                            } else if (origwhite2 == 3) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　$1");
                            } else if (origwhite2 == 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　　$1");
                            } else if (origwhite2 > 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.)/gm, "　　　　　$1");
                            }
                        } else if (origwhite2 > 0 && trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+[\r\n]+.+[\r\n]+.+$/g) != null && origwhite1 != origwhite2 && origwhite2 == origwhite3 && origwhite3 == origwhite4) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^[　 ]+/gm, "");
                            if (origwhite2 == 1) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　");
                            } else if (origwhite2 == 2) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　");
                            } else if (origwhite2 == 3) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　　");
                            } else if (origwhite2 == 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　　　");
                            } else if (origwhite2 > 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　　　　");
                            }
                        } else if (origwhite2 > 0 && trans.project.files[file].data[k][0].match(/^.+[\r\n]+.+[\r\n]+.+$/g) != null && origwhite1 != origwhite2 && origwhite2 == origwhite3) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^[　 ]+/gm, "");
                            if (origwhite2 == 1) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　");
                            } else if (origwhite2 == 2) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　");
                            } else if (origwhite2 == 3) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　　");
                            } else if (origwhite2 == 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　　　");
                            } else if (origwhite2 > 4) {
                                trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^(.+[\r\n]+)/gm, "$1　　　　　");
                            }
                        } else {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/^[　 ]+/gm, "");
                        }
                    }
                }
                //Put non breaking spaces to make tidy speech bubbles
                if (trans.project.files[file].data[k][3]) {
                    if (trans.project.files[file].data[k][3].includes("「") === true) {
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([^\s　^])[\s　]*(「[\s\S]*」)/g, "$1\n$2");
                        let LinesToLook = trans.project.files[file].data[k][3].replaceAll("\r", "").split("\n");
                        if (LinesToLook.length > 1) {
                            let LinesInBlock = false;
                            for (let i1 = 0; i1 < LinesToLook.length; i1++) {
                                let CurLine = LinesToLook[i1];
                                if (LinesInBlock) {
                                    LinesToLook[i1] = "　" + LinesToLook[i1].trimStart();
                                }
                                if (CurLine.trimStart().slice(0, 1) == "「") {
                                    LinesInBlock = true;
                                }
                                if (CurLine.trimEnd().slice(-1) == "」") {
                                    LinesInBlock = false;
                                }
                            }
                            trans.project.files[file].data[k][3] = LinesToLook.join("\n");
                        }
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+\s*「[^\」]*」)\s*([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+)\s*(「[^\」]*」)/g, "$1\n$2\n$3");
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>)\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\])\n+/gi, "$1");
                        }
                    }
                }
                if (trans.project.files[file].data[k][3]) {
                    if (trans.project.files[file].data[k][3].includes("『") === true) {
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([^\s　^])[\s　]*(『[\s\S]*』)/g, "$1\n$2");
                        let LinesToLook = trans.project.files[file].data[k][3].replaceAll("\r", "").split("\n");
                        if (LinesToLook.length > 1) {
                            let LinesInBlock = false;
                            for (let i1 = 0; i1 < LinesToLook.length; i1++) {
                                let CurLine = LinesToLook[i1];
                                if (LinesInBlock) {
                                    LinesToLook[i1] = "　" + LinesToLook[i1].trimStart();
                                }
                                if (CurLine.trimStart().slice(0, 1) == "『") {
                                    LinesInBlock = true;
                                }
                                if (CurLine.trimEnd().slice(-1) == "』") {
                                    LinesInBlock = false;
                                }
                            }
                            trans.project.files[file].data[k][3] = LinesToLook.join("\n");
                        }
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+\s*『[^\』]*』)\s*([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+)\s*(『[^\』]*』)/g, "$1\n$2\n$3");
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>)\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\])\n+/gi, "$1");
                        }
                    }
                }
                if (trans.project.files[file].data[k][3]) {
                    if (trans.project.files[file].data[k][3].includes("（") === true) {
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([^\s　^])[\s　]*(（[\s\S]*）)/g, "$1\n$2");
                        let LinesToLook = trans.project.files[file].data[k][3].replaceAll("\r", "").split("\n");
                        if (LinesToLook.length > 1) {
                            let LinesInBlock = false;
                            for (let i1 = 0; i1 < LinesToLook.length; i1++) {
                                let CurLine = LinesToLook[i1];
                                if (LinesInBlock) {
                                    LinesToLook[i1] = "　" + LinesToLook[i1].trimStart();
                                }
                                if (CurLine.trimStart().slice(0, 1) == "（") {
                                    LinesInBlock = true;
                                }
                                if (CurLine.trimEnd().slice(-1) == "）") {
                                    LinesInBlock = false;
                                }
                            }
                            trans.project.files[file].data[k][3] = LinesToLook.join("\n");
                        }
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+\s*（[^\）]*）)\s*([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+)\s*(（[^\）]*）)/g, "$1\n$2\n$3");
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>)\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\])\n+/gi, "$1");
                        }
                    }
                }
                if (trans.project.files[file].data[k][3]) {
                    if (trans.project.files[file].data[k][3].includes("｢") === true) {
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([^\s　^])[\s　]*(｢[\s\S]*｣)/g, "$1\n$2");
                        let LinesToLook = trans.project.files[file].data[k][3].replaceAll("\r", "").split("\n");
                        if (LinesToLook.length > 1) {
                            let LinesInBlock = false;
                            for (let i1 = 0; i1 < LinesToLook.length; i1++) {
                                let CurLine = LinesToLook[i1];
                                if (LinesInBlock) {
                                    LinesToLook[i1] = "　" + LinesToLook[i1].trimStart();
                                }
                                if (CurLine.trimStart().slice(0, 1) == "｢") {
                                    LinesInBlock = true;
                                }
                                if (CurLine.trimEnd().slice(-1) == "｣") {
                                    LinesInBlock = false;
                                }
                            }
                            trans.project.files[file].data[k][3] = LinesToLook.join("\n");
                        }
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+\s*｢[^\｣]*｣)\s*([\w一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+)\s*(｢[^\｣]*｣)/g, "$1\n$2\n$3");
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\]\\+[FA]+[H]?\[[^\]]+?\])\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+nw?<[^\>]+?>\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+nw?<[^\>]+?>)\n+/gi, "$1");
                        }
                        if (trans.project.files[file].data[k][0].match(/\\+n\[\d+\]\n/gi) == null) {
                            trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/(\\+n\[\d+\])\n+/gi, "$1");
                        }
                    }
                    if (trans.project.files[file].data[k][0].match(/[\n][^　]/g) == null && trans.project.files[file].data[k][0].match(/[\n][　]/g) != null && trans.project.files[file].data[k][3].match(/[\n][^　]/g) != null) {
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/[\n]([^　])/g, "\n　$1");
                    } else if (trans.project.files[file].data[k][0].match(/[\n][^　]/g) == null && (trans.project.files[file].data[k][0].match(/「[^」]+$/g) != null || trans.project.files[file].data[k][0].match(/『[^』]+$/g) != null || trans.project.files[file].data[k][0].match(/（[^）]+$/g) != null || trans.project.files[file].data[k][0].match(/｢[^｣]+$/g) != null) && trans.project.files[file].data[k][3].match(/[\n][^　]/g) != null) {
                        trans.project.files[file].data[k][3] = trans.project.files[file].data[k][3].replaceAll(/[\n]([^　])/g, "\n　$1");
                    }
                }
            }
        }
    ui.loadingProgress(80, "");
    setTimeout(() => {
    var IsThereocerrormessage3 = "No";
    try {
        let files = trans.getAllFiles();
        ocea3for: for (let i = 0; i < files.length; i++) {
            let file = files[i];
            let data = trans.project.files[file].data;
            let contexts = trans.project.files[file].context;
            ocea3for2: for (let k = 0; k < data.length; k++) {
                let row = data[k];
                let context = contexts[k];
                if (context == undefined || row == undefined || context.length == 0 || row[1] == undefined || row[1] == "")
                    continue;
                let ocea3texts1 = trans.project.files[file].data[k][1]
                let ocea3texts2 = trans.project.files[file].data[k][2]
                if (ocea3texts1 != undefined && ocea3texts1 != null && ocea3texts1 != "") {
                    if (trans.project.files[file].tags[k] == "indigo" || trans.project.files[file].tags[k] == "indigo,green" || trans.project.files[file].tags[k] == "indigo,green,pink" || trans.project.files[file].tags[k] == "indigo,yellow" || trans.project.files[file].tags[k] == "indigo,blue" || trans.project.files[file].tags[k] == "indigo,red") {
                        IsThereocerrormessage3 = "Yes";
                        break ocea3for;
                        break ocea3for2;
                    }
                }
                if (ocea3texts2 != undefined && ocea3texts2 != null && ocea3texts2 != "") {
                    if (trans.project.files[file].tags[k] == "indigo" || trans.project.files[file].tags[k] == "indigo,green" || trans.project.files[file].tags[k] == "indigo,green,pink" || trans.project.files[file].tags[k] == "indigo,yellow" || trans.project.files[file].tags[k] == "indigo,blue" || trans.project.files[file].tags[k] == "indigo,red") {
                        IsThereocerrormessage3 = "Yes";
                        break ocea3for;
                        break ocea3for2;
                    }
                }
            }
        }
    } catch {}    
        trans.refreshGrid();
        trans.evalTranslationProgress();
        ui.loadingProgress(100, "Finished!");
        setTimeout(() => {
        if (IsThereocerrormessage3 == "Yes") {
            alert("The system has detected some potentially incomplete, or not properly wrapped translations and tagged them indigo.\n\nYou can find them using the search function by selecting \"Tag\" in the \"Target\" drop down menu and then searching for \"indigo\".");
        }
        ui.hideLoading();
        ui.loadingProgress(0, "");    
    }, 500);
    }, 5);
    }, 50);
    }, {
        id: "wrapProject",
        className: "wrapProject",
        label: "Word Wrap",
        priority: 2
    });
    let glossaryButton = new GreenButtonManagerButton("glossaryProject", "icon-book", "Glossary (optional)\nGenerate before Batch Translation to extract character names, place names, etc. so the batch run keeps them consistent.\nCosts extra tokens - best used with a capable model. Sent to the LLM automatically during batch translation.)", () => {
        if (typeof GlossaryExtractor === 'undefined') {
            alert("DSLR Glossary Extractor is not loaded. Check that GlossaryExtractor.js is in the SLRbatch folder.");
            return;
        }
        let extractor = new GlossaryExtractor();
        ui.showLoading({
            buttons: [{
                text: "Abort",
                onClick: () => {
                    if (confirm("Are you sure you want to abort?")) {
                        extractor.abort();
                        ui.hideLoading();
                    }
                }
            }]
        });
        ui.loadingProgress(0, "[DSLRGlossary] Starting glossary generation...");
        ui.log("[DSLRGlossary] Starting glossary generation at " + new Date());
        let logFn = function(msg) {
            ui.log(msg);
        };
        let errorLogFn = function(msg) {
            if (ui.logError) {
                ui.logError(msg);
            } else {
                ui.log(msg);
            }
        };
        let progressFn = function(pct, msg) {
            ui.loadingProgress(pct, msg);
        };
        extractor.generate(progressFn, logFn, errorLogFn).then(function(glossary) {
            if (typeof ui.hideLoading === "function") {
                ui.hideLoading();
            }
        }).catch(function(err) {
            ui.log("[DSLRGlossary] Error: " + err.message);
            console.error("[DSLRGlossary] Error:", err);
            ui.loadingProgress(100, "[DSLRGlossary] Error: " + err.message);
            ui.showCloseButton();
        });
    }, {
        id: "glossaryProject",
        className: "glossaryProject",
        label: "Glossary",
        priority: 3
    });
    // Insert the workflow buttons just before Export, in task order:
    // Setup (static) -> Glossary (optional) -> Batch Translation -> Word Wrap -> Export (static).
    let exportButtonEl = buttonContainer.querySelector(".button-export");
    [glossaryButton.getButton(), translateButton.getButton(), wrapButton.getButton()].forEach(function (buttonEl) {
        if (exportButtonEl) {
            buttonContainer.insertBefore(buttonEl, exportButtonEl);
        } else {
            buttonContainer.appendChild(buttonEl);
        }
    });
    // Uncomment this and one other part further up if you want an extra button to run stuff when the in-tool custom script stuff doesn't work for whatever reason.
/*     if (exportButtonEl) buttonContainer.insertBefore(debugButton.getButton(), exportButtonEl); else buttonContainer.appendChild(debugButton.getButton()); */
    if (typeof ui !== "undefined" && ui.toolbarLabelFit && typeof ui.toolbarLabelFit.apply === "function") {
        ui.toolbarLabelFit.apply(buttonContainer);
    }
    var _contextAutoOpenedFor = null;
    function _openContextWindowsWhenReady() {
        var tries = 0;
        var clearCount = 0;
        var tick = function() {
            tries++;
            if (tries > 80) return; // ~32s safety timeout
            var busy = (typeof ui.isLoadingOverlayVisible === "function") ? ui.isLoadingOverlayVisible() : false;
            if (busy) { clearCount = 0; setTimeout(tick, 400); return; }
            clearCount++;
            if (clearCount < 2) { setTimeout(tick, 400); return; }
            // Loading has stably closed -> everything (including applySaveData) has settled.
            // Reveal the generated Scene Graph panel for the now-complete project.
            try {
                if (typeof trans.showSceneGraphPanel === "function") trans.showSceneGraphPanel();
            } catch (e) { console.warn("[SceneGraph] auto-open panel failed:", e); }
        };
        setTimeout(tick, 500);
    }
    $(document).on("projectCreated", function() {
        try {
            var engine = trans.project && trans.project.gameEngine;
            if (["rmxp", "rmvx", "rmvxace", "rmmv", "rmmz"].indexOf(engine) == -1) return;
            // For MV/MZ, plugins are collected as part of project creation right after this event.
            // Skip the first run so checkProject processes the complete project (with plugins) afterwards.
            if ((engine === "rmmv" || engine === "rmmz") && trans._pendingPluginLoad && !trans.project.pluginIsFetched) {
                return;
            }
            if (trans.batchCheckSheet && typeof trans.batchCheckSheet.checkProject === "function") {
                trans.batchCheckSheet.checkProject();
            }
            // Once project creation fully finishes (loading UI closes), open the Scene Graph panel
            // so the user sees it was generated. Once per project.
            var pid = trans.projectId;
            if (pid && _contextAutoOpenedFor !== pid) {
                _contextAutoOpenedFor = pid;
                _openContextWindowsWhenReady();
            }
        } catch (e) {
            console.error("[SLRBatchTranslator] checkProject failed at projectCreated:", e);
            if (typeof ui.releaseCloseButton === "function") ui.releaseCloseButton();
        }
    });
});
/* //@ts-expect-error
window.runTest = (testCount : number, minLength : number, maxLength : number) => {
    //let font = "　０ １ ２ ３ ４ ５ ６ ７ ８ ９ Ａ Ｂ Ｃ Ｄ Ｅ Ｆ Ｇ Ｈ Ｉ Ｊ Ｋ Ｌ Ｍ Ｎ Ｏ Ｐ Ｑ Ｒ Ｓ Ｔ Ｕ Ｖ Ｗ Ｘ Ｙ Ｚ ａ ｂ ｃ ｄ ｅ ｆ ｇ ｈ ｉ ｊ ｋ ｌ ｍ ｎ ｏ ｐ ｑ ｒ ｓ ｔ ｕ ｖ ｗ ｘ ｙ ｚ ， ． ： ； ！ ？ ＂ ＇ ｀ ＾ ～ ￣ ＿ ＆ ＠ ＃ ％ ＋ － ＊ ＝ ＜ ＞ （ ） ［ ］ ｛ ｝ ｟ ｠ ｜ ￤ ／ ＼ ￢ ＄ ￡ ￠ ￦ ￥";
    let font = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    let texts = [];

    let results = [];
    let differences = [];
    for (let i = 0; i < testCount; i++) {
        let length = Math.random() * maxLength;
        if (length < minLength) {
            length = minLength;
        }
        let text = "";
        for (let k = 0; k < length; k++) {
            text += font[Math.floor(Math.random() * font.length)];
        }

        let realSize = getSize(text);

        let fastSize = 0;
        for (let k = 0; k < text.length; k++) {
            fastSize += getSize(text[k]);
        }

        let diff = Math.abs(fastSize - realSize);
        let diffPerc = Math.round((1000 * diff) / realSize)/10;
        differences.push(diffPerc);

        results.push(`"${text}" - Real Size: ${realSize} - Fast Cache Size: ${fastSize} - Difference: ${diffPerc}%`);
    }

    return [results, differences];
} */
// Test results: 0.1% difference for basic text
// Around 0.5% difference for complex text involving mix of full-width and proportional characters
// Verdict: it's good.
var removableContexts = [
    "SHISAYEWANTSTODESTROYTHIS"
];
//Green cell tags
var translatableNoteRegExp = /(<SG)|(<SAC.+?:)|(<win quotes>)|(<level quotes>)|(<drops quotes>)|(<namePop:)|(<desc[\d]+?:)|(<Menu Name:)|(<ResMsg:)|([ ]*?<Help Description>)|(<ActiveMessage:)|(<図鑑特徴:(?=[\s\S]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][\s\S]*$))|(<Speech\/.*?:)/gm;
var translatableNoteRegExp2 = /(^<info:.*?>$)/g;
var translatablePluginRegExp = /^(?:DW_(?!SET))|(?:D_TEXT)(?=[^_])|(?:<desc[\d]+?:)|(<Menu Name:)|(<ResMsg:)|(?:[ ]*?<Help Description>)|(?:<ActiveMessage:)|(?:\\ow\[\d+\]\\oc\[[^\]\r\n]+?\])|(?:addLog )|(?:greedCommand )|(?:DW_)|(?:ShowInfo )|(?:namePop[ |　])|(?:<namePop:[ |　]?)|(?:<namePop:)|(?:^text_indicator :)|(?:^GabText )|(?:^OSW_.*?text \d+ (?=.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]))|(?:^PSM_SHOW_POPUP.*\d+ (?=.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]))/gm;
var translatableCommentRegExp = /^((text_indicator ?:)|(secretText: )|(title: )|(<desc[\d]+?:)|(info:)|(<Menu Name:)|(<ResMsg:)|([ ]*?<Help Description>)|(<Mini Label:)|([ ]?<namePop:)|(<namePop:)|(<ActiveMessage:)|(選択肢ヘルプ(?=[\s\S]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][\s\S]*$)))/gm;
var translatableAddCommRegExp = /(^\\>)|(\\[V|N|P|C|I]\[\d+\])|(\\[\{\}\$\.\|\!\<\>\^G])|(^D_TEXT)/gm;
//Regex to detect Japanese
var translatablePluginJSRegExp = /[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+/gi;
var translatableControlVariable = /[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+/gi;
var redtranslatableNoteRegExp = /([一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+)/gim;
var retranslatablePluginRegExpd = /(?:[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+)/gi;
var redtranslatableCommentRegExp = /(([一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+))/gi;
if (window.transConfig.japanesesource != true) {
    var translatablePluginRegExp = /^(?:DW_(?!SET))|(?:D_TEXT)(?=[^_])|(?:<desc[\d]+?:)|(<Menu Name:)|(<ResMsg:)|(?:[ ]*?<Help Description>)|(?:<ActiveMessage:)|(?:\\ow\[\d+\]\\oc\[[^\]\r\n]+?\])|(?:addLog )|(?:greedCommand )|(?:DW_)|(?:ShowInfo )|(?:namePop[ |　])|(?:<namePop:[ |　]?)|(?:<namePop:)|(?:^text_indicator :)|(?:^GabText )|(?:^OSW_.*?text \d+ )|(?:^PSM_SHOW_POPUP )/gm;
    var translatableNoteRegExp = /(<SG)|(<SAC.+?:)|(<win quotes>)|(<level quotes>)|(<drops quotes>)|(<namePop:)|(<desc[\d]+?:)|(<Menu Name:)|(<ResMsg:)|([ ]*?<Help Description>)|(<ActiveMessage:)|(<図鑑特徴:)|(<Speech\/.*?:)/gm;
    var translatableCommentRegExp = /^((text_indicator ?:)|(secretText: )|(title: )|(<desc[\d]+?:)|(info:)|(<Menu Name:)|(<ResMsg:)|([ ]*?<Help Description>)|(<Mini Label:)|([ ]?<namePop:)|(<namePop:)|(<ActiveMessage:)|(選択肢ヘルプ))/gm;
    translatablePluginJSRegExp = /.+/gi;
    translatableControlVariable = /.+/gi;
    redtranslatableNoteRegExp = /(.+)/gim;
    retranslatablePluginRegExpd = /(?:.+)/gi;
    redtranslatableCommentRegExp = /((.+))/gi;
}
//Nameinput Scripts
var nameinputregexp = /^カナ$|^決定$|^英数$|^かな$/gim;
//Check for very specific XV/Ace entries in Scripts
var translateablescriptsvocab = /^所持数$|^購入する$|^売却する$|^やめる$|^持っている数$|^現在の経験値$|^どのファイルにセーブしますか？$|^どのファイルをロードしますか？$|^ファイル$|^会心の一撃！！$|^痛恨の一撃！！$|^しかし逃げることはできなかった！$|^戦闘に勝利した$|^%sが現れた！$|^%sの先制！$|^%sは退却した$|^%sは戦いに敗れた…$|^%s の経験値を獲得$|^%s\\\\G 手に入れた$|^%sを手に入れた$|^%sは%s %s に上がった$|^%sを覚えた$|^次の%sまで$|^%sは逃げてしまった。$|^お金を %s%s 手に入れた！$|^%sの攻撃！$|^%sは身を守っている。$|^%sは様子を見ている。$|^%sたち$|^%sが出現！$|^%sは先手を取った！$|^%sは不意をつかれた！$|^%sは逃げ出した！$|^%sの勝利！$|^%sは戦いに敗れた。$|^%s の経験値を獲得！$|^お金を %s\\\\G 手に入れた！$|^%sを手に入れた！$|^%sは%s %s に上がった！$|^%sを覚えた！$|^%sは%sを使った！$|^%sは %s のダメージを受けた！$|^%sの%sが %s 回復した！$|^%sの%sが %s 増えた！$|^%sの%sが %s 減った！$|^%sは%sを %s 奪われた！$|^%sはダメージを受けていない！$|^ミス！　%sはダメージを受けていない！$|^%sに %s のダメージを与えた！$|^%sの%sを %s 奪った！$|^%sにダメージを与えられない！$|^ミス！　%sにダメージを与えられない！$|^%sは攻撃をかわした！$|^%sは魔法を打ち消した！$|^%sは魔法を跳ね返した！$|^%sの反撃！$|^%sが%sをかばった！$|^%sの%sが上がった！$|^%sの%sが下がった！$|^%sの%sが元に戻った！$|^%sには効かなかった！$|^お金を %s%s 失った。$|^%sの%sが %s に下がってしまった。$/g;
var translateablescriptsglobal = /^%sが現れた！$|^%sの先制！$|^%sは退却した$|^%sは戦いに敗れた…$|^%s の経験値を獲得$|^%s\\\\G 手に入れた$|^%sを手に入れた$|^%sは%s %s に上がった$|^%sを覚えた$|^次の%sまで$|^%sは逃げてしまった。$|^お金を %s%s 手に入れた！$|^%sの攻撃！$|^%sは身を守っている。$|^%sは様子を見ている。$|^%sたち$|^%sが出現！$|^%sは先手を取った！$|^%sは不意をつかれた！$|^%sは逃げ出した！$|^%sの勝利！$|^%sは戦いに敗れた。$|^%s の経験値を獲得！$|^お金を %s\\\\G 手に入れた！$|^%sを手に入れた！$|^%sは%s %s に上がった！$|^%sを覚えた！$|^%sは%sを使った！$|^%sは %s のダメージを受けた！$|^%sの%sが %s 回復した！$|^%sの%sが %s 増えた！$|^%sの%sが %s 減った！$|^%sは%sを %s 奪われた！$|^%sはダメージを受けていない！$|^ミス！　%sはダメージを受けていない！$|^%sに %s のダメージを与えた！$|^%sの%sを %s 奪った！$|^%sにダメージを与えられない！$|^ミス！　%sにダメージを与えられない！$|^%sは攻撃をかわした！$|^%sは魔法を打ち消した！$|^%sは魔法を跳ね返した！$|^%sの反撃！$|^%sが%sをかばった！$|^%sの%sが上がった！$|^%sの%sが下がった！$|^%sの%sが元に戻った！$|^%sには効かなかった！$|^お金を %s%s 失った。$|^%sの%sが %s に下がってしまった。$/g;
var badScriptsglobal = /^シンボルエンカウント補助$|^明かりスクリプトVXA$|^フキダシアイコン常時再生$/gm;
//Mark for deletion
var deleteEVnumberRegExp = /^EV\d\d\d$/g;
//This crashes the escaper
var ripEscaperRegExp = /(?:\\n<.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?>[\s\S]*?\\n<.*?>)|(?:([「『｢].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?[」』｣])[\s\S]*?\1)/gi;
if (window.transConfig.japanesesource != true) {
    ripEscaperRegExp = /(?:\\n<.*?..*?>[\s\S]*?\\n<.*?>)|(?:([「『｢].*?..*?[」』｣])[\s\S]*?\1)/gi;
}
//Detect potential filenames
var vxTroopsBB = /^<BB:/gmi;
var underscoreEnemyRegExp = /.*_.*/gi;
var underscoreEnemyStrictRegExp = /^.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\w]+_(?!actor|class|key|name|desc|TEXT|num|icon|ABL|logWindow)[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\w]+.*$/g;
var underscoreEnemyConditional1 = /_(?:name|class|actor|num|key|icon|desc|TEXT|see|Turn|[a-zA-z]<|SE|CT|t=\d+_subject=)(?:[^a-zA-Z]|$)/g;
var underscoreEnemyConditional2 = /[^a-zA-Z](?:DW|\\F\[).*_.*/g;
{
    underscoreEnemyRegExp = /.*_.*/gi;
    underscoreEnemyStrictRegExp = /^.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\w]+_(?!actor|class|key|name|desc|TEXT|num|icon|ABL|logWindow)[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ\w]+$/g;
}
var showChoicesFiles = /\|.*$/g;
//plugins.js
var pluginsjsregexp = /^右クリック$|^選択肢ヘルプ$|^.*mplus-1.*$|^.*vl-gothic.*$|^アイコン\d+?$/gi;
var pluginsjsregexp2 = /^.+\.(png|jpg|ttf|woff|otf|txt|ini|rvdata|rgss|json|js|wav|ogg|mp3|mp4|m4a|bmp|exe).*$/gi;
var pluginsjsregexp3 = /^[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]*\/\/.*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+.*$/gim;
if (window.transConfig.japanesesource != true) {
    pluginsjsregexp3 = /^.*\/\/.*.+.*$/gim;
}
var pluginsjsregexp4 = /^<呼び出し名:.*?>|^<角度:.*?>/g;
//Plugin Command
var PluginCommandRegExp = /(?:^LL_GalgeChoiceWindowMV ?setMessageText ?.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?)|(?:^[\s　]*{"label":"[^"]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^"]*"[^}]+}[\s　]*(?=[\s\S]*?GalgeChoiceWindow[\s\S]*?$))|(?:^CommonPopup add text:)/gm;
var PluginCommand2RegExp = /^LL_GalgeChoiceWindowMV ?setChoices ?.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?/gm;
var GalgeChoiceWindowRegExp = /^[\s　]*{"label":"[^"]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^"]*"[^}]+}[\s　]*$/gm;
if (window.transConfig.japanesesource != true) {
    PluginCommandRegExp = /^LL_GalgeChoiceWindowMV ?setMessageText ?.*?..*?/gm;
    PluginCommand2RegExp = /^LL_GalgeChoiceWindowMV ?setChoices ?.*?..*?/gm;
}
//Script context
var mzScriptRexExp = /(?:^テキスト-(?=[\s\S]*[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][\s\S]*$))/gim;
var mzScriptRexExpyellow = /(?:^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\".*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?\"\;$)/gi;
var controlVarExpyellow = /^['`"].*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?['`"]$/gi;
if (window.transConfig.japanesesource != true) {
    mzScriptRexExp = /(?:^テキスト-.*.+)/gim;
    mzScriptRexExpyellow = /(?:^\$gameVariables\.value\(\d+\)\[\d+\] ?= ?\".*?..*?\"\;$)/gi;
    controlVarExpyellow = /^['`"].*?['`"]$/gi;
}
// Script Header context
var translatableScriptHeaderRegExp = /(?:^_EventSetting = ".*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].*?";$|^BattleManager\._logWindow\.addText\('.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].+?.*?'\);$)|(?:^\$gameScreen\.OriginalMessage\(.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ].+?.*?\);$)/g;
if (window.transConfig.japanesesource != true) {
    translatableScriptHeaderRegExp = /(?:^_EventSetting = ".*?..*?";$|^BattleManager\._logWindow\.addText\('.*?..*?'\);$)|(?:^\$gameScreen\.OriginalMessage\(.*?\);$)/g;
}
//To mark vocab as safe in legacy mode
var translatableVxAceScript = ["Vocab"];
//The "grab everything" regex
var translatableControlVariable2 = /.*/g;

var potentialEscaperProblem = "false";

function setRowTag(file, index, newTags) {
    let fileObj = trans.project.files[file];
    if (!fileObj) return;
    if (!Array.isArray(fileObj.tags)) fileObj.tags = [];
    let exArr = Array.isArray(fileObj.tags[index]) ? fileObj.tags[index] : [];
    if (exArr.indexOf("num") != -1 && newTags.indexOf("num") == -1) {
        fileObj.tags[index] = newTags.concat(["num"]);
    } else {
        fileObj.tags[index] = newTags;
    }
}
// Normalized array view of a row's tags. The grid stores tags inconsistently:
// undefined, an array of strings, or a legacy comma-joined string. Every add/
// remove goes through here so callers never have to care which shape a row
// currently holds.
function slrTagList(file, index) {
    let fileObj = trans.project.files[file];
    if (!fileObj || !fileObj.tags) return [];
    let t = fileObj.tags[index];
    if (t === undefined || t === null) return [];
    if (Array.isArray(t)) return t.map((s) => String(s).trim()).filter(Boolean);
    return String(t).split(",").map((s) => s.trim()).filter(Boolean);
}
// Rows this run newly tagged purple/mediumpurple, as [file, index, tag].
// slrFlagTag records them only when the tag was not already present, so the
// post-run tag alert can tell tags added by THIS run apart from tags left
// over from earlier runs. Reset at each batch run start (slrBeginTagRun) and
// consumed by PostBatch.OvercomplicatedErrorAlert2; null means no run is
// being tracked.
let slrTagsAddedThisRun = null;
function slrBeginTagRun() { slrTagsAddedThisRun = []; }
// Add one tag to a row, preserving all other tags (order-stable, no duplicates).
// This replaces the legacy string-equality ladders that could not see array-
// shaped tags at all and overwrote whatever the row already carried.
function slrFlagTag(file, index, tag) {
    let fileObj = trans.project.files[file];
    if (!fileObj) return;
    if (!Array.isArray(fileObj.tags)) fileObj.tags = [];
    let list = slrTagList(file, index);
    if (!list.includes(tag)) {
        list.push(tag);
        if (slrTagsAddedThisRun && (tag === "purple" || tag === "mediumpurple")) {
            slrTagsAddedThisRun.push([file, index, tag]);
        }
    }
    fileObj.tags[index] = list;
}
// Remove one tag from a row, preserving all other tags. Removing the tag the
// row does not carry is a no-op.
function slrUnflagTag(file, index, tag) {
    let fileObj = trans.project.files[file];
    if (!fileObj) return;
    if (!Array.isArray(fileObj.tags)) fileObj.tags = [];
    fileObj.tags[index] = slrTagList(file, index).filter((t) => t !== tag);
}
class RedBatchCheatSheet {
    checkProject() {
        ui.loadingProgress(0, "");
        ui.log("[SLRBatchTranslator] Preparing the project for batch translation: removing dead/empty entries and tagging rows by context so the batch translator knows how to handle them.");
        ui.loadingProgress(0, "");
        ui.log("[SLRBatchTranslator] Processing...");
        setTimeout(() => {
        console.log("[SLRBatchTranslator] checkProject tagging started");
        for (let file in trans.project.files) {
            if (trans.project.files[file] && !Array.isArray(trans.project.files[file].tags)) {
                trans.project.files[file].tags = [];
            }
        }
        //Mark stuff for deletion
        //this.DELETEcheckCollection(trans.travelContext(trans.getAllFiles(), "name"), deleteEVnumberRegExp);
        // Remove untranslatable or pointless rows
        trans.removeRowByContext(undefined, removableContexts, {
            matchAll: true
        });
        // Remove indigo
        var wasthereanindigotag = "No";
        try {
            for (let file in trans.project.files) {
                if (file != undefined && file != null && file != "") {
                    let fileData = trans.project.files[file];
                    for (let index = 0; index < fileData.data.length; index++) {
                        if (slrTagList(file, index).includes("indigo")) {
                            slrUnflagTag(file, index, "indigo");
                            wasthereanindigotag = "Yes";
                        }
                    }
                }
            }
        } catch {} finally {
        }
        // Red all js/plugins/
        for (let file in trans.project.files) {
            // Make all mostly bad stuff red before additional processing
            if (file.indexOf("js/plugins/") != -1 || // MV/MZ plugins
                file.indexOf("Scripts/") != -1 || // VX Ace scripts
				file.indexOf("Game.ini") != -1 || // VX Ace ini only title is translatable
				file.indexOf("ContainerProperties") != -1 || // i dunno man
                file.indexOf("MV_Project") != -1 || // breaks stuff
                file.indexOf("data/filters") != -1 || // breaks stuff
                file.indexOf("Animations") != -1 || // breaks stuff
                file.indexOf("Tilesets") != -1 // breaks stuff
            ) {
                let fileData = trans.project.files[file];
                for (let index = 0; index < fileData.data.length; index++) {
                    setRowTag(file, index, ["red"]);
                }
            }
        }
        // Blue all
        for (let file in trans.project.files) {
            // Make stuff that doesn't show up in-game blue
            if (file.indexOf("MapInfos") != -1 // translating that doesnt seem to do anything
            ) {
                let fileData = trans.project.files[file];
                for (let index = 0; index < fileData.data.length; index++) {
                    setRowTag(file, index, ["blue"]);
                }
            }
        }
        ui.loadingProgress(20, "");
        setTimeout(() => {
        //Make stuff that is already red, red again because apparently a broken red can exist for those entries somehow. 
        this.MakeUntaggedRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Control Variables"), translatableControlVariable2);
        this.MakeUntaggedRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Initialization"), translatableControlVariable2);
        //Make stuff red that is basically never a good idea to translate, but I don't want to remove stuff
        this.MakeUntaggedRedcheckCollection(trans.travelContext(trans.getAllFiles(), "System/switches"), translatableControlVariable2);
        //Check quirky Commonevents
        const commoneventsparametercontext = trans.travelContext(trans.getAllFiles(), "commonevents parameters", {
            matchAll: true
        });
        this.lowAccstringcheckCollection(commoneventsparametercontext, translatableAddCommRegExp);
        this.underscorePrepcheckCollection(commoneventsparametercontext, underscoreEnemyConditional1);
        this.underscorePrepcheckCollection(commoneventsparametercontext, underscoreEnemyConditional2);
        this.underscoreYellowRedcheckCollection(commoneventsparametercontext, underscoreEnemyRegExp);
        //Check (common, events, state, tileset) names
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "events name"), translatableControlVariable2);
        const eventsnamecontext = trans.travelContext(trans.getAllFiles(), "events name", {
            matchAll: true
        });
        this.MakeRedcheckCollection(eventsnamecontext, translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "commonevents name"), translatableControlVariable2);
        const commoneventsnamecontext = trans.travelContext(trans.getAllFiles(), "commonevents name", {
            matchAll: true
        });
        this.MakeRedcheckCollection(commoneventsnamecontext, translatableControlVariable2);
        
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "tilesets name"), translatableControlVariable2);
        const tilesetsnamecontext = trans.travelContext(trans.getAllFiles(), "tilesets name", {
            matchAll: true
        });
        this.MakeRedcheckCollection(tilesetsnamecontext, translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "states name"), translatableControlVariable2);
        const statesnamecontext = trans.travelContext(trans.getAllFiles(), "states name", {
            matchAll: true
        });
        this.MakeRedcheckCollection(statesnamecontext, translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "state name"), translatableControlVariable2);
        const statenamecontext = trans.travelContext(trans.getAllFiles(), "state name", {
            matchAll: true
        });
        this.MakeRedcheckCollection(statenamecontext, translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "animations"), translatableControlVariable2);
        // script context
        //MZ
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "/script"), mzScriptRexExp);
        this.MakeNonGreenYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "/script"), mzScriptRexExpyellow);
        //VX/Ace
        //Make cells that include Japanese yellow
        this.reversecheckCollection(trans.travelContext(trans.getAllFiles(), "script/"), translatablePluginJSRegExp);
        this.reversecheckCollection(trans.travelContext(trans.getAllFiles(), "inlinescript"), translatablePluginJSRegExp);
        //Make the ones including text effects Green but allow them to be tagged again
        this.lowAcccheckCollection(trans.travelContext(trans.getAllFiles(), "script/"), translatableAddCommRegExp);
        this.lowAcccheckCollection(trans.travelContext(trans.getAllFiles(), "inlinescript"), translatableAddCommRegExp);
        //Make cells likely to be filenames red based on cell content
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "script/"), underscoreEnemyConditional1);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "inlinescript"), underscoreEnemyConditional1);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "script/"), underscoreEnemyConditional2);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "inlinescript"), underscoreEnemyConditional2);
        this.underscoreYellowRedcheckCollection(trans.travelContext(trans.getAllFiles(), "script/"), underscoreEnemyRegExp);
        this.underscoreYellowRedcheckCollection(trans.travelContext(trans.getAllFiles(), "inlinescript"), underscoreEnemyRegExp);
        // Check note context
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "note"), translatableNoteRegExp);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "note"), translatableNoteRegExp2);
        // Check comment context
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "comment"), translatableCommentRegExp);
        // Check Script Header
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "Script Header"), translatableScriptHeaderRegExp);
        // Make VX/Ace comments blue
        this.checkcommCollection(trans.travelContext(trans.getAllFiles(), "vxcomm"), translatableAddCommRegExp);
        this.checkcommCollection(trans.travelContext(trans.getAllFiles(), "addcomm"), translatableAddCommRegExp);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "vxcomm"), underscoreEnemyConditional1);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "addcomm"), underscoreEnemyConditional1);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "vxcomm"), underscoreEnemyConditional2);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "addcomm"), underscoreEnemyConditional2);
        this.underscoreMakeNonRedBluecheckCollection(trans.travelContext(trans.getAllFiles(), "vxcomm"), underscoreEnemyRegExp);
        this.underscoreMakeNonRedBluecheckCollection(trans.travelContext(trans.getAllFiles(), "addcomm"), underscoreEnemyRegExp);
        // Check plugin context
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "plugin"), translatablePluginRegExp);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "Plugin Command"), PluginCommandRegExp);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "notify/message"), translatableControlVariable);
        //Make stuff that needs translation, but isn't fully automated, yet, yellow
        this.MakeNonGreenYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "Plugin Command"), PluginCommand2RegExp);
        //Make things that are confirmed to "most of the time" be translateable based purely on context green because I totally wont regret this
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "messagetext"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "set_destination/destination"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "dtext/text"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "addlog/text"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "greedCommand"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "textpicture/set/text"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "Show Choices"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "Show Text Attributes/actorname"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "addlocation/name"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "terms/messages/file"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "System/terms/params"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "Mz Plugin Command/RandomItem/random_item"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "BattleLogOutput/OUTPUT_LOG/message"), translatableControlVariable2);
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "OCR Score"), translatableControlVariable2);

        const galgechoicelabelcontext = trans.travelContext(trans.getAllFiles(), "LL_GalgeChoiceWindow showchoice JSON label", {
            matchAll: true
        });
        this.checkCollection(galgechoicelabelcontext, translatableControlVariable2);
        //string literal
        this.lowAccstringcheckCollection(trans.travelContext(trans.getAllFiles(), "stringliteral"), translatableAddCommRegExp);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "stringliteral"), underscoreEnemyConditional1);
        this.underscorePrepcheckCollection(trans.travelContext(trans.getAllFiles(), "stringliteral"), underscoreEnemyConditional2);
        this.underscoreYellowRedcheckCollection(trans.travelContext(trans.getAllFiles(), "stringliteral"), underscoreEnemyRegExp);
        //message
        potentialEscaperProblem = "false";
        this.reversecheckCollection2(trans.travelContext(trans.getAllFiles(), "message"), ripEscaperRegExp);
        // Check plugins.js file
        this.pluginscheckFile("js/plugins.js", translatablePluginJSRegExp);
        //underscore pugins stuff
        this.underscorePrepcheckFile("js/plugins.js", underscoreEnemyConditional1);
        this.underscorePrepcheckFile("js/plugins.js", underscoreEnemyConditional2);
        this.underscorecheckFileyellow("js/plugins.js", underscoreEnemyRegExp);
        //Make things in plugins.js red that should not be translated
        this.MakeRedcheckFile("js/plugins.js", pluginsjsregexp);
        this.MakeRedcheckFile("js/plugins.js", pluginsjsregexp2);
        this.MakeRedcheckFile("js/plugins.js", pluginsjsregexp3);
        this.MakeRedcheckFile("js/plugins.js", pluginsjsregexp4);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "choice help commands"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "comment/json/choicehelp"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Choice Format"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "parameters/table key"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "制御文字の拡張"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "スクリプトに制御文字適用"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "/File"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "parameters/sPictures"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "parameters/sbActionPictures"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "parameters/templateList"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "parameters/mapTemplateList"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Line Break"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Macro"), translatableControlVariable2);
        //Make some potentially fine stuff yellow
        this.MakeNonRedGreenYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "system/variables"), translatableControlVariable2);
        this.MakeNonGreenYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "Control Variables"), controlVarExpyellow);
        //make some potentially bad stuff yellow
        this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "Show Choices"), showChoicesFiles);
        //Some minor green tags inside red tagged objects.
        this.checkCollection(trans.travelContext(trans.getAllFiles(), "Game.ini/Game/Title"), translatableControlVariable);
        this.checkFile("Scripts/Window_NameInput.rb", nameinputregexp);
        ui.loadingProgress(40, "");
        setTimeout(() => {
        //VX Troops
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "troops"), vxTroopsBB);
        //Make cells likely to be filenames red based on context
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic_Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic.Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pictureName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture_Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture.Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "iconName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon_Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon.Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "imageName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image_Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image.Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "fileName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file_Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file.Name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picPath"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic_Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic.Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picturePath"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture_Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture.Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "iconPath"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon_Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon.Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "imagePath"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image_Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image.Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "filePath"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file_Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file.Path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file path"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picDir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic_Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic.Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pictureDir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture_Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture.Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "iconDir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon_Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon.Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "imageDir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image_Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image.Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "fileDir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file_Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file.Dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file dir"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picLoc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic_Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic.Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pic loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "pictureLoc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture_Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture.Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "picture loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "iconLoc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon_Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon.Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "icon loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "imageLoc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image_Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image.Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "image loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "fileLoc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file_Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file.Loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "file loc"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "AnimationPattern"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "json file"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "JSON/Animation"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "JSON/Picture"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "JSON/file"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "JSON/Memo"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "SpineSetting"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "ModelName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "SkeletonName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "SkinName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "PictureList"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "GaugeList"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "弱点SE"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "耐性SE"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "walk1"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "walk2"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "walk3"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "dash1"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "dash2"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "dash3"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "OKSound"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "bgBitmap"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "bitmap"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "jpeg"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "jpg"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "gif"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "png"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "mp3"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "mp4"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "m4a"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "ogg"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "webm"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "webp"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "flv"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "avi"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "3gp"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "wav"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "aac"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "opus"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "mkv"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "flac"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "vorbis"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Made with MV Image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "soundEffect/JSON/name"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Highlight Words"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "BackImage"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Back.Image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Back_Image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Back Image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "FrontImage"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Front.Image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Front_Image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "Front Image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "JSON/typeName"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "JSON/image"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "parameters/choiceFormat"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "skeleton"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "prohibitLineBreakBefore"), translatableControlVariable2);
        this.MakeRedcheckCollection(trans.travelContext(trans.getAllFiles(), "regionList"), translatableControlVariable2);
        //Check if Sideview animations exist and tag skill names yellow if they do.
        const skillsnamecontext = trans.travelContext(trans.getAllFiles(), "skills name", {
            matchAll: true
        });
        var IsThereSideView = "No";
        var IsThereSuSkilltree = "No";
        var IsThereMogBattlecommands = "No";
        var IsThereEncLv2d = "No";
        if (this.DoesThisExistcheckFile("Scripts/Sideview.rb", translatableControlVariable2) == 69) {
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "skills name"), translatableControlVariable2);
            this.MakeNonRedYellowcheckCollection(skillsnamecontext, translatableControlVariable2);
            IsThereSideView == "Yes";
        } else if (this.DoesThisExistcheckFile("Scripts/Sideview_.rb", translatableControlVariable2) == 69) {
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "skills name"), translatableControlVariable2);
            this.MakeNonRedYellowcheckCollection(skillsnamecontext, translatableControlVariable2);
            IsThereSideView == "Yes";
        } else if (this.DoesThisExistcheckFile("Scripts/Sideview_.1.rb", translatableControlVariable2) == 69) {
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "skills name"), translatableControlVariable2);
            this.MakeNonRedYellowcheckCollection(skillsnamecontext, translatableControlVariable2);
            IsThereSideView == "Yes";
        } else if (this.DoesThisExistcheckFile("Scripts/Sideview_1.rb", translatableControlVariable2) == 69) {
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "skills name"), translatableControlVariable2);
            this.MakeNonRedYellowcheckCollection(skillsnamecontext, translatableControlVariable2);
            IsThereSideView == "Yes";
        }
       if (this.DoesThisExistcheckFile("js/plugins/SU_SkillTree.js", translatableControlVariable2) == 69) {
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "skills name"), translatableControlVariable2);
            this.MakeNonRedYellowcheckCollection(skillsnamecontext, translatableControlVariable2);
            IsThereSuSkilltree = "Yes";
       }
       if (this.DoesThisExistcheckFile("js/plugins/MOG_BattleCommands.js", translatableControlVariable2) == 69) {
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "System/terms/commands"), translatableControlVariable2);
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "System/skillTypes/"), translatableControlVariable2);
            IsThereMogBattlecommands = "Yes";
       }
        const weaponsnamecontext = trans.travelContext(trans.getAllFiles(), "weapons name", {
            matchAll: true
        });
        if (this.DoesThisExistcheckFile("js/plugins/enc_lv2d.js", translatableControlVariable2) == 69) {
            this.MakeNonRedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "weapons name"), translatableControlVariable2);
            this.MakeNonRedYellowcheckCollection(weaponsnamecontext, translatableControlVariable2);
            IsThereEncLv2d = "Yes";
        }
        //Try to help people who don't know how Ace scripts work by making the "sometimes" translatable sections yellow.
        this.checkFile("Scripts/Vocab.rb", translateablescriptsvocab);

        let scriptnumberthing = "Scripts/_.";
        let scriptnumberthingraw = 0;
        let scriptnumberthing3 = ".rb";

        while (scriptnumberthingraw < 999) {
            scriptnumberthingraw += 1;
            let scriptnumberthing2 = scriptnumberthingraw.toString();
            this.MakeRedYellowcheckFileiter(scriptnumberthing, scriptnumberthing2, scriptnumberthing3, translatableControlVariable);
            this.underscorecheckFileiter2(scriptnumberthing, scriptnumberthing2, scriptnumberthing3, underscoreEnemyRegExp);
            this.MakeRedYellowcheckFileiter(scriptnumberthing, scriptnumberthing2, scriptnumberthing3, underscoreEnemyConditional1);
            this.MakeRedYellowcheckFileiter(scriptnumberthing, scriptnumberthing2, scriptnumberthing3, underscoreEnemyConditional2);
            this.underscorecheckFileiter(scriptnumberthing, scriptnumberthing2, scriptnumberthing3, badScriptsglobal);
            this.CheckFileIter(scriptnumberthing, scriptnumberthing2, scriptnumberthing3, translateablescriptsglobal);
        }

        // "Scripts.txt"
        let fileData = trans.project.files["Scripts.txt"];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                let text = fileData.data[index][0];
                let contexts = fileData.context[index];
                let yellow = false;
                for (let c = 0; c < contexts.length; c++) {
                    let context = contexts[c];
                    for (let t = 0; t < translatableVxAceScript.length; t++) {
                        let translatableContext = translatableVxAceScript[t];
                        if (context.indexOf("Scripts/" + translatableContext) != -1) {
                            setRowTag("Scripts.txt", index, ["yellow"]);
                            yellow = true;
                            break; // on to the next row
                        }
                    }
                    if (!yellow) {
                        setRowTag("Scripts.txt", index, ["red"]);
                    }
                }
            }
        }
        // TODO: Split everything by engine.
        switch (trans.project.gameEngine) {
            case "rm2k":
                this.checkrm2k();
                break;
            case "rm2k3":
                this.checkrm2k();
                break;
        }
        ui.loadingProgress(60, "");
        setTimeout(() => {
        if (window.transConfig.japanesesource == true) {
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "a"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "b"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "c"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "d"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "e"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "f"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "g"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "h"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "i"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "j"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "k"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "l"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "m"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "n"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "o"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "p"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "q"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "r"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "s"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "t"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "u"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "v"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "w"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "x"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "y"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "z"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "1"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "2"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "3"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "4"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "5"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "6"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "7"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "8"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "9"), underscoreEnemyStrictRegExp);
            this.MakeUntaggedYellowcheckCollection(trans.travelContext(trans.getAllFiles(), "0"), underscoreEnemyStrictRegExp);
        }
        //Mark Non Japanese regardless of context
        if (window.transConfig.japanesesource == true) {
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "a"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "b"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "c"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "d"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "e"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "f"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "g"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "h"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "i"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "j"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "k"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "l"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "m"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "n"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "o"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "p"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "q"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "r"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "s"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "t"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "u"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "v"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "w"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "x"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "y"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "z"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "1"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "2"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "3"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "4"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "5"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "6"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "7"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "8"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "9"), translatableControlVariable);
            this.NoJapcheckCollection(trans.travelContext(trans.getAllFiles(), "0"), translatableControlVariable);
        } else {
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "a"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "b"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "c"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "d"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "e"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "f"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "g"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "h"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "i"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "j"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "k"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "l"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "m"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "n"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "o"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "p"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "q"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "r"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "s"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "t"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "u"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "v"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "w"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "x"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "y"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "z"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "1"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "2"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "3"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "4"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "5"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "6"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "7"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "8"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "9"), translatableControlVariable2);
            this.RemoveAllGreenPink(trans.travelContext(trans.getAllFiles(), "0"), translatableControlVariable2);
        }
        // Up date view
        trans.refreshGrid();
        trans.evalTranslationProgress();
        ui.loadingProgress(80, "");
        setTimeout(() => {
        //Delete empty objects in Data, data, and js/plugins, and hide them in the editor if they are in Scripts or Main.
        var frcoll = trans.getAllFiles();
        var frstagingpath = trans.getStagingPath();
        var fs = require('graceful-fs')
        for (let i = 0; i < frcoll.length; i++) {
            var frfile = frcoll[i];
            try {
                var frdata = trans.project.files[frfile];
                var frstring = frdata.data[0].toString();
            } catch {
                try {
                    trans.deleteFile(frfile);
                } catch {
                    alert('Error! The empty object ' + frfile + ' could not be removed from the list.');
                }
                if (frfile.includes('Scripts/') != true && frfile.includes('Main/') != true && frfile.includes('.rb') != true && frfile.includes('Scripts.') != true && frfile.includes('Main.') != true) {
                    let frstagingpathslash = frstagingpath.replaceAll("\\", "\/");
                    let frfileToRemove = frstagingpathslash + "/data/" + frfile;
                    try {
                        fs.unlinkSync(frfileToRemove);
                    } catch {
                        continue;
                    }
                }
                continue;
            }
            if (frdata.data[0] == undefined || frdata.data[0] == null || frdata.data[0] == '' || frstring == '' || frstring == undefined || frstring == null || frstring.match(/^,+$/g) != null || frdata.data.length < 1) {
                try {
                    trans.deleteFile(frfile);
                } catch {
                    alert('Error! The empty object ' + frfile + ' could not be removed from the list.');
                }
                if (frfile.includes('Scripts/') != true && frfile.includes('Main/') != true && frfile.includes('.rb') != true && frfile.includes('Scripts.') != true && frfile.includes('Main.') != true) {
                    let frstagingpathslash = frstagingpath.replaceAll("\\", "\/");
                    let frfileToRemove = frstagingpathslash + "/data/" + frfile;
                    try {
                        fs.unlinkSync(frfileToRemove);
                    } catch {
//                            alert('Error! The empty object ' + frfile + ' could not be removed from staging data. (Already Deleted?)');
                    }
                }
            }
        }
        // Up date view
        trans.refreshGrid();
        trans.evalTranslationProgress();
        trans.autoSave();
        ui.loadingEnd(100, "Finished!");
        setTimeout(() => {
/*         if (wasthereapurpletag == "Yes") {
            alert("Existing purple tags were replaced with SHISAYE.TRANSLATIONFAIL errors.");
        } */
        if (wasthereanindigotag == "Yes") {
            alert("Existing indigo tags were detected and removed.");
        }
        if (IsThereSideView == "Yes") {
            alert("\"Sideview\" plugin detected! \"Skills Name\" entries have been tagged yellow because that plugin can use those entries and will crash the game if translated entries are not mirrored in the plugin.");
        }
        if (IsThereSuSkilltree == "Yes") {
            alert("\"Su Skill Tree\" plugin detected! \"Skills Name\" entries have been tagged yellow because that plugin can use those entries for picture file names. If translated, you need to translate those file names exactly the same way.");
        }
        if (IsThereMogBattlecommands == "Yes") {
            alert("\"MOG Battle Commands\" plugin detected! \"System Terms Commands\" entries have been tagged yellow because that plugin can use those entries for picture file names starting with \"Com_\". If translated, you need to translate those file names exactly the same way.");
        }
        if (IsThereEncLv2d == "Yes") {
            alert("\"enc_lv2d\" plugin detected! \"Weapons Name\" entries have been tagged yellow because that plugin can use those entries and will crash the game if translated entries are not mirrored in the plugin.");
        }
        if (potentialEscaperProblem == "true") {
            alert("The system detected one or more cells with the \"message\" context, that have identical repeated text boxes after a name plate. This \"could\", in very specific circumstances, cause the SLR escaper to crash. This is being overly cautious, but the cells have been tagged yellow.");
        }
        ui.releaseCloseButton();
        }, 500);
        }, 5);
        }, 5);
        }, 5);
        }, 5);
        }, 50);
    }
    checkrm2k() {
            // Removables:
            // \/Event\/\d+$   -  Event name
            // Translatable:
            // event_commands/14    - 14 = MESSAGE code
        }
        /**
         * Searches ALL FILES for a certain context.
         * On match, returns the address of the matching row.
         * @param regs RegExp to match against CONTEXT
         */
    matchContext(regs) {}
    checkCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.checkRow(file, index, regExp);
                }
            }
        }
    }
    lowAcccheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.lowAcccheckRow(file, index, regExp);
                }
            }
        }
    }
    lowAccstringcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.lowAccstringcheckRow(file, index, regExp);
                }
            }
        }
    }
    DELETEcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.DELETEcheckRow(file, index, regExp);
                }
            }
        }
    }
    checkcommCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.checkcommRow(file, index, regExp);
                }
            }
        }
    }
    reversecheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.reversecheckRow(file, index, regExp);
                }
            }
        }
    }
    reversecheckCollection2(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.reversecheckRow2(file, index, regExp);
                }
            }
        }
    }
    MakeRedYellowcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeRedYellowcheckRow(file, index, regExp);
                }
            }
        }
    }
    underscorePrepcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.underscorePrepcheckRow(file, index, regExp);
                }
            }
        }
    }
    MakeNonRedYellowcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeNonRedYellowcheckRow(file, index, regExp);
                }
            }
        }
    }
    MakeNonGreenYellowcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeNonGreenYellowcheckRow(file, index, regExp);
                }
            }
        }
    }
    MakeNonRedGreenYellowcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeNonRedGreenYellowcheckRow(file, index, regExp);
                }
            }
        }
    }
    MakeNonRedBluecheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeNonRedBluecheckRow(file, index, regExp);
                }
            }
        }
    }
    underscoreMakeNonRedBluecheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.underscoreNonRedBluecheckRow(file, index, regExp);
                }
            }
        }
    }
    MakeRedcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeRedcheckRow(file, index, regExp);
                }
            }
        }
    }
    MakeUntaggedRedcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeUntaggedRedcheckRow(file, index, regExp);
                }
            }
        }
    }
    MakeUntaggedYellowcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.MakeUntaggedyellowcheckRow(file, index, regExp);
                }
            }
        }
    }
    underscoreYellowRedcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.underscoreYellowRedcheckRow(file, index, regExp);
                }
            }
        }
    }
    NoJapcheckCollection(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.NoJapcheckRow(file, index, regExp);
                }
            }
        }
    }
    RemoveAllGreenPink(collection, regExp) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.RemoveGreenPink(file, index, regExp);
                }
            }
        }
    }
    checkFile(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.checkRow(file, index, regExp);
            }
        }
    }
    underscorecheckFileyellow(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.underscoreYellowRedcheckRow(file, index, regExp);
            }
        }
    }
    pluginscheckFile(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.pluginscheckRow(file, index, regExp);
            }
        }
    }
    MakeRedcheckFile(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.MakeRedcheckRow(file, index, regExp);
            }
        }
    }
    DoesThisExistcheckFile(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                let text = trans.project.files[file].data[index][0];
                if (text != null && text != undefined) {
                    let search = text.search(regExp);
                    if (search != -1) {
                        return 69
                    }
                }
            }
        }
    }
    underscorecheckFile(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.MakeRedcheckRow(file, index, regExp);
            }
        }
    }
    underscorecheckFileiter(file1, file2, file3, regExp) {
        let file = file1 + file2 + file3;
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.MakeRedcheckRow(file, index, regExp);
            }
        }
    }
    underscorecheckFileiter2(file1, file2, file3, regExp) {
        let file = file1 + file2 + file3;
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.MakeRedcheckRow2(file, index, regExp);
            }
        }
    }
    MakeRedYellowcheckFile(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.MakeRedYellowcheckRow(file, index, regExp);
            }
        }
    }
    underscorePrepcheckFile(file, regExp) {
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.underscorePrepcheckRow(file, index, regExp);
            }
        }
    }
    MakeRedYellowcheckFileiter(file1, file2, file3, regExp) {
        let file = file1 + file2 + file3;
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.MakeRedYellowcheckRow(file, index, regExp);
            }
        }
    }
    CheckFileIter(file1, file2, file3, regExp) {
        let file = file1 + file2 + file3;
        let fileData = trans.project.files[file];
        if (fileData != undefined) {
            for (let index = 0; index < fileData.data.length; index++) {
                this.checkRow(file, index, regExp);
            }
        }
    }
    checkRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                setRowTag(file, index, ["green", "pink"]);
            } else if (trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "aqua") {
                setRowTag(file, index, ["red"]);
            }
        }
    }
    lowAcccheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                setRowTag(file, index, ["green"]);
            } else if (trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "aqua") {
                setRowTag(file, index, ["red"]);
            }
        }
    }
    lowAccstringcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                setRowTag(file, index, ["green"]);
            } else if (trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "aqua") {
                setRowTag(file, index, ["yellow"]);
            }
        }
    }
    pluginscheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                setRowTag(file, index, ["green"]);
            } else if (trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "aqua") {
                setRowTag(file, index, ["red"]);
            }
        }
    }
    DELETEcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                trans.project.files[file].context[index] = ["SHISAYEWANTSTODESTROYTHIS"];
            }
        }
    }
    checkcommRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                setRowTag(file, index, ["green"]);
            } else if (trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "aqua") {
                setRowTag(file, index, ["blue"]);
            }
        }
    }
    MakeRedYellowcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] == "red" || trans.project.files[file].tags[index] == "darkred") {
                    setRowTag(file, index, ["yellow"]);
                }
            }
        }
    }
    underscorePrepcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] == "green") {
                    setRowTag(file, index, ["green", "yellow"]);
                } else if (trans.project.files[file].tags[index] == "yellow") {
                    setRowTag(file, index, ["yellow", "red"]);
                } else if (trans.project.files[file].tags[index] == "blue") {
                    setRowTag(file, index, ["blue", "yellow"]);
                }
            }
        }
    }
    MakeNonRedYellowcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "red" && trans.project.files[file].tags[index] != "darkred") {
                    setRowTag(file, index, ["yellow"]);
                }
            }
        }
    }
    MakeNonGreenYellowcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "green" && trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["yellow"]);
                }
            }
        }
    }
    MakeNonRedGreenYellowcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "red" && trans.project.files[file].tags[index] != "darkred" && trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["yellow"]);
                }
            }
        }
    }
    MakeNonRedBluecheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "red" && trans.project.files[file].tags[index] != "darkred" && trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["blue"]);
                }
            }
        }
    }
    underscoreNonRedBluecheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] == "green,yellow") {
                    setRowTag(file, index, ["green"]);
                } else if (trans.project.files[file].tags[index] == "yellow,red") {
                    setRowTag(file, index, ["yellow"]);
                } else if (trans.project.files[file].tags[index] == "blue,yellow") {
                    setRowTag(file, index, ["blue"]);
                } else if (trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "red" && trans.project.files[file].tags[index] != "darkred") {
                    setRowTag(file, index, ["blue"]);
                }
            }
        }
    }
    MakeRedcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["red"]);
                }
            }
        }
    }
    MakeRedcheckRow2(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "green" && trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["red"]);
                }
            }
        }
    }
    MakeUntaggedRedcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "aqua") {
                    setRowTag(file, index, ["red"]);
                }
            }
        }
    }
    MakeUntaggedyellowcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "green,pink" && trans.project.files[file].tags[index] != "green" && trans.project.files[file].tags[index] != "blue,pink" && trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow,pink" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "gold,pink" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "aqua,pink" && trans.project.files[file].tags[index] != "aqua" && trans.project.files[file].tags[index] != "gray,pink" && trans.project.files[file].tags[index] != "gray" && trans.project.files[file].tags[index] != "red,pink" && trans.project.files[file].tags[index] != "red" && trans.project.files[file].tags[index] != "darkred,pink" && trans.project.files[file].tags[index] != "darkred" && trans.project.files[file].tags[index] != "purple,pink" && trans.project.files[file].tags[index] != "purple" && trans.project.files[file].tags[index] != "indigo" && trans.project.files[file].tags[index] != "indigo,pink" && trans.project.files[file].tags[index] != "pink") {
                    setRowTag(file, index, ["yellow"]);
                }
            }
        }
    }
    underscoreYellowRedcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] == "green,yellow") {
                    setRowTag(file, index, ["green"]);
                } else if (trans.project.files[file].tags[index] == "yellow,red") {
                    setRowTag(file, index, ["yellow"]);
                } else if (trans.project.files[file].tags[index] == "blue,yellow") {
                    setRowTag(file, index, ["blue"]);
                } else if (trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["red"]);
                }
            }
        }
    }
    NoJapcheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (trans.project.files[file].tags[index] == "green,pink") {
                setRowTag(file, index, ["green"]);
            }
            if (search != -1) {
                if (text.length > 5000) {
                    setRowTag(file, index, ["yellow"]);
                }
            } else if (trans.project.files[file].tags[index] == "blue") {
                setRowTag(file, index, ["aqua"]);
            } else if (trans.project.files[file].tags[index] == "yellow") {
                setRowTag(file, index, ["gold"]);
            } else if (trans.project.files[file].tags[index] == "red" || trans.project.files[file].tags[index] == "green") {
                setRowTag(file, index, ["darkred"]);
            } else if (trans.project.files[file].tags[index] != "blue" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "green" && trans.project.files[file].tags[index] != "red" && trans.project.files[file].tags[index] != "aqua" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "darkred") {
                setRowTag(file, index, ["gray"]);
            }
        }
    }
    RemoveGreenPink(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (trans.project.files[file].tags[index] == "green,pink") {
                setRowTag(file, index, ["green"]);
            }
            if (search != -1) {
                if (text.length > 5000) {
                    setRowTag(file, index, ["yellow"]);
                }
            }
        }
    }
    reversecheckRow(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["yellow"]);
                }
            } else if (trans.project.files[file].tags[index] != "red" && trans.project.files[file].tags[index] != "yellow" && trans.project.files[file].tags[index] != "gold" && trans.project.files[file].tags[index] != "darkred" && trans.project.files[file].tags[index] != "green,pink") {
                setRowTag(file, index, ["blue"]);
            } else {
                setRowTag(file, index, ["darkred"]);
            }
        }
    }
    reversecheckRow2(file, index, regExp) {
        let text = trans.project.files[file].data[index][0];
        if (text != null && text != undefined) {
            let search = text.search(regExp);
            if (search != -1) {
                if (trans.project.files[file].tags[index] != "green,pink") {
                    setRowTag(file, index, ["yellow"]);
                    potentialEscaperProblem = "true";
                }
            }
        }
    }
}
trans.batchCheckSheet = new RedBatchCheatSheet();
class RedPerformance {
    constructor() {
        this.perfStart = Date.now();
        this.perfEnd = 0;
    }
    end() {
        this.perfEnd = Date.now();
    }
    getSeconds() {
        let timeTaken = this.perfEnd - this.perfStart;
        return (Math.round(timeTaken / 100) / 10);
    }
}
class PostBatch {
    checkCells() {
        ui.log("Checking for errors...");
        setTimeout(() => {
            trans.refreshGrid();
            trans.evalTranslationProgress();
            this.OvercomplicatedErrorAlert();
            this.OvercomplicatedErrorAlert2();
        }, 50);
    }
    // Apply engine review outcomes (the `options._reviewStateByIndex` side-channel
    // written by the DSLR engine's in-line review) to already-known grid rows.
    // rows is an array of objects with a `location` [file, gridRow] pair, aligned
    // with the rows array originally handed to engine.translate(); the batch
    // translator's RedBatchTranslatorRow matches this shape. `translateOptions` must
    // be the same options object passed to translate() — it carries the engine's
    // `_lineToRow` mapping (served line index -> row position) and the per-line
    // outcomes keyed by served line index. Only the `mediumpurple` QC tag is set or
    // cleared; every other tag on the row is preserved. Fails closed when the
    // side-channel is missing. States are aggregated per grid row (a row is
    // flagged when any of its lines is flagged, cleared only when every line of
    // the row was reviewed clean) — see _reviewApplyTags.
    applyReviewTagsToRows(rows, translateOptions) {
        try {
            const stateMap = translateOptions && translateOptions._reviewStateByIndex;
            const lineToRow = translateOptions && translateOptions._lineToRow;
            if (!stateMap || !lineToRow || !Array.isArray(rows)) return;
            const total = {};
            const seen = {};
            const flagged = {};
            for (let t = 0; t < lineToRow.length; t++) {
                total[lineToRow[t]] = (total[lineToRow[t]] || 0) + 1;
            }
            for (const key of Object.keys(stateMap)) {
                const t = parseInt(key, 10);
                const pos = lineToRow[t];
                if (pos == null || pos < 0 || pos >= rows.length) continue;
                seen[pos] = (seen[pos] || 0) + 1;
                if (stateMap[key] === "flag") flagged[pos] = true;
            }
            for (const posKey of Object.keys(total)) {
                const pos = parseInt(posKey, 10);
                if (pos < 0 || pos >= rows.length) continue;
                const rowObj = rows[pos];
                const loc = rowObj && rowObj.location;
                if (!loc) continue;
                const file = loc[0], gridRow = loc[1];
                if (!trans.project.files[file]) continue;
                if (flagged[pos]) {
                    slrFlagTag(file, gridRow, "mediumpurple");
                } else if (seen[pos] === total[pos]) {
                    slrUnflagTag(file, gridRow, "mediumpurple");
                }
            }
        } catch (e) {
            console.warn("[DSLRReview] Failed to apply review tags to rows:", e);
        }
    }
    fixTranslatedCell(file, k, dest) {
        slrFixDest = dest;
        // Start each (re)translation with a clean Errors cell so stale codes don't linger;
        // the error checks below then accumulate fresh codes via slrAddErr().
        let _slrErrRow = trans.project.files[file].data[k];
        if (_slrErrRow) _slrErrRow[slrFixErrCol] = "";
        let contextArr = trans.project.files[file].context[k];
        let contextStr = Array.isArray(contextArr) ? contextArr.join("\n") : (contextArr != null ? String(contextArr) : "");
        let cl = contextStr.toLowerCase();
        if (cl.indexOf("skills") >= 0) this.massReplacerSkills(file, k);
        if (cl.indexOf("states") >= 0) this.massReplacerStates(file, k);
        if (cl.indexOf("system") >= 0) this.massReplacerSystem(file, k);
        if (cl.indexOf("weapons") >= 0) this.massReplacerWeapons(file, k);
        if (file == "Scripts/Vocab.rb") this.massReplacerVocab(file, k);
        if (file == "js/plugins.js") this.massReplacerPlugins(file, k);
        if (cl.indexOf("name") >= 0) this.massReplacerNames(file, k);
        this.OnallmassreplacerRow(file, k);
        this.Onallmassreplacer2Row(file, k);
        this.Onallmassreplacer3Row(file, k);
        if (cl.indexOf("tok/") >= 0) this.massReplacerPlugins2(file, k);
        if (cl.indexOf("system/gametitle") >= 0 || cl.indexOf("system/game_title") >= 0 || cl.indexOf("game.ini/game/title") >= 0) this.ReplacerGameTitle(file, k);
    }
    OvercomplicatedErrorAlert() {
        let files = trans.getAllFiles();
        oceafor: for (let i = 0; i < files.length; i++) {
            let file = files[i];
            let data = trans.project.files[file].data;
            let contexts = trans.project.files[file].context;
            oceafor2: for (let k = 0; k < data.length; k++) {
                let row = data[k];
                let context = contexts[k];
                if (context == undefined || row == undefined || context.length == 0)
                    continue;
                let oceatexts1 = trans.project.files[file].data[k][1]
                let oceatexts2 = trans.project.files[file].data[k][slrFixErrCol]
                if (oceatexts1 != undefined && oceatexts1 != null && oceatexts1 != "") {
                    if (String(oceatexts1).match(/SHISAYE\.[A-Z]/g) != null) {
                        ocerrormessage()
                        break oceafor;
                        break oceafor2;
                    }
                }
                if (oceatexts2 != undefined && oceatexts2 != null && oceatexts2 != "") {
                    if (String(oceatexts2).match(/SHISAYE\.[A-Z]/g) != null) {
                        ocerrormessage()
                        break oceafor;
                        break oceafor2;
                    }
                }
            }
        }

        function ocerrormessage() {
            alert("The system has found one or more problematic cells and inserted corresponding error codes into them.\n\nUse the search function (Crtl+F) and search for \"SHISAYE\" (without quotes) to view a list of them.");
        }
    }
    OvercomplicatedErrorAlert2() {
        // Alert only for tags THIS run added that are still present — never
        // for tags left over from earlier runs. Consumes the per-run tracking
        // so a later run can never see stale entries.
        let added = slrTagsAddedThisRun;
        slrTagsAddedThisRun = null;
        if (added) {
            for (let n = 0; n < added.length; n++) {
                let entry = added[n];
                let file = entry[0], k = entry[1], tag = entry[2];
                if (!trans.project.files[file]) continue;
                if (slrTagList(file, k).includes(tag)) {
                    ocerrormessage2();
                    return;
                }
            }
            return;
        }
        // No run tracked (unknown caller): legacy project-wide scan.
        let files = trans.getAllFiles();
        ocea2for: for (let i = 0; i < files.length; i++) {
            let file = files[i];
            let data = trans.project.files[file].data;
            let contexts = trans.project.files[file].context;
            ocea2for2: for (let k = 0; k < data.length; k++) {
                let row = data[k];
                let context = contexts[k];
                if (context == undefined || row == undefined || context.length == 0 || row[1] == undefined || row[1] == "")
                    continue;
                let ocea2texts1 = trans.project.files[file].data[k][1]
                let ocea2texts2 = trans.project.files[file].data[k][2]
                if (ocea2texts1 != undefined && ocea2texts1 != null && ocea2texts1 != "") {
                    if (slrTagList(file, k).includes("purple") || slrTagList(file, k).includes("mediumpurple")) {
                        ocerrormessage2()
                        break ocea2for;
                        break ocea2for2;
                    }
                }
                if (ocea2texts2 != undefined && ocea2texts2 != null && ocea2texts2 != "") {
                    if (slrTagList(file, k).includes("purple") || slrTagList(file, k).includes("mediumpurple")) {
                        ocerrormessage2()
                        break ocea2for;
                        break ocea2for2;
                    }
                }
            }
        }

        function ocerrormessage2() {
            alert("The system has detected some potentially incomplete, or inaccurate translations and tagged them purple (batch heuristics) or medium purple (semantic review). This is an overly strict check and usually does not actually indicate serious problems.\n\nYou can find them using the search function by selecting \"Tag\" in the \"Target\" drop down menu and then searching for \"purple\" or \"mediumpurple\".");
        }
    }
    massReplacerSkills(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        let contexts = trans.project.files[file].context;
        if (text != null && text != undefined) {
            {
                let context = contexts[index];
                let contextasstring = context.toString();
                //Add new entries for the Skills object here.            
                let shistuff = trans.project.files[file].data[index][slrFixDest];
                let origstuff = trans.project.files[file].data[index][0];
                if (window.transConfig.englishtarget == true) {
                    shistuff = shistuff.replaceAll(/^s attack!/g, " attacks!");
                    shistuff = shistuff.replaceAll(/^is protecting herself./g, " is guarding.");
                    shistuff = shistuff.replaceAll(/^He\'s protecting himself./g, " is guarding.");
                    shistuff = shistuff.replaceAll(/^She ran away./g, " ran away.");
                    shistuff = shistuff.replaceAll(/^Two attacks./g, " launches two attacks.");
                    shistuff = shistuff.replaceAll(/^Dealt damage to 2 opponents./g, " dealt damage to 2 opponents.");
                    shistuff = shistuff.replaceAll(/^Dealt damage to 3 opponents./g, " dealt damage to 3 opponents.");
                    shistuff = shistuff.replaceAll(/^is watching the situation./g, " is watching the situation.");
                    shistuff = shistuff.replaceAll(/^I\'ll see what happens/g, "Observe");
                    shistuff = shistuff.replaceAll(/^exhaled flames!/g, " exhaled flames!");
                    shistuff = shistuff.replaceAll(/^s exhaled the blizzard!/g, " exhaled a blizzard!");
                    shistuff = shistuff.replaceAll(/^I unleashed an electric shock!/g, " unleashed an electric shock!");
                    shistuff = shistuff.replaceAll(/^is unleashing a deadly poison mist!/g, " is unleashing a deadly poison mist!");
                    shistuff = shistuff.replaceAll(/^gave off a blinding light!/g, " gave off a blinding light!");
                    shistuff = shistuff.replaceAll(/^is unleashing a bewitching mist!/g, " is unleashing a bewitching mist!");
                    shistuff = shistuff.replaceAll(/^I unleashed ultrasonic waves!/g, " unleashed ultrasonic waves!");
                    shistuff = shistuff.replaceAll(/^is singing a seductive song!/g, " is singing a seductive song!");
                    shistuff = shistuff.replaceAll(/^I unleashed ultrasonic waves!/g, " unleashed ultrasonic waves!");
                    shistuff = shistuff.replaceAll(/^is singing a seductive song!/g, " is singing a seductive song!");
                    shistuff = shistuff.replaceAll(/^I let out a sweet sigh!/g, " let out a sweet sigh!");
                    shistuff = shistuff.replaceAll(/^is releasing sleeping pollen!/g, " is releasing sleeping pollen!");
                    shistuff = shistuff.replaceAll(/^I let out a numbing breath!/g, " let out a numbing breath!");
                    shistuff = shistuff.replaceAll(/^is glaring sharply at me!/g, " is glaring sharply!");
                    shistuff = shistuff.replaceAll(/^I swept my legs!/g, " performs a leg sweep!");
                    shistuff = shistuff.replaceAll(/^s body slammed into me!/g, " performs a body slam!");
                    shistuff = shistuff.replaceAll(/^He let out a war cry!/g, " let out a war cry!");
                    shistuff = shistuff.replaceAll(/^s bloodsucking attack!/g, " performs bloodsucking attack!");
                    shistuff = shistuff.replaceAll(/^is reciting the cover!/g, " is casting recover!");
                    shistuff = shistuff.replaceAll(/^Queik/g, "Quake");
                    shistuff = shistuff.replaceAll(/^I seduced you!/g, " is seducing!");
                    shistuff = shistuff.replaceAll(/^is running amok!/g, " is running amok!");
                    shistuff = shistuff.replaceAll(/^is smiling./g, " is smiling.");
                    shistuff = shistuff.replaceAll(/^is accumulating power!/g, " is accumulating power!");
                    shistuff = shistuff.replaceAll(/^I hit %1!/g, " hit %1!");
                    shistuff = shistuff.replaceAll(/^took a /g, " took a ");
                    shistuff = shistuff.replaceAll(/^  took a /g, " took a ");
                    shistuff = shistuff.replaceAll(/^s squeaked in an unpleasant voice!/g, " squeaked in an unpleasant voice!");
                    shistuff = shistuff.replaceAll(/^asked for /g, " asked for ");
                    shistuff = shistuff.replaceAll(/^  asked for /g, " asked for ");
                    shistuff = shistuff.replaceAll(/^s swinging his weapon around!/g, " swings a weapon around!");
                    shistuff = shistuff.replaceAll(/^s energy drain!/g, "\'s energy drain!");
                    shistuff = shistuff.replaceAll(/^starts meditating./g, " starts meditating.");
                    shistuff = shistuff.replaceAll(/^is hiding her presence!/g, " is hiding!");
                    shistuff = shistuff.replaceAll(/^s quick shot!/g, "\'s quick shot!");
                    shistuff = shistuff.replaceAll(/^s shield breaker!/g, "\'s shield breaker!");
                    shistuff = shistuff.replaceAll(/^s barrett rain!/g, "\'s barrett rain!");
                    shistuff = shistuff.replaceAll(/^s ultimate flame bullet!/g, "\'s ultimate flame bullet!");
                    shistuff = shistuff.replaceAll(/^s plasma shell!/g, "\'s plasma shell!");
                    shistuff = shistuff.replaceAll(/^s lightning bullets!/g, "\'s lightning bullets!");
                    shistuff = shistuff.replaceAll(/^s ironclad defense!/g, "\'s ironclad defense!");
                    shistuff = shistuff.replaceAll(/^s complete seal!/g, "'s complete seal!");
                    shistuff = shistuff.replaceAll(/^played the inma investigation!/g, " played the inma investigation!");
                    shistuff = shistuff.replaceAll(/^s branch slash!/g, "\'s branch slash!");
                    shistuff = shistuff.replaceAll(/^s four-part thrust!/g, "\'s four-part thrust!");
                    shistuff = shistuff.replaceAll(/^s cross-shaped slash!/g, "\'s cross-shaped slash!");
                    shistuff = shistuff.replaceAll(/^s Samidare Slash!/g, "\'s Samidare Slash!");
                    shistuff = shistuff.replaceAll(/^A big swing!/g, " big swing!");
                    shistuff = shistuff.replaceAll(/^s magic attack!/g, "\'s magic attack!");
                    shistuff = shistuff.replaceAll(/^s ice flower!/g, "\'s ice flower!");
                    shistuff = shistuff.replaceAll(/^s super-large swing!/g, "\'s super-large swing!");
                    shistuff = shistuff.replaceAll(/^s dark law attack!/g, "\'s dark law attack!");
                    shistuff = shistuff.replaceAll(/^s black war spear!/g, "\'s black war spear!");
                    shistuff = shistuff.replaceAll(/^s crimson magic bullets!/g, "\'s crimson magic bullets!");
                    shistuff = shistuff.replaceAll(/^s green light wings!/g, "\'s green light wings!");
                    shistuff = shistuff.replaceAll(/^s lightning flash!/g, "\'s lightning flash!");
                    shistuff = shistuff.replaceAll(/^s inma seal!/g, "\'s inma seal!");
                    shistuff = shistuff.replaceAll(/^s barrage of dark flowers!/g, "\'s barrage of dark flowers!");
                    shistuff = shistuff.replaceAll(/^s vampire spirit flash!/g, "\'s vampire spirit flash!");
                    shistuff = shistuff.replaceAll(/^s succubus poison!/g, "\'s succubus poison!");
                    shistuff = shistuff.replaceAll(/^s inhalation crest!/g, "\'s inhalation crest!");
                    shistuff = shistuff.replaceAll(/^s lewdness spread!/g, "\'s lewdness spread!");
                    shistuff = shistuff.replaceAll(/^s sticker prison!/g, "\'s sticker prison!");
                    shistuff = shistuff.replaceAll(/^s dark barrage attack!/g, "\'s dark barrage attack!");
                    shistuff = shistuff.replaceAll(/^s purple lightning dragon flash!/g, "\'s purple lightning dragon flash!");
                    shistuff = shistuff.replaceAll(/^s pitch black!/g, "\'s pitch black!");
                    shistuff = shistuff.replaceAll(/^s Evil Eye glowed!/g, "\'s Evil Eye glowed!");
                    shistuff = shistuff.replaceAll(/^\, chanted queik!/g, " is casting quake!");
                    shistuff = shistuff.replaceAll(/^is unleashing a powerful attack!/g, " is unleashing a powerful attack!");
                    shistuff = shistuff.replaceAll(/^I mowed him down!/g, " mowed opponents down!");
                    shistuff = shistuff.replaceAll(/^used the mad warrior\'s roar!/g, " let out a mad warrior's roar!");
                    shistuff = shistuff.replaceAll(/^Goddeslan Page/g, "Goddess Rampage");
                    shistuff = shistuff.replaceAll(/^s goddesslan page fired!/g, " fires off a Goddess Rampage!");
                    shistuff = shistuff.replaceAll(/^Mukagekyaku/g, "Shadow Steps");
                    shistuff = shistuff.replaceAll(/^I unleashed my shadow leg!/g, "is using Shadow Steps!");
                    shistuff = shistuff.replaceAll(/^Haryuuzume Enmai/g, "Dragon Claw Round Dance");
                    shistuff = shistuff.replaceAll(/^\, unleashed Dragon Claw Circle Dance!/g, "is using Dragon Claw Round Dance");
                    shistuff = shistuff.replaceAll(/^is protecting her friends./g, " is protecting allies.");
                    shistuff = shistuff.replaceAll(/^is drawing the enemy\'s attention!/g, " is drawing the enemy\'s attention!");
                    shistuff = shistuff.replaceAll(/^I dispel the enemy\'s strengthening magic./g, " dispels strengthening magic.");
                    shistuff = shistuff.replaceAll(/^Ouka Mugenba/g, "Illusion Blade");
                    shistuff = shistuff.replaceAll(/^Ouka unleashed Illusion Blade!/g, "is using Illusion Blade!");
                    shistuff = shistuff.replaceAll(/^is preparing for the enemy\'s magic attack./g, " is preparing for the enemy\'s magic attack.");
                    shistuff = shistuff.replaceAll(/^I grabbed \\\n\[1\]\]\'s body!/g, " grabbed \\\n\[1\]\'s body!");
                    shistuff = shistuff.replaceAll(/^The slime clung to \\\n\[1\]\]\'s body/g, "The slime clung to \\\n\[1\]\'s body");
                    shistuff = shistuff.replaceAll(/^She clings to \\\n\[1\]\] lewdly./g, " clings to \\\n\[1\] lewdly.");
                    shistuff = shistuff.replaceAll(/^I continue groping \\\n\[1\]\]\'s crotch lewdly!/g, "continues groping \\\n\[1\]\'s crotch lewdly!");
                    shistuff = shistuff.replaceAll(/^s tentacles knead \\\n\[1\]\]\'s nipples!/g, "\'s tentacles knead \\\n\[1\]\'s nipples!");
                    shistuff = shistuff.replaceAll(/^Violently raped!/g, " is violently raping!");
                    shistuff = shistuff.replaceAll(/^I groped \\\n\[1\]\]\'s breasts!/g, " is groping \\\n\[1\]\'s breasts!");
                    shistuff = shistuff.replaceAll(/^I put my finger in \\\n\[1\]\]\'s crotch and pistoned \\\c\[0\]!/g, " put a finger in \\\n\[1\]\'s crotch and pistoned\\\c\[0\]!");
                    shistuff = shistuff.replaceAll(/^I groped \\\n\[1\]\]\'s ample bosom, \\\c\[0\]!/g, "I groped \\\n\[1\]\'s ample bosom, \\\c\[0\]!");
                    shistuff = shistuff.replaceAll(/^\\\c\[0\] started raping \\\n\[1\]\]!/g, " started raping \\\n\[1\] \\\c\[0\]!");
                    shistuff = shistuff.replaceAll(/^\\\c\[4\]I planted sperm in \\\n\[1\]\]\\\c\[0\]!/g, " pumped sperm in \\\n\[1\]\\c\[0\] \\\c\[4\]!");
                    shistuff = shistuff.replaceAll(/^I grabbed \\\n\[1\]\'s body!/g, " grabbed \\\n\[1\]\'s body!");
                    shistuff = shistuff.replaceAll(/^The slime clung to \\\n\[1\]\'s body/g, "The slime clung to \\\n\[1\]\'s body");
                    shistuff = shistuff.replaceAll(/^She clings to \\\n\[1\] lewdly./g, " clings to \\\n\[1\] lewdly.");
                    shistuff = shistuff.replaceAll(/^I continue groping \\\n\[1\]\'s crotch lewdly!/g, "continues groping \\\n\[1\]\'s crotch lewdly!");
                    shistuff = shistuff.replaceAll(/^s tentacles knead \\\n\[1\]\'s nipples!/g, "\'s tentacles knead \\\n\[1\]\'s nipples!");
                    shistuff = shistuff.replaceAll(/^I groped \\\n\[1\]\'s breasts!/g, " is groping \\\n\[1\]\'s breasts!");
                    shistuff = shistuff.replaceAll(/^I put my finger in \\\n\[1\]\'s crotch and pistoned \\\c\[0\]!/g, " put a finger in \\\n\[1\]\'s crotch and pistoned\\\c\[0\]!");
                    shistuff = shistuff.replaceAll(/^I groped \\\n\[1\]\'s ample bosom, \\\c\[0\]!/g, "I groped \\\n\[1\]\'s ample bosom, \\\c\[0\]!");
                    shistuff = shistuff.replaceAll(/^\\\c\[0\] started raping \\\n\[1\]!/g, " started raping \\\n\[1\] \\\c\[0\]!");
                    shistuff = shistuff.replaceAll(/^\\\c\[4\]I planted sperm in \\\n\[1\]\\\c\[0\]!/g, " pumped sperm in \\\n\[1\]\\c\[0\] \\\c\[4\]!");
                    shistuff = shistuff.replaceAll(/^I fired off a flying kunai!/g, " fired off a flying kunai!");
                    shistuff = shistuff.replaceAll(/^s serving Mankan Zenpai!/g, " castss serving Mankan Zenpai!");
                    shistuff = shistuff.replaceAll(/^is serving scorching hot food!/g, " is serving scorching hot food!");
                    shistuff = shistuff.replaceAll(/^s entrails gouged out!/g, " uses Gut Gouge");
                    shistuff = shistuff.replaceAll(/^chanted the storm of the night!/g, " casts Night Storm!");
                    shistuff = shistuff.replaceAll(/^s inhalation!/g, " castss inhalation!");
                    shistuff = shistuff.replaceAll(/^I stabbed him with a tail needle!/g, " stabbed with a tail needle!");
                    shistuff = shistuff.replaceAll(/^Scissor attack!/g, " uses a scissor attack!");
                    shistuff = shistuff.replaceAll(/^s mad benevolence/g, "casts Madness of Love");
                    shistuff = shistuff.replaceAll(/^s three gesch/g, " castss Three Gesch!");
                    shistuff = shistuff.replaceAll(/^s bite!/g, " bites!");
                    shistuff = shistuff.replaceAll(/^s went to collide with her entire body!/g, " ran into me with their whole body!");
                    shistuff = shistuff.replaceAll(/^Hikaki/g, "Scratch");
                    shistuff = shistuff.replaceAll(/^s aimed his blade at his opponent!/g, " aimed a blade at the opponent!");
                    shistuff = shistuff.replaceAll(/^Nohikaki!/g, " uses Scratch");
                    shistuff = shistuff.replaceAll(/^s paralysis scratch!/g, " casts paralysis scratch!");
                    shistuff = shistuff.replaceAll(/^s poison scratch!/g, " uses poison scratch!");
                    shistuff = shistuff.replaceAll(/^Zack Zack!/g, " unleashes Zack Zack!");
                    shistuff = shistuff.replaceAll(/^s fire slicing!/g, " casts Fire Slice!");
                    shistuff = shistuff.replaceAll(/^I fired off a gash!/g, " fired off a gash!");
                    shistuff = shistuff.replaceAll(/^is turning into a guardian spirit?/g, " is turning into a guardian spirit?");
                    shistuff = shistuff.replaceAll(/^I\'m possessed!/g, " casts possession!");
                    shistuff = shistuff.replaceAll(/^s trampling!/g, " is trampling!");
                    shistuff = shistuff.replaceAll(/^Called for a storm!/g, " called for a storm!");
                    shistuff = shistuff.replaceAll(/^s life absorption!/g, " casts life absorption!");
                    shistuff = shistuff.replaceAll(/^Nosedive punches!/g, " uses Fistful punch!");
                    shistuff = shistuff.replaceAll(/^is on guard!/g, " is on guard!");
                    shistuff = shistuff.replaceAll(/^is serving forbidden food!/g, " is serving forbidden food!");
                    shistuff = shistuff.replaceAll(/^I groomed it!/g, " groomed!");
                    shistuff = shistuff.replaceAll(/^s jet-black claws!/g, " uses Pitch-black claws");
                    shistuff = shistuff.replaceAll(/^is pointing a poison needle at me./g, " is pointing a poison needle.");
                    shistuff = shistuff.replaceAll(/^is grinding his front teeth!/g, " is grinding their teeth!");
                    shistuff = shistuff.replaceAll(/^is leaping at my opponent\'s body!/g, " is leaping at the opponent\'s body!");
                    shistuff = shistuff.replaceAll(/^s swung his sword straight down at the enemy!/g, " swung a sword straight down at the enemy!");
                    shistuff = shistuff.replaceAll(/^s jumped at his opponent quickly!/g, " jumped at the opponent quickly!");
                    shistuff = shistuff.replaceAll(/^is stabbing me with a knife!/g, " is stabbing with a knife!");
                    shistuff = shistuff.replaceAll(/^s fired his pistol!/g, " fired a pistol!");
                    shistuff = shistuff.replaceAll(/^s tail wagged around!/g, "\'s tail wagged around!");
                    shistuff = shistuff.replaceAll(/^is grinding her teeth!/g, " is grinding her teeth!");
                    shistuff = shistuff.replaceAll(/^put up a thick barrier!/g, " put up a thick barrier!");
                    shistuff = shistuff.replaceAll(/^s swung his rusty knife around!/g, " swung his rusty knife around!");
                    shistuff = shistuff.replaceAll(/^s cut through the entire opponent!/g, " cut through the entire opponent!");
                    shistuff = shistuff.replaceAll(/^\, shouted recklessly as he charged in!/g, " shouted recklessly while charging in!");
                    shistuff = shistuff.replaceAll(/^\, unleashed/g, "is unleashing");
                    shistuff = shistuff.replaceAll(/^I used/g, "is using");
                    shistuff = shistuff.replaceAll(/^s unleashed/g, " is unleashing");
                    shistuff = shistuff.replaceAll(/^I unleashed/g, " is unleashing");
                    shistuff = shistuff.replaceAll(/^I unleash/g, "is unleashing");
                    shistuff = shistuff.replaceAll(/^I chanted/g, " is casting");
                    shistuff = shistuff.replaceAll(/^s chanted/g, " is casting");
                    shistuff = shistuff.replaceAll(/^is chanting/g, " is casting");
                    shistuff = shistuff.replaceAll(/^unleashed/g, " is unleashing");
                    shistuff = shistuff.replaceAll(/^used/g, "is using");
                    shistuff = shistuff.replaceAll(/^Dealt/g, "Deals");
                    shistuff = shistuff.replaceAll(/^It dealt/g, "Deals");
                    shistuff = shistuff.replaceAll(/^I let out/g, " let out");
                    shistuff = shistuff.replaceAll(/^, chanted/g, " is casting");
                    shistuff = shistuff.replaceAll(/^Cast /g, " is casting ");
                    shistuff = shistuff.replaceAll(/^I fired/g, "is firing");
                    shistuff = shistuff.replaceAll(/^He fired/g, "is firing");
                    shistuff = shistuff.replaceAll(/^takes an attack formation!/g, " uses an attack formation!");
                    shistuff = shistuff.replaceAll(/^took a defensive formation!/g, " uses a defensive formation!");
                    shistuff = shistuff.replaceAll(/^I prayed!/g, " prayed!");
                    shistuff = shistuff.replaceAll(/^\, fired/g, " is firing");
                    shistuff = shistuff.replaceAll(/^  is casting/g, " is casting");
                    shistuff = shistuff.replaceAll(/^gave off/g, " is giving off");
                    shistuff = shistuff.replaceAll(/^  is giving off/g, " is giving off");
                    shistuff = shistuff.replaceAll(/^is using/g, " is using");
                    shistuff = shistuff.replaceAll(/^  is using/g, " is using");
                    shistuff = shistuff.replaceAll(/^is firing/g, " is firing");
                    shistuff = shistuff.replaceAll(/^  is firing/g, " is firing");
                    shistuff = shistuff.replaceAll(/^is unleashing/g, " is unleashing");
                    shistuff = shistuff.replaceAll(/^  is unleashing/g, " is unleashing");
                    shistuff = shistuff.replaceAll(/^drank /g, " drank ");
                    shistuff = shistuff.replaceAll(/^  drank /g, " drank ");
                    shistuff = shistuff.replaceAll(/^is releasing /g, " is releasing ");
                    shistuff = shistuff.replaceAll(/^  is releasing /g, " is releasing ");
                    shistuff = shistuff.replaceAll(/^is throwing/g, " is throwing");
                    shistuff = shistuff.replaceAll(/^  is throwing/g, " is throwing");
                    shistuff = shistuff.replaceAll(/^He  is/g, " is");
                    shistuff = shistuff.replaceAll(/^It  is/g, " is");
                    shistuff = shistuff.replaceAll(/^I raise my/g, " raised");
                    shistuff = shistuff.replaceAll(/^He's /g, " is");
                    shistuff = shistuff.replaceAll(/^\' attacks!/g, " attacks!");
                    shistuff = shistuff.replaceAll(/^He hid his presence!/g, " is hiding!");
                    shistuff = shistuff.replaceAll(/^He attacked!/g, " attacked!");
                    shistuff = shistuff.replaceAll(/^He resisted!/g, " resisted!");
                    shistuff = shistuff.replaceAll(/^He swept his legs!/g, " swept legs!");
                    shistuff = shistuff.replaceAll(/^She\'s protecting herself./g, " is guarding.");
                    shistuff = shistuff.replaceAll(/^is watching her./g, " is watching.");
                    shistuff = shistuff.replaceAll(/^He attacked!/g, " attacked!");
                    shistuff = shistuff.replaceAll(/^He glared at me with sharp eyes!/g, " glared at me with sharp eyes!");
                    shistuff = shistuff.replaceAll(/^He exhaled a blizzard!/g, " exhaled a blizzard!");
                    shistuff = shistuff.replaceAll(/^He  exhaled flames!/g, " exhaled flames!");
                    shistuff = shistuff.replaceAll(/^I released/g, " released");
                    shistuff = shistuff.replaceAll(/^He mowed them down!/g, " mowed them down!");
                    shistuff = shistuff.replaceAll(/^He chanted/g, " chanted");
                    shistuff = shistuff.replaceAll(/^She chanted/g, " chanted");
                    shistuff = shistuff.replaceAll(/^I cast/g, " cast");
                    shistuff = shistuff.replaceAll(/^I\'ll treat/g, " treats");
                    shistuff = shistuff.replaceAll(/^She cast/g, " cast");
                    shistuff = shistuff.replaceAll(/^I raise/g, " raises");
                    shistuff = shistuff.replaceAll(/^I gave you/g, " gave");
                    shistuff = shistuff.replaceAll(/^He  let/g, " let");
                    shistuff = shistuff.replaceAll(/^She  is/g, " is");
                    shistuff = shistuff.replaceAll(/^He is/g, " is");
                    shistuff = shistuff.replaceAll(/^Heel/g, "Heal");
                    shistuff = shistuff.replaceAll(/^Laheel/g, "Large Heal");
                    shistuff = shistuff.replaceAll(/^Macheel/g, "Mega Heal");
                    shistuff = shistuff.replaceAll(/^I looked/g, " looked");
                    shistuff = shistuff.replaceAll(/^He roared!/g, " roared!");
                    shistuff = shistuff.replaceAll(/^I slammed into you!/g, " slammed into them!");
                    shistuff = shistuff.replaceAll(/^You is/g, " is");
                    shistuff = shistuff.replaceAll(/^I won't do anything./g, " won't do anything.");
                    shistuff = shistuff.replaceAll(/^She  is/g, " is");
                    shistuff = shistuff.replaceAll(/^He  is/g, " is");
                    shistuff = shistuff.replaceAll(/^It  is/g, " is");
                    shistuff = shistuff.replaceAll(/^  is/g, " is");
                    shistuff = shistuff.replaceAll(/^ chanted her heels!/g, " chanted healing!");
                    shistuff = shistuff.replaceAll(/^ chanted his heel!/g, " chanted healing!");
                    shistuff = shistuff.replaceAll(/^ is casting Halaheel!/g, " is casting Large Healing!");
                    if (contextasstring.match(/message1/g) != null) {
                        shistuff = shistuff.replaceAll(/^([^ \'])/g, " $1");
                        shistuff = shistuff.replaceAll(/  +/g, " ");
                    }
                }
                trans.project.files[file].data[index][slrFixDest] = shistuff;
            }
        }
    }
    massReplacerStates(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        if (text != null && text != undefined) {
            {
                //Add new entries for the States object here.            
                let shistuff = trans.project.files[file].data[index][slrFixDest];
                let origstuff = trans.project.files[file].data[index][0];
                if (window.transConfig.englishtarget == true) {
                    shistuff = shistuff.replaceAll(/^The use of the art has been sealed!/g, " use of the art has been sealed!");
                    shistuff = shistuff.replaceAll(/^He lost his balance!/g, " lost their balance!");
                    shistuff = shistuff.replaceAll(/^She's lost her balance.../g, " lost their balance...");
                    shistuff = shistuff.replaceAll(/^You immobilized me!/g, " immobilized them!");
                    shistuff = shistuff.replaceAll(/^is down!/g, " is down!");
                    shistuff = shistuff.replaceAll(/^You defeated him!/g, " defeated!");
                    shistuff = shistuff.replaceAll(/^stands up!/g, " stood up!");
                    shistuff = shistuff.replaceAll(/^I was poisoned!/g, " was poisoned!");
                    shistuff = shistuff.replaceAll(/^I\'m poisoned!/g, " poisoned!");
                    shistuff = shistuff.replaceAll(/^I poisoned you!/g, " poisoned!");
                    shistuff = shistuff.replaceAll(/^is poisoned!/g, " is poisoned!");
                    shistuff = shistuff.replaceAll(/^is silent!/g, " is silent!");
                    shistuff = shistuff.replaceAll(/^I silenced you!/g, " silenced!");
                    shistuff = shistuff.replaceAll(/^s silence has been broken!/g, "\'s silence has been broken!");
                    shistuff = shistuff.replaceAll(/^is enraged!/g, " is enraged!");
                    shistuff = shistuff.replaceAll(/^I\'m enraged!/g, " enraged!");
                    shistuff = shistuff.replaceAll(/^is captivated!/g, " is captivated!");
                    shistuff = shistuff.replaceAll(/^It captivated me!/g, " captivated!");
                    shistuff = shistuff.replaceAll(/^is asleep!/g, " fell asleep!");
                    shistuff = shistuff.replaceAll(/^is asleep./g, " is sleeping.");
                    shistuff = shistuff.replaceAll(/^is paralyzed!/g, " is paralyzed!");
                    shistuff = shistuff.replaceAll(/^is paralyzed./g, " is paralyzed.");
                    shistuff = shistuff.replaceAll(/^I put up a barrier!/g, " put up a barrier!");
                    shistuff = shistuff.replaceAll(/^The barrier has been lifted!/g, " barrier has been lifted!");
                    shistuff = shistuff.replaceAll(/^The stan has been disarmed!!/g, " stun has been lifted!");
                    shistuff = shistuff.replaceAll(/^s confusion is gone!/g, " \'s confusion is gone!");
                    shistuff = shistuff.replaceAll(/^recovered from paralysis!/g, " recovered from paralysis!");
                    shistuff = shistuff.replaceAll(/^s poison is gone!/g, "\'s poison is gone!");
                    shistuff = shistuff.replaceAll(/^is trapped in darkness!/g, " is trapped in darkness!");
                    shistuff = shistuff.replaceAll(/^I closed myself off to the darkness!/g, " in the dark!");
                    shistuff = shistuff.replaceAll(/^s darkness is gone!/g, "\'s darkness is gone!");
                    shistuff = shistuff.replaceAll(/^s magic has been sealed!/g, "\'s magic has been sealed!");
                    shistuff = shistuff.replaceAll(/^Contained \'s magic!/g, " has magic sealed!");
                    shistuff = shistuff.replaceAll(/^s magic seal is broken!/g, "\'s magic seal is broken!");
                    shistuff = shistuff.replaceAll(/^is confused!/g, " is confused!");
                    shistuff = shistuff.replaceAll(/^You confused me!/g, " confused!");
                    shistuff = shistuff.replaceAll(/^is coming to his senses!/g, " is coming to senses!");
                    shistuff = shistuff.replaceAll(/^I fell asleep!/g, " fell asleep!");
                    shistuff = shistuff.replaceAll(/^I put you to sleep!/g, " put to sleep!");
                    shistuff = shistuff.replaceAll(/^s asleep.../g, " is sleeping...");
                    shistuff = shistuff.replaceAll(/^is awake!/g, " woke up!");
                    shistuff = shistuff.replaceAll(/^I was so numb\, I couldn\'t move!/g, " was numb and couldn\'t move!");
                    shistuff = shistuff.replaceAll(/^I paralyzed you!/g, " paralyzed!");
                    shistuff = shistuff.replaceAll(/^My body is numb and I can\'t move!/g, " body is numb and can\'t move!");
                    shistuff = shistuff.replaceAll(/^s paralysis is gone!/g, "\'s paralysis is gone!");
                    shistuff = shistuff.replaceAll(/^is off balance!/g, " is off balance!");
                    shistuff = shistuff.replaceAll(/^is losing her balance.../g, " is out of balance...");
                    shistuff = shistuff.replaceAll(/^has regained her balance!/g, " has regained balance!");
                    shistuff = shistuff.replaceAll(/^is clad in the power of fire./g, " was imbued with the power of fire.");
                    shistuff = shistuff.replaceAll(/^is clad in ice power./g, " was imbued with the power of ice.");
                    shistuff = shistuff.replaceAll(/^is clad in the power of lightning./g, " was imbued with the power of lightning.");
                    shistuff = shistuff.replaceAll(/^s body has been robbed of its freedom!/g, "\'s body has been robbed of its freedom!");
                    shistuff = shistuff.replaceAll(/^Hyper mode has been removed!/g, " hyper mode has been removed!");
                    shistuff = shistuff.replaceAll(/^is drawing the enemy\'s attention!/g, " is drawing the enemy\'s attention!");
                    shistuff = shistuff.replaceAll(/^is in hyper mode!/g, " is in hyper mode!");
                    shistuff = shistuff.replaceAll(/^Hyper mode has been removed!/g, " hyper mode has been removed!");
                    shistuff = shistuff.replaceAll(/^I put some guts into it!/g, " put some guts into it!");
                    shistuff = shistuff.replaceAll(/^I\'ve got guts!/g, " got guts!");
                    shistuff = shistuff.replaceAll(/^I lowered my stance!/g, " lowered stance!");
                    shistuff = shistuff.replaceAll(/^is clad in gelgar power!/g, " was imbued with the power of gelgar!");
                    shistuff = shistuff.replaceAll(/^I\'ve taken aim!/g, " taken aim!");
                    shistuff = shistuff.replaceAll(/^is building an iron wall fortress!/g, " is building an iron wall fortress!");
                    shistuff = shistuff.replaceAll(/^The Iron Wall Citadel is gone!/g, "\'s Iron Wall Citadel is gone!");
                    shistuff = shistuff.replaceAll(/^has lost its power!/g, " has lost power!");
                    shistuff = shistuff.replaceAll(/^is losing its power!/g, " is losing power!");
                    shistuff = shistuff.replaceAll(/^has regained her power!/g, " has regained power!");
                    shistuff = shistuff.replaceAll(/^s life force has increased!/g, "\'s life force has increased!");
                    shistuff = shistuff.replaceAll(/^s life force is back to normal!/g, "\'s life force is back to normal!");
                    shistuff = shistuff.replaceAll(/^is engulfed in a shining house./g, " is engulfed in a shining house.");
                    shistuff = shistuff.replaceAll(/^s house of Glow is gone/g, "\'s house of Glow is gone");
                    shistuff = shistuff.replaceAll(/^is in formation!/g, " is in formation!");
                    shistuff = shistuff.replaceAll(/^is disarming the formation!/g, " is out of formation!");
                    shistuff = shistuff.replaceAll(/^ put some guts into it!/g, "I put some guts into it!");
                    shistuff = shistuff.replaceAll(/^You\'ve got guts!/g, " got guts!");
                    shistuff = shistuff.replaceAll(/^s stubbornness is gone!/g, "'s guts is gone!");
                    shistuff = shistuff.replaceAll(/^s life force has awakened!/g, "\'s life force has awakened!");
                    shistuff = shistuff.replaceAll(/^is enveloped in the power of holy water!/g, " is enveloped in the power of holy water!");
                    shistuff = shistuff.replaceAll(/^The effects of the holy water have worn off!/g, " The effects of the holy water have worn off!");
                    shistuff = shistuff.replaceAll(/^is out of control!/g, " is out of control!");
                    shistuff = shistuff.replaceAll(/^Unlocks bad mode!/g, " Unlocks bad mode!");
                    shistuff = shistuff.replaceAll(/^s bad mode has been removed!/g, "\'s bad mode has been removed!");
                    shistuff = shistuff.replaceAll(/^I can\'t move!/g, " can\'t move!");
                    shistuff = shistuff.replaceAll(/^s incapacitation has been undone!/g, "\'s incapacitation has been undone!");
                    shistuff = shistuff.replaceAll(/^Invincible is incapacitated!/g, "became invincible and incapable of action!");
                    shistuff = shistuff.replaceAll(/^I left everything to the attack!/g, " left everything to the attack!");
                    shistuff = shistuff.replaceAll(/^has gained a powerful power./g, " has gained a powerful power.");
                    shistuff = shistuff.replaceAll(/^has lost its ability to react!/g, " has lost the ability to react!");
                    shistuff = shistuff.replaceAll(/^has regained her reaction power!/g, " has regained reaction power!");
                    shistuff = shistuff.replaceAll(/^unlocked crystal mode!/g, " unlocked crystal mode!");
                    shistuff = shistuff.replaceAll(/^Crystal mode has been removed!/g, "\'s Crystal mode has been removed!");
                    shistuff = shistuff.replaceAll(/^is in hyper crystal mode!/g, " is in hyper crystal mode!");
                    shistuff = shistuff.replaceAll(/^is captivated./g, " is captivated.");
                    shistuff = shistuff.replaceAll(/^  is captivated./g, " is captivated.");
                    shistuff = shistuff.replaceAll(/^I can't concentrate because I'm worried about my breasts!/g, " can't concentrate because of the breasts!");
                    shistuff = shistuff.replaceAll(/^I can't concentrate because I'm worried about my crotch!/g, " can't concentrate because of the crotch!");
                    shistuff = shistuff.replaceAll(/^is frightened./g, " is frightened.");
                    shistuff = shistuff.replaceAll(/^  is frightened./g, " is frightened.");
                    shistuff = shistuff.replaceAll(/^s field of vision is closed/g, "\'s field of vision is closed");
                    shistuff = shistuff.replaceAll(/^s vision recovered/g, "\'s vision recovered");
                    shistuff = shistuff.replaceAll(/^s exorcism has been sealed!/g, "\'s exorcism has been sealed!");
                    shistuff = shistuff.replaceAll(/^s exorcism magic seal has been broken./g, "\'s exorcism magic seal has been broken.");
                    shistuff = shistuff.replaceAll(/^s body is numb and won't move/g, "\'s body is numb and won't move");
                    shistuff = shistuff.replaceAll(/^s numbness dissipated/g, "\'s numbness dissipated.");
                    shistuff = shistuff.replaceAll(/^\'s numbness dissipated../g, "\'s numbness dissipated.");
                    shistuff = shistuff.replaceAll(/^s body won\'t move./g, "\'s body won\'t move.");
                    shistuff = shistuff.replaceAll(/^s wounds were recovering./g, "\'s wounds are recovering.");
                    shistuff = shistuff.replaceAll(/^s Berserk Mode is undone/g, "\'s Berserk Mode is ends.");
                    shistuff = shistuff.replaceAll(/^\'s Berserk Mode is ends../g, "\'s Berserk Mode ends.");
                    shistuff = shistuff.replaceAll(/^is easier to target from the enemy!/g, " is taunting!");
                    shistuff = shistuff.replaceAll(/^s taunting effect wore off./g, "\'s taunting effect wore off.");
                    shistuff = shistuff.replaceAll(/^s HP will recover!/g, "\'s HP recovers!");
                    shistuff = shistuff.replaceAll(/^has recovered from stan!/g, " has recovered from stun!");
                    shistuff = shistuff.replaceAll(/^My body\'s been restrained!/g, "  body has been restrained!!");
                    shistuff = shistuff.replaceAll(/^He's writhing!/g, " is writhing!");
                    shistuff = shistuff.replaceAll(/^She\' is sleeping.../g, " is sleeping...");
                    shistuff = shistuff.replaceAll(/^I\'m confused!/g, " confused!");
                    shistuff = shistuff.replaceAll(/^The seal on the magic has been lifted!/g, " seal on the magic has been lifted!");
                    shistuff = shistuff.replaceAll(/^Contained the magic of!/g, " magic contained!");
                    shistuff = shistuff.replaceAll(/^The magic has been sealed!/g, " magic has been sealed!");
                    shistuff = shistuff.replaceAll(/^stan!/g, " stunned!");
                    shistuff = shistuff.replaceAll(/^She\'s standing still./g, " is standing still.");
                    shistuff = shistuff.replaceAll(/^is easier to target!/g, " is easier to target!");
                    shistuff = shistuff.replaceAll(/^is harder to target!/g, " is harder to target!");
                    shistuff = shistuff.replaceAll(/^is in a zombie state!/g, " is in a zombie state!");
                    shistuff = shistuff.replaceAll(/^I\'m back to normal!/g, " is back to normal!");
                    shistuff = shistuff.replaceAll(/^has become strong against magic./g, " has become strong against magic.");
                    shistuff = shistuff.replaceAll(/^Flame resistance decreased!/g, "\'s Flame resistance decreased!");
                    shistuff = shistuff.replaceAll(/^Cryo RES decreased!/g, " Cryo RES decreased!");
                    shistuff = shistuff.replaceAll(/^is too horny to focus on battle./g, " is too horny to focus on the battle.");
                    shistuff = shistuff.replaceAll(/^I\'m tied up with rope and can\'t move./g, " is tied up with rope and can\'t move.");
                    shistuff = shistuff.replaceAll(/^The thread the spider spat out got tangled up./g, " was entwined with threads spewed a spider.");
                    shistuff = shistuff.replaceAll(/^My body froze and I couldn\'t move!/g, " body froze and couldn't move!");
                    shistuff = shistuff.replaceAll(/^is too hurt to move./g, " is too hurt to move.");
                    shistuff = shistuff.replaceAll(/^has been poisoned!/g, " has been poisoned!");
                    shistuff = shistuff.replaceAll(/^is too scared to move./g, " is too scared to move.");
                    shistuff = shistuff.replaceAll(/^She\'s flustered about what to do./g, " is flustered about what to do.");
                    shistuff = shistuff.replaceAll(/^is engulfed in flames!/g, " is engulfed in flames!");
                    shistuff = shistuff.replaceAll(/^s body has gone crazy!/g, "\'s body has gone crazy!");
                    shistuff = shistuff.replaceAll(/^Her body still seems strange./g, "\'s body still seems strange.");
                    shistuff = shistuff.replaceAll(/^\'\'s/g, "\'s");
                    shistuff = shistuff.replaceAll(/^  is down!/g, " is down!");
                    shistuff = shistuff.replaceAll(/^Your attack power has increased!/g, " attack power has increased!");
                    shistuff = shistuff.replaceAll(/^Your attack power is back to normal!/g, " attack power is back to normal!");
                    shistuff = shistuff.replaceAll(/^s defense increased!/g, "'s defense increased!");
                    shistuff = shistuff.replaceAll(/^Your defense is back to normal!/g, " defense is back to normal!");
                    shistuff = shistuff.replaceAll(/^My mental fortitude has gone up!/g, " mental fortitude has gone up!");
                    shistuff = shistuff.replaceAll(/^My mental fortitude is back to normal!/g, " mental fortitude is back to normal!");
                    shistuff = shistuff.replaceAll(/^Your Agility increased!/g, " agility increased!");
                    shistuff = shistuff.replaceAll(/^My agility is back to normal!/g, " agility is back to normal!");
                    shistuff = shistuff.replaceAll(/^Your attack power has dropped!/g, " attack power has dropped!");
                    shistuff = shistuff.replaceAll(/^My defenses are down!/g, " defenses are down!");
                    shistuff = shistuff.replaceAll(/^My mental fortitude dropped!/g, " mental fortitude dropped!");
                    shistuff = shistuff.replaceAll(/^My agility has plummeted!/g, " agility has plummeted!");
                    shistuff = shistuff.replaceAll(/^stan!/g, " stunned!");
                    shistuff = shistuff.replaceAll(/^The poison is gone!/g, " poison is gone!");
                    shistuff = shistuff.replaceAll(/^I\'m trapped in darkness!/g, " trapped in darkness!");
                    shistuff = shistuff.replaceAll(/^The darkness is gone!/g, " darkness is gone!");
                    shistuff = shistuff.replaceAll(/^I\'m back to my senses!/g, " came back to senses!");
                    shistuff = shistuff.replaceAll(/^He\'s awake!/g, " is awake!");
                    shistuff = shistuff.replaceAll(/^I\'m so numb  can\'t move!/g, " is numb and can\'t move!");
                    shistuff = shistuff.replaceAll(/^I paralyzed him!/g, " paralyzed!");
                    shistuff = shistuff.replaceAll(/^The paralysis is gone!/g, " paralysis is gone!");
                    shistuff = shistuff.replaceAll(/^I lost my balance!/g, " lost balance!");
                    shistuff = shistuff.replaceAll(/^I\'m losing my balance.../g, " is losing balance.");
                    shistuff = shistuff.replaceAll(/^He regained his balance!/g, " regained balance!");
                    shistuff = shistuff.replaceAll(/^is clad in the power of ice./g, " was imbued with the power of ice.");
                    shistuff = shistuff.replaceAll(/^is clad in lightning./g, " was imbued with the power of lightning.");
                    shistuff = shistuff.replaceAll(/^He stood up!/g, " stood up!");
                    shistuff = shistuff.replaceAll(/^I defeated him!/g, " defeated!");
                    shistuff = shistuff.replaceAll(/^He's down!/g, " is down!");
                    shistuff = shistuff.replaceAll(/^The silence is broken!/g, " silence is broken!");
                    shistuff = shistuff.replaceAll(/^Is enraged!/g, " is enraged!");
                    shistuff = shistuff.replaceAll(/^  is enraged!/g, " is enraged!");
                    shistuff = shistuff.replaceAll(/^I was captivated!/g, " was captivated!");
                    shistuff = shistuff.replaceAll(/^It charmed me!/g, " was charmed!");
                    shistuff = shistuff.replaceAll(/^She\'s asleep./g, " is asleep.");
                    shistuff = shistuff.replaceAll(/^It\'s easier to get targeted!/g, " is easier to get targeted!");
                    shistuff = shistuff.replaceAll(/^It\'s harder to get targeted!/g, " is harder to get targeted!");
                    shistuff = shistuff.replaceAll(/^is ready to counterattack./g, " is ready to counterattack.");
                    shistuff = shistuff.replaceAll(/^She\'s ready to fight back./g, " is ready to fight back.");
                    shistuff = shistuff.replaceAll(/^I got a burn!/g, " got a burn!");
                    shistuff = shistuff.replaceAll(/^My burns are healed!/g, " burns are healed!");
                    shistuff = shistuff.replaceAll(/^Frozen and immobilized!/g, " is frozen and immobilized!");
                    shistuff = shistuff.replaceAll(/^I froze him!/g, " is frozen!");
                    shistuff = shistuff.replaceAll(/^My body is frozen and  can't move!/g, "\'s body is frozen and  can't move!");
                    shistuff = shistuff.replaceAll(/^I can move now!/g, " can move now!");
                    shistuff = shistuff.replaceAll(/^Is sealed!/g, " is sealed!");
                    shistuff = shistuff.replaceAll(/^I\'m starting to get excited...!/g, " is starting to get excited...!");
                    shistuff = shistuff.replaceAll(/^I sealed it away!/g, " sealed away!");
                    shistuff = shistuff.replaceAll(/^The seal has been broken!/g, " seal has been broken!");
                    shistuff = shistuff.replaceAll(/^I slipped into the oil./g, " slipped on the oil.");
                    shistuff = shistuff.replaceAll(/^He\'s falling over./g, " is falling over.");
                    shistuff = shistuff.replaceAll(/^I got up./g, " got up.");
                    shistuff = shistuff.replaceAll(/^I'm drunk./g, " is drunk.");
                    shistuff = shistuff.replaceAll(/^My feet are wobbling./g, " feet are wobbling.");
                    shistuff = shistuff.replaceAll(/^I\'m sober now./g, " is sober now.");
                    shistuff = shistuff.replaceAll(/^Rage has increased your attack power./g, " rage has increased attack power.");
                    shistuff = shistuff.replaceAll(/^I-I\'m drunk./g, " is drunk.");
                    shistuff = shistuff.replaceAll(/^I-I\'m too drunk to move./g, " is too drunk to move.");
                    shistuff = shistuff.replaceAll(/^Th-The light of the flames blocked my eyes./g, " the light of the flames was blinding.");
                    shistuff = shistuff.replaceAll(/^I-I can\'t move because my eyes are blocked./g, " can\'t move because they are blinded.");
                    shistuff = shistuff.replaceAll(/^They swarmed around the offerings./g, " swarmed around the offerings.");
                    shistuff = shistuff.replaceAll(/^I-I\'m engrossed in offerings./g, " is engrossed in offerings.");
                    shistuff = shistuff.replaceAll(/^I calmed down./g, " calmed down.");
                    shistuff = shistuff.replaceAll(/^I got burned!/g, " got burned!");
                    shistuff = shistuff.replaceAll(/^I inflicted a burn on you!/g, " inflicted a burn!");
                    shistuff = shistuff.replaceAll(/^He's burned./g, " burned.");
                    shistuff = shistuff.replaceAll(/^My burns have healed./g, " burns have healed.");
                    shistuff = shistuff.replaceAll(/^Your burns are healed!/g, " burns have healed!");
                    shistuff = shistuff.replaceAll(/^I inflicted frostbite!/g, " inflicted frostbite!");
                    shistuff = shistuff.replaceAll(/^My frostbite has healed./g, " frostbite has healed.");
                    shistuff = shistuff.replaceAll(/^I\'m paralyzed!/g, " paralyzed!");
                    shistuff = shistuff.replaceAll(/^I\'m paralyzed./g, " paralyzed.");
                    shistuff = shistuff.replaceAll(/^The paralysis has healed./g, " paralysis has healed.");
                    shistuff = shistuff.replaceAll(/^It\'s in a slow state!/g, " is in a slow state!");
                    shistuff = shistuff.replaceAll(/^I put you in a slow state!/g, " put them in a slow state!");
                    shistuff = shistuff.replaceAll(/^She\'s in a slow state./g, " is in a slow state.");
                    shistuff = shistuff.replaceAll(/^Has recovered from its slow state./g, " recovered from the slow state.");
                    shistuff = shistuff.replaceAll(/^It stuns!/g, " stuns!");
                    shistuff = shistuff.replaceAll(/^I stunted you!/g, " stunned them!");
                    shistuff = shistuff.replaceAll(/^He\'s standing still./g, " is standing still.");
                    shistuff = shistuff.replaceAll(/^Recovered from stan./g, " recovered from stun.");
                    shistuff = shistuff.replaceAll(/^She\'s confused./g, " is confused.");
                    shistuff = shistuff.replaceAll(/^I came to my senses./g, " came to senses.");
                    shistuff = shistuff.replaceAll(/^I woke up./g, " woke up.");
                    shistuff = shistuff.replaceAll(/^The poison has healed./g, " poison has healed.");
                    shistuff = shistuff.replaceAll(/^My defense is back to normal./g, "\'s defense is back to normal.");
                    shistuff = shistuff.replaceAll(/^My magic defense is down!/g, "\'s magic defense is down!");
                    shistuff = shistuff.replaceAll(/^s magic defense is back to normal./g, "\'s magic defense is back to normal.");
                    shistuff = shistuff.replaceAll(/^She\'s in a daze./g, " is in a daze.");
                    shistuff = shistuff.replaceAll(/^Her attack power returns to normal./g, "\'s attack power returns to normal.");
                    shistuff = shistuff.replaceAll(/^Your magic power has increased!/g, "\'s magic power has increased!");
                    shistuff = shistuff.replaceAll(/^Her agility returned to normal./g, "\'s agility returned to normal.");
                    shistuff = shistuff.replaceAll(/^Your magic defense has increased!/g, "\'s magic defense has increased!");
                    shistuff = shistuff.replaceAll(/^Is poisoned./g, " is poisoned.");
                    shistuff = shistuff.replaceAll(/^I\'m too numb to move!/g, " is too numb to move!");
                    shistuff = shistuff.replaceAll(/^I\'ve broken free of my restraints!/g, " has broken free of restraints!");
                    shistuff = shistuff.replaceAll(/^My body  is paralyzed!/g, " body is paralyzed!");
                    shistuff = shistuff.replaceAll(/^My body is so numb  can\'t move!/g, " body is so numb it can\'t move!");
                    shistuff = shistuff.replaceAll(/^The magic shell effect wears off./g, " magic shell effect wears off.");
                    shistuff = shistuff.replaceAll(/^The protection effect wears off./g, " protection effect wears off.");
                    shistuff = shistuff.replaceAll(/^Is the effect of Regeneration!/g, " has the effect of Regeneration!");
                    shistuff = shistuff.replaceAll(/^Regeneration II\'s effect!/g, " has the effect of RegenerationII!");
                    shistuff = shistuff.replaceAll(/^Frozen!/g, " is frozen!");
                    shistuff = shistuff.replaceAll(/^Is covered by a wall of water!/g, " is covered by a wall of water!");
                    shistuff = shistuff.replaceAll(/^The wall of water covering her has subsided./g, " is no longer covered by a wall of water!");
                    shistuff = shistuff.replaceAll(/^A viscous thread coiled around her body!/g, " viscous thread coiled around her body!");
                    shistuff = shistuff.replaceAll(/^I swung the viscous thread./g, " shook off the sticky thread.");
                    shistuff = shistuff.replaceAll(/^  is/g, " is");
                    shistuff = shistuff.replaceAll(/^  can/g, " can");
                    shistuff = shistuff.replaceAll(/^I deactivated the limiter!/g, " deactivated the limiter!");
                    shistuff = shistuff.replaceAll(/^He took the stance of Seiyo!/g, " took the stance of Seiyo!");
                    shistuff = shistuff.replaceAll(/^I've broken my stance!/g, " broke my stance!");
                    shistuff = shistuff.replaceAll(/^He took an evil stance!/g, " took an evil stance!");
                    shistuff = shistuff.replaceAll(/^The boost is undone!/g, " boost is gone!");
                    shistuff = shistuff.replaceAll(/^I\'ve been poisoned!/g, " has been poisoned!");
                    shistuff = shistuff.replaceAll(/^He\'s bleeding!/g, " is bleeding!");
                    shistuff = shistuff.replaceAll(/^The bleeding is healed!/g, " bleeding is healed!");
                    shistuff = shistuff.replaceAll(/^I\'m cursed!/g, " cursed!");
                    shistuff = shistuff.replaceAll(/^The curse has been lifted!/g, " curse has been lifted!");
                    shistuff = shistuff.replaceAll(/^He's recovering!/g, " is recovering!");
                    shistuff = shistuff.replaceAll(/^Return to the front lines!/g, " returns to the front lines!");
                    shistuff = shistuff.replaceAll(/^I forgot my skills!/g, " forgot their skills!");
                    shistuff = shistuff.replaceAll(/^Contained the skill!/g, " contained the skills!");
                    shistuff = shistuff.replaceAll(/^I remembered the skill!/g, " remembered the skills!");
                    shistuff = shistuff.replaceAll(/^My body has been robbed of its freedom!/g, " body was restrained!");
                    shistuff = shistuff.replaceAll(/^It stopped moving!/g, " stopped moving!");
                    shistuff = shistuff.replaceAll(/^The restraints have been lifted!/g, " restraints have been lifted!");
                    shistuff = shistuff.replaceAll(/^is clad in holy power./g, " is clad in holy power.");
                    shistuff = shistuff.replaceAll(/^  is clad in holy power./g, " is clad in holy power.");
                    shistuff = shistuff.replaceAll(/^I cursed you!/g, " cursed them!");
                    shistuff = shistuff.replaceAll(/^You've been chosen as a target!/g, " has been chosen as a target!");
                    shistuff = shistuff.replaceAll(/^I took aim!/g, " took aim!");
                    shistuff = shistuff.replaceAll(/^Our target has been removed!/g, " target has been removed!");
                    shistuff = shistuff.replaceAll(/^He\'s starting to go berserk!/g, "is starting to go berserk!");
                    shistuff = shistuff.replaceAll(/^The stampede is over!/g, " calmed down!");
                    shistuff = shistuff.replaceAll(/^I\'ve been infected by a virus!/g, " has been infected by a virus!");
                    shistuff = shistuff.replaceAll(/^I was infected by a virus!/g, " was infected by a virus!");
                    shistuff = shistuff.replaceAll(/^The virus is cured!/g, " virus is cured!");
                    shistuff = shistuff.replaceAll(/^We've successfully captured s!/g, " successfully captured!");
                    shistuff = shistuff.replaceAll(/^The weak point attribute has been changed to physics!/g, " is weak to physical!");
                    shistuff = shistuff.replaceAll(/^The weak point attribute has been changed!/g, " weakness has changed!");
                    shistuff = shistuff.replaceAll(/^The weak point attribute has been changed to magic!/g, " is now weak to magic!");
                    shistuff = shistuff.replaceAll(/^The defensive impact has been destroyed!/g, " defensive barrier has been destroyed!");
                    shistuff = shistuff.replaceAll(/^She\'s definitely evading./g, " is definitely evading.");
                    shistuff = shistuff.replaceAll(/^The Absolute Evasion status has been removed./g, " absolute Evasion status has been removed.");
                    shistuff = shistuff.replaceAll(/^The miasma is gone!/g, " miasma is gone!");
                    shistuff = shistuff.replaceAll(/^She\'s definitely evading./g, " is definitely evading.");
                    shistuff = shistuff.replaceAll(/^I\'ve got/g, " got");
                    shistuff = shistuff.replaceAll(/^I'm /g, " is ");
                    shistuff = shistuff.replaceAll(/^It\'s /g, " is ");
                    shistuff = shistuff.replaceAll(/^She\'s /g, " is ");
                    shistuff = shistuff.replaceAll(/^He\'s /g, " is ");
                    shistuff = shistuff.replaceAll(/^They\'re /g, " is ");
                    shistuff = shistuff.replaceAll(/^The /g, " ");
                    shistuff = shistuff.replaceAll(/^He /g, " ");
                    shistuff = shistuff.replaceAll(/^She /g, " ");
                    shistuff = shistuff.replaceAll(/^Her /g, " ");
                    shistuff = shistuff.replaceAll(/^His /g, " ");
                    shistuff = shistuff.replaceAll(/^You\'re /g, " is ");
                    shistuff = shistuff.replaceAll(/^I was /g, " was ");
                    shistuff = shistuff.replaceAll(/^Your /g, " ");
                    shistuff = shistuff.replaceAll(/^You /g, " ");
                    shistuff = shistuff.replaceAll(/^My /g, " ");
                    shistuff = shistuff.replaceAll(/^I /g, " ");
                    shistuff = shistuff.replaceAll(/^Increases /g, " increases ");
                    shistuff = shistuff.replaceAll(/^Resistance /g, " resistance ");
                    shistuff = shistuff.replaceAll(/^is /gi, " is ");
                    shistuff = shistuff.replaceAll(/^([a-z])/g, " $1");
                    shistuff = shistuff.replaceAll("  ", " ");
                    shistuff = shistuff.replaceAll("  ", " ");
                    shistuff = shistuff.replaceAll("  ", " ");
                }
                trans.project.files[file].data[index][slrFixDest] = shistuff;

            }
        }
    }
    massReplacerSystem(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        if (text != null && text != undefined) {
            {
                //Add new entries for the System object here.            
                let shistuff = trans.project.files[file].data[index][slrFixDest];
                let origstuff = trans.project.files[file].data[index][0];
                if (window.transConfig.englishtarget == true) {
                    shistuff = shistuff.replaceAll("Daichi", "Earth");
                    shistuff = shistuff.replaceAll("Kaze", "Wind");
                    shistuff = shistuff.replaceAll("Loeb", "Robe");
                    shistuff = shistuff.replaceAll("Accessoryー", "Accessory");
                    shistuff = shistuff.replaceAll("Contegneー", "Continue");
                    shistuff = shistuff.replaceAll("Rai", "Lightning");
                    shistuff = shistuff.replaceAll("Yumi", "Bow");
                    shistuff = shistuff.replaceAll("Tsuchi", "Mallet");
                    shistuff = shistuff.replaceAll("Tsue", "Cane");
                    shistuff = shistuff.replaceAll("Physics", "Physical");
                    shistuff = shistuff.replaceAll("I\'ll fight.", "Fight");
                    shistuff = shistuff.replaceAll("I\'ll fight", "Fight");
                    shistuff = shistuff.replaceAll("I\'ll take it all off.", "Remove All");
                    shistuff = shistuff.replaceAll("Shut down.", "Shut down");
                    shistuff = shistuff.replaceAll("To the title.", "To the title");
                    shistuff = shistuff.replaceAll("I\'ll stop.", "Cancel");
                    shistuff = shistuff.replaceAll("I\'ll stop", "Cancel");
                    shistuff = shistuff.replaceAll("Game over.", "Quit");
                    shistuff = shistuff.replaceAll("Something important.", "Something important");
                    shistuff = shistuff.replaceAll("Sorting", "Formation");
                    shistuff = shistuff.replaceAll("Continueー", "Continue");
                    shistuff = shistuff.replaceAll("\%1 has appeared!", "\%1 appeared!");
                    shistuff = shistuff.replaceAll("But I couldn\'t run away!", "But couldn\'t escape!");
                    shistuff = shistuff.replaceAll("\%1 \\\G I got the money!", "I got \%1\\\G !");
                    shistuff = shistuff.replaceAll("\%1\\\G Got the money!", "I got \%1\\\G !");
                    shistuff = shistuff.replaceAll("\%1 went up to \%2 \%3!", "\%1 went up to \%2 of \%3!");
                    shistuff = shistuff.replaceAll("\%1 memorized!", "\%1 learned!");
                    shistuff = shistuff.replaceAll("\%1\'s \%2 is \%3 Recovered!", "\%2 of \%1 recovered to \%3!");
                    shistuff = shistuff.replaceAll("\%1\'s \%2 is down \%3!", "\%2 of \%1 has decreased to \%3!");
                    shistuff = shistuff.replaceAll("\%1 lost \%2 \%3!", "\%1 lost \%2 of \%3!");
                    shistuff = shistuff.replaceAll("\%1 took \%2. \%3 You took it!", "\%3 took \%2 from \%1!");
                    shistuff = shistuff.replaceAll("I can\'t damage \%1!", "Can\'t damage \%1!");
                    shistuff = shistuff.replaceAll("\%1 counterattack!", "\%1 counterattacks!");
                    shistuff = shistuff.replaceAll("\%1 covered for %2!", "\%1 guarded %2!");
                    shistuff = shistuff.replaceAll("Option", "Options");
                    shistuff = shistuff.replaceAll("Optionss", "Options");
                    shistuff = shistuff.replaceAll("Sell it", "Sell");
                    shistuff = shistuff.replaceAll("Sell.", "Sell");
                    shistuff = shistuff.replaceAll("Mitsuru", "Light");
                    shistuff = shistuff.replaceAll("Freyle", "Flail");
                    shistuff = shistuff.replaceAll("Quickness.", "Agility");
                    shistuff = shistuff.replaceAll("You're lucky.", "Luck");
                    shistuff = shistuff.replaceAll("Skill Tuuliー", "Skill Tree");
                    shistuff = shistuff.replaceAll("s belongings", "Belongings");
                    shistuff = shistuff.replaceAll("Max HP", "MaxＨＰ");
                    shistuff = shistuff.replaceAll("Max MP", "MaxＭＰ");
                    shistuff = shistuff.replaceAll("The number you have.", "The number you have");
                    shistuff = shistuff.replaceAll("From the beginning.", "New Game");
                    shistuff = shistuff.replaceAll("Darkness.", "Darkness");
                    shistuff = shistuff.replaceAll("Head.", "Head");
                    shistuff = shistuff.replaceAll("Body.", "Body");
                    shistuff = shistuff.replaceAll("Defense", "Guard");
                    shistuff = shistuff.replaceAll("A fist.", "Fists");
                    shistuff = shistuff.replaceAll("Hijiri", "Holy");
                    shistuff = shistuff.replaceAll("Shoes.", "Shoes");
                    shistuff = shistuff.replaceAll("Touchui", "Touch UI");
                    shistuff = shistuff.replaceAll("Fleil", "Flail");
                    shistuff = shistuff.replaceAll("Grove", "Gloves");
                    shistuff = shistuff.replaceAll("Vigor.", "Vitality");
                    shistuff = shistuff.replaceAll("Hikari", "Light");
                    shistuff = shistuff.replaceAll("Nothing.", "Nothing");
                    shistuff = shistuff.replaceAll("BGM\, volume.", "BGM Volume");
                    shistuff = shistuff.replaceAll("Always dashing.", "Always Dash");
                    shistuff = shistuff.replaceAll("I\'m good at this.", "Dexterity");
                    shistuff = shistuff.replaceAll("I\'m going back.", "Back");
                    shistuff = shistuff.replaceAll("It\'s over", "Quit");
                    shistuff = shistuff.replaceAll(/^Ji/g, "Earth");
                    shistuff = shistuff.replaceAll("Kodachi", "Small Sword");
                }
                trans.project.files[file].data[index][slrFixDest] = shistuff;

            }
        }
    }
    massReplacerWeapons(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        if (text != null && text != undefined) {
            {
                //Add new entries for the Weapon object here.
                let shistuff = trans.project.files[file].data[index][slrFixDest];
                let origstuff = trans.project.files[file].data[index][0];
                if (window.transConfig.englishtarget == true) {
                    shistuff = shistuff.replaceAll(/^It was a /g, "A ");
                }
                trans.project.files[file].data[index][slrFixDest] = shistuff;

            }
        }
    }    
    massReplacerPlugins2(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        if (text != null && text != undefined) {
            {
                //Add new entries for individual plugin files here.
                let shistuff = trans.project.files[file].data[index][slrFixDest];
                let origstuff = trans.project.files[file].data[index][0];
                if (origstuff.match(/^["]/g) != null && origstuff.match(/["]$/g) != null) {
                    shistuff = shistuff.replaceAll(/^"|"$/g, "");
                }
                if (origstuff.match(/^[']/g) != null && origstuff.match(/[']$/g) != null) {
                    shistuff = shistuff.replaceAll(/^'|'$/g, "");
                }
                trans.project.files[file].data[index][slrFixDest] = shistuff;

            }
        }
    }
    massReplacerNames(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        if (text != null && text != undefined) {
            {
                //Add new entries for "name" context specific fixes here
                let shistuff = trans.project.files[file].data[index][slrFixDest];
                let origstuff = trans.project.files[file].data[index][0];
                if (window.transConfig.englishtarget == true) {
                    if (shistuff.match(/[\.。]/gi) == null) {
                        shistuff = shistuff.replaceAll(/\.$/gi, "");
                    }
                }
                trans.project.files[file].data[index][slrFixDest] = shistuff;
            }
        }
    }
    massReplacerVocab(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        if (text != null && text != undefined) {
            //Add new entries for the Vocab object here.            
            let shistuff = trans.project.files[file].data[index][slrFixDest];
            let origstuff = trans.project.files[file].data[index][0];
            if (window.transConfig.englishtarget == true) {
            }
            trans.project.files[file].data[index][slrFixDest] = shistuff;
        }
    }

    massReplacerPlugins(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        let contexts = trans.project.files[file].context;
        if (text != null && text != undefined) {
            let context = contexts[index];
            let contextasstring = context.toString();
            //Add new entries for the plugins object here.            
            let shistuff = trans.project.files[file].data[index][slrFixDest];
            let origstuff = trans.project.files[file].data[index][0];
            if (window.transConfig.englishtarget == true) {
                if (contextasstring.match(/Names|Vocab/g) != null) {
                    if (origstuff.match(/, /g) == null) {
                        shistuff = shistuff.replaceAll(/, +/g, ",");
                    }
                }
            }
            trans.project.files[file].data[index][slrFixDest] = shistuff;
        }
    }

    OnallmassreplacerRow(file, k) {
        let data = trans.project.files[file].data;
        let contexts = trans.project.files[file].context;
        do {
            let row = data[k];
            let context = contexts[k];
                // Skip empty / untranslated lines
                if (context == undefined || row == undefined || context.length == 0 || row[slrFixDest] == undefined || row[slrFixDest] == "")
                    continue;
                //make stuff less long
                let shistuff = trans.project.files[file].data[k][slrFixDest];
                let origstuff = trans.project.files[file].data[k][0];
                //make context checkable
                let contextasstring = context.toString();

                //check if there is a viable translation
                //Report Sugoi Errors
                /* if (shistuff.match(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([A-Y])\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\\]\)\}]|$)/g) != null) {
                slrAddErr(file, k, shistuff.replaceAll(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([A-Y])\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\\]\)\}]|$)/g, "　SHISAYE.$1$1$1SUGOIERROR　"));
                }
                if (shistuff.match(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([A-Y][\-])\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\]|$)/g) != null) {
                slrAddErr(file, k, shistuff.replaceAll(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([A-Y][\-])\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\]|$)/g, "　SHISAYE.$1$1$1SUGOIERROR　"));
                }
                if (shistuff.match(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([a-y])\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\\]\)\}]|$)/g) != null) {
                slrAddErr(file, k, shistuff.replaceAll(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([a-y])\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\\]\)\}]|$)/g, "　SHISAYE.$1$1$1SUGOIERROR　"));
                }
                if (shistuff.match(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([a-y][\-])\1\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\]|$)/g) != null) {
                slrAddErr(file, k, shistuff.replaceAll(/(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z\\]|^)([a-y][\-])\1\1\1\1+(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶa-zA-Z！？!?,\.、。♡❤♥\\]|$)/g, "　SHISAYE.$1$1$1SUGOIERROR　"));
                } */    
                if (shistuff.match(/\d+xF\d+/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\d+xF\d+/g, "　SHISAYE.$1SUGOIERROR　"));
                }
                // Legacy purple length-ratio heuristic. Array-aware through
                // slrFlagTag/slrUnflagTag: it adds or removes only `purple` and
                // never disturbs the row's other tags, so it can coexist with the
                // semantic review's `mediumpurple` QC tag — the two systems flag
                // different things on the same row.
                if (window.transConfig.japanesesource == true) {
                    if (!slrTagList(file, k).some((t) => t == "red" || t == "darkred" || t == "gold" || t == "aqua" || t == "gray")) {
                        let datakorignoemptylines = origstuff.replaceAll(/^[　 \s]*\n/gm, "");
                        let datakorigtrim = origstuff.replaceAll(/[　 \s]+/g, "");
                        datakorigtrim = datakorigtrim.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1)\1+/gi, "$1$2");
                        datakorigtrim = datakorigtrim.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+?)(\1)\1+/gi, "$1$2");
                        if (datakorignoemptylines.match(/\n[^〔〖〘〚〝〞”｢〈《「『【（［\[\({＜<｛｟⟨"'´`].*[\s]/g) != null) {
                            datakorigtrim = datakorigtrim.replaceAll(/[あおいウえ]+[ぉぁぃゥぇ]+[あおいウえぉぁぃゥぇっッー～〜…~]*/g, "");
                            datakorigtrim = datakorigtrim.replace(/([^0123456789０１２３４５６７８９\\#@$%\/_\|])\1+/, "");
                            datakorigtrim = datakorigtrim.replace(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+)\1+/, "");
                            var datakorigtrimreduc = datakorigtrim.length / 1.5;
                            var shistufftrimmed = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1)\1+/gi, "$1$2");
                            shistufftrimmed = shistufftrimmed.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+?)(\1\1)\1+/gi, "$1$2");
                            shistufftrimmed = shistufftrimmed.replace(/([^0123456789０１２３４５６７８９\\#@$%\/_\|])\1+/, "");
                            shistufftrimmed = shistufftrimmed.replace(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+)\1+/, "");
                        } else {
                            datakorigtrim = datakorigtrim.replace(/[あおいウえ]+[ぉぁぃゥぇ]+[あおいウえぉぁぃゥぇっッー～〜…~]*/, "");
                            datakorigtrim = datakorigtrim.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|])\1+/g, "");
                            datakorigtrim = datakorigtrim.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+?)\1+/g, "");
                            var datakorigtrimreduc = datakorigtrim.length / 1.5;
                            var shistufftrimmed = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1)\1+/gi, "$1$2");
                            shistufftrimmed = shistufftrimmed.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+?)(\1\1)\1+/gi, "$1$2");
                            shistufftrimmed = shistufftrimmed.replace(/([^0123456789０１２３４５６７８９\\#@$%\/_\|])\1+/, "$1");
                            shistufftrimmed = shistufftrimmed.replace(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+)\1+/, "$1");
                        }
                        if (datakorigtrimreduc > shistufftrimmed.length) {
                            slrFlagTag(file, k, "purple");
                        } else {
                            slrUnflagTag(file, k, "purple");
                        }
                    }
                } else {
                    if (origstuff.length / 5 > shistuff.length || origstuff.length * 5 < shistuff.length) {
                        slrFlagTag(file, k, "purple");
                    } else {
                        slrUnflagTag(file, k, "purple");
                    }
                }
                if (window.transConfig.englishtarget == true) {
                //Check for numbers and punctuation that should be present in the translation
                     if (origstuff.match(/[0123456789!?$%？！＄％０１２３４５６７８９]/g) != null) {
                       if ((origstuff.match(/[0０]/gi) != null && shistuff.match(/0|０|zero|null|nothing/gi) == null) || (origstuff.match(/[1１]/gi) != null && shistuff.match(/1|１|one|once|sing|first|ten|hundred|thousand|illion|single/gi) == null) || (origstuff.match(/[2２]/gi) != null && shistuff.match(/2|２|two|twice|again|repeat|twent|second|double|pair/gi) == null) || (origstuff.match(/[3３]/gi) != null && shistuff.match(/3|３|three|third||thirt|triple|trouple/gi) == null) || (origstuff.match(/[4４]/gi) != null && shistuff.match(/4|４|four|quadrouple/gi) == null) || (origstuff.match(/[5５]/gi) != null && shistuff.match(/5|５|five|fift|penta/gi) == null) || (origstuff.match(/[6６]/gi) != null && shistuff.match(/6|６|six/gi) == null) || (origstuff.match(/[7７]/gi) != null && shistuff.match(/7|７|seven/gi) == null) || (origstuff.match(/[8８]/gi) != null && shistuff.match(/8|８|eight|octo/gi) == null) || (origstuff.match(/[9９]/gi) != null && shistuff.match(/9|９|nine/gi) == null) || (origstuff.match(/[!！]/gi) != null && shistuff.match(/!|！/gi) == null) || (origstuff.match(/[\?？]/gi) != null && shistuff.match(/\?|？/gi) == null && origstuff.match(/[\?？!！][\?？!！]/gi) == null) || (origstuff.match(/[\$＄]/gi) != null && shistuff.match(/\$|＄/gi) == null) || (origstuff.match(/[\%％]/gi) != null && shistuff.match(/\%|％|percent/gi) == null)) {
                         if (!slrTagList(file, k).some((t) => t == "yellow" || t == "blue" || t == "green" || t == "pink" || t == "red")) {
                            slrFlagTag(file, k, "purple");
                         }
                       }
                     }
                 }
                 //Remove placeholder errors and tag the cells instead.
                 if (shistuff.match(/　SHISAYE\.LOSTPLACEHOLDERMIDDLE　/g) != null) {
                     shistuff = shistuff.replaceAll(/　SHISAYE\.LOSTPLACEHOLDERMIDDLE　/g, "");
                     if (!slrTagList(file, k).some((t) => t == "yellow" || t == "blue" || t == "green" || t == "pink" || t == "red")) {
                         slrFlagTag(file, k, "purple");
                     }
                 }
                 let originallinebreaktrim = origstuff.replaceAll(/^[\n\r]+/g, "");
                 originallinebreaktrim = originallinebreaktrim.replaceAll(/[\n\r]+$/g, "");
                 let responselinebreaktrim = shistuff.replaceAll(/^[\n\r]+/g, "");
                 responselinebreaktrim = responselinebreaktrim.replaceAll(/[\n\r]+$/g, "");
                 if (slrTagList(file, k).some((t) => t == "yellow" || t == "blue" || t == "green" || t == "pink" || t == "red")) {
                     if(originallinebreaktrim.toString().split('\n').length < responselinebreaktrim.toString().split('\n').length || originallinebreaktrim.toString().split('\n').length > responselinebreaktrim.toString().split('\n').length) {
                         slrFlagTag(file, k, "purple");
                     }
                 }
                 //Remove translation fail errors and tag the cells instead.
                 if (shistuff.match(/　SHISAYE\.TRANSLATIONFAIL　/g) != null) {
                     shistuff = shistuff.replaceAll(/　SHISAYE\.TRANSLATIONFAIL　/g, "");
                     if (!slrTagList(file, k).some((t) => t == "yellow" || t == "blue" || t == "green" || t == "pink" || t == "red")) {
                         slrFlagTag(file, k, "purple");
                     }
                 }
                function replaceAllExceptScripts(raInput, raPattern, raReplacement) {
                    raPattern = raPattern.replaceAll(/(.+)Sд(.*)/g , "(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)(?<!\\\\G\\\[|\\\\fs\\\[|\\\\RB\\\[|\\\\rb\\\[|\\\\p\\\[|\\\\l\\\[|\\\\r\\\[|\\\\F\\\[|\\\\FF\\\[|\\\\FFF\\\[|\\\\FFFF\\\[|\\\\FFFFF\\\[|\\\\FFFFFF\\\[|\\\\FFFFFFF\\\[|\\\\FFFFFFFF\\\[|\\\\FFFFFFFFF\\\[|\\\\FFFFFFFFFF\\\[|\\\\A\\\[|\\\\AA\\\[|\\\\AAA\\\[|\\\\AAAA\\\[|\\\\AAAAA\\\[|\\\\AAAAAA\\\[|\\\\AAAAAAA\\\[|\\\\AAAAAAAA\\\[|\\\\AAAAAAAAA\\\[|\\\\AAAAAAAAAA\\\[|\\\\p\\\[|\\\\FH\\\[|\\\\SVVN\\\[|\\\\se\\\[|\\\\SE\\\[|\\\\_SE\\\[|\\\\M\\\[|\\\\i\\\[|\\\\v\\\[|\\\\oc\\\[|\\\\VS\\\[|\\\\NA\\\[|\\\\vs\\\[|\\\\na\\\[|\\\\PICN\\\[|\\\\PICE\\\[|\\\\picn\\\[|\\\\pice\\\[)$1(?=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|\$)$2");
                    const regexPattern = new RegExp(raPattern, 'g');
                    return raInput.replace(regexPattern, raReplacement);
                }
                if (window.transConfig.englishtarget == true) {
                    if (shistuff.match(/[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]/g) != null) {
                        //Add new entries that should be run on all cells, like escaped translations, here.
                        //Pre defined MV/MZ System Scripts
                        shistuff = replaceAllExceptScripts(shistuff, "%1には効かなかった！Sд", "It didn't work on %1");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は %2 のダメージを受けた！Sд", "%1 took %2 damage!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は%2を %3 奪われた！Sд", "%1 lost %2 %3!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の%2が %3 増えた！Sд", "%1 %2 increased by %3!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の%2が %3 減った！Sд", "%1 %2 decreased by %3!");
                        shistuff = replaceAllExceptScripts(shistuff, "ミス！　%1はダメージを受けていない！Sд", "Miss! %1 hasn't taken any damage!");
                        shistuff = replaceAllExceptScripts(shistuff, "ミス！　%1にダメージを与えられない！Sд", "Miss! %1 cannot be damaged!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1はダメージを受けていない！Sд", "%1 hasn't taken any damage!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の%2が %3 回復した！Sд", "%1 %2 has recovered %3!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の%2が上がった！Sд", "%1 %2 increased!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の%2が元に戻った！Sд", "%1 %2 is back to normal!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の反撃！Sд", "%1 counterattacks!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の%2が下がった！Sд", "%1's %2 is down!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は戦いに敗れた.Sд", "%1 lost the battle.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1が出現！Sд", "%1 has appeared!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1に %2 のダメージを与えた！Sд", "Dealt %2 damage to %1!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の%2を %3 奪った！Sд", "%1 took %2 from %3!");
                        shistuff = replaceAllExceptScripts(shistuff, "ミス！ %1にダメージを与えられない！Sд", "Miss! Can't do any damage to %1!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は逃げ出した！Sд", "%1 escaped!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は攻撃をかわした！Sд", "%1 dodged the attack!");
                        shistuff = replaceAllExceptScripts(shistuff, "次の%1までSд", "%1 until the next level.");
                        shistuff = replaceAllExceptScripts(shistuff, "現在の%1Sд", "Current %1.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は%2 %3 に上がった！Sд", "%1 went up to %2 %3!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は魔法を打ち消した！Sд", "%1 wiped out the magic!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は魔法を跳ね返した！Sд", "%1 bounced off the magic!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1 の%2を獲得！Sд", "Obtained %1 %2!");
                        shistuff = replaceAllExceptScripts(shistuff, "お金を %1\\\\G 手に入れた！Sд", "Obtained %1 \\G!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を手に入れた！Sд", "%1 obtained!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を覚えた！Sд", "%1 learned!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1たちSд", "%1's party");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は先手を取った！Sд", "%1 made the first move!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1が%2をかばった！Sд", "%1 covered %2!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は不意をつかれた！Sд", "%1 was caught off guard!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は%2を使った！Sд", "%1 used %2!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の勝利！Sд", "%1 is victorious!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1にダメージを与えられない！Sд", "Cannot damage %1");
                        //shistuff = replaceAllExceptScripts(shistuff, "  Sд", "  ");
                        //Pre defined MV/MZ States Scripts
                        shistuff = replaceAllExceptScripts(shistuff, "%1は倒れた！Sд", "%1 collapsed!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を倒した！Sд", "%1 defeated!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は立ち上がった！Sд", "%1 stood up!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は毒にかかった！Sд", "%1 got poisoned!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1に毒をかけた！Sд", "Poisoned %1!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の毒が消えた！Sд", "%1's poison is gone!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は暗闇に閉ざされた！Sд", "%1 is trapped in darkness!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を暗闇に閉ざした！Sд", "%1 is trapped in darkness!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の暗闇が消えた！Sд", "%1's darkness is gone!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は沈黙した！Sд", "%1 is silenced!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を沈黙させた！Sд", "Silenced %1!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の沈黙が解けた！Sд", "%1's silence is broken!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は激昂した！Sд", "%1 is enraged!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を激昂させた！Sд", "%1 is enraged!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は我に返った！Sд", "%1 calmed down!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は混乱した！Sд", "%1 is confused!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を混乱させた！Sд", "Confused %1!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は魅了された！Sд", "%1 is charmed!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を魅了した！Sд", "%1 is charmed!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は眠った！Sд", "%1 is asleep!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を眠らせた！Sд", "%1 is sleeping!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は眠っている。Sд", "%1 is asleep.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は目を覚ました！Sд", "%1 woke up!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1はしびれて動けなくなった！Sд", "%1 is too numb to move!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1を麻痺させた！Sд", "%1 is paralyzed!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は体がしびれて動けない！Sд", "%1's body is too numb to move!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の麻痺が解けた！Sд", "%1's paralysis is gone!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1はバランスを崩した！Sд", "%1 lost balance!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1はバランスを崩している……Sд", "%1 is off balance...");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は体勢を立て直した！Sд", "%1 regained balance!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は狙われやすくなった！Sд", "%1 is easier to target!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は狙われにくくなった！Sд", "%1 is less likely to be targeted!");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は炎の力を身にまとった。Sд", "%1 has the power of fire.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は氷の力を身にまとった。Sд", "%1 has the power of ice.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は雷の力を身にまとった。Sд", "%1 has the power of lightning.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は炎や氷の攻撃に強くなったSд", "%1 has become more resistant to fire and ice attacks.");
                        shistuff = replaceAllExceptScripts(shistuff, "炎や氷に強くなっているSд", "They're getting stronger against fire and ice.");
                        shistuff = replaceAllExceptScripts(shistuff, "水のガードの効果が切れたSд", "The effects of the water guard have worn off.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は分身して２回行動できるようになったSд", "%1 split and was able to act twice.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1は分身しているSд", "%1 is cloned.");
                        shistuff = replaceAllExceptScripts(shistuff, "%1の分身が切れたSд", "%1's clone ran out.");
                        //shistuff = replaceAllExceptScripts(shistuff, "  Sд", "  ");
                        //Pre defined VX/Ace Vocab Scripts
                        shistuff = replaceAllExceptScripts(shistuff, "購入するSд", "Buy");
                        shistuff = replaceAllExceptScripts(shistuff, "売却するSд", "Sell");
                        shistuff = replaceAllExceptScripts(shistuff, "やめるSд", "Cancel");
                        shistuff = replaceAllExceptScripts(shistuff, "持っている数Sд", "In Possession");
                        shistuff = replaceAllExceptScripts(shistuff, "現在の経験値Sд", "Current EXP");
                        shistuff = replaceAllExceptScripts(shistuff, "次の%sまでSд", "Until the next %s");
                        shistuff = replaceAllExceptScripts(shistuff, "どのファイルにセーブしますか？Sд", "To which file should we save?");
                        shistuff = replaceAllExceptScripts(shistuff, "どのファイルをロードしますか？Sд", "Which file would you like to load?");
                        shistuff = replaceAllExceptScripts(shistuff, "ファイルSд", "File");
                        shistuff = replaceAllExceptScripts(shistuff, "%sたちSд", "%s used!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sが出現！Sд", "%s appeared!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは先手を取った！Sд", "%s makes the first move!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは不意をつかれた！Sд", "%s was caught off guard!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは逃げ出した！Sд", "%s ran away!");
                        shistuff = replaceAllExceptScripts(shistuff, "しかし逃げることはできなかった！Sд", "But there is no escape!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの勝利！Sд", "%s is victorious!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは戦いに敗れた。Sд", "%s lost the battle.");
                        shistuff = replaceAllExceptScripts(shistuff, "%s の経験値を獲得！Sд", "%s EXP gained!");
                        shistuff = replaceAllExceptScripts(shistuff, "お金を %s\\\\\\\\G 手に入れた！Sд", "I got %s\\G!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sを手に入れた！Sд", "%s obtained!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは%s %s に上がった！Sд", "%s went up to %s %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sを覚えた！Sд", "%s learned!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは%sを使った！Sд", "%s used %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "会心の一撃！！Sд", "A critical strike!");
                        shistuff = replaceAllExceptScripts(shistuff, "痛恨の一撃！！Sд", "A painful blow!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは %s のダメージを受けた！Sд", "%s took %s damage!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sが %s 回復した！Sд", "%s of %s recovered %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sが %s 増えた！Sд", "%s of %s has increased by %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sが %s 減った！Sд", "%s of %s decreased by %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは%sを %s 奪われた！Sд", "%s of %s robbed by %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "ミス！　%sはダメージを受けていない！Sд", "Miss! %s did not take damage!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sはダメージを受けていない！Sд", "%s did not take damage!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sに %s のダメージを与えた！Sд", "Dealt %s damage to %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sを %s 奪った！Sд", "Stole %s of %s from %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "ミス！　%sにダメージを与えられない！Sд", "Miss! Can't damage %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sにダメージを与えられない！Sд", "Can't damage %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは攻撃をかわした！Sд", "%s dodged the attack!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは魔法を打ち消した！Sд", "%s canceled out the magic!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは魔法を跳ね返した！Sд", "%s repelled the magic!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの反撃！Sд", "%s counterattacks!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sが%sをかばった！Sд", "%s defended %s!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sが上がった！Sд", "%s of %s increased!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sが下がった！Sд", "%s of %s decreased!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sが元に戻った！Sд", "%s of %s returned to normal!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sには効かなかった！Sд", "It didn't work on %s");
                        shistuff = replaceAllExceptScripts(shistuff, "お金を %s%s 手に入れた！Sд", "I got %s %s money!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの攻撃！Sд", "%s Attacks!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは身を守っている。Sд", "%s is guarding.");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは逃げてしまった。Sд", "%s ran away.");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは様子を見ている。Sд", "%s is watching.");
                        shistuff = replaceAllExceptScripts(shistuff, "%sが現れた！Sд", "%s appeared!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの先制！Sд", "%s takes the lead!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは退却したSд", "%s retreated.");
                        shistuff = replaceAllExceptScripts(shistuff, "戦闘に勝利したSд", "Victory!");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは戦いに敗れた…Sд", "%s lost the battle...");
                        shistuff = replaceAllExceptScripts(shistuff, "%s の経験値を獲得Sд", "Obtained %s experience.");
                        shistuff = replaceAllExceptScripts(shistuff, "%s\\\\\\\\G 手に入れたSд", "Received %s \\\\G.");
                        shistuff = replaceAllExceptScripts(shistuff, "%sを手に入れたSд", "%s obtained.");
                        shistuff = replaceAllExceptScripts(shistuff, "%sは%s %s に上がったSд", "%s went up to %s %s.");
                        shistuff = replaceAllExceptScripts(shistuff, "%sを覚えたSд", "%s learned!");
                        shistuff = replaceAllExceptScripts(shistuff, "所持数Sд", "Owned");
                        shistuff = replaceAllExceptScripts(shistuff, "お金を %s%s 失った。Sд", "I lost %s %s of my money.");
                        shistuff = replaceAllExceptScripts(shistuff, "%sの%sが %s に下がってしまった。Sд", "%s went down to %s %s.");
                        //shistuff = replaceAllExceptScripts(shistuff, "  Sд", "  ");
                        //Predefined Translations
                        shistuff = replaceAllExceptScripts(shistuff, "カナSд([❤♥♡…！？。、･♪]*)", "Kana$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "決定Sд([❤♥♡…！？。、･♪]*)", "Done$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "英数Sд([❤♥♡…！？。、･♪]*)", "ＡＢＣ$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "かなSд([❤♥♡…！？。、･♪]*)", "kana$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "続きからSд([❤♥♡…！？。、･♪]*)", "Continue$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "昼Sд([❤♥♡…！？。、･♪]*)", "Noon$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【剣】([❤♥♡…！？。、･♪]*)/gi, "【Sword】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【杖】([❤♥♡…！？。、･♪]*)/gi, "【Cane】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【フレイル】([❤♥♡…！？。、･♪]*)/gi, "【Flail】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【斧】([❤♥♡…！？。、･♪]*)/gi, "【Axe】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【槍】([❤♥♡…！？。、･♪]*)/gi, "【Spear】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【グローブ】([❤♥♡…！？。、･♪]*)/gi, "【Glove】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【爪】([❤♥♡…！？。、･♪]*)/gi, "【Claw】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【弓】([❤♥♡…！？。、･♪]*)/gi, "【Bow】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/【短剣】([❤♥♡…！？。、･♪]*)/gi, "【Dagger】$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\bFalsion\b/gi, "FalchionSHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "フンッSд([❤♥♡…！？。、･♪]*)", "Hmph!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ちょっ、ちょっと！([❤♥♡…！？。、･♪]*)", "H-Hey!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ヒールSд([❤♥♡…！？。、･♪]*)", "Heal$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着黒\\（腹ボテ\\）Sд([❤♥♡…！？。、･♪]*)", "Black Religious uniform （Pregnant）$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着白\\（腹ボテ\\）Sд([❤♥♡…！？。、･♪]*)", "White Religious uniform （Pregnant）$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着赤\\（腹ボテ\\）Sд([❤♥♡…！？。、･♪]*)", "Red Religious uniform （Pregnant）$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着紫\\（腹ボテ\\）Sд([❤♥♡…！？。、･♪]*)", "Purple Religious uniform （Pregnant）$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着青\\（腹ボテ\\）Sд([❤♥♡…！？。、･♪]*)", "Blue Religious uniform （Pregnant）$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "素肌\\（腹ボテ\\）Sд([❤♥♡…！？。、･♪]*)", "Bare Skin （Pregnant）$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着大破・黒Sд([❤♥♡…！？。、･♪]*)", "Damaged Black Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着大破・白Sд([❤♥♡…！？。、･♪]*)", "Damaged White Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着大破・赤Sд([❤♥♡…！？。、･♪]*)", "Damaged Red Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着大破・紫Sд([❤♥♡…！？。、･♪]*)", "Damaged Purple Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着大破・青Sд([❤♥♡…！？。、･♪]*)", "Damaged Blue Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着黒Sд([❤♥♡…！？。、･♪]*)", "Black Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着白Sд([❤♥♡…！？。、･♪]*)", "White Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着赤Sд([❤♥♡…！？。、･♪]*)", "Red HReligious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着紫Sд([❤♥♡…！？。、･♪]*)", "Purple Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修道着青Sд([❤♥♡…！？。、･♪]*)", "Blue Religious uniform$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "素肌Sд([❤♥♡…！？。、･♪]*)", "Bare Skin$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んっ、Sд([❤♥♡…！？。、･♪]*)", "Mmh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やっ、やあぁっ、([❤♥♡…！？。、･♪]*)", "Y-Yaah,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やめっ[…]+あうっ、([❤♥♡…！？。、･♪]*)", "Stop... auh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "いしき、とびそーになりゅけど([❤♥♡…！？。、･♪]*)", "I-I-I'm going to fly away!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "オ、オノレッ、コノ、オレサマガっ、ニンゲンゴトキニっSд([❤♥♡…！？。、･♪]*)", "I-I-I'm Human!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "も、[も、]+もっと、([❤♥♡…！？。、･♪]*)", "M-M-More,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "コイツの乳搾りも、([❤♥♡…！？。、･♪]*)", "The Dick is pumping sperm,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "フン[！]*([❤♥♡…！？。、･♪]*)", "Hmph!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ちょ、]*[ちょ][ちょ]*っと、([❤♥♡…！？。、･♪]*)", "H-H-Hey,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ちょ、]*[ちょ][ちょ]*っと([❤♥♡…！？。、･♪]*)", "H-H-Hey!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きキ[キ]+き[き]+禁術は[あぁ][あぁ][あぁ]+[アァ][アァ]+Sд([❤♥♡…！？。、･♪]*)", "K-K-Kinjutsu is……");
                        shistuff = replaceAllExceptScripts(shistuff, "ふう･･･Sд([❤♥♡…！？。、･♪]*)", "*Sigh*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "うぃーす、([❤♥♡…！？。、･♪]*)", "Hey there,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "へいへ[ー～〜…~]いSд([❤♥♡…！？。、･♪]*)", "Yeah, yeah, yeah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "わ([ー～〜…~])っSд([❤♥♡…！？。、･♪]*)", "Wow$1!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひぇっSд([❤♥♡…！？。、･♪]*)", "Hieh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "マ、マ〇コ、([❤♥♡…！？。、･♪]*)", "M-Ma-Ma-ko,$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/I'll fly the prologue.$/g, "Skip the prologue");
                        shistuff = shistuff.replaceAll(/I'll fly the prologue.(?!$)/g, "Skip the prologue.SHISAYESPC");
                        shistuff = shistuff.replaceAll(/I'll start with the prologue.$/g, "Start the prologue");
                        shistuff = shistuff.replaceAll(/I'll start with the prologue.(?!$)/g, "Start the prologue.SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "飲んでくださ[ぃい][ぃい]+Sд([❤♥♡…！？。、･♪]*)", "Please drink iiit!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "を(\\d+)つ収穫した。Sд([❤♥♡…！？。、･♪]*)", "x$1 harvested!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "はぁ…+はぁ…+([❤♥♡…！？。、･♪]*)", "*pant* *pant*$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\(日\)([❤♥♡…！？。、･♪]*)/gi, "\(Sun\)$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\(月\)([❤♥♡…！？。、･♪]*)/gi, "\(Mon\)$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\(火\)([❤♥♡…！？。、･♪]*)/gi, "\(Tue\)$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\(水\)([❤♥♡…！？。、･♪]*)/gi, "\(Thu\)$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\(木\)([❤♥♡…！？。、･♪]*)/gi, "\(Wed\)$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\(金\)([❤♥♡…！？。、･♪]*)/gi, "\(Fri\)$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/\(土\)([❤♥♡…！？。、･♪]*)/gi, "\(Sat\)$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "朝、Sд([❤♥♡…！？。、･♪]*)", "In the morning,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "夕、Sд([❤♥♡…！？。、･♪]*)", "In the evening,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "夜、Sд([❤♥♡…！？。、･♪]*)", "At night,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "朝Sд([❤♥♡…！？。、･♪]*)", "Morning$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "夕Sд([❤♥♡…！？。、･♪]*)", "Evening$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "夜Sд([❤♥♡…！？。、･♪]*)", "Night$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "月Sд([❤♥♡…！？。、･♪]*)", "M$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "日Sд([❤♥♡…！？。、･♪]*)", "D$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おうっ、([❤♥♡…！？。、･♪]*)", "Ooh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やっ…+ああっ…+Sд([❤♥♡…！？。、･♪]*)", "No... Aaah...");
                        shistuff = replaceAllExceptScripts(shistuff, "はあっSд([❤♥♡…！？。、･♪]*)", "*Sigh*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ああっSд([❤♥♡…！？。、･♪]*)", "Ahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やっSд([❤♥♡…！？。、･♪]*)", "Yah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やりぃSд([❤♥♡…！？。、･♪]*)", "Yay!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んうーんSд([❤♥♡…！？。、･♪]*)", "Hmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "へっSд([❤♥♡…！？。、･♪]*)", "Heh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふんッSд([❤♥♡…！？。、･♪]*)", "Hmph!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "うぅーんSд([❤♥♡…！？。、･♪]*)", "Hmmm,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "えぇ～いいじゃんかよ～Sд([❤♥♡…！？。、･♪]*)", "What's the big deal?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んんぅッSд([❤♥♡…！？。、･♪]*)", "Nnngh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]゛([❤♥♡…！？。、･♪]*)", "Agh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "へぇ～Sд([❤♥♡…！？。、･♪]*)", "Wow!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[うぅ]んSд([❤♥♡…！？。、･♪]*)", "Ugh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ええ～Sд([❤♥♡…！？。、･♪]*)", "Yes,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぅ、([❤♥♡…！？。、･♪]*)", "Ugh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "むうんSд([❤♥♡…！？。、･♪]*)", "Hmm,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あぁ～(?=[三]|$)([❤♥♡…！？。、･♪]*)", "Ahh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "わんわん(?=[交]|$)([❤♥♡…！？。、･♪]*)", "Woof! Woof!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひゃ[ぁあ][ぃい]Sд([❤♥♡…！？。、･♪]*)", "Hyahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やぁん、もう、([❤♥♡…！？。、･♪]*)", "No, geez,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "秋Sд([❤♥♡…！？。、･♪]*)", "Autumn$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "夏Sд([❤♥♡…！？。、･♪]*)", "Summer$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "春Sд([❤♥♡…！？。、･♪]*)", "Spring$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "冬Sд([❤♥♡…！？。、･♪]*)", "Winter$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "にぶーいにぶー(?=[い]|$)([❤♥♡…！？。、･♪]*)", "*Intense grumbling*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "マワセSд([❤♥♡…！？。、･♪]*)", "Crotch!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "オカセSд([❤♥♡…！？。、･♪]*)", "Cunt!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "なしSд([❤♥♡…！？。、･♪]*)", "None$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ヒールSд([❤♥♡…！？。、･♪]*)", "Moonlight$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "MPを回復する。Sд([❤♥♡…！？。、･♪]*)", "Recovers MP$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "いやはや[･]+Sд([❤♥♡…！？。、･♪]*)", "Well, well...");
                        shistuff = replaceAllExceptScripts(shistuff, "[･]+良いぞ[･]+Sд([❤♥♡…！？。、･♪]*)", "･･･Good･･･");
                        shistuff = replaceAllExceptScripts(shistuff, "はじめからSд([❤♥♡…！？。、･♪]*)", "New Game$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "つづきからSд([❤♥♡…！？。、･♪]*)", "Continue$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やあやあ♪([❤♥♡…！？。、･♪]*)", "Hey, hey♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "はぁはぁSд([❤♥♡…！？。、･♪]*)", "*pant pant*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "好きぃSд([❤♥♡…！？。、･♪]*)", "I love you!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "大好きぃSд([❤♥♡…！？。、･♪]*)", "I love you so much!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ボイス 音量Sд([❤♥♡…！？。、･♪]*)", "Voice Volume$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "何度も何度も何度もSд([❤♥♡…！？。、･♪]*)", "Again and again and again and again!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "回Sд([❤♥♡…！？。、･♪]*)", "ct$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "会議は長引きSд([❤♥♡…！？。、･♪]*)", "The meeting dragged on.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほーんSд([❤♥♡…！？。、･♪]*)", "Hooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "主人公Sд([❤♥♡…！？。、･♪]*)", "Protagonist$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "北西Sд([❤♥♡…！？。、･♪]*)", "Northwest$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "北東Sд([❤♥♡…！？。、･♪]*)", "Northeast$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "南西Sд([❤♥♡…！？。、･♪]*)", "Southwest$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "南東Sд([❤♥♡…！？。、･♪]*)", "Southeast$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "げぇむ終了Sд([❤♥♡…！？。、･♪]*)", "Game End$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う～ん、([❤♥♡…！？。、･♪]*)", "Hmm,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う～んSд([❤♥♡…！？。、･♪]*)", "Hmm!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ん～、([❤♥♡…！？。、･♪]*)", "Mm,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "今度こそSд([❤♥♡…！？。、･♪]*)", "This time for sure!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "わーい[、！]?わーいSд([❤♥♡…！？。、･♪]*)", "Yay! Yay!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ブランコ[！、]?ブランコ[ー～〜…~]Sд([❤♥♡…！？。、･♪]*)", "A swing! A swing!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あ[ー～〜…~][、]([❤♥♡…！？。、･♪]*)", "Ah～,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "修得不可Sд([❤♥♡…！？。、･♪]*)", "Unavailable");
                        shistuff = replaceAllExceptScripts(shistuff, "未修得Sд([❤♥♡…！？。、･♪]*)", "Not Aquired");
                        shistuff = replaceAllExceptScripts(shistuff, "ロードメニューSд([❤♥♡…！？。、･♪]*)", "Load Menu");
                        shistuff = replaceAllExceptScripts(shistuff, "交換するSд([❤♥♡…！？。、･♪]*)", "Trade");
                        shistuff = replaceAllExceptScripts(shistuff, "あ～やわらけぇSд([❤♥♡…！？。、･♪]*)", "Ahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "いや～Sд([❤♥♡…！？。、･♪]*)", "Ahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "^セーブしますか？?Sд([❤♥♡…！？。、･♪]*)", "Do you want to Save?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おっおぉ～Sд([❤♥♡…！？。、･♪]*)", "Whoa, whoa!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おいおい随分キツイじゃねえのSд([❤♥♡…！？。、･♪]*)", "Hey, hey, that's pretty tough.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あ～も～ちゃんと踏ん張っててよSд([❤♥♡…！？。、･♪]*)", "Oh, geez... Hang in there.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぶちゅっSд([❤♥♡…！？。、･♪]*)", "Nhuchuu!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ジュポッジュポジュポッSд([❤♥♡…！？。、･♪]*)", "Jep! Jep! Jep!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "クゥさぁSд([❤♥♡…！？。、･♪]*)", "Kuu-sa.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "うぃ～Sд([❤♥♡…！？。、･♪]*)", "Uhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あーもーっSд([❤♥♡…！？。、･♪]*)", "Ah, geez!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "盛大に潮吹いたな～Sд([❤♥♡…！？。、･♪]*)", "That was a big squirt.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あ～やべ～Sд([❤♥♡…！？。、･♪]*)", "Oh, crap!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "キャーッSд([❤♥♡…！？。、･♪]*)", "Kyaahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ごっくんした精液量Sд([❤♥♡…！？。、･♪]*)", "Semen swallowed$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "うおっほぉSд([❤♥♡…！？。、･♪]*)", "Woah, woah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ゲーム終了Sд([❤♥♡…！？。、･♪]*)", "Game End$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "全体 音量Sд([❤♥♡…！？。、･♪]*)", "Total Volume$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ、ふん！Sд([❤♥♡…！？。、･♪]*)", "H-Hmph!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こ、ここ+んな事でSд([❤♥♡…！？。、･♪]*)", "S-Such a thing...$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "うあわああっSд([❤♥♡…！？。、･♪]*)", "Woah, woah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ベリーハードSд([❤♥♡…！？。、･♪]*)", "Very Hard$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "身分Sд([❤♥♡…！？。、･♪]*)", "Status$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "状態Sд([❤♥♡…！？。、･♪]*)", "State$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "いたたSд([❤♥♡…！？。、･♪]*)", "Ow, ow, ow!$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  Sд([❤♥♡…！？。、･♪]*)", "  $1SHISAYESPC");
                        //shistuff = shistuff.replaceAll(/  ([❤♥♡…！？。、･♪]*)/gi, "  $1SHISAYESPC");

                        // special character Stuff
                        shistuff = replaceAllExceptScripts(shistuff, "偉大[❤]+([❤♥♡…！？。、･♪]*)", "Great!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おっ[❤]+([❤♥♡…！？。、･♪]*)", "Oh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "えっ[❤]+([❤♥♡…！？。、･♪]*)", "Eh!?❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "どぷっ[❤]+([❤♥♡…！？。、･♪]*)", "*Spurt*❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あっ[❤]+([❤♥♡…！？。、･♪]*)", "Ah!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅ[～]+っ?[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Phew!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][～]+[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Oh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][～]+[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Ah!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こんなのッ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "This is...❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "そうですねぇ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "That's right!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお]っ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Guoh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほぉッ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Hoohh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぃっ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Nnngh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]っ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Ohh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+っ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Nnnh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Oh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅッ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Phew!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ォ[ぉお]?ッ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Ohh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ッ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Ngh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]?[ぉお]?[ん]?っ[…]*[❤]+([❤♥♡…！？。、･♪]*)", "Mhh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぃい][ー～〜…~]*[❤]+([❤♥♡…！？。、･♪]*)", "Yaah❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][ぁあ]+[っッ]?[ー～〜…~]*[❤]+([❤♥♡…！？。、･♪]*)", "Fuahh!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[❤]+([❤♥♡…！？。、･♪]*)", "Fuah!❤$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[❤]+([❤♥♡…！？。、･♪]*)", "Ahfuah!❤$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [❤]+([❤♥♡…！？。、･♪]*)", "  ❤$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [❤]+([❤♥♡…！？。、･♪]*)", "  ❤$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [❤]+([❤♥♡…！？。、･♪]*)", "  ❤$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [❤]+([❤♥♡…！？。、･♪]*)", "  ❤$1SHISAYESPC");

                        shistuff = replaceAllExceptScripts(shistuff, "偉大[♥]+([❤♥♡…！？。、･♪]*)", "Great!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おっ[♥]+([❤♥♡…！？。、･♪]*)", "Oh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "えっ[♥]+([❤♥♡…！？。、･♪]*)", "Eh!?♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "どぷっ[♥]+([❤♥♡…！？。、･♪]*)", "*Spurt*♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あっ[♥]+([❤♥♡…！？。、･♪]*)", "Ah!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅ[～]+っ?[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Phew!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][～]+[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Oh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][～]+[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Ah!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こんなのッ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "This is...♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "そうですねぇ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "That's right!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお]っ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Guoh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほぉッ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Hoohh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぃっ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Nnngh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]っ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Ohh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+っ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Nnnh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Oh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅッ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Phew!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ォ[ぉお]?ッ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Ohh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ッ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Ngh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]?[ぉお]?[ん]?っ[…]*[♥]+([❤♥♡…！？。、･♪]*)", "Mhh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぃい][ー～〜…~]*[♥]+([❤♥♡…！？。、･♪]*)", "Yaah♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][ぁあ]+[っッ]?[ー～〜…~]*[♥]+([❤♥♡…！？。、･♪]*)", "Fuahh!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[♥]+([❤♥♡…！？。、･♪]*)", "Fuah!♥$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[♥]+([❤♥♡…！？。、･♪]*)", "Ahfuah!♥$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [♥]+([❤♥♡…！？。、･♪]*)", "  ♥$1SHISAYESPC");

                        shistuff = replaceAllExceptScripts(shistuff, "偉大[♡]+([❤♥♡…！？。、･♪]*)", "Great!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おっ[♡]+([❤♥♡…！？。、･♪]*)", "Oh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "えっ[♡]+([❤♥♡…！？。、･♪]*)", "Eh!?♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "どぷっ[♡]+([❤♥♡…！？。、･♪]*)", "*Spurt*♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あっ[♡]+([❤♥♡…！？。、･♪]*)", "Ah!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅ[～]+っ?[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Phew!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][～]+[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Oh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][～]+[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Ah!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こんなのッ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "This is...♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "そうですねぇ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "That's right!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお]っ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Guoh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほぉッ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Hoohh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぃっ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Nnngh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]っ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Ohh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+っ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Nnnh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Oh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅッ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Phew!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ォ[ぉお]?ッ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Ohh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ッ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Ngh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]?[ぉお]?[ん]?っ[…]*[♡]+([❤♥♡…！？。、･♪]*)", "Mhh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぃい][ー～〜…~]*[♡]+([❤♥♡…！？。、･♪]*)", "Yaah!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][ぁあ]+[っッ]?[ー～〜…~]*[♡]+([❤♥♡…！？。、･♪]*)", "Fuahh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[♡]+([❤♥♡…！？。、･♪]*)", "Fuah!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[♡]+([❤♥♡…！？。、･♪]*)", "Ahfuah!♡$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [♡]+([❤♥♡…！？。、･♪]*)", "  ♡$1SHISAYESPC");

                        shistuff = replaceAllExceptScripts(shistuff, "偉大[♪]+([❤♥♡…！？。、･♪]*)", "Great!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おっ[♪]+([❤♥♡…！？。、･♪]*)", "Oh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "えっ[♪]+([❤♥♡…！？。、･♪]*)", "Eh!?♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "どぷっ[♪]+([❤♥♡…！？。、･♪]*)", "*Spurt*♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あっ[♪]+([❤♥♡…！？。、･♪]*)", "Ah!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅ[～]+っ?[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Phew!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][～]+[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Oh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][～]+[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Ah!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こんなのッ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "This is...♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "そうですねぇ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "That's right!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお]っ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Guoh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほぉッ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Hoohh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぃっ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Nnngh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]っ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Ohh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+っ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Nnnh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Oh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅッ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Phew!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ォ[ぉお]?ッ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Ohh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ッ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Ngh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]?[ぉお]?[ん]?っ[…]*[♪]+([❤♥♡…！？。、･♪]*)", "Mhh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぃい][ー～〜…~]*[♪]+([❤♥♡…！？。、･♪]*)", "Yaah!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][ぁあ]+[っッ]?[ー～〜…~]*[♪]+([❤♥♡…！？。、･♪]*)", "Fuahh!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[♪]+([❤♥♡…！？。、･♪]*)", "Fuah!♪$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[♪]+([❤♥♡…！？。、･♪]*)", "Ahfuah!♪$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [♪]+([❤♥♡…！？。、･♪]*)", "  ♪$1SHISAYESPC");

                        shistuff = replaceAllExceptScripts(shistuff, "偉大[、,]+([❤♥♡…！？。、･♪]*)", "Great,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おっ[、,]+([❤♥♡…！？。、･♪]*)", "Oh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "えっ[、,]+([❤♥♡…！？。、･♪]*)", "Eh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "どぷっ[、,]+([❤♥♡…！？。、･♪]*)", "*Spurt*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あっ[、,]+([❤♥♡…！？。、･♪]*)", "Ah,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅ[～]+っ?[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Phew,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][～]+[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Oh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][～]+[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Ah,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こんなのッ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "This is...$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "そうですねぇ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "That's right,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお]っ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Guoh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほぉッ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Hoohh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぃっ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Nnngh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]っ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Ohh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+っ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Nnnh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Oh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅッ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Phew,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ォ[ぉお]?ッ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Ohh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ッ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Ngh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]?[ぉお]?[ん]?っ[…]*[、,]+([❤♥♡…！？。、･♪]*)", "Mhh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぃい][ー～〜…~]*[、,]+([❤♥♡…！？。、･♪]*)", "Yawn,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][ぁあ]+[っッ]?[ー～〜…~]*[、,]+([❤♥♡…！？。、･♪]*)", "Fuahh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[、,]+([❤♥♡…！？。、･♪]*)", "Fuah,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あふ[わ]?[ぁあ][っッ]?[ー～〜…~]*[、,]+([❤♥♡…！？。、･♪]*)", "Ahfuah,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ああ～([❤♥♡…！？。、･♪]*)", "Ahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~]+等と[、,]+([❤♥♡…！？。、･♪]*)", "And so,$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [、,]+([❤♥♡…！？。、･♪]*)", "  ,$1SHISAYESPC");

                        shistuff = replaceAllExceptScripts(shistuff, "ああ”([❤♥♡…！？。、･♪]*)", "Aah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あ”([❤♥♡…！？。、･♪]*)", "Ah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おお”([❤♥♡…！？。、･♪]*)", "Ooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "お”([❤♥♡…！？。、･♪]*)", "Oh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ん”([❤♥♡…！？。、･♪]*)", "Mhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んお”([❤♥♡…！？。、･♪]*)", "Mnoh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んあ”([❤♥♡…！？。、･♪]*)", "Mnah!$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  [”]([❤♥♡…！？。、･♪]*)", "  $1SHISAYESPC");

                        shistuff = replaceAllExceptScripts(shistuff, "ぎゃ[ぁあ][ぁあ]+[ー～〜…~]+([❤♥♡…！？。、･♪]*)", "Gyaahhh!$1SHISAYESPC");
                        //shistuff = replaceAllExceptScripts(shistuff, "  ([❤♥♡…！？。、･♪]*)", "  $1SHISAYESPC");

                        //Predefined Translations Noises
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Woooahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ん]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhnnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ん]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ぁあ][ぁあ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Aaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあっ]+ご[ぁあ][ぁあ][ぁあ][ぁあ]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあっ]+ご[ぁあ][ぁあ][ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあっ]+ご[ぁあ][ぁあ]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあっ]+ご[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ][ぁあ]+[っほ]+[ぁあ][ぁあ][ぁあ]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ][ぁあ]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ][ぁあ]+[っほ]+[ぁあ]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ]+[っほ]+[ぁあ][ぁあ][ぁあ]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ]+[っほ]+[ぁあ]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ん][ん]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[ん]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~][ー～〜…~]+[ん]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~]+[ん]+Sд([❤♥♡…！？。、･♪]*)", "Ahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ん]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ohhnnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ん]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ohhnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Ooooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Oooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぉお][ぉお]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Oooooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Oooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Oooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Oooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Oooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[ぉお][ぉお]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Ooooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Oooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Oooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[ぉお][ぉお]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Ooooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Oooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[ぉお][ぉお]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Oooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~]*[っッ]+[ー～〜…~][ー～〜…~]+ッくぅっSд([❤♥♡…！？。、･♪]*)", "Oooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Oooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉおっ]+ご[ぉお][ぉお][ぉお][ぉお]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Ohhhhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉおっ]+ご[ぉお][ぉお][ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Ohhhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉおっ]+ご[ぉお][ぉお]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Ohhhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉおっ]+ご[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Ohhnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお][ぉお]+[っほ]+[ぉお][ぉお][ぉお]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ohhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお][ぉお]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ohhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお][ぉお][ぉお]+[っほ]+[ぉお]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ohhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお]+[っほ]+[ぉお][ぉお][ぉお]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ohhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお]+[っほ]+[ぉお]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ohhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお]+[ー～〜…~]+([❤♥♡…！？。、･♪]*)", "Ohhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお][ぉお]+[んっ]*Sд([❤♥♡…！？。、･♪]*)", "Ohhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぁあ][ぁあ][ぁあ]+[ん]+Sд([❤♥♡…！？。、･♪]*)", "Fuuaahnnh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "も[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Mooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "も[ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Moooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほ[ぁあぉお][ぁあぉお][ぁあぉお][ぁあぉお]+んっSд([❤♥♡…！？。、･♪]*)", "Hhnnnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほ[ぁあぉお][ぁあぉお]+んっSд([❤♥♡…！？。、･♪]*)", "Hhnnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "しゅっぽ[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "*Slap!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "しゅっぽ[ぉお]*Sд([❤♥♡…！？。、･♪]*)", "*Slap!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "しゅっぽ[ぉお][ぉお]+んっSд([❤♥♡…！？。、･♪]*)", "*Slap!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(しゅっぽ)\\\\1*[ぉお][ぉお]+んっSд([❤♥♡…！？。、･♪]*)", "*Slap!* *Slap!* *Slap!*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあぉお][ぁあぉお][ぁあぉお]+んSд([❤♥♡…！？。、･♪]*)", "This ass-pussy is sopping wet.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う、う、う、嘘[ぁあぉお][ぁあぉお]+[！]+[？]+([❤♥♡…！？。、･♪]*)", "N-N-No waaaaay!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う、う、嘘[ぁあぉお][ぁあぉお]+[！]+[？]+([❤♥♡…！？。、･♪]*)", "N-N-No waaaay!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う、嘘[ぁあぉお][ぁあぉお]+[！]+[？]+([❤♥♡…！？。、･♪]*)", "N-N-No waaay!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "嘘[ぁあぉお][ぁあぉお]+[！]+[？]+([❤♥♡…！？。、･♪]*)", "No waay!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Fuuuhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひぅ[ん][ん][ん][ん]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Hnnhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "バカになる[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Slyyyy!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ずる[ぅう][ぅう][ぅう][ぅう]+[ん]+Sд([❤♥♡…！？。、･♪]*)", "Guuuhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぁあ]+[ん]+Sд([❤♥♡…！？。、･♪]*)", "*Yaawn*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Fuuhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひぅ[ん][ん]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Hnnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "バカになる[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Slyyy!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ずる[ぅう][ぅう][ぅう]+[ん]+Sд([❤♥♡…！？。、･♪]*)", "Guuhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐぷ[ぅう][ぅう][ぅう][ぅう]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "I'm gonna go craaazy!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐぷ[ぅう][ぅう]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "I'm gonna go craazy!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "なる[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Stupiiid!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "なる[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Stupiid!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Mmmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Mmmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Mmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Mmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "びゅ[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Nynnnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "びゅ[ー～〜…~][ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Nynnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あえ[ー～〜…~]…Sд([❤♥♡…！？。、･♪]*)", "Aww...");
                        shistuff = replaceAllExceptScripts(shistuff, "のMPが自動回復する。Sд([❤♥♡…！？。、･♪]*)", " MP recovery status has been canceled.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "レロレロ(レロ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "*Lick* *Lick* *Lick*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "レロ(レロ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "*Lick* *Lick*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あ、うう、([❤♥♡…！？。、･♪]*)", " ah, ugh,$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/[ ]+ah, ugh,[ ]+([❤♥♡…！？。、･♪]*)/gi, " ah, ugh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "へこへこ(へこ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Harharhar!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "へこ(へこ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Harhar!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ｼｺｼｺ(ｼｺ)\\\\1+[ｫ]*Sд([❤♥♡…！？。、･♪]*)", "Fap! Fap! Fap!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ｼｺ(ｼｺ)\\\\1+[ｫ]*Sд([❤♥♡…！？。、･♪]*)", "*Fap* *Fap*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ﾋｸﾋｸ(ﾋｸ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "*Twitch* *Twitch* *Twitch*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ﾋｸ(ﾋｸ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "*Twitch* *Twitch*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "むっぎゅ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "*Squeeeze*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぶっちゅ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "*Thuuud*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "むっぎゅ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "*Squeeze*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぶっちゅ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "*Thuud*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んっんっ(んっ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Mmmmmnnnhh!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んっ(んっ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Mmmmnnnhh!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "じゅ[ー～〜…~]*[っッ]*ぶ[ぶ]+[ー～〜…~]*[っッ]*[ぶ]*[ー～〜…~]*[っッ]*[ぶ]*[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "*Heavy breathing*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "どびゅ(びゅ)\\\\1+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "*Intense breathing*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "何度も、何度も、([❤♥♡…！？。、･♪]*)", "Again and again, over and over,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ずっぶ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Ughhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ずっぶ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Ughhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぅう][ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Ehhh!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Uhhhh..?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "じゅっる[ぅう][ぅう][ぅう][ぅう]+んっSд([❤♥♡…！？。、･♪]*)", "*sluuurp*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "じゅっる[ぅう][ぅう]+んっSд([❤♥♡…！？。、･♪]*)", "*sluurp*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐちゅぬっぶ[ぅう]?Sд([❤♥♡…！？。、･♪]*)", "*Gulp*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ず]っぶ[ぅう][ぅう][ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Uggghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ず]っぶ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Ugghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]っぶ[ぅう][ぅう][ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "*Gluuug*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]っぶ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "*Gluug*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぬ]っぶ[ぅう][ぅう][ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Nuuuhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぬ]っぶ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Nuuhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ず]っぶ[ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Ugghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ず]っぶ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Ughh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]っぶ[ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "*Gluug*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]っぶ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "*Glug*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぬ]っぶ[ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Nuuhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぬ]っぶ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Nuuh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "びゅっ?Sд([❤♥♡…！？。、･♪]*)", "*Gasp*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぶっ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Mhhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぶっ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Mhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぶっSд([❤♥♡…！？。、･♪]*)", "Hmph!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぶっちゅ[ぅう][ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Mhhhwwha!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んどっびゅ[ぅう][ぅう][ぅう][ぅう]+[んっ]Sд([❤♥♡…！？。、･♪]*)", "Mhhhww!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぶっちゅ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Mhhwwha!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んどっびゅ[ぅう][ぅう]+[んっ]Sд([❤♥♡…！？。、･♪]*)", "Mhhww!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んぶちゅれろぉSд([❤♥♡…！？。、･♪]*)", "*Sucking*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "じゅっぶ[ぅう][ぅう]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "*Audible breathing*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐっり[ぃい][ぃい][ぃい][ぃい]+[んっ]Sд([❤♥♡…！？。、･♪]*)", "Grrrrrr!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐっり[ぃい][ぃい]+[んっ]Sд([❤♥♡…！？。、･♪]*)", "Grrrrr!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぅう][ぅう]+っSд([❤♥♡…！？。、･♪]*)", "Ughhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "経産婦のくせにぃSд([❤♥♡…！？。、･♪]*)", "You're a woman who's had a baby.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "はぁんっSд([❤♥♡…！？。、･♪]*)", "Haahn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ロードSд([❤♥♡…！？。、･♪]*)", "Load$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひゃ[ぅう][ぅう][ぅう][ぅう]+[ん]+ッ?Sд([❤♥♡…！？。、･♪]*)", "Hyaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひゃ[ぅう][ぅう]+[ん]+ッ?Sд([❤♥♡…！？。、･♪]*)", "Hyaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぢゅる[る][る][る]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "*Slurp* *Slurp* *Slurp*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぢゅる[る]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "*Slurp* *Slurp*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "はぁんSд([❤♥♡…！？。、･♪]*)", "*Pant*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あむんっSд([❤♥♡…！？。、･♪]*)", "Mwah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+っSд([❤♥♡…！？。、･♪]*)", "*Wooosh!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ー～〜…~][ー～〜…~]+っSд([❤♥♡…！？。、･♪]*)", "*Woosh!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~][ー～〜…~]+([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ビュ[ゥウ][[ゥウ]]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "*Wooosh!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぁ[ぃい][ぃい][ぃい][ぃい]+Sд[　 ]([❤♥♡…！？。、･♪]*)", "Yaaaay!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぁ[ぃい][ぃい]+Sд[　 ]([❤♥♡…！？。、･♪]*)", "Yaaay!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "お尻も[ぉお][ぉお][ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "My butt, toooo!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "お尻も[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "My butt, tooo!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Haaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ]+[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Haaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ][ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Haaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ]+[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Haah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "…*ぃ…*イ”*っでりゅ[ぅう]+[ー～〜…~]*Sд([❤♥♡…！？。、･♪]*)", "I... I'm cumming...!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+アタシも[ぉお]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Ohh, me too!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ][ぁあ][ぁあ][ぁあ]+[っッ]*[！]+[？]+([❤♥♡…！？。、･♪]*)", "Haaah!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ][ぁあ][ぁあ][ぁあ]+[っッ]*[？]+([❤♥♡…！？。、･♪]*)", "Haaah?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ][ぁあ][ぁあ][ぁあ]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Haaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ][ぁあ]+[っッ]*[！？]*([❤♥♡…！？。、･♪]*)", "Huh!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "は[ぁあ][ぁあ]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Huh?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こんにゃ感覚…?初めて[ぇえ][ぇえ]+Sд([❤♥♡…！？。、･♪]*)", "This is the first time I've felt this sensation.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "初めて[ぇえ][ぇえ]+Sд([❤♥♡…！？。、･♪]*)", "This is the first time...");
                        shistuff = replaceAllExceptScripts(shistuff, "く[ぅう][ぅう]+[ん]+[ッっ]+Sд([❤♥♡…！？。、･♪]*)", "Groaan!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぅう]+[ん]+[ッっ]+Sд([❤♥♡…！？。、･♪]*)", "Noooo!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "が立ち上がってくださるとはSд([❤♥♡…！？。、･♪]*)", "I didn't expect you to stand up!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ん[ー～〜…~]っ♡+Sд([❤♥♡…！？。、･♪]*)", "Mmmmh!♡$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あ[ー～〜…~]はいはい、そういうのはSд([❤♥♡…！？。、･♪]*)", "Ah, yes, yes, that kind of thing.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ][ぁあ]+[ぅう][ぅう]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Aaahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ]+[ぅう]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Aaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ぅう][ぅう]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Aaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ぅう]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Aaahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "はいはい、([❤♥♡…！？。、･♪]*)", "Yes, yes,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "はいはいSд([❤♥♡…！？。、･♪]*)", "Yes, yes.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "む[ー～〜…~]+[っッ]*、([❤♥♡…！？。、･♪]*)", "Mhhh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "む[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Mhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ん[ー～〜…~]そんなこと言って、([❤♥♡…！？。、･♪]*)", "Hmm, you're saying that, but$1SHISAYESPC");
                        shistuff = shistuff.replaceAll("Hmm, you're saying that, but  ", "Hmm, you're saying that, butSHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ー～〜…~]む、([❤♥♡…！？。、･♪]*)", "Hmmm,$1SHISAYESPC");
                        shistuff = shistuff.replaceAll("Hmmm,  ", "Hmmm,SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]*[！]+[？]+([❤♥♡…！？。、･♪]*)", "Guoooohhh!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Guoooohhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお][ぉお]+[ー～〜…~]*[っッ]*[！]+[？]+([❤♥♡…！？。、･♪]*)", "Guooohhh!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐ[ぉお][ぉお]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Guooohhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+まじで生ハメ交尾たまんねぇ！([❤♥♡…！？。、･♪]*)", "Ahhhh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~][ー～〜…~]+まじで生ハメ交尾たまんねぇSд([❤♥♡…！？。、･♪]*)", "Ahhhh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+でたでた、([❤♥♡…！？。、･♪]*)", "Ohhhh, here it comes,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~][ー～〜…~]+でたでたSд([❤♥♡…！？。、･♪]*)", "Ohhhh, here it comes!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~]+まじで生ハメ交尾たまんねぇ！([❤♥♡…！？。、･♪]*)", "Ahhh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~]+まじで生ハメ交尾たまんねぇSд([❤♥♡…！？。、･♪]*)", "Ahhh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~]+でたでた、([❤♥♡…！？。、･♪]*)", "Ohhh, here it comes,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお][ぉお]+[ー～〜…~]+でたでたSд([❤♥♡…！？。、･♪]*)", "Ohhh, here it comes!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~][ー～〜…~]+まじで生ハメ交尾たまんねぇ！([❤♥♡…！？。、･♪]*)", "Ahhh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~][ー～〜…~]+まじで生ハメ交尾たまんねぇSд([❤♥♡…！？。、･♪]*)", "Ahhh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]+[ー～〜…~][ー～〜…~]+でたでた、([❤♥♡…！？。、･♪]*)", "Ohhh, here it comes,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]+[ー～〜…~][ー～〜…~]+でたでたSд([❤♥♡…！？。、･♪]*)", "Ohhh, here it comes!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~]+まじで生ハメ交尾たまんねぇ！([❤♥♡…！？。、･♪]*)", "Ahh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[ー～〜…~]+まじで生ハメ交尾たまんねぇSд([❤♥♡…！？。、･♪]*)", "Ahh, raw sex is incredible!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]+[ー～〜…~]+でたでた、([❤♥♡…！？。、･♪]*)", "Ohh, here it comes,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]+[ー～〜…~]+でたでたSд([❤♥♡…！？。、･♪]*)", "Ohh, here it comes!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ッっ]+[ぁあ]+が[ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhgghhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふん[ー～〜…~]*[っッ]*、([❤♥♡…！？。、･♪]*)", "Hmph,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふん[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Hmph!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "どれぇ、([❤♥♡…！？。、･♪]*)", "Let's see,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふーん？([❤♥♡…！？。、･♪]*)", "Hmm?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "まったく[！]+[？]+([❤♥♡…！？。、･♪]*)", "Seriously!?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "まったく[？]+([❤♥♡…！？。、･♪]*)", "Seriously?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "まったく[！]([❤♥♡…！？。、･♪]*)", "Absolutely!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "まったくSд([❤♥♡…！？。、･♪]*)", "Absolutely!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひゅ[ー～〜…~][っッ]*、([❤♥♡…！？。、･♪]*)", "Whew,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひゅ[ー～〜…~][っッ]*Sд([❤♥♡…！？。、･♪]*)", "Whew!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "また(イク)\\\\1+[ー～〜…~][ー～〜…~]+[ッっ]+Sд([❤♥♡…！？。、･♪]*)", "Cumming, Cumming, Cuuumiiing!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "むにぃ[ぃ]+Sд([❤♥♡…！？。、･♪]*)", "*Squeeeze!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぅう][ぅう]+[ん][ん]+[ー～〜…~]*[ッっ]+Sд([❤♥♡…！？。、･♪]*)", "Mmmhh-hmm...");
                        shistuff = replaceAllExceptScripts(shistuff, "クリ(クリ)\\\\1+[ッっ]+Sд([❤♥♡…！？。、･♪]*)", "*Munch!* *Munch!* *Munch!*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "なんでもーー…あひぃんっSд([❤♥♡…！？。、･♪]*)", "It's nothing... Ahiin!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "卵が[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Cum! Ahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "まあ[まあ][まあ]+Sд([❤♥♡…！？。、･♪]*)", "Well, well, well.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おー(おー)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Whoa, whoa, whoa.$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(おー)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Whoa, whoa.$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひえ[え]+[ー～〜…~][ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Hiieeehh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ココハ　?ドコ・・・[？]+([❤♥♡…！？。、･♪]*)", "Where is it...?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(?<=[^一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]|^)ココハ　?ドコ・・・Sд([❤♥♡…！？。、･♪]*)", "Where is it...?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "いかにもな考古学者Sд([❤♥♡…！？。、･♪]*)", "Great Archaeologist$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "いや[あぁ][あぁ]+、([❤♥♡…！？。、･♪]*)", "Oh no,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "いや[あぁ][あぁ]+Sд([❤♥♡…！？。、･♪]*)", "Oh no!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+わ[ぉおあぁ][ぉおあぁ]+[ー～〜…~][ー～〜…~]+[ッっ]+Sд([❤♥♡…！？。、･♪]*)", "Wooooow!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+わ[ぉおあぁ][ぉおあぁ]+[ー～〜…~][ー～〜…~]+[ッっ]?Sд([❤♥♡…！？。、･♪]*)", "Woooow!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+わ[ぉおあぁ]+[ー～〜…~][ー～〜…~]+[ッっ]?Sд([❤♥♡…！？。、･♪]*)", "Wooow!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+わ[ぉおあぁ][あぁぉお]+[ー～〜…~]+[ッっ]?Sд([❤♥♡…！？。、･♪]*)", "Wooow!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+わ[ぉおあぁ]+[ー～〜…~]+[ッっ]?Sд([❤♥♡…！？。、･♪]*)", "Woow!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "弓Sд([❤♥♡…！？。、･♪]*)", "Bow$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "杖Sд([❤♥♡…！？。、･♪]*)", "Cane$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "木刀Sд([❤♥♡…！？。、･♪]*)", "Wooden Sword$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぐ]?[ずぬ]+っぶ[ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "*Gulp!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ずぬ]+っぶ[ぅう][ぅう]+[んっ]+Sд([❤♥♡…！？。、･♪]*)", "Big Surprise!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やっ、や[あぁ]+っ、Sд([❤♥♡…！？。、･♪]*)", "Y-Yaahh,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ゥウ]オオ[オ]+ Sд([❤♥♡…！？。、･♪]*)", "Woooaahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ゥウ]オ[オ]+ Sд([❤♥♡…！？。、･♪]*)", "Wooaahh!$1SHISAYESPC");
                        shistuff = shistuff.replaceAll(/の耐久力と抵抗力が低下した。([❤♥♡…！？。、･♪]*)/gi, "Durability and resistance reduced.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "寝取らせSд([❤♥♡…！？。、･♪]*)", "Captured$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぉお]+[～]+[…]+([❤♥♡…！？。、･♪]*)", "Ohhh……");
                        shistuff = replaceAllExceptScripts(shistuff, "ふぅ[～]+[…]+Sд([❤♥♡…！？。、･♪]*)", "*Sigh*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ィ]+[ぃい][ぃい][ぃい]+[ー～〜…~]*[っッ][？]+[！]?Sд([❤♥♡…！？。、･♪]*)", "Eeeeek?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ?ひ?[ぃい][ぃい][ぃい]+[ー～〜…~]*[っッ][？]+[！]?Sд([❤♥♡…！？。、･♪]*)", "Eeeeek?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぃい][ぃい][ぃい]+っ[？]+[！]?Sд([❤♥♡…！？。、･♪]*)", "Ehhhhh?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぃい][ぃい][ぃい]+ッ[？]+[！]?Sд([❤♥♡…！？。、･♪]*)", "Ehhhhh?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]?[ひ]?[ぃい][ぃい][ぃい]+[？]+[！]?Sд([❤♥♡…！？。、･♪]*)", "Eeeeek?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぃい][ぃい][ぃい]+[？]+[！]?Sд([❤♥♡…！？。、･♪]*)", "Ehhhhh?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ィ]+[ぃい][ぃい][ぃい]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Eeeeek!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]?[ー～〜…~]*[っッ]*[ひ]?[ぃい][ぃい][ぃい]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Eeeeek!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぃい][ぃい][ぃい]+っSд([❤♥♡…！？。、･♪]*)", "Ehhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぃい][ぃい][ぃい]+ッSд([❤♥♡…！？。、･♪]*)", "Ehhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]?[ー～〜…~]*[っッ]*[ひ]?[ぃい][ぃい][ぃい]+Sд([❤♥♡…！？。、･♪]*)", "Eeeeek!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぃい][ぃい][ぃい]+Sд([❤♥♡…！？。、･♪]*)", "Ehhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]?[ー～〜…~]*[っッ]*[ひ]?[ぃい][ぃい]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Eeeek!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぇえ][ぇえ][ぇえ]+[ー～〜…~]*ッSд([❤♥♡…！？。、･♪]*)", "Whaaat?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぇえ][ぇえ][ぇえ]+[ー～〜…~]*っSд([❤♥♡…！？。、･♪]*)", "Whaaat?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ー～〜…~]+んSд([❤♥♡…！？。、･♪]*)", "Mhhmh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ん]*[ン][ン]+[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Mhhhnnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ん]*[ン][ン]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Mhhnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+っ[ん]+[ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Mmmmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Hmmmhh...");
                        shistuff = replaceAllExceptScripts(shistuff, "んっ[ン]+[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Mhhhnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ん]*[ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Mmmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ん]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Nngmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Hmmhh...");
                        shistuff = replaceAllExceptScripts(shistuff, "んっ[ン]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Mhhnn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あっん[っん]+ン[ン]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhnnnnhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ン]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Mmmhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きった[ぁあ][ぁあ]+[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Kyaaaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きった[ぁあ][ぁあ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Kyaaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きった[ぁあ]+[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Kyaaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きった[ぁあ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Kyaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きった[ぁあ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Kyaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きゃ[ぁあ]+[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Kyaaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "きゃ[ぁあ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Kyaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぐっ[―]+Sд([❤♥♡…！？。、･♪]*)", "Guuh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+[ぐっ][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Uughh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あん(あん)\\\\1+いうえSд([❤♥♡…！？。、･♪]*)", "Aiihhaahh!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "え[え]+いSд([❤♥♡…！？。、･♪]*)", "Aarghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ク]?[ゥウ][ゥウ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Uhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ん[ん]+ッ[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnghhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぅう]+ん[ん]+Sд([❤♥♡…！？。、･♪]*)", "Ughhhn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ][ぁあ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~]*[っッ]+[ぅう][ぅう]+[…]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Gahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ッ[ー～〜…~]*[っッ]ゥ[ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Nghhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+[ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Whoaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "よよ[よ]+、Sд([❤♥♡…！？。、･♪]*)", "Y-Y-Yeah,$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "よよ[よ]+([…]+)Sд([❤♥♡…！？。、･♪]*)", "Y-Y-Yeah$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "よよ[よ]+。Sд([❤♥♡…！？。、･♪]*)", "Y-Y-Yeah.$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "よよ[よ]+Sд([❤♥♡…！？。、･♪]*)", "Y-Y-Yeah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ウ]?[ォオ][ォオ][ォオ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Ohhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "宝珠Sд([❤♥♡…！？。、･♪]*)", "Gem$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "こ、壊れちゃ[うぅ][うぅ]+んいっひ[ぃい][ぃい]+Sд([❤♥♡…！？。、･♪]*)", "I-I'm gonna break! Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "壊れちゃ[うぅ][うぅ]+んいっひ[ぃい][ぃい]+Sд([❤♥♡…！？。、･♪]*)", "I'm gonna break! Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふんふん[ふん]+Sд([❤♥♡…！？。、･♪]*)", "Hmmh, Mhhm, Hmm!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Fuooohhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぉお][ぉお]+[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Fuooohhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[えぇ][えぇ][えぇ]+Sд([❤♥♡…！？。、･♪]*)", "Ehhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふむ[ふむ][ふむ]+Sд([❤♥♡…！？。、･♪]*)", "Mhhh, Hmm!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぉお][ふぉお]+[ふぉお]+Sд([❤♥♡…！？。、･♪]*)", "Hohohoho!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぃい][ぃい]+[ィイ][ィイ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Eeeeeek!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ィイ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Eeeek!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+ァ[アァ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ォ[ォ]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Wooaahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[アァ][アァ]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ[ぅう][ぅう]+ッSд([❤♥♡…！？。、･♪]*)", "Uhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んんーッSд([❤♥♡…！？。、･♪]*)", "Mhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ][ぃい]Sд([❤♥♡…！？。、･♪]*)", "*Yawn*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[うぅ][うぅ]ーんSд([❤♥♡…！？。、･♪]*)", "Hmmm!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][ん]+[うぅ][うぅ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nuuuuh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][うぅ][うぅ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nuuuh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][うぅ][ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nuuh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][ん]+[うぅ]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnnghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[うぅ]+[ー～〜…~]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Nnnngh~!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[うぅ]+[ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Nnngh~!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ]+[ぃい]+Sд([❤♥♡…！？。、･♪]*)", "Yaay!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ]+[ぃい]+Sд([❤♥♡…！？。、･♪]*)", "Fuaahn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "へえ[うぅ]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Woow~!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[うぅ]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Uhhhgh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+イク[うぅ]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhh! I'm Cumming!!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][ん]+[ぅう][ぅう]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnnghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][ん]+[ぅう][ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnngh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][ぅう][ぅう]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnnngh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん][ぅう][ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nnngh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふ[ぁあ]+[ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "*Yaawn!*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(駄目)\\\\1+[ぇえ]+[ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "No, no, noooo!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "止めろ[ぉお][ぉお][ぉお]+Sд([❤♥♡…！？。、･♪]*)", "Stop iiiiit!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(メリ)\\\\1+[ィイ][ィイ]+[ー～〜…~]*Sд([❤♥♡…！？。、･♪]*)", "Merry! Merry! Merry!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほ[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ohhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほ[ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ohhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ほ[ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ohhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[えぇ][えぇ][えぇ][えぇ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[えぇ][えぇ][えぇ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ]+[えぇ][えぇ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ッん[ん]+っふ[ふ]+ん[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Hmmmhh... Hehehehe!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "赤ちゃんっ[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Baaabyyyy!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[アァ][アァ][アァ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+[あぁ][あぁ][あぁ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Uwaahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "あく[ぅう][ぅう][ぅう]+[ー～〜…~]*Sд([❤♥♡…！？。、･♪]*)", "Akuuhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[あぁ][あぁ]+[･][･][･]+Sд([❤♥♡…！？。、･♪]*)", "Ahh･･･!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(おい)\\\\1+なんだよ、Sд([❤♥♡…！？。、･♪]*)", "Whoa,  Whoa,$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(おい)\\\\1+なんだよSд([❤♥♡…！？。、･♪]*)", "Whoa,  Whoa!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぅう]+[ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Uhhh...");
                        shistuff = replaceAllExceptScripts(shistuff, "[アァ]+[あぁ][あぁ][あぁ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう]+[いぃ][いぃ][いぃ]+Sд([❤♥♡…！？。、･♪]*)", "Uuhaahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぅう][ぅう]+ぐ[ぅう]+[ー～〜…~]+Sд([❤♥♡…！？。、･♪]*)", "Uhhhgh...");
                        shistuff = replaceAllExceptScripts(shistuff, "ん[いぃ][いぃ][いぃ]+[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Nnnghhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(ぼそ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "*Whispering*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(たっる)\\\\1+た～るSд([❤♥♡…！？。、･♪]*)", "Ohh! Ohh! Ohh!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(わー)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Whaaa?$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "グギギ[ギ]+ィSд([❤♥♡…！？。、･♪]*)", "Guhihihihi!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ムム[ム]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Hmmh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "やめて[えぇ][えぇ][えぇ]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Stop! Noooo!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(そう)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Yeah! Yeah!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ゲロロ[ロ]+Sд([❤♥♡…！？。、･♪]*)", "*Gulp*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(おい)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Woah, Woah!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う[え][え]+ん[っッ]Sд([❤♥♡…！？。、･♪]*)", "Uhhh?$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひ[え][え]+[っッ]Sд([❤♥♡…！？。、･♪]*)", "Whaat?!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふあ[あぁ]+～Sд([❤♥♡…！？。、･♪]*)", "*Yaawwn*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っく[ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Kuuuhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+っふ[ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Nghhfuuhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "っ[ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Uhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(ぐりゅ)\\\\1+って[ぇえ]、Sд([❤♥♡…！？。、･♪]*)", "Grind, grind,$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(ぐりゅ)\\\\1+って[ぇえ]Sд([❤♥♡…！？。、･♪]*)", "Grind, grind, grind!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ン[アァ][アァ][アァ]+Sд([❤♥♡…！？。、･♪]*)", "Nnaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ヒ[ャ]+[アァ][アァ]+Sд([❤♥♡…！？。、･♪]*)", "Hyaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ん[ん]+[ぁあ][ぁあ]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Nghaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ふふふ[ふ]+Sд([❤♥♡…！？。、･♪]*)", "Fufufufu!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ブィ[ー～〜…~][ー～〜…~][ー～〜…~]+ンSд([❤♥♡…！？。、･♪]*)", "Bzzzz!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[ー～〜…~]Sд([❤♥♡…！？。、･♪]*)", "Ohh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ぁあ][ぁあ]+[　 ]([❤♥♡…！？。、･♪]*)", "Ohh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(えっ)\\\\1\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Ehhhh?!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(おっ)\\\\1+[おぉ]+[ー～〜…~]*Sд([❤♥♡…！？。、･♪]*)", "Ohhhh!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "私Sд([❤♥♡…！？。、･♪]*)", "I$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[、]+[ん]+[ー～〜…~]*[っッ]*[ん]*[ン]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Nn-nghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[、]+[ん]+[ー～〜…~]*[っッ]*[ん]*[ー～〜…~]*Sд([❤♥♡…！？。、･♪]*)", "Nn-nghh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[、]+[ん]+[ー～〜…~]*[っッ]*[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "N-ghh...");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ん]*[ン]+[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Mmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ん]*[ー～〜…~]*Sд([❤♥♡…！？。、･♪]*)", "Mmmhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ん]+[ー～〜…~]*[っッ]*[ー～〜…~]*[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Hmhh...");
                        shistuff = replaceAllExceptScripts(shistuff, "う(ひょ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Uhyohyo!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "おお+[ー～〜…~](いいぞ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Oh, that's good! That's good!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ひあ[ぁあ]+っSд([❤♥♡…！？。、･♪]*)", "Hyaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "んあ[あぁ]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Mnaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(ふん)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Heh, heh, heh!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(ほら)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Come on, come on!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(これ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Here, here!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(オイ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Hey, hey!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(あっ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "Ah, ahh!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[カ]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Kuu!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ア[イィ][イィ][イィ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "イ[エェ][エェ]+[イィ]+Sд([❤♥♡…！？。、･♪]*)", "Yahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "。。。+([❤♥♡…！？。、･♪]*)", "...$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う[あぁ]+わ[あぁ]+っSд([❤♥♡…！？。、･♪]*)", "Waaahhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "う[う]+お[お]+んっSд([❤♥♡…！？。、･♪]*)", "Uuhhhn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "す[ぅう][ぅう][ぅう]+Sд([❤♥♡…！？。、･♪]*)", "Uhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "うひ[ん][ん]+っSд([❤♥♡…！？。、･♪]*)", "Uhhhn!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "(ぐっぽ)\\\\1+Sд([❤♥♡…！？。、･♪]*)", "*Gulp! Gulp!*$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "はっひゃ[あぁ][あぁ][あぁ]+[ー～〜…~]+んSд([❤♥♡…！？。、･♪]*)", "Hyyaaahh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ん[あぁ][あぁ][あぁ]+Sд([❤♥♡…！？。、･♪]*)", "Nhahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ガァー(ハッ)\\\\1+ハSд([❤♥♡…！？。、･♪]*)", "Gahahaha!$2SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "ぎゃ[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Gyaahhh!$1SHISAYESPC");
                        // shistuff = replaceAllExceptScripts(shistuff, "  Sд([❤♥♡…！？。、･♪]*)", "  $1SHISAYESPC");

                        //starts with line
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ッんは[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Nnhaaaaa!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~]+ッんは[っッ]*Sд([❤♥♡…！？。、･♪]*)", "Nnhaaaa!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "ーーー!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~]ぁSд([❤♥♡…！？。、･♪]*)", "*sigh*$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+ッ[ー～〜…~]*[っッ]*くは[ぁあ][ぁあ][ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ッ[ー～〜…~]*[っッ]*くは[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+ッ[ー～〜…~]*[っッ]*くは[ぁあ][ぁあ]+Sд([❤♥♡…！？。、･♪]*)", "Ahhhh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "ーーーー!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "ーーーー!!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "ーーーー!!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+[っッ]+Sд([❤♥♡…！？。、･♪]*)", "ーーーー!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ほ[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Oooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ほ[ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+ほ[ぉお][ぉお][ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Ooooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+ほ[ぉお][ぉお]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Oooooh!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ほ[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~][ー～〜…~][ー～〜…~]+ほ[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+ほ[ぁあ][ぁあ][ぁあ][ぁあ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaaah!$1SHISAYESPC");
                        shistuff = replaceAllExceptScripts(shistuff, "[ー～〜…~][ー～〜…~]+ほ[ぁあ][ぁあ]+[ー～〜…~]*[っッ]+Sд([❤♥♡…！？。、･♪]*)", "Aaaaah!$1SHISAYESPC");
                    }
                    //Try to fix Sugoi crashes automatically
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[U][u][u][u]*[\.]*[!！](?=[^a-zA-Z])[ ]?/gi, "Uhhn!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[\]])[U][u][u][u]*[\.]*[!！](?=[\\])/gi, "Uhhn!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[U][u][u][u]*[\.][\.]+(?=[^a-zA-Z])[ ]?/gi, "Uhhn...SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[U][u][u][u]*[\.](?=[^a-zA-Z\.])[ ]?/gi, "Uhhn.SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[U][u][u][u]*[,](?=[^a-zA-Z])[ ]?/gi, "Uhhn,SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[U][u][u][u]*[♡](?=[^a-zA-Z])[ ]?/gi, "Uhhn!♡SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[U][u][u][u]*[❤](?=[^a-zA-Z])[ ]?/gi, "Uhhn!❤SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[U][u][u][u]*[♥](?=[^a-zA-Z])[ ]?/gi, "Uhhn!♥SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[N][n][n][n]*[\.]*[!！](?=[^a-zA-Z])[ ]?/gi, "Nnhhg!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[\]])[N][n][n][n]*[\.]*[!！](?=[\\])/gi, "Nnhhg!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[N][n][n][n]*[\.][\.]+(?=[^a-zA-Z])[ ]?/gi, "Nnhhg...SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[N][n][n][n]*[\.](?=[^a-zA-Z\.])[ ]?/gi, "Nnhhg.SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[N][n][n][n]*[,](?=[^a-zA-Z])[ ]?/gi, "Nnhhg,SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[N][n][n][n]*[♡](?=[^a-zA-Z])[ ]?/gi, "Nnhhg!♡SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[N][n][n][n]*[❤](?=[^a-zA-Z])[ ]?/gi, "Nnhhg!❤SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[N][n][n][n]*[♥](?=[^a-zA-Z])[ ]?/gi, "Nnhhg!♥SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[M][m][m][m]*[\.]*[!！](?=[^a-zA-Z])[ ]?/gi, "Mmmhh!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[\]])[M][m][m][m]*[\.]*[!！](?=[\\])[ ]?/gi, "Mmmhh!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[M][m][m][m]*[\.][\.]+(?=[^a-zA-Z])[ ]?/gi, "Mmmhh...SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[M][m][m][m]*[\.](?=[^a-zA-Z\.])[ ]?/gi, "Mmmhh.SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[M][m][m][m]*[,](?=[^a-zA-Z])[ ]?/gi, "Mmmhh,SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[M][m][m][m]*[♡](?=[^a-zA-Z])[ ]?/gi, "Mmmhh!♡SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[M][m][m][m]*[❤](?=[^a-zA-Z])[ ]?/gi, "Mmmhh!❤SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[M][m][m][m]*[♥](?=[^a-zA-Z])[ ]?/gi, "Mmmhh!♥SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[A][a][a][a]*[\.]*[!！](?=[^a-zA-Z])[ ]?/gi, "Aaahh!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[\]])[A][a][a][a]*[\.]*[!！](?=[\\])[ ]?/gi, "Aaahh!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[A][a][a][a]*[\.][\.]+(?=[^a-zA-Z])[ ]?/gi, "Aaahh...SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[A][a][a][a]*[\.](?=[^a-zA-Z\.])[ ]?/gi, "Aaahh.SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[A][a][a][a]*[,](?=[^a-zA-Z])[ ]?/gi, "Aaahh,SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[A][a][a][a]*[♡](?=[^a-zA-Z])[ ]?/gi, "Aaahh!♡SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[A][a][a][a]*[❤](?=[^a-zA-Z])[ ]?/gi, "Aaahh!❤SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[A][a][a][a]*[♥](?=[^a-zA-Z])[ ]?/gi, "Aaahh!♥SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[O][O][o][o]*[\.]*[!！](?=[^a-zA-Z])[ ]?/gi, "Oohhh!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[\]])[O][o][o][o]*[\.]*[!！](?=[\\])[ ]?/gi, "Oohhh!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[O][o][o][o]*[\.][\.]+(?=[^a-zA-Z])[ ]?/gi, "Oohhh...SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[O][o][o][o]*[\.](?=[^a-zA-Z\.])[ ]?/gi, "Oohhh.SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[O][o][o][o]*[,](?=[^a-zA-Z])[ ]?/gi, "Oohhh,SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[O][o][o][o]*[♡](?=[^a-zA-Z])[ ]?/gi, "Oohhh!♡SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[O][o][o][o]*[❤](?=[^a-zA-Z])[ ]?/gi, "Oohhh!❤SHISAYESPC");
                    shistuff = shistuff.replaceAll(/(?<=[^a-zA-Z])[O][o][o][o]*[♥](?=[^a-zA-Z])[ ]?/gi, "Oohhh!♥SHISAYESPC");
                }
                trans.project.files[file].data[k][slrFixDest] = shistuff
        } while (false);
    }
    Onallmassreplacer() {
        let files = trans.getAllFiles();
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            for (let k = 0; k < trans.project.files[file].data.length; k++) {
                this.OnallmassreplacerRow(file, k);
            }
        }
    }
    Onallmassreplacer2Row(file, k) {
        let data = trans.project.files[file].data;
        let contexts = trans.project.files[file].context;
        do {
            let row = data[k];
            let context = contexts[k];
                // Skip empty / untranslated lines
                if (context == undefined || row == undefined || context.length == 0 || row[slrFixDest] == undefined || row[slrFixDest] == "")
                    continue;
                //make stuff less long
                let shistuff = trans.project.files[file].data[k][slrFixDest];
                let origstuff = trans.project.files[file].data[k][0];
                //make context checkable
                let contextasstring = context.toString();
                
                //Fix Double space after *
                shistuff = shistuff.replaceAll("*  ", "* ");
                shistuff = shistuff.replaceAll(/\* \n/g, "\*\n");
                //Fix repeating stuff.
                if (window.transConfig.englishtarget == true) {
                    //1 character repeated max 10 times, dividers repeated 20 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.\-\*,!\?？！、。ー～〜…~　 ])(\1\1\1\1\1\1\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.\-\*,ー～〜…~、。])(\1\1\1\1\1\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([\/#@$%_\|\.\-\*ー～〜…~、。,])(\1\1\1\1\1\1\1\1\1\1\1\1\1\1\1\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //2 characters repeated max 8 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ])(\1\1\1\1\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1\1\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //3 characters repeated max 7 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ])(\1\1\1\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //4 characters repeated max 6 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ])(\1\1\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //5 characters repeated max 5 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ])(\1\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //6 characters repeated max 5 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ])(\1\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //7 characters repeated max 5 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ])(\1\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //8 characters repeated max 4 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ])(\1\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|])(\1\1\1)\1+/gi, "$1$2SHISAYESPC");
                    //9 or more characters repeated max 3 times
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ][^0123456789０１２３４５６７８９\\#@$%\/_\|\.,!\?？！、。　 ]+?)(\1\1)\1+/gi, "$1$2!SHISAYESPC");
                    shistuff = shistuff.replaceAll(/([^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|][^0123456789０１２３４５６７８９\\#@$%\/_\|]+?)(\1\1)\1+/gi, "$1$2SHISAYESPC");
                }
                //Special Name stuff
                if (origstuff.match(/^_S/gi) != null) {
                shistuff = shistuff.replaceAll(/(.+)(_S<.*>)(.*)/gi, "$2$1$3");
                shistuff = shistuff.replaceAll(/(_S<.*>)(.*?)  (.*)/gi, "$1$2 $3");
                }
                if (window.transConfig.englishtarget == true) {
                    //Get rid of : after name plates
                    shistuff = shistuff.replaceAll(/(\\name【.*】):[ ]?([^「]+」)/gi, "$1「$2");
                    shistuff = shistuff.replaceAll(/(\\nw【.*】):[ ]?([^「]+」)/gi, "$1「$2");
                    shistuff = shistuff.replaceAll(/(\\n【.*】):[ ]?([^「]+」)/gi, "$1「$2");
                    shistuff = shistuff.replaceAll(/(\\name\[[^\]\r\n]*\]):[ ]?([^「]+」)/gi, "$1「$2");
                    shistuff = shistuff.replaceAll(/(\\nw\[[^\]\r\n]*\]):[ ]?([^「]+」)/gi, "$1「$2");
                    shistuff = shistuff.replaceAll(/(\\n\[[^\]\r\n]*\]):[ ]?([^「]+」)/gi, "$1「$2");
                    shistuff = shistuff.replaceAll(/(<.*>):[ ]?([^「]+」)/gi, "$1「$2");

                    shistuff = shistuff.replaceAll(/(\\name【.*】):[ ]?([^『]+』)/gi, "$1『$2");
                    shistuff = shistuff.replaceAll(/(\\nw【.*】):[ ]?([^『]+』)/gi, "$1『$2");
                    shistuff = shistuff.replaceAll(/(\\n【.*】):[ ]?([^『]+』)/gi, "$1『$2");
                    shistuff = shistuff.replaceAll(/(\\name\[[^\]\r\n]*\]):[ ]?([^『]+』)/gi, "$1『$2");
                    shistuff = shistuff.replaceAll(/(\\nw\[[^\]\r\n]*\]):[ ]?([^『]+』)/gi, "$1『$2");
                    shistuff = shistuff.replaceAll(/(\\n\[[^\]\r\n]*\]):[ ]?([^『]+』)/gi, "$1『$2");
                    shistuff = shistuff.replaceAll(/(<.*>):[ ]?([^『]+』)/gi, "$1『$2");

                    shistuff = shistuff.replaceAll(/(\\name【.*】):[ ]?([^（]+）)/gi, "$1（$2");
                    shistuff = shistuff.replaceAll(/(\\nw【.*】):[ ]?([^（]+）)/gi, "$1（$2");
                    shistuff = shistuff.replaceAll(/(\\n【.*】):[ ]?([^（]+）)/gi, "$1（$2");
                    shistuff = shistuff.replaceAll(/(\\name\[[^\]\r\n]*\]):[ ]?([^（]+）)/gi, "$1（$2");
                    shistuff = shistuff.replaceAll(/(\\nw\[[^\]\r\n]*\]):[ ]?([^（]+）)/gi, "$1（$2");
                    shistuff = shistuff.replaceAll(/(\\n\[[^\]\r\n]*\]):[ ]?([^（]+）)/gi, "$1（$2");
                    shistuff = shistuff.replaceAll(/(<.*>):[ ]?([^（]+）)/gi, "$1（$2");

                    shistuff = shistuff.replaceAll(/(\\name【.*】):[ ]?([^｢]+｣)/gi, "$1｢$2");
                    shistuff = shistuff.replaceAll(/(\\nw【.*】):[ ]?([^｢]+｣)/gi, "$1｢$2");
                    shistuff = shistuff.replaceAll(/(\\n【.*】):[ ]?([^｢]+）｣)/gi, "$1｢$2");
                    shistuff = shistuff.replaceAll(/(\\name\[[^\]\r\n]*\]):[ ]?([^｢]+｣)/gi, "$1｢$2");
                    shistuff = shistuff.replaceAll(/(\\nw\[[^\]\r\n]*\]):[ ]?([^｢]+｣)/gi, "$1｢$2");
                    shistuff = shistuff.replaceAll(/(\\n\[[^\]\r\n]*\]):[ ]?([^｢]+｣)/gi, "$1｢$2");
                    shistuff = shistuff.replaceAll(/(<.*>):[ ]?([^｢]+｣)/gi, "$1｢$2");

                    shistuff = shistuff.replaceAll(/(\\name【.*】):[ ]?/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\nw【.*】):[ ]?/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\n【.*】):[ ]?/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\name\[[^\]\r\n]*\]):[ ]?/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\nw\[[^\]\r\n]*\]):[ ]?/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\n\[[^\]\r\n]*\]):[ ]?/gi, "$1");
                    shistuff = shistuff.replaceAll(/(<.*>):[ ]?/gi, "$1");
                    //Get rid of dots after names
                    shistuff = shistuff.replaceAll(/(\\name【[^\.]+)\.(】)/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/(\\nw【[^\.]+)\.(】)/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/(\\n【[^\.]+)\.(】)/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/(\\name\[[^\.]+)\.(\])/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/(\\nw\[[^\.]+)\.(\])/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/(\\n\[[^\.]+)\.(\])/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/(\[[a-zA-Z]+)\.]/gi, "$1]");
                    shistuff = shistuff.replaceAll(/(【[a-zA-Z]+)\.】/gi, "$1】");
                    shistuff = shistuff.replaceAll(/(\][a-zA-Z]+)\.\\/gi, "$1\\");
                    shistuff = shistuff.replaceAll(/(<[a-zA-Z]+)\.>/gi, "$1>");
                    shistuff = shistuff.replaceAll(/^(\\C\[\d+].+)\.([】\]]*\\C\[\d+])/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/^(\[[^\]\r\n]+)\.(])/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/^(【.+)\.(】)/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/^(<.+)\.(>)/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/^(\\n<.+)\.(>)/gi, "$1$2");
                    shistuff = shistuff.replaceAll(/\]([A-Za-z]+)\.\\/gi, "\]$1\\");
                    shistuff = shistuff.replaceAll(/\(([A-Za-z]+)\.\)/gi, "\($1\)");
                    shistuff = shistuff.replaceAll(/\[([A-Za-z]+)\.\]/gi, "\[$1\]");
                    shistuff = shistuff.replaceAll(/【([A-Za-z]+)\.】/gi, "【$1】");
                    shistuff = shistuff.replaceAll(/『([A-Za-z]+)\.』/gi, "『$1』");
                    shistuff = shistuff.replaceAll(/^([A-Za-z]+)\.$/gim, "$1");
                    //Get rid of spaces after names
                    shistuff = shistuff.replaceAll(/(\\name【.*】)[:,.　][ 　]*/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\nw【.*】)[:,. 　][ 　]*/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\n【.*】)[:,. 　][ 　]*/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\name\[[^\]\r\n]*\])[:,. 　][ 　]*/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\nw\[[^\]\r\n]*\])[:,. 　][ 　]*/gi, "$1");
                    shistuff = shistuff.replaceAll(/(\\n\[[^\]\r\n]*\])[:,. 　][ 　]*/gi, "$1");
                    shistuff = shistuff.replaceAll(/(<.*>)[:,. 　][ 　]*/gi, "$1");
                    //Get rid of lowercase after Names
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))a/g, "$1A");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))b/g, "$1B");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))c/g, "$1C");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))d/g, "$1D");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))e/g, "$1E");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))f/g, "$1F");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))g/g, "$1G");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))h/g, "$1H");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))i/g, "$1I");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))j/g, "$1J");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))k/g, "$1K");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))l/g, "$1L");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))m/g, "$1M");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))n/g, "$1N");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))o/g, "$1O");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))p/g, "$1P");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))q/g, "$1Q");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))r/g, "$1R");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))s/g, "$1S");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))t/g, "$1T");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))u/g, "$1U");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))v/g, "$1V");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))w/g, "$1W");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))x/g, "$1X");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))y/g, "$1Y");
                    shistuff = shistuff.replaceAll(/((?:\\name[\[【].*?[\]】])|(?:\\NAME[\[【].*?[\]】])|(?:\\nw?[\[【].*?[\]】])|(?:\\NW?[\[【].*?[\]】])|(?:<.*?>))z/g, "$1Z");
                    //Get rid of spaces after color changes
                    shistuff = shistuff.replaceAll(/(?<=[ ]|^)(\\c\[\d+?\]) /g, "$1");
                    shistuff = shistuff.replaceAll(/ (\\c\[\d+?\])(?=[ ]|$)/g, "$1");
                    //Sugoi Translation fixes
                    shistuff = shistuff.replaceAll(/(\\V\[\d])I got the gold!/g, "I got $1 gold!");
                    shistuff = shistuff.replaceAll(/(<.*>),/gi, "$1");
                    shistuff = shistuff.replaceAll("\%1\\\G Got the money!", "I got \%1\\\G !");
                    shistuff = shistuff.replaceAll("\\G Got it!", "\\G received!");
                    shistuff = shistuff.replaceAll("\\G I got it!", "\\G received!");
                    shistuff = shistuff.replaceAll("\\GIt's necessary.", "\\G is required.");
                    if (origstuff.match(/%1が出現！/g) != null) {
                        shistuff = shistuff.replaceAll("%12 has appeared!", "%1 has appeared!");
                    }
                    shistuff = shistuff.replaceAll("Yes\, sir.", "Yes");
                    shistuff = shistuff.replaceAll("\\\\\"", "\\\"");
                    shistuff = shistuff.replaceAll("No\, sir.", "No");
                    shistuff = shistuff.replaceAll(/^(\\V\[\d+\])Twice./g, "$1ct");
                    shistuff = shistuff.replaceAll(/(\\V\[\d+\])Twice./g, "$1ct.");
                    shistuff = shistuff.replaceAll(/(\\V\[\d+\])Twice/g, "$1ct");
                    shistuff = shistuff.replaceAll(/Teman\b/g, "Fingering");
                    shistuff = shistuff.replaceAll("Hagure", "Rogue");
                    shistuff = shistuff.replaceAll("Shotacon", "Youngster");
                    shistuff = shistuff.replaceAll("shotacon", "youngster");
                    shistuff = shistuff.replaceAll("Shota", "Youngster");
                    shistuff = shistuff.replaceAll("shota", "youngster");
                    shistuff = shistuff.replaceAll("lolicon", "pervert");
                    shistuff = shistuff.replaceAll("Lolicon", "Pervert");
                    shistuff = shistuff.replaceAll("lolita", "girl");
                    shistuff = shistuff.replaceAll("Lolita", "Girl");
                    shistuff = shistuff.replaceAll("loli", "girl");
                    shistuff = shistuff.replaceAll("Loli", "Girl");
                    shistuff = shistuff.replaceAll("Minamidoutsu", "South Cave");
                    shistuff = shistuff.replaceAll("Higashinoiwaba", "Eastern Rocky Area");
                    shistuff = shistuff.replaceAll("I\'ll stop.", "Cancel");
                    shistuff = shistuff.replaceAll("Trabassami", "Bear Trap");
                    shistuff = shistuff.replaceAll("Yukyuumawaro", "Perpetual Corridor");
                    shistuff = shistuff.replaceAll("Don\'t worry, komori.", "Dangerous Bat");
                    shistuff = shistuff.replaceAll("Sief", "Thief");
                    shistuff = shistuff.replaceAll("I\'ll fly.", "I\'ll skip it.");
                    shistuff = shistuff.replaceAll("Do you want to fly the OP?", "Do you want to skip the opening?");
                    shistuff = shistuff.replaceAll("Komori", "Bat");
                    shistuff = shistuff.replaceAll("Undett", "Undead");
                    shistuff = shistuff.replaceAll("Stan resistance", "Stun resistance");
                    shistuff = shistuff.replaceAll(" inma ", " lewd ");
                    shistuff = shistuff.replaceAll("Inma ", "Lewd ");
                    shistuff = shistuff.replaceAll("Yandele", "Yandere");
                    shistuff = shistuff.replaceAll(/^I fly the OP.$/g, "Skip OP");
                    shistuff = shistuff.replaceAll(/^Fly the opening$/g, "Skip the opening");
                    shistuff = shistuff.replaceAll(/^Fly this H event$/g, "Skip this H event");
                    shistuff = shistuff.replaceAll(/^I won't fly.$/g, "Do not Skip");
                    shistuff = shistuff.replaceAll("Nakadashi", "Creampie");
                    shistuff = shistuff.replaceAll("nakadashi", "creampie");
                    shistuff = shistuff.replaceAll("Female Knight", "Knightess");
                    shistuff = shistuff.replaceAll("female knight", "knightess");
                    shistuff = shistuff.replaceAll("female Knight", "Knightess");
                    shistuff = shistuff.replaceAll("Female knight", "Knightess");
                    //Single word/meaning
                    shistuff = shistuff.replaceAll(/^High Potions$/gi, "High Potion");
                    shistuff = shistuff.replaceAll(/^Potions$/gi, "Potion");
                    shistuff = shistuff.replaceAll(/^Cannibal flowers$/g, "Cannibal Flower");
                    shistuff = shistuff.replaceAll(/^Vampires$/g, "Vampire");
                    shistuff = shistuff.replaceAll(/^Succubi$/g, "Succubus");
                    shistuff = shistuff.replaceAll(/^Maou$/g, "Devil");
                    shistuff = shistuff.replaceAll(/^Inuijiki$/g, "Dry Lichen");
                    shistuff = shistuff.replaceAll(/^Oogumo$/g, "Big Spider");
                    shistuff = shistuff.replaceAll(/^Minatogai\b/g, "Port City");
                    shistuff = shistuff.replaceAll(/^Minatochō\b/g, "Port Town");
                    shistuff = shistuff.replaceAll(/^Kitanoyashiki\b/g, "North Mansion");
                    shistuff = shistuff.replaceAll(/^Konoomimori\b/g, "Child's amulet");
                    shistuff = shistuff.replaceAll(/^Ushinoomimori\b/g, "Amulet of the Ox");
                    shistuff = shistuff.replaceAll(/^Toranomimori\b/g, "Tiger's amulet");
                    shistuff = shistuff.replaceAll(/^Unoomimori\b/g, "Rabbit amulet");
                    shistuff = shistuff.replaceAll(/^Tatsunoomimori\b/g, "Dragon amulet");
                    shistuff = shistuff.replaceAll(/^Yuyaminonumaji\b/g, "Twilight Swamp");
                    shistuff = shistuff.replaceAll(/^Oujou\b/g, "Royal Castle");
                    shistuff = shistuff.replaceAll(/^Minomimori\b/g, "Snake amulet");
                    shistuff = shistuff.replaceAll(/^Umanoomimori\b/g, "Amulet of the afternoon");
                    shistuff = shistuff.replaceAll(/^Mi no Omori\b/g, "Mi no talisman");
                    shistuff = shistuff.replaceAll(/^Saru no Omori\b/g, "Monkey's amulet");
                    shistuff = shistuff.replaceAll(/^Tori no Mimori\b/g, "Rooster charm");
                    shistuff = shistuff.replaceAll(/^Inu no Omori\b/g, "Dog amulet");
                    shistuff = shistuff.replaceAll(/^Inogomori\b/g, "Pig's amulet");
                    shistuff = shistuff.replaceAll(/^Michinakamimori\b/g, "Amulet on the road");
                    shistuff = shistuff.replaceAll(/^Nishinosekisho\b/g, "Western Checkpoint");
                    shistuff = shistuff.replaceAll(/^Kitanosekisho\b/g, "Northern Checkpoint");
                    shistuff = shistuff.replaceAll(/^Minaminosekisho\b/g, "Southern Checkpoint");
                    shistuff = shistuff.replaceAll(/^Morinoichiken\'ya\b/g, "House in the Forest");
                    shistuff = shistuff.replaceAll(/^Oyashiro no Mikoto\b/g, "Priest of Oyashiro");
                    shistuff = shistuff.replaceAll(/^Youmanomori\b/g, "Monster Forest");
                    shistuff = shistuff.replaceAll(/^Shiroshitachō\b/g, "Castle Town");
                    shistuff = shistuff.replaceAll(/^Yasaihata\b/g, "Vegetable Field");
                    shistuff = shistuff.replaceAll(/^Night Mazoku\b/g, "Demon Tribe");
                    shistuff = shistuff.replaceAll(/^Magimaticians\b/g, "Mage");
                    shistuff = shistuff.replaceAll(/^Yakubanishidate\b/g, "Town Hall West Building");
                    shistuff = shistuff.replaceAll(/^Reiginnoootsuchi\b/g, "Spirit Silver Hammer");
                    shistuff = shistuff.replaceAll(/^Shukuya\b/g, "Inn");
                    shistuff = shistuff.replaceAll(/^Yashiki\b/g, "Mansion");
                    shistuff = shistuff.replaceAll(/^Oohiroma\b/g, "Great Hall");
                    shistuff = shistuff.replaceAll(/^Borogoya\b/g, "Dilapidated Hut");
                    shistuff = shistuff.replaceAll(/^Yukakugai\b/g, "Red-light district");
                    shistuff = shistuff.replaceAll(/^Yukaku\b/g, "Red-light district");
                    shistuff = shistuff.replaceAll(/^Nishinomori\b/g, "West Forest");
                    shistuff = shistuff.replaceAll(/^Nishinoyama\b/g, "West Mountain");
                    shistuff = shistuff.replaceAll(/^Hayashimichi\b/g, "Forest Road");
                    shistuff = shistuff.replaceAll(/^Monookigoya\b/g, "Storage Shed");
                    shistuff = shistuff.replaceAll(/^Ushigoya\b/g, "Cow Shed");
                    shistuff = shistuff.replaceAll(/^Chinkonhaka\b/g, "Enshrinement Cemetery");
                    //shistuff = shistuff.replaceAll(/^   \b/g, "  ");
                    //shistuff = shistuff.replaceAll(/^   \b/g, "  ");
                    //shistuff = shistuff.replaceAll(/^   \b/g, "  ");
                    //shistuff = shistuff.replaceAll(/^   \b/g, "  ");
                    //Fix Names
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Old man[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Old Man");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Old man[\.]?([ ]?[\d]*)】/gi, "【Old Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Old man[\.]?([ ]?[\d]*)]/gi, "\[Old Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)A girl[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【A girl[\.]?([ ]?[\d]*)】/gi, "【Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[A girl[\.]?([ ]?[\d]*)]/gi, "\[Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Customers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Customer");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Customers[\.]?([ ]?[\d]*)】/gi, "【Customer】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Customers[\.]?([ ]?[\d]*)]/gi, "\[Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Stupid son[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Stupid Boy");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Stupid son[\.]?([ ]?[\d]*)】/gi, "【Stupid Boy】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Stupid son[\.]?([ ]?[\d]*)]/gi, "\[Stupid Boy$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Uncle Narikin[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Uncle Narikin");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Uncle Narikin[\.]?([ ]?[\d]*)】/gi, "【Uncle Narikin】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Uncle Narikin[\.]?([ ]?[\d]*)]/gi, "\[Uncle Narikin$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)A cosplay girl[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Cosplay Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【A cosplay girl[\.]?([ ]?[\d]*)】/gi, "【Cosplay Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[A cosplay girl[\.]?([ ]?[\d]*)]/gi, "\[Cosplay Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Mr Bandana[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Bandana-Kun");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Mr Bandana[\.]?([ ]?[\d]*)】/gi, "【Bandana-Kun】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Mr Bandana[\.]?([ ]?[\d]*)]/gi, "\[Bandana-Kun$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Mutant soldiers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Mutant Soldier");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Mutant soldiers[\.]?([ ]?[\d]*)】/gi, "【Mutant Soldier】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Mutant soldiers[\.]?([ ]?[\d]*)]/gi, "\[Mutant Soldier$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Soldiers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Soldier");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Soldiers[\.]?([ ]?[\d]*)】/gi, "【Soldier】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Soldiers[\.]?([ ]?[\d]*)]/gi, "\[Soldier$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Damn brat[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Annoying Brat");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Damn brat[\.]?([ ]?[\d]*)】/gi, "【Annoying Brat】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Damn brat[\.]?([ ]?[\d]*)]/gi, "\[Annoying Brat$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Female students[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Female Student");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Female students[\.]?([ ]?[\d]*)】/gi, "【Female Student】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Female students[\.]?([ ]?[\d]*)]/gi, "\[Female Student$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Monks[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Monk");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Monks[\.]?([ ]?[\d]*)】/gi, "【Monk】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Monks[\.]?([ ]?[\d]*)]/gi, "\[Monk$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Veteran sailors[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Veteran Sailor");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Veteran sailors[\.]?([ ]?[\d]*)】/gi, "【Veteran Sailor】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Veteran sailors[\.]?([ ]?[\d]*)]/gi, "\[Veteran Sailor$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)erudite old man[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Erudite Old Man");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【erudite old man[\.]?([ ]?[\d]*)】/gi, "【Erudite Old Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[erudite old man[\.]?([ ]?[\d]*)]/gi, "\[Erudite Old Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)An old scholar[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Old Scholar");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【An old scholar[\.]?([ ]?[\d]*)】/gi, "【Old Scholar】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[An old scholar[\.]?([ ]?[\d]*)]/gi, "\[Old Scholar$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The receptionist[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Receptionist");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The receptionist[\.]?([ ]?[\d]*)】/gi, "【Receptionist】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The receptionist[\.]?([ ]?[\d]*)]/gi, "\[Receptionist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Port Guardsmen[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Port Guardsman");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Port Guardsmen[\.]?([ ]?[\d]*)】/gi, "【Port Guardsman】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Port Guardsmen[\.]?([ ]?[\d]*)]/gi, "\[Port Guardsman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Hired female adventurers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Hired Female Adventurer");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Hired female adventurers[\.]?([ ]?[\d]*)】/gi, "【Hired Female Adventurer】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Hired female adventurers[\.]?([ ]?[\d]*)]/gi, "\[Hired Female Adventurer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Guardsmen[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Guardsman");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Guardsmen[\.]?([ ]?[\d]*)】/gi, "【Guardsman】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Guardsmen[\.]?([ ]?[\d]*)]/gi, "\[Guardsman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Traveling peddlers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Traveling Peddler");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Traveling peddlers[\.]?([ ]?[\d]*)】/gi, "【Traveling Peddler】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Traveling peddlers[\.]?([ ]?[\d]*)]/gi, "\[Traveling Peddler$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Spectators[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Spectator");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Spectators[\.]?([ ]?[\d]*)】/gi, "【Spectator】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Spectators[\.]?([ ]?[\d]*)]/gi, "\[Spectator$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Unemployed uncle[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Unemployed Man");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Unemployed uncle[\.]?([ ]?[\d]*)】/gi, "【Unemployed Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Unemployed uncle[\.]?([ ]?[\d]*)]/gi, "\[Unemployed Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Suspicious regulars[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Suspicious Regular");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Suspicious regulars[\.]?([ ]?[\d]*)】/gi, "【Suspicious Regular】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Suspicious regulars[\.]?([ ]?[\d]*)]/gi, "\[Suspicious Regular$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)A seasoned female treasure hunter[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Seasoned Female Treasure Hunter");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【A seasoned female treasure hunter[\.]?([ ]?[\d]*)】/gi, "【Seasoned Female Treasure Hunter】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[A seasoned female treasure hunter[\.]?([ ]?[\d]*)]/gi, "\[Seasoned Female Treasure Hunter$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Drunk old man[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Drunk Old Man");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Drunk old man[\.]?([ ]?[\d]*)】/gi, "【Drunk Old Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Drunk old man[\.]?([ ]?[\d]*)]/gi, "\[Drunk Old Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)A drunken companion[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Drunk Companion");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【A drunken companion[\.]?([ ]?[\d]*)】/gi, "【】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[A drunken companion[\.]?([ ]?[\d]*)]/gi, "\[$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The innkeeper[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Innkeeper");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The innkeeper[\.]?([ ]?[\d]*)】/gi, "【Innkeeper】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The innkeeper[\.]?([ ]?[\d]*)]/gi, "\[Innkeeper$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The owner of the weapons shop[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Weapon Shop Owner");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The owner of the weapons shop[\.]?([ ]?[\d]*)】/gi, "【Weapon Shop Owner】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The owner of the weapons shop[\.]?([ ]?[\d]*)]/gi, "\[Weapon Shop Owner$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The lady at the tool shop[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Tool Shop Lady");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The lady at the tool shop[\.]?([ ]?[\d]*)】/gi, "【Tool Shop Lady】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The lady at the tool shop[\.]?([ ]?[\d]*)]/gi, "\[Tool Shop Lady$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The owner of the brothel[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Brothel Owner");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The owner of the brothel[\.]?([ ]?[\d]*)】/gi, "【Brothel Owner】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The owner of the brothel[\.]?([ ]?[\d]*)]/gi, "\[Brothel Owner$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The mysterious girl[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Mysterious Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The mysterious girl[\.]?([ ]?[\d]*)】/gi, "【Mysterious Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The mysterious girl[\.]?([ ]?[\d]*)]/gi, "\[Mysterious Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Priests[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Priest");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Priests[\.]?([ ]?[\d]*)】/gi, "【Priest】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Priests[\.]?([ ]?[\d]*)]/gi, "\[Priest$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Old man[\.]?([ ]?[\d]*)/g, "Old Man");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Old man[\.]?([ ]?[\d]*)】/gi, "【Old Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Old man[\.]?([ ]?[\d]*)/g, "\[Old Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])A girl[\.]?([ ]?[\d]*)/g, "Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【A girl[\.]?([ ]?[\d]*)】/gi, "【Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[A girl[\.]?([ ]?[\d]*)/g, "\[Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Customers[\.]?([ ]?[\d]*)/g, "Customer");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Customers[\.]?([ ]?[\d]*)】/gi, "【Customer】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Customers[\.]?([ ]?[\d]*)/g, "\[Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Stupid son[\.]?([ ]?[\d]*)/g, "Stupid Boy");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Stupid son[\.]?([ ]?[\d]*)】/gi, "【Stupid Boy】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Stupid son[\.]?([ ]?[\d]*)/g, "\[Stupid Boy$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Uncle Narikin[\.]?([ ]?[\d]*)/g, "Uncle Narikin");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Uncle Narikin[\.]?([ ]?[\d]*)】/gi, "【Uncle Narikin】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Uncle Narikin[\.]?([ ]?[\d]*)/g, "\[Uncle Narikin$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])A cosplay girl[\.]?([ ]?[\d]*)/g, "Cosplay Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【A cosplay girl[\.]?([ ]?[\d]*)】/gi, "【Cosplay Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[A cosplay girl[\.]?([ ]?[\d]*)/g, "\[Cosplay Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Mr Bandana[\.]?([ ]?[\d]*)/g, "Bandana-Kun");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Mr Bandana[\.]?([ ]?[\d]*)】/gi, "【Bandana-Kun】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Mr Bandana[\.]?([ ]?[\d]*)/g, "\[Bandana-Kun$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Mutant soldiers[ ]?[d]*/g, "Mutant Soldier");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Mutant soldiers[\.]?([ ]?[\d]*)】/gi, "【Mutant Soldier】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Mutant soldiers[\.]?([ ]?[\d]*)/g, "\[Mutant Soldier$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Soldiers[ ]?[d]*/g, "Soldier");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Soldiers[\.]?([ ]?[\d]*)】/gi, "【Soldier】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Soldiers[\.]?([ ]?[\d]*)/g, "\[Soldier$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Damn brat[\.]?([ ]?[\d]*)/g, "Annoying Brat");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Damn brat[\.]?([ ]?[\d]*)】/gi, "【Annoying Brat】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Damn brat[\.]?([ ]?[\d]*)/g, "\[Annoying Brat$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Female students[ ]?[d]*/g, "Female Student");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Female students[\.]?([ ]?[\d]*)】/gi, "【Female Student】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Female students[\.]?([ ]?[\d]*)/g, "\[Female Student$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Monks[ ]?[d]*/g, "Monk");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Monks[\.]?([ ]?[\d]*)】/gi, "【Monk】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Monks[\.]?([ ]?[\d]*)/g, "\[Monk$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Veteran sailors[ ]?[d]*/g, "Veteran Sailor");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Veteran sailors[\.]?([ ]?[\d]*)】/gi, "【Veteran Sailor】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Veteran sailors[\.]?([ ]?[\d]*)/g, "\[Veteran Sailor$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])erudite old man[\.]?([ ]?[\d]*)/g, "Erudite Old Man");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【erudite old man[\.]?([ ]?[\d]*)】/gi, "【Erudite Old Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[erudite old man[\.]?([ ]?[\d]*)/g, "\[Erudite Old Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])An old scholar[\.]?([ ]?[\d]*)/g, "Old Scholar");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【An old scholar[\.]?([ ]?[\d]*)】/gi, "【Old Scholar】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[An old scholar[\.]?([ ]?[\d]*)/g, "\[Old Scholar$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The receptionist[\.]?([ ]?[\d]*)/g, "Receptionist");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The receptionist[\.]?([ ]?[\d]*)】/gi, "【Receptionist】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The receptionist[\.]?([ ]?[\d]*)/g, "\[Receptionist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Port Guardsmen[ ]?[d]*/g, "Port Guardsman");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Port Guardsmen[\.]?([ ]?[\d]*)】/gi, "【Port Guardsman】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Port Guardsmen[\.]?([ ]?[\d]*)/g, "\[Port Guardsman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Hired female adventurers[ ]?[d]*/g, "Hired Female Adventurer");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Hired female adventurers[\.]?([ ]?[\d]*)】/gi, "【Hired Female Adventurer】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Hired female adventurers[\.]?([ ]?[\d]*)/g, "\[Hired Female Adventurer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Guardsmen[ ]?[d]*/g, "Guardsman");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Guardsmen[\.]?([ ]?[\d]*)】/gi, "【Guardsman】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Guardsmen[\.]?([ ]?[\d]*)/g, "\[Guardsman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Traveling peddlers[ ]?[d]*/g, "Traveling Peddler");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Traveling peddlers[\.]?([ ]?[\d]*)】/gi, "【Traveling Peddler】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Traveling peddlers[\.]?([ ]?[\d]*)/g, "\[Traveling Peddler$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Spectators[ ]?[d]*/g, "Spectator");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Spectators[\.]?([ ]?[\d]*)】/gi, "【Spectator】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Spectators[\.]?([ ]?[\d]*)/g, "\[Spectator$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Unemployed uncle[\.]?([ ]?[\d]*)/g, "Unemployed Man");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Unemployed uncle[\.]?([ ]?[\d]*)】/gi, "【Unemployed Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Unemployed uncle[\.]?([ ]?[\d]*)/g, "\[Unemployed Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Suspicious regulars[ ]?[d]*/g, "Suspicious Regular");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Suspicious regulars[\.]?([ ]?[\d]*)】/gi, "【Suspicious Regular】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Suspicious regulars[\.]?([ ]?[\d]*)/g, "\[Suspicious Regular$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])A seasoned female treasure hunter[\.]?([ ]?[\d]*)/g, "Seasoned Female Treasure Hunter");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【A seasoned female treasure hunter[\.]?([ ]?[\d]*)】/gi, "【Seasoned Female Treasure Hunter】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[A seasoned female treasure hunter[\.]?([ ]?[\d]*)/g, "\[Seasoned Female Treasure Hunter$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Drunk old man[\.]?([ ]?[\d]*)/g, "Drunk Old Man");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Drunk old man[\.]?([ ]?[\d]*)】/gi, "【Drunk Old Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Drunk old man[\.]?([ ]?[\d]*)/g, "\[Drunk Old Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])A drunken companion[\.]?([ ]?[\d]*)/g, "Drunk Companion");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【A drunken companion[\.]?([ ]?[\d]*)】/gi, "【】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[A drunken companion[\.]?([ ]?[\d]*)/g, "\[$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The innkeeper[ ]?[d]*/g, "Innkeeper");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The innkeeper[\.]?([ ]?[\d]*)】/gi, "【Innkeeper】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The innkeeper[\.]?([ ]?[\d]*)/g, "\[Innkeeper$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The owner of the weapons shop[\.]?([ ]?[\d]*)/g, "Weapon Shop Owner");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The owner of the weapons shop[\.]?([ ]?[\d]*)】/gi, "【Weapon Shop Owner】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The owner of the weapons shop[\.]?([ ]?[\d]*)/g, "\[Weapon Shop Owner$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The lady at the tool shop[\.]?([ ]?[\d]*)/g, "Tool Shop Lady");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The lady at the tool shop[\.]?([ ]?[\d]*)】/gi, "【Tool Shop Lady】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The lady at the tool shop[\.]?([ ]?[\d]*)/g, "\[Tool Shop Lady$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The owner of the brothel[ ]?[d]*/g, "Brothel Owner");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The owner of the brothel[\.]?([ ]?[\d]*)】/gi, "【Brothel Owner】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The owner of the brothel[\.]?([ ]?[\d]*)/g, "\[Brothel Owner$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The mysterious girl[\.]?([ ]?[\d]*)/g, "Mysterious Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The mysterious girl[\.]?([ ]?[\d]*)】/gi, "【Mysterious Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The mysterious girl[\.]?([ ]?[\d]*)/g, "\[Mysterious Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Priests[ ]?[d]*/g, "Priest");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Priests[\.]?([ ]?[\d]*)】/gi, "【Priest】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Priests[\.]?([ ]?[\d]*)/g, "\[Priest$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Children[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Youngster");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Children[\.]?([ ]?[\d]*)】/gi, "【Youngster】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Children[\.]?([ ]?[\d]*)]/gi, "\[Youngster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Children[ ]?[d]*/g, "Youngster");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Children[\.]?([ ]?[\d]*)】/gi, "【Youngster】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Children[\.]?([ ]?[\d]*)/g, "\[Youngster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Child[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Youngster");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Child[\.]?([ ]?[\d]*)】/gi, "【Youngster】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Child[\.]?([ ]?[\d]*)]/gi, "\[Youngster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Child[ ]?[d]*/g, "Youngster");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Child[\.]?([ ]?[\d]*)】/gi, "【Youngster】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Child[\.]?([ ]?[\d]*)/g, "\[Youngster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Goblins[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Goblin");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Goblins[\.]?([ ]?[\d]*)】/gi, "【Goblin】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Goblins[\.]?([ ]?[\d]*)]/gi, "\[Goblin$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Goblins[ ]?[d]*/g, "Goblin");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Goblins[\.]?([ ]?[\d]*)】/gi, "【Goblin】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Goblins[\.]?([ ]?[\d]*)/g, "\[Goblin$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Orcs[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Orc");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Orcs[\.]?([ ]?[\d]*)】/gi, "【Orc】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Orcs[\.]?([ ]?[\d]*)]/gi, "\[Orc$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Orcs[ ]?[d]*/g, "Orc");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Orcs[\.]?([ ]?[\d]*)】/gi, "【Orc】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Orcs[\.]?([ ]?[\d]*)/g, "\[Orc$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Fairies[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Fairy");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Fairies[\.]?([ ]?[\d]*)】/gi, "【Fairy】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Fairies[\.]?([ ]?[\d]*)]/gi, "\[Fairy$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Fairies[ ]?[d]*/g, "Fairy");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Fairies[\.]?([ ]?[\d]*)】/gi, "【Fairy】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Fairies[\.]?([ ]?[\d]*)/g, "\[Fairy$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Women[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Woman");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Women[\.]?([ ]?[\d]*)】/gi, "【Woman】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Women[\.]?([ ]?[\d]*)]/gi, "\[Woman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Women[\.]?([ ]?[\d]*)/g, "Woman");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Women[\.]?([ ]?[\d]*)】/gi, "【Woman】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Women[\.]?([ ]?[\d]*)/g, "\[Woman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Mages[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Mage");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Mages[\.]?([ ]?[\d]*)】/gi, "【Mage】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Mages[\.]?([ ]?[\d]*)]/gi, "\[Mage$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Mages[ ]?[d]*/g, "Mage");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Mages[\.]?([ ]?[\d]*)】/gi, "【Mage】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Mages[\.]?([ ]?[\d]*)/g, "\[Mage$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Martial artists[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Martial Artist");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Martial artists[\.]?([ ]?[\d]*)】/gi, "【Martial Artist】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Martial artists[\.]?([ ]?[\d]*)]/gi, "\[Martial Artist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Martial artists[ ]?[d]*/g, "Martial Artist");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Martial artists[\.]?([ ]?[\d]*)】/gi, "【Martial Artist】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Martial artists[\.]?([ ]?[\d]*)/g, "\[Martial Artist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Bandits[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Bandit");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Bandits[\.]?([ ]?[\d]*)】/gi, "【Bandit】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Bandits[\.]?([ ]?[\d]*)]/gi, "\[Bandit$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Bandits[ ]?[d]*/g, "Bandit");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Bandits[\.]?([ ]?[\d]*)】/gi, "【Bandit】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Bandits[\.]?([ ]?[\d]*)/g, "\[Bandit$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Fiends[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Fiend");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Fiends[\.]?([ ]?[\d]*)】/gi, "【Fiend】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Fiends[\.]?([ ]?[\d]*)]/gi, "\[Fiend$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Fiends[ ]?[d]*/g, "Fiend");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Fiends[\.]?([ ]?[\d]*)】/gi, "【Fiend】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Fiends[\.]?([ ]?[\d]*)/g, "\[Fiend$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Subordinates[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Subordinate");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Subordinates[\.]?([ ]?[\d]*)】/gi, "【Subordinate】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Subordinates[\.]?([ ]?[\d]*)]/gi, "\[Subordinate$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Subordinates[ ]?[d]*/g, "Subordinate");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Subordinates[\.]?([ ]?[\d]*)】/gi, "【Subordinate】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Subordinates[\.]?([ ]?[\d]*)/g, "\[Subordinate$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Son of the village chief[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Village Chief's Son");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Son of the village chief[\.]?([ ]?[\d]*)】/gi, "【Village Chief's Son】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Son of the village chief[\.]?([ ]?[\d]*)]/gi, "\[Village Chief's Son$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Son of the village chief[\.]?([ ]?[\d]*)/g, "Village Chief's Son");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Son of the village chief[\.]?([ ]?[\d]*)】/gi, "【Village Chief's Son】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Son of the village chief[\.]?([ ]?[\d]*)/g, "\[Village Chief's Son$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Adventurers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Adventurer");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Adventurers[\.]?([ ]?[\d]*)】/gi, "【Adventurer】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Adventurers[\.]?([ ]?[\d]*)]/gi, "\[Adventurer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Adventurers[ ]?[d]*/g, "Adventurer");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Adventurers[\.]?([ ]?[\d]*)】/gi, "【Adventurer】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Adventurers[\.]?([ ]?[\d]*)/g, "\[Adventurer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Disciples[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Disciple");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Disciples[\.]?([ ]?[\d]*)】/gi, "【Disciple】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Disciples[\.]?([ ]?[\d]*)]/gi, "\[Disciple$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Disciples[ ]?[d]*/g, "Disciple");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Disciples[\.]?([ ]?[\d]*)】/gi, "【Disciple】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Disciples[\.]?([ ]?[\d]*)/g, "\[Disciple$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The innkeeper[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Innkeeper");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The innkeeper[\.]?([ ]?[\d]*)】/gi, "【Innkeeper】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The innkeeper[\.]?([ ]?[\d]*)]/gi, "\[Innkeeper$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The innkeeper[\.]?([ ]?[\d]*)/g, "Innkeeper");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The innkeeper[\.]?([ ]?[\d]*)】/gi, "【Innkeeper】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The innkeeper[\.]?([ ]?[\d]*)/g, "\[Innkeeper$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)A lively girl[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Lively Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【A lively girl[\.]?([ ]?[\d]*)】/gi, "【Lively Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[A lively girl[\.]?([ ]?[\d]*)]/gi, "\[Lively Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])A lively girl[\.]?([ ]?[\d]*)/g, "Lively Girl");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【A lively girl[\.]?([ ]?[\d]*)】/gi, "【Lively Girl】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[A lively girl[\.]?([ ]?[\d]*)/g, "\[Lively Girl$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Village residents[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Village Resident");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Village residents[\.]?([ ]?[\d]*)】/gi, "【Village Resident】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Village residents[\.]?([ ]?[\d]*)]/gi, "\[Village Resident$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Village residents[ ]?[d]*/g, "Village Resident");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Village residents[\.]?([ ]?[\d]*)】/gi, "【Village Resident】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Village residents[\.]?([ ]?[\d]*)/g, "\[Village Resident$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Scholars[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Scholar");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Scholars[\.]?([ ]?[\d]*)】/gi, "【Scholar】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Scholars[\.]?([ ]?[\d]*)]/gi, "\[Scholar$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Scholars[ ]?[d]*/g, "Scholar");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Scholars[\.]?([ ]?[\d]*)】/gi, "【Scholar】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Scholars[\.]?([ ]?[\d]*)/g, "\[Scholar$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Men of the village[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Village Man");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Men of the village[\.]?([ ]?[\d]*)】/gi, "【Village Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Men of the village[\.]?([ ]?[\d]*)]/gi, "\[Village Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Men of the village[ ]?[d]*/g, "Village Man");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Men of the village[\.]?([ ]?[\d]*)】/gi, "【Village Man】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Men of the village[\.]?([ ]?[\d]*)/g, "\[Village Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)You're a jerk[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Jerk");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【You're a jerk[\.]?([ ]?[\d]*)】/gi, "【Jerk】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[You're a jerk[\.]?([ ]?[\d]*)]/gi, "\[Jerk$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])You're a jerk[ ]?[d]*/g, "Jerk");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【You're a jerk[\.]?([ ]?[\d]*)】/gi, "【Jerk】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[You're a jerk[\.]?([ ]?[\d]*)/g, "\[Jerk$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Female bandits[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Female Bandit");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Female bandits[\.]?([ ]?[\d]*)】/gi, "【Female Bandit】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Female bandits[\.]?([ ]?[\d]*)]/gi, "\[Female Bandit$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Female bandits[ ]?[d]*/g, "Female Bandit");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Female bandits[\.]?([ ]?[\d]*)】/gi, "【Female Bandit】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Female bandits[\.]?([ ]?[\d]*)/g, "\[Female Bandit$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Nobles[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Noble");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Nobles[\.]?([ ]?[\d]*)】/gi, "【Noble】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Nobles[\.]?([ ]?[\d]*)]/gi, "\[Noble$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Nobles[ ]?[d]*/g, "Noble");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Nobles[\.]?([ ]?[\d]*)】/gi, "【Noble】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Nobles[\.]?([ ]?[\d]*)/g, "\[Noble$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)A sadist[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Sadist");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【A sadist[\.]?([ ]?[\d]*)】/gi, "【Sadist】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[A sadist[\.]?([ ]?[\d]*)]/gi, "\[Sadist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])A sadist[\.]?([ ]?[\d]*)/g, "Sadist");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【A sadist[\.]?([ ]?[\d]*)】/gi, "【Sadist】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[A sadist[\.]?([ ]?[\d]*)/g, "\[Sadist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Workers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Worker$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Workers[\.]?([ ]?[\d]*)】/gi, "【Worker$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Workers[\.]?([ ]?[\d]*)]/gi, "\[Worker$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Workers[\.]?([ ]?[\d]*)/g, "Worker$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Workers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Worker$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Workers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Worker$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Sailors[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Sailor$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Sailors[\.]?([ ]?[\d]*)】/gi, "【Sailor$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Sailors[\.]?([ ]?[\d]*)]/gi, "\[Sailor$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Sailors[\.]?([ ]?[\d]*)/g, "Sailor$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Sailors[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Sailor$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Sailors[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Sailor$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Gentlemen[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Gentleman$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Gentlemen[\.]?([ ]?[\d]*)】/gi, "【Gentleman$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Gentlemen[\.]?([ ]?[\d]*)]/gi, "\[Gentleman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Gentlemen[\.]?([ ]?[\d]*)/g, "Gentleman$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Gentlemen[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Gentleman$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Gentlemen[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Gentleman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Officials[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Official$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Officials[\.]?([ ]?[\d]*)】/gi, "【Official$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Officials[\.]?([ ]?[\d]*)]/gi, "\[Official$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Officials[\.]?([ ]?[\d]*)/g, "Official$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Officials[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Official$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Officials[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Official$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Thieves[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Thief$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Thieves[\.]?([ ]?[\d]*)】/gi, "【Thief$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Thieves[\.]?([ ]?[\d]*)]/gi, "\[Thief$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Thieves[\.]?([ ]?[\d]*)/g, "Thief$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Thieves[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Thief$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Thieves[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Thief$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Guards[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Guard$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Guards[\.]?([ ]?[\d]*)】/gi, "【Guard$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Guards[\.]?([ ]?[\d]*)]/gi, "\[Guard$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Guards[\.]?([ ]?[\d]*)/g, "Guard$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Guards[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Guard$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Guards[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Guard$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Tourists[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Tourist$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Tourists[\.]?([ ]?[\d]*)】/gi, "【Tourist$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Tourists[\.]?([ ]?[\d]*)]/gi, "\[Tourist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Tourists[\.]?([ ]?[\d]*)/g, "Tourist$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Tourists[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Tourist$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Tourists[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Tourist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Female tourists[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Female Tourist$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Female tourists[\.]?([ ]?[\d]*)】/gi, "【Female Tourist$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Female tourists[\.]?([ ]?[\d]*)]/gi, "\[Female Tourist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Female tourists[\.]?([ ]?[\d]*)/g, "Female Tourist$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Female tourists[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Female Tourist$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Female tourists[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Female Tourist$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Kid[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Youngster$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Kid[\.]?([ ]?[\d]*)】/gi, "【Youngster$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Kid[\.]?([ ]?[\d]*)]/gi, "\[Youngster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Kid[\.]?([ ]?[\d]*)/g, "Youngster$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Kid[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Youngster$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Kid[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Youngster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Students[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Student$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Students[\.]?([ ]?[\d]*)】/gi, "【Student$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Students[\.]?([ ]?[\d]*)]/gi, "\[Student$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Students[\.]?([ ]?[\d]*)/g, "Student$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Students[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Student$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Students[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Student$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Female adventurers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Female Adventurer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Female adventurers[\.]?([ ]?[\d]*)】/gi, "【Female Adventurer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Female adventurers[\.]?([ ]?[\d]*)]/gi, "\[Female Adventurer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Female adventurers[\.]?([ ]?[\d]*)/g, "Female Adventurer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Female adventurers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Female Adventurer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Female adventurers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Female Adventurer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Female customers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Female Customer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Female customers[\.]?([ ]?[\d]*)】/gi, "【Female Customer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Female customers[\.]?([ ]?[\d]*)]/gi, "\[Female Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Female customers[\.]?([ ]?[\d]*)/g, "Female Customer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Female customers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Female Customer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Female customers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Female Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Male customers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Male Customer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Male customers[\.]?([ ]?[\d]*)】/gi, "【Male Customer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Male customers[\.]?([ ]?[\d]*)]/gi, "\[Male Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Male customers[\.]?([ ]?[\d]*)/g, "Male Customer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Male customers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Male Customer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Male customers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Male Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Poor people[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Poor Person$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Poor people[\.]?([ ]?[\d]*)】/gi, "【Poor Person$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Poor people[\.]?([ ]?[\d]*)]/gi, "\[Poor Person$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Poor people[\.]?([ ]?[\d]*)/g, "Poor Person$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Poor people[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Poor Person$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Poor people[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Poor Person$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)A boy[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Boy$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【A boy[\.]?([ ]?[\d]*)】/gi, "【Boy$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[A boy[\.]?([ ]?[\d]*)]/gi, "\[Boy$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])A boy[\.]?([ ]?[\d]*)/g, "Boy$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【A boy[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Boy$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[A boy[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Boy$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Mr Beggar[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Beggar$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Mr Beggar[\.]?([ ]?[\d]*)】/gi, "【Beggar$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Mr Beggar[\.]?([ ]?[\d]*)]/gi, "\[Beggar$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Mr Beggar[\.]?([ ]?[\d]*)/g, "Beggar$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Mr Beggar[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Beggar$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Mr Beggar[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Beggar$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Officials[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Official$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Officials[\.]?([ ]?[\d]*)】/gi, "【Official$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Officials[\.]?([ ]?[\d]*)]/gi, "\[Official$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Officials[\.]?([ ]?[\d]*)/g, "Official$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Officials[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Official$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Officials[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Official$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Excited customers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Excited Customer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Excited customers[\.]?([ ]?[\d]*)】/gi, "【Excited Customer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Excited customers[\.]?([ ]?[\d]*)]/gi, "\[Excited Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Excited customers[\.]?([ ]?[\d]*)/g, "Excited Customer$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Excited customers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Excited Customer$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Excited customers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Excited Customer$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Shoppers[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Shopper$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Shoppers[\.]?([ ]?[\d]*)】/gi, "【Shopper$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Shoppers[\.]?([ ]?[\d]*)]/gi, "\[Shopper$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Shoppers[\.]?([ ]?[\d]*)/g, "Shopper$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Shoppers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Shopper$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Shoppers[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Shopper$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The butcher[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Butcher$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The butcher[\.]?([ ]?[\d]*)】/gi, "【Butcher$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The butcher[\.]?([ ]?[\d]*)]/gi, "\[Butcher$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The butcher[\.]?([ ]?[\d]*)/g, "Butcher$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The butcher[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Butcher$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The butcher[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Butcher$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Elven nurses[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Elven Nurse$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Elven nurses[\.]?([ ]?[\d]*)】/gi, "【Elven Nurse$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Elven nurses[\.]?([ ]?[\d]*)]/gi, "\[Elven Nurse$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Elven nurses[\.]?([ ]?[\d]*)/g, "Elven Nurse$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Elven nurses[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Elven Nurse$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Elven nurses[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Elven Nurse$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)nurses[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Nurse$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【nurses[\.]?([ ]?[\d]*)】/gi, "【Nurse$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[nurses[\.]?([ ]?[\d]*)]/gi, "\[Nurse$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])nurses[\.]?([ ]?[\d]*)/g, "Nurse$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【nurses[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Nurse$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[nurses[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Nurse$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Gangsters[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Gangster$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Gangsters[\.]?([ ]?[\d]*)】/gi, "【Gangster$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Gangsters[\.]?([ ]?[\d]*)]/gi, "\[Gangster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Gangsters[\.]?([ ]?[\d]*)/g, "Gangster$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Gangsters[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Gangster$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Gangsters[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Gangster$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Assistants[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Assistant$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Assistants[\.]?([ ]?[\d]*)】/gi, "【Assistant$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Assistants[\.]?([ ]?[\d]*)]/gi, "\[Assistant$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Assistants[\.]?([ ]?[\d]*)/g, "Assistant$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Assistants[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Assistant$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Assistants[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Assistant$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Prostitutes[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Prostitute$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Prostitutes[\.]?([ ]?[\d]*)】/gi, "【Prostitute$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Prostitutes[\.]?([ ]?[\d]*)]/gi, "\[Prostitute$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Prostitutes[\.]?([ ]?[\d]*)/g, "Prostitute$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Prostitutes[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Prostitute$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Prostitutes[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Prostitute$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Uncle Slum[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Slum Uncle$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Uncle Slum[\.]?([ ]?[\d]*)】/gi, "【Slum Uncle$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Uncle Slum[\.]?([ ]?[\d]*)]/gi, "\[Slum Uncle$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Uncle Slum[\.]?([ ]?[\d]*)/g, "Slum Uncle$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Uncle Slum[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Slum Uncle$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Uncle Slum[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Slum Uncle$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Guards[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Guard$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Guards[\.]?([ ]?[\d]*)】/gi, "【Guard$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Guards[\.]?([ ]?[\d]*)]/gi, "\[Guard$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Guards[\.]?([ ]?[\d]*)/g, "Guard$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Guards[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Guard$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Guards[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Guard$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Elven women[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Elven Woman$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Elven women[\.]?([ ]?[\d]*)】/gi, "【Elven Woman$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Elven women[\.]?([ ]?[\d]*)]/gi, "\[Elven Woman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Elven women[\.]?([ ]?[\d]*)/g, "Elven Woman$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Elven women[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Elven Woman$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Elven women[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Elven Woman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Elven attendants[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Elven Attendant$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Elven attendants[\.]?([ ]?[\d]*)】/gi, "【Elven Attendant$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Elven attendants[\.]?([ ]?[\d]*)]/gi, "\[Elven Attendant$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Elven attendants[\.]?([ ]?[\d]*)/g, "Elven Attendant$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Elven attendants[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Elven Attendant$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Elven attendants[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Elven Attendant$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)The coachman.[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Coachman$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【The coachman.[\.]?([ ]?[\d]*)】/gi, "【Coachman$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[The coachman.[\.]?([ ]?[\d]*)]/gi, "\[Coachman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])The coachman.[\.]?([ ]?[\d]*)/g, "Coachman$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【The coachman.[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Coachman$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[The coachman.[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Coachman$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Otoko[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "Man$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【Otoko[\.]?([ ]?[\d]*)】/gi, "【Man$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[Otoko[\.]?([ ]?[\d]*)]/gi, "\[Man$1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Otoko[\.]?([ ]?[\d]*)/g, "Man$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【Otoko[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【Man$1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[Otoko[\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[Man$1]");
                    /* shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)   [\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【   [\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[   [\.]?([ ]?[\d]*)]/gi, "\[   $1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])   [\.]?([ ]?[\d]*)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[   $1]"); */
                    /* shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)   [\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【   [\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[   [\.]?([ ]?[\d]*)]/gi, "\[   $1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])   [\.]?([ ]?[\d]*)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[   $1]"); */
                    /* shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)   [\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【   [\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[   [\.]?([ ]?[\d]*)]/gi, "\[   $1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])   [\.]?([ ]?[\d]*)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[   $1]"); */
                    /* shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)   [\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)【   [\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)\[   [\.]?([ ]?[\d]*)]/gi, "\[   $1]");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])   [\.]?([ ]?[\d]*)/g, "   $1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])【   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)】/gi, "【   $1】");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])\[   [\.]?([ ]?[\d]*)[\.]?([ ]?[\d]*)/g, "\[   $1]"); */
                }

                //Leftover stuff. Might be obsolete but doesn't hurt.
                shistuff = shistuff.replaceAll(/\\ C \[(\d+)]/gi, "\\C\[$1]");
                shistuff = shistuff.replaceAll(/\\ C\[(\d+)]/gi, "\\C\[$1]");
                shistuff = shistuff.replaceAll(/\\C \[(\d+)]/gi, "\\C\[$1]");

                //Place Spaces after translation inserts
                shistuff = shistuff.replaceAll(/[ ]*SHISAYESPC[ ]*(?=[」』）｣]|$)/gmi, "");
                shistuff = shistuff.replaceAll(/[ ]*SHISAYESPC[ ]*([─~\-<>\|\/！？。・…‥：；、.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´\*◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]+)$/gmi, "$1");
                shistuff = shistuff.replaceAll(/[ ]*SHISAYESPC[ ]*([^」』）｣])/gmi, " $1");
                
                trans.project.files[file].data[k][slrFixDest] = shistuff
            } while (false);
    }
    Onallmassreplacer2() {
        let files = trans.getAllFiles();
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            for (let k = 0; k < trans.project.files[file].data.length; k++) {
                this.Onallmassreplacer2Row(file, k);
            }
        }
    }
    Onallmassreplacer3Row(file, k) {
        let data = trans.project.files[file].data;
        let contexts = trans.project.files[file].context;
        do {
            let row = data[k];
            let context = contexts[k];
                // Skip empty / untranslated lines
                if (context == undefined || row == undefined || context.length == 0 || row[slrFixDest] == undefined || row[slrFixDest] == "")
                    continue;
                //make stuff less long
                let shistuff = trans.project.files[file].data[k][slrFixDest];
                let origstuff = trans.project.files[file].data[k][0];
                //make context checkable
                let contextasstring = context.toString();
                
                //Make text bubbles more pretty
                shistuff = shistuff.replaceAll(/ 「/gim, "「");
                shistuff = shistuff.replaceAll(/」 /gim, "」");
                shistuff = shistuff.replaceAll(/『 /gim, "『");
                shistuff = shistuff.replaceAll(/ 』/gim, "』");
                if (window.transConfig.englishtarget == true) {
                    //Make the translation more consistent
                    if (contextasstring.match(/(?:States)|(?:Skills)/g) == null && origstuff.match(/[!].*！/gmi) == null && origstuff.match(/\！.*[!]/gmi) == null && origstuff.match(/[?].*？/gmi) == null && origstuff.match(/？.*[?]/gmi) == null && origstuff.match(/[\.].*。/gmi) == null && origstuff.match(/。.*[\.]/gmi) == null && origstuff.match(/[,].*、/gmi) == null && origstuff.match(/、.*[,]/gmi) == null && origstuff.match(/[<\{\[\(].*[,.!?].*[\)\]\}>]/gmi) == null) {
                        if (origstuff.match(/[\.,!?]/gmi) == null) {
                            shistuff = shistuff.replaceAll(/\\+!/gim, "SHISAYEPLACEHOLDEREXP");
                            shistuff = shistuff.replaceAll(/\\+\./gim, "SHISAYEPLACEHOLDERDOT");
                            shistuff = shistuff.replaceAll(/[　 ][　 ]+/gim, " ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？]/gim, "?");
                            shistuff = shistuff.replaceAll(/[　 ]*[！]/gim, "!");
                            shistuff = shistuff.replaceAll(/[　 ]*[、]/gim, ",");
                            shistuff = shistuff.replaceAll(/[　 ]*[。]/gim, ".");
                            shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[?][　 ]*(?!$|[\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, "? ");
                            shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[!][　 ]*(?!$|[\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, "! ");
                        if (origstuff.match(/[\d０１２３４５６７８９][,、][\d０１２３４５６７８９]/gmi) == null) {
                            shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[,][　 ]*(?!$|[\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, ", ");
                        } else {
                            shistuff = shistuff.replaceAll(/(?<!\\\.|\\!|[\d０１２３４５６７８９])[　 ]*[,][　 ]*(?!$|[\d０１２３４５６７８９\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, ", ");
                        }
                        shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[.][　 ]*(?!$|[\r\n\d?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ]|\\\.|\\!)/gim, ". ");
                        shistuff = shistuff.replaceAll(/(\\C\[0\])(?!$|[\r\n?？！"｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, "$1 ");
                        shistuff = shistuff.replaceAll(/([❤♥♡♪]+)(?!$|[\r\n?？！"｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 \\])/gim, "$1 ");
                        if (origstuff.match(/[？！]/g) != null) {
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？？");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\?\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？？？");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\?\?\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？？？？");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！！");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!!!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！！！");
                            shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!!!!!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！！！！");
                        }

                        //Fix Wrong Name Punct
                        if (origstuff.match(/^.*[\.。]/g) == null) {
                            shistuff = shistuff.replaceAll(/^(.+)[？！!?。\.,、](\n[〔〖〘〚〝｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`])/g, "$1$2")
                        }
                        shistuff = shistuff.replaceAll(/(?<=^|[\[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])[ 　]*([^ 　\.]+?)[ 　]+(?=[\r\n?？！"｢「」｣『』（）\[\]\)\(}{>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”]|$)/gim, "$1");
                        shistuff = shistuff.replaceAll(/(?<=^|[\[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])[ 　]+([^ 　\.]+?)[ 　]*(?=[\r\n?？！"｢「」｣『』（）\[\]\)\(}{>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”]|$)/gim, "$1");
                        if (origstuff.match(/[\.。]/g) == null) {
                            shistuff = shistuff.replaceAll(/(?<=^|[\[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])[ 　]*([^ 　\.]+?)\.[ 　]*(?=[\r\n?？！"｢「」｣『』（）\[\]\)\(}{>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”]|$)/gim, "$1");
                        }
                        //Fix wrong sentence endings
                        shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])[　 ]+[？！!?。\.,、]+([~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=]+)([？！!?。\.,、]+)/gi, "$1$2");
                        shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])([？！!?。\.,、]+)([~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=]+)([？！!?。\.,、]+)/gi, "$1$2");
                        shistuff = shistuff.replaceAll(/[？！!?。\.,、]+([\*\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´])([？！!?。\.,、]+)/gi, "$2$1");
                        //shistuff = shistuff.replaceAll(/(.+)([\*\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´])([？！!?。\.,、]+)(?!$)/gim, "$1$3$2");
                        shistuff = shistuff.replaceAll(/(.+)([｣」』])([？！!?。\.,、]+)(?=$|\n)/gim, "$1$3$2");
                        shistuff = shistuff.replaceAll(/[　 ]*[。]+[　 ]*([？！!?\.,、]+)/gi, "$1");
                        shistuff = shistuff.replaceAll(/[　 ]*[\.]+[　 ]*([？！!?。,、]+)/gi, "$1");
                        shistuff = shistuff.replaceAll(/[　 ]*[,]+[　 ]*([？！!?。\.、]+)/gi, "$1");
                        shistuff = shistuff.replaceAll(/[　 ]*[、]+[　 ]*([？！!?。\.,]+)/gi, "$1");
                        shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                        shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                        shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                        shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                        shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！!?]+[　 ]*[?？][!！] ?/gi, "?! ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！!?]+[　 ]*[!！][?？] ?/gi, "!? ");
                        shistuff = shistuff.replaceAll(/[　 ]*[?？][!！][　 ]*[?？] ?/gi, "? ");
                        shistuff = shistuff.replaceAll(/[　 ]*[?？][!！][　 ]*[!！] ?/gi, "! ");
/*                         shistuff = shistuff.replaceAll(/[　 ]*[！!]+[　 ]*[！!][！!][！!] ?/gi, "!!! ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？?]+[　 ]*[？?][？?][？?] ?/gi, "??? "); */
                        shistuff = shistuff.replaceAll(/[　 ]*[？！?!]+[　 ]*[,、] ?/gi, ", ");
                        shistuff = shistuff.replaceAll(/[　 ]*[!！]+[　 ]*[,、] ?/gi, ", ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？?]+[　 ]*[,、] ?/gi, ", ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！]+[　 ]*[。\.] ?/gi, ". ");
                        shistuff = shistuff.replaceAll(/[　 ]*[！]+[　 ]*[。\.] ?/gi, ". ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？]+[　 ]*[。\.] ?/gi, ". ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！?!]+[　 ]*[。\.] ?/gi, ". ");
                        shistuff = shistuff.replaceAll(/[　 ]*[！!]+[　 ]*[。\.] ?/gi, ". ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？?]+[　 ]*[。\.] ?/gi, ". ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！!?\.。][　 ]*([・]+)。 ?/gi, "$1. ");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！?!]+[　 ]*([ー～〜…･]+[,？！?!、\.。]+) ?/gi, "$1 ");
                        shistuff = shistuff.replaceAll(/[　 ]*\.\.\.…。 ?/gi, "...");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！?!]\.\.\. ?/gi, "...");
                        shistuff = shistuff.replaceAll(/[　 ]*[？！?!]… ?/gi, "...");
                        shistuff = shistuff.replaceAll(/[　 ]*[…] ?/gi, "...");
                        shistuff = shistuff.replaceAll(/[　 ]*([?!\.,])[　 ][　 ]+/gi, "$1 ");
                        shistuff = shistuff.replaceAll(/([a-z]\*) [、,]/gi, "$1,");
                        shistuff = shistuff.replaceAll(/([a-z]\*) [\.。]/gi, "$1.");
                        shistuff = shistuff.replaceAll(/([a-z])(\*)[　 ]*[!！]/gi, "$1!$2");
                        shistuff = shistuff.replaceAll(/([a-z])(\*)[　 ]*[?？]/gi, "$1?$2");
                        shistuff = shistuff.replaceAll(/[　 ]+([─~\-<>\|\/！？。・…‥：；.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#])$/gmi, "$1");
                        shistuff = shistuff.replaceAll(/[　 ]+(?=[」』）｣]|$)/gmi, "");
                        if (origstuff.match(/^[？?][？?][？?][？?][？?]/g) != null) {
                            if (shistuff.match(/^[？?][？?][？?][？?][？?]/g) == null) {
                                if (shistuff.match(/^[？?]/g) != null) {
                                    shistuff = shistuff.replaceAll(/^[？?]+/g, "？？？？？");
                                }
                            }
                        } else if (origstuff.match(/^[？?][？?][？?][？?]/g) != null) {
                            if (shistuff.match(/^[？?][？?][？?][？?]/g) == null) {
                                if (shistuff.match(/^[？?]/g) != null) {
                                    shistuff = shistuff.replaceAll(/^[？?]+/g, "？？？？");
                                }
                            }
                        } else if (origstuff.match(/^[？?][？?][？?]/g) != null) {
                            if (shistuff.match(/^[？?][？?][？?]/g) == null) {
                                if (shistuff.match(/^[？?]/g) != null) {
                                    shistuff = shistuff.replaceAll(/^[？?]+/g, "？？？");
                                }
                            }
                        }
                        shistuff = shistuff.replaceAll(/ ?SHISAYEPLACEHOLDEREXP/gim, "\\!");
                        shistuff = shistuff.replaceAll(/ ?SHISAYEPLACEHOLDERDOT/gim, "\\.");
                    }
                        } else if (contextasstring.match(/(?:States)|(?:Skills)/g) == null && trans.project.files[file].tags[k] != "red" && trans.project.files[file].tags[k] != "green" && trans.project.files[file].tags[k] != "yellow" && trans.project.files[file].tags[k] != "darkred" && trans.project.files[file].tags[k] != "gold" && trans.project.files[file].tags[k] != "blue" && trans.project.files[file].tags[k] != "aqua" && trans.project.files[file].tags[k] != "purple,green" && trans.project.files[file].tags[k] != "purple,green,pink" && trans.project.files[file].tags[k] != "purple,yellow" && trans.project.files[file].tags[k] != "purple,blue") {
                            shistuff = shistuff.replaceAll(/\\+!/gim, "SHISAYEPLACEHOLDEREXP");
                            shistuff = shistuff.replaceAll(/\\+\./gim, "SHISAYEPLACEHOLDERDOT");
                            shistuff = shistuff.replaceAll(/[　 ][　 ]+/gim, " ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？]/gim, "?");
                            shistuff = shistuff.replaceAll(/[　 ]*[！]/gim, "!");
                            shistuff = shistuff.replaceAll(/[　 ]*[、]/gim, ",");
                            shistuff = shistuff.replaceAll(/[　 ]*[。]/gim, ".");
                            shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[?][　 ]*(?!$|[\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, "? ");
                            shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[!][　 ]*(?!$|[\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, "! ");
                            if (origstuff.match(/[\d０１２３４５６７８９][,、][\d０１２３４５６７８９]/gmi) == null) {
                                shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[,][　 ]*(?!$|[\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, ", ");
                            } else {
                                shistuff = shistuff.replaceAll(/(?<!\\\.|\\!|[\d０１２３４５６７８９])[　 ]*[,][　 ]*(?!$|[\d０１２３４５６７８９\r\n?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, ", ");
                            }
                            shistuff = shistuff.replaceAll(/(?<!\\\.|\\!)[　 ]*[.][　 ]*(?!$|[\r\n\d?？?！!、。,\."｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ]|\\\.|\\!)/gim, ". ");
                            shistuff = shistuff.replaceAll(/(\\C\[0\])(?!$|[\r\n?？！"｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 ])/gim, "$1 ");
                            shistuff = shistuff.replaceAll(/([❤♥♡♪]+)(?!$|[\r\n?？！"｢「」｣『』（）\[\]\)\(}{❤♥♡♪>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”　 \\])/gim, "$1 ");
                            if (origstuff.match(/[？！]/g) != null) {
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？？");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\?\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？？？");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)\?\?\?\?\? ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1？？？？？");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！！");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!!!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！！！");
                                shistuff = shistuff.replaceAll(/^([〔〖〘〚〝〞〟｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`“”]*)!!!!!! ?(?=[」｣』）\]\)\(}>〕〗〙〛〝〞〟｣〉》】）］＞>｝｠⟩\*"'´`“”]|$)/gmi, "$1！！！！！");
                            }
                            //Fix Wrong Name Punct
                            if (origstuff.match(/^.*[\.。]/g) == null) {
                                shistuff = shistuff.replaceAll(/^(.+)[？！!?。\.,、](\n[〔〖〘〚〝｢〈《「『【（［\[\({＜<｛｟⟨\*"'´`])/g, "$1$2")
                            }
                            shistuff = shistuff.replaceAll(/(?<=^|[\[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])[ 　]*([^ 　\.]+?)[ 　]+(?=[\r\n?？！"｢「」｣『』（）\[\]\)\(}{>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”]|$)/gim, "$1");
                            shistuff = shistuff.replaceAll(/(?<=^|[\[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])[ 　]+([^ 　\.]+?)[ 　]*(?=[\r\n?？！"｢「」｣『』（）\[\]\)\(}{>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”]|$)/gim, "$1");
                            if (origstuff.match(/[\.。]/g) == null) {
                                shistuff = shistuff.replaceAll(/(?<=^|[\[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])[ 　]*([^ 　\.]+?)\.[ 　]*(?=[\r\n?？！"｢「」｣『』（）\[\]\)\(}{>〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“”]|$)/gim, "$1");
                            }
                            //Fix wrong sentence endings
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])[　 ]+[？！!?。\.,、]+([~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=]+)([？！!?。\.,、]+)/gi, "$1$2");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])([？！!?。\.,、]+)([~─\-<>\/\|◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤〜～♦♣♠•◘○◙♂♀♪♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=]+)([？！!?。\.,、]+)/gi, "$1$2");
                            //shistuff = shistuff.replaceAll(/(.+)([\*\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´])([？！!?。\.,、]+)(?!$)/gim, "$1$3$2");
                            shistuff = shistuff.replaceAll(/(.+)([｣」』])([？！!?。\.,、]+)(?=$|\n)/gim, "$1$3$2");
                            shistuff = shistuff.replaceAll(/[　 ]*[。]+[　 ]*([？！!?\.,、]+)/gi, "$1");
                            shistuff = shistuff.replaceAll(/[　 ]*[\.]+[　 ]*([？！!?。,、]+)/gi, "$1");
                            shistuff = shistuff.replaceAll(/[　 ]*[,]+[　 ]*([？！!?。\.、]+)/gi, "$1");
                            shistuff = shistuff.replaceAll(/[　 ]*[、]+[　 ]*([？！!?。\.,]+)/gi, "$1");
                            shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                            shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                            shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                            shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                            shistuff = shistuff.replaceAll(/[　 ]*([？！!?。\.,、]+)[　 ]+([？！!?。\.,、]+)/gi, "$1$2");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！!?]+[　 ]*[?？][!！] ?/gi, "?! ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！!?]+[　 ]*[!！][?？] ?/gi, "!? ");
                            shistuff = shistuff.replaceAll(/[　 ]*[?？][!！][　 ]*[?？] ?/gi, "? ");
                            shistuff = shistuff.replaceAll(/[　 ]*[?？][!！][　 ]*[!！] ?/gi, "! ");
/*                             shistuff = shistuff.replaceAll(/[　 ]*[！!]+[　 ]*[！!][！!][！!] ?/gi, "!!! ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？?]+[　 ]*[？?][？?][？?] ?/gi, "??? "); */
                            shistuff = shistuff.replaceAll(/[　 ]*[？！?!]+[　 ]*[,、] ?/gi, ", ");
                            shistuff = shistuff.replaceAll(/[　 ]*[!！]+[　 ]*[,、] ?/gi, ", ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？?]+[　 ]*[,、] ?/gi, ", ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！]+[　 ]*[。\.] ?/gi, ". ");
                            shistuff = shistuff.replaceAll(/[　 ]*[！]+[　 ]*[。\.] ?/gi, ". ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？]+[　 ]*[。\.] ?/gi, ". ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！?!]+[　 ]*[。\.] ?/gi, ". ");
                            shistuff = shistuff.replaceAll(/[　 ]*[！!]+[　 ]*[。\.] ?/gi, ". ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？?]+[　 ]*[。\.] ?/gi, ". ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！!?\.。][　 ]*([・]+)。 ?/gi, "$1. ");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！?!]+[　 ]*([ー～〜…･]+[,？！?!、\.。]+) ?/gi, "$1 ");
                            shistuff = shistuff.replaceAll(/[　 ]*\.\.\.…。 ?/gi, "...");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！?!]\.\.\. ?/gi, "...");
                            shistuff = shistuff.replaceAll(/[　 ]*[？！?!]… ?/gi, "...");
                            shistuff = shistuff.replaceAll(/[　 ]*[…] ?/gi, "...");
                            shistuff = shistuff.replaceAll(/[　 ]*([?!\.,])[　 ][　 ]+/gi, "$1 ");
                            shistuff = shistuff.replaceAll(/([a-z]\*) [、,]/gi, "$1,");
                            shistuff = shistuff.replaceAll(/([a-z]\*) [\.。]/gi, "$1.");
                            shistuff = shistuff.replaceAll(/([a-z])(\*)[　 ]*[!！]/gi, "$1!$2");
                            shistuff = shistuff.replaceAll(/([a-z])(\*)[　 ]*[?？]/gi, "$1?$2");
                            shistuff = shistuff.replaceAll(/[　 ]+([─~\-<>\|\/！？。・…‥：；.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#])$/gmi, "$1");
                            shistuff = shistuff.replaceAll(/[　 ]+(?=[」』）｣]|$)/gmi, "");
                            if (origstuff.match(/^[？?][？?][？?][？?][？?]/g) != null) {
                                if (shistuff.match(/^[？?][？?][？?][？?][？?]/g) == null) {
                                    if (shistuff.match(/^[？?]/g) != null) {
                                        shistuff = shistuff.replaceAll(/^[？?]+/g, "？？？？？");
                                    }
                                }
                            } else if (origstuff.match(/^[？?][？?][？?][？?]/g) != null) {
                                if (shistuff.match(/^[？?][？?][？?][？?]/g) == null) {
                                    if (shistuff.match(/^[？?]/g) != null) {
                                        shistuff = shistuff.replaceAll(/^[？?]+/g, "？？？？");
                                    }
                                }
                            } else if (origstuff.match(/^[？?][？?][？?]/g) != null) {
                                if (shistuff.match(/^[？?][？?][？?]/g) == null) {
                                    if (shistuff.match(/^[？?]/g) != null) {
                                        shistuff = shistuff.replaceAll(/^[？?]+/g, "？？？");
                                    }
                                }
                            }
                            shistuff = shistuff.replaceAll(/ ?SHISAYEPLACEHOLDEREXP/gim, "\\!");
                            shistuff = shistuff.replaceAll(/ ?SHISAYEPLACEHOLDERDOT/gim, "\\.");
                            //nameplaceholders need a space before words
                            shistuff = shistuff.replaceAll(/(\\n\[\d+\])([a-zA-Z])/gi, "$1 $2");
                    }
                    //Decided against the error because it was flagging too much stuff that is properly escaped.
                    /* else if (trans.project.files[file].tags[k] == "red" || trans.project.files[file].tags[k] == "green" || trans.project.files[file].tags[k] == "yellow" || trans.project.files[file].tags[k] == "darkred" || trans.project.files[file].tags[k] == "gold" || trans.project.files[file].tags[k] == "blue" || trans.project.files[file].tags[k] == "aqua" && trans.project.files[file].tags[k] != "purple,green" && trans.project.files[file].tags[k] != "purple,green,pink" && trans.project.files[file].tags[k] != "purple,yellow" && trans.project.files[file].tags[k] != "purple,blue") {
                    if (shistuff != "" && shistuff != undefined && shistuff != null) {
                    slrAddErr(file, k, "　SHISAYE.CHECKFORMATTING　");
                    }
                    } */
                }
                //Fix missing speech bubble stuff
                if (origstuff.match(/^\\[n]<.*?>「/gmi) != null) {
                    if (shistuff.match(/^\\[n]<.*?>「/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]<.*?>)/gmi, "$1「");
                    }
                }
                if (origstuff.match(/^\\[n]<.*?>『/gmi) != null) {
                    if (shistuff.match(/^\\[n]<.*?>『/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]<.*?>)/gmi, "$1『");
                    }
                }
                if (origstuff.match(/^\\[n]<.*?>（/gmi) != null) {
                    if (shistuff.match(/^\\[n]<.*?>（/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]<.*?>)/gmi, "$1（");
                    }
                }
                if (origstuff.match(/^\\[n]<.*?>｢/gmi) != null) {
                    if (shistuff.match(/^\\[n]<.*?>｢/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]<.*?>)/gmi, "$1｢");
                    }
                }

                if (origstuff.match(/^\\[n]\[[^\]\r\n]*?\]「/gmi) != null) {
                    if (shistuff.match(/^\\[n]\[[^\]\r\n]*?\]「/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]\[[^\]\r\n]*?\])/gmi, "$1「");
                    }
                }
                if (origstuff.match(/^\\[n]\[[^\]\r\n]*?\]『/gmi) != null) {
                    if (shistuff.match(/^\\[n]\[[^\]\r\n]*?\]『/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]\[[^\]\r\n]*?\])/gmi, "$1『");
                    }
                }
                if (origstuff.match(/^\\[n]\[[^\]\r\n]*?\]（/gmi) != null) {
                    if (shistuff.match(/^\\[n]\[[^\]\r\n]*?\]（/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]\[[^\]\r\n]*?\])/gmi, "$1（");
                    }
                }
                if (origstuff.match(/^\\[n]\[[^\]\r\n]*?\]｢/gmi) != null) {
                    if (shistuff.match(/^\\[n]\[[^\]\r\n]*?\]｢/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]\[[^\]\r\n]*?\])/gmi, "$1｢");
                    }
                }

                if (origstuff.match(/^\\[n][w]\[[^\]\r\n]*?\]「/gmi) != null) {
                    if (shistuff.match(/^\\[n][w]\[[^\]\r\n]*?\]「/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n][w]\[[^\]\r\n]*?\])/gmi, "$1「");
                    }
                }
                if (origstuff.match(/^\\[n][w]\[[^\]\r\n]*?\]『/gmi) != null) {
                    if (shistuff.match(/^\\[n][w]\[[^\]\r\n]*?\]『/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n][w]\[[^\]\r\n]*?\])/gmi, "$1『");
                    }
                }
                if (origstuff.match(/^\\[n][w]\[[^\]\r\n]*?\]（/gmi) != null) {
                    if (shistuff.match(/^\\[n][w]\[[^\]\r\n]*?\]（/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n][w]\[[^\]\r\n]*?\])/gmi, "$1（");
                    }
                }
                if (origstuff.match(/^\\[n][w]\[[^\]\r\n]*?\]｢/gmi) != null) {
                    if (shistuff.match(/^\\[n][w]\[[^\]\r\n]*?\]｢/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n][w]\[[^\]\r\n]*?\])/gmi, "$1｢");
                    }
                }

                if (origstuff.match(/^\\[n]ame\[[^\]\r\n]*?\]「/gmi) != null) {
                    if (shistuff.match(/^\\[n]ame\[[^\]\r\n]*?\]「/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]ame\[[^\]\r\n]*?\])/gmi, "$1「");
                    }
                }
                if (origstuff.match(/^\\[n]ame\[[^\]\r\n]*?\]『/gmi) != null) {
                    if (shistuff.match(/^\\[n]ame\[[^\]\r\n]*?\]『/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]ame\[[^\]\r\n]*?\])/gmi, "$1『");
                    }
                }
                if (origstuff.match(/^\\[n]ame\[[^\]\r\n]*?\]（/gmi) != null) {
                    if (shistuff.match(/^\\[n]ame\[[^\]\r\n]*?\]（/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]ame\[[^\]\r\n]*?\])/gmi, "$1（");
                    }
                }
                if (origstuff.match(/^\\[n]ame\[[^\]\r\n]*?\]｢/gmi) != null) {
                    if (shistuff.match(/^\\[n]ame\[[^\]\r\n]*?\]｢/gmi) == null) {
                        shistuff = shistuff.replaceAll(/^(\\[n]ame\[[^\]\r\n]*?\])/gmi, "$1｢");
                    }
                }

                if (origstuff.match(/」$/g) != null) {
                    if (shistuff.match(/」/g) == null) {
                        shistuff = shistuff.replaceAll(/(.+?)$/g, "$1」");
                    }
                }
                if (origstuff.match(/』$/g) != null) {
                    if (shistuff.match(/』/g) == null) {
                        shistuff = shistuff.replaceAll(/(.+?)$/g, "$1』");
                    }
                }
                if (origstuff.match(/）$/g) != null) {
                    if (shistuff.match(/）/g) == null) {
                        shistuff = shistuff.replaceAll(/(.+?)$/g, "$1）");
                    }
                }
                if (origstuff.match(/｣$/g) != null) {
                    if (shistuff.match(/｣/g) == null) {
                        shistuff = shistuff.replaceAll(/(.+?)$/g, "$1｣");
                    }
                }
                //re-insert empty starting lines from the original
                if (origstuff.match(/^\s*[\n\r]/g) != null && shistuff.match(/^\s*[\n\r]/g) == null) {
                    let tempshi = shistuff;
                    tempshi = origstuff.match(/^\s*[\n\r]/g) + tempshi;
                    if (origstuff.toString().split('\n').length > 5 || tempshi.toString().split('\n').length < 5) {
                        shistuff = tempshi;
                    }
                }
                //re-insert lost whitespace
                if (origstuff.match(/^[\n\r]*[　]+\S/g) != null && shistuff.match(/^[\n\r]*[　]+\S/g) == null) {
                    let tempstuff = origstuff.replaceAll(/[\n\r]\s*$/g, "");
                    if (tempstuff.match(/^[\n\r]*[　]+\S.*$/g) != null) {
                    let tempshi = shistuff;
                    tempshi = tempshi.replaceAll(/^[\n\r]*[　 ]*/g, "");
                    tempshi = tempstuff.match(/^[\n\r]*[　]+/g) + tempshi;
                        if (origstuff.toString().split('\n').length > 5 || tempshi.toString().split('\n').length < 5) {
                            shistuff = tempshi;
                        }
                    }
                }
                if (window.transConfig.englishtarget == true) {
                    //Get rid of Sugoi placeholders and quirks
                    shistuff = shistuff.replaceAll(/[ ]+　+/g, " ");
                    shistuff = shistuff.replaceAll(/　+[ ]+/g, " ");
                    if (origstuff.match(/>\"/g) == null) {
                        shistuff = shistuff.replaceAll("<unk>\"", "");
                    }
                    if (origstuff.match(/<unk>/g) == null) {
                        shistuff = shistuff.replaceAll("<unk>", "");
                    }
                    if (shistuff.match(/<[^>]+unk>/g) == null) {
                        shistuff = shistuff.replaceAll("unk>", "");
                    }
                    if (origstuff.match(/\\ac(?![\\\n]|$)/g) != null) {
                        shistuff = shistuff.replaceAll(/^(\\ac)[　]?([a-zA-z])/gm, "$1 $2");
                    }
                    if (origstuff.match(/\\MCD(?![\\\n]$)/g) != null) {
                        shistuff = shistuff.replaceAll(/^(\\MCD)[　]?([a-zA-z])/gm, "$1 $2");
                    }
                    if (origstuff.match(/\\WSR(?![\\\n]$)/g) != null) {
                        shistuff = shistuff.replaceAll(/^(\\WSR)[　]?([a-zA-z])/gm, "$1 $2");
                    }
                    shistuff = shistuff.replaceAll(/^>[a-z]/g, ">A");
                    shistuff = shistuff.replaceAll(/(?<!^|[ \[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])(\\n\[\d\])(?![ >〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“\n]|$)/gim, " $1 ");
                    shistuff = shistuff.replaceAll(/(?<=^|[ \[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])(\\n\[\d\])(?![ >〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“\n]|$)/gim, "$1 ");
                    shistuff = shistuff.replaceAll(/(?<!^|[ \[\]【】「」『』（）\(\)\"<\\〔⟨〖〘〚〝〞〟｢〈《「『【（［{＜｛｟⟨"'´`“\n])(\\n\[\d\])(?=[ >〕〗〙〛〝〞〟｣〉》」』】）］＞>｝｠⟩"'´`“\n]|$)/gim, " $1");
                    shistuff = shistuff.replaceAll(/(.+)[ ](<wrap>)[ ]/g, "$2$1");
                    shistuff = shistuff.replaceAll(/(.+)(<wrap>)/g, "$2$1");
                    shistuff = shistuff.replaceAll(/^SYSTEM/g, "SYSTEM\n");
                    shistuff = shistuff.replaceAll(/^SYSTEM\n\n/g, "SYSTEM\n");
                    shistuff = shistuff.replaceAll(/\]I got it!/g, "\] received!");
                    shistuff = shistuff.replaceAll(/\]Got it!/g, "\] received!");
                    shistuff = shistuff.replaceAll(/\]I get it!/g, "\] received!");
                    shistuff = shistuff.replaceAll(/\]Get it!/g, "\] received!");
                    shistuff = shistuff.replaceAll(/%I got it!/g, "% received!");
                    shistuff = shistuff.replaceAll(/%Got it!/g, "% received!");
                    shistuff = shistuff.replaceAll(/%I get it!/g, "% received!");
                    shistuff = shistuff.replaceAll(/%Get it!/g, "% received!");
                    shistuff = shistuff.replaceAll(/(?<=[^（])(.*)\)）/g, "$1)");
                    shistuff = shistuff.replaceAll(/(\\VS\[[^\\VS\] ]*?) ([[^\\VS\]]*?)\\VS\[/gi, "$1\] $2\\VS\[");
                    shistuff = shistuff.replaceAll(/(\\VS\[[^\\VS\]]+?)\\VS\[/gi, "$1\]\\VS\[");
                    shistuff = shistuff.replaceAll(/(\\VS\[[^\]]+?][^\[]*)\]/gi, "$1");
                    shistuff = shistuff.replaceAll(/(D_TEXT.*)\.$/gi, "$1");
                    shistuff = shistuff.replaceAll(/(?<=[\]]|<|^)Twice.[\.]?([ ]?[\d]*)(?=[\\|\n]|>|$)/g, "ct$1");
                    shistuff = shistuff.replaceAll(/(?<=[\\name]|[\\nw]|[\\n])Twice.[\.]?([ ]?[\d]*)/g, "ct$1");
                    shistuff = shistuff.replaceAll(/^(【.+?】), a/g, "$1A");
                    shistuff = shistuff.replaceAll(/^(【.+?】), b/g, "$1B");
                    shistuff = shistuff.replaceAll(/^(【.+?】), c/g, "$1C");
                    shistuff = shistuff.replaceAll(/^(【.+?】), d/g, "$1D");
                    shistuff = shistuff.replaceAll(/^(【.+?】), e/g, "$1E");
                    shistuff = shistuff.replaceAll(/^(【.+?】), f/g, "$1F");
                    shistuff = shistuff.replaceAll(/^(【.+?】), g/g, "$1G");
                    shistuff = shistuff.replaceAll(/^(【.+?】), h/g, "$1H");
                    shistuff = shistuff.replaceAll(/^(【.+?】), i/g, "$1I");
                    shistuff = shistuff.replaceAll(/^(【.+?】), j/g, "$1J");
                    shistuff = shistuff.replaceAll(/^(【.+?】), k/g, "$1K");
                    shistuff = shistuff.replaceAll(/^(【.+?】), l/g, "$1L");
                    shistuff = shistuff.replaceAll(/^(【.+?】), m/g, "$1M");
                    shistuff = shistuff.replaceAll(/^(【.+?】), n/g, "$1N");
                    shistuff = shistuff.replaceAll(/^(【.+?】), o/g, "$1O");
                    shistuff = shistuff.replaceAll(/^(【.+?】), p/g, "$1P");
                    shistuff = shistuff.replaceAll(/^(【.+?】), q/g, "$1Q");
                    shistuff = shistuff.replaceAll(/^(【.+?】), r/g, "$1R");
                    shistuff = shistuff.replaceAll(/^(【.+?】), s/g, "$1S");
                    shistuff = shistuff.replaceAll(/^(【.+?】), t/g, "$1T");
                    shistuff = shistuff.replaceAll(/^(【.+?】), u/g, "$1U");
                    shistuff = shistuff.replaceAll(/^(【.+?】), v/g, "$1V");
                    shistuff = shistuff.replaceAll(/^(【.+?】), w/g, "$1W");
                    shistuff = shistuff.replaceAll(/^(【.+?】), x/g, "$1X");
                    shistuff = shistuff.replaceAll(/^(【.+?】), y/g, "$1Y");
                    shistuff = shistuff.replaceAll(/^(【.+?】), z/g, "$1Z");
                    shistuff = shistuff.replaceAll(/^(【.+?】), /g, "$1");
                    shistuff = shistuff.replaceAll(/(?<=[^\\])\.・/gi, "・");
                    shistuff = shistuff.replaceAll(/(?<=[^\\])\.・/gi, "・");
                    shistuff = shistuff.replaceAll(/(?<=[^\\])\.・/gi, "・");
                    shistuff = shistuff.replaceAll(/(?<=[^\\])\.・/gi, "・");
                    shistuff = shistuff.replaceAll(/(?<=[^\\])\.・/gi, "・");
                    shistuff = shistuff.replaceAll(/(?<=[^\\])\.・/gi, "・");
                    if (origstuff.match(/\\[\w]+\[\\[\w]+\[[\w]+\]\]/g) != null) {
                        shistuff = shistuff.replaceAll(/(\\[\w]+\[\\[\w]+\[[\w]+\])[^\]]+(\])/g, "$1$2");
                        if (shistuff.match(/\\[\w]+\[\\[\w]+\[[\w]+\]\]/g) == null) {
                            shistuff = shistuff.replaceAll(/(\\[\w]+\[\\[\w]+\[[\w]+\])(?!\])/g, "$1\]");
                        }
                    }

                    //Remove inner ' from yellow and red cells to prevent potential crashes
                    if (trans.project.files[file].tags[k] == "red" || trans.project.files[file].tags[k] == "yellow" || trans.project.files[file].tags[k] == "purple,yellow" || trans.project.files[file].tags[k] == "green" || trans.project.files[file].tags[k] == "purple,green") {
                        if (origstuff.match(/[a-zA-Z]'[a-zA-Z]/g) == null && shistuff.match(/[a-zA-Z]'[a-zA-Z]/g) != null) {
                            shistuff = shistuff.replaceAll(/I'm/g, "I am");
                            shistuff = shistuff.replaceAll(/he's had/g, "he has had");
                            shistuff = shistuff.replaceAll(/He's had/g, "he has had");
                            shistuff = shistuff.replaceAll(/they've/g, "they have");
                            shistuff = shistuff.replaceAll(/They've/g, "they have");
                            shistuff = shistuff.replaceAll(/I've/g, "I have");
                            shistuff = shistuff.replaceAll(/You've/g, "you have");
                            shistuff = shistuff.replaceAll(/you've/g, "you have");
                            shistuff = shistuff.replaceAll(/You're/g, "You are");
                            shistuff = shistuff.replaceAll(/you're/g, "you are");
                            shistuff = shistuff.replaceAll(/Can't/g, "Cannot");
                            shistuff = shistuff.replaceAll(/can't/g, "cannot");
                            shistuff = shistuff.replaceAll(/he's/g, "he is");
                            shistuff = shistuff.replaceAll(/He's/g, "He is");
                            shistuff = shistuff.replaceAll(/time's/g, "time is");
                            shistuff = shistuff.replaceAll(/Time's/g, "Time is");
                            shistuff = shistuff.replaceAll(/life's/g, "life is");
                            shistuff = shistuff.replaceAll(/Life's/g, "Life is");
                            shistuff = shistuff.replaceAll(/That's/g, "That is");
                            shistuff = shistuff.replaceAll(/that's/g, "that is");
                            shistuff = shistuff.replaceAll(/It's/g, "It is");
                            shistuff = shistuff.replaceAll(/it's/g, "it is");
                            shistuff = shistuff.replaceAll(/They're/g, "They are");
                            shistuff = shistuff.replaceAll(/they're/g, "they are");
                            shistuff = shistuff.replaceAll(/won't/g, "will not");
                            shistuff = shistuff.replaceAll(/n't/g, " not");
                            shistuff = shistuff.replaceAll(/Let's/g, "Let us");
                            shistuff = shistuff.replaceAll(/let's/g, "let us");
                            shistuff = shistuff.replaceAll(/I'll/g, "I will");
                            shistuff = shistuff.replaceAll(/who's/g, "who is");
                            shistuff = shistuff.replaceAll(/Who's/g, "Who is");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'ve/g, " have");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'re/g, " are");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'d/g, " would");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'ll/g, " will");

                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'(?=[a-zA-Z])/gi, "");
                            if (origstuff.match(/s'(?![\r\n]|$)/g) == null) {
                                shistuff = shistuff.replaceAll(/^[ 　]+'/g, "");
                                shistuff = shistuff.replaceAll(/'[ 　]+$/g, "");
                                shistuff = shistuff.replaceAll(/s'(?![\r\n]|$)/g, "s");
                            }
                            if (origstuff.match(/'.*'.*'/g) == null) {
                                if (origstuff.match(/^'/g) == null) {
                                shistuff = shistuff.replaceAll(/^[ 　]+'/g, "");
                                } else {
                                shistuff = shistuff.replaceAll(/^[ 　]+'/g, "'");
                                }
                                if (origstuff.match(/'$/g) == null) {
                                shistuff = shistuff.replaceAll(/'[ 　]+$/g, "");
                                } else {
                                shistuff = shistuff.replaceAll(/'[ 　]+$/g, "'");
                                }
                                shistuff = shistuff.replaceAll(/(?<![\r\n\(\[\{]|^)'(?![\r\n\)\]\}]|$)/g, "");
                            }
                        }
                    }
                }

                //Make stuff that should start with \> start with \>
                if (origstuff.match(/^[ 　]*\\+>/gm) != null && origstuff.match(/\\+>.*\\+>/gi) == null) {
                    if (shistuff.match(/\\+>.*\\+>/gi) != null) {
                        shistuff = shistuff.replaceAll(/\n*[ 　]*(\\+>)[ 　]*/g, "$1");
                        shistuff = shistuff.replaceAll(/(?<!^|[\\])(\\+>)/g, "\n$1");
                    }
                }
                // remove addtional ""
                if (shistuff.match(/\"/g) != null && origstuff.match(/\"/g) == null) {
                    if (shistuff.match(/\[\)\]}〕〗〙〛〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g) != null || origstuff.match(/\[\)\]}〕〗〙〛〝〞”｣〉》」』】）］＞>｝｠〟⟩'`´〔⟨〖〘〚〝〞〟｢\(\[〈《「『【（［{＜<｛｟'´`“]/g) == null) {
                        shistuff = shistuff.replaceAll(/\"/g, "");
                    }
                }
                // remove additional empty lines.
                if (origstuff.match(/\n[ 　]*\n/g) == null && shistuff.match(/\n[ 　]*\n/g) != null) {
                    shistuff = shistuff.replaceAll(/\n[ 　]*\n/g, "");
                }
                //Fix scripts and stuff having wrong boundaries
                if (shistuff.match(/^\"[\s\S]*\"$/g) == null && origstuff.match(/^\s*\"[\s\S]*\"\s*$/g) != null) {
                    shistuff = shistuff.replaceAll(/([\s\S]+)/g, "\"$1\"");
                }
                if (shistuff.match(/^\'[\s\S]*\'$/g) == null && origstuff.match(/^\s*\'[\s\S]*\'\s*$/g) != null) {
                    shistuff = shistuff.replaceAll(/([\s\S]+)/g, "\'$1\'");
                }
                if (shistuff.match(/^\s*\"[\s\S]*\"[\s\S]*\"\s*$/gm) != null && origstuff.match(/^\s*\"[\s\S]*\"[\s\S]*\"\s*$/gm) == null) {
                    shistuff = shistuff.replaceAll(/\"/g, "”");
                    shistuff = shistuff.replaceAll(/^\s*”/gm, "\"");
                    shistuff = shistuff.replaceAll(/”\s*$/gm, "\"");
                }
                if (window.transConfig.englishtarget == true) {
                    if (shistuff.match(/^\s*\'[\s\S]*\'[\s\S]*\'\s*$/gm) != null && origstuff.match(/^\s*\'[\s\S]*\'[\s\S]*\'\s*$/gm) == null) {
                        if (origstuff.match(/[a-zA-Z]'[a-zA-Z]/g) == null && shistuff.match(/[a-zA-Z]'[a-zA-Z]/g) != null) {
                            shistuff = shistuff.replaceAll(/I'm/g, "I am");
                            shistuff = shistuff.replaceAll(/he's had/g, "he has had");
                            shistuff = shistuff.replaceAll(/He's had/g, "he has had");
                            shistuff = shistuff.replaceAll(/they've/g, "they have");
                            shistuff = shistuff.replaceAll(/They've/g, "they have");
                            shistuff = shistuff.replaceAll(/I've/g, "I have");
                            shistuff = shistuff.replaceAll(/You've/g, "you have");
                            shistuff = shistuff.replaceAll(/you've/g, "you have");
                            shistuff = shistuff.replaceAll(/You're/g, "You are");
                            shistuff = shistuff.replaceAll(/you're/g, "you are");
                            shistuff = shistuff.replaceAll(/Can't/g, "Cannot");
                            shistuff = shistuff.replaceAll(/can't/g, "cannot");
                            shistuff = shistuff.replaceAll(/he's/g, "he is");
                            shistuff = shistuff.replaceAll(/He's/g, "He is");
                            shistuff = shistuff.replaceAll(/time's/g, "time is");
                            shistuff = shistuff.replaceAll(/Time's/g, "Time is");
                            shistuff = shistuff.replaceAll(/life's/g, "life is");
                            shistuff = shistuff.replaceAll(/Life's/g, "Life is");
                            shistuff = shistuff.replaceAll(/That's/g, "That is");
                            shistuff = shistuff.replaceAll(/that's/g, "that is");
                            shistuff = shistuff.replaceAll(/It's/g, "It is");
                            shistuff = shistuff.replaceAll(/it's/g, "it is");
                            shistuff = shistuff.replaceAll(/They're/g, "They are");
                            shistuff = shistuff.replaceAll(/they're/g, "they are");
                            shistuff = shistuff.replaceAll(/won't/g, "will not");
                            shistuff = shistuff.replaceAll(/n't/g, " not");
                            shistuff = shistuff.replaceAll(/Let's/g, "Let us");
                            shistuff = shistuff.replaceAll(/let's/g, "let us");
                            shistuff = shistuff.replaceAll(/I'll/g, "I will");
                            shistuff = shistuff.replaceAll(/who's/g, "who is");
                            shistuff = shistuff.replaceAll(/Who's/g, "Who is");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'ve/g, " have");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'re/g, " are");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'d/g, " would");
                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'ll/g, " will");

                            shistuff = shistuff.replaceAll(/(?<=[a-zA-Z])'(?=[a-zA-Z])/gi, "");
                            if (origstuff.match(/s'(?![\r\n]|$)/g) == null) {
                                shistuff = shistuff.replaceAll(/^[ 　]+'/g, "");
                                shistuff = shistuff.replaceAll(/'[ 　]+$/g, "");
                                shistuff = shistuff.replaceAll(/s'(?![\r\n]|$)/g, "s");
                            }
                            if (origstuff.match(/'.*'.*'/g) == null) {
                                if (origstuff.match(/^'/g) == null) {
                                shistuff = shistuff.replaceAll(/^[ 　]+'/g, "");
                                } else {
                                shistuff = shistuff.replaceAll(/^[ 　]+'/g, "'");
                                }
                                if (origstuff.match(/'$/g) == null) {
                                shistuff = shistuff.replaceAll(/'[ 　]+$/g, "");
                                } else {
                                shistuff = shistuff.replaceAll(/'[ 　]+$/g, "'");
                                }
                                shistuff = shistuff.replaceAll(/(?<![\r\n\(\[\{\"\'=:<]|^)'(?![\r\n\)\]\}\"\';>]|$)/g, "");
                            }
                        }
                    }
                    if (shistuff.match(/^\s*\"[\s\S]*\"[\s\S]*\"\s*$/gm) != null && origstuff.match(/^\s*\"[\s\S]*\"[\s\S]*\"\s*$/gm) == null && origstuff.match(/^\s*\"[\s\S]*\"\s*$/gm) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/[\s\S]+/gm, "\"　SHISAYE.INNERBOUNDARY　\""));
                    }
                    if (shistuff.match(/^\s*\'[\s\S]*\'[\s\S]*\'\s*$/gm) != null && origstuff.match(/^\s*\'[\s\S]*\'[\s\S]*\'\s*$/gm) == null && origstuff.match(/^\s*\'[\s\S]*\'\s*$/gm) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/[\s\S]+/gm, "\'　SHISAYE.INNERBOUNDARY　\'"));
                    }

                    // Fix missing spaces after variables
                    if (origstuff.match(/\\v\[\d+\]/gi) != null) {
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(times)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(ct)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(materials)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(ammo)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(funds)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(gold)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(yen)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(pieces)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(sheets)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(enemies)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(allies)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(friends)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(rapes)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(tries)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(fails)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(failures)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(victories)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(wins)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(losses)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(fights)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(deaths)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(quests)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(jobs)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(encounters)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(lifes)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(mana)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(arrows)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(bullets)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(stones)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(bolts)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(creampies)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(blowjobs)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(handjobs)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(footjobs)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(missions)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(days)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(hours)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(minutes)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(seconds)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(years)/gi, "$1 $2");
                        shistuff = shistuff.replaceAll(/(\\v\[\d+?\])(months)/gi, "$1 $2");
                    }
                }
                if (origstuff.match(/ [〔〖〘〚〝〈《「『【（［｛｟]/g) == null) {
                    shistuff = shistuff.replaceAll(/ +([〔〖〘〚〝〈《「『【（［｛｟])/g, "$1");
                }
                if (origstuff.match(/[」』）〕〗〙〛〞〟〉》】）］｝｠] /g) == null) {
                    shistuff = shistuff.replaceAll(/([」』）〕〗〙〛〞〟〉》】）］｝｠]) +/g, "$1");
                }
                //Namepop
                while (shistuff.match(/^([ ]?[<]?namePop[:]?.+?)[　 ](.+?[>]?)/g) != null) {
                    shistuff = shistuff.replaceAll(/^([ ]?[<]?namePop[:]?.+?)[　 ](.+?[>]?)/g, "$1 $2");
                }
                shistuff = shistuff.replaceAll(/^([ ]*[<]namePop[:][^\-\d]*)[ 　 ]+([\-][\d]+)[ 　 ]+(.+?)[ 　 ]*(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey[>])/g, "$1 $2 $3 $4");
                shistuff = shistuff.replaceAll(/^([ ]*[<]namePop[:][^\-\d]*)[ 　 ]+([\-][\d]+)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey[>])/g, "$1 $2 $3");
                shistuff = shistuff.replaceAll(/^([ ]*[<]namePop[:][^\-\d]*)[ 　 ]+([\d]+)[ 　 ]+(.+?)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey[>])/g, "$1 $2 $3 $4");
                shistuff = shistuff.replaceAll(/^([ ]*[<]namePop[:][^\-\d]*)[ 　 ]+([\d]+)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey[>])/g, "$1 $2 $3");
                shistuff = shistuff.replaceAll(/^([ ]*[<]namePop[:][^\-\d]*)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey[>])/g, "$1 $2");
                shistuff = shistuff.replaceAll(/^([ ]*namePop[^:\-\d]*)[ 　 ]+([\-][\d]+)[ 　 ]+(.+?)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)(?=[^>]|$)/g, "$1 $2 $3  $4");
                shistuff = shistuff.replaceAll(/^([ ]*namePop[^:\-\d]*)[ 　 ]+([\-][\d]+)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)(?=[^>]|$)/g, "$1 $2  $3");
                shistuff = shistuff.replaceAll(/^([ ]*namePop[^:\-\d]*)[ 　 ]+([\d]+)[ 　 ]+(.+?)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)(?=[^>]|$)/g, "$1 $2 $3  $4");
                shistuff = shistuff.replaceAll(/^([ ]*namePop[^:\-\d]*)[ 　 ]+([\d]+)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)(?=[^>]|$)/g, "$1 $2  $3");
                shistuff = shistuff.replaceAll(/^([ ]*namePop[^:\-\d]*)[ 　 ]+(red|blue|yellow|green|black|white|purple|pink|silver|gray|grey)(?=[^>]|$)/g, "$1  $2");
                //OSW UI plugin
                if (origstuff.match(/^OSW_.*?text \d+ /gm) != null) {
                    while (shistuff.match(/^OSW_.*?text \d+ .*?[ 　]/gm) != null) {
                        shistuff = shistuff.replaceAll(/^(OSW_.*?text \d+ .*?)[ 　]/gm, "$1 ");
                    }
                }
                //CommonPopup plugin
                if (origstuff.match(/^CommonPopup add text:[　 ]?/gm) != null) {
                    while (shistuff.match(/^(CommonPopup add text:[　 ].+?)[ ](?!count:|moveY:|moveX:|sy:|eventId:)(.*? (?<!count:|moveY:|moveX:|sy:|eventId:)(?:count:|moveY:|moveX:|sy:|eventId:).*)/gm) != null) {
                        shistuff = shistuff.replaceAll(/^(CommonPopup add text:[　 ].+?)[ ](?!count:|moveY:|moveX:|sy:|eventId:)(.*? (?<!count:|moveY:|moveX:|sy:|eventId:)(?:count:|moveY:|moveX:|sy:|eventId:).*)/gm, "$1 $2");
                    }
                }
                //PSM SHOW POPUP plugin
                if (origstuff.match(/^PSM_SHOW_POPUP/gm) != null) {
                    let psmStart = origstuff.match(/^PSM_SHOW_POPUP.*\d+ /m);
                    shistuff = shistuff.replaceAll(/^PSM_SHOW_POPUP.*\d+ .*?/g, "PSM_START");
                    shistuff = shistuff.replaceAll(/[ 　]/g, " ");
                    shistuff = shistuff.replaceAll(/PSM_START/g, psmStart);
                    if (origstuff.match(/(?<=^PSM_SHOW_POPUP.*\d+ [^ ]+) -[a-zA-Z]+?$/gm) != null) {
                        shistuff = shistuff.replaceAll(/ (-[a-zA-Z]+?)$/g, " $1");
                    }
                }
                //Showinfo
                if (origstuff.match(/^ShowInfo /gm) != null) {
                    shistuff = shistuff.replaceAll(/[　 ]/g, " ");
                    shistuff = shistuff.replaceAll(/^ShowInfo[ 　 ]*/gm, "ShowInfo ");
                }
                //Info: this moronic plugin doesn't even accept ISDP spaces I did not try NBSP yet, this was implemented before I switched to those
                if (origstuff.match(/^info:/gm) != null) {
                    shistuff = shistuff.replaceAll(/ /g, "_");
                    shistuff = shistuff.replaceAll(/,/g, "、");
                    shistuff = shistuff.replaceAll(/(info:.*?)、[_]+(\d+)$/gm, "$1,$2");
                    shistuff = shistuff.replaceAll(/(info:.*?)[、](\d+)$/gm, "$1,$2");
                    if (origstuff.match(/^info:.+\d+$/g) != null) {
                        if (shistuff.match(/^info:.+\d+$/g) == null) {
                            let infonumber = origstuff.replaceAll(/^info:.+(\d+)$/g, ",$1");
                            shistuff = shistuff.replaceAll(/,/g, "、");
                            shistuff = shistuff + infonumber;
                            shistuff = shistuff.replaceAll(/^(info:.*)(\d+)(.*,)(\2)$/g, "$1$3$4");
                        }
                    }
                    if (origstuff.match(/^info:.+\d\d$/g) != null) {
                        if (shistuff.match(/^info:.+\d\d$/g) == null) {
                            let infonumber = origstuff.replaceAll(/^info:.+(\d+)$/g, ",$1");
                            shistuff = shistuff.replaceAll(/,/g, "、");
                            shistuff = shistuff + infonumber;
                            shistuff = shistuff.replaceAll(/^(info:.*)(\d+)(.*,)(\2)$/g, "$1$3$4");
                        }
                    }
                }
                //en This plugin is fucked beyond belief and sometimes this is needed
                //shistuff = shistuff.replaceAll(/^(\\en\(\!?s\[\d+\]\))/g, "$1__");

                //addLog 
                if (origstuff.match(/^addLog /gim) != null) {
                    shistuff = shistuff.replaceAll(/[　 ]/g, " ");
                    shistuff = shistuff.replaceAll(/^addLog[ 　 ]*/igm, "addLog ");
                }
                //greedCommand 
                if (origstuff.match(/^greedCommand /gim) != null) {
                    shistuff = shistuff.replaceAll(/[　 ]/g, " ");
                    shistuff = shistuff.replaceAll(/^greedCommand[ 　 ]*/gim, "greedCommand ");
                }
                //D_TEXT technically not need idsp but numbers in brackets are used font size even stuff like \V[12].
                while (shistuff.match(/^(D_TEXT.*) (.*[\[\(\"\'\{]\d+[\]\)\}\"\'])/g) != null) {
                    shistuff = shistuff.replaceAll(/^(D_TEXT.*) (.*[\[\(\"\'\{]\d+[\]\)\}\"\'])/g, "$1 $2");
                }
                shistuff = shistuff.replaceAll(/^D_TEXT[ 　 ]*/g, "D_TEXT ");
                shistuff = shistuff.replaceAll(/^D_TEXT[ 　 ]+/g, "D_TEXT ");
                shistuff = shistuff.replaceAll(/^(D_TEXT .+?)[ 　 ]+([\d]+)\.?$/g, "$1 $2");
                if (origstuff.match(/^D_TEXT .+ \d+$/g) != null) {
                    if (shistuff.match(/^D_TEXT .+ \d+$/g) == null) {
                        let dtextnumber = origstuff.replaceAll(/^D_TEXT .+ (\d+)$/g, " $1");
                        shistuff = shistuff + dtextnumber;
                        shistuff = shistuff.replaceAll(/^(D_TEXT .*?)(\d+)(.* )(\2)$/g, "$1$3$4");
                        shistuff = shistuff.replaceAll(/^D_TEXT[ 　 ]*/g, "D_TEXT ");
                        shistuff = shistuff.replaceAll(/^D_TEXT[ 　 ]+/g, "D_TEXT ");
                        shistuff = shistuff.replaceAll(/^(D_TEXT.+?)[ 　 ]+([\d]+)$/g, "$1 $2");
                    }
                }
                if (origstuff.match(/^D_TEXT .+ \d\d$/g) != null) {
                    if (shistuff.match(/^D_TEXT .+ \d\d$/g) == null) {
                        let dtextnumber = origstuff.replaceAll(/^D_TEXT .+ (\d+)$/g, " $1");
                        shistuff = shistuff + dtextnumber;
                        shistuff = shistuff.replaceAll(/^(D_TEXT .*?)(\d+)(.* )(\2)$/g, "$1$3$4");
                        shistuff = shistuff.replaceAll(/^D_TEXT[ 　 ]*/g, "D_TEXT ");
                        shistuff = shistuff.replaceAll(/^D_TEXT[ 　 ]+/g, "D_TEXT ");
                        shistuff = shistuff.replaceAll(/^(D_TEXT.+?)[ 　 ]+([\d]+)$/g, "$1 $2");
                    }
                }
                //Minilabel
                if (origstuff.match(/^<Mini Label:[ ]/gm) != null) {
                    shistuff = shistuff.replaceAll(/[　 ]/g, " ");
                    shistuff = shistuff.replaceAll(/^<Mini[ 　 ]*Label:[ 　 ]*/gm, "<Mini Label: ");
                }
                //ActiveMessage
                if (origstuff.match(/^<ActiveMessage:/gm) != null) {
                    shistuff = shistuff.replaceAll(/[　 ]/g, " ");
                }

                //Keep stuff safe
                shistuff = shistuff.replaceAll("%s", "SHISAYEPLACEHOLDER01");
                shistuff = shistuff.replaceAll("%d", "SHISAYEPLACEHOLDER02");
                
                //Fix MVMZ placeholders
                if (origstuff.match(/%\d+/g) != null && shistuff.match(/%\d+/g) == null) {
                    shistuff = shistuff.replaceAll(/%.(\d)+/g, "%$1");
                }

                //Place Spaces after translation inserts again in case one was missed
                shistuff = shistuff.replaceAll(/[ ]*SHISAYESPC[ ]*(?=[」』）｣]|$)/gmi, "");
                shistuff = shistuff.replaceAll(/[ ]*SHISAYESPC[ ]*([─~\-<>\|\/！？。・…‥：；、.?!;:\]\)}〕〗〙〛〞”｣〉》」』】）］＞>｝｠〟⟩"'`´\*◆◎★■☆〇□△●♂♀⚤⚢⚨⚣⚩⚧⸸✞☦✝✟♱☥♁✙⚰️⛧♡♥❤♦♣♠•◘○◙♂♀♫►◄▲▼↑←↑→↓↓→←↔※＊〽〓♪♫♬♩〇〒〶〠〄ⓍⓁⓎ<>\-\+=\#]+)$/gmi, "$1");
                shistuff = shistuff.replaceAll(/[ ]*SHISAYESPC[ ]*([^」』）｣])/gmi, " $1");
                
                //remove placeholder remains
                if (shistuff.match(/@/g) != null) {
                    if (origstuff.match(/@/g) == null) {
                        shistuff = shistuff.replaceAll(/[ 　]+@+[ 　]+/gi, " ");
                        shistuff = shistuff.replaceAll(/^@+[ 　]+/gm, "");
                        shistuff = shistuff.replaceAll(/@+/gi, "");
                    }
                }
                //Try to Detect/Fix Errors
                let temporigstuff = origstuff;
                if (origstuff.match(/\\n\[\d+\]/gim) != null && shistuff.match(/(?<=[^a-z]|^)(she|her|hers|herself|he|him|his|himself)(?=[^a-z]|$)/gmi) != null) {
                    temporigstuff = temporigstuff.replaceAll(/\\n\[\d+\]/gim, "");
                }
                if (shistuff.match(/\\[\w_]+\[[^\]]+?\]/gi) == null) {
                    if (temporigstuff.match(/\\[\w_]+\[[^\]]+?\]/gi) != null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.MISSINGCOMMAND　");
                    }
                }
                if (shistuff.match(/\[[^\]]+?\]/gi) == null) {
                    if (temporigstuff.match(/[\w_]+\[[^\]]+?\]/gi) != null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.MISSINGCOMMAND.B　");
                    }
                }
                if (shistuff.match(/\\[\w_]+\[[^\]]+?\]/gi) != null) {
                    if (origstuff.match(/\\[\w_]+\[[^\]]+?\]/gi) == null) {
                        slrAddErr(file, k, shistuff.replaceAll(/\\[\w_]+\[[^\]]+?\]/gi, "　SHISAYE.ADDITIONALCOMMAND　"));
                    }
                }
                if (shistuff.match(/%[\d]/g) != null) {
                    if (origstuff.match(/%[\d]/g) == null) {
                        slrAddErr(file, k, shistuff.replaceAll(/%([\d])/gi, "　SHISAYE.LOSTPLACEHOLDERMVMZ　"));
                    }
                }
                if (shistuff.match(/(?<!\d)%.[\d]/g) != null) {
                    if (origstuff.match(/%[\s\S][\d]/g) == null) {
                        if (origstuff.match(/\d%/g) == null) {
                            slrAddErr(file, k, shistuff.replaceAll(/%.([\d])/gi, "　SHISAYE.PLACEHOLDERGAPMVMZ　"));
                        }
                    }
                }
                if (origstuff.match(/\\\\[\w]/g) == null) {
                    if (shistuff.match(/\\\\[\w]/gi) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/\\[\\]+[\w]/gi, "　SHISAYE.ESCAPEDBACKSLASH　"));
                    }
                }
                if (shistuff.match(/\\\(/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\\(/g, "　SHISAYE.LOSTBACKSLASH2　"));
                }
                if (shistuff.match(/\\C\[(?!\d)/gi) != null && origstuff.match(/\\C\[(?!\d)/gi) == null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\C\[(?!\d)/gi, "　SHISAYE.BROKENCOLOR　"));
                }
                if (shistuff.match(/\\V[^\[\w\n<]\(/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\V[^\[\w\n<]\(/g, "　SHISAYE.BROKENVARIABLE1　"));
                }
                if (shistuff.match(/\\v[^\[\w\n<]\(/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\v[^\[\w\n<]\(/g, "　SHISAYE.BROKENVARIABLE2　"));
                }
                if (shistuff.match(/\\[N][^\[\w\n<]\[/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[N][^\[\w\n<]\[/g, "　SHISAYE.BROKENNAME1　"));
                }
                if (shistuff.match(/\\[n][^\[\w\n<]\[/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[n][^\[\w\n<]\[/g, "　SHISAYE.BROKENNAME2　"));
                }
                if (shistuff.match(/\\[N][^\[\w\n<]</g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[N][^\[\w\n<]</g, "　SHISAYE.BROKENNAME3　"));
                }
                if (shistuff.match(/\\[n][^\[\w\n<]</g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[n][^\[\w\n<]</g, "　SHISAYE.BROKENNAME4　"));
                }
                if (shistuff.match(/\\[n][w][^\[\w\n<]\[/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[n][w][^\[\w\n<]\[/g, "　SHISAYE.BROKENNAME5　"));
                }
                if (shistuff.match(/\\[N][W][^\[\w\n<]\[/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[N][W][^\[\w\n<]\[/g, "　SHISAYE.BROKENNAME6　"));
                }
                if (shistuff.match(/\\[n][w][^\[\w\n<]</g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[n][w][^\[\w\n<]</g, "　SHISAYE.BROKENNAME7　"));
                }
                if (shistuff.match(/\\[N][W][^\[\w\n<]</g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[N][W][^\[\w\n<]</g, "　SHISAYE.BROKENNAME8　"));
                }
                if (shistuff.match(/\\name[^\[\w\n<]\[/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\name[^\[\w\n<]\[/g, "　SHISAYE.BROKENNAME9　"));
                }
                if (shistuff.match(/\\\(/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\\(/g, "　SHISAYE.LOSTBACKSLASH10　"));
                }
                if (shistuff.match(/\\B[^\[\w]/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\B[^\[\w]/g, "　SHISAYE.MISSINGVARIABLEB1　"));
                }
                if (shistuff.match(/\\B$/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\B$/gi, "　SHISAYE.MISSINGVARIABLEB2　"));
                }
                if (shistuff.match(/\\B\d+/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\B(\d+)/gi, "　SHISAYE.MISSINGVARIABLEB3　"));
                }
                if (shistuff.match(/\\b[^\[\w]/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\b[^\[\w]/g, "　SHISAYE.MISSINGVARIABLE.B1　"));
                }
                if (shistuff.match(/\\b$/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\b$/gi, "　SHISAYE.MISSINGVARIABLE.B2　"));
                }
                if (shistuff.match(/\\b\d+/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\b(\d+)/gi, "　SHISAYE.MISSINGVARIABLE.B3　"));
                }
                if (shistuff.match(/(?<![\\])\\(?=$|[ 　\n\r])/gm) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/(?<![\\])\\(?=$|[ 　\n\r])/gm, "　SHISAYE.LOSTBACKSLASH1　"));
                }
                if (shistuff.match(/(?<=[\\])\\(?=$|[\\ 　\n\r])/gm) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/(?<=[\\])\\(?=$|[\\ 　\n\r])/gm, "　SHISAYE.LOSTBACKSLASH2　"));
                }
                if (shistuff.match(/\\「/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\「/g, "　SHISAYE.LOSTBACKSLASH4　"));
                }
                if (shistuff.match(/\\\"/g) != null && origstuff.match(/\\\"/g) == null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\\"/g, "　SHISAYE.LOSTBACKSLASH5　"));
                }
                if (shistuff.match(/\\\'/g) != null && origstuff.match(/\\\'/g) == null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\\'/g, "　SHISAYE.LOSTBACKSLASH5　"));
                }
                if (origstuff.match(/\\\$/gm) == null) {
                    if (shistuff.match(/\\\$/gm) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/\\\$/gm, "　SHISAYE.BROKENDOLLAR　"));
                    }
                }
                if (shistuff.match(/\\n\\ /g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\n\\ /g, "　SHISAYE.LOSTBACKSLASH7　"));
                }
                if (shistuff.match(/\\」/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\」/g, "　SHISAYE.LOSTBACKSLASH8　"));
                }
                if (shistuff.match(/(?<=^)[^\[]+\*\]/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/(?<=^)[^\[]+\*\]/g, "　SHISAYE.LOSTSTAR1　"));
                }
                if (origstuff.match(/\\[a-z][-|']/gi) == null) {
                    if (shistuff.match(/\\[a-z][-|']/gi) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/\\[a-z][-|']/gi, "　SHISAYE.BROKENCOMMAND　"));
                    }
                }
                if (shistuff.match(/\\\*/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\\*/g, "　SHISAYE.LOSTBACKSLASH9.STAR　"));
                }
                if (shistuff.match(/\\　SHISAYE/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\　SHISAYE/g, "　SHISAYE.LOSTBACKSLASH10　"));
                }
                if (shistuff.match(/(\d+)\.\]/g) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/(\d+)\.\]/g, "　SHISAYE.WRONGBRACKET2.DOT　"));
                }
                if (shistuff.match(/(?<=^)[^\[]+\.\]/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/(?<=^)[^\[]+\.\]/gi, "　SHISAYE.WRONGBRACKET1.DOT　"));
                }
                if (shistuff.match(/(?<=^)[^\[]+」\]/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/(?<=^)[^\[]+」\]/gi, "　SHISAYE.WRONGBRACKET3　"));
                }
                if (shistuff.match(/(?<=^)([^\[]+)\]」/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/(?<=^)([^\[]+)\]」/gi, "　SHISAYE.WRONGBRACKET4　"));
                }
                if (shistuff.match(/\\[\w]+[^\[\w\n<]\[/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\[\w]+[^\[\w\n<]\[/gi, "　SHISAYE.COMMANDGAP　"));
                }
                if (shistuff.match(/Let me translate those Japanese phrases to English for you:.*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ]+.*? - .*?\w+.*?/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/Let me translate those Japanese phrases to English for you:/gi, "　SHISAYE.WRONGAIRESPONSE　"));
                }
                if (trans.project.files[file].tags[k] == "green" || trans.project.files[file].tags[k] == "pink,green") {
                    if (origstuff.match(/^".*?"$/gim) != null) {
                        if (shistuff.match(/".*?"/gim) == null) {
                            slrAddErr(file, k, "　SHISAYE.MISSINGQUOTES　");
                        } else if (shistuff.match(/".*?".*?"/gim) != null && origstuff.match(/".*?".*?"/gim) == null) {
                            slrAddErr(file, k, "　SHISAYE.3INNERQUOTES　");
                        } else if (shistuff.match(/".*?".*?".*?"/gim) == null && origstuff.match(/".*?".*?".*?"/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.3INNERQUOTES　");
                        } else if (shistuff.match(/".*?".*?".*?".*?".*?"/gim) == null && origstuff.match(/".*?".*?".*?".*?".*?"/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.5INNERQUOTES　");
                        } else if (shistuff.match(/".*?".*?".*?".*?".*?".*?".*?"/gim) == null && origstuff.match(/".*?".*?".*?".*?".*?".*?".*?"/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.7INNERQUOTE　");
                        } else if (shistuff.match(/".*?".*?".*?".*?".*?".*?".*?".*?".*?"/gim) == null && origstuff.match(/".*?".*?".*?".*?".*?".*?".*?".*?".*?"/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.9INNERQUOTE　");
                        }
                    }
                }
                if (trans.project.files[file].tags[k] == "green" || trans.project.files[file].tags[k] == "pink,green") {
                    if (origstuff.match(/^'.*?'$/gim) != null) {
                        if (shistuff.match(/'.*?'/gim) == null) {
                            slrAddErr(file, k, "　SHISAYE.MISSINGQUOTES2　");
                        } else if (shistuff.match(/'.*?'.*?'/gim) != null && origstuff.match(/'.*?'.*?'/gim) == null) {
                            slrAddErr(file, k, "　SHISAYE.3INNERQUOTES2　");
                        } else if (shistuff.match(/'.*?'.*?'.*?'/gim) == null && origstuff.match(/'.*?'.*?'.*?'/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.3INNERQUOTES2　");
                        } else if (shistuff.match(/'.*?'.*?'.*?'.*?'.*?'/gim) == null && origstuff.match(/'.*?'.*?'.*?'.*?'.*?'/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.5INNERQUOTES2　");
                        } else if (shistuff.match(/'.*?'.*?'.*?'.*?'.*?'.*?'.*?'/gim) == null && origstuff.match(/'.*?'.*?'.*?'.*?'.*?'.*?'.*?'/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.7INNERQUOTE2　");
                        } else if (shistuff.match(/'.*?'.*?'.*?'.*?'.*?'.*?'.*?'.*?'.*?'/gim) == null && origstuff.match(/'.*?'.*?'.*?'.*?'.*?'.*?'.*?'.*?'.*?'/gim) != null) {
                            slrAddErr(file, k, "　SHISAYE.9INNERQUOTE2　");
                        }
                    }
                }
                if (temporigstuff.match(/\\[\w]+\[[^\]\r\n]*?\]/gim) != null) {
                    if (shistuff.match(/\\[\w]+\[[^\]\r\n]*?\]/gi) == null) {
                        slrAddErr(file, k, shistuff.replaceAll(/\\[\w]+\[[^\]\r\n]*/gi, "　SHISAYE.MISSINGBRACKET　"));
                    }
                }
                if (origstuff.match(/\\[\w]+<.*?>/gim) != null) {
                    if (shistuff.match(/\\[\w]+<.*?>/gi) == null) {
                        slrAddErr(file, k, shistuff.replaceAll(/\\[\w]+<.*/gi, "　SHISAYE.MISSINGBOUNDARY　"));
                    }
                }
                if (origstuff.match(/\\[\w?,\.]+(?=[^\[<\w?,\.]|$|[ 　])/gim) == null) {
                    if (shistuff.match(/\\[\w?,\.]+(?=[^\[<\w?,\.]|$|[ 　])/gi) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/\\[\w?,\.]+(?=[^\[<\w?,\.]|$|[ 　])/gi, "　SHISAYE.WRONGCOMMAND　"));
                    }
                }
                if (temporigstuff.match(/\\[\w?,\.]+(?=[^\[<\w?,\.]|$|[ 　])/gim) != null) {
                    if (shistuff.match(/\\[\w?,\.]+(?=[^\[<\w?,\.]|$|[ 　])/gi) == null) {
                        slrAddErr(file, k, origstuff.replaceAll(/\\[\w?,\.]+(?=[^\[<\w?,\.]|$|[ 　])/gi, "　SHISAYE.MISSINGCOMMAND.B　"));
                    }
                }
                if (window.transConfig.englishtarget == true) {
                    if (shistuff.match(/(?<!\\VS|\\NA|\\nw|\\n|\\name|\\[w])\[[^\]\r\n]*?一-龠ぁ-ゔァ-ヴー々〆〤ヶ.*?\]/gim) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/(?<!\\VS|\\NA|\\nw|\\n|\\name|\\[w])\[[^\]\r\n]*?一-龠ぁ-ゔァ-ヴー々〆〤ヶ.*?\]/gim, "　SHISAYE.UNKNOWNCOMMAND1　"));
                    }
                    if (shistuff.match(/(?<!\\nw|\\n|\\name|\\[w])<.*?一-龠ぁ-ゔァ-ヴー々〆〤ヶ.*?>/gi) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/(?<!\\nw|\\n|\\name|\\[w])<.*?一-龠ぁ-ゔァ-ヴー々〆〤ヶ.*?>/gi, "　SHISAYE.UNKNOWNCOMMAND2　"));
                    }
                }
                if (shistuff.match(/\\+\[\d+\]/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\\+\[\d+\]/gi, "　SHISAYE.UNKNOWNCOMMAND3　"));
                } else if (shistuff.match(/\/[civn]w?\[[^\]\r\n]?\]/gi) != null) {
                    slrAddErr(file, k, shistuff.replaceAll(/\/[civn]w?\[[^\]\r\n]?\]/gi, "　SHISAYE.UNKNOWNCOMMAND4　"));
                }
                //if (trans.project.files[file].tags[k] == "green" || trans.project.files[file].tags[k] == "pink,green" || trans.project.files[file].tags[k] == "purple,pink,green" || trans.project.files[file].tags[k] == "red" || trans.project.files[file].tags[k] == "blue" || trans.project.files[file].tags[k] == "purple,blue" || trans.project.files[file].tags[k] == "yellow" || trans.project.files[file].tags[k] == "purple,yellow") {
                if (origstuff.match(/^LL_GalgeChoiceWindowMV ?setChoices ?/gm) != null) {
                    if (origstuff.match(/,/gim) != null) {
                        let origcomma = (origstuff.match(/,/g) || []).length;
                        let shicomma = (shistuff.match(/,/g) || []).length;
                        if (shicomma > origcomma) {
                            slrAddErr(file, k, origstuff + "　SHISAYE.TOOMANYCOMMAS　");
                        } else if (shicomma < origcomma) {
                            slrAddErr(file, k, origstuff + "　SHISAYE.TOOFEWCOMMAS　");
                        }
                    }
                }
                if (trans.project.files[file].tags[k] == "green" || trans.project.files[file].tags[k] == "pink,green") {
                    if (shistuff.match(/I'm sorry. I'm sorry./g) != null) {
                        slrAddErr(file, k, shistuff.replaceAll(/I'm sorry. I'm sorry./g, "　SHISAYE.POTENTIALESCAPERCRASH　"));
                    }
                }
                //Return Values
                shistuff = shistuff.replaceAll("SHISAYEPLACEHOLDER01", "%s");
                shistuff = shistuff.replaceAll("SHISAYEPLACEHOLDER02", "%d");

                if (origstuff.match(/[%@#][\w].*[%@#][\w].*[%@#][\w].*[%@#][\w].*[%@#][\w]/g) != null) {
                    if (shistuff.match(/[%@#][\w].*[%@#][\w].*[%@#][\w].*[%@#][\w].*[%@#][\w]/g) == null && shistuff.match(/[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w].*\d[%@#] [\w]/g) == null && shistuff.match(/[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w].*\d[%@#] [\w].*[%@#] ?[\w]/g) == null && shistuff.match(/[%@#] ?[\w].*[%@#] ?[\w].*\d[%@#] [\w].*[%@#] ?[\w].*[%@#] ?[\w]/g) == null && shistuff.match(/[%@#] ?[\w].*\d[%@#] [\w].*[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w]/g) == null && shistuff.match(/\d[%@#] [\w].*[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w]/g) == null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.MISSINGPLACEHOLDER5　");
                    }
                }
                if (origstuff.match(/[%@#][\w].*[%@#][\w].*[%@#][\w].*[%@#][\w]/g) != null) {
                    if (shistuff.match(/[%@#][\w].*[%@#][\w].*[%@#][\w].*[%@#][\w]/g) == null && shistuff.match(/[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w].*\d[%@#] [\w]/g) == null && shistuff.match(/[%@#] ?[\w].*[%@#] ?[\w].*\d[%@#] [\w].*[%@#] ?[\w]/g) == null && shistuff.match(/[%@#] ?[\w].*\d[%@#] [\w].*[%@#] ?[\w].*[%@#] ?[\w]/g) == null && shistuff.match(/\d[%@#] [\w].*[%@#] ?[\w].*[%@#] ?[\w].*[%@#] ?[\w]/g) == null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.MISSINGPLACEHOLDER4　");
                    }
                }
                if (origstuff.match(/[%@#][\w].*[%@#][\w].*[%@#][\w]/g) != null) {
                    if (shistuff.match(/[%@#][\w].*[%@#][\w].*[%@#][\w]/g) == null && shistuff.match(/[%@#][\w].*[%@#][\w].*\d[%@#] [\w]/g) == null && shistuff.match(/[%@#][\w].*\d[%@#] [\w].*[%@#] ?[\w]/g) == null && shistuff.match(/\d[%@#] [\w].*[%@#] ?[\w].*[%@#] ?[\w]/g) == null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.MISSINGPLACEHOLDER3　");
                    }
                }
                if (origstuff.match(/[%@#][\w].*?[%@#][\w]/g) != null) {
                    if (shistuff.match(/[%@#][\w].*?[%@#][\w]/g) == null && shistuff.match(/[%@#] ?[\w].*?\d[%@#] [\w]/g) == null && shistuff.match(/\d[%@#] [\w].*?[%@#] ?[\w]/g) == null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.MISSINGPLACEHOLDER2　");
                    }
                }
                if (origstuff.match(/[%@#][\w]/g) != null) {
                    if (shistuff.match(/[%@#][\w]/g) == null && shistuff.match(/\d[%@#] [\w]/g) == null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.MISSINGPLACEHOLDER1　");
                    }
                }
                if (origstuff.match(/%d.*%s/gi) == null) {
                    if (shistuff.match(/%d.*%s/gi) != null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.S.NEEDSTOBEBEFORE.D　");
                    }
                }
                if (origstuff.match(/%s.*%d/gi) == null) {
                    if (shistuff.match(/%s.*%d/gi) != null) {
                        slrAddErr(file, k, origstuff + "　SHISAYE.D.NEEDSTOBEBEFORE.S　");
                    }
                }

                /* //For Debugging, not good enough for general use
                if (shistuff.match(/(?<=[^\[\(\{\<])[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ](?=[^\]\)\}\>])/gi) != null) {
                if (shistuff.match(/[ー]/gi) == null && shistuff.match(/^選択肢ヘルプ/gim) == null) {
                slrAddErr(file, k, shistuff.replaceAll(/(?<=[^\[\(\{\<])[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ](?=[^\]\)\}\>])/gi, "　SHISAYE.LEFTOVERJAPANESE　"));
                }
                } */
                
                //Run something on normal dialogue
                //if (trans.project.files[file].tags[k] != "red" && trans.project.files[file].tags[k] != "green" && trans.project.files[file].tags[k] != "yellow" && trans.project.files[file].tags[k] != "darkred" && trans.project.files[file].tags[k] != "gold" && trans.project.files[file].tags[k] != "blue" && trans.project.files[file].tags[k] != "aqua" && trans.project.files[file].tags[k] != "purple,green" && trans.project.files[file].tags[k] != "purple,green,pink" && trans.project.files[file].tags[k] != "purple,yellow" && trans.project.files[file].tags[k] != "purple,blue") {
                //shistuff = shistuff.replaceAll(/\n\s*\n/g, "\n");
                //}
                
                trans.project.files[file].data[k][slrFixDest] = shistuff
        } while (false);
    }
    Onallmassreplacer3() {
        let files = trans.getAllFiles();
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            for (let k = 0; k < trans.project.files[file].data.length; k++) {
                this.Onallmassreplacer3Row(file, k);
            }
        }
    }
    ReplacerGameTitle(file, index) {
        //Add tool version number to game name so it's easier to keep track if someone shares stuff made with this
        let titlecelltext1 = trans.project.files[file].data[index][1];
        let titlecelltext2 = trans.project.files[file].data[index][2];
        if (titlecelltext1 != null || titlecelltext1 != undefined) {
            trans.project.files[file].data[index][1] = trans.project.files[file].data[index][1].replaceAll(/(.*) - Modified with SLR Translator v[\d]\.[\d]?[\d]?[\d][a-zA-Z]?(.*)/g, "$1$2");
        }
        if (titlecelltext2 != null && titlecelltext2 != undefined) {
            trans.project.files[file].data[index][2] = trans.project.files[file].data[index][2].replaceAll(/(.*) - Modified with SLR Translator v[\d]\.[\d]?[\d]?[\d][a-zA-Z]?(.*)/g, "$1$2");
        }
        var win = nw.Window.get();
        nw.appSuffix = nw.appSuffix || "";
        var suffix = "";
        if (nw.appSuffix) {
            suffix = " " + nw.appSuffix;
        }
        let slrversion = nw.App.manifest.version + suffix;
        let cellttext = trans.project.files[file].data[index][1];
        let cellttext2 = trans.project.files[file].data[index][2];
        let origcelltext = trans.project.files[file].data[index][0];
        let joinedcellttext = cellttext + " - Modified with SLR Translator v" + slrversion;
        let joinedcellttext2 = cellttext2 + " - Modified with SLR Translator v" + slrversion;
        let origjoinedcellttext = origcelltext + " - Modified with SLR Translator v" + slrversion;

        if (trans.project.files[file].data[index][2] != undefined && trans.project.files[file].data[index][2] != null && trans.project.files[file].data[index][2] != "") {
            trans.project.files[file].data[index][2] = joinedcellttext2;
            trans.project.files[file].data[index][2] = trans.project.files[file].data[index][2].replaceAll(/(.*)( by Shisaye)(.*)/g, "$1$3$2");
        } else if (trans.project.files[file].data[index][1] != undefined && trans.project.files[file].data[index][1] != null && trans.project.files[file].data[index][1] != "") {
            trans.project.files[file].data[index][1] = joinedcellttext;
            trans.project.files[file].data[index][1] = trans.project.files[file].data[index][1].replaceAll(/(.*)( by Shisaye)(.*)/g, "$1$3$2");
        } else if (trans.project.files[file].data[index][0] != undefined && trans.project.files[file].data[index][0] != null && trans.project.files[file].data[index][0] != "") {
            trans.project.files[file].data[index][1] = origjoinedcellttext;
        }
    }
}
trans.batchCheckCells = new PostBatch();


//You can activate this extra button by uncommenting its code in the button section.
class debugBatch {
    debugCells() {
        this.Onalldebugscript();
        this.CellFixCommonevents(trans.travelContext(trans.getAllFiles(), "commonevents"));
    }
    Onalldebugscript() {
        let files = trans.getAllFiles();
        for (let i = 0; i < files.length; i++) {
            let file = files[i];
            let data = trans.project.files[file].data;
            let contexts = trans.project.files[file].context;
            for (let k = 0; k < data.length; k++) {
                let row = data[k];
                let context = contexts[k];
                // Skip empty / untranslated lines
                if (context == undefined || row == undefined || context.length == 0 || row[1] == undefined || row[1] == "")
                    continue;
                //make context checkable
                let contextasstring = context.toString();
                
                //trans.project.files[file].data[k][1] = trans.project.files[file].data[k][1].replaceAll(/ /g, " ");
                
            }
        }
    }

    CellFixCommonevents(collection) {
        for (let file in collection) {
            let rows = collection[file];
            for (let index = 0; index < rows.length; index++) {
                if (rows[index] === true) {
                    this.debugReplacerCommonevents(file, index);
                }
            }
        }
    }

    debugReplacerCommonevents(file, index) {
        let text = trans.project.files[file].data[index][slrFixDest];
        if (text != null && text != undefined) {
            
            //trans.project.files[file].data[index][1] = trans.project.files[file].data[index][1].replaceAll(/ /g, " ");
            
        }
    }

}
trans.debugScript = new debugBatch();
