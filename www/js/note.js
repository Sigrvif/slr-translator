var note = {};

var win = nw.Window.get();
const trans = window.opener.trans;
win.restore(); // restore if minimized
win.show(); // show if hidden

win.setResizable(true);
win.height = 320;
win.width = 640;


note.getParameters = function() {
	return window.location.hash.substr(1);
}
note.saveData = function() {
	//console.log("Run note.saveData");
	var thisFile = note.getParameters();
	/*
	var thisNote = window.opener.trans.project.files[thisFile].note||"";
	console.log("ID : "+thisFile);
	$("#note").val(thisNote);
	*/
	trans.setFileNote($("#note").val());

	window.opener.ui.evalFileNoteIcon();
}

note.loadData = function() {
	console.log("Run note.loadData");
	this.thisFile = note.getParameters();
	var thisNote = trans.project?.files[this.thisFile]?.note||"";
	console.log("ID : "+this.thisFile);
	$("title").text(this.thisFile+" - SLR Translator Notes");
	$("#note").val(thisNote);
	$("#noteColor").val(trans.project?.files[this.thisFile]?.noteColor||"")
}

note.setColor = function(color = "") {
	$("#noteColor").css("background-color", color);
	$("#noteColor").val(color);
	trans.setFileNoteColor(color);
}

note.initNamedColorSelector = function($selectElm, defaultVal) {
	var note = this;
	console.log("Initializing color selector");
	var namedColors = common.getNamedColor();
	if ($selectElm.length < 1) return;
	for (var i in namedColors) {
		$selectElm.append(`<option style="background-color:${i}" value="${i}">${i}</option>`);
	}

	$selectElm.val(defaultVal);
	if (defaultVal) $selectElm.css("background-color", defaultVal);

	$selectElm.on("change", function() {
		note.setColor($(this).val());
	});
	return $selectElm;
}

note.clear = function() {
	$("#note").val("");
	note.setColor("");
	this.saveData();
	
}

note.init = async function() {
	this.loadData();

	this.initNamedColorSelector($("#noteColor"), trans.project?.files[this.thisFile]?.noteColor);
}


$(document).ready(function() {
	console.log("document ready");
	note.init()
	
	$("#note").on("change", function(e) {
		note.saveData();
	});

	$("#clearNote").on("click", function() {
		note.clear();
	})
});

$(window).on('hashchange', function(e) {
	console.log(note.getParameters());
	note.loadData();
});


win.on('close', function() {
	// Hide the window to give user the feeling of closing immediately
	this.hide();
	window.opener.$(".menu-button.addNote").removeClass("checked");

	// unregister this window on parent window.
	if (typeof window.opener.ui.windows.note !== 'undefined') window.opener.ui.windows.note = undefined;

	// After closing the new window, close the main window.
	this.close(true);

});