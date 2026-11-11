/**
 * @file ui.js UI handler
 */
/**
 * The reference of the icons
 * @external Icon reference
 */


var win = nw.Window.get();

// Listen to main window's close event
win.on('close', async function() {
	// Prevent re-entry if the user clicks close again while we are still
	// shutting down (e.g. during log compression, which can take a while).
	if (nw.appIsClosing) return;
	nw.appIsClosing = true;

	// confirm
	if (trans.gridIsModified()) {
		var conf = confirm("Do you really want to exit the tool?\nAll unsaved changes will be discarded!");
		if (!conf) {
			nw.appIsClosing = false;
			return false;
		}
	}

	// Determine whether log compression will run, so we can choose between an
	// immediate hide (snappy close) and a visible progress overlay.
	var willCompress = false;
	try {
		if (logger && typeof logger.compressLogs === 'function' && logger.file) {
			require("7zip-bin");
			willCompress = true;
		}
	} catch (e) {}

	// Updates the shutdown overlay's progress bar + status text directly (without
	// spamming the console, which would happen through ui.loadingProgress).
	var setCloseProgress = function (percent, status) {
		var $lo = $("#loadingOverlay");
		if (typeof percent === "number") {
			$lo.find(".loadingBarProgress").css("left", (-100 + percent) + "%");
			$lo.find(".loadingBarOverlay").text(percent + "%");
		}
		if (status) $lo.find(".loadingStatus").text(status);
	};

	// Options save themselves the moment they change, so the DISK file is the
	// source of truth at quit time — not sys.config, which teardown may mutate
	// (the options window close and runtime stop paths were both observed
	// replacing engine option blocks in memory). Forbid further config saves
	// from here on: teardown-time saveConfig calls would only re-serialize
	// that mutated state. The one genuinely exit-time value, the window
	// geometry, is persisted by main.js's window-geometry watcher, which
	// merges just that key into the on-disk config.
	try { sys.__teardown = true; } catch (e) {}

	// Shutdown trace: a handful of lines marking the quit milestones, so a shutdown
	// that stalls or skips a step can be read straight from the session log.
	var qtrace = function (msg) {
		try { console.log("[quit] " + msg); } catch (e) {}
		try { if (window.logger && typeof logger.info === "function") logger.info("[quit] " + msg); } catch (e) {}
	};

	try {
		qtrace("shutdown begins");
		$(window).trigger("beforeClose");

		if (willCompress) {
			// Keep the window visible with a progress overlay while shutting down so
			// the user can see the tool is still working (logs are being compressed,
			// staging cache discarded, etc.) instead of a silent close that leaves the
			// process running hidden in the background. The full-screen overlay covers
			// and blocks interaction with the editor underneath.
			ui.showLoading2();
			$("#loadingOverlay .loadingInfo").hide(); // clean look: no console during shutdown
			ui.holdCloseButton(); // make sure no Close button can dismiss the overlay mid-compression
			setCloseProgress(0, "Cleaning up...");
		} else {
			// No compression step: hide immediately for a snappy close (original behavior).
			this.hide();
		}

		try {
			sys.saveConfig();
		} catch (e) {
			// do nothing
		}
		if (nw.process.versions["nw-flavor"] == "sdk") {
			try { win.closeDevTools(); } catch (e) {}
			await common.wait(200);
		}


		$(document).trigger("close");
		// If the new window is still open then close it.
		// close all popup. Each close is guarded so one failing/dead window
		// reference cannot prevent the main window (and the whole process) from
		// closing, which would leave it hidden-but-alive in the background.
		// Child windows opened via nw.Window.open get their nw handle stashed on
		// the DOM window (__nwHandle): force-closing through it shuts the window
		// down synchronously, instead of entering the child's async close handler
		// (the Options window awaits a timer there) which used to race this
		// shutdown and leave the Options window open after the tool quit.
		for (var id in ui.windows) {
			try {
				var child = ui.windows[id];
				// Give a child window's own flush a chance to run while both windows are
				// still alive: the Options window commits its rendered form values into the
				// engine here, because force-closing below bypasses its close handler.
				try {
					if (child && child.options && typeof child.options.flushOptionForms === "function") {
						child.options.flushOptionForms();
					}
				} catch (e) { /* flushing is best effort; the close must proceed */ }
				var handle = (child && child.__nwHandle) ? child.__nwHandle : child;
				if (handle != null && typeof handle.close === 'function') {
					handle.close(true);
				}
			} catch (e) {
				console.warn("Could not close window '" + id + "':", e);
			}
		}

		// Stop the local runtime before the main window goes away. The status window was
		// already closed synchronously by the beforeClose handlers; this bounded wait makes
		// sure the llama-server kill (which races a model still mid-load) actually completes
		// before the process can tear down, instead of fire-and-forgetting it against the
		// window teardown and leaving an orphan behind.
		try {
			// nw.llmRuntime is realm-proof: window.llmRuntime can be missing when the runtime
			// module was first loaded from another window's context.
			var rtApi = window.llmRuntime || (typeof nw !== "undefined" && nw.llmRuntime) || null;
			if (rtApi && typeof rtApi.stopForQuit === "function") {
				var quitT0 = Date.now();
				await rtApi.stopForQuit(5000);
				qtrace("runtime stopped after " + (Date.now() - quitT0) + " ms");
			}
		} catch (e) { console.warn("Runtime stop failed:", e); }

		// After closing the all popups window, close the main window.
		// discard the session's staging cache (regenerable from .slrproj / game folder)
		try { await common.cleanStagingCache(); } catch (e) {}

		// Flush any pending log lines to disk before compressing.
		try { if (logger && logger.flushLogs) await logger.flushLogs(); } catch (e) {}

		// Compress logs into .7z so they only take significant space while running.
		// While showing progress we keep the window visible until this finishes.
		if (willCompress) {
			setCloseProgress(0, "Compressing logs...");
			try {
				await logger.compressLogs(function (info) {
					if (!info || info.phase === "done") return;
					var overall = (typeof info.overall === "number") ? info.overall : 0;
					var status = "Compressing logs";
					if (info.basesTotal > 1) status += " (" + (info.basesDone + 1) + "/" + info.basesTotal + ")";
					if (info.current) status += ": " + info.current;
					if (info.filesTotal > 1) status += "  [" + (info.filesDone + 1) + "/" + info.filesTotal + "]";
					setCloseProgress(overall, status);
				});
			} catch (e) {}
			setCloseProgress(100, "Done!");
			// Let the final frame paint before we tear the window down.
			await common.wait(120);
		} else {
			try { if (logger && logger.compressLogs) await logger.compressLogs(); } catch (e) {}
		}
	} catch (e) {
		qtrace("ABORTED by error: " + ((e && e.stack) || e));
	} finally {
		// The compression above archived and deleted the log file; seal the
		// logger so this final trace (and anything after) cannot buffer a line
		// whose debounced write would recreate the file as a stub while a
		// lingering child window keeps the process alive.
		try { if (logger) logger.sealed = true; } catch (e) {}
		qtrace("closing main window");
		// Guarantee the main window is closed even if something above threw,
		// otherwise the process would keep running in the background.
		try { this.close(true); } catch (e) { console.warn("Main window close failed:", e); }
	}
});

// prevent windows goes beyond screen
setTimeout(()=>{
	if (win.y < 0) win.y = 0;
	console.log("current Y", win.y);
}, 200)


$.fn.insertAt = function(index, $parent) {
    return this.each(function() {
        if (index === 0) {
            $parent.prepend(this);
        } else {
            $parent.children().eq(index - 1).after(this);
        }
    });
}

/**
 * Handling user interface stuff
 * @namespace
 * @classdesc ui is a static object to handle anything related to user interface
 * ui utility belt can be accessed through `window.ui` or calling `ui` directly
 */
var ui = {
	isLoaded: false,
	autoComplateData:[],
	selectedCell:null,
	dialogs:[],
	windows:{},
	timers:{},
	$elm: $('<div></div>')
}


/**
 * Create a new event with JQuery eventing convenience
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 * @example
 * ui.on('transLoaded', (e, opt)=> {
 * 	// do something
 * })
 */
ui.on = function(evt, fn) {
    this.$elm.on(evt, fn)
}

/**
 * Removes an event
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 * @example
 * ui.off('transLoaded', (e, opt)=> {
 * 	// do something
 * })
 */
ui.off = function(evt, fn) {
    this.$elm.off(evt, fn)
}

/**
 * Run the event once
 * Trigger an event and immediately removes it
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 */
ui.one = function(evt, fn) {
    this.$elm.one(evt, fn)
}

/**
 * Trigger an event
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 */
ui.trigger = function(evt, param) {
    this.$elm.trigger(evt, param)
}

ui.onReady = function (onReadyEvent) {
	if (typeof onReadyEvent !== 'function') return console.log("parameter must be a function");
	this.__onReadyPool = this.__onReadyPool||[];
	
	if (Boolean(this.isInitialized) == false) {
		this.__onReadyPool.push(onReadyEvent)
	} else {
		for (var i=0; i<this.__onReadyPool.length; i++) {
			this.__onReadyPool[i].apply(this, arguments);
		}
		this.__onReadyPool = [];
		
		onReadyEvent.apply(this, arguments);
	}
}

ui.onDOMReady = function(fn) {
    // see if DOM is already available
    if (document.readyState === "complete" || document.readyState === "interactive") {
        // call on next available tick
        setTimeout(fn, 1);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

ui.menus = {}
ui.menus.saveAs = new nw.Menu();
ui.menus.saveAs.append(new nw.MenuItem({
	label: 'SLR Project (.slrproj)',
	type: "normal", 
	click: async function(){
		console.log("Saving as slrproj");
		var savePath = await ui.saveAsSlrproj(trans.currentFile);
		if (!savePath) return;
		trans.exportSlrproj(savePath, {
				onDone: function(result) {
					ui.closeExportDialog();
					if (result) ui.setStatusBar(2, "Saved: "+result);
				}
			});
	}
  }));

ui.centerWindow = function() {
	console.log("centering window");
	var leftMargin = (screen.width - window.outerWidth)/2;
	var topMargin = (screen.height - window.outerHeight)/2;
	win.y = parseInt(topMargin);
	win.x = parseInt(leftMargin);
	console.log(win.y, win.x);
	return [win.x, win.y]
}


ui.isInViewport = function($obj) {
	var elementTop = $obj.offset().top;
	var elementBottom = elementTop +$obj.outerHeight();
	var viewportTop = $(window).scrollTop();
	var viewportBottom = viewportTop + $(window).height();
	return elementBottom > viewportTop && elementTop < viewportBottom;
};

ui.scrollToView = function(row, col, onAfterScroll){
	//console.log("scrolling to : "+row+","+col);
	
	// for performance check only last visible row, since the only possible way is goes to next row;
	var lastVisibleRow = ui.getLastFullyVisibleRow();
	if (row < lastVisibleRow) return false;
	
	
	var center = row-Math.round(trans.grid.countVisibleRows()/2);
	
	// registering event once 
	if (typeof onAfterScroll == 'function') {
		trans.grid.addHookOnce('afterScrollVertically', function() {
			onAfterScroll.call(trans.grid, row, col);	
		});
	}

	
	trans.grid.scrollViewportTo(center, col);
	//trans.grid.selectCell(center, col,center, col);
	return true;
	
	/*
	var firstRendered = trans.grid.rowOffset()+3;
	var renderedCount = trans.grid.countRenderedRows()-3;
	var margin = 4;
	
	
	if (row <= renderedCount-margin) return false;
	
	var center = row-Math.round(renderedCount/2);
	
	if (row >= firstRendered+renderedCount-margin) {
		trans.grid.scrollViewportTo(center, col);
	}
	return true;
	*/
	
}

/**
 * Add 20% to the grid's scroll height
 */
ui.bumpGridScroll = function() {
	var $scrollerElm = $("#table .wtHolder .wtHider").eq(0)
	var curHeight = $scrollerElm.height();
	curHeight = curHeight || 1;
	var bump = curHeight + Math.round((curHeight/100) *20)
	console.log(bump);
	curHeight = $scrollerElm.css("height", bump+"px")
}

ui.saveIndicatorStart = async function() {
	$(".button-save img").addClass("rotating");
}

ui.saveIndicatorEnd = async function() {
	$(".button-save img").removeClass("rotating"); 
}

ui.disableGrid = function(state) {
	if (typeof state == 'undefined') {
		state = !$("#gridDisabler").hasClass("hidden");
	}
	
	
	if (state) {
		$("#gridDisabler").removeClass("hidden");
		var panRight= $(".panel-right");
		var thisHeight 	= panRight.outerHeight();
		var thisWidth 	= panRight.outerWidth();
		var thisTop = panRight.offset().top;
		var thisLeft = panRight.offset().left;
		var disabler = $("#gridDisabler");
		disabler.css("width", thisWidth);
		disabler.css("height", thisHeight);
		disabler.css("top", thisTop);
		disabler.css("left", thisLeft);	
		
		ui.timers.gridDisabler = undefined;
			
		$(window).on("resize.gridDisabler", function() {
			if (ui.timers.gridDisabler) clearTimeout(ui.timers.gridDisabler);
			ui.timers.gridDisabler = setTimeout(function() {
				var panRight= $(".panel-right");
				var thisHeight 	= panRight.outerHeight();
				var thisWidth 	= panRight.outerWidth();
				var thisTop = panRight.offset().top;
				var thisLeft = panRight.offset().left;
				var disabler = $("#gridDisabler");
				disabler.css("width", thisWidth);
				disabler.css("height", thisHeight);
				disabler.css("top", thisTop);
				disabler.css("left", thisLeft);	
				ui.timers.gridDisabler = undefined;
			}, 250);
		});
	} else {
		$("#gridDisabler").addClass("hidden");
		$(window).off("resize.gridDisabler");		
	}
	
}
/**
 * Disable buttons when no project is currently oppened
 */
ui.disableButtons = function() {
	$(".menu-button.button-save").prop("disabled", true)
	$(".menu-button.button-save-as").prop("disabled", true)
	$(".menu-button.button-import").prop("disabled", true)
	$(".menu-button.button-export").prop("disabled", true)
	$(".menu-button.batch-translate").prop("disabled", true)
	$(".menu-button.wrapProject").prop("disabled", true)
	$(".menu-button.glossaryProject").prop("disabled", true)
	$(".menu-button.contextTool").prop("disabled", true)
	$(".menu-button.button-properties").prop("disabled", true)

	$(".menu-button.importHere").prop("disabled", true)
	$(".menu-button.filePropertiesMenu").prop("disabled", true)
	$(".menu-button.addNote").prop("disabled", true)
	$(".menu-button.find").prop("disabled", true)
	$(".menu-button.removeTranslation").prop("disabled", true)

	$(".menu-button .button-save-as").prop("disabled", true);
	$(".menu-button .button-save-as-side").prop("disabled", true);

	$("#table").addClass("hidden");
}

ui.enableButtons = function() {
	$(".menu-button.button-save").prop("disabled", false)
	$(".menu-button.button-save-as").prop("disabled", false)
	$(".menu-button.button-import").prop("disabled", false)
	$(".menu-button.button-export").prop("disabled", false)
	$(".menu-button.batch-translate").prop("disabled", false)
	$(".menu-button.wrapProject").prop("disabled", false)
	$(".menu-button.glossaryProject").prop("disabled", false)
	$(".menu-button.contextTool").prop("disabled", false)
	$(".menu-button.button-properties").prop("disabled", false)

	$(".menu-button.importHere").prop("disabled", false)
	$(".menu-button.filePropertiesMenu").prop("disabled", false)
	$(".menu-button.addNote").prop("disabled", false)
	$(".menu-button.find").prop("disabled", false)
	$(".menu-button.removeTranslation").prop("disabled", false)

	$(".menu-button .button-save-as").prop("disabled", false);
	$(".menu-button .button-save-as-side").prop("disabled", false);

	$("#table").removeClass("hidden");

}

ui.showBusyOverlay = function() {
	ui.appIsBusy = true;
	$("#busyOverlay").removeClass("hidden");
	
	/**
	 * Triggered when busyOverlay opened
	 * @event ui#busyOverlayOpened
	 * @since 4.3.20
	 */
	this.trigger("busyOverlayOpened")
}

ui.hideBusyOverlay = function() {
	ui.appIsBusy = false;
	$("#busyOverlay").addClass("hidden");

	/**
	 * Triggered when busyOverlay closed
	 * @event ui#busyOverlayClosed
	 * @since 4.3.20
	 */
	this.trigger("busyOverlayClosed")
}


ui.getFirstVisibleRow = function() {
	var $header = $("#table .ht_clone_top_left_corner")
	var visibleTop = $header.offset().top + $header.outerHeight();
	var $rows = $(".ht_master .htCore tbody tr");
	for (var i=0; i<$rows.length; i++) {
		var rowsBottom = $rows.eq(i).offset().top+$rows.eq(i).outerHeight();
		if (rowsBottom >= visibleTop) {
			var coords = trans.grid.getCoords($rows.eq(i).find("td").eq(0)[0]);
			return coords.row;
		}
	}
}

ui.getFirstFullyVisibleRow = function() {
	var $header = $("#table .ht_clone_top_left_corner")
	var visibleTop = $header.offset().top + $header.outerHeight();
	var $rows = $(".ht_master .htCore tbody tr");
	for (var i=0; i<$rows.length; i++) {
		var rowsTop = $rows.eq(i).offset().top;
		if (rowsTop >= visibleTop) {
			var coords = trans.grid.getCoords($rows.eq(i).find("td").eq(0)[0]);
			return coords.row;
		}
	}
}

ui.getLastFullyVisibleRow = function() {
	var $table = $("#table")
	var visibleBottom = $table.offset().top + $table.height();
	var $rows = $(".ht_master .htCore tbody tr");
	for (var i=$rows.length-1; i>=0; i--) {
		var rowsBottom = $rows.eq(i).offset().top+$rows.eq(i).outerHeight();
		if (visibleBottom >= rowsBottom) {
			var coords = trans.grid.getCoords($rows.eq(i).find("td").eq(0)[0]);
			return coords.row;
		}
	}
}

ui.getLastVisibleRow = function() {
	var $table = $("#table")
	var visibleBottom = $table.offset().top + $table.height();
	var $rows = $(".ht_master .htCore tbody tr");
	for (var i=$rows.length-1; i>=0; i--) {
		var rowsBottom = $rows.eq(i).offset().top;
		if (visibleBottom >= rowsBottom) {
			var coords = trans.grid.getCoords($rows.eq(i).find("td").eq(0)[0]);
			return coords.row;
		}
	}
}

ui.isRowVisible = function(row) {
	var first = ui.getFirstVisibleRow();
	var last = ui.getLastVisibleRow();
	
	return (row>=first && row<=last);
	
}

ui.generateColSelector = function(options) {
	options = options||{};
	options.data = options.data||window.trans;
	options.onNoSelection = options.onNoSelection|| function() {};
	options.onHasSelection = options.onHasSelection|| function() {};
	options.skipFirstCol = options.skipFirstCol||false;
	
	if (typeof options.data.colHeaders == 'undefined') return $("<select></select>");
	var thisColHeader = options.data.colHeaders;
	console.log(thisColHeader);
	var $select = $("<select></select>");
	for (var i=0; i<thisColHeader.length; i++) {
		if (i==0 && options.skipFirstCol) continue;
		$select.append("<option value='"+i+"'>"+thisColHeader[i]+"</option>");
	}

	return $select;
}

ui.generateColMultiSelector = function(options) {
	options = options||{};
	options.data = options.data||window.trans;
	options.onNoSelection 	= options.onNoSelection|| function() {};
	options.onHasSelection 	= options.onHasSelection|| function() {};
	options.skipFirstCol 	= options.skipFirstCol||false;
	
	if (typeof options.data.colHeaders == 'undefined') return $("<select></select>");
	var thisColHeader = options.data.colHeaders;
	console.log(thisColHeader);
	var $select = $("<select multiple='multiple' class='multiple'></select>");
	for (var i=0; i<thisColHeader.length; i++) {
		if (i==0 && options.skipFirstCol) continue;
		$select.append("<option value='"+i+"'>"+thisColHeader[i]+"</option>");
	}

	return $select;
}



ui.drawFileSelector = function(data, $target, options) {
	console.log("entering : ui.drawFileSelector");
	data = data || trans.project || {};
	options = options||{};
	options.onNoSelection = options.onNoSelection|| function() {};
	options.onHasSelection = options.onHasSelection|| function() {};
	options.filePath = options.filePath || "";
	options.defaultSelection = options.defaultSelection || [];
	options.defaultSelectionMode = options.defaultSelectionMode||"";
	options.insensitiveDefault = options.insensitiveDefault || false;
	
	if (Array.isArray(options.defaultSelection) == false) options.defaultSelection = [options.defaultSelection];
	
	var selectorTitle = options.filePath;
	console.log($target);
	if (typeof data.project.files == 'undefined') return false;
	if ($target.length == 0) return false;
	$target.addClass("fileSelector");
	$target.addClass("rendered");
	$target.empty();
	$target.append("<div class='fileSelectorHeader icon-doc-inv'>"+selectorTitle+"</div>\
					<div class='fileSelectorBody'></div>\
					<div class='fileSelectorOptions fileSelectorFooter' ><form>\
						<button class='fileSelectorAction actionSelectAll'>"+"Select all"+"</button>\
						<button class='fileSelectorAction actionSelectNone'>"+"Select none"+"</button>\
						<button class='fileSelectorAction actionSelectInvert'>"+"Invert"+"</button>\
						<button class='fileSelectorAction actionSelectMatch'>"+"Match destination selection"+"</button>\
						<span class='info icon-info-circled'>"+"use mouse drag to do bulk selection"+"</span>\
					</form></div>");
	
	//var $selectAll = $target.find(".fileSelectorOptions .selectAll");
	$target.find("form").on("submit", function(e) {
		e.preventDefault();
	})
	$target.find(".actionSelectAll").on("click", function() {
		$(this).closest(".fileSelector").find(".fileSelectorBody .filename").prop("checked", true);
	});
	$target.find(".actionSelectNone").on("click", function() {
		$(this).closest(".fileSelector").find(".fileSelectorBody .filename").prop("checked", false);
	});
	$target.find(".actionSelectInvert").on("click", function() {
		$(this).closest(".fileSelector").find(".fileSelectorBody .filename").each(function() {
			$(this).prop("checked", !$(this).prop("checked"));
		});
	});
	$target.find(".actionSelectMatch").on("click", function() {
		$(this).closest(".fileSelector").find(".fileSelectorBody .filename").prop("checked", false);
		var targetSelection = options.defaultSelection || [];

		if (targetSelection.length < 0) {
			targetSelection = trans.getCheckedFiles() || [];
		}
		
		console.log("targetSelection", targetSelection);
		
		var $selectorBody = $(this).closest(".fileSelector").find(".fileSelectorBody");
		for (var i=0; i<targetSelection.length; i++  ) {
			$selectorBody.find("input[type=checkbox][value='"+CSS.escape(targetSelection[i])+"']").prop("checked", true);
		}
	});
	
	var getFilename = (path)=>{
		if (!path) return ""
		return nwPath.parse(path.split('\\').pop().split('/').pop()).name
	}

	var insDefault = [];
	if (options.insensitiveDefault) {
		for (var i in options.defaultSelection) {
			insDefault.push(getFilename(options.defaultSelection[i]).toLowerCase());
		}
	}
	console.log("insDefault:", insDefault);
	var content = $target.find(".fileSelectorBody");
	for (let file in data.project.files) {
		let checkbox = $("<input type='checkbox' class='filename' value='"+file+"' />");
		if (options.defaultSelection.includes(file)) {
			checkbox.prop("checked", true);
		} else {
			if (insDefault.includes(getFilename(file).toLowerCase())) checkbox.prop("checked", true);
		}
		checkbox.on("change", function() {
			var selected = $(this).closest(".fileSelectorBody").find(".filename:checked");
			if (selected.length < 1) {
				options.onNoSelection.call($(this));
			} else {
				options.onHasSelection.call($(this));
			}
		});
		let template = $("<label class='fileSelectorLabel' title='"+file+"'><span>"+data.project.files[file].filename+"</span><label>");
		template.prepend(checkbox);
		content.append(template);
	}
	
	if (options.defaultSelectionMode == 'none') {
		$target.find(".actionSelectNone").trigger("click");
	} else if (options.defaultSelectionMode == 'all'){
		$target.find(".actionSelectAll").trigger("click");
	} else if (options.defaultSelectionMode == 'match'){
		$target.find(".actionSelectMatch").trigger("click");
	}
	//$selectAll.trigger("change");
	
	//console.log("target : ", $target, $target[0]);
	var DragSelect = DragSelect||require("dragselect");
	ui.ds = new DragSelect({
		selectables: $target.find(".fileSelectorBody")[0].getElementsByClassName('fileSelectorLabel'),
		autoScrollSpeed: 15,
		area :$target.find(".fileSelectorBody")[0],
		callback : function(elm) {
			//console.log("Selected element : ", $(elm));
			var $elm = $(elm);
			// ignore selection if selecting less than 2 row
			// DragSelect adds its hover class to rows touched by the selection rect on
			// mouse-down; a click that ends without a drag never clears it, so always
			// strip it once the drag is over.
			$(this.selectables).removeClass("ds-hover");
			if ($elm.length <= 1) return false;
			$elm.each(function() {
				var $input = $(this).find("input");
				console.log("input : ", $input);
				$(this).removeClass("ds-hover");
				$input.prop("checked", true)
				$input.trigger("change");
				ui.ds.clearSelection();
			})
		}
	});		
	return $target;
}

ui.openTrans = async function() {
	// open supported project file
	var opts = {
		types: [
			{
				description: 'SLR Project File',
				accept: {'application/slrproj': ['.slrproj']},
			},
		]
	}

	try {
		return await window.showOpenFilePicker(opts);
	} catch (e) {
		return;
	}
}

/**
 * Open import translator dialog window
 * @param {String} filePath - Path to the file
 * @param {Object} [options] - options
 * 
 */
// Legacy/unused: imports translations from old .trans reference files. Retained for reference; hidden from the UI (no active entry points).
ui.openImportTrans = function(filePath, options) {
	/*
	options {
		mode : 0/1 => import translation or object
	}
	example : {mode:1, defaultSelection:["Common Reference"]}
	*/
	options = options || {};
	options.mode = options.mode || 0;
	options.defaultSelectionMode = options.defaultSelectionMode || "";
	options.defaultSelection = options.defaultSelection || [];
	if (options.defaultSelection.length == 0) options.defaultSelection = trans.getCheckedFiles();
	
	console.log("Opening : "+filePath);
	var doOpenImportTrans = function(filePath, data) {
		console.log(filePath);
		if ($("#dialogImportTrans").hasClass("initialized") == false) {
			$("#dialogImportTrans").dialog({
				autoOpen: false,
				modal:true,
				minWidth:480,
				minHeight:320,
				width:Math.round($(window).width()/100*80),
				height:Math.round($(window).height()/100*80),				
				show: {
					effect: "fade",
					duration: 200
				},
				hide: {
					effect: "fade",
					duration: 200
				},
				buttons: [
					{
						text: "Cancel",
						//icon: "ui-icon-heart",
						click: function() {
							$(this).dialog( "close" );
						}
					},
					{
						text: "Import",
						//icon: "ui-icon-heart",
						click: function() {
							var mode =  $("#dialogImportTrans input[name='importMode']:checked"). val();
							var options = $("#dialogImportTrans").data("options");
							var translateContext 	= $(this).find(".contextTranslation").prop("checked");

							if (mode == 0) {
								var $elm=$(this).find(".selectorBody[data-if='0']");
								// import translation
								var selectedCell = [];
								//if ($("#dialogImportTrans .fileSelectorHeader .selectAll").prop("checked") == false) {
									let checkedElm = $("#dialogImportTrans .fileSelectorBody .filename:checked");
									for (var x=0; x<checkedElm.length; x++) {
										selectedCell.push(checkedElm.eq(x).attr("value"));
									}
								//}
								var targetFiles = options.defaultSelection||[];
								//if ($("#dialogImportTrans .destinationFile .targetAllFiles").prop("checked") == false) {
								if (targetFiles.length == 0) {
									targetFiles = trans.getCheckedFiles();
								}
								
								var fileData = $("#dialogImportTrans").data("data");
								trans.importTranslation(fileData,
								{
									targetColumn	: $elm.find(".selectRow select").val(),
									overwrite		: $elm.find(".overwriteTarget").prop("checked"),
									files 			: selectedCell,
									destination 	: targetFiles,
									compareMode		: $elm.find(".compareMode").val(),
									translateContext: translateContext,
									destinationMode	: $(this).find(".destinationMode").val(),
									caseInsensitive	: $elm.find(".caseInsensitive").prop("checked"),
								});
							} else if (mode == 1)  {
								// import object
								console.log("generating target pair");
								var targetPair = {};
								let checkedElm = $("#dialogImportTrans .fileSelectorBody .filename:checked");
								for (let x=0; x<checkedElm.length; x++) {
									targetPair[checkedElm.eq(x).attr("value")] = true;
								}
								var filePath = $("#dialogImportTrans").data("filePath");
								console.log("target pair : ", targetPair);
								console.log("file path is : ", filePath);
								
								//return true;
								trans.importFromFile(filePath, {
									targetPair: targetPair,
									mergeData : $("#dialogImportTrans .mergeData").prop("checked")
								});
							} else if (mode == 2) {
								let $elm=$(this).find(".selectorBody[data-if='2']");
								// import translation
								let selectedCell = [];
								var checkedElm = $("#dialogImportTrans .fileSelectorBody .filename:checked");
								for (let x=0; x<checkedElm.length; x++) {
									selectedCell.push(checkedElm.eq(x).attr("value"));
								}

								let targetFiles = options.defaultSelection||[];
								if (targetFiles.length == 0) targetFiles = trans.getCheckedFiles();
								
								let fileData = $("#dialogImportTrans").data("data");
								trans.importTranslation(fileData,
								{
									targetColumn	: $elm.find(".selectRow select").val(),
									overwrite		: $elm.find(".overwriteTarget").prop("checked"),
									files 			: selectedCell,
									destination 	: targetFiles,
									compareMode		: parseInt($elm.find(".compareMode").val()),
									translateContext: translateContext,
									caseInsensitive	: $elm.find(".caseInsensitive").prop("checked"),
								});
							}
							
							// clearing data
							$("#dialogImportTrans").data("data", {});
							$(this).dialog( "close" );
							
						}
					}
				]
			});	
			$("#dialogImportTrans").addClass("initialized");
			
			$("#dialogImportTrans .ImportTransImportMode").on("input", function() {
				console.log("change tab", $(this));
				if ($(this).prop("checked") == false) return false;
				var $tabObj = $(this).closest(".tabWrapper")
				var $targetObj = $tabObj.find(".selectorBody[data-if='"+CSS.escape($(this).val())+"']");
				if ($targetObj.length == 0) return false;
				$tabObj.find(".selectorBody").addClass("hidden");
				$targetObj.removeClass("hidden");
			});

			$("#dialogImportTrans .destinationMode").on("change", function() {
				var $this = $(this)
				var val = $(this).val();
				$this.closest(".tabWrapper").find(`[data-for]`).addClass("hidden");
				$this.closest(".tabWrapper").find(`[data-for="${val}"]`).removeClass("hidden");
			})
		}
		
		
		if (options.defaultSelection.length > 1) {
			$("#dialogImportTrans").find(".destinationList").html(options.defaultSelection.length+" objects selected")
		} else {
			$("#dialogImportTrans").find(".destinationList").html(options.defaultSelection)
		}
		
		$("#dialogImportTrans").data("filePath", filePath);
		$("#dialogImportTrans").data("options", options);
		$("#dialogImportTrans").data("data", data);
		$("#dialogImportTrans").dialog("open");
		//$("#dialogImportTrans").find(".selectorBody[value='"+options.mode+"']").prop("checked", true).trigger("input");
		$("#dialogImportTrans").find(".ImportTransImportMode[value='"+CSS.escape(options.mode)+"']").prop("checked", true).trigger("input");
		return $("#dialogImportTrans");	
	}
	
	trans.loadJSON(filePath, {
		onSuccess: function(data) {
			data = trans.validateTransData(data)
			
			console.log("Loaded data : ");
			console.log(data);
			
			ui.drawFileSelector(data, $("#dialogImportTrans .fileSelectorWrapper"), {
				onNoSelection:function() {
					$(".ui-dialog[aria-describedby=dialogImportTrans] .ui-dialog-buttonpane button").eq(1).button("disable");					
				},
				onHasSelection:function() {
					$(".ui-dialog[aria-describedby=dialogImportTrans] .ui-dialog-buttonpane button").eq(1).button("enable");
				},
				filePath:filePath,
				defaultSelection: options.defaultSelection,
				defaultSelectionMode: options.defaultSelectionMode,
				insensitiveDefault:true
			});
			$("#dialogImportTrans .selectRow").empty();
			ui.generateColSelector({
				skipFirstCol:true
			}).appendTo($("#dialogImportTrans .selectRow"));
			
			if ($("#dialogImport").hasClass("initialized")) {
				if ($("#dialogImport").dialog( "isOpen" )) {
					$("#dialogImport").off( "dialogclose");
					$("#dialogImport").on( "dialogclose", function( event, ui ) {
						console.log("closing import dialog");
						$("#dialogImport").off( "dialogclose");
						doOpenImportTrans(filePath, data);
					});
					
					$("#dialogImport").dialog( "close" );
				} else {
					doOpenImportTrans(filePath, data);
				}
			} else {
				doOpenImportTrans(filePath, data);
			}
		}
	});
}

ui.openImportDialog = function() {
	ui.importDialogOnClose = function() {};
	if ($("#dialogImport").hasClass("initialized") == false) {
		$("#dialogImport").dialog({
			autoOpen: false,
			modal:true,
			minWidth:480,
			minHeight:320,
			maxWidth:640,
			maxHeight:420,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			}
		});	
		$("#dialogImport").addClass("initialized");
	}
	
	$("#dialogImport").dialog("open");
	return $("#dialogImport");	
}

ui.openImportSlrprojDialog = function() {
	ui.importDialogOnClose = function() {};
	if ($("#dialogImportSlrproj").hasClass("initialized") == false) {
		$("#dialogImportSlrproj .importSlrprojPathType").on("click", function() {
			$(this).closest("label").find(".importSlrproj").trigger("click");
		});

		$("#dialogImportSlrproj .importSlrproj").on("input", function() {
			var $this = $(this);
			$this.closest("label").find(".selectedFileRemark").html($this.val());
		});

		$("#dialogImportSlrproj").dialog({
			autoOpen: false,
			modal:true,
			minWidth:560,
			minHeight:420,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},buttons: [
					{
						text: "Cancel",
						click: function() {
							$(this).dialog( "close" );
						}
					},
					{
						text: "Import",
						click: function() {
							var $input = $("#dialogImportSlrproj .importSlrprojFile");
							var slrprojPath = $input.val();
							if (!slrprojPath) return alert("Please select a .slrproj file");
							if (slrprojPath.replace(/\\/g,'/').toLowerCase() == (trans.currentFile||'').replace(/\\/g,'/').toLowerCase()) {
								return alert("The selected .slrproj is the currently open project. Choose a different file to import from.");
							}

							var options = {
								overwrite		: $("#dialogImportSlrproj .overwriteTarget").prop("checked"),
								caseInsensitive	: $("#dialogImportSlrproj .caseInsensitive").prop("checked")
							};
							$(this).dialog( "close" );
							setTimeout(function() {
								trans.importSlrprojTranslations(slrprojPath, options);
							}, 300);
						}
					}
				]
			});
		$("#dialogImportSlrproj").addClass("initialized");
	}

	// reset selection each time the dialog opens
	$("#dialogImportSlrproj .importSlrprojFile").val("");
	$("#dialogImportSlrproj .selectedFileRemark").html("");

	$("#dialogImportSlrproj").dialog("open");
	return $("#dialogImportSlrproj");
}



