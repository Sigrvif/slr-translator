var nwPath = require('path');
var fs = require('graceful-fs');
var fse = require('fs-extra');

var walk = async function(dir, options) {
    options = options || {};
    options.onFile = options.onFile || function() {};
    options.onDir = options.onDir || function() {};
    var results = [];
    var entries = fs.readdirSync(dir);
    for (var i = 0; i < entries.length; i++) {
        var filepath = nwPath.join(dir, entries[i]);
        var stats = fs.statSync(filepath);
        if (stats.isDirectory()) {
            options.onDir(filepath, stats);
            var sub = await walk(filepath, options);
            results = results.concat(sub);
        } else if (stats.isFile()) {
            options.onFile(filepath, stats);
            results.push(filepath);
        }
    }
    return results;
}

var copySingleFile = async function(src, dest, options) {
    if (options.overwrite === false) {
        try {
            if (fs.existsSync(dest)) return false;
        } catch (e) {}
    }
    fs.mkdirSync(nwPath.dirname(dest), { recursive: true });

    if (typeof options.onBeforeCopy === 'function') {
        await options.onBeforeCopy(src, dest);
    }

    await fse.copy(src, dest, { overwrite: true });

    if (typeof options.onAfterCopy === 'function') {
        await options.onAfterCopy(src, dest);
    }
    return true;
}

var copyDir = async function(src, dest, options) {
    dest = nwPath.normalize(dest);
    var files = await walk(src);
    var resultPairs = {};
    for (var i = 0; i < files.length; i++) {
        var sourceFile = files[i];
        var targetFile = nwPath.join(dest, sourceFile.substring(src.length));
        if (typeof options.filter === 'function') {
            if (!Boolean(await options.filter(sourceFile, targetFile))) continue;
        }
        var copied = await copySingleFile(sourceFile, targetFile, options);
        if (copied) {
            resultPairs[sourceFile] = resultPairs[sourceFile] || [];
            resultPairs[sourceFile].push(targetFile);
        }
    }
    return resultPairs;
}

var copy = async function(origins, targets, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    options = options || {};
    options.overwrite = options.overwrite || false;
    callback = callback || function() {};

    if (!Array.isArray(origins)) origins = [origins];
    if (!Array.isArray(targets)) targets = [targets];

    var RESULTS = {};
    for (var i = 0; i < origins.length; i++) {
        for (var x = 0; x < targets.length; x++) {
            var src = origins[i];
            var dest = targets[x];
            var srcStats;
            try {
                srcStats = fs.statSync(src);
            } catch (e) {
                continue;
            }

            if (srcStats.isDirectory()) {
                var dirResult = await copyDir(src, dest, options);
                if (dirResult) {
                    for (var k in dirResult) {
                        RESULTS[k] = RESULTS[k] || [];
                        RESULTS[k] = RESULTS[k].concat(dirResult[k]);
                    }
                }
            } else {
                if (typeof options.filter === 'function') {
                    if (!Boolean(await options.filter(src, dest))) continue;
                }
                try {
                    var destStats = fs.statSync(dest);
                    if (destStats.isDirectory()) {
                        dest = nwPath.join(dest, nwPath.basename(src));
                    }
                } catch (e) {}

                var copied = await copySingleFile(src, dest, options);
                if (copied) {
                    RESULTS[src] = RESULTS[src] || [];
                    RESULTS[src].push(dest);
                }
            }
        }
    }

    callback.call(null, RESULTS);
    return RESULTS;
}

copy.walk = walk;
copy.copy = copy;

module.exports = copy;
