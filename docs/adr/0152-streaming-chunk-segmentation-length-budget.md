# ADR-0152：超过逐字预算的流式尾块不再做短语分段

## 状态

已接受。补充 ADR-0131 的流式渲染预算与 ADR-0151 的镜像态语义，不改变 `MarkdownContent` 公共属性、消息持久化或 reveal 节奏。

本项是**减少长流式尾块每次重解析的 DOM 装饰量**，不是 React #185 的修复项——用户消息路径不经过分段，详见下文「本项不覆盖 React #185 的用户消息路径」。

## 背景

`rehypeStreamingChunks`（`packages/theme-ui/src/markdown/streaming.ts:20`）把流式尾块正文按短语包成 `<span class="streaming-chunk">`，最后两个短语额外加 `-latest` / `-recent`。`MarkdownContent` 用它做两件事：`MarkdownDocument` 的 rehype 插件表（`MarkdownContent.tsx:108`）与包裹类 `markdown-streaming-tail`（`MarkdownContent.tsx:406`）。

这套装饰原本配合「最新短语略暗」使用，但压暗已被移除：`apps/desktop/src/renderer/styles.css:795-809` 里 `.markdown-streaming-tail .streaming-chunk-recent` 与 `-latest` 都是 `color: currentColor`，注释写明「去掉压暗后流式状态由文字逐字出现本身表达」。**也就是说这两个类当前不产生任何视觉差异**，分段剩下的作用只有 DOM 结构。

同时，本仓给长文本加了预算：`STREAM_ANIMATE_MAX_CHARS = 12_000`（`28b33db39`）让超过上限的尾块退出逐字 reveal，`resolveStreamRenderInterval`（`6f7b1eadb`）按整篇长度把重解析间隔抬到 200 / 400ms。但**分段没有跟着退出**：`chunkedRef` 一旦被 `animateChunks`（state）置真就粘到实例卸载（`MarkdownContent.tsx:174-176`、`:388-392`），而跨过阈值后 `animateChunks` 在整个流式期恒为真（ADR-0151 已记录，审计探针 `animate = ["true"×8]`）。于是 >1.2 万字符的回复在流式全程满足：

- `MarkdownDocument` 每次重解析都跑一遍 `rehypeStreamingChunks`，遍历整棵树并重建全部 span。遍历本身很便宜（真实 hast 上占插件耗时的 **0.5%**，`.scratch/bench-n10.mjs` R2：120k 上 walk-only 0.12ms、插件整趟 24.16ms CPU），主成本是构造 span 元素并重装父节点的 `children`；
- 分段密度随树形变化：同质合成段落树上约 5 字符一个 span（150 字符一段 → 30 个）；真实 markdown hast 上散文形态约 10.9 字符一个（120k → 10 986 个），结构性形态约 11.0 字符一个（120k → 10 917 个）。两套口径都不小，且每次重解析都要重新创建并被 React 调和。
- 被分段的是尾块（最后一个已闭合顶层围栏之后的全部文本，`stable-blocks.ts:89`），而真实内容里尾块往往就是全文：295 条真实压缩摘要中已闭合顶层围栏数 p50 = 0；30k 字符样本中 0 围栏时尾块占 100%，1 围栏降到 49.6%，2 围栏降到 24.7%。

实测（本机，只测插件本身）。**成本随树形而非字符数变**，引用时必须写明哪一种。先看量级基准——`.scratch/bench-chunks.mjs` 的同质合成段落树（150 字符一段），7 次取中位数：

| 正文长度 | `rehypeStreamingChunks` p50 | min | max |
| --- | --- | --- | --- |
| 20 000 字符 | 0.91ms | 0.78ms | 2.49ms |
| 50 000 字符 | 2.34ms | 1.90ms | 2.82ms |
| 120 000 字符 | 6.23ms | 5.38ms | 7.09ms |

真实 markdown → hast 的整趟耗时、span 数与节点膨胀见下文「性能依据（本轮独立复核）」的表——该表以本轮 9 次中位数为口径，取代上一轮引用的两组百分比。

同一 120k 口径下三种树形的插件整趟耗时：合成树 6.23ms、真实散文 5.45ms、真实结构性 3.79ms；`.scratch/bench-n10.mjs` 的 CPU 口径则是结构性 24.16ms、散文 17.12ms（1.41×）。**上一轮正文写的「两种树形相差 2.25×」无法复现**（按当时那组数字只有 1.31–1.41×），本轮不再引用该倍数。

两个 harness 都对负载敏感：审计轮在 load 5.04 下复跑合成树得 p50 1.52 / 2.06 / 5.51ms，与上表相差 2.08×。引用合成树时应取区间而不是单点值。

