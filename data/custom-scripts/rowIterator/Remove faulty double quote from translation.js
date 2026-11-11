if (!this.keyText) return;
var bestTranslation = this.getBestTranslation();
const bestTranslationColumn = this.getBestTranslationCol();

function countInstances(string, word) {
    if (typeof string !== "string") return;
   return string.split(word).length - 1;
}

const occurance = countInstances(bestTranslation, '"');
if (typeof occurance !== "number") return;

if (occurance % 2 == 0) return;

console.log("problem found", bestTranslation);

var fixed = bestTranslation.trimEnd().replace(`"`, "");
console.log("fixed", fixed)
this.cells[bestTranslationColumn] = fixed.trimEnd();