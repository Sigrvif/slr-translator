var thisAddon     = this;
var appName     = this.package.name;
var spawn         = spawn || require('child_process').spawn;
var ws             = ws || require('www/js/lib/shortcuts.js');
var ini         = ini || require('ini')
var bCopy         = require('www/js/lib/bigCopy.js');
var fse         = require('fs-extra');
var MVRAW = require("www/core/rmmv/rawview-logic.js");
const { resolve } = require('path');
var gameEngine = "rmmv";
try {
    window.transConfig = JSON.parse(localStorage.getItem('Config'));
} catch (e){
    console.log(e);
}
thisAddon.debugLevel = 0;
this.optionsForm = {
    /*    
        "maxLineMessage": {
            "type": "number",
            "title": "Maximum number of line in message box.",
            "description": "Default value is 4. Type 0 to disable this feature. If the number of line in message box is greater than this number, SLR Translator will generates a new message box to prevents the texts overflowing the boxes.",
            "HOOK": "thisAddon.config.maxLineMessage"
        },    
        
        "booleanValue": {
            "type": "boolean",
            "title": "Use legacy parser",
            "description": "Use the old parser. The old parser doesn't support some newly added features.",
            "HOOK": "thisAddon.config.useLegacyParser",
            "inlinetitle": "Use old parser",
            "fieldHtmlClass":"flipSwitch"
        },*/
        "beautifyJSON": {
            "type": "boolean",
            "title": "Beautify JSON data",
            "description": "When checked the generated data will be beautified.",
            "default": true,
            "HOOK": "thisAddon.config.beautifyJSON",
            "inlinetitle": "Beautify JSON data",
            "fieldHtmlClass":"flipSwitch"
        }
}
thisAddon.applyDefaults({ maxLineMessage: 4 });


