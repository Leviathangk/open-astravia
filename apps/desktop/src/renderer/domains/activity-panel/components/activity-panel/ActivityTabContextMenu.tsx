import type { ActivityTabKey } from "@shared/lib/project-profile";
import { ContextMenuView, type ContextMenuNode } from "@astravia-org/theme-ui/shared";

export interface ActivityTabContextMenuLabels {
	closeTab: string;
	closeLeft: string;
	closeRight: string;
	closeOthers: string;
	closeAll: string;
}

export interface ActivityTabContextMenuProps {
	/** 栏上页签的当前顺序；批量关闭以这个顺序判断左右。 */
	items: readonly { key: ActivityTabKey; removable?: boolean }[];
	labels: ActivityTabContextMenuLabels;
	onClose: () => void;
	onCloseTabs: (keys: readonly ActivityTabKey[]) => void;
	tabKey: ActivityTabKey;
	x: number;
	y: number;
}

function closable(items: readonly { key: ActivityTabKey; removable?: boolean }[]): ActivityTabKey[] {
	return items.filter((item) => item.removable === true).map((item) => item.key);
}

/**
 * 页签右键菜单：只用 `removable` 判断能否关闭，与关闭按钮同一口径，
 * 因此固定页签（文件、知识历史）既不会被关掉也不会被误置灰。
 */
export function ActivityTabContextMenu({
	items,
	labels,
	onClose,
	onCloseTabs,
	tabKey,
	x,
	y,
}: ActivityTabContextMenuProps): JSX.Element | null {
	const index = items.findIndex((item) => item.key === tabKey);
	if (index < 0) return null;

	const leftKeys = closable(items.slice(0, index));
	const rightKeys = closable(items.slice(index + 1));
	const otherKeys = [...leftKeys, ...rightKeys];
	const allKeys = closable(items);
	const selfClosable = items[index]?.removable === true;

	const run = (keys: readonly ActivityTabKey[]): void => {
		onCloseTabs(keys);
		onClose();
	};

	const nodes: ContextMenuNode[] = [
		{
			kind: "item",
			id: "close-tab",
			label: labels.closeTab,
			disabled: !selfClosable,
			onSelect: () => run([tabKey]),
		},
		{ kind: "separator", id: "close-separator" },
		{
			kind: "item",
			id: "close-left",
			label: labels.closeLeft,
			disabled: leftKeys.length === 0,
			onSelect: () => run(leftKeys),
		},
		{
			kind: "item",
			id: "close-right",
			label: labels.closeRight,
			disabled: rightKeys.length === 0,
			onSelect: () => run(rightKeys),
		},
		{
			kind: "item",
			id: "close-others",
			label: labels.closeOthers,
			disabled: otherKeys.length === 0,
			onSelect: () => run(otherKeys),
		},
		{
			kind: "item",
			id: "close-all",
			label: labels.closeAll,
			disabled: allKeys.length === 0,
			onSelect: () => run(allKeys),
		},
	];

	return <ContextMenuView items={nodes} onClose={onClose} x={x} y={y} className="w-[190px]" />;
}
