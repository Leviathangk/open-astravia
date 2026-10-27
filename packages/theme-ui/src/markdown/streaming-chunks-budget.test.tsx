// @vitest-environment jsdom
// `act` 在 React 19 里需要这个开关才允许在测试环境外驱动更新。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

const environment = {
	theme: "dark" as const,
	labels: { copy: "Copy code", copied: "Copied code" },
	getFileIconClass: () => "",
	onOpenFile: () => {},
	onOpenUrl: () => {},
};

/** 逐字 reveal 的上限：跨过它以后尾块按帧到达，分段也就没有节奏可跟。 */
const BUDGET = 12_000;

const SHORT = "诊断记录。".repeat(20);
const LONG = "诊断记录。".repeat(2_600);

interface Mounted {
	readonly container: HTMLElement;
	readonly root: Root;
}

function markup(text: string, isStreamingTail: boolean) {
	return createElement(MarkdownContent, { ...environment, text, isStreamingTail });
}

function mount(text: string, isStreamingTail: boolean): Mounted {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(markup(text, isStreamingTail));
	});
	return { container, root };
}

function update(view: Mounted, text: string, isStreamingTail: boolean): void {
	act(() => {
		view.root.render(markup(text, isStreamingTail));
	});
}

function dispose(view: Mounted): void {
	act(() => {
		view.root.unmount();
	});
}

/** 快照节流按整篇长度把重解析压到 200/400ms；只推到 250ms，避免 idle settle（300ms）把包裹类收掉。 */
function flushRenderInterval(): void {
	act(() => {
		vi.advanceTimersByTime(250);
	});
}

function chunksOf(container: HTMLElement): number {
	return container.querySelectorAll(".streaming-chunk").length;
}

describe("流式尾块的分段长度预算", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("预算之内的尾块照旧逐短语分段", () => {
		const view = mount(SHORT, true);
		flushRenderInterval();
		expect(SHORT.length).toBeLessThanOrEqual(BUDGET);
		expect(chunksOf(view.container)).toBeGreaterThan(0);
		dispose(view);
	});

	it("尾块长过预算后不再产生逐短语 span", () => {
		// 真实长回复是从短文本长过来的：先让分段挂上，再跨过预算。
		const view = mount(SHORT, true);
		flushRenderInterval();
		expect(chunksOf(view.container)).toBeGreaterThan(0);

		update(view, LONG, true);
		flushRenderInterval();

		expect(LONG.length).toBeGreaterThan(BUDGET);
		expect(view.container.textContent).toContain("诊断记录。");
		expect(chunksOf(view.container)).toBe(0);
		dispose(view);
	});

	it("跨过预算的那一帧仍保留流式包裹类", () => {
		const view = mount(SHORT, true);
		flushRenderInterval();
		update(view, LONG, true);
		// 包裹类由 animateChunks（state）驱动，不随分段一起关：它现在只剩后代选择器规则。
		expect(view.container.querySelector(".markdown-streaming-tail")).not.toBeNull();
		dispose(view);
	});

	it("一开始就超限的历史消息不分段", () => {
		const view = mount(LONG, false);
		flushRenderInterval();
		expect(view.container.querySelector(".streaming-chunk")).toBeNull();
		expect(view.container.querySelector(".markdown-streaming-tail")).toBeNull();
		dispose(view);
	});
});
