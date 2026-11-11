<?php
// RPG Maker XP reuses the VX Ace loader.
$THISPATH = pathinfo(__FILE__);
$vxacePath = realpath($THISPATH['dirname'] . "/../rmvxace/loader.php");
include_once($vxacePath);
