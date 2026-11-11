// www/core/llmRuntime/tests/AllocFallback.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const AllocFallback = require("../lib/AllocFallback");

// The reporter's actual failed start (b10964, win-x64, Vulkan, GTX 1080 8 GB): a dense
// gemma-4 12B whose fit announced a reduction it never applied. Every line below is verbatim
// from that child's stderr, so the parser is tested against the real wording.
const REPORTER_TAIL = [
    "0.02.049.024 I common_params_fit_impl: projected to use 8065 MiB of device memory vs. 7502 MiB of free device memory",
    "0.02.049.026 I common_params_fit_impl: cannot meet free memory target of 512 MiB, need to reduce device memory by 1075 MiB",
    "0.02.049.027 I common_params_fit_impl: context size set by user to 32768 -> no change",
    "0.03.054.739 I load_tensors: offloaded 49/49 layers to GPU",
    "0.03.054.745 I load_tensors:      Vulkan0 model buffer size =  6870.13 MiB",
    "0.03.054.746 I load_tensors:  Vulkan_Host model buffer size =  1020.00 MiB",
    "0.05.378.825 I llama_kv_cache:    Vulkan0 KV buffer size =   272.00 MiB",
    "0.05.395.592 I llama_kv_cache_iswa: creating     SWA KV cache, size = 4608 cells",
    "ggml_vulkan: Device memory allocation of size 802160640 failed.",
    "ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory",
    "0.05.395.919 E alloc_tensor_range: failed to allocate Vulkan0 buffer of size 802160640",
    "0.05.401.136 E llama_init_from_model: failed to initialize the context: failed to allocate buffer for kv cache",
    "0.05.401.863 E srv  llama_server: exiting due to model loading error"
].join("\n");

test("isAllocFailure recognises each backend's out-of-memory wording", () => {
    assert.strictEqual(AllocFallback.isAllocFailure(REPORTER_TAIL), true);
    assert.strictEqual(AllocFallback.isAllocFailure("ggml_vulkan: Device memory allocation of size 802160640 failed."), true);
    assert.strictEqual(AllocFallback.isAllocFailure("CUDA error: out of memory"), true);
    assert.strictEqual(AllocFallback.isAllocFailure("hipErrorOutOfMemory"), true, "the backend symbols themselves are signatures");
    assert.strictEqual(AllocFallback.isAllocFailure("llama-server: exiting due to model loading error"), false);
    assert.strictEqual(AllocFallback.isAllocFailure(""), false);
    assert.strictEqual(AllocFallback.isAllocFailure(null), false);
});

test("parseFitLines reads the fit's own numbers from a failed tail", () => {
    const parsed = AllocFallback.parseFitLines(REPORTER_TAIL);
    assert.strictEqual(parsed.reduceMiB, 1075);
    assert.strictEqual(parsed.projectedMiB, 8065);
    assert.strictEqual(parsed.freeMiB, 7502);
    assert.strictEqual(parsed.placedLayers, 49);
    assert.strictEqual(parsed.totalLayers, 49);
    // The target's device buffer (6870.13), not the smaller Vulkan_Host one (1020.00).
    assert.strictEqual(parsed.modelBufferMiB, 6870.13);
    // Everything absent from a tail stays null rather than guessed.
    const empty = AllocFallback.parseFitLines("nothing here");
    assert.deepStrictEqual(empty, {
        reduceMiB: null, projectedMiB: null, freeMiB: null,
        placedLayers: null, totalLayers: null, modelBufferMiB: null
    });
});

// 1075 MiB at 6870.13/49 = 140.2 MiB per layer is 7.7 layers: ceil to 8, 49 - 8 = 41 - the
// layer count that was verified by hand to start this exact model on this exact card.
test("computeFallbackGpuLayers derives the layer count the reporter's card needed", () => {
    const plan = AllocFallback.computeFallbackGpuLayers(REPORTER_TAIL, { gpuLayers: "auto" });
    assert.ok(plan, "a retry must be derivable from the reporter's tail");
    assert.strictEqual(plan.layers, 41);
    assert.strictEqual(plan.current, 49);
    assert.strictEqual(plan.dropped, 8);
    assert.ok(Math.abs(plan.perLayerMiB - 6870.13 / 49) < 0.001);
});

