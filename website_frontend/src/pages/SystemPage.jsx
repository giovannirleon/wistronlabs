import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Select from "react-select";

import Flowchart from "../components/Flowchart";
import { useParams } from "react-router-dom";
import SearchContainer from "../components/SearchContainer";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";

import { pdf } from "@react-pdf/renderer";
import SystemPDFLabel from "../components/SystemPDFLabel.jsx";

import Station from "../components/Station.jsx";

import { formatDateHumanReadable } from "../utils/date_format";
import { allowedNextLocations } from "../helpers/NextAllowedLocations.jsx";

import {
  getSystem,
  getLocations,
  getSystemHistory,
  deleteSystem,
  updateSystemLocation,
  deleteLastHistoryEntry,
  getStations,
  updateStation,
} from "../api/apis.js";

import useConfirm from "../hooks/useConfirm";
import useToast from "../hooks/useToast.jsx";

function SystemPage() {
  const { serviceTag } = useParams();

  const [history, setHistory] = useState([]);
  const [system, setSystem] = useState(null); // new
  const [locations, setLocations] = useState([]);
  const [stations, setStations] = useState([]); // new

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(false);

  const [note, setNote] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [selectedStation, setSelectedStation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const currentLocation = history[0]?.to_location || ""; // most recent location name

  const isSentToL11 = currentLocation === "Sent to L11";

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [systemsData, locationsData, historyData, stationData] =
        await Promise.all([
          getSystem(serviceTag),
          getLocations(),
          getSystemHistory(serviceTag),
          getStations(),
        ]);
      setStations(stationData);
      setSystem(systemsData);
      setLocations(locationsData);
      setHistory(historyData);
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
      console.error(err);
      showToast(
        "Error deleting last location entry",
        "error",
        3000,
        "bottom-right"
      );
    }
  };

  useEffect(() => {
    fetchData();
  }, [serviceTag]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!toLocationId || note.trim() === "") {
      setFormError(true);
      return;
    }

    setFormError(false);
    setSubmitting(true);

    try {
      await updateSystemLocation(serviceTag, {
        to_location_id: parseInt(toLocationId, 10),
        note,
      });

      if (selectedStationObj && toLocationId === 5) {
        await updateStation(selectedStationObj.station_name, {
          system_id: system.id,
        });
      }

      if (selectedStationObj && system?.location === "In L10") {
        await updateStation(selectedStationObj.station_name, {
          system_id: null, // clear system_id when moving out of L10
        });
      }

      setNote("");
      setToLocationId("");
      setSelectedStation("");
      showToast("Updated System Location", "success", 3000, "bottom-right");
      await fetchData(); // reload updated history
    } catch (err) {
      console.error(err);
      showToast("Can not update system", "error", 3000, "bottom-right");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = async () => {
    const blob = await pdf(
      <SystemPDFLabel
        systems={[
          {
            service_tag: system.service_tag,
            url: `https://tss.wistronlabs.com/${system.service_tag}`,
          },
        ]} // pass as array
      />
    ).toBlob();
    const url = URL.createObjectURL(blob);
    window.open(url);
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

  console.log(selectedStationObj);
  return (
    <>
      <ConfirmDialog />
      <Toast />
      <main className="max-w-4xl mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
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
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-800">
                  Service Tag{" "}
                  <span className="text-blue-600">{serviceTag}</span>
                </h1>
                {system?.issue && (
                  <span className="inline-block mt-1 px-2 py-1 bg-red-100 text-red-800 text-sm font-bold rounded-full uppercase">
                    {system.issue}
                  </span>
                )}
              </div>
              <div>
                <button
                  type="button"
                  className="bg-green-600 hover:bg-green-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow mr-2"
                  onClick={handlePrint}
                >
                  Print Label
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow"
                >
                  Delete Unit
                </button>
              </div>
            </div>

            <div className="w-full overflow-x-auto">
              <Flowchart
                currentLocation_id={
                  locations.find((l) => l.name === currentLocation)?.id || 1
                }
                locations={locations}
              />
            </div>

            <form
              onSubmit={handleSubmit}
              className="relative p-6 bg-gray-50 rounded-xl shadow-inner flex flex-col gap-6"
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
                        disabled={isSentToL11}
                        onClick={() => setToLocationId(loc.id)}
                        className={`px-4 py-2 rounded-lg shadow text-sm font-medium border
                  ${
                    toLocationId === loc.id
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                  }
          ${isSentToL11 ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        {loc.name}
                      </button>
                    )
                  )}
                  {isSentToL11 && (
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
                  <div className="mt-5 flex gap-4">
                    {/* Table on the left */}
                    <div className="w-3/5">
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
                    <div className="w-50">
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
                  disabled={isSentToL11}
                  rows={3} // adjust number of visible rows
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || isSentToL11}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg shadow disabled:opacity-50 transition"
              >
                {submitting ? "Submitting…" : "Update Location"}
              </button>

              {formError ? (
                <p className="text-red-600 text-sm">
                  You must fill out all fields.
                </p>
              ) : isSentToL11 ? (
                <p className="text-red-600 text-sm">
                  If you need to work on this system again, you must re-add it
                  through the tracking menu
                </p>
              ) : (
                <p className="text-red-600 text-sm invisible">
                  You must fill out all fields.
                </p>
              )}
            </form>
            <div>
              <h1 className="text-3xl font-bold text-gray-800">
                Location History
              </h1>{" "}
              <SearchContainer
                data={history.map((entry) => ({
                  ...entry,
                  from_location_title: "From Location",
                  to_location_title: "To Location",
                  note_title: "Note",
                  changed_at_title: "Updated At",
                  changed_at: formatDateHumanReadable(entry.changed_at),
                }))}
                title=""
                displayOrder={[
                  "from_location",
                  "to_location",
                  "note",
                  "changed_at",
                ]}
                defaultSortBy={"changed_at"}
                defaultSortAsc={true}
                fieldStyles={{
                  to_location: (val) =>
                    val === "Sent to L11" ||
                    val === "RMA CID" ||
                    val === "RMA VID" ||
                    val === "RMA PID"
                      ? { type: "pill", color: "bg-green-100 text-green-800" }
                      : val === "Processed" ||
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
                      ? { type: "pill", color: "bg-green-100 text-green-800" }
                      : val === "Processed" ||
                        val === "In Debug - Wistron" ||
                        val === "In L10"
                      ? { type: "pill", color: "bg-red-100 text-red-800" }
                      : {
                          type: "pill",
                          color: "bg-yellow-100 text-yellow-800",
                        },
                  note: (val) =>
                    val?.includes("Moving back to processed from Inactive")
                      ? "font-bold"
                      : "",
                }}
                linkType="none"
                allowSort={false}
                allowSearch={false}
                defaultPage="last"
                onAction={handleDeleteLastHistoryEntry}
                actionButtonClass={
                  "ml-2 text-xs text-grey-200 hover:text-red-400"
                }
                actionButtonVisibleIf={{
                  field: "changed_at",
                  equals: formatDateHumanReadable(history[0]?.changed_at), // only show action button for the most recent entry
                }}
              />
            </div>
          </>
        )}
      </main>
    </>
  );
}

export default SystemPage;
