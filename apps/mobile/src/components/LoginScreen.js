import React from "react";
import { SafeAreaView, Text, TextInput } from "react-native";
import { HitButton } from "./HitButton.js";
import { hit, space } from "../theme.mjs";

/**
 * @param {{
 *   palette: Record<string, string>,
 *   origin: string,
 *   phone: string,
 *   password: string,
 *   loginError: string,
 *   onPhoneChange: (value: string) => void,
 *   onPasswordChange: (value: string) => void,
 *   onSubmit: () => void,
 * }} props
 */
export function LoginScreen(props) {
  const { palette } = props;
  const field = {
    minHeight: hit.touchMinPx,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: space["3"],
    color: palette.text,
    backgroundColor: palette.surface,
  };
  return (
    <SafeAreaView style={{ flex: 1, padding: space["4"], gap: space["3"], backgroundColor: palette.bg }}>
      <Text style={{ color: palette.text }}>登录</Text>
      <Text style={{ color: palette.text2 }}>{"控制面 " + (props.origin || "未配置")}</Text>
      <TextInput
        value={props.phone}
        onChangeText={props.onPhoneChange}
        placeholder="手机号"
        placeholderTextColor={palette.text3}
        style={field}
      />
      <TextInput
        value={props.password}
        onChangeText={props.onPasswordChange}
        placeholder="密码"
        placeholderTextColor={palette.text3}
        secureTextEntry
        style={field}
      />
      <HitButton palette={palette} label="登录" solid tone="brand" onPress={props.onSubmit} />
      {props.loginError ? <Text style={{ color: palette.err }}>{props.loginError}</Text> : null}
    </SafeAreaView>
  );
}
