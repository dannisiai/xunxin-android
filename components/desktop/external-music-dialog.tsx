"use clien  t";

  type ExternalMusicDialogProps = {
    onClose: () => void;
    onOpenPlayer: () => void;
    onLaunchApp: (scheme: string, webUrl?: string) => void;
    onOpenWeb: (webUrl: string) => void;
  };

  export function ExternalMusicDialog({ onClose, onOpenPlayer, onLaunchApp, onOpenWeb }: ExternalMusicDialogProps) {
    return (
    <div data-adaptive-surface="overlay"
      className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="外部音乐唤醒"
      onClick={() => onClose()}
    >
      <div data-adaptive-surface="card"
        className="w-full max-w-sm rounded-2xl border border-[var(--c-panel-border)] bg-[var(--c-page-body-bg)] p-5 text-[var(--c-text)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--c-panel-border)] pb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--c-text)] m-0">🎵 音乐播放与外部唤醒</h3>
            <p className="mt-1 text-xs opacity-65 m-0">唤醒手机/电脑端主流音乐软件或使用内置播放器</p>
          </div>
          <button
            type="button"
            className="text-xs px-2 py-1 opacity-60 hover:opacity-100 rounded cursor-pointer"
            onClick={() => onClose()}
          >
            关闭
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            className="flex items-center gap-3 p-3 rounded-xl border border-[var(--c-panel-border)] hover:bg-[var(--c-input)]/40 transition-colors text-left cursor-pointer"
            onClick={() => {
              onClose();
              onOpenPlayer();
            }}
          >
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-500 flex items-center justify-center font-bold text-lg shrink-0">
              🎧
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--c-text)]">小手机内置播放器</div>
              <div className="text-xs opacity-60 truncate">灵动流光歌词、黑胶唱机与全沉浸视听</div>
            </div>
            <span className="text-xs text-blue-400 font-medium shrink-0">立即打开</span>
          </button>

          <div
            className="flex items-center gap-3 p-3 rounded-xl border border-[var(--c-panel-border)] hover:bg-[var(--c-input)]/40 transition-colors text-left cursor-pointer"
            onClick={() => onLaunchApp("orpheus://", "https://music.163.com/")}
          >
            <div className="w-10 h-10 rounded-xl bg-red-600/20 text-red-500 flex items-center justify-center font-bold text-lg shrink-0">
              ☁️
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--c-text)]">网易云音乐</div>
              <div className="text-xs opacity-60 truncate">唤醒网易云客户端 (orpheus://)</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg bg-[var(--c-input)] hover:bg-[var(--c-input)]/80 text-[var(--c-text)] opacity-75 hover:opacity-100 transition-all cursor-pointer border border-[var(--c-panel-border)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWeb("https://music.163.com/");
                }}
                title="在浏览器打开网易云音乐网页版"
              >
                网页版 ↗
              </button>
              <span className="text-xs text-red-400 font-semibold">唤醒</span>
            </div>
          </div>

          <div
            className="flex items-center gap-3 p-3 rounded-xl border border-[var(--c-panel-border)] hover:bg-[var(--c-input)]/40 transition-colors text-left cursor-pointer"
            onClick={() => onLaunchApp("qqmusic://", "https://y.qq.com/")}
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-500 flex items-center justify-center font-bold text-lg shrink-0">
              🟢
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--c-text)]">QQ 音乐</div>
              <div className="text-xs opacity-60 truncate">唤醒 QQ音乐客户端 (qqmusic://)</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg bg-[var(--c-input)] hover:bg-[var(--c-input)]/80 text-[var(--c-text)] opacity-75 hover:opacity-100 transition-all cursor-pointer border border-[var(--c-panel-border)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWeb("https://y.qq.com/");
                }}
                title="在浏览器打开QQ音乐网页版"
              >
                网页版 ↗
              </button>
              <span className="text-xs text-emerald-400 font-semibold">唤醒</span>
            </div>
          </div>

          <div
            className="flex items-center gap-3 p-3 rounded-xl border border-[var(--c-panel-border)] hover:bg-[var(--c-input)]/40 transition-colors text-left cursor-pointer"
            onClick={() => onLaunchApp("kugouURL://", "https://www.kugou.com/")}
          >
            <div className="w-10 h-10 rounded-xl bg-sky-600/20 text-sky-500 flex items-center justify-center font-bold text-lg shrink-0">
              🐶
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--c-text)]">酷狗音乐</div>
              <div className="text-xs opacity-60 truncate">唤醒酷狗音乐客户端 (kugouURL://)</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg bg-[var(--c-input)] hover:bg-[var(--c-input)]/80 text-[var(--c-text)] opacity-75 hover:opacity-100 transition-all cursor-pointer border border-[var(--c-panel-border)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWeb("https://www.kugou.com/");
                }}
                title="在浏览器打开酷狗音乐网页版"
              >
                网页版 ↗
              </button>
              <span className="text-xs text-sky-400 font-semibold">唤醒</span>
            </div>
          </div>

          <div
            className="flex items-center gap-3 p-3 rounded-xl border border-[var(--c-panel-border)] hover:bg-[var(--c-input)]/40 transition-colors text-left cursor-pointer"
            onClick={() => onLaunchApp("luna://", "https://music.douyin.com/")}
          >
            <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center font-bold text-lg shrink-0">
              🫧
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--c-text)]">汽水音乐</div>
              <div className="text-xs opacity-60 truncate">唤醒汽水音乐客户端 (luna://)</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg bg-[var(--c-input)] hover:bg-[var(--c-input)]/80 text-[var(--c-text)] opacity-75 hover:opacity-100 transition-all cursor-pointer border border-[var(--c-panel-border)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWeb("https://music.douyin.com/");
                }}
                title="在浏览器打开汽水音乐网页版"
              >
                网页版 ↗
              </button>
              <span className="text-xs text-purple-400 font-semibold">唤醒</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
