import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpeechModelDefinition } from "./model-catalog.js";
import { BUNDLED_ZIPFORMER_MODEL } from "./model-catalog.js";
import { SpeechModelManager } from "./model-manager.js";

const temporaryRoots: string[] = [];
const TEST_MODEL: SpeechModelDefinition = {
	id: "test-speech-model",
	sampleRate: 16_000,
	totalBytes: 3,
	files: [
		{
			name: "tokens.txt",
			size: 3,
			sha256: "0".repeat(64),
			url: "https://example.invalid/tokens.txt",
		},
	],
};

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createModelRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "astravia-speech-test-"));
	temporaryRoots.push(root);
	return root;
}

describe("SpeechModelManager", () => {
	it("does not inspect model files when the build disables speech input", async () => {
		const manager = new SpeechModelManager({
			enabled: false,
			platform: "win32",
			arch: "x64",
			modelRoot: "Z:/path-that-must-not-be-read",
			model: TEST_MODEL,
		});

		await expect(manager.getStatus()).resolves.toEqual({
			supported: false,
			phase: "unsupported",
			modelId: TEST_MODEL.id,
		});
	});

	it("reports support on every bundled desktop target", async () => {
		const modelRoot = await createModelRoot();
		for (const [platform, arch] of [
			["win32", "x64"],
			["darwin", "arm64"],
			["darwin", "x64"],
		] as const) {
			const manager = new SpeechModelManager({ platform, arch, modelRoot, model: TEST_MODEL });
			expect(manager.supported).toBe(true);
		}
	});

	it("rejects platforms that do not ship the native runtime", async () => {
		const modelRoot = await createModelRoot();
		const manager = new SpeechModelManager({ platform: "linux", arch: "x64", modelRoot });

		await expect(manager.getStatus()).resolves.toMatchObject({
			supported: false,
			phase: "unsupported",
			errorCode: "unsupported-platform",
		});
	});

	it("uses a complete model bundled by the build", async () => {
		const modelRoot = await createModelRoot();
		const modelDirectory = join(modelRoot, TEST_MODEL.id);
		await mkdir(modelDirectory);
		await writeFile(join(modelDirectory, "tokens.txt"), new Uint8Array(3));
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			modelRoot,
			model: TEST_MODEL,
		});

		await expect(manager.getStatus()).resolves.toMatchObject({ phase: "ready" });
		expect(manager.modelDirectory).toBe(modelDirectory);
	});

	it("reports a missing bundled model without attempting a download", async () => {
		const modelRoot = await createModelRoot();
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			modelRoot,
			model: TEST_MODEL,
		});

		await expect(manager.getStatus()).resolves.toMatchObject({
			phase: "unavailable",
			errorCode: "bundled-model-missing",
		});
	});

	it("rejects a bundled model file with the wrong size", async () => {
		const modelRoot = await createModelRoot();
		const modelDirectory = join(modelRoot, TEST_MODEL.id);
		await mkdir(modelDirectory);
		await writeFile(join(modelDirectory, "tokens.txt"), new Uint8Array(2));
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			modelRoot,
			model: TEST_MODEL,
		});

		await expect(manager.getStatus()).resolves.toMatchObject({
			phase: "unavailable",
			errorCode: "bundled-model-invalid",
		});
	});

	it("keeps the catalog total in sync with its files", () => {
		expect(BUNDLED_ZIPFORMER_MODEL.totalBytes).toBe(
			BUNDLED_ZIPFORMER_MODEL.files.reduce((total, file) => total + file.size, 0),
		);
	});
});
