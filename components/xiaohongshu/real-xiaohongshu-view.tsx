"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";

const XIAOHONGSHU_URL = "https://www.xiaohongshu.com/explore";

export function RealXiaohongshuView({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(true);
  const [sharing, setSharing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [shellSupport, setShellSupport] = useState<"browser" | "old" | "ready">("browser");

  useEffect(() => {
    activeRef.current = true;
    const shell = (window as Window & { AndroidShell?: { supportsTransparentOverlay?: () => boolean } }).AndroidShell;
    if (navigator.userAgent.includes("FloatShell/")) {
      try { setShellSupport(shell?.supportsTransparentOverlay?.() ? "ready" : "old"); }
      catch { setShellSupport("old"); }
    }
    return () => {
      activeRef.current = false;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video && sharing) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => setError("画面未能自动播放，请重新选择网页。"));
    }
  }, [sharing]);

  const stopSharing = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setSharing(false);
  };

  const startSharing = async () => {
    if (choosing) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("当前浏览器不支持共享网页画面，请使用电脑上的 Chrome。");
      return;
    }
    setError("");
    setChoosing(true);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (!activeRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (activeRef.current && streamRef.current === stream) {
          streamRef.current = null;
          setSharing(false);
        }
      }, { once: true });
      setSharing(true);
    } catch (reason) {
      if (!activeRef.current) return;
      setError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "没有选择共享画面。点击按钮可以重试。"
        : "无法共享画面，请检查浏览器支持和共享权限后重试。");
    } finally {
      if (activeRef.current) setChoosing(false);
    }
  };

  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(var(--cp-appbar-safe-top) + 10px) 12px 10px", borderBottom: "1px solid #eee" }}>
        <button type="button" onClick={onClose} aria-label="返回模拟小红书" style={{ border: 0, background: "none", color: "#333", padding: 4 }}><ChevronLeft size={22} /></button>
        <strong style={{ flex: 1, color: "#222", fontSize: 14 }}>真实小红书</strong>
        <a href={XIAOHONGSHU_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#d91f3c", fontSize: 12 }}>打开官网</a>
      </div>
      <div style={{ flexShrink: 0, padding: "9px 12px", color: "#555", fontSize: 12, lineHeight: 1.5 }}>
        {shellSupport === "ready" ? (
          <div style={{ marginBottom: 10 }}>
            <a href="floatshell://transparent-xiaohongshu" style={{ display: "inline-block", borderRadius: 9, padding: "8px 14px", background: "#e63854", color: "white", fontWeight: 700, textDecoration: "none" }}>用透明外框打开小红书 App</a>
            <div>将打开手机里已安装的小红书；中间透明区域直接触摸下方 App。</div>
          </div>
        ) : shellSupport === "old" ? (
          <div style={{ marginBottom: 10 }}>透明外框需要更新安卓小手机 App 后使用。</div>
        ) : null}
        <div>网页空白时：先点“打开官网”，再点下方按钮，选择小红书标签页。</div>
        <div>画面会显示在这里；滑动和点击请在官网标签页操作。</div>
        <button type="button" onClick={sharing ? stopSharing : startSharing} disabled={choosing}
          style={{ marginTop: 8, border: 0, borderRadius: 9, padding: "8px 14px", background: "#e63854", color: "white", fontWeight: 700, cursor: "pointer" }}>
          {choosing ? "请选择要共享的标签页…" : sharing ? "停止共享画面" : "将网页画面显示在这里"}
        </button>
        {error && <div role="alert" style={{ marginTop: 6, color: "#b42318" }}>{error}</div>}
      </div>
      {sharing ? (
        <video ref={videoRef} autoPlay muted playsInline aria-label="共享的小红书网页画面"
          style={{ width: "100%", flex: 1, minHeight: 0, objectFit: "contain", background: "#111" }} />
      ) : (
        <iframe title="真实小红书网页" src={XIAOHONGSHU_URL} style={{ border: 0, width: "100%", flex: 1, minHeight: 0 }} />
      )}
    </div>
  );
}
