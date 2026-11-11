"use strict";
// Per-endpoint health math, shared by the translation dispatcher and the
// review layer. Pure so it can be unit-tested: the wrapper that owns the state
// cannot be required outside the app (native dependency).
//
// One escalating cooldown schedule covers both rate limiting (HTTP 429) and
// repeated transport/server failures ("unstable"). A successful request clears
// the streak, so the schedule only grows while failures are consecutive. A
// hard-disabled endpoint (401/403/404) is a separate, permanent state.

const ENDPOINT_COOLDOWN_SCHEDULE = [10000, 30000, 60000, 120000, 300000, 900000, 1800000];

// Cooldown for a 1-based consecutive-failure streak, capped at the longest
// entry. A non-finite, zero, or negative streak reads as the first entry, so an
// unknown caller never starts at a punishing delay.
function cooldownForStreak(streak) {
    const s = Math.max(1, Math.trunc(Number(streak)) || 1);
    return ENDPOINT_COOLDOWN_SCHEDULE[Math.min(s - 1, ENDPOINT_COOLDOWN_SCHEDULE.length - 1)];
}

// Milliseconds left before a cooldown expires; 0 when it is already over or
// `until` is not a finite timestamp.
function cooldownRemainingMs(until, now) {
    const u = Number(until);
    if (!isFinite(u)) return 0;
    const t = isFinite(Number(now)) ? Number(now) : Date.now();
    return Math.max(0, u - t);
}

// Whether a failed request means the endpoint itself is not answering (so a
// cooldown is warranted): a transport error carries no status, and 408/5xx are
// server-side. Bad key/URL (401/403/404) is handled as a permanent disable, 429
// as a rate-limit cooldown, and a 4xx like 400 means the endpoint answered —
// the request was wrong — so the endpoint must not be penalized.
function isEndpointUnstableStatus(status) {
    const s = String(status == null ? "" : status);
    if (s === "") return true;
    if (/^(401|403|404|429)$/.test(s)) return false;
    return s === "408" || /^5\d\d$/.test(s);
}

module.exports = { ENDPOINT_COOLDOWN_SCHEDULE, cooldownForStreak, cooldownRemainingMs, isEndpointUnstableStatus };
