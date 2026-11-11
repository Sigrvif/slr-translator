// Ruby string/comment parser utilities.
/*
String:
/("|')(?:#\{[^}]+\}|#(?!\{)|\\(?:\r\n|[\s\S])|(?!\1)[^\\#\r\n])*\1/

Heredoc:
/<<[-~]?([a-z_]\w*)[\r\n](?:.*[\r\n])*?[\t ]*\1/i

%/ msg / format:
/%\/(.*)\//sg

Inside string #{something}:
#\{[^}]+\}

Single line comment:
#.*

Multiple row comment:
/^=begin\s[\s\S]*?^=end/m
*/

var parseRuby = function (text) {
	if (!text) return text;

	// clear out comments
	var clearedText = text.replace(/#.*/g, (match) => {
		return " ".repeat(match.length);
	});

	clearedText = clearedText.replace(/^=begin\s[\s\S]*?^=end/mg, (match) => {
		return " ".repeat(match.length);
	});
};
