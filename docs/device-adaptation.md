# 手机、平板与双屏适配

本次补齐的是源码实现。遵照用户要求，没有运行测试、类型检查、构建、模拟器或真机，也没有生成新的 APK。不能把源码覆盖范围当成所有设备的实测通过率。

## 布局策略

| 场景 | 行为 |
| --- | --- |
| 手机、窄窗口 | 使用实际窗口尺寸；桌面六行图标在短屏可上下滚动；应用内容在窗口内滚动。 |
| 平板、触屏大窗口 | 占满可用窗口；聊天宽度达到 760 CSS px 时显示联系人与聊天双栏，小窗口自动回到单栏。 |
| Surface Duo 等纵向双屏 | 按真实屏段的左、上、宽、高放置聊天两栏，中间留出铰链；每栏至少 280 CSS px 才启用双栏。其他应用使用一个完整屏段。 |
| 横向分屏、桌面姿态 | 使用较大的完整屏段，避免把输入区、按钮或阅读内容放在横向铰链上。 |
| 横竖屏切换、窗口缩放 | 保留聊天室组件、输入状态和当前消息阅读位置；接近底部时继续跟随新消息。 |
| 软键盘 | 采用 visualViewport 可见区域；安卓原生 adjustResize 已缩小的高度不会重复扣除；键盘弹出不触发设备类型切换。 |
| 弹窗、独立页面 | 通用弹窗按操作所在屏段和键盘可见区域限制位置与大小；筑境、资格申请和管理页面使用安全屏段并保留滚动。 |
| 原生悬浮陪伴 | 头像与回复面板限制在可用屏段内；处理系统栏、屏幕缺口、旋转和已知铰链；面板跟随头像所在屏。 |
| 原生来电页 | 按可用屏段布局，短屏缩小留白和按钮间距，长名字允许两行。 |

聊天的单双栏切换使用相同的 DOM 父级，不通过重复渲染两套聊天室实现。桌面拖动按实际网格行高、缩放与滚动偏移计算位置。PWA manifest 允许旋转，网页保留系统缩放能力。

## 几何来源与回退

1. 安卓壳使用 AndroidX WindowManager 的 FoldingFeature。窗口坐标先转换为 WebView 局部坐标，再按实际 CSS 视口缩放；原生悬浮窗单独使用屏幕像素坐标。
2. 浏览器优先使用 `window.viewport.segments`，兼容既有分段接口；缺少 JS 接口时读取 `env(viewport-segment-*)` 的实际值。
3. 浏览器或设备不提供分段几何时，回退到普通响应式单窗口。不会根据机型名称或“各占一半”推测铰链。

悬浮服务通过 `OverlayFoldMonitor` 复用现有 AndroidX WindowManager 1.3.0 的非 Activity 窗口接口：在 Android 11 / API 30 及以上创建 `TYPE_APPLICATION_OVERLAY` 专用 WindowContext，悬浮头像、面板和 WindowManager 均使用该上下文；在服务生命周期内订阅折叠事件，不受主 Activity 的 STARTED 状态限制。系统扩展版本至少为 2 时启用独立折叠信息。新观察按单调时间排序，已确认的独立结果不会被旧主界面缓存覆盖；主界面更新的有效观察也可以纠正已经过时的服务数据。不增加新依赖。

监视器同时监听窗口配置和显示变化，变化时立即作废旧订阅，重算位置并重新订阅，关闭服务时取消协程及各监听器。复用协程 `retryWhen` 对暂时的注册异常最多重试两次（250/500 ms），取消、权限和不支持接口的异常不会反复重试。订阅的显示区域或尺寸已变化时，排队到达的旧回调不会覆盖新数据；接口异常和一直没有数据时使用回退，服务不等待首条折叠事件才能显示。

`OverlayFoldGeometry` 统一检查特征边界和方向，接受真实铰链及零宽/零高分隔折痕，拒绝越界、反向或不贯穿窗口的特征。覆盖完整显示区域的、几何有效且明确不再分隔的折叠特征可直接清除铰链。多个无法表示的分隔特征回退，避免只取第一个却遗漏另一处铰链。