ui.openExportDialog = function(options) {
	options = options || {};
	if ($("#dialogExport").hasClass("initialized") == false) {
		$("#dialogExport").dialog({
			autoOpen: false,
			modal:true,
			minWidth:480,
			minHeight:320,
			maxWidth:640,
			maxHeight:420,			
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			}
		});	
		$("#dialogExport").addClass("initialized");
	}
	$("#dialogExport").data("options", options);
	$("#dialogExport").dialog("open");
	return $("#dialogExport");
}

ui.closeExportDialog = function() {
	if ($("#dialogExport").hasClass("initialized")) {
		$("#dialogExport").dialog("close");
	}
}

ui.openRevertToOriginalDialog = async function(defaultPath = "", options) {
	try {
		defaultPath = defaultPath || trans.project.devPath
	} catch (e) {
		defaultPath = "";
	}
	return new Promise((resolve, reject)=> {
		var $popup = $("#ui_revertToOrigin");
		if ($popup.length == 0) {
			var dvField = new DVField();
			$popup = $("<div id='ui_revertToOrigin'></div>");
			var $content = ($(`
			<div>
				<h2>${`Revert to origin data`}</h2>
				<div>
					${`Select target directory.`}<br />
					<span class="red">${`The existing files will be overwritten!`}</span>
				</div>
				<label>
					<input type="dvSelectPath" nwdirectory class="fullWidth targetPath" value="${defaultPath}" />
				</label>
			</div>`));

			console.log("rendering ", $popup);
			dvField.renderSelectPath($content.find("[type=dvSelectPath]"));
	
			$popup.empty();
			$popup.append($content);
		}
		$popup.dialog({
			title: "Revert to origin data",
			autoOpen: false,
			modal:true,
			width:640,
			height:240,
			minWidth:640,
			minHeight:240,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			close:function( event, ui ) {
				var value = $("#ui_revertToOrigin .targetPath").val();
				$("#ui_revertToOrigin").remove();
				resolve(value || "");
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$("#ui_revertToOrigin .targetPath").val("");
						$(this).dialog( "close" );
					}
				},
				{
					text: "Process",
					click: async function() {
						var $this = $(this)
						var to = $this.find(".targetPath").val()
						if (!to) return alert("Path to the directory can not be empty!");
						if (await common.isDirectory(to) == false) return alert('Invalid directory:'+to);
						$(this).dialog("close");
					}
				}
	
			]
		});	
		$popup.find("#ui_revertToOrigin .defaultPath").val(defaultPath);
		$popup.dialog("open");
	})
	
}


ui.dialogProjectIsExist = function(existedData, options) {
	existedData = existedData||[];
	console.log(arguments);
	options = options||{};

	
	var thisTitle = existedData[0]['title'];
	$("#dialogProjectIsExist").find(".dialogGameTitle").html(thisTitle);
	
	$("#dialogProjectIsExist .existedCache").empty();
	
	for (var i=0; i<existedData.length; i++) {
		var template   = $("<li class='cacheItem'><ul></ul><div class='projectIsExistAction'></div></li>");
		var openButton = $("<button class='openButton'>Open this</button>").on("click", function(e) {
			var that = $(this);
			$("#dialogProjectIsExist").dialog("close");
			trans.procedureCreateProject(options.gameFolder, {
				force:"",
				projectInfo:that.closest(".cacheItem").data("data")
			});
		});
		var openButton2 = $("<button class='openButton'>"+"Rebuild translation table from this cache"+"</button>").on("click", function(e) {
			var that = $(this);
			$("#dialogProjectIsExist").dialog("close");
			trans.procedureCreateProject(options.gameFolder, {
				force:"true",
				projectInfo:that.closest(".cacheItem").data("data")
			});
		});
		template.find(".projectIsExistAction").append(openButton);
		template.find(".projectIsExistAction").append(openButton2);
		template.data("data", existedData[i]);
		
		if ( existedData[i]['title'] ==  existedData[i]['Title']) delete(existedData[i]['Title']);
			
		for (var part in existedData[i]) {
			let $locTemplate= $("<li><label title='"+part+"'>"+part+"</label></span>"+existedData[i][part]+"</span></li>");
			template.find("ul").append($locTemplate);
		}
		$("#dialogProjectIsExist .existedCache").append(template);
	}

	
	if ($("#dialogProjectIsExist").hasClass("initialized") == false) {
		$("#dialogProjectIsExist").dialog({
			autoOpen: false,
			modal:true,
			width:Math.round($(window).width()/100*80),
			height:Math.round($(window).height()/100*80),
			minWidth:600,
			minHeight:420,

			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Create new project",
					icon: "ui-icon-plus",
					click: function() {
						$(this).dialog( "close" );
						console.log("begin creating new project");
						trans.procedureCreateProject(options.gameFolder, {
							force:true
						});
						
					}
				},
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}
			]
		});	
		$("#dialogProjectIsExist").addClass("initialized");
	}
	
	$("#dialogProjectIsExist").dialog("open");
	return ($("#dialogProjectIsExist"));
}



// ==============================================================
// LOADING BAR
// ==============================================================

// Table Corner
ui.tableCornerShowLoading = function() {
	ui._cache = ui._cache || {};
	if (typeof ui._cache.$tppLoader == 'undefined') {
		ui._cache.$tppLoader = $('<img src="img/tpp-loading-inv.svg" class="tableCornerLoading tppLoader" style="height:16px; max-height:16px" alt="">')
	}
	$(".colHeader.cornerHeader").html(ui._cache.$tppLoader);
}
ui.tableCornerHideLoading = function() {
	$(".colHeader.cornerHeader").html(" ");
}

ui.isLoadingOverlayVisible = function() {
	return $("#loadingOverlay").is(":visible");
}

ui.showLoading = function(options) {
	/*
	options.buttons = [{
		text: "text to display",
		onClick : function
	}]
	*/
	options = options||{};
	options.buttons = options.buttons||[];

	// Reset any leftover close-button holds from a previous loading session
	ui._closeButtonHolds = 0;
	ui._closeButtonWanted = false;

	$("#applicationBar .appActionsLeft").hide();
	
	
	// autofix direct options.buttons object
	if (Array.isArray(options.buttons) == false) {
		if (typeof options.buttons.text !== "undefined") options.buttons = [options.buttons];
	}
	ui.consoleIsShown = true;
	$("#loadingOverlay .console").empty();
	$("#loadingOverlay .loadingBarProgress").empty();
	//$("#loadingOverlay .console").addClass("stickToBottom");
	$("#loadingOverlay .loadingBarProgress").removeClass("stopped");
	$("#loadingOverlay .loadingBarProgress").removeClass("error");
	
	$(".loadingBarButtons").empty();
	for (var i=0; i<options.buttons.length; i++) {
		var thisButton = $("<a href='#'>"+options.buttons[i].text+"</a>");
		if (typeof options.buttons[i].onClick == 'function') {
			thisButton.data("onClick", options.buttons[i].onClick)
			
			thisButton.on("click", function(e) {
				// The button element is passed as the first argument so handlers can
				// relabel themselves (e.g. the batch translator's Pause/Resume toggle).
				$(this).data("onClick").call(this, this);
			});
		}
		
		$(".loadingBarButtons").append(thisButton);
	}
	
	
	if ($("#loadingOverlay").hasClass("initialized") == false) {
		$("#loadingOverlay").addClass("initialized");
		ui.loadingInit();
	}
	
	ui.appBarTheme("dark");
	$("#loadingOverlay").removeClass("hidden");
	$(document).trigger("showLoading");

	ui.log("Log started!");
	ui._logTimeStart = Date.now();
	if (nw.process.versions["nw-flavor"] == "sdk") ui.log("You can view the more detailed information in the console log (F12)");
	

	return $("#loadingOverlay");
}

ui.showLoading2 = function(options) {
	/*
	options.buttons = [{
		text: "text to display",
		onClick : function
	}]
	*/
	options = options||{};
	options.buttons = options.buttons||[];
	
	$("#applicationBar .appActionsLeft").hide();
	
	
	// autofix direct options.buttons object
	if (Array.isArray(options.buttons) == false) {
		if (typeof options.buttons.text !== "undefined") options.buttons = [options.buttons];
	}
	ui.consoleIsShown = true;
	$("#loadingOverlay .console").empty();
	$("#loadingOverlay .loadingBarProgress").empty();
	//$("#loadingOverlay .console").addClass("stickToBottom");
	$("#loadingOverlay .loadingBarProgress").removeClass("stopped");
	$("#loadingOverlay .loadingBarProgress").removeClass("error");
	
	$(".loadingBarButtons").empty();
	for (var i=0; i<options.buttons.length; i++) {
		var thisButton = $("<a href='#'>"+options.buttons[i].text+"</a>");
		if (typeof options.buttons[i].onClick == 'function') {
			thisButton.data("onClick", options.buttons[i].onClick)
			
			thisButton.on("click", function(e) {
				// The button element is passed as the first argument so handlers can
				// relabel themselves (e.g. the batch translator's Pause/Resume toggle).
				$(this).data("onClick").call(this, this);
			});
		}
		
		$(".loadingBarButtons").append(thisButton);
	}
	
	
	if ($("#loadingOverlay").hasClass("initialized") == false) {
		$("#loadingOverlay").addClass("initialized");
		ui.loadingInit();
	}
	
	ui.appBarTheme("dark");
	$("#loadingOverlay").removeClass("hidden");
	$(document).trigger("showLoading");

	//ui.log("Log started!");
	ui._logTimeStart = Date.now();
	//if (nw.process.versions["nw-flavor"] == "sdk") ui.log(t("You can view the more detailed information on console log (F12)"));
	

	return $("#loadingOverlay");
}

ui.hideLoading = function(destroy) {
	ui.consoleIsShown = false;
	destroy = destroy||false;
	$("#loadingOverlay .loadingStatus").text("");
	
	if (destroy) {
		$("#loadingOverlay .console").empty();
	}
	$("#loadingOverlay").addClass("hidden");
	ui.appBarTheme("");
	$("#applicationBar .appActionsLeft").show();
	
	//$(document).trigger("hideLoading");
	/**
	 * Triggered when loading console closed
	 * @event ui#loadingScreenIsClosed
	 * @since 4.3.20
	 */
	ui.trigger("loadingConsoleClosed")

	return $("#loadingOverlay");
}

ui.loadingClearButton = function() {
	$(".loadingBarButtons").empty();
}

ui._closeButtonHolds = 0;
ui._closeButtonWanted = false;

ui.holdCloseButton = function() {
	ui._closeButtonHolds++;
}

ui.releaseCloseButton = function() {
	if (ui._closeButtonHolds > 0) ui._closeButtonHolds--;
	if (ui._closeButtonHolds === 0 && ui._closeButtonWanted) {
		ui._closeButtonWanted = false;
		ui.showCloseButton();
	}
}

ui.showCloseButton = function(options) {
	options=options||{};

	if (ui._closeButtonHolds > 0) {
		ui._closeButtonWanted = true;
		return;
	}

	var $loadingBarBtn = $(".loadingBarButtons");
	if ($loadingBarBtn.find(".closeButton").length > 0) return;

	var thisButton = $("<a class='closeButton icon-cancel-1' href='#'>"+"Close"+"</a>");
	thisButton.on("click", function(e) {
		ui.hideLoading.call(this, true);
		ui.loadingClearButton();
	});

	$loadingBarBtn.append(thisButton);
}

ui.showOpenCacheButton = function(target, options) {
	options=options||{};
	if (typeof target == 'undefined') return false;
	$(".loadingBarButtons").find(".openCache").remove();
	var thisButton = $("<a href='#' class='openCache icon-folder-open'>Open Cache</a>");
	thisButton.on("click", function(e) {
		//var thisTmpPath = str_ireplace("\\", "\\\\", target);
		//console.log("running command : \r\n"+'explorer "'+thisTmpPath+'"');
		require('child_process').exec((common.IS_WIN ? 'explorer "' : 'xdg-open "')+target+'"' , function (err, stdout, stderr) { console.log("Explorer opened") });
	});
	
	$(".loadingBarButtons").append(thisButton);		
}

ui.LoadingAddButton = function(text, onClick, options) {
	options=options||{};
	options.class=options.class||"";
	
	if (typeof text == 'undefined') return false
	if (typeof onClick !== 'function') onClick = function(){};
	text = text||"";
	options.a = options.a||"#";
	
	
	var thisButton = $("<a class='"+options.class+"' href='"+options.a+"'>"+text+"</a>");
	thisButton.on("click", function(e) {
		onClick.call(this);
	});
	
	$(".loadingBarButtons").append(thisButton);	
	return thisButton;
}


ui.stickToBottom = function($elm) {
	if ($elm.length == 0) return $elm;
	console.log($elm[0].scrollTop+"+"+$elm.height()+" >= "+$elm[0].scrollHeight);
	if (($elm[0].scrollTop+$elm.height() >= $elm[0].scrollHeight)) {
		$elm[0].scrollTop=$elm[0].scrollHeight;
	}
	return $elm;
}

ui.maxConsoleNodes = 1500;
ui.trimConsole = function() {
	var box = document.querySelector("#loadingOverlay .console");
	if (!box) return;
	var nodes = box.childNodes;
	var max = ui.maxConsoleNodes;
	while (nodes.length > max) {
		box.removeChild(nodes[0]);
	}
};

ui.loadingProgress = async function(percent, status, options) {
	/*
	options.mode = consoleOutput -> no pre wrapper
	*/
	var $loading 		= $("#loadingOverlay");
	options 			= options||{};
	options.consoleOnly = options.consoleOnly||false;
	options.mode 		= options.mode||"";
	options.classStr 	= options.classStr||"";
	if (typeof percent == 'string') {
		//$loading.find(".loadingBarProgress").css("width", 100+"%");
		$loading.find(".loadingBarProgress").css("left", "0%");
		$loading.find(".loadingBarOverlay").text(percent);
	} else if (typeof percent !== 'undefined') {
		percent = percent||0;
		percent = Math.round(percent);
		//$loading.find(".loadingBarProgress").css("width", percent+"%");
		$loading.find(".loadingBarProgress").css("left", (-100+percent)+"%");
		$loading.find(".loadingBarOverlay").text(percent+"%");
	} 
	
	var classStr = "";
	if (options.classStr) {
		classStr = ' class="'+options.classStr+'"';
	}
	
	
	if (typeof status !== "undefined") {
		if (options.consoleOnly == false) {
			$loading.find(".loadingStatus").text(status);
		}
		var console = $("#loadingOverlay .console");
		
		if (options.mode == "consoleOutput") {
			console.append("<span"+classStr+">"+status+"</span>");
		} else {
			console.append("<pre"+classStr+">"+status+"</pre>");
		}
		ui.trimConsole();
		
		/*
		if (console.hasClass("stickToBottom")) {
			console[0].scrollTop=console[0].scrollHeight;
		}	
		*/	
		return status;
	}
}

ui.log = async function(message) {
	const maxWaitTime = 250; // half second for node change is already too slow
	var $console = $("#loadingOverlay .console");
	if (!$console.is(":visible")) return console.log(message);
	var texts = [];
	for (var i=0; i<arguments.length; i++) {
		if (typeof arguments[i] !== "string") {
			texts.push(JSON.stringify(arguments[i], undefined, 2));
		} else {
			texts.push(arguments[i]);
		}
	}

	if (ui.logGetConfig().type) {
		$console.append(`<pre data-type="${ui.logGetConfig().type}">${texts.join("\n   ")}</pre>`);
	} else {
		$console.append("<pre>"+texts.join("\n   ")+"</pre>");
	}
	ui.trimConsole();

	console.log.apply(this, arguments);
	var resolver;
	var promise = new Promise((resolve, reject) => {
		resolver = resolve;
		ui.one("logIsAdded", async ()=>{
			resolve();
		});
	})

	window.setTimeout(()=>{
		resolver();
	}, maxWaitTime)
	return promise;
}

ui.logSetConfig = function(config = {}) {
	this.logConfig = config;
}

ui.logGetConfig = function() {
	return this.logConfig || {};
}

ui.logError = async function() {
	this.logSetConfig({type:"error"});
	await this.log.apply(this, Array.from(arguments));
	this.logSetConfig({type:undefined});
	return;
}

ui.loadingInit = function() {
	if (this.loadingObserverIsInitialized) return;

	// Select the node that will be observed for mutations
	const targetNode = $("#loadingOverlay")[0];

	// Options for the observer (which mutations to observe)
	const config = { attributes: false, childList: true, subtree: true };

	// Callback function to execute when mutations are observed
	const callback = function(mutationsList, observer) {
		ui.trigger("logIsAdded");
	};

	// Create an observer instance linked to the callback function
	const observer = new MutationObserver(callback);

	// Start observing the target node for configured mutations
	observer.observe(targetNode, config);	
	this.loadingObserverIsInitialized = true;
}


ui.loadingEnd = function(percent, status, options) {
	options = options||{};
	console.log("Loading end", arguments);
	var elapsed = Date.now() -  ui._logTimeStart;
	ui.log("Log ended!");
	ui.log("Elapsed time : "+elapsed+"ms");
	ui.loadingProgress(percent, status, options);
	var $loading = $("#loadingOverlay");
	options.error = options.error || false;
	
	var thisClass = "stopped";
	if (options.warning) thisClass = "warning";
	if (options.error) thisClass = "error";
	$loading.find(".loadingBarProgress").addClass(thisClass);
	ui.showCloseButton();
}


ui.setWindowTitle=function(title) {
	title = title||trans.currentFile.replace(/^.*[\\\/]/, ''); // eslint-disable-line
	nw.appSuffix = nw.appSuffix||"";
	var suffix = "";
	if (nw.appSuffix) {
		suffix = " "+nw.appSuffix;
	}
	var applicationTitle = "SLR Translator v"+nw.App.manifest.version+suffix;
	
	if (title.length > 0) {
		applicationTitle = title+" - SLR Translator v"+nw.App.manifest.version+suffix;
		$(".appTitle").text(applicationTitle);
		return $("title").text(applicationTitle);
	}
	$(".appTitle").text(applicationTitle);
	return $("title").text(applicationTitle);
}

ui.setStatusBar = function(index, content) {
	$(".footer .footer-content").eq(index).find("span").html(content);	
}

ui.updateEditorStatus = function() {
	var $editorContent = $(".footer-content.footer2 > span");
	var $editorStatus = $editorContent.find(".editorStatus");
	if ($editorContent.find(".editorStatus").length < 1) {
		$editorStatus = $("<span class='editorStatus'><span class='keyLength'>keylength</span><span class='keyLength'>keylength</span></span>");
		$editorContent.append($editorStatus);
	}
}


ui.initTextResizer = function() {
	var $elm = $(".resizeFont");
	$elm.each(function() {
		var hookName = $(this).data("for");
		if (Boolean(hookName) == false) return;
		var currentSize = sys.getConfig("textSize"+hookName) || 100;
		var $targetElm = $(hookName);
		$targetElm.css("font-size", currentSize+"%");
		$targetElm.data("currentSize", currentSize);
	})
}
ui.openTextResizer = function(hookTo, $targetElm, options) {
	console.log("text resizer opened");
	if (typeof hookTo == 'undefined') return false;
	if (hookTo.length == 0) return false;
	options = options||{};
	options.default = options.default||100;
	
	$("#textSlider .textResizer").data("target", $targetElm);
	$("#textSlider .textResizer").data("targetString", hookTo.attr("data-for"));
	
	$("#textSlider").removeClass("hidden");
	$("#textSlider .textResizer")[0].focus();
	$("#textSlider").position({
		my: "center top",
		at: "center bottom",
		of: hookTo,
		collision : "fit flip"
		
	});
	$(document).on("mouseup.resizer", function(e) {
		var container = $("#textSlider");
		if (!container.is(e.target) && container.has(e.target).length === 0) {
			container.addClass("hidden");
			$(document).off("mouseup.resizer");
			sys.saveConfig();
		}
	});		
	
	var thisDefault = $targetElm.data("currentSize") || 100;
	$("#textSlider .textResizeValue").val(thisDefault+"%");
	$("#textSlider .textResizer").val(thisDefault);
	$("body").scrollTop(0)
	if ($("#textSlider").hasClass('rendered') == false) {
		$("#textSlider .textResizer").on("input", function(e) {
			$(this).data("target").css("font-size", $(this).val()+"%");
			$(this).data("target").data("currentSize", $(this).val())
			$("#textSlider .textResizeValue").val($(this).val()+"%");
			//console.log("size", $(this).val(), "hookTo", $(this).data("targetString"));
			sys.setConfig("textSize"+$(this).data("targetString"), $(this).val())
			ui.trigger("textSizeChanged", $(this).val(), $(this).data("targetString"));
			if ($(this).data("target").is("#currentCellText")) {
				console.log("current text resize");
				ui.generateBackgroundNumber($("#currentCellText"), undefined, true);
				ui.redrawBackgroundHelper();
			}
		});
		$("#textSlider button").eq(0).on("click", function(e) {
			var textResizer =$("#textSlider .textResizer");
			var newValue = parseInt(textResizer.val())-parseInt(textResizer.attr('step'));
			if (newValue < parseInt(textResizer.attr("min"))) newValue = parseInt(textResizer.attr("min"));
			textResizer.val(newValue);
			textResizer.trigger("input");
		});
		$("#textSlider button").eq(1).on("click", function(e) {
			var textResizer =$("#textSlider .textResizer");
			var newValue = parseInt(textResizer.val())+parseInt(textResizer.attr('step'));
			if (newValue > parseInt(textResizer.attr("max"))) newValue = parseInt(textResizer.attr("max"));
			textResizer.val(newValue);
			textResizer.trigger("input");
		});
		
		$("#textSlider .textResizer").on('wheel.resizer', function(event){
			// deltaY obviously records vertical scroll, deltaX and deltaZ exist too
			if(event.originalEvent.deltaY < 0){
				//wheeled up
				//console.log("wheel up");
				$("#textSlider button").eq(1).trigger("click");
			}
			else {
				//wheeled down
				//console.log("wheel down");
				$("#textSlider button").eq(0).trigger("click");
				
			}
		});		
		$("#textSlider").addClass('rendered');
	}
	
}


/*
var _consoleLog = console.log;
console.log = function(string) {
	_consoleLog.call(this, string);
	if (ui.consoleIsShown) {
		$("#loadingOverlay .console").append("<pre>"+string+"</pre>");
	}
}
*/

ui.closeAllChildWindow = function(force) {
	for (var thisWin in ui.windows) {
		if (ui.windows[thisWin]) {
			// Prefer the stashed nw handle (see the close loop in the main window's
			// close handler) so child windows close synchronously.
			var child = ui.windows[thisWin];
			var handle = (child && child.__nwHandle) ? child.__nwHandle : child;
			if (handle && handle.win) {
				handle.win.close(force);
			} else {
				handle.close(force);
			}
		}
	}
}

ui.openHelp = function(pageId, anchor) {
	if (window.docsHelp) docsHelp.open(pageId, anchor);
};

ui.contextToolFetchSelected = function() {
	/* 
		returns array of selected context 
		$("#dialogContextTool .contextSelector");
			or 
		$("#dialogContextTool .contextSelectorText").val();
	*/
	
	var contextSelector = $("#dialogContextTool .contextSelector");
	var context = contextSelector.val();
	context = context||[];
	
	var textContent = $("#dialogContextTool .contextSelectorText").val();
	var textContentA = [];
	
	if (textContent) {
		textContentA = textContent.split("\n").map(function(input) {
			return common.stripCarriageReturn(input);
		});
	}
	
	var resultArray = [];
	for (let i=0; i<context.length; i++) {
		if (Boolean(context[i]) == false) continue;
		resultArray.push(context[i]);
	}
	for (let i=0; i<textContentA.length; i++) {
		if (Boolean(textContentA[i]) == false) continue;
		if (resultArray.indexOf(textContentA[i]) !== -1) continue;
		resultArray.push(textContentA[i]);
	}	
	
	return resultArray;
}


ui.contextToolDialog = function() {
	ui.showBusyOverlay();
	var contextKeywords = trans.collectContextKeyword();
	var contextSelector = $("#dialogContextTool .contextSelector").empty();
		contextSelector.append("<option value=''>"+"-nothing-"+"</option>");
	
	for (var context in contextKeywords) {
		contextSelector.append("<option value='"+context+"'>"+context+" ("+contextKeywords[context]+") items</option>");
	}
	
	if ($("#dialogContextTool").hasClass("initialized") == false) {
		$("#dialogContextTool").dialog({
			autoOpen: false,
			modal:true,
			//width:Math.round($(window).width()/100*80),
			//height:Math.round($(window).height()/100*80),
			width:640,
			height:480,
			minWidth:480,
			minHeight:420,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog("close");
					}
				},			
				{
					text: "Ok",
					icon: "ui-icon-close",
					click: function() {
						var $actionSet = $(".contextAction");

						if ($actionSet.find( "input:checked" ).length == 0) {
							var conf = confirm("No action selected, are you sure?");
							if (conf) {
								$(this).dialog("close");
								return false;
							}
						}
						
						var selectedAction = $actionSet.find( "input:checked" ).val();
						console.log("action is", selectedAction);			
						var targetArray = ui.contextToolFetchSelected();
						
						if (targetArray.length < 1) {
							alert("No context's keyword specified!");
							return false;
						}						
						if (selectedAction == "actionRemoveSelected") {
							let conf = confirm("Remove context containing keyword :\n"+targetArray.join(", ")+"\nfrom project?");
							if (conf) {
								trans.removeRowByContext(undefined, targetArray, {
									matchAll:$("#dialogContextTool .matchAll").prop("checked")
								});
								$(this).dialog( "close" );
							}
						} else if (selectedAction == "actionRemoveButSelected"){
							let conf = confirm("Remove every rows except rows that has a context containing keyword :\n"+targetArray.join(", ")+"\nfrom project?");
							if (conf) {
								trans.removeRowByContext(undefined, targetArray, {
									matchAll:$("#dialogContextTool .matchAll").prop("checked")
								}, true);
								$(this).dialog( "close" );
							}							
						}
						
						$(this).dialog( "close" );
					}
				}

			]
		});	
		$("#dialogContextTool").addClass("initialized");
	}
	ui.hideBusyOverlay();
	$("#dialogContextTool").dialog("open");
	return ($("#dialogContextTool"));		
}


