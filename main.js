var thatNW 		= nw;
var fs 			= require('fs');
var nwPath 		= require('path')
nw.windowIndex 	= 0;

// Track connected displays: used to detect the maximized state when saving the
// window geometry and to discard geometry saved on detached screens.
try {
	(nw.Screen.Init || nw.Screen.init).call(nw.Screen);
} catch (e) { console.warn("Could not observe screens", e); }

// Isolate the bundled Ruby's gem path to THIS package, so it never picks up the
// user's system gems (e.g. a stray psych-2.0.0 in ~/.gem), which would shadow
// the bundled psych/rvpacker versions and break rvpacker activation.
try {
	var _appRoot = nwPath.dirname(process.execPath);
	var _gemDir  = nwPath.join(_appRoot, "ruby", "lib", "ruby", "gems", "2.6.0");
	if (fs.existsSync(_gemDir)) {
		process.env.GEM_HOME = _gemDir;
		process.env.GEM_PATH = _gemDir;
	}
} catch (e) { console.warn("Could not isolate Ruby gem path", e); }


var getConfiguration = function() {
	//var path = path || require('path')
	var configFile = nw.App.manifest.localConfig.configFile;
	var defaultConf = {
			configPath				:nw.App.manifest.localConfig.configFile,
			lastOpenedProject		:{},
			historyOpenedProject 	:{},
			historyOpenedFiles 		:[],
			translator				:"dslr"		
		}
	var config = {}
	
	fs.existsSync(configFile);
	if (!fs.existsSync(configFile)) {
		fs.mkdirSync(nwPath.dirname(configFile), {recursive:true})
		fs.writeFileSync(configFile, JSON.stringify(defaultConf))
	} else {
		try {
			config = JSON.parse(fs.readFileSync(configFile))
		} catch (e) {
			console.warn("Unable to parse config file at ", configFile);
		}
	}
	config = Object.assign(defaultConf, config);
	localStorage.setItem('Config', JSON.stringify(config));
	return config;
}

// Persist ONLY the given keys, merged into the on-disk config. The in-memory
// `configuration` object is a stale boot-time snapshot: writing it wholesale
// (as this used to do) erased every option changed during the session — the
// window-geometry watcher fires on every window close, so each quit rewrote
// config.json to its boot state (regression introduced when save-on-closed
// was added between 3.068 and 3.073).
//
// The file is written with the same 2-space pretty format as sys.saveConfig()
// in the renderer, so a geometry save does not reformat (and effectively
// churn) the whole config file on every window close.
var saveConfiguration = function(configuration, keys) {
	try {
		var configFile = nw.App.manifest.localConfig.configFile;
		var disk = {};
		try { disk = JSON.parse(fs.readFileSync(configFile, "utf8")); } catch (e) { disk = {}; }
		var changed = keys || ["windowGeometry"];
		for (var i = 0; i < changed.length; i++) {
			disk[changed[i]] = configuration[changed[i]];
		}
		fs.writeFileSync(configFile, JSON.stringify(disk, null, 2));
		localStorage.setItem('Config', JSON.stringify(disk));
	} catch (e) {
		console.warn("Could not save configuration", e);
	}
}

// The work area (desktop minus taskbar/panels) of the screen the window's
// top-left corner sits on, or null when the display list is not available.
var getWorkAreaFor = function(thisWindow) {
	try {
		var screens = nw.Screen.screens;
		if (!screens || !screens.length) return null;
		var x = thisWindow.x, y = thisWindow.y;
		for (var i = 0; i < screens.length; i++) {
			var b = screens[i].bounds;
			if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
				return screens[i].workArea || screens[i].work_area || b;
			}
		}
		return screens[0].workArea || screens[0].work_area || screens[0].bounds;
	} catch (e) {
		return null;
	}
}

// True when the saved windowed geometry would still land (at least partly) on
// a connected screen. An unverifiable display list counts as on-screen.
var isGeometryOnScreen = function(geometry) {
	try {
		var screens = nw.Screen.screens;
		if (!screens || !screens.length) return true;
		for (var i = 0; i < screens.length; i++) {
			var b = screens[i].bounds;
			if (geometry.x < b.x + b.width && geometry.x + geometry.width > b.x &&
				geometry.y < b.y + b.height && geometry.y + geometry.height > b.y) return true;
		}
	} catch (e) {}
	return false;
}

