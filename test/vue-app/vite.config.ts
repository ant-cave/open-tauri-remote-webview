import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    vue(),
    legacy({
      targets: ["defaults", "IE >= 11", "Chrome >= 49"],
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    fs: {
      allow: ["..", "../.."],
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/remote_ui_ws": {
        target: "ws://127.0.0.1:9090",
        ws: true,
      },
    },
  },
});
