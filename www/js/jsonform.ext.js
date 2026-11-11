// Custom jsonform field types (htmlsnippet, combobox, tag, selectfile) and a
// fieldset template override. Extends the third-party jsonform library.
// Field-type API: https://github.com/jsonform/jsonform/wiki

const JSONFormExt = {};

JSONFormExt.htmlentities = function (str) {
	var element = document.createElement("div");
	element.textContent = str;
	return element.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

JSONFormExt.init = function () {
	console.log("JSONFormExt.init loaded");
	JSONForm.fieldTypes["htmlsnippet"] = {
		template: '<div class="form-group"><div id="<%=node.id%>"><%=value%></div></div>',
		inputfield: false,
		array: false,
		getElement: function (el) {
			return $(el).parent().get(0);
		},
		onBeforeRender: function (data, node) {},
		onInsert: function (evt, node) {}
	};

	JSONForm.fieldTypes["combobox"] = {
		template: `<div><input type="search" class='form-control<%= (fieldHtmlClass ? " " + fieldHtmlClass : "") %>'name="<%= node.name %>" value="<%= escape(value) %>" id="<%= id %>" aria-label="<%= node.title ? escape(node.title) : node.name %>"<%= (node.disabled? " disabled" : "")%><%= (node.readOnly ? " readonly='readonly'" : "") %><%= (node.schemaElement && (node.schemaElement.step > 0 || node.schemaElement.step == "any") ? " step='" + node.schemaElement.step + "'" : "") %><%= (node.schemaElement && node.schemaElement.minLength ? " minlength='" + node.schemaElement.minLength + "'" : "") %><%= (node.schemaElement && node.schemaElement.maxLength ? " maxlength='" + node.schemaElement.maxLength + "'" : "") %><%= (node.schemaElement && node.schemaElement.required && (node.schemaElement.type !== "boolean") ? " required='required'" : "") %><%= (node.placeholder? " placeholder=" + '"' + escape(node.placeholder) + '"' : "")%> list="<%= id %>_datalist" /><datalist id="<%= id %>_datalist"><%=datalist%></datalist></div>`,
		fieldtemplate: true,
		inputfield: true,
		onBeforeRender: function (data, node) {
			data.datalist = "";
			if (!node.schemaElement?.enum?.length) return;
			const options = [];
			for (let item of node.schemaElement.enum) {
				options.push(`<option value="${JSONFormExt.htmlentities(item)}">`);
			}
			data.datalist = options.join("");
		}
	};

	// Tag field (object type). Backed by Tagify.
	JSONForm.fieldTypes["tag"] = {
		template: `<input type="text" class='jsonform-tags form-control<%= (fieldHtmlClass ? " " + fieldHtmlClass : "") %>'name="<%= node.name %>" value="<%= escape(JSON.stringify(node.value)) %>" id="<%= id %>" aria-label="<%= node.title ? escape(node.title) : node.name %>"<%= (node.disabled? " disabled" : "")%><%= (node.readOnly ? " readonly='readonly'" : "") %><%= (node.schemaElement && (node.schemaElement.step > 0 || node.schemaElement.step == "any") ? " step='" + node.schemaElement.step + "'" : "") %><%= (node.schemaElement && node.schemaElement.minLength ? " minlength='" + node.schemaElement.minLength + "'" : "") %><%= (node.schemaElement && node.schemaElement.maxLength ? " maxlength='" + node.schemaElement.maxLength + "'" : "") %><%= (node.schemaElement && node.schemaElement.required && (node.schemaElement.type !== "boolean") ? " required='required'" : "") %><%= (node.placeholder? " placeholder=" + '"' + escape(node.placeholder) + '"' : "")%> />`,
		fieldtemplate: true,
		inputfield: true,
		onInsert: function (evt, node) {
			const $elm = $(node.el).find(".jsonform-tags");
			const whitelist = node.formElement.whitelist || node.schemaElement.enum || [];
			const enforceWhitelist = node.formElement.enforceWhitelist || false;
			const maxTags = node.formElement.maxTags || Infinity;
			const mode = node.formElement.mode;

			const tagify = new Tagify($elm[0], {
				dropdown: {
					highlightFirst: true
				},
				whitelist: whitelist,
				enforceWhitelist: enforceWhitelist,
				maxTags: maxTags,
				mode: mode,
				originalInputValueFormat: (valuesArr) => {
					const result = [];
					for (let val of valuesArr) {
						result.push(val.value);
					}
					return JSON.stringify(result);
				}
			});
			$elm.data("tagify", tagify);
			console.log("initialized tag elm : ", $elm);
			console.log("node : ", node);
		}
	};

	JSONForm.fieldTypes["selectfile"] = {
		template: `<input type="text" class='jsonform-selectfile form-control<%= (fieldHtmlClass ? " " + fieldHtmlClass : "") %>'name="<%= node.name %>" value="<%= escape(value) %>" id="<%= id %>" accept="<%= node.formElement.accept %>" aria-label="<%= node.title ? escape(node.title) : node.name %>"<%= (node.disabled? " disabled" : "")%><%= (node.readOnly ? " readonly='readonly'" : "") %><%= (node.schemaElement && (node.schemaElement.step > 0 || node.schemaElement.step == "any") ? " step='" + node.schemaElement.step + "'" : "") %><%= (node.schemaElement && node.schemaElement.minLength ? " minlength='" + node.schemaElement.minLength + "'" : "") %><%= (node.schemaElement && node.schemaElement.maxLength ? " maxlength='" + node.schemaElement.maxLength + "'" : "") %><%= (node.schemaElement && node.schemaElement.required && (node.schemaElement.type !== "boolean") ? " required='required'" : "") %><%= (node.placeholder? " placeholder=" + '"' + escape(node.placeholder) + '"' : "")%> />`,
		fieldtemplate: true,
		inputfield: true,
		onInsert: function (evt, node) {
			const $elm = $(node.el).find(".jsonform-selectfile");
			$elm.attr("data-renderdvfield", "this");
			var accept = node.formElement.accept || "*";
			$elm.attr("accept", accept);
			if (node.formElement.multiple) $elm.attr("multiple", "multiple");
			if (node.formElement.directory) $elm.attr("nwdirectory", "nwdirectory");
			if (node.formElement.nwsaveas) $elm.attr("nwsaveas", "nwsaveas");

			const dvFields = new DVField();
			dvFields.renderAll($elm);
		}
	};

	JSONForm.fieldTypes.fieldset.template = `<fieldset class="form-group jsonform-error-<%= keydash %> <% if (elt.expandable) { %>expandable<% } %> <%= elt.htmlClass?elt.htmlClass:"" %>" <% if (id) { %> id="<%= id %>"<% } %>><% if (node.title || node.legend) { %><legend role="treeitem" aria-expanded="false"><%= node.title || node.legend %></legend><% } %><% if (elt.expandable) { %><div class="form-group"><% } %><div class="fieldset-content"><%= children %></div><% if (elt.expandable) { %></div><% } %></fieldset>`;
};
