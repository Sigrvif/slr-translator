<?php

function applyPatch($destination) {
	global $_PARAM;
	// assigning $_POST['dataPath'] manually
	// this is needed for overriding exportToDir() default behavior
	// exportToDir() will look up data from $_POST['dataPath'] instead of PHP cache

	if (is_dir($destination)) $destination = $destination;

	$_POST['dataPath'] = $_POST['targetPath'];
	MV_translateData($destination, $_POST['files']);
}
