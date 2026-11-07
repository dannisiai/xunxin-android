# 聊天文档附件

线上聊天点「＋ → 文档」，线下聊天点输入栏的文件图标，选择文件并预览后发送。
支持 Word（DOC / DOCX）、TXT、PDF、Markdown、CSV、JSON、LOG、YAML。
单个文件最多 30 MB；本次模型上下文最多包含前 60,000 字，PDF 最多读取前 200 页。
节选会在发送前及文件卡片中明确标出，原文件仍完整保存在现有媒体 IndexedDB 中。

文档在当前应用服务器内解析（独立安卓版由手机内的 Node 服务解析），不调用第三方转换网站。
提取的文字通过原有角色聊天链路发送到用户配置的模型，沿用人设、预设、记忆和 API。
文档正文以普通用户资料加入上下文，不作为系统提示词。线上单聊、群聊和线下历史均保留正文。
线下生成失败或被停止时，文档会回到输入栏待发送；重试一轮对话也会保留该轮附件。

文件卡片可以展开查看正文、保存原文件。新版安卓壳通过系统文件选择器保存，无需额外存储权限。
扫描 PDF 的图片内容不做 OCR；无可提取文字时提示先识别文字或改发图片。
密码保护及损坏文件会显示读取失败原因。

## 复用来源

- PDF 的逐页提取及文字清理流程改编自 SillyTavern 的 `extractTextFromPDF` / `postProcessText`：
  https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/utils.js
  上游为 AGPL-3.0，改编代码按本项目 AGPL-3.0-only 发布，完整许可见根目录 `LICENSE`。
- SillyTavern 的 Office 入口依赖其 Express 插件路由，无法直接用于此 Next.js / 安卓壳：
  https://github.com/SillyTavern/SillyTavern-Office-Parser/blob/main/src/index.ts
  本项目沿用其「先提取文字，再作为聊天资料」的流程，Word 解析直接使用 MIT 许可的
  `word-extractor`：https://github.com/morungos/node-word-extractor ，未自行实现 Word 二进制解析。
- PDF.js 通过 `unpdf` 1.4 的服务器版本加载，适配现有 Next.js 服务与安卓 Node 运行环境，
  不需要浏览器 CDN 或本地 canvas 二进制依赖：https://github.com/unjs/unpdf/tree/v1.4.0 。
- TXT 编码处理复用现有 `lib/reading-parser.ts` 的 `decodeTxtArrayBuffer`。
- 文件原件、消息、预览和下载继续使用现有媒体存储与聊天组件。

依赖及其许可由 npm 锁文件管理。独立安卓包需要重新构建才会包含新依赖与保存桥。
本次修改未运行测试、类型检查或构建。
