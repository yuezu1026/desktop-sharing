async function readJson(response) {
  return response.json();
}

function headers(token) {
  const result = { "content-type": "application/json" };
  if (token) result.authorization = "Bearer " + token;
  return result;
}

export async function login(origin, phone, password, options = {}) {
  const payload = {};
  if (phone) payload.phone = phone;
  if (options.email) payload.email = options.email;
  if (password) payload.password = password;
  if (options.challengeId) payload.challengeId = options.challengeId;
  if (options.challengeCode) payload.challengeCode = options.challengeCode;
  const response = await fetch(origin + "/v1/sessions", {
    method: "POST",
    headers: headers(null),
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function requestChallenge(origin, purpose, phone) {
  const response = await fetch(origin + "/v1/challenges", {
    method: "POST",
    headers: headers(null),
    body: JSON.stringify({ purpose, phone }),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function registerAccount(origin, phone, password, challengeId, challengeCode) {
  const response = await fetch(origin + "/v1/accounts", {
    method: "POST",
    headers: headers(null),
    body: JSON.stringify({ phone, password, challengeId, challengeCode }),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function forgotPassword(origin, phone, newPassword, challengeId, challengeCode) {
  const response = await fetch(origin + "/v1/password/forgot", {
    method: "POST",
    headers: headers(null),
    body: JSON.stringify({ phone, newPassword, challengeId, challengeCode }),
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

export async function getRemoteSession(origin, token, remoteSessionId) {
  const response = await fetch(origin + "/v1/remote-sessions/" + encodeURIComponent(remoteSessionId), {
    headers: headers(token),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

export async function loadBalance(origin, token) {
  const response = await fetch(origin + "/v1/relay-balance", { headers: headers(token) });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

/**
 * @param {string} origin
 * @param {string} token
 * @param {{ displayName: string, platform: string, hardwareFingerprint: string }} payload
 */
export async function registerHostDevice(origin, token, payload) {
  const response = await fetch(origin + "/v1/host-devices", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  return { ok: response.ok, body };
}

/**
 * @param {string} origin
 * @param {string} token
 * @param {string} hostDeviceId
 * @param {{ deviceCode: string, tempPasswordHash: string }} payload
 */
export async function publishHostCredentials(origin, token, hostDeviceId, payload) {
  const response = await fetch(
    origin + "/v1/host-devices/" + encodeURIComponent(hostDeviceId) + "/credentials",
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(payload),
    },
  );
  const body = await readJson(response);
  return { ok: response.ok, body };
}

/**
 * @param {string} origin
 * @param {string} token
 * @param {string} hostDeviceId
 * @param {boolean} accepting
 */
export async function setHostAccepting(origin, token, hostDeviceId, accepting) {
  const response = await fetch(
    origin + "/v1/host-devices/" + encodeURIComponent(hostDeviceId) + "/accepting",
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ accepting: accepting === true }),
    },
  );
  const body = await readJson(response);
  return { ok: response.ok, body };
}
