import React from "react";
import { SafeAreaView, ScrollView, Text } from "react-native";
import { HitButton } from "./HitButton.js";
import { SessionStage } from "./SessionStage.js";
import { SessionToolbar } from "./SessionToolbar.js";
import { linkToneColor, space } from "../theme.mjs";

/**
 * 手持会话屏：链路、画面黑边、模式工具条。
 * 触控与键盘事件由上层注入，本组件不直接碰中继。
 */
export function SessionScreen(props) {
  const {
    palette,
    chrome,
    loupe,
    picture,
    panHandlers,
    RemoteFrameView,
    session,
    gestureHint,
    onDisconnect,
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
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView contentContainerStyle={{ padding: space["3"], gap: space["2"] }}>
        <Text style={{ color: linkToneColor(chrome.linkLabel, palette), fontWeight: "600" }}>{chrome.linkLabel}</Text>
        <HitButton palette={palette} label="断开" onPress={onDisconnect} />
        {chrome.quotaNumber !== null ? (
          <>
            <Text style={{ color: palette.text2 }}>{"免费中继时长剩余约 " + chrome.quotaNumber + " 分钟"}</Text>
            {chrome.quotaFootnote ? <Text style={{ color: palette.text3 }}>{chrome.quotaFootnote}</Text> : null}
          </>
        ) : null}
        {chrome.subscriptionBadge ? <Text style={{ color: palette.text2 }}>{chrome.subscriptionBadge}</Text> : null}
        {chrome.realNameMessage ? <Text style={{ color: palette.text2 }}>{chrome.realNameMessage}</Text> : null}
        <SessionStage
          palette={palette}
          chrome={chrome}
          picture={picture}
          panHandlers={panHandlers}
          RemoteFrameView={RemoteFrameView}
        />
        {loupe ? <Text style={{ color: palette.text2 }}>{"放大镜取样 " + loupe.sampleSide}</Text> : null}
        {chrome.viewOnly ? <Text style={{ color: palette.text }}>{chrome.viewOnly.line}</Text> : null}
        <Text style={{ color: palette.text2 }}>{gestureHint}</Text>
        <SessionToolbar
          palette={palette}
          chrome={chrome}
          keyboardOpen={session.keyboardOpen}
          onSetPointerMode={onSetPointerMode}
          onToggleFocusFollow={onToggleFocusFollow}
          onToggleMagnifier={onToggleMagnifier}
          onToggleKeyboard={onToggleKeyboard}
          onKeyboardChar={onKeyboardChar}
          onKeyboardKeyName={onKeyboardKeyName}
          onOpenMeter={onOpenMeter}
          onAskControl={onAskControl}
          onOpenWays={onOpenWays}
          onEnterImmersive={onEnterImmersive}
          onLeaveImmersive={onLeaveImmersive}
          onSummonEdge={onSummonEdge}
          onRotate={onRotate}
        />
        {chrome.ways.map((title) => (
          <Text key={title} style={{ color: palette.text }}>
            {title}
          </Text>
        ))}
        {chrome.notice ? <Text style={{ color: palette.err }}>{chrome.notice}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
