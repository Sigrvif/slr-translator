<?php
set_time_limit(0);
$_PARAM['APP_PATH'] = substr(__FILE__, 0, strrpos(__FILE__, "www" . DIRECTORY_SEPARATOR));

function isResourceExtracted($gamePath) {
	global $_PARAM;
	clearstatcache(true);
	if (!is_file($gamePath . "\\data\\System." . $_PARAM['dataExtension'])) {
		return false;
	} else {
		return true;
	}
}

function extractData($gamePath, $cacheLocation) {
	// RESULT : all data will be available on cache/[game title]/data folder
	echo "RUNNING extractData function\n";
	global $_PARAM;

	if (isResourceExtracted($gamePath)) {
		// copy data directly to cache folder
		echo "copying folder data to cache\r\n";
		copy_tree($gamePath."/data", $cacheLocation."/data");
	} else {
		// extract from rgss3a
		$folderInfo = pathinfo($cacheLocation);

		$TMP_PATH = rtrim($_SERVER['TMP'], "/\\") . "/" . $folderInfo['basename'];

		if (!is_dir($TMP_PATH)) {
			mkdir($TMP_PATH, 777, true);
		}
		print_r($folderInfo);
		echo "\r\nTmp path : " . $TMP_PATH . "\n";

		// Copy the archive file(s) into the temp folder (replaces "copy /Y").
		foreach (glob($gamePath."/*.".$_PARAM['dataArcExtension']) as $arc) {
			copy($arc, $TMP_PATH."/".basename($arc));
		}

		$decExt = slr_is_windows() ? ".exe" : "";
		$decrypterPath = $_PARAM['APP_PATH']."3rdParty/RgssDecrypter/RPGMakerDecrypter-cli".$decExt;
		$archive = $TMP_PATH."/Game.".$_PARAM['dataArcExtension'];
		$cmd = escapeshellarg($decrypterPath)." ".escapeshellarg($archive)." -o ".escapeshellarg($TMP_PATH)." -w";
		echo "\nExtracting data\n";
		echo $cmd . "\r\n";
		if (!is_executable($decrypterPath) && !(slr_is_windows() && is_file($decrypterPath))) {
			throw new \Error("RGSS decrypter not found (needed to extract .".$_PARAM['dataArcExtension']." archives): ".$decrypterPath);
		}
		noshell_exec($cmd);
		if (!is_dir($TMP_PATH."/data")) {
			echo $TMP_PATH."/data not found\n";
		}

		echo "Copying Data folder to trans cache folder \n";
		copy_tree($TMP_PATH."/data", $cacheLocation."/data");
	}
}

function dump($cache) {
	// dump data to JSON
	// input $cache = full path to root folder of game cache (directory with game name)
	global $_PARAM;
	$cachePath = $cache."/dump";
	if (is_dir($cachePath)) {
		// cleaning up existing file in cache path
		del_tree($cachePath, true);
	}

	mkdir($cachePath, 777, true);

	$dataPath = $cache."/Data/";
	$rubyPath = $_PARAM['RUBY_BIN'];

	$fileList = glob($dataPath."*.".$_PARAM['dataExtension']);

	if (!is_executable($rubyPath) && !(slr_is_windows() && is_file($rubyPath))) {
		throw new \Error("Ruby is required to dump VX Ace data but was not found: ".$rubyPath);
	}

	foreach ($fileList as $path) {
		$command = escapeshellarg($rubyPath)." ".
			escapeshellarg($_PARAM['APP_PATH']."www/php/plugins/rmvxace/bin/rmjson.rb")." ".
			"--dump=".escapeshellarg($path)." ".
			"--dest=".escapeshellarg($cachePath);
		echo $command."\n";
		passthru($command);
	}
}

if (!function_exists('getGameInfo')) {
	function getGameInfo($gamePath, $projectId = "") {
		global $_PARAM;
		// added by donovan
		$infoCache = $_PARAM['CACHE_PATH'] . $_POST['projectId'] . "\\gameInfo.json";
		if (!empty($projectId)) {
			$infoCache = $_PARAM['CACHE_PATH'] . $_POST['projectId'] . "\\gameInfo.json";
		}
		if (is_file($infoCache)) {
			return json_decode(file_get_contents($infoCache), true);
		}
		// =======================
		$str = file_get_contents($gamePath . "\\Game.ini");
		$currentEncoding = mb_detect_encoding($str, "JIS, eucjp-win, sjis-win, UTF-8");
		$str = mb_convert_encoding($str, "UTF-8", $currentEncoding);
		$gameInfo = parse_ini_string($str, false, INI_SCANNER_RAW);
		$gameInfo['title'] = $gameInfo['Title'];
		return $gameInfo;
	}
}

function replaceIllegalCharacter($string) {
	$bad = array_merge(array_map('chr', range(0, 31)), array("<", ">", ":", '"', "/", "\\", "|", "?", "*"));
	$result = str_replace($bad, "-", $string);
	return $result;
}

if (function_exists('getProjectId') == false) {
	function getProjectId($gamePath = "", $projectId = "") {
		global $_PARAM;
		$gameInfo = getGameInfo($gamePath);
		if (!empty($projectId)) {
			$id = $projectId;
		} elseif (!empty($_SERVER['POST']['projectId'])) {
			$id = $_SERVER['POST']['projectId'];
		} elseif (!empty($_POST['projectId'])) {
			$id = $_POST['projectId'];
		} elseif (!empty($_PARAM['projectId'])) {
			$id = $_PARAM['projectId'];
		} else {
			$id = md5(time());
		}
		$_PARAM['projectId'] = $id;
		$_SERVER['POST']['projectId'] = $id;
		$_SERVER['GET']['projectId'] = $id;
		$_POST['projectId'] = $id;
		$_GET['projectId'] = $id;
		return $id;
	}
}

function getProjectCacheInfo($gamePath = "") {
	global $_PARAM;
	$dirname = getProjectId($gamePath);
	$RESULT['cacheID'] = $dirname;
	$RESULT['cachePath'] = $_PARAM['CACHE_PATH'] . $dirname;

	return $RESULT;
}

function prepareProjectCache($gamePath) {
	global $_PARAM;
	$gameInfo = getGameInfo($gamePath);

	clearstatcache(true);

	$cacheInfo = getProjectCacheInfo($gamePath);

	if (!is_dir($cacheInfo['cachePath'])) {
		mkdir($cacheInfo['cachePath']);
	}
	file_put_contents($cacheInfo['cachePath'] . "//gameInfo.json", json_encode($gameInfo, JSON_PRETTY_PRINT));
	return realpath($cacheInfo['cachePath']);
}

function extractor($PATH) {
	// extract data
	if (empty($PATH)) {
		return false;
	}
	print_r(getGameInfo($PATH));

	$cacheLocation = prepareProjectCache($PATH);
	extractData($PATH, $cacheLocation);
	dump($cacheLocation);
}
