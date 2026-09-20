/** 产品 UI 主题：色板来自 tokens.json 生成物；本文件只放语义助手。 */
import { dark, hit, light, radius, space } from "./theme.generated.mjs";

export { dark, hit, light, radius, space };

/** @deprecated 默认亮色快照；运行时请用 resolveColors */
export const colors = light;

/**
 * @param {"light"|"dark"|null|undefined} scheme
 */
export function resolveColors(scheme) {
  return scheme === "dark" ? dark : light;
}

/**
 * 实心按钮色：登录/注册 → brand；连接/直连 → ok；其它实心默认 brand。
 * @param {"brand"|"ok"|"warn"|undefined} tone
 * @param {typeof light} [palette]
 */
export function solidFill(tone, palette = light) {
  if (tone === "ok") return palette.ok;
  if (tone === "warn") return palette.warn;
  return palette.brand;
}

/**
 * 链路文案色：直连 → ok；中继 → warn；未知 → text2。
 * @param {string|undefined} label
 * @param {typeof light} [palette]
 */
export function linkToneColor(label, palette = light) {
  if (!label) return palette.text2;
  if (label.includes("直连")) return palette.ok;
  if (label.includes("中继")) return palette.warn;
  return palette.text2;
}

/**
 * 模式选中软底（触控板等），用 brand 软底，不抢直连绿。
 * @param {typeof light} [palette]
 */
export function modeSelectedStyle(palette = light) {
  return {
    backgroundColor: palette.brandSoft,
    borderWidth: 1,
    borderColor: palette.brand,
  };
}
