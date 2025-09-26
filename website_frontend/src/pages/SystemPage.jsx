import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import Select from "react-select";
import { Link, useLocation } from "react-router-dom";

import { DateTime } from "luxon";

import Flowchart from "../components/Flowchart";
import { useParams } from "react-router-dom";
import SearchContainer from "../components/SearchContainer";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";
import { AuthContext } from "../context/AuthContext.jsx";

import { pdf } from "@react-pdf/renderer";
import usePrintConfirm from "../hooks/usePrintConfirm";
import SystemPDFLabel from "../components/SystemPDFLabel.jsx";
import SystemRMALabel from "../components/SystemRMALabel.jsx";

import Station from "../components/Station.jsx";
import Tooltip from "../components/Tooltip.jsx";

import { formatDateHumanReadable } from "../utils/date_format";
import { allowedNextLocations } from "../helpers/NextAllowedLocations.jsx";

import useApi from "../hooks/useApi";

import useConfirm from "../hooks/useConfirm";
import useToast from "../hooks/useToast.jsx";
import useIsMobile from "../hooks/useIsMobile.jsx";
import useDetailsModal from "../hooks/useDetailsModal.jsx";

function SystemPage() {
  const FRONTEND_URL = import.meta.env.VITE_URL;

  const { serviceTag } = useParams();

  const [history, setHistory] = useState([]);
  const [system, setSystem] = useState(null); // new
  const [locations, setLocations] = useState([]);
  const [stations, setStations] = useState([]); // new

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(null);
  const [formError, setFormError] = useState("");
  //useState(false);

  const [note, setNote] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [selectedStation, setSelectedStation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const [releasedPallets, setreleasedPallets] = useState([]);

  const [tab, setTab] = useState("history");
  const [logsDir, setLogsDir] = useState(""); // e.g. "2025-09-25/"

  const { confirmPrint, ConfirPrintmModal } = usePrintConfirm();

  const currentLocation = history[0]?.to_location || ""; // most recent location name

  const resolvedIDs = [6, 7, 8, 9];

  const resolvedNames = locations
    ?.filter((loc) => resolvedIDs.includes(loc.id))
    .map((loc) => loc.name);

  const isResolved = resolvedNames?.includes(currentLocation);

  const rmaIDs = [6, 7, 8];

  const rmaNames = locations
    ?.filter((loc) => rmaIDs.includes(loc.id))
    .map((loc) => loc.name);

  const isRMA = rmaNames?.includes(currentLocation);

  const { token } = useContext(AuthContext);
  const baseUrl =
    import.meta.env.MODE === "development"
      ? FRONTEND_URL // is "/l10_logs/" in development
      : FRONTEND_URL; // is "/l10_logs/" in production

  const {
    getSystem,
    getLocations,
    getSystemHistory,
    deleteSystem,
    updateSystemLocation,
    deleteLastHistoryEntry,
    getStations,
    updateStation,
    getSystemPallet,
    getPallets,
    getServerTime,
  } = useApi();

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [
        systemsData,
        locationsData,
        historyData,
        stationData,
        releasedPalletsData,
      ] = await Promise.all([
        getSystem(serviceTag),
        getLocations(),
        getSystemHistory(serviceTag),
        getStations(),
        getPallets({
          all: true,
          filters: {
            conditions: [{ field: "status", op: "=", values: ["open"] }],
          },
        }),
      ]);
      setStations(stationData);
      setSystem(systemsData);
      setLocations(locationsData);
      setHistory(historyData); // add link to each history entry
      setreleasedPallets(releasedPalletsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  let selectedStationObj = null;
  if (system?.location === "In L10") {
    selectedStationObj = stations.find(
      (station) => station.system_service_tag === system.service_tag
    );
  } else {
    selectedStationObj = stations.find(
      (station) => station.station_name === selectedStation
    );
  }

  const { openDetails, closeDetails, modal } = useDetailsModal(
    showToast,
    fetchData
  );

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Are you sure you want to delete this unit? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) {
      showToast("Deletion cancelled", "info", 3000, "bottom-right");
      return;
    }

    try {
      if (selectedStationObj && system?.location === "In L10") {
        await updateStation(selectedStationObj.station_name, {
          system_id: null, // clear system_id when moving out of L10
        });
        setSelectedStation(""); // reset selected station after deletion
      }

      await deleteSystem(serviceTag);

      showToast("Unit deleted successfully", "success", 3000, "bottom-right");
      navigate("/tracking"); // redirect to tracking page
    } catch (err) {
      console.error(err);
      console.log("Error deleting unit:", err);
      showToast("Error deleting unit", "error", 3000, "bottom-right");
    }
  };

  const handleDeleteLastHistoryEntry = async () => {
    if (history.length === 1) {
      showToast(
        "Cannot delete the first location entry",
        "error",
        3000,
        "bottom-right"
      );
      return;
    }
    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Are you sure you want to delete the last location entry? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600 text-white hover:bg-red-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });
    if (!confirmed) {
      showToast("Deletion cancelled", "info", 3000, "bottom-right");
      return;
    }
    try {
      await deleteLastHistoryEntry(serviceTag);

      // If the last entry was "In L10", clear the system_id in the station as well
      if (selectedStationObj && system?.location === "In L10") {
        await updateStation(selectedStationObj.station_name, {
          system_id: null, // clear system_id when moving out of L10
        });
        setSelectedStation(""); // reset selected station after deletion
      }

      showToast("Last location entry deleted", "success", 3000, "bottom-right");
      fetchData(); // reload history after deletion
      // Optionally, you can also update the state directly if needed
      //setHistory((prev) => prev.slice(0, -1)); // remove last entry from state
    } catch (err) {
      console.error(err.response);
      showToast(
        "Error deleting last location entry",
        "error",
        3000,
        "bottom-right"
      );
    }
  };

  useEffect(() => {
    // fetch downloads once
    const fetchDownloads = async () => {
      try {
        const { zone: serverZone = "UTC" } = await getServerTime();

        const dirPart = logsDir
          ? logsDir.replace(/^\//, "").replace(/\/?$/, "/")
          : "";
        const root = `${baseUrl.replace(/\/$/, "")}/l10_logs/${serviceTag}/`;
        const link = root + dirPart;
        const res = await fetch(link);
        const text = await res.text();
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(text, "text/html");
        const rows = htmlDoc.querySelectorAll("tr");
        const entries = [];
        rows.forEach((row, rowIndex) => {
          if (rowIndex >= 3 && rowIndex < rows.length - 1) {
            let rawDate = "";
            let name = "";
            let href = "";
            const cols = row.querySelectorAll("td");
            cols.forEach((col, colIndex) => {
              // get folder name and href
              if (colIndex == 1) {
                name = Array.from(col.querySelectorAll("a"))[0]
                  .textContent.trim()
                  .replace(/\/$/, "");
                href = Array.from(col.querySelectorAll("a"))[0].getAttribute(
                  "href"
                );
                if (href === "../") return; // skip parent directory row
              }

              // get raw date data
              if (colIndex == 2) {
                rawDate = col.textContent.trim();
              }
            });

            const modLux = DateTime.fromFormat(rawDate, "yyyy-LL-dd HH:mm:ss", {
              zone: "utc",
            }).isValid
              ? DateTime.fromFormat(rawDate, "yyyy-LL-dd HH:mm:ss", {
                  zone: "utc",
                })
              : DateTime.fromFormat(rawDate, "yyyy-LL-dd HH:mm", {
                  zone: "utc",
                });

            const formattedDate = modLux.isValid
              ? formatDateHumanReadable(
                  new Date(modLux.setZone(serverZone).toISO())
                )
              : rawDate; // fallback if parsing fails

            const nameLux = DateTime.fromISO(name, { zone: "utc" });
            const nameLocal = nameLux.isValid
              ? formatDateHumanReadable(
                  new Date(nameLux.setZone(serverZone).toISO())
                )
              : name;
            //push entry
            entries.push({
              name: `L10 test ran on ${nameLocal}`,
              href: new URL(href, link).href, // RESOLVE robustly (handles absolute or relative)
              name_title: "File Name",
              date: formattedDate,
              date_title: "Date Modified",
            });
          }
        });
        setDownloads(entries);
      } catch (err) {
        console.error("Failed to fetch downloads:", err);
      }
    };
    fetchDownloads();
  }, [baseUrl, serviceTag, logsDir]);

  useEffect(() => {
    fetchData();
  }, [serviceTag]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const toId = Number.parseInt(toLocationId, 10);

    if (!toId || note.trim() === "" || (toId === 5 && !selectedStation)) {
      setFormError("You must fill out all fields.");
      return;
    }

    if (selectedStationObj && toId === 5 && selectedStationObj.system_id) {
      setFormError("This station is already occupied.");
      return;
    }

    setFormError("");
    setSubmitting(true);

    try {
      // ⬅️ Backend now returns { message, pallet_number?, dpn?, factory_code? } when moving into RMA
      const resp = await updateSystemLocation(serviceTag, {
        to_location_id: toId,
        note,
      });

      // ✅ Update station mapping
      if (selectedStationObj && toId === 5) {
        await updateStation(selectedStationObj.station_name, {
          system_id: system.id,
        });
      }

      if (selectedStationObj && system?.location === "In L10") {
        await updateStation(selectedStationObj.station_name, {
          system_id: null,
        });
      }

      // ✅ If RMA destination, print RMA label (prefer backend response)
      if (RMA_LOCATION_IDS.includes(toId)) {
        // Prefer values from response; fall back to current system or a single read of getSystemPallet()
        let palletNumber = resp?.pallet_number || null;
        let dpn = resp?.dpn ?? system?.dpn ?? null;
        let factoryCode = resp?.factory_code ?? system?.factory_code ?? null;

        if (!palletNumber || !dpn || !factoryCode) {
          try {
            const palletInfo = await getSystemPallet(system.service_tag);
            palletNumber = palletNumber || palletInfo?.pallet_number || null;
            dpn = dpn ?? palletInfo?.dpn ?? null;
            factoryCode = factoryCode ?? palletInfo?.factory_code ?? null;
          } catch {
            // ignore — we’ll handle the “no palletNumber” case below
          }
        }

        if (palletNumber) {
          const blob = await pdf(
            <SystemRMALabel
              systems={[
                {
                  service_tag: system.service_tag,
                  pallet_number: palletNumber,
                  dpn,
                  factory_code: factoryCode,
                  url: `${FRONTEND_URL}${serviceTag}`,
                  // You just moved it; avoid stale system.location:
                  location: "RMA",
                },
              ]}
            />
          ).toBlob();

          const url = URL.createObjectURL(blob);
          window.open(url);
        } else {
          showToast(
            "Moved to RMA, but pallet number isn’t available yet. Check backend logs.",
            "error",
            4000,
            "bottom-right"
          );
        }
      }

      setNote("");
      setToLocationId("");
      setSelectedStation("");
      showToast("Updated System Location", "success", 3000, "bottom-right");
      await fetchData();
    } catch (err) {
      console.error(err);
      const message = err.body?.error || err.message;
      showToast(message, "error", 3000, "bottom-right");
    } finally {
      setSubmitting(false);
    }
  };

  const RMA_LOCATION_IDS = [6, 7, 8];

  const handlePrint = async () => {
    const locationId = locations.find((l) => l.name === currentLocation)?.id;

    let labelType = "id";
    let palletInfo = [];
    if (RMA_LOCATION_IDS.includes(locationId)) {
      console.log("in RMA");
      const selected = await confirmPrint(); // "id" or "rma"
      if (!selected) return; // user exited
      labelType = selected;
      palletInfo = await getSystemPallet(system.service_tag);
    }
    const blob = await pdf(
      labelType === "id" ? (
        <SystemPDFLabel
          systems={[
            {
              service_tag: system.service_tag,
              url: `${FRONTEND_URL}${system.service_tag}`,
            },
          ]}
        />
      ) : (
        <SystemRMALabel
          systems={[
            {
              service_tag: system.service_tag,
              pallet_number: palletInfo.pallet_number,
              dpn: palletInfo.dpn,
              factory_code: palletInfo.factory_code,
              url: `${FRONTEND_URL}${system.service_tag}`,
              location: system.location,
            },
          ]}
        />
      )
    ).toBlob();

    const url = URL.createObjectURL(blob);
    window.open(url);
  };

  const handleDetails = () => {
    if (system) {
      openDetails({
        service_tag: system.service_tag,
        dpn: system.dpn,
        manufactured_date: system.manufactured_date,
        serial: system.serial,
        rev: system.rev,
        factory_code: system.factory_code,
        factory_name: system.factory_name,
      });
    }
  };

  // Fetch stations every second
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updatedStations = await getStations();
        setStations(updatedStations);
      } catch (err) {
        console.error("Failed to fetch stations:", err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isResolved) {
      setFormError(
        "If you need to work on this system again, you must re-add it through the tracking menu"
      );
    } else {
      setFormError(""); // or null
    }
  }, [isResolved]);

  const target = serviceTag.trim().toUpperCase();

  const isInPalletNumber =
    releasedPallets.find((p) =>
      p.active_systems?.some(
        (s) => (s.service_tag || "").toUpperCase() === target
      )
    )?.pallet_number ?? null;

  return (
    <>
      <ConfirmDialog />
      {modal}
      <Toast />
      <ConfirPrintmModal />
      <main className="md:max-w-10/12  mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <>
            {" "}
            <h1 className="text-3xl font-bold text-gray-800 justify-center mb-4">
              Error 404:{" "}
              <span className="text-blue-600">
                {serviceTag} does not exist :(
              </span>
            </h1>
            <LoadingSkeleton rows={6} />
          </>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
                  Service Tag{" "}
                  <span className="text-blue-600">{serviceTag}</span>
                </h1>
                <span>
                  {system?.config && (
                    <span className="mr-2 inline-block mt-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs sm:text-sm font-bold rounded-full uppercase">
                      Config {system.config}
                    </span>
                  )}
                  {system?.issue && (
                    <span className="inline-block mt-1 px-2 py-1 bg-red-100 text-red-800 text-xs sm:text-sm font-bold rounded-full uppercase">
                      {system.issue}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  className="bg-green-600 hover:bg-green-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow"
                  onClick={handlePrint}
                >
                  Print Label
                </button>
                <button
                  type="button"
                  className="bg-gray-600 hover:bg-gray-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow"
                  onClick={() => openDetails(system)}
                >
                  Details
                </button>
                <Tooltip
                  text="Please log in to delete a unit"
                  position="botom"
                  show={!token == true}
                >
                  <button
                    type="button"
                    onClick={handleDelete}
                    className={`bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow ${
                      !token ? "opacity-30 pointer-events-none" : ""
                    }`}
                  >
                    Delete Unit
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="max-w-3/4 2xl:max-w-5/8 mx-auto overflow-x-auto">
              <Flowchart
                currentLocation_id={
                  locations.find((l) => l.name === currentLocation)?.id || 1
                }
                locations={locations}
              />
            </div>

            <form
              onSubmit={handleSubmit}
              className={`relative p-6 bg-gray-50 rounded-xl shadow-inner flex flex-col gap-6 ${
                !token ? "opacity-70 pointer-events-none" : ""
              }`}
            >
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Current Location:
                </label>
                <p className="text-gray-800 font-semibold">
                  {currentLocation || "Unknown"}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  New Location:
                </label>

                <div className="flex flex-wrap gap-3">
                  {allowedNextLocations(currentLocation, locations).map(
                    (loc) => (
                      <button
                        type="button"
                        key={loc.id}
                        disabled={isResolved}
                        onClick={() => setToLocationId(loc.id)}
                        className={`px-4 py-2 rounded-lg shadow text-sm font-medium border
                  ${
                    toLocationId === loc.id
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                  }
          ${isResolved ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        {loc.name}
                      </button>
                    )
                  )}
                  {isResolved && (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg shadow text-sm font-medium bg-gray-200 text-gray-700 border-gray-300"
                    >
                      None Available
                    </button>
                  )}
                </div>

                {toLocationId === "" ? (
                  <p className="text-xs text-gray-500 mt-1">
                    Please select a location above.
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">
                    Please select a location above.
                  </p>
                )}

                {(toLocationId === 5 || system?.location === "In L10") && (
                  <div className="mt-5 flex flex-col lg:flex-row gap-4">
                    {/* Table on the left */}
                    <div className="w-full lg:w-3/5">
                      <table className="w-full bg-white rounded shadow-sm overflow-hidden border-collapse">
                        <thead>
                          <tr>
                            <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3">
                              Station
                            </th>
                            <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3">
                              Status
                            </th>
                            <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3">
                              Service Tag
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <Station
                            stationInfo={
                              selectedStationObj || {
                                station: "Stn #",
                                status: 0,
                                message: "Please select a station",
                              }
                            }
                          />
                        </tbody>
                      </table>
                    </div>

                    {/* Dropdown on the right */}
                    <div className="w-full lg:w-2/5">
                      <label
                        htmlFor="extra-options"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Select a Station
                      </label>
                      <div
                        className={
                          system?.location === "In L10"
                            ? "opacity-50 pointer-events-none"
                            : ""
                        }
                      >
                        <Select
                          instanceId="extra-options"
                          className="react-select-container"
                          classNamePrefix="react-select"
                          isClearable
                          isSearchable
                          placeholder="Select a station"
                          value={
                            stations
                              .map((station) => ({
                                value: station.station_name,
                                label: "Station " + station.station_name,
                              }))
                              .find((opt) => opt.value === selectedStation) ||
                            null
                          }
                          onChange={(option) =>
                            setSelectedStation(option ? option.value : "")
                          }
                          options={stations.map((station) => ({
                            value: station.station_name,
                            label: "Station " + station.station_name,
                          }))}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Note:
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Required Note"
                  disabled={isResolved}
                  rows={3} // adjust number of visible rows
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || isResolved}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg shadow disabled:opacity-50 transition"
              >
                {submitting ? "Submitting…" : "Update Location"}
              </button>

              {isRMA ? (
                isInPalletNumber ? (
                  <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-2 mt-5 rounded">
                    This system has been RMA'd but has not shipped yet, you can
                    view it on pallet
                    <Link className="hover:underline" to="/shipping">
                      {" "}
                      {isInPalletNumber}
                    </Link>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 mt-5 rounded">
                    This system has been RMA'd and has shipped back to the L10
                    factory.
                    <Link className="hover:underline" to="/shipping">
                      {" "}
                      {isInPalletNumber}
                    </Link>
                  </div>
                )
              ) : (
                <></>
              )}
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
                  {formError}
                </div>
              )}
            </form>
            <div>
              {/* Tabs */}
              <div className="flex gap-4 mt-2 border-b border-gray-200">
                <button
                  onClick={() => setTab("history")}
                  className={`px-4 py-2 -mb-px  border-b-2 text-3xl font-bold ${
                    tab === "history"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Location History
                </button>
                <button
                  onClick={() => setTab("logs")}
                  className={`px-4 py-2 -mb-px  border-b-2 text-3xl font-bold ${
                    tab === "logs"
                      ? "border-blue-600 text-blue-600 "
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Logs
                </button>
              </div>

              {tab === "history" ? (
                <>
                  <SearchContainer
                    data={history.map((entry) => ({
                      ...entry,
                      from_location_title: "From",
                      to_location_title: "To",
                      note_title: "Note",
                      changed_at_title: "Updated At",
                      changed_at: formatDateHumanReadable(entry.changed_at),
                      moved_by_title: "Moved By",
                      moved_by:
                        entry.moved_by === "deleted_user@example.com"
                          ? "Unknown"
                          : entry.moved_by,
                      link: `locationHistory/${entry.id}`, // add link to each history entry
                    }))}
                    title=""
                    displayOrder={[
                      "to_location",
                      "note",
                      "moved_by",
                      "changed_at",
                    ]}
                    visibleFields={
                      isMobile
                        ? ["to_location", "note", "moved_by"]
                        : ["to_location", "note", "moved_by", "changed_at"]
                    }
                    defaultSortBy={"changed_at"}
                    defaultSortAsc={true}
                    fieldStyles={{
                      to_location: (val) =>
                        val === "Sent to L11" ||
                        val === "RMA CID" ||
                        val === "RMA VID" ||
                        val === "RMA PID"
                          ? {
                              type: "pill",
                              color: "bg-green-100 text-green-800",
                            }
                          : val === "Received" ||
                            val === "In Debug - Wistron" ||
                            val === "In L10"
                          ? { type: "pill", color: "bg-red-100 text-red-800" }
                          : {
                              type: "pill",
                              color: "bg-yellow-100 text-yellow-800",
                            },
                      from_location: (val) =>
                        val === "Sent to L11" ||
                        val === "RMA CID" ||
                        val === "RMA VID" ||
                        val === "RMA PID"
                          ? {
                              type: "pill",
                              color: "bg-green-100 text-green-800",
                            }
                          : val === "Received" ||
                            val === "In Debug - Wistron" ||
                            val === "In L10"
                          ? { type: "pill", color: "bg-red-100 text-red-800" }
                          : {
                              type: "pill",
                              color: "bg-yellow-100 text-yellow-800",
                            },
                      note: (val) =>
                        val?.includes(
                          "Moving back to received from Inactive"
                        ) ||
                        val?.includes("Moving back to processed from Inactive")
                          ? "font-semibold"
                          : "",
                    }}
                    linkType={isMobile ? "internal" : "none"}
                    allowSort={false}
                    allowSearch={false}
                    defaultPage="last"
                    truncate={isMobile ?? true}
                    onAction={handleDeleteLastHistoryEntry}
                    actionButtonClass={
                      "ml-2 text-xs text-grey-200 hover:text-red-400"
                    }
                    actionButtonVisibleIf={{
                      field: "changed_at",
                      equals: formatDateHumanReadable(history[0]?.changed_at), // only show action button for the most recent entry
                    }}
                  />
                </>
              ) : (
                <>
                  <SearchContainer
                    data={downloads}
                    displayOrder={["name", "date"]}
                    defaultSortBy={"date"}
                    defaultSortAsc={false}
                    fieldStyles={{
                      name: "text-blue-600 font-medium",
                      date: "text-gray-500 text-sm",
                    }}
                    linkType="external"
                    visibleFields={
                      isMobile ? ["name", "date"] : ["name", "date"]
                    }
                    allowSearch={false}
                    rootHref={`${baseUrl.replace(
                      /\/$/,
                      ""
                    )}/l10_logs/${serviceTag}/`}
                    currentDir={logsDir}
                    onDirChange={setLogsDir}
                  />
                </>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}

export default SystemPage;
