var php = {
	binPath: nw.App.manifest.localConfig.php || "php/php.exe",
	documentRoot: "www/php"
};

php.run = function (script, args) {
	var escapeShell = function (cmd) {
		return '"' + cmd.replace(/(["\s'$`\\])/g, "\\$1") + '"';
	};

	if (typeof window.exec == "undefined") {
		window.exec = require("child_process").exec;
	}
	script = script || "default.php";

	script = '"' + nwPath.join(nw.process.cwd(), php.documentRoot, script) + '"';
	args = args || {};
	argsStr = btoa(JSON.stringify(args));

	console.log(args);

	exec('"' + nwPath.join(nw.process.cwd(), php.binPath) + '" ' + script + " " + argsStr, function callback(error, stdout, stderr) {
		console.log(this);
		console.log(error);
		console.log(stdout);
	});
};

php.evalResult = function (stdout) {
	var json;
	try {
		json = JSON.parse(stdout);
	} catch (e) {
		json = stdout;
	}
	return json;
};

php.call = function (script, options) {
	options = options || {};
	options.args = options.args || {};
	options.onDone = options.onDone || function (result, e) {};
	options.onError = options.onError || function (result, e) {};

	if (typeof window.exec == "undefined") {
		window.exec = require("child_process").exec;
	}
	script = script || "default.php";

	script = '"' + nwPath.join(nw.process.cwd(), php.documentRoot, script) + '"';
	argsStr = btoa(JSON.stringify(options.args));

	console.log(options.args);

	exec('"' + nwPath.join(nw.process.cwd(), php.binPath) + '" ' + script + " " + argsStr, { maxBuffer: 1024 * 50000 }, function callback(error, stdout, stderr) {
		console.log(this);
		console.log(stdout);
		if (error) {
			options.onError.call(this, stdout, stderr, error);
		}
		options.onDone.call(this, stdout, stderr, error);
	});
};

// Debug: wrap child_process.spawn when debug level is high.
var childProcess = require("child_process");
if (nw.App.manifest.debugLevel > 3) {
	var oldSpawn = childProcess.spawn;
	function mySpawn() {
		console.log("spawn called");
		console.log(arguments);
		var result = oldSpawn.apply(this, arguments);
		return result;
	}
	childProcess.spawn = mySpawn;
}

// Spawn a PHP script asynchronously. Args are written to a temp JSON file and
// passed as [script, tempPath, 'confpath']. Resolves with the parsed (evalResult) stdout.
php.spawn = async function (script, options) {
	options = options || {};
	options.args = options.args || {};
	options.onData = options.onData || function (result, e) {};
	options.onDone = options.onDone || function (result, e) {};
	options.onError = options.onError || function (result, e) {};
	options.scriptPath = options.scriptPath || nwPath.join(nw.process.cwd(), php.documentRoot);
	var resolver;
	var rejecter;
	var thisPromise = new Promise((resolve, reject) => {
		resolver = resolve;
		rejecter = reject;
	});
	const fs = require("graceful-fs");

	if (typeof window.spawn == "undefined") {
		window.spawn = require("child_process").spawn;
	}

	script = nwPath.join(options.scriptPath, script);

	const params = JSON.stringify(options.args);
	const tempPath = nwPath.join(common.getTempDir ? common.getTempDir() : (nw.process.env.TEMP || nw.process.env.TMP || require('os').tmpdir()), `SLR-PHP-${common.generateId()}.json`);
	await fs.promises.writeFile(tempPath, params);

	console.log(options.args);
	var maxOutputBuffer = 64 * 1024 * 1024;
	var outputBuffer = "";

	console.log("Spawning : ", script);
	var child = spawn(nwPath.join(nw.process.cwd(), php.binPath), [script, tempPath, "confpath"]);

	child.stdout.on("data", function (data) {
		if (outputBuffer.length < maxOutputBuffer) {
			outputBuffer += data;
		}
		options.onData.call(this, data);
	});

	child.stderr.on("data", function (data) {
		console.log("stderr: " + data);
		options.onError.call(this, data);
	});

	child.on("close", function (code) {
		console.log("child process exited with code " + code);
		var result = php.evalResult(outputBuffer);
		options.onDone.call(this, result);
		resolver(result);
	});

	return thisPromise;
};

php.spawnSync = function (script, options) {
	options = options || {};
	options.args = options.args || {};
	options.onData = options.onData || function (result, e) {};
	options.onDone = options.onDone || function (result, e) {};
	options.onError = options.onError || function (result, e) {};

	if (typeof window.exec == "undefined") {
		window.exec = require("child_process").exec;
	}
	script = script || "default.php";

	script = nwPath.join(nw.process.cwd(), php.documentRoot, script);
	argsStr = btoa(encodeURIComponent(JSON.stringify(options.args)));

	console.log(options.args);
	var outputBuffer = "";

	if (typeof window.spawnSync == "undefined") {
		window.spawnSync = require("child_process").spawnSync;
	}

	console.log("Spawning : ", script);
	var child = spawnSync(nwPath.join(nw.process.cwd(), php.binPath), [script, argsStr, "url"]);

	var output = child.stdout.toString();

	options.onData.call(this, output);
	options.onError.call(this, child.stderr);
	child.result = php.evalResult(output);
	options.onDone.call(this, child.result);

	return child;
};

php.test = function ($script) {
	php.spawn($script, {
		onDone: function (result) { console.log(result); },
		onError: function (result) { console.warn(result); }
	});
};

php.checkPathSync = function ($path) {
	var result = this.spawnSync("checkPath.php", {
		args: { "path": $path }
	});
	return result.result;
};

php.copyTreeSync = function (from, to) {
	var result = this.spawnSync("copytree.php", {
		args: { "from": from, "to": to }
	});
	return result.result;
};

php.copyTree = function (from, to, options) {
	options = options || {};
	options.onData = options.onData || function () {};
	options.onDone = options.onDone || function () {};
	var that = this;

	setTimeout(function () {
		that.spawn("copytree.php", {
			args: { "from": from, "to": to },
			onData: options.onData,
			onDone: options.onDone
		});
	}, 10);
};

php.getVersion = async function () {
	var version;
	try {
		version = await php.spawn("version.php");
		return version?.version;
	} catch (e) {
		return false;
	}
};
