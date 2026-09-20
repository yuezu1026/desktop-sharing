import React from "react";
import { Pressable, Text } from "react-native";
import { hit, modeSelectedStyle, resolveColors, solidFill } from "../theme.mjs";

const hitStyle = {
  minHeight: hit.touchMinPx,
  minWidth: hit.touchMinPx,
  justifyContent: "center",
  paddingHorizontal: 12,
};

/**
 * 触控主按钮。solid+tone 走语义色；soft 为模式选中软底。
 * @param {{
 *   label: string,
 *   onPress?: () => void,
 *   solid?: boolean,
 *   soft?: boolean,
 *   tone?: "brand"|"ok"|"warn",
 *   palette?: ReturnType<typeof resolveColors>,
 * }} props
 */
export function HitButton(props) {
  const palette = props.palette || resolveColors("light");
  const solid = Boolean(props.solid);
  const soft = Boolean(props.soft);
  const fill = solid ? solidFill(props.tone, palette) : undefined;
  const softStyle = soft ? modeSelectedStyle(palette) : null;
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        hitStyle,
        solid ? { backgroundColor: fill } : softStyle || { borderWidth: 1, borderColor: palette.line },
      ]}
    >
      <Text style={{ color: solid ? palette.onSolid : soft ? palette.brandHover : palette.text }}>{props.label}</Text>
    </Pressable>
  );
}

