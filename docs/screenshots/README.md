# README screenshots

These are actual browser captures of Frameforge, taken for the main [user guide](../../README.md) using a separate temporary demonstration library and a localhost-only editor on port 8799. The normal application port is 8787. No existing user projects, credentials, or private reference media were used.

The images show the interface at 1280 × 720. ComfyUI is intentionally offline; the generation queue is empty, and export shows the expected missing-main-video message. The mannequin image was rendered with Set Studio using the bundled model. No AI generation or cloud-credit job was submitted.

| Image | Section |
| --- | --- |
| `editor.png` | Initial editor layout and single-track timeline |
| `settings.png` | Local setup, dimensions, model discovery, and backup |
| `asset-details.png` | Image metadata and description controls |
| `continuity.png` | Segment timing and motion controls |
| `scene-writer-connection.png` | Language-model endpoint and output-token setting |
| `scene-writer.png` | Scene brief, references, and candidate workflow |
| `speech-studio.png` | Voice-prefix generation controls |
| `set-studio.png` | 3D viewport, mannequin, and object properties |
| `qwen-image-editor.png` | Render-based image editing and references |
| `cloud-setup.png` | Cloud credential setup without a saved key |
| `generation-queue.png` | Idle generation queue |
| `recovery.png` | Working-copy recovery choice |
| `projects.png` | Project management |
| `export.png` | Export formats and readiness diagnostic |

To refresh the screenshots after changing the interface:

1. Launch a separate instance with an unused port and a new temporary library: `python run.py --local-only --port 8799 --data /tmp/frameforge-docs-demo` (choose an appropriate temporary path on Windows).
2. Use generic demonstration content. Leave credential fields empty and do not connect to a production generation server.
3. Capture the relevant screen at a readable desktop size. Scroll the inspector or modal to the controls being documented; do not fabricate results or status indicators.
4. Replace the matching PNG, review it at full size, and update its caption in the main README if needed.
5. Stop the temporary editor when finished. Keep your normal library separate from the demonstration instance.
