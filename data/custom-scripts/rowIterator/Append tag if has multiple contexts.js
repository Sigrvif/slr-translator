/**:info
 * some description
 * @arg {string} tagColor - Please enter the tag color
 * @arg {string|null} [someTag=data] - some information
 * @form 
 * {
    "display": "form",
    "settings": {},
    "components": [
        {
            "label": "Enter the tag name",
            "placeholder": "red",
            "applyMaskOn": "change",
            "tableView": true,
            "key": "tagName",
            "type": "textfield",
            "input": true,
            "validate": {
                "required": true
            }
        }
    ]
}
 */
if (!this.keyText) return;
console.log("index", this.index);
console.log("userInput", this.userInput);
if (this.context.length > 1) this.tags.push(this.userInput.tagName || "yellow");