// The verifier's own trans.log: the failing child's FINAL fit line targeted the engine's own
// 1024 MiB headroom (that start carried no --fit-target), so its final "need to reduce" said
// 1587, not 1075 - the retry then lands on 37 layers: more conservative than the hand-verified
// 41, but a placement that fits with room to spare. Multiple trial lines exist in one tail;
// the parser must take the last, not the first (the earliest trial asked for even more).
test("parseFitLines takes the final fit decision, and the real tail's numbers work too", () => {
    const realTail = [
        "0.01.159.890 I operator(): getting device memory data for the extra model at a context size of 32768:",
        "0.01.992.879 E llama_init_from_model: failed to initialize the context: Gemma4Assistant requires ctx_other to be set (this warning is normal during memory fitting)",
        "0.02.072.937 W operator(): failed to measure the memory of the extra model, fitting without it: failed to create llama_context from model",
        "0.02.043.658 I common_params_fit_impl: projected to use 8065 MiB of device memory vs. 7502 MiB of free device memory",
        "0.02.043.659 I common_params_fit_impl: cannot meet free memory target of 1024 MiB, need to reduce device memory by 1587 MiB",
        "0.03.015.927 I load_tensors: offloaded 49/49 layers to GPU",
        "0.03.015.934 I load_tensors:      Vulkan0 model buffer size =  6870.13 MiB",
        "0.03.015.935 I load_tensors:  Vulkan_Host model buffer size =  1020.00 MiB",
        "ggml_vulkan: Device memory allocation of size 802160640 failed.",
        "ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory",
        "0.05.401.863 E srv  llama_server: exiting due to model loading error"
    ].join("\n");
    const parsed = AllocFallback.parseFitLines(realTail);
    assert.strictEqual(parsed.reduceMiB, 1587);
    assert.strictEqual(parsed.projectedMiB, 8065);
    assert.strictEqual(parsed.freeMiB, 7502);
    assert.strictEqual(parsed.modelBufferMiB, 6870.13);
    const plan = AllocFallback.computeFallbackGpuLayers(realTail, { gpuLayers: "auto" });
    assert.ok(plan);
    assert.strictEqual(plan.layers, 37);
    assert.strictEqual(plan.dropped, 12);
});

test("computeFallbackGpuLayers lowers a manual layer count from its own value", () => {
    const plan = AllocFallback.computeFallbackGpuLayers(REPORTER_TAIL, { gpuLayers: 45 });
    assert.strictEqual(plan.layers, 37);
    // A manual count already at the failed placement is still reduced.
    const fromPlaced = AllocFallback.computeFallbackGpuLayers(REPORTER_TAIL, { gpuLayers: 49 });
    assert.strictEqual(fromPlaced.layers, 41);
});

test("computeFallbackGpuLayers refuses what it cannot compute or cannot salvage", () => {
    // Not an allocation failure: no retry.
    assert.strictEqual(AllocFallback.computeFallbackGpuLayers("exiting due to model loading error", { gpuLayers: "auto" }), null);
    // An allocation failure without placement numbers: nothing honest to derive.
    const bare = "ggml_vulkan: Device memory allocation of size 1 failed.\nvk::Device::allocateMemory: ErrorOutOfDeviceMemory";
    assert.strictEqual(AllocFallback.computeFallbackGpuLayers(bare, { gpuLayers: "auto" }), null);
    // A reduction that would empty the GPU is a CPU start - the user's decision, not a fallback.
    const tiny = [
        "load_tensors: offloaded 2/49 layers to GPU",
        "load_tensors: Vulkan0 model buffer size = 280.00 MiB",
        "common_params_fit_impl: need to reduce device memory by 1075 MiB",
        "ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory"
    ].join("\n");
    assert.strictEqual(AllocFallback.computeFallbackGpuLayers(tiny, { gpuLayers: "auto" }), null);
    assert.strictEqual(AllocFallback.computeFallbackGpuLayers(tiny, { gpuLayers: 1 }), null);
});

test("computeFallbackGpuLayers falls back to projected-vs-free when the reduce line is absent", () => {
    const tail = [
        "common_params_fit_impl: projected to use 8065 MiB of device memory vs. 7502 MiB of free device memory",
        "load_tensors: offloaded 49/49 layers to GPU",
        "load_tensors: Vulkan0 model buffer size =  6870.13 MiB",
        "ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory"
    ].join("\n");
    const plan = AllocFallback.computeFallbackGpuLayers(tail, { gpuLayers: "auto" });
    assert.ok(plan);
    // 563 MiB over at 140.2 MiB/layer = 4.02 -> ceil 5 layers dropped.
    assert.strictEqual(plan.dropped, 5);
    assert.strictEqual(plan.layers, 44);
});

test("failureAdvice names the knob and a starting value from the failed placement", () => {
    const advice = AllocFallback.failureAdvice(REPORTER_TAIL, { gpuLayers: "auto" });
    assert.match(advice, /GPU ran out of memory/);
    assert.match(advice, /'GPU layers'/);
    assert.match(advice, /49 layers/);
    // Only allocation failures get advice; anything else stays a plain error.
    assert.strictEqual(AllocFallback.failureAdvice("exiting due to model loading error", {}), "");
    assert.strictEqual(AllocFallback.failureAdvice("", {}), "");
});
