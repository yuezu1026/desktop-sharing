import React from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "./BrandMark.js";
import { HitButton } from "./HitButton.js";
import { AUTH_MODES, LOGIN_HF, authTitle } from "../auth/login-hf.mjs";
import { hit, radius, space } from "../theme.mjs";

/**
 * 手持登录 / 注册 / 找回，对齐高保真 h3「手机登录」。
 * 生物识别仅作快捷入口展示；密码与验证码路径必须保留。
 */
export function LoginScreen(props) {
  const {
    palette,
    mode,
    phone,
    password,
    smsCode,
    agreed,
    loginError,
    labHint,
    onPhoneChange,
    onPasswordChange,
    onSmsCodeChange,
    onToggleAgree,
    onSubmit,
    onFetchCode,
    onModeChange,
    onBioPress,
  } = props;

  const field = {
    minHeight: hit.touchMinPx,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.m,
    paddingHorizontal: space["3"],
    color: palette.text,
    backgroundColor: palette.surface,
  };

  const showPassword =
    mode === AUTH_MODES.password || mode === AUTH_MODES.register || mode === AUTH_MODES.forgot;
  const showSms = mode === AUTH_MODES.sms || mode === AUTH_MODES.register || mode === AUTH_MODES.forgot;
  const primaryLabel =
    mode === AUTH_MODES.register
      ? LOGIN_HF.register
      : mode === AUTH_MODES.forgot
        ? LOGIN_HF.resetPassword
        : LOGIN_HF.login;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView contentContainerStyle={{ padding: space["4"], gap: space["3"], paddingBottom: space["6"] }}>
        <View style={{ alignItems: "center", gap: space["2"], marginTop: space["4"], marginBottom: space["2"] }}>
          <BrandMark palette={palette} size={56} />
          <Text style={{ color: palette.text, fontSize: 20, fontWeight: "700" }}>{LOGIN_HF.brandTitle}</Text>
        </View>

        <Text style={{ color: palette.text, fontSize: 18, fontWeight: "600" }}>{authTitle(mode)}</Text>

        <Text style={{ color: palette.text2 }}>{LOGIN_HF.accountLabel}</Text>
        <TextInput
          value={phone}
          onChangeText={onPhoneChange}
          placeholder="请输入手机号或邮箱"
          placeholderTextColor={palette.text3}
          keyboardType="default"
          autoCapitalize="none"
          style={field}
        />

        {showSms ? (
          <>
            <Text style={{ color: palette.text2 }}>{LOGIN_HF.smsCodeLabel}</Text>
            <View style={{ flexDirection: "row", gap: space["2"], alignItems: "center" }}>
              <TextInput
                value={smsCode}
                onChangeText={onSmsCodeChange}
                placeholder={LOGIN_HF.smsCodePlaceholder}
                placeholderTextColor={palette.text3}
                keyboardType="number-pad"
                style={[field, { flex: 1 }]}
              />
              <HitButton palette={palette} label={LOGIN_HF.fetchCode} onPress={onFetchCode} />
            </View>
          </>
        ) : null}

        {showPassword ? (
          <>
            <Text style={{ color: palette.text2 }}>
              {mode === AUTH_MODES.register
                ? LOGIN_HF.setPassword
                : mode === AUTH_MODES.forgot
                  ? LOGIN_HF.newPassword
                  : LOGIN_HF.passwordLabel}
            </Text>
            <TextInput
              value={password}
              onChangeText={onPasswordChange}
              placeholder={mode === AUTH_MODES.register ? "至少 8 位" : "请输入密码"}
              placeholderTextColor={palette.text3}
              secureTextEntry
              style={field}
            />
          </>
        ) : null}

        {mode === AUTH_MODES.register ? (
          <>
            <Pressable
              onPress={onToggleAgree}
              style={{ flexDirection: "row", gap: space["2"], alignItems: "flex-start", minHeight: hit.touchMinPx }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  marginTop: 2,
                  borderWidth: 1,
                  borderColor: palette.line2,
                  borderRadius: radius.s,
                  backgroundColor: agreed ? palette.brand : palette.surface,
                }}
              />
              <Text style={{ color: palette.text2, flex: 1 }}>{LOGIN_HF.agree}</Text>
            </Pressable>
            <View
              style={{
                padding: space["3"],
                borderRadius: radius.m,
                backgroundColor: palette.brandSoft,
                borderWidth: 1,
                borderColor: palette.brandSoft2,
              }}
            >
              <Text style={{ color: palette.text2 }}>{LOGIN_HF.realNameNote}</Text>
            </View>
          </>
        ) : null}

        <HitButton palette={palette} label={primaryLabel} solid tone="brand" onPress={onSubmit} />

        {loginError ? <Text style={{ color: palette.err }}>{loginError}</Text> : null}

        {mode === AUTH_MODES.password || mode === AUTH_MODES.sms ? (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space["3"] }}>
              <Pressable
                onPress={() => onModeChange(mode === AUTH_MODES.sms ? AUTH_MODES.password : AUTH_MODES.sms)}
                style={{ minHeight: hit.touchMinPx, justifyContent: "center" }}
              >
                <Text style={{ color: palette.brand }}>
                  {mode === AUTH_MODES.sms ? LOGIN_HF.passwordLogin : LOGIN_HF.smsLogin}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onModeChange(AUTH_MODES.forgot)}
                style={{ minHeight: hit.touchMinPx, justifyContent: "center" }}
              >
                <Text style={{ color: palette.brand }}>{LOGIN_HF.forgot}</Text>
              </Pressable>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space["3"],
                padding: space["3"],
                borderRadius: radius.m,
                backgroundColor: palette.surface,
                borderWidth: 1,
                borderColor: palette.line,
                minHeight: hit.touchMinPx,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.m,
                  backgroundColor: palette.surface3,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.text, fontWeight: "600" }}>{LOGIN_HF.bioTitle}</Text>
                <Text style={{ color: palette.text3 }}>{LOGIN_HF.bioHint}</Text>
              </View>
              <HitButton palette={palette} label={LOGIN_HF.bioAction} onPress={onBioPress} />
            </View>

            <Pressable
              onPress={() => onModeChange(AUTH_MODES.register)}
              style={{ minHeight: hit.touchMinPx, justifyContent: "center", flexDirection: "row", flexWrap: "wrap" }}
            >
              <Text style={{ color: palette.text2 }}>{LOGIN_HF.noAccount}</Text>
              <Text style={{ color: palette.brand }}>{LOGIN_HF.register}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => onModeChange(AUTH_MODES.password)}
            style={{ minHeight: hit.touchMinPx, justifyContent: "center", flexDirection: "row", flexWrap: "wrap" }}
          >
            <Text style={{ color: palette.text2 }}>{LOGIN_HF.hasAccount}</Text>
            <Text style={{ color: palette.brand }}>{LOGIN_HF.goLogin}</Text>
          </Pressable>
        )}

        {labHint ? <Text style={{ color: palette.text3, fontSize: 12, marginTop: space["4"] }}>{labHint}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
