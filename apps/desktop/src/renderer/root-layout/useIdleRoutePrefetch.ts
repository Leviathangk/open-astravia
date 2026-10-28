import { useEffect } from "react";
import { loadNewSessionPage } from "../route-page-loaders";

/**
 * 空闲期预取高频入口的路由 chunk。
 *
 * 侧栏置顶默认只有「能力」和设计画廊两个入口；设计画廊由插件宿主在启动时加载，
 * 而能力页是 React.lazy 的独立 chunk——低配机上首次点击要现付「下载 + 解析 +
 * 求值」。这里在首帧之后的空闲时间把它拉进模块缓存，点击时零等待。
 * 调用方必须先等待实际路由绘制；网络加载期间的主线程空闲不代表启动完成。
 * requestIdleCallback（带兜底超时）只负责安排这之后的空闲任务。
 *
 * 新会话页同理，而它漏得更严重：早期那段预取只在「停在欢迎页且没有待恢复会话」时跑，
 * 真实使用里最少见的就是这个状态——绝大多数时候用户正在某个会话里，点「新建会话」
 * 才开始取模块，停顿就落在切页动画之后。这里补上，与入口状态无关。
 */
const PREFETCHERS: ReadonlyArray<() => Promise<unknown>> = [
	() => import("../domains/abilities/components/AbilitiesPage"),
	() => loadNewSessionPage(),
];

export function useIdleRoutePrefetch(): void {
	useEffect(() => {
		const run = (): void => {
			for (const load of PREFETCHERS) {
				void load().catch(() => {
					// 预取失败无需上报：真正导航时 React.lazy 会重试并走正常错误路径。
				});
			}
		};
		if (typeof window.requestIdleCallback === "function") {
			const id = window.requestIdleCallback(run, { timeout: 8000 });
			return () => window.cancelIdleCallback(id);
		}
		const id = window.setTimeout(run, 3000);
		return () => window.clearTimeout(id);
	}, []);
}
