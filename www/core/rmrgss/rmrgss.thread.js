var {
	Worker,
	isMainThread,
	parentPort,
	workerData
} = require("worker_threads");
var common = require("www/js/common.js");

var {
	YAML,
	GameIniParser,
	RGSSParser,
	RMData,
	attachments,
	YAMLUtil,
	isYamlVer2
} = require("www/core/rmrgss/rmrgss.module.js");

var fs = require('graceful-fs');
var iconv = require('iconv-lite');
const Logger = require('www/js/Logger.js');
var logger = new Logger();
logger.loadState(true);
var errors = [];

console.log("rmrgss.thread loaded");

var prismJs = require('@rmrgss/prismjs');
require('@rmrgss/prismjs/components/prism-ruby');

var processMapData = async function (yamlList, rmDataProperties, baseContext) {
	var rmData = new RMData();
	for (var i in rmDataProperties) {
		rmData[i] = rmDataProperties[i];
	}

	var commands = YAML.parseDocument(yamlList);

	var newCommands = await rmData.fetchCommandList(commands.contents, baseContext);

	// replace original contents with new one
	// if translation table is empty, do not send back the translatedCommands,
	// because commands.toString() is a resource expensive task
	var translatedCommands = "";
	if (!empty(rmData.translationPair)) {
		commands.contents = newCommands;
		translatedCommands = commands.toString();
	}

	return {
		translatedCommands: translatedCommands,
		translatableTexts: rmData.translatableTexts,
		transData: rmData.transData,
	};
};

void async function () {
	var result = {};
	try {
		if (workerData?.command == "parseEventList") {
			result = await processMapData(workerData.yamlList, workerData.rmDataProperties, workerData.baseContext);
		}
	} catch (e) {
		errors.push(e.stack);
	}

	// sending message to parent
	if (!isMainThread) {
		parentPort.postMessage({
			randomId: common.generateId(),
			logs: logger.getOutput(),
			filePath: __filename,
			errors: errors,
			result: result
		});
	}
}();
