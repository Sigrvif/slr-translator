"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TranslationEngineOption = void 0;
const SLROption = require("www/js/Option.js");

/**
 * Translator-engine option. A thin subclass of the canonical SLROption
 * (www/js/Option.js): metadata, value backend and type coercion all live on the shared
 * base class, so the addon and translator option systems are literally one model.
 *
 * This is THE class to use when adding an option to a translator engine (e.g. DSLR).
 * Construct it in the engine wrapper's constructor and assign it to `this.option<Name>`:
 *
 *     this.optionFoo = new TranslationEngineOption({
 *         wrapper: this,                 // required: routes getValue/setValue to the engine
 *         id: 'foo',                      // required: config key + jsonform schema key
 *         default: <factory default>,     // required (or undefined): the fallback value
 *         type: 'string',                 // inferred from `default` if omitted
 *         name: 'Foo',                   // display title
 *         description: '...',
 *         category: TranslationEngineOptionCategories.OPTIONS,
 *         formType: 'checkbox',           // jsonform field type (optional)
 *         formOptions: { ... },           // extra jsonform field props (optional)
 *         schemaOptions: { ... }          // extra jsonform schema props (optional)
 *     });
 *
 * The wrapper's init() then feeds every `option*` to OptionFormBuilder.build(), which
 * populates the jsonform schema, snapshots factory defaults, and emits the current value
 * onto the engine. Reading: inside the wrapper use `this.optionFoo.getValue()`; outside,
 * resolve the correct engine then `engine.getOptions('foo')`. Full mechanics + pitfalls in
 * www/js/Option.js ("HOW THE OPTION SYSTEM WORKS").
 */
class TranslationEngineOption extends SLROption {
    constructor(options) {
        // Replicate the default-merge + type-from-default that the old
        // constructor did, then let SLROption store it and register it.
        super(Object.assign({
            priority: 0,
            type: typeof options.default,
            formOptions: {},
            schemaOptions: {},
            childForm: []
        }, options));
    }
}
exports.TranslationEngineOption = TranslationEngineOption;
