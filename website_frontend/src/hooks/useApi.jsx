import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

const BASE_URL = import.meta.env.VITE_BACKEND_URL;

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

    let data = null;
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      // Extract the error message from JSON or text
      const errMsg =
        (data && typeof data === "object" && data.error) ||
        (data && typeof data === "string" && data) ||
        res.statusText;

      const error = new Error(
        `API ${endpoint} failed: ${res.status} ${errMsg}`
      );
      error.status = res.status;
      error.body = data;
      throw error;
    }

    // Handle no content
    if (res.status === 204) return null;
    return data;
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

  // inside your useApi() module, alongside updateSystemLocation, etc.

  const updateSystemRootCause = (serviceTag, payload) => {
    const { root_cause_id, root_cause_sub_category_id } = payload ?? {};

    const bothProvided =
      root_cause_id != null && root_cause_sub_category_id != null;
    const bothNull =
      root_cause_id === null && root_cause_sub_category_id === null;

    if (!(bothProvided || bothNull)) {
      return Promise.reject(
        new Error(
          "Provide both root_cause_id and root_cause_sub_category_id, or set both to null."
        )
      );
    }

    return fetchJSON(`/systems/${encodeURIComponent(serviceTag)}/root-cause`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root_cause_id,
        root_cause_sub_category_id,
      }),
    });
  };

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

  const updateStation = (stationName, payload) => {
    console.log("PATCH /stations/" + stationName + " payload", payload);

    return fetchJSON(`/stations/${encodeURIComponent(stationName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

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
        note: `Moving back to received from Inactive with issue "${issue}"`,
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

  const getSnapshot = ({
    date,
    locations,
    includeNote = false,
    noCache = false,
  } = {}) => {
    if (!date) throw new Error("getSnapshot requires a `date` parameter");

    const params = { date };

    if (locations) {
      params.locations = Array.isArray(locations)
        ? locations.join(",")
        : locations;
    }

    params.includeNote = includeNote ? "true" : "false";
    params.noCache = noCache ? "true" : "false";

    const qs = buildQueryString(params);
    return fetchJSON(`/systems/snapshot${qs}`);
  };

  /**
   * Update the PPID of a system
   * @param {string} tag - service_tag
   * @param {string} ppid - full PPID string
   */
  const updateSystemPPID = (tag, ppid) =>
    fetchJSON(`/systems/${tag}/ppid`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ppid }),
    });

  const getSystemPallet = (service_tag) =>
    fetchJSON(`/systems/${service_tag}/pallet`);

  const getSystemPalletHistory = (service_tag) =>
    fetchJSON(`/systems/${service_tag}/pallet-history`);

  const moveSystemBetweenPallets = ({
    service_tag,
    from_pallet_number,
    to_pallet_number,
  }) =>
    fetchJSON(`/pallets/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_tag,
        from_pallet_number,
        to_pallet_number,
      }),
    });

  const releasePallet = (pallet_number, doa_number) =>
    fetchJSON(`/pallets/${pallet_number}/release`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doa_number }),
    });

  const deletePallet = (pallet_number) =>
    fetchJSON(`/pallets/${pallet_number}`, {
      method: "DELETE",
    });

  const getPallets = ({
    filters, // advanced filters JSON string or object
    pallet_number,
    factory_id,
    dpn,
    status,
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
      // fallback legacy filter support
      if (pallet_number) params.pallet_number = pallet_number;
      if (factory_id) params.factory_id = factory_id;
      if (dpn) params.dpn = dpn;
      if (status) params.status = status;
    }

    const qs = buildQueryString(params);
    return fetchJSON(`/pallets${qs}`);
  };

  const getPallet = (pallet_number) =>
    fetchJSON(`/pallets/${encodeURIComponent(pallet_number)}`);

  // PATCH /api/v1/pallets/:pallet_number/lock  { locked: boolean }
  const setPalletLock = (pallet_number, locked) =>
    fetchJSON(`/pallets/${encodeURIComponent(pallet_number)}/lock`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked }),
    });

  const createPallet = ({ dpn, factory_code }) =>
    fetchJSON(`/pallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dpn, factory_code }),
    });

  const getDpns = () => fetchJSON(`/systems/dpn`);

  const createDpn = ({ name, config }) =>
    fetchJSON(`/systems/dpn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        config: (config ?? "").trim() || null,
      }),
    });

  const updateDpn = (id, payload) =>
    fetchJSON(`/systems/dpn/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), // { name?, config? }
    });

  const deleteDpn = (id) =>
    fetchJSON(`/systems/dpn/${encodeURIComponent(id)}`, { method: "DELETE" });

  // Factory API
  const getFactories = () => fetchJSON(`/systems/factory`);

  const createFactory = ({ name, code, ppid_code }) =>
    fetchJSON(`/systems/factory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        code: code.trim(),
        ppid_code: ppid_code?.trim() || null,
      }),
    });

  const updateFactory = (id, payload) =>
    fetchJSON(`/systems/factory/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), // { name?, code?, ppid_code? }
    });

  const deleteFactory = (id) =>
    fetchJSON(`/systems/factory/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

  // Part Categories API
  const getPartCategories = ({ q } = {}) =>
    fetchJSON(
      `/systems/part-category${q ? `?q=${encodeURIComponent(q)}` : ""}`
    );

  const createPartCategory = ({ name }) =>
    fetchJSON(`/systems/part-category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: String(name || "").trim() }),
    });

  const updatePartCategory = (id, payload) =>
    fetchJSON(`/systems/part-category/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), // { name? }
    });

  const deletePartCategory = (id) =>
    fetchJSON(`/systems/part-category/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

  // Parts
  const getParts = ({ q, category_id } = {}) => {
    const qs = [];
    if (q) qs.push(`q=${encodeURIComponent(q)}`);
    if (category_id) qs.push(`category_id=${encodeURIComponent(category_id)}`);
    const suffix = qs.length ? `?${qs.join("&")}` : "";
    return fetchJSON(`/systems/part${suffix}`);
  };

  const createPart = ({ name, part_category_id }) =>
    fetchJSON(`/systems/part`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(name || "").trim(),
        part_category_id: part_category_id || null,
      }),
    });

  const updatePart = (id, payload) =>
    fetchJSON(`/systems/part/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), // { name?, part_category_id? }
    });

  const deletePart = (id) =>
    fetchJSON(`/systems/part/${encodeURIComponent(id)}`, { method: "DELETE" });

  const getMe = () => fetchJSON(`/auth/me`);

  const getUsers = ({ page, page_size, search, is_admin } = {}) => {
    const qs = buildQueryString({ page, page_size, search, is_admin });
    return fetchJSON(`/auth/users${qs}`);
  };

  const setUserAdmin = (username, isAdmin) =>
    fetchJSON(`/auth/users/${encodeURIComponent(username)}/admin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin: !!isAdmin }),
    });

  // tiny convenience wrappers
  const lockPallet = (pallet_number) => setPalletLock(pallet_number, true);
  const unlockPallet = (pallet_number) => setPalletLock(pallet_number, false);

  // List physical part items (inventory + in-unit)
  // Supported filters:
  // {
  //   q,                                 // text search (part_name or PPID)
  //   place,                             // 'inventory' | 'unit' | string[] for multi
  //   is_functional,                     // boolean | 'true' | 'false'
  //   part_id,                           // number | string
  //   part_name,                         // string
  //   part_category_id,                  // number | string
  //   part_category_name,                // string
  //   unit_id,                           // number | string
  //   unit_service_tag                   // string
  // }
  const getPartItems = async (params = {}) => {
    const qs = new URLSearchParams();

    const add = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      if (Array.isArray(v)) {
        v.forEach((item) => add(k, item));
      } else {
        qs.append(k, String(v));
      }
    };

    // Normalize booleans explicitly
    const normalizeBool = (v) => {
      if (typeof v === "boolean") return v ? "true" : "false";
      if (v === "true" || v === "false") return v;
      return undefined;
    };

    const {
      q,
      place,
      is_functional,
      part_id,
      part_name,
      part_category_id,
      part_category_name,
      unit_id,
      unit_service_tag,
    } = params;

    add("q", q);
    add("part_id", part_id);
    add("part_name", part_name);
    add("part_category_id", part_category_id);
    add("part_category_name", part_category_name);
    add("unit_id", unit_id);
    add("unit_service_tag", unit_service_tag);

    // allow single or array for place
    add("place", place);

    // normalize boolean to "true"/"false"
    const isFuncStr = normalizeBool(is_functional);
    if (isFuncStr !== undefined) add("is_functional", isFuncStr);

    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return fetchJSON(`/parts/${suffix}`);
  };

  // Read one by PPID
  const getPartItem = async (ppid) =>
    fetchJSON(`/parts/${encodeURIComponent(String(ppid).toUpperCase())}`);

  // Create by PPID in path
  // payload = { part_id, place='inventory', unit_id, is_functional=true }
  const createPartItem = async (ppid, payload) =>
    fetchJSON(`/parts/${encodeURIComponent(String(ppid).toUpperCase())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  // Update by PPID in path
  // payload can include: { part_id?, place?, unit_id?, is_functional?, ppid? }  // ppid renames
  const updatePartItem = async (ppid, payload) =>
    fetchJSON(`/parts/${encodeURIComponent(String(ppid).toUpperCase())}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  // Delete by PPID in path
  const deletePartItem = async (ppid) =>
    fetchJSON(`/parts/${encodeURIComponent(String(ppid).toUpperCase())}`, {
      method: "DELETE",
    });

  return {
    getSystems,
    getHistory,
    getSystem,
    getSystemHistory,
    createSystem,
    deleteSystem,
    updateSystemLocation,
    updateSystemRootCause,
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
    updateSystemPPID,
    getSystemPallet,
    getSystemPalletHistory,
    moveSystemBetweenPallets,
    releasePallet,
    deletePallet,
    getPallets,
    getPallet,
    setPalletLock,
    lockPallet,
    unlockPallet,
    createPallet,
    getDpns,
    createDpn,
    updateDpn,
    deleteDpn,
    getFactories,
    createFactory,
    updateFactory,
    deleteFactory,
    getMe,
    getUsers,
    setUserAdmin,
    getParts,
    createPart,
    updatePart,
    deletePart,
    getPartCategories,
    createPartCategory,
    updatePartCategory,
    deletePartCategory,
    getPartItems,
    getPartItem,
    createPartItem,
    updatePartItem,
    deletePartItem,
  };
}

export default useApi;
