"use client";

import { memo, useEffect } from "react";
import MusicPlayer from "@/components/music/music-player";
import MusicFloat from "@/components/music/music-float";
import { useMusicControlsOptional } from "@/lib/music-context";
import type { DesktopIconId } from "@/lib/desktop-config";

export type MusicOverlayController = {
  closeFullPlayer: () => void;
};

export const MusicShellOverlays = memo(function MusicShellOverlays({
  activeApp,
  onControllerChange,
}: {
  activeApp: DesktopIconId | null;
  onControllerChange: (controller: MusicOverlayController | null) => void;
}) {
  const musicPlayer = useMusicControlsOptional();

  useEffect(() => {
    onControllerChange(musicPlayer ? { closeFullPlayer: musicPlayer.closeFullPlayer } : null);
  }, [musicPlayer?.closeFullPlayer, onControllerChange]);

  return (
    <>
      {musicPlayer?.showFullPlayer && musicPlayer.currentTrack && <MusicPlayer />}
      <MusicFloat hidden={activeApp === "music" || musicPlayer?.showFullPlayer} />
    </>
  );
});
