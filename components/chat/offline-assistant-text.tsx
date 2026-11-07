"use client";

import { memo, useMemo } from "react";
import { BilingualTextBlock, isStandaloneHtmlPreviewContent } from "./message-bubble";

function splitOfflineParagraphs(text: string): string[] {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    const splitPlainText = (value: string) => value
        .split(/\n\s*\n+/)
        .map(part => part.trim())
        .filter(Boolean);

    const parts: string[] = [];
    const fenceRx = /(^|\n)([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\3(?=\n|$)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = fenceRx.exec(normalized)) !== null) {
        const fenceStart = match.index + match[1].length;
        const before = normalized.slice(cursor, fenceStart);
        parts.push(...splitPlainText(before));

        const fencedBlock = normalized.slice(fenceStart, fenceRx.lastIndex).trim();
        if (fencedBlock) parts.push(fencedBlock);
        cursor = fenceRx.lastIndex;
    }

    parts.push(...splitPlainText(normalized.slice(cursor)));
    return parts;
}

export function hasOfflineHtmlPreview(text: string): boolean {
    return splitOfflineParagraphs(text).some(part => isStandaloneHtmlPreviewContent(part));
}

export const OfflineAssistantTextBlock = memo(function OfflineAssistantTextBlock({
    text,
    defaultExpanded,
}: {
    text: string;
    defaultExpanded: boolean;
}) {
    const paragraphs = useMemo(() => splitOfflineParagraphs(text), [text]);
    if (paragraphs.length <= 1) {
        return <BilingualTextBlock text={text} mode="markdown" defaultExpanded={defaultExpanded} htmlFrameVariant="offline" />;
    }
    return (
        <div className="chat-offline-paragraph-stack">
            {paragraphs.map((paragraph, index) => (
                <div className="chat-offline-paragraph" key={`${index}-${paragraph.slice(0, 16)}`}>
                    <BilingualTextBlock text={paragraph} mode="markdown" defaultExpanded={defaultExpanded} htmlFrameVariant="offline" />
                </div>
            ))}
        </div>
    );
});
