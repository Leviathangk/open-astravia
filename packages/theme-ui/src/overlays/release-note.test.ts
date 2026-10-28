import { describe, expect, it } from "vitest";
import { normalizeReleaseNote, outlineReleaseNote } from "./release-note";

// GitHub 的 Atom feed 会把发布说明先渲染成 HTML 再塞进 <content>，
// electron-updater 的 GitHub provider 原样把它当成 releaseNotes 传下来。
const GITHUB_FEED_HTML =
	"<h2>新增</h2>\n<ul>\n<li><strong>内置浏览器可以从标签页菜单添加了</strong>：现在它按普通面板参与可见性解析。</li>\n<li><strong>官网新增社群入口</strong>：QQ 群与微信群两张码位于页脚。</li>\n</ul>\n<h2>修复</h2>\n<ul>\n<li>说明里的 <code>~/.astravia</code> 路径可以直接复制。</li>\n</ul>";

const RELEASE_NOTES_MARKDOWN = "## 新增\n\n- **内置浏览器可以从标签页菜单添加了**：现在它按普通面板参与可见性解析。";

describe("normalizeReleaseNote", () => {
	it("turns the HTML the update feed delivers into markdown", () => {
		expect(normalizeReleaseNote(GITHUB_FEED_HTML)).toBe(
			[
				"## 新增",
				"",
				"- **内置浏览器可以从标签页菜单添加了**：现在它按普通面板参与可见性解析。",
				"- **官网新增社群入口**：QQ 群与微信群两张码位于页脚。",
				"",
				"## 修复",
				"",
				"- 说明里的 `~/.astravia` 路径可以直接复制。",
			].join("\n"),
		);
	});

	it("leaves markdown from the release notes file untouched", () => {
		expect(normalizeReleaseNote(RELEASE_NOTES_MARKDOWN)).toBe(RELEASE_NOTES_MARKDOWN);
		expect(normalizeReleaseNote(`  ${RELEASE_NOTES_MARKDOWN}\n\n`)).toBe(RELEASE_NOTES_MARKDOWN);
	});

	it("keeps no markup at all, so remote notes cannot inject elements", () => {
		const note = `${GITHUB_FEED_HTML}<script>alert(1)</script><img src=x onerror=alert(1)><style>p{}</style>`;
		const normalized = normalizeReleaseNote(note);

		expect(normalized).not.toMatch(/<[a-z/!]/i);
		expect(normalized).not.toContain("alert(1)");
		expect(normalized).not.toContain("p{}");
		expect(normalized).toContain("## 新增");
	});

	it("decodes the entities the feed escapes", () => {
		expect(normalizeReleaseNote("<p>A &amp; B &lt;tag&gt; &#39;quoted&#39; &quot;text&quot;</p>")).toBe(
			"A & B <tag> 'quoted' \"text\"",
		);
	});

	it("keeps links as markdown and drops paragraphs headings nested deeper than h3", () => {
		expect(normalizeReleaseNote('<h4>细项</h4><p>见 <a href="https://example.com/a">发布页</a>。</p>')).toBe(
			"### 细项\n\n见 [发布页](https://example.com/a)。",
		);
	});

	it("handles a feed that escapes the html one more level", () => {
		expect(normalizeReleaseNote("&lt;h2&gt;新增&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;说明&lt;/li&gt;&lt;/ul&gt;")).toBe(
			"## 新增\n\n- 说明",
		);
	});

	it("returns an empty string for empty input", () => {
		expect(normalizeReleaseNote("   \n  ")).toBe("");
	});
});

describe("outlineReleaseNote", () => {
	it("splits sections, lead-in titles and body so the preview can number them", () => {
		const outline = outlineReleaseNote(
			[
				"# Astravia 0.5.81",
				"",
				"2026-10-28",
				"",
				"## 新增",
				"",
				"- **甲**：一。",
				"",
				"## 修复",
				"",
				"- **乙**：二。",
				"- 三。",
			].join("\n"),
		);

		// 版本号已经在卡片上，说明里的 H1 不重复渲染；日期单独占一行。
		expect(outline.date).toBe("2026-10-28");
		expect(outline.sections.map((section) => section.title)).toEqual(["新增", "修复"]);
		expect(outline.sections[0].items).toEqual([{ title: "甲", body: "一。" }]);
		expect(outline.sections[1].items).toEqual([{ title: "乙", body: "二。" }, { body: "三。" }]);
	});

	it("joins soft-wrapped lines instead of shredding one item into several", () => {
		const outline = outlineReleaseNote("## 修复\n\n- **长句子**：前半句，\n还接在这里。");

		expect(outline.sections[0].items).toEqual([{ title: "长句子", body: "前半句， 还接在这里。" }]);
	});

	it("falls back to one untitled section for notes without any heading", () => {
		const outline = outlineReleaseNote("第一段。\n\n第二段。");

		expect(outline).toEqual({ sections: [{ items: [{ body: "第一段。" }, { body: "第二段。" }] }] });
	});

	it("drops the inline marks the preview cannot use", () => {
		const outline = outlineReleaseNote(
			"## 修复\n\n- 路径 `~/.astravia` 与链接 [发布页](https://example.com/a) 都可读。",
		);

		expect(outline.sections[0].items).toEqual([{ body: "路径 ~/.astravia 与链接 发布页 都可读。" }]);
	});

	it("turns deeper headings and code fences into readable text instead of raw marks", () => {
		// GitHub feed 的 h4 经 normalizeReleaseNote 压成 `###`，直接原样渲染会在 12px 小字里
		// 排出一行井号；围栏代码块的 ``` 同理。预览只需要看得懂的文本。
		const outline = outlineReleaseNote("## 修复\n\n### 细项\n\n```\nnpm i -g astravia\n```");

		expect(outline.sections[0].items).toEqual([{ body: "细项" }, { body: "npm i -g astravia" }]);
	});

	it("returns no sections for an empty note", () => {
		expect(outlineReleaseNote("  \n ")).toEqual({ sections: [] });
	});
});
