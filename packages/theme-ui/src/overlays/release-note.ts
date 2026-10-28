/**
 * GitHub 的 Atom feed（electron-updater 的 GitHub provider 从这里取正文）给的是
 * 已经渲染过的 HTML，而 GitHub Release API / 我们自己的发布说明文件给的是 Markdown。
 * 同一段文案因此有两种形态，渲染前在这里统一成 Markdown。
 *
 * 不做 HTML 透传：主题包不引入 rehype-raw，任何残留标签都只会被当作文本显示，
 * 所以这里把不认识的标签直接丢掉，也顺便让远端内容无法注入标记。
 */

const HTML_HINT = /<(?:h[1-6]|ul|ol|li|p|br|strong|b|em|i|code|pre|a)\b/i;

const ENTITIES: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
		if (entity.startsWith("#")) {
			const isHex = entity[1] === "x" || entity[1] === "X";
			const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[entity.toLowerCase()] ?? match;
	});
}

/** 只保留文本：`<script>` / `<style>` 连同内容一起丢掉，其余标签剥壳。 */
function stripTags(text: string): string {
	return text
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "");
}

/**
 * 把一段可能是 HTML 的发布说明转成 Markdown；已经是 Markdown 时原样返回。
 * 输出只包含文本、`#`/`-`/`**` 这类 Markdown 记号，交给 ReactMarkdown 渲染。
 */
