/*
Context translation: per-row translations keyed by context path/address.
Stored under each file's `parameters[row]` array as { contextStr, translation }.
*/

class TranslationByContext {
	constructor(options) {
		this.options = options || {};
		this.container = this.options.container || $("#contextTranslation");
		this.grid = {};
		this.isInitialized = false;
		this.dataLocation = this.options.dataLocation || "parameters";
		this.data = [{ contextStr: "initialization", translation: "" }];
		this.transRow; // active trans.grid's row
		this.init();
	}
}

TranslationByContext.prototype.isTabActive = function () {
	if (typeof this._isTabActive == "undefined") return Boolean($(".tabButtons .active[data-fortab=contextTranslation]").length);
	return this._isTabActive;
};

TranslationByContext.prototype.getSelectedTranslationByContext = function () {
	if (!trans.lastSelectedCell) return;
	var rowNumber = trans.lastSelectedCell[0];

	try {
		var obj = trans.getSelectedObject();
		obj[this.dataLocation] = obj[this.dataLocation] || [];
		obj[this.dataLocation][rowNumber] = obj[this.dataLocation][rowNumber] || [];
		return obj[this.dataLocation][rowNumber];
	} catch (e) {
		return undefined;
	}
};

TranslationByContext.prototype.getContextTranslationByRow = function (row, file) {
	file = file || trans.getSelectedId();
	if (typeof row !== "number") return false;

	try {
		var thisObj = trans.getObjectById(file);
		if (!thisObj[this.dataLocation]) return false;
		return thisObj[this.dataLocation][row];
	} catch (e) {
		return false;
	}
};

TranslationByContext.prototype.rowHasContextTranslation = function (row, obj) {
	obj = obj || trans.getSelectedObject();
	if (typeof row !== "number") return false;

	try {
		if (!obj[this.dataLocation]) return false;
		if (!obj[this.dataLocation][row]) return false;

		for (var i in obj[this.dataLocation][row]) {
			if (!obj[this.dataLocation][row][i]) continue;
			if (obj[this.dataLocation][row][i].translation) return true;
		}
	} catch (e) {
		return false;
	}
};

TranslationByContext.prototype.getData = function () {
	var param = this.getSelectedTranslationByContext();
	if (!param) return [];
	var contexts = trans.getSelectedContext();

	if (Array.isArray(contexts) == false) return;
	param = param || [];
	for (var i = 0; i < contexts.length; i++) {
		param[i] = param[i] || {};
		param[i].contextStr = contexts[i];
		param[i].translation = param[i].translation || "";
	}

	this.data = param;
	console.log("context translator:", this.data);
	return this.data;
};

TranslationByContext.prototype.getContextDataByLine = function (row, transFileData) {
	var result = [];

	if (!transFileData[this.dataLocation]) return result;
	var paramData = transFileData[this.dataLocation][row];
	if (Array.isArray(paramData) == false) return result;
	for (var contextIdx = 0; contextIdx < paramData.length; contextIdx++) {
		var thisParam = paramData[contextIdx];
		if (!thisParam) continue;
		if (typeof thisParam.translation == "undefined") continue;
		result.push({
			contextStr: thisParam.contextStr,
			translation: thisParam.translation
		});
	}

	return result;
};

TranslationByContext.prototype.clear = function (fileId, row) {
	var transContext = this.getContextTranslationByRow(row, fileId);
	for (var i in transContext) {
		transContext[i].translation = "";
	}
};

TranslationByContext.prototype.clearFromObjects = function (files, options) {
	console.log("clearFromObjects", arguments);
	if (typeof trans.project == false) return false;
	files = files || trans.getSelectedId();
	options = options || {};
	options.refreshGrid = options.refreshGrid || false;

	if (Array.isArray(files) == false) files = [files];

	for (var i = 0; i < files.length; i++) {
		var file = files[i];
		var thisData = trans.project.files[file].data;
		for (var row = 0; row < thisData.length; row++) {
			this.clear(file, row);
		}
	}
	this.grid.render();
};

TranslationByContext.prototype.clearBySelected = function (fileId, row, mode) {
	if (Array.isArray(row)) row = [row];

	if (mode == "range") {
		var rowIndex = {};
		for (var i in row) {
			if (row[i].constructor.name !== "CellRange") continue;
			row[i].forAll((row, col) => {
				rowIndex[row] = true;
			});
		}
		for (var thisRow in rowIndex) {
			this.clear(fileId, thisRow);
		}
	} else {
		for (var i in row) {
			if (typeof row[i] !== "number") continue;
			this.clear(row[i], row);
		}
	}

	this.grid.render();
};

