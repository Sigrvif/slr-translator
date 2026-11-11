<?php
error_reporting(E_ALL);
header("Content-Type: text/plain");

function parseMecab($input) {
	$result = array();
	if (empty($input)) return $result;

	$lines = preg_split('/\r\n|\r|\n/', $input);
	$SRC = array(
		"きゃ","きゅ","きょ",
		"しゃ","しゅ","しょ",
		"ちゃ","ちゅ","ちょ",
		"にゃ","にゅ","にょ",
		"ひゃ","ひゅ","ひょ",
		"みゃ","みゅ","みょ",
		"りゃ","りゅ","りょ",
		"ぎゃ","ぎゅ","ぎょ",
		"じゃ","じゅ","じょ",
		"ぢゃ","ぢゅ","ぢょ",
		"びゃ","びゅ","びょ",
		"ぴゃ","ぴゅ","ぴょ",

		"あ", "い", "う", "え", "お",
		"か", "き", "く", "け", "こ",
		"さ", "し", "す", "せ", "そ",
		"た", "ち", "つ", "て", "と",
		"な", "に", "ぬ", "ね", "の",
		"は", "ひ", "ふ", "へ", "ほ",
		"ま", "み", "む", "め", "も",
		"や", "ゆ", "よ",
		"ら", "り", "る", "れ", "ろ",
		"わ", "ゐ", "ゑ", "を",
		"が","ぎ","ぐ","げ","ご",
		"ざ","じ","ず","ぜ","ぞ",
		"だ","ぢ","づ","で","ど",
		"ば","び","ぶ","べ","ぼ",
		"ぱ","ぴ","ぷ","ぺ","ぽ",
		"ん",

		"キャ","キュ","キョ",
		"シャ","シュ","ショ",
		"チャ","チュ","チョ",
		"ニャ","ニュ","ニョ",
		"ヒャ","ヒュ","ヒョ",
		"ミャ","ミュ","ミョ",
		"リャ","リュ","リョ",
		"ギャ","ギュ","ギョ",
		"ジャ","ジュ","ジョ",
		"ヂャ","ヂュ","ヂョ",
		"ビャ","ビュ","ビョ",
		"ピャ","ピュ","ピョ",
		"デャ","デュ","デョ",
		"テャ","テュ","テョ",

		"ア","イ","ウ","エ","オ",
		"カ","キ","ク","ケ","コ",
		"サ","シ","ス","セ","ソ",
		"タ","チ","ツ","テ","ト",
		"ナ","ニ","ヌ","ネ","ノ",
		"ハ","ヒ","フ","ヘ","ホ",
		"マ","ミ","ム","メ","モ",
		"ヤ","ユ","ヨ",
		"ラ","リ","ル","レ","ロ",
		"ワ","ヰ","ヱ","ヲ",
		"ガ","ギ","グ","ゲ","ゴ",
		"ザ","ジ","ズ","ゼ","ゾ",
		"ダ","ヂ","ヅ","デ","ド",
		"バ","ビ","ブ","ベ","ボ",
		"パ","ピ","プ","ペ","ポ",

		"ン","ィ","ェ","ォ",
		"っ","ッ",
		"ぁ", "ぃ", "ぅ", "ぇ", "ぉ",
		"ゃ", "ゅ", "ょ"
	);
	$REP = array(
		"kya","kyu","kyo",
		"sha","shu","sho",
		"cha","chu","cho",
		"nya","nyu","nyo",
		"hya","hyu","hyo",
		"mya","myu","myo",
		"rya","ryu","ryo",
		"gya","gyu","gyo",
		"jya","jyu","jyo",
		"dya","dyu","dyo",
		"bya","byu","byo",
		"pya","pyu","pyo",

		"a", "i", "u", "e", "o",
		"ka","ki","ku","ke","ko",
		"sa","shi","su","se","so",
		"ta","chi","tsu","te","to",
		"na","ni","nu","ne","no",
		"ha","hi","fu","he","ho",
		"ma","mi","mu","me","mo",
		"ya","yu","yo",
		"ra","ri","ru","re","ro",
		"wa","wi","we","wo",
		"ga","gi","gu","ge","go",
		"za","ji","zu","ze","zo",
		"da","dji","dzu","de","do",
		"ba","bi","bu","be","bo",
		"pa","pi","pu","pe","po",
		"n",

		"kya","kyu","kyo",
		"sha","shu","sho",
		"cha","chu","cho",
		"nya","nyu","nyo",
		"hya","hyu","hyo",
		"mya","myu","myo",
		"rya","ryu","ryo",
		"gya","gyu","gyo",
		"jya","jyu","jyo",
		"dya","dyu","dyo",
		"bya","byu","byo",
		"pya","pyu","pyo",
		"dya","dyu","dyo",
		"tya","tyu","tyo",

		"a", "i", "u", "e", "o",
		"ka","ki","ku","ke","ko",
		"sa","shi","su","se","so",
		"ta","chi","tsu","te","to",
		"na","ni","nu","ne","no",
		"ha","hi","fu","he","ho",
		"ma","mi","mu","me","mo",
		"ya","yu","yo",
		"ra","ri","ru","re","ro",
		"wa","wi","we","wo",
		"ga","gi","gu","ge","go",
		"za","ji","zu","ze","zo",
		"da","dji","dzu","de","do",
		"ba","bi","bu","be","bo",
		"pa","pi","pu","pe","po",

		"n","i","e","o",
		"`","`",
		"a", "i", "u", "e", "o",
		"ya", "yu", "yo"
	);

	$mergeFirstChar = false;
	foreach ($lines as $key => $line) {
		if ($line == "EOS") break;
		$ELM = array();

		$segment = explode(",", $line);

		$ELM['original'] = trim(strstr($segment[0], "	", true));

		$ELM['furigana'] = trim($segment[count($segment) - 1]);
		if ($ELM['furigana'] == '*') {
			$ELM['furigana'] = $ELM['original'];
		}
		$ELM['romaji'] = str_replace($SRC, $REP, $ELM['furigana']);
		if ($mergeFirstChar == true) {
			$x = mb_substr($ELM['romaji'], 0, 1);
			$result[$key - 1]['romaji'] = mb_substr($result[$key - 1]['romaji'], 0, -1) . $x;
			$mergeFirstChar = false;
		}

		while (mb_strpos($ELM['romaji'], "`") !== false) {
			$location = mb_strpos($ELM['romaji'], "`");
			if ($location >= mb_strlen($ELM['romaji'])) {
				$mergeFirstChar = true;
				break;
			} else {
				$location = mb_strpos($ELM['romaji'], "`");
				$nextChar = mb_substr($ELM['romaji'], $location + 1, 1);
				$ELM['romaji'] = mb_substr($ELM['romaji'], 0, $location) . $nextChar . mb_substr($ELM['romaji'], $location + 1);
			}
			break;
		}

		$result[$key] = $ELM;
	}
	return $result;
}

