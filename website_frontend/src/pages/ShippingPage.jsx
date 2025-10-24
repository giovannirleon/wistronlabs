import React, { useEffect, useMemo, useState, useContext } from "react";
import useToast from "../hooks/useToast";
import useConfirm from "../hooks/useConfirm";
import { formatDateHumanReadable } from "../utils/date_format";
import { pdf } from "@react-pdf/renderer";
import SystemRMALabel from "../components/SystemRMALabel.jsx";
import { enrichPalletWithBarcodes } from "../utils/enrichPalletWithBarcodes";
import PalletPaper from "../components/PalletPaper";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import SearchContainerSS from "../components/SearchContainerSS.jsx";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { AuthContext } from "../context/AuthContext.jsx";

function SystemBox({ serviceTag }) {
  return (
    <div className="w-full h-full flex items-center justify-center rounded-lg text-sm font-semibold transition bg-neutral-100 text-neutral-800 border border-neutral-300 shadow-sm hover:ring-2 hover:ring-neutral-300 hover:bg-neutral-200 cursor-move select-none">
      {serviceTag}
    </div>
  );
}

function DraggableSystem({ palletId, index, system }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `drag-${palletId}-${index}`,
      data: { palletId, index, system },
    });

  const style = {
    transform: transform
      ? `translate(${transform.x}px, ${transform.y}px)`
      : undefined,
    opacity: isDragging ? 0.5 : 1,
    pointerEvents: isDragging ? "none" : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="w-full h-full flex items-center justify-center"
    >
      <Link to={`/${system.service_tag}`} className="w-full h-full">
        <SystemBox serviceTag={system.service_tag} />
      </Link>
    </div>
  );
}

function DroppableSlot({ palletId, idx, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${palletId}-${idx}`,
    data: { palletId, idx },
  });

  return (
    <div
      ref={setNodeRef}
      className={`h-16 w-full flex items-center justify-center rounded-lg text-sm font-semibold transition-all duration-150 select-none ${
        children
          ? "bg-neutral-100 text-neutral-800 border border-neutral-300 shadow-sm hover:ring-2 hover:ring-neutral-300"
          : "bg-white text-neutral-400 border border-dashed border-neutral-300 italic"
      } ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {children || "Empty"}
    </div>
  );
}

function LockStateButton({ currentLocked, pending, onToggle }) {
  const hasPending = pending !== undefined;
  const effectiveLocked = hasPending ? pending : currentLocked;

  const styles = {
    LOCKED_CURRENT: "bg-red-50 text-red-700 border-red-200",
    UNLOCKED_CURRENT: "bg-green-50 text-green-700 border-green-200",
    LOCKED_PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    UNLOCKED_PENDING: "bg-blue-50 text-blue-700 border-blue-200",
  };
  const labels = {
    LOCKED_CURRENT: "Locked",
    UNLOCKED_CURRENT: "Unlocked",
    LOCKED_PENDING: "Locked (pending)",
    UNLOCKED_PENDING: "Unlocked (pending)",
  };

  const stateKey = hasPending
    ? effectiveLocked
      ? "LOCKED_PENDING"
      : "UNLOCKED_PENDING"
    : currentLocked
    ? "LOCKED_CURRENT"
    : "UNLOCKED_CURRENT";

  // Longest label drives button width
  const longestLabel = Object.values(labels).reduce(
    (a, b) => (b.length > a.length ? b : a),
    ""
  );

  const title = hasPending
    ? "Click to clear the pending lock change"
    : `Click to stage a ${currentLocked ? "unlock" : "lock"} change`;

  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      className={`grid place-items-center whitespace-nowrap px-2 py-1 text-xs font-semibold rounded-md border ${styles[stateKey]} hover:opacity-90`}
      // grid + invisible longest label ensures fixed width
    >
      {/* Invisible width-reserver */}
      <span className="invisible col-start-1 row-start-1">{longestLabel}</span>
      {/* Visible label, overlaid in same grid cell */}
      <span className="col-start-1 row-start-1">{labels[stateKey]}</span>
    </button>
  );
}

