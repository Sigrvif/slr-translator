// events : configLoaded

window.fs = window.fs||require('graceful-fs');
window.gui = require('nw.gui');
try {
	window.transConfig = JSON.parse(localStorage.getItem('Config'));
} catch (e){
	console.log(e);
}

/**
 * System class.
 * Handles application & user configuration
 * @class
 */
const Sys = function() {
	this.clipboard = gui.Clipboard.get();
	this.config = window.transConfig || {};
	this.config.maxFileHistory = 30;
	this.app = nw.App.manifest;
	this.supportedExtension = nw.App.manifest.localConfig.extensions || [];
	this.$elm = $(window);
}

/**
 * Create a new event with JQuery eventing convenience
 * Equal to `$(window).on()`
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 * @example
 * sys.off('saveConfig', (e, opt)=> {
 * 	// do something
 * })
 */
 Sys.prototype.on = function(evt, fn) {
    this.$elm.on(evt, fn)
}

/**
 * Removes an event
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 * @example
 * sys.off('saveConfig', (e, opt)=> {
 * 	// do something
 * })
 */
 Sys.prototype.off = function(evt, fn) {
    this.$elm.off(evt, fn)
}

/**
 * Run the event once
 * Trigger an event and immediately removes it
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 */
 Sys.prototype.one = function(evt, fn) {
    this.$elm.one(evt, fn)
}

/**
 * Trigger an event
 * @param {String} evt - Event name
 * @param {Function} fn - Function to trigger
 * @since 4.3.20
 */
 Sys.prototype.trigger = function(evt, param) {
    this.$elm.trigger(evt, param)
}


Sys._default = {
			configPath: require("path").join(__dirname, "data", "config.json"),
			lastOpenedProject:{},
			historyOpenedProject : {},
			historyOpenedFiles :[],
			translator:"dslr"
		}

/**
 * Set config value
 * @param {String} key - Key setting
 * @param {*} value - Value of the setting
 * @since 4.4.4
 * @returns {Boolean} True if success
 */
Sys.prototype.setConfig = function(key, value) {
	this.config[key] = value;
	this.trigger("setConfig", [key, value])
	return true;
}


/**
 * Get config value
 * @param {String} key - Key setting
 * @since 4.4.4
 * @returns {*} The configuration from key
 */
 Sys.prototype.getConfig = function(key) {
	return this.config[key];
}

// Clipboard
Sys.prototype.afterSelectionAction = function(row, col, row2, col2, layer) {
	console.log("running sys.afterSelectionAction");
	console.log(arguments);
	this.clipboard.set(trans.data[row][0]);
}

Sys.prototype.toggleAutoClipboard =function(state) {
	state = state||false;
	
	if (state) {
		this.isClipboardMonitored = true;
		console.log("Begin monitoring cell selection");
		trans.grid.addHook('afterSelectionEnd', this.afterSelectionAction);
	} else {
		this.isClipboardMonitored = false;
		console.log("Stop monitoring cell selection");
		trans.grid.removeHook('afterSelectionEnd', this.afterSelectionAction);
	}
	return state;
}


