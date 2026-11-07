# Float 小手机 · 安卓壳（FloatShell）

一个极薄的安卓 App 壳：全屏 WebView 直接加载你自己的线上站点，外加一个**不依赖 Google 服务**的
离线推送长连接。目标用户：安卓机上收不到 Web Push 的用户
（国行机无 GMS、或所在网络到不了 Google 推送服务器）。

## 它解决什么

| 能力 | 网页版（安卓 Chrome） | 安卓壳 |
| --- | --- | --- |
| 页面功能 | ✅ | ✅ 完全一致（加载同一网页） |
| 离线推送 | 依赖 FCM（需 GMS + 能连 Google） | ✅ 自建 Supabase Realtime 长连接，无 GMS 也能收 |
| 网页更新 | 自动 | ✅ 同样自动（壳只是浏览器，部署即生效） |

推送链路：`push-generate` 边缘函数生成完离线消息后，除了发 Web Push，
还会向 Supabase Realtime 的个人频道 `shellpush:<userId>` 广播一份；
壳内前台服务保持一条 WebSocket 长连接订阅该频道，收到即弹系统通知。
设置页的「测试」按钮走同一条链路，可直接验证。

## 一键构建（GitHub Actions）

仓库已带工作流 `.github/workflows/android-shell.yml`：

1. 在仓库 **Settings → Secrets and variables → Actions → Variables** 新建
   `SHELL_SITE_URL`，值为你的 HTTPS 站点地址。手动运行工作流时也可以临时填写
   `site_url`，它会覆盖仓库变量。
2. GitHub 仓库页 → **Actions** → **Build Android Shell APK** → **Run workflow**。
   （改动 `android-shell/**` 并推到 main 也会自动触发。）
3. 跑完后在该次运行的 **Artifacts** 里下载：
   - `float-shell-debug` —— debug 签名，**下载即可直接安装**，日常自用选这个；
   - `float-shell-release` —— 未配置签名密钥时是未签名包（装不了），配置后是正式签名包。

### 正式签名（可选，想长期分发再做）

本地生成一个密钥库（一次性）：

```bash
keytool -genkeypair -v -keystore shell.keystore -alias floatshell \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 shell.keystore   # 得到一长串 base64
```

在仓库 **Settings → Secrets and variables → Actions** 添加四个 Secret：

| Secret | 内容 |
| --- | --- |
| `SHELL_KEYSTORE_BASE64` | 上面 base64 输出 |
| `SHELL_KEYSTORE_PASSWORD` | 密钥库密码 |
| `SHELL_KEY_ALIAS` | `floatshell`（或你起的别名） |
| `SHELL_KEY_PASSWORD` | 密钥密码 |

之后每次构建的 release 包即为已签名版。注意：debug 包和 release 包
签名不同，互相覆盖安装前要先卸载旧的。

## 安装与首次设置

1. 把 APK 传到手机（微信文件传输助手 / 网盘 / 数据线均可），点开安装，
   系统提示「未知来源」时允许本次安装。
2. 打开 App → 正常登录账号。
3. 允许**通知权限**（首次启动会弹）。
4. 保活（收推送的关键，尤其国产 ROM）：
   - 系统设置里把「小手机」加入**电池优化白名单 / 无限制后台**；
   - 允许**自启动**（小米/华为/OPPO/vivo 在各自的手机管家里）;
   - 最近任务里把它**锁定**（下拉卡片 → 锁），避免一键清理杀掉。
5. 通知栏会有一条「小手机 · 后台连接」的常驻小通知——这是长连接保活的
   代价。不想看到可以长按它 → 把「后台连接」这个通知渠道关掉显示，
   **不要关「角色消息」渠道**。

### AI 伴侣一起刷小红书 / 抖音

需要包含此功能的 1.2.0 或更新版安卓壳，手机中安装对应 App，并给角色配置支持识图的模型。
点击桌面「小红书」或「抖音」，会带当前已召唤的角色直接打开真实 App；尚未召唤角色时，
先在入口选择角色。抖音图标会通过原有桌面布局补全机制加入已有用户的桌面。

首次启动陪伴需允许悬浮窗和系统屏幕共享。开启后显示角色头像，拖动可移动位置，
点击会临时隐藏自己的悬浮窗，再截取当前屏幕交给原有角色聊天链路生成回复。
回复在原 App 上方的小面板显示，也同步保留在该角色原有聊天记录中；可以继续输入文字，
或点「看看当前屏幕」重新读取。截图发往用户自己配置的模型 API，受保护的页面无法读取。
点击面板「收起」可继续浏览，点击 ×、通知栏「关闭陪伴」或系统停止共享均可结束陪伴。
若小手机被系统关闭，需返回重新启动陪伴。网页版入口会提示使用新版安卓 App。

