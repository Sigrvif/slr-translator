const { shim } = require('regexp-match-indices'); // eslint-disable-line
const optionSectionState = require("www/js/optionSectionState.js");

var options = {};
var win = nw.Window.get();
// The window is opened hidden (see ui.openOptionsWindow) and revealed at the
// end of this file once the UI is built. Calling win.show() here would reveal
// it immediately, i.e. as the default white canvas.
win.setResizable(true);

var $DV 	= window.opener.$DV;
var trans 	= window.opener.trans;
var sys 	= window.opener.sys;
var addonLoader = window.opener.addonLoader;
var fs 		= require('fs');
var info 	= window.opener.info;
var updater	= window.opener.updater;
var Updater	= window.opener.Updater;
var langTools = window.opener.langTools;
var TranslatorEngine = window.opener.TranslatorEngine;

/**
 * Triggered when option window is opened
 * @event ui#optionsWindowOpened
 * @since 4.3.20
 */
window.opener.ui.trigger("optionsWindowOpened");



trans.project = trans.project||{};
trans.project.options = trans.project.options||{};

options.__onBeforeClose = [];
options.onBeforeCloseRunOnce = function(fn) {
	if (typeof fn !== 'function') return console.info("Argument is not a function", fn)
	options.__onBeforeClose.push(fn);
}

options.localStorage = new (require("www/js/lib/localStore.js"))("options");


options.initLanguageList = function() {
	var langList = common.getLanguageCode();
	if ($("#languageList").length > 0) return;
	var $languageList = $(`<datalist id="languageList"></datalist>`);
	for (var i in langList) {
		$languageList.append(`<option value="${i}">${langList[i]}</option>`);
	}
	$("#template").append($languageList);
}

options.needRestart = false;
options.requestRestart = function() {
	this.needRestart = true;	
}

options.isNeedRestart = function() {
	if (options.needRestart) {
		alert("Some configuration require you to restart the application to take effect.\nPlease save your work, and restart SLR.");
	}
}

options.updateLanguageSelectors = function() {
	options.drawLanguageSelector($("#sl"),'sl', sys.config.default.sl);
	options.drawLanguageSelector($("#tl"),'tl', sys.config.default.tl);

	if ($("#language .languagePair").hasClass("initialized")) {
		$("#sl").trigger("input")
		$("#tl").trigger("input")
		return;
	}
	$("#sl").on("input", function() {
		var $this = $(this)
		$this.closest(".fieldLine").find("label .attention").remove();

		if (!$this.val()) {
			$this.addClass("error");
			$this.closest(".fieldLine").find("label").append(`<i class="attention icon-attention red" title="Please select a language"></i>`);

		} else {
			$this.removeClass("error");

		}

		/**
		 * Triggered when the default translator is changed
		 * @event Trans#languageChange
		 * @param  {String} sl - Source language
		 * @param  {String} tl - Target language
		 * @since 4.12.10
		 */
		trans.trigger("languageChange", [$("#sl").val(), $("#tl").val()])
	})
	$("#tl").on("input", function() {
		var $this = $(this)
		$this.closest(".fieldLine").find("label .attention").remove();

		if (!$this.val()) {
			$this.addClass("error");
			$this.closest(".fieldLine").find("label").append(`<i class="attention icon-attention red" title="Please select a language"></i>`);
		} else {
			$this.removeClass("error");
		}
		trans.trigger("languageChange", [$("#sl").val(), $("#tl").val()])

	})
	$("#sl").trigger("input")
	$("#tl").trigger("input")
	$("#language .languagePair").addClass("initialized")
}


options.drawTranslatorSelector = function($obj, defaultVal) {
	defaultVal = defaultVal || "google";
	$obj.data("previousValue", defaultVal);
	if (!trans.getTranslatorEngine) return;
	if (!trans.translator) return;
	if (Array.isArray(trans.translator)) trans.translator.sort();
	for (var i=0; i<trans.translator.length; i++) {
		var thisTranslator = trans.getTranslatorEngine(trans.translator[i]);
		if (!thisTranslator) {
			console.warn("Can not process option for:", trans.translator[i]);
			continue;
		}
		$obj.append("<option value='"+trans.translator[i]+"'>"+thisTranslator.name+"</option>");
	}
	$obj.val(defaultVal);
	
	if ($obj.hasClass("eventApplied") == false) {
		$obj.on("change.updater", function(e) {
			trans.project.options = trans.project.options||{};
			trans.project.options.translator = $(this).val();
			options.updateLanguageSelectors();
			// registering into sys
			try {
				sys.config.translator = $(this).val();
				sys.saveConfig();
			} catch (e) {
				console.info("error writing sys.config", e);
			}
		})
		$obj.addClass("eventApplied")
	}
	
	// initializing;
	$obj.trigger("change");

	$obj.on("change", function() {
		var $this = $(this);
		// store old value
		var oldValue = $(this).data("previousValue");
		// set old value to new value;
		$(this).data("previousValue", $this.val());
		options.updateLanguageSelectors();
		// trigger event
		
		/**
		 * Triggered when the default translator is changed
		 * @event Trans#translatorIsChanged
		 * @param  {String} oldTranslator - The id of the old translator
		 * @param  {String} newTranslator - The id of the new Translator
		 * @since 4.3.20
		 */
		options.trigger("translatorIsChanged", [$this.val(), oldValue])
		trans.trigger("translatorIsChanged", [$this.val(), oldValue]);
	})

	return $obj;
}

options.drawLanguageSelector = function($obj, id, defaultVal, options) {
	var languages;
	try {
		var thisTranslator = sys.config.translator||trans.project.options.translator;
		var keyName = "sourceLanguages"
		if (id == "tl") {
			keyName = "targetLanguages"
		}
		var thisEngine = trans.getTranslatorEngine(thisTranslator);
		languages = (thisEngine && (thisEngine[keyName] || thisEngine.languages)) || consts.defaultLanguages || {};
	} catch (e) {
		languages = consts.defaultLanguages||{};
	}
	
	$obj.empty();
	options = options||{};
	options.disableChoice = options.disableChoice||[];
	if (typeof(defaultVal) == 'undefined') {
		defaultVal = 'en';
		if (id == 'sl') defaultVal = 'ja'; 
	}
	
	for (var langCode in languages) {
		var $opt;
		//var langDBData = langTools.lookupDB(langCode, languages[langCode])
		var langDBData = langTools.getLanguage(langCode, languages[langCode])
		if (langDBData) {
			$opt = $(`<option value="${langDBData.id}">${langTools.getFullName(langDBData)}</option>`);
		} else {
			$opt = $("<option value='"+langCode+"'>"+languages[langCode]+"</option>");
		}

		if (options.disableChoice.includes(langCode)) $opt.prop("disabled", true);
		$obj.append($opt);
	}
	$obj.val(defaultVal);

	if ($obj.hasClass("eventApplied") == false) {
		$obj.on("change.updater", function(e) {
			sys.config.default[id] = $(this).val();
			$DV.config[id] = $(this).val();		
		})
		$obj.addClass("eventApplied")
	}

	
	return $obj;
}

options.applyAll =function($obj) {
	$obj = $obj||$("body");
	
	$obj.find("input").trigger("change");
	$obj.find("select").trigger("change");
	$obj.find("textarea").trigger("change");
}




// ===================================================
// Handling tab
// ===================================================
options.tab = {};
options.tab.select = function($obj) {
	$obj.closest(".tabMenu").find("li.selectable").removeClass("selected");
	$obj.addClass("selected");
	let $panelContents = $(".panel-right .panelContent");
	$panelContents.removeClass("activeTab");
	$panelContents.addClass("hidden");
	
	let thisRef = $obj.data("for");
	let $targetObj = $("#"+thisRef);
	if ($targetObj.length > 0) {
		$targetObj.removeClass("hidden");
		$targetObj.addClass("activeTab");
	}
	if (typeof $obj.data("onOptionSelected") == "function") {
		$obj.data("onOptionSelected")($targetObj, $obj);
	}
}

