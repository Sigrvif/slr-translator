var encoding = require("encoding-japanese");
var iconv = require("iconv-lite");

// Raw source preview: shows code snippets (with Prism highlighting) for the
// selected cell, plus a context menu to open the source file.
const RawViewer = function (options) {
	this.options = options || {};
	this.container = this.options.container || $("#previewRawData");
	this.feather = 2;
	this.init();
};

RawViewer.prototype.loadPrism = function () {
	if (this.prismIsLoaded) return;
	$("head").append(`<link href="modules/prismjs/prism.css" rel="stylesheet" />`);
	$("head").append(`<script src="modules/prismjs/prism.js"></script>`);

	this.prismIsLoaded = true;
};

RawViewer.prototype.ensurePrism = function () {
    this.loadPrism();
    if (this._prismPromise) return this._prismPromise;
    var that = this;
    this._prismPromise = new Promise((resolve, reject) => {
        var waited = 0;
        var check = function () {
            if (window.Prism) return resolve();
            if (waited >= 5000) {
                that._prismPromise = null;
                return reject(new Error("Unable to load prism.js"));
            }
            waited += 50;
            setTimeout(check, 50);
        };
        check();
    });
    return this._prismPromise;
};

RawViewer.prototype.setListener = function () {
	var that = this;
	$(document).on("objectSelected", () => {
		this.clear();
	});
	$(document).on("cellInfoTabChange.RawViewer", function (e, target) {
		if (target !== "previewRawData") {
			that.clear();
		} else if (that.selectionInfo) {
			// Switched TO the Raw tab: reload the last selected cell's snippet
			// so the user doesn't have to re-select after switching tabs.
			engines.handler("onLoadSnippet").call(that, that.selectionInfo);
		}
	});

	$(document).off("onAfterSelectCell.RawViewer");
	$(document).on("onAfterSelectCell.RawViewer", function (e, selectionInfo) {
		// Always capture the selection so it can be loaded when the user
		// switches to the Raw tab later.
		that.selectionInfo = selectionInfo;
		if (ui.cellInfoTab.getActiveTab() !== "previewRawData") return;
		engines.handler("onLoadSnippet").call(that, selectionInfo);
	});
};

RawViewer.prototype.addTextPreview = async function (textObj, options) {
	if (typeof textObj == "string") {
		textObj = {
			textMarked: textObj,
			boundary: ""
		};
	}

	console.log("generating preview with textObj:", textObj);

	options = options || {};
	options.lineStart = options.lineStart || 1;
	options.language = options.language || "html";
	var $template = $(`<pre class="snippetData line-numbers language-${options.language}" data-start="${options.lineStart}"><code class="language-${options.language}"></code></pre>`);
	var keyString = this.getKeyString();
	$template.find("code").text(textObj.textMarked);
	this.container.append($template);
	console.log("keyString", keyString);

	var highlighted = $template.find("code").html();
	if (textObj.boundary) {
		console.log("replacing boundary", textObj);
		highlighted = highlighted.replace(textObj.boundary, '<span class="highlight">');
		highlighted = highlighted.replace(textObj.boundary, "</span>");
	}

	$template.find("code").html(highlighted);
	await window.Prism.highlightAllUnder($template[0]);

	if (options.data) {
		for (var i in options.data)
			$template.data(i, options.data[i]);
	}
	return $template;
};

RawViewer.prototype.getStartingLineFromOffset = function (text, offsetStart) {
	var before = text.substring(0, offsetStart).split("\n");
	var margin = this.feather + 1;
	if (before.length > margin) return before.length - margin;
	return 1;
};

