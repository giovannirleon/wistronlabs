export default function DeleteSystemModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg p-8 relative space-y-6">
        <button
          onClick={() => setShowDeleteModal(false)}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>

        <h2 className="text-2xl font-semibold text-gray-800">
          Confirm Deletion
        </h2>

        <p className="text-gray-700">
          Are you sure you want to delete this unit? This action cannot be
          undone.
        </p>

        <div className="flex justify-end space-x-2">
          <button
            onClick={() => setShowDeleteModal(false)}
            className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              try {
                const res = await fetch(
                  `https://backend.tss.wistronlabs.com:/api/v1/systems/${serviceTag}`,
                  { method: "DELETE" }
                );
                if (!res.ok) throw new Error("Failed to delete unit");

                setShowDeleteModal(false);

                setToast({
                  message: "Unit deleted successfully",
                  type: "success",
                });
                setTimeout(
                  () => setToast({ message: "", type: "success" }),
                  3000
                );

                // Optionally navigate away or refresh
                window.location.href = "/tracking";
              } catch (err) {
                console.error(err);
                setToast({
                  message: "Error deleting unit",
                  type: "error",
                });
                setTimeout(
                  () => setToast({ message: "", type: "success" }),
                  3000
                );
                setShowDeleteModal(false);
              }
            }}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 shadow-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