options.tab.insertBefore = function(id, title, $insertBefore, options) {
	options = options||{};
	options.icon = options.icon||"";
	options.tabClass = options.tabClass||"";
	var $tab = $('<li data-for="'+id+'" class="selectable '+options.tabClass+'"><a>'+(options.icon?('<i class="icon-'+options.icon+'"></i>'):'')+'<span class="menuTitle">'+title+'</span></a></li>');
	$tab.insertBefore($insertBefore);
	$tab.attr("data-keyword", title);
	if (typeof options.onSelect == "function") $tab.data("onOptionSelected", options.onSelect);
	
	var $tabContent = $('<div class="panelContent '+id+'" id="'+id+'"></div>');
	$(".panel-right").append($tabContent);
	
	return {tab:$tab, content:$tabContent};
}

options.tab.insertAfter = function(id, title, $insertAfter, options) {
	options = options||{};
	options.icon = options.icon||"";
	options.tabClass = options.tabClass||"";
	options.tabContent = options.tabContent||"";

	var $tab = $('<li data-for="'+id+'" class="selectable '+options.tabClass+'"><a>'+(options.icon?('<i class="icon-'+options.icon+'"></i>'):'')+'<span class="menuTitle">'+title+'</span></a></li>');
	$tab.insertAfter($insertAfter);
	$tab.attr("data-keyword", title);
	if (typeof options.onSelect == "function") $tab.data("onOptionSelected", options.onSelect);

	var $tabContent = $('<div class="panelContent '+id+'" id="'+id+'"></div>');
	$tabContent.append(options.tabContent);
	$(".panel-right").append($tabContent);
	return {tab:$tab, content:$tabContent};
}

options.tab.init = function() {
	var $selectableMenu = $(".tabMenu li.selectable");
	$selectableMenu.each(function() {
		var $thisLi = $(this);
		$thisLi.off("click.selectTab");
		$thisLi.on("click.selectTab", function(e){
			options.tab.select($(this));
		})
	})
}

/**
 * Select an options tab by id, optionally pre-filling that panel's option filter.
 * Called from the main window through ui.openOptionsWindow({tab, filter}) so
 * "Translation Setup" and the Batch dialog can deep-link into the engine options.
 * Exposed on window so the opener can reach it when the window is already open.
 */
window.optionsFocusTab = function(tabId, filterText) {
	if (!tabId) return false;
	var $tab = $(".tabMenu li.selectable[data-for='" + tabId + "']");
	if ($tab.length === 0) return false;
	options.tab.select($tab);
	if (filterText) {
		var $search = $("#" + tabId).find(".optionSearchInput");
		if ($search.length) {
			$search.val(filterText).trigger("input");
		}
	}
	return true;
};

// ===================================================
// Handling translator options
// ===================================================
options.translatorMenu = {};

// CAUTION: this OVERWRITES schema[key]['default'] with the engine's CURRENT value on every
// render, so after the options dialog has opened schema[key].default is NOT the factory
// default anymore. The build-time factory-default snapshot lives in
// thisTranslator.optionsForm.defaults[key] (see OptionFormBuilder.build); prefer that or
// option.getDefault() whenever you need the real factory default. See www/js/Option.js §6.
options.translatorMenu.assignDefault = function(thisTranslator) {
	if (typeof thisTranslator.optionsForm == 'undefined') return thisTranslator;
	if (typeof thisTranslator.optionsForm.schema == 'undefined') return thisTranslator;
	
	for (var key in thisTranslator.optionsForm.schema) {
		if (typeof thisTranslator[key] == 'undefined') continue;
		thisTranslator.optionsForm.schema[key]['default'] = thisTranslator[key];
	}
	console.log("after assigning default :");
	console.log(thisTranslator);
	return thisTranslator;
	
}
	
options.translatorMenu.linkify = function(text) {
    var urlRegex =/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
    return text.replace(urlRegex, function(url) {
        return '<a href="' + url + '", target="_system">' + url + '</a>';
    });
}

options.translatorMenu.renderOptions = function(thisTranslator, $elm) {
	console.log("%cRendering options", "color:yellow;", thisTranslator.id)
	options.translatorMenu.assignDefault(thisTranslator);
	// The per-model panel keys are not engine options, so assignDefault cannot see their
	// values. Pin them from the persisted profile directly: jsonform renders a keyed field
	// from its schema default.
	try {
		var rawPanelProfiles = thisTranslator.getOptions ? thisTranslator.getOptions("runtimeModelProfiles") : "";
		var selectedPanelModel = thisTranslator.getOptions ? thisTranslator.getOptions("runtimeModel") : "";
		var panelMap = (typeof rawPanelProfiles === "string" && rawPanelProfiles !== "") ? JSON.parse(rawPanelProfiles)
			: ((rawPanelProfiles && typeof rawPanelProfiles === "object") ? rawPanelProfiles : {});
		var panelProfile = (panelMap && selectedPanelModel && typeof panelMap[selectedPanelModel] === "object") ? panelMap[selectedPanelModel] : {};
		for (var panelKey in thisTranslator.optionsForm.schema) {
			if (panelKey === "rtSpecMode") {
				thisTranslator.optionsForm.schema[panelKey].default =
					(panelProfile.specMode === "off") ? "off" : (panelProfile.draftId ? String(panelProfile.draftId) : "auto");
			} else if (panelKey === "rtMmprojMode") {
				thisTranslator.optionsForm.schema[panelKey].default =
					(panelProfile.mmprojMode === "off") ? "off" : (panelProfile.mmprojId ? String(panelProfile.mmprojId) : "auto");
			} else if (String(panelKey).indexOf("rtProfile_") === 0) {
				var panelField = String(panelKey).slice("rtProfile_".length);
				var panelValue = panelProfile[panelField];
				thisTranslator.optionsForm.schema[panelKey].default =
					(panelValue === undefined || panelValue === null || panelValue === "") ? "" : String(panelValue);
			}
		}
	} catch (e) { console.warn("Panel default pinning failed:", e); }
	try { if (typeof thisTranslator.onBeforeRenderOptions === "function") thisTranslator.onBeforeRenderOptions(); } catch (e) { /* never let a broken hook stop rendering */ }
	$elm ||= $("#"+thisTranslator.id+" .pluginOptions")
	// Which sections the user had expanded, captured BEFORE the old DOM is emptied. A rebuild
	// (model switch, stale-runtime-panel refresh) re-renders the form from scratch, and a fresh
	// render only opens the default-expanded sections - without this, switching models collapsed
	// every section the user had opened (the Bundled Local Runtime card in particular).
	var expandedSectionKeys = $elm.find("fieldset.option-section.expanded").map(function() {
		return optionSectionState.keyFromClass($(this).attr("class") || "");
	}).get().filter(function(key) { return !!key; });
	$elm.empty();
	// Strip jsonform's un-namespaced delegated legend-toggle (modules/jsonform/lib/jsonform.js ~L3867):
	// $elm.empty() drops the child fieldsets but not this container-level delegated handler, so
	// live re-renders accumulate it and a single legend click toggles twice (expand then collapse).
	$elm.off('click', '.expandable > legend');
	var jsonForm = $elm.jsonForm(thisTranslator.optionsForm);
	$elm.data("jsonForm", jsonForm);
	$elm.closest(".panelContent").data("translatorInfo", thisTranslator);

	console.log("rendering custom attr for translator engine:", thisTranslator.id, thisTranslator.optionsForm);
	for (var key in thisTranslator.optionsForm.schema) {
		var thisForm = thisTranslator.optionsForm.schema[key];
		if (!thisForm.attr) continue;
		console.log("rendering attr for:", key);
		var $thisField = $elm.find(`[name="${key}"]`);
		for (var attrKey in thisForm.attr) {
			$thisField.attr(attrKey, thisForm.attr[attrKey]);
		}
	}

	$elm.find(".help-block").each(function() {
		$(this).html(options.translatorMenu.linkify($(this).html()));
		$(this).find("a[target=_system]").on("click", function(e) {
			e.preventDefault();
			nw.Shell.openExternal($(this).attr("href"));
		})
	});
	options.translatorMenu.setupOptionFilter(thisTranslator, $elm, expandedSectionKeys);
	console.log(`Translator option: ${thisTranslator.id} JSON form:`, jsonForm);
	// to get the values:
	// jsonForm.root.getFormValues()
	// to set the values
	// let's create a function on translatorEngine to batch apply value

	// Commit the form's live values into the engine when the Options window closes. The
	// per-field change handlers are the primary write path; this close-time flush is the
	// safety net, reading the rendered values straight from the form tree - the per-model
	// panel keys through the profile patcher, everything else through the same update()
	// the field handlers call.
	options.flushOptionForms = function () {
		// The per-field change handlers are the primary write path and have
		// already committed every user edit at change time; this close-time
		// replay only ran on NORMAL user closes (the quit path force-closes
		// via close(true) and skips it), so it guarded nothing real. It DID
		// destroy saved options: jsonform getFormValues() reads unchecked
		// checkboxes and empty text fields back as ""/undefined/null, and
		// replaying those through update() overwrote real stored values with
		// JSON-droppable non-values - an option turned OFF from a default-ON
		// state silently reverted on every Options-window close (regression
		// bisected to between 3.068 and 3.073, where this flush was added).
		// Only the runtime per-model panel still needs the close-time commit:
		// its rtProfile_* fields write through applyPanelFlush.
		$(".panelContent").each(function () {
			var $panel = $(this);
			var info = $panel.data("translatorInfo");
			var jsonFormInstance = $panel.find(".pluginOptions").data("jsonForm");
			if (!info || !jsonFormInstance || !jsonFormInstance.root ||
				typeof jsonFormInstance.root.getFormValues !== "function") return;
			var values;
			try { values = jsonFormInstance.root.getFormValues(); } catch (e) { return; }
			if (!values || typeof values !== "object") return;
			try {
				if (typeof info.applyPanelFlush === "function") info.applyPanelFlush(values);
			} catch (e) { console.warn("Per-model panel flush failed:", e); }
		});
	};
	if (!options.__panelFlushRegistered) {
		options.__panelFlushRegistered = true;
		options.onBeforeCloseRunOnce(options.flushOptionForms);
	}
}

