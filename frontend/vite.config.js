import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // This MUST match your GitHub repo name
  base: "/my-shark-tracker/",
});
