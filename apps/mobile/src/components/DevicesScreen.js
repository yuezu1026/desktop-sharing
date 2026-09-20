import React from "react";
import { SafeAreaView, Text, View } from "react-native";
import { HitButton } from "./HitButton.js";
import { space } from "../theme.mjs";

/**
 * @param {{
 *   palette: Record<string, string>,
 *   quotaText: string,
 *   notice: string,
 *   rows: Array<{
 *     hostDeviceId: string,
 *     displayName: string,
 *     statusText: string,
 *     actionLabel: string,
 *     connectable: boolean,
 *   }>,
 *   onConnect: (row: object) => void,
 * }} props
 */
export function DevicesScreen(props) {
  const { palette } = props;
  return (
    <SafeAreaView style={{ flex: 1, padding: space["4"], gap: space["3"], backgroundColor: palette.bg }}>
      <Text style={{ color: palette.text }}>我的设备{props.quotaText ? "  " + props.quotaText : ""}</Text>
      {props.notice ? <Text style={{ color: palette.err }}>{props.notice}</Text> : null}
      {props.rows.map((row) => (
        <View key={row.hostDeviceId} style={{ flexDirection: "row", alignItems: "center", gap: space["2"] }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: palette.text }}>{row.displayName}</Text>
            <Text style={{ color: palette.text2 }}>{row.statusText}</Text>
          </View>
          <HitButton
            palette={palette}
            label={row.actionLabel}
            solid={row.connectable && row.statusText === "在线"}
            tone="ok"
            onPress={() => props.onConnect(row)}
          />
        </View>
      ))}
    </SafeAreaView>
  );
}
