const nwPath = require("path"); // eslint-disable-line

const Search = function () {
	try {
		this.config = JSON.parse(localStorage.getItem("search.config"));
	} catch (e) {
		// do nothing.
	}
	this.config = this.config || {};
	if (typeof this.config.alwaysOnTop == "undefined") this.config.alwaysOnTop = true;
	this.config.blurOpacity = this.config.blurOpacity || 0.7;
};
var search = new Search();

search.setConfig = function (key, value) {
	this.config[key] = value;
	this.saveConfig();
};

search.getConfig = function (key) {
	return this.config[key];
};

search.saveConfig = function () {
	localStorage.setItem("search.config", JSON.stringify(this.config));
};
search.blurOpacity = search.getConfig("blurOpacity");

var win = nw.Window.get();
win.restore();
win.show();
win.setResizable(true);
win.height = 340;
win.width = 640;

if (win.y < 0) win.y = 0;
if (win.x < 0) win.x = 0;
console.log("current Y", win.y, win.y < 0);
setTimeout(() => {
	if (win.y < 0) win.y = 0;
	win.setMinimumSize(640, 340);
	console.log("current Y", win.y);
	try {
		var lastPos = window.localStorage.getItem("searchWindowPossition");
		if (!lastPos) return;
		lastPos = JSON.parse(lastPos);
		console.log("Setting window position", lastPos);

		win.x = lastPos.x;
		win.y = lastPos.y;
	} catch (e) {
		//do nothing
	}
}, 200);

win.setAlwaysOnTop(search.getConfig("alwaysOnTop"));
win.setShowInTaskbar(false);
win.setMinimumSize(530, 260);

var sys = window.opener.sys;
var trans = window.opener.trans;
var ui = window.opener.ui;

search.getSelectedResult = function () {
	var $activeTab = $(".ui-tabs-panel[aria-hidden=false]");
	var $selected = $activeTab.find(".findItemSelector:checked");
	var data = [];
	$selected.each(function () {
		var $this = $(this);
		var thisData = $this.data();
		thisData.file = $this.closest(".resultContext").data("id");
		data.push(thisData);
	});
	return data;
};

// Replaces the literal escape sequences \r \n \t with actual CR/LF/tab.
search.transpileText = function (text) {
	console.log("Transpiling text", text);
	text = text || "";
	text = text.replaceAll("\\r", "\r");
	text = text.replaceAll("\\n", "\n");
	text = text.replaceAll("\\t", "\t");
	console.log("After transpile:", text);
	return text;
};

search.initFileSelectorDragSelect = function () {
	var DragSelect = DragSelect || require("dragselect");

	const toggleCheck = function (elm) {
		var $elm = $(elm);
		var orig = this._initialCursorPos.x + "," + this._initialCursorPos.y;
		var after = this._newCursorPos.x + "," + this._newCursorPos.y;
		// DragSelect adds its hover class to rows touched by the selection rect on
		// mouse-down; a click that ends without a drag never clears it, so always
		// strip it once the drag is over.
		$(this.selectables).removeClass("ds-hover");
		if (orig == after) return false;
		if ($elm.length <= 1) return false;
		$elm.each(function () {
			var $input = $(this).find("input");
			if ($input.prop("disabled")) return;

			if (search.shiftPressed) {
				$input.prop("checked", false);
			} else {
				$input.prop("checked", true);
			}
			$input.trigger("change");
			window.ds.clearSelection();
		});
	};

	const $fileSelectors = $(".fileSelector");
	for (let i = 0; i < $fileSelectors.length; i++) {
		let thisSelector = $fileSelectors[i];
		window.ds = new DragSelect({
			selectables: document.querySelectorAll(".selectable"),
			autoScrollSpeed: 15,
			area: thisSelector,
			callback: toggleCheck
		});
	}

	if (search.fileSelectorIsInitialized) return;
	window.onkeyup = function (e) {
		if (e.keyCode == 16) search.shiftPressed = false;
	};

	window.onkeydown = function (e) {
		if (e.shiftKey) search.shiftPressed = true;
	};
	search.fileSelectorIsInitialized = true;
};

search.getKeyboardStatus = function (keyboard) {
	if (keyboard == "shift") return search.shiftPressed;
};

search.checkGroup = function ($selectFld, action) {
	var $allCheckbox = $selectFld.closest(".resultContext").find("ul .findItemSelector");
	var thisStatus = $selectFld.prop("checked");
	$allCheckbox.each(function () {
		$(this).prop("checked", thisStatus);
	});
};

search.checkAll = function ($selectFld, action) {
	console.log($selectFld);
	var $allHeaderCheckbox = $selectFld.closest(".actionResult").find(".headerGroupCheckbox");
	var thisStatus = $selectFld.prop("checked");
	$allHeaderCheckbox.each(function () {
		$(this).prop("checked", thisStatus);
		$(this).trigger("input");
	});
};

search.getTags = function (file, row) {
	var result = [];
	try {
		result = trans.project.files[file].tags[row];
	} catch (err) {
		// do nothing
	}
	return result;
};

search.drawTags = function ($resultLine, file, row, options) {
	options = options || {};
	options.force = options.force || false;

	try {
		var tags = search.getTags(file, row);
		if (options.force == false) {
			if (Array.isArray(tags) == false) return $resultLine;
			if (tags.length == 0) return $resultLine;
		}
		var $resultInfo = $resultLine.find(".resultInfo");
		$resultInfo.find(".tags").remove();
		var $tagContainer = $("<span class='tags'></span>");
		$resultInfo.append($tagContainer);

		if (Array.isArray(tags) == false) return $resultLine;

		for (var i = 0; i < tags.length; i++) {
			let $thisIcon = $("<i class='tagIcon icon-circle " + tags[i] + "' title='" + tags[i] + "'></i>");
			$thisIcon.css("color", consts.tagColor[tags[i]]);
			$tagContainer.append($thisIcon);
		}
	} catch (err) {
		console.log("Error drawing tags", err);
	}
	return $resultLine;
};

