import { useEffect, useState, useContext, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Select, { components } from "react-select";
import { Link, useLocation } from "react-router-dom";
import CreatableSelect from "react-select/creatable";

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

import { formatDateHumanReadable } from "../utils/date_format";
import { allowedNextLocations } from "../helpers/NextAllowedLocations.jsx";

import useApi from "../hooks/useApi";

import useConfirm from "../hooks/useConfirm";
import useToast from "../hooks/useToast.jsx";
import useIsMobile from "../hooks/useIsMobile.jsx";
import useDetailsModal from "../hooks/useDetailsModal.jsx";

// --- parts select helpers ---

// 1) group and sort parts into react-select "grouped options"
const buildGroupedPartOptions = (parts = []) => {
  const byCat = new Map();
  parts.forEach((p) => {
    const cat = p.category_name || "Uncategorized";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({
      value: p.id,
      label: p.name,
      category_name: cat,
      part_category_id: p.part_category_id,
    });
  });

  return Array.from(byCat.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, options]) => ({
      label,
      options: options.sort((a, b) => a.label.localeCompare(b.label)),
    }));
};

// 2) search by part label OR category name
const filterPartOption = (option, rawInput) => {
  if (!rawInput) return true;
  const term = rawInput.toLowerCase();
  const label = (option?.label || "").toLowerCase();
  const cat = (
    option?.data?.category_name ??
    option?.category_name ??
    ""
  ).toLowerCase();
  return label.includes(term) || cat.includes(term);
};

// 3) optional: custom option line (shows a tiny category chip)
const PartOption = (props) => {
  const cat = props.data.category_name;
  return (
    <components.Option {...props}>
      <div className="flex items-center justify-between">
        <span>{props.label}</span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-700">
          {cat}
        </span>
      </div>
    </components.Option>
  );
};

// 4) non-selectable group header
const PartGroupLabel = (group) => (
  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide py-1">
    {group.label}
  </div>
);

