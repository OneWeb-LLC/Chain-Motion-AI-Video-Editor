# Validation record

Validated on September 10, 2026. This record describes observed results, not a guarantee of generation quality on every model, GPU, or prompt.

## Automated and local integration checks

- **14 automated tests passed** in the project's installed `.venv`.
- Python compilation and JavaScript syntax validation passed.
- Imported a 4-second video, audio fixture, and image through the actual HTTP API.
- Saved a 1.5-second trimmed audio copy and a captured video frame as assets.
- Verified byte-range video serving (206 response with the requested bytes).
- Downloaded a complete library backup and restored it into a separate temporary folder: **4 projects, 13 assets, and 3 local latents** were intact.
- Verified stale project versions reject conflicting saves and cross-origin writes are rejected.
- Exported an edited clip with a source in point as a finished MP4 and an individual-clip ZIP.
- Verified missing or short main videos fail explicitly rather than disappearing from exports.
- Added a regression test proving multi-clip export does not accumulate per-clip AAC priming gaps. Sequence intermediates use PCM audio, with AAC encoded once for the final movie.
- Browser checks covered project selection, prompts, numerical durations, segment creation, overlap selection, main-take assignment, autosave, speech reference selection, and the displayed prefix/output duration calculation.

## Live ComfyUI checks

Server: `http://192.168.88.253:8188`, ComfyUI 0.34.5. The primary device reported an NVIDIA RTX 3090. Each live graph was checked against the installation's actual `/object_info`.

| Check | Observed result |
| --- | --- |
| First H3 segment | Requested 3.5 seconds at 608 × 352, 20 sampling steps. Completed in approximately 433 seconds including model loading. Returned a 90-frame / 3.75-second video with audio. |
| Durable monitoring | Restarted the editor while that job was active. It recovered the existing prompt and downloaded its outputs without submitting a duplicate. |
| H3 continuation | Requested 3 seconds with 22 context frames and an image captured from the first take. Completed in approximately 117 seconds. Returned an 85-frame / 3.54-second delivered clip. The graph loaded the first take's exact saved latent. |
| Latent retention | Both H3 AV latents were saved on ComfyUI and downloaded into the local library. Each take has a distinct directory/path. |
| Imported-video encoding | Encoded the 4-second imported video into an H3-compatible AV latent, then downloaded it. Completed in approximately 18 seconds. |
| 32-pixel baseline | The supplied locked-audio graph ran successfully as a 32 × 32 single-stage video. This earlier baseline did not test voice-prefix extension. |
| Revised voice-prefix workflow | Used a 1.5-second excerpt of `overestimated.wav`, named in the supplied workflow, with a 4-second generation. Completed in approximately 159 seconds. Returned a **2.5-second FLAC** and a **2.5-second 32 × 32 MP4**, with the reference prefix removed from both. No identity LoRA was used. |
| Cancellation | A newly queued local test job was cancelled and never submitted to ComfyUI. Automated tests also verify that cancellation does not interrupt a different active prompt. |
| Generated sequence exports | Exported the two generated H3 shots as a **7.29-second 608 × 352 MP4 with audio** and as individually numbered clips with a JSON manifest. Both jobs completed. |

Relevant retained job IDs:

- First H3 shot: `f40f90d559d847b0b541a1234bc0656d`
- H3 continuation: `8eed5caab2ad400f91ba4d10674b63e8`
- Imported-video latent: `a472737ce6784f9b8998b45de546126a`
- Revised voice-prefix speech: `e57e9b95d5d448e5a03e0a0012bbea17`
- Final sequence export: `779378e533d04f9382de296138ee602d`
- Final individual clips: `60ea77bd116b42c1898e7c6e0b5de7aa`

Graphs, job records, media, and latents are retained in `data/`. Test references and results are grouped in the **Validation** asset folder. A fresh **Untitled film** project is available alongside the clearly named validation projects.

## Scope and remaining practical limits

