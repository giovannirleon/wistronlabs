import { useMemo, useState, useEffect } from "react";
import useApi from "../hooks/useApi";
import useToast from "../hooks/useToast";

function AdminPage() {
  const [tab, setTab] = useState("users");
  const LOCATION = import.meta.env.VITE_LOCATION;

  const { getUsers, getMe, setUserAdmin } = useApi();
  const [users, setUsers] = useState([]);
  const [baselineUsers, setBaselineUsers] = useState([]); // snapshot to diff from
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const { showToast, Toast } = useToast();

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

        {tab === "dpns" && <div>DPNs at {LOCATION}</div>}
      </main>
    </>
  );
}

export default AdminPage;
