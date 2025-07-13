import axios from "axios";

export async function loginUser(username, password) {
  const res = await axios.post("/api/v1/auth/login", {
    username,
    password,
  });
  return res.data; // assuming { token: '...' }
}

export async function registerUser(username, password) {
  const res = await axios.post("/api/v1/auth/register", {
    username,
    password,
  });
  return res.data;
}

export async function forgotPassword(email) {
  const res = await axios.post("/api/v1/auth/forgot-password", {
    email,
  });
  return res.data;
}
