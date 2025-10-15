import React, { useContext, useState, useEffect, useCallback } from "react";
import SearchContainerSS from "../components/SearchContainerSS.jsx";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";
import SystemInOutChart from "../components/SystemInOutChart.jsx";
import SystemLocationsChart from "../components/SystemLocationsChart.jsx";
import { DateTime } from "luxon";

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

function TrackingPage() {
  const FRONTEND_URL = import.meta.env.VITE_URL;
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [locations, setLocations] = useState([]);
  const [InOutChartHistory, setInOutChartHistory] = useState([]);
  const [locationChartHistory, setLocationChartHistory] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [reportDate, setReportDate] = useState("");
  const [showActive, setShowActive] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [addSystemFormError, setAddSystemFormError] = useState(false);
  const [idiotProof, setIdiotProof] = useState(false);
  const [printFriendly, setPrintFriendly] = useState(true);

  const [serverTime, setServerTime] = useState([]);

  const [reportMode, setReportMode] = useState("perday");

  const { token } = useContext(AuthContext);

  const fetchSystems = useSystemsFetch();
  const fetchHistory = useHistoryFetch();

  const chartDays = 7;
  const activeLocationIDs = [1, 2, 3, 4, 5];
  const systemLocationChartIDs = [1, 2, 4, 5];
  const inactiveLocationIDs = [6, 7, 8, 9];

  const {
    getLocations,
    getHistory,
    createSystem,
    moveSystemToReceived,
    getServerTime,
    getSnapshot,
    getSystemHistory,
  } = useApi();

  const fetchData = async () => {
    setLoading(true);

    try {
      const [locationsData, serverTimeData] = await Promise.all([
        getLocations(),
        getServerTime(),
      ]);

      const activeLocationNames = locationsData
        .filter((loc) => activeLocationIDs.includes(loc.id))
        .map((loc) => loc.name);

      // Base time in server’s local timezone
      const serverLocalNow = DateTime.fromFormat(
        serverTimeData.localtime,
        "MM/dd/yyyy, hh:mm:ss a",
        { zone: serverTimeData.zone }
      );

      let activeLocationSnapshotFirstDay,
        historyData,
        historyBeginningDateTime = null;

      //for (let daysBack = chartDays - 1; daysBack >= 0; daysBack--) {
      const snapshotDate = serverLocalNow
        .minus({ days: chartDays - 1 })
        .set({ hour: 23, minute: 59, second: 59, millisecond: 59 })
        .toUTC()
        .toISO();

      historyBeginningDateTime = serverLocalNow
        .minus({ days: chartDays - 1 })
        .set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      const historyBeginningDateISO = historyBeginningDateTime.toUTC().toISO();

      [activeLocationSnapshotFirstDay, historyData] = await Promise.all([
        getSnapshot({
          date: snapshotDate,
          locations: activeLocationNames,
          simplified: idiotProof,
        }),
        fetchHistory({
          all: true,
          filters: {
            op: "AND",
            conditions: [
              {
                field: "changed_at",
                values: [historyBeginningDateISO],
                op: ">=",
              },
            ],
          },
        }).then((res) => res.data),
      ]);

      //   if (
      //     activeLocationSnapshotFirstDay &&
      //     activeLocationSnapshotFirstDay.length > 0
      //   ) {
      //     break;
      //   }
      // }

      // cutoff for Location Chart: *one day after historyBeginningDateTime*
      const locationChartHistoryCutoffDateTime = historyBeginningDateTime
        .plus({
          days: 1,
        })
        .toUTC()
        .toISO();

      const filteredHistory = historyData.filter((h) => {
        const dt = DateTime.fromISO(h.changed_at, { zone: "utc" }).toISO();
        return dt >= locationChartHistoryCutoffDateTime;
      });
      setLocations(locationsData);
      setInOutChartHistory(historyData);
      setLocationChartHistory(filteredHistory);
      setServerTime(serverTimeData);
      setSnapshot(activeLocationSnapshotFirstDay);
    } catch (err) {
      setError(err.message);
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [idiotProof]);

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const isMobile = useIsMobile();

  async function addOrUpdateSystem(service_tag, issue, ppid, rack_service_tag) {
    const { data: inactiveSystems } = await fetchSystems({
      page_size: 150,
      inactive: true,
      active: false,
      sort_by: "location",
      sort_order: "desc",
      all: true,
    });

    const payload = {
      service_tag,
      issue,
      location_id: 1, // "Received"
      ppid,
      rack_service_tag,
      // note not sent; server sets "added to system"
    };

    const inactive = inactiveSystems.find(
      (sys) =>
        sys.service_tag.trim().toUpperCase() ===
        service_tag.trim().toUpperCase()
    );

    try {
      if (inactive) {
        const confirmed = await confirm({
          title: "Re-enter System?",
          message: `${service_tag} exists as inactive. Move it back to Received?`,
          confirmText: "Confirm",
          cancelText: "Cancel",
        });
        if (!confirmed) {
          showToast(`Skipped ${service_tag}`, "error", 3000, "top-right");
          return false;
        }

        // If you want to update PPID/rack tag for re-entry as well, do it here (optional):
        // await api.patch(`/systems/${service_tag}/ppid`, { ppid });
        // await api.patch(`/systems/${service_tag}/rack-service-tag`, { rack_service_tag });

        await moveSystemToReceived(service_tag, issue, "added to system");
        showToast(
          `${service_tag} moved back to received`,
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
      const issue = formData.get("issue")?.trim() || null;
      const ppid = formData.get("ppid")?.trim().toUpperCase();
      const rack_service_tag = formData.get("rack_service_tag")?.trim();

      if (!service_tag || !ppid || !rack_service_tag) {
        setAddSystemFormError(true);
        return;
      }
      setAddSystemFormError(false);

      const ok = await addOrUpdateSystem(
        service_tag,
        issue,
        ppid,
        rack_service_tag
      );

      // Generate and open PDF

      if (ok) {
        await delay(500);
        try {
          const blob = await pdf(
            <SystemPDFLabel
              systems={[
                {
                  service_tag: service_tag,
                  url: `${FRONTEND_URL}${service_tag}`,
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
        const [rawTag, issue, ppid, rackServiceTag] = line
          .split(/\t|,/)
          .map((s) => (s ?? "").trim());
        if (!rawTag || !ppid || !rackServiceTag) {
          console.warn(`Skipping invalid line: ${line}`);
          continue;
        }

        ok = await addOrUpdateSystem(
          rawTag.toUpperCase(),
          issue || null,
          ppid.toUpperCase(),
          rackServiceTag
        );

        systemsPDF.push({
          service_tag: rawTag.toUpperCase(),
          url: `${FRONTEND_URL}${rawTag.toUpperCase()}`,
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

  // // Create a snapshot of the latest state for each service_tag on each date
  // // This will be used for the report download

  async function handleDownloadReport() {
    if (!reportDate) {
      showToast(`Select a Date`, "error", 3000, "top-right");
      return;
    }

    try {
      const serverTimeReport = await getServerTime();
      const serverZone = serverTimeReport.zone;

      const serverLocal = DateTime.fromISO(reportDate, { zone: serverZone });
      const reportDT = serverLocal
        .set({ hour: 23, minute: 59, second: 59, millisecond: 0 })
        .toUTC()
        .toISO();

      const startOfDayUTC = serverLocal.startOf("day").toUTC().toISO();

      const params = new URLSearchParams({
        date: reportDT,
        includeNote: "true",
        noCache: "true",
        mode: reportMode,
        includeReceived: "true",
        format: "csv",
        timezone: serverZone,
      });

      if (reportMode !== "cumulative") {
        params.set("start", startOfDayUTC);
      }

      // NEW: pass simplified flag
      if (idiotProof) params.set("simplified", "true");

      const resp = await fetch(
        `${BACKEND_URL}/systems/snapshot?${params.toString()}`
      );
      if (!resp.ok) throw new Error(await resp.text());

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snapshot_${reportDate}_${reportMode}${
        idiotProof ? "_simplified" : ""
      }.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast(
        `Report for ${reportDate} downloading`,
        "success",
        3000,
        "top-right"
      );
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

      <main className="md:max-w-10/12  mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
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
          <LoadingSkeleton rows={10} />
        ) : error ? (
          <div className="text-red-600">{error}</div>
        ) : (
          <>
            <SystemLocationsChart
              snapshot={snapshot}
              history={locationChartHistory}
              locations={locations}
              activeLocationIDs={systemLocationChartIDs}
              serverTime={serverTime}
              printFriendly={printFriendly}
            />
            <SystemInOutChart
              history={InOutChartHistory}
              locations={locations}
              activeLocationIDs={activeLocationIDs}
              serverTime={serverTime}
              printFriendly={printFriendly}
            />

            <div className="flex justify-end mt-2">
              <label className="inline-flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={!printFriendly}
                  onChange={(e) => setPrintFriendly(!e.target.checked)}
                  className="h-3 w-3 accent-blue-600"
                />
                Sleeker Graph (hide legend & values)
              </label>
            </div>

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
                    : ["Received", "In Debug - Wistron", "In L10"].includes(val)
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
            idiotProof={idiotProof}
            setIdiotProof={setIdiotProof}
          />
        )}
      </main>
    </>
  );
}

export default TrackingPage;
