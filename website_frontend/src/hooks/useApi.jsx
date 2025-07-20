import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

const BASE_URL = "https://backend.tss.wistronlabs.com/api/v1";

function useApi() {
  const { token } = useContext(AuthContext);

  function getServerUTCOffset(serverTimeString) {
    // Parse server time string
    const [datePart, timePart] = serverTimeString.split(", ");
    const [month, day, year] = datePart.split("/").map(Number);
    let [time, meridiem] = timePart.split(" ");
    let [hour, minute, second] = time.split(":").map(Number);

    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;

    // Build a *local* Date using server values
    const serverLocal = new Date(year, month - 1, day, hour, minute, second);

    // Compare to UTC to get offset
    const offsetMinutes =
      (serverLocal.getHours() - serverLocal.getUTCHours()) * 60 +
      (serverLocal.getMinutes() - serverLocal.getUTCMinutes());

    const offsetHours = offsetMinutes / 60;

    return offsetHours; // e.g., -5 for CST
  }

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

  function buildQueryString(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => usp.append(key, v));
      } else if (value !== undefined && value !== null) {
        usp.append(key, value);
      }
    });
    return usp.toString() ? `?${usp.toString()}` : "";
  }

  /**
   * Get systems with optional filters/sorts/pagination
   */
  const getSystems = ({
    filters, // advanced filters JSON string or object
    service_tag,
    issue,
    location_id,
    page,
    page_size,
    all,
    sort_by,
    sort_order,
  } = {}) => {
    const params = {
      page,
      page_size,
      all,
      sort_by,
      sort_order,
    };

    if (filters) {
      params.filters =
        typeof filters === "string" ? filters : JSON.stringify(filters);
    } else {
      // fallback for old-style params
      if (service_tag) params.service_tag = service_tag;
      if (issue) params.issue = issue;
      if (location_id) params.location_id = location_id;
    }

    const qs = buildQueryString(params);
    return fetchJSON(`/systems${qs}`);
  };

  /**
   * Get history with optional filters/sorts/pagination
   */
  const getHistory = ({
    filters, // advanced filters JSON string or object
    service_tag,
    from_location_id,
    to_location_id,
    moved_by_id,
    page,
    page_size,
    all,
    sort_by,
    sort_order,
  } = {}) => {
    const params = {
      page,
      page_size,
      all,
      sort_by,
      sort_order,
    };

    if (filters) {
      params.filters =
        typeof filters === "string" ? filters : JSON.stringify(filters);
    } else {
      // fallback for old-style params
      if (service_tag) params.service_tag = service_tag;
      if (from_location_id) params.from_location_id = from_location_id;
      if (to_location_id) params.to_location_id = to_location_id;
      if (moved_by_id) params.moved_by_id = moved_by_id;
    }

    const qs = buildQueryString(params);
    return fetchJSON(`/systems/history${qs}`);
  };

  const getHistoryById = (id) => fetchJSON(`/systems/history/${id}`);
  const getSystem = (tag) => fetchJSON(`/systems/${tag}`);
  const getSystemHistory = (tag) => fetchJSON(`/systems/${tag}/history`);
  const getServerTime = async () => {
    const res = await fetchJSON(`/server/time`);
    return { ...res, utcOffset: getServerUTCOffset(res.localtime) };
  };

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

  const moveSystemToReceived = async (service_tag, issue, note) => {
    // First fetch: move system
    const updateLocation = await fetchJSON(`/systems/${service_tag}/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to_location_id: 1,
        note: `Moving back to processed from Inactive - ${note}`,
      }),
    });

    // Second fetch: update location in systems
    const updateIssue = await fetchJSON(`/systems/${service_tag}/issue`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issue: issue,
      }),
    });

    return { updateLocation, updateIssue };
  };

  const getSnapshot = ({ date, locations, includeNote = false } = {}) => {
    if (!date) throw new Error("getSnapshot requires a `date` parameter");

    const params = { date };

    if (locations) {
      params.locations = Array.isArray(locations)
        ? locations.join(",")
        : locations;
    }

    // Add the toggle (use `includeNote` to match backend)
    params.includeNote = includeNote ? "true" : "false";

    const qs = buildQueryString(params);
    return fetchJSON(`/systems/snapshot${qs}`);
  };

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
    moveSystemToReceived,
    getHistoryById,
    getServerTime,
    getSnapshot,
  };
}

export default useApi;
