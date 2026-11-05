"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Loader2, ArrowRight, X } from "lucide-react";

import { AccountProvider } from "@/lib/account-context";
import { ACCOUNT_NETWORK_ERROR, fetchCurrentAccount, loginAccount, logoutAccount, saveActiveAccountId, type AccountProfile } from "@/lib/account-client";
import { isSelfHostedModeEnabled } from "@/lib/self-hosting";
import { SplashAnimation } from "@/components/splash-animation";

type AccountGateProps = {
  children: ReactNode;
  onBack?: () => void;
};

type GateStatus = "checking" | "ready" | "signed-out" | "unreachable";

const SELF_HOSTED_ACCOUNT: AccountProfile = {
  id: "local_user",
  username: "local_user",
  displayName: "本地用户",
  status: "active",
};

// 内联兜底：弱网/离线下 SW 可能回退到旧 HTML，外链 CSS 拉不到（旧 hash 已 404），
// 此时全页无样式，「正在校验账号」会裸排在左上角。内联样式不依赖外部 CSS，保证居中。
const gateRootFallbackStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const gatePanelFallbackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  textAlign: "center",
};

export function AccountGate({ children, onBack }: AccountGateProps) {
  const selfHostedMode = isSelfHostedModeEnabled();
  const [status, setStatus] = useState<GateStatus>(selfHostedMode ? "ready" : "checking");
  const [account, setAccount] = useState<AccountProfile | null>(selfHostedMode ? SELF_HOSTED_ACCOUNT : null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [loginMethod, setLoginMethod] = useState<"code" | "password">("code");
  const [sendingCode, setSendingCode] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"register" | "login">("register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refreshAccount() {
    if (selfHostedMode) {
      setAccount(SELF_HOSTED_ACCOUNT);
      saveActiveAccountId(SELF_HOSTED_ACCOUNT.id);
      setStatus("ready");
      setError("");
      return;
    }

    let result: Awaited<ReturnType<typeof fetchCurrentAccount>>;
    try {
      result = await fetchCurrentAccount();
    } catch {
      result = { ok: false, account: null, error: ACCOUNT_NETWORK_ERROR };
    }
    if (result.ok && result.account) {
      setAccount(result.account);
      // 按账号隔离的本地缓存据此判定归属，账号一解析出来就落一份
      saveActiveAccountId(result.account.id);
      setStatus("ready");
      setError("");
      return;
    }
    // 网络层失败（超时/断连/切网）：会话 cookie 还在，不应登出——给重试入口
    if (result.error === ACCOUNT_NETWORK_ERROR) {
      setStatus("unreachable");
      return;
    }
    setAccount(null);
    saveActiveAccountId("");
    setStatus("signed-out");
    if (result.error && !/账号状态读取失败/.test(result.error)) setError(result.error);
  }

  useEffect(() => {
    if (selfHostedMode) {
      setAccount(SELF_HOSTED_ACCOUNT);
      saveActiveAccountId(SELF_HOSTED_ACCOUNT.id);
      setStatus("ready");
      setError("");
      return;
    }

    void refreshAccount();
    // 网络恢复（含 WiFi↔流量切换完成）时自动重试校验
    const onOnline = () => {
      setStatus(current => {
        if (current === "checking" || current === "unreachable") {
          void refreshAccount();
        }
        return current;
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfHostedMode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await loginAccount({
        username,
        password,
        mode,
        emailCode: emailCode.trim(),
        method: mode === "register" ? "code" : loginMethod,
      });
      if (!result.ok || !result.account) {
        setError(result.error || "登录失败。");
        return;
      }
      setAccount(result.account);
      saveActiveAccountId(result.account.id);
      setStatus("ready");
      setPassword("");
      setEmailCode("");
    } catch {
      setError("无法连接账号服务，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    if (sendingCode) return;
    setError("");
    setNotice("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim())) {
      setError("请先填写有效的邮箱地址。");
      return;
    }
    setSendingCode(true);
    try {
      const response = await fetch("/api/auth/email-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: username, purpose: mode }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) setError(data.error || "发送失败，请稍后重试。");
      else setNotice("验证码已发送，请检查邮箱，10 分钟内有效。");
    } catch { setError("无法连接账号服务，请检查网络后重试。"); }
    finally { setSendingCode(false); }
  }

  async function handleLogout() {
    if (selfHostedMode) {
      setAccount(SELF_HOSTED_ACCOUNT);
      saveActiveAccountId(SELF_HOSTED_ACCOUNT.id);
      setStatus("ready");
      return;
    }

    await logoutAccount();
    setAccount(null);
    saveActiveAccountId("");
    setStatus("signed-out");
  }

  if (status === "unreachable") {
    return (
      <main className="app-root account-gate-root" style={gateRootFallbackStyle}>
        <section className="account-gate-card account-gate-loading" style={gatePanelFallbackStyle}>
          <span>网络连接不畅，账号校验失败</span>
          <button
            type="button"
            className="account-gate-retry-btn"
            onClick={() => { setStatus("checking"); void refreshAccount(); }}
          >
            重试
          </button>
        </section>
      </main>
    );
  }

  if (status === "checking") {
    return (
      <main className="app-root account-gate-root" style={gateRootFallbackStyle}>
        <section className="account-gate-panel" aria-live="polite" style={gatePanelFallbackStyle}>
          <Loader2 className="account-gate-spinner" size={24} />
          <span>正在校验账号...</span>
        </section>
      </main>
    );
  }

  if (status === "ready" && account) {
    return (
      <AccountProvider account={account} refreshAccount={refreshAccount} logout={handleLogout}>
        {children}
      </AccountProvider>
    );
  }

  return (
    <main className="app-root splash-root">
      <section className="phone-shell-wrap splash-shell-wrap" aria-label="寻信">
        <div className="phone-case"><div className="phone-frame"><div className="phone-shell splash-phone-screen">
          <SplashAnimation />
          <div className="xunxin-auth-backdrop">
            <section className="xunxin-auth-card" role="dialog" aria-modal="true" aria-labelledby="xunxin-auth-title">
              <button type="button" className="xunxin-auth-close" onClick={onBack} disabled={busy} aria-label="返回启动页"><X size={19} /></button>
              <div className="xunxin-auth-eyebrow">XUNXIN · A LETTER FOR YOU</div>
              <h1 id="xunxin-auth-title">{mode === "register" ? "开启寻信" : "欢迎回来"}</h1>
              <p className="xunxin-auth-subtitle">{mode === "register" ? "用邮箱验证码，开启你的寻信旅程。" : "登录你的账号，继续未完的对话。"}</p>
              <div className="xunxin-auth-tabs" aria-label="选择登录或注册">
                <button type="button" aria-pressed={mode === "register"} onClick={() => { setMode("register"); setError(""); setNotice(""); setEmailCode(""); }}>注册</button>
                <button type="button" aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); setNotice(""); setEmailCode(""); }}>登录</button>
              </div>
              <form className="xunxin-auth-form" onSubmit={handleSubmit}>
                <label>{mode === "register" ? "邮箱" : "邮箱或已有账号"}<input type={mode === "register" ? "email" : "text"} required maxLength={254} value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" placeholder="name@example.com" /></label>
                {mode === "login" && <div className="xunxin-auth-method"><button type="button" aria-pressed={loginMethod === "code"} onClick={() => { setLoginMethod("code"); setError(""); }}>验证码登录</button><button type="button" aria-pressed={loginMethod === "password"} onClick={() => { setLoginMethod("password"); setError(""); }}>密码登录</button></div>}
                {(mode === "register" || loginMethod === "code") && <label>邮箱验证码<span className="xunxin-code-row"><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={emailCode} onChange={event => setEmailCode(event.target.value)} autoComplete="one-time-code" placeholder="6 位验证码" /><button type="button" disabled={sendingCode} onClick={() => void handleSendCode()}>{sendingCode ? "发送中…" : "获取验证码"}</button></span></label>}
                {(mode === "register" || loginMethod === "password") && <label>{mode === "register" ? "设置密码（选填）" : "密码"}<input required={mode === "login"} type="password" minLength={6} maxLength={120} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "register" ? "可设置至少 6 位密码" : "请输入密码"} /></label>}
                {notice && <div className="xunxin-auth-notice" role="status">{notice}</div>}
                {error && <div className="xunxin-auth-error" role="alert">{error}</div>}
                <button className="xunxin-auth-submit" type="submit" disabled={busy}>{busy ? <Loader2 size={17} className="account-gate-spinner" /> : <>{mode === "register" ? "注册并进入" : "登录并进入"}<ArrowRight size={17} /></>}</button>
              </form>
              <p className="xunxin-auth-footnote">{mode === "register" ? "密码选填；也可以一直使用邮箱验证码登录。" : "密码登录适用于注册时设置过密码的账号。"}<br />聊天等资料保存在当前浏览器，请勿与他人共用浏览器账号。</p>
            </section>
          </div>
        </div></div></div>
      </section>
    </main>
  );
}
