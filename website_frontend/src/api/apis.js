const BASE_URL = "https://backend.tss.wistronlabs.com:/api/v1";

/**
 * Utility to wrap fetch and throw on error
 */
async function fetchJSON(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  if (!res.ok) {
    const msg = `API ${endpoint} failed: ${res.status} ${res.statusText}`;
    console.error(msg);
    throw new Error(msg);
  }
  return res.json();
}

// system api calls ----------------------------------

/**
 * Get all current systems
 */
export async function getSystems() {
  return fetchJSON("/systems");
}

/**
 * Get full system history ledger
 */
export async function getHistory() {
  return fetchJSON("/systems/history");
}

/**
 * Create a new system
 * @param {{service_tag: string, issue: string, location_id: number, note: string|null}} payload
 */
export async function createSystem(payload) {
  const res = await fetch(`${BASE_URL}/systems`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = `Failed to create system: ${res.status} ${res.statusText}`;
    console.error(msg);
    throw new Error(msg);
  }
  return res.json();
}

export async function deleteSystem(tag) {
  const res = await fetch(`${BASE_URL}/systems/${tag}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete unit");
}

export function getSystem(tag) {
  return fetchJSON(`/systems/${tag}`);
}

/**
 * Move an inactive system back to processed
 * @param {string} service_tag
 */
export async function moveSystemToProcessed(service_tag) {
  const res = await fetch(`${BASE_URL}/systems/${service_tag}/location`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to_location_id: 1,
      note: "Moving back to processed from Inactive",
    }),
  });
  if (!res.ok) {
    const msg = `Failed to move system ${service_tag} to processed`;
    console.error(msg);
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Update a system's location
 * @param {string} serviceTag
 * @param {{to_location_id: number, note: string}} payload
 */
export async function updateSystemLocation(serviceTag, payload) {
  const res = await fetch(`${BASE_URL}/systems/${serviceTag}/location`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = `Failed to update location: ${res.status} ${res.statusText}`;
    console.error(msg);
    throw new Error(msg);
  }
  return res.json(); // or return nothing if your API doesn't respond with JSON
}

/**
 * Delete the last history entry for a system
 * @param {string} serviceTag
 * @returns {Promise<void>}
 */
export async function deleteLastHistoryEntry(serviceTag) {
  const res = await fetch(`${BASE_URL}/systems/${serviceTag}/history/last`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const msg = `Failed to delete last history entry for ${serviceTag}: ${res.status} ${res.statusText}`;
    console.error(msg);
    throw new Error(msg);
  }
}
// location api calls ----------------------

/**
 * Get all locations
 */
export async function getLocations() {
  return fetchJSON("/locations");
}

export async function updateLocation(tag, body) {
  const res = await fetch(
    `https://backend.tss.wistronlabs.com:/api/v1/systems/${tag}/location`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error("Failed to update location");
}

// history api calls -----------------------------

export function getSystemHistory(tag) {
  return fetchJSON(`/systems/${tag}/history`);
}
