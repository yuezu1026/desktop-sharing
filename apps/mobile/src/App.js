import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, PanResponder, Platform, requireNativeComponent, useColorScheme } from "react-native";
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
import { resolveColors } from "./theme.mjs";
import { LoginScreen } from "./components/LoginScreen.js";
import { DisclosureScreen } from "./components/DisclosureScreen.js";
import { DevicesScreen } from "./components/DevicesScreen.js";
import { SessionScreen } from "./components/SessionScreen.js";
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

const RemoteFrameView = Platform.OS === "android" ? requireNativeComponent("RemoteFrameView") : null;

function newFingerprint() {
  const alphabet = "abcdef0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

export function App() {
  const colorScheme = useColorScheme();
  const palette = useMemo(() => resolveColors(colorScheme), [colorScheme]);
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
      loadBalance(origin, token).then((result) => {
        if (!result.ok) return;
        setSession((current) => applyBalance(current, result.body));
      });
    }, 800);
    return () => clearInterval(timer);
  }, [token, origin, session.screen, session.remoteSessionId]);

  useEffect(() => {
    if (!token || !origin) return undefined;
    listHostDevices(origin, token).then((result) => {
      if (result.ok) setDevices(result.body);
    });
    loadBalance(origin, token).then((result) => {
      if (result.ok) setSession((current) => applyBalance(current, result.body));
    });
    loadDisclosure(origin, token).then((result) => {
      if (result.ok && result.body && result.body.required) setDisclosure(result.body);
    });
    return undefined;
  }, [token, origin]);

  // 会话触控相关 hook 必须在任何条件 return 之前调用，避免 hooks 数量变化。
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const windowSize = Dimensions.get("window");
  // 真机全宽铺画面；高度按比例留出顶栏/按钮，避免 360 假尺寸把桌面压成细条。
  const picture = layoutPicture(Math.max(280, windowSize.width - 24), Math.round(windowSize.height * 0.48), session);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          const touch = event.nativeEvent;
          const mapped = mapTouch(current, picture, touch.locationX, touch.locationY);
          if (!mapped) return;
          if (current.pointerMode === "trackpad") {
            setSession((prev) => ({ ...prev, cursorX: mapped.x, cursorY: mapped.y }));
            return;
          }
          const point = clampPicturePoint(mapped.x, mapped.y, current.pictureWidth, current.pictureHeight);
          sendSessionRelayFrame(bytesToBase64(packInputFrame(encodePointer(INPUT_POINTER_DOWN, point.x, point.y, 1))));
          setSession((prev) => ({ ...prev, cursorX: point.x, cursorY: point.y }));
        },
        onPanResponderMove: (event, gesture) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          if (current.pointerMode === "trackpad") {
            const moved = moveCursorByDelta(
              current.cursorX || 0,
              current.cursorY || 0,
              gesture.dx,
              gesture.dy,
              current.pictureWidth,
              current.pictureHeight,
            );
            sendSessionRelayFrame(bytesToBase64(packInputFrame(encodePointer(INPUT_POINTER_MOVE, moved.x, moved.y, 0))));
            setSession((prev) => ({ ...prev, cursorX: moved.x, cursorY: moved.y }));
            return;
          }
          const touch = event.nativeEvent;
          const mapped = mapTouch(current, picture, touch.locationX, touch.locationY);
          if (!mapped) return;
          const point = clampPicturePoint(mapped.x, mapped.y, current.pictureWidth, current.pictureHeight);
          sendSessionRelayFrame(bytesToBase64(packInputFrame(encodePointer(INPUT_POINTER_MOVE, point.x, point.y, 1))));
          setSession((prev) => ({ ...prev, cursorX: point.x, cursorY: point.y }));
        },
        onPanResponderRelease: (event) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          if (current.pointerMode === "trackpad") {
            const point = clampPicturePoint(
              current.cursorX || 0,
              current.cursorY || 0,
              current.pictureWidth,
              current.pictureHeight,
            );
            sendSessionRelayFrame(bytesToBase64(packInputFrame(encodePointer(INPUT_POINTER_DOWN, point.x, point.y, 1))));
            sendSessionRelayFrame(bytesToBase64(packInputFrame(encodePointer(INPUT_POINTER_UP, point.x, point.y, 0))));
            return;
          }
          const touch = event.nativeEvent;
          const mapped = mapTouch(current, picture, touch.locationX, touch.locationY);
          if (!mapped) return;
          const point = clampPicturePoint(mapped.x, mapped.y, current.pictureWidth, current.pictureHeight);
          sendSessionRelayFrame(bytesToBase64(packInputFrame(encodePointer(INPUT_POINTER_UP, point.x, point.y, 0))));
        },
      }),
    [picture],
  );

  async function submitLogin() {
    setLoginError("");
    if (!origin) {
      setLoginError("服务地址未配置");
      return;
    }
    const result = await login(origin, phone, password);
    if (!result.ok) {
      setLoginError(result.body.message || "登录失败");
      return;
    }
    setToken(result.body.token);
  }

  async function acceptDisclosure() {
    if (origin && token) await acknowledgeDisclosure(origin, token);
    setDisclosure(null);
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
      setSession({
        ...session,
        notice: requested.body.message || "未能发起会话",
      });
      return;
    }
    setSession(next);
  }

  if (!token) {
    return (
      <LoginScreen
        palette={palette}
        origin={origin}
        phone={phone}
        password={password}
        loginError={loginError}
        onPhoneChange={setPhone}
        onPasswordChange={setPassword}
        onSubmit={submitLogin}
      />
    );
  }

  if (disclosure) {
    return (
      <DisclosureScreen
        palette={palette}
        title={disclosure.title}
        relay={disclosure.relay}
        direct={disclosure.direct}
        onAccept={acceptDisclosure}
      />
    );
  }

  if (session.screen === "devices") {
    const list = deviceRows(devices);
    return (
      <DevicesScreen
        palette={palette}
        quotaText={list.quotaText || ""}
        notice={session.notice || ""}
        rows={list.rows}
        onConnect={onConnect}
      />
    );
  }

  const chrome = sessionChrome(session);
  const loupe = session.magnifier
    ? magnifierSample(session.pictureWidth, session.pictureHeight, session.cursorX || 8, session.cursorY || 4)
    : null;

  return (
    <SessionScreen
      palette={palette}
      chrome={chrome}
      loupe={loupe}
      picture={picture}
      panHandlers={panResponder.panHandlers}
      RemoteFrameView={RemoteFrameView}
      session={session}
      gestureHint={gestureHint(chrome.pointerMode)}
      onDisconnect={() => {
        disconnectSessionRelay();
        setSession(disconnect());
      }}
      onSetPointerMode={(mode) => setSession(setPointerMode(session, mode))}
      onToggleFocusFollow={() => setSession(toggleFocusFollow(session))}
      onToggleMagnifier={() => setSession(toggleMagnifier(session))}
      onToggleKeyboard={() => setSession(setKeyboardOpen(session, !session.keyboardOpen))}
      onKeyboardChar={(text) => {
        if (!session.relayAttached || session.viewOnly) return;
        const last = text.slice(-1);
        const keyCode = virtualKeyFromChar(last);
        if (keyCode == null) return;
        sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_DOWN, keyCode))));
        sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_UP, keyCode))));
      }}
      onKeyboardKeyName={(keyName) => {
        if (!session.relayAttached || session.viewOnly) return;
        const keyCode = virtualKeyFromKeyName(keyName);
        if (keyCode == null) return;
        sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_DOWN, keyCode))));
        sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeKey(INPUT_KEY_UP, keyCode))));
      }}
      onOpenMeter={() => setSession(openMeter(session))}
      onAskControl={() => setSession(askControl(session))}
      onOpenWays={() => setSession(openWays(session))}
      onEnterImmersive={() => setSession(enterImmersive(session))}
      onLeaveImmersive={(via) => setSession(leaveImmersive(session, via))}
      onSummonEdge={(edge) => setSession(summonFromEdge(session, edge))}
      onRotate={() => setSession(rotate(session, session.orientation === "landscape" ? "portrait" : "landscape"))}
    />
  );
}
