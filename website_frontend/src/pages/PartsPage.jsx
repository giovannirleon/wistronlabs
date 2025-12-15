import React, { useContext, useEffect, useMemo, useState } from "react";
import Select, { components } from "react-select";
import useApi from "../hooks/useApi";
import useToast from "../hooks/useToast";
import SearchContainer from "../components/SearchContainer";
import { AuthContext } from "../context/AuthContext.jsx";

// ─────────────────────────────────────────────────────────────
// Helpers: grouped react-select options by category
// ─────────────────────────────────────────────────────────────
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
const PartGroupLabel = (group) => (
  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide py-1">
    {group.label}
  </div>
);

const select40Styles = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    height: 40,
    borderColor: state.isFocused ? "#60A5FA" : "#D1D5DB",
    boxShadow: "none",
    "&:hover": { borderColor: state.isFocused ? "#60A5FA" : "#D1D5DB" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 8px" }),
  indicatorsContainer: (base) => ({ ...base, height: 40 }),
  input: (base) => ({ ...base, margin: 0, padding: 0 }),
  placeholder: (base) => ({ ...base, margin: 0 }),
  singleValue: (base) => ({ ...base, margin: 0 }),
};

// ─────────────────────────────────────────────────────────────
// Modal: Add Inventory (single or bulk CSV)
// ─────────────────────────────────────────────────────────────
function AddInventoryModal({ onClose, parts, onAdd, busy }) {
  const [bulkMode, setBulkMode] = useState(false);
  const [ppid, setPpid] = useState("");
  const [partId, setPartId] = useState(null);
  const [csv, setCsv] = useState("");

  const partOptions = useMemo(() => buildGroupedPartOptions(parts), [parts]);
  const flat = useMemo(
    () => partOptions.flatMap((g) => g.options || []),
    [partOptions]
  );
  const partValue = flat.find((o) => o.value === partId) || null;

  const partNameById = useMemo(() => {
    const m = new Map();
    parts.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [parts]);
  const partIdByName = useMemo(() => {
    const m = new Map();
    parts.forEach((p) => m.set(p.name.trim().toLowerCase(), p.id));
    return m;
  }, [parts]);

  const parseCsv = (text) => {
    // Accepts: "part_name,ppid" (or tab-delimited)
    const rows = [];
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line, idx) => {
        const cols = line.split(/,|\t/).map((c) => c.trim());
        if (cols.length < 2) return;

        // Skip header row if present
        const isHeader =
          idx === 0 &&
          /^part[_\s-]?name$/i.test(cols[0]) &&
          /^ppid$/i.test(cols[1]);
        if (isHeader) return;

        const name = cols[0];
        const ppid = cols[1].toUpperCase();

        const pid = partIdByName.get(name.trim().toLowerCase()) || null;
        rows.push({ line: idx + 1, ppid, part_id: pid });
      });
    return rows;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!bulkMode) {
      await onAdd([{ ppid: ppid.toUpperCase().trim(), part_id: partId }]);
    } else {
      const parsed = parseCsv(csv);
      await onAdd(parsed); // [{ppid, part_id}]
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-xl p-6 mx-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            Add to Inventory
          </h2>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setBulkMode(false)}
            className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
              !bulkMode
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => setBulkMode(true)}
            className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
              bulkMode
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Bulk CSV
          </button>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          {!bulkMode ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Part
                </label>
                <Select
                  classNamePrefix="react-select"
                  instanceId="add-inv-part"
                  styles={select40Styles}
                  isClearable
                  isSearchable
                  placeholder="Select part"
                  value={partValue}
                  onChange={(opt) => setPartId(opt ? opt.value : null)}
                  options={partOptions}
                  filterOption={filterPartOption}
                  components={{ Option: PartOption }}
                  formatGroupLabel={PartGroupLabel}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PPID
                </label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={ppid}
                  onChange={(e) => setPpid(e.target.value.toUpperCase())}
                  placeholder="Scan or type PPID"
                  required
                />
              </div>
            </>
          ) : (
            <>
              <label className="block text-sm font-medium text-gray-700">
                CSV (part_name,ppid)
              </label>
              <textarea
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder={`BlueField 3,TW0TESTYWS90057BA023A00\nFan,TW0TESTYWS90057BA023A00`}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Unknown part names will be skipped. PPIDs are uppercased
                automatically.
              </p>
            </>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (!bulkMode && (!ppid || !partId))}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save to Inventory"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page: PartsInventory
