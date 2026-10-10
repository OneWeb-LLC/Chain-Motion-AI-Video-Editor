const drafts = new Map();

export async function showSceneWriter(ctx) {
  const {
    $,
    api,
    esc,
    modal,
    toast,
    save,
    getProject,
    onApproved,
    importFiles,
  } = ctx;
  const pid = getProject().id;
  const target = ctx.targetSegment;
  const draftKey = target ? `${pid}:segment:${target.id}` : pid;
  let d = drafts.get(draftKey);
  if (!d) {
    try {
      d = JSON.parse(localStorage.getItem("frameforge-writer-" + draftKey));
    } catch {}
    d = {
      name: "New scene",
      request: "",
      script: "",
      refs: [],
      duration: 8,
      overlap: 22,
      connected: true,
      character_sheet: "",
      carryover: "",
      ...(target ? {name: target.name, request: target.prompt || "", refs: [...ctx.targetRefs], duration: target.duration, overlap: target.overlap, connected: false} : {}),
      ...d,
      running: false,
    };
    drafts.set(draftKey, d);
  }
  const persist = () => {
    try {
      localStorage.setItem(
        "frameforge-writer-" + draftKey,
        JSON.stringify({ ...d, running: false }),
      );
    } catch {}
  };
  const config = await api("/api/scene-writer/config");
  modal(
    target ? "Scene writer · " + target.name : "Scene writer",
    `
    ${target ? `<p class="hint">Approval replaces the prompt and image references in <b>${esc(target.name)}</b>. Its duration, takes, audio/video references and motion links stay unchanged.</p>` : ""}
    <details class="writer-endpoint" ${config.endpoint ? "" : "open"}><summary>Language model connection</summary>
      <label class="field"><span>OpenAI-compatible endpoint</span><input id="writer-endpoint" placeholder="http://localhost:1234/v1" value="${esc(config.endpoint)}"></label>
      <label class="field"><span>Model name</span><input id="writer-model" placeholder="Your text or vision model" value="${esc(config.model)}"></label>
      <label class="field"><span>Output token limit · optional</span><input id="writer-token-limit" type="number" min="1" max="1000000" step="1" placeholder="Server default / no app-imposed limit" value="${esc(config.max_tokens ?? "")}"></label><p class="hint">Leave blank to use your server’s response-length setting. The model’s context window still applies.</p><label class="field"><span>API key · optional for local servers</span><input id="writer-key" type="password" autocomplete="off" placeholder="${config.has_api_key ? "Saved key · leave blank to keep" : "No key saved"}"></label>
      <label class="check"><input type="checkbox" id="writer-clear-key"> Remove saved key</label>
      <div class="row"><button id="writer-discover" class="small">Discover models</button><button id="writer-save-config" class="small">Save connection</button></div>
      <p id="writer-discovery-status" class="hint" role="status">Enter an endpoint, then discover its available models.</p>
      <label id="writer-model-list-field" class="field" hidden><span>Available models</span><select id="writer-model-list"><option value="">Select a model…</option></select></label>
      <p class="hint">Your scene description and selected images are sent to this endpoint. Image references require a vision-capable model. Keys are stored only on the editor host and excluded from library exports.</p>
    </details>
    <label class="field" ${target ? "hidden" : ""}><span>Scene name</span><input id="writer-name" value="${esc(d.name)}"></label>
    <label class="field"><span>${target ? "What happens in this segment?" : "What happens in this scene?"}</span><textarea id="writer-request" rows="4" placeholder="Describe the action, characters, mood, and dialogue. Ask for a shot count if you want more than 1–4 shots.">${esc(d.request)}</textarea></label>
    <div class="section-heading"><h3>Reference images <span id="writer-ref-count"></span></h3><button id="writer-import" class="small">＋ Import images</button></div>
    <input id="writer-files" type="file" accept="image/*" multiple hidden>
    <div id="writer-images" class="writer-images"></div>
    <p class="hint">${target ? "Up to 9 images, used to replace this segment’s image references on approval. Shared scene references still apply." : "Up to 9 images, copied to each segment and individually editable after approval."}</p>
    <details><summary>Character sheet and continuity</summary>
      <label class="field"><span>Character sheet · optional</span><textarea id="writer-character-sheet" rows="3">${esc(d.character_sheet)}</textarea></label>
      <label class="field"><span>Carryover from an earlier scene · optional</span><textarea id="writer-carryover" rows="3">${esc(d.carryover)}</textarea></label>
      <button id="writer-use-carryover" class="small">Use last scene’s continuity</button>
    </details>
    <button id="writer-generate" class="primary">${d.running ? "Writing script…" : "✦ Write script candidate"}</button>
    <p id="writer-status" role="status" class="hint">${d.running ? "Waiting for the language model. You can close this panel and reopen it." : "No timeline changes happen until you approve a script."}</p>
    <label class="field"><span>Script candidate · edit or paste a SceneCreator script</span><textarea id="writer-script" rows="12" spellcheck="false">${esc(d.script)}</textarea></label>
    <button id="writer-validate" class="small">Check required sections & preview</button>
    <div id="writer-preview" class="writer-preview"></div>
    <div class="row" ${target ? 'style="display:none"' : ""}><label class="field"><span>Seconds per shot</span><input id="writer-duration" type="number" min="0.25" max="120" step="0.25" value="${d.duration}"></label>
    <label class="field"><span>Context overlap</span><select id="writer-overlap">${[22, 39, 56].map((n) => `<option value="${n}" ${Number(d.overlap) === n ? "selected" : ""}>${n} frames</option>`).join("")}</select></label></div>
    <label class="check" ${target ? 'style="display:none"' : ""}><input id="writer-connected" type="checkbox" ${d.connected ? "checked" : ""}> Connect shots for latent motion continuation</label>
    <p class="hint" ${target ? "hidden" : ""}>Numbered SEGMENT blocks become timeline segments, each with the guide’s six full-reference sections. Internal [Shot N] labels describe cuts within that segment. The final segment is saved as carryover context. Legacy SceneCreator scripts are still accepted. Approval creates segments; video generation is queued from the timeline.</p>
  `,
    `<button id="writer-approve" class="primary" disabled>${target ? "Approve & update segment" : "Approve script & create scene"}</button>`,
    "SCENECREATOR / SCRIPT TO TIMELINE",
  );
  const root = $("#modal-content");
  const live = () => root.contains(status);
  const status = $("#writer-status");
  const scriptInput = $("#writer-script");
  const approve = $("#writer-approve");
  const generate = $("#writer-generate");
  const preview = $("#writer-preview");
  let parsedText = null;
  const invalidate = () => {
    parsedText = null;
    approve.disabled = true;
    preview.innerHTML = "";
    d.approval_id = null;
  };
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.className = "hint" + (error ? " danger" : "");
  };
  const handle =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        if (live()) setStatus(e.message, true);
        else toast(e.message, true);
      }
    };
  for (const [key, selector] of Object.entries({
    name: "#writer-name",
    request: "#writer-request",
    script: "#writer-script",
    character_sheet: "#writer-character-sheet",
    carryover: "#writer-carryover",
    duration: "#writer-duration",
    overlap: "#writer-overlap",
    connected: "#writer-connected",
  })) {
    $(selector).addEventListener("input", (e) => {
      d[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (key === "script") invalidate();
      persist();
    });
  }
  const discoveryStatus = $("#writer-discovery-status");
  const modelList = $("#writer-model-list");
  const modelListField = $("#writer-model-list-field");
  let discoveryRevision = 0;
  const connectionInput = () => ({
    endpoint: $("#writer-endpoint").value,
    api_key: $("#writer-key").value,
    clear_api_key: $("#writer-clear-key").checked,
  });
  for (const selector of [
    "#writer-endpoint",
    "#writer-key",
    "#writer-clear-key",
  ]) {
    $(selector).addEventListener("input", () => {
      discoveryRevision++;
      modelListField.hidden = true;
      discoveryStatus.textContent =
        "Connection changed. Discover models again to refresh the list.";
    });
  }
  modelList.onchange = () => {
    if (modelList.value) $("#writer-model").value = modelList.value;
  };
  $("#writer-discover").onclick = async () => {
    const button = $("#writer-discover"),
      revision = discoveryRevision;
    button.disabled = true;
    modelListField.hidden = true;
    discoveryStatus.textContent = "Discovering models…";
    try {
      const result = await api("/api/scene-writer/models", connectionInput());
      if (!live() || revision !== discoveryRevision) return;
      modelList.innerHTML =
        '<option value="">Select a model…</option>' +
        result.models
          .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
          .join("");
      const current = $("#writer-model").value;
      if (result.models.includes(current)) modelList.value = current;
      modelListField.hidden = !result.models.length;
      discoveryStatus.textContent = result.models.length
        ? `${result.models.length} models found. Select one below, or enter its name manually. This list does not guarantee image-input support.`
        : "The endpoint returned no models. Load a model on the server or enter its name manually.";
    } catch (e) {
      if (live() && revision === discoveryRevision)
        discoveryStatus.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
  const saveConfig = async () => {
    const saved = await api(
      "/api/scene-writer/config",
      {
        endpoint: $("#writer-endpoint").value,
        model: $("#writer-model").value,
        max_tokens: $("#writer-token-limit").value.trim()
          ? Number($("#writer-token-limit").value)
          : null,
        api_key: $("#writer-key").value,
        clear_api_key: $("#writer-clear-key").checked,
      },
      "PUT",
    );
    $("#writer-key").value = "";
    $("#writer-key").placeholder = saved.has_api_key
      ? "Saved key · leave blank to keep"
      : "No key saved";
    $("#writer-clear-key").checked = false;
    return saved;
  };
  $("#writer-save-config").onclick = handle(async () => {
    await saveConfig();
    setStatus("Connection settings saved.");
  });
  function renderImages() {
    const assets = ctx.getAssets();
    d.refs = d.refs.filter((aid) => assets[aid]?.kind === "image");
    $("#writer-ref-count").textContent = `${d.refs.length}/9`;
    $("#writer-images").innerHTML =
      Object.values(assets)
        .filter((a) => a.kind === "image")
        .map(
          (a) =>
            `<label class="writer-image"><input data-writer-image="${a.id}" type="checkbox" ${d.refs.includes(a.id) ? "checked" : ""}><img src="/api/assets/${a.id}/file?thumbnail=true" alt="${esc(a.name)}"><span>${esc(a.name)}</span></label>`,
        )
        .join("") ||
      '<p class="hint">Import images or write a scene without references.</p>';
    root.querySelectorAll("[data-writer-image]").forEach((el) => {
      el.onchange = () => {
        if (el.checked && d.refs.length >= 9) {
          el.checked = false;
          setStatus("Choose up to 9 images.", true);
          return;
        }
        d.refs = el.checked
          ? [...d.refs, el.dataset.writerImage]
          : d.refs.filter((x) => x !== el.dataset.writerImage);
        $("#writer-ref-count").textContent = `${d.refs.length}/9`;
        persist();
      };
    });
  }
  renderImages();
  $("#writer-import").onclick = () => $("#writer-files").click();
  $("#writer-files").onchange = handle(async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    const imported = await importFiles(files);
    d.refs = [
      ...new Set([
        ...d.refs,
        ...imported.filter((a) => a.kind === "image").map((a) => a.id),
      ]),
    ].slice(0, 9);
    persist();
    if (live()) renderImages();
  });
  $("#writer-use-carryover").onclick = () => {
    const prior = [...getProject().scenes]
      .reverse()
      .find((sc) => sc.writer?.carryover);
    if (!prior) {
      setStatus(
        "No approved SceneCreator continuity is available in this project.",
        true,
      );
      return;
    }
    d.carryover = prior.writer.carryover;
    $("#writer-carryover").value = d.carryover;
    persist();
  };
  const renderParsed = (parsed) => {
    parsedText = d.script;
    preview.innerHTML =
      `<p>${target ? "Prompt ready to apply to this segment." : `${parsed.shot_count} segments ready for review.`}</p>` +
      parsed.shots
        .map(
          (s) =>
            `<details><summary>Shot ${s.number}</summary><pre>${esc(s.prompt)}</pre></details>`,
        )
        .join("");
    approve.disabled = false;
    setStatus(
      [
        ...(parsed.warnings || []),
        target ? "All six sections are present. Approve to apply this candidate to the selected segment." : "All six sections are present in each prompt. Review, then approve to create the scene.",
      ].join(" "),
    );
  };
  $("#writer-validate").onclick = handle(async () => {
    const text = d.script;
    invalidate();
    const parsed = await api("/api/scene-writer/parse", { script: text });
    if (live() && d.script === text) renderParsed(parsed);
  });
  generate.disabled = d.running;
  generate.onclick = handle(async () => {
    if (d.running) return;
    await saveConfig();
    const request = {
      project_id: pid,
      ...(target ? {segment_id: target.id} : {}),
      request: d.request,
      duration: Number(d.duration),
      refs: [...d.refs],
      character_sheet: d.character_sheet,
      carryover: d.carryover,
    };
    d.running = true;
    generate.disabled = true;
    generate.textContent = "Writing script…";
    setStatus("Writing a candidate. This may take a few minutes.");
    invalidate();
    scriptInput.disabled = true;
    try {
      const result = await api("/api/scene-writer/generate", request);
      d.script = result.script;
      d.refs = result.refs;
      persist();
      if (live()) {
        scriptInput.value = d.script;
        renderImages();
        if (result.parsed) renderParsed(result.parsed);
        else
          setStatus(
            result.parse_error + " Edit the candidate and validate again.",
            true,
          );
      } else
        toast(
          "Scene script candidate is ready. Reopen Scene writer to review it.",
        );
    } finally {
      d.running = false;
      persist();
      if (live()) {
        generate.disabled = false;
        generate.textContent = "✦ Write script candidate";
        scriptInput.disabled = false;
      }
    }
  });
  approve.onclick = handle(async () => {
    if (d.script !== parsedText)
      throw Error("Validate the current script before approving.");
    if (getProject().id !== pid)
      throw Error("Return to the project where this candidate was created.");
    approve.disabled = true;
    try {
      await save();
      d.approval_id ||= Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      persist();
      const result = await api("/api/scene-writer/approve", {
        project_id: pid,
      ...(target ? {segment_id: target.id} : {}),
        version: getProject().version,
        approval_id: d.approval_id,
        script: d.script,
        name: d.name,
        refs: d.refs,
        duration: Number(d.duration),
        overlap: Number(d.overlap),
        connected: d.connected,
      });
      d.approval_id = null;
      persist();
      await onApproved(result);
      toast(
        target ? "Segment prompt and image references updated." : "Scene created with " +
          result.project.scenes.find((s) => s.id === result.scene_id).segments
            .length +
          " populated segments.",
      );
    } finally {
      if (live()) approve.disabled = false;
    }
  });
}
