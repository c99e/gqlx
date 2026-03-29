Default to using Bun instead of Node.js for development and testing.

- Use `bun test` to run tests
- Use `bun install` for dependencies

Note: The extension itself runs inside pi's Node.js runtime (via jiti).
Do NOT use Bun-specific APIs (Bun.file, Bun.serve, bun:sqlite) in src/ files.
Use standard Node.js / Web APIs (fetch, node:fs, node:path) instead.
