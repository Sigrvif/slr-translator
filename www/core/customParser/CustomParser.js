require("regexp-match-indices/auto");


class CustomParser extends require('www/js/ParserBase.js').ParserBase {
	constructor(script, options, callback) {
		super(script, options, callback)
		this.modelStr   = options.modelStr || {};
		this.model      = options.model || {};
        //this.debugLevel = this.options.debugLevel || common.debugLevel();
        this.debugLevel = 0
        this.parsedData = [];
		this.transData  = {
			data:[],
			context:[],
			tags:[],
			parameters:[],
			indexIds:{}
		};
        this.isTranslationJson = false;
        this.translationJsonData = null;
        this.isCsv = false;
        this.csvData = null;
        this.$elm = $("<div></div>");

	}
}
CustomParser.prototype.on = function(evt, fn) {
    this.$elm.on(evt, fn)
}
CustomParser.prototype.off = function(evt, fn) {
    this.$elm.off(evt, fn)
}
CustomParser.prototype.one = function(evt, fn) {
    this.$elm.one(evt, fn)
}
CustomParser.prototype.trigger = function(evt, param) {
    this.$elm.trigger(evt, param)
}
CustomParser.prototype.setModel = function(model) {
    this.model = model || {};
    return this.model;
}
CustomParser.prototype.getModel = function() {
    return this.model;
}
CustomParser.prototype.parseCaptureGroup = function(str) {
    if (Array.isArray(str)) return str;
    if (typeof str !== "string") return [0];
    var result = [];

    str = str.replace(/\s+/g, '').split(",");
    for (var i in str) {
        result.push(parseInt(str[i]));
    }
    return result;
}
CustomParser.prototype.parse = async function() {
    console.log("Parsing with model", this.model);

    if (empty(this.model)) return console.warn("Model is not defined");

    if (empty(this.model.rules)) {
        if (CustomParser.looksLikeCsv(this.script)) {
            this.parseCsv();
            return;
        }
        return console.warn("model.rules is not defined");
    }
    var theString       = this.script;
    
    var mask = (string, start, end, maskChar = " ") => {
        var prev = string.substring(0, start);
        var after = string.substring(end, string.length);
        var mask = maskChar.repeat(string.substring(start, end).length);
        return prev+mask+after;
    }

    var evalRegex = (string) => {
        if (string.constructor.name == "RegExp") return string;
        return common.evalRegExpStr(string);
    }

    var evalAsyncFunction = (string) => {
        if (typeof string == "function") return string;
        try {
            let AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
            return new AsyncFunction("text", "thisModel", string);
            //return new Function("text", "thisModel", string);
        } catch (e) {
            console.warn(e);
            return function() {};
        }
    }

    var isValidOffsetPair = (obj) => {
        try {
            if ("start" in obj && "end" in obj) return true;
        } catch (e) {
            return false;
        }
        return false;
    }

    var processHooks = async () => {
        if (!this.model) return;
        if (!empty(this.model.toGrid)) {
            if (typeof this.model.toGrid == "function") this.filterText = this.model.toGrid;
            try {
                var filterText = new Function('text', 'context', 'parameters', this.model.toGrid);
                this.filterText = filterText;
            } catch (e) {
                // do nothing
            }
        }
        if (!empty(this.model.fromGrid)) {
            if (typeof this.model.fromGrid == "function") this.unfilterText = this.model.fromGrid;
            try {
                var unfilterText = new Function('text', 'context', 'parameters', 'info', this.model.fromGrid);
                this.unfilterText = unfilterText;
            } catch (e) {
                // do nothing
            }
            
        }
    }
    
    /**
     * Process the rule
     * @param  {} thisRule
     * @param  {} initialOffset
     */
    var processRule = async (thisRule, initialOffset) => {
        initialOffset = initialOffset || 0;
        // var maxIteration = 999;
        console.log("fetchingRules", thisRule);
        if (thisRule.type == "regex") {
            if (!thisRule.pattern) return;
            var thisPattern = evalRegex(thisRule.pattern);
            console.log("pattern evaluated", thisPattern);
            var captureGroups = this.parseCaptureGroup(thisRule.captureGroups) || [0];
            if (Array.isArray(captureGroups) == false) captureGroups = [captureGroups];
            if (this.debugLevel) console.log("Capture groups:", captureGroups);
            // var iteration=0;
            var lastOffsetPair = "";
            var matchAllResult = theString.matchAll(thisPattern);
            // javascript exec can lock us in infinite loop when encouter a blank match
            //while((matches=thisPattern.exec(theString)) != null) {
            for (var matches of matchAllResult) {    
                if (this.debugLevel) console.log("Matches", matches);
                // iterate through all selected groups
                for (var x=0; x<captureGroups.length; x++) {
                    //console.log("Handling capture index", captureGroups[x]);
                    var captureIndex    = parseInt(captureGroups[x] || 0); // default is index 0
                    if (!matches.indices[captureIndex]) continue;
                    var offsetStart     = initialOffset + matches.indices[captureIndex][0]
                    var offsetEnd       = initialOffset + matches.indices[captureIndex][1]
                    if (this.debugLevel) console.log("offsetStart", offsetStart, "offsetEnd", offsetEnd);
                    if (!empty(thisRule.innerRule)) {
                        // instead of pushing the result, process inner pattern
                        await processRule(thisRule.innerRule, offsetStart);
                    } else if (thisRule.action == "mask") {
                        theString = mask(theString, offsetStart, offsetEnd);
                    } else if (thisRule.action == "captureMask") {
                        this.parsedData.push({
                            translation     : this.registerString(matches[captureIndex], ["start", offsetStart, "end", offsetEnd], {start:offsetStart, end:offsetEnd}),
                            start           : offsetStart,
                            end             : offsetEnd
                        });
                        theString = mask(theString, offsetStart, offsetEnd);
                    } else {
                        this.parsedData.push({
                            translation     : this.registerString(matches[captureIndex], ["start", offsetStart, "end", offsetEnd], {start:offsetStart, end:offsetEnd}),
                            start           : offsetStart,
                            end             : offsetEnd
                        });
                    }

                    var currentOffsetPair = offsetStart+","+offsetEnd
                    if (lastOffsetPair == currentOffsetPair) {
                        // circular reference
                        console.warn(`Last offset ${lastOffsetPair} is same with the current offset ${currentOffsetPair}. To prevent circular refference the parser will mask the ofset character`);
                        
                        theString = mask(theString, offsetStart-1, offsetEnd+1);
                    }
                    lastOffsetPair = currentOffsetPair;

                }
                /*
                iteration++;
                if (iteration > maxIteration) {
                    console.error(`Process halted! Iteration surpassed maximum allowed iteration. ${maxIteration}`);
                    break;
                }
                */
            }
        } else if (thisRule.type == "function") {
            if (!thisRule.function) return;
            var thisFunction = evalAsyncFunction(thisRule.function);
            console.log("calling function");
            var result = await thisFunction.call(this, theString, thisRule);
            console.log("result of the execution:", result);
            if (empty(result)) return;
            if (Array.isArray(result) == false) result = [result];
            for (var r in result) {
                var offsetPair = result[r];
                if (!isValidOffsetPair(offsetPair)) return;
                this.parsedData.push({
                    translation     : this.registerString(theString.substring(offsetPair.start, offsetPair.end), ["start", offsetPair.start, "end", offsetPair.end], {start:offsetPair.start, end:offsetPair.end}),
                    start           : offsetPair.start,
                    end             : offsetPair.end
                });
            }
        } else if (thisRule.type == "translationJson") {
            this.parseTranslationJson();
        }
    }
   
    await processHooks();
    for (var i in this.model.rules) {
        await processRule(this.model.rules[i], 0);
    }

    if (this.debugLevel) console.log("String after parsed:");
    if (this.debugLevel) console.log(theString);
}

