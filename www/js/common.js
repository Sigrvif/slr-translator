var fs             = require('graceful-fs');
var iconv         = require('iconv-lite');    
var moduleAlias = moduleAlias || require('module-alias');
var spawn         = require('child_process').spawn;
//const BetterLocalStorage = require("www/js/lib/localStore.js");
try {
    window.transConfig = JSON.parse(localStorage.getItem('Config'));
} catch (e){
    console.log(e);
}
var $DV = $DV||{
    config:{
    }
}
$DV.config.substituteMarkup =true;
$DV.config.keepContext = false;
$DV.config.lineSeparator = "\n"; // proved OK in google;
$DV.config.sl = 'ja'; // source language
$DV.config.tl = 'en'; // target language


var LoadMonitor = function() {
    window._loadMonitor = window._loadMonitor || [];
    this.id = window._loadMonitor.push(new Promise((resolve, reject)=>{
        this.resolve     = resolve;
        this.reject     = reject;
    })) - 1
}

LoadMonitor.waitUntilLoaded = async function() {
    window._loadMonitor = window._loadMonitor || [];
    return Promise.all(window._loadMonitor);
}


global.getFileExtension = function(filename) {
  var ext = /^.+\.([^.]+)$/.exec(filename);
  return ext == null ? "" : ext[1].toLowerCase();
}

global.getFileName = function(path) {
    return path.split('\\').pop().split('/').pop();
}

global.parseQuery = function(queryString) {
    var query = {};
    var pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split('=');
        query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return query;
}

global.wordwrap = function(str, maxWidth, lineBreak) {
    if (Array.isArray(str)) str =  str.join("");
    str = str||"";
    if (empty(str)) return str;
    lineBreak = lineBreak || '\n';
    return str.replace(new RegExp(`(?![^\\n]{1,${maxWidth}}$)([^\\n]{1,${maxWidth}})\\s`, 'g'), `$1${lineBreak}`)
}

global.str_ireplace = function(search, replace, subject) {
  //  discuss at: http://phpjs.org/functions/str_ireplace/
  // original by: Martijn Wieringa
  //    input by: penutbutterjelly
  //    input by: Brett Zamir (http://brett-zamir.me)
  // improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // improved by: Jack
  // bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // bugfixed by: Onno Marsman
  // bugfixed by: Philipp Lenssen
  //   example 1: str_ireplace('l', 'l', 'HeLLo');
  //   returns 1: 'Hello'
  //   example 2: str_ireplace('$', 'foo', '$bar');
  //   returns 2: 'foobar'

  var i, k = '';
  var searchl = 0;
  var reg;

  var escapeRegex = function(s) {
    return s.replace(/([\\\^\$*+\[\]?{}.=!:(|)])/g, '\\$1');// eslint-disable-line
  };

  search += '';
  searchl = search.length;
  if (Object.prototype.toString.call(replace) !== '[object Array]') {
    replace = [replace];
    if (Object.prototype.toString.call(search) === '[object Array]') {
        // If search is an array and replace is a string,
        // then this replacement string is used for every value of search
        while (searchl > replace.length) {
        replace[replace.length] = replace[0];
        }
    }
  }

  if (Object.prototype.toString.call(search) !== '[object Array]') {
    search = [search];
  }
  while (search.length > replace.length) {
    // If replace has fewer values than search,
    // then an empty string is used for the rest of replacement values
    replace[replace.length] = '';
  }

  if (Object.prototype.toString.call(subject) === '[object Array]') {
    // If subject is an array, then the search and replace is performed
    // with every entry of subject , and the return value is an array as well.
    for (k in subject) {
        if (subject.hasOwnProperty(k)) {  // eslint-disable-line
            subject[k] = str_ireplace(search, replace, subject[k]);
        }
    }
    return subject;
  }

  searchl = search.length;
  for (i = 0; i < searchl; i++) {
    reg = new RegExp(escapeRegex(search[i]), 'gi');
    subject = subject.replace(reg, replace[i]);
  }

  return subject;
}

/**
 * detects whether a variable is empty
 * just like PHP's empty()
 * @param  {*} mixedVar
 */
global.empty = function(mixedVar) {
    if (Array.isArray(mixedVar)) {
        if (mixedVar.length == 0) return true;
        return false;
    }
    if (mixedVar == null) return true;
    if (typeof mixedVar == "object") {
        var _keys = Object.keys(mixedVar);
        for (var _i = 0; _i < _keys.length; _i++) {
            var _v = mixedVar[_keys[_i]];
            if (_v !== undefined && typeof _v !== "function") return false;
        }
        return true;
    }

    return !mixedVar;
}










/**
 * common is SLR Translator utility belt.
 * You can use it via `window.common` or directly `common`
 * @namespace
 * @classdesc common is SLR Translator utility belt to handle commonly used stuff.
 * The common utility belt can be accessed through `window.common` or calling `common` directly
 */
global.common ||= {
};

// ---- Platform abstraction (added for the Linux port) ----
common.IS_WIN = (nw.process.platform === 'win32');
common.IS_MAC = (nw.process.platform === 'darwin');
common.IS_LINUX = (nw.process.platform === 'linux' || nw.process.platform === 'freebsd');

// Path to the bundled 7-Zip binary for the current OS/arch.
common.get7zipBin = function() {
    var binDir = nwPath.join(this.getRootDir(), "node_modules", "7zip-bin");
    if (this.IS_WIN) {
        return nwPath.join(binDir, "win", process.arch === 'x64' ? "x64" : "ia32", "7za.exe");
    }
    if (this.IS_MAC) {
        return nwPath.join(binDir, "mac", "7za");
    }
    var arch = ({x64:'x64', arm64:'arm64', arm:'arm', ia32:'ia32'})[process.arch] || 'x64';
    return nwPath.join(binDir, "linux", arch, "7za");
};

// OS temp directory. Windows uses %TEMP%/%TMP%; Unix uses $TMPDIR or /tmp.
common.getTempDir = function() {
    return nw.process.env.TEMP || nw.process.env.TMP || nw.process.env.TMPDIR || require('os').tmpdir();
};

// Find the runnable game executable inside a directory for the current OS.
common.gameExecutableIn = function(dir) {
    var candidates;
    if (this.IS_WIN) {
        candidates = ["Game.exe"];
    } else if (this.IS_MAC) {
        candidates = ["Game.app", "Game", "nw"];
    } else {
        // Linux RPG Maker (nwjs) games ship a "Game" or "nw" binary, usually
        // together with a start.sh wrapper that sets up the environment.
        candidates = ["Game", "nw", "start.sh", "Game.exe"];
    }
    for (var i = 0; i < candidates.length; i++) {
        var p = nwPath.join(dir, candidates[i]);
        try { if (fs.existsSync(p)) return p; } catch (e) {}
    }
    return null;
};

// Launch the game inside a directory with its runnable executable.
// On Linux the nwjs binary / start.sh wrapper can not be opened through
// the desktop shell, so they are spawned directly with the game folder
// as working directory.
common.launchGame = function(dir) {
    try {
        var g = this.gameExecutableIn(dir);
        if (!g) return nw.Shell.openItem(dir);
        if (this.IS_WIN || this.IS_MAC) return nw.Shell.openItem(g);
        if (nwPath.basename(g) == "start.sh") {
            require("child_process").spawn("sh", [g], {detached: true, stdio: "ignore", cwd: dir}).unref();
        } else {
            require("child_process").spawn(g, [], {detached: true, stdio: "ignore", cwd: dir}).unref();
        }
        return true;
    } catch (e) {
        console.warn("Unable to launch the game", dir, e);
        try { return nw.Shell.openItem(dir); } catch (e2) {}
    }
    return false;
};

common.autoIncr = {};

// indexedDB causes error on child process. Do not include in common.js
//common.localConfig = new BetterLocalStorage("common");


common.getFileExtension = global.getFileExtension;

common.getAutoIncrement = function(id) {
    id ||= "_";
    this.autoIncr[id] ||= 0;
    this.autoIncr[id]++;
    return this.autoIncr[id];
}

common.wordwrap = global.wordwrap;

/**
 * Locale aware wordwrap
 * @param {String} str - Text
 * @param {Number} maxWidth - Maximum width
 * @param {String} [lineBreak=\n] - Line break character
 * @param {String} lang - Language locale
 * @since 5.7.9
 * @returns {String} - Wordwrap text
 */
common.wordwrapLocale = function(str, maxWidth, lang, lineBreak="\n") {
    if (!lang) lang = trans.getTl() || "en";
    const words = common.splitWords(str, lang);
    const lines = [];
    let lineLength = 0;
    let currentLine = [];
    for (let i=0; i<words.length; i++) {
        if (lineLength+words[i].length < maxWidth || words[i].length>=maxWidth) {
            currentLine.push(words[i]);
            lineLength+=words[i].length;
        } else {
            lines.push(currentLine.join("").trim());
            currentLine = [];
            lineLength = 0;

        }
    }
    return lines.join(lineBreak);
}

/**
 * Behavior : will keep the words intact even if the first words in long_string is longer than max_char
 * @param  {} long_string
 * @param  {} max_char
 * @param  {} lineBreak
 * @returns {String} Word wrapped string
 */
common.wordwrapAfter = function(long_string, max_char, lineBreak){
    if (typeof long_string !== 'string') return long_string;
    lineBreak = lineBreak||"\n";
    

    var sum_length_of_words = function(word_array){
        var out = 0;
        if (word_array.length!=0){
            for (var i=0; i<word_array.length; i++){
                var word = word_array[i];
                out = out + word.length;
            }
        }
        return out;
    }

    var split_out = [[]];
    var split_string = long_string.split(' ');
    for (let i=0; i<split_string.length; i++){
        var word = split_string[i];

        if ((sum_length_of_words(split_out[split_out.length-1]) + word.length) > max_char){
            split_out = split_out.concat([[]]);
        }

        split_out[split_out.length-1] = split_out[split_out.length-1].concat(word);
    }

    for (let i=0; i<split_out.length; i++){
        split_out[i] = split_out[i].join(" ");
    }
  
  return split_out.join(lineBreak);
};

/**
 * Split a long string into n number of paragrph of similiar length.
 * @param {String} longText 
 * @param {number} numberOfParagraph 
 * @returns {String[]}
 */
common.splitIntoLine = function(longText, numberOfParagraph=1) {
    if (numberOfParagraph <= 1) return [longText];
    const delimiter = " ";
    if (longText.includes(delimiter) == false) return [longText];
    
    //const chunk = longText.split(delimiter);
    const eachLength = Math.round(longText.length / numberOfParagraph);
    var result = [];

    const splitAtPoint = (text, sliceAt)=> {
        return {
            left: text.substring(0, sliceAt),
            right: text.substring(sliceAt)
        }
    }

    const getLastWord = (text) => {
        if (!text) return text;
        const chunk = text.split(delimiter);
        return chunk[chunk.length - 1];
    }

    const getFirstWord = (text) => {
        if (!text) return text;
        const chunk = text.split(delimiter);
        return chunk[0];
    }

    const shiftWordTo = (leftText, rightText, direction) => {
        var leftParts = leftText.split(" ");
        var rightParts = rightText.split(" ");

        if (direction == "left") {
            const firstRightPart = rightParts.shift();
            leftParts[leftParts.length - 1] = leftParts[leftParts.length - 1]+firstRightPart;
        } else {
            const lastLeftPart = leftParts.pop();
            rightParts[0] = lastLeftPart+rightParts[0];
        }

        return {
            left: leftParts.join(" "),
            right: rightParts.join(" ")
        }
    }

    var textTemp = longText;
    for (let i=0; i<numberOfParagraph - 1; i++) {
        let parts = splitAtPoint(textTemp, eachLength);
        if (parts.left.charAt(parts.left.length - 1) == delimiter || parts.right.charAt(0) == delimiter) {
            // split at delimiter
            result.push(parts.left.trimEnd());
            textTemp = parts.right.trimStart();
            continue;
        }

        console.log("normal splitting");
        if (getLastWord(parts.left) > getFirstWord(parts.right)) {
            let shiftedWords = shiftWordTo(parts.left, parts.right, "left");
            result.push(shiftedWords.left);
            textTemp = shiftedWords.right;
        } else {
            let shiftedWords = shiftWordTo(parts.left, parts.right, "right");
            result.push(shiftedWords.left);
            textTemp = shiftedWords.right;
        }
    }

    result.push(textTemp);

    return result;

}


/**
 * Filter array to unique content only
 * @param {*} [any] myArray 
 * @returns {any[]}
 */
common.arrayUnique = function(myArray = []) {
    return [...new Set(myArray)];    
}

/**
 * Add event handler on an object 
 * Will add on, off, one, and trigger into an object
 * @param {Object} obj - Object to be extended
 * @param {JQuery} [$elm=$("<div>")] - Element to hook the event
 * @returns {obj} 
 */
common.addEventHandler = function(obj, $elm) {
    obj.$e = $elm||$("<div>");
    obj.on = function(evt, fn) {
        this.$e.on(evt, fn)
    }
    
    obj.off = function(evt, fn) {
        this.$e.off(evt, fn)
    }
    
    obj.one = function(evt, fn) {
        this.$e.one(evt, fn)
    }
    
    obj.trigger = function(evt, param) {
        this.$e.trigger(evt, param)
    }

    return obj;
}

/**
 * Check whether a variable is a Javascript's argument object
 * @param {*} item - Variable to check
 * @returns {Boolean} True if given variable is a Javascript's argument object
 */
common.isArguments = function( item ) {
    return Object.prototype.toString.call( item ) === '[object Arguments]';
}

/**
 * Convert a Javascript's argument object into a plain array
 * @param {arguments} args - Argument to convert
 * @returns {Array}
 */
common.argumentsToArray = function(args) {
    if (!this.isArguments(args)) return args;
    args = Array.prototype.slice.call(args);
    return args.sort();
}

/**
 * Checks which members of two arrays are intersects each other.
 * @param {Array} array1 
 * @param {Array} array2 
 * @returns {Boolean}
 */
common.arrayIntersect = function(array1, array2) {
    if (!Array.isArray(array1)) return [];
    if (!Array.isArray(array2)) return [];
    
    try {
        return array1.filter(value => array2.includes(value));
    } catch (e) {
        return [];
    }
}

/**
 * Sort an object by the key
 * @param {*} obj 
 * @param {ascending|descending} order 
 * @returns {Object} - Sorted Object
 */
common.sortObjectByKey = function(obj, order = "ascending") {
    // Convert the object to an array of [key, value] pairs
    const entries = Object.entries(obj);

    // Sort the array based on the keys
    entries.sort((a, b) => {
        const keyA = a[0];
        const keyB = b[0];

        if (order === "ascending") {
            return keyA.localeCompare(keyB);
        } else if (order === "descending") {
            return keyB.localeCompare(keyA);
        } else {
            throw new Error("Invalid sorting order. Use 'ascending' or 'descending'.");
        }
    });

    // Convert the sorted array back to an object
    const sortedObject = Object.fromEntries(entries);

    return sortedObject;
}

/**
 * Sort iterable obj by immidiate key
 * @param {*} obj 
 * @param {*} key 
 * @returns {Array} - Sorted object
 */
common.sort = function(obj, key, isDesc) {
    function sortObj(list, key) {
        function compareAsc(a, b) {
            a = a[key];
            b = b[key];
            var type = (typeof(a) === 'string' ||
                        typeof(b) === 'string') ? 'string' : 'number';
            var result;
            if (type === 'string') result = a.localeCompare(b);
            else result = a - b;
            return result;
        }
        function compareDesc(b, a) {
            a = a[key];
            b = b[key];
            var type = (typeof(a) === 'string' ||
                        typeof(b) === 'string') ? 'string' : 'number';
            var result;
            if (type === 'string') result = a.localeCompare(b);
            else result = a - b;
            return result;
        }
        if (isDesc) return list.sort(compareDesc);
        return list.sort(compareAsc);
    }

    if (typeof obj !== "object") {
        console.warn("unsortable obj ", obj)
        return obj;
    }

    var arr = []
    if (!Array.isArray(obj)) {
        for (var i in obj) {
            arr.push(obj[i])
        }
    } else {
        arr = obj
    }

    return sortObj(arr, key)
}

/**
 * Sort object by key
 * @param {*} obj 
 */
common.sortObj = function(unordered) {
    return Object.keys(unordered).sort().reduce(
        (obj, key) => { 
            obj[key] = unordered[key]; 
            return obj;
        }, 
        {}
    )
}


common.sortElements = function() {
    var sort_by_name = function(a, b) {
        return a.textContent.toLowerCase().localeCompare(b.textContent.toLowerCase());
    }

    var list = $("#table1 > li").get();
    list.sort(sort_by_name);
    for (var i = 0; i < list.length; i++) {
        list[i].parentNode.appendChild(list[i]);
    }
}

/**
 * Strip out non word characters from a text.
 * 
 * @param {String} text - Text to be filtered
 * @returns {String} - Filtered text
 * @since 4.12.9
 */
common.stripNonWordCharacters = function(text="", concatSpace=false) {
    var result = text.replaceAll(/[^\p{L}\p{N}\p{M}\p{Pc}]/gu, " ")
    if (!concatSpace) return result;
    return result.replace(/\s\s+/g, ' ');
}

/**
 * Add slashes to the single quote character
 * @param {String} str 
 * @returns {String}
 */
