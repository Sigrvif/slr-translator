// const { ENOTEMPTY } = require('constants');
// const { emptyDir } = require('fs-extra');

var thisAddon 	= this;
// var appName 	= this.package.name;
var spawn 		= spawn || require('child_process').spawn;
var globToRegExp = require('glob-to-regexp');
var fse 		= fse || require('fs-extra');

// const { shim } = require('regexp-match-indices');
var CustomParser = require('www/core/customParser/CustomParser.js');
thisAddon.CustomParser = CustomParser;


const CustomParserLoader = function(rootDir, modelStr, options) {
	if (common.isDir(rootDir)) {
		this.dirname = rootDir;
	} else {
		this.dirname = nwPath.dirname(rootDir);
	}
    this.modelStr   = modelStr;
    this.model      = {};
	this.options 	= options || {};
	this.writeMode 	= true;
	this.targetDir  = undefined;
    this.parsed     = {};
    this.loadModel(this.modelStr);
}

CustomParserLoader.prototype.loadModel = function(json) {
    try {
        if (typeof json == "string") json = JSON.parse(json);
    } catch {
        return;
    }
    this.model = json;
}

CustomParserLoader.prototype.getFilesByFilter = async function(filter) {
    if (!this.dirContent) this.dirContent = await common.readDir(this.dirname);
    
    filter = filter.replaceAll(" ", filter);
    var filters = filter.split(";");
    var matchFilter = (path)=> {
        var basename = nwPath.basename(path);
        for (var i in filters) {
            var re = globToRegExp(filters[i]);
            if (re.test(path) || re.test(basename)) return true;
        }
    }

    var result = [];
    for (var i in this.dirContent) {
        if (!matchFilter(this.dirContent[i])) continue;
        result.push(this.dirContent[i]);
    }

    return result;
}

CustomParserLoader.prototype.getFileGroupOptions = function(filegroupObj = {}, key) {
    if (!filegroupObj) return;
    filegroupObj.options ||= {};
    if (!key) return filegroupObj.options;

    try {
        var x = eval("filegroupObj.options."+key);
        return x;
    } catch (e) {
        console.log("can not find option key:", key);
        return;
    }
}

CustomParserLoader.prototype.parse = async function() {
    if (!CustomParser.isValidModel(this.model)) return console.warn("Invalid model");
    
    var handleFiles = async (files, currentModel)=> {
        for (var i in files) {
            var file = files[i];
            var charEncoding        = this.options?.custom?.readEncoding || this.getFileGroupOptions(currentModel, "readEncoding");
            var customParser        = new CustomParser(await common.fileGetContents(file, charEncoding), this.options);
            var relativePath        = common.getRelativePath(file, this.dirname);
            customParser.charEncoding   = common.getOpenedFileEncoding(file);
            customParser.bom            = common.getOpenedFileBom(file);

            if (!customParser.processThispath(relativePath)) continue;
            await ui.log("Parsing file : "+files[i]+" with encoding "+charEncoding);

            customParser.generateFileInfo(relativePath);
            customParser.fileInfo.dataType = currentModel.type || currentModel.pattern;
            customParser.assignTranslationPair(relativePath);
            customParser.setModel(currentModel);
            await customParser.parse();
            this.parsed[file] = customParser;
        }
    }
    
    for (var i=0; i < this.model.files.length; i++) {
        var thisFileModel   = this.model.files[i];
        await ui.log("Applying file pattern : "+thisFileModel.pattern);

        var thisFiles       = await this.getFilesByFilter(thisFileModel.pattern);
        await ui.log(`${thisFiles.length} file(s) found!`);

        if (thisFiles.length < 1) continue;
        console.log("handling files:", thisFiles);
        await handleFiles(thisFiles, thisFileModel);
    }

    this.isParsed = true;
}

CustomParserLoader.prototype.createCacheFolder = async function(id) {
	await ui.log("Generating staging directory");
	// common.initStaging creates <staging>/<id>/data and the gameInfo.json
	// marker used by the project-existence check and the startup staging sweep.
	return common.initStaging(id || common.makeid(10));
}

