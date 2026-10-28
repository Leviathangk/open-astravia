import { describe, expect, it } from "vitest";
import { decodeNewSessionCwd, newSessionTarget } from "./new-session-route";

/**
 * 新会话入口的路由合同（app-shell 层：project / conversation / root-layout 共用）：应用内一律直达 `/new-session?cwd=…`，不再先落到只为旧深链
 * 保留的 `/new-session/$cwd`（那条路由的 `beforeLoad` 会再重定向一次）。
 * cwd 在 query 上仍然编码，页面侧按一次 decode 还原——编码必须成对，否则
 * 带空格或 `#` 的路径会在跳转后打开错误的目录。
 */
describe("newSessionTarget", () => {
	it("目标固定为规范路由，cwd 走 search", () => {
		expect(newSessionTarget("/repo/a")).toEqual({
			to: "/new-session",
			search: { cwd: encodeURIComponent("/repo/a") },
		});
	});

	it("带空格与特殊字符的路径编码后能被原样还原", () => {
		for (const cwd of ["/Users/me/My Projects/app", "/repo/#1/dir", "C:\\work\\项目"]) {
			const target = newSessionTarget(cwd);
			expect(decodeNewSessionCwd(target.search.cwd)).toBe(cwd);
		}
	});
});

describe("decodeNewSessionCwd", () => {
	it("缺失时返回 undefined", () => {
		expect(decodeNewSessionCwd(undefined)).toBeUndefined();
		expect(decodeNewSessionCwd("")).toBeUndefined();
	});

	it("编码损坏时退回原串，不抛给路由层", () => {
		expect(decodeNewSessionCwd("%E0%A4%A")).toBe("%E0%A4%A");
	});
});
