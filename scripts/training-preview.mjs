// Isolated component fixture: no Supabase client, auth bypass, or production route.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": `${root}src` } },
  server: { host: "127.0.0.1", port: 8091, strictPort: true },
});
await server.listen();
console.log("Training fixture: http://127.0.0.1:8091/tests/training-ui/");