截图取帧和行填充处理复用并改编自 [ScreenSeek](https://github.com/hashierholmes/ScreenSeek)
的 `ScreenCaptureService.java`（MIT，完整许可见 `third-party/ScreenSeek-LICENSE.txt`，同时包含在 APK assets 中）。
保留同一个 MediaProjection / VirtualDisplay，仅在用户点击时连接截图 Surface，
以适配 Android 14 起的单次授权使用规则。角色、人设、API、聊天和记忆均沿用现有应用实现。

设置 → 离线推送里点「测试」：杀掉后台，约 6 秒后应收到系统通知即为连通。

## 数据存放与迁移

壳内网页数据（聊天记录、角色等）存在 App 自己的 WebView 沙箱里，
和手机浏览器**不互通**。从浏览器搬家：

- 浏览器里 设置 → 数据管理 → **导出备份**，壳里同一入口**导入**；
- 或两边都登录同一账号，用**云端备份**过渡。

卸载 App 会清掉壳内数据，卸载前记得先导出或云备份。

## 更新模型

- **网页功能更新**：零成本。壳加载的是线上站点，Netlify 一部署，壳里即刻生效。
- **APK 更新**：只有改壳本身（推送逻辑、原生能力）才需要重新构建安装，预期很少。

## 实现速览

```
android-shell/
├── app/src/main/java/app/floatphone/shell/
│   ├── MainActivity.kt   # 全屏 WebView：站内导航/外链/文件选择/下载/返回键
│   ├── PushService.kt    # 前台服务：借 WebView Cookie 取配置 → WS 长连接订阅 shellpush:<userId>
│   └── BootReceiver.kt   # 开机自启
└── ...gradle 工程
```

- 壳的 UA 追加了 ` FloatShell/<版本>`，网页可借 `window.AndroidShell`
  或 UA 识别壳环境；桥上有 `getVersion()` / `openAppSettings()` /
  `requestIgnoreBatteryOptimization()` 三个方法。
- 推送服务首次连上后会向站点注册一条合成订阅（endpoint `shell:<userId>`），
  用途是让离线消息排期的「账号已订阅」门控放行；服务端对它只做
  Realtime 广播，不做 Web Push 投递。
- 壳内设置页的「离线推送」开关由壳自动接管（显示为已开启且不可关），
  Web Push 在 WebView 里本来就不可用。

## 服务端前提

- Supabase 项目已按 `docs/push-supabase.sql` 配好离线推送（pg_cron + 边缘函数）。
- `supabase/functions/push-generate/index.ts` 需要是包含 shellpush 广播的最新版
  （改动后需重新部署边缘函数）。
- Realtime 广播用 service key 直接调 HTTP API，无需额外建表或改配置。

## 独立安卓版的 Node 运行时

独立 APK 的网页服务在手机内运行 Node.js Mobile；线上 WebView 壳不启动 Node。本项目固定使用 Node.js **24.22.1**，对应安卓完整包 **24.22.1-0**，主项目与安卓打包副本采用相同配置。

- `.nvmrc` 固定构建机 Node 版本；`package.json` 和锁文件声明 Node 24 范围。
- `node-runtime.json` 固定完整运行时下载地址、SHA-256、ABI、NDK r27d 与 CMake 版本。
- 构建前运行 `python3 scripts/install-android-node.py --install-toolchain`，下载并安装匹配的运行时及原生工具链。安装器先核对 SHA-256、头文件版本和目标 ABI，再替换 `app/libnode`。
- 本地已有完整 ZIP 时，可在项目根目录运行 `python scripts/install-android-node.py --archive <完整包路径>`，只安装该运行时，不构建应用。
- APK 保留 `arm64-v8a` 和 `x86_64`；JNI 使用 C++20、共享 C++ 标准库及 16 KB 链接对齐；Node 启动前设置应用私有缓存目录为 `TMPDIR`。
- 上游 `fogtape/nodejs-mobile` 将 24.22.1-0 标记为预发布版。此次只完成版本配置、文件安装和静态核对，没有运行测试、构建或生成新 APK，不能视为真机兼容性验证。

参考：[移动端发布包](https://github.com/fogtape/nodejs-mobile/releases/tag/v24.22.1-0)、[原生嵌入说明](https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/EMBEDDING.md)、[Android 16 KB 对齐](https://developer.android.com/guide/practices/page-sizes)。