CustomParserLoader.prototype.generateTrans = async function() {
    if (!this.isParsed) {
        this.writeMode = false;
        await this.parse();
    }
    var cacheInfo 			= await this.createCacheFolder();
	this.options 			= this.options || {};
	var stagingDir       	= nwPath.join(cacheInfo.cachePath, "data/");

    this.trans = {
		projectId		: cacheInfo.cacheID,
		cache			: cacheInfo,
		gameEngine		: "custom",
		gameTitle		: this.gameTitle || "untitled project",
		loc				: this.dirname,
		parser			: 'customParser',
		parserVersion	: thisAddon.package.version,
		files			: {},
        options         : {
            parserModel: this.modelStr
        }
	}

    // copy master file to stagingDir
    for (var file in this.parsed) {
        var thisParsedFile          = this.parsed[file];
        var relativePath            = thisParsedFile.fileInfo.relPath;
        var stagingFile             = nwPath.join(stagingDir, relativePath);
        this.trans.files[relativePath]    = Object.assign(thisParsedFile.transData, thisParsedFile.fileInfo);
        await common.mkDir(nwPath.dirname(stagingFile))
        await ui.log(`Copying ${file} to ${stagingFile}`);
        await common.copyFile(file, stagingFile);
    }

    return this.trans;
}

CustomParserLoader.prototype.writeToDir = async function(targetDir) {
    if (!this.isParsed) {
        this.writeMode = true;
        await this.parse();
    }
    console.log("Writing to dir", this);
    // copy master file to stagingDir
    for (let file in this.parsed) {
        let thisParsedFile          = this.parsed[file];
        let relativePath            = thisParsedFile.fileInfo.relPath;
        let targetFile              = nwPath.join(targetDir, relativePath);

        let writeEncoding           = this.options?.custom?.writeEncoding || thisParsedFile.model?.options?.writeEncoding || thisParsedFile.charEncoding;

        await common.mkDir(nwPath.dirname(targetFile))
        console.log("file obj", thisParsedFile);
        await ui.log(`Writing ${targetFile} with char encoding ${writeEncoding}`);
        await common.filePutContents(targetFile, thisParsedFile.toString(), writeEncoding, thisParsedFile.bom||false);
    }
}

thisAddon.CustomParserLoader = CustomParserLoader;


thisAddon.createProject = async function(targetDir, tpmFile, options={}) {
    ui.showLoading();
    ui.loadingProgress("Processing", "Creating project", {consoleOnly:false, mode:'consoleOutput'});
    ui.log("Target directory : "+targetDir);
    ui.log("TPM file  : "+tpmFile);
    
    var customParserLoader = new thisAddon.CustomParserLoader(targetDir, await common.fileGetContents(tpmFile), options);
    var transFile = await customParserLoader.generateTrans();
    trans.openFromTransObj({project:transFile}, {isNew:true});
    console.log(customParserLoader);
    ui.loadingEnd();
}

thisAddon.exportToFolder = async function(destinationDir, transData, options) {
	transData 			= transData || trans.getSaveData();
	options 			= options || {};
	options.translationDatas = options.translationDatas || trans.getTranslationData();
    try {
        var model       = transData.project.options.parserModel;
    } catch (e) {
        ui.log("Error exporting to a folder. Parser Model is not defined.", e.toString());
        return;
    }
    var stageDir            = nwPath.join(trans.project.cache.cachePath, "data");
    var customParserLoader  = new thisAddon.CustomParserLoader(stageDir, model, options);
    
    await customParserLoader.writeToDir(destinationDir);
}

thisAddon.exportAsZip = async function(targetPath, transData, options) {
	transData 			= transData || trans.getSaveData();
	options 			= options || {};
	options.engineType	= options.engineType || transData.project.gameEngine || trans.project.gameEngine;
	options.translationDatas = options.translationDatas || trans.getTranslationData();

	// todo
	var tmpDir = nwPath.join(nw.process.env.TEMP, "slr_"+common.generateId());
    try {
		await fse.remove(tmpDir); 
		await common.mkDir(tmpDir, {recursive:true});
	} catch(e) {
		console.warn("Unable to create directory ", tmpDir);
		console.error(e);
		return;
	}
    ui.log("Export to :", tmpDir);
	await this.exportToFolder(tmpDir, transData, options);
	await ui.log("Zipping temporary data");
	// platform safe zip: run 7z inside the temp folder with a bare "*"
	// wildcard ("tmpDir\*" only matched on Windows and created an empty zip)
	var zipCode = -1;
	var zipStderr = "";
	await common.aSpawn(common.get7zipBin(), ["a", "-tzip", targetPath, "*"], {
		cwd		: tmpDir,
		onDone	: function(result, code) { zipCode = code; },
		onError	: function(data) { zipStderr += (data ? data.toString() : ""); }
	});
	if (zipCode !== 0) {
		throw("Failed to create the zip archive (7z exited with code "+zipCode+")."+(zipStderr ? "\n"+zipStderr : ""));
	}

	var verifyCode = -1;
	await common.aSpawn(common.get7zipBin(), ["t", targetPath], {
		onDone: function(result, code) { verifyCode = code; }
	});
	var zipSize = await common.getFileSize(targetPath);
	if (verifyCode !== 0 || zipSize <= 22) {
		throw("The generated zip archive is empty or failed its integrity check: "+targetPath);
	}
	await ui.log("Zip archive created ("+zipSize+" bytes) : "+targetPath);
	return targetPath;
}

