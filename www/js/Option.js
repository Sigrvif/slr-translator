/**
 * @file Option.js - canonical option model for SLR Translator.
 *
 * A single, decoupled representation of a configurable option. It holds the
 * option's metadata and delegates value access to a pluggable "backend"
 * (getValue/setValue), so the same class serves both option systems:
 *
 *   - addon options      (options.js): backend reads/writes thisAddon.config[<path>]
 *   - translator options (SLRtrans):   backend reads/writes engine.getOptions()/update()
 *
 * This replaces the legacy mini-schema `HOOK`-eval binding with typed objects.
 * The class is intentionally not named `Option` to avoid shadowing the DOM's
 * `window.Option` (HTMLOptionElement) constructor, which the UI relies on.
 *
 * Loaded as a global (`window.SLROption`) and also CommonJS-exported so the
 * SLRtrans addon can `require("www/js/Option.js")` and subclass it.
 *
 * ===========================================================================
 * HOW THE OPTION SYSTEM WORKS  (read before adding or reading an option)
 * ===========================================================================
 *
 * 1. ONE MODEL, TWO HOMES
 *    Every option is an SLROption holding metadata + a pluggable value "backend".
 *      - Addon options (options.js): created with a `backend` that reads/writes
 *        `thisAddon.config[...]`.
 *      - Translator options (SLRtrans): created as TranslationEngineOption, a thin
 *        subclass that passes `wrapper` instead of `backend`. Its value backend is the
 *        translator engine itself: `wrapper.getEngine().getOptions(id)` /
 *        `.update(id, value)`.
 *    Metadata, type coercion and value plumbing are identical — only the store differs.
 *
 * 2. ADDING A TRANSLATOR OPTION
 *    In the engine wrapper's constructor:
 *        this.optionFoo = new TranslationEngineOption({
 *            wrapper: this, id: 'foo', default: <factory default>,
 *            type, name, description, category, formType, formOptions, schemaOptions
 *        });
 *    The wrapper's init() hands every `option*` to OptionFormBuilder.build(), which:
 *      (a) writes the jsonform schema entry  schema[id] = { type, title, description,
 *          default, ... };
 *      (b) snapshots the FACTORY defaults into  optionsForm.defaults[id];
 *      (c) emits the current value onto the engine as a direct property
 *          engine[id] = option.getValue().
 *    After that, the form's onChange writes back through engine.update(id, value), which
 *    persists into sys.config.translatorEngineOptions[engine.id][id].
 *
 * 3. READING A VALUE
 *      - From INSIDE the engine wrapper:   this.optionFoo.getValue()
 *      - From OUTSIDE (e.g. an addon):     get the RIGHT engine first (see #4), then use
 *                                          engine.getOptions(id)  (or read engine[id]).
 *    Do NOT reinvent the lookup, and do NOT assume the active translator owns the option.
 *
 * 4. FIND THE RIGHT ENGINE
 *    trans.engines[id] / TranslatorEngine.translators[id] hold the INNER TranslatorEngine
 *    (the one carrying getOptions / optionsForm / schema). The option OBJECTS (optionFoo,
 *    getValue) live on the WRAPPER, not the inner engine. The user's active translator
 *    (sys.config.translator) can be a completely different engine — e.g. DSLR's glossary
 *    options belong to the DSLR engine even when the user translates with RedSugoi.
 *    Identify an engine by the options it actually OWNS (a glossaryApiUrl/enableJsonFullBatch
 *    property or schema entry), never by which engine happens to be active.
 *
 * 5. PITFALL — empty string is NOT "unset"
 *    getValue() falls back to getDefault() ONLY when the backend returns `undefined`.
 *    TranslatorEngine.getOptions(id) resolves
 *        config[id] ?? defaultConfig[id] ?? this[id] ?? schema[id].default
 *    using `??`, which treats "" as a real value. So an option stored as "" reads back as
 *    "", NOT its default. That is intentional where "" carries meaning (e.g. glossaryApiUrl
 *    = "" means "skip the LLM"); readers that want "default when empty" must check themselves.
 *
 * 6. PITFALL — schema[id].default is mutated at render time
 *    options.translatorMenu.assignDefault() overwrites schema[id].default with the engine's
 *    CURRENT value whenever the options dialog renders, so after the dialog has been opened
 *    schema[id].default is no longer the factory default. The true factory default is
 *    option.getDefault() (on the option object) or optionsForm.defaults[id] (the build-time
 *    snapshot).
 * ===========================================================================
 */