/**
 * Injects a "filter options" toolbar (search + "show changed only" + expand/
 * collapse all) above a rendered translator option form, and wires up live
 * filtering.
 *
 * Sections emitted as `expandable` by OptionFormBuilder render collapsed by
 * default (click the legend, or use Expand/Collapse all). When a search or the
 * "changed only" toggle is active, matching sections auto-expand and sections
 * without matches are hidden; clearing the filter restores the collapsed
 * default. Individual options are never permanently hidden.
 *
 * Rows are the .form-group leaves (not the <fieldset> section/role wrappers).
 * The current form values are read via the stored jsonForm instance so the
 * "changed" comparison is accurate even for ace/object fields.
 */
options.translatorMenu.setupOptionFilter = function(thisTranslator, $elm, expandedSectionKeys) {
	if (!thisTranslator.optionsForm || !thisTranslator.optionsForm.schema) return;
	const schema = thisTranslator.optionsForm.schema;
	// Factory defaults captured at form-build time. assignDefault() mutates
	// schema[key].default to the current value before render, so we must NOT use
	// schema[key].default for a "changed" comparison. Fall back to the live
	// schema default only if the snapshot is missing.
	const factoryDefaults = thisTranslator.optionsForm.defaults || {};

	// Inject styles once.
	if (!document.getElementById("optionFilterStyles")) {
		const style = document.createElement("style");
		style.id = "optionFilterStyles";
		style.textContent = `
			.pluginOptions .optionFilterToolbar { display:flex; gap:8px; align-items:center; margin:4px 0 10px; flex-wrap:wrap; }
			.pluginOptions .optionFilterToolbar .optionSearchInput { flex:1 1 240px; min-width:160px; }
			.pluginOptions .optionFilterToolbar .optionChangedToggle { display:inline-flex; align-items:center; gap:4px; user-select:none; cursor:pointer; white-space:nowrap; }
			.pluginOptions .optionFilterToolbar button { padding:2px 8px; }
			.pluginOptions fieldset.option-section { border:1px solid #ccc; border-radius:4px; padding:6px 10px; margin:10px 0; }
			.pluginOptions fieldset.option-section > legend { font-weight:bold; font-size:1.05em; padding:0 6px; width:auto; margin-bottom:0; }
			.pluginOptions fieldset.option-section.expandable > legend { cursor:pointer; }
			.pluginOptions fieldset.option-section.expandable > legend::before { content:"\\25B8\\00a0"; }
			.pluginOptions fieldset.option-section.expandable.expanded > legend::before { content:"\\25BE\\00a0"; }
			.pluginOptions fieldset.option-role-group { border:none; border-left:3px solid #aaa; padding:2px 0 2px 10px; margin:6px 0; }
			.pluginOptions fieldset.option-role-group > legend { font-weight:600; font-size:0.92em; color:#555; padding:0 4px; width:auto; margin-bottom:0; border:none; }
			.pluginOptions fieldset.option-role-main { border-left-color:#3c8dbc; }
			.pluginOptions fieldset.option-role-ep1 { border-left-color:#3c8dbc; }
			.pluginOptions fieldset.option-role-ep2 { border-left-color:#3cb48b; }
			.pluginOptions fieldset.option-role-ep3 { border-left-color:#b8863c; }
			.pluginOptions fieldset.option-role-ep4 { border-left-color:#8b3c8b; }
			.pluginOptions fieldset.option-role-fallback { border-left-color:#db8b3c; }
			.pluginOptions fieldset.option-role-glossary { border-left-color:#8b3cdb; }
			.pluginOptions fieldset.option-role-general { border-left-color:#888; }
			.pluginOptions fieldset.option-role-group.expandable > legend { cursor:pointer; }
			.pluginOptions fieldset.option-role-group.expandable > legend::before { content:"\\25B8\\00a0"; }
			.pluginOptions fieldset.option-role-group.expandable.expanded > legend::before { content:"\\25BE\\00a0"; }
			.pluginOptions fieldset.option-role-group.option-role-inactive { opacity:0.55; }
			.pluginOptions fieldset.option-role-group.option-role-inactive > legend::after { content:" (inactive)"; font-weight:400; }
			.pluginOptions fieldset.option-role-group:not(.option-role-inactive) .option-inactive-notice { display:none; }
			.pluginOptions .option-inactive-notice .help-block { font-style:italic; }
			.pluginOptions .option-no-match { padding:6px; color:#888; font-style:italic; display:none; }
		`;
		document.head.appendChild(style);
	}

	// (Re)build the toolbar. renderOptions empties $elm before each render, so
	// there is never a stale duplicate.
	const hasCollapsible = $elm.find("fieldset.option-section.expandable").length > 0;
	const collapseControls = hasCollapsible ? `<span class="optionCollapseControls">
		<button type="button" class="optionExpandAll">${"Expand all"}</button>
		<button type="button" class="optionCollapseAll">${"Collapse all"}</button>
	</span>` : "";
	const $toolbar = $(`<div class="optionFilterToolbar">
		<input type="search" class="form-control optionSearchInput" placeholder="${"Filter options by name or description..."}">
		<label class="optionChangedToggle"><input type="checkbox" class="optionChangedOnly"> ${"Show changed only"}</label>
		${collapseControls}
	</div>`);
	const $noMatch = $(`<div class="option-no-match">${"No options match your filter."}</div>`);
	$elm.prepend($toolbar).prepend($noMatch);

	const $search = $toolbar.find(".optionSearchInput");
	const $changed = $toolbar.find(".optionChangedOnly");

	// Cache the option key on each leaf row once.
	const $rows = $elm.find(".form-group").not("fieldset");
	$rows.each(function() {
		const key = $(this).find("[name]").first().attr("name");
		if (key) $(this).data("optkey", key);
	});

	// Collapsible-section helpers (mirror jsonform's own legend toggle so the
	// expand/collapse-all buttons and the search stay in sync with click state).
	const expandSection = ($fs) => {
		$fs.addClass("expanded");
		$("> div", $fs).show();
		$fs.find("> legend").attr("aria-expanded", "true");
	};
	const collapseSection = ($fs) => {
		$fs.removeClass("expanded");
		$("> div", $fs).hide();
		$fs.find("> legend").attr("aria-expanded", "false");
	};
	const $collapsibleSections = $elm.find("fieldset.option-section.expandable, fieldset.option-role-group.expandable");
	// Role sub-sections (Main/Fallback/Glossary/General) start expanded by default,
	// mirroring how they looked before they became collapsible.
	$elm.find("fieldset.option-role-group.expandable").each(function () { expandSection($(this)); });
	// Sections flagged default-expanded (Quick Start) start open while still
	// keeping their collapse toggle.
	$elm.find("fieldset.option-section.expandable.option-section-default-expanded").each(function () { expandSection($(this)); });
	// Sections the user had expanded before this render (captured by renderOptions from the
	// previous DOM) are re-opened, so a rebuild keeps the user's layout. A fresh render passes
	// no keys and only the default-expanded sections above open.
	(expandedSectionKeys || []).forEach(function (key) {
		$elm.find("fieldset.option-section.expandable.option-section-" + key).each(function () { expandSection($(this)); });
	});

	// Normalize any value to a stable string so "changed" survives the
	// representation gaps between the in-memory default and the DOM-read value:
	//   undefined/null -> "",  numbers/booleans -> string form,
	//   JSON-looking strings are parsed so '{ "a": 1 }' == {"a":1}.
	const canonicalize = (v) => {
		if (v == null) return "";
		if (typeof v === "string") {
			const t = v.trim();
			if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
				try { return JSON.stringify(JSON.parse(t)); } catch (e) { /* not JSON, fall through */ }
			}
			return v;
		}
		if (typeof v === "boolean") return v ? "1" : "0";
		if (typeof v === "number") return String(v);
		try { return JSON.stringify(v); } catch (e) { return String(v); }
	};

	const computeChanged = () => {
		const changed = new Set();
		// Prefer the builder-provided isChanged(): it compares each option's own
		// getValue() against getDefault() (same in-memory representation), so it is
		// correct for every field type incl. ace/prompt text and regex-array
		// patterns. Fall back to the defaults snapshot only if unavailable.
		const isChangedFn = thisTranslator.optionsForm.isChanged;
		for (const key in schema) {
			let changed_opt;
			if (typeof isChangedFn === "function") {
				changed_opt = isChangedFn(key);
			}
			else {
				const factory = key in factoryDefaults ? factoryDefaults[key] : schema[key].default;
				changed_opt = canonicalize(thisTranslator[key]) !== canonicalize(factory);
			}
			if (changed_opt) changed.add(key);
		}
		return changed;
	};

	let debounceTimer = null;
	const applyFilter = () => {
		const query = ($search.val() || "").toLowerCase().trim();
		const changedOnly = $changed.is(":checked");
		const filterActive = !!(query || changedOnly);
		const changed = changedOnly ? computeChanged() : null;
		let anyVisible = false;

		$rows.each(function() {
			const $row = $(this);
			let visible = true;
			if (query) {
				visible = ($row.text().toLowerCase().indexOf(query) > -1);
			}
			if (visible && changedOnly) {
				const key = $row.data("optkey");
				visible = !!key && changed.has(key);
			}
			// Stash the computed result. We cannot use jQuery :visible to decide
			// fieldset visibility below, because a hidden ancestor makes every
			// descendant report :visible===false -- so once a "no match" state
			// hides everything, clearing the filter could never recover.
			$row.data("shouldshow", visible);
			$row.toggle(visible);
			if (visible) anyVisible = true;
		});

		// Walk fieldsets innermost-first so visibility cascades. A fieldset is
		// shown when it contains at least one row the filter wants to show,
		// decided by the shouldshow flag above (independent of current display).
		$elm.find("fieldset").get().reverse().forEach((fs) => {
			const $fs = $(fs);
			const hasMatch = $fs.find(".form-group").not("fieldset").filter(function () { return $(this).data("shouldshow") === true; }).length > 0;
			$fs.toggle(hasMatch);
			if ($fs.is(".option-section.expandable")) {
				if (filterActive && hasMatch) expandSection($fs);
				else if (!filterActive) {
					if ($fs.is(".option-section-default-expanded")) expandSection($fs);
					else collapseSection($fs);
				}
			} else if ($fs.is(".option-role-group.expandable")) {
				if (filterActive) { if (hasMatch) expandSection($fs); }
				else expandSection($fs);
			}
		});

		$noMatch.toggle(!anyVisible);
	};

	$search.off("input.optionfilter").on("input.optionfilter", () => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(applyFilter, 120);
	});
	$changed.off("change.optionfilter").on("change.optionfilter", applyFilter);
	if (hasCollapsible) {
		$toolbar.find(".optionExpandAll").off("click.optionfilter").on("click.optionfilter", () => {
			$collapsibleSections.each(function() { expandSection($(this)); });
		});
		$toolbar.find(".optionCollapseAll").off("click.optionfilter").on("click.optionfilter", () => {
			$collapsibleSections.each(function() { collapseSection($(this)); });
		});
	}
};