- The live speech test proves the longer latent, generated tail, automatic prefix trimming, sound-file output, and 32-pixel driving-video path. Exact word delivery and voice identity were not independently scored; listen to generated dialogue before use.
- The maximum 9/3/3 reference counts and all overlap frame calculations were tested in graph/model validation. The live continuation used one image and 22-frame context; large reference batches and 39/56-frame live generations were not run to avoid unnecessary GPU load.
- Windows and macOS launch scripts/library portability are implemented but were not exercised on those operating systems. Live validation ran on Linux.
- H3 duration grid rounding is exposed in the UI. Direct latent continuation rejects a main video whose timeline duration was trimmed away from that latent's end.
- Moving to a different ComfyUI server requires restoring its output-side latent files or re-encoding local media; a portable library does not install ComfyUI models or custom nodes.
- The editor implements the requested generative scene/segment workflow. Conventional layered compositing, titles, effects, keyframes, transitions, and independent audio mixing are outside this implementation.

## Imported timeline segments and workspace ergonomics

- 18 unit tests pass, including trimmed segment context invalidation, source bounds, mixed encode/generate queues, and rejection of stale queued encodings.
- Live ComfyUI test: imported a timeline source with a 0.5-second in point and 3-second duration; encoding completed and matching latents were downloaded and attached to the segment.
- Browser verified click-and-drag library resize (216 to 252 px), double-click reset (200 px), keyboard adjustment, persistence on reload, narrow-layout properties height divider, and favicon link. No browser console errors.
- File dropping uses the same per-file upload function as the file picker, with drop highlighting and prevention of accidental browser navigation. Native operating-system file dragging was not automated.

Timeline drop update: verified video asset drag creates a timeline segment in the browser; verified full-height library and timeline have aligned bottom edges. Focused JavaScript checks passed for shared-reference capacities, duplicate exclusion, video-only empty timeline drops, and file-to-segment reference routing. Native OS file drops were not automated.

Automatic continuation encoding and latest-take selection: 21 tests passed, covering stale encoding replacement, matching active-job reuse, valid latent reuse, and replacing the main take while preserving take history and resetting source trim. No generation graph changes or new GPU sampling tests were needed.

LAN hosting: 26 unit tests pass. A temporary isolated server bound to all IPv4 interfaces served the editor via 192.168.1.10:8788; same-origin project creation succeeded and cross-origin writes returned 403. The test server was stopped. Verified ID generation without secure-context randomUUID. Access from a separate physical device depends on local firewall/network routing and was not tested.

Cancellation and workspace updates: 29 tests pass, including empty-success ComfyUI cancellation responses, malformed-response diagnostics, portable project export/import with media and ID remapping, and project deletion preserving assets. Browser verified 0.5 MP calculation (928 × 544, 0.505 actual MP at the current aspect ratio), saved-project controls, and no console errors. No GPU generations submitted for these UI changes.

Disconnected cancellation: 32 tests pass. Regression checks cover cancellation while offline, disconnect during history polling, progression to the next queued job, and interrupting only an owned active prompt. Local cancellation is terminal even when remote confirmation fails; monitoring HTTP requests use bounded five-second timeouts and cancellation calls use three-second timeouts.

Scene Writer: 40 tests pass. Added tests for numbered parsing, optional dialogue/sound, invalid numbering/truncation, endpoint normalization, credential redaction and endpoint-change clearing, multimodal request construction, candidate-only behavior, atomic/idempotent approval, scene preservation, and version conflicts. An isolated HTTP mock endpoint verified the complete generate/parse/approve flow with two populated segments and no premature project writes or GPU jobs. Browser checked the connection/image/review controls, a valid script enabling approval, and subsequent edits disabling approval. A real provider/model has not yet been configured or tested. No changes were pushed to GitHub.

Model discovery: 43 tests pass, including normalized model-list URLs, deduplication, saved-key reuse only for matching endpoints, empty lists, and authentication/unsupported-route errors. Browser verified the discovery control and initially hidden model selector. Provider responses were tested with mocks.

SceneCreator TIME recovery: supplied TestOutput successfully parses as five shots through the running API. A missing scene-header TIME can be recovered only from identical explicit TIME values in every shot setting; a review notice explains the recovery. Conflicting/missing shot times still fail. Fixed empty-field validation crossing newline boundaries. 47 tests pass.

