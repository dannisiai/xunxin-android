import { kvGet, kvSet, registerDynamicPrefix } from "./kv-db";

export const CHAT_OFFLINE_MODE_PREFIX = "chat-offline-mode:";
export const OFFLINE_CHAT_SEND_BLOCKED = "当前为线下模式，不能发送线上消息，请先切换到线上模式。";
registerDynamicPrefix(CHAT_OFFLINE_MODE_PREFIX);

/** Read at the moment of sending, including callbacks created before a mode switch. */
export function isChatOfflineMode(sessionId: string): boolean {
    return kvGet(CHAT_OFFLINE_MODE_PREFIX + sessionId) === "1";
}

export function saveChatOfflineMode(sessionId: string, offline: boolean): void {
    kvSet(CHAT_OFFLINE_MODE_PREFIX + sessionId, offline ? "1" : "0");
}

export function assertOnlineChatMode(sessionId: string): void {
    if (isChatOfflineMode(sessionId)) throw new Error(OFFLINE_CHAT_SEND_BLOCKED);
}
