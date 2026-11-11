const FormIOConverter = require("www/js/FormIOConverter.js");
const fic = new FormIOConverter();

class FormBuilder extends require("www/js/BasicEventHandler.js") {
	constructor(defaultSchema) {
		super();
		this.defaultSchema = defaultSchema || {
			display: "form",
			components: [],
			settings: {}
		};
	}
}

FormBuilder.prototype.init = async function (defaultSchema) {
	const self = this;
	if (defaultSchema) this.defaultSchema = defaultSchema;
	defaultSchema = this.defaultSchema;

	var formElement = document.getElementById("formio");
	var jsonElement = document.getElementById("jsonSchema");
	var subJSON = document.getElementById("submittedJson");
	var jsonFormSchema = document.getElementById("jsonFormSchema");

	if (this.builder) {
		console.log("resets builder");
		$(formElement).empty();
		$(jsonElement).empty();
		$(subJSON).empty();
		$(jsonFormSchema).empty();
		this.builder.destroy();
		document.getElementById("builder").innerHTML = "";
	}

	console.log("%cInitializing form builder with schema", "color:yellow", JSON.stringify(defaultSchema, undefined, 2));
	this.builder = await Formio.builder(document.getElementById("builder"), defaultSchema, {
		baseUrl: "/www/modules/formio/",
		noDefaultSubmitButton: true,
		builder: {
			basic: false,
			premium: false,
			advanced: false,
			customBasic: {
				title: "Basic Input",
				default: true,
				weight: 0,
				components: {
					textfield: true,
					textarea: true,
					number: true,
					password: true,
					checkbox: true,
					selectboxes: true,
					select: true,
					radio: true,
					button: true
				}
			},
			customAdvanced: {
				title: "Advanced",
				default: false,
				weight: 10,
				components: {
					email: true,
					url: true,
					tags: true,
					datetime: true,
					day: true,
					time: true,
					survey: true,
					currency: true
				}
			},
			custom: {
				title: "Custom Field",
				default: false,
				weight: 90,
				components: {
					range: true,
					nwfile: true,
					nwfilesimple: true,
					file: true
				}
			}
		}
	});

	await this.builder.ready;
	console.log("Builder ready");

	this.previewJson = new JSONEditor({
		target: document.getElementById("submittedJson"),
		props: {
			mode: "tree",
			readOnly: true,
			content: { json: null }
		}
	});

	this.jsonSchema = new JSONEditor({
		target: document.getElementById("jsonSchema"),
		props: {
			mode: "text",
			content: { json: null },
			onChange: (updatedContent, previousContent, { contentErrors, patchResult }) => {
				console.log("onChange", { updatedContent, previousContent, contentErrors, patchResult });
			}
		}
	});

	this.jsonFormSchema = new JSONEditor({
		target: document.getElementById("jsonFormSchema"),
		props: {
			mode: "text",
			content: { json: null }
		}
	});

	const onForm = (form) => {
		const updatePreview = () => {
			self.previewJson.set({ json: form.submission });
		};
		form.off("change");
		form.on("change", function () {
			updatePreview();
		});
		$("#submitPreview").off("click");
		$("#submitPreview").on("click", function () {
			updatePreview();
		});
	};

	this.buildPreview = async (build) => {
		await this.until("initialized");
		formElement.innerHTML = "";
		Formio.createForm(formElement, this.builder.form).then(onForm);
		console.log("schema", this.builder.schema);
		console.log("form", this.builder.form);
	};

	this.setFormIOSchema = async () => {
		await this.until("initialized");
		console.log("Setting schema", this.builder.schema);
		this.jsonSchema.set({ json: this.builder.schema });
	};

	this.updateFormIOSchema = async (newSchema) => {
		if (!newSchema) {
			if (this.jsonSchema.get().json) {
				newSchema = this.jsonSchema.get().json;
			} else {
				newSchema = JSON.parse(this.jsonSchema.get().text);
			}
		}
		console.log("%cUpdating formIOSchema", "color:green", JSON.stringify(newSchema, undefined, 2));
		if (!newSchema) return console.warn("No schema defined");
		this.init(newSchema);
	};

	this.activateJsonFormTab = async (schema) => {
		await this.until("initialized");
		schema ||= this.builder.schema;
		console.log("activateJsonFormTab()", JSON.stringify(schema, undefined, 2));
		const convertedSchema = fic.formIOtoJSONForm(schema);
		this.jsonFormSchema.set({ json: convertedSchema });
	};

	$("button[data-bs-toggle='tab']").off("shown.bs.tab");
	$("button[data-bs-toggle='tab']").on("shown.bs.tab", async (event) => {
		console.log("Previous tab", event.relatedTarget);
		console.log("Activated tab", event.target);

		const activeTab = $(event.target).attr("id");
		const prevTab = $(event.relatedTarget).attr("id");
		if (prevTab == "nav-home-tab") {
			//buildPreview();
		} else if (prevTab == "nav-json-tab") {
			this.updateFormIOSchema();
			this.unresolveState("initialized");
		}

		if (activeTab == "nav-converter-tab") {
			this.activateJsonFormTab();
		} else if (activeTab == "nav-preview-tab") {
			this.buildPreview();
		} else if (activeTab == "nav-json-tab") {
			this.setFormIOSchema();
		}
	});

	$("#builder .builder-sidebar [ref='sidebar-search']").off("keyup");
	$("#builder .builder-sidebar [ref='sidebar-search']").on("keyup", function () {
		var value = $(this).val().toLowerCase();
		$("#builder [ref='sidebar-container'] > span").filter(function () {
			$(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
		});
	});

	this.resolveState("initialized");
};

FormBuilder.prototype.submit = async function () {
	try {
		await common.localStorage.set("formIOLastSchema", this.builder.schema);
		window.close();
	} catch (e) {
		console.error("Eror when submitting data", e);
	}
};

FormBuilder.prototype.reset = async function () {
	let conf = confirm("Reset current form?");
	if (!conf) return;
	var defaultSchema = await common.localStorage.get("formIOLastSchema");
	defaultSchema ||= {
		display: "form",
		components: [],
		settings: {}
	};
	this.init(defaultSchema);
};

FormBuilder.prototype.clear = async function () {
	let conf = confirm("Clear current form?");
	if (!conf) return;

	var defaultSchema = {
		display: "form",
		components: [],
		settings: {}
	};
	this.init(defaultSchema);
};

var formBuilder;
$(document).ready(function () {
	void async function () {
		var defaultSchema = await common.localStorage.get("formIOLastSchema");
		if (common.isJSON(defaultSchema)) {
			defaultSchema = JSON.parse(defaultSchema);
		}
		formBuilder = new FormBuilder(defaultSchema);
		await formBuilder.init();

		$("#submit").on("click", function () {
			formBuilder.submit();
		});
		$("#reset").on("click", function () {
			formBuilder.reset();
		});
		$("#clear").on("click", function () {
			formBuilder.clear();
		});
	}();
});
