import React, { useEffect, useState } from "react";
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
      className={`w-full h-full flex items-center justify-center `}
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

const PalletGrid = ({
  pallet,
  releaseFlags,
  setReleaseFlags,
  onLockUpdated, // kept for backwards-compat (unused now; lock applied on submit)
  setPalletLock, // kept for backwards-compat (used on submit)
  showToast,
  lockFlags, // NEW
  setLockFlags, // NEW
}) => {
  const isEmpty = (pallet.active_systems || []).every((s) => s == null);
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

  const systems = pallet.active_systems || [];

  // ---- STAGED LOCK TOGGLE (no server call here) ----
  const currentLocked = !!pallet.locked;
  const pending = lockFlags[pallet.id]; // undefined | boolean (desired)
  const hasPending = pending !== undefined;
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

  const toggleLockStaged = () => {
    // If no pending flag, stage the opposite of current
    if (!hasPending) {
      setLockFlags((prev) => ({ ...prev, [pallet.id]: !currentLocked }));
      //showToast(
      // `Staged: ${!currentLocked ? "Lock" : "Unlock"} ${pallet.pallet_number}`,
      //   "info"
      // );
      return;
    }
    // If pending exists, clear it (back to "no change")
    setLockFlags((prev) => {
      const copy = { ...prev };
      delete copy[pallet.id];
      return copy;
    });
    //showToast(`Cleared staged change for ${pallet.pallet_number}`, "info");
  };

  return (
    <div className="border border-gray-300 rounded-2xl shadow-md hover:shadow-lg transition p-4 bg-white flex flex-col justify-between">
      <div className="mb-2 relative">
        <h2 className="text-md font-medium text-gray-700 pr-32">
          {pallet.pallet_number}
        </h2>
        <p className="text-xs text-gray-500">
          Created on {formatDateHumanReadable(pallet.created_at)}
        </p>

        {/* Lock chip  stage/clear button */}
        <div className="absolute top-0 right-0 flex items-center gap-2">
          <span
            className={`px-2 py-1 text-xs font-semibold rounded-md border ${stateStyles[stateKey]}`}
            title={
              hasPending
                ? "Pending lock change (applied on Submit Changes)"
                : "Current lock state"
            }
          >
            {stateLabel[stateKey]}
          </span>
          <button
            onClick={toggleLockStaged}
            className="px-2 py-1 text-xs font-semibold rounded-md border border-neutral-300 hover:bg-neutral-50"
            title={
              hasPending
                ? "Clear staged lock change"
                : "Stage a lock/unlock change (applied on Submit Changes)"
            }
          >
            {hasPending ? "Clear Pending" : "Toggle Lock"}
          </button>
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
                {system && (
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

  // NEW: staged lock changes
  const [lockFlags, setLockFlags] = useState({});

  const [releaseFlags, setReleaseFlags] = useState({});
  const [tab, setTab] = useState("active");
  const FRONTEND_URL = import.meta.env.VITE_URL;

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
            (pallet.systems || []).filter(Boolean).map(async (sys) => {
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

          const rawPallet = {
            pallet_number: pallet.pallet_number,
            doa_number: pallet.doa_number,
            date_released: pallet.released_at?.split("T")[0] || "",
            dpn: pallet.pallet_number.split("-")[2] || "",
            factory_id: pallet.pallet_number.split("-")[1] || "",
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  const {
    getSystem,
    getPallets,
    moveSystemBetweenPallets,
    releasePallet,
    deletePallet,
    setPalletLock,
  } = useApi();

  useEffect(() => {
    const loadPallets = async () => {
      try {
        const data = await getPallets({
          filters: {
            conditions: [
              {
                field: "status",
                op: "=",
                values: ["open"],
              },
            ],
          },
        });

        const result = Array.isArray(data?.data) ? data.data : [];
        const normalized = result.map((p) => ({
          ...p,
          // backend may send only `systems`; keep your DnD code happy
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

  const handleLockUpdated = (updatedPallet) => {
    // kept for compatibility; still used if you refactor to instant updates elsewhere
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

  const handleDownloadLockedReport = async () => {
    try {
      setDownloadingReport(true);

      // Use effective lock (staged lock takes precedence if present)
      const lockedPallets = pallets.filter(
        (p) => (lockFlags[p.id] ?? p.locked) === true
      );

      if (lockedPallets.length === 0) {
        showToast("No locked pallets to report.", "info");
        return;
      }

      // Build rows: Pallet Number, Service Tag, PPID, Issue, Location, Factory Code
      const rows = [
        [
          "pallet_number",
          "service_tag",
          "ppid",
          "issue",
          "location",
          "factory_code",
        ],
      ];

      for (const pallet of lockedPallets) {
        const systems = (pallet.systems ?? pallet.active_systems ?? []).filter(
          Boolean
        );
        if (systems.length === 0) continue;

        // fetch PPIDs in parallel for this pallet
        const details = await Promise.all(
          systems.map(async (s) => {
            try {
              const d = await getSystem(s.service_tag);
              return {
                st: s.service_tag,
                ppid: (d?.ppid || "").trim(),
                issue: d?.issue ?? "",
                location: d?.location ?? "",
                factory_code: d?.factory_code ?? "",
              };
            } catch {
              return {
                st: s.service_tag,
                ppid: "",
                issue: "",
                location: "",
                factory_code: "",
              };
            }
          })
        );

        for (const d of details) {
          rows.push([
            pallet.pallet_number,
            d.st,
            d.ppid || "",
            d.issue,
            d.location,
            d.factory_code,
          ]);
        }
      }

      // Convert to CSV
      const csv = rows
        .map((r) =>
          r
            .map((cell) => {
              const v = String(cell ?? "");
              // escape quotes, wrap in quotes if needed
              const needsQuotes = /[",\n]/.test(v);
              const escaped = v.replace(/"/g, '""');
              return needsQuotes ? `"${escaped}"` : escaped;
            })
            .join(",")
        )
        .join("\n");

      // Download
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `locked-pallet-report-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast("Locked Pallet Report downloaded.", "info");
    } catch (err) {
      console.error(err);
      showToast(`Failed to build report: ${err.message || err}`, "error");
    } finally {
      setDownloadingReport(false);
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

    // Client-side lock guard (mirrors backend rule)
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

      const getDPN = (p) => p.pallet_number.split("-")[2];
      const getFactory = (p) => p.pallet_number.split("-")[1];

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

      if (toPallet.active_systems[toIdx]) {
        showToast("Target slot already occupied", "error");
        return prev;
      }

      fromPallet.active_systems[fromIdx] = undefined;
      toPallet.active_systems[toIdx] = system;

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
        .filter(Boolean)
        .map((s) => s.service_tag)
        .sort();

      const initialTags = (initial.active_systems || [])
        .filter(Boolean)
        .map((s) => s.service_tag)
        .sort();

      if (currentTags.length !== initialTags.length) return true;
      for (let j = 0; j < currentTags.length; j++) {
        if (currentTags[j] !== initialTags[j]) return true;
      }
    }

    const hasAnyRelease = Object.keys(releaseFlags).length > 0;
    if (hasAnyRelease) return true;

    // NEW: consider staged lock changes
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

    // Snapshot lock counts at time of submission
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

    const emptyPallets = pallets
      .filter((p) => (p.active_systems || []).every((s) => s == null))
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
      const dpn = toPallet?.pallet_number.split("-")[2] || "UNKNOWN";
      const factory_code = toPallet?.pallet_number.split("-")[1] || "UNKNOWN";
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
            .filter(Boolean)
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
                return {
                  service_tag: sys.service_tag,
                  ppid: "",
                };
              }
            })
        );

        const rawPallet = {
          pallet_number: palletData.pallet_number,
          doa_number: release.doa_number,
          date_released: new Date().toISOString().split("T")[0],
          dpn: palletData.pallet_number.split("-")[2] || "",
          factory_id: palletData.pallet_number.split("-")[1] || "",
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

    // STEP 4.5: Apply staged lock changes (AFTER moves/deletes/releases)
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
        // keep local state in sync if you don't refetch below
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

    // STEP 5: Refetch pallets
    try {
      const data = await getPallets({
        filters: {
          conditions: [{ field: "status", op: "=", values: ["open"] }],
        },
      });
      const refreshed = Array.isArray(data?.data) ? data.data : [];
      setPallets(refreshed);
      setInitialPallets(structuredClone(refreshed));
      setReleaseFlags({});
      setLockFlags({}); // clear staged lock changes
      const parts = [];

      if (moves.length > 0) {
        parts.push(`Submitted ${moves.length} move(s)`);
      }

      if (emptyPallets.length > 0) {
        parts.push(`Deleted ${emptyPallets.length} empty pallet(s)`);
      }

      if (lockedCount > 0 || unlockedCount > 0) {
        parts.push(`Locks: ${lockedCount} locked / ${unlockedCount} unlocked`);
      }

      showToast(parts.join(", "), "info");
    } catch (err) {
      showToast(`Failed to refresh pallets: ${err.message}`, "error");
    }
  };

  return (
    <>
      <Toast />
      <ConfirmDialog />
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
            <div className="flex justify-end mt-3">
              <button
                onClick={handleDownloadLockedReport}
                disabled={downloadingReport}
                className={`px-4 py-2 text-sm font-semibold rounded-md border
                   ${
                     downloadingReport
                       ? "bg-gray-200 text-gray-500 cursor-wait"
                       : "bg-white hover:bg-neutral-50 text-blue-700 border-blue-200"
                   }`}
                title="Download CSV of units (ST  PPID) on locked pallets"
              >
                {downloadingReport
                  ? "Generating..."
                  : "Download Locked Pallet Report"}
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
            truncate={false}
          />
        )}
      </main>
    </>
  );
}
