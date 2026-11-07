# 代码组织约定

主源码位于 `ai-virtual-phone`；`xunxin-android-build` 是安卓打包副本。
业务修改以主源码为准，同一轮改动再同步到打包副本，避免两份逻辑独立演进。

## 职责边界

| 目录 | 职责 |
| --- | --- |
| `app` | Next.js 页面入口、布局和 HTTP 路由 |
| `components/<功能>` | 页面、交互、功能专属组件和 React hooks |
| `components/ui` | 跨功能复用的按钮、表单、弹窗和页面框架 |
| `lib/<功能>` | 与具体页面组件无关的业务逻辑、数据转换和状态运行时 |
| `lib/server` | 账号校验、服务端文档解析和其他 Node.js 专用逻辑 |
| `lib/browser` | 浏览器能力封装，例如剪贴板 |
| `styles/<功能>` | 按功能拆分的样式；入口文件明确规定层叠顺序 |
| `android-shell` | WebView、原生悬浮窗、截屏、推送和本地 Node.js 运行时 |
| `scripts` | 构建及发布资源生成工具 |

公共数据类型放在 `lib` 的类型文件中，业务层不从页面组件导入类型。
`UserIdentity` 的统一定义位于 `lib/settings-types.ts`。

## 聊天

- `components/chat/chat-room.tsx`：会话编排、消息操作与当前页面状态。
- `components/chat/chat-input-bars.tsx`：线上与线下输入栏、输入控制句柄和附件入口类型。
- `components/chat/chat-action-cards.tsx`：长期记忆确认卡片和系统指令内容。
- `components/chat/offline-assistant-text.tsx`：线下回复的分段、双语与 HTML 展示。
- `lib/chat/generation-runtime.ts`：生成锁、取消、任务有效性和待完成工具调用。任务 Map 保持私有，通过函数查询。
- `lib/chat/message-presentation.ts`：展示用消息投影、面板归属、系统消息角色及通话记录分组。展示投影不修改存储记录。

## 桌面

- `components/desktop-shell.tsx`：桌面状态、拖拽交互、应用生命周期及后台服务编排。
- `lib/desktop/layout.ts`：网格、文件夹、历史布局迁移、占位和重排计算。
- `lib/desktop/theme.ts`：桌面主题读取、颜色和 CSS 值转换。
- `components/desktop/builtin-app-router.tsx`：生命周期由桌面管理的常规内置应用入口。
- `components/desktop/use-android-caret-keyboard-lift.ts`：安卓通用输入框的键盘避让。聊天仍由自己的底部预留 hook 处理。
- `components/desktop/music-shell-overlays.tsx`：全屏播放器与音乐悬浮控件。
- `components/desktop/external-music-dialog.tsx`：外部音乐客户端唤醒弹窗。

## 样式

`styles/chat.css` 和 `styles/checkphone.css` 是导入清单，功能规则放在对应子目录中。
保持导入顺序，避免改变同等优先级规则的覆盖关系。

阅读书架、阅读器、批注及阅读聊天样式集中在 `styles/reading.css`。
查手机的基础页面、极简皮肤、统一标题栏和滚动保护分别存放；皮肤与标题栏规则在页面规则之后加载。
`styles/checkphone/xiaohongshu-actions.css` 保留查手机仍在使用的操作状态规则，加载位置沿用原独立小红书样式的位置。

功能私有动画使用功能前缀，例如 `gameModalFadeIn`，避免覆盖公共弹窗动画。
相同的公共动画只在 `styles/animations.css` 维护。

普通 `text-*` 字号共用 `app/globals.css` 中的 `--text-*` 变量，再应用用户的 `--app-text-scale`。
`ts-N` 是已有的紧凑字号约定，基准为标称 N 的 90%；两套约定均保持整理前的实际尺寸。

## 历史模块与构建配置

未接入当前桌面的独立小红书模拟页面和演示投屏组件已退役。
小红书存储、提示词预览、媒体维护和记忆模块仍有现有调用，继续保留。
真实小红书与抖音入口由 `CompanionSocialApp` 及安卓原生陪伴能力承接。

本轮整理保留了既有的 TypeScript/ESLint 构建兼容开关。
结构整理不代表历史类型错误已经修复；恢复构建检查应单独处理。
