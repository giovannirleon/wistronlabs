import { useState, useContext } from "react";
import axios from "axios";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Auth({ defaultMode = "login" }) {
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const [mode, setMode] = useState(defaultMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const resetFields = () => {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setEmail("");
    setMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    try {
      if (mode === "login") {
        const res = await axios.post("/api/v1/auth/login", {
          username,
          password,
        });
        login(res.data.token);
        navigate("/");
      }

      if (mode === "register") {
        if (password !== confirmPassword) {
          setMessage("Passwords do not match");
          return;
        }
        await axios.post("/api/v1/auth/register", { username, password });
        setMessage("Registration successful. Please log in.");
        setMode("login");
        resetFields();
      }

      if (mode === "forgot") {
        await axios.post("/api/v1/auth/forgot-password", { email });
        setMessage(
          "If this email exists, password reset instructions have been sent."
        );
        resetFields();
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white shadow-md rounded-xl p-8">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">
          {mode === "login" && "Sign In"}
          {mode === "register" && "Create Account"}
          {mode === "forgot" && "Reset Password"}
        </h1>

        {/* Tabs */}
        <div className="flex justify-center space-x-2 mb-6">
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
              placeholder="Username"
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
          <p className="mt-4 text-center text-sm text-red-600">{message}</p>
        )}
      </div>
    </div>
  );
}
