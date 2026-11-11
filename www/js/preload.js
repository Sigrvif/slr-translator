var getConfiguration = function () {
	var fs = require("fs");
	var path = require("path");
	var configFile = nw.App.manifest.localConfig.configFile;
	var defaultConf = {
		configPath: nw.App.manifest.localConfig.configFile,
		lastOpenedProject: {},
		historyOpenedProject: {},
		historyOpenedFiles: [],
		// Default active translator engine. This is the LIVE default: it is merged over
		// by an existing data/config.json on load, so it only applies on first launch (or
		// whenever the user has not picked one). DSLR is the primary engine; "slr"
		// (RedSugoi) is legacy. (sys.js Sys._default mirrors this as a fallback.)
		translator: "dslr"
	};
	var config = {};

	if (!fs.existsSync(configFile)) {
		fs.mkdirSync(path.dirname(configFile), { recursive: true });
		fs.writeFileSync(configFile, JSON.stringify(defaultConf));
	} else {
		try {
			config = JSON.parse(fs.readFileSync(configFile));
		} catch (e) {
			console.warn("Unable to parse config file at ", configFile);
		}
	}
	config = Object.assign(defaultConf, config);
	return config;
};

if (window.require) window.transConfig = getConfiguration();