Sys.prototype.loadConfig = async function(configPath, options) {
	if (window.transConfig) {
		if (typeof options.onSuccess == 'function') options.onSuccess.call(this, window.transConfig);
		this.config = window.transConfig;
		this.config.stagingPath =  this.config.stagingPath || nw.App.manifest.localConfig.defaultStagingPath;
		this.config.default 	=  this.config.default || {};
		this.config.default.sl 	=  this.config.default.sl || "ja";
		this.config.default.tl 	=  this.config.default.tl || "en";
		this.config.backupLevel	=  this.config.backupLevel || 1;
		this.config.MaxConcurrentBatches	=  this.config.MaxConcurrentBatches || 1;
		if (typeof this.config.autoBackup == "undefined") this.config.autoBackup = true;
		if (typeof this.config.japanesesource == "undefined") this.config.japanesesource = true;
		if (typeof this.config.englishtarget == "undefined") this.config.englishtarget = true;
		// Persist to localStorage so core modules that re-read it at load time
		// (e.g. transredbatch.js) pick up the runtime defaults even on the first
		// launch, instead of getting a stale/incomplete config from localStorage.
		this.saveConfig();

		this.isLoadingConfig = false;
		this.configIsLoaded = true;
		this.isInitialized = true;
		this.onReady.call(this, options.onReady);			
		return;
	}	
	
	
	configPath = configPath||require("path").join(__dirname, "data", "config.json");
	options = options||{};
	options.onReady = options.onReady||function(){};
	var thisSys = this;
	var initConfig = function() {
		thisSys.config = JSON.parse(JSON.stringify(Sys._default));
		// Apply the same runtime defaults as the file-load branch so the first
		// launch writes a complete config (including japanesesource/englishtarget)
		// to localStorage + disk. Without this, modules that re-read
		// localStorage.getItem('Config') at load time (e.g. transredbatch.js)
		// overwrite window.transConfig with null on the very first launch.
		thisSys.config.stagingPath =  thisSys.config.stagingPath || nw.App.manifest.localConfig.defaultStagingPath;
		thisSys.config.default 	=  thisSys.config.default || {};
		thisSys.config.default.sl 	=  thisSys.config.default.sl || "ja";
		thisSys.config.default.tl 	=  thisSys.config.default.tl || "en";
		thisSys.config.backupLevel	=  thisSys.config.backupLevel || 3;
		thisSys.config.MaxConcurrentBatches	=  thisSys.config.MaxConcurrentBatches || 1;
		if (typeof thisSys.config.autoBackup == "undefined") thisSys.config.autoBackup = true;
		if (typeof thisSys.config.japanesesource == "undefined") thisSys.config.japanesesource = true;
		if (typeof thisSys.config.englishtarget == "undefined") thisSys.config.englishtarget = true;
		window.transConfig = thisSys.config;
		thisSys.saveConfig();
		return thisSys.config;
	}
	
	thisSys.isLoadingConfig = true;
	thisSys.configIsLoaded = false;
	console.log("loading config : "+configPath);
	

	return new Promise((resolve, reject) => {
		fs.readFile(configPath, function (err, data) {
			if (err) {
				//throw err;
				//console.log("error opening file : "+filePath);
				initConfig();
				//data = data.toString();
				if (typeof options.onFailed =='function') options.onFailed.call(thisSys, data);
				reject(err);
				return;
			} else {
				data = data.toString();
				var jsonData = JSON.parse(data);
				thisSys.config = jsonData;
				if (typeof options.onSuccess == 'function') options.onSuccess.call(thisSys, jsonData);
			}
			// default
			thisSys.config.stagingPath =  thisSys.config.stagingPath || nw.App.manifest.localConfig.defaultStagingPath;
			thisSys.config.default 		=  thisSys.config.default || {};
			thisSys.config.default.sl 	=  thisSys.config.default.sl || "ja";
			thisSys.config.default.tl 	=  thisSys.config.default.tl || "en";
			thisSys.config.backupLevel	=  thisSys.config.backupLevel || 3;
			thisSys.config.MaxConcurrentBatches	=  thisSys.config.MaxConcurrentBatches || 1;
			if (typeof thisSys.config.autoBackup == "undefined") thisSys.config.autoBackup = true;
			if (typeof thisSys.config.japanesesource == "undefined") thisSys.config.japanesesource = true;
			if (typeof thisSys.config.englishtarget == "undefined") thisSys.config.englishtarget = true;
			window.transConfig = thisSys.config;

			// Persist (especially to localStorage) so that core modules which re-read
			// localStorage.getItem('Config') at load time (e.g. transredbatch.js) pick
			// up the runtime defaults on the very first launch instead of getting null.
			thisSys.saveConfig();

			thisSys.isLoadingConfig = false;
			thisSys.configIsLoaded 	= true;
			thisSys.isInitialized 	= true;
			$(window).trigger("configLoaded");
			thisSys.onReady.call(thisSys, options.onReady);	

			/** 
			 * Triggered when configuration is successfully loaded
			 * @event Sys#loadConfig
			 * @property {Object} config - The configuration that will be loaded (mutable)
			 */
			thisSys.trigger("loadConfig", thisSys.config);

			resolve(thisSys.config);
			return thisSys.config;
		});	
	})
	
}

	/**
	 * Refresh the window geometry in the config from the live window state.
	 *
	 * this.config is a copy made when the window loaded, but the window can be
	 * moved, resized or maximized at any time afterwards (main.js tracks that
	 * in the background context and only writes on close). Saving this stale
	 * copy used to overwrite the fresh geometry with load-time values.
	 */
	Sys.prototype.refreshLiveGeometry = function() {
		try {
			var geoWin = nw.Window.get();
			if (!geoWin.width || !geoWin.height) return;
			var geoMaximized = false;
			try { geoMaximized = chrome.app.window.current().isMaximized() === true; } catch (e) {}
			this.config.windowGeometry = geoMaximized ? { maximized: true } : {
				maximized: false,
				x: geoWin.x,
				y: geoWin.y,
				width: geoWin.width,
				height: geoWin.height
			};
		} catch (e) { /* window not available */ }
	}

	Sys.prototype.saveConfig = async function(configPath, options) {
		// During app teardown, config saves are forbidden: every option already
		// persists on change, so mid-quit saves only re-serialize sys.config at
		// the exact moment teardown mutates it — and the quit handler finishes
		// with its own disk-snapshot restore + geometry merge as the final
		// write. The flag lives on sys (shared across all windows via
		// window.opener.sys); a per-window nw flag would be invisible to the
		// options window's own teardown writes.
		if (this.__teardown === true) return Promise.resolve(this.config);
		//configPath = configPath||this.config.configPath||__dirname+"\\data\\config.json";
		configPath = configPath||nw.App.manifest.localConfig.configFile||require("path").join(__dirname, "data", "config.json");
		this.config.configPath = configPath; // updating config path
		options = options||{};
		this.refreshLiveGeometry();

	/** 
	 * Triggered when configuration is about to be saved
	 * @event Sys#beforeSaveConfig
	 * @property {Object} config - The configuration that will be saved (mutable)
	 * @since 4.3.20
	 */
	this.trigger("beforeSaveConfig", this.config);
	localStorage.setItem('Config', JSON.stringify(this.config));
	console.log("saving log to : "+configPath);
	
	return new Promise((resolve, reject) => {
		fs.writeFile(configPath, JSON.stringify(this.config, null, 2),  (err) => {
			console.log("done saving config");
			if (err) {
				if (typeof options.onFailed =='function') options.onFailed.call(trans, saveData, configPath);
				reject(err)
			} else {
				if (typeof options.onSuccess == 'function') options.onSuccess.call(trans, saveData, configPath);
				resolve(this.config)
				/** 
				 * Triggered when configuration is successfully saved
				 * @event Sys#saveConfig
				 * @property {Object} config - The configuration that has been saved (mutable)
				 * @since 4.3.20
				 */
				this.trigger("saveConfig", this.config);
			}
		});
	})

}

