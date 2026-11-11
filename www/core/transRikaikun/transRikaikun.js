const thisAddon = this;
thisAddon.defaultConfig = {
	"copySeparator": "tab",
	"disablekeys": false,
	"highlight": true,
	"kanjiInfo": [
		{ "code": "H", "name": "Halpern", "shouldDisplay": true },
		{ "code": "L", "name": "Heisig 5th Edition", "shouldDisplay": true },
		{ "code": "DN", "name": "Heisig 6th Edition", "shouldDisplay": true },
		{ "code": "E", "name": "Henshall", "shouldDisplay": true },
		{ "code": "DK", "name": "Kanji Learners Dictionary", "shouldDisplay": true },
		{ "code": "N", "name": "Nelson", "shouldDisplay": true },
		{ "code": "V", "name": "New Nelson", "shouldDisplay": true },
		{ "code": "Y", "name": "PinYin", "shouldDisplay": true },
		{ "code": "P", "name": "Skip Pattern", "shouldDisplay": true },
		{ "code": "IN", "name": "Tuttle Kanji &amp; Kana", "shouldDisplay": true },
		{ "code": "I", "name": "Tuttle Kanji Dictionary", "shouldDisplay": true },
		{ "code": "U", "name": "Unicode", "shouldDisplay": true }
	],
	"kanjicomponents": true,
	"lineEnding": "n",
	"maxClipCopyEntries": 7,
	"maxDictEntries": 7,
	"minihelp": true,
	"onlyreading": false,
	"popupDelay": 150,
	"popupLocation": 0,
	"popupcolor": "blue",
	"showOnKey": "",
	"textboxhl": false,
	"ttsEnabled": false,
	"autoEnable": true
};
const dataLoc = "www/core/transRikaikun/";
var rcxContent = require(dataLoc + "rikaicontent.js");
thisAddon.rcxContent = rcxContent;

thisAddon.showHelp = function () {
	var offset = $(".menu-button[data-id=rikai]").offset();
	var $elm = `<span style="font-weight:bold">Rikaikun module enabled!</span><br>
	<div>Mouseover any Japanese/Chinese text to view the info.<br>
	<br>
	<table cellspacing=5>
	<tr><td>ALT+R</td><td>Disable/enable Rikai</td></tr>
	<tr><td>A</td><td>Alternate popup location</td></tr>
	<tr><td>Y</td><td>Move popup location down</td></tr>
	<tr><td>C</td><td>Copy to clipboard</td></tr>
	<tr><td>D</td><td>Hide/show definitions</td></tr>
	<tr><td>Shift/Enter&nbsp;&nbsp;</td><td>Switch dictionaries</td></tr>
	<tr><td>B</td><td>Previous character</td></tr>
	<tr><td>M</td><td>Next character</td></tr>
	<tr><td>N</td><td>Next word</td></tr>
	<tr><td>J</td><td>Scroll back definitions</td></tr>
	<tr><td>K</td><td>Scroll forward definitions</td></tr></table>`;
	rcxContent.showPopup($elm,
		$(".menu-button[data-id=rikai]")[0],
		Math.round(offset.left),
		Math.round(offset.top)
	);
};

thisAddon.enable = async function (config) {
	config = config || this.defaultConfig;
	await this.loadBackgroundPage(this.getWebLocation() + "/background.html");
	rcxContent.enableTab(config);
};

thisAddon.disable = async function () {
	rcxContent.disableTab();
	if (!thisAddon.getConfig("noUnload")) {
		console.log("unload dictionary");
		await this.unloadBackgroundPage(this.getWebLocation() + "/background.html");
	}
};

var init = async () => {
	var addMenuButton = () => {
		// Rikai is a toggle, so it lives in the editor toolbar's toggle row with
		// the other toggles (see ui.editorToolbar / trans.html editor-toggle-group).
		var toolbar = ui.Toolbar.list && ui.Toolbar.list["editor-tools"];
		if (!toolbar) {
			console.warn("[transRikaikun] Editor toolbar not found; cannot add the Rikai button.");
			return null;
		}
		return toolbar.addButtonWithMenu({
			id: "rikai",
			group: "editor-toggle-group",
			title: thisAddon.getConfig("autoEnable") !== false ? "Deactivate Rikai Dictionary" : "Activate Rikai Dictionary",
			onClick: async function () {
				if ($(this).is(".checked")) {
					$(this).removeClass("checked");
					$(this).attr("title", "Activate Rikai Dictionary");
					thisAddon.disable();
				} else {
					$(this).addClass("checked");
					$(this).attr("title", "Deactivate Rikai Dictionary");
					await thisAddon.enable();
					thisAddon.showHelp();
				}
			},
			img: `${thisAddon.getWebLocation()}/images/icon48.png`
		}, [{
			label: 'Enable on startup',
			type: "checkbox",
			checked: Boolean(thisAddon.getConfig("autoEnable")),
			click: function () {
				this.checked = !thisAddon.getConfig("autoEnable");
				thisAddon.setConfig("autoEnable", this.checked);
			}
		}, {
			label: 'Never unload dictionaries from RAM',
			type: "checkbox",
			checked: Boolean(thisAddon.getConfig("noUnload")),
			click: function () {
				this.checked = !thisAddon.getConfig("noUnload");
				thisAddon.setConfig("noUnload", this.checked);
			}
		}]);
	};
	var $btnElm = addMenuButton();

	// Activate the dictionary automatically on startup so it works without
	// pressing the button first. Disable via the "Enable on startup" menu option.
	// Add "checked" to the INNER button (not the outer span wrapper) because
	// the onClick handler's `this` is the inner button element.
	if (thisAddon.getConfig("autoEnable") !== false) {
		if ($btnElm) {
			var $innerBtn = $btnElm.find("button.mainButton");
			if (!$innerBtn.length) $innerBtn = $btnElm.find("button").eq(0);
			if ($innerBtn.length) $innerBtn.addClass("checked");
		}
		await thisAddon.enable();
	}
};

$(document).ready(function () {
	ui.onReady(() => {
		init();
	});
});
