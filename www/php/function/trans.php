<?php

function fetchDir($path) {
	if (!is_dir($path)) return Array();

	// Normalize trailing separator (cross-platform).
	$path = str_replace("\\", "/", $path);
	if (substr($path, -1, 1) !== "/") {
		$path = $path . "/";
	}

	// Native directory listing (replaces the Windows "dir /b" command).
	$entries = @scandir($path);
	$result = array();
	if (is_array($entries)) {
		foreach ($entries as $val) {
			if ($val === "." || $val === "..") continue;
			if ($val === "") continue;
			$result[] = $path . $val;
		}
	}
	return $result;
}

function isExistOnList($id, $data) {
	$idList = array();
	if (!empty($data)) {
		foreach ($data as $fileID) {
			$thisPath = substr($fileID, 0, -strlen(substr(strrchr($fileID, "."), 0)));
			$idList[$thisPath] = true;
		}
	}

	$stripped = substr($id, 0, -strlen(substr(strrchr($id, "."), 0)));

	return $idList[$stripped];
}

function hasSelectedTES($data) {
	if (is_array($data)) {
		foreach ($data as $fileID) {
			$fileID = str_replace("\\", "/", $fileID);
			$firstDir = strstr($fileID, '/', true);
			if (strtolower($firstDir) == 'extract_main') {
				return true;
				exit;
			}
		}
	}

	return false;
}

function getPrefferedTrans($input, $col = false, $includeOrig = false) {
	if (!is_array($input)) {
		return $input;
		exit;
	}
	if (is_int($col)) {
		return $input[$col];
		exit;
	}

	if ($includeOrig) {
		for ($i = count($input) - 1; $i >= 0; $i--) {
			if (!empty($input[$i])) {
				return $input[$i];
				exit;
			}
		}
	} else {
		for ($i = count($input) - 1; $i > 0; $i--) {
			if (!empty($input[$i])) {
				return $input[$i];
				exit;
			}
		}
	}
	return "";
}

function listFilesInDirectory($dir, $fileOnly = false) {
	$files = [];

	if (is_dir($dir)) {
		$items = scandir($dir);

		foreach ($items as $item) {
			$itemPath = $dir . '/' . $item;

			if (is_file($itemPath) && ($fileOnly || !$fileOnly)) {
				$files[] = $itemPath;
			}
		}
	} else {
		return $files;
	}

	return $files;
}

function copyFiles($source, $to, $recursive = false) {
	echo "Copying file from $source to $to, recursive? $recursive \n";
	if (!is_dir($to)) {
		if (mkdir($to, 777, true) == false) {
			echo "Failed to create directory : $to\n";
			return false;
			exit;
		}
	}
	$to = str_replace("\\", "/", $to);
	if (substr($to, -1, 1) !== "/") {
		$to = $to . "/";
	}
	$source = str_replace("\\", "/", $source);
	if (substr($source, -1, 1) !== "/") {
		$source = $source . "/";
	}

	$fileList = Array($source);
	if (is_dir($source)) {
		if ($recursive) {
			$list = get_folder_content($source);
			$fileList = $list['files'];
		} else {
			$fileList = listFilesInDirectory($source);
		}
	}

	echo "File to copy:\n";
	print_r($fileList);
	$origPathLength = strlen($source);
	foreach ($fileList as $from) {
		$fileInfo = pathinfo($from);
		$relPath = substr($fileInfo['dirname'] . "/", $origPathLength);
		if (!is_dir($to . $relPath)) {
			mkdir($to . $relPath, 777, true);
		}
		echo "Copying to '$from' :" . $to . $relPath . $fileInfo['basename'] . "\n";
		copy($from, $to . $relPath . $fileInfo['basename']);
	}
}

