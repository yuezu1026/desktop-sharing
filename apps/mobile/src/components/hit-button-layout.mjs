/**
 * 通栏判定：未显式传 block 时，实心主按钮默认通栏；描边行内按钮不拉满。
 * @param {{ solid?: boolean, block?: boolean }} props
 */
export function resolveHitButtonBlock(props) {
  if (props.block !== undefined) return Boolean(props.block);
  return Boolean(props.solid);
}
