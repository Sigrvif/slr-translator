/* Documentation manifest. Order defines sidebar and prev/next navigation.
   file paths are relative to www/docs/. keywords feed search only. */
window.DOCS_MANIFEST = [
	{ section: "Getting Started", pages: [
		{ id: "overview", title: "Overview & Requirements", file: "pages/overview.html", keywords: "requirements system what is slr" },
		{ id: "translator-setup", title: "Translator Setup", file: "pages/translator-setup.html", keywords: "sugoi dslr llm api endpoint server setup" },
		{ id: "locale", title: "Japanese Locale Configuration", file: "pages/locale.html", keywords: "locale unicode japanese system region" },
		{ id: "first-project", title: "Your First Translation Project", file: "pages/first-project.html", keywords: "parse translate inject apply walkthrough project" }
	]},
	{ section: "RPG Maker Engines", pages: [
		{ id: "engine-detection", title: "Engine Detection", file: "pages/engine-detection.html", keywords: "detect identify engine project type" },
		{ id: "mv", title: "RPG Maker MV", file: "pages/mv.html", keywords: "rmmv mv" },
		{ id: "mz", title: "RPG Maker MZ", file: "pages/mz.html", keywords: "rmmz mz" },
		{ id: "ace", title: "RPG Maker VX Ace", file: "pages/ace.html", keywords: "rmvxace vx ace rgss3" },
		{ id: "vx", title: "RPG Maker VX", file: "pages/vx.html", keywords: "rmvx vx rgss2" },
		{ id: "xp", title: "RPG Maker XP", file: "pages/xp.html", keywords: "rmxp xp rgss1" },
		{ id: "encrypted-games", title: "Encrypted & Packed Games", file: "pages/encrypted-games.html", keywords: "encrypted enigma decrypter archive packed exe" }
	]},
	{ section: "Translation Editor", pages: [
		{ id: "editor-basics", title: "Editor Basics", file: "pages/editor-basics.html", keywords: "grid cells edit rows table columns selection" },
		{ id: "cell-info-panel", title: "Cell Info Panel", file: "pages/cell-info-panel.html", keywords: "cell info panel original romaji furigana reading raw json yaml snippet data tree beautified editor markers emblems coordinate" },
		{ id: "color-tags", title: "Cell Color Tags", file: "pages/color-tags.html", keywords: "color tags cell status meaning legend purple mediumpurple indigo" },
		{ id: "context-translation", title: "Context Translation", file: "pages/context-translation.html", keywords: "context translate selected match all words" },
		{ id: "word-wrap", title: "Automatic Word Wrapping", file: "pages/word-wrap.html", keywords: "word wrap wrapping line break message window readable stint size wrapped column 3" },
		{ id: "scene-graph", title: "Scene Graph", file: "pages/scene-graph.html", keywords: "scene graph dialogue tracing grouping context batch scenes speakers" },
		{ id: "find-replace", title: "Find & Replace", file: "pages/find-replace.html", keywords: "find replace search filter regex" },
		{ id: "notes", title: "File Notes", file: "pages/notes.html", keywords: "notes comments per file" },
		{ id: "spellcheck", title: "Spell Checking", file: "pages/spellcheck.html", keywords: "spellcheck spelling offline english" },
		{ id: "rikaikun", title: "Japanese Dictionary Popup", file: "pages/rikaikun.html", keywords: "rikaikun dictionary hover popup japanese" }
	]},
	{ section: "Translation Engines", pages: [
		{ id: "engines-overview", title: "Options Overview", file: "pages/engines-overview.html", keywords: "engines translators options overview selection" },
		{ id: "sugoi", title: "Sugoi Translator", file: "pages/sugoi.html", keywords: "sugoi server localhost offline" },
		{ id: "dslr", title: "DSLR Translator", file: "pages/dslr.html", keywords: "dslr endpoint parallel endpoints concurrent concurrency multiple endpoints several accounts add endpoint weight rotation load balancing templates local koboldcpp lm studio ollama kv cache radix sglang prefix caching review translations purple mediumpurple auto-fix qc judge glossary reject missing terms glossarydiff" },
		{ id: "local-runtime", title: "Bundled Local Runtime", file: "pages/local-runtime.html", keywords: "local runtime llama.cpp llama-server bundled offline gguf dflash dspark speculative vulkan cuda rocm cpu vram unload moe mixture of experts experts offload ngl gpu layers partial offload split mode tensor split main gpu kv unified kv offload prompt cache reuse progress loading prompt processing autostart auto start tokens per second throughput tok/s status window always on top expert experts per token expert_used_count override-kv metadata override chat template jinja chat-template tokenizer.chat_template template editor cuda pack linux cuda build nvidia download install rocm not included self contained offline gpu acceleration rocm pack rocm6 windows 10 windows 11 bring your own rocm runfile installer hip sdk extra library folder ld_library_path glibc system requirements ubuntu debian arch endeavouros load mode load-mode mmap mlock dio sleep idle seconds unload after idle models kept loaded resident threads thread count cpu threads threads-batch hyperthreading physical cores macos standalone console slr runtime launcher command line port 1234 stop attach other programs MTP mmproj projector vision DSpark DFlash draft detection per-model server per-model settings context window /props role fallback model glossary model review model model switch model-switch wait wait idle seconds in-flight generation evict parallel parallel slots --parallel concurrency concurrent requests context sharing queue slots reasoning thinking KV cache type batch size draft probability F16" },
		{ id: "llm-apis", title: "LLM & Online APIs", file: "pages/llm-apis.html", keywords: "llm api online provider nano-gpt cloud openai compatible" },
		{ id: "batch", title: "Batch Translation", file: "pages/batch.html", keywords: "batch translate all automatic queue" },
		{ id: "glossary", title: "Glossary Extractor", file: "pages/glossary.html", keywords: "glossary names terms extract consistent reject missing enforce glossarydiff" }
	]},
	{ section: "Images", pages: [
		{ id: "sep", title: "SEP Picture Translation", file: "pages/sep.html", keywords: "sep ocr picture image redraw pp-ocr gpu webgpu directml acceleration" }
	]},
	{ section: "Automation & Extending", pages: [
		{ id: "script-editor", title: "Script Editor", file: "pages/script-editor.html", keywords: "script editor javascript code" },
		{ id: "automation-editor", title: "Automation Editor", file: "pages/automation-editor.html", keywords: "automation for each row script loop" },
		{ id: "custom-parsers", title: "Custom Parsers & Model Creator", file: "pages/custom-parsers.html", keywords: "custom parser regex javascript model creator pmc" },
		{ id: "addons", title: "User Addons", file: "pages/addons.html", keywords: "addon install extend package builtin engine game parser detect export createproject docs documentation manual page" }
	]},
	{ section: "Reference", pages: [
		{ id: "errors", title: "Error Codes", file: "pages/errors.html", keywords: "error codes troubleshooting shisaye" },
		{ id: "escape-codes", title: "Escape & Text Codes", file: "pages/escape-codes.html", keywords: "escape codes control characters text codes" },
		{ id: "general-settings", title: "General Settings", file: "pages/general-settings.html", keywords: "options general settings preferences" },
		{ id: "faq", title: "FAQ & Tips", file: "pages/faq.html", keywords: "faq tips tricks common questions settings stored location portable appdata localappdata config profile" },
		{ id: "ask-dslr", title: "Ask DSLR a Question", file: "pages/ask-dslr.html", keywords: "chat ask question assistant llm docs manual help persona" },
		{ id: "about", title: "About, Credits & License", file: "pages/about.html", keywords: "about credits license gpl donation" }
	]}
];