RawViewer.prototype.getSnippetFromOffset = function (text, offsetStart, offsetEnd) {
	offsetEnd = offsetEnd || offsetStart;
	var result = [];
	var resultMarked = [];
	var boundary = `----boundary:${(Math.random() + "").substring(2, 10)}-----`;
	var before = text.substring(0, offsetStart).split("\n");
	var lineNum = before.length;
	var current = text.substring(offsetStart, offsetEnd);
	var after = text.substring(offsetEnd).split("\n");
	var leftSide = before.pop();
	var rightSide = after.shift();
	var columnStart = leftSide.length;
	var currentLine = leftSide + current + rightSide;
	var currentLineMarked = leftSide + boundary + current + boundary + rightSide;

	var starting = before.length - (1 + this.feather);
	if (starting < 0) starting = 0;
	for (let i = starting; i < before.length; i++) {
		if (i < 0) break;
		result.push(before[i]);
		resultMarked.push(before[i]);
	}
	result.push(currentLine);
	resultMarked.push(currentLineMarked);
	for (let i = 0; i < this.feather; i++) {
		if (i > after.length) break;
		result.push(after[i]);
		resultMarked.push(after[i]);
	}

	return {
		text: result.join("\n"),
		textMarked: resultMarked.join("\n"),
		col: columnStart,
		boundary: boundary,
		line: lineNum
	};
};

RawViewer.prototype.isClear = function () {
	if (this.container.find("*").length > 0) return false;
	return true;
};

RawViewer.prototype.clear = function () {
	this.container.empty();
};

RawViewer.prototype.scrollToTop = function () {
    // each new selection should start at the top of the raw tab (metadata header
    // and snippet first); setting scrollTop on non-scrollable elements is a no-op
    var el = this.container[0];
    for (var i = 0; i < 8 && el; i++) {
        el.scrollTop = 0;
        el = el.parentElement;
    }
};

RawViewer.prototype.getKeyString = function () {
	try {
		return trans.getSelectedObject().data[this.selectionInfo.fromRow][trans.keyColumn];
	} catch (e) {
		//do nothing
	}
};

RawViewer.prototype.append = function (html) {
	this.container.append($(html));
	return this.container;
};

RawViewer.prototype.addMetaBlock = function (rows, container) {
    // rows: [{label, value}] — falsy values are skipped; values inserted via .text() (safe)
    // container: optional target (defaults to this.container)
    container = container || this.container;
    var $block = $("<div class='rawMetaBlock'></div>");
    for (var i = 0; i < (rows || []).length; i++) {
        if (!rows[i] || !rows[i].value) continue;
        var $row = $("<div class='rawMetaRow'></div>");
        $("<span class='rawMetaLabel'></span>").text(rows[i].label + ":").appendTo($row);
        $("<span class='rawMetaValue'></span>").text(rows[i].value).appendTo($row);
        $block.append($row);
    }
    if ($block.children().length == 0) return $block;
    container.append($block);
    return $block;
};

RawViewer.prototype.openFile = async function (path) {
	return new Promise((resolve, reject) => {
		fs.readFile(path, (err, data) => {
			if (err) return reject();

			var thisEncoding = encoding.detect(data);
			if (!thisEncoding) {
				console.log("Unable to detect encoding via encoding.detect()");
				thisEncoding = this.fileEncoding || "utf8";
			}
			console.log("detected encoding", thisEncoding);
			var string;
			try {
				string = iconv.decode(data, thisEncoding);
			} catch (e) {
				console.warn("Unable to decode string try 'Shift_JIS'", e);
				string = iconv.decode(data, "Shift_JIS");
			}

			resolve(string);
		});
	});
};

RawViewer.prototype.addTextPreviewFromFileOffset = async function (file, offsetStart, offsetEnd, options) {
	options = options || {};
	var fileContent;
	if (this.cachedFileContentName !== file) {
		fileContent = await this.openFile(file);
		this.cachedFileContent = fileContent;
		this.cachedFileContentName = file;
	} else {
		fileContent = this.cachedFileContent;
	}

	var snippetData = this.getSnippetFromOffset(fileContent, offsetStart, offsetEnd);
	if (!options.language) {
		var ext = nwPath.extname(file);
		options.language = ext.substring(1);
	}
	options.lineStart = this.getStartingLineFromOffset(fileContent, offsetStart);

	options.data = {
		path: file
	};
	var snippet = await this.addTextPreview(snippetData, options);

	var wrapper = $(`<div class="snippetWrapper"><div class="snippetInfo flex"><span class="snippetPath">${file}</span><span class="lineNumber">Line:${snippetData.line}</span></div></div>`);
	wrapper.append(snippet);
	wrapper.data("fileInfo", { ...options, ...{ offsetStart: offsetStart, offsetEnd: offsetEnd } });
	this.container.append(wrapper);
	return wrapper;
};

