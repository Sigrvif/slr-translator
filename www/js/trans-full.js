// SLR Translator - Translation Engine Core
// Independent reimplementation
// Part of SLR Translator (GPLv3)

window.fs         = require('graceful-fs');
window.afs         = require('await-fs');
window.nwPath     = require('path');
window.spawn     = require('child_process').spawn;
window.debounce = require("debounce");

window.insertArrayAt = function(array, index, arrayToInsert) {
    Array.prototype.splice.apply(array, [index, 0].concat(arrayToInsert));
    return array;
}

global.common ||= {}

common.arrayExchange = function(arr, fromIndex, toIndex) {

    var element = arr[fromIndex];
    arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, element);
}

common.arrayExchangeBatch = function(input, fromIndex, toIndex) {

    if (Array.isArray(fromIndex) == false) {
        common.arrayExchange(input, fromIndex, toIndex);
    }
    for (var i=fromIndex.length-1; i>=0; i--) {
        common.arrayExchange(input, fromIndex[i], toIndex);
    }
    return input;
}

common.arrayMove = function(array, fromIndex, to) {

    if(Array.isArray(array) == false) return array;
    if( to === fromIndex ) return array;

    var target = array[fromIndex];
    var increment = to < fromIndex ? -1 : 1;

    for(var k = fromIndex; k != to; k += increment){
    array[k] = array[k + increment];
    }
    array[to] = target;
    return array;
}

common.arrayMoveBatch = function(array, fromIndex, to) {
    if (Array.isArray(fromIndex) == false) {
        return common.arrayMove(array, fromIndex, to);
    }

    var n=0;
    for (var i=fromIndex.length-1; i>=0; i--) {
        array = common.arrayMove(array, fromIndex[i]+n, to);
        n++;
    }
    return array;
}

common.escapeSelector = function(string) {
    string = string||"";
    if (typeof string !== 'string') return false;

    return ('"'+CSS.escape(string)+'"')
}

common.arrayInsert =function(thisArray, index, item ) {
    thisArray.splice( index, 0, item );
    return thisArray;
};

common.batchArrayInsert = function(thisArray, index, item ) {
    for (var i=0; i<thisArray.length; i++) {
        this.arrayInsert(thisArray[i], index, item);
    }
    return thisArray;
};

var FileLoader = function() {
    this.handler = {};
}

FileLoader.prototype.add = function(extension, handler) {

    this.handler[extension] = handler;
}
FileLoader.prototype.open = function(extension, handler) {

}

window.FileLoader = FileLoader;

class Trans extends require('www/js/BasicEventHandler.js') {
    constructor() {
        super($(document));
        this.init();
    }
}

Trans.maxCols = 15;

Trans.CellInfo = function() {

}
Trans.CellInfo.prototype.getAll = function(file) {
    if (!file) return;
    if (!trans?.project?.files?.[file]) return;
    var obj = trans.getObjectById(file);
    if (!obj.cellInfo) obj.cellInfo = [];
    return obj.cellInfo;
}

Trans.CellInfo.prototype.getRow = function(file, row) {
    var cellInf = this.getAll(file);
    if (!cellInf) return;
    return cellInf[row];
}

Trans.CellInfo.prototype.getCell = function(file, row, col) {
    var rowInf = this.getRow(file, row);
    if (!rowInf) return;
    return rowInf[col];
}

Trans.CellInfo.prototype.getBestCellInfo = function(file, row, key) {
    var data     = trans.getData(file);
    var col     = trans.getTranslationColFromRow(data[row]);
    var cellInfo = this.getCell(file, row, col);
    if (!cellInfo) return cellInfo;
    if (key) return cellInfo[key];
    return cellInfo;
}

Trans.CellInfo.prototype.get = function(key, file, row, col) {
    var cellInf = this.getCell(file, row, col);
    if (!cellInf) return;
    return cellInf[key];
}

Trans.CellInfo.prototype.set = function(key, value, file, row, col) {

    var cellInf = this.getAll(file);
    cellInf[row] =  cellInf[row] || [];
    cellInf[row][col] = cellInf[row][col] || {};
    cellInf[row][col][key] = value;
    return true;
}

Trans.CellInfo.prototype.delete = function(key, file, row, col) {

    var cellInf = this.getAll(file);
    cellInf[row] =  cellInf[row] || [];
    cellInf[row][col] = cellInf[row][col] || {};
    delete cellInf[row][col][key]
    return true;
}

Trans.CellInfo.prototype.deleteRow = function(file, row) {
    var cellInf = this.getAll(file)
    if (empty(cellInf)) return;
    if (Array.isArray(cellInf)) {
        cellInf.splice(row, 1);
    } else {
        delete cellInf[row];
    }
}

Trans.CellInfo.prototype.deleteCell = function(file, rowId, cellId) {
    var thisRow = this.getRow(file, rowId);
    if (!Array.isArray(thisRow)) return;
    thisRow.splice(cellId, 1);
    return true;
}

Trans.CellInfo.prototype.moveCell = function(file, rowId, from, to) {
    var thisRow = this.getRow(file, rowId);
    if (!Array.isArray(thisRow)) return;
    common.arrayMoveBatch(thisRow, from, to);
    return true;
}

Trans.prototype.init = function() {
    this.config ={
        loadRomaji        :true,
        maxRequestLength:3000,
        autoSaveEvery    :600,
        batchDelay        :5000,
        rpgTransFormat    :true,
        autoTranslate    :false
    },

    this.keyColumn             = 0;
    this.isFreeEditing        = false;
    this.gameTitle            =""
    this.gameEngine            =""
    this.projectId            =""
    this.indexIds            ={}
    this.fileListLoaded        =false
    this.isLoadingFileList    =false
    this.unsavedChange        =false

    this.gameFolder            = ''
    this.currentFile        = ''
    this.skipElement        =['note', 'Comment', 'Script']

    this.project            =undefined
    this.timers                ={}
    this.engines                ={}

    this.data                 =[];
    this.colHeaders            =['Original Text'+' [0]', 'Initial Translations'+' [1]', 'Translation Corrections'+' [2]', 'Wrapped translations'+' [3]', 'Errors'+' [4]', 'Overwrite'+' [5]'];

    this.onFileNavLoaded    = function() {}
    this.onFileNavUnloaded    = function() {}

    this.validateKey = function(value, callback) {

        if (value=='' || value==null) {
            callback(false);
        } else {
            callback(true);
        }
    }

    this.columns = [{
            readOnly: false,
            validator: this.validateKey,
            width: 380,

        },
        {
            readOnly: false,
            width: 380,

        },
        {
            readOnly: false,
            width: 140,

        },
        {
            readOnly: false,
            width: 240,

        },
    {
        readOnly: false,
        width: 380,

    },
    {
        readOnly: false,
        width: 90,

    }
    ];

    this.default = {};
    this.default.columns = [{
            readOnly: false,
            validator: this.validateKey,
            width: 380,

        },
        {
            readOnly: false,
            width: 380,

        },
        {
            readOnly: false,
            width: 140,

        },
        {
            readOnly: false,
            width: 240,

        },
    {
        readOnly: false,
        width: 380,

    },
    {
        readOnly: false,
        width: 90,

    }

    ]

    this.inProject = false;
    this.default.colHeaders    =['Original Text'+' [0]', 'Initial Translations'+' [1]', 'Translation Corrections'+' [2]', 'Wrapped Translations'+' [3]', 'Errors'+' [4]', 'Overwrite'+' [5]'];
}

Trans.prototype.getOption = function(key) {
    if (!trans.project) return;
    trans.project.options ||= {};

    if (typeof trans.project.options.gridInfo == "undefined") {
        trans.project.options.gridInfo = {
            isRuleActive    : true,
            enableTrail        : true,
            viewTrail        : false,
            viewOrganicCellMarker:true,
            rowHeaderInfo    : false
        }
    }

    return trans.project.options[key];
}

Trans.prototype.setOption = function(key, value) {
    if (!trans.project) return;
    trans.project.options ||= {};
    trans.project.options[key] = value;
}

Trans.prototype.getConfig = function(key) {
    trans.project.config = trans.project.config || {};
    if (typeof key == "string") return trans.project.config[key];
    if (Array.isArray(key)) {
        var result = trans.project.config;
        try {
            for (var i=0; i<key.length; i++) {
                result = result[key[i]];
            }
            return result;
        } catch (e) {
            return;
        }
    }
    return;
}

Trans.prototype.setConfig = function(key, value) {
    trans.project.config = trans.project.config || {};
    if (typeof key == "string") {
        trans.project.config[key] = value;
        return true;
    }

    if (Array.isArray(key)) {
        var result = trans.project.config;
        try {
            for (var i=0; i<key.length-1; i++) {
                result[key[i]] = result[key[i]] || {};
                result = result[key[i]];
            }
            result[key[i]] = value;
            return true;
        } catch (e) {
            return;
        }
    }
    return;
}

Trans.prototype.isInProject = function() {
    return this.inProject;
}

Trans.prototype.getTemplatePath = function() {
    var templatePath = sys.config.templatePath||nw.App.manifest.localConfig.defaultTemplate

    fs = fs||require('fs')
    try {
        if (fs.existsSync(templatePath)) {
            return templatePath;
        }
    } catch (err) {
        return nwPath.join(__dirname, templatePath);
    }
}

Trans.prototype.isFileSupported = function(pathName) {
    if (typeof pathName !== 'string') return false;
    var ext = common.getFileExtension(pathName);
    if (sys.supportedExtension.includes(ext)) return true;
    return false;
}

Trans.prototype.openFile = function(file) {
    const spawn = require("child_process").spawn;
    if(this.isFileSupported(file) == false) return false;
    var ext = common.getFileExtension(file);
    if (typeof (this.fileLoader.handler[ext]) !== 'function') return false;
    if (this.fileListLoaded == false) {

        ui.introWindowClose();
        this.fileLoader.handler[ext].apply(this, [file]);
    } else {

        spawn(nw.process.execPath, [file], {
                detached :true
            });
    }
}

Trans.prototype.initProject = function() {
    if (typeof this.project !== 'undefined') {

        return false
    }

}

Trans.prototype.closeProject = function() {
    if (typeof this.project == 'undefined') {
        return false
    }
    if (typeof this.grid.destroy() == 'function') this.grid.destroy();
    this.unInitFileNav();
    this.project = {};
    this.init();
    ui.closeAllChildWindow();
    ui.ribbonMenu.clear();
    ui.clearActiveCellInfo();
    ui.clearPathInfo();
    ui.setWindowTitle("");
    trans.clearFooter();
    this.initTable();
    this.gridIsModified(false);
}

Trans.prototype.createProject = async function(options) {

    if (this.isLoadingFileList) return false;
    if (this.gameFolder == "") return false;

    var trans                 = this;
    options                 = options||{};
    options.force             = options.force||"";
    options.selectedFile     = options.selectedFile||"";
    options.onAfterLoading     = options.onAfterLoading||function(responseData, event) {};
    options.options         = options.options||{};

    // Engines that implement their own `createProject` handler (e.g. addons
    // adding support for non-RPG-Maker games) build the project entirely in
    // JavaScript; the PHP backend below only serves the built-in engines.
    var engineName = this.gameEngine || "";
    if (!engineName) {
        try { engineName = await Engines.detect(this.gameFolder); } catch (e) {}
    }
    if (engineName && engines.hasEngine(engineName) && typeof engines[engineName].createProject == "function") {
        return this.createProjectFromEngine(engineName, options);
    }

    this.isLoadingFileList     = true;

    ui.showLoading();

    var thisArgs = {
            gameFolder        :this.gameFolder,
            selectedFile    :options.selectedFile,
            gameEngine        :this.gameEngine,
            gameTitle        :this.gameTitle,
            projectId        :this.projectId,
            skipElement        :this.skipElement,
            indexOriginal    :0,
            indexTranslation:1,
            force            :options.force,
            rpgTransFormat    :trans.config.rpgTransFormat,
            options            :options.options
        }

    php.spawn("loadGameInfo.php", {
        args:thisArgs,
        onData: function(buffer) {
            ui.loadingProgress("Loading", buffer, {consoleOnly:true, mode:'consoleOutput'});
        },
        onError:function(buffer) {
            ui.loadingProgress("Loading", buffer, {consoleOnly:true, mode:'consoleOutput', classStr:'stderr'});
        },

        onDone : function(data) {

            if (common.isJSON(data)) {
                trans.project = data;
                trans.currentFile = "";

                trans.gameTitle     = data.gameTitle;
                trans.gameFolder     = data.loc;
                trans.projectId     = data.projectId;
                trans.gameEngine     = data.gameEngine;
                trans.editorName    = "SLR Translator";
                trans.editorVersion = nw.App.manifest.version;
                trans.generateHeader();
                trans.sanitize();

                trans.dataPadding();
                sys.updateLastOpenedProject();
                trans.autoSave();

                ui.setStatusBar(1, trans.gameTitle);

                trans.trigger("projectCreated", trans, data);
                if (typeof options.onAfterLoading == 'function') {
                    options.onAfterLoading.call(trans, data, this);
                }
                trans.fileListLoaded = true;
                trans.isLoadingFileList = false;
                ui.showCloseButton();
            } else {

                var loadedData = $("<div>"+data+"</div>");
                var initPath = loadedData.find("#initialDataPath").attr("data-path");

                if (Boolean(initPath) == false) {
                    ui.loadingProgress("Error!", "Can not successfully parse your game!",
                    {consoleOnly:true, mode:'consoleOutput'});
                    ui.showCloseButton();
                    trans.fileListLoaded = false;
                    trans.isLoadingFileList = false;
                    return;
                }

                try {
                    fs.readFile(initPath, function (err, rawData) {
                        if (err) {

                            ui.loadingProgress("Error!", "Error opening file : "+initPath,
                                {consoleOnly:true, mode:'consoleOutput'});
                            ui.showCloseButton();
                            trans.fileListLoaded = false;
                            trans.isLoadingFileList = false;
                            throw err;
                        } else {
                            var strData = rawData.toString();
                            var data = {};
                            try {
                                data = JSON.parse(strData);
                            } catch (err) {
                                ui.loadingProgress("Error!", "Error processing init file : "+initPath+"\n"+err,
                                    {consoleOnly:true, mode:'consoleOutput'});
                                ui.showCloseButton();
                                trans.isLoadingFileList = false;
                                return false;
                            }

                            if (Boolean(data['files']) == false) {
                                ui.loadingProgress("Error!", "Error! File list not found in init file at : "+initPath,
                                    {consoleOnly:true, mode:'consoleOutput'});
                                ui.loadingProgress("Error!", "This means that your game was not successfully parsed.",
                                    {consoleOnly:true, mode:'consoleOutput'});
                                ui.showCloseButton();
                                trans.isLoadingFileList = false;
                                return false;
                            }

                            trans.project         = data;
                            trans.currentFile     = "";

                            trans.gameTitle     = data.gameTitle;
                            trans.gameFolder     = data.loc;
                            trans.projectId     = data.projectId;
                            trans.gameEngine     = data.gameEngine;
                            trans.editorName    = "SLR Translator";
                            trans.editorVersion = nw.App.manifest.version;
                            trans.generateHeader();
                            trans.sanitize();

                            trans.dataPadding();
                            sys.updateLastOpenedProject();
                            trans.autoSave();

                            ui.setStatusBar(1, trans.gameTitle);

                            trans.trigger("projectCreated", trans, data);
                            try { SceneGraph.reset(); SceneGraph.build(); } catch(e) { console.warn("[SceneGraph] build after create failed:", e); }
                            if (typeof options.onAfterLoading == 'function') {
                                options.onAfterLoading.call(trans, data, this);
                            }
                            trans.fileListLoaded = true;
                            trans.isLoadingFileList = false;
                            if (trans.batchCheckSheet && ["rmxp", "rmvx", "rmvxace", "rmmv", "rmmz"].indexOf(trans.gameEngine) != -1) {
                                if (typeof ui.holdCloseButton === "function") ui.holdCloseButton();
                            }
                            ui.loadingProgress("Done!", "All done!", {consoleOnly:false, mode:'consoleOutput'});
                            ui.loadingEnd();
                        }
                    });
                } catch (error)    {

                    ui.loadingProgress("Error!", "Error opening file : "+initPath, {consoleOnly:false, mode:'consoleOutput'});
                    ui.loadingProgress("Error!", error, {consoleOnly:true, mode:'consoleOutput'});
                    ui.loadingEnd();
                    trans.fileListLoaded = false;
                    trans.isLoadingFileList = false;

                }

                var $tmpPath = loadedData.find("#tmpPath");
                if ($tmpPath.length > 0) {

                    ui.showOpenCacheButton($tmpPath.text());

                }

            }

        }
    });
}

/**
 * Create a project through a JavaScript engine handler instead of the PHP
 * backend. The engine's `createProject` handler is called with
 * `{gameFolder, selectedFile, gameEngine, gameTitle, projectId, options}` and
 * must resolve to a project object:
 *
 *   {
 *     gameEngine : "<engine id>",
 *     gameTitle  : "<title>",
 *     loc        : "<game folder>",
 *     projectId  : "<id>",
 *     parser     : "<parser name>",
 *     cache      : {cacheID, cachePath},        // e.g. from common.initStaging()
 *     files      : {
 *       "<relative path>": {
 *         path, dirname, basename, extension,
 *         data: [ [original, translation, ...], ... ]
 *       }
 *     },
 *     options    : {}                            // optional, engine-specific
 *   }
 *
 * The result is applied through openFromTransObj() — the same path used by
 * the built-in JavaScript-side project creators (custom parser, SEP, rmmv,
 * rmrgss). Files are copied into the staging cache by the engine itself.
 * @param {String} engineName - engine id with a registered createProject handler
 * @param {Object} options - as passed to createProject
 * @returns {Promise<Boolean>} true when the project was created
 */
Trans.prototype.createProjectFromEngine = async function(engineName, options) {
    var trans = this;
    ui.showLoading();
    ui.loadingProgress("Processing", "Creating project ("+engineName+")", {consoleOnly:false, mode:'consoleOutput'});

    var data = null;
    try {
        data = await engines.handler("createProject", engineName).call(this, {
            gameFolder    : this.gameFolder,
            selectedFile  : options.selectedFile || "",
            gameEngine    : engineName,
            gameTitle    : this.gameTitle || "",
            projectId    : this.projectId || "",
            options        : options.options || {}
        });
    } catch (e) {
        console.warn("Engine "+engineName+" failed to create the project", e);
        ui.loadingProgress("Error!", "The "+engineName+" engine failed to create the project : "+((e&&e.message)||e),
            {consoleOnly:false, mode:'consoleOutput'});
        ui.loadingEnd();
        return false;
    }

    if (!data || typeof data !== "object" || !data.files) {
        ui.loadingProgress("Error!", "The "+engineName+" engine returned invalid project data.",
            {consoleOnly:false, mode:'consoleOutput'});
        ui.loadingEnd();
        return false;
    }

    data.gameEngine = data.gameEngine || engineName;
    data.loc        = data.loc || this.gameFolder;

    this.openFromTransObj({project: data}, {isNew: true});

    if (typeof options.onAfterLoading == 'function') {
        options.onAfterLoading.call(trans, data, trans);
    }

    ui.loadingProgress("Done!", "All done!", {consoleOnly:false, mode:'consoleOutput'});
    ui.loadingEnd();
    return true;
}

Trans.prototype.procedureCreateProject =function(gamePath, options) {

    if (typeof gamePath == 'undefined') return false;
    options                 = options||{};
    options.selectedFile     = options.selectedFile||"";
    options.force             = options.force||"";
    options.projectInfo     = options.projectInfo||{
                                id        :"",
                                title    :""
                            }
    options.options         = options.options||{};
    options.gameEngine         = options.gameEngine||"";

    this.closeProject();

    this.projectId     = options.projectInfo.id;
    this.gameTitle     = options.projectInfo.title;
    this.gameFolder = gamePath;
    this.gameEngine = options.gameEngine;

    ui.newProjectDialog.close();
    this.createProject({
        selectedFile:options.selectedFile,
        force:options.force,
        onAfterLoading:async function(rawData) {
            this.drawFileSelector();

            this.project.options = this.project.options || {};
            this.project.options.init = options.options || {};
            if (engines.hasHandler('onAfterCreateProject')) {
                await common.wait(100);
                await engines.handler('onAfterCreateProject').call(this, gamePath, options);
            }
        },
        options:options.options
    });

}

Trans.prototype.getRow = function(fileData, keyword) {

    if (typeof keyword !== 'string') return undefined;

    if (fileData.indexIsBuilt == false) {

        this.buildIndexFromData(fileData);
    }
    fileData.indexIds = fileData.indexIds || {};

    return fileData.indexIds[keyword];
}

Trans.prototype.updateProject = function(jsonData, options) {

    if (typeof jsonData == 'string') jsonData = JSON.parse(jsonData);
    options = options||{};
    options.onAfterLoading     = options.onAfterLoading||function(type, responseData, event) {};
    options.onSuccess         = options.onSuccess||function(responseData, event) {};
    options.onFailed         = options.onFailed||function(responseData, event) {};
    options.filePath         = options.filePath||"";
    options.purgeNonExistingData ||= false;

    jsonData.project = jsonData.project || {};
    jsonData.project.files = jsonData.project.files || {};

    var projectCopy = this.getSaveData();
    var oldFiles     = common.clone(projectCopy.project.files||{});

    projectCopy.project.files = jsonData.project.files;

    for (let file in jsonData.project.files) {
        var thisFile = projectCopy.project.files[file];
        if (!oldFiles[file]) continue;
        if (!oldFiles[file].data) continue;
        if (oldFiles[file].data.length < 1) continue;

        if (options.purgeNonExistingData) {

            for (let rowId=0; rowId < thisFile.data.length; rowId++ ) {
                let key = thisFile.data[rowId][0];
                var oldFileRow = this.getRow(oldFiles[file], key);

                if (typeof oldFileRow == 'undefined') continue;
                if (!oldFiles[file].data[oldFileRow]) continue;

                for (let x=1; x<oldFiles[file].data[oldFileRow].length; x++) {

                    thisFile.data[rowId][x] = oldFiles[file].data[oldFileRow][x];
                }
            }
        } else {

            let thisOldFile = oldFiles[file];
            for (let rowId=0; rowId < thisOldFile.data.length; rowId++ ) {
                if (!thisOldFile.data[rowId]?.length) continue;

                let key = thisOldFile.data[rowId][0];
                if (!key) continue;
                var fileRow = this.getRow(thisFile, key);

                if (typeof fileRow == 'undefined') {

                    let newLen = thisFile.data.push(thisOldFile.data[rowId]);
                    thisFile.data.indexIds ||= {};
                    thisFile.data.indexIds[key] = newLen-1;
                    continue;
                }

                for (let x=1; x<thisOldFile.data[rowId].length; x++) {

                    thisFile.data[fileRow][x] = thisOldFile.data[rowId][x];
                }

            }
        }

    }

    return projectCopy;
}

Trans.prototype.openFromTransObj = function(jsonData, options) {

    if (typeof jsonData == 'string') jsonData = JSON.parse(jsonData);

    options = options||{};
    options.onAfterLoading     = options.onAfterLoading||function(type, responseData, event) {};
    options.onSuccess         = options.onSuccess||function(responseData, event) {};
    options.onFailed         = options.onFailed||function(responseData, event) {};
    options.filePath         = options.filePath||"";
    options.isNew             = options.isNew || false;

    if (options.isNew) {
        jsonData = this.initTransData(jsonData);

    }

    this.currentFile = options.filePath;
    this.applySaveData(jsonData);
    this.sanitize();
    this.grid.render();
    sys.insertOpenedFileHistory();

    try {
        $DV.config.sl = this.project.options.sl||"ja";
        $DV.config.tl = this.project.options.tl||"en";
    } catch (e) {
        $DV.config.sl = "ja";
        $DV.config.tl = "en";
    }
    if (typeof options.onSuccess == 'function') options.onSuccess.call(this, jsonData);
    if (typeof options.onAfterLoading == 'function') options.onAfterLoading.call(this, "success", jsonData);

    this.updateStagingInfo();

    this.isOpeningFile = false;
    ui.hideBusyOverlay();
    if (jsonData.project.selectedId && this.project.files[jsonData.project.selectedId]) {
        this.selectFile(jsonData.project.selectedId);
    } else {
        this.selectFile($(".fileList .data-selector").eq(0));
    }

	if (options.isNew) {
		var _engine = this.gameEngine || (this.project && this.project.gameEngine) || "";
		if (this.batchCheckSheet && typeof this.batchCheckSheet.checkProject === "function"
			&& ["rmxp", "rmvx", "rmvxace", "rmmv", "rmmz"].indexOf(_engine) != -1) {
			if (typeof ui.holdCloseButton === "function") ui.holdCloseButton();
		}
		setTimeout(() => { this.trigger("projectCreated", this, this.project); }, 100);
	}

}

Trans.prototype.detectFormat = async function(path) {
    if (!path) return false;
    if (nwPath.extname(path).toLowerCase() == ".slrproj") return "slrproj";

    return false;
}

Trans.prototype.open = async function(filePath, options) {
    filePath = filePath||this.currentFile;
    if (filePath == "" || filePath == null || typeof filePath == 'undefined') return false;

    if (await this.detectFormat(filePath) == "slrproj") {
        return this.importSlrproj(filePath);
    }

    var trans                 = this;
    options                 = options||{};
    options.onAfterLoading     = options.onAfterLoading||function(type, responseData, event) {};
    options.onSuccess         = options.onSuccess||function(responseData, event) {};
    options.onFailed         = options.onFailed||function(responseData, event) {};

    trans.isOpeningFile = true;

    ui.showBusyOverlay();
    fs.readFile(filePath, function (err, data) {
        if (err) {

            alert("error opening file (open): "+filePath+"\r\n"+err);
            if (typeof data != 'undefined') {
                data = data.toString();
                if (typeof options.onFailed =='function') options.onFailed.call(trans, data);
                if (typeof options.onAfterLoading =='function') options.onAfterLoading.call(trans, "error", data);
            }
            ui.hideBusyOverlay();
        } else {
            data                 = data.toString();
            var jsonData         = {};
            try {
                jsonData         = JSON.parse(data);
            } catch (e) {

                alert("Failed to parse JSON data.\nThe project file is corrupted.");
                if (typeof options.onAfterLoading == 'function') options.onAfterLoading.call(trans, "Failed", jsonData);
                trans.isOpeningFile = false;
                ui.hideBusyOverlay();
                return;
            }

            trans.currentFile     = filePath;
            trans.applySaveData(jsonData);
            trans.sanitize();
            trans.grid.render();
            if (!options.skipHistory) sys.insertOpenedFileHistory();

            try {
                $DV.config.sl = trans.project.options.sl||"ja";
                $DV.config.tl = trans.project.options.tl||"en";
            } catch (e) {
                $DV.config.sl = "ja";
                $DV.config.tl = "en";
            }
            if (typeof options.onSuccess == 'function') options.onSuccess.call(trans, jsonData);
            if (typeof options.onAfterLoading == 'function') options.onAfterLoading.call(trans, "success", jsonData);
            // Fired when an existing project is opened (projectCreated only fires
            // for new projects), so listeners like the first-use tour can react.
            trans.trigger("projectOpened", trans, jsonData);
            trans.isOpeningFile = false;
            ui.hideBusyOverlay();
    if (jsonData.project.selectedId && trans.project.files[jsonData.project.selectedId]) {
        trans.selectFile(jsonData.project.selectedId);
    } else {
        trans.selectFile($(".fileList .data-selector").eq(0));
    }

            trans.gridIsModified(false);

            trans.project.options = trans.project.options || {}

            if (Boolean(trans.project.options.info) && trans.project.options.displayInfo) {
                ui.showPopup("infobox_"+trans.project.projectId, trans.project.options.info, {
                    title        : "Project's Info",
                    allExternal    : true,
                    HTMLcleanup    : true
                    });
            }

            if (trans.isCacheError()) {
                ui.addIconOverlay($(".button-properties"), "attention")
                $(".button-properties").attr("title", "Project properties - Staging path error!")
            } else {
                ui.clearIconOverlay($(".button-properties"))
                $(".button-properties").attr("title", "Project properties");
            }
        }
    });
}

Trans.prototype.isCacheError = function() {
    trans.project.cache = trans.project.cache || {}
    if (trans.project.cache.cachePath) {
        if (common.isDir(trans.project.cache.cachePath) == false) {
            return true;
        }
    }

    return false;
}

Trans.prototype.getSl = function() {

    this.project.options     = this.project.options || {}
    sys.config.default         = sys.config.default || {};
    var sl                     = this.project.options.sl || sys.config.default.sl || $DV.config.sl;
    return sl;
}
Trans.prototype.getTl = function() {

    this.project.options     = this.project.options || {}
    sys.config.default         = sys.config.default || {};
    var tl                     = this.project.options.tl || sys.config.default.tl || $DV.config.tl;
    return tl;
}

Trans.prototype.applyNewData = function(newData) {
    newData = newData||[[]];

    for (var row=0; row<newData.length; row++) {
        this.data[row] = newData[row];
    }
}

Trans.prototype.applyNewHeader = function(newHeader) {
    newHeader = newHeader||[];

    for (var header=0; header<newHeader.length; header++) {
        this.colHeaders[header] = newHeader[header];
    }
}

Trans.prototype.generateId = function() {
    return common.makeid(10);
}

Trans.prototype.initTransData = function(transData) {

    transData         = transData||{};
    var template     = JSON.parse(fs.readFileSync("data/template.json"));

    template.project ||= {}
    template.project.projectId     = undefined;
    template.project.buildOn     = undefined;

    var result         = common.mergeDeep(template, transData);
    delete result.columns;
    delete result.colHeaders;

    result.project                 = result.project || {}
    result.project.projectId     = result.project.projectId || this.generateId(10);
    result.project.buildOn         = result.project.buildOn || common.formatDate(Date.now());
    result.project.editorVersion = nw.App.manifest.version;
    result.project.editorName     = "SLR Translator";

    return result;
}

Trans.prototype.createFileData = function(fullPath, defaultData) {
    defaultData = defaultData || {}
    fullPath = fullPath.replace(/\\/g, "/");

    defaultData.basename         = defaultData.basename||nwPath.basename(fullPath),
    defaultData.filename         = defaultData.filename||nwPath.basename(fullPath),
    defaultData.path             = defaultData.path||fullPath,
    defaultData.relPath         = defaultData.relPath||fullPath,
    defaultData.data            = defaultData.data||[[null]],
    defaultData.originalFormat     = defaultData.originalFormat||"Autogenerated TRANS obj",
    defaultData.type            = defaultData.type||""
    defaultData.context            = defaultData.context||[]
    defaultData.tags            = defaultData.tags||[]

    if (typeof defaultData.extension == 'undefined') defaultData.extension = nwPath.extname(fullPath);
    if (typeof defaultData.dirname == 'undefined')     defaultData.dirname = nwPath.dirname(fullPath);

    return defaultData;
}

Trans.prototype.validateTransData = function(transData) {

    var result = {};
    if (Array.isArray(transData)) {

        let templateObj     = this.loadJSONSync(this.getTemplatePath());
        let objName         = "/main";
        templateObj.project.files[objName] = this.createFileData(objName, {data:transData});
        result = templateObj;
        return result;
    }

    if (Boolean(transData.project)==false && Boolean(transData.files)==false && Array.isArray(transData.data)) {

        let templateObj     = this.loadJSONSync(this.getTemplatePath());
        let objName         = transData.path||"/main";
        templateObj.project.files[objName] = this.createFileData(objName, {data:transData.data});
        result = templateObj;
        return result;
    }

    if ( Boolean(transData.project)==false && Boolean(transData.files)==true) {
        result.project = transData;
    } else {
        result = transData;
    }

    result.project.gameTitle         = result.project.gameTitle||"untitled project";
    result.project.gameEngine         = result.project.gameEngine||"";
    result.project.projectId         = result.project.projectId||"";
    result.project.buildOn            = result.project.buildOn || common.formatDate();
    result.project.files            = result.project.files || {};

    for (var id in result.project.files) {
        result.project.files[id] = this.createFileData(id, result.project.files[id])
    }

    return result;
}

Trans.prototype.normalizeHeader = function() {
    for (var i=0; i<this.columns.length; i++) {
        if (i == this.keyColumn) {
            this.columns[i].validator         = this.validateKey;
        }

        this.columns[i].wordWrap            = true;
    }
}

