import { NextResponse } from "next/server";
import { CHAT_DOCUMENT_EXTENSIONS, CHAT_DOCUMENT_MAX_BYTES } from "@/lib/chat-documents";
import { parseChatDocument } from "@/lib/server/chat-document-parser";
import { getCurrentAccount } from "@/lib/server/account-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
    try {
        if (!await getCurrentAccount(request)) return NextResponse.json({ error: "请先登录再发送文档。" }, { status: 401 });
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "请求来源不匹配，请重新打开聊天。" }, { status: 403 });
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.startsWith("multipart/form-data")) return NextResponse.json({ error: "请选择文档文件。" }, { status: 400 });
        const maxBodySize = CHAT_DOCUMENT_MAX_BYTES + 128 * 1024;
        const reader = request.body?.getReader();
        if (!reader) return NextResponse.json({ error: "没有收到文档。" }, { status: 400 });
        const chunks: ArrayBuffer[] = [];
        let size = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maxBodySize) {
                    await reader.cancel();
                    return NextResponse.json({ error: "单个文档不能超过 30 MB。" }, { status: 413 });
                }
                chunks.push(value.slice().buffer as ArrayBuffer);
            }
        } finally { reader.releaseLock(); }
        const form = await new Response(new Blob(chunks), { headers: { "content-type": contentType } }).formData();
        const file = form.get("file");
        if (!file || typeof file === "string" || !file.size) return NextResponse.json({ error: "文件为空，请重新选择。" }, { status: 400 });
        if (file.size > CHAT_DOCUMENT_MAX_BYTES) return NextResponse.json({ error: "单个文档不能超过 30 MB。" }, { status: 413 });
        if (!CHAT_DOCUMENT_EXTENSIONS.includes(file.name.split(".").pop()?.toLowerCase() || "")) return NextResponse.json({ error: "暂不支持这种文件格式。" }, { status: 415 });
        const document = await parseChatDocument(file);
        return NextResponse.json({ document }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        const message = error instanceof Error ? error.message : "文档读取失败。";
        const password = error instanceof Error && (error.name === "PasswordException" || /password|encrypt/i.test(message));
        return NextResponse.json({ error: password ? "文档受密码保护，请先解锁后再发送。" : `无法读取文档：${message}` }, { status: 422 });
    }
}
