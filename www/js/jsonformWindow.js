var initForm = async function () {
	var formSchema = {};
	$("#mainForm").jsonForm(formSchema);
};

$(document).ready(function () {
	initForm();
});
