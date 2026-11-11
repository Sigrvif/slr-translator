/**
 * @file Manages the addons
 * 
 */

//"use strict"
window.fs = window.fs||require('fs');
/**
 * @class
 * @param  {string} path
 * @param  {} options
 * @classdesc Add-on for SLR Translator
 * Addon is an additional script that is modular, can be added and removed as needed.
 * Modules are discovered from TWO source directories (see `AddonLoader.getSourceDirs`):
 *   - `www/core`  (localConfig.core)   — mandatory built-in core modules, loaded first.
 *   - `www/addons`(localConfig.addons) — optional user-supplied addons, loaded afterwards.
 * Every folder inside either directory that contains a `package.json` is loaded as
 * a SLR Translator addon. Core modules are flagged with `builtin: true` in their
 * package.json and cannot be removed.
 * There is no addon manager UI: a user addon is enabled by placing its folder in
 * `www/addons/` and fully removed by deleting that folder (restart required).
 * The `this` keyword in the top-level scope of javascript that is loaded as an addon will refer to the instance of this class.
 */
class Addon extends require("www/js/BasicEventHandler.js") {
	constructor(path, options) {
		super()
		this.path 	= path;
		this.id 	= nwPath.basename(this.path);
		this.options = options || {};
		// Base directory this addon lives in. Core modules live under
		// localConfig.core (www/core); user addons under localConfig.addons
		// (www/addons). Defaults to localConfig.addons for backward compatibility.
		var pluginPath = this.options.basePath || nw.App.manifest.localConfig.addons;
		pluginPath = pluginPath.replace(/\\/g, "/");
		this.basePath = pluginPath;

		this.fullPath = pluginPath+"/"+this.path
		this.options.onload = this.options.onload || (() => {});
		this.files = {};
		this.package = {};
		this.param = {};
		this.config = {
			isMandatory : false
		};
		this.isReady = false;
		this.html;
	
	}
}

Addon.prototype.setConfig = function(key, value) {
	this.config[key] = value;
	sys.saveConfig()
	return this.config;
}

Addon.prototype.getConfig = function(key) {
	if (typeof this.config[key] !== "undefined") return this.config[key];
	
	// otherwise get from the default JSONForm options
	if (typeof this.optionsForm?.schema?.[key]?.default !== "undefined") return this.optionsForm.schema[key].default;
	
	// get from the default value of modified JSONForm
	if (typeof this.optionsForm?.[key]?.HOOK !== "undefined") {
		try {
			return eval(this.optionsForm[key].HOOK);
		} catch (e) {
			return undefined;
		}
	}
	
	if (typeof this.optionsForm?.[key]?.default !== "undefined") return this.optionsForm[key].default;

	return undefined;
}

/**
 * Wrap this.config in a Proxy that returns default values for missing keys
 * WITHOUT persisting them. Defaults are collected from this.optionsForm[key].default
 * and optionally merged with extraDefaults. This keeps config.json clean — only
 * user-changed values are stored — so that updating a default in a new version
 * automatically applies to existing users who never touched the setting.
 *
 * The Proxy intercepts:
 *   get  — returns the stored value if present, else the default. Stored strings
 *          are coerced to numbers when the matching default is a number (the
 *          options form can save numbers as strings).
 *   set  — writes to the underlying stored config (so saveConfig only persists
 *          user-set values).
 *   has  — true if the key exists in either the stored config or the defaults.
 *
 * An optional migrate(key, value, storedConfig) callback can return a replacement
 * value for specific keys (e.g. rename old enum values, validate ranges).
 *
 * @param {Object} [extraDefaults] - additional defaults for keys NOT in optionsForm
 * @param {Function} [migrate] - optional (key, value, storedConfig) => value|undefined
 * @returns {Proxy} the proxied config (also assigned to this.config)
 * @since 5.8.14
 */
