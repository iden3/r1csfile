// r1csfile/vite.config.js
import { defineConfig } from "vite";
import { builtinModules } from "module";
import { readFileSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));

const external = [
    ...builtinModules,
    ...Object.keys(pkg.dependencies || {}),
];
const isExternal = (id) =>
    external.includes(id) || external.some((e) => id.startsWith(e + "/"));

export default defineConfig({
    build: {
        lib: {
            entry: "./src/r1csfile.js",
            formats: ["cjs"],
            fileName: () => "main.cjs",
        },
        minify: false,
        outDir: "build",
        emptyOutDir: false,
        rollupOptions: {
            external: isExternal,
        },
    },
    test: {
        projects: [
            {
                test: {
                    name: "node-esm",
                    include: ["test/**/*.js"],
                    environment: "node",
                    globals: true,
                    testTimeout: 120_000,
                },
            },
        ],
    },
});