Scene Writer per-segment references: 49 tests pass. New approvals copy reference lists independently to each segment. Existing writer scenes migrate once, keeping original shared-first ordering and deduplicating. Tests verify removing from one list does not affect other segments and ordinary scene sharing remains unchanged.

Export duration mismatch: regression checks export an earlier, shorter take in both film and individual-clip modes, respecting its in point and preserving project duration. Longer footage still trims to the timeline request; in points beyond the source remain invalid.

Scene Writer output limits: 54 tests pass. Request tests verify omitted default limits, explicit custom limits, persisted configuration, longer timeouts, and complete versus truncated candidates with a length finish reason. No live long-running LM Studio generation was submitted. Changes remain local.

Continuity prompt experiment: newly parsed and approved Scene Writer segments exclude continuity blocks from their video prompts. Original scripts, per-shot continuity metadata, validation, and scene carryover retain those blocks. Existing segment prompts are unchanged. Parser and approval regression checks cover this separation.

Comfy Cloud toggle: 60 tests pass, including authenticated requests, private credential storage, credential-free signed downloads, cloud encoding dependencies, terminal status polling, targeted cancellation, and missing-node rejection before reference upload. Local routing remains covered by existing tests. No live cloud account or paid inference tested.

Native H3 cloud comparison: 62 tests pass. First-shot and 22/39/56-frame continuation graphs validate against the cloud node inventory retrieved from the configured account. Regression tests cover native-only graphs, video-source queue dependencies, source in-point tail extraction, and absence of custom latent requirements. No paid inference submitted; visual continuity remains to be compared.

Per-segment image reference size: 63 tests pass. Match/Max is stored with each segment and forwarded to both local and native cloud H3 graphs. Older segments default to Match; invalid values are rejected. No GPU generation required.

Image descriptions: 66 tests pass. Image asset details provide a Describe image action using the Scene Writer connection and a dedicated visual-description prompt. Tests cover image payloads, saved and edited descriptions, configuration/type errors, and preserving prior descriptions on failure. No live LLM inference tested.

Segment audio trimming: 68 tests pass. Per-reference in/out selections are stored on the segment, snapshotted for local/cloud jobs, and applied to temporary upload copies. Shared references stay unchanged on other segments. Tests cover invalid bounds, queue isolation, original preservation, and temporary-file cleanup. Project imports remap trim asset IDs.

Waveform trim handles: added draggable IN/OUT handles with highlighted selection, dimmed excluded regions, synchronized number fields, pointer capture, and keyboard adjustment. Browser checked 0.01-second keyboard updates, non-crossing endpoint limits, and reset without applying changes to the user’s segment. JavaScript syntax check passed.

Waveform bar visibility and selection playback: browser verified full-height IN/OUT bars at both waveform ends, dragged boundaries to 0.10–0.35 seconds, and confirmed native audio Play stops paused at 0.35 seconds. Closing without Apply preserves the segment. Both playback controls restart at IN; seeking is bounded to the selection. Static asset versions updated to refresh cached controls.

High quality model override: 69 tests pass. Queue and graph tests cover local/cloud inference with the toggle on, off, or omitted, the exact BF16 model path, unchanged auxiliary models and saved settings, queue snapshot isolation, and invalid flag rejection. JavaScript syntax check passed. No GPU or paid cloud inference submitted.

Turbo LoRA: 69 tests pass. Local/cloud first-shot and continuation graphs load the requested file with LoraLoaderModelOnly at strength 1.0, keep the configured base model, route the adapted model to both guider and scheduler, and use 4 steps. Disabled/omitted Turbo keeps normal steps without the LoRA. Queue snapshots preserve saved segment settings. No GPU or paid inference submitted.

Hosting options toggle: 75 tests pass, including saved mode, explicit launcher overrides, listener rollback on binding/persistence errors, and input validation. An isolated live server switched local → LAN → local without restarting its process; verified LAN access when enabled, denial on existing LAN keep-alive connections and refusal of new LAN connections when disabled, continued local access, and persisted mode. Separate physical-device/firewall access was not tested.

