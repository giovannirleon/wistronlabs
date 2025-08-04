import React, { useEffect, useState } from "react";
import useToast from "../hooks/useToast";
import useConfirm from "../hooks/useConfirm";
import { Link } from "react-router-dom";
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
    <div className="w-full h-full flex items-center justify-center rounded-lg text-sm font-semibold transition bg-neutral-100 text-neutral-800 border border-neutral-300 shadow-sm hover:ring-2 hover:ring-neutral-300 hover:bg-neutral-200 cursor-move">
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
    opacity: isDragging ? 0.5 : 1, // <-- dim source
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
      className={`h-16 w-full flex items-center justify-center rounded-lg text-sm font-semibold transition-all duration-150 ${
        children
          ? "bg-neutral-100 text-neutral-800 border border-neutral-300 shadow-sm hover:ring-2 hover:ring-neutral-300"
          : "bg-white text-neutral-400 border border-dashed border-neutral-300 italic"
      } ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {children || "Empty"}
    </div>
  );
}

const PalletGrid = ({ pallet, releaseFlags, setReleaseFlags }) => {
  const isEmpty = pallet.active_systems.every((s) => s == null);
  const isReleased = !!releaseFlags[pallet.id];

  const toggleRelease = () => {
    setReleaseFlags((prev) => ({
      ...prev,
      [pallet.id]: !prev[pallet.id],
    }));
  };

  return (
    <div className="border border-gray-300 rounded-2xl shadow-md hover:shadow-lg transition p-4 bg-white flex flex-col justify-between">
      <div>
        <h2 className="text-md font-medium text-gray-700 mb-2">
          {pallet.pallet_number}
        </h2>
        <div className="grid grid-cols-3 grid-rows-3 gap-2 mb-4">
          {Array.from({ length: 9 }).map((_, idx) => {
            const system = pallet.active_systems[idx];
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
    </div>
  );
};

export default function ShippingPage() {
  const { showToast, Toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [pallets, setPallets] = useState([]);
  const [initialPallets, setInitialPallets] = useState([]);
  const [activeDragData, setActiveDragData] = useState(null);
  const [releaseFlags, setReleaseFlags] = useState({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  useEffect(() => {
    const startingPallets = [
      {
        id: 4,
        pallet_number: "PAL-A1-TESTY-08042502",
        active_systems: [{ system_id: 562, service_tag: "TEST10" }],
      },
      {
        id: 3,
        pallet_number: "PAL-A1-TESTY-08042501",
        active_systems: [
          { system_id: 560, service_tag: "TEST09" },
          { system_id: 559, service_tag: "TEST08" },
          { system_id: 558, service_tag: "TEST07" },
          { system_id: 557, service_tag: "TEST06" },
          { system_id: 556, service_tag: "TEST05" },
          { system_id: 555, service_tag: "TEST04" },
          { system_id: 554, service_tag: "TEST03" },
          { system_id: 553, service_tag: "TEST02" },
          { system_id: 552, service_tag: "TEST01" },
        ],
      },
      {
        id: 2,
        pallet_number: "PAL-A1-RRFGY-08012501",
        active_systems: [{ system_id: 541, service_tag: "GJQZS64" }],
      },
      {
        id: 20,
        pallet_number: "PAL-A1-RRFGY-08012501",
        active_systems: [{ system_id: 541, service_tag: "GZQZS64" }],
      },
      {
        id: 10,
        pallet_number: "PAL-N2-RRFGY-08012501",
        active_systems: [{ system_id: 541, service_tag: "GJQXS64" }],
      },
    ];
    setPallets(startingPallets);
    setInitialPallets(structuredClone(startingPallets));
  }, []);

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

      const currentTags = current.active_systems
        .filter(Boolean)
        .map((s) => s.service_tag)
        .sort();

      const initialTags = initial.active_systems
        .filter(Boolean)
        .map((s) => s.service_tag)
        .sort();

      if (currentTags.length !== initialTags.length) return true;
      for (let j = 0; j < currentTags.length; j++) {
        if (currentTags[j] !== initialTags[j]) return true;
      }
    }
    return false;
  })();

  return (
    <>
      <Toast />
      <ConfirmDialog />
      <main className="md:max-w-10/12 mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <h1 className="text-3xl font-semibold text-gray-800">
          Current Pallets
        </h1>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveDragData(e.active.data.current)}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {pallets.map((pallet) => (
              <PalletGrid
                key={pallet.id}
                pallet={pallet}
                releaseFlags={releaseFlags}
                setReleaseFlags={setReleaseFlags}
              />
            ))}
          </div>

          <DragOverlay>
            {activeDragData ? (
              <SystemBox serviceTag={activeDragData.system.service_tag} />
            ) : null}
          </DragOverlay>
        </DndContext>

        <div className="w-full flex justify-end mt-6">
          <button
            onClick={async () => {
              const confirmed = await confirm({
                message: "Are you sure you want to submit changes?",
                title: "Confirm Submit",
                confirmText: "Yes, submit",
                cancelText: "Cancel",
                confirmClass: "bg-blue-600 text-white hover:bg-blue-700",
                cancelClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
              });

              if (!confirmed) return;
              const moves = [];

              for (const initial of initialPallets) {
                const current = pallets.find((p) => p.id === initial.id);
                if (!current) continue;

                initial.active_systems.forEach((system, idx) => {
                  if (!system) return;

                  const currentPallet = pallets.find((p) =>
                    p.active_systems.some(
                      (s) => s?.service_tag === system.service_tag
                    )
                  );

                  const currentIndex = currentPallet?.active_systems.findIndex(
                    (s) => s?.service_tag === system.service_tag
                  );

                  if (!currentPallet || currentPallet.id === initial.id) return;

                  moves.push({
                    service_tag: system.service_tag,
                    from_pallet_id: initial.id,
                    to_pallet_id: currentPallet.id,
                  });
                });
              }

              const emptyPallets = pallets
                .filter((p) => p.active_systems.every((s) => s == null))
                .map((p) => ({
                  id: p.id,
                  pallet_number: p.pallet_number,
                }));

              console.log("Moves:", moves);
              console.log("Empty pallets:", emptyPallets);

              const releaseList = Object.entries(releaseFlags)
                .filter(([_, val]) => val)
                .map(([id]) => Number(id));

              console.log("Release Pallet IDs:", releaseList);

              showToast(
                `Detected ${moves.length} move(s), ${emptyPallets.length} empty pallet(s).`,
                "info"
              );
            }}
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
      </main>
    </>
  );
}
