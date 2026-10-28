/**
 * 新会话页的规范入口。
 *
 * 曾经所有入口都跳 `/new-session/$cwd`，那是个只为兼容旧深链保留的路由：
 * 它的 `beforeLoad` 立刻 `throw redirect` 到 `/new-session?cwd=…`。于是每点一次
 * 「新建会话」，路由都要先匹配一个什么都不渲染的路由、跑一遍 `beforeLoad`、再重定向
 * 到真正的页面——一次点击走两趟解析，`cwd` 还在这条链上被编码解码两遍。
 *
 * 放在 app-shell 而不是某个 domain：project（侧栏、详情页）、conversation（会话打开器）
 * 和 root-layout 都要用它，落在任一 domain 里都等于让别的领域深引其内部模块。
 *
 * 应用内跳转统一走这里，直接落到规范路由；`/new-session/$cwd` 只留给外部深链
 * （插件 hash 路径、历史书签），由路由层重定向兜住。
 */
export interface NewSessionTarget {
	readonly to: "/new-session";
	readonly search: { readonly cwd: string };
}

export function newSessionTarget(cwd: string): NewSessionTarget {
	return { to: "/new-session", search: { cwd: encodeURIComponent(cwd) } };
}

/** 从规范路由的 `search.cwd` 还原出真实 cwd；编码损坏时退回原串，不要抛给路由层。 */
export function decodeNewSessionCwd(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
