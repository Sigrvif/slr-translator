"use strict";
const test = require("node:test");
const assert = require("node:assert");
const health = require("../endpointHealth");

test("cooldownForStreak walks the escalating schedule and caps at the top", () => {
    assert.deepStrictEqual(health.ENDPOINT_COOLDOWN_SCHEDULE,
        [10000, 30000, 60000, 120000, 300000, 900000, 1800000]);
    assert.strictEqual(health.cooldownForStreak(1), 10000);
    assert.strictEqual(health.cooldownForStreak(2), 30000);
    assert.strictEqual(health.cooldownForStreak(3), 60000);
    assert.strictEqual(health.cooldownForStreak(4), 120000);
    assert.strictEqual(health.cooldownForStreak(5), 300000);
    assert.strictEqual(health.cooldownForStreak(6), 900000);
    assert.strictEqual(health.cooldownForStreak(7), 1800000);
    assert.strictEqual(health.cooldownForStreak(8), 1800000);
    assert.strictEqual(health.cooldownForStreak(99), 1800000);
});

test("cooldownForStreak is defensive about bad streaks", () => {
    assert.strictEqual(health.cooldownForStreak(0), 10000);
    assert.strictEqual(health.cooldownForStreak(-5), 10000);
    assert.strictEqual(health.cooldownForStreak(undefined), 10000);
    assert.strictEqual(health.cooldownForStreak(null), 10000);
    assert.strictEqual(health.cooldownForStreak(NaN), 10000);
    assert.strictEqual(health.cooldownForStreak("2"), 30000);
});

test("cooldownRemainingMs never goes negative and tolerates bad input", () => {
    assert.strictEqual(health.cooldownRemainingMs(1000, 500), 500);
    assert.strictEqual(health.cooldownRemainingMs(1000, 1000), 0);
    assert.strictEqual(health.cooldownRemainingMs(1000, 1500), 0);
    assert.strictEqual(health.cooldownRemainingMs(undefined, 500), 0);
    assert.strictEqual(health.cooldownRemainingMs("nope", 500), 0);
    // Missing `now` falls back to the real clock.
    assert.strictEqual(health.cooldownRemainingMs(Date.now() + 5000, undefined) > 0, true);
});

test("isEndpointUnstableStatus covers transport and server failures only", () => {
    // Transport error (no status), timeouts, and 5xx mean the endpoint is not
    // answering -> unstable cooldown.
    assert.strictEqual(health.isEndpointUnstableStatus(""), true);
    assert.strictEqual(health.isEndpointUnstableStatus(undefined), true);
    assert.strictEqual(health.isEndpointUnstableStatus("500"), true);
    assert.strictEqual(health.isEndpointUnstableStatus("502"), true);
    assert.strictEqual(health.isEndpointUnstableStatus("524"), true);
    assert.strictEqual(health.isEndpointUnstableStatus("408"), true);
    // Already handled elsewhere: hard-disable for bad key/URL, 429 cooldown.
    assert.strictEqual(health.isEndpointUnstableStatus("401"), false);
    assert.strictEqual(health.isEndpointUnstableStatus("403"), false);
    assert.strictEqual(health.isEndpointUnstableStatus("404"), false);
    assert.strictEqual(health.isEndpointUnstableStatus("429"), false);
    // A 400 is the endpoint answering with "your request is wrong": cooling the
    // endpoint (and with it the translator) would punish the wrong thing.
    assert.strictEqual(health.isEndpointUnstableStatus("400"), false);
    assert.strictEqual(health.isEndpointUnstableStatus("422"), false);
});
