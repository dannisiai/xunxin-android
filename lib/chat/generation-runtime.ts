import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";
import { throwIfAborted } from "@/lib/abort-utils";

// ── Background generation tracking ──────────────────────────
const GENERATING_PREFIX = "chat-generating:";

const GENERATING_LOCK_TTL_MS = 5 * 60 * 1000;

type PendingNativeToolCall = {
    id: string;
    name: string;
};

type ActiveGenerationRun = {
    runId: string;
    controller: AbortController;
    pendingNativeToolCalls: PendingNativeToolCall[];
};

export type GenerationRunGuard = {
    signal?: AbortSignal;
    isActive?: () => boolean;
};

const activeGenerationRuns = new Map<string, ActiveGenerationRun>();

const activeOfflineGenerationRuns = new Map<string, Omit<ActiveGenerationRun, "pendingNativeToolCalls">>();

export function hasActiveGenerationRun(sessionId: string): boolean {
    return activeGenerationRuns.has(sessionId);
}

export function hasActiveOfflineGenerationRun(sessionId: string): boolean {
    return activeOfflineGenerationRuns.has(sessionId);
}

function generationLockKey(sessionId: string): string {
    return GENERATING_PREFIX + sessionId;
}

export function setGenerationLock(sessionId: string): void {
    kvSet(generationLockKey(sessionId), JSON.stringify({ startedAt: Date.now() }));
    window.dispatchEvent(new CustomEvent("chat-generation-changed", { detail: { sessionId } }));
}

export function clearGenerationLock(sessionId: string): void {
    kvRemove(generationLockKey(sessionId));
    window.dispatchEvent(new CustomEvent("chat-generation-changed", { detail: { sessionId } }));
}

export function hasActiveGenerationLock(sessionId: string): boolean {
    const key = generationLockKey(sessionId);
    const raw = kvGet(key);
    if (!raw) return false;
    let startedAt = 0;
    try {
        const parsed = JSON.parse(raw);
        startedAt = Number(parsed?.startedAt) || 0;
    } catch {
        startedAt = 0;
    }
    if (!startedAt || Date.now() - startedAt > GENERATING_LOCK_TTL_MS) {
        kvRemove(key);
        return false;
    }
    return true;
}

export function createGenerationRun(sessionId: string): ActiveGenerationRun {
    const existing = activeGenerationRuns.get(sessionId);
    existing?.controller.abort();
    const run: ActiveGenerationRun = {
        runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        controller: new AbortController(),
        pendingNativeToolCalls: [],
    };
    activeGenerationRuns.set(sessionId, run);
    return run;
}

export function isGenerationRunActive(sessionId: string, runId: string): boolean {
    const run = activeGenerationRuns.get(sessionId);
    return Boolean(run && run.runId === runId && !run.controller.signal.aborted);
}

export function finishGenerationRun(sessionId: string, runId: string): boolean {
    const run = activeGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return false;
    activeGenerationRuns.delete(sessionId);
    return true;
}

export function trackNativeToolCalls(sessionId: string, runId: string, calls: PendingNativeToolCall[]): void {
    const run = activeGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return;
    const existingIds = new Set(run.pendingNativeToolCalls.map(call => call.id));
    for (const call of calls) {
        if (call.id && !existingIds.has(call.id)) {
            run.pendingNativeToolCalls.push(call);
            existingIds.add(call.id);
        }
    }
}

export function resolveNativeToolCall(sessionId: string, runId: string, toolCallId: string): void {
    const run = activeGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return;
    run.pendingNativeToolCalls = run.pendingNativeToolCalls.filter(call => call.id !== toolCallId);
}

export function cancelGenerationRun(sessionId: string): ActiveGenerationRun | null {
    const run = activeGenerationRuns.get(sessionId);
    if (!run) return null;
    run.controller.abort();
    activeGenerationRuns.delete(sessionId);
    return run;
}

export function isAbortLikeError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException && error.name === "AbortError") return true;
    if (error instanceof Error) {
        return error.name === "AbortError" || /aborted|abort/i.test(error.message);
    }
    return false;
}

export function throwIfGenerationStopped(guard?: GenerationRunGuard): void {
    throwIfAborted(guard?.signal);
    if (guard?.isActive && !guard.isActive()) {
        throw new DOMException("Aborted", "AbortError");
    }
}

export function createOfflineGenerationRun(sessionId: string): Omit<ActiveGenerationRun, "pendingNativeToolCalls"> {
    const existing = activeOfflineGenerationRuns.get(sessionId);
    existing?.controller.abort();
    const run = {
        runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        controller: new AbortController(),
    };
    activeOfflineGenerationRuns.set(sessionId, run);
    return run;
}

export function isOfflineGenerationRunActive(sessionId: string, runId: string): boolean {
    const run = activeOfflineGenerationRuns.get(sessionId);
    return Boolean(run && run.runId === runId && !run.controller.signal.aborted);
}

export function finishOfflineGenerationRun(sessionId: string, runId: string): boolean {
    const run = activeOfflineGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return false;
    activeOfflineGenerationRuns.delete(sessionId);
    return true;
}

export function cancelOfflineGenerationRun(sessionId: string): boolean {
    const run = activeOfflineGenerationRuns.get(sessionId);
    if (!run) return false;
    run.controller.abort();
    activeOfflineGenerationRuns.delete(sessionId);
    return true;
}