Trans.prototype.applySaveData = function(saveData) {

    saveData             = saveData||{};
    saveData             = this.validateTransData(saveData);
    this.data             = saveData.data||[[null]];

    this.columns         = saveData.columns||this.default.columns||[];
    while (this.columns.length < this.default.columns.length) {
        this.columns.push(JSON.parse(JSON.stringify(this.default.columns[this.columns.length] || {readOnly:false})));
    }
    this.normalizeHeader();
    this.colHeaders     = saveData.colHeaders||this.default.colHeaders||[];
    while (this.colHeaders.length < this.default.colHeaders.length) {
        this.colHeaders.push(this.default.colHeaders[this.colHeaders.length] || ("Column "+this.colHeaders.length));
    }
    this.project         = saveData.project||{};

    this.gameTitle         = saveData.project.gameTitle||"";
    this.gameEngine     = saveData.project.gameEngine||"";
    this.projectId         = saveData.project.projectId||"";
    this.gameFolder     = saveData.project.loc||"";

    if (saveData.fileListLoaded == false) {
        try {
            if (typeof saveData.project.files !== "undefined") saveData.fileListLoaded = true;
        }
        catch(err) {
            saveData.fileListLoaded = false;
        }
    }
    this.resetIndex();
    this.fileListLoaded = saveData.fileListLoaded||false;

    this.initFileNav();
    this.refreshGrid();
    ui.setWindowTitle();
    ui.setStatusBar(1, this.gameTitle);

    if (saveData.slrGlossary && typeof saveData.slrGlossary === "object" && Object.keys(saveData.slrGlossary).length > 0) {
        window.SLRGlossary = saveData.slrGlossary;
        try {
            var extractor = new window.GlossaryExtractor();
            window.SLRGlossaryText = extractor.formatGlossaryText(saveData.slrGlossary);
        } catch(e) {
            window.SLRGlossaryText = "";
        }
    } else {
        window.SLRGlossary = null;
        window.SLRGlossaryText = "";
    }

    if (saveData.slrGlossaryProgress && typeof saveData.slrGlossaryProgress === "object" && saveData.slrGlossaryProgress.accumulatedGlossary) {
        window.SLRGlossaryProgress = saveData.slrGlossaryProgress;
    } else {
        window.SLRGlossaryProgress = null;
    }

    try { SceneGraph.reset(); SceneGraph.build(); } catch(e) { console.warn("[SceneGraph] build after load failed:", e); }

    return this;
}

Trans.prototype.getSaveData = function(options) {
    options         = options||{};
    options.filter     = options.filter || [];
    options.type    = options.type || "";

    if (empty(this.project)) return;
    if (empty(this.project.files)) return;
    this.project.projectId = this.project.projectId || common.makeid(10);

    var projectClone;
    if (options.filter.length > 0) {
        // Filter BEFORE cloning: cloning the whole project first and then
        // replacing its files still pays for one full copy of every file.
        // On large games that transient copy alone is enough to exhaust the
        // renderer's V8 heap (OOM crash when exporting a single big file).
        projectClone = JSON.parse(JSON.stringify(Object.assign({}, this.project, {files: {}}))) || {};

        if (typeof this.project !== 'undefined') {
            if (typeof this.project.files !== 'undefined') {
                projectClone.files = {};
                for (var i=0; i<options.filter.length; i++) {
                    var thisId = options.filter[i];

                    if (typeof this.project.files[thisId] == 'undefined') continue;

                    projectClone.files[thisId] = JSON.parse(JSON.stringify(this.project.files[thisId]));
                }
            }
        }
    } else {
        projectClone = JSON.parse(JSON.stringify(this.project))||{};
    }

    var saveData = {};

    saveData.data             = [[null]];
    saveData.columns         = this.columns||[];
    saveData.colHeaders     = this.colHeaders||[];
    saveData.project         = projectClone;

    saveData.fileListLoaded = this.fileListLoaded;

    if (window.SLRGlossary && typeof window.SLRGlossary === "object" && Object.keys(window.SLRGlossary).length > 0) {
        saveData.slrGlossary = window.SLRGlossary;

    } else {

    }

    if (window.SLRGlossaryProgress && window.SLRGlossaryProgress.accumulatedGlossary) {
        saveData.slrGlossaryProgress = window.SLRGlossaryProgress;

    }

    for (let i=0; i<this.grid.getColHeader().length; i++) {
        if (!saveData.columns[i]) continue;
        saveData.columns[i].width = this.grid.getColWidth(i);
    }

    if (options.type == "json") return JSON.stringify(saveData);
    return saveData;
}

Trans.prototype.compress = async function(data, options) {
    options = options || {};
    var buff = Buffer.from([]);
    if (Buffer.isBuffer(data)) {
        buff = data;
    } else if (typeof data == "string") {
        buff = Buffer.from(data);
    } else if (typeof data == "object" && !empty(data)) {
        buff = Buffer.from(JSON.stringify(data));
    } else {

        buff = Buffer.from(JSON.stringify(this.getSaveData()));
    }

    return common.gzip(buff, options);

}

Trans.prototype.uncompress = async function(data, options) {
    options = options || {};
    var buff = Buffer.from([]);
    if (Buffer.isBuffer(data)) {
        buff = data;
    } else if (typeof data == "string") {
        buff = Buffer.from(data);
    } else {
        return void 0;
    }

    return common.gunzip(buff, options);
}

Trans.prototype.from = async function(source) {
    var str = "";
    var obj;

    if (Buffer.isBuffer(source)) {
        if (source.slice(0, 10).join(",") == "31,139,8,0") {

            str = await common.gunzip(source);
            str = str.toString();
        } else {
            str = source.toString();
        }
    } else if (typeof source == "string") {
        str = source;
    }

    if (str) {
        if (JSON.isJSON(str) == false) return void 0;
        obj = JSON.parse(str);
    }

    return obj;
}

Trans.prototype.createBackup = async function(saveFile) {
    var backupLevel = parseInt(sys.getConfig("backupLevel"));
    if (!sys.getConfig("autoBackup")) return;
    if (!backupLevel) return;
    if (!await common.isFileAsync(saveFile)) return void 0;
    if ([".slrproj"].includes(nwPath.extname(saveFile).toLowerCase()) == false) return;

    await common.unlink(saveFile+`.${backupLevel}.bak`);

    for (var i=backupLevel-1; i>=0; i--) {
        if (i==0) {
            await common.rename(saveFile, saveFile+`.${i+1}.bak`);
        } else {
            if (await common.isFileAsync(saveFile+`.${i}.bak`) == false) continue;
            await common.rename(saveFile+`.${i}.bak`, saveFile+`.${i+1}.bak`)
        }
    }

}

Trans.prototype.saveAs = async function(targetFile, options) {
    var target = await ui.saveAsSlrproj(targetFile || trans.currentFile || "");

    if (!target) return "";

    return await this.save(target, options);
}

Trans.prototype.save = async function(targetFile, options) {
    targetFile = targetFile||this.currentFile;
    if (!targetFile) return await this.saveAs(targetFile, options);

    var trans                 = this;
    options                 = options||{};
    options.initiator         = options.initiator||"user";

    // portable .slrproj is a packaged archive, not plain JSON — route to its packer
    if (nwPath.extname(targetFile).toLowerCase() == ".slrproj") {
        return await this.exportSlrproj(targetFile, options);
    }

    options.filter             = options.filter || [];
    options.onAfterLoading     = options.onAfterLoading||function(responseData, event) {};
    options.onSuccess         = options.onSuccess||function(responseData, event) {};
    options.onFailed         = options.onFailed||function(responseData, event) {};

    if (trans.isSavingFile) return void 0;

    var saveData = trans.getSaveData(options);

    trans.isSavingFile = true;
    if (options.initiator !== "auto") ui.saveIndicatorStart();
    if (options.initiator == "user") await this.createBackup(targetFile);
    return new Promise((resolve, reject)=> {
        fs.writeFile(targetFile, JSON.stringify(saveData), (err) => {
            if (err) {
                if (typeof options.onFailed =='function') options.onFailed.call(trans, saveData, targetFile);
                if (options.initiator !== "auto") {
                    ui.saveIndicatorEnd();
                    // Make a write failure impossible to miss — otherwise the user
                    // closes the project assuming it saved and loses their work.
                    try {
                        alert("The project could NOT be saved to:\n" + targetFile +
                              "\n\nThe file on disk was left unchanged and your last successful save is intact. " +
                              "Your latest changes are still in memory — do not close the project yet.\n\n" +
                              "Error: " + (err && err.message ? err.message : err));
                    } catch (eAlert) {}
                }

                reject();
            } else {
                if (options.initiator !== "auto") {

                    sys.insertOpenedFileHistory(targetFile,saveData.project.projectId,saveData.project.gameTitle, options.initiator);
                    this.currentFile = targetFile;
                    trans.gridIsModified(false);
                    ui.setWindowTitle();
                }

                if (typeof options.onSuccess == 'function') options.onSuccess.call(trans, saveData, targetFile);
                resolve(targetFile);
            }

            options.onAfterLoading.call(trans, saveData, targetFile);

            if (options.initiator !== "auto") setTimeout(function(){
                ui.saveIndicatorEnd()
            }, 1000);

            trans.isSavingFile = false;
        });
    })

}

Trans.prototype.generateCachePath = function() {
    this.project.cache = this.project.cache || {}
    this.project.cache.cacheID         = this.project.cache.cacheID||this.project.projectId;
    if (!this.project.cache.cacheID) this.project.cache.cacheID = this.project.projectId = common.makeid(10)

    this.project.cache.cachePath     = this.project.cache.cachePath || nwPath.join(sys.config.stagingPath, this.project.cache.cacheID);

    try {
        fs.mkdirSync(this.project.cache.cachePath, {recursive:true})
    } catch (e) {

    }

}

Trans.prototype.autoSave = async function(options) {
    options = options||{};

    if (typeof this.project == 'undefined') {
        options.onSuccess = options.onSuccess || function(){};
        options.onSuccess.call(this);
        return false;
    }
    try {
        if (!this.project.cache.cachePath) {
            this.generateCachePath();
        } else {
            if (!common.isDir(this.project.cache.cachePath)) this.generateCachePath();
        }
    } catch (e) {

    }

    options.initiator = "auto";
    var path = nwPath.join(this.project.cache.cachePath,"autosave.json");
    await this.save(path, options);
    return path;
}

Trans.prototype.buildIndexFromData = function(fileData, force) {

    var key = 0;
    if (typeof fileData !== 'object') return void 0;
    if (Array.isArray(fileData.data) == false) return void 0;
    if (fileData.indexIsBuilt && !force) return fileData;
    fileData.data = fileData.data || [];

    fileData.indexIds = fileData.indexIds || {}

    for (var row = 0; row<fileData.data.length; row++) {
        var thisRow = fileData.data[row];
        if (!thisRow[key]) continue;
        fileData.indexIds[thisRow[key]] = row;
    }
    fileData.indexIsBuilt= true
    return fileData;

}

Trans.prototype.mergeTrans = function(externalTrans, targetTrans, options) {

    var key = 0;

    targetTrans = targetTrans || this;
    targetTrans.project = targetTrans.project || {};
    targetTrans.project.files = targetTrans.project.files || {};

    externalTrans = externalTrans || {};
    externalTrans.project = externalTrans.project || {}
    externalTrans.project.files = externalTrans.project.files || {};

    options = options || {};
    options.overwrite     = options.overwrite || false;
    options.targetPair     = options.targetPair||{};
    options.files         = options.files || [];
    options.all         = options.all || false;

    if (options.all) options.targetPair =  externalTrans.project.files;
    targetTrans = this.sanitize(targetTrans);

    var targetIsSelf = false;
    if (targetTrans instanceof Trans) targetIsSelf = true;

    for (var id in options.targetPair) {
        var sourceFile = externalTrans.project.files[id];
        var targetFile = targetTrans.project.files[id];
        if (!targetFile) {

            targetTrans.project.files[id] = common.clone(sourceFile);
            if (targetIsSelf) this.addFileItem(id, targetTrans.project.files[id]);
            continue;
        }

        if (Array.isArray(sourceFile.data)==false) continue;
        if (sourceFile.data.length == 0) continue;
        this.buildIndexFromData(targetFile);

        targetFile.context = targetFile.context||[];
        sourceFile.context = sourceFile.context||[];

        for (var row=0; row<sourceFile.data.length; row++) {
            var thisSourceRow = sourceFile.data[row];
            if (Boolean(thisSourceRow[key])==false) continue;

            var index = targetFile.indexIds[thisSourceRow[key]];
            if (typeof index == 'undefined') {
                index = targetFile.data.length;
            }
            targetFile.data[index]         = common.clone(thisSourceRow);
            targetFile.context[index]     = common.clone(sourceFile.context[row]);

        }
    }

    if (targetIsSelf)  {
        this.generateHeader(targetTrans);
        this.evalTranslationProgress();
        ui.fileList.reIndex();
        ui.initFileSelectorDragSelect();
    }

    this.refreshGrid();

    return targetTrans;
}

Trans.prototype.loadJSONSync = function(filePath, options) {
    if (filePath == "" || filePath == null || typeof filePath == 'undefined') return false;

    options = options||{};
    options.onAfterLoading = options.onAfterLoading||function(responseData, event) {};
    options.onSuccess = options.onSuccess||function(responseData, event) {};
    options.onFailed = options.onFailed||function(responseData, event) {};

    var fs = require('fs');
    var content = fs.readFileSync(filePath);
    var resultStr = content.toString();
    var result = false;
    try {
        result = JSON.parse(resultStr);
        return result;
    } catch(e) {
        return result;
    }
}

Trans.prototype.loadJSON = async function(filePath, options) {

    var trans = this;

    if (filePath == "" || filePath == null || typeof filePath == 'undefined') return false;

    options = options||{};
    options.onAfterLoading     = options.onAfterLoading||function(responseData, event) {};
    options.onSuccess         = options.onSuccess||function(responseData, event) {};
    options.onFailed         = options.onFailed||function(responseData, event) {};

    this.isOpeningFile = true;

    ui.showBusyOverlay();
    fs.readFile(filePath, function (err, data) {
        if (err) {

            data = data.toString();
            if (typeof options.onFailed =='function') options.onFailed.call(trans, data);
            ui.hideBusyOverlay();

            throw err;

        } else {
            data             = data.toString();
            try {
                var jsonData     = JSON.parse(data);

            } catch (e) {
                alert("Can not parse JSON data. Probably the file is corrupted.");
                options.onFailed.call(trans, jsonData);
                trans.isOpeningFile = false;
                ui.hideBusyOverlay();
                return;
            }

            if (typeof options.onSuccess == 'function') options.onSuccess.call(trans, jsonData);
            trans.isOpeningFile = false;
            ui.hideBusyOverlay();

        }
    });
}

Trans.prototype.importFromFile = function(file, options) {

    options             = options||{};
    options.overwrite     = options.overwrite || false;
    options.targetPair     = options.targetPair||{};
    options.files         = options.files || [];
    options.mergeData    = options.mergeData || false;

    var trans = this;

    trans.loadJSON(file, {
        onSuccess : function(data) {
            data = trans.validateTransData(data)

            if (options.mergeData) {
                trans.mergeTrans(data, trans, options);
                return;
            }

            for (let sourceKey in options.targetPair) {
                if (typeof options.targetPair[sourceKey] !== 'string') {
                    options.targetPair[sourceKey] = sourceKey;
                }

                try {
                    if (typeof data.project.files[sourceKey] == 'undefined') continue;
                    trans.project.files[options.targetPair[sourceKey]] = data.project.files[sourceKey];

                    trans.addFileItem(options.targetPair[sourceKey], trans.project.files[options.targetPair[sourceKey]]);

                } catch (e) {

                    continue;
                }

            }
            ui.initFileSelectorDragSelect();
            trans.evalTranslationProgress();
            ui.fileList.reIndex();
            trans.refreshGrid();

        }
    });
}

Trans.prototype.selectCell = function(row, column) {
    return this.grid.selectCell(row, column);
}

 Trans.prototype.getProjectChecksum = function() {
    if (this.project.checksum) return this.project.checksum;

    var sums = [];
    var allFiles = this.getAllFiles();
    allFiles.sort();
    for (var f in allFiles) {
        var thisFile = this.project.files[allFiles[f]];
        if (empty(thisFile)) continue;
        if (empty(thisFile.data)) continue;

        if (thisFile.dirname == "*") continue;
        var textPool = [];
        for (var r=0; r<thisFile.data.length; r++) {
            if (!thisFile.data[r][this.keyColumn]) continue;
            textPool.push(thisFile.data[r][this.keyColumn]);
        }
        if (textPool.length < 1) continue;
        textPool.sort();
        sums.push(common.crc32String(JSON.stringify(textPool)));
    }
    this.project.checksum = common.crc32String(JSON.stringify(sums));
    return this.project.checksum;
}



/**
 * Pack the contents of a directory into the .slrproj archive, storing entries at
 * the archive root (no parent-folder prefix). Uses a 7z LZMA solid archive: all
 * entries compress as one stream, deduping repeated structures across the
 * staging files and the save data — far smaller than per-entry zip for this
 * kind of data, at comparable speed. mx5 is the speed/size sweet spot.
 * Redundant/derivable/transient cache files are excluded via -x!.
 * @async
 * @param {String} srcDir - Directory whose contents will be archived (the staging cache)
 * @param {String} zipPath - Destination archive path
 * @returns {Promise<String>} The resulting archive path
 */
Trans.prototype._slrprojZip = async function(srcDir, zipPath) {
    var exe = common.get7zipBin();
    var excludes = [
        "-x!autosave.json", "-x!identity.txt", "-x!gameInfo.json", "-x!initial.json",
        "-x!initial.ser", "-x!export.log", "-x!mixed", "-x!data-translated"
    ];
    var packCode = -1;
    var stderrText = "";
    await common.aSpawn(exe, ["a", "-t7z", "-ms=on", "-mx=5", zipPath, "*"].concat(excludes), {
        cwd: srcDir,
        onDone: function(result, code) { packCode = code; },
        onError: function(data) { stderrText += (data ? data.toString() : ""); }
    });
    // 7z exit 0 = OK; 1 = warning (e.g. a staging file was locked/skipped, which
    // silently drops data from a solid archive); 2+ = fatal error; null = killed.
    // Any non-zero result means the archive is NOT a faithful copy of the project,
    // so treat it as a hard failure rather than letting a partial file slip through
    // (common.aSpawn resolves even on non-zero exit, so the code must be checked here).
    if (packCode !== 0) {
        throw("Failed to build project archive (7z exited with code " + packCode + ")." + (stderrText ? "\n" + stderrText.trim() : ""));
    }
    return zipPath;
}

/**
 * Verify a .slrproj archive is complete and structurally sound by asking 7z to
 * test it. Resolves only when the archive is fully readable; throws otherwise so
 * the caller can refuse to replace the existing (good) project file with a broken
 * one. This is the safety net beneath _slrprojZip's exit-code check: it catches a
 * file that 7z reports as written but that is actually truncated/corrupt on disk.
 * @async
 * @param {String} zipPath - Archive to verify
 * @returns {Promise<Boolean>} True when the archive passes
 */
Trans.prototype._slrprojVerify = async function(zipPath) {
    var exe = common.get7zipBin();
    var verifyCode = -1;
    await common.aSpawn(exe, ["t", zipPath], {
        onDone: function(result, code) { verifyCode = code; }
    });
    if (verifyCode !== 0) {
        throw("Project archive failed its integrity check (7z test exited with code " + verifyCode + "). The file is incomplete or corrupt.");
    }
    return true;
}

/**
 * Export the current project as a portable, self-contained SLR project package
 * (.slrproj). Bundles the full save data (project.json, generated fresh from
 * getSaveData so the glossary and latest edits are always included) together
 * with the entire staging tree (the original game files needed as an export
 * base), pruned of redundant/derivable/transient files.
 * @async
 * @param {String} file - Destination path
 * @param {Object} options - options.onDone(result) called when finished
 * @returns {Promise<String|Boolean>} The file path on success, false otherwise
 */
Trans.prototype.exportSlrproj = async function(file, options) {
    if (typeof file == "undefined" || !file) return false;
    options = options || {};
    options.onDone = options.onDone || function() {};
    options.initiator = options.initiator || "user";
    var trans = this;

    if (empty(this.project) || empty(this.project.files)) {
        console.warn("exportSlrproj: no project loaded");
        options.onDone.call(this, false);
        return false;
    }

    var isInteractive = options.initiator !== "auto";
    ui.saveIndicatorStart();
    var cachePath = null;
    var cleanupFiles = [];
    var tempZip = null; // archive is built here first, verified, then moved over the target
    try {
        if (!this.project.cache || !this.project.cache.cachePath || !common.isDir(this.project.cache.cachePath)) {
            this.generateCachePath();
        }
        cachePath = nwPath.resolve(this.project.cache.cachePath);

        // project.json: fresh save data (glossary-safe), slimmed by dropping fields
        // that are rebuilt lazily on load (indexIds) or restored from the file key
        // (path-derived fields), with the machine-specific staging path stripped.
        var saveData = this.getSaveData({});
        if (!saveData) throw("Unable to generate save data");
        if (saveData.project) {
            saveData.project.cache = saveData.project.cache || {};
            saveData.project.cache.cachePath = "";
            var slimFiles = saveData.project.files || {};
            for (var id in slimFiles) {
                var sf = slimFiles[id];
                if (!sf) continue;
                delete sf.indexIds;
                sf.indexIsBuilt = false;
                delete sf.basename; delete sf.filename; delete sf.extension;
                delete sf.dirname; delete sf.path; delete sf.relPath;
            }
        }
        fs.writeFileSync(nwPath.join(cachePath, "project.json"), JSON.stringify(saveData));
        cleanupFiles.push("project.json");

        // manifest: identity + provenance, replaces the old identity.txt header
        var manifest = {
            format: "slrproj",
            version: 1,
            editorVersion: nw.App.manifest.version,
            editorName: "SLR Translator",
            projectId: this.project.projectId,
            gameEngine: this.project.gameEngine,
            gameTitle: this.project.gameTitle,
            createdAt: common.formatDate(Date.now())
        };
        fs.writeFileSync(nwPath.join(cachePath, "manifest.json"), JSON.stringify(manifest, undefined, 2));
        cleanupFiles.push("manifest.json");

        // SAFER SAVE: build the archive to a throwaway path FIRST, verify it is
        // complete and intact, and only then move it over the real target. The
        // existing (good) project file is never deleted until a verified
        // replacement is in hand, so an interrupted or partial 7z run can never
        // leave a truncated/corrupt archive where a working one used to be.
        // (A previous version built directly into `file` after deleting it; if 7z
        // was interrupted — e.g. while SEP wrote staging image files concurrently —
        // it silently left a 25MB truncated archive in place of a 35MB project that
        // could no longer be opened, with no warning to the user.)
        tempZip = file + ".tmp-" + common.makeid(8);
        try { await common.unlink(tempZip); } catch (eLeftover) {} // stale temp from a prior crash
        await this._slrprojZip(cachePath, tempZip);
        if (!await common.isFileAsync(tempZip)) {
            throw("Project archive was not written (7z produced no output file).");
        }
        await this._slrprojVerify(tempZip);

        // verified OK: rotate a backup of the previous archive, then promote the
        // temp file to the final name. createBackup renames the old `file` to
        // file.1.bak, so `file` no longer exists right before the rename below,
        // keeping the swap as close to atomic as cross-platform fs allows.
        if (isInteractive) await this.createBackup(file);
        if (await common.isFileAsync(file)) await common.unlink(file);
        await common.rename(tempZip, file);
        tempZip = null; // ownership transferred to the real path

        ui.saveIndicatorEnd();
        if (isInteractive) {
            sys.insertOpenedFileHistory(file, this.project.projectId, this.project.gameTitle, options.initiator);
            this.currentFile = file;
            this.gridIsModified(false);
            ui.setWindowTitle();
        }
        if (typeof options.onSuccess == 'function') options.onSuccess.call(this, null, file);
        options.onDone.call(this, file);
        return file;
    } catch (e) {
        console.warn("exportSlrproj failed:", e);
        // never leave a suspect archive where a good one was: the original file is
        // untouched because we only createBackup/rename AFTER a successful verify.
        if (tempZip) { try { await common.unlink(tempZip); } catch (eCleanup) {} }
        ui.saveIndicatorEnd();
        if (isInteractive) {
            // Surface the failure loudly. Without this the user had no way to know
            // the save never completed and would close the project assuming it was
            // fine — losing their work to a silent truncation. The last successful
            // save on disk (the .slrproj / its .bak) is still intact.
            var reason = (e && e.message) ? e.message : String(e);
            try {
                alert("The project could NOT be saved.\n\n" +
                      "The file on disk was left unchanged and your last successful save is intact.\n" +
                      "Your latest changes are still in memory — do not close the project yet.\n\n" +
                      "Reason: " + reason +
                      "\n\nPlease try saving again, or use Save As to write to a different location. " +
                      "If saving keeps failing, keep this project open and report the error.");
            } catch (eAlert) {}
        }
        if (typeof options.onFailed == 'function') options.onFailed.call(this, null, file);
        options.onDone.call(this, false);
        return false;
    } finally {
        // remove the temporary project.json/manifest written into the staging folder
        if (cachePath) {
            for (var c = 0; c < cleanupFiles.length; c++) {
                try { await common.unlink(nwPath.join(cachePath, cleanupFiles[c])); } catch (e2) {}
            }
        }
    }
}

/**
 * Import (open) a .slrproj package. Verifies the manifest, restores the staging
 * tree into a locally-computed cache folder (stagingPath/projectId), writes the
 * patched project data as autosave.json, regenerates gameInfo.json, then opens
 * the project. Self-contained and portable: no reliance on the sender's paths.
 * @async
 * @param {String} file - Path to the .slrproj archive
 * @param {Object} options - options.onDone(result) called when finished
 * @returns {Promise<String|Boolean>} The file path on success, false otherwise
 */
Trans.prototype.importSlrproj = async function(file, options) {
    if (typeof file == "undefined" || !file) return false;
    options = options || {};
    options.onDone = options.onDone || function() {};
    var trans = this;

    trans.closeProject();

    ui.showLoading();
    ui.loadingProgress("Loading", "Opening SLR project package...", {consoleOnly:false, mode:'consoleOutput'});

    var tempExtract = null;
    var cachePath = null;
    var projectId = null;

    try {
        tempExtract = await common.makeTempDir();
        await common.extract(file, tempExtract);

        var manifest = {};
        try {
            manifest = JSON.parse(fs.readFileSync(nwPath.join(tempExtract, "manifest.json"), "utf8"));
        } catch (e) {}
        if (!manifest || manifest.format !== "slrproj") {
            throw("Not a valid SLR project package (manifest missing or invalid).");
        }

        projectId = manifest.projectId || common.makeid(10);
        cachePath = nwPath.join(sys.config.stagingPath, projectId);
        await common.mkDir(cachePath);

        // move the staging tree (everything except the two metadata files) into place
        var entries = fs.readdirSync(tempExtract);
        for (var i = 0; i < entries.length; i++) {
            var name = entries[i];
            if (name === "project.json" || name === "manifest.json") continue;
            await common.copy(nwPath.join(tempExtract, name), nwPath.join(cachePath, name));
        }

        // patch cache fields to the local staging location, then persist as autosave.json
        var saveData = JSON.parse(fs.readFileSync(nwPath.join(tempExtract, "project.json"), "utf8"));
        saveData.project = saveData.project || {};
        saveData.project.cache = saveData.project.cache || {};
        saveData.project.cache.cacheID = projectId;
        saveData.project.cache.cachePath = cachePath;
        fs.writeFileSync(nwPath.join(cachePath, "autosave.json"), JSON.stringify(saveData));

        await common.rmdir(tempExtract);
        tempExtract = null;

        ui.loadingProgress("Loading", "Staging data restored to: " + cachePath, {consoleOnly:false, mode:'consoleOutput'});
    } catch (e) {
        console.warn("importSlrproj failed:", e);
        if (tempExtract) { try { await common.rmdir(tempExtract); } catch (e2) {} }
        ui.loadingProgress("Loading", "Failed! " + e, {consoleOnly:false, mode:'consoleOutput', classStr:'stderr'});
        ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
        ui.showCloseButton();
        options.onDone.call(trans, false);
        return false;
    }

    var autosaveFile = nwPath.join(cachePath, "autosave.json");
    trans.open(autosaveFile, {
        skipHistory: true,
        onSuccess: function() {
            trans.project.cache = trans.project.cache || {};
            trans.project.cache.cacheID = projectId;
            trans.project.cache.cachePath = cachePath;
            // the user-visible file is the .slrproj package, not the internal autosave
            trans.currentFile = file;
            sys.insertOpenedFileHistory(file, projectId, trans.gameTitle, "user");
            ui.setWindowTitle();
            trans.updateStagingInfo().then(function() {
                if (trans.isCacheError()) {
                    ui.addIconOverlay($(".button-properties"), "attention");
                    $(".button-properties").attr("title", "Project properties - Staging path error!");
                } else {
                    ui.clearIconOverlay($(".button-properties"));
                    $(".button-properties").attr("title", "Project properties");
                }
                ui.loadingProgress("Loading", "Success!", {consoleOnly:false, mode:'consoleOutput'});
                ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
                setTimeout(function() { ui.hideLoading(true); }, 800);
                options.onDone.call(trans, file);
            });
        },
        onFailed: function() {
            ui.loadingProgress("Loading", "Failed!", {consoleOnly:false, mode:'consoleOutput'});
            ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
            ui.showCloseButton();
            options.onDone.call(trans, false);
        }
    });

    return file;
}

/**
 * Import translations from a .slrproj reference package into the CURRENT project.
 * Extracts only project.json from the package, then for every row whose original
 * text (column 0) already exists in the current project, copies ALL of its other
 * columns (translations, notes, context, etc.) from the reference. No new rows are
 * ever added — only existing matching rows are updated (ideal for continuing a
 * translation after a game update is re-parsed).
 * @async
 * @param {String} file - Path to the .slrproj reference package
 * @param {Object} options - {overwrite, caseInsensitive, onSuccess, onFailed}
 * @returns {Promise<Object|Boolean>} {rowsUpdated, cellsUpdated, references} on success, false otherwise
 */
Trans.prototype.importSlrprojTranslations = async function(file, options) {
    options = options || {};
    options.overwrite       = options.overwrite || false;
    options.caseInsensitive = options.caseInsensitive || false;
    options.onSuccess       = options.onSuccess || function() {};
    options.onFailed        = options.onFailed || function() {};
    var trans = this;

    if (empty(this.project) || empty(this.project.files)) {
        alert("No project is open. Open a project before importing translations.");
        return false;
    }
    if (!file) return false;

    ui.showLoading();
    ui.loadingProgress(0, "Importing translations");
    await common.wait(200);

    var tempExtract = null;
    var loadedFiles = null;
    try {
        tempExtract = await common.makeTempDir();
        await common.extract(file, tempExtract, {sourceFilter: "project.json"});
        var projPath = nwPath.join(tempExtract, "project.json");
        if (!fs.existsSync(projPath)) throw("project.json not found in the .slrproj package.");
        var saveData = JSON.parse(fs.readFileSync(projPath, "utf8"));
        loadedFiles = (saveData && saveData.project && saveData.project.files) ? saveData.project.files : null;
        if (!loadedFiles) throw("No translation data found in the .slrproj package.");
    } catch (e) {
        console.warn("importSlrprojTranslations failed:", e);
        ui.loadingProgress("Error!", "Failed to read .slrproj: " + e, {consoleOnly:false, mode:'consoleOutput', classStr:'stderr'});
        ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
        ui.showCloseButton();
        options.onFailed.call(trans, e);
        return false;
    } finally {
        if (tempExtract) { try { await common.rmdir(tempExtract); } catch (e2) {} }
    }

    var lowerCaseText = options.caseInsensitive ? function(t) { return (t||"").toLowerCase().replaceAll("\r", ""); } : null;

    ui.loadingProgress(30, "Building reference table");
    await ui.log("Building reference table from .slrproj");

    // reference map: {keyText: fullRow} — store the entire row so every non-key
    // column (translations, notes, context, ...) can be restored. Only rows that
    // carry at least one value in a non-key column are kept.
    var refRows = {};
    for (var fid in loadedFiles) {
        var rows = loadedFiles[fid] && loadedFiles[fid].data;
        if (!Array.isArray(rows)) continue;
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            if (!Array.isArray(row) || !row[0]) continue;
            var hasData = false;
            for (var c = 1; c < row.length; c++) { if (row[c]) { hasData = true; break; } }
            if (!hasData) continue;
            var key = options.caseInsensitive ? lowerCaseText(row[0]) : row[0];
            if (!refRows[key]) refRows[key] = row;
        }
    }

    var numData = Object.keys(refRows).length;
    await ui.log("Found " + numData + " reference row(s) to match");

    ui.loadingProgress(50, "Matching rows and restoring columns");
    var targetFiles = trans.getAllFiles();
    var tempIndexes = trans.buildIndexes(targetFiles, false, {customFilter: lowerCaseText});
    // cap at the current project's column count so we never create phantom columns
    var maxCols = (this.colHeaders && this.colHeaders.length) ? this.colHeaders.length : 99;

    var rowsUpdated = 0;
    var cellsUpdated = 0;
    var lastProgress = 50;
    var idx = 0;
    for (var key in refRows) {
        var refRow = refRows[key];
        var indexObjects = trans.getFromIndexes(key, tempIndexes, lowerCaseText);
        if (!indexObjects && key.includes("\r")) {
            indexObjects = trans.getFromIndexes(key.replaceAll("\r", ""), tempIndexes, lowerCaseText);
        }
        if (indexObjects) {
            for (var i = 0; i < indexObjects.length; i++) {
                var addr = indexObjects[i];
                if (typeof addr.row != 'number') continue;
                var thisRow = trans.getData(addr.file)[addr.row];
                if (!thisRow) continue;
                var rowChanged = false;
                for (var c = 1; c < refRow.length; c++) {
                    if (c >= maxCols) break;
                    var val = refRow[c];
                    if (Boolean(val) == false) continue;
                    // extend short rows (e.g. freshly-parsed rows) so every non-key
                    // column can be restored, not just the first translation column
                    while (thisRow.length <= c) thisRow.push("");
                    if (!options.overwrite && Boolean(thisRow[c])) continue;
                    thisRow[c] = val;
                    cellsUpdated++;
                    rowChanged = true;
                }
                if (rowChanged) rowsUpdated++;
            }
        }
        idx++;
        var thisProgress = Math.round(50 + (idx / Math.max(numData, 1) * 50));
        if (thisProgress > lastProgress) {
            ui.loadingProgress(thisProgress);
            lastProgress = thisProgress;
        }
    }

    await common.wait(20);
    trans.evalTranslationProgress();
    trans.refreshGrid();
    trans.gridIsModified(true);

    ui.loadingProgress(100, "Done!");
    ui.loadingProgress("Finished", "Restored " + cellsUpdated + " cell(s) across " + rowsUpdated + " matching row(s).", {consoleOnly:false, mode:'consoleOutput'});
    setTimeout(function() { ui.hideLoading(true); }, 800);

    var result = {rowsUpdated: rowsUpdated, cellsUpdated: cellsUpdated, references: numData};
    options.onSuccess.call(trans, result);
    return result;
}

 Trans.prototype.export = async function(file, options) {

    if (typeof file=="undefined") return false;

    options = options||{};
    options.options = options.options||{};

    options.mode                     = options.mode||"dir";
    options.onDone                    = options.onDone||function() {};
    options.dataPath                 = options.dataPath || "";
    options.transPath                 = options.transPath || "";
    options.options.filterTag         = options.options.filterTag|| options.filterTag ||[];
    options.options.filterTagMode     = options.options.filterTagMode||options.filterTagMode||"";
    options.custom                     = options.custom || options.options.custom;
    delete options.options.custom;

    var autofillFiles = [];
    var checkbox = $(".fileList .data-selector .fileCheckbox:checked");
    for (var i=0; i<checkbox.length; i++) {
        autofillFiles.push(checkbox.eq(i).attr("value"));
    }
    options.files = options.files||autofillFiles||[];

    let thisEngine = trans.project.gameEngine;
    if (typeof engines[thisEngine] !== 'undefined') {
        if (typeof engines[thisEngine].exportHandler == 'function') {
            var halt = await engines[thisEngine].exportHandler.apply(this, arguments);

            if (halt) {
                await this.projectHook.run("afterExport", options);
                return;
            }
        }
    }

    var autosavePath = await trans.autoSave();
    ui.showLoading();
    trans.project.options = trans.project.options || {}
    trans.project.options.init = trans.project.options.init || {};
    var projectOption = Object.assign(trans.project.options.init, options.options);
    php.spawn("export.php", {
        args:{
            path        :file,
            gameFolder    :trans.gameFolder,
            gameTitle    :trans.gameTitle,
            projectId    :trans.projectId,
            gameEngine    :trans.gameEngine,
            files        :options.files,
            exportMode    :options.mode,
            options        :projectOption,
            rpgTransFormat:trans.config.rpgTransFormat,
            dataPath    :options.dataPath,
            transPath    :nwPath.resolve(options.transPath || autosavePath)
        },
        onData:function(buffer) {
            ui.loadingProgress("Loading", buffer, {consoleOnly:true, mode:'consoleOutput'});

        },
        onError:function(buffer) {
            ui.loadingProgress("Loading", buffer, {consoleOnly:true, mode:'consoleOutput', classStr:'stderr'});

        },
        onDone: async (data) => {

            ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});

            await this.projectHook.run("afterExport", options);
            ui.loadingEnd();
            options.onDone.call(trans, data);
        }
    })

}