对照仓内 parse-only bench 的解析成本（20k 19–23ms / 120k 148ms，见 ADR-0151）：插件在真实 markdown hast 上约占整链的 **13–16%**（按节流折算：20k 15.2% / 50k 16.3% / 120k 13.1%）。它额外带来的是 DOM 元素数量 +21%（结构性 12k）到 +147%（散文），这部分不计入上面的插件计时。

本项和 ADR-0151 的镜像态提交不是同一件事：ADR-0151 消除的是**每增量多一次提交**，本项消除的是**每次重解析里一份没有视觉作用的 DOM 装饰**。上一轮曾试图用「镜像态返回 `animateChunks: false`」一并解决，被既有断言否证（`TextBlockView.streaming.test.tsx:139` 要求收束时 `markdown-streaming-tail` 仍在一拍），因此这里不能按 `active` 分支处理，只能按长度预算处理。

### 本项不覆盖 React #185 的用户消息路径

#185（`Maximum update depth exceeded`）的现场栈首帧是 `MarkdownContent`，但调用栈里同时出现 `UserMessageView` / `UserMessage` / `WriteContentView`。逐条核对后，**用户消息路径根本不经过分段**，因此本项不是 #185 的修复项，也不能被记为 #185 的修复项：

- 用户消息渲染 `TextBlockView` 时**没有传 `isStreamingTail`**（`apps/desktop/src/renderer/domains/conversation/components/message-list/UserMessage.tsx:129-133`），于是 `shouldRevealStreamingTail(text, false)` 恒为假（`streaming.ts:99-101`）→ `useStreamingDisplayText` 走镜像态 → `animateChunks` 初始为假且布局相里被置假（`streaming.ts:138`、`:237`）→ `chunkedRef` 永不为真（`MarkdownContent.tsx:176`）→ `chunkTail` 恒为假（`MarkdownContent.tsx:179`）→ `rehypeStreamingChunks` **从未挂上**。
- 端到端复核（真实 `MarkdownContent` 渲染，13 000 字符）：用户消息路径下 `.streaming-chunk` 数量为 0，`.markdown-streaming-tail` 不存在；同一段文本作为助手尾块（`isStreamingTail=true`）时同样为 0（后者由本项的预算门控保证）。
- `useOpenActivityTab`（栈里出现的位置）只在 `PlanEntryCard` 与 `useInputBarPanelModel` 的事件回调里写 atom，不在渲染期写状态；`UserMessageText` 的溢出测量（`packages/theme-ui/src/chat/UserMessageView.tsx:91-116`）用 `setCanExpand` 写布尔值，测量结果翻转时 React 会因同值 bailout，不构成嵌套更新回路。

因此本项的正确定位是：**减少长流式尾块每次重解析的 DOM 装饰量**，与 #185 的修复（ADR-0151 的镜像态派生、ADR-0131 的长度预算与节流）分属两件事。#185 的修复依据是 `SessionConversation.compaction-stream.test.tsx` 的两条回归用例（断言不出现 `Maximum update depth`），不是本项。

### 性能依据（本轮独立复核）

以下数字由本轮在真实 markdown → hast 链路上独立复现（`unified` + `remark-parse` + `remark-gfm` + `remark-rehype`，再直接调用 `rehypeStreamingChunks()`），样本沿用 `.scratch/bench-n10.mjs` 的 `makeSummary` / `BLOCK` 构造。9 次取中位数，括号内为 min / max：

| 形态 | 字符数 | 预算内 | 插件整趟 p50 | span 数 | 基础节点 | 分段后节点 | 节点膨胀 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 散文（无围栏/表格/代码） | 12 000 | 是 | 0.56ms（0.41/1.13） | 1 099 | 1 269 | 3 129 | +146.6% |
| 散文 | 13 000 | 否 | 0.68ms（0.44/1.71） | 1 191 | 1 377 | 3 392 | +146.3% |
| 散文 | 120 000 | 否 | 5.45ms（4.50/6.77） | 10 986 | 12 678 | 31 269 | +146.6% |
| 散文 + 1 围栏 | 120 000 | 否 | 5.75ms（5.28/18.65） | 10 981 | 12 676 | 31 259 | +146.6% |
| 散文 + 2 围栏 | 120 000 | 否 | 5.69ms（5.17/6.40） | 10 972 | 12 668 | 31 236 | +146.6% |
| 结构性（表格/加粗/代码齐全） | 12 000 | 是 | 0.15ms（—） | 466 | 2 949 | 3 570 | +21.1% |
| 结构性 | 13 000 | 否 | 0.20ms（—） | 504 | 3 203 | 3 875 | +21.0% |
| 结构性 | 120 000 | 否 | 3.79ms（2.97/4.67） | 10 917 | 19 652 | 35 480 | +80.5% |