function SystemPage() {
  const FRONTEND_URL = import.meta.env.VITE_URL;

  const { serviceTag } = useParams();

  const [history, setHistory] = useState([]);
  const [system, setSystem] = useState(null); // new
  const [locations, setLocations] = useState([]);
  const [stations, setStations] = useState([]); // new

  const [me, setMe] = useState(null);
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
    getMe,
    getParts,
    getPartItems,
    createPartItem,
    updatePartItem,
    deletePartItem,
  } = useApi();

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // --- Pending Parts state ---
  const [pendingBlocks, setPendingBlocks] = useState([]); // [{id, part_id, ppid}]
  const [pendingBusy, setPendingBusy] = useState(false);
  const [partOptions, setPartOptions] = useState([]); // [{value,label}]
  // when partOptions are grouped, this flattens all options for value lookup
  const flatPartOptions = useMemo(
    () => partOptions.flatMap((g) => g.options || []),
    [partOptions]
  );
  const [unitBadParts, setUnitBadParts] = useState([]); // rows from /parts/list (is_functional=false)
  const [toRemovePPIDs, setToRemovePPIDs] = useState(new Set());

  // Map part_id -> part name for quick lookups in note lines
  const partNameById = useMemo(() => {
    const m = new Map();
    flatPartOptions.forEach((o) => m.set(o.value, o.label));
    return m;
  }, [flatPartOptions]);

  // Keep “Mark as Working” selections when flipping between destination buttons.
  // Only clear the temp “pending bad parts” blocks when we’re NOT in the Pending Parts flow.
  useEffect(() => {
    const inPendingFlow =
      toLocationId === 4 || system?.location === "Pending Parts";

    if (!inPendingFlow) {
      setPendingBlocks([]);
    }

    // IMPORTANT: do NOT clear toRemovePPIDs here — we want those
    // mark-as-working toggles to survive destination changes.
    setFormError(""); // optional
  }, [toLocationId, system?.location]);

  // ALWAYS load the unit's current non-functional parts when we know the system.id
  useEffect(() => {
    if (!system?.id) return;

    let alive = true;
    (async () => {
      try {
        const rows = await getPartItems({ place: "unit", unit_id: system.id });
        if (!alive) return;
        setUnitBadParts((rows || []).filter((r) => r.is_functional === false));
      } catch (e) {
        console.error("Failed to load unit bad parts:", e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [system?.id]);

  useEffect(() => {
    const showPending =
      toLocationId === 4 || system?.location === "Pending Parts";
    if (!showPending) return;
    let alive = true;
    (async () => {
      try {
        const parts = await getParts(); // [{id,name}]
        if (!alive) return;
        setPartOptions(buildGroupedPartOptions(parts));
      } catch (e) {
        console.error("Failed to load parts:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toLocationId, system?.location]);

  const toggleRemovePPID = (ppid) => {
    setToRemovePPIDs((prev) => {
      const next = new Set(prev);
      if (next.has(ppid)) next.delete(ppid);
      else next.add(ppid);
      return next;
    });
  };

  const markExistingWorking = async (ppid) => {
    try {
      await updatePartItem(ppid, { is_functional: true });
      setUnitBadParts((list) => list.filter((r) => r.ppid !== ppid));
      showToast("Marked as working", "success", 2000, "bottom-right");
    } catch (e) {
      const msg = e?.body?.error || e.message || "Failed to update part";
      showToast(msg, "error", 3200, "bottom-right");
    }
  };

  // Add a new empty block
  const addBadPartBlock = () => {
    setPendingBlocks((b) => [
      ...b,
      {
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        part_id: null,
        ppid: "",
      },
    ]);
  };

  const refreshUnitBadParts = async () => {
    if (!system?.id) return;
    try {
      const rows = await getPartItems({ place: "unit", unit_id: system.id });
      setUnitBadParts((rows || []).filter((r) => r.is_functional === false));
    } catch (e) {
      console.error("Failed to refresh bad parts:", e);
    }
  };

  // Update a field on a block (reset PPID when Part changes)
  const updateBlock = (id, field, value) => {
    setPendingBlocks((list) =>
      list.map((b) =>
        b.id === id
          ? {
              ...b,
              [field]: value,
              ...(field === "part_id" ? { ppid: "" } : {}),
            }
          : b
      )
    );
  };

  // Remove a block
  const removeBlock = (id) =>
    setPendingBlocks((list) => list.filter((b) => b.id !== id));

  // Cancel all
  const cancelPending = () => setPendingBlocks([]);

  // Ready to submit?
  const canSubmitPending =
    pendingBlocks.length > 0 &&
    pendingBlocks.every((b) => !!b.part_id && !!(b.ppid || "").trim());

  // Create part_list rows (in unit, non-working)
  const submitPendingParts = async () => {
    if (!system?.id || !canSubmitPending) return;
    setPendingBusy(true);
    try {
      await Promise.all(
        pendingBlocks.map(async (b) => {
          const ppid = String(b.ppid).toUpperCase().trim(); // save uppercase
          await createPartItem(ppid, {
            part_id: b.part_id,
            place: "unit",
            unit_id: system.id,
            is_functional: false,
          });
        })
      );
      showToast("Added bad parts to unit", "success", 2400, "bottom-right");
      setPendingBlocks([]);
      await fetchData(); // refresh
    } catch (e) {
      const msg = e?.body?.error || e.message || "Failed to add bad parts";
      showToast(msg, "error", 3500, "bottom-right");
    } finally {
      setPendingBusy(false);
    }
  };

  useEffect(() => {
    if (!token) return; // only run if user is logged in

    let cancelled = false;

    (async () => {
      try {
        const meData = await getMe();

        // only update if data actually changed
        setMe((prev) => {
          const newUser = meData?.user ?? null;
          if (
            !prev ||
            prev.id !== newUser?.id ||
            prev.isAdmin !== newUser?.isAdmin
          ) {
            return newUser;
          }
          return prev;
        });
      } catch (err) {
        if (!cancelled) setMe(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // 👇 only depend on token so it runs once per login/logout
  }, [token]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // get system first to know unit_id
      const systemsData = await getSystem(serviceTag);

      const [
        locationsData,
        historyData,
        stationData,
        releasedPalletsData,
        partItemsRows,
      ] = await Promise.all([
        getLocations(),
        getSystemHistory(serviceTag),
        getStations(),
        getPallets({
          all: true,
          filters: {
            conditions: [{ field: "status", op: "=", values: ["open"] }],
          },
        }),
        getPartItems({ place: "unit", unit_id: systemsData.id }),
      ]);

      setSystem(systemsData);
      setLocations(locationsData);
      setHistory(historyData);
      setStations(stationData);
      setreleasedPallets(releasedPalletsData);
      setUnitBadParts(
        (partItemsRows || []).filter((r) => r.is_functional === false)
      );
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
  // put near the top of SystemPage component file
  const select40Styles = {
    control: (base, state) => ({
      ...base,
      minHeight: 40,
      height: 40,
      borderColor: state.isFocused ? "#60A5FA" : "#D1D5DB", // blue-400 / gray-300
      boxShadow: "none",
      "&:hover": { borderColor: state.isFocused ? "#60A5FA" : "#D1D5DB" },
    }),
    valueContainer: (base) => ({ ...base, padding: "0 8px" }),
    indicatorsContainer: (base) => ({ ...base, height: 40 }),
    input: (base) => ({ ...base, margin: 0, padding: 0 }),
    placeholder: (base) => ({ ...base, margin: 0 }),
    singleValue: (base) => ({ ...base, margin: 0 }),
  };

  const handleDelete = async () => {
    console.log("deleting");

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
      navigate("/"); // redirect to home page
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
      const message =
        (err?.body && (err.body.error || err.body.message)) ||
        err.message ||
        "Error deleting last location entry";

      console.error("Delete last history failed:", err.status, err.body || err);
      showToast(message, "error", 3000, "bottom-right");
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
              name: nameLocal?.startsWith("L11")
                ? nameLocal
                : `L10 test ran on ${nameLocal}`,
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

    const movingToPending = toId === 4;
    const newBadCount = pendingBlocks.filter(
      (b) => b.part_id && (b.ppid || "").trim()
    ).length;

    if (movingToPending && newBadCount === 0) {
      setFormError(
        "Mark at least one part as defective before moving to Pending Parts"
      );
      return;
    }

    const movingToL10 =
      toId === (locations.find((l) => l.name === "In L10")?.id ?? 5);

    // how many defective parts would still be on the unit after your "mark as working" selections?
    const remainingBad = unitBadParts.filter(
      (item) => !toRemovePPIDs.has(item.ppid)
    ).length;

    // Build part-change note lines before we mutate anything
    const toCreate = pendingBlocks.filter(
      (b) => b.part_id && (b.ppid || "").trim()
    );
    const removing = Array.from(toRemovePPIDs || []);

    // For new bad parts -> "Non Working"
    const addedNotes = toCreate.map((b) => {
      const name = partNameById.get(b.part_id) || `#${b.part_id}`;
      const ppid = String(b.ppid).toUpperCase().trim();
      return ` - ${name} (${ppid}) in system identified as Non Working.`;
    });

    // For resolved parts -> "Working"
    const removedNotes = removing.map((ppid) => {
      const item = unitBadParts.find((r) => r.ppid === ppid);
      const name =
        item?.part_name ||
        (item?.part_id
          ? partNameById.get(item.part_id) || `#${item.part_id}`
          : "Part");
      return ` - ${name} (${ppid}) in system identified as Working.`;
    });

    // Final note to send (append changes on a new line, if any)
    const changeNoteSuffix = [...addedNotes, ...removedNotes].join(" ");
    const noteToSend = changeNoteSuffix
      ? `${note.trim()}${note.trim() ? "\n" : ""}${changeNoteSuffix}`
      : note;

    if (movingToL10 && remainingBad > 0) {
      setFormError(
        "Resolve or remove all defective parts before moving to In L10."
      );
      return;
    }

    setFormError("");
    setSubmitting(true);

    try {
      // 1) Create any new bad parts the user added (as in-unit, non-functional)
      if (pendingBlocks.length > 0) {
        const toCreate = pendingBlocks.filter(
          (b) => b.part_id && (b.ppid || "").trim()
        );
        await Promise.all(
          toCreate.map((b) =>
            createPartItem(String(b.ppid).toUpperCase().trim(), {
              part_id: b.part_id,
              place: "unit",
              unit_id: system.id,
              is_functional: false,
            })
          )
        );
      }

      // 2) Delete any existing non-functional parts the user marked as working
      if (toRemovePPIDs.size > 0) {
        const removing = Array.from(toRemovePPIDs);

        await Promise.all(
          removing.map(async (ppid) => {
            await updatePartItem(ppid, {
              is_functional: true,
              place: "inventory",
              unit_id: null,
            });
            await deletePartItem(ppid);
          })
        );

        // refresh the list only if we actually removed something
        await refreshUnitBadParts();
        setToRemovePPIDs(new Set());
      }

      // 3) Move the unit
      // ⬅️ Backend now returns { message, pallet_number?, dpn?, factory_code? } when moving into RMA
      const resp = await updateSystemLocation(serviceTag, {
        to_location_id: toId,
        note: noteToSend,
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
      // Clean up local UI state and refresh
      setPendingBlocks([]);
      setNote("");
      setToRemovePPIDs(new Set());
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
    }, 8000);

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
  console.log("TEST");
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
                      Config {system.config}{" "}
                      {system.dell_customer && `- ${system.dell_customer}`}
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
                {me?.isAdmin && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className={`bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow ${
                      !token ? "opacity-30 pointer-events-none" : ""
                    }`}
                  >
                    Delete Unit
                  </button>
                )}
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

                <div className="mt-5 flex flex-col gap-4">
                  {(toLocationId === 4 ||
                    system?.location === "Pending Parts") && (
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={addBadPartBlock}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        + Add Bad Part
                      </button>
                    </div>
                  )}
                  {/* Existing non-functional parts for this unit */}
                  <div className="space-y-2">
                    {unitBadParts.length > 0 && (
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        Currently Non-functional Parts in this Unit
                      </label>
                    )}
                    {unitBadParts.map((item) => {
                      const queued = toRemovePPIDs.has(item.ppid);
                      return (
                        <div
                          key={item.ppid}
                          className={`border border-gray-300 rounded-lg p-3 bg-white shadow-sm flex flex-col md:flex-row md:items-center gap-3 pb-5 ${
                            queued ? "border-red-300 bg-red-50 " : ""
                          }`}
                        >
                          <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Part
                            </label>
                            <input
                              className="w-full h-10 rounded-md border border-gray-300 px-3 bg-gray-50 cursor-not-allowed"
                              value={item.part_name || `#${item.part_id}`}
                              disabled
                              readOnly
                            />
                          </div>

                          <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              PPID
                            </label>
                            <input
                              className="w-full h-10 rounded-md border border-gray-300 px-3 bg-gray-50 cursor-not-allowed"
                              value={item.ppid || ""}
                              disabled
                              readOnly
                            />
                          </div>

                          <div className="md:w-auto">
                            <button
                              disabled={submitting}
                              type="button"
                              onClick={() => toggleRemovePPID(item.ppid)}
                              className={`relative px-3 py-2 rounded-md text-white mt-5 whitespace-nowrap ${
                                queued
                                  ? "bg-gray-500 hover:bg-gray-600"
                                  : "bg-red-600 hover:bg-red-700"
                              }`}
                            >
                              {/* Ghost sets width to longest text */}
                              <span className="invisible block">
                                Mark as Working
                              </span>

                              {/* Real label */}
                              <span className="absolute inset-0 flex items-center justify-center">
                                {queued ? "Undo" : "Mark as Working"}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(toLocationId === 4 ||
                    system?.location === "Pending Parts") && (
                    <>
                      {" "}
                      {/* New blocks to add */}
                      {pendingBlocks.length === 0 ? (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
                          No pending parts to be added. Click “Add Bad Part” to
                          begin.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {pendingBlocks.map((block) => {
                            const partValue =
                              flatPartOptions.find(
                                (o) => o.value === block.part_id
                              ) || null;
                            return (
                              <div
                                key={block.id}
                                className="border rounded-lg p-3 bg-white shadow-sm flex flex-col md:flex-row md:items-center gap-3 pb-5"
                              >
                                {/* Part Select */}
                                <div className="flex-1">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Part
                                  </label>
                                  <Select
                                    instanceId={`part-${block.id}`}
                                    classNamePrefix="react-select"
                                    styles={select40Styles}
                                    isClearable
                                    isSearchable
                                    placeholder="Select part"
                                    value={partValue}
                                    onChange={(opt) =>
                                      updateBlock(
                                        block.id,
                                        "part_id",
                                        opt ? opt.value : null
                                      )
                                    }
                                    options={partOptions} // grouped: [{ label, options: [...] }, ...]
                                    filterOption={filterPartOption} // search by part OR category
                                    components={{ Option: PartOption }} // show category chip on each option
                                    formatGroupLabel={PartGroupLabel} // non-selectable group headers
                                  />
                                </div>

                                {/* PPID Input */}
                                <div className="flex-1">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    PPID
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="text"
                                    autoCapitalize="characters"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    placeholder="Scan or type PPID"
                                    value={block.ppid}
                                    onChange={(e) =>
                                      updateBlock(
                                        block.id,
                                        "ppid",
                                        e.target.value
                                      )
                                    }
                                    onBlur={(e) =>
                                      updateBlock(
                                        block.id,
                                        "ppid",
                                        e.target.value.toUpperCase().trim()
                                      )
                                    }
                                    className={`w-full h-10 rounded-md border px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                      !block.ppid || !block.part_id
                                        ? "border-amber-300"
                                        : "border-gray-300"
                                    }`}
                                  />
                                </div>

                                <div className="md:w-auto">
                                  <button
                                    type="button"
                                    onClick={() => removeBlock(block.id)}
                                    className="relative px-3 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white mt-5 whitespace-nowrap"
                                  >
                                    {/* Ghost sets the width to the longest label */}
                                    <span className="invisible block">
                                      Mark as Working
                                    </span>

                                    {/* Real label centered on top */}
                                    <span className="absolute inset-0 flex items-center justify-center">
                                      Cancel
                                    </span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {(toLocationId === 5 || system?.location === "In L10") && (
                  <div className="mt-5 flex flex-col lg:flex-row gap-4">
                    {/* Table on the left */}
                    <div
                      className={`w-full lg:w-3/5 rounded border border-gray-300`}
                    >
                      <table className="rounded w-full bg-white  shadow-sm overflow-hidden ">
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
                    {system?.location != "In L10" && (
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
                    )}
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
                        ? ["to_location", "note"]
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
                    onAction={token && handleDeleteLastHistoryEntry}
                    actionButtonClass={
                      token && "ml-2 text-xs text-grey-200 hover:text-red-400"
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
