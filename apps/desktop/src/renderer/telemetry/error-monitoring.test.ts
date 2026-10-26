import { describe, expect, it, vi } from "vitest";
import { reactComponentStack } from "../shared/lib/react-error-details";
import { captureReactError } from "./error-monitoring";

const errorInfo = {
	componentStack: "\n    at DesignSystemGrid\n    at Gallery",
} as Parameters<typeof captureReactError>[1];

describe("captureReactError", () => {
	it("把 React 给的组件栈落进渲染日志，并留给错误页复用", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new Error("Minified React error #185; visit https://react.dev/errors/185");

		captureReactError(error, errorInfo);

		const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
		expect(logged).toContain("[react error]");
		expect(logged).toContain("component stack:");
		expect(logged).toContain("at DesignSystemGrid");
		// 错误页在兜底树里读同一份旁路缓存，两边不能各自取一次、又各自落空。
		expect(reactComponentStack(error)).toContain("at DesignSystemGrid");
		spy.mockRestore();
	});
});

/** 生产构建下 React 只给编号，这份栈是唯一能反查回源码调用点的信息。 */
const NESTED_UPDATE_STACK = [
	"Error: Minified React error #185; visit https://react.dev/errors/185",
	"    at flushSyncCallbacks (react-dom-client.production.js:11270:27)",
	"    at dispatchSetState (react-dom-client.production.js:12015:15)",
].join("\n");

/** 只取本次落盘打出的那一条，避免混入 Sentry 或 React 自己的 console 输出。 */
function reactErrorCalls(spy: {
	readonly mock: { readonly calls: ReadonlyArray<ReadonlyArray<unknown>> };
}): ReadonlyArray<ReadonlyArray<unknown>> {
	return spy.mock.calls.filter((call) => call[0] === "[react error]");
}

describe("logReactError", () => {
	it("把错误自身的 JS 栈与组件栈分开落盘", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new Error("Minified React error #185; visit https://react.dev/errors/185");
		error.stack = NESTED_UPDATE_STACK;

		captureReactError(error, errorInfo);

		const calls = reactErrorCalls(spy);
		expect(calls).toHaveLength(1);
		const [tag, reason, componentPart, jsStackPart] = calls[0];
		expect(tag).toBe("[react error]");
		expect(reason).toBe("Minified React error #185; visit https://react.dev/errors/185");
		expect(String(componentPart)).toContain("component stack:");
		expect(String(componentPart)).toContain("at DesignSystemGrid");
		// 两段不能拼在一起，否则读日志时无法区分是组件树还是调用栈。
		expect(String(componentPart)).not.toContain("js stack:");
		expect(String(jsStackPart)).toContain("js stack:");
		expect(String(jsStackPart)).toContain("at dispatchSetState (react-dom-client.production.js:12015:15)");
		spy.mockRestore();
	});

	it("错误值不是 Error 时不造假栈，也不抛", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() => captureReactError("boom", errorInfo)).not.toThrow();

		const calls = reactErrorCalls(spy);
		expect(calls).toHaveLength(1);
		const [tag, reason, componentPart] = calls[0];
		expect(tag).toBe("[react error]");
		expect(reason).toBe("boom");
		expect(String(componentPart)).toContain("component stack:");
		// 拿不到真栈就不写这一段，而不是把 String(error) 当栈写进去。
		expect(calls[0].map((value) => String(value)).join(" ")).not.toContain("js stack:");
		spy.mockRestore();
	});

	it("栈为空时不输出空的 js stack 段", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new Error("Minified React error #185; visit https://react.dev/errors/185");
		error.stack = "   ";

		captureReactError(error, errorInfo);

		const calls = reactErrorCalls(spy);
		expect(calls).toHaveLength(1);
		const logged = calls[0].map((value) => String(value)).join(" ");
		expect(logged).toContain("component stack:");
		expect(logged).not.toContain("js stack:");
		spy.mockRestore();
	});
});
