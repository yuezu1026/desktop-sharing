const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

/**
 * Metro：允许现有 .mjs 会话脚本。
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    sourceExts: ["js", "json", "ts", "tsx", "mjs"],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
