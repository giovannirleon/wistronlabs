import { useMemo, useState, useEffect } from "react";
import useApi from "../hooks/useApi";
import useConfirm from "../hooks/useConfirm";

import useToast from "../hooks/useToast";

function AdminPage() {
  const [tab, setTab] = useState("users");
  const LOCATION = import.meta.env.VITE_LOCATION;

  const {
    getUsers,
    getMe,
    setUserAdmin,
    getDpns,
    createDpn,
    updateDpn,
    deleteDpn,
  } = useApi();
  const [users, setUsers] = useState([]);
  const [baselineUsers, setBaselineUsers] = useState([]); // snapshot to diff from
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const [dpnQ, setDpnQ] = useState("");

  const { showToast, Toast } = useToast();

  const [dpns, setDpns] = useState([]);
  const [baselineDpns, setBaselineDpns] = useState([]);
  const [dpnLoading, setDpnLoading] = useState(false);
  const [dpnSaving, setDpnSaving] = useState(false);
  const [dpnErr, setDpnErr] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const { confirm, ConfirmDialog } = useConfirm();

  // username -> original isAdmin
  const baselineMap = useMemo(() => {
    const m = {};
    for (const u of baselineUsers) m[u.username.toLowerCase()] = !!u.isAdmin;
    return m;
  }, [baselineUsers]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [meRes, listRes] = await Promise.all([
          getMe(),
          getUsers({ page: 1, page_size: 100 }),
        ]);
        if (!alive) return;
        const meUser = meRes?.user ?? null;
        const list = listRes?.users ?? [];
        setMe(meUser);
        setUsers(list);
        setBaselineUsers(list);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || "Failed to load users");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []); // ← run once

  useEffect(() => {
    let alive = true;
    const loadDpns = async () => {
      if (tab !== "dpns" || dpnLoading || baselineDpns.length) return;
      try {
        setDpnLoading(true);
        const list = await getDpns(); // expect array of { id, name, config }
        if (!alive) return;
        setDpns(list || []);
        setBaselineDpns(list || []);
      } catch (e) {
        if (!alive) return;
        setDpnErr(e.message || "Failed to load DPNs");
      } finally {
        if (alive) setDpnLoading(false);
      }
    };
    loadDpns();
    return () => {
      alive = false;
    };
  }, [tab]); // run when switching to DPNs

  const dpnBaselineMap = useMemo(() => {
    const m = new Map();
    baselineDpns.forEach((d) =>
      m.set(d.id, { name: d.name, config: d.config ?? "" })
    );
    return m;
  }, [baselineDpns]);

  const filteredDpns = useMemo(() => {
    const q = dpnQ.trim().toLowerCase();
    if (!q) return dpns;
    return dpns.filter(
      (d) =>
        (d.name || "").toLowerCase().includes(q) ||
        (d.config || "").toLowerCase().includes(q)
    );
  }, [dpns, dpnQ]);

  const dpnHasChanges = useMemo(() => {
    // new rows have no numeric id (we’ll tag them with id like "new-123")
    return dpns.some((d) => {
      if (typeof d.id !== "number") return d.name?.trim() || d.config?.trim(); // new
      const base = dpnBaselineMap.get(d.id);
      return (
        base &&
        (base.name !== d.name || (base.config ?? "") !== (d.config ?? ""))
      );
    });
  }, [dpns, dpnBaselineMap]);

  const sanitizeName = (s = "") => s.trim().toUpperCase();
  const sanitizeConfig = (s = "") => s.trim().toUpperCase();

  const validateRow = (row) => {
    const name = sanitizeName(row.name);
    if (!name) return "DPN name is required";
    // optional: length/format checks here
    return null;
  };

  const addBlankRow = () => {
    // "Excel-like" add: create a new editable row at top
    const newId = `new-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setDpns((cur) => [{ id: newId, name: "", config: "" }, ...cur]);
  };

  const onCellChange = (id, field, value) => {
    setDpns((cur) =>
      cur.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
  };

  const onDpnDiscard = () => {
    setDpns(baselineDpns);
    setDpnErr(null);
  };

  const onDpnSave = async (e) => {
    e.preventDefault();
    setDpnErr(null);
    if (!dpnHasChanges) return;

    setDpnSaving(true);
    try {
      // Separate new vs changed
      const newRows = dpns.filter(
        (d) => typeof d.id !== "number" && (d.name?.trim() || d.config?.trim())
      );
      const changedRows = dpns.filter((d) => {
        if (typeof d.id !== "number") return false;
        const base = dpnBaselineMap.get(d.id);
        return (
          base &&
          (base.name !== d.name || (base.config ?? "") !== (d.config ?? ""))
        );
      });

      // Create new DPNs
      for (const row of newRows) {
        const name = sanitizeName(row.name);
        const config = sanitizeConfig(row.config);
        const errMsg = validateRow({ name, config });
        if (errMsg) throw new Error(`Row "${row.name || "(new)"}": ${errMsg}`);
        await createDpn({ name, config });
      }

      // Patch changed DPNs (send only changed fields)
      for (const row of changedRows) {
        const base = dpnBaselineMap.get(row.id);
        const payload = {};
        const nameSan = sanitizeName(row.name);
        const configSan = sanitizeConfig(row.config);
        if (nameSan !== base.name) payload.name = nameSan;
        if ((configSan ?? "") !== (base.config ?? ""))
          payload.config = configSan;
        if (Object.keys(payload).length > 0) {
          await updateDpn(row.id, payload);
        }
      }

      // Refresh list to get authoritative data (and new ids)
      const fresh = await getDpns();
      setDpns(fresh || []);
      setBaselineDpns(fresh || []);
      showToast("DPNs saved", "success", 2500, "bottom-right");
    } catch (e2) {
      console.error("Saving DPNs failed:", e2);
      setDpnErr(e2.message || "Failed to save DPNs");
      showToast("Failed to save DPNs", "error", 3000, "bottom-right");
    } finally {
      setDpnSaving(false);
    }
  };

  const handleDeleteDpn = async (row) => {
    // If it's a local "new" row (id not a number), just remove it from UI.
    if (typeof row.id !== "number") {
      setDpns((cur) => cur.filter((d) => d.id !== row.id));
      return;
    }

    // Confirm, then call delete
    const confirmed = await confirm({
      title: "Confirm Deletion",
      message: `Are you sure you want to delete ${row.name}? This action cannot be undone.`,
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
      setDeletingId(row.id);
      await deleteDpn(row.id);
      // remove from current and baseline lists
      setDpns((cur) => cur.filter((d) => d.id !== row.id));
      setBaselineDpns((cur) => cur.filter((d) => d.id !== row.id));
      showToast(`Deleted ${row.name}`, "success", 2200, "bottom-right");
    } catch (e) {
      const msg =
        (e?.body && e.body.error) ||
        (e?.status === 409
          ? "Cannot delete DPN: referenced by systems or pallets"
          : e?.message) ||
        "Failed to delete DPN";
      showToast(msg, "error", 3500, "bottom-right");
    } finally {
      setDeletingId(null);
    }
  };

  // Local-only toggle (no PATCH here)
  const handleLocalToggle = (u, nextChecked) => {
    setErr(null);
    const isSelf = me?.username?.toLowerCase() === u.username?.toLowerCase();

    if (!me?.isAdmin) {
      setErr("Admin privileges required.");
      return;
    }
    if (isSelf && nextChecked === false) {
      setErr("You cannot remove your own admin role.");
      return;
    }

    setUsers((cur) =>
      cur.map((x) =>
        x.username === u.username ? { ...x, isAdmin: nextChecked } : x
      )
    );
  };

  // Compute pending changes (diff current vs baseline)
  const pendingChanges = useMemo(() => {
    const changes = [];
    for (const u of users) {
      const orig = baselineMap[u.username.toLowerCase()];
      const cur = !!u.isAdmin;
      if (orig !== cur) {
        changes.push({ username: u.username, admin: cur });
      }
    }
    return changes;
  }, [users, baselineMap]);

  const hasChanges = pendingChanges.length > 0;

  const handleSave = async (e) => {
    e.preventDefault(); // prevent page reload
    setErr(null);

    if (!me?.isAdmin) {
      setErr("Admin privileges required.");
      return;
    }

    // Block self de-admin if somehow present in pending
    const self = pendingChanges.find(
      (c) => c.username.toLowerCase() === me.username.toLowerCase()
    );
    if (self && self.admin === false) {
      setErr("You cannot remove your own admin role.");
      return;
    }

    if (!hasChanges) return;

    setSaving(true);
    try {
      // Loop over single-user PATCH endpoint (sequential for easier error handling)
      for (const c of pendingChanges) {
        await setUserAdmin(c.username, c.admin);
      }
      // On success, reset baseline to current
      setBaselineUsers(users);
    } catch (e2) {
      console.error("Saving admin changes failed:", e2);
      setErr(e2.message || "Failed to save changes");
      // Optional: reload list to ensure UI matches server
      try {
        const listRes = await getUsers({ page: 1, page_size: 100 });
        setUsers(listRes?.users ?? []);
        setBaselineUsers(listRes?.users ?? []);
      } catch {}
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = (e) => {
    e.preventDefault();
    setUsers(baselineUsers); // revert local edits
    setErr(null);
  };

  return (
    <>
      <Toast />
      <ConfirmDialog />

      <main className="mx-auto mt-10 w-11/12 md:w-10/12 max-w-screen-xl bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <h1 className="text-3xl font-semibold text-gray-800">Admin</h1>

        <div className="flex gap-4 mt-2 border-b border-gray-200">
          <button
            onClick={() => setTab("users")}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
              tab === "users"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setTab("dpns")}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
              tab === "dpns"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            DPNs
          </button>
        </div>

        {tab === "users" && (
          <form onSubmit={handleSave} className="space-y-4">
            {err && <div className="text-red-600">{err}</div>}
            {loading ? (
              <div>Loading…</div>
            ) : (
              <>
                <ul className="divide-y">
                  {users.map((u) => {
                    const checked = !!u.isAdmin;
                    const isSelf =
                      me?.username?.toLowerCase() === u.username?.toLowerCase();

                    return (
                      <li
                        key={u.username}
                        className="py-2 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-medium">{u.username}</div>
                          <div className="text-xs text-gray-500">
                            {checked ? "Admin" : "User"} ·{" "}
                            {u.createdAt
                              ? new Date(u.createdAt).toLocaleString()
                              : ""}
                            {isSelf ? " · you" : ""}
                          </div>
                        </div>

                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked;
                              if (isSelf && checked && !next) {
                                showToast(
                                  "You cannot remove your own Admin Role",
                                  "error",
                                  3000,
                                  "bottom-right"
                                );
                                e.preventDefault();
                                return;
                              }
                              handleLocalToggle(u, next); // local-only
                            }}
                            disabled={!me?.isAdmin}
                            aria-label={`Make ${u.username} an admin`}
                          />
                          <span className="text-sm">Admin</span>
                        </label>
                      </li>
                    );
                  })}
                  {users.length === 0 && (
                    <li className="py-2 text-gray-500">No users.</li>
                  )}
                </ul>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={handleDiscard}
                    disabled={saving || !hasChanges}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Discard changes
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !hasChanges}
                    className={`px-4 py-2 rounded-lg text-white ${
                      hasChanges
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "bg-blue-300 cursor-not-allowed"
                    }`}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </>
            )}
          </form>
        )}

        {tab === "dpns" && (
          <form onSubmit={onDpnSave} className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={addBlankRow}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  + Add row
                </button>
                <div className="relative">
                  <input
                    value={dpnQ}
                    onChange={(e) => setDpnQ(e.target.value)}
                    placeholder="Search DPN or config"
                    className="rounded-lg border border-gray-300 px-3 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="absolute left-3 top-2.5 text-gray-400">
                    🔎
                  </span>
                </div>
              </div>
              <div className="flex-1" />
              {dpnErr && <div className="text-red-600 text-sm">{dpnErr}</div>}
            </div>

            {/* Grid */}
            <div className="overflow-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">DPN</th>
                    <th className="text-left font-medium px-3 py-2">Config</th>
                    <th className="text-right font-medium px-3 py-2 w-28">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dpnLoading ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-6 text-center text-gray-500"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : filteredDpns.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-6 text-center text-gray-500"
                      >
                        No matching DPNs
                      </td>
                    </tr>
                  ) : (
                    filteredDpns.map((d) => {
                      const isNew = typeof d.id !== "number";
                      const base = isNew ? null : dpnBaselineMap.get(d.id);
                      const changed =
                        isNew ||
                        (base &&
                          (base.name !== d.name ||
                            (base.config ?? "") !== (d.config ?? "")));

                      return (
                        <tr
                          key={d.id}
                          className={changed ? "bg-amber-50/40" : ""}
                        >
                          <td className="px-3 py-2 align-middle">
                            <input
                              value={d.name ?? ""}
                              onChange={(e) =>
                                onCellChange(d.id, "name", e.target.value)
                              }
                              className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                changed ? "border-amber-300" : "border-gray-300"
                              }`}
                              placeholder="e.g. 7RC0V"
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <input
                              value={d.config ?? ""}
                              onChange={(e) =>
                                onCellChange(d.id, "config", e.target.value)
                              }
                              className={`w-full rounded-md border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                changed ? "border-amber-300" : "border-gray-300"
                              }`}
                              placeholder="e.g. B1"
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => handleDeleteDpn(d)}
                                disabled={deletingId === d.id || dpnSaving}
                                className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                title="Delete DPN"
                              >
                                {deletingId === d.id ? "Deleting…" : "Delete"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="sticky bottom-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t pt-3 pb-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={onDpnDiscard}
                disabled={dpnSaving || !dpnHasChanges}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Discard changes
              </button>
              <button
                type="submit"
                disabled={dpnSaving || !dpnHasChanges}
                className={`px-4 py-2 rounded-lg text-white ${
                  dpnHasChanges
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-blue-300 cursor-not-allowed"
                }`}
              >
                {dpnSaving ? "Saving…" : "Save DPNs"}
              </button>
            </div>
          </form>
        )}
      </main>
    </>
  );
}

export default AdminPage;
