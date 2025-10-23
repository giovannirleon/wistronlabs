import { useEffect, useState, useContext, useMemo, use } from "react";
import { useNavigate } from "react-router-dom";
import Select, { components } from "react-select";
import { Link } from "react-router-dom";

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
import SystemL10PassLabel from "../components/SystemL10PassLabel.jsx";
import SystemPendingPartsLabel from "../components/SystemPendingPartsLabel.jsx";

import Station from "../components/Station.jsx";

import { formatDateHumanReadable } from "../utils/date_format";
import { allowedNextLocations } from "../helpers/NextAllowedLocations.jsx";

import useApi from "../hooks/useApi";

import useConfirm from "../hooks/useConfirm";
import usePrintConfirmPendingParts from "../hooks/usePrintConfirmPendingParts.jsx";
import usePrintConfirmL11 from "../hooks/usePrintConfirmL11.jsx";
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

  // Root-cause UI state
  const [rootCauseOptions, setRootCauseOptions] = useState([]); // [{value,label}]
  const [rootCauseSubOptions, setRootCauseSubOptions] = useState([]); // [{value,label}]
  const [selectedRootCauseId, setSelectedRootCauseId] = useState(null);
  const [selectedRootCauseSubId, setSelectedRootCauseSubId] = useState(null);

  const [tab, setTab] = useState("history");
  const [logsDir, setLogsDir] = useState(""); // e.g. "2025-09-25/"

  const { confirmPrint, ConfirPrintmModal } = usePrintConfirm();
  const { confirmPrintPendingParts, ConfirPrintmModalPendingParts } =
    usePrintConfirmPendingParts();
  const { confirmPrintL11, ConfirPrintmModalL11 } = usePrintConfirmL11();

  const currentLocation = history[0]?.to_location || ""; // most recent location name

  const resolvedIDs = [6, 7, 8, 9];

  const resolvedNames = locations
    ?.filter((loc) => resolvedIDs.includes(loc.id))
    .map((loc) => loc.name);

  const isResolved = resolvedNames?.includes(currentLocation);
  // Disable the entire form when the current location is resolved
  const formDisabled = isResolved; // Sent to L11, RMA VID/PID/CID

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
    getRootCauses,
    getRootCauseSubCategories,
    updateSystemRootCause,
  } = useApi();

  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast, Toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // BAD inventory PPIDs cache (by part)
  const [badOptionsCache, setBadOptionsCache] = useState(new Map()); // part_id -> [{value,label}]

  // Per-GOOD-in-unit selection: action + chosen bad ppid to bring back
  // { [goodPPID]: { action: 'not_needed' | 'defective', original_bad_ppid: string } }
  const [goodActionByPPID, setGoodActionByPPID] = useState({});

  // Load BAD inventory PPIDs for a specific part_id (cached)
  const loadBadOptions = async (part_id) => {
    if (!part_id) return [];
    if (badOptionsCache.has(part_id)) return badOptionsCache.get(part_id);
    const rows = await getPartItems({
      place: "inventory",
      is_functional: false,
      part_id,
    });
    const opts = (rows || []).map((r) => ({ value: r.ppid, label: r.ppid }));
    setBadOptionsCache((prev) => {
      const next = new Map(prev);
      next.set(part_id, opts);
      return next;
    });
    return opts;
  };

  // Add with the other constants near the top of SystemPage()
  const RMA_LOCATION_NAMES = ["RMA VID", "RMA CID", "RMA PID"];
  const L11_NAME = "Sent to L11";

  // --- Pending Parts state ---
  const [pendingBlocks, setPendingBlocks] = useState([]); // [{id, part_id, ppid}]
  const [partOptions, setPartOptions] = useState([]); // [{value,label}]
  // when partOptions are grouped, this flattens all options for value lookup
  const flatPartOptions = useMemo(
    () => partOptions.flatMap((g) => g.options || []),
    [partOptions]
  );
  // All parts currently tracked in the unit (good + bad)
  const [unitParts, setUnitParts] = useState([]);
  const [toRemovePPIDs, setToRemovePPIDs] = useState(new Set());

  // “Add Good Part” blocks
  const [goodBlocks, setGoodBlocks] = useState([]); // [{id, part_id, ppid}]
  // Cache GOOD PPID options per part to avoid repeated calls (reactive)
  const [goodOptionsCache, setGoodOptionsCache] = useState(new Map()); // part_id -> [{value,label}]
  // Replacement selections for BAD in-unit parts (ppid -> replacement good ppid)
  const [replacementByOldPPID, setReplacementByOldPPID] = useState({});

  // Load GOOD inventory PPIDs for a specific part_id (cached)
  const loadGoodOptions = async (part_id) => {
    if (!part_id) return [];
    if (goodOptionsCache.has(part_id)) return goodOptionsCache.get(part_id);
    const rows = await getPartItems({
      place: "inventory",
      is_functional: true,
      part_id,
    });
    const opts = (rows || []).map((r) => ({ value: r.ppid, label: r.ppid }));
    setGoodOptionsCache((prev) => {
      const next = new Map(prev);
      next.set(part_id, opts);
      return next;
    });
    return opts;
  };

  // when creating a good block
  const addGoodPartBlock = () => {
    setGoodBlocks((b) => [
      ...b,
      {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        part_id: null,
        ppid: "", // GOOD PPID from inventory to install
        current_bad_ppid: "", // <-- NEW: the defective PPID to create in inventory
      },
    ]);
  };

  const updateGoodBlock = (id, field, value) => {
    setGoodBlocks((list) =>
      list.map((b) =>
        b.id === id
          ? {
              ...b,
              [field]: value,
              ...(field === "part_id"
                ? { ppid: "", current_bad_ppid: "" } // reset dependent fields
                : {}),
            }
          : b
      )
    );
  };

  const removeGoodBlock = (id) =>
    setGoodBlocks((list) => list.filter((b) => b.id !== id));

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
        setUnitParts(rows || []);
      } catch (e) {
        console.error("Failed to load unit parts:", e);
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
  const isInDebugWistron = system?.location === "In Debug - Wistron";
  const isInPendingParts = system?.location === "Pending Parts";
  const toLocationName =
    locations.find((l) => l.id === toLocationId)?.name || "";
  const isInL10 = system?.location === "In L10";
  const toIsDebugOrL10 =
    toLocationName === "In Debug - Wistron" || toLocationName === "In L10";
  const isInReceived = system?.location === "Received";

  const canAddGoodParts =
    (isInDebugWistron && toLocationId !== 4 && !isInPendingParts && !isInL10) || // current location is Debug, but not sending to Pending
    (toIsDebugOrL10 &&
      toLocationId !== 4 &&
      !isInPendingParts &&
      !isInL10 &&
      !isInReceived); // explicitly moving to Debug/L10, not Pending

  const toggleRemovePPID = (ppid) => {
    setToRemovePPIDs((prev) => {
      const next = new Set(prev);
      if (next.has(ppid)) next.delete(ppid);
      else next.add(ppid);
      return next;
    });
  };

  const ROOT_CAUSE_LOCATIONS = ["RMA VID", "RMA CID", "RMA PID", "Sent to L11"];
  const showRootCauseControls = useMemo(() => {
    const movingToResolved = ROOT_CAUSE_LOCATIONS.includes(toLocationName);
    const inResolvedNow = ROOT_CAUSE_LOCATIONS.includes(currentLocation);
    return movingToResolved || inResolvedNow;
  }, [toLocationName, currentLocation]);

  useEffect(() => {
    if (!showRootCauseControls) {
      setSelectedRootCauseId(null);
      setSelectedRootCauseSubId(null);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const [cats, subs] = await Promise.all([
          getRootCauses(), // [{id,name}]
          getRootCauseSubCategories(), // [{id,name}]
        ]);
        if (!alive) return;

        const isRMAto = RMA_LOCATION_NAMES.includes(toLocationName); // RMA VID/CID/PID
        const isL11to = toLocationName === L11_NAME; // "Sent to L11"

        // Base lists
        let catOpts = (cats || []).map((c) => ({
          value: String(c.id),
          label: c.name,
        }));
        let baseSubOpts = (subs || []).map((s) => ({
          value: String(s.id),
          label: s.name,
        }));

        // In RMA (VID/CID/PID): remove NTF from BOTH lists
        if (isRMAto) {
          catOpts = catOpts.filter((o) => o.label !== "NTF");
          baseSubOpts = baseSubOpts.filter(
            (o) => o.label !== "No Trouble Found"
          );
        } else {
          // Outside RMA: hide "Unable to Repair"
          baseSubOpts = baseSubOpts.filter(
            (o) => o.label !== "Unable to Repair"
          );
        }

        // Figure out the currently selected category label (after filtering)
        const selectedCat = catOpts.find(
          (o) => String(o.value) === String(selectedRootCauseId)
        );

        let subOpts = baseSubOpts;

        if (isL11to && selectedCat?.label === "NTF") {
          const ntfSub =
            baseSubOpts.find((o) => o.label === "No Trouble Found") || null;
          if (ntfSub) {
            subOpts = [ntfSub];
            setSelectedRootCauseSubId(String(ntfSub.value));
          } else {
            subOpts = [];
            setSelectedRootCauseSubId(null);
          }
        } else if (selectedCat?.label === "NTF") {
          const ntfSub =
            baseSubOpts.find((o) => o.label === "No Trouble Found") || null;
          subOpts = ntfSub ? [ntfSub] : [];
          if (ntfSub) setSelectedRootCauseSubId(String(ntfSub.value));
        } else {
          // Category ≠ NTF → remove NTF from sub-category options
          subOpts = baseSubOpts.filter((o) => o.label !== "No Trouble Found");
        }

        // Clear selections if they’re no longer valid
        if (
          !catOpts.some((o) => String(o.value) === String(selectedRootCauseId))
        ) {
          setSelectedRootCauseId(null);
        }
        if (
          !subOpts.some(
            (o) => String(o.value) === String(selectedRootCauseSubId)
          )
        ) {
          setSelectedRootCauseSubId(null);
        }

        setRootCauseOptions(catOpts);
        setRootCauseSubOptions(subOpts);
      } catch (e) {
        console.error("Failed to load root cause options", e);
      }
    })();

    return () => {
      alive = false;
    };
    // IMPORTANT: include selectedRootCauseId so sub options react to category changes
  }, [showRootCauseControls, toLocationName, selectedRootCauseId]);

  useEffect(() => {
    // If the chosen category is NTF, keep sub-category locked to NTF (when available)
    const selectedCat = rootCauseOptions.find(
      (o) => String(o.value) === String(selectedRootCauseId)
    );
    if (selectedCat?.label === "NTF") {
      const ntfSub = rootCauseSubOptions.find(
        (o) => o.label === "No Trouble Found"
      );
      if (ntfSub) setSelectedRootCauseSubId(String(ntfSub.value));
    }
  }, [selectedRootCauseId, rootCauseOptions, rootCauseSubOptions]);

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

  const refreshUnitParts = async () => {
    if (!system?.id) return;
    try {
      const rows = await getPartItems({ place: "unit", unit_id: system.id });
      setUnitParts(rows || []);
    } catch (e) {
      console.error("Failed to refresh unit parts:", e);
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

  // Ready to submit?
  const canSubmitPending =
    pendingBlocks.length > 0 &&
    pendingBlocks.every((b) => !!b.part_id && !!(b.ppid || "").trim());

  // Preload parts + GOOD PPIDs when already in Debug (no need to choose To Location)
  useEffect(() => {
    if (!isInDebugWistron) return;

    let alive = true;

    (async () => {
      try {
        // Ensure partOptions are populated
        const parts = await getParts();
        if (!alive) return;
        setPartOptions(buildGroupedPartOptions(parts));

        // Preload GOOD PPIDs for all part_ids currently tracked in the unit
        const ids = Array.from(
          new Set(
            (unitParts || []).map((u) => u.part_id).filter((id) => id != null)
          )
        );

        for (const pid of ids) {
          // cache warmed for replacement dropdowns (no UI click needed)
          await loadGoodOptions(pid);
        }
      } catch (e) {
        console.error("Preload in Debug failed:", e);
      }
    })();

    return () => {
      alive = false;
    };
    // Re-run if you newly enter Debug or unit parts change
  }, [isInDebugWistron, unitParts]);

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

  // Load parts when Good Parts flow is allowed (Debug → Debug/L10)
  useEffect(() => {
    if (!canAddGoodParts) return;
    let alive = true;
    (async () => {
      try {
        const parts = await getParts();
        if (!alive) return;
        setPartOptions(buildGroupedPartOptions(parts));
      } catch (e) {
        console.error("Failed to load parts for good blocks:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [canAddGoodParts]);

  // seed from backend AFTER showRootCauseControls is true
  useEffect(() => {
    if (!showRootCauseControls) return;
    if (selectedRootCauseId == null && system?.root_cause_id != null) {
      setSelectedRootCauseId(String(system.root_cause_id));
    }
    if (
      selectedRootCauseSubId == null &&
      system?.root_cause_sub_category_id != null
    ) {
      setSelectedRootCauseSubId(String(system.root_cause_sub_category_id));
    }
  }, [
    showRootCauseControls,
    system?.root_cause_id,
    system?.root_cause_sub_category_id,
  ]);

  useEffect(() => {
    // Do NOT reset "Good Parts in unit" actions while the unit is currently in Pending Parts.
    if (isInPendingParts) return;

    // Outside of Pending Parts, only keep actions while in the allowed "good flow".
    const inGoodFlow =
      toLocationId !== 4 && (isInDebugWistron || toIsDebugOrL10);
    if (!inGoodFlow) setGoodActionByPPID({});
  }, [toLocationId, isInPendingParts, isInDebugWistron, toIsDebugOrL10]);

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
      setUnitParts(partItemsRows || []);
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

  const { openDetails, modal } = useDetailsModal(showToast, fetchData);

  // at top with other memos
  const hasAnyBadReplacementChosen = useMemo(
    () =>
      Object.values(replacementByOldPPID || {}).some(
        (v) => (v || "").trim() !== ""
      ),
    [replacementByOldPPID]
  );

  const select40Styles = useMemo(
    () => ({
      control: (base, state) => ({
        ...base,
        minHeight: 40,
        height: 40,
        overflow: "hidden", // don’t grow vertically
        borderColor: state.isFocused ? "#60A5FA" : "#D1D5DB",
        boxShadow: "none",
        "&:hover": { borderColor: state.isFocused ? "#60A5FA" : "#D1D5DB" },
      }),
      valueContainer: (base) => ({
        ...base,
        padding: "0 8px",
        overflow: "hidden", // clip long value
      }),
      singleValue: (base) => ({
        ...base,
        margin: 0,
        maxWidth: "100%",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis", // … for long labels
      }),
      placeholder: (base) => ({
        ...base,
        margin: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }),
      input: (base) => ({
        ...base,
        margin: 0,
        padding: 0,
      }),
      indicatorsContainer: (base) => ({ ...base, height: 40 }),

      // Dropdown should scroll, not expand
      menu: (base) => ({
        ...base,
        overflow: "hidden",
      }),
      menuList: (base) => ({
        ...base,
        maxHeight: 220, // pick your height
        overflowY: "auto", // scroll overflow
      }),
      option: (base) => ({
        ...base,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }),
    }),
    []
  );

  // --- PPID normalization (case-insensitive uniqueness) ---
  const normPPID = (s) => (s || "").toUpperCase().trim();

  // --- Build live sets of currently-picked PPIDs (GOOD/BAD) across the whole form ---
  const selectedGoodPPIDs = useMemo(() => {
    const fromGoodBlocks = goodBlocks
      .map((b) => normPPID(b.ppid))
      .filter(Boolean);
    const fromRepl = Object.values(replacementByOldPPID)
      .map((v) => normPPID(v))
      .filter(Boolean);
    return new Set([...fromGoodBlocks, ...fromRepl]);
  }, [goodBlocks, replacementByOldPPID]);

  const selectedBadPPIDs = useMemo(() => {
    const fromPending = pendingBlocks
      .map((b) => normPPID(b.ppid))
      .filter(Boolean);
    const fromOriginals = Object.values(goodActionByPPID)
      .map((cfg) => normPPID(cfg?.original_bad_ppid))
      .filter(Boolean);
    return new Set([...fromPending, ...fromOriginals]);
  }, [pendingBlocks, goodActionByPPID]);

  // --- Filter helpers (show current value even if "reserved") ---
  const getFilteredGoodOptions = (part_id, currentValue) => {
    const cur = normPPID(currentValue);
    const opts = goodOptionsCache.get(part_id) || [];
    return opts.filter((o) => {
      const v = normPPID(o.value);
      return v === cur || !selectedGoodPPIDs.has(v);
    });
  };

  const getFilteredBadOptions = (part_id, currentValue) => {
    const cur = normPPID(currentValue);
    const opts = badOptionsCache.get(part_id) || [];
    return opts.filter((o) => {
      const v = normPPID(o.value);
      return v === cur || !selectedBadPPIDs.has(v);
    });
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

  // Clear "Add Good Part" blocks when leaving the good-parts flow
  useEffect(() => {
    const inGoodFlow =
      !isInPendingParts &&
      toLocationId !== 4 && // not sending to Pending
      (isInDebugWistron || toIsDebugOrL10); // allowed destinations

    if (!inGoodFlow) {
      setGoodBlocks([]); // ← clears the added good parts
      // (optional) also clear any helpers tied to those blocks:
      // setReplacementByOldPPID({});
      // setFormError("");
    }
  }, [
    toLocationId,
    system?.location,
    isInPendingParts,
    isInDebugWistron,
    toIsDebugOrL10,
  ]);

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

  // Will the unit still contain any GOOD parts after this submit?
  const willHaveGoodAfterSubmit = useMemo(() => {
    // 1) GOOD parts currently in unit
    const goodInUnitNow = new Set(
      (unitParts || [])
        .filter((i) => i.is_functional === true)
        .map((i) => normPPID(i.ppid))
    );

    // 2) GOOD parts we are explicitly removing this submit
    //    (only entries with an action AND an original_bad_ppid actually execute)
    const gaEntries = Object.entries(goodActionByPPID).filter(
      ([g, cfg]) => !!cfg?.action && !!cfg?.original_bad_ppid
    );
    for (const [g] of gaEntries) goodInUnitNow.delete(normPPID(g));

    // 3) GOOD parts that will be added this submit
    const addFromGoodBlocks = goodBlocks.filter(
      (b) =>
        b.part_id && (b.ppid || "").trim() && (b.current_bad_ppid || "").trim()
    ).length;

    const addFromReplacements =
      Object.values(replacementByOldPPID).filter(Boolean).length;

    // If any good remains or any good is being added, we will end up with a good part in unit
    return (
      goodInUnitNow.size > 0 || addFromGoodBlocks > 0 || addFromReplacements > 0
    );
  }, [unitParts, goodActionByPPID, goodBlocks, replacementByOldPPID]);

  const L10_LOCATION_ID = useMemo(
    () => locations.find((l) => l.name === "In L10")?.id,
    [locations]
  );

  // Will the unit still contain any BAD parts after this submit?
  const willHaveBadAfterSubmit = useMemo(() => {
    // start with current BAD parts in the unit
    const bad = new Set(
      (unitParts || [])
        .filter((i) => i.is_functional === false)
        .map((i) => normPPID(i.ppid))
    );

    // remove BAD parts the user will mark as working
    for (const p of toRemovePPIDs) bad.delete(normPPID(p));

    // remove BAD parts that will be replaced by a GOOD PPID
    for (const oldBad of Object.keys(replacementByOldPPID || {})) {
      if (replacementByOldPPID[oldBad]) bad.delete(normPPID(oldBad));
    }

    // add BAD parts that will be newly flagged in this submit (Pending blocks)
    for (const b of pendingBlocks) {
      if (b.part_id && (b.ppid || "").trim()) bad.add(normPPID(b.ppid));
    }

    // add BAD parts that will be brought back into the unit via Good-part actions
    for (const cfg of Object.values(goodActionByPPID || {})) {
      if (cfg?.action && (cfg.original_bad_ppid || "").trim()) {
        bad.add(normPPID(cfg.original_bad_ppid));
      }
    }

    return bad.size > 0;
  }, [
    unitParts,
    toRemovePPIDs,
    replacementByOldPPID,
    pendingBlocks,
    goodActionByPPID,
  ]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formDisabled) return; // extra safety: resolved forms can't submit

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

    // any currently-tracked BAD parts in the unit?
    const hasBadTrackedNow = (unitParts || []).some(
      (i) => i.is_functional === false
    );

    if (movingToPending) {
      if (isInPendingParts) {
        // keep existing behavior while already IN Pending Parts
        if (newBadCount === 0) {
          setFormError(
            "Mark at least one additional part as defective before moving to Pending Parts again."
          );
          return;
        }
      } else {
        // only error if there are NO current bad parts AND no new pending parts added
        if (!hasBadTrackedNow && newBadCount === 0) {
          setFormError(
            "At least one part must be marked as defective before moving to Pending Parts"
          );
          return;
        }
      }
    }

    const movingToL10 =
      toId === (locations.find((l) => l.name === "In L10")?.id ?? 5);

    // Rule #4: if a BAD part is being added AND there exists GOOD inventory of that part, block submit
    if (pendingBlocks.length > 0) {
      for (const b of pendingBlocks) {
        if (!b.part_id || !(b.ppid || "").trim()) continue;
        const invGood = await getPartItems({
          place: "inventory",
          is_functional: true,
          part_id: b.part_id,
        });
        if ((invGood || []).length > 0) {
          const partName = partNameById.get(b.part_id) || `#${b.part_id}`;
          setFormError(
            `This unit cannot be placed in pending parts for a ${partName} when there are ${partName}s in inventory`
          );
          return;
        }
      }
    }

    const movingToRMA = RMA_LOCATION_IDS.includes(toId);
    if (movingToRMA && willHaveGoodAfterSubmit) {
      setFormError(
        "Remove or return all good parts before moving this unit to an RMA location."
      );
      return;
    }

    const badInUnit = (unitParts || []).filter(
      (i) => i.is_functional === false
    );
    const remainingBad = badInUnit.filter(
      (item) =>
        !toRemovePPIDs.has(item.ppid) && !replacementByOldPPID[item.ppid] // will be replaced (moved out) this submit
    ).length;
    // Build part-change note lines before we mutate anything
    const toCreate = pendingBlocks.filter(
      (b) => b.part_id && (b.ppid || "").trim()
    );
    const removing = Array.from(toRemovePPIDs || []);

    if (toId === 4) {
      const up = (s) => (s || "").toUpperCase().trim();
      const nameOfPart = (i) =>
        (i?.part_name && i.part_name.trim()) ||
        (i?.part_id != null
          ? partNameById.get(i.part_id) || `#${i.part_id}`
          : "Part");

      // PPID -> current item in unit (so we can read part_id/name)
      const byPPID = new Map((unitParts || []).map((i) => [up(i.ppid), i]));

      // 1) start with BADs currently in the unit
      const badNow = new Map(); // PPID -> item
      for (const i of unitParts || []) {
        if (i.is_functional === false) badNow.set(up(i.ppid), i);
      }

      // 2) remove BADs marked as working
      for (const p of toRemovePPIDs) badNow.delete(up(p));

      // 3) remove BADs that will be replaced by a GOOD PPID
      for (const oldBad of Object.keys(replacementByOldPPID || {})) {
        if ((replacementByOldPPID[oldBad] || "").trim())
          badNow.delete(up(oldBad));
      }

      // 4) add newly flagged BADs (pending blocks)
      for (const b of pendingBlocks) {
        if (b.part_id && (b.ppid || "").trim()) {
          const ppid = up(b.ppid);
          // synthesize a minimal item so nameOfPart works
          badNow.set(ppid, { part_id: b.part_id, part_name: null, ppid });
        }
      }

      // 5) add BADs brought back via GOOD-part actions
      for (const [goodPPID, cfg] of Object.entries(goodActionByPPID || {})) {
        const back = (cfg?.original_bad_ppid || "").trim();
        if (!cfg?.action || !back) continue;
        const goodItem = byPPID.get(up(goodPPID)); // infer part info from the good in unit
        badNow.set(up(back), {
          part_id: goodItem?.part_id ?? null,
          part_name: goodItem?.part_name ?? null,
          ppid: up(back),
        });
      }

      // Build label lines for EVERY remaining BAD PPID (no name-based dedupe)
      const labelLines = Array.from(badNow.entries())
        .map(([ppid, info]) => `${nameOfPart(info)}`)
        .sort((a, b) => a.localeCompare(b));

      const blob = await pdf(
        <SystemPendingPartsLabel parts={labelLines} />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      window.open(url);
    }

    // ---- Existing note lines (Pending Parts) ----
    //  A) New bad parts identified in unit -> "Non Working"
    const addedNotes = toCreate.map((b) => {
      const name = partNameById.get(b.part_id) || `#${b.part_id}`;
      const ppid = String(b.ppid).toUpperCase().trim();
      return ` - ${name} (${ppid}) in system identified as non working.`;
    });

    //  B) Existing bad parts marked as working
    const removedNotes = removing.map((ppid) => {
      const item = (unitParts || []).find((r) => r.ppid === ppid);
      const name =
        item?.part_name ||
        (item?.part_id
          ? partNameById.get(item.part_id) || `#${item.part_id}`
          : "Part");
      return ` - ${name} (${ppid}) in system identified as working.`;
    });

    // ---- NEW note lines ----
    // Preview lists that mirror the mutations we do later
    const toInstallPreview = goodBlocks.filter(
      (b) =>
        b.part_id && (b.ppid || "").trim() && (b.current_bad_ppid || "").trim()
    );
    const actionEntriesPreview = Object.entries(goodActionByPPID).filter(
      ([goodPPID, cfg]) => !!cfg?.action && !!cfg?.original_bad_ppid
    );
    const replEntriesPreview = Object.entries(replacementByOldPPID).filter(
      ([oldBadPPID, replPPID]) => !!oldBadPPID && !!replPPID
    );

    // 1) Good part added to system + create BAD in inventory
    const goodAddedNotes = toInstallPreview.map((b) => {
      const name = partNameById.get(b.part_id) || `#${b.part_id}`;
      const goodPPID = String(b.ppid).toUpperCase().trim();
      const badPPID = String(b.current_bad_ppid).toUpperCase().trim();
      return ` - ${name} (${goodPPID}) has been added and (${badPPID}) has been placed into inventory as bad.`;
    });

    // 2) Good part currently in the system returned to inventory (Defective | Not Needed)
    //    Append the original BAD PPID that was reinstalled.
    const returnedNotes = actionEntriesPreview.map(([goodPPID, cfg]) => {
      const item = (unitParts || []).find(
        (r) => normPPID(r.ppid) === normPPID(goodPPID)
      );
      const name =
        item?.part_name ||
        (item?.part_id
          ? partNameById.get(item.part_id) || `#${item?.part_id}`
          : "Part");
      const reason = cfg.action === "defective" ? "defective" : "not needed";
      const original = String(cfg.original_bad_ppid || "")
        .toUpperCase()
        .trim();

      // e.g. " - BLUEFIELD 3 (DDDD...) has been placed back into inventory due to it being NOT NEEDED,
      //        and, original part ABC123 reinstalled."
      return ` - ${name} (${String(goodPPID)
        .toUpperCase()
        .trim()}) has been placed back into inventory due to it being ${reason}${
        original ? ` and original part (${original}) reinstalled` : ""
      }.`;
    });

    // 3) Pending part fulfilled by a replacement PPID
    const fulfilledNotes = replEntriesPreview.map(([oldBadPPID, goodPPID]) => {
      const item = (unitParts || []).find(
        (r) => normPPID(r.ppid) === normPPID(oldBadPPID)
      );
      const name =
        item?.part_name ||
        (item?.part_id
          ? partNameById.get(item.part_id) || `#${item?.part_id}`
          : "Part");
      return ` - Pending Part ${name} (${String(oldBadPPID)
        .toUpperCase()
        .trim()}) has been fulfilled by (${String(goodPPID)
        .toUpperCase()
        .trim()}).`;
    });

    // Final note lines (keep your existing order, then 1, 2, 3)
    const noteLines = [
      ...addedNotes, // existing: new bad parts flagged
      ...removedNotes, // existing: bad parts marked working
      ...goodAddedNotes, // 1) good parts added
      ...returnedNotes, // 2) good parts returned to inventory
      ...fulfilledNotes, // 3) pending fulfilled by replacement
    ];

    const noteToSend = noteLines.length
      ? `${note.trim()}${note.trim() ? "\n" : ""}${noteLines.join(" ")}`
      : note;

    if (movingToL10 && remainingBad > 0 && !hasAnyBadReplacementChosen) {
      setFormError(
        "Add a Replacement PPID for at least one defective part (or resolve/remove all) before moving to In L10."
      );
      return;
    }

    // REQUIRE: part, replacement good ppid, current defective ppid for each good block
    for (const b of goodBlocks) {
      // If any of these are set, we require all three (or simply require all three always if showing the block)
      const partOk = !!b.part_id;
      const goodOk = !!(b.ppid || "").trim();
      const badOk = !!(b.current_bad_ppid || "").trim();

      if (!(partOk && goodOk && badOk)) {
        setFormError(
          "For each Good Part, please select a Part, a Replacement PPID, and the Current Defective PPID."
        );
        setSubmitting(false);
        return;
      }

      // Optional sanity: prevent same PPID for good/bad
      if (
        String(b.ppid).toUpperCase().trim() ===
        String(b.current_bad_ppid).toUpperCase().trim()
      ) {
        setFormError(
          "Replacement PPID and Current Defective PPID must be different."
        );
        setSubmitting(false);
        return;
      }
    }

    // Validate "Not Needed / Defective" swaps for GOOD parts
    for (const [goodPPID, cfg] of Object.entries(goodActionByPPID)) {
      if (!cfg?.action) continue;
      if (!cfg.original_bad_ppid?.trim()) {
        setFormError(
          "For each Good part marked Not Needed or Defective, you must select an Original PPID (a BAD inventory PPID of the same part)."
        );
        return;
      }
      // Prevent same PPID
      if (
        goodPPID.toUpperCase().trim() ===
        cfg.original_bad_ppid.toUpperCase().trim()
      ) {
        setFormError(
          "Original PPID must be different from the current good PPID."
        );
        return;
      }
    }

    // Extra safety: no duplicate GOOD picks across both areas
    {
      const goods = new Set();
      for (const b of goodBlocks) {
        const v = normPPID(b.ppid);
        if (!v) continue;
        if (goods.has(v)) {
          setFormError("Duplicate GOOD PPID selected.");
          return;
        }
        goods.add(v);
      }
      for (const v of Object.values(replacementByOldPPID)) {
        const n = normPPID(v);
        if (!n) continue;
        if (goods.has(n)) {
          setFormError("Replacement PPID duplicates a Good Part selection.");
          return;
        }
        goods.add(n);
      }
    }
    // Extra safety: no duplicate BAD picks across pending/original
    {
      const bads = new Set();
      for (const b of pendingBlocks) {
        const v = normPPID(b.ppid);
        if (!v) continue;
        if (bads.has(v)) {
          setFormError("Duplicate BAD PPID in Pending Parts.");
          return;
        }
        bads.add(v);
      }
      for (const cfg of Object.values(goodActionByPPID)) {
        const n = normPPID(cfg?.original_bad_ppid);
        if (!n) continue;
        if (bads.has(n)) {
          setFormError("Original PPID duplicates a Pending Part.");
          return;
        }
        bads.add(n);
      }
    }

    // Require Root Cause + Sub Category for RMA VID/CID/PID or Sent to L11
    const destName = locations.find((l) => l.id === toId)?.name || "";
    const REQUIRES_RC = [
      "RMA VID",
      "RMA CID",
      "RMA PID",
      "Sent to L11",
    ].includes(destName);
    if (REQUIRES_RC && (!selectedRootCauseId || !selectedRootCauseSubId)) {
      setFormError(
        "Root Cause and Sub Category are required when moving to RMA (VID/CID/PID) or Sent to L11."
      );
      return;
    }

    // // Hard rule for L11: both category and sub-category must be NTF
    // if (destName === L11_NAME) {
    //   const catLabel =
    //     rootCauseOptions.find((o) => String(o.value) === String(rcEffectiveId))
    //       ?.label || "";
    //   const subLabel =
    //     rootCauseSubOptions.find(
    //       (o) => String(o.value) === String(rcSubEffectiveId)
    //     )?.label || "";

    //   if (catLabel !== "NTF" || subLabel !== "No Trouble Found") {
    //     setFormError(
    //       "When sending to L11, Root Cause and Sub Category must both be NTF."
    //     );
    //     return;
    //   }
    // }

    setFormError("");
    setSubmitting(true);

    try {
      // A) Install GOOD parts selected in "Add Good Part"
      //    and create the matching BAD item in inventory for the provided defective PPID
      if (goodBlocks.length > 0) {
        const toInstall = goodBlocks.filter(
          (b) =>
            b.part_id &&
            (b.ppid || "").trim() &&
            (b.current_bad_ppid || "").trim()
        );

        await Promise.all(
          toInstall.map(async (b) => {
            const goodPPID = String(b.ppid).toUpperCase().trim();
            const badPPID = String(b.current_bad_ppid).toUpperCase().trim();

            // 1) Move GOOD from inventory -> unit
            await updatePartItem(goodPPID, {
              place: "unit",
              unit_id: system.id,
            });

            // 2) Create BAD in inventory (same part)
            await createPartItem(badPPID, {
              part_id: b.part_id,
              place: "inventory",
              unit_id: null,
              is_functional: false,
            });
          })
        );
      }

      // B) Handle GOOD part actions: bring BAD from inventory into unit,
      //    then move the GOOD back to inventory (Not Needed) or mark BAD then move to inventory (Defective)
      if (Object.keys(goodActionByPPID).length > 0) {
        const entries = Object.entries(goodActionByPPID).filter(
          ([goodPPID, cfg]) => !!cfg?.action && !!cfg?.original_bad_ppid
        );

        await Promise.all(
          entries.map(async ([goodPPID, cfg]) => {
            const badPPID = String(cfg.original_bad_ppid).toUpperCase().trim();
            const good = String(goodPPID).toUpperCase().trim();

            // 1) Move BAD from inventory -> unit (keep nonfunctional)
            await updatePartItem(badPPID, {
              place: "unit",
              unit_id: system.id,
              is_functional: false,
            });

            // 2) Handle the GOOD currently in unit
            if (cfg.action === "not_needed") {
              // just send the good part back to inventory
              await updatePartItem(good, {
                place: "inventory",
                unit_id: null,
              });
            } else if (cfg.action === "defective") {
              // mark the good part as bad and move it back to inventory
              await updatePartItem(good, {
                is_functional: false,
                place: "inventory",
                unit_id: null,
              });
            }
          })
        );
      }

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
      // 1b) Replacements for BAD parts: move BAD out to inventory, move GOOD from inventory into unit
      const replEntries = Object.entries(replacementByOldPPID).filter(
        ([oldBadPPID, replPPID]) => !!oldBadPPID && !!replPPID
      );
      if (replEntries.length > 0) {
        await Promise.all(
          replEntries.map(async ([oldBadPPID, goodPPID]) => {
            // Move the BAD from unit -> inventory (keep nonfunctional)
            await updatePartItem(String(oldBadPPID).toUpperCase().trim(), {
              place: "inventory",
              unit_id: null,
              is_functional: false,
            });
            // Move the GOOD from inventory -> unit
            await updatePartItem(String(goodPPID).toUpperCase().trim(), {
              place: "unit",
              unit_id: system.id,
            });
          })
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
        await refreshUnitParts();
        setToRemovePPIDs(new Set());
      }

      // --- Root Cause submit (only when visible) ---
      if (showRootCauseControls) {
        const a = selectedRootCauseId;
        const b = selectedRootCauseSubId;

        const bothSet = a != null && b != null;
        const bothNull = a === null && b === null;

        if (!(bothSet || bothNull)) {
          setFormError(
            "Select both Root Cause and Sub Category, or clear both."
          );
          setSubmitting(false);
          return;
        }

        await updateSystemRootCause(serviceTag, {
          root_cause_id: bothSet ? a : null,
          root_cause_sub_category_id: bothSet ? b : null,
        });
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

      if (toId === 9) {
        const blob = await pdf(
          <SystemL10PassLabel
            systems={[
              {
                service_tag: system.service_tag,
                dpn: system.dpn,
                config: system.config,
                dell_customer: system.dell_customer,
              },
            ]}
          />
        ).toBlob();
        const url = URL.createObjectURL(blob);
        window.open(url);
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
                  config: system.config,
                  dell_customer: system.dell_customer,
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
      setGoodBlocks([]);
      setSelectedRootCauseId(null);
      setSelectedRootCauseSubId(null);
      setGoodActionByPPID({});
      setReplacementByOldPPID({});
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
    const inRMA = RMA_LOCATION_IDS.includes(locationId);
    const inL11 = locationId === 9; // "Sent to L11"

    // --- L11 flow: ask whether to print System ID or the L10 Pass label ---
    if (inL11) {
      const choice = await confirmPrintL11(); // "id" | "l11" | null
      if (!choice) return;

      if (choice === "l11") {
        // Print L10 Pass label
        const blob = await pdf(
          <SystemL10PassLabel
            systems={[
              {
                service_tag: system.service_tag,
                dpn: system.dpn,
                config: system.config,
                dell_customer: system.dell_customer,
              },
            ]}
          />
        ).toBlob();
        const url = URL.createObjectURL(blob);
        window.open(url);
        return;
      }

      // Fall through to ID label if "id"
      const blob = await pdf(
        <SystemPDFLabel
          systems={[
            {
              service_tag: system.service_tag,
              issue: system.issue,
              config: system.config,
              dpn: system.dpn,
              dell_customer: system.dell_customer,
              url: `${FRONTEND_URL}${system.service_tag}`,
            },
          ]}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      window.open(url);
      return;
    }

    // --- Existing logic below (Pending Parts / RMA / ID) ---

    // any bad parts currently tracked in the unit?
    const hasBadParts = (unitParts || []).some(
      (i) => i.is_functional === false
    );

    // helper: turn an item into a display name (no PPID)
    const nameOfPart = (i) =>
      (i?.part_name && i.part_name.trim()) ||
      (i?.part_id != null
        ? flatPartOptions.find((o) => o.value === i.part_id)?.label ??
          `#${i.part_id}`
        : "Part");

    // If there are bad parts, ask which label to print
    if (hasBadParts) {
      const choice = await confirmPrintPendingParts(); // 'id' or 'parts' | null
      if (!choice) return;

      if (choice === "parts") {
        const labelLines = (unitParts || [])
          .filter((i) => i.is_functional === false)
          .map((i) => nameOfPart(i))
          .sort((a, b) => a.localeCompare(b));

        const blob = await pdf(
          <SystemPendingPartsLabel parts={labelLines} />
        ).toBlob();
        const url = URL.createObjectURL(blob);
        window.open(url);
        return;
      }
      // else: fall through to System ID / RMA flow
    }

    // System ID / RMA labels
    let labelType = "id";
    let palletInfo = [];
    if (inRMA) {
      const selected = await confirmPrint(); // "id" or "rma"
      if (!selected) return;
      labelType = selected;
      palletInfo = await getSystemPallet(system.service_tag);
    }

    const blob = await pdf(
      labelType === "id" ? (
        <SystemPDFLabel
          systems={[
            {
              service_tag: system.service_tag,
              issue: system.issue,
              config: system.config,
              dpn: system.dpn,
              dell_customer: system.dell_customer,
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
              config: system.config,
              dell_customer: system.dell_customer,
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
  const isInPalletNumber =
    releasedPallets.find((p) =>
      p.active_systems?.some(
        (s) => (s.service_tag || "").toUpperCase() === target
      )
    )?.pallet_number ?? null;

  // Effective IDs for selects: prefer local pick, else backend value (stringified)
  const rcEffectiveId =
    selectedRootCauseId ??
    (system?.root_cause_id != null ? String(system.root_cause_id) : null);
  const rcSubEffectiveId =
    selectedRootCauseSubId ??
    (system?.root_cause_sub_category_id != null
      ? String(system.root_cause_sub_category_id)
      : null);

  return (
    <>
      <ConfirmDialog />
      {modal}
      <Toast />
      <ConfirPrintmModal />
      <ConfirPrintmModalPendingParts />
      <ConfirPrintmModalL11 />
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
                {!isRMA || (isRMA && isInPalletNumber) ? (
                  <button
                    type="button"
                    className="bg-green-600 hover:bg-green-700 text-white font-medium px-3 py-1.5 text-sm rounded shadow"
                    onClick={handlePrint}
                  >
                    Print Label
                  </button>
                ) : (
                  <></>
                )}
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
              <fieldset
                disabled={formDisabled}
                aria-disabled={formDisabled}
                className={formDisabled ? "opacity-60" : ""}
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
                  {!isResolved && (
                    <>
                      <label className="block text-sm font-medium text-gray-600 mb-1">
                        New Location:
                      </label>

                      <div className="flex flex-wrap gap-3">
                        {allowedNextLocations(currentLocation, locations).map(
                          (loc) => {
                            const isRMA = RMA_LOCATION_IDS.includes(loc.id);
                            const isL10 = L10_LOCATION_ID
                              ? loc.id === L10_LOCATION_ID
                              : loc.name === "In L10";

                            const rmaBlocked = isRMA && willHaveGoodAfterSubmit;
                            // Allow In L10 when at least one bad has a Replacement PPID chosen
                            const l10Blocked =
                              isL10 &&
                              willHaveBadAfterSubmit &&
                              !hasAnyBadReplacementChosen;
                            const disabled =
                              isResolved || rmaBlocked || l10Blocked;

                            const title = rmaBlocked
                              ? "Remove/return all good parts before moving to an RMA location."
                              : l10Blocked
                              ? "Add a Replacement PPID for at least one defective part to move to In L10."
                              : isResolved
                              ? "Resolved units can’t be moved."
                              : undefined;

                            return (
                              <button
                                type="button"
                                key={loc.id}
                                disabled={disabled}
                                title={title}
                                onClick={() => setToLocationId(loc.id)}
                                className={`px-4 py-2 rounded-lg shadow text-sm font-medium border ${
                                  toLocationId === loc.id
                                    ? "bg-blue-600 text-white border-blue-600"
                                    : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                                } ${
                                  disabled
                                    ? "opacity-50 cursor-not-allowed"
                                    : ""
                                }`}
                              >
                                {loc.name}
                              </button>
                            );
                          }
                        )}
                      </div>

                      <p className="text-xs text-gray-500 mt-1">
                        Please select a location above.
                      </p>
                    </>
                  )}
                  <div className="mt-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      {(isInPendingParts &&
                        toLocationId === 4 &&
                        system?.location === "Pending Parts") ||
                      (!isInPendingParts && toLocationId === 4) ? (
                        <button
                          type="button"
                          onClick={addBadPartBlock}
                          className="px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
                        >
                          + Add Bad Part
                        </button>
                      ) : null}
                      {canAddGoodParts && (
                        <button
                          type="button"
                          onClick={addGoodPartBlock}
                          className="px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
                        >
                          + Add Good Part
                        </button>
                      )}
                    </div>

                    {/* Good part blocks */}
                    {canAddGoodParts &&
                      (goodBlocks.length === 0 ? (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
                          No good parts to be added. Click “Add Good Part” to
                          begin.
                        </div>
                      ) : (
                        <div className="space-y-3 mt-2">
                          <label className="block text-sm font-medium text-gray-600">
                            Good Parts to be install into the unit
                          </label>

                          {goodBlocks.map((block) => {
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
                                <div className="flex-1 min-w-0">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Part
                                  </label>
                                  <Select
                                    isDisabled={formDisabled}
                                    instanceId={`good-part-${block.id}`}
                                    classNamePrefix="react-select"
                                    styles={select40Styles}
                                    isClearable
                                    isSearchable
                                    placeholder="Select part"
                                    value={partValue}
                                    onChange={async (opt) => {
                                      updateGoodBlock(
                                        block.id,
                                        "part_id",
                                        opt ? opt.value : null
                                      );
                                      if (opt?.value)
                                        await loadGoodOptions(opt.value);
                                    }}
                                    options={partOptions}
                                    filterOption={filterPartOption}
                                    components={{ Option: PartOption }}
                                    formatGroupLabel={PartGroupLabel}
                                  />
                                </div>

                                {/* PPID Select (GOOD in inventory) */}
                                <div className="flex-1 min-w-0">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Replacement PPID
                                  </label>
                                  <Select
                                    instanceId={`good-ppid-${block.id}`}
                                    classNamePrefix="react-select"
                                    styles={select40Styles}
                                    placeholder={
                                      block.part_id
                                        ? "Select PPID"
                                        : "Pick a part first"
                                    }
                                    isDisabled={!block.part_id || formDisabled}
                                    value={
                                      block.ppid
                                        ? {
                                            value: block.ppid,
                                            label: block.ppid,
                                          }
                                        : null
                                    }
                                    onMenuOpen={async () => {
                                      if (block.part_id)
                                        await loadGoodOptions(block.part_id);
                                    }}
                                    onChange={(opt) => {
                                      const next = opt ? opt.value : "";
                                      // Clear the same PPID if it was chosen as a Replacement for any BAD part
                                      if (next) {
                                        setReplacementByOldPPID((prev) => {
                                          const copy = { ...prev };
                                          for (const k of Object.keys(copy)) {
                                            if (
                                              normPPID(copy[k]) ===
                                              normPPID(next)
                                            )
                                              copy[k] = "";
                                          }
                                          return copy;
                                        });
                                      }
                                      updateGoodBlock(block.id, "ppid", next);
                                    }}
                                    options={
                                      (block.part_id &&
                                        getFilteredGoodOptions(
                                          block.part_id,
                                          block.ppid
                                        )) ||
                                      []
                                    }
                                  />
                                </div>

                                {/* NEW: Current Defective PPID (create as BAD in inventory) */}
                                <div className="flex-1 min-w-0">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Current Defective PPID
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="text"
                                    autoCapitalize="characters"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    placeholder="Scan or type PPID"
                                    value={block.current_bad_ppid}
                                    onChange={(e) =>
                                      updateGoodBlock(
                                        block.id,
                                        "current_bad_ppid",
                                        e.target.value
                                      )
                                    }
                                    onBlur={(e) =>
                                      updateGoodBlock(
                                        block.id,
                                        "current_bad_ppid",
                                        e.target.value.toUpperCase().trim()
                                      )
                                    }
                                    className={`w-full h-10 rounded-md border px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                      !block.current_bad_ppid || !block.part_id
                                        ? "border-amber-300"
                                        : "border-gray-300"
                                    }`}
                                  />
                                </div>

                                {/* Remove */}
                                <div className="md:w-auto">
                                  <button
                                    type="button"
                                    onClick={() => removeGoodBlock(block.id)}
                                    className="relative px-3 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white mt-5 whitespace-nowrap"
                                  >
                                    <span className="invisible block">
                                      Cancel
                                    </span>
                                    <span className="absolute inset-0 flex items-center justify-center">
                                      Cancel
                                    </span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}

                    {(isInPendingParts &&
                      toLocationId === 4 &&
                      system?.location === "Pending Parts") ||
                    (!isInPendingParts && toLocationId === 4) ? (
                      <>
                        {/* New blocks to add */}
                        {pendingBlocks.length === 0 ? (
                          <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
                            No pending parts to be added. Click “Add Bad Part”
                            to begin.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <label className="block text-sm font-medium text-gray-600">
                              Pending Parts the unit will need
                            </label>
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
                                  <div className="flex-1 min-w-0">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Part
                                    </label>
                                    <Select
                                      isDisabled={formDisabled}
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
                                      onBlur={(e) => {
                                        const v = e.target.value
                                          .toUpperCase()
                                          .trim();
                                        updateBlock(block.id, "ppid", v);

                                        if (v) {
                                          // If this BAD PPID was selected as an "Original PPID" anywhere, clear it
                                          setGoodActionByPPID((prev) => {
                                            const next = { ...prev };
                                            for (const g of Object.keys(next)) {
                                              if (
                                                normPPID(
                                                  next[g]?.original_bad_ppid
                                                ) === normPPID(v)
                                              ) {
                                                next[g] = {
                                                  ...next[g],
                                                  original_bad_ppid: "",
                                                };
                                              }
                                            }
                                            return next;
                                          });
                                        }
                                      }}
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
                    ) : null}
                    {/* Parts tracked inside unit */}
                    <div className="space-y-2">
                      {unitParts.length > 0 && (
                        <label className="block text-sm font-medium text-gray-600 mb-1">
                          {`Parts Tracked in unit`}
                        </label>
                      )}
                      {unitParts.map((item) => {
                        const isBad = item.is_functional === false;
                        const queued = toRemovePPIDs.has(item.ppid);
                        return (
                          <div
                            key={item.ppid}
                            className={`border border-gray-300 rounded-lg p-3 bg-white shadow-sm flex flex-col md:flex-row md:items-center gap-3 pb-5 ${
                              queued ? "border-red-300 bg-red-50 " : ""
                            }`}
                          >
                            <div className="flex-1">
                              <div className="block text-sm font-medium text-gray-700 mb-2">
                                <span
                                  className={`px-2 py-1 text-xs rounded-full ${
                                    isBad
                                      ? "bg-red-100 text-red-700"
                                      : "bg-green-100 text-green-700"
                                  }`}
                                >
                                  {isBad ? "Bad " : "Good "}
                                  Part
                                </span>
                              </div>
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
                            {/* Actions for BAD parts */}
                            {isBad && toLocationId != 4 && (
                              <div className="flex flex-col md:flex-row md:items-center gap-3">
                                {/* Replacement PPID (only when allowed) */}
                                {canAddGoodParts && (
                                  <div className="shrink-0 basis-[280px] w-[280px] ">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Replacement PPID
                                    </label>
                                    <Select
                                      instanceId={`repl-${item.ppid}`}
                                      classNamePrefix="react-select"
                                      styles={select40Styles}
                                      placeholder="Select replacement PPID"
                                      isClearable
                                      isDisabled={queued || formDisabled} // grey out if Mark as Working is active
                                      value={
                                        replacementByOldPPID[item.ppid]
                                          ? {
                                              value:
                                                replacementByOldPPID[item.ppid],
                                              label:
                                                replacementByOldPPID[item.ppid],
                                            }
                                          : null
                                      }
                                      onMenuOpen={async () => {
                                        await loadGoodOptions(item.part_id);
                                      }}
                                      onChange={(opt) => {
                                        const next = opt ? opt.value : "";
                                        setReplacementByOldPPID((s) => ({
                                          ...s,
                                          [item.ppid]: next,
                                        }));
                                        if (next) {
                                          // Clear the same PPID if it was chosen in any Good Part block
                                          setGoodBlocks((list) =>
                                            list.map((b) =>
                                              normPPID(b.ppid) ===
                                              normPPID(next)
                                                ? { ...b, ppid: "" }
                                                : b
                                            )
                                          );
                                        }
                                        // If a replacement is chosen, ensure "Mark as Working" is OFF (your existing code)
                                        if (opt?.value) {
                                          setToRemovePPIDs((prev) => {
                                            if (!prev.has(item.ppid))
                                              return prev;
                                            const nextSet = new Set(prev);
                                            nextSet.delete(item.ppid);
                                            return nextSet;
                                          });
                                        }
                                      }}
                                      options={getFilteredGoodOptions(
                                        item.part_id,
                                        replacementByOldPPID[item.ppid]
                                      )}
                                    />
                                  </div>
                                )}
                                {!isInPendingParts && (
                                  <div className="md:w-auto">
                                    {(() => {
                                      // Is there a chosen replacement PPID that exists in the GOOD inventory cache?
                                      const chosen =
                                        replacementByOldPPID[item.ppid];
                                      const validReplacement =
                                        !!chosen &&
                                        (
                                          goodOptionsCache.get(item.part_id) ||
                                          []
                                        ).some((opt) => opt.value === chosen);

                                      const disableMark =
                                        submitting || validReplacement;

                                      return (
                                        <button
                                          disabled={disableMark}
                                          type="button"
                                          onClick={() => {
                                            // Toggle mark-as-working, and if marking -> clear any replacement chosen
                                            toggleRemovePPID(item.ppid);
                                            setReplacementByOldPPID((s) => {
                                              const next = { ...s };
                                              // If we just queued Mark as Working, nuke the replacement
                                              if (
                                                !toRemovePPIDs.has(item.ppid)
                                              ) {
                                                next[item.ppid] = "";
                                              }
                                              return next;
                                            });
                                          }}
                                          className={`relative px-3 py-2 rounded-md text-white whitespace-nowrap mt-5 
                                      ${
                                        queued
                                          ? "bg-gray-500 hover:bg-gray-600"
                                          : disableMark
                                          ? "bg-gray-400 cursor-not-allowed"
                                          : "bg-green-600 hover:bg-gren-700"
                                      }`}
                                          title={
                                            validReplacement
                                              ? "Disable or clear the replacement to mark as working"
                                              : undefined
                                          }
                                        >
                                          <span className="invisible block">
                                            Mark as Working
                                          </span>
                                          <span className="absolute inset-0 flex items-center justify-center">
                                            {queued
                                              ? "Undo"
                                              : "Mark as Working"}
                                          </span>
                                        </button>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Actions for GOOD parts */}
                            {!isBad && toLocationId != 4 && (
                              <div className="flex flex-col md:flex-row md:items-center gap-3">
                                {/* "Original PPID" BAD inventory selector, shown only when an action is selected */}
                                {goodActionByPPID[item.ppid]?.action && (
                                  <div className="shrink-0 basis-[280px] w-[280px]">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Original PPID
                                    </label>
                                    <Select
                                      isDisabled={formDisabled}
                                      instanceId={`orig-${item.ppid}`}
                                      classNamePrefix="react-select"
                                      styles={select40Styles}
                                      placeholder="Select BAD PPID"
                                      isClearable
                                      value={
                                        goodActionByPPID[item.ppid]
                                          ?.original_bad_ppid
                                          ? {
                                              value:
                                                goodActionByPPID[item.ppid]
                                                  .original_bad_ppid,
                                              label:
                                                goodActionByPPID[item.ppid]
                                                  .original_bad_ppid,
                                            }
                                          : null
                                      }
                                      onMenuOpen={async () => {
                                        await loadBadOptions(item.part_id);
                                      }}
                                      onChange={(opt) => {
                                        const next = opt ? opt.value : "";
                                        setGoodActionByPPID((prev) => ({
                                          ...prev,
                                          [item.ppid]: {
                                            action: prev[item.ppid]?.action,
                                            original_bad_ppid: next,
                                          },
                                        }));

                                        if (next) {
                                          // Clear the same PPID if it was typed in any Pending block
                                          setPendingBlocks((list) =>
                                            list.map((b) =>
                                              normPPID(b.ppid) ===
                                              normPPID(next)
                                                ? { ...b, ppid: "" }
                                                : b
                                            )
                                          );
                                        }
                                      }}
                                      options={getFilteredBadOptions(
                                        item.part_id,
                                        goodActionByPPID[item.ppid]
                                          ?.original_bad_ppid
                                      )}
                                    />
                                  </div>
                                )}
                                {isInDebugWistron &&
                                  !isResolved /* Two mutually-exclusive buttons */ && (
                                    <div className="flex gap-2 mt-5">
                                      {["not_needed", "defective"].map(
                                        (kind) => {
                                          const selected =
                                            goodActionByPPID[item.ppid]
                                              ?.action === kind;
                                          const label =
                                            kind === "not_needed"
                                              ? "Not Needed"
                                              : "Defective";
                                          return (
                                            <button
                                              key={kind}
                                              type="button"
                                              onClick={() => {
                                                setGoodActionByPPID((prev) => {
                                                  const curr =
                                                    prev[item.ppid]?.action;
                                                  // toggle: if user clicks same action, clear it; otherwise set/replace
                                                  if (curr === kind) {
                                                    const {
                                                      [item.ppid]: _,
                                                      ...rest
                                                    } = prev;
                                                    return rest;
                                                  }
                                                  return {
                                                    ...prev,
                                                    [item.ppid]: {
                                                      action: kind,
                                                      original_bad_ppid:
                                                        prev[item.ppid]
                                                          ?.original_bad_ppid ||
                                                        "",
                                                    },
                                                  };
                                                });
                                              }}
                                              className={`px-3 py-2 rounded-md text-white ${
                                                selected
                                                  ? kind === "not_needed"
                                                    ? "bg-blue-600"
                                                    : "bg-amber-600"
                                                  : "bg-gray-500 hover:bg-gray-600"
                                              }`}
                                            >
                                              {label}
                                            </button>
                                          );
                                        }
                                      )}
                                    </div>
                                  )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {showRootCauseControls && (
                    <div className="mt-4 p-4 rounded-lg bg-white border border-gray-200 shadow-sm">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Root Cause
                      </label>

                      {(() => {
                        const optsReady =
                          rootCauseOptions.length > 0 &&
                          rootCauseSubOptions.length > 0;

                        // Always render Selects. When resolved, they are disabled but still show backend values.
                        return (
                          <div className="flex flex-col md:flex-row gap-3">
                            {!isResolved ? (
                              <>
                                <div className="flex-1 min-w-0">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Category
                                  </label>

                                  <Select
                                    isDisabled={formDisabled || !optsReady}
                                    instanceId="root-cause"
                                    classNamePrefix="react-select"
                                    styles={select40Styles}
                                    isClearable
                                    isSearchable
                                    placeholder={
                                      optsReady ? "Select category" : "Loading…"
                                    }
                                    value={
                                      rootCauseOptions.find(
                                        (o) =>
                                          String(o.value) ===
                                          String(rcEffectiveId)
                                      ) || null
                                    }
                                    onChange={(opt) => {
                                      const next = opt
                                        ? String(opt.value)
                                        : null;
                                      setSelectedRootCauseId(next);
                                      if (next === null) {
                                        // if Category was cleared, also clear Sub Category
                                        setSelectedRootCauseSubId(null);
                                      }
                                    }}
                                    options={rootCauseOptions}
                                  />
                                </div>

                                <div className="flex-1 min-w-0">
                                  <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Sub Category
                                  </label>
                                  <Select
                                    isDisabled={formDisabled || !optsReady}
                                    instanceId="root-cause-sub"
                                    classNamePrefix="react-select"
                                    styles={select40Styles}
                                    isClearable
                                    isSearchable
                                    placeholder={
                                      !optsReady
                                        ? "Loading…"
                                        : "Select sub-category"
                                    }
                                    value={
                                      rootCauseSubOptions.find(
                                        (o) =>
                                          String(o.value) ===
                                          String(rcSubEffectiveId)
                                      ) || null
                                    }
                                    onChange={(opt) =>
                                      setSelectedRootCauseSubId(
                                        opt ? String(opt.value) : null
                                      )
                                    }
                                    options={rootCauseSubOptions}
                                  />
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                    Category
                                  </div>
                                  <h1 className="mt-1 text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">
                                    {system?.root_cause || (
                                      <span className="text-gray-400">
                                        Not set
                                      </span>
                                    )}
                                    <span> - </span>
                                    {system?.root_cause_sub_category || (
                                      <span className="text-gray-400">
                                        Not set
                                      </span>
                                    )}
                                  </h1>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {(toLocationId === 5 ||
                    (system?.location === "In L10" &&
                      toLocationId != 9 &&
                      toLocationId != 8 &&
                      toLocationId != 7 &&
                      toLocationId != 6)) && (
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
                              isDisabled={formDisabled}
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
                                  .find(
                                    (opt) => opt.value === selectedStation
                                  ) || null
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
                  <label className="block text-sm font-medium text-gray-600 mb-1 mt-2">
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
                      This system has been RMA'd but has not shipped yet, you
                      can view it on pallet
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
              </fieldset>
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
                    alignByField={{
                      note: "left",
                      moved_by: "right",
                      changed_at: "right",
                      to_location: "left",
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