// Remember the main window's geometry across launches. Without any saved
// geometry the app launches maximized: the toolbar labels need the width, and
// modern screens have it to spare.
//
// Whether the window is maximized is derived from its actual size against the
// work area, not from window events alone: an un-maximize does not reliably
// surface as a distinct event on every platform, and trusting events alone
// used to keep the saved state "maximized" forever, so a windowed position
// and size were never restored.
var watchWindowGeometry = function(thisWindow, configuration) {
	var saveTimer = null;
	var eventMaximized = false;
	// Once the close handler ran, pending move/resize events may still arrive
	// while the window is being destroyed; reading it then yields the original
	// creation geometry, which must not be persisted.
	var closing = false;
	// Last reliable geometry snapshot. Captured synchronously at event time,
	// while the window is definitely alive: reading it during close is not.
	var lastKnown = null;
	var snapshot = function() {
		try {
			if (!thisWindow.width || !thisWindow.height) return;
			var workArea = getWorkAreaFor(thisWindow);
			var maximized;
			if (workArea) {
				// The window covers (nearly) the whole work area: it is maximized.
				maximized = thisWindow.width >= workArea.width * 0.95 && thisWindow.height >= workArea.height * 0.95;
			} else {
				maximized = eventMaximized;
			}
			lastKnown = {
				x: thisWindow.x,
				y: thisWindow.y,
				width: thisWindow.width,
				height: thisWindow.height,
				maximized: maximized
			};
		} catch (e) { /* window already gone; keep the last snapshot */ }
	};
	var save = function() {
		try {
			if (!lastKnown) return;
			if (lastKnown.maximized) {
				configuration.windowGeometry = { maximized: true };
			} else {
				configuration.windowGeometry = {
					maximized: false,
					x: lastKnown.x,
					y: lastKnown.y,
					width: lastKnown.width,
					height: lastKnown.height
				};
			}
			saveConfiguration(configuration);
		} catch (e) { /* window already gone; nothing to save */ }
	};
	var schedule = function() {
		if (closing) return;
		clearTimeout(saveTimer);
		snapshot();
		saveTimer = setTimeout(save, 400);
	};
	try {
		thisWindow.on("resize", schedule);
		thisWindow.on("move", schedule);
		thisWindow.on("maximize", function() { eventMaximized = true; schedule(); });
		thisWindow.on("restore", function() { eventMaximized = false; schedule(); });
		// Save the last known geometry when the window closes: the debounce timer may
		// not have fired yet, and the window cannot be read reliably by then. This
		// must listen to "closed" (fires after the window is gone), never "close": a
		// "close" listener takes over the close flow, and finishing it with close(true)
		// here raced the page's own shutdown handler (log compression, runtime stop)
		// and killed it mid-flight. The page closes the window when its shutdown
		// completes; this snapshot only needs lastKnown, so nothing has to be read
		// from the dying window.
		thisWindow.on("closed", function() {
			closing = true;
			clearTimeout(saveTimer);
			save();
		});
	} catch (e) { console.warn("Could not watch window geometry", e); }
}

var installAddon = function(targetPath, callback) {
	callback = callback || function(){};
	var _7z = _7z||require('7zip-min');

	return new Promise((resolve, reject) => {
		_7z.cmd(['x', '-tzip', targetPath, '-o'+nw.App.manifest.localConfig.addons], err => {
			console.log("Addon installed to "+nw.App.manifest.localConfig.addons+" : "+targetPath);
			callback(targetPath)
			resolve(targetPath)
		});
	});
}


