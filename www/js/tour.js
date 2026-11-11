"use strict";
/**
 * tour.js — the very short first-use tour of the translation toolbar.
 *
 * On the first time the editor becomes visible (the intro screen closing), we
 * offer a ~20 second tour: a sequence of speech bubbles pointing at the five
 * workflow buttons, with everything else dimmed. It is offered once
 * (localStorage 'slrTourSeen') and can be replayed from Tools -> Show button tour.
 *
 * Steps are data (selector + text). If a step's target is missing or not
 * visible, that step is skipped, so the tour never points at nothing.
 */
(function () {
	var WORKFLOW = '.toolbar-content[data-id="toolbar-workflow"] ';

	var STEPS = [{
		selector: WORKFLOW + ".button-translationSetup",
		title: "1. Translation Setup",
		text: "Start here. In the Quick Start box at the top of the engine options, fill in the API URL, key and model, then press Test connection. That is all you need - every other option is optional. The built-in default model matches the optional example package of the bundled local runtime, so it works out of the box if you downloaded that; otherwise change it to whatever your endpoint offers."
	}, {
		selector: WORKFLOW + ".glossaryProject",
		title: "2. Glossary (optional)",
		text: "Optional quality step: build a glossary of character and place names first so the translation keeps them consistent. It costs extra tokens, so skip it for a cheap run."
	}, {
		selector: WORKFLOW + ".batch-translate",
		title: "3. Start Translation",
		text: "This translates the whole project in one go - use this instead of translating row by row. Rows are grouped into scene-aware requests automatically."
	}, {
		selector: WORKFLOW + ".wrapProject",
		title: "4. Word Wrap",
		text: "English needs more room than Japanese, so re-break the translated lines to fit the game's message windows before exporting."
	}, {
		selector: WORKFLOW + ".button-export",
		title: "5. Export",
		text: "Finally, write the translated data back into a copy of the game. Press F1 at any time for the full documentation."
	}, {
		selector: '.toolbar-content[data-id="toolbar-tools"] .askDslrBtn',
		title: "6. Ask DSLR",
		text: "Chat with your configured translation model. It reads the documentation for you, so instead of digging through the manual you can just ask how anything here works. It needs a working endpoint from step 1 first - no endpoint, no chat."
	}];

	var els = null;       // { overlay, spotlight, bubble, ... }
	var activeSteps = []; // steps whose target currently exists and is visible
	var index = 0;
	var running = false;

	// The "already seen" flag lives in the app config (data/config.json), not in
	// localStorage: deleting config.json is the documented way to reset the app,
	// and it must bring the tour offer back too.
	function hasSeen() {
		try {
			if (typeof sys !== "undefined" && typeof sys.getConfig === "function") {
				return sys.getConfig("tourSeen") === true;
			}
		} catch (e) { /* config not ready; treat as not seen */ }
		return false;
	}

	function markSeen() {
		try {
			if (typeof sys !== "undefined" && typeof sys.setConfig === "function") {
				sys.setConfig("tourSeen", true);
				if (typeof sys.saveConfig === "function") sys.saveConfig();
			}
		} catch (e) { /* config not writable; the offer may repeat next launch */ }
	}

	function resolveTarget(step) {
		var el = document.querySelector(step.selector);
		if (!el) return null;
		var rect = el.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return null;
		return el;
	}

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (typeof text === "string") node.textContent = text;
		return node;
	}

	// ------------------------------------------------------------------
	// Offer dialog
	// ------------------------------------------------------------------

	function buildOffer() {
		var overlay = el("div", "uiTourOverlay uiTourOfferOverlay");
		var card = el("div", "uiTourBubble uiTourOffer");
		card.appendChild(el("h3", "uiTourTitle", "Want a very short tour?"));
		card.appendChild(el("p", "uiTourText", "It shows what the toolbar buttons do, in about 20 seconds."));
		var btns = el("div", "uiTourBtns");
		var no = el("button", "uiTourSkip", "No thanks");
		var yes = el("button", "uiTourNext", "Show me");
		btns.appendChild(no);
		btns.appendChild(yes);
		card.appendChild(btns);
		overlay.appendChild(card);

		no.addEventListener("click", function () {
			markSeen();
			overlay.remove();
		});
		yes.addEventListener("click", function () {
			markSeen();
			overlay.remove();
			window.uiTour.start();
		});
		return overlay;
	}

	function showOffer() {
		if (hasSeen()) return;
		if (document.querySelector(".uiTourOfferOverlay")) return;
		document.body.appendChild(buildOffer());
	}

	// ------------------------------------------------------------------
	// Tour
	// ------------------------------------------------------------------

	function buildTour() {
		var overlay = el("div", "uiTourOverlay");
		var spotlight = el("div", "uiTourSpotlight");
		var bubble = el("div", "uiTourBubble");

		var stepLabel = el("div", "uiTourStepLabel");
		var title = el("h3", "uiTourTitle");
		var text = el("p", "uiTourText");
		var btns = el("div", "uiTourBtns");
		var skip = el("button", "uiTourSkip", "Skip");
		var nav = el("div", "uiTourNavWrap");
		var back = el("button", "uiTourBack", "Back");
		var next = el("button", "uiTourNext", "Next");
		nav.appendChild(back);
		nav.appendChild(next);
		btns.appendChild(skip);
		btns.appendChild(nav);

		bubble.appendChild(stepLabel);
		bubble.appendChild(title);
		bubble.appendChild(text);
		bubble.appendChild(btns);

		overlay.appendChild(spotlight);
		overlay.appendChild(bubble);

		skip.addEventListener("click", stop);
		back.addEventListener("click", prev);
		next.addEventListener("click", nextStep);
		// Clicks anywhere on the dimmed area advance, except on the bubble.
		overlay.addEventListener("click", function (ev) {
			if (ev.target === overlay || ev.target === spotlight) nextStep();
		});

		return {
			overlay: overlay,
			spotlight: spotlight,
			bubble: bubble,
			stepLabel: stepLabel,
			title: title,
			text: text,
			back: back,
			next: next
		};
	}

	function placeBubble(rect) {
		var bubble = els.bubble;
		var bw = bubble.offsetWidth;
		var bh = bubble.offsetHeight;
		var vw = window.innerWidth;
		var vh = window.innerHeight;
		var top = rect.bottom + 14;
		if (top + bh > vh - 8) top = rect.top - bh - 14;
		if (top < 8) top = Math.max(8, vh - bh - 8);
		var left = rect.left + rect.width / 2 - bw / 2;
		left = Math.max(8, Math.min(left, vw - bw - 8));
		bubble.style.left = left + "px";
		bubble.style.top = top + "px";
	}

	function showStep(i) {
		if (!running || !els) return;
		index = i;
		var step = activeSteps[index];
		var target = resolveTarget(step);
		// Target vanished mid-tour (e.g. a button was hidden): drop it and continue.
		if (!target) {
			activeSteps.splice(index, 1);
			if (activeSteps.length === 0) { stop(); return; }
			if (index >= activeSteps.length) index = activeSteps.length - 1;
			showStep(index);
			return;
		}

		var rect = target.getBoundingClientRect();
		var pad = 4;
		var spot = els.spotlight;
		spot.style.left = (rect.left - pad) + "px";
		spot.style.top = (rect.top - pad) + "px";
		spot.style.width = (rect.width + pad * 2) + "px";
		spot.style.height = (rect.height + pad * 2) + "px";

		els.stepLabel.textContent = (index + 1) + " / " + activeSteps.length;
		els.title.textContent = step.title;
		els.text.textContent = step.text;
		els.back.disabled = index === 0;
		els.next.textContent = (index === activeSteps.length - 1) ? "Done" : "Next";

		// Measure/park the bubble so offsetWidth is valid before positioning.
		els.bubble.style.left = "0px";
		els.bubble.style.top = "0px";
		placeBubble(rect);
	}

	function onResize() {
		if (!running) return;
		showStep(index);
	}

	function onKeyDown(ev) {
		if (!running) return;
		if (ev.key === "Escape") {
			ev.preventDefault();
			stop();
		} else if (ev.key === "ArrowRight" || ev.key === "Enter") {
			ev.preventDefault();
			nextStep();
		} else if (ev.key === "ArrowLeft") {
			ev.preventDefault();
			prev();
		}
	}

	function nextStep() {
		if (!running) return;
		if (index >= activeSteps.length - 1) { stop(); return; }
		showStep(index + 1);
	}

	function prev() {
		if (!running || index <= 0) return;
		showStep(index - 1);
	}

	function start() {
		if (running) return;
		activeSteps = STEPS.filter(function (step) {
			return resolveTarget(step) !== null;
		});
		if (activeSteps.length === 0) return;

		if (!els) els = buildTour();
		document.body.appendChild(els.overlay);
		running = true;
		window.addEventListener("resize", onResize);
		document.addEventListener("keydown", onKeyDown, true);
		showStep(0);
	}

	function stop() {
		if (!running) return;
		running = false;
		window.removeEventListener("resize", onResize);
		document.removeEventListener("keydown", onKeyDown, true);
		if (els && els.overlay.parentNode) els.overlay.parentNode.removeChild(els.overlay);
		markSeen();
	}

	window.uiTour = {
		start: start,
		stop: stop,
		showOffer: showOffer,
		hasSeen: hasSeen,
		maybeOffer: function () {
			if (hasSeen()) return;
			// Wait for any loading overlay (project parsing) to clear so the
			// offer does not pop up on top of the loading screen.
			if (typeof ui !== "undefined" && typeof ui.isLoadingOverlayVisible === "function" && ui.isLoadingOverlayVisible()) {
				setTimeout(window.uiTour.maybeOffer, 1500);
				return;
			}
			showOffer();
		},
		reset: function () {
			try {
				if (typeof sys !== "undefined" && typeof sys.setConfig === "function") {
					sys.setConfig("tourSeen", false);
					if (typeof sys.saveConfig === "function") sys.saveConfig();
				}
			} catch (e) { /* nothing to reset */ }
		}
	};

	// Offer once the editor is first visible: the intro screen covers the
	// toolbar while it is open, so the tour only makes sense after it closes.
	function init() {
		if (typeof ui === "undefined" || typeof $ === "undefined") return;
		// Offer the tour once a project has actually been created or loaded, not
		// when the intro screen closes - the intro also closes when the user just
		// opens the New Project or Open Project dialog, where the toolbar buttons
		// aren't relevant yet.
		$(document).on("projectCreated", function () {
			setTimeout(function () { window.uiTour.maybeOffer(); }, 900);
		});
		$(document).on("projectOpened", function () {
			setTimeout(function () { window.uiTour.maybeOffer(); }, 900);
		});
		$(document).on("click", ".menu-button.tourBtn", function () {
			window.uiTour.start();
		});
	}

	$(document).ready(init);
})();
