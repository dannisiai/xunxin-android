"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Camera,
  Usb,
  Download,
  CheckCircle2,
  X,
  Radio,
} from "lucide-react";
import type { ChatSharePayload } from "@/lib/chat-share";

export type PhoneMirrorViewProps = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

type MirrorSource = "xiaohongshu" | "douyin" | "desktop";

export function PhoneMirrorView({ onClose, onNotice }: PhoneMirrorViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isRealDevice, setIsRealDevice] = useState(false);
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sourceMode, setSourceMode] = useState<MirrorSource>("xiaohongshu");
  const [fps, setFps] = useState(60);

  // Floating hearts animation for Xiaohongshu/Douyin
  const heartsRef = useRef<Array<{ x: number; y: number; opacity: number; scale: number; vy: number }>>([]);
  const animFrameRef = useRef<number | null>(null);
  const tickRef = useRef(0);

  // WebUSB device request
  const handleConnectUsb = async () => {
    try {
      if (typeof navigator === "undefined" || !("usb" in navigator)) {
        onNotice?.("当前浏览器未开启 WebUSB，建议使用 Chrome/Edge 并开启实验性 USB 特性");
        return;
      }
      setConnecting(true);
      const { AdbDaemonWebUsbDeviceManager } = await import("@yume-chan/adb-daemon-webusb");
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) {
        onNotice?.("WebUSB 驱动接口未就绪");
        return;
      }
      const device = await manager.requestDevice();
      if (device) {
        const name = device.raw.productName || device.raw.serialNumber || "Android Phone";
        setConnectedDeviceName(name);
        setIsRealDevice(true);
        onNotice?.(`已识别 Android 设备：${name}。当前仍是演示画面，尚未接入手机屏幕。`);
      }
    } catch (err) {
      console.warn("USB connect cancelled or error:", err);
      onNotice?.(err instanceof Error ? err.message : "连接已取消");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectUsb = () => {
    setIsRealDevice(false);
    setConnectedDeviceName(null);
    onNotice?.("已取消设备选择，当前仍为演示画面");
  };

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frameCount = 0;
    let fpsTimer = performance.now();

    const render = (time: number) => {
      tickRef.current++;
      const tick = tickRef.current;

      // Calculate FPS
      frameCount++;
      if (time - fpsTimer >= 1000) {
        setFps(Math.round((frameCount * 1000) / (time - fpsTimer)));
        frameCount = 0;
        fpsTimer = time;
      }

      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const logicalW = 340;
      const logicalH = 680;

      if (canvas.width !== logicalW * dpr || canvas.height !== logicalH * dpr) {
        canvas.width = logicalW * dpr;
        canvas.height = logicalH * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // 1. Phone bezel & background
      ctx.fillStyle = "#0c0d11";
      ctx.fillRect(0, 0, logicalW, logicalH);

      if (sourceMode === "douyin") {
        // --- 抖音短视频流画面 ---
        // Dynamic gradient video background
        const grad = ctx.createLinearGradient(0, 0, logicalW, logicalH);
        const shift = (tick * 0.5) % 360;
        grad.addColorStop(0, `hsl(${shift}, 45%, 15%)`);
        grad.addColorStop(0.5, `hsl(${(shift + 60) % 360}, 50%, 22%)`);
        grad.addColorStop(1, `hsl(${(shift + 140) % 360}, 40%, 12%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, logicalW, logicalH);

        // Center visual art / avatar pulse
        const cy = logicalH * 0.44;
        const cx = logicalW * 0.5;
        const pulse = Math.sin(tick * 0.05) * 8;
        ctx.beginPath();
        ctx.arc(cx, cy, 64 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, 48, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(254, 44, 85, 0.25)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "bold 32px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🎵", cx, cy);

        // Waveform bars
        const barCount = 18;
        const startX = cx - (barCount * 8) / 2;
        for (let i = 0; i < barCount; i++) {
          const bh = Math.abs(Math.sin((tick + i * 15) * 0.08)) * 32 + 6;
          ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
          ctx.fillRect(startX + i * 8, cy + 80 - bh / 2, 4, bh);
        }

        // Right side interaction buttons
        const rightX = logicalW - 38;
        const actions = [
          { icon: "❤️", text: "28.5w", color: "#fe2c55" },
          { icon: "💬", text: "4192", color: "#ffffff" },
          { icon: "⭐", text: "1.2w", color: "#facc15" },
          { icon: "↗️", text: "分享", color: "#ffffff" },
        ];
        actions.forEach((act, idx) => {
          const ay = cy - 20 + idx * 56;
          ctx.beginPath();
          ctx.arc(rightX, ay, 18, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fill();
          ctx.font = "18px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(act.icon, rightX, ay);
          ctx.font = "10px sans-serif";
          ctx.fillStyle = act.color;
          ctx.fillText(act.text, rightX, ay + 26);
        });

        // Rotating music disc at bottom right
        const discX = rightX;
        const discY = logicalH - 85;
        ctx.save();
        ctx.translate(discX, discY);
        ctx.rotate((tick * 0.04) % (Math.PI * 2));
        ctx.beginPath();
        ctx.arc(0, 0, 19, 0, Math.PI * 2);
        ctx.fillStyle = "#1e1e24";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#fe2c55";
        ctx.fill();
        ctx.restore();

        // Bottom title & author
        ctx.textAlign = "left";
        ctx.font = "bold 15px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("@失重日常 · 随身机", 18, logicalH - 120);
        ctx.font = "13px sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillText("今晚的晚风与城市流光 ✨ #生活碎片 #投屏", 18, logicalH - 98);
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.fillText("♬ 原声 - 派对与漫游 · 正在播放", 18, logicalH - 76);

        // Progress line
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillRect(0, logicalH - 32, logicalW, 2);
        const prog = ((tick * 1.5) % logicalW);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, logicalH - 32, prog, 2);

      } else if (sourceMode === "xiaohongshu") {
        // --- 小红书双列瀑布流画面 ---
        ctx.fillStyle = "#121318";
        ctx.fillRect(0, 0, logicalW, logicalH);

        // Top bar
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("关注", 80, 58);
        ctx.fillStyle = "#ff2442";
        ctx.fillText("发现", 130, 58);
        ctx.fillStyle = "#888888";
        ctx.fillText("广州", 180, 58);

        // Search bar
        ctx.fillStyle = "#22232a";
        ctx.beginPath();
        ctx.roundRect(16, 74, logicalW - 32, 32, 16);
        ctx.fill();
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.textAlign = "left";
        ctx.fillText("🔍 搜索心仪的笔记与穿搭灵感", 32, 94);

        // Cards waterfall
        const cardW = (logicalW - 32 - 10) / 2;
        const leftX = 16;
        const rightX = 16 + cardW + 10;

        // Card 1 (Left)
        ctx.fillStyle = "#1a1b24";
        ctx.beginPath();
        ctx.roundRect(leftX, 118, cardW, 190, 10);
        ctx.fill();
        // Image box
        const gradL = ctx.createLinearGradient(leftX, 118, leftX + cardW, 238);
        gradL.addColorStop(0, "#3b2d54");
        gradL.addColorStop(1, "#1e293b");
        ctx.fillStyle = gradL;
        ctx.beginPath();
        ctx.roundRect(leftX, 118, cardW, 120, [10, 10, 0, 0]);
        ctx.fill();
        ctx.font = "28px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🏕️", leftX + cardW / 2, 185);
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = "#f1f5f9";
        ctx.textAlign = "left";
        ctx.fillText("周末绝美逃离指南", leftX + 8, 256);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("山野间看日落与繁星", leftX + 8, 274);
        ctx.fillText("❤️ 1.8w", leftX + 8, 296);

        // Card 2 (Right)
        ctx.fillStyle = "#1a1b24";
        ctx.beginPath();
        ctx.roundRect(rightX, 118, cardW, 230, 10);
        ctx.fill();
        const gradR = ctx.createLinearGradient(rightX, 118, rightX + cardW, 268);
        gradR.addColorStop(0, "#4a2d3b");
        gradR.addColorStop(1, "#311828");
        ctx.fillStyle = gradR;
        ctx.beginPath();
        ctx.roundRect(rightX, 118, cardW, 150, [10, 10, 0, 0]);
        ctx.fill();
        ctx.font = "28px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("👗", rightX + cardW / 2, 200);
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = "#f1f5f9";
        ctx.textAlign = "left";
        ctx.fillText("晨雾灰温柔系穿搭", rightX + 8, 288);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("简约轻法式质感", rightX + 8, 306);
        ctx.fillText("❤️ 3.4w", rightX + 8, 332);

        // Card 3 (Left lower)
        ctx.fillStyle = "#1a1b24";
        ctx.beginPath();
        ctx.roundRect(leftX, 318, cardW, 210, 10);
        ctx.fill();
        const gradL2 = ctx.createLinearGradient(leftX, 318, leftX + cardW, 448);
        gradL2.addColorStop(0, "#1d3557");
        gradL2.addColorStop(1, "#457b9d");
        ctx.fillStyle = gradL2;
        ctx.beginPath();
        ctx.roundRect(leftX, 318, cardW, 130, [10, 10, 0, 0]);
        ctx.fill();
        ctx.font = "28px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("☕", leftX + cardW / 2, 388);
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = "#f1f5f9";
        ctx.textAlign = "left";
        ctx.fillText("藏在街角的特调咖啡", leftX + 8, 468);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("微醺橙花与冷萃拿铁", leftX + 8, 486);
        ctx.fillText("❤️ 9820", leftX + 8, 510);

        // Bottom nav
        ctx.fillStyle = "rgba(18, 19, 24, 0.94)";
        ctx.fillRect(0, logicalH - 52, logicalW, 52);
        ctx.fillStyle = "#ff2442";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("首页", 36, logicalH - 22);
        ctx.fillStyle = "#888888";
        ctx.fillText("视频", 100, logicalH - 22);
        ctx.beginPath();
        ctx.roundRect(logicalW / 2 - 16, logicalH - 42, 32, 26, 6);
        ctx.fillStyle = "#ff2442";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("+", logicalW / 2, logicalH - 24);
        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = "#888888";
        ctx.fillText("消息", logicalW - 100, logicalH - 22);
        ctx.fillText("我", logicalW - 36, logicalH - 22);

      } else {
        // --- Android 原生桌面 ---
        const gradD = ctx.createLinearGradient(0, 0, logicalW, logicalH);
        gradD.addColorStop(0, "#09203f");
        gradD.addColorStop(1, "#537895");
        ctx.fillStyle = gradD;
        ctx.fillRect(0, 0, logicalW, logicalH);

        // Big clock widget
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        ctx.font = "300 48px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(`${hh}:${mm}`, logicalW / 2, 140);
        ctx.font = "13px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText("11月4日 星期二 · 24°C 晴", logicalW / 2, 172);

        // App icons grid
        const apps = [
          { name: "小红书", icon: "📕", bg: "#ff2442" },
          { name: "微信", icon: "💬", bg: "#07c160" },
          { name: "抖音", icon: "🎵", bg: "#1e1e24" },
          { name: "网易云", icon: "☁️", bg: "#e60026" },
          { name: "相机", icon: "📷", bg: "#3b82f6" },
          { name: "相册", icon: "🖼️", bg: "#8b5cf6" },
          { name: "飞行棋", icon: "🎲", bg: "#f59e0b" },
          { name: "设置", icon: "⚙️", bg: "#64748b" },
        ];
        const gridCols = 4;
        const iconSize = 48;
        const colW = (logicalW - 40) / gridCols;
        apps.forEach((app, idx) => {
          const col = idx % gridCols;
          const row = Math.floor(idx / gridCols);
          const x = 20 + col * colW + colW / 2;
          const y = 230 + row * 82;

          ctx.beginPath();
          ctx.roundRect(x - iconSize / 2, y - iconSize / 2, iconSize, iconSize, 12);
          ctx.fillStyle = app.bg;
          ctx.fill();
          ctx.font = "24px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(app.icon, x, y);

          ctx.font = "11px sans-serif";
          ctx.fillStyle = "#ffffff";
          ctx.textBaseline = "top";
          ctx.fillText(app.name, x, y + iconSize / 2 + 5);
        });
      }

      // 2. Animated floating hearts
      const hearts = heartsRef.current;
      for (let i = hearts.length - 1; i >= 0; i--) {
        const h = hearts[i];
        h.y += h.vy;
        h.opacity -= 0.015;
        h.scale += 0.01;
        if (h.opacity <= 0) {
          hearts.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = h.opacity;
        ctx.font = `${Math.round(20 * h.scale)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("❤️", h.x, h.y);
        ctx.restore();
      }

      // 3. Status Bar (Top)
      ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
      ctx.fillRect(0, 0, logicalW, 26);
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(timeStr, 14, 13);

      ctx.textAlign = "right";
      ctx.fillText("5G 📶 95% 🔋", logicalW - 14, 13);

      // Camera notch
      ctx.beginPath();
      ctx.arc(logicalW / 2, 13, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#000000";
      ctx.fill();

      // Mirror Badge Overlay
      ctx.fillStyle = isRealDevice ? "rgba(16, 185, 129, 0.9)" : "rgba(59, 130, 246, 0.85)";
      ctx.beginPath();
      ctx.roundRect(10, 32, isRealDevice ? 90 : 78, 20, 10);
      ctx.fill();
      ctx.font = "bold 10px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText("● 演示画面", 10 + (isRealDevice ? 45 : 39), 42);

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [sourceMode, isRealDevice]);

  // Click on canvas creates floating hearts
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    heartsRef.current.push({
      x,
      y,
      opacity: 1,
      scale: 1,
      vy: -2 - Math.random() * 2,
    });
  };

  // 📸 Capture snapshot and share to TA
  const handleCaptureAndShare = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const modeLabel = sourceMode === "douyin" ? "抖音短视频" : sourceMode === "xiaohongshu" ? "小红书精选" : "手机桌面";
      const share: ChatSharePayload = {
        type: "screenshot",
        imageDataUrl: dataUrl,
        caption: `来自投屏演示 [${modeLabel}] 的截图`,
        sourceApp: "投屏演示",
      };
      window.dispatchEvent(new CustomEvent("open-mini-chat", { detail: { share } }));
      onNotice?.("📸 截屏成功！已打开微信聊天，请选择角色发送");
    } catch (err) {
      console.error("Screenshot error:", err);
      onNotice?.("截屏处理失败");
    }
  }, [sourceMode, onNotice]);

  // 💾 Download snapshot to disk
  const handleDownloadSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const link = document.createElement("a");
      link.download = `phone-mirror-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      onNotice?.("截屏已保存至本地");
    } catch {
      onNotice?.("保存截屏失败");
    }
  }, [onNotice]);

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-[#090a0f] text-white select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center font-bold text-sm">
            📱
          </div>
          <div>
            <div className="text-sm font-bold flex items-center gap-2">
              投屏画面演示
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isRealDevice ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-blue-500/20 text-blue-400 border border-blue-500/30"}`}>
                {isRealDevice ? "已识别设备·演示画面" : "演示画面"}
              </span>
            </div>
            <div className="text-[11px] text-white/50">
              {connectedDeviceName ? `已识别: ${connectedDeviceName}，尚未接入屏幕` : "当前画面为模拟内容"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="关闭投屏"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Canvas Mirror Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-3 overflow-hidden min-h-0 bg-gradient-to-b from-[#0e1017] to-[#08090d]">
        <div className="relative rounded-[28px] overflow-hidden p-1.5 bg-gradient-to-b from-white/20 via-white/5 to-white/10 shadow-2xl border border-white/15 max-h-full aspect-[340/680] flex items-center justify-center">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="w-full h-full rounded-[22px] object-contain cursor-pointer shadow-inner bg-black block"
            title="点击演示画面显示动画"
          />

          {/* Quick HUD overlay in bottom corner */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 text-[10px] text-white/70 pointer-events-none">
            <Radio size={12} className="text-emerald-400 animate-pulse" />
            <span>{fps} FPS</span>
            <span>·</span>
            <span>演示</span>
          </div>
        </div>
      </div>

      {/* Control Bar & Quick Actions */}
      <div className="p-3 bg-white/5 border-t border-white/10 backdrop-blur-md shrink-0 flex flex-col gap-2.5">
        {/* Source switch pills */}
        <div className="flex items-center justify-between gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
          <button
            type="button"
            onClick={() => setSourceMode("xiaohongshu")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${sourceMode === "xiaohongshu" ? "bg-red-500 text-white shadow-md shadow-red-500/30" : "text-white/60 hover:text-white"}`}
          >
            📕 小红书发现
          </button>
          <button
            type="button"
            onClick={() => setSourceMode("douyin")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${sourceMode === "douyin" ? "bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-md shadow-pink-500/30" : "text-white/60 hover:text-white"}`}
          >
            🎵 抖音沉浸流
          </button>
          <button
            type="button"
            onClick={() => setSourceMode("desktop")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${sourceMode === "desktop" ? "bg-blue-600 text-white shadow-md shadow-blue-500/30" : "text-white/60 hover:text-white"}`}
          >
            📱 原生桌面
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Real USB Connection button */}
          {!isRealDevice ? (
            <button
              type="button"
              onClick={handleConnectUsb}
              disabled={connecting}
              className="flex-1 py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 border border-white/15 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
            >
              <Usb size={15} className="text-emerald-400" />
              <span>{connecting ? "识别中…" : "识别 USB 设备"}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnectUsb}
              className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 active:scale-95 border border-emerald-500/30 text-xs font-medium text-emerald-300 flex items-center justify-center gap-1.5 transition-all"
            >
              <CheckCircle2 size={15} />
              <span>清除设备</span>
            </button>
          )}

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownloadSnapshot}
            className="p-2.5 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 border border-white/15 text-white/80 hover:text-white transition-all"
            title="保存截屏到本地"
          >
            <Download size={16} />
          </button>

          {/* 📸 截屏聊TA 主操作按钮 */}
          <button
            type="button"
            onClick={handleCaptureAndShare}
            className="flex-[1.4] py-2.5 px-3 rounded-xl bg-gradient-to-r from-red-500 via-rose-500 to-amber-500 hover:brightness-110 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-red-500/25 transition-all cursor-pointer"
          >
            <Camera size={16} />
            <span>📸 截屏聊TA</span>
          </button>
        </div>
      </div>
    </div>
  );
}