function moveFiles($source, $to, $recursive = false) {
	if (!is_dir($to)) {
		if (mkdir($to, 777, true) == false) {
			echo "Failed to create directory : $to\n";
			return false;
			exit;
		}
	}
	$to = str_replace("\\", "/", $to);
	if (substr($to, -1, 1) !== "/") {
		$to = $to . "/";
	}
	$source = str_replace("\\", "/", $source);
	if (substr($source, -1, 1) !== "/") {
		$source = $source . "/";
	}

	$fileList = Array($source);
	if (is_dir($source)) {
		if ($recursive) {
			$list = get_folder_content($source);
			$fileList = $list['files'];
		} else {
			$fileList = listFilesInDirectory($source);
		}
	}

	$origPathLength = strlen($source);
	foreach ($fileList as $from) {
		$fileInfo = pathinfo($from);
		$relPath = substr($fileInfo['dirname'] . "/", $origPathLength);
		if (!is_dir($to . $relPath)) {
			mkdir($to . $relPath, 777, true);
		}
		echo "Moving to '$from' :" . $to . $relPath . $fileInfo['basename'] . "\n";
		rename($from, $to . $relPath . $fileInfo['basename']);
	}
}

function error($msg, $code = "") {
	echo "Error : $msg\n";
	return "Error : $msg\n";
}

function isJson($string) {
	json_decode($string);
	return (json_last_error() == JSON_ERROR_NONE);
}

function detectGameEngine($folder = "", $selectedFile = "", $skipLoadFromData = false) {
	global $_PARAM, $_PLUGINS;
	clearstatcache(true);

	if ($skipLoadFromData == false) {
		if (!empty($_POST['gameEngine'])) {
			return $_POST['gameEngine'];
		} elseif (!empty($_PARAM['gameEngine'])) {
			return $_PARAM['gameEngine'];
		}
	}

	// Use forward slashes: they work on Windows and on Linux/Unix hosts,
	// where a backslash is a regular file name character. This allows
	// parsing Linux ports of RPG Maker games (and any game folder) with
	// the PHP backend on every platform.
	if (is_file($folder . "/Game.rgss3a")) {
		return "rmvxace";
	} elseif (is_file($folder . "/Data/System.rvdata2")) {
		return "rmvxace";
	} elseif (is_file($folder . "/Game.rgss2a")) {
		return "rmvx";
	} elseif (is_file($folder . "/Data/System.rvdata")) {
		return "rmvx";
	} elseif (is_file($folder . "/Game.rgssad")) {
		return "rmxp";
	} elseif (is_file($folder . "/Data/System.rxdata")) {
		return "rmxp";
	} elseif (is_file($folder . "/js/rmmz_core.js")) {
		return "rmmz";
	} elseif (is_file($folder . "/www/js/rmmz_core.js")) {
		return "rmmz";
	} elseif (is_file($folder . "/www/data/System.json")) {
		return "rmmv";
	} elseif (is_file($folder . "/data/System.json")) {
		return "rmmv";
	} elseif (is_file($folder . "/RPG_RT.ldb")) {
		if (is_rm2000Dir($folder)) {
			return "rm2000";
		}
	}

	$_PLUGINS_PATH = array_filter(glob(_ROOT_PATH . 'plugins/*'), 'is_dir');
	foreach ($_PLUGINS_PATH as $thisDir) {
		$thisDir = realpath($thisDir);
		$dirName = basename($thisDir);
		if (is_file($thisDir . "/register.php")) {
			include_once($thisDir . "/register.php");
			if (!function_exists("plugins\\" . $dirName . "\\register")) continue;
			$result = call_user_func_array("plugins\\" . $dirName . "\\register", Array($selectedFile));
			if (!empty($result)) {
				$_PARAM['plugin'][$dirName]['result'] = $result;
				if (!empty($_PLUGINS[$dirName]['name'])) return $_PLUGINS[$dirName]['name'];
				return $dirName;
			}
		}
	}

	return "default";
}

function checkProjectByTitle($gameTitle) {
	global $_PARAM;

	$cachePath = $_SERVER['STAGING_PATH'] . "*";
	$result = array();
	foreach (glob($cachePath) as $path) {
		if (!is_dir($path)) continue;
		if (!is_file($path . "/gameInfo.json")) continue;
		$thisPathinfo = pathinfo($path);
		$config = json_decode(file_get_contents($path . "/gameInfo.json"), true);
		if ($config['title'] == $gameTitle) {
			$data = $config;
			$data['id'] = $thisPathinfo['basename'];
			$result[] = $data;
		} elseif ($config['Title'] == $gameTitle) {
			$data = $config;
			$data['id'] = $thisPathinfo['basename'];
			$result[] = $data;
		}
	}

	return $result;
}