`OverlayFoldObservation` 复用协程 `channelFlow`、`first` 和超时取消，让 Activity 与 WindowContext 使用相同的空结果确认规则。第一次空列表只视为待确认，保留有效缓存；完整窗口稳定 750 ms 后保持主监听，另开一个临时订阅读取首条结果。新订阅仍为空且显示、旋转、当前区域均一致，才确认该窗口没有特征并清除旧铰链。每次读取最多等待 1500 ms，超时/异常最多尝试两次，中间等待 500 ms；失败、无回调、局部窗口、尺寸变化不会被当作铰链消失。出现非空结果或取消父监听时，待确认任务立即取消；重复空回调不会反复延后同一个确认任务。

缓存的观察时间使用 `elapsedRealtimeNanos`，旋转换算和 WebView 尺寸重算保留原时间。服务收到确认结果后同时更新共享缓存，并保存最后接纳时间；更旧的 Activity 回调不能恢复已经清除的铰链。主界面也只接纳更新的缓存，暂时空结果不会先清掉已有的网页折叠状态。重新订阅是读取 AndroidX 当前提供的数据，不能强制厂商刷新硬件，也无法证明持续上报错误空数据的厂商实现正确。

主界面与悬浮服务共用带有显示 ID、最大区域像素边界和旋转信息的缓存。只在显示相同、旋转后的像素尺寸完全匹配时换算旧坐标；尺寸或显示变化就作废，绝不按比例拉伸旧铰链。实际限位按 WindowContext 的**当前**区域及系统栏/缺口/键盘求交，将屏幕像素坐标转换为该区域的局部布局坐标；窄屏段缩小头像，不因不足 60 dp 就回退跨过铰链。

低版本、扩展版本不足、创建上下文失败、接口异常或尚未返回数据时，保留仍匹配当前显示的已知几何；没有有效几何时按当前窗口安全区域限位。厂商未提供几何时无法凭空得到实时铰链位置，不能宣称所有 Surface Duo 或其他设备均已实测通过。

第三方导入的 HTML/iframe 由其自身内容负责内部响应式排版，宿主保证容器处于安全屏段；用户自定义 CSS 仍可能主动覆盖布局。

## 自定义弹窗接入

75 个组件文件及 5 个路由文件中有 323 处显式声明（含装饰/内容排除和一处抽屉开关的条件声明）。覆盖音乐设置、音乐 CSS 编辑器、播放队列、确认框，以及日历、阅读导航、查手机、设置、资源中心、调酒、日记、文件夹等自定义弹窗。本轮增加 40 处声明，明确媒体/图片预览、组件/状态栏预览、消息菜单和筑境属性面板，以及页面容器、拖动残影、捕获层、加载画面与吐司的用途。已有专用锚点/箭头定位的聊天和阅读消息菜单声明为 `content`，保留其原有定位和外部箭头，避免统一卡片滚动裁掉箭头；其他浮动菜单使用卡片规则。通用 `.modal-overlay` / `.wb-modal-overlay` / `.modal-dialog` / `.modal-sheet` / `.modal-expand` 和 `role="dialog"` / `aria-modal="true"` 继续兼容。运行时不靠 `.fixed.inset-0` 或 z-index 猜测并修改弹窗。

遮罩按操作所在屏段、键盘可见区域、实际应用容器和祖先裁剪边界求**多边形**交集。`adaptive-geometry.ts` 复用浏览器的 `DOMMatrix` / `DOMPoint`；四个不可见基准点测量实际定位平面，再求完整投影变换及逆变换，包含旋转、斜切、非均匀缩放、透视、滚动和改变 fixed 包含块的 transform/filter/contain 祖先。支持 `getBoxQuads` 的浏览器直接复用真实四角；其他引擎用基准点换算。没有使用旋转后外接矩形的宽高比冒充逆变换。

