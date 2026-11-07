"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { formatDocumentSize, type StoredChatDocument } from "@/lib/chat-documents";
import { loadMediaBlob, isMediaStoreRef } from "@/lib/media-cache-storage";
import { downloadFile, downloadUrl } from "@/lib/download-utils";

export function ChatDocumentCard({ document, note }: { document: StoredChatDocument; note?: string }) {
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const data = document.metadata;
    const save = async () => {
        if (saving) return;
        setSaving(true); setError("");
        try {
            if (!document.mediaUrl) throw new Error("原文件已被清理，仍可查看已提取的正文。");
            if (isMediaStoreRef(document.mediaUrl)) {
                const stored = await loadMediaBlob(document.mediaUrl);
                if (!stored) throw new Error("原文件已被清理，仍可查看已提取的正文。");
                const shell = (window as Window & { AndroidShell?: { saveDocumentFile?: (base64: string, name: string, mime: string) => void } }).AndroidShell;
                if (shell?.saveDocumentFile) {
                    const encoded = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result).split(",")[1]);
                        reader.onerror = () => reject(new Error("读取原文件失败。"));
                        reader.readAsDataURL(stored.blob);
                    });
                    shell.saveDocumentFile(encoded, data.fileName, data.fileMime);
                } else if (navigator.userAgent.includes("FloatShell/")) {
                    throw new Error("请更新安卓小手机后保存原文件，已提取的正文仍可查看。");
                } else await downloadFile(stored.blob, data.fileName);
            } else await downloadUrl(document.mediaUrl, data.fileName);
        } catch (error) { setError(error instanceof Error ? error.message : "保存失败。"); }
        finally { setSaving(false); }
    };
    return (
        <div className="chat-document-card" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
            <div className="chat-document-info"><FileText size={28} /><span>{data.fileName}<small>{formatDocumentSize(data.fileSize)} · {data.documentText.length.toLocaleString()} 字{data.documentTruncated ? " · 节选" : ""}</small></span>
                <button type="button" className="ui-bare-btn" aria-label={`保存 ${data.fileName}`} disabled={saving} onClick={() => void save()}><Download size={18} /></button>
            </div>
            {note?.trim() && <p className="chat-document-note">{note}</p>}
            <details><summary>查看文档内容</summary><pre>{data.documentText}</pre></details>
            {error && <p role="alert" className="chat-document-error">{error}</p>}
        </div>
    );
}
