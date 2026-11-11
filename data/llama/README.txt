Bundled Local Runtime - tester notes

Models go in THIS folder only: data/llama/models/. The runtime/ folder beside the
executable is the bundled engine and must NOT contain models.

1. Put GGUF chat models in this folder: data/llama/models/
   (for example a Qwen3 4B Q4_K_M file). No models are included in this build.

2. Drafts, MTP heads and vision projectors are detected automatically from the GGUF file
   content and paired with their target model, so data/llama/drafts.json is OPTIONAL. Detection
   covers DFlash and DSpark drafts, MTP heads (a separate head file, or a head built into the
   model itself) and mmproj vision projectors. A separate draft file, a separate MTP head file
   and a projector are never offered as selectable models; a model that has an MTP head built in
   is not a separate file, and that model itself stays selectable. Most setups need no drafts.json.

   An explicit entry in data/llama/drafts.json still overrides what was detected, for example

   {
     "Qwen3-4B-Q4_K_M.gguf": {
       "draft": "Qwen3-4B-DFlash.gguf",
       "specType": "draft-dflash",
       "specDraftNMax": 2
     }
   }

   The draft GGUF must also be in data/llama/models/ and must come from the same model
   family as the target. specType is "draft-dflash", "draft-dspark" or "draft-mtp".

3. In the app: DSLR engine options -> API URL -> "Start / Use Local Runtime".
   "Runtime Status" shows the state, the backend (CPU or Vulkan), the URL, and the model count.

4. Each model is served by its own llama-server process, started with that model's own
   settings (context length, GPU layers, MoE placement, KV cache type, expert override,
   speculative decoding, projector and chat template) passed as real command-line
   arguments. There is no preset file and no multi-model router. The runtime still listens
   on the same port as before, and clients that ask /props or /v1/models now get the served
   model's real context window instead of a 4096 default.

5. The first request after an idle period is slow because the model reloads. CPU always works;
   a Vulkan-capable GPU is used automatically when present. CUDA and ROCm packs are separate
   downloads and are NOT included in this build.

6. The console launcher "SLR Runtime" (SLR Runtime.sh on Linux, SLR Runtime.cmd on Windows;
   each copy ships only its own platform's launcher, sitting next to the app) serves the
   model without opening SLR Translator, so other programs can use it. It reuses the
   settings from the last start in the editor, so start the runtime there once first. It
   serves on port 1234 by default (the "Local runtime port" option) and refuses to start if
   that port is taken instead of picking another. The console stays quiet unless something
   changes: the status block appears when the state changes, and while the runtime works a
   live line shows the model loading, live prompt processing, live generation counts with
   tokens per second, and draft acceptance, followed by a one-line summary after each
   generation. On Windows the launcher itself runs
   hidden, and SLR Runtime.cmd's console shows its status relayed to it. Ctrl+C stops it -
   at any point, even while the model is still loading - and so does closing the console
   window, on both platforms (on Windows Ctrl+C may not reach the runtime, so close the
   window instead; the launcher notices the console is gone with a short check, so the stop
   can lag the close by up to about two seconds). On Linux, starting it from the desktop
   opens a terminal window automatically, and the window stays open after the runtime stops
   until you press Enter. Starting a different model from the editor takes the console
   runtime over: the editor stops the console launcher and starts the requested model
   itself. "SLR Runtime --stop" stops a runtime left running if the launcher process itself
   was killed outright (Task Manager) or the machine lost power: it stops the left-behind
   server through the record where it can, clears a stale record, and only a live process it
   cannot confirm as the SLR runtime is left alone - end that one manually (Task Manager on
   Windows, "pkill -f llama-server" on Linux) and start normally.

Full documentation: Help menu -> "Bundled Local Runtime".
