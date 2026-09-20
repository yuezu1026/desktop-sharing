import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, Platform, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { resolveControlPlaneOrigin, resolveRelayAddress, LAB_CONTROL_PLANE_ORIGIN, LAB_RELAY_ADDRESS } from "./config.mjs";
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
  sendSessionRelayFrame,
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
  mapTouch,
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
import {
  INPUT_KEY_DOWN,
  INPUT_KEY_UP,
  INPUT_POINTER_DOWN,
  INPUT_POINTER_MOVE,
  INPUT_POINTER_UP,
  bytesToBase64,
  clampPicturePoint,
  encodeKey,
  encodePointer,
  moveCursorByDelta,
  packInputFrame,
  virtualKeyFromChar,
  virtualKeyFromKeyName,
} from "./session/input.mjs";

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
    labOrigin: LAB_CONTROL_PLANE_ORIGIN,
    platformOS: Platform.OS,
  });
  const relayAddress = resolveRelayAddress({
    envAddress: typeof process !== "undefined" && process.env ? process.env.RELAY_ADDR : "",
    labAddress: LAB_RELAY_ADDRESS,
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
  const loupe = session.magnifier ? magnifierSample(session.pictureWidth, session.pictureHeight, session.cursorX || 8, session.cursorY || 4) : null;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const pictureRef = useRef(picture);
  pictureRef.current = picture;
  const trackpadOriginRef = useRef({ x: 0, y: 0 });

  function emitPointer(kind, pictureX, pictureY, button = 0) {
    const point = clampPicturePoint(pictureX, pictureY, sessionRef.current.pictureWidth, sessionRef.current.pictureHeight);
    const frame = packInputFrame(encodePointer(kind, point.x, point.y, button));
    sendSessionRelayFrame(bytesToBase64(frame));
    setSession((current) => ({ ...current, cursorX: point.x, cursorY: point.y }));
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => {
          const current = sessionRef.current;
          return current.relayAttached === true && !current.viewOnly;
        },
        onMoveShouldSetPanResponder: () => {
          const current = sessionRef.current;
          return current.relayAttached === true && !current.viewOnly;
        },
        onPanResponderGrant: (event, gesture) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          const layout = pictureRef.current;
          if (current.pointerMode === "trackpad") {
            trackpadOriginRef.current = { x: gesture.dx, y: gesture.dy };
            emitPointer(INPUT_POINTER_DOWN, current.cursorX || 0, current.cursorY || 0, 0);
            return;
          }
          const mapped = mapTouch(
            "direct",
            { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
            layout.picture,
            current.pictureWidth,
            current.pictureHeight,
          );
          if (mapped.kind !== "absolute") return;
          emitPointer(INPUT_POINTER_DOWN, mapped.pictureX, mapped.pictureY, 0);
        },
        onPanResponderMove: (event, gesture) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          const layout = pictureRef.current;
          if (current.pointerMode === "trackpad") {
            const deltaX = gesture.dx - trackpadOriginRef.current.x;
            const deltaY = gesture.dy - trackpadOriginRef.current.y;
            trackpadOriginRef.current = { x: gesture.dx, y: gesture.dy };
            const next = moveCursorByDelta(current, deltaX, deltaY);
            emitPointer(INPUT_POINTER_MOVE, next.cursorX, next.cursorY, 0);
            return;
          }
          const mapped = mapTouch(
            "direct",
            { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
            layout.picture,
            current.pictureWidth,
            current.pictureHeight,
          );
          if (mapped.kind !== "absolute") return;
          emitPointer(INPUT_POINTER_MOVE, mapped.pictureX, mapped.pictureY, 0);
        },
        onPanResponderRelease: (event) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          const layout = pictureRef.current;
          if (current.pointerMode === "trackpad") {
            emitPointer(INPUT_POINTER_UP, current.cursorX || 0, current.cursorY || 0, 0);
            return;
          }
          const mapped = mapTouch(
            "direct",
            { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
            layout.picture,
            current.pictureWidth,
            current.pictureHeight,
          );
          if (mapped.kind !== "absolute") {
            emitPointer(INPUT_POINTER_UP, current.cursorX || 0, current.cursorY || 0, 0);
            return;
          }
          emitPointer(INPUT_POINTER_UP, mapped.pictureX, mapped.pictureY, 0);
        },
      }),
    [],
  );

  return (
    <SafeAreaView style={{ flex: 1, padding: 12, gap: 8 }}>
      <Text>{chrome.linkLabel}</Text>
      {chrome.quotaNumber !== null ? <Text>{"免费中继时长剩余约 " + chrome.quotaNumber + " 分钟"}</Text> : null}
      {chrome.subscriptionBadge ? <Text>{chrome.subscriptionBadge}</Text> : null}
      {chrome.realNameMessage ? <Text>{chrome.realNameMessage}</Text> : null}
      <View
        style={{ height: picture.viewHeight, backgroundColor: "#000", overflow: "hidden" }}
        {...panResponder.panHandlers}
      >
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
              pointerEvents="none"
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
        {session.keyboardOpen ? (
          <TextInput
            autoFocus
            value=""
            onChangeText={(text) => {
              if (!session.relayAttached || session.viewOnly) return;
              const last = text.slice(-1);
              const keyCode = virtualKeyFromChar(last);
              if (keyCode == null) return;
              sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_DOWN, keyCode))));
              sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_UP, keyCode))));
            }}
            onKeyPress={(event) => {
              if (!session.relayAttached || session.viewOnly) return;
              const keyCode = virtualKeyFromKeyName(event.nativeEvent.key);
              if (keyCode == null) return;
              sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_DOWN, keyCode))));
              sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_UP, keyCode))));
            }}
            placeholder="输入会发到对方电脑"
            style={{ minHeight: MIN_HIT_PX, minWidth: 180, borderWidth: 1, paddingHorizontal: 8 }}
          />
        ) : null}
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
