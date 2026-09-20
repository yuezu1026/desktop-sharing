import React, { useEffect, useState } from "react";
import { Image, Platform, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { resolveControlPlaneOrigin, resolveRelayAddress } from "./config.mjs";
import {
  acknowledgeDisclosure,
  getRemoteSession,
  listHostDevices,
  loadBalance,
  loadDisclosure,
  login,
  requestRemoteSession,
} from "./api.mjs";
import {
  connectSessionRelay,
  disconnectSessionRelay,
  subscribeSessionRelay,
} from "./native/session-relay.mjs";
import {
  MIN_HIT_PX,
  applyBalance,
  applyNativeRelayEvent,
  applyRemoteSessionState,
  askControl,
  connectDevice,
  createSession,
  deviceRows,
  disconnect,
  enterImmersive,
  gestureHint,
  layoutPicture,
  leaveImmersive,
  magnifierSample,
  openMeter,
  openWays,
  rotate,
  sessionChrome,
  setKeyboardOpen,
  setPointerMode,
  shouldAttachRelay,
  summonFromEdge,
  toggleFocusFollow,
  toggleMagnifier,
} from "./session/handheld.mjs";

const hit = { minHeight: MIN_HIT_PX, minWidth: MIN_HIT_PX, justifyContent: "center", paddingHorizontal: 12 };

function HitButton(props) {
  return (
    <Pressable onPress={props.onPress} style={[hit, props.solid ? { backgroundColor: "#1f6feb" } : { borderWidth: 1, borderColor: "#99a" }]}>
      <Text style={{ color: props.solid ? "#fff" : "#1a1a1a" }}>{props.label}</Text>
    </Pressable>
  );
}

function newFingerprint() {
  const alphabet = "abcdef0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

export function App() {
  const [session, setSession] = useState(createSession());
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [devices, setDevices] = useState({ devices: [], deviceQuota: null });
  const [disclosure, setDisclosure] = useState(null);
  const [fingerprint] = useState(newFingerprint);
  const origin = resolveControlPlaneOrigin({
    envOrigin: typeof process !== "undefined" && process.env ? process.env.CONTROL_PLANE_URL : "",
    platformOS: Platform.OS,
  });
  const relayAddress = resolveRelayAddress({
    envAddress: typeof process !== "undefined" && process.env ? process.env.RELAY_ADDR : "",
    platformOS: Platform.OS,
  });

  useEffect(() => {
    return subscribeSessionRelay((event) => {
      setSession((current) => applyNativeRelayEvent(current, event));
    });
  }, []);

  useEffect(() => {
    if (session.screen !== "session") {
      disconnectSessionRelay();
      return undefined;
    }
    if (!shouldAttachRelay(session)) return undefined;
    const started = connectSessionRelay(relayAddress, session.ticket, fingerprint);
    if (!started) {
      setSession((current) =>
        applyNativeRelayEvent(current, { type: "error", message: "本机构建未包含原生中继模块" }),
      );
    }
    return undefined;
  }, [session.screen, session.ticket, session.notice, session.relayAttached, relayAddress, fingerprint]);

  useEffect(() => {
    if (!token || !origin || session.screen !== "session") return undefined;
    const remoteSessionId = session.remoteSessionId;
    if (!remoteSessionId) return undefined;
    const timer = setInterval(() => {
      getRemoteSession(origin, token, remoteSessionId).then((result) => {
        if (!result.ok) return;
        setSession((current) => applyRemoteSessionState(current, { ...result.body, ticket: current.ticket }));
      });
    }, 800);
    return () => clearInterval(timer);
  }, [token, origin, session.screen, session.remoteSessionId]);

  useEffect(() => {
    if (!token || !origin || session.screen !== "session") return undefined;
    const timer = setInterval(() => {
      loadBalance(origin, token).then((result) => {
        if (result.ok) setSession((current) => applyBalance(current, result.body));
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [token, origin, session.screen]);

  async function submitLogin() {
    if (!origin) {
      setLoginError("服务地址未配置");
      return;
    }
    const result = await login(origin, phone, password);
    if (!result.ok || !result.body.token) {
      setLoginError(result.body.message || "登录失败");
      return;
    }
    setToken(result.body.token);
    setPassword("");
    const notice = await loadDisclosure(origin, result.body.token);
    if (notice.ok && notice.body.acknowledged !== true) {
      setDisclosure(notice.body);
      return;
    }
    const listed = await listHostDevices(origin, result.body.token);
    if (listed.ok) setDevices(listed.body);
  }

  async function acceptDisclosure() {
    const result = await acknowledgeDisclosure(origin, token);
    if (!result.ok) return;
    setDisclosure(null);
    const listed = await listHostDevices(origin, token);
    if (listed.ok) setDevices(listed.body);
  }

  async function onConnect(row) {
    const next = connectDevice(session, row);
    if (next === session) return;
    if (origin && token) {
      const requested = await requestRemoteSession(origin, token, row.hostDeviceId, fingerprint);
      if (requested.ok) {
        setSession(applyRemoteSessionState(next, requested.body));
        return;
      }
      setSession({ ...next, notice: requested.body.message || "未能发起会话" });
      return;
    }
    setSession(next);
  }

  if (!token) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
        <Text>登录</Text>
        <Text style={{ color: "#5c6570" }}>{"控制面 " + (origin || "未配置")}</Text>
        <TextInput value={phone} onChangeText={setPhone} placeholder="手机号" style={{ minHeight: MIN_HIT_PX, borderWidth: 1 }} />
        <TextInput value={password} onChangeText={setPassword} placeholder="密码" secureTextEntry style={{ minHeight: MIN_HIT_PX, borderWidth: 1 }} />
        <HitButton label="登录" solid onPress={submitLogin} />
        <Text>{loginError}</Text>
      </SafeAreaView>
    );
  }

  if (disclosure) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
        <Text>{disclosure.title}</Text>
        <Text>{disclosure.relay}</Text>
        <Text>{disclosure.direct}</Text>
        <HitButton label="知道了" solid onPress={acceptDisclosure} />
      </SafeAreaView>
    );
  }

  if (session.screen === "devices") {
    const list = deviceRows(devices);
    return (
      <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
        <Text>我的设备{list.quotaText ? "  " + list.quotaText : ""}</Text>
        {list.rows.map((row) => (
          <View key={row.hostDeviceId} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text>{row.displayName}</Text>
              <Text>{row.statusText}</Text>
            </View>
            <HitButton
              label={row.actionLabel}
              solid={row.connectable && row.statusText === "在线"}
              onPress={() => onConnect(row)}
            />
          </View>
        ))}
      </SafeAreaView>
    );
  }

  const chrome = sessionChrome(session);
  const picture = layoutPicture({
    containerWidth: 360,
    containerHeight: session.keyboardOpen ? 420 : 640,
    pictureWidth: session.pictureWidth,
    pictureHeight: session.pictureHeight,
    keyboardOpen: session.keyboardOpen,
    keyboardHeight: 280,
    focusFollow: session.focusFollow,
    focusRect: null,
  });
  const loupe = session.magnifier ? magnifierSample(session.pictureWidth, session.pictureHeight, 8, 4) : null;

  return (
    <SafeAreaView style={{ flex: 1, padding: 12, gap: 8 }}>
      <Text>{chrome.linkLabel}</Text>
      {chrome.quotaNumber !== null ? <Text>{"免费中继时长剩余约 " + chrome.quotaNumber + " 分钟"}</Text> : null}
      {chrome.subscriptionBadge ? <Text>{chrome.subscriptionBadge}</Text> : null}
      {chrome.realNameMessage ? <Text>{chrome.realNameMessage}</Text> : null}
      <View style={{ height: picture.viewHeight, backgroundColor: "#000", overflow: "hidden" }}>
        <View
          style={{
            position: "absolute",
            left: picture.picture.left,
            top: picture.picture.top,
            width: picture.picture.width,
            height: picture.picture.height,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#222",
          }}
        >
          {chrome.frameUri ? (
            <Image
              source={{ uri: chrome.frameUri }}
              style={{ width: picture.picture.width, height: picture.picture.height }}
              resizeMode="contain"
            />
          ) : (
            <Text style={{ color: "#ddd" }}>{chrome.waiting}</Text>
          )}
        </View>
        {chrome.immersive ? (
          <Text style={{ position: "absolute", top: 8, right: 8, color: "#fff" }}>{"● " + chrome.linkLabel}</Text>
        ) : null}
      </View>
      {loupe ? <Text>{"放大镜取样 " + loupe.sampleSide}</Text> : null}
      {chrome.viewOnly ? <Text>{chrome.viewOnly.line}</Text> : null}
      <Text>{gestureHint(chrome.pointerMode)}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <HitButton label="触控板模式" solid={chrome.pointerMode === "trackpad"} onPress={() => setSession(setPointerMode(session, "trackpad"))} />
        <HitButton label="直接触摸" solid={chrome.pointerMode === "direct"} onPress={() => setSession(setPointerMode(session, "direct"))} />
        <HitButton label="焦点跟随" solid={chrome.focusFollow} onPress={() => setSession(toggleFocusFollow(session))} />
        <HitButton label="放大镜" solid={chrome.magnifier} onPress={() => setSession(toggleMagnifier(session))} />
        <HitButton label="键盘" onPress={() => setSession(setKeyboardOpen(session, !session.keyboardOpen))} />
        <HitButton label="免费中继时长" onPress={() => setSession(openMeter(session))} />
        {chrome.viewOnly?.requestControl ? (
          <HitButton
            label={chrome.viewOnly.controlAsked ? "等待对方确认" : "请求控制"}
            onPress={() => setSession(askControl(session))}
          />
        ) : null}
        {chrome.viewOnly?.frozen ? <HitButton label="还有什么办法" onPress={() => setSession(openWays(session))} /> : null}
        {!chrome.immersive ? <HitButton label="全屏" onPress={() => setSession(enterImmersive(session))} /> : null}
        {chrome.immersive ? <HitButton label="退出沉浸式" onPress={() => setSession(leaveImmersive(session, "bar"))} /> : null}
        {chrome.immersive ? <HitButton label="返回" onPress={() => setSession(leaveImmersive(session, "back"))} /> : null}
        <HitButton label="下缘上滑" onPress={() => setSession(summonFromEdge(session, "bottom"))} />
        <HitButton label="横屏" onPress={() => setSession(rotate(session, session.orientation === "landscape" ? "portrait" : "landscape"))} />
        <HitButton
          label="断开"
          onPress={() => {
            disconnectSessionRelay();
            setSession(disconnect());
          }}
        />
      </View>
      {chrome.ways.map((title) => (
        <Text key={title}>{title}</Text>
      ))}
      {chrome.notice ? <Text>{chrome.notice}</Text> : null}
    </SafeAreaView>
  );
}
