# Murmur

- Use the existing checkout. A cloud task is already isolated; do not create a worktree unless explicitly requested.
- Node 24; install with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci` (optional Node CUDA binaries are unnecessary for this browser app).
- `npm run dev` serves `/Otter/`; `npm run build` prepares the local WASM runtime and creates the installable production app.
- Validate changes with `npm test`, `npm run build`, and the relevant Playwright flows. `npm run test:e2e` uses the production build, not the dev server.
- Keep the application free, accountless and local to each device. No audio or text uploads, trackers, paid APIs, hidden external calls or fake AI results.
- Explicit consent is required before downloading the Whisper model. Keep its immutable revision pin unless deliberately updating and testing the model.
- Preserve user data, notes and corrections. Never reset IndexedDB to fix a schema issue. Add migrations for future versions.
- Document boundaries accurately: summaries are extractive quotes; retrieval is keyword search; speaker attribution is manual. Chromium phone emulation is not an iPhone/Safari hardware test.
- Changes to backup/restore must keep existing IDs unchanged and reject malformed input before any writes.
- Test model inference with `npm run test:model` when touching transcription/runtime integration. It requires the preview server and public model access.
- Avoid credentials in code, logs, saved configuration and commits.

- Preserve atomic expected-version checks for meeting writes and atomic folder changes. Broadcast notifications are an optimisation, not the conflict-safety mechanism.
- Password-protected backups use the versioned authenticated envelope in encryption.ts; never persist passwords, reduce its key derivation, or replace crypto with custom obfuscation. Keep ZIP v1 restoration compatible.
- ONNX assets are versioned by the installed runtime. Keep the large WASM file out of eager precaching; verify fresh-worker offline inference after changing these paths.
