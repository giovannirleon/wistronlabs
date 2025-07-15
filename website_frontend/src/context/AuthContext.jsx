import { createContext, useState, useEffect } from "react";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import useToast from "../hooks/useToast";
import { refreshAccessToken } from "../api/authApi";

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const { showToast, Toast } = useToast();

  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (token) {
      try {
        const decoded = jwtDecode(token);
        setUser({
          id: decoded.userId,
          username: decoded.username,
          exp: decoded.exp,
        });

        console.log(
          "✅ Token loaded. Current time:",
          new Date(Date.now()).toLocaleString()
        );
        console.log(
          "🕒 Token expiry:",
          new Date(decoded.exp * 1000).toLocaleString()
        );
      } catch (err) {
        console.error("Invalid token:", err);
        logout();
      }
    } else {
      setUser(null);
    }
  }, [token]);

  // Auto-refresh check
  useEffect(() => {
    const interval = setInterval(() => {
      if (token && user) {
        console.log("⏳ Current time:", new Date(Date.now()).toLocaleString());
        console.log(
          "🕒 Token expiry:",
          new Date(user.exp * 1000).toLocaleString()
        );

        if (Date.now() >= user.exp * 1000 - 5 * 60 * 1000) {
          // 5 minutes before expiry

          console.log("🔄 Token is close to expiry, refreshing…");
          refreshToken();
        }
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, [token, user]);

  // Initial token check
  useEffect(() => {
    if (!token) {
      refreshToken();
    }
  }, []);

  const login = (newToken) => {
    localStorage.setItem("token", newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    navigate("/auth");
  };

  const refreshToken = async () => {
    console.log("🔄 Attempting to refresh access token…");

    try {
      const res = await refreshAccessToken();
      const token = res.data.token;
      console.log("✅ New access token received:", token);

      login(token);
      console.log("Access token refreshed");
    } catch (err) {
      console.error("Could not refresh token", err);
      showToast(
        "Your session expired. Please log in again.",
        "error",
        5000,
        "bottom-right"
      );
      logout();
    }
  };

  return (
    <AuthContext.Provider value={{ token, login, logout, user, refreshToken }}>
      {children}
      <Toast />
    </AuthContext.Provider>
  );
}
