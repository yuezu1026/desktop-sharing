import React from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { SESSION_HF, sessionDeviceLabel, shouldShowQuotaDigits } from "../session/session-hf.mjs";
import { hit, linkToneColor, radius, space } from "../theme.mjs";
import { HitButton } from "./HitButton.js";
import { SessionStage } from "./SessionStage.js";

/**
 * 手持会话屏，对齐 W6-02：顶栏链路 / 画面 / 模式条 / 手势说明 / 底栏。
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

  const showQuota = shouldShowQuotaDigits(chrome.quotaNumber);
  const tag = (label, selected, onPress) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={{
        minHeight: hit.touchMinPx,
        paddingHorizontal: space["2"],
        justifyContent: "center",
        borderRadius: radius.s,
        borderWidth: 1,
        borderColor: selected ? palette.brand : palette.line,
        backgroundColor: selected ? palette.brandSoft : palette.surface,
      }}
    >
      <Text style={{ color: selected ? palette.brandHover : palette.text2, fontSize: 12, fontWeight: selected ? "700" : "500" }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space["2"],
          paddingHorizontal: space["3"],
          paddingVertical: space["2"],
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
          backgroundColor: palette.surface,
        }}
      >
        <View
          style={{
            paddingHorizontal: space["2"],
            paddingVertical: 4,
            borderRadius: radius.s,
            backgroundColor: chrome.linkLabel === "直连" ? palette.okSoft : palette.warnSoft,
            borderWidth: 1,
            borderColor: chrome.linkLabel === "直连" ? palette.ok : palette.warn,
          }}
        >
          <Text style={{ color: linkToneColor(chrome.linkLabel, palette), fontWeight: "700", fontSize: 12 }}>
            {chrome.linkLabel}
          </Text>
        </View>
        <Text style={{ color: palette.text2, fontSize: 13, flex: 1 }} numberOfLines={1}>
          {sessionDeviceLabel(chrome.deviceName)}
        </Text>
        <Pressable onPress={onOpenMeter} hitSlop={8}>
          <Text style={{ color: palette.text, fontSize: 13, textDecorationLine: "underline" }}>
            {SESSION_HF.meterLink}
          </Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space["2"], gap: space["2"], paddingBottom: space["4"] }}>
        {showQuota ? (
          <View
            style={{
              padding: space["3"],
              borderRadius: radius.m,
              borderWidth: 1,
              borderColor: palette.line,
              backgroundColor: palette.surface,
              gap: space["1"],
            }}
          >
            <Text style={{ color: palette.text2 }}>
              {SESSION_HF.quotaPrefix + chrome.quotaNumber + SESSION_HF.quotaSuffix}
            </Text>
            {chrome.quotaFootnote ? <Text style={{ color: palette.text3 }}>{chrome.quotaFootnote}</Text> : null}
          </View>
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

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space["2"] }}>
          {tag(SESSION_HF.trackpad, chrome.pointerMode === "trackpad", () => onSetPointerMode("trackpad"))}
          {tag(SESSION_HF.directTouch, chrome.pointerMode === "direct", () => onSetPointerMode("direct"))}
          <View style={{ flexGrow: 1, minWidth: 8 }} />
          {tag(SESSION_HF.focusFollow, chrome.focusFollow, onToggleFocusFollow)}
          {tag(SESSION_HF.magnifier, chrome.magnifier, onToggleMagnifier)}
        </View>

        <View
          style={{
            padding: space["3"],
            borderRadius: radius.m,
            borderWidth: 1,
            borderColor: palette.line,
            backgroundColor: palette.surface,
            gap: space["1"],
          }}
        >
          <Text style={{ color: palette.text, fontWeight: "700", fontSize: 12 }}>{SESSION_HF.gestureTitle}</Text>
          <Text style={{ color: palette.text2, fontSize: 12 }}>{gestureHint}</Text>
        </View>

        {chrome.viewOnly?.requestControl ? (
          <HitButton
            palette={palette}
            label={chrome.viewOnly.controlAsked ? "等待对方确认" : "请求控制"}
            onPress={onAskControl}
          />
        ) : null}
        {chrome.viewOnly?.frozen ? (
          <HitButton palette={palette} label="还有什么办法" onPress={onOpenWays} />
        ) : null}

        {session.keyboardOpen ? (
          <TextInput
            autoFocus
            value=""
            onChangeText={onKeyboardChar}
            onKeyPress={(event) => onKeyboardKeyName(event.nativeEvent.key)}
            placeholder="输入会发到对方电脑"
            placeholderTextColor={palette.text3}
            style={{
              minHeight: hit.touchMinPx,
              borderWidth: 1,
              borderColor: palette.line,
              borderRadius: radius.m,
              paddingHorizontal: space["2"],
              color: palette.text,
              backgroundColor: palette.surface,
            }}
          />
        ) : null}

        {chrome.ways.map((title) => (
          <Text key={title} style={{ color: palette.text }}>
            {title}
          </Text>
        ))}
        {chrome.notice ? <Text style={{ color: palette.err }}>{chrome.notice}</Text> : null}

        {chrome.immersive ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space["2"] }}>
            <HitButton palette={palette} label="下缘上滑" onPress={() => onSummonEdge("bottom")} />
            <HitButton palette={palette} label="横屏" onPress={onRotate} />
            <HitButton palette={palette} label={SESSION_HF.back} onPress={() => onLeaveImmersive("back")} />
          </View>
        ) : null}
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space["2"],
          paddingHorizontal: space["3"],
          paddingVertical: space["2"],
          borderTopWidth: 1,
          borderTopColor: palette.line,
          backgroundColor: palette.surface,
        }}
      >
        <HitButton palette={palette} label={SESSION_HF.keyboard} onPress={onToggleKeyboard} />
        <HitButton palette={palette} label={SESSION_HF.shortcuts} onPress={onOpenWays} />
        <View style={{ flex: 1 }} />
        {!chrome.immersive ? (
          <HitButton palette={palette} label={SESSION_HF.fullscreen} onPress={onEnterImmersive} />
        ) : (
          <HitButton palette={palette} label={SESSION_HF.exitImmersive} onPress={() => onLeaveImmersive("bar")} />
        )}
        <HitButton palette={palette} label={SESSION_HF.disconnect} onPress={onDisconnect} />
      </View>
    </SafeAreaView>
  );
}
