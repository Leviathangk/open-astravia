// @vitest-environment jsdom
import type { SessionInfo } from "../../../shared/store/project-atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjects } from "./useProjects";

/**
 * 会话列表刷新的「在途合并」不变量。
 *
 * 侧栏里「新建的会话过一会儿自己消失」的根因在渲染进程这一侧：`loadSessions` 曾经把在途
 * 期间到达的刷新请求直接 `return` 掉，复用那一趟的结果。而那一趟的 `listSessions` 早就
 * 取过快照——新建会话在这之后才落盘，于是它的存在永远不会被读到，直到下一次无关事件再
 * 触发一次刷新（切走项目后通常就没有了）。
 *
 * 这里锁两件事：在途请求会被补拉一次；补拉结果真的进到 sessionsMap。
 */

const listSessions = vi.fn<(cwd: string) => Promise<SessionInfo[]>>();

vi.stubGlobal(
	"window",
	Object.assign(globalThis.window, {
		astravia: {
			config: {
				get: async () => ({ projects: [], archivedProjects: [], defaultConversationCwd: "" }),
				onProjectsChanged: () => () => {},
			},
			project: { readMeta: async () => null },
			session: {
				listSessions,
				onSessionsChanged: () => () => {},
				rename: async () => {},
			},
			im: { onSessionChanged: () => () => {} },
		},
	}),
);

function session(cwd: string, name: string): SessionInfo {
	return {
		id: name,
		path: `${cwd}/${name}.jsonl`,
		cwd,
		name,
		firstMessage: "第一条消息",
		modifiedAt: 1,
	};
}

describe("会话列表刷新", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("在途期间到达的刷新会补拉一次，新建会话随后出现在列表里", async () => {
		const cwd = "/workspace/inflight-refresh";
		let releaseFirst: ((sessions: SessionInfo[]) => void) | undefined;
		const firstRead = new Promise<SessionInfo[]>((resolve) => {
			releaseFirst = resolve;
		});
		listSessions.mockReturnValueOnce(firstRead).mockResolvedValueOnce([session(cwd, "新建会话")]);

		const { result } = renderHook(() => useProjects());

		let firstLoad: Promise<void> | undefined;
		act(() => {
			firstLoad = result.current.loadSessions(cwd);
		});
		// 实际读取在下一个微任务里发起（loadSessions 先登记在途 promise 再开始拉，
		// 这样才能保证 finally 清理时条目一定已存在），所以断言前先冲掉一个微任务。
		await act(async () => {});
		// 新建会话的 jsonl 在第一次读取返回之前落盘，触发一次刷新。
		let secondLoad: Promise<void> | undefined;
		act(() => {
			secondLoad = result.current.loadSessions(cwd);
		});
		expect(listSessions).toHaveBeenCalledTimes(1);

		await act(async () => {
			releaseFirst?.([]);
			await firstLoad;
			await secondLoad;
		});

		// 旧实现里这一趟永远不会发生，列表停在空数组。
		expect(listSessions).toHaveBeenCalledTimes(2);
		await waitFor(() => {
			expect(result.current.sessionsMap.get(cwd)?.map((entry) => entry.name)).toEqual(["新建会话"]);
		});
	});

	it("没有并发请求时不额外读取", async () => {
		const cwd = "/workspace/single-refresh";
		listSessions.mockResolvedValueOnce([session(cwd, "唯一会话")]);

		const { result } = renderHook(() => useProjects());
		await act(async () => {
			await result.current.loadSessions(cwd);
		});

		expect(listSessions).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(result.current.sessionsMap.get(cwd)?.length).toBe(1);
		});
	});
});
