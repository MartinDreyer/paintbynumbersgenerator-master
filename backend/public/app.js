(function () {
  let selectedObjectNumber = null;
  let currentGenerationId = null;

  const els = {
    q: document.getElementById("q"),
    searchBtn: document.getElementById("searchBtn"),
    randomBtn: document.getElementById("randomBtn"),
    results: document.getElementById("results"),
    selectedArtwork: document.getElementById("selectedArtwork"),
    generateBtn: document.getElementById("generateBtn"),
    genStatus: document.getElementById("genStatus"),
    svgPreview: document.getElementById("svgPreview"),
    paletteSwatches: document.getElementById("paletteSwatches"),
    publishBtn: document.getElementById("publishBtn"),
    pubStatus: document.getElementById("pubStatus"),
    status: document.getElementById("status"),
    cadence: document.getElementById("cadence"),
    activeFrom: document.getElementById("activeFrom"),
    activeUntil: document.getElementById("activeUntil"),
    scheduleBody: document.querySelector("#scheduleTable tbody"),
    paintingsBody: document.querySelector("#paintingsTable tbody"),
    unscheduledBody: document.querySelector("#unscheduledTable tbody"),
    dailyRunBtn: document.getElementById("dailyRunBtn"),
    dailyStatus: document.getElementById("dailyStatus"),
    cfgEnabled: document.getElementById("cfgEnabled"),
    cfgCadenceDays: document.getElementById("cfgCadenceDays"),
    cfgNrOfColors: document.getElementById("cfgNrOfColors"),
    cfgMaxFacets: document.getElementById("cfgMaxFacets"),
    cfgMinFacetSize: document.getElementById("cfgMinFacetSize"),
    cfgMaxRegionsPerColor: document.getElementById("cfgMaxRegionsPerColor"),
    cfgSaveBtn: document.getElementById("cfgSaveBtn"),
    cfgStatus: document.getElementById("cfgStatus"),
  };

  function renderResults(items) {
    els.results.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.className = "card";
      li.innerHTML = `
        <img src="${item.thumbnailUrl || item.imageUrl}" alt="" loading="lazy" />
        <div class="meta">
          <div class="title">${item.title}</div>
          <div class="artist">${item.artist || "Unknown artist"} ${item.productionDate ? "· " + item.productionDate : ""}</div>
          <span class="badge ${item.alreadyUsed ? "used" : ""}">${item.alreadyUsed ? "already used" : item.objectNumber}</span>
        </div>`;
      li.addEventListener("click", () => selectArtwork(item));
      els.results.appendChild(li);
    }
  }

  async function search() {
    els.results.innerHTML = '<li class="muted">Searching…</li>';
    const params = new URLSearchParams({ q: els.q.value, rows: "24" });
    const res = await fetch(`/api/smk/search?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      els.results.innerHTML = `<li class="muted">${data.error}</li>`;
      return;
    }
    renderResults(data.items);
  }

  async function randomSuggestions() {
    els.results.innerHTML = '<li class="muted">Picking random unused paintings…</li>';
    const res = await fetch("/api/smk/random?count=12");
    const data = await res.json();
    if (data.error) {
      els.results.innerHTML = `<li class="muted">${data.error}</li>`;
      return;
    }
    renderResults(data.items);
  }

  function selectArtwork(item) {
    selectedObjectNumber = item.objectNumber;
    els.selectedArtwork.innerHTML = `<strong>${item.title}</strong><br/>${item.artist || "Unknown artist"} — ${item.objectNumber}${item.alreadyUsed ? " (already used)" : ""}`;
    els.generateBtn.disabled = false;
    els.publishBtn.disabled = true;
    els.svgPreview.innerHTML = "";
    els.paletteSwatches.innerHTML = "";
    currentGenerationId = null;
  }

  async function generate() {
    if (!selectedObjectNumber) return;
    els.generateBtn.disabled = true;
    els.genStatus.textContent = "Generating (this can take a while for larger images)…";
    els.svgPreview.innerHTML = "";
    els.paletteSwatches.innerHTML = "";

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectNumber: selectedObjectNumber,
          settings: {
            kMeansNrOfClusters: Number(document.getElementById("nrColors").value),
            maximumNumberOfFacets: Number(document.getElementById("maxFacets").value),
            removeFacetsSmallerThanNrOfPoints: Number(document.getElementById("minFacetSize").value),
            maxFacetsPerColor: Number(document.getElementById("maxRegionsPerColor").value),
          },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      currentGenerationId = data.generationId;
      els.svgPreview.innerHTML = data.svg;
      els.paletteSwatches.innerHTML = "";
      for (const p of data.palette) {
        const sw = document.createElement("div");
        sw.className = "swatch";
        sw.title = `#${p.index} — ${(p.areaPercentage * 100).toFixed(1)}%`;
        sw.style.background = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        els.paletteSwatches.appendChild(sw);
      }
      els.genStatus.textContent = `Generated: ${data.width}×${data.height}, ${data.palette.length} colors.`;
      els.publishBtn.disabled = false;
    } catch (err) {
      els.genStatus.textContent = `Error: ${err.message}`;
    } finally {
      els.generateBtn.disabled = false;
    }
  }

  async function publish() {
    if (!currentGenerationId) return;
    els.publishBtn.disabled = true;
    els.pubStatus.textContent = "Publishing…";
    try {
      const body = {
        generationId: currentGenerationId,
        status: els.status.value,
      };
      if (els.status.value === "published" && els.activeFrom.value && els.activeUntil.value) {
        body.cadence = els.cadence.value;
        body.activeFrom = new Date(els.activeFrom.value).toISOString();
        body.activeUntil = new Date(els.activeUntil.value).toISOString();
      }
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      els.pubStatus.textContent = `Published puzzle ${data.puzzleId}.`;
      currentGenerationId = null;
      loadOverview();
    } catch (err) {
      els.pubStatus.textContent = `Error: ${err.message}`;
    } finally {
      els.publishBtn.disabled = false;
    }
  }

  // Unambiguous date/time: "Mon, 14 Sep 2026, 09:57" — no locale-dependent dot/slash
  // separators that can be misread as a second date (that's what the default
  // toLocaleString() was doing before, and it's exactly what caused the confusion).
  function formatDateTime(iso) {
    return new Date(iso).toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function scheduleRowStatus(row, now) {
    const from = new Date(row.active_from);
    const until = new Date(row.active_until);
    if (now < from) return { key: "upcoming", label: "Upcoming" };
    if (now <= until) return { key: "active", label: "● Active now" };
    return { key: "past", label: "Past" };
  }

  async function loadOverview() {
    const res = await fetch("/api/overview");
    const data = await res.json();
    if (data.error) {
      els.scheduleBody.innerHTML = `<tr><td colspan="4" class="muted">${data.error}</td></tr>`;
      return;
    }

    const now = data.now ? new Date(data.now) : new Date();

    // Rotation schedule: newest first (server already orders it that way), each row
    // tagged past/active/upcoming relative to now so it's obvious at a glance what end
    // users are actually seeing right now, instead of a flat undifferentiated list.
    els.scheduleBody.innerHTML = "";
    const scheduleRows = Array.isArray(data.schedule) ? data.schedule : [];
    if (!scheduleRows.length) {
      els.scheduleBody.innerHTML = '<tr><td colspan="4" class="muted">Nothing scheduled yet.</td></tr>';
    }
    for (const row of scheduleRows) {
      const tr = document.createElement("tr");
      const painting = row.puzzles?.paintings;
      const status = scheduleRowStatus(row, now);
      if (status.key === "active") tr.className = "activeRow";
      tr.innerHTML = `<td>${painting ? painting.title : "?"}</td><td>${formatDateTime(row.active_from)}</td><td>${formatDateTime(row.active_until)}</td><td><span class="statusPill ${status.key}">${status.label}</span></td>`;
      els.scheduleBody.appendChild(tr);
    }

    // Prepared but not scheduled — puzzles nobody has seen yet.
    els.unscheduledBody.innerHTML = "";
    const unscheduled = Array.isArray(data.unscheduled) ? data.unscheduled : [];
    if (!unscheduled.length) {
      els.unscheduledBody.innerHTML = '<tr><td colspan="3" class="muted">None — everything generated so far has been scheduled.</td></tr>';
    }
    for (const puzzle of unscheduled) {
      const painting = puzzle.paintings;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${painting ? painting.title : "?"}</td><td><span class="statusPill draft">${puzzle.status}</span></td><td>${formatDateTime(puzzle.created_at)}</td>`;
      els.unscheduledBody.appendChild(tr);
    }

    // Every painting pulled from SMK, with its used/available status.
    els.paintingsBody.innerHTML = "";
    const paintings = Array.isArray(data.paintings) ? data.paintings : [];
    if (!paintings.length) {
      els.paintingsBody.innerHTML = '<tr><td colspan="3" class="muted">No paintings pulled yet.</td></tr>';
    }
    for (const painting of paintings) {
      const used = !!painting.used_at;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${painting.title}</td><td>${formatDateTime(painting.fetched_at)}</td><td><span class="statusPill ${used ? "usedPill" : "unused"}">${used ? "Used" : "Available"}</span></td>`;
      els.paintingsBody.appendChild(tr);
    }
  }

  async function runDailyNow() {
    els.dailyRunBtn.disabled = true;
    els.dailyStatus.textContent = "Preparing (picking a painting, generating, publishing)…";
    try {
      const res = await fetch("/api/daily/run", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      els.dailyStatus.textContent = `Prepared "${data.artwork.title}" — puzzle ${data.puzzleId}, live ${formatDateTime(data.activeFrom)} → ${formatDateTime(data.activeUntil)}.`;
      loadOverview();
    } catch (err) {
      els.dailyStatus.textContent = `Error: ${err.message}`;
    } finally {
      els.dailyRunBtn.disabled = false;
    }
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (cfg.error) {
      els.cfgStatus.textContent = `Error: ${cfg.error}`;
      return;
    }
    els.cfgEnabled.checked = !!cfg.enabled;
    els.cfgCadenceDays.value = cfg.cadenceDays;
    els.cfgNrOfColors.value = cfg.nrOfColors;
    els.cfgMaxFacets.value = cfg.maxFacets;
    els.cfgMinFacetSize.value = cfg.minFacetSize;
    els.cfgMaxRegionsPerColor.value = cfg.maxRegionsPerColor;
  }

  async function saveConfig() {
    els.cfgSaveBtn.disabled = true;
    els.cfgStatus.textContent = "Saving…";
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: els.cfgEnabled.checked,
          cadenceDays: Number(els.cfgCadenceDays.value),
          nrOfColors: Number(els.cfgNrOfColors.value),
          maxFacets: Number(els.cfgMaxFacets.value),
          minFacetSize: Number(els.cfgMinFacetSize.value),
          maxRegionsPerColor: Number(els.cfgMaxRegionsPerColor.value),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      els.cfgStatus.textContent = "Saved.";
    } catch (err) {
      els.cfgStatus.textContent = `Error: ${err.message}`;
    } finally {
      els.cfgSaveBtn.disabled = false;
    }
  }

  els.searchBtn.addEventListener("click", search);
  els.q.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  els.randomBtn.addEventListener("click", randomSuggestions);
  els.generateBtn.addEventListener("click", generate);
  els.publishBtn.addEventListener("click", publish);
  els.dailyRunBtn.addEventListener("click", runDailyNow);
  els.cfgSaveBtn.addEventListener("click", saveConfig);

  search();
  loadOverview();
  loadConfig();
})();