Segment Properties: native collapsible sections cover continuation, prompt, timing, motion continuity, references, generation settings, and takes. Browser verified collapsing References and switching between full and structured prompt views without altering the original text. Node checks cover lossless parsing of freeform/bracket/colon/duplicate sections, grouped dialogue subfields, and edits preserving adjacent sections, including repeated edits of empty fields. No user prompts or projects changed during browser verification.

## Set Studio — 2026-09-23

- 80 automated tests passed, including new coverage for the supplied workflow’s widget/link mapping, PLY download metadata, invalid PLY cleanup, saved poses and attachments, concurrent-save protection, and job completion/cancellation during PLY download.
- Validated the generated API graph against the connected local ComfyUI node schema. Required WorldMirror V2, SavePLY, and BackgroundPreview nodes were present. No reconstruction inference job was submitted during this validation; actual model execution and a full-size WorldMirror output remain untested.
- In an isolated test library, loaded a synthetic binary Gaussian PLY with Spark, posed a mannequin, attached a box to its hand, saved/reopened the set, positioned a camera, and rendered 1280×720 PNGs back into image assets. Inspected the output to confirm the splat, mannequin, and prop appear together without editing guides. Browser reported no errors or warnings.
- Checked JavaScript syntax and exercised the final render path that awaits Gaussian sorting before PNG capture. Test assets and sets were kept outside the user's library.

### Generated splats not appearing — follow-up

The completed PLY files were valid, but the generation UI only registered them in the splat library and left the open set empty. Completed jobs now provide a Show in viewport action; newly queued reconstructions are inserted into their originating set automatically while Set Studio stays open. Loading awaits PLY initialization before framing, and repeated Show actions focus the existing object. Verified the user's generated tavern splat visibly renders in the viewport, with no browser errors. No additional inference jobs were submitted.

### Direct limb selection — 2026-09-24

Added mesh ray picking for mannequin body parts and primitives, drag-vs-click filtering, limb highlight, and rotation control selection. Automated checks cover nearest surface selection, transformed joints, foreground props, orbit drags, right clicks, and gizmo drags. In the browser, clicked the mannequin's right forearm, verified rightElbow was selected, and bent it 70 degrees: hand followed and upper arm stayed fixed. Browser reported no errors. External model research identified Quaternius Universal Animation Library Standard (CC0); no external rig was imported.

### Quaternius integration — 2026-09-24

Bundled the CC0 Standard-edition UAL1_Standard.glb mannequin and its license. New mannequin records use rig=quaternius-v1; old records retain the legacy model. Automated tests load the actual bundled GLB, verify all seventeen mapped joints, independent skeletons/materials, moved hand attachments, saved/restored poses, and ray picking against the skinned surface. Browser verified T pose, direct forearm selection, elbow deformation, and hand-parented box placement with no console errors. No Comfy inference required.

Run rig regression: `node --experimental-loader ./tests/three-loader.mjs --test tests/test_rigged_mannequin.mjs`.

### IK posing

Added two-bone arm/leg IK with world-space target handles, stable bend direction during a drag, reach clamping, and existing pose/undo persistence. Automated checks on the bundled rig verify hand/foot target accuracy under translated, rotated and nonuniformly scaled model roots, unchanged bone positions, and finite results for unreachable targets. Browser verified dragging a hand's X handle bends the elbow while the body remains fixed, with no console errors.

### Qwen image editor and whole-model selection

- Double-clicked the skinned mannequin surface: selected its root and activated move controls; single-click limb picking remains available.
- 84 Python tests passed, including image-reference count/order, one-image and ten-image graph construction, supplied sampler defaults, queue input validation, immutable queued inputs, V3 reference validation, and PNG collection into assets. JavaScript syntax checks passed.
- Compared the graph with the connected local ComfyUI schema and confirmed required nodes and model names are available.
- Ran two live 320×320, 25-step edits through the isolated Set Studio UI: first with only the captured frame, then with that frame plus an additional reference as image 2. Both completed successfully in approximately 14 seconds each. Verified returned images appeared automatically in the viewport and Back to 3D scene restored the editor. No browser errors.
- Maximum reference count is covered by automated graph/queue tests; the live run used two images. Test assets/jobs remained in `/tmp/frameforge-qwen-validation`, outside the user's library.

