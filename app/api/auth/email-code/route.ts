import { NextResponse } from "next/server";
import { normalizeUsername } from "@/lib/server/account-auth";
import { getLoginClientIp } from "@/lib/server/login-rate-limit";
import { isAccountEmail, sendAccountCode } from "@/lib/server/xunxin-email-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeUsername(body?.email);
  const purpose = body?.purpose === "login" ? "login" : body?.purpose === "register" ? "register" : null;
  if (!isAccountEmail(email) || !purpose) return NextResponse.json({ ok: false, error: "请输入有效的邮箱地址。" }, { status: 400 });
  try {
    await sendAccountCode(email, purpose, getLoginClientIp(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "邮件发送失败。";
    return NextResponse.json({ ok: false, error: /频繁|配置/.test(message) ? message : "邮件发送失败，请稍后重试。" }, { status: 503 });
  }
}
