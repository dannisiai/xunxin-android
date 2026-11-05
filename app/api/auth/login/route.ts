import { NextResponse } from "next/server";

import {
  ACCOUNT_SESSION_COOKIE,
  ACCOUNT_SESSION_MAX_AGE_SECONDS,
  cleanAccountText,
  createSession,
  findUserByUsername,
  isValidUsername,
  normalizeUsername,
  toPublicAccount,
  touchUserLogin,
  verifyPassword,
} from "@/lib/server/account-auth";
import { isAccountEmail, consumeAccountCode } from "@/lib/server/xunxin-email-auth";
import { ACCOUNT_GATE_COOKIE } from "@/lib/account-cookie-constants";
import { createAccountGateCookieValue } from "@/lib/account-gate-cookie";
import {
  getLoginClientIp,
  loginLockedMinutes,
  recordLoginFailure,
} from "@/lib/server/login-rate-limit";
import { formatSupabaseRestError, getSupabaseServerConfig } from "@/lib/server/supabase-rest";

function authSetupError(message: string): string {
  if (/app_users|activation_codes|app_sessions|schema cache|does not exist|PGRST/i.test(message)) {
    return "账号表尚未创建：请先在 Supabase SQL Editor 执行 docs/account-supabase.sql。";
  }
  return formatSupabaseRestError(message);
}

export async function POST(request: Request) {
  try {
    if (!getSupabaseServerConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase 环境变量未配置。" }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const username = normalizeUsername(record.username);
    const password = cleanAccountText(record.password, 120);
    const emailCode = cleanAccountText(record.emailCode, 20);
    const useCode = record.method === "code" || record.mode === "register";
    const mode = record.mode === "register" ? "register" : record.mode === "login" ? "login" : "legacy";

    if (!isValidUsername(username)) {
      return NextResponse.json({ ok: false, error: "请输入有效的邮箱或已有账号。" }, { status: 400 });
    }
    if (useCode && !isAccountEmail(username)) {
      return NextResponse.json({ ok: false, error: "请输入有效的邮箱地址。" }, { status: 400 });
    }
    if ((mode === "register" && password && password.length < 6) || (!useCode && password.length < 6)) {
      return NextResponse.json({ ok: false, error: "密码至少需要 6 位。" }, { status: 400 });
    }
    if (useCode && !/^\d{6}$/.test(emailCode)) {
      return NextResponse.json({ ok: false, error: "请输入 6 位邮箱验证码。" }, { status: 400 });
    }
    const clientIp = getLoginClientIp(request);
    const lockedMinutes = loginLockedMinutes(clientIp);
    if (lockedMinutes > 0) {
      return NextResponse.json({ ok: false, error: `失败次数过多，请约 ${lockedMinutes} 分钟后再试。` }, { status: 429 });
    }

    let user;
    if (useCode) {
      const result = await consumeAccountCode(username, mode === "register" ? "register" : "login", emailCode, password);
      if (result === "exists") return NextResponse.json({ ok: false, error: "该邮箱已注册，请直接登录。" }, { status: 409 });
      if (result === "disabled") return NextResponse.json({ ok: false, error: "账号已被停用。" }, { status: 403 });
      if (result === "invalid" || result === "missing" || !result?.startsWith("acct_")) {
        recordLoginFailure(clientIp);
        return NextResponse.json({ ok: false, error: "验证码无效、已过期，或账号不存在。" }, { status: 401 });
      }
      user = await findUserByUsername(username);
    } else {
      user = await findUserByUsername(username);
      if (!user || !verifyPassword(password, cleanAccountText(user.password_hash, 300))) {
        recordLoginFailure(clientIp);
        return NextResponse.json({ ok: false, error: "账号或密码错误。" }, { status: 401 });
      }
      if (user.status === "disabled") return NextResponse.json({ ok: false, error: "账号已被停用。" }, { status: 403 });
    }
    if (!user) return NextResponse.json({ ok: false, error: "账号数据异常。" }, { status: 500 });

    const publicAccount = toPublicAccount(user);
    if (!publicAccount) {
      return NextResponse.json({ ok: false, error: "账号数据异常。" }, { status: 500 });
    }
    await touchUserLogin(publicAccount.id);
    const session = await createSession(publicAccount.id, request);
    const response = NextResponse.json({ ok: true, account: publicAccount, expiresAt: session.expiresAt });
    const gateCookie = await createAccountGateCookieValue(session.token, ACCOUNT_SESSION_MAX_AGE_SECONDS);
    response.cookies.set(ACCOUNT_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ACCOUNT_SESSION_MAX_AGE_SECONDS,
    });
    if (gateCookie) {
      response.cookies.set(ACCOUNT_GATE_COOKIE, gateCookie, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ACCOUNT_SESSION_MAX_AGE_SECONDS,
      });
    }
    return response;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authSetupError(err instanceof Error ? err.message : String(err)) },
      { status: getSupabaseServerConfig() ? 400 : 503 },
    );
  }
}
