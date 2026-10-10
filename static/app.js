import {changeTimelineRange} from '/static/timeline-range.js';
import {orderedReferences,moveImageReference} from '/static/reference-order.js';
import { HELP, LEGACY_HELP, parsePrompt, joinPrompt, editPromptPart } from "/static/prompt-fields.js?v=4";
import { showSceneWriter } from "/static/scene-writer.js?v=sections-only-1";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// getRandomValues also works over plain HTTP on a LAN.
const id = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const clone = (x) => structuredClone(x);
const fmt = (n) => (Number(n) || 0).toFixed(2) + " s";
const url = (aid, thumb = false) =>
  `/api/assets/${aid}/file${thumb ? "?thumbnail=true" : ""}`;
const activeStatuses = [
  "queued",
  "preparing",
  "submitting",
  "running",
  "recovering",
  "cancelling",
];
let state,
  project,
  savedProject,
  sceneId,
  segmentId,
  selected = new Set(),
  filter = "all",
  search = "",
  folder = "",
  zoom = 55,
  dirty = false,
  saving = false,
  saveTimer,
  undo = [],
  redo = [],
  modalType = "",
  connectionState = null,
  playingSequence = false,
  refreshing = false;
let speechDraft = {};
async function api(path, body, method = "POST") {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!r.ok) {
    let e = await r.json().catch(() => ({ detail: r.statusText }));
    const err = Error(
      typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail),
    );
    err.status = r.status;
    throw err;
  }
  return r.json();
}
function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = message;
  $("#toasts").append(el);
  while ($("#toasts").children.length > 3)
    $("#toasts").firstElementChild.remove();
  setTimeout(() => el.remove(), error ? 6500 : 2500);
}
function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };
}
function scene() {
  return project.scenes.find((s) => s.id === sceneId) || project.scenes[0];
}
function segment() {
  return (
    scene()?.segments.find((s) => s.id === segmentId) || scene()?.segments[0]
  );
}
function allSegments() {
  return project.scenes.flatMap((s) => s.segments);
}
function checkpoint() {
  undo.push(clone(project));
  if (undo.length > 60) undo.shift();
  redo = [];
}
function projectContent(p) {
  if (!p) return "";
  const copy = clone(p);
  delete copy.version;
  return JSON.stringify(copy);
}
function hasUnfinalizedChanges() {
  return projectContent(project) !== projectContent(state?.saved_projects?.[project?.id]);
}
function updateSaveState() {
  if (!project) return;
  $("#save-state").textContent = hasUnfinalizedChanges()
    ? (dirty ? "Unsaved changes · recovery pending" : "Unsaved changes · recovery protected") : "Saved";
  $("#save-state").className = hasUnfinalizedChanges() ? "pending" : "";
  $("#save-project").textContent = hasUnfinalizedChanges() ? "Save *" : "Save";
  $("#save-project").title = $("#save-state").textContent + " · Ctrl+S";
}
async function manualSave(name) {
  await syncRecovery();
  const sourceId = project.id;
  const snapshot = clone(project);
  const result = await api(`/api/projects/${sourceId}/commit`, {
    version: snapshot.version, ...(name === undefined ? {} : {name}),
  });
  state.saved_projects ||= {};
  state.saved_projects[result.id] = clone(result);
  if (name !== undefined) {
    // New edits made during the request remain unsaved in the new copy.
    project.id = result.id;
    project.name = result.name;
    project.version = result.version;
    savedProject = clone(result);
    state.projects[result.id] = clone(result);
    undo = []; redo = [];
    localStorage.setItem("frameforge-project", result.id);
    if (dirty) changed(false);
  }
  updateSaveState();
  renderHeader();
  toast(name === undefined ? "Project saved." : "Project saved as “" + result.name + "”.");
}
function showSaveAs() {
  modal("Save project as", `<label class="field"><span>Project name</span><input id="save-as-name" value="${esc(project.name + " copy")}"></label><p class="hint">Creates a separate saved project using the current edits. Media files are shared with the library.</p>`, '<button id="save-as-confirm" class="primary">Save As</button>');
  $("#save-as-confirm").onclick = guard(async () => {
    const name = $("#save-as-name").value.trim();
    if (!name) throw Error("Enter a project name.");
    const button = $("#save-as-confirm"); button.disabled = true;
    try { await manualSave(name); $("#modal").close(); }
    finally { button.disabled = false; }
  });
}
function offerRecovery() {
  if (!hasUnfinalizedChanges()) return;
  modal("Recover unfinished work", `<p>There are unfinished changes for <b>${esc(project.name)}</b>. Your last manually saved version is unchanged.</p><p>Recover the unfinished work to keep editing, or return to the last saved version.</p>`, '<button id="recover-work" class="primary">Recover work</button><button id="discard-work" class="small">Use last saved version</button>');
  $("#recover-work").onclick = guard(async () => { await syncRecovery(); $("#modal").close(); updateSaveState(); });
  $("#discard-work").onclick = guard(async () => {
    clearTimeout(saveTimer);
    while (saving) await new Promise(resolve => setTimeout(resolve, 100));
    const latest = (await api("/api/state")).projects[project.id];
    const result = await api(`/api/projects/${project.id}/discard-recovery`, {version:latest.version});
    project = clone(result); savedProject = clone(result); state.projects[result.id] = clone(result);
    dirty = false; undo = []; redo = [];
    localStorage.removeItem("frameforge-unsaved");
    sceneId = project.scenes[0]?.id; segmentId = scene()?.segments[0]?.id;
    selected = new Set(segmentId ? [segmentId] : []);
    $("#modal").close(); renderAll(); updateSaveState();
  });
}
function changed(render = true) {
  dirty = true;
  try { localStorage.setItem("frameforge-unsaved", JSON.stringify(project)); } catch {}
  $("#save-state").textContent = "Unsaved changes · protecting recovery…";
  $("#save-state").className = "pending";
  updateSaveState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => guard(syncRecovery)(), 500);
  if (render) renderAll();
}
async function syncRecovery() {
  clearTimeout(saveTimer);
  if (saving) {
    await new Promise((r) => setTimeout(r, 100));
    return syncRecovery();
  }
  if (!dirty) return;
  saving = true;
  const snapshot = clone(project);
  try {
    let result;
    try {
      result = await api("/api/projects/" + project.id, snapshot, "PUT");
    } catch (e) {
      if (e.status !== 409) throw e;
      const latest = (await api("/api/state")).projects[project.id];
      const clean = (p) => {
        const c = clone(p);
        delete c.version;
        c.scenes.forEach((sc) =>
          sc.segments.forEach((s) => {
            delete s.encoded_latent;
            delete s.takes;
            delete s.main;
            delete s.duration;
            delete s.trim_in;
          }),
        );
        return JSON.stringify(c);
      };
      if (!savedProject || clean(savedProject) !== clean(latest)) throw e;
      for (const sc of snapshot.scenes) {
        for (const s of sc.segments) {
          const remote = latest.scenes
            .flatMap((x) => x.segments)
            .find((x) => x.id === s.id);
          const base = savedProject.scenes
            .flatMap((x) => x.segments)
            .find((x) => x.id === s.id);
          if (!remote || !base) continue;
          s.encoded_latent = remote.encoded_latent;
          s.takes = [...new Set([...s.takes, ...remote.takes])];
          if (s.main === base.main) s.main = remote.main;
          if (s.duration === base.duration) s.duration = remote.duration;
          if (s.trim_in === base.trim_in) s.trim_in = remote.trim_in;
          const live = allSegments().find((x) => x.id === s.id);
          if (live) {
            live.encoded_latent = s.encoded_latent;
            live.takes = s.takes;
            if (live.main === base.main) live.main = remote.main;
            if (live.trim_in === base.trim_in) live.trim_in = remote.trim_in;
            if (live.duration === base.duration)
              live.duration = remote.duration;
          }
        }
      }
      snapshot.version = latest.version;
      result = await api("/api/projects/" + project.id, snapshot, "PUT");
    }
    project.version = result.version;
    savedProject = clone(result);
    state.projects[project.id] = clone(project);
    if (
      JSON.stringify({ ...snapshot, version: result.version }) ===
      JSON.stringify(project)
    ) {
      dirty = false;
      localStorage.removeItem("frameforge-unsaved");
      updateSaveState();

    } else {
      saveTimer = setTimeout(() => guard(syncRecovery)(), 100);
    }
  } finally {
    saving = false;
  }
}
function edit(fn, render = true) {
  checkpoint();
  fn();
  changed(render);
}
function randomSeed() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (words[0] & 0x1fffff) * 4294967296 + words[1];
}
function newSegment() {
  return {
    id: id(),
    name: `Segment ${String((scene()?.segments.length || 0) + 1).padStart(2, "0")}`,
    prompt: "",
    duration: 3.5,
    overlap: 22,
    connected: !!scene()?.segments.length,
    refs: [],
    main: null,
    takes: [],
    trim_in: 0,
    seed: randomSeed(),
    randomize_seed: true,
    steps: 20,
    ref_image_size: "match",
    width: project.width,
    height: project.height,
    continuation: null,
  };
}
function selectSegment(sid, gid, shift = false) {
  sceneId = sid;
  segmentId = gid;
  if (!shift) selected = new Set([gid]);
  else if (selected.has(gid)) selected.delete(gid);
  else selected.add(gid);
  renderAll();
}
function renderAll() {
  if (!scene()) {
    sceneId = null;
    segmentId = null;
  } else {
    sceneId = scene().id;
    segmentId = segment()?.id;
  }
  renderHeader();
  renderAssets();
  renderProperties();
  renderTimeline();
  renderPreview();
}
function renderHeader() {
  updateSaveState();
  $("#jobs-count").classList.toggle(
    "queue-active",
    state.jobs.some((j) => activeStatuses.includes(j.status)),
  );
  $("#project-select").innerHTML = Object.values(state.projects)
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === project.id ? "selected" : ""}>${esc(p.id === project.id ? project.name : p.name)}</option>`,
    )
    .join("");
  $("#project-summary").textContent =
    `${project.width} × ${project.height} · 24 FPS · LOCAL WORKSPACE`;
  $("#jobs-count").textContent = state.jobs.filter((j) =>
    activeStatuses.includes(j.status),
  ).length;
  $("#queue-status").textContent = state.jobs.some((j) =>
    activeStatuses.includes(j.status),
  )
    ? `${state.jobs.filter((j) => activeStatuses.includes(j.status)).length} jobs in progress / queued`
    : "Ready to create";
}
function wave(a, big = false) {
  const samples = a.waveform || Array(36).fill(0);
  const count = big ? 180 : 36;
  const stride = Math.max(1, Math.ceil(samples.length / count));
  const bars = [];
  for (let i = 0; i < samples.length; i += stride) {
    bars.push(Math.max(...samples.slice(i, i + stride)));
  }
  const peak = Math.max(0.001, ...bars);
  return `<div class="waveform ${big ? "big" : ""}">${bars.map((v) => `<i style="height:${Math.max(3, (v / peak) * 85)}%"></i>`).join("")}</div>`;
}
function assetCard(a, picker = false) {
  return `<div class="asset ${a.kind === "audio" ? "audio-card" : ""}" draggable="true" data-asset="${a.id}"><div class="asset-thumb">${a.kind === "audio" ? wave(a) : `<img draggable="false" loading="lazy" src="${url(a.id, true)}" alt="${esc(a.name)}">`}<span class="asset-kind">${a.kind === "image" ? "IMG" : fmt(a.duration)}</span>${picker ? "" : `<button class="asset-add" title="Add reference to selected segment" data-add="${a.id}">＋</button>`}</div><div class="asset-name">${esc(a.name)}</div><div class="asset-meta">${esc(a.folder || a.source)}${a.latent ? " · ◇ latent" : ""}</div></div>`;
}
function renderAssets() {
  const assets = Object.values(state.assets).sort(
    (a, b) => b.created - a.created,
  );
  $("#asset-count").textContent = assets.length;
  const folders = [
    ...new Set(assets.map((a) => a.folder).filter(Boolean)),
  ].sort();
  $("#folder-filter").innerHTML =
    '<option value="">All folders</option>' +
    folders
      .map(
        (f) =>
          `<option ${f === folder ? "selected" : ""} value="${esc(f)}">${esc(f)}</option>`,
      )
      .join("");
  const list = assets.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      (!folder || a.folder === folder) &&
      (!search ||
        [a.name, a.folder, ...a.tags].join(" ").toLowerCase().includes(search)),
  );
  $("#asset-list").innerHTML = list.length
    ? list.map((a) => assetCard(a)).join("")
    : `<div class="empty-assets"><span class="empty-icon">▧</span><b>${assets.length ? "No matching assets" : "Build your visual vocabulary"}</b>${assets.length ? "Try another search or filter." : "Import images, video, and audio.<br>Group your references by scene<br>and bring them into every shot."}${assets.length ? "" : '<br><button class="small" id="library-import" style="margin-top:16px">＋ Import assets</button>'}</div>`;
  $("#library-import")?.addEventListener("click", () =>
    $("#file-input").click(),
  );
  $$(".asset", $("#asset-list")).forEach((el) => {
    el.onclick = guard((e) => {
      if (e.target.closest("[data-add]")) addReference(el.dataset.asset);
      else showAsset(el.dataset.asset);
    });
    el.ondragstart = (e) =>
      e.dataTransfer.setData("application/frameforge-asset", el.dataset.asset);
  });
}
function refIds() {
  return orderedReferences(scene(),segment());
}
function refList(ids, shared = false) {
  let counts = { image: 0, video: 0, audio: 0 };
  return (
    '<div class="reference-grid">' +
    ids
      .map((aid) => {
        const a = state.assets[aid];
        if (!a) return "";
        const index = ++counts[a.kind];
        const tag = `${{ image: "Picture", video: "Video", audio: "Audio" }[a.kind]} ${index}`;
        return `<div class="reference-slot ${shared ? "shared" : ""}" ${a.kind === "image" && !shared ? `draggable="true" data-reorder-image="${aid}" title="Drag to reorder image references"` : ""}>${a.kind === "audio" ? '<span class="reference-icon">♫</span>' : `<img draggable="false" class="reference-icon" src="${url(aid, true)}" alt="${esc(a.name)}">`}<code>${tag}</code>${a.kind === "audio" ? `<button data-trim-reference="${aid}" title="Trim audio for this segment" aria-label="Trim ${esc(a.name)} for this segment">✂${segment()?.audio_trims?.[aid] ? " Trimmed" : ""}</button>` : ""}<span title="${esc(a.name)}">${esc(a.name)}</span><button data-insert="${esc(tag)}" title="Insert reference tag into prompt">↙</button>${shared ? "<small>scene</small>" : `<button data-remove="${aid}" title="Remove reference">×</button>`}</div>`;
      })
      .join("") +
    "</div>"
  );
}
const propertySections = new Map();
let promptFieldMode = false;
function setupPropertySections() {
  const root = $("#properties");
  const wrap = (elements, title) => {
    const detail = document.createElement("details");
    detail.className = "inspector-section";
    const summary = document.createElement("summary");
    summary.textContent = title;
    elements[0].before(detail);
    detail.append(summary, ...elements);
    return detail;
  };
  const promptLabel = $("#prompt").closest("label");
  wrap([promptLabel], "Prompt");
  wrap([$("[data-prop=duration]").closest(".row")], "Timing");
  $$("div.inspector-section", root).forEach(section => {
    const heading = $(".section-heading", section);
    if (!heading) return;
    const detail = document.createElement("details");
    detail.className = section.className;
    const summary = document.createElement("summary");
    const title = $("h3", heading);
    summary.textContent = title.textContent;
    detail.dataset.sectionKey = title.textContent;
    title.remove();
    const button = $("button", heading);
    if (button) section.insertBefore(button, heading.nextSibling);
    summary.append(...heading.childNodes);
    heading.remove();
    detail.append(summary, ...section.childNodes);
    section.replaceWith(detail);
  });
  $$("details", root).forEach(detail => {
    const key = detail.dataset.sectionKey || $("summary", detail).textContent;
    detail.open = propertySections.get(key) ?? key !== "Generation settings";
    detail.ontoggle = () => { if (detail.isConnected) propertySections.set(key, detail.open); };
  });
}
function setupPromptFields(s) {
  const full = $("#prompt");
  const label = full.closest("label");
  const controls = document.createElement("div");
  controls.className = "prompt-view";
  controls.innerHTML = '<span class="field-label">Prompt view</span><div class="row"><button type="button" id="prompt-full-mode" class="small">Full prompt</button><button type="button" id="prompt-fields-mode" class="small">Structured fields</button></div>';
  label.before(controls);
  const fields = document.createElement("div");
  fields.className = "prompt-fields";
  label.after(fields);
  const writerButton = document.createElement("button");
  writerButton.className = "small";
  writerButton.id = "segment-scene-writer";
  writerButton.textContent = "✎ Open Scene Writer";
  writerButton.onclick = guard(() => openSceneWriter(s));
  fields.after(writerButton);
  const render = () => {
    label.hidden = promptFieldMode;
    fields.hidden = !promptFieldMode;
    $("#prompt-full-mode").setAttribute("aria-pressed", String(!promptFieldMode));
    $("#prompt-fields-mode").setAttribute("aria-pressed", String(promptFieldMode));
    if (!promptFieldMode) return;
    const parts = parsePrompt(s.prompt);
    const existing = new Set(parts.map(p => p.label));
    for (const key of Object.keys(HELP)) {
      if (key === "CONTINUITY" || existing.has(key)) continue;
      parts.push({label:key, header:'', value:'', missing:true});
    }
    fields.innerHTML = '<p class="hint">Edit labeled sections of the same prompt. The six full-reference guide sections share one prompt. Existing or unlabeled text is preserved; switching views does not rewrite it.</p>' + parts.map((part,i) => `<label class="field"><span>${esc(part.label.replaceAll("_", " "))}</span><small class="hint">${esc(HELP[part.label] || LEGACY_HELP[part.label] || (part.label === 'Other text' ? 'Freeform instructions and shot headings preserved from your prompt.' : 'Additional instructions from your prompt.'))}</small><textarea data-prompt-part="${i}" rows="${part.label === "detailed_description" ? 12 : 3}">${esc(part.value.trim())}</textarea></label>`).join('');
    $$("[data-prompt-part]", fields).forEach(input => {
      input.onfocus = () => checkpoint();
      input.oninput = () => {
        const index = Number(input.dataset.promptPart), part = parts[index];
        if (part.missing && input.value) {
          part.header = (joinPrompt(parts) ? '\n\n' : '') + part.label + ': ';
          part.missing = false;
        }
        full.value = editPromptPart(parts,index,input.value);
        full.dispatchEvent(new Event('input'));
      };
    });
  };
  $("#prompt-full-mode").onclick = () => { promptFieldMode = false; render(); };
  $("#prompt-fields-mode").onclick = () => { promptFieldMode = true; render(); };
  render();
}
function motionSource(seg) {
  if (seg.continuation || seg.type === "video") return null;
  const segments = allSegments();
  return seg.continuation_segment
    ? segments.find(x => x.id === seg.continuation_segment)
    : seg.connected ? segments[segments.indexOf(seg)-1] : null;
}
function canLinkMotion(target, source) {
  const seen = new Set([target.id]);
  while (source) {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    source = motionSource(source);
  }
  return true;
}
function detachMotionLinks(ids) {
  for (const seg of allSegments()) if (ids.includes(seg.continuation_segment)) {
    seg.continuation_segment = null;
    seg.connected = false;
  }
}
function renderProperties() {
  const s = segment(),
    sc = scene();
  if (!s) {
    $("#properties").innerHTML =
      '<p class="hint">Add a segment to start editing.</p>';
    return;
  }
  const shared = sc.refs;
  const counts = {};
  for (const kind of ["image", "video", "audio"])
    counts[kind] = refIds().filter(
      (a) => state.assets[a]?.kind === kind,
    ).length;
  const idx = sc.segments.findIndex((x) => x.id === s.id);
  $("#properties").innerHTML =
    `<div><label class="field"><span>Segment name</span><input data-prop="name" value="${esc(s.name)}"></label><label class="field"><span>Prompt <span class="subtle">/ describe this shot</span></span><textarea data-prop="prompt" id="prompt" rows="5" placeholder="A slow dolly toward the character in &lt;Picture 1&gt;. Soft window light. She turns and says…">${esc(s.prompt)}</textarea></label><div class="row"><label class="field"><span>Delivered duration</span><input data-prop="duration" type="number" min="0.25" max="${s.type === "video" ? 86400 : 120}" step="0.041666667" value="${s.duration}"></label><label class="field"><span>Source in point</span><input data-prop="trim_in" type="number" min="0" step="0.041666667" value="${s.trim_in || 0}"></label></div><div class="inspector-section"><div class="section-heading"><h3>Motion continuity</h3><span class="badge">24 FPS</span></div><label class="check"><input id="connected" type="checkbox" ${s.connected ? "checked" : ""} ${allSegments().indexOf(s) === 0 ? "disabled" : ""}> Continue the previous timeline segment</label><label class="field"><span>Latent motion continuation · source segment</span><select id="continuation-segment"><option value="">${s.connected ? "Previous timeline segment" : "No segment link"}</option>${project.scenes.flatMap(sourceScene => sourceScene.segments.filter(source => source.id !== s.id).map(source => `<option value="${source.id}" ${s.continuation_segment === source.id ? "selected" : ""} ${canLinkMotion(s, source) ? "" : "disabled"}>${esc(sourceScene.name)} / ${esc(source.name)}</option>`)).join("")}</select></label><p class="hint">Link any segment, including another scene. Queuing both generates the source first. Otherwise its current main take supplies motion context.</p><span class="field-label">Context overlap · frames</span><div class="overlap-options">${[22, 39, 56].map((n) => `<button data-overlap="${n}" class="${s.overlap === n ? "active" : ""}">${n} <span class="subtle">/ ${(n / 24).toFixed(2)}s</span></button>`).join("")}</div><p class="hint">Context is generated before this shot, then trimmed. H3 rounds up to its frame grid; the first selected result sets the actual duration. Use the full take for seamless latent joins.</p><label class="field"><span>Or continue an imported / saved take</span><select id="continuation"><option value="">${idx ? "Use previous segment when connected" : "Start a new chain"}</option>${Object.values(
      state.assets,
    )
      .filter((a) => a.kind === "video")
      .map(
        (a) =>
          `<option value="${a.id}" ${s.continuation === a.id ? "selected" : ""}>${esc(a.name)}${a.latent ? " ◇" : " · needs encoding"}</option>`,
      )
      .join(
        "",
      )}</select></label></div></div><div><div class="inspector-section" style="margin-top:0"><div class="section-heading"><h3>References</h3><button id="pick-refs" class="small">＋ Add</button></div><p class="hint">${counts.image}/9 images &nbsp; ${counts.video}/3 video &nbsp; ${counts.audio}/3 audio</p>${refIds().length ? refList(refIds()).replace(/<button data-remove="([^"]+)" title="Remove reference">×<\/button>/g, (m, aid) => (shared.includes(aid) ? "<small>scene</small>" : m)) : '<div class="ref-empty">Drop assets here or add from the library</div>'}<button id="scene-settings" class="small" style="margin-top:9px;width:100%">▧ Shared scene assets & settings</button></div><details><summary>Generation settings</summary><label class="field"><span>Image reference size</span><select data-prop="ref_image_size"><option value="match" ${(s.ref_image_size || "match") === "match" ? "selected" : ""}>Match</option><option value="max" ${s.ref_image_size === "max" ? "selected" : ""}>Max</option></select></label><p class="hint">Match scales references down to the generation’s pixel area. Max uses a 2048px short edge for finer identity detail and can be considerably slower.</p><div class="row"><div class="field"><label for="segment-seed">Seed</label><div class="seed-control"><input id="segment-seed" data-prop="seed" type="number" min="0" max="9007199254740991" step="1" value="${s.seed}"><button id="randomize-segment-seed" type="button" class="small" title="Choose a new random seed" aria-label="Randomize segment seed">⚄ Randomize</button></div><label class="check"><input id="auto-segment-seed" type="checkbox" ${s.randomize_seed ? "checked" : ""}> Randomize each generation</label></div><label class="field"><span>Steps</span><input data-prop="steps" type="number" min="1" max="100" value="${s.steps}"></label></div><p class="hint">${project.width} × ${project.height} · H3 · 24 fps. Resolution is shared across the project for compatible latents.</p></details><div class="inspector-section"><div class="section-heading"><h3>Generated takes</h3><span class="count">${s.takes.length}</span></div><button id="match-main-duration" type="button" class="small" hidden></button><div class="take-list">${s.takes.map((aid) => (state.assets[aid] ? `<div class="take-item"><img src="${url(aid, true)}" alt=""><span>${esc(state.assets[aid].name)}</span><button class="small" data-take="${aid}">${s.main === aid ? "Main" : "Use"}</button><a class="small" href="${url(aid)}" download="${esc(state.assets[aid].name)}${esc(state.assets[aid].file.slice(state.assets[aid].file.lastIndexOf(".")))}" title="Download this take" aria-label="Download ${esc(state.assets[aid].name)}">↓</a></div>` : "")).join("") || '<p class="hint">Every generated take stays in your asset library. Choose any take as the main video.</p>'}</div></div><div class="inspector-section inspector-actions"><button id="duplicate-segment" class="small">Duplicate</button><button id="delete-segment" class="small danger">Delete segment</button></div></div>`;
  if (s.main) {
    const section = document.createElement("div");
    section.className = "inspector-section";
    const available = encodedContext(s);
    section.innerHTML = `<div class="section-heading"><h3>${s.type === "video" ? "Imported video" : "Video continuation"}</h3><span class="badge" id="segment-latent-badge">${available ? "Latent ready" : "Encoding needed"}</span></div><p class="hint">Continuations automatically queue an encoding of this segment’s current in-point and duration when needed.</p><div class="row"><button id="encode-segment" class="small">◇ Encode segment latents</button><button id="add-continuation" class="small">＋ Continue</button></div>`;
    $("#properties").prepend(section);
    $("#encode-segment").onclick = guard(encodeSelectedSegment);
    $("#add-continuation").onclick = addContinuation;
  }
  const matchDuration = $("#match-main-duration");
  const updateMatchDuration = () => {
    const main = state.assets[s.main];
    const duration = Number(main?.duration);
    matchDuration.hidden = main?.kind !== "video" || !Number.isFinite(duration) || duration <= 0 || Math.abs(s.duration - duration) < 0.001;
    matchDuration.textContent = `Match main video length · ${fmt(duration)}`;
    matchDuration.title = "Use the full main video duration and reset the source in point to zero.";
  };
  updateMatchDuration();
  matchDuration.onclick = () => {
    const main = state.assets[s.main];
    if (main?.kind !== "video" || !Number.isFinite(main.duration) || main.duration <= 0) return;
    edit(() => {
      s.duration = main.duration;
      s.trim_in = 0;
      delete s.encoded_latent;
    });
  };
  $$("[data-prop]", $("#properties")).forEach((el) => {
    el.onfocus = () => checkpoint();
    el.oninput = () => {
      const value = el.type === "number" ? Number(el.value) : el.value;
      if (
        el.type === "number" &&
        (!el.value ||
          !Number.isFinite(value) ||
          Number(el.min) > value ||
          (el.max && Number(el.max) < value))
      )
        return;
      s[el.dataset.prop] = value;
      updateMatchDuration();
      changed(false);
      renderTimeline();
      renderPreview();
    };
    el.onchange = () => {
      if (el.type === "number") el.value = s[el.dataset.prop];
    };
  });
  let draggedReference=null;
  const imageSlots=$$("[data-reorder-image]",$("#properties"));
  const clearReferenceDrag=()=>imageSlots.forEach(el=>el.classList.remove('reference-dragging','reference-drop-target'));
  imageSlots.forEach(el=>{
    el.ondragstart=e=>{
      draggedReference=el.dataset.reorderImage;
      e.stopPropagation();e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('application/frameforge-reference',draggedReference);
      el.classList.add('reference-dragging');
    };
    el.ondragover=e=>{
      if(!draggedReference||!e.dataTransfer.types.includes('application/frameforge-reference'))return;
      e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';
      imageSlots.forEach(slot=>slot.classList.toggle('reference-drop-target',slot===el&&slot.dataset.reorderImage!==draggedReference));
    };
    el.ondragleave=()=>el.classList.remove('reference-drop-target');
    el.ondragend=()=>{draggedReference=null;clearReferenceDrag()};
    el.ondrop=e=>{
      if(!draggedReference||!e.dataTransfer.types.includes('application/frameforge-reference'))return;
      e.preventDefault();e.stopPropagation();const source=draggedReference;draggedReference=null;clearReferenceDrag();
      const target=el.dataset.reorderImage;if(source===target)return;
      edit(()=>{s.ref_order=moveImageReference(refIds(),state.assets,source,target)});
      toast('Image references reordered. Review Picture numbers in your prompt.');
    };
  });
  setupPropertySections();
  setupPromptFields(s);
  $("#connected").onchange = (e) =>
    edit(() => { s.connected = e.target.checked; s.continuation_segment = null; s.continuation = null; });
  $("#continuation").onchange = (e) =>
    edit(() => { s.continuation = e.target.value || null; s.continuation_segment = null; s.connected = false; });
  $("#continuation-segment").onchange = (e) =>
    edit(() => { s.continuation_segment = e.target.value || null; s.continuation = null; s.connected = false; });
  $$("[data-overlap]").forEach(
    (b) =>
      (b.onclick = () => edit(() => (s.overlap = Number(b.dataset.overlap)))),
  );
  $$("[data-trim-reference]", $("#properties")).forEach(
    (b) => (b.onclick = () => showSegmentAudioTrim(b.dataset.trimReference, s)),
  );
  $$("[data-remove]").forEach(
    (b) =>
      (b.onclick = () =>
        edit(() => (s.refs = s.refs.filter((a) => a !== b.dataset.remove)))),
  );
  $$("[data-insert]").forEach(
    (b) =>
      (b.onclick = () => {
        edit(
          () =>
            (s.prompt += (s.prompt ? " " : "") + "<" + b.dataset.insert + ">"),
        );
        $("#prompt-full-mode").click();
        $("#prompt").closest("details").open = true;
        $("#prompt").focus();
      }),
  );
  $$("[data-take]").forEach(
    (b) =>
      (b.onclick = () =>
        edit(() => {
          s.main = b.dataset.take;
          s.trim_in = 0;
          s.duration = state.assets[s.main].duration;
        })),
  );
  $("#auto-segment-seed").onchange = (e) =>
    edit(() => (s.randomize_seed = e.target.checked), false);
  $("#randomize-segment-seed").onclick = () => {
    edit(() => (s.seed = randomSeed()), false);
    $("#segment-seed").value = s.seed;
  };
  $("#pick-refs").onclick = () => showPicker(false);
  $("#scene-settings").onclick = () => showScene();
  $("#duplicate-segment").onclick = () =>
    edit(() => {
      const copy = clone(s);
      copy.id = id();
      copy.name += " copy";
      copy.connected = false;
      copy.continuation_segment = null;
      sc.segments.splice(idx + 1, 0, copy);
      segmentId = copy.id;
      selected = new Set([copy.id]);
    });
  $("#delete-segment").onclick = () =>
    edit(() => {
      detachMotionLinks([s.id]);
      sc.segments.splice(idx, 1);
      segmentId = sc.segments[Math.max(0, idx - 1)]?.id;
      selected = new Set(segmentId ? [segmentId] : []);
    });
  $("#properties").ondragover = (e) => {
    if (e.dataTransfer.types.includes("application/frameforge-asset")) {
      e.preventDefault();
      $("#properties").classList.add("drop-highlight");
    }
  };
  $("#properties").ondragleave = () =>
    $("#properties").classList.remove("drop-highlight");
  $("#properties").ondrop = guard((e) => {
    e.preventDefault();
    $("#properties").classList.remove("drop-highlight");
    const aid = e.dataTransfer.getData("application/frameforge-asset");
    if (aid) addReference(aid);
  });
}
function showSegmentAudioTrim(aid, seg) {
  const a = state.assets[aid];
  if (!a || a.kind !== "audio") return;
  const trim = seg.audio_trims?.[aid] || { start: 0, end: a.duration };
  modal(
    "Trim audio for " + seg.name,
    `<p class="hint">${esc(a.name)} · ${fmt(a.duration)}. This selection applies only to this segment, including when the reference is shared by the scene.</p><div class="audio-trim-track" id="ref-trim-track">${wave(a, true)}<div class="audio-trim-shade before" id="ref-trim-before"></div><div class="audio-trim-shade after" id="ref-trim-after"></div><div class="audio-trim-selection" id="ref-trim-selection"></div><button type="button" role="slider" class="audio-trim-handle in" id="ref-trim-in-handle" aria-label="Audio in point" aria-orientation="horizontal"><span>IN</span></button><button type="button" role="slider" class="audio-trim-handle out" id="ref-trim-out-handle" aria-label="Audio out point" aria-orientation="horizontal"><span>OUT</span></button></div><p class="hint">Drag the IN and OUT handles to select audio. Arrow keys adjust a focused handle; Shift moves in larger steps.</p><audio id="ref-trim-player" controls src="${url(aid)}"></audio><div class="row"><label class="field"><span>In point · seconds</span><input id="ref-trim-start" type="number" min="0" max="${a.duration}" step="0.01" value="${trim.start}"></label><label class="field"><span>Out point · seconds</span><input id="ref-trim-end" type="number" min="0" max="${a.duration}" step="0.01" value="${trim.end}"></label></div><button id="ref-trim-preview" class="small">▶ Preview selection</button><p id="ref-trim-duration" class="hint" role="status"></p><p class="hint">The original audio stays intact. Local and cloud generation use only this selection.</p>`,
    '<button id="ref-trim-reset" class="small">Use full clip</button><button id="ref-trim-apply" class="primary">Apply to segment</button>',
  );
  const start = $("#ref-trim-start"),
    end = $("#ref-trim-end"),
    player = $("#ref-trim-player"),
    apply = $("#ref-trim-apply"),
    preview = $("#ref-trim-preview");
  const valid = () =>
    start.value !== "" &&
    end.value !== "" &&
    Number(start.value) >= 0 &&
    Number(end.value) > Number(start.value) &&
    Number(end.value) <= a.duration;
  const track = $("#ref-trim-track"),
    inHandle = $("#ref-trim-in-handle"),
    outHandle = $("#ref-trim-out-handle");
  const gap = Math.min(0.01, a.duration);
  const update = () => {
    player.pause();
    apply.disabled = preview.disabled = !valid();
    const from = Math.max(0, Math.min(a.duration, Number(start.value) || 0));
    const to = Math.max(from, Math.min(a.duration, Number(end.value) || 0));
    const left = (100 * from) / a.duration,
      right = (100 * to) / a.duration;
    inHandle.style.left = left + "%";
    outHandle.style.left = right + "%";
    $("#ref-trim-before").style.width = left + "%";
    $("#ref-trim-after").style.width = 100 - right + "%";
    $("#ref-trim-selection").style.left = left + "%";
    $("#ref-trim-selection").style.width = right - left + "%";
    for (const [handle, value, min, max] of [
      [inHandle, from, 0, Math.max(0, to - gap)],
      [outHandle, to, Math.min(a.duration, from + gap), a.duration],
    ]) {
      handle.setAttribute("aria-valuemin", min);
      handle.setAttribute("aria-valuemax", max);
      handle.setAttribute("aria-valuenow", value);
      handle.setAttribute("aria-valuetext", value.toFixed(2) + " seconds");
      handle.title = value.toFixed(2) + " seconds";
    }
    $("#ref-trim-duration").textContent = valid()
      ? `${(Number(end.value) - Number(start.value)).toFixed(2)} seconds selected`
      : "Choose an in point before the out point, within the recording.";
  };
  const moveHandle = (isStart, value) => {
    const min = isStart
      ? 0
      : Math.min(a.duration, (Number(start.value) || 0) + gap);
    const max = isStart
      ? Math.max(0, (Number(end.value) || a.duration) - gap)
      : a.duration;
    const bounded = Math.max(min, Math.min(max, Math.round(value * 100) / 100));
    (isStart ? start : end).value = bounded;
    update();
  };
  for (const [handle, isStart] of [
    [inHandle, true],
    [outHandle, false],
  ]) {
    let dragging = false, dragX = 0, dragValue = 0;
    const seek = (e) => {
      const rect = track.getBoundingClientRect();
      if (rect.width)
        moveHandle(
          isStart,
          dragValue + ((e.clientX - dragX) / rect.width) * a.duration,
        );
    };
    handle.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.focus();
      dragX = e.clientX;
      dragValue = Number((isStart ? start : end).value);
      dragging = true;
      handle.setPointerCapture(e.pointerId);
    };
    handle.onpointermove = (e) => {
      if (dragging) seek(e);
    };
    handle.onpointerup = (e) => {
      if (!dragging) return;
      seek(e);
      dragging = false;
      if (handle.hasPointerCapture(e.pointerId))
        handle.releasePointerCapture(e.pointerId);
    };
    handle.onpointercancel = handle.onlostpointercapture = () => {
      dragging = false;
    };
    handle.onkeydown = (e) => {
      const current = Number((isStart ? start : end).value),
        step = e.shiftKey ? 0.1 : 0.01;
      const values = {
        ArrowLeft: current - step,
        ArrowDown: current - step,
        ArrowRight: current + step,
        ArrowUp: current + step,
        Home: 0,
        End: a.duration,
      };
      if (!(e.key in values)) return;
      e.preventDefault();
      moveHandle(isStart, values[e.key]);
    };
  }
  start.oninput = end.oninput = update;
  update();
  preview.onclick = guard(async () => {
    player.currentTime = Number(start.value);
    await player.play();
  });
  let previewFrame = 0, previewTimer = 0;
  const stopPreview = () => {
    cancelAnimationFrame(previewFrame);
    clearTimeout(previewTimer);
  };
  const checkPreview = () => {
    if (player.paused) return;
    if (player.currentTime >= Number(end.value)) {
      player.pause();
      player.currentTime = Number(end.value);
      return;
    }
    previewFrame = requestAnimationFrame(checkPreview);
  };
  const scheduleStop = () => {
    clearTimeout(previewTimer);
    if (!player.paused) previewTimer = setTimeout(() => {
      if (player.currentTime >= Number(end.value) - 0.01) {
        player.pause(); player.currentTime = Number(end.value);
      } else scheduleStop();
    }, Math.max(10, (Number(end.value) - player.currentTime) / player.playbackRate * 1000));
  };
  player.onplay = () => {
    if (!valid()) { player.pause(); return; }
    stopPreview();
    player.currentTime = Number(start.value);
    previewFrame = requestAnimationFrame(checkPreview);
    scheduleStop();
  };
  player.onpause = stopPreview;
  player.onseeking = () => {
    if (player.currentTime < Number(start.value)) player.currentTime = Number(start.value);
    else if (player.currentTime > Number(end.value)) player.currentTime = Number(end.value);
  };
  player.onseeked = player.onratechange = scheduleStop;
  player.ontimeupdate = () => {
    if (!player.paused && player.currentTime >= Number(end.value)) {
      player.pause(); player.currentTime = Number(end.value);
    }
  };
  $("#modal").addEventListener("close", stopPreview, {once: true});
  $("#ref-trim-reset").onclick = () => {
    start.value = 0;
    end.value = a.duration;
    update();
  };
  apply.onclick = guard(async () => {
    if (!valid()) return;
    edit(() => {
      seg.audio_trims = { ...(seg.audio_trims || {}) };
      if (Number(start.value) === 0 && Number(end.value) === a.duration)
        delete seg.audio_trims[aid];
      else
        seg.audio_trims[aid] = {
          start: Number(start.value),
          end: Number(end.value),
        };
    });
    await syncRecovery();
    player.pause();
    $("#modal").close();
    toast("Audio selection saved for this segment.");
  });
  $("#modal").addEventListener("close", () => player.pause(), { once: true });
}

