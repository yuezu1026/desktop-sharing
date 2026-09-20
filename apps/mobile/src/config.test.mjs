import assert from "node:assert/strict";
import { resolveControlPlaneOrigin } from "./config.mjs";

assert.equal(resolveControlPlaneOrigin({ envOrigin: "http://192.168.1.8:8080/" }), "http://192.168.1.8:8080");
assert.equal(resolveControlPlaneOrigin({ platformOS: "android" }), "http://10.0.2.2:8080");
assert.equal(
  resolveControlPlaneOrigin({ platformOS: "android", androidEmulatorHost: "192.168.1.8" }),
  "http://192.168.1.8:8080",
);
assert.equal(resolveControlPlaneOrigin({ platformOS: "ios" }), "http://127.0.0.1:8080");
assert.equal(resolveControlPlaneOrigin({}), "http://127.0.0.1:8080");

console.log("mobile config ok");
