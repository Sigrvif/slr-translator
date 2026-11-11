"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptionFormBuilder = void 0;

/**
 * Shared helper that turns a sorted list of TranslationEngineOption into a
 * jsonform definition grouped into always-open, titled `<fieldset>` sections.
 *
 * The schema is still produced flat (keyed by option id) so existing behaviour
 * (getFormValues, config save/load, renderOptions attribute application) keeps
 * working unchanged. Only the `form` array is restructured: instead of a single
 * flat wall of fields, options are wrapped in nested fieldsets.
 *
 * Sections support an optional second level (a "child" axis). This is used by
 * DSLR to split each concern into the three engine roles (Main / Fallback /
 * Glossary) so the triplicated options are clearly labelled instead of looking
 * like accidental repeats. Plain engines can ignore the child axis and simply
 * get one fieldset per category.
 */
class OptionFormBuilder {
    /**
     * Build the jsonform onChange handler for a single option. Kept identical to
     * the inline handlers that used to live in each wrapper's init().
     */
    static buildFieldEntry(option, engine) {
        return {
            key: option.getId(),
            type: option.getFormType(),
            onChange: (evt) => {
                if (option.getType() == 'boolean') {
                    let value = $(evt.target).prop('checked');
                    option.setValue(value);
                    engine.update(option.getId(), value);
                }
                else {
                    let value = $(evt.target).val();
                    option.setValue(value);
                    engine.update(option.getId(), option.getValue());
                }
                // Live role-gate toggle: when a gate URL field changes, gray
                // (or un-gray) its role group(s) without a full re-render.
                // Never disables inputs — an inactive group stays editable so
                // the user can fill the URL and activate it.
                try {
                    const gates = (engine && engine.optionsForm && engine.optionsForm.roleGates) || [];
                    const hit = gates.filter((g) => g && g.urlId === option.getId());
                    if (hit.length && typeof $ !== 'undefined') {
                        let current = "";
                        try { current = option.getValue(); } catch (e) { current = ""; }
                        const active = String(current == null ? "" : current).trim() !== "";
                        const $scope = $(evt.target).closest('fieldset.option-section');
                        const $root = $scope.length ? $scope : $(evt.target).closest('form');
                        for (const g of hit) {
                            $root.find('fieldset.option-role-' + g.child)
                                .toggleClass('option-role-inactive', !active);
                        }
                    }
                } catch (e) { /* live toggle is best-effort */ }
            },
            ...option.getFormOptions()
        };
    }

