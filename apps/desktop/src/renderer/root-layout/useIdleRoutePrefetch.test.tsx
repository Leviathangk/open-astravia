// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 空闲预取合同：高频入口的 chunk 不在挂载同步段求值（不与启动关键路径抢主线程），
 * 而是在空闲回调/兜底定时器触发后拉取；提前卸载则取消。
 *
 * 新会话页曾经只在「停在欢迎页且没有待恢复会话」时被预取——真实使用里最少见的正是
 * 那个状态。用户往往正开着某个会话，点「新建会话」才开始取模块，于是那一下停顿正好
 * 落在切页之后。这里锁住它和其余入口一样走空闲预取，且只付一次代价。
 *
 * 注意：模块求值只能观察到一次——动态 import 与 route loader 都会缓存 promise，
 * 所以断言写成「恰好一次」，再挂载一次也不会变多。
 */

const abilitiesEvaluated = vi.fn();
vi.mock("../domains/abilities/components/AbilitiesPage", () => {
	abilitiesEvaluated();
	return { AbilitiesPage: () => null };
});

const newSessionEvaluated = vi.fn();
vi.mock("../domains/conversation/components/NewSessionPage", () => {
	newSessionEvaluated();
	return { NewSessionPage: () => null };
});

const { useIdleRoutePrefetch } = await import("./useIdleRoutePrefetch.js");

describe("useIdleRoutePrefetch", () => {
	beforeEach(() => {
		abilitiesEvaluated.mockClear();
		newSessionEvaluated.mockClear();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("挂载同步段不求值任何入口模块，空闲触发后才拉取一次", async () => {
		const { unmount } = renderHook(() => useIdleRoutePrefetch());
		expect(abilitiesEvaluated).not.toHaveBeenCalled();
		expect(newSessionEvaluated).not.toHaveBeenCalled();

		// jsdom 无 requestIdleCallback，走 setTimeout 兜底路径。
		vi.advanceTimersByTime(3000);
		// 动态 import 是微任务，等它落地。
		await vi.waitFor(() => expect(abilitiesEvaluated).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(newSessionEvaluated).toHaveBeenCalledTimes(1));

		// 再挂载一次：模块已在缓存里，不会重复求值，点击时也就不用再等。
		unmount();
		renderHook(() => useIdleRoutePrefetch());
		vi.advanceTimersByTime(3000);
		await Promise.resolve();
		expect(abilitiesEvaluated).toHaveBeenCalledTimes(1);
		expect(newSessionEvaluated).toHaveBeenCalledTimes(1);
	});

	it("空闲触发前卸载则取消预取", async () => {
		const { unmount } = renderHook(() => useIdleRoutePrefetch());
		unmount();
		vi.advanceTimersByTime(10_000);
		await Promise.resolve();
		expect(abilitiesEvaluated).not.toHaveBeenCalled();
		expect(newSessionEvaluated).not.toHaveBeenCalled();
	});
});