RawViewer.prototype.addSnippetPreviewFromText = async function (content, offsetStart, offsetEnd, options) {
    // Like addTextPreviewFromFileOffset, but for an in-memory text (e.g. beautified JSON).
    // options: {language, path, note, synthetic, container} — synthetic=true suppresses
    // the "open with VS Code/Notepad++" context menu entries (line numbers are not file-real).
    options = options || {};
    if (!options.language) options.language = "txt";
    options.lineStart = this.getStartingLineFromOffset(content, offsetStart);
    options.data = { path: options.path };
    var snippetData = this.getSnippetFromOffset(content, offsetStart, offsetEnd);
    var snippet = await this.addTextPreview(snippetData, options);

    var label = options.note || ("Line:" + snippetData.line);
    var wrapper = $(`<div class="snippetWrapper"><div class="snippetInfo flex"><span class="snippetPath">${options.path || ""}</span><span class="lineNumber">${label}</span></div></div>`);
    wrapper.append(snippet);
    wrapper.data("fileInfo", Object.assign({}, options, { offsetStart: offsetStart, offsetEnd: offsetEnd }));
    wrapper.data("path", options.path);
    (options.container || this.container).append(wrapper);
    return wrapper;
};

RawViewer.prototype.loadJSONEditorLibrary = async function () {
    if (window.JSONEditor) return;
    // shared class-level cache so concurrent callers (rawViewer instance AND
    // engine addons) wait for the same load instead of racing the script tag
    if (RawViewer._jsePromise) return RawViewer._jsePromise;

    this.JSEcssIsLoaded = false;
    this.JSEjsIsLoaded = false;

    var promise = new Promise((resolve, reject) => {
        var css = document.createElement("link");
        css.setAttribute("href", "modules/jsoneditor/dist/jsoneditor.min.css");
        css.setAttribute("id", "jsonEditorStyle");
        css.setAttribute("rel", "stylesheet");
        css.setAttribute("type", "text/css");
        css.onload = () => {
            this.JSEcssIsLoaded = true;
            if (this.JSEcssIsLoaded && this.JSEjsIsLoaded) resolve();
        };
        css.onerror = () => {
            if (css.parentNode) css.parentNode.removeChild(css);
            reject(new Error("Unable to load modules/jsoneditor/dist/jsoneditor.min.css"));
        };

        let script = document.createElement('script');
        script.setAttribute('src', 'modules/jsoneditor/dist/jsoneditor.min.js');
        script.setAttribute('id', 'jsonEditorJS');
        script.onload = () => {
            this.JSEjsIsLoaded = true;
            if (this.JSEcssIsLoaded && this.JSEjsIsLoaded) resolve();
        };
        script.onerror = () => {
            // remove the dead tag so a later retry can append a fresh one
            if (script.parentNode) script.parentNode.removeChild(script);
            reject(new Error("Unable to load modules/jsoneditor/dist/jsoneditor.min.js"));
        };
        document.head.appendChild(script);

        document.head.appendChild(css);
    });
    RawViewer._jsePromise = promise.catch((e) => {
        RawViewer._jsePromise = null;
        throw e;
    });
    return RawViewer._jsePromise;
};

