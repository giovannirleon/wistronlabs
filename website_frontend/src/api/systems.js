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

/**
 * Get all current systems
 */
export async function getSystems() {
  return fetchJSON("/systems");
}

/**
 * Get all locations
 */
export async function getLocations() {
  return fetchJSON("/locations");
}

/**
 * Get full system history ledger
 */
export async function getSystemHistory() {
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
