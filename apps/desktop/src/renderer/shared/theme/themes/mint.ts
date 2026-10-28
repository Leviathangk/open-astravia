import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「薄荷」主题：青绿主色 + 冷调表面。
//
// 浅色画布带一层薄荷灰（不是纯白），卡面比画布更亮，muted/secondary 依次加深；
// 深色画布是近黑的冷绿，卡面与浮层逐级提亮。
// chart 取青绿一族 + 一枚冷蓝，避免图表区域显出一块不属于主题的颜色。
// 色相守住青绿一侧：与森林（橄榄绿）刻意分色相，两套深色侧栏 RGB 距离 18.5。
//
// 亮度被测试钉成不变量（palette.test.ts）：深色画布亮度必须落在 0.0075–0.02，
// 深色相邻表面 RGB 距离 ≥8；浅色四层表面彼此 ≥12。
// 深色原先压到过 0.0051——黑到没有光感，侧栏、卡面、画布糊成一片，看不出层次；
// 浅色原先只靠“卡面比画布亮一点点”做层次，四层都落在同一档米白里，读上去像一块布。
// 所以深色抬亮画布（现 0.0098），浅色改成向下逐级压暗拉开层差。

const PRIMARY_LIGHT = "#127a6b";
const PRIMARY_DARK = "#5fd4b0";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#04150f";

const LIGHT_BG = "#dcf2ee";
const LIGHT_FG = "#0f221e";
const LIGHT_CARD = "#f2fdfa";
const LIGHT_MUTED = "#cdeae5";
const LIGHT_SECONDARY = "#bfe2dc";
const LIGHT_ACCENT = "#d0ece8";
const LIGHT_BORDER = "#a5d3cb";
const LIGHT_INPUT = "#b6dcd6";
const LIGHT_MUTED_FG = "#33564f";

const DARK_BG = "#0a1c1d";
const DARK_FG = "#e0f0ea";
const DARK_CARD = "#142e2b";
const DARK_POPOVER = "#16332e";
const DARK_MUTED = "#0f2422";
const DARK_SECONDARY = "#1a3a36";
const DARK_ACCENT = "#20433c";
const DARK_BORDER = "#2b5249";
const DARK_INPUT = "#336052";
const DARK_MUTED_FG = "#86a8a1";

export const mintTheme: ThemeDef = {
	id: "mint",
	label: "Mint",
	dark: {
		...defaultTheme.dark,
		background: DARK_BG,
		foreground: DARK_FG,
		card: DARK_CARD,
		cardForeground: DARK_FG,
		popover: DARK_POPOVER,
		popoverForeground: DARK_FG,
		primary: PRIMARY_DARK,
		primaryForeground: PRIMARY_FG_DARK,
		secondary: DARK_SECONDARY,
		secondaryForeground: DARK_FG,
		muted: DARK_MUTED,
		mutedForeground: DARK_MUTED_FG,
		accent: DARK_ACCENT,
		accentForeground: DARK_FG,
		destructive: "#ff8a8e",
		destructiveForeground: "#1a0d0e",
		border: DARK_BORDER,
		input: DARK_INPUT,
		inputBarBg: DARK_CARD,
		ring: PRIMARY_DARK,
		chart1: "#62c9a8",
		chart2: "#3d9d85",
		chart3: "#8fe0c8",
		chart4: "#4a90c0",
		chart5: "#7f9b94",
	},
	light: {
		...defaultTheme.light,
		background: LIGHT_BG,
		foreground: LIGHT_FG,
		card: LIGHT_CARD,
		cardForeground: LIGHT_FG,
		popover: "#ffffff",
		popoverForeground: LIGHT_FG,
		primary: PRIMARY_LIGHT,
		primaryForeground: PRIMARY_FG_LIGHT,
		secondary: LIGHT_SECONDARY,
		secondaryForeground: LIGHT_FG,
		muted: LIGHT_MUTED,
		mutedForeground: LIGHT_MUTED_FG,
		accent: LIGHT_ACCENT,
		accentForeground: LIGHT_FG,
		destructive: "#c0453f",
		destructiveForeground: "#ffffff",
		border: LIGHT_BORDER,
		input: LIGHT_INPUT,
		inputBarBg: "#ffffff",
		ring: PRIMARY_LIGHT,
		chart1: "#2f8a74",
		chart2: "#17604f",
		chart3: "#6fc3ab",
		chart4: "#4a90c0",
		chart5: "#9fb3ad",
	},
};