common.addslashes = function(str) {
    //  discuss at: https://locutus.io/php/addslashes/
    // original by: Kevin van Zonneveld (https://kvz.io)
    // improved by: Ates Goral (https://magnetiq.com)
    // improved by: marrtins
    // improved by: Nate
    // improved by: Onno Marsman (https://twitter.com/onnomarsman)
    // improved by: Brett Zamir (https://brett-zamir.me)
    // improved by: Oskar Larsson Högfeldt (https://oskar-lh.name/)
    //    input by: Denny Wardhana
    //   example 1: addslashes("kevin's birthday")
    //   returns 1: "kevin\\'s birthday"
    return (str + '')
        .replace(/[\\"']/g, '\\$&')
        .replace(/\u0000/g, '\\0')
}

/**
 * Strip backslashes from string
 * @param {String} str - A text to be processed
 * @returns {String} 
 */
common.stripslashes = function(str) {
    //       discuss at: https://locutus.io/php/stripslashes/
    //      original by: Kevin van Zonneveld (https://kvz.io)
    //      improved by: Ates Goral (https://magnetiq.com)
    //      improved by: marrtins
    //      improved by: rezna
    //         fixed by: Mick@el
    //      bugfixed by: Onno Marsman (https://twitter.com/onnomarsman)
    //      bugfixed by: Brett Zamir (https://brett-zamir.me)
    //         input by: Rick Waldron
    //         input by: Brant Messenger (https://www.brantmessenger.com/)
    // reimplemented by: Brett Zamir (https://brett-zamir.me)
    //        example 1: stripslashes('Kevin\'s code')
    //        returns 1: "Kevin's code"
    //        example 2: stripslashes('Kevin\\\'s code')
    //        returns 2: "Kevin\'s code"
    return (str + '')
        .replace(/\\(.?)/g, function (s, n1) {
        switch (n1) {
            case '\\':
            return '\\'
            case '0':
            return '\u0000'
            case '':
            return ''
            default:
            return n1
        }
    })
}

/**
 * function to get a string between first occurance of a prefix and suffix
 * @param {String} str - A text
 * @param {String} prefix - left side of the marker
 * @param {String} suffix - right side of the marker
 * @returns {String} String found between prefix and suffix 
 */
common.extractString = function(str, prefix, suffix) {
    // function to get a string between first occurance of a prefix and suffix;
    var s = str||"";
    var i = s.indexOf(prefix);
    if (i >= 0) {
        s = s.substring(i + prefix.length);
    }
    else {
        return '';
    }
    if (suffix) {
        i = s.indexOf(suffix);
        if (i >= 0) {
            s = s.substring(0, i);
        }
        else {
            return '';
        }
    }
    return s;
};

/**
 * Read the content of the directory
 * @param {String} dir - Path to a directory
 * @returns {String[]} List of the content of the directory
 * @deprecated This function will be removed. Please use async `common.readDir()` instead!
 */
common.getAllFiles = function(dir) {
/*
    read directory contents
*/
    window.fs = window.fs || require("fs");
    var results = [];
    var that = this;
    fs.readdirSync(dir).forEach(function(file) {

        file = dir+'/'+file;
        var stat = fs.statSync(file);

        if (stat && stat.isDirectory()) {
            results = results.concat(that.getAllFiles(file))
        } else results.push(file);

    });

    return results;

};

/**
 * Get a filename from the given path (without extension)
 * @param {String} path 
 * @returns {String} filename
 * @example
 * var filename = common.getFilename('C:/path/to/my/document.txt');
 * // filename will be : document
 */
common.getFilename = function(path) {
    return nwPath.basename(path, nwPath.extname(path))
}

/**
 * Change extension of a path
 * @param {*} path 
 * @param {*} ext 
 * @returns {String} Path with new extension
 * @since 5.1.6
 */
common.changeExtension = function(path, ext) {
    if (!path) return path;
    if (!ext) return ext;
    var basePath = nwPath.basename(path, nwPath.extname(path));
    if (ext[0] == ".") ext = ext.substr(1);
    return nwPath.join(nwPath.dirname(path), basePath+"."+ext);
}

/**
 * Filter filename into a correct window's filename
 * Will replace \ / : " * ? > < | with _
 * @param {*} filename - A filename. Warning: Filename is not a path string 
 * @returns {String} - Sanitized filename
 * @since 5.1.6
 */
common.filterFilename = function(filename) {
    if (!filename) return console.warn("Can not correct a blank filename:", filename);
    return filename.replaceAll(/[\\/:"*?<>|]+/g, "_");
}

/**
 * Merge object recursively
 * @param {Object} target - Target object
 * @param  {...Object} sources - Source objects
 * @returns {Object} merged object
 */
common.mergeDeep = function(target, ...sources) {
    function isObject(item) {
        return (item && typeof item === 'object' && !Array.isArray(item));
    }
  if (!sources.length) return target;
  const source = sources.shift();

  let output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target))
          Object.assign(output, { [key]: source[key] });
        else
          output[key] = this.mergeDeep(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}


/**
 * Detects the type of linebreaks on the string. Whether it is LF or CR LF
 * @param  {String} string
 */
common.detectLineBreak = function(string) {
    if (typeof string !== 'string') return "\n";
    if (/\r\n/g.test(string)) return "\r\n";
    return "\n";
}

/**
 * Convert HTML entities to their corresponding characters
 * @param {String} encodedStr 
 * @returns {String}
 * @example
 * common.htmlEntitiesDecode(`&lt;span&gt;Howdy&lt;/span&gt;`)
 * // will returns : <span>Howdy</span>;
 */
common.htmlEntitiesDecode = function(encodedStr) {
    // function to convert all htmlentities back to character;
    var parser = new DOMParser;
    var dom = parser.parseFromString(
        '<!doctype html><body>' + encodedStr,
        'text/html');
    return dom.body.textContent;    
}

/**
 * Convert all applicable characters to HTML entities
 * @param {String} encodedStr 
 * @returns {String}
 * @example
 * common.htmlEntities(`<span>Howdy</span>`)
 * // will returns : &lt;span&gt;Howdy&lt;/span&gt;
 */
common.htmlEntities = function(string) {
    // encode to htmlentities
    string = string || "";
    var p = document.createElement("p");
    p.textContent = string;
    return p.innerHTML;    
}

/*
common.lineExist = function(haystack, needle, isCaseSensitive) {
    if (typeof haystack !== 'string') return false;
    if (typeof needle !== 'string') return false;
    isCaseSensitive = isCaseSensitive|| false;
    
    
    if (isCaseSensitive) {
        haystackS = haystack.split("\n").map(function(input) {
            return common.stripCarriageReturn(input);
        });
        
        return haystackS.includes(needle);        
        
    }
    
    haystackS = haystack.split("\n").map(function(input) {
        return common.stripCarriageReturn(input.toLowerCase());
    });
    
    return haystackS.includes(needle.toLowerCase());
    
}
*/

common.lineIndex = function(haystack, needle, isCaseSensitive) {
    if (typeof haystack !== 'string') return false;
    if (typeof needle !== 'string') return false;
    isCaseSensitive = isCaseSensitive|| false;
    
    var haystackS
    if (isCaseSensitive) {
        haystackS = haystack.split("\n").map(function(input) {
            return common.stripCarriageReturn(input);
        });
        
        return haystackS.indexOf(needle);        
        
    }
    
    haystackS = haystack.split("\n").map(function(input) {
        return common.stripCarriageReturn(input.toLowerCase());
    });
    
    return haystackS.indexOf(needle.toLowerCase());
    
}

common.lineIndexRegExp = function(haystack, needle) {
    // needle is regex
    if (typeof haystack !== 'string') return false;
    //if (typeof needle !== 'object') return false;
    var haystackS = haystack.split("\n");
    var result = [];
    for (var i=0; i<haystackS.length; i++) {
        var thisLine = common.stripCarriageReturn(haystackS[i]);
        if (needle.test(thisLine)) result.push(i);
        
    }
    
    // return direct index if length = 1
    if (result.length == 1) return result[0];
    return result;
        
}

common.insertLineAt = function(haystack, needle, index, options) {
    if (typeof index == "undefined") return haystack;
    if (index < 0) return haystack;

    options = options||{};
    haystack = haystack||"";
    needle = needle||"";
    index = index||0;
    options.lineBreak = options.lineBreak||"\n";

    var haystackS = haystack.split("\n").map(function(input) {
        return common.stripCarriageReturn(input);
    });

    haystackS[index] = needle;

    return haystackS.join(options.lineBreak);

}

/**
 * Find the first line index at which a sequence of lines occurs in a text.
 * The match is line-aligned: the needle lines must cover whole lines of the
 * haystack. Trailing whitespace and carriage returns are ignored, just like
 * common.lineIndex().
 * @param {String} haystack - A multi-line string to search in
 * @param {String[]} needleLines - The sequence of lines to find
 * @param {Boolean} isCaseSensitive - Compare case sensitively (default false)
 * @returns {Number} The first matching line index, or -1 when not found
 */
common.linesIndex = function(haystack, needleLines, isCaseSensitive) {
    if (typeof haystack !== 'string') return -1;
    if (Array.isArray(needleLines) == false || needleLines.length < 1) return -1;
    isCaseSensitive = isCaseSensitive|| false;

    var normalize = function(input) {
        var line = common.stripCarriageReturn(input).trimEnd();
        if (isCaseSensitive == false) line = line.toLowerCase();
        return line;
    }

    var haystackS = haystack.split("\n").map(normalize);
    var needleS = needleLines.map(normalize);

    for (var i=0; i+needleS.length<=haystackS.length; i++) {
        var found = true;
        for (var j=0; j<needleS.length; j++) {
            if (haystackS[i+j] !== needleS[j]) {
                found = false;
                break;
            }
        }
        if (found) return i;
    }
    return -1;
}

/**
 * Replace a run of lines inside a multi-line string with new content
 * @param {String} haystack - A multi-line string to modify
 * @param {String|String[]} value - The replacement content (a multi-line string or an array of lines)
 * @param {Number} index - The line index to start replacing at
 * @param {Number} lineCount - How many lines to replace
 * @param {Object} options - options.lineBreak is the line break used to join (default "\n")
 * @returns {String}
 */
common.replaceLinesAt = function(haystack, value, index, lineCount, options) {
    if (typeof index == "undefined") return haystack;
    if (index < 0) return haystack;

    options = options||{};
    haystack = haystack||"";
    index = index||0;
    lineCount = lineCount||0;
    options.lineBreak = options.lineBreak||"\n";

    var haystackS = haystack.split("\n").map(function(input) {
        return common.stripCarriageReturn(input);
    });

    if (Array.isArray(value) == false) value = String(value||"").split("\n");
    var valueLines = value.map(function(input) {
        return common.stripCarriageReturn(input);
    });

    Array.prototype.splice.apply(haystackS, [index, lineCount].concat(valueLines));

    return haystackS.join(options.lineBreak);

}

/**
 * Convert a regular expression like string into a regular expression object
 * @param {String} str - A string
 * @returns {RegExp} A regular expression
 */
common.evalRegExpStr = function(str) {
    try {
        if (typeof str == 'string') {
            if (str.substring(0, 1) == '/') return eval(str);
        }
        return new RegExp(str);
    } catch(e) {
        return false;
    }    
}

/**
 * Checks whether a string is a valid regular expression or not
 * @param {String} string - A string to be checked
 * @returns {Boolean} True if a string is a regular expression
 */
common.isRegExp = (string) => {
    try {
        if (string instanceof RegExp) return true;
        if (typeof string == 'string') {
            if (string.substring(0, 1) !== '/') return false;
        }

        return new Function(`
            "use strict";
            try {
                new RegExp(${string});
                return true;
            } catch (e) {
                return false;
            }
        `)();
    } catch(e) {
        return false;
    }
};

/**
 * Check whether a string is Javascript function
 * @param {String} str - A string of javascript function
 * @returns {Boolean} True if the string is Javascript function
 */
common.isStringFunction = function(str) {
    try {
        var result =  eval(str);
        if (typeof result == 'function') return true;
    } catch (e) {
        if (e.toString() == "SyntaxError: Function statements require a function name") return true;
        return false;
    }
    return false;
}

/**
 * Checks whether a string contains any japanese letter.
 * @param {*} string 
 * @returns {Boolean} - True if givent text contains Japanese letter
 */
common.containJapanese = function(string) {
    if (!string) return false;
    return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(string)
}

common.isInLanguage = function(string, language) {
    // language = two digit language code
    if (!string) return false;
    language = language||"";
    string = string||"";
    
    if (language.toLowerCase() == "ja") {
        return common.containJapanese(string);
    }
    
    return true;

}


/**
 * Crops a long text into something like : Lorem ips...sit amet
 * @param {String} string - A very long string
 * @param {Number} max - Maximum length
 * @returns {String} - A shorter string
 */
common.cropLongText = function(string, max) {
    // return long text into something like : Lorem ips...sit amet
    if (typeof string !== 'string') return string;
    max = max||40;
    if (string.length < max) return string;
    var half = Math.round(max/2);
    
    return string.slice(0, half-1)+"…"+string.slice(-half);
}

/**
 * Strip all cariage returns
 * @param {String} input 
 * @returns {String} - A string free of the reeks of MS Windows :)
 */
common.stripCarriageReturn = function(input) {
    input = input||"";
    return input.replace(/\r/g, "");
}

/**
 * Check whether a string is a valid JSON
 * This function will return true if any texts can be compiled through JSON.parse
 * A string like 'null' will return true
 * @param {String} string - A string to be checked
 * @returns {Boolean} True if the string is a valid JSON
 * @example
 * common.isJSON('["Some", "Array"]'); //true
 * common.isJSON('{"Some":"object"}'); //true
 * common.isJSON('"A string"'); //true
 * common.isJSON('null'); //true
 */
common.isJSON = function(string) {
    if (typeof string !== "string") return false;
    try
    {
        JSON.parse(string);
    }
    catch(e)
    {
        return false;
    }    
    return true;
}


/**
 * Check whether a string is a valid JSON object
 * This function will return true only if the text is a JSON object
 * @param {String} string - A string to be checked
 * @returns {Boolean} True if the string is a valid JSON
 * @example
 * common.isJSON('["Some", "Array"]'); //true
 * common.isJSON('{"Some":"object"}'); //true
 * common.isJSON('"A string"'); //false
 * common.isJSON('null'); //false
 */
common.isJSONString = function(str) {
    if (typeof str !== 'string') return false;
    try {
        const result = JSON.parse(str);
        const type = Object.prototype.toString.call(result);
        return type === '[object Object]' 
            || type === '[object Array]';
    } catch (err) {
        return false;
    }
}

/**
 * Test whether the string has number or not
 * Works with shift-jis japanese characters too
 * @param {String} str - String to check
 * @returns {Boolean}
 */
common.hasNumber = function(str) {
    if (!str) return str;
    return /[０-９0-9一-十]/.test(str)
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive)
 * Using Math.round() will give you a non-uniform distribution!
 * @param {Number} min - Minimum number to be randomized
 * @param {Number} max - Max number to be randomized
 * @returns {Number} A random number between min & max (inclusive)
 */    
common.rand = function(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Format a date into YYYY-MM-DD HH:II:SS format
 * @param  {Date} [date]
 * @returns {String} Formatted date
 */
common.formatDate = function(date) {
    //date = date || new Date()
    try {
        date =  new Date(date)
        var str = date.toISOString();
        return str.substr(0, 10)+" "+str.substr(11, 8);
    } catch (e) {
        console.warn(e, "Can not generate date, fallback to the current date", date.toString());
        return "unknown date";
    }

}

/**
 * Format a local time/date
 * |Code|Info|
 * |--|--|
 * |j|Day of the month without leading zeros  (1 to 31)|
 * |d|Day of the month, 2 digits with leading zeros (01 to 31)|
 * |l|(lowercase 'L') A full textual representation of the day of the week|
 * |w|Numeric representation of the day of the week (0=Sunday,1=Monday,...6=Saturday)|
 * |D|A textual representation of a day, three letters|
 * |m|Numeric representation of a month, with leading zeros (01 to 12)|
 * |n|Numeric representation of a month, without leading zeros (1 to 12)|
 * |F|A full textual representation of a month, such as January or March |
 * |M|A short textual representation of a month, three letters (Jan - Dec)|
 * |Y|A full numeric representation of a year, 4 digits (1999 OR 2003)|
 * |y|A two digit representation of a year (99 OR 03)|
 * |H|24-hour format of an hour with leading zeros (00 to 23)|
 * |g|12-hour format of an hour without leading zeros (1 to 12)|
 * |h|12-hour format of an hour with leading zeros (01 to 12)|
 * |a|Lowercase Ante meridiem and Post meridiem (am or pm)|
 * |i|Minutes with leading zeros (00 to 59)|
 * |s|Seconds, with leading zeros (00 to 59)|
 * |c|ISO 8601 date (eg: 2012-11-20T18:05:54.944Z)|
 * @param {String} format 
 * @param {String|Date} [date] 
 * @returns {String} Formatted date
 */
common.date = function(format, date) {
    if (!date || date === "") date = new Date();
    else if (typeof date !== 'object') date = new Date(date.replace(/-/g, "/")); // attempt to convert string to date object

    let string = '',
        mo = date.getMonth(), // month (0-11)
        m1 = mo + 1, // month (1-12)
        dow = date.getDay(), // day of week (0-6)
        d = date.getDate(), // day of the month (1-31)
        y = date.getFullYear(), // 1999 or 2003
        h = date.getHours(), // hour (0-23)
        mi = date.getMinutes(), // minute (0-59)
        s = date.getSeconds(); // seconds (0-59)

    for (let i of format.match(/(\\)*./g))
        switch (i) {
            
            case 'j': // Day of the month without leading zeros  (1 to 31)
                string += d;
                break;

            case 'd': // Day of the month, 2 digits with leading zeros (01 to 31)
                string += (d < 10) ? "0" + d : d;
                break;

            case 'l': // (lowercase 'L') A full textual representation of the day of the week
                var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                string += days[dow];
                break;

            case 'w': // Numeric representation of the day of the week (0=Sunday,1=Monday,...6=Saturday)
                string += dow;
                break;

            case 'D': // A textual representation of a day, three letters
                var days = ["Sun", "Mon", "Tue", "Wed", "Thr", "Fri", "Sat"];// eslint-disable-line
                string += days[dow];
                break;

            case 'm': // Numeric representation of a month, with leading zeros (01 to 12)
                string += (m1 < 10) ? "0" + m1 : m1;
                break;

            case 'n': // Numeric representation of a month, without leading zeros (1 to 12)
                string += m1;
                break;

            case 'F': // A full textual representation of a month, such as January or March 
                var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                string += months[mo];
                break;

            case 'M': // A short textual representation of a month, three letters (Jan - Dec)
                var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];// eslint-disable-line
                string += months[mo];
                break;

            case 'Y': // A full numeric representation of a year, 4 digits (1999 OR 2003)    
                string += y;
                break;

            case 'y': // A two digit representation of a year (99 OR 03)
                string += y.toString().slice(-2);
                break;

            case 'H': // 24-hour format of an hour with leading zeros (00 to 23)
                string += (h < 10) ? "0" + h : h;
                break;

            case 'g': // 12-hour format of an hour without leading zeros (1 to 12)
                var hour = (h === 0) ? 12 : h;
                string += (hour > 12) ? hour - 12 : hour;
                break;

            case 'h': // 12-hour format of an hour with leading zeros (01 to 12)
                var hour = (h === 0) ? 12 : h; // eslint-disable-line
                hour = (hour > 12) ? hour - 12 : hour;
                string += (hour < 10) ? "0" + hour : hour;
                break;

            case 'a': // Lowercase Ante meridiem and Post meridiem (am or pm)
                string += (h < 12) ? "am" : "pm";
                break;

            case 'i': // Minutes with leading zeros (00 to 59)
                string += (mi < 10) ? "0" + mi : mi;
                break;

            case 's': // Seconds, with leading zeros (00 to 59)
                string += (s < 10) ? "0" + s : s;
                break;

            case 'c': // ISO 8601 date (eg: 2012-11-20T18:05:54.944Z)
                string += date.toISOString();
                break;

            default:
                if (i.startsWith("\\")) i = i.substr(1);
                string += i;
        }

    return string;
}

/**
 * Generate unique ID
 * @returns {String} An unique ID
 */
common.generateId = function() {
    var start = new Date().getTime();
    return parseInt(start+""+common.rand(1000,9999));
}

/**
 * Generates ID by randomize alpha numeric character
 * @param {Number} length - Length of the ID 
 * @returns {String} Randomized string
 */
common.makeid = function(length) {
   var result           = '';
   var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   var charactersLength = characters.length;
   for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}

/**
 * Get the current stage path
 * @returns {String}
 */
common.getStagePath = function() {
    //var path = __dirname+"/"+nw.App.manifest.localConfig.defaultStagingPath
    var path = sys.config.stagingPath;
    if (!path) {
        // The startup staging sweep can run before any config branch has materialised
        // stagingPath (fresh profile, first launch). The manifest default is exactly the value
        // loadConfig would set, so sweeping there is safe.
        path = (nw.App.manifest.localConfig || {}).defaultStagingPath;
    }
    return String(path).replace(/\\/g, "/")
}

/**
 * Initialize staging path
 * @param {*} [projectId] - Project ID
 * @param {*} [gameTitle=untitled] - Project Title
 * @param {*} [options={}] - Additional info
 * @returns {Object} - Returns object of cacheInfo
 */
common.initStaging = async function(projectId, gameTitle="Untitled", options={}) {
    projectId ||= this.makeid(10);
    const cachePath = nwPath.join(this.getStagePath(), projectId);
    var cacheFolderData = nwPath.join(cachePath, "data");
    await this.mkDir(cacheFolderData);
    await ui.log(`New staging directory with id ${projectId} has been created!`);

    const info = {
        title: gameTitle,
    }
    await this.filePutContents(nwPath.join(cachePath, "gameInfo.json"), JSON.stringify(info, undefined, 2), "utf8", false);

    return {
        cacheID     : projectId,
        cachePath   : cachePath
    };
}

/**
 * Remove every project cache folder from the staging area.
 *
 * Staging data is regenerable: a .slrproj re-extracts it on open, and a
 * game-folder project re-extracts on creation. So the on-disk cache is only a
 * per-session working area and can be discarded when no project is open.
 * Only folders that look like a project cache (contain a known marker file)
 * are removed, so a custom/shared stagingPath is never harmed.
 * @async
 * @returns {Promise<Boolean>} true if the sweep ran
 */
common.cleanStagingCache = async function() {
    try {
        var stagingPath = nwPath.resolve(this.getStagePath());
        if (!this.isDir(stagingPath)) return false;
        var markers = ["autosave.json", "gameInfo.json", "initial.json", "identity.txt"];
        var entries = fs.readdirSync(stagingPath);
        for (var i = 0; i < entries.length; i++) {
            var entryPath = nwPath.join(stagingPath, entries[i]);
            if (!this.isDir(entryPath)) continue;
            var isCache = markers.some(function(marker) {
                return fs.existsSync(nwPath.join(entryPath, marker));
            });
            if (isCache) await this.rmdir(entryPath);
        }
        return true;
    } catch (e) {
        console.warn("cleanStagingCache failed:", e);
        return false;
    }
}

/**
 * Get the parent directory of a path
 * @param {String} path 
 * @returns {String} Path to the parent directory
 * @deprecated Please use `nwPath.dirname()` instead
 */
common.getDirectory = function(path) {
    return path.substring(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));     
}

/**
 * Get text from selected carret
 * @returns {String}
 */
common.getSelectionText =function() {
    var text = "";
    var activeEl = document.activeElement;
    var activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
    if (
      (activeElTagName == "textarea") || (activeElTagName == "input" &&
      /^(?:text|search|password|tel|url)$/i.test(activeEl.type)) &&
      (typeof activeEl.selectionStart == "number")
    ) {
        text = activeEl.value.slice(activeEl.selectionStart, activeEl.selectionEnd);
    } else if (window.getSelection) {
        text = window.getSelection().toString();
    }
    return text;
}


common.matchAllWords = function(text, searchWords, delimiter){
    delimiter = delimiter||" ";
    if (typeof searchWords == 'string') {
        searchWords = searchWords.replace(/\s+/g,' ').split(" ");
    }
    if (Array.isArray(searchWords) == false) {
        return false;
    }
    if (searchWords.length < 1) return false;
    
    var regex = searchWords
        .map(word => "(?=.*\\b" + word + "\\b)")
        .join('');
    var searchExp = new RegExp(regex, "gi");
    return (searchExp.test(text))? true : false;
}

/**
 * Replace newline (CR or CRLF ) characters with a string
 * @param {String} string 
 * @param {String} newNewLine - A new newline string to replace the existing newlines
 * @returns {String}
 */
common.replaceNewLine = function(string, newNewLine) {
    string = string || "";
    newNewLine = newNewLine||"\r\n";
    return string.replace(/\r?\n/g, newNewLine);
}

/**
 * Read all files within a directory recusively and return **full path** of each file
 * @param {String} dir - Path to a directory
 * @param {String[]} [filelist] - Default file list
 * @returns {String[]} - List of all files within the given directory and its child directories
 * @deprecated use asynchronous common.readDir() instead
 */
common.dirContentSync = function(dir, filelist) {
    // read all files within a directory recusively and return full path of each file
    var path = path || require('path');
    var fs = fs || require('fs'),
        files = fs.readdirSync(dir);
    filelist = filelist || [];
    var that = this;
    files.forEach(function(file) {
        if (fs.statSync(path.join(dir, file)).isDirectory()) {
            filelist = that.dirContentSync(path.join(dir, file), filelist);
        }
        else {
            filelist.push(path.join(dir, file));
        }
    });
    return filelist;
};

/**
 * Read all files within a directory recusively and return **relative path** of each file
 * @async
 * @param {String} dir - Path to a directory
 * @returns {Promise<String[]>} List of all files within the given directory and its child directories
 */
common.readDir = async function(dir) {
    return new Promise((resolve, reject) => {
        fs.readdir(dir, (error, files) => {
            if (error) {
                return reject(error);
            }
            Promise.all(files.map((file) => {
                    return new Promise((resolve, reject) => {
                        const filepath = nwPath.join(dir, file);
                        fs.stat(filepath, (error, stats) => {
                            if (error) {
                                return reject(error);
                            }
                            if (stats.isDirectory()) {
                                this.readDir(filepath).then(resolve);
                            } else if (stats.isFile()) {
                                resolve(filepath);
                            }
                        });
                    });
                }))
                .then((foldersContents) => {
                    resolve(foldersContents.reduce((all, folderContents) => all.concat(folderContents), []));
                });
        });
    });
}

/**
 * Check whether a path is directory or not
 * @param {String} dirPath - Path to check
 * @returns {Boolean} True if path is exist and is directory
 */
common.isDir = function(dirPath) {
    if (!dirPath) return false;
    var fs = fs || require('fs');
    return  fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
}


/**
 * Check whether a path is a file or not
 * @param {String} path - Path to check
 * @returns {Boolean} True if path is exist and is a file
 */
common.isFile = function(path) {
    if (!path) return false;
    var fs = fs || require('fs');
    return  fs.existsSync(path) && fs.lstatSync(path).isFile();
}

/**
 * Check whether a path is exist
 * @param {String} path - Path to check
 * @returns {Boolean} True if path is exist
 */
common.isExist = function(path) {
    if (!path) return false;
    var fs = fs || require('fs');
    return  fs.existsSync(path);
}

/**
 * Check whether a path is exist
 * @async
 * @param {String} path - Path to check
 * @returns {Boolean} True if path is exist
 */
common.isExistAsync = async function(path) {
    if (!path) return false;
    var fs = fs || require('fs');
    return new Promise((resolve, reject) => {
        fs.access(path, error => {
            if (!error) {
                // The check succeeded
                resolve(true)
            } else {
                // The check failed
                resolve(false)
            }
        });
    })
}

/**
 * Check whether two path is related as parent-child directory
 * @param {String} path1
 * @param {String} path2 
 * @returns {Boolean} True if two path is related as a parent-child directory.
 */
common.isRelated = function(path1, path2) {
    // check if two path is relative to each other
    if (typeof path1 !== 'string') return console.warn("String is expected for argument1, got", path1)
    if (typeof path2 !== 'string') return console.warn("String is expected for argument2, got", path2)
    if (path2.length < path1.length) {
        var pathx = path1;
        path1 = path2;
        path2 = pathx;
    }
    path1 = nwPath.normalize(path1);
    path2 = nwPath.normalize(path2);
    //var result = nwPath.relative(path1, path2);
    var result = path2.substring(0, path1.length);
    if (result == path1) return true;
    return false;
}

/**
 * Get relative path between two path
 * @param {String} longPath - A long path
 * @param {String} shortPath - A shorter path
 * @returns {String} get relative path between two path
 * @example 
 * common.getRelativePath('/path/to/a/directory/', '/path/to/')' // returns a/directory/
 */
common.getRelativePath = function(longPath, shortPath) {
    console.log("Get relative path:", longPath, shortPath);
    if (shortPath.length > longPath.length){
        var tempPath = shortPath;
        longPath = shortPath;
        shortPath = tempPath;
    }
    longPath = longPath.replaceAll("\\", "/");
    var result = longPath.substr(shortPath.length);
    if (result[0] == "/") result = result.substr(1);
    return result;
}

/**
 * Get base **directory path** from collection of path
 * @param  {String|String[]} files
 * @example
 * var paths = [
 *     "/some/path/to/a/directory/",
 *     "/some/path/to/a/directory/and/a/file/",
 *     "/some/path/to/a/directory/and/a/file/1.txt",
 *     "/some/path/to/a/directory/and/a/file/2.txt",
 *     "/some/path/to/a/directory/and/a/file/3.txt",
 * ]
 * common.getBasePath(paths); // return: /some/path/to/a
 */
 common.getBasePath = function(files) {
    if (typeof files == "string") files = [files];
    var shortest = {
        path    :"",
        length  :Infinity
    }
    for (var i in files) {
        if (typeof files[i] !== "string") continue;
        files[i] = files[i].replaceAll(/\\/g, "/");
        var count = (files[i].match(/\//g) || []).length;
        if (count < shortest.length) {
            shortest.path = files[i];
            shortest.length = count;
        } 
    }
    return nwPath.dirname(shortest.path);
}

/**
 * Get the relative path from the last occurance of a directory/node
 * @param  {String} path - The full path
 * @param  {String} node - Directory name/node
 * @param  {Boolean} includeNode
 */
common.getRelativePathFromNode = function(path, node, includeNode) {
    //var delimiter = "?--"+Math.random()+"--?"
    path = path.replaceAll("\\", "/");
    node = node.replaceAll("\\", "/");
    if (node.substring(node.length-1) !== "/") node = "/"+node+"/"
    var parts = path.split(node);
    var last = parts[parts.length - 1];
    if (includeNode) return nwPath.join(node.substr(1), last).replaceAll("\\", "/");
    return last;
}

/**
 * Open windows explorer to a path and folder
 * @param {String} path 
 * @param {String} folder 
 */
common.openExplorer = function(path, folder) {
    var exec;
    if (typeof window.exec  == "undefined") {
        window.exec = require('child_process').exec;
        exec = window.exec;
    }
    if (typeof path == 'undefined') {
        exec(common.IS_WIN ? 'explorer' : 'xdg-open .');
    } else {
        console.log("opening "+path);
        if (common.IS_WIN) {
            if (Boolean(folder) == true) {
                exec('explorer /root,"'+path+'"');
            } else {
                exec('explorer /select,"'+path+'"');
            }
        } else {
            // Linux/Mac: open the containing folder (best-effort "select").
            try {
                var stats = fs.statSync(path);
                var target = stats.isDirectory() ? path : nwPath.dirname(path);
                exec('xdg-open "'+target+'"');
            } catch (e) {
                exec('xdg-open "'+path+'"');
            }
        }
    }
}

/**
 * Get row and column of the cursorPos character
 * @param {String} text 
 * @param {Number} cursorPos 
 * @returns {Object} {row, col}
 * @example
 * common.cursorPosInfo('Lorem\nIpsum\ndolor sit amet', 9);
 * // result: {row: 2, col: 3}
 * 
 * common.cursorPosInfo('Lorem\nIpsum\ndolor sit amet', 6);
 * // cursor possition on newline character, result: {row: 1, col: 6}
 */
common.cursorPosInfo = function(text, cursorPos) {
    var result = {};
    console.log("cursorPos: ", cursorPos);
    var prevLines = text.substr(0, cursorPos).split("\n");
    result.row = prevLines.length;
    if (result.row > 1) {
        result.col = prevLines[prevLines.length - 1].length; // new Line is counted
        if (result.col == 0) {
            // line break char
            result.col = prevLines[prevLines.length - 2].length + 1; // new Line is counted
        }
    } else {
        result.col = cursorPos;
    }
    return result;
}

/**
 * get maximum line's length of text 
 * @param {String} text 
 * @returns {Number} The maximum horizontal's characters count of the text
 */
common.maxLength = function(text) {
    // get maximum length of text 
    text = text || "";
    var maxLength = 0;
    var rows = text.split("\n");
    for (var i=0; i<rows.length; i++) {
        if (rows[i].length > maxLength) maxLength = rows[i].length;
    }
    return maxLength;
}

/**
 * Compare two version
 * @param {String} v1 - Version string 1
 * @param {String} v2 - Version string 2
 * @returns Returns `1` if `v1 > v2`
 * Returns `0` if `v1 = v2`
 * Returns `-1` if `v1 < v2`
 */
common.compareVersion = function(v1, v2) {
    if (typeof v1 !== 'string') return false;
    if (typeof v2 !== 'string') return false;
    v1 = v1.split('.');
    v2 = v2.split('.');
    const k = Math.min(v1.length, v2.length);
    for (let i = 0; i < k; ++ i) {
        v1[i] = parseInt(v1[i], 10);
        v2[i] = parseInt(v2[i], 10);
        if (v1[i] > v2[i]) return 1;
        if (v1[i] < v2[i]) return -1;        
    }
    return v1.length == v2.length ? 0: (v1.length < v2.length ? -1 : 1);
}

/**
 * Return Array of row indexes by HOT getSelected() 
 * This function will only calculate rows.
 * Alias of `common.gridRangeToArray()`
 * @param {CellRange} [currentSelection=trans.grid.getSelectedRange()] - Cell range
 * @returns {Number[]} Returns a single dimensional array of rows
 * @deprecated Use common.gridRangeToArray() instead. This function will be deleted in the future.
 */
common.gridRangeToArray = function(currentSelection) {
    // return Array of list of index by HOT getSelected() 
    currentSelection = currentSelection||trans.grid.getSelectedRange()||[[]];
    var rowPool = [];
    var rowIndex = {};
    console.log("Current selection:", currentSelection);
    for (var i in currentSelection) {
        if (currentSelection[i].constructor.name !== "CellRange") continue;
        currentSelection[i].forAll((row, col)=>{
            rowIndex[row] = true;
        })
    }
    for (var thisRow in rowIndex) {
        rowPool.push(parseInt(thisRow));
    }    
    return rowPool;
}

/**
 * Return Array of row indexes by HOT getSelected() 
 * This function will only calculate rows.
 * @param {CellRange} [currentSelection=trans.grid.getSelectedRange()] - Cell range
 * @returns {Number[]} Returns a single dimensional array of rows
 */
common.gridSelectedRows = function(currentSelection) {
    /* return Array of list of index by HOT getSelected() */
    
    currentSelection = currentSelection||trans.grid.getSelectedRange()||[[]];
    var rowPool = [];
    var rowIndex = {};
    console.log("Current selection:", currentSelection);
    for (var i in currentSelection) {
        if (currentSelection[i].constructor.name !== "CellRange") continue;
        currentSelection[i].forAll((row, col)=>{
            rowIndex[row] = true;
        })
    }
    for (var thisRow in rowIndex) {
        rowPool.push(parseInt(thisRow));
    }    
    return rowPool;
    
}

/**
 * Return Array of column indexes by HOT getSelected() 
 * This function will only calculate rows.
 * @param {CellRange} [currentSelection=trans.grid.getSelectedRange()] - Cell range
 * @returns {Number[]} Returns a single dimensional array of rows
 */
common.gridSelectedCols = function(currentSelection) {
    /* return Array of list of index by HOT getSelected() */
    
    currentSelection = currentSelection||trans.grid.getSelectedRange()||[[]];
    var colPool = [];
    var colIndex = {};
    console.log("Current selection:", currentSelection);
    for (var i in currentSelection) {
        if (currentSelection[i].constructor.name !== "CellRange") continue;
        currentSelection[i].forAll((row, col)=>{
            colIndex[col] = true;
        })
    }
    for (var thisCol in colIndex) {
        colPool.push(parseInt(thisCol));
    }    
    return colPool;

}

/**
 * Return Array of selected cells 
 * This function will only calculate rows.
 * @param {CellRange} [currentSelection=trans.grid.getSelectedRange()] - Cell range
 * @returns {CellCoords[]} Returns an array of CellCoords
 */
common.gridSelectedCells = function(currentSelection) {
    //console.warn("gridSelectedCells Current selection", JSON.stringify(currentSelection));
    currentSelection = currentSelection||trans.grid.getSelectedRange()||[[]];
    var cellPool = [];
    for (var i in currentSelection) {
        if (currentSelection[i].constructor.name !== "CellRange") {
            //todo handler for non CellRange object
            
            continue;
        }
        cellPool = cellPool.concat(currentSelection[i].getAll());
    }
    return cellPool;
}


common.cutTextOnPreviousWord = function(string, where) {
    if (!where) return {
        first:string,
        rest:""
    };
    var wrap = this.wordwrap(string, where);
    var lines = wrap.split("\n");
    var result = {}
    result.first = lines.shift();
    result.rest = lines.join("\n");
    return result;
}

common.splitTextToNLine = function(string, line) {
    console.log("Cut text", string, "by line:", line);
    if (string.length <= line) return string;
    var lengthPerLine = Math.round(string.length/line);
    console.log("length per line=", lengthPerLine);
    var wrapped = this.wordwrap(string, Math.round(string.length/line))

    var lines = wrapped.split("\n");
    if (lines < line) return wrapped;
    var slice1 = lines.slice(0, line-1);
    var slice2 = lines.slice(line-1);

    slice1.push(slice2.join(" "));
    return slice1.join("\n");
}

/**
 * Copy formatting such as indent, number of line etc from formattedText into textToFormat
 * @since 4.7.16
 * @param {String[]} formattedText - Array of string to copy
 * @param {String} textToFormat - Text to be formatted
 * @returns {String[]} Array of string
 */
common.cloneFormatting = function(formattedText=[], textToFormat="") {
    console.log("Clone formatting", arguments);
    if (typeof formattedText == "string") formattedText = [formattedText];
    
    var result = [];
    var formattedTextInfo = [];
    var totalLength = 0;
    for (var i=0; i<formattedText.length; i++) {
        formattedTextInfo[i] = {
            length:formattedText[i].length
        }
        totalLength += formattedText[i].length;
    }
    console.log("Total length is", totalLength, formattedTextInfo);

    var textToProcess = textToFormat;
    for (let i=0; i<formattedText.length; i++) {
        var thisFormatted = formattedText[i];
        var numberOfLine = thisFormatted.split("\n").length;

        var ratio = formattedTextInfo[i].length / totalLength;
        console.log("Current ratio of ", i, "is", ratio);
        var expectedRatio = textToFormat.length * ratio;
        console.log("Expected ratio is",  expectedRatio, "from", textToFormat.length);

        var currentText = textToProcess;
        console.log(i, formattedText.length-1);
        var cutText = {};
        if (i < formattedText.length-1) {
            cutText = this.cutTextOnPreviousWord(textToProcess, Math.round(expectedRatio));
            console.log("cutText result:", cutText);
            currentText = cutText.first;
        } 

        result.push(this.splitTextToNLine(currentText, numberOfLine))

        console.log("Text to process:", textToProcess);
        if (cutText.rest) textToProcess = cutText.rest;

    }

    return result;
}

/**
 * Copy left indentation of the source text to target text
 * @param {String} sourceText - Source text to copy the indentation formatting
 * @param {String} targetText - Target text to format
 * @returns {string} formatted text
 * @since 5.6.2
 */
common.copyIndentation = function(sourceText, targetText) {
    const sourceTexts = sourceText.split("\n");
    var targetTexts = targetText.split("\n");

    var results = []
    for (var i=0; i<targetTexts.length; i++) {
        if (!sourceTexts[i]) {
            results[i] =targetTexts[i];
            continue;
        }
        let trimmed = sourceTexts[i].trimStart();
        let paddingLength = sourceTexts[i].length - trimmed.length;
        results[i] = sourceTexts[i].substring(0, paddingLength)+targetTexts[i].trimStart();
    }

    return results.join("\n")
}

/**
 * Copy the starting whitespace from sampleText to targetText
 * @param {String} sampleText - Text to copy the indentation from
 * @param {String} targetText - Destination text 
 * @returns {String}
 * @since 5.6.17
 */
common.copyStartingWhiteSpaces = function(sampleText="", targetText="") {
    const whiteSpaces = sampleText.length - sampleText.trimStart().length;
    if (!whiteSpaces) return targetText.trimStart();
    return sampleText.substring(0, whiteSpaces) + targetText.trimStart();
}

/**
 * Split text into sentences
 * @param {String} text - Text
 * @param {String} langCode - Two character language code
 * @param {Boolean} [mergeLine=false] - Merge the lines before processing.
 * @returns {String[]} - Array of sentences
 */
common.splitSentences = function(text, langCode="en", mergeLine=false) {
    if (mergeLine) {
        text = text.replaceAll("\r", "").replaceAll("\n", " ");
    }
    if (!text) return [];
    const segmenter  = new Intl.Segmenter(langCode, {
        granularity: "sentence"
    })

    return  Array.from(
        segmenter.segment(text),
        s => s.segment
    )
}

/**
 * Split text into words
 * @param {String} text - Text
 * @param {String} langCode - Two character language code
 * @returns {String[]} - Array of words
 */
common.splitWords = function(text, langCode="en") {
    if (!text) return [];
    const segmenter  = new Intl.Segmenter(langCode, {
        granularity: "word"
    })

    return  Array.from(
        segmenter.segment(text),
        s => s.segment
    )
}

common.copyFormattingByNumberOfSentence = function(sampleText, text, sampleTextLangCode, langCode) {
    sampleTextLangCode||= trans.getSl();
    langCode||= trans.getTl();
    var result = [];

    var textSentences = common.splitSentences(text, langCode, true);
    const sampleTexts = sampleText.replaceAll("\r", "").split("\n");
    for (let i=0; i<sampleTexts.length; i++) {
        let thisLineSentencesNum = this.splitSentences(sampleTexts[i], sampleTextLangCode).length;
        if (textSentences.length <= thisLineSentencesNum) return textSentences.join(" ");
        result.push((textSentences.splice(0, thisLineSentencesNum)).join(" "))

    }
    if (textSentences.length) result.push(textSentences.join(" "));
    return result.join("\n")
}

/**
 * Search a needle in a haystack, and returns all occurance.
 * like indexOf, but return all occurance as an array;
 * @param {Array} sourceArray - Haystack
 * @param {*} find - Needle
 * @returns {Array} Array of occurance
 */
common.indexOfAll = function(sourceArray, find) {
    var result = [];
    if (Array.isArray(sourceArray) == false) return result;
    if (!find) return result;
    for (var i=0; i<sourceArray.length; i++) {
        if (sourceArray[i] !== find) continue;
        result.push(i);
    }
    return result;
}

/**
 * search in the sourceArray and put it on the targetArray
 * @param {String[]} sourceArray 
 * @param {String[]} targetArray 
 * @param {String} find - The string to be found
 * @param {String} put - The string to put into
 * @param {Object} options 
 * @param {Object} [options.overwrite=false] - Whether to overwrite the target value if exists or not
 * @returns {String[]}
 */
common.searchReplaceArray = function(sourceArray, targetArray, find, put, options) {
    sourceArray = sourceArray||[];
    targetArray = targetArray||[];
    put = put||"";
    options = options||{};
    options.overwrite = options.overwrite||false;

    for (var i=0; i<sourceArray.length; i++) {
        if (sourceArray[i] !== find) continue;
        if (options.overwrite==false && Boolean(targetArray[i])) continue;
        targetArray[i] = put;
    }
    return targetArray;
    
}

/**
 * Generates a duplicate of Javascript Object.
 * Only works for the plain javascript object
 * @param {Object} source - Original object
 * @returns {Object} Detached and a clone of the object
 */
common.clone = function(source) {
    if (typeof source == 'undefined') return undefined;
    return JSON.parse(JSON.stringify(source));
}

/**
 * Copy file(s)/directory(s) from one to another location
 * @param {String|String[]} from - The source path
 * @param {String|String[]} to - Target path
 * @param {function(from, to, result)} callback 
 * @returns {}
 */
common.copy = function(from, to, callback) {
    var bCopy = require('www/js/lib/bigCopy.js');
    callback = callback || function(){};
    return bCopy(from, to, {useShell:true})
    .then((result) => {
        callback.call(this, from, to, result);
    });
    
}

/**
 * List the content of a directory (not including the sub directory)
 * @param {String} directory - Directory to check
 * @param {String} filter - The filter
 * @returns {String[]} The list of the file(s) and directory(s) inside the given path
 * @todo make filtering works
 */
common.getAll = async function(directory, filter) {
    // get file from directory
    var resolver;
    var thisPromise = new Promise((resolve, reject)=>{
        resolver = resolve;
    });    
    fs.readdir(directory, (err, files)=>{
        resolver(files)
    })
    return thisPromise;
}


/**
 * List the content of a directory (non including the sub directory)
 * And whitelist the result with the given extension
 * @async
 * @param {String} directory - Directory to check
 * @param {String} extensions - Extension 
 * @returns {Promise<String[]>} The list of the file(s) and directory(s) inside the given path that match the given extension
 */
common.getAllExt = async function(directory, extensions) {
    // get file from directory
    var dirContent     = await this.getAll(directory);
    var result         = [];
    if (Array.isArray(extensions) == false) extensions = [extensions];
    
    for (var i in dirContent) {
        var ext = nwPath.extname(dirContent[i]).toLowerCase().substring(1);
        if (extensions.includes(ext)) result.push(dirContent[i]);
    }
    
    return result;
}

/**
 * Escapes path like shell command parameter
 * @param {String} str - shell command parameter
 * @returns {String} Escaped sttring
 */
common.escapeCmdPath = function(str) {
    return `"${str}"`
}

/**
 * Escape string found in a text
 * This function by default will prevents double escape.
 * Means: the text that has already been escaped will not escaped
 * @since 5.5.2
 * @param {String} text 
 * @param {String} find 
 * @param {String} escapeStr 
 * @returns {String}
 */
common.escapeString = function(text, find, escapeStr) {
    if (!text) return text;
    if (!text.includes(find)) return text;
    if (!this._escapeSeedPlaceholder) this._escapeSeedPlaceholder = "_escapeSTR_"+this.generateId();

    text = text.replaceAll(escapeStr, this._escapeSeedPlaceholder);
    text = text.replaceAll(find, escapeStr);
    text = text.replaceAll(this._escapeSeedPlaceholder, escapeStr);
    return text;
}

/**
 * Run process or external application asynchronously
 * @async
 * @param {String} command - The shell command or path to the application
 * @param {String} args - Arguments of the shell command
 * @param {Options} [options] - See also options for nodeJs' [child_process.spawn](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options) command 
 * @param {function(String)} [options.onData] - Function to run when receives console output from the apps 
 * @param {function(String)} [options.onDone] - Function to run when the process is completed
 * @param {function(String)} [options.onError] - Function to run when receives stderr output
 * @returns {Promise<String>} the shell output of the execution (if any)
 */
common.aSpawn = async function(command, args, options) {
    if(this.debugLevel() > 1) console.log(arguments);
    args = args || [];
    if (Array.isArray(args) == false) args = [args];
    options         = options||{};
    options.args     = options.args||{};
    options.onData     = options.onData||function(result, e) {};
    options.onDone     = options.onDone||function(result, e) {};
    options.onError = options.onError||function(result, e) {};
    //options.onReceive = options.onReceive||function(result, e) {};
    var resolver;
    var rejecter; // eslint-disable-line
    var thisPromise = new Promise((resolve, reject)=>{
        resolver = resolve;
        rejecter = reject;
    });    
    
    //if (command.includes(' ')) command = this.escapeCmdPath(command); <-- this caused problems, don't even try this
    
    var maxOutputBuffer = 64 * 1024 * 1024;
    var outputBuffer = "";
    var child = spawn(command, args, options);
    
    child.stdout.on('data', function (data) {
        //console.log('stdout: ' + data);
        if (outputBuffer.length < maxOutputBuffer) {
            outputBuffer += data;
        }
        //console.log("Received buffer : "+data);
        options.onData.call(this, data);
        //options.onReceive.call(this, data);
        if (common.debugLevel() > 0) console.log(data.toString());
    });

    child.stderr.on('data', function (data) {
        console.warn('stderr: ' + data);
        options.onError.call(this, data);
        
    });

    child.on('close', function (code) {
        console.log('child process exited with code ' + code);
        //console.log("data is : "+outputBuffer);
        var result = outputBuffer;
        if (common.isJSON(outputBuffer)) {
            result = JSON.parse(outputBuffer)
        }
        options.onDone.call(this, result, code);
        resolver(result);
    });

    child.on('error', function (err) {
        console.error('spawn error:', err);
        options.onError.call(this, err);
        rejecter(err);
    });

    return thisPromise;
}

/**
 * Extract an archive file
 * @async
 * @param {String} from - Archive file location
 * @param {String} to - A path to a directory, where you want to place the extracted files
 * @param {Object} [options]
 * @param {string} [options.sourceFilter] - Glob pattern to filter what files you want to extract
 * @returns {Promise<Boolean>} True if success
 */
common.extract = async function(from, to, options) {
    options = options || {};
    options.sourceFilter;

    // extract archive using 7za.exe
    var exe = this.get7zipBin();
    try {
        if (options.password) {
            await this.aSpawn(exe, ['x', from, '-o'+to, '-p'+options.password, '-r', '-y'])
        } else if (options.sourceFilter) {
            await this.aSpawn(exe, ['x', from, '-o'+to, options.sourceFilter, '-r', '-y'])
        } else {
            await this.aSpawn(exe, ['x', from, '-o'+to, '-r', '-y'])
        }
    } catch (e) {
        console.warn(e);
        return false;
    }
    
    return true;
}

/**
 * Pack a file or folder to an archive file
 * @async
 * @param {String} from - A path to the file/folder to be packed
 * @param {String} to - Path to the resulted archive file
 * @param {Object} options 
 * @returns {Promise<String>} Path to the newly created archive 
 */
common.pack = async function(from, to, options) {
    options = options || {};

    // extract archive using 7za.exe
    var exe = this.get7zipBin();
    try {
        await this.aSpawn(exe, ['a', to, from, '-r'])
    } catch (e) {
        console.warn(e);
        return "";
    }
    return to;
}
    
/**
 * Set value from string `path.to.object`
 * @param {String} stringVar - Dot separated path to an object
 * @param {*} value - Value of the variable
 * @param {*} [force] - Force to create object path if such path does not exist
 * @returns {Boolean}
 * @example
 * var sampleObj = {};
 * 
 * // We can initialize a variable like this:
 * sampleObj.value = "Howdy!"; 
 * // success because the parent object of the value is exist.
 * 
 * // We expect that we can initialize a nested object like this
 * sampleObj.path.to.inexistent.obj = "Howdy!"; 
 * // But unfortunately thiw will generates error with message: Uncaught TypeError: Cannot read property 'to' of undefined
 * 
 * // Now we can quickly fix this with the following command
 * common.varAsStringSet('sampleObj.path.to.inexistent.obj', "Howdy!", true);
 * console.log(sampleObj.path.to.inexistent.obj);
 * // will print out: Howdy!
 */
common.varAsStringSet = function(stringVar, value, force) {
    try {
        var autosetPath = stringVar.split(".")
        if (autosetPath.length < 1) return false;

        var thisObj = window;
        for (var i=0; i<autosetPath.length-1; i++) {
            if (force) {
                if (typeof thisObj[autosetPath[i]] == 'undefined') {
                    thisObj[autosetPath[i]] = {};    
                }
            }
            thisObj = thisObj[autosetPath[i]];

            
        }
        thisObj[autosetPath[autosetPath.length-1]] = value;

    } catch (e) {
        return false;
    }
    return true;
}

common.setPropertyByPath = function(rootObj={}, stringVar, value, force) {
    try {
        var thisObj = rootObj;

        var autosetPath = stringVar.split(".")
        if (autosetPath.length < 1) {
            if (force) {
                thisObj = value;
                return thisObj;
            }
            throw new Error("Can not set object with empty path string");
        }

        for (var i=0; i<autosetPath.length-1; i++) {
            if (force) {
                if (typeof thisObj[autosetPath[i]] == 'undefined') {
                    thisObj[autosetPath[i]] = {};    
                }
            }
            thisObj = thisObj[autosetPath[i]];

            
        }
        thisObj[autosetPath[autosetPath.length-1]] = value;

    } catch (e) {
        throw new Error(e.toString)
    }
    return rootObj;
}


/**
 * Get value from object string
 * @param {*} stringVar 
 * @returns {*} False if failed
 */
common.varAsStringGet = function(stringVar) {
    try {
        var x = eval("window."+stringVar);
        return x;

    } catch (e) {
        return false;
    }

}

/**
 * Check if the str is a numeric
 * @param  {String|Number} str - Text or number to check
 * @returns {Boolean} True if str is numeric
 */
common.isNumeric = function(str) {
    if (typeof str != "string") return false // we only process strings!  
    return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
            !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
  }

  /**
   * Check whether a buffer has a Byte Order Mark (BOM)
   * @param {Buffer|Array|String} buff - Supported buffer type
   * @returns {Boolean}
   */
common.isBomBuffer = function(buff) {
    buff = Buffer.from(buff);
    var signature = {
        utf8: Buffer.from([0xEF, 0xBB, 0xBF]),
        utf16le: Buffer.from([0xFF, 0xFE]),
        utf16be: Buffer.from([0xFE, 0xFF]),
        utf32le: Buffer.from([0xFF, 0xFE, 0x00, 0x00]),
        utf32be: Buffer.from([0x00, 0x00, 0xFE, 0xFF])        
    }
    
    for (var i in signature) {
        var sample = buff.slice(0, signature[i].length);
        if (Buffer.compare(sample, signature[i]) == 0) return true;
    }
    return false

}


common.openedFileEncoding = {};
common.openedFileBom = {};

/**
 * Reads entire file into a string
 * @async 
 * @param {String} file - Path to the file 
 * @param {*} [encoding] - Character encoding of the file
 * @property {String[]} common.openedFileEncoding - List of the file encoding of the previously opened file
 * @property {String} common.lastFileEncoding - File encoding of the last file
 * @property {Boolean} common.lastFileEncodingBom - Whether the last opened file has a BOM or not
 * @returns {Promise<String>} The entire content of the file
 */
common.fileGetContents = async function(file, encoding) {
    console.log("fileGetContents :", file, common.getOrigin());
    return new Promise((resolve, reject) => {
        fs.readFile(file, async (err, data) => {
            if (err) return reject(err);
            // zero sized file
            if (data.length == 0) { 
                resolve("");
                return
            }

            //var thisEncoding = encoding || this.detectEncoding(data);
            var thisEncoding = await this.detectFileEncoding(file, encoding);
            if (!thisEncoding) thisEncoding = 'UTF8';
            var result;
            try {
                console.log("encoding file with ", thisEncoding);
                result = iconv.decode(data, thisEncoding);
            } catch (e) {
                console.warn(`Unable to determine encoding for file: ${file} 'UTF8'`, e);
                thisEncoding = 'UTF8'
                result = iconv.decode(data, thisEncoding);
            }
            common.openedFileEncoding[file] = thisEncoding
            common.lastFileEncoding         = thisEncoding;
            common.lastFileEncodingBom         = common.isBomBuffer(data);
            common.openedFileBom[file]         = common.lastFileEncodingBom;
            resolve(result)
        })    
    })
} 



/**
 * Get encoding of file opened with common.fileGetContents
 * @param  {String} file - Path to a file
 * @returns {String} The file encoding
 */
common.getOpenedFileEncoding = function(file) {
    return common.openedFileEncoding[file]
}

/**
 * Get BOM of file opened with common.fileGetContents
 * @param  {String} file - Path to a file
 * @returns {Boolean} True if BOM
 */
common.getOpenedFileBom = function(file) {
    return common.openedFileBom[file]
}

/**
 * Reads a chunk of data from a file
 * @async
 * @param {String} file - Path to a file
 * @param {Number} offset - The starting point of the chunk
 * @param {Number} length - The length of the chunk
 * @returns {Promise<Buffer>} Chunk of the file in Buffer format
 */
common.readChunk = async function(file, offset, length) {
    offset    = offset || 0;
    length    = length || 1024;
    var size = await common.getFileSize(file);
    if (size-offset < length) length = size-offset;
    return new Promise((resolve, reejct) => {
        fs.open(file, 'r', function postOpen(errOpen, fd) {
            fs.read(fd, Buffer.alloc(length), 0, length, offset, function postRead(errRead, bytesRead, buffer) {
                resolve(buffer);
            });
        });
    })
}

/**
 * Detects the character encoding of the input
 * @param {Buffer|Array|String} input - The string or buffer of the input
 * @returns {String} The detected character encoding
 */
common.detectEncoding = function(input) {
    this.jsChardet = this.jsChardet || require("jschardet");
    const maxLength = 1024*256;
    var result = this.jsChardet.detect(input.subarray(0, maxLength));
    if (Array.isArray(result)) {
        return result[0].encoding;
    }
    return result.encoding;
}

/**
 * Returns standarized encoding name
 * @param {String|String[]} string - Encoding name
 * @returns {String|String[]} - Standarized encoding name
 */
common.getEncodingName = function(string) {
    if (!string) return "";
    const normalizeEncoding = (str)=> {
        str = str.toLowerCase().trim();
        str = str.replace("utf-", "utf");
        str = str.replace("sjis", "shift-jis");
        str = str.replaceAll("_", "-");
        return str;
    }

    if (Array.isArray(string)) {
        let result = [];
        for (let i in string) {
            result.push(normalizeEncoding(string[i]))
        }
        return result;
    } else {
        return normalizeEncoding(string)
    }
}

common.detectFileEncodingNative = async function(filePath) {
    // On Windows, process arguments are decoded using the system ANSI code
    // page, so a non-ASCII file path (e.g. a file inside a Japanese game
    // folder on an English locale) is mangled into "????????" before `file`
    // ever sees it. When the path contains non-ASCII characters, stream the
    // file's bytes into `file`'s stdin so no path is placed on the command
    // line. ASCII paths keep the original argument form (unchanged behavior).
    if (/[^\x00-\x7F]/.test(filePath)) {
        return await common.detectEncodingFromStream(filePath);
    }

    var output;
    if (this.IS_WIN) {
        const binPath = "3rdParty\\GnuWin32\\bin\\file.exe";
        var escapedFilePath = `"${filePath}"`;
        output = await common.aSpawn(binPath, ["--mime-encoding", escapedFilePath], { shell:true });
        output = output.split(";");
    } else {
        // Use the system `file` utility (present on every Linux distro).
        output = await common.aSpawn("file", ["--mime-encoding", filePath]);
        output = output.split(":");
    }
    // Not an error: this is the cue for the in-process fallback in detectFileEncoding, which
    // detects over a bounded sample of the file when the native tool is absent or failed.
    if (typeof output[1] !== "string") return console.log("Native encoding detection unavailable for ", filePath)
    return output[1].trim();
}

/**
 * Detect a file's encoding by piping its bytes into `file --mime-encoding -`.
 * Locale-safe fallback for non-ASCII file paths (see detectFileEncodingNative):
 * the path is opened with Node's fs (Unicode-aware) and only the file's bytes
 * reach the `file` process, so the path never touches argv. Works on every
 * system locale.
 * @param {String} filePath - Path to the file
 * @returns {Promise<String|undefined>} Detected encoding, or undefined on failure
 */
common.detectEncodingFromStream = function(filePath) {
    var binPath = common.IS_WIN
        ? nwPath.join(common.getRootDir(), "3rdParty", "GnuWin32", "bin", "file.exe")
        : "file";
    return new Promise((resolve) => {
        var settled = false;
        var done = function(val) { if (!settled) { settled = true; resolve(val); } };
        var output = "";
        // Absolute bin path + no shell so stdin pipes straight into `file`
        // without a cmd.exe intermediary.
        var child = spawn(binPath, ["--mime-encoding", "-"]);
        var stream = fs.createReadStream(filePath);
        child.stdout.on("data", function(data) { output += data; });
        child.on("close", function() {
            // Output looks like "<label>: <enc>" / "<label>; <enc>" /
            // "<label>; charset=<enc>". The encoding is always the final token
            // and never contains a separator.
            var m = output.match(/[;:=]\s*([a-zA-Z0-9_\-]+)\s*$/);
            var enc = m ? m[1] : (output || "").trim();
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(enc)) {
                console.log("Native encoding detection unavailable for ", filePath);
                return done();
            }
            done(enc);
        });
        child.on("error", function(err) {
            console.error("detectEncodingFromStream spawn error:", err);
            done();
        });
        stream.on("error", function(err) {
            console.error("detectEncodingFromStream read error:", err);
            try { child.stdin.destroy(); } catch (_) {}
            done();
        });
        stream.pipe(child.stdin);
    });
}


/**
 * Detects character encoding of a file
 * @param {String} filePath - Path to the file 
 * @param {String|String[]} [encodingPreference] - If string, immidiately output the string. 
 * If array, check the encoding, use the first member of array if detected encoding not exist in the option
 * @returns {Promise<String>} Character encoding
 * @since 5.1.17
 */
common.detectFileEncoding = async function(filePath, encodingPreference) {
    if (typeof encodingPreference == "string") return encodingPreference;
    if (Array.isArray(encodingPreference) && encodingPreference.length == 1) return encodingPreference[0];

    const getPreferredEncoding = (detectedEncoding)=> {
        if (!encodingPreference) return detectedEncoding;
        detectedEncoding = this.getEncodingName(detectedEncoding);
        encodingPreference = this.getEncodingName(encodingPreference);
        if (detectedEncoding.includes("unknown")) return encodingPreference[0];

        if (encodingPreference.includes(detectedEncoding)) return detectedEncoding;
        return encodingPreference[0];
    }

    if (await common.getFileSize(filePath) <= 1024*256) {
        console.log("Reading file");
        var buff = await fs.promises.readFile(filePath);
        var enc = common.detectEncoding(buff);
        if (enc) return getPreferredEncoding(enc);
    }
    var encOut = await common.detectFileEncodingNative(filePath);
    if (!encOut) {
        // The native `file` helper is optional (3rdParty/GnuWin32 is not shipped in every
        // tree, and Linux relies on the system tool). Without it, detect in-process over a
        // bounded sample - the same detector the small-file path uses - so a large file does
        // not fall through to decode(undefined).
        var handle = await fs.promises.open(filePath, "r").catch(function () { return null; });
        if (!handle) return undefined;
        try {
            var sample = Buffer.alloc(1024 * 256);
            var read = await handle.read(sample, 0, sample.length, 0);
            var sampled = common.detectEncoding(sample.subarray(0, read.bytesRead));
            if (sampled) return getPreferredEncoding(sampled);
        } finally {
            await handle.close().catch(function () {});
        }
        return undefined;
    }
    return getPreferredEncoding(encOut);
}

/**
 * Write data into a file
 * Create a file if it does not exist. Will truncate the file if it exists.
 * @async
 * @param {String} file - Path to the file
 * @param {String} data - Data to write to
 * @param {String} [encoding] - Character encoding
 * @param {Boolean} [bom=true] - Whether to write with a BOM or not
 * @returns {Promise<String>} Path to the file
 * 
 */
/**
 * Clean the SLR internal markers (SLRContextID / SLRnumbah / SLRstrnumbah)
 * out of serialized export text. Applied by filePutContents to every export
 * write, and by writeJSONStream per serialized array element — the cleanup
 * regexes only ever match inside JSON string values (their escape sequences
 * and quoting exist nowhere else), so applying them per element of a
 * serialized array is equivalent to applying them to the whole string.
 * @param {String} data - serialized (or plain) export text
 * @returns {String} cleaned text
 */
common.sanitizeExportMarkers = function(data) {
    data = data.replaceAll(/S(?:\\\n +)?L(?:\\\n +)?R(?:\\\n +)?C(?:\\\n +)?o(?:\\\n +)?n(?:\\\n +)?t(?:\\\n +)?e(?:\\\n +)?x(?:\\\n +)?t(?:\\\n +)?I(?:\\\n +)?D(?:\\\n +)?/g, "SLRContextID");
    data = data.replaceAll(/　?　?　?　?　?　?　?　?　?　?　?　?　?SLRContextID[\s\S]*?SLRContextID/g, "");
    data = data.replaceAll(/S(?:\\\n +)?L(?:\\\n +)?R(?:\\\n +)?n(?:\\\n +)?u(?:\\\n +)?m(?:\\\n +)?b(?:\\\n +)?a(?:\\\n +)?h/g, "SLRnumbah");
    data = data.replaceAll(/S(?:\\\n +)?L(?:\\\n +)?R(?:\\\n +)?s(?:\\\n +)?t(?:\\\n +)?r(?:\\\n +)?n(?:\\\n +)?u(?:\\\n +)?m(?:\\\n +)?b(?:\\\n +)?a(?:\\\n +)?h/g, "SLRstrnumbah");
    data = data.replaceAll(/[\"\'\`]([\-]?\d+)　?　?　?　?SLRnumbah[\"\'\`]/g, "$1");
    data = data.replaceAll(/　?　?　?　?SLRstrnumbah/g, "");
    return data;
}

common.filePutContents = async function(file, data, encoding, bom) {
    return new Promise((resolve, reject) => {
        encoding = encoding || this.getOpenedFileEncoding(file);
        {
            data = common.sanitizeExportMarkers(data);
        }
        var buffer = data;
        if (typeof bom == 'undefined') {
            // default bom is true
            bom = true;    
        } 
        console.log(`writing ${file} using encoding : ${encoding} BOM ${bom}`);

        if (bom === true) {
            if (encoding) buffer = iconv.encode(Buffer.from(data), encoding, {addBOM: true});
        } else {
            if (encoding) buffer = iconv.encode(Buffer.from(data), encoding);
        }

        fs.writeFile(file, buffer, function (err,data) {
            if (err) {
                reject(err);
                return console.warn(err);
            }
            console.log("Success");
            resolve(file);
        });
    })
}

/**
 * Serialize JSON data straight to a file in chunks, without ever holding the
 * full JSON.stringify(...) result in memory. Byte-identical to
 * filePutContents(file, JSON.stringify(data, undefined, options.indent), encoding, bom)
 * for every input: top-level arrays (the shape of all RPG Maker data files)
 * are streamed element by element, everything else falls back to a single
 * JSON.stringify write.
 *
 * Builds one huge string was enough to help exhaust the renderer's V8 heap
 * when exporting very large data files (a 26MB CommonEvents.json beautifies
 * to ~59MB, and the string is only half of stringify's transient cost).
 *
 * @param {String} file - target path
 * @param {*} data - JSON-serializable data
 * @param {Object} options - {indent: Number|undefined, encoding: String, bom: Boolean}
 * @returns {Promise<String>} the file path
 */
common.writeJSONStream = async function(file, data, options) {
    options             = options || {};
    var indent         = options.indent;
    var encoding         = options.encoding || "utf8";
    var bom             = options.bom === true;
    var indentStr     = (typeof indent === "number") ? " ".repeat(indent) : "";

    var buffered         = [];
    var bufferedLength = 0;
    var firstWrite     = true;

    var flush = async function() {
        if (bufferedLength == 0) return;
        var chunk = buffered.join("");
        buffered = [];
        bufferedLength = 0;
        var buffer = iconv.encode(chunk, encoding, {addBOM: (bom && firstWrite)});
        firstWrite = false;
        await new Promise(function(resolve, reject) {
            fs.appendFile(file, buffer, function(err) {
                if (err) return reject(err);
                resolve();
            });
        });
    };
    var push = async function(part) {
        buffered.push(part);
        bufferedLength += part.length;
        if (bufferedLength > 4 * 1024 * 1024) await flush();
    };

    console.log("writing (streamed) " + file + " using encoding : " + encoding + " BOM " + bom);

    // truncate any existing file first
    await new Promise(function(resolve, reject) {
        fs.writeFile(file, "", function(err) {
            if (err) return reject(err);
            resolve();
        });
    });

    if (Array.isArray(data)) {
        await push("[");
        for (var i = 0; i < data.length; i++) {
            if (i > 0) await push(",");
            if (indentStr != "") await push("\n" + indentStr);
            // JSON.stringify(array) renders undefined entries as null
            var serialized = data[i] === undefined ? "null" : JSON.stringify(data[i], undefined, indent);
            if (indentStr != "" && serialized.indexOf("\n") != -1) {
                // indent the element by one level, exactly like stringify
                // would inside the whole array (escaped \n never appears in
                // serialized strings, so splitting on real newlines is safe)
                serialized = serialized.split("\n").join("\n" + indentStr);
            }
            await push(common.sanitizeExportMarkers(serialized));
        }
        if (indentStr != "" && data.length > 0) await push("\n");
        await push("]");
    } else {
        await push(common.sanitizeExportMarkers(JSON.stringify(data, undefined, indent)));
    }
    await flush();
    console.log("Success");
    return file;
}

/**
 * Get version of an EXE file
 * @param {String} filePath - Path to the file
 * @returns {Promise<String>} version string
 * @since 5.1.18
 */
common.getExeVersion = async function(filePath) {
    if (!this.IS_WIN) return "";
    filePath = nwPath.resolve(filePath);
    var output = await common.aSpawn("wmic", ["datafile", "where", `name="${filePath.replaceAll("\\", "\\\\")}"`, "get", "version", "/value"], {
        shell:true,
    });
    output = output.split("=");
    if (typeof output[1] !== "string") return console.error("Can not detect version of ", filePath)
    return output[1].trim();
}

/**
 * Get manufacturer of an EXE file
 * @param {String} filePath - Path to the file 
 * @returns {Promise<String>} manufacturer string
 * @since 5.1.18
 */
common.getExeManufacturer = async function(filePath) {
    if (!this.IS_WIN) return "";
    filePath = nwPath.resolve(filePath);
    var output = await common.aSpawn("wmic", ["datafile", "where", `name="${filePath.replaceAll("\\", "\\\\")}"`, "get", "Manufacturer", "/value"], {
        shell:true,
    });
    output = output.split("=");
    if (typeof output[1] !== "string") return console.error("Can not detect manufacturer of ", filePath)
    return output[1].trim();
}

/**
 * Get file (exe) version
 * @param {String} filePath - Path to the exe file
 * @since 5.8.15
 * @returns {Object} - Executable information
 */
common.getFileVer = async function(filePath) {
    if (!this.IS_WIN) return {};
    const filever = "3rdParty/filever.exe";
    if (!await this.isFileAsync(filePath)) return;

    const output = await this.aSpawn(filever, ["/V", filePath]);
    console.log(output);
    const lines = output.replaceAll("\r", "").split("\n");
    var result = {};

    var fixedFileInfoMode = false;
    for (let i=1; i<lines.length; i++) {
        if (!lines[i]) continue;
        let line = lines[i].trim();
        if (line == "VS_FIXEDFILEINFO:") {
            fixedFileInfoMode = true;
            continue;
        }

        let delimiterPos = line.indexOf("\t");
        if (delimiterPos == -1) {
            result[line] = undefined;
            continue;
        }

        let segm = line.split("\t")
        let key = segm[0];
        segm.shift();
        let val = segm.join("\t").trim();

        if (fixedFileInfoMode) {
            // fixedFileInfoMode
            key = key.replace(":", "")
            result[key] = val;
        } else {
            if (key == "ProductVersion" || key == "FileVersion") {
                val = val.replaceAll(",", ".");
                val = val.replaceAll(" ", "");
            }
            result[key] = val;
        }

    }

    return result;
}

/**
 * Check whether a path is writable or not
 * @param {String} file - Path to check
 * @returns {Boolean} True if the path is writable
 */
common.fileIsWritable = async function(file) {
    return new Promise((resolve, reject) => {
        fs.access(file, fs.W_OK, function(err) {
            if (err) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    })
}


common.untilWritable = async function(file) {
    for (let i=0; i< 100000; i++) {
        if (await common.fileIsWritable(file)) return true; 
        await common.wait(100);
    }
    return false;
}

/**
 * Parse SLR Translator changelog formatted text
 * @param {String} text 
 * @returns {Object} Javascript's iterable object
 */
common.parseChangeLog = async function(text) {
    text = text || "";
    var rows = text.split("\n");
    
    var result = {};
    var version = "";
    for (var i in rows) {
        var thisRow = rows[i].trim();
        if (thisRow == "") continue;
        if (thisRow[0] == "[" && thisRow.substr(-1)) {
            version = thisRow.substr(1, thisRow.length-2);
            result[version] = [];
            continue;
        }
        result[version].push(thisRow);
        
    }
    return result;
}

/**
 * Converts version string to a date format
 * @param {String} ver 
 * @param {String} format 
 * @returns {String}
 */
common.versionToDate = function(ver, format) {
    ver = ver || "";
    var alphabet = "";
    ver = ver.replace(/([A-Za-z]+)/g, function() {
        alphabet = arguments[0];
        return "";
    });
    
    var parts = ver.split(".");
    var y = parseInt(parts[0])+2018;
    var m = parts[1].padStart(2, '0');
    var d = parts[2].padStart(2, '0');
    
    var minor = 0;
    for (var i=0; i<alphabet.length; i++) {
        var val = (alphabet.charCodeAt(i)-64)*60;
        minor += val+(3600*i);
    }
    console.log("Minor value : ", minor);
    if (!minor) minor = 0;
    var his = new Date(parseInt(minor) * 1000).toISOString().substr(11, 8);
    
    var formatted = y+"/"+m+"/"+d+" "+his;
    console.log(formatted);
    if (format == "field") return y+"-"+m+"-"+d+"T"+his;
    return formatted;
}

/**
 * Convert version string to a float
 * This is useful for version comparasion/sorting procedure
 * @param {String} ver - Version number
 * @returns {Number} Float number of the version string
 */
common.versionToFloat = function(ver) {
    ver = ver || "";
    var verNum = 0;
    
    var alphabet = "";
    ver = ver.replace(/([A-Za-z]+)/g, function() {
        alphabet = arguments[0];
        return "";
    })
    
    var splitV = ver.split(".");
    var m1 = parseInt(splitV[0]||0)*100000000
    var m2 = parseInt(splitV[1]||0)*100000
    var m3 = parseInt(splitV[2]||0)*100
    var m4 = parseInt(splitV[3]||0)
    verNum = m1+m2+m3+m4;
    
    var minor = "";
    for (var i=0; i<alphabet.length; i++) {
        minor += alphabet.charCodeAt(i);
    }
    
    return parseFloat(verNum+"."+minor);
}

/**
 * Removes a file
 * @async
 * @param {String} path - Path to the file
 * @returns {Promise<String>} Path to the removed file if success
 */
common.unlink = async function(path) {
    if (typeof path !== 'string') return;
    if (!await this.isFileAsync(path)) return;
    return new Promise((resolve, reject) => {
        fs.unlink(path, (err) => {
            if (err) {
                console.warn(err);
                resolve();
            }
            resolve(path);
        });
    })
}

/**
 * Remove a directory recursively
 * @async
 * @param {String} path - Path to the directory to be removed
 * @returns {Promise<Boolean>} True if success
 */
common.rmdir = async function(path) {
    // prevents removing self
    if (path == this.getRootDir()) return false;
    if (!path) return false;

    // fs-extra's removeSync handles spaces, recursion, symlinks and missing paths
    // reliably across Node versions; the previous `rmdir /s /q` via shell failed
    // silently on paths containing spaces (e.g. "...\\SLR Translator\\...").
    try {
        require('fs-extra').removeSync(path);
        return true;
    } catch (e) {
        console.warn("rmdir failed:", e);
        return false;
    }
}

/**
 * Get the absolute root dir to the application without relying to the __dirname
 * This method will consistently return the absolute path of SLR Translator location either called from the main application
 * or from the add-ons
 * @returns {String} Root directory to the application
 */
common.getRootDir = function() {
    return nwPath.resolve(nwPath.dirname(require.resolve("debounce")), "../..");
}

/**
 * Search for a file in a folder
 * @param {string} filename - A glob string of filename 
 * @param {string} [rootdir=__dirname] - A string of directory
 * @returns {string[]} - array of full path of the found file(s)
 * @since 5.8.5
 */
common.searchFile = async function(filename, rootdir = __dirname) {
    const glob = require("glob");

    return new Promise((resolve, reject) => {
        let targetPath = nwPath.join(rootdir, "**/"+filename);
        targetPath = targetPath.replaceAll("\\", "/")
        glob(targetPath, undefined, (er, files) => {
            if (er) return reject(new Error(er));
            resolve(files)
        });
    })
}

/**
 * Copy a file into a new file or directory
 * @async
 * @param {String} src - Source file 
 * @param {String} dest - Path to the file/folder of the destination.
 * If the destination is a directory, then 
 * @returns {Promise<String>} File destination
 */
common.copyFile = async function(src, dest) {
    // copy a file
    if (await common.isDirectory(dest)) {
        dest = nwPath.join(dest, nwPath.basename(src));
    }
    
    return new Promise((resolve, reject) => {
        fs.copyFile(src, dest, (err) => {
            if (err) {
                reject(err);
                throw new Error(err)
            }
            resolve(dest);
        });    
    })
}

/**
 * Checks whether a path is directory
 * @async
 * @param {String} path - Path to check for
 * @returns {Promise<Boolean>} - True if the given path is a directory
 */
common.isDirectory = async function(path) {
    // async varsion of isDir
    if (!path) return false;
    return new Promise((resolve, reject) =>{
        fs.stat(path, (err, stats) => {
            if (err) {
                resolve(false);
                return;
            }
            resolve(stats.isDirectory())
        })
    })
}

common.removeTrailingSlash = function(path) {
    // Remove trailing forward slashes
    path = path.replace(/\/+$/, '');
  
    // Remove trailing backslashes
    path = path.replace(/\\+$/, '');
  
    return path;
}

/**
 * Get the file stats of a file/directory
 * @async
 * @param {String} path 
 * @returns {Promise<Object>} The resulting output will resemble:
 * ```
 * {
  dev: 16777220,
  mode: 16877,
  nlink: 3,
  uid: 501,
  gid: 20,
  rdev: 0,
  blksize: 4096,
  ino: 14214262,
  size: 96,
  blocks: 0,
  atimeMs: 1561174653071.963,
  mtimeMs: 1561174614583.3518,
  ctimeMs: 1561174626623.5366,
  birthtimeMs: 1561174126937.2893,
  atime: 2019-06-22T03:37:33.072Z,
  mtime: 2019-06-22T03:36:54.583Z,
  ctime: 2019-06-22T03:37:06.624Z,
  birthtime: 2019-06-22T03:28:46.937Z
}
 * ```
 */
common.fstat = async function(path) {
    return new Promise((resolve, reject) => {
        fs.stat(path, (err, stats) => {
            if (err) {
                resolve(false);
                return;
            }
            resolve(stats)
        })        
    })
}

/**
 * Get the size of a file
 * @async
 * @param {String} path - The path to check
 * @returns {Promise<Number>} The size of the file in byte
 */
common.getFileSize = async function(path) {
    var stat= await fs.promises.stat(path);
    return stat.size;
}

/**
 * Create a directory. Will create preceding directories if they do not exist.
 * @async
 * @param {String} path - Path to the directory 
 * @returns {Promise<String|undefined>} Return the newly created path on success
 */
common.mkDir = async function(path) {
    try {
        return new Promise((resolve, reject) =>{
            fs.mkdir(path, { recursive: true }, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(path);
            });
        })        
    } catch (e) {
        // do nothing;
    }
}

/**
 * Create a new directory at system's temporary folder
 * @returns {String} - Path to temporary directory
 */
common.makeTempDir = async function() {
    const tmpPath = nwPath.join(this.getTempDir(), common.makeid(12));
    await this.mkDir(tmpPath);
    return tmpPath;
}

/**
 * Check whether a path is a file or not
 * @async
 * @param {String} path - Path to be checked
 * @returns {Promise<Boolean>} True if a file
 */
common.isFileAsync = async function(path) {
    // async varsion of isFile
    if (!path) return false;
    return new Promise((resolve, reject) =>{
        fs.stat(path, (err, stats) => {
            if (err) {
                resolve(false);
                return;
            }
            resolve(stats.isFile())
        })
    })
}

/*
common.getFileSize = async function(path) {
    return new Promise((resolve, reject) =>{
        fs.stat(path, (err, stats) => {
            if (err) {
                reject(err);
                return
            }
            resolve(stats.size) //1024000 //= 1MB
        })
    })
}
*/

/**
 * Rename / Move a file from one location to another.
 * @async
 * @param {String} from - Source file
 * @param {String} to - Target file
 * @returns {Promise<String>} Path to the new location
 */
common.rename = async function(from, to) {
    return new Promise((resolve, reject) => {
        fs.rename(from, to, (err) => {
            if (err) {
                reject(err);
                return
            }
            resolve(to);
        });        
    })
}


common.isFileReadable = async function(file) {
    // wait until resource is changed state
    var resolver;
    var promise = new Promise((resolve, reject) => {
        resolver = resolve;
    })
    
    try {
        //The fs.constants.X_OK flag doesn't work for the Windows operating system and will only check for the file's existence in the current directory.
        fs.access(file, fs.constants.R_OK, (err) => {
            if (err) resolver(false);
            resolver(true);
        });    
    } catch (e) {
        console.warn(e);
        resolver(false);
    }
    
    return promise;
}

/**
 * Wait until the file is executable/writable
 * @param {String} file - File to watch
 * @param {String} [timeout=60000] - Timeout in ms
 * @returns {Boolean} 
 */
common.waitUntilFileIsReadable = async function(file, timeout=60000) {
    const waitUntil = require('async-wait-until').default;
    return await waitUntil(()=> this.isFileReadable(file), {
        intervalBetweenAttempts:200,
        timeout:60000
    })
}

/**
 * Get filename from the url
 * @param {String} input - The url
 * @returns {String} The filename
 */
common.getFileFromURL = function(input) {
    input = input || "";
    var url     = url || require("url");
    var parsed     = url.parse(input);
    return decodeURI(nwPath.basename(parsed.pathname))
}

/**
 * Check whether an url is working
 * @async
 * @param {String} url - URL to be checked
 * @returns {Promise<Boolean>}
 */
common.isUrlWorking = async function(url) {
    return new Promise((resolve, reject) => {
        var request = request||require('request');
        request.get(url, function(err, httpResponse, body) {
            
        }).on('data', function(data) {
            this.abort();
            console.log("Status Code : ", this.response.statusCode);
            
            if (this.response.statusCode == 200) {
                resolve(true);
            } else {
                resolve(false);
            }
        });    
    })
}

/**
 * Get HTTP status of the URL
 * @async
 * @param {String} url - The URL
 * @returns {Promise<IncomingMessage>} 
 */
common.getUrlStatus = async function(url) {
    var parseRawHeaders = (rawHeader = []) => {
        var result = {};
        while (rawHeader.length > 0) {
            var key = rawHeader.shift();
            result[key] = rawHeader.shift();
        }
        return result;
    }
    return new Promise((resolve, reject) => {
        var request = request||require('request');
        request.get(url, function(err, httpResponse, body) {
            //console.log("http response", httpResponse);
        }).on('data', function(data) {
            this.abort();
            console.log("Status Code : ", this.response.statusCode);
            
            if (this.response.statusCode == 200) {
                console.log("headers:", this.response['Symbol(kHeaders)']);
                this.response.header = parseRawHeaders(this.response.rawHeaders);
                resolve(this.response);
            } else {
                resolve(false);
            }
        });    
    })
}

/**
 * Fetch remote url and returns result with JQuery.ajax
 * @async
 * @param {String} url - The url to fetch
 * @param {Object} options - [JQuery.ajax](https://api.jquery.com/jquery.ajax/#jQuery-ajax-url-settings) options
 * @returns {Promise<String>} The content of the URL
 */
common.fetch = async function(url, options) {
    // fetch remote url and returns result
    return new Promise((resolve, reject) => {
        options = options || {};
        options.url = url;
        $.ajax(options)
        .done(function( msg ) {
            resolve(msg);
        })
        .fail(function(message, textMessage){
            reject(message);
        })
        .always(function() {
            resolve();
        })
    });
}

/**
 * Fetch URL with NodeJS' postman-request
 * @async
 * @param {String} url - Url to be fetched
 * @param {Options} [options] - [postman-request](https://github.com/postmanlabs/postman-request)'s options
 * @returns {Promise<String|Object>} If the fetched data is a JSON, then returns Javascript object. Otherwise, returns a plain string
 */
common.fetchUrl = async function(url, options) {
    this.request = this.request || require('postman-request');

    // fetch remote url with request library
    options = options || {};
    options.url = url || options.url;
    if (!options.url) return;

    return new Promise((resolve, reject) => {
        this.request(options, async (error, response, body)=>{
            if (!error && response.statusCode == 200) {
                try {
                    if (common.isJSON(body)) {
                        resolve(JSON.parse(body));
                        return;
                    }
                } catch (e) {
                    // do nothing
                }
                resolve(body);
                return body;
            }
        });    
    })

}

/**
 * Write a data into a file
 * When file is a filename, asynchronously writes data to the file, replacing the file if it already exists. data can be a string or a buffer.
 * @async
 * @param {String|Buffer} file - Path to the file
 * @param {String|Buffer|TypedArray} data - The data to be written
 * @param {*} options - NodeJS [fs.writeFile](https://nodejs.org/api/fs.html#fswritefilefile-data-options-callback) options
 * @returns {Promise<String>} The file written
 */
common.writeFile = async function(file, data, options) {
    options = options || {};
    return new Promise((resolve, reject) => {
        {
            data = data.replaceAll(/　　　　　　　　　　　　SLRContextID.*?SLRContextID/g, "");
            data = data.replaceAll(/[\"\'\`](\d+)　　　　SLRnumbah[\"\'\`]/g, "$1");
            data = data.replaceAll(/　　　　SLRstrnumbah/g, "");
        }
        fs.writeFile(file, data, options, (err)=> {
            if (err) {
                reject(err);
                return;
            }
            resolve(file);
        });
    });    
}

/**
 * Wait asynchronous execution for (n) ms
 * @async
 * @param {Number} ms 
 */
common.wait = async function(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(()=> {
            resolve();
        }, ms);
    });    
}

/**
 * Chunk array into smaller array of the same size
 * @param {*} array - Input array
 * @param {*} size - Maximum size of the array
 * @returns {Array[]} Array of input array
 */
common.arrayChunk = function(array, size) {
    let result = []
    if (!size) return array;
    for (let i = 0; i < array.length; i += size) {
        let chunk = array.slice(i, i + size)
        result.push(chunk)
    }
    return result
}

/**
 * Find a value of context
 * 
 * @param  {string} path
 * @param  {string} key
 * @example
 * path = "map/1/event/3/page/14"
 * key = "event"
 * returned = 3
 */
common.getContextValue = function(path, key) {
    path = path || "";
    var ar = path.split("/");
    for (let i=0; i<ar.length; i++) {
        if (ar[i] == key) return ar[i+1];
    }
}

/**
 * Generate CRC 32 of a file
 * @async
 * @param {String} file - File to check
 * @returns {Promise<String>} CRC 32 value
 */
common.crc32 = async function(file) {
    if (await php.getVersion()) {
        return await php.spawn("hashFile.php", {args:{file:file}});
    } else {
        return await this.crc32File(file);
    }
}

common.crc32File = async function(file) {
    const data = await fs.promises.readFile(file);
    var crc = 0 ^ (-1);
    for (var i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ common._crc32Table[(crc ^ data[i]) & 0xff];
    }
    return ((crc ^ (-1)) >>> 0).toString(16).toLowerCase();
}

common._crc32Table = (function() {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

common.md5file = async function(file) {
    var crypto = require('crypto');
    return new Promise((resolve, reject) => {
        var hash = crypto.createHash('md5');
        var stream = fs.createReadStream(file);
        stream.on('data', (d) => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * To test whether a string is a valid BCP 47 language code.
 * @param  {} code
 */
common.isValidLanguageCode = function(code) {
    if (!code) return false;
    return /^((?<grandfathered>(en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang))|((?<language>([A-Za-z]{2,3}(-(?<extlang>[A-Za-z]{3}(-[A-Za-z]{3}){0,2}))?)|[A-Za-z]{4}|[A-Za-z]{5,8})(-(?<script>[A-Za-z]{4}))?(-(?<region>[A-Za-z]{2}|[0-9]{3}))?(-(?<variant>[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(-(?<extension>[0-9A-WY-Za-wy-z](-[A-Za-z0-9]{2,8})+))*(-(?<privateUse>x(-[A-Za-z0-9]{1,8})+))?)|(?<privateUse1>x(-[A-Za-z0-9]{1,8})+))$/.test(code);
}

/**
 * Calculates the running time of a function
 * @async
 * @param {function} process - The function to be monitored. The function will be called.
 * @returns {Number} Execution time in ms 
 */
common.benchmark = async function(process) {
    if (typeof process !== "function") return console.warn("Arguments[0] must be a function");
    var t0 = performance.now()

    await process()   // <---- measured code goes between t0 and t1
    
    var t1 = performance.now()
    console.log("Process took " + (t1 - t0) + " milliseconds.")
    return t1 - t0;
}

/**
 * Get the information about which js file and the line number is calling a function.
 * @returns {String} Information about the caller's js file the line number and column
 */
common.getOrigin = function() {
    /*
    var e = new Error();
    if (!e.stack) {
        try {
            throw e;
        } catch (e) {
            if (!e.stack) {
                //return 0; // IE < 10, likely
            }
        }
    }
    var stack = e.stack.toString().split(/\r\n|\n/);
    //console.log("stack:", stack);
    return stack[3];
    */
    var err = new Error;
    var stack = err.stack.split("\n");
    if (!stack[3]) return "";
    if ( stack[3].includes('    at chrome-extension')) {
        stack[3] =  stack[3].replace("    at ", "");
        return nwPath.basename(stack[3]);
    }

    var match = stack[3].match(/\((.*?)\)/)
    if (!match) return stack[3];
    if (!match[1]) return stack[3];
    return nwPath.basename(match[1]);
}

/**
 * Get the debug level for current app
 * @returns {Number} The current debug level
 */
common.debugLevel = function() {
    if (!nw.App.manifest.debugLevel) return 0;
    return nw.App.manifest.debugLevel || 0;
}

/**
 * Returns Halt object
 * @returns {Halt} Halt object. An object to let the hook know when to halt the process.
 */
common.halt = function() {
    var Halt = function(status){
        this.halt = Boolean(status);
    }
    return new Halt(true);
}

/**
 * Checks if `obj` is Halt
 * @param {*} obj 
 * @returns {Boolean}
 */
common.isHalt = function(obj) {
    obj = obj || {};
    try {
        if (obj.halt) return true;
    } catch (e) {
        console.warn(e);
    }
}

/**
 * Returns Thru object
 * @returns {Halt} Thru object. Tell a process that they should go thru.
 */
common.thru = function() {
    var Thru = function(status){
        this.thru = Boolean(status);
    }
    return new Thru(true);
}

/**
 * Checks if the `obj` is Thru
 * @param {*} obj 
 * @returns {Boolean}
 */
common.isThru = function(obj) {
    obj = obj || {};
    try {
        if (obj.thru) return true;
    } catch (e) {
        console.warn(e);
    }
    return false;
}

/**
 * Pack data with zlib library
 * @async
 * @param {String|Buffer|Object} data - Data to be compressed
 * @param {Buffer} [options] - Options
 * @returns {Promise<Buffer>} Compressed output
 */
common.gzip = async function(data, options) {
    var zlib = require('zlib');
    options = options || {};
    var buff = Buffer.from([]);
    if (Buffer.isBuffer(data)) {
        buff = data;
    } else if (typeof data == "string") {
        buff = Buffer.from(data);
    } else if (typeof data == "object" && !empty(data)) {
        buff = Buffer.from(JSON.stringify(data));
    } else {
        console.error("Can not handle this type of data : ", data);
        return;
    }

    return new Promise((resolve, reject) => {
        zlib.gzip(buff, (err, result) => {
            if (err) {
                return reject(err);
            }
            return resolve(result);
        });
    })
}

/**
 * Unpack zlib compressed data
 * @async
 * @param {String|Buffer|Object} data - Data to be uncompressed
 * @param {Object} [options] Options
 * @returns {Promise<String|Object>} The uncompressed data
 */
common.gunzip = async function(data, options) {
    var zlib = require('zlib');

    options = options || {};
    var buff = Buffer.from([]);
    if (Buffer.isBuffer(data)) {
        buff = data;
    } else if (typeof data == "string") {
        buff = Buffer.from(data);
    } else if (typeof data == "object" && !empty(data)) {
        buff = Buffer.from(JSON.stringify(data));
    } else {
        console.error("Can not handle this type of data : ", data);
        return;
    }

    return new Promise((resolve, reject) => {
        zlib.gunzip(buff, (err, result) => {
            if (err) {
                return reject(err);
            }
            return resolve(result);
        });
    })
}

/**
 * Calculate a CRC32 hash from a string
 * @param {String} str - String to be checked
 * @returns {String} - A crc32 string
 */
common.crc32String = function(str) {
    this.a_table = this.a_table|| "00000000 77073096 EE0E612C 990951BA 076DC419 706AF48F E963A535 9E6495A3 0EDB8832 79DCB8A4 E0D5E91E 97D2D988 09B64C2B 7EB17CBD E7B82D07 90BF1D91 1DB71064 6AB020F2 F3B97148 84BE41DE 1ADAD47D 6DDDE4EB F4D4B551 83D385C7 136C9856 646BA8C0 FD62F97A 8A65C9EC 14015C4F 63066CD9 FA0F3D63 8D080DF5 3B6E20C8 4C69105E D56041E4 A2677172 3C03E4D1 4B04D447 D20D85FD A50AB56B 35B5A8FA 42B2986C DBBBC9D6 ACBCF940 32D86CE3 45DF5C75 DCD60DCF ABD13D59 26D930AC 51DE003A C8D75180 BFD06116 21B4F4B5 56B3C423 CFBA9599 B8BDA50F 2802B89E 5F058808 C60CD9B2 B10BE924 2F6F7C87 58684C11 C1611DAB B6662D3D 76DC4190 01DB7106 98D220BC EFD5102A 71B18589 06B6B51F 9FBFE4A5 E8B8D433 7807C9A2 0F00F934 9609A88E E10E9818 7F6A0DBB 086D3D2D 91646C97 E6635C01 6B6B51F4 1C6C6162 856530D8 F262004E 6C0695ED 1B01A57B 8208F4C1 F50FC457 65B0D9C6 12B7E950 8BBEB8EA FCB9887C 62DD1DDF 15DA2D49 8CD37CF3 FBD44C65 4DB26158 3AB551CE A3BC0074 D4BB30E2 4ADFA541 3DD895D7 A4D1C46D D3D6F4FB 4369E96A 346ED9FC AD678846 DA60B8D0 44042D73 33031DE5 AA0A4C5F DD0D7CC9 5005713C 270241AA BE0B1010 C90C2086 5768B525 206F85B3 B966D409 CE61E49F 5EDEF90E 29D9C998 B0D09822 C7D7A8B4 59B33D17 2EB40D81 B7BD5C3B C0BA6CAD EDB88320 9ABFB3B6 03B6E20C 74B1D29A EAD54739 9DD277AF 04DB2615 73DC1683 E3630B12 94643B84 0D6D6A3E 7A6A5AA8 E40ECF0B 9309FF9D 0A00AE27 7D079EB1 F00F9344 8708A3D2 1E01F268 6906C2FE F762575D 806567CB 196C3671 6E6B06E7 FED41B76 89D32BE0 10DA7A5A 67DD4ACC F9B9DF6F 8EBEEFF9 17B7BE43 60B08ED5 D6D6A3E8 A1D1937E 38D8C2C4 4FDFF252 D1BB67F1 A6BC5767 3FB506DD 48B2364B D80D2BDA AF0A1B4C 36034AF6 41047A60 DF60EFC3 A867DF55 316E8EEF 4669BE79 CB61B38C BC66831A 256FD2A0 5268E236 CC0C7795 BB0B4703 220216B9 5505262F C5BA3BBE B2BD0B28 2BB45A92 5CB36A04 C2D7FFA7 B5D0CF31 2CD99E8B 5BDEAE1D 9B64C2B0 EC63F226 756AA39C 026D930A 9C0906A9 EB0E363F 72076785 05005713 95BF4A82 E2B87A14 7BB12BAE 0CB61B38 92D28E9B E5D5BE0D 7CDCEFB7 0BDBDF21 86D3D2D4 F1D4E242 68DDB3F8 1FDA836E 81BE16CD F6B9265B 6FB077E1 18B74777 88085AE6 FF0F6A70 66063BCA 11010B5C 8F659EFF F862AE69 616BFFD3 166CCF45 A00AE278 D70DD2EE 4E048354 3903B3C2 A7672661 D06016F7 4969474D 3E6E77DB AED16A4A D9D65ADC 40DF0B66 37D83BF0 A9BCAE53 DEBB9EC5 47B2CF7F 30B5FFE9 BDBDF21C CABAC28A 53B39330 24B4A3A6 BAD03605 CDD70693 54DE5729 23D967BF B3667A2E C4614AB8 5D681B02 2A6F2B94 B40BBE37 C30C8EA1 5A05DF1B 2D02EF8D";
    this.b_table = this.b_table|| common.a_table.split(' ').map(function(s){ return parseInt(s,16) });

    str = str || "";
    var crc = -1;
    for(var i=0, iTop=str.length; i<iTop; i++) {
        crc = ( crc >>> 8 ) ^ this.b_table[( crc ^ str.charCodeAt( i ) ) & 0xFF];
    }
    var result = (crc ^ (-1)) >>> 0;
    return result.toString(16);
};

/**
 * Capitalize the first letter
 * @param {String} text 
 * @returns {String}
 */
common.capitalizeFirstLetter = function(text) {
    if (!text) return "";
    if (typeof text !== "string") return text;
    return text[0].toUpperCase() + text.substr(1);
}


// ============================================================
//
// MULTI PURPOSE GENERAL TRANSLATABLE OBJECT
// 
// ============================================================

var TranslatableObject = function(object, options) {
    this.object             = object;
    this.options             = options || {};
    this.isStringOnly        = this.options.isStringOnly || false;
    this.translationPair     = this.options.translationPair || {}
    this.translationInfo     = this.options.translationInfo || {};
    this.translationInfo.groupLevel = this.translationInfo.groupLevel || 0;
    this.currentContext     = [];
}

TranslatableObject.prototype.translateString = function(text, context) {
    /*
        translate iteratable object
    */
    console.log("translating ", text);
    context = context || this.currentContext;
    if (typeof text !== 'string') return text;
    if (text.trim() == '') return text;
    
    // compare with exact context match
    var prefix = context.join("/")
    prefix = prefix+"\n";
    if (this.translationPair[prefix+text]) return this.translationPair[prefix+text];


    // compare with group
    var sliceLevel = this.translationInfo.groupLevel || 0;
    if (sliceLevel > 0) {
        prefix = context.slice(0, sliceLevel).join("/")
        prefix = prefix+"\n";
        //if (window.monitoringMode) console.log("%cTranslate by group",  'background: #00F; color: #fff', prefix);
        if (this.translationPair[prefix+text]) return this.translationPair[prefix+text];
    }
    
    if (typeof this.translationPair[text] == 'undefined') return text;
    
    return this.translationPair[text];    
    
}

TranslatableObject.prototype.translate = function() {
    this.translated = JSON.parse(JSON.stringify(this.object));
    
    var options  = {
        onData : (dataPart, index, thisContext) => {
            
            var translation = this.translateString(dataPart[index], thisContext);
            console.log("translation result", translation, dataPart[index]);
            if (translation == dataPart[index]) return;
            console.log("Translating!", dataPart[index], "-->", translation);
            dataPart[index] = translation;
                
        }
    }
    TranslatableObject.generate(this.translated, this.isStringOnly, options)
    return this.translated;    
    
}

TranslatableObject.prototype.generate = function() {
    this.generatedData = TranslatableObject.generate(this.object, this.isStringOnly)
    this.isGenerated = true;
    return this.generatedData;
}

TranslatableObject.generate = function(object, stringOnly, options) {
    options = options || {};
    options.onData = options.onData || function(){}
    /*
        generates file data from any object
    */
    object = object || {};
    var result = {
        data:[],
        context:[],
        tags:[],
        indexIds:{}
    }

    function traverseChild(dataPart, context) {
        context = context || [];
        for (var index in dataPart) {
            console.log("current index :", index);
            var thisContext = context.concat(index);
            
            if (typeof dataPart[index] == 'object') {
                traverseChild(dataPart[index], thisContext);
                continue;
            } 
            
            if (typeof dataPart[index] == 'function') continue;
            if (typeof dataPart[index] == 'undefined') continue;
            
            if (stringOnly && typeof dataPart[index] !== 'string') continue;
            var row             = result.data.length;
            result.indexIds[dataPart[index]] = row;
            result.data[row]     = [dataPart[index], ""];
            result.context[row] = result.context[row]    || [];
            result.context[row].push(thisContext.join("/"))            
            options.onData(dataPart, index, thisContext);
        }        
    }

    traverseChild(object)

    return result;    
}

common.spawn = function(app, args, options) {
    if (!app) return false;
    args = args||[];
    if (Array.isArray(args) == false) args=[args];
    options = options||{};
    options.onData = options.onData||function(result, e) {};
    options.onDone = options.onDone||function(result, e) {};
    options.onError = options.onError||function(result, e) {};
    options.relative = options.relative||false;
    
    if (options.relative) {
        app = nwPath.join(nw.process.cwd(), app);
    }
    
    var outputBuffer = "";

    if (typeof window.spawn  == "undefined") {
        window.spawn = require('child_process').spawn;
    }
    
    var maxOutputBuffer = 64 * 1024 * 1024;
    var child = spawn(app, args);

    
    child.stdout.on('data', function (data) {
        //console.log('stdout: ' + data);
        if (outputBuffer.length < maxOutputBuffer) {
            outputBuffer += data;
        }
        //console.log("Received buffer : "+data);
        options.onData.call(this, data);
        //options.onReceive.call(this, data);
    });

    child.stderr.on('data', function (data) {
        console.log('stderr: ' + data);
        options.onError.call(this, data);
        
    });

    child.on('close', function (code) {
        console.log('child process exited with code ' + code);
        //console.log("data is : "+outputBuffer);
        options.onDone.call(this, php.evalResult(outputBuffer));
    
    });    
    
}    

/**
 * Check whether a string is translatable text on UTF8 character map
 * @param {String} text - Text to check
 * @returns {Boolean} True if character is translatable
 */
common.isTranslatableText = function(text) {
    // not string
    if (typeof text === 'number') return true;
    if (typeof text !== 'string') return false;
    if (!text.trim()) return false;
    if (text.match(/\d/g) != null) return true;

    var allSymbols = /(?:[0-9!-/:-@[-`{-~\xA1-\xA9\xAB\xAC\xAE-\xB1\xB4\xB6-\xB8\xBB\xBF\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u037E\u0384\u0385\u0387\u03F6\u0482\u055A-\u055F\u0589\u058A\u058D-\u058F\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0606-\u060F\u061B\u061E\u061F\u066A-\u066D\u06D4\u06DE\u06E9\u06FD\u06FE\u0700-\u070D\u07F6-\u07F9\u07FE\u07FF\u0830-\u083E\u085E\u0964\u0965\u0970\u09F2\u09F3\u09FA\u09FB\u09FD\u0A76\u0AF0\u0AF1\u0B70\u0BF3-\u0BFA\u0C7F\u0C84\u0D4F\u0D79\u0DF4\u0E3F\u0E4F\u0E5A\u0E5B\u0F01-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38\u0F3A-\u0F3D\u0F85\u0FBE-\u0FC5\u0FC7-\u0FCC\u0FCE-\u0FDA\u104A-\u104F\u109E\u109F\u10FB\u1360-\u1368\u1390-\u1399\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DB\u1800-\u180A\u1940\u1944\u1945\u19DE-\u19FF\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B6A\u1B74-\u1B7C\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD\u1FFE\u2010-\u2027\u2030-\u205E\u207A-\u207E\u208A-\u208E\u20A0-\u20BF\u2100\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F\u218A\u218B\u2190-\u2426\u2440-\u244A\u249C-\u24E9\u2500-\u2775\u2794-\u2B73\u2B76-\u2B95\u2B98-\u2BC8\u2BCA-\u2BFE\u2CE5-\u2CEA\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4E\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFB\u3001-\u3004\u3008-\u3020\u3030\u3036\u3037\u303D-\u303F\u309B\u309C\u30A0\u30FB\u3190\u3191\u3196-\u319F\u31C0-\u31E3\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u32FE\u3300-\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA700-\uA716\uA720\uA721\uA789\uA78A\uA828-\uA82B\uA836-\uA839\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAA77-\uAA79\uAADE\uAADF\uAAF0\uAAF1\uAB5B\uABEB\uFB29\uFBB2-\uFBC1\uFD3E\uFD3F\uFDFC\uFDFD\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE66\uFE68-\uFE6B\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\uFFE0-\uFFE6\uFFE8-\uFFEE\uFFFC\uFFFD]|\uD800[\uDD00-\uDD02\uDD37-\uDD3F\uDD79-\uDD89\uDD8C-\uDD8E\uDD90-\uDD9B\uDDA0\uDDD0-\uDDFC\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDC77\uDC78\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEC8\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDF55-\uDF59]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDF3C-\uDF3F]|\uD806[\uDC3B\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8]|\uD809[\uDC70-\uDC74]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3F\uDF44\uDF45]|\uD81B[\uDE97-\uDE9A]|\uD82F[\uDC9C\uDC9F]|\uD834[\uDC00-\uDCF5\uDD00-\uDD26\uDD29-\uDD64\uDD6A-\uDD6C\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDDE8\uDE00-\uDE41\uDE45\uDF00-\uDF56]|\uD835[\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85-\uDE8B]|\uD83A[\uDD5E\uDD5F]|\uD83B[\uDCAC\uDCB0\uDEF0\uDEF1]|\uD83C[\uDC00-\uDC2B\uDC30-\uDC93\uDCA0-\uDCAE\uDCB1-\uDCBF\uDCC1-\uDCCF\uDCD1-\uDCF5\uDD10-\uDD6B\uDD70-\uDDAC\uDDE6-\uDE02\uDE10-\uDE3B\uDE40-\uDE48\uDE50\uDE51\uDE60-\uDE65\uDF00-\uDFFF]|\uD83D[\uDC00-\uDED4\uDEE0-\uDEEC\uDEF0-\uDEF9\uDF00-\uDF73\uDF80-\uDFD8]|\uD83E[\uDC00-\uDC0B\uDC10-\uDC47\uDC50-\uDC59\uDC60-\uDC87\uDC90-\uDCAD\uDD00-\uDD0B\uDD10-\uDD3E\uDD40-\uDD70\uDD73-\uDD76\uDD7A\uDD7C-\uDDA2\uDDB0-\uDDB9\uDDC0-\uDDC2\uDDD0-\uDDFF\uDE60-\uDE6D])/g
    {
        allSymbols = /(?:[!-/:-@[-`{-~\xA1-\xA9\xAB\xAC\xAE-\xB1\xB4\xB6-\xB8\xBB\xBF\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u037E\u0384\u0385\u0387\u03F6\u0482\u055A-\u055F\u0589\u058A\u058D-\u058F\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0606-\u060F\u061B\u061E\u061F\u066A-\u066D\u06D4\u06DE\u06E9\u06FD\u06FE\u0700-\u070D\u07F6-\u07F9\u07FE\u07FF\u0830-\u083E\u085E\u0964\u0965\u0970\u09F2\u09F3\u09FA\u09FB\u09FD\u0A76\u0AF0\u0AF1\u0B70\u0BF3-\u0BFA\u0C7F\u0C84\u0D4F\u0D79\u0DF4\u0E3F\u0E4F\u0E5A\u0E5B\u0F01-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38\u0F3A-\u0F3D\u0F85\u0FBE-\u0FC5\u0FC7-\u0FCC\u0FCE-\u0FDA\u104A-\u104F\u109E\u109F\u10FB\u1360-\u1368\u1390-\u1399\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DB\u1800-\u180A\u1940\u1944\u1945\u19DE-\u19FF\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B6A\u1B74-\u1B7C\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD\u1FFE\u2010-\u2027\u2030-\u205E\u207A-\u207E\u208A-\u208E\u20A0-\u20BF\u2100\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F\u218A\u218B\u2190-\u2426\u2440-\u244A\u249C-\u24E9\u2500-\u2775\u2794-\u2B73\u2B76-\u2B95\u2B98-\u2BC8\u2BCA-\u2BFE\u2CE5-\u2CEA\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4E\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFB\u3001-\u3004\u3008-\u3020\u3030\u3036\u3037\u303D-\u303F\u309B\u309C\u30A0\u30FB\u3190\u3191\u3196-\u319F\u31C0-\u31E3\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u32FE\u3300-\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA700-\uA716\uA720\uA721\uA789\uA78A\uA828-\uA82B\uA836-\uA839\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAA77-\uAA79\uAADE\uAADF\uAAF0\uAAF1\uAB5B\uABEB\uFB29\uFBB2-\uFBC1\uFD3E\uFD3F\uFDFC\uFDFD\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE66\uFE68-\uFE6B\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\uFFE0-\uFFE6\uFFE8-\uFFEE\uFFFC\uFFFD]|\uD800[\uDD00-\uDD02\uDD37-\uDD3F\uDD79-\uDD89\uDD8C-\uDD8E\uDD90-\uDD9B\uDDA0\uDDD0-\uDDFC\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDC77\uDC78\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEC8\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDF55-\uDF59]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDF3C-\uDF3F]|\uD806[\uDC3B\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8]|\uD809[\uDC70-\uDC74]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3F\uDF44\uDF45]|\uD81B[\uDE97-\uDE9A]|\uD82F[\uDC9C\uDC9F]|\uD834[\uDC00-\uDCF5\uDD00-\uDD26\uDD29-\uDD64\uDD6A-\uDD6C\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDDE8\uDE00-\uDE41\uDE45\uDF00-\uDF56]|\uD835[\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85-\uDE8B]|\uD83A[\uDD5E\uDD5F]|\uD83B[\uDCAC\uDCB0\uDEF0\uDEF1]|\uD83C[\uDC00-\uDC2B\uDC30-\uDC93\uDCA0-\uDCAE\uDCB1-\uDCBF\uDCC1-\uDCCF\uDCD1-\uDCF5\uDD10-\uDD6B\uDD70-\uDDAC\uDDE6-\uDE02\uDE10-\uDE3B\uDE40-\uDE48\uDE50\uDE51\uDE60-\uDE65\uDF00-\uDFFF]|\uD83D[\uDC00-\uDED4\uDEE0-\uDEEC\uDEF0-\uDEF9\uDF00-\uDF73\uDF80-\uDFD8]|\uD83E[\uDC00-\uDC0B\uDC10-\uDC47\uDC50-\uDC59\uDC60-\uDC87\uDC90-\uDCAD\uDD00-\uDD0B\uDD10-\uDD3E\uDD40-\uDD70\uDD73-\uDD76\uDD7A\uDD7C-\uDDA2\uDDB0-\uDDB9\uDDC0-\uDDC2\uDDD0-\uDDFF\uDE60-\uDE6D])/g
    }
    var rest = text.replace(allSymbols, "");
    if (!rest.trim()) return false;

    return true;
}

/**
 * Trim right side of a paragraph
 * @param {String} text - Text to be trimmed
 * @returns {String} Trimmed text
 */
common.trimRightParagraph = function(text) {
    if (!text) return "";
    var line = text.split("\n");
    for (var i in line) {
        line[i] = line[i].trimEnd()
    }
    return line.join("\n");
}

/**
 * Trim a paragraph
 * @param {String} text - Text to be trimmed
 * @returns {String} Trimmed text
 */
common.trimParagraph = function(text) {
    if (!text) return "";
    var line = text.split("\n");
    for (var i in line) {
        line[i] = line[i].trim()
    }
    return line.join("\n");
}

/**
 * Get the list of BCP 47 Language code
 * @returns {Object} Language code
 * @since 4.4.4
 */
common.getLanguageCode = function() {
    return {
        "af":"Afrikaans",
        "af-ZA":"Afrikaans (South Africa)",
        "ar":"Arabic",
        "ar-AE":"Arabic (U.A.E.)",
        "ar-BH":"Arabic (Bahrain)",
        "ar-DZ":"Arabic (Algeria)",
        "ar-EG":"Arabic (Egypt)",
        "ar-IQ":"Arabic (Iraq)",
        "ar-JO":"Arabic (Jordan)",
        "ar-KW":"Arabic (Kuwait)",
        "ar-LB":"Arabic (Lebanon)",
        "ar-LY":"Arabic (Libya)",
        "ar-MA":"Arabic (Morocco)",
        "ar-OM":"Arabic (Oman)",
        "ar-QA":"Arabic (Qatar)",
        "ar-SA":"Arabic (Saudi Arabia)",
        "ar-SY":"Arabic (Syria)",
        "ar-TN":"Arabic (Tunisia)",
        "ar-YE":"Arabic (Yemen)",
        "az":"Azeri (Latin)",
        "az-AZ":"Azeri (Cyrillic) (Azerbaijan)",
        "be":"Belarusian",
        "be-BY":"Belarusian (Belarus)",
        "bg":"Bulgarian",
        "bg-BG":"Bulgarian (Bulgaria)",
        "bs-BA":"Bosnian (Bosnia and Herzegovina)",
        "ca":"Catalan",
        "ca-ES":"Catalan (Spain)",
        "cs":"Czech",
        "cs-CZ":"Czech (Czech Republic)",
        "cy":"Welsh",
        "cy-GB":"Welsh (United Kingdom)",
        "da":"Danish",
        "da-DK":"Danish (Denmark)",
        "de":"German",
        "de-AT":"German (Austria)",
        "de-CH":"German (Switzerland)",
        "de-DE":"German (Germany)",
        "de-LI":"German (Liechtenstein)",
        "de-LU":"German (Luxembourg)",
        "dv":"Divehi",
        "dv-MV":"Divehi (Maldives)",
        "el":"Greek",
        "el-GR":"Greek (Greece)",
        "en":"English",
        "en-AU":"English (Australia)",
        "en-BZ":"English (Belize)",
        "en-CA":"English (Canada)",
        "en-NZ":"English (New Zealand)",
        "en-PH":"English (Republic of the Philippines)",
        "en-TT":"English (Trinidad and Tobago)",
        "en-US":"English (United States)",
        "en-ZA":"English (South Africa)",
        "en-ZW":"English (Zimbabwe)",
        "eo":"Esperanto",
        "es":"Spanish",
        "es-AR":"Spanish (Argentina)",
        "es-BO":"Spanish (Bolivia)",
        "es-CL":"Spanish (Chile)",
        "es-CO":"Spanish (Colombia)",
        "es-CR":"Spanish (Costa Rica)",
        "es-DO":"Spanish (Dominican Republic)",
        "es-EC":"Spanish (Ecuador)",
        "es-ES":"Spanish (Spain)",
        "es-GT":"Spanish (Guatemala)",
        "es-HN":"Spanish (Honduras)",
        "es-MX":"Spanish (Mexico)",
        "es-NI":"Spanish (Nicaragua)",
        "es-PA":"Spanish (Panama)",
        "es-PE":"Spanish (Peru)",
        "es-PR":"Spanish (Puerto Rico)",
        "es-PY":"Spanish (Paraguay)",
        "es-SV":"Spanish (El Salvador)",
        "es-UY":"Spanish (Uruguay)",
        "es-VE":"Spanish (Venezuela)",
        "et":"Estonian",
        "et-EE":"Estonian (Estonia)",
        "eu":"Basque",
        "eu-ES":"Basque (Spain)",
        "fa":"Farsi",
        "fa-IR":"Farsi (Iran)",
        "fi":"Finnish",
        "fi-FI":"Finnish (Finland)",
        "fo":"Faroese",
        "fo-FO":"Faroese (Faroe Islands)",
        "fr":"French",
        "fr-BE":"French (Belgium)",
        "fr-CA":"French (Canada)",
        "fr-CH":"French (Switzerland)",
        "fr-FR":"French (France)",
        "fr-LU":"French (Luxembourg)",
        "fr-MC":"French (Principality of Monaco)",
        "gl":"Galician",
        "gl-ES":"Galician (Spain)",
        "gu":"Gujarati",
        "gu-IN":"Gujarati (India)",
        "he":"Hebrew",
        "he-IL":"Hebrew (Israel)",
        "hi":"Hindi",
        "hi-IN":"Hindi (India)",
        "hr":"Croatian",
        "hr-BA":"Croatian (Bosnia and Herzegovina)",
        "hr-HR":"Croatian (Croatia)",
        "hu":"Hungarian",
        "hu-HU":"Hungarian (Hungary)",
        "hy":"Armenian",
        "hy-AM":"Armenian (Armenia)",
        "id":"Indonesian",
        "id-ID":"Indonesian (Indonesia)",
        "is":"Icelandic",
        "is-IS":"Icelandic (Iceland)",
        "it":"Italian",
        "it-CH":"Italian (Switzerland)",
        "it-IT":"Italian (Italy)",
        "ja":"Japanese",
        "ja-JP":"Japanese (Japan)",
        "ka":"Georgian",
        "ka-GE":"Georgian (Georgia)",
        "kk":"Kazakh",
        "kk-KZ":"Kazakh (Kazakhstan)",
        "kn":"Kannada",
        "kn-IN":"Kannada (India)",
        "ko":"Korean",
        "ko-KR":"Korean (Korea)",
        "kok":"Konkani",
        "kok-IN":"Konkani (India)",
        "ky":"Kyrgyz",
        "ky-KG":"Kyrgyz (Kyrgyzstan)",
        "lt":"Lithuanian",
        "lt-LT":"Lithuanian (Lithuania)",
        "lv":"Latvian",
        "lv-LV":"Latvian (Latvia)",
        "mi":"Maori",
        "mi-NZ":"Maori (New Zealand)",
        "mk":"FYRO Macedonian",
        "mk-MK":"FYRO Macedonian (Former Yugoslav Republic of Macedonia)",
        "mn":"Mongolian",
        "mn-MN":"Mongolian (Mongolia)",
        "mr":"Marathi",
        "mr-IN":"Marathi (India)",
        "ms":"Malay",
        "ms-BN":"Malay (Brunei Darussalam)",
        "ms-MY":"Malay (Malaysia)",
        "mt":"Maltese",
        "mt-MT":"Maltese (Malta)",
        "nb":"Norwegian (Bokm?l)",
        "nb-NO":"Norwegian (Bokm?l) (Norway)",
        "nl":"Dutch",
        "nl-BE":"Dutch (Belgium)",
        "nl-NL":"Dutch (Netherlands)",
        "nn-NO":"Norwegian (Nynorsk) (Norway)",
        "ns":"Northern Sotho",
        "ns-ZA":"Northern Sotho (South Africa)",
        "pa":"Punjabi",
        "pa-IN":"Punjabi (India)",
        "pl":"Polish",
        "pl-PL":"Polish (Poland)",
        "ps":"Pashto",
        "ps-AR":"Pashto (Afghanistan)",
        "pt":"Portuguese",
        "pt-BR":"Portuguese (Brazil)",
        "pt-PT":"Portuguese (Portugal)",
        "qu":"Quechua",
        "qu-BO":"Quechua (Bolivia)",
        "qu-EC":"Quechua (Ecuador)",
        "qu-PE":"Quechua (Peru)",
        "ro":"Romanian",
        "ro-RO":"Romanian (Romania)",
        "ru":"Russian",
        "ru-RU":"Russian (Russia)",
        "sa":"Sanskrit",
        "sa-IN":"Sanskrit (India)",
        "se":"Sami (Northern)",
        "se-FI":"Sami (Northern) (Finland)",
        "se-NO":"Sami (Northern) (Norway)",
        "se-SE":"Sami (Northern) (Sweden)",
        "sk":"Slovak",
        "sk-SK":"Slovak (Slovakia)",
        "sl":"Slovenian",
        "sl-SI":"Slovenian (Slovenia)",
        "sq":"Albanian",
        "sq-AL":"Albanian (Albania)",
        "sr-BA":"Serbian (Latin) (Bosnia and Herzegovina)",
        "sr-SP":"Serbian (Latin) (Serbia and Montenegro)",
        "sv":"Swedish",
        "sv-FI":"Swedish (Finland)",
        "sv-SE":"Swedish (Sweden)",
        "sw":"Swahili",
        "sw-KE":"Swahili (Kenya)",
        "syr":"Syriac",
        "syr-SY":"Syriac (Syria)",
        "ta":"Tamil",
        "ta-IN":"Tamil (India)",
        "te":"Telugu",
        "te-IN":"Telugu (India)",
        "th":"Thai",
        "th-TH":"Thai (Thailand)",
        "tl":"Tagalog",
        "tl-PH":"Tagalog (Philippines)",
        "tn":"Tswana",
        "tn-ZA":"Tswana (South Africa)",
        "tr":"Turkish",
        "tr-TR":"Turkish (Turkey)",
        "tt":"Tatar",
        "tt-RU":"Tatar (Russia)",
        "ts":"Tsonga",
        "uk":"Ukrainian",
        "uk-UA":"Ukrainian (Ukraine)",
        "ur":"Urdu",
        "ur-PK":"Urdu (Islamic Republic of Pakistan)",
        "uz":"Uzbek (Latin)",
        "uz-UZ":"Uzbek (Latin) (Uzbekistan)",
        "vi":"Vietnamese",
        "vi-VN":"Vietnamese (Viet Nam)",
        "xh":"Xhosa",
        "xh-ZA":"Xhosa (South Africa)",
        "zh":"Chinese",
        "zh-CN":"Chinese (S)",
        "zh-HK":"Chinese (Hong Kong)",
        "zh-MO":"Chinese (Macau)",
        "zh-SG":"Chinese (Singapore)",
        "zh-TW":"Chinese (T)",
        "zu":"Zulu",
        "zu-ZA":"Zulu (South Africa)",
    }
}

common.getNamedColor = function(color) {
    var colorDB = {
        "aliceblue": "#f0f8ff",
        "antiquewhite": "#faebd7",
        "aqua": "#00ffff",
        "aquamarine": "#7fffd4",
        "azure": "#f0ffff",
        "beige": "#f5f5dc",
        "bisque": "#ffe4c4",
        "black": "#000000",
        "blanchedalmond": "#ffebcd",
        "blue": "#0000ff",
        "blueviolet": "#8a2be2",
        "brown": "#a52a2a",
        "burlywood": "#deb887",
        "cadetblue": "#5f9ea0",
        "chartreuse": "#7fff00",
        "chocolate": "#d2691e",
        "coral": "#ff7f50",
        "cornflowerblue": "#6495ed",
        "cornsilk": "#fff8dc",
        "crimson": "#dc143c",
        "cyan": "#00ffff",
        "darkblue": "#00008b",
        "darkcyan": "#008b8b",
        "darkgoldenrod": "#b8860b",
        "darkgray": "#a9a9a9",
        "darkgreen": "#006400",
        "darkgrey": "#a9a9a9",
        "darkkhaki": "#bdb76b",
        "darkmagenta": "#8b008b",
        "darkolivegreen": "#556b2f",
        "darkorange": "#ff8c00",
        "darkorchid": "#9932cc",
        "darkred": "#8b0000",
        "darksalmon": "#e9967a",
        "darkseagreen": "#8fbc8f",
        "darkslateblue": "#483d8b",
        "darkslategray": "#2f4f4f",
        "darkslategrey": "#2f4f4f",
        "darkturquoise": "#00ced1",
        "darkviolet": "#9400d3",
        "deeppink": "#ff1493",
        "deepskyblue": "#00bfff",
        "dimgray": "#696969",
        "dimgrey": "#696969",
        "dodgerblue": "#1e90ff",
        "firebrick": "#b22222",
        "floralwhite": "#fffaf0",
        "forestgreen": "#228b22",
        "fuchsia": "#ff00ff",
        "gainsboro": "#dcdcdc",
        "ghostwhite": "#f8f8ff",
        "goldenrod": "#daa520",
        "gold": "#ffd700",
        "gray": "#808080",
        "green": "#008000",
        "greenyellow": "#adff2f",
        "grey": "#808080",
        "honeydew": "#f0fff0",
        "hotpink": "#ff69b4",
        "indianred": "#cd5c5c",
        "indigo": "#4b0082",
        "ivory": "#fffff0",
        "khaki": "#f0e68c",
        "lavenderblush": "#fff0f5",
        "lavender": "#e6e6fa",
        "lawngreen": "#7cfc00",
        "lemonchiffon": "#fffacd",
        "lightblue": "#add8e6",
        "lightcoral": "#f08080",
        "lightcyan": "#e0ffff",
        "lightgoldenrodyellow": "#fafad2",
        "lightgray": "#d3d3d3",
        "lightgreen": "#90ee90",
        "lightgrey": "#d3d3d3",
        "lightpink": "#ffb6c1",
        "lightsalmon": "#ffa07a",
        "lightseagreen": "#20b2aa",
        "lightskyblue": "#87cefa",
        "lightslategray": "#778899",
        "lightslategrey": "#778899",
        "lightsteelblue": "#b0c4de",
        "lightyellow": "#ffffe0",
        "lime": "#00ff00",
        "limegreen": "#32cd32",
        "linen": "#faf0e6",
        "magenta": "#ff00ff",
        "maroon": "#800000",
        "mediumaquamarine": "#66cdaa",
        "mediumblue": "#0000cd",
        "mediumorchid": "#ba55d3",
        "mediumpurple": "#9370db",
        "mediumseagreen": "#3cb371",
        "mediumslateblue": "#7b68ee",
        "mediumspringgreen": "#00fa9a",
        "mediumturquoise": "#48d1cc",
        "mediumvioletred": "#c71585",
        "midnightblue": "#191970",
        "mintcream": "#f5fffa",
        "mistyrose": "#ffe4e1",
        "moccasin": "#ffe4b5",
        "navajowhite": "#ffdead",
        "navy": "#000080",
        "oldlace": "#fdf5e6",
        "olive": "#808000",
        "olivedrab": "#6b8e23",
        "orange": "#ffa500",
        "orangered": "#ff4500",
        "orchid": "#da70d6",
        "palegoldenrod": "#eee8aa",
        "palegreen": "#98fb98",
        "paleturquoise": "#afeeee",
        "palevioletred": "#db7093",
        "papayawhip": "#ffefd5",
        "peachpuff": "#ffdab9",
        "peru": "#cd853f",
        "pink": "#ffc0cb",
        "plum": "#dda0dd",
        "powderblue": "#b0e0e6",
        "purple": "#800080",
        "rebeccapurple": "#663399",
        "red": "#ff0000",
        "rosybrown": "#bc8f8f",
        "royalblue": "#4169e1",
        "saddlebrown": "#8b4513",
        "salmon": "#fa8072",
        "sandybrown": "#f4a460",
        "seagreen": "#2e8b57",
        "seashell": "#fff5ee",
        "sienna": "#a0522d",
        "silver": "#c0c0c0",
        "skyblue": "#87ceeb",
        "slateblue": "#6a5acd",
        "slategray": "#708090",
        "slategrey": "#708090",
        "snow": "#fffafa",
        "springgreen": "#00ff7f",
        "steelblue": "#4682b4",
        "tan": "#d2b48c",
        "teal": "#008080",
        "thistle": "#d8bfd8",
        "tomato": "#ff6347",
        "turquoise": "#40e0d0",
        "violet": "#ee82ee",
        "wheat": "#f5deb3",
        "white": "#ffffff",
        "whitesmoke": "#f5f5f5",
        "yellow": "#ffff00",
        "yellowgreen": "#9acd32"
    }
    if (!color) return colorDB;
    return colorDB[color];
}

// const FreeIndex = function(array) {
//     this.index = {}
//     this.init = ()=> {
//         this.index = {}
//         for (let i=0; i<array.length; i++) {
//             this.index[array[i]] ||= [];
//             this.index[array[i]].push(i);
//         }
//     }
//     this.get = (keyword)=> {
//         return this[keyword] || [];
//     }
//     this.destroy = ()=> {
//         this.index = undefined;
//     }
    
//     this.init();
// }

// ============================================================
//
// CORE LEVEL PROTOTYPES
// 
// ============================================================

String.prototype.replaces = function(str, replace, incaseSensitive) {
    if(!incaseSensitive){
        return this.split(str).join(replace);
    } else { 
        // Replace this part with regex for more performance
        
        /*
        var strLower = this.toLowerCase();
        var findLower = String(str).toLowerCase();
        var strTemp = this.toString();

        var pos = strLower.length;
        while((pos = strLower.lastIndexOf(findLower, pos)) != -1){
            strTemp = strTemp.substr(0, pos) + replace + strTemp.substr(pos + findLower.length);
            pos--;
        }
        */
        return str_ireplace(str, replace, this);
    }
};

if (global.$) {
    // Jquery patch
    void function() {
        if (!$.fn) return;
        $.fn.css = (function(css) {
            return function fn(key, value) {
                var self = this;
                if (arguments.length == 1 && $.isPlainObject(arguments[0])) {
                    var data = arguments[0];
                    Object.keys(data).forEach(function(key) {
                        fn.call(self, key, data[key]);
                    });
                } else if (key.match(/^\s*--/)) {
                    if (typeof value === 'undefined') {
                        return self[0].style.getPropertyValue(key);
                    } else {
                        self[0].style.setProperty(key, value);
                    }
                } else {
                    return css.apply(self, arguments);
                }
                return self;
            };
        })($.fn.css);
    }();
    
}


if (!module.parent) {
    console.log('common.js called directly');

    /**
     * Insert text at caret possition
     * @param {String} text 
     */
    HTMLTextAreaElement.prototype.insertAtCaret = function (text) {
        text = text || '';
        if (document.selection) {
        // IE
        this.focus();
        var sel = document.selection.createRange();
        sel.text = text;
        } else if (this.selectionStart || this.selectionStart === 0) {
        // Others
        var startPos = this.selectionStart;
        var endPos = this.selectionEnd;
        this.value = this.value.substring(0, startPos) +
            text +
            this.value.substring(endPos, this.value.length);
        this.selectionStart = startPos + text.length;
        this.selectionEnd = startPos + text.length;
        } else {
        this.value += text;
        }
    };

    common.localStorage = new (require("www/js/lib/localStore.js"))("common");

    $(document).ready(function() {
        $("a[target=_system]").on("click", function(e) {
            e.preventDefault();
            nw.Shell.openExternal($(this).attr("href"));
        });
    });
} else {
    console.warn('common.js required as a module');
    module.exports = common;
}