function unescapeRPGTransText($text) {
	$escapeHash = "[escapeH-" . md5(time()) . "]";
	$text = str_replace("\\#", $escapeHash, $text);
	$textA = explode("\n", $text);
	$newTexts = Array();
	foreach ($textA as $textPart) {
		$textB = explode("#", $textPart);
		$newTexts[] = $textB[0];
	}
	$text = implode("\n", $newTexts);
	$text = str_replace($escapeHash, "#", $text);

	$find = array("\\\\", "\\" . ">");
	$replace = array("\\", ">");
	$text = str_replace($find, $replace, $text);
	return $text;
}

function escapeRPGTransText($text) {
	$src = array("\\", "#", ">");
	$rep = array("\\\\", "\\#", "\\>");
	$text = str_replace($src, $rep, $text);
	return $text;
}

function detectLineBreak($text) {
	if (empty($text)) {
		return "\n";
		exit;
	}

	$chunk = substr($text, 0, 500);
	$chunks = explode("\r\n", $chunk);
	if (count($chunks) > 1) {
		return "\r\n";
		exit;
	}
	$chunks = explode("\r\n", $chunk);
	if (count($chunks) > 1) {
		return "\n\r";
		exit;
	}

	return "\n";
}

function normalizeRPGTrans($text, $newLine = "\r\n") {
	$escape = "[escapeM-" . md5(time()) . "]";
	$text = str_replace("\\>", $escape, $text);
	$text = str_replace(">", $newLine . ">", $text);
	$text = str_replace($escape, "\\>", $text);
	return $text;
}

function isLegalRPGTransFile($filename) {
	$rest = mb_ereg_replace("([^\w\d\-_~,;\[\]\(\).])", '', $filename);
	if ($rest == $filename) {
		return true;
	}
	return false;
}

function standarizeNewLine($text, $newLine) {
	global $_PARAM;
	if (empty($newLine)) {
		$newLine = "\r\n";
	}
	if (strpos($newLine, "\r") !== false) {
		$text = str_replace("\r", "", $text);
		$text = str_replace("\n", $newLine, $text);
		return $text;
	} else {
		$text = str_replace("\r", "", $text);
		return $text;
	}
}

