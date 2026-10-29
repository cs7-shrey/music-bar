import { defineConfig } from "vite";

export default defineConfig({
    resolve: {
        conditions: ["node"],
    },
    build: {
        rollupOptions: {
            // Loads a native binary, so it's shipped as is (see forge.config.ts).
            external: ["koffi"],
            output: {
                entryFileNames: "main.js",
            },
        },
    },
});
