import React from "react";
import { Image, Text, View } from "react-native";
import { immersiveBadgeLabel, SESSION_HF, VIEW_ONLY_HF } from "../session/session-hf.mjs";
import { linkToneColor, radius, space } from "../theme.mjs";

/** 会话画面区：黑边 letterbox + 可选沉浸式链路角标。 */
export function SessionStage(props) {
  const { palette, chrome, picture, panHandlers, RemoteFrameView, fill } = props;
  let waitingText = SESSION_HF.picturePlaceholder;
  if (chrome.viewOnly && !chrome.viewOnly.frozen) {
    waitingText = VIEW_ONLY_HF.permissionPictureHint;
  } else if (chrome.waiting && chrome.waiting !== "等待画面") {
    waitingText = chrome.waiting;
  }
  return (
    <View
      style={{
        height: fill ? "100%" : picture.viewHeight,
        flex: fill ? 1 : undefined,
        backgroundColor: "#000",
        overflow: "hidden",
      }}
      {...panHandlers}
    >
      <View
        style={{
          position: "absolute",
          left: picture.picture.left,
          top: picture.picture.top,
          width: picture.picture.width,
          height: picture.picture.height,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.surface3,
        }}
      >
        {RemoteFrameView ? (
          <RemoteFrameView
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: picture.picture.width,
              height: picture.picture.height,
              opacity: chrome.surfaceVideo ? 1 : 0,
            }}
            pointerEvents="none"
          />
        ) : null}
        {!chrome.surfaceVideo && chrome.frameUri ? (
          <Image
            source={{ uri: chrome.frameUri }}
            style={{ width: picture.picture.width, height: picture.picture.height }}
            resizeMode="contain"
            pointerEvents="none"
          />
        ) : null}
        {!chrome.surfaceVideo && !chrome.frameUri ? (
          <Text style={{ color: palette.text2, textAlign: "center", paddingHorizontal: 12 }}>{waitingText}</Text>
        ) : null}
      </View>
      {chrome.immersive ? (
        <View
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: space["2"],
            paddingVertical: 4,
            borderRadius: radius.s,
            backgroundColor: "rgba(255,255,255,0.88)",
            borderWidth: 1,
            borderColor: palette.line,
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: linkToneColor(chrome.linkLabel, palette),
            }}
          />
          <Text style={{ color: palette.text, fontSize: 12, fontWeight: "600" }}>
            {immersiveBadgeLabel(chrome.linkLabel)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
