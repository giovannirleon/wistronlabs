import React, { useContext, useState, useEffect, useCallback } from "react";
import SearchContainerSS from "../components/SearchContainerSS.jsx";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";
import SystemsCreatedChart from "../components/SystemsCreatedChart.jsx";
import SystemLocationsChart from "../components/SystemLocationsChart.jsx";
import { AuthContext } from "../context/AuthContext.jsx";

import { pdf } from "@react-pdf/renderer";
import SystemPDFLabel from "../components/SystemPDFLabel.jsx";

import AddSystemModal from "../components/AddSystemModal.jsx";
import DownloadReportModal from "../components/DownloadReportModal.jsx";
import Tooltip from "../components/Tooltip.jsx";

import { formatDateHumanReadable } from "../utils/date_format.js";
import { downloadCSV } from "../utils/csv.js";
import { delay } from "../utils/delay.js";

import useConfirm from "../hooks/useConfirm";
import useToast from "../hooks/useToast";
import useIsMobile from "../hooks/useIsMobile.jsx";
import useApi from "../hooks/useApi.jsx";
import { useSystemsFetch } from "../hooks/useSystemsFetch.jsx";
import { useHistoryFetch } from "../hooks/useHistoryFetch.jsx";

import generateReport from "../helpers/GenerateReport.jsx";

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
  const [page, setPage] = useState(1);

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

  const [serverTime, setServerTime] = useState([]);

  const [systems, setSystems] = useState([]);

  const [reportMode, setReportMode] = useState("perday");

  const { token } = useContext(AuthContext);

  const fetchSystems = useSystemsFetch();
  const fetchHistory = useHistoryFetch();

  const {
    getLocations,
    getHistory,
    createSystem,
    moveSystemToProcessed,
    getServerTime,
  } = useApi();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [locationsData, historyData, serverTimeData] = await Promise.all([
        getLocations(),
        getHistory({ all: true }),
        getServerTime(),
      ]);

      const formattedHistory = historyData.map((entry) => ({
        ...entry,
        changed_at: formatDateHumanReadable(entry.changed_at),
      }));

      setLocations(locationsData);
      setHistory(formattedHistory);
      setServerTime(serverTimeData);
    } catch (err) {
      setError(err.message);
      console.log(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const isMobile = useIsMobile();

  async function addOrUpdateSystem(service_tag, issue, note) {
    const { data: inactiveSystems } = await fetchSystems({
      page_size: 150,
      inactive: true,
      active: false,
      sort_by: "location",
      sort_order: "desc",
      all: true,
    });

    const payload = { service_tag, issue, location_id: 1, note };

    const inactive = inactiveSystems.find(
      (sys) =>
        sys.service_tag.trim().toUpperCase() ===
        service_tag.trim().toUpperCase()
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

        await moveSystemToProcessed(service_tag, issue, note);
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
      const note = formData.get("note")?.trim();

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

  // Create a snapshot of the latest state for each service_tag on each date
  // This will be used for the report download

  async function handleDownloadReport() {
    if (!reportDate) {
      showToast(`Select a Date`, "error", 3000, "top-right");
      return;
    }

    // report includes:
    // - the cumulative snapshot of all systems as of the end of the selected day, for specific active locations
    // - and the list of systems that were moved to resolved locations on that day

    try {
      const { stHistoryByDate, stWorkedOnByDate } = await generateReport(
        history,
        earliestDate,
        systems
      );
      const matchCumulative = stHistoryByDate.find(
        (d) => d.date === reportDate
      );
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
    } catch (err) {
      console.error("Failed to generate report", err);
      showToast("Failed to generate report", "error", 3000, "top-right");
    }
  }

  const fetchSystemsWithFlags = useCallback(
    (options) => {
      return fetchSystems({
        ...options,
        active: showActive,
        inactive: showInactive,
      });
    },
    [showActive, showInactive]
  );

  return (
    <>
      <ConfirmDialog />
      <Toast />
      <main className="md:max-w-10/12 mx-auto mt-8 bg-white rounded shadow-md p-4">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-semibold text-gray-800">Systems</h1>
          <Tooltip
            text="Please log in to add a unit"
            position="botom"
            show={!token == true}
          >
            <button
              onClick={() => {
                setAddSystemFormError(false);
                setShowModal(true);
              }}
              className={`bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-s ${
                !token ? "opacity-30 pointer-events-none" : ""
              }`}
            >
              + New System
            </button>
          </Tooltip>
        </div>

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <div className="text-red-600">{error}</div>
        ) : (
          <>
            <SystemLocationsChart
              fetchSystems={fetchSystems}
              fetchHistory={fetchHistory}
              locations={locations}
              serverTime={serverTime}
            />
            <SystemsCreatedChart history={history} />

            <div className="flex justify-end gap-4 mt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showActive}
                  onChange={() => {
                    if (showInactive || !showActive) {
                      setShowActive(!showActive);
                      setPage(1);
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
                      setPage(1);
                    }
                  }}
                  className="accent-blue-600"
                />
                Inactive
              </label>
            </div>
            <SearchContainerSS
              page={page}
              onPageChange={(newPage) => setPage(newPage)}
              title=""
              fetchData={fetchSystemsWithFlags}
              displayOrder={[
                "service_tag",
                "issue",
                "location",
                "date_created",
                "date_modified",
              ]}
              defaultSortBy="date_modified"
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
                      "date_modified",
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