    /**
     * @param {Object} params
     * @param {import('./TranslationEngineOption').TranslationEngineOption[]} params.storedOptions
     *   Options. They do NOT need to be pre-sorted: this builder re-sorts them
     *   according to the provided section/child ordering, which fully controls
     *   grouping and display order.
     * @param {Object} params.engine The translatorEngine (used for update() and
     *   for assigning the current value onto it, mirroring the old behaviour).
     * @param {{key:string,title:string}[]} params.sections Ordered list of
     *   top-level (parent) sections. Order here = display order.
     * @param {(option:any)=>{parent:string,child?:string}} params.sectionOf
     *   Resolves an option to its parent section key and optional child key.
     * @param {string[]} [params.childOrder] Order of child keys within a parent.
     * @param {(child:string)=>string} [params.childTitle] Display title for a
     *   child key (e.g. role name). When a parent resolves to only a single
     *   child (or no children) the child fieldset is collapsed into the parent
     *   so we don't get a redundant single-item wrapper.
     * @param {Object} [params.append] Trailing form nodes to push after every
     *   section (e.g. action buttons). Either an array or an object
     *   `{ nodes: [...], afterSection: 'sectionKey' }`.
     * @param {boolean} [params.collapsible=false] When true, top-level section
     *   fieldsets are emitted as `expandable` so jsonform renders them collapsed
     *   by default with a legend that toggles open/closed. Child (role) groups
     *   are always left open inside their section.
     * @param {Object<string,string>} [params.headOf] Optional map from child key to
     *   an option id that must render first inside that child's group. Used to
     *   promote the most important field of a role group (e.g. Reasoning Format)
     *   without moving it out of normal emission, so it cannot render twice.
     * @returns {{form:Object[], schema:Object}}
     */
    static build(params) {
        const { storedOptions, engine, sections, sectionOf, childOrder = [], childTitle = ((c) => c), append, prepend, collapsible = false, roleGates = [], sectionAppend = {}, sectionPrepend = {}, headOf = {} } = params;
        const sectionIndex = {};
        sections.forEach((s, i) => { sectionIndex[s.key] = i; });
        const parentTitle = (key) => (sections.find((s) => s.key === key) || {}).title || key;

        // Index options by id so callers (e.g. the "show changed only" filter)
        // can ask the authoritative source -- the option objects themselves --
        // whether a value differs from its factory default. This sidesteps every
        // DOM/type-coercion mismatch that plagues comparing rendered text.
        const optionsByKey = {};
        for (const opt of storedOptions) optionsByKey[opt.getId()] = opt;
        // Role gates: a role (Fallback / Glossary / Review / Endpoint N) is
        // active only while its API URL option is filled. Inactive roles keep
        // their fields editable but render grayed with a notice, so it is
        // obvious their values currently do nothing.
        const isChildActive = (child) => {
            const gates = roleGates.filter((g) => g && g.child === child);
            if (gates.length === 0) return true;
            return gates.every((g) => {
                const opt = optionsByKey[g.urlId];
                if (!opt) return true;
                try {
                    const v = opt.getValue();
                    return String(v == null ? "" : v).trim() !== "";
                } catch (e) { return true; }
            });
        };
        const isChanged = (key) => {
            const opt = optionsByKey[key];
            if (!opt) return false;
            return OptionFormBuilder.canonicalize(opt.getValue()) !== OptionFormBuilder.canonicalize(opt.getDefault());
        };

        // Resolve + annotate every option with its placement.
        const annotated = storedOptions.map((option, idx) => {
            const placement = sectionOf(option) || { parent: 'misc' };
            return {
                option,
                idx,
                parent: placement.parent || 'misc',
                child: placement.child,
            };
        });

        const parentRank = (p) => (p in sectionIndex ? sectionIndex[p] : sections.length);
        const childRank = (c) => {
            if (!c) return -1; // no-child (parent-level) options float to the top of their parent
            const i = childOrder.indexOf(c);
            return i === -1 ? childOrder.length : i;
        };

        annotated.sort((a, b) => {
            if (a.parent !== b.parent) return parentRank(a.parent) - parentRank(b.parent);
            if (a.child !== b.child) return childRank(a.child) - childRank(b.child);
            return a.idx - b.idx; // stable: preserve declaration order within the same slot
        });

        const form = [];
        if (prepend) for (const node of prepend) form.push(node);
        const schema = {};

        // Group by parent, preserving section order.
        const byParent = {};
        for (const a of annotated) {
            (byParent[a.parent] = byParent[a.parent] || []).push(a);
        }

        let lastHeading = null;
        for (const section of sections) {
            // sectionAppend may be an array (nodes appended at the section level, e.g. Quick
            // Start's "Test connection" button) or an object keyed by child (nodes appended
            // inside that child's group, e.g. the runtime card's general/per-model/role
            // sub-groups).
            const rawAppend = sectionAppend[section.key];
            const childAppend = (rawAppend && !Array.isArray(rawAppend) && typeof rawAppend === 'object') ? rawAppend : null;
            const appendNodes = Array.isArray(rawAppend) ? rawAppend : [];
            // Card-level lead-in nodes (e.g. the runtime card's Start/Stop buttons and live
            // status line) render directly under the section legend, before the help text and
            // any child groups. Keyed by section key; a section that only carries lead-in nodes
            // is still emitted.
            const sectionLead = (sectionPrepend && Array.isArray(sectionPrepend[section.key])) ? sectionPrepend[section.key] : null;
            // A per-child entry is either a plain array (nodes appended after that child's option
            // items) or an object `{ prepend: [...], append: [...] }` (prepend nodes render before
            // that child's option items, append nodes after them). Normalise both to the object
            // shape so the render path below is uniform.
            const childSpecOf = (entry) => {
                if (Array.isArray(entry)) return { prepend: [], append: entry };
                if (entry && typeof entry === 'object') {
                    return {
                        prepend: Array.isArray(entry.prepend) ? entry.prepend : [],
                        append: Array.isArray(entry.append) ? entry.append : []
                    };
                }
                return { prepend: [], append: [] };
            };
            const specHasNodes = (spec) => spec.prepend.length > 0 || spec.append.length > 0;
            const group = byParent[section.key] || [];
            // Does this parent use the child axis at all? A child with appended nodes counts even
            // when it has no registered option, so an "append-only" group (e.g. the role pickers)
            // can still be rendered inside its parent.
            const distinctChildren = new Set(group.map((a) => a.child));
            distinctChildren.delete(undefined);
            if (childAppend) {
                for (const key of Object.keys(childAppend)) {
                    if (specHasNodes(childSpecOf(childAppend[key]))) distinctChildren.add(key);
                }
            }
            const hasChildAppend = childAppend &&
                Object.keys(childAppend).some((k) => specHasNodes(childSpecOf(childAppend[k])));
            const useChildren = distinctChildren.size >= 2 || (hasChildAppend && distinctChildren.size >= 1);
            // A section normally needs at least one option. A section whose content is entirely
            // appended nodes (array form, or a child that is only appended nodes) is emitted too,
            // so sectionAppend alone can create a section or a child group.
            if (group.length === 0 && appendNodes.length === 0 && distinctChildren.size === 0 &&
                (!sectionLead || sectionLead.length === 0)) continue;

            // Optional one-time divider heading before a run of sections (e.g.
            // "Advanced"). Emitted once per heading value, not per section.
            if (section.heading && section.heading !== lastHeading) {
                form.push({
                    type: 'help',
                    helpvalue: '<div class="option-section-heading">' + section.heading + '</div>',
                    notitle: true,
                    htmlClass: 'option-heading-row'
                });
                lastHeading = section.heading;
            }

            const items = [];
            if (useChildren) {
                // Bucket by child, in childOrder, then any leftover children.
                const orderedChildren = [...childOrder, ...[...distinctChildren].filter((c) => !childOrder.includes(c))];
                for (const child of orderedChildren) {
                    const childGroup = group.filter((a) => a.child === child);
                    // One option per child may be promoted to the top of that child's group (e.g.
                    // Reasoning Format, which is the most important field of each role group). This
                    // reorders the group in place: the option stays in normal emission, so its
                    // childForm and role-gate handling are untouched and it can never render twice.
                    const head = headOf[child];
                    if (head) {
                        const at = childGroup.findIndex((a) => a.option && a.option.getId() === head);
                        if (at > 0) childGroup.unshift(childGroup.splice(at, 1)[0]);
                    }
                    const childSpec = childSpecOf(childAppend ? childAppend[child] : undefined);
                    if (childGroup.length === 0 && !specHasNodes(childSpec)) continue;
                    // Prepend nodes lead the child's fieldset, before its option items.
                    const childItems = [];
                    for (const node of childSpec.prepend) childItems.push(node);
                    const gate = roleGates.filter((g) => g && g.child === child)[0];
                    const childActive = isChildActive(child);
                    if (!childActive) {
                        const label = (gate && gate.label) || childTitle(child);
                        childItems.push({
                            type: 'help',
                            helpvalue: 'Inactive — set the ' + label + ' API URL to enable these options.',
                            notitle: true,
                            // NB: htmlClass (not fieldHtmlClass) — jsonform
                            // only puts fieldHtmlClass on the <input> itself,
                            // while the wrapper div reads htmlClass.
                            htmlClass: 'option-inactive-notice'
                        });
                    }
                    OptionFormBuilder._emitEntries(childGroup, engine, schema, childItems);
                    // Child-level appended nodes render after this child's own options.
                    for (const node of childSpec.append) childItems.push(node);
                    items.push({
                        type: 'fieldset',
                        title: childTitle(child),
                        htmlClass: 'option-role-group option-role-' + child +
                            (childActive ? '' : ' option-role-inactive'),
                        expandable: !!collapsible,
                        items: childItems
                    });
                }
                // Any parent-level (no child) options land first inside the parent.
                const parentLevel = group.filter((a) => a.child === undefined);
                if (parentLevel.length) {
                    items.unshift({
                        type: 'fieldset',
                        title: 'General',
                        htmlClass: 'option-role-group option-role-general',
                        expandable: !!collapsible,
                        items: OptionFormBuilder._emitEntries(parentLevel, engine, schema)
                    });
                }
            }
            else {
                // No child axis here, so the section renders its options directly. A single-child
                // section still honours headOf: the child key is the only child present, so the
                // promotion must not silently stop working just because the wrapper happens to
                // resolve one child (which keeps the layout identical if a sibling is added later).
                const onlyChild = distinctChildren.size === 1 ? [...distinctChildren][0] : undefined;
                const head = onlyChild ? headOf[onlyChild] : undefined;
                if (head) {
                    const at = group.findIndex((a) => a.option && a.option.getId() === head);
                    if (at > 0) group.unshift(group.splice(at, 1)[0]);
                }
                OptionFormBuilder._emitEntries(group, engine, schema, items);
            }

            // Optional section intro text, always shown at the top of the section.
            if (section.help) {
                items.unshift({
                    type: 'help',
                    helpvalue: '<div class="option-section-help-text">' + section.help + '</div>',
                    notitle: true,
                    htmlClass: 'option-section-help'
                });
            }
            // Optional trailing nodes for this section (e.g. an action button).
            for (const node of appendNodes) items.push(node);
            // Optional lead-in nodes go in front of everything, directly under the legend.
            if (sectionLead && sectionLead.length) items.unshift(...sectionLead);

            form.push({
                type: 'fieldset',
                title: section.title,
                // `defaultExpanded` sections are collapsible but start open
                // (options.js expands this class on render and after a filter clears).
                htmlClass: 'option-section option-section-' + section.key +
                    (section.defaultExpanded ? ' option-section-default-expanded' : ''),
                // A section can opt out of the global collapse (e.g. a section
                // that must be visible without a click at all).
                expandable: (typeof section.expandable === 'boolean') ? section.expandable : !!collapsible,
                items
            });

            if (append && append.afterSection === section.key && append.nodes) {
                for (const node of append.nodes) form.push(node);
            }
        }

        // Options whose parent wasn't in `sections` (shouldn't happen, but be safe).
        const orphans = annotated.filter((a) => !(a.parent in sectionIndex));
        if (orphans.length) {
            form.push({
                type: 'fieldset',
                title: 'Other Options',
                htmlClass: 'option-section option-section-misc',
                expandable: !!collapsible,
                items: OptionFormBuilder._emitEntries(orphans, engine, schema)
            });
        }

        if (append && Array.isArray(append)) {
            for (const node of append) form.push(node);
        }
        else if (append && append.nodes && !append.afterSection) {
            for (const node of append.nodes) form.push(node);
        }

        // Snapshot the factory defaults. renderOptions' assignDefault() later
        // overwrites schema[key].default with the engine's *current* value (so
        // jsonform renders current values), which would otherwise make a
        // "changed from default" comparison meaningless. This snapshot is taken
        // at build time, before any such mutation, and is what callers should
        // diff against.
        const defaults = {};
        for (const key in schema) defaults[key] = schema[key].default;

        return { form, schema, defaults, isChanged, roleGates };
    }

