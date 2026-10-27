# ADR-0151：非逐字 reveal 时显示文本由渲染派生

## 状态

已接受。扩展 ADR-0131 的流式渲染预算，不改变消息持久化、`MarkdownContent` 公共属性或 reveal 节奏。

## 背景

`useStreamingDisplayText(text, active)`（`packages/theme-ui/src/markdown/streaming.ts`）把显示文本追向宿主文本：`active` 为真时逐字 reveal 并挂上分段标记，为假时直接对齐 `text`。`MarkdownContent` 用 `shouldRevealStreamingTail(text, isStreamingTail)` 决定 `active`。

参照实现里 `active` 就是 `isStreamingTail`，长文本流式期间照常逐字推进。本仓随后给这条路径加了预算：`STREAM_ANIMATE_MAX_CHARS = 12_000`（`28b33db39`）让超过上限的尾块退出 reveal，`resolveStreamRenderInterval`（`6f7b1eadb`）按整篇长度把重解析间隔抬到 200 / 400ms。重解析间隔记在 ADR-0131「后续性能完善」；1.2 万字符的 reveal 上限由 `28b33db39` 直接引入，此前没有 ADR 记录。动机是长压缩摘要逐字推进等于每 100ms 整篇重解析。

退出 reveal 的落点是参照实现为「首次挂载、历史消息、宿主改写已显示内容」准备的一次性直接对齐分支：

```ts
if (!streamedRef.current || !text.startsWith(shown)) {
	displayRef.current = text;
	setDisplayText(text);
	setAnimateChunks(false);
	streamedRef.current = active;
	return;
}
```

这段逻辑本身没问题，问题在它被当成了长期路径。真正跑起来时副本提交有**两个**站点，两者都要处理：

- **直接对齐分支**：`active` 为假且 `streamedRef` 一直为假（首次挂载即超长、历史消息）。每个增量都命中，`setDisplayText(text)` 在布局效果里回写一份渲染期已经能用 `text` 得到的值。
- **reveal 分支的推进步**：真实长回复从短文本开始长大，`streamedRef` 已为真，跨过 1.2 万字符后 `active` 翻假，但条件 `text.startsWith(shown)` 仍成立，所以每个增量继续走 `reveal()`，在里面 `setDisplayText(next)`。这条才是实际最长命中率的路径。

两处都是同一屏渲染两次，第二次提交落在 commit 尾部仍有待处理工作的时候。与 `use-render-snapshot.ts` 已修的形态不同，这里的 `displayText` 确实被渲染读取，不能直接删掉 state。

因此本项不是「向参照实现对齐」：参照实现根本没有 1.2 万字符上限与节流兜底，长文本始终逐字 reveal，不会落到这两条长期镜像路径上。这是本仓自加预算后暴露的实现缺陷。

## 决策

- `active` 为假时，hook 返回的 `displayText` 直接取 `text`，渲染期由 `text` 派生，不再维护会被布局效果回写同一值的 state。`animateChunks` 仍取 state：包裹类的停留与撤除是既有可观察行为（`TextBlockView.streaming` 断言收束时 `.markdown-streaming-tail` 再停一拍才消失；压暗本身已由 `c6fa76b1a` 去掉，现在只剩类名生命周期），不随后者一起派生。
- 直接对齐分支只在 `active` 为真（宿主改写已显示内容）时 `setDisplayText(text)`；`active` 为假时只同步 `displayRef` 与 `streamedRef`，不提交。
- 离开「非 reveal」状态的那一次布局效果把 state 对齐到已经放出的文本（`displayRef.current`）—— 防御性守卫：生产里 `active` 为真要求长度 ≤ 1.2 万，而镜像期 `displayRef` 已经推到更长，所以翻回真时多半会落到「不是前缀」的对齐分支；只有短文本靠 `isStreamingTail` 进出镜像时，这道守卫才避免第一帧用旧副本。
- reveal 的推进节奏、扣留、`settle` / `settleIdle` 不变；`reveal()` 推进时的副本提交同样按 `active` 门控（非 reveal 期间那份副本不会被渲染读到），`animateChunks` 的消费方式、`MarkdownContent` 的 `chunkedRef` 粘性语义、组件公共属性与消息持久化都不变。

## 备选方案

| 方案 | 取舍 |
| --- | --- |
| 保留每增量 `setDisplayText` | 改动最小，但每增量两次提交正是本次要消除的形态，不采用 |
| 取消 1.2 万字符上限、跟随参照实现逐字 reveal | 把每 100ms 的整篇重解析还回来（本机两套口径：仓内 parse-only bench 20k 19–23ms / 120k 148ms，整链 jsdom 20k 40–265ms / 120k 0.9–1.4s），不采用 |
| 把 `displayText` 也改成 ref、渲染期读取 | 渲染读 ref 破坏并发渲染下的纯度保证；上一轮只在非渲染读取路径改 ref，这里 `displayText` 参与渲染，不采用 |
| 由 `MarkdownContent` 直接用 `text` | 丢掉 reveal 与分段标记，且 reveal 状态需要另找归宿，不采用 |
| 用 `useDeferredValue` / 过渡延后对齐 | 只降优先级，不消除每增量的额外提交，还改变长文本可见延迟，不采用 |

## 后果

- 超过 1.2 万字符的流式文本每增量从两次提交降为一次，`active` 为假时显示文本与 `text` 同帧一致，不再滞后一拍。
- 从非 reveal 切回 reveal 的那一帧多一次对齐提交（需空挂 `animateChunks` 时还可能多一次，取决于它当时的值）；之后每个增量只剩宿主那一次。跨过阈值那一次实测不额外提交（`wasActive` 仍为真，`animateChunks` 同值 no-op，`reveal()` 的 `final` 分支只改 ref）。
- 新增用例 `streaming-mirror.test.tsx`「流式文本跨过逐字阈值后」断言 `counts.slice(1)` 全为 1（只对后续增量下结论，不对第一个增量下结论）。
- 唯一调用点是 `MarkdownContent.tsx:173`；所有 markdown 消息、压缩摘要与预览都经由它，`displayText` 只在 reveal 期间滞后于 `text`，宿主改写内容仍需一次布局效果对齐。
- 可见行为不变：`animateChunks` 仍由 state 驱动，包裹类依旧在收束后停留一拍再随 `settle` 撤除（已无像素差异）；分段 span 的结构与 `chunkedRef` 粘性语义均未触动。
- 不承诺端到端帧率

## 迁移与验证

没有数据迁移，消息仍保存原始 markdown。renderer 侧无状态格式变化。

新增 `streaming-mirror.test.tsx` 四例，覆盖：超过 1.2 万字符的连续增量每次只渲染一次（改动前为两次）、跨过阈值后每个增量只渲染一次（`counts.slice(1)` 全为 1）、`active` 为假时返回值等于 `text`、`active` 翻回真之后第一帧即为当前文本并在其后接着放。既有不变量测试（reveal 节奏、扣留、settle、`MarkdownContent` 稳定块与富内容渲染）原样通过，一条未放宽。

实机回归未执行：本轮未获得启动桌面实例的授权，帧率与长会话手感仍需真机确认。

参考：[ADR-0131](0131-markdown-rich-content-rendering.md)、[ADR-0116](0116-message-feed-local-rendering-extensions.md)、[ADR-0102](0102-lossless-assistant-event-stream.md)、[React：你可能不需要 Effect](https://react.dev/learn/you-might-not-need-an-effect)、[React：state 更新批处理](https://react.dev/learn/queueing-a-series-of-state-updates)。
