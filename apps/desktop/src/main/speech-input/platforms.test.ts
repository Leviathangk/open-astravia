import { describe, expect, it } from "vitest";
import { isSpeechInputPlatformSupported, resolveSherpaNativeModule, SPEECH_INPUT_NATIVE_MODULES } from "./platforms.js";

describe("speech input platforms", () => {
	it("ships the native runtime for Windows x64 and both macOS architectures", () => {
		expect(SPEECH_INPUT_NATIVE_MODULES).toEqual({
			"win32-x64": "sherpa-onnx-win-x64",
			"darwin-arm64": "sherpa-onnx-darwin-arm64",
			"darwin-x64": "sherpa-onnx-darwin-x64",
		});
	});

	it("maps a platform tag to the package name npm actually publishes", () => {
		// Windows 的包名是 `win`，不是平台标识里的 `win32`；这就是不能靠拼字符串的地方。
		expect(resolveSherpaNativeModule("win32", "x64")).toBe("sherpa-onnx-win-x64");
		expect(resolveSherpaNativeModule("darwin", "arm64")).toBe("sherpa-onnx-darwin-arm64");
		expect(resolveSherpaNativeModule("darwin", "x64")).toBe("sherpa-onnx-darwin-x64");
	});

	it("refuses to name a package that is never bundled", () => {
		expect(isSpeechInputPlatformSupported("linux", "x64")).toBe(false);
		expect(isSpeechInputPlatformSupported("win32", "arm64")).toBe(false);
		expect(() => resolveSherpaNativeModule("linux", "x64")).toThrow(/Unsupported speech input platform/);
	});
});
