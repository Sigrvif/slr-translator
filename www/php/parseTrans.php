<?php
include("header.php");
/*
Parse trans file into array
$_POST['path'] = path to file
*/
if (is_file($_POST['path'])) {
	$result = parseRPGTransFile($_POST['path']);

	if ($_POST['prettyPrint']) {
		echo json_encode($result, JSON_PRETTY_PRINT);
	} else {
		echo json_encode($result);
	}
}
