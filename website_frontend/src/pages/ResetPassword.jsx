import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!newPassword || !confirmPassword) {
      setMessage("Please fill in all fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const res = await axios.post("/api/v1/auth/reset-password", {
        token,
        newPassword,
      });

      setMessage(res.data.message || "Password has been reset successfully.");
      setTimeout(() => {
        navigate("/auth");
      }, 3000);
    } catch (err) {
      setMessage(
        err.response?.data?.error || "Failed to reset password. Try again."
      );
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50 px-4">
        <div className="bg-white shadow-md rounded-lg p-6 max-w-sm w-full text-center">
          <div className="flex justify-center mb-4">
            <svg
              className="h-12 w-12 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.054 0 1.918-.816 1.995-1.85L21 17V7c0-1.054-.816-1.918-1.85-1.995L19 5H5c-1.054 0-1.918.816-1.995 1.85L3 7v10c0 1.054.816 1.918 1.85 1.995L5 19z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-800">
            Invalid or Missing Token
          </h2>
          <p className="text-gray-600 mt-2 text-sm">
            The password reset link is invalid, expired, or missing. Please
            request a new one from the login page.
          </p>
          <button
            onClick={() => (window.location.href = "/auth")}
            className="mt-4 inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow text-sm"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-start min-h-[calc(100vh-60px)]">
      <div className="w-full max-w-md bg-white shadow rounded-xl p-6 mt-20 sm:p-8">
        <h1 className="text-xl sm:text-2xl font-bold text-center text-gray-800 mb-6">
          Reset Your Password
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            required
          />

          <input
            type="password"
            placeholder="Confirm New Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg shadow transition disabled:opacity-50"
          >
            {loading ? "Resetting…" : "Reset Password"}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-center text-sm text-red-600">{message}</p>
        )}
      </div>
    </div>
  );
}
