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
// --- parts select helpers ---

// 1) group and sort parts into react-select "grouped options"
const buildGroupedPartOptions = (parts = []) => {
  const byCat = new Map();

  parts.forEach((p) => {
    const cat = p.category_name || "Uncategorized";
    const dpn = p.dpn || "";
    const name = p.name || "";

    // This is what will show in the closed select:
    // [Part Name] [Part Category] - [DPN]
    const displayLabel = `${name} ${cat}${dpn ? ` [${dpn}]` : ""}`;

    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({
      value: p.id,
      label: displayLabel, // <-- used by react-select singleValue
      name, // <-- keep raw part name for notes
      dpn,
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

// 2) search by part label OR category name OR DPN
const filterPartOption = (option, rawInput) => {
  if (!rawInput) return true;
  const term = rawInput.toLowerCase();

  const label = (option?.label || "").toLowerCase();
  const cat = (
    option?.data?.category_name ??
    option?.category_name ??
    ""
  ).toLowerCase();
  const dpn = (option?.data?.dpn ?? option?.dpn ?? "").toLowerCase();

  return (
    label.includes(term) || cat.includes(term) || dpn.includes(term) // <-- NEW: searchable by DPN
  );
};

// 3) custom  line (shows DPN + tiny category chip)
const PartOption = (props) => {
  const cat = props.data.category_name;
  const dpn = props.data.dpn;

  return (
    <components.Option {...props}>
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-gray-800 truncate">
          {props.data.name || props.label}
        </div>
        <div className="flex items-center justify-between gap-2">
          {dpn && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-mono">
              {dpn}
            </span>
          )}
          <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-700">
            {cat}
          </span>
        </div>
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

const PULL_FROM_UNIT_VALUE = "__PULL_FROM_UNIT__";

const GoodPPIDOption = (props) => {
  const { data } = props;

  if (data.value === PULL_FROM_UNIT_VALUE) {
    return (
      <components.Option {...props}>
        <span className="text-blue-600 font-semibold">{data.label}</span>
      </components.Option>
    );
  }

  return <components.Option {...props} />;
};

const GoodPPIDSingleValue = (props) => {
  const { data } = props;

  if (data.value === PULL_FROM_UNIT_VALUE) {
    return (
      <components.SingleValue {...props}>
        <span className="text-blue-600 font-semibold">{data.label}</span>
      </components.SingleValue>
    );
  }

  return <components.SingleValue {...props} />;
};

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

  const [serverTimeZone, setServerTimeZone] = useState("UTC");

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

  // For GOOD parts marked Not Needed / Defective:
  // - which inventory BAD parts were originally swapped from this unit
  // - and which ones had their Original PPID auto-locked
  const [invOriginalsByPPID, setInvOriginalsByPPID] = useState({}); // goodPPID -> [{ppid, ...}]
  const [autoOriginalLockedByPPID, setAutoOriginalLockedByPPID] = useState({}); // goodPPID -> true

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
    getSystems,
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
  const [donorSystems, setDonorSystems] = useState([]);

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

  const addGoodPartBlock = () => {
    setGoodBlocks((b) => [
      ...b,
      {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        part_id: null,
        // Replacement PPID select value or PULL_FROM_UNIT_VALUE
        ppid: "",
        // Current defective PPID in THIS unit
        current_bad_ppid: "",
        // Donor info when using "Pull from Unit"
        donor_unit_id: null,
        donor_ppid: "",
      },
    ]);
  };

  const donorUnitOptions = useMemo(
    () =>
      donorSystems
        // ⬇️ exclude the current unit
        .filter((u) => !system || u.id !== system.id)
        .map((u) => ({
          value: u.id,
          label: `${u.service_tag} – ${u.location || ""}`,
        })),
    [donorSystems, system?.id]
  );

  const donorUnitsById = useMemo(() => {
    const m = new Map();
    donorSystems.forEach((u) => m.set(u.id, u));
    return m;
  }, [donorSystems]);

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

  // Map part_id -> part name (not "DPN - name") for notes
  const partNameById = useMemo(() => {
    const m = new Map();
    flatPartOptions.forEach((o) => m.set(o.value, o.name || o.label));
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
    (isInDebugWistron &&
      toLocationId !== 4 &&
      !isInPendingParts &&
      !isInL10 &&
      toLocationId != 6 &&
      toLocationId != 7 &&
      toLocationId != 8) || // current location is Debug, but not sending to Pending
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
        allSystemsRaw,
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
        getSystems({ all: true }), // ⬅️ all units
      ]);

      const allSystems =
        allSystemsRaw?.results && Array.isArray(allSystemsRaw.results)
          ? allSystemsRaw.results
          : Array.isArray(allSystemsRaw)
          ? allSystemsRaw
          : [];

      // For each unit:
      // isRMA = in RMA VID/CID/PID
      // isInPalletNumber = on an OPEN pallet’s active_systems
      const donors = allSystems.filter((u) => {
        const locName = u.location;
        const isRMAUnit = RMA_LOCATION_NAMES.includes(locName);
        const isL11Unit = locName === L11_NAME;
        const isInPalletNumber = !!releasedPalletsData?.find((p) =>
          p.active_systems?.some(
            (s) =>
              (s.service_tag || "").toUpperCase() ===
              (u.service_tag || "").toUpperCase()
          )
        );

        // keep all units that are NOT inactive RMA
        // (!isRMA || (isRMA && isInPalletNumber))
        return (!isRMAUnit || (isRMAUnit && isInPalletNumber)) && !isL11Unit;
      });

      setSystem(systemsData);
      setLocations(locationsData);
      setHistory(historyData);
      setStations(stationData);
      setreleasedPallets(releasedPalletsData);
      setUnitParts(partItemsRows || []);
      setDonorSystems(donors); // ⬅️ donor candidates
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

  const getEffectiveGoodPPID = (block) => {
    if (!block) return "";
    if (block.ppid === PULL_FROM_UNIT_VALUE) return normPPID(block.donor_ppid);
    return normPPID(block.ppid);
  };

  // --- Build live sets of currently-picked PPIDs (GOOD/BAD) across the whole form ---
  const selectedGoodPPIDs = useMemo(() => {
    const fromGoodBlocks = goodBlocks
      .map((b) => getEffectiveGoodPPID(b))
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

  // All BAD parts of this part_id that "belong" to this unit (last_unit_id == this unit),
  // including ones in other units and in inventory. We also annotate whether the
  // owning unit is still "live" (active or RMA with an open pallet) using donorSystems.
  const findOriginalMatches = async (partId) => {
    if (!partId || !system?.id) return [];
    const thisUnitId = Number(system.id);

    try {
      const [unitRows, invRows] = await Promise.all([
        getPartItems({
          place: "unit",
          is_functional: false,
          part_id: partId,
        }),
        getPartItems({
          place: "inventory",
          is_functional: false,
          part_id: partId,
        }),
      ]);

      // BAD parts currently in some unit, whose last_unit_id == this unit
      const unitMatches = (unitRows || [])
        .filter((r) => Number(r.last_unit_id) === thisUnitId)
        .filter((r) => !r.replacement_defective) // NEW: ignore already-marked replacements
        // Ignore bad parts that currently live in THIS unit
        .filter((r) => Number(r.unit_id) !== thisUnitId)
        .map((r) => {
          const ownerUnitId = r.unit_id ? Number(r.unit_id) : null;
          const owner = donorSystems.find((u) => u.id === ownerUnitId);

          return {
            ...r,
            place: "unit",
            owner_unit_id: ownerUnitId,
            owner_service_tag: r.unit_service_tag || owner?.service_tag || null,
            // "live origin" = in donorSystems (active or RMA with open pallet, not Sent to L11)
            is_live_origin: !!owner,
          };
        });

      // BAD parts sitting in inventory whose last_unit_id == this unit
      const inventoryMatches = (invRows || [])
        .filter((r) => Number(r.last_unit_id) === thisUnitId)
        .filter((r) => !r.replacement_defective) // NEW: ignore already-marked replacements
        .map((r) => ({
          ...r,
          place: "inventory",
          owner_unit_id: null,
          owner_service_tag: null,
          is_live_origin: false, // inventory never counts as "live unit"
        }));

      return [...unitMatches, ...inventoryMatches];
    } catch (e) {
      console.error("findOriginalMatches failed for part", partId, e);
      return [];
    }
  };

  // --- Auto-detect "original" BAD part for a GOOD part in this unit ---
  // Priority: always use matches where last_unit_id == this unit.
  // We keep all matches (live + shipped), and auto-lock only when there
  // is exactly one match AND it comes from a live unit.
  const autoSelectOriginalForGood = async (goodPPID, partId) => {
    if (!partId || !system?.id) return;

    try {
      const matches = await findOriginalMatches(partId);

      setInvOriginalsByPPID((prev) => ({
        ...prev,
        [goodPPID]: matches,
      }));

      if (matches.length === 1) {
        const chosen = matches[0];

        setGoodActionByPPID((prev) => {
          const prevCfg = prev[goodPPID] || {};
          const nextCfg = {
            ...prevCfg,
            original_bad_ppid: chosen.ppid,
          };

          // ✅ Only force Defective if this is from a non-live *unit* donor
          // Inventory originals should NEVER force "Defective".
          const isNonLiveDonor =
            chosen.place === "unit" &&
            !!chosen.owner_unit_id &&
            !chosen.is_live_origin;

          if (isNonLiveDonor && prevCfg.action === "not_needed") {
            nextCfg.action = "defective";
          }

          return {
            ...prev,
            [goodPPID]: nextCfg,
          };
        });

        setAutoOriginalLockedByPPID((prev) => ({
          ...prev,
          [goodPPID]: true,
        }));
      } else {
        // Multiple or zero matches → user must choose, no auto-lock
        setAutoOriginalLockedByPPID((prev) => {
          const copy = { ...prev };
          delete copy[goodPPID];
          return copy;
        });
      }
    } catch (err) {
      console.error("Failed to auto-select original PPID for", goodPPID, err);
    }
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
        setServerTimeZone(serverZone);

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
              ? formatDateHumanReadable(new Date(modLux.toISO()), serverZone)
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
    const addFromGoodBlocks = goodBlocks.filter((b) => {
      if (!b.part_id || !(b.current_bad_ppid || "").trim()) return false;

      if (b.ppid === PULL_FROM_UNIT_VALUE) {
        return !!(b.donor_ppid || "").trim();
      }
      return !!(b.ppid || "").trim();
    }).length;

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
    // ---- Existing note lines (Pending Parts) ----
    const addedNotes = toCreate.map((b) => {
      const name = partNameById.get(b.part_id) || `#${b.part_id}`;
      const ppid = String(b.ppid).toUpperCase().trim();
      return ` - ${name} (${ppid}) in system identified as non working with none in stock.`;
    });

    const removedNotes = removing.map((ppid) => {
      const item = (unitParts || []).find((r) => r.ppid === ppid);
      const name =
        item?.part_name ||
        (item?.part_id
          ? partNameById.get(item.part_id) || `#${item.part_id}`
          : "Part");
      return ` - ${name} (${ppid}) in system identified as working.`;
    });

    // ---- NEW preview lists (must be declared BEFORE they’re used) ----
    const toInstallPreview = goodBlocks.filter(
      (b) =>
        b.part_id &&
        (b.ppid || "").trim() &&
        b.ppid !== PULL_FROM_UNIT_VALUE &&
        (b.current_bad_ppid || "").trim()
    );

    const pullFromUnitPreview = goodBlocks.filter(
      (b) =>
        b.part_id &&
        b.ppid === PULL_FROM_UNIT_VALUE &&
        (b.current_bad_ppid || "").trim() &&
        (b.donor_ppid || "").trim() &&
        b.donor_unit_id
    );

    const pullUnitNotes = pullFromUnitPreview.map((b) => {
      const name = partNameById.get(b.part_id) || `#${b.part_id}`;
      const goodPPID = String(b.donor_ppid).toUpperCase().trim();
      const badPPID = String(b.current_bad_ppid).toUpperCase().trim();
      const donor = donorUnitsById.get(b.donor_unit_id);
      const donorTag = donor?.service_tag || `unit #${b.donor_unit_id}`;

      return ` - ${name} (${goodPPID}) has been pulled from ${donorTag}, and (${badPPID}) has been recorded as bad in the donor unit.`;
    });

    // 🔹 PREVIEW ARRAYS FOR NOTES (just like the actual mutations later)
    const actionEntriesPreview = Object.entries(goodActionByPPID).filter(
      ([goodPPID, cfg]) => !!cfg?.action && !!cfg?.original_bad_ppid
    );

    const replEntriesPreview = Object.entries(replacementByOldPPID).filter(
      ([oldBadPPID, replPPID]) => !!oldBadPPID && !!replPPID
    );

    // 1) Good part added to the system, bad part placed into inventory
    const goodAddedNotes = toInstallPreview.map((b) => {
      const name = partNameById.get(b.part_id) || `#${b.part_id}`;
      const goodPPID = String(b.ppid).toUpperCase().trim();
      const badPPID = String(b.current_bad_ppid).toUpperCase().trim();
      return ` - ${name} (${goodPPID}) has been added and (${badPPID}) has been placed into inventory as bad.`;
    });

    // 2) Good part currently in the system returned / reconciled (Defective | Not Needed)
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
      const goodUpper = String(goodPPID).toUpperCase().trim();

      // Look up the selected original to see if it came from a non-live donor
      const matches = invOriginalsByPPID[goodPPID] || [];
      const originalNorm = normPPID(original);
      const selectedMatch =
        matches.find((m) => normPPID(m.ppid) === originalNorm) || null;

      const isInactiveDonor =
        cfg.action === "defective" &&
        !!selectedMatch &&
        !!selectedMatch.owner_unit_id &&
        !selectedMatch.is_live_origin;

      if (isInactiveDonor && original) {
        // Special case: donor system is shipped / inactive, no real "swap" possible
        return ` - ${name} (${goodUpper}) has been marked as defective in this unit because the original system has already shipped or is inactive; original part (${original}) was not reinstalled.`;
      }

      // Default messaging (live donor / inventory scenarios)
      return ` - ${name} (${goodUpper}) has been placed back into its original location due to it being ${reason}${
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
          ? partNameById.get(item.part_id) || `#${item.part_id}`
          : "Part");
      return ` - Pending Part ${name} (${String(oldBadPPID)
        .toUpperCase()
        .trim()}) has been fulfilled by (${String(goodPPID)
        .toUpperCase()
        .trim()}).`;
    });

    // Final note lines
    const noteLines = [
      ...addedNotes,
      ...removedNotes,
      ...goodAddedNotes,
      ...pullUnitNotes,
      ...returnedNotes,
      ...fulfilledNotes,
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

    // REQUIRE: part, good PPID (inventory or donor), current defective ppid for each good block
    for (const b of goodBlocks) {
      const partOk = !!b.part_id;
      const goodOk = !!getEffectiveGoodPPID(b);
      const badOk = !!(b.current_bad_ppid || "").trim();

      // When using Pull from Unit, donor unit is mandatory
      const donorOk =
        b.ppid === PULL_FROM_UNIT_VALUE
          ? !!b.donor_unit_id && !!(b.donor_ppid || "").trim()
          : true;

      if (!(partOk && goodOk && badOk && donorOk)) {
        setFormError(
          "For each Good Part, please select a Part, a Replacement PPID (or Donor PPID), the Current Defective PPID, and a Donor Unit when pulling from a unit."
        );
        setSubmitting(false);
        return;
      }

      const effectiveGood = getEffectiveGoodPPID(b);
      if (effectiveGood && effectiveGood === normPPID(b.current_bad_ppid)) {
        setFormError(
          "Replacement/Donor PPID and Current Defective PPID must be different."
        );
        setSubmitting(false);
        return;
      }
    }

    // Validate "Not Needed / Defective" swaps for GOOD parts
    for (const [goodPPID, cfg] of Object.entries(goodActionByPPID)) {
      if (!cfg?.action) continue;

      const good = normPPID(goodPPID);

      if (!cfg.original_bad_ppid?.trim()) {
        setFormError(
          "For each Good part marked Not Needed or Defective, you must select an Original PPID."
        );
        return;
      }

      if (good === normPPID(cfg.original_bad_ppid)) {
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
        const v = getEffectiveGoodPPID(b);
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
      // Collect per-unit notes for any unit↔unit part transactions in this submit.
      // key = donor service_tag (UPPERCASE), value = [noteLine, ...]
      const donorLocationNotes = {};

      const addDonorNote = (svcTag, line) => {
        if (!svcTag || !line) return;
        const key = String(svcTag).trim().toUpperCase();
        donorLocationNotes[key] = [...(donorLocationNotes[key] || []), line];
      };

      // A) Install GOOD parts selected in "Add Good Part"
      if (goodBlocks.length > 0) {
        const toProcess = goodBlocks.filter(
          (b) =>
            b.part_id &&
            (b.current_bad_ppid || "").trim() &&
            ((b.ppid && b.ppid !== PULL_FROM_UNIT_VALUE) ||
              (b.ppid === PULL_FROM_UNIT_VALUE &&
                (b.donor_ppid || "").trim() &&
                b.donor_unit_id))
        );

        await Promise.all(
          toProcess.map(async (b) => {
            const partId = b.part_id;
            const badPPID = String(b.current_bad_ppid).toUpperCase().trim();

            if (b.ppid === PULL_FROM_UNIT_VALUE) {
              // --- Donor flow ---
              const donorGoodPPID = String(b.donor_ppid).toUpperCase().trim();
              const donorUnitId = b.donor_unit_id;

              // 1) Add GOOD part into CURRENT unit
              //    last_unit_id = donor unit (where it came from)
              await createPartItem(donorGoodPPID, {
                part_id: partId,
                place: "unit",
                unit_id: system.id,
                is_functional: true,
                last_unit_id: donorUnitId,
              });

              // 2) Add BAD part into DONOR unit
              //    last_unit_id = current unit (where the bad part originated)
              await createPartItem(badPPID, {
                part_id: partId,
                place: "unit",
                unit_id: donorUnitId,
                is_functional: false,
                last_unit_id: system.id,
              });

              // Record a donor-unit note for this unit↔unit transaction
              const donorUnit = donorUnitsById.get(donorUnitId);
              const donorTag = donorUnit?.service_tag;
              const partName = partNameById.get(partId) || `#${partId}`;

              if (donorTag) {
                addDonorNote(
                  donorTag,
                  ` - ${partName} (${donorGoodPPID}) was pulled from this system and installed into ${system.service_tag}; ` +
                    `(${badPPID}) has been recorded here as non-working as part of this swap.`
                );
              }
            } else {
              // --- Normal inventory flow ---
              const goodPPID = String(b.ppid).toUpperCase().trim();

              // 1) Move GOOD from inventory -> unit (no last_unit change)
              await updatePartItem(goodPPID, {
                place: "unit",
                unit_id: system.id,
              });

              // 2) Create BAD in inventory (same part), originating from this unit
              await createPartItem(badPPID, {
                part_id: partId,
                place: "inventory",
                unit_id: null,
                is_functional: false,
                last_unit_id: system.id,
              });
            }
          })
        );
      }

      // B) Handle GOOD part actions:
      //    - If original_bad_ppid belongs to a live unit (matches last_unit_id == this unit and owner in donorSystems):
      //         → delete GOOD, move that BAD back into this unit.
      //    - If original_bad_ppid belongs to a shipped / inactive unit or inventory (with last_unit_id == this unit):
      //         → only Defective is allowed; mark GOOD as bad in this unit, leave the matched part untouched.
      //    - If there are no last_unit matches, original_bad_ppid comes from inventory:
      //         → inventory swap (GOOD → inventory, BAD → unit).
      if (Object.keys(goodActionByPPID).length > 0) {
        const entries = Object.entries(goodActionByPPID).filter(
          ([, cfg]) => !!cfg?.action
        );

        await Promise.all(
          entries.map(async ([goodPPID, cfg]) => {
            const good = normPPID(goodPPID);
            const action = cfg.action; // "not_needed" | "defective"

            const goodItem = (unitParts || []).find(
              (r) => normPPID(r.ppid) === good
            );
            if (!goodItem) return;

            // Good part originally came from inventory (no last_unit_id recorded)
            const fromInventory = goodItem.last_unit_id == null;

            const matches = invOriginalsByPPID[goodPPID] || [];
            const origBadNorm = normPPID(cfg.original_bad_ppid || "");
            const candidate = origBadNorm
              ? matches.find((m) => normPPID(m.ppid) === origBadNorm)
              : null;

            // Helper: scrap borrowed good (move to inventory as bad, then delete)
            const scrapBorrowedGood = async () => {
              await updatePartItem(good, {
                place: "inventory",
                unit_id: null,
                is_functional: false,
                // NOTE: for Not Needed, do NOT overwrite last_unit_id here.
                // We want to preserve where this good part actually came from
                // (e.g. the donor unit), not stamp it with the current unit.
              });
              await deletePartItem(good);
            };

            // 1) "Live unit" origin (donor logic, excluding current unit)
            if (
              candidate &&
              candidate.place === "unit" &&
              candidate.is_live_origin
            ) {
              const originUnitId = candidate.unit_id;

              // Always move the original BAD back into the CURRENT unit
              await updatePartItem(candidate.ppid, {
                place: "unit",
                unit_id: system.id,
                is_functional: false,
                last_unit_id: originUnitId,
              });

              if (action === "not_needed") {
                // NOT NEEDED:
                // - delete good part (same as before)
                //   (we move it to inventory as bad, then delete record)
                await scrapBorrowedGood();
              } else if (action === "defective") {
                // DEFECTIVE:
                // - move GOOD part back to the donor (origin) unit
                // - mark it as defective there
                await updatePartItem(good, {
                  place: "unit",
                  unit_id: originUnitId,
                  is_functional: false,
                  // this unit "used up" the part; record that if you want
                  last_unit_id: system.id,
                });
              }
              // Donor unit note for this live-unit reconciliation
              const originUnit = donorUnitsById.get(originUnitId);
              const originTag =
                originUnit?.service_tag || candidate.owner_service_tag || null;

              if (originTag) {
                const partName =
                  goodItem?.part_name ||
                  (goodItem?.part_id
                    ? partNameById.get(goodItem.part_id) ||
                      `#${goodItem.part_id}`
                    : "Part");
                const reason =
                  action === "defective" ? "defective" : "not needed";

                addDonorNote(
                  originTag,
                  ` - ${partName} (${good}) was reconciled with ${system.service_tag} via unit-to-unit swap (original BAD: ${candidate.ppid}, marked ${reason} in the process).`
                );
              }

              return;
            }

            // 2) Origin is shipped / inactive unit or inventory (still with last_unit_id = this unit).
            //    UI should only allow Defective here; we just mark the GOOD as bad in this unit.
            //    NEW: if this was a non-live donor unit, mark that original BAD as replacement_defective
            //    so it won't be offered again as an "Original PPID".
            if (candidate && !candidate.is_live_origin) {
              // If this original came from a non-live donor unit (not inventory) and we're marking
              // the GOOD here as defective, flag that original as "replacement_defective".
              // - owner_unit_id != null  -> real donor unit
              // - place === "unit"       -> currently lives in a unit
              // - is_live_origin === false -> donor is shipped/inactive (not in donorSystems)
              if (
                candidate.owner_unit_id && // donor unit, not inventory
                candidate.place === "unit" &&
                action === "defective"
              ) {
                await updatePartItem(candidate.ppid, {
                  replacement_defective: true,
                });
              }

              if (fromInventory) {
                // Good part was originally from inventory (last_unit_id is null on the good).
                // We have a matching original BAD (candidate) in inventory with last_unit_id = this unit.
                // Behavior:
                //   * Move the original BAD back into THIS unit.
                //   * Send the GOOD back to inventory as good (Not Needed) or bad (Defective).

                // 1) Move original bad into this unit
                await updatePartItem(candidate.ppid, {
                  place: "unit",
                  unit_id: system.id,
                  is_functional: false, // original was tracked as bad
                  // keep candidate.last_unit_id as-is (it should already be this unit)
                });

                // 2) Move the good part back to inventory
                const goodUpdate = {
                  place: "inventory",
                  unit_id: null,
                  is_functional: action === "defective" ? false : true,
                };

                if (action === "defective") {
                  // This unit actually consumed/failed the part; stamp provenance now.
                  goodUpdate.last_unit_id = system.id;
                }

                await updatePartItem(good, goodUpdate);
              } else {
                // Origin is a shipped/inactive donor unit or an inventory part that
                // already has last_unit_id tied to this unit.
                if (action === "defective") {
                  // Mark it bad in this unit (this unit keeps the consumed part)
                  await updatePartItem(good, {
                    place: "unit",
                    unit_id: system.id,
                    is_functional: false,
                  });
                } else {
                  // Not Needed: simple return-to-inventory as good, but *don’t* touch last_unit_id
                  await updatePartItem(good, {
                    place: "inventory",
                    unit_id: null,
                    is_functional: true,
                  });
                }
              }
              return;
            }

            // 3) No last_unit matches for this unit → pure inventory swap
            const badPPID = origBadNorm;
            if (!badPPID) {
              // nothing to do if we somehow got here without an original
              return;
            }

            // Move the BAD from inventory -> unit (keep nonfunctional)
            await updatePartItem(badPPID, {
              place: "unit",
              unit_id: system.id,
              is_functional: false,
            });

            // Move the GOOD from unit -> inventory, functional/non-functional based on action.
            // For Defective we record this unit as the consumer; for Not Needed we leave last_unit_id unchanged.
            const goodUpdate = {
              place: "inventory",
              unit_id: null,
              is_functional: action === "defective" ? false : true,
            };

            if (action === "defective") {
              // Only defective should stamp this unit as last_unit_id
              goodUpdate.last_unit_id = system.id;
            }

            await updatePartItem(good, goodUpdate);
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
              last_unit_id: system.id, // came from this unit
            });

            // Move the GOOD from inventory -> unit (no last_unit change)
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
              last_unit_id: system.id, // moved out of this unit
            });
            await deletePartItem(ppid);
          })
        );

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

      // D) For any donor systems involved in unit↔unit part moves, write a note
      // using their current location as the "to" location (no actual move).
      if (Object.keys(donorLocationNotes).length > 0) {
        await Promise.all(
          Object.entries(donorLocationNotes).map(async ([donorTag, lines]) => {
            const donor = donorSystems.find(
              (u) =>
                (u.service_tag || "").toUpperCase() === donorTag.toUpperCase()
            );

            const donorLocName = donor?.location || "Received";
            const donorLocId =
              locations.find((l) => l.name === donorLocName)?.id ||
              locations.find((l) => l.name === "Received")?.id;

            if (!donorLocId) return;

            const donorNote =
              `Parts transaction with ${system.service_tag}:\n` +
              lines.join(" ");

            await updateSystemLocation(donorTag, {
              to_location_id: donorLocId,
              note: donorNote,
            });
          })
        );
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
        let shape = resp?.shape || null;

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
                  shape: shape,
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
      setInvOriginalsByPPID({});
      setAutoOriginalLockedByPPID({});
      // Clear cached GOOD/BAD option lists so dropdowns re-fetch from backend
      setGoodOptionsCache(new Map());
      setBadOptionsCache(new Map());

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
              shape: palletInfo.shape,
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
                          + Add Pending Part
                        </button>
                      ) : null}
                      {canAddGoodParts && (
                        <button
                          type="button"
                          onClick={addGoodPartBlock}
                          className="px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
                        >
                          + Add Replacement Part
                        </button>
                      )}
                    </div>

                    {/* Good part blocks */}
                    {canAddGoodParts &&
                      (goodBlocks.length === 0 ? (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
                          No replacement parts to be added. Click “Add
                          Replacement Part” to begin.
                        </div>
                      ) : (
                        <div className="space-y-3 mt-2">
                          <label className="block text-sm font-medium text-gray-600">
                            Replacement Parts to be install into the unit
                          </label>

                          {goodBlocks.map((block) => {
                            const partValue =
                              flatPartOptions.find(
                                (o) => o.value === block.part_id
                              ) || null;

                            return (
                              <div
                                key={block.id}
                                className="border rounded-lg p-3 bg-white shadow-sm space-y-3 pb-5"
                              >
                                {/* Row 1: main 3 fields + Cancel */}
                                <div className="flex flex-col md:flex-row md:items-center gap-3">
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

                                  {/* Replacement PPID */}
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
                                      isDisabled={
                                        !block.part_id || formDisabled
                                      }
                                      value={
                                        block.ppid
                                          ? block.ppid === PULL_FROM_UNIT_VALUE
                                            ? {
                                                value: PULL_FROM_UNIT_VALUE,
                                                label: "Pull from Unit",
                                                isSpecial: true,
                                              }
                                            : {
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
                                        if (
                                          next &&
                                          next !== PULL_FROM_UNIT_VALUE
                                        ) {
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
                                      options={[
                                        ...((block.part_id &&
                                          getFilteredGoodOptions(
                                            block.part_id,
                                            block.ppid
                                          )) ||
                                          []),
                                        {
                                          value: PULL_FROM_UNIT_VALUE,
                                          label: "Pull from Unit",
                                          isSpecial: true,
                                        },
                                      ]}
                                      components={{
                                        Option: GoodPPIDOption,
                                        SingleValue: GoodPPIDSingleValue,
                                      }}
                                    />
                                  </div>

                                  {/* Current Defective PPID */}
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
                                        !block.current_bad_ppid ||
                                        !block.part_id
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

                                {/* Row 2: Donor Unit + PPID in a wire box */}
                                {block.ppid === PULL_FROM_UNIT_VALUE && (
                                  <div className="mt-1 border border-blue-300 rounded-lg p-3 bg-blue-50/40 flex flex-col md:flex-row gap-3">
                                    <div className="flex-1 min-w-0">
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Donor Unit
                                      </label>
                                      <Select
                                        instanceId={`donor-unit-${block.id}`}
                                        classNamePrefix="react-select"
                                        styles={select40Styles}
                                        placeholder="Select donor unit"
                                        isClearable
                                        isSearchable
                                        isDisabled={formDisabled}
                                        value={
                                          block.donor_unit_id
                                            ? donorUnitOptions.find(
                                                (o) =>
                                                  o.value ===
                                                  block.donor_unit_id
                                              ) || null
                                            : null
                                        }
                                        onChange={(opt) =>
                                          updateGoodBlock(
                                            block.id,
                                            "donor_unit_id",
                                            opt ? opt.value : null
                                          )
                                        }
                                        options={donorUnitOptions}
                                      />
                                    </div>

                                    <div className="flex-1 min-w-0">
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
                                        value={block.donor_ppid}
                                        onChange={(e) =>
                                          updateGoodBlock(
                                            block.id,
                                            "donor_ppid",
                                            e.target.value
                                          )
                                        }
                                        onBlur={(e) =>
                                          updateGoodBlock(
                                            block.id,
                                            "donor_ppid",
                                            e.target.value.toUpperCase().trim()
                                          )
                                        }
                                        className={`w-full h-10 rounded-md border px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                          !block.donor_ppid ||
                                          !block.donor_unit_id
                                            ? "border-amber-300"
                                            : "border-gray-300"
                                        }`}
                                      />
                                    </div>
                                  </div>
                                )}
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
                            No pending parts to be added. Click “Add Pending
                            Part” to begin.
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
                                      Part Needed
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
                                      Defective Part PPID
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
                            className={`border border-gray-300 rounded-lg p-3 bg-white shadow-sm ${
                              queued ? "border-red-300 bg-red-50 " : ""
                            }`}
                          >
                            <div className="flex flex-col md:flex-row md:items-center gap-3 pb-3">
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
                                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                                                  replacementByOldPPID[
                                                    item.ppid
                                                  ],
                                                label:
                                                  replacementByOldPPID[
                                                    item.ppid
                                                  ],
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
                                            goodOptionsCache.get(
                                              item.part_id
                                            ) || []
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
                              {!isBad &&
                                toLocationId !== 4 &&
                                (() => {
                                  const goodPPID = item.ppid;
                                  const goodCfg =
                                    goodActionByPPID[goodPPID] || {};
                                  const hasAction = !!goodCfg.action;

                                  const hasSearched =
                                    Object.prototype.hasOwnProperty.call(
                                      invOriginalsByPPID,
                                      goodPPID
                                    );

                                  const matches = hasSearched
                                    ? invOriginalsByPPID[goodPPID] || []
                                    : [];

                                  const liveMatches = matches.filter(
                                    (m) => m.is_live_origin
                                  );
                                  const hasAnyMatches = matches.length > 0;
                                  const hasLiveMatches = liveMatches.length > 0;

                                  // NEW:
                                  const hasInventoryOnly =
                                    matches.some((m) => !m.owner_unit_id) &&
                                    !matches.some((m) => m.owner_unit_id);

                                  const hasInventoryMatches = matches.some(
                                    (m) => !m.owner_unit_id
                                  );

                                  const currentOrig =
                                    goodCfg.original_bad_ppid || "";

                                  const selectedMatch =
                                    matches.find(
                                      (m) =>
                                        normPPID(m.ppid) ===
                                        normPPID(currentOrig)
                                    ) || null;

                                  // Good part came from inventory if it has no last_unit_id
                                  const fromInventoryGood =
                                    item.last_unit_id == null;

                                  // Only non-live *donor units* (owner_unit_id present) force Defective.
                                  // Inventory originals (owner_unit_id == null) do NOT force Defective.
                                  const forcedDefective =
                                    !!selectedMatch &&
                                    selectedMatch.place === "unit" &&
                                    !!selectedMatch.owner_unit_id &&
                                    !selectedMatch.is_live_origin;

                                  const fallbackInventoryOptions =
                                    !hasAnyMatches
                                      ? getFilteredBadOptions(
                                          item.part_id,
                                          currentOrig
                                        )
                                      : [];

                                  const options = hasAnyMatches
                                    ? matches
                                        // Ignore any matches whose owner is the current unit
                                        .filter(
                                          (r) =>
                                            !r.owner_unit_id ||
                                            r.owner_unit_id !== system.id
                                        )
                                        .filter((r) => {
                                          const v = normPPID(r.ppid);
                                          return (
                                            v === normPPID(currentOrig) ||
                                            !selectedBadPPIDs.has(v)
                                          );
                                        })
                                        .map((r) => {
                                          const fromInventory =
                                            r.place === "inventory" ||
                                            !r.owner_unit_id;

                                          // What to show on the chip
                                          const ownerLabel = fromInventory
                                            ? "Inventory"
                                            : r.owner_service_tag ||
                                              (r.owner_unit_id
                                                ? `Unit #${r.owner_unit_id}`
                                                : null);

                                          // "Shipped" only makes sense for donor units that are no longer live
                                          const isShipped =
                                            !fromInventory &&
                                            !!r.owner_unit_id &&
                                            !r.is_live_origin;

                                          return {
                                            value: r.ppid,
                                            label: r.ppid,
                                            meta: {
                                              ownerLabel,
                                              is_shipped: isShipped,
                                            },
                                          };
                                        })
                                    : fallbackInventoryOptions.map((opt) => ({
                                        ...opt,
                                        meta: {
                                          ownerLabel: "Inventory",
                                          is_shipped: false,
                                        },
                                      }));

                                  // Not Needed:
                                  //  - allowed only if there is at least one live match
                                  //  - and the currently selected match (if any) is live
                                  const canChooseNotNeeded =
                                    !forcedDefective &&
                                    (fromInventoryGood
                                      ? true
                                      : hasInventoryOnly
                                      ? // Only inventory matches (no donor units) → allow Not Needed
                                        true
                                      : hasAnyMatches
                                      ? // Have donor-unit matches → require at least one live donor
                                        hasLiveMatches
                                      : // No matches at all → allow
                                        true);

                                  const canChooseDefective = true;

                                  const handleActionClick = async (kind) => {
                                    // Guard: never allow Not Needed when forbidden by logic
                                    if (
                                      kind === "not_needed" &&
                                      !canChooseNotNeeded
                                    )
                                      return;

                                    const prevCfg =
                                      goodActionByPPID[goodPPID] || {};
                                    const prevAction = prevCfg.action;
                                    const isSameButton = prevAction === kind;

                                    // Clicking the same button toggles that action OFF
                                    if (isSameButton) {
                                      // Clear action + original for this good PPID
                                      setGoodActionByPPID((prev) => {
                                        const { [goodPPID]: _omit, ...rest } =
                                          prev;
                                        return rest;
                                      });

                                      // Clear auto-lock flag
                                      setAutoOriginalLockedByPPID((prev) => {
                                        const copy = { ...prev };
                                        delete copy[goodPPID];
                                        return copy;
                                      });

                                      // Also clear cached matches so they’ll be recomputed next click
                                      setInvOriginalsByPPID((prev) => {
                                        const copy = { ...prev };
                                        delete copy[goodPPID];
                                        return copy;
                                      });

                                      return;
                                    }

                                    // Set new action (keep current original_bad_ppid if present)
                                    setGoodActionByPPID((prev) => ({
                                      ...prev,
                                      [goodPPID]: {
                                        ...(prev[goodPPID] || {}),
                                        action: kind,
                                      },
                                    }));

                                    // If we haven’t searched for matches yet, do it now
                                    const alreadySearched =
                                      Object.prototype.hasOwnProperty.call(
                                        invOriginalsByPPID,
                                        goodPPID
                                      );
                                    if (!alreadySearched) {
                                      await autoSelectOriginalForGood(
                                        goodPPID,
                                        item.part_id
                                      );
                                    }
                                  };

                                  // ----- Helper messages (under the buttons) -----
                                  const unitMatches = matches.filter(
                                    (m) => m.owner_unit_id
                                  );
                                  const hasUnitMatches = unitMatches.length > 0;
                                  const inventoryMatchesOnly = matches.filter(
                                    (m) => !m.owner_unit_id
                                  );

                                  const moreThanOneInventoryMatch =
                                    inventoryMatchesOnly.length > 1;

                                  // Cross-swap = auto-locked single origin from another unit
                                  const isCrossSwap =
                                    !!autoOriginalLockedByPPID[goodPPID] &&
                                    unitMatches.length === 1;

                                  const showSingleUnitMsg =
                                    hasAction &&
                                    !!currentOrig &&
                                    hasUnitMatches;

                                  const showMultiUnitMsg =
                                    hasUnitMatches && unitMatches.length > 1;

                                  const showMultiInventoryMsg =
                                    !hasUnitMatches &&
                                    moreThanOneInventoryMatch;

                                  const showHelper =
                                    isCrossSwap ||
                                    showSingleUnitMsg ||
                                    showMultiUnitMsg ||
                                    showMultiInventoryMsg;

                                  return (
                                    <div className="flex flex-col gap-2">
                                      {/* Row: Original PPID selector + buttons */}
                                      <div className="flex flex-col md:flex-row md:items-center gap-3">
                                        {/* Original PPID selector */}
                                        {hasAction && hasSearched && (
                                          <div className="shrink-0 basis-[280px] w-[280px]">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                              Original PPID
                                              {selectedMatch &&
                                                selectedMatch.owner_unit_id && // only show for unit-origin parts
                                                !selectedMatch.is_live_origin && (
                                                  <span className="px-2 py-1 ml-1 text-xs rounded-full bg-red-100 text-red-700">
                                                    {selectedMatch.owner_service_tag &&
                                                      selectedMatch.owner_service_tag}
                                                    {" - "}
                                                    Shipped
                                                  </span>
                                                )}
                                            </label>

                                            {(() => {
                                              // Lock whenever we auto-locked and there is exactly 1 match
                                              const lockOriginal =
                                                !!autoOriginalLockedByPPID[
                                                  goodPPID
                                                ] &&
                                                matches.length === 1 &&
                                                selectedMatch;

                                              if (
                                                lockOriginal &&
                                                selectedMatch
                                              ) {
                                                return (
                                                  <div className="h-10 rounded-md border border-gray-300 bg-gray-50 px-3 flex items-center text-xs sm:text-sm font-mono">
                                                    <span>
                                                      {selectedMatch.ppid}
                                                    </span>
                                                    {selectedMatch.owner_service_tag && (
                                                      <span className="ml-2 text-gray-500">
                                                        –{" "}
                                                        {
                                                          selectedMatch.owner_service_tag
                                                        }
                                                      </span>
                                                    )}
                                                  </div>
                                                );
                                              }

                                              // Editable select when 0 or >1 matches
                                              return (
                                                <Select
                                                  isDisabled={formDisabled}
                                                  instanceId={`orig-${goodPPID}`}
                                                  classNamePrefix="react-select"
                                                  styles={select40Styles}
                                                  placeholder={
                                                    hasAnyMatches
                                                      ? "Select original BAD PPID"
                                                      : "Select BAD PPID from inventory"
                                                  }
                                                  isClearable
                                                  value={
                                                    currentOrig
                                                      ? {
                                                          value: currentOrig,
                                                          label: currentOrig,
                                                          meta: selectedMatch && {
                                                            ownerLabel:
                                                              selectedMatch.owner_service_tag ||
                                                              (selectedMatch.owner_unit_id
                                                                ? `Unit #${selectedMatch.owner_unit_id}`
                                                                : null),
                                                            is_shipped:
                                                              !selectedMatch.is_live_origin,
                                                          },
                                                        }
                                                      : null
                                                  }
                                                  onMenuOpen={async () => {
                                                    // If there were no last_unit matches, ensure inventory BADs are loaded
                                                    if (!hasAnyMatches) {
                                                      await loadBadOptions(
                                                        item.part_id
                                                      );
                                                    }
                                                  }}
                                                  onChange={(opt) => {
                                                    const next = opt
                                                      ? opt.value
                                                      : "";
                                                    const picked =
                                                      next && matches.length
                                                        ? matches.find(
                                                            (m) =>
                                                              normPPID(
                                                                m.ppid
                                                              ) ===
                                                              normPPID(next)
                                                          )
                                                        : null;

                                                    setGoodActionByPPID(
                                                      (prev) => {
                                                        const prevCfg =
                                                          prev[goodPPID] || {};

                                                        // 🔹 If the selection was cleared, wipe both the Original PPID and the action
                                                        if (!next) {
                                                          return {
                                                            ...prev,
                                                            [goodPPID]: {
                                                              ...prevCfg,
                                                              original_bad_ppid:
                                                                "",
                                                              action: null, // <- this untoggles "Not needed" and "Defective"
                                                            },
                                                          };
                                                        }

                                                        // 🔹 Normal case: a BAD PPID was selected
                                                        const nextCfg = {
                                                          ...prevCfg,
                                                          original_bad_ppid:
                                                            next,
                                                        };

                                                        // Only force Defective when the original is from a *non-live donor unit*.
                                                        // Inventory origins (place === "inventory") must NEVER auto-flip to Defective.
                                                        if (
                                                          picked &&
                                                          picked.place ===
                                                            "unit" && // real donor unit
                                                          picked.owner_unit_id && // has an owning unit
                                                          !picked.is_live_origin && // donor is no longer active
                                                          prevCfg.action ===
                                                            "not_needed" // only correct an invalid Not Needed state
                                                        ) {
                                                          nextCfg.action =
                                                            "defective";
                                                        }

                                                        return {
                                                          ...prev,
                                                          [goodPPID]: nextCfg,
                                                        };
                                                      }
                                                    );

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
                                                  options={options}
                                                  components={{
                                                    Option: (props) => {
                                                      const meta =
                                                        props.data.meta || {};
                                                      return (
                                                        <components.Option
                                                          {...props}
                                                        >
                                                          <>
                                                            <span
                                                              className={`px-2 py-1 text-xs rounded-full ${
                                                                meta.is_shipped
                                                                  ? "bg-red-100 text-red-700"
                                                                  : "bg-blue-100 text-blue-700"
                                                              }`}
                                                            >
                                                              {meta.ownerLabel &&
                                                                meta.ownerLabel}
                                                              {" - "}
                                                              {meta.is_shipped
                                                                ? "Shipped"
                                                                : "Active"}
                                                            </span>
                                                          </>
                                                          {"  "}
                                                          {props.data.value}
                                                        </components.Option>
                                                      );
                                                    },
                                                  }}
                                                />
                                              );
                                            })()}
                                          </div>
                                        )}

                                        {/* Not Needed / Defective buttons */}
                                        {isInDebugWistron && !isResolved && (
                                          <div className="flex gap-2 mt-6">
                                            {canChooseNotNeeded && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleActionClick(
                                                    "not_needed"
                                                  )
                                                }
                                                disabled={formDisabled}
                                                className={`px-3 py-2 rounded-md text-white ${
                                                  goodCfg.action ===
                                                  "not_needed"
                                                    ? "bg-blue-600"
                                                    : "bg-gray-500 hover:bg-gray-600"
                                                }`}
                                              >
                                                Not Needed
                                              </button>
                                            )}

                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleActionClick("defective")
                                              }
                                              disabled={
                                                !canChooseDefective ||
                                                formDisabled
                                              }
                                              className={`px-3 py-2 rounded-md text-white ${
                                                goodCfg.action === "defective"
                                                  ? "bg-amber-600"
                                                  : "bg-gray-500 hover:bg-gray-600"
                                              }`}
                                            >
                                              Defective
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                            </div>
                            {/* Cross-swap / original helper lines – full width, under everything */}
                            {!isBad &&
                              toLocationId !== 4 &&
                              (() => {
                                const goodCfg =
                                  goodActionByPPID[item.ppid] || {};
                                const hasAction = !!goodCfg.action;
                                if (!hasAction) return null;

                                // Only show helper text once we’ve actually done the match lookup
                                const hasSearchedForOriginal =
                                  Object.prototype.hasOwnProperty.call(
                                    invOriginalsByPPID,
                                    item.ppid
                                  );
                                if (!hasSearchedForOriginal) return null;

                                const invMatches =
                                  invOriginalsByPPID[item.ppid] || [];
                                if (invMatches.length === 0) return null;

                                const originalBad = normPPID(
                                  goodCfg.original_bad_ppid || ""
                                );

                                // Safely find the selected match (if any)
                                let selectedMatch = null;
                                if (originalBad) {
                                  for (const m of invMatches) {
                                    if (normPPID(m.ppid) === originalBad) {
                                      selectedMatch = m;
                                      break;
                                    }
                                  }
                                }

                                const unitMatches = invMatches.filter(
                                  (m) => m.owner_unit_id
                                );
                                const hasUnitMatches = unitMatches.length > 0;

                                const inventoryMatchesOnly = invMatches.filter(
                                  (m) => !m.owner_unit_id
                                );
                                const moreThanOneInventoryMatch =
                                  inventoryMatchesOnly.length > 1;

                                // Single cross-swap from a *live* donor unit
                                const isCrossSwap =
                                  !!autoOriginalLockedByPPID[item.ppid] &&
                                  unitMatches.length === 1 &&
                                  unitMatches[0].is_live_origin === true;

                                // One selected/locked match from a *live* donor
                                const showSingleUnitMsgActive =
                                  !!autoOriginalLockedByPPID[item.ppid] &&
                                  !!goodCfg.original_bad_ppid &&
                                  !!selectedMatch &&
                                  selectedMatch.is_live_origin === true;

                                // One selected/locked match from a *non-live* donor (shipped/inactive) and action is Defective
                                const showSingleUnitMsgInactive =
                                  !!autoOriginalLockedByPPID[item.ppid] &&
                                  !!goodCfg.original_bad_ppid &&
                                  !!selectedMatch &&
                                  !!selectedMatch.owner_unit_id &&
                                  selectedMatch.is_live_origin === false &&
                                  goodCfg.action === "defective";

                                const showMultiUnitMsg =
                                  hasUnitMatches && unitMatches.length > 1;

                                const showMultiInventoryMsg =
                                  !hasUnitMatches && moreThanOneInventoryMatch;

                                if (
                                  !isCrossSwap &&
                                  !showSingleUnitMsgActive &&
                                  !showSingleUnitMsgInactive &&
                                  !showMultiUnitMsg &&
                                  !showMultiInventoryMsg
                                ) {
                                  return null;
                                }

                                return (
                                  <div className="mt-2 space-y-1 text-[10px] text-gray-500">
                                    {isCrossSwap && (
                                      <p className="italic">
                                        This good part is currently borrowed
                                        from another active unit. When you
                                        submit, it will be reconciled with that
                                        unit using the selected Original PPID.
                                      </p>
                                    )}

                                    {showSingleUnitMsgActive && (
                                      <p className="italic">
                                        Original part will be moved back into
                                        this unit when you submit.
                                      </p>
                                    )}

                                    {showSingleUnitMsgInactive && (
                                      <p className="italic">
                                        Because the original system has already
                                        shipped or is inactive, this part will
                                        stay in the current unit and be marked
                                        as defective; no original part will be
                                        reinstalled.
                                      </p>
                                    )}

                                    {showMultiUnitMsg && (
                                      <p className="italic">
                                        There is more than one part that was
                                        pulled from another system. Please
                                        choose the correct original PPID.
                                      </p>
                                    )}

                                    {showMultiInventoryMsg && (
                                      <p className="italic">
                                        Original PPID isn&apos;t linked to a
                                        known system. Please select the original
                                        PPID from inventory.
                                      </p>
                                    )}
                                  </div>
                                );
                              })()}
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
                      changed_at: formatDateHumanReadable(
                        entry.changed_at,
                        serverTimeZone
                      ),
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
                      equals: formatDateHumanReadable(
                        history[0]?.changed_at,
                        serverTimeZone
                      ), // only show action button for the most recent entry
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
