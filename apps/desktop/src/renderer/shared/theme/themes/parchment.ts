import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「羊皮纸」主题：陶土橙主色 + 暖纸表面。
//
// 浅色画布是米纸色，卡面更亮、muted/secondary 更深，四层都是暖色相；
// 深色画布压成暖棕黑，卡面与浮层依次提亮。
// 主色比原色板压暗一档（#b04a2c）：它要当实心按钮底色，浅橙上压白字读不清。
// 深色表面往赭红偏：与蜜蜂（蜜金）刻意分色相，且与森林、薄荷的冷调完全不重叠。
//
// 亮度被测试钉成不变量（palette.test.ts）：深色画布亮度必须落在 0.0075–0.02，
// 深色相邻表面 RGB 距离 ≥8；浅色四层表面彼此 ≥12。
// 深色原先压到过 0.0049——黑到没有光感，侧栏、卡面、画布糊成一片，看不出层次；
// 浅色原先只靠“卡面比画布亮一点点”做层次，四层都落在同一档米白里，读上去像一块布。
// 所以深色抬亮画布（现 0.0083），浅色改成向下逐级压暗拉开层差。

const PRIMARY_LIGHT = "#b04a2c";
const PRIMARY_DARK = "#e08a68";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#1e0f08";

const LIGHT_BG = "#f2e8d8";
const LIGHT_FG = "#241a13";
const LIGHT_CARD = "#fdf8ef";
const LIGHT_MUTED = "#ead9c4";
const LIGHT_SECONDARY = "#e2cfb6";
const LIGHT_ACCENT = "#f0e5d6";
const LIGHT_BORDER = "#d3bfa4";
const LIGHT_INPUT = "#dfcbb1";
const LIGHT_MUTED_FG = "#5f4d3f";

const DARK_BG = "#1f1411";
const DARK_FG = "#f2eae0";
const DARK_CARD = "#2f2015";
const DARK_POPOVER = "#37251b";
const DARK_MUTED = "#271a12";
const DARK_SECONDARY = "#3a291c";
const DARK_ACCENT = "#402e21";
const DARK_BORDER = "#503726";
const DARK_INPUT = "#5b412f";
const DARK_MUTED_FG = "#ab9c8e";

export const parchmentTheme: ThemeDef = {
	id: "parchment",
	label: "Parchment",
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
		chart1: "#e08a68",
		chart2: "#c96442",
		chart3: "#8a6a52",
		chart4: "#e0c65c",
		chart5: "#a89a8d",
	},
	light: {
		...defaultTheme.light,
		background: LIGHT_BG,
		foreground: LIGHT_FG,
		card: LIGHT_CARD,
		cardForeground: LIGHT_FG,
		popover: "#fffdf9",
		popoverForeground: LIGHT_FG,
		primary: PRIMARY_LIGHT,
		primaryForeground: PRIMARY_FG_LIGHT,
		secondary: LIGHT_SECONDARY,
		secondaryForeground: LIGHT_FG,
		muted: LIGHT_MUTED,
		mutedForeground: LIGHT_MUTED_FG,
		accent: LIGHT_ACCENT,
		accentForeground: LIGHT_FG,
		destructive: "#b03a2e",
		destructiveForeground: "#ffffff",
		border: LIGHT_BORDER,
		input: LIGHT_INPUT,
		inputBarBg: "#fffdf9",
		ring: PRIMARY_LIGHT,
		chart1: "#b04a2c",
		chart2: "#d98b62",
		chart3: "#7a5c3e",
		chart4: "#c9a227",
		chart5: "#9c8a78",
	},
};