// Import context translation. Imported entries must match on key string, file & context address.
TranslationByContext.prototype.importContextTranslation = function (transData, options) {
	try {
		var obj = transData.project.files;
	} catch (e) {
		console.warn("can not fetch file data from loaded trans data", transData);
		return {};
	}

	var index = {};
	var keyColumn = transData.keyColumn || 0;
	var transKeyColumn = trans.keyColumn || 0;
	console.log("Generating index from TransData", transData);
	for (var i = 0; i < options.files.length; i++) {
		var file = options.files[i];
		console.log(">>Handling file:", file);
		index[file] = index[file] || {};
		if (Boolean(obj[file]) == false) continue;

		var transFile = trans.getObjectById(file);
		if (Boolean(transFile) == false) continue;

		for (var row = 0; row < obj[file].data.length; row++) {
			var keyString = obj[file].data[row][keyColumn];
			if (Boolean(keyString) == false) continue;
			var paramData = this.getContextDataByLine(row, obj[file]);
			if (empty(paramData)) continue;
			for (var contextId = 0; contextId < paramData.length; contextId++) {
				if (!paramData[contextId]) continue;
				if (!paramData[contextId].contextStr) continue;
				var thisContextAddress = paramData[contextId].contextStr;
				index[file][keyString] = index[file][keyString] || {};
				index[file][keyString][thisContextAddress] = {
					row: row,
					paramData: paramData[contextId]
				};
			}
		}

		console.log("Analyzing current trans file", transFile);
		transFile.parameters = transFile.parameters || [];
		for (var row = 0; row < transFile.data.length; row++) {
			if (empty(transFile.data[row])) continue;
			var keyString = transFile.data[row][transKeyColumn];
			if (Boolean(keyString) == false) continue;

			if (Array.isArray(transFile.context) == false) continue;
			var thisContext = transFile.context[row];
			if (empty(thisContext)) continue;

			if (!index[file]) continue;
			if (!index[file][keyString]) continue;
			for (var contextId = 0; contextId < thisContext.length; contextId++) {
				var thisContextAddress = thisContext[contextId];
				if (!index[file][keyString][thisContextAddress]) continue;
				transFile.parameters[row] = transFile.parameters[row] || [];
				transFile.parameters[row][contextId] = transFile.parameters[row][contextId] || {};
				transFile.parameters[row][contextId].contextStr = index[file][keyString][thisContextAddress].paramData.contextStr;
				transFile.parameters[row][contextId].translation = index[file][keyString][thisContextAddress].paramData.translation;
			}
		}
	}
};

// Build a {key: contextTranslation} map from imported data for searching.
TranslationByContext.prototype.importGenerateSearchablePairs = function (transData, options) {
	try {
		var obj = transData.project.files;
	} catch (e) {
		console.warn("can not fetch file data from loaded trans data", transData);
		return {};
	}
	var result = {};

	for (var i = 0; i < options.files.length; i++) {
		var file = options.files[i];
		if (Boolean(obj[file]) == false) continue;
		for (var row = 0; row < obj[file].data.length; row++) {
			if (Boolean(obj[file].data[row][0]) == false) continue;
			var thisTranslation = this.getContextTranslationByRow(row, file);
			if (Boolean(thisTranslation) == false) continue;
			result[obj[file].data[row][0]] = thisTranslation;
		}
	}

	console.log("importGenerateSearchablePairs:", result);
	return result;
};

TranslationByContext.prototype.reload = function () {
	console.log("refreshing transGrid");
	this.getData();
	this.grid.updateSettings({
		data: this.data
	});
	this.grid.render();
};

TranslationByContext.prototype.refresh = function () {
	this.grid.updateSettings({
		height: "100%",
		width: "100%"
	});
	this.grid.render();
};

// Called by trans.getTranslationData()
TranslationByContext.prototype.generateContextTranslation = function (row, fileId, originalWord) {
	var contextSeparator = "\n";
	var result = {
		length: 0,
		translation: {}
	};
	var parameters = this.getContextTranslationByRow(row, fileId);
	if (!parameters) return result;
	if (!Array.isArray(parameters)) return result;
	if (parameters.length < 1) return result;

	for (var contextId = 0; contextId < parameters.length; contextId++) {
		if (Boolean(parameters[contextId]) == false) continue;
		if (Boolean(parameters[contextId].translation) == false) continue;
		if (Boolean(parameters[contextId].contextStr) == false) continue;
		var contextKey = parameters[contextId].contextStr + contextSeparator + originalWord;
		result.translation[contextKey] = parameters[contextId].translation;
		result.length++;
	}
	return result;
};