ui.batchWrapingDialog = function() {
	ui.showBusyOverlay();
	var contextKeywords = trans.collectContextKeyword();
	var contextSelector = $("#batchWraping .contextSelector").empty();
		contextSelector.append("<option value=''>"+"-nothing-"+"</option>");
	
	for (var context in contextKeywords) {
		contextSelector.append("<option value='"+context+"'>"+context+" ("+contextKeywords[context]+") "+"items"+"</option>");
	}
	
	$("#batchWraping .sourceCol").empty();
	$("#batchWraping .sourceCol").append(ui.generateColSelector({skipFirstCol:true}));
	
	$("#batchWraping .targetCol").empty();
	$("#batchWraping .targetCol").append(ui.generateColSelector({skipFirstCol:true}));
	
	$("#batchWraping .sourceCol select").off("change");
	$("#batchWraping .targetCol select").off("change");
	
	$("#batchWraping .sourceCol select").on("change", function(e) {
		
		
	});

	
	if ($("#batchWraping").hasClass("initialized") == false) {
		$("#batchWraping").dialog({
			autoOpen: false,
			modal:true,
			//width:Math.round($(window).width()/100*80),
			//height:Math.round($(window).height()/100*80),
			width:640,
			height:480,
			minWidth:480,
			minHeight:320,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},			
				{
					text: "Wrap text",
					icon: "ui-icon-close",
					click: function() {
						if ($("#batchWraping .sourceCol select").val() == $("#batchWraping .targetCol select").val()) return alert("Source & target column can not be same!");
						
						var selectedFiles = trans.getCheckedFiles();
						if (selectedFiles.length == 0) {
							var conf = confirm("No files are selected on file selector pane.\nSLR will assume that all files will be processed\nAre you sure with this?");
							if (!conf) return false;
						}
						
						ui.showBusyOverlay();
						setTimeout(function() {
							trans.wordWrapFiles(selectedFiles, $("#batchWraping .sourceCol select").val(), $("#batchWraping .targetCol select").val(), {
								maxLength:$("#batchWraping .maxLength").val(),
								context:trans.evalContextsQuery($("#batchWraping .contextSelector").val(), $("#batchWraping .contextSelectorText").val())
							});
							trans.refreshGrid();
							ui.hideBusyOverlay();
						}, 250);
						
						$(this).dialog("close");
						
					
					}
				}

			]
		});	
		$("#batchWraping").addClass("initialized");
	}
	ui.hideBusyOverlay();
	$("#batchWraping").dialog("open");
	return ($("#batchWraping"));		
}




/**
 * Create wordWrapperByTag DOM element
 * @param  {} options
 */
ui.drawWordWrapByTagField = function(options) {
	var $wrapper = $(`
		<div class="wordWrapByTag fieldSet" data-type="wordWrapByTag">
			<table class="fullWidth">
				<thead>
					<tr>
						<td>Tags</td>
						<td>Maximum length</td>
						<td> </td>
					</tr>
				</thead>
				<tbody class="resultSet">
				</tbody>
			</table>
			<hr />
			<button class="addRule"><i class="icon-list-add"></i> Add rows</button>
		</div>`);

	$wrapper.data("getValue", function() {
		var result = [];
		var $rows = $wrapper.find(".wordWrapTagField");
		for (var i=0; i<$rows.length; i++) {
			var $thisRow = $rows.eq(i);
			var maxLength = parseInt($thisRow.find(".maxLength").val());
			if (empty(maxLength)) continue;
			var tags = $thisRow.find(".wordWrapTags").data("value");
			if (empty(tags)) continue;
			result.push({
				maxLength:maxLength,
				tags:tags
			});
		}
		return result;
	});

	$wrapper.data("saveValue", function() {
		console.log("saving value");
		trans.setOption("wordWrapByTags", $wrapper.data("getValue")());
	});

	var $field = $(`
		<tr class="wordWrapTagField fullWidth">
			<td><input type="text" class="wordWrapTags" /></td>
			<td><input type="number" class="maxLength" min="1" max="1000" /></td>
			<td><button title="Remove this row"><i class="icon-cancel-1"></i></button></td>
		</tr>`);
	$field.find("button").on("click", function() {
		$(this).closest(".wordWrapTagField").remove();
		$wrapper.data("saveValue")();
	});

	var addField = (defaultVal) => {
		defaultVal = defaultVal || {};
		var $fieldCopy 	= $field.clone(true, true);
		var tagSelector = new UiTagSelector($fieldCopy.find(".wordWrapTags"), {default:defaultVal.tags});
		$wrapper.find(".resultSet").append($fieldCopy);
		if (defaultVal.maxLength) $fieldCopy.find(".maxLength").val(defaultVal.maxLength);
		tagSelector.on("input", ()=> {
			$wrapper.data("saveValue")();
		});
		$wrapper.find(".maxLength").on("change", ()=>{
			$wrapper.data("saveValue")();
		})
	}
	$wrapper.find(".addRule").on("click", () => {
		addField();
	});
	
	// setting up default
	if (!empty(trans.getOption("wordWrapByTags"))) {
		var settings = trans.getOption("wordWrapByTags");
		for (var i=0; i < settings.length ; i++ ) {
			(()=>{
				var thisSetting = settings[i];
				addField(thisSetting);
			})()
			
		}
	}

	return $wrapper;
}


ui.exportPreparationDialog = function(path, options) {
	console.log("Export preparation", options);
	options = options||{};
	options.onDone = options.onDone||function(){}
	options.useTagSelection 	||= false;
	options.wordWrapOption	 	||= false;

	var $dialogExport = $("#dialogExportPreparation")
	$dialogExport.data("onDone", options.onDone);

	$dialogExport.find(".exportPath").val(path);

	this.lastTags = new UiTags();
	$dialogExport.find(".colorTagSelector").empty();

	if (options.useTagSelection) {
		$dialogExport.find(".tagSelection").removeClass("hidden");
		$dialogExport.find(".colorTagSelector").append(this.lastTags.element);
	} else {
		$dialogExport.find(".tagSelection").addClass("hidden");
	}

	if (options.wordWrapOption) {
		var $wordWrapByTag = this.drawWordWrapByTagField(options);
		$dialogExport.find(".wordWrapByTag .wrapper").empty();
		$dialogExport.find(".wordWrapByTag").removeClass("hidden");
		$dialogExport.find(".wordWrapByTag .wrapper").append($wordWrapByTag);
	} else {
		$dialogExport.find(".wordWrapByTag .wrapper").empty();
		$dialogExport.find(".wordWrapByTag").addClass("hidden");
	}

	// settingUp customFieldOptions
	let enginesFieldOptions = engines.current().getProperty("exportOptionFields");
	var customFields;
	const $customFieldsWrapper = $dialogExport.find(".customFields");
	$customFieldsWrapper.empty();
	(async ()=> {
		if (enginesFieldOptions) {
			customFields = new CustomFields($customFieldsWrapper, enginesFieldOptions);
			await customFields.until("ready");
		} 
		engines.handler('onOpenExportDialogReady').call(this, $dialogExport, options);
	})()

	if ($dialogExport.hasClass("initialized") == false) {
		$dialogExport.dialog({
			autoOpen: false,
			modal:true,
			//width:Math.round($(window).width()/100*80),
			//height:Math.round($(window).height()/100*80),
			width:640,
			height:480,
			minWidth:640,
			minHeight:480,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},			
				{
					text: "Export Now",
					icon: "ui-icon-plus",
					click: function() {
						var $dialogExport = $("#dialogExportPreparation");
						var thisOptions = ui.lastTags.getValue();
						if (thisOptions === false) return false;
						
						var thisOnDone = $(this).data("onDone");
						if (typeof thisOnDone !== 'function') return console.log("thisOnDone is not a function");
						console.log("Tags : ", thisOptions);
						
						// get value from wrapper options
					if (options.wordWrapOption) {
						thisOptions.wordWrapByTags = trans.getOption("wordWrapByTags") || [];
					}
					if (customFields) {
							thisOptions.custom = customFields.getValues();
						}
						console.log("Export options:", thisOptions);

						
						thisOnDone.call(this, thisOptions);
						$(this).dialog( "close" );
					}
				}

			]
		});	
		$("#dialogExportPreparation").addClass("initialized");
	}
	
	$("#dialogExportPreparation").dialog("open");
	return $("#dialogExportPreparation");		
}


ui.taggingDialog = function(cellSelection, options) {
	console.log("taggingDialog", arguments);
	options = options||{};
	options.onDone = options.onDone||function(){}

	var $dialogContent = $("#dialogSetTags");
	ui._tagSelector = new UiTags({
		options : $(`
		<h2>${'Action'}</h2>
		<div class="actionSet">
			<label class="flex"><input type="radio" name="tagAction" class="appendTags" value="appendTags" /> <span>${'Append tags'}</span></label>
			<label class="flex"><input type="radio" name="tagAction" class="removeTags" value="removeTags" /> <span>${'Remove tags'}</span></label>
			<label class="flex"><input type="radio" name="tagAction" class="setTags" value="setTags" /> <span>${'Set tags'}</span></label>
			<label class="flex"><input type="radio" name="tagAction" class="actionNone" value="" /> <span>${'Do nothing'}</span></label>
		</div>		
		`)
	});
	$dialogContent.find(".colorTagSelector").empty();
	$dialogContent.find(".colorTagSelector").append(ui._tagSelector.element);


	if ($dialogContent.hasClass("initialized") == false) {
		console.log("initializing dialogSetTags");
	
		$dialogContent.dialog({
			autoOpen: true,
			modal:true,
			//width:Math.round($(window).width()/100*80),
			//height:Math.round($(window).height()/100*80),
			width:500,
			height:320,
			minWidth:500,
			minHeight:320,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog("close");
					}
				},			
				{
					text: "Ok",
					icon: "ui-icon-plus",
					click: function() {
						var tags = ui._tagSelector;
						console.log("Tag object:", tags);
						var tagsData = tags.getValue();
						var tagList = tagsData.filterTag;
						var action = tagsData.filterTagMode;
						if (tagsData === false) return false;
						
						$(this).dialog( "close" );
						
						if (action == "appendTags") {
							trans.setTagForSelectedRow(tagList, cellSelection, undefined, {append:true});
						} else if (action == "setTags") {
							trans.setTagForSelectedRow(tagList, cellSelection, undefined, {append:false});
						} else if (action == "removeTags") {
							trans.removeTagForSelectedRow(undefined, cellSelection,  tagList)
						}							

					}
				}

			]
		});
	
	}
	
	$dialogContent.dialog("open");	
	return $dialogContent;	
}

/**
 * Set Current Cell Text
 * @param {String} value - New value
 * @param {Boolean} trigger - Immidiately trigger change event
 * @since 4.12.11
 */
ui.setCurrentCellText = function(value, trigger) {
	var $currentCellText = $("#currentCellText")
	if ($currentCellText.prop("disabled")) return;
	if ($currentCellText.prop("readonly")) return;
	$currentCellText.val(value);
	if (trigger) $currentCellText.trigger("change")
}

ui.toggleWordWrapCurrentCellPane = function(state=false) {
	var $currentCellText = $("#currentCellText");
	if (state) {
		$(".currentCellTextCtrl .wordWrap").addClass("checked");
		$currentCellText.addClass("pre");
		ui.generateBackgroundNumber();
	} else {
		$(".currentCellTextCtrl .wordWrap").removeClass("checked");
		$currentCellText.removeClass("pre");
		ui.clearBackgroundNumber();
	}
	sys.setConfig("wordWrapCurrentCellPane", state);
	sys.saveConfig();
}

ui.toggleWordWrapRomajiPane = function(state=false) {
	if (state) {
		$("#currentRomaji .text").css("white-space", "pre")
		$(".cellInfoCtrl .wordWrap").addClass("checked")
	} else {
		$("#currentRomaji .text").css("white-space", "break-spaces")
		$(".cellInfoCtrl .wordWrap").removeClass("checked")
	}
	sys.setConfig("wordWrapRomajiPane", state);
	sys.saveConfig();
}

// ==================================================================
// 						INTRO WINDOW SECTION
// ==================================================================

ui.introWindowShow = function(options) {
	//ui.blurAll();
	ui.showRandomTip();
	$("#introWindow").fadeIn(200);
	//$("#introWindow").removeClass("hidden");		
	ui.appBarTheme("dark");
	this.ribbonMenu.select("start", false)
	
}

ui.introWindowClose = function(options) {
	//ui.unBlurAll();
	trans.grid.render();
	//$("#introWindow").addClass("hidden");
	$("#introWindow").fadeOut(200);
	ui.appBarTheme("");
	ui.backgroundHelperInitialize();
	this.ribbonMenu.select("home", false)
}

ui.showRecentFile = function(num, $target) {
	if (Boolean(sys) == false) return;
	if (Boolean(sys.config) == false) return;
	if (Boolean(sys.config.historyOpenedFiles) == false) return;
	$target = $target||$("#introWindow .recentProject");

	num = num||1;
	$target.empty();
	for (var i=0; i<num; i++) {
		if (Boolean(sys.config.historyOpenedFiles[i]) == false) continue;
		sys.config.historyOpenedFiles[i] = sys.config.historyOpenedFiles[i] || {};
		if (JSON.stringify(sys.config.historyOpenedFiles[i]) == "{}") continue;

		var thisGameTitle 	= sys.config.historyOpenedFiles[i].gameTitle||"-unknown title-";
		var thisEngine		= "";
		let thisPath		= sys.config.historyOpenedFiles[i].path  || "";
		
		try {
			console.log("Path is : ", sys.config.historyOpenedFiles[i].path);
			thisEngine 	= sys.config.historyOpenedProject[sys.config.historyOpenedFiles[i].projectId].gameEngine;
		} catch (e) {
			//console.warn(e);
		}
		var $template = $(`<li><i class='icon icon-angle-right'></i><span class='title'></span><span class='date icon-calendar'></span>
		<span class="filePath">
			<div class="flex"><span class="folderPath">${nwPath.dirname(thisPath)}</span><span class="fileName">\\${nwPath.basename(thisPath)}</span>
			</div>
		</span></li>`);
		$template.find(".title").html(thisGameTitle);
		$template.find(".date").html(new Date().toLocaleString());
		$template.data("gameData", sys.config.historyOpenedFiles[i]);
		if (thisEngine) $template.append("<span class='engine'>"+thisEngine+"</span>");
		$template.data("historyIndex", i);
		$template.data("engineName", thisEngine);
		$target.append($template);
		
		$template.on("click", async function() {
			//sys.loadFileHistory($(this).data("historyIndex"));
			var transPath = $(this).data("gameData").path;
			if (!await common.isFileAsync(transPath)) return alert("Can not open file. File not exist.")
			trans.open(transPath);
			ui.introWindowClose();
		})
	}

	if ($target.find("li").length == 0) {
		let $template = $(`<li title='`+'Go to SubscribesTar donation page.'+`'>
		<i class='icon icon-angle-right mainIconRight'></i>
			<span class='title'><i class="icon-info-circled-1"></i>`+'No projects yet'+`</span>
            <span>`+`<img src="img/rtfm.png"><br />
			You can press <b>F1</b> to open the documentation window.<br /><br />
			To support development of SLR Translator, please consider making a donation :
			<b>https://www.subscribestar.com/shisaye</b>
			`+
			`</span>
		</li>`);
		$template.on("click", function() {
			//nw.Shell.openExternal('https://www.subscribestar.com/shisaye'); Nobody donates anyway.
			ui.openHelp();
		})		
		$target.append($template);		
	}
	
	return $target;
}

ui.showRandomTip = function($container) {
	let $tipPlaceHolder = $(".tipsPlaceHolder > div");
	var $item = $tipPlaceHolder[Math.floor(Math.random()*$tipPlaceHolder.length)];
	$item = $($item).clone(true, true);
	$container = $container || $(".tipsContent");
	$container.html(ui.render($item));
	return $item;
}



ui.warning = function(msg, title, options) {
	options = options||{};
	options.onDone = options.onDone||function(){}
	title = title||"Warning";
	$("#warningDialog").data("onClose", options.onDone);
	if ($("#warningDialog").length == 0) {
		$("#template").append("<div id='warningDialog' class='warningDialog' title='Warning'><h1 class='icon-attention warningTitle'>"+"Warning"+"</h1><p class='warningContent'></p></div>");
		$("#warningDialog .warningContent").html(msg);
		$("#warningDialog .warningTitle").html(title);
		$("#warningDialog").dialog({
			autoOpen: false,
			modal:true,
			//width:Math.round($(window).width()/100*80),
			//height:Math.round($(window).height()/100*80),
			width:640,
			height:320,
			minWidth:640,
			minHeight:320,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Close",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}

			]
		});	
		
		$("[aria-describedby='warningDialog']").find(".ui-dialog-title").prepend("<span class='icon-attention'></span>");
	} else {
		$("#warningDialog .warningContent").html(msg);
		$("#warningDialog .warningTitle").html(title);
		
	}
	
	$("#warningDialog .warningContent a").on("click", function(e) {
		e.preventDefault();
		nw.Shell.openExternal($(this).attr("href"));
	});
	
	$("#warningDialog").dialog("open");
	return $("#warningDialog");		
}


ui.confirmRunScript = async function(options) {
	return new Promise((resolve) => {
		options = options||{};
		const $dialog = $(`<div>
			<h1 class='icon-attention warningTitle'>${"You are about to run a user script!"}</h1>
			<p class='warningContent'>You are about to execute a user script that is not a part of SLR. Please be aware that running a malicious script can cause harm to your computer. Only proceed if you fully understand the consequences and trust the source of the script.</p>
			</div>`)
		var result = false;

		$dialog.dialog({
			autoOpen: false,
			title:"⚠️Warning: Running User Script⚠️",
			modal:true,
			//width:Math.round($(window).width()/100*80),
			//height:Math.round($(window).height()/100*80),
			width:640,
			height:320,
			minWidth:640,
			minHeight:320,
			classes: {
				"ui-dialog": "highlight warning dialogTopMost"
			},
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			open: function() {
				// make topmost
				console.log("this", this);
				console.log("setting z-index for", $(this).closest(".ui-dialog[role='dialog']"));
				$(this).closest(".ui-dialog[role='dialog']").css("z-index", "9000")
			},
			close: ()=> {
				resolve(result);
			},
			buttons:[
				{
					text: "Close",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},
				/*
				{
					text: t("View the code"),
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},
				*/
				{
					text: "Execute the script",
					icon: "ui-icon-close",
					click: function() {
						result = true;
						$(this).dialog( "close" );
					}
				}

			]
		});	
		
		//$("[aria-describedby='warningDialog']").find(".ui-dialog-title").prepend("<span class='icon-attention'></span>");

	
		$dialog.dialog("open");
		$dialog.css("z-index", "9000 !important")

	})
		
}


ui.resize = {};
ui.resize.leftPane = function(size) {
	size = size||200;
	
	sys.config = sys.config || {}
	sys.config.paneSizes = sys.config.paneSizes||{};
	sys.config.paneSizes.leftPane = size;
	
	if (typeof size == 'number') size = size+"px"
	$(".panel-right").css("overflow", "auto");
	$(".panel-left").css("width", size);
	$(".panel-right").css("overflow", "hidden");
	trans.refreshGrid();	
}
ui.resize.editorWidth = function(size) {
	size = size || "30%";
	sys.config = sys.config || {}
	sys.config.paneSizes = sys.config.paneSizes||{};
	sys.config.paneSizes.editorWidth = size;
	
	if (typeof size == 'number') size = size+"px"
	$(".cellInfoPartsA").width(size);
}
ui.resize.editorHeight = function(size) {
	size = size || "calc(100vh - 180px)";
	sys.config = sys.config || {}
	sys.config.paneSizes = sys.config.paneSizes||{};
	sys.config.paneSizes.editorHeight = size;
	
	if (typeof size == 'number') size = size+"px"
	$(".panel-wrapper").css("height", size);
	trans.refreshGrid();	
	ui.fixCellInfoSize();			
}
ui.resize.reset = function() {
	ui.resize.leftPane();
	ui.resize.editorWidth();
	ui.resize.editorHeight();	
	trans.grid.render();
}

ui.resize.collapse = function(target) {
	$(".panel-left").addClass("hidden");
	$(".panelLeftTabHandler > i").removeClass("flip");
	trans.grid.render();
}
ui.resize.unCollapse = function(target) {
	$(".panel-left").removeClass("hidden");
	$(".panelLeftTabHandler > i").addClass("flip");
	trans.grid.render();
}
ui.resize.toggleCollapse = function(target) {
	if ($(".panel-left").hasClass('hidden')) {
		ui.resize.unCollapse()
	} else {
		ui.resize.collapse()
	}
}
ui.resize.init = function() {
	//var $currentRomaji = $("#currentRomaji");
	var $cellInfoContent = $(".cellInfoTabContent");
	$(".panel-wrapper").resizable({
		handles:'s',
		start:function(e, thisUi) {
			$(document).trigger("onCellInfoResizeStart");

			var maxHeight = $(window).height()-120;
			$(".panel-wrapper").resizable( "option", "maxHeight", maxHeight );
		},
		resize:function(e, thisUi) {
			var negativeHeight = thisUi.element.height() + 100;
			$cellInfoContent.css("height", "calc(100vh - "+negativeHeight+"px)");
		},
		stop:function(e, thisUi) {
			$(document).trigger("onCellInfoResizeStop");
			sys.config = sys.config || {}
			sys.config.paneSizes = sys.config.paneSizes||{};
			sys.config.paneSizes.editorHeight = $(this).css("height");
			
			trans.refreshGrid();
			//trans.grid.refreshDimensions();	
			ui.fixCellInfoSize();		
			
		}
	})

	$(".cellInfoPartsA").resizable({
		handles:'e',
		start:function(e, thisUi) {
			//$(".cellInfoPartsB").css("width", "unset");
			$(document).trigger("onCellInfoResizeStart");
			var maxWidth = Math.round($(window).width()/100*80);
			$(".cellInfoPartsA").resizable( "option", "maxWidth", maxWidth );
		},
		stop:function(e, thisUi) {
			$(document).trigger("onCellInfoResizeStop");
			sys.config = sys.config || {}
			sys.config.paneSizes = sys.config.paneSizes||{};
			sys.config.paneSizes.editorWidth = $(this).css("width");
		}
	});
	
	
	$(".panel-left").resizable({
		handles:'e',
		start:function(e, thisUi) {
			$(".panel-right").css("overflow", "auto");
			trans.ignoreResize = true;
		},
		resize:function() {
			//console.log("resize");
			//$(".panel-left").attr("style", "width:calc(100vw - "+$(".panel-right").outerHeight()+"px)");
		},
		stop:function(e, thisUi) {
			$(".panel-right").css("overflow", "hidden");
			
			trans.ignoreResize = false;
			//trans.grid.render();
			sys.config = sys.config || {}
			sys.config.paneSizes = sys.config.paneSizes||{};
			sys.config.paneSizes.leftPane = $(this).width();
			trans.grid.render();
		}
	});	

	sys.onReady(function() {
		sys.config = sys.config || {}
		sys.config.paneSizes = sys.config.paneSizes||{};
		ui.resize.leftPane(sys.config.paneSizes.leftPane);
		ui.resize.editorWidth(sys.config.paneSizes.editorWidth);
		ui.resize.editorHeight(sys.config.paneSizes.editorHeight);
		console.log("rerendering grids");
		trans.ignoreResize = false;
		trans.refreshGrid();

	})	
}

// active cell info
ui.toggleActiveCellInfo = function(isOn) {
	var $elm = $('#cellSelectionInfo')
	var $btn = $('.toggle-activeCellInfo')
	
	if (typeof isOn == 'undefined') {
		if ($elm.is(':visible')) {
			$btn.removeClass('checked');
			isOn = false;
		} else {
			$btn.addClass('checked');
			isOn = true;
		}
	}	

	if (isOn) {
		$('.panel-wrapper').css("max-height", "");
		$elm.show();
	} else {
		$('.panel-wrapper').css("max-height", "100%");
		$elm.hide();
	}
	trans.grid.render();
}

ui.clearActiveCellInfo = function() {
	$("#currentCoordinate").val('');
	$("#currentRomaji .header").html("");
	$("#currentRomaji .text").html("");
	$("#currentCellText").val('')
}

ui.clearPathInfo = function() {
	$('.pathinfoWrapper .fileId').val('')
}


// ==============================================================
// APP BAR
// ==============================================================
ui.appBarTheme = function(theme) {
	$(".applicationBar").attr("data-theme", theme);
}

// ==============================================================
// NOTE
// ==============================================================
ui.applyCurrentNote = function() {
	// store current note
	if (ui.windows['note']) {
		try {
			ui.windows['note'].note.saveData();
		} catch (e) {
			console.warn("can not save note", e)
		}
	}
	ui.evalFileNoteIcon();
}

ui.openFileNote = function(param, options) {
	param = param||trans.getSelectedId()||"";
	options = options||{};
	//options.thisNote = options.thisNote||trans.getSelectedObject().note || "";
	ui.applyCurrentNote();
	// Hidden until painted, so it never flashes the default white canvas.
	nw.Window.open("www/note.html#" + param, {
		id: "note",
		frame: false,
		show: false,
		width: 640,
		height: 320,
		x: 100,
		y: 100,
		resizable: true
	}, function(thisWin) {
		if (!thisWin) return;
		ui.windows['note'] = thisWin.window;
		var revealed = false;
		var reveal = function() {
			if (revealed) return;
			revealed = true;
			var showIt = function() {
				try { thisWin.show(); } catch (e) {}
				try { thisWin.focus(); } catch (e) {}
			};
			var w = null;
			try { w = thisWin.window; } catch (e) {}
			if (w && typeof w.requestAnimationFrame === "function") {
				w.requestAnimationFrame(function() { w.requestAnimationFrame(showIt); });
			} else {
				setTimeout(showIt, 30);
			}
		};
		try { thisWin.on("loaded", reveal); } catch (e) {}
		setTimeout(reveal, 15000);
	});
	$(".menu-button.addNote").addClass("checked");
	/*
	if (ui.noteIsOpened) {
		ui.windows['note'].document.getElementById('note').value= options.thisNote;
	} else {	
		ui.windows['note'].onload = function() {
			ui.windows['note'].document.getElementById('note').value= options.thisNote;
		}
	}
	*/
}

ui.closeFileNote = function() {
	$(".menu-button.addNote").removeClass("checked");
	
	if (ui.windows['note']) ui.windows['note'].close();
}

ui.evalFileNoteIcon = function() {
	/*
	if (Boolean(trans.getSelectedObject().note) == false) {
		$(".menu-button.addNote img").attr("src", "img/spechbubble_sq_icon.png");
	} else {
		$(".menu-button.addNote img").attr("src", "img/spechbubble_sq_icon_line.png");
	}
	*/

	const fileObj = trans.getSelectedObject();

	const $noteIcon = $("#commentButtonIcon");
	$noteIcon.css("color", "")
	if (!fileObj.note) {
		$noteIcon.attr("class", "icon-comment-empty")
	} else {
		$noteIcon.attr("class", "icon-commenting")
		if (fileObj.noteColor) $noteIcon.css("color", fileObj.noteColor)
	}
}


ui.switchLeftPane = function(target) {
	
	$(".panel-left .switchablePane").addClass("hidden");
	$(".panel-left .switchablePane").removeClass("activePane");
	$(".panel-left .switchablePane."+target).removeClass("hidden");
	$(".panel-left .switchablePane."+target).addClass("activePane");

	$(".panel-left .panel-switcher").removeClass("checked");
	$(".panel-left .panel-switcher[data-for="+target+"]").addClass("checked");
}


// ==============================================================
// SEARCH
// ==============================================================

ui.openSearchWindow = function(param) {
	param = param||"";
	console.log("selected text is: "+common.getSelectionText());
	var searchIsLoaded = false;
	if (typeof ui.windows['search'] !== 'undefined') {
		searchIsLoaded = true;
	}
	
	if (ui.windows['search']) {
		ui.windows['search'].win.restore();
		ui.windows['search'].win.requestAttention(2);
	}
	
	var posTop = $(".fileListWrapperOuter").offset().top + window.screenY+100;
	var posLeft = $(".fileListWrapperOuter").offset().left + window.screenX+240;	
	console.log("window possition : "+posTop+", "+posLeft);
	//ui.windows['search'] = window.open("find.html#"+param, "Search", "width=640,height=320,resizable=no,left="+posLeft+",top="+posTop+",fullscreen=no,dialog=1");
	
	nw.Window.open('www/find.html#'+param, 
	{
		// id will makes the search window will be spawned one
		'id': "search"+window.windowIndex, 
		'frame':false, 
		'transparent':true,
		// Hidden until painted, so it never flashes the default white canvas.
		'show': false
	}, 
	function(thisWin) {
		ui.windows['search'] = thisWin.window;
		var searchRevealed = false;
		var revealSearch = function() {
			if (searchRevealed) return;
			searchRevealed = true;
			var showIt = function() {
				try { thisWin.show(); } catch (e) {}
				try { thisWin.focus(); } catch (e) {}
			};
			var w = null;
			try { w = thisWin.window; } catch (e) {}
			if (w && typeof w.requestAnimationFrame === "function") {
				w.requestAnimationFrame(function() { w.requestAnimationFrame(showIt); });
			} else {
				setTimeout(showIt, 30);
			}
		};
		try { thisWin.on("loaded", revealSearch); } catch (e) {}
		setTimeout(revealSearch, 15000);
		ui.windows['search'].onload = function() {
			var thisSelectedText = common.getSelectionText();
			if (Boolean(thisSelectedText.trim()) == false) thisSelectedText="";
			ui.windows['search'].document.getElementById('fieldFind').value= thisSelectedText;
			ui.windows['search'].document.getElementById('fieldReplaceFind').value= thisSelectedText;
			ui.windows['search'].document.getElementById('fieldPutFind').value= thisSelectedText;
			
			if (param !== "replace") {
				var selectedText = thisSelectedText||"";
				if (selectedText.trim().length > 0 && selectedText !== " ") ui.windows['search'].search.sendCommandFind();
				
				//if (common.getSelectionText()) ui.windows['search'].search.sendCommand();
			}
			
		}
	});
	
	
	if (searchIsLoaded) {
		var thisSelectedText = common.getSelectionText();
		if (Boolean(thisSelectedText.trim()) == false) thisSelectedText="";
		ui.windows['search'].document.getElementById('fieldFind').value= thisSelectedText;
		ui.windows['search'].document.getElementById('fieldReplaceFind').value= thisSelectedText;
		ui.windows['search'].document.getElementById('fieldPutFind').value= thisSelectedText;
		if (param !== "replace") {
			var selectedText = thisSelectedText||"";
			if (selectedText.trim().length > 0 && selectedText !== " ") ui.windows['search'].search.sendCommand();
			// switch tab manually
			ui.windows['search'].document.querySelectorAll(".findAnchor")[0].click();
		} else {
			ui.windows['search'].document.querySelectorAll(".replaceAnchor")[0].click();
		}		
	} 

}