/**
 * Set the value of a <select> element. If the value does not exist in the options,
 * a new option is added.
 *
 * @param {jQuery} $select - The jQuery object representing the <select> element.
 * @param {string} valueToSet - The value to set in the <select>.
 */
options.setSelectValue = function($select, valueToSet) {
	// Check if the value already exists in the options
	if ($select.find('option[value="' + valueToSet + '"]').length > 0) {
		// If it exists, simply set the value
		$select.val(valueToSet);
	} else {
		// If it doesn't exist, add a new option and then set the value
		$select.append($('<option>', {
			value: valueToSet,
			text: valueToSet
		}));
		$select.val(valueToSet);
	}
}

options.translatorMenu.configLoad = async function($panelContent, configName="") {
	console.log("Changing configuration to:", configName);
	const translatorInfo = $panelContent.data("translatorInfo");
	const $pluginOptions = $panelContent.find(".pluginOptions");
	//const jsonForm = $pluginOptions.data("jsonForm");

	const oldConfigName = 	translatorInfo.getOptions("activeConfiguration") || "";

	console.log("Save current configuration which is", oldConfigName);
	await options.translatorMenu.configSave($panelContent, oldConfigName);

	console.log("Old options:", JSON.stringify(translatorInfo.getOptions(), undefined, 2))
	console.log("Reset options");
	await translatorInfo.resetOptions();
	console.log("After reset:", JSON.stringify(translatorInfo.getOptions(), undefined, 2))

	var storageKey = `tlEngineConfig/${translatorInfo.id}`
	var existingConfig = await options.localStorage.get(storageKey) || {}
	var thisConfig = existingConfig[configName] || {}
	if (!thisConfig) {
		console.warn("No configuration found");
	}

	for (let i in thisConfig) {
		// Snapshots saved before the panel keys were filtered may carry them; skip them so a
		// loaded config cannot overwrite the runtime card's live per-model state.
		if (i === "rtSpecMode" || i === "rtMmprojMode" ||
			String(i).indexOf("rtProfile_") === 0 || String(i).indexOf("rtRole_") === 0) continue;
		translatorInfo.update(i, thisConfig[i])
	}
	console.log("After setting value:", JSON.stringify(translatorInfo.getOptions(), undefined, 2))

	options.translatorMenu.renderOptions(translatorInfo, $pluginOptions);
	translatorInfo.update("activeConfiguration", configName);

	console.log("After everything:", JSON.stringify(translatorInfo.getOptions(), undefined, 2))

	return thisConfig;
}

options.translatorMenu.configSave = async function($panelContent, configName="") {
	if (!$panelContent?.length) return;
	const translatorInfo = $panelContent.data("translatorInfo");
	const $pluginOptions = $panelContent.find(".pluginOptions");
	const jsonForm = $pluginOptions.data("jsonForm");

	// The per-model panel keys and role pickers are runtime-card state, not engine options;
	// keep them out of configuration snapshots so loading a config cannot replay them as
	// stray properties.
	const snapshot = jsonForm.root.getFormValues();
	for (const k of Object.keys(snapshot || {})) {
		if (k === "rtSpecMode" || k === "rtMmprojMode" ||
			String(k).indexOf("rtProfile_") === 0 || String(k).indexOf("rtRole_") === 0) {
			delete snapshot[k];
		}
	}
	var storageKey = `tlEngineConfig/${translatorInfo.id}`
	var existingConfig = await options.localStorage.get(storageKey) || {}
	existingConfig[configName] = snapshot
	await options.localStorage.set(storageKey, existingConfig);
	return existingConfig;
}

options.translatorMenu.configSaveAs = async function($panelContent, configName="") {
	if (!$panelContent?.length) return;
	const translatorInfo = $panelContent.data("translatorInfo");
	const $pluginOptions = $panelContent.find(".pluginOptions");
	const jsonForm = $pluginOptions.data("jsonForm");
	console.log("Saving config saveAs", translatorInfo, jsonForm);
	if (!configName) {
		configName = prompt("Pleae select the name for your configuration.");
	}
	if (!configName) return;

	const result = await options.translatorMenu.configSave($panelContent, configName);
	options.setSelectValue($panelContent.find(".configurationControl .configSelector"), configName);
	return result;
}