### Hand pose sliders — 2026-09-25

Added independent left/right whole-hand grasp and five finger curl sliders, interpolating the bundled rig's authored open and fist poses across all three joints per finger. Tests verify independent fingers, opposite hands and mannequin instances; unchanged wrist orientation; finger movement; and exact restoration from saved hand values. Browser verified closing a hand then opening its index finger alone, with visible deformation and no console errors. No Comfy jobs or user-library test assets were created.

Prompt improver: 88 Python tests pass, including exact supplied system prompt, camera/reference ordering, invalid/truncated responses and the multipart endpoint without asset-library writes. The frontend test covers replacement, undo, request failure and changes to the prompt or set during a request. Set Studio's Improve prompt button was verified in the browser. LLM replies were mocked; no live inference was required.

GLB import: all 91 Python tests pass, covering real GLB upload, stored model retrieval, set save/reopen with model transforms, missing model rejection, invalid upload cleanup, external-resource rejection and unsupported compression. In an isolated browser editor, imported the bundled Quaternius GLB, added it to the set, saved the set, and rendered a PNG. Visually verified the model and original yellow/purple materials in the render. No user library assets or inference jobs were created by validation.

GLB lighting: added a neutral omnidirectional environment alongside existing lights so metallic PBR materials receive reflected fill. Validated in the isolated editor with a fully metallic GLB and inspected the camera PNG: surfaces away from the key light remain illuminated. Material maps and authored metalness/roughness are preserved; the environment also applies with textures disabled.

Full-reference Scene Writer guide: 96 backend tests pass, including new six-section validation, consecutive segment numbering, internal shot cuts, exact dialogue preservation, mocked LLM requests with target duration, and approval into isolated timeline segments. Node tests verify six-field round trips and isolated edits, plus legacy parsing. Browser verified all six new fields and retained legacy text in Segment Properties. No real LLM or GPU generation submitted; prompt quality remains to be assessed with the connected model. Restarted idle editor to load parser.

Full-reference validation compatibility: 99 backend tests pass. Normalizes CRLF input, accepts indented/case-varied SEGMENT headers and indented field headings, distinguishes internal shot counts from timeline segment counts with an explicit preview warning, and reports actual counts on unexplained mismatches. Missing/duplicate segment and internal-shot numbering still fails. The reported user candidate was not visible in the selected project; exact-candidate verification remains pending.

Exact supplied full-reference candidate: detected preliminary duplicate audio sections before summary and complete audio sections after detailed_description. Parser now uses the final audio sections with explicit preview warnings while preserving the original script. Other ambiguous duplicates remain rejected. All 101 tests pass; the exact supplied candidate returns HTTP 200 from the running parse endpoint with one timeline segment, six internal shots, and three warnings. No timeline approval or inference submitted.

## Single-track timeline and motion links
- All scenes' segments render sequentially on one timeline track, with scene labels and reference thumbnails.
- Motion continuity can link any source segment, including across scenes and later timeline positions. Queue order follows dependencies without changing playback/export order.
- Tests cover local/cloud dependency ordering, trimmed-import encoding, cyclic/missing links, previous-segment links across scenes, and project archive ID remapping.
- Python suite: 106 tests passed. JavaScript syntax check passed. Live browser: 54 clips on exactly one track, all at the same vertical position, and 54 source selector choices. No inference jobs submitted.

## Manual saves and crash recovery
- Manual Save/Save As commit separate saved-project snapshots; working edits and job/Scene Writer updates remain recovery state until committed.
- Existing libraries migrate their current projects into initial saved snapshots once. Recovery choices are offered on reopen and project selection; Manage also allows reverting.
- 115 Python tests pass, including restart persistence, save isolation, version conflict handling, independent Save As copies, and active-job protection when reverting. JavaScript syntax checked. Live UI Save and Save As dialog verified without modifying user projects.
