import React from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { DEVICES_HF, deviceSubtitle } from "../devices/devices-hf.mjs";
import { hit, radius, space } from "../theme.mjs";
import { HitButton } from "./HitButton.js";

/**
 * 移动端设备列表，对齐 W6-01：顶栏配额 / 搜索 / 卡片 / 底栏。
 * @param {{
 *   palette: Record<string, string>,
 *   quotaText: string,
 *   notice: string,
 *   searchQuery: string,
 *   onSearchChange: (text: string) => void,
 *   rows: Array<{
 *     hostDeviceId: string,
 *     displayName: string,
 *     platform?: string,
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
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space["4"],
          paddingVertical: space["3"],
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
          backgroundColor: palette.surface,
          gap: space["2"],
        }}
      >
        <Text style={{ color: palette.text, fontSize: 18, fontWeight: "700" }}>{DEVICES_HF.title}</Text>
        {props.quotaText ? (
          <View
            style={{
              paddingHorizontal: space["2"],
              paddingVertical: 2,
              borderRadius: radius.s,
              backgroundColor: palette.surface2,
              borderWidth: 1,
              borderColor: palette.line,
            }}
          >
            <Text style={{ color: palette.text2, fontSize: 12 }}>{props.quotaText}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: space["3"], paddingTop: space["3"] }}>
        <TextInput
          value={props.searchQuery}
          onChangeText={props.onSearchChange}
          placeholder={DEVICES_HF.searchPlaceholder}
          placeholderTextColor={palette.text3}
          style={{
            minHeight: 40,
            borderWidth: 1,
            borderColor: palette.line,
            borderRadius: radius.m,
            paddingHorizontal: space["3"],
            color: palette.text,
            backgroundColor: palette.surface,
            fontSize: 14,
          }}
        />
      </View>

      {props.notice ? (
        <Text style={{ color: palette.err, paddingHorizontal: space["3"], paddingTop: space["2"] }}>
          {props.notice}
        </Text>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space["3"], gap: space["2"], paddingBottom: space["4"] }}
      >
        {props.rows.map((row) => {
          const neverConnected = row.statusText === "从未连接";
          const online = row.statusText === "在线";
          const subtitle = deviceSubtitle(row);
          return (
            <View
              key={row.hostDeviceId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space["2"],
                padding: space["3"],
                borderRadius: radius.m,
                borderWidth: 1,
                borderColor: palette.line,
                borderStyle: neverConnected ? "dashed" : "solid",
                backgroundColor: online ? palette.okSoft : palette.surface,
              }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: online ? palette.ok : neverConnected ? palette.text3 : palette.line2,
                }}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: palette.text, fontWeight: "700" }}>{row.displayName}</Text>
                <Text style={{ color: palette.text2, fontSize: 12 }}>{subtitle}</Text>
              </View>
              {row.connectable ? (
                <HitButton
                  palette={palette}
                  label={DEVICES_HF.connect}
                  solid={online}
                  tone="ok"
                  onPress={() => props.onConnect(row)}
                />
              ) : (
                <View
                  style={{
                    minHeight: hit.touchMinPx,
                    justifyContent: "center",
                    paddingHorizontal: space["2"],
                    borderRadius: radius.s,
                    backgroundColor: palette.surface2,
                    borderWidth: 1,
                    borderColor: palette.line,
                  }}
                >
                  <Text style={{ color: palette.text2, fontSize: 12 }}>{DEVICES_HF.bindOnly}</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space["4"],
          paddingVertical: space["3"],
          borderTopWidth: 1,
          borderTopColor: palette.line,
          backgroundColor: palette.surface,
          gap: space["4"],
        }}
      >
        <Text style={{ color: palette.text, fontSize: 13, fontWeight: "700" }}>{DEVICES_HF.tabDevices}</Text>
        <Text style={{ color: palette.text3, fontSize: 13 }}>{DEVICES_HF.tabRecent}</Text>
        <View style={{ flex: 1 }} />
        <Pressable disabled>
          <Text style={{ color: palette.text3, fontSize: 13 }}>{DEVICES_HF.tabSettings}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
