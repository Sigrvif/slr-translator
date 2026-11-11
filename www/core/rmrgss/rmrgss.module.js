var ini 		= require('ini')
var nwPath      = require("path");
var moduleAlias = require('module-alias');

try {
	window.transConfig = JSON.parse(localStorage.getItem('Config'));
} catch (e){
	console.log(e);
}

const thisPath = nwPath.dirname(__filename);

moduleAlias.addAliases({
    '@rmrgss': thisPath + "/node_modules"
  })
moduleAlias.addPath(thisPath+'/node_modules');
moduleAlias(thisPath+'/package.json');

var YAML = require('@rmrgss/yaml');
var isYamlVer2 = false;
var YAMLUtil;
if (common.isFile("www/core/rmrgss/node_modules/yaml/dist/resolveSeq-d03cb037.js")) {
	YAMLUtil = require('www/core/rmrgss/node_modules/yaml/dist/resolveSeq-d03cb037.js');
} else {
	YAMLUtil = require('@rmrgss/yaml/util');
	isYamlVer2 = true;
}


var attachments = {};

function b64EncodeUnicode(str) {
	// first we use encodeURIComponent to get percent-encoded UTF-8,
	// then we convert the percent encodings into raw bytes which
	// can be fed into btoa.
	// b64EncodeUnicode('✓ à la mode'); // "4pyTIMOgIGxhIG1vZGU="
	return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
		function toSolidBytes(match, p1) {
			return String.fromCharCode('0x' + p1);
	}));
}
function b64DecodeUnicode(str) {
	// Going backwards: from bytestream, to percent-encoding, to original string.
	// b64DecodeUnicode('4pyTIMOgIGxhIG1vZGU='); // "✓ à la mode"
	return decodeURIComponent(atob(str).split('').map(function(c) {
		return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
	}).join(''));
}

// Declaring parser for custom tag

var customTags = []
if (isYamlVer2) {
	customTags.push({
		identify: value => value instanceof Uint8Array,
		// Buffer inherits from Uint8Array
		default: false,
		tag: '!binary',
		
		resolve: (doc, node) => {
			//const src = YAMLUtil.resolveString(doc, node);
			return b64DecodeUnicode(doc);
		},
		options: YAMLUtil.binaryOptions,
		stringify: function (data, ctx, onComment, onChompKeep) {
			// convert to plain
			//console.log(arguments);
			data.value = b64EncodeUnicode(data.value);
			//type = "PLAIN"
			return YAMLUtil.stringifyString(data, ctx, onComment, onChompKeep);
		}
	})
} else {
	// use legacy
	customTags.push({
		identify: value => value instanceof Uint8Array,
		// Buffer inherits from Uint8Array
		default: false,
		tag: '!binary',

		resolve: (doc, node) => {
			console.log("----Binary mode");
			const src = YAMLUtil.resolveString(doc, node);
			const result = b64DecodeUnicode(src);
			console.log("----Resolving", src, "result:", result);
	
			return result;
		},
		options: YAMLUtil.binaryOptions,
		stringify: function (data, ctx, onComment, onChompKeep) {
			// convert to plain
			//console.log(arguments);
			data.value = b64EncodeUnicode(data.value);
			//type = "PLAIN"
			return YAMLUtil.stringifyString(data, ctx, onComment, onChompKeep);
		}
	})
}



/**
 * Create a new document based on a node
 * @param {*} path 
 * @returns 
 */
YAML.Document.prototype.newDocumentIn = function(path) {
	var newDocument = new this.constructor();
	var content = this.getIn(path);
	newDocument.contents 	= content;
	newDocument.anchors.map 	= {...newDocument.anchors.map, ...this.anchors.map};
	return newDocument;
}

YAML.Document.prototype.toStringIn = function(path) {
	return this.newDocumentIn(path).toString();
}

YAML.Document.prototype.setDocumentIn = function(path, newDocument) {
	this.setIn(path, newDocument.contents);
	this.anchors.map 	= {...this.anchors.map, ...newDocument.anchors.map};
	return this;
}

/**
 * Fetch data from any iterable objects, Sequence (Array), or Map (Hash)
 * @param  {} data
 * @param  {} index
 */
if (isYamlVer2) {
	YAML.getFromIndex = function(data, index) {
		//console.log("YAML.getFromIndex", data, index);
		if (empty(data)) return data;
		if (data.constructor.name !== "YAMLMap" && data.constructor.name !== "YAMLSeq") return console.warn("Trying to get index from an invalid iteratable object.")
		if (typeof index !== "number") return console.warn("Invalid number", index);
	
		if (this.isSeq(data)) {// MAP : hash, SEQ : array
			// array
			//console.log("data is array", data);
			return data.items[index];
		} else {
			// hash
			//console.log("data is hash", data);
			return data.items[index].value;
		}
	}
} else {
	YAML.getFromIndex = function(data, index) {
		if (empty(data)) return data;
		if (data.constructor.name !== "YAMLMap" && data.constructor.name !== "YAMLSeq") return console.warn("Trying to get index from an invalid iteratable object.")
		if (typeof index !== "number") return console.warn("Invalid number", index);
	
		if (data.type == "SEQ") {// MAP : hash, SEQ : array
			// array
			return data.items[index];
		} else {
			// hash
			return data.items[index].value;
		}
	}
}

/**
 * Generate YAML document from any point of another YAML document
 * @param {YAMLSeq|YAMLMap} mapData - Portion of the data retrieved by yaml.getIn();
 * @returns 
 */
YAML.createDocumentFrom = function(mapData) {
    var newDoc = this.parseDocument("");
    newDoc.contents = mapData;
    return newDoc;
}