function addReference(aid, shared = false, sc = scene(), seg = segment()) {
  const a = state.assets[aid];
  if (!a || !seg || !sc || !["image", "video", "audio"].includes(a.kind))
    return;
  const target = shared ? sc.refs : seg.refs;
  if (target.includes(aid) || (!shared && sc.refs.includes(aid))) return;
  const limit = { image: 9, video: 3, audio: 3 }[a.kind];
  const targets = shared ? sc.segments : [seg];
  if (
    targets.some(
      (s) =>
        [...new Set([...sc.refs, ...s.refs, aid])].filter(
          (x) => state.assets[x]?.kind === a.kind,
        ).length > limit,
    )
  )
    throw Error(
      `Maximum ${limit} ${a.kind} references per segment, including scene assets.`,
    );
  edit(() => target.push(aid));
  toast(`${a.name} added ${shared ? "to scene" : "as a reference"}`);
}
function renderTimeline() {
  const total = allSegments().reduce((n, s) => n + s.duration, 0);
  $("#timeline-length").textContent = fmt(total);
  const viewport = $("#tracks-scroll").clientWidth || 600;
  const extent = total + 3;
  const barWidth = $("#timeline-range").clientWidth || viewport;
  const maxZoom = Math.min(120, viewport / Math.min(extent, extent * 32 / barWidth));
  zoom = Math.max(viewport / extent, Math.min(maxZoom, zoom));
  const width = Math.max(viewport, extent * zoom);
  let offset = 0;
  $("#ruler").style.width = width + "px";
  const tickStep = Math.max(1, Math.ceil(45 / zoom));
  $("#ruler").innerHTML = Array.from(
    { length: Math.ceil(width / zoom / tickStep) },
    (_, i) =>
      `<span class="tick" style="left:${i * tickStep * zoom}px">${String(Math.floor(i * tickStep / 60)).padStart(2, "0")}:${String(i * tickStep % 60).padStart(2, "0")}</span>`,
  ).join("");
  $("#scene-list").innerHTML = project.scenes
    .map(
      (sc, i) =>
        `<div class="scene-label ${sc.id === sceneId ? "active" : ""}" data-scene="${sc.id}"><span class="eyebrow">SCENE ${String(i + 1).padStart(2, "0")}</span><div class="row between"><b>${esc(sc.name)}</b><button data-scene-edit="${sc.id}" class="icon" title="Scene settings">⋯</button></div><span class="subtle" style="font-size:9px">${sc.segments.length} shots · ${fmt(sc.segments.reduce((n, s) => n + s.duration, 0))} · ${sc.refs.length} shared</span></div>`,
    )
    .join("");
  const timelineClips = project.scenes
    .map((sc) => {
      let clips = sc.segments
        .map((s, i) => {
          let x = offset * zoom;
          offset += s.duration;
          let a = state.assets[s.main];
          const source = motionSource(s);
          const refs = orderedReferences(sc, s).map(aid => state.assets[aid]).filter(Boolean);
          const refIcons = refs.map(ref => ref.kind === "image" || ref.thumbnail
            ? `<img src="${url(ref.id, ref.kind !== "image")}" alt="${esc(ref.name)}" loading="lazy">`
            : `<span title="${esc(ref.name)}">${ref.kind === "audio" ? "♫" : "▶"}</span>`).join("");
          const insert = x > 0 ? `<button class="insert-between" data-insert-before="${s.id}" data-insert-scene="${sc.id}" style="left:${x - 2}px" aria-label="Insert blank segment before ${esc(s.name)}" title="Insert blank segment">＋</button>` : "";
          return `${insert}<div class="clip ${s.id === segmentId ? "active" : ""} ${selected.has(s.id) ? "selected" : ""}" style="left:${x}px;width:${Math.max(14, s.duration * zoom - 4)}px" data-segment="${s.id}" data-scene="${sc.id}" draggable="true" title="${esc(sc.name)} / ${esc(s.name)} · ${fmt(s.duration)}${source ? " · Motion from " + esc(source.name) : ""}"><div class="clip-image" ${a?.thumbnail ? `style="background-image:url('${url(a.id, true)}')"` : ""}></div>${source || s.continuation ? `<div class="context-shade" style="width:${Math.min((s.overlap / 24) * zoom, s.duration * zoom * 0.4)}px"></div>` : ""}<div class="resize left" data-edge="left"></div><div class="clip-content"><span class="clip-scene">${esc(sc.name)}</span><b>${esc(s.name)}</b><span class="clip-meta">${s.type === "video" ? "▶ Imported video" : a ? "▶ Main take" : "✦ Prompt segment"}${source ? " · ↔ " + esc(source.name) + " · " + s.overlap + "f" : ""}</span></div><div class="clip-references">${refIcons}</div><span class="clip-duration">${fmt(s.duration)}</span><div class="resize right" data-edge="right"></div></div>`;
        })
        .join("");
      return clips;
    })
    .join("");
  const endScene = project.scenes.at(-1)?.id || sceneId;
  $("#tracks").innerHTML = `<div class="track single-track" data-scene="${endScene || ""}" style="width:${width}px">${timelineClips}<button class="add-on-track" data-track-add="${endScene || ""}" style="left:${offset * zoom + 8}px" title="Add segment">＋</button></div>`;
  const track = $("#tracks .single-track");
  const insertButtons = $$(".insert-between", track);
  track.onpointermove = event => {
    const x = event.clientX - track.getBoundingClientRect().left;
    let nearest = null, distance = 16;
    for (const button of insertButtons) {
      const d = Math.abs(parseFloat(button.style.left) - x);
      if (d < distance) { nearest = button; distance = d; }
    }
    for (const button of insertButtons) button.classList.toggle("visible", button === nearest);
  };
  track.onpointerleave = () => insertButtons.forEach(button => button.classList.remove("visible"));
  for (const button of insertButtons) {
    button.onpointerdown = event => event.stopPropagation();
    button.onclick = event => {
      event.stopPropagation();
      insertBlankSegment(button.dataset.insertScene, button.dataset.insertBefore);
    };
  }
  $$(".scene-label").forEach(
    (el) =>
      (el.onclick = (e) => {
        if (e.target.closest("[data-scene-edit]")) {
          sceneId = el.dataset.scene;
          segmentId = scene()?.segments[0]?.id;
          showScene();
          return;
        }
        selectSegment(
          el.dataset.scene,
          project.scenes.find((x) => x.id === el.dataset.scene)?.segments[0]
            ?.id,
        );
      }),
  );
  $$("[data-track-add]").forEach(
    (b) =>
      (b.onclick = () => {
        sceneId = b.dataset.trackAdd;
        addSegment();
      }),
  );
  $$(".clip").forEach((el) => {
    el.onclick = (e) => {
      if (!e.target.closest(".resize"))
        selectSegment(el.dataset.scene, el.dataset.segment, e.shiftKey);
    };
    el.ondragstart = (e) => {
      if (e.target.closest(".resize")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(
        "application/frameforge-segment",
        el.dataset.segment,
      );
    };
    el.ondragover = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("media-drop");
    };
    el.ondragleave = () => el.classList.remove("media-drop");
    el.ondrop = guard(async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("media-drop");
      if (hasFiles(e)) {
        await dropTimelineFiles(
          [...e.dataTransfer.files],
          el.dataset.scene,
          el.dataset.segment,
        );
        return;
      }
      const aid = e.dataTransfer.getData("application/frameforge-asset");
      if (aid) {
        selectSegment(el.dataset.scene, el.dataset.segment);
        addReference(aid);
        return;
      }
      const gid = e.dataTransfer.getData("application/frameforge-segment");
      if (gid && gid !== el.dataset.segment)
        moveSegment(gid, el.dataset.scene, el.dataset.segment);
    });
    $$(".resize", el).forEach(
      (handle) =>
        (handle.onpointerdown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const sc = project.scenes.find((s) => s.id === el.dataset.scene);
          const seg = sc.segments.find((s) => s.id === el.dataset.segment);
          const x = e.clientX,
            original = seg.duration,
            left = handle.dataset.edge === "left";
          checkpoint();
          handle.setPointerCapture(e.pointerId);
          const move = (ev) => {
            seg.duration = Math.min(
              seg.type === "video" ? 86400 : 120,
              Math.max(
                0.25,
                Math.round(
                  (original + ((ev.clientX - x) / zoom) * (left ? -1 : 1)) * 24,
                ) / 24,
              ),
            );
            el.style.width = Math.max(14, seg.duration * zoom - 4) + "px";
            $(".clip-duration", el).textContent = fmt(seg.duration);
          };
          const up = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            sceneId = sc.id;
            segmentId = seg.id;
            selected = new Set([seg.id]);
            changed();
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", up, { once: true });
        }),
    );
  });
  $$(".track").forEach((el) => {
    el.ondragover = (e) => {
      e.preventDefault();
      el.classList.add("dragover");
    };
    el.ondragleave = () => el.classList.remove("dragover");
    el.ondrop = guard(async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("dragover");
      if (hasFiles(e)) {
        await dropTimelineFiles([...e.dataTransfer.files], el.dataset.scene);
        return;
      }
      const aid = e.dataTransfer.getData("application/frameforge-asset");
      if (aid) {
        if (state.assets[aid]?.kind === "video")
          addVideoSegment(aid, el.dataset.scene);
        else
          toast(
            "Drop images and audio onto a segment to add references.",
            true,
          );
      }
      const gid = e.dataTransfer.getData("application/frameforge-segment");
      if (gid) moveSegment(gid, el.dataset.scene);
    });
  });
  $("#undo").disabled = !undo.length;
  $("#redo").disabled = !redo.length;
  syncTimelineRange();
}
function pinMotionLinks() {
  for (const seg of allSegments()) {
    const source = motionSource(seg);
    if (source && seg.connected) {
      seg.continuation_segment = source.id;
      seg.connected = false;
    }
  }
}
function insertBlankSegment(targetSceneId, beforeId) {
  const target = project.scenes.find(sc => sc.id === targetSceneId);
  const index = target?.segments.findIndex(seg => seg.id === beforeId) ?? -1;
  if (index < 0) return;
  edit(() => {
    // Inserting a blank shot must not redirect existing motion chains to it.
    pinMotionLinks();
    sceneId = target.id;
    const blank = newSegment();
    blank.connected = false;
    target.segments.splice(index, 0, blank);
    segmentId = blank.id;
    selected = new Set([blank.id]);
  });
}
function moveSegment(gid, targetId, before) {
  edit(() => {
    pinMotionLinks();
    let old = project.scenes.find((sc) =>
      sc.segments.some((s) => s.id === gid),
    );
    let s = old.segments.find((s) => s.id === gid);
    old.segments = old.segments.filter((s) => s.id !== gid);
    let target = project.scenes.find((sc) => sc.id === targetId);
    let idx = before
      ? target.segments.findIndex((s) => s.id === before)
      : target.segments.length;
    target.segments.splice(Math.max(0, idx), 0, s);
    sceneId = targetId;
    segmentId = gid;
  });
}
function addVideoSegment(aid, targetScene = sceneId) {
  const a = state.assets[aid];
  if (a?.kind !== "video") return;
  edit(() => {
    let sc = project.scenes.find((x) => x.id === targetScene);
    if (!sc) {
      sc = { id: id(), name: "Scene 01", prompt: "", refs: [], segments: [] };
      project.scenes.push(sc);
    }
    sceneId = sc.id;
    const s = newSegment();
    Object.assign(s, {
      name: a.name,
      type: "video",
      main: aid,
      duration: a.duration,
      connected: false,
      prompt: "",
      trim_in: 0,
    });
    sc.segments.push(s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
  toast(
    "Video added as a timeline segment. Encode its latents to continue it.",
  );
}
function encodedContext(s) {
  if (!s) return null;
  const source = {
    asset_id: s.main,
    trim_in: s.trim_in || 0,
    duration: s.duration,
    width: project.width,
    height: project.height,
  };
  const saved = s.encoded_latent;
  if (
    saved &&
    Object.keys(source).every((k) => saved.source?.[k] === source[k])
  )
    return saved;
  const a = state.assets[s.main];
  return a?.latent && !s.trim_in && Math.abs(a.duration - s.duration) < 0.03
    ? a.latent
    : null;
}
async function encodeSelectedSegment() {
  const s = segment();
  if (!s?.main) throw Error("Choose a main video first.");
  await syncRecovery();
  await api(`/api/assets/${s.main}/encode`, {
    project_id: project.id,
    segment_id: s.id,
  });
  toast("Segment latent encoding queued.");
  await refresh();
  // Queuing keeps the current editing view.
}
function addContinuation() {
  const sc = scene(),
    previous = segment();
  edit(() => {
    const s = newSegment();
    s.name = previous.name + " · continuation";
    s.connected = false;
    s.continuation_segment = previous.id;
    sc.segments.splice(sc.segments.indexOf(previous) + 1, 0, s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
  toast(
    "Write the continuation prompt and queue it. Any needed encoding will run first.",
  );
}
function addSegment() {
  if (!scene()) {
    edit(() => {
      const sc = {
        id: id(),
        name: "Scene 01",
        prompt: "",
        refs: [],
        segments: [],
      };
      project.scenes.push(sc);
      sceneId = sc.id;
    });
  }
  edit(() => {
    const s = newSegment();
    scene().segments.push(s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
}
function renderPreview() {
  const s = segment(),
    a = state.assets[s?.main],
    v = $("#preview");
  $("#viewer-title").innerHTML =
    `${esc(scene()?.name || "No scene")} <span>/</span> ${esc(s?.name || "No segment")}`;
  $("#viewer-resolution").textContent = `${project.width} × ${project.height}`;
  if (a) {
    if (v.dataset.asset !== a.id || v.dataset.segment !== s.id) {
      v.src = url(a.id);
      v.dataset.asset = a.id;
      v.dataset.segment = s.id;
      v.onloadedmetadata = () => {
        v.currentTime = s.trim_in || 0;
        if (playingSequence) v.play().catch(() => {});
        updateTime();
      };
    }
    v.style.display = "block";
    $("#preview-empty").style.display = "none";
  } else {
    v.pause();
    v.removeAttribute("src");
    v.dataset.asset = "";
    v.dataset.segment = "";
    v.style.display = "none";
    $("#preview-empty").style.display = "block";
    playingSequence = false;
  }
  $("#main-take").innerHTML =
    '<option value="">No video selected</option>' +
    Object.values(state.assets)
      .filter((a) => a.kind === "video")
      .map(
        (a) =>
          `<option value="${a.id}" ${s?.main === a.id ? "selected" : ""}>${esc(a.name)}</option>`,
      )
      .join("");
  $("#main-take").disabled = !s;
  const context = encodedContext(s);
  $("#latent-status").textContent = context
    ? context.downloaded
      ? "◇ Segment latent saved locally"
      : "◇ Segment latent on ComfyUI"
    : "No matching segment latent";
  $("#latent-status").className = "latent-status" + (context ? " ready" : "");
  if ($("#segment-latent-badge"))
    $("#segment-latent-badge").textContent = context
      ? "Latent ready"
      : "Encoding needed";
  $("#capture-btn").disabled = !a;
  $("#play").disabled = !a;
  $("#preview-duration").textContent = fmt(s?.duration || 0);
  updateTime();
}
function updateTime() {
  const v = $("#preview"),
    s = segment();
  let t = Math.max(0, (v.currentTime || 0) - (s?.trim_in || 0));
  $("#scrubber").max = s?.duration || 1;
  $("#scrubber").value = t;
  let frame = Math.floor(t * 24);
  $("#timecode").textContent = [
    Math.floor(frame / 86400),
    Math.floor(frame / 1440) % 60,
    Math.floor(frame / 24) % 60,
    frame % 24,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  $("#play").textContent = v.paused ? "▶" : "Ⅱ";
}
function advance(dir = 1, sequence = false) {
  const all = project.scenes.flatMap((sc) =>
    sc.segments.map((s) => ({ sc, s })),
  );
  const idx = all.findIndex((o) => o.s.id === segmentId);
  let target = all[idx + dir];
  if (target) {
    if (sequence && !target.s.main) {
      playingSequence = false;
      $("#preview").pause();
      toast("Playback paused: the next segment has no main take.");
      return;
    }
    selectSegment(target.sc.id, target.s.id);
    if (sequence)
      $("#preview")
        .play()
        .catch(() => {});
  } else {
    playingSequence = false;
    $("#preview").pause();
  }
}
function modal(title, content, footer = "", eyebrow = "FRAMEFORGE") {
  modalType = "";
  $("#modal-content").innerHTML =
    `<header class="modal-header"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div><button class="icon" id="close-modal" aria-label="Close dialog">×</button></header><div class="modal-body">${content}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}`;
  $("#close-modal").onclick = () => $("#modal").close();
  if (!$("#modal").open) $("#modal").showModal();
}
function showPicker(shared) {
  const ids = shared ? scene().refs : refIds();
  modal(
    shared ? "Add shared scene assets" : "Add segment references",
    `<p class="hint">${shared ? "Shared assets count toward the limits of every segment in this scene." : "Up to 9 images, 3 video clips, and 3 audio clips, including shared assets."}</p><div class="ref-picker">${
      Object.values(state.assets)
        .map(
          (a) =>
            `<button data-pick="${a.id}" class="${ids.includes(a.id) ? "selected" : ""}">${assetCard(a, true)}</button>`,
        )
        .join("") || "<p>Import assets to add references.</p>"
    }</div>`,
    '<button id="picker-done" class="primary">Done</button>',
  );
  $$("[data-pick]").forEach(
    (b) =>
      (b.onclick = guard(() => {
        addReference(b.dataset.pick, shared);
        b.classList.add("selected");
      })),
  );
  $("#picker-done").onclick = () =>
    shared ? showScene() : $("#modal").close();
}
function showScene() {
  const sc = scene();
  if (!sc) return;
  modal(
    "Scene settings",
    `<label class="field"><span>Scene name</span><input id="scene-name" value="${esc(sc.name)}"></label><label class="field"><span>Shared scene prompt / style, setting, characters</span><textarea id="scene-prompt" rows="4" placeholder="Shared context prepended to every segment prompt…">${esc(sc.prompt)}</textarea></label><div class="section-heading"><h3>Shared assets</h3><button id="scene-add-refs" class="small">＋ Add assets</button></div>${sc.refs.map((aid) => `<div class="reference-slot shared"><span>${esc(state.assets[aid]?.name)}</span><button data-scene-remove="${aid}">×</button></div>`).join("") || '<p class="hint">No shared references yet.</p>'}<div class="scene-modal-tools"><button id="scene-up" class="small">↑ Move earlier</button><button id="scene-down" class="small">↓ Move later</button><button id="scene-delete" class="small danger">Delete scene</button></div>`,
    '<button id="scene-done" class="primary">Save scene</button>',
  );
  const sync = () => {
    if (
      sc.name !== $("#scene-name").value ||
      sc.prompt !== $("#scene-prompt").value
    )
      edit(() => {
        sc.name = $("#scene-name").value;
        sc.prompt = $("#scene-prompt").value;
      });
  };
  $("#scene-done").onclick = () => {
    sync();
    $("#modal").close();
  };
  $("#scene-add-refs").onclick = () => {
    sync();
    showPicker(true);
  };
  $$("[data-scene-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        sync();
        edit(
          () => (sc.refs = sc.refs.filter((a) => a !== b.dataset.sceneRemove)),
        );
        showScene();
      }),
  );
  for (const [key, dir] of [
    ["scene-up", -1],
    ["scene-down", 1],
  ])
    $("#" + key).onclick = () => {
      sync();
      const idx = project.scenes.indexOf(sc);
      if (project.scenes[idx + dir])
        edit(() => {
          project.scenes.splice(idx, 1);
          project.scenes.splice(idx + dir, 0, sc);
        });
    };
  $("#scene-delete").onclick = () => {
    edit(() => {
      detachMotionLinks(sc.segments.map(s => s.id));
      project.scenes = project.scenes.filter((s) => s.id !== sc.id);
      sceneId = project.scenes[0]?.id;
      segmentId = scene()?.segments[0]?.id;
    });
    $("#modal").close();
  };
}
async function showAsset(aid) {
  const a = state.assets[aid];
  if (!a) return;
  const existingFolders = [...new Set(Object.values(state.assets).map(asset => asset.folder).filter(Boolean))].sort((a,b)=>a.localeCompare(b));

  const source =
    a.kind === "image"
      ? `<img class="detail-preview" src="${url(aid)}" alt="${esc(a.name)}">`
      : `<${a.kind === "audio" ? "audio" : "video"} id="asset-player" controls src="${url(aid)}"></${a.kind === "audio" ? "audio" : "video"}>`;
  modal(
    a.name,
    `${source}<div class="row"><label class="field"><span>Name</span><input id="asset-name" value="${esc(a.name)}"></label><div class="field"><label class="field-label" for="asset-folder-existing">Existing folder</label><select id="asset-folder-existing"><option value="" disabled ${a.folder ? '' : 'selected'}>Choose an existing folder…</option>${existingFolders.map(f=>`<option value="${esc(f)}" ${f===a.folder?'selected':''}>${esc(f)}</option>`).join('')}</select><label class="field-label" for="asset-folder">Folder / collection</label><input id="asset-folder" value="${esc(a.folder)}" placeholder="Type a new folder, e.g. Characters / Maya"></div></div><label class="field"><span>Tags, separated by commas</span><input id="asset-tags" value="${esc(a.tags.join(", "))}" placeholder="character, close-up, wardrobe"></label>${a.kind === "image" ? `<label class="field"><span>Image description</span><textarea id="asset-description" rows="6" placeholder="Describe this reference, or generate a description with your connected LLM…">${esc(a.description || "")}</textarea></label><button id="describe-image" class="small">✦ Describe image</button><p class="hint" id="describe-status" role="status">Uses the model configured in Scene Writer. It must support image input. Generated descriptions are saved automatically; edits use Save asset details.</p>` : ""}${a.kind === "audio" ? `${wave(a, true)}<div class="row"><label class="field"><span>Trim in (seconds)</span><input id="trim-start" type="number" min="0" max="${a.duration}" step="0.01" value="0"></label><label class="field"><span>Trim out (seconds)</span><input id="trim-end" type="number" min="0" max="${a.duration}" step="0.01" value="${a.duration}"></label></div><div class="row"><button id="preview-trim" class="small">▶ Preview selection</button><button id="trim-save" class="small">Save trimmed copy</button></div><p class="hint">Trimming makes a new asset and preserves the original recording.</p>` : ""}${a.kind === "video" ? `<div class="row"><button id="add-video-timeline" class="primary small">＋ Add to timeline</button><button id="use-main" class="small">Use as main video</button><button id="encode-latent" class="small">◇ Encode latents</button></div><p class="hint">Encoding uses your project's ${project.width} × ${project.height} resolution at 24 fps. ${a.latent ? "Latent available" + (a.latent.downloaded ? " locally and on ComfyUI." : " on ComfyUI.") : "Encode this video to continue its motion in a new segment."}</p>` : ""}<div class="row" style="margin-top:20px"><button id="detail-add-ref" class="small">＋ Add as reference</button><a href="${url(aid)}" download="${esc(a.name)}${esc(a.file.slice(a.file.lastIndexOf(".")))}">Download original ↗</a></div>`,
    '<button id="asset-save" class="primary">Save asset details</button>',
    "ASSET LIBRARY",
  );
  $("#asset-folder-existing").onchange = e => {
    $("#asset-folder").value = e.target.value;
  };
  $("#asset-folder").oninput = e => {
    $("#asset-folder-existing").value = existingFolders.includes(e.target.value) ? e.target.value : "";
  };
  $("#asset-save").onclick = guard(async () => {
    const result = await api(
      "/api/assets/" + aid,
      {
        name: $("#asset-name").value,
        folder: $("#asset-folder").value,
        ...(a.kind === "image"
          ? { description: $("#asset-description").value }
          : {}),
        tags: $("#asset-tags")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      "PATCH",
    );
    state.assets[aid] = result;
    renderAll();
    $("#modal").close();
  });
  if (a.kind === "image") {
    const button = $("#describe-image"),
      field = $("#asset-description"),
      status = $("#describe-status"),
      saveButton = $("#asset-save");
    button.onclick = guard(async () => {
      button.disabled = true;
      field.disabled = true;
      saveButton.disabled = true;
      status.textContent = "Describing image…";
      try {
        const result = await api(`/api/assets/${aid}/describe`, {});
        if (state.assets[aid])
          state.assets[aid].description = result.description;
        field.value = result.description;
        status.textContent =
          "Description saved. You can edit it and save asset details.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
        field.disabled = false;
        saveButton.disabled = false;
      }
    });
  }
  $("#detail-add-ref").onclick = guard(() => addReference(aid));
  if (a.kind === "video") {
    $("#add-video-timeline").onclick = guard(() => {
      addVideoSegment(aid);
      $("#modal").close();
    });
    $("#use-main").onclick = () => {
      if (!segment()) return;
      edit(() => {
        segment().main = aid;
        segment().trim_in = 0;
        segment().duration = Math.max(
          0.25,
          Math.min(segment().duration, a.duration),
        );
      });
      $("#modal").close();
    };
    $("#encode-latent").onclick = guard(async () => {
      await syncRecovery();
      await api(`/api/assets/${aid}/encode`, { project_id: project.id });
      toast("Latent encoding queued.");
      toast("Encoding queued.");
      refresh();
    });
  }
  if (a.kind === "audio") {
    $("#preview-trim").onclick = () => {
      const v = $("#asset-player");
      v.currentTime = Number($("#trim-start").value);
      v.ontimeupdate = () => {
        if (v.currentTime >= Number($("#trim-end").value)) v.pause();
      };
      v.play();
    };
    $("#trim-save").onclick = guard(async () => {
      const b = $("#trim-save");
      b.disabled = true;
      try {
        const out = await api(`/api/assets/${aid}/trim`, {
          start: Number($("#trim-start").value),
          end: Number($("#trim-end").value),
          name: $("#asset-name").value + " · trimmed",
        });
        state.assets[out.id] = out;
        renderAssets();
        toast("Trimmed audio added to the library.");
        showAsset(out.id);
      } finally {
        b.disabled = false;
      }
    });
  }
}
async function showSettings() {
  const settings = state.settings;
  let hosting;
  try {
    hosting = await api("/api/hosting");
  } catch (error) {
    if (error.status !== 404) throw error;
    hosting = {supported: false, lan: false, needsRestart: true};
  }
  modal(
    "Local studio settings",
    `<h3>Network access</h3><label class="check"><input id="hosting-lan" type="checkbox" ${hosting.lan ? "checked" : ""} ${hosting.supported ? "" : "disabled"}> LAN access</label><p class="hint">Off: local only. On: devices on your LAN can open this editor. Changes apply immediately and are remembered. LAN access has no sign-in; use a trusted network.</p><p id="hosting-status" class="hint" role="status"></p><label class="field"><span>Project name</span><input id="settings-project" value="${esc(project.name)}"></label><div class="row"><label class="field"><span>Project width · multiple of 32</span><input id="settings-width" type="number" min="32" step="32" value="${project.width}"></label><label class="field"><span>Project height · multiple of 32</span><input id="settings-height" type="number" min="32" step="32" value="${project.height}"></label></div><div class="row"><label class="field"><span>Target megapixels</span><input id="settings-mp" type="number" min="0.01" max="16.77" step="0.1" value="${((project.width * project.height) / 1e6).toFixed(2)}"></label><button id="apply-mp" class="small">Apply MP</button></div><p class="hint" id="mp-result">Uses the current width-to-height ratio; dimensions round to multiples of 32.</p><label class="field"><span>ComfyUI address</span><input id="comfy-url" value="${esc(settings.comfy_url)}" placeholder="http://127.0.0.1:8188"></label><div class="row"><button id="test-connection" class="small">Test connection & discover models</button><span id="connection-result" class="hint"></span></div><details><summary>Model filenames</summary>${Object.entries(
      settings.models,
    )
      .filter(([k]) => k !== "ltx_identity_lora")
      .map(
        ([k, v]) =>
          `<label class="field"><span>${esc(k.replaceAll("_", " "))}${k === "ltx_identity_lora" ? " · required for new dialogue" : ""}</span><input data-model="${k}" value="${esc(v)}" list="model-${k}"><datalist id="model-${k}"></datalist></label>`,
      )
      .join(
        "",
      )}</details><h3>Portable library</h3><p class="hint">Projects, references, generated takes, and downloaded latents live together. Download a library backup, then extract it into a new data folder and start the editor with that folder.</p><a href="/api/backup" download>Download complete library backup ↗</a>`,
    '<button id="settings-save" class="primary">Save settings</button>',
  );
  const renderHosting = () => {
    $("#hosting-status").textContent = !hosting.supported
      ? (hosting.needsRestart ? "Restart the editor after active jobs finish to enable network access controls." : "Start with run.py to change network access here.")
      : hosting.lan
        ? "LAN access enabled. " + (hosting.urls.join(" · ") || "Use this computer’s LAN IP and app port.")
        : "Local only · " + hosting.local_url;
  };
  renderHosting();
  $("#hosting-lan").onchange = guard(async () => {
    const toggle = $("#hosting-lan");
    toggle.disabled = true;
    try {
      hosting = await api("/api/hosting", {lan: toggle.checked}, "PUT");
      renderHosting();
      if (!hosting.lan && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))
        $("#hosting-status").textContent = "Local only enabled. This device will disconnect. Open " + hosting.local_url + " on the host computer.";
    } finally {
      toggle.checked = hosting.lan;
      toggle.disabled = false;
    }
  });
  $("#test-connection").onclick = guard(async () => {
    const b = $("#test-connection");
    b.disabled = true;
    $("#connection-result").textContent = "Connecting…";
    try {
      let c = await api(
        "/api/connection?url=" + encodeURIComponent($("#comfy-url").value),
      );
      $("#connection-result").textContent = c.connected
        ? "Connected · reading models…"
        : c.error;
      if (c.connected) {
        const cap = await api(
          "/api/capabilities?url=" + encodeURIComponent($("#comfy-url").value),
        );
        for (const [k, opts] of Object.entries(cap.models))
          $("#model-" + k).innerHTML = opts
            .map((v) => `<option value="${esc(v)}">`)
            .join("");
        $("#connection-result").textContent =
          `Connected · ${cap.nodes.length} node types available`;
      }
    } finally {
      b.disabled = false;
    }
  });
  $("#apply-mp").onclick = guard(() => {
    const mp = Number($("#settings-mp").value);
    const w = Number($("#settings-width").value),
      h = Number($("#settings-height").value);
    if (!(mp >= 0.01 && mp <= 16.77 && w > 0 && h > 0))
      throw Error("Enter valid megapixels and dimensions.");
    const width = Math.max(
      32,
      Math.round(Math.sqrt((mp * 1e6 * w) / h) / 32) * 32,
    );
    const height = Math.max(
      32,
      Math.round(Math.sqrt((mp * 1e6 * h) / w) / 32) * 32,
    );
    if (width > 4096 || height > 4096)
      throw Error(
        "This aspect ratio exceeds 4096 pixels; choose fewer megapixels.",
      );
    $("#settings-width").value = width;
    $("#settings-height").value = height;
    $("#mp-result").textContent =
      `${width} × ${height} · ${((width * height) / 1e6).toFixed(3)} MP. Save settings to apply.`;
  });
  $("#settings-save").onclick = guard(async () => {
    const width = Number($("#settings-width").value),
      height = Number($("#settings-height").value);
    if (![width, height].every((n) => n >= 32 && n <= 4096 && n % 32 === 0))
      throw Error(
        "Width and height must be multiples of 32, between 32 and 4096.",
      );
    const models = Object.fromEntries(
      $$("[data-model]").map((el) => [el.dataset.model, el.value]),
    );
    state.settings = await api(
      "/api/settings",
      { comfy_url: $("#comfy-url").value, models },
      "PUT",
    );
    const name = $("#settings-project").value;
    edit(() => {
      project.name = name;
      project.width = width;
      project.height = height;
      allSegments().forEach((s) => {
        s.width = width;
        s.height = height;
      });
    });
    await syncRecovery();
    $("#modal").close();
    checkConnection();
    toast("Settings saved.");
  });
}
function jobsHTML() {
  let jobs = [...state.jobs].reverse();
  return `<div class="stat-grid"><div class="stat"><strong>${jobs.filter((j) => activeStatuses.includes(j.status)).length}</strong><span>Active & queued</span></div><div class="stat"><strong>${jobs.filter((j) => j.status === "completed").length}</strong><span>Completed</span></div><div class="stat"><strong>${connectionState?.stats?.devices?.[0] ? Math.round(connectionState.stats.devices[0].vram_free / 1024 ** 3) + " GB" : "—"}</strong><span>Free GPU memory</span></div></div>${connectionState?.stats?.devices?.[0] ? `<p class="hint">${esc(connectionState.stats.devices[0].name)}</p>` : ""}<div id="job-list">${jobs.map((j) => `<article class="job"><div class="row between"><span class="job-name">${esc(j.name)}${j.inference === "cloud" ? " · Cloud Add Guide" : ""}</span><span class="badge ${j.status}">${j.status}</span></div><div class="job-details">${esc(j.stage || "")} · ${j.started ? Math.round((j.finished || Date.now() / 1000) - j.started) + "s elapsed" : new Date(j.created * 1000).toLocaleTimeString()}${j.spec?.seed !== undefined ? "<br>Seed " + esc(j.spec.seed) : ""}${j.prompt_id ? "<br>Prompt " + esc(j.prompt_id) : ""}</div>${activeStatuses.includes(j.status) ? `<div class="progress"><div style="width:${j.progress ?? 3}%"></div></div>` : ""}${j.error ? `<div class="job-error">${esc(j.error)}</div>` : ""}<div class="row" style="margin-top:10px">${activeStatuses.includes(j.status) && j.kind !== "export" ? `<button data-cancel-job="${j.id}" class="small danger">Cancel job</button>` : ""}${j.download ? `<a href="${esc(j.download)}" download>Download export ↗</a>` : ""}${j.prompt_id ? `<a href="/api/jobs/${j.id}/graph" download class="subtle" style="font-size:10px">Workflow JSON</a>` : ""}${(j.results || []).map((aid) => `<button class="small" data-result="${aid}">Open ${state.assets[aid]?.kind || "asset"}</button>`).join("")}</div></article>`).join("") || '<div class="empty-assets"><b>Your queue is clear</b>Queue one shot or an entire scene.<br>Generations run one at a time to fit consumer hardware.</div>'}</div>`;
}
function showJobs() {
  modal(
    "Generation queue",
    jobsHTML(),
    '<button id="jobs-done" class="primary">Back to editor</button>',
    "LOCAL COMPUTE",
  );
  modalType = "jobs";
  bindJobs();
  $("#jobs-done").onclick = () => $("#modal").close();
}
function bindJobs() {
  $$("[data-cancel-job]").forEach(
    (b) =>
      (b.onclick = guard(async () => {
        b.disabled = true;
        try {
          await api("/api/jobs/" + b.dataset.cancelJob + "/cancel", {});
          await refresh();
        } finally {
          b.disabled = false;
        }
      })),
  );
  $$("[data-result]").forEach(
    (b) => (b.onclick = () => showAsset(b.dataset.result)),
  );
}
function showSpeech() {
  const images = Object.values(state.assets).filter((a) => a.kind === "image"),
    audios = Object.values(state.assets).filter((a) => a.kind === "audio");
  modal(
    "Speech studio",
    `<p class="speech-intro">Start with <b>1–2 seconds of voice</b>, then generate the dialogue that follows. The reference prefix is removed from the finished sound and the tiny <b>32 × 32</b> driving video.</p><label class="field"><span>Output name</span><input id="speech-name" value="Dialogue ${state.jobs.filter((j) => j.kind === "speech").length + 1}"></label><div class="speech-row"><div class="speech-reference"><span class="eyebrow">01 / DRIVING IMAGE</span><select id="speech-image"><option value="">Choose an image…</option>${images.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select><div id="speech-image-preview"></div></div><div class="speech-reference"><span class="eyebrow">02 / VOICE PREFIX · 1–2 SECONDS</span><select id="speech-audio"><option value="">Choose an audio clip…</option>${audios.map((a) => `<option value="${a.id}">${esc(a.name)} · ${fmt(a.duration)}</option>`).join("")}</select><div id="speech-audio-preview"></div><button id="speech-trim" class="small">Trim reference ↗</button></div></div><label class="field" style="margin-top:20px"><span>03 / Performance & dialogue after the voice prefix</span><textarea id="speech-prompt" rows="4" placeholder='The same warm voice continues: "We have all the time in the world." A gentle pause, then a quiet laugh.'></textarea></label><div class="row"><label class="field"><span>Total generation length · seconds</span><input id="speech-duration" type="number" value="4" min="0.5" max="40" step="0.5"></label><div class="field"><label for="speech-seed">Seed</label><div class="seed-control"><input id="speech-seed" type="number" value="42" min="0" max="9007199254740991" step="1"><button id="randomize-speech-seed" type="button" class="small" title="Choose a new random seed" aria-label="Randomize speech seed">⚄ Randomize</button></div><label class="check"><input id="auto-speech-seed" type="checkbox" ${speechDraft.randomize_seed ? "checked" : ""}> Randomize each generation</label></div></div><div id="speech-note" class="callout success-box"></div><p class="hint">The supplied LTX workflow locks the reference audio at the start and generates the remaining audio. Set the total length longer than the reference. Both the voice prefix and extra frame-grid padding are trimmed from the output. Review the generated words and voice before adding them to a scene.</p>`,
    '<button id="speech-generate" class="primary">✦ Queue speech</button>',
    "LTX 2.3 / VOICE CONTINUATION",
  );
  const updateLength = () => {
    const a = state.assets[$("#speech-audio").value],
      total = Number($("#speech-duration").value);
    $("#speech-note").textContent = a
      ? `${fmt(total)} generation − ${fmt(a.duration)} reference prefix = ${fmt(Math.max(0, total - a.duration))} finished output`
      : "Choose a short voice reference. Its duration will be subtracted from the total generation length.";
  };
  $("#speech-image").onchange = () =>
    ($("#speech-image-preview").innerHTML = $("#speech-image").value
      ? `<img src="${url($("#speech-image").value, true)}" alt="Driving reference">`
      : "");
  $("#speech-audio").onchange = () => {
    $("#speech-audio-preview").innerHTML = $("#speech-audio").value
      ? `<audio controls src="${url($("#speech-audio").value)}"></audio>`
      : "";
    updateLength();
  };
  $("#speech-duration").oninput = updateLength;
  $("#speech-trim").onclick = () => {
    const aid = $("#speech-audio").value;
    if (aid) showAsset(aid);
    else toast("Choose a voice reference first.");
  };
  for (const key of ["name", "prompt", "image", "audio", "duration", "seed"]) {
    const el = $("#speech-" + key);
    if (speechDraft[key] !== undefined) el.value = speechDraft[key];
    el.addEventListener("input", () => (speechDraft[key] = el.value));
    el.addEventListener("change", () => (speechDraft[key] = el.value));
  }
  $("#speech-image").onchange();
  $("#speech-audio").onchange();
  $("#auto-speech-seed").onchange = (e) => {
    speechDraft.randomize_seed = e.target.checked;
  };
  $("#randomize-speech-seed").onclick = () => {
    $("#speech-seed").value = randomSeed();
    speechDraft.seed = $("#speech-seed").value;
  };
  $("#speech-generate").onclick = guard(async () => {
    const spec = {
      name: $("#speech-name").value,
      prompt: $("#speech-prompt").value,
      image_id: $("#speech-image").value,
      audio_id: $("#speech-audio").value,
      duration: Number($("#speech-duration").value),
      seed: Number($("#speech-seed").value),
      randomize_seed: $("#auto-speech-seed").checked,
    };
    await api("/api/speech", spec);
    toast(
      "Speech continuation queued. The voice prefix will be trimmed automatically.",
    );
    await refresh();
    $("#modal").close();
  });
}
function showExport() {
  const segs = allSegments();
  const missing = segs.filter((s) => !s.main);
  const shortened = segs.filter(
    (s) =>
      state.assets[s.main] &&
      state.assets[s.main].duration - (s.trim_in || 0) + 0.005 < s.duration,
  );
  const availableDuration = (s) =>
    Math.max(
      0,
      Math.min(
        Math.round(s.duration * 24),
        Math.floor(
          ((state.assets[s.main]?.duration || 0) - (s.trim_in || 0) + 0.005) *
            24,
        ),
      ) / 24,
    );
  modal(
    "Export your film",
    `<p class="speech-intro">${esc(project.name)} · ${segs.length} segments · ${fmt(segs.reduce((n, s) => n + s.duration, 0))}<br>${project.width} × ${project.height} · 24 fps · H.264 with AAC audio</p>${shortened.length ? `<div class="callout">${shortened.length} selected takes are shorter than their timeline segments. Export uses available footage after each in-point, without padding. Estimated export: ${fmt(segs.reduce((n, s) => n + availableDuration(s), 0))}.</div>` : ""}${missing.length ? `<div class="callout">${missing.length} segments need a main video before export: ${missing.map((s) => esc(s.name)).join(", ")}</div>` : ""}<div class="export-options"><button class="export-option" data-export="video"><span class="large-icon">▻</span><b>Finished video</b><p>One MP4, all scenes and shots in timeline order. Context is already trimmed.</p></button><button class="export-option" data-export="clips"><span class="large-icon">▤</span><b>Individual clips</b><p>A ZIP of trimmed, numbered MP4 clips with a scene and prompt manifest.</p></button></div><p class="hint" style="margin-top:20px">Clips are normalized to the project resolution and frame rate. Source in points and timeline lengths are respected. Shorter takes export their available footage. Missing media or in-points beyond the end still need correction.</p>`,
  );
  $$("[data-export]").forEach(
    (b) =>
      (b.onclick = guard(async () => {
        await syncRecovery();
        await api("/api/export", {
          project_id: project.id,
          mode: b.dataset.export,
        });
        await refresh();
        showJobs();
      })),
  );
}
async function showCloudSetup() {
  const config = await api("/api/cloud/config");
  modal(
    "Comfy Cloud inference",
    `<p class="hint">Enable Cloud inference beside Queue selected to send timeline prompts and reference media to your Comfy Cloud account. Cloud credits apply. For a comparison, disable automatic seed randomization and queue the same segment once locally and once with Cloud inference. Turn it off to use your local installation.</p><label class="field"><span>Comfy Cloud API key</span><input id="cloud-key" type="password" autocomplete="off" placeholder="${config.has_api_key ? "Key saved · leave blank to keep" : "Paste your Comfy API key"}"></label><label><input id="cloud-clear" type="checkbox"> Remove saved key</label><p class="hint">The key stays on this editor server and is excluded from library exports. Cloud uses native H3 Add Guide with the previous video’s tail and audio. The overlap prefix is removed automatically. Local generation keeps its saved-latent workflow. Cloud takes retain their videos, not custom H3 latents. Model filenames come from Settings.</p><p><a href="https://platform.comfy.org" target="_blank" rel="noopener">Get a Comfy API key ↗</a></p><p id="cloud-result" class="hint" role="status"></p>`,
    '<button id="cloud-save" class="primary">Save key</button><button id="cloud-test" class="small">Test connection</button>',
  );
  const saveKey = async () => {
    const value = await api(
      "/api/cloud/config",
      { api_key: $("#cloud-key").value, clear_key: $("#cloud-clear").checked },
      "PUT",
    );
    $("#cloud-key").value = "";
    $("#cloud-clear").checked = false;
    $("#cloud-key").placeholder = value.has_api_key
      ? "Key saved · leave blank to keep"
      : "Paste your Comfy API key";
    $("#cloud-result").textContent = value.has_api_key
      ? "Key saved."
      : "Key removed.";
  };
  $("#cloud-save").onclick = guard(saveKey);
  $("#cloud-test").onclick = guard(async () => {
    await saveKey();
    $("#cloud-result").textContent =
      "Checking cloud connection and workflow support…";
    const result = await api("/api/cloud/test", {});
    $("#cloud-result").textContent = result.warning;
  });
}
$("#cloud-setup").onclick = guard(showCloudSetup);
$("#cloud-inference").onchange = guard(async () => {
  if ($("#cloud-inference").checked) {
    const config = await api("/api/cloud/config");
    if (!config.has_api_key) await showCloudSetup();
  }
});

async function queue(ids) {
  await syncRecovery();
  await api("/api/queue", {
    project_id: project.id,
    segment_ids: ids,
    inference: $("#cloud-inference").checked ? "cloud" : "local",
    turbo: $("#turbo").checked,
  });
  toast(`${ids.length} generation${ids.length > 1 ? "s" : ""} queued.`);
  await refresh();
  // The queue badge reflects pending work without interrupting editing.
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const snap = await api("/api/state");
    const oldVersion = project?.version;
    state = snap;
    if (
      project &&
      snap.projects[project.id] &&
      !dirty &&
      !saving &&
      snap.projects[project.id].version !== oldVersion
    ) {
      project = clone(snap.projects[project.id]);
      savedProject = clone(project);
      renderAll();
    }
    renderHeader();
    renderAssets();
    if (modalType === "jobs" && $("#modal").open) {
      $(".modal-body", $("#modal")).innerHTML = jobsHTML();
      bindJobs();
    }
  } finally {
    refreshing = false;
  }
}
async function checkConnection() {
  const c = await api("/api/connection");
  connectionState = c;
  $("#connection").className = "connection" + (c.connected ? " online" : "");
  $("#connection").innerHTML =
    `<i></i> ${c.connected ? "ComfyUI connected" : "ComfyUI offline"}`;
  $("#connection").title = c.connected ? state.settings.comfy_url : c.error;
}
async function importFiles(files) {
  const imported = [];
  for (const file of files) {
    try {
      toast(`Importing ${file.name}…`);
      const form = new FormData();
      form.append("file", file);
      const a = await api("/api/assets", form);
      state.assets[a.id] = a;
      imported.push(a);
      renderAssets();
    } catch (err) {
      toast(file.name + ": " + err.message, true);
    }
  }
  if (imported.length)
    toast(
      `Imported ${imported.length} asset${imported.length === 1 ? "" : "s"}.`,
    );
  return imported;
}
async function dropTimelineFiles(files, targetScene, targetSegment) {
  const ownerId = project.id;
  if (!targetSegment) {
    const videoFiles = files.filter(
      (f) =>
        f.type.startsWith("video/") ||
        /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name),
    );
    if (videoFiles.length !== files.length)
      toast(
        "Only videos create timeline segments. Drop other media onto an existing segment.",
        true,
      );
    files = videoFiles;
  }
  const assets = await importFiles(files);
  const sc = project.scenes.find((x) => x.id === targetScene);
  const seg = sc?.segments.find((x) => x.id === targetSegment);
  if (
    project.id !== ownerId ||
    (targetScene && !sc) ||
    (targetSegment && !seg)
  ) {
    toast(
      "Files imported to the library. The original timeline target changed; drop the assets again.",
      true,
    );
    return;
  }
  for (const a of assets) {
    if (targetSegment) {
      try {
        addReference(a.id, false, sc, seg);
      } catch (err) {
        toast(`${a.name}: ${err.message} Asset kept in the library.`, true);
      }
    } else if (a.kind === "video") addVideoSegment(a.id, targetScene);
  }
}
const timelineDropArea = $("#tracks-scroll");
timelineDropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
});
timelineDropArea.addEventListener(
  "drop",
  guard(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasFiles(e))
      await dropTimelineFiles([...e.dataTransfer.files], sceneId);
    else {
      const aid = e.dataTransfer.getData("application/frameforge-asset");
      if (state.assets[aid]?.kind === "video") addVideoSegment(aid);
      else if (aid)
        toast("Drop images and audio onto a segment to add references.", true);
    }
  }),
);
$("#file-input").onchange = guard(async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  await importFiles(files);
});
const library = $(".library");
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
library.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  library.classList.add("file-drop");
});
library.addEventListener("dragleave", (e) => {
  if (!library.contains(e.relatedTarget)) library.classList.remove("file-drop");
});
library.addEventListener(
  "drop",
  guard(async (e) => {
    library.classList.remove("file-drop");
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    await importFiles([...e.dataTransfer.files]);
  }),
);
// Keep dropped files from replacing the editor with a browser file preview.
window.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (hasFiles(e)) {
    e.preventDefault();
    library.classList.remove("file-drop");
  }
});

