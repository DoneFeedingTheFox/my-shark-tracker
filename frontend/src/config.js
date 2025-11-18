// frontend/src/config.js
const DEFAULT_API_URL = "https://shark-backend-yz6s.onrender.com";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_URL;
