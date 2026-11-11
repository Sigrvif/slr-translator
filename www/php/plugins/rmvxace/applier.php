<?php
class FlxZipArchive extends ZipArchive {
	public function addDir($location, $name) {
		$this->addEmptyDir($name);
		$this->addDirDo($location, $name);
	}
	private function addDirDo($location, $name) {
		$name .= '/';
		$location .= '/';
		$dir = opendir($location);
		while ($file = readdir($dir)) {
			if ($file == '.' || $file == '..') continue;
			$do = (filetype($location . $file) == 'dir') ? 'addDir' : 'addFile';
			$this->$do($location . $file, $name . $file);
		}
	}
}

function createZip($cache, $zip_file_name = "") {
	$currentScript = pathinfo(__FILE__);
	$pluginPath = $currentScript['dirname'];

	$the_folder = $cache . "\\data-translated";

	if (empty($zip_file_name)) {
		$zip_file_name = $cache . "\\translation.zip";
	}

	if (is_file($zip_file_name)) {
		unlink($zip_file_name);
	}

	$za = new FlxZipArchive;
	$res = $za->open($zip_file_name, ZipArchive::CREATE);
	if ($res === TRUE) {
		if (is_file($pluginPath . "\\distrib.txt")) {
			$noteContent = file_get_contents($pluginPath . "\\distrib.txt");
			$za->setArchiveComment($noteContent);
		}
		$za->addDir($the_folder, "Data");
		$za->close();
	} else {
		echo 'Could not create a zip archive on :' . $zip_file_name;
	}
}

function travelAndApply($data, $replacement) {
	global $_PARAM;
	$size = 2;
	$result = array();
	$origKey = 'original   ';
	$transKey = 'translation';
	$dataCopy = $data;
	foreach ($data as $key => $elm) {
		if (!empty($_PARAM['skipElement'])) {
			if (!is_integer($key) && in_array($key, $_PARAM['skipElement'])) {
				continue;
			}

			if ($key == "type") {
				if (in_array($elm, $_PARAM['skipElement'])) break;
			}
		}

		if (!empty($elm[$origKey])) {
			if (is_array($elm[$origKey])) {
				foreach ($elm[$origKey] as $thisKey => $str) {
					if (empty($str)) continue;
					if (empty($replacement[$str])) continue;
					$dataCopy[$key][$transKey][$thisKey] = $replacement[$str];
				}
			} else {
				if (!empty($replacement[$elm[$origKey]])) {
					$dataCopy[$key][$transKey] = $replacement[$elm[$origKey]];
				}
			}
		} else {
			if (empty($elm)) continue;
			if (!is_array($elm)) continue;
			$dataCopy[$key] = travelAndApply($dataCopy[$key], $replacement);
		}
	}
	return $dataCopy;
}

function applyTranslation($cache, $selectedFile) {
	// apply translation to dump/*.json script, write the result to mixed/*.json
	echo "entering applyTranslation\n";
	clearstatcache(true);
	$prepPath = $cache . "\\mixed";
	if (!is_dir($prepPath)) {
		mkdir($prepPath, 777, true);
	}

	$saveData = json_decode(file_get_contents($cache . "\\autosave.json"), true);
	$project = $saveData["project"];

	if (is_array($project['files'])) {
		foreach ($project['files'] as $file => $projectFiles) {
			$currentPath = str_replace("/", "\\", $cache . "/dump/" . $file);

			if (!empty($selectedFile)) {
				$currentPathInfo = pathinfo($currentPath);
				if (in_array($currentPathInfo['basename'], $selectedFile) == false) {
					continue;
				}
			}

			if (!is_array($projectFiles)) continue;
			if (!is_file($currentPath)) { continue; }
			if (!is_array($projectFiles['data'])) continue;

			echo "Applying translation on : " . $currentPath . "\n";

			$currentTemplate = json_decode(file_get_contents($currentPath), true);
			$replacement = array();
			foreach ($projectFiles['data'] as $key => $colums) {
				if (empty($colums[0])) continue;

				for ($i = count($colums) - 1; $i > 0; $i--) { // exclude $columns[0]
					if (!empty($colums[$i]) && $colums[$i] !== null) {
						$replacement[$colums[0]] = $colums[$i];
						break;
					}
				}
			}
			$newObject = travelAndApply($currentTemplate, $replacement);

			file_put_contents($prepPath . "/" . $file, json_encode($newObject));
		}
	} else {
		echo "project files not found";
	}
}

