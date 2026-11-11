// Drag-and-drop a file onto a window/element, dispatching to supported/unsupported handlers.

const DropFileToWindow = function (elm, options) {
	options ||= {};
	this.options = options;
	this.elm = elm;
	this.supportedFiles;
	this.options.supportedFiles ||= [];
	this.options.onSupportedFileDrop ||= function (filepath) {};
	this.options.onUnsupportedFileDrop ||= function (filepath) {};
	this.options.multipleFile ||= false;
	this.options.hoverText ||= "Drop file here!";
	this.id = "dfw" + (Math.random() + 1).toString(36).substring(7);
};

DropFileToWindow.prototype.addCss = function () {
	if (!$("style.dropFileToWindow").length) {
		const $elm = `<style class="dropFileToWindow">
			[data-draghover]::after {
				position: absolute;
				top: 0;
				left: 0;
				width: 100%;
				height: 100%;
				background: #333333aa;
				color: #fafafa;
				font-weight: bold;
				pointer-events: none;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 1.5em;
				z-index:9999999;
			}
		</style>`;
		$("head").append($elm);
	}

	$(`dropFileToWindow_${this.id}`).remove();
	$("head").append(`<style class="dropFileToWindow_${this.id}">
			[data-dragid=${this.id}][data-draghover]::after {
				content: ${JSON.stringify(this.options.hoverText)};
			}
		</style>`);
	console.log("dropFileToWindow style added");
};

// Prevent the browser default of navigating to a dropped file.
DropFileToWindow.prototype.preventDefault = function () {
	window.ondragover = function (e) { e.preventDefault(); return false; };
	window.ondrop = function (e) { e.preventDefault(); return false; };
};

DropFileToWindow.prototype.init = function ($elm, options) {
	$elm = $elm || this.elm;
	options ||= this.options;

	options.supportedFiles ||= [];
	options.onSupportedFileDrop ||= function () {};
	options.onUnsupportedFileDrop ||= function () {};

	this.preventDefault();
	this.addCss();

	const holder = $($elm)[0];
	holder.setAttribute("data-dragid", this.id);
	const handleClear = function (evt) {
		this.removeAttribute("data-draghover");
	};

	holder.ondragover = function (evt) { this.setAttribute("data-draghover", "true"); return false; };
	holder.ondragleave = function (evt) { handleClear.call(this, evt); return false; };
	holder.ondrop = function (e) {
		e.preventDefault();
		console.log("drop");
		for (let i = 0; i < e.dataTransfer.files.length; ++i) {
			console.log(e.dataTransfer.files[i].path);
			if (options.supportedFiles.includes(nwPath.extname(e.dataTransfer.files[i].path))) {
				console.log("file is supported !");
				options.onSupportedFileDrop.call(this, e.dataTransfer.files[i].path);
				if (!options.multipleFile) break;
			} else {
				console.log("file is not supported !");
				options.onUnsupportedFileDrop.call(this, e.dataTransfer.files[i].path);
			}
		}
		handleClear.call(this, e);
		return false;
	};
};

module.exports = DropFileToWindow;
