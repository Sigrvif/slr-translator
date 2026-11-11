const debounce = require("debounce");

const RenderForm = function ($wrapper, options = {}) {
	this.wrapper = $wrapper || $("#formWrapper");
	this.options = options || {};
	this.schema = this.options.schema || {};
	this.previewElm = $("#preview");

	this.registerSubmission = async () => {
		this.previewElm.text(JSON.stringify(this.form.submission, undefined, 2));
	};

	this.init = async () => {
		this.schema = await common.localStorage.get("formIOLastSchema");
		this.value = await common.localStorage.get("formIOLastValue");
		this.form = await Formio.createForm(this.wrapper[0], this.schema);
		this.form.submission = this.value || {};

		this.form.on("change", async (changed) => {
			debounce(this.registerSubmission, 200)(changed);
		});
	};

	this.init();
};

RenderForm.prototype.submit = async function () {
	var data;
	try {
		data = await this.form.submit();
		console.log("Submitted data", data);
		await common.localStorage.set("formIOLastValue", data);
		window.close();
	} catch (e) {
		console.error("Eror when submitting data", e);
	}
};

var renderForm;
$(document).ready(function () {
	renderForm = new RenderForm();

	$("#submit").on("click", function () {
		renderForm.submit();
	});
});
