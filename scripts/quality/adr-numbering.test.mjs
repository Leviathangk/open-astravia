import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findAdrNumberingProblems } from "./check-adr-numbering.mjs";
import { repoRoot } from "./lib.mjs";

const ADR_DIR = join(repoRoot, "docs/adr");

const README = [
	"# 架构决策记录（ADR）",
	"",
	"### 1. 编号空洞",
	"",
	"| 编号 | 主题 |",
	"| --- | --- |",
	"| 0016 | Astravia Go 窗口配额服务 |",
	"",
	"### 2. 编号重复",
	"",
	"以下编号各对应多个不同主题的文件：",
	"",
	"`0021` `0079`",
	"",
	"其中 `0079` 有三个文件，其余各两个。",
	"",
	"## 新增 ADR",
	"",
	"取当前最大编号 +1。",
].join("\n");

function files(entries) {
	return entries.flatMap(([number, count]) =>
		Array.from({ length: count }, (_, index) => `${number}-topic-${index + 1}.md`),
	);
}

function find(entries, readmeText = README) {
	return findAdrNumberingProblems({ fileNames: files(entries), readmeText }).join("\n");
}

describe("ADR numbering guard", () => {
	it("accepts the committed README and the real docs/adr tree", () => {
		const fileNames = readdirSync(ADR_DIR).filter((name) => /^\d{4}-.+\.md$/u.test(name));
		const readmeText = readFileSync(join(ADR_DIR, "README.md"), "utf8");
		expect(fileNames.length).toBeGreaterThan(100);
		expect(findAdrNumberingProblems({ fileNames, readmeText })).toEqual([]);
	});

	it("fails when a real duplicate number is not registered", () => {
		const problems = find([
			["0021", 2],
			["0079", 3],
			["0131", 2],
		]);
		expect(problems).toContain("重复编号 0131 未登记");
	});

	it("fails when a registered number is no longer a duplicate", () => {
		const problems = find([
			["0021", 1],
			["0079", 3],
		]);
		expect(problems).toContain("清单登记了 0021");
	});

	it("fails when the sentence promises three files and none has three", () => {
		const problems = find([
			["0021", 2],
			["0079", 2],
		]);
		expect(problems).toContain("没有任何编号超过两个文件");
	});

	it("fails when the duplicate file counts moved beyond the wording", () => {
		const problems = find([
			["0021", 2],
			["0079", 4],
		]);
		expect(problems).toContain("请改写这句说明");
	});

	it("fails when a gap number exists as a real file", () => {
		const problems = find([
			["0016", 1],
			["0021", 2],
			["0079", 3],
		]);
		expect(problems).toContain("「编号空洞」登记了 0016");
	});

	it("fails when the duplicate list is not sorted", () => {
		const readme = README.replace("`0021` `0079`", "`0079` `0021`");
		const problems = find(
			[
				["0021", 2],
				["0079", 3],
			],
			readme,
		);
		expect(problems).toContain("未按编号升序排列");
	});
});
