const BASE_URL = "https://backend.tss.wistronlabs.com/api/v1";

/**
 * Utility to wrap fetch and throw on error
 */
async function fetchJSON(endpoint, token, options = {}) {
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    const msg = `API ${endpoint} failed: ${res.status} ${res.statusText}`;
    console.error(msg);
    let errorBody = null;
    try {
      errorBody = await res.json();
      console.error("Response body:", errorBody);
    } catch (e) {
      console.error("Failed to parse error response body:", e);
    }
    throw new Error(msg);
  }
  return res.json();
}

// system api calls ----------------------------------

export async function getSystems(token) {
  return fetchJSON("/systems", token);
}

export async function getHistory(token) {
  return fetchJSON("/systems/history", token);
}

export async function createSystem(payload, token) {
  return fetchJSON("/systems", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteSystem(tag, token) {
  await fetchJSON(`/systems/${tag}`, token, { method: "DELETE" });
}

export async function getSystem(tag, token) {
  return fetchJSON(`/systems/${tag}`, token);
}

export async function moveSystemToProcessed(service_tag, token) {
  return fetchJSON(`/systems/${service_tag}/location`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to_location_id: 1,
      note: "Moving back to processed from Inactive",
    }),
  });
}

export async function updateSystemLocation(serviceTag, payload, token) {
  return fetchJSON(`/systems/${serviceTag}/location`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteLastHistoryEntry(serviceTag, token) {
  await fetchJSON(`/systems/${serviceTag}/history/last`, token, {
    method: "DELETE",
  });
}

// location api calls ----------------------

export async function getLocations(token) {
  return fetchJSON("/locations", token);
}

export async function updateLocation(tag, body, token) {
  return fetchJSON(`/systems/${tag}/location`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// history api calls -----------------------------

export async function getSystemHistory(tag, token) {
  return fetchJSON(`/systems/${tag}/history`, token);
}

// station API calls -------------------------------

export async function getStations(token) {
  return fetchJSON("/stations", token);
}

export async function getStation(stationName, token) {
  return fetchJSON(`/stations/${encodeURIComponent(stationName)}`, token);
}

export async function createStation(payload, token) {
  return fetchJSON("/stations", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateStation(stationName, payload, token) {
  return fetchJSON(`/stations/${encodeURIComponent(stationName)}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteStation(stationName, token) {
  await fetchJSON(`/stations/${encodeURIComponent(stationName)}`, token, {
    method: "DELETE",
  });
}