可用区域逆投影到元素的局部坐标后取内接矩形，防止外接矩形跨越斜边；卡片按可行平移区域调整，调整后重新测量真实四角。保留原有 transform、动画、flex/grid 关系和 Tailwind 独立 translate 居中值；不将现有节点迁移出带样式作用域的父级，基准点也只在同步测量期间存在，帧结束前移除。位置/尺寸最多迭代八次，无法有限求解、穿过投影地平线、边缘朝向屏幕或不能装下的区域暂时隐藏，等待几何/动画变化后重算，避免写入 NaN 或越界坐标。完全不支持矩阵 API 的旧引擎保留原 CSS 布局。

原有遮罩内边距和系统安全区域共同生效，监听显隐、内容尺寸、滚动、视口和动画变化；变换动画进行期间逐帧测量，动画停止后停止连续测量。键盘出现或重新聚焦输入框时，只滚动弹窗自身的可滚动容器，滚动量在该容器自身的 CSS 坐标系计算，避免嵌套缩放时滚错距离。

新建自定义弹窗时，在 fixed/absolute 遮罩根节点添加 `data-adaptive-surface="overlay"`（独立整页也可用 `"fullscreen"`），在承载表单/列表的卡片添加 `"card"`。纯背景、点击关闭的独立遮罩用 `"decoration"`；字幕、吐司、上传提示、面板内部折叠内容用 `"content"`，不参与弹窗几何。常驻的抽屉可在关闭时声明 `"content"`、打开时声明 `"card"`。

`lib/adaptive-surface-contract.json` 是运行时和源码规则共用的接入约定。`scripts/check-adaptive-surfaces.mjs` 和 `scripts/adaptive-surface-analysis.mjs` 复用现有 TypeScript Compiler API 的 AST/符号解析，以及从 Next.js 依赖位置加载的 PostCSS 解析器，不新增包、不执行被检查的应用代码、不生成编译输出。检查支持常量引用、导入别名、字符串拼接/条件模板、简单样式函数返回值、对象/JSX 属性展开、内联 `position: fixed`、响应式 fixed 工具类、项目样式表和 CSS Modules 中的固定定位规则。固定层都应声明用途，语义弹窗不能排除为装饰；无需从高 z-index 猜测用途。

`npm run check:adaptive` 可单独执行，已接入 `prebuild`，后续构建发现漏标会停止；`--root` 可读取另一份源码进行检查。开发环境还会在初次加载、相关 DOM/样式变化、样式表加载和视口变化时检查受影响子树的真实 computed position，覆盖任意动态类名与运行时样式函数；只发出不含内容的诊断，不自动改动猜测出的层。普通滚动不反复扫描整棵 DOM，生产环境不执行诊断扫描。任意 JavaScript、复杂 CSS 条件及 CSSOM 的所有动态操作无法由静态规则完全推断，新组件仍须遵守显式约定。

本轮只运行上述静态源码规则、语法解析和镜像内容核对，没有运行应用/几何测试、完整类型检查、浏览器、Gradle 或 APK 构建。旋转/斜切/透视与键盘组合、空回调与姿态切换仍须后续真机验证。

## 小新 Pad Pro 12.7 与原生系统栏（2026-11-07）

手机截图中的顶部留白对应原生 `setDecorFitsSystemWindows(true)` 预留的系统栏区域，网页还绘制模拟时间/电池行。先前适配主要覆盖 Web 内容，不能据此认为原生窗口也已全面适配。平板桌面的格子上限为 88 px，实际图标仍被 58 px 规则限制，文字也沿用手机尺寸，导致大屏内容过小、空隙过大。截图外侧的视频播放器黑边和进度条不属于本应用。

复用已有 AndroidX Activity `enableEdgeToEdge`、Core `WindowInsetsCompat` / `WindowInsetsControllerCompat` 和 Window `WindowMetricsCalculator`；不新增依赖。`WebViewWindowController` 统一维护真实系统栏、刘海、平板任务栏、窗口标题栏及 IME；仅扣除系统尚未执行的键盘缩小量，避免与 `adjustResize` 重复缩小。原生通过缓存快照及事件发送 WebView 局部像素尺寸和安全边距，网页按当前 CSS 视口分别换算横纵坐标。壁纸覆盖完整窗口，应用内容避开系统栏；模拟时间和电池隐藏，保留用户开启的音乐灵动岛。系统图标明暗复用现有背景取色，进入音乐等暗色应用时一并更新。