// Use the bundled MeCab on both platforms (no system mecab dependency).
$_PARAM['MECAB_PATH'] = (DIRECTORY_SEPARATOR === '\\')
	? ($_SERVER['APPLICATION_ROOT'] . "/3rdParty/MeCab/bin/mecab.exe")
	: ($_SERVER['APPLICATION_ROOT'] . "/3rdParty/MeCab/bin/mecab");
$_PARAM['MECAB_RC']  = $_SERVER['APPLICATION_ROOT'] . "/3rdParty/MeCab/bin/mecabrc";
$_PARAM['MECAB_DIC'] = $_SERVER['APPLICATION_ROOT'] . "/3rdParty/MeCab/dic/ipadic";

$TEMP = rtrim($_SERVER['TMP'], "/\\") . "/trans-" . time() . rand(10000, 99999) . ".txt";
file_put_contents($TEMP, $_GET['text']);

// Pass the bundled config + dictionary explicitly so MeCab locates them
// regardless of its compiled-in default config path (the Linux bundle has no
// system mecabrc). On Windows mecab.exe resolves these the same way.
$cmd = escapeshellarg($_PARAM['MECAB_PATH'])
	. " -r " . escapeshellarg($_PARAM['MECAB_RC'])
	. " -d " . escapeshellarg($_PARAM['MECAB_DIC'])
	. " < " . escapeshellarg($TEMP);

ob_start();
passthru($cmd);
$bufferOutput = ob_get_clean();
ob_start();

$ELM['romaji'] = "TES·TING";
$location = strpos($ELM['romaji'], "·");
$nextChar = mb_substr($ELM['romaji'], $location + 1, 1);

$ELM['romaji'] = mb_substr($ELM['romaji'], 0, $location) . $nextChar . mb_substr($ELM['romaji'], $location + 1);

ob_end_clean();

$LINES = preg_split('/EOS\r?\n/', $bufferOutput);
array_pop($LINES); // remove blank last element
if (is_array($LINES)) {
	$newLines = array();
	foreach ($LINES as $val) {
		$newLines[] = rtrim($val);
	}
	$LINES = $newLines;
}

$result = array();
foreach ($LINES as $line) {
	$result[] = parseMecab($line);
}
echo json_encode($result);

unlink($TEMP);
