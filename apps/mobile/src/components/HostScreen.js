import React from "react";
import { NativeModules, Platform, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { HOST_HF } from "../host/host-hf.mjs";
import { hit, radius, space } from "../theme.mjs";
import { HitButton } from "./HitButton.js";

const bottomBarPad = Platform.OS === "android" ? space["5"] : space["3"];

/**
 * @param {string} text
 */
export function copyHostText(text) {
  const value = String(text || "");
  if (!value) return false;
  const clip = NativeModules.Clipboard || NativeModules.RNCClipboard;
  if (clip && typeof clip.setString === "function") {
    clip.setString(value);
    return true;
  }
  return false;
}

/**
 * 安卓被控端主界面，对齐 W7-02 / h6。
 */
export function HostScreen(props) {
  const { palette, chrome, onToggleAccept, onCopyCode, onRotatePassword, onOpenDevices } = props;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space["3"],
          paddingVertical: space["2"],
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
          backgroundColor: palette.surface,
          gap: space["2"],
        }}
      >
        <Text style={{ color: palette.text, fontWeight: "700", fontSize: 15, flex: 1 }}>{chrome.title}</Text>
        <HitButton palette={palette} label={chrome.acceptLabel} soft={!chrome.acceptOn} onPress={onToggleAccept} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space["3"], gap: space["2"], paddingBottom: space["4"] }}
      >
        <View
          style={{
            padding: space["3"],
            borderRadius: radius.m,
            borderWidth: 1,
            borderColor: palette.line,
            backgroundColor: palette.surface,
            gap: space["2"],
          }}
        >
          <Text style={{ color: palette.text3, fontSize: 12 }}>{chrome.deviceCodeLabel}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space["2"] }}>
            <Text style={{ color: palette.text, fontSize: 20, fontWeight: "700", letterSpacing: 2, flex: 1 }}>
              {chrome.deviceCodeDisplay || "— — —"}
            </Text>
            <HitButton palette={palette} label={chrome.copyLabel} onPress={onCopyCode} />
          </View>
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
          <Text style={{ color: palette.text3, fontSize: 12 }}>{chrome.tempPasswordLabel}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space["2"] }}>
            <Text style={{ color: palette.text, fontSize: 17, fontWeight: "700", letterSpacing: 2, flex: 1 }}>
              {chrome.tempPassword || "— —"}
            </Text>
            <HitButton palette={palette} label={chrome.rotatePasswordLabel} onPress={onRotatePassword} />
          </View>
          <Text style={{ color: palette.text3, fontSize: 12 }}>{chrome.tempPasswordHint}</Text>
        </View>

        <View
          style={{
            padding: space["3"],
            borderRadius: radius.m,
            borderWidth: 1,
            borderColor: palette.line,
            backgroundColor: palette.surface2,
          }}
        >
          <Text style={{ color: palette.text, fontWeight: "700", fontSize: 13 }}>{chrome.statusLabel}</Text>
          {chrome.statusHint ? (
            <Text style={{ color: palette.text3, fontSize: 12, marginTop: 4 }}>{chrome.statusHint}</Text>
          ) : null}
        </View>

        <View
          style={{
            padding: space["3"],
            borderRadius: radius.m,
            borderWidth: 1,
            borderColor: palette.line,
            backgroundColor: palette.surface,
            gap: space["2"],
          }}
        >
          <Text style={{ color: palette.text, fontWeight: "700", fontSize: 13 }}>{chrome.selfCheckTitle}</Text>
          {chrome.selfCheck.map((row) => (
            <View key={row.key} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", minHeight: hit.touchMinPx }}>
                <Text style={{ color: palette.text2, fontSize: 13, flex: 1 }}>{row.label}</Text>
                <View
                  style={{
                    paddingHorizontal: space["2"],
                    paddingVertical: 4,
                    borderRadius: radius.s,
                    backgroundColor: row.status === "ok" ? palette.okSoft : palette.surface2,
                    borderWidth: 1,
                    borderColor: row.status === "ok" ? palette.ok : palette.line,
                  }}
                >
                  <Text style={{ color: palette.text2, fontSize: 12, fontWeight: "600" }}>{row.statusLabel}</Text>
                </View>
              </View>
              {row.hint ? <Text style={{ color: palette.text3, fontSize: 12 }}>{row.hint}</Text> : null}
            </View>
          ))}
        </View>

        <View
          style={{
            padding: space["3"],
            borderRadius: radius.m,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: palette.line,
            backgroundColor: palette.surface,
            gap: space["1"],
          }}
        >
          <Text style={{ color: palette.text, fontWeight: "700", fontSize: 13 }}>{chrome.fraudTitle}</Text>
          <Text style={{ color: palette.text2, fontSize: 12, lineHeight: 18 }}>{chrome.fraudBody}</Text>
        </View>
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space["4"],
          paddingTop: space["3"],
          paddingBottom: bottomBarPad,
          borderTopWidth: 1,
          borderTopColor: palette.line,
          backgroundColor: palette.surface,
          gap: space["4"],
        }}
      >
        <Text style={{ color: palette.text, fontSize: 13, fontWeight: "700" }}>{HOST_HF.tabHost}</Text>
        <Pressable onPress={onOpenDevices} hitSlop={8}>
          <Text style={{ color: palette.text3, fontSize: 13 }}>{HOST_HF.tabPeers}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={{ color: palette.text3, fontSize: 13 }}>{HOST_HF.tabSettings}</Text>
      </View>
    </SafeAreaView>
  );
}
