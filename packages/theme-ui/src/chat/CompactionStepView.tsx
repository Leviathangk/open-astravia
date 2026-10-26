import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

/** 距底部小于这个距离就当作“贴着尾”，继续跟随流式正文。 */
const SUMMARY_TAIL_THRESHOLD_PX = 12;

export interface CompactionStepViewProps {
	readonly status: "running" | "success" | "error" | "skipped";
	/** Row title, e.g. "Compacting context…" / "Context compacted". */
	readonly label: string;
	/** Secondary text after the title, e.g. the context size before compaction. */
	readonly detail?: string;
	/** The summary that replaced the earlier conversation; the row opens to show it. */
	readonly summary?: string;
	/**
	 * 摘要正文的渲染器。宿主传入时用 Markdown 等富文本渲染，缺省按纯文本展示——
	 * 主题包不认识宿主的 Markdown 管线，只提供注入点。
	 */
	readonly renderSummary?: (summary: string, streaming: boolean) => ReactNode;
	/**
	 * 压缩还在跑、第一段摘要文本尚未到达时面板里的占位内容。
	 * 主题包不持有语言，由宿主传入已翻译的文案。
	 */
	readonly pendingHint?: ReactNode;
	/**
	 * 宿主持有的展开态。传入时它是面板开合的唯一事实源：组件内不再保留能覆盖它的状态，
	 * 点击只通知宿主。running 期间默认展开由宿主提供（桌面端是
	 * `useExpansion(key, status === "running")`），展开态才能跨列表卸载重挂存活。
	 * 不传时退回组件内的选择，语义相同但不跨重挂。
	 */
	readonly expanded?: boolean;
	readonly onToggle?: () => void;
	readonly exportMode?: boolean;
}

const STATUS_ICON: Record<CompactionStepViewProps["status"], string> = {
	running: "icon-[mdi--compress] animate-pulse text-sky-500/80 dark:text-sky-400/80",
	success: "icon-[mdi--compress] text-sky-500 dark:text-sky-400",
	error: "icon-[solar--danger-circle-linear] text-destructive/70",
	skipped: "icon-[mdi--skip-next-circle-outline] text-muted-foreground/60",
};

/**
 * Automatic context compaction as a step of the reply: same row rhythm as a
 * tool step, set apart by its icon and accent so it never reads as agent work.
 *
 * While streaming (status === "running") the summary panel starts expanded so
 * the user can follow the summary being generated in real time; collapsing it
 * is then honoured, including while further summary deltas keep arriving.
 */
export function CompactionStepView({
	status,
	label,
	detail,
	summary,
	expanded: expandedProp,
	onToggle,
	exportMode = false,
	renderSummary,
	pendingHint,
}: CompactionStepViewProps): JSX.Element {
	// 非受控模式的展开态；null 表示用户还没点过，此时按状态取默认值。
	// 用户的选择必须记住：压缩期间每来一段摘要增量都会重渲染，回退成默认值就会把它顶开。
	const [chosen, setChosen] = useState<boolean | null>(null);
	const generatedId = useId();
	const panelId = exportMode ? `export-compaction-step-${generatedId}` : undefined;
	const hasSummary = Boolean(summary?.trim());
	// 压缩实测可能跑几分钟且首段 delta 到达前没有任何文本：running 期间就必须可展开，
	// 否则用户只能看完一个不能点开、也不显示进度的行。
	const hasContent = hasSummary || status === "running";
	const summaryRef = useRef<HTMLDivElement>(null);
	// 摘要框高度固定、内容自己滚：流式时新文本落在框底，不跟着滚就只能看到旧内容，
	// 而用户滑的轮子滚的是外层会话，两边就不同步。
	const followTailRef = useRef(true);
	// 用户自己往上翻就停跟；回到底部再恢复。
	const onSummaryScroll = (element: HTMLDivElement) => {
		followTailRef.current =
			element.scrollHeight - element.clientHeight - element.scrollTop <= SUMMARY_TAIL_THRESHOLD_PX;
	};
	// 受控时宿主是唯一事实源：组件内若再记一份用户选择，程序化收起（全局折叠、切会话）
	// 会被这份旧选择压住，Virtuoso 卸载重挂又会把它丢掉，表现成「收起后滚出去再滚回来
	// 又展开了」。非受控时 running 只提供默认值——旧实现把它并进 open，压缩期间这一行
	// 永远收不起来，点标题改到的只是一个随后被覆盖的受控值。
	const controlled = expandedProp !== undefined;
	const defaultExpanded = status === "running";
	const expanded = expandedProp ?? chosen ?? defaultExpanded;
	const open = hasContent && (expanded || exportMode);

	useEffect(() => {
		if (status !== "running") return;
		// 新一轮压缩的摘要从框顶开始，先回到跟随状态。
		followTailRef.current = true;
	}, [status]);
	useEffect(() => {
		const element = summaryRef.current;
		if (!open || status !== "running" || !followTailRef.current || !element) return;
		element.scrollTop = element.scrollHeight;
	}, [open, status, summary]);
	return (
		<div className="compaction-step min-w-0 w-full" data-compaction-step={status}>
			<button
				type="button"
				disabled={!hasContent}
				aria-expanded={open}
				data-export-toggle={hasContent ? panelId : undefined}
				onClick={() => {
					// 受控时翻转由宿主完成；非受控时取反当前实际显示的状态，
					// running 的默认展开不在任何布尔里，取反不了。
					onToggle?.();
					if (!controlled) setChosen(!open);
				}}
				className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors enabled:hover:bg-sky-500/10"
			>
				<span className={`h-3.5 w-3.5 shrink-0 ${STATUS_ICON[status]}`} aria-hidden="true" />
				<span
					className={`min-w-0 truncate text-[0.8125rem] ${
						status === "running"
							? "tool-call-shimmer-text"
							: status === "error"
								? "text-destructive/80"
								: status === "skipped"
									? "text-muted-foreground/70"
									: "text-sky-600/90 dark:text-sky-300/85"
					}`}
				>
					{label}
				</span>
				{detail ? (
					<span className="shrink-0 text-[0.75rem] text-muted-foreground/50 tabular-nums">{detail}</span>
				) : null}
				{hasContent ? (
					<span
						className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
						aria-hidden="true"
					/>
				) : null}
			</button>
			{hasContent ? (
				<CollapsePanel open={open} id={panelId} exportPanel={exportMode} hidden={exportMode && !expanded}>
					<div className="ml-4 border-sky-500/25 border-l pb-1 pl-3">
						<div
							ref={exportMode ? undefined : summaryRef}
							onScroll={(event) => onSummaryScroll(event.currentTarget)}
							data-compaction-summary=""
							className="compaction-summary max-h-72 overflow-y-auto break-words py-1 text-muted-foreground/80"
						>
							{summary === undefined ? (
								status === "running" ? (
									pendingHint
								) : null
							) : renderSummary ? (
								// `streaming`：这段文本还在增长。增长期每次增量都整篇重解析会随长度线性变贵，
								// 所以宿主可以在这段时间只输出纯文本、结束后再解析一次（桌面端就是这么做的）。
								// 导出快照要的是完整正文，流式渲染只会给出已放出的那一段，所以这里排除导出。
								renderSummary(summary, status === "running" && !exportMode)
							) : (
								<div className="whitespace-pre-wrap">{summary}</div>
							)}
						</div>
					</div>
				</CollapsePanel>
			) : null}
		</div>
	);
}
