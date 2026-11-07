"use client";

import { useEffect, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { getActiveCompanion, summonCharacterCompanion } from "@/lib/mascot-state";
import { COMPANION_APP_NAMES, companionLaunchUrl, supportsAndroidCompanion, type CompanionAppId } from "@/lib/android-companion";
import type { Character } from "@/lib/character-types";

export function CompanionSocialApp({ appId, onClose }: { appId: CompanionAppId; onClose: () => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState("");
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const items = loadCharacters();
    setCharacters(items);
    setSelected(getActiveCompanion()?.characterId || items[0]?.id || "");
    setSupported(supportsAndroidCompanion());
  }, []);
  const character = characters.find(item => item.id === selected);
  const name = COMPANION_APP_NAMES[appId];
  return (
    <div style={{ height: "100%", overflowY: "auto", background: "#fff8fa", padding: "calc(var(--cp-appbar-safe-top, 0px) + 20px) 20px 24px", color: "#453440" }}>
      <button type="button" onClick={onClose} style={{ border: 0, background: "none", padding: "8px 0", color: "inherit" }}>‹ 返回</button>
      <h2 style={{ fontSize: 22, margin: "24px 0 12px" }}>一起刷{name}</h2>
      <p style={{ lineHeight: 1.8 }}>带着你的 AI 伴侣打开手机里的{name}。点击悬浮头像，他就会看看当前屏幕，陪你聊聊。</p>
      {supported ? <>
        <label htmlFor="companion-character">陪你一起看的角色</label>
        <select id="companion-character" value={selected} onChange={event => setSelected(event.target.value)}
          style={{ display: "block", width: "100%", margin: "12px 0 20px", padding: 12, borderRadius: 12 }}>
          {characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {character ? <a href={companionLaunchUrl(appId, character.id, character.name)}
          onClick={() => summonCharacterCompanion({ characterId: character.id, name: character.name, avatar: character.avatar })}
          style={{ display: "block", padding: 14, borderRadius: 14, background: "#d65c83", textAlign: "center", color: "white", textDecoration: "none" }}>
          带{character.name}打开{name}
        </a> : <p>先在「角色」里创建或导入你的 AI 伴侣。</p>}
        <p style={{ fontSize: 13, lineHeight: 1.8, marginTop: 20 }}>首次打开时允许悬浮窗与屏幕共享。截图会发送给你配置的识图模型，回复同步到原有聊天。拖动头像可以移动，通知栏可随时关闭陪伴。</p>
      </> : <p role="status" style={{ lineHeight: 1.8 }}>请安装包含屏幕陪伴功能的新版安卓小手机，并在手机中安装{name}。浏览器无法在真实 App 上显示悬浮窗。</p>}
    </div>
  );
}
