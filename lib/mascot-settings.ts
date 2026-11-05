import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { MASCOT_PERSONA } from "./mascot-prompts";
import { getActiveCompanion } from "./mascot-state";

export const MASCOT_SETTINGS_KEY = "ai_phone_mascot_settings_v1";
export const DEFAULT_MASCOT_DISPLAY_NAME = "AI助手";
export const DEFAULT_MASCOT_AVATAR = "/mascot.png";

export type MascotSettings = {
    nickname: string;
    avatarImage?: string;
    personaPrompt: string;
    chatEnabled: boolean;
    chatBackgroundImage?: string;
    chatCustomCSS?: string;
};

export const DEFAULT_MASCOT_SETTINGS: MascotSettings = {
    nickname: DEFAULT_MASCOT_DISPLAY_NAME,
    avatarImage: DEFAULT_MASCOT_AVATAR,
    personaPrompt: MASCOT_PERSONA,
    chatEnabled: true,
    chatBackgroundImage: "",
    chatCustomCSS: "",
};

registerKvMigration(MASCOT_SETTINGS_KEY);

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSettings: MascotSettings = DEFAULT_MASCOT_SETTINGS;

function normalizeMascotSettings(raw: unknown): MascotSettings {
    const src = (raw && typeof raw === "object") ? raw as Partial<MascotSettings> : {};
    const nickname = typeof src.nickname === "string" && src.nickname.trim()
        ? src.nickname.trim()
        : DEFAULT_MASCOT_DISPLAY_NAME;
    const personaPrompt = typeof src.personaPrompt === "string" && src.personaPrompt.trim()
        ? src.personaPrompt
        : MASCOT_PERSONA;
    return {
        ...DEFAULT_MASCOT_SETTINGS,
        ...src,
        nickname,
        personaPrompt,
        chatEnabled: src.chatEnabled !== false,
        avatarImage: typeof src.avatarImage === "string" && src.avatarImage.trim() ? src.avatarImage : DEFAULT_MASCOT_AVATAR,
        chatBackgroundImage: typeof src.chatBackgroundImage === "string" ? src.chatBackgroundImage : "",
        chatCustomCSS: typeof src.chatCustomCSS === "string" ? src.chatCustomCSS : "",
    };
}

export function loadMascotSettings(): MascotSettings {
    if (typeof window === "undefined") return DEFAULT_MASCOT_SETTINGS;
    const raw = kvGet(MASCOT_SETTINGS_KEY);
    if (raw === cachedRaw) return cachedSettings;
    cachedRaw = raw;
    if (!raw) {
        cachedSettings = DEFAULT_MASCOT_SETTINGS;
        return cachedSettings;
    }
    try {
        cachedSettings = normalizeMascotSettings(JSON.parse(raw));
    } catch {
        cachedSettings = DEFAULT_MASCOT_SETTINGS;
    }
    return cachedSettings;
}

export function getMascotSettingsSnapshot(): MascotSettings {
    return loadMascotSettings();
}

export function subscribeMascotSettings(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function saveMascotSettings(settings: MascotSettings): MascotSettings {
    const normalized = normalizeMascotSettings(settings);
    cachedSettings = normalized;
    cachedRaw = JSON.stringify(normalized);
    if (typeof window !== "undefined") {
        kvSet(MASCOT_SETTINGS_KEY, cachedRaw);
        window.dispatchEvent(new CustomEvent("mascot-settings-updated", { detail: normalized }));
    }
    for (const listener of listeners) listener();
    return normalized;
}

export function updateMascotSettings(updates: Partial<MascotSettings>): MascotSettings {
    return saveMascotSettings({ ...loadMascotSettings(), ...updates });
}

export function getMascotPersonaPrompt(): string {
    const companion = getActiveCompanion();
    if (companion) {
        return [
            `你现在是「${companion.name}」，已作为用户的桌面伴宠贴身陪伴在手机屏幕旁。`,
            `【你的性格与设定】`,
            companion.persona || "温柔体贴，善解人意，随时陪伴在用户身边。",
            companion.personality ? `【性格特质】\n${companion.personality}` : "",
            companion.briefPersona ? `【角色简述】\n${companion.briefPersona}` : "",
            `【伴宠陪伴守则】`,
            `1. 完全以「${companion.name}」的第一人称、语气和口吻与用户聊天互动，绝对不要脱离角色人设（不要声称自己是普通的系统AI助手）。`,
            `2. 作为贴身伴宠，你的回复宜简短生动、亲切富有陪伴感（通常1~3句话，适合悬浮小抽屉中阅读）。`,
            `3. 展现出你与用户之间的默契与关怀。当用户需要执行手机操作或询问其它内容时，你仍以「${companion.name}」的口吻为用户解答或协助。`,
        ].filter(Boolean).join("\n\n");
    }
    const settings = loadMascotSettings();
    return settings.personaPrompt.trim() || MASCOT_PERSONA;
}

export async function resolveMascotImageRef(ref: string | undefined, fallback = DEFAULT_MASCOT_AVATAR): Promise<string> {
    const value = (ref || "").trim();
    if (!value) return fallback;
    if (
        value.startsWith("/")
        || value.startsWith("data:")
        || value.startsWith("http://")
        || value.startsWith("https://")
        || value.startsWith("blob:")
    ) {
        return value;
    }
    if (value.startsWith("media-store://")) {
        try {
            const { loadMediaObjectUrl } = await import("./media-cache-storage");
            return await loadMediaObjectUrl(value) || fallback;
        } catch {
            return fallback;
        }
    }
    try {
        const { getChatImageFromIndexedDB } = await import("./chat-asset-storage");
        return await getChatImageFromIndexedDB(value) || fallback;
    } catch {
        return fallback;
    }
}
