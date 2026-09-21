/**
 * 手持放大镜叠层几何：取样矩形 → 舞台上的 loupe 窗与裁剪偏移。
 */

/**
 * @param {{
 *   sample: null | undefined | { sampleLeft: number, sampleTop: number, sampleSide: number },
 *   pictureWidth: number,
 *   pictureHeight: number,
 *   pictureFrame: { left: number, top: number, width: number, height: number },
 *   stageWidth: number,
 *   stageHeight: number,
 *   zoom?: number,
 * }} input
 */
export function loupeOverlayLayout(input) {
  const sample = input.sample;
  if (
    !sample ||
    !(sample.sampleSide > 0) ||
    !(input.pictureWidth > 0) ||
    !(input.pictureHeight > 0) ||
    !(input.pictureFrame.width > 0) ||
    !(input.pictureFrame.height > 0) ||
    !(input.stageWidth > 0) ||
    !(input.stageHeight > 0)
  ) {
    return { visible: false };
  }

  const zoom = input.zoom > 0 ? input.zoom : 2;
  const margin = 8;
  const maxSide = Math.min(160, Math.floor(Math.min(input.stageWidth, input.stageHeight) * 0.36));
  const displaySide = Math.max(96, maxSide);

  const frameScaleX = input.pictureFrame.width / input.pictureWidth;
  const frameScaleY = input.pictureFrame.height / input.pictureHeight;
  const sampleOnStage = sample.sampleSide * frameScaleX;
  const enlarge = (displaySide / Math.max(1, sampleOnStage)) * zoom;
  const imageWidth = Math.max(1, Math.floor(input.pictureFrame.width * enlarge));
  const imageHeight = Math.max(1, Math.floor(input.pictureFrame.height * enlarge));
  const imageLeft = -Math.floor(sample.sampleLeft * frameScaleX * enlarge);
  const imageTop = -Math.floor(sample.sampleTop * frameScaleY * enlarge);

  // 默认右上角；若取样中心偏右则改左上，避免挡住操作点
  const sampleCenterX =
    input.pictureFrame.left + (sample.sampleLeft + sample.sampleSide / 2) * frameScaleX;
  const placeLeft = sampleCenterX > input.stageWidth * 0.55;
  const windowLeft = placeLeft
    ? margin
    : Math.max(margin, input.stageWidth - displaySide - margin);
  const windowTop = margin;

  return {
    visible: true,
    window: {
      left: windowLeft,
      top: windowTop,
      width: displaySide,
      height: displaySide,
    },
    crop: {
      imageWidth,
      imageHeight,
      imageLeft,
      imageTop,
    },
  };
}