search.appendTags = function (file, row, tags, $actionResult) {
	try {
		if (Array.isArray(tags) == false) tags = [tags];
		trans.appendTags(file, parseInt(row), tags);
	} catch (err) {
		console.warning("Failed to handle appendTags", err);
	}
};

search.appendTagsOnSelected = function (tags, $actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");
	var startTime = performance.now();
	var $lines = $actionResult.find(".findItemSelector:checked");
	$lines.each(function () {
		var $this = $(this);
		var $resultItem = $this.closest(".resultItem");
		var $resultContext = $this.closest(".resultContext");
		search.appendTags($resultContext.data("id"), $resultItem.attr("data-row"), tags);
		search.drawTags($resultItem, $resultContext.data("id"), $resultItem.attr("data-row"));
	});
	var endTime = performance.now();
	console.log(`Append tags done! It took ${endTime - startTime} ms `);
	trans.grid.render();
};

search.setTags = function (file, row, tags, $actionResult) {
	try {
		if (Array.isArray(tags) == false) tags = [tags];
		trans.setTags(file, parseInt(row), tags);
	} catch (err) {
		console.warning("Failed to handle appendTags", err);
	}
};

search.setTagsOnSelected = function (tags, $actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");

	var $lines = $actionResult.find(".findItemSelector:checked");
	$lines.each(function () {
		var $resultItem = $(this).closest(".resultItem");
		var $resultContext = $(this).closest(".resultContext");
		search.setTags($resultContext.data("id"), $resultItem.attr("data-row"), tags);
		search.drawTags($resultItem, $resultContext.data("id"), $resultItem.attr("data-row"));
	});
	trans.grid.render();
};

search.removeTags = function (file, row, tags, $actionResult) {
	try {
		if (Array.isArray(tags) == false) tags = [tags];
		trans.removeTags(file, parseInt(row), tags);
	} catch (err) {
		console.warning("Failed to handle appendTags", err);
	}
};

search.removeTagsOnSelected = function (tags, $actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");

	var $lines = $actionResult.find(".findItemSelector:checked");
	$lines.each(function () {
		var $resultItem = $(this).closest(".resultItem");
		var $resultContext = $(this).closest(".resultContext");
		search.removeTags($resultContext.data("id"), $resultItem.attr("data-row"), tags);
		search.drawTags($resultItem, $resultContext.data("id"), $resultItem.attr("data-row"));
	});
	trans.grid.render();
};

search.clearTags = function (file, row, $actionResult) {
	try {
		trans.clearTags(file, parseInt(row));
	} catch (err) {
		console.warning("Failed to handle clearTags", err);
	}
};

search.clearTagsOnSelected = function ($actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");

	var $lines = $actionResult.find(".findItemSelector:checked");
	$lines.each(function () {
		var $resultItem = $(this).closest(".resultItem");
		var $resultContext = $(this).closest(".resultContext");
		search.clearTags($resultContext.data("id"), $resultItem.attr("data-row"));
		$resultItem.find(".tags").empty();
	});
	trans.grid.render();
};

search.openTagMenu = function () {
	var $popup = $("#find_tagMenu");
	if ($popup.length == 0) {
		$popup = $("<div id='find_tagMenu'></div>");
		$("#template").append($popup);
		var tags = new UiTags({
			options: $(`
			<h2>${"Action"}</h2>
			<div class="actionSet">
				<label class="flex"><input type="radio" name="tagAction" class="appendTags" value="appendTags" /> <span>${"Append tags"}</span></label>
				<label class="flex"><input type="radio" name="tagAction" class="removeTags" value="removeTags" /> <span>${"Remove tags"}</span></label>
				<label class="flex"><input type="radio" name="tagAction" class="setTags" value="setTags" /> <span>${"Set tags"}</span></label>
				<label class="flex"><input type="radio" name="tagAction" class="actionNone" value="" /> <span>${"Do nothing"}</span></label>
			</div>		
			`)
		});
		this._uiTags = tags;
		$popup.empty();
		$popup.append(tags.element);
	}
	$popup.dialog({
		title: "Set tags",
		autoOpen: false,
		modal: true,
		width: 480,
		height: 220,
		minWidth: 480,
		minHeight: 220,
		show: { effect: "fade", duration: 200 },
		hide: { effect: "fade", duration: 200 },
		buttons: [
			{
				text: "Close",
				icon: "ui-icon-close",
				click: function () {
					$(this).dialog("close");
				}
			},
			{
				text: "Proceed",
				click: async function () {
					var $this = $(this);
					var tags = search._uiTags.getValue();
					console.log(tags);
					if (tags === false) return false;

					$this.dialog("close");

					if (tags.filterTagMode == "appendTags") {
						search.appendTagsOnSelected(tags.filterTag);
					} else if (tags.filterTagMode == "removeTags") {
						search.removeTagsOnSelected(tags.filterTag);
					} else {
						search.setTagsOnSelected(tags.filterTag);
					}
				}
			}
		]
	});
	$popup.dialog("open");
};

