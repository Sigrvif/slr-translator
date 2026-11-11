// Romaji/furigana reading aid. On cell select, tokenizes Japanese text via
// MeCab (through php.spawn -> translator\mecab\mecab.php) and renders the
// [{romaji, original}] result, with an LRU cache so repeated cells are instant.
const romaji = {
	maxCache: 100,
	cache: [],
	cacheData: {},
	rowMode: "table" // "table" (romaji row above kanji row) or word-by-word
};
trans.config = trans.config || {};
trans.config.loadRomaji = trans.config.loadRomaji || true;

romaji.addCache = function (data, result) {
	if (!data) return false;
	if (romaji.cache.includes(data) == false) {
		romaji.cache.unshift(data);
		romaji.cacheData[data] = result;

		while (romaji.cache.length > romaji.maxCache) {
			var id = romaji.cache.pop();
			delete romaji.cacheData[id];
		}
	}
	return true;
};

romaji.loadCache = function (data) {
	if (typeof romaji.cacheData[data] !== "undefined") return romaji.cacheData[data];
	return false;
};

romaji.resolve = function (text, $target) {
	if (!text) {
		$target.text("");
		$target.addClass("plain");
		return false;
	}
	if (common.containJapanese(text) == false) {
		$target.text(text);
		$target.addClass("plain");
		$target.attr("data-lang", "");
		return false;
	}

	$target.removeClass("plain");
	$target.attr("data-lang", "ja");
	// Show the original text immediately so the panel is never blank; the romaji
	// rendering below empties + replaces it once MeCab returns. If MeCab is
	// unavailable (e.g. no bundled binary on this platform), the text stays visible.
	$target.text(text);
	var loadedCache = romaji.loadCache(text);
	if (loadedCache !== false) {
		$target.empty();
		for (let line = 0; line < loadedCache.length; line++) {
			if (romaji.rowMode !== "table") {
				let $row = $("<div class='wbw'></div>");
				if (Array.isArray(loadedCache[line]) == false) continue;
				for (let i = 0; i < loadedCache[line].length; i++) {
					if (loadedCache[line][i]["romaji"].length < 1) loadedCache[line][i]["romaji"] = " ";
					var template = $("<span><i>" + loadedCache[line][i]["romaji"] + "</i><b>" + loadedCache[line][i]["original"] + "</b></span>");
					$row.append(template);
				}
				$target.append($row);
			} else {
				let $row = $("<div class='tbl'></div>");
				if (Array.isArray(loadedCache[line]) == false) continue;

				let $romaji = $("<span class='romaji'></span>");
				let $kanji = $("<span class='kanji'></span>");
				for (let i = 0; i < loadedCache[line].length; i++) {
					if (loadedCache[line][i]["romaji"].length < 1) loadedCache[line][i]["romaji"] = " ";
					$romaji.append("<i>" + loadedCache[line][i]["romaji"] + "</i>");
					$kanji.append("<b>" + loadedCache[line][i]["original"] + "</b>");
				}
				$row.append($romaji);
				$row.append($kanji);

				$target.append($row);
			}
		}

		return true;
	}

	if (this._debounce) clearTimeout(this._debounce);
	this._debounce = setTimeout(() => {
		php.spawn("translator/mecab/mecab.php", {
			args: {
				text: text
			},
			onDone: function (result) {
				if (Array.isArray(result)) {
					romaji.addCache(text, result);
					if (typeof $target == "undefined") return result;
					$target.empty();

					if (romaji.rowMode !== "table") {
						for (let line = 0; line < result.length; line++) {
							let $row = $("<div class='wbw'></div>");
							if (Array.isArray(result[line]) == false) continue;
							for (let i = 0; i < result[line].length; i++) {
								if (result[line][i]["romaji"].length < 1) result[line][i]["romaji"] = " ";
								var template = $("<span><i>" + result[line][i]["romaji"] + "</i><b>" + result[line][i]["original"] + "</b></span>");
								$row.append(template);
							}
							$target.append($row);
						}
					} else {
						for (let line = 0; line < result.length; line++) {
							let $row = $("<div class='tbl'></div>");
							if (Array.isArray(result[line]) == false) continue;

							var $romaji = $("<span class='romaji'></span>");
							var $kanji = $("<span class='kanji'></span>");
							for (let i = 0; i < result[line].length; i++) {
								if (result[line][i]["romaji"].length < 1) result[line][i]["romaji"] = " ";
								$romaji.append("<i>" + result[line][i]["romaji"] + "</i>");
								$kanji.append("<b>" + result[line][i]["original"] + "</b>");
							}
							$row.append($romaji);
							$row.append($kanji);

							$target.append($row);
						}
					}
				}
			}
		});
	}, 200);

	return true;
};
