import React, { useState, useEffect } from "react";
import SearchContainer from "../components/SearchContainer";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";
import SystemsCreatedChart from "../components/SystemsCreatedChart.jsx";
import SystemLocationsChart from "../components/SystemLocationsChart.jsx";

import { pdf } from "@react-pdf/renderer";
import SystemPDFLabel from "../components/SystemPDFLabel.jsx";

import AddSystemModal from "../components/AddSystemModal.jsx";
import DownloadReportModal from "../components/DownloadReportModal.jsx";

import { formatDateHumanReadable } from "../utils/date_format.js";
import { downloadCSV } from "../utils/csv.js";

import useConfirm from "../hooks/useConfirm";
import useToast from "../hooks/useToast";
import useIsMobile from "../hooks/useIsMobile.jsx";

import {
  getSystems,
  getLocations,
  getHistory,
  createSystem,
  moveSystemToProcessed,
} from "../api/apis.js";

const ACTIVE_LOCATION_IDS = [1, 2, 3, 4, 5];

const REPORT_CUMULATIVE_LOCATIONS = [
  "Processed",
  "In Debug - Wistron",
  "In L10",
  "In Debug - Nvidia",
  "Pending Parts",
];
const REPORT_PERDAY_LOCATIONS = [
  "Sent to L11",
  "RMA VID",
  "RMA PID",
  "RMA CID",
];

