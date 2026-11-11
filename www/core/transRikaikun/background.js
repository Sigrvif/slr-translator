import { RcxDict } from "./data.js";
import { RcxMain } from "./rikaichan.js";
import { configPromise } from "./configuration.js";
import { tts } from "./texttospeech.js";
async function createRcxMainPromise() {
  const config = await configPromise;
  const dict = await RcxDict.create(config);
  return RcxMain.create(dict, config);
}
const rcxMainPromise = createRcxMainPromise();
chrome.browserAction.onClicked.addListener(async (tab) => {
  const rcxMain = await rcxMainPromise;
  rcxMain.inlineToggle(tab);
});
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const rcxMain = await rcxMainPromise;
  rcxMain.onTabSelect(activeInfo.tabId);
});
chrome.runtime.onMessage.addListener(async (request, sender, response) => {
  const rcxMain = await rcxMainPromise;
  switch (request.type) {
    case "enable?":
      if (sender.tab === void 0) {
        throw TypeError("sender.tab is always defined here.");
      }
      rcxMain.onTabSelect(sender.tab.id);
      break;
    case "xsearch":
      response(rcxMain.search(request.text, request.dictOption));
      break;
    case "resetDict":
      rcxMain.resetDict();
      break;
    case "translate":
      response(rcxMain.dict.translate(request.title));
      break;
    case "makehtml":
      response(rcxMain.dict.makeHtml(request.entry));
      break;
    case "switchOnlyReading":
      void chrome.storage.sync.set({
        onlyreading: !rcxMain.config.onlyreading
      });
      break;
    case "copyToClip":
      rcxMain.copyToClip(sender.tab, request.entry);
      break;
    case "playTTS":
      tts.play(request.text);
      break;
    default:
      console.log(request);
  }
});
