// www/core/llmRuntime/lib/Preset.js
//
// RETIRED. This module used to generate the INI "models preset"
// (data/llama/preset.ini) consumed by a single llama.cpp router process launched with
// --models-preset / --models-dir / --models-max.
//
// It is gone because the router ignored a model section's per-model keys (context size, KV
// cache type, speculative decoding, projector, expert overrides, ...): every model was served
// with the router's own settings, so a model's configured context never reached its instance.
//
// Each model is now served by its own llama-server child, launched with that model's own
// resolved settings as real CLI arguments (see ModelArgs.buildModelArgs). There is no preset
// file and no multi-model router argument any more.
"use strict";