function apply($cache, $selectedFile = Array()) {
	// apply json translation to rpg data
	global $_PARAM;

	$cachePath = $cache."/dump";
	if (!is_dir($cachePath)) {
		echo "path :" . $cachePath . " not found\n";
		return false;
	}

	$prepPath = $cache."/mixed";
	if (!is_dir($prepPath)) {
		mkdir($prepPath, 777, true);
	}

	$dataPath = $cache."/data";
	if (!is_dir($dataPath)) {
		echo "path :" . $dataPath . " not found\n";
		return false;
	}
	$logFile = $cache."/export.log";
	file_put_contents($logFile, "Export log\r\n");

	echo "Preparing data...\n";
	copy_tree($dataPath, $prepPath);
	file_put_contents($logFile, ">>> copy data\r\n", FILE_APPEND);

	applyTranslation($cache, $selectedFile);

	$targetPath = $cache."/data-translated";
	if (is_dir($targetPath)) {
		del_tree($targetPath, true);
	}
	mkdir($targetPath, 777, true);

	$rubyPath = $_PARAM['RUBY_BIN'];
	if (!is_executable($rubyPath) && !(slr_is_windows() && is_file($rubyPath))) {
		throw new \Error("Ruby is required to translate VX Ace data but was not found: ".$rubyPath);
	}

	$fileList = glob($prepPath."/*.".$_PARAM['dataExtension']);
	echo "===========================\n";
	echo "START TRANSLATING DATA (" . count($fileList) . " file(s))\n";
	echo "===========================\n";

	file_put_contents($logFile, "Selected files:\r\n" . print_r($selectedFile, true) . "\r\n", FILE_APPEND);

	$translated = 0;
	$failed = 0;
	foreach ($fileList as $path) {
		$thisPathInf = pathinfo($path);
		if (!empty($selectedFile)) { // if empty, all files are exported
			if (in_array($thisPathInf['filename'] . ".json", $selectedFile) == false) {
				continue;
			}
		}
		$command = escapeshellarg($rubyPath) . " " .
			escapeshellarg($_PARAM['APP_PATH']."www/php/plugins/rmvxace/bin/rmjson.rb") . " " .
			"--translate=" . escapeshellarg($path) . " " .
			"--dest=" . escapeshellarg($targetPath);

		echo "Translating : " . $thisPathInf['basename'] . "\n";

		$rubyOutput = [];
		exec($command, $rubyOutput, $rc);
		file_put_contents($logFile, ">>> " . $thisPathInf['basename'] . " (exit {$rc})\r\n" . implode("\r\n", $rubyOutput) . "\r\n", FILE_APPEND);

		if ($rc !== 0) {
			$failed++;
			echo "  Failed to translate " . $thisPathInf['basename'] . " (exit {$rc}). See export.log\r\n";
		} else {
			$translated++;
		}
	}

	echo "===========================\n";
	echo "Translated " . $translated . " file(s)";
	if ($failed > 0) {
		echo ", " . $failed . " failed (see export.log)";
	}
	echo "\n";
}

function exportProject($GAME_FOLDER, $PATH, $selectedFile = Array()) {
	// $GAME_FOLDER is actual game folder or game title
	$cacheInfo = getProjectCacheInfo($GAME_FOLDER);
	apply($cacheInfo['cachePath'], $selectedFile);

	if (is_dir($PATH)) {
		$logFile = $cacheInfo['cachePath']."/export.log";
		if (empty($selectedFile)) {
			echo "Copying translated data to destination...\n";
			copy_tree($cacheInfo['cachePath']."/data-translated", $PATH);
			file_put_contents($logFile, ">>> copy export\r\n", FILE_APPEND);
		} else {
			foreach ($selectedFile as $filename) {
				$thisFileInfo = pathinfo($cacheInfo['cachePath']."/data-translated/".$filename);

				$targetPath = $PATH."/".$filename;
				$targetPathInfo = pathinfo($targetPath);
				if (!is_dir($targetPathInfo['dirname'])) {
					mkdir($targetPathInfo['dirname'], 777, true);
				}
				// Copy the file and any sibling files sharing the same stem (replaces "COPY /y stem.*").
				echo "Copying : " . $filename . "\n";
				$stem = $thisFileInfo['dirname']."/".$thisFileInfo['filename'];
				foreach (glob($stem.".*") as $srcFile) {
					$destFile = $targetPathInfo['dirname']."/".basename($srcFile);
					if (!@copy($srcFile, $destFile)) {
						echo "  Failed to copy " . basename($srcFile) . "\r\n";
						file_put_contents($logFile, ">>> copy " . basename($srcFile) . " failed\r\n", FILE_APPEND);
					}
				}
			}
		}
	} else {
		createZip($cacheInfo['cachePath'], $PATH);
	}
}