function setupPanelResize() {
  const editor = $(".editor");
  let sizes = {};
  try {
    sizes = JSON.parse(localStorage.getItem("frameforge-panel-sizes")) || {};
  } catch {}
  const definitions = [
    [".library", "library", "vertical", 1, 180, 500],
    [".inspector", "inspector", "vertical", -1, 240, 600],
    [".timeline", "timeline", "horizontal", -1, 274, 650],
    [".scene-list", "scenes", "vertical", 1, 120, 360],
    [".inspector", "inspector-height", "horizontal", 1, 200, 900],
  ];
  function apply() {
    const narrow = innerWidth <= 860;
    for (const [selector, key, axis, sign, min, max] of definitions) {
      let value = sizes[key];
      if (!Number.isFinite(value)) continue;
      let limit = max;
      if (key === "library")
        limit = Math.min(
          max,
          editor.clientWidth -
            (narrow ? 300 : $(".inspector").offsetWidth + 340),
        );
      if (key === "inspector")
        limit = Math.min(
          max,
          editor.clientWidth - $(".library").offsetWidth - 340,
        );
      if (key === "timeline" && !narrow)
        limit = Math.min(max, editor.clientHeight - 280);
      editor.style.setProperty(
        `--${key}-size`,
        `${Math.max(min, Math.min(limit, value))}px`,
      );
    }
  }
  for (const [selector, key, axis, sign, min, max] of definitions) {
    const panel = $(selector),
      handle = document.createElement("div");
    handle.className = `panel-divider divider-${key}`;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", axis);
    handle.setAttribute(
      "aria-label",
      `Resize ${key === "scenes" ? "scene list" : key === "inspector-height" ? "properties height" : key} panel`,
    );
    handle.title =
      "Drag to resize · Double-click to reset · Arrow keys to adjust";
    (key === "scenes" ? $(".timeline-body") : panel).append(handle);
    const saveSizes = () => {
      try {
        localStorage.setItem("frameforge-panel-sizes", JSON.stringify(sizes));
      } catch {}
    };
    handle.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const vertical = axis === "vertical";
      const initial = vertical ? panel.offsetWidth : panel.offsetHeight;
      const origin = vertical ? e.clientX : e.clientY;
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("resizing-panels");
      handle.onpointermove = (ev) => {
        sizes[key] = Math.max(
          min,
          Math.min(
            max,
            initial + sign * ((vertical ? ev.clientX : ev.clientY) - origin),
          ),
        );
        apply();
      };
      const finish = () => {
        handle.onpointermove = null;
        document.body.classList.remove("resizing-panels");
        saveSizes();
      };
      handle.onpointerup = finish;
      handle.onpointercancel = finish;
      handle.onlostpointercapture = finish;
    };
    handle.ondblclick = () => {
      delete sizes[key];
      editor.style.removeProperty(`--${key}-size`);
      saveSizes();
    };
    handle.onkeydown = (e) => {
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[
        e.key
      ];
      if (
        !delta ||
        (axis === "vertical"
          ? !["ArrowLeft", "ArrowRight"].includes(e.key)
          : !["ArrowUp", "ArrowDown"].includes(e.key))
      )
        return;
      e.preventDefault();
      sizes[key] = Math.max(
        min,
        Math.min(
          max,
          (axis === "vertical" ? panel.offsetWidth : panel.offsetHeight) +
            delta * sign * 16,
        ),
      );
      apply();
      saveSizes();
    };
  }
  apply();
  window.addEventListener("resize", apply);
}
setupPanelResize();
for (const selector of ["#import-btn", "#empty-import"])
  $(selector).onclick = () => $("#file-input").click();