Addon.prototype.applyDefaults = function(extraDefaults, migrate) {
	var storedConfig = this.config;
	var defaults = {};
	if (this.optionsForm) {
		for (var key in this.optionsForm) {
			if (typeof this.optionsForm[key].default !== "undefined") {
				defaults[key] = this.optionsForm[key].default;
			}
		}
	}
	if (extraDefaults) Object.assign(defaults, extraDefaults);
	this._defaultConfig = defaults;

	this.config = new Proxy(storedConfig, {
		get: function(target, prop) {
			var hasStored = Reflect.has(target, prop);
			var hasDefault = Reflect.has(defaults, prop);
			if (!hasStored && !hasDefault) return undefined;
			var val = hasStored ? target[prop] : defaults[prop];
			if (hasStored && typeof val === "string" && typeof defaults[prop] === "number") {
				val = parseFloat(val);
			}
			if (typeof migrate === "function") {
				var migrated = migrate(prop, val, target);
				if (migrated !== undefined) return migrated;
			}
			return val;
		},
		set: function(target, prop, value) {
			target[prop] = value;
			return true;
		},
		has: function(target, prop) {
			return Reflect.has(target, prop) || Reflect.has(defaults, prop);
		}
	});
	return this.config;
}

/**
 * Whether this addon ships with SLR Translator (built-in). Built-in addons
 * can not be disabled or removed; only packages added later are treated as
 * removable user addons.
 * @returns {Boolean}
 */
Addon.prototype.isBuiltin = function() {
	return Boolean(this.package && this.package.builtin);
}

/**
 * Resolve the relative path from the root of a local path relative to addon
 * Translates the trailing slash to the root path of the addon
 * @param {String} path 
 * @returns {String} - Path to the addon
 */
Addon.prototype.resolvePath = function(path="") {
	path = path.replaceAll("\\", "/");
	if (path[0] == "/") return (nwPath.join(this.getPathRelativeToRoot(), path)).replaceAll("\\", "/");
	return path; 
}

Addon.prototype.getLocation = function() {
	// get location of the engine
	return nwPath.normalize(nwPath.join(__dirname, this.fullPath));
}

Addon.prototype.getWebLocation = function() {
	// get location of the engine
	return this.fullPath.substring(nwPath.dirname(location.pathname).length);
}

Addon.prototype.createElement = function() {
	if (Boolean(document.getElementById('addons')) == false) {
		//console.log("Creating addon element!");
		var wraper = document.createElement("div");
		wraper.setAttribute("id", "addons")
		wraper.setAttribute("class", "addon hidden")
		wraper.setAttribute("style", "display:none")
		document.body.appendChild(wraper);
	}
	
	var addOnId = "_addon_"+this.path;
	
	// remove existing element;
	var existing = document.getElementById(addOnId)
	if (existing) existing.remove();
	
	this.html = document.createElement('div');
	this.html.setAttribute("class", "addon "+this.path);
	this.html.setAttribute("name", this.path);
	this.html.setAttribute("id", addOnId);
	document.getElementById('addons').appendChild(this.html);
		
	return this.html;
}

Addon.prototype.loadPackage = async function() {
	//var json = fs.readFileSync(this.fullPath+"/package.json");
	var json = await common.fileGetContents(this.fullPath+"/package.json");
	try {
		this.package = JSON.parse(json);
	} catch (e) {
		console.warn("Error when loading package.json", this.fullPath+"/package.json", json);
	}
	this.package.config = this.package.config || {};
	Object.assign(this.config, this.package.config);
	// Builtin addons ship with SLR Translator and can not be disabled or removed.
	if (this.package.builtin) this.config.isMandatory = true;
	return this.package;
}

/**
 * Load and execute a JavaScript file inside this addon's context. The script
 * body runs as an async function with `this` bound to the Addon instance.
 * A script that cannot be read or that throws does not abort the loader: the
 * error is logged and the addon continues with its remaining files.
 * @param {String} path
 */
Addon.prototype.loadJS = async function(path) {
	try {
		var thisScript = await common.fileGetContents(path);
		let AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
		var thisExecution = new AsyncFunction(thisScript.toString());
		thisExecution.call(this, this.param);
	} catch (e) {
		console.warn("Error when executing script : "+this.path+" ("+path+")", e);
	}

	return this;
}

