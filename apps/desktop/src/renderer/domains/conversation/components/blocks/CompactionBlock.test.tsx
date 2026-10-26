// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExpansion, MessageExpansionScope } from "../message-list/expansionStore";
import { createMarkdownHostFixture } from "./markdown-host.fixture";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			key === "messageList.compactionStep.tokensBefore" ? `${values?.tokens} tokens before` : key,
	}),
}));

import { CompactionBlockView } from "./CompactionBlock";

afterEach(cleanup);

/**
 * 真实 store：`MessageExpansionScope` 每个会话一个 atom，位于消息列表之上。
 * 这里 scope 一直挂着、只卸载行本身，等价于 Virtuoso 把条目滚出视窗。
 */
function scopeTree(block: { status: "running" | "success"; id: string }, mounted: boolean) {
	return (
		<MessageExpansionScope scope="session-a">
			{mounted ? <CompactionBlockView block={{ id: block.id, type: "compaction", status: block.status }} /> : null}
		</MessageExpansionScope>
	);
}

/** 同一个 store 里另一个消费者：模拟宿主的程序化收起（全局折叠、切会话重置）。 */
function ProgrammaticToggle({ expansionKey }: { expansionKey: string }) {
	const [, toggle] = useExpansion(expansionKey, true);
	return (
		<button type="button" data-testid="programmatic-toggle" onClick={toggle}>
			collapse
		</button>
	);
}

describe("CompactionBlockView", () => {
	it("按 Markdown 预览展开压缩摘要，而不是原文墙", () => {
		const { host } = createMarkdownHostFixture();
		render(
			<RendererMarkdownScope
				value={{
					host,
					theme: "light",
					labels: { copy: "Copy", copied: "Copied" },
					getFileIconClass: () => "",
					onOpenFile: () => {},
					onOpenUrl: () => {},
				}}
			>
				<CompactionBlockView
					block={{
						id: "c1",
						type: "compaction",
						status: "success",
						tokensBefore: 120_000,
						summary: "## 已完成的工作\n\n- **登录** 流程收尾\n\n```ts\nconst a = 1;\n```",
					}}
				/>
			</RendererMarkdownScope>,
		);

		// 折叠状态下只显示标题与压缩前用量，摘要正文不占版面。
		expect(screen.queryByText("登录")).toBeNull();
		fireEvent.click(screen.getByRole("button"));

		const heading = screen.getByRole("heading", { name: "已完成的工作" });
		expect(heading.tagName).toBe("H2");
		expect(screen.getByText("登录").tagName).toBe("STRONG");
		expect(screen.getByText("const a = 1;")).toBeTruthy();
		// 原文墙会让 Markdown 标记直接出现在文本里。
		expect(screen.queryByText(/##\s*已完成的工作/)).toBeNull();
	});

	it("运行中只追加纯文本，压缩结束后才整篇解析 Markdown", () => {
		// 长摘要运行期整篇重解析是 #185 与滚动卡顿的共同来源：增长期不得进入 markdown 管线。
		const { host } = createMarkdownHostFixture();
		const scope = (status: "running" | "success") => (
			<RendererMarkdownScope
				value={{
					host,
					theme: "light",
					labels: { copy: "Copy", copied: "Copied" },
					getFileIconClass: () => "",
					onOpenFile: () => {},
					onOpenUrl: () => {},
				}}
			>
				<CompactionBlockView
					block={{ id: "c4", type: "compaction", status, summary: "## 已完成的工作\n\n- **登录** 流程收尾" }}
				/>
			</RendererMarkdownScope>
		);
		const { container, rerender } = render(scope("running"));

		// 流式期间标记原样出现，没有任何解析出来的标题/加粗元素。
		expect(screen.getByText(/##\s*已完成的工作/)).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "已完成的工作" })).toBeNull();
		expect(screen.queryByText("登录")).toBeNull();
		// 断言管线本身没被挂载，而不只是「没解析出结果」：markdown 容器缺失才算真的跳过了整篇解析。
		expect(container.querySelector(".markdown-body")).toBeNull();

		rerender(scope("success"));
		expect(screen.getByRole("heading", { name: "已完成的工作" }).tagName).toBe("H2");
		expect(screen.getByText("登录").tagName).toBe("STRONG");
		expect(container.querySelector(".markdown-body")).not.toBeNull();
	});

	it("running 中收起后卸载重挂仍保持收起", () => {
		// 展开态写在 store 里而不是组件内：Virtuoso 卸载重挂之后不能自己弹回展开。
		const block = { id: "c2", status: "running" } as const;
		const { rerender } = render(scopeTree(block, true));

		const header = screen.getByRole("button");
		// running 期间默认展开由 useExpansion 的默认值提供。
		expect(header.getAttribute("aria-expanded")).toBe("true");

		fireEvent.click(header);
		expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");

		rerender(scopeTree(block, false));
		expect(screen.queryByRole("button")).toBeNull();

		rerender(scopeTree(block, true));
		expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
	});

	it("受控显示态跟随宿主对同一 key 的程序化收起", () => {
		// 受控模式下组件内不能再留一份覆盖用的选择，否则宿主的程序化收起会被压住。
		const { rerender } = render(
			<MessageExpansionScope scope="session-b">
				<CompactionBlockView block={{ id: "c3", type: "compaction", status: "running" }} />
				<ProgrammaticToggle expansionKey="compaction:c3" />
			</MessageExpansionScope>,
		);
		expect(screen.getByRole("button", { name: /messageList\.compactionStep\.running/ }).getAttribute("aria-expanded")).toBe(
			"true",
		);

		// 用户手点一次再点回来，制造「组件内已经有过选择」的条件。
		fireEvent.click(screen.getByRole("button", { name: /messageList\.compactionStep\.running/ }));
		fireEvent.click(screen.getByRole("button", { name: /messageList\.compactionStep\.running/ }));
		expect(screen.getByRole("button", { name: /messageList\.compactionStep\.running/ }).getAttribute("aria-expanded")).toBe(
			"true",
		);

		fireEvent.click(screen.getByTestId("programmatic-toggle"));
		expect(screen.getByRole("button", { name: /messageList\.compactionStep\.running/ }).getAttribute("aria-expanded")).toBe(
			"false",
		);

		// rerender 保持同一棵树，确认不是靠卸载重置生效的。
		rerender(
			<MessageExpansionScope scope="session-b">
				<CompactionBlockView block={{ id: "c3", type: "compaction", status: "running" }} />
				<ProgrammaticToggle expansionKey="compaction:c3" />
			</MessageExpansionScope>,
		);
		expect(screen.getByRole("button", { name: /messageList\.compactionStep\.running/ }).getAttribute("aria-expanded")).toBe(
			"false",
		);
	});
});
