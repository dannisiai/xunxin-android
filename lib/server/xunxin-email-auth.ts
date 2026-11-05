import { createHmac, randomBytes, randomInt } from "node:crypto";
import { sendShortcutEmail, getShortcutEmailProviderConfig } from "./shortcut-email-service";
import { supabaseRestFetch } from "./supabase-rest";
import { createAccountId, hashPassword } from "./account-auth";

export type EmailCodePurpose = "register" | "login";
export function isAccountEmail(email: string): boolean {
  return email.length <= 254 && /^[a-z0-9_+.-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
}
function secret(): string {
  const value = String(process.env.XUNXIN_EMAIL_CODE_SECRET || "").trim();
  if (value.length < 32) throw new Error("邮箱验证码服务尚未配置，请联系管理员。");
  return value;
}
function digest(value: string): string { return createHmac("sha256", secret()).update(value).digest("hex"); }
function codeHash(email: string, purpose: EmailCodePurpose, code: string): string {
  return digest(`code\0${email}\0${purpose}\0${code}`);
}
export async function sendAccountCode(email: string, purpose: EmailCodePurpose, ip: string): Promise<void> {
  if (!getShortcutEmailProviderConfig()) throw new Error("邮件服务尚未配置，请联系管理员。");
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const result = await supabaseRestFetch<boolean>("rpc/xunxin_issue_email_code", {
    method: "POST", body: JSON.stringify({ p_email: email, p_purpose: purpose,
      p_hash: codeHash(email, purpose, code), p_ip_hash: digest(`ip\0${ip}`) }),
  });
  if (!result.ok) throw new Error("验证码数据库尚未配置，请联系管理员。");
  if (!result.data) throw new Error("发送过于频繁，请稍后再试。");
  await sendShortcutEmail({ to: email, subject: "寻信邮箱验证码", text: `你的寻信${purpose === "register" ? "注册" : "登录"}验证码是：${code}。验证码 10 分钟内有效，请勿转发给他人。`, idempotencyKey: randomBytes(24).toString("hex") });
}
export async function consumeAccountCode(email: string, purpose: EmailCodePurpose, code: string, password: string): Promise<string> {
  const result = await supabaseRestFetch<string>("rpc/xunxin_use_email_code", {
    method: "POST", body: JSON.stringify({ p_email: email, p_purpose: purpose, p_hash: codeHash(email, purpose, code),
      p_user_id: createAccountId(), p_password_hash: purpose === "register" && password ? hashPassword(password) : "email_code_only" }),
  });
  if (!result.ok) throw new Error("验证码数据库尚未配置，请联系管理员。");
  return result.data;
}