function TrackingPage() {
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [locations, setLocations] = useState([]);
  const [history, setHistory] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [reportDate, setReportDate] = useState("");
  const [showActive, setShowActive] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [addSystemFormError, setAddSystemFormError] = useState(false);

  const [reportMode, setReportMode] = useState("perday");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [systemsData, locationsData, historyData] = await Promise.all([
        getSystems(),
        getLocations(),
        getHistory(),
      ]);

      const formattedHistory = historyData.map((entry) => ({
        ...entry,
        changed_at: formatDateHumanReadable(entry.changed_at),
      }));

      const enrichedSystems = await Promise.all(
        systemsData.map(async (system) => {
          try {
            const res = await fetch(
              `https://backend.tss.wistronlabs.com:/api/v1/systems/${system.service_tag}/history`
            );
            if (!res.ok) throw new Error("History fetch failed");
            const history = await res.json();
            const created = history.find((h) => h.from_location === null);
            const latest = history.reduce((a, b) =>
              new Date(a.changed_at) > new Date(b.changed_at) ? a : b
            );

            return {
              ...system,
              date_created: created?.changed_at
                ? formatDateHumanReadable(created.changed_at)
                : "",
              date_last_modified: latest?.changed_at
                ? formatDateHumanReadable(latest.changed_at)
                : "",
              service_tag_title: "Service Tag",
              issue_title: "Issue",
              location_title: "Location",
              date_created_title: "Created",
              date_last_modified_title: "Modified",
            };
          } catch {
            return system;
          }
        })
      );

      setSystems(enrichedSystems);
      setLocations(locationsData);
      setHistory(formattedHistory);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const isMobile = useIsMobile();

  const resolvedSystems = systems.map((sys) => {
    const match = locations.find((l) => l.name === sys.location);
    return { ...sys, resolved_location_id: match?.id || null };
  });

  const filteredSystems = resolvedSystems.filter((sys) => {
    const isActive = ACTIVE_LOCATION_IDS.includes(sys.resolved_location_id);
    return (showActive && isActive) || (showInactive && !isActive);
  });

  async function addOrUpdateSystem(service_tag, issue, note) {
    const payload = { service_tag, issue, location_id: 1, note };
    const inactive = resolvedSystems.find(
      (sys) =>
        sys.service_tag === service_tag &&
        !ACTIVE_LOCATION_IDS.includes(sys.resolved_location_id)
    );

    try {
      if (inactive) {
        const confirmed = await confirm({
          title: "Re-enter System?",
          message: `${service_tag} already exists as inactive. Move it back to processed?`,
          confirmText: "Confirm",
          cancelText: "Cancel",
          confirmClass: "bg-blue-600 text-white hover:bg-blue-700",
          cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
        });
        if (!confirmed) {
          showToast(`Skipped ${service_tag}`, "error", 3000, "top-right");
          return;
        }

        await moveSystemToProcessed(service_tag);
        showToast(
          `${service_tag} moved back to processed`,
          "success",
          3000,
          "top-right"
        );
      } else {
        await createSystem(payload);
        showToast(`${service_tag} created`, "success", 3000, "top-right");
      }

      return true;
    } catch (err) {
      console.error(err);
      showToast(`Error with ${service_tag}`, "error", 3000, "top-right");
      return false;
    }
  }

  async function handleAddSystemSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    if (!bulkMode) {
      const service_tag = formData.get("service_tag")?.trim().toUpperCase();
      const issue = formData.get("issue")?.trim();
      const note = formData.get("note")?.trim() || null;

      if (!service_tag || !issue || !note) {
        setAddSystemFormError(true);
        return;
      }

      setAddSystemFormError(false);

      // Add system first
      const ok = await addOrUpdateSystem(service_tag, issue, note);

      // Generate and open PDF

      if (ok) {
        await delay(500);
        try {
          const blob = await pdf(
            <SystemPDFLabel
              systems={[
                {
                  service_tag: service_tag,
                  url: `https://tss.wistronlabs.com/${service_tag}`,
                },
              ]}
            />
          ).toBlob();

          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        } catch (err) {
          console.error("Failed to generate PDF", err);
        }
      }

      setShowModal(false);
      await fetchData();
      setTimeout(() => showToast("", "success", 3000, "top-right"), 3000);
    } else {
      const csv = formData.get("bulk_csv")?.trim();
      if (!csv) {
        setAddSystemFormError(true);
        return;
      }

      setAddSystemFormError(false);

      const systemsPDF = [];
      let ok = false;

      const lines = csv.split("\n");
      for (const line of lines) {
        const [rawTag, issue, note] = line.split(/\t|,/).map((s) => s.trim());
        if (!rawTag || !issue) {
          console.warn(`Skipping invalid line: ${line}`);
          continue;
        }

        ok = await addOrUpdateSystem(rawTag.toUpperCase(), issue, note || null);

        systemsPDF.push({
          service_tag: rawTag.toUpperCase(),
          url: `https://tss.wistronlabs.com/${rawTag.toUpperCase()}`,
        });
      }

      if (systemsPDF.length > 0 && ok) {
        await delay(500);
        try {
          const blob = await pdf(
            <SystemPDFLabel systems={systemsPDF} />
          ).toBlob();

          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        } catch (err) {
          console.error("Failed to generate PDF", err);
        }
      }

      setShowModal(false);
      await fetchData();
      setTimeout(() => showToast("", "success", 3000, "top-right"), 3000);
    }
  }

  const earliestDate = history
    .map((h) => new Date(h.changed_at))
    .reduce((min, d) => (d < min ? d : min), new Date());

  earliestDate.setHours(0, 0, 0, 0);

  function getDateRange(fromDate, toDate) {
    const dates = [];
    const current = new Date(fromDate);
    while (current <= toDate) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const historyDates = getDateRange(earliestDate, today);

  // Create a snapshot of the latest state for each service_tag on each date
  // This will be used for the report download
  const stHistoryByDate = historyDates.map((date) => {
    const latestByTag = new Map();

    // convert date string to midnight of that day
    const dateEnd = new Date(date + "T23:59:59.999Z");

    history.forEach((entry) => {
      const entryTime = new Date(entry.changed_at);

      // only consider history up to and including this date
      if (entryTime <= dateEnd) {
        const existing = latestByTag.get(entry.service_tag);

        if (!existing || entryTime > new Date(existing.changed_at)) {
          latestByTag.set(entry.service_tag, entry);
        }
      }
    });

    const snapshot = [...latestByTag.values()].map((entry) => ({
      service_tag: entry.service_tag,
      location: entry.to_location?.trim() || "Unknown",
      last_note: entry.note || "Unknown",
    }));

    return { date, snapshot };
  });

  // Create a snapshot of what service_tags were worked on each day
  // This will be used for the report downloay
  const stWorkedOnByDate = historyDates.map((date) => {
    // start and end of this day
    const dateStart = new Date(date + "T00:00:00.000Z");
    const dateEnd = new Date(date + "T23:59:59.999Z");

    // keep only entries that happened on this specific day
    const entriesOnThisDate = history.filter((entry) => {
      const entryTime = new Date(entry.changed_at);
      return entryTime >= dateStart && entryTime <= dateEnd;
    });

    // for each service_tag, keep only the latest change on that day
    const latestByTag = new Map();

    entriesOnThisDate.forEach((entry) => {
      const existing = latestByTag.get(entry.service_tag);

      if (
        !existing ||
        new Date(entry.changed_at) > new Date(existing.changed_at)
      ) {
        latestByTag.set(entry.service_tag, entry);
      }
    });

    const snapshot = [...latestByTag.values()].map((entry) => ({
      service_tag: entry.service_tag,
      location: entry.to_location?.trim() || "Unknown",
      last_note: entry.note || "Unknown",
    }));

    return { date, snapshot };
  });

  function handleDownloadReport() {
    if (!reportDate) {
      showToast(`Select a Date`, "error", 3000, "top-right");
      return;
    }

    // report includes:
    // - the cumulative snapshot of all systems as of the end of the selected day, for specific active locations
    // - and the list of systems that were moved to resolved locations on that day
    const matchCumulative = stHistoryByDate.find((d) => d.date === reportDate);
    let matchPerDay = null;
    if (reportMode === "cumulative") {
      matchPerDay = stHistoryByDate.find((d) => d.date === reportDate);
    } else {
      matchPerDay = stWorkedOnByDate.find((d) => d.date === reportDate);
    }

    const cumulativeRows =
      matchCumulative?.snapshot.filter((row) =>
        REPORT_CUMULATIVE_LOCATIONS.includes(row.location)
      ) || [];

    const perDayRows =
      matchPerDay?.snapshot.filter((row) =>
        REPORT_PERDAY_LOCATIONS.includes(row.location)
      ) || [];

    const combinedRows = [...cumulativeRows, ...perDayRows];

    if (combinedRows.length > 0) {
      downloadCSV(`snapshot_${reportDate}.csv`, combinedRows);
    } else {
      showToast("No data for that date", "error", 3000, "top-right");
    }
  }

  return (
    <>
      <ConfirmDialog />
      <Toast />
      <main className="max-w-10/12 mx-auto mt-8 bg-white rounded shadow-md p-4">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-semibold text-gray-800">Systems</h1>
          <button
            onClick={() => {
              setAddSystemFormError(false);
              setShowModal(true);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-sm"
          >
            + New System
          </button>
        </div>

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <div className="text-red-600">{error}</div>
        ) : (
          <>
            <SystemLocationsChart history={history} locations={locations} />
            <SystemsCreatedChart
              systems={systems}
              history={history}
              locations={locations}
            />

            <div className="flex justify-end gap-4 mt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showActive}
                  onChange={() => {
                    if (showInactive || !showActive) {
                      setShowActive(!showActive);
                    }
                  }}
                  className="accent-blue-600"
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={() => {
                    if (showActive || !showInactive) {
                      setShowInactive(!showInactive);
                    }
                  }}
                  className="accent-blue-600"
                />
                Inactive
              </label>
            </div>

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
                date_created: "text-gray-500 text-sm",
                date_last_modified: "text-gray-500 text-sm",
                location: (val) =>
                  ["Sent to L11", "RMA CID", "RMA VID", "RMA PID"].includes(val)
                    ? { type: "pill", color: "bg-green-100 text-green-800" }
                    : ["Processed", "In Debug - Wistron", "In L10"].includes(
                        val
                      )
                    ? { type: "pill", color: "bg-red-100 text-red-800" }
                    : { type: "pill", color: "bg-yellow-100 text-yellow-800" },
              }}
              linkType="internal"
              truncate={true}
              visibleFields={
                isMobile
                  ? ["service_tag", "issue", "location"]
                  : [
                      "service_tag",
                      "issue",
                      "location",
                      "date_created",
                      "date_last_modified",
                    ]
              }
            />

            <button
              onClick={() => setIsModalOpen(true)}
              className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 mt-4"
            >
              Download Report
            </button>
          </>
        )}

        {showModal && (
          <AddSystemModal
            onClose={() => setShowModal(false)}
            bulkMode={bulkMode}
            setBulkMode={setBulkMode}
            onSubmit={handleAddSystemSubmit}
            addSystemFormError={addSystemFormError}
          />
        )}

        {isModalOpen && (
          <DownloadReportModal
            onClose={() => setIsModalOpen(false)}
            reportDate={reportDate}
            setReportDate={setReportDate}
            onDownload={handleDownloadReport}
            reportMode={reportMode}
            setReportMode={setReportMode}
          />
        )}
      </main>
    </>
  );
}

export default TrackingPage;