小新 Pad Pro 12.7 的具体年份/型号尚未确认，用户回复“2026吧”，因此不假定某个型号或硬编码 2944×1840。使用实际可用窗口的 600/840 CSS px 宽度分档；窄分屏回到紧凑规则。桌面单页保存原有 4 列×6 行及位置，最新页面布局在普通平板可用宽度达到 840 CSS px 时并排展示两页，合计八列，折叠屏段与窄窗口显示一页。图标、间距和组件字体按单页实际宽度计算，短横屏允许桌面纵向滚动。用户的文字倍率继续生效，不修改已保存主题和桌面数据。

书架、歌单、榜单按实际容器宽度重排，主要操作维持触摸尺寸。后续布局重排已去掉整片应用内容统一乘以 1.15 的文字放大，改为按组件控制字号、行宽和密度。阅读悬浮窗按阅读容器及可见屏段限位，测量真实展开尺寸，横竖屏、分屏和键盘变化后重新约束。聊天/阅读的消息菜单复用已有投影几何，按屏段、应用及祖先裁剪区和键盘可见区定位，保留菜单箭头；窗口变化时关闭旧菜单。独立路由使用同一安全区域。

本次静态检查包含标记扫描、TS/TSX 与 CSS 语法解析及镜像核对，安装包通过 GitHub 云端构建；不运行测试或模拟器。源码修正不等于小新平板真机验收通过，原生系统栏变化需重新打包安装才能生效。

### 小红书／抖音返回路径

原生系统返回此前只调用 `WebView.goBack()` 或把任务移到后台，无法关闭没有新增网页历史的 React 陪伴设置页。现在先向当前网页发出可取消的 `android-shell-back` 事件；陪伴设置页处理后返回桌面并关闭陪伴，未处理时保留原生网页历史回退。

原生悬浮面板此前没有返回回调，且收起时只把 View 设为 `GONE`，窗口仍可持有焦点。现在收起面板同时释放焦点及返回回调，恢复时再注册；Android 13 及以上复用 `OnBackInvokedDispatcher`，旧系统处理 `KEYCODE_BACK`。面板内系统返回先收起键盘，再停止陪伴并回到寻信桌面；面板提供独立的“返回寻信桌面”按钮，通知点击也进入同一路径。Activity 使用独立 Intent 标记及网页就绪标记恢复 React 桌面，不靠整页重载，也不清除聊天和角色数据。只有头像悬浮在外部 App 时不抢夺外部 App 的系统返回事件。