Sys.prototype.updateLastOpenedProject = function(projectData) {
	projectData = projectData||trans.project||{};
	
	this.config.lastOpenedProject = {
		buildOn: projectData.buildOn,
		gameEngine: projectData.gameEngine,
		gameTitle: projectData.gameTitle,
		projectId: projectData.projectId
	}
	this.config.historyOpenedProject = this.config.historyOpenedProject || {}
	this.config.historyOpenedProject[projectData.projectId] = this.config.lastOpenedProject;
	this.saveConfig();
	
}

Sys.prototype.insertOpenedFileHistory = function(filePath, projectId, gameTitle, initiator) {
	filePath = filePath||trans.currentFile||"";
	projectId = projectId||trans.projectId||"";
	gameTitle = gameTitle||trans.gameTitle||"";
	initiator = initiator||trans.initiator||"user";
	
	console.log("running sys.insertOpenedFileHistory. initiator : "+initiator);
	if (filePath == "") return false;
	
	this.config.historyOpenedFiles = this.config.historyOpenedFiles || []
	for (var i=0; i< this.config.historyOpenedFiles.length; i++) {
		//console.log(this.config.historyOpenedFiles[i].path +" == "+ filePath);
		if (this.config.historyOpenedFiles[i].path == filePath) {
			this.config.historyOpenedFiles.splice(i, 1);
			break;
			//return true;
		}
	}
	
	this.config.historyOpenedFiles.unshift({
		path:filePath,
		projectId:projectId,
		gameTitle:gameTitle,
		time:Date.now(),
		'initiator':initiator
	});
	
	if (this.config.historyOpenedFiles > this.config.maxFileHistory) {
		this.config.historyOpenedFiles.pop();
	}
	
	this.saveConfig();
}

