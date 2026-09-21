/**
 * 手持沉浸式系统栏与布局契约（W6-09 / D22）。
 * 沉浸态藏系统栏、按物理屏铺满；非沉浸态保留窗内边距与半屏画面区。
 */

/**
 * @param {unknown} immersive
 * @returns {boolean}
 */
export function shouldHideSystemBars(immersive) {
  return immersive === true;
}

/**
 * @param {{
 *   immersive?: boolean,
 *   windowWidth: number,
 *   windowHeight: number,
 *   screenWidth: number,
 *   screenHeight: number,
 * }} input
 */
export function sessionLayoutBox(input) {
  const immersive = input.immersive === true;
  if (immersive) {
    return {
      containerWidth: Math.max(1, Math.floor(input.screenWidth)),
      containerHeight: Math.max(1, Math.floor(input.screenHeight)),
      hideSystemBars: true,
    };
  }
  const windowWidth = Math.max(1, Math.floor(input.windowWidth));
  const windowHeight = Math.max(1, Math.floor(input.windowHeight));
  return {
    containerWidth: Math.max(280, windowWidth - 24),
    containerHeight: Math.round(windowHeight * 0.48),
    hideSystemBars: false,
  };
}