export function normalizeReleaseNote(note: string): string {
	const trimmed = note.trim();
	if (!trimmed) return trimmed;
	// 有的 feed 会把整段 HTML 再转义一层（`&lt;h2&gt;`），不先解一次就会当成 Markdown 原样透出去，
	// 最后在界面上又变成一排标签。
	const source = HTML_HINT.test(trimmed) ? trimmed : decodeEntities(trimmed);
	if (!HTML_HINT.test(source)) return trimmed;

	const markdown = decodeEntities(
		source
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
				const text = stripTags(label).trim();
				return text ? `[${text}](${href})` : text;
			})
			.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, body: string) => {
				const text = stripTags(body).trim();
				return text ? `\n\n${"#".repeat(Math.min(Number(level), 3))} ${text}\n\n` : "\n\n";
			})
			.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, body: string) => `\n- ${body.trim()}`)
			.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, (_match, body: string) => `**${stripTags(body).trim()}**`)
			.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_match, body: string) => `**${stripTags(body).trim()}**`)
			.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, (_match, body: string) => `*${stripTags(body).trim()}*`)
			.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, body: string) => `\`${stripTags(body).trim()}\``)
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|ul|ol|div|pre|blockquote)>/gi, "\n\n")
			.replace(/<(p|ul|ol|div|pre|blockquote)\b[^>]*>/gi, "\n\n")
			// 其余标签（含远端塞进来的 <img onerror> 这类）一律丢掉，免得被当成正文或元素注入。
			.replace(/<[^>]*>/g, ""),
	);

	return (
		markdown
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			// 源 HTML 里 </li> 与 <li> 之间常有换行，直译会变成空行，列表被拆成段。
			.replace(/(\n- [^\n]*)\n{2,}(?=- )/g, "$1\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

/** 说明里的一条：加粗前缀是标题，其余是正文。 */
export interface ReleaseNoteItem {
	readonly title?: string;
	readonly body: string;
}

/** 一个 `##` 小节；说明开头没有小节标题的内容归到 `title` 缺省的那一节。 */
export interface ReleaseNoteSection {
	readonly title?: string;
	readonly items: readonly ReleaseNoteItem[];
}

/** 预览需要的最小结构：日期 + 小节 + 条目，序号由渲染侧按小节编号。 */
export interface ReleaseNoteOutline {
	readonly date?: string;
	readonly sections: readonly ReleaseNoteSection[];
}

const DATE_LINE = /^\d{4}-\d{2}-\d{2}$/u;
const H1_LINE = /^#\s+(.+)$/u;
const H2_LINE = /^##\s+(.+)$/u;
const BULLET_LINE = /^[-*]\s+(.+)$/u;
const DEEP_HEADING_LINE = /^#{3,}\s+(.+)$/u;
const FENCE_LINE = /^```/u;
const LEADING_BOLD = /^\*\*(.+?)\*\*\s*[:：]?\s*([\s\S]*)$/u;

/**
 * 行内记号在预览里一律退成纯文本：预览是「一眼看清这版改了什么」，不是可以点开的文档，
 * 保留 `**` `[]()` 只会让 12px 的小字更花。原文完整形态仍然由「查看更多」给出。
 */
function plainInline(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
		.replace(/\*\*(.+?)\*\*/gu, "$1")
		.replace(/\*([^*\n]+)\*/gu, "$1")
		.replace(/`([^`]*)`/gu, "$1")
		.replace(/\s+/gu, " ")
		.trim();
}

interface DraftSection {
	title?: string;
	blocks: string[];
}

/**
 * 把发布说明拆成「小节 → 条目」，供预览按序号渲染。
 *
 * 只认这几种记号：`# 标题`（版本号本身已在卡片上，丢弃）、`## 小节`、`- 列表项`、
 * 段落首部的 `**小标题**：`。更深的 `###` 来自 feed 的 h4+（`normalizeReleaseNote` 最多
 * 保留三级），在预览里退成一行普通文字，不把 `###` 原样显出来。其余行按软换行续到
 * 当前段落——GitHub feed 与 Release API 的换行习惯不同，逐行当条目会把一句话拆成好几条。
 */
export function outlineReleaseNote(note: string): ReleaseNoteOutline {
	const markdown = normalizeReleaseNote(note);
	if (!markdown) return { sections: [] };

	const sections: DraftSection[] = [];
	let date: string | undefined;
	let current: DraftSection | undefined;
	let block: string | undefined;

	const flushBlock = () => {
		if (block !== undefined && current) current.blocks.push(block);
		block = undefined;
	};
	const openSection = (title?: string) => {
		flushBlock();
		current = { title, blocks: [] };
		sections.push(current);
	};
	/** 首个 `##` 之前就有条目时（Release API 返回的说明可能不带小节），补一个无标题小节。 */
	const ensureSection = () => {
		if (!current) openSection();
	};

	for (const raw of markdown.split(/\r?\n/u)) {
		const line = raw.trim();
		if (!line) {
			flushBlock();
			continue;
		}
		const h2 = H2_LINE.exec(line);
		if (h2) {
			openSection(plainInline(h2[1]));
			continue;
		}
		if (H1_LINE.test(line)) {
			flushBlock();
			continue;
		}
		const deep = DEEP_HEADING_LINE.exec(line);
		if (deep) {
			flushBlock();
			ensureSection();
			block = deep[1];
			continue;
		}
		// 围栏代码块的 ``` 标记不是内容，留着只会在 12px 小字里排成一行反引号。
		if (FENCE_LINE.test(line)) {
			flushBlock();
			continue;
		}
		if (date === undefined && sections.length === 0 && block === undefined && DATE_LINE.test(line)) {
			date = line;
			continue;
		}
		const bullet = BULLET_LINE.exec(line);
		if (bullet) {
			flushBlock();
			ensureSection();
			block = bullet[1];
			continue;
		}
		ensureSection();
		block = block === undefined ? line : `${block} ${line}`;
	}
	flushBlock();

	const structured = sections
		.map((section) => {
			const items: ReleaseNoteItem[] = [];
			for (const text of section.blocks) {
				const lead = LEADING_BOLD.exec(text);
				if (lead) {
					const title = plainInline(lead[1]);
					const body = plainInline(lead[2]);
					if (title || body) items.push({ title: title || undefined, body });
					continue;
				}
				const body = plainInline(text);
				if (body) items.push({ body });
			}
			return { title: section.title, items };
		})
		.filter((section) => section.items.length > 0);

	return date === undefined ? { sections: structured } : { date, sections: structured };
}