class RMMVData extends require("www/js/ParserBase.js").ParserBase {
    constructor(obj, options, callback) {
        super(obj, options, callback)
        this.debugLevel = thisAddon.debugLevel;
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
RMMVData.RPGM_EVENT_CODE = {
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
    "357": "MZ Plugin Command", // MZ
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
    "655": "Script",
    "657": "Plugin Parameter" // MZ
  }

RMMVData.determineType = function($path) {
    var fileName = nwPath.basename($path, nwPath.extname($path));
    if (/Map[0-9]+/g.test(fileName)) {
        return "map"
    } else {
        return fileName.toLowerCase();
    }
}


RMMVData.prototype.MV_buildTextList = function($text, $header) {
    // $splitEach 0 ... then no split;
    // Show message are $splitEach = 4

    $text = $text || "";
    if (typeof $text === "number") {
        $text = $text.toString();
        $text = $text + "　　　　SLRnumbah";
    }
    if (typeof $text !== "string") {
        console.warn("Expected string, but ", typeof $text, "given:", $text);
        $text = $text.toString();
    }
    $text = $text.replaceAll("\r", "");
    var $textArray = $text.split("\n");
    
    var $LIST =[];
    for (var $key=0; $key<$textArray.length; $key++) { 
        var $line = $textArray[$key];
        if (($key+1)%4 == 1) {
            $LIST.push($header);
        }
        var $newRow = {};
        $newRow['code'] = 401;
        $newRow['indent'] = $header['indent'];
        $newRow['parameters'] = [$line];
        $LIST.push($newRow);
    }
    return $LIST;
}

RMMVData.prototype.MV_buildScrollTextList = function($text, $header) {
    $text = $text || "";
    $text = $text.replaceAll("\r", "");
    var $textArray = $text.split("\n");
    
    var $LIST =[];
    $LIST.push($header);
    for (var $key=0; $key<$textArray.length; $key++) { 
        var $line = $textArray[$key];
        var $newRow = {};
        $newRow['code'] = 405;
        $newRow['indent'] = $header['indent'];
        $newRow['parameters'] = [$line];
        $LIST.push($newRow);
    }
    return $LIST;
}

/**
 * Converts a multi lined text into a valid array of RMMV event object
 * @since 2.5
 * @param {String} text - The multilined text
 * @param {Object} header - Header object with the first line of the message
 * @returns {Object[]} Array of the RMMV event list
 */
RMMVData.prototype.MV_buildCommentList = function(text, header) {
    // $splitEach 0 ... then no split;
    // Show message are $splitEach = 6
    text = text.replaceAll("\r", "");
    var $textArray = text.split("\n");
    
    var $LIST =[];
    for (var $key=0; $key<$textArray.length; $key++) { 
        var $line = $textArray[$key];
        if (($key+1)%6 == 1) {
            var newHeader = common.clone(header);
            newHeader.parameters = [$line];
            $LIST.push(newHeader);
            continue;
        }
        var $newRow = {};
        $newRow['code'] = 408;
        $newRow['indent'] = header['indent'];
        $newRow['parameters'] = [$line];
        $LIST.push($newRow);
    }
    return $LIST;
}


RMMVData.prototype.applyTranslation = function(translation, localContext, parameters, options) {
    console.log("Entering applyTranslation", arguments);
}


RMMVData.prototype.registerStringObject = function(obj, key, context, parameters, options) {
    //console.log("registerStringObject", arguments);
    var translation = this.registerString(obj[key], context, parameters, options);
    //console.log("translation", translation)
    // apply translation
    obj[key] = translation;
    return translation;
}

RMMVData.prototype.fetchCommonData = function($data, $fetchData, $parentContext, options) {
    options = options || {};
    options.currentAddress = options.currentAddress || [];
    console.log("parsing common data");
    if (empty($data)) return false;
    //console.log("incoming data is:", $data);

    // create a copy of data;
    //this.translatedData = common.clone($data);


    for ($i=1; $i<$data.length; $i++) {
        if (empty($data[$i])) continue;

        for ($fetch=0; $fetch<$fetchData.length; $fetch++) {
            if (!Boolean($data[$i][$fetchData[$fetch]])) continue; // will allow blank if only this
            if (empty($data[$i][$fetchData[$fetch]])) continue;
            //var context = common.clone($parentContext);
            //context.push($i, $fetchData[$fetch]);
            var context = $parentContext.concat([$i, $fetchData[$fetch]]);
            var thisCurrentAddress = options.currentAddress.concat([$i, $fetchData[$fetch]]);
            //this.registerString($data[$i][$fetchData[$fetch]], context, {});
            this.registerStringObject($data[$i], $fetchData[$fetch], context, [], {currentAddress:thisCurrentAddress})

        }
    }

    if (this.writeMode) this.writableObj = $data;
    return this;
}

RMMVData.prototype.buildScriptList = function(text, headerParam, translatedList) {
    console.log(">>buildScriptList", arguments);
    translatedList = translatedList || [];
    text = text.replaceAll("\r", "");
    var textArray = text.split("\n");

    console.log("Text array:", textArray);
    // first line is on header
    //translatedList.push(RMData.generateEventCommandData(headerParam.i, 355, textArray[0]));
    translatedList.push(
        {
            "code": 355,
            "indent": headerParam.indent,
            "parameters": [textArray[0]]
          }    
    );
    for (var i=1; i<textArray.length; i++) {
        translatedList.push(
            {
                "code": 655,
                "indent": headerParam.indent,
                "parameters": [textArray[i]]
              }
        );
    }
    console.log("script list", translatedList);
    return translatedList;
}

/**
 * Enter the index of choice header to process choice members
 * @param  {Array} pageList - Array of commands
 * @param  {Number} index - Index of the choice header
 * @param  {Array} context - parent context
 * @returns {Object} translated pageList[index]
 */
RMMVData.prototype.fetchChoices = function(pageList, index, context) {
    // this command = choice header
    var currentLine = pageList[index];
    var thisTexts     = currentLine.parameters[0]; // array of texts

    /*
        {
            choiceStr: id
        }
    */
    var choices = []; 

    if (empty(thisTexts)) return currentLine;

    for (x=0; x<thisTexts.length; x++) {
        var thisText     = thisTexts[x];
        var thisContext = context.concat([index, `${x+1}from${thisTexts.length}`]);
        var translation = this.registerString(thisText, thisContext, [], {});
        this.setEntryPointValue(thisTexts, x, translation);

        // create index
        choices[x] = {
            originalText    :thisText,
            indent            :currentLine.indent,
            translation        :translation
        }        
    }    

    // Choice member are translated directly without registering

    var processed = 0;

    // the rest of the choice is current indent + 1
    //var expectedIndent = currentLine.indent+1;
    for (var i=index+1; i<pageList.length; i++) {
        var currentPage = pageList[i];
        if (currentPage.code !== 402) continue;
        if (currentPage.indent !== currentLine.indent) continue;

        var currentChoice = choices[processed];
        if (Boolean(currentChoice) == false) continue;

        currentPage.parameters[1] = currentChoice.translation;

        processed++;
        if (processed >= choices.length) break;

    }

    // returns mutated currentLine
    return currentLine;
}


/**
 * Process MZ's Plugin command parameters
 * @param  {Array} pageList - Array of commands
 * @param  {Number} index - Index of the choice header
 * @param  {Array} context - parent context
 * @returns {Object} translated pageList[index]
 */
RMMVData.prototype.fetchMzPluginCommand = async function(pageList, index, context) {
    // currentLine = parameter header/ command 357
    if (!pageList || index < 0 || index >= pageList.length) {
        console.warn("Invalid pageList or index in fetchMzPluginCommand");
        return null;
    }
    var currentLine = pageList[index];
    if (!currentLine) {
        console.warn("currentLine is undefined at index", index);
        return null;
    }

    console.log("Current line", currentLine);
    context = context.concat([currentLine.parameters[0], currentLine.parameters[1]])

    // what we need to process is parameter 3
    var paramData = currentLine.parameters[3];
    var translatedParam = [];
    var idx = -1;
    console.log("ParamData:", paramData);
    for (var key in paramData) {
        idx++; // should be located here.
        if (typeof paramData[key] === "number") {
            paramData[key] = paramData[key].toString();
            paramData[key] = paramData[key] + "　　　　SLRnumbah";
        }
        if (typeof paramData[key] !== "string") continue;
        if (!common.isTranslatableText(paramData[key])) continue;
        

        if (common.isJSONString(paramData[key])) {
            console.log("JSON String", paramData[key]);
            var parsedJson = JSON.parse(paramData[key]);
                    
            // Handle different types of JSON content
            if (typeof parsedJson === "string") {
                // For simple strings, process as plain text
                console.log("Register JSON string as plain string:", parsedJson);
                var thisText = parsedJson;
                var thisContext = context.concat([key]);
                var translation = this.registerString(thisText, thisContext, [], {});
                // Re-wrap in JSON format
                this.setEntryPointValue(paramData, key, JSON.stringify(translation));
                translatedParam[idx] = JSON.stringify(translation);
            } else if (Array.isArray(parsedJson)) {
                // For arrays, process each string element
                var translatedArray = [];
                for (var arrIndex = 0; arrIndex < parsedJson.length; arrIndex++) {
                    if (typeof parsedJson[arrIndex] === "string") {
                        var elementContext = context.concat(["array", arrIndex]);
                        var elementTranslation = this.registerString(parsedJson[arrIndex], elementContext, [], {});
                        translatedArray.push(elementTranslation);
                    } else {
                        translatedArray.push(parsedJson[arrIndex]);
                    }
                }
                // Re-wrap the translated array in JSON format
                var translation = JSON.stringify(translatedArray);
                this.setEntryPointValue(paramData, key, translation);
                translatedParam[idx] = translation;
            } else if (typeof parsedJson === "object") {
                // For objects, process string values
                var jsonTranslate = new JSONTranslate(parsedJson, {
                    baseContext:context,
                    translationPair:this.translationPair,
                    translationInfo:this.translationInfo,
                    writeMode:this.writeMode
                });
                await jsonTranslate.parse();
                this.importTransData(jsonTranslate);
                console.log("jsonTranslate", jsonTranslate);

                var translation = jsonTranslate.toString();
                this.setEntryPointValue(paramData, key, translation);
                translatedParam[idx] = translation;
            }
        } else {
            // Check if it's a quoted string that's not valid JSON
            if (paramData[key].length >= 2 && paramData[key].charAt(0) === '"' && paramData[key].charAt(paramData[key].length - 1) === '"') {
                // Extract the inner content and process as plain text
                var innerText = paramData[key].substring(1, paramData[key].length - 1);
                console.log("Register quoted string as plain string:", innerText);
                var thisContext = context.concat([key]);
                var translation = this.registerString(innerText, thisContext, [], {});
                // Re-wrap with quotes and proper escaping
                var wrappedTranslation = '"' + translation.replace(/"/g, '\\"') + '"';
                this.setEntryPointValue(paramData, key, wrappedTranslation);
                translatedParam[idx] = wrappedTranslation;
            } else {
                console.log("Register plain string:", paramData[key]);
                var thisText     = paramData[key];
                var thisContext = context.concat([key]);
                var translation = this.registerString(thisText, thisContext, [], {});
                this.setEntryPointValue(paramData, key, translation);
                translatedParam[idx] = translation;
            }
        }

    }

    console.log("Translated param:",translatedParam);

    if (this.writeMode) {
        var replace657Text = function(str, replacement) {
            if (!str) return str;
            if (typeof str !== "string") return str;

            replacement = replacement || "";

            // Check if replacement is already a JSON string (starts and ends with quotes)
            // and if so, use it as-is without adding extra quotes
            var isJsonString = false;
            if (typeof replacement === "string" && replacement.length >= 2) {
                var firstChar = replacement.charAt(0);
                var lastChar = replacement.charAt(replacement.length - 1);
                isJsonString = (firstChar === '"' && lastChar === '"') || 
                              (firstChar === "'" && lastChar === "'");
            }

            // locate first occurance of " = "
            var splitLocation = str.indexOf(" = ");
            var firstPart = str.substring(0, splitLocation);
                
            if (isJsonString) {
                // Use the JSON string as-is
                return firstPart + " = " + replacement;
            } else {
                // Add quotes for non-JSON strings
                return firstPart + " = " + replacement;
            }
        }

        // traverse through the next 657 commands
        var idx = -1;
        for (var key in paramData) {
            idx++; // should be on the top
            if (!translatedParam[idx]) continue;
            //console.log("Translating 657: ", translatedParam[idx]);
            var thisIndex = idx + index + 1;
            // Check if thisIndex is within bounds
            if (thisIndex >= pageList.length) {
                console.warn(`Index ${thisIndex} is out of bounds for pageList of length ${pageList.length}`);
                continue;
            }
            var thisPageList = pageList[thisIndex];
            if (!thisPageList) {
                console.warn(`pageList[${thisIndex}] is undefined`);
                continue;
            }
            if (thisPageList.code !== 657) {
                console.warn(`Expected code is 657 but ${thisPageList.code} given`);
                continue;
            } 
            
            thisPageList.parameters[0] = replace657Text(thisPageList.parameters[0], translatedParam[idx]);

        }
    }

    return currentLine;
}


RMMVData.prototype.fetchEventPages = async function($eventPages, $parentContext, $RESULT = {}) {
    //console.log("handling Event pages", arguments);
    if (!Array.isArray($eventPages)) return false;


    // create result
    // Clone each page lazily. The whole CommonEvents.json is passed in here
    // as one "pages" array, and every cloned command list is immediately
    // discarded (reset below, then rebuilt from the source objects), so an
    // upfront deep clone of the entire array would hold a second full copy
    // of the file in memory for the whole run — enough to exhaust the V8
    // heap of the renderer (OOM crash) on large games.
    var translatedPage = [];

    for(var $keyPage=0; $keyPage<$eventPages.length; $keyPage++) {
        var $page = $eventPages[$keyPage];
        //console.log(`page of index ${$keyPage} is :`, $page);
        translatedPage[$keyPage] = common.clone($page);
        if (empty($page)) continue;
        if (empty($page['list'])) continue;

        // reset list for translatedPage
        translatedPage[$keyPage].list = [];


        var $messagePossition        = ["top", "middle", "bottom"];
        var $currentTextParam         = {};
        var $currentLongTextParam     = {};
        var $currentCommentParam     = {};
        var last101                 = {};
        var last105                 = {};
        var last108                    = {};
        var last355                 = {};
        var scriptStack             = [];
        var currentScriptParam         = {};
        var $currentText             = [];
        var $currentLongText         = [];
        var $currentComment         = [];

        for ($i=0; $i<$page['list'].length; $i++) {
            var $currentLine = $page['list'][$i];
            var $thisObj = {};
            //console.log("handling command", $currentLine);
            // process current text buffer when not 401
            if (!empty($currentText) && $page['list'][$i]['code'] != 401) {
                //console.log("registering texts", $currentText);
                var $pictureStatus = "noPicture";
                try {
                    if (!empty($currentTextParam['headerParam'][0])) $pictureStatus = "hasPicture";
                } catch (e) {
                    console.warn("Invalid sequence of event code 401")
                    // do not translate
                    translatedPage[$keyPage].list.push($currentLine);
                    continue;
                }

                
                var context = common.clone($parentContext);
                context.push($keyPage, "list", $currentTextParam['headerIndex'], "message", $pictureStatus, $messagePossition[$currentTextParam['headerParam'][3]]);

                if ($currentTextParam['headerParam'][4]) {
                    // MZ specific. Actor name
                    $currentTextParam.rowInfoText = $currentTextParam['headerParam'][4];
                }

                var translation = this.registerString($currentText.join("\n"), context, $currentTextParam);
                //console.log("Translation: ", translation);
                if (this.writeMode) {
                    var newList = this.MV_buildTextList(translation, last101);
                    //console.log("Generating list based on translation:", newList);
                    translatedPage[$keyPage].list = translatedPage[$keyPage].list.concat(newList);
                }

                $currentText = [];
                $currentTextParam = {};
            }
            
            if (!empty($currentLongText) && $page['list'][$i]['code'] != 405) {

                var context = common.clone($parentContext);
                context.push($keyPage, "list", $currentLongTextParam['headerIndex'], "scrollingMessage");
                var translation = this.registerString($currentLongText.join("\n"), context, $currentLongTextParam);
                if (this.writeMode) {
                    var newList = this.MV_buildScrollTextList(translation, last105);
                    translatedPage[$keyPage].list = translatedPage[$keyPage].list.concat(newList);
                }
                $currentLongText = [];
                $currentLongTextParam = {};
            }

            if (!empty($currentComment) && $page.list[$i].code != 408) {
                console.log("Handling event's comment");
                var context = common.clone($parentContext);
                context.push($keyPage, "list", $currentCommentParam['headerIndex'], "comment");
                var translation = this.registerString($currentComment.join("\n"), context, $currentCommentParam, {tags:["blue"]});
                if (this.writeMode) {
                    var newList = this.MV_buildCommentList(translation, last108);
                    translatedPage[$keyPage].list = translatedPage[$keyPage].list.concat(newList);
                }
                $currentComment = [];
                $currentCommentParam = {};
            }


            if (scriptStack.length>0 && $page.list[$i].code !== 655) {
                // end of text stack
                console.log("executing scriptstack");
    
                var context = common.clone($parentContext);
                context.push($keyPage, "list", currentScriptParam.headerIndex, "script");
    
                // this is raw script
                var script = scriptStack.join("\n");
    
                // for raw viewer store raw script as Attachment, because we won't save the code into files.
                var attachmentName = "scriptCommand/"+common.generateId()+".js";
    
                
                console.log("registering string within event's JS code.");
                var copyOptions = common.clone(this.options);
                    copyOptions.baseContext     = context;
                    copyOptions.baseParameter     = {attachment:attachmentName}
                    copyOptions.baseTags        = ["red"];
                    copyOptions.translationPair = this.translationPair;
                    copyOptions.translationInfo = this.translationInfo;
                var scriptObj = new ESScript(script, copyOptions);
                await scriptObj.parse();

                console.log("ScriptObj:", scriptObj);
                // produce translated script from scriptObj
                script = scriptObj.toString();
                console.log("parsed text below:\n", script);
                // import transData from scriptObj into rmData
                this.importTransData(scriptObj);
    
                // assign attachment only if has atleast one translatable string / data length > 0
                if (scriptObj.transData.data.length > 0) {
                    RMMVGames.lastAttachments[attachmentName] = new Attachment({
                        type:"text/javascript",
                        data:script
                    })
                }
    
                //var translation = this.registerString(script, context, last355);
                if (thisAddon.debugLevel > 2)console.log(">>Generated combined text:", script);
                
                this.buildScriptList(script, last355, translatedPage[$keyPage].list);
    
                scriptStack = [];
                currentScriptParam = {};
            }
            
            switch($page.list[$i].code) {
                // handling interpolatable texts
                case 101: //text parameters
                    // MZ specific, capture name
                    if ($page.list[$i].parameters.length == 5) {
                        this.registerStringObject($page.list[$i].parameters, 4, $parentContext.concat([$keyPage, "list", $i, RMMVData.RPGM_EVENT_CODE[$page.list[$i].code], "actorName"]))
                    }

                    $currentTextParam.headerIndex = $i;
                    $currentTextParam.headerParam = $page.list[$i].parameters;
                    $currentText     = [];
                    last101         = $currentLine;

                    break;
                case 105: //start text scroll
                    $currentLongTextParam.headerIndex = $i;
                    $currentLongTextParam.headerParam = $page.list[$i].parameters;
                    $currentLongText     = [];
                    last105             = $currentLine;
                    break;

                case 108: //Comment
                    $currentCommentParam.headerIndex = $i;
                    $currentCommentParam.headerParam = $page.list[$i].parameters;
                    $currentComment     = [];
                    $currentComment.push($currentLine['parameters'][0]);
                    last108             = $currentLine;
                    break;

                case 401: //text
                    $currentText.push($currentLine['parameters'][0]);
                    break;
                case 405: //long text
                    $currentLongText.push($currentLine['parameters'][0]);
                    break;
                case 408: //Comment header
                    $currentComment.push($currentLine['parameters'][0]);
                    break;

                
/*                 case 355: //Script Header
                    console.log("Code 355", $currentLine);
                    scriptStack = [];
                    currentScriptParam.headerIndex = $i;
                    currentScriptParam.headerParam = $currentLine.parameters;
                    last355 = $currentLine;
                    scriptStack.push($currentLine.parameters[0]);
                    break;                    
                case 655: //Script
                    console.log("Code 655", $currentLine);
                    scriptStack.push($currentLine.parameters[0]);
                    break;     */
                

                // handling non interpolatable texts
                /*
                case 122: //set variable
                    var thisText = $currentLine.parameters[4];
                    if (typeof thisText !== 'string') {
                        translatedPage[$keyPage].list.push($currentLine);
                        break;
                    }
                    var context = common.clone($parentContext);
                    context.push($keyPage, "list", $i, RMMVData.RPGM_EVENT_CODE[$page.list[$i].code], "var:"+$currentLine.parameters[0]+"-"+$currentLine.parameters[1]);
                    
                    var translation = this.registerString(thisText, context, [], {tags: ["red"]});
                    this.setEntryPointValue($currentLine.parameters, 4, translation);
                    translatedPage[$keyPage].list.push($currentLine);
                    break;
                */
                case 122: //set variable
                    console.log("Translating variable");
                    var thisText = $currentLine.parameters[4];
                    if (typeof thisText === "number") {
                        thisText = thisText.toString();
                        thisText = thisText + "　　　　SLRnumbah";
                    }
                    if (typeof thisText !== 'string') {
                        translatedPage[$keyPage].list.push($currentLine);
                        break;
                    }
                    var context = common.clone($parentContext);
                    context.push($keyPage, "list", $i, RMMVData.RPGM_EVENT_CODE[$page.list[$i].code], "var:"+$currentLine.parameters[0]+"-"+$currentLine.parameters[1]);
                    
                    // Check if it's a JSON string
                    if (common.isJSONString(thisText)) {
                        try {
                            var parsedJson = JSON.parse(thisText);
                            
                            // Handle different types of JSON content
                            if (typeof parsedJson === "string") {
                                // For simple strings, process as plain text
                                var translation = this.registerString(parsedJson, context, [], {tags: ["red"]});
                                // Re-wrap the translation in JSON format
                                $currentLine.parameters[4] = JSON.stringify(translation);
                                translatedPage[$keyPage].list.push($currentLine);
                                break;
                            } else if (Array.isArray(parsedJson)) {
                                // For arrays, process each string element
                                var translatedArray = [];
                                for (var arrIndex = 0; arrIndex < parsedJson.length; arrIndex++) {
                                    if (typeof parsedJson[arrIndex] === "string") {
                                        context.push("StringLiteral");
                                        var elementContext = context.concat(["array", arrIndex]);
                                        var elementTranslation = this.registerString(parsedJson[arrIndex], elementContext, [], {tags: ["red"]});
                                        translatedArray.push(elementTranslation);
                                    } else {
                                        translatedArray.push(parsedJson[arrIndex]);
                                    }
                                }
                                // Re-wrap the translated array in JSON format
                                $currentLine.parameters[4] = JSON.stringify(translatedArray);
                                translatedPage[$keyPage].list.push($currentLine);
                                break;
                            } else if (typeof parsedJson === "object") {
                                // For objects, process string values
                                var jsonTranslate = new JSONTranslate(parsedJson, {
                                    baseContext: context,
                                    translationPair: this.translationPair,
                                    translationInfo: this.translationInfo,
                                    writeMode: this.writeMode
                                });
                                await jsonTranslate.parse();
                                this.importTransData(jsonTranslate);
                                var translation = jsonTranslate.toString();
                                $currentLine.parameters[4] = translation;
                                translatedPage[$keyPage].list.push($currentLine);
                                break;
                            }
                        } catch (e) {
                            // If JSON parsing fails, fall through to normal processing
                            console.warn("Failed to parse JSON string:", thisText, e);
                        }
                    }
                    
                    // Also check if it's a simple quoted string (not JSON)
                    // This handles cases like "\"text\"" which might not pass isJSONString check
                    if (thisText.length >= 2 && thisText.charAt(0) === '"' && thisText.charAt(thisText.length - 1) === '"') {
                        context.push("StringLiteral");
                        // Extract the inner content and process as plain text
                        var innerText = thisText.substring(1, thisText.length - 1);
                        var translation = this.registerString(innerText, context, [], {tags: ["red"]});
                        // Re-wrap with quotes and proper escaping
                        $currentLine.parameters[4] = '"' + translation.replace(/"/g, '\\"') + '"';
                        translatedPage[$keyPage].list.push($currentLine);
                        break;
                    }
                    
                    // For non-JSON strings, process as regular text
                    var translation = this.registerString(thisText, context, [], {tags: ["red"]});
                    $currentLine.parameters[4] = translation;
                    translatedPage[$keyPage].list.push($currentLine);
                    break;
                case 102: //choice header
                    var context = common.clone($parentContext);
                    context.push($keyPage, "list", $i, RMMVData.RPGM_EVENT_CODE[$page.list[$i].code]);

                    var translatedLine = this.fetchChoices($page.list, $i, context);
                    translatedPage[$keyPage].list.push(translatedLine);
                    
                    break;
                /*                
                case 402: //choice. NO NEED, handled in choice header
                    var thisText = $currentLine['parameters'][1];
                    if (typeof thisText !== 'string') {
                        translatedPage[$keyPage].list.push($currentLine);
                        break;
                    }
                    var context = common.clone($parentContext);
                    context.push($keyPage, "list", $i, RMMVData['RPGM_EVENT_CODE'][$page['list'][$i]['code']]);
                    var translation = this.registerString(thisText, context, [], {});
                    this.setEntryPointValue($currentLine['parameters'], 1, translation);
                    translatedPage[$keyPage].list.push($currentLine);

                    break;
                */                
                case 320: //Change name
                case 324: //Change nick name
                case 325: //Change profile
                    var thisText = $currentLine.parameters[1];
                    if (typeof thisText === "number") {
                        thisText = thisText.toString();
                        thisText = thisText + "　　　　SLRnumbah";
                    }
                    if (typeof thisText !== 'string') {
                        translatedPage[$keyPage].list.push($currentLine);
                        break;
                    }
                    var context = common.clone($parentContext);
                    context.push($keyPage, "list", $i, RMMVData.RPGM_EVENT_CODE[$page.list[$i].code], "charId:"+$currentLine.parameters[0]);
                    var translation = this.registerString(thisText, context, [], {});
                    this.setEntryPointValue($currentLine.parameters, 1, translation);
                    translatedPage[$keyPage].list.push($currentLine);
                
                    break;
                    
                case 355: //Script Header
                case 655: //Script
                case 356: //plugin command
                    var thisText = $currentLine['parameters'][0];
                    if (typeof thisText === "number") {
                        thisText = thisText.toString();
                        thisText = thisText + "　　　　SLRnumbah";
                    }
                    if (typeof thisText !== 'string') {
                        translatedPage[$keyPage].list.push($currentLine);
                        break;
                    }
                    var context = common.clone($parentContext);
                    context.push($keyPage, "list", $i, RMMVData['RPGM_EVENT_CODE'][$page['list'][$i]['code']]);
                    var translation = this.registerString(thisText, context, [], {tags:["red"]});
                    this.setEntryPointValue($currentLine['parameters'], 0, translation);
                    translatedPage[$keyPage].list.push($currentLine);
                
                    break;
                
                // MZ only
                case 357: //MZ plugin command
                    console.log("Handling MZ plugin command");
                    var context = $parentContext.concat([$keyPage, "list", $i, RMMVData.RPGM_EVENT_CODE[$page.list[$i].code]]);
                    var translatedLine = await this.fetchMzPluginCommand($page.list, $i, context);
                    if (translatedLine) {
                        translatedPage[$keyPage].list.push(translatedLine);
                    } else {
                        // If fetchMzPluginCommand returns null, push the original line
                        translatedPage[$keyPage].list.push($currentLine);
                    }
                    break;
                
                default:
                    translatedPage[$keyPage].list.push($currentLine);
            }
        }
    }

    this.parsed = $RESULT;
    //console.log(">>>Translated page:", translatedPage);
    return translatedPage;
}

RMMVData.prototype.fetchSystem = function($system, $parentContext, $currentData = []) {
    
    if (!empty($system['gameTitle'])) {

        if (this.debugLevel>1) console.log("Fetch gameTitle");
        var context = $parentContext.concat(["gameTitle"]);
        this.registerStringObject($system, 'gameTitle', context, [], {currentAddress : ["gameTitle"]})
        this.gameTitle = $system['gameTitle'];
        RMMVData.lastGameTitle = $system['gameTitle'];
    }
    
    if (!empty($system['currencyUnit'])) {

        if (this.debugLevel>1) console.log("Fetch currencyUnit");
        var context = $parentContext.concat(["currencyUnit"]);
        this.registerStringObject($system, 'currencyUnit', context, [], {currentAddress : ["currencyUnit"]})
        this.currencyUnit = $system['currencyUnit'];
        RMMVData.lastcurrencyUnit = $system['currencyUnit'];
    }

    var $type = ['armorTypes', 'elements', 'equipTypes', 'skillTypes', 'weaponTypes', 'switches', 'variables'];    
    for (var $i in $type) {
        var $key = $type[$i];
        if (empty($system[$key])) continue;
        for (var $thisKey in $system[$key] ) {
            var $thisText = $system[$key][$thisKey];
            if (empty($thisText)) continue;
            
            //$currentData = this.appendResultData($currentData, $newData);
            if (this.debugLevel>2) console.log(">>>Fetch type definition: "+$key);
            if (this.debugLevel>2) console.log($system[$key], $thisKey, ">>", $system[$key][$thisKey]);

            var context = $parentContext.concat([$key, $thisKey]);
            //this.registerString($thisText, context, [], {currentAddress : [$key, $thisKey]})
            var thisOptions = {
                currentAddress : [$key, $thisKey]
            }
            if (["switches", "variables"].includes($key)) {
                thisOptions.tags = ["blue"];
            }
            this.registerStringObject($system[$key], $thisKey, context, [], thisOptions)
            
        }
    }
    
    for (var $key in $system['terms']) {
        var $terms = $system['terms'][$key];
        for (var $thisKey in $terms) {
            var $thisText = $terms[$thisKey];
            if (Boolean($thisText) == false) continue;

            if (this.debugLevel>2) console.log(">>>Fetch terms");
            if (this.debugLevel>2) console.log("$terms:", $terms);
            if (this.debugLevel>2) console.log("$thisKey:", $thisKey);
            if (this.debugLevel>2) console.log("$terms[$thisKey]:", $terms[$thisKey]);
            var context = $parentContext.concat(["terms", $key, $thisKey]);
            //this.registerString($thisText, context, [], {currentAddress : ["terms", $key, $thisKey]})
            this.registerStringObject($terms, $thisKey, context, [], {currentAddress : ["terms", $key, $thisKey]})

        }
    }
    
    this.mzFontEntries = [];
    if (!empty($system.advanced)) {
        // only in MZ
        // advanced.mainFontFilename / numberFontFilename reference the font
        // file loaded from the game's fonts folder — tag them and remember
        // the original value so a changed entry can ship the font on export
        var mzFontKeys = ["mainFontFilename", "numberFontFilename"];
        for (var key in $system.advanced) {
            var advWasNumber = (typeof $system.advanced[key] === "number");
            if (advWasNumber) {
                $system.advanced[key] = $system.advanced[key].toString();
            }
            if (typeof $system.advanced[key] !== "string") continue;
            var advTags = advWasNumber ? ["red", "num"] : ["red"];
            var isFontKey = mzFontKeys.includes(key);
            if (isFontKey) advTags = advTags.concat(["font"]);
            var advOriginal = $system.advanced[key];
            var advTranslated = this.registerStringObject($system.advanced, key, $parentContext.concat(["advanced", key]), [], {
                currentAddress     : ["advanced", key],
                tags            : advTags
            });
            if (isFontKey) {
                this.mzFontEntries.push({
                    key         : key,
                    original     : advOriginal,
                    translated : advTranslated
                });
            }
            if (advWasNumber) {
                var advNum = Number(String(advTranslated).replace(/\s*SLRnumbah.*$/, ""));
                if (!isNaN(advNum)) $system.advanced[key] = advNum;
            }
        }
    }

    //this.parsed = $currentData;
    if (this.writeMode) this.writableObj = $system;
    return this;
}

RMMVData.mergeDeep = function(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();
  
    if (typeof target == "object" && typeof source == "object") {
      for (const key in source) {
        if (typeof source[key] == "object") {
          if (!target[key]) Object.assign(target, { [key]: {} });
          this.mergeDeep(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }
  
    return this.mergeDeep(target, ...sources);
}

RMMVData.prototype.appendResultData = function($currentData, $newData) {
    if (!Array.isArray($currentData)) return false;
    if (empty($newData['text'])) return $currentData;

    if (!empty($currentData[$newData['text']])) {
        $currentData[$newData['text']] = RMMVData.mergeDeep($currentData[$newData['text']], $newData);
        $currentData[$newData['text']]['text'] = $newData['text'];
    } else {
        $currentData[$newData['text']] = $newData;
    }
    return $currentData;
}

RMMVData.prototype.fetchFromOtherJson = function(obj, context, translationPair) {
    obj = obj || this.obj;
    obj = common.clone(obj);
    translationPair = translationPair || this.translationPair;

    if (!Boolean(context)) context = [];
    if (Array.isArray(context) == false) context = [context];

    var fetchChild = (childObj, localContext) => {
        // create new clone of localContext
        if (Array.isArray(localContext) == false) localContext = [localContext];

        for (var i in childObj) {
            var newContext = common.clone(localContext);
            newContext.push(i);
                if (Boolean(childObj[i]) == false) continue
                var fcWasNumber = (typeof childObj[i] === "number");
                if (fcWasNumber) {
                    childObj[i] = childObj[i].toString();
                }
                if (typeof childObj[i] == 'object') {
                    fetchChild(childObj[i], newContext);
                } else if (typeof childObj[i] == 'string') {
                    if (!common.isTranslatableText(childObj[i])) continue;
                    var fcTranslated = this.registerStringObject(childObj, i, newContext, [], fcWasNumber ? {tags:["red","num"]} : {});
                    if (fcWasNumber) {
                        var fcNum = Number(String(fcTranslated).replace(/\s*SLRnumbah.*$/, ""));
                        if (!isNaN(fcNum)) childObj[i] = fcNum;
                    }
                }
            
        }
    }

    fetchChild(obj, context);
    this.writableObj = obj;
    return this;
}

RMMVData.prototype.setEntryPoint = function(obj, key) {
    this.currentEntryPoint.obj = obj;
    this.currentEntryPoint.key = key;
}

RMMVData.prototype.setEntryPointValue = function(obj, key, value) {
    this.currentEntryPoint.obj = obj;
    this.currentEntryPoint.key = key;
    try {
        obj[key] = value;
    } catch (e) {
        console.warn(e);
    }
}

RMMVData.selectTranslationData = function(translationDatas, path) {
    // must match trans.project.files[thefile].path
    var newPath = path;
    newPath = newPath.replace(/\\/g, "/");
    translationDatas.translationData = translationDatas.translationData || {};
    return translationDatas.translationData[newPath];
}

RMMVData.getRelativePath = function(longPath, shortPath) {
    longPath = longPath.replaceAll("\\", "/");
    var result = longPath.substr(shortPath.length);
    if (result[0] == "/") result = result.substr(1);
    return result;
}

thisAddon.RMMVData = RMMVData;

/**
 * Parser for the fonts/gamefont.css file of RPG Maker MV games.
 *
 * MV games define their main font inside fonts/gamefont.css:
 *   @font-face {
 *       font-family: GameFont;
 *       src: url("mplus-1m-regular.ttf");
 *   }
 * Every url() inside a GameFont @font-face block is registered as a
 * translatable string, so the used font file can be changed from within
 * the translation grid (the same workflow MZ offers through the advanced
 * font settings of System.json). On export the css is rebuilt with the
 * translated value and, when the referenced font is found in SLR
 * Translator's own "fonts" collection folder, the font file is copied
 * into the exported fonts folder together with the gamefont.css.
 */
class MVGameFontCss extends require("www/js/ParserBase.js").ParserBase {
    constructor(cssText, options) {
        super(cssText, options);
        this.cssText = cssText || "";
        this.gameFontEntries = []; // {original, translated}
    }
}

MVGameFontCss.BLOCK_PATTERN = /@font-face\s*\{[^{}]*\}/gi;
MVGameFontCss.FAMILY_PATTERN = /font-family\s*:\s*(['"]?)\s*GameFont\s*\1/i;
MVGameFontCss.URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/**
 * Register every GameFont src url of the css as a translatable string and
 * build the writable (translated) css text.
 * @param {String} cssText - Content of gamefont.css
 * @returns {MVGameFontCss} this
 */
MVGameFontCss.prototype.parseCss = function(cssText) {
    cssText = (typeof cssText == "string") ? cssText : this.cssText;
    this.writableData = [];
    this.transData = {data:[], context:[], tags:[], parameters:[], indexIds:{}};
    this.gameFontEntries = [];

    var blockPattern = new RegExp(MVGameFontCss.BLOCK_PATTERN.source, "gi");
    var blockMatch;
    var lastPos = 0;

    while ((blockMatch = blockPattern.exec(cssText)) !== null) {
        var block = blockMatch[0];
        if (!MVGameFontCss.FAMILY_PATTERN.test(block)) continue;

        var urlPattern = new RegExp(MVGameFontCss.URL_PATTERN.source, "gi");
        var urlMatch;
        while ((urlMatch = urlPattern.exec(block)) !== null) {
            var fontFile = urlMatch[2];
            if (empty(fontFile)) continue;

            // absolute position of the font file name inside the whole css
            var urlStart = blockMatch.index + urlMatch.index + urlMatch[0].indexOf(fontFile);
            var urlEnd = urlStart + fontFile.length;

            // keep everything up to the font file name as it is
            this.register(cssText.substring(lastPos, urlStart));

            var translated = this.registerString(fontFile, ["gamefont", "GameFont"], [], {
                currentAddress    : ["GameFont", "src"],
                tags            : ["red", "font"]
            });
            this.gameFontEntries.push({
                original     : fontFile,
                translated : translated
            });

            lastPos = urlEnd;
        }
    }

    this.register(cssText.substring(lastPos));
    this.isParsed = true;
    return this;
}

window.MVGameFontCss = MVGameFontCss;


var RMMZDataCrypto = {
    _fallbackVariants: {
        mz: { algorithm: 'xor', K: Math.sqrt(22201) | 0, cXor: 74, shiftL: 2, shiftR: 2, kXor: 165, kAdd: 18, lowerName: true },
        mv: { algorithm: 'xor', K: Math.sqrt(23409) | 0, cXor: 74, shiftL: 4, shiftR: 3, kXor: 173, kAdd: 43, lowerName: false },
        wasm: { algorithm: 'wasm', xorConstant: 196, lowerName: true }
    },

    _getFallbackVariant: function(bid) {
        if (typeof bid === 'string' && bid.indexOf('MV') === 0) return this._fallbackVariants.mv;
        return this._fallbackVariants.mz;
    },

    detectParamsSync: function(gameJsPath, engineType) {
        var managersFile;
        if (engineType === 'rmmz') {
            managersFile = nwPath.join(gameJsPath, 'rmmz_managers.js');
        } else {
            managersFile = nwPath.join(gameJsPath, 'rpg_managers.js');
        }

        try {
            if (!fse.existsSync(managersFile)) return null;
            var content = fse.readFileSync(managersFile, 'utf8');
            return this._detectParamsInContent(content, true);
        } catch (e) {
            console.warn("RMMZDataCrypto: failed to detect params", e);
            return null;
        }
    },

    _detectParamsInContent: function(content, verbose) {
        var lines = content.split('\n');
        var targetLine = '';
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('onXhrLoad') >= 0 && lines[i].indexOf('JSON.parse') >= 0) {
                targetLine = lines[i].trim();
                break;
            }
            if (lines[i].indexOf('loadDataFile') >= 0 && lines[i].indexOf('JSON.parse') >= 0 && lines[i].length > 1000) {
                targetLine = lines[i].trim();
                break;
            }
        }
        if (!targetLine) return null;

        var wasmParams = this._detectWasmParams(targetLine);
        if (wasmParams) {
            if (verbose) console.log("RMMZDataCrypto: detected WASM params", wasmParams);
            return wasmParams;
        }

        var xorParams = this._detectXorParams(targetLine);
        if (xorParams) {
            if (verbose) console.log("RMMZDataCrypto: detected XOR params", xorParams);
            return xorParams;
        }

        return null;
    },

    detectParams: async function(gameJsPath, engineType) {
        var managersFile;
        if (engineType === 'rmmz') {
            managersFile = nwPath.join(gameJsPath, 'rmmz_managers.js');
        } else {
            managersFile = nwPath.join(gameJsPath, 'rpg_managers.js');
        }

        if (!await common.isFileAsync(managersFile)) return null;

        try {
            var content = await common.fileGetContents(managersFile, 'utf8');
            return this._detectParamsInContent(content, true);
        } catch (e) {
            console.warn("RMMZDataCrypto: failed to detect params", e);
            return null;
        }
    },

    _detectXorParams: function(targetLine) {
        if (targetLine.indexOf('Math.sqrt') < 0) return null;

        var params = { algorithm: 'xor' };

        var sqrtMatch = targetLine.match(/Math\.sqrt\((\d+)\)/);
        if (sqrtMatch) params.K = Math.sqrt(parseInt(sqrtMatch[1])) | 0;

        var pMatch = targetLine.match(/\(ls<<(\d+)\)\|\(ls>>>(\d+)\)/);
        if (pMatch) {
            params.shiftL = parseInt(pMatch[1]);
            params.shiftR = parseInt(pMatch[2]);
        }

        var cMatch = targetLine.match(/\(fk\|(\d+)\)&~\(fk&\d+\)/);
        if (cMatch) params.cXor = parseInt(cMatch[1]);

        var kXorMatch = targetLine.match(/\(\(_c\+_m\+_p\)\|(\d+)\)&~/);
        if (kXorMatch) params.kXor = parseInt(kXorMatch[1]);

        var kAddMatch = targetLine.match(/\)\+(\d+)\)&255/);
        if (kAddMatch) params.kAdd = parseInt(kAddMatch[1]);

        params.lowerName = targetLine.indexOf('.toLowerCase()') >= 0;

        if (params.K !== undefined && params.cXor !== undefined &&
            params.shiftL !== undefined && params.shiftR !== undefined &&
            params.kXor !== undefined && params.kAdd !== undefined) {
            return params;
        }

        return null;
    },

    _detectWasmParams: function(targetLine) {
        if (targetLine.indexOf('WebAssembly') < 0 && targetLine.indexOf('rmmz_core.dat') < 0) return null;

        var params = { algorithm: 'wasm' };

        var xorMatch = targetLine.match(/var fk\s*=\s*\((\d+)\s*\^\s*\(t\s*&\s*255\)\)/);
        if (xorMatch) {
            params.xorConstant = parseInt(xorMatch[1]);
        } else {
            return null;
        }

        params.lowerName = targetLine.indexOf('.toLowerCase()') >= 0;

        return params;
    },

    _hashFilename: function(src, params) {
        var n = src.split(/[\\/]/).pop().replace('.json', '');
        if (params.lowerName) n = n.toLowerCase();
        var t = 0;
        for (var i = 0; i < n.length; i++) {
            t = ((t << 5) - t + n.charCodeAt(i)) | 0;
        }
        return t;
    },

    isEncrypted: function(obj) {
        return !!(obj && typeof obj === 'object' && obj.uid && obj.bid && obj.data && typeof obj.data === 'string');
    },

    decrypt: function(jsonObj, src, params) {
        if (!this.isEncrypted(jsonObj)) return jsonObj;

        var v = params || this._getFallbackVariant(jsonObj.bid);
        var algo = v.algorithm || 'xor';

        if (algo === 'wasm') {
            return this._decryptWasm(jsonObj, src, v);
        }

        var b = Buffer.from(jsonObj.data, 'base64');
        var t = this._hashFilename(src, v);
        var fk = v.K ^ (t & 255);
        var ls = fk;

        for (var i = b.length - 1; i >= 0; i--) {
            var _c = fk ^ v.cXor;
            var _m = (i % 128);
            var _p = (ls << v.shiftL) ^ (ls >>> v.shiftR);
            var _k = (((_c + _m + _p) ^ v.kXor) + v.kAdd) & 255;
            var dec = b[i] ^ _k;
            b[i] = dec;
            ls = dec;
        }

        return JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));
    },

    _decryptWasm: function(jsonObj, src, v) {
        var b = Buffer.from(jsonObj.data, 'base64');
        var t = this._hashFilename(src, v);
        var fk = (v.xorConstant ^ (t & 255)) & 255;
        var v5 = 0x3480, v6 = fk;

        for (var i = b.length - 1; i >= 0; i--) {
            v5 = (Math.imul(v5, 0x19DD19) + 0x570E02F4) | 0;
            v5 = v5 ^ i;
            var prng = (v5 ^ (v5 >>> 16)) | 0;
            var keySum = ((fk ^ 0x44) + (i & 0x7F)) | 0;
            var rot = (((v6 << 3) & 0xF8) ^ ((v6 & 0xF8) >>> 3)) | 0;
            var mask = (prng + (((keySum + rot) | 0) ^ 0x76) + 0x1A) | 0;
            var result = (b[i] ^ mask) & 0xFF;
            b[i] = result;
            v6 = result;
            if (i % 13 === 0) fk = (fk ^ 0x44) | 0;
        }

        return JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));
    },

    encrypt: function(data, src, bid, params) {
        var v = params || this._getFallbackVariant(bid);
        var algo = v.algorithm || 'xor';
        var jsonStr = typeof data === 'string' ? data : JSON.stringify(data);

        if (algo === 'wasm') {
            return this._encryptWasm(jsonStr, src, bid, v);
        }

        var b = Buffer.from(jsonStr, 'utf8');

        var t = this._hashFilename(src, v);
        var fk = v.K ^ (t & 255);
        var ls = fk;

        for (var i = b.length - 1; i >= 0; i--) {
            var _c = fk ^ v.cXor;
            var _m = (i % 128);
            var _p = (ls << v.shiftL) ^ (ls >>> v.shiftR);
            var _k = (((_c + _m + _p) ^ v.kXor) + v.kAdd) & 255;
            var plaintext = b[i];
            b[i] = plaintext ^ _k;
            ls = plaintext;
        }

        var uid = '';
        var hex = '0123456789abcdef';
        for (var i = 0; i < 8; i++) uid += hex.charAt(Math.floor(Math.random() * 16));

        return {
            uid: uid,
            bid: bid || "1.9.0",
            data: b.toString('base64')
        };
    },

    _encryptWasm: function(jsonStr, src, bid, v) {
        var b = Buffer.from(jsonStr, 'utf8');
        var t = this._hashFilename(src, v);
        var fk = (v.xorConstant ^ (t & 255)) & 255;
        var v5 = 0x3480, v6 = fk;

        for (var i = b.length - 1; i >= 0; i--) {
            v5 = (Math.imul(v5, 0x19DD19) + 0x570E02F4) | 0;
            v5 = v5 ^ i;
            var prng = (v5 ^ (v5 >>> 16)) | 0;
            var keySum = ((fk ^ 0x44) + (i & 0x7F)) | 0;
            var rot = (((v6 << 3) & 0xF8) ^ ((v6 & 0xF8) >>> 3)) | 0;
            var mask = (prng + (((keySum + rot) | 0) ^ 0x76) + 0x1A) | 0;
            var plaintext = b[i];
            b[i] = (plaintext ^ mask) & 0xFF;
            v6 = plaintext;
            if (i % 13 === 0) fk = (fk ^ 0x44) | 0;
        }

        var uid = '';
        var hex = '0123456789abcdef';
        for (var i = 0; i < 8; i++) uid += hex.charAt(Math.floor(Math.random() * 16));

        return {
            uid: uid,
            bid: bid || "1.10.0",
            data: b.toString('base64')
        };
    }
};
thisAddon.RMMZDataCrypto = RMMZDataCrypto;



var RMMVGames = function(gameFile, options) {
    this.gameFile         = gameFile;
    this.options         = options || {};
    this.options.files  = this.options.files || [];
    this.isExtracted     = false;
    this.init();
}

RMMVGames.lastAttachments = {};

RMMVGames.prototype.init = function() {
    this.gameFile = this.gameFile.replaceAll("\\", "/");
    this.dirname = nwPath.dirname(this.gameFile);
}

RMMVGames.prototype.processThispath = function(relPath) {
    if (!(this.options)) return true;
    console.log("processThispath :", relPath, this.options.files);
    if (empty(this.options.files)) return true;

    if (this.options.files.includes(relPath)) return true;

    return false;
}

RMMVGames.determineEngine = async function(gameDir) {
    if (await common.isFileAsync(nwPath.join(gameDir, "js/rmmz_core.js"))) return "rmmz";
    if (await common.isFileAsync(nwPath.join(gameDir, "www/js/rmmz_core.js"))) return "rmmz";
    if (await common.isFileAsync(nwPath.join(gameDir, "js/rpg_core.js"))) return "rmmv";
    if (await common.isFileAsync(nwPath.join(gameDir, "www/js/rpg_core.js"))) return "rmmv";
    
}

RMMVGames.prototype.determineEngine = async function() {
    return await RMMVGames.determineEngine(this.dirname);
}

RMMVGames.determineRootDir = async function(gameDir) {
    if (await common.isDirectory(gameDir) == false) return console.warn(gameDir, "is not a valid directory");
    var confirmedPath = gameDir;

    if(await common.isFileAsync(nwPath.join(gameDir, "www/data/System.json"))) {
        confirmedPath = nwPath.join(gameDir, "www");
        return confirmedPath;
    } else if (await common.isFileAsync(nwPath.join(gameDir, "data/System.json"))) {
        return confirmedPath;
    }

    return console.warn("Invalid RMMV / RMMZ path "+gameDir);
}

RMMVGames.prototype.determineGameRootDir = async function() {
    this.gameRoot = this.dirname;
    this.gameDataPath = nwPath.join(this.dirname, "data");
    this.gameJsPath = nwPath.join(this.dirname, "js");
    if(await common.isFileAsync(nwPath.join(this.dirname, "www/data/System.json"))) {
        this.gameRoot = nwPath.join(this.dirname, "www");
        this.gameDataPath = nwPath.join(this.dirname, "www/data");
        this.gameJsPath = nwPath.join(this.dirname, "www/js");
    }
}

/**
 * SLR Translator's own font collection folder. Font files placed here can
 * be referenced by fonts/gamefont.css of RPG Maker MV games: when the
 * GameFont entry is changed to a font of this folder, the file is
 * automatically shipped with the export.
 * @returns {String} Absolute path of the font collection folder
 */
RMMVGames.getUserFontDir = function() {
    return nwPath.join(nw.process.cwd(), "fonts");
}

/**
 * Make sure SLR Translator's font collection folder exists and return it.
 * @returns {Promise<String>} Absolute path of the font collection folder
 */
RMMVGames.ensureUserFontDir = async function() {
    var fontDir = RMMVGames.getUserFontDir();
    try {
        if (await common.isDirectory(fontDir) == false) await common.mkDir(fontDir);
    } catch (e) {
        console.warn("Unable to create the font collection folder", fontDir, e);
    }
    return fontDir;
}

/**
 * Find a file directly inside a folder, ignoring case differences.
 * @param {String} dir - Folder to search in
 * @param {String} fileName - Wanted file name
 * @returns {Promise<String|Boolean>} Full path when found, false otherwise
 */
RMMVGames.findFileCaseInsensitive = async function(dir, fileName) {
    if (!dir || !fileName) return false;
    try {
        var entries = await fs.promises.readdir(dir);
    } catch (e) {
        return false;
    }
    fileName = fileName.toLowerCase();
    for (var i=0; i<entries.length; i++) {
        if (entries[i].toLowerCase() != fileName) continue;
        var fullPath = nwPath.join(dir, entries[i]);
        if (await common.isFileAsync(fullPath)) return fullPath;
    }
    return false;
}

/**
 * Locate the fonts/gamefont.css of an RPG Maker MV game. The cache of
 * projects created with older versions may not contain the fonts folder
 * yet, so fall back to the original game location.
 * @returns {Promise<String|Boolean>} Absolute path to gamefont.css or false
 */
RMMVGames.prototype.locateGameFontCss = async function() {
    var candidates = [
        nwPath.join(this.gameRoot, "fonts", "gamefont.css")
    ];
    try {
        if (trans.project && trans.project.loc) {
            candidates.push(nwPath.join(trans.project.loc, "www", "fonts", "gamefont.css"));
            candidates.push(nwPath.join(trans.project.loc, "fonts", "gamefont.css"));
        }
    } catch (e) {}

    for (var i=0; i<candidates.length; i++) {
        if (await common.isFileAsync(candidates[i])) return candidates[i];
    }
    return false;
}

/**
 * Parse fonts/gamefont.css (RPG Maker MV) and register the GameFont src
 * url(s) as translatable strings.
 * @param {Object} options - Parser options (writeMode, translationDatas)
 * @returns {Promise<MVGameFontCss|Boolean>} The parser or false when unavailable
 */
RMMVGames.prototype.parseGameFontCss = async function(options) {
    options = options || {};
    var cssPath = await this.locateGameFontCss();
    if (!cssPath) return false;

    var relPath = "fonts/gamefont.css";
    if (this.processThispath(relPath) == false) return false;

    await ui.log("Parsing "+relPath);
    var cssText = await common.fileGetContents(cssPath, "utf8");

    var fileInfo = {
        extension    : "css",
        dataType    : "gamefontcss",
        filename    : "gamefont",
        basename    : "gamefont.css",
        path        : relPath,
        relPath        : relPath,
        dirname        : "/fonts"
    };

    var gameFontParser = new MVGameFontCss(cssText, {fileInfo: fileInfo});
    gameFontParser.fileInfo = fileInfo;
    gameFontParser.isGameFontCss = true;
    gameFontParser.cssPath = cssPath;

    if (options.writeMode) {
        gameFontParser.writeMode = true;
        if (!empty(options.translationDatas)) {
            var translationData = RMMVData.selectTranslationData(options.translationDatas, relPath);
            translationData = translationData || {};
            gameFontParser.translationPair = translationData.translationPair || {};
            gameFontParser.translationInfo = translationData.info || {};
        }
    }

    gameFontParser.parseCss();
    return gameFontParser;
}

/**
 * Look up a font file and copy it into the target fonts folder. The font is
 * searched in SLR Translator's own font collection folder first and then in
 * the cached and original fonts folders of the game (all case insensitive).
 * @param {String} targetFontsDir - Destination fonts folder
 * @param {String} userFontDir - SLR Translator's font collection folder
 * @param {String} fontFile - File name referenced by the game
 * @param {String} label - Name of the changed entry for log messages
 * @returns {Promise<Boolean>} True when the font was copied
 */
RMMVGames.prototype.exportFontFile = async function(targetFontsDir, userFontDir, fontFile, label) {
    if (String(fontFile).replaceAll("\\", "/").includes("/")) {
        await ui.logError(`${label} references "${fontFile}" which points to a sub folder. Only font files placed directly inside a fonts folder can be included automatically.`);
        return false;
    }

    var sourceDirs = [
        userFontDir,
        nwPath.join(this.gameRoot, "fonts")
    ];
    try {
        if (trans.project && trans.project.loc) {
            sourceDirs.push(nwPath.join(trans.project.loc, "www", "fonts"));
            sourceDirs.push(nwPath.join(trans.project.loc, "fonts"));
        }
    } catch (e) {}

    var source = false;
    for (var dirIndex=0; dirIndex<sourceDirs.length; dirIndex++) {
        source = await RMMVGames.findFileCaseInsensitive(sourceDirs[dirIndex], fontFile);
        if (source) break;
    }

    if (!source) {
        await ui.logError(`${label} was changed to "${fontFile}" but this font was not found in SLR Translator's fonts folder (${userFontDir}) nor in the game's fonts folder. Copy the font file there manually, otherwise the game will fall back to a default font.`);
        return false;
    }

    // the fonts folder may not exist yet in the export (e.g. MZ System.json
    // fonts are copied without any gamefont.css being written)
    await common.mkDir(targetFontsDir);
    await common.copyFile(source, nwPath.join(targetFontsDir, fontFile));
    await ui.log(`Font included into the export: ${fontFile}`);
    return true;
}

/**
 * Copy the font files referenced by an exported gamefont.css into the
 * target fonts folder (RPG Maker MV).
 * @param {String} targetFontsDir - Destination fonts folder
 * @param {MVGameFontCss} gameFontParser - Parser of the exported css
 */
RMMVGames.prototype.exportGameFonts = async function(targetFontsDir, gameFontParser) {
    var entries = (gameFontParser && gameFontParser.gameFontEntries) || [];
    if (empty(entries)) return;

    var userFontDir = await RMMVGames.ensureUserFontDir();
    var copied = {}; // dedupe: several entries may reference the same font

    for (var i=0; i<entries.length; i++) {
        var fontFile = entries[i].translated;
        // unchanged entries are already shipped with the game
        if (empty(fontFile) || fontFile == entries[i].original) continue;
        if (copied[String(fontFile).toLowerCase()]) continue;
        copied[String(fontFile).toLowerCase()] = true;
        await this.exportFontFile(targetFontsDir, userFontDir, fontFile, "The GameFont");
    }
}

/**
 * Copy the font files referenced by changed System.json advanced font
 * entries into the target fonts folder (RPG Maker MZ). MZ loads its main
 * and number font through advanced.mainFontFilename / numberFontFilename
 * instead of the fonts/gamefont.css used by MV.
 * @param {String} targetFolder - Destination root folder of the export
 * @param {RMMVData} systemParser - Parser of the exported System.json
 */
RMMVGames.prototype.exportMZSystemFonts = async function(targetFolder, systemParser) {
    var entries = (systemParser && systemParser.mzFontEntries) || [];
    if (empty(entries)) return;

    var targetFontsDir = nwPath.join(targetFolder, "fonts");
    var userFontDir = await RMMVGames.ensureUserFontDir();
    var copied = {}; // dedupe: main and number font usually change together

    for (var i=0; i<entries.length; i++) {
        var fontFile = entries[i].translated;
        // unchanged entries are already shipped with the game
        if (empty(fontFile) || fontFile == entries[i].original) continue;
        if (copied[String(fontFile).toLowerCase()]) continue;
        copied[String(fontFile).toLowerCase()] = true;
        await this.exportFontFile(targetFontsDir, userFontDir, fontFile, `The System.json ${entries[i].key} entry`);
    }
}

RMMVGames.prototype.createCache = async function(id) {
    if (!Boolean(id)) console.error("ID Must be defined");
    if (!this.isExtracted) await this.parse();
    await ui.log("Generating cache");

    var cacheInfo = {
        cacheID: id,
        cachePath: nwPath.join(common.getStagePath(), this.trans.projectId)
    }

    var cacheFolderData = nwPath.join(cacheInfo.cachePath, "data")
    await common.mkDir(cacheFolderData);
    // generate gameInfo.json
    var gameInfo = {
        Title: this.trans.gameTitle,
        title: this.trans.gameTitle
    }
    await common.filePutContents(nwPath.join(cacheInfo.cachePath, "gameInfo.json"), JSON.stringify(gameInfo), "UTF8");

    // copy index.html
    await ui.log("Copying index.html");
    await common.copyFile(nwPath.join(this.gameRoot, "index.html"), cacheFolderData);

    // copy file from current folder into cache
    await ui.log(`Copying data from ${this.gameDataPath} to ${nwPath.join(cacheFolderData, "data")}`);
    await bCopy(this.gameDataPath, nwPath.join(cacheFolderData, "data"));

    // copy plugins.js
    await ui.log("Copying plugins.js");
    var jsPath = nwPath.join(cacheFolderData, "js");
    await common.mkDir(jsPath);
    await common.copyFile(nwPath.join(this.gameJsPath, "plugins.js"), jsPath);

    // copy fonts folder (contains the gamefont.css of RPG Maker MV games)
    var gameFontsPath = nwPath.join(this.gameRoot, "fonts");
    if (await common.isDirectory(gameFontsPath)) {
        await ui.log(`Copying fonts from ${gameFontsPath} to ${nwPath.join(cacheFolderData, "fonts")}`);
        await bCopy(gameFontsPath, nwPath.join(cacheFolderData, "fonts"));
    }

    await ui.log("Generating initial.json");
    this.trans.cache = cacheInfo;
    await common.filePutContents(nwPath.join(cacheInfo.cachePath, "initial.json"), JSON.stringify(this.trans), "UTF8");
    
    return cacheInfo;
}

RMMVGames.prototype.toTrans = async function(parsedData, options) {
    await ui.log("generating trans data");
    if (!this.isExtracted) await this.parse();
    parsedData = parsedData || this.parsed;
    this.trans = {
        projectId        : common.makeid(10),
        cache            : {},
        gameEngine        : await this.determineEngine()||"rmmv",
        gameTitle        : RMMVData.lastGameTitle || "",
        loc                : this.dirname,
        parser            : 'rmmvjs',
        parserVersion    : thisAddon.package.version,
        attachments     : RMMVGames.lastAttachments,
        rmmzCryptoParams: this._rmmzCryptoParams || null,
        files            : {}
    }

    for (var path in parsedData) {
        //var relativePath = RMMVData.getRelativePath(path, this.dirname);
        var relativePath;
        if (parsedData[path].isGameFontCss) {
            // gamefont.css lives next to the data folder, not inside it
            relativePath = parsedData[path].fileInfo.relPath;
        } else {
            relativePath = common.getRelativePathFromNode(path, "/data/", true);
        }
        this.trans.files[relativePath] = {...parsedData[path].transData, ...parsedData[path].fileInfo};
        this.trans.files[relativePath].originalFormat= "RPG MAKER MV RAW DATA";
        this.trans.files[relativePath].lineBreak= "\n";
    }


    this.trans.cache = await this.createCache(this.trans.projectId);

    return this.trans
}

/*
RMMVGames.prototype.processThispath = function(relPath) {
    console.log("Is file processed:", relPath, this.options.files);

    if (!(this.options)) return true;
    if (empty(this.options.files)) return true;

    relPath = relPath.replaceAll("\\", "/");
    if (relPath[0] == "/") relPath = relPath.substr(1);

    if (this.options.files.includes(relPath)) return true;

    return false;
}
*/

RMMVGames.prototype.parse = async function($MV_PATH, options) {
    console.log("Parsing RMMVData with options:", this.options);
    RMMVGames.lastAttachments = {};
    $MV_PATH     = $MV_PATH || this.dirname;
    options     = options || this.options || {};
    options.translationDatas = options.translationDatas || this.options.translationDatas || {};
    await ui.log("Determine root directory of the game");
    await this.determineGameRootDir();
    await ui.log("Root dir is: "+this.gameRoot);
    await ui.log("Parsing data");

    $MV_PATH = this.gameRoot;

    var engineType = await RMMVGames.determineEngine(this.dirname);
    this._rmmzCryptoParams = await RMMZDataCrypto.detectParams(this.gameJsPath, engineType);

    if (!this._rmmzCryptoParams) {
        var origDir = null;
        try { origDir = trans.project.loc; } catch(e) {}
        if (origDir) {
            var origRoot = await RMMVGames.determineRootDir(origDir);
            if (origRoot) {
                var origJsPath = nwPath.join(origRoot, "js");
                this._rmmzCryptoParams = await RMMZDataCrypto.detectParams(origJsPath, engineType);
            }
        }
    }

    if (!this._rmmzCryptoParams && RMMVGames._lastCryptoParams) {
        this._rmmzCryptoParams = RMMVGames._lastCryptoParams;
    }

    if (!this._rmmzCryptoParams) {
        try {
            this._rmmzCryptoParams = trans.project.rmmzCryptoParams || null;
        } catch(e) {}
    }

    if (this._rmmzCryptoParams) {
        RMMVGames._lastCryptoParams = this._rmmzCryptoParams;
    }

    if (empty(this.options.files)) {
        var files = await common.readDir(nwPath.join($MV_PATH, "data"));
    } else {
        var files = [];
        for (var i=0; i<this.options.files.length; i++) {
            files.push(nwPath.join($MV_PATH,this.options.files[i]));
        }
    }


    var $RESULT = {};
    for (var $key in files) {
        var $path                 = files[$key];
        var $fileInfo             = {};
        var relativePath         = RMMVData.getRelativePath($path, $MV_PATH);
        if (this.processThispath(relativePath) == false) continue;

        $fileInfo['extension']     = nwPath.extname($path).toLowerCase().substring(1);
        $fileInfo['dataType']     = RMMVData.determineType($path);
        $fileInfo['filename']     = nwPath.basename($path, nwPath.extname($path));
        $fileInfo['basename']     = nwPath.basename($path);
        $fileInfo['path']         = relativePath;
        $fileInfo['relPath']     = relativePath;
        $fileInfo['dirname']     = "/"+nwPath.dirname(relativePath);

        if ($fileInfo['extension'] !== 'json')    continue;
        //Skip Animations Tilesets and (not) MapInfos
        if ($fileInfo['relPath']  === 'data/Animations.json')    continue;
        if ($fileInfo['relPath']  === 'data/Tilesets.json')    continue;
        //if ($fileInfo['relPath']  === 'data/MapInfos.json')    continue;

        console.log("File info:", $fileInfo);
        var content = await common.fileGetContents($path, "utf8");
        if (!common.isJSON(content)) continue;
        var $currentData = JSON.parse(content);
        var _rmmzEncrypted = RMMZDataCrypto.isEncrypted($currentData);
        var _rmmzBid = $currentData ? $currentData.bid : null;
        if (_rmmzEncrypted) {
            try {
                $currentData = RMMZDataCrypto.decrypt($currentData, $fileInfo['basename'], this._rmmzCryptoParams);
                console.log("RMMZ data decrypted:", $fileInfo['basename']);
            } catch (e) {
                console.warn("Failed to decrypt RMMZ data:", $fileInfo['basename'], e);
                continue;
            }
        }
        if (empty($currentData)) continue;
        // Export (write mode) only consumes the translated values — skip the
        // translation-table accumulators, which on a huge file cost hundreds
        // of MB of heap (renderer V8 OOM crash when exporting big games).
        var rmmvDataOptions = {fileInfo: $fileInfo};
        if (options.writeMode) rmmvDataOptions.disableAccumulators = true;
        var rmmvData = new RMMVData($currentData, rmmvDataOptions);
        rmmvData._rmmzEncrypted = _rmmzEncrypted;
        rmmvData._rmmzBid = _rmmzBid;

        console.log("%c Relative path is : "+relativePath, 'background: yellow; color: #111');
        rmmvData.fileInfo = $fileInfo;

        await ui.log("Parsing "+relativePath);
        
        var thisFetch;

        //rmmvData.data = $currentData;
        if (options.writeMode) {
            rmmvData.writeMode = true;
            // No deep clone here: every data type handler below replaces
            // writableObj with its own translated object (fetchCommonData /
            // fetchSystem / fetchFromOtherJson / map / commonevents / troops)
            // before the write loop runs. Cloning a large file (a 26MB
            // CommonEvents.json is ~500MB in memory) just to throw the clone
            // away doubles the renderer heap and crashes V8 (OOM) on big games.
            rmmvData.writableObj = $currentData;
            if (!empty(options.translationDatas)) {
                var translationData = RMMVData.selectTranslationData(options.translationDatas, relativePath);
                console.log("Translation Data:", translationData);
                translationData = translationData || {};
                rmmvData.translationPair = translationData.translationPair || {};
                rmmvData.translationInfo = translationData.info || {};
            }
        }

        switch ($fileInfo['dataType']) {
            case "items":
            case "armors":
            case "weapons":
                thisFetch = rmmvData.fetchCommonData($currentData, ["name", "description", "note"], [$fileInfo['filename']]);
                $RESULT[$path] = thisFetch;
                break;
            case "skills":
                thisFetch = rmmvData.fetchCommonData($currentData, ["name", "description", "message1", "message2", "note"], [$fileInfo['filename']]);
                $RESULT[$path] = thisFetch;
                break;
            case "states":
                //thisFetch = rmmvData.fetchCommonData($currentData, ["name", "message1", "message2", "message3", "message4", "note"], [$fileInfo['filename']]);
                thisFetch = rmmvData.fetchCommonData($currentData, ["message1", "message2", "message3", "message4", "name", "note"], [$fileInfo['filename']]);
                $RESULT[$path] = thisFetch;
                break;
            case "classes":
            case "enemies":
                thisFetch = rmmvData.fetchCommonData($currentData,["name", "note"], [$fileInfo['filename']]);
                $RESULT[$path] = thisFetch;
                break;
            //Skip Animations (not)MapInfos and Tilesets
/*             case "tilesets":
                thisFetch = rmmvData.fetchCommonData($currentData,["name", "note"], [$fileInfo['filename']]);
                $RESULT[$path] = thisFetch;
                break;
            case "animations": */
            case "mapinfos":
                thisFetch = rmmvData.fetchCommonData($currentData, ["name"], [$fileInfo['filename']]);
                $RESULT[$path] = thisFetch;
                break;
            case "actors":
                thisFetch = rmmvData.fetchCommonData($currentData, ["name", "nickname", "note", "profile"], [$fileInfo['filename']]);
                $RESULT[$path] = thisFetch;
                break;
            case "map":
                thisFetch = {};
                $newData = {};
                // fetch map name
                rmmvData.registerStringObject($currentData, 'displayName', [$fileInfo.filename, "displayName"], [], {currentAddress:["displayName"]})

                // fetch map note
                rmmvData.registerStringObject($currentData, 'note', [$fileInfo.filename, "note"], [], {currentAddress:["note"]})

                
                if ($currentData['events'].length>1) {
                    for (var $eIndex=1; $eIndex<$currentData['events'].length; $eIndex++) {
                        if (empty($currentData['events'][$eIndex])) continue;
                        // fetch event name
                        //rmmvData.registerString($currentData['events'][$eIndex]['name'], [$fileInfo.filename, "events", $eIndex, "name"], [], {currentAddress : ["events", $eIndex, "name"]})
                        //rmmvData.registerStringObject($currentData['events'][$eIndex], 'name', [$fileInfo.filename, "events", $eIndex, "name"], [], {currentAddress : ["events", $eIndex, "name"]})
                        // fetch event note
                        //rmmvData.registerString($currentData['events'][$eIndex]['note'], [$fileInfo.filename, "events", $eIndex, "note"], [], {currentAddress : ["events", $eIndex, "note"]})
                        rmmvData.registerStringObject($currentData['events'][$eIndex], 'note', [$fileInfo.filename, "events", $eIndex, "note"], [], {currentAddress : ["events", $eIndex, "note"]})
                        // fetch event pages content
                        var eventPage = await rmmvData.fetchEventPages($currentData['events'][$eIndex]['pages'], [$fileInfo.filename, "events", $eIndex, "pages"], thisFetch, {currentAddress:["events", $eIndex, "pages"]});    
                        //if (options.writeMode) rmmvData.writableObj['events'][$eIndex]['pages'] = eventPage;
                        if (options.writeMode) $currentData['events'][$eIndex]['pages'] = eventPage;
                    }
                }

                // writableObj is same with $currentData
                rmmvData.writableObj = $currentData;
                $RESULT[$path] = rmmvData;
                break;
            case "troops":
                if ($currentData.length<2) break;
                if (empty($currentData)) continue;

                rmmvData.fetchCommonData($currentData, ["name"], [$fileInfo['filename']]);
            
                for (var $eIndex=1; $eIndex < $currentData.length; $eIndex++) {
                    if (empty($currentData[$eIndex]['pages'])) continue;
                    // fetch event pages content
                    var eventPage = await rmmvData.fetchEventPages($currentData[$eIndex]['pages'], [$fileInfo.filename, $eIndex, "pages"], thisFetch, {currentAddress:[$eIndex, "pages"]});    
                    if (options.writeMode) rmmvData.writableObj[$eIndex]['pages'] = eventPage;

                }
                
                $RESULT[$path] = rmmvData;
                break;
            case "commonevents":
                if ($currentData.length<2) break;
                if (empty($currentData)) continue;

                // fetch name manually
                //for ($eIndex=1; $eIndex<$currentData.length; $eIndex++) {
                //    if (empty($currentData[$eIndex])) continue;
                    //if (empty($currentData[$eIndex]['name'])) continue;

                    //rmmvData.registerString($currentData[$eIndex]['name'], [$fileInfo.filename, $eIndex, "name"], [], {currentAddress:[$eIndex, "name"]})
                    //rmmvData.registerStringObject($currentData[$eIndex], 'name', [$fileInfo.filename, $eIndex, "name"], [], {currentAddress:[$eIndex, "name"]})

                //}

                // the entire common events are a single event pages
                var eventPage = await rmmvData.fetchEventPages($currentData, [$fileInfo.filename], thisFetch, {currentAddress:[]});    
                if (options.writeMode) rmmvData.writableObj = eventPage;

                $RESULT[$path] = rmmvData;
                break;
            case "system":
                $RESULT[$path] = rmmvData.fetchSystem($currentData, [$fileInfo.filename]);
            
                break;
            default:
                $RESULT[$path] = rmmvData.fetchFromOtherJson($currentData, [$fileInfo.filename]);

                break;
        }

    }    

    // RPG Maker MV: collect fonts/gamefont.css so the GameFont entry can be
    // edited and exported (MZ games change their font via System.json instead)
    // Engine priority: explicit option (export flows) > engine detected from
    // THIS game's files (new projects; trans.project may still hold an
    // unrelated, previously opened project) > current project (cache exports
    // where the game's js folder is not available)
    var fontEngine = options.engineType || engineType;
    if (!fontEngine) { try { fontEngine = trans.project.gameEngine; } catch (e) {} }
    if (fontEngine == "rmmv") {
        var gameFontParser = await this.parseGameFontCss(options);
        if (gameFontParser) $RESULT[gameFontParser.cssPath] = gameFontParser;
    }

    //return  this.normalizeMVData($RESULT);
    this.isExtracted = true;
    this.parsed = $RESULT;    
    console.log("RMMVGame parsed result", this);
    return $RESULT;
}

RMMVGames.prototype.newProject = async function() {
    console.log("RMMVGames.prototype.newProject");
    ui.showLoading();
    ui.loadingProgress("Processing", "Creating a new RMMV/RMMZ project.", {consoleOnly:false, mode:'consoleOutput'});
    await ui.log("RMMVJS Parser version : "+thisAddon.package.version);
    await ui.log("Creating project from "+this.dirname);
    await ui.log("Entry point is: "+this.gameFile);

    try {
        var transData = await this.toTrans();
        console.log("Generated transData:", transData);
        trans._pendingPluginLoad = true;
        trans.openFromTransObj({project:transData}, {isNew:true});
        trans.one("projectCreated", async ()=> {
            await loadPlugins();
        })
    } catch (e) {
        console.error(e);
        ui.logError("Error occured! Please see console window(F12) for more information", e.toString());
    }

    //ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
    //ui.loadingEnd();
    console.log("RMMVGames", this);
}

RMMVGames.prototype.exportToFolder = async function(targetFolder, options) {
    console.log("RMMVGames.prototype.exportToFolder options:", options);
    if (options.translationDatas) console.log("Translation Datas already assigned");
    options                         = options || this.options || {};
    if (empty(options.translationDatas)) {
        // Build the translation pairs first and release the save data right
        // away: keeping a full getSaveData() clone of the project alive on
        // options.transData for the whole export adds ~1GB of heap on large
        // games and crashes the renderer (V8 OOM) when parsing big files.
        var exportSaveData = options.transData || trans.getSaveData(empty(options.files) ? {} : {filter: options.files});
        options.translationDatas = trans.getTranslationData(exportSaveData, {filterTag:options.filterTag, filterTagMode:options.filterTagMode, files:options.files});
        exportSaveData = null;
    }
    this.options.translationDatas     = options.translationDatas || this.options.translationDatas || {};
    this.options.writeMode             = true;

    try {
        console.log("export to folder with options:", options);
        await common.mkDir(targetFolder);
        await this.parse(undefined);

        console.log("----Parsed result", this);
        for (var path in this.parsed) {
            var newFile = nwPath.join(targetFolder, this.parsed[path].fileInfo.relPath);
            //await ui.log("Creating directory if not exist:", nwPath.dirname(newFile));
            await common.mkDir(nwPath.dirname(newFile));
            await ui.log("Writing file :", newFile);

            if (this.parsed[path].isGameFontCss) {
                // write the gamefont.css with the translated GameFont entry
                await common.filePutContents(newFile, this.parsed[path].getText(), 'UTF-8', common.getOpenedFileBom(this.parsed[path].cssPath) === true);
                // ship matching font files along with the css
                await this.exportGameFonts(nwPath.dirname(newFile), this.parsed[path]);
                continue;
            }

            if (!this.parsed[path].writableObj) continue;
            var outputData = this.parsed[path].writableObj;
            if (this.parsed[path]._rmmzEncrypted) {
                var fileName = nwPath.basename(newFile);
                outputData = RMMZDataCrypto.encrypt(outputData, fileName, this.parsed[path]._rmmzBid, this._rmmzCryptoParams);
                await common.filePutContents(newFile, JSON.stringify(outputData), 'UTF-8', false);
            } else {
                // stream the JSON to disk instead of building one huge
                // JSON.stringify string — on very large data files the full
                // string plus stringify's transient parts were enough to
                // exhaust the renderer's V8 heap (OOM crash on export)
                await common.writeJSONStream(newFile, outputData, {
                    indent: thisAddon.config.beautifyJSON ? 2 : undefined,
                    encoding: 'UTF-8',
                    bom: false
                });
            }

            // RPG Maker MZ: ship matching font files when a System.json
            // advanced font entry (mainFontFilename/numberFontFilename) was
            // changed (entries list stays empty for MV games)
            if (!empty(this.parsed[path].mzFontEntries)) {
                await this.exportMZSystemFonts(targetFolder, this.parsed[path]);
            }
        }
    } catch (e) {
        console.error(e);
        ui.logError("Error occured! Please see console window(F12) for more information", e.toString());
    }
}


thisAddon.RMMVGames = RMMVGames;



/**
 * @param  {} rootDir
 * rootDir is the place where index.html resides
 * @param  {} options
 */
var RMMV = function(rootDir, options) {
    this.rootDir         = rootDir;
    this.options        = options || {};
    this.options.pluginPath    = this.options.pluginPath || "js/plugins/";
    this.options.translationDatas = this.options.translationDatas || {}
    this.options.files        = this.options.files || [];
}

RMMV.prototype.processThispath = function(relPath) {
    console.log("Is file processed:", relPath, this.options.files);

    if (!(this.options)) return true;
    if (empty(this.options.files)) return true;

    relPath = relPath.replaceAll("\\", "/");
    if (relPath[0] == "/") relPath = relPath.substr(1);

    if (this.options.files.includes(relPath)) return true;

    return false;
}

// utils
RMMV.getExe = async function(dir) {
    var list = await common.getAllExt(dir, "exe");
    var blacklist = ["notification_helper"]
    for (var i in list) {
        if (blacklist.includes(list[i])) continue;
        return list[i];
    }
    return false;
}

/**
 * load data relative to rootDir
 * data will be stored to files
 * @param  {} files
 */
RMMV.prototype.load = async function(files) {
    this.files = this.files || {};
    if (Array.isArray(files) == false) files = [files];

    var output = {};
    for (var i in files) {
        var fullPath = nwPath.join(this.rootDir, files[i]);
        if (!await common.isFileAsync(fullPath)) continue;
        try {
            var raw = await common.fileGetContents(fullPath);
            this.files[files] = JSON.parse(raw);
            output[files] = this.files[files];
        } catch (e) {
            console.warn(e)
        }

    }
    return output;
}

/**
 * Parse JSON content of plugins.js
 * plugins.js itself is a js file not a json file
 * so we need to get anything between the first "[" to the last "]"
 * @param  {String} pluginContent - Content of plugins.js
 */
RMMV.getParsedPluginContent = function(pluginContent) {
    var start = pluginContent.indexOf("[");
    var end = pluginContent.lastIndexOf("]");
    var trimmed = pluginContent.substring(start, end+1);        

    try {
        this.plugins = JSON.parse(trimmed);
    } catch(e) {
        console.warn("error when parsing plugin script");
    }
    return this.plugins;
}

RMMV.prototype.parsePluginList = async function(options) {
    console.log("opening", nwPath.join(this.rootDir, "js/plugins.js"));
    try {
        var pluginContent = await common.fileGetContents(nwPath.join(this.rootDir, "js/plugins.js"));

    } catch (e) {
        console.warn(e);
        return;
    }
    var start = pluginContent.indexOf("[");
    var end = pluginContent.lastIndexOf("]");
    var trimmed = pluginContent.substring(start, end+1); 
    {
    trimmed = trimmed.replaceAll(/(["'`][\-]?\d+)(["'`])/g,"$1$2");    
    }

    try {
        this.plugins = JSON.parse(trimmed);
    } catch(e) {
        console.warn("error when parsing plugin script");
    }
    return this.plugins;
}

/**
 * Dump untranslated plugins to directory
 * @param  {} dir
 */
RMMV.prototype.dumpPluginsToDir = async function(dir) {
    if (!Boolean(dir)) throw "first argument (dir) is blank"
    if (!Boolean(this.plugins)) await this.parsePlugins();
    await common.mkDir(dir);
    for (var file in this.pluginData) {
        var targetPath = nwPath.join(dir, file);
        await bCopy(this.pluginData[file].file, targetPath);
    }
    console.log("Copying pluginlist");
    var pluginList = nwPath.join(this.rootDir, "js/plugins.js");
    await bCopy(pluginList, nwPath.join(dir, "js/plugins.js"));
}

RMMV.prototype.writePluginListTo = async function(targetPath) {
    console.log("writePluginListTo", targetPath);
    var win = nw.Window.get();
    nw.appSuffix = nw.appSuffix||"";
    var suffix = "";
    if (nw.appSuffix) {
        suffix = " "+nw.appSuffix;
    }
    let slrversion = nw.App.manifest.version+suffix;
    var translatedStr = `// This file was generated using SLR Translator\n// v` + slrversion + `\nvar $plugins =\n`+this.pluginListObj.toString()+";";
    console.log("Writing", targetPath);
    await common.mkDir(nwPath.dirname(targetPath));
    await common.writeFile(targetPath, translatedStr);
    console.log("Written:", targetPath);
}

RMMV.prototype.exportPluginsToFolder = async function(dir) {
    if (!Boolean(dir)) throw "first argument (dir) is blank"
    if (!Boolean(this.plugins)) await this.parsePlugins();
    await common.mkDir(dir);    
    for (var file in this.pluginData) {
        var targetPath = nwPath.join(dir, file);
        await ui.log("exporting "+targetPath);
        await this.pluginData[file].writeTo(targetPath);
    }
    await ui.log("exporting plugins.js");
    try {
        if (this.processThispath("js/plugins.js")) await this.writePluginListTo(nwPath.join(dir, "js/plugins.js"))
    } catch (e) {
        console.warn("failed to write plugin list", e);
    }
    console.log("exporting plugin list done");
}

RMMV.prototype.selectTranslationData = function(path) {
    // must match trans.project.files[thefile].path
    var newPath = "/"+path;
    newPath = newPath.replace(/\\/g, "/");
    console.log("===================");
    console.log("selecting translation from ", path);
    console.log(this.options.translationDatas[newPath]);
    console.log("===================");
    return this.options.translationDatas[newPath];
    
}

RMMV.prototype.parsePlugins = async function(options) {
    var options = options || this.options || {};
    options.baseDir = options.baseDir || this.rootDir;

    // parse plugins
    if (!Boolean(this.plugins)) await this.parsePluginList(options);
    this.pluginData = {};

    console.log("Plugins : ", this.plugins);
    var pluginFiles = [];
    for (var i in this.plugins) {
        var thisPath     = nwPath.join(this.rootDir, this.options.pluginPath, this.plugins[i].name+".js");
        var pluginPath     = nwPath.join(this.options.pluginPath, this.plugins[i].name+".js");
        pluginPath         = pluginPath.replaceAll("\\", "/");
        if (this.processThispath(pluginPath) == false) continue;
        pluginFiles.push({pluginPath:pluginPath, thisPath:thisPath});
    }
    for (var i=0; i<pluginFiles.length; i++) {
        var thisPath     = pluginFiles[i].thisPath;
        var pluginPath     = pluginFiles[i].pluginPath;

        ui.log("parsing "+ thisPath);
        ui.loadingProgress(Math.round((i / pluginFiles.length) * 100));
        if (await common.isFileAsync(thisPath) == false) continue;

        this.pluginData[pluginPath] = new ESFile(thisPath, options);
        await this.pluginData[pluginPath].init();
        //this.pluginData[pluginPath].setTranslationData(this.selectTranslationData(pluginPath));
        this.pluginData[pluginPath].esScript.assignTranslationPair(pluginPath);
        await this.pluginData[pluginPath].toTrans();
    }
    if (this.processThispath("js/plugins.js")) await this.parsePluginListToTrans(options);
    return this;
}

RMMV.prototype.parsePluginListToTrans = async function(options) {
    var options = options || this.options || {};
    var thisRelPath = "js/plugins.js";

    if (!Boolean(this.plugins)) await this.parsePluginList(options);
    console.log(">>parsePluginListToTrans -> options:", options);
    ui.log("Parsing plugins.js");
    this.options.translationDatas     = this.options.translationDatas || {};

    this.pluginListObj                 = new JSONTranslate(this.plugins, {beautifyOutput:true});
    this.pluginListObj.assignTranslationPair("js/plugins.js", this.options.translationDatas);
    this.pluginListObj.filter = function(string, context) {
        //var contextString = newContext.join("/");
        if (context.includes("parameters") == false) return false;
        return true;
    }

    await this.pluginListObj.parse();
    this.pluginListTrans             = this.pluginListObj.transData;
    this.pluginListTrans.basename     = nwPath.basename(thisRelPath);
    this.pluginListTrans.filename     = nwPath.basename(thisRelPath);
    this.pluginListTrans.extension     = nwPath.extname(thisRelPath);
    this.pluginListTrans.dirname     = nwPath.dirname(thisRelPath);
    this.pluginListTrans.path        = thisRelPath;
    this.pluginListTrans.tags        = [];
    this.pluginListTrans.lineBreak  = "\n";
}

RMMV.prototype.pluginsToTrans = async function(transData) {
    transData = transData || trans;
    transData.project = transData.project || {};
    transData.project.files = transData.project.files || {};
    if (Boolean(this.pluginData) == false) await this.parsePlugins();
    for (var path in this.pluginData) {
        var nPath = path.replace(/\\/g, "/");
        transData.project.files[nPath] = this.pluginData[path].trans;
    }

    transData.project.files["js/plugins.js"] = this.pluginListTrans;
    return transData;
}

window.RMMV = RMMV;




var RMMVDecrypter = function(rootDir, options) {
    this.rootDir         = rootDir;
    this.options         = options;
}

RMMVDecrypter.prototype.loadData = async function(file) {
    this.files = this.files || {};

    var fullPath = nwPath.join(this.rootDir, file);
    if (!await common.isFileAsync(fullPath)) return;
    try {
        var raw = await common.fileGetContents(fullPath);
        return JSON.parse(raw);
    } catch(e) {
        console.warn(e);
    }

}

RMMVDecrypter.prototype.loadSystem = async function() {
    try {
        this.system = await this.loadData("data/System.json");
        RMMVDecrypter.Decrypter.rawEncriptionKey = this.system.encryptionKey;
    } catch (e) {
        alert("Error loading system.json"+e.toString());
    }
}

RMMVDecrypter.prototype.getRelativePath = function(path) {
    return path.substring(this.rootDir.length);
}

RMMVDecrypter.prototype.decryptAll = async function(targetDir) {
    targetDir = targetDir || this.rootDir;
    var possibleExt = [
        ".rpgmvo", ".rpgmvm", ".rpgmvp", //mv
        ".png_", ".ogg_", ".m4a_" //mz
    ];
    if (!this.isInitialized) await this.init();

    var maxItem = 0;
    for (var i in this.dirContent) {
        if (!possibleExt.includes(nwPath.extname(this.dirContent[i]).toLowerCase())) continue;
        maxItem++
    }
    console.log("maxItem", maxItem);
    await ui.log(`${maxItem} items found!`);

    var x = 0;
    for (var i in this.dirContent) {
        if (!possibleExt.includes(nwPath.extname(this.dirContent[i]).toLowerCase())) continue;
        var newPath = RMMVDecrypter.Decrypter.extToDecryptExt(nwPath.join(targetDir, this.getRelativePath(this.dirContent[i])));
        console.log("Decrypting", this.dirContent[i], "into", newPath);
        try {
            await common.mkDir(nwPath.dirname(newPath));
        } catch (e) {}

        await ui.loadingProgress(Math.round((x/maxItem)*100));
        await ui.log(`Decrypting: ${this.dirContent[i]}`);
        await RMMVDecrypter.Decrypter.decrypt(this.dirContent[i], newPath);
        x++;
    }
    await ui.log(`All done!`);
    ui.loadingEnd();
}

RMMVDecrypter.prototype.init = async function() {
    await this.loadSystem();
    this.dirContent = await common.readDir(this.rootDir);
    this.isInitialized = true;
}


function Decrypter() {
    throw new Error('This is a static class');
}

Decrypter.rawEncriptionKey = ""; // get from System.encryptionKey
Decrypter.hasEncryptedImages = false;
Decrypter.hasEncryptedAudio = false;
Decrypter._requestImgFile = [];
Decrypter._headerlength = 16;
Decrypter._xhrOk = 400;
Decrypter._encryptionKey = "";
Decrypter._ignoreList = [
    "img/system/Window.png"
];
Decrypter.SIGNATURE = "5250474d56000000";
Decrypter.VER = "000301";
Decrypter.REMAIN = "0000000000";

Decrypter.checkImgIgnore = function(url){
    for(var cnt = 0; cnt < this._ignoreList.length; cnt++) {
        if(url === this._ignoreList[cnt]) return true;
    }
    return false;
};

Decrypter.decrypt = async function(path, targetPath) {
    return new Promise((resolve, reject) => {
        console.log(path);
        fs.readFile(path, async (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            //console.log("data", data);
            var arrayBuffer = Decrypter.decryptArrayBuffer(data);
            //console.log("Writing : ", targetPath);
            if (targetPath) await common.writeFile(targetPath, this.toBuffer(arrayBuffer));
            //console.log("done writing");
            resolve(arrayBuffer);;
        });
    })

};

Decrypter.cutArrayHeader = function(arrayBuffer, length) {
    return arrayBuffer.slice(length);
};

Decrypter.decryptArrayBuffer = function(arrayBuffer) {
    if (!arrayBuffer) return null;
    if (arrayBuffer instanceof Buffer) {
        arrayBuffer = arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
    }
    var header = new Uint8Array(arrayBuffer, 0, this._headerlength);

    var i;
    var ref = this.SIGNATURE + this.VER + this.REMAIN;
    var refBytes = new Uint8Array(16);
    for (i = 0; i < this._headerlength; i++) {
        refBytes[i] = parseInt("0x" + ref.substr(i * 2, 2), 16);
    }
    for (i = 0; i < this._headerlength; i++) {
        if (header[i] !== refBytes[i]) {
            throw new Error("Header is wrong");
        }
    }

    arrayBuffer = this.cutArrayHeader(arrayBuffer, Decrypter._headerlength);
    var view = new DataView(arrayBuffer);
    this.readEncryptionkey();
    if (arrayBuffer) {
        var byteArray = new Uint8Array(arrayBuffer);
        for (i = 0; i < this._headerlength; i++) {
            byteArray[i] = byteArray[i] ^ parseInt(Decrypter._encryptionKey[i], 16);
            view.setUint8(i, byteArray[i]);
        }
    }

    return arrayBuffer;
};

Decrypter.createBlobUrl = function(arrayBuffer){
    var blob = new Blob([arrayBuffer]);
    return window.URL.createObjectURL(blob);
};

Decrypter.toBuffer = function(arrayBuffer) {
    return Buffer.from(arrayBuffer)
}

Decrypter.extToEncryptExt = function(url) {
    var ext = url.split('.').pop();
    var encryptedExt = ext;

    if(ext === "ogg") encryptedExt = ".rpgmvo";
    else if(ext === "m4a") encryptedExt = ".rpgmvm";
    else if(ext === "png") encryptedExt = ".rpgmvp";
    else encryptedExt = ext;

    return url.slice(0, url.lastIndexOf(ext) - 1) + encryptedExt;
};

Decrypter.extToDecryptExt = function(url) {
    var ext = url.split('.').pop();
    var encryptedExt = ext;

    if(ext === "rpgmvo") encryptedExt = ".ogg";
    else if(ext === "rpgmvm") encryptedExt = ".m4a";
    else if(ext === "rpgmvp") encryptedExt = ".png";
    else if(ext === "png_") encryptedExt = ".png";
    else if(ext === "ogg_") encryptedExt = ".ogg";
    else if(ext === "m4a_") encryptedExt = ".m4a";
    else encryptedExt = ext;

    return url.slice(0, url.lastIndexOf(ext) - 1) + encryptedExt;
};

Decrypter.readEncryptionkey = function(){
    //this._encryptionKey = $dataSystem.encryptionKey.split(/(.{2})/).filter(Boolean);
    this._encryptionKey = this.rawEncriptionKey.split(/(.{2})/).filter(Boolean);
};

RMMVDecrypter.Decrypter = Decrypter;

window.RMMVDecrypter = RMMVDecrypter;


var exportToFolderPHP = async function(file, options) {
    // export translation
    if (typeof file=="undefined") return false;
    
    options = options||{};
    options.options = options.options||{};

    options.mode = "dir"; // always dir
    options.onDone = options.onDone||function() {};
    options.dataPath = options.dataPath || ""; // location of data path (data folder). Default is using cache
    options.transPath = options.transPath || ""; // location of .trans path to process. Default is using autosave on cache folder
    options.options.filterTag = options.options.filterTag||[];
    options.options.filterTagMode = options.options.filterTagMode||""; // whitelist or blacklist
    
    console.log("exporting project", arguments);
    
    var autofillFiles = [];
    var checkbox = $(".fileList .data-selector .fileCheckbox:checked");
    for (var i=0; i<checkbox.length; i++) {
        autofillFiles.push(checkbox.eq(i).attr("value"));
    }
    options.files = options.files||autofillFiles||[];

    await trans.autoSave()
    ui.showLoading();

    return new Promise((resolve, reject) => {
        php.spawn("export.php", {
            args:{
                path:file,
                gameFolder:trans.gameFolder,
                gameTitle:trans.gameTitle,
                projectId:trans.projectId,
                gameEngine:trans.gameEngine,
                files:options.files,
                exportMode:options.mode,
                options:options.options,
                rpgTransFormat:trans.config.rpgTransFormat,
                dataPath:options.dataPath,
                transPath:options.transPath
            },
            onData:function(buffer) {
                ui.loadingProgress("Loading", buffer, {consoleOnly:true, mode:'consoleOutput'});
                
            },
            onError:function(buffer) {
                ui.loadingProgress("Loading", buffer, {consoleOnly:true, mode:'consoleOutput', classStr:'stderr'});
                
            },
            onDone: function(data) {
                //console.log(data); 
                console.log("done")
                //ui.hideLoading(true);
                //ui.loadingProgress(t("Finished"), t("All process finished!"), {consoleOnly:false, mode:'consoleOutput'});
                
                //ui.showCloseButton();
                options.onDone.call(trans, data);
                resolve(data);
            }
        })
    })
    
}

/**
 * Export JS scripts to folder
 * @param  {} sourceDir
 * @param  {} targetDir
 * @param  {} transData
 * @param  {} options
 */
var exportPluginsToFolder = async function(sourceDir, targetDir, transData, options) {
    console.log("Exporting into a folder exportPluginsToFolder():", arguments);
    options = options||{};
    try {
        options.writeEncoding = options.writeEncoding || trans.project.writeEncoding;
    } catch (e) {
        options.writeEncoding = "utf8";
    }
    //options.groupIndex = options.groupIndex||"relPath";

    var translationData = options.translationDatas;
    if (!translationData) {
        // only build the (potentially large) save data clone when the
        // translation pairs are not already available
        transData = transData || trans.getSaveData(empty(options.files) ? {} : {filter: options.files});
        translationData = trans.getTranslationData(transData, options);
    }

    console.log("translation Data : ", translationData);
    var rmmv = new RMMV(sourceDir, {
        'writeMode'         : true,
        //'translationDatas'    : translationData.translationData,
        'translationDatas'    : translationData,
        'files'                : options.files
    });    
    window.rmmv = rmmv;
    
    try {
        await rmmv.exportPluginsToFolder(targetDir);
    } catch (e) {
        console.error(e);
        ui.logError("Error occured! Please see console window(F12) for more information", e.toString());
    }

}



var loadPlugins = async function() {
    if (trans.project.pluginIsFetched) {
        var conf = confirm("Plugins are already fetched for this project. Want to re-fetch the plugins?")
        if (!conf) return;
    }

    ui.holdCloseButton();
    try {
        var thisLoc = trans.project.loc;
        if (trans.gameEngine == "rmmv") {
            thisLoc = nwPath.join(trans.project.loc, "www");
            console.log("Does file js/plugins.js exist?", await common.isFileAsync(nwPath.join(thisLoc, "js/plugins.js")));
            if (await common.isFileAsync(nwPath.join(thisLoc, "js/plugins.js")) == false) thisLoc = trans.project.loc;
        }

        if (!ui.consoleIsShown) {
            ui.showBusyOverlay();
        } else {
            ui.loadingProgress(0, "Parsing plugins...", {consoleOnly:false, mode:'consoleOutput'});
        }
        var thisRM = new RMMV(thisLoc);
        // all items stored in a folder named data
        await thisRM.dumpPluginsToDir(nwPath.join(trans.project.cache.cachePath, "data"));
        await thisRM.pluginsToTrans(trans);
        console.log(thisRM);
        trans.drawFileSelector();
        trans.project.pluginIsFetched = true;
        trans._pendingPluginLoad = false;
        trans.trigger("projectCreated", trans, trans.project);
    } catch (e) {
        console.error(e);
        ui.logError("Error occured while collecting plugins! Please see console window(F12) for more information", e.toString());
        trans._pendingPluginLoad = false;
        // checkProject was skipped while plugins were pending; run it now so the project still gets finalized.
        if (trans.batchCheckSheet && typeof trans.batchCheckSheet.checkProject === "function") {
            trans.trigger("projectCreated", trans, trans.project);
        }
    } finally {
        ui.releaseCloseButton();
        ui.hideBusyOverlay();
    }
}

var init = function() {
}


var JSONPreview = function(json, htmlClass) {
    if (typeof json !== 'string') json = JSON.stringify(json);
    this.json = json;
    this.htmlClass = htmlClass;
    this.init();
}
JSONPreview.css = `
<style class="jsonPreview">
json-viewver {
    /* Background, font and color */
    --color: #f9f9f9;

}
</style>
`;

JSONPreview.prototype.addContextMenu = function() {
    var that = this;
    this.menu = new nw.Menu();
    // Add some items with label
    this.menu.append(new nw.MenuItem({
        label: 'Find next',
        type: "normal", 
        click: function(){
            if (!that.elm.data("searcher")) return;
            that.elm.data("searcher").next();
        }
    }));    
    this.menu.append(new nw.MenuItem({ type: 'separator' }));
    this.menu.append(new nw.MenuItem({
        label: 'Open folder',
        type: "normal", 
        click: function(){
            var filePath = that.elm.data("path");
            if (!filePath) return;
            nw.Shell.showItemInFolder(filePath);
        }
    }));
    this.menu.append(new nw.MenuItem({
        label: 'Open with external application',
        type: "normal", 
        click: function(){
            var filePath = that.elm.data("path");
            if (!filePath) return;
            nw.Shell.openItem(filePath);              
        }
    }));

    var that = this;
    this.elm.on("contextmenu", function(ev) {
        ev.preventDefault();
        that.menu.popup(parseInt(ev.originalEvent.x), parseInt(ev.originalEvent.y));
        return false;        
    })
}

JSONPreview.prototype.init = function() {
    var $template = $(`<json-viewer></json-viewer>`);
    $template.attr("title", `Raw JSON data. Right click to open menu.`);
    if (this.htmlClass) $template.addClass(this.htmlClass);
    $template.text(this.json);
    this.elm = $template;
    this.addContextMenu();


    if (JSONPreview.isInitialized) return;
    // initializing JSONPreview
    JSONPreview.viewer = require("@alenaksu/json-viewer");
    //$("head").append(JSONPreview.css);
    JSONPreview.isInitialized = true;

}
JSONPreview.prototype.getElement = function() {
    return this.elm;
}

/**
 * Generate direction path from RPG Maker MV styled context string
 * @param  {object} objData
 * @param  {integer} rowNumber
 */
JSONPreview.getDirectionPath = function(objData, rowNumber) {
    objData = objData || {};
    var result = [];
    if (!objData.context) return result;
    if (Array.isArray(objData.context[rowNumber]) == false) return result;
    if (objData.context[rowNumber].length == 0) return result;

    var arrayToPattern = function(array) {
        var str = array.join(".");
        return "**."+str
    }
    
    for (var i in objData.context[rowNumber]) {
        var contextString = objData.context[rowNumber][i];
        var contextSegment = contextString.split("/");
        if (objData.filename.toLowerCase() == "mapinfos.json") {

        } else if (objData.filename.substring(0, 3).toLowerCase() == "map") {
            var segm = contextSegment.slice(1, 6);
            result.push(arrayToPattern(segm));
        }
    }
    return result;
}

JSONPreview.find = function(objData, rowNumber) {
    objData = objData || {};

    if (!objData.context) return;
    if (Array.isArray(objData.context[rowNumber]) == false) return;
    if (objData.context[rowNumber].length == 0) return;    
    if (!objData.data) return;
    if (!objData.data[rowNumber][trans.keyColumn]) return;    
    var previewer = $(".dataPreview")[0];

    var thisMsg = objData.data[rowNumber][trans.keyColumn];
    var firstContext = objData.context[rowNumber][0];
    var firstContextArr = firstContext.split("/");
    if (firstContextArr.includes("message")) {
        thisMsg = thisMsg.replace(/\r/g, "");
        var msgs = thisMsg.split("\n");
        var keyword = msgs[0];
        if (msgs.length>1) keyword = msgs[1];
        var searcher = previewer.search(keyword);
        searcher.next();
    } else {
        var searcher = previewer.search(thisMsg);
        searcher.next();        
    }
    $(".dataPreview").data("searcher", searcher);
}

thisAddon.patchTransData = function() {
/*     // patch transData from previous version
    if (!trans.project) return;
    if (common.versionToFloat(trans.project.editorVersion) <= 30930 && trans.project.parser == "rmmvjs" && !trans.project.isPatched) {
        var conf = confirm(t("Patch is available for this trans data. This patch will make your trans data compatible with the current version of SLR Translator.\nDo you want to patch your Trans data?\n(Some feature may not work properly if you don't patch your trans data)"));
        if (!conf) return;

        trans.project.files = trans.project.files || {};
        for (var i in trans.project.files) {
            if (i.substring(0, 4) == "www/") {
                trans.project.files[i.substring(4)] = trans.project.files[i];
                delete trans.project.files[i];
            }
        }
        trans.project.isPatched = true;

        // redraw file selector
        trans.drawFileSelector();
    } */
}

thisAddon.exportAsZip = async function(targetPath, transData, options) {
    options             = options || {};
    options.engineType    = options.engineType || (transData && transData.project && transData.project.gameEngine) || trans.project.gameEngine;
    options.translationDatas = options.translationDatas || trans.getTranslationData(transData, options);
    // release the (potentially huge) save data clone as soon as the
    // translation pairs exist — keeping it alive through the export doubled
    // the heap on large games (renderer V8 OOM crash)
    transData = null;
    var originPath     = nwPath.join(trans.project.cache.cachePath, "data");
    var entryPoint     = nwPath.join(originPath, "index.html")

    var tmpPath     = nwPath.join(nw.process.env.TMP, trans.project.projectId);
    await ui.log("Generating a temporary folder", tmpPath);

    try {
        await fse.remove(tmpPath); 
        await common.mkDir(tmpPath, {recursive:true});
    } catch(e) {
        console.warn("Unable to create directory ", tmpPath);
        console.error(e);
        return;
    }

    await ui.log("Exporting to a temporary folder", tmpPath);
    //if (Boolean(thisAddon.config.useLegacyParser) == false) {
    if (trans.project.parser == "rmmvjs") {    
        await ui.log("--Handling RM Data");
        var entryPoint     = nwPath.join(originPath, "index.html")
        await this.exportToFolderThread(tmpPath, transData, options);
    } else {
        await exportToFolderPHP(tmpPath, options);
        await exportPluginsToFolder(originPath, tmpPath, undefined, options)
    }

    await ui.log("Plugins has been exported to ", tmpPath)
    await ui.log("Zipping temporary data");
    // Zip the CONTENTS of the temporary folder (data/, fonts/, js/ ... end up
    // at the archive root). 7z is spawned with its working directory set to
    // the folder and a bare "*" wildcard, which works on every platform. The
    // previous argument "tmpPath\*" only matched on Windows and silently
    // produced an EMPTY archive on Linux/Mac.
    var zipCode = -1;
    var zipStderr = "";
    await common.aSpawn(common.get7zipBin(), ["a", "-tzip", targetPath, "*"], {
        cwd     : tmpPath,
        onDone  : function(result, code) { zipCode = code; },
        onError : function(data) { zipStderr += (data ? data.toString() : ""); }
    });
    if (zipCode !== 0) {
        throw("Failed to create the zip archive (7z exited with code "+zipCode+")."+(zipStderr ? "\n"+zipStderr : ""));
    }

    // safety net: verify the archive is readable and not empty before
    // declaring success (an empty zip is only 22 bytes)
    var verifyCode = -1;
    await common.aSpawn(common.get7zipBin(), ["t", targetPath], {
        onDone: function(result, code) { verifyCode = code; }
    });
    var zipSize = await common.getFileSize(targetPath);
    if (verifyCode !== 0 || zipSize <= 22) {
        throw("The generated zip archive is empty or failed its integrity check: "+targetPath);
    }
    await ui.log("Zip archive created ("+zipSize+" bytes) : "+targetPath);
    return targetPath;
    
}

thisAddon.exportToFolder = async function(destinationDir, transData, options) {
    console.log("calling exportToFolder with arguments:", arguments);
    options             = options || {};
    // NOTE: the full getSaveData() clone is no longer stored on
    // options.transData for the whole export. It was never read after the
    // translation pairs were built, and holding it alive doubled the heap
    // usage on large games (renderer V8 OOM crash when exporting big files
    // such as a 26MB CommonEvents.json).
    options.engineType    = options.engineType || (transData && transData.project && transData.project.gameEngine) || trans.project.gameEngine;
    options.translationDatas = options.translationDatas || trans.getTranslationData(transData, options);

    var originPath     = nwPath.join(trans.project.cache.cachePath, "data");
    var entryPoint     = nwPath.join(originPath, "index.html")
    var rmmvGames     = new addonLoader.addons.rmmv.RMMVGames(entryPoint, options);
    await rmmvGames.exportToFolder(destinationDir, options);

    // plugins
    await exportPluginsToFolder(originPath, destinationDir, transData, options);
}

thisAddon.exportSelectedFile = async function(destinationDir, transData, parserType, exportOptions) {
    exportOptions     = exportOptions || {};
    transData         = transData || trans.getSaveData();
    
    var cacheLocation         = nwPath.join(transData.project.cache.cachePath, "data");
    var entryPoint             = nwPath.join(cacheLocation, "index.html");
    
    console.log("ParserType", parserType);
    if (parserType == "plugin") {
        // plugins
        await exportPluginsToFolder(cacheLocation, destinationDir, transData, exportOptions);
    } else {
        // rmmv data
        exportOptions.engineType = exportOptions.engineType || transData.project.gameEngine || trans.project.gameEngine;
        var rmmvGames = new this.RMMVGames(entryPoint, exportOptions);
        await rmmvGames.exportToFolder(destinationDir, exportOptions);
    }
}


thisAddon.exportToFolderThread= async function(destinationDir, transData, options) {
    return await this.exportToFolder(destinationDir, transData, options);
}

thisAddon.loadJSONEditorLibrary = async function() {
    return RawViewer.prototype.loadJSONEditorLibrary.call(thisAddon);
};




var JsonEditorHelper = function(jsonEditorInstance, $elm) {
    this.jsonEditor = jsonEditorInstance;
    this.$elm     = $elm;
}

JsonEditorHelper.prototype.observeOnce = function(fn) {
    // Select the node that will be observed for mutations
    const targetNode =this.$elm[0];

    // Options for the observer (which mutations to observe)
    const config = { attributes: true, childList: true, subtree: true };

    // Callback function to execute when mutations are observed
    const callback = function(mutationsList, observer) {
        console.log("mutation occured");
        fn.call(this)
        observer.disconnect();
    };

    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);

    // Start observing the target node for configured mutations
    observer.observe(targetNode, config);    
}

JsonEditorHelper.prototype.expandPoint = async function(path) {
    if (!path) return;
    if (Array.isArray(path) == false) path = [path];

    var currentPath = this.jsonEditor.node;
    
    var expandChild = async (key) => {
        //console.log(`expandChild(${key})`);

        if (!isNaN(key)) {
            key = parseInt(key);
            //console.log("expanding index", key);
            currentPath.childs[key].expand(false);
            currentPath = currentPath.childs[key];
        } else {
            for (var i=0; i< currentPath.childs.length; i++) {
                var thisIndex = currentPath.childs[i].field || currentPath.childs[i].index;
                //console.log(">>thisIndex", thisIndex);
                if (thisIndex == key) {
                    //console.log(`expanding childs[${i}]`, thisIndex, currentPath.childs[i]);
                    currentPath.childs[i].expand(false);
                    currentPath = currentPath.childs[i];
                    return;
                }
            }
        }

    }

    // expand root
    currentPath.expand(false);

    // expand inbetween
    for (var i=0; i<path.length - 1; i++) {
        console.log("Handling path:", path[i]);
        await expandChild(path[i]);
    }

    return new Promise(async (resolve, reject) => {
        // last path 
        var lastPath = path[path.length - 1];
        this.observeOnce(()=>{
            console.log("dom mutated");
            console.log("scroll to:", currentPath.dom.value);
            // scroll only within the tree's own viewport — a full scrollIntoView()
            // would also drag the whole raw tab panel down to the tree, hiding
            // the metadata header and snippet above it
            var wrap = this.$elm[0];
            var nodeEl = currentPath.dom.value;
            if (wrap && nodeEl) {
                wrap.scrollTop = wrap.scrollTop + nodeEl.getBoundingClientRect().top - wrap.getBoundingClientRect().top - 8;
            }
            resolve();
        });
        await expandChild(lastPath);
    })
    
}

// exported for other addons (rmrgss raw view reuses the tree auto-expand helper)
window.JsonEditorHelper = JsonEditorHelper;

//var jsonEditorHelper = new JsonEditorHelper(addonLoader.addons.rmmv.jsonPreview, $(".jsonViewerWrapper"))
//await jsonEditorHelper.expandPoint(["events", 3, "pages", 0, "list", "35"]);


$(document).ready(function() {
    var supportedEngines = ["rmmv", "rmmz"];

    /*
    $(document).on("projectCreated", async function(trans, rawData) {
        // executed when a new project is created and before drawing file list
        if (trans.gameEngine !== "rmmv" && trans.gameEngine !== "rmmz") return;
        var location = trans.loc;
        if (trans.gameEngine == "rmmv") {
            location = nwPath.join(trans.loc, "www");
        } 
        var thisRM = new RMMV(location);
        await thisRM.dumpPluginsToDir(trans.project.cache.cachePath);
        await thisRM.pluginsToTrans(trans);
    });
    */

    engines.addHandler(supportedEngines, 'rmCreateProject', async function(targetPath) {
        await ui.log("Handling RPG Maker MV/MZ");
        var rmmvGames = new RMMVGames(targetPath);
        console.log(rmmvGames);
        await rmmvGames.newProject();
    });

    /*
    engines.addHandler(supportedEngines, 'onCheckProjectExist', async function(targetPath, engineType, data) {
        console.log("Handling onCheckProjectExist");
        try {
            if (Boolean(thisAddon.config.useLegacyParser) == true) {
                // just skip
                console.log("Use legacy parser");
                return;
            } 
        } catch (e) {
            console.warn(e);
        }
        console.log("Handling RPG Maker MV/MZ");
        var rmmvGames = new RMMVGames(targetPath);
        await ui.newProjectDialog.close();
        await rmmvGames.newProject();
        return common.halt();
    });
    */


    engines.addHandler(supportedEngines, 'exportHandler', async function(targetPath, options) {
        if (trans.project.parser !== "rmmvjs") return;
        if (options.mode !== "dir" && options.mode !== "zip") return false;
        console.log("Export handler", arguments);
        console.log(JSON.stringify(options));

        ui.showLoading();
        ui.loadingProgress("Processing", "Export into : "+targetPath, {consoleOnly:false, mode:'consoleOutput'});
        await ui.log("Target directory:", targetPath);
        await ui.log("Options : ", options);
        await ui.log("Origin path is cache path");
    
        options.translationDatas = trans.getTranslationData(undefined, options);
        if (options.mode == "dir") {
            if (trans.project.parser == "rmmvjs") {
                await ui.log("--Handling RM Data");
                await thisAddon.exportToFolderThread(targetPath, undefined, options);
                ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
                ui.loadingEnd();
                return common.halt();
            } else {
                // export plugins only
                await exportPluginsToFolder(originPath, targetPath, undefined, options);
                // then use legacy by exiting this function with false 
                await ui.log("Use legacy parser");
                return;
            }
        } else if (options.mode == "zip") {
            await thisAddon.exportAsZip(targetPath, undefined, options);
            console.log("process done");
            ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
            ui.loadingEnd();

            // prevent default behavior
            return common.halt();
        }
/*
        var originPath = nwPath.join(trans.project.cache.cachePath, "data");

        try {
            if (await await common.isDirectory(targetPath)) {
                await ui.log("Handler: export into a directory");

                await ui.log("--Handling JavaScript files");
                await exportPluginsToFolder(originPath, targetPath, undefined, options);

                //if (Boolean(thisAddon.config.useLegacyParser) == false) {
                if (trans.project.parser == "rmmvjs") {
                    await ui.log("--Handling RM Data");
                    var entryPoint = nwPath.join(originPath, "index.html")
                    var rmmvGames = new addonLoader.addons.rmmv.RMMVGames(entryPoint, options);
                    await rmmvGames.exportToFolder(targetPath, options);
                    ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
                    ui.loadingEnd();
                    return common.halt();
                } else {
                    // use legacy
                    await ui.log("Use legacy parser");
                    return;
                }
                
            }
        } catch (e) {
            console.warn(e);
        }
        
        // ===========================================
        // export to zip
        // ===========================================
        // export to temporary directory
        await ui.log("Handler: export into a zip file");
        var tmpPath = nwPath.join(nw.process.env.TMP, trans.project.projectId);
        fse.removeSync(tmpPath); 
        try {
            fs.mkdirSync(tmpPath, {recursive:true});
        } catch(e) {
            console.warn("Unable to create directory ", tmpPath);
            throw(e);
            return;
        }

        await ui.log("Exporting to a folder", tmpPath);
        //if (Boolean(thisAddon.config.useLegacyParser) == false) {
        if (trans.project.parser == "rmmvjs") {    
            await ui.log("--Handling RM Data");
            var entryPoint     = nwPath.join(originPath, "index.html")
            var rmmvGames     = new addonLoader.addons.rmmv.RMMVGames(entryPoint, options);
            await rmmvGames.exportToFolder(tmpPath, options);
        } else {
            await exportToFolderPHP(tmpPath, options)
        }        
        await exportPluginsToFolder(originPath, tmpPath, undefined, options)
        await ui.log("Plugins has been exported to ", tmpPath)
        
        await ui.log("Zipping temporary data");
        var _7z = require('7zip-min');
        _7z.cmd(['a', '-tzip', targetPath, tmpPath+"\\*"], err => {
            // done
            console.log("process done");
            ui.loadingProgress("Finished", "All process finished!", {consoleOnly:false, mode:'consoleOutput'});
            ui.loadingEnd();
        });
                
        // prevent default exporting
        return true;
*/        
    });
    engines.addHandler(supportedEngines, "onLoadTrans", async () => {
        thisAddon.patchTransData();
        
        // check version
//        thisAddon.config = thisAddon.config || {};
/*         if (common.versionToFloat(trans.project.editorVersion) < common.versionToFloat("3.9.15") && trans.project.parser == "rmmvjs") {
            var popupOption = {
                title: "Project requires update",
                buttons : [
                    {
                        text: "Switch to old parser",
                        icon: "ui-icon-close",
                        click: function() {
                            thisAddon.config.useLegacyParser = true;
                            alert(t("The option has been set to use the legacy parser.\nYou can switch back to the new parser anytime via option menu."));
                            $(this).dialog( "close" );
                        }
                    },{
                        text: "Close",
                        icon: "ui-icon-close",
                        click: function() {
                            $(this).dialog( "close" );
                        }
                    }
                ]
            }
            var content = $(`
            <h1>${(`This project is not compatible with the current parser`)}</h1>
            <p>${(`Your project is created with the older version of the parser. Some features may not be compatible with the current version.`)}</p>
            <p><b>${(`Advice:`)}</b> ${(`Create a new project and then import the translation of the current project into the newly created project.`)} <a href="" external>${(`(read more on the documentation)`)}</a></p>
            <p>${(`Or alternatively you can also switch back to the old version of parser on the options menu (not recomended though, since the old parser is deprecated).`)}</p>`)
            await ui.showPopup("rmmv_rquireUpgrade", content, popupOption);
        } */


        
    })

    engines.addHandler(supportedEngines, "onAfterCreateProject", async ()=>{
        ui.one("loadingConsoleClosed", async ()=> {
            if (trans.project.parser !== "rmmvjs") return;
            await loadPlugins();
        })
    });    

    
    $(".cellInfoContent.rawData").css("background-color", "#2a2f3a");
    //Skip (not)MapInfos Animations and Tilesets.
    //var cropableData = ["commonevents", "actors", "animations", "armors", "classes", "enemies", "items", "skills", "mapinfos", "states", "tilesets", "troops", "weapons"]
    var cropableData = ["commonevents", "actors", "armors", "classes", "enemies", "items", "skills", "mapinfos", "states", "troops", "weapons"]
    var allowedExtension = [".json", "json", ".js", "js"];
    engines.addHandler(supportedEngines, 'onLoadSnippet', async function(selectedCell) {
        console.log("RMMV/MZ onLoadSnippet handler");
        console.log("selected cell:", selectedCell);

        var obj = trans.getSelectedObject();
        if (!obj) return;

        if (obj.extension.toLowerCase() == ".js" && ["js/plugins.js", "/js/plugins.js"].includes(obj.path.toLowerCase()) == false) return this.commonHandleFile(selectedCell, "js");



        if (allowedExtension.includes(obj.extension) == false) return;
        if (!Array.isArray(obj.context[selectedCell.fromRow])) return;
        if (obj.context[selectedCell.fromRow].length == 0) return;

        console.log("determining active path");
        var activePath = nwPath.join(trans.project.loc, obj.path);
        if (trans.project.gameEngine=="rmmv") {
            activePath = nwPath.join(trans.project.loc, "www", obj.path);
            if (await common.isFileAsync(activePath) == false) activePath = nwPath.join(trans.project.loc, obj.path);
        }
        console.log("testing", activePath);
        if (await common.isFileAsync(activePath) == false)  activePath = nwPath.join(trans.project.cache.cachePath, "data", obj.path);
        console.log("testing", activePath);
        if (await common.isFileAsync(activePath) == false) {
            this.clear();
            console.log("no active path");

            $warningMsg = $(`<div class="blockBox warningBlock withIcon">${`Unable to find the file related to the data`}<br />
            ${`To fix this correct the <b>Raw material location</b> field at the <a href="#" class="openProjectProperties">Project properties</a>`}</div>`)
            $warningMsg.find(".openProjectProperties").on("click", function() {
                ui.openProjectProperties();
            });
            this.append($warningMsg)
            return;
        }

        if (obj.path == "js/plugins.js" || obj.path == "/js/plugins.js" ) {
            console.log("plugins.js viewer");
            if (this.lastOpenedPath !== activePath || this.isClear()) {
                var addonList = RMMV.getParsedPluginContent(await common.fileGetContents(activePath));
                /*
                var jsonPreview = new JSONPreview(addonList, "dataPreview");
                this.jsonPreviewElm = jsonPreview.getElement();
                */
                await thisAddon.loadJSONEditorLibrary();
                this.jsonPreviewElm = $("<div class='jsonViewerWrapper'></div>");
                this.jsonPreviewElm.data("path", activePath);

                var options = {
                    mode:'view'                    
                }
                this.jsonPreview = new JSONEditor(this.jsonPreviewElm[0], options);
                this.jsonPreview.set(addonList);
                this.jsonEditorHelper = new JsonEditorHelper(this.jsonPreview, this.jsonPreviewElm)

                thisAddon.jsonPreview = this.jsonPreview;

                this.clear();
                this.append(this.jsonPreviewElm);
                this.lastOpenedPath     = activePath;
            }

            //this.jsonPreviewElm[0].collapseAll()
            //JSONPreview.find(obj, selectedCell.fromRow);
            var contexts = trans.getSelectedContext() || [];
            for (var i=0; i<contexts.length; i++) {
                var thisContext = contexts[i].split("/");
                console.log("Expanding context:", thisContext);
                await this.jsonEditorHelper.expandPoint(thisContext);
            }

        } else {
            console.log("obj.filename.", obj.filename);
            var mvToken = (this._mvRawToken = (this._mvRawToken || 0) + 1);

            var needTree = false;
            if (this.lastOpenedPath !== activePath || this.isClear()) {
                var mvData = await common.fileGetContents(activePath);
                if (mvToken !== this._mvRawToken) return;
                this.lastOpenedData = mvData;
                this.lastOpenedPath = activePath;
                this.beautifiedJsonCache = null;
                needTree = true;
            }

            // metadata header + beautified JSON snippet (aligned with the VX/VX Ace raw view)
            // rendered into a dedicated area so repeat selections don't wipe or duplicate the tree
            if (this.mvSnippetAreaFile !== activePath || this.isClear() || !this.mvSnippetArea || this.mvSnippetArea.parent().length === 0) {
                this.clear();
                this.mvSnippetArea = $("<div class='mvSnippetArea'></div>");
                this.container.append(this.mvSnippetArea);
                this.mvSnippetAreaFile = activePath;
                this.$mvTreeSection = null;
            } else {
                this.mvSnippetArea.empty();
            }
            this.scrollToTop();
            try {
                var mvContexts = trans.getSelectedContext() || [];
                if (mvContexts.length > 0 && !this.beautifiedJsonCache) {
                    var mvRoot = JSON.parse(this.lastOpenedData);
                    this.beautifiedJsonCache = { root: mvRoot, text: JSON.stringify(mvRoot, undefined, 2) };
                }
                if (this.beautifiedJsonCache) {
                    await this.ensurePrism();
                    if (mvToken !== this._mvRawToken) return;
                    try { require("www/core/rmrgss/node_modules/prismjs/components/prism-json"); } catch (e) {
                        console.warn("prism-json unavailable", e);
                    }
                    for (var mvI = 0; mvI < mvContexts.length; mvI++) {
                        var mvParsed = MVRAW.parseContext(mvContexts[mvI]);
                        this.addMetaBlock(MVRAW.describe(this.beautifiedJsonCache.root, mvParsed, RMMVData.RPGM_EVENT_CODE), this.mvSnippetArea);
                        var mvHit = MVRAW.findSnippet(this.beautifiedJsonCache.text, this.beautifiedJsonCache.root, mvParsed.segments);
                        if (mvHit) {
                            var mvWrapper = await this.addSnippetPreviewFromText(this.beautifiedJsonCache.text, mvHit.start, mvHit.end, {
                                language: "json",
                                path: activePath,
                                note: "beautified view",
                                synthetic: true,
                                container: this.mvSnippetArea
                            });
                            this.addContextMenu(mvWrapper, { path: activePath, synthetic: true, offsetStart: mvHit.start, offsetEnd: mvHit.end });
                        }
                        if (mvToken !== this._mvRawToken) return;
                    }
                }
            } catch (e) {
                console.warn("MV raw snippet generation failed", e);
            }

            var json;
            if (cropableData.includes(obj.filename.toLowerCase())) {
                console.log("handling common events");
                // show by each page
                var commonEvents = JSON.parse(this.lastOpenedData);
                var thisContext = trans.getSelectedContext()[0];
                console.log("thisContext", thisContext);
                var contextPart = thisContext.split("/");
                console.log("contextPart", contextPart);
                json = commonEvents[contextPart[1]];
                console.log(contextPart[1]);
            } else {
                // original cadence: maps build the tree once per file (or when the
                // previous section was destroyed by a foreign clear); cropable files
                // above rebuild per selection as before
                var treeAlive = this.$mvTreeSection && this.$mvTreeSection.parent().length > 0;
                json = (needTree || !treeAlive) ? this.lastOpenedData : undefined;
            }

            try {
            if (json) {
                var jsonObj = json;
                if (typeof json == "string") jsonObj = JSON.parse(json)

                await this.loadJSONEditorLibrary();
                if (mvToken !== this._mvRawToken) return;
                if (this.$mvTreeSection) this.$mvTreeSection.remove();
                this.$mvTreeSection = this.addTreeSection("JSON data tree");
                this.jsonPreviewElm = this.$mvTreeSection.find(".jsonViewerWrapper");
                this.jsonPreviewElm.data("path", activePath);

                var options = {
                    mode:'view'
                }
                this.jsonPreview = new JSONEditor(this.jsonPreviewElm[0], options);
                this.jsonPreview.set(jsonObj);
                this.jsonEditorHelper = new JsonEditorHelper(this.jsonPreview, this.jsonPreviewElm)

                thisAddon.jsonPreview = this.jsonPreview;
            }
            } catch (e) {
                console.warn("JSON tree rendering failed", e);
                if (this.$mvTreeSection) {
                    this.$mvTreeSection.remove();
                    this.$mvTreeSection = null;
                }
                this.jsonPreview = null;
            }

            if (!this.jsonPreview || !this.$mvTreeSection || this.$mvTreeSection.parent().length === 0) return;
            this.jsonPreview.collapseAll();
            console.log("expanding node");
            var contexts = trans.getSelectedContext() || [];
            for (var i=0; i<contexts.length; i++) {
                var thisContext = contexts[i].split("/").slice(1,7);
                console.log("Expanding context:", thisContext);
                // contexts ending at a scalar leaf (e.g. Actors/1/name) never mutate
                // the tree DOM, which would leave expandPoint pending forever
                await Promise.race([
                    this.jsonEditorHelper.expandPoint(thisContext).catch(e => console.warn("expand failed", e)),
                    new Promise(raceDone => setTimeout(raceDone, 1500))
                ]);
            }
            console.log("End of handling raw viewer");
        }
        
    });

    ui.onReady(function() {
        init();
    });
});
