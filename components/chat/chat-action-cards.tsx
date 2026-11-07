"use client";

import type { ChatMessage } from "@/lib/chat-storage";

export function MemoryWriteRequestCard({
    msg,
    onApprove,
    onIgnore,
}: {
    msg: ChatMessage;
    onApprove: (msg: ChatMessage) => void | Promise<void>;
    onIgnore: (msg: ChatMessage) => void;
}) {
    const status = msg.mediaData?.memoryRequestStatus || "pending";
    const content = msg.mediaData?.memoryContent || msg.content;
    const reason = msg.mediaData?.memoryReason;
    const importance = msg.mediaData?.memoryImportance;
    const statusText = status === "approved" ? "已写入长期记忆" : status === "ignored" ? "已忽略本次写入" : "等待你确认";

    return (
        <div className="w-[280px] rounded-2xl border border-[var(--c-border)] bg-[var(--c-card)]/95 backdrop-blur px-4 py-3 flex flex-col gap-3 ui-bubble-shadow">
            <div className="flex items-center justify-between gap-3">
                <span className="menu-label">对方想记住这件事</span>
                <span className="menu-desc !mt-0 shrink-0">{statusText}</span>
            </div>
            <div className="rounded-xl bg-[var(--c-input)]/70 px-3 py-2">
                <p className="menu-desc !mt-0 leading-6 whitespace-pre-wrap">{content}</p>
            </div>
            {(reason || typeof importance === "number") && (
                <div className="flex flex-col gap-1">
                    {reason && <span className="menu-desc !mt-0">原因：{reason}</span>}
                    {typeof importance === "number" && <span className="menu-desc !mt-0">重要性：{importance.toFixed(2)}</span>}
                </div>
            )}
            {status === "pending" ? (
                <div className="flex gap-2">
                    <button onClick={() => void onApprove(msg)} className="ui-btn ui-btn-primary flex-1">确认写入</button>
                    <button onClick={() => onIgnore(msg)} className="ui-btn ui-btn-outline flex-1">忽略</button>
                </div>
            ) : null}
        </div>
    );
}

export function SystemInstructionCard({ content }: { content: string }) {
    return (
        <>
            <div className="chat-system-instruction-head">
                <span className="chat-system-instruction-title">系统指令</span>
            </div>
            <div className="chat-system-instruction-body">{content}</div>
        </>
    );
}
