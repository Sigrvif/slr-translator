<?php
// selectfile.php — legacy Windows-only native file picker (selectfile.exe +
// WScript.Shell). The UI now uses NW.js's built-in file dialogs, so this entry
// point is kept only as a safe no-op for backward compatibility.
header('Content-Type: text/html; charset=UTF-8');
echo "<html><head><meta charset=\"UTF-8\"></head><body>"
	. "<script>console.warn('selectfile.php is deprecated on this platform');</script>"
	. "</body></html>";
die();
