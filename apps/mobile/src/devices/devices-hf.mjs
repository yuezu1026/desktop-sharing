/** 移动端设备列表文案与行展示，对齐 W6-01。 */

export const DEVICES_HF = {
  title: "我的设备",
  searchPlaceholder: "搜索设备",
  connect: "连接",
  bindOnly: "仅绑定",
  tabDevices: "设备",
  tabRecent: "最近",
  tabSettings: "设置",
  quotaMustComeFromServer: "设备数上限由后端下发",
};

const PLATFORM_LABELS = {
  windows: "Windows",
  macos: "macOS",
  mac: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

/**
 * @param {string|null|undefined} platform
 */
export function platformLabel(platform) {
  const key = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (!key) return "";
  return PLATFORM_LABELS[key] || key;
}

/**
 * @param {{ platform?: string, statusText?: string }} row
 */
export function deviceSubtitle(row) {
  const status = String(row?.statusText ?? "").trim();
  if (status === "从未连接") return status;
  const platform = platformLabel(row?.platform);
  if (platform && status) return platform + " · " + status;
  return status || platform;
}

/**
 * @param {Array<{ displayName?: string, platform?: string, statusText?: string }>} rows
 * @param {string} query
 */
export function filterDeviceRows(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const needle = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return list;
  return list.filter((row) => {
    const name = String(row?.displayName ?? "").toLowerCase();
    const platform = platformLabel(row?.platform).toLowerCase();
    const status = String(row?.statusText ?? "").toLowerCase();
    return name.includes(needle) || platform.includes(needle) || status.includes(needle);
  });
}
