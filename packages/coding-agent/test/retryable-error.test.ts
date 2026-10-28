import { describe, expect, it } from "vitest";
import { classifyRuntimeFailure, isRetryableRuntimeError } from "../src/execution/failure-classification.js";

describe("runtime failure classification", () => {
	it.each([
		["prompt is too long: 101 tokens > 100 maximum", "input-too-large"],
		["HTTP 429 too many requests", "transient"],
		["No capacity available: MODEL_CAPACITY_EXHAUSTED", "transient"],
		["ECONNRESET", "transient"],
		["invalid API key", "permanent"],
		["AbortError: cancelled", "aborted"],
	] as const)("classifies %s", (message, expected) => {
		expect(classifyRuntimeFailure(new Error(message))).toBe(expected);
	});

	it("treats a momentarily empty provider account pool as transient", () => {
		// 网关上游分不到账号时回的是这句话；它不是用户请求的错，池子回补后同一请求能跑。
		expect(classifyRuntimeFailure(new Error("AIError: No available accounts"))).toBe("transient");
	});

	it("keeps quota exhaustion non-retryable", () => {
		expect(isRetryableRuntimeError("429 insufficient_quota: exceeded your current quota")).toBe(false);
	});
});
