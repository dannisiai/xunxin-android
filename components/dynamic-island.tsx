"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Play, Pause, SkipBack, SkipForward, Disc, ExternalLink, Maximize2, ChevronUp } from "lucide-react";
import { useMusicPlayerOptional } from "@/lib/music-context";

export type DynamicIslandProps = {
  onOpenExternalMusic?: () => void;
  onOpenMusicApp?: () => void;
  className?: string;
};

type LyricLine = { time: number; text: string };

function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const lines: LyricLine[] = [];
  for (const line of lrcText.split("\n")) {
    const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseFloat(match[2]);
      const text = match[3].trim();
      if (text) {
        lines.push({ time: mins * 60 + secs, text });
      }
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export function DynamicIsland({
  onOpenExternalMusic,
  onOpenMusicApp,
  className = "",
}: DynamicIslandProps) {
  const player = useMusicPlayerOptional();
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentTrack = player?.currentTrack ?? null;
  const isPlaying = player?.isPlaying ?? false;
  const currentTime = player?.currentTime ?? 0;
  const duration = player?.duration ?? 0;

  // LRC parsing
  const lyrics = useMemo(() => parseLrc(currentTrack?.lyrics || ""), [currentTrack?.lyrics]);

  const currentLyric = useMemo(() => {
    if (!lyrics.length) return "";
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics[i].time) {
        return lyrics[i].text;
      }
    }
    return lyrics[0].text;
  }, [lyrics, currentTime]);

  // Click outside to collapse
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded]);

  // If collapsed and no track is playing, render standard island pill
  if (!currentTrack && !isExpanded) {
    return (
      <div
        className={`status-island cursor-pointer transition-transform active:scale-95 flex items-center justify-center ${className}`}
        onClick={() => onOpenExternalMusic?.()}
        title="点击唤醒外部音乐或打开播放器"
      />
    );
  }

  // Collapsed with active music track
  if (!isExpanded && currentTrack) {
    return (
      <div
        className={`status-island dynamic-island-compact flex items-center justify-between px-2 cursor-pointer transition-all duration-300 active:scale-95 select-none ${className}`}
        onClick={() => setIsExpanded(true)}
        title="点击展开灵动岛「一起听」挂件"
        style={{
          width: 148,
          height: 36,
          background: "#08080a",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
        }}
      >
        {/* Left: album cover or spinning disc */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className={`w-5 h-5 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-black/60 border border-white/20 ${isPlaying ? "animate-spin" : ""}`}
            style={{ animationDuration: "6s" }}
          >
            {currentTrack.coverUrl ? (
              <img src={currentTrack.coverUrl} alt="Cover" className="w-full h-full object-cover" />
            ) : (
              <Disc size={13} className="text-blue-400" />
            )}
          </div>
          <span className="text-[11px] font-medium text-white/90 truncate max-w-[70px]">
            {currentTrack.title}
          </span>
        </div>

        {/* Right: mini animated waveform bars */}
        <div className="flex items-end gap-[2px] h-3.5 px-0.5 shrink-0">
          <span
            className={`w-[2.5px] rounded-full bg-blue-500 transition-all ${isPlaying ? "dynamic-island-wave-1" : "h-1.5 opacity-40"}`}
          />
          <span
            className={`w-[2.5px] rounded-full bg-blue-400 transition-all ${isPlaying ? "dynamic-island-wave-2" : "h-2.5 opacity-40"}`}
          />
          <span
            className={`w-[2.5px] rounded-full bg-blue-500 transition-all ${isPlaying ? "dynamic-island-wave-3" : "h-1 opacity-40"}`}
          />
        </div>
      </div>
    );
  }

  // Expanded card state
  return (
    <>
      {/* Backdrop overlay */}
      <div data-adaptive-surface="decoration"
        className="fixed inset-0 z-[10010] bg-black/25 backdrop-blur-[2px]"
        onClick={() => setIsExpanded(false)}
      />

      <div data-adaptive-surface="card"
        ref={containerRef}
        className="dynamic-island-expanded-card fixed z-[10020] left-1/2 -translate-x-1/2 top-2 w-[calc(100%-24px)] max-w-[360px] rounded-[24px] bg-[#0c0c10]/95 backdrop-blur-2xl border border-white/15 p-4 text-white shadow-[0_12px_40px_rgba(0,0,0,0.7)] transition-all animate-in fade-in zoom-in-95 duration-200 select-none"
      >
        {/* Header: Title, artist, collapse button */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-2xl overflow-hidden shrink-0 border border-white/20 bg-black/50 shadow-md ${isPlaying ? "animate-spin" : ""}`}
              style={{ animationDuration: "12s" }}
            >
              {currentTrack?.coverUrl ? (
                <img src={currentTrack.coverUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-800">
                  <Disc size={22} className="text-white" />
                </div>
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-white truncate leading-tight">
                {currentTrack?.title || "未在播放"}
              </span>
              <span className="text-[11px] text-white/60 truncate mt-0.5">
                {currentTrack?.artist || "小手机音乐"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenExternalMusic?.()}
              title="唤醒外部音乐软件"
              className="p-1.5 rounded-full hover:bg-white/10 text-white/75 hover:text-white transition-colors"
            >
              <ExternalLink size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsExpanded(false);
                if (player?.openFullPlayer) player.openFullPlayer();
                else onOpenMusicApp?.();
              }}
              title="打开全屏播放器"
              className="p-1.5 rounded-full hover:bg-white/10 text-white/75 hover:text-white transition-colors"
            >
              <Maximize2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              title="收起灵动岛"
              className="p-1.5 rounded-full hover:bg-white/10 text-white/75 hover:text-white transition-colors"
            >
              <ChevronUp size={16} />
            </button>
          </div>
        </div>

        {/* Real-time Glowing Lyric Line */}
        <div className="my-2.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-center min-h-[36px] flex items-center justify-center">
          <span className="text-xs font-medium text-blue-200 tracking-wide line-clamp-2 leading-relaxed">
            {currentLyric || (isPlaying ? "♪ 音乐播放中 ♪" : "已暂停")}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-3 px-1">
          <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-white/45 mt-1 font-mono">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between px-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenExternalMusic?.()}
            className="text-[11px] font-semibold text-white/80 hover:text-white px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 transition-colors"
          >
            外部播放
          </button>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => player?.prev()}
              className="p-1.5 text-white/80 hover:text-white transition-transform active:scale-90"
              title="上一首"
            >
              <SkipBack size={18} />
            </button>

            <button
              type="button"
              onClick={() => player?.togglePlay()}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => player?.next()}
              className="p-1.5 text-white/80 hover:text-white transition-transform active:scale-90"
              title="下一首"
            >
              <SkipForward size={18} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsExpanded(false);
              onOpenMusicApp?.();
            }}
            className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
          >
            音乐库
          </button>
        </div>
      </div>
    </>
  );
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
