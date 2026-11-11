// Converts a FormIO schema into a JSONForm schema/form pair.

const FormIOConverter = function () {};

FormIOConverter.typeMap = {
	"textfield": "text",
	"selectboxes": "checkboxes",
	"radio": "radios",
	"well": "section",
	"panel": "fieldset"
};

FormIOConverter.prototype.formIOtoJSONForm = function (formIOSchema) {
	const JSONForm = { schema: {}, form: [] };

	const convertType = (type) => {
		if (FormIOConverter.typeMap[type]) return FormIOConverter.typeMap[type];
		return type;
	};

	if (typeof formIOSchema !== "object") return JSONForm;
	if (Array.isArray(formIOSchema)) {
		formIOSchema = { components: formIOSchema };
	}

	const fetchComponents = (formIOComponents, JSONFormForm, parentComponent) => {
		for (let i in formIOComponents) {
			let thisComponent = formIOComponents[i];
			JSONForm.schema[thisComponent.key] = {
				type: "string",
				title: thisComponent.label,
				default: thisComponent.defaultValue
			};
			let JSONFormSchema = JSONForm.schema[thisComponent.key];

			let thisForm = {};
			thisForm = thisComponent;

			if (thisComponent.validate) {
				if (typeof thisComponent.validate.required !== "undefined") JSONFormSchema.required = thisComponent.validate.required;
			}
			if (thisComponent.attributes) {
				thisForm.htmlMetaData = thisComponent.attributes;
			}
			if (thisComponent.customClass) {
				thisForm.htmlClass = thisComponent.customClass;
			}

			if (["checkbox"].includes(thisComponent.type)) {
				JSONFormSchema.type = "boolean";
				thisForm.inlinetitle = thisComponent.label;
			} else if (["number"].includes(thisComponent.type)) {
				JSONFormSchema.type = "number";
			} else if (["selectboxes"].includes(thisComponent.type)) {
				let thisEnum = [];
				let titleMap = {};
				for (let x in thisComponent.values) {
					let thisKey = thisComponent.values[x].value;
					thisEnum.push(thisKey);
					titleMap[thisKey] = thisComponent.values[x].label;
				}
				JSONFormSchema.items = {
					type: "string",
					title: thisComponent.label,
					enum: thisEnum
				};
				thisForm.titleMap = titleMap;
			} else if (["radio"].includes(thisComponent.type)) {
				let thisEnum = [];
				let titleMap = {};
				for (let x in thisComponent.values) {
					let thisKey = thisComponent.values[x].value;
					thisEnum.push(thisKey);
					titleMap[thisKey] = thisComponent.values[x].label;
				}
				JSONFormSchema.enum = thisEnum;
				thisForm.titleMap = titleMap;
			} else if (["select"].includes(thisComponent.type)) {
				let thisEnum = [];
				let titleMap = {};
				if (thisComponent?.data?.values) {
					for (let x in thisComponent.data.values) {
						let thisKey = thisComponent.data.values[x].value;
						thisEnum.push(thisKey);
						titleMap[thisKey] = thisComponent.data.values[x].label;
					}
				}
				JSONFormSchema.enum = thisEnum;
				thisForm.titleMap = titleMap;
			}

			if (thisComponent.components) {
				thisForm.items = [];
				if (thisForm.key) {
					thisForm.formIOKey = thisForm.key;
					delete thisForm.key;
				}
				fetchComponents(thisComponent.components, thisForm.items, thisComponent);
			}

			if (parentComponent?.type == "tabs") {
				thisForm.type = "tab";
				thisForm.id = thisForm.formIOKey;
			} else {
				thisForm.type = convertType(thisForm.type);
			}

			JSONFormForm.push(thisForm);
		}
		return JSONForm;
	};

	return fetchComponents(formIOSchema.components, JSONForm.form);
};

module.exports = FormIOConverter;