TranslationByContext.prototype.init = async function () {
	if (this.isInitialized) return false;
	console.log("Initializing context grid");
	this.container.empty();
	this.gridContainer = $("<div class='hotContainer'></div>");
	this.container.append(this.gridContainer);

	this.grid = new Handsontable(this.gridContainer[0], {
		data: this.data,
		colHeaders: ["Context path", "Translation"],
		columns: [
			// Not readOnly: a readOnly cell can never be opened in the editor,
			// so its text could not be marked or copied. The beforeChange hook
			// below keeps it write-protected instead.
			{ data: "contextStr", className: "htDimmed" },
			{ readOnly: false, data: "translation" }
		],
		beforeChange: function (changes, source) {
			// The context path is the lookup key of this grid: opening it in
			// the editor (double-click) is allowed so the address can be
			// marked and copied, but any real modification is discarded.
			if (!Array.isArray(changes)) return;
			for (var i = 0; i < changes.length; i++) {
				if (changes[i] && changes[i][1] === "contextStr" && ["loadData", "internal", "meta"].indexOf(source) === -1) {
					return false;
				}
			}
		},
		height: "100%",
		width: "100%",
		colWidths: 200,
		allowInsertColumn: false,
		allowInsertRow: false,
		allowRemoveColumn: false,
		allowRemoveRow: false,
		stretchH: "last",
		manualColumnResize: true,
		placeholder: "~use default translation~",
		minSpareRows: 0,
		afterChange: function (changes, source) {
			trans.grid.render();
		}
	});

	$(document).off("beforeProcessSelection.tbc");
	$(document).on("beforeProcessSelection.tbc", (e, selectionOpt) => {
		if (!this.isTabActive()) return;
		console.log("deselect cell");
		this.grid.deselectCell();
	});

	$(document).off("onAfterSelectCell.tbc");
	$(document).on("onAfterSelectCell.tbc", (e, options) => {
		if (!this.isTabActive()) return;

		console.log("reload context list with options:", options);
		options = options || {};
		this.transRow = options.fromRow;
		this.reload();
	});

	$(document).off("onCellInfoResizeStart");
	$(document).on("onCellInfoResizeStart", () => {
		this.grid.updateSettings({
			height: "80",
			width: "80"
		});
		this.gridContainer.addClass("hidden");
	});

	var resetTablePossition = () => {
		this.gridContainer.removeClass("hidden");
		this.grid.updateSettings({
			height: $("#contextTranslation").innerHeight() - 4,
			width: $("#contextTranslation").innerWidth() - 4
		});
		this.refresh();
	};

	$(document).off("onCellInfoResizeStop");
	$(document).on("onCellInfoResizeStop", () => {
		resetTablePossition();
	});

	$(document).off("translationOnTabChange.tbc");
	$(document).on("translationOnTabChange.tbc", (e, tabName) => {
		console.log("changed to ", tabName);
		if (tabName == "contextTranslation") {
			this._isTabActive = true;
			resetTablePossition();
		} else {
			this._isTabActive = false;
		}
	});

	$(document).off("onAfterImportTranslations.tbc");
	$(document).on("onAfterImportTranslations.tbc", (e, obj) => {
		if (!obj.options.translateContext) return;
		console.log("onAfterImportTranslations ", obj);
		this.importContextTranslation(obj.loadedData, obj.options);
	});

	$(document).off("removeAllTranslation.tbc");
	$(document).on("removeAllTranslation.tbc", (e, param) => {
		this.clearFromObjects(param.files, param.options);
	});

	$(document).off("clearContextTranslationByRow.tbc");
	$(document).on("clearContextTranslationByRow.tbc", (e, param) => {
		var conf = confirm("Do you want to delete all context translation on the currently selected row?");
		if (!conf) return;

		this.clearFromObjects(param.files, param.options);
	});

	$('[data-tabname="contextTranslation"] .clearContextTranslation').off("click");
	$('[data-tabname="contextTranslation"] .clearContextTranslation').on("click", () => {
		var conf = confirm("Do you want to delete all translation on the currently active row?");
		if (!conf) return;
		console.log(`Clearing ${trans.getSelectedId()} row ${this.transRow}`);
		this.clear(trans.getSelectedId(), this.transRow);
		this.grid.render();
	});

	$(document).off("afterRemoveRow.tbc");
	$(document).on("afterRemoveRow.tbc", (e, param) => {
		if (this.dataLocation == "parameters") return;
		var file = param.file;
		var rows = param.rows;
		var options = param.options;

		for (var i = 0; i < rows.length; i++) {
			var thisRow = rows[i];
			if (typeof trans.getObjectById(file).data[thisRow] == "undefined") continue;
			if (empty(trans.getObjectById(file)[this.dataLocation])) continue;
			if (trans.getObjectById(file)[this.dataLocation]) trans.project.files[file][this.dataLocation].splice(thisRow, 1);
		}
	});

	this.isInitialized = true;
};

module.exports = TranslationByContext;