CustomParser.csvOriginalPatterns = [
    /^original\s*text$/i, /^original$/i, /^source\s*text$/i, /^source$/i,
    /^japanese$/i, /^日本語$/i, /^原文$/i,
];
CustomParser.csvTranslatedPatterns = [
    /^translated\s*text$/i, /^translated$/i, /^translation$/i,
    /^english$/i, /^英語$/i, /^翻訳$/i, /^訳文$/i,
];

CustomParser.looksLikeCsv = function(text) {
    if (typeof text !== "string" || text.trim().length === 0) return false;
    var firstLine = text.split(/\r?\n/, 1)[0];
    if (!firstLine || firstLine.indexOf(",") === -1) return false;
    var headers = CustomParser.parseCsvLine(firstLine);
    if (headers.length < 2) return false;
    var hasOriginal = headers.some(function(h) {
        return CustomParser.csvOriginalPatterns.some(function(p) { return p.test(h); });
    });
    var hasTranslated = headers.some(function(h) {
        return CustomParser.csvTranslatedPatterns.some(function(p) { return p.test(h); });
    });
    return hasOriginal || hasTranslated;
};

CustomParser.prototype.detectCsvColumns = function(headers) {
    var origIdx = -1, transIdx = -1;
    for (var i = 0; i < headers.length; i++) {
        var h = headers[i].trim();
        if (origIdx === -1 && CustomParser.csvOriginalPatterns.some(function(p) { return p.test(h); })) {
            origIdx = i;
        }
        if (transIdx === -1 && CustomParser.csvTranslatedPatterns.some(function(p) { return p.test(h); })) {
            transIdx = i;
        }
    }
    if (origIdx === -1) {
        for (var i = 0; i < headers.length; i++) {
            if (i === transIdx) continue;
            origIdx = i;
            break;
        }
    }
    if (transIdx === -1) transIdx = headers.length;
    return { origIdx: origIdx, transIdx: transIdx };
};

