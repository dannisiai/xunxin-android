import type { ChatMessage } from "@/lib/chat-storage";
import { parseAIResponse, type ParsedMessagePart } from "@/lib/rich-message-parser";

const CALL_SYS_RE = /\[我(?:向.+)?(?:发起了|挂断了|拒绝了|取消了)(?:群?(?:语音|视频)通话)/;

function isCallSysMsg(msg: ChatMessage): boolean {
    return CALL_SYS_RE.test(msg.content);
}

const ACTION_MEDIA_TYPES = new Set(["poke", "accept_red_packet", "decline_red_packet", "accept_transfer", "decline_transfer", "accept_payment_request", "decline_payment_request", "group_admin_notice"]);

export function canCarryFoldedPanel(part: { content?: string; mediaType?: ChatMessage["mediaType"] }): boolean {
    if (part.mediaType === "poke" || part.mediaType === "group_admin_notice") return false;
    return !CALL_SYS_RE.test(part.content || "");
}

export function uiRole(msg: ChatMessage): string {
    if (msg.role === "system" || ACTION_MEDIA_TYPES.has(msg.mediaType || "")) return "system";
    if (isCallSysMsg(msg)) return "system";
    return msg.role;
}

export type RenderChatMessage = ChatMessage & {
    displayProjected?: boolean;
    displaySourceId?: string;
};

type DisplayProjectionOptions = {
    dedupedMessages: ChatMessage[];
    renderDisplayText: (text: string, placement: 1 | 2 | 5 | 6, isOffline: boolean) => string;
    normalizeDisplayParts: (parts: ParsedMessagePart[]) => ParsedMessagePart[];
};

/** Build display-only bubbles while keeping stored message IDs and metadata. */
export function projectChatDisplayMessages({ dedupedMessages, renderDisplayText, normalizeDisplayParts }: DisplayProjectionOptions): RenderChatMessage[] {
    const batches = new Map<string, ChatMessage[]>();
    for (const msg of dedupedMessages) {
        if (msg.role !== "assistant" || !msg.responseBatchId || !msg.rawResponseText?.trim()) continue;
        const key = `${msg.responseRoundId || ""}\x1f${msg.responseBatchId}\x1f${msg.rawResponseText}`;
        const batch = batches.get(key) || [];
        batch.push(msg);
        batches.set(key, batch);
    }

    const projected: RenderChatMessage[] = [];
    const consumedBatchKeys = new Set<string>();
    for (const msg of dedupedMessages) {
        const batchKey = msg.role === "assistant" && msg.responseBatchId && msg.rawResponseText?.trim()
            ? `${msg.responseRoundId || ""}\x1f${msg.responseBatchId}\x1f${msg.rawResponseText}`
            : "";
        if (!batchKey) {
            projected.push(msg);
            continue;
        }
        if (consumedBatchKeys.has(batchKey)) continue;
        consumedBatchKeys.add(batchKey);

        const batch = batches.get(batchKey) || [msg];
        const raw = batch[0]?.rawResponseText?.trim();
        if (!raw) {
            projected.push(...batch);
            continue;
        }
        const displayRaw = renderDisplayText(raw, 2, false);
        if (displayRaw === raw) {
            projected.push(...batch);
            continue;
        }
        const parsed = parseAIResponse(displayRaw, []);
        const parts = normalizeDisplayParts(parsed.parts);
        // 面板投影到第一条能显示它的消息上（拍一拍/通话留痕是系统小字，没有面板入口）
        const displayMetaIdx = parts.findIndex(canCarryFoldedPanel);
        const storedMeta = batch.find(m => m.statusPanel || m.innerMonologue || m.reasoningText || (m.stateValues && m.stateValues.length > 0));
        let metaProjected = false;
        parts.forEach((part, index) => {
            const base = batch[Math.min(index, batch.length - 1)] || batch[0];
            if (!base) return;
            const sourceId = base.id;
            const id = index < batch.length ? sourceId : `${batch[0].id}__display_${index}`;
            const isMetaSlot = index === displayMetaIdx;
            const statusPanelHere = isMetaSlot ? (parsed.statusPanel || storedMeta?.statusPanel) : undefined;
            // 面板从 storedMeta 挪到了别的槽位，戳要跟着面板走：光靠 ...base 展开会取到
            // 槽位那条消息的戳（多半是空的），投影后状态栏就退回原生渲染了。
            const statusRegionModeHere = isMetaSlot && statusPanelHere
                ? (storedMeta?.statusRegionMode ?? base.statusRegionMode)
                : undefined;
            const innerMonologueHere = isMetaSlot ? (parsed.innerMonologue || storedMeta?.innerMonologue) : undefined;
            const reasoningTextHere = isMetaSlot ? storedMeta?.reasoningText : undefined;
            const stateValuesHere = isMetaSlot ? storedMeta?.stateValues : undefined;
            const freshStateValuesHere = isMetaSlot ? storedMeta?.freshStateValues : undefined;
            if (isMetaSlot && (statusPanelHere || innerMonologueHere || reasoningTextHere || (stateValuesHere && stateValuesHere.length > 0))) {
                metaProjected = true;
            }
            // 语音条的 mediaData 里存着播放必需的状态（synthesizedFromText/voiceDuration），
            // 直接用重解析结果整体替换会把它们丢掉，导致气泡永远判定"待重合成"而点不响。
            // 双方都是语音条时按存储值打底、重解析字段覆盖。
            const mediaData = part.mediaType === "audio" && base.mediaType === "audio" && base.mediaData
                ? { ...base.mediaData, ...part.mediaData }
                : part.mediaData;
            projected.push({
                ...base,
                id,
                content: part.content,
                mediaType: part.mediaType,
                mediaData,
                statusPanel: statusPanelHere,
                statusRegionMode: statusRegionModeHere,
                innerMonologue: innerMonologueHere,
                reasoningText: reasoningTextHere,
                stateValues: stateValuesHere,
                freshStateValues: freshStateValuesHere,
                displayProjected: true,
                displaySourceId: sourceId,
            });
        });
        // 投影后没有任何消息驮面板（比如整段只剩拍一拍/通话留痕）→ 补一条空投影消息
        if (!metaProjected && storedMeta) {
            projected.push({
                ...storedMeta,
                id: `${batch[0].id}__display_meta`,
                content: "",
                mediaType: undefined,
                mediaData: undefined,
                displayProjected: true,
                displaySourceId: storedMeta.id,
            });
        }
    }
    return projected;
}

/** Group consecutive call records for the collapsed transcript UI. */
export function groupChatCallMessages(projectedMessages: RenderChatMessage[]) {
    const groups: { startId: string; startIdx: number; endIdx: number; duration: string; callType: "voice" | "video" }[] = [];
    const memberSet = new Set<number>();

    let i = 0;
    while (i < projectedMessages.length) {
        const msg = projectedMessages[i];
        if (uiRole(msg) !== "system") { i++; continue; }
        // Detect call START precisely: "发起了语音通话" / "发起了视频通话"
        const isVoiceStart = msg.content.includes("发起了语音通话");
        const isVideoStart = msg.content.includes("发起了视频通话");
        if (isVoiceStart || isVideoStart) {
            const callType = isVideoStart ? "video" : "voice";
            const kw = isVideoStart ? "视频通话" : "语音通话";
            let endIdx = -1;
            let duration = "";
            for (let j = i + 1; j < projectedMessages.length; j++) {
                if (uiRole(projectedMessages[j]) !== "system") continue;
                const c = projectedMessages[j].content;
                // Another call start → separate call, stop
                if (c.includes("发起了语音通话") || c.includes("发起了视频通话")) break;
                // Call end: 挂断/拒绝/取消（兼容"群语音通话"/"群视频通话"）
                if (c.includes(`挂断了${kw}`) || c.includes(`挂断了群${kw}`) || c.includes(`拒绝了${kw}`) || c.includes(`拒绝了群${kw}`) || c.includes(`取消了${kw}`) || c.includes(`取消了群${kw}`)) {
                    endIdx = j;
                    const match = c.match(/时长\s*(\d+:\d+)/);
                    duration = match ? match[1] : "";
                    break;
                }
            }
            if (endIdx > i) {
                groups.push({ startId: msg.id, startIdx: i, endIdx, duration, callType });
                for (let k = i; k <= endIdx; k++) memberSet.add(k);
                i = endIdx + 1;
                continue;
            }
        }
        i++;
    }
    return { groups, memberSet };
}