search.getKeywords = function () {
	try {
		var keywords = JSON.parse(localStorage.getItem("search.keywords"));
		if (Array.isArray(keywords)) return keywords;
	} catch (e) {
		// do nothing
	}
	return [];
};

search.loadKeywords = function () {
	// The keyword history lives in localStorage; offer it as autocomplete on
	// the find fields. Textareas can't use a datalist, so this uses jquery-ui
	// autocomplete instead.
	var $fields = $("#fieldFind, #fieldReplaceFind, #fieldReplaceReplace");
	$fields.attr("autocomplete", "off").autocomplete({
		source: function (request, response) {
			var term = request.term.toLowerCase();
			response(search.getKeywords().filter(function (keyword) {
				return keyword.toLowerCase().indexOf(term) != -1;
			}));
		},
		minLength: 1,
		delay: 0,
		select: function (e, ui) {
			$(this).val(ui.item.value);
			// The Enter that picked this suggestion must not also run the search.
			search.suppressEnter = true;
			setTimeout(function () {
				search.suppressEnter = false;
			}, 0);
			return false;
		}
	});
	// jquery-ui only picks a suggestion on Enter when an item is highlighted.
	// A datalist picks the (first) match instead, so keep that behavior: Enter
	// with an open menu fills the field and leaves the search to the next Enter.
	// Runs in the capture phase so it wins over jquery-ui's own keydown handler.
	document.addEventListener("keydown", function (e) {
		if (e.keyCode != 13 || e.altKey || e.shiftKey) return;
		var field = e.target;
		if (!field || (field.id != "fieldFind" && field.id != "fieldReplaceFind" && field.id != "fieldReplaceReplace")) return;
		var instance = $(field).autocomplete("instance");
		if (!instance || !instance.menu.element.is(":visible")) return;
		var $menu = instance.menu.element;
		var $picked = $menu.find(".ui-state-focus, .ui-state-active").first().closest(".ui-menu-item");
		if ($picked.length == 0) $picked = $menu.find(".ui-menu-item").first();
		if ($picked.length == 0) return;
		$(field).val($picked.text());
		instance.close();
		e.preventDefault();
		e.stopPropagation();
	}, true);
};

search.addKeyword = function (keyword) {
	var keywords = this.getKeywords();
	var existIndex = keywords.indexOf(keyword);
	if (existIndex != -1) keywords.splice(existIndex, 1);
	keywords.unshift(keyword);
	if (keywords.length > 100) keywords = keywords.slice(0, 100);
	localStorage.setItem("search.keywords", JSON.stringify(keywords));
};

search.sendCommandFind = function (keyword) {
	keyword = keyword || $("#fieldFind").val();
	if (keyword.length < 1) return alert("Keyword too short!");
	this.addKeyword(keyword);
	var caseSensitiveMode = $("#caseSensitive").prop("checked");
	var $notFoundMsg = $("<div class='blockBox infoBlock withIcon'>" + "Found nothing!<br />Don't forget to set the Target search field." + "</div>");

	var selectedFiles = "*";
	if ($("#selectAllFile").prop("checked") == false) {
		selectedFiles = [];
		$("#find .fileSelector .filename:checked").each(function () {
			selectedFiles.push($(this).attr("value"));
		});
	}

	if ($("#find .transpileCode").prop("checked")) {
		keyword = this.transpileText(keyword);
	}

	console.log("Selected file is :");
	console.log(selectedFiles);

	var searchLocations = $(".searchMode").val();

	var result = trans.search(keyword, {
		caseSensitive: caseSensitiveMode,
		files: selectedFiles,
		searchLocations: searchLocations,
		isRegexp: $("#findIsRegexp").prop("checked")
	});

	search.toggleFileList(false);
	$("#find .searchResult").empty();

	var $template = $("<div class='searchResultHeader column2'>\
						<div class='searchresultAction'>\
							<input type='checkbox' value='' class='headerCheckbox' /> \
							<span>Select all</span>\
						</div>\
						<div class='right searchResultData'>\
							<i class='icon-docs'></i> <span class='numFile'>" + result.count + "</span>\
							<i class='icon-hourglass-3'></i> " + result.executionTime + " ms\
						</div>\
					</div>");
	$template.find(".headerCheckbox").on("input", function (e) {
		search.checkAll.call(search, $(this));
	});

	$("#find .searchResult").append($template);
	if (typeof result.files == "undefined" || result.count == 0) $("#find .searchResult").append($notFoundMsg);

	for (var file in result.files) {
		var $lineFile = $("<div class='resultContext' ><h2><input type='checkbox' value='1' class='headerGroupCheckbox' /> <i class='icon-doc'></i>" + file + " <span class='contextCount'>" + result.files[file].length + "</span></h2><ul></ul></div>");
		$lineFile.data("id", file);
		$lineFile.find(".headerGroupCheckbox").on("input", function (e) {
			search.checkGroup.call(search, $(this));
		});
		for (var i in result.files[file]) {
			var currentLine = result.files[file][i];
			var refference = "";
			var foundStr = common.htmlEntities(currentLine.fullString);

			if (result.isRegexp) {
				var regExpKeyword = common.evalRegExpStr(keyword);
				if (regExpKeyword !== false) {
					foundStr = foundStr.replace(regExpKeyword, function () {
						return '<span class="highlight">' + arguments[0] + "</span>";
					});
				}
			} else {
				foundStr = foundStr.replaces(keyword, "<span class='highlight'>" + common.htmlEntities(keyword) + "</span>", !caseSensitiveMode);
			}
			try {
				var thisFileRef = trans.project.files[file].data[currentLine.row];
				if (currentLine.col == 0) {
					for (var n = thisFileRef.length; n > 0; n--) {
						if (thisFileRef[n]) {
							refference = thisFileRef[n];
							break;
						}
					}
				} else {
					refference = thisFileRef[0];
				}
			} catch (err) {
				// do nothing
			}

			refference = common.htmlEntities(refference);

			var lineTemplate = $("<li class='resultItem' title='click to go' data-row='" + currentLine.row + "' data-col='" + currentLine.col + "'>" +
				"<div class='texts'>" +
				"<h1>" + foundStr + "</h1>" +
				"<h1 class='refference' title='refference'>" + refference + "</h1>" +
				"</div>" +
				`<div class='resultInfo'><span class='findItemSelectorWrapper'><input type='checkbox' data-row='${currentLine.row}' data-col='${currentLine.col}' class='findItemSelector' value='' /></span><span class='rowLabel' title='row'>${currentLine.row}</span><span class='colLabel' title='column'>${currentLine.col}</span></div></li>`);
			lineTemplate.data("row", currentLine.row);
			lineTemplate.data("col", currentLine.col);
			lineTemplate.data("context", file);
			lineTemplate.on("click", function (e) {
				if ($(e.target).is("input[type=checkbox]")) {
					return;
				}
				trans.goTo($(this).data("row"), $(this).data("col"), $(this).data("context"));
				$(this).closest(".searchResult").find(".selected").removeClass("selected");
				$(this).addClass("selected");
			});

			lineTemplate.find(".findItemSelector").on("change", function () {
				search.find = search.find || {};
				if ($(this).prop("checked") == true) {
					search.find.$lastCheckedFile = $(this);
				} else {
					search.find.$lastCheckedFile = undefined;
				}
			});
			lineTemplate.find(".findItemSelector").on("mousedown", function (e) {
				search.find = search.find || {};
				if (!search.find.$lastCheckedFile) return false;
				if (e.shiftKey) {
					console.log("The SHIFT key was pressed!");
					var $checkBoxes = $(this).closest(".actionResult").find(".findItemSelector");
					var lastIndex = $checkBoxes.index(search.find.$lastCheckedFile);
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
					console.log("check from index " + chckFrom + " to " + chckTo);
					for (var i = chckFrom; i < chckTo; i++) {
						$checkBoxes.eq(i).prop("checked", true).trigger("change");
					}
				}
			});

			search.drawTags(lineTemplate, file, currentLine.row);
			$lineFile.find("ul").append(lineTemplate);
		}
		$("#find .searchResult").append($lineFile);
	}

	console.log(result);
};