function parseRPGTransFile($file, $skipUnescape = false) {
	error_reporting(E_ERROR | E_PARSE);
	if (strpos($file, "\n") === false) {
		$file = str_replace("\\", "/", $file);
		if (!is_file($file)) return false;
		$content = file_get_contents($file);
	} else {
		$content = $file;
	}

	global $_PARAM;
	$RESULT = array();
	$RESULT['rawData'] = array();
	$contentSegm = explode("> BEGIN STRING" . $lineSeparator, $content);

	if (count($contentSegm) < 1) {
		return false;
		exit();
	}

	$lineBreak = detectLineBreak($content);
	$content = normalizeRPGTrans($content, $lineBreak);

	$RESULT['header'] = trim(array_shift($contentSegm));
	$RESULT['lineBreak'] = $lineBreak;

	foreach ($contentSegm as $key => $segment) {
		$elm = explode($lineBreak, $segment);
		$RESULT['data'][$key] = array("");
		$RESULT['context'][$key] = array();
		$RESULT['parameters'][$key] = array();
		$RESULT['rawData'][$key]['text'] .= "";

		$index = 0;
		$textArray = array();
		foreach ($elm as $i => $line) {
			if (!isset($line[0])) continue;
			if ($line[0] == "#") continue;
			if ($line[0] == ">") break;
			if ($i == 0) {
				if (substr($line, 0, 2) == "\r\n") {
					$line = substr($line, 2);
				} elseif (substr($line, 0, 2) == "\n\r") {
					$line = substr($line, 2);
				} elseif (substr($line, 0, 1) == "\n") {
					$line = substr($line, 1);
				} elseif (substr($line, 0, 1) == "\r") {
					$line = substr($line, 1);
				}
				$trimLine = trim($line);
				if (empty($trimLine)) continue;
			}
			$textArray[] = $line;
			$index++;
		}
		$RESULT['rawData'][$key]['text'] = implode($lineBreak, $textArray);
		$RESULT['data'][$key][0] = implode($lineBreak, $textArray);

		for ($n = $index + 1; $n < count($elm); $n++) {
			$line = $elm[$n];
			if ($line[0] == "#") continue;
			if ($line[0] !== ">") {
				$trimLine = trim($line);
				if (empty($trimLine)) continue;
				if ($lastElm == "translation") {
					$currentIndex = count($RESULT['rawData'][$key]['translation']) - 1;
					$RESULT['rawData'][$key]['translation'][$currentIndex] .= $lineBreak . $line;
					$RESULT['data'][$key][$currentIndex + 1] .= $lineBreak . $line;
				} else {
					if (empty($RESULT['rawData'][$key]['translation'])) {
						$RESULT['rawData'][$key]['translation'] = array($line);
						$RESULT['data'][$key][1] = $line;
					} else {
						$currentIndex = count($RESULT['rawData'][$key]['translation']);
						$RESULT['rawData'][$key]['translation'][$currentIndex] = $line;
						$RESULT['data'][$key][$currentIndex + 1] = $line;
					}
				}
				$lastElm = "translation";
				continue;
			}

			if (strpos($line, ":") !== false) {
				$thisKey = trim(substr(strstr($line, ':', true), 1));
				$thisValue = trim(substr(strstr($line, ':'), 1));
				if (empty($RESULT['rawData'][$key][$thisKey])) {
					$RESULT['rawData'][$key][$thisKey] = array();
					$RESULT['parameters'][$key][$thisKey] = array();
				}
				array_push($RESULT['rawData'][$key][$thisKey], $thisValue);
				array_push($RESULT['parameters'][$key][$thisKey], $thisValue);

				if ($thisKey == 'CONTEXT') {
					$contextPart = explode(" < ", $thisValue);
					array_push($RESULT['context'][$key], $contextPart[0]);
				} else {
					$keyParts = explode(" ", $thisKey);
					if ($keyParts[0] == 'CONTEXT') {
						$contextPart = explode(" < ", $line);
						array_push($RESULT['context'][$key], substr($contextPart[0], 10));
					}
				}
			} else {
				$thisKey = trim(substr($line, 1));
				if ($thisKey == 'END STRING') break;

				$RESULT['rawData'][$key][$thisKey] = true;
				$RESULT['parameters'][$key][$thisKey] = true;
			}
			$RESULT['structure'][$key][] = Array("type" => "param", "value" => trim(substr($line, 1)));

			$lastElm = $thisKey;
		}
	}

	if ($skipUnescape == false) {
		foreach ($RESULT['data'] as $indexRow => $row) {
			if (!is_array($row)) continue;
			foreach ($row as $indexCol => $cell) {
				$RESULT['data'][$indexRow][$indexCol] = unescapeRPGTransText($cell);
			}
		}
	}

	return $RESULT;
}

function getContextTranslation($fileData, $rowId, $row, $thisLineBreak) {
	if (empty($fileData['contextTranslation'])) return "";
	if (empty($fileData['contextTranslation'][$rowId])) return "";
	if (!is_array($fileData['contextTranslation'][$rowId])) return "";

	$translated 	= [];
	$untranslated 	= [];
	foreach ($fileData['contextTranslation'][$rowId] as $contextId => $contextTranslation) {
		if (empty($contextTranslation['translation'])) {
			$untranslated[] = "> CONTEXT: " . $contextTranslation['contextStr'];
		} else {
			$translated[] = "> CONTEXT: " . $contextTranslation['contextStr'];
			if ($skipEscape) {
				$translated[] = standarizeNewLine($contextTranslation['translation'], $thisLineBreak);
			} else {
				$translated[] = escapeRPGTransText(standarizeNewLine($contextTranslation['translation'], $thisLineBreak));
			}
		}
	}

	if (count($translated) == 0) return "";

	$line = [];
	$line[] = implode($thisLineBreak, $translated);

	if (count($untranslated) > 0) {
		$line[] = implode($thisLineBreak, $untranslated);
		$thisTranslation = getPrefferedTrans($row);
		if ($skipEscape) {
			$line[] = standarizeNewLine($thisTranslation, $thisLineBreak);
		} else {
			$line[] = escapeRPGTransText(standarizeNewLine($thisTranslation, $thisLineBreak));
		}
	}

	return implode($thisLineBreak, $line);
}

