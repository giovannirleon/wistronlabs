import { useState } from "react";

function AdminPage() {
  const [tab, setTab] = useState("users");
  const LOCATION = import.meta.env.VITE_LOCATION;

  return (
    <main className="md:max-w-10/12  mx-auto mt-10 bg-white rounded-2xl shadow-lg p-6 space-y-6">
      <h1 className="text-3xl font-semibold text-gray-800">Admin</h1>
      {/* Tabs */}
      <div className="flex gap-4 mt-2 border-b border-gray-200">
        <button
          onClick={() => setTab("users")}
          className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
            tab === "active"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Users
        </button>
        <button
          onClick={() => setTab("dpns")}
          className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
            tab === "inactive"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          DPNs
        </button>
      </div>

      {tab === "users" && <>Users at {LOCATION}</>}
    </main>
  );
}

export default AdminPage;
