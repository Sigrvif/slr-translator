"use strict";
var thisAddon = this;
const thisPath = thisAddon.getPathRelativeToRoot();
const moduleAlias = require('module-alias');
moduleAlias.addAliases({
    '@redsugoi': thisPath + '/node_modules',
    '@redengine': thisPath + '/lib/TranslationEngine'
});
moduleAlias.addPath(thisPath + '/node_modules');
moduleAlias.addPath(thisPath + '/lib/TranslationEngine');
moduleAlias(thisPath + '/package.json');
const { TextProcessor } = require('@redsugoi/mtl-text-processor');
const { TranslationEngineWrapper } = require('@redengine/TranslationEngineWrapper');
const { DSLRTranslationEngineWrapper } = require('@redengine/DSLRTranslationEngineWrapper');
const { RedSugoiEngine } = require('@redengine/RedSugoiEngine');
const { DSLREngine } = require('@redengine/DSLREngine');
let wrappers = [
    new RedSugoiEngine(TextProcessor, thisAddon),
    new DSLREngine(TextProcessor, thisAddon)
];
wrappers.forEach((wrapper) => {
    trans.registerEngine(wrapper.getEngine().id, wrapper.getEngine());
});
$(document).ready(() => {
    wrappers.forEach((wrapper) => {
        wrapper.init();
    });

});