Sys.prototype.loadFileHistory = function(index) {
	index = index||0;
	if (typeof this.config.historyOpenedFiles[index] == "undefined") return false;
	
	var targetPath = this.config.historyOpenedFiles[index].path;
	console.log("Opening : "+targetPath);
	trans.open(targetPath);
}


Sys.prototype.checkPHPEngine = function(options) {
	if (Boolean(this.phpIsReady) !== false)	return true;
	if (Boolean(php) == false) return;
	
	options = options||{};
	options.onDone = options.onDone||function(){};
	var that = this;
	php.spawn("version.php", {
		onDone:function(data) {
			//options.onDone.call(that, data);
			console.log("Version of PHP :");
			
			console.log(data);
			if (typeof data == "undefined" || data.version == undefined) {
				ui.warning((`<b>Unable to run PHP Interpreter!</b><br />
				SLR need PHP CLI to run some mandatory procedure.<br />
				This error usually occurred because your computer is <b>not installed with the correct version of Microsoft Visual C++ redistributable</a></b>.
				<div class="blockBox warningBlock withIcon">
					<ul>
						<li>Please install the required runtime</a>.</li>
						<li>And please move the SLR installation directory to other folder if you have installed all the runtime and still having this error.</li>
					</ul>
				</div>
				` +
				"Initialization Error!"));
			} else {
				that.phpVersion = data.version;
			}
		}
	});
	
}

Sys.prototype.getOpenedFile = function() {
	console.log("initiating opened file");
	this.openedFile = "";
	if (Array.isArray( window.args )) {
		this.openedFile = window.args[0];
	} else {
		window.args = window.args||"";
		if (window.args.length < 1) return "";
		/*
		var n = window.args.lastIndexOf(' ');
		this.openedFile = window.args.substring(n + 1);
		*/
		var { parseArgsStringToArgv } = require('string-argv');
		var argArray = parseArgsStringToArgv(window.args);
		this.openedFile = argArray.pop();
		
		if (this.openedFile.length < 1) return this.openedFile;
		
		if (this.openedFile[0] == '"') {
			this.openedFile = this.openedFile.substring(1, this.openedFile.length-1);
		}
	}		
	console.log(this.openedFile);
	return this.openedFile;
}

Sys.prototype.initApp = async function() {
	//var query = window.location.hash.substr(1);
	//var thisQuery = parseQuery(query);
	//if (Boolean(thisQuery.autoload) == false) return false;

	// staging data is regenerable from .slrproj / game folder, so discard any
	// cache left over from a previous session (or a crash) before we start
	try { await common.cleanStagingCache(); } catch (e) {}

	this.checkPHPEngine();
	/*
	var conf = confirm("Do you want to load last saved data?");
	if (conf == true) {
		this.loadFileHistory(0);
	}
	*/
	var openedFile = this.getOpenedFile();
	if (Boolean(openedFile)!== false) {
		console.log("Request opening file :", openedFile);
		ui.introWindowClose();
		await addonLoader.untilCompleted();
		var thisExt = openedFile.substring(openedFile.lastIndexOf(".")+1);
		thisExt = thisExt.toLowerCase();
		
		if (thisExt == "slrproj" || thisExt == "json" || thisExt == "trans") {
			trans.open(openedFile);
		}
		return;
	}
	ui.showRecentFile(5);
}

Sys.prototype.onReady = function (onReadyEvent) {
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

var sys = new Sys();

$(document).ready(function() {
	sys.loadConfig(undefined, {
		onSuccess: function() {
			if (typeof ui !== 'undefined') {
				ui.onReady(function() {
					sys.initApp();
				});
			}
		}
	});
});