参考：[Android 边到边显示](https://developer.android.com/develop/ui/views/layout/edge-to-edge)、[窗口大小分档](https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes)、[WindowMetricsCalculator](https://developer.android.com/reference/androidx/window/layout/WindowMetricsCalculator)。

## 平板页面与交互重排（2026-11-07 后续）

本轮以 Android Adaptive optimized / Tier 2 的页面和交互建议为实现参考；不把源码检查或构建成功写成官方质量认证。

| 页面／能力 | 实现 |
| --- | --- |
| 设置、外观、资源库 | 宽窗口常驻分类侧栏和独立滚动内容区；窄窗口保留单页流程。设置内仍在编辑的子页先通过现有返回流程结束编辑，避免直接切换分类丢弃输入。 |
| 角色 | 角色列表／世界画布侧栏与档案内容并列；编辑中的角色必须先保存或取消再切换。侧栏“桌面”退出复用编辑器当前的未保存检查：继续编辑、Esc 或关闭提示均保留草稿，明确选择“放弃更改”后才退出。画布卡片可用键盘聚焦与激活。 |
| 日记 | 角色日记分类侧栏；正文区域按容器重排卡片，保留字体和定时生成设置。 |
| 阅读 | 目录侧栏与正文并列；保留原书架自适应网格。Ctrl/Cmd 加减、0 和 Ctrl 滚轮调整正文/PDF 缩放；TXT 重分页保留段落与字符位置，而不是旧页码。 |
| 日历 | 宽窗口同时展示月历和日程，窄窗口一次显示一栏；已打开的日程保留挂载。窗口缩放后对齐选中日期，保留时间轴纵向位置。 |
| 聊天 | 根据实际聊天容器宽度决定单双栏，避免按整机宽度误判窄分屏。宽屏导航放在列表侧边；过窄折叠屏段保留底部导航，不挤压联系人列表。 |
| 音乐 | 音乐分类改为侧边导航；播放器宽屏同时显示封面／黑胶和歌词，进度、播放控制限制合理宽度。歌词按实际可见性跟随，播放进度支持键盘调整。 |
| 桌面 | 一／两页自适应展示，翻页指示、滑动范围、跨页拖放与保存坐标使用同一页组规则。布局变更中取消未提交的拖拽，恢复原始图标、组件、Dock 和文件夹事务。方向键移动焦点，PageUp/PageDown 翻页，右键进入整理。 |
| 表单与弹窗 | 表单行宽及网格按实际内容容器调整；宽窗口抽屉限宽；主要按钮使用 48 CSS px 触摸区域。共用弹窗处理初始焦点、Tab 循环、Esc／系统返回和焦点恢复。声明为自定义弹窗的层复用各自现有关闭动作；普通几何卡片不自动视为模态。 |
| 原生窗口 | Android Activity 继续拥有系统栏和多窗口处理；WebView 内不再跟随每次点击请求网页全屏。 |

`AdaptiveWorkspace` 始终保持同一内容 DOM，容器查询只改变侧栏与内容的排布。聊天、日历的实际窗口测量复用 `ResizeObserver`；不按型号、物理分辨率或浏览器 UA 固定平板画布。没有增加 npm 或 Android 依赖。

后续只读检查发现的两处遗漏已补齐：角色侧栏退出通过编辑器注册的离开守卫处理，不在父级猜测是否有未保存内容；阅读悬浮窗关闭／收起／发送、日历小按钮及角色画布菜单按钮使用至少 48×48 CSS px 的实际按钮区域。该尺寸规则不依赖 600 px 容器断点，窄分屏和折叠屏段同样生效；SVG 图标保持原尺寸。

页面重排、角色退出确认和 48×48 触摸区域已随 1.2.2（versionCode 5）云端构建发布。下节追加的滑动修复尚未重新打包。只做静态标记扫描、受影响 TS/TSX 文件的语法／类型分析、CSS 解析及镜像核对，不运行测试、应用或模拟器，也不下载文件。真机上的 ZUI 任务栏／分屏、不同字体倍率、窗口连续缩放以及第三方自定义 CSS／iframe 仍需实际验收；不能宣称所有设备已达到官方 Tier 2。

参考：[Android Adaptive optimized](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2)、[列表与详情布局](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail)、[多窗口支持](https://developer.android.com/develop/ui/views/layout/support-multi-window-mode)。

## 滑动与拖拽退出修复

- 桌面网格和有裁剪的图标／组件表面直接声明 `touch-action: pan-y`，正常模式让浏览器处理上下滚动，由桌面处理左右翻页；编辑模式在这些表面使用 `none`。不向应用内容区施加桌面的手势限制。
- 桌面的 `pointercancel`、捕获丢失、失焦、切后台、应用导航和窗口几何变化均取消当前操作、清除翻页偏移和长按计时，并回滚未完成的拖拽预览，不将取消误当作成功落位或翻页。
- `useTouchSort` 只修改所属滚动容器，不再写入 `body` 的滚动／触摸样式。触摸取消、多指介入、失焦、切后台、窗口变化、列表移除或组件卸载时清除计时器、动画帧、临时样式和触摸拦截，并恢复局部滚动状态。取消不提交排序；回调更新不打断正在进行的排序。
- 本次仅做静态检查与源码镜像核对，未运行测试、浏览器、应用或模拟器；仍需在出现问题的平板上确认上下滚动和左右翻页的实际体验。已发布的 1.2.2 APK 不包含本节修复。

手势依据：[W3C Pointer Events：手势与最近滚动容器](https://www.w3.org/TR/pointerevents3/#determining-supported-direct-manipulation-behavior)。

## 主要代码

- `lib/device-adaptation.ts`：视口、屏段、可见区域、原生桥接与变化事件。
- `lib/adaptive-overlays.ts`：显式弹窗接入、安全区域和键盘跟随。
- `lib/adaptive-geometry.ts`：投影坐标、凸多边形求交及卡片限位。
- `lib/adaptive-surface-contract.json`、`scripts/check-adaptive-surfaces.mjs`、`scripts/adaptive-surface-analysis.mjs`：共享标记约定和静态漏标防护。
- `components/chat/phone-chat-app.tsx`：稳定的聊天单双栏结构。
- `components/chat/use-adaptive-scroll-anchor.ts`：窗口变化时保留消息阅读锚点。
- `styles/adaptive.css`：最后加载的统一适配层。
- `styles/tablet-workspaces.css`：页面导航、内容密度、播放器、日历和输入设备样式。
- `components/ui/adaptive-workspace.tsx`、`use-pane-size.ts`、`use-page-back.ts`、`use-dialog-focus.ts`：共用布局、实际容器测量、返回及弹窗焦点。
- `lib/adaptive-input.ts`：显式自定义弹窗的键盘行为及语义按钮激活。
- `android-shell/.../MainActivity.kt`、`CompanionOverlayService.kt`、`FoldSafeContent.kt`、`OverlayFoldMonitor.kt`、`OverlayFoldGeometry.kt`、`OverlayFoldObservation.kt`：原生窗口几何、订阅边界、空结果确认与布局。

## 参考

- [TypeScript：Compiler API、AST 与符号查询](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [PostCSS：parse 与规则/声明遍历](https://postcss.org/api/)
- [Android：WindowLayoutInfo 空列表的含义](https://developer.android.com/reference/androidx/window/layout/WindowLayoutInfo#getDisplayFeatures())
- [Kotlin：channelFlow 的子协程生命周期](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/channel-flow.html)
- [Kotlin：first 读取首条后取消收集](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/first.html)

- [W3C：DOMMatrix、DOMPoint 及原生逆变换](https://www.w3.org/TR/geometry-1/)
- [Floating UI：裁剪与 Portal 的适用边界](https://floating-ui.com/docs/misc)（现成库的常规定位不能直接替代此处投影和作用域需求，因此复用原生矩阵 API，自行实现项目特有的几何求交。）
- [Kotlin：retryWhen 的取消与上游异常语义](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/retry-when.html)
- [Android：折叠特征的窗口坐标与分隔语义](https://developer.android.com/reference/androidx/window/layout/FoldingFeature)
- [Android：Display 旋转方向及当前窗口尺寸](https://developer.android.com/reference/android/view/Display#getRotation())

- [Android：非 Activity 窗口的折叠信息接口及扩展版本条件](https://developer.android.com/reference/androidx/window/layout/WindowInfoTracker)
- [Android：WindowContext 创建方式及官方悬浮窗示例](https://developer.android.com/reference/android/content/Context#createWindowContext(int,%20android.os.Bundle))
- [AndroidX GitHub：WindowInfoTracker 源码](https://github.com/androidx/androidx/blob/androidx-main/window/window/src/main/java/androidx/window/layout/WindowInfoTracker.kt)

- [Android：让应用感知折叠状态](https://developer.android.com/develop/adaptive-apps/guides/foldables/make-your-app-fold-aware)
- [Chrome：Viewport Segments API](https://developer.chrome.com/blog/viewport-segments-api-shipped)
- [MDN：使用 Viewport Segments API](https://developer.mozilla.org/en-US/docs/Web/API/Viewport_segments_API/Using)
- [WebKit：安全区域与 viewport-fit](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)

待真机确认的重点：Surface Duo 横纵向跨屏、半折叠、屏幕键盘、平板分屏/自由窗口、iOS Safari/PWA 安全区，以及外部小红书/抖音中悬浮窗在姿态变化后的表现。
