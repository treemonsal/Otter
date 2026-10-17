"""Deploy only to free CPU hosting, then configure the public app's server address.

MURMUR_HF_TOKEN must be supplied through secure environment settings, never arguments.
This script prints public URLs/status only, never credentials or whoami payloads.
"""

import json
import os
import time
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi


def main():
    token = os.environ.get("MURMUR_HF_TOKEN")
    if not token:
        raise SystemExit(
            "MURMUR_HF_TOKEN fehlt. In den sicheren Umgebungseinstellungen einen Hugging-Face-Token mit Schreibrecht für den Space hinterlegen; nie im Chat."
        )
    api = HfApi(token=token)
    username = api.whoami()["name"]
    identity = f"{username}/murmur-ai"
    api.create_repo(
        repo_id=identity,
        repo_type="space",
        space_sdk="docker",
        space_hardware="cpu-basic",
        exist_ok=True,
    )
    # Never upgrade an existing paid Space or request billable hardware.
    runtime = api.get_space_runtime(identity)
    requested = str(runtime.requested_hardware or runtime.hardware or "cpu-basic")
    if requested not in ["cpu-basic", "SpaceHardware.CPU_BASIC"]:
        raise SystemExit(
            "Dieser Space verwendet keine kostenlose CPU-Basis. Bereitstellung gestoppt, ohne die Hardware zu verändern."
        )
    root = Path(__file__).resolve().parents[1]
    api.upload_folder(
        repo_id=identity,
        repo_type="space",
        folder_path=str(root / "backend"),
        ignore_patterns=[
            "tests/**",
            "__pycache__/**",
            "*.pyc",
            ".pytest_cache/**",
            "data/**",
            ".venv/**",
        ],
        commit_message="Deploy Murmur AI: resumable meetings, neural speakers and grounded insights",
    )
    host = f"https://{username.replace('_', '-')}-murmur-ai.hf.space"
    print("Free CPU Space:", f"https://huggingface.co/spaces/{identity}", flush=True)
    for _ in range(60):
        try:
            with urllib.request.urlopen(host + "/health", timeout=15) as response:
                health = json.load(response)
            if health.get("service") == "murmur-ai" and health.get("version") == 1:
                (root / "public" / "service.json").write_text(
                    json.dumps({"url": host}) + "\n"
                )
                print(
                    "Health verified. Public app configuration written:",
                    host,
                    flush=True,
                )
                return
        except Exception:
            pass
        print("Waiting for the free Space build …", flush=True)
        time.sleep(10)
    raise SystemExit(
        "Space hochgeladen, aber Gesundheitsprüfung noch nicht erfolgreich. App-Adresse wurde nicht verändert. Build im öffentlichen Space prüfen und den Befehl erneut ausführen."
    )


if __name__ == "__main__":
    main()
