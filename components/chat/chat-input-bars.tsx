"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat-storage";
import type { StoredChatDocument } from "@/lib/chat-documents";
import { EmojiPanel, StickerPanel } from "./emoji-panel";
import { StickerSearchSuggest } from "./sticker-search-suggest";
import { shouldSendChatInputOnEnter } from "@/lib/chat-input-keyboard";
import type { RegisteredCustomAppChatPlusAction } from "@/lib/custom-app-chat-directives";
import { AlertCircle, Blocks, Clapperboard, Gift, X } from "lucide-react";
import { ChatPluginSlot } from "@/components/chat/chat-plugin-slot";

export type RichModalKind = "photo" | "text_photo" | "document" | "red_packet" | "transfer" | "location" | "transfer_target" | "voice_msg" | "gift" | "system_instruction";

export type ChatTextInputHandle = {
    appendText: (text: string, options?: { focus?: boolean }) => void;
    clear: () => void;
};

export type OfflineTextInputHandle = {
    clear: () => void;
    setText: (text: string) => void;
    restoreIfEmpty: (text: string) => void;
};

export const ChatTextInputBar = memo(forwardRef<ChatTextInputHandle, {
    characterName: string;
    characterId: string;
    stickerCharacterIds?: string[];
    isGroup: boolean;
    isSpectator: boolean;
    muteUntilMs: number;
    isGenerating: boolean;
    theaterMode: boolean;
    enterToSendEnabled: boolean;
    quotingMessage: ChatMessage | null;
    showEmojiPanel: boolean;
    showStickerPanel: boolean;
    showPlusMenu: boolean;
    customPlusActions: RegisteredCustomAppChatPlusAction[];
    onClearQuote: () => void;
    onToggleOfflineMode: () => void;
    onClosePanels: () => void;
    onToggleEmojiPanel: () => void;
    onToggleStickerPanel: () => void;
    onTogglePlusMenu: () => void;
    onToggleTheaterMode: () => void;
    onCloseTheaterMode: () => void;
    onOpenRichModal: (modal: RichModalKind) => void;
    onOpenCustomPlusAction: (action: RegisteredCustomAppChatPlusAction) => void;
    onStartVideoCall: () => void;
    onStartVoiceCall: () => void;
    onSendText: (text: string, options?: { autoReply?: boolean }) => boolean;
    onStopGeneration: () => void;
    onTriggerAIResponse: () => void;
    onSendSticker: (name: string, url?: string) => void;
}>(function ChatTextInputBar({
    characterName,
    characterId,
    stickerCharacterIds,
    isGroup,
    isSpectator,
    muteUntilMs,
    isGenerating,
    theaterMode,
    enterToSendEnabled,
    quotingMessage,
    showEmojiPanel,
    showStickerPanel,
    showPlusMenu,
    customPlusActions,
    onClearQuote,
    onToggleOfflineMode,
    onClosePanels,
    onToggleEmojiPanel,
    onToggleStickerPanel,
    onTogglePlusMenu,
    onToggleTheaterMode,
    onCloseTheaterMode,
    onOpenRichModal,
    onOpenCustomPlusAction,
    onStartVideoCall,
    onStartVoiceCall,
    onSendText,
    onStopGeneration,
    onTriggerAIResponse,
    onSendSticker,
}, ref) {
    const [inputText, setInputText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    // 表情包搜索联想：ESC/失焦置 true 隐藏，输入变化重新开启
    const [suggestClosed, setSuggestClosed] = useState(false);
    // 围观群/被禁言：输入与富媒体入口全部锁定，只留线下切换和生成按钮
    const [muteNowTick, setMuteNowTick] = useState(() => Date.now());
    useEffect(() => {
        if (!muteUntilMs || muteUntilMs <= Date.now()) return;
        const timer = window.setInterval(() => setMuteNowTick(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, [muteUntilMs]);
    const muteRemainingMs = muteUntilMs > muteNowTick ? muteUntilMs - muteNowTick : 0;
    const inputLocked = isSpectator || muteRemainingMs > 0;

    const resetTextareaHeight = () => {
        if (textareaRef.current) textareaRef.current.style.height = "auto";
    };

    const appendText = useCallback((text: string, options?: { focus?: boolean }) => {
        setInputText(prev => prev + text);
        requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (!ta) return;
            ta.style.height = "auto";
            ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
            if (options?.focus !== false) ta.focus();
        });
    }, []);

    useImperativeHandle(ref, () => ({
        appendText,
        clear: () => {
            setInputText("");
            resetTextareaHeight();
        },
    }), [appendText]);

    const handleSubmit = () => {
        if (inputLocked) return;
        if (isGenerating) {
            onStopGeneration();
            return;
        }
        const trimmed = inputText.trim();
        if (!trimmed) return;
        if (!onSendText(trimmed)) return;
        setInputText("");
        resetTextareaHeight();
        onClosePanels();
    };

    const panelOpen = showEmojiPanel || showStickerPanel || showPlusMenu;
    const suggestCharacterIds = useMemo(
        () => (isGroup ? (stickerCharacterIds || []) : characterId ? [characterId] : []),
        [isGroup, stickerCharacterIds, characterId],
    );
    const suggestEnabled = !inputLocked && !panelOpen && !suggestClosed && inputText.trim().length > 0;
    const plusMenuItems = [
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg>, label: "文档", onClick: () => onOpenRichModal("document") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>, label: "照片墙", onClick: () => onOpenRichModal("photo") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="7" y1="8" x2="17" y2="8" /><line x1="7" y1="12" x2="14" y2="12" /><line x1="7" y1="16" x2="11" y2="16" /></svg>, label: "文字图片", onClick: () => onOpenRichModal("text_photo") },
        { icon: <AlertCircle size={22} strokeWidth={1.5} color="var(--c-text)" />, label: "系统指令", onClick: () => onOpenRichModal("system_instruction") },
        { icon: <Clapperboard size={22} strokeWidth={1.5} color={theaterMode ? "var(--c-icon-active)" : "var(--c-text)"} />, label: "番外指令模式", active: theaterMode, onClick: onToggleTheaterMode },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>, label: "视频通话", onClick: onStartVideoCall },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>, label: "语音通话", onClick: onStartVoiceCall },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>, label: "红包", onClick: () => onOpenRichModal("red_packet") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><text x="12" y="16" textAnchor="middle" fontSize="12" fill="var(--c-text)" stroke="none">¥</text></svg>, label: "转账", onClick: () => onOpenRichModal(isGroup ? "transfer_target" : "transfer") },
        { icon: <Gift size={22} strokeWidth={1.5} color="var(--c-text)" />, label: "礼物", onClick: () => onOpenRichModal("gift") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>, label: "位置", onClick: () => onOpenRichModal("location") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></svg>, label: "语音条", onClick: () => onOpenRichModal("voice_msg") },
        ...customPlusActions.map(action => ({
            icon: action.appIconDataUrl
                ? <span className="chat-plus-custom-app-icon" style={{ backgroundImage: `url(${action.appIconDataUrl})` }} aria-hidden="true" />
                : <Blocks size={22} strokeWidth={1.5} color="var(--c-text)" />,
            label: action.label,
            onClick: () => onOpenCustomPlusAction(action),
        })),
    ];

    return (
        <div className="chat-input-bar chat-room-main-pane flex flex-col" data-ui="input">
            {theaterMode && (
                <div className="chat-theater-mode-strip" role="status">
                    <span className="chat-theater-mode-icon" aria-hidden="true">
                        <Clapperboard size={16} strokeWidth={1.8} />
                    </span>
                    <span className="chat-theater-mode-title">番外指令模式</span>
                    <button
                        type="button"
                        className="chat-theater-mode-close"
                        onClick={onCloseTheaterMode}
                        aria-label="关闭番外指令模式"
                        title="关闭番外指令模式"
                    >
                        <X size={14} strokeWidth={2} />
                    </button>
                </div>
            )}
            {quotingMessage && (
                <div className="chat-quote-bar">
                    <div className="flex-1 ts-12 text-[var(--c-icon)] overflow-hidden text-ellipsis whitespace-nowrap">
                        引用 {quotingMessage.role === "user" ? "你" : characterName}: {quotingMessage.content.slice(0, 40)}
                    </div>
                    <button onClick={onClearQuote} className="ui-bare-btn text-[var(--c-icon)] ts-16 leading-none p-[2px]">✕</button>
                </div>
            )}

            {suggestEnabled && (
                <StickerSearchSuggest
                    query={inputText}
                    characterIds={suggestCharacterIds}
                    onSend={(name, url) => {
                        onSendSticker(name, url);
                        setInputText("");
                        resetTextareaHeight();
                    }}
                    onClose={() => setSuggestClosed(true)}
                />
            )}
            <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={e => {
                    setInputText(e.target.value);
                    setSuggestClosed(false);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onFocus={() => {
                    if (panelOpen) onClosePanels();
                    setSuggestClosed(false);
                }}
                onBlur={() => setSuggestClosed(true)}
                onKeyDown={e => {
                    if (e.key === "Escape") {
                        setSuggestClosed(true);
                        return;
                    }
                    if (shouldSendChatInputOnEnter(e, enterToSendEnabled)) {
                        e.preventDefault();
                        handleSubmit();
                    }
                }}
                enterKeyHint={enterToSendEnabled ? "send" : "enter"}
                className="chat-input-textarea"
                disabled={inputLocked}
                placeholder={inputLocked
                    ? (isSpectator ? "围观中，你不在这个群里" : `禁言中，剩余${Math.ceil(muteRemainingMs / 60000)}分钟`)
                    : (theaterMode ? "写下番外指令..." : undefined)}
            />

            <div className="chat-input-actions">
                <button
                    onClick={onToggleOfflineMode}
                    className="ui-bare-btn text-[var(--c-text)] chat-offline-toggle"
                    aria-label="线下模式"
                    title="线下模式"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z" />
                        <circle cx="12" cy="10" r="3" />
                    </svg>
                </button>
                <button onClick={onToggleEmojiPanel} disabled={inputLocked} className="ui-bare-btn text-[var(--c-text)]" style={inputLocked ? { opacity: 0.35 } : undefined}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <button onClick={onToggleStickerPanel} disabled={inputLocked} className="ui-bare-btn text-[var(--c-text)]" style={inputLocked ? { opacity: 0.35 } : undefined}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /><polyline points="14 3 14 8 21 8" /><path d="M8 13h0" /><path d="M16 13h0" /><path d="M10 17c.5.3 1.2.5 2 .5s1.5-.2 2-.5" /></svg>
                </button>
                <button onClick={onTogglePlusMenu} disabled={inputLocked} className="ui-bare-btn text-[var(--c-text)]" style={inputLocked ? { opacity: 0.35 } : undefined}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                </button>
                <button
                    onMouseDown={event => event.preventDefault()}
                    onClick={handleSubmit}
                    disabled={!isGenerating && (inputLocked || !inputText.trim())}
                    style={inputLocked && !isGenerating ? { opacity: 0.35 } : undefined}
                    className="ui-bare-btn text-[var(--c-text)]"
                    aria-label={isGenerating ? "停止本轮生成" : "发送"}
                    title={isGenerating ? "停止本轮生成" : "发送"}
                >
                    {isGenerating ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <rect x="9" y="9" width="6" height="6" rx="1" />
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    )}
                </button>
                {!isGenerating && (
                    <button
                        onMouseDown={event => event.preventDefault()}
                        className="ui-bare-btn text-[var(--c-text)]"
                        title={!inputLocked && inputText.trim() ? "发送输入框内容并触发回复" : "触发 AI 主动回复"}
                        onClick={() => {
                            const trimmed = inputText.trim();
                            // 输入框已有文字：发送输入框内容并立即触发模型回复（一次按键完成），
                            // 避免「打完字却忘记发送」；没文字时才只触发 AI 主动回复
                            if (!inputLocked && trimmed) {
                                if (!onSendText(trimmed, { autoReply: true })) return;
                                setInputText("");
                                resetTextareaHeight();
                            } else {
                                onTriggerAIResponse();
                            }
                            onClosePanels();
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .963L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                            <path d="M20 3v4" /><path d="M22 5h-4" />
                        </svg>
                    </button>
                )}
            </div>

            {showPlusMenu && (
                <div className="chat-plus-menu">
                    {plusMenuItems.map((item, i) => (
                        <div key={`${item.label}-${i}`} onClick={item.onClick} className="chat-plus-menu-item flex flex-col items-center gap-1.5 cursor-pointer" {...(item.active ? { "data-active": "" } : {})}>
                            <div className="chat-plus-icon-box">
                                {item.icon}
                            </div>
                            <span className="ts-11 text-[var(--c-text)]">{item.label}</span>
                        </div>
                    ))}
                </div>
            )}
            {showPlusMenu && (
                <ChatPluginSlot name="chat.inputToolbar" slotProps={{ isGroup }} className="chat-plugin-input-toolbar" />
            )}

            {showEmojiPanel && (
                <EmojiPanel
                    onSelect={(emoji) => appendText(emoji, { focus: false })}
                    onEffectSend={(text) => {
                        if (inputLocked || isGenerating) return;
                        onSendText(text);
                        onClosePanels();
                    }}
                />
            )}

            {showStickerPanel && (
                <StickerPanel
                    onSend={onSendSticker}
                    characterId={characterId}
                    characterIds={stickerCharacterIds}
                />
            )}
        </div>
    );
}));

export const OfflineTextInputBar = memo(forwardRef<OfflineTextInputHandle, {
    isOfflineGenerating: boolean;
    isSpectator: boolean;
    showEmojiPanel: boolean;
    enterToSendEnabled: boolean;
    onToggleOfflineMode: () => void;
    onCloseEmojiPanel: () => void;
    onToggleEmojiPanel: () => void;
    onOpenDocument: () => void;
    draftDocument: StoredChatDocument | null;
    onRemoveDocument: () => void;
    onSendText: (text: string) => boolean;
    onStopGeneration: () => void;
}>(function OfflineTextInputBar({
    isOfflineGenerating,
    isSpectator,
    showEmojiPanel,
    enterToSendEnabled,
    onToggleOfflineMode,
    onCloseEmojiPanel,
    onToggleEmojiPanel,
    onOpenDocument,
    draftDocument,
    onRemoveDocument,
    onSendText,
    onStopGeneration,
}, ref) {
    const [inputText, setInputText] = useState("");
    const inputTextRef = useRef("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const resetTextareaHeight = () => {
        if (textareaRef.current) textareaRef.current.style.height = "auto";
    };

    const resizeTextarea = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }, []);

    const setTextAndResize = useCallback((text: string) => {
        inputTextRef.current = text;
        setInputText(text);
        requestAnimationFrame(resizeTextarea);
    }, [resizeTextarea]);

    const appendText = useCallback((text: string, options?: { focus?: boolean }) => {
        const nextText = inputTextRef.current + text;
        inputTextRef.current = nextText;
        setInputText(nextText);
        requestAnimationFrame(() => {
            resizeTextarea();
            if (options?.focus !== false) textareaRef.current?.focus();
        });
    }, [resizeTextarea]);

    useImperativeHandle(ref, () => ({
        clear: () => {
            inputTextRef.current = "";
            setInputText("");
            resetTextareaHeight();
        },
        setText: setTextAndResize,
        restoreIfEmpty: (text: string) => {
            if (inputTextRef.current.trim()) return;
            setTextAndResize(text);
        },
    }), [setTextAndResize]);

    const handleSubmit = () => {
        if (isOfflineGenerating) {
            onSendText(inputTextRef.current);
            return;
        }
        const trimmed = inputTextRef.current.trim();
        if (!trimmed && !draftDocument && !isSpectator) return;
        if (!onSendText(trimmed)) return;
        inputTextRef.current = "";
        setInputText("");
        resetTextareaHeight();
    };

    return (
        <div className="chat-input-bar chat-room-main-pane flex flex-col" data-ui="input">
            {draftDocument && <div className="chat-document-draft"><span>待发送：{draftDocument.metadata.fileName}</span><button type="button" onClick={onRemoveDocument} disabled={isOfflineGenerating} aria-label="移除待发送文档">×</button></div>}
            <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={e => {
                    inputTextRef.current = e.target.value;
                    setInputText(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onFocus={() => { if (showEmojiPanel) onCloseEmojiPanel(); }}
                onKeyDown={e => {
                    if (shouldSendChatInputOnEnter(e, enterToSendEnabled)) {
                        e.preventDefault();
                        handleSubmit();
                    }
                }}
                enterKeyHint={enterToSendEnabled ? "send" : "enter"}
                className="chat-input-textarea"
                disabled={isSpectator}
                placeholder={isSpectator ? "围观中，点右侧按钮推进他们的线下互动" : undefined}
            />
            <div className="chat-input-actions">
                <button
                    type="button"
                    onClick={onToggleOfflineMode}
                    disabled={isOfflineGenerating}
                    className="ui-bare-btn text-[var(--c-text)]"
                    aria-label="返回线上模式"
                    title="返回线上模式"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
                        <path d="M8 9h8" />
                        <path d="M8 13h5" />
                    </svg>
                </button>
                <button type="button" onClick={onOpenDocument} disabled={isSpectator || isOfflineGenerating} className="ui-bare-btn text-[var(--c-text)]" aria-label="发送文档" title="发送文档">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg>
                </button>
                <button
                    onClick={onToggleEmojiPanel}
                    disabled={isSpectator}
                    className="ui-bare-btn text-[var(--c-text)]"
                    style={isSpectator ? { opacity: 0.35 } : undefined}
                    aria-label="表情"
                    title="表情"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <button
                    type="button"
                    onClick={() => { if (isOfflineGenerating) onStopGeneration(); else handleSubmit(); }}
                    onMouseDown={event => event.preventDefault()}
                    disabled={!isOfflineGenerating && !isSpectator && !inputText.trim() && !draftDocument}
                    className="ui-bare-btn text-[var(--c-text)]"
                    aria-label={isOfflineGenerating ? "停止线下生成" : "发送"}
                    title={isOfflineGenerating ? "停止线下生成" : "发送"}
                >
                    {isOfflineGenerating ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <rect x="9" y="9" width="6" height="6" rx="1" />
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    )}
                </button>
            </div>
            {showEmojiPanel && (
                <EmojiPanel onSelect={(emoji) => appendText(emoji, { focus: false })} />
            )}
        </div>
    );
}));