Trans.prototype.revertToOriginal = async function(destinationPath, options={}) {
    var bCopy = require('www/js/lib/bigCopy.js')
    if (!destinationPath) {
        destinationPath = await ui.openRevertToOriginalDialog();
    }

    options.dataPath = options.dataPath || "data"

    if (!destinationPath) return;

    ui.showLoading();
    ui.loadingProgress(0, "Reverting original data");

    var objects = this.project.files;
    if (this.getCheckedFiles().length > 0) objects = this.getCheckedObjects();

    var copied = 0;
    var processed = 0;
    var totalLength = Object.keys(objects).length || 1;
    ui.log(`Processing ${totalLength} file(s)`);
    for (var i in objects) {
        processed++;

        var stagingBaseFolder = this.getStagingDataPath();
        var stagingFile = this.getStagingFile(objects[i]);
        var relativePath = common.getRelativePath(stagingFile, stagingBaseFolder)
        await ui.loadingProgress(Math.round((processed/totalLength)*100), `Reverting : ${relativePath}`);

        if (! await common.isFileAsync(stagingFile)) {
            await ui.log(`File not found: ${stagingFile}`);
            continue;
        }

        await ui.log(`${processed}/${totalLength} Copying : ${stagingFile}`);
        await bCopy(stagingFile, nwPath.join(destinationPath, relativePath), {
            overwrite:true
        });
        copied++;
    }
    await ui.log(`Completed! ${copied} file(s) reverted to original!`);
    ui.LoadingAddButton("Open folder", function() {
            nw.Shell.showItemInFolder(nwPath.join(destinationPath, relativePath));
        },
        {
            class: "icon-folder-open"
        });
    ui.loadingEnd();
}

 Trans.prototype.importRPGMTrans = function(paths, columns, options) {

    columns             = columns||1;
    options             = options||{};
    options.sourceColumn = options.sourceColumn||"auto";
    options.overwrite     = options.overwrite||false;
    options.files         = options.files||trans.getCheckedFiles()||[];
    options.sourceKeyColumn = options.sourceKeyColumn||0;
    options.keyColumn     = options.keyColumn||0;
    options.newLine        = options.newLine||undefined;
    options.stripCarriageReturn = options.stripCarriageReturn||false;
    options.ignoreNewLine = true;

    if (Array.isArray(paths) == false) paths=[paths];

    ui.showLoading();

    ui.loadingProgress(0, "Collecting paths", {consoleOnly:true, mode:'consoleOutput'});

    var allPaths = [];
    for (var i=0; i<paths.length; i++) {
        var path = paths[i];
        if (common.isExist(path) == false) {
            ui.loadingProgress(0, "Path : '"+path+"' doesn't exist", {consoleOnly:true, mode:'consoleOutput'});

            continue;
        }

        if (common.isDir(path)) {
            var dirTree = common.dirContentSync(path);
            allPaths = allPaths.concat(dirTree);
        } else {
            allPaths.push(path);
        }
    }
    ui.loadingProgress(0, allPaths.length+" file(s) collected!", {consoleOnly:true, mode:'consoleOutput'});

    ui.loadingProgress(0, "Start importing data!", {consoleOnly:true, mode:'consoleOutput'});

    var processFile = function(filePath) {
        filePath = filePath||path;
        php.spawnSync("parseTrans.php", {
            args:{
                'path':filePath,
                prettyPrint:true
            },
            onDone : function(data) {

                if (Array.isArray(data.data)) {
                    trans.translateFromArray(data.data, columns, options);
                }
            }
        });
    }

    for (let i=0; i<allPaths.length; i++) {
        var thisFile = allPaths[i];
        ui.loadingProgress(Math.round(i/allPaths.length*100), "Importing : "+thisFile, {consoleOnly:true, mode:'consoleOutput'});
        processFile(thisFile);
        ui.loadingProgress(Math.round((i+1)/allPaths.length*100), "Done!", {consoleOnly:true, mode:'consoleOutput'});
    }

    trans.refreshGrid();
    trans.evalTranslationProgress();
    ui.loadingProgress("Done!", "All Done!", {consoleOnly:true, mode:'consoleOutput'});
    ui.loadingEnd();

}

 Trans.prototype.clearFooter = function() {
    $(".footer .footer1 span").html("")
    $(".footer .footer2 span").html("")
    $(".footer .footer3 span").html("")
    $(".footer .footer4 span").html("")
    $(".footer .footer5 span").html("")
}

 Trans.prototype.setStatusBarContext = function(row) {
    if (typeof row== 'undefined') {
        if (Array.isArray(trans.grid.getSelected())) row = trans.grid.getSelected()[0][0];
    }

    var currentId = trans.getSelectedId();
    try {
        if (trans.project.files[currentId].originalFormat == '> ANTI TES PATCH FILE VERSION 0.2' && this.project.parser !== "rmrgss") {

            $(".footer .footer1>span").html(trans.buildContextFromParameter(trans.project.files[currentId].parameters[row]));
        } else {

            $(".footer .footer1>span").html(trans.project.files[currentId].context[row].join("; "));
        }

        $(".footer .footer1>span").addClass("icon-th-2")
    }
    catch(err) {
        $(".footer .footer1>span").html("");
        $(".footer .footer1>span").removeClass("icon-th-2")

    }

    if (SceneGraph.isAvailable() && currentId && row !== undefined) {
        try {
            var sgInfo = SceneGraph.getRowSceneInfo(currentId, row);
            if (sgInfo && sgInfo.sceneId) {
                var sgScene = SceneGraph.getScene(sgInfo.sceneId);
                var sgParts = [];
                if (sgScene) sgParts.push(sgScene.label);
                if (sgInfo.speaker) sgParts.push("Speaker: " + sgInfo.speaker);
                var sgLinked = SceneGraph.getLinkedSceneIds(sgInfo.sceneId);
                if (sgLinked.length > 0) sgParts.push("→ calls " + sgLinked.length + " common event(s)");
                var sgCallers = SceneGraph.getCallerScenes(sgInfo.sceneId);
                if (sgCallers.length > 0) sgParts.push("← called from " + sgCallers.length + " location(s)");
                $(".footer .footer2>span").html('<span class="sceneInfo" title="' + sgParts.join(" | ").replace(/"/g, "&quot;") + '">' + sgParts.join(" · ") + "</span>");
            } else {
                $(".footer .footer2>span").html("");
            }
        } catch(sgErr) {
            $(".footer .footer2>span").html("");
        }
    } else {
        $(".footer .footer2>span").html("");
    }
}

 Trans.prototype.setStatusBarNumData = function() {
    if (typeof trans.project == 'undefined') return false;
    try {
        $(".footer .footer3 span").html("rows : "+trans.project.files[trans.getSelectedId()].data.length);
    }
    catch(err) {
        $(".footer .footer3 span").html("");
    }
}

 Trans.prototype.setStatusBarEngine= function() {
    if (typeof trans.project == 'undefined') return false;
    try {
        var parser = "";
        if (trans.project.parser) parser = `/<span title='parser'>${trans.project.parser}</span>`
        $(".footer .footer4 span").html(trans.project.gameEngine+parser);
    }
    catch(err) {
        $(".footer .footer4 span").html("");
    }
}

 Trans.prototype.setTrayIcon = function(type) {

    type = type || "slr";
        var $icon = $('<i class="icon trayIcon"></i>');
        $icon.addClass(type);
        $(".footer .footer5 span").html($icon);
}

 Trans.prototype.clearEditor = function() {
    const $cellText = $("#currentCellText");
    $cellText.val("");
    $cellText.prop("readonly", true);
    $cellText.data("column", null);
    $cellText.data("row", null);
    return true;
}

 Trans.prototype.clearCellInfo = function() {
    const $cellInfo = $("#currentCoordinate");
    $cellInfo.val("");
    return true;
}

Trans.prototype.setCellInfo = function(row, column) {
    const $cellInfo = $("#currentCoordinate");
    var drawedRow = row+1;
    var drawedCol = column+1;
    $cellInfo.val(drawedRow+","+drawedCol);
    trans.lastSelectedCell = [row, column];
}

Trans.prototype.drawCellEmblem = function() {
    const row = this.lastSelectedCell[0]
    const col = this.lastSelectedCell[1]
    $(".cellEmblems > i").addClass("hidden");
    if (col == this.keyColumn) return;

    $(".cellEmblems > .emblemComment").attr("title", "");
    if (this.isOrganicCell(row, col)) $(".cellEmblems > .emblemOrganic").removeClass("hidden")

    if (this.isVisitedCell(row, col)) {
        $(".cellEmblems > .emblemFootprint").removeClass("hidden")
    } else {
        $(".cellEmblems > .emblemFirstVisit").removeClass("hidden")
    }
    let comment = this.getCellComment(row, col);
    if (comment) {
        $(".cellEmblems > .emblemComment").removeClass("hidden")
        $(".cellEmblems > .emblemComment").attr("title", "<b>Cell comment:</b><br />"+comment);
    }
}

 Trans.prototype.connectData = function() {

    if (!this.getSelectedId()) return void 0;
    if (!this.project.files[this.getSelectedId()].data) return void 0;
    this.project.files[this.getSelectedId()].data = trans.data;
}

 Trans.prototype.isLastRow = function(row) {

    if (Boolean(trans.data) == false) {
        trans.data = [];
        trans.connectData();
    }

    row = row || 0;
    if (row == trans.data.length-1) return true;
    return false;
}

 Trans.prototype.getCurrentData = function() {
    return this.data;
}

 Trans.prototype.getTextFromLastSelected = function() {
    var data = this.getCurrentData();
    if (empty(this.lastSelectedCell)) return "";
    return data[this.lastSelectedCell[0]][this.lastSelectedCell[1]];

}

 Trans.prototype.textEditorSetValue = function(text, triggerEvent=false) {
    $("#currentCellText").val(text);
    ui.generateBackgroundNumber();
    if (triggerEvent) $("#currentCellText").trigger("change")
}

 Trans.prototype.doAfterSelection = function(row, column, row2, column2) {
    const $editor = $("#currentCellText");

    $editor.val(trans.data[row][column]);
    $editor.prop("readonly", false);

    var isLastRow = trans.isLastRow(row)
    if (column == 0) {
        if ( isLastRow == false) {
            $editor.prop("readonly", true);
        }
    }
    $editor.data("column", column);
    $editor.data("row", row);
    trans.setCellInfo(row, column);
    trans.setStatusBarContext(row);

    ui.generateBackgroundNumber($editor);
    if (typeof romaji !== 'undefined') {
        if (trans.config.loadRomaji == false ) return true;
        romaji.resolve(trans.data[row][0], $("#currentRomaji .text"));
    }

    $("#currentRomaji .header").text(this.getRowInfoText(row, true) || "");

    this.drawCellEmblem();

    if (this.getOption("gridInfo")?.isRuleActive && this.getOption("gridInfo")?.enableTrail) {
        if (this._cellInfoTrack) clearTimeout(this._cellInfoTrack);
        if (column != this.keyColumn && this.getText(row, column)) {
            this._cellInfoTrack = setTimeout(()=> {
                clearTimeout(this._cellInfoTrack);
                this._cellInfoTrack = undefined;

                this.cellInfo.set("v", 1, this.getSelectedId(), row, column);
                $(`table tbody td[data-coord="${row}-${column}"]`).addClass("viewed")
            }, 1000)
        }
    }

    const thisObj = this.getSelectedObject();
    thisObj.lastSelectedCell = [row, column];

    this.trigger("onAfterSelectCell",
        {
            fromRow:row, fromCol:column, toRow:row2, toCol:column2, isLastRow:isLastRow
        }
    );
}

 Trans.prototype.resetCurentCellEditor = function() {
    var $currentCellText = $("#currentCellText");
    $currentCellText.val("");
    $currentCellText.data("row", 0)
    $currentCellText.data("column", 0)
    trans.setCellInfo(0, 0);
    trans.setStatusBarContext(0);
    $("#currentRomaji .text").text("");
    $("#currentRomaji .header").text("");
}

 Trans.prototype.createFile = function(filename, dirname, options) {

    options = options || {};
    options.originalFormat     = options.originalFormat || ""
    options.type             = options.type || null

    var isValid = require('is-valid-path');
    dirname = dirname || "/"
    if (!isValid(filename)) {
        return {
            error:true,
            msg : filename+ " is not a valid object name"
        }
    }

    if (!isValid(dirname) && dirname !== "*") {
        return {
            error:true,
            msg : dirname+ " is not a valid directory name"
        }
    }

    var fullPath = nwPath.join("/", dirname, filename);
    var fileObj;

    if (this.getObjectById(fullPath)) {
        return {
            error:true,
            msg : fullPath+ " is already exist"
        }
    }

    if (dirname == "*") {

        fullPath = filename;
        options.type = options.type || "reference"
        fileObj = this.createFileData(fullPath, {
                originalFormat     : options.originalFormat || "SLR TRANSLATOR GENERATED TABLE",
                type            : options.type,
                dirname            : "*"
            });
    } else {
        fullPath = fullPath.replace(/\\/g, "/");
        fileObj = this.createFileData(fullPath, {
                originalFormat     : options.originalFormat,
                type            : options.type
            });
    }

    trans.project.files[fullPath] = fileObj;

    trans.addFileItem(fullPath, fileObj);
    this.evalTranslationProgress();
    ui.fileList.reIndex();
    ui.initFileSelectorDragSelect();
    return {}
}

 Trans.prototype.selectFile = function($element, options) {
    options = options||{};
    options.onDone = options.onDone||undefined;

    this.grid.deselectCell()
    if (typeof $element == "string") $element = $(".fileList [data-id="+common.escapeSelector($element)+"]");

    $element.closest(".tree").find("li").removeClass("selected");
    $element.closest("li").addClass("selected");
    var thisID = $element.closest("li").data("id");
    if (!thisID || !trans.project.files[thisID]) return;

    trans.project.selectedId     = thisID;
    trans.data                     = trans.project.files[thisID].data;

    trans.selectedData             = trans.project.files[thisID];

    trans.buildIndex();
    trans.clearCellInfo();
    trans.clearEditor();
    trans.setStatusBarNumData();
    trans.resetCurentCellEditor();

    if ($(".menu-button.addNote").hasClass("checked")) {
        ui.openFileNote();
    }
    $(".fileId").val(thisID);

    ui.disableGrid(false);
    ui.evalFileNoteIcon();
    this.trigger("objectSelected", thisID);
    this.ensureRowHeights();
    this.grid.loadData(trans.data);

    trans.loadComments();
    trans.renderGridInfo();
    trans.grid.scrollViewportTo(0, 0);

    return $element;

}

Trans.prototype.renderGridInfo = function() {

    let gridInfo = this.getOption("gridInfo") || {};
    if (gridInfo?.isRuleActive && gridInfo?.rowHeaderInfo) {
        let rowHeaderWidth = gridInfo.rowHeaderWidth||130
        trans.grid.updateSettings({
            rowHeaderWidth: rowHeaderWidth
        });
        $("#table").css("--row-header-width", rowHeaderWidth+"px")
    } else {
        trans.grid.updateSettings({
            rowHeaderWidth: null
        })
        $("#table").css("--row-header-width", "")
    }
}

 Trans.prototype.addFileGroup = function(dirname, fileObj) {
    var $group = $("#fileList [data-group='"+CSS.escape(dirname)+"']");

    if ($group.length < 1) {

        var hTemplate = $("<li class='group-header'  data-group='"+dirname+"'>"+dirname+"</li>");

        if ($("#fileList .fileListUl .group-header[data-group='*']").length > 0) {
            $("#fileList .fileListUl .group-header[data-group='*']").before(hTemplate);
        } else {
            $("#fileList .fileListUl").append(hTemplate);
        }
        return true;
    }
    return false;
}

 Trans.prototype.fileItemExist = function(file, fileObj) {
    if ($("#fileList [data-group='"+CSS.escape(fileObj.dirname)+"'][data-id='"+CSS.escape(file)+"']").length>0) {
        return true;
    }
    return false;
}

 Trans.prototype.drawFileStatus = function(files) {
    if (typeof files == "string") files = [files];
    var $container = $("#fileList");
    for (var i=0; i<files.length; i++) {
        (()=> {
            var thisFile     = files[i];
            var thisObj     = this.getObjectById(thisFile);
            var $li     = $container.find(`[data-id="${CSS.escape(files[i])}"]`);
            if ($li.length == 0) return;

            $li.removeClass("isCompleted");
            $li.removeClass("isRequireAttention");
            if (thisObj.isCompleted) $li.addClass("isCompleted");
            if (thisObj.isRequireAttention) $li.addClass("isRequireAttention");

            if ($li.data("noteTooltipIsActive")) {
                $li.tooltip("destroy");
                $li.data("noteTooltipIsActive", false);
            }

            var $markersWrapper = $li.find(".markers");
            $markersWrapper.empty();
            if (thisObj.note) {

                $markersWrapper.append($(`<span class="hidden"></span>`).text(thisObj.note))

                var $noteIcon = $(`<i class="icon-commenting"></i>`);
                $markersWrapper.append($noteIcon);

                if (thisObj.noteColor) $noteIcon.css("color", thisObj.noteColor);

                $li.tooltip({
                    content: function() {
                        var $tooltip = $("<div class='fileObjTooltipWindow'></div>");
                        if (thisObj.noteColor) {
                            $tooltip.css("border-left-color", thisObj.noteColor);
                            $tooltip.addClass("hasColor")
                        }
                        $tooltip.text(thisObj.note);
                        $tooltip.on("mouseenter", function() {
                            ui.fileObjectTooltip.open($tooltip.clone(), $li)
                        })
                        return $tooltip;
                    },
                    tooltipClass: "fileObjTooltipWrapper",
                    show: {
                        effect: "fade",
                        duration: 100
                    },
                    hide: {
                        effect: "none",
                        delay: 100
                    },
                    position: {
                        my: "left top",
                        at: "right+6 top-16",
                        of: $li
                    },
                    open: function( event, ui ) {

                    }
                });

                $li.data("noteTooltipIsActive", true);

            }
        })()
    }
}

 Trans.prototype.addFileItem = function(file, fileObj) {

        if (this.fileItemExist(file, fileObj)) return false;

        this.addFileGroup(fileObj.dirname);

        var $li = $("<li></li>");
        $li.append("<input type='checkbox' class='fileCheckbox' title='hold shift for bulk selection' />"+
            "<a href='#' class='filterable'><span class='filename'></span>"+
                "<span class='markers'></span>"+
                "<span class='percent' title='progress'></span>"+
                "<div class='progress' title='progress'></div>"+
            "</a>");
        $li.attr("title", file);
        $li.attr("data-group", fileObj.dirname);
        $li.find(".fileCheckbox").attr("value", file);
        $li.find(".filename").text(fileObj.filename);

        $li.addClass("data-selector");
        $li.data("id", file);
        $li.attr("data-id", file);

        $li.find("a").on("mousedown", function(e) {

            if( e.which == 2 ) {
                e.preventDefault();
                trans.clearSelection();
                return false;
            }
        });
        $li.find("a").on("dblclick", function(e) {

            var $thisCheckbox = $(this).closest("li").find(".fileCheckbox");
            $thisCheckbox.prop("checked", !$thisCheckbox.prop("checked")).trigger("change")

        });
        $li.find("a").on("click", function(e) {

            e.preventDefault();
            trans.selectFile($(this).closest("li"));
        });
        $li.find(".fileCheckbox").on("change", function() {
            if ($(this).prop("checked") == true) {
                trans.$lastCheckedFile = $(this);
                $(this).closest(".data-selector").addClass("hasCheck");
            } else {
                trans.$lastCheckedFile = undefined;
                $(this).closest(".data-selector").removeClass("hasCheck");
            }
        });
        $li.find(".fileCheckbox").on("mousedown", function(e) {
            if (!trans.$lastCheckedFile) return false;
            if (e.shiftKey) {

                var $checkBoxes = $(".fileList .fileCheckbox");
                var lastIndex = $checkBoxes.index(trans.$lastCheckedFile);
                var thisIndex = $checkBoxes.index(this);
                var chckFrom;
                var chckTo;
                if (lastIndex < thisIndex) {
                    chckFrom = lastIndex;
                    chckTo = thisIndex;
                } else {
                    chckFrom = thisIndex;
                    chckTo = lastIndex;
                }

                for (var i=chckFrom; i<chckTo; i++) {
                    $checkBoxes.eq(i).prop("checked", true).trigger("change");
                }

            }
        });

        $("#fileList [data-group='"+CSS.escape(fileObj.dirname)+"']").last().after($li);

}

 Trans.prototype.drawFileSelector = function() {
    if (typeof this.project.files == 'undefined') return false;
    $("#fileList .fileListUl").empty();

    for (var file in this.project.files) {
        this.addFileItem(file, this.project.files[file]);
    }
    this.drawFileStatus(this.getAllFiles());
    this.setStatusBarEngine();
    this.evalTranslationProgress();
    ui.fileList.reIndex();
    ui.initFileSelectorDragSelect();
    ui.enableButtons();
    this.renderGridInfo();
    var TranslationByContext = require("www/js/TranslationByContext.js");
    ui.translationByContext = new TranslationByContext();

    this.inProject = true;
    engines.current().triggerHandler('onLoadTrans', this, arguments);

    this.trigger('onLoadTrans');

}

 Trans.prototype.setMarkAsComplete = function(mark, files) {
    files = files || trans.getCheckedFiles();
    if (files.length < 1) files = trans.getAllFiles();
    for (var i=0; i<files.length; i++) {
        var thisFile = files[i];
        this.getObjectById(thisFile).isCompleted = mark;
    }
    this.drawFileStatus(files);
    return true;
}

 Trans.prototype.selectAll = function(filter, append) {
    filter = filter||[];
    append = append||false;
    if (typeof filter == 'string') filter = [filter];

    var $checkBoxes = $("#fileList .fileCheckbox");

    if (filter.length == 0) {
        $checkBoxes.each(function() {
            $(this).prop("checked", true).trigger("change");
        });
    } else {
        if (!append) $checkBoxes.prop("checked", false).trigger("change");
        $checkBoxes.each(function() {
            var $this = $(this);
            if (filter.includes($this.closest("li").data("id"))) $this.prop("checked", true).trigger("change");
        });
    }
}

 Trans.prototype.invertSelection = function() {
    var $checkBoxes = $("#fileList .fileCheckbox");
    $checkBoxes.each(function() {
        $(this).prop("checked", !$(this).prop("checked")).trigger("change");
    });
}

 Trans.prototype.clearSelection = function() {
    var $checkBoxes = $("#fileList .fileCheckbox");
    $checkBoxes.each(function() {
        $(this).prop("checked", false).trigger("change");
    });
}

 Trans.prototype.initFileNav = function() {

    try {
        if (typeof trans.project.files !=='undefined') {
            trans.fileListLoaded = true;
        } else {
            trans.fileListLoaded = false;
        }
    } catch (e) {
        trans.fileListLoaded = false;
    }

    if (trans.fileListLoaded == false) {
        trans.createProject({
            onAfterLoading:function() {
                trans.drawFileSelector();
            }
        });

        return false;
    } else {
        this.unInitFileNav();
        trans.drawFileSelector();
        this.onFileNavLoaded.call(this);

        this.trigger("transLoaded", this);
    }
}

 Trans.prototype.unInitFileNav = function() {
    $("#fileList .fileListUl").empty();
    ui.fileList.reIndex();
    this.onFileNavUnloaded.call(this);
    engines.handler('onUnloadTrans').apply(this, arguments);
    ui.ribbonMenu.clear();
    ui.disableButtons();

    this.trigger('onUnloadTrans')
}

 Trans.prototype.evalTranslationProgress = function(file, progressData) {

    file = file||[];
    var dataResult = progressData||trans.countTranslated(file)||{};

    for (var id in dataResult) {
        var fileSelector = $(".fileList [data-id="+common.escapeSelector(id)+"]");
        // Objects without any translatable rows are shown as "empty" instead
        // of a (misleading) 100% — they have nothing to translate at all.
        if ((dataResult[id].length||0) === 0) {
            fileSelector.find(".percent").addClass("empty").text(t("empty"));
            fileSelector.find(".progress").css("background", "linear-gradient(to right, #9e9e9e 0%,#9e9e9e 100%)");
        } else {
            fileSelector.find(".percent").removeClass("empty").text(Math.round(dataResult[id].percent));
            fileSelector.find(".progress").css("background", "linear-gradient(to right, #3159f9 0%,#3159f9 "+dataResult[id].percent+"%,#ff0004 "+dataResult[id].percent+"%,#ff0004 100%)");
        }
    }
}

 Trans.prototype.getStats = function(reset) {
    function countWords(str) {
        return str.trim().split(/\s+/).length;
    }
    var stats = {
        files : 0,
        folders: 0,
        progress: 0,
        words:0,
        characters:0,
        rows:0,
        rowTranslated:0,
        percent:0,
        organic:0
    }
    var fromCache = false;
    if (!this.project) return stats;
    if (!this.project.files) return stats;
    if (!reset) {
        if (this.project.stats) {
            fromCache = true;
            stats = this.project.stats;
        }
    }

    for (var i in this.project.files) {
        var thisObj = this.project.files[i];
        if (thisObj.originalFormat == "SLR TRANSLATOR GENERATED TABLE") continue;
        stats.files++;

        if (thisObj.progress) {
            stats.rows                 += thisObj.progress.length;
            stats.rowTranslated     += thisObj.progress.translated;
        }

        if (fromCache) continue;
        if (empty(thisObj.data)) continue;
        for (var row=0; row<thisObj.data.length; row++) {
            var thisRow = thisObj.data[row];
            if (empty(thisRow)) continue;
            if (!thisRow[this.keyColumn]) continue;
            stats.characters     += thisRow[this.keyColumn].length;
            stats.words         += countWords(thisRow[this.keyColumn]);

            var translator = this.cellInfo.getBestCellInfo(i, row, "t");
            if (translator == "HU") stats.organic++
        }
    }
    if (stats.rows > 0) stats.percent  = (stats.rowTranslated/stats.rows) * 100;
    stats.folders     = $(".fileList  .group-header").length - 1;
    stats.organicPercent = (stats.organic/stats.rowTranslated) *100;

    this.stats = stats;
    return stats;
}

Trans.prototype.setFileNoteColor = function(color, files) {
    files ||= this.getSelectedId();
    if (Array.isArray(files) == false) files = [files];
    for (let i in files) {
        let obj = this.getObjectById(files[i]);
        if (!color) {
            if (obj.noteColor) delete obj.noteColor;
            continue;
        }
        obj.noteColor = color;
    }

    this.drawFileStatus(files);
    ui.evalFileNoteIcon();
}

Trans.prototype.setFileNote = function(note, files) {
    files ||= this.getSelectedId();
    if (Array.isArray(files) == false) files = [files];
    for (let i in files) {
        let obj = this.getObjectById(files[i]);
        obj.note = note;
    }

    this.drawFileStatus(files);
    ui.evalFileNoteIcon();
    ui.fileList.reIndex();
}

 Trans.prototype.loadComments = function() {
    trans.grid.comment = trans.grid.comment||trans.grid.getPlugin('comments');
    var selectedObj = trans.getSelectedObject();
    if (!selectedObj) return false;
    if (typeof selectedObj.comments == 'undefined') return false;

    for (var row in selectedObj.comments) {
        for (var col in selectedObj.comments[row]) {

            trans.grid.comment.setCommentAtCell(parseInt(row), parseInt(col), selectedObj.comments[row][col]);
        }
    }
}

Trans.prototype.runCustomScript = async function(workspace, scriptPath, options) {

    options = options || {};
    var CodeRunner = require("www/js/CodeRunner.js")
    var codeRunner = new CodeRunner();
    var code = await common.fileGetContents(scriptPath);

    if (!code) return alert(("Error opening file :"+scriptPath))
    await ui.showBusyOverlay();
    await common.wait(200);
    try {
        var result = await codeRunner.run(code, workspace, options);
        if (result) alert(result);
    } catch (e) {
        alert("Error executing :"+nwPath.basename(scriptPath)+"\n"+e.toString());
    }
    await ui.hideBusyOverlay();
}

Trans.prototype.updateRunScriptMenu = function() {
    this.fileSelectorMenu = this.fileSelectorMenu || {};

    this.fileSelectorMenu.withSelected.items.runScript.items.forEachRowRun.items = {};
    var forEachRowRunItems = this.fileSelectorMenu.withSelected.items.runScript.items.forEachRowRun.items;
    var rowIteratorConfig = sys.getConfig("codeEditor/rowIterator");
    if (!rowIteratorConfig) {
        sys.setConfig("codeEditor/rowIterator", {quickLaunch:[]});

    }
    rowIteratorConfig ||= {}
    rowIteratorConfig.quickLaunch ||= [];
    for (let i=0; i<rowIteratorConfig["quickLaunch"].length; i++) {
        (()=>{
            var filePath = rowIteratorConfig["quickLaunch"][i];
            var filename = common.getFilename(filePath);
            var thisId = common.generateId()
            forEachRowRunItems[thisId] = {
                name: filename,
                callback: (key, opt) => {
                    var conf = confirm("Are you sure want to execute the following script?"+"\n"+filename);
                    if (!conf) return;
                    this.runCustomScript("rowIterator", filePath);
                }
            }
        })()
    }

    this.fileSelectorMenu.withSelected.items.runScript.items.forEachObjectRun.items = {};
    var forEachObjectRunItems = this.fileSelectorMenu.withSelected.items.runScript.items.forEachObjectRun.items;
    var objectIteratorConfig = sys.getConfig("codeEditor/objectIterator");
    if (!objectIteratorConfig) {
        sys.setConfig("codeEditor/objectIterator", {quickLaunch:[]});
        objectIteratorConfig = sys.getConfig("codeEditor/objectIterator");
    }
    objectIteratorConfig["quickLaunch"] = objectIteratorConfig["quickLaunch"] || [];

    for (let i=0; i<objectIteratorConfig["quickLaunch"].length; i++) {
        (()=>{
            var filePath = objectIteratorConfig["quickLaunch"][i];
            var filename = common.getFilename(filePath);
            var thisId = common.generateId()
            forEachObjectRunItems[thisId] = {
                name: filename,
                callback: (key, opt) => {
                    var conf = confirm("Are you sure want to execute the following script?"+"\n"+filename);
                    if (!conf) return;
                    this.runCustomScript("objectIterator", filePath);
                }
            }
        })()
    }

}

Trans.prototype.updateRunScriptGridMenu = function() {

    this.gridContextMenu.runAutomation.submenu = {
        items: []
    }
    var forEachCellRunItems = this.gridContextMenu.runAutomation.submenu.items;
    var cellSelectionConfig = sys.getConfig("codeEditor/gridSelection");
    if (!cellSelectionConfig) {
        sys.setConfig("codeEditor/gridSelection", {quickLaunch:[]});
        cellSelectionConfig = sys.getConfig("codeEditor/gridSelection");
    }
    cellSelectionConfig["quickLaunch"] = cellSelectionConfig["quickLaunch"] || [];

    for (var i=0; i<cellSelectionConfig["quickLaunch"].length; i++) {
        (()=>{
            var filePath = cellSelectionConfig["quickLaunch"][i];

            var filename = common.getFilename(filePath);
            var thisId = common.generateId()
            forEachCellRunItems.push({
                name: filename,
                key:"runAutomation:"+thisId,
                callback: (key, opt) => {
                    var conf = confirm("Are you sure want to execute the following script?"+"\n"+filename);
                    if (!conf) return;
                    this.runCustomScript("gridSelection", filePath);
                }
            })
        })()
    }
}

 Trans.prototype.fileSelectorContextMenuInit = function() {

    var trans = this;
    this.fileSelectorMenu = {
        "selectAllWithChanges" : {"name" : "Select all edited Objects (Always grabs split Objects)", icon:"context-menu-icon icon-check2-all"},
        "clearSelection" : {"name" : "Clear selection"},
        "selectAll" : {"name" : "Select all"},
        "selectCompleted" : {"name" : "Select 100%"},
        "selectIncompleted" : {"name" : "Select <100%"},
        "selectMarkedAsCompleted" : {"name" : "Select completed"},
        "invertSelection" : {"name" : "Invert selection"},
        "sep0": "---------",
        "markCompleteCurrent":{
            "name" : "Toggle mark as complete",
            icon: function() {
                return 'context-menu-icon icon-ok';
            }
        },
        "sep1": "---------",
        "withSelected": {
            name: () => {
                var checkedLength     = $(".fileCheckbox:checked").length;
                if (checkedLength == 0) {

                    trans.fileSelectorMenu.withSelected.icon = 'context-menu-icon icon-docs-1';
                    trans.fileSelectorMenu.withSelected.items.deleteFiles.visible = false;
                    return "With all";
                } else {
                    return "With " + checkedLength + " selected"
                }
            },
            icon: function() {
                return 'context-menu-icon icon-check';
            },
            items: {
                "markComplete": {
                    name : "Mark as complete",
                    icon: 'context-menu-icon icon-ok'
                },
                "unsetMarkComplete": {
                    name : "Un-mark as complete"
                },
                "sep0-0":"---------",
                "wrapText": {"name" : "Wrap texts"},
                "trim": {"name" : "Trim"},
                "padding": {"name" : "Auto padding"},
                "createScript": {
                    name : "Create Automation",
                    icon: 'context-menu-icon icon-code',
                    items: {
                        "forEachObject" : {"name": "For each object", icon: 'context-menu-icon icon-doc'},
                        "forEachRow" : {"name": "For each row",icon: 'context-menu-icon icon-menu-1'},
                    }
                },
                "runScript": {
                    name : "Run Automation",
                    icon: 'context-menu-icon icon-play',
                    items: {
                        "forEachObjectRun" : {
                            name: "For each object",
                            icon: 'context-menu-icon icon-doc',
                            items: {

                            }
                        },
                        "forEachRowRun" : {
                            name: ()=> {

                                return "For each row"
                            },
                            icon: 'context-menu-icon icon-menu-1',
                            items: {

                            }
                        },
                    }
                },
                "sep0-2":"---------",
                "import": {
                    name:"Import from...",
                    icon:"context-menu-icon icon-login",
                    items: {
                        "importFromSlrproj" : {"name": "SLR Project (.slrproj)",icon: 'context-menu-icon icon-file-archive'}
                    }
                },
                "export": {
                    name:"Export into...",
                    icon:"context-menu-icon icon-export",
                    items: {
                        "exportToGamePatch" : {"name": "A folder", icon:() => 'context-menu-icon icon-folder-add'},
                        "exportToGamePatchZip" : {"name": "Zipped Game Patch",icon:() => 'context-menu-icon icon-file-archive'}
                    }
                },
                "revert" : {
                    name: "Revert to original",
                    icon: "context-menu-icon icon-ccw"
                },
                "sep0-3":"---------",
                "clearTranslationSel": {"name" : "Clear translation", "icon":"context-menu-icon icon-eraser"},
                "deleteFiles": {"name" : "Delete files", "icon":"context-menu-icon icon-trash-empty"},

            }
        },
        "sep2": "---------",
        "properties": {
            name: "Properties",
            icon:'context-menu-icon icon-cog'
        }
    }

    if (trans.fileSelectorContextMenuIsInitialized) return false;
    $.contextMenu({
        selector: '.fileList .data-selector',
        events: {
            preShow : function($target, e) {

            },
            hide : function($target, e){

            }
        },
        build: function($triggerElement, e) {
            var thisCallback = function(key, options) {
                switch (key) {
                    case "selectAllWithChanges" :
                        trans.selectAll(trans.getAllChangedFiles())
                        break;
                    case "clearSelection" :
                        trans.clearSelection();
                        break;
                    case "selectAll" :
                        trans.selectAll();
                        break;
                    case "invertSelection" :
                        trans.invertSelection();
                        break;
                    case "selectCompleted" :
                        trans.selectAll(trans.getAllCompletedFiles())
                        break;
                    case "selectIncompleted" :
                        trans.selectAll(trans.getAllIncompletedFiles())
                        break;
                    case "selectMarkedAsCompleted" :
                        trans.selectAll(trans.getAllMarkedAsCompleted());
                        break;
                    case "markCompleteCurrent" :
                        var $elm = $("#fileList .context-menu-active");
                        var action = !$elm.hasClass("isCompleted");
                        var currentFile = $elm.data("id");
                        trans.setMarkAsComplete(action, [currentFile]);
                        break;
                    case "markComplete" :
                        trans.setMarkAsComplete(true);
                        break;
                    case "unsetMarkComplete" :
                        trans.setMarkAsComplete(false);
                        break;
                    case "forEachObject" :
                        ui.openAutomationEditor("codeEditor_objectIterator", {
                            workspace: "objectIterator"
                        });
                        break;
                    case "forEachRow" :
                        ui.openAutomationEditor("codeEditor_rowIterator", {
                            workspace: "rowIterator"
                        });
                    break;
                    case "clearTranslationSel" :
                        var confirmation = confirm("Do you want to clear translation?");
                        var selection = trans.getCheckedFiles();
                        if (confirmation) trans.removeAllTranslation(trans.getCheckedFiles(), {refreshGrid:true});
                        trans.evalTranslationProgress(selection);
                        break;
                    case "clearTranslationAll" :
                        var confirmation2 = confirm("Do you want to clear translation?");
                        var selection2 = trans.getAllFiles();
                        if (confirmation2) trans.removeAllTranslation(trans.getAllFiles(), {refreshGrid:true});
                        trans.evalTranslationProgress(selection2);
                        break;
                    case "deleteFiles" :
                        ui.deleteFiles();
                        break;
                    case "wrapText" :
                        ui.batchWrapingDialog();
                        break;
                    case "trim" :
                        ui.openTrimWindow();
                        break;
                    case "padding" :
                        ui.openPaddingWindow();
                        break;
                    case "properties" :
                        ui.openFileProperties();
                        break;

                    case "importFromSlrproj":
                        ui.openImportSlrprojDialog();
                        break;

                    case "exportToGamePatch":
                        $("#dialogExport").data("options", {files:trans.getCheckedFiles()});
                        $("#exportDir").trigger("click");
                        break;
                    case "exportToGamePatchZip":
                        $("#dialogExport").data("options", {files:trans.getCheckedFiles()});
                        $("#export").trigger("click");
                        break;
                    case "revert":
                        trans.revertToOriginal();
                        break;
                    default :

                }
            }

            trans.updateRunScriptMenu()

            return {
                zIndex    :1000,
                callback: thisCallback,
                items    : trans.fileSelectorMenu
            }
        }
    });

    trans.fileSelectorContextMenuIsInitialized = true;

}

 Trans.prototype.gridBodyContextMenu = function() {
    $.contextMenu({
        selector: '.ht_master .htCore tbody, .ht_clone_left .htCore tbody',
        events: {
            preShow : function($target, e) {

                var cTarget = $(e.target);

                if (cTarget.hasClass("highlight")) {

                }

            },
            show : function($target, e){

                trans.grid.lastContextMenuCellRange = trans.grid.getSelectedRange();
            },
            hide : function($target, e){

                if (typeof trans.grid.lastContextMenuCellRange == "undefined") return false;
                trans.grid.selectCells(trans.grid.lastContextMenuCellRange);

            }
        },
        build: function($triggerElement, e) {
            var thisCallback = function(key, options) {
                switch (key) {
                    case "addComment" :
                        var thisCoord= undefined;
                        try  {
                            thisCoord = trans.grid.lastContextMenuCellRange[0]['highlight']
                        } catch (error) {

                        }
                        trans.editNoteAtCell(thisCoord);
                        break;
                    case "removeComment" :

                        trans.removeNoteAtSelected(trans.grid.lastContextMenuCellRange);
                        break;
                    default :

                }
            }
            return {
                zIndex:1000,
                callback: thisCallback,
                items: {
                    "addComment": {name: "Add comment", icon: function(){
                        return 'context-menu-icon icon-commenting-o';
                    }},
                    "removeComment": {name: "Remove comment", icon: function(){
                        return 'context-menu-icon icon-comment-empty';
                    }},
                    "selectAll" : {"name" : "Select all"},
                    "invertSelection" : {"name" : "Invert selection"},
                    "sep0": "---------",

                    "withSelected": {
                        name: "With all",
                        items: {
                            "wordWrap": {"name" : "Wrap texts"}
                        }
                    }

                }
            }

        }
    });

}

 Trans.prototype.evalContextsQuery = function() {
    if (arguments.length == 0) return false;

    var result = [];
    for (var i=0; i<arguments.length; i++) {
        if (typeof arguments[i] == "string") {
            if (arguments[i].length == 0) continue;
            var thisA = arguments[i].split("\n").map(function(input) {
                return common.stripCarriageReturn(input);
            });
            result = result.concat(thisA);
        } else if (Array.isArray(arguments[i])) {
            if (arguments[i].length == 0) continue;
            result = result.concat(arguments[i]);
        }
    }

    return result;
}

 Trans.prototype.isInContext = function(file, row, context) {
    context = context||[];
    if (context.length == 0) return true;

    if (typeof context == 'string') context = [context];

    if (typeof trans.project.files[file] == 'undefined') return false;
    if (typeof trans.project.files[file].context[row] == 'undefined') return false;

    var thisContextS = trans.project.files[file].context[row];
    if (Array.isArray(thisContextS) == false) thisContextS = [thisContextS];

    if (thisContextS.length < 1) {

        if (typeof trans.project.files[file].parameters[row] != 'undefined')  {
            thisContextS = [trans.buildContextFromParameter(trans.project.files[file].parameters[row])];
        }

    }

    var contextStr = thisContextS.join("\n");

    for (var i=0; i<context.length; i++) {
        contextStr = contextStr.toLowerCase();
        if (contextStr.indexOf(context[i].toLowerCase()) != -1) return true;
    }

    return false;
}

 Trans.prototype.removeRowByContext = function(files, contexts, options, whitelist) {

    options=options||{};
    options.matchAll = options.matchAll||false;

    var collection = trans.travelContext(files, contexts, {
        onMatch:function(file, row) {

        },
        matchAll:options.matchAll
    });

    for (var file in collection) {
        for (var row=collection[file].length-1; row>=0; row--) {
            if ((collection[file][row] == true && whitelist !== true) || (collection[file][row] != true && whitelist === true)) {

                trans.removeRow(file, row);

            }
        }
    }

    trans.refreshGrid();
}

 Trans.prototype.collectContextKeyword = function(obj, files, options) {
    files = files||[];
    obj = obj||trans.project;

    if (typeof obj == 'undefined') return false;

    if (typeof files == "string") files = [files];
    if (files.length < 1) {
        for (let file in trans.project.files) {
            files.push(file);
        }
    }

    var collection = {};
    for (let i=0; i<files.length; i++) {
        let file = files[i];
        var thisData = obj.files[file].context;
        for (var contextId=0; contextId<thisData.length; contextId++) {
            if (Array.isArray(thisData[contextId]) == false) continue;
            for (var y=0; y<thisData[contextId].length; y++) {
                var contextString = thisData[contextId][y]||"";
                var contextPart = contextString.split("/");
                for (var x=0; x<contextPart.length; x++) {
                    if (isNaN(contextPart[x])) {
                        collection[contextPart[x]] = collection[contextPart[x]]||0;
                        collection[contextPart[x]] += 1;
                    }
                }
            }
        }
    }
    return collection;
}

 Trans.prototype.travelContext = function(files, contexts, options) {

    files         = files||[];
    contexts     = contexts||[];
    options             = options||{};
    options.onMatch     = options.onMatch||function(){};
    options.onNotMatch     = options.onNotMatch||function(){};
    options.matchAll     = options.matchAll||false;

    if (typeof files == "string") files = [files];
    if (Array.isArray(contexts) == false) contexts = [contexts];

    if (files.length < 1) {
        for (let file in trans.project.files) {
            files.push(file);
        }
    }

    var collection = {};
    for (let i=0; i<files.length; i++) {
        let file = files[i];
        collection[file] = [];

        for (let rowId=0; rowId<trans.project.files[file].context.length; rowId++) {
            var thisContextS = trans.project.files[file].context[rowId];
            if (Array.isArray(thisContextS) == false) thisContextS = [thisContextS];
            collection[file][rowId] = false;
            if (thisContextS.length < 1) {

                if (!trans.project.files[file].parameters[rowId]) continue;
                thisContextS = [trans.buildContextFromParameter(trans.project.files[file].parameters[rowId])];

            }

            for (var y=0; y<thisContextS.length; y++) {
                var thisContext = thisContextS[y];

                for (var x=0; x<contexts.length; x++) {

                    if (options.matchAll) {
                        if (common.matchAllWords(thisContext, contexts[x])) {
                            collection[file][rowId] = true;
                        }
                    } else {

                        if (thisContext.toLowerCase().indexOf(contexts[x].toLowerCase()) >= 0) {

                            collection[file][rowId] = true;

                        } else {

                        }
                    }

                }
            }
        }

        for (let rowId=0; rowId<collection[file].length; rowId++) {
            if (collection[file][rowId] == true) {
                options.onMatch.call(trans.project.files[file], file, rowId);
            } else {
                options.onNotMatch.call(trans.project.files[file], file, rowId);
            }
        }
    }

    return collection;
}

Trans.prototype.isOrganicCell = function(row, col, file) {
    if (!this.project) return false;
    file ||= this.getSelectedId();
    var cellInfo = this.cellInfo.getCell(file, row, col);
    if (cellInfo?.t == "HU") return true;
    return false;
}

Trans.prototype.isVisitedCell = function(row, col, file) {
    if (!this.project) return false;
    file ||= this.getSelectedId();
    return Boolean(this.cellInfo.get("v", file, row, col));
}

 Trans.prototype.getData = function(file) {
    if (typeof file == 'undefined') return this.getCurrentData();
    if (typeof file == "string") return this.getObjectById(file).data;
    if (typeof file == 'object') {
        if (Array.isArray(file.data)) return file.data;
    }

    return [];
}

 Trans.prototype.addRow = function(file, keyString, defaultTranslation) {
    var thisObj
    if (typeof file == "object") {
        thisObj = file;
    } else {
        file = file || this.getSelectedId();
        thisObj = this.getObjectById(file);
    }
    thisObj.indexIds ||= {};

    if (typeof keyString !== "string") return -1;
    if (!keyString) return -1;
    const existingIndex = this.getIndexByKey(thisObj, keyString);

    if (typeof existingIndex !== "undefined") return existingIndex;
    var newRow = Array(trans.colHeaders.length).fill(null);
    newRow[this.keyColumn] = keyString;
    if (defaultTranslation) newRow[1] = defaultTranslation;

    var theData = trans.getData(thisObj);

    if (empty(theData[theData.length - 1][0])) {

        let thisIndex = theData.length - 1
        theData[thisIndex] = newRow;
        thisObj.indexIds[keyString] = thisIndex;
        return thisIndex;
    } else {
        var newKey = theData.push(newRow);
        thisObj.indexIds[keyString] = newKey -1;
        return newKey;
    }

}

 Trans.prototype.getIndexIds = function(file) {
    if (typeof file == 'undefined') file = this.getSelectedId();
    var theObject;
    if (typeof file == "string") {
        theObject = this.getObjectById(file);
        if (!theObject) return {}
        if (!theObject.indexIsBuilt) this.buildIndex(file);
        return theObject.indexIds;
    } else if (typeof file == 'object') {
        theObject = file;
        if (!theObject.indexIsBuilt) theObject = this.buildIndexFromData(theObject);
        return theObject.indexIds;
    }

    return {};
}

 Trans.prototype.getIndexByKey = function(file, keyString) {
    return this.getIndexIds(file)[keyString];
}

 Trans.prototype.isAllSelected = function() {
    if (trans.getCheckedFiles().length == Object.keys(trans.project.files).length) return true;
    return false;
}

 Trans.prototype.getActiveTranslator = function() {
    if (!trans.project) return sys.config?.translator;
    trans.project.options = trans?.project.options || {};
    return trans.project?.options?.translator || sys.config.translator;
}

 Trans.prototype.wordWrapFiles = function(files, col, targetCol, options) {

    files = files||[];
    if (typeof files == 'string') files = [files];

    if (files.length == 0 ) files = this.getAllFiles();

    col = col||1;
    targetCol = targetCol||col+1;
    if (targetCol == 0) return trans.alert("Can not modify Column 0");

    options = options||{};
    options.maxLength     = options.maxLength||41;
    options.onDone         = options.onDone||function() {};
    options.context     = options.context||[]

    for (var id=0; id<files.length; id++) {
        var file = files[id];

        if (typeof trans.project.files[file] == 'undefined') continue;
        options.lineBreak = options.lineBreak||trans.project.files[file].lineBreak||"\n";

        var thisData = trans.project.files[file].data;

        for (var row=0; row<thisData.length; row++) {
            if (!trans.isInContext(file, row, options.context)) continue;
            if (typeof thisData[row][col] !== 'string') {
                thisData[row][targetCol] = thisData[row][col];
            }

            thisData[row][targetCol] = common.wordwrap(thisData[row][col], options.maxLength,options.lineBreak);
        }
    }

    options.onDone.call(trans);

}

 Trans.prototype.fillEmptyLine = function(files, rows, targetCol, sourceCol, options) {

    files = files||[];
    if (typeof files == 'string') files = [files];
    options = options||{};
    options.project     = options.project||trans.project;
    options.keyColumn     = options.keyColumn||0;
    options.lineFilter     = options.lineFilter|| function() {return true};
    options.fromKeyOnly    = options.fromKeyOnly || false;
    options.filterTag     = options.filterTag || [];
    options.overwrite    = options.overwrite || false;

    if (options.fromKeyOnly) {

        options.sourceCol  = sourceCol||options.keyColumn;
    }

    rows = rows||[];
    if (typeof rows == 'number') rows = [rows];

    if (files.length == 0) files = trans.getAllFiles();

    for (var index=0; index<files.length; index++) {
        let file = files[index];

        if (rows.length > 0) {

        } else {
            var thisData = options.project.files[file].data;
            for (var row=0; row<thisData.length; row++) {

                if (options.filterTagMode == "blacklist") {
                    if (this.hasTags(options.filterTag, row, file)) continue;
                } else if (options.filterTagMode == "whitelist") {
                    if (!this.hasTags(options.filterTag, row, file)) continue;
                }

                if (typeof targetCol == 'undefined') {
                    targetCol = trans.getTranslationColFromRow(thisData[row]);
                    if (targetCol == null) continue;
                }

                if (options.overwrite == false) {
                    if (thisData[row][targetCol]) continue;
                }

                options.project.files[file].data[row][targetCol] = trans.getTranslationByLine(thisData[row], options.keyColumn, {
                    includeIndex    :true,
                    priorityCol        :targetCol,
                    onBeforeLineAdd    :options.lineFilter,
                    sourceCol        :options.sourceCol
                });

            }
        }
    }

}

 Trans.prototype.trimTranslation = function(files, columns, options) {

    if (!trans.project) return false;
    files = files||trans.getSelectedId();
    options = options||{};
    options.refreshGrid = options.refreshGrid||false;

    if (Array.isArray(files) == false) files = [files];
    if (Array.isArray(columns) == false) columns = [columns];

    for (var i=0; i<files.length; i++) {
        var file = files[i];

        var thisData = trans.project.files[file].data;

        var originalLineBreak = trans.project.files[file].lineBreak||"\n";
        var thisLineBreak = "\n";
        for (var row=0; row<thisData.length; row++) {

            for (var colID in columns) {
                var col = columns[colID];

                if (col < 1) continue;
                if (typeof trans.project.files[file].data[row][col] !== 'string') continue;
                var lines = trans.project.files[file].data[row][col].split(thisLineBreak);
                var newLines = lines.map(function(thisVal) {

                    return thisVal.trim();
                });
                trans.project.files[file].data[row][col] = newLines.join(originalLineBreak);
            }
        }
    }

        trans.refreshGrid();

}

 Trans.prototype.paddingTranslation = function(files, columns, options) {

    if (!trans.project) return false;
    files = files||trans.getSelectedId();
    options                                = options||{};
    options.keyId                         = options.keyId||0;
    options.includeInitialWhitespace     = options.includeInitialWhitespace||false;
    options.refreshGrid                 = options.refreshGrid||false;

    if (Array.isArray(files) == false) files = [files];
    if (Array.isArray(columns) == false) columns = [columns];

    var whiteSpaces = /^[\s\u0009\u200b\u180e\u2060]+/g

    for (var i=0; i<files.length; i++) {
        var file = files[i];
        var thisData = trans.project.files[file].data;
        var thisLineBreak = trans.project.files[file].lineBreak||"\n";
        for (var row=0; row<thisData.length; row++) {
            if (typeof trans.project.files[file].data[row][options.keyId] !== 'string') continue;
            var keys = trans.project.files[file].data[row][options.keyId].split(thisLineBreak);
            var leftWhiteSpaces = [];
            for (var keysID=0; keysID<keys.length; keysID++) {
                var thisLeftWS = keys[keysID].match(whiteSpaces);
                if (Boolean(thisLeftWS) == false) thisLeftWS = "";
                leftWhiteSpaces.push(thisLeftWS);
            }

            for (var colID in columns) {
                var col = columns[colID];
                if (col < 1) continue;
                if (typeof trans.project.files[file].data[row][col] !== 'string') continue;

                var lines = trans.project.files[file].data[row][col].split(thisLineBreak);
                var newLines = [];

                for (var linePartId=0; linePartId<lines.length; linePartId++) {
                    var thisWhitespace = leftWhiteSpaces[linePartId]||"";
                    if (options.includeInitialWhitespace) {
                        newLines.push(thisWhitespace+lines[linePartId]);
                    } else {
                        newLines.push(thisWhitespace+lines[linePartId].trim());
                    }
                }

                trans.project.files[file].data[row][col] = newLines.join(thisLineBreak);
            }
        }
    }

        trans.refreshGrid();

}

 Trans.prototype.removeAllTranslation = function(files, options) {
    if (!trans.project) return false;
    files = files||trans.getSelectedId();
    options = options||{};
    options.refreshGrid = options.refreshGrid||false;

    if (Array.isArray(files) == false) files = [files];

    for (var i=0; i<files.length; i++) {
        var file = files[i];
        var thisData = trans.project.files[file].data;
        for (var row=0; row<thisData.length; row++) {
            for (var col=1; col<thisData[row].length; col++) {
                trans.project.files[file].data[row][col] = null;
            }
        }
    }

    this.trigger("removeAllTranslation", {files:files, options:options});
    if (options.refreshGrid) {
        trans.refreshGrid();
    }
}

 Trans.prototype.deleteFile = function(files, options) {
    if (!trans.project) return false;
    files = files||trans.getSelectedId();
    options = options||{};

    if (Array.isArray(files) == false) files = [files];

    if (files.length < 1) return true;

    for (var i=0; i<files.length; i++) {

        var file = files[i];

        if (trans.project.files[file].type == 'reference') {
            alert("Unable to delete table : "+file);
            continue;
        }

        if (file == trans.getSelectedId()) {
            ui.disableGrid(true);
        }

        var bak = JSON.parse(JSON.stringify(trans.project.files[file]));
        trans.project.trash = trans.project.trash||{};
        trans.project.trash[file] = bak;

        $(".panel-left .fileList [data-id="+common.escapeSelector(file)+"]").remove();
        delete trans.project.files[file];
    }
    ui.fileList.reIndex();

    this.trigger("afterDeleteFile", [files]);
}

Trans.prototype.stagingFilesRemove = async function(files) {
    if (!Array.isArray(files)) files = [files];
    var stagingPath = this.getStagingPath();
    if (!stagingPath) return [];
    var result = []
    for (var i in files) {
        var fileToRemove = nwPath.join(stagingPath, "data", files[i]);

        if (!await common.isFileAsync(fileToRemove)) void 0;
        result.push(await common.unlink(files[i]));
    }
    return result;
}

 Trans.prototype.removeRow = function(file, rows, options) {

    if (typeof file == 'undefined') return false;
    if (typeof rows == 'undefined') return false;
    if (rows === 0) rows = [0];
    rows = rows||[];
    options = options||{};
    if (Array.isArray(rows) == false) rows = [rows];
    options.permanent     = options.permanent||false;
    options.refreshGrid = options.refreshGrid||false;

    rows = common.arrayUnique(rows);

    rows.sort(function(a, b) {
        return b - a;
    });

    for (var i=0; i<rows.length; i++) {
        var thisRow = rows[i];
        if (typeof trans.project.files[file].data[thisRow] == 'undefined') continue;
        trans.project.files[file].data.splice(thisRow, 1);
        if (trans.project.files[file].parameters) trans.project.files[file].parameters.splice(thisRow, 1);
        if (trans.project.files[file].context) trans.project.files[file].context.splice(thisRow, 1);
        if (trans.project.files[file].tags) trans.project.files[file].tags.splice(thisRow, 1);

        this.cellInfo.deleteRow(file, thisRow);

        var comments = this.getObjectById(file).comments;
        if (empty(comments)) continue;
        if (Array.isArray(comments)) {
            comments.splice(thisRow, 1);
        } else {
            delete comments[thisRow];
        }

    }

    if (rows.length > 0) trans.project.files[file].indexIsBuilt = false;

    this.trigger("afterRemoveRow", {file:file, rows:rows, options:options});

    if (options.refreshGrid) {
        trans.refreshGrid();
    }
}

Trans.prototype.clearRow = function(file, rows, options={}) {
    if (typeof file == "string") file = trans.getObjectById(file);
    if (!file) return;
    if (!(typeof file == "object" && Array.isArray(file.data))) return void 0;

    if (!Array.isArray(rows)) rows = [rows];
    options ||= {};
    var affectedRows = 0;
    for (var rowId=0; rowId<rows.length; rowId++) {
        var row = file.data[rows[rowId]];
        for (var colId=0; colId<row.length; colId++) {
            if (colId == this.keyColumn) continue;
            row[colId] = "";
            affectedRows++;
        }
    }
    return affectedRows;
}

 Trans.prototype.removeColumn = function(column, options) {
    if (column === 0) return trans.alert("Can not remove key column!");
    options = options||{};
    options.permanent = options.permanent||false;
    options.refreshGrid = options.refreshGrid||false;
    if(typeof trans.project == "undefined") return trans.alert("Please open or create a project first");

    for (var file in trans.project.files) {
        if(Array.isArray(trans.project.files[file].data) == false) continue;
        if(trans.project.files[file].data.length == 0) continue;
        for (var row=0; row< trans.project.files[file].data.length; row++) {
            trans.project.files[file].data[row].splice(column, 1);

            this.cellInfo.deleteCell(file, row, column);
        }
    }

    trans.colHeaders.splice(column, 1);
    trans.columns.splice(column, 1);

    if (options.refreshGrid) {
        trans.refreshGrid();
    }
}

 Trans.prototype.renameColumn = function(column, newName, options) {
    if (column === 0) return trans.alert("Can not set column name to blank!");
    options = options||{};
    options.refreshGrid = options.refreshGrid||false;

    if (typeof trans.colHeaders[column] == 'undefined') return false;
    trans.colHeaders[column] = newName;

    if (options.refreshGrid) {
        trans.refreshGrid();
    }

}

Trans.prototype.rowHasMultipleContext = function(row, obj) {
    obj = obj || this.getSelectedObject();
    if (!row) false;
    if (!obj.context) return false;
    if (!obj.context[row]) return false;
    if (obj.context[row].length <= 1) return false;
    return true;
}

 Trans.prototype.isTranslatedRow = function(row, data) {
    data = data||trans.data;
    for (var col=1; col < data[row].length; col++) {
        var thisCell = data[row][col]||"";
        if (thisCell.length > 0) return true;
    }
    return false;
}

 Trans.prototype.countFilledCol = function(row, data) {

    data = data||trans.data;
    var result = 0;
    for (var col=1; col < data[row].length; col++) {
        var thisCell = data[row][col]||"";
        if (thisCell.length > 0) result++;
    }
    return result;
}

 Trans.prototype.getTranslationFromRow = function(row, keyColumn, skipRows=[]) {

    skipRows ||= []
    if (Array.isArray(row) == false) return false;
    keyColumn = keyColumn||0;
    if (keyColumn == 0) {
        for (let n=row.length; n>0; n--) {
            if (skipRows.includes(n)) continue;
            if (row[n]) {
                return row[n];
            }
        }
    } else {
        for (let n=row.length; n>=0; n--) {
            if (n == keyColumn) continue;
            if (skipRows.includes(n)) continue;
            if (row[n]) {
                return row[n];
            }
        }
    }
    return null;
}

 Trans.prototype.getTranslationColFromRow = function(row, keyColumn) {
    if (Array.isArray(row) == false) return false;
    keyColumn = keyColumn||0;
    if (keyColumn == 0) {
        for (let n=row.length; n>keyColumn; n--) {
            if (row[n]) {
                return n;
            }
        }
    } else {
        for (let n=row.length; n>=0; n--) {
            if (n == keyColumn) continue;
            if (row[n]) {
                return n;
            }
        }
    }
    return null;
}

 Trans.prototype.getTranslationByLine = function(row, keyColumn, options) {

    if (Array.isArray(row) == false) return false;

    keyColumn                 = 0;
    options                 = options||{};
    options.includeIndex     = options.includeIndex||false;
    options.lineBreak         = options.lineBreak||"\n";
    options.onBeforeLineAdd = options.onBeforeLineAdd||function() {return true};

    var resultArray = [];

    if (typeof options.sourceCol != 'undefined') {
        let thisCell = row[options.sourceCol]||"";

        let thisCellPart = thisCell.split("\n").map(function(input){
                                return common.stripCarriageReturn(input);
                            });
        for (let part=0; part<thisCellPart.length; part++) {
            if (Boolean(thisCellPart[part]) == false) continue;
            if (!options.onBeforeLineAdd(thisCellPart[part])) continue;
            resultArray[part] = thisCellPart[part];
        }
    } else {
        for (let col=0; col<row.length; col++) {
            if (col == keyColumn) continue;

            if (typeof options.priorityCol !=='undefined') {
                if (col == options.priorityCol) continue;
            }

            let thisCell = row[col]||"";
            let thisCellPart = thisCell.split("\n").map(function(input){
                                    return common.stripCarriageReturn(input);
                                });
            for (let part=0; part<thisCellPart.length; part++) {
                if (Boolean(thisCellPart[part]) == false) continue;
                if (!options.onBeforeLineAdd(thisCellPart[part])) continue;

                resultArray[part] = thisCellPart[part];
            }
        }
    }

    if (options.includeIndex) {
        let thisCell = row[keyColumn]||"";

        let thisCellPart = thisCell.split("\n").map(function(input){
                                return common.stripCarriageReturn(input);
                            });
        for (let part=0; part<thisCellPart.length; part++) {
            if (Boolean(thisCellPart[part]) == false) continue;
            if (!options.onBeforeLineAdd(thisCellPart[part])) continue;

            resultArray[part] = thisCellPart[part];
        }

    }

    if (typeof options.priorityCol !== 'undefined') {

        var thisCell = row[options.priorityCol]||"";

        var thisCellPart = thisCell.split("\n").map(function(input){
                                return common.stripCarriageReturn(input);
                            });
        for (var part=0; part<thisCellPart.length; part++) {
            if (Boolean(thisCellPart[part]) == false) continue;

            resultArray[part] = thisCellPart[part];
        }
    }

    return resultArray.join(options.lineBreak);

}

 Trans.prototype.generateTranslationPair = function(data, translationCol) {
    translationCol = translationCol || 0;
    if (Array.isArray(data) == false) return {};
    var result = {};
    for (var rowId=0; rowId<data.length; rowId++) {
        if (Boolean(data[rowId][0]) == false) continue;
        var translation = trans.getTranslationFromRow(data[rowId], translationCol);
        if (translation == null) continue;
        result[data[rowId][0]] = translation;
    }
    return result;

}

 Trans.prototype.countTranslated = function(file) {
    file = file||[];
    if (typeof file == 'string') {
        file=[file];
    }

    if (file.length == 0) file = this.getAllFiles()

    var result = {};
    for (var i=0; i<file.length; i++) {
        var thisData = this.project.files[file[i]].data;

        result[file[i]] = {
            translated    :0,
            length        :0,
            percent        :100
        };

        for (var row=0; row<thisData.length; row++) {
            if (Boolean(thisData[row][this.keyColumn]) == false) continue;
            thisData[row][this.keyColumn] = thisData[row][this.keyColumn]||"";

            thisData[row][this.keyColumn] = thisData[row][this.keyColumn]+""

            if (this.rowByRowMode) {

                try {
                    var thisKeyCount = thisData[row][0].split("\n").length;
                } catch (e) {

                    throw(e)
                }

                for (var col=1; col<thisData[row].length; col++) {
                    if (Boolean(thisData[row][col]) == false) continue;

                    if (typeof(thisData[row][col]) !== 'string') thisData[row][col] = thisData[row][col]+'';
                    thisData[row][col] = thisData[row][col]||"";
                    var thisColCount = thisData[row][col].split("\n").length;

                    if (thisColCount>=thisKeyCount) {
                        result[file[i]].translated ++;
                        break;
                    }
                }
            } else {
                if (this.rowHasTranslation(thisData[row], this.keyColumn)) result[file[i]].translated++;
            }

            result[file[i]].length++;

        }
        if (result[file[i]].length > 0) result[file[i]].percent = result[file[i]].translated/result[file[i]].length*100;
        if (result[file[i]].percent > 100) result[file[i]].percent = 100;
        if (result[file[i]].percent < 0) result[file[i]].percent = 0;
        this.project.files[file[i]].progress = result[file[i]];
    }

    return result;
}

 Trans.prototype.resetIndex = function(hardReset) {
    hardReset = hardReset || false;
    for (var id in this.project.files) {
        this.project.files[id].indexIsBuilt = false;
    }
}

 Trans.prototype.buildIndex = function(fileId, rebuild, keyColumn) {

    fileId = fileId||trans.getSelectedId();
    keyColumn = keyColumn || trans.keyColumn || 0;

    if (fileId) {
        var currentObject = trans.project.files[fileId];
        if (currentObject.indexIsBuilt && rebuild !== true) return currentObject.indexIds;

        var result = {};
        for (let i=0; i<currentObject.data.length; i++) {

            if (typeof currentObject.data[i] == 'undefined') continue;
            if (currentObject.data[i][keyColumn] == null || currentObject.data[i][keyColumn] == '' || typeof currentObject.data[i][keyColumn] == 'undefined') continue;
            result[currentObject.data[i][keyColumn]] = i;
        }
        currentObject.indexIds         = result;
        currentObject.indexIsBuilt     = true;

        if (fileId == trans.getSelectedId()) {
            trans.indexIds         = currentObject.indexIds;
            trans.indexIsBuilt     = currentObject.indexIsBuilt;
        }
        return result;
    } else {
        if (trans.indexIsBuilt && rebuild !== true) return trans.indexIds;

        for (let i=0; i<trans.data.length; i++) {
            if (typeof trans.data[i] == 'undefined') continue;
            if (trans.data[i][keyColumn] == null || trans.data[i][keyColumn] == '' || typeof trans.data[i][keyColumn] == 'undefined') continue;
            trans.indexIds[trans.data[i][keyColumn]] = i;
        }
        trans.indexIsBuilt = true;
        return trans.indexIds;
    }
}

Trans.prototype.buildIndexes = function(files, lineByLine=false, options={}) {
    options ||= {};
    options.customFilter;
    options.indexId ||= "";

    this.customIndexes ||= {};
    if (typeof options.customFilter == "function") {

        try {
            if (typeof options.customFilter("test") !== "string") return void 0
        } catch (e) {
            return void 0
        }
        options.indexId = "#auto.fn."+common.crc32String(options.customFilter.toString());
    }

    if (options.indexId) {
        this.customIndexes[options.indexId] = {}
    }

    if (typeof files == "string") files = [files];
    files = files || [];
    if (files.length == 0) {
        files = this.getAllFiles();
    }

    var result = {};

    if (lineByLine) {
        for (let i=0; i<files.length; i++) {
            let thisObj = this.getObjectById(files[i]);
            if (!thisObj) continue;
            if (!thisObj.indexIsBuilt) this.buildIndex(files[i]);
            let thisIndexIds = this.getObjectById(files[i]).indexIds;
            for (var keyText in thisIndexIds) {
                var keys = keyText.replaceAll("\r", "").split("\n");
                for (var line=0; line<keys.length;line++) {
                    let key = keys[line];
                    if (typeof options.customFilter == "function") key = options.customFilter(key);
                    result[key] = result[key] || [];
                    result[key].push({
                        file    :files[i],
                        row        :thisIndexIds[keyText],
                        line    :line
                    })
                }

            }
        }

        if (options.indexId) {
            this.customIndexes[options.indexId] = result;
        } else {
            this._tempIndexes = result;
        }

        return result;
    }

    for (let i=0; i<files.length; i++) {

        let thisObj = this.getObjectById(files[i]);

        if (!thisObj) continue;
        if (!thisObj.indexIsBuilt) this.buildIndex(files[i]);
        let thisIndexIds = this.getObjectById(files[i]).indexIds;
        for (let key in thisIndexIds) {
            if (typeof options.customFilter == "function") key = options.customFilter(key);
            result[key] = result[key] || [];
            result[key].push({
                file:files[i],
                row:thisIndexIds[key]
            })
        }
    }

    if (options.indexId) {
        this.customIndexes[options.indexId] = result;
    } else {
        this._tempIndexes = result;
    }

    return result;
}

Trans.prototype.getFromIndexes = function(keyword, indexes, customFilter) {
    if (typeof customFilter == "function") {
        var target = "#auto.fn."+common.crc32String(customFilter.toString())
        if (this.customIndexes[target]) {
            this.customIndexes[target][keyword];
        }
    }
    indexes = indexes || this._tempIndexes || {};
    return indexes[keyword];
}

Trans.prototype.clearTemporaryIndexes = function(target) {
    if (target) {
        if (typeof target == "string") {
            if (this.customIndexes[target]) delete this.customIndexes[target];
        } else if (typeof target == "function") {
            target = "#auto.fn."+common.crc32String(target.toString())
            if (this.customIndexes[target]) delete this.customIndexes[target];
        }
    } else {
        delete this.customIndexes
    }
    this._tempIndexes = undefined;
}

 Trans.prototype.findIdByIndex = function(index, fileId) {
    if (trans.data == null || trans.data == '' || typeof trans.data == 'undefined') return false;

    if (typeof fileId == 'undefined') {
        if (typeof trans.indexIds == 'undefined') trans.buildIndex();
        if (typeof trans.indexIds[index] == "undefined") return false;
        return trans.indexIds[index];
    } else {
        if (trans.project.files[fileId].indexIsBuilt == false) trans.buildIndex(fileId);
        if (typeof trans.project.files[fileId].indexIds == 'undefined') trans.buildIndex(fileId);

        if (typeof trans.project.files[fileId].indexIds[index] == 'undefined') return false;
        return trans.project.files[fileId].indexIds[index];
    }
}

Trans.prototype.getClearOnNextHumanInteract = function(key) {
    this._clearOnNextHumanInteract = this._clearOnNextHumanInteract || {};
    if (!key) return this._clearOnNextHumanInteract;
    this._clearOnNextHumanInteract[key] = this._clearOnNextHumanInteract[key] || {};
    return this._clearOnNextHumanInteract[key];
}

 Trans.prototype.getRowIdByTextInsensitive = function(str, fileId) {
    if (this.data == null || this.data == '' || typeof this.data == 'undefined') return false;
    if (!fileId) throw "second argument fileId is required!"
    var thisIndex = this.getClearOnNextHumanInteract(`insensitiveIndex_${fileId}`);

    var data = this.getData(fileId)
    var makeInsensitive = (txt) => {
        if (!txt) return "";
        return common.trimRightParagraph(txt).toLowerCase();
    }
    if (empty(thisIndex)) {

        for (var rowId=0; rowId<data.length; rowId++) {
            var thisKey = makeInsensitive(data[rowId][this.keyColumn]);
            thisIndex[thisKey] = rowId;
        }
    }
    return thisIndex[makeInsensitive(str)]
}

 Trans.prototype.copyTranslationToRow = function(obj, targetColumn, options) {

    if (typeof obj == 'undefined') return false;
    if (typeof obj.files !== 'undefined') obj = obj.files;
    targetColumn             = targetColumn || options.targetColumn || 1;
    options = options||{};
    options.files             = options.files||[];
    options.mode             = options.mode||"";
    options.fetch             = options.fetch||"";
    options.filterTag         = options.filterTag || [];
    options.filterTagMode     = options.filterTagMode || "";
    options.overwrite        = options.overwrite || false;
    if (Array.isArray(options.files) == false) options.files = [options.files];
    if (options.files.length == 0) {
        for (let file in obj) {
            options.files.push(file);
        }
    }

    for (var i=0; i<options.files.length; i++) {
        let file = options.files[i];

        if (Boolean(obj[file]) == false) continue;
        var objWithSameId = trans.getObjectById(file);

        for (var row=0; row<obj[file].data.length; row++) {
            var thisRow = obj[file].data[row]
            if (Boolean(thisRow[0]) == false) continue;
            if (empty(objWithSameId.data[row])) continue;
            if (options.overwrite == false && Boolean(objWithSameId.data[row][targetColumn])) continue;

            var thisTranslation = trans.getTranslationFromRow(thisRow);
            if (Boolean(thisTranslation) == false) thisTranslation = thisRow[0];
            objWithSameId.data[row][targetColumn] = thisTranslation;
        }
    }
}

 Trans.prototype.generateContextTranslationPair = function(obj, options) {

    if (typeof obj == 'undefined') return false;
    if (typeof obj.files !== 'undefined') obj = obj.files;

    var result = {};
    options = options||{};
    options.files             = options.files||[];
    options.mode             = options.mode||"";
    options.fetch             = options.fetch||"";
    options.filterTag         = options.filterTag || [];
    options.filterTagMode     = options.filterTagMode || "";

    if (Array.isArray(options.files) == false) options.files = [options.files];
    if (options.files.length == 0) {
        for (let file in obj) {
            options.files.push(file);
        }
    }

    for (let i=0; i<options.files.length; i++) {
        let file = options.files[i];
        if (Boolean(obj[file]) == false) continue;
        for (var row=0; row<obj[file].context.length; row++) {
            if (Boolean(obj[file].context[row]) == false) continue;
            if (Boolean(obj[file].data[row]) == false) continue;
            var thisTranslation = trans.getTranslationFromRow(obj[file].data[row]);
            if (Boolean(thisTranslation) == false) thisTranslation = obj[file].data[row][trans.keyColumn];
            if (Boolean(thisTranslation) == false) continue;

            for (var contextId=0; contextId<obj[file].context[row].length; contextId++) {
                var thisContextKey = obj[file].context[row][contextId];
                result[thisContextKey] = thisTranslation;
            }
        }
    }

    return result;
}

 Trans.prototype.generateTranslationTable = function(obj, options) {

    if (typeof obj == 'undefined') return false;
    if (typeof obj.files !== 'undefined') obj = obj.files;

    var result = {};
    options = options||{};
    options.files = options.files||[];
    options.caseSensitive = options.caseSensitive||false;
    options.mode = options.mode||"";
    options.fetch = options.fetch||"";
    options.filterTag = options.filterTag || [];
    options.filterTagMode = options.filterTagMode || "";

    if (Array.isArray(options.files) == false) options.files = [options.files];
    if (options.files.length == 0) {
        for (let file in obj) {
            options.files.push(file);
        }
    }

    if (options.mode.toLowerCase() == "linebyline") {
        for (let i=0; i<options.files.length; i++) {
            let file = options.files[i];

            for (var row=0; row<obj[file].data.length; row++) {
                if (Boolean(obj[file].data[row][0]) == false) continue;

                if (options.filterTagMode == "blacklist") {
                    if (this.hasTags(options.filterTag, row, file)) continue;
                } else if (options.filterTagMode == "whitelist") {
                    if (!this.hasTags(options.filterTag, row, file)) continue;
                }

                let thisTranslation = trans.getTranslationFromRow(obj[file].data[row]);
                if (options.fetch == "untranslated") {
                    if (Boolean(thisTranslation) == true) continue;
                } else if (options.fetch == "both") {

                } else {
                    if (Boolean(thisTranslation) == false) continue;
                }

                var splitedIndex = obj[file].data[row][0].split("\n");

                thisTranslation = thisTranslation||"";
                var splitedResult = thisTranslation.split("\n").
                        map(function(input) {
                            input = input||"";
                            return input.replaceAll(/\r/g, "")
                        });

                for (var x=0; x<splitedIndex.length; x++) {
                    if (options.fetch == "untranslated") {
                        if (Boolean(splitedResult[x]) == true) continue;
                    } else if (options.fetch == "both") {

                    } else {
                        if (Boolean(splitedResult[x]) == false) continue;
                    }
                    result[splitedIndex[x]] = splitedResult[x]||"";
                }

            }
        }

        return result;
    }

    for (let i=0; i<options.files.length; i++) {
        let file = options.files[i];

        if (Boolean(obj[file]) == false) continue;
        for (let row=0; row<obj[file].data.length; row++) {
            if (Boolean(obj[file].data[row][0]) == false) continue;
            let thisTranslation = trans.getTranslationFromRow(obj[file].data[row]);
            if (Boolean(thisTranslation) == false) continue;
            result[obj[file].data[row][0]] = thisTranslation;
        }
    }

    return result;

}

 Trans.prototype.generateTranslationTableLine = function(obj, options) {

    if (typeof obj == 'undefined') return false;
    if (typeof obj.files !== 'undefined') obj = obj.files;

    var result = {};
    options = options||{};
    options.files                 = options.files||[];
    options.caseSensitive         = options.caseSensitive||false;
    options.mode                 = options.mode||"";
    options.fetch                 = options.fetch||"";
    options.keyColumn             = options.keyColumn||0;
    options.filterTag             = options.filterTag || [];
    options.filterTagMode         = options.filterTagMode || "";
    options.ignoreTranslated     = options.ignoreTranslated || false;
    options.overwrite            = options.overwrite || false;
    options.collectAddress      = options.collectAddress || false;
    options.targetColumn;

    try {
        options.filterLanguage = options.filterLanguage||this.getSl()||"ja";
    } catch(e) {
        options.filterLanguage = "ja";
    }
    options.ignoreLangCheck = options.ignoreLangCheck||false;

    if (Array.isArray(options.files) == false) options.files = [options.files];
    if (options.files.length == 0) {
        for (let file in obj) {
            options.files.push(file);
        }
    }

    const addresses = {}

    for (let i=0; i<options.files.length; i++) {
        let file = options.files[i];

        for (let row=0; row<obj[file].data.length; row++) {
            if (Boolean(obj[file].data[row][options.keyColumn]) == false) continue;

            if (options.filterTagMode == "blacklist") {
                if (this.hasTags(options.filterTag, row, file)) continue;
            } else if (options.filterTagMode == "whitelist") {
                if (!this.hasTags(options.filterTag, row, file)) continue;
            }

            if (options.ignoreTranslated) {
                if (this.rowHasTranslation(obj[file].data[row], options.keyColumn)) continue;
            }

            if (options.overwrite == false && options.targetColumn) {
                if (obj[file].data[row][options.targetColumn]) continue;
            }

            var thisTranslation = trans.getTranslationFromRow(obj[file].data[row], options.keyColumn, [0]);

            var splitedIndex = obj[file].data[row][options.keyColumn].split("\n");

            thisTranslation = thisTranslation||"";
            var splitedResult = thisTranslation.split("\n").
                    map(function(input) {
                        input = input||"";
                        return input.replaceAll(/\r/g, "")
                    });

            for (var x=0; x<splitedIndex.length; x++) {

                if (options.fetch == "untranslated") {
                    if (Boolean(splitedResult[x]) == true) continue;
                } else if (options.fetch == "both") {

                } else {
                    if (Boolean(splitedResult[x]) == false) continue;
                }

                if (options.ignoreLangCheck == false) {

                    if (common.isInLanguage(splitedIndex[x], options.filterLanguage) == false) continue;
                }

                result[splitedIndex[x]] = splitedResult[x]||"";
                if (options.collectAddress) {
                    addresses[splitedIndex[x]] ||= [];
                    addresses[splitedIndex[x]].push({
                           line:x,
                           file:file,
                           row:row,
                           rowObj:obj[file].data[row]
                    })
                }
            }

        }
    }

    if (options.collectAddress) {
        return {
            pairs: result,
            addresses: addresses
        }
    }
    return result;

}

 Trans.prototype.generateTranslationTableFromStrings = function(input, transEngine, options) {

    options = options||{};
    try {
        options.filterLanguage = options.filterLanguage||this.getSl()||"ja";
    } catch(e) {
        options.filterLanguage = "ja";
    }
    options.ignoreLangCheck = options.ignoreLangCheck||false;

    var ignoreLangCheck
    try {
        ignoreLangCheck = options.ignoreLangCheck || transEngine.getOptions("ignoreLangCheck");

    } catch (e) {
        ignoreLangCheck = false;
    }

    if (typeof input == 'string') input = [input];

    var result = {
        include:{},
        exclude:{}
    };

    if (options.mode == "rowByRow") {
        for (let i=0; i<input.length; i++) {
            if (typeof input[i] != 'string') continue;
            if (input[i].length < 1) continue;

            if (!ignoreLangCheck) {

                if (common.isInLanguage(input[i], options.filterLanguage) == false) {
                    result.exclude[input[i]] = input[i];
                    continue;
                }
            }
            result.include[input[i]] = "";
        }
    } else {
        for (let i=0; i<input.length; i++) {
            if (typeof input[i] != 'string') continue;
            if (input[i].length < 1) continue;
            var splitedIndex = input[i].replaceAll("\r", "").split("\n");

            for (var x=0; x<splitedIndex.length; x++) {
                if (options.ignoreWhitespace) {
                    if (!splitedIndex[x]) continue;
                    if (!splitedIndex[x].trim()) continue;
                }
                if (ignoreLangCheck) {

                    if (common.isInLanguage(splitedIndex[x], options.filterLanguage) == false) {
                        result.exclude[splitedIndex[x]] = splitedIndex[x];
                        continue;
                    }
                }
                result.include[splitedIndex[x]] = "";
            }
        }
    }

    return result;
}

 Trans.prototype.generateTranslationTableFromResult = function(keywordPool, translationPool, defaultTrans) {

    var result = defaultTrans || {};
    for (var i=0; i<keywordPool.length; i++) {
        if (typeof translationPool[i] == 'undefined') continue;
        result[keywordPool[i]] = translationPool[i];
    }

    return result;
}

Trans.prototype.generateSelectedTranslationTable = function(currentSelection, fileId, options) {
    currentSelection = currentSelection||this.grid.getSelectedRange()||[[]];
    fileId = fileId || this.getSelectedId();
    options = options || {};
    var selectedCells = common.gridSelectedCells(currentSelection);
    var thisData = this.getData(fileId)
    var transTable     = {};
    for (var i=0; i<selectedCells.length; i++) {
        var row = selectedCells[i].row
        var col = selectedCells[i].col
        var origText = thisData[row][this.keyColumn];
        transTable[origText] = transTable[origText] || [];
        transTable[origText].push({
            col:col,
            row:row,
            value:thisData[row][col],
            file:fileId
        })
    }

    return transTable;
}

 Trans.prototype.wordWrapText = function(str, rowTags=[], wordWrapByTags=[], lineBreak="\n") {

    if (empty(wordWrapByTags)) return str;
    if (empty(rowTags)) return str;
    if (window.langTools?.isCJK(this.getTl())) {
        for (let i=0; i<wordWrapByTags.length; i++) {
            let intersect = common.arrayIntersect(rowTags, wordWrapByTags[i].tags);
            if (intersect.length>0) return common.wordwrapLocale(str, wordWrapByTags[i].maxLength, this.getTl(), lineBreak);
        }
    }
    for (let i=0; i<wordWrapByTags.length; i++) {
        let intersect = common.arrayIntersect(rowTags, wordWrapByTags[i].tags);
        if (intersect.length>0) return common.wordwrap(str, wordWrapByTags[i].maxLength, lineBreak);
    }
    return str;
}

 Trans.prototype.getTranslationData = function(transData, options) {

    options = options || {}
    options.keyCol         = options.keyCol|| 0;
    options.groupIndex     = options.groupIndex||undefined;
    options.groupBy     = options.groupBy || "path";
    options.objectGrouping = options.objectGrouping || false
    options.includeTagsInfo    = options.includeTagsInfo || false;
    // Default branch: when the caller did not pass save data, clone only the
    // files that will actually be used (options.files). Cloning the entire
    // project first needlessly doubled the heap for single-file operations
    // on large games (renderer V8 OOM crash when exporting a big file).
    transData             = transData||trans.getSaveData(empty(options.files) ? {} : {filter: options.files})
    transData             = JSON.parse(JSON.stringify(transData));
    transData.project     = transData.project||{}
    transData.project.files = transData.project.files||{};

    options.options         = options.options || {};
    options.filterTag         = options.filterTag||options.options.filterTag||[];
    options.filterTagMode     = options.filterTagMode||options.options.filterTagMode||"";
    options.wordWrapByTags     = options.wordWrapByTags || options.options.wordWrapByTags || transData.project.options.wordWrapByTags;
    options.useSelectedFiles ??= true;
    options.disableEvent     ||= false;

    var contextSeparator = options.contextSeparator || "\n"

    var autofillFiles = [];
    if (options.useSelectedFiles) {
        var checkbox = $(".fileList .data-selector .fileCheckbox:checked");
        for (var i=0; i<checkbox.length; i++) {
            autofillFiles.push(checkbox.eq(i).attr("value"));
        }
    }

    options.files = options.files||autofillFiles||[];

    if (options.groupBy == "id") {

        for (let fileId in transData.project.files) {
            if (!transData.project.files[fileId]) continue;
            transData.project.files[fileId].id = fileId;
        }
    }

    var transGroup = {};
    var info = {
        filterTag          : options.filterTag,
        filterTagMode     : options.filterTagMode
    };
    if (!empty(options.wordWrapByTags)) {
        info.wordWrapByTags = options.wordWrapByTags
    }

    for (let fileId in transData.project.files) {
        var thisFiles = transData.project.files[fileId];
        thisFiles.data = thisFiles.data||[[]];
        thisFiles.tags = thisFiles.tags||[];
        if (options.files.length > 0) {
            if (options.files.includes(fileId) == false) continue;
        }

        var thisData = {
            info:{
                groupLevel : thisFiles['groupLevel']
            },
            translationPair : {}
        }

        transGroup[thisFiles[options.groupBy]] = transGroup[thisFiles[options.groupBy]] || thisData;
        for (var row=0; row<thisFiles.data.length; row++) {
            if (Boolean(thisFiles.data[row]) == false) continue;
            if (Boolean(thisFiles.data[row][options.keyCol]) == false) continue;
            var thisTag = thisFiles.tags[row] || [];
            if (options.filterTagMode !== "") {
                var intersect = options.filterTag.filter(value => thisTag.includes(value));
                if (options.filterTagMode == "whitelist") {
                    if (intersect.length == 0) continue;
                } else {
                    if (intersect.length > 0) continue;
                }
            }

            try {
                var originalWord     = thisFiles.data[row][options.keyCol] = thisFiles.data[row][options.keyCol] || "";
                var thisTranslation = trans.getTranslationFromRow(thisFiles.data[row], options.keyCol);
                var transByContext     = ui.translationByContext.generateContextTranslation(row, fileId, originalWord);

                if ((Boolean(thisTranslation) == false) && transByContext.length == 0) continue

                if (transByContext.length > 0) transGroup[thisFiles[options.groupBy]].translationPair = Object.assign(transGroup[thisFiles[options.groupBy]].translationPair, transByContext.translation)

                if (options.objectGrouping) {
                    if (thisFiles[options.groupIndex]) {

                        transGroup[thisFiles[options.groupBy]].translationPair[thisFiles[options.groupIndex]] = transGroup[thisFiles[options.groupBy]].translationPair[thisFiles[options.groupIndex]] || {};
                        if ((Boolean(thisTranslation) !== false)) transGroup[thisFiles[options.groupBy]].translationPair[thisFiles[options.groupIndex]][originalWord] = trans.wordWrapText(thisTranslation, thisTag, options.wordWrapByTags);
                    } else {

                        if ((Boolean(thisTranslation) !== false)) transGroup[thisFiles[options.groupBy]].translationPair[originalWord] = trans.wordWrapText(thisTranslation, thisTag, options.wordWrapByTags);
                    }

                } else {
                    var thisKey = thisFiles[options.groupIndex] ? thisFiles[options.groupIndex]+contextSeparator+originalWord : originalWord
                    if ((Boolean(thisTranslation) !== false)) transGroup[thisFiles[options.groupBy]].translationPair[thisKey] = trans.wordWrapText(thisTranslation, thisTag, options.wordWrapByTags);
                }

            } catch (e) {

                throw(e);
            }

        }
    }

    if (!options.disableEvent) {
        this.trigger("onGenerateTranslationData", {
            info:info,
            translationData:transGroup
        });
    }

    return  {
        info:info,
        translationData:transGroup
    }
}

 Trans.prototype.buildContextFromParameter = function(parameter) {
    return parameter['VALUE ID']+"/"+consts.eventCode[trans.gameEngine][parameter['EVENT CODE']];
}

Trans.prototype.getStagingPath = function(transData) {
    try {
        transData ||= this;
        return nwPath.resolve(transData.project.cache.cachePath)
    } catch (e) {
        return;
    }
}

Trans.prototype.getStagingDataPath = function(transData) {
    var defaultBaseData = engines.current().getProperty("stagingDataPath") || "data";
    return nwPath.join(this.getStagingPath(transData), defaultBaseData);
}

Trans.prototype.updateStagingInfo = async function(transData) {
    transData ||= this;
    const stagingInfoFile = nwPath.join(this.getStagingPath(transData), "gameInfo.json");
    var stagingInfo = {}
    if (await common.isFileAsync(stagingInfoFile)) {
        stagingInfo = JSON.parse(await common.fileGetContents(stagingInfoFile));
    }
    stagingInfo.title = transData.project.gameTitle;
    stagingInfo.engine = transData.project.gameEngine;
    await common.filePutContents(stagingInfoFile, JSON.stringify(stagingInfo, undefined, 2), "UTF8", false);
    return stagingInfo;
}

Trans.prototype.getStagingFile = function(obj) {
    if (typeof obj == "string") {
        obj = this.getObjectById(obj)
    }

    if (!obj) return;
    if (typeof obj !== "object") return;
    if (!obj.path) return;

    var stagintPath = nwPath.join(this.getStagingDataPath(), obj.path);
    return stagintPath;
}

 Trans.prototype.insertCell = function(index, value) {
    value = value||null;
    common.batchArrayInsert(trans.data, index, value);
    if(typeof trans.project == "undefined") return trans.alert("Please open or create a new project first!");

    for (var file in trans.project.files) {
        if (file == trans.getSelectedId()) continue;
        common.batchArrayInsert(trans.project.files[file].data, index, value);
    }
}

 Trans.prototype.copyCol = function(from, to, project, options) {

    options = options || {};
    project = project || trans.project;

    if (typeof project == 'undefined') return void 0;
    if (typeof project.files == 'undefined') return void 0;

    for (var file in project.files) {
        if (Array.isArray(project.files[file].data) == false) {

            continue;
        }
        for (var row in project.files[file].data) {
            project.files[file].data[row][to] = project.files[file].data[row][from];
        }
    }

}

 Trans.prototype.gridIsModified =function(flag) {
    if (typeof flag == 'undefined') return this.unsavedChange;

    if (!this.project) {
        this.unsavedChange = false;
        return;
    }

    if (this.unsavedChange !== flag) {

        this.trigger("documentModifiedStateChange", flag);
    }
    this.unsavedChange = flag;

    var thisId = this.getSelectedId();
    if (Boolean(this.project.files) == false) return false;
    if (!this.project.files[thisId]) return false;
    this.project.files[thisId]["cacheResetOnChange"] = {};
    return this.unsavedChange;
}

 Trans.prototype.walkToAllFile = function() {

    var current = $(".fileList li").index($(".fileList .selected"));
    for (var i=0; i<$(".fileList li").length; i++) {
        $(".fileList li").eq(i).trigger("click");
    }
    $(".fileList li").eq(current).trigger("click");

}

 Trans.prototype.moveColumn = function(fromIndex, toIndex) {

    if (typeof trans.project == 'undefined') return false;
    if (toIndex > Math.min.apply(null, fromIndex)) {

        toIndex = toIndex-1;
    }
    if (fromIndex[0] == toIndex) return false;
    if (toIndex < Math.max.apply(null, fromIndex)) {

    }
    ui.showBusyOverlay();
    for (var file in trans.project.files) {

        for (var row=0; row<trans.project.files[file].data.length; row++) {
            trans.project.files[file].data[row] = common.arrayMoveBatch(trans.project.files[file].data[row], fromIndex, toIndex);

            this.cellInfo.moveCell(file, row, fromIndex, toIndex);
        }
    }

    trans.colHeaders = common.arrayMoveBatch(trans.colHeaders, fromIndex, toIndex);

    trans.column = common.arrayMoveBatch(trans.column, fromIndex, toIndex);

    setTimeout(function() {
        trans.grid.destroy();
        trans.initTable();
        ui.hideBusyOverlay();
    }, 250);
    trans.gridIsModified(true);
    return trans;
}

 Trans.prototype.dataPadding = function() {

    if (typeof trans.data == 'undefined') return false;

    for (let i in trans.data) {
        if (Array.isArray(trans.data[i]) == false) trans.data[i] = [];
        if (trans.data[i].length >= trans.colHeaders.length) continue;
        let dif = trans.colHeaders.length - trans.data[i].length;
        if (dif < 0) continue;

        let padding = Array(dif).fill(null);
        trans.data[i] = trans.data[i].concat(padding);
    }

    if (typeof trans.project == 'undefined') return false;

    for (let file in trans.project.files) {
        for (let i in trans.project.files[file].data) {
            if (trans.project.files[file].data[i].length >= trans.colHeaders.length) continue;

            let dif = trans.colHeaders.length - trans.project.files[file].data[i].length;
            let padding = Array(dif).fill(null);
            trans.project.files[file].data[i] = trans.project.files[file].data[i].concat(padding);
        }
    }
    trans.refreshGrid();
    return trans;
}

 Trans.prototype.generateHeader = function(trans, prefix) {

    trans     = trans || this;
    prefix     = prefix || "";
    var maxLength = 0;
    for (let file in trans.project.files) {
        let currentData = trans.project.files[file].data;
        currentData = currentData||[];
        for (let i=0; i<currentData.length; i++) {
            if (Array.isArray(currentData[i]) == false) continue;
            if (currentData[i].length > maxLength) maxLength = currentData[i].length;
        }
    }

    for (let i=trans.colHeaders.length-1; i<maxLength; i++) {
        trans.colHeaders.push(prefix+String.fromCharCode(65+i))
        trans.columns.push({});
    }

    return trans.colHeaders;
}

 Trans.prototype.sanitize = function(trans) {
    trans = trans || this;

    if (typeof trans.project == 'undefined') return false;
    if (typeof trans.project.files == 'undefined') return false;

    for (var file in trans.project.files) {
        var currentData     = trans.project.files[file].data;
        var currentContext     = trans.project.files[file].context||[];
        var currentTags     = trans.project.files[file].tags||[];
        var currentParameters = trans.project.files[file].parameters||[];
        var inCache         = {};
        var newData         = [];
        var newContext         = [];
        var newTags         = [];
        var newParameters    = [];

        this.colHeaders = this.colHeaders||[];
        if (Array.isArray(currentData) == false) {

            trans.project.files[file].data = [JSON.parse(JSON.stringify(this.colHeaders)).fill(null)];
            continue;
        } else if (currentData.length == 0) {
            trans.project.files[file].data = [JSON.parse(JSON.stringify(this.colHeaders)).fill(null)];
            continue;
        }

        currentData = currentData||[];

        for (var i=0; i<currentData.length; i++) {
            if (typeof currentData[i][0] !== 'string') continue;
            if (currentData[i][0].length < 1) continue;

            newData.push(currentData[i]);
            var row = newData.length - 1;
            if (currentContext[i])     newContext[row] = currentContext[i];
            if (currentTags[i])     newTags[row]     = currentTags[i];
            if (currentParameters[i])     newParameters[row]     = currentParameters[i];
        }
        trans.project.files[file].data             = newData;
        trans.project.files[file].context         = newContext;
        trans.project.files[file].tags             = newTags;
        trans.project.files[file].parameters     = newParameters;
    }
    trans.project.isDuplicatesRemoved = true;
    return trans;
}

 Trans.prototype.removeDuplicates = function() {

    var inCache = {};
    var newData = [];
    for (var i=0; i<trans.data.length; i++) {
        if (typeof inCache[trans.data[i][0]] == 'undefined') {
            newData.push(trans.data[i]);
            inCache[trans.data[i]] = true;
        }
    }
    trans.data = newData;
    return trans.data;
}

 Trans.prototype.isKeyExistOn = function(key, fileId) {
    if (typeof fileId == 'undefined') fileId = trans.getSelectedId();
    if (typeof trans.findIdByIndex(key, fileId) == 'number') {
        return true;
    } else {
        return false;
    }
}

 Trans.prototype.isKeyExist = function(key) {
    if (typeof trans.findIdByIndex(key) == 'number') {
        return true;
    } else {
        return false;
    }

}

 Trans.prototype.setTags = function(file, row, tags, options) {

    options = options||{};
    if (Array.isArray(tags) == false) tags = [tags];
    if (typeof this.project == 'undefined') return false;
    if (typeof this.project.files[file] == 'undefined') return false;
    if (typeof row != 'number') return false;
    if (typeof this.project.files[file].tags == 'undefined') this.project.files[file].tags = [];
    if (Boolean(options.append) == true) {
        this.project.files[file].tags[row] = this.project.files[file].tags[row]||[];

        this.project.files[file].tags[row].push.apply(this.project.files[file].tags[row], tags);
        this.project.files[file].tags[row] = this.project.files[file].tags[row].filter((v, i, a) => a.indexOf(v) === i);
    } else {
        this.project.files[file].tags[row] = tags;
    }

    return this.project.files[file].tags[row];

}

 Trans.prototype.removeTags = function(file, row, tags, options) {
    options = options||{};
    file = file||this.getSelectedId();

    if (Array.isArray(tags) == false) tags = [tags];
    if (typeof this.project == 'undefined') return false;
    if (typeof this.project.files[file] == 'undefined') return false;
    if (typeof row != 'number') return false;
    if (typeof this.project.files[file].tags == 'undefined') this.project.files[file].tags = [];

    let arr = this.project.files[file].tags[row];
    arr = arr.filter(item => !tags.includes(item))

    this.project.files[file].tags[row] = arr;

    return this.project.files[file].tags[row];
}

 Trans.prototype.clearTags = function(file, cellRange, options) {
    options = options||{};
    file = file||this.getSelectedId();
    if (typeof this.project == 'undefined') return false;
    if (typeof this.project.files[file] == 'undefined') return false;
    if (typeof cellRange == 'number') {
        this.project.files[file].tags[cellRange] = [];
        return this.project.files[file].tags[cellRange];
    }

    for (let i=0; i<cellRange.length; i++) {
        var cellStart = cellRange[i].start || cellRange[i].from;
        var cellEnd = cellRange[i].end || cellRange[i].to;

        if (typeof cellStart.row == 'undefined') continue
        if (typeof cellEnd.row == 'undefined') continue

        this.project.files[file].tags = this.project.files[file].tags||[];
        for (var row=cellStart.row; row <= cellEnd.row; row++) {
            this.project.files[file].tags[row] = [];
        }
    }

    return this.project.files[file].tags[row];
}

 Trans.prototype.resetTags = function(file, options) {
    options = options||{};
    file = file||this.getSelectedId();
    if (typeof this.project == 'undefined') return false;
    if (typeof this.project.files[file] == 'undefined') return false;
    return this.project.files[file].tags = [];
}

 Trans.prototype.appendTags = function(file, row,  tags, options) {
    return this.setTags(file, row,  tags, {append:true, noRefresh:true})
}

 Trans.prototype.setTagForSelectedRow = function(tagName, cellRange, file, options) {

    options = options||{};

    if (typeof options.append == 'undefined' ) options.append = true;
    file = file||this.getSelectedId();
    if (Boolean(cellRange) == false) return false;
    if (Array.isArray(cellRange) == false) return false;

    for (let i=0; i<cellRange.length; i++) {
        var cellStart = cellRange[i].start || cellRange[i].from;
        var cellEnd = cellRange[i].end || cellRange[i].to;

        if (typeof cellStart.row == 'undefined') continue
        if (typeof cellEnd.row == 'undefined') continue

        for (var row=cellStart.row; row <= cellEnd.row; row++) {
            this.setTags(file, row,  tagName, options);
        }
    }
    this.grid.render();
    return true;
}

 Trans.prototype.removeTagForSelectedRow = function(tagName, cellRange, file, options) {

    options = options||{};
    options.append = options.append||true;
    file = file||this.getSelectedId();
    if (Boolean(cellRange) == false) return false;
    if (Array.isArray(cellRange) == false) return false;

    for (let i=0; i<cellRange.length; i++) {
        var cellStart = cellRange[i].start || cellRange[i].from;
        var cellEnd = cellRange[i].end || cellRange[i].to;

        if (typeof cellStart.row == 'undefined') continue
        if (typeof cellEnd.row == 'undefined') continue

        for (var row=cellStart.row; row <= cellEnd.row; row++) {
            this.removeTags(file, row,  tagName, options);
        }
    }
    this.grid.render();
    return true;
}

 Trans.prototype.hasTags = function(tags, row, file) {
    if (!tags) return false;
    if (typeof row == 'undefined') return false;
    file = file || this.getSelectedId();
    var fileObj = this.getObjectById(file);
    if (!fileObj) return false;
    if (!fileObj.tags) return false;
    if (!Array.isArray(fileObj.tags[row])) return false;
    if (!Array.isArray(tags)) tags = [tags]
    try {
        for (var i in tags) {
            if (fileObj.tags[row].includes(tags[i])) return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

 Trans.prototype.alert = async function(text, timeout) {
    timeout = timeout||3000;
    $("#appInfo").attr("title", text);

    return new Promise((resolve, reject) => {
        $("#appInfo").tooltip({
            content:function() {
                return text;
            },
            show: {
                effect: "slideDown",
                duration: 200
            },
            hide: {
                effect: "fade",
                delay: 250
            },
            position: {
                my: "left top",
                at: "left bottom",
                of: "#table"
            },
            open: function( event, ui ) {
                setTimeout(function(){
                    $("#appInfo").tooltip("close");
                    $("#appInfo").attr("title", "");
                    resolve();
                }, timeout);
            }
        });

        $("#appInfo").tooltip("open");
    })
}

 Trans.prototype.refreshGrid = function(options) {
    options = options||{};
    options.rebuild = options.rebuild||false;

    if(trans.getSelectedId() && trans?.project?.files[trans.getSelectedId()]) {
        trans.data = trans.project.files[trans.getSelectedId()].data;
    }
    if (!(trans.data)) trans.data = [[null]];
    if (trans.data.length == 1) {
        if (Array.isArray(trans.data[0]) == false) trans.data = [[null]]
        if (Boolean(trans.data[0][0]) == false) trans.data = [[null]]
    }
    if (trans.data.length == 0) trans.data = [[null]]

    if(trans.getSelectedId() && trans.project.files[trans.getSelectedId()]) {

        trans.project.files[trans.getSelectedId()].data = trans.data;
    }

    if (typeof options.onDone == 'function') {
        trans.grid.addHookOnce('afterRender', function() {
            options.onDone.call(trans.grid);
        });
    }
    if (options.rebuild) {
        trans.grid.destroy();
        trans.initTable();
        return true;
    }
    trans.grid.updateSettings({
        data        : trans.data,
        colHeaders    : trans.colHeaders,
        columns        : trans.columns
    });

    trans.loadComments();
}

Trans.prototype._initRowMeasurer = function() {
    if (this._rowMeasurer) return this._rowMeasurer;
    var el = document.getElementById('table');
    var font = '14px sans-serif';
    if (el) {
        var cs = getComputedStyle(el);
        font = cs.font || (cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontFamily);
    }
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    try { ctx.font = font; } catch (e) { ctx.font = '14px sans-serif'; }
    this._rowMeasurer = { ctx: ctx, lineHeight: 21, padX: 4 };
    return this._rowMeasurer;
};

Trans.prototype._countWrapLines = function(ctx, text, contentW) {
    if (contentW <= 0) return 1;
    var segs = String(text).split('\n');
    var total = 0;
    for (var s = 0; s < segs.length; s++) {
        var seg = segs[s];
        if (seg.length === 0) { total++; continue; }
        if (ctx.measureText(seg).width <= contentW) { total++; continue; }
        var lines = 1, w = 0;
        for (var i = 0; i < seg.length; i++) {
            var cw = ctx.measureText(seg.charAt(i)).width;
            if (w > 0 && w + cw > contentW) { lines++; w = cw; }
            else { w += cw; }
        }
        total += lines;
    }
    return total;
};

Trans.prototype.measureRowHeight = function(rowData) {
    if (!Array.isArray(rowData)) return null;
    var m = this._initRowMeasurer();
    var ctx = m.ctx;
    var colCount = (this.columns && this.columns.length) || 0;
    var maxLines = 1;
    for (var c = 0; c < rowData.length && c < colCount; c++) {
        var val = rowData[c];
        if (val === null || val === undefined || val === '') continue;
        var colW = 0;
        try { if (this.grid && this.grid.getColWidth) colW = this.grid.getColWidth(c); } catch (e) {}
        if (!colW) colW = (this.columns[c] && this.columns[c].width) || 50;
        var lines = this._countWrapLines(ctx, val, colW - m.padX * 2);
        if (lines > maxLines) maxLines = lines;
    }
    return (maxLines > 1) ? (maxLines * m.lineHeight + 2) : null;
};

Trans.prototype.measureRowHeights = function(data) {
    if (!Array.isArray(data)) return [];
    var out = new Array(data.length);
    for (var r = 0; r < data.length; r++) {
        try { out[r] = this.measureRowHeight(data[r]); }
        catch (e) { out[r] = null; }
    }
    return out;
};

Trans.prototype.invalidateRowHeights = function() {
    if (this.selectedData) this.selectedData.rowHeights = null;
};

Trans.prototype.ensureRowHeights = function() {
    try {
        var file = this.selectedData;
        if (!file) return;
        var need = this.data ? this.data.length : 0;
        if (file.rowHeights && file.rowHeights.length >= need) return;
        file.rowHeights = this.measureRowHeights(this.data);
    } catch (e) {  }
};

Trans.prototype.remeasureChangedRows = function(changes) {
    try {
        if (!this.selectedData || !this.selectedData.rowHeights || !Array.isArray(changes)) return;
        var seen = {};
        for (var i = 0; i < changes.length; i++) {
            if (Array.isArray(changes[i])) seen[changes[i][0]] = true;
        }
        var keys = Object.keys(seen);
        if (!keys.length) return;
        for (var k = 0; k < keys.length; k++) {
            var rr = parseInt(keys[k], 10);
            this.selectedData.rowHeights[rr] = this.measureRowHeight(this.data[rr]);
        }
        this.grid.render();
    } catch (e) {  }
};

 Trans.prototype.editNoteAtCell = function(cell) {

    if (typeof cell == 'undefined') {
        try{
            cell = trans.grid.getSelectedRange()[0]['highlight'];
        } catch (error) {

            return false;
        }
    }
    var hotComment = trans.grid.getPlugin('comments');
    hotComment.showAtCell(cell.row, cell.col);
    $(".htCommentTextArea").trigger("click");
    $(".htCommentTextArea").focus();
}

 Trans.prototype.removeNoteAtSelected = function(selection) {

    if (typeof selection == 'undefined') {
        selection = trans.grid.getSelectedRange()
    }

    if (Boolean(selection) == false) {

        return false;
    }

    var minRow = Math.min(selection[0]['from']['row'], selection[0]['to']['row']);
    var maxRow = Math.max(selection[0]['from']['row'], selection[0]['to']['row']);
    var minCol = Math.min(selection[0]['from']['col'], selection[0]['to']['col']);
    var maxCol = Math.max(selection[0]['from']['col'], selection[0]['to']['col']);
    var hotComment = trans.grid.getPlugin('comments');

    for (var y=minRow; y<=maxRow; y++) {
        for (var x=minCol; x<=maxCol; x++) {
            hotComment.removeCommentAtCell(y, x);
        }
    }

}

 Trans.prototype.drawGridTranslatorMenu = function() {
    if (!this.translatorContextMenuIsInitialized) {

        TranslatorEngine.translators = TranslatorEngine.translators || {};

        if (empty(TranslatorEngine.translators)) return;

        this.gridContextMenu.translateUsing.submenu.items = [];
        for (var id in TranslatorEngine.translators) {
            (()=> {
                var thisId         = id;
                var thisEngine     = TranslatorEngine.translators[id];
                this.gridContextMenu.translateUsing.submenu.items.push({
                    key: `translateUsing:${thisId}`,
                    name: thisEngine.name,
                    callback : ()=> {
                        this.translateSelection(undefined, {translatorEngine:thisEngine});
                    },
                    hidden : ()=> {
                        if (this.grid.isColumnHeaderSelected()) return true;
                        if (this.grid.isRowHeaderSelected()) return true;
                    }
                })
            })()
        }
        this.translatorContextMenuIsInitialized = true;
    }

    return this.gridContextMenu;
}

 Trans.prototype.getGridContextMenu = function() {

    this.drawGridTranslatorMenu();
    return this.gridContextMenu;
}

Trans.prototype.updateGridContextMenu = function(menu) {

    if (!this.gridContextMenuIsModified) return;
}

Trans.prototype.modifyGridContextMenu = function(menu) {
    this.gridContextMenuIsModified = true;
}

Trans.prototype.injectSceneCss = function() {
    if (document.getElementById("sceneGraphCss")) return;
    var style = document.createElement("style");
    style.id = "sceneGraphCss";
    style.textContent = [
        ".handsontable tr.scene-start > td { border-top: 2px solid var(--accent-blue) !important; }",
        // Row-header th carries its own filter: invert(100%) in night mode
        // (!nightMode.css), on top of the page's invert(92%). So it needs the
        // LIGHT value here, not the night-mode variable, or it comes out orange.
        ".handsontable tr.scene-start > th { border-top: 2px solid #4a90d9 !important; }",
        ".footer .sceneInfo { color: var(--accent-blue); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; max-width: 600px; }",
        ".sceneGraphPanel { position: fixed; top: 50px; right: 20px; width: 420px; max-height: 70vh; overflow-y: auto; background: #fff; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.2); z-index: 8500; padding: 12px; font-size: 12px; }",
        ".sceneGraphPanel .sgHeader { font-weight: bold; font-size: 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; }",
        ".sceneGraphPanel .sgClose { cursor: pointer; font-size: 18px; }",
        ".sceneGraphPanel .sgScene { margin-bottom: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer; }",
        ".sceneGraphPanel .sgScene:hover { background: #e8f0fe; }",
        ".sceneGraphPanel .sgSceneLabel { font-weight: bold; color: #333; }",
        ".sceneGraphPanel .sgSceneMeta { color: #888; font-size: 11px; }",
        ".sceneGraphPanel .sgSceneLinks { color: var(--accent-blue); font-size: 11px; margin-top: 2px; }",
        ".sceneGraphPanel .sgStats { margin-bottom: 8px; padding: 6px 8px; background: #f5f5f5; border-radius: 4px; font-size: 11px; color: #666; }",
        // Accent colours come from the night-mode-safe variables in trans.css
        // (--accent-blue flips to its inverse under body.nightMode).
    ].join("\n");
    document.head.appendChild(style);
}

Trans.prototype.showSceneGraphPanel = function() {
    $(".sceneGraphPanel").remove();
    if (!SceneGraph.isAvailable()) {
        alert("Scene Graph is not available for this project. It requires an RPG Maker game (MV/MZ or an unpacked XP/VX/VX Ace project).");
        return;
    }
    this.injectSceneCss();

    var stats = SceneGraph.getStats();
    var scenes = SceneGraph.getAllScenes();
    var linkedCount = 0;
    for (var i = 0; i < scenes.length; i++) {
        if (scenes[i].ceCalls.length > 0) linkedCount++;
    }

    var html = '<div class="sceneGraphPanel">';
    html += '<div class="sgHeader"><span>Scene Graph</span><span class="sgClose" onclick="$(\'.sceneGraphPanel\').remove()">&times;</span></div>';
    html += '<div class="sgStats">';
    html += (stats.totalScenes || 0) + " scenes · ";
    html += (stats.totalMapped || 0) + " rows mapped · ";
    html += linkedCount + " scenes with Common Event calls · ";
    html += (stats.scenesWithCallers || 0) + " common events with callers";
    html += "</div>";

    for (var s = 0; s < scenes.length; s++) {
        var scene = scenes[s];
        if (scene.rowCount === 0 && scene.totalOrders === 0) continue;
        html += '<div class="sgScene" data-sceneid="' + scene.id + '" onclick="trans.jumpToScene(\'' + scene.id + '\')">';
        html += '<div class="sgSceneLabel">' + scene.label + "</div>";
        html += '<div class="sgSceneMeta">' + scene.rowCount + " rows";
        if (scene.speakersByListIndex) {
            var speakers = {};
            for (var k in scene.speakersByListIndex) {
                var sp = scene.speakersByListIndex[k];
                if (sp) speakers[sp] = true;
            }
            var spList = Object.keys(speakers);
            if (spList.length > 0) {
                html += " · Speakers: " + spList.join(", ");
            }
        }
        html += "</div>";
        if (scene.ceCalls && scene.ceCalls.length > 0) {
            html += '<div class="sgSceneLinks">→ Calls: ';
            for (var cc = 0; cc < scene.ceCalls.length; cc++) {
                var ceTarget = scene.ceCalls[cc].target;
                var ceScene = SceneGraph.getScene("CommonEvents#" + ceTarget);
                var ceName = ceScene ? ceScene.eventName : ("CE #" + ceTarget);
                html += "CommonEvent[" + ceTarget + "]" + (ceName ? " \"" + ceName + "\"" : "");
                if (cc < scene.ceCalls.length - 1) html += "; ";
            }
            html += "</div>";
        }
        if (scene.type === "commonevent" && scene.callers && scene.callers.length > 0) {
            html += '<div class="sgSceneLinks">← Called from ' + scene.callers.length + " location(s)</div>";
        }
        html += "</div>";
    }
    html += "</div>";

    $("body").append(html);

    // Make the panel draggable by its header so the user can move it aside.
    (function() {
        var $sgPanel = $(".sceneGraphPanel");
        $sgPanel.find(".sgHeader").on("mousedown.sceneGraphDrag", function(e) {
            if ($(e.target).hasClass("sgClose")) return;
            var dragStartX = e.clientX, dragStartY = e.clientY;
            var rect = this.getBoundingClientRect();
            var startX = rect.left, startY = rect.top;
            $(document).on("mousemove.sceneGraphDrag", function(ev) {
                $sgPanel.css({ left: (startX + ev.clientX - dragStartX) + "px", top: (startY + ev.clientY - dragStartY) + "px", right: "auto" });
            });
            $(document).on("mouseup.sceneGraphDrag", function() {
                $(document).off("mousemove.sceneGraphDrag mouseup.sceneGraphDrag");
            });
            e.preventDefault();
        });
    })();

    Trans.ensureSceneGraphLoadingHide();
}

// Hide the Scene Graph panel while the loading overlay is up (batch translation,
// project creation, etc.) and restore it afterwards. Set up once.
Trans.ensureSceneGraphLoadingHide = function() {
    if (window._sgLoadingHideSetup) return;
    window._sgLoadingHideSetup = true;
    var attach = function() {
        var lo = document.getElementById("loadingOverlay");
        if (!lo) { setTimeout(attach, 1000); return; }
        var wasOpen = false;
        var sync = function() {
            var loadingVisible = (typeof ui !== "undefined" && typeof ui.isLoadingOverlayVisible === "function") ? ui.isLoadingOverlayVisible() : (!$(lo).hasClass("hidden"));
            var $p = $(".sceneGraphPanel");
            if (loadingVisible) {
                if ($p.length && $p.is(":visible")) { wasOpen = true; $p.hide(); }
            } else if (wasOpen) {
                $p = $(".sceneGraphPanel");
                if ($p.length) $p.show();
                wasOpen = false;
            }
        };
        if (typeof MutationObserver !== "undefined") {
            (new MutationObserver(sync)).observe(lo, { attributes: true, attributeFilter: ["class", "style"] });
        }
        sync();
    };
    attach();
};

Trans.prototype.jumpToScene = function(sceneId) {
    var dialogue = SceneGraph.getSceneDialogue(sceneId);
    if (!dialogue || dialogue.length === 0) return;
    var first = dialogue[0];
    if (!first || !first.file) return;
    this.selectFile(first.file);
    var self = this;
    setTimeout(function() {
        try {
            self.grid.selectCell(first.rowIndex, 0);
            self.grid.deselectCell();
            self.grid.selectCell(first.rowIndex, 1);
        } catch(e) {}
    }, 100);
}

Trans.prototype.initTable = function(options) {
    options = options||{};

    var container = document.getElementById('table');
    if (Boolean(container) == false) return false;

    this.injectSceneCss();

    Handsontable.dom.addEvent(container, 'blur', function(event) {

    });

    this.grid = new Handsontable(container, {
        data        : trans.data,
        comments    : true,
        rowHeaders    : true,
        colHeaders    : trans.colHeaders,
        columns        : trans.columns,
        formulas    : false,
        search        : true,
        outsideClickDeselects:false,
        viewportColumnRenderingOffset:15,
        maxCols: Trans.maxCols,
        autoRowSize: false,
        rowHeights: function(row) {
            var h = trans.selectedData && trans.selectedData.rowHeights;
            return (h && h[row] != null) ? h[row] : undefined;
        },

        minSpareRows    : 1,
        filters            : false,
        dropdownMenu    : false,
        autoWrapRow        : true,
        manualColumnMove: true,

        manualColumnResize: true,
        copyPaste        : true,
        beforeChange: function (changes, source) {

            if (typeof trans.selectedData == 'undefined') return void 0;

            for (var i=0; i<changes.length; i++) {

                if (changes[i][1]==0 && changes[i][0] < (trans.grid.getData().length - 1)) {

                    trans.alert("You should not edit key value");
                    return false;
                }

                if (changes[i][1] != 0) continue;

                if (Boolean(changes[i][3]) == false) return false;

                if (trans.isKeyExistOn(changes[i][3])) {
                    trans.alert("Ilegal value"+" <b>'"+changes[i][3]+"'</b> "+"That value already exist!");
                    return false;
                }

                if (typeof trans.findIdByIndex(changes[i][2]) == 'number') delete trans.indexIds[changes[i][2]];

                trans.selectedData.indexIds[changes[i][3]] = changes[i][0];
            }

        },
        afterChange: function (changes, source) {

            trans.gridIsModified(true);
            if (changes == null) return true;

            if (!trans.getSelectedId()) return true;

            var isChanged = false;
            var progress = trans.project.files[trans.getSelectedId()].progress;

            for (var cell in changes) {
                if (Array.isArray(changes[cell]) == false) continue;
                if (!trans.data[changes[cell][0]][0]) continue;
                changes[cell][2]=changes[cell][2]||"";
                changes[cell][3]=changes[cell][3]||"";

                if (changes[cell][0] == trans.lastSelectedCell[0] && changes[cell][1] == trans.lastSelectedCell[1]) {

                    trans.textEditorSetValue(changes[cell][3]);
                }

                if (changes[cell][2].length>0 && changes[cell][3].length==0) {

                    if (trans.countFilledCol(changes[cell][0]) == 0) {

                        if (progress.translated <= 0) continue;
                        progress.translated --;
                        if (progress.length > 0) {
                            progress.percent = progress.translated/progress.length*100;
                        } else {
                            progress.percent = 0;
                        }
                        isChanged = true;
                    }
                } else if (changes[cell][2].length==0 && changes[cell][3].length>0) {

                    if (trans.countFilledCol(changes[cell][0]) == 1) {

                        if (progress.translated >= progress.length) continue;
                        progress.translated ++;
                        if (progress.length > 0) {
                            progress.percent = progress.translated/progress.length*100;
                        } else {
                            progress.percent = 0;
                        }
                        isChanged = true;
                    }
                }
            }
            if (isChanged) {
                var result ={};
                result[trans.getSelectedId()] = progress;
                trans.evalTranslationProgress(trans.getSelectedId(), result);

            }
            trans.remeasureChangedRows(changes);
            // SLR: automated fixes/inserts/checks (PostBatch.fixTranslatedCell) must only
            // run after AUTOMATED translations. Manual user edits (type/paste/fill/undo,
            // also via the #currentCellText editor) intentionally get NO post-processing,
            // so nothing is run here. Automated paths call trans.slrFixCell() themselves.
            trans.trigger("afterCellChange", [changes, source]);

        },
        beforeContextMenuShow : (menu) => {
            trans.updateGridContextMenu(menu)
        },
        contextMenu: {
            items: trans.getGridContextMenu()
        },

        cells: function (row, col, prop) {
            var cellProperties = {};
            if (col==0) {
                if (typeof trans.data[row] == 'undefined') return cellProperties;
                if (trans.data[row][col] !== null && trans.data[row][col]!=="") {
                    cellProperties.readOnly = true;
                }
            }

            return cellProperties;
        },
        afterSelection: function(row, column, row2, column2, preventScrolling, selectionLayerLevel) {

            trans.trigger("beforeProcessSelection", arguments);
            trans.doAfterSelection(row, column, row2, column2);

        },
        beforeInit: function() {

        },
        afterInit: function() {
            trans.buildIndex();
        },
        beforeColumnMove: function(columns, target) {

            if (target == 0) return false;
            if (columns.includes(0) == true) return false;

            trans.moveColumn(columns, target);
            return true;
        },
        afterColumnMove: function(columns, target) {

            if (target == 0) return false;
            if (columns.includes(0) == true) return false;

            return true;
        },
        afterColumnResize: function() {
            trans.invalidateRowHeights();
            trans.ensureRowHeights();
            trans.grid.render();
        },
        afterSetCellMeta:  function(row, col, source, val){
            if(source == 'comment'){
                var thisData = trans.getSelectedObject();
                if (!thisData) return true;

                if (val == undefined) {
                    try {
                        delete thisData.comments[row][col];
                    }
                    catch(err) {

                    }
                    return true;
                } else {
                    thisData.comments = thisData.comments||[];
                    thisData.comments[row] = thisData.comments[row]||[];
                    thisData.comments[row][col] = val.value;
                    return true;
                }

            }

        },
        afterRender:function(isForced) {
            if (isForced == true) return true;

            if ($("#currentCellText").is(":focus")) {

                var visibleCell = ui.getCurrentEditedCellElm();
                if (visibleCell !== false) {
                    $("#table .currentCell").removeClass("currentCell");
                    visibleCell.addClass("currentCell");
                }
            }
        },

        afterRenderer:function(TD, row, column, prop, val, cellProperties) {

            TD.setAttribute("data-coord", row+"-"+column);

            if (SceneGraph.isAvailable() && trans.getSelectedId() && row < (trans.data ? trans.data.length : 0)) {
                var sgInfo = SceneGraph.getRowSceneInfo(trans.getSelectedId(), row);
                if (sgInfo && sgInfo.sceneId) {
                    var $sgTR = $(TD).closest("tr");
                    $sgTR.attr("data-scene", sgInfo.sceneId);
                    if (sgInfo.speaker) {
                        $sgTR.attr("data-speaker", sgInfo.speaker);
                    }
                    var sgPrev = (row > 0) ? SceneGraph.getRowSceneInfo(trans.getSelectedId(), row - 1) : null;
                    if (!sgPrev || sgPrev.sceneId !== sgInfo.sceneId) {
                        $sgTR.addClass("scene-start");
                    }
                }
            }

            if (column > 0) {
                if (trans.getOption("gridInfo")?.isRuleActive) {
                    if (trans.getOption("gridInfo")?.viewOrganicCellMarker && trans.isOrganicCell(row, column)) {
                        $(TD).addClass("organic");
                    } else if (trans.getOption("gridInfo")?.viewTrail && trans.isVisitedCell(row, column)) {
                        $(TD).addClass("viewed");
                    }
                }
            }

            if (column > 0) return;
            if (trans.selectedData && Array.isArray(trans.selectedData.tags) && trans.selectedData.tags[row] && trans.selectedData.tags[row].indexOf("num") != -1 && typeof val === "string") {
                TD.textContent = val.replace(/\s*SLRnumbah.*$/, "");
            }

            if (row >= trans.data.length - 1) $(TD).addClass("newKeyField");

        },

        afterGetRowHeader: function(row, TH) {
            var $thisTH = $(TH)
            var $thisTR = $(TH).closest("tr");
            var $rowInfo = $thisTH.find(".rowInfo");
            if (!$rowInfo.length) {
                let $wrapper = $thisTH.find(">div");
                $rowInfo = $('<span class="rowInfo"></span>').appendTo($wrapper)
            }

            (()=> {

                if (typeof trans.selectedData == 'undefined') return;
                if (Array.isArray(trans.selectedData.tags) == false) return;
                if (Array.isArray(trans.selectedData.tags[row]) == false) return;
                if ($thisTR.hasClass("tagRendered") == true) return;

                let shadowPart = [];
                let borderOffset = 0;
                for (var i=0; i<trans.selectedData.tags[row].length; i++) {

                    var segmTag = trans.selectedData.tags[row][i];
                    if (typeof consts.tagColor[segmTag] !== 'undefined') {
                        borderOffset+=consts.tagStripThickness;
                        shadowPart.push('inset '+borderOffset+'px 0px 0px 0px '+consts.tagColor[segmTag]);
                    }
                    $thisTH.addClass("tag-"+trans.selectedData.tags[row][i]);
                }
                if (shadowPart.length != 0) {
                    $thisTH.css("box-shadow", shadowPart.join(","));
                }
                $thisTR.addClass("hasTag");
                $thisTR.addClass("tagRendered");
            })()

            if (ui.translationByContext) {
                (()=> {
                    if (!trans.rowHasMultipleContext(row, trans.selectedData)) return;
                    $thisTH.addClass("hasMC")
                    if (ui.translationByContext.rowHasContextTranslation(row, trans.selectedData)) $thisTH.addClass("hasTC");

                })()
            }

            (()=>{
                let rowInfoText = trans.getRowInfoText(row);
                if (rowInfoText) {
                    $rowInfo.text(rowInfoText)
                } else {
                    $rowInfo.text("")
                }
            })()
        },
        afterCreateRow:function(index, amount, source) {
            var thisFile = trans.getSelectedId();
            if (Boolean(thisFile) == false) return false;
            trans.evalTranslationProgress([thisFile]);
        },
        beforePaste:function(data, coords) {

        },
        afterScrollVertically() {
        }

    });

    Handsontable.dom.addEvent($("#quickFind")[0], 'input', function (event) {
        var search = trans.grid.getPlugin('search');
        var queryResult = search.query(this.value);

        trans.grid.render();
    });

    trans.grid.isColumnHeaderSelected = function() {

        return Boolean($(".htCore thead th.ht__active_highlight").length);
    }
    trans.grid.isRowHeaderSelected = function() {
        return Boolean($(".htCore tr th.ht__active_highlight").length);
    }

    trans.grid.insertColumnRight = function(colName, pos) {
        if (trans.columns.length >= Trans.maxCols) {
            alert("The maximum number of columns for this project has been reached, so you cannot add any more.")
            return;
        }
        colName = colName||"New Col";
        var getCol = pos||trans.grid.getSelected()[0][1];
        var getColSet = trans.columns.length;
        trans.columns.push({});
        common.arrayExchange(trans.columns, getColSet, getCol + 1);
        common.arrayInsert(trans.colHeaders, getCol+1, colName);

        trans.insertCell(getCol+1, null);

        trans.grid.updateSettings({
            colHeaders:trans.colHeaders
        })
    }

    trans.grid.setColWidth = function(colIndex, newWidth) {

        if (!trans.columns[colIndex]) return;
        trans.columns[colIndex].width = newWidth;
        trans.refreshGrid();
    }

    trans.grid.addHeight = function(num) {

        var currentHeight = parseInt($(".handsontable .ht_master .wtHider").eq(0).css("height"));
        if (!num) return currentHeight;
        var newHeight = num+currentHeight;
        $(".handsontable .ht_master .wtHider").eq(0).css("height", newHeight+"px")
        $(".handsontable .ht_clone_left .wtHider").eq(0).css("height", newHeight+"px")
    }

    this.ensureRowHeights();
}

Trans.prototype.findAndInsertWithIndexes = function(find="", value, columns, indexes, options) {

    columns = columns||1;
    options = options||{};
    find ||= "";
    options.overwrite         = options.overwrite||false;
    options.files             = options.files||[];
    options.keyColumn        = options.keyColumn || this.keyColumn || 0;
    options.insensitive        = options.insensitive || false;
    options.lineByLine        = options.lineByLine || false;
    options.customFilter;
    indexes                 = indexes || this._tempIndexes;

    if (typeof options.ignoreNewLine == "undefined") options.ignoreNewLine = true;

    if (options.files.length == 0) {
        options.files = this.getAllFiles();
    }

    var result = {
        keyword    :find,
        count    :0,
        executionTime:0,
        files    :{}
    };

    var indexObjects = this.getFromIndexes(find, indexes, options.customFilter);

    if (!indexObjects && find.includes("\r")) {

        find = find.replaceAll("\r", "");
        result.find = find;
        indexObjects = this.getFromIndexes(find, indexes, options.customFilter);
    }
    if (!indexObjects) return result;

    for (let i=0; i<indexObjects.length; i++) {
        let thisAddress = indexObjects[i];
        var file = thisAddress.file;
        var row = thisAddress.row;
        if (options.ignoreNewLine) {
            if (Boolean(this.project.files[file].lineBreak) !== false) {
                find = common.replaceNewLine(find, this.project.files[file].lineBreak);
            }
        }

        if (typeof row == 'number') {
            var thisRow = this.getData(file)[row];
            if (!thisRow) continue;
            if (options.filterTagMode == "blacklist") {
                if (this.hasTags(options.filterTag, row, file)) continue;
            } else if (options.filterTagMode == "whitelist") {
                if (!this.hasTags(options.filterTag, row, file)) continue;
            }

            if (options.lineByLine) {
                var currentText = thisRow[columns] || "";
                var currentLines = currentText.replaceAll("\r", "").split("\n");
                if (options.overwrite == false) {
                    if (Boolean(currentLines[thisAddress.line]) == true) continue;
                }
                currentLines[thisAddress.line] = value
                thisRow[columns] = currentLines.join("\n");

            } else {

                if (options.overwrite == false) {
                    if (Boolean(thisRow[columns]) == true) continue;
                }
                thisRow[columns] = value;
            }

            result.files[file] = result.files[file] || [];
            result.files[file].push({
                'fullString':thisRow[columns],
                'row':row,
                'col':columns,
                'type':'cell',
                'lineIndex':null
            });
            result.count++;
        }
    }

    this.slrFixResultFiles(result);
    return result;
}

 Trans.prototype.findAndInsert = function(find, values, columns, options) {

    columns = columns||1;
    options = options||{};
    options.overwrite         = options.overwrite||false;
    options.files             = options.files||[];
    options.keyColumn        = options.keyColumn || this.keyColumn || 0;
    options.insensitive        = options.insensitive || false;

    if (typeof options.ignoreNewLine == "undefined") options.ignoreNewLine = true;

    if (options.files.length == 0) {
        options.files = this.getAllFiles();
    }

    var result = {
        keyword    :find,
        count    :0,
        executionTime:0,
        files    :{}
    };

    for (let i=0; i<options.files.length; i++) {
        let file = options.files[i];
        if (options.ignoreNewLine) {
            if (Boolean(this.project.files[file].lineBreak) !== false) {
                find = common.replaceNewLine(find, this.project.files[file].lineBreak);
            }
        }
        var row
        if (options.insensitive) {
            row = this.getRowIdByTextInsensitive(find, file)
        } else {
            row = this.findIdByIndex(find, file);
        }

        if (typeof row == 'number') {
            var thisRow = this.getData(file)[row];
            if (!thisRow) continue;
            if (options.filterTagMode == "blacklist") {
                if (this.hasTags(options.filterTag, row, file)) continue;
            } else if (options.filterTagMode == "whitelist") {
                if (!this.hasTags(options.filterTag, row, file)) continue;
            }

            if (options.overwrite == false) {
                if (Boolean(thisRow[columns]) == true) continue;
            }
            thisRow[columns] = values;

            result.files[file] = result.files[file] || [];
            result.files[file].push({
                'fullString':thisRow[columns],
                'row':row,
                'col':columns,
                'type':'cell',
                'lineIndex':null
            });
            result.count++;
        }
    }

    this.slrFixResultFiles(result);
    return result;
}

 Trans.prototype.findAndInsertLine = function(find, values, columns, options) {

    columns             = columns||1;
    options             = options||{};
    options.overwrite     = options.overwrite||false;
    options.files         = options.files||[];
    options.keyColumn     = options.keyColumn||0;
    options.newLine     = options.newLine||undefined;
    options.stripCarriageReturn = options.stripCarriageReturn||false;

    if (options.stripCarriageReturn) {
        find = common.stripCarriageReturn(find);
    }

    if (options.files.length == 0) {
        if (typeof trans.allFiles != 'undefined') {
            options.files = trans.allFiles;
        } else {
            for (var file in trans.project.files) {
                options.files.push(file);
            }
            trans.allFiles = options.files;
        }
    }
    for (var i=0; i<options.files.length; i++) {
        file = options.files[i];
        var thisData = trans.project.files[file].data;
        var thisNewLine = options.newLine||trans.project.files[file].lineBreak||"\n";
        for (var row=0; row<thisData.length; row++) {
            let keySegment
            if (!thisData[row][options.keyColumn]) continue;

            if (options.filterTagMode == "blacklist") {
                if (this.hasTags(options.filterTag, row, file)) continue;
            } else if (options.filterTagMode == "whitelist") {
                if (!this.hasTags(options.filterTag, row, file)) continue;
            }

            thisData[row][options.keyColumn] = thisData[row][options.keyColumn]||"";
            if (options.stripCarriageReturn) {
                keySegment = thisData[row][options.keyColumn].replaceAll("\r", "").split("\n");

            } else {
                keySegment = thisData[row][options.keyColumn].split("\n");
            }
            if (keySegment.includes(find) == false) continue;
            thisData[row][columns]     = thisData[row][columns]||"";
            var targetSegment         = thisData[row][columns].replaceAll("\r", "").split("\n");

            targetSegment             = common.searchReplaceArray(keySegment, targetSegment, find, values, {overwrite:options.overwrite});
            thisData[row][columns]     = targetSegment.join(thisNewLine);
        }

    }
}

 Trans.prototype.findAndInsertByContext = function(find, values, columns, options) {

    columns             = columns||1;
    options             = options||{};
    options.overwrite     = options.overwrite||false;
    options.files         = options.files||[];
    options.ignoreNewLine = options.ignoreNewLine||false;

    if (options.files.length == 0) {
        options.files = this.getAllFiles();
    }

    for (let i=0; i<options.files.length; i++) {
        let file = options.files[i];
        var thisObj = this.getObjectById(file);
        if (Boolean(thisObj) == false) continue;
        if (Boolean(thisObj.context) == false) continue;

        for (var row=0; row<thisObj.context.length; row++) {
            var contextByRow = thisObj.context[row];
            if (Array.isArray(contextByRow) == false) continue;
            if (contextByRow.length < 1) continue;
            if (Array.isArray(thisObj.data[row]) == false) continue;
            for (var contextId=0; contextId<contextByRow.length; contextId++) {
                if (find !== contextByRow[contextId]) continue;

                if (options.overwrite == false) {
                    if (Boolean(thisObj.data[row][columns]) == true) continue;
                }
                thisObj.data[row][columns] = values;
            }
        }
    }
}

 Trans.prototype.translateTextByLine = function(text, translationPair, options) {

    if (typeof text !== 'string') return text;
    if (text.length < 1) return text;

    var translated = "";
    var translatedLine = [];
    var lines = text.replace(/(\r\n)/gm, "\n").split("\n");

    for (var i=0; i<lines.length; i++) {
        var line = lines[i];

        if (translationPair[line]) {
            translatedLine.push(translationPair[line]);

            continue;
        }

        translatedLine.push("");
    }

    translated = translatedLine.join("\n");

    return translated;

}

 Trans.prototype.translateFromArray = function(obj, columns, options) {

    columns = columns||1;
    options = options||{};
    options.sourceColumn = options.sourceColumn||"auto";
    options.overwrite = options.overwrite||false;
    options.files = options.files||[];
    options.sourceKeyColumn = options.sourceKeyColumn||0;
    options.keyColumn = options.keyColumn||0;
    options.newLine = options.newLine||undefined;
    options.stripCarriageReturn = options.stripCarriageReturn||false;
    options.ignoreNewLine = true;

    obj = obj||[];

    if (obj.length == 0) return false;

    for (var rowId=0; rowId<obj.length; rowId++) {
        var translation;
        var row = obj[rowId];
        if (Boolean(row[options.sourceKeyColumn]) == false) continue;

        var keyString = row[options.sourceKeyColumn];
        if (options.sourceColumn == 'auto') {
            translation = trans.getTranslationFromRow(row, options.sourceKeyColumn);
        } else {
            translation = row[options.sourceColumn];
        }

        trans.findAndInsert(keyString, translation, columns, options);
    }
}

 Trans.prototype.abortTranslation = function() {
    trans.translator = trans.translator||[];
    if (typeof trans.translationTimer !== 'undefined') {
        clearTimeout(trans.translationTimer);
    }

    for (var i=0; i<trans.translator.length; i++) {
        let translator = trans.translator[i];
        var thisTranslator = trans.getTranslatorEngine(translator)
        if (!thisTranslator) continue;

        if (typeof thisTranslator.abort == "function") {
            try {
                thisTranslator.abort();
            } catch (e) {
                ui.log("Failed to abort with message", e.toString());
            }
        }
        thisTranslator.job = thisTranslator.job||{};
        thisTranslator.job.wordcache = {};
        thisTranslator.job.batch = [];
    }
    // The loading overlay is intentionally NOT hidden here: after an abort the translation
    // log (including the run's quality summary) must stay readable. The caller swaps the
    // buttons for a Close button (ui.showCloseButton), and only that Close button hides
    // the overlay (via ui.hideLoading).
    trans.refreshGrid();
    trans.evalTranslationProgress();
}

 Trans.prototype.translateStringByPair = function(str, translationPair, caseInSensitive) {
    caseInSensitive = caseInSensitive||false;
    if (typeof str !== 'string') return str;
    if (typeof translationPair !== 'object') return str;
    for (var key in translationPair) {
        str = str.replaces(key, translationPair[key], caseInSensitive);
    }
    return str;
}

Trans.prototype.translateFromTrans = function(text, fileFilter = [], transData = this) {
    if (!text) return "";
    if (typeof fileFilter == "string") fileFilter = [fileFilter];

    const files = transData?.project?.files || {};
    if (!fileFilter?.length) {
        fileFilter = this.getAllFiles(files);
    }

    const getInstance = (text) => {
        for (let i in fileFilter) {
            let fileId = fileFilter[i]
            let index = this.getIndexByKey(fileId, text);
            if (typeof index == "undefined") continue;
            let data = this.getData(fileId);
            if (empty(data[index])) return "";
            let translation = this.getTranslationFromRow(data[index])
            if (translation) return translation;
        }
    }

    if (Array.isArray(text)) {
        let result = []
        for (let i in text) {
            result[i] = getInstance(text[i]) || ""
        }
        return result;
    } else {
        return getInstance(text);
    }
}

Trans.prototype.translateByReference = function(input, caseInSensitive, referenceName) {
    return input;
}

 Trans.prototype.rowHasTranslation = function(row, keyColumn) {
    keyColumn = this.keyColumn || 0;
    if (empty(row)) return false;
    for (var i=0; i<row.length; i++) {
        if (i == keyColumn) continue;
        if (row[i]) return true;
    }
    return false;
}


 Trans.prototype.getTranslatorEngine = function(id) {
    if (TranslatorEngine.translators[id]) return TranslatorEngine.translators[id];
    if (this.engines && this.engines[id]) return this.engines[id];

}

/**
 * Register a translator engine so it can be looked up by id. Replaces the old
 * `trans[id] = engine` global mutation with a named registry.
 * @param {String} id - Engine id
 * @param {*} engine - The translator engine instance
 * @returns {*} The registered engine
 */
Trans.prototype.registerEngine = function(id, engine) {
    this.engines = this.engines || {};
    this.engines[id] = engine;
    return engine;
}

 Trans.prototype.getActiveTranslatorEngine = function() {
    var doInitLang = function() {
        var conf = confirm("Source & target language and the default translator engine is not yet defined for this project.\r\nPlease set it up in option menu!\r\nDo you want to set this options now?");
        if (conf) ui.openOptionsWindow();
    }

    this.project.options     = this.project.options || {};
    var currentPlugin         = this.project.options.translator||sys.config.translator;
    if (typeof currentPlugin == 'undefined') return doInitLang();
    return this.getTranslatorEngine(currentPlugin);
}

Trans.prototype.getSceneContextForRows = function(fileId, rowIndexes, currentEngine) {
    if (typeof SceneGraph === 'undefined' || !SceneGraph.isAvailable()) return null;
    var sceneIds = [];
    for (var i = 0; i < rowIndexes.length; i++) {
        var info = SceneGraph.getRowSceneInfo(fileId, rowIndexes[i]);
        if (info && info.sceneId && sceneIds.indexOf(info.sceneId) === -1) {
            sceneIds.push(info.sceneId);
        }
    }
    if (sceneIds.length === 0) return null;
    var textProcessor = null;
    if (currentEngine && currentEngine.processor && typeof currentEngine.processorInit === 'function') {
        currentEngine.processorInit();
        var processor = currentEngine.processor;
        textProcessor = function(rawText) {
            var p = processor.process(rawText);
            var processed = p.getTranslatableLines();
            return processed.length > 0 ? processed.join("\n") : rawText;
        };
    }
    if (sceneIds.length === 1) {
        return SceneGraph.getSceneAIContext(sceneIds[0], textProcessor);
    }
    var merged = [];
    for (var si = 0; si < sceneIds.length; si++) {
        var ctx = SceneGraph.getSceneAIContext(sceneIds[si], textProcessor);
        if (ctx) merged.push(ctx);
    }
    return merged.length > 0 ? merged.join("\n\n") : null;
}

Trans.prototype.translateSelection = async function(currentSelection, options = {}) {

    var trans = this;
    currentSelection = currentSelection||trans.grid.getSelectedRange()||[[]];
    if (typeof currentSelection == 'undefined') {
        alert("nothing is selected");
        return false;
    }
    if (typeof trans.translator == "undefined" || trans.translator.length < 1) {
        alert("no translator loaded");
        return false;
    }

    var currentEngine     = options.translatorEngine || this.getActiveTranslatorEngine();
    options.mode         ||= currentEngine.mode
    options.ignoreWhitespace ||= currentEngine.ignoreWhitespace

    if (currentEngine.isDisabled == true) return alert(currentEngine.id+" is disabled!");

    ui.tableCornerShowLoading();

    var textPool = [];
    var thisData = trans.grid.getData();
    var rowPool = common.gridSelectedCells() || [];
    var tempTextPool = [];

    for (var i=0; i<rowPool.length; i++) {
        var col = rowPool[i].col;
        if (col == this.keyColumn) continue;
        tempTextPool.push(thisData[rowPool[i].row][this.keyColumn]);
    }

    if (!tempTextPool) return;

    var translationTable = trans.generateTranslationTableFromStrings(tempTextPool, currentEngine, options);

    translationTable = await this.processWith("translationTableFilter", translationTable, currentEngine) || translationTable;

    for (var phrase in translationTable.include) {
        textPool.push(phrase);
    }

    if (rowPool.length < 1) {
        ui.tableCornerHideLoading();
        return;
    }

    var preTransData;
    if (currentEngine.skipReferencePair) {
        preTransData = textPool;
    } else {
        preTransData = trans.translateByReference(textPool);
    }

    var _selRowIndexes = [];
    for (var ri = 0; ri < rowPool.length; ri++) {
        if (_selRowIndexes.indexOf(rowPool[ri].row) === -1) _selRowIndexes.push(rowPool[ri].row);
    }
    var _sceneContext = trans.getSceneContextForRows(trans.getSelectedId(), _selRowIndexes, currentEngine);

    currentEngine.translate(preTransData, {
        sceneContext: _sceneContext,
        onAfterLoading:async function(result) {

            trans.trigger("batchTranslationResult", {original:textPool, translation:result.translation, translator:currentEngine})

            var transTable = trans.generateTranslationTableFromResult(textPool, result.translation, translationTable.exclude);

            trans.applyTransTableToSelectedCell(transTable, currentSelection, undefined, options);

            ui.tableCornerHideLoading();
            trans.grid.render();
            trans.evalTranslationProgress();
            trans.textEditorSetValue(trans.getTextFromLastSelected());

        }
    });

}

 Trans.prototype.translateSelectionByRow = async function(currentSelection, options = {}) {
    options.mode = "rowByRow";
    return this.translateSelection(currentSelection, options = {})

}

 Trans.prototype.translateSelectionByLine = async function(currentSelection, options = {}) {
    options.mode = "lineByLine";
    return this.translateSelection(currentSelection, options = {})

}

Trans.prototype.translateSelectionAsOneLine = async function(currentSelection, options = {}) {

    currentSelection = currentSelection||trans.grid.getSelectedRange()||[[]];
    if (typeof currentSelection == 'undefined') {
        alert("nothing is selected");
        return false;
    }
    if (typeof trans.translator == "undefined" || trans.translator.length < 1) {
        alert("no translator loaded");
        return false;
    }
    var currentEngine = options.translatorEngine || this.getActiveTranslatorEngine();

    var originalText = this.getSelectedOriginalTexts(currentSelection);
    var sourceText = this.getSelectedOriginalTextsAsOneLine(currentSelection);
    var selectedRows = common.gridSelectedRows(currentSelection);
    var rowIndex = {};
    for (var i=0; i<selectedRows.length; i++) {
        rowIndex[selectedRows[i]] = i;
    }

    var data = this.getData();

    ui.tableCornerShowLoading();
    var preTransData;
    if (currentEngine.skipReferencePair) {
        preTransData = sourceText;
    } else {
        preTransData = trans.translateByReference(sourceText);
    }

    var _sceneContext = trans.getSceneContextForRows(trans.getSelectedId(), selectedRows, currentEngine);

    currentEngine.translate(preTransData, {
        mode: "rowByRow",
        sceneContext: _sceneContext,
        onAfterLoading: (result) => {
            if (typeof result.translation !== 'undefined') {

                var formattedResult = common.cloneFormatting(originalText, result.translation.join(" "));

                var selectedCells = common.gridSelectedCells(currentSelection)
                for (var i=0; i<selectedCells.length; i++) {
                    if (selectedCells[i].col == this.keyColumn) continue;
                    data[selectedCells[i].row][selectedCells[i].col] = formattedResult[rowIndex[selectedCells[i].row]];
                }
                this.slrCheckSelectedCellsForErrors(selectedCells);

            }

            ui.tableCornerHideLoading();
            trans.grid.render();
            trans.evalTranslationProgress();
            trans.textEditorSetValue(trans.getTextFromLastSelected());
        }
    });
}

 Trans.prototype.translateSelectionIntoDef =function(currentSelection) {

    currentSelection = currentSelection||trans.grid.getSelected()||[[]];
    if (typeof currentSelection == 'undefined') {
        alert("nothing is selected");
        return false;
    }
    if (typeof trans.translator == "undefined" || trans.translator.length < 1) {
        alert("no translator loaded");
        return false;
    }

    var textPool = [];
    var thisData = trans.grid.getData();

    var rowPool = [];
    for (var index=0; index<currentSelection.length; index++) {
        for (var row=currentSelection[index][0]; row<=currentSelection[index][2]; row++) {
            rowPool.push(row);
            textPool.push(thisData[row][0]);
        }
    }

    var dataString = textPool;

    for (var i=0; i<trans.translator.length; i++ ) {

        var currentPlugin = trans.translator[i];
        var thisTranslator = this.getTranslatorEngine(currentPlugin);
        if (thisTranslator.isDisabled == true) continue;
        if (typeof thisTranslator.targetColumn == "undefined") {

            continue;
        }

        var preTransData = trans.translateByReference(dataString);
        var _slrTranslateOptions = {};
        thisTranslator.translate(preTransData, Object.assign(_slrTranslateOptions, {
            onAfterLoading:function(result) {
                if (typeof result.translation !== 'undefined') {

                    var _slrFile = trans.getSelectedId();
                    var _slrEntries = [];
                    for (var x in result.translation) {
                        trans.data[rowPool[x]][thisTranslator.targetColumn] = result.translation[x];
                        trans.slrFixCell(_slrFile, rowPool[x], thisTranslator.targetColumn);
                        _slrEntries.push({ file: _slrFile, row: rowPool[x] });
                    }
                    trans.slrMaybeAlertErrors(_slrEntries);
                    // The DSLR engine reports its in-line semantic review outcomes
                    // on the options side-channel (`_reviewStateByIndex`, keyed by
                    // served line index, which for this path equals the row order in
                    // rowPool). Apply the QC tag to the grid so a single-line
                    // re-translation updates it exactly like a batch run would.
                    if (trans.batchCheckCells && typeof trans.batchCheckCells.applyReviewTagsToRows === "function") {
                        var _slrQcRows = [];
                        for (var x in result.translation) {
                            _slrQcRows.push({ location: [_slrFile, rowPool[x]] });
                        }
                        trans.batchCheckCells.applyReviewTagsToRows(_slrQcRows, _slrTranslateOptions);
                        trans.grid.render();
                    }
                }

                trans.grid.render();
                trans.evalTranslationProgress();

            }
        }));
    }

}

 Trans.prototype.applyTransTableToSelectedCell = function(transTable, currentSelection, transData, options) {

    transData             = transData||trans.data;
    currentSelection     = currentSelection||trans.grid.getSelected()||[[]];
    options             = options||{};
    options.indexKey     = options.indexKey||0;
    if (typeof currentSelection == 'undefined') {
        alert("nothing is selected");
        return false;
    }

    var rowPool = common.gridSelectedCells(currentSelection) || [];
    if (options.mode == "rowByRow") {
        for (let i=0; i<rowPool.length; i++) {
            let col = rowPool[i].col;
            let row = rowPool[i].row;
            if (col == this.keyColumn) continue;

            if (Array.isArray(transData[row]) == false) continue;
            transData[row][col] = transTable[transData[row][options.indexKey]];
        }
    } else {
        for (let i=0; i<rowPool.length; i++) {
            let col = rowPool[i].col;
            let row = rowPool[i].row;
            if (col == this.keyColumn) continue;

            if (Array.isArray(transData[row]) == false) continue;

            transData[row][col] = this.translateTextByLine(transData[row][options.indexKey], transTable);
        }
    }
    this.slrCheckSelectedCellsForErrors(rowPool);
}

// SLR: run per-cell fixes/checks on ONE AUTOMATED-translated cell. Thin guarded
// wrapper around the batch pipeline's PostBatch.fixTranslatedCell. Only call this
// from automated translation/insertion paths (batch, right-click menus, "translate
// like this", import). It must NOT be called for manual user edits — those are
// supposed to reach the project untouched. Returns true when the check actually ran.
Trans.prototype.slrFixCell = function(file, row, col) {
    if (!window.trans || !trans.batchCheckCells || typeof trans.batchCheckCells.fixTranslatedCell !== "function") return false;
    if (!file || row == null || col == null) return false;
    if (col == this.keyColumn) return false;
    try {
        trans.batchCheckCells.fixTranslatedCell(file, row, col);
        return true;
    } catch (e) {
        console.warn("SLR fixTranslatedCell error:", e);
        return false;
    }
};

// SLR: run error detection over a findAndInsert(...) / findAndInsertWithIndexes(...)
// result, whose .files maps file -> [{row, col, ...}].
Trans.prototype.slrFixResultFiles = function(result) {
    if (!result || !result.files) return;
    for (var f in result.files) {
        var cells = result.files[f];
        if (!cells) continue;
        for (var i = 0; i < cells.length; i++) {
            this.slrFixCell(f, cells[i].row, cells[i].col);
        }
    }
};

// SLR: after a translation, show the "problematic cells" notice IF any of the
// just-translated cells now carry an error code. Only the translated cells are
// checked (the Errors column is reset+repopulated per cell by fixTranslatedCell, so a
// hit means THIS translation produced the error) so we don't re-alert on old errors.
Trans.prototype.slrMaybeAlertErrors = function(entries) {
    if (!entries || !entries.length) return;
    var _ec = (typeof slrFixErrCol !== "undefined") ? slrFixErrCol : 4;
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.file) continue;
        var row = trans.project.files[e.file] && trans.project.files[e.file].data[e.row];
        if (!row) continue;
        var c = row[_ec];
        if (c != null && String(c).indexOf("SHISAYE.") !== -1) {
            alert("The system has found one or more problematic cells and inserted corresponding error codes into them.\n\nUse the search function (Crtl+F) and search for \"SHISAYE\" (without quotes) to view a list of them.");
            return;
        }
    }
};

// SLR: run error detection over a list of {row, col} cells in the currently selected
// file (right-click "Translate here / Translate using..." and "Merge then translate"),
// then alert if any of them ended up with an error code.
Trans.prototype.slrCheckSelectedCellsForErrors = function(cells) {
    if (!cells || !cells.length) return;
    var file = trans.getSelectedId();
    if (!file) return;
    var done = {};
    var entries = [];
    for (var i = 0; i < cells.length; i++) {
        var row = cells[i].row;
        var col = cells[i].col;
        var key = row + "|" + col;
        if (done[key]) continue;
        done[key] = true;
        this.slrFixCell(file, row, col);
        entries.push({ file: file, row: row });
    }
    this.slrMaybeAlertErrors(entries);
};

// Legacy/unused: imports translations from old .trans reference files. Retained for reference; hidden from the UI (no active entry points).
 Trans.prototype.importTranslation = async function(refPath, options) {

    if (typeof refPath == 'undefined') return trans.alert("Reference path cannot empty!");
    options = options || {};
    options.targetColumn     = options.targetColumn||1;
    options.overwrite         = options.overwrite||false;
    options.files             = options.files||[];
    options.destination        = options.destination||[];
    options.compareMode        = options.compareMode||0;
    options.ignoreLangCheck = true;
    options.destinationMode    = options.destinationMode || "selected";
    options.caseInsensitive ||= false;

    if (!trans.getSelectedId()) {
        trans.selectFile($(".panel-left .fileList .data-selector").eq(0));
    }

    var lowerCaseText = undefined;
    if (options.caseInsensitive) {
        lowerCaseText = function(text) {
            return text.toLowerCase().replaceAll("\r", "");
        }
    }

    var applyImportedTranslation = async (loadedData) => {

        ui.loadingProgress(30, "Collecting translation refference");
        await ui.log("Collecting translation refference");

        var refTranslation = {};
        var tempIndexes;
        if (options.compareMode == 'lineByLine') {
            refTranslation = trans.generateTranslationTableLine(loadedData.project.files, options);
            let targetFiles;
            if (options.destinationMode == "selected") {
                targetFiles = this.getCheckedFiles()
            }
            tempIndexes = this.buildIndexes(targetFiles, true, {customFilter:lowerCaseText});
        } else if (options.compareMode == 'rowByRow') {
            refTranslation = trans.generateTranslationTable(loadedData.project.files, options);
            let targetFiles;
            if (options.destinationMode == "selected") {
                targetFiles = this.getCheckedFiles()
            }
            tempIndexes = this.buildIndexes(targetFiles, false, {customFilter:lowerCaseText});
        } else if (options.compareMode == 'contextTrans') {
            refTranslation = trans.generateContextTranslationPair(loadedData.project.files, options);
        }

        var numData = Object.keys(refTranslation).length
        await ui.log(`Processing ${numData} reference(s)`);
        ui.loadingProgress(50, "Applying translation!");
        var count = 0;
        var lastProgress = 50;
        if (options.compareMode == 'lineByLine') {
            for (let key in refTranslation) {
                let origKey = key;
                if (options.caseInsensitive) key = lowerCaseText(key);
                trans.findAndInsertWithIndexes(
                    key,
                    refTranslation[origKey],
                    options.targetColumn,
                    tempIndexes,
                    {
                        overwrite    :options.overwrite,
                        files        :options.destination,
                        lineByLine    :true,
                        customFilter:lowerCaseText
                    });
                ui.loadingProgress(50+(count/numData*50));
                count++;
            }
        } else if (options.compareMode == 'rowByRow') {

            for (let key in refTranslation) {
                let origKey = key;
                if (options.caseInsensitive) key = lowerCaseText(key);
                trans.findAndInsertWithIndexes(
                    key,
                    refTranslation[origKey],
                    options.targetColumn,
                    tempIndexes,
                    {
                        overwrite    :options.overwrite,
                        files        :options.destination,
                        insensitive    :true,
                        customFilter:lowerCaseText
                    });
                var thisProgress = Math.round(50+(count/numData*50))
                if (thisProgress > lastProgress) {
                    ui.loadingProgress(50+(count/numData*50));
                    await ui.log(`Handled: ${count}/${numData}`);
                    lastProgress = thisProgress;
                }

                count++;
            }
        } else if (options.compareMode == 'contextTrans') {

            for (var key in refTranslation) {
                trans.findAndInsertByContext(key, refTranslation[key], options.targetColumn, {
                    overwrite:options.overwrite,
                    files:options.destination
                });

                ui.loadingProgress(50+(count/numData*50));
                count++;
            }
        } else if (options.compareMode == 'copyByRow') {
            this.copyTranslationToRow(loadedData.project.files, options.targetColumn, options);
        }

        trans.trigger("onAfterImportTranslations", {
            options:options,
            loadedData:loadedData,
            refTranslation:refTranslation
        });

        await common.wait(20)
        trans.evalTranslationProgress();
        trans.refreshGrid();
        ui.loadingProgress(100, "Done!");
        ui.loadingEnd();

    }

    ui.showLoading();
    ui.loadingProgress(0, "Importing translation");
    await common.wait(200);

    if (typeof refPath == 'object' && typeof refPath.project !== 'undefined') {

        await applyImportedTranslation(refPath);

        return true;

    }

    fs.readFile(refPath, async function (err, data) {
        if (err) {

            data = data.toString();
            if (typeof options.onFailed =='function') options.onFailed.call(trans, data);

            throw err;
        } else {
            ui.loadingProgress(20, "Parsing data");
            await ui.log("Parsing data");
            await common.wait(200);

            data = data.toString();

            var jsonData = JSON.parse(data);

            applyImportedTranslation(jsonData);

            if (typeof options.onSuccess == 'function') options.onSuccess.call(trans, jsonData);
            trans.isOpeningFile = false;
        }
    });
}

Trans.prototype.translateAllBySelectedCells = async function(currentSelection, fileId, options) {
    currentSelection = currentSelection||this.grid.getSelectedRange()||[[]];
    fileId = fileId || this.getSelectedId();
    options = options || {};

    ui.showBusyOverlay();
    await common.wait(100);
    var targetFiles = this.getAllFilesExcept([fileId]);

    var selectedTransTable = this.generateSelectedTranslationTable(currentSelection, fileId, options);

    var tempIndexes = this.buildIndexes(targetFiles);
    var found = [];
    for (var keyword in selectedTransTable) {
        var foundCells = this.getFromIndexes(keyword, tempIndexes);
        if (!foundCells) continue;
        for (var y=0; y<foundCells.length; y++) {
            var foundCell = foundCells[y];
            var targetData = this.getData(foundCell.file);

            for (var i=0; i<selectedTransTable[keyword].length; i++) {
                var cellInfo = selectedTransTable[keyword][i];
                var oldValue = targetData[foundCell.row][cellInfo.col];
                if (cellInfo.col == this.keyColumn) continue;
                targetData[foundCell.row][cellInfo.col] = cellInfo.value;

                found.push({
                    file:foundCell.file,
                    row:foundCell.row,
                    col:cellInfo.col,
                    oldValue:oldValue,
                    newValue:cellInfo.value
                })
            }
        }
    }
    // SLR: error-detect every cell that was just translated across the project
    for (var _slrFi = 0; _slrFi < found.length; _slrFi++) {
        this.slrFixCell(found[_slrFi].file, found[_slrFi].row, found[_slrFi].col);
    }
    this.slrMaybeAlertErrors(found);
    ui.hideBusyOverlay();
    return found;
}

Trans.prototype.getSelectedTexts = function(currentSelection, fileId) {
    currentSelection = currentSelection||this.grid.getSelectedRange()||[[]];
    fileId = fileId || this.getSelectedId();
    var data = this.getData(fileId);
    var selectedCells = common.gridSelectedCells(currentSelection);

    var result = [];
    for (var i=0; i<selectedCells.length; i++) {
        result.push(
            data[selectedCells[i].row][selectedCells[i].col] || ""
        )
    }
    return result;
}

Trans.prototype.getText = function(row, column, file) {
    if (!file) {
        return this.data?.[row]?.[column]
    }
    const obj = trans.getObjectById(file);
    return obj?.[row]?.[column]
}

Trans.prototype.getCellComment = function(row, column, file) {
    let obj
    if (!file) {
        obj = this.getSelectedObject();
    } else {
        obj = this.getObjectById(file)
    }

    if (!obj.comments) return;
    return obj.comments?.[row]?.[column];

}

Trans.prototype.getSelectedOriginalTexts = function(currentSelection, fileId) {
    currentSelection = currentSelection||this.grid.getSelectedRange()||[[]];
    fileId = fileId || this.getSelectedId();
    var data = this.getData(fileId);
    var selectedCells = common.gridSelectedCells(currentSelection);

    var result = [];
    for (var i=0; i<selectedCells.length; i++) {
        result.push(
            data[selectedCells[i].row][this.keyColumn] || ""
        )
    }
    return result;
}

Trans.prototype.getSelectedTextsAsOneLine = function(currentSelection, fileId) {
    var texts = this.getSelectedTexts(currentSelection, fileId) || [];
    var merged = texts.join(" ");
    return merged.replaceAll("\r", "").replaceAll("\n", " ");
}

 Trans.prototype.getSelectedOriginalTextsAsOneLine = function(currentSelection, fileId) {
    currentSelection = currentSelection||this.grid.getSelectedRange()||[[]];
    fileId = fileId || this.getSelectedId();
    var data = this.getData(fileId);

    var rows = common.gridSelectedRows()

    var result = []
    for (var i=0; i<rows.length; i++) {
        result.push(
            data[rows[i]][this.keyColumn] || ""
        )
    }
    return result.join(" ");
}

 Trans.prototype.getSelectedId = function() {

    if (!trans.project) return false;
    return trans.project?.selectedId

}

 Trans.prototype.getSelectedContext = function(rowNumber) {
    rowNumber = rowNumber || trans.lastSelectedCell[0]
    var context = trans.getSelectedObject().context;
    try {
        return context[rowNumber]
    } catch (e) {
        context[rowNumber] = [];
        return context[rowNumber];
    }
}

 Trans.prototype.getSelectedParameters = function() {
    if (!trans.lastSelectedCell) return;
    var rowNumber = trans.lastSelectedCell[0]

    var obj =trans.getSelectedObject()
    obj.parameters = obj.parameters || [];
    obj.parameters[rowNumber] = obj.parameters[rowNumber] || []
    return obj.parameters[rowNumber]
}

 Trans.prototype.getParamatersByRow = function(row, file) {
    file = file || this.getSelectedId();
    if (typeof row !== "number") return false;

    var thisObj = trans.getObjectById(file);
    if (!thisObj?.parameters) return false;
    return thisObj.parameters[row];
}

Trans.prototype.getRowInfoText = function(row, full=false, file="") {
    file = file || this.getSelectedId();
    const thisParam = this.getParamatersByRow(row, file);

    if (!thisParam) return "";
    const rowInfoReference = (this.getOption("gridInfo")||{}).referenceName || "Actor Reference";

    var numPrefix = "";
    try {
        var _tags = (this.project.files[file] && this.project.files[file].tags && this.project.files[file].tags[row]) || [];
        if (_tags.indexOf("num") != -1) numPrefix = "№ ";
    } catch(e) {}

    var result;
    if (full) {
        result = [];
        for (let i in thisParam) {
            if (!thisParam[i]) continue;
            if (typeof thisParam[i] !== "object") continue;
            if (thisParam[i].rowInfoText) result.push(this.translateByReference(thisParam[i].rowInfoText, false, rowInfoReference));
        }

        let uniqueItems = [...new Set(result)]
        return (uniqueItems.length ? numPrefix : "") + uniqueItems.join(", ")
    }

    result = "";
    for (let i in thisParam) {
        if (!thisParam[i]) continue;
        if (typeof thisParam[i] !== "object") continue;
        if (result) return numPrefix + result+"++";
        if (thisParam[i].rowInfoText) result = this.translateByReference(thisParam[i].rowInfoText, false, rowInfoReference);
    }
    return numPrefix + result;
}

 Trans.prototype.getSelectedKeyText = function(rowNumber) {
    rowNumber = rowNumber || trans.lastSelectedCell[0]
    try {
        var data = trans.getSelectedObject().data;
        return data[rowNumber][trans.keyColumn]
    } catch (e) {

    }
}

 Trans.prototype.getSelectedObject = function() {

    if ($(".fileList .selected").length == 0 ) return false;
    var currentID = trans.getSelectedId();
    return trans.project.files[currentID];
}

 Trans.prototype.getObjectById = function(id) {
    if (!id) return;
    try {
        return trans.project.files[id]
    } catch (e){

        return;
    }
}

 Trans.prototype.getCheckedFiles = function() {
    var result = [];
    var checkbox = $(".fileList .data-selector .fileCheckbox:checked");
    for (var i=0; i<checkbox.length; i++) {
        result.push(checkbox.eq(i).attr("value"));
    }
    return result;

}

 Trans.prototype.getCheckedObjects = function() {
    var result = {};
    var checkbox = $(".fileList .data-selector .fileCheckbox:checked");
    for (var i=0; i<checkbox.length; i++) {
        var id = checkbox.eq(i).attr("value");
        result[id] = this.getObjectById(id)
    }
    return result;
}

 Trans.prototype.getAllFiles = function(obj) {
    var result = [];
    obj = obj||trans?.project?.files;
    if (typeof obj == 'undefined') return result;
    for (var file in obj ) {
        result.push(file);
    }
    return result;
}

Trans.prototype.getAllFilesExcept = function(filteredIds, obj) {
    if (typeof filteredIds == "string") filteredIds = [filteredIds];
    filteredIds = filteredIds || [];
    obj = obj||trans.project.files;
    var result = [];
    for (var file in obj ) {
        if (filteredIds.includes(file)) continue;
        result.push(file);
    }
    return result;
}

 Trans.prototype.getAllCompletedFiles = function(obj) {
    var result = [];
    obj = obj||this.project.files;
    if (typeof obj == 'undefined') return result;
    for (var file in obj ) {

        if (typeof obj[file] !== "object") continue;
        if (typeof obj[file].progress !== "object") continue;
        if (obj[file].progress.percent == 100) {
            result.push(file);
        }

    }
    return result;
}

 Trans.prototype.getAllChangedFiles = function(obj) {
    var result = [];
    obj = obj||this.project.files;
    if (typeof obj == 'undefined') return result;
    for (var file in obj ) {

        if (typeof obj[file] !== "object") continue;
        if (typeof obj[file].progress !== "object") continue;
        if (obj[file].progress.percent > 0) {
            result.push(file);
        }
        else if (file.includes("Scripts/") == true || file.includes("Main/") == true || file.includes(".rb") == true || file.includes("Scripts.") == true || file.includes("Main.") == true) {
            result.push(file);
        }

    }
    return result;
}

 Trans.prototype.getAllIncompletedFiles = function(obj) {
    var result = [];
    obj = obj||this.project.files;
    if (typeof obj == 'undefined') return result;
    for (var file in obj ) {

        if (typeof obj[file] !== "object") continue;
        if (typeof obj[file].progress !== "object") continue;
        if (obj[file].progress.percent < 100) {
            result.push(file);
        }

    }
    return result;
}

Trans.prototype.getAllMarkedAsCompleted = function(obj) {
    var result = [];
    obj = obj||this.project.files;
    if (typeof obj == 'undefined') return result;
    for (var file in obj ) {
        if (typeof obj[file] !== "object") continue;
        if (typeof obj[file].progress !== "object") continue;
        if (obj[file].isCompleted) {
            result.push(file);
        }

    }
    return result;
}

Trans.prototype.scrollHToCol = function(col) {
    var $container = $("#table .ht_master .wtHolder")
    if (!col) return $container[0].scrollLeft = 0
    var $colls = $("#table .ht_master .wtHolder colgroup col");

    var scrollWidth = 0
    for (var i=1; i<col; i++) {
        scrollWidth += $colls.eq(i+1).outerWidth();
    }

    $container[0].scrollLeft = scrollWidth;
}

 Trans.prototype.goTo = function(row, col, fileId) {

    fileId = fileId || this.getSelectedId()

    this.grid.deselectCell();

    if (fileId !== this.getSelectedId()) {
        var $selected = this.selectFile(fileId);

        $($selected)[0].scrollIntoView({block:"center"});
    }

    this.grid.selectCell(row,col,row,col);
    this.grid.scrollViewportTo(row,col);
    this.scrollHToCol(col);

}

Trans.prototype.getLastSelectedCell = function() {
    return this.lastSelectedCell;
}

Trans.prototype.goToNextUntranslated = function() {
    var selectedCell = this.getLastSelectedCell();
    var data = this.getCurrentData();
    var starting = selectedCell[0]+1;
    if (starting >= data.length) starting = 0;
    for (var rowId=starting; rowId<data.length; rowId++) {
        if (this.rowHasTranslation(data[rowId])) continue;
        break;
    }
    if (rowId >= data.length) rowId = data.length - 1;
    return this.goTo(rowId, selectedCell[1]);
}

Trans.prototype.goToPreviousUntranslated = function() {
    var selectedCell = this.getLastSelectedCell();
    var data = this.getCurrentData();
    var starting = selectedCell[0]-1;
    if (starting <= 0) starting = data.length - 1;

    for (var rowId=starting; rowId>=0; rowId--) {
        if (this.rowHasTranslation(data[rowId])) continue;
        break;
    }

    if (rowId < 0) rowId = 0;
    return this.goTo(rowId, selectedCell[1]);
}

 Trans.prototype.search = function(keyword, options) {
    var globToRegExp = require('glob-to-regexp');

    if (typeof keyword == "undefined") return null;
    if (typeof keyword.length <=1) return "Keyword too short!";
    if (typeof trans.project == "undefined") return null;
    if (typeof trans.project.files == "undefined") return null;

    options = options|| {};
    options.caseSensitive     = options.caseSensitive||false;
    options.lineMatch         = options.lineMatch||false;
    options.isRegexp         = options.isRegexp||false;

    options.searchLocations = options.searchLocations || [];
    if (options.searchLocations.length == 0) options.searchLocations = ['grid'];

    if (options.lineMatch) options.searchInContext = false;

    if (Array.isArray(options.files) == false) {
        options.files = [];
        for (let file in trans.project.files) {
            options.files.push(file);
        }
    }

    if (options.caseSensitive == false && options.isRegexp == false) {
        keyword = keyword.toLowerCase();
    }

    var start = new Date().getTime();

    var result = {
        keyword:keyword,
        count:0,
        isRegexp:options.isRegexp,
        executionTime:0,
        files:{}
    };

    var keywordExp;
    if (options.isRegexp) {
        keywordExp = common.evalRegExpStr(keyword);
        if (keywordExp == false) {
            alert(keyword+" is not a valid javascript's regexp!\r\nFind out more about Javascipt's Regular Expression at :\r\nhttps://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions");
            return result;
        }
    } else if (keyword.includes("*")) {

        try {
            var fixedKeywordExp = globToRegExp(keyword).toString().replace(/\/\^(.*?)\$\//, '$1');
            keywordExp = new RegExp(fixedKeywordExp, 'i');

        } catch (e) {

        }

    }

    if (options.lineMatch) {
        for (let cont in options.files) {
            let file = options.files[cont];
            if (Array.isArray(trans.project.files[file].data) == false) continue;
            let currentFile = trans.project.files[file].data;
            for (let row=0; row<currentFile.length; row++) {
                if (currentFile[row].length == 0) continue;
                for (let col=0; col<currentFile[row].length; col++) {
                    if (typeof currentFile[row][col] !== "string") continue;

                    if (keywordExp) {

                        if (keywordExp.test(currentFile[row][col])) {

                            let lineIndex = common.lineIndexRegExp(currentFile[row][col], keywordExp);
                            result.files[file] = result.files[file]||[];
                            result.files[file].push({
                                'fullString':currentFile[row][col],
                                'row':row,
                                'col':col,
                                'type':'cell',
                                'lineIndex':lineIndex
                            });
                            result.count++;

                            break;
                        }

                    } else {

                        if (options.caseSensitive) {
                            if (currentFile[row][col].indexOf(keyword) == -1) continue;
                        } else {
                            if (currentFile[row][col].toLowerCase().indexOf(keyword) == -1) continue;
                        }

                        let lineIndex = common.lineIndex(currentFile[row][col], keyword, options.caseSensitive);
                        if (lineIndex != -1) {

                            result.files[file] = result.files[file]||[];
                            result.files[file].push({
                                'fullString':currentFile[row][col],
                                'row':row,
                                'col':col,
                                'type':'cell',
                                'lineIndex':lineIndex
                            });
                            result.count++;

                            break;
                        }
                    }

                }
            }
        }

        let end = new Date().getTime();
        result.executionTime = end - start;
        return result;
    }

    if (options.searchLocations.includes("grid")) {

        for (let cont in options.files) {
            let file = options.files[cont];
            if (Array.isArray(trans.project.files[file].data) == false) continue;
            let currentFile = trans.project.files[file].data;
            for (let row=0; row<currentFile.length; row++) {
                if (currentFile[row].length == 0) continue;
                for (let col=0; col<currentFile[row].length; col++) {
                    if (typeof currentFile[row][col] !== "string") continue;

                    if (keywordExp) {

                        if (keywordExp.test(currentFile[row][col])) {

                            result.files[file] = result.files[file]||[];
                            result.files[file].push({
                                'fullString':currentFile[row][col],
                                'row':row,
                                'col':col,
                                'type':'cell'
                            });
                            result.count++;

                            break;
                        }

                    } else {

                        if (options.caseSensitive) {
                            if (currentFile[row][col].indexOf(keyword) == -1) continue;
                        } else {
                            if (currentFile[row][col].toLowerCase().indexOf(keyword) == -1) continue;
                        }

                        result.files[file] = result.files[file]||[];
                        result.files[file].push({
                            'fullString':currentFile[row][col],
                            'row':row,
                            'col':col,
                            'type':'cell'
                        });
                        result.count++;
                    }
                }
            }
        }
    }

    if (options.searchLocations.includes("context")) {
        for (let idx in options.files) {
            let file = options.files[idx];
            if (Array.isArray(trans.project.files[file].context) == false) continue;
            let currentFile = trans.project.files[file].context;
            for (let row=0; row<currentFile.length; row++) {
                if (Array.isArray(currentFile[row]) == false) continue;
                if (currentFile[row].length == 0) continue;
                for (let cont=0; cont<currentFile[row].length; cont++) {
                    if (typeof currentFile[row][cont] !== "string") continue;

                    if (keywordExp) {
                        if (keywordExp.test(currentFile[row][cont]) == false) continue;
                    } else if (options.caseSensitive) {
                        if (currentFile[row][cont].indexOf(keyword) == -1) continue;
                    } else {
                        if (currentFile[row][cont].toLowerCase().indexOf(keyword) == -1) continue;
                    }

                    result.files[file] = result.files[file]||[];
                    result.files[file].push({
                        'fullString':currentFile[row][cont],
                        'row':row,
                        'col':0,
                        'type':'context'
                    });
                    result.count++;
                }
            }
        }
    }

    if (options.searchLocations.includes("tag")) {
        for (let cont in options.files) {
            let file = options.files[cont];
            let tags = keyword.split(" ");
            let currentFile = trans.project.files[file].data;
            for (let row=0; row<currentFile.length; row++) {
                if (trans.hasTags(tags, row, file) == false) continue;
                result.files[file] = result.files[file]||[];
                result.files[file].push({
                    'fullString':currentFile[row][this.keyColumn],
                    'row':row,
                    'col':0,
                    'type':'cell'
                });
                result.count++;
            }
        }
    }

    if (options.searchLocations.includes("comment")) {

        for (let idx in options.files) {
            let file = options.files[idx];
            if (Boolean(trans.project.files[file].comments) == false) continue;
            let currentFile = trans.project.files[file].comments;

            for (let row in currentFile) {
                if (Boolean(currentFile[row]) == false) continue;
                for (let col in currentFile[row]) {
                    if (typeof currentFile[row][col] !== "string") continue;

                    if (keywordExp) {
                        if (keywordExp.test(currentFile[row][col]) == false) continue;
                    } else if (options.caseSensitive) {
                        if (currentFile[row][col].indexOf(keyword) == -1) continue;
                    } else {
                        if (currentFile[row][col].toLowerCase().indexOf(keyword) == -1) continue;
                    }

                    result.files[file] = result.files[file]||[];
                    result.files[file].push({
                        'fullString':currentFile[row][col],
                        'row':row,
                        'col':col,
                        'type':'comment'
                    });
                    result.count++;
                }
            }
        }
    }

    var end = new Date().getTime();
    result.executionTime = end - start;
    return result;
}

 Trans.prototype.replace = function(keyword, replacer, options) {

    if (typeof keyword == "undefined") return null;
    if (typeof keyword.length <=1) return "Keyword too short!";
    if (typeof trans.project == "undefined") return null;
    if (typeof trans.project.files == "undefined") return null;

    replacer = replacer||"";
    options = options|| {};
    options.caseSensitive = options.caseSensitive||false;
    options.isRegexp = options.isRegexp||false;

    if (Array.isArray(options.files) == false) {
        options.files = [];
        for (var file in trans.project.files) {
            options.files.push(file);
        }
    }

    if (options.caseSensitive == false && options.isRegexp == false) {
        keyword = keyword.toLowerCase();
    }

    var start = new Date().getTime();
    var result = {
        'keyword':keyword,
        count:0,
        isRegexp:options.isRegexp,
        executionTime:0,
        files:{}
    };

    if (options.isRegexp) {
        var keywordExp = common.evalRegExpStr(keyword);
        if (keywordExp == false) {
            alert(keyword+" is not a valid javascript's regexp!\r\nFind out more about Javascipt's Regular Expression at :\r\nhttps://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions");
            return result;
        }
    }

    for (let cont in options.files) {
        let file = options.files[cont];
        if (Array.isArray(trans.project.files[file].data) == false) continue;
        let currentFile = trans.project.files[file].data;

        for (let row=0; row<currentFile.length; row++) {
            if (currentFile[row].length == 0) continue;
            for (let col=1; col<currentFile[row].length; col++) {
                if (typeof currentFile[row][col] !== "string") continue;

                if (options.isRegexp) {

                    if (keywordExp.test(currentFile[row][col])) {

                        let original = trans.project.files[file].data[row][col];

                        trans.project.files[file].data[row][col] = currentFile[row][col].replace(keywordExp, replacer);
                        result.files[file] = result.files[file]||[];
                        result.files[file].push({
                            'fullString':trans.project.files[file].data[row][col],
                            'row':row,
                            'col':col,
                            'originalString' : original

                        });
                        result.count++;

                        break;
                    }
                    continue;
                }

                if (options.caseSensitive) {
                    if (currentFile[row][col].indexOf(keyword) == -1) continue;
                } else {
                    if (currentFile[row][col].toLowerCase().indexOf(keyword) == -1) continue;
                }

                let original = trans.project.files[file].data[row][col];
                trans.project.files[file].data[row][col] = currentFile[row][col].replaces(keyword, replacer, !options.caseSensitive);

                result.files[file] = result.files[file]||[];
                result.files[file].push({
                    'fullString':trans.project.files[file].data[row][col],
                    'row':row,
                    'col':col,
                    'originalString' : original
                });
                result.count++;
            }
        }

    }
    var end = new Date().getTime();
    result.executionTime = end - start;
    trans.refreshGrid();

    return result;

}

 Trans.prototype.findPut = function(keyword, put, targetCol, options) {

    if (typeof keyword == "undefined") return null;
    if (typeof keyword.length <=1) return "Keyword too short!";
    if (typeof trans.project == "undefined") return null;
    if (typeof trans.project.files == "undefined") return null;
    if (Boolean(targetCol) == false || targetCol < 1) return false;

    options = options|| {};
    options.caseSensitive     = options.caseSensitive||false;
    options.lineMatch         = options.lineMatch||false;

    if (typeof options.overwrite == "undefined") options.overwrite = true;

    if (Array.isArray(options.files) == false) {
        options.files = [];
        for (var file in trans.project.files) {
            options.files.push(file);
        }
    }

    if (options.caseSensitive == false) {
        keyword = keyword.toLowerCase();
    }

    var start = new Date().getTime();
    var result = {
        keyword    :keyword,
        count    :0,
        executionTime:0,
        files:{}
    };

    if (options.mode=="rowByRow") {

        result = this.findAndInsert(keyword, put, targetCol , {
            insensitive : !options.caseSensitive,
            overwrite : options.overwrite
        });
    } else if (keyword.includes("\n")) {

        // Multi-line keyword: find the sequence of lines inside a cell
        // (line-aligned) and replace those lines in the target column. A
        // keyword covering the whole cell therefore rewrites the whole cell.
        put = put||"";
        var keywordLines = keyword.split("\n").map(function(line) {
            return common.stripCarriageReturn(line).trimEnd();
        });
        var putLines = put.split("\n").map(function(line) {
            return common.stripCarriageReturn(line);
        });

        for (let cont in options.files) {
            let file = options.files[cont];
            if (Array.isArray(trans.project.files[file].data) == false) continue;
            let currentFile = trans.project.files[file].data;
            for (let row=0; row<currentFile.length; row++) {
                if (currentFile[row].length == 0) continue;
                for (let col=0; col<currentFile[row].length; col++) {
                    if (typeof currentFile[row][col] !== "string") continue;

                    var lineIndex = common.linesIndex(currentFile[row][col], keywordLines, options.caseSensitive);
                    if (lineIndex == -1) continue;

                    var newTxt = common.replaceLinesAt(currentFile[row][targetCol], putLines, lineIndex, keywordLines.length, {
                            lineBreak:trans.project.files[file].lineBreak||"\n"
                        });
                    currentFile[row][targetCol] = newTxt;

                    result.files[file] = result.files[file]||[];
                    result.files[file].push({
                        'fullString':currentFile[row][col],
                        'row':row,
                        'col':col,
                        'type':'cell',
                        'lineIndex':lineIndex
                    });
                    result.count++;

                    break;
                }
            }
        }
    } else {

        for (let cont in options.files) {
            let file = options.files[cont];
            if (Array.isArray(trans.project.files[file].data) == false) continue;
            let currentFile = trans.project.files[file].data;
            for (let row=0; row<currentFile.length; row++) {
                if (currentFile[row].length == 0) continue;
                for (let col=0; col<currentFile[row].length; col++) {
                    if (typeof currentFile[row][col] !== "string") continue;

                    if (options.caseSensitive) {
                        if (currentFile[row][col].indexOf(keyword) == -1) continue;
                    } else {
                        if (currentFile[row][col].toLowerCase().indexOf(keyword) == -1) continue;
                    }

                    var lineIndex = common.lineIndex(currentFile[row][col], keyword, options.caseSensitive);
                    if (lineIndex != -1) {

                        var newTxt = common.insertLineAt(currentFile[row][targetCol], put, lineIndex, {
                                lineBreak:trans.project.files[file].lineBreak||"\n"
                            });
                        currentFile[row][targetCol] = newTxt;

                        result.files[file] = result.files[file]||[];
                        result.files[file].push({
                            'fullString':currentFile[row][col],
                            'row':row,
                            'col':col,
                            'type':'cell',
                            'lineIndex':lineIndex
                        });
                        result.count++;

                        break;
                    }
                }
            }
        }
    }

    var end = new Date().getTime();
    result.executionTime = end - start;
    trans.refreshGrid();

    return result;
}

class TransProjectHook{
    constructor () {
        this.hooks = {}
    }
}
TransProjectHook.prototype.defineHook = function(hookName, fn) {
    if (typeof hookName !== "string") throw new Error(`hookName must be a string ${typeof hookName} given`)
    if (typeof fn !== "function") throw new Error(`hookName must be a function ${typeof fn} given`)
    this.hooks[hookName] = fn;
}
TransProjectHook.prototype.getHook = function(hookName) {
    return this.hooks[hookName];
}

TransProjectHook.prototype.run = async function(hookName, ...args) {
    if (typeof this.hooks[hookName] == "function") {
        await this.hooks[hookName].apply(window.trans, args);
    }

    const hooks = trans.getOption("hooks");
    if (!hooks) return;
    if (typeof hooks?.afterExport !== "string") return;
    const userConsent = await ui.confirmRunScript();
    if (!userConsent) return;

    let AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
    const newFunc = new AsyncFunction(hooks.afterExport);
    const execResult = newFunc.apply(trans, args);

    return execResult;
}

var trans = new Trans()
window.trans = trans;
trans.cellInfo = new Trans.CellInfo();

trans.projectHook = new TransProjectHook();

 trans.gridContextMenu = {
    'commentsAddEdit': {
        name: "Add comment",
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return true;
            if (trans.grid.isRowHeaderSelected()) return true;
            return false;
        }
    },
    'commentsRemove':{
        name: "Delete comment",
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return true;
            if (trans.grid.isRowHeaderSelected()) return true;
            return false;
        }

    },
    "sepx": '---------',
    'translateThisCell':{
        name: function() {
            var def = "<span class='HOTMenuTranslateHere'>"+"Translate here"+" <kbd>ctrl+g</kbd></span>";
            if (typeof trans.project == 'undefined') return def;
            trans.project.options = trans.project.options||{};
            var thisTrans = trans.getActiveTranslator()

            if (typeof thisTrans == 'undefined') return def;
            var from     = trans.getSl()||"??";
            var to         = trans.getTl()||"??";
            var thisTranslatorName = trans.getTranslatorEngine(thisTrans)?.name;
            if (!thisTranslatorName) return def;
            return "Translate here using "+thisTranslatorName+" ("+from+"<i class='icon-right-bold'></i>"+to+") <kbd>ctrl+g</kbd>"
        },
        callback: function() {
            trans.translateSelection();
        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return true;
            if (trans.grid.isRowHeaderSelected()) return true;
            if (!trans.getActiveTranslator()) return true;
            return false;
        }

    },
    'translateUsing': {
        name: function() {
            trans.drawGridTranslatorMenu();
            return 'Translate using...'
        },
        submenu: {
            items: []
        },
        hidden: function() {
            if (trans.grid.isRowHeaderSelected()) return true;
            return false;
        }
    },
    'mergeThenTranslate': {
        name: "<span>Merge then translate <kbd>ctrl+shift+g</kbd></span>",
        hidden: function() {
            if (trans.grid.isRowHeaderSelected()) return true;
            return false;
        },
        callback: async function() {
            trans.translateSelectionAsOneLine();
        }
    },
    'translateSimiliar': {
        name: "<span>Translate like this <kbd>ctrl+l</kbd></span>",
        hidden: function() {
            if (trans.grid.isRowHeaderSelected()) return true;
            return false;
        },
        callback: async function() {
            var conf = confirm("Do you want to translate all the same texts found across this project with the translation on the selected cell(s)?")
            if (!conf) return;
            var result = await trans.translateAllBySelectedCells();
            alert(result.length + ` cell(s) has been written!`)
        }
    },
    '---------':{},
    'columnWidth': {
        name: "Column width",
        callback: function(origin, selection, e) {

            var cols = common.gridSelectedCols();
            var width = prompt("Enter new width", this.getColWidth(cols[0]));
            width = parseInt(width);

            if (width < 1) return alert("Width must greater than 0")

            for (var i=0; i<cols.length; i++) {
                this.setColWidth(cols[i], width)
            }
        },
        hidden: function() {
            if (this.isColumnHeaderSelected()) return false;
            if (this.isRowHeaderSelected()) return true;
            return true;
        }

    },
    'sepn' :{
        name: '---------',
        hidden: function() {
            if (this.isColumnHeaderSelected()) return false;
            if (this.isRowHeaderSelected()) return true;
            return true;
        }
    },

    'col-right': {
        name: "Insert column right",
        callback: function() {
            trans.grid.insertColumnRight();
        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return false;
            if (trans.grid.isRowHeaderSelected()) return true;
            return true;
        }

    },
    'duplicateCol': {
        name: "Duplicate column",
        callback: function() {
            var getCol = trans.grid.getSelected()[0][1];
            var getColSet = trans.columns.length;
            var colHeaderName = trans.colHeaders[getCol]||"New Col";

            trans.columns.push({});
            common.arrayExchange(trans.columns, getColSet, getCol + 1);
            common.arrayInsert(trans.colHeaders, getCol+1, colHeaderName);

            trans.insertCell(getCol+1, null);
            trans.copyCol(getCol, getCol+1);

            trans.grid.updateSettings({
                colHeaders:trans.colHeaders
            })

        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected())  {
                if (trans.grid.getSelected()[0][1] != trans.grid.getSelected()[0][3] ||
                trans.grid.getSelected().length > 1 ) return true;
                return false;
            }

            return true;
        }

    },
    'removeColumn': {
        name: "Remove this column",
        callback: function(origin, selection, e) {

            var conf = confirm("Remove selected column?\nThis can not be undone!");
            if (conf) {
                trans.removeColumn(selection[0].start.col, {refreshGrid:true});
            }
        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return false;
            if (trans.grid.isRowHeaderSelected()) return true;
            return true;
        }

    },
    'renameColumn': {
        name: "Rename this column",
        callback: function(origin, selection, e) {

            var thisCol = selection[0].start.col;
            var colName = trans.colHeaders[thisCol];
            var conf = prompt("Please enter new name", colName);
            if (conf) {
                trans.renameColumn(thisCol, conf, {refreshGrid:true});
            }
        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return false;
            if (trans.grid.isRowHeaderSelected()) return true;
            return true;
        }
    },
    "sep0": '---------',

    'tags': {
        name:"Tags",
        submenu: {
            items: [
                {
                    key: 'tags:red',
                    name: '<i class="tag red icon-circle"></i> '+'Red',
                    callback: function(key, selection, clickEvent) {
                        trans.setTagForSelectedRow("red", selection);
                    }
                },
                {
                    key: 'tags:yellow',
                    name: '<i class="tag yellow icon-circle"></i> '+'Yellow',
                    callback: function(key, selection, clickEvent) {
                        trans.setTagForSelectedRow("yellow", selection);
                    }
                },
                {
                    key: 'tags:green',
                    name: '<i class="tag green icon-circle"></i> '+'Green',
                    callback: function(key, selection, clickEvent) {
                        trans.setTagForSelectedRow("green", selection);
                    }
                },
                {
                    key: 'tags:blue',
                    name: '<i class="tag blue icon-circle"></i> '+'Blue',
                    callback: function(key, selection, clickEvent) {
                        trans.setTagForSelectedRow("blue", selection);
                    }
                },
                {
                    key: 'tags:gold',
                    name: '<i class="tag gold icon-circle"></i> '+'Gold',
                    callback: function(key, selection, clickEvent) {
                        trans.setTagForSelectedRow("gold", selection);
                    }
                },
                {
                    key: 'tags:more',
                    name: '<i class="tag icon-tags"></i> '+'More tags...'+' <kbd>ctrl+t</kbd>',
                    callback: function(key, selection, clickEvent) {

                            ui.taggingDialog(selection);

                    }
                },
                {
                    key: 'tags:clear',
                    name: '<i class="tag icon-blank"></i> '+'Clear tags',
                    callback: function(key, selection, clickEvent) {
                        trans.clearTags(undefined, selection);
                        trans.grid.render();
                    }
                }

            ]
        }

    },
    "sep1": '---------',
    'deleteRow': {
        name: function() {
            return "Delete Row"+" <kbd>shift+del</kbd>"
        },
        callback: function(origin, selection, e) {
            var conf = confirm("Do you want to remove the currently selected row(s)?");
            if (!conf) return;
            trans.removeRow(trans.getSelectedId(), common.gridSelectedRows());
            trans.refreshGrid();
            trans.grid.deselectCell();
        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return true;
            if (trans.grid.isRowHeaderSelected()) return false;
            return false;
        }
    },
    'clearContextTranslation': {
        name: "Clear Context Translation"+" <kbd>alt+del</kbd>",
        callback: function(origin, selection, e) {

            trans.trigger("clearContextTranslationByRow", {file:trans.getSelectedId(), row:trans.grid.getSelectedRange(), type:"range"});
        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return true;
            if (trans.grid.isRowHeaderSelected()) return false;
            return false;
        }
    },
    "sep2": '---------',
    'createAutomation' : {
        name: "Create Automation",
        callback: function(origin, selection, e) {

            var options = {
                workspace: "gridSelection",
                cellRange: trans.grid.getSelectedRange()
            }
            ui.openAutomationEditor("codeEditor_gridSelection", options);
        }
    },
    'runAutomation' : {
        name: ()=> {
            trans.updateRunScriptGridMenu();
            return "Run Automation";
        }
    },
    "sep3": '---------',
    'properties': {
        name: "Row properties",
        callback: function(origin, selection, e) {

            ui.openRowProperties();
        },
        hidden: function() {
            if (trans.grid.isColumnHeaderSelected()) return true;
            if (trans.grid.isRowHeaderSelected()) return false;
            return false;
        }
    }

}

 trans.fileLoader = new FileLoader();
 trans.fileLoader.add("json", function(path) {
        trans.open(path);
 })
 trans.fileLoader.add("trans", function(path) {
        trans.open(path);
 })
 trans.fileLoader.add("slrproj", function(path) {

    trans.importSlrproj(path);
})

window.Attachment = function(obj) {
    obj = obj || {};
    Object.assign(this, obj);
}

$(document).ready(function() {
    if ($('body').is('[data-window="trans"]') == false) return;

    trans.fileSelectorContextMenuInit();

    const windowOnResize = function() {
        $(document).trigger("windowResizeStop");
        trans.grid.render();
        ui.fixCellInfoSize();
    }

    $(window).resize(debounce(windowOnResize, 100));

    trans.initTable();
    trans.isLoaded = true;

    trans.on("transLoaded", async ()=> {

        $(".menu-button > .button-gridInfo.gridInfo").removeClass("checked")
        if (trans.getOption("gridInfo")?.isRuleActive) $(".menu-button > .button-gridInfo.gridInfo").addClass("checked")
    })

});
