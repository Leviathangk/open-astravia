import { useEffect, useRef, useState } from "react";

/**
 * Trailing throttle: continuous arrivals cannot postpone rendering indefinitely.
 *
 * 非节流模式（`active && !live`，即短文本、或宿主没要求节流）直接渲染 `source`，因此**不持有渲染副本**：
 * 之前的实现在这个分支里每次 `source` 变化都 `setState` 一份副本，而返回值本来就等于 `source`，
 * 等于每个增量都多提交一次「内容完全没变」的渲染。把同一段流式内容压进 40–200 次增量、用生产构建的
 * React 重放真实的 `MarkdownContent`：改前每次重跑都有部分场景抛 React error #185
 *（Maximum update depth exceeded）并被错误边界换成整页错误牌，改后连续三次重跑均为 0。
 * 抛出点落在下一次任意状态更新上，所以崩溃日志里的位置未必是真正的触发点。
 * 节流模式仍然只在到点时推进一次。
 */
export function useRenderSnapshot(source: string, active: boolean, live: boolean, interval = 250): string {
	/** 最近一次拿到的文本；定时器到点时用它推进，避免放出过期内容。 */
	const latest = useRef(source);
	latest.current = source;
	/** 已经交给渲染的文本。非节流模式由下面那个效果同步，但**不触发提交**。 */
	const rendered = useRef(source);
	const [, setFlushed] = useState(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => {
		if (!active || !live) {
			clearTimeout(timer.current);
			timer.current = undefined;
			if (active) rendered.current = source;
			return;
		}
		if (rendered.current === source || timer.current !== undefined) return;
		timer.current = setTimeout(() => {
			timer.current = undefined;
			rendered.current = latest.current;
			setFlushed((count) => count + 1);
		}, interval);
	}, [source, active, live, interval]);
	useEffect(() => () => clearTimeout(timer.current), []);
	return active && !live ? source : rendered.current;
}
