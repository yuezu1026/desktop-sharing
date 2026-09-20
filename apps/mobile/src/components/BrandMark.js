import React from "react";
import { View } from "react-native";
import { radius } from "../theme.mjs";

/** 双视口品牌标（对齐高保真 h0 / 手机登录头）。 */
export function BrandMark(props) {
  const size = props.size || 56;
  const palette = props.palette;
  const scale = size / 64;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.l,
        backgroundColor: palette.brand,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 10 * scale,
          top: 13 * scale,
          width: 30 * scale,
          height: 23 * scale,
          borderRadius: 4.5 * scale,
          borderWidth: Math.max(1.5, 2.6 * scale),
          borderColor: "#EAF1FF",
          opacity: 0.92,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 23 * scale,
          top: 27 * scale,
          width: 31 * scale,
          height: 23 * scale,
          borderRadius: 4.5 * scale,
          backgroundColor: palette.onSolid,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 28 * scale,
          top: 43 * scale,
          width: 21 * scale,
          height: Math.max(2, 2.8 * scale),
          borderRadius: 1.4 * scale,
          backgroundColor: palette.brand,
          opacity: 0.85,
        }}
      />
    </View>
  );
}
