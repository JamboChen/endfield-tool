import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "/endfield-tool/",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react")) return "react";
            if (id.includes("lodash")) return "lodash";
            if (id.includes("@xyflow/system")) return "xyflow";
            if (id.includes("graphlib") || id.includes("dagre")) return "graph";
            if (id.includes("d3-selection") || id.includes("d3-transition"))
              return "d3";
          }
        },
      },
    },
  },
});