CustomParser.parseCsvLine = function(line) {
    var result = [];
    var current = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current);
                current = "";
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
};

CustomParser.escapeCsvField = function(field) {
    if (field.indexOf(',') !== -1 || field.indexOf('"') !== -1 || field.indexOf('\n') !== -1 || field.indexOf('\r') !== -1) {
        return '"' + field.replace(/"/g, '""') + '"';
    }
    return field;
};

CustomParser.prototype.parseCsv = function() {
    var lines = this.script.split(/\r?\n/);
    if (lines.length < 2) return;

    var headers = CustomParser.parseCsvLine(lines[0]);
    var cols = this.detectCsvColumns(headers);

    this.isCsv = true;
    this.csvData = { headers: headers, origIdx: cols.origIdx, transIdx: cols.transIdx, rows: [] };

    for (var i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "") continue;
        var fields = CustomParser.parseCsvLine(lines[i]);
        var originalText = fields[cols.origIdx] || "";
        if (originalText.trim() === "") continue;

        var contextParts = [];
        for (var c = 0; c < headers.length; c++) {
            if (c === cols.origIdx || c === cols.transIdx) continue;
            if (fields[c]) contextParts.push(headers[c] + ": " + fields[c]);
        }

        var translation = this.registerString(
            originalText,
            contextParts,
            { row: i },
            {}
        );

        this.csvData.rows.push({
            fields: fields,
            translation: translation !== originalText ? translation : null,
            origIdx: cols.origIdx,
            transIdx: cols.transIdx
        });
    }
};

CustomParser.prototype.getTranslationJsonTags = function(entry) {
    if (entry.type === "plain_text") return [];
    if (entry.type === "strsp_label") return ["yellow"];
    if (entry.type === "menu_label") return ["yellow"];
    if (entry.type === "mov_string") {
        var orig = entry.original || "";
        var ctx = entry.context || "";

        if (orig.replace(/[\s　]/g, "").length === 0) return ["red"];
        if (orig.indexOf("ＣＨＥＣＫＥＤ") >= 0) return ["red"];

        var searchStr = '"' + orig + '"';
        var lastIdx = ctx.lastIndexOf(searchStr);
        if (lastIdx >= 0) {
            var afterStr = ctx.substring(lastIdx + searchStr.length);
            if (/^\s*\+/.test(afterStr)) return ["red"];
        }

        return ["yellow"];
    }
    return ["red"];
}

CustomParser.prototype.parseTranslationJson = function() {
    var entries;
    try {
        entries = JSON.parse(this.script);
    } catch (e) {
        console.warn("Failed to parse as translation.json:", e);
        return;
    }
    if (!Array.isArray(entries)) {
        console.warn("translation.json: expected JSON array");
        return;
    }

    this.isTranslationJson = true;
    this.translationJsonData = entries;

    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (empty(entry.original)) continue;

        var localContext = [entry.type || "", entry.context || ""];
        var tags = this.getTranslationJsonTags(entry);

        var translation = this.registerString(
            entry.original,
            localContext,
            {id: entry.id, line: entry.line},
            {tags: tags}
        );

        if (translation !== entry.original) {
            entry.translation = translation;
        }
    }
}

CustomParser.prototype.toString = function() {
    if (this.isCsv && this.csvData) {
        var lines = [];
        lines.push(this.csvData.headers.map(CustomParser.escapeCsvField).join(","));
        for (var r = 0; r < this.csvData.rows.length; r++) {
            var row = this.csvData.rows[r];
            var fields = row.fields.slice();
            if (row.translation != null) {
                fields[row.transIdx] = row.translation;
            }
            lines.push(fields.map(CustomParser.escapeCsvField).join(","));
        }
        return lines.join("\n");
    }

    if (this.isTranslationJson && this.translationJsonData) {
        return JSON.stringify(this.translationJsonData, null, 2);
    }

    if (empty(this.parsedData)) return this.script;

    var replaceOffset = function(string, start, end, replacement) {
        replacement = replacement || ""
        var before = string.substring(0, start);
        var after  = string.substring(end, string.length);
        return before+replacement+after;
    }

    var thisScript = this.script;
    this.writableData = this.writableData || [];

    for (var i=0; i<this.parsedData.length; i++) {
        if (!this.writableData[i]) continue;
        this.parsedData[i].translation = this.writableData[i];
    }

    // IMPORTANT! sort by start offset DESC
    this.parsedData.sort((a,b) => {return b.start - a.start});

    for (let i=0; i<this.parsedData.length; i++) {
        thisScript = replaceOffset(thisScript, this.parsedData[i].start, this.parsedData[i].end, this.parsedData[i].translation);
    }

    return thisScript;
}

CustomParser.isValidModel = function(model) {
    if (typeof model == "string") {
        if (!common.isJSON(model)) return false;
        model = JSON.parse(model);
    }
    if (!model) return false;
    if (!model.files) return false;
    if (Array.isArray(model.files) == false ) return false;
    return true;
}



module.exports = CustomParser