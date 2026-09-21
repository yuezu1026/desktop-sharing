import React from "react";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
import { radius, space } from "../theme.mjs";
import { HitButton } from "./HitButton.js";

/** 安卓被控端连接确认，对齐 W7-07；拒绝为唯一实心主按钮。 */
export function HostConsentScreen(props) {
  const { palette, chrome, onAllow, onAllowViewOnly, onRefuse } = props;
  if (chrome.closed) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView contentContainerStyle={{ padding: space["3"], gap: space["2"], paddingBottom: space["5"] }}>
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
          <Text style={{ color: palette.text, fontWeight: "700", fontSize: 16 }}>{chrome.title}</Text>
          <Text style={{ color: palette.text2, fontSize: 13, lineHeight: 20 }}>{chrome.subtitle}</Text>
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
          <Text style={{ color: palette.text3, fontSize: 12 }}>{chrome.whoLabel}</Text>
          <View
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: space["2"],
              paddingVertical: 4,
              borderRadius: radius.s,
              backgroundColor: palette.surface2,
              borderWidth: 1,
              borderColor: palette.line,
            }}
          >
            <Text style={{ color: palette.text2, fontSize: 12, fontWeight: "700" }}>{chrome.pill}</Text>
          </View>
          <Text style={{ color: palette.text, fontSize: 13 }}>{chrome.accountLine}</Text>
          <Text style={{ color: palette.text, fontSize: 13 }}>{chrome.deviceLine}</Text>
          {chrome.regionLine ? <Text style={{ color: palette.text2, fontSize: 13 }}>{chrome.regionLine}</Text> : null}
          {chrome.priorLine ? (
            <Text style={{ color: palette.text, fontSize: 13, fontWeight: "700", marginTop: 4 }}>{chrome.priorLine}</Text>
          ) : null}
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
          <Text style={{ color: palette.text3, fontSize: 12 }}>{chrome.canLabel}</Text>
          {chrome.canLines.map((line) => (
            <Text key={line} style={{ color: palette.text2, fontSize: 13, lineHeight: 20 }}>
              {line}
            </Text>
          ))}
        </View>

        <View
          style={{
            padding: space["3"],
            borderRadius: radius.m,
            borderWidth: 2,
            borderColor: palette.text,
            backgroundColor: palette.surface,
            gap: space["1"],
          }}
        >
          <Text style={{ color: palette.text, fontWeight: "700", fontSize: 13 }}>{chrome.fraudTitle}</Text>
          {chrome.fraudLines.map((line) => (
            <Text key={line} style={{ color: palette.text2, fontSize: 12, lineHeight: 18 }}>
              {line}
            </Text>
          ))}
        </View>

        <View style={{ gap: space["2"], marginTop: space["2"] }}>
          <HitButton palette={palette} label={chrome.allowLabel} onPress={onAllow} />
          <HitButton palette={palette} label={chrome.allowViewOnlyLabel} onPress={onAllowViewOnly} />
          <HitButton palette={palette} label={chrome.refuseLabel} solid tone="brand" onPress={onRefuse} />
          <Text style={{ color: palette.text3, fontSize: 12, lineHeight: 18 }}>{chrome.footnote}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
