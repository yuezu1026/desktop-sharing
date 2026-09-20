import React from "react";
import { Image, Text, View } from "react-native";
import { SESSION_HF } from "../session/session-hf.mjs";
import { linkToneColor } from "../theme.mjs";

/** 会话画面区：黑边 letterbox + 可选沉浸式链路角标。 */
export function SessionStage(props) {
  const { palette, chrome, picture, panHandlers, RemoteFrameView } = props;
  const waitingText =
    chrome.waiting && chrome.waiting !== "等待画面" ? chrome.waiting : SESSION_HF.picturePlaceholder;
  return (
    <View style={{ height: picture.viewHeight, backgroundColor: "#000", overflow: "hidden" }} {...panHandlers}>
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
        <Text style={{ position: "absolute", top: 8, right: 8, color: linkToneColor(chrome.linkLabel, palette) }}>
          {"● " + chrome.linkLabel}
        </Text>
      ) : null}
    </View>
  );
}
