(function () {
  let selectedObjectNumber = null;
  let currentGenerationId = null;

  const els = {
    q: document.getElementById("q"),
    searchBtn: document.getElementById("searchBtn"),
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
  };

  async function search() {
    els.results.innerHTML = '<li class="muted">Searching…</li>';
    const params = new URLSearchParams({ q: els.q.value, rows: "24" });
    const res = await fetch(`/api/smk/search?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      els.results.innerHTML = `<li class="muted">${data.error}</li>`;
      return;
    }
    els.results.innerHTML = "";
    for (const item of data.items) {
      const li = document.createElement("li");
      li.className = "card";
      li.innerHTML = `
        <img src="${item.imageUrl}" alt="" loading="lazy" />
        <div class="meta">
          <div class="title">${item.title}</div>
          <div class="artist">${item.artist || "Unknown artist"} ${item.productionDate ? "· " + item.productionDate : ""}</div>
          <span class="badge ${item.alreadyUsed ? "used" : ""}">${item.alreadyUsed ? "already used" : item.objectNumber}</span>
        </div>`;
      li.addEventListener("click", () => selectArtwork(item));
      els.results.appendChild(li);
    }
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
      loadSchedule();
    } catch (err) {
      els.pubStatus.textContent = `Error: ${err.message}`;
    } finally {
      els.publishBtn.disabled = false;
    }
  }

  async function loadSchedule() {
    const res = await fetch("/api/schedule");
    const rows = await res.json();
    els.scheduleBody.innerHTML = "";
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const tr = document.createElement("tr");
      const painting = row.puzzles?.paintings;
      tr.innerHTML = `<td>${painting ? painting.title : "?"}</td><td>${new Date(row.active_from).toLocaleString()}</td><td>${new Date(row.active_until).toLocaleString()}</td>`;
      els.scheduleBody.appendChild(tr);
    }
  }

  els.searchBtn.addEventListener("click", search);
  els.q.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  els.generateBtn.addEventListener("click", generate);
  els.publishBtn.addEventListener("click", publish);

  search();
  loadSchedule();
})();
