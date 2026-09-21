import assert from "node:assert/strict";
import {
  LAB_CONTROL_PLANE_ORIGIN,
  LAB_RELAY_ADDRESS,
  resolveControlPlaneOrigin,
  resolveRelayAddress,
} from "./config.mjs";

assert.equal(resolveControlPlaneOrigin({ platformOS: "android" }), "http://10.0.2.2:8080");
assert.equal(
  resolveControlPlaneOrigin({ envOrigin: "http://192.168.1.8:8080/" }),
  "http://192.168.1.8:8080",
);
assert.equal(
  resolveControlPlaneOrigin({ labOrigin: LAB_CONTROL_PLANE_ORIGIN, platformOS: "android" }),
  "http://127.0.0.1:8080",
);
assert.equal(resolveControlPlaneOrigin({ platformOS: "ios" }), "http://127.0.0.1:8080");

assert.equal(resolveRelayAddress({ platformOS: "android" }), "10.0.2.2:443");
assert.equal(resolveRelayAddress({ envAddress: "192.168.1.8:443" }), "192.168.1.8:443");
assert.equal(
  resolveRelayAddress({ labAddress: LAB_RELAY_ADDRESS, platformOS: "android" }),
  "127.0.0.1:8443",
);

console.log("mobile config ok");
