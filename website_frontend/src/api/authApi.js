import axios from "axios";

const API_BASE = "https://backend.tss.wistronlabs.com/api/v1/auth"; // or full URL if backend is separate

export const loginUser = async (username, password) => {
  const res = await axios.post(`${API_BASE}/login`, { username, password });
  return res.data;
};

export const registerUser = async (username, password) => {
  const res = await axios.post(`${API_BASE}/register`, { username, password });
  return res.data;
};

export const forgotPassword = async (email) => {
  const res = await axios.post(`${API_BASE}/forgot-password`, { email });
  return res.data;
};

export const changePassword = async (currentPassword, newPassword, token) => {
  const res = await axios.post(
    `${API_BASE}/change-password`,
    { currentPassword, newPassword },
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return res.data;
};

const authHeader = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
});

export const getCurrentUser = async (token) => {
  const res = await axios.get(`${API_BASE}/me`, authHeader(token));
  return res.data;
};
