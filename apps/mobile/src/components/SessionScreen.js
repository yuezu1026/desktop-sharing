import React, { useEffect } from "react";
import { BackHandler, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, Text, TextInput, View } from "react-native";
import {
  IMMERSIVE_HF,
  SESSION_HF,
  VIEW_ONLY_HF,
  sessionDeviceLabel,
  shouldShowQuotaDigits,
  viewOnlyBanner,
} from "../session/session-hf.mjs";
import { hit, linkToneColor, radius, space } from "../theme.mjs";
import { HitButton } from "./HitButton.js";
import { SessionStage } from "./SessionStage.js";

/** Android 手势条会裁切底栏；无 safe-area 依赖时用固定垫高保住 44px 触控。 */
const bottomBarPad = Platform.OS === "android" ? space["5"] : space["2"];

/**
 * 手持会话屏，对齐 W6-02 / W6-03 / W6-09。
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
    onZoom,
  } = props;

  const showQuota = shouldShowQuotaDigits(chrome.quotaNumber);
  const viewOnly = chrome.viewOnly;
  const banner = viewOnlyBanner(viewOnly);

  useEffect(() => {
    if (!chrome.immersive) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onLeaveImmersive("back");
      return true;
    });
    return () => subscription.remove();
  }, [chrome.immersive, onLeaveImmersive]);

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

  const linkBadge = (
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
  );

  if (chrome.immersive) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <StatusBar hidden translucent backgroundColor="transparent" />
        <View style={{ flex: 1 }} {...panHandlers}>
          <SessionStage
            palette={palette}
            chrome={chrome}
            picture={picture}
            panHandlers={{}}
            RemoteFrameView={RemoteFrameView}
            fill
          />
          {/* 下缘热区：上滑唤出条 */}
          <Pressable
            onPress={() => onSummonEdge("bottom")}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 28 }}
          />
          {/* 右缘热区 */}
          <Pressable
            onPress={() => onSummonEdge("right")}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 28 }}
          />
        </View>

        {chrome.summoned ? (
          <View
            style={{
              position: "absolute",
              left: space["2"],
              right: space["2"],
              bottom: space["2"],
              flexDirection: "row",
              alignItems: "center",
              gap: space["2"],
              padding: space["2"],
              borderRadius: radius.m,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.line,
            }}
          >
            <HitButton
              palette={palette}
              label={IMMERSIVE_HF.exitBar}
              onPress={() => onLeaveImmersive("bar")}
            />
            <HitButton palette={palette} label={IMMERSIVE_HF.keyboard} onPress={onToggleKeyboard} />
            <HitButton
              palette={palette}
              label={IMMERSIVE_HF.pointer}
              onPress={() =>
                onSetPointerMode(chrome.pointerMode === "trackpad" ? "direct" : "trackpad")
              }
            />
            <View style={{ flex: 1 }} />
            <HitButton palette={palette} label={IMMERSIVE_HF.disconnect} onPress={onDisconnect} />
          </View>
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
              position: "absolute",
              left: space["2"],
              right: space["2"],
              bottom: chrome.summoned ? 72 : space["2"],
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
      </View>
    );
  }

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
        {viewOnly ? (
          <>
            <View
              style={{
                paddingHorizontal: space["2"],
                paddingVertical: 4,
                borderRadius: radius.s,
                backgroundColor: palette.surface2,
                borderWidth: 1,
                borderColor: palette.line,
              }}
            >
              <Text style={{ color: palette.text, fontWeight: "700", fontSize: 12 }}>{VIEW_ONLY_HF.badge}</Text>
            </View>
            <Text style={{ color: palette.text2, fontSize: 13, flex: 1 }} numberOfLines={1}>
              {sessionDeviceLabel(chrome.deviceName)}
            </Text>
            {linkBadge}
          </>
        ) : (
          <>
            {linkBadge}
            <Text style={{ color: palette.text2, fontSize: 13, flex: 1 }} numberOfLines={1}>
              {sessionDeviceLabel(chrome.deviceName)}
            </Text>
            <Pressable onPress={onOpenMeter} hitSlop={8}>
              <Text style={{ color: palette.text, fontSize: 13, textDecorationLine: "underline" }}>
                {SESSION_HF.meterLink}
              </Text>
            </Pressable>
          </>
        )}
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

        {banner ? (
          <View
            style={{
              padding: space["3"],
              borderRadius: radius.m,
              borderWidth: 1,
              borderColor: palette.line,
              backgroundColor: palette.surface2,
              gap: space["1"],
            }}
          >
            <Text style={{ color: palette.text, fontWeight: "700", fontSize: 13 }}>{banner.title}</Text>
            <Text style={{ color: palette.text2, fontSize: 12 }}>{banner.body}</Text>
          </View>
        ) : (
          <>
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
          </>
        )}

        {session.keyboardOpen && !viewOnly ? (
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
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space["2"],
          paddingHorizontal: space["3"],
          paddingTop: space["2"],
          paddingBottom: bottomBarPad,
          borderTopWidth: 1,
          borderTopColor: palette.line,
          backgroundColor: palette.surface,
        }}
      >
        {viewOnly ? (
          <>
            <HitButton palette={palette} label={SESSION_HF.zoom} onPress={onZoom} />
            <HitButton palette={palette} label={SESSION_HF.rotate} onPress={onRotate} />
            <View style={{ flex: 1 }} />
            {viewOnly.requestControl ? (
              <HitButton
                palette={palette}
                label={viewOnly.controlAsked ? VIEW_ONLY_HF.waitingControl : VIEW_ONLY_HF.askControl}
                solid={!viewOnly.controlAsked}
                tone="brand"
                onPress={onAskControl}
              />
            ) : null}
            {viewOnly.frozen ? (
              <HitButton palette={palette} label={VIEW_ONLY_HF.openWays} onPress={onOpenWays} />
            ) : null}
            <HitButton palette={palette} label={SESSION_HF.disconnect} onPress={onDisconnect} />
          </>
        ) : (
          <>
            <HitButton palette={palette} label={SESSION_HF.keyboard} onPress={onToggleKeyboard} />
            <HitButton palette={palette} label={SESSION_HF.shortcuts} onPress={onOpenWays} />
            <View style={{ flex: 1 }} />
            <HitButton palette={palette} label={SESSION_HF.fullscreen} onPress={onEnterImmersive} />
            <HitButton palette={palette} label={SESSION_HF.disconnect} onPress={onDisconnect} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
