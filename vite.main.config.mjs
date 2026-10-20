import { defineConfig } from "vite";

export default defineConfig({
    resolve: {
        conditions: ["node"],
    },
    build: {
        rollupOptions: {
            output: {
                entryFileNames: "main.js",
            },
        },
    },
});
