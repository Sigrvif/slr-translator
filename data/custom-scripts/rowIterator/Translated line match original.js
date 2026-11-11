/**
 * Will check the translation from subjectColumn. If the line count is not match with the original, then 
 * this script will make the translation match the number of line of the original.
 * 
 */

const subjectColumn = this.getBestTranslationCol();
const writeIntoColumn = 5;


if (!this.keyText) return;
if (typeof subjectColumn !== "number") return;

const translation = this.cells[subjectColumn];
if (!translation) return;

const originalLines = this.keyText.replaceAll("\r", "").split("\n");
const translationLines = translation.replaceAll("\r", "").split("\n");

if (originalLines.length == translationLines.length) return;

var translatedParagraph = translationLines.join(" ");

var equalSizedLine = common.splitIntoLine(translatedParagraph, originalLines.length)
if (Array.isArray(equalSizedLine) == false) return;
console.log("originalLines", originalLines);
console.log("wordwrap result:\n", equalSizedLine.join("\n"));

this.cells[writeIntoColumn] = equalSizedLine.join("\n")