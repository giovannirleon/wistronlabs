import React, { useState, useEffect } from "react";
import SearchContainer from "../components/SearchContainer";
import SystemsCreatedChart from "../components/SystemsCreatedChart.jsx";

import { formatDateHumanReadable } from "../utils/date_format.js"; // Assuming you have a utility function for date formatting

function TrackingPage() {
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "success" });
  const [locations, setLocations] = useState([]);
  const [history, setHistory] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);

  const [showActive, setShowActive] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const fetchSystems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://tss.wistronlabs.com:4000/api/v1/systems");
      if (!res.ok) throw new Error("Failed to fetch systems");
      const data = await res.json();

      const enriched = await Promise.all(
        data.map(async (system) => {
          const serviceTag = system.service_tag;
          try {
            const historyRes = await fetch(
              `http://tss.wistronlabs.com:4000/api/v1/systems/${serviceTag}/history`
            );
            if (!historyRes.ok) throw new Error("History fetch failed");
            const history = await historyRes.json();

            const createdEntry = history.find(
              (entry) => entry.from_location === null
            );
            const latestEntry = history.reduce((latest, entry) =>
              new Date(entry.changed_at) > new Date(latest.changed_at)
                ? entry
                : latest
            );

            return {
              ...system,
              date_created: createdEntry?.changed_at
                ? formatDateHumanReadable(createdEntry.changed_at)
                : "",
              date_last_modified: latestEntry?.changed_at
                ? formatDateHumanReadable(latestEntry.changed_at)
                : "",
              service_tag_title: "Service Tag",
              issue_title: "Issue",
              location_title: "Location",
              date_created_title: "Date Created",
              date_last_modified_title: "Date Last Modified",
            };
          } catch {
            return system;
          }
        })
      );

      setSystems(enriched);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError(err.message);
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    try {
      const res = await fetch(
        "http://tss.wistronlabs.com:4000/api/v1/locations"
      );
      if (!res.ok) throw new Error("Failed to fetch locations");
      const data = await res.json();
      setLocations(data);
    } catch (err) {
      console.error("Error fetching locations", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(
        "http://tss.wistronlabs.com:4000/api/v1/systems/history"
      );
      if (!res.ok) throw new Error("Failed to fetch locations");
      const data = await res.json();

      // Convert changed_at to human-readable format
      const fixedLocalDateData = data.map((entry) => ({
        ...entry,
        changed_at: formatDateHumanReadable(entry.changed_at),
      }));

      setHistory(fixedLocalDateData);
    } catch (err) {
      console.error("Error fetching history", err);
    }
  };

  useEffect(() => {
    fetchSystems();
    fetchLocations();
    fetchHistory();
    //const interval = setInterval(fetchSystems, 1000);
  }, []);

  const resolvedSystems = systems.map((sys) => {
    const matched = locations.find((loc) => loc.name === sys.location);
    return {
      ...sys,
      resolved_location_id: matched ? matched.id : null,
    };
  });

  const filteredSystems = resolvedSystems.filter((sys) => {
    const isActive = [1, 2, 3, 4, 5].includes(sys.resolved_location_id);

    if (showActive && isActive) return true;
    if (showInactive && !isActive) return true;

    return false;
  });

  return (
    <>
      <main className="max-w-6xl mx-auto mt-8 bg-white rounded-xl shadow border border-gray-200 p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h1 className="text-3xl font-semibold text-gray-800">Systems</h1>

          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            + New System
          </button>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="animate-pulse flex space-x-4 rounded-lg border border-gray-200 p-4"
              >
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div>error</div>
        ) : (
          <div>
            <SystemsCreatedChart
              systems={systems}
              history={history}
              locations={locations}
            />

            {/* Filters */}
            <div className="flex flex-wrap justify-end gap-4 mb-2 mt-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showActive}
                  onChange={() => {
                    if (showActive && !showInactive) return;
                    setShowActive(!showActive);
                  }}
                  className="accent-blue-600"
                />
                Active
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={() => {
                    if (!showActive && showInactive) return;
                    setShowInactive(!showInactive);
                  }}
                  className="accent-blue-600"
                />
                Inactive
              </label>
            </div>

            {/* Data Table */}
            <SearchContainer
              data={filteredSystems}
              title=""
              displayOrder={[
                "service_tag",
                "issue",
                "location",
                "date_created",
                "date_last_modified",
              ]}
              defaultSortBy="date_last_modified"
              defaultSortAsc={false}
              fieldStyles={{
                service_tag: "text-blue-600 font-medium",
                date_last_modified: "text-gray-500 text-sm",
                date_created: "text-gray-500 text-sm",
                //issue: { type: "pill", color: "bg-green-100 text-green-800" },
                location: (val) =>
                  val === "Sent to L11" ||
                  val === "RMA CID" ||
                  val === "RMA VID" ||
                  val === "RMA PID"
                    ? { type: "pill", color: "bg-green-100 text-green-800" }
                    : val === "Processed" ||
                      val === "In Debug - Wistron" ||
                      val === "In L10"
                    ? { type: "pill", color: "bg-red-100 text-red-800" }
                    : { type: "pill", color: "bg-yellow-100 text-yellow-800" },
              }}
              linkType="internal"
            />
          </div>
        )}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg p-8 relative space-y-6">
              <button
                onClick={() => setShowModal(false)}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>

              <h2 className="text-2xl font-semibold text-gray-800">
                Add System
              </h2>

              {/* Bulk toggle */}
              <div className="flex space-x-2">
                <button
                  onClick={() => setBulkMode(false)}
                  className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
                    !bulkMode
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Single
                </button>
                <button
                  onClick={() => setBulkMode(true)}
                  className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
                    bulkMode
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Bulk CSV
                </button>
              </div>

              <form
                className="space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target);

                  if (!bulkMode) {
                    const service_tag = formData.get("service_tag")?.trim();
                    const issue = formData.get("issue")?.trim();
                    const note = formData.get("note")?.trim() || null;

                    if (!service_tag || !issue || !note) {
                      setToast({
                        message: "Please fill in all required fields properly.",
                        type: "error",
                      });
                      setTimeout(
                        () => setToast({ message: "", type: "success" }),
                        3000
                      );

                      return;
                    }

                    const payload = {
                      service_tag,
                      issue,
                      location_id: 1,
                      note,
                    };

                    let moveInactivetoActive = false;
                    resolvedSystems.forEach((sys) => {
                      if (sys.service_tag === service_tag) {
                        const isActive = [1, 2, 3, 4, 5].includes(
                          sys.resolved_location_id
                        );
                        if (!isActive) {
                          moveInactivetoActive = true;
                          console.log("already exists in Inactive");
                          setToast({
                            message: `Service tag ${service_tag} already exists, moving back to processed`,
                            type: "success",
                          });
                          setTimeout(
                            () => setToast({ message: "", type: "success" }),
                            3000
                          );
                        }
                      }
                    });

                    if (moveInactivetoActive) {
                      const jsonRes = {
                        to_location_id: 1,
                        note: "Moving back to processed from Inactive",
                      };
                      try {
                        const res = await fetch(
                          `http://tss.wistronlabs.com:4000/api/v1/systems/${service_tag}/location`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(jsonRes),
                          }
                        );
                        if (!res.ok)
                          throw new Error("Failed to update system location");

                        setShowModal(false);
                        setToast({
                          message: `Service tag ${service_tag} moved back to processed!`,
                          type: "success",
                        });
                        setTimeout(
                          () => setToast({ message: "", type: "success" }),
                          3000
                        );

                        await fetchSystems();
                        setTimeout(() => setToastMessage(""), 3000);
                      } catch (err) {
                        console.error(err);
                        setToast({
                          message: "Error updating system location",
                          type: "error",
                        });
                        setTimeout(
                          () => setToast({ message: "", type: "success" }),
                          3000
                        );
                      }
                    } else {
                      try {
                        const res = await fetch(
                          "http://tss.wistronlabs.com:4000/api/v1/systems",
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload),
                          }
                        );
                        if (!res.ok) throw new Error("Failed to create system");

                        setShowModal(false);
                        setToast({
                          message: "System created successfully!",
                          type: "success",
                        });
                        setTimeout(
                          () => setToast({ message: "", type: "success" }),
                          3000
                        );

                        await fetchSystems();
                        setTimeout(() => setToastMessage(""), 3000);
                      } catch (err) {
                        console.error(err);
                        setToast({
                          message: "Error creating system",
                          type: "error",
                        });
                        setTimeout(
                          () => setToast({ message: "", type: "success" }),
                          3000
                        );
                      }
                    }
                  } else {
                    const csvText = formData.get("bulk_csv")?.trim();
                    if (!csvText) {
                      setToast({
                        message: "Please enter CSV data.",
                        type: "error",
                      });
                      setTimeout(
                        () => setToast({ message: "", type: "success" }),
                        3000
                      );
                      return;
                    }

                    const rows = csvText.split("\n");

                    for (const line of rows) {
                      const [service_tag, issue, note] = line
                        .split(/\t|,/)
                        .map((x) => x.trim());
                      if (!service_tag || !issue) {
                        console.warn(`Skipping invalid line: ${line}`);
                        continue;
                      }

                      const payload = {
                        service_tag,
                        issue,
                        location_id: 1,
                        note: note || null,
                      };

                      let moveInactivetoActive = false;

                      resolvedSystems.forEach((sys) => {
                        if (sys.service_tag === service_tag) {
                          const isActive = [1, 2, 3, 4, 5].includes(
                            sys.resolved_location_id
                          );
                          if (!isActive) {
                            moveInactivetoActive = true;
                            console.log(
                              `Already exists in Inactive: ${service_tag}`
                            );
                            setToast({
                              message: `Service tag ${service_tag} already exists, moving back to processed`,
                              type: "success",
                            });
                            setTimeout(
                              () => setToast({ message: "", type: "success" }),
                              3000
                            );
                          }
                        }
                      });

                      if (moveInactivetoActive) {
                        const jsonRes = {
                          to_location_id: 1,
                          note: "Moving back to processed from Inactive",
                        };
                        try {
                          const res = await fetch(
                            `http://tss.wistronlabs.com:4000/api/v1/systems/${service_tag}/location`,
                            {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(jsonRes),
                            }
                          );
                          if (!res.ok)
                            throw new Error(`Failed to update ${service_tag}`);
                          setToast({
                            message: `Service tag ${service_tag} moved back to processed!`,
                            type: "success",
                          });
                          setTimeout(
                            () => setToast({ message: "", type: "success" }),
                            3000
                          );
                        } catch (err) {
                          console.error(err);
                          setToast({
                            message: `Error updating ${service_tag}`,
                            type: "error",
                          });
                          setTimeout(
                            () => setToast({ message: "", type: "success" }),
                            3000
                          );
                        }
                      } else {
                        try {
                          const res = await fetch(
                            "http://tss.wistronlabs.com:4000/api/v1/systems",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(payload),
                            }
                          );
                          if (!res.ok)
                            throw new Error(`Failed to create ${service_tag}`);
                          setToast({
                            message: `System ${service_tag} created successfully!`,
                            type: "success",
                          });
                          setTimeout(
                            () => setToast({ message: "", type: "success" }),
                            3000
                          );
                        } catch (err) {
                          console.error(err);
                          setToast({
                            message: `Error creating ${service_tag}`,
                            type: "error",
                          });
                          setTimeout(
                            () => setToast({ message: "", type: "success" }),
                            3000
                          );
                        }
                      }
                    }

                    setShowModal(false);
                    await fetchSystems();
                  }
                }}
              >
                {!bulkMode ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Service Tag
                      </label>
                      <input
                        type="text"
                        name="service_tag"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Issue
                      </label>
                      <input
                        type="text"
                        name="issue"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Note
                      </label>
                      <textarea
                        name="note"
                        rows="3"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      ></textarea>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      CSV Input (service_tag,issue,note)
                    </label>
                    <textarea
                      name="bulk_csv"
                      rows="5"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder={`ABC123,Fails POST intermittently,Initial intake\nDEF456,Does not power on,Initial intake`}
                      required
                    ></textarea>
                  </div>
                )}

                <div className="flex justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                  >
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
      {/* Toast */}
      {toast.message && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg
                text-sm font-medium bg-green-600 text-white
                transition-all duration-300 ${
                  toast.type === "error" ? "bg-red-600" : "bg-green-600"
                }`}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}

export default TrackingPage;