const PalletGrid = ({
  pallet,
  releaseFlags,
  setReleaseFlags,
  onLockUpdated, // kept for backwards-compat
  setPalletLock, // kept for backwards-compat
  showToast,
  lockFlags,
  setLockFlags,
}) => {
  // Use unified field so the grid also works for released pallets if reused
  const raw = pallet.systems ?? pallet.active_systems ?? [];
  const systems = raw.map((s) =>
    s && (s.service_tag || s.system_id) ? s : undefined
  );

  const isEmpty = systems.every((s) => !s || (!s.service_tag && !s.system_id));
  const isReleased = !!releaseFlags[pallet.id]?.released;

  useEffect(() => {
    if (isEmpty && releaseFlags[pallet.id]) {
      setReleaseFlags((prev) => {
        const copy = { ...prev };
        delete copy[pallet.id];
        return copy;
      });
    }
  }, [isEmpty, pallet.id, releaseFlags, setReleaseFlags]);

  const toggleRelease = () => {
    setReleaseFlags((prev) => {
      const existing = prev[pallet.id];
      if (existing?.released) {
        const copy = { ...prev };
        delete copy[pallet.id];
        return copy;
      }
      return {
        ...prev,
        [pallet.id]: { released: true, doa_number: "" },
      };
    });
  };

  const handleDOAChange = (e) => {
    setReleaseFlags((prev) => ({
      ...prev,
      [pallet.id]: {
        ...prev[pallet.id],
        doa_number: e.target.value.trimStart(),
      },
    }));
  };

  // ---- STAGED LOCK TOGGLE ----
  const currentLocked = !!pallet.locked;
  const pending = lockFlags[pallet.id]; // undefined | boolean
  const hasPending = pending !== undefined;

  const toggleLockStaged = () => {
    setLockFlags((prev) => {
      const copy = { ...prev };
      if (hasPending) {
        // clear pending
        delete copy[pallet.id];
      } else {
        // stage opposite of current
        copy[pallet.id] = !currentLocked;
      }
      return copy;
    });
  };
  const effectiveLocked = hasPending ? pending : currentLocked;

  const stateKey = hasPending
    ? effectiveLocked
      ? "LOCKED_PENDING"
      : "UNLOCKED_PENDING"
    : currentLocked
    ? "LOCKED_CURRENT"
    : "UNLOCKED_CURRENT";

  const stateStyles = {
    LOCKED_CURRENT: "bg-red-50 text-red-700 border-red-200",
    UNLOCKED_CURRENT: "bg-green-50 text-green-700 border-green-200",
    LOCKED_PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    UNLOCKED_PENDING: "bg-blue-50 text-blue-700 border-blue-200",
  };

  const stateLabel = {
    LOCKED_CURRENT: "Locked",
    UNLOCKED_CURRENT: "Unlocked",
    LOCKED_PENDING: "Locked (pending)",
    UNLOCKED_PENDING: "Unlocked (pending)",
  };

  return (
    <div className="border border-gray-300 rounded-2xl shadow-md hover:shadow-lg transition p-4 bg-white flex flex-col justify-between">
      <div className="mb-4 relative">
        <h2 className="text-md font-medium text-gray-700 pr-32">
          {pallet.pallet_number}
        </h2>
        <p className="text-xs pb-2 text-gray-500">
          Created on {formatDateHumanReadable(pallet.created_at)}
        </p>

        {/* Lock chip  stage/clear button */}
        <div className="absolute top-0 right-0 flex items-center gap-2">
          <div className="absolute top-0 right-0">
            <LockStateButton
              currentLocked={currentLocked}
              pending={pending}
              onToggle={toggleLockStaged}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 grid-rows-3 gap-2 mb-4">
          {Array.from({ length: 9 }).map((_, idx) => {
            const system = systems[idx];
            return (
              <DroppableSlot
                key={`${pallet.id}-${idx}`}
                palletId={pallet.id}
                idx={idx}
              >
                {system?.service_tag && (
                  <DraggableSystem
                    system={system}
                    index={idx}
                    palletId={pallet.id}
                  />
                )}
              </DroppableSlot>
            );
          })}
        </div>

        <button
          onClick={toggleRelease}
          disabled={isEmpty}
          className={`w-full mt-2 py-2 rounded-lg text-sm font-semibold text-white transition ${
            isEmpty
              ? "bg-gray-300 cursor-not-allowed"
              : isReleased
              ? "bg-yellow-600 hover:bg-yellow-700"
              : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {isReleased ? "Undo Release" : "Mark for Release"}
        </button>

        <input
          type="text"
          placeholder="Enter DOA Number"
          value={releaseFlags[pallet.id]?.doa_number || ""}
          onChange={handleDOAChange}
          className={`mt-2 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring focus:ring-blue-200 text-sm ${
            isReleased ? "" : "invisible"
          }`}
        />
      </div>
    </div>
  );
};

export default function ShippingPage() {
  const { showToast, Toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [pallets, setPallets] = useState([]);
  const [initialPallets, setInitialPallets] = useState([]);
  const [activeDragData, setActiveDragData] = useState(null);
  const [downloadingReport, setDownloadingReport] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPallet, setCreatingPallet] = useState(false);
  const [newPalletForm, setNewPalletForm] = useState({
    dpn: "",
    factoryCode: "",
  });

  const [dpnOptions, setDpnOptions] = useState([]);
  const [factoryOptions, setFactoryOptions] = useState([]);

  // staged lock changes
  const [lockFlags, setLockFlags] = useState({});
  const [releaseFlags, setReleaseFlags] = useState({});
  const [tab, setTab] = useState("active");

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'locked' | 'unlocked'
  const [selectedDpns, setSelectedDpns] = useState(new Set());
  const [selectedFactories, setSelectedFactories] = useState(new Set());

  const FRONTEND_URL = import.meta.env.VITE_URL;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  const {
    getDpns,
    getFactories,
    createPallet,
    getSystem,
    getPallets,
    moveSystemBetweenPallets,
    releasePallet,
    deletePallet,
    setPalletLock,
  } = useApi();

  const handleCreatePallet = async (e) => {
    e?.preventDefault?.();
    const dpn = newPalletForm.dpn.trim();
    const factory_code = newPalletForm.factoryCode.trim();
    if (!dpn || !factory_code) {
      showToast("DPN and Factory Code are required.", "error");
      return;
    }

    try {
      setCreatingPallet(true);
      const res = await createPallet({ dpn, factory_code });
      const pn =
        res?.pallet_number || res?.pallet?.pallet_number || "(pallet created)";
      showToast(`Created pallet ${pn}`, "info");
      setShowCreateModal(false);
      setNewPalletForm({ dpn: "", factoryCode: "" });
      await reloadOpenPallets();
    } catch (err) {
      const msg = err?.error || err?.message || "Failed to create pallet";
      showToast(msg, "error");
    } finally {
      setCreatingPallet(false);
    }
  };

  const uniqueDpns = useMemo(() => {
    const vals = (pallets || []).map(
      (p) => p?.dpn ?? p?.pallet_number?.split("-")[2]?.trim() ?? ""
    );
    return Array.from(new Set(vals.filter(Boolean))).sort();
  }, [pallets]);

  const uniqueFactories = useMemo(() => {
    const vals = (pallets || []).map(
      (p) => p?.factory_code ?? p?.pallet_number?.split("-")[1]?.trim() ?? ""
    );
    return Array.from(new Set(vals.filter(Boolean))).sort();
  }, [pallets]);

  // Helpers used by the modal
  const toggleSetValue = (setter) => (value) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });

  const selectAll = (setter, values) => setter(new Set(values));
  const selectNone = (setter) => setter(new Set());

  // ---- Released tab data fetcher ----
  const fetchReleasedPallets = async ({
    page,
    page_size,
    sort_by,
    sort_order,
    search,
  }) => {
    const res = await getPallets({
      page,
      page_size,
      sort_by,
      sort_order,
      search,
      filters: {
        conditions: [{ field: "status", op: "=", values: ["released"] }],
      },
    });

    const palletsWithLinks = await Promise.all(
      (res.data || []).map(async (pallet) => {
        try {
          const systemsWithDetails = await Promise.all(
            (
              pallet.systems ??
              pallet.released_systems ??
              pallet.active_systems ??
              []
            )
              .filter((s) => s?.service_tag)
              .map(async (sys) => {
                try {
                  const systemDetails = await getSystem(sys.service_tag);
                  return {
                    service_tag: systemDetails.service_tag || "UNKNOWN-ST",
                    ppid: systemDetails.ppid?.trim() || "MISSING-PPID",
                  };
                } catch {
                  return {
                    service_tag: sys.service_tag || "UNKNOWN-ST",
                    ppid: "MISSING-PPID",
                  };
                }
              })
          );

          const parts = pallet.pallet_number.split("-");
          const factory_id = parts[1] || "";
          const dpn = parts[2] || "";

          const rawPallet = {
            pallet_number: pallet.pallet_number,
            doa_number: pallet.doa_number,
            date_released: pallet.released_at?.split("T")[0] || "",
            dpn,
            factory_id,
            systems: systemsWithDetails,
          };

          const enriched = enrichPalletWithBarcodes(rawPallet);
          const palletBlob = await pdf(
            <PalletPaper pallet={enriched} />
          ).toBlob();
          const pdfUrl = URL.createObjectURL(palletBlob);

          return {
            ...pallet,
            created_at: formatDateHumanReadable(pallet.created_at),
            released_at: formatDateHumanReadable(pallet.released_at),
            pallet_number_title: "Pallet Number",
            doa_number_title: "DOA Number",
            created_at_title: "Created On",
            released_at_title: "Released On",
            href: pdfUrl,
          };
        } catch (err) {
          console.error(
            `PDF generation failed for ${pallet.pallet_number}`,
            err
          );
          return { ...pallet, href: "#" };
        }
      })
    );

    return { data: palletsWithLinks, total_count: res.total_count };
  };

  useEffect(() => {
    if (showReportModal) {
      setSelectedDpns(new Set(uniqueDpns));
      setSelectedFactories(new Set(uniqueFactories));
      setStatusFilter("all");
    }
  }, [showReportModal, uniqueDpns, uniqueFactories]);

  useEffect(() => {
    if (!showCreateModal) return;
    (async () => {
      try {
        const dpns = await getDpns();
        setDpnOptions(Array.isArray(dpns) ? dpns : []);
      } catch (e) {
        console.error(e);
        showToast("Failed to load DPNs", "error");
      }
      try {
        const facs = await getFactories();
        setFactoryOptions(Array.isArray(facs) ? facs : []);
      } catch (e) {
        console.error(e);
        showToast("Failed to load factories", "error");
      }
    })();
  }, [showCreateModal]);

  // ---- Initial load (open pallets) ----
  useEffect(() => {
    const loadPallets = async () => {
      try {
        const data = await getPallets({
          filters: {
            conditions: [{ field: "status", op: "=", values: ["open"] }],
          },
        });

        const result = Array.isArray(data?.data) ? data.data : [];
        // Normalize both fields for DnD + unified reads
        const normalized = result.map((p) => ({
          ...p,
          active_systems: p.active_systems ?? p.systems ?? [],
          systems: p.systems ?? p.active_systems ?? [],
        }));

        setPallets(normalized);
        setInitialPallets(structuredClone(normalized));
      } catch (err) {
        console.error("Failed to load pallets:", err);
        showToast("Failed to load pallets", "error");
      }
    };

    loadPallets();
  }, []);

  const reloadOpenPallets = async () => {
    const data = await getPallets({
      filters: { conditions: [{ field: "status", op: "=", values: ["open"] }] },
    });
    const refreshed = Array.isArray(data?.data) ? data.data : [];
    const normalized = refreshed.map((p) => ({
      ...p,
      active_systems: p.active_systems ?? p.systems ?? [],
      systems: p.systems ?? p.active_systems ?? [],
    }));
    setPallets(normalized);
    setInitialPallets(structuredClone(normalized));
    setReleaseFlags({});
    setLockFlags({});
  };

  const handleLockUpdated = (updatedPallet) => {
    setPallets((prev) =>
      prev.map((p) =>
        p.id === updatedPallet.id ? { ...p, ...updatedPallet } : p
      )
    );
    setInitialPallets((prev) =>
      prev.map((p) =>
        p.id === updatedPallet.id ? { ...p, ...updatedPallet } : p
      )
    );
  };

  const handleDownloadReport = async () => {
    try {
      setReportGenerating(true);

      // helper inside handleDownloadReport (above the filter)
      const matchesPick = (val, selectedSet, allCount) => {
        if (allCount === 0) return true; // no options available -> ignore dim
        if (selectedSet.size === 0) return false; // explicit NONE -> match nothing
        if (selectedSet.size === allCount) return true; // ALL selected -> no restriction
        return selectedSet.has(val); // subset -> membership
      };

      const nothingSelected =
        selectedDpns.size === 0 && selectedFactories.size === 0;

      if (nothingSelected) {
        showToast("Select at least one DPN or Factory.", "error");
        return;
      }

      const filtered = (pallets || []).filter((p) => {
        const lockOk =
          statusFilter === "all"
            ? true
            : statusFilter === "locked"
            ? !!p.locked
            : !p.locked;

        const dpnVal = p?.dpn ?? p?.pallet_number?.split("-")[2]?.trim() ?? "";
        const facVal =
          p?.factory_code ?? p?.pallet_number?.split("-")[1]?.trim() ?? "";

        const dpnOk = matchesPick(dpnVal, selectedDpns, uniqueDpns.length);
        const facOk = matchesPick(
          facVal,
          selectedFactories,
          uniqueFactories.length
        );

        return lockOk && dpnOk && facOk;
      });

      if (filtered.length === 0) {
        showToast("No pallets match the selected filters.", "info");
        return;
      }

      // ...rest of your CSV code...

      const header = [
        "pallet_number",
        "service_tag",
        "ppid",
        "DPN",
        "Config",
        "Dell Customer",
        "issue",
        "location",
        "factory_code",
      ];
      const rows = [header];

      // For each pallet → each active system → fetch live system details
      for (const pallet of filtered) {
        const systems = (pallet.active_systems ?? pallet.systems ?? []).filter(
          Boolean
        );
        if (systems.length === 0) continue;

        const details = await Promise.all(
          systems.map(async (s) => {
            try {
              const d = await getSystem(s.service_tag);
              return {
                st: s.service_tag,
                ppid: (d?.ppid || "").trim(),
                dpn: d?.dpn || "",
                config: `Config ${d?.config}` || "",
                dell_customer: d?.dell_customer || "",
                issue: d?.issue ?? "",
                location: d?.location ?? "",
              };
            } catch {
              return {
                st: s.service_tag,
                ppid: "",
                dpn: "",
                config: "",
                dell_customer: "",
                issue: "",
                location: "",
              };
            }
          })
        );

        for (const d of details) {
          rows.push([
            pallet.pallet_number,
            d.st,
            d.ppid,
            d.dpn,
            d.config,
            d.dell_customer,
            d.issue,
            d.location,
            pallet.factory_code || "", // prefer from pallet payload
          ]);
        }
      }

      if (rows.length === 1) {
        showToast("No units found for the selected filters.", "info");
        return;
      }

      const csv = rows
        .map((r) =>
          r
            .map((cell) => {
              const v = String(cell ?? "");
              const needsQuotes = /[",\n]/.test(v);
              const escaped = v.replace(/"/g, '""');
              return needsQuotes ? `"${escaped}"` : escaped;
            })
            .join(",")
        )
        .join("\n");

      // ...keep your existing code above...

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

      // After filtered.length check, before building filename:
      const codeSlug = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "");
      const joinCodes = (arr) => arr.map(codeSlug).join("_");

      const dpnPart =
        selectedDpns.size === 0
          ? "dpns_none"
          : selectedDpns.size === uniqueDpns.length
          ? "dpns_all"
          : `dpns_${joinCodes([...selectedDpns].sort())}`;

      const factoryPart =
        selectedFactories.size === 0
          ? "factories_none"
          : selectedFactories.size === uniqueFactories.length
          ? "factories_all"
          : `factories_${joinCodes([...selectedFactories].sort())}`;

      const statusPart = statusFilter === "all" ? "all_active" : statusFilter;

      // Example outputs:
      // pallet-report-dpns_DKFX_XXXXX-factories_MX-all-<ts>.csv
      // pallet-report-all_factories-all_dpns-locked-<ts>.csv
      a.href = url;
      a.download = `pallet-report-${dpnPart}-${factoryPart}-${statusPart}-${ts}.csv`;
      // --- END NEW ---

      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast("Report downloaded.", "info");
      setShowReportModal(false);
    } catch (err) {
      console.error(err);
      showToast(`Failed to build report: ${err.message || err}`, "error");
    } finally {
      setReportGenerating(false);
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveDragData(null);
    if (!over) return;

    const [_, fromPalletIdStr, fromIdxStr] = active.id.split("-");
    const [__, toPalletIdStr, toIdxStr] = over.id.split("-");

    const fromId = Number(fromPalletIdStr);
    const fromIdx = Number(fromIdxStr);
    const toId = Number(toPalletIdStr);
    const toIdx = Number(toIdxStr);

    if (fromId === toId && fromIdx === toIdx) return;

    const system = active.data.current.system;

    // Client-side lock guard
    const fromPalletObj = pallets.find((p) => p.id === fromId);
    const toPalletObj = pallets.find((p) => p.id === toId);
    if (!fromPalletObj || !toPalletObj) return;
    if (fromPalletObj.locked || toPalletObj.locked) {
      showToast("Cannot move systems when either pallet is locked", "error");
      return;
    }

    setPallets((prev) => {
      const copy = structuredClone(prev);
      const fromPallet = copy.find((p) => p.id === fromId);
      const toPallet = copy.find((p) => p.id === toId);
      if (!fromPallet || !toPallet) return prev;

      const getDPN = (p) => (p.pallet_number.split("-")[2] || "").trim();
      const getFactory = (p) => (p.pallet_number.split("-")[1] || "").trim();

      const fromDPN = getDPN(fromPallet);
      const toDPN = getDPN(toPallet);
      const fromFactory = getFactory(fromPallet);
      const toFactory = getFactory(toPallet);

      if (fromDPN !== toDPN || fromFactory !== toFactory) {
        const reasons = [];
        if (fromDPN !== toDPN)
          reasons.push(`DPN mismatch (${fromDPN} → ${toDPN})`);
        if (fromFactory !== toFactory)
          reasons.push(`Factory mismatch (${fromFactory} → ${toFactory})`);
        showToast(`Cannot move system: ${reasons.join(" and ")}`, "error");
        return prev;
      }

      if (toPallet.active_systems?.[toIdx]?.service_tag) {
        showToast("Target slot already occupied", "error");
        return prev;
      }

      // Mutate both views to keep state consistent
      if (Array.isArray(fromPallet.active_systems))
        fromPallet.active_systems[fromIdx] = undefined;
      if (Array.isArray(toPallet.active_systems))
        toPallet.active_systems[toIdx] = system;

      if (Array.isArray(fromPallet.systems))
        fromPallet.systems[fromIdx] = undefined;
      if (Array.isArray(toPallet.systems)) toPallet.systems[toIdx] = system;

      return [...copy];
    });
  };

  const palletsChanged = (() => {
    if (pallets.length !== initialPallets.length) return true;

    for (let i = 0; i < pallets.length; i++) {
      const current = pallets[i];
      const initial = initialPallets.find((p) => p.id === current.id);
      if (!initial) return true;

      const currentTags = (current.active_systems || [])
        .filter((s) => s?.service_tag)
        .map((s) => s.service_tag)
        .sort();
      const initialTags = (initial.active_systems || [])
        .filter((s) => s?.service_tag)
        .map((s) => s.service_tag)
        .sort();

      if (currentTags.length !== initialTags.length) return true;
      for (let j = 0; j < currentTags.length; j++) {
        if (currentTags[j] !== initialTags[j]) return true;
      }
    }

    const hasAnyRelease = Object.keys(releaseFlags).length > 0;
    if (hasAnyRelease) return true;

    const hasAnyLockChange = pallets.some((p) => {
      if (lockFlags[p.id] === undefined) return false;
      return lockFlags[p.id] !== !!p.locked;
    });
    if (hasAnyLockChange) return true;

    return false;
  })();

  const handleSubmit = async () => {
    const palletsMissingDOA = Object.entries(releaseFlags).filter(
      ([_, val]) =>
        val.released && (!val.doa_number || val.doa_number.trim() === "")
    );

    if (palletsMissingDOA.length > 0) {
      showToast(
        `DOA number is required for ${palletsMissingDOA.length} released pallet(s).`,
        "error"
      );
      return;
    }

    const confirmed = await confirm({
      message: "Are you sure you want to submit changes?",
      title: "Confirm Submit",
      confirmText: "Yes, submit",
      cancelText: "Cancel",
      confirmClass: "bg-blue-600 text-white hover:bg-blue-700",
      cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
    });

    if (!confirmed) return;

    const lockedCount = pallets.filter((p) => p.locked === true).length;
    const unlockedCount = pallets.filter((p) => p.locked === false).length;

    const moves = [];
    for (const initial of initialPallets) {
      const current = pallets.find((p) => p.id === initial.id);
      if (!current) continue;

      (initial.active_systems || []).forEach((system) => {
        if (!system) return;

        const currentPallet = pallets.find((p) =>
          p.active_systems.some((s) => s?.service_tag === system.service_tag)
        );
        if (!currentPallet || currentPallet.id === initial.id) return;

        moves.push({
          service_tag: system.service_tag,
          from_pallet_number: initial.pallet_number,
          to_pallet_number: currentPallet.pallet_number,
        });
      });
    }

    const isSlotEmpty = (s) => !s || !s.service_tag; // treat placeholder as empty

    const emptyPallets = pallets
      .filter((p) => (p.active_systems || []).every(isSlotEmpty))
      .map((p) => ({ id: p.id, pallet_number: p.pallet_number }));

    const releaseList = Object.entries(releaseFlags)
      .filter(([_, val]) => val.released && val.doa_number?.trim())
      .map(([palletId, val]) => {
        const pallet = pallets.find((p) => p.id === Number(palletId));
        return {
          pallet_number: pallet?.pallet_number,
          doa_number: val.doa_number.trim(),
        };
      });

    const systemRMALabelData = moves.map((move) => {
      const toPallet = pallets.find(
        (p) => p.pallet_number === move.to_pallet_number
      );
      const parts = (toPallet?.pallet_number || "").split("-");
      const dpn = parts[2] || "UNKNOWN";
      const factory_code = parts[1] || "UNKNOWN";
      return {
        service_tag: move.service_tag,
        pallet_number: toPallet?.pallet_number || "UNKNOWN",
        dpn,
        factory_code,
        url: `${FRONTEND_URL}${move.service_tag}`,
      };
    });

    // STEP 1: Move systems
    for (const move of moves) {
      try {
        await moveSystemBetweenPallets({
          service_tag: move.service_tag,
          from_pallet_number: move.from_pallet_number,
          to_pallet_number: move.to_pallet_number,
        });
      } catch (err) {
        showToast(
          `Move failed for ${move.service_tag}: ${err.message}`,
          "error"
        );
        return;
      }
    }

    // STEP 2: Delete empty pallets
    for (const pallet of emptyPallets) {
      try {
        await deletePallet(pallet.pallet_number);
      } catch (err) {
        showToast(
          `Delete failed for ${pallet.pallet_number}: ${err.message}`,
          "error"
        );
        return;
      }
    }

    // STEP 3: Release pallets
    for (const release of releaseList) {
      try {
        await releasePallet(release.pallet_number, release.doa_number);
      } catch (err) {
        showToast(
          `Release failed for pallet ${release.pallet_number}: ${err.message}`,
          "error"
        );
        return;
      }
    }

    // STEP 4: Print PDFs
    try {
      if (systemRMALabelData.length > 0) {
        const labelBlob = await pdf(
          <SystemRMALabel systems={systemRMALabelData} />
        ).toBlob();
        window.open(URL.createObjectURL(labelBlob));
      }

      for (const release of releaseList) {
        const palletData = pallets.find(
          (p) => p.pallet_number === release.pallet_number
        );
        if (!palletData) continue;

        const systemsWithDetails = await Promise.all(
          (palletData.systems ?? palletData.active_systems ?? [])
            .filter((s) => s?.service_tag)
            .map(async (sys) => {
              try {
                const systemDetails = await getSystem(sys.service_tag);
                return {
                  service_tag: systemDetails.service_tag,
                  ppid: systemDetails.ppid || "UNKNOWN",
                };
              } catch (err) {
                console.error(
                  `Failed to fetch details for ${sys.service_tag}`,
                  err
                );
                return { service_tag: sys.service_tag, ppid: "" };
              }
            })
        );

        const parts = palletData.pallet_number.split("-");
        const factory_id = parts[1] || "";
        const dpn = parts[2] || "";

        const rawPallet = {
          pallet_number: palletData.pallet_number,
          doa_number: release.doa_number,
          date_released: new Date().toISOString().split("T")[0],
          dpn,
          factory_id,
          systems: systemsWithDetails,
        };

        const enriched = enrichPalletWithBarcodes(rawPallet);
        const palletBlob = await pdf(
          <PalletPaper pallet={enriched} />
        ).toBlob();
        window.open(URL.createObjectURL(palletBlob));
      }
    } catch (err) {
      showToast(`Failed to generate PDF: ${err.message}`, "error");
      return;
    }

    // STEP 4.5: Apply staged lock changes
    const pendingLockUpdates = pallets
      .filter(
        (p) => lockFlags[p.id] !== undefined && lockFlags[p.id] !== !!p.locked
      )
      .map((p) => ({
        pallet_number: p.pallet_number,
        desired: lockFlags[p.id],
        id: p.id,
      }));

    for (const upd of pendingLockUpdates) {
      try {
        const res = await setPalletLock(upd.pallet_number, upd.desired);
        setPallets((prev) =>
          prev.map((p) =>
            p.id === upd.id
              ? { ...p, ...(res?.pallet || { locked: upd.desired }) }
              : p
          )
        );
      } catch (err) {
        showToast(
          `Failed to ${upd.desired ? "lock" : "unlock"} ${upd.pallet_number}: ${
            err.message
          }`,
          "error"
        );
        return;
      }
    }

    // STEP 5: Refetch pallets (normalize again)
    try {
      const data = await getPallets({
        filters: {
          conditions: [{ field: "status", op: "=", values: ["open"] }],
        },
      });
      const refreshed = Array.isArray(data?.data) ? data.data : [];
      const normalized = refreshed.map((p) => ({
        ...p,
        active_systems: p.active_systems ?? p.systems ?? [],
        systems: p.systems ?? p.active_systems ?? [],
      }));
      setPallets(normalized);
      setInitialPallets(structuredClone(normalized));
      setReleaseFlags({});
      setLockFlags({});
      const parts = [];
      if (moves.length > 0) parts.push(`Submitted ${moves.length} move(s)`);
      if (emptyPallets.length > 0)
        parts.push(`Deleted ${emptyPallets.length} empty pallet(s)`);
      if (lockedCount > 0 || unlockedCount > 0)
        parts.push(`Locks: ${lockedCount} locked / ${unlockedCount} unlocked`);
      showToast(parts.join(", "), "info");
    } catch (err) {
      showToast(`Failed to refresh pallets: ${err.message}`, "error");
    }
  };

  const { token } = useContext(AuthContext);

  return (
    <>
      <Toast />
      <ConfirmDialog />
      {/* Create Pallet Modal */}
      {/* Download Report Modal */}
      {showReportModal && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => !reportGenerating && setShowReportModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">Download Report</h3>

            <div className="space-y-5">
              {/* Status */}
              <section>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  Pallet Lock Status
                </h4>
                <div className="flex gap-3">
                  {[
                    { value: "all", label: "All" },
                    { value: "locked", label: "Locked only" },
                    { value: "unlocked", label: "Unlocked only" },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className="inline-flex items-center gap-2"
                    >
                      <input
                        type="radio"
                        name="status-filter"
                        value={opt.value}
                        checked={statusFilter === opt.value}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              {/* DPN */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-700">DPN</h4>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => selectAll(setSelectedDpns, uniqueDpns)}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => selectNone(setSelectedDpns)}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {uniqueDpns.length === 0 ? (
                  <p className="text-sm text-gray-500">No DPNs found.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {uniqueDpns.map((d) => (
                      <label key={d} className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedDpns.has(d)}
                          onChange={() => toggleSetValue(setSelectedDpns)(d)}
                        />
                        <span className="text-sm">{d}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {/* Factory */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-700">
                    Factory
                  </h4>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() =>
                        selectAll(setSelectedFactories, uniqueFactories)
                      }
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => selectNone(setSelectedFactories)}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {uniqueFactories.length === 0 ? (
                  <p className="text-sm text-gray-500">No factories found.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {uniqueFactories.map((f) => (
                      <label key={f} className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedFactories.has(f)}
                          onChange={() =>
                            toggleSetValue(setSelectedFactories)(f)
                          }
                        />
                        <span className="text-sm">{f}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="flex justify-end gap-2 pt-6">
              <button
                type="button"
                disabled={reportGenerating}
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reportGenerating}
                onClick={handleDownloadReport}
                className={`px-4 py-2 rounded-md text-white text-sm font-semibold ${
                  reportGenerating
                    ? "bg-gray-400 cursor-wait"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {reportGenerating ? "Generating…" : "Download CSV"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => !creatingPallet && setShowCreateModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3">Create New Pallet</h3>
            <form onSubmit={handleCreatePallet} className="space-y-3">
              {/* DPN typable dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  DPN
                </label>
                <input
                  list="dpn-list"
                  value={newPalletForm.dpn}
                  onChange={(e) =>
                    setNewPalletForm((p) => ({ ...p, dpn: e.target.value }))
                  }
                  placeholder="Start typing to search…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring focus:ring-blue-200 text-sm"
                />
                <datalist id="dpn-list">
                  {dpnOptions.map((d) => (
                    <option key={d.id ?? d.name} value={d.name} />
                  ))}
                </datalist>
              </div>

              {/* Factory Code typable dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Factory Code
                </label>
                <input
                  list="factory-code-list"
                  value={newPalletForm.factoryCode}
                  onChange={(e) =>
                    setNewPalletForm((p) => ({
                      ...p,
                      factoryCode: e.target.value,
                    }))
                  }
                  placeholder="Start typing to search… (e.g., MX)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring focus:ring-blue-200 text-sm"
                />
                <datalist id="factory-code-list">
                  {factoryOptions.map((f) => (
                    <option
                      key={f.id ?? f.code}
                      value={f.code} // <- use the CODE as the input value
                      label={f.name || undefined} // nice hint in some browsers
                    />
                  ))}
                </datalist>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={creatingPallet}
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingPallet}
                  className={`px-4 py-2 rounded-md text-white text-sm font-semibold ${
                    creatingPallet
                      ? "bg-gray-400 cursor-wait"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {creatingPallet ? "Creating..." : "Create Pallet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <main className="md:max-w-10/12 mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <h1 className="text-3xl font-semibold text-gray-800">
          Shipping Manager
        </h1>

        {/* Tabs */}
        <div className="flex gap-4 mt-2 border-b border-gray-200">
          <button
            onClick={() => setTab("active")}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
              tab === "active"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Active Pallets
          </button>
          <button
            onClick={() => setTab("inactive")}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
              tab === "inactive"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Inactive Pallets
          </button>
        </div>

        {tab === "active" ? (
          <>
            <div className="flex justify-end mt-3 gap-2">
              <button
                onClick={() => setShowCreateModal(true)}
                className={`bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-s ${
                  !token ? "opacity-30 pointer-events-none" : ""
                }`}
                title="Create a new empty pallet by DPN + Factory"
              >
                Add Pallet
              </button>

              <button
                onClick={() => setShowReportModal(true)}
                disabled={reportGenerating}
                className={` px-2 py-2 rounded-lg shadow-s ${
                  reportGenerating
                    ? "bg-green-200 text-green-500 cursor-wait"
                    : "bg-green-600 hover:bg-green-700  text-white px-4 "
                }`}
                title="Download CSV of units from current open pallets"
              >
                {reportGenerating ? "Generating..." : "Download Report"}
              </button>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => setActiveDragData(e.active.data.current)}
              onDragEnd={handleDragEnd}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.isArray(pallets) &&
                  pallets.map((pallet) => (
                    <PalletGrid
                      key={`${pallet.id}-${!!releaseFlags[pallet.id]}-${
                        lockFlags[pallet.id] ?? "nc"
                      }`}
                      pallet={pallet}
                      releaseFlags={releaseFlags}
                      setReleaseFlags={setReleaseFlags}
                      onLockUpdated={handleLockUpdated}
                      setPalletLock={setPalletLock}
                      showToast={showToast}
                      lockFlags={lockFlags}
                      setLockFlags={setLockFlags}
                    />
                  ))}
              </div>

              <DragOverlay>
                {activeDragData?.system ? (
                  <SystemBox serviceTag={activeDragData.system.service_tag} />
                ) : null}
              </DragOverlay>
            </DndContext>

            <div className="w-full flex justify-end mt-6">
              <button
                onClick={handleSubmit}
                disabled={!palletsChanged}
                className={`px-6 py-2 rounded-lg font-semibold text-white transition ${
                  palletsChanged
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-gray-400 cursor-not-allowed"
                }`}
              >
                Submit Changes
              </button>
              <button
                onClick={() => {
                  setPallets(structuredClone(initialPallets));
                  setReleaseFlags({});
                  setLockFlags({});
                  showToast("Changes have been reverted.", "info");
                }}
                disabled={!palletsChanged}
                className={`ml-2 px-4 py-2 rounded font-semibold transition ${
                  palletsChanged
                    ? "bg-gray-500 text-white hover:bg-gray-600"
                    : "bg-gray-300 text-gray-400 cursor-not-allowed"
                }`}
              >
                Reset
              </button>
            </div>
          </>
        ) : (
          <SearchContainerSS
            title="Released Pallets"
            displayOrder={[
              "pallet_number",
              "doa_number",
              "created_at",
              "released_at",
            ]}
            visibleFields={[
              "pallet_number",
              "doa_number",
              "created_at",
              "released_at",
            ]}
            linkType="external"
            fetchData={fetchReleasedPallets}
            truncate={true}
            defaultSortBy="released_at"
            defaultSortAsc={false}
          />
        )}
      </main>
    </>
  );
}