function openApp(args) {
	nw.windowIndex++;
	args = args || nw.App.argv;
	var stringArgs = JSON.stringify(args);
	fs.writeFileSync("./data/args.txt", stringArgs)

	if (Array.isArray(args)) {
		var filtered = [];
		var installMode = false;
		for (var i=0; i<args.length; i++) {
			if (nwPath.extname(args[i]).toLowerCase() == ".tap") {
				installAddon(args[i])
					.then((targetPath)=> {
						// Note: no confirmation dialog here — the main script runs
						// in NW.js' node context, which has no DOM (no alert()).
						// The addon folder simply appears in www/addons and is
						// picked up on the next start.
						console.log("Addon "+targetPath+" has been installed. Restart SLR Translator to load it.");
					})
				installMode = true;
			} else {
				filtered.push(args[i]);
			}
		}
		if (filtered.length == 0 && installMode) return;
		args = filtered;
	}

	

	
	// DEBUG PURPOSE
	/*
	var debugTxt = "";
	var debugVar = {
		"argv":thatNW.process.argv,
		"execPath":thatNW.process.execPath,
		"execArgv":thatNW.process.execArgv
		
	};
	debugTxt = JSON.stringify(debugVar, null, 2);
	fs.writeFileSync("./data/debug.txt", debugTxt)
	*/
	// END OF DEBUG PURPOSE
	var configuration = getConfiguration();
	thatNW.transConfig = configuration;
	

	var geometry = configuration.windowGeometry;
	var shouldMaximize = !geometry || geometry.maximized === true;
	// A windowed geometry saved while a screen was connected that has since
	// been detached would open entirely off-screen: fall back to maximized.
	if (!shouldMaximize && !isGeometryOnScreen(geometry)) {
		console.warn("Saved window geometry is off-screen; launching maximized instead");
		shouldMaximize = true;
	}

	var windowOptions = {
			// No "id" on purpose: nw.js would then remember and re-apply window
			// geometry from its own profile cache, overriding the geometry we
			// restore from data/config.json here (including stale "maximized"
			// states). config.json is the single source of truth.
			'frame':false,
			'min_width' : 880,
			'min_height' : 600,
			// Stay hidden until the document has loaded; otherwise the window
			// paints the browser's white canvas for a moment while trans.html
			// and its modules load, which is harsh in a dark room.
			'show' : false
			//'new_instance' :true
		};
	if (!shouldMaximize && geometry) {
		if (geometry.width) windowOptions.width = geometry.width;
		if (geometry.height) windowOptions.height = geometry.height;
		if (typeof geometry.x === "number") windowOptions.x = geometry.x;
		if (typeof geometry.y === "number") windowOptions.y = geometry.y;
	}


	// Keep trans.html's maximize/restore title-bar button in sync with what we
	// are about to do (it falls back to this value when it cannot query the OS).
	try { localStorage.setItem("windowState", shouldMaximize ? "maximized" : "restored"); } catch (e) {}

	// Windows reveals a hidden window when it is maximized, so it cannot use the
	// "maximize while hidden" approach the other platforms use.
	var isWindows = (typeof process !== "undefined" && process.platform === "win32");

	var onWindowOpened = function(thisWindow) {
		thisWindow.window.args = args;
		thisWindow.window.transConfig = configuration;
		thisWindow.window.windowIndex = nw.windowIndex;
		if (Boolean(thatNW.mainWindow) == false) thatNW.mainWindow = thisWindow;

		// The window is created hidden (show:false). Show it only once the
		// document has loaded AND the OS has finished maximizing (when that is
		// wanted). That way neither the default white canvas nor a visible
		// resize animation is ever presented.
		var loaded = false;
		var maximized = !shouldMaximize;
		var revealed = false;
		var reveal = function() {
			if (revealed || !loaded || !maximized) return;
			revealed = true;
			var showIt = function() {
				try { thisWindow.show(); } catch (e) { console.warn("Could not show main window", e); }
				if (shouldMaximize && isWindows) {
					// On Windows the maximize happens after showing (it would
					// otherwise reveal the hidden window). The window was already
					// sized to the work area, so this should not visibly resize.
					try { thisWindow.maximize(); } catch (e) { console.warn("Could not maximize main window", e); }
				}
				try { thisWindow.focus(); } catch (e) {}
			};
			// Wait one painted frame before showing, so the window is never
			// presented as the default white canvas.
			var w = null;
			try { w = thisWindow.window; } catch (e) {}
			if (w && typeof w.requestAnimationFrame === "function") {
				w.requestAnimationFrame(function() { w.requestAnimationFrame(showIt); });
			} else {
				setTimeout(showIt, 30);
			}
		};

		try {
			thisWindow.on("loaded", function() { loaded = true; reveal(); });
		} catch (e) { console.warn("Could not hook window load", e); loaded = true; }

		if (shouldMaximize) {
			if (isWindows) {
				// Do NOT maximize the hidden window on Windows: it reveals the
				// window immediately, showing the white canvas. Instead size it to
				// the work area while hidden, then show and maximize from showIt.
				maximized = true;
				try {
					var scr = thisWindow.window.screen;
					if (scr && scr.availWidth) {
						thisWindow.resizeTo(scr.availWidth, scr.availHeight);
						thisWindow.moveTo(scr.availX || 0, scr.availY || 0);
					}
				} catch (e) { console.warn("Could not size main window to the work area", e); }
			} else {
				// Maximize while still hidden, then reveal from the "maximize"
				// event so the resize happens off-screen.
				try { thisWindow.on("maximize", function() { maximized = true; reveal(); }); } catch (e) {}
				try { thisWindow.maximize(); } catch (e) { console.warn("Could not maximize main window", e); }
				// If the platform never reports the maximize (e.g. it refuses to
				// maximize a hidden window), show it and maximize afterwards so we
				// still end up maximized - accepting a visible resize in that case.
				setTimeout(function() {
					if (revealed) return;
					maximized = true;
					reveal();
					setTimeout(function() { try { thisWindow.maximize(); } catch (e) {} }, 60);
				}, 3000);
			}
		}
		setTimeout(function() { loaded = true; maximized = true; reveal(); }, 15000);

		watchWindowGeometry(thisWindow, configuration);
		// First launch has no saved geometry yet; record the decision so the next
		// launch does not have to guess.
		if (!configuration.windowGeometry) {
			configuration.windowGeometry = { maximized: shouldMaximize };
			saveConfiguration(configuration);
		}
	};

	var transWindow = nw.Window.open('www/trans.html', windowOptions, onWindowOpened);

}

process.on('uncaughtException', function (e) {
	console.error('uncaughtException:', e);
	console.error(e.stack);
});

nw.App.on('open', function(args) {
	openApp(args)	
});
openApp();