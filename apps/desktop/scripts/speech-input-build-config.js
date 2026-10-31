import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const SPEECH_INPUT_ENABLED_ENV = "ASTRAVIA_SPEECH_INPUT_ENABLED";

const SUPPORTED_PLATFORMS_FILE = join("src", "main", "speech-input", "supported-platforms.json");

/**
 * 语音输入的原生运行时与模型只随特定目标平台分发。支持列表与运行时代码共用
 * src/main/speech-input/supported-platforms.json，两层不会各写一份。
 *
 * 路径按 `package.json` 往上找包根，不用 `import.meta.url`：Vite 会把配置文件打包成
 * 临时模块，那时 `import.meta.url` 指向临时文件而不是本文件。
 */
function resolveDesktopRoot(start) {
	let directory = resolve(start ?? process.cwd());
	for (;;) {
		if (existsSync(join(directory, SUPPORTED_PLATFORMS_FILE))) return directory;
		const parent = dirname(directory);
		if (parent === directory) throw new Error(`Cannot locate ${SUPPORTED_PLATFORMS_FILE} from ${start ?? process.cwd()}`);
		directory = parent;
	}
}

let cachedPlatforms;

/** 平台标签 → sherpa 原生包名；运行时用的是同一份映射。 */
export function resolveSpeechInputPlatformModules() {
	cachedPlatforms ??= Object.freeze(
		JSON.parse(readFileSync(join(resolveDesktopRoot(), SUPPORTED_PLATFORMS_FILE), "utf8")).platforms,
	);
	return cachedPlatforms;
}

export function resolveSpeechInputPlatformTags() {
	return Object.keys(resolveSpeechInputPlatformModules());
}

export function resolveSpeechInputTargetTags(
	env = process.env,
	platform = process.platform,
	arch = process.arch,
) {
	const configured =
		env.ASTRAVIA_IM_GATEWAY_TARGET_PLATFORMS ?? env.ASTRAVIA_CLI_TARGET_PLATFORMS ?? env.ASTRAVIA_VENDOR_PLATFORM;
	return typeof configured === "string" && configured.trim().length > 0
		? configured
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean)
		: [`${platform}-${arch}`];
}

function parseConfiguredEnabled(env) {
	const configured = env[SPEECH_INPUT_ENABLED_ENV];
	if (configured === undefined) return true;
	const raw = configured.trim();
	if (raw === "true") return true;
	if (raw === "false") return false;
	throw new Error(`${SPEECH_INPUT_ENABLED_ENV} must be "true" or "false", received: ${raw}`);
}

export function resolveSpeechInputBuildConfig({
	env = process.env,
	platform = process.platform,
	arch = process.arch,
	platformTags = resolveSpeechInputTargetTags(env, platform, arch),
} = {}) {
	const configuredEnabled = parseConfiguredEnabled(env);
	const supported = resolveSpeechInputPlatformModules();
	const targetSupported = platformTags.some((tag) => tag in supported);
	return {
		configuredEnabled,
		targetSupported,
		enabled: configuredEnabled && targetSupported,
		platformTags: [...platformTags],
		// 本次产物必须带上的原生包名；供打包前的完整性校验直接用，不再拿标签拼包名。
		nativeModules: platformTags.map((tag) => supported[tag]).filter(Boolean),
	};
}
