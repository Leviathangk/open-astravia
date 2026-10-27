/**
 * Keep `docs/adr/README.md` honest about the ADR numbering it explains.
 *
 * 编号一经分配即冻结，所以「空洞」与「重复」都是刻意保留的现象，只能靠 README 说明。
 * 这份说明一旦落后于 `docs/adr/` 的真实文件，读者就会照着错的清单去找 ADR，因此这里把它机械核对：
 * 登记了并不重复的号、漏登了实际重复的号、「其中 0079 有三个文件」这句的数量、以及空洞号出现真实文件。
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fail, isDirectRun, ok, readText, repoRoot } from "./lib.mjs";

const ADR_DIR = join(repoRoot, "docs/adr");
const README = join(ADR_DIR, "README.md");
const ADR_FILE_RE = /^(\d{4})-.+\.md$/u;
const GAP_ROW_RE = /^\|\s*(\d{4})\s*\|/u;
const DUPLICATE_LIST_RE = /^(?:`\d{4}`[ \t]*)+$/u;
const DUPLICATE_TOKEN_RE = /`(\d{4})`/gu;
const HEAVY_NOTE_RE = /其中\s*`(\d{4})`\s*有三个文件/u;

/** 文件名 → 编号 → 该编号下的文件名列表。 */
export function collectAdrNumbers(fileNames) {
	const byNumber = new Map();
	for (const name of fileNames) {
		const match = ADR_FILE_RE.exec(name);
		if (!match) continue;
		const number = match[1];
		const bucket = byNumber.get(number);
		if (bucket) bucket.push(name);
		else byNumber.set(number, [name]);
	}
	return byNumber;
}

/** 切出 README 里某一节（到下一个同级或更高级标题为止）。 */
function section(readmeText, heading) {
	const start = readmeText.indexOf(heading);
	if (start === -1) return "";
	const rest = readmeText.slice(start + heading.length);
	const end = rest.search(/^#{2,3} /mu);
	return end === -1 ? rest : rest.slice(0, end);
}

export function parseReadmeNumbering(readmeText) {
	const gapSection = section(readmeText, "### 1. 编号空洞");
	const duplicateSection = section(readmeText, "### 2. 编号重复");
	const gaps = [];
	for (const line of gapSection.split("\n")) {
		const match = GAP_ROW_RE.exec(line);
		if (match) gaps.push(match[1]);
	}
	// 只认「整行都是编号」的那一行：同节其它句子会点名具体编号（三个文件那个），不能算进清单。
	const duplicates = [];
	for (const line of duplicateSection.split("\n")) {
		if (!DUPLICATE_LIST_RE.test(line.trim())) continue;
		for (const match of line.matchAll(DUPLICATE_TOKEN_RE)) duplicates.push(match[1]);
	}
	const heavyNote = HEAVY_NOTE_RE.exec(duplicateSection);
	return { duplicates, gaps, heavyNumber: heavyNote?.[1] ?? null };
}

export function findAdrNumberingProblems({ fileNames, readmeText }) {
	const problems = [];
	const byNumber = collectAdrNumbers(fileNames);
	const { duplicates, gaps, heavyNumber } = parseReadmeNumbering(readmeText);

	if (duplicates.length === 0 && gaps.length === 0 && heavyNumber === null) {
		problems.push("README 里读不到「编号空洞」表与「编号重复」清单，编号规则的说明已经失效");
	}

	const actualDuplicates = [...byNumber.entries()]
		.filter(([, names]) => names.length > 1)
		.sort(([a], [b]) => a.localeCompare(b));
	const actualNumbers = new Set(actualDuplicates.map(([number]) => number));
	const listedNumbers = new Set(duplicates);

	for (const [number, names] of actualDuplicates) {
		if (!listedNumbers.has(number)) {
			problems.push(
				`重复编号 ${number} 未登记（${names.length} 个文件：${names.join("、")}），请补进「编号重复」清单`,
			);
		}
	}
	for (const number of duplicates) {
		if (!actualNumbers.has(number)) {
			const names = byNumber.get(number) ?? [];
			problems.push(
				`「编号重复」清单登记了 ${number}，但它只有 ${names.length} 个文件（${names.join("、") || "无"}），已不再重复`,
			);
		}
	}
	const sortedDuplicates = [...duplicates].sort((a, b) => a.localeCompare(b));
	if (duplicates.join(" ") !== sortedDuplicates.join(" ")) {
		problems.push(`「编号重复」清单未按编号升序排列：当前为 ${duplicates.join(" ")}`);
	}

	const heavy = actualDuplicates.filter(([, names]) => names.length >= 3);
	const othersAllPairs = actualDuplicates.filter(([, names]) => names.length > 1 && names.length < 3).length;
	if (heavy.length === 0) {
		if (heavyNumber !== null) {
			problems.push(`README 声明 ${heavyNumber} 有三个文件，但没有任何编号超过两个文件`);
		}
	} else if (heavy.length === 1 && heavy[0][1].length === 3 && othersAllPairs === actualDuplicates.length - 1) {
		if (heavyNumber !== heavy[0][0]) {
			problems.push(`有三个文件的编号是 ${heavy[0][0]}，但 README 写的是 ${heavyNumber ?? "（没有这句）"}`);
		}
	} else {
		const summary = actualDuplicates.map(([number, names]) => `${number}×${names.length}`).join(" ");
		problems.push(`重复编号的文件数已不是「一个三文件、其余两个」（实际：${summary}），请改写这句说明`);
	}

	for (const number of gaps) {
		const names = byNumber.get(number);
		if (names) {
			problems.push(`「编号空洞」登记了 ${number}，但 docs/adr/ 下存在 ${names.join("、")}`);
		}
	}

	return problems;
}

export function main() {
	const fileNames = readdirSync(ADR_DIR).filter((name) => ADR_FILE_RE.test(name));
	const problems = findAdrNumberingProblems({ fileNames, readmeText: readText(README) });
	if (problems.length > 0) {
		for (const problem of problems) fail(`[adr-numbering] ${problem}`);
		return 1;
	}
	ok(`[adr-numbering] ok (${fileNames.length} ADR file(s))`);
	return 0;
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
