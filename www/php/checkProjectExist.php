<?php
// Check for existing projects sharing the same title with $_POST['gameTitle'].
// Returns a JSON array.

ob_start();
include_once("moduleLoader.php");
ob_end_clean();

if (!empty($_GET['gameFolder'])) $_POST['gameFolder'] = $_GET['gameFolder'];

$gameInfo = getGameInfo($_POST['gameFolder']);

$result = checkProjectByTitle($gameInfo['title']);
echo json_encode($result);