function transToRPGTransFile($data, $target = "", $skipEscape = false, $selectedFiles = Array(), $options = null, $skipFormatCheck = false) {
	global $_PARAM;

	if (!is_file($data)) exit;

	if (!is_dir($target . "\\patch")) {
		mkdir($target . "\\patch", 777, true);
	}

	if (is_null($options)) {
		$options = $_POST['options'];
	}

	$content = file_get_contents($data);
	$PROJECT = json_decode($content, true);
	foreach ($PROJECT['project']['files'] as $filePath => $fileData) {
		echo "Generating RPGMTrans file: $filePath \r\n";
		if (!empty($selectedFiles)) {
			if (!in_array($filePath, $selectedFiles)) continue;
		}

		if ($skipFormatCheck == false) {
			if (strpos($fileData['originalFormat'], 'RPGMAKER TRANS PATCH FILE') === false) {
				echo "Not an RPGMTrans file, skipping!\r\n";
				continue;
			}
		}

		$thisLineBreak = "\r\n";
		if (!empty($fileData['lineBreak'])) $thisLineBreak = $fileData['lineBreak'];

		$thisSegm = array();
		$thisSegm[] = $fileData['originalFormat'];
		foreach ($fileData['data'] as $rowId => $row) {
			if (empty($row[0])) continue;

			if (!empty($options['filterTagMode'])) {
				if (!empty($fileData["tags"][$rowId])) {
					if (is_array($fileData["tags"][$rowId])) {
						$intersects = array_intersect($options['filterTag'], $fileData["tags"][$rowId]);
						if ($options['filterTagMode'] == "blacklist") {
							if (count($intersects) > 0) continue;
						} else if ($options['filterTagMode'] == "whitelist") {
							if (count($intersects) == 0) continue;
						}
					}
				} else {
					if ($options['filterTagMode'] == "whitelist") continue;
				}
			}

			$line = array("> BEGIN STRING");
			if ($skipEscape) {
				$line[] = standarizeNewLine($row[0], $thisLineBreak);
			} else {
				$line[] = escapeRPGTransText(standarizeNewLine($row[0], $thisLineBreak));
			}

			$skipDefaultTranslation = false;
			if (is_array($fileData['parameters'][$rowId])) {
				foreach ($fileData['parameters'][$rowId] as $thisParamKey => $thisParams) {
					if (is_numeric($thisParamKey)) continue;
					if ($thisParamKey == "CONTEXT") {
						$contextTranslation = getContextTranslation($fileData, $rowId, $row, $thisLineBreak);
						if (empty($contextTranslation)) {
							foreach ($thisParams as $thisParamVal) {
								$line[] = "> " . $thisParamKey . ": " . $thisParamVal;
							}
						} else {
							$line[] = $contextTranslation;
							$skipDefaultTranslation = true;
						}
					} else {
						foreach ($thisParams as $thisParamVal) {
							$line[] = "> " . $thisParamKey . ": " . $thisParamVal;
						}
					}
				}
			}

			if ($skipDefaultTranslation == false) {
				$thisTranslation = getPrefferedTrans($row);
				if ($skipEscape) {
					$line[] = standarizeNewLine($thisTranslation, $thisLineBreak);
				} else {
					$line[] = escapeRPGTransText(standarizeNewLine($thisTranslation, $thisLineBreak));
				}
			}

			$line[] = "> END STRING";
			$line[] = "";
			$thisSegm[] = implode($thisLineBreak, $line);
		}

		$newFile = implode($thisLineBreak, $thisSegm);
		file_put_contents($target . "/patch/" . $fileData['basename'], $newFile);

		file_put_contents($target . "/RPGMKTRANSPATCH", "> RPGMAKER TRANS PATCH V3");
	}
}

