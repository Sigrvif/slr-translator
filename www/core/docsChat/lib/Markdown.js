// www/core/docsChat/lib/Markdown.js
// Minimal, safe-by-construction markdown renderer for chat bubbles.
// Everything is HTML-escaped FIRST; only then are markdown constructs turned
// into markup, and links only get an href when the target is http(s).
// No dependency, no THIRD-PARTY-NOTICES churn (deliberate — see spec §6.3).
"use strict";

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Inline markdown on already-escaped text. Inline code is extracted first so its
// contents are never further formatted.
function renderInline(escaped) {
    const codeSlots = [];
    let text = escaped.replace(/`([^`]+)`/g, (m, code) => {
        codeSlots.push("<code>" + code + "</code>");
        return "\u0000CODE" + (codeSlots.length - 1) + "\u0000";
    });
    text = text
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
            const trimmed = url.trim();
            if (/^https?:\/\//i.test(trimmed)) {
                return '<a href="' + trimmed + '" target="_blank" rel="noreferrer">' + label + "</a>";
            }
            return label; // non-http link: keep the text, drop the href
        });
    text = text.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => codeSlots[Number(i)]);
    return text;
}

function render(text) {
    const escaped = escapeHtml(text);
    // Fenced code blocks first: their content is already escaped and must not be
    // touched again. Swap them out for placeholders.
    const blocks = [];
    let src = escaped.replace(/```(?:[a-zA-Z0-9+-]*)\n?([\s\S]*?)```/g, (m, code) => {
        blocks.push("<pre><code>" + code.replace(/\n$/, "") + "</code></pre>");
        return "\u0000BLOCK" + (blocks.length - 1) + "\u0000";
    });

    const out = [];
    const lines = src.split("\n");
    const paragraphs = [];
    let current = [];
    const flushParagraph = () => {
        if (current.length) {
            paragraphs.push(current);
            current = [];
        }
    };
    for (const line of lines) {
        if (/^\s*$/.test(line)) { flushParagraph(); continue; }
        current.push(line);
    }
    flushParagraph();

    for (const para of paragraphs) {
        // A lone fenced-block placeholder stands on its own, unwrapped.
        if (para.length === 1 && /^\u0000BLOCK\d+\u0000$/.test(para[0])) {
            out.push(para[0]);
            continue;
        }
        // A paragraph made entirely of list items becomes a ul.
        if (para.every((line) => /^\s*-\s+/.test(line))) {
            const items = para.map((line) => "<li>" + renderInline(line.replace(/^\s*-\s+/, "")) + "</li>");
            out.push("<ul>" + items.join("") + "</ul>");
            continue;
        }
        // A single-line heading (any paragraph whose first line starts with #).
        const heading = para[0].match(/^(#{1,6})\s+(.*)$/);
        if (heading && para.length === 1) {
            out.push("<h4>" + renderInline(heading[2]) + "</h4>");
            continue;
        }
        out.push("<p>" + para.map(renderInline).join("<br>") + "</p>");
    }

    let html = out.join("\n");
    html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
    return html;
}

module.exports = { render: render, escapeHtml: escapeHtml };
