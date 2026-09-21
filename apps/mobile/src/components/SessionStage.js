import React from "react";
import { Image, Text, View } from "react-native";
import { loupeOverlayLayout } from "../session/loupe-overlay.mjs";
import { immersiveBadgeLabel, SESSION_HF, VIEW_ONLY_HF } from "../session/session-hf.mjs";
import { linkToneColor, radius, space } from "../theme.mjs";

/** 会话画面区：黑边 letterbox + 可选沉浸式链路角标 + 放大镜叠层。 */
export function SessionStage(props) {
  const { palette, chrome, picture, panHandlers, RemoteFrameView, fill, loupe } = props;
  let waitingText = SESSION_HF.picturePlaceholder;
  if (chrome.viewOnly && !chrome.viewOnly.frozen) {
    waitingText = VIEW_ONLY_HF.permissionPictureHint;
  } else if (chrome.waiting && chrome.waiting !== "等待画面") {
    waitingText = chrome.waiting;
  }

  const containerWidth = picture.viewWidth || picture.picture.left * 2 + picture.picture.width;
  const containerHeight = fill
    ? Math.max(picture.viewHeight || 1, picture.picture.top * 2 + picture.picture.height)
    : picture.viewHeight;
  const loupeLayout = loupeOverlayLayout({
    sample: loupe,
    pictureWidth: loupe?.pictureWidth || 0,
    pictureHeight: loupe?.pictureHeight || 0,
    pictureFrame: picture.picture,
    stageWidth: containerWidth,
    stageHeight: containerHeight || 1,
    zoom: 1,
  });

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

      {loupeLayout.visible ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left:
              picture.picture.left +
              (loupe.sampleLeft / loupe.pictureWidth) * picture.picture.width,
            top:
              picture.picture.top +
              (loupe.sampleTop / loupe.pictureHeight) * picture.picture.height,
            width: (loupe.sampleSide / loupe.pictureWidth) * picture.picture.width,
            height: (loupe.sampleSide / loupe.pictureHeight) * picture.picture.height,
            borderWidth: 1,
            borderColor: palette.brand,
          }}
        />
      ) : null}

      {loupeLayout.visible ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: loupeLayout.window.left,
            top: loupeLayout.window.top,
            width: loupeLayout.window.width,
            height: loupeLayout.window.height,
            borderRadius: radius.m,
            borderWidth: 2,
            borderColor: palette.brand,
            overflow: "hidden",
            backgroundColor: "#111",
          }}
        >
          {chrome.frameUri ? (
            <Image
              source={{ uri: chrome.frameUri }}
              style={{
                position: "absolute",
                width: loupeLayout.crop.imageWidth,
                height: loupeLayout.crop.imageHeight,
                left: loupeLayout.crop.imageLeft,
                top: loupeLayout.crop.imageTop,
              }}
              resizeMode="stretch"
            />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: palette.text2, fontSize: 12 }}>{SESSION_HF.magnifier}</Text>
            </View>
          )}
        </View>
      ) : null}

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
