import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

const BASE_URL = "https://backend.tss.wistronlabs.com/api/v1";

function useApi() {
  const { token } = useContext(AuthContext);

  async function fetchJSON(endpoint, options = {}) {
    const headers = {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const msg = `API ${endpoint} failed: ${res.status} ${res.statusText}`;
      console.error(msg);
      throw new Error(msg);
    }

    if (res.status === 204) return null; // no content
    return res.json();
  }

  // System API
  const getSystems = () => fetchJSON("/systems");
  const getHistory = () => fetchJSON("/systems/history");
  const getSystem = (tag) => fetchJSON(`/systems/${tag}`);
  const getSystemHistory = (tag) => fetchJSON(`/systems/${tag}/history`);

  const createSystem = (payload) =>
    fetchJSON("/systems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  const deleteSystem = (tag) =>
    fetchJSON(`/systems/${tag}`, { method: "DELETE" });

  const updateSystemLocation = (tag, payload) =>
    fetchJSON(`/systems/${tag}/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  const deleteLastHistoryEntry = (tag) =>
    fetchJSON(`/systems/${tag}/history/last`, { method: "DELETE" });

  // Location API
  const getLocations = () => fetchJSON("/locations");

  const updateLocation = (tag, body) =>
    fetchJSON(`/systems/${tag}/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // Station API
  const getStations = () => fetchJSON("/stations");

  const getStation = (stationName) =>
    fetchJSON(`/stations/${encodeURIComponent(stationName)}`);

  const createStation = (payload) =>
    fetchJSON("/stations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  const updateStation = (stationName, payload) =>
    fetchJSON(`/stations/${encodeURIComponent(stationName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  const deleteStation = (stationName) =>
    fetchJSON(`/stations/${encodeURIComponent(stationName)}`, {
      method: "DELETE",
    });

  const moveSystemToProcessed = (service_tag) =>
    fetchJSON(`/systems/${service_tag}/location`, token, {
      method: "PATCH",
      body: JSON.stringify({
        to_location_id: 1,
        note: "Moving back to processed from Inactive",
      }),
    });

  return {
    getSystems,
    getHistory,
    getSystem,
    getSystemHistory,
    createSystem,
    deleteSystem,
    updateSystemLocation,
    deleteLastHistoryEntry,
    getLocations,
    updateLocation,
    getStations,
    getStation,
    createStation,
    updateStation,
    deleteStation,
    moveSystemToProcessed,
  };
}

export default useApi;
