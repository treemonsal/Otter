# Murmur

- Use the existing checkout. A cloud task is already isolated; do not create a worktree unless explicitly requested.
- Node 24; install with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci` (optional Node CUDA binaries are unnecessary for this browser app).
- `npm run dev` serves `/Otter/`; `npm run build` prepares the local WASM runtime and creates the installable production app.
- Validate changes with `npm test`, `npm run build`, and the relevant Playwright flows. `npm run test:e2e` uses the production build, not the dev server.
- Keep the application free and accountless. The user authorized optional online processing: send only selected audio/transcript after the visible online action to the documented Hugging Face demo or explicitly configured Murmur AI server. Optional browser Live-Text can use Apple/Google speech services after its visible start. No bulk/background uploads, trackers, paid APIs, embedded credentials, hidden external calls or fake AI results. Local processing remains available.
- Explicit consent is required before downloading the Whisper model. Keep its immutable revision pin unless deliberately updating and testing the model.
- Preserve user data, notes and corrections. Never reset IndexedDB to fix a schema issue. Add migrations for future versions.
- Document boundaries accurately: original quote cards and keyword retrieval remain local; generative insights and neural speaker grouping require the connected backend. Exact quotes validate provenance, not semantic entailment. Live browser text has approximate timings. No claim of perfect speaker attribution. Chromium phone emulation is not an iPhone/Safari hardware test.
- Changes to backup/restore must keep existing IDs unchanged and reject malformed input before any writes.
- Test model inference with `npm run test:model` when touching transcription/runtime integration. It requires the preview server and public model access.
- Test online integration with `npm run test:cloud` after changing the cloud protocol. Use only the public test fixture, never private recordings. The free demo has quotas and no availability guarantee; do not invent timestamps or speaker labels from its plain-text output.
- Avoid credentials in code, logs, saved configuration and commits.

- Preserve atomic expected-version checks for meeting writes and atomic folder changes. Broadcast notifications are an optimisation, not the conflict-safety mechanism.
- Password-protected backups use the versioned authenticated envelope in encryption.ts; never persist passwords, reduce its key derivation, or replace crypto with custom obfuscation. Keep ZIP v1 restoration compatible.
- ONNX assets are versioned by the installed runtime. Keep the large WASM file out of eager precaching; verify fresh-worker offline inference after changing these paths.

- IndexedDB v2 adds a jobs store without changing existing meeting IDs. Keep atomic job leases and Web Locks; persist only completed processing blocks and preserve manual edits. Job tokens and checkpoints are device-specific and excluded from backups.
- Python 3.12 backend: install backend/requirements-dev.lock in /workspace/murmur-ai-venv, run pytest backend/tests. Optional real checks require roughly 5.3 GB of open model downloads; use fixed revisions and hashes. No paid hosting, no credentials in public/service.json. Deployment script accepts MURMUR_HF_TOKEN only through secure environment settings and only creates a free CPU Space.
- Test the full local service with npm run test:ai and the documented preview/backend servers. Browser speech API tests simulate callbacks; never describe them as physical iPhone or actual Apple/Google speech-service tests.

- Zurich fine-tuning lives in training/, in a separate Python 3.12 CPU environment using training/requirements.lock. Read docs/ZURICH_TRAINING.md. There is no trained Zurich specialist or activation yet; original training data is missing. Run pytest backend/tests training/tests. Changes to the training runtime require the real training.smoke flow; its synthetic noise and changed weights prove only plumbing, never dialect quality. Never train on official test sets, mix people/recordings across splits, silently collect app recordings or replace the public app models with technical checkpoints. Report actual held-out WER/CER and quantized-model validation before any specialized model claim.
