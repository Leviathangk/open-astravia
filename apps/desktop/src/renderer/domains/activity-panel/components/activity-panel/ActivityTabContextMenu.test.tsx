// @vitest-environment jsdom

import type { ActivityTabKey } from "@shared/lib/project-profile";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityTabContextMenu, type ActivityTabContextMenuLabels } from "./ActivityTabContextMenu";

afterEach(cleanup);

const labels: ActivityTabContextMenuLabels = {
	closeAll: "关闭全部标签页",
	closeLeft: "关闭左侧标签页",
	closeOthers: "关闭其他标签页",
	closeRight: "关闭右侧标签页",
	closeTab: "关闭标签页",
};

type Key = Extract<ActivityTabKey, "file" | "plan" | "todo" | "browser">;

const items: { key: Key; removable?: boolean }[] = [
	{ key: "file" },
	{ key: "plan", removable: true },
	{ key: "todo", removable: true },
	{ key: "browser", removable: true },
];

function openMenu(tabKey: Key, list: { key: Key; removable?: boolean }[] = items) {
	const onClose = vi.fn();
	const onCloseTabs = vi.fn();
	render(
		<ActivityTabContextMenu
			items={list}
			labels={labels}
			tabKey={tabKey}
			x={40}
			y={40}
			onClose={onClose}
			onCloseTabs={onCloseTabs}
		/>,
	);
	return { onClose, onCloseTabs };
}

function item(label: string): HTMLElement {
	return screen.getByRole("menuitem", { name: label });
}

function isDisabled(label: string): boolean {
	return item(label).getAttribute("aria-disabled") === "true";
}

describe("ActivityTabContextMenu", () => {
	it("关闭左侧只关掉当前页签之前的可关闭页签", () => {
		const { onClose, onCloseTabs } = openMenu("todo");

		fireEvent.click(item(labels.closeLeft));

		expect(onCloseTabs).toHaveBeenCalledWith(["plan"]);
		expect(onClose).toHaveBeenCalled();
	});

	it("关闭右侧只关掉当前页签之后的可关闭页签", () => {
		const { onCloseTabs } = openMenu("plan");

		fireEvent.click(item(labels.closeRight));

		expect(onCloseTabs).toHaveBeenCalledWith(["todo", "browser"]);
	});

	it("关闭其他保留当前页签，只关掉两侧可关闭页签", () => {
		const { onCloseTabs } = openMenu("todo");

		fireEvent.click(item(labels.closeOthers));

		expect(onCloseTabs).toHaveBeenCalledWith(["plan", "browser"]);
	});

	it("关闭全部包含当前页签，但跳过不可关闭的文件页签", () => {
		const { onCloseTabs } = openMenu("plan");

		fireEvent.click(item(labels.closeAll));

		expect(onCloseTabs).toHaveBeenCalledWith(["plan", "todo", "browser"]);
	});

	it("不可关闭的文件页签右键时，关闭自身与关闭左侧都置灰", () => {
		openMenu("file");

		expect(isDisabled(labels.closeTab)).toBe(true);
		expect(isDisabled(labels.closeLeft)).toBe(true);
		expect(isDisabled(labels.closeRight)).toBe(false);
		expect(isDisabled(labels.closeOthers)).toBe(false);
	});

	it("只有自身可关闭时不提供批量关闭", () => {
		openMenu("plan", [{ key: "plan", removable: true }]);

		expect(isDisabled(labels.closeTab)).toBe(false);
		expect(isDisabled(labels.closeLeft)).toBe(true);
		expect(isDisabled(labels.closeRight)).toBe(true);
		expect(isDisabled(labels.closeOthers)).toBe(true);
	});

	it("页签已经不在栏上时不再渲染菜单", () => {
		const { container } = render(
			<ActivityTabContextMenu
				items={items}
				labels={labels}
				tabKey={"missing" as Key}
				x={0}
				y={0}
				onClose={vi.fn()}
				onCloseTabs={vi.fn()}
			/>,
		);

		expect(container.querySelector('[role="menu"]')).toBeNull();
	});
});
