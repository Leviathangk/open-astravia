// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { CompactionStepView } from "./CompactionStepView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

/** 点击类断言要真实交互，所以这部分跑在 jsdom 里（静态标记用例同样成立）。 */
function mount(ui: ReactElement): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(ui);
	});
	return container;
}

function rerender(ui: ReactElement): void {
	act(() => {
		root?.render(ui);
	});
}

/** `aria-expanded` 是面板开合的唯一对外信号，不受折叠动画时序影响。 */
function isExpanded(container: HTMLElement): boolean {
	const button = container.querySelector("button");
	if (!button) throw new Error("compaction header is missing");
	return button.getAttribute("aria-expanded") === "true";
}

function clickHeader(container: HTMLElement): void {
	const button = container.querySelector("button");
	if (!button) throw new Error("compaction header is missing");
	act(() => {
		button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = null;
	document.body.innerHTML = "";
});

describe("CompactionStepView", () => {
	it("shows the summary that replaced earlier context once opened", () => {
		const closed = renderToStaticMarkup(
			<CompactionStepView status="success" label="Context compacted" detail="120k tokens before" summary="earlier work" />,
		);
		expect(closed).toContain("Context compacted");
		expect(closed).toContain("120k tokens before");
		expect(closed).toContain('aria-expanded="false"');
		expect(closed).not.toContain("earlier work");

		const open = renderToStaticMarkup(
			<CompactionStepView status="success" label="Context compacted" summary="earlier work" expanded />,
		);
		expect(open).toContain('aria-expanded="true"');
		expect(open).toContain("earlier work");
	});

	it("opens the panel while running even before the first summary delta arrives", () => {
		// 压缩实测可能跑好几分钟、首段 delta 到达前没有任何文本；这段时间必须能展开看进度。
		const markup = renderToStaticMarkup(
			<CompactionStepView
				status="running"
				label="Compacting context…"
				pendingHint={<span data-testid="pending">Generating summary…</span>}
			/>,
		);
		expect(markup).toContain('data-compaction-step="running"');
		expect(markup).not.toContain("disabled");
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain("Generating summary…");
		expect(markup).toContain("tool-call-shimmer-text");
	});

	it("stays collapsed and inert when there is nothing to show", () => {
		const markup = renderToStaticMarkup(<CompactionStepView status="success" label="Context compacted" />);
		expect(markup).toContain("disabled");
		expect(markup).not.toContain("compaction-summary");
	});

	it("auto-expands summary panel while streaming so user can follow in real time", () => {
		const markup = renderToStaticMarkup(
			<CompactionStepView status="running" label="Compacting context…" summary="Partial summary so far…" />,
		);
		expect(markup).toContain('data-compaction-step="running"');
		expect(markup).not.toContain("disabled");
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain("Partial summary so far…");
		expect(markup).toContain("tool-call-shimmer-text");
	});

	it("keeps a failed compaction visibly distinct", () => {
		const markup = renderToStaticMarkup(<CompactionStepView status="error" label="Context compaction failed" />);
		expect(markup).toContain("icon-[solar--danger-circle-linear]");
		expect(markup).toContain("text-destructive/80");
	});

	it("renders the summary through the host-supplied renderer when given one", () => {
		// 摘要是模型写的叙述，宿主注入的渲染器负责把它变成 Markdown 预览；
		// 注入时不能再退化成 whitespace-pre-wrap 的原文墙。
		const markup = renderToStaticMarkup(
			<CompactionStepView
				status="success"
				label="Context compacted"
				summary="**bold** summary"
				expanded
				renderSummary={(summary) => <strong data-testid="rendered-summary">{summary.toUpperCase()}</strong>}
			/>,
		);
		expect(markup).toContain("**BOLD** SUMMARY");
		expect(markup).not.toContain("whitespace-pre-wrap");
	});

	it("marks the summary panel so the host can rescale it to the panel rhythm", () => {
		// 摘要里的 Markdown 元素各自带绝对 text-[Npx]（特异性 0,1,0），父级字号进不去；
		// 所以宿主要靠这两个类名挂容器查询与 0,1,1 的后代字号规则。
		const markup = renderToStaticMarkup(
			<CompactionStepView
				status="success"
				label="Context compacted"
				summary="## earlier work"
				expanded
				renderSummary={(summary) => <div>{summary}</div>}
			/>,
		);
		expect(markup).toContain("compaction-step");
		expect(markup).toContain("compaction-summary");
		expect(markup).not.toContain("text-[12px]");
	});

	it("tells the host whether the summary is still growing", () => {
		// 增长中的正文必须走宿主的流式管线；宿主拿不到这个信号，就只能每次增量把整篇重解析一遍。
		const seen: boolean[] = [];
		const renderSummary = (summary: string, streaming: boolean) => {
			seen.push(streaming);
			return <div>{summary}</div>;
		};

		renderToStaticMarkup(
			<CompactionStepView status="running" label="Compacting context…" summary="partial" renderSummary={renderSummary} />,
		);
		renderToStaticMarkup(
			<CompactionStepView
				status="success"
				label="Context compacted"
				summary="settled"
				expanded
				renderSummary={renderSummary}
			/>,
		);
		// 导出拿的是静态快照，流式渲染只会给出已放出的那一段，所以导出时不算增长。
		renderToStaticMarkup(
			<CompactionStepView
				status="running"
				label="Compacting context…"
				summary="partial"
				exportMode
				renderSummary={renderSummary}
			/>,
		);

		expect(seen).toEqual([true, false, false]);
	});
});

describe("CompactionStepView collapse control", () => {
	it("collapses while running when the header is clicked, then expands again", () => {
		const view = mount(<CompactionStepView status="running" label="Compacting context…" summary="partial" />);
		expect(isExpanded(view)).toBe(true);

		clickHeader(view);
		expect(isExpanded(view)).toBe(false);

		clickHeader(view);
		expect(isExpanded(view)).toBe(true);
	});

	it("keeps the reader's choice when a new summary delta arrives", () => {
		const view = mount(<CompactionStepView status="running" label="Compacting context…" summary="partial" />);
		clickHeader(view);

		rerender(<CompactionStepView status="running" label="Compacting context…" summary="partial and then some more" />);

		expect(isExpanded(view)).toBe(false);
	});

	it("collapses on the first click when the host supplies a running-aware default", () => {
		// 桌面端 CompactionBlock 用 useExpansion(key, status === "running") 持有展开态：
		// running 的默认展开由宿主提供，受控时宿主就是唯一事实源。
		function HostRow(): ReactElement {
			// `stored` 模拟 store：null 表示用户还没写过，此时取 running 的默认值 true。
			const [stored, setStored] = useState<boolean | null>(null);
			const hostExpanded = stored ?? true;
			return (
				<CompactionStepView
					status="running"
					label="Compacting context…"
					summary="partial"
					expanded={hostExpanded}
					onToggle={() => setStored(!hostExpanded)}
				/>
			);
		}

		const view = mount(<HostRow />);
		expect(isExpanded(view)).toBe(true);

		clickHeader(view);
		expect(isExpanded(view)).toBe(false);

		clickHeader(view);
		expect(isExpanded(view)).toBe(true);
	});

	it("follows the host when it collapses the row programmatically", () => {
		// 受控时显示态不能有组件内阴影态：宿主程序化收起（全局折叠、切会话重置）必须生效。
		const probes: Array<(value: boolean) => void> = [];
		function HostRow(): ReactElement {
			const [stored, setStored] = useState<boolean>(true);
			probes.push(setStored);
			return (
				<CompactionStepView
					status="running"
					label="Compacting context…"
					summary="partial"
					expanded={stored}
					onToggle={() => setStored((value) => !value)}
				/>
			);
		}

		const view = mount(<HostRow />);
		expect(isExpanded(view)).toBe(true);

		// 先点两次（收起再展开），制造「组件内已经有过选择」的条件。
		clickHeader(view);
		clickHeader(view);
		expect(isExpanded(view)).toBe(true);

		act(() => {
			probes[probes.length - 1]?.(false);
		});
		expect(isExpanded(view)).toBe(false);
	});

	it("stays collapsed after a remount when the host remembers the choice", () => {
		// Virtuoso 会把条目卸载重挂：宿主 store 记住的选择必须跨重挂存活。
		// 这个 fake store 就是桌面端 useExpansion(key, status === "running") 的最小等价物。
		const store: { value: boolean | null } = { value: null };

		function HostRow(): ReactElement {
			const [, forceRender] = useState(0);
			const hostExpanded = store.value ?? true;
			return (
				<CompactionStepView
					status="running"
					label="Compacting context…"
					summary="partial"
					expanded={hostExpanded}
					onToggle={() => {
						store.value = !hostExpanded;
						forceRender((value) => value + 1);
					}}
				/>
			);
		}

		const view = mount(<HostRow />);
		expect(isExpanded(view)).toBe(true);
		clickHeader(view);
		expect(isExpanded(view)).toBe(false);
		expect(store.value).toBe(false);

		// 卸载重挂：store 里的 false 仍然生效，不会回弹成展开。
		act(() => {
			root?.unmount();
		});
		root = null;
		document.body.innerHTML = "";

		const remounted = mount(<HostRow />);
		expect(isExpanded(remounted)).toBe(false);
	});

	it("collapses once compaction finishes while it was open", () => {
		const view = mount(<CompactionStepView status="running" label="Compacting context…" summary="partial" />);
		expect(isExpanded(view)).toBe(true);

		rerender(<CompactionStepView status="success" label="Context compacted" summary="partial and then some more" />);

		expect(isExpanded(view)).toBe(false);
	});

	it("accents the row with a theme-independent colour so mono themes stay visible", () => {
		// mono 主题把 --primary 定义成纯黑/纯白，强调色走 primary 就退化成黑白图标与标题；
		// 所以这里锁的是「不能再用 primary 派生色」这个跨主题可见性契约。
		const running = renderToStaticMarkup(
			<CompactionStepView status="running" label="Compacting context…" summary="partial" />,
		);
		const settled = renderToStaticMarkup(
			<CompactionStepView status="success" label="Context compacted" summary="earlier work" expanded />,
		);

		for (const markup of [running, settled]) {
			expect(markup).not.toMatch(/(?:text|border|bg)-primary/);
		}
		expect(running).toContain("text-sky-500/80");
		expect(running).toContain("enabled:hover:bg-sky-500/10");
		expect(settled).toContain("text-sky-500");
		expect(settled).toContain("border-sky-500/25");
	});
});
