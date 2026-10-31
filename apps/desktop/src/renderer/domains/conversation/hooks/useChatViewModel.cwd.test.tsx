// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「在外部应用打开工作区」拿的是 model.cwd。新建页还没有 activeSession，cwd 为 null
 * 时按钮只会把应用启动起来、不带目录（用户看到的是「打开了编辑器但没有项目」）。
 * 这里的合同：没有会话时回退到默认工作区，有会话时仍然用会话自己的 cwd。
 */

vi.mock("react-i18next", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t, i18n: { language: "zh" } }) };
});

const { useChatViewModel } = await import("./useChatViewModel.js");
const atoms = await import("@shared/store/atoms");

function stubAstraviaWindow(): void {
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			terminal: { capabilities: async () => ({ localPty: true }) },
			window: {
				isAlwaysOnTop: async () => false,
				toggleAlwaysOnTop: async () => true,
			},
		},
	});
}

describe("useChatViewModel 的工作区目录", () => {
	beforeEach(() => {
		stubAstraviaWindow();
		const store = getDefaultStore();
		store.set(atoms.chatMessagesAtom, []);
		store.set(atoms.activeSessionAtom, null);
		store.set(atoms.pendingSessionOpenAtom, null);
		store.set(atoms.pendingSessionCreationAtom, null);
		store.set(atoms.pendingSessionSendAtom, null);
		store.set(atoms.defaultConversationCwdAtom, "/repo/default");
	});

	it("新建页没有会话时回退到默认工作区", async () => {
		const { result } = renderHook(() => useChatViewModel());

		expect(result.current.model.cwd).toBe("/repo/default");
	});

	it("有会话时用会话自己的 cwd", async () => {
		const store = getDefaultStore();
		store.set(atoms.activeSessionAtom, {
			runtimeId: "rt-1",
			sessionPath: "/sessions/a.jsonl",
			cwd: "/repo/a",
		} as never);

		const { result } = renderHook(() => useChatViewModel());

		expect(result.current.model.cwd).toBe("/repo/a");
	});
});