search.sendCommandReplace = function () {
	var keyword = $("#fieldReplaceFind").val();
	var replacer = $("#fieldReplaceReplace").val();
	if (keyword.length < 1) return alert("Keyword too short!");
	this.addKeyword(keyword);
	var $notFoundMsg = $("<div class='blockBox infoBlock withIcon'>" + "Found nothing to replace!<br />Replace function doesn't replace anything on the key column." + "</div>");

	var conf = confirm("Replace '" + keyword + "' with '" + replacer + "'?\r\nWe still haven't create undo function for this thing!\nAre you sure want to proceed?");
	if (!conf) return false;

	var caseSensitiveMode = $("#caseSensitiveReplace").prop("checked");

	var selectedFiles = "*";
	if ($("#selectAllFileReplace").prop("checked") == false) {
		selectedFiles = [];
		$("#replace .fileSelector .filename:checked").each(function () {
			selectedFiles.push($(this).attr("value"));
		});
	}

	if ($("#replace .transpileCode").prop("checked")) {
		keyword = this.transpileText(keyword);
		replacer = this.transpileText(replacer);
	}

	console.log("Selected file is :");
	console.log(selectedFiles);

	var result = trans.replace(keyword, replacer, {
		caseSensitive: caseSensitiveMode,
		files: selectedFiles,
		isRegexp: $("#replaceIsRegexp").prop("checked")
	});

	search.toggleFileList(false);
	$(".replaceResult").empty();

	if (typeof result.files == "undefined") $(".replaceResult").html($notFoundMsg);
	if (result.count == 0) $(".replaceResult").html($notFoundMsg);

	var $template = $("<div class='searchResultHeader column2'>\
						<div class='searchresultAction'>\
							<input type='checkbox' value='' class='headerCheckbox' /> \
							<span>Select all</span>\
						</div>\
						<div class='right searchResultData'>\
							<i class='icon-docs'></i> <span class='numFile'>" + result.count + "</span>\
							<i class='icon-hourglass-3'></i> " + result.executionTime + " ms\
						</div>\
					</div>");
	$template.find(".headerCheckbox").on("input", function (e) {
		search.checkAll.call(search, $(this));
	});

	$(".replaceResult").prepend($template);

	for (var file in result.files) {
		var $lineFile = $("<div class='resultContext' ><h2><input type='checkbox' value='1' class='headerGroupCheckbox' /><i class='icon-doc'></i>" + file + " <span class='contextCount'>" + result.files[file].length + "</span></h2><ul></ul></div>");
		$lineFile.data("id", file);
		$lineFile.find(".headerGroupCheckbox").on("input", function (e) {
			search.checkGroup.call(search, $(this));
		});

		for (var i in result.files[file]) {
			var currentLine = result.files[file][i];

			var foundStr = common.htmlEntities(currentLine.originalString);

			if (result.isRegexp) {
				var regExpKeyword = common.evalRegExpStr(keyword);
				if (regExpKeyword !== false) {
					foundStr = foundStr.replace(regExpKeyword, function () {
						return '<span class="highlight2">' + arguments[0] + "</span>";
					});
				}
			} else {
				foundStr = foundStr.replaces(keyword, "<span class='highlight2'>" + keyword + "</span>", !caseSensitiveMode);
			}

			var replacedString = common.htmlEntities(currentLine.fullString).replaces(replacer, "<span class='highlight'>" + replacer + "</span>");

			var lineTemplate = $("<li class='resultItem' title='" + "click to go" + "' data-row='" + currentLine.row + "' data-col='" + currentLine.col + "'>" +
				"<div class='texts'>" +
				"<h1 class='refference' title='refference'>" + foundStr + "</h1>" +
				"<span><i class='icon-right-big'> </i></span>" +
				"<h1>" + replacedString + "</h1>" +
				"</div>" +
				`<div class='resultInfo'><span class='findItemSelectorWrapper'><input type='checkbox' data-row='${currentLine.row}' data-col='${currentLine.col}' class='findItemSelector' value='' /></span><span class='rowLabel' title='row'>${currentLine.row}</span><span class='colLabel' title='column'>${currentLine.col}</span></div></li>`);
			lineTemplate.data("row", currentLine.row);
			lineTemplate.data("col", currentLine.col);
			lineTemplate.data("context", file);
			lineTemplate.on("click", function (e) {
				if ($(e.target).is("input[type=checkbox]")) {
					return;
				}
				trans.goTo($(this).data("row"), $(this).data("col"), $(this).data("context"));
			});

			lineTemplate.find(".findItemSelector").on("change", function () {
				search.repl = search.repl || {};
				if ($(this).prop("checked") == true) {
					search.repl.$lastCheckedFile = $(this);
				} else {
					search.repl.$lastCheckedFile = undefined;
				}
			});
			lineTemplate.find(".findItemSelector").on("mousedown", function (e) {
				search.repl = search.repl || {};
				if (!search.repl.$lastCheckedFile) return false;
				if (e.shiftKey) {
					console.log("The SHIFT key was pressed!");
					var $checkBoxes = $(this).closest(".actionResult").find(".findItemSelector");
					var lastIndex = $checkBoxes.index(search.repl.$lastCheckedFile);
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
					console.log("check from index " + chckFrom + " to " + chckTo);
					for (let i = chckFrom; i < chckTo; i++) {
						$checkBoxes.eq(i).prop("checked", true).trigger("change");
					}
				}
			});

			search.drawTags(lineTemplate, file, currentLine.row);
			$lineFile.find("ul").append(lineTemplate);
		}
		$(".replaceResult").append($lineFile);
	}

	console.log(result);
};

