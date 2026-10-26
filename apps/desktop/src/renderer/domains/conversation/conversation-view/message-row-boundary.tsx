import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * 单行降级提示。必须可见且不能像「消息被删了」：正文渲染崩溃时数据仍在会话记录里。
 *
 * 独立成函数组件而不是写在 class 里，是因为文案要走 i18n 的 hook。
 */
function MessageRowFailureNotice(): JSX.Element {
	const { t } = useTranslation("chat");
	return (
		<div
			role="alert"
			data-message-render-failed=""
			className="rounded-md border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-[0.8125rem] text-muted-foreground"
		>
			<div className="font-medium text-foreground/80">{t("messageList.rowRenderFailed.title")}</div>
			<div className="mt-0.5">{t("messageList.rowRenderFailed.detail")}</div>
		</div>
	);
}

interface MessageRowBoundaryProps {
	/** 该行承载的消息身份；身份变了就是一次新的渲染尝试。 */
	readonly resetKey: string;
	readonly children: ReactNode;
}

interface MessageRowBoundaryState {
	readonly failed: boolean;
	readonly resetKey: string;
}

/**
 * 把正文渲染崩溃关在产生它的那一行里。
 *
 * React Router 的 route errorElement 在错误冒出子孙树时会替换整页，而消息行是可以
 * 独立存活的最小单位：其余消息继续渲染，读者也被明确告知哪一行没显示出来。
 *
 * 重试只依赖两件事：行被重新挂载（Virtuoso 回收后重挂、切会话），或 `resetKey`
 * 换成了另一条消息。刻意不在内容变化时重置——流式期间每个 token 都会重渲一次，
 * 那样会变成每个 token 崩溃重试一轮，日志和渲染都得翻倍。
 */
export class MessageRowBoundary extends Component<MessageRowBoundaryProps, MessageRowBoundaryState> {
	constructor(props: MessageRowBoundaryProps) {
		super(props);
		this.state = { failed: false, resetKey: props.resetKey };
	}

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	static getDerivedStateFromProps(
		props: MessageRowBoundaryProps,
		state: MessageRowBoundaryState,
	): Partial<MessageRowBoundaryState> | null {
		if (props.resetKey === state.resetKey) return null;
		return { failed: false, resetKey: props.resetKey };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("Message row failed to render", error, info.componentStack);
	}

	render(): ReactNode {
		return this.state.failed ? <MessageRowFailureNotice /> : this.props.children;
	}
}
