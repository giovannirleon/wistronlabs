import React, { useEffect, useState } from "react";
import Flowchart from "../components/Flowchart";
import { useParams } from "react-router-dom";
import SearchContainer from "../components/SearchContainer";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";

import { formatDateHumanReadable } from "../utils/date_format";

function SystemPage() {
  const { serviceTag } = useParams();

  const [history, setHistory] = useState([]);
  const [system, setSystem] = useState(null); // new
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locLoading, setLocLoading] = useState(true);
  const [error, setError] = useState(null);

  const [note, setNote] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [toast, setToast] = useState({ message: "", type: "success" });

  const currentLocation = history[0]?.to_location || ""; // most recent location name

  const isSentToL11 = currentLocation === "Sent to L11";

  const allowedNextLocations = () => {
    if (!locations.length) return [];
    switch (currentLocation) {
      case "Processed":
        return locations.filter((l) => l.name === "In Debug - Wistron");
      case "In Debug - Wistron":
        return locations.filter((l) =>
          ["In L10", "Pending Parts", "In Debug - Nvidia"].includes(l.name)
        );
      case "Pending Parts":
        return locations.filter((l) => l.name === "In Debug - Wistron");
      case "In Debug - Nvidia":
        return locations.filter((l) => l.name === "In Debug - Wistron");
      case "In L10":
        return locations.filter((l) =>
          [
            "In Debug - Wistron",
            "RMA VID",
            "RMA PID",
            "RMA CID",
            "Sent to L11",
          ].includes(l.name)
        );
      default:
        return [];
    }
  };

  const fetchSystem = async () => {
    try {
      const res = await fetch(
        `https://backend.tss.wistronlabs.com:/api/v1/systems/${serviceTag}`
      );
      if (!res.ok) throw new Error("Failed to fetch system");
      const data = await res.json();
      setSystem(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `https://backend.tss.wistronlabs.com:/api/v1/systems/${serviceTag}/history`
      );
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    setLocLoading(true);
    try {
      const res = await fetch(
        `https://backend.tss.wistronlabs.com:/api/v1/locations`
      );
      if (!res.ok) throw new Error("Failed to fetch locations");
      const data = await res.json();
      setLocations(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLocLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchSystem();
    fetchLocations();
  }, [serviceTag]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!toLocationId) return;

    setSubmitting(true);
    try {
      const res = await fetch(
        `https://backend.tss.wistronlabs.com:/api/v1/systems/${serviceTag}/location`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to_location_id: parseInt(toLocationId, 10),
            note,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed to update location");

      setNote("");
      setToLocationId("");
      await fetchHistory(); // reload updated history
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || locLoading) return <p>Loading…</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <>
      <main className="max-w-4xl mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <div>Error: Not able to load content</div>
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

              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow"
              >
                Delete Unit
              </button>
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
                <select
                  value={toLocationId}
                  onChange={(e) => setToLocationId(e.target.value)}
                  disabled={isSentToL11}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"
                >
                  <option value="">-- Select a location --</option>
                  {allowedNextLocations().map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Note:
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note"
                  disabled={isSentToL11}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || isSentToL11}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg shadow disabled:opacity-50 transition"
              >
                {submitting ? "Submitting…" : "Update Location"}
              </button>

              {isSentToL11 && (
                <p className="text-red-600 text-sm mt-2">
                  If you need to work on this system again, you must re-add it
                  through the tracking menu
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
              />
            </div>
          </>
        )}
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg p-8 relative space-y-6">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>

              <h2 className="text-2xl font-semibold text-gray-800">
                Confirm Deletion
              </h2>

              <p className="text-gray-700">
                Are you sure you want to delete this unit? This action cannot be
                undone.
              </p>

              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(
                        `https://backend.tss.wistronlabs.com:/api/v1/systems/${serviceTag}`,
                        { method: "DELETE" }
                      );
                      if (!res.ok) throw new Error("Failed to delete unit");

                      setShowDeleteModal(false);

                      setToast({
                        message: "Unit deleted successfully",
                        type: "success",
                      });
                      setTimeout(
                        () => setToast({ message: "", type: "success" }),
                        3000
                      );

                      // Optionally navigate away or refresh
                      window.location.href = "/tracking";
                    } catch (err) {
                      console.error(err);
                      setToast({
                        message: "Error deleting unit",
                        type: "error",
                      });
                      setTimeout(
                        () => setToast({ message: "", type: "success" }),
                        3000
                      );
                      setShowDeleteModal(false);
                    }
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 shadow-sm"
                >
                  Delete
                </button>
              </div>
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

export default SystemPage;
