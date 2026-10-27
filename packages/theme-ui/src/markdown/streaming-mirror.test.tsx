// @vitest-environment jsdom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useStreamingDisplayText } from "./streaming";

/** 超过逐字 reveal 上限的一整段文本：13 000 字符。 */
const LONG = "诊断记录。".repeat(2_600);
/** 宿主的逐字 reveal 上限：超过就不逐字放，直接镜像。 */
const CROSS = 12_000;

function shown(container: HTMLElement): string | null {
	return container.firstElementChild?.getAttribute("data-shown") ?? null;
}

function mount(): { root: ReturnType<typeof createRoot>; container: HTMLElement } {
	const container = document.createElement("div");
	document.body.appendChild(container);
	return { root: createRoot(container), container };
}

function current(state: { value: ReturnType<typeof useStreamingDisplayText> | null }) {
	if (state.value === null) throw new Error("探针还没挂载");
	return state.value;
}

describe("useStreamingDisplayText 镜像态（不逐字 reveal）", () => {
	it("同一段超长文本连续增量，每个增量只渲染一次", () => {
		const { root, container } = mount();
		let renders = 0;
		function Probe({ text }: { readonly text: string }): ReturnType<typeof createElement> {
			const state = useStreamingDisplayText(text, false);
			renders += 1;
			return createElement("span", {
				"data-shown": String(state.displayText.length),
				"data-animate": String(state.animateChunks),
			});
		}

		flushSync(() => root.render(createElement(Probe, { text: LONG })));
		renders = 0;

		for (let step = 1; step <= 5; step++) {
			const text = LONG + "增".repeat(step);
			const before = renders;
			flushSync(() => root.render(createElement(Probe, { text })));
			// 旧实现在布局相还会 setDisplayText(text)，而渲染返回的副本下一帧就是 text：
			// 每个增量多提交一次内容相同的渲染，正是把嵌套更新计数推向 #185 的形态。
			expect(renders - before).toBe(1);
			expect(shown(container)).toBe(String(text.length));
		}

		// 镜像态的分段暗色仍由 `animateChunks` 的 state 决定；从未逐字推进过时它一直是 false。
		// （尾部收束时「暗色停留一拍再撤」的行为由 TextBlockView.streaming 的用例守，不在本文件。）
		expect(container.firstElementChild?.getAttribute("data-animate")).toBe("false");
		flushSync(() => root.unmount());
		container.remove();
	});

	it("流式文本跨过逐字阈值后，后续每个增量只渲染一次", () => {
		const { root, container } = mount();
		let renders = 0;
		function Probe({ text }: { readonly text: string }): ReturnType<typeof createElement> {
			// 真实宿主就是这条规则：超过 CROSS 个字符不再逐字 reveal，直接镜像。
			const state = useStreamingDisplayText(text, text.length <= CROSS);
			renders += 1;
			return createElement("span", { "data-shown": String(state.displayText.length) });
		}

		let text = "诊断记录。".repeat(2_400);
		flushSync(() => root.render(createElement(Probe, { text })));

		const counts: number[] = [];
		for (let step = 1; step <= 8; step++) {
			text = `${text}续`;
			const before = renders;
			flushSync(() => root.render(createElement(Probe, { text })));
			counts.push(renders - before);
			expect(shown(container)).toBe(String(text.length));
		}

		// 第一个增量是翻过阈值那一次（允许一次对齐提交），其后每个增量只能是宿主那一次。
		expect(counts.slice(1)).toEqual([1, 1, 1, 1, 1, 1, 1]);

		flushSync(() => root.unmount());
		container.remove();
	});

	it("显示文本等于宿主文本，不等下一帧补齐（追加与整体改写都算）", () => {
		const { root, container } = mount();
		const state: { value: ReturnType<typeof useStreamingDisplayText> | null } = { value: null };
		function Probe({
			text,
			active,
		}: {
			readonly text: string;
			readonly active: boolean;
		}): ReturnType<typeof createElement> {
			const displayed = useStreamingDisplayText(text, active);
			state.value = displayed;
			return createElement("span", { "data-shown": String(displayed.displayText.length) });
		}

		flushSync(() => root.render(createElement(Probe, { text: LONG, active: false })));
		expect(current(state).displayText).toBe(LONG);
		expect(current(state).animateChunks).toBe(false);

		const appended = `${LONG}追加`;
		flushSync(() => root.render(createElement(Probe, { text: appended, active: false })));
		expect(current(state).displayText).toBe(appended);
		expect(shown(container)).toBe(String(appended.length));

		const rewritten = "宿主整体改写过的短文本";
		flushSync(() => root.render(createElement(Probe, { text: rewritten, active: false })));
		expect(current(state).displayText).toBe(rewritten);
		expect(shown(container)).toBe(String(rewritten.length));

		flushSync(() => root.unmount());
		container.remove();
	});

	it("切回逐字 reveal 时起点是当前文本，不先补一帧旧副本", () => {
		const { root, container } = mount();
		const state: { value: ReturnType<typeof useStreamingDisplayText> | null } = { value: null };
		function Probe({
			text,
			active,
		}: {
			readonly text: string;
			readonly active: boolean;
		}): ReturnType<typeof createElement> {
			const displayed = useStreamingDisplayText(text, active);
			state.value = displayed;
			return createElement("span", { "data-shown": String(displayed.displayText.length) });
		}

		flushSync(() => root.render(createElement(Probe, { text: LONG, active: false })));
		const mirrored = `${LONG}追`;
		flushSync(() => root.render(createElement(Probe, { text: mirrored, active: false })));
		expect(current(state).displayText).toBe(mirrored);

		// 宿主把同一段文本交回逐字 reveal。镜像期没有写过显示文本的 state，
		// 这一刻必须仍然显示镜像期已经放出的全部文本：不倒退到旧副本，也不从空串重放。
		flushSync(() => root.render(createElement(Probe, { text: mirrored, active: true })));
		const flipped = current(state).displayText;
		expect(flipped.length).toBe(mirrored.length);
		expect(mirrored.startsWith(flipped)).toBe(true);
		expect(shown(container)).toBe(String(mirrored.length));

		// 继续追加时从当前位置往前走，不倒退。
		const continued = `${mirrored}。后续一句`;
		flushSync(() => root.render(createElement(Probe, { text: continued, active: true })));
		const resumed = current(state).displayText;
		expect(resumed.length).toBeGreaterThanOrEqual(mirrored.length);
		expect(continued.startsWith(resumed)).toBe(true);

		flushSync(() => root.unmount());
		container.remove();
	});
});