/**
 * Renders select box of configuration selection
 * @param {JQuery} $panelContent - Jquery instance of panelContent
 * @param {string} defaultSelection - Selected configuration as default
 */
options.translatorMenu.renderConfigSelection = async function($panelContent, defaultSelection="") {
	const translatorInfo = $panelContent.data("translatorInfo");
	const $configSelector = $panelContent.find(".configurationControl .configSelector");
	$configSelector.empty();

	var storageKey = `tlEngineConfig/${translatorInfo.id}`
	var existingConfig = await options.localStorage.get(storageKey) || {}
	$configSelector.append(`<option value="">Default</option>`)
	for (let confName in existingConfig) {
		$configSelector.append(`<option value="${common.htmlEntities(confName)}">${common.htmlEntities(confName)}</option>`)
	}

	$configSelector.off("change");
	$configSelector.on("change", function() {
		console.log("Selection change, changing to configuration ", $(this).val());
		options.translatorMenu.configLoad($panelContent, $(this).val());
	})

	defaultSelection ||= translatorInfo.getOptions("activeConfiguration") || "";

	if (defaultSelection) options.setSelectValue( $configSelector, defaultSelection);

}

options.translatorMenu.init = function() {
	if (Array.isArray(trans.translator) == false) return false;
	console.log("Initializing translator engine's options");

	var translators = common.sort(TranslatorEngine.translators, "name", true);
	for (var i=0; i<translators.length; i++) {
		(()=> {
			var thisTranslator = translators[i];
			thisTranslator.description = thisTranslator.description||"";
			thisTranslator.author = thisTranslator.author||"Anonymous";
			thisTranslator.version = thisTranslator.version||"1.0";
			let thisIcon = thisTranslator.icon || 'cog'
			var thisOption = {
				icon: thisIcon,
				tabClass: 'submenu translatorSetting',
				tabContent:$("<h1 class='pluginTitle'><i class='icon-"+thisIcon+"'></i> "+thisTranslator.name+"</h1>\
							<div class='subtitle'>Translator Engine configuration</div>\
							<div class='authorBlock'>"+"Translator engine version."+" <span class='author'>"+thisTranslator.version+"</span></div>\
							<div class='versionBlock'>"+"By."+" <span class='engineVersion'>"+thisTranslator.author+"</span></div>\
							<p class='description'>"+thisTranslator.description+"</p>\
							<div class='configurationControl'></div>\
							<div class='pluginOptions'></div>")
			}
			
			if (typeof thisTranslator.onOptionSelected == "function") thisOption.onSelect = thisTranslator.onOptionSelected
			const tab = options.tab.insertAfter(thisTranslator.id, thisTranslator.name, $(".langSetting"), thisOption);
			let $formContainer = tab.content.find(".pluginOptions");

			if (typeof thisTranslator.optionsForm == 'undefined') {
				$formContainer.html("No option for this engine");
				return;
			}
			
			options.translatorMenu.renderOptions(thisTranslator, $formContainer);

			// ================================================================
			// Option manager section only available if enableOptionManager is TRUE
			if (!thisTranslator.getOptions("enableOptionManager")) return;
			if (thisOption.tabContent.parent().find(".configurationControl").html(`<span class='configurationLabel'>Manage configuration</span><span class='configSelectorFieldWrapper'><select type='search' class='configSelector'><option value=''>Default</option></select><button class='configSave'>Save</button><button class='configSaveAs'>Save As</button></span>`))

			thisOption.tabContent.parent().find(".configurationControl .configSave").on("click", function() {
				options.translatorMenu.configSave($(this).closest(".panelContent"));

			});
			thisOption.tabContent.parent().find(".configurationControl .configSaveAs").on("click", function() {
				const $panelContent = $(this).closest(".panelContent");
				const currentConfigName = $panelContent.find(".configurationControl .configSelector").val();
				options.translatorMenu.configSaveAs($panelContent, currentConfigName);
				alert(`Configuration ${currentConfigName} saved!`);

			});

			options.translatorMenu.renderConfigSelection(tab.content);
	
		})()
	}
}


// ===================================================
// Handling addons options
// ===================================================
// There is no addon manager: addons are enabled by placing their folder in
// www/addons/ and removed by deleting it. This class only renders the
// configuration forms of addons that actually expose options.

var AddonsOption = function() {}

/**
 * Drawing the form
 */
AddonsOption.prototype.camelCaseToWords = function(text) {
	var result = text.replace( /([A-Z])/g, " $1" );
	var finalResult = result.charAt(0).toUpperCase() + result.slice(1);
	return 	finalResult;
}

/**
 * Compile a mini-schema (the plain object addons assign to `this.optionsForm`)
 * into an array of SLROption instances. This is the single place that maps the
 * legacy mini-schema DSL onto the canonical option model — replacing the former
 * `generateFromMini` + `renderCustomSchema` (and their `eval(HOOK)` binding).
 */
AddonsOption.prototype.compileOptions = function(addon, miniSchema) {
	var options = [];
	for (var key in miniSchema) {
		var def = miniSchema[key];
		if (!def || typeof def !== "object") continue;
		options.push(this.optionFromMini(addon, key, def));
	}
	return options;
};

AddonsOption.prototype.optionFromMini = function(addon, key, def) {
	var that = this;

	// Resolve the storage location from the HOOK (always a path into
	// thisAddon.config) without eval. Defaults to thisAddon.config['<key>'].
	var hook = (def.HOOK !== undefined) ? def.HOOK : ("thisAddon.config['" + key + "']");
	var accessor = SLROption.resolveHook(addon, hook);

	// Resolve schema type + jsonform field type, mirroring generateFromMini.
	var type = def.type || "string";
	var formType = def.formType;
	var formOptions = {};
	var schemaOptions = {};

	if (Array.isArray(def.enum)) {
		var titleMap = {};
		if (def.preventAutoCamelCase) {
			for (var i = 0; i < def.enum.length; i++) titleMap[def.enum[i]] = def.enum[i];
		} else {
			for (var j = 0; j < def.enum.length; j++) titleMap[def.enum[j]] = that.camelCaseToWords(def.enum[j]);
		}
		formOptions.titleMap = titleMap;
		// jsonform builds radio/select choices from schema.enum (not from the
		// form's titleMap), so the enumeration must also be present on the
		// schema — otherwise the field renders its title + description but no
		// buttons/options.
		schemaOptions["enum"] = def.enum.slice();
	}
	if (type === "array") {
		formType = "checkboxes";
		schemaOptions.items = def.items || (def.enum ? { enum: def.enum } : undefined);
	}
	if (type === "radio" || type === "radios") {
		type = "string";
		formType = "radios";
	}
	if (def.inlinetitle) formOptions.inlinetitle = def.inlinetitle;
	if (def.fieldHtmlClass) formOptions.fieldHtmlClass = def.fieldHtmlClass;
	if (def.attr) schemaOptions.attr = def.attr;

	var defaultVal = (typeof def.default === "function") ? def.default.call(addon) : def.default;

	var backend = {
		getValue: function () {
			var v = accessor.get();
			// Normalize a stored value to its declared numeric type. Values
			// saved before type-coercion on write could be strings, so coerce
			// on read (idempotent) — mirrors the legacy read path.
			if (v !== undefined && v !== null && (type === "number" || type === "integer")) {
				var cv = (type === "integer") ? parseInt(v, 10) : parseFloat(v);
				if (!isNaN(cv) && cv !== v) { accessor.set(cv); v = cv; }
			}
			return v;
		},
		setValue: function (id, value) { accessor.set(value); }
	};

	return new SLROption({
		id: key,
		name: def.title,
		description: def.description,
		type: type,
		default: defaultVal,
		formType: formType,
		formOptions: formOptions,
		schemaOptions: schemaOptions,
		backend: backend,
		onInput: def.onInput,
		onChange: def.onChange
	});
};

/**
 * Build a jsonform { form, schema } from SLROption instances. Values are read
 * from each option's backend (current config) and onChange writes back through
 * the backend — replicating renderCustomSchema's per-type DOM extraction and
 * number coercion exactly, but via typed objects instead of generated eval.
 */