    /**
     * Normalize any value to a stable string for equality comparison. Handles
     * the representation gaps between a factory default and a current value:
     * null/undefined collapse to "", numbers/booleans stringify, and
     * JSON-looking strings are parsed so formatting differences don't matter.
     */
    static canonicalize(v) {
        if (v == null) return "";
        if (typeof v === "string") {
            const t = v.trim();
            if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
                try { return JSON.stringify(JSON.parse(t)); } catch (e) { /* not JSON */ }
            }
            return v;
        }
        if (typeof v === "boolean") return v ? "1" : "0";
        if (typeof v === "number") return String(v);
        try { return JSON.stringify(v); } catch (e) { return String(v); }
    }

    /**
     * Emit jsonform field entries (with their childForms) for a list of
     * annotated options. For each option it:
     *   - pushes the jsonform field entry (with its onChange handler);
     *   - writes the schema entry  schema[id] = { type, title, description, default, ... }
     *     where `default` is the FACTORY default (option.getDefault());
     *   - emits the current value onto the engine as a direct property  engine[id] =
     *     option.getValue()  (this is why engine.getOptions can read `this[id]`, and why
     *     external code can read engine[id] directly).
     * Note: `default` set here is the factory default. It is later overwritten with the
     * engine's CURRENT value by options.translatorMenu.assignDefault() at render time; the
     * untouched factory snapshot is returned separately as `optionsForm.defaults` by build().
     */
    static _emitEntries(annotatedGroup, engine, schema, target) {
        const items = target || [];
        for (const a of annotatedGroup) {
            const option = a.option;
            items.push(OptionFormBuilder.buildFieldEntry(option, engine));
            schema[option.getId()] = {
                type: option.getType(),
                title: option.getName(),
                description: option.getDescription(),
                default: option.getDefault(),
                ...option.getSchemaOptions()
            };
            engine[option.getId()] = option.getValue();
            if (option.getChildForm().length > 0) {
                for (const childForm of option.getChildForm()) {
                    items.push(childForm);
                }
            }
        }
        return items;
    }
}
exports.OptionFormBuilder = OptionFormBuilder;