RawViewer.prototype.addTreeSection = function (title) {
    // Collapsible section hosting a JSONEditor tree. Open by default (JSONEditor
    // mis-renders inside display:none containers). A remembered "collapsed" state
    // from a previous section is not carried over — each new section starts open.
    title = title || "Data tree";
    this.treeSectionOpen = true;
    var $section = $(`
        <div class="rawTreeSection">
            <div class="rawTreeToggle"></div>
            <div class="rawTreeBody"><div class="jsonViewerWrapper"></div></div>
        </div>`);
    var $toggle = $section.find(".rawTreeToggle");
    var $body = $section.find(".rawTreeBody");
    var apply = () => {
        $body.toggleClass("hidden", !this.treeSectionOpen);
        $toggle.text((this.treeSectionOpen ? "\u25BE " : "\u25B8 ") + title);
    };
    $toggle.on("click", () => {
        this.treeSectionOpen = !this.treeSectionOpen;
        apply();
    });
    apply();
    this.container.append($section);
    return $section;
};

RawViewer.prototype.findActiveFile = async function (obj) {
    // 1) original game location, 2) staging data dir (…/data/), 3) staging root (…/)
    // The third fallback covers VX Ace YAML files which may live at stagingRoot/YAML/.
    var activePath = nwPath.join(trans.project.loc, obj.path);
    if (await common.isFileAsync(activePath) == false) activePath = nwPath.join(trans.getStagingDataPath(), obj.path);
    if (await common.isFileAsync(activePath) == false && trans.getStagingPath) activePath = nwPath.join(trans.getStagingPath(), obj.path);
    if (await common.isFileAsync(activePath) == false) return null;
    return activePath;
};

RawViewer.prototype.commonHandleFile = async function (selectedCell, language, offsetList) {
	var obj = trans.getSelectedObject();

	if (!obj || !obj.context) {
		this.clear();
		this.append(`<div class="rawViewerMsg">No file data available for this cell.</div>`);
		return;
	}
	if (!Array.isArray(obj.context[selectedCell.fromRow]) || obj.context[selectedCell.fromRow].length == 0) {
		this.clear();
		this.append(`<div class="rawViewerMsg">No context data for this row.</div>`);
		return;
	}

	var activePath = await this.findActiveFile(obj);

	if (activePath === null) {
		this.clear();
		let $warningMsg = $(`<div class="rawViewerMsg rawViewerWarn">${`Unable to find the file related to the data`}<br />
        ${`To fix this correct the <b>Raw material location</b> field at the <a href="#" class="openProjectProperties">Project properties</a>`}</div>`);
		$warningMsg.find(".openProjectProperties").on("click", function () {
			ui.openProjectProperties();
		});
		this.append($warningMsg);
		return;
	}

	this.clear();
	this.scrollToTop();

	offsetList = offsetList || obj.parameters[selectedCell.fromRow];
	if (!offsetList || offsetList.length == 0) {
		this.append(`<div class="rawViewerMsg">No source offset data for this row.</div>`);
		return;
	}
	// Check that at least one entry has a start offset (VX Ace data files
	// store parameters without start/end, so there's nothing to preview).
	var hasAnyStart = false;
	for (var k in offsetList) { if (offsetList[k] && offsetList[k].start) { hasAnyStart = true; break; } }
	if (!hasAnyStart) {
		this.append(`<div class="rawViewerMsg">No source offset data for this row.</div>`);
		return;
	}
	for (var i in offsetList) {
		var thisParam = offsetList[i];
		if (!thisParam.start) continue;
		var previewOptions = {
			language: language
		};
		var elm = await this.addTextPreviewFromFileOffset(activePath, thisParam.start, thisParam.end, previewOptions);
		this.addContextMenu(elm, { ...thisParam, ...{ path: activePath } });
		elm.data("path", activePath);
	}
};