class GameIniParser extends require('www/js/ParserBase.js').ParserBase {
	constructor(script, options, callback) {
		super(script, options, callback)
		this.debugLevel = options.debugLevel;
		this.transData = {
			data:[],
			context:[],
			tags:[],
			parameters:[],
			indexIds:{}
		};

	}
}
GameIniParser.prototype.registerStringObject = function(obj, key, parameters, options) {
	var translation = this.registerString(obj[key], parameters, options);
	// apply translation
	obj[key] = translation;
	return translation;
}

GameIniParser.prototype.filterText = function(text, context, parameters) {
	return ini.unsafe(text);
}

GameIniParser.prototype.unfilterText = function(text, context, parameters) {
    return ini.safe(text);
}

GameIniParser.prototype.toString = function() {
    var win = nw.Window.get();
    nw.appSuffix = nw.appSuffix||"";
	var suffix = "";
	if (nw.appSuffix) {
		suffix = " "+nw.appSuffix;
	}
    let slrversion = nw.App.manifest.version+suffix;
	addversionnumber = `; This file was generated using SLR Translator\n; v` + slrversion + `\n` + ini.stringify(this.ini);
	return addversionnumber;
}

GameIniParser.prototype.parse = async function() {
	this.ini = ini.parse(this.script);

	if (empty(this.ini)) return this;
	for (var category in this.ini) {
		if (typeof this.ini[category] !== "object") continue;
		for (var varName in this.ini[category]) {
			var tags=["red"];
			if (category.toLowerCase()=="game" && varName.toLowerCase()=="title") {
				tags=[];
				this.gameTitle = this.ini[category][varName];
				console.log("Game title:", this.gameTitle);
			}
			this.registerStringObject(this.ini[category], varName, ["Game.ini", category, varName], {}, {tags:tags})
		}
	}
	return this;
}



if (typeof Prism == "undefined") {
    require('@rmrgss/prismjs');
    require('@rmrgss/prismjs/components/prism-ruby');
}

class RGSSParser extends require('www/js/ScriptParser.js') {
	constructor(script, options, callback) {
		super(script, options, callback)
		options ||= {}
		this.language = "rgss";
		this.debugLevel = options.debugLevel;
		this.currentEntryPoint = {};
		this.transData = {
			data:[],
			context:[],
			tags:[],
			parameters:[],
			indexIds:{}
		};

		this.init();
	}
}