function runTesPatcher($gamePath, $copyTo = "", $keepWindow = 0) {
	global $_PARAM;
	$TMP_PATH = str_replace("\\", "/", $gamePath);

	$TESFile = glob($TMP_PATH . "/Data/main.*");
	if (count($TESFile) < 1) {
		return false;
	}

	echo "TES encryption found....\n";
	echo "Let's decrypt it....\n";

	$ruby = $_PARAM['RUBY_BIN'] ?? "";
	$script = $_SERVER['APPLICATION_ROOT'] . "/3rdParty/TES-Patcher/TES_Patcher.rb";
	if (!is_executable($ruby) && !(slr_is_windows() && is_file($ruby))) {
		throw new \Error("Ruby is required to decrypt TES-encrypted games but was not found: " . $ruby);
	}

	$ORIG_CWD = getcwd();
	chdir($TMP_PATH);
	echo "\n\nCurrent CWD " . getcwd() . "\r\n";
	$cmd = escape_win32_argv($ruby) . " " . escape_win32_argv($script) . " -e";
	echo $cmd;
	noshell_exec($cmd);
	chdir($ORIG_CWD);
	echo "\n\nCurrent CWD " . getcwd() . "\r\n";
	echo "successfully decrypt files to : " . $TMP_PATH . "/extract_main\n";

	if (empty($copyTo)) {
		return $TMP_PATH . "/extract_main";
	}

	if (!is_dir($copyTo)) {
		if (!mkdir($copyTo, 777, true)) {
			echo "Failed to create directory : " . $copyTo . "\n";
			return $TMP_PATH . "/extract_main";
		}
	}
	copy_tree($TMP_PATH . "/extract_main", $copyTo);
	echo "Removing " . $TMP_PATH . "/extract_main\n";
	del_tree($TMP_PATH . "/extract_main", true);
	return $copyTo;
}

function applyTesPatcher($TMP_PATH, $copyTo = "", $keepWindow = 0) {
	global $_PARAM;
	$TMP_PATH = str_replace("\\", "/", $TMP_PATH);

	$transPath = $TMP_PATH . "/autosave.json";
	if (!empty($_POST['transPath'])) $transPath = $_POST['transPath'];

	if (is_dir($TMP_PATH . "/data-tes/extract_main") == false) {
		return false;
	}

	rename($TMP_PATH . "/data-tes/extract_main", $TMP_PATH . "/data-tes/extract_main_orig");
	echo "TES data found....\n";
	echo "Let's build....\n";

	echo "GENERATING NEW PATCH FROM .TRANS FILE";
	echo "==========================================";
	transToTESfile($transPath, $TMP_PATH . "/data-tes");

	$ruby = $_PARAM['RUBY_BIN'] ?? "";
	$script = $_SERVER['APPLICATION_ROOT'] . "/3rdParty/TES-Patcher/TES_Patcher.rb";
	if (!is_executable($ruby) && !(slr_is_windows() && is_file($ruby))) {
		throw new \Error("Ruby is required to apply TES patches but was not found: " . $ruby);
	}

	$ORIG_CWD = getcwd();
	chdir($TMP_PATH . "/data-tes");
	$cmd = escape_win32_argv($ruby) . " " . escape_win32_argv($script) . " -p";
	echo $cmd;
	noshell_exec($cmd);
	chdir($ORIG_CWD);

	echo "\n\nCurrent CWD " . getcwd();
	echo "successfully build files to : " . $TMP_PATH . "/data-tes\n";

	echo "removing cache ... ";
	del_tree($TMP_PATH . "/data-tes/extract_main", true);
	rename($TMP_PATH . "/data-tes/extract_main_orig", $TMP_PATH . "/data-tes/extract_main");
	echo "done!\n";

	if (empty($copyTo)) {
		$result = glob($TMP_PATH . "/data-tes/main.*");
		return $result[0] ?? false;
	}

	if (!is_dir($copyTo)) {
		if (!mkdir($copyTo, 777, true)) {
			echo "Failed to create path : " . $copyTo . "\n";
			$result = glob($TMP_PATH . "/data-tes/main.*");
			return $result[0] ?? false;
		}
	}
	foreach (glob($TMP_PATH . "/data-tes/main.*") as $src) {
		copy($src, rtrim($copyTo, "/\\") . "/" . basename($src));
	}
	$result = glob($copyTo . "/main.*");
	return $result[0] ?? false;
}