search.sendCommandPut = function () {
	var conf = confirm("This will replace any translation found in target colum,\nAre you sure?");
	if (!conf) return false;
	var keyword = $("#findPut .fldFind").val();
	if (keyword.length < 1) return alert("Keyword too short!");

	var put = $("#findPut .fldPut").val();
	var caseSensitiveMode = $("#findPut .caseSensitive").prop("checked");
	var targetCol = parseInt($("#findPut .targetSelector select").val());
	targetCol = parseInt(targetCol);

	var selectedFiles = "*";
	if ($("#findPut .selectAllFile").prop("checked") == false) {
		selectedFiles = [];
		$("#findPut .fileSelector .filename:checked").each(function () {
			selectedFiles.push($(this).attr("value"));
		});
	}
	console.log("Selected file is :");
	console.log(selectedFiles);

	var result = trans.findPut(keyword, put, targetCol, {
		caseSensitive: caseSensitiveMode,
		files: selectedFiles,
		lineMatch: true
	});

	console.log("result is", result);

	search.toggleFileList(false);
	$("#findPut .searchResult").empty();

	if (typeof result.files == "undefined") $("#findPut .searchResult").html("Not found!");
	if (result.count == 0) $("#findPut .searchResult").html("Not found!");

	var $template = $("<div class='searchResultHeader column2'>\
						<div class='searchresultAction'>\
							<input type='checkbox' value='' class='headerCheckbox' /> \
							<span>Select all</span>\
						</div>\
						<div class='right searchResultData'>\
							<i class='icon-docs'></i> <span class='numFile'>" + result.count + "</span>\
							<i class='icon-hourglass-3'></i> " + result.executionTime + " ms\
						</div>\
					</div>");
	$template.find(".headerCheckbox").on("input", function (e) {
		search.checkAll.call(search, $(this));
	});

	$("#findPut .searchResult").prepend($template);

	for (var file in result.files) {
		var $lineFile = $("<div class='resultContext' ><h2><i class='icon-doc'></i>" + file + " <span class='contextCount'>" + result.files[file].length + "</span></h2><ul></ul></div>");
		$lineFile.data("id", file);
		for (var i in result.files[file]) {
			var currentLine = result.files[file][i];
			var foundStr = currentLine.fullString.replaces(keyword, "<span class='highlight'>" + keyword + "</span>", !caseSensitiveMode);
			var refference = "";

			try {
				var thisFileRef = trans.project.files[file].data[currentLine.row];
				refference = thisFileRef[targetCol];
			} catch (err) {
				// do nothing
			}

			var lineTemplate = $("<li class='resultItem' title='click to go' data-row='" + currentLine.row + "' data-col='" + currentLine.col + "'>" +
				"<div class='texts'>" +
				"<h1>" + foundStr + "</h1>" +
				"<h1 class='refference' title='refference'>" + refference + "</h1>" +
				"</div>" +
				`<div class='resultInfo'><span class='findItemSelectorWrapper'><input type='checkbox' data-row='${currentLine.row}' data-col='${currentLine.col}' class='findItemSelector' value='' /></span><span class='rowLabel' title='row'>${currentLine.row}</span><span class='colLabel' title='column'>${currentLine.col}</span></div></li>`);
			lineTemplate.data("row", currentLine.row);
			lineTemplate.data("col", currentLine.col);
			lineTemplate.data("context", file);
			lineTemplate.on("click", function (e) {
				if ($(e.target).is("input[type=checkbox]")) {
					return;
				}
				trans.goTo($(this).data("row"), $(this).data("col"), $(this).data("context"));
			});

			lineTemplate.find(".findItemSelector").on("change", function () {
				search.find = search.find || {};
				if ($(this).prop("checked") == true) {
					search.find.$lastCheckedFile = $(this);
				} else {
					search.find.$lastCheckedFile = undefined;
				}
			});
			lineTemplate.find(".findItemSelector").on("mousedown", function (e) {
				search.find = search.find || {};
				if (!search.find.$lastCheckedFile) return false;
				if (e.shiftKey) {
					console.log("The SHIFT key was pressed!");
					var $checkBoxes = $(this).closest(".actionResult").find(".findItemSelector");
					var lastIndex = $checkBoxes.index(search.find.$lastCheckedFile);
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
					console.log("check from index " + chckFrom + " to " + chckTo);
					for (let i = chckFrom; i < chckTo; i++) {
						$checkBoxes.eq(i).prop("checked", true).trigger("change");
					}
				}
			});

			search.drawTags(lineTemplate, file, currentLine.row);
			$lineFile.find("ul").append(lineTemplate);
		}
		$("#findPut .searchResult").append($lineFile);
	}
};