两点需要写明：

1. **节点膨胀不是常数。** 散文形态是 +146.6%，因为基础树只有 12 678 个节点而 span 有 10 986 个；结构性形态在 120k 时是 +80.5%，在 12k 时只有 +21.1%——分母（基础节点数）随结构密度变化，分子（span 数）随字符数变化。**不能把 span 数当唯一成本自变量，也不能引用单一膨胀百分比**。
2. **上一轮 ADR 正文里写的「真实 hast 120k 结构性 +22.0% / 散文 +54.2%」这两个百分比与本轮复核不符**（本轮同口径得 +80.5% / +146.6%）。span 数（结构性 5 745 / 散文 10 986）与节点总数（31 761 / 31 269）是能对上的，但百分比取决于分母取的是哪次采样的基础节点数。本轮以 `.scratch/bench-n10.mjs` 的 `makeSummary` 构造重跑 9 次取中位数，上一版的两个百分比不再引用。

插件本身的遍历成本仍远小于建 span：`.scratch/bench-n10.mjs` 的 R2 在 120k 上测得 walk-only 0.12ms、插件整趟 24.16ms（CPU），即 **99.5% 的插件耗时花在构造 span 元素与重装父节点 `children` 上**，遍历可以忽略（`Observed`，本轮复跑同脚本得到 24.16ms / 0.12ms）。

## 决策

- 用与 reveal 相同的预算约束分段：新增 `STREAM_CHUNK_MAX_CHARS`，取值等于 `STREAM_ANIMATE_MAX_CHARS`（12 000）。`displayText.length` 超过它时，尾块 `MarkdownDocument` 不再挂 `rehypeStreamingChunks`，因此不再产生 `.streaming-chunk` span。**门量的是整篇显示文本，不是尾块自身长度**：尾块长度恒 ≤ `displayText`，所以这个保守口径只会让「长消息里已闭合围栏之后的一小段尾巴」也失去分段，不会出现「尾块超预算却仍挂插件」的反向错误。
- `chunkedRef` 的粘性语义保留在预算之内：流式结束时 `animateChunks` 要等 `settle` 才关，此刻撤插件会让尾块整段重挂（`MarkdownContent.tsx:388-392` 描述的「卡一下」），所以预算内仍然只置真不清零；预算之上把它的结果与长度门取交集，使超限后不再分段。
- 包裹类 `markdown-streaming-tail` 继续由 `animateChunks`（state）驱动，不随分段一起关：它现在只剩后代选择器规则（`styles.css:798-806`），没有 span 时无视觉效果，保留它可以少一处状态分支。
- reveal 节奏、扣留、`settle` / `settleIdle`、ADR-0151 的镜像态派生与显示文本对齐都不动；`MarkdownContent` 的公共属性、消息持久化不变。

## 备选方案

| 方案 | 取舍 |
| --- | --- |
| 维持现状 | 超限回复每个重解析窗口都多建数千到两万多个无视觉作用的 span（真实 hast 120k：结构性 10 917 个、散文 10 986 个），插件整趟 3.79–5.75ms（结构/散文），且这些 span 每次重解析都要重建，不采用 |
| 只在镜像态（`active === false`）关分段 | 与收束行为冲突：`TextBlockView.streaming.test.tsx:139` 要求回合结束那一拍 `.markdown-streaming-tail` 仍在、`:143` 才消失；上一轮实测红（`expected null not to be null`），不采用 |
| 保留插件但只给最后 2 个短语包 span | 它确实能省掉插件的大部分成本（遍历只占 0.5%，成本在建 span），但要在同一份尾块上维护「全段分段 / 只分段末尾 / 完全不分段」三套形态，并让 `streaming.test.ts` 的 chunk 类序列契约出现长度分支；末尾那几个 span 还会每帧重建。复杂度与收益不匹配，不采用 |
| 彻底删掉分段与 `markdown-streaming-tail` | 短回复的既有 DOM 契约（`streaming.test.ts` 的 chunk 类序列、桌面三条 `.markdown-streaming-tail` 断言）会一起消失，超出本项范围，不采用 |
| 把 span 换成不改 DOM 的等价物（如行内标记 + CSS 生成内容） | 需要改 rehype 输出结构并重写断言，收益只是省掉 span，风险更大，不采用 |

## 后果