thisAddon.openModelEditor = function() {
    var options = {
        id : "pmc",
		frame: false,
        width: 800,
        height: 600,
        title: "Parser Model Creator - SLR Translator",
        // Hidden until painted, so it never flashes the default white canvas.
        show: false
    }
    nw.Window.open("www/core/customParser/modelEditor/modelEditor.html", options, function(win) {
        if (!win) return;
        var revealed = false;
        var reveal = function() {
            if (revealed) return;
            revealed = true;
            var showIt = function() {
                try { win.show(); } catch (e) {}
                try { win.focus(); } catch (e) {}
            };
            var w = null;
            try { w = win.window; } catch (e) {}
            if (w && typeof w.requestAnimationFrame === "function") {
                w.requestAnimationFrame(function() { w.requestAnimationFrame(showIt); });
            } else {
                setTimeout(showIt, 30);
            }
        };
        try { win.on("loaded", reveal); } catch (e) {}
        setTimeout(reveal, 15000);
    });
}



var drawProjectCreator = function() {
	var $slide = $(`<div>
    <h1><i class="icon-plus-circled"></i><span>Custom Parser Ver. ${thisAddon.package.version}</span></h1>
	<div class="fieldgroup parserModel">
        <h1>Use existing Parser Model</h1>	
        <div class="dialogSectionBlock fieldgroup">
            <h2>Load SLR Translator Parser Model file</h2>
            <div class="info">SLR Translator Parser Model (tpm) file is a file that contains set of rule to grab texts from files. You can also drag and drop the .tpm file here.</div>
            <label><input type="dvSelectPath" class="tpmLocation" accept=".tpm" /></label>
        </div>

        <h1>Or create a new Parser Model</h1>	
        <div class="dialogSectionBlock fieldgroup">
            <h2>Create a new SLR Translator Parser Model</h2>
            <div class="info">Create your own parser model with RegExp or Javascript function. We have a tool to help you on that.</div>
            <label><button class="newTPM">Create a new model</button></label>
        </div>
    </div>

    <form class="customField"></form>
    <div class="actionButtons">
        <button class="createCustomProject"><i class="icon-doc-inv"></i>Select Folder!</button>
    </div>

    </div>`);
    var customField = new CustomFields($slide.find(".customField"), {
        jsonForm: {
            "schema": {
                "readEncoding": {
                    "title": "Read Character encoding",
                    "description": "List of the possible character encodings. <b>Order does matter!</b>. Separate each value with a comma.<br />SLR Translator will read the original file with the following encodings, patch the files and write with the <b>Write Character encoding</b> option. Leave blank to use the original character encoding when the project is created.",
                    "type": "string",
                    "default" :  ""
                },
            },
            "form": [
                {type: "msg", "msg": "<h2>Misc Options</h2>"},
                "*",
            ]
        }
    });

    const dropFileToWindow = new (require("www/js/DropFileToWindow.js"))($slide.find(".parserModel"), {
        hoverText: "Drop .tpm file here!",
        supportedFiles: [".tpm"],
        onSupportedFileDrop: (filePath)=> {
            $slide.find(".tpmLocation").val(filePath);
            $slide.find(".tpmLocation").trigger("change");
        }
    });
    dropFileToWindow.init()

    $slide.find(".newTPM").on("click", ()=> {
        thisAddon.openModelEditor();
    });

    $slide.find(".tpmLocation").on("change", function() {
        if (!$(this).val()) return;
        $slide.find(".createCustomProject").prop("disabled", false);
    });
	
    var selectDir = async function() {
        return new Promise((resolve, reject) => {
            var $elm = $(`<input type="file" nwdirectory />`);
            $elm.one("input", function() {
                resolve($(this).val());
            })
            $elm.trigger("click");
        })
    }

    $slide.find(".createCustomProject").on("click", async function() {
        if ($(this).prop("disabled")) return;
        var tpmFile = $slide.find(".tpmLocation").val();
        var targetDir = await selectDir();
        await ui.newProjectDialog.close();

        const options = {
            custom: customField.getValues()
        }
        console.log("Options are", options);
        thisAddon.createProject(targetDir, tpmFile, options);
    })

	ui.newProjectDialog.addMenu({
		icon 			: thisAddon.getWebLocation()+"/icon.png",
		descriptionBar 	: `<h2>Parse any file with custom parser</h2>
						   <p>Start custom translation project with your own RegExp or Javascript function.</p>`,
		actionBar		: "",
		goToSlide		: "customParser",
		at				: 9,
		slides 			: {"customParser": $slide}
	})


    var initializeSlide = ($slide)=> {
		var resetSlide = ()=> {
            $slide.find(".createCustomProject").prop("disabled", true);
        }

        resetSlide();
    }
	$(document).on("newProjectSlideChange", async (e, slideInfo) => {
		if (slideInfo.id !== "customParser") return;
		initializeSlide(slideInfo.elm);
	});

}