// ─────────────────────────────────────────────────────────────
export default function PartsInventory() {
  const {
    getParts,
    getPartItems, // expect: getPartItems({ place: "inventory" | "unit", unit_id? })
    createPartItem, // createPartItem(ppid, { part_id, place, unit_id, is_functional })
  } = useApi();

  const { showToast, Toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState([]);
  const [invRows, setInvRows] = useState([]); // inventory place rows
  const [unitRows, setUnitRows] = useState([]); // unit place rows
  const [placeFilter, setPlaceFilter] = useState("all"); // all | inventory | unit
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [allCats, setAllCats] = useState(true); // true => Select All is the only active pill
  const [showAdd, setShowAdd] = useState(false);
  const [busyAdd, setBusyAdd] = useState(false);
  const [functionalFilter, setFunctionalFilter] = useState("all"); // "all" | "functional" | "nonfunctional"

  // Multi-select: can include both at once
  // Keys: "in_house" | "shipped"
  const [unitScopes, setUnitScopes] = useState(() => new Set(["in_house"])); // default: In House

  const { token } = useContext(AuthContext);

  // Fetch all parts + items
  const load = async () => {
    setLoading(true);
    try {
      const [partsList, inv, unit] = await Promise.all([
        getParts(), // [{id, name, part_category_id, category_name}, …]
        getPartItems({ place: "inventory" }),
        getPartItems({ place: "unit" }),
      ]);
      setParts(partsList || []);
      setInvRows(inv || []);
      setUnitRows(
        unit?.filter(
          (r) => r.is_functional === false || r.is_functional === true
        ) || []
      );
    } catch (e) {
      console.error(e);
      showToast(e?.body?.error || e.message || "Failed to load parts", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleUnitScope = (key) => {
    setUnitScopes((prev) => {
      const next = new Set(prev);

      if (next.has(key)) {
        // Don't allow unselecting the last remaining option
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  const categories = useMemo(() => {
    const set = new Set(
      (parts || []).map((p) => p.category_name || "Uncategorized")
    );
    return Array.from(set).sort();
  }, [parts]);

  // Initialize to "all selected" when parts load
  useEffect(() => {
    if (!parts?.length) return;
    setAllCats(true);
    setSelectedCategories(new Set());
  }, [parts, categories]);

  // Join display rows
  const partById = useMemo(() => {
    const m = new Map();
    (parts || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [parts]);

  const unified = useMemo(() => {
    const normalize = (r, place) => {
      const p = partById.get(r.part_id) || {};
      const funcBool =
        r.is_functional === true
          ? true
          : r.is_functional === false
          ? false
          : null; // handle unknowns gracefully
      // Derived: In House vs Shipped (only meaningful for Unit rows)
      // Derived: Unit Scope (table/csv) - more detailed than filter toggle
      const unitScopeLabel =
        place === "unit"
          ? r.unit_activity_state === "active"
            ? "Active"
            : r.unit_activity_state === "inactive_on_active_pallet"
            ? "RMA (Active)"
            : r.unit_activity_state === "inactive"
            ? "RMA (Inactive)"
            : "—"
          : "";

      return {
        // Display fields expected by SearchContainer:
        part_name_title: "Part",
        ppid_title: "PPID",
        place_title: "Place",
        unit_service_tag_title: "Unit",
        category_name_title: "Category",
        functional_title: "Functional",
        dpn: p.dpn || "—",
        dpn_title: "DPN",
        part_name: p.name || `#${r.part_id}`,
        ppid: r.ppid,
        place: place === "inventory" ? "Inventory" : "Unit",
        unit_service_tag:
          place === "unit" ? r.unit_service_tag || r.service_tag || "" : "",
        category_name: p.category_name || "Uncategorized",
        functional: funcBool === null ? "—" : funcBool ? "Yes" : "No",
        is_functional: funcBool, // keep raw boolean for filtering

        // ✅ New unit activity / pallet context (unit rows only)
        unit_activity_state:
          place === "unit" ? r.unit_activity_state ?? null : null,
        unit_pallet_number:
          place === "unit" ? r.unit_pallet_number ?? null : null,
        unit_pallet_status:
          place === "unit" ? r.unit_pallet_status ?? null : null,
        unit_on_active_pallet:
          place === "unit" ? r.unit_on_active_pallet ?? null : null,
        unit_scope_title: "Unit Scope",
        unit_scope: unitScopeLabel,

        // Optional: keep location text if you want to display/debug it
        system_location: place === "unit" ? r.system_location ?? "" : "",

        created_at: r.created_at,
      };
    };
    const a = (invRows || []).map((r) => normalize(r, "inventory"));
    const b = (unitRows || []).map((r) => normalize(r, "unit"));
    return [...a, ...b];
  }, [invRows, unitRows, partById]);

  const filtered = useMemo(() => {
    const isAllCats =
      selectedCategories.size === categories.length ||
      selectedCategories.size === 0;

    return unified.filter((row) => {
      // ✅ Parts in Units filter (multi-select)
      if (row.place === "Unit") {
        // If user deselects everything => show no Unit parts
        if (unitScopes.size === 0) return false;

        const st = row.unit_activity_state;

        const allowInHouse =
          unitScopes.has("in_house") &&
          (st === "active" || st === "inactive_on_active_pallet");

        const allowShipped = unitScopes.has("shipped") && st === "inactive";

        if (!allowInHouse && !allowShipped) return false;
      }

      if (placeFilter !== "all") {
        if (placeFilter === "inventory" && row.place !== "Inventory")
          return false;
        if (placeFilter === "unit" && row.place !== "Unit") return false;
      }
      // Functional filter
      if (functionalFilter !== "all") {
        if (functionalFilter === "functional" && row.is_functional !== true)
          return false;
        if (functionalFilter === "nonfunctional" && row.is_functional !== false)
          return false;
      }
      // Category filter
      if (!allCats) {
        if (selectedCategories.size === 0) return false; // "Clear" => nothing
        if (!selectedCategories.has(row.category_name)) return false;
      }
      return true;
    });
  }, [
    unified,
    placeFilter,
    allCats,
    selectedCategories,
    functionalFilter,
    unitScopes,
  ]);

  const toggleCategory = (cat) => {
    setSelectedCategories((prev) => {
      // If we're in Select All mode, start a new selection with just this cat
      if (allCats) {
        setAllCats(false);
        return new Set([cat]);
      }
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      // If user manually toggled up to all categories, flip to Select All mode
      if (next.size === categories.length) {
        setAllCats(true);
        return new Set(); // empty set while in allCats mode
      }
      return next;
    });
  };

  const selectAllCategories = () => {
    setAllCats(true);
    setSelectedCategories(new Set()); // we represent "all" with empty set + allCats=true
  };
  const clearAllCategories = () => {
    setAllCats(false);
    setSelectedCategories(new Set()); // no cats selected => show nothing
  };

  // CSV Export of current filtered rows
  const handleExportCsv = () => {
    const headers = [
      "part_name",
      "category_name",
      "dpn",
      "ppid",
      "place",
      "functional",
      "unit_service_tag",
      "unit_scope",
    ];

    const now = new Date();
    const human = now.toLocaleString(); // e.g. "12/13/2025, 2:05:31 PM"
    const stamp = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z"); // e.g. "20251213T200531Z"

    const lines = [
      headers.join(","),
      ...filtered.map((r) =>
        headers
          .map((h) => {
            const val = r[h] ?? "";
            const s = String(val);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      ),
    ];

    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // <-- timestamped filename
    a.download = `parts_inventory_report_${stamp}.csv`;

    a.click();
    URL.revokeObjectURL(url);
  };

  // Add inventory handler
  const handleAddInventory = async (rows) => {
    if (!token) {
      showToast("Log in to add inventory.", "error");
      return;
    }
    setBusyAdd(true);
    try {
      const toCreate = rows.filter((r) => r.ppid && r.part_id);
      if (toCreate.length === 0) {
        showToast("No valid rows to add", "error");
        setBusyAdd(false);
        return;
      }
      await Promise.all(
        toCreate.map((r) =>
          createPartItem(String(r.ppid).toUpperCase().trim(), {
            part_id: r.part_id,
            place: "inventory",
            unit_id: null,
            is_functional: true,
          })
        )
      );
      showToast(`Added ${toCreate.length} part(s) to inventory`, "success");
      setShowAdd(false);
      await load();
    } catch (e) {
      console.error(e);
      showToast(
        e?.body?.error || e.message || "Failed to add inventory",
        "error"
      );
    } finally {
      setBusyAdd(false);
    }
  };

  const displayOrder = [
    "part_name",
    "category_name",
    "dpn",
    "ppid",
    "place",
    "functional",
    "unit_service_tag",
    "unit_scope",
  ];

  const visibleFields = [
    "part_name",
    "category_name",
    "dpn",
    "ppid",
    "place",
    "unit_scope",
    "functional",
    "unit_service_tag",
  ];

  return (
    <main className="md:max-w-10/12  mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
          Parts Inventory
        </h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!token}
            onClick={() => token && setShowAdd(true)}
            title={token ? "" : "Log in to add inventory"}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-sm
             disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            + Add to Inventory
          </button>

          <button
            type="button"
            className="bg-gray-700 hover:bg-gray-800 text-white font-medium px-4 py-2 rounded-lg shadow-s"
            onClick={handleExportCsv}
          >
            Export CSV (Filtered)
          </button>
        </div>
      </div>
      {/* Filters */}
      <div
        className="grid gap-4 bg-gray-50 rounded-xl border border-gray-200 p-4 items-start
             grid-cols-1 md:[grid-template-columns:minmax(220px,max-content)_1fr]"
      >
        {/* Left-side controls: Place + Functional */}
        <div className="min-w-0">
          <div className="flex flex-wrap gap-6">
            {/* Place */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Place
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { v: "all", label: "All" },
                  { v: "inventory", label: "In Inventory" },
                  { v: "unit", label: "In Unit" },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setPlaceFilter(opt.v)}
                    className={`px-3 py-1.5 rounded-lg text-sm shadow-sm border ${
                      placeFilter === opt.v
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Functional */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Functional
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { v: "all", label: "All" },
                  { v: "functional", label: "Functional" },
                  { v: "nonfunctional", label: "Non-Functional" },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFunctionalFilter(opt.v)}
                    className={`px-3 py-1.5 rounded-lg text-sm shadow-sm border ${
                      functionalFilter === opt.v
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Parts in Units */}
            {placeFilter !== "inventory" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Parts in Units
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { k: "in_house", label: "In House" },
                    { k: "shipped", label: "Shipped" },
                  ].map((opt) => {
                    const active = unitScopes.has(opt.k);
                    return (
                      <button
                        key={opt.k}
                        type="button"
                        onClick={() => toggleUnitScope(opt.k)}
                        className={`px-3 py-1.5 rounded-lg text-sm shadow-sm border ${
                          active
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Categories (right, pinned to box edge) */}
        <div className="min-w-0 md:justify-self-end md:w-full">
          <label className="block text-sm font-medium text-gray-700 mb-1 md:text-right">
            Categories
          </label>
          <div className="flex flex-wrap gap-2 w-full md:justify-end">
            <button
              type="button"
              onClick={selectAllCategories}
              className={`px-3 py-1.5 rounded-lg text-sm shadow-sm border ${
                allCats
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
              }`}
            >
              All
            </button>
            {categories.map((cat) => {
              const active = !allCats && selectedCategories.has(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-sm shadow-sm border ${
                    active
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                  }`}
                  title={cat}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Data Table */}
      <SearchContainer
        data={loading ? [] : filtered}
        title=""
        displayOrder={displayOrder}
        defaultSortBy="part_name"
        defaultSortAsc={true}
        fieldStyles={{
          place: (v) =>
            v === "Inventory"
              ? { type: "pill", color: "bg-green-100 text-green-800" }
              : { type: "pill", color: "bg-yellow-100 text-yellow-800" },
          functional: (v) =>
            v === "Yes"
              ? { type: "pill", color: "bg-green-100 text-green-800" }
              : v === "No"
              ? { type: "pill", color: "bg-red-100 text-red-800" }
              : "text-gray-400 text-xs italic",
          unit_service_tag: (v) =>
            v ? "font-mono text-xs" : "text-gray-400 text-xs italic",
          unit_scope: (v) =>
            v === "Active"
              ? { type: "pill", color: "bg-blue-100 text-blue-800" }
              : v === "RMA (Active)"
              ? { type: "pill", color: "bg-yellow-100 text-yellow-800" }
              : v === "RMA (Inactive)"
              ? { type: "pill", color: "bg-gray-200 text-gray-800" }
              : "text-gray-400 text-xs italic",

          ppid: "font-mono text-xs",
        }}
        visibleFields={visibleFields}
        linkType="none"
        allowSort={true}
        allowSearch={true}
        defaultPage="first"
        truncate={false}
      />
      {showAdd && (
        <AddInventoryModal
          onClose={() => setShowAdd(false)}
          parts={parts}
          onAdd={handleAddInventory}
          busy={busyAdd}
        />
      )}
      <Toast />
    </main>
  );
}