ui.openSearchMenu = function() {
	function openMenu() {
		var $wrapper = $(".group-find.buttonGroup");
		var left = Math.round($wrapper.offset().left);
		var top = Math.round($wrapper.offset().top + $wrapper.outerHeight());
		console.log(left, top)
		//ui.menus.saveAs.popup(parseInt(ev.originalEvent.x), parseInt(ev.originalEvent.y));
		ui.menus.search.popup(left, top);
		return false;
	}

	if (ui.menus.search) {
		return openMenu()
	}

	ui.menus.search = new nw.Menu();
	ui.menus.search.append(new nw.MenuItem({
		label: 'Bring to main screen',
		type: "normal", 
		click: async function(){
			if (!ui.windows.search) return;
			ui.windows.search.win.restore(); // restore if minimized
			ui.windows.search.win.show(); // show if hidden

			var left = Math.round(win.x+(win.width/2) - (ui.windows.search.win.width/2));
			var top = Math.round(win.y+(win.height/2) - (ui.windows.search.win.height/2));

			for (var i=0; i<3; i++) {
				if (ui.windows.search.win.x == left && ui.windows.search.win.y == top) break;
				console.log("Sending windows to ", left, top, "current pos", ui.windows.search.win.x, ui.windows.search.win.y);
				ui.windows.search.win.x = left;
				ui.windows.search.win.y = top;
				await common.wait(10);
			}

		}
	}));

	return openMenu()
}

ui.openMenuAtElm = function($elm, menu) {
	var left = Math.round($elm.offset().left);
	var top = Math.round($elm.offset().top + $elm.outerHeight());
	console.log(left, top)
	menu.popup(left, top);
}

ui.toggleGridInfo = function() {
	var gridInfoOption = trans.getOption("gridInfo") || {};
	var $button = $(".button-gridInfo.gridInfo");
	$button.toggleClass("checked");
	gridInfoOption.isRuleActive = $button.hasClass("checked");

	trans.setOption("gridInfo", gridInfoOption);
	trans.renderGridInfo();
	trans.grid.render();
}

ui.openGridInfoMenu = function() {
	var $elm = $(".menu-button .button-gridInfo.menuSide").parent();
	if (ui.menus.gridInfo) return ui.openMenuAtElm($elm, ui.menus.gridInfo);

	// initializing menu
	//var gridInfoOption = trans.getOption("gridInfo") || {};

	ui.menus.gridInfo = new nw.Menu();
	
	ui.menus.gridInfo.append(new nw.MenuItem({
		label: 'Show row header info',
		type: "checkbox", 
		checked: Boolean(trans.getOption("gridInfo")?.rowHeaderInfo),
		click: async function(e){
			let gridInfoOption = trans.getOption("gridInfo") || {};
			gridInfoOption.rowHeaderInfo = !gridInfoOption.rowHeaderInfo
			this.checked = gridInfoOption.rowHeaderInfo;
			trans.setOption("gridInfo", gridInfoOption);
			trans.renderGridInfo();
		}
	}));
	ui.menus.gridInfo.append(new nw.MenuItem({
		label: 'Row header width',
		type: "normal", 
		click: async function(e){
			var promptNewWidth = ()=> {
				let gridInfoOption = trans.getOption("gridInfo") || {};
				gridInfoOption.rowHeaderWidth = gridInfoOption.rowHeaderWidth || 130;
	
				let newWidth = prompt("Enter the row width in pixels.\r\nRow header width must be greater then 50px.", gridInfoOption.rowHeaderWidth);
				if (!newWidth) return;
				newWidth = parseInt(newWidth);
				if (newWidth < 50) return promptNewWidth();

				gridInfoOption.rowHeaderWidth = newWidth;
				
				trans.setOption("gridInfo", gridInfoOption);
				trans.renderGridInfo();
			}
			promptNewWidth();
		}
	}));
	ui.menus.gridInfo.append(new nw.MenuItem({ type: 'separator' }));
	ui.menus.gridInfo.append(new nw.MenuItem({
		label: 'Display marker on organic cells',
		type: "checkbox", 
		checked: Boolean(trans.getOption("gridInfo")?.viewOrganicCellMarker),
		click: async function(e){
			let gridInfoOption = trans.getOption("gridInfo") || {};
			gridInfoOption.viewOrganicCellMarker = !gridInfoOption.viewOrganicCellMarker
			this.checked = gridInfoOption.viewOrganicCellMarker;
			trans.setOption("gridInfo", gridInfoOption);
			trans.grid.render();
		}
	}));
	ui.menus.gridInfo.append(new nw.MenuItem({ type: 'separator' }));
	ui.menus.gridInfo.append(new nw.MenuItem({
		label: 'Leave trail on cell visit',
		type: "checkbox", 
		checked: Boolean(trans.getOption("gridInfo")?.enableTrail),
		click: async function(e){
			let gridInfoOption = trans.getOption("gridInfo") || {};
			gridInfoOption.enableTrail = !gridInfoOption.enableTrail
			this.checked = gridInfoOption.enableTrail;
			trans.setOption("gridInfo", gridInfoOption);
			trans.grid.render();
		}
	}));
	ui.menus.gridInfo.append(new nw.MenuItem({
		label: 'Display trails on visited cells',
		type: "checkbox", 
		checked: Boolean(trans.getOption("gridInfo")?.viewTrail),
		click: async function(e){
			let gridInfoOption = trans.getOption("gridInfo") || {};
			gridInfoOption.viewTrail = !gridInfoOption.viewTrail
			this.checked = gridInfoOption.viewTrail;
			trans.setOption("gridInfo", gridInfoOption);
			trans.grid.render();
		}
	}));

	ui.openMenuAtElm($elm, ui.menus.gridInfo);
}


// ==============================================================
// 			PANE EXPANDER
// ==============================================================
ui.fixKeyCellOverflow = function() {
	console.log("fix overflow. Col width :", trans.grid.getColWidth(0), "range left :", window.innerWidth - $("#menuPanel")[0].getBoundingClientRect().width + 40);
	console.log("manual calculation width :", $("#table .ht_clone_top_left_corner .wtSpreader thead th:eq(1)")[0].getBoundingClientRect().width);
	if (trans.grid.getColWidth(0) <= (window.innerWidth - $("#menuPanel")[0].getBoundingClientRect().width + 40)) return ;
	console.log("fixing overflow");
	trans.grid.setColWidth(0, 150)
}

ui.fixCellInfoSize = function() {
	return ;
	// var mainPanelHeight = $(".panel-wrapper").eq(0).outerHeight();
	// var subs = mainPanelHeight +82;
	// $("#cellSelectionInfo").css("height", "calc(100vh - "+subs+"px)");
}


// ==============================================================
// ROW PROPERTIES WINDOW
// ==============================================================

ui.openRowProperties = function(range, options) {
	options = options||{};
	//ui.windows['rowProperties'] = window.open("rowProperties.html", "rowProperties", "");
	//$(".menu-button.addNote").addClass("checked");	
	
	range = range||trans.grid.getSelectedRange();
	if (typeof range == 'undefined') return false;
	
	var highlightedRow = range[0].highlight.row;
	var keyText = trans.grid.getData()[highlightedRow][0];
	var contextList = [];
	if (trans.project !== 'undefined') {
		try {
			contextList = trans.project.files[trans.getSelectedId()].context[highlightedRow];
		} catch (error) {
			console.log(error);
		}
	}
	
	var contextTemplate = "";
	contextList = contextList||[];
	for (var i=0; i<contextList.length; i++) {
		contextTemplate+= "<li>"+contextList[i]+"</li>";
	}
	
	var $container = $("#rowProperties");
	$container.find(".rowProp_fileName").html(trans.getSelectedId());
	$container.find(".rowProp_location").html(highlightedRow);
	$container.find(".rowProp_keyText").html(keyText);
	$container.find(".rowProp_contextList").html(contextTemplate);
	$container.find(".rowProp_bestTranslatiion").html(trans.getTranslationFromRow(trans.grid.getData()[highlightedRow]));

	
	if ($("#rowProperties").hasClass("initialized") == false) {
		$("#rowProperties").dialog({
			autoOpen: false,
			title: "Row Properties",
			modal:true,
			width:Math.round($(window).width()/100*50),
			height:Math.round($(window).height()/100*50),
			minWidth:600,
			minHeight:460,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Close",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}
			]
		});	
		$("#rowProperties").addClass("initialized");
	}
	
	$("#rowProperties").dialog("open");

	/**
	 * Triggered when dialog Row Properties Opened
	 * @event ui#dialogRowPropertiesOpened
	 */
	this.trigger("dialogRowPropertiesOpened", $container);
	return ($("#rowProperties"));
	
}
// ==============================================================
// PROJECT PROPERTIES WINDOW
// ==============================================================

ui.drawTranslatorOptions = function($parent) {
	for (var i=0; i<trans.translator.length; i++) {
		var id = trans.translator[i];
		var engine = trans.getTranslatorEngine ? trans.getTranslatorEngine(id) : trans[id];
		if (!engine) continue;
		$parent.append("<option value='"+id+"'>"+engine.name+"</option>");
	}
	return $parent;
}

ui.drawLanguageOptions = function($parent) {
	for (var code in consts.languages) {
		$parent.append("<option value='"+code+"'>"+consts.languages[code]+"</option>");
	}
	return $parent;
}


ui.openProjectProperties = async function(options) {
	options = options||{};

	var $container = $("#projectProperties");
	$container.find(".fileProp_id").html();


	trans.project.options = trans.project.options||{};
	trans.project.cache = trans.project.cache||{};
	if ($container.hasClass("initialized") == false) {
		// initializing translator field
		var $translator = $container.find(".projProp_translator");
		ui.drawTranslatorOptions($("#translatorEngines"));
		$translator.off("change");
		$translator.on("change", function(e) {
			trans.project.options.translator = $(this).val();
		});
		
		var $sl = $container.find(".projProp_langFrom");
		var $tl = $container.find(".projProp_langTo");
		ui.drawLanguageOptions($("#languages"));
		$sl.off("change");
		$sl.on("change", function(e) {
			trans.project.options.sl = $(this).val();
			trans.trigger("languageChange", [$sl.val(), $tl.val()])
		});		
		$tl.off("change");
		$tl.on("change", function(e) {
			trans.project.options.tl = $(this).val();
			trans.trigger("languageChange", [$sl.val(), $tl.val()])
		});
		
		$container.find(".projProp_title").on("blur paste", function() {
			trans.project.gameTitle = $(this).val();
			$(".footer-content.footer2 > span").html(trans.project.gameTitle);
		})
		
		$container.find(".editableHtmlFld").on("blur paste", function() {
			let $html = $(this);
			$html.find("style, script, iframe, webview").remove();
			$html.find("a").addClass("external")
			$html.find("a").attr("external", "")
			trans.project.options.info = $html.html()
		})
		
		$container.find(".displayInfo").on("input", function() {
			trans.project.options.displayInfo = $(this).prop("checked")
		})
		
		$container.dialog({
			autoOpen: false,
			title: "Project Properties",
			modal:true,
			width:Math.round($(window).width()/100*50),
			height:Math.round($(window).height()/100*50),
			minWidth:600,
			minHeight:460,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Close",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}
			]
		});	

		$container.find("a.externalLink, a[external]").on("click", function(e) {
			console.warn("clicked")
			e.preventDefault();
			nw.Shell.openExternal($(this).attr("href"));
		})
		
		$container.find("#projPropWrapper").tabs();
		$container.addClass("initialized");
	}

	$container.find(".projProp_fileLoc").html(trans.currentFile);
	ui.clearFieldInfo($container.find(".projProp_fileLoc"));
	if (trans.currentFile) {
		if (common.isExist(trans.currentFile) == false) {
			ui.setFieldInfo($container.find(".projProp_fileLoc"), "Path not found! Effect: export & inject procedure will fail.", "warning");
		}
	}
	
	
	$container.find(".projProp_id").html(trans.project.projectId);
	$container.find(".projProp_date").html(trans.project.buildOn);
	$container.find(".projProp_engine").html(trans.project.gameEngine);
	$container.find(".projProp_editorName").html(trans.project.editorName || "");
	$container.find(".projProp_editorVersion").html(trans.project.editorVersion || "");
	$container.find(".projProp_parser").html(trans.project.parser || "");
	$container.find(".projProp_parserVersion").html(trans.project.parserVersion || "");
	
	// writable
	$container.find(".projProp_title").val(trans.project.gameTitle);
	$container.find(".projProp_loc").val(trans.project.loc);
	$container.find(".projProp_devPath").val(trans.project.devPath || "");
	$container.find(".projProp_translator").val(trans.project.options.translator);
	$container.find(".projProp_stagingPath").val(trans.project.cache.cachePath);
	ui.clearFieldInfo($container.find(".projProp_stagingPath"));
	if (trans.project.cache.cachePath) {
		if (common.isDir(trans.project.cache.cachePath) == false) {
			ui.setFieldInfo($container.find(".projProp_stagingPath"), `Path not found! Effect: export & inject procedure will fail. 
			<a href="" class="icon-help-circled externalLink" external>Help</a>`, "warning");
		}
	}
	
	// Stats
	
	trans.evalTranslationProgress();
	var stats = trans.getStats();
	console.log(stats);
	stats.organicPercent = Math.round((stats.organicPercent*10)/10);
	$container.find("#projProp-stats [data-field]").each(function() {
		var key = $(this).attr("data-field");
		console.log("key", key);
		if (typeof stats[key] == "undefined") return;
		console.log("Assigning:", key);
		$(this).html(stats[key]);
	})
	$container.find("#projProp-stats [data-field=percent]").attr("value", stats.percent);
	$container.find("#projProp-stats .percentDisplay").text(Math.round(stats.percent*10)/10);


	// info
	$container.find(".editableHtmlFld").html(trans.project.options.info);
	$container.find(".displayInfo").prop("checked", trans.project.options.displayInfo || false)

	$container.dialog( "instance" ).uiDialog.find(".ui-dialog-title").html("<i class='icon-cog'></i>"+"Project Properties : "+trans.project.gameTitle );




	var $loc = $container.find(".projProp_loc");
	var evalProjectLoc = async ($elm)=>{
		if (await common.isDirectory($elm.val()) == false) {
			$elm.addClass("error");
			$elm.closest(".dialogSectionBlock").find(".dialogInfo").removeClass("hidden");
		} else {
			$elm.removeClass("error");
			$elm.closest(".dialogSectionBlock").find(".dialogInfo").addClass("hidden");
		}
	}

	var $dvFields = $(".dvField_isRendered");
	$dvFields.each(function() {
		evalProjectLoc($(this));
	})

	if ($container.hasClass("isInitialized") == false) {
		$loc.on("change", function() {
			trans.project.loc = $(this).val();
			evalProjectLoc($(this));
		})

		$container.find(".projProp_devPath").on("change", function() {
			trans.project.devPath = $(this).val();
			evalProjectLoc($(this));
		});

		$container.find(".projProp_stagingPath").on("change", function() {
			trans.project.cache = trans.project.cache || {}
			trans.project.cache.cachePath = $(this).val();
			//evalProjectLoc($(this));
		});
		$container.find(".openStagingDir").on("click", async function() {
			var stagePath = nwPath.resolve(trans.project.cache.cachePath);
			if (!await common.isDir(stagePath)) return alert("Stage path do not exist!");
			stagePath = nwPath.join(stagePath, "gameInfo.json");

			nw.Shell.showItemInFolder(stagePath)
		});

		$container.find(".editFunction").on("click", async function() {
			var $this = $(this)
			const workspace = $this.attr("for");
			trans.project.options ||= {}
			trans.project.options.hooks ||= {}
			
			await ui.openScriptEditor("scriptEditor", 
				{
					"workspaceType":"hook", 
					"workspace": workspace, 
					readOnly:false, 
					script: trans.project?.options?.hooks[workspace] || "", 
					onSave: (script)=> {
						console.log("saved", script);
						common.setPropertyByPath(trans.project.options, `hooks.${workspace}`, script, true)
					}
				});
		});
	}



	$container.dialog("open");
	$container.addClass("isInitialized");
	return $container;
	
}

ui.setFieldInfo = function($elm, msg, type) {
	var $template = $elm.parent().find(".fieldInfo");
	if ($template.length == 0) {
		$template = $("<div class='fieldInfo'></div>");
		$elm.parent().append($template)		
	}
	if (type == "warning") {
		$template.addClass("icon-attention");
	} else if (type == "error")	{
		$template.addClass("icon-minus-circled");
	} else {
		$template.addClass("icon-info-circled");
	}
	
	$template.html(msg);

}

ui.clearFieldInfo = function($elm) {
	$elm.parent().find(".fieldInfo").remove();
}

