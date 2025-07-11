export default function AddSystemModal({
  onClose,
  bulkMode,
  setBulkMode,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg p-8 relative space-y-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>

        <h2 className="text-2xl font-semibold text-gray-800">Add System</h2>

        {/* Bulk toggle */}
        <div className="flex space-x-2">
          <button
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

        <form className="space-y-4" onSubmit={onSubmit}>
          {!bulkMode ? (
            <>
              <InputField label="Service Tag" name="service_tag" />
              <InputField label="Issue" name="issue" />
              <TextAreaField label="Note" name="note" />
            </>
          ) : (
            <TextAreaField
              label="CSV Input (service_tag,issue,note)"
              name="bulk_csv"
              placeholder={`ABC123,Fails POST intermittently,Initial intake\nDEF456,Does not power on,Initial intake`}
              rows={5}
            />
          )}

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const InputField = ({ label, name }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <input
      type="text"
      name={name}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      required
    />
  </div>
);

const TextAreaField = ({ label, name, placeholder = "", rows = 3 }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <textarea
      name={name}
      rows={rows}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      placeholder={placeholder}
    ></textarea>
  </div>
);
