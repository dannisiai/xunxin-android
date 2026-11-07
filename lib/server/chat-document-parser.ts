import { CHAT_DOCUMENT_MAX_CHARS, CHAT_DOCUMENT_MAX_PAGES, type ChatDocumentMetadata } from "../chat-documents";
import { decodeTxtArrayBuffer } from "../reading-parser";

/** Text cleanup and PDF page traversal adapted from SillyTavern (AGPL-3.0).
 * https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/utils.js
 * See docs/document-attachments.md and the project's LICENSE / NOTICE.
 */
function normalizeDocumentText(text: string): string {
    return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, " ")
        .replace(/\u00a0/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .replace(/\n{4,}/g, "\n\n\n").replace(/ {2,}/g, " ").trim();
}

export async function parseChatDocument(file: File): Promise<ChatDocumentMetadata> {
    const fileName = file.name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, "").slice(0, 240);
    const extension = fileName.split(".").pop()?.toLowerCase();
    const buffer = await file.arrayBuffer();
    let text = "";
    let truncated = false;
    let pageCount: number | undefined;
    let readPages: number | undefined;
    let mime = file.type || "text/plain";

    if (extension === "pdf") {
        if (!Buffer.from(buffer).subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("文件内容不是有效的 PDF。");
        const { getDocumentProxy } = await import("unpdf");
        // The bundled PDF.js runs in Node / Android without native canvas or a CDN.
        const pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false, useSystemFonts: false });
        try {
            pageCount = pdf.numPages;
            readPages = 0;
            const pages: string[] = [];
            let length = 0;
            for (let number = 1; number <= Math.min(pdf.numPages, CHAT_DOCUMENT_MAX_PAGES); number++) {
                const page = await pdf.getPage(number);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
                pages.push(pageText);
                readPages = number;
                length += pageText.length;
                page.cleanup();
                if (length > CHAT_DOCUMENT_MAX_CHARS) break;
            }
            text = pages.join("\n\n");
            truncated = readPages < pdf.numPages;
            if (!text.trim()) throw new Error("这份 PDF 没有可提取的文字，可能是扫描件。请先进行文字识别，或将需要看的页面作为图片发送。");
        } finally { await pdf.destroy(); }
        mime = "application/pdf";
    } else if (extension === "doc" || extension === "docx") {
        const { default: WordExtractor } = await import("word-extractor");
        const document = await new WordExtractor().extract(Buffer.from(buffer));
        text = [document.getBody(), document.getFootnotes(), document.getEndnotes()].filter(Boolean).join("\n\n");
        mime = extension === "doc" ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else {
        const bytes = new Uint8Array(buffer);
        const hasBom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
        if (hasBom) text = decodeTxtArrayBuffer(buffer).text;
        else {
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
            catch { text = decodeTxtArrayBuffer(buffer, "gb18030").text; }
        }
        if (/\u0000/.test(text)) throw new Error("这个文件不是可读取的文字文档。");
    }
    text = normalizeDocumentText(text);
    if (!text) throw new Error("文档中没有可读取的文字。");
    const characters = text.length;
    truncated ||= characters > CHAT_DOCUMENT_MAX_CHARS;
    return {
        fileName, fileSize: file.size, fileMime: mime,
        documentText: text.slice(0, CHAT_DOCUMENT_MAX_CHARS), documentTruncated: truncated,
        documentCharacters: characters, documentPageCount: pageCount, documentReadPages: readPages,
    };
}