ui.openDialogSetDevPath = async function(defPath) {
	defPath = defPath || trans.project.devPath || "";

	return new Promise((resolve, reject)=> {
		var $popup = $("#ui_selectDevPath");
		if ($popup.length == 0) {
			var dvField = new DVField();
			$popup = $("<div id='ui_selectDevPath'></div>");
			var $content = ($(`
			<div>
				<h2>${`Select dev folder`}</h2>
				<div>
					${`Where is the translated game's directory located at?<br />This is the same folder with the destination directory when injecting your game.`}
				</div>
				<label>
				<input type="dvSelectPath" nwdirectory class="fullWidth devPath" value="${defPath}" />
				</label>
			</div>`));

			console.log("rendering ", $popup);
			dvField.renderSelectPath($content.find("[type=dvSelectPath]"));
	
			$popup.empty();
			$popup.append($content);
		}
		$popup.dialog({
			title: "Select folder",
			autoOpen: false,
			modal:true,
			width:640,
			height:240,
			minWidth:640,
			minHeight:240,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			close:function( event, ui ) {
				resolve(trans.project.devPath || "");
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},
				{
					text: "Submit",
					click: async function() {
						var $this = $(this)
						var to = $this.find(".devPath").val()
						if (!to) return alert("Path to the directory can not be empty!");
						if (await common.isDirectory(to) == false) return alert('Invalid directory:'+to);
						trans.project.devPath = to;
						$(this).dialog("close");
					}
				}
	
			]
		});	
		$popup.find(".devPath").val(defPath);
		$popup.dialog("open");
	})
}

// ==============================================================
// FILE PROPERTIES WINDOW
// ==============================================================

ui.openFileProperties = function(contextMenuId, options) {
	options = options||{};
	
	if (Boolean(contextMenuId) == false) {
		//$container.find(".rowProp_fileName").html(trans.getSelectedId());
		var $selected = $(".fileList .data-selector.context-menu-active");
		if ($selected.length < 1) return console.warn("unable to find selected document");
		if ($selected.length > 1) return console.warn("can not process more than one selected document");
		
		contextMenuId = $selected.attr("data-id");
	
	}
	var currentFile = trans.project.files[contextMenuId]||{};
	trans.evalTranslationProgress([contextMenuId]);

	var $container = $("#fileProperties");
	$container.find(".fileProp_id").html(contextMenuId);
	$container.find(".fileProp_path").html(currentFile.path);
	$container.find(".fileProp_originalFormat").html(currentFile.originalFormat);
	$container.find(".fileProp_dataLength").html(currentFile.data.length);
	$container.find(".fileProp_translatedLength").html(currentFile.progress.translated);

	if ((currentFile.progress.length||0) === 0) {
		$container.find(".translatedPercent").html(t("empty"));
		$container.find(".translatedPercent").css("background", "#9e9e9e");
	} else {
		$container.find(".translatedPercent").html(Math.round(currentFile.progress.percent)+"%");
		$container.find(".translatedPercent").css("background", 'linear-gradient(to right, rgb(49, 89, 249) 0%, rgb(49, 89, 249) '+currentFile.progress.percent+'%, rgb(255, 0, 4) '+currentFile.progress.percent+'%, rgb(255, 0, 4) 100%');
	}

	
	if ($container.hasClass("initialized") == false) {
		$container.dialog({
			autoOpen: false,
			title: "File Properties",
			modal:true,
			width:Math.round($(window).width()/100*50),
			height:Math.round($(window).height()/100*50),
			minWidth:600,
			minHeight:460,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Close",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}
			]
		});	
		$container.addClass("initialized");
	}

	$container.dialog( "instance" ).uiDialog.find(".ui-dialog-title").html("<i class='icon-cog'></i>"+"File Properties : "+contextMenuId );

	$container.dialog("open");
	return $container;
	
}


// ==============================================================
// OPTIONS WINDOW
// ==============================================================

ui.openOptionsWindow = function(options) {
	options = options||{};
	// Deep link support: options.tab selects a specific panel in the options
	// window (e.g. "dslr" for the translation engine setup). If the window is
	// already open, just switch to that tab instead of reloading it.
	var existing = ui.windows['options'];
	if (existing && !existing.closed) {
		try {
			if (options.tab && typeof existing.optionsFocusTab === "function") {
				if (existing.optionsFocusTab(options.tab, options.filter) !== false) {
					existing.focus();
					return;
				}
			} else {
				existing.focus();
				return;
			}
		} catch (e) { console.warn("Could not focus options tab:", e); }
	}
	var url = "www/options.html";
	if (options.tab) url += "#tab=" + encodeURIComponent(options.tab);
	if (options.filter) url += "&filter=" + encodeURIComponent(options.filter);
	// Open hidden and reveal once loaded, so the window does not flash the
	// default white canvas while its scripts load.
	nw.Window.open(url, {
		id: "options",
		frame: false,
		show: false,
		width: 1200,
		height: 850,
		min_width: 800,
		min_height: 600,
		resizable: true
	}, function(thisWin) {
		if (!thisWin) return;
		ui.windows['options'] = thisWin.window;
		// The nw handle lets the shutdown path force-close this window synchronously
		// (see the child-window loop in the main window's close handler).
		try { thisWin.window.__nwHandle = thisWin; } catch (e) {}
		// options.js reveals the window itself, once its UI is built and a frame
		// has painted (so it never flashes white). This is only a safety net for
		// the case where that never runs.
		setTimeout(function() {
			try { thisWin.show(); } catch (e) {}
			try { thisWin.focus(); } catch (e) {}
		}, 15000);
	});
}

// ==============================================================
// TRIM DIALOG WINDOW
// ==============================================================

ui.openTrimWindow = function(options) {
	options = options||{};
	var $container
	if ($("#trimDialogWindow").length == 0) {
		// initializing
		$("#template").append('<div id="trimDialogWindow">\
			<div class="dialogGuide"><img src="img/guide-trim.png"></div>\
			<div class="dialogContent">\
			<h2>'+"Target column"+'</h2>\
			<div class="columnSelector"></div>\
			</div>\
		</div>');
		
		$container = $("#trimDialogWindow");
		
		
		$container.dialog({
			autoOpen: false,
			title: "Trim Whitespaces",
			modal:true,
			width:Math.round($(window).width()/100*50),
			height:Math.round($(window).height()/100*50),
			minWidth:600,
			minHeight:460,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},
				{
					text: "Ok",
					icon: "ui-icon-close",
					click: function() {
						var selectedValue = $("#trimDialogWindow select").val();
						if (Array.isArray(selectedValue) == false) return alert("Please select a column");
						
						var confirmation = confirm("Are you sure want to trim the whitespaces on selected column?\nThis action can not be undone!");
						if (confirmation) {
							ui.showBusyOverlay();
							var selectedFile = trans.getCheckedFiles();
							if (selectedFile.length == 0) selectedFile = trans.getAllFiles();
							
							trans.trimTranslation(selectedFile, selectedValue);
							$(this).dialog("close");
							ui.hideBusyOverlay();
						}
					}
				}
			]
		});	
	}
	
	$container = $("#trimDialogWindow");
	$container.find(".columnSelector").html(ui.generateColMultiSelector({skipFirstCol:true}));
	$container.dialog("open");
	return $container;
	
}


ui.openPaddingWindow = function(options) {
	options = options||{};
	var $container;
	if ($("#paddingDialogWindow").length == 0) {
		// initializing
		$("#template").append('<div id="paddingDialogWindow">\
			<div class="dialogGuide"><img src="img/guide-padding.png"></div>\
			<div class="dialogContent">\
			<h2>'+"Target column"+'</h2>\
			<div class="columnSelector"></div>\
			</div>\
		</div>');
		
		$container = $("#paddingDialogWindow");
		
		
		$container.dialog({
			autoOpen: false,
			title: "Auto Padding",
			modal:true,
			width:Math.round($(window).width()/100*50),
			height:Math.round($(window).height()/100*50),
			minWidth:600,
			minHeight:460,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},
				{
					text: "Ok",
					icon: "ui-icon-close",
					click: function() {
						var selectedValue = $("#paddingDialogWindow select").val();
						if (Array.isArray(selectedValue) == false) return alert("Please select a column");
						
						var confirmation = confirm("Are you sure want commit autopadding on selected column?\nThis action can not be undone!");
						if (confirmation) {
							ui.showBusyOverlay();
							var selectedFile = trans.getCheckedFiles();
							if (selectedFile.length == 0) selectedFile = trans.getAllFiles();
							
							trans.paddingTranslation(selectedFile, selectedValue);
							$(this).dialog("close");
							ui.hideBusyOverlay();
						}
					}
				}
			]
		});	
	}
	
	$container = $("#paddingDialogWindow");
	$container.find(".columnSelector").html(ui.generateColMultiSelector({skipFirstCol:true}));
	$container.dialog("open");
	return $container;
	
}


// ========================================================
// CURRENT CELL'S TEXT EDITOR
// Background Layer
// ========================================================
ui.currentCellTextOptionsOpen = function(options) {
	console.log("Opening ui.currentCellTextOptionsOpen");
	options = options||{};
	
	sys.config.backgroundHelper = sys.config.backgroundHelper||[];
	var applyChange = function($element) {
		$element = $element || $("#currentCellTextOptions");
		let $ctMarkers = $element.find("#currentCellTextOptions_marker .ctMarkers");
		
		var ctOptions = [];
		for (var index=0; index<$ctMarkers.length; index++) {
			var $thisElm = $ctMarkers.eq(index);

			ctOptions.push({
				at: $thisElm.find(".ctMarkers_number").val(),
				color: $thisElm.find(".ctMarkers_color").val(),
				unit: $thisElm.find(".ctMarkers_unit").val()
			})
		}
		
		console.log(ctOptions);
		ui.createBackgroundHelper($("#currentCellText"), ctOptions);
		sys.config = sys.config||{};
		sys.config.backgroundHelper = sys.config.backgroundHelper || [];
		sys.config.backgroundHelper = ctOptions;
		return ctOptions;
	}
	var $container
	if ($("#currentCellTextOptions").length == 0) {
		// initializing
		$container = $(`<div id='currentCellTextOptions'>
		<div id='currentCellTextOptionsTabs'>
			<ul>
				<li><a href='#currentCellTextOptions_marker'>`+"Markers"+`</a></li>
				<li><a href='#currentCellTextOptions_options'>`+"Options"+`</a></li>
			</ul>
			<div id='currentCellTextOptions_marker'>
				<div class='ct_marker_info'>
					<div class="blockBox infoBlock withIcon">
					Markers are visual guidelines for the number of characters in a line.<br />
					The marker will only be visible if wordwrap in the text area is disabled.
					</div>
				</div>
				<div class='ct_marker_container'></div>
				<div class='ct_marker_tools'>
					<button class='ct_marker_tools_add  icon-plus-circled'>Add</button>
					<button class='ct_marker_tools_clear icon-cancel-circled'>Clear all</button>
				</div>
			</div>
			<div id='currentCellTextOptions_options'>
				<div class="dialogSectionBlock">
					<label><input type="checkbox" class="enableAutoComplete" /> <span>Enable suggestion</span></label>
				</div>
			</div>
		</div>
		</div>`);
		
		// setting up default
		$container.find('.enableAutoComplete').on("input", function() {
			ui.autoCompleteSet($(this).prop('checked'));
			if (ui.autoCompleteIsEnabled() == false) ui.autoCompleteClear();
			
		})

		$container.find('[data-autoset]').on("input", function() {
			var $this = $(this)
			var value = $this.val();
			var configPath = $this.attr("data-autoset");
			if (!configPath) return;
			if ($this.attr("data-type") == "float") {
				value = parseFloat(value);
			} else if ($this.attr("data-type") == "int") {
				value = parseInt(value);
			}

			common.varAsStringSet(configPath, value, true);
		})
		
		$("#template").append($container);
		$container.find("#currentCellTextOptionsTabs").tabs();
		
		// drawing tabs content
		var $markerTemplate = $("<div class='ctMarkers'>\
			<label><span class='markerLabel'>"+"Mark at"+"</span><span><input type='number' data-type='at' min='0' value='0' class='ctInput ctMarkers_number' /></span></label>\
			<label><span class='markerLabel'>"+"Units"+"</span><span><select data-type='unit' class='ctInput ctMarkers_unit' ><option value='0'>"+"Half width character (ie. Alphabet, etc)"+"</option><option value='1'>"+"Full width character (ie. Hiragana, Kanji, 漢字, etc)"+"</option></select></span></label>\
			<label><span class='markerLabel'>"+"Color"+"</span><span><input type='color' data-type='color' class='ctInput ctMarkers_color' value='#FF0000' /></span></label>\
			<label class='ctToolbar'><button class='removeMarker icon-cancel-circled'>"+"Remove"+"</button></label>\
		</div>");
		

		
		// events
		$markerTemplate.find(".removeMarker").on("click", function() {
			$(this).closest(".ctMarkers").remove();
			applyChange();
			
		});
		

		$markerTemplate.find(".ctInput").on("input", function() {
			applyChange();
			//console.log("changed");
		});
		
		$container.find(".ct_marker_tools_add").on("click", function(e) {
			var thisTemplate = $markerTemplate.clone(true, true);
			console.log(thisTemplate);
			console.log("marker container", $container.find(".ct_marker_container"));
			$container.find(".ct_marker_container").append(thisTemplate);
		})
		
		$container.find(".ct_marker_tools_clear").on("click", function(e) {
			$container.find(".ct_marker_container").empty();
			applyChange();
		})


		// initializing saved data
		console.log("Initializing saved data", sys.config.backgroundHelper)
		for (var i=0; i<sys.config.backgroundHelper.length; i++) {
			var $thisTemplate = $markerTemplate.clone(true, true);
			$container.find(".ct_marker_container").append($thisTemplate);
			
			$thisTemplate.find(".ctMarkers_number").val(sys.config.backgroundHelper[i].at);
			$thisTemplate.find(".ctMarkers_color").val(sys.config.backgroundHelper[i].color);
			
			console.log("Setting unit : ", sys.config.backgroundHelper[i].unit)
			$thisTemplate.find(".ctMarkers_unit").val(sys.config.backgroundHelper[i].unit);
		}		
		
		// registering popup
		
		$container.dialog({
			autoOpen: false,
			title: "Current Cell's Editor Options",
			modal:false,
			closeOnEscape:true,
			classes: {
				"ui-dialog": "highlight",
				"ui-dialog-titlebar": "hidden"
			},			
			width:$(".cellInfoPartsB").outerWidth(),
			height:Math.round($(window).height()/100*50),
			minWidth:320,
			minHeight:320,
			position: {
				my: "right bottom",
				at: "right top",
				of: ".cellInfoPartsB"
			},
			show: {
				effect: "slide",
				direction: "down",
				duration: 200
			},
			hide: {
				effect: "slide",
				direction: "down",
				duration: 200
			},
			close: function( event, ui ) {
				//console.log("closed");
				sys.saveConfig();
			},
			buttons:[
				{
					text: "Ok",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}
			]
		});	
		$container.addClass("initialized");
		
	}
	
	$container = $("#currentCellTextOptions");
	trans.project.options = trans.project.options || {}
	$container.find('.enableAutoComplete').prop('checked', ui.autoCompleteGet())
	$container.find('[data-autoset]').each(function() {
		var $this = $(this);
		try {
			if ($this.attr("type") == "checkbox") {
				$this.prop("checked", Boolean(common.varAsStringGet($this.attr('data-autoset'))));
			} else if (["INPUT", "SELECT"].includes($this.prop("tagName")) == false) {
				$this.text(common.varAsStringGet($this.attr('data-autoset')));
			} else {
				$this.val(common.varAsStringGet($this.attr('data-autoset')));
			}
		} catch (e) {
			// do nothing
		}
	});

	//$container.closest(".ui-dialog").addClass("hidden");
	$container.dialog( "option", "position", { my: "right bottom", at: "right top", of: ".cellInfoPartsB" } );
	$container.dialog( "option", "width", $(".cellInfoPartsB").outerWidth() );
	$container.dialog("open");

	return $container;
	
	
}


ui.calculateFontWidth = function($elm, unitType) {
	$elm = $elm || $("#currentCellText");
	//console.log("calculateFontWidth", arguments);
	unitType = parseInt(unitType) || 0;
	var font = "E";
	if (unitType) font = "字";
	//console.log(font);
	var $dummyElm
	if ($("#fontSampler__").length == 0) {
		$dummyElm = $("<div id='fontSampler__' style='position:absolute; top:-1000; left: -1000;'>"+font+"</div>");
	} else {
		$dummyElm = $("#fontSampler__");
	}
	
	$dummyElm.css("font-family", $elm.css("font-family"))
			.css("font-size", $elm.css("font-size"))
			.css("font-weight", $elm.css("font-weight"))
			.css("padding", "0px")
			.css("top", "-999px")
			.css("left", "-999px")
			.css("position", "absolute")
				
	//var calculatedWidth = $dummyElm.appendTo("body").width()/1;
	var calculatedWidth = $dummyElm.appendTo($elm.parent()).width()/1;
	//console.log("dummy elm total width : ", $dummyElm.width());
	$dummyElm.remove();
	//console.log("font size : ", $elm.css("font-size"));
	//console.log("font weight : ", $elm.css("font-weight"));
	//console.log(calculatedWidth);	
	return calculatedWidth;
}

ui.calculateFontHeight = function($elm) {
	$elm = $elm || $("#currentCellText");
	var $dummyElm;
	if ($("#fontSampler__").length == 0) {
		$dummyElm = $("<div id='fontSampler__' style='position:absolute; top:-1000; left: -1000;'>ABC<br />ABC<br />ABC<br />ABC<br />ABC<br />ABC<br />ABC<br />ABC<br />ABC<br />ABC</div>");
	} else {
		$dummyElm = $("#fontSampler__");
	}
	
	$dummyElm.css("font-family", $elm.css("font-family"))
			.css("font-size", $elm.css("font-size"))
			.css("font-weight", $elm.css("font-weight"))
			.css("line-height", $elm.css("line-height"))
			.css("padding", "0px")
			.css("top", "-999px")
			.css("left", "-999px")
			.css("position", "absolute")
				
	//var calculatedHeight = $dummyElm.appendTo("body").innerHeight()/10;
	var calculatedHeight = $dummyElm.appendTo($elm.parent()).innerHeight()/10;
	$dummyElm.remove();
	
	return calculatedHeight;
}

ui.clearBackgroundNumber = function($target) {
	$target = $target||$("#currentCellText");
	$target.css("background-image", "none");
	$target.css("background-repeat", "no-repeat");
	$target.css("background-attachment", "local");
	$target.css("padding-left", "4px");	
}

ui.generateBackgroundNumber = function($target, maxLine, force) {
	if ($("button.wordWrap").hasClass("checked") == false) {
		ui.clearBackgroundNumber();
		return;
	}
	
	$target = $target||$("#currentCellText");
	force = force || false;
	this._cache = this._cache || {};
	this._cache.bgNumbersSVG = this._cache.bgNumbersSVG || {};
	
	//var padding = 2;
	maxLine = maxLine || $target.val().split("\n").length || 100;
	// let fontFamily =$target.css("font-family");
	// let lineHeight =$target.css("line-height");
	// let fontSize =$target.css("font-size");
	// let paddingTop =$target.css("padding-top");
	// let fontWeight =$target.css("font-weight");
	let intPaddingTop = parseInt($target.css("padding-top"));
	var marginLeft = "8";
	

	
	var aspect = $target.css("font-size");
	var svgEncoded;
	if (Boolean(this._cache.bgNumbersSVG[maxLine+"-"+aspect]) == false || force == true) {

		var calculatedHeight = ui.calculateFontHeight($target);
		var adjustment = -((calculatedHeight/2)-6);
		var textContent = "";
		for (var i=0; i<maxLine; i++) {
			var drawedLine = i+1;
			var thisCoord = ((calculatedHeight*i)+calculatedHeight+intPaddingTop)+adjustment;
			//console.log("drawing: "+' <text x="'+marginLeft+'" y="'+thisCoord+'px"> '+drawedLine+'</text>\n');
			textContent += ' <text fill="#888888" x="'+marginLeft+'" y="'+thisCoord+'px"> '+drawedLine+'</text>\n';
		}
		var height = thisCoord+1000;
		
		var svg = '<svg xmlns="http://www.w3.org/2000/svg" height="'+height+'" width="45px">\
		<style>\
			/* <![CDATA[ */\
			text {\
				fill:"red";\
				font-size: 11pt;\
				font-family: "Courier New";\
				background-color: "#ff0000";\
			}\
			/* ]]> */\
		</style>\
			<rect width="40px" height="'+height+'" style="fill:rgba(255,255,255,.1)" />\
			'+textContent+'\
		  	<line x1="40px" y1="0" x2="40px" y2="'+height+'" style="stroke:rgba(128,128,128,1);stroke-width:1" />\
		</svg>';
		svgEncoded = btoa(svg);
		this._cache.bgNumbersSVG[maxLine+"-"+aspect] = svgEncoded;
	} else {
		svgEncoded = this._cache.bgNumbersSVG[maxLine+"-"+aspect];
	}

	var svgBody = "url('data:image/svg+xml;base64,"+svgEncoded+"')";
	
	ui.appendBackground($target, {
		"background-image" : svgBody,
		"background-repeat" : "no-repeat", 
		"background-attachment" : "local"
	}, 0);
	
	$target.css("padding-left", "48px");

}

ui.createBackgroundNumberDelayed = function(delay, force) {
	var $that = $("#currentCellText");

	delay = delay || 200;
	ui._cache = ui._cache || {};
	ui._cache.lastCellLineNumber = ui._cache.lastCellLineNumber || 0;
	if (ui._cache.bgNumberProcessing) {
		clearTimeout(ui._cache.bgNumberProcessing);
		ui._cache.bgNumberProcessing = setTimeout(function() {
			
			var currentLineNumber = $that.val().split("\n").length;
			if (ui._cache.lastCellLineNumber !== currentLineNumber) {
				ui._cache.lastCellLineNumber = currentLineNumber;
				ui.generateBackgroundNumber($that, currentLineNumber);
			}
			
			//console.log("input delayer triggered");
			ui._cache.bgNumberProcessing = undefined;
		}, delay);		

		return;
	}
	
	ui._cache.bgNumberProcessing = setTimeout(function() {
		
		var currentLineNumber = $that.val().split("\n").length;
		if (ui._cache.lastCellLineNumber !== currentLineNumber) {
			ui._cache.lastCellLineNumber = currentLineNumber;
			ui.generateBackgroundNumber($that, currentLineNumber);
			
		}
		
		//console.log("input delayer triggered");
		ui._cache.bgNumberProcessing = undefined;
	}, delay);
	

}

ui.clearBackgroundHelper = function($target) {
	$target = $target || $("#currentCellText");
	ui.appendBackground($("#currentCellText"), {
		"background-image" : "none",
		"background-repeat" : "repeat-y", 
		"background-attachment" : "local",
		"background-position": "0px 0px"
	}, 1);	

}

ui.createBackgroundHelper = function($target, atText) {
	$target = $target || $("#currentCellText");
	//atText = atText||1;
	if (typeof atText == 'number') {
		atText = [{
			at:atText,
			color:"rgba(255,0,0,0.5)",
			unit:0
		}];
	}
	
	if (atText.length < 1) {
		ui.clearBackgroundHelper();
		return;
	}
	
	var initialPadding = parseInt($("#currentCellText").css("padding-left"))||48;
	if ($(".currentCellTextCtrl .wordWrap").hasClass("checked")) {
		initialPadding = 48;
	}
	var fontWidth = [];

	var maxWidth = 200;
	var svgLine = "";
	for (var i=0; i<atText.length; i++) {
		var thisUnit = atText[i].unit || 0;
		fontWidth[thisUnit] = fontWidth[thisUnit] || ui.calculateFontWidth($target, thisUnit);
		var rangeLeft = (fontWidth[thisUnit]*atText[i].at)-1;
		if (maxWidth < rangeLeft+200 ) maxWidth = rangeLeft+200;
		
		console.log("rangeLeft", "("+fontWidth[thisUnit]+"*"+atText[i].at+")");
		atText[i].color = atText[i].color||"rgba(255,0,0,0.5)";
		svgLine += '<line x1="'+rangeLeft+'" y1="0" x2="'+rangeLeft+'" y2="200" style="stroke:'+atText[i].color+';stroke-width:1" stroke-dasharray="4 1" />\n';
	}
	
	var svg = '<svg  xmlns="http://www.w3.org/2000/svg" height="200" width="'+maxWidth+'">\n\
	<line x1="0" y1="0" x2="0" y2="200" style="stroke:rgba(128,128,128,1);stroke-width:1" stroke-dasharray="4 1" />\n\
	'+svgLine+'\n\
	</svg>'
//	console.log(svg);
	var svgEncoded = btoa(svg);	
	var svgBody = "url('data:image/svg+xml;base64,"+svgEncoded+"')";
	
	
	ui.appendBackground($target, {
		"background-image" : svgBody,
		"background-repeat" : "repeat-y", 
		"background-attachment" : "local",
		"background-position": initialPadding+"px 0px"
	}, 1);	
}

ui.backgroundHelperInitialize = function(conf) {
	// load config to background helper
	if (this.backgroundHelperIsInitialized) return;
	sys.config = sys.config || {};
	sys.config.backgroundHelper = sys.config.backgroundHelper || {};
	conf = conf || sys.config.backgroundHelper ||[];
	
	if (Array.isArray(conf) == false) return;
	ui.createBackgroundNumberDelayed();

	ui.createBackgroundHelper( $("#currentCellText"), conf);
	this.backgroundHelperIsInitialized = true;
	
}

ui.redrawBackgroundHelper = function() {
	sys.config = sys.config || {};
	sys.config.backgroundHelper = sys.config.backgroundHelper || {};
	var conf = conf || sys.config.backgroundHelper ||[];	
	if (Array.isArray(conf) == false) return;
	ui.createBackgroundNumberDelayed();

	ui.createBackgroundHelper( $("#currentCellText"), conf);	
}

ui.appendBackground = function($target, bgOptions, layer) {
	if ($target.length <  1) return $target;
	bgOptions = bgOptions||{};
	layer = layer||0;
	if (Boolean(bgOptions['background-image']) == false) return $target;
	
	var pseudoName = "bgPseudo_"+$target.attr("id");
	var $pseudoElm = $("#"+pseudoName);
	if ($pseudoElm.length == 0) {
		$pseudoElm = $("<style id='"+pseudoName+"'></style>");
		$("body").append($pseudoElm);
	}
	
	
	//console.log("pass here");
	var cssBG = $target.data("cssBG") || {};
	for (let bgObject in bgOptions) {
		cssBG[bgObject] = cssBG[bgObject]||[];
		cssBG[bgObject][layer] = bgOptions[bgObject];
	}
	
	// determine the length of cssBG
	var maxLength = cssBG['background-image'].length;
	//console.log("maxLength", maxLength);
	// fill the gap
	for (let index =0; index<maxLength; index++) {
		//console.log('background-image', index, cssBG['background-image'][index]);
		if (cssBG['background-image'][index]) continue;
		cssBG['background-image'][index] = "none";
	}
	if (cssBG['background-position']) {
		for (let index =0; index<maxLength; index++) {
			if (cssBG['background-position'][index]) continue;
			cssBG['background-position'][index] = "0px 0px";
		}	
	}	
	if (cssBG['background-repeat']) {
		for (let index =0; index<maxLength; index++) {
			if (cssBG['background-repeat'][index]) continue;
			cssBG['background-repeat'][index] = "no-repeat";
		}	
	}

	// others
	for (let bgObject in cssBG) {
		if (Array.isArray(cssBG[bgObject]) == false ) continue;
		if (bgObject == 'background-image' || bgObject == 'background-position' || bgObject == 'background-repeat') continue;
		for (var index =0; index<maxLength; index++) {
			if (cssBG[bgObject][index]) continue;
			cssBG[bgObject][index] = "unset";
		}
	}	
	
	$target.data("cssBG", cssBG);
	
	
	//console.log("cssBG : ", cssBG);
	//var cssText = "";
	for (let bgObject in cssBG) {
		if (Array.isArray(cssBG[bgObject]) == false ) continue;
		//console.log("Setting : ", bgObject, "value : ", cssBG[bgObject].join(","));
		$target.css(bgObject, cssBG[bgObject].join(","));
		//cssText += bgObject+":"+cssBG[bgObject].join(",")+";"
	}
	//console.log("#"+pseudoName+"{"+cssText+"}");
	//$pseudoElm.html("#"+$target.attr("id")+"{"+cssText+"}");
	
}

// ==============================================================
// Term of use WINDOW
// ==============================================================
ui.openToU = function(options) {
	options = options||{};
	var $container
	if ($("#ToU").length == 0) {
		// initializing
		$("#template").append('<div id="ToU">\
			<div class="dialogGuide"><img src="img/guide-padding.png"></div>\
			<div class="dialogContent">\
			<h2>Target column</h2>\
			<div class="columnSelector"></div>\
			</div>\
		</div>');
		
		$container = $("#ToU");
		
		
		$container.dialog({
			autoOpen: false,
			title: "Auto Padding",
			modal:true,
			width:Math.round($(window).width()-80),
			height:Math.round($(window).height()-80),
			minWidth:600,
			minHeight:460,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},
				{
					text: "Ok",
					icon: "ui-icon-close",
					click: function() {
						var selectedValue = $("#ToU select").val();
						if (Array.isArray(selectedValue) == false) return alert("Please select a column");
						
						var confirmation = confirm("Are you sure want commit autopadding on selected column?\nThis action can not be undone!");
						if (confirmation) {
							ui.showBusyOverlay();
							var selectedFile = trans.getCheckedFiles();
							if (selectedFile.length == 0) selectedFile = trans.getAllFiles();
							
							trans.paddingTranslation(selectedFile, selectedValue);
							$(this).dialog("close");
							ui.hideBusyOverlay();
						}
					}
				}
			]
		});	
	}
	
	$container = $("#ToU");
	$container.find(".columnSelector").html(ui.generateColMultiSelector({skipFirstCol:true}));
	$container.dialog("open");
	return $container;
	
}

// ==============================================================
//
// 			F R E E  E D I T I N G   C O M P O N E N T
//
// ==============================================================

ui.generateDirSelector = function() {
	var $container = $("#directoryList");
	if (!trans.project) return;
	if (!trans.project.files) return;
	var reg = {};
	for (var filename in trans.project.files) {
		if (!trans.project.files[filename].dirname) continue;
		if (reg[trans.project.files[filename].dirname]) continue;
		reg[trans.project.files[filename].dirname] = true;
		let $template = $('<option value="'+common.htmlEntities(trans.project.files[filename].dirname)+'">')
		$container.append($template);
	}
	return $container;
}

ui.addNewObjectDialog = function(defaultDir, options) {
	options = options || {};
	var $dialog = $("#dialogAddObject");
	defaultDir = defaultDir || ""
	$("#addObjDirName").val(defaultDir);
	ui.generateDirSelector();
	if ($dialog.hasClass("initialized") == false) {
		$dialog.dialog({
			autoOpen: false,
			modal:true,
			//width:Math.round($(window).width()/100*80),
			//height:Math.round($(window).height()/100*80),
			width:800,
			height:460,
			minWidth:600,
			minHeight:460,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Cancel",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				},			
				{
					text: "Create",
					icon: "ui-icon-plus",
					click: function() {
						var filename = $('#addObjName').val()
						var dirname = $('#addObjDirName').val()
						var options = {}
						
						var result = trans.createFile(filename, dirname, options);
						if (result.error) return alert(result.msg);
						$(this).dialog( "close" );
						
					}
				}

			]
		});	
		$dialog.addClass("initialized");
	}
	
	$dialog.dialog("open");
	return $dialog;		
	
}




// ==============================================================
//
// 						M A I N   M E N U
//
// ==============================================================
ui.MainMenu = function() {

}

ui.MainMenu.prototype.drawRecentFiles = function() {
	if (typeof sys.config == 'undefined') return false;
	if (typeof sys.config.historyOpenedFiles == 'undefined') return false;
	
	var childTemplate = $("#mainMenu .recentFiles ul li").eq(0).clone(true, true);
	childTemplate.removeClass("ui-state-disabled");
	$("#mainMenu .recentFiles ul").empty();

	for (var id=0; id<sys.config.historyOpenedFiles.length; id++) {
		var thisTemplate = childTemplate.clone(true, true);
		//console.log(sys.config.historyOpenedFiles[id].path);
		thisTemplate.removeAttr("id");
		var num = id+1;
		thisTemplate.find("div").text(num+": "+common.cropLongText(sys.config.historyOpenedFiles[id].path, 70));
		thisTemplate.attr("title", sys.config.historyOpenedFiles[id].path);
		thisTemplate.data("id", id);
		$("#mainMenu .recentFiles ul").append(thisTemplate);
	}
}


ui.MainMenu.prototype.open = function() {
	if ($("#mainMenu").hasClass("rendered") == false) {
		this.init();
	} else {
		this.drawRecentFiles();
		$("#mainMenu").menu( "refresh" );
	}
	
	
	$("#mainMenu").removeClass("hidden");
	$("#mainMenu").show({
		effect:"fade",
		duration:100
	});
	
	$("#button-translatorplus").addClass("active");
	
	$(document).on("mouseup.mainmenu", function(e) {
		var container = $("#mainMenu");
		if (!container.is(e.target) && container.has(e.target).length === 0) {
			//container.addClass("hidden");
			//ui.closeMainMenu();
			ui.mainMenu.close();
			$(document).off("mouseup.mainmenu");
		}
	});		
}

ui.MainMenu.prototype.close = function() {
	$("#button-translatorplus").removeClass("active");

	$("#mainMenu").menu("collapseAll");
	$("#mainMenu").hide({
		effect:"fade",
		duration:100
	});
}

/**
 * @param  {} key
 * @param  {} object
 * {
 * 	id
 *  label
 * }
 */
ui.MainMenu.prototype.addChild = function(parentKey, object) {
	var $rootObj = $("#mainMenu");
	var $thisMenu = $rootObj.find("[data-menuid="+parentKey+"]");
	var $ul = $thisMenu.find(">ul")
	if ($ul.length == 0) {
		$ul = $("<ul></ul>");
		$thisMenu.append($ul);
	}

	var $newMenu = $(`<li><div>${object.label}</div></li>`);
	if (object.id) $newMenu.attr("data-menuid", object.id);
	$ul.append($newMenu);

	return $newMenu;
}

ui.MainMenu.prototype.addBefore = function(siblingKey, object) {
	var $rootObj = $("#mainMenu");
	var $thisMenu = $rootObj.find("[data-menuid="+siblingKey+"]");

	var $newMenu = $(`<li><div>${object.label}</div></li>`);
	if (object.id) $newMenu.attr("data-menuid", object.id);
	$thisMenu.before($newMenu);

	return $newMenu;
}

ui.MainMenu.prototype.addAfter = function(siblingKey, object) {
	var $rootObj = $("#mainMenu");
	var $thisMenu = $rootObj.find("[data-menuid="+siblingKey+"]");

	var $newMenu = $(`<li><div>${object.label}</div></li>`);
	if (object.id) $newMenu.attr("data-menuid", object.id);
	$thisMenu.after($newMenu);

	return $newMenu;
}

ui.MainMenu.prototype.unInit = function() {
	if ($("#mainMenu").hasClass("rendered") == false) return;
	var $mainMenu = $("#mainMenu");
	$mainMenu.menu("destroy");
	$mainMenu.removeClass("rendered");
}


ui.MainMenu.prototype.init = function() {
	if ($("#mainMenu").hasClass("rendered") == true) return false;
	this.drawRecentFiles();
	$("#mainMenu").removeClass("hidden");
	$("#mainMenu").menu({
		position: { 
			my: "right top", 
			at: "left+5 top"
		},
		select: function(e, thisUi) {
			console.log("menu selected");
			console.log(arguments);
			if (thisUi.item.hasClass('ui-state-disabled')) return false;
			if (thisUi.item.find(".ui-menu").length == 0) ui.mainMenu.close();
			
			if (thisUi.item.attr("data-delegate")) {
				$(thisUi.item.attr("data-delegate")).trigger("click");
				return true;
			}
			
			var initiate = thisUi.item.attr("data-initiate");
			switch(initiate) {
				case "openHistory" :
					if (typeof thisUi.item.data('id') == 'undefined') return alert("Unable to open that file!");
					if (typeof sys.config.historyOpenedFiles[thisUi.item.data('id')] == 'undefined') return alert("Unable to open that file!");
					var thisInfo = sys.config.historyOpenedFiles[thisUi.item.data('id')];
					var conf = confirm("Open "+thisInfo.path+"?\nTitle: "+thisInfo.gameTitle);
					if (conf) {
						sys.loadFileHistory(thisUi.item.data('id'));
					}
				break;
				case "wordwrap" :
					ui.batchWrapingDialog();
				break;
				case "trim" :
					ui.openTrimWindow();
				break;
				case "padding" :
					ui.openPaddingWindow();
				break;
				case "contextTool":
					ui.showBusyOverlay();
					setTimeout(function() {
						ui.contextToolDialog();
					}, 250);
				break;
				case "closeProject":
					// eslint-disable-next-line
					var conf = confirm("Are you sure want to close the project?\nYou will lost any unsaved changes!");
					if (!conf) return;
					trans.closeProject();
				break;
				case "exit" :
					// eslint-disable-next-line
					var conf = confirm("Are you sure want to exit SLR?\nYou will lost any unsaved changes!");
					if (!conf) return;
					window.close();
				break;
				
			}

			$(thisUi.item).trigger("select", thisUi);
			
		}
	});	
	$("#mainMenu").hide();
	$("#mainMenu").addClass("rendered");	
}
ui.mainMenu = new ui.MainMenu();

ui.getCurrentEditedCellElm = function() {
	if (typeof trans.lastSelectedCell == 'undefined') return false;
	if (ui.isRowVisible(trans.lastSelectedCell[0]) == false) return false;
	
	var rowOffset = trans.lastSelectedCell[0]-trans.grid.rowOffset();
	var colOffset = trans.lastSelectedCell[1]-trans.grid.colOffset();
	ui.selectedCell = $(".ht_master .htCore tbody tr").eq(rowOffset).find("td").eq(colOffset);
	return ui.selectedCell;
	
}


ui.togglePreWhitespaces = function(toggle) {
	if ($("#css_togglePreWhitespaces").length == 0) {
		$("head").append($('<style id="css_togglePreWhitespaces"></style>'))
	}
	var cssElm = $("#css_togglePreWhitespaces");
	sys.config.wordWrapTable = sys.config.wordWrapTable||false;

	
	if (typeof toggle == 'undefined') {
		if (cssElm.hasClass("active")) {
			toggle = false;
		} else {
			toggle = true;
		}		
	}
	
	if (Boolean(toggle) == false) {
		cssElm.text("#table tbody td {  }");
		cssElm.removeClass("active");
		trans.grid.render()
		$(".menu-button.wordWrapTable").removeClass("checked");
		sys.config.wordWrapTable = false;
		return false;
	} else {
		cssElm.text("#table tbody td { white-space: pre; }");
		cssElm.addClass("active");
		trans.grid.render()
		$(".menu-button.wordWrapTable").addClass("checked");
		
		sys.config.wordWrapTable = true;

		return true;
	}
}

ui.toggleMonoSpace = function(toggle) {
	if ($("#css_toggleMonoSpace").length == 0) {
		$("head").append($('<style id="css_toggleMonoSpace"></style>'))
	}
	var cssElm = $("#css_toggleMonoSpace");
	sys.config.monoSpaceTable = sys.config.monoSpaceTable||false;

	
	if (typeof toggle == 'undefined') {
		if (cssElm.hasClass("active")) {
			toggle = false;
		} else {
			toggle = true;
		}		
	}
	
	if (Boolean(toggle) == false) {
		cssElm.text("#table tbody td {  }");
		cssElm.removeClass("active");
		trans.grid.render();

		sys.config.monoSpaceTable = false;
		$(".menu-button.monospace").removeClass("checked");		
		return false;
	} else {
		//cssElm.text("#table tbody td { font-family: monospace; }");
		cssElm.text("#table tbody td { font-family: mPlusRegular; }");
		cssElm.addClass("active");
		$("body").one("mouseover", function() {
			trans.grid.render();
		})		
		trans.grid.render();
		sys.config.monoSpaceTable = true;
		$(".menu-button.monospace").addClass("checked");
		return true;
	}
	
}



ui.renderColorTagSelector = function($selector) {
	$selector = $selector||$(".colorTagSelector");
	if ($selector.hasClass("rendered")) return $selector;
	
	for (var colorName in consts.tagColor) {
		var $temp = $('<input type="checkbox" value="'+colorName+'" />');
		$temp.addClass("colorTagSelector tagSelector");
		$temp.addClass(colorName);
		$temp.css("background-color", consts.tagColor[colorName]);
		$temp.attr("title", colorName)
		$temp.attr("name", "tagSelector");
		$selector.append($temp);
	}
	$selector.addClass("rendered")
	return $selector;
}


ui.blurAll = function() {
	$(".toolbar, .panel-wrapper, #cellSelectionInfo, .footer").addClass("blur");
}

ui.unBlurAll = function() {
	$(".toolbar, .panel-wrapper, #cellSelectionInfo, .footer").removeClass("blur");
	
}


ui.pathNotAccessibleDialog = function() {
	if ($("#pathNotAccessible").hasClass("initialized") == false) {
		$("#pathNotAccessible").dialog({
			autoOpen: false,
			modal:true,
			minWidth:480,
			minHeight:320,
			maxWidth:640,
			maxHeight:420,			
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			buttons:[
				{
					text: "Close",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}

			]			
		});	
		$("#pathNotAccessible").addClass("initialized");
	}
	
	$("#pathNotAccessible").dialog("open");
	return $("#pathNotAccessible");
}


// ===========================================================
// New project class
// ===========================================================

ui.showPopup = async function(name, content, options) {
	this.popups 		= this.popups||{};
	//this.popups[name] 	= this.popups[name] 
	options 			= options||{};
	options.onDone 		= options.onDone||function(){}
	options.title 		= options.title||"Info";
	options.allExternal	= options.allExternal || false; // makes all a elm to open in external browser
	options.HTMLcleanup = options.HTMLcleanup || false; // cleanup HTML data from unsave tags
	options.rebuild		= options.rebuild || false;
	options.onClose		= options.onClose || function(){}
	options.isUnpreventable = options.isUnpreventable || false;
	
	options.buttons 		= options.buttons || [
				{
					text: "Close",
					icon: "ui-icon-close",
					click: function() {
						$(this).dialog( "close" );
					}
				}
			]
	
	sys.config.popupData = sys.config.popupData||{};
	sys.config.popupData[name] = sys.config.popupData[name]||{};
	
	
	var thisID = "popup_"+name;
	
	if ($("#"+thisID).length == 0 || options.rebuild == true) {
		if ($("#"+thisID).length > 0) $("#"+thisID).remove();

		$("#template").append("<div id='"+thisID+"' data-popupid='"+thisID+"' class='"+thisID+" autoPopupGenerator'>\
				<div class='popupContent'></div>\
				</div>");
		$("#"+thisID).data("name", name);
		$("#"+thisID).dialog({
			autoOpen: false,
			modal:true,
			title:options.title||"Info",
			width:options.width||Math.round($(window).width()/100*50),
			height:options.height||Math.round($(window).height()/100*60),
			minWidth:options.minWidth||640,
			minHeight:options.minHeight||320,
			classes:options.classes,
			show: {
				effect: "fade",
				duration: 200
			},
			hide: {
				effect: "fade",
				duration: 200
			},
			close: function( event, ui ) {
				// window closed
				var $thisPopup = $(this);
				var thisName = $(this).data('name');
				if (typeof options.onClose == "function") options.onClose.call(this);
				if ($thisPopup.closest('.ui-dialog').find(".doNotShowAgain").prop("checked")) {
					console.log("do not show again is checked");
					console.log(thisName);
					sys.config.popupData[thisName] = sys.config.popupData[thisName] || {};
					sys.config.popupData[thisName].isDeny = true;
					sys.saveConfig();
				}
			},
			buttons:options.buttons
		});	
		
		var $toolBar = $("<div class='popupToolbar'><label><input type='checkbox' class='doNotShowAgain' /> "+"Do not show this message again!"+"</label></div>");
		var $thisDialog = $("[aria-describedby='"+CSS.escape(thisID)+"']");
		$thisDialog.find(".ui-dialog-title").prepend("<span class='icon-info-circled-1'></span>");
		$thisDialog.addClass("popup generatedPopup");
		$thisDialog.find(".ui-dialog-buttonpane").prepend($toolBar);
		
		if (Boolean(sys.config.popupData[name].isDeny) == true) $toolBar.find(".doNotShowAgain").prop("checked", true)
		$toolBar.find(".doNotShowAgain").off("change")	
		$toolBar.find(".doNotShowAgain").on("change", function() {
			//var name = $(this).closest(".autoPopupGenerator").data("name");
			sys.config.popupData[name].isDeny = $(this).prop("checked")
			sys.saveConfig();
		})
		
		if (options.isUnpreventable) $toolBar.addClass("hidden");
		

	} 
	
	$("#"+thisID).data("onClose", options.onDone);
	if (options.HTMLcleanup) {
		var $content = $(content);
		$content.find("style, script, iframe, webview").remove();
		$("#"+thisID).find(".popupContent").html($content);
	} else {
		$("#"+thisID).find(".popupContent").html(content);
	}
	
	if (options.allExternal) {
		$("#"+thisID).find(".popupContent a").off("click")
		$("#"+thisID).find(".popupContent a").on("click", function(e) {
			var href = $(this).attr("href");
			if (href[0] == "#") return;
			e.preventDefault();
			nw.Shell.openExternal($(this).attr("href"));
		})
	} else {
		$("#"+thisID).find("a.externalLink, a[external]").on("click", function(e) {
			e.preventDefault();
			nw.Shell.openExternal($(this).attr("href"));
		})
	}
	/*
	$("#"+thisID).find("a.externalLink, a[external]").on("click", function(e) {
		e.preventDefault();
		nw.Shell.openExternal($(this).attr("href"));
	})
	*/
	if (Boolean(sys.config.popupData[name].isDeny)==true && Boolean(options.force) == false) {
		console.log("Popup '"+name+"' is denied by user!");
		return $("#"+thisID)
	}
	
	
	return new Promise((resolve, reject) => {
		$("#"+thisID).dialog("open");
		$("#"+thisID).one( "dialogclose", function( event, ui ) {
			resolve($("#"+thisID));
		});
	}) 

}


ui.openFileDialog = function(options) {
	options = options||{};
	options.onSelect = options.onSelect || function(path) { console.log(path)};
	options.accept = options.accept || "";
	options.multiple = options.multiple || false;
	options.dir = options.dir || false;
	options.save = options.save || undefined;
	options.default = options.default  || "";
	
	//$(".__pseudoFileDlg1").remove();
	//var $elm = this.
	var $elm = $("<input type='file' style='display:none' class='hidden __pseudoFileDlg1' />");
	$elm.on("input", function() {
		var thisVal = $(this).val();
		$(this).remove();
		options.onSelect.call(this, thisVal);
	});
	
	if (options.accept.length > 0) $elm.attr("accept", options.accept)
	if (options.default.length > 0) $elm.attr("nwworkingdir", options.default)
	if (options.dir) $elm.attr("nwdirectory", "nwdirectory")
	if (options.multiple) $elm.attr("multiple", "multiple")
	if (typeof options.save !== 'undefined') $elm.attr("nwsaveas", options.save)
	
	//$("body").append($elm);
	$elm.trigger("click")
}


ui.initFileSelectorDragSelect = function() {
	var DragSelect = DragSelect||require("dragselect");
	window.ds = new DragSelect({
	selectables: document.getElementsByClassName('data-selector'),
	autoScrollSpeed: 15,
	area : document.getElementById("fileList"),
	callback : function(elm) {
			//console.log($(elm));
			//console.log(this);
			var $elm = $(elm);
			// ignore selection if selecting less than 2 row
			var orig = this._initialCursorPos.x+","+this._initialCursorPos.y;
			var after = this._newCursorPos.x+","+this._newCursorPos.y;
			// DragSelect adds its hover class to rows touched by the selection rect on
			// mouse-down; a click that ends without a drag never clears it, so always
			// strip it once the drag is over.
			$(this.selectables).removeClass("ds-hover");
			if (orig == after) return false;
			if ($elm.length <= 1) return false;
			$elm.each(function() {
				var $input = $(this).find("input");
				$(this).removeClass("ds-hover");
				$input.prop("checked", true)
				$input.trigger("change");
				window.ds.clearSelection();
			})
		}
	});	
}

/**
 * Create a nwjs native menu from object
 * More info about nwjs's native menu at : https://docs.nwjs.io/en/latest/References/Menu/
 * @param {Obj[]} menuObj - Array of menu object
 */
ui.createMenu = function(menuObj) {
	if (!menuObj) throw new Error("You must specify a menu object as the first parameter")
	if (menuObj.constructor.name == "Menu") return menuObj;
	var menu = new nw.Menu();
      
	for (let thisMenu of menuObj) {
		if (!thisMenu) continue;
		menu.append(new nw.MenuItem(thisMenu));	  
	}

	return menu;
}

// ===========================================================
// Toolbar group class
// ===========================================================

ui.Toolbar = function(id, options) {
	if (typeof id == 'object') {
		options = id;
		id = options.id || common.generateId();
	}
	this.options = options || {};
	this.isVisible = this.options.isVisible || false;
	this.buttons = {};
	this.groups = {};
	this.id = id||common.generateId();
	this.defaultGroup = "group0";
	this.init();
}
ui.Toolbar.list = {}
ui.Toolbar.getById = function(id) {
	return this.list?.[id];
}

ui.Toolbar.prototype.onReady = function(fn) {
    // see if DOM is already available
    if (document.readyState === "complete" || document.readyState === "interactive") {
        // call on next available tick
        setTimeout(fn, 1);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

ui.Toolbar.prototype.init = function(){
	this.onReady(()=> {
		// Defaults to the top ribbon toolbar group; the editor toolbars below the
		// ribbon pass an explicit container (e.g. ".panel-right").
		this.container = this.options.container ? $(this.options.container) : $(".toolbarGroup")
		
		if (this.container.find(".toolbar[data-id='"+this.id+"']").length > 0) {
			this.elm = this.container.find(".toolbar[data-id='"+this.id+"']");
		} else {
			this.elm = $('<div class="toolbar" data-id="'+this.id+'">')
			if (this.isVisible == false) this.elm.addClass("hidden");
			this.container.append(this.elm);	
		}
		
		if (this.elm.find(".toolbar-content").length == 0) {
			this.addButtonGroup(this.defaultGroup);
		}
		
		this.options.buttons = this.options.buttons || {};
		for (var i in this.options.buttons) {
			//console.log("adding buttons", this.options.buttons[i]);
			this.addButton(this.options.buttons[i]);
		}

		ui.Toolbar.list[this.id] = this;
	})
}

ui.Toolbar.prototype.getButtonGroupElm = function(id) {
	if (this.groups[id]?.elm) return this.groups[id].elm;
	return this.elm.find(`.toolbar-content[data-id="${CSS.escape(id)}"]`)
}

ui.Toolbar.prototype.addButtonGroup = function(id) {
	this.groups[id] = {
		elm : $('<div class="toolbar-content" data-id="'+id+'"></div>')
	}
	this.elm.append(this.groups[id].elm);
	return this.groups[id];
}

ui.Toolbar.prototype.addButton = function(buttonObj) {
	buttonObj = buttonObj || {};
	buttonObj.id 	= buttonObj.id || common.generateId();
	buttonObj.group = buttonObj.group || this.defaultGroup;
	buttonObj.title = buttonObj.title || "";
	buttonObj.checked = buttonObj.checked || false;
	buttonObj.img 	= buttonObj.img || "";
	buttonObj.icon 	= buttonObj.icon || "";
	buttonObj.elm	= buttonObj.elm || '<button class="menu-button" title="'+buttonObj.title+'"></button>'
	buttonObj.elm 	= $(buttonObj.elm);
	buttonObj.checked = buttonObj.checked || false;
	buttonObj.onClick = buttonObj.onClick || function(){};

	buttonObj.elm.attr("data-id", buttonObj.id);
	
	if (buttonObj.img !== '') {
		buttonObj.elm.html('<img src="'+buttonObj.img+'" alt="" />')
	} else if (buttonObj.icon !=='') {
		buttonObj.elm.html('<i class="'+buttonObj.icon+'"></i>')
	} else {
		buttonObj.elm.html('<img src="img/transparent.png" alt="" />')
	}

	// Optional text label shown next to the icon. The responsive collapse in
	// ui.toolbarLabelFit reads these data attributes.
	if (buttonObj.label) {
		buttonObj.elm.append($('<span class="menu-button-label"></span>').text(buttonObj.label));
		buttonObj.elm.attr("data-label", buttonObj.label);
		if (typeof buttonObj.priority !== 'undefined' && buttonObj.priority !== null) {
			buttonObj.elm.attr("data-label-priority", buttonObj.priority);
		}
		if (buttonObj.essential) buttonObj.elm.attr("data-label-essential", "true");
		if (buttonObj.shortLabel) buttonObj.elm.attr("data-label-short", buttonObj.shortLabel);
	}
	if (buttonObj.id) buttonObj.elm.attr("data-button-id", buttonObj.id);

	if (buttonObj.checked) buttonObj.elm.addClass('checked');
	
	buttonObj.elm.on("click", function() {
		buttonObj.onClick.apply(this, arguments);
	})
	if (this.buttons[buttonObj.id]) buttonObj.elm.remove();
	
	//registering button
	this.buttons[buttonObj.id] = buttonObj;

	//addding to element
	const $buttonGroup = this.getButtonGroupElm(buttonObj.group);
	$buttonGroup.append(buttonObj.elm);

	return buttonObj.elm;
}

ui.Toolbar.prototype.addButtonWithMenu = function(buttonObj, menu) {
	buttonObj = buttonObj || {};
	menu = ui.createMenu(menu);
	buttonObj.id 	= buttonObj.id || common.generateId();
	buttonObj.group = buttonObj.group || this.defaultGroup;
	buttonObj.title = buttonObj.title || "";
	buttonObj.checked = buttonObj.checked || false;
	buttonObj.img 	= buttonObj.img || "";
	buttonObj.icon 	= buttonObj.icon || "";
	buttonObj.elm	= buttonObj.elm || `<span class="menu-button buttonGroup"><button class="hasMenuSide mainButton" title="${buttonObj.title}" ></button><button class="menuSide"></button></span>`
	buttonObj.elm 	= $(buttonObj.elm);
	buttonObj.checked = buttonObj.checked || false;
	buttonObj.onClick = buttonObj.onClick || function(){};
	buttonObj.onExpanderClick = buttonObj.onExpanderClick || function(){};

	buttonObj.elm.attr("data-id", buttonObj.id);
	
	if (buttonObj.img !== '') {
		buttonObj.elm.find("button").eq(0).html('<img src="'+buttonObj.img+'" alt="" />')
	} else if (buttonObj.icon !=='') {
		buttonObj.elm.find("button").eq(0).html('<i class="'+buttonObj.icon+'"></i>')
	} else {
		buttonObj.elm.find("button").eq(0).html('<img src="img/transparent.png" alt="" />')
	}
	
	if (buttonObj.checked) buttonObj.elm.addClass('checked');
	
	buttonObj.elm.find("button").eq(0).on("click", function() {
		buttonObj.onClick.apply(this, arguments);
	})
	buttonObj.elm.find("button").eq(1).on("click", function(ev) {
		ev.preventDefault();
        var $wrapper = buttonObj.elm;
        var left = parseInt($wrapper.offset().left);
        var top = parseInt($wrapper.offset().top + $wrapper.outerHeight());
        if (menu) menu.popup(left, top);
		buttonObj.onExpanderClick.apply(this, arguments);
	})
	if (this.buttons[buttonObj.id]) buttonObj.elm.remove();

	//registering button
	this.buttons[buttonObj.id] = buttonObj;

	//addding to element
	const $buttonGroup = this.getButtonGroupElm(buttonObj.group);
	$buttonGroup.append(buttonObj.elm);

	return buttonObj.elm;
}


ui.Toolbar.prototype.addMenuButton = function(buttonObj, menu) {
	buttonObj = buttonObj || {};
	menu = ui.createMenu(menu);
	buttonObj.id 	= buttonObj.id || common.generateId();
	buttonObj.group = buttonObj.group || this.defaultGroup;
	buttonObj.title = buttonObj.title || "";
	buttonObj.checked = buttonObj.checked || false;
	buttonObj.img 	= buttonObj.img || "";
	buttonObj.icon 	= buttonObj.icon || "";
	buttonObj.elm	= buttonObj.elm || `<button class="menu-button buttonExpand" title="${buttonObj.title}"></button>`
	buttonObj.elm 	= $(buttonObj.elm);
	buttonObj.checked = buttonObj.checked || false;
	buttonObj.onClick = buttonObj.onClick || function(){};
	buttonObj.onExpanderClick = buttonObj.onExpanderClick || function(){};

	buttonObj.elm.attr("data-id", buttonObj.id);
	
	if (buttonObj.img !== '') {
		buttonObj.elm.html('<img src="'+buttonObj.img+'" alt="" />')
	} else if (buttonObj.icon !=='') {
		buttonObj.elm.html('<i class="'+buttonObj.icon+'"></i>')
	} else {
		buttonObj.elm.html('<img src="img/transparent.png" alt="" />')
	}
	
	if (buttonObj.checked) buttonObj.elm.addClass('checked');
	
	buttonObj.elm.on("click", function(ev) {
		ev.preventDefault();
        var $wrapper = buttonObj.elm;
        var left = parseInt($wrapper.offset().left);
        var top = parseInt($wrapper.offset().top + $wrapper.outerHeight());
        if (menu) menu.popup(left, top);
		buttonObj.onClick.apply(this, arguments);
	})
	if (this.buttons[buttonObj.id]) buttonObj.elm.remove();

	//registering button
	this.buttons[buttonObj.id] = buttonObj;

	//addding to element
	const $buttonGroup = this.getButtonGroupElm(buttonObj.group);
	$buttonGroup.append(buttonObj.elm);

	return buttonObj.elm;
}

ui.Toolbar.prototype.getButtonElm = function(id) {
	if (typeof id == "string") return this.elm.find(`.toolbar-content .menu-button[data-id="${CSS.escape(id)}"]`)
	return $(id);
}

/**
 * Overlay a small icon on icon
 * @param {string} buttonId - Id of the button
 * @param {string} iconName - name of the icon (see fontello documentation)
 * @param {string} [color] - Color of the emblem
 */
ui.Toolbar.prototype.setButtonEmblem = function(buttonId, iconName, color="#ffa500") {
	const btnElm = this.getButtonElm(buttonId);
	btnElm.addClass("iOverlay")
	btnElm.addClass(iconName)
	btnElm.attr("data-overlay", iconName)
	btnElm.css("--icon-overlay-color", color);
}

ui.Toolbar.prototype.unsetButtonEmblem = function(buttonId) {
	const btnElm = this.getButtonElm(buttonId);
	const overlay = btnElm.attr("data-overlay")
	btnElm.removeClass("iOverlay")
	btnElm.removeClass(overlay)
	btnElm.removeAttr("data-overlay")
}

ui.Toolbar.prototype.remove = function() {
	this.elm.remove();
}

ui.Toolbar.prototype.show = function(){
	ui.onDOMReady(()=> {
		this.container.find(".toolbar").addClass("hidden")
		this.elm.removeClass("hidden")
	})
}


// ===========================================================
// Ribbon menu class
// ===========================================================
ui.RibbonMenu = function() {
	var that = this;
	this.container;
	this.ribbons = {};
	this.defaultClickEvt = function() {
		var thisId = $(this).data("id");
		//console.log("clicking, this id : ", thisId);
		that.ribbons[thisId].onClick = that.ribbons[thisId].onClick || function(){}
		ui.ribbonMenu.select($(this), that.ribbons[thisId].onClick);
	}
	this.lastSelected = "";
	this.init();
}

ui.RibbonMenu.prototype.init = function(){
	this.onReady(()=> {
		this.container 	= $("#applicationBar .appActionsLeft");
		
		this.add("start", {
			title : "Start",
			locked : true,
			onClick : function() {
				if ($("#introWindow").not(":visible")) ui.introWindowShow();
			}
		})
		this.add("home", {
			title : "Home",
			locked : true,
			onClick : function() {
				if ($("#introWindow").is(":visible")) ui.introWindowClose();
			},
			toolbar : new ui.Toolbar("home")
		})
		
		
		this.clear();
		
		var $ribbons = $("#applicationBar .ribbonMenu");
		//var that = this;
		$ribbons.off("click.ribbonAct");
		$ribbons.on("click.ribbonAct", this.defaultClickEvt);
	})
}

ui.RibbonMenu.prototype.select = function($ribbon, trigger) {
	if (typeof trigger == 'undefined') trigger = true;
	if (typeof $ribbon == 'string') {
		$ribbon = $("#applicationBar .ribbonMenu[data-id='"+$ribbon+"']");
	}
	var thisId = $ribbon.data("id");
	var $ribbons = $("#applicationBar .ribbonMenu");
	$ribbons.removeClass("active");
	$ribbon.addClass("active");
	
	this.lastSelected = thisId;
	
	$(document).trigger("onRibbonSelect", thisId);
	if (trigger == false) return;

	if (this.ribbons[thisId].toolbar) this.ribbons[thisId].toolbar.show();
	if (typeof this.ribbons[thisId].onClick !== 'function') return;
	
	this.ribbons[thisId].onClick.call(this)
}

ui.RibbonMenu.prototype.onReady = function(fn) {
    // see if DOM is already available
    if (document.readyState === "complete" || document.readyState === "interactive") {
        // call on next available tick
        setTimeout(fn, 1);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

ui.RibbonMenu.prototype.isExist = function(id) {
	if (this.container.find(".ribbonMenu[data-id='"+id+"']").length > 0) return true;
	return false;
}

ui.RibbonMenu.prototype.add = function(id, options) {
	if (typeof id !== "string") return;
	if (id == "") return;
	options 			= options || {};
	options.onClick 	= options.onClick || function(){};
	options.title 		= options.title || options.id;
	if (typeof options.toolbar == 'object' && !(options.toolbar instanceof ui.Toolbar)) {
		options.toolbar = new ui.Toolbar(options.toolbar)
	}
	this.ribbons[id] = options;
	
	this.onReady(()=>{
		var $template = this.container.find(".ribbonMenu[data-id='"+id+"']")
		if ($template.length == 0) {
			$template = $('<div class="ribbonMenu"></div>');
			$template.attr("data-id", id);
			$template.html(options.title);
			this.container.append($template);		
		}
		$template.off("click");
		$template.on("click", this.defaultClickEvt)
		this.ribbons[id].elm = $template;
		
		// select if last selection is this ribbon
		if (this.lastSelected == id) {
			this.select(id);
		}
	})
	
	return this.ribbons[id]
}

ui.RibbonMenu.prototype.remove = function(id) {
	if (!this.ribbons[id]) return;
	if (this.ribbons[id].locked) return;
	
	if (this.ribbons[id].toolbar) {
		this.ribbons[id].toolbar.remove();
	}
	
	delete this.ribbons[id]
	this.container.find(".ribbonMenu[data-id='"+id+"']").remove();
}

ui.RibbonMenu.prototype.clear = function() {
	// remove all
	for (var key in this.ribbons) {
		if (this.ribbons[key].locked) continue;
		this.remove(key);
	}
}

ui.ribbonMenu = new ui.RibbonMenu();

// ===========================================================
// RESPONSIVE TOOLBAR LABELS
// ===========================================================
// The Home toolbar's workflow group (Translation Setup / Glossary / Batch
// Translation / Word Wrap / Export) shows text next to each icon. When the
// toolbar is too narrow for every label, labels are dropped least-important
// first (see js/toolbarLayout.js) and the essential Batch Translation button
// falls back to its short label instead of disappearing.
ui.toolbarLabelFit = {};

ui.toolbarLabelFit.isClipped = function(el) {
	return Boolean(el) && el.scrollWidth > el.clientWidth + 1;
};

ui.toolbarLabelFit.collectItems = function($group) {
	var items = [];
	$group.find(".menu-button[data-label]").each(function(index) {
		var $btn = $(this);
		items.push({
			id: $btn.attr("data-button-id") || ("labelButton" + index),
			priority: parseInt($btn.attr("data-label-priority"), 10),
			essential: $btn.attr("data-label-essential") === "true",
			shortLabel: $btn.attr("data-label-short") || "",
			fullLabel: $btn.attr("data-label") || "",
			$btn: $btn,
			index: index
		});
	});
	return items;
};

ui.toolbarLabelFit.byId = function(items, id) {
	for (var i = 0; i < items.length; i++) {
		if (items[i].id === id) return items[i];
	}
	return null;
};

ui.toolbarLabelFit.reset = function(items) {
	for (var i = 0; i < items.length; i++) {
		items[i].$btn.removeClass("label-off").removeClass("label-short");
		items[i].$btn.find(".menu-button-label").text(items[i].fullLabel);
	}
};

ui.toolbarLabelFit.apply = function(el) {
	if (!el || typeof toolbarLayout === "undefined") return;
	var items = ui.toolbarLabelFit.collectItems($(el));
	if (items.length === 0) return;
	ui.toolbarLabelFit.reset(items);

	// 1. Drop non-essential labels, least important first, while the group clips.
	var order = toolbarLayout.sortLabelHideOrder(items);
	for (var i = 0; i < order.length; i++) {
		if (!ui.toolbarLabelFit.isClipped(el)) break;
		var item = ui.toolbarLabelFit.byId(items, order[i]);
		if (item) item.$btn.addClass("label-off");
	}

	// 2. Still clipped: essential buttons fall back to their short label.
	if (ui.toolbarLabelFit.isClipped(el)) {
		var shortOrder = toolbarLayout.essentialFallbackOrder(items);
		for (var j = 0; j < shortOrder.length; j++) {
			if (!ui.toolbarLabelFit.isClipped(el)) break;
			var shortItem = ui.toolbarLabelFit.byId(items, shortOrder[j]);
			if (!shortItem) continue;
			shortItem.$btn.addClass("label-short");
			shortItem.$btn.find(".menu-button-label").text(shortItem.shortLabel);
		}
	}
};

ui.toolbarLabelFit.schedule = function(el) {
	clearTimeout(el.__labelFitTimer);
	el.__labelFitTimer = setTimeout(function() {
		ui.toolbarLabelFit.apply(el);
	}, 50);
};

ui.toolbarLabelFit.observe = function(el) {
	ui.toolbarLabelFit.apply(el);
	var $toolbar = $(el).closest(".toolbar");
	var target = $toolbar.length ? $toolbar[0] : el;
	// Observe the whole toolbar row, not the group: hiding a label resizes the
	// group, which would bounce the observer back into apply() forever.
	if (typeof ResizeObserver !== "undefined") {
		if (el.__labelFitObserver) el.__labelFitObserver.disconnect();
		el.__labelFitObserver = new ResizeObserver(function() {
			ui.toolbarLabelFit.schedule(el);
		});
		el.__labelFitObserver.observe(target);
	} else {
		$(window).on("resize.toolbarLabelFit", function() {
			ui.toolbarLabelFit.schedule(el);
		});
	}
};

ui.toolbarLabelFit.applyAll = function() {
	$("[data-responsive-labels]").each(function() {
		ui.toolbarLabelFit.apply(this);
	});
};

ui.toolbarLabelFit.init = function() {
	ui.onDOMReady(function() {
		$("[data-responsive-labels]").each(function() {
			ui.toolbarLabelFit.observe(this);
		});
		// Label metrics shift once the text/icon fonts finish loading.
		try {
			if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
				document.fonts.ready.then(function() {
					ui.toolbarLabelFit.applyAll();
				});
			}
		} catch (e) { /* fonts API unavailable; the load handler below still runs */ }
		$(window).on("load", function() {
			ui.toolbarLabelFit.applyAll();
		});
	});
};

// ===========================================================
// TOOLS OVERFLOW MENU
// ===========================================================
ui.toolsMenu = {};

ui.toolsMenu.ensurePopup = function() {
	if (ui.toolsMenu.$popup && ui.toolsMenu.$popup.length) return ui.toolsMenu.$popup;
	var $popup = $(".toolbarToolsMenu").first();
	if ($popup.length === 0) return null;
	// Move the popup out of the clipping toolbar and onto the body so it is
	// never cut off. Moving a node keeps the click handlers bound to its buttons.
	$popup.appendTo(document.body);
	ui.toolsMenu.$popup = $popup;
	return $popup;
};

ui.toolsMenu.open = function() {
	var $popup = ui.toolsMenu.ensurePopup();
	if (!$popup) return;
	$popup.removeClass("hidden");
	var btn = ui.toolsMenu.$btn && ui.toolsMenu.$btn[0];
	if (btn) {
		var rect = btn.getBoundingClientRect();
		var left = Math.max(4, Math.round(rect.right - $popup.outerWidth()));
		$popup.css({ left: left + "px", top: Math.round(rect.bottom + 2) + "px" });
	}
};

ui.toolsMenu.close = function() {
	if (ui.toolsMenu.$popup) ui.toolsMenu.$popup.addClass("hidden");
};

ui.toolsMenu.toggle = function($btn) {
	ui.toolsMenu.$btn = $btn;
	if (ui.toolsMenu.$popup && !ui.toolsMenu.$popup.hasClass("hidden")) {
		ui.toolsMenu.close();
	} else {
		ui.toolsMenu.open();
	}
};

ui.toolsMenu.init = function() {
	ui.onDOMReady(function() {
		$(document).on("click.toolsMenu", function(ev) {
			if ($(ev.target).closest(".toolbar-tools").length) return;
			if ($(ev.target).closest(".toolbarToolsMenu").length) return;
			ui.toolsMenu.close();
		});
		$(document).on("keydown.toolsMenu", function(ev) {
			if (ev.key === "Escape") ui.toolsMenu.close();
		});
	});
};

// ===========================================================
// MENU BUTTONS
// ===========================================================

ui.addIconOverlay = function($elm, icon) {
	// add icon overlay into a button
	$elm.addClass('icon-'+icon);
	$elm.addClass('iOverlay');
}

ui.clearIconOverlay = function($elm) {
	$elm.removeClass (function (index, className) {
		return (className.match (/(^|\s)icon-\S+/g) || []).join(' ');
	});
	$elm.removeClass('iOverlay');
}

// ===========================================================
// Custom field class
// ===========================================================
class CustomFields extends require("www/js/BasicEventHandler.js") {
	constructor($form, options={}) {
		super($form)
		console.warn("Creating custom fields", arguments)
		if (arguments.length == 1 && typeof $form == "object" && $form.constructor.name !== "jQuery") {
			options = {
				jsonForm:$form
			}

			$form = $("<form></form>");
			$form.submit(false);
		}

		if (typeof options == "function") {
			options = options() || {};
		}
		this.$elm = $form;
		this.$elm.submit(false)

		this.getElm = ()=> {
			return this.$elm;
		}

		this.addJSONForm = (settings={}) => {
			console.log("Adding jsonform", settings);
			try {
				this.$elm.jsonForm(settings);
			} catch (e) {
				console.warn("Invalid jsonForm options", e)
			}
		}
		this.addHTML = ($elm) => {
			this.$elm.append($elm)
		}

		this.init = ()=> {
			if (options.jsonForm) this.addJSONForm(options.jsonForm);	
			if (options.html) this.addHTML(options.html)
			console.warn("CustomFields rendered", this)
			this.resolveState("ready");
		}

		this.getValues = ()=> {
			let fd = new FormData(this.$elm[0]);
			return Object.fromEntries(fd);
		}

		this.setValueByName = (name, val)=> {
			console.log("Updating value", name, val, "of", this);
			const $fld = this.$elm.find(`[name="${name}"]`);
			$fld.val(val);
		}

		this.init();
	}
}
window.CustomFields = CustomFields;





// ===========================================================
// New project class
// ===========================================================
const NewProjectDialog = function($elm) {
	this.onInits = this.onInits||[];
	this.$elm = $elm ;
	this.isInitialized = false;
	this._onInitCreateMenu = [];
	this.slides = {};
}

NewProjectDialog.prototype.init =function() {
	var that = this;
	this.$elm = this.$elm || $("#dialogNewProject");
	if (this.$elm.hasClass("initialized")) {
		this.$elm.dialog( "destroy" );
		this.$elm.removeClass("initialized");
	}
	this.$elm.dialog({
		autoOpen: false,
		modal:true,
		minWidth:480,
		minHeight:320,
		width:Math.round($(window).width()/100*80),
		height:Math.round($(window).height()/100*80),				
		show: {
			effect: "fade",
			duration: 200
		},
		hide: {
			effect: "fade",
			duration: 200
		},
		buttons: [
			{
				text: "Cancel",
				//icon: "ui-icon-heart",
				click: function() {
					$(this).dialog( "close" );
				}
			}
		]
	});	
	this.reset();
	this.$elm.find("[data-gotoSlide]").each(function() {
		$(this).on("click.slideJumper", function() {
			var targetSlide = $(this).attr("data-gotoSlide");
			console.log("jump to slide", targetSlide);
			if (!targetSlide) return;
			that.gotoSlide(targetSlide, $(this).closest("[data-slideid]").attr("data-slideid"));
		});
	})
	this.$elm.find("form").each(function() {
		$(this).on("submit", function(e) {
			e.preventDefault();
		});
	})
	
	this.$elm.addClass("initialized");
	// execute onInits
	for (let i=0; i<this.onInits.length; i++) {
		if (typeof this.onInits[i] !== 'function') continue;
		try {
			this.onInits[i].apply(this, arguments);
		} catch (e) {
			console.warn(e);
		}
	}	
	this.onInits = [];
	this.isInitialized = true;
	
	if (this._onInitCreateMenu.length > 0) {
		for (let i=0; i<this._onInitCreateMenu.length; i++) {
			this.addMenu(this._onInitCreateMenu[i]);
		}
	}
	
	this.evalEvents();
}

NewProjectDialog.prototype.addMenu = function(options) {
	if (this.isInitialized == false) {
		console.log("this object", this);
		this._onInitCreateMenu.push(options);
		
		return;
	}
	var $mainSlide = this.$elm.find("[data-slideId=1]");
	
	var that = this;
	options = options||{};
	options.icon 			= options.icon || "";
	options.descriptionBar 	= options.descriptionBar || "";
	options.actionBar 		= options.actionBar || [];
	options.goToSlide		= options.goToSlide || 0;
	// slides can be html element, jquery, or object {html: 'html element'}
	options.slides 			= options.slides||{}
	options.at				= options.at||undefined;
	
	options.at = Math.min(options.at, $mainSlide.children().length);
	
	var $slide1 = $('<a href="#" class="dialogSelection" data-gotoSlide="'+options.goToSlide+'">\
	<div class="iconBar"><img src="'+options.icon+'" alt="" /></div>\
	<div class="descriptionBar"></div>\
	<div class="actionBar"></div>\
	</a>');
	$slide1.find(".descriptionBar").append(options.descriptionBar);
	$slide1.find(".actionBar").append(options.actionBar);
	$slide1.on("click.slideJumper", function() {
		var targetSlide = $(this).attr("data-gotoSlide");
		console.log("jump to slide", targetSlide);
		if (!targetSlide) return;
		that.gotoSlide(targetSlide, $(this).closest("[data-slideid]").attr("data-slideid"));
	});	
	
	if (typeof options.at == 'undefined') {
		$mainSlide.append($slide1);
	} else {
		$slide1.insertAt(options.at,$mainSlide)
	}
	
	for (var slideId in options.slides) {
		if (options.slides[slideId] instanceof jQuery) {
			let $content = options.slides[slideId]
			this.newSlide(slideId, $content);
		} else if (options.slides[slideId] instanceof HTMLElement) {
			let $content = $(options.slides[slideId])
			this.newSlide(slideId, $content);
		} else if (typeof options.slides[slideId] == 'object' && Boolean(options.slides[slideId]) == true) {
			this.newSlide(slideId, $(options.slides[slideId].html), options.slides[slideId]);
		}
	}
}

NewProjectDialog.prototype.evalEvents = function() {
	var that 	= this;
	var $thisElm = this.$elm;
	if (this.isInitialized == false) {
		$thisElm = $("#dialogNewProject");
	}	
	$thisElm.find('[data-slideId]').not('.eventRendered').each(function() {
		var $this 	= $(this);
		var thisId 	= $this.attr('data-slideId');
		if (Boolean(that.slides[thisId])==false) return;
		if (Boolean(that.slides[thisId].options)==false) return;
		
		if (typeof that.slides[thisId].options.onActive == 'function') {
			$this.on("active", that.slides[thisId].options.onActive)
		}
		if (typeof that.slides[thisId].options.onBeforeActive == 'function') {
			$this.on("beforeActive", that.slides[thisId].options.onActive)
		}
		if (typeof that.slides[thisId].options.onInactive == 'function') {
			$this.on("inactive", that.slides[thisId].options.onActive)
		}
		$this.addClass("eventRendered");
	});
}

NewProjectDialog.prototype.newSlide = function(slideId, $content, options) {
	if (typeof $content == "object" && $content.schema) {
		let customField = new CustomFields($content);
		$content = customField.$elm
	}


	if (!slideId) return console.warn("id must not blank");
	options = options || $content.data("options") || {};
		
	var $thisElm = this.$elm;
	if (this.isInitialized == false) {
		$thisElm = $("#dialogNewProject");
	}
	
	var makeSlide = (slideId, $content, options)=> {
		var $currentSlide = $thisElm.find("[data-slideId="+slideId+"]");
		if ($currentSlide.length == 0 ){
			$currentSlide = $('<div class="dialogSection" data-slideid="'+slideId+'">');
			$thisElm.append($currentSlide);
		}
		$currentSlide.empty();
		ui.render($content);
		$currentSlide.append($content);
		this.slides[slideId] = {
			options : options || {},
			html : $currentSlide
		};
		
	}
	makeSlide(slideId, $content, options);
	this.evalEvents();
	
}

NewProjectDialog.prototype.resetNav = function() {
	this.$elm.dialog( "option", "buttons", [{
				text: "Cancel",
				click: function() {
					$(this).dialog( "close" );
				}
			}]);
}

NewProjectDialog.prototype.gotoSlide = function(targetSlide, sourceSlide) {
	if (!targetSlide) return;
	var $previousSlide = this.$elm.find("[data-slideid].active");
	this.$elm.find("[data-slideid].active").trigger("inactive", this);
	var $thisSlide = this.$elm.find("[data-slideid="+targetSlide+"]")
	
	$thisSlide.trigger("beforeActive", this);
	$(document).trigger("newProjectSlideChange", {id:targetSlide, elm:$thisSlide, prev:$previousSlide.attr("[data-slideid]")});
	
	console.log("changing slide : ", targetSlide);
	this.$elm.find("[data-slideid]").addClass("hidden");
	this.$elm.find("[data-slideid]").removeClass("active");
	$thisSlide.removeClass("hidden");
	$thisSlide.addClass("active");
	// cache the path
	if (sourceSlide) {
		$thisSlide.data("previous", sourceSlide)
	}
	
	// running onActive
	console.log("triggering event : 'active' on elm ", $thisSlide);
	$thisSlide.trigger("active", this);
	
	sourceSlide = sourceSlide || $thisSlide.data("previous");
	
	// rendering navigation buttons
	var that = this;
	if (targetSlide == "1") {
		this.resetNav();
		return;
	}
	
	var buttons = []
	if (sourceSlide) {
		buttons.push({
				text: "Back",
				click: function() {
					that.gotoSlide(sourceSlide);
				}
			})
	}
	
	buttons.push({
				text: "Cancel",
				click: function() {
					$(this).dialog( "close" );
				}
			});

	if (this.slides[targetSlide]) {
		this.slides[targetSlide].options = this.slides[targetSlide].options ||{}
		if (Array.isArray(this.slides[targetSlide].options.buttons)) {
			buttons = buttons.concat(this.slides[targetSlide].options.buttons)
		}
	}
	
	this.$elm.dialog( "option", "buttons", buttons);	
}	


NewProjectDialog.prototype.reset = function() {
	this.$elm.find("[data-slideid]").addClass("hidden");
	this.$elm.find("[data-slideid]").removeClass("active");
	this.$elm.find("[data-slideid=1]").removeClass("hidden");
	this.$elm.find("[data-slideid=1]").addClass("active");
	this.$elm.dialog( "option", "width", Math.round($(window).width()/100*80));
	this.$elm.dialog( "option", "height", Math.round($(window).height()/100*80));
	this.$elm.dialog( "option", "buttons", 
		[
			{
				text: "Cancel",
				//icon: "ui-icon-heart",
				click: function() {
					$(this).dialog("close");
				}
			}
		]
	);

	this.$elm.find("form").each(function() {
		$(this)[0].reset();
	})
}
NewProjectDialog.prototype.getSlide = function(slideID) {
	return this.$elm.find(`[data-slideid="${CSS.escape(slideID)}"]`);
}


NewProjectDialog.prototype.getFormValues = function(slideIds) {
	if (!Array.isArray(slideIds)) slideIds = [slideIds];
	var result = {}
	for (let i in slideIds) {
		let $thisSlide = this.getSlide(slideIds[i]);
		if (!$thisSlide.length) continue;
		let $forms = $thisSlide.find("form");
		if (!$forms.length) continue;
		if ($forms.length > 1) {
			let formVals = []
			$forms.each(function() {
				let fd = new FormData($(this));
				formVals.push(Object.fromEntries(fd));
			})
			result[slideIds[i]] = formVals;
		} else {
			let fd = new FormData($forms[0]);
			result[slideIds[i]] = Object.fromEntries(fd);
		}
	}
	return result;
}

NewProjectDialog.prototype.open = function() {
	ui.introWindowClose();
	if (!this.isInitialized) {
		this.init();
	}
	
	this.reset();
	this.$elm.dialog("open");	
}

NewProjectDialog.prototype.close = async function() {
	return new Promise((resolve, reject) => {
		if (this.isInitialized) {
			this.$elm.one("dialogclose", function(e, ui) {
				resolve();
			})
			this.$elm.dialog("close");
		} else {
			// never opened (e.g. programmatic project creation) — nothing to close
			resolve();
		}
	})

}

ui.newProjectDialog = new NewProjectDialog();



ui.textAreaTabSupport = function(fld) {
	fld = $(fld);
	if (fld.length < 0) return;
	if (fld[0].nodeName !== 'TEXTAREA') return;
	console.log("initializing tab support");
	var enabled = true;
	fld.keydown(function(e) {

		// Escape key toggles tab on/off
		if (e.keyCode==27)
		{
			enabled = !enabled;
			return false;
		}
		//console.log("tab key is pressed");
		if ($(".textcomplete-dropdown").is(":visible")) {
			return false;
		}
				
		// Enter Key?
		if (e.keyCode === 13 && enabled)
		{
			// selection?
			if (this.selectionStart == this.selectionEnd)
			{
				// find start of the current line
				var sel = this.selectionStart;
				let text = $(this).val();
				while (sel > 0 && text[sel-1] != '\n')
				sel--;

				var lineStart = sel;
				while (text[sel] == ' ' || text[sel]=='\t')
				sel++;

				if (sel > lineStart)
				{
					// Insert carriage return and indented text
					document.execCommand('insertText', false, "\n" + text.substr(lineStart, sel-lineStart));

					// Scroll caret visible
					this.blur();
					this.focus();
					return false;
				}
			}
		}

		// Tab key?
		if(e.keyCode === 9 && enabled) 
		{
			// selection?
			if (this.selectionStart == this.selectionEnd)
			{
				// These single character operations are undoable
				if (!e.shiftKey)
				{
					document.execCommand('insertText', false, "\t");
				}
				else
				{
					let text = this.value;
					if (this.selectionStart > 0 && text[this.selectionStart-1]=='\t')
					{
						document.execCommand('delete');
					}
				}
			}
			else
			{
				// Block indent/unindent trashes undo stack.
				// Select whole lines
				var selStart = this.selectionStart;
				var selEnd = this.selectionEnd;
				var text = $(this).val();
				while (selStart > 0 && text[selStart-1] != '\n')
					selStart--;
				while (selEnd > 0 && text[selEnd-1]!='\n' && selEnd < text.length)
					selEnd++;

				// Get selected text
				var lines = text.substr(selStart, selEnd - selStart).split('\n');

				// Insert tabs
				for (var i=0; i<lines.length; i++)
				{
					// Don't indent last line if cursor at start of line
					if (i==lines.length-1 && lines[i].length==0)
						continue;

					// Tab or Shift+Tab?
					if (e.shiftKey)
					{
						if (lines[i].startsWith('\t'))
							lines[i] = lines[i].substr(1);
						else if (lines[i].startsWith("    "))
							lines[i] = lines[i].substr(4);
					}
					else
						lines[i] = "\t" + lines[i];
				}
				lines = lines.join('\n');

				// Update the text area
				this.value = text.substr(0, selStart) + lines + text.substr(selEnd);
				this.selectionStart = selStart;
				this.selectionEnd = selStart + lines.length; 
			}

			return false;
		}

		enabled = true;
		return true;
	});	
	
}

ui.render = function($html) {
	// render portion of html
	var dvField = new DVField($html);
	dvField.init();
	
	$html.find("a.externalLink, a[external]").on("click", function(e) {
		e.preventDefault();
		nw.Shell.openExternal($(this).attr("href"));
	})
	return $html;
}

ui.startProject = async function(file) {
	console.log("ui.startProject", arguments);
	file = file || "";
	if (!file) return false;
	
	var gameFolder = file.match(/(.*)[\/\\]/)[1]||''; // eslint-disable-line
	
	var checkPath = php.checkPathSync(gameFolder);
	if (checkPath.accessible == false) {
		return ui.pathNotAccessibleDialog();
	}

	var selType = $("#dialogNewProject [data-slideid='rpgmaker'] .detectedType").val();
	var devType = $("#dialogNewProject [data-slideid='rpgmaker'] .devLocationType").val();
	var detType = devType || selType; // determined type
	if (!detType) {
		// Called outside the New Project dialog (e.g. from an addon's own
		// slide): detect through the registered engine detectors instead.
		try { detType = await Engines.detect(file); } catch (e) {}
	}

	// Engines with their own JavaScript `createProject` handler (addons adding
	// non-RPG-Maker engines) bypass the PHP backend entirely — including the
	// project-existence check, which is an RPG Maker / PHP-side concept.
	if (detType && engines.hasEngine(detType) && typeof engines[detType].createProject == "function") {
		return trans.procedureCreateProject(gameFolder, {
			selectedFile : file,
			gameEngine    : detType
		});
	}

	ui.showBusyOverlay();
	php.spawn("checkProjectExist.php", {
	args:{
		'gameFolder':gameFolder
	},
		onDone : async function(data) {
			console.log(data);
			
			ui.hideBusyOverlay();

			if (detType) {
				console.log("detType is:", detType);
				if (typeof engines[detType].onCheckProjectExist == 'function') {
					console.log("handler exist");
					var halt = await engines[detType].onCheckProjectExist.apply(this, [file, detType, data]);
					console.log("Is process halt?", halt);
					if (common.isHalt(halt)) return;
				}
			}


			// end of handle rmmv

			if (Array.isArray(data) == false) return trans.procedureCreateProject(gameFolder, {selectedFile:file});
			if (data.length <= 0) return trans.procedureCreateProject(gameFolder, {selectedFile:file});
			
			ui.dialogProjectIsExist(data, {
				'gameFolder': gameFolder
			});
		
		}
	})		
	
}

ui.alert = function(msg, targetWindow) {
	if (!ui.windows[targetWindow]) return;
	ui.windows[targetWindow].alert(msg);
}
ui.fileObjectTooltip = {}
ui.fileObjectTooltip.open = async function($content, $targetElm) {
	console.log("ui.fileObjectTooltip.open", arguments);
	var $myElm = $('#fileObjectTooltip');

	if (typeof $content.on == "function") {
		$content.on("mouseout", () => {
			console.log("mouse leave");
			ui.fileObjectTooltip.close();
		})
	}

	if ($myElm.length < 1) {
		$myElm = $('<div id="fileObjectTooltip" title=""></div>').appendTo("#template");
		$myElm.attr("title", "");

		$myElm.tooltip({
			content:function() {
				return $content;
			},
			tooltipClass: "fileObjTooltipWrapper",
			show: { 
				effect: "none",
				duration: 1 
			},
			hide: {
				effect: "none",
				delay: 1
			},
			position: {
				my: "left top",
				at: "right+6 top-16",
				of: $targetElm
			},
			open: function( event, ui ) {
				/*
				setTimeout(function(){
					$myElm.tooltip("close");
				}, timeout);
				*/
			}
		});
	} else {
		$myElm.attr("title", "");
		$myElm.tooltip("option", "content", function() {
			return $content;
		});
		$myElm.tooltip("option", "position", {
			my: "left top",
			at: "right+6 top-16",
			of: $targetElm
		});
	}
	$myElm.tooltip("open");
}



ui.fileObjectTooltip.close = function() {
	var $myElm = $('#fileObjectTooltip');
	if ($myElm.length < 1) return;
	try {
		$myElm.tooltip("close");
	} catch(e) {
		// do nothing
	}
}

/**
 * Class for handling Cell Info Tab
 * (Bottom left window section)
 * @class
 */
ui.CellInfoTab = function(root, options) {
	this.options 			= options || {}
	this.root 				= root || $(".cellInfoPartsA");
	this.options.eventName 	= this.options.eventName || "cellInfoTabChange";
	this.init();
}

ui.CellInfoTab.prototype.getActiveTab = function() {
	return this.activeTab ;
}

ui.CellInfoTab.prototype.select = function(tabName) {
	console.log("selecting tab", tabName);
	this.buttons.removeClass("active");
	this.root.find(`[data-fortab="${tabName}"]`).addClass("active");
	this.contents.addClass("hidden");
	console.log("removing hidden for", tabName);
	this.root.find(`[data-tabname="${tabName}"]`).removeClass("hidden");
	this.activeTab = tabName;
	$(document).trigger(this.options.eventName, tabName);
	trans.grid.selectCell(trans.lastSelectedCell[0], trans.lastSelectedCell[1]);
}

ui.CellInfoTab.prototype.init = function() {
	this.buttons 	= this.root.find('[data-fortab]');
	this.contents 	= this.root.find('[data-tabname]');

	var cellInfoTab = this;
	this.buttons.not(".initialized").on("click", function() {
		console.log("Tab clicked");
		var tabName = $(this).attr("data-fortab");
		cellInfoTab.select(tabName);
	})
	this.buttons.addClass("initialized")
}



// =======================================================
// AUTOCOMPLETE
// =======================================================
ui.autoCompleteSet = function(state) {
	trans.project.options = trans.project.options || {};
	trans.project.options.autoComplete = Boolean(state)
}
ui.autoCompleteGet = function() {
	if (!trans.project.options) return false;
	if (typeof trans.project.options.autoComplete == 'undefined') return true;
	return Boolean(trans.project.options.autoComplete)
}
ui.autoCompleteIsEnabled = function() {
	if (!trans.project.options) return false;
	if (typeof trans.project.options.autoComplete == 'undefined') return true;
	return Boolean(trans.project.options.autoComplete)
}
ui.autoCompleteClear = function() {
	this.words = [];
}

ui.changeEditorLanguage = async function(lang) {
	return new Promise((resolve, reject) => {
		lang= lang||"en-US"
		chrome.settingsPrivate.setPref('spellcheck.dictionaries', [lang], "null", resolve(lang));
	})
}

ui.onReady(function() {
	ui.dvField = new DVField();
	ui.dvField.init();
})


ui.init = function() {
	ui.togglePreWhitespaces(sys.config.wordWrapTable)
	ui.toggleMonoSpace(sys.config.monoSpaceTable)
	//ui.textAreaTabSupport($("#currentCellText"));

	var RawViewer = require("www/js/RawViewer.js").RawViewer;
	ui.rawViewer = new RawViewer();
	
	/*
	now loaded at trans.drawFileSelector
	var TranslationByContext = require("www/js/TranslationByContext.js");
	ui.translationByContext = new TranslationByContext();
	*/

	var negativeHeight = $(".panel-wrapper").height() + 100;
	$(".cellInfoTabContent").css("height", "calc(100vh - "+negativeHeight+"px)");

	if (typeof sys.getConfig("wordWrapCurrentCellPane") !== "undefined") ui.toggleWordWrapCurrentCellPane(sys.getConfig("wordWrapCurrentCellPane"));
	if (typeof sys.getConfig("wordWrapRomajiPane") !== "undefined") ui.toggleWordWrapRomajiPane(sys.getConfig("wordWrapRomajiPane"));

	// tooltip for cellEmblems
	$(".cellEmblems > i").tooltip({
		show: {
			effect: "none",
			delay: 0
		},
		hide: {
			effect: "none",
			delay:0
		}
	})
}


ui.highlightLastSelected = function() {
	console.log("highlight selected");
	$("#table .current").removeClass("current");
	var scrolled = ui.scrollToView(trans.lastSelectedCell[0], trans.lastSelectedCell[1], function(newRow, newCol) {
		$("#table .current").removeClass("current");

		var targetRow = newRow-this.rowOffset();
		var targetCol = newCol-this.colOffset();
		console.log("target", targetRow, targetCol);
		ui.selectedCell = $(".ht_master .htCore tbody tr").eq(targetRow).find("td").eq(targetCol);
		ui.selectedCell.addClass("current highlight");			
	});
	
	console.log("Scrolled?", scrolled);
	//if (!scrolled) {
		var rowOffset = trans.lastSelectedCell[0]-trans.grid.rowOffset();
		var colOffset = trans.lastSelectedCell[1]-trans.grid.colOffset();
		console.log("Offset", rowOffset, colOffset);
		ui.selectedCell = $(".ht_master .htCore tbody tr").eq(rowOffset).find("td").eq(colOffset);
		ui.selectedCell.addClass("current highlight");
		
		var overlay;
		overlay = $(".ht_clone_left .htCore tbody tr").eq(rowOffset).find("td").eq(colOffset);
		overlay.addClass("current highlight");
	//}	
}

ui.selectNextRow = function(natural) {
	if (natural) {
		var selected = trans.grid.getSelected() || [[]]
		var row = selected[0][0] || 0
		var col = selected[0][1] || 0
		console.log("Select next:", row, col);
		if (row < trans.grid.getData().length) {
			trans.grid.selection.setRangeStart({col:col, row:row+1})
			return true;
		}
	} else {
		trans.doAfterSelection(trans.lastSelectedCell[0]+1,trans.lastSelectedCell[1]);
		ui.highlightLastSelected();
	}
}

ui.currentCellTextFocus = async function() {
	$("#currentCellText").val(trans.data[trans.lastSelectedCell[0]][trans.lastSelectedCell[1]]);
	if (ui.autoCompleteIsEnabled()) {
		if (typeof trans[trans.gameEngine] !=='undefined') trans[trans.gameEngine].setAutocompleteData();
	}
	$("#currentCellText").focus();	
}


ui.openScriptEditor = async function(id, options={}) {
	id 					||= "scriptEditor";
	options 			||= {};
	options.id 			||= id;
	options.script 		||= ""; // script to be edited
	options.file 		||= ""; // file. script and file can not be exist in the same time
	options.readOnly	||= false;
	options.language	||= "javascript"

	if (options.script && options.file) throw new Error("script and file can not be exist in the same time");

	var {showModalDialog} = require("www/js/modalDialog.js");
	
	await showModalDialog("www/scriptEditor.html", options, {id:id, width:800, height:600});
	console.log("script editor closed");
}

ui.openAutomationEditor = async function(id, options) {
	id 			= id || "codeEditor_common";
	options 	= options || {};
	options.id 	= options.id || id;

	options.workspaceType = "automation";

	var {showModalDialog} = require("www/js/modalDialog.js");
	await showModalDialog("www/automationEditor.html", options, {id:id, width:800, height:600});
	console.log("script editor closed");
}



ui.openJSONForm = async function(id, options) {
	id 			= id || "jsonform";
	options 	= options || {};
	options.id 	= options.id || id;

	options.workspaceType = "automation";

	var {showModalDialog} = require("www/js/modalDialog.js");
	await showModalDialog("www/jsonform.html", options, {id:id, width:800, height:600});
	console.log("script editor closed");
}

ui.openFormBuilder = async function(id, options) {
	id 			= id || "formBuilder";
	options 	= options || {};
	options.id 	= options.id || id;

	options.workspaceType = "automation";

	var {showModalDialog} = require("www/js/modalDialog.js");
	await showModalDialog("www/formbuilder.html", options, {id:id, width:800, height:600});
	console.log("script editor closed");
}

ui.openFormWindow = async function(schema, def={}, id="", options={}) {
	if (!schema) return;
	if (!schema.components?.length) return;

	id 			= id || "formWindow";
	options 	= options || {};
	options.id 	= options.id || id;

	options.workspaceType = "automation";

	await common.localStorage.set("formIOLastSchema", schema)
	await common.localStorage.set("formIOLastValue", def);

	var {showModalDialog} = require("www/js/modalDialog.js");
	await showModalDialog("www/form.html", options, {id:id, width:480, height:520});
	console.log("script editor closed");
	return await common.localStorage.get("formIOLastValue");
}


/**
 * Open a modal and blocking save as dialog for the portable .slrproj format
 * @since 3.000
 * @async
 * @param {String} filePath - Default path of the file
 * @returns {Promise<string>} - Path of the file. Empty when canceled
 */
ui.saveAsSlrproj = async function(filePath) {
	console.log("UI saveas slrproj");
	if (filePath) {
		filePath = common.changeExtension(filePath, "slrproj");
	} else if (trans.project && trans.project.loc) {
		var baseName = trans.project.gameTitle || "project";
		filePath = nwPath.join(trans.project.loc, common.filterFilename(baseName+".slrproj"));
	}
	return new Promise((resolve, reject) => {
		var $elm = $(`<input type="file" class="saveAs hidden" nwsaveas="project.slrproj" accept=".slrproj,application/slrproj" autocomplete="off"  />`)
		console.log("Default path is:", filePath);
		if (filePath) {
			$elm.attr("nwsaveas", nwPath.basename(filePath));
			$elm.attr("nwworkingdir", nwPath.dirname(filePath));
		}

		$elm.on("input", function(e) {
			console.log("Input received");
			$(window).off("focus.saveAs");
			resolve($(this).val());
		});
		$(window).one("focus.saveAsSlrproj", async function(e) {
			console.log("elm length:", $elm.length);
			await common.wait(3000);
			if (!$elm.val()) {
				console.log("Field canceled");
				resolve("");
			}
		});
		$elm.click();
	});
}

ui.deleteFiles = function() {
	if (trans.getCheckedFiles().length < 1) return;
	var conf = confirm("Remove selected objects?");
	if (!conf) return;

	trans.one("afterDeleteFile", async (e, files) => {
		var conf = confirm("Do you wish to remove related staging files too?\nWarning: This is can not be undone!")
		console.log("Files removed", files);
		if (!conf) return;
		trans.stagingFilesRemove(files);
	})
	trans.deleteFile(trans.getCheckedFiles());
}


ui.animateCSS = ($element, animation, prefix = '') =>
  // We create a Promise and return it
  new Promise((resolve, reject) => {
    const animationName = `${prefix}${animation}`;
    const node = $($element)[0];

    node.classList.add(`${prefix}animated`, animationName);

    // When the animation ends, we clean the classes and resolve the Promise
    function handleAnimationEnd(event) {
      event.stopPropagation();
      node.classList.remove(`${prefix}animated`, animationName);
      resolve('Animation ended');
    }

    node.addEventListener('animationend', handleAnimationEnd, {once: true});
});


$(document).ready(function() {
	if ($('body').is('[data-window="trans"]') == false) return;
	



// ==============================================================
//
// 							E V E N T S
//
// ==============================================================

	ui.disableButtons();

	ui.on("optionsWindowClosed", function() {
		console.log("optionsWindowClosed triggered");
		// No saveConfig here: every option persists itself on change, and
		// saving the shared sys.config at options-close re-serialized state
		// that the options window's teardown was concurrently replacing.
	});

	ui.setWindowTitle();
	ui.ribbonMenu.init();
	// ==============================================================
	// B U T T O N S
	// ==============================================================

	$(".button-save").on("click", function(e) {
		trans.save();
	});
	$(".button-save-as").on("click", async function(e) {
		trans.saveAs();
	});
	$(".button-save-as-side").on("click", function(ev) {
		ev.preventDefault();
		// Popup the native context menu at place you click
		console.log(ev.originalEvent);
		var $wrapper = $(this).closest(".buttonGroup");
		var left = Math.round($wrapper.offset().left);
		var top = Math.round($wrapper.offset().top + $wrapper.outerHeight());
		console.log(left, top)
		//ui.menus.saveAs.popup(parseInt(ev.originalEvent.x), parseInt(ev.originalEvent.y));
		ui.menus.saveAs.popup(left, top);
		return false;	
	});
	$(".button-open").on("click", function(e) {
		$("#openFile").trigger("click");
	});
	$(".button-new").on("click", function(e) {
		//var accept = confirm("Creating new project will close current project.\nAll unsaved data will be lost\n\nAre you sure?");
		//if (accept) {
			//$("#startProject").trigger("click");
		//}
		ui.newProjectDialog.open()
	});
	
	
	// RPG Maker's new project's slide
	$("#dialogNewProject [data-slideid=rpgmaker]").on("active", async function(e) {
		console.log("initializing slide");
		var $this = $(this);
		$this.find(".rpgMakerLocation").val("");
		$this.find(".devLocation").val("");
		$this.find(".devLocationWrapper").addClass("hidden");
		$this.find(".detectedTypeWrapper").addClass("hidden");
		$this.find(".devLocationTypeWrapper").addClass("hidden");
		$this.find(".devLocationExeWrapper").addClass("hidden");
		// initializing create a copy
		$this.find(".createCopyWrapper").addClass("hidden");
		$this.find(".createCopy").prop("checked", false);
		$this.find(".createCopy").prop("disabled", false);
		$this.find(".copyIsRequired").addClass("hidden");
		
		$this.find(".detectedType").val("");
		$this.find(".devLocationType").val("");
		$this.find(".devLocationExe").val("");
		$this.find(".devLocationWrapper").removeClass("mandatory");
		$this.find(".createProjectFromRPGM").prop("disabled", true);
	});
	
	$("#dialogNewProject .rpgMakerLocation").on("change", async function(e) {
		var loc = $(this).val();
		var $slide = $("#dialogNewProject [data-slideid=rpgmaker]");
		console.log("analyzing path : ", loc);
		var projectType = await Engines.detect(loc);

		$slide.find(".detectedTypeWrapper").removeClass("hidden");
		
		// create a copy
		$slide.find(".createCopyWrapper").removeClass("hidden");
		$slide.find(".detectedType").val(projectType);
		$slide.find(".devLocation").val("");
		
		if (!projectType) return alert("Error!\r\nSLR is unable to detect the type of "+loc);
		
		if (["rmvxace", "rmvx", "rmxp"].includes(projectType)) {
			console.log("RPG Maker - RSS Variant");
			ui._thisGame = new window.RMRGSS(loc);
			if (await ui._thisGame.isPacked()) {
				// create a copy is mandatory
				$slide.find(".createCopy").prop("checked", true);
				$slide.find(".createCopy").prop("disabled", true);
				$slide.find(".copyIsRequired").removeClass("hidden");

				$slide.find(".devLocationWrapper").addClass("mandatory");
				
				$slide.find(".createCopy").trigger("change");
				return;
			}
		}
		
		$slide.find(".createProjectFromRPGM").prop("disabled", false);
	});

	$("#dialogNewProject .createCopy").on("change", async function(e) {
		var $slide = $("#dialogNewProject [data-slideid=rpgmaker]");
		
		if ($(this).prop("checked")) {
			$slide.find(".devLocationWrapper").removeClass("hidden");
		} else {
			$slide.find(".devLocationWrapper").addClass("hidden");
		}
		
	})
	
	
	$("#dialogNewProject .devLocation").on("change", async function(e) {
		var to = $(this).val();
		var from = $("#dialogNewProject .rpgMakerLocation").val();
		var $slide = $("#dialogNewProject [data-slideid=rpgmaker]");
		var detectedType = $slide.find(".detectedType").val().toLowerCase()

		if (["rmvxace", "rmvx", "rmxp"].includes(detectedType)) {
			let conf = confirm("Copy & extract data into "+to+" ?")
			if (!conf) {
				$(this).val("");
				return 
			}
			ui.showBusyOverlay();
			
			ui._thisGame = ui._thisGame || new window.RMRGSS(from);
			let thisEngine = $slide.find(".detectedType").val();
			let devExecutable = nwPath.join(to, nwPath.basename(from));
			
			await ui._thisGame.extractTo(to);
			
			$slide.find(".devLocationTypeWrapper").removeClass("hidden");
			$slide.find(".devLocationType").val(thisEngine);
			$slide.find(".devLocationExeWrapper").removeClass("hidden");
			$slide.find(".devLocationExe").val(devExecutable);
			ui.hideBusyOverlay();
			
		}
		
		$slide.find(".createProjectFromRPGM").prop("disabled", false)
		
	});
	
	$("#dialogNewProject .createProjectFromRPGM").on("click", async function(e) {
		if ($(this).prop("disabled")) return;
		var master 	= $("#dialogNewProject .rpgMakerLocation").val();
		var devExe 	= $("#dialogNewProject .devLocationExe").val();
		
		var loc = devExe || master;
		console.log("processing location : ", loc);
		await ui.startProject(loc);
		
	});
	
	$(".selectRPGExe").on("click", function(e) {

		//var accept = confirm("Creating new project will close current project.\nAll unsaved data will be lost\n\nAre you sure?");
		//if (accept) {
			$("#startProject").trigger("click");
		//}
		//ui.newProjectDialog.open()
	});



	$(".openFile").on("change", function(e) {
		//trans.currentFile = $(this).val();
		trans.open($(this).val());
		console.log($(this).val());
	});

	/*
	$(".saveAs").on("change", function(e) {
		trans.currentFile = $(this).val();
		trans.save();
		console.log($(this).val());
	});
	*/

	$("#startProject").on("click", function() {
		$(this).val("");
	});	
	
	$("#startProject").on("change", async function() {
		if ($(this).val() == "") return false;
		if (typeof $(this).val() == "undefined") return false;
		await ui.startProject($(this).val());
	});

	
	$("#export").on("click", function(e) {
		$(this).val("");
	})
	$("#exportDir").on("click", function(e) {
		$(this).val("");
	})
	$("#export").on("change", function(e) {
		if ($(this).val() == "") return false;
		
		var currentValue = $(this).val();
		ui.exportPreparationDialog(currentValue, {
			useTagSelection:true,
			wordWrapOption:true,
			onDone:function(options) {
				// ver 3 change 
				options = options || {};
				var optionData = $("#dialogExport").data("options");
				if (typeof optionData == "object") options.files = options.files || optionData.files;
				// end of ver 3 change
				trans.export(currentValue, {
						mode:"zip",
						onDone: function() {
							ui.closeExportDialog();
						},
						'options':options
					});	
			}
		})
			
	});
	$("#exportDir").on("change", function(e) {
		if ($(this).val() == "") return false;

		var currentValue = $(this).val();
		ui.exportPreparationDialog(currentValue, {
			useTagSelection:true,
			wordWrapOption:true,
			onDone:function(options) {
				// ver 3 change 
				options = options || {};
				var optionData = $("#dialogExport").data("options");
				if (typeof optionData == "object") options.files = options.files || optionData.files;
				// end of ver 3 change				
				trans.export(currentValue, {
						mode:"dir",
						onDone: function() {
							ui.closeExportDialog();
						},
						'options':options
					});	
			}})
	});
	$(".button-export").on("click", function() {
		ui.openExportDialog({files:[]});
	})
	$(".button-import").on("click", function() {
		// Only one import source exists right now (.slrproj), so skip the
		// "Select Import Mode" dialog and open the importer directly. When more
		// import options are added, switch this back to ui.openImportDialog().
		ui.openImportSlrprojDialog();
	})
	

	// Legacy/unused: .trans import wiring. The #importTrans input is hidden in the UI; these bindings are retained but inert.
	/*
	$("#importTrans").on("click", function() {
		$(this).val("");
	})
	$("#importTrans").on("input", function() {
		//var conf = confirm("Do you want to import : \n"+$(this).val());
		ui.openImportTrans($(this).val());
	})
	*/
	
	
	$(".menu-button.contextTool").on("click", function() {
		ui.showBusyOverlay();
		setTimeout(function() {
			ui.contextToolDialog();
		}, 250);
		
	});
	$(".menu-button.executeScript").on("click", function() {
		var options = {
			workspace: "global"
		}
		ui.openAutomationEditor("codeEditor_global", options);
	})
	$(".menu-button.toggle-activeCellInfo").on("click", function() {
		ui.toggleActiveCellInfo()

	});	
	
	
	$(".button-clipboard").on("click", function() {
		$(this).toggleClass("checked");
		sys.toggleAutoClipboard($(this).hasClass("checked"));
	});
	
	$(".button-options").on("click", function() {
		//$(this).toggleClass("checked");
		ui.openOptionsWindow();
	});
	$(".button-properties").on("click", function() {
		ui.openProjectProperties();
		
	});
	$(".button-help").on("click", function() {
        ui.openHelp();
    });

	$(".button-translationSetup").on("click", function() {
		ui.openOptionsWindow({ tab: "dslr" });
	});

	$(".menu-button.toolsMenuBtn").on("click", function(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		ui.toolsMenu.toggle($(this));
	});
	// Any action chosen from the overflow menu closes it. The menu buttons keep
	// their own direct click handlers, so this only adds the close behavior.
	$(document).on("click.toolsMenuClose", ".toolbarToolsMenu .menu-button", function() {
		ui.toolsMenu.close();
	});


	$("#dialogImport .importSlrproj").on("click", function() {
		if ($("#dialogImport").hasClass("initialized") && $("#dialogImport").dialog("isOpen")) {
			$("#dialogImport").dialog("close");
		}
		ui.openImportSlrprojDialog();
	});
	
	
	// File selection panel bottom bar
	$(".bottomToolbar .controlCheck").on("click", function() {
		console.log("clicking 3 state checkbox");
		var state = $(this).data("state")||0;

		
		if (Boolean(state) == false) { //default
			ui.fileSelectorState = [];
			var $fileSelector = $(".fileList .data-selector .fileCheckbox:checked");
			for (var i=0; i<$fileSelector.length; i++) {
				ui.fileSelectorState.push($fileSelector.eq(i).attr("value"));
			}			
		}
		
		state++;
		if (state > 2) state=0;
		$(this).data("state", state);
		console.log(state);
		var stateClass = ["ovDefault", "ovCheck", "ovNoCheck"];
		$(this).find(".ovLine").removeClass("ovNoCheck");
		$(this).find(".ovLine").removeClass("ovCheck");
		$(this).find(".ovLine").removeClass("ovDefault");
		console.log(stateClass[state]);
		$(this).find(".ovLine").addClass(stateClass[state]);


		$(this).find(".ovLine").removeClass("icon-check-empty");
		$(this).find(".ovLine").removeClass("icon-check");
		$(this).find(".ovLine").removeClass("icon-minus-squared-alt");
		
		if (stateClass[state] == "ovCheck") {
			$(this).find(".ovLine").addClass("icon-check");
		} else if (stateClass[state] == "ovNoCheck") {
			$(this).find(".ovLine").addClass("icon-check-empty");
		} else {
			$(this).find(".ovLine").addClass("icon-minus-squared-alt");
		}

		
		if (stateClass[state] == 'ovCheck') {
			let $fileSelector = $(".fileList .data-selector .fileCheckbox");
			$fileSelector.prop("checked", true);
		} else if (stateClass[state] == 'ovNoCheck') {
			let $fileSelector = $(".fileList .data-selector .fileCheckbox");
			$fileSelector.prop("checked", false);
		} else if (stateClass[state] == 'ovDefault') {
			let $fileSelector = $(".fileList .data-selector .fileCheckbox");
			$fileSelector.prop("checked", false);
			for (let i=0; i<$fileSelector.length; i++) {
				if (ui.fileSelectorState.includes($fileSelector.eq(i).attr("value"))) {
					$fileSelector.eq(i).prop("checked", true);
				}
			}
		}
		$(".data-selector input[type=checkbox]").trigger("change");
		
	});
	
	$(".bottomToolbar .invertSelection").on("click", function() {
		trans.invertSelection();
	});
	
	$(".bottomToolbar .removeSelected").on("click", function() {
		ui.deleteFiles();
	});
	
	$(".bottomToolbar .addObject").on("click", function() {
		ui.addNewObjectDialog();
	});
	
	$(".resizeFont").on("click", function(e) {
		ui.openTextResizer($(this), $($(this).attr("data-for")));
	});
	

	$(".gotoCurrentCell").on("click", function(e) {
		if (empty(trans.lastSelectedCell)) return;
		trans.grid.scrollViewportTo(trans.lastSelectedCell[0],trans.lastSelectedCell[1]);
	})
	
	$(".menu-button.filePropertiesMenu").on("click", function(e) {
		ui.openFileProperties(trans.getSelectedId());
	});
	// Legacy/unused: .trans "Import Here" toolbar handler. Button is hidden in the UI; retained but inert.
	/*
	$(".menu-button.importHere").on("click", function(e) {
		if (Boolean(trans.getSelectedId()) == false) return;

		ui.openFileDialog({
			accept:".trans",
			onSelect : function(path) {
				ui.openImportTrans(path, {
					mode:1,
					defaultSelection:[trans.getSelectedId()]
				})
			}
		})

	});
	*/
	
	
	$(".menu-button.addNote").on("click", function(e) {
		if ($(this).hasClass("checked")) {
			ui.closeFileNote();
		} else {
			ui.openFileNote();
		}
	});
	
	$(".menu-button > .find").on("click", function(e){
		ui.openSearchWindow();
	});
	
	$(".menu-button > .button-find.menuSide").on("click", function(ev) {
		ev.preventDefault();
		ui.openSearchMenu();
	});

	$(".menu-button > .button-gridInfo.gridInfo").on("click", function(ev) {
		ev.preventDefault();
		ui.toggleGridInfo();
	});
	$(".menu-button > .button-gridInfo.menuSide").on("click", function(ev) {
		ev.preventDefault();
		ui.openGridInfoMenu();
	});

	$(".menu-button.sceneGraphBtn").on("click", function(ev) {
		ev.preventDefault();
		if (typeof trans.showSceneGraphPanel === "function") {
			trans.showSceneGraphPanel();
		}
	});


	$(".menu-button.wordWrapTable").on("click", function(e){
		ui.togglePreWhitespaces();
	});
	$(".menu-button.monospace").on("click", function(e){
		ui.toggleMonoSpace();
	});
	
	
	
	$(".menu-button.removeTranslation").on("click", function(e) {
		var conf= confirm("Are you realy sure want to delete all translation on current page?\nWarning: this is irreversible action!");
		if (conf) {
			trans.removeAllTranslation(trans.getSelectedId(), {refreshGrid:true});
		}
	});

	$(".panelLeftTabHandler").on("click", function() {
		ui.resize.toggleCollapse();
	});
	
	/* LEFT PANE */
	$("#currentCoordinate").on("change", function() {
		console.log("selecting cell : ", $(this).val());

		var $this = $(this);
		var value = $this.val();
		var coord = value.split(",");
		var row = parseInt(coord[0]-1);
		var col = parseInt(coord[1]-1);
		if (trans.selectCell(row, col) == false) {
			// do nothing
		}
	});
	
	$(".panel-left .panel-switcher").on("click", function(e) {
		ui.switchLeftPane($(this).attr("data-for"));
		
	});
	
	
	
	$(".currentCellTextCtrl .wordWrap").on("click", function() {
		$(this).toggleClass("checked");
		ui.toggleWordWrapCurrentCellPane($(this).hasClass("checked"));
	});
	
	$(".cellInfoCtrl .wordWrap").on("click", function() {
		$(this).toggleClass("checked");
		ui.toggleWordWrapRomajiPane($(this).hasClass("checked"));
	});
	
	$(".ceOptions").on("click", function() {
		ui.currentCellTextOptionsOpen();
	})
	$(".copyOriginal").on("click", function() {
		var thisRow = trans.lastSelectedCell[0];
		if (trans.data[thisRow][0]) document.querySelector("#currentCellText").insertAtCaret(trans.data[thisRow][0]);
		$("#currentCellText").trigger("change")
	})
	$(".contextTranslateHelp").on("click", function() {
		docsHelp.open("context-translation");
	})


	$("#introWindow .closeIntroWindow").on("click", function() {
		ui.introWindowClose();
	})
	$("#introWindow .newProject").on("click", function() {
		//$("#startProject").trigger("click");
		//ui.introWindowClose();
		ui.newProjectDialog.open();
	});
	$("#introWindow .openProject").on("click", function() {
		$("#openFile").trigger("click");
		ui.introWindowClose();
	});
	$("#introWindow .nextTips").on("click", function() {
		ui.showRandomTip();

	});
	
	$(".pathinfoWrapper > i").on("click", function() {
		$(".data-selector.selected")[0].scrollIntoView({
			behavior: "smooth",
			block:"center"
		})
	})


	$(document).on("windowResizeStop", function() {
		var maxHeight = $(window).height()-120;
		$(".panel-wrapper").resizable( "option", "maxHeight", maxHeight );
		var negativeHeight = $(".panel-wrapper.ui-resizable").height() + 100;
		$(".cellInfoTabContent").css("height", "calc(100vh - "+negativeHeight+"px)");
		ui.fixCellInfoSize();
	});

	// ==============================================================
	// TABLE
	// ==============================================================
	
	$("#currentCellText").on("change", function(e){
		console.log("text editor changed");
		if ($(this).data("column") == 0) {
			if (trans.isLastRow($(this).data("row")) == false) return false;
		}
		if (typeof $(this).data("row") == 'undefined') return false;
		trans.grid.setDataAtCell($(this).data("row"),$(this).data("column"),$(this).val());
	})
	
	$("#currentCellText").on("focus", function(e) {
		if (typeof trans.lastSelectedCell == 'undefined') return false;
		// starting from 3.7.14
		//$("#table .currentCell").removeClass("currentCell");
		//$("#table .current.highlight").addClass("currentCell");

		/*
		$("#table .currentCell").removeClass("currentCell");
		var scrolled = ui.scrollToView(trans.lastSelectedCell[0], trans.lastSelectedCell[1], function(newRow, newCol) {
			var targetRow = newRow-this.rowOffset();
			var targetCol = newCol-this.colOffset();
			console.log("target", targetRow, targetCol);
			ui.selectedCell = $(".ht_master .htCore tbody tr").eq(targetRow).find("td").eq(targetCol);
			ui.selectedCell.addClass("currentCell");			
		});
		
		if (!scrolled) {
			var rowOffset = trans.lastSelectedCell[0]-trans.grid.rowOffset();
			var colOffset = trans.lastSelectedCell[1]-trans.grid.colOffset();
			console.log("Offset", rowOffset, colOffset);
			ui.selectedCell = $(".ht_master .htCore tbody tr").eq(rowOffset).find("td").eq(colOffset);
			ui.selectedCell.addClass("currentCell");
			
			var overlay;
			overlay = $(".ht_clone_left .htCore tbody tr").eq(rowOffset).find("td").eq(colOffset);
			overlay.addClass("currentCell");
			
		}
		*/

		
		// adding common autocomplete by same cols
		if (ui.autoCompleteIsEnabled()) {
			ui.words ||= [];
			if (typeof trans[trans.gameEngine] !=='undefined') trans[trans.gameEngine].setAutocompleteData();
			
			for (var i=0; i< trans.data[trans.lastSelectedCell[0]].length; i++) {
				var thisCell = trans.data[trans.lastSelectedCell[0]][i]||"";
				if (typeof thisCell !== "string") continue;
				thisCell = thisCell.replace(/[.,]/g, ""); 
				var newAutoCorrect = thisCell.split(" ");
				for (var x=0; x<newAutoCorrect.length; x++) {
					if (newAutoCorrect[x].length < 3) continue;
					if (ui.words.includes(newAutoCorrect[x])) continue;
					ui.words.push(newAutoCorrect[x]);
				}
			}
		}
		
	});
	

	$("#currentCellText").on("blur", function(e) {
		console.log("currentCellTextBlur");
		//$(".ht_master .htCore tbody tr .currentCell").removeClass("currentCell");
		$("#table tbody tr .current").removeClass("current highlight");
		//trans.grid.selectCell(trans.lastSelectedCell[0], trans.lastSelectedCell[1])
	});
	
	// ==============================================================
	// HANDLING DROP EVENTS
	// ==============================================================
	// // prevent default behavior from changing page on dropped file
	// window.ondragover = function(e) { e.preventDefault(); return false };
	// // NOTE: ondrop events WILL NOT WORK if you do not "preventDefault" in the ondragover event!!
	// window.ondrop = function(e) { e.preventDefault(); return false };

	// const holder = $("body")[0];
	// holder.ondragover = function () { this.className = 'hover'; return false; };
	// holder.ondragleave = function () { this.className = ''; return false; };
	// holder.ondrop = function (e) {
	// 	e.preventDefault();
	// 	console.log("drop");
	// 	for (let i = 0; i < e.dataTransfer.files.length; ++i) {
	// 		console.log(e.dataTransfer.files[i].path);
	// 		if (trans.isFileSupported(e.dataTransfer.files[i].path)) {
	// 			console.log("file is supported !");
	// 			trans.openFile(e.dataTransfer.files[i].path);
	// 		} else {
	// 			console.log("file is not supported !");
	// 		}
	// 	}
	// 	return false;
	// };
	const dropFileToMainWindow = new (require("www/js/DropFileToWindow.js"))($("#mainArea"), {
        hoverText: "Drop .slrproj file here!",
        supportedFiles: [".slrproj"],
        onSupportedFileDrop: (filePath)=> {
            trans.openFile(filePath);
        }
    });
    dropFileToMainWindow.init();
	const dropFileToIntroWindow = new (require("www/js/DropFileToWindow.js"))($("#introWindow"), {
        hoverText: "Drop .slrproj file here!",
        supportedFiles: [".slrproj"],
        onSupportedFileDrop: (filePath)=> {
            trans.openFile(filePath);
        }
    });
    dropFileToIntroWindow.init()

	// ==============================================================
	// HANDLING KEYBOARD SHORTCUTS
	// ==============================================================
	// Disable midle click from opening new application window
	document.addEventListener("auxclick", function(e){
		if (e.button === 1) {
			// Check if it is a link (a) element; if so, prevent the execution.
			if (e.target.tagName.toLowerCase() === "a") {
				console.log("middle click on A element");
				e.preventDefault();
			}
		}		
	});	

	
	$(document).on("click", "[data-help-page]", function() {
		docsHelp.open($(this).data("help-page"), $(this).data("help-anchor"));
	});

	$(document).on('keydown', function(e) {
		var keyCode = e.keyCode || e.which;

		switch (keyCode) {

			case 112 : //F1, about
				e.preventDefault();
				console.log("opening help command");
				ui.openHelp();

			break;		
			case 27 : //esc, close active windows
				e.preventDefault();
				ui.introWindowClose();
			break;		
			case 122 : //F11, Full screen
				var win = win || nw.Window.get();
				win.maximize();
			break;		
		}

		// EDITING COMMAND
		if (e.ctrlKey && e.shiftKey ) {
			switch(keyCode) {
				case 67 : //SHIFT+c
					e.preventDefault();
					console.log("Pressing CTRL+shift+c");
					var text = trans.getSelectedTextsAsOneLine();
					var clipboard = nw.Clipboard.get();
					clipboard.set(text);
				break;
				case 71 : //SHIFT+g
					e.preventDefault();
					console.log("Pressing CTRL+shift+g");
					trans.translateSelectionAsOneLine();
				break;
			}
		} else if (e.ctrlKey) {
			switch(keyCode) {
				case 79 : //o
					e.preventDefault();
					console.log("Pressing CTRL+o");
					trans.open();
				break;
				case 83 : //s
					e.preventDefault();
					console.log("Pressing CTRL+s");
					trans.save();
					//saveData();
				break;
				case 70 : //f
					e.preventDefault();
					(async () => {
						//await common.wait(200);
						console.log("Pressing CTRL+f");
						ui.openSearchWindow();
					})();

				break;
				case 71 : //g
					e.preventDefault();
					console.log("Pressing CTRL+g");
					trans.translateSelection();
					//trans.translateSelectionByLine();
				break;
				case 72 : //h
					e.preventDefault();
					console.log("Pressing CTRL+h");
					ui.openSearchWindow("replace");
				break;
				case 68 : //d
					e.preventDefault();
				console.log("Pressing CTRL+d");
			break;
				case 76 : //l
					e.preventDefault();
					trans.translateAllBySelectedCells();
				break;
				case 84 : //t
					e.preventDefault();
					ui.taggingDialog(trans.grid.getSelectedRange());
				break;

			}
		} else if (e.altKey) {
			switch(keyCode) {

				case 46 : //alt delete (remove context translation)
					e.preventDefault();
					$(document).trigger("clearContextTranslationByRow", {file:trans.getSelectedId(), row:trans.grid.getSelectedRange(), type:"range"});
				break;
			}			
		} else if (e.shiftKey) {
			switch(keyCode) {
				case 46 : //shift delete (remove selected row)
					e.preventDefault();
					var conf = confirm("Do you want to remove the currently selected row(s)?");
					if (!conf) return;
					trans.removeRow(trans.getSelectedId(), common.gridSelectedRows());
					trans.grid.render();
					trans.grid.deselectCell();

				break;
			}
			
		}
	});		
	
	// ==================================================
	// numpad enter everywhere on screen
    window.onkeydown=function(ev) {
		var e= ev || window.event;
		var key = e.keyCode
		if ((key===13) && (e.location===3)) {
			e.preventDefault();
			// go to next row
			
			if (typeof trans.lastSelectedCell == 'undefined') return false;
			var editorHasFocus = false;
			if ($("#currentCellText").is(":focus")) {
				$("#currentCellText").trigger("blur");
				editorHasFocus = true;
				trans.grid.addHookOnce('afterSelectionEnd', function() {
					ui.currentCellTextFocus()				
				})				
			}
			//trans.doAfterSelection(trans.lastSelectedCell[0]+1,trans.lastSelectedCell[1]);
			ui.selectNextRow(true);
			// if clipboard is monitored
			if (sys.isClipboardMonitored) {
				sys.afterSelectionAction(trans.lastSelectedCell[0],0);
			}
			//trans.grid.selectCell(trans.lastSelectedCell[0]+1,trans.lastSelectedCell[1]);
			if (editorHasFocus) {

				//console.log("last value : ");
				//console.log(trans.grid.getCellMeta(trans.lastSelectedCell[0]+1,trans.lastSelectedCell[1]).instance.getValue());
				//$("#currentCellText").val(trans.grid.getCellMeta(trans.lastSelectedCell[0]+1,trans.lastSelectedCell[1]).instance.getValue());
				ui.currentCellTextFocus()
				
				//$("#currentCellText").trigger("focus");
				//$("#currentCellText")[0].select();				
			}
		} else if (key == 27) {
			trans.grid.deselectCell()
		} else if (key == 40 && e.altKey) {
			console.log("alt down pressed");

			e.preventDefault();
			trans.goToNextUntranslated();
		} else if (key == 38 && e.altKey) {
			console.log("alt up pressed");

			e.preventDefault();
			trans.goToPreviousUntranslated();
		}
	}
	

	$("#currentCellText").on('input', function(e) {
		var $that = $(this);
		ui._cache = ui._cache || {};
		ui._cache.lastCellLineNumber = ui._cache.lastCellLineNumber || 0;
		if (ui._cache.bgNumberProcessing) {
			clearTimeout(ui._cache.bgNumberProcessing);
			ui._cache.bgNumberProcessing = setTimeout(function() {
				
				var currentLineNumber = $that.val().split("\n").length;
				if (ui._cache.lastCellLineNumber !== currentLineNumber) {
					ui._cache.lastCellLineNumber = currentLineNumber;
					ui.generateBackgroundNumber($that, currentLineNumber);
				}
				
				//console.log("input delayer triggered");
				ui._cache.bgNumberProcessing = undefined;
			}, 200);		

			return;
		}
		
		ui._cache.bgNumberProcessing = setTimeout(function() {
			
			var currentLineNumber = $that.val().split("\n").length;
			if (ui._cache.lastCellLineNumber !== currentLineNumber) {
				ui._cache.lastCellLineNumber = currentLineNumber;
				ui.generateBackgroundNumber($that, currentLineNumber);
				
			}
			
			//console.log("input delayer triggered");
			ui._cache.bgNumberProcessing = undefined;
		}, 200);
		
		
	
	});


	
	$("#currentCellText").on('keydown', function(e) {
		var keyCode = e.keyCode || e.which;
	

		// EDITING COMMAND
		if (e.ctrlKey) {
			var thisRow;
			switch(keyCode) {
				case 48 : //0
					e.preventDefault();
					console.log("Pressing CTRL+0");
					//var thisRow = $("#currentCellText").data("row");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][0]) document.activeElement.insertAtCaret(trans.data[thisRow][0]);
					$("#currentCellText").trigger("change")
				break;
				case 49 : //1
					e.preventDefault();
					console.log("Pressing CTRL+1");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][1]) document.activeElement.insertAtCaret(trans.data[thisRow][1]);
					$("#currentCellText").trigger("change")
				break;
				case 50 : //2
					e.preventDefault();
					console.log("Pressing CTRL+2");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][2]) document.activeElement.insertAtCaret(trans.data[thisRow][2]);
					$("#currentCellText").trigger("change")
				break;
				case 51 : //3
					e.preventDefault();
					console.log("Pressing CTRL+3");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][3]) document.activeElement.insertAtCaret(trans.data[thisRow][3]);
					$("#currentCellText").trigger("change")
				break;
				case 52 : //4
					e.preventDefault();
					console.log("Pressing CTRL+4");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][4]) document.activeElement.insertAtCaret(trans.data[thisRow][4]);
					$("#currentCellText").trigger("change")
				break;
				case 53 : //5
					e.preventDefault();
					console.log("Pressing CTRL+5");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][5]) document.activeElement.insertAtCaret(trans.data[thisRow][5]);
					$("#currentCellText").trigger("change")
				break;
				case 54 : //6
					e.preventDefault();
					console.log("Pressing CTRL+6");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][6]) document.activeElement.insertAtCaret(trans.data[thisRow][6]);
					$("#currentCellText").trigger("change")
				break;
				case 55 : //7
					e.preventDefault();
					console.log("Pressing CTRL+7");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][7]) document.activeElement.insertAtCaret(trans.data[thisRow][7]);
					$("#currentCellText").trigger("change")
				break;
				case 56 : //8
					e.preventDefault();
					console.log("Pressing CTRL+8");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][8]) document.activeElement.insertAtCaret(trans.data[thisRow][8]);
					$("#currentCellText").trigger("change")
				break;
				case 57 : //9
					e.preventDefault();
					console.log("Pressing CTRL+9");
					thisRow = trans.lastSelectedCell[0];
					if (trans.data[thisRow][9]) document.activeElement.insertAtCaret(trans.data[thisRow][9]);
					$("#currentCellText").trigger("change")
				break;

			}
		}
		
	});
	
	// Open .externalLink anchor to native browser
	$("a.externalLink, a[external]").on("click", function(e) {
		e.preventDefault();
		nw.Shell.openExternal($(this).attr("href"));
	})

	
	// =============================================================
	// HANDLING TEXTAREA SUGGESTION
	// =============================================================
	
	/*
	window.elements = ['span', 'div', 'h1', 'h2', 'h3'];
	$('#currentCellText').textcomplete([
		{ // html
			match: /<(\w*)$/,
			search: function (term, callback) {
				callback($.map(elements, function (element) {
					return element.indexOf(term) === 0 ? element : null;
				}));
			},
			index: 1,
			replace: function (element) {
				return ['<' + element + '>', '</' + element + '>'];
			}
		}
	]);	
	*/
	
	// window.elements = ['span', 'div', 'h1', 'h2', 'h3'];	
	$('#currentCellText').textcomplete([
		{	
			match: /(^|\b)(\w{1,})$/,
			//match: /(^|\b)(.*?)$/,
			search: function (term, callback) {
				
				callback($.map(ui.words || [], function (word) {
					return word.indexOf(term) === 0 ? word : null;
				}));
			},
			replace: function (word) {
				return word + ' ';
			}
		},
		// { // html
		// 	match: /<(\w*)$/,
		// 	search: function (term, callback) {
		// 		callback($.map(window.elements, function (element) {
		// 			return element.indexOf(term) === 0 ? element : null;
		// 		}));
		// 	},
		// 	index: 1,
		// 	replace: function (element) {
		// 		return ['<' + element + '>', '</' + element + '>'];
		// 	}
		// },
		{ // html
			//mentions: ['yuku_t'],
			match: /\B\\(\w*)$/,
			search: function (term, callback) {
				//callback($.map(this.mentions, function (mention) {
				callback($.map(ui.autoComplateData, function (mention) {
					return mention.indexOf(term) === 0 ? mention : null;
				}));
			},
			index: 1,
			replace: function (mention) {
				return mention + '';
			}
		}
	
	]);	
	
	// =============================================================
	// FILTERABLE 
	// =============================================================
	window.commandOption = {
		valueNames: [
			'filterable',
			{ data: ['id'] }
		]
	};	
	ui.fileList = new window.List('menuPanel', window.commandOption);		

	ui.isLoaded = true;
	
	
	ui.cellInfoTab = new ui.CellInfoTab($(".cellInfoPartsA"));
	ui.cellTranslationTab = new ui.CellInfoTab($(".cellInfoPartsB"), {eventName:"translationOnTabChange"});
	
	// initialization 
	ui.resize.init();
	
	$("#busyOverlay").removeClass("pitchBlack");
	//$("#busyOverlay").addClass("hidden");
	ui.fixCellInfoSize();
	// close all child window in initialization
	//ui.closeAllChildWindow(true);
	
	sys.onReady(function() {
		ui.init();
	})
	ui.initTextResizer();
	// The lower editor toolbar (notes, find, toggles, path, quick find) is
	// registered as a ui.Toolbar so addons (e.g. Rikai) can add buttons to it.
	ui.editorToolbar = new ui.Toolbar({ id: "editor-tools", container: ".panel-right" });
	ui.toolsMenu.init();
	ui.toolbarLabelFit.init();
	ui.isInitialized = true;
	ui.introWindowShow();
	ui.onReady(function() {});
	ui.trigger("ready");
	console.warn("Removing busy overlay");
	if (!window.addonLoader) {
		ui.hideBusyOverlay();
	} else {
		window.addonLoader.onReady(() => {
			ui.hideBusyOverlay();
		});
	}
});

