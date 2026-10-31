import { useCallback, useRef } from "react";

/**
 * `compositionend` 与随后那次 `keydown` 的先后顺序各引擎不一致：用输入法回车确认
 * 候选词时，确认键有时落在 `isComposing` 已经为 false 之后，于是被当成「提交」。
 * 用 compositionend 之后的一小段时间兜底，这段窗口内的按键一律交还给输入法。
 */
const COMPOSITION_SETTLE_MS = 80;

export interface ImeCompositionKeyEvent {
	nativeEvent: { isComposing?: boolean };
}

export interface ImeCompositionGuard {
	/** 该按键属于输入法组合输入（含刚确认候选词的那一瞬），调用方应原样放行。 */
	shouldIgnoreKey(event: ImeCompositionKeyEvent): boolean;
	onCompositionStart(): void;
	onCompositionEnd(): void;
}

/**
 * 输入框上的回车提交必须避开输入法候选词确认，否则中文/日文等组合输入会被截成半成品。
 */
export function useImeCompositionGuard(): ImeCompositionGuard {
	const composingRef = useRef(false);
	const composedAtRef = useRef(0);

	const onCompositionStart = useCallback(() => {
		composingRef.current = true;
	}, []);

	const onCompositionEnd = useCallback(() => {
		composingRef.current = false;
		composedAtRef.current = Date.now();
	}, []);

	const shouldIgnoreKey = useCallback((event: ImeCompositionKeyEvent) => {
		if (composingRef.current || event.nativeEvent.isComposing === true) return true;
		return Date.now() - composedAtRef.current < COMPOSITION_SETTLE_MS;
	}, []);

	return { shouldIgnoreKey, onCompositionStart, onCompositionEnd };
}