function transToTESfile($data, $target = "") {
	global $_PARAM;

	echo "\r\nBuilding TES feed data from : $data \r\n";
	echo "Target :  $target \r\n";
	if (!is_file($data)) exit;

	if (!is_dir($target . "/extract_main")) {
		mkdir($target . "/extract_main", 777, true);
	}

	$content = file_get_contents($data);
	$PROJECT = json_decode($content, true);
	foreach ($PROJECT['project']['files'] as $filePath => $fileData) {
		if (strpos($fileData['originalFormat'], 'ANTI TES PATCH FILE') === false) continue;
		echo "Building TES data : " . $fileData['basename'] . "\r\n";
		$thisLineBreak = "\r\n";
		if (!empty($fileData['lineBreak'])) $thisLineBreak = $fileData['lineBreak'];

		$thisSegm = array();
		$thisSegm[] = $fileData['originalFormat'];
		foreach ($fileData['data'] as $rowId => $row) {
			if (empty($row[0])) continue;

			$line = array("> BEGIN STRING");
			$line[] = $row[0];
			foreach ($fileData['parameters'][$rowId] as $thisParamKey => $thisParams) {
				if (is_numeric($thisParamKey)) continue;
				foreach ($thisParams as $thisParamVal) {
					$line[] = "> " . $thisParamKey . ": " . $thisParamVal;
				}
			}
			$thisTranslation = getPrefferedTrans($row);
			$line[] = $thisTranslation;
			$line[] = "> END STRING";
			$line[] = "";
			$thisSegm[] = implode($thisLineBreak, $line);
		}

		$newFile = implode($thisLineBreak, $thisSegm);
		echo "saving to : " . $target . "/extract_main/" . $fileData['basename'] . "\r\n";
		file_put_contents($target . "/extract_main/" . $fileData['basename'], $newFile);
	}
}

function strToHex($string) {
	$hex = '';
	for ($i = 0; $i < strlen($string); $i++) {
		$ord = ord($string[$i]);
		$hexCode = dechex($ord);
		$hex .= substr('0' . $hexCode, -2);
	}
	return strToUpper($hex);
}

function is_rm2000($path) {
	if (is_file($path) == false) {
		return false;
		exit;
	}

	$handle = fopen($path, "rb");
	fseek($handle, 288);
	$contents = fread($handle, 32);

	$thisHex = strToHex($contents);
	return $thisHex === '00A201000000000030CC09000010000000D00900000040000010000000020000';
}

function is_rm2000Dir($dirPath) {
	$dirPath = realpath($dirPath);
	if (is_file($dirPath)) {
		$thisPathInfo = pathinfo($dirPath);
		$dirPath = $thisPathInfo['dirname'];
	}
	if (!is_dir($dirPath)) return false;

	if (is_file($dirPath . "/RPG_RT.exe")) {
		return is_rm2000($dirPath . "/RPG_RT.exe");
	}

	$dirContent = glob($dirPath . "/*.exe");
	foreach ($dirContent as $val) {
		if (is_rm2000($val)) return true;
	}
	return false;
}

function getProjectCahePath($projectId = "") {
	if (empty($projectId)) $projectId = $_POST['projectId'];
	$_PARAM['APP_PATH'] = substr(__FILE__, 0, strrpos(__FILE__, "www" . DIRECTORY_SEPARATOR));
	$_PARAM['CACHE_PATH'] = rtrim($_SERVER['STAGING_PATH'], "/\\") . "/";

	$thisCache = $_PARAM['CACHE_PATH'] . $projectId;
	$thisCache = str_replace("\\", "/", $thisCache);
	return $thisCache;
}

