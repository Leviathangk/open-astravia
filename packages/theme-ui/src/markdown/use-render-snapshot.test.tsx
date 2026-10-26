// @vitest-environment jsdom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useRenderSnapshot } from "./use-render-snapshot";

/** 让被动效果（以及它可能排下的后续工作）跑完。 */
function settle(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

/** 把可能残留的同步工作刷掉，之后读渲染计数才是最终值。 */
function flushPending(): void {
	flushSync(() => undefined);
}

function shown(container: HTMLElement): string | null {
	return container.firstElementChild?.getAttribute("data-shown") ?? null;
}

function mount(): { root: ReturnType<typeof createRoot>; container: HTMLElement } {
	const container = document.createElement("div");
	document.body.appendChild(container);
	return { root: createRoot(container), container };
}

describe("useRenderSnapshot", () => {
	it("非节流模式下，每个 source 增量只渲染一次（不多提交一次）", async () => {
		const { root, container } = mount();
		let renders = 0;
		function Probe({ source }: { readonly source: string }): ReturnType<typeof createElement> {
			const shown = useRenderSnapshot(source, true, false, 0);
			renders += 1;
			return createElement("span", { "data-shown": shown });
		}

		flushSync(() => root.render(createElement(Probe, { source: "a" })));
		renders = 0;

		flushSync(() => root.render(createElement(Probe, { source: "ab" })));
		await settle();
		flushPending();

		// 旧实现在这里还会 setState 一次（渲染副本），返回值却本来就是 source：
		// 每个增量多出一次「内容没变」的提交，流式增量连着到达时把 React 的
		// nestedUpdateCount 推到 50（React error #185）。
		expect(renders).toBe(1);
		expect(shown(container)).toBe("ab");

		flushSync(() => root.unmount());
		container.remove();
	});

	it("节流模式仍然只在到点后推进一次，连续到达不会被无限推迟", async () => {
		const { root, container } = mount();
		function Probe({ source }: { readonly source: string }): ReturnType<typeof createElement> {
			const shown = useRenderSnapshot(source, true, true, 20);
			return createElement("span", { "data-shown": shown });
		}

		flushSync(() => root.render(createElement(Probe, { source: "a" })));
		expect(shown(container)).toBe("a");

		flushSync(() => root.render(createElement(Probe, { source: "ab" })));
		// 未到点：仍显示上一次放出的文本。
		expect(shown(container)).toBe("a");

		await new Promise((resolve) => {
			setTimeout(resolve, 60);
		});
		flushPending();
		expect(shown(container)).toBe("ab");

		flushSync(() => root.unmount());
		container.remove();
	});

	it("从非节流切到节流时，起点是当前文本而不是过期副本", async () => {
		const { root, container } = mount();
		function Probe({ source, live }: { readonly source: string; readonly live: boolean }): ReturnType<typeof createElement> {
			const shown = useRenderSnapshot(source, true, live, 20);
			return createElement("span", { "data-shown": shown });
		}

		flushSync(() => root.render(createElement(Probe, { source: "abc", live: false })));
		await settle();
		flushPending();
		expect(shown(container)).toBe("abc");

		flushSync(() => root.render(createElement(Probe, { source: "abc", live: true })));
		expect(shown(container)).toBe("abc");

		flushSync(() => root.unmount());
		container.remove();
	});

	it("失活后不再覆盖已经放出的文本", async () => {
		const { root, container } = mount();
		function Probe({ source, active }: { readonly source: string; readonly active: boolean }): ReturnType<typeof createElement> {
			const shown = useRenderSnapshot(source, active, false, 0);
			return createElement("span", { "data-shown": shown });
		}

		flushSync(() => root.render(createElement(Probe, { source: "abc", active: true })));
		await settle();
		flushPending();
		expect(shown(container)).toBe("abc");

		// 离屏（IntersectionObserver 报不可见）时冻结：既不能把新文本顶上去，也不能把旧的清掉。
		flushSync(() => root.render(createElement(Probe, { source: "hidden", active: false })));
		await settle();
		flushPending();
		expect(shown(container)).toBe("abc");

		flushSync(() => root.unmount());
		container.remove();
	});
});