search.drawFileSelector = function () {
	if (typeof trans.project == "undefined") return false;
	var project = trans.project;
	for (var file in project.files) {
		var template = $("<label class='selectable'><input type='checkbox' class='filename' value='" + file + "' /><span>" + file + "</span></label>");
		template.attr("title", file);
		$(".fileSelector").append(template);
	}
	search.initFileSelectorDragSelect();
};

search.toggleFileList = function (stat) {
	if (typeof stat == "undefined") {
		stat = !$(".toggleFileSelector").hasClass("opened");
	}

	if (!stat) {
		$(".fileSelector").addClass("hidden");
		$(".toggleFileSelector").removeClass("opened");
	} else {
		$(".fileSelector").removeClass("hidden");
		$(".toggleFileSelector").addClass("opened");
	}
	return stat;
};

// ======================================================================
// context menu handler
// ======================================================================

search.selectAll = function ($actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");
	var $headerCheckbox = $actionResult.find(".headerCheckbox");
	$headerCheckbox.prop("checked", true);
	$headerCheckbox.trigger("input");
};

search.unSelectAll = function ($actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");
	var $headerCheckbox = $actionResult.find(".headerCheckbox");
	$headerCheckbox.prop("checked", false);
	$headerCheckbox.trigger("input");
};

search.clearTranslationOnSelected = function ($actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");

	var $lines = $actionResult.find(".findItemSelector:checked");
	$lines.each(function () {
		var $resultItem = $(this).closest(".resultItem");
		var $resultContext = $(this).closest(".resultContext");
		var fileId = $resultContext.data("id");
		var row = $resultItem.attr("data-row");

		try {
			var thisRow = trans.project.files[fileId].data[row];
			trans.project.files[fileId].data[row] = thisRow.fill("", 1);
		} catch (e) {
			//do nothing
		}
	});
	trans.grid.render();
};

search.removeSelectedElement = function ($actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");
	var $files = $actionResult.find(".resultContext");
	$files.each(function () {
		var $thisFile = $(this);
		var $thisLines = $thisFile.find(".findItemSelector:checked");
		if ($thisLines.length < 1) return;
		$thisLines.each(function () {
			$(this).closest("li").remove();
		});

		if ($thisFile.find("li.resultItem").length < 1) $thisFile.remove();
	});

	$actionResult.find(".numFile").text($actionResult.find("li.resultItem").length);
};

search.deleteSelected = function ($actionResult) {
	$actionResult = $actionResult || $(".ui-tabs-panel[aria-hidden=false] .actionResult");

	var $files = $actionResult.find(".resultContext");
	for (var i = 0; i < $files.length; i++) {
		var $thisFile = $files.eq(i);
		var $thisLine = $thisFile.find(".findItemSelector:checked");
		if ($thisLine.length < 1) continue;
		var fileId = $thisFile.data("id");
		var rows = [];
		for (var x = 0; x < $thisLine.length; x++) {
			rows.push($thisLine.eq(x).data("row"));
		}
		console.log(`trans.removeRow()`, fileId, rows);
		trans.removeRow(fileId, rows);
	}
	this.removeSelectedElement($actionResult);
	trans.grid.render();
};

search.openAutomationEditor = async function () {
	var options = {
		workspace: "foundCells",
		foundCells: search.getSelectedResult()
	};
	ui.openAutomationEditor("codeEditor_foundCells", options);
};