function init() {
    drawProjectCreator();

    var $newMenu = ui.mainMenu.addChild("tools", {
        label:"Create Custom Parser Model"
    });

    $newMenu.on("select", function() {
        thisAddon.openModelEditor();
    })


	var supportedEngines = ["custom"];
	engines.addHandler(supportedEngines, "onLoadTrans", 
	() => {
        // do something for custom translator
	});

	engines.addHandler(supportedEngines, 'exportHandler', async function(targetPath, options) {
		if (options.mode !== "dir" && options.mode !== "zip") return false;
		console.log("Export handler", arguments);
		
		ui.showLoading();
		ui.loadingProgress("Processing", "Export into : "+targetPath, {consoleOnly:false, mode:'consoleOutput'});
		await ui.log("Target directory:", targetPath);
		await ui.log("Options : ", options);
		await ui.log("Origin path is cache path");
		//var originPath = nwPath.join(trans.project.cache.cachePath, "data");

		if (await await common.isDirectory(targetPath)) {
			await thisAddon.exportToFolder(targetPath, undefined, options);
		} else {
			await thisAddon.exportAsZip(targetPath, undefined, options);
		}
		ui.loadingEnd();
		return common.halt();
	});

    engines.addHandler(supportedEngines, 'onLoadSnippet', async function(selectedCell) {

		trans.getSelectedObject();
		this.commonHandleFile(selectedCell, "plain");

	});	

    engines.getEngine("custom").addProperty("exportOptionFields", ()=> {
		return {
			jsonForm: {
				"schema": {
					"readEncoding": {
						"title": "Read Character encoding",
						"description": "List of the possible character encodings. <b>Order does matter!</b>. Separate each value with a comma.<br />SLR Translator will read the original file with the following encodings, patch the files and write with the <b>Write Character encoding</b> option. Leave blank to use the original character encoding when the project is created.",
						"type": "string",
						"default" :  ""
					},
					"writeEncoding": {
						"title": "Write Character encoding",
						"description": 'Select the target character encoding.',
						"type": "string",
						"default" :  "",
						"enum" :  [
                            "",
                            "utf8",
                            "utf16le",
                            "UTF-16",
                            "UTF-16BE",
                            "ascii",
                            "ISO-8859-1",
                            "ISO-8859-16",
                            "koi8-r",
                            "koi8-u",
                            "koi8-ru",
                            "koi8-t",
                            "Shift_JIS",
                            "Windows-31j",
                            "Windows932",
                            "EUC-JP",
                            "GB2312",
                            "GBK",
                            "GB18030",
                            "Windows936",
                            "EUC-CN",
                            "KS_C_5601",
                            "Windows949",
                            "EUC-KR",
                            "Big5",
                            "Big5-HKSCS",
                            "Windows950"
                        ]					
					},
				},
				"form": [
					{type: "msg", "msg": "<h2>Misc Options</h2>"},
					"*",
				]
			}
		}
	})
}


$(document).ready(function() {
	ui.onReady(function() {
		init();
	});
});