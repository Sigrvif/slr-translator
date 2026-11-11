// www/core/docsChat/tests/Markdown.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Markdown = require("../lib/Markdown");

test("XSS: angle brackets and quotes are escaped everywhere", () => {
    const html = Markdown.render("a <img src=x onerror=1> b");
    assert.ok(!html.includes("<img"), "raw tag survived: " + html);
    assert.ok(html.includes("&lt;img"));
});

test("links: http(s) kept, javascript: dropped", () => {
    assert.ok(Markdown.render("[x](https://a.b)").includes('href="https://a.b"'));
    assert.ok(!Markdown.render("[x](javascript:alert(1))").includes("href="));
    assert.ok(Markdown.render("[x](javascript:alert(1))").includes("x"), "link text survives");
});

test("inline formatting: bold, italic, inline code", () => {
    const html = Markdown.render("**bold** and *italic* and `code`");
    assert.ok(/<strong>bold<\/strong>/.test(html), html);
    assert.ok(/<em>italic<\/em>/.test(html), html);
    assert.ok(/<code>code<\/code>/.test(html), html);
});

test("fenced code block: content escaped, wrapped in pre/code", () => {
    const html = Markdown.render("before\n```\nif (a < b) { x(); }\n```\nafter");
    assert.ok(html.includes("<pre><code>"), html);
    assert.ok(html.includes("if (a &lt; b) { x(); }"), "code not escaped: " + html);
    assert.ok(html.includes("before") && html.includes("after"));
});

test("headings map to h4 max so bubbles don't shout", () => {
    assert.ok(/<h4>/.test(Markdown.render("# Title")), "h1 should become h4");
    assert.ok(!/<h1>|<h2>|<h3>/.test(Markdown.render("# A\n## B\n### C")));
});

test("list items render as ul/li", () => {
    const html = Markdown.render("- one\n- two");
    assert.ok(html.includes("<ul>"), html);
    assert.ok(html.includes("<li>one</li>") && html.includes("<li>two</li>"));
});

test("paragraphs: blank lines split, single newlines become br", () => {
    const html = Markdown.render("line one\nline two\n\npara two");
    assert.ok(/line one<br\s*\/?>\s*line two/.test(html) || /line one.*<br.*line two/.test(html), html);
    assert.ok(!/line two.*<br\s*\/?>\s*para two/.test(html.replace(/<\/?p>/g, "")), "blank line must not become br");
});

test("code spanning inline formatting is not mangled", () => {
    const html = Markdown.render("use `**not bold**` here");
    assert.ok(html.includes("<code>**not bold**</code>"), html);
});