AddonsOption.prototype.buildOptionForm = function(options, addon) {
	var form = [];
	var schema = {};
	options.forEach(function (opt) {
		var key = opt.getId();
		(function (opt, key) {
			var entry = {
				key: key,
				onChange: function (evt) {
					if (typeof opt.getOnInput() === "function") opt.getOnInput().call(addon, $(evt.target));
					if (typeof opt.getOnChange() === "function") opt.getOnChange().apply($(evt.target), arguments);
					var type = opt.getType();
					var value;
					if (type === "boolean") value = $(evt.target).prop("checked");
					else if (opt.getFormType() === "radios") value = $(evt.target).closest(".controls").find("input[type=radio]:checked").val();
					else value = $(evt.target).val();
					// number/integer: coerce, but keep the raw value when unparseable (legacy behaviour)
					if (type === "number") { var n = parseFloat(value); if (!isNaN(n)) value = n; }
					else if (type === "integer") { var m = parseInt(value, 10); if (!isNaN(m)) value = m; }
					opt.options.backend.setValue(key, value);
				}
			};
			var ft = opt.getFormType();
			if (ft) entry.type = ft;
			Object.assign(entry, opt.getFormOptions());
			form.push(entry);
		})(opt, key);
		schema[key] = Object.assign({
			type: opt.getType(),
			title: opt.getName(),
			description: opt.getDescription(),
			default: opt.getValue()
		}, opt.getSchemaOptions());
	});
	return { form: form, schema: schema };
};

/**
 * Assign default value of the JSONform
 * @param {*} optionsForm 
 * @param {*} thisAddon 
 */
AddonsOption.prototype.assignDefault = function(optionsForm, thisAddon) {
	if (!optionsForm?.schema) return;
	for (let key in optionsForm.schema) {
		let thisConfig = thisAddon.getConfig(key);
		if (typeof thisConfig == "undefined") continue;
		optionsForm.schema[key].default = thisConfig;
	}
}
	
AddonsOption.prototype.linkify = function(text) {
    var urlRegex =/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
    return text.replace(urlRegex, function(url) {
        return '<a href="' + url + '", target="_system">' + url + '</a>';
    });
}
	
	AddonsOption.prototype.init = function() {
	addonLoader = addonLoader || {};
	addonLoader.addons = addonLoader.addons || {};
	var that = this;

	if (!document.getElementById("addonGeneralSectionStyles")) {
		var style = document.createElement("style");
		style.id = "addonGeneralSectionStyles";
		style.textContent = `
			#generalAddonOptions fieldset.addon-general-section { border:1px solid #ccc; border-radius:4px; padding:6px 10px 10px; margin:14px 0; }
			#generalAddonOptions fieldset.addon-general-section > legend { font-weight:bold; font-size:1.05em; padding:0 6px; width:auto; margin-bottom:0; }
		`;
		document.head.appendChild(style);
	}

	var $generalContainer = $("#generalAddonOptions");
	var generalAddons = [];
	var tabAddons = [];

	for (var addonId in addonLoader.addons) {
		var addon = addonLoader.addons[addonId];
		addon.package 			= addon.package || {};
		addon.package.name 		= addon.package.name||"";
		addon.package.title 	= addon.package.title||addon.package.name||"";
		addon.package.description = addon.package.description||"";
		addon.package.author 	= addon.package.author||{name:"Anonymous", email:""}
		addon.package.version 	= addon.package.version||"1.0";
		addon.optionsForm 		= addon.optionsForm||{}
		addon.config 			= addon.config || {}

		// An addon only gets an entry in the Options dialog when it actually
		// exposes settings — no empty sections or tabs for static addons.
		var hasOptions = false;
		if (typeof addon.optionsForm == "function") {
			hasOptions = true;
		} else if (addon.optionsForm && Object.keys(addon.optionsForm).length) {
			hasOptions = true;
		} else if (addon.optionsFormHtml) {
			hasOptions = true;
		}
		if (!hasOptions) continue;

		if (addon.package.optionsDisplay === "general") {
			generalAddons.push(addon);
		} else if (addon.package.optionsDisplay === "tab") {
			tabAddons.push(addon);
		}
	}

	if ($generalContainer.length) {
		for (var i = 0; i < generalAddons.length; i++) {
			var addon = generalAddons[i];
			var sectionTitle = addon.package.optionsSectionTitle || addon.package.title;
			var $section = $(
				'<fieldset class="form-group addon-general-section">' +
				'<legend>' + common.htmlEntities(sectionTitle) + '</legend>' +
				'<div class="pluginOptions"></div>' +
				'</fieldset>'
			);
			$generalContainer.append($section);
			that.renderAddonOptionsInto(addon, $section.find(".pluginOptions"));
		}
		if (!generalAddons.length) $generalContainer.remove();
	}

	// Addons marked optionsDisplay:"tab" get their own top-level tab in the
	// options dialog (inserted before the "About" tab), instead of a section
	// inside General Options. Suitable for addons with many settings.
	for (var j = 0; j < tabAddons.length; j++) {
		var tabAddon = tabAddons[j];
		var tabTitle = tabAddon.package.optionsSectionTitle || tabAddon.package.title || tabAddon.package.name;
		var tabId = "addonTab_" + (tabAddon.package.name || j);
		var $aboutTab = $(".tabMenu li[data-for='about']");
		var tabResult = options.tab.insertBefore(tabId, tabTitle, $aboutTab, {});
		var $tabContent = $('<div style="padding:10px;"><fieldset class="form-group addon-general-section"><div class="pluginOptions"></div></fieldset></div>');
		tabResult.content.append($tabContent);
		that.renderAddonOptionsInto(tabAddon, $tabContent.find(".pluginOptions"));
	}
	if (tabAddons.length) options.tab.init();
}

/**
 * Render an addon's optionsForm (mini-schema or full schema) into a container,
 * reusing the same jsonForm pipeline the old per-addon tabs used. Hosts "general"
 * addons (e.g. SLR Batch, Night Mode) inside the General Options tab.
 */
AddonsOption.prototype.renderAddonOptionsInto = function(addon, $pluginOptions) {
	var that = this;
	var thisOptionForm = addon.optionsForm;
	if (typeof thisOptionForm == "function") thisOptionForm = thisOptionForm.call(addon, options);
	if (!thisOptionForm || !Object.keys(thisOptionForm).length) {
		if (addon.optionsFormHtml) $pluginOptions.append(addon.optionsFormHtml);
		return;
	}

	if (!thisOptionForm.form) {
		// Mini-schema: compile onto the canonical option model, then build the
		// jsonform definition from it. This replaces the legacy
		// generateFromMini + renderCustomSchema (and the eval(HOOK) binding).
		var compiled = this.compileOptions(addon, thisOptionForm);
		thisOptionForm = this.buildOptionForm(compiled, addon);
	} else {
		this.assignDefault(thisOptionForm, addon);
	}

	$pluginOptions.jsonForm(thisOptionForm);

	$pluginOptions.find(".help-block").each(function() {
		$(this).html(that.linkify($(this).html()));
		$(this).find("a[target=_system]").on("click", function(e) {
			e.preventDefault();
			nw.Shell.openExternal($(this).attr("href"));
		})
	});

	for (var key in thisOptionForm.schema) {
		var thisForm = thisOptionForm.schema[key];
		if (!thisForm.attr) continue;
		var $thisField = $pluginOptions.find('[name="' + key + '"]');
		for (var attrKey in thisForm.attr) {
			$thisField.attr(attrKey, thisForm.attr[attrKey]);
		}
	}

	$pluginOptions.find("input[type=range]").each(function() {
		var $this 		= $(this);
		var $thisParent = $this.parent();
		var $wrapper 	= $('<div class="fullWidth flex rangeWrapper"><output></output></div>');
		$wrapper.find("output").text($this.val());
		$wrapper.prepend($this);
		$thisParent.prepend($wrapper);
		$this.on("input", function() {
			$(this).next().html($(this).val());
		})
	});

	if (addon.optionsFormHtml) $pluginOptions.append(addon.optionsFormHtml);
};


options.addonsOption = new AddonsOption();