$("#asset-search").oninput = (e) => {
  search = e.target.value.toLowerCase();
  renderAssets();
};
$("#folder-filter").onchange = (e) => {
  folder = e.target.value;
  renderAssets();
};
$$("[data-kind]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.kind;
      $$("[data-kind]").forEach((x) => x.classList.toggle("active", x === b));
      renderAssets();
    }),
);
$("#settings-btn").onclick = showSettings;
$("#connection").onclick = showSettings;
$("#scene-writer-btn").onclick = guard(() => openSceneWriter());
function openSceneWriter(target = null) {
  return showSceneWriter({
    targetSegment: target ? clone(target) : null,
    targetRefs: target ? orderedReferences(scene(), target).filter(aid => state.assets[aid]?.kind === "image") : [],
    $,
    api,
    esc,
    modal,
    toast,
    save: syncRecovery,
    importFiles,
    getProject: () => project,
    getAssets: () => state.assets,
    onApproved: async (result) => {
      project = clone(result.project);
      savedProject = clone(project);
      state.projects[project.id] = clone(project);
      sceneId = result.scene_id;
      segmentId = result.segment_id || scene().segments[0]?.id;
      selected = new Set(segmentId ? [segmentId] : []);
      dirty = false;
      undo = [];
      redo = [];
      localStorage.removeItem("frameforge-unsaved");
      $("#modal").close();
      renderAll();
    },
  });
}
$("#speech-btn").onclick = showSpeech;
$("#jobs-btn").onclick = showJobs;
$("#export-btn").onclick = showExport;
$("#add-scene").onclick = () =>
  edit(() => {
    const sc = {
      id: id(),
      name: `Scene ${String(project.scenes.length + 1).padStart(2, "0")}`,
      prompt: "",
      refs: [],
      segments: [],
    };
    project.scenes.push(sc);
    sceneId = sc.id;
    const s = newSegment();
    s.connected = false;
    sc.segments.push(s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
$("#add-segment").onclick = addSegment;
$("#queue-selected").onclick = guard(() =>
  queue([...selected].filter((gid) => allSegments().some((s) => s.id === gid))),
);
$("#queue-scene").onclick = guard(() =>
  queue(scene().segments.map((s) => s.id)),
);
$("#main-take").onchange = (e) =>
  edit(() => {
    segment().main = e.target.value || null;
    segment().trim_in = 0;
    if (segment().main)
      segment().duration = state.assets[segment().main].duration;
  });
$("#asset-details").onclick = () => {
  if (segment()?.main) showAsset(segment().main);
};
$("#play").onclick = () => {
  const v = $("#preview");
  if (v.paused) {
    playingSequence = true;
    const s = segment();
    if (v.currentTime >= (s.trim_in || 0) + s.duration - 0.05)
      v.currentTime = s.trim_in || 0;
    v.play().catch((e) => toast(e.message, true));
  } else {
    playingSequence = false;
    v.pause();
  }
  updateTime();
};
$("#prev-segment").onclick = () => advance(-1);
$("#next-segment").onclick = () => advance(1);
$("#preview").ontimeupdate = () => {
  updateTime();
  const s = segment();
  if (
    s &&
    playingSequence &&
    $("#preview").currentTime >= (s.trim_in || 0) + s.duration - 0.025
  ) {
    $("#preview").pause();
    advance(1, true);
  }
};
$("#preview").onended = () => {
  if (playingSequence) advance(1, true);
};
$("#preview").onpause = updateTime;
$("#preview").onplay = updateTime;
$("#scrubber").oninput = (e) => {
  if ($("#preview").dataset.asset)
    $("#preview").currentTime =
      Number(e.target.value) + (segment()?.trim_in || 0);
};
$("#capture-btn").onclick = guard(async () => {
  const s = segment();
  if (!s?.main) return;
  const a = await api(`/api/assets/${s.main}/capture`, {
    time: $("#preview").currentTime,
    name: s.name + " · frame " + Math.round($("#preview").currentTime * 24),
  });
  state.assets[a.id] = a;
  renderAssets();
  toast("Frame saved as an image reference.");
});
function timelineRangeState() {
  const scroll = $("#tracks-scroll");
  const duration = allSegments().reduce((sum, seg) => sum + seg.duration, 0) + 3;
  const start = Math.min(duration, scroll.scrollLeft / zoom);
  return {start, end: Math.min(duration, start + scroll.clientWidth / zoom), duration};
}
function syncTimelineRange() {
  if (!project) return;
  const {start, end, duration} = timelineRangeState();
  const bar = $("#timeline-window");
  bar.style.left = `${start / duration * 100}%`;
  bar.style.width = `${(end - start) / duration * 100}%`;
  bar.setAttribute("aria-valuemin", 0);
  bar.setAttribute("aria-valuemax", duration);
  bar.setAttribute("aria-valuenow", start);
  bar.setAttribute("aria-valuetext", `${fmt(start)} to ${fmt(end)}`);
  for (const grip of $$(".range-grip", bar)) {
    const left = grip.dataset.rangeEdge === "left";
    grip.setAttribute("aria-valuemin", left ? 0 : start);
    grip.setAttribute("aria-valuemax", left ? end : duration);
    grip.setAttribute("aria-valuenow", left ? start : end);
    grip.setAttribute("aria-valuetext", fmt(left ? start : end));
  }
}
function setTimelineRange(range) {
  zoom = $("#tracks-scroll").clientWidth / (range.end - range.start);
  renderTimeline();
  $("#tracks-scroll").scrollLeft = range.start * zoom;
  syncTimelineRange();
}
const rangeBar = $("#timeline-window");
rangeBar.onpointerdown = (event) => {
  if (event.button !== 0 || !project) return;
  event.preventDefault();
  const edge = event.target.closest("[data-range-edge]")?.dataset.rangeEdge || "pan";
  const initial = timelineRangeState();
  const width = $("#timeline-range").clientWidth;
  const minimum = Math.max($("#tracks-scroll").clientWidth / 120, initial.duration * 32 / width);
  const x = event.clientX;
  rangeBar.setPointerCapture(event.pointerId);
  rangeBar.classList.add("dragging");
  const move = e => setTimelineRange(changeTimelineRange(initial.start, initial.end, edge,
    (e.clientX - x) / width * initial.duration, initial.duration, minimum));
  const stop = () => {
    rangeBar.removeEventListener("pointermove", move);
    rangeBar.removeEventListener("lostpointercapture", stop);
    rangeBar.classList.remove("dragging");
  };
  rangeBar.addEventListener("pointermove", move);
  rangeBar.addEventListener("lostpointercapture", stop);
};
rangeBar.onkeydown = event => {
  if (!project || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const current = timelineRangeState();
  const edge = event.target.dataset.rangeEdge || "pan";
  const step = (current.end - current.start) * (event.shiftKey ? .1 : .02);
  setTimelineRange(changeTimelineRange(current.start, current.end, edge,
    event.key === "ArrowLeft" ? -step : step, current.duration,
    Math.max($("#tracks-scroll").clientWidth / 120, current.duration * 32 / $("#timeline-range").clientWidth)));
};
$("#tracks-scroll").addEventListener("scroll", syncTimelineRange);
new ResizeObserver(() => { if (project) { renderTimeline(); } }).observe($("#tracks-scroll"));
function historyStep(forward) {
  const source = forward ? redo : undo,
    target = forward ? undo : redo;
  if (!source.length) return;
  target.push(clone(project));
  const version = project.version;
  project = source.pop();
  project.version = version;
  changed();
}
$("#undo").onclick = () => historyStep(false);
$("#redo").onclick = () => historyStep(true);
$("#project-select").onchange = guard(async (e) => {
  const pid = e.target.value;
  await syncRecovery();
  project = clone(state.projects[pid]);
  savedProject = clone(project);
  sceneId = project.scenes[0]?.id;
  segmentId = scene()?.segments[0]?.id;
  selected = new Set(segmentId ? [segmentId] : []);
  undo = [];
  redo = [];
  localStorage.setItem("frameforge-project", pid);
  renderAll();
  offerRecovery();
});
$("#save-project").onclick = guard(() => manualSave());
$("#save-as-project").onclick = showSaveAs;
$("#manage-projects").onclick = () => {
  modal(
    "Saved projects",
    `<label class="field"><span>Project name</span><input id="rename-project" value="${esc(project.name)}"></label><div class="row"><button id="rename-save" class="small">Rename</button><button id="project-download" class="small">Export project</button><button id="project-import" class="small">Import project</button><button id="project-revert" class="small">Return to saved version</button><button id="project-delete" class="small danger">Delete project</button></div><input id="project-file" type="file" accept=".zip" hidden><p class="hint">Project archives include media, takes, and saved latents. Deleting a project keeps its media in the asset library.</p>`,
  );
  $("#project-revert").onclick = () => { if (hasUnfinalizedChanges()) offerRecovery(); else toast("This project matches its saved version."); };
  $("#rename-save").onclick = guard(async () => {
    edit(() => (project.name = $("#rename-project").value), false);
    await syncRecovery();
    renderHeader();
    toast("Working project renamed. Use Save to finalize it.");
  });
  $("#project-download").onclick = guard(async () => {
    await syncRecovery();
    const a = document.createElement("a");
    a.href = `/api/projects/${project.id}/export`;
    a.download = "frameforge-project.zip";
    a.click();
  });
  $("#project-import").onclick = () => $("#project-file").click();
  const switchTo = async (pid) => {
    state = await api("/api/state");
    project = clone(state.projects[pid] || Object.values(state.projects)[0]);
    savedProject = clone(project);
    sceneId = project.scenes[0]?.id;
    segmentId = scene()?.segments[0]?.id;
    selected = new Set(segmentId ? [segmentId] : []);
    undo = [];
    redo = [];
    dirty = false;
    localStorage.setItem("frameforge-project", project.id);
    $("#modal").close();
    renderAll();
  };
  $("#project-file").onchange = guard(async (e) => {
    if (!e.target.files.length) return;
    await syncRecovery();
    const form = new FormData();
    form.append("file", e.target.files[0]);
    const p = await api("/api/projects/import", form);
    await switchTo(p.id);
    toast("Project imported.");
  });
  $("#project-delete").onclick = guard(async () => {
    if (
      !confirm(
        `Delete project “${project.name}”? Export it first if you need a backup. Media stays in the library.`,
      )
    )
      return;
    await syncRecovery();
    await api(`/api/projects/${project.id}`, {}, "DELETE");
    await switchTo(null);
    toast("Project deleted.");
  });
};
$("#new-project").onclick = guard(async () => {
  await syncRecovery();
  const p = await api("/api/projects", {
    name: "Untitled film " + (Object.keys(state.projects).length + 1),
  });
  state.projects[p.id] = p;
  state.saved_projects ||= {};
  state.saved_projects[p.id] = clone(p);
  project = clone(p);
  savedProject = clone(project);
  sceneId = p.scenes[0].id;
  segmentId = scene().segments[0].id;
  selected = new Set([segmentId]);
  undo = [];
  redo = [];
  renderAll();
});
$("#modal").addEventListener("close", () => (modalType = ""));
$("#modal").onclick = (e) => {
  if (e.target === $("#modal")) $("#modal").close();
};
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("#modal").open) {
    e.preventDefault();
    if (e.shiftKey) showSaveAs(); else guard(manualSave)();
    return;
  }
  if (e.target.matches("input,textarea,select") || $("#modal").open) return;
  if (e.code === "Space") {
    e.preventDefault();
    $("#play").click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    historyStep(e.shiftKey);
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty || saving) {
    e.preventDefault();
    e.returnValue = "";
  }
});
await guard(async () => {
  state = await api("/api/state");
  const pid = localStorage.getItem("frameforge-project");
  project = clone(state.projects[pid] || Object.values(state.projects)[0]);
  savedProject = clone(project);
  const unsaved = localStorage.getItem("frameforge-unsaved");
  if (unsaved) {
    try {
      const draft = JSON.parse(unsaved);
      if (state.projects[draft.id]) {
        project = draft;
        savedProject = clone(state.projects[draft.id]);
        dirty = true;
        toast(
          "Unfinished edits recovered. Use Save when you are ready to finalize them.",
        );
      }
    } catch {}
  }
  sceneId = project.scenes[0]?.id;
  segmentId = scene()?.segments[0]?.id;
  selected = new Set(segmentId ? [segmentId] : []);
  renderAll();
  if (!state.media_available)
    toast(
      "Install the media dependencies to import, trim, and export audio/video.",
      true,
    );
  offerRecovery();
  guard(checkConnection)();
  setInterval(() => guard(refresh)(), 3000);
  setInterval(() => guard(checkConnection)(), 15000);
})();