(function () {
	"use strict";

	/**
	 * Tokenize a JS member-access expression into path segments, e.g.
	 *   "thisAddon.config['fontFamily']"  -> ["config", "fontFamily"]
	 *   "thisAddon.config.useLegacyParser" -> ["config", "useLegacyParser"]
	 *   "thisAddon.config['a']['b']"      -> ["config", "a", "b"]
	 * Supports dotted identifiers, string-index brackets and numeric indices.
	 * No eval is performed.
	 */
	function tokenizeAccess(expr) {
		var segments = [];
		if (typeof expr !== "string") return segments;
		var base = expr.match(/^[A-Za-z_$][\w$]*/);
		if (!base) return segments;
		var rest = expr.slice(base[0].length);
		var re = /\.([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\]|\[\s*(\d+)\s*\]/g;
		var m;
		while ((m = re.exec(rest)) !== null) {
			if (m[1] !== undefined) segments.push(m[1]);
			else if (m[2] !== undefined) segments.push(m[2]);
			else if (m[3] !== undefined) segments.push(parseInt(m[3], 10));
		}
		return segments;
	}

	/**
	 * Resolve a legacy `HOOK` (always a reference into `thisAddon.config`,
	 * expressed either as a string path or — rarely — a function) into a
	 * { get, set } pair bound to the addon. Replaces the former `eval(HOOK)`.
	 */
	function resolveHook(thisAddon, hook) {
		if (typeof hook === "function") {
			// Function hooks were read-only displays in the legacy code
			// (the onChange write path only existed for string hooks).
			return {
				get: function () { return hook.call(thisAddon); },
				set: function () { /* no-op */ }
			};
		}
		var segments = tokenizeAccess(String(hook));
		var walk = function (create) {
			var obj = thisAddon;
			for (var i = 0; i < segments.length - 1; i++) {
				var seg = segments[i];
				if (obj[seg] == null) {
					if (create) obj[seg] = {};
					else return undefined;
				}
				obj = obj[seg];
			}
			return { parent: obj, key: segments[segments.length - 1] };
		};
		return {
			get: function () {
				if (!segments.length) return undefined;
				var w = walk(false);
				return w ? w.parent[w.key] : undefined;
			},
			set: function (value) {
				if (!segments.length) return;
				var w = walk(true);
				if (w) w.parent[w.key] = value;
			}
		};
	}

	class SLROption {
		/**
		 * @param {Object} opts
		 * @param {string} opts.id            Option key / config path leaf.
		 * @param {string} [opts.name]        Display title.
		 * @param {string} [opts.description] Help text.
		 * @param {string} [opts.type]        JSON-schema type (string/boolean/number/integer/array/object).
		 * @param {*}      [opts.default]     Factory default (value or function).
		 * @param {string} [opts.formType]    jsonform field type (checkboxes/radios/...).
		 * @param {Object} [opts.formOptions] Extra jsonform field props (titleMap, fieldHtmlClass, ...).
		 * @param {Object} [opts.schemaOptions] Extra jsonform schema props (enum, items, attr, min/max, ...).
		 * @param {Object} [opts.backend]     Value store: { getValue(id), setValue(id, value) }.
		 * @param {Object} [opts.wrapper]     Legacy translator wrapper (provides addOption + getEngine()).
		 * @param {Function} [opts.onInput]   Addon callback fired before the value is written.
		 * @param {Function} [opts.onChange]  Addon callback fired before the value is written.
		 */
		constructor(opts) {
			opts = opts || {};
			var def = (opts.default !== undefined) ? opts.default : undefined;
			this.options = {
				id: opts.id,
				name: opts.name || opts.id,
				description: opts.description || "",
				type: opts.type || (def !== undefined ? typeof def : "string"),
				default: def,
				priority: opts.priority || 0,
				category: opts.category,
				formType: opts.formType,
				formOptions: opts.formOptions || {},
				schemaOptions: opts.schemaOptions || {},
				childForm: opts.childForm || [],
				backend: opts.backend,
				wrapper: opts.wrapper,
				onInput: opts.onInput,
				onChange: opts.onChange
			};
			if (this.options.wrapper && typeof this.options.wrapper.addOption === "function") {
				this.options.wrapper.addOption(this);
			}
		}

		getId() { return this.options.id; }
		getName() { return this.options.name; }
		getDescription() { return this.options.description; }
		getType() { return this.options.type; }
		getDefault() { return this.options.default; }
		getPriority() { return this.options.priority; }
		getCategory() { return this.options.category; }
		getFormType() { return this.options.formType; }
		getFormOptions() { return this.options.formOptions; }
		getSchemaOptions() { return this.options.schemaOptions; }
		getChildForm() { return this.options.childForm; }
		getOnInput() { return this.options.onInput; }
		getOnChange() { return this.options.onChange; }

		// Returns the backend value (engine.getOptions / addon config). Falls back to the
		// factory default ONLY when the backend returns `undefined` — a stored "" is returned
		// as-is (see the file header §5). Callers that want "default when empty" must check.
		getValue() {
			var v;
			if (this.options.backend) v = this.options.backend.getValue(this.options.id);
			else if (this.options.wrapper) v = this.options.wrapper.getEngine().getOptions(this.options.id);
			if (v === undefined) v = this.getDefault();
			return v;
		}

		/**
		 * Coerce + persist a value. Type coercion mirrors the original
		 * TranslationEngineOption.setValue so translator behaviour is unchanged.
		 */
		setValue(value) {
			var type = this.getType();
			if (type === "number") {
				if (value === null || value === undefined || value === "") value = "";
				else value = Number(value);
			} else if (typeof value === "string") {
				if (type === "boolean") value = (value === "1" || value === "true" || value === true);
				else if (type === "object") {
					try { value = JSON.parse(value); }
					catch (e) { return; }
				}
			}
			if (this.options.backend) this.options.backend.setValue(this.options.id, value);
			else if (this.options.wrapper) this.options.wrapper.getEngine().update(this.options.id, value);
		}
	}

	SLROption.tokenizeAccess = tokenizeAccess;
	SLROption.resolveHook = resolveHook;

	window.SLROption = SLROption;
	if (typeof module !== "undefined" && module.exports) module.exports = SLROption;
})();