RawViewer.prototype.addContextMenu = function (elm, obj) {
	elm = elm || this.elm;

	var menu;

	var createMenu = () => {
		menu = new nw.Menu();
		menu.append(new nw.MenuItem({
			label: "Copy path to clipboard",
			type: "normal",
			click: function () {
				var filePath = elm.data("path");
				if (!filePath) return;
				var clipboard = nw.Clipboard.get();
				clipboard.set(nwPath.resolve(filePath));
				alert("Path has been copied to clipboard.");
			}
		}));
		menu.append(new nw.MenuItem({
			label: "Open folder",
			type: "normal",
			click: function () {
				var filePath = elm.data("path");
				if (!filePath) return;
				nw.Shell.showItemInFolder(nwPath.resolve(filePath));
			}
		}));
		menu.append(new nw.MenuItem({
			label: "Open with external application",
			type: "normal",
			click: function () {
				var filePath = elm.data("path");
				if (!filePath) return;
				nw.Shell.openItem(nwPath.resolve(filePath));
			}
		}));

		var fileInfo = elm.data("fileInfo") || {};
		if (!fileInfo.synthetic) {
			var openWithMenu = new nw.Menu();

			openWithMenu.append(new nw.MenuItem({
				label: "VS Code",
				type: "normal",
				click: async function () {
					var scriptInfo = elm.data();
					var content = "";
					try {
						content = await common.fileGetContents(scriptInfo.path);
					} catch (e) {
						return alert("Error opening file:", scriptInfo.path);
					}

					var pos = common.cursorPosInfo(content, scriptInfo.fileInfo.offsetStart);

					common.aSpawn("code", ["--goto", `"${scriptInfo.path}":${pos.row}`], {
						detached: true,
						shell: true
					});
				}
			}));
			openWithMenu.append(new nw.MenuItem({
				label: "Notepad++",
				type: "normal",
				click: async function () {
					var scriptInfo = elm.data();
					var content = "";
					try {
						content = await common.fileGetContents(scriptInfo.path);
					} catch (e) {
						return alert("Error opening file:", scriptInfo.path);
					}

					var pos = common.cursorPosInfo(content, scriptInfo.fileInfo.offsetStart);

					if (common.IS_WIN) {
						common.aSpawn("start", ["notepad++", `"${scriptInfo.path}"`, `-n${pos.row}`], {
							detached: true,
							shell: true
						});
					} else {
						common.aSpawn("xdg-open", [`"${scriptInfo.path}"`], {
							detached: true,
							shell: true
						});
					}
				}
			}));

			menu.append(new nw.MenuItem({
				label: "Open with...",
				submenu: openWithMenu
			}));
		}
	};

	elm.on("contextmenu", function (ev) {
		ev.preventDefault();
		createMenu();
		menu.popup(parseInt(ev.originalEvent.x), parseInt(ev.originalEvent.y));
		return false;
	});
};

RawViewer.prototype.init = function () {
	$("head").append(`
    <style>
        #previewRawData .rawViewerMsg {
            color: #888;
            padding: 12px 16px;
            font-size: 11pt;
        }
        #previewRawData .rawViewerWarn {
            color: #c5a121;
            padding: 12px 16px;
            font-size: 11pt;
        }
        #previewRawData .rawViewerWarn a {
            color: #58a;
            cursor: pointer;
        }
        #previewRawData .rawMetaBlock {
            padding: 6px 12px;
            margin: 4px 0 8px 0;
            background: rgba(128, 128, 128, 0.08);
            border-left: 3px solid #58a;
            font-size: 10pt;
        }
        #previewRawData .rawMetaRow { padding: 1px 0; }
        #previewRawData .rawMetaLabel { display: inline-block; min-width: 90px; color: #888; }
        /* unified styling for all raw-tab JSON tree viewers (rmrgss + rmmv) */
        #previewRawData .jsonViewerWrapper {
            max-height: 350px;
            overflow: auto;
            border: 1px solid rgba(128, 128, 128, 0.35);
            margin-top: 4px;
        }
        #previewRawData .rawTreeToggle {
            cursor: pointer;
            padding: 6px 12px;
            color: #58a;
            user-select: none;
        }
        #previewRawData .rawTreeBody.hidden { display: none; }
    </style>
    `);
	this.setListener();
	this.loadPrism();
};

exports.RawViewer = RawViewer;
