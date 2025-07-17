import { useState, useContext, useEffect } from "react";
import { Navigate } from "react-router-dom";

import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { loginUser, registerUser, forgotPassword } from "../api/authApi";
import { delay } from "../utils/delay";

export default function Auth({ defaultMode = "login" }) {
  const { login, token } = useContext(AuthContext);
  const navigate = useNavigate();

  const [mode, setMode] = useState(defaultMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [redirectToUser, setRedirectToUser] = useState(false);
  const [hasJustLoggedIn, setHasJustLoggedIn] = useState(false);

  const resetFields = () => {
    setUsername("");
    setPassword("");
    setConfirmPassword("");

    delay(5000).then(() => {
      setMessage("");
      setError("");
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    try {
      if (mode === "login") {
        const data = await loginUser(username, password);
        login(data.token);
        setHasJustLoggedIn(true);
        navigate("/");
      }

      if (mode === "register") {
        if (password !== confirmPassword) {
          setMessage("Passwords do not match");
          return;
        }
        await registerUser(username, password);
        setMessage("Registration successful. Please log in.");
        setMode("login");
        resetFields();
      }

      if (mode === "forgot") {
        const res = await forgotPassword(username);
        console.log(res);
        setMessage(
          res.message ||
            "If this email exists, password reset instructions have been sent."
        );
        resetFields();
      }
    } catch (err) {
      setError(
        err.response?.data?.error || "Something went wrong. Please try again."
      );
    }
  };

  useEffect(() => {
    if (token && !hasJustLoggedIn) {
      setRedirectToUser(true);
      delay(2000).then(() => {
        navigate("/user");
      });
    }
  }, [token, navigate, hasJustLoggedIn]);

  return (
    <div
      className="flex justify-center items-start"
      style={{ minHeight: "calc(100vh - 100px)" }}
    >
      <div className="w-full max-w-md bg-white shadow rounded-xl p-6 mt-20 sm:p-8">
        {redirectToUser ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-12">
            <svg
              className="animate-spin h-10 w-10 text-blue-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              ></path>
            </svg>
            <p className="text-gray-700 text-center">
              You’re already logged in.
              <br />
              Redirecting to your{" "}
              <span className="text-blue-600 font-medium">User page</span>…
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl sm:text-2xl font-bold text-center text-gray-800 mb-4 sm:mb-6">
              {mode === "login" && "Sign In"}
              {mode === "register" && "Create Account"}
              {mode === "forgot" && "Reset Password"}
            </h1>

            {/* Tabs */}
            <div className="flex justify-center space-x-2 mb-4 sm:mb-6">
              {["login", "register", "forgot"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                    mode === m
                      ? "bg-blue-600 text-white shadow"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {m === "login" && "Login"}
                  {m === "register" && "Register"}
                  {m === "forgot" && "Forgot"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode !== "forgot" && (
                <input
                  type="text"
                  placeholder="Email Address"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              )}

              {(mode === "login" || mode === "register") && (
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              )}

              {mode === "register" && (
                <input
                  type="password"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              )}

              {mode === "forgot" && (
                <input
                  type="email"
                  placeholder="Email Address"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              )}

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg shadow transition"
              >
                {mode === "login" && "Login"}
                {mode === "register" && "Register"}
                {mode === "forgot" && "Send Reset Link"}
              </button>
            </form>

            {message && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 mt-5 rounded">
                {message}
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 mt-5 rounded">
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
