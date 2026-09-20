/** 原生中继模块薄封装。模块未编译进包时不抛错，界面继续显示文案。 */

import { NativeEventEmitter, NativeModules, Platform } from "react-native";

const nativeModule = NativeModules.SessionRelay;

export function hasSessionRelayNative() {
  return Platform.OS === "android" && !!nativeModule;
}

/**
 * @param {string} address
 * @param {string} ticket
 * @param {string} fingerprint
 */
export function connectSessionRelay(address, ticket, fingerprint) {
  if (!hasSessionRelayNative()) return false;
  nativeModule.connect(address, ticket, fingerprint);
  return true;
}

export function disconnectSessionRelay() {
  if (!hasSessionRelayNative()) return;
  nativeModule.disconnect();
}

/**
 * @param {(event: { type?: string, message?: string, width?: number, height?: number, jpegBase64?: string }) => void} handler
 * @returns {() => void}
 */
export function subscribeSessionRelay(handler) {
  if (!hasSessionRelayNative()) return () => {};
  const emitter = new NativeEventEmitter(nativeModule);
  const subscription = emitter.addListener("sessionRelay", handler);
  return () => subscription.remove();
}
