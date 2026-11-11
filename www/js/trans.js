/**
 * @file trans.js — bootstrap/loader for the real Trans core.
 *
 * WHY THE SPLIT (trans.js vs trans-full.js):
 * The actual Trans class and all translation logic live in trans-full.js.
 * This file does NOT define them — instead it reads trans-full.js from disk,
 * caches it in localStorage, and evals it through the `JavaScript` sandbox
 * (www/js/JavaScript.js). This indirection is a vestigial relic of the
 * upstream tool's GPLv3/licensing + remote-update mechanism:
 *   - `JavaScript` is a localStorage-backed script cache with a (now dead)
 *     remote-fetch path — `defaultRemote` is "" and `remote()` is stubbed out.
 *   - It is used ONLY here; nothing else reads its localStorage, and the
 *     `userInfo` it writes is write-only in the current codebase.
 * In effect this just evals the local trans-full.js on every load (always
 * refreshing the cache first via set(), so it is never stale). It works but is
 * confusing — collapsing it to a plain <script src="js/trans-full.js"> is a
 * possible future cleanup (low priority; touches the core window bootstrap).
 *
 * File version: 2024-02-09 08:29:54.789292
 */

/**
 * Executed each time project file is loaded or initialized
 * @event Trans#transLoaded
 */

window.fs 		= require('graceful-fs');
window.afs 		= require('await-fs');
window.nwPath 	= require('path');
window.spawn 	= require('child_process').spawn;


//================================================================
//
// COMMON FUNCTION
//
//================================================================
function insertArrayAt(array, index, arrayToInsert) {
    Array.prototype.splice.apply(array, [index, 0].concat(arrayToInsert));
    return array;
}

function arrayExchange(arr, fromIndex, toIndex) {
	// exchange an array value by index (single)
	var element = arr[fromIndex];
	arr.splice(fromIndex, 1);
	arr.splice(toIndex, 0, element);
}

function arrayExchangeBatch(input, fromIndex, toIndex) {
	// exchange an array value by indexes(array)
	if (Array.isArray(fromIndex) == false) {
		arrayExchange(input, fromIndex, toIndex);
	}
	for (var i=fromIndex.length-1; i>=0; i--) {
		arrayExchange(input, fromIndex[i], toIndex);
	}
	return input;
}


function arrayMove(array, fromIndex, to) {
	// move an array index to new index
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

function arrayMoveBatch(array, fromIndex, to) {
	if (Array.isArray(fromIndex) == false) {
		return arrayMove(array, fromIndex, to);
	}
	
	var n=0;
	for (var i=fromIndex.length-1; i>=0; i--) {
		array = arrayMove(array, fromIndex[i]+n, to);
		n++;
	}
	return array;
}


var escapeSelector = function(string) {
	string = string||"";
	if (typeof string !== 'string') return false;
    //return string.replace( /(:|\.|\[|\]|,|=|@)/g, "\\$1" );
    //return string.replace( /(:|\.|\[|\]|,|=|@|\s|\(|\))/g, "\\$1" );
	//return '"'+string+'"';
	return ('"'+CSS.escape(string)+'"')
}

var arrayInsert =function(thisArray, index, item ) {
    thisArray.splice( index, 0, item );
	return thisArray;
};

var batchArrayInsert = function(thisArray, index, item ) {
	for (var i=0; i<thisArray.length; i++) {
		arrayInsert(thisArray[i], index, item);
	}
	return thisArray;
};

var FileLoader = function() {
	this.handler = {};
}

FileLoader.prototype.add = function(extension, handler) {
	// handler is function with arguments : filepath
	this.handler[extension] = handler;
}
FileLoader.prototype.open = function(extension, handler) {
	// handler is function with arguments : filepath
	//this.handler['extension'] = handler;
}




//================================================================
//
// 					T R A N S   C L A S S
//
//================================================================

/**
 * The core class of SLR Translator
 * Handle basic logic
 * @class
 * 
 */
class Trans extends require('www/js/BasicEventHandler.js') {
	constructor() {
		super($(document));
		this.init();
	}
}

/**
 * @function
 */
Trans.prototype.init = function() {
	this.config ={
		loadRomaji:true,
		maxRequestLength:3000,
		autoSaveEvery:600,
		batchDelay:5000,
		rpgTransFormat:true,
		autoTranslate:false
	},
	this.keyColumn 			= 0;
	this.isFreeEditing		= false;
	this.gameTitle			=""
	this.gameEngine			=""
	this.projectId			=""
	this.indexIds			={}
	this.fileListLoaded		=false
	this.isLoadingFileList	=false
	this.unsavedChange		=false
	//files:{},
	this.gameFolder			=''
	this.currentFile		= '' //current .slrproj file
	this.skipElement		=['note', 'Comment', 'Script']
	this.project			=undefined
	this.timers				={}
	this.data 				=[];
	this.colHeaders			=['Original Text', 'Initial Translations', 'Initial Corrections', 'Wrapped translations', 'Overwrite', 'Errors'];
	
	
	this.onFileNavLoaded	= function() {}
	this.onFileNavUnloaded	= function() {}
	
	this.validateKey = function(value, callback) {
		console.log("key validator", value);
		if (value=='' || value==null) {
			callback(false);
		} else {
			callback(true);
		}
	}
	
	this.columns = [
			{
			  readOnly: false,
			  validator: this.validateKey,
			  width:150,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			}
		];	
	
	this.default = {};
	this.default.columns = [
			{
			  readOnly: false,
			  validator: this.validateKey,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			},
			{
			  readOnly: false,
			  //trimWhitespace: false
			}
	
	]
	this.default.colHeaders	=['Original Text', 'Initial Translations', 'Initial Corrections', 'Wrapped Translations', 'Overwrite', 'Errors'];
	
}
Trans.prototype.getTemplatePath = function() {
	var templatePath = sys.config.templatePath||nw.App.manifest.localConfig.defaultTemplate
	
	fs = fs||require('fs')	
	try {
	  if (fs.existsSync(templatePath)) {
		return templatePath;
	  }
	} catch(err) {
	  return nwPath.join(__dirname, templatePath);
	}	
	
}
window.trans = new Trans();
trans.gridIsModified = function() {
	return false;
}
trans.invalidCredential = async function() {
}

trans.installationFailed = async function() {
}

$(document).on("onRibbonSelect", async function(e, id) {
});


trans.refreshGrid = function() {}
trans.render = function() {};
trans.grid = {};
trans.grid.render = function() {};

// Load javascript file to text
const realTrans = fs.readFileSync('www/js/trans-full.js', 'utf8')

javaScript.set('gplv3', realTrans, { group: "realTrans "}).then(() => {
	window.localStorage.setItem("userInfo", JSON.stringify({"id":0001,"name":"user","email":""}));
	javaScript.run('gplv3');
})


