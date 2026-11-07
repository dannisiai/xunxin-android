"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { CHAT_DOCUMENT_ACCEPT, CHAT_DOCUMENT_MAX_CHARS, formatDocumentSize, readChatDocument, type PreparedChatDocument } from "@/lib/chat-documents";

export function DocumentInputModal({ onSend, onClose }: {
    onSend: (document: PreparedChatDocument, note: string) => Promise<boolean>;
    onClose: () => void;
}) {
    const [document, setDocument] = useState<PreparedChatDocument | null>(null);
    const [note, setNote] = useState("");
    const [reading, setReading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; controllerRef.current?.abort(); };
    }, []);
    const chooseFile = async (file: File) => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setReading(true); setDocument(null); setError("");
        try {
            const result = await readChatDocument(file, controller.signal);
            if (mountedRef.current && !controller.signal.aborted) setDocument(result);
        } catch (error) {
            if (mountedRef.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : "读取失败，请重试。");
        } finally {
            if (mountedRef.current && !controller.signal.aborted) setReading(false);
        }
    };
    const send = async () => {
        if (!document || reading || sending) return;
        setSending(true); setError("");
        try {
            if (await onSend(document, note.trim())) onClose();
            else if (mountedRef.current) setError("暂时无法发送，请等待当前回复完成后再试。");
        } catch (error) {
            if (mountedRef.current) setError(error instanceof Error ? error.message : "发送失败，请重试。");
        } finally { if (mountedRef.current) setSending(false); }
    };
    const data = document?.metadata;
    return (
        <div className="modal-overlay" onClick={() => { if (!sending) onClose(); }}>
            <div data-adaptive-surface="card" className="modal-dialog chat-document-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-document-title" onClick={event => event.stopPropagation()}>
                <strong id="chat-document-title" className="ts-16">发送文档</strong>
                <button type="button" className="chat-document-picker" disabled={sending} onClick={() => inputRef.current?.click()}>
                    {reading ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                    <span>{reading ? "正在读取文档…" : data ? "重新选择文档" : "选择 Word / TXT / PDF 等文档"}</span>
                    <small>支持 .doc、.docx、.txt、.pdf 等，单个不超过 30 MB</small>
                </button>
                <input ref={inputRef} type="file" accept={CHAT_DOCUMENT_ACCEPT} className="hidden" disabled={sending}
                    onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void chooseFile(file); }} />
                {data && <>
                    <div className="chat-document-info"><FileText size={20} /><span>{data.fileName}<small>{formatDocumentSize(data.fileSize)} · 已读取 {data.documentText.length.toLocaleString()} 字{data.documentPageCount ? ` · ${data.documentReadPages}/${data.documentPageCount} 页` : ""}</small></span></div>
                    {data.documentTruncated && <p className="chat-document-warning" role="status">文档较长，本次仅发送已提取的前 {CHAT_DOCUMENT_MAX_CHARS.toLocaleString()} 字或前 200 页；原文件会完整保留。</p>}
                    <label className="chat-document-field">内容预览<textarea readOnly value={data.documentText} rows={7} /></label>
                    <label className="chat-document-field">想跟他说什么<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="例如：帮我看看这份文档，讲讲你的想法…" rows={2} maxLength={4000} disabled={sending} /></label>
                </>}
                {error && <p role="alert" className="chat-document-error">{error}</p>}
                <div className="flex gap-3 w-full">
                    <button type="button" onClick={onClose} disabled={sending} className="ui-btn ui-btn-ghost ui-btn-bordered-ghost flex-1">取消</button>
                    <button type="button" onClick={() => void send()} disabled={!data || reading || sending} className="ui-btn ui-btn-success flex-1">{sending ? "正在发送…" : "发送"}</button>
                </div>
            </div>
        </div>
    );
}