// ===================================================
// Handling ABOUT
// ===================================================
options.about = {};
options.about.init = function() {
	let config = sys.app||nw.App.manifest
	const version = config.version	
	$("#about .version").text(version);
	
	$("#about .viewChangelog").on("click", async ()=> {
		let changelog = fs.readFileSync('changelog.txt', 'utf8');
		$("#about .changelog").text(changelog);
	});
	
	$("#about .nwVersion").text(process.versions.nw);
	$("#about .nodeVersion").text(process.versions.node);
	$("#about .phpVersion").text(sys.phpVersion);
	$("#about .archVersion").text(process.arch);
	
	//var rbVersion = "";
	if (typeof window.spawn  == "undefined") {
		window.spawn = require('child_process').spawn;
	}
	
	var child = window.spawn(nw.App.manifest.localConfig.ruby, ['www/rb/getVersion.rb']);
	//var child = spawn("ruby\\bin\\ruby.exe", ['www\\rb\\getVersion.rb']);
	var outputBuffer = "";
	child.stdout.on('data', function (data) {
		console.log("data : ", data);
		outputBuffer += data;
	});	
	child.on('close', function (code) {
		console.log("closed");
		$("#about .rubyVersion").text(outputBuffer);
	});		
	
	$(".licenseLink").attr("href", "file://"+__dirname+"/LICENSE.txt")
	
}


var Association = require("www/js/lib/fileAssoc.js");
var thisOptions = {
	iconIndex: nw.App.manifest.localConfig.iconIndex
	,defaultIconIndex : nw.App.manifest.localConfig.defaultIconIndex
}
console.log("thisOptions", thisOptions);
options.association = new Association(nw.App.manifest.localConfig.extensions,thisOptions);
options.association.init = function() {
	var thisAssoc = options.association.getAssociation();
	$(".associateBtn.submit").off("click");
	$(".associateBtn.setAll").off("click");
	$(".associateBtn.unsetAll").off("click");
	const $table = $(".extensionTable");
	$table.empty();
	$table.append("<tr><th>Extension</th><th>Associate</th></tr>");
	for (var ext in thisAssoc) {
		var $thisRow = $('<tr><th>'+ext+'</th><td class="formFld"></td></tr>');
		var $checkBox = $('<input type="checkbox" data-ext="'+ext+'" value="'+ext+'" class="flipSwitch associate ext_'+ext+'" name="associate['+ext+']" />');

		$checkBox.prop("checked", thisAssoc[ext]);

		$thisRow.find(".formFld").append($checkBox);
		$table.append($thisRow);
	}

	$(".associateBtn.unsetAll").on("click", function() {
		$(".extensionTable input.associate").prop("checked", false);
	});
	$(".associateBtn.setAll").on("click", function() {
		$(".extensionTable input.associate").prop("checked", true)
	});
	
	$(".associateBtn.submit").on("click", function() {
		var $checkBox = $(".extensionTable input.associate");
		var ext = [];
		for (var i=0; i<$checkBox.length; i++) {
			if ($checkBox.eq(i).prop("checked")) {
				ext.push($checkBox.eq(i).data("ext"));
			}
		}
		
		var conf = confirm("SLR will write Window's registry.\r\nAre you sure?");
		if (conf) options.association.setExtension(ext);
	});

	return $table;
}


options.initSpellCheckLanguage = async function() {
	options.initLanguageList();
	var $spellCheckLanguage = $("#spellCheckLanguage");
	$spellCheckLanguage.val(sys.getConfig("spellCheckLang"));
	$spellCheckLanguage.off("change");
	$spellCheckLanguage.on("change", function() {
		console.log("spellCheck changed", $(this).val());
		window.opener.ui.changeEditorLanguage($(this).val());
		sys.setConfig("spellCheckLang", $(this).val());
	});
}

// ===================================================
// CLASS Autoset
// ===================================================

var Autoset = function() {
	
}
Autoset.prototype.init = function() {
	$(document).ready(function() {	
		$("[data-autoset]").each(function() {
			var $this = $(this);
			//if ($this[0].tagName == "select")
			try {
				if ($this.attr("type") == "checkbox") {
					$this.prop("checked", Boolean(common.varAsStringGet($this.attr('data-autoset'))));
				} else if (["INPUT", "SELECT"].includes($this.prop("tagName")) == false) {
					$this.text(common.varAsStringGet($this.attr('data-autoset')));
				} else {
					$this.val(common.varAsStringGet($this.attr('data-autoset')));
				}
			} catch (e) {
				//do nothing
			}
		});
		
		$("[data-autoset]").on("change.autoset", function(e) {
			console.log("Autoset triggered!");
			var $this = $(this);
			if ($this.data("autoset") == "") return;
			
			var autosetPath = $this.data('autoset').split(".")
			if (autosetPath.length < 1) return;
			
			console.log("autoset path : ", autosetPath);
			var thisObj = window;
			for (var i=0; i<autosetPath.length-1; i++) {
				thisObj = thisObj[autosetPath[i]];
				console.log("accessing "+autosetPath[i], thisObj);
				
			}
			console.log("setting up : "+autosetPath[autosetPath.length-1], $this.val());
			
			if ($this.attr("type") == "checkbox") {
				thisObj[autosetPath[autosetPath.length-1]] = $this.prop("checked");
			} else {
				thisObj[autosetPath[autosetPath.length-1]] = $this.val();
			}

		})
	});
}

options.autoset = new Autoset();
options.autoset.init();


options.busy = function() {
	options.isBusy = true;
	return new Promise((resolve, reject) => {
		$("#busyOverlay").fadeIn( 200, ()=>{
			resolve();
		})
	});
	
}
options.busyNot = function() {
	options.isBusy = false;
	return new Promise((resolve, reject) => {
		$("#busyOverlay").fadeOut( 200, ()=>{
			resolve();
		})
	});
}


options.UpdateUI = function() {
	this.$baseElm = $();
}
options.UpdateUI.prototype.evalUpdateButton = function() {
	this.$baseElm.find(".updateStatus > div").addClass("hidden");
	if (sys.config.autoUpdateReinstall) {
		this.$baseElm.find(".updateStatus .pendingUpdate").removeClass("hidden");
	} else {
		if (info.isUpToDate()) {
			this.$baseElm.find(".updateStatus .upToDate").removeClass("hidden");
		} else {
			this.$baseElm.find(".updateStatus .pendingUpdate").removeClass("hidden");
		}
	}
}

options.UpdateUI.prototype.evalLastChecked = function() {
	this.$baseElm.find(".updateLastChecked").html(common.formatDate(new Date(info.getLastCheckedUpdate())));
}

options.UpdateUI.prototype.onUpdateStart = function() {
	this.$baseElm.find(".updateNow").prop("disabled", true);
	
	this.$baseElm.find(".updateNow > i").addClass("rotating-slow");
	this.$baseElm.find(".updateNow > span").html("updating");
	this.$baseElm.find(".updateProcess").removeClass("hidden");
	this.$baseElm.find(".updateProcess").html("Updating...");
	
}

options.UpdateUI.prototype.onUpdateEnd = function() {
	this.$baseElm.find(".updateNow").prop("disabled", false);
	
	this.$baseElm.find(".updateProcess").html("");
	this.$baseElm.find(".updateNow > span").html("Update now");
	this.$baseElm.find(".updateNow > i").removeClass("rotating-slow");
	this.$baseElm.find(".updateProcess").addClass("hidden");
	this.evalUpdateButton();	
}

options.UpdateUI.prototype.init = function() {

}
options.updateUI = new options.UpdateUI();


var ExpanderButton = function(elements) {
	this.elements = elements || $(".panel-left .expanderButton");
	this.init();
}

ExpanderButton.prototype.expandAll = function() {
	if (this.allExpanded) return;
	var that = this;
	this.elements.each(function() {
		that.toggle($(this), true);
	});
	this.allExpanded = true;
}


ExpanderButton.prototype.toggle = function($button, expand) {
	if (typeof expand == 'undefined') {
		// auto toggle
		expand = !$button.hasClass('isExpanded');
	}

	var $targets;
	try {
		$targets = $($button.attr('data-expand'));
	} catch (e) {
		$targets = $();
	}

	if (expand) {
		console.log("expanding child", $button.attr('data-expand'), $targets.length);
		// expand child
		$button.removeClass('icon-right-dir')
		$button.addClass('icon-down-dir')
		$button.addClass('isExpanded');
		$targets.removeClass("hidden");
	} else {
		// collapse child
		console.log("collapsing child", $button.attr('data-expand'),$targets.length);

		$button.removeClass('icon-down-dir')
		$button.addClass('icon-right-dir')
		$button.removeClass('isExpanded');
		$targets.addClass("hidden");
		ExpanderButton.allExpanded = false;
	}
}

