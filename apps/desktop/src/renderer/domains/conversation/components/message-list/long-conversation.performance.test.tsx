// @vitest-environment jsdom
import type { CardDescriptor, PluginCardProps } from "@astravia-org/plugin-sdk";
import type { ConversationAgentMessageViewModel } from "@shared/conversation";
import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import { pluginCardRenderersAtom, chatMessagesAtom, type RegisteredCardRenderer } from "@shared/store/atoms";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import { act, render } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MessageCardsScope } from "../../hooks/useMessageCardsHostModel";
import { buildMessageHeightEstimates } from "./message-height-estimates";
import { collectAgentUsages, userModelSwitchFingerprint } from "./message-list-derived";

vi.mock("../../plugins/runtime/plugin-i18n", () => ({
	usePluginTextResolver: () => (_pluginId: string, text: string) => text,
}));

/** 一次流式增量允许的派生预算：远高于实测值，只用来拦住意外的平方级回归。 */
const DERIVATION_BUDGET_MS = 8;

/** 一半用户消息、一半助手的 文本 + 工具调用块，接近真实长会话的形状。 */
function history(count: number): ChatConversationItem[] {
	const items: ChatConversationItem[] = [];
	for (let index = 0; index < count; index += 2) {
		items.push(
			createConversationUserMessage({
				deliveryPhase: "completed",
				id: `user-${index}`,
				text: `第 ${index} 条用户消息，带一些说明文字用于估算行数。`,
				timestamp: index,
			}),
		);
		items.push(
			createConversationAgentMessage({
				blocks: [
					{ id: `blk-${index}`, text: `第 ${index} 条回答的正文，长度接近真实回答的一半。`, type: "text" },
					{
						args: { path: "src/index.ts" },
						status: "success",
						toolCallId: `tc-${index}`,
						toolName: "read_file",
						type: "tool_call",
					},
				],
				id: `agent-${index}`,
				phase: "completed",
				text: `第 ${index} 条回答的正文，长度接近真实回答的一半。`,
			}) as ConversationAgentMessageViewModel,
		);
	}
	return items;
}

/** 一次增量：只有最后一条助手消息换了内容，其余消息引用不变。 */
function appendDelta(items: ChatConversationItem[], tick: number): ChatConversationItem[] {
	const next = items.slice();
	const last = next.at(-1) as ConversationAgentMessageViewModel;
	next[next.length - 1] = createConversationAgentMessage({
		blocks: [{ id: `blk-${tick}`, text: `增量 ${tick}`, type: "text" }],
		id: last.id,
		phase: "streaming",
		text: `增量 ${tick}`,
	}) as ConversationAgentMessageViewModel;
	return next;
}

function averageMs(runs: number, run: () => void): number {
	run();
	const started = performance.now();
	for (let index = 0; index < runs; index += 1) run();
	return (performance.now() - started) / runs;
}

describe("长会话每次增量的派生成本", () => {
	it("1500 条消息下单次增量派生的总耗时留在毫秒级", { timeout: 60_000 }, () => {
		const items = history(1500);
		const delta = appendDelta(items, 1);

		const heights = averageMs(10, () => buildMessageHeightEstimates(delta, "perf-feed"));
		const usages = averageMs(10, () => collectAgentUsages(delta));
		const fingerprint = averageMs(10, () => userModelSwitchFingerprint(delta));
		const total = heights + usages + fingerprint;

		// 实测合计约 1ms；阈值只用于拦住平方级回归，不代表用户体验预算。
		expect(total).toBeLessThan(DERIVATION_BUDGET_MS);
	});

	it("卡片宿主在一条增量到达时只重扫一次，代价留在毫秒级", { timeout: 60_000 }, () => {
		const renderer: RegisteredCardRenderer = {
			component: (_props: PluginCardProps) => null,
			pendingFor: ({ toolName }): CardDescriptor | null =>
				toolName === "read_file" ? { payload: {}, title: "perf", type: "perf:card", key: "perf" } : null,
			pluginId: "perf-plugin",
			title: "Perf",
			type: "perf:card",
		};
		const store = createStore();
		store.set(pluginCardRenderersAtom, [renderer]);
		store.set(chatMessagesAtom, history(1500));

		function Scope({ children }: { readonly children: ReactNode }) {
			const items = useAtomValue(chatMessagesAtom);
			return (
				<MessageCardsScope messages={items} scope="perf-feed">
					{children}
				</MessageCardsScope>
			);
		}

		render(
			<Provider store={store}>
				<Scope>
					<div>ready</div>
				</Scope>
			</Provider>,
		);

		let current = history(1500);
		const deltas: number[] = [];
		for (let tick = 0; tick < 10; tick += 1) {
			current = appendDelta(current, tick);
			const started = performance.now();
			act(() => {
				store.set(chatMessagesAtom, current);
			});
			deltas.push(performance.now() - started);
		}
		const average = deltas.reduce((total, value) => total + value, 0) / deltas.length;

		// 实测约 0.5ms；阈值只用于拦住平方级回归。
		expect(average).toBeLessThan(DERIVATION_BUDGET_MS);
	});
});
