import React from "react";
import { Pressable, Text } from "react-native";
import { hit, modeSelectedStyle, radius, resolveColors, solidFill } from "../theme.mjs";
import { resolveHitButtonBlock } from "./hit-button-layout.mjs";

/**
 * 触控主按钮。solid+tone 走语义色；soft 为模式选中软底。
 * 通栏主按钮默认 block（拉满父宽并居中文案）；行内按钮勿 stretch，避免中文竖排。
 * @param {{
 *   label: string,
 *   onPress?: () => void,
 *   solid?: boolean,
 *   soft?: boolean,
 *   block?: boolean,
 *   tone?: "brand"|"ok"|"warn",
 *   palette?: ReturnType<typeof resolveColors>,
 * }} props
 */
export function HitButton(props) {
  const palette = props.palette || resolveColors("light");
  const solid = Boolean(props.solid);
  const soft = Boolean(props.soft);
  const block = resolveHitButtonBlock(props);
  const fill = solid ? solidFill(props.tone, palette) : undefined;
  const softStyle = soft ? modeSelectedStyle(palette) : null;
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        {
          minHeight: hit.touchMinPx,
          minWidth: hit.touchMinPx,
          flexShrink: 0,
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 12,
          borderRadius: radius.m,
        },
        block ? { alignSelf: "stretch" } : null,
        solid ? { backgroundColor: fill } : softStyle || { borderWidth: 1, borderColor: palette.line },
      ]}
    >
      <Text
        numberOfLines={1}
        style={{
          textAlign: "center",
          color: solid ? palette.onSolid : soft ? palette.brandHover : palette.text,
          fontWeight: "600",
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