- 超过 1.2 万字符的流式尾块不再包含 `.streaming-chunk` span，每个重解析窗口省掉数千到两万多个 span 的创建与调和（真实 hast 120k：结构性 10 917 / 散文 10 986；遍历本身只占插件耗时的 0.5%，成本几乎全在建 span 与重装 `children`）。
- 预算边界实测（真实 markdown → hast，散文形态）：12 000 字符时 1 099 个 span、节点 1 269 → 3 129（+146.6%）；13 000 字符时按本项决策不挂插件，span 为 0，节点停在 1 377。**省下的正是那 1 191 个 span 与约 2 015 个节点**。结构性形态同口径：12 000 字符 466 个 span（+21.1%），13 000 字符降为 0。
- 跨过预算的那一刻尾块会带着新插件表重渲染一次。这一帧本来就会发生重渲染：同一预算同时是 ADR-0151 里 `active` 由真翻假的边界，显示文本在那一次从「已放出的前缀」跳到全文。
- 可见表现不变：`-latest` / `-recent` 当前都是 `currentColor`，去掉 span 前后没有像素差异；预算内的短回复分段、以及收束时包裹类停留一拍再撤的生命周期完全保留（它现在已经不带视觉差异，详见 `styles.css:795-809` 与去掉亮度分层的 `c6fa76b1a`）。
- **本项不修复 React #185**：用户消息路径不传 `isStreamingTail`，`rehypeStreamingChunks` 在那条路径上从未挂载（见上文「本项不覆盖 React #185 的用户消息路径」）。#185 的修复依据是 ADR-0151 与 ADR-0131，回归由 `SessionConversation.compaction-stream.test.tsx` 守住。
- 这是本仓自加预算后的收尾，不是「向参照实现对齐」：参照实现没有 1.2 万字符上限、没有分段长度门，长文本始终逐字 reveal。
- 不承诺端到端帧率；本项只去掉一份可以证明没有视觉作用的重复工作。

## 迁移与验证

没有数据迁移，消息仍保存原始 markdown。

验证以三类可失败断言为准：预算内（短文本）分段仍在、收束时 `markdown-streaming-tail` 停留一拍再撤（`streaming-chunks-budget.test.tsx`）；预算之上（>12 000 字符）尾块内 `.streaming-chunk` 数量为零且插件未被挂上；用户消息路径本就不经过分段（`streaming-chunk-path.test.tsx`）。既有不变量测试原样通过，一条不放宽。

「不能改成按 `active` 分支」这条约束由既有断言守住：`MarkdownStreamingDimLifecycle.test.tsx` 要求回合收束后 `.streaming-chunk` 仍在，`TextBlockView.streaming.test.tsx:139` 要求 `.markdown-streaming-tail` 再停留一拍；本轮新增的两例只补路径归属与预算门控，不负责这项反向防护。

本轮补充的独立复核（不依赖既有断言，直接观察真实渲染与真实 hast）：

| 复核项 | 手段 | 结果 |
| --- | --- | --- |
| 用户消息路径不走分段 | 新增 `streaming-chunk-path.test.tsx`：真实 `MarkdownContent` 渲染 13 000 字符，`isStreamingTail` 缺省 | `.streaming-chunk` 0 个、`.markdown-streaming-tail` 不存在 |
| 助手尾块超限不挂插件 | 同一文件：先挂上分段再跨过预算 | `.streaming-chunk` 归零，包裹类保留 |
| #185 回归 | `SessionConversation.compaction-stream.test.tsx` | 2 例通过，不断言 `Maximum update depth` |
| 溢出测量不成环 | `UserMessageText` 的 `setCanExpand` 在临界值反复翻转 80 轮 | 无 `Maximum update depth`（该临时用例未入库：它验证的是 React 自身的同值 bailout，不是本仓行为） |
| 插件成本与节点膨胀 | 真实 markdown → hast，9 次中位数 | 见上文「性能依据」表 |

新增用例 `packages/theme-ui/src/markdown/streaming-chunk-path.test.tsx` 的作用是把「用户消息路径不经过分段」这一归属结论钉成可失败的断言：若将来有人给用户消息路径加上 `isStreamingTail`，或让分段在镜像态也挂上，这条用例会先红。

需要说明的两点局限：

- **实机回归仍未执行**：本轮未获得启动桌面实例的授权，长会话手感与真实帧率仍需真机确认。
- **本项的收益是「少建 DOM」而不是「不再重解析」**：超限尾块仍然按 ADR-0131 的节流间隔整篇重解析（`resolveStreamRenderInterval`），只是不再额外建 span。把它写成「不再重解析」会高估本项。

参考：[ADR-0131](0131-markdown-rich-content-rendering.md)、[ADR-0151](0151-streaming-display-text-derived-outside-reveal.md)、[ADR-0116](0116-message-feed-local-rendering-extensions.md)。