ExpanderButton.prototype.init = function() {
	var thisExpanderButton = this;
	this.elements.each(function() {
		const $this = $(this);
		$this.addClass("expanderTogler");
		$this.attr("title", "Click to expand/collapse");
		if ($this.is(".rendered")) return;
		
		$this.on("click", function() {
			console.log("expander button clicked");
			thisExpanderButton.toggle($(this));
		});
		
		$this.closest(".selectable").on("dblclick", function() {
			console.log("expander button clicked");
			thisExpanderButton.toggle($(this).find(".expanderTogler"));			
		})

		$this.addClass("rendered");
	})
}

options.hasError = function() {
	if ($("#sl").hasClass("error")) {
		return "There is an error on Source Language field!\nPlease make sure that the field is not empty.";
	}	
	if ($("#tl").hasClass("error")) {
		return "There is an error on Target Language field!\nPlease make sure that the field is not empty.";
	}
}

options.drawListContent = function() {
	var $lists = $(".tabMenu.list li[data-for]");
	$lists.each(function() {
		var $tabMenu = $(this);
		if ($tabMenu.find(".contains").length > 0) return;
		var target = $tabMenu.attr("data-for");
		var $tabContent = $(`#${CSS.escape(target)}`);
		if (!$tabContent.length) return;

		var $contains = $(`<span class="hidden contains"></span>`);
		$contains.text($tabContent.text().replace(/\s+/g, ' '));

		$tabMenu.append($contains);
	})
}

options.initList = function() {
	if (this.listIsInitialized) return;
	this.busy();
	console.log("Initializing list");
	this.drawListContent();
	window.commandOption = {
		valueNames: [
			'menuTitle',
			'contains',
			{ data: ['keyword'] }
		]
	};	
	this.menus = new window.List('leftMenu', window.commandOption);
	this.menus.reIndex();
	this.menus.on("searchStart", function() {
		console.log("Search start", arguments);
		options.expanderButton.expandAll();
	})

	this.listIsInitialized = true;
	this.busyNot()
}

options.init = async function() {
	$(".logIntoFile").prop("checked", logger.getConfig("replaceConsole", nw.App.manifest.localConfig.logToFile === true));
	$(".logTruncate").prop("checked", logger.getConfig("truncate", true));
	$(".logOptionsWindow").prop("checked", logger.getConfig("logOptionsWindow", false));

	$(".logIntoFile").on("change", function() {
		logger.setConfig("replaceConsole", $(this).prop("checked"))
		options.requestRestart()
	})
	$(".logTruncate").on("change", function() {
		logger.setConfig("truncate", $(this).prop("checked"))
		options.requestRestart()
	})
	$(".logOptionsWindow").on("change", function() {
		logger.setConfig("logOptionsWindow", $(this).prop("checked"))
		options.requestRestart()
	})
}

$(document).ready(function() {
	try {
		common.addEventHandler(options);
		options.dvField = new DVField();
		options.dvField.init();
		options.expanderButton = new ExpanderButton();
	} catch (e) {
		console.warn("Error on initializing option window:", e);
		alert("Error on initializing option window, please see the console log to view the detailed information.");
		options.busyNot();
	}

	var thisTranslator = sys.config.translator||trans.project.options.translator;
	if (Boolean(thisTranslator) == false) alert("There is no default translator selected.\nChange the default translator to Google!");

	$("#stagingPath").val(sys.config.stagingPath);
	$("#stagingPath").on("change", function() {
		var conf = confirm("Change Stagging Path to :"+$(this).val());
		if (!conf) {
			$(this).val(sys.config.stagingPath);
			return;
		}
		var oldStaggingPath = sys.config.stagingPath;
		sys.config.stagingPath = $(this).val();
		sys.saveConfig();

		conf = confirm("Move the content of current Stagging Path into the new one?");
		if (!conf) return;
		// moving the data
		options.busy()
		.then(()=>{
			return common.copy(oldStaggingPath, sys.config.stagingPath, 
			function(result){
				console.log(result)
				options.busyNot()
			})	
		});	
		//sys.config.stagingPath = $(this).val();
	})
	
	// render horizontal tabs
	$(".horizTabMenu").each(function(e) {
		var $tabMenu = $(this);
		var $targetTabWrapper = $("[data-id='"+$tabMenu.data("for")+"']");
		$tabMenu.children().each(function(e) {
			var $tabButton = $(this);
			
			$tabButton.on('click', function() {
				$tabMenu.trigger("tabChange");
				$(this).trigger("tabSelected");
				var $targetTabContent = $targetTabWrapper.find("[data-id='"+$(this).data("for")+"']");
				$tabMenu.children().removeClass("selected");
				$(this).addClass("selected");
				$targetTabWrapper.children().addClass("hidden");
				$targetTabContent.removeClass("hidden");
			})
		});
		
		$tabMenu.children().eq(0).trigger("click")
	})
	
	$(".menuPanelSearch").on("focus", function() {
		console.log("field focused");
		options.initList();
	})

	
	try {	
		options.drawTranslatorSelector($("#defaultTransEngine"), thisTranslator);
		options.translatorMenu.init();
		options.addonsOption.init();
		options.tab.init();
		$(".tabHelp").on("click", function(e) {
			e.stopPropagation();
			e.preventDefault();
			if (window.docsHelp) docsHelp.open($(this).data("help-page"));
		});
		options.tab.select($(".tabMenu li.selectable").eq(0));
		// Deep link, e.g. options.html#tab=dslr&filter=review (see ui.openOptionsWindow).
		try {
			var hash = window.location.hash || "";
			var tabMatch = /(?:^|[#&])tab=([^&]+)/.exec(hash);
			if (tabMatch) {
				var filterMatch = /(?:^|[#&])filter=([^&]+)/.exec(hash);
				window.optionsFocusTab(
					decodeURIComponent(tabMatch[1]),
					filterMatch ? decodeURIComponent(filterMatch[1]) : ""
				);
			}
		} catch (e) { console.warn("Could not apply options deep link:", e); }
		options.about.init();
		options.association.init();
		options.updateUI.init();
		options.init();
		options.busyNot();
	} catch (e) {
		console.warn("Error on initializing option window:", e);
		alert("Error on initializing option window, please see the console log to view the detailed information.");
		options.busyNot();
	}

	// Reveal the window only now that the UI has been built, and wait one
	// painted frame first so the compositor has dark content to present.
	// Showing any sooner briefly flashes the window's default white canvas.
	var reveal = function() {
		try { win.show(); } catch (e) { console.warn("Could not show options window", e); }
		try { win.focus(); } catch (e) {}
	};
	if (window.requestAnimationFrame) {
		window.requestAnimationFrame(function() { window.requestAnimationFrame(reveal); });
	} else {
		setTimeout(reveal, 30);
	}

	console.log("initializing open external");

	setTimeout(function() {
		$("a.externalLink, a[external]").on("click", function(e) {
			console.warn("clicked")
			e.preventDefault();
			nw.Shell.openExternal($(this).attr("href"));
		})
	}, 50)


});


win.on('close', async function() {
	// Drain, don't index-and-shift: shifting while incrementing i skipped every second
	// handler whenever more than one was queued.
	while (options.__onBeforeClose.length > 0) {
		var funct = options.__onBeforeClose.shift();
		try { funct.call(options); } catch (e) { console.warn("options onBeforeClose handler error:", e); }
	}
	if (options.hasError()) {
		var conf = confirm(options.hasError()+"\n"+"SLR may not work normally if you don't fix the error.\nDo you want to close the options Window?");
		if (!conf) return;
	}
	options.isNeedRestart();

	// Notify the opener while it is still alive. This must run before any `await`:
	// once we yield (or the main window is being torn down) `window.opener` can
	// become a dead object. An uncaught exception here used to abort the handler
	// after this.hide(), leaving this window hidden-but-alive so the process
	// never exited.
	try {
		if (window.opener && !window.opener.closed && window.opener.ui) {
			/**
			 * Triggered when option window is closed
			 * @event ui#optionsWindowClosed
			 * @since 4.3.20
			 */
			window.opener.ui.trigger("optionsWindowClosed");
			if (typeof window.opener.ui.windows !== 'undefined') window.opener.ui.windows.options = undefined;
		}
	} catch (e) {
		console.warn("Could not notify opener window:", e);
	}

	// Hide the window to give user the feeling of closing immediately
	this.hide();
	if (nw.process.versions["nw-flavor"] == "sdk") {
		try { win.closeDevTools(); } catch (e) {}
		await common.wait(200);
	}

	this.close(true);

});
