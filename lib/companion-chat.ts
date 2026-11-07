import {
  CHAT_REQUEST_REPLY_EVENT, addChatContact, createOrGetSession, hydrateChatStorage,
  isChatStorageHydrated, loadChatContacts, loadChatMessages, pushChatMessage,
  upsertImportedChatMessage, reindexSessionMessageOrdersByTime, type ChatMessage, type ChatSession,
} from "@/lib/chat-storage";
import { chatDb } from "@/lib/chat-db";
import { cancelFollowUp, isBackgroundReplyGenerating, requestBackgroundChatReply } from "@/lib/follow-up-service";
import { hydrateKvDb, kvGet, kvSetAsync } from "@/lib/kv-db";
import { assertOnlineChatMode } from "@/lib/chat-mode";

// Preserve the histories written by the earlier independent companion chat.
const LEGACY_PREFIXES = ["companion_chat_v1_", "companion_chat_v2_"];
const migrating = new Map<string, Promise<ChatSession>>();

export function isCompanionReplyRunning(sessionId: string): boolean {
  const lock = kvGet(`chat-generating:${sessionId}`);
  let activeLock = false;
  try {
    const startedAt = Number(lock && JSON.parse(lock).startedAt);
    activeLock = startedAt > 0 && Date.now() - startedAt < 5 * 60 * 1000;
  } catch { /* An invalid lock is not an active generation. */ }
  return activeLock || isBackgroundReplyGenerating(sessionId);
}

export async function openCompanionSession(characterId: string): Promise<ChatSession> {
  const existing = migrating.get(characterId);
  if (existing) return existing;
  const task = (async () => {
    await Promise.all([hydrateKvDb(), hydrateChatStorage()]);
    if (!isChatStorageHydrated()) throw new Error("聊天记录加载失败，请重新打开后重试。");
    if (!loadChatContacts().some(contact => contact.characterId === characterId)) addChatContact(characterId);
    const session = createOrGetSession(characterId);
    const migrationKey = `companion_chat_migrated_v1_${characterId}`;
    if (!kvGet(migrationKey)) for (const prefix of LEGACY_PREFIXES) {
      try {
        const messages: unknown = JSON.parse(kvGet(prefix + characterId) || "[]");
        if (!Array.isArray(messages)) continue;
        for (const item of messages as ChatMessage[]) {
          if (!item || typeof item.id !== "string" || typeof item.createdAt !== "string"
            || typeof item.content !== "string" || !["user", "assistant", "system"].includes(item.role)) continue;
          upsertImportedChatMessage({ ...item, sessionId: session.id, order: undefined });
        }
      } catch { throw new Error("旧伴宠记录读取失败，请重试；原记录仍保留。"); }
    }
    if (!kvGet(migrationKey)) {
      reindexSessionMessageOrdersByTime(session.id);
      await chatDb.sessions.put(session);
      await chatDb.messages.bulkPut(loadChatMessages(session.id));
      await kvSetAsync(migrationKey, "1");
    }
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
    return session;
  })();
  migrating.set(characterId, task);
  try { return await task; } finally { migrating.delete(characterId); }
}

export function loadCompanionMessages(sessionId: string): ChatMessage[] {
  return loadChatMessages(sessionId);
}

export async function sendCompanionMessage(session: ChatSession, text: string, imageRef?: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  assertOnlineChatMode(session.id);
  if (isCompanionReplyRunning(session.id)) throw new Error("对方正在回复，请稍后再发。");
  cancelFollowUp(session.id);
  pushChatMessage({ sessionId: session.id, role: "user", content: trimmed,
    ...(imageRef ? { mediaType: "image" as const, mediaUrl: imageRef } : {}),
  });
  window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
  const detail: { sessionId: string; characterId: string; handled: boolean; busy?: boolean; completion?: Promise<void> } = {
    sessionId: session.id, characterId: session.contactId, handled: false,
  };
  window.dispatchEvent(new CustomEvent(CHAT_REQUEST_REPLY_EVENT, { detail }));
  if (detail.busy) throw new Error("对方正在回复，消息已发送，请稍后触发回复。");
  if (detail.handled) {
    await detail.completion;
  } else {
    detail.handled = true;
    await requestBackgroundChatReply(session.id);
  }
}
