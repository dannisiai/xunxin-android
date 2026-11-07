"use client";

import { PhoneSettingsApp } from "@/components/phone-settings-app";
import { PhonePlaceholderApp } from "@/components/phone-placeholder-app";
import MusicApp from "@/components/music/music-app";
import { PhoneCalendarApp } from "@/components/calendar-app";
import { PhoneQaApp } from "@/components/phone-qa-app";
import { ChatPluginPageBoundary } from "@/components/chat/chat-plugin-page-boundary";
import { ResourceHubApp } from "@/components/resource-hub/resource-hub-app";
import { RealityBridgeApp } from "@/components/reality-bridge-app";
import { DiaryApp } from "@/components/diary/diary-app";
import { CompanionSocialApp } from "@/components/companion-social-app";
import { StoryApp } from "@/components/story/story-app";
import { VnApp } from "@/components/vn/vn-app";
import ReadingApp from "@/components/reading/reading-app";
import MapApp from "@/components/map/map-app";
import { CheckPhoneApp } from "@/components/checkphone/checkphone-app";
import { GameHubApp } from "@/components/game/game-hub-app";
import { MixologyApp } from "@/components/mixology/mixology-app";
import InterviewMagazineApp from "@/components/interview/interview-magazine-app";
import { CoCreateApp } from "@/components/cocreate/cocreate-app";
import { ICONS, type IconId, type DesktopIconId } from "@/lib/desktop-config";


type BuiltinAppCallbacks = {
  onClose: () => void;
  onNotice: (message: string) => void;
};

/** Route built-in apps whose lifecycle is owned by the desktop shell. */
export function renderBuiltinDesktopApp(appId: DesktopIconId, { onClose, onNotice }: BuiltinAppCallbacks) {
  if (appId === "settings") {
    return (
      <PhoneSettingsApp
        onClose={onClose}
        onNotice={onNotice}
      />
    );
  }

  if (appId === "music") {
    return <MusicApp onClose={onClose} />;
  }

  if (appId === "calendar") {
    return <PhoneCalendarApp onClose={onClose} onNotice={onNotice} />;
  }

  if (appId === "realitybridge") {
    return <RealityBridgeApp onClose={onClose} onNotice={onNotice} />;
  }

  if (appId === "qa") {
    return (
      <ChatPluginPageBoundary page="工坊" onClose={onClose}>
        <PhoneQaApp onClose={onClose} onNotice={onNotice} />
      </ChatPluginPageBoundary>
    );
  }

  if (appId === "resource_hub") {
    return <ResourceHubApp onClose={onClose} onNotice={onNotice} />;
  }

  if (appId === "diary") {
    return <DiaryApp onClose={onClose} onNotice={onNotice} />;
  }

  if (appId === "douyin" || appId === "xiaohongshu") {
    return <CompanionSocialApp appId={appId} onClose={onClose} />;
  }

  if (appId === "story") {
    return <StoryApp onClose={onClose} />;
  }

  if (appId === "vnmode") {
    return <VnApp onClose={onClose} />;
  }

  if (appId === "reading") {
    return <ReadingApp onClose={onClose} />;
  }

  if (appId === "mapmode") {
    return <MapApp onClose={onClose} />;
  }

  if (appId === "dwelling") {
    // DwellingApp is rendered separately (kept alive) — see below
    return null;
  }

  if (appId === "checkphone") {
    return <CheckPhoneApp onClose={onClose} />;
  }

  if (appId === "shopping") {
    return null;
  }

  if (appId === "game") {
    return <GameHubApp onClose={onClose} />;
  }

  if (appId === "mixology") {
    return <MixologyApp onClose={onClose} />;
  }

  if (appId === "interview_magazine") {
    return <InterviewMagazineApp onClose={onClose} />;
  }

  if (appId === "cocreate") {
    return <CoCreateApp onClose={onClose} onNotice={onNotice} />;
  }

  return appId in ICONS
    ? <PhonePlaceholderApp icon={ICONS[appId as IconId]} onClose={onClose} />
    : null;
}
