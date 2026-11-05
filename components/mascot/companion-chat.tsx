"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_MESSAGE_PUSHED_EVENT, getChatMessagePreview, type ChatMessage, type ChatSession } from "@/lib/chat-storage";
import { isCompanionReplyRunning, loadCompanionMessages, openCompanionSession, sendCompanionMessage } from "@/lib/companion-chat";

export function CompanionChat({ characterId, name, avatar }: { characterId: string; name: string; avatar: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let sessionId = "";
    const refresh = () => {
      if (!active) return;
      if (!sessionId) return;
      setMessages(loadCompanionMessages(sessionId));
      setRunning(isCompanionReplyRunning(sessionId));
    };
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; message?: ChatMessage }>).detail;
      if (detail?.sessionId === sessionId || detail?.message?.sessionId === sessionId) {
        refresh();
        if (event.type === "followup-fired") window.setTimeout(refresh, 0);
      }
    };
    const events = [CHAT_MESSAGE_PUSHED_EVENT, "chat-messages-updated", "chat-generation-changed", "followup-started", "followup-message-saved", "followup-fired", "chat-bg-complete"];
    events.forEach(event => window.addEventListener(event, onUpdate));
    openCompanionSession(characterId).then(result => {
      if (!active) return;
      sessionId = result.id;
      setSession(result);
      refresh();
      setLoading(false);
    }).catch(() => {
      if (active) { setError("聊天记录加载失败，请重新打开后重试。"); setLoading(false); }
    });
    return () => { active = false; events.forEach(event => window.removeEventListener(event, onUpdate)); };
  }, [characterId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  const send = () => {
    const text = input.trim();
    if (!text || loading || running || sending || !session) return;
    setSending(true);
    setError("");
    void sendCompanionMessage(session, text).then(() => setInput(""))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "发送失败，请重试。"))
      .finally(() => { setSending(false); setRunning(isCompanionReplyRunning(session.id)); });
  };

  return (
    <div className="mascot-chat">
      <div className="mascot-chat-messages" ref={scrollRef}>
        {loading && <div className="mascot-return-hint">正在加载聊天记录…</div>}
        {!loading && messages.length === 0 && <div className="mascot-return-hint">和{name}在这里聊聊吧</div>}
        {messages.filter(item => item.role !== "tool" && getChatMessagePreview(item)).slice(-50).map(item => (
          <div key={item.id} className="mascot-msg" data-role={item.role === "user" ? "user" : "mascot"}>
            {item.role === "assistant" && <img className="mascot-msg-avatar" src={avatar} alt="" />}
            <div className="mascot-msg-bubble">{item.mediaType ? getChatMessagePreview(item) : item.content}</div>
          </div>
        ))}
        {(running || sending) && <div className="mascot-return-hint">{name}正在输入…</div>}
        {error && <div className="mascot-return-hint" role="alert">{error}</div>}
      </div>
      <div className="mascot-chat-row">
        <input className="mascot-chat-input" placeholder={`跟${name}聊聊...`} value={input}
          onChange={event => setInput(event.target.value)} disabled={loading || running || sending || !session}
          onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
        <button className="mascot-chat-send" onClick={send} disabled={loading || running || sending || !session || !input.trim()} aria-label="发送">→</button>
      </div>
    </div>
  );
}
