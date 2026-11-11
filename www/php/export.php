<?php
include("header.php");
set_time_limit(0);

// ==================================================
// DETECTING GAME ENGINE
// ==================================================
if (empty($_POST['gameEngine'])) {
	$_POST['gameEngine'] = detectGameEngine($_GET['gameFolder']);
}

$RPG_MAKER_TRANS = array("rmxp", "rmvx", "rmvxace");

// Use the RPGMakerTrans (.trans) flow only when the rpgmt binary is available;
// otherwise fall back to the standalone ruby-based plugins (e.g. on Linux).
$rpgmtAvailable = !empty($_PARAM['RPGMTRANS']) && (is_executable($_PARAM['RPGMTRANS']) || (slr_is_windows() && is_file($_PARAM['RPGMTRANS'])));

if (!empty($_POST['rpgTransFormat']) && in_array($_POST['gameEngine'], $RPG_MAKER_TRANS) && $rpgmtAvailable) {
	include("./plugins/rpgmakertrans/loader.php");
} else if (is_file("./plugins/" . $_POST['gameEngine'] . "/loader.php")) {
	include("./plugins/" . $_POST['gameEngine'] . "/loader.php");
}

// typeguard $_POST['gameFolder']. In the previous version, blank $_POST['gameFolder'] generates an array
if (empty($_POST['gameFolder'])) $_POST['gameFolder'] = "";

echo "Received parameters on export.php : \r\n";
print_r($_POST);

if (!empty($_POST["transPath"])) {
	$_POST['transFile'] = $_POST["transPath"];
}

if (empty($_POST['transFile'])) {
	$projectCachePath = getProjectCahePath();
	$_POST['transFile'] = $projectCachePath . "\\autosave.json";
}

echo "generating from trans file : " . $_POST['transFile'] . "\r\n";

// export to dir / zip handler
exportProject($_POST['gameFolder'], $_GET['path'], $_POST['files']);
