import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Development server configuration
  server: {
    host: "0.0.0.0",  // Bind to all interfaces for Docker
    port: 3000,       // Explicit port 3000
    strictPort: true, // Fail if port is already in use
  },
  // Production preview server configuration (used in Docker)
  preview: {
    host: "0.0.0.0",  // Bind to all interfaces for Docker
    port: 3000,       // Explicit port 3000
    strictPort: true, // Fail if port is already in use
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
