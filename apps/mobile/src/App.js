import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, PanResponder, Platform, requireNativeComponent, useColorScheme } from "react-native";
import { resolveControlPlaneOrigin, resolveRelayAddress, LAB_CONTROL_PLANE_ORIGIN, LAB_RELAY_ADDRESS } from "./config.mjs";
import {
  acknowledgeDisclosure,
  forgotPassword,
  getRemoteSession,
  listHostDevices,
  loadBalance,
  loadDisclosure,
  login,
  registerAccount,
  requestChallenge,
  requestRemoteSession,
} from "./api.mjs";
import { AUTH_MODES, LOGIN_HF } from "./auth/login-hf.mjs";
import { filterDeviceRows } from "./devices/devices-hf.mjs";
import {
  connectSessionRelay,
  disconnectSessionRelay,
  sendSessionRelayFrame,
  subscribeSessionRelay,
} from "./native/session-relay.mjs";
import { setSystemBarsHidden } from "./native/system-chrome.mjs";
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
import { sessionLayoutBox } from "./session/immersive-chrome.mjs";
import { resolveColors } from "./theme.mjs";
import { LoginScreen } from "./components/LoginScreen.js";
import { DisclosureScreen } from "./components/DisclosureScreen.js";
import { DevicesScreen } from "./components/DevicesScreen.js";
import { HostScreen, copyHostText } from "./components/HostScreen.js";
import { SessionScreen } from "./components/SessionScreen.js";
import {
  createHostSession,
  ensureHostIdentity,
  hostChrome,
  rotateTempPassword,
  setAcceptConnections,
  setCopyFeedback,
} from "./host/host-session.mjs";
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
  encodeWheel,
  moveCursorByDelta,
  packInputFrame,
  virtualKeyFromChar,
  virtualKeyFromKeyName,
} from "./session/input.mjs";
import {
  POINTER_BUTTON_LEFT,
  POINTER_BUTTON_RIGHT,
  classifyTrackpadStroke,
} from "./session/trackpad-gesture.mjs";

const RemoteFrameView = Platform.OS === "android" ? requireNativeComponent("RemoteFrameView") : null;