/**
 * Get relative path of the addon 
 * @returns {string} - back slashes based add-on's path relative to SLR Translator installation. No trailing slash.
 */
Addon.prototype.getPathRelativeToRoot = function() {
	return nwPath.join(this.basePath, this.path)
}

/**
 * Get relative path of the addon 
 * @returns {string} - forward slashes based add-on's path relative to SLR Translator installation. No trailing slash.
 */
Addon.prototype.getRelativePath = function() {
	return (nwPath.join(this.basePath, this.path)).replaceAll("\\", "/")
}

Addon.prototype.getRootDocPath = function(path) {
	path = path || "";
	path = path.replaceAll("\\", "/");
	var thisPath = path.split("/");
	thisPath.shift();
	return thisPath.join("/");
}

Addon.prototype.loadCss = async function(path, parentObj) {
	parentObj = parentObj || {}
	return new Promise ((resolve, reject) => {
		var script = document.createElement('link');
		script.setAttribute("rel", "stylesheet");
		script.setAttribute("type", "text/css");
		script.setAttribute("data-path", path);
		script.onload = (e) => {
			parentObj.elm = script;
			resolve(script)
		}
		script.setAttribute("href",this.getRootDocPath(path));
		this.html.appendChild(script);
	});

}

Addon.prototype.loadHTML = async function(path, parentObj) {
	parentObj = parentObj ||{};
	return new Promise ((resolve, reject) => {
		var htmlString =  fs.readFileSync(path).toString();
		var div = document.createElement('div');
		div.setAttribute("data-path", path);
		div.innerHTML = htmlString.trim();
		this.html.appendChild(div);
		parentObj.elm = div
		resolve(div); 	
	});
}

Addon.prototype.loadBackgroundPage = async function(path, parentObj) {
	if ($(this.html).find(`[data-bgpage="${path}"]`).length) return $(this.html).find(`[data-bgpage="${path}"]`)[0];
	return new Promise ((resolve, reject) => {
		var script = document.createElement('iframe');
		script.onload = (e) => {
			resolve(script)
		}
		script.setAttribute("src", path);
		script.setAttribute("data-bgpage", path);
		this.html.appendChild(script);
	});
}

Addon.prototype.unloadBackgroundPage = async function(path, parentObj) {
	$(this.html).find(`[data-bgpage="${path}"]`).remove();
}

Addon.prototype.onReady = function(fn) {
	if (typeof fn !== 'function') fn = function() {};
	this.__onScriptsLoadedPool = this.__onScriptsLoadedPool||[];
	
	if (Boolean(this.isReady) == false) {
		this.__onScriptsLoadedPool.push(fn)
	} else {
		for (var i=0; i<this.__onScriptsLoadedPool.length; i++) {
			this.__onScriptsLoadedPool[i].apply(this, arguments);
		}
		
		fn.apply(this, arguments);
	}		
}

