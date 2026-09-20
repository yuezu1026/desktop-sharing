import React, { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { DISCLOSURE_HF } from "../auth/disclosure-hf.mjs";
import { hit, radius, space } from "../theme.mjs";
import { HitButton } from "./HitButton.js";

/**
 * 首次连接隐私告知，对齐 W5-01。
 * @param {{
 *   palette: Record<string, string>,
 *   onAccept: (opts: { dontRemind: boolean }) => void,
 * }} props
 */
export function DisclosureScreen(props) {
  const { palette } = props;
  const [dontRemind, setDontRemind] = useState(false);

  const card = {
    padding: space["3"],
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    gap: space["2"],
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <View
        style={{
          paddingHorizontal: space["4"],
          paddingVertical: space["3"],
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
          backgroundColor: palette.surface,
        }}
      >
        <Text style={{ color: palette.text2, fontSize: 13 }}>{DISCLOSURE_HF.chromeTitle}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space["4"], gap: space["3"], paddingBottom: space["6"] }}>
        <Text style={{ color: palette.text, fontSize: 18, fontWeight: "700" }}>{DISCLOSURE_HF.headline}</Text>

        <View style={card}>
          <Text style={{ color: palette.text, fontWeight: "700" }}>{DISCLOSURE_HF.relayTitle}</Text>
          <Text style={{ color: palette.text2, lineHeight: 22 }}>{DISCLOSURE_HF.relayBody}</Text>
        </View>

        <View style={card}>
          <Text style={{ color: palette.text, fontWeight: "700" }}>{DISCLOSURE_HF.directTitle}</Text>
          <Text style={{ color: palette.text2, lineHeight: 22 }}>{DISCLOSURE_HF.directBody}</Text>
        </View>

        <HitButton
          palette={palette}
          label={DISCLOSURE_HF.accept}
          solid
          tone="brand"
          block
          onPress={() => props.onAccept({ dontRemind })}
        />
        <Text style={{ color: palette.text3, fontSize: 12 }}>{DISCLOSURE_HF.privacyHint}</Text>

        <Pressable
          onPress={() => setDontRemind((current) => !current)}
          style={{ flexDirection: "row", alignItems: "center", gap: space["2"], minHeight: hit.touchMinPx }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: palette.line2,
              backgroundColor: dontRemind ? palette.brand : palette.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {dontRemind ? <Text style={{ color: palette.onSolid, fontSize: 12, fontWeight: "700" }}>✓</Text> : null}
          </View>
          <Text style={{ color: palette.text2, flex: 1 }}>{DISCLOSURE_HF.dontRemind}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
