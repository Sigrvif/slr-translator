var LangTools = function (langDB) {
	this.langDB = langDB;
};

LangTools.prototype.getLanguage = function (code) {
	return this.lookupAlias(this.langDB[code]);
};

LangTools.prototype.getLanguageList = function (blacklist = []) {
	var langList = {};
	blacklist ||= [];
	for (var code in this.langDB) {
		if (blacklist.includes(code)) continue;
		langList[code] = this.langDB[code].name;
	}
	return langList;
};

LangTools.prototype.lookupAlias = function (langObj) {
	if (!langObj) return langObj;
	if (!langObj.alias) return langObj;
	if (!this.langDB[langObj.alias]) return langObj;
	if (this.langDB[langObj.alias]) return this.langDB[langObj.alias];
};

LangTools.prototype.lookupDB = function (key = "", name = "") {
	if (!key) return;
	key = key.toLowerCase();
	if (this.langDB[key]) {
		return this.lookupAlias(this.langDB[key]);
	}

	for (var i in this.langDB) {
		if (key == this.langDB[i].idt) this.lookupAlias(this.langDB[i]);
		if (key == this.langDB[i].idb) this.lookupAlias(this.langDB[i]);
		if (typeof this.langDB[i].name !== "string") continue;
		if (this.langDB[i].name.toLowerCase() == name.toLowerCase()) return this.lookupAlias(this.langDB[i]);
	}
};

LangTools.prototype.getFullName = function (langObj) {
	if (langObj.displayName && langObj.name != langObj.displayName) {
		return langObj.name + "(" + langObj.displayName + ")";
	}
	return langObj.name;
};

LangTools.prototype.compareWithDB = function (langPairs) {
	var match = {};
	var unmatch = {};
	for (var code in langPairs) {
		var thisLang = this.lookupDB(code, langPairs[code]);
		if (thisLang) {
			match[code] = thisLang;
		} else {
			unmatch[code.toLowerCase()] = {
				"name": langPairs[code],
				"displayName": "",
				"displayNameAlt": "",
				"description": langPairs[code],
				"descriptionAlt": "",
				"groupTag": "",
				"id": code.toLowerCase(),
				"groupName": ""
			};
		}
	}

	return { match: match, unmatch: unmatch };
};

LangTools.prototype.generateLangPairs = function (langPairs) {
	var match = {};
	var unmatch = {};
	for (var code in langPairs) {
		var thisLang = this.lookupDB(code, langPairs[code]);
		if (thisLang) {
			match[thisLang.id] = code;
		} else {
			unmatch[code.toLowerCase()] = {
				"name": langPairs[code],
				"displayName": "",
				"displayNameAlt": "",
				"description": langPairs[code],
				"descriptionAlt": "",
				"groupTag": "",
				"id": code.toLowerCase(),
				"groupName": ""
			};
		}
	}

	return { match: match, unmatch: unmatch };
};

LangTools.prototype.isCJK = function (langCode) {
	if (!langCode) return false;
	langCode = langCode.toLowerCase();
	var majorLang = langCode.split("-")[0];
	if (["ja", "ko", "zh"].includes(majorLang)) return true;
	return false;
};

module.exports = LangTools;
