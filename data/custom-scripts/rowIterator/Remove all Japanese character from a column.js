/**
 * This automation will remove any Japanese character from the best translation column
 * - Japanese punctuation will be kept
 * - Full width number will be converted into half width
 * - _japaneseChars (Sugoi Translator residual token) will be cleaned
 */

if (!this.keyText) return;

const bestTranslationColumn = this.getBestTranslationCol();
const bestTranslation = this.getBestTranslation();

if (!common.containJapanese(bestTranslation)) return



var japRegex = new RegExp(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/g);
                          //-------------_____________-------------_____________-------------_____________
                          // Punctuation   Hiragana     Katakana    Full-width       CJK      CJK Ext. A



function toASCII(chars) {
    var ascii = '';
    for(var i=0, l=chars.length; i<l; i++) {
        var c = chars[i].charCodeAt(0);

        // make sure we only convert half-full width char
        if (c >= 0xFF00 && c <= 0xFFEF) {
           c = 0xFF & (c + 0x20);
        }

        ascii += String.fromCharCode(c);
    }

    return ascii;
}


var cleaned = toASCII(bestTranslation);

cleaned = cleaned.replaceAll(/_[\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]+/g, "")
cleaned = cleaned.replaceAll(/[\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/g, "")
console.log("contain japanese", bestTranslation);
console.log("cleaned:", cleaned);

this.cells[bestTranslationColumn] = cleaned;