Addon.prototype.getFile = function(file) {
	if (!file) return console.warn("No file specified");
	var fwd = file.replace(/\\/g, "/");
	if (fwd[0] !== "/") fwd = "/" + fwd;
	var back = fwd.replace(/\//g, "\\");
	return this.files[fwd] || this.files[back] || this.files[file];
}

/**
 * Register addon's node modules to the global scope global
 * @since 5.8.13
 */
Addon.prototype.globalizeNodeModules = function() {
	const thisPath = this.getPathRelativeToRoot();
	moduleAlias.addPath(thisPath+'/node_modules');
	moduleAlias(thisPath+'/package.json');
}

/**
 * Load node modules that installed locally
 * @param {string} moduleName - Name of the installed module
 * @since 5.8.13
 */
Addon.prototype.require = function(moduleName) {
	if (!moduleName) return;
	const thisPath = this.getPathRelativeToRoot();
	let newPath = {}
	const localPath = '@'+this.id;
	newPath[localPath] = thisPath + "/node_modules"
	moduleAlias.addAliases(newPath)
	
	return require(`${localPath}/${moduleName}`);
}

Addon.prototype.init = async function() {
	return new Promise(async (resolve, reject)=> {
		this.createElement();
		await this.loadPackage();

		var finish = () => {
			this.isReady = true;
			this.options.onload.apply(this);
			this.onReady();
			resolve(this);

			/**
			 * Addon is loaded and ready
			 * @event Addon#onLoaded 
			 * @type {BasicEventHandler#Event}
			 * @deprecated Deprecated since 4.12.1. Use `loaded` instead
			 */
			this.trigger("onLoaded", this);			
			/**
			 * Addon is loaded and ready
			 * @event Addon#loaded 
			 * @type {BasicEventHandler#Event|BasicEventHandler#State}
			 */

			this.trigger("loaded", this);
			this.resolveState("loaded", this);
			return this;
		}
		
		sys.config.addons 			= sys.config.addons || {};
		sys.config.addons.package 	= sys.config.addons.package || {};
		sys.config.addons.package[this.package.name] = sys.config.addons.package[this.package.name] || this.config || {}
		this.config = sys.config.addons.package[this.package.name];

		var dirContent = [];
		if (this.package.autoload) {
			// todo : async this
			dirContent = await common.readDir(this.fullPath);
		}

		if (Array.isArray(this.package.load)) {
			// convert to the path relative to root
			var loaded = [];
			for (var i=0; i<this.package.load.length; i++) {
				loaded.push(nwPath.join(this.getPathRelativeToRoot(), this.package.load[i]));
			}
			// merge with package.load
			dirContent = dirContent.concat(loaded);
		}
		
		var promises = [];
		for (let i=0; i<dirContent.length; i++) {
			var thisPath = dirContent[i];
			var thisData = {}
			var relPath = thisPath.substr(this.fullPath.length)
			thisData.path 	= thisPath
			thisData.ext 	= common.getFileExtension(thisPath).toLowerCase();
			
			if (nwPath.basename(thisPath)[0] == "!") {
				// skip including if the first character of filename is "!"
				this.files[relPath] = thisData;
				continue;
			}

			if (thisData.ext == "js") {
				promises.push(this.loadJS(thisPath, thisData))
			} else if (thisData.ext == "htm" || thisData.ext == "html") {
				promises.push(this.loadHTML(thisPath, thisData))
			} else if (thisData.ext == "css") {
				promises.push(this.loadCss(thisPath, thisData))
			}
			
			this.files[relPath] = thisData;
		}

		await Promise.all(promises)
		return finish();
	})
}


/**
 * Handle addons
 * @class
 */
class AddonLoader extends require("www/js/BasicEventHandler.js") {
	constructor($elm) {
		super($elm)
		this.init.apply(this, arguments);
		this.completePromise = new Promise((resolve, reject) => {
			this.completeResolver = resolve;
		}) 
	}
}

AddonLoader.prototype.init = function() {
	this.isInitialized = false;
	this.isInitialized = true;
	this.onReady.apply(this, arguments);
	this.addons = {};
	this.scriptsLoaded = false;
}


AddonLoader.prototype.untilCompleted = async function() {
	return this.completePromise;
}

AddonLoader.prototype.onScriptsLoaded = function(act) {
	if (typeof act !== 'function') return console.log("parameter must be a function", act);
	this.__onScriptsLoadedPool = this.__onScriptsLoadedPool||[];
	
	if (Boolean(this.scriptsLoaded) == false) {
		this.__onScriptsLoadedPool.push(act)
	} else {
		for (var i=0; i<this.__onScriptsLoadedPool.length; i++) {
			this.__onScriptsLoadedPool[i].apply(this, arguments);
		}
		
		act.apply(this, arguments);
	}
}

AddonLoader.prototype.onReady = AddonLoader.prototype.onScriptsLoaded;

AddonLoader.prototype.load = async function(dir, basePath) {
	if (this.addons[dir]) {
		console.warn("Addon already loaded, skipping: ", dir);
		return; // already loaded;
	}

	var addonPath = basePath || nw.App.manifest.localConfig.addons;
	addonPath = addonPath.replace(/\\/g, "/");

	if (await common.isDirectory(addonPath+"/"+dir) == false) return;
	if (await common.isFileAsync(addonPath+"/"+dir+"/package.json") == false) return;

	console.log("Loading addon ", addonPath+"/"+dir);
	this.length++;
	this.addons[dir] = new Addon(dir, {basePath: addonPath});
	await this.addons[dir].init();
	this.addons[dir].trigger("load");
}

/**
 * Ordered list of source directories scanned at startup.
 * Core modules (`localConfig.core`, i.e. `www/core`) are scanned FIRST so they
 * always load and take precedence on folder-name collisions. User addons
 * (`localConfig.addons`, i.e. `www/addons`) are scanned afterwards. Missing or
 * empty directories are skipped silently at load time.
 * @returns {String[]} - forward-slash source directories, core first
 */
AddonLoader.getSourceDirs = function() {
	var cfg = nw.App.manifest.localConfig;
	var dirs = [];
	if (cfg.core) dirs.push(cfg.core.replace(/\\/g, "/"));
	if (cfg.addons) dirs.push(cfg.addons.replace(/\\/g, "/"));
	return dirs;
}

AddonLoader.prototype.loadAll = async function(options) {
	console.log("Load all addons with arguments", options);
	options = options||{}
	options.onScriptsLoaded = options.onScriptsLoaded||function(){};
	options.select ||= []; // load only selected directory

	var sourceDirs = AddonLoader.getSourceDirs();
	this.length 	= 0;
	var promises 	= [];

	if (options.select.length > 0) {
		// load selected (search every source dir; first match wins, core first)
		console.log("Load selected addon", options.select);
		for (let i=0; i<options.select.length; i++) {
			for (let d=0; d<sourceDirs.length; d++) {
				if (await common.isDirectory(nwPath.join(sourceDirs[d], options.select[i]))) {
					promises.push(this.load(options.select[i], sourceDirs[d]).catch((e)=> {
						console.warn("Failed to load addon "+options.select[i], e);
					}));
					break;
				}
			}
		}
	} else {
		// load all from every source dir (core first, then user addons).
		// A broken addon must never keep the whole application from starting,
		// so each load failure is caught and only logged.
		for (let d=0; d<sourceDirs.length; d++) {
			var addonPath = sourceDirs[d];
			var dirContent;
			try {
				dirContent = await fs.promises.readdir(addonPath);
			} catch (e) {
				// source dir missing or unreadable (e.g. no user addons yet) — skip
				continue;
			}
			for (let i=0; i<dirContent.length; i++) {
				if (!await common.isDirectory(nwPath.join(addonPath, dirContent[i]))) continue;
				promises.push(this.load(dirContent[i], addonPath).catch((e)=> {
					console.warn("Failed to load addon "+dirContent[i], e);
				}));
			}
		}
	}


	await Promise.all(promises);
	console.log("Running addonLoader.onReady");
	this.scriptsLoaded = true;
	this.onReady(function(){});
	this.trigger("loaded");
	if (this.completeResolver) this.completeResolver();
	this.__allFileIsAdded = true;
	this.isComplete = true;
}

/**
 * @global
 */
var addonLoader = new AddonLoader();

// a class can not be accessed from child page
window.classAddon = Addon

$(document).ready(function() {
	var getLoadedAddonFromURL = function() {
		// load list addon from URL if any
		// If URL has get parameters addons, then SLR Translator will load only that addons.
		var searchparam = new URLSearchParams(window.location.search);
		var selectedAddon = searchparam.get("addons");
		if (!selectedAddon) return;
		
		return selectedAddon.split(",");
	}
	
	sys.onReady(()=> {
		addonLoader.loadAll({
			select:getLoadedAddonFromURL()
		});
	});
});