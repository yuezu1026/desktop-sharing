import React from "react";
import { SafeAreaView, Text } from "react-native";
import { HitButton } from "./HitButton.js";
import { space } from "../theme.mjs";

/**
 * @param {{
 *   palette: Record<string, string>,
 *   title: string,
 *   relay: string,
 *   direct: string,
 *   onAccept: () => void,
 * }} props
 */
export function DisclosureScreen(props) {
  const { palette } = props;
  return (
    <SafeAreaView style={{ flex: 1, padding: space["4"], gap: space["3"], backgroundColor: palette.bg }}>
      <Text style={{ color: palette.text }}>{props.title}</Text>
      <Text style={{ color: palette.text2 }}>{props.relay}</Text>
      <Text style={{ color: palette.text2 }}>{props.direct}</Text>
      <HitButton palette={palette} label="知道了" solid tone="brand" onPress={props.onAccept} />
    </SafeAreaView>
  );
}
