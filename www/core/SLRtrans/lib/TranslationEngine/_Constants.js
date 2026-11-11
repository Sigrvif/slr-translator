"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isolationGroupsRegExp = exports.PlaceholderTypeNames = exports.PlaceholderType = exports.TextProcessorOrderType = void 0;
var TextProcessorOrderType;
(function (TextProcessorOrderType) {
    TextProcessorOrderType[TextProcessorOrderType["ESCAPE_SYMBOLS"] = 0] = "ESCAPE_SYMBOLS";
    TextProcessorOrderType[TextProcessorOrderType["ISOLATE_SENTENCES"] = 1] = "ISOLATE_SENTENCES";
    TextProcessorOrderType[TextProcessorOrderType["CUT_CORNERS"] = 2] = "CUT_CORNERS";
    TextProcessorOrderType[TextProcessorOrderType["AGGRESSIVE_SPLITTING"] = 3] = "AGGRESSIVE_SPLITTING";
    TextProcessorOrderType[TextProcessorOrderType["BREAK_LINES"] = 4] = "BREAK_LINES";
})(TextProcessorOrderType = exports.TextProcessorOrderType || (exports.TextProcessorOrderType = {}));
var PlaceholderType;
(function (PlaceholderType) {
    PlaceholderType["slrsugoi"] = "slrsugoi";
    PlaceholderType["poleposition"] = "poleposition";
    PlaceholderType["hexPlaceholder"] = "hexPlaceholder";
    PlaceholderType["ninesOfRandomness"] = "ninesOfRandomness";
    PlaceholderType["tagPlaceholder"] = "tagPlaceholder";
    PlaceholderType["tagPlaceholderLetter"] = "tagPlaceholderLetter";
    PlaceholderType["closedTagPlaceholder"] = "closedTagPlaceholder";
    PlaceholderType["fullTagPlaceholder"] = "fullTagPlaceholder";
    PlaceholderType["curlie"] = "curlie";
    PlaceholderType["doubleCurlie"] = "doubleCurlie";
    PlaceholderType["curlieLetter"] = "curlieLetter";
    PlaceholderType["doubleCurlieLetter"] = "doubleCurlieLetter";
    PlaceholderType["privateUse"] = "privateUse";
    PlaceholderType["hashtag"] = "hashtag";
    PlaceholderType["hashtagTriple"] = "hashtagTriple";
    PlaceholderType["tournament"] = "tournament";
    PlaceholderType["mvStyle"] = "mvStyle";
    PlaceholderType["wolfStyle"] = "wolfStyle";
    PlaceholderType["percentage"] = "percentage";
    PlaceholderType["mvStyleLetter"] = "mvStyleLetter";
    PlaceholderType["wolfStyleLetter"] = "wolfStyleLetter";
    PlaceholderType["sugoiTranslatorSpecial"] = "sugoiTranslatorSpecial";
    PlaceholderType["sugoiTranslatorSpecial2"] = "sugoiTranslatorSpecial2";
})(PlaceholderType = exports.PlaceholderType || (exports.PlaceholderType = {}));
var PlaceholderTypeNames;
(function (PlaceholderTypeNames) {
	PlaceholderTypeNames["slrsugoi"] = "SLR Special (e.g. @@1@, @@2@)";
    PlaceholderTypeNames["poleposition"] = "Poleposition (e.g. #24)";
    PlaceholderTypeNames["hexPlaceholder"] = "Hex Placeholder (e.g. 0xffffff)";
    PlaceholderTypeNames["ninesOfRandomness"] = "Closed Nines (e.g. 9123412349)";
    PlaceholderTypeNames["tagPlaceholder"] = "Tag Placeholder (e.g. &lt;24&gt;)";
    PlaceholderTypeNames["tagPlaceholderLetter"] = "Tag Placeholder with Letters (e.g. &lt;A&gt;";
    PlaceholderTypeNames["closedTagPlaceholder"] = "Tag Placeholder Closed Tags (e.g. &lt;24/&gt;)";
    PlaceholderTypeNames["fullTagPlaceholder"] = "Tag Placeholder Full XML-style Tag (e.g. &lt;24&gt;&lt;/24&gt;)";
    PlaceholderTypeNames["curlie"] = "Curlies (e.g. &#10100;1&#10101;)";
    PlaceholderTypeNames["doubleCurlie"] = "Double Curlies (e.g. &#10100;&#10100;1&#10101;&#10101;)";
    PlaceholderTypeNames["curlieLetter"] = "Curlies (e.g. &#10100;A&#10101;)";
    PlaceholderTypeNames["doubleCurlieLetter"] = "Double Curlies (e.g. &#10100;&#10100;A&#10101;&#10101;)";
    PlaceholderTypeNames["privateUse"] = "Supplementary Private Use Area-A (\uD83D\uDC7D)";
    PlaceholderTypeNames["hashtag"] = "Hashtag (#A)";
    PlaceholderTypeNames["hashtagTriple"] = "Triple Hashtag (#ABC)";
    PlaceholderTypeNames["tournament"] = "Tournament (e.g. #1, #2, #3)";
    PlaceholderTypeNames["mvStyle"] = "MV Message (e.g. %1, %2, %3)";
    PlaceholderTypeNames["wolfStyle"] = "Wolf Message (e.g. @1, @2, @3)";
    PlaceholderTypeNames["percentage"] = "Actual Percentage (e.g. 1%, 2%)";
    PlaceholderTypeNames["mvStyleLetter"] = "MV Message but with Letters (e.g. %A, %B, %C)";
    PlaceholderTypeNames["wolfStyleLetter"] = "Wolf Message but with letters (e.g. @A, @B, @C)";
    PlaceholderTypeNames["sugoiTranslatorSpecial"] = "ivdos' Special (e.g. @#1, @#2)";
    PlaceholderTypeNames["sugoiTranslatorSpecial2"] = "ivdos' Special with Letters (e.g. @#A, @#B)";
})(PlaceholderTypeNames = exports.PlaceholderTypeNames || (exports.PlaceholderTypeNames = {}));
// ´`
// `´
const isolationGroups = [
    ['（', '）'],
    ['⟨', '⟩'],
    ['〔', '〕'],
    ['〖', '〗'],
    ['〘', '〙'],
    ['〚', '〛'],
    ['｢', '｣'],
    ['「', '」'],
    ['〈', '〉'],
    ['『', '』'],
    ['【', '】'],
    ['［', '］'],
    ['《', '》'],
    ['{', '}'],
    ['〝', '〞'],
    ['〞', '〝'],
    ['〞', '〞'],
    ['〝', '〟'],
    ['〟', '〟'],
    ['〝', '〝'],
    ['＜', '＞'],
    ['｛', '｝'],
    ['｟', '｠'],
    ['"', '"'],
    ['“', '”'],
    ['`', '`'],
    ['´', '´'],
    ['’', '’']
];
exports.isolationGroupsRegExp = [];
isolationGroups.forEach((group) => {
    //exports.isolationGroupsRegExp.push(new RegExp(`\\\\?${group[0]}[^${group[0]}${group[1]}]+?\\\\?${group[1]}`, 'g').toString() + ',');
    exports.isolationGroupsRegExp.push(new RegExp(`\\\\?${group[0]}[^${group[0]}${group[1]}]*?[一-龠ぁ-ゔァ-ヴー々〆〤ヶﾚﾃﾞｨﾌｧｲｯ][^${group[0]}${group[1]}]*?\\\\?${group[1]}`, 'g').toString() + ',');
});