search.automationMenu = function () {
	console.log("Creating automation menu");
	var subMenu = new nw.Menu();
	const configPath = "codeEditor/foundCells";

	var menuConfig = sys.getConfig(configPath);
	if (!menuConfig) {
		sys.setConfig(configPath, { quickLaunch: [] });
		menuConfig = sys.getConfig(configPath);
	}
	menuConfig["quickLaunch"] = menuConfig["quickLaunch"] || [];
	for (var i = 0; i < menuConfig["quickLaunch"].length; i++) {
		(() => {
			var filePath = menuConfig["quickLaunch"][i];
			var filename = common.getFilename(filePath);
			subMenu.append(new nw.MenuItem({
				label: filename,
				type: "normal",
				click: function () {
					const searchResult = search.getSelectedResult();
					var conf = confirm("Are you sure want to execute the following script?" + "\n" + filename + "\n" +
						"For " + searchResult.length + " selected item(s)?");
					if (!conf) return;
					trans.runCustomScript("foundCells", filePath, {
						foundCells: searchResult
					});
				}
			}));
		})();
	}
	return subMenu;
};

search.searchResultContextMenu = function () {
	console.log("trans.fileSelectorContextMenuInit");
	if (this.searchResultContextMenuIsInitialized) return false;
	this.menu = new nw.Menu();

	this.menu.append(new nw.MenuItem({
		label: " Select all",
		type: "normal",
		click: function () {
			search.selectAll();
		}
	}));
	this.menu.append(new nw.MenuItem({
		label: " Clear selection",
		type: "normal",
		click: function () {
			search.unSelectAll();
		}
	}));
	this.menu.append(new nw.MenuItem({ type: "separator" }));

	var tagging = new nw.Menu();

	tagging.append(new nw.MenuItem({
		label: " Set Red tag",
		type: "normal",
		icon: "www/img/red.png",
		click: function () {
			search.appendTagsOnSelected("red");
		}
	}));
	tagging.append(new nw.MenuItem({
		label: " Set Yellow tag",
		type: "normal",
		icon: "www/img/yellow.png",
		click: function () {
			search.appendTagsOnSelected("yellow");
		}
	}));
	tagging.append(new nw.MenuItem({
		label: " Set Green tag",
		type: "normal",
		icon: "www/img/green.png",
		click: function () {
			search.appendTagsOnSelected("green");
		}
	}));
	tagging.append(new nw.MenuItem({
		label: " Set Blue tag",
		type: "normal",
		icon: "www/img/blue.png",
		click: function () {
			search.appendTagsOnSelected("blue");
		}
	}));
	tagging.append(new nw.MenuItem({
		label: " Set Gold tag",
		type: "normal",
		icon: "www/img/gold.png",
		click: function () {
			search.appendTagsOnSelected("gold");
		}
	}));
	tagging.append(new nw.MenuItem({
		label: " More tags...",
		type: "normal",
		click: function () {
			search.openTagMenu();
		}
	}));
	tagging.append(new nw.MenuItem({ type: "separator" }));
	tagging.append(new nw.MenuItem({
		label: " Clear tags",
		type: "normal",
		click: function () {
			search.clearTagsOnSelected();
		}
	}));
	tagging.append(new nw.MenuItem({ type: "separator" }));
	tagging.append(new nw.MenuItem({
		label: " Create Automation",
		type: "normal",
		click: function () {
			search.openAutomationEditor();
		}
	}));
	tagging.append(new nw.MenuItem({
		label: " Run Automation",
		type: "normal",
		submenu: search.automationMenu()
	}));
	tagging.append(new nw.MenuItem({ type: "separator" }));
	tagging.append(new nw.MenuItem({
		label: " Clear translation",
		type: "normal",
		icon: "www/img/brush_icon.png",
		click: function () {
			var conf = confirm("Do you want to clear translations of the selected items?");
			if (!conf) return;
			search.clearTranslationOnSelected();
		}
	}));
	tagging.append(new nw.MenuItem({
		label: " Delete rows",
		type: "normal",
		icon: "www/img/trash_icon.png",
		click: function () {
			var conf = confirm("Do you want to remove selected rows?\nYou can not undo this action!");
			if (!conf) return;
			search.deleteSelected();
		}
	}));

	this.menu.append(new nw.MenuItem({
		label: " With selection ...",
		icon: "www/img/checkmark.png",
		submenu: tagging
	}));

	var that = this;

	$(document.body).on("contextmenu", ".actionResult", function (ev) {
		ev.preventDefault();
		console.log(ev.originalEvent);
		that.menu.popup(parseInt(ev.originalEvent.x), parseInt(ev.originalEvent.y));
		return false;
	});

	this.searchResultContextMenuIsInitialized = true;
};

