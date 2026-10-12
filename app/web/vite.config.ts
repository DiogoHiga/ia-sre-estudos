import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // O navegador só fala com o Vite; o Vite repassa /api para o Express (evita CORS).
    proxy: { "/api": "http://localhost:3001" },
  },
});