RGSSParser.extendPrism = function () {
	if (Prism.languages.rgss) return;
	Prism.languages.rgss = Prism.languages.extend('ruby')
	var interpolation = {
		pattern: /#\{[^}]+\}/,
		inside: {
			'delimiter': {
				pattern: /^#\{|\}$/,
				alias: 'tag'
			},
			rest: Prism.languages.ruby
		}
	};

	var thisTokenRule;
	if (Prism.languages.rgss["string-literal"]) {
		thisTokenRule = Prism.languages.rgss["string-literal"];
	} else {
		thisTokenRule = Prism.languages.rgss.string;
	}

	thisTokenRule.push(
		{
			pattern: /<<[-~]?([a-z_]\w*)(.*)[\r\n](?:.*[\r\n])*?[\t ]*\1/i,
			alias: 'heredoc-string',
			greedy: true,
			inside: {
				'delimiter': {
					pattern: /^<<[-~]?[a-z_]\w*(.*)[\r\n]|[a-z_]\w*$/i,
					alias: 'symbol',
					inside: {
						'punctuation': /^<<[-~]?/
					}
				},
				'interpolation': interpolation
			}
		}	
	)
	
	thisTokenRule[0].alias = 'string-misc';
	thisTokenRule[0].pattern = /(?<![-+])%[qQiIwWxs]?(?:([^a-zA-Z0-9\s{(\=[<])(?:(?!\1)[^\\]|\\[\s\S])*\1|\((?:[^()\\]|\\[\s\S])*\)|\{(?:[^#{}\\]|#(?:\{[^}]+\})?|\\[\s\S])*\}|\[(?:[^\[\]\\]|\\[\s\S])*\]|<(?:[^<>\\]|\\[\s\S])*>)/;
	thisTokenRule[1].alias = 'string-quote';
	thisTokenRule[1].pattern = /("|')(?:#\{[^}]+\}|#(?!\{)|\\(?:\r\n|[\s\S])|(?!\1)[^\\#])*\1/
	thisTokenRule[2].inside.delimiter.pattern = /^<<[-~]?[a-z_]\w*[\r\n]|[a-z_]\w*$/i
	thisTokenRule[3].inside.delimiter.pattern = /^<<[-~]?'[a-z_]\w*'[\r\n]|[a-z_]\w*$/i
	//Prism.languages.rgss.string[2].inside.punctuation = /[\r\n]/
	//Prism.languages.rgss.string[3].inside.punctuation = /[\r\n]/
}

RGSSParser.prototype.filterText = function(text, context, parameters) {
	if (parameters.parentAlias == "string-quote") {
		// strip slashes from quote
		text = common.stripSlashes(text);
	} else if (parameters.parentAlias == "string-misc") {
		var bkEscaper = '[----backslashEscape:'+common.rand(10000000,99999999)+":----]"
		text = text.replaceAll('\\\\', bkEscaper)
		.replaceAll('\\}', '}')
		.replaceAll('\\)', ')')
		.replaceAll('\\/', '/')
		.replaceAll('\\]', ']')
		.replaceAll('\\>', '>')
		.replaceAll('\\n', "\n")
		.replaceAll('\\r', "\r")
		.replaceAll(bkEscaper, '\\')
	}
	
	return text;
}

RGSSParser.prototype.unfilterText = function(text, context, parameters) {
	if (parameters.parentAlias == "string-quote") {
		// add slashes to quote
		text = common.addSlashes(text);
	} else if (parameters.parentAlias == "string-misc") {
		text = text.replace(/[\\/})\]>]/g, function(match) {
			return "\\"+match;
		})
	}
    return text;
}

RGSSParser.prototype.init = function() {
	RGSSParser.extendPrism();
	this.on('beforeRegisterString', (args)=>{
		var token 		= args[0];
		var parentType 	= args[1]
		var options 	= args[2]

		var parentAlias = ""
		try {
			parentAlias = options.parent.alias;
		} catch (e) {
			console.warn(e);
		}

		if (parentAlias == "string-quote") {
			var _src = this.script || "";
			var _bp = this.currentOffset - 1;
			while (_bp >= 0 && /\s/.test(_src.charAt(_bp))) _bp--;
			if (_bp >= 0 && _src.charAt(_bp) == "[") {
				this.register(token);
				this.currentOffset += token.length;
				return common.thru();
			}
			//console.log("handling string quote", args);
			var quote = ['"', "'"]
			if (options.index == 0) {
				// first index
				if (quote.includes(token.charAt(0))) {
					this.register(token.charAt(0));
					token = token.substring(1);
					this.currentOffset += 1;
				}
			}

			if (options.index == (options.siblingNumber -1)) {
				// last index
				var closingQuote = token.substring(token.length-1);
				if (quote.includes(closingQuote)) {
					token = token.substring(0, token.length -1);
					//this.registerString(token, this.baseContext.concat([this.currentOffset]), {parentType:"string-quote", start:this.currentOffset, end:this.currentOffset+token.length});
					this.registerString(token, this.baseContext.concat([this.currentOffset]), {parentType:"string-quote", start:this.getCurrentOffset(), end:this.getCurrentOffset()+token.length});
					this.currentOffset += token.length;
					
					// register closing quote
					this.register(closingQuote);
					this.currentOffset += closingQuote.length;
					return common.thru(); // skip default behavior
				}
			} else {
				this.registerString(token, this.baseContext.concat([this.currentOffset]), {parentType:"string-quote", start:this.getCurrentOffset(), end:this.getCurrentOffset()+token.length});
				this.currentOffset += token.length;
				return common.thru(); // skip default behavior
			}
		} else if (parentAlias == "heredoc-string") {
			//console.log("handling heredoc string", args);
			if (options.index == 1) { // first after delimiter
				var firstChar = token.charAt(0);

				try {
					var delimiter = options.members[0].content[1]
					if (delimiter.substring(0, delimiter.length - 1) == "\n") return;
				} catch (e) {
					console.warn(e);
					return;
				}

				if (token.substring(0,2) == "\r\n" || token.substring(0,2) == "\n\r") {
					this.register("\r\n");
					this.currentOffset += 2;

					token = token.substring(2);
					this.registerString(token, this.baseContext.concat([this.currentOffset]), {parentType:"heredoc-string", start:this.getCurrentOffset(), end:this.getCurrentOffset()+token.length});
					this.currentOffset += token.length;
					return common.thru(); // skip default behavior

				} else if (firstChar == "\n") {
					this.register(firstChar);
					this.currentOffset += 1;

					token = token.substring(1);
					this.registerString(token, this.baseContext.concat([this.currentOffset]), {parentType:"heredoc-string", start:this.getCurrentOffset(), end:this.getCurrentOffset()+token.length});
					this.currentOffset += token.length;
					return common.thru(); // skip default behavior

				}

			}
		} else if (parentAlias == "string-misc") {
			//console.log("handling string-misc", args);
			if (options.index == 0) {
				var match = token.match(/%[qQiIwWxs]?[/{(\[<]?/);
				if (match) {
					if (match.index == 0) {
						this.register(match[0]);
						token = token.substring(match[0].length);
						this.currentOffset += match[0].length;
					}
				}
			}
			
			if (options.index == (options.siblingNumber -1)) {
				let quote = ["/", "}", ")", ">", "]"];
				let closingQuote = token.substring(token.length-1);
				if (quote.includes(closingQuote)) {
					token = token.substring(0, token.length -1);
					this.registerString(token, this.baseContext.concat([this.currentOffset]), {parentType:"string-misc", start:this.getCurrentOffset(), end:this.getCurrentOffset()+token.length});
					this.currentOffset += token.length;
					
					// register closing quote
					this.register(closingQuote);
					this.currentOffset += closingQuote.length;
					return common.thru(); // skip default behavior
				}
			} else {
				this.registerString(token, this.baseContext.concat([this.currentOffset]), {parentType:"string-misc", start:this.getCurrentOffset(), end:this.getCurrentOffset()+token.length});
				this.currentOffset += token.length;
				return common.thru(); // skip default behavior
			}
		}
		

	});

	this.on('afterRegisterString', (args)=>{
		
	})	
}



class RMData extends require("www/js/ParserBase.js").ParserBase {
	constructor(obj, options, callback) {
		super(obj, options, callback)
		options ||= {}
		this.debugLevel = options.debugLevel;
		this.currentEntryPoint = {};
		this.transData = {
			data:[],
			context:[],
			tags:[],
			parameters:[],
			indexIds:{}
		};
	}
}
RMData.RPGM_EVENT_CODE = {
	"0": "Empty",
	"101": "Show Text Attributes",
	"102": "Show Choices",
	"103": "Input Number",
	"104": "Select Key Item",
	"105": "Show Scrolling Text Attributes",
	"108": "Comment",
	"111": "Conditional Branch",
	"112": "Loop",
	"113": "Break Loop",
	"115": "Exit Event Processing",
	"117": "Call Common Event",
	"118": "Label",
	"119": "Jump to Label",
	"121": "Control Switches",
	"122": "Control Variables",
	"123": "Control Self Switch",
	"124": "Control Timer",
	"125": "Change Gold",
	"126": "Change Items",
	"127": "Change Weapons",
	"128": "Change Armor",
	"129": "Change Party Member",
	"132": "Change Battle BGM",
	"133": "Change Battle End ME",
	"134": "Change Save Access",
	"135": "Change Menu Access",
	"136": "Change Encounter",
	"137": "Change Formation Access",
	"138": "Change Window Color",
	"201": "Transfer Player",
	"202": "Set Vehicle Location",
	"203": "Set Event Location",
	"204": "Scroll Map",
	"205": "Set Move Route",
	"206": "Get on/off Vehicle",
	"211": "Change Transparency",
	"212": "Show Animation",
	"213": "Shot Balloon Icon",
	"214": "Erase Event",
	"216": "Change Player Followers",
	"217": "Gather Followers",
	"221": "Fadeout Screen",
	"222": "Fadein Screen",
	"223": "Tint Screen",
	"224": "Flash Screen",
	"225": "Shake Screen",
	"230": "Wait",
	"231": "Show Picture",
	"232": "Move Picture",
	"233": "Rotate Picture",
	"234": "Tint Picture",
	"235": "Erase Picture",
	"236": "Set Weather Effects",
	"241": "Play BGM",
	"242": "Fadeout BGM",
	"243": "Save BGM",
	"244": "Replay BGM",
	"245": "Play BGS",
	"246": "Fadeout BGS",
	"249": "Play ME",
	"250": "Play SE",
	"251": "Stop SE",
	"261": "Play Movie",
	"281": "Change Map Display",
	"282": "Change Tileset",
	"283": "Change Battle Back",
	"284": "Change Parallax Back",
	"285": "Get Location Info",
	"301": "Battle Processing",
	"302": "Shop Processing",
	"303": "Name Input Processing",
	"311": "Change HP",
	"312": "Change MP",
	"313": "Change State",
	"314": "Recover All",
	"315": "Change EXP",
	"316": "Change Level",
	"317": "Change Parameters",
	"318": "Change Skills",
	"319": "Change Equipment",
	"320": "Change Actor Name",
	"321": "Change Actor Class",
	"322": "Change Actor Graphic",
	"323": "Change Vehicle Graphic",
	"324": "Change Actor Nickname",
	"325": "Change Actor Profile",
	"331": "Change Enemy HP",
	"332": "Change Enemy MP",
	"333": "Change Enemy State",
	"334": "Enemy Recover All",
	"335": "Enemy Appear",
	"336": "Enemy Transform",
	"337": "Show Battle Animation",
	"339": "Force Action",
	"340": "Abort Battle",
	"351": "Open Menu Screen",
	"352": "Open Save Screen",
	"353": "Game Over",
	"354": "Return to Title Screen",
	"355": "Script Header",
	"356": "Plugin Command",
	"401": "Show Text",
	"402": "Choice",
	"403": "Choice Cancel",
	"404": "Choices End",
	"405": "Show Scrolling Text",
	"408": "Comment More",
	"411": "Else",
	"412": "Branch End",
	"413": "Repeat Above",
	"601": "If Win",
	"602": "If Escape",
	"603": "If Lose",
	"604": "Battle Processing End",
	"605": "Shop Item",
	"655": "Script"
}

RMData.determineType = function($path) {
	var fileName = nwPath.basename($path, nwPath.extname($path));
	if (/Map[0-9]+/g.test(fileName)) {
		return "map"
	} else {
		return fileName.toLowerCase();
	}
}

RMData.prototype.addTransData = function(translatableObj) {
	var result = this.transData;
	var row = result.data.length;
	result.indexIds[translatableObj.text] = row;
	result.data[row] 		= [translatableObj.text, ""];

	result.context[row] 	= result.context[row]||[];
	result.context[row].push(translatableObj.context.join(this.contextSeparator))

	if (!empty(translatableObj.parameters)) {
		result.parameters[row] 	= result.parameters[row] || [];
		result.parameters[row].push(translatableObj.parameters);
	} 

	if (translatableObj.tags.length > 0) {
		result.tags[row] 	= result.tags[row] || [];
		result.tags[row].push(translatableObj.tags);
	}
	
	return this;	
}

RMData.prototype.registerStringObject = function(yamlMap, key, parameters, options) {
	if (empty(yamlMap)) {
		console.warn("ERROR:registerStringObject yamlMap is empty!", arguments);
		return yamlMap;
	}
	if (Array.isArray(key) == false) key = [key];

	if (yamlMap.hasIn(key) == false) {
		console.log("Can not find key :", key);
		return yamlMap;
	}

	try {
		var value = yamlMap.getIn(key);
	} catch(e) {
		console.warn("ERROR: can not get the value", arguments, e);
	}

	if (this.debugLevel > 2) console.log("registerStringObject", value, "key:", key);
	if (typeof value !== "string") {
		console.warn("ERROR: trying to registerString non string value. In registerStringObject", arguments);
		return value;
	}
	var translation = this.registerString(value, parameters, options);
	// apply translation

	if (value !== translation) yamlMap.setIn(key, translation);

	return translation;
}


RMData.prototype.unfilterText = function(text, context, parameters) {
	// adding carriage return
	// without carriage return all newlines are glued together
	// ... and the weird part is, this is only applied to the database items. Maps are OK.
	return text.replaceAll("\r", "").replaceAll("\n", "\r\n");
}

RMData.prototype.registerString = function(string, localContext, parameters, options) {
	string 		= string || "";
	options 	= options || {};
	options.currentAddress = options.currentAddress || this.currentAddress;

	//console.log("registering string:", arguments);

	var copyContext = JSON.parse(JSON.stringify(this.currentContext))
	localContext = localContext||[];
	if (Array.isArray(localContext) == false) localContext = [localContext];
	copyContext = copyContext.concat(localContext);
	var filteredText = this.filterText(string, copyContext, parameters)

	if (string.trim().length > 0) {
		var obj = {
			text:filteredText,
			rawText:string,
			context:copyContext,
			parameters:parameters,
			tags:options.tags||[],
			address:common.clone(options.currentAddress)
		}
		this.translatableTexts.push(obj);

		this.addTransData(obj);
	}
	
	var translation = this.translate(filteredText, copyContext);
	if (translation !== filteredText) {
		if (this.debugLevel >= 1) console.log("%cTranslating", 'background: #222; color: #bada55', filteredText,"->", translation, this.translationPair);
		
		translation = this.unfilterText(translation, copyContext, parameters);

		this.writableData.push(translation);
		return translation;

	} else {
		this.writableData.push(string);
		return string;
	}
}

if (isYamlVer2) {
	RMData.prototype.fetchCommonData = function(data, whatToFetch, parentContext, options) {
		//console.log("Handling common data", arguments);
		whatToFetch = whatToFetch || [];
		options = options || {};
		options.currentAddress = options.currentAddress || [];
	
		var arrayContent = data.getIn([]);
		//var iterableType = arrayContent.type; // MAP : hash, SEQ : array
		if (empty(arrayContent)) return this;
		if (!Array.isArray(arrayContent.items)) return this;
		for (var i=0; i<arrayContent.items.length; i++) {
			//console.log('arrayContent.items[i]', arrayContent.items[i]);
			if (empty(arrayContent.items[i])) continue;
			//if (arrayContent.items[i].constructor.name !== "YAMLMap") continue;
			for (var t=0; t<whatToFetch.length; t++) {
				var topic = whatToFetch[t];
				if (this.debugLevel > 2) console.log("Fetch", topic, "from", arrayContent.items[i]);
				//if (iterableType == "SEQ") {
				if (YAML.isSeq(arrayContent)) {
					// Array
					if (data.hasIn([i, topic]) == false) continue;
					//var context = parentContext.concat([i, topic]);
					//var thisCurrentAddress = options.currentAddress.concat([i, topic]);
					// arrayContent.items[0].value.getIn(["name"])
					this.registerStringObject(arrayContent.items[i], topic, parentContext.concat([i, topic]), [], {currentAddress:options.currentAddress.concat([i, topic])})
				} else {
					// Hash. Be careful! i does't represents KEY!
					var key = arrayContent.items[i].key;
					this.registerStringObject(arrayContent.items[i].value, topic, parentContext.concat([key, topic]), [], {currentAddress:options.currentAddress.concat([key, topic])})
				}
			}
		}
		return this;
	}
} else {

	RMData.prototype.fetchCommonData = function(data, whatToFetch, parentContext, options) {
		//console.log("Handling common data", arguments);
		whatToFetch = whatToFetch || [];
		options = options || {};
		options.currentAddress = options.currentAddress || [];
	
		var arrayContent = data.getIn([]);
		var iterableType = arrayContent.type; // MAP : hash, SEQ : array
		if (empty(arrayContent)) return this;
		if (!Array.isArray(arrayContent.items)) return this;
		for (var i=0; i<arrayContent.items.length; i++) {
			//console.log('arrayContent.items[i]', arrayContent.items[i]);
			if (empty(arrayContent.items[i])) continue;
			//if (arrayContent.items[i].constructor.name !== "YAMLMap") continue;
			for (var t=0; t<whatToFetch.length; t++) {
				var topic = whatToFetch[t];
				if (this.debugLevel > 2) console.log("Fetch", topic, "from", arrayContent.items[i]);
				if (iterableType == "SEQ") {
					// Array
					if (data.hasIn([i, topic]) == false) continue;
					//var context = parentContext.concat([i, topic]);
					//var thisCurrentAddress = options.currentAddress.concat([i, topic]);
					// arrayContent.items[0].value.getIn(["name"])
					this.registerStringObject(arrayContent.items[i], topic, parentContext.concat([i, topic]), [], {currentAddress:options.currentAddress.concat([i, topic])})
				} else {
					// Hash. Be careful! i does't represents KEY!
					var key = arrayContent.items[i].key;
					this.registerStringObject(arrayContent.items[i].value, topic, parentContext.concat([key, topic]), [], {currentAddress:options.currentAddress.concat([key, topic])})
				}
			}
		}
		return this;
	}
}

RMData.prototype.fetchSystem = function(data, parentContext, options) {
	options = options || {};
	options.currentAddress = options.currentAddress || [];

	var type = ['elements', 'skill_types', 'weapon_types', 'armor_types', 'variables', 'switches'];	
	//if (this.options?.loadVariableName) type.push("variables", "switches");

	for (var i in type) {
		var key = type[i];
		if (!data.hasIn([key])) continue;
		var db = data.getIn([key]);
		if (empty(db)) continue;
		if (empty(db.items)) continue;
		for (var idx=0; idx<db.items.length; idx++) {
			this.registerStringObject(db, idx, parentContext.concat(key, idx), [], {currentAddress:options.currentAddress.concat[key, idx]})
		}
	}


	// fetch terms
	// XP : not exist
	// vx : key pair content
	// ace: category and array
	if (data.hasIn(["terms", "params"])) {
		// ACE
		this.registerStringObject(data, 'game_title', parentContext.concat("game_title"), [], {currentAddress:options.currentAddress.concat["game_title"]})
		this.registerStringObject(data, 'currency_unit', parentContext.concat("currency_unit"), [], {currentAddress:options.currentAddress.concat["currency_unit"]})
	
		var category = data.getIn(["terms"]).items;
		for (var i in category) {
			if (empty(category[i])) continue;
			var key = category[i].key.value;

			var terms = data.getIn(["terms", key]);
			if (!terms.items) continue;
			for (var idx=0; idx<terms.items.length; idx++) {
				this.registerStringObject(terms, idx, parentContext.concat("terms", key, idx), [], {currentAddress:options.currentAddress.concat["terms", key, idx]})
			}
		}

	} else if (data.hasIn(["terms"])) {
		// VX
		this.registerStringObject(data, 'game_title', parentContext.concat("game_title"), [], {currentAddress:options.currentAddress.concat["game_title"]})

		var terms = data.getIn(["terms"]).items;
		for (var i in terms) {
			if (empty(terms[i])) continue;
			var key = terms[i].key.value;
			this.registerStringObject(data.getIn(["terms"]), key, parentContext.concat("terms", key), [], {currentAddress:options.currentAddress.concat["terms", key]})
		}
	} else if (data.hasIn(["words"])) {
		// XP
		//this.registerStringObject(data, 'title_name', parentContext.concat("title_name"), [], {currentAddress:options.currentAddress.concat["title_name"]})
	
		var terms = data.getIn(["words"]).items;
		for (var i in terms) {
			if (empty(terms[i])) continue;
			var key = terms[i].key.value;
			this.registerStringObject(data.getIn(["words"]), key, parentContext.concat("words", key), [], {currentAddress:options.currentAddress.concat["words", key]})
		}
	}

	for (var i in type) {
		var key = type[i];
		
		var db = data.getIn([key]);
		if (empty(db)) continue;
		if (empty(db.items)) continue;
		for (var idx=0; idx<db.items; idx++) {
			this.registerStringObject(db, idx, parentContext.concat(key, idx), [], {currentAddress:options.currentAddress.concat[key, idx]})
		}
	}
	return this; 
}

RMData.prototype.buildTextList = function(text, headerParam, translatedList) {
	translatedList = translatedList || [];
	text = text.replaceAll("\r", "");
	var textArray = text.split("\n");

	for (var i=0; i<textArray.length; i++) {
		if ((i+1)%4 == 1) {
			if (this.engineCode == "xp") {
				// in XP, header 101 contains the first line of the text
				translatedList.push(RMData.generateEventCommandData(headerParam.i, headerParam.c, [textArray[i]]));
				continue; // <-- only in XP! this is important
			} else {
				translatedList.push(RMData.generateEventCommandData(headerParam.i, headerParam.c, headerParam.p));
			}
		}
		translatedList.push(RMData.generateEventCommandData(headerParam.i, 401, [textArray[i]]));
	}
	return translatedList;
}

RMData.prototype.buildaddcommentList = function(text, headerParam, translatedList) {
	translatedList = translatedList || [];
	text = text.replaceAll("\r", "");
	var textArray = text.split("\n");
	for (var i=0; i<textArray.length; i++) {
		translatedList.push(RMData.generateEventCommandData(headerParam.i, 408, [textArray[i]]));
	}
	return translatedList;
}

RMData.prototype.buildcommentList = function(text, headerParam, translatedList) {
	translatedList = translatedList || [];
	text = text.replaceAll("\r", "");
	var textArray = text.split("\n");
	for (var i=0; i<textArray.length; i++) {
		translatedList.push(RMData.generateEventCommandData(headerParam.i, 108, [textArray[i]]));
	}
	return translatedList;
}

RMData.prototype.buildScrollTextList = function(text, headerParam, translatedList) {
	translatedList = translatedList || [];
	text = text.replaceAll("\r", "");
	var textArray = text.split("\n");

	translatedList.push(RMData.generateEventCommandData(headerParam.i, headerParam.c, headerParam.p));
	for (var i=0; i<textArray.length; i++) {
		translatedList.push(RMData.generateEventCommandData(headerParam.i, 405, [textArray[i]]));
	}	
	return translatedList;
}

RMData.prototype.buildScriptList = function(text, headerParam, translatedList) {
	console.log(">>buildScriptList", arguments);
	translatedList = translatedList || [];
	text = text.replaceAll("\r", "");
	var textArray = text.split("\n");

	console.log("Text array:", textArray);
	// first line is on header
	translatedList.push(RMData.generateEventCommandData(headerParam.i, 355, [textArray[0]]));
	for (var i=1; i<textArray.length; i++) {
		translatedList.push(RMData.generateEventCommandData(headerParam.i, 655, [textArray[i]]));
	}
	//console.log("script list", translatedList);
	return translatedList;
}


/**
 * Enter the index of choice header to process choice members
 * @param  {Array} pageList - Array of commands
 * @param  {Number} index - Index of the choice header
 * @param  {Array} context - parent context
 * @returns {Object} translated pageList[index]
 */
 RMData.prototype.fetchChoices = function(pageList, index, context) {
	// this command = choice header
	if (this.debugLevel > 1) console.log("fetchChoices", arguments);
	var currentLine = pageList.getIn([index]);
	var thisTexts 	= currentLine.getIn(["p", 0]).toJSON(); // array of texts
	var thisTextsTranslated = [];
	var choices = []; 

	if (this.debugLevel > 1) console.log("Choices:", thisTexts);
	if (empty(thisTexts)) return currentLine;

	for (x=0; x<thisTexts.length; x++) {
		var thisText 	= thisTexts[x];
		var thisContext = context.concat([index, `${x+1}from${thisTexts.length}`]);
		if (this.debugLevel > 1) console.log("Registering:", thisText);
		var translation = this.registerString(thisText, thisContext, [], {});
		thisTextsTranslated.push(translation);
		//this.setEntryPointValue(thisTexts, x, translation);

		// create index
		choices[x] = {
			originalText	:thisText,
			indent			:currentLine.indent,
			translation		:translation
		}		
	}
	var currentLineObj = currentLine.toJSON();
	currentLineObj.p[0] = thisTextsTranslated;
	currentLine = RMData.generateEventCommandData(currentLineObj.i, currentLineObj.c, currentLineObj.p);

	// Choice member are translated directly without registering

	var processed = 0;

	// the rest of the choice is current indent + 1
	//var expectedIndent = currentLine.indent+1;
	for (var i=index+1; i<pageList.items.length; i++) {
		var currentPageDoc = YAML.getFromIndex(pageList, i);
		var currentPage = currentPageDoc.toJSON();
		if (currentPage.c !== 402) continue;
		if (currentPage.i !== currentLineObj.i) continue;

		var currentChoice = choices[processed];
		if (Boolean(currentChoice) == false) continue;

		currentPage.p[1] = translation;
		//currentPageDoc.setIn(["p", 1], currentChoice.translation)
		//currentPageDoc.setIn(["p", 1], currentPage.p)
		
		pageList.items[i] = RMData.generateEventCommandData(currentPage.i, currentPage.c, currentPage.p);

		processed++;
		if (processed >= choices.length) break;

	}

	// returns mutated currentLine
	return currentLine;
}

/**
 * @param  {} commandList
 * @param  {} parentContext
 */
RMData.prototype.fetchCommandList = async function(commandList, parentContext=[]) {
	if (empty(commandList)) return this;
	if (this.debugLevel >= 1) console.log("Processing command list:", commandList);
	/*
	if (typeof commandList == "object") {
		if (Array.isArray(commandList.items)) commandList = commandList.items;
	}
	*/

	var translatedList = [];
	var last101 = {};
	var last105 = {};
	var last355 = {};
	var last408 = {};
	var last108 = {};
	var textStack 			= [];
	var addcommentStack 			= [];
	var commentStack 			= [];
	var scrollingTextStack 	= [];
	var scriptStack 		= [];
	var currentTextParam 			= {};
	var currentScrollingTextParam 	= {};
	var currentScriptParam 			= {};
	var currentaddcommentParam 			= {};
	var currentcommentParam 			= {};
	const messagePossition = ["top", "middle", "bottom"];

	for (var i=0; i<commandList.items.length; i++) {
		//!ruby/object:RPG::EventCommand {i: 0, c: 105, p: [2, false]}
		//var currentMap 		= commandList[parseInt(i)];
		var currentMap 		= YAML.getFromIndex(commandList, i);
		//console.log("currentMap for", i, " is" ,currentMap.toJSON());
		// expect YAMLMap object
		if (currentMap.constructor.name !== "YAMLMap") continue;
		
		var command 		= currentMap.toJSON();
		// command will be : {i: 0, c: 105, p: [2, false]}

		// Process textStack
		if (textStack.length>0 && command.c!== 401) {
			// end of text stack
			if (this.debugLevel > 2) console.log("Current textstack", textStack);
			var pictureStatus = "noPicture";
			if (!empty(currentTextParam.headerParam[0])) pictureStatus = "hasPicture";

			var context = common.clone(parentContext);
			context.push("list", currentTextParam.headerIndex, "message", pictureStatus, messagePossition[currentTextParam.headerParam[3]]);

			var translation = this.registerString(textStack.join("\n"), context, last101);
			if (this.debugLevel > 2) console.log(">>Generated combined text:", translation);
			this.buildTextList(translation, last101, translatedList);

			textStack = [];
		}
		
		if (addcommentStack.length>0 && command.c!== 408) {
			// end of text stack
			if (this.debugLevel > 2) console.log("Current addcommentStack", addcommentStack);

			var context = common.clone(parentContext);
			context.push("list", currentTextParam.headerIndex, "addcomm");

			var translation = this.registerString(addcommentStack.join("\n"), context, last408);
			if (this.debugLevel > 2) console.log(">>Generated combined text:", translation);
			this.buildaddcommentList(translation, last408, translatedList);

			addcommentStack = [];
		}
		
		if (commentStack.length>0 && command.c!== 108) {
			// end of text stack
			if (this.debugLevel > 2) console.log("Current commentStack", commentStack);

			var context = common.clone(parentContext);
			context.push("list", currentTextParam.headerIndex, "vxcomm");

			var translation = this.registerString(commentStack.join("\n"), context, last108);
			if (this.debugLevel > 2) console.log(">>Generated combined text:", translation);
			this.buildcommentList(translation, last108, translatedList);

			commentStack = [];
		}
		
		if (scrollingTextStack.length>0 && command.c!== 405) {
			// end of text stack

			var context = common.clone(parentContext);
			context.push("list", currentScrollingTextParam.headerIndex, "scrollingMessage");

			var translation = this.registerString(scrollingTextStack.join("\n"), context, last105);
			if (this.debugLevel > 2)console.log(">>Generated combined text:", translation);
			this.buildScrollTextList(translation, last105, translatedList);

			scrollingTextStack = [];
		}


		if (scriptStack.length>0 && command.c!== 655) {
			// end of text stack
			if (this.debugLevel > 1) console.log("executing scriptstack");

			var context = common.clone(parentContext);
			context.push("list", currentScriptParam.headerIndex, "script");

			// this is raw script
			var script = scriptStack.join("\n");

			// for raw viewer store raw script as Attachment, because we won't save the code into files.
			var attachmentName = "scriptCommand/"+common.generateId()+".rb";

			
			if (this.debugLevel > 1) console.log("registering string within event's RGSS code.");
			var copyOptions 				= common.clone(this.options);
				copyOptions.baseContext 	= context;
				copyOptions.baseParameter 	= {attachment:attachmentName}
				copyOptions.baseTags		= ["red"];
				copyOptions.translationInfo = this.translationInfo;
				copyOptions.translationPair = this.translationPair;

			var scriptObj = new RGSSParser(script, copyOptions);
			//scriptObj.debugLevel = 9;
			await scriptObj.parse();
			if (this.debugLevel > 1) console.log("ScriptObj:", scriptObj);
			// produce translated script from scriptObj
			script = scriptObj.toString();
			if (this.debugLevel > 1) console.log("parsed text below:\n", script);
			// import transData from scriptObj into rmData
			this.importTransData(scriptObj);

			// assign attachment only if has atleast one translatable string / data length > 0
			if (scriptObj.transData.data.length > 0) {
				attachments[attachmentName] = {
					type:"text/ruby",
					data:script
				}
			}

			//var translation = this.registerString(script, context, last355);
			if (this.debugLevel > 2)console.log(">>Generated combined text:", script);
			
			this.buildScriptList(script, last355, translatedList);

			scriptStack = [];
		}

		switch(command.c) {
			// handling interpolatable texts
			case 101: //text parameters
				textStack = [];
				currentTextParam.headerIndex = i;
				currentTextParam.headerParam = command.p;
				// in XP 101 contains the first line of the text
				if (this.engineCode == "xp") textStack.push(command.p[0]);
				last101 = command;
				break;
			case 105: //start text scroll
				scrollingTextStack = [];
				currentScrollingTextParam.headerIndex = i;
				currentScrollingTextParam.headerParam = command.p;
				last105 = command;
				break;
			case 401: //text
				textStack.push(command.p[0]);
				break;
			case 405: //long text
				scrollingTextStack.push(command.p[0]);
				break;
			
			case 355: //Script Header
				if (this.debugLevel > 1) console.log("Code 355", command);
				scriptStack = [];
				currentScriptParam.headerIndex = i;
				currentScriptParam.headerParam = command.p;
				last355 = command;
				scriptStack.push(command.p[0]);
				break;					
			case 655: //Script
				if (this.debugLevel > 1) console.log("Code 655", command);

				scriptStack.push(command.p[0]);
				break;
            case 108: //comment
    			currentcommentParam.headerIndex = i;
				currentcommentParam.headerParam = command.p;
				last108 = command;
				commentStack.push(command.p[0]);
                break;
			case 408: //additional comment
    			currentaddcommentParam.headerIndex = i;
				currentaddcommentParam.headerParam = command.p;
				last408 = command;
				addcommentStack.push(command.p[0]);
                break;
			// handling non interpolatable texts
			case 122: //set variable
				var thisText = currentMap.getIn(["p", 4]);
				if (typeof thisText !== 'string') {
					translatedList.push(currentMap);
					break;
				}
				var context = common.clone(parentContext);
				context.push("list", i, RMData.RPGM_EVENT_CODE[122], "/var:"+currentMap.getIn(["p", 0])+"-"+currentMap.getIn(["p", 1]));
				var translation = this.registerString(thisText, context, [], {tags: ["red"]});
				
				//currentMap.setIn(["p", 4], translation);
				var translatedP = command.p || [];
				translatedP[4] = translation;
				var newMap = RMData.generateEventCommandData(command.i, command.c, translatedP)

				translatedList.push(newMap);
				break;

			case 102: //choice header
				var context = common.clone(parentContext);
				context.push("list", i, RMData.RPGM_EVENT_CODE[102]);

				var translatedLine = this.fetchChoices(commandList, i, context);
				translatedList.push(translatedLine);
				
				break;
				/*				
			case 402: //choice
				var thisText = currentMap.getIn(["p", 1]);
				if (typeof thisText !== 'string') break;
				var context = common.clone(parentContext);
				context.push("list", i, RMData.RPGM_EVENT_CODE[402]);
				var translation = this.registerString(thisText, context, [], {});
				
				currentMap.setIn(["p", 1], translation);
				translatedList.push(currentMap);
				break;
				*/

			case 320: //Change name
			case 324: //Change nick name
			case 325: //Change profile
				var thisText = currentMap.getIn(["p", 1]);
				if (typeof thisText !== 'string') break;
				var context = common.clone(parentContext);
				context.push("list", i, RMData.RPGM_EVENT_CODE[currentMap.getIn(["c"])]);
				var translation = this.registerString(thisText, context, [], {});
				
				//currentMap.setIn(["p", 1], translation); <-- causes bug
				var translatedP = command.p || [];
				translatedP[1] = translation;
				var newMap = RMData.generateEventCommandData(command.i, command.c, translatedP)
				translatedList.push(newMap);
				break;

			/*
			case 356: //plugin command
				var thisText = currentMap.getIn(["p", 0]);
				if (typeof thisText !== 'string') break;
				var context = common.clone(parentContext);
				context.push("list", i, RMData.RPGM_EVENT_CODE[currentMap.getIn(["c"])]);
				var translation = this.registerString(thisText, context, [], {tags:["red"]});
				
				currentMap.setIn(["p", 0], translation);
				translatedList.push(currentMap);
				break;
			*/

			default:
				// append current document map as is
				translatedList.push(currentMap);	
		}
	}

	if (this.debugLevel > 1) console.log("Translated list:", translatedList);
	return translatedList;
}

/**
 * @param  {Object} document
 * @param  {Number} eventId
 * @param  {Number} pageId
 * @param  {Number} commandIndex - new command will be inserted at this index
 * @param  {} command
 */
RMData.insertEventCommandAt = function(document, eventId, pageId, commandIndex, command) {
	var page1Evt = document.getIn(['events', eventId, 'pages', pageId, 'list']).items
	var insertedDoc = YAML.parseDocument('- !ruby/object:RPG::EventCommand {i: 0, c: 401, p: [inserted doc]}')
	var newItem = insertedDoc.getIn([0])
	insertArrayAt(page1Evt, commandIndex, [newItem])
}

RMData.generateEventCommandData = function(i, c, p) {
	var newData = YAML.parseDocument(`- !ruby/object:RPG::EventCommand {i: ${i}, c: ${c}, p: ${JSON.stringify(p)}}`);
	return newData.getIn([0]);
}

RMData.selectTranslationData = function(translationDatas, path) {
	// must match trans.project.files[thefile].path
	var newPath = path;
	newPath = newPath.replace(/\\/g, "/");
	translationDatas.translationData = translationDatas.translationData || {};
	return translationDatas.translationData[newPath];
}

RMData.getAttachments = function() {
	return attachments;
}

module.exports = {
    YAML,
    attachments,
    GameIniParser,
    RGSSParser,
    RMData,
    isYamlVer2,
    YAMLUtil,
	customTags
}