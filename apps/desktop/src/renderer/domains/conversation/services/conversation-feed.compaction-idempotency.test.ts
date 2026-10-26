// @vitest-environment jsdom

import type { SessionEvent } from "@astravia/runtime-core";
import {
	type ChatConversationItem,
	type ConversationFeedState,
	createConversationFeedState,
} from "@shared/store/chat-atoms";
import { describe, expect, it } from "vitest";
import { type ConversationFeedAction, reduceConversationFeed } from "./conversation-feed";

const RUNTIME = "runtime-1";

function base(eventId: string, timestamp: number) {
	return { eventId, schemaVersion: 1 as const, sessionId: RUNTIME, timestamp };
}

const turnStarted = (turnId: string, timestamp: number): SessionEvent => ({
	...base(`turn-${turnId}`, timestamp),
	channel: "runtime",
	source: "runtime-core",
	type: "conversation.turn.started",
	turnId,
});

const userAppended = (turnId: string, messageId: string, text: string, timestamp: number): SessionEvent => ({
	...base(`user-${messageId}`, timestamp),
	channel: "runtime",
	source: "runtime-core",
	type: "conversation.message.appended",
	turnId,
	messageId,
	message: { role: "user", content: [{ type: "text", text }], timestamp },
});

/** 同一条事件对象被投递两次，模拟重连后 runtime 重放造成的事实重复。 */
const compactionStart = (eventId: string, timestamp: number): SessionEvent => ({
	...base(eventId, timestamp),
	channel: "runtime",
	source: "runtime-core",
	type: "compaction.start",
	reason: "threshold",
});

function reduce(state: ConversationFeedState, ...actions: ConversationFeedAction[]): ConversationFeedState {
	return actions.reduce(reduceConversationFeed, state);
}

function events(...list: SessionEvent[]): ConversationFeedAction {
	return { type: "runtime.events", runtimeId: RUNTIME, events: list };
}

function compactionBlocks(items: readonly ChatConversationItem[]) {
	const item = items.at(-1);
	if (item?.kind !== "agent") return [];
	return item.blocks.filter((block) => block.type === "compaction");
}

function runningFeed(): ConversationFeedState {
	return reduce(
		createConversationFeedState(RUNTIME),
		events(turnStarted("t1", 10), userAppended("t1", "u1", "go", 11)),
	);
}

describe("conversation feed 对重复压缩事件的幂等性", () => {
	it("同一条 compaction.start 被重放两次时只产生一个压缩步骤", () => {
		const started = compactionStart("compaction-1", 20);
		const state = reduce(runningFeed(), events(started), events(started));

		expect(compactionBlocks(state.items)).toHaveLength(1);
	});

	it("重放的 compaction.start 不会让先到的步骤永远停在 running", () => {
		const started = compactionStart("compaction-1", 20);
		const delta: SessionEvent = {
			...base("compaction-delta-1", 21),
			channel: "runtime",
			source: "runtime-core",
			type: "compaction.delta",
			text: "summary so far",
		};
		const end: SessionEvent = {
			...base("compaction-end-1", 22),
			channel: "runtime",
			source: "runtime-core",
			type: "compaction.end",
			reason: "threshold",
			success: true,
			tokensBefore: 120_000,
		};
		const state = reduce(runningFeed(), events(started), events(started, delta, end));

		expect(compactionBlocks(state.items)).toMatchObject([
			{ status: "success", summary: "summary so far", tokensBefore: 120_000 },
		]);
	});
});
