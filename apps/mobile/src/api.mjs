async function readJson(response) {
  return response.json();
}

function headers(token) {
  const result = { "content-type": "application/json" };
  if (token) result.authorization = "Bearer " + token;
  return result;
}

export async function login(origin, phone, password) {
  const response = await fetch(origin + "/v1/sessions", {
    method: "POST",
    headers: headers(null),
    body: JSON.stringify({ phone, password }),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function listHostDevices(origin, token) {
  const response = await fetch(origin + "/v1/host-devices", { headers: headers(token) });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function loadDisclosure(origin, token) {
  const response = await fetch(origin + "/v1/connection-disclosure", { headers: headers(token) });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function acknowledgeDisclosure(origin, token) {
  const response = await fetch(origin + "/v1/connection-disclosure", {
    method: "POST",
    headers: headers(token),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function requestRemoteSession(origin, token, hostDeviceId, controllerFingerprint) {
  const response = await fetch(origin + "/v1/remote-sessions", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ hostDeviceId, controllerFingerprint }),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function loadBalance(origin, token) {
  const response = await fetch(origin + "/v1/relay-balance", { headers: headers(token) });
  const body = await readJson(response);
  return { ok: response.ok, body };
}
