/** 沉浸态系统栏：Android 走原生；iOS / 无模块时退回 StatusBar。 */

import { NativeModules, Platform, StatusBar } from "react-native";

const nativeModule = NativeModules.SystemChrome;

/**
 * @param {boolean} hidden
 */
export function setSystemBarsHidden(hidden) {
  const hide = hidden === true;
  StatusBar.setHidden(hide, "fade");
  if (Platform.OS === "android" && nativeModule && typeof nativeModule.setHidden === "function") {
    nativeModule.setHidden(hide);
  }
}