/** 真机 UI 巡检种子：不连控制面也能看登录后壳。默认关；离线巡检壳时再改 true。 */
const UI_PATROL_SEED = false;

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
  const [hostSession, setHostSession] = useState(createHostSession);
  const [shellTab, setShellTab] = useState("devices");
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [authMode, setAuthMode] = useState(AUTH_MODES.password);
  const [agreed, setAgreed] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [devices, setDevices] = useState({ devices: [], deviceQuota: null });
  const [disclosure, setDisclosure] = useState(null);
  const [deviceSearch, setDeviceSearch] = useState("");
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
    if (shellTab !== "host") return undefined;
    setHostSession((current) => ensureHostIdentity(current));
    return undefined;
  }, [shellTab]);

  useEffect(() => {
    return subscribeSessionRelay((event) => {
      setSession((current) => applyNativeRelayEvent(current, event));
    });
  }, []);

  useEffect(() => {
    if (!UI_PATROL_SEED) return undefined;
    setToken("ui-patrol-seed");
    setDisclosure({
      title: "首次连接前请了解",
      relay: "中继会转发音画与键鼠，用于打通网络。",
      direct: "直连只上报起止，不经中继转发内容。",
      required: true,
    });
    setSession(createSession());
    setDevices({
      deviceQuota: 150,
      devices: [
        {
          hostDeviceId: "host-1",
          displayName: "我的台式机",
          platform: "windows",
          connectionState: "online",
          lastSeenAt: "2026-09-20T12:00:00Z",
        },
        {
          hostDeviceId: "host-2",
          displayName: "爸爸的笔记本",
          platform: "windows",
          connectionState: "offline",
          lastSeenAt: "2026-09-17T12:00:00Z",
        },
        {
          hostDeviceId: "host-3",
          displayName: "旧手机",
          platform: "android",
          connectionState: "offline",
          lastSeenAt: null,
        },
      ],
    });
    return undefined;
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
    if (UI_PATROL_SEED || !token || !origin) return undefined;
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
  const screenSize = Dimensions.get("screen");
  const layoutBox = sessionLayoutBox({
    immersive: session.immersive,
    windowWidth: windowSize.width,
    windowHeight: windowSize.height,
    screenWidth: screenSize.width,
    screenHeight: screenSize.height,
  });
  useEffect(() => {
    setSystemBarsHidden(layoutBox.hideSystemBars);
    return () => setSystemBarsHidden(false);
  }, [layoutBox.hideSystemBars]);
  const picture = layoutPicture({
    containerWidth: layoutBox.containerWidth,
    containerHeight: layoutBox.containerHeight,
    pictureWidth: session.pictureWidth,
    pictureHeight: session.pictureHeight,
    keyboardOpen: session.keyboardOpen,
    keyboardHeight: 0,
    focusFollow: session.focusFollow,
    focusRect: null,
  });
  const panGestureRef = useRef({
    lastDx: 0,
    lastDy: 0,
    maxTouches: 1,
    startedAt: 0,
  });
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event, gesture) => {
          panGestureRef.current = {
            lastDx: 0,
            lastDy: 0,
            maxTouches: Math.max(1, gesture.numberActiveTouches || 1),
            startedAt: Date.now(),
          };
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          if (current.pointerMode === "trackpad") return;
          const touch = event.nativeEvent;
          const mapped = mapTouch(
            current.pointerMode,
            { x: touch.locationX, y: touch.locationY, deltaX: 0, deltaY: 0 },
            picture.picture,
            current.pictureWidth,
            current.pictureHeight,
          );
          if (mapped.kind !== "absolute") return;
          const point = clampPicturePoint(mapped.pictureX, mapped.pictureY, current.pictureWidth, current.pictureHeight);
          sendSessionRelayFrame(
            bytesToBase64(
              packInputFrame(encodePointer(INPUT_POINTER_DOWN, point.x, point.y, POINTER_BUTTON_LEFT)),
            ),
          );
          setSession((prev) => ({ ...prev, cursorX: point.x, cursorY: point.y }));
        },
        onPanResponderMove: (event, gesture) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          const touchCount = Math.max(1, gesture.numberActiveTouches || 1);
          const stroke = panGestureRef.current;
          stroke.maxTouches = Math.max(stroke.maxTouches, touchCount);
          const stepDx = gesture.dx - stroke.lastDx;
          const stepDy = gesture.dy - stroke.lastDy;
          stroke.lastDx = gesture.dx;
          stroke.lastDy = gesture.dy;

          if (current.pointerMode === "trackpad") {
            const action = classifyTrackpadStroke({
              touchCount: stroke.maxTouches,
              stepDx,
              stepDy,
              totalDx: gesture.dx,
              totalDy: gesture.dy,
              durationMs: Date.now() - stroke.startedAt,
              phase: "move",
            });
            if (action.kind === "move") {
              const moved = moveCursorByDelta(current, action.deltaX, action.deltaY);
              sendSessionRelayFrame(
                bytesToBase64(
                  packInputFrame(encodePointer(INPUT_POINTER_MOVE, moved.cursorX, moved.cursorY, 0)),
                ),
              );
              setSession((prev) => ({ ...prev, cursorX: moved.cursorX, cursorY: moved.cursorY }));
            } else if (action.kind === "wheel") {
              const point = clampPicturePoint(
                current.cursorX || 0,
                current.cursorY || 0,
                current.pictureWidth,
                current.pictureHeight,
              );
              sendSessionRelayFrame(bytesToBase64(packInputFrame(encodeWheel(point.x, point.y, action.delta))));
            }
            return;
          }

          const touch = event.nativeEvent;
          const mapped = mapTouch(
            current.pointerMode,
            { x: touch.locationX, y: touch.locationY, deltaX: 0, deltaY: 0 },
            picture.picture,
            current.pictureWidth,
            current.pictureHeight,
          );
          if (mapped.kind !== "absolute") return;
          const point = clampPicturePoint(mapped.pictureX, mapped.pictureY, current.pictureWidth, current.pictureHeight);
          sendSessionRelayFrame(
            bytesToBase64(
              packInputFrame(encodePointer(INPUT_POINTER_MOVE, point.x, point.y, POINTER_BUTTON_LEFT)),
            ),
          );
          setSession((prev) => ({ ...prev, cursorX: point.x, cursorY: point.y }));
        },
        onPanResponderRelease: (event, gesture) => {
          const current = sessionRef.current;
          if (!current.relayAttached || current.viewOnly) return;
          const stroke = panGestureRef.current;
          if (current.pointerMode === "trackpad") {
            const action = classifyTrackpadStroke({
              touchCount: stroke.maxTouches,
              stepDx: 0,
              stepDy: 0,
              totalDx: gesture.dx,
              totalDy: gesture.dy,
              durationMs: Date.now() - stroke.startedAt,
              phase: "end",
            });
            const point = clampPicturePoint(
              current.cursorX || 0,
              current.cursorY || 0,
              current.pictureWidth,
              current.pictureHeight,
            );
            if (action.kind === "leftClick") {
              sendSessionRelayFrame(
                bytesToBase64(
                  packInputFrame(encodePointer(INPUT_POINTER_DOWN, point.x, point.y, POINTER_BUTTON_LEFT)),
                ),
              );
              sendSessionRelayFrame(
                bytesToBase64(
                  packInputFrame(encodePointer(INPUT_POINTER_UP, point.x, point.y, POINTER_BUTTON_LEFT)),
                ),
              );
            } else if (action.kind === "rightClick") {
              sendSessionRelayFrame(
                bytesToBase64(
                  packInputFrame(encodePointer(INPUT_POINTER_DOWN, point.x, point.y, POINTER_BUTTON_RIGHT)),
                ),
              );
              sendSessionRelayFrame(
                bytesToBase64(
                  packInputFrame(encodePointer(INPUT_POINTER_UP, point.x, point.y, POINTER_BUTTON_RIGHT)),
                ),
              );
            }
            return;
          }
          const touch = event.nativeEvent;
          const mapped = mapTouch(
            current.pointerMode,
            { x: touch.locationX, y: touch.locationY, deltaX: 0, deltaY: 0 },
            picture.picture,
            current.pictureWidth,
            current.pictureHeight,
          );
          if (mapped.kind !== "absolute") return;
          const point = clampPicturePoint(mapped.pictureX, mapped.pictureY, current.pictureWidth, current.pictureHeight);
          sendSessionRelayFrame(
            bytesToBase64(
              packInputFrame(encodePointer(INPUT_POINTER_UP, point.x, point.y, POINTER_BUTTON_LEFT)),
            ),
          );
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
    if (authMode === AUTH_MODES.register) {
      if (!agreed) {
        setLoginError("请先同意用户协议与隐私政策");
        return;
      }
      const result = await registerAccount(origin, phone, password, challengeId, smsCode);
      if (!result.ok) {
        setLoginError(result.body.message || "注册失败");
        return;
      }
      setToken(result.body.token);
      return;
    }
    if (authMode === AUTH_MODES.forgot) {
      const result = await forgotPassword(origin, phone, password, challengeId, smsCode);
      if (!result.ok) {
        setLoginError(result.body.message || "重置失败");
        return;
      }
      setAuthMode(AUTH_MODES.password);
      setLoginError("");
      setPassword("");
      setSmsCode("");
      setChallengeId("");
      return;
    }
    if (authMode === AUTH_MODES.sms) {
      const result = await login(origin, phone, "", { challengeId, challengeCode: smsCode });
      if (!result.ok) {
        setLoginError(
          result.body.code === "login_failed" ? LOGIN_HF.loginFailed : result.body.message || "登录失败",
        );
        return;
      }
      setToken(result.body.token);
      return;
    }
    const result = await login(origin, phone, password);
    if (!result.ok) {
      setLoginError(
        result.body.code === "login_failed" ? LOGIN_HF.loginFailed : result.body.message || "登录失败",
      );
      return;
    }
    setToken(result.body.token);
  }

  async function fetchSmsCode() {
    setLoginError("");
    if (!origin) {
      setLoginError("服务地址未配置");
      return;
    }
    const purpose =
      authMode === AUTH_MODES.register ? "register" : authMode === AUTH_MODES.forgot ? "forgot_password" : "login";
    const result = await requestChallenge(origin, purpose, phone);
    if (!result.ok) {
      setLoginError(result.body.message || "验证码发送失败");
      return;
    }
    setChallengeId(result.body.challengeId || "");
    if (result.body.devCode) setSmsCode(String(result.body.devCode));
  }

  function onBioPress() {
    setLoginError(LOGIN_HF.bioUnavailable);
  }

  function onAuthModeChange(nextMode) {
    setAuthMode(nextMode);
    setLoginError("");
    setSmsCode("");
    setChallengeId("");
  }

  async function acceptDisclosure(opts) {
    if (origin && token) {
      try {
        await acknowledgeDisclosure(origin, token);
      } catch {
        // 联调失败也允许关掉告知，避免卡死在本页
      }
    }
    // dontRemind 由服务端 ack 持久化；联调失败时本地仍关掉本页
    void opts;
    setDisclosure(null);
  }

  async function onConnect(row) {
    const next = connectDevice(session, row);
    if (next === session) return;
    if (origin && token) {
      try {
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
      } catch {
        // 联调失败时仍进入会话壳，便于 UI 巡检与离线演示
      }
    }
    setSession(next);
  }

  if (!token) {
    return (
      <LoginScreen
        palette={palette}
        mode={authMode}
        phone={phone}
        password={password}
        smsCode={smsCode}
        agreed={agreed}
        loginError={loginError}
        labHint={__DEV__ && origin ? "联调 " + origin : ""}
        onPhoneChange={setPhone}
        onPasswordChange={setPassword}
        onSmsCodeChange={setSmsCode}
        onToggleAgree={() => setAgreed((current) => !current)}
        onSubmit={submitLogin}
        onFetchCode={fetchSmsCode}
        onModeChange={onAuthModeChange}
        onBioPress={onBioPress}
      />
    );
  }

  if (disclosure) {
    return <DisclosureScreen palette={palette} onAccept={acceptDisclosure} />;
  }

  if (session.screen === "devices") {
    if (shellTab === "host") {
      return (
        <HostScreen
          palette={palette}
          chrome={hostChrome(hostSession)}
          onToggleAccept={() =>
            setHostSession(setAcceptConnections(hostSession, !hostSession.acceptConnections))
          }
          onCopyCode={() => {
            copyHostText(hostSession.deviceCode);
            setHostSession(setCopyFeedback(hostSession, true));
            setTimeout(() => {
              setHostSession((current) => setCopyFeedback(current, false));
            }, 1500);
          }}
          onRotatePassword={() => setHostSession(rotateTempPassword(hostSession))}
          onOpenDevices={() => setShellTab("devices")}
        />
      );
    }
    const list = deviceRows(devices);
    return (
      <DevicesScreen
        palette={palette}
        quotaText={list.quotaText || ""}
        notice={session.notice || ""}
        searchQuery={deviceSearch}
        onSearchChange={setDeviceSearch}
        rows={filterDeviceRows(list.rows, deviceSearch)}
        onConnect={onConnect}
        onOpenHost={() => setShellTab("host")}
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
      onZoom={() => {}}
    />
  );
}
