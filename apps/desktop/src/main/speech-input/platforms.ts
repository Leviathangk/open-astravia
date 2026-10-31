import supportedPlatforms from "./supported-platforms.json";

/**
 * 「系统-架构」到 sherpa-onnx 原生包名的唯一映射。
 *
 * 只有这里列出的目标会带原生运行时和约 160 MiB 的识别模型：其余平台不编入，免得每个产物
 * 都塞一份用不到的原生库。包名不能从标签直接拼——Windows 的包叫 `sherpa-onnx-win-x64`
 * 而不是 `win32`——所以包名写在这里，不散落在适配层和打包脚本里。
 *
 * 构建脚本 `scripts/speech-input-build-config.js` 读同一个 JSON，两层不会各写一份。
 */
export const SPEECH_INPUT_NATIVE_MODULES: Readonly<Record<string, string>> = supportedPlatforms.platforms;

/** 原生包与构建目标共用同一套标签：`darwin-arm64` 既是目标标签也是映射键。 */
export function speechInputPlatformTag(platform: string, arch: string): string {
	return `${platform}-${arch}`;
}

export function isSpeechInputPlatformSupported(platform: string, arch: string): boolean {
	return speechInputPlatformTag(platform, arch) in SPEECH_INPUT_NATIVE_MODULES;
}

export function resolveSherpaNativeModule(platform: string, arch: string): string {
	const tag = speechInputPlatformTag(platform, arch);
	const moduleName = SPEECH_INPUT_NATIVE_MODULES[tag];
	if (!moduleName) throw new Error(`Unsupported speech input platform: ${tag}`);
	return moduleName;
}
