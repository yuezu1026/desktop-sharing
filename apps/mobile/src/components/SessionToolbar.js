import React from "react";
import { TextInput, View } from "react-native";
import { HitButton } from "./HitButton.js";
import { hit, space } from "../theme.mjs";

/** 会话底栏：指针模式、键盘、额度与沉浸式等。 */
export function SessionToolbar(props) {
  const {
    palette,
    chrome,
    keyboardOpen,
    onSetPointerMode,
    onToggleFocusFollow,
    onToggleMagnifier,
    onToggleKeyboard,
    onKeyboardChar,
    onKeyboardKeyName,
    onOpenMeter,
    onAskControl,
    onOpenWays,
    onEnterImmersive,
    onLeaveImmersive,
    onSummonEdge,
    onRotate,
  } = props;

  return (
    <View style={{ flexDirection: "row", gap: space["2"], flexWrap: "wrap" }}>
      <HitButton
        palette={palette}
        label="触控板模式"
        soft={chrome.pointerMode === "trackpad"}
        onPress={() => onSetPointerMode("trackpad")}
      />
      <HitButton
        palette={palette}
        label="直接触摸"
        soft={chrome.pointerMode === "direct"}
        onPress={() => onSetPointerMode("direct")}
      />
      <HitButton palette={palette} label="焦点跟随" soft={chrome.focusFollow} onPress={onToggleFocusFollow} />
      <HitButton palette={palette} label="放大镜" soft={chrome.magnifier} onPress={onToggleMagnifier} />
      <HitButton palette={palette} label="键盘" onPress={onToggleKeyboard} />
      {keyboardOpen ? (
        <TextInput
          autoFocus
          value=""
          onChangeText={onKeyboardChar}
          onKeyPress={(event) => onKeyboardKeyName(event.nativeEvent.key)}
          placeholder="输入会发到对方电脑"
          placeholderTextColor={palette.text3}
          style={{
            minHeight: hit.touchMinPx,
            minWidth: 180,
            borderWidth: 1,
            borderColor: palette.line,
            paddingHorizontal: space["2"],
            color: palette.text,
          }}
        />
      ) : null}
      <HitButton palette={palette} label="免费中继时长" onPress={onOpenMeter} />
      {chrome.viewOnly?.requestControl ? (
        <HitButton
          palette={palette}
          label={chrome.viewOnly.controlAsked ? "等待对方确认" : "请求控制"}
          onPress={onAskControl}
        />
      ) : null}
      {chrome.viewOnly?.frozen ? <HitButton palette={palette} label="还有什么办法" onPress={onOpenWays} /> : null}
      {!chrome.immersive ? <HitButton palette={palette} label="全屏" onPress={onEnterImmersive} /> : null}
      {chrome.immersive ? (
        <HitButton palette={palette} label="退出沉浸式" onPress={() => onLeaveImmersive("bar")} />
      ) : null}
      {chrome.immersive ? <HitButton palette={palette} label="返回" onPress={() => onLeaveImmersive("back")} /> : null}
      <HitButton palette={palette} label="下缘上滑" onPress={() => onSummonEdge("bottom")} />
      <HitButton palette={palette} label="横屏" onPress={onRotate} />
    </View>
  );
}