function hasTags($fileData, $rowId, $tags) {
	if (empty($tags)) return false;
	if (!is_array($tags)) $tags = [$tags];
	if (empty($fileData['tags'])) return false;
	if (empty($fileData['tags'][$rowId])) return false;

	foreach ($fileData['tags'][$rowId] as $key => $val) {
		if (in_array($val, $tags)) return true;
	}
	return false;
}

function generateTranslationPairs($file = "", $options = array()) {
	if (empty($options)) $options = $_POST['options'];

	global $_PARAM;
	if (!empty($_PARAM['TRANSLATION_PAIRS'])) return $_PARAM['TRANSLATION_PAIRS'];
	if (empty($file)) $file = $_POST['transFile'];

	echo "Generating translation pair from : $file \n";

	$TRANS = array();
	if (!empty($TRANS = json_decode($file, true))) {
		$TRANS = json_decode($file, true);
	} else if (is_file($file)) {
		$TRANS = json_decode(file_get_contents($file), true);
	}

	$_PARAM['TRANSLATION_PAIRS'] = array();
	if (empty($TRANS)) {
		return $_PARAM['TRANSLATION_PAIRS'];
	}

	if (empty($TRANS['project'])) return $_PARAM['TRANSLATION_PAIRS'];
	if (empty($TRANS['project']['files'])) return $_PARAM['TRANSLATION_PAIRS'];
	foreach ($TRANS['project']['files'] as $filePath => $fileData) {
		if (empty($fileData)) continue;
		if (empty($fileData['data'])) continue;
		if (empty($fileData['keyColumn'])) $fileData['keyColumn'] = 0;
		foreach ($fileData['data'] as $rowNum => $ROW) {
			if (empty($ROW[$fileData['keyColumn']])) continue;

			if (!empty($options['filterTagMode']) && !empty($options['filterTag'])) {
				$hasTags = hasTags($fileData, $rowNum, $options['filterTag']);

				if ($options['filterTagMode'] == 'whitelist') {
					if (!$hasTags) continue;
				} else {
					if ($hasTags) continue;
				}
			}

			for ($i = count($ROW) - 1; $i >= 0; $i--) {
				if ($i == $fileData['keyColumn']) continue;
				if (!empty($ROW[$i])) {
					$_PARAM['TRANSLATION_PAIRS'][$ROW[$fileData['keyColumn']]]['*'] = $ROW[$i];
					break;
				}
			}
		}
	}

	return $_PARAM['TRANSLATION_PAIRS'];
}

function getTranslation($word, $context = "", $transFile = "", $options = array()) {
	global $_PARAM;
	$TRANSPAIR = generateTranslationPairs($transFile, $options);
	if (!empty($TRANSPAIR)) $result = $TRANSPAIR[$word] ?? null;
	if (!empty($result['*'])) return $TRANSPAIR[$word]['*'];
}

function detectFileEncoding($path) {
	$result = "";
	if (slr_is_windows()) {
		$cmd = $_SERVER["APPLICATION_ROOT"] . "/3rdParty/GnuWin32/bin/file.exe --mime-encoding " . escape_win32_argv($path);
		$result = exec($cmd);
		$result = explode(";", $result);
	} else {
		// System `file` (present on every Linux distro).
		$result = exec("file --mime-encoding " . escapeshellarg($path));
		$result = explode(":", $result);
	}
	$encoding = trim($result[1] ?? "");
	if ($encoding !== "" && strpos($encoding, "unknown") === false) return $encoding;

	$chunk = 1024 * 1024;
	if (filesize($path) < $chunk) $chunk = filesize($path);
	$handle = fopen($path, "r");
	$contents = fread($handle, $chunk);
	fclose($handle);
	$encoding = mb_detect_encoding($contents, ["shift-jis", "JIS", 'ISO-8859-1', "UTF-8"], true);
	return strtolower($encoding);
}