search.optionsMenu = function (x, y) {
	console.log("search.optionsMenu");

	var uncheckBlurMenu = () => {
		for (var id in this.menuOpacityItem) {
			if (Boolean(this.menuOpacityItem[id]) == false) continue;
			this.menuOpacityItem[id].checked = false;
		}
	};

	this.menuOptions = new nw.Menu();

	this.menuAlwaysOnTop = new nw.MenuItem({
		label: "Always on top",
		type: "checkbox",
		checked: win.isAlwaysOnTop,
		click: function () {
			var currentState = win.isAlwaysOnTop;
			win.setAlwaysOnTop(!currentState);
			this.checked = !currentState;
			search.setConfig("alwaysOnTop", !currentState);
		}
	});

	this.menuOptions.append(this.menuAlwaysOnTop);

	var opacity = new nw.Menu();

	this.menuOpacityItem = {};

	for (let i = 10; i > 0; i--) {
		void function () {
			var z = i;
			var percent = z * 10;
			var current = search.blurOpacity * 100;
			var isChecked = false;
			if (current == percent) isChecked = true;
			var thisMenu = new nw.MenuItem({
				label: percent + "%",
				type: "checkbox",
				checked: isChecked,
				click: function () {
					uncheckBlurMenu();
					this.checked = true;
					search.blurOpacity = z / 10;
					search.setConfig("blurOpacity", z / 10);
				}
			});
			search.menuOpacityItem[percent] = thisMenu;
			opacity.append(thisMenu);
		}();
	}

	opacity.append(new nw.MenuItem({ type: "separator" }));
	var isChecked = false;
	if (search.blurOpacity == 0.6) isChecked = true;
	this.menuOpacityItem["default"] = new nw.MenuItem({
		label: "Default",
		type: "checkbox",
		checked: isChecked,
		click: function () {
			console.log(this, arguments);
			uncheckBlurMenu();
			this.checked = true;
			search.blurOpacity = 0.6;
			search.setConfig("blurOpacity", 0.6);
		}
	});
	opacity.append(this.menuOpacityItem["default"]);

	this.menuOptions.append(new nw.MenuItem({
		label: "Blur opacity",
		submenu: opacity
	}));

	var that = this;

	if (this.optionsMenuIsInitialized) return false;
	$(".application-menu-button").on("click", function (ev) {
		ev.preventDefault();
		var thisOffset = $(this).offset();
		that.menuOptions.popup(parseInt(thisOffset.left) - 80, 32);
		return false;
	});

	this.optionsMenuIsInitialized = true;
};

search.getBlurOpacity = function () {
	return this.blurOpacity;
};

search.initialize = function () {
	this.appMenu = new nw.Menu();
	this.appMenu.append(new nw.MenuItem({
		label: "Close",
		type: "normal",
		click: function () {}
	}));
	var that = this;
	$(document.body).on("contextmenu", ".findWrapper", function (ev) {
		ev.preventDefault();
		that.appMenu.popup(parseInt(ev.originalEvent.x), parseInt(ev.originalEvent.y));
		return false;
	});

	this.optionsMenu();
	this.loadKeywords();
};

// =======================================================
// EVENTS
// =======================================================

$(document).ready(function () {
	search.searchResultContextMenu();

	$(document).on("keydown", function (e) {
		var keyCode = e.keyCode || e.which;
		switch (keyCode) {
			case 13: //Enter
				if (e.altKey || e.shiftKey) break;
				e.preventDefault();
				// Enter picked an autocomplete suggestion; don't also search.
				if (search.suppressEnter) break;
				console.log("Searching");

				if ($("div[aria-hidden=false]").attr("id") == "find") {
					search.sendCommandFind();
				} else if ($("div[aria-hidden=false]").attr("id") == "replace") {
					search.sendCommandReplace();
				} else {
					search.sendCommandPut();
				}
				break;
		}
	});

	// INITIALIZING TAB
	var type = window.location.hash.substr(1);
	var mode = 0;
	if (type == "replace") mode = 1;
	console.log("tab index  : " + mode);

	$("#tabs").tabs({
		active: mode,
		activate: function (e, thisUi) {
			console.log(thisUi);
			if (thisUi.newPanel.attr("id") == "findPut") {
				$("#findPut .targetSelector").empty();
				ui.generateColSelector({
					skipFirstCol: true
				}).appendTo($("#findPut .targetSelector"));
			}
		}
	});

	if (mode == 0) {
		$("#fieldFind").focus();
	} else {
		$("#fieldReplaceFind").focus();
	}

	$(".toggleFileSelector").on("click", function (e) {
		var $thisTab = $(this).closest(".ui-tabs-panel");

		$(this).toggleClass("opened");
		if ($(this).hasClass("opened")) {
			$thisTab.find(".fileSelector").removeClass("hidden");
		} else {
			$thisTab.find(".fileSelector").addClass("hidden");
		}
	});

	$(".selectAllFile").on("change", function (e) {
		var $thisTab = $(this).closest(".ui-tabs-panel");
		if ($(this).prop("checked")) {
			$thisTab.find(".fileSelector").addClass("hidden");
			$thisTab.find(".toggleFileSelector").removeClass("opened");
			$thisTab.find(".fileSelector .filename").each(function () {
				$(this).prop("disabled", true);
			});
		} else {
			$thisTab.find(".fileSelector").removeClass("hidden");
			$thisTab.find(".toggleFileSelector").addClass("opened");
			$thisTab.find(".fileSelector .filename").each(function () {
				$(this).prop("disabled", false);
			});
		}
	});

	$(".application-bar .application-close-button").on("click", function (e) {
		win.close();
	});

	$("#replaceIsRegexp").on("change", function () {
		let $this = $(this);
		if ($this.prop("checked")) {
			$("#fieldReplaceFind").attr("placeholder", "Type regex with the modifier");
			$("#fieldReplaceReplace").attr("placeholder", "Use $n to replace a group. e.g. $1");
		} else {
			$("#fieldReplaceFind").attr("placeholder", "Find");
			$("#fieldReplaceReplace").attr("placeholder", "Replace");
		}
	});

	search.initialize();
	search.drawFileSelector();
	$(".selectAllFile").trigger("change");
}); // document ready

win.on("blur", function () {
	$("body").css("opacity", search.getBlurOpacity());
});
win.on("focus", function () {
	$("body").css("opacity", "1");
});

win.on("close", function () {
	this.hide();
	window.localStorage.setItem("searchWindowPossition", JSON.stringify({
		x: Math.round(win.x),
		y: Math.round(win.y)
	}));
	if (typeof ui.windows.search !== "undefined") ui.windows.search = undefined;
	this.close(true);
});
