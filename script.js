/* GPF Mapas V1.3 GPS corrigido
   - GPS real em GeoPDF
   - Detecta georreferenciamento GPTS/LPTS no PDF
   - Mostra localização se estiver dentro do perímetro do mapa
   - Tenta PDF.js local e, se faltar, tenta CDN quando online
   - Salva PDFs e pontos em IndexedDB
*/

const DB_NAME = "gpf-mapas-db";
const DB_VERSION = 1;
const MAP_STORE = "maps";
const POINT_STORE = "points";
const LOCAL_PDF_JS = "./libs/pdf.min.js";
const LOCAL_PDF_WORKER = "./libs/pdf.worker.min.js";
const CDN_PDF_OPTIONS = [
  {
    label: "PDF.js online",
    script: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
  },
  {
    label: "PDF.js jsDelivr",
    script: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    worker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"
  },
  {
    label: "PDF.js unpkg",
    script: "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
    worker: "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js"
  }
];

const $ = (selector) => document.querySelector(selector);

const ui = {
  homeScreen: $("#homeScreen"),
  mapScreen: $("#mapScreen"),
  pdfInput: $("#pdfInput"),
  refreshMapsBtn: $("#refreshMapsBtn"),
  updateAppBtn: $("#updateAppBtn"),
  mapList: $("#mapList"),
  emptyState: $("#emptyState"),
  connectionStatus: $("#connectionStatus"),
  pdfStatus: $("#pdfStatus"),
  gpsStatus: $("#gpsStatus"),
  toast: $("#toast"),
  viewerNote: $("#viewerNote"),

  currentMapName: $("#currentMapName"),
  pageInfo: $("#pageInfo"),
  backBtn: $("#backBtn"),
  deleteCurrentMapBtn: $("#deleteCurrentMapBtn"),
  prevPageBtn: $("#prevPageBtn"),
  nextPageBtn: $("#nextPageBtn"),
  zoomOutBtn: $("#zoomOutBtn"),
  zoomInBtn: $("#zoomInBtn"),
  zoomLabel: $("#zoomLabel"),
  resetViewBtn: $("#resetViewBtn"),
  newPointBtn: $("#newPointBtn"),
  gpsBtn: $("#gpsBtn"),
  centerGpsBtn: $("#centerGpsBtn"),
  saveGpsPointBtn: $("#saveGpsPointBtn"),
  gpsInfo: $("#gpsInfo"),
  exportPointsBtn: $("#exportPointsBtn"),

  mapWrapper: $("#mapWrapper"),
  mapStage: $("#mapStage"),
  canvas: $("#pdfCanvas"),
  pointsLayer: $("#pointsLayer"),
  gpsLayer: $("#gpsLayer"),
  nativePdfFrame: $("#nativePdfFrame"),
  nativePointsLayer: $("#nativePointsLayer"),

  pointModal: $("#pointModal"),
  pointForm: $("#pointForm"),
  pointName: $("#pointName"),
  pointArea: $("#pointArea"),
  pointNote: $("#pointNote"),
  pointsList: $("#pointsList"),
  emptyPointsState: $("#emptyPointsState"),
};

const ctx = ui.canvas.getContext("2d", { alpha: false });

let db = null;
let currentMap = null;
let pdfDoc = null;
let pageNum = 1;
let renderTask = null;
let pdfJsReady = false;
let viewerMode = "native";
let nativeUrl = null;
let currentPdfViewport = null;

let gpsWatchId = null;
let currentGps = null;
let currentGpsCanvas = null;
let gpsAutoCentered = false;

let zoom = 1;
let translate = { x: 20, y: 20 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let translateStart = { x: 0, y: 0 };
let pendingPoint = null;

init();

async function init() {
  try {
    db = await openDatabase();
    setupEvents();
    updateConnectionStatus();
    await loadLocalPdfJs();
    updateGpsUi("stopped");
    await renderMapList();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    showToast("Erro ao iniciar o app.");
  }
}

async function loadLocalPdfJs() {
  if (window.pdfjsLib) {
    preparePdfJs(LOCAL_PDF_WORKER, "PDF.js pronto");
    return true;
  }

  // 1) Tenta biblioteca local em ./libs/
  try {
    await loadScriptOnce(LOCAL_PDF_JS);
    if (window.pdfjsLib) {
      preparePdfJs(LOCAL_PDF_WORKER, "PDF.js local");
      return true;
    }
  } catch {
    // Continua para opções online
  }

  // 2) Tenta CDNs diferentes. Isso ajuda no celular quando um CDN falha.
  if (navigator.onLine) {
    for (const option of CDN_PDF_OPTIONS) {
      try {
        await loadScriptOnce(option.script);
        if (window.pdfjsLib) {
          preparePdfJs(option.worker, option.label);
          return true;
        }
      } catch {
        // Tenta o próximo CDN
      }
    }
  }

  markPdfJsMissing();
  return false;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === src);
    if (existing) {
      if (window.pdfjsLib) return resolve(true);
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Não carregou ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(true);
    script.onerror = () => {
      script.remove();
      reject(new Error(`Não carregou ${src}`));
    };
    document.head.appendChild(script);
  });
}

function preparePdfJs(workerSrc = LOCAL_PDF_WORKER, label = "PDF.js local") {
  pdfJsReady = true;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  ui.pdfStatus.classList.add("ready");
  ui.pdfStatus.querySelector("span:last-child").textContent = label;
}

function markPdfJsMissing() {
  pdfJsReady = false;
  ui.pdfStatus.classList.remove("ready");
  ui.pdfStatus.querySelector("span:last-child").textContent = "Nativo";
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MAP_STORE)) {
        database.createObjectStore(MAP_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(POINT_STORE)) {
        const store = database.createObjectStore(POINT_STORE, { keyPath: "id" });
        store.createIndex("mapId", "mapId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getOne(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function deleteOne(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function deletePointsByMap(mapId) {
  const points = await getPointsByMap(mapId);
  await Promise.all(points.map((point) => deleteOne(POINT_STORE, point.id)));
}

function getPointsByMap(mapId) {
  return new Promise((resolve, reject) => {
    const index = tx(POINT_STORE).index("mapId");
    const request = index.getAll(mapId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function setupEvents() {
  ui.pdfInput.addEventListener("change", handlePdfImport);
  ui.refreshMapsBtn.addEventListener("click", renderMapList);
  ui.updateAppBtn?.addEventListener("click", clearAppCacheAndReload);

  ui.backBtn.addEventListener("click", () => {
    ui.mapScreen.classList.remove("active");
    ui.homeScreen.classList.add("active");
    cleanupMap();
    renderMapList();
  });

  ui.deleteCurrentMapBtn.addEventListener("click", async () => {
    if (!currentMap) return;
    const ok = confirm(`Excluir o mapa "${currentMap.name}" e os pontos dele?`);
    if (!ok) return;
    await deletePointsByMap(currentMap.id);
    await deleteOne(MAP_STORE, currentMap.id);
    showToast("Mapa excluído.");
    ui.backBtn.click();
  });

  ui.prevPageBtn.addEventListener("click", async () => {
    if (viewerMode !== "pdfjs" || !pdfDoc || pageNum <= 1) return;
    pageNum--;
    resetView();
    await renderCurrentPage();
  });

  ui.nextPageBtn.addEventListener("click", async () => {
    if (viewerMode !== "pdfjs" || !pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    resetView();
    await renderCurrentPage();
  });

  ui.zoomOutBtn.addEventListener("click", () => viewerMode === "pdfjs" && setZoom(zoom - 0.15));
  ui.zoomInBtn.addEventListener("click", () => viewerMode === "pdfjs" && setZoom(zoom + 0.15));
  ui.resetViewBtn.addEventListener("click", () => viewerMode === "pdfjs" ? resetView() : showToast("Use o zoom nativo do navegador."));

  ui.newPointBtn.addEventListener("click", () => {
    if (!currentMap) return;
    pendingPoint = { waiting: true };
    ui.mapWrapper.classList.toggle("placing-native-point", viewerMode === "native");
    showToast("Toque no local do mapa onde deseja criar o ponto.");
  });

  ui.gpsBtn.addEventListener("click", toggleGpsTracking);
  ui.centerGpsBtn.addEventListener("click", () => centerOnCurrentGps());
  ui.saveGpsPointBtn.addEventListener("click", createPointFromGps);

  ui.exportPointsBtn.addEventListener("click", exportCurrentPointsCsv);

  ui.pointForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await savePendingPoint();
  });

  ui.mapWrapper.addEventListener("pointerdown", handlePointerDown);
  ui.mapWrapper.addEventListener("pointermove", handlePointerMove);
  ui.mapWrapper.addEventListener("pointerup", handlePointerUp);
  ui.mapWrapper.addEventListener("pointercancel", handlePointerUp);
  ui.mapWrapper.addEventListener("dblclick", handleDoubleClick);

  ui.mapWrapper.addEventListener("wheel", (event) => {
    if (viewerMode !== "pdfjs") return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.12 : -0.12));
  }, { passive: false });

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
}

async function handlePdfImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("Escolha um arquivo PDF.");
    event.target.value = "";
    return;
  }

  try {
    const data = await file.arrayBuffer();
    const georef = extractGeoPdfViewports(data);
    const map = {
      id: randomId(),
      name: file.name,
      size: file.size,
      type: file.type || "application/pdf",
      createdAt: new Date().toISOString(),
      data,
      georef,
    };
    await put(MAP_STORE, map);
    showToast(georef ? "GeoPDF importado com GPS." : "PDF importado. Sem georreferência detectada.");
    await renderMapList();
  } catch (error) {
    console.error(error);
    showToast("Não foi possível importar o PDF.");
  } finally {
    event.target.value = "";
  }
}

async function renderMapList() {
  const maps = await getAll(MAP_STORE);
  maps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  ui.emptyState.style.display = maps.length ? "none" : "grid";
  ui.mapList.innerHTML = "";

  for (const map of maps) {
    const points = await getPointsByMap(map.id);
    const geoBadge = map.georef?.views?.length
      ? `<span class="geo-badge">GeoPDF • GPS disponível</span>`
      : `<span class="geo-badge">PDF comum</span>`;
    const card = document.createElement("article");
    card.className = "map-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(map.name)}</strong>
        <span>${formatBytes(map.size)} • ${formatDate(map.createdAt)} • ${points.length} ponto(s)</span>
        ${geoBadge}
      </div>
      <div class="card-actions">
        <button class="primary-button" data-action="open">Abrir</button>
        <button class="danger-button" data-action="delete">Excluir</button>
      </div>
    `;

    card.querySelector('[data-action="open"]').addEventListener("click", () => openMap(map.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      const ok = confirm(`Excluir o mapa "${map.name}"?`);
      if (!ok) return;
      await deletePointsByMap(map.id);
      await deleteOne(MAP_STORE, map.id);
      showToast("Mapa excluído.");
      await renderMapList();
    });
    ui.mapList.appendChild(card);
  }
}

async function openMap(mapId) {
  try {
    cleanupMap();
    currentMap = await getOne(MAP_STORE, mapId);
    if (!currentMap) {
      showToast("Mapa não encontrado.");
      return;
    }

    await ensureMapGeoref(currentMap);
    gpsAutoCentered = false;

    ui.currentMapName.textContent = currentMap.name;
    ui.homeScreen.classList.remove("active");
    ui.mapScreen.classList.add("active");

    if (pdfJsReady) {
      await openPdfJsMap();
    } else {
      openNativeMap();
    }

    await renderPointsList();
    updateGpsForCurrentMap(false);
  } catch (error) {
    console.error(error);
    if (currentMap) openNativeMap();
    showToast("PDF.js falhou no celular. Abri pelo visualizador nativo.");
  }
}

async function openPdfJsMap() {
  viewerMode = "pdfjs";
  ui.mapWrapper.classList.remove("native-mode", "placing-native-point");
  ui.viewerNote.textContent = currentMap.georef?.views?.length
    ? `Modo mapa com GPS: GeoPDF detectado (${currentMap.georef.views.length} área(s)). Ative o GPS para localizar sua posição no perímetro.`
    : "Modo PDF.js: este PDF não tem georreferenciamento detectado, então o GPS real não pode ser encaixado no mapa.";
  setPdfControlsEnabled(true);

  const copy = currentMap.data.slice(0);
  pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
  pageNum = 1;
  resetView();
  await renderCurrentPage();
}

function openNativeMap() {
  viewerMode = "native";
  ui.mapWrapper.classList.add("native-mode");
  setPdfControlsEnabled(false);
  ui.viewerNote.innerHTML = currentMap.georef?.views?.length
    ? "<strong>Modo nativo:</strong> GeoPDF detectado, mas o GPS não consegue aparecer sobre o mapa neste modo. Para corrigir, abra online uma vez ou coloque pdf.min.js e pdf.worker.min.js na pasta libs."
    : "<strong>Modo nativo:</strong> o PDF abriu pelo visualizador do celular. Neste modo dá para visualizar, mas o GPS não fica preso no mapa.";
  ui.pageInfo.textContent = "Visualizador nativo do navegador";

  if (nativeUrl) URL.revokeObjectURL(nativeUrl);
  const blob = new Blob([currentMap.data], { type: "application/pdf" });
  nativeUrl = URL.createObjectURL(blob);
  ui.nativePdfFrame.src = nativeUrl;
  renderNativePoints();
}

function setPdfControlsEnabled(enabled) {
  ui.prevPageBtn.disabled = !enabled;
  ui.nextPageBtn.disabled = !enabled;
  ui.zoomOutBtn.disabled = !enabled;
  ui.zoomInBtn.disabled = !enabled;
  ui.resetViewBtn.disabled = false;
  ui.zoomLabel.textContent = enabled ? `${Math.round(zoom * 100)}%` : "Nativo";
}

async function renderCurrentPage() {
  if (!pdfDoc) return;

  try {
    if (renderTask) {
      renderTask.cancel();
      renderTask = null;
    }

    const page = await pdfDoc.getPage(pageNum);
    const wrapperWidth = Math.max(ui.mapWrapper.clientWidth - 40, 320);
    const naturalViewport = page.getViewport({ scale: 1 });

    // Corrigido para celular:
    // antes forçava scale >= 1, gerando canvas muito grande em mapas A0.
    // agora renderiza leve, mas mantém coordenada correta para GPS/pontos.
    const deviceRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    const fitScale = (wrapperWidth / naturalViewport.width) * deviceRatio;
    const baseScale = Math.min(1.35, Math.max(0.25, fitScale));
    const viewport = page.getViewport({ scale: baseScale });
    currentPdfViewport = viewport;

    ui.canvas.width = Math.floor(viewport.width);
    ui.canvas.height = Math.floor(viewport.height);
    ui.canvas.style.width = `${Math.floor(viewport.width)}px`;
    ui.canvas.style.height = `${Math.floor(viewport.height)}px`;
    ui.pointsLayer.style.width = `${Math.floor(viewport.width)}px`;
    ui.pointsLayer.style.height = `${Math.floor(viewport.height)}px`;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

    renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    renderTask = null;

    ui.pageInfo.textContent = `Página ${pageNum} de ${pdfDoc.numPages}`;
    ui.prevPageBtn.disabled = pageNum <= 1;
    ui.nextPageBtn.disabled = pageNum >= pdfDoc.numPages;
    applyTransform();
    await renderPdfJsPoints();
    updateGpsForCurrentMap(false);
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
      showToast("Erro ao renderizar página.");
    }
  }
}

function cleanupMap() {
  currentMap = null;
  pdfDoc = null;
  pageNum = 1;
  pendingPoint = null;
  currentPdfViewport = null;
  currentGpsCanvas = null;
  gpsAutoCentered = false;
  viewerMode = "native";
  ui.mapWrapper.classList.remove("native-mode", "placing-native-point");
  ui.viewerNote.textContent = "";

  if (nativeUrl) {
    URL.revokeObjectURL(nativeUrl);
    nativeUrl = null;
  }
  ui.nativePdfFrame.removeAttribute("src");

  if (renderTask) {
    try { renderTask.cancel(); } catch {}
    renderTask = null;
  }
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  ui.pointsLayer.innerHTML = "";
  ui.gpsLayer.innerHTML = "";
  ui.nativePointsLayer.innerHTML = "";
  ui.pointsList.innerHTML = "";
  resetView();
}

function setZoom(value) {
  zoom = Math.min(3.2, Math.max(0.45, value));
  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  applyTransform();
}

function resetView() {
  zoom = 1;
  translate = { x: 20, y: 20 };
  ui.zoomLabel.textContent = viewerMode === "native" ? "Nativo" : "100%";
  applyTransform();
}

function applyTransform() {
  ui.mapStage.style.transform = `translate(${translate.x}px, ${translate.y}px) scale(${zoom})`;
  updateGpsMarkerScale();
}

function handlePointerDown(event) {
  if (viewerMode === "native") return;
  ui.mapWrapper.setPointerCapture(event.pointerId);
  isDragging = true;
  dragStart = { x: event.clientX, y: event.clientY };
  translateStart = { ...translate };
  ui.mapStage.classList.add("dragging");
}

function handlePointerMove(event) {
  if (!isDragging || viewerMode !== "pdfjs") return;
  translate = {
    x: translateStart.x + event.clientX - dragStart.x,
    y: translateStart.y + event.clientY - dragStart.y,
  };
  applyTransform();
}

function handlePointerUp(event) {
  if (viewerMode === "native") {
    if (pendingPoint?.waiting) placeNativePoint(event);
    return;
  }

  if (!isDragging) return;
  const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
  isDragging = false;
  ui.mapStage.classList.remove("dragging");

  if (pendingPoint?.waiting && moved < 8) {
    const mapPosition = screenToMap(event.clientX, event.clientY);
    if (mapPosition) {
      pendingPoint = { waiting: false, mode: "pdfjs", page: pageNum, x: mapPosition.x, y: mapPosition.y };
      openPointModal();
    }
  }
}

function handleDoubleClick(event) {
  if (viewerMode === "native") {
    placeNativePoint(event);
    return;
  }

  const mapPosition = screenToMap(event.clientX, event.clientY);
  if (!mapPosition) return;
  pendingPoint = { waiting: false, mode: "pdfjs", page: pageNum, x: mapPosition.x, y: mapPosition.y };
  openPointModal();
}

function screenToMap(clientX, clientY) {
  const wrapperRect = ui.mapWrapper.getBoundingClientRect();
  const localX = clientX - wrapperRect.left;
  const localY = clientY - wrapperRect.top;
  const x = (localX - translate.x) / zoom;
  const y = (localY - translate.y) / zoom;

  if (x < 0 || y < 0 || x > ui.canvas.width || y > ui.canvas.height) {
    showToast("Toque dentro do PDF.");
    return null;
  }
  return { x, y };
}

function placeNativePoint(event) {
  if (!pendingPoint?.waiting || viewerMode !== "native") return;
  const rect = ui.mapWrapper.getBoundingClientRect();
  const px = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
  const py = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
  pendingPoint = { waiting: false, mode: "native", page: 1, px, py };
  ui.mapWrapper.classList.remove("placing-native-point");
  openPointModal();
}

function openPointModal() {
  ui.pointName.value = "";
  ui.pointArea.value = "";
  ui.pointNote.value = "";
  ui.pointModal.showModal();
  setTimeout(() => ui.pointName.focus(), 80);
}

async function savePendingPoint() {
  if (!currentMap || !pendingPoint || pendingPoint.waiting) return;

  const name = ui.pointName.value.trim();
  if (!name) {
    showToast("Digite o nome do ponto.");
    return;
  }

  const point = {
    id: randomId(),
    mapId: currentMap.id,
    mapName: currentMap.name,
    name,
    area: ui.pointArea.value.trim(),
    note: ui.pointNote.value.trim(),
    coordMode: pendingPoint.mode,
    page: pendingPoint.page || 1,
    x: pendingPoint.x ?? null,
    y: pendingPoint.y ?? null,
    px: pendingPoint.px ?? null,
    py: pendingPoint.py ?? null,
    lat: pendingPoint.lat ?? null,
    lon: pendingPoint.lon ?? null,
    accuracy: pendingPoint.accuracy ?? null,
    source: pendingPoint.source || "manual",
    createdAt: new Date().toISOString(),
  };

  await put(POINT_STORE, point);
  pendingPoint = null;
  ui.mapWrapper.classList.remove("placing-native-point");
  ui.pointModal.close();
  showToast("Ponto salvo.");
  await renderPdfJsPoints();
  await renderNativePoints();
  await renderPointsList();
}

async function renderPdfJsPoints() {
  ui.pointsLayer.innerHTML = "";
  if (!currentMap || viewerMode !== "pdfjs") return;

  const points = await getPointsByMap(currentMap.id);
  points
    .filter((point) => point.coordMode === "pdfjs" && point.page === pageNum)
    .forEach((point) => {
      const el = document.createElement("button");
      el.className = "map-point";
      el.title = point.name;
      el.style.left = `${point.x}px`;
      el.style.top = `${point.y}px`;
      el.innerHTML = "<span></span>";
      el.addEventListener("click", () => showToast(`${point.name}${point.area ? " • " + point.area : ""}`));
      ui.pointsLayer.appendChild(el);
    });
}

async function renderNativePoints() {
  ui.nativePointsLayer.innerHTML = "";
  if (!currentMap || viewerMode !== "native") return;

  const points = await getPointsByMap(currentMap.id);
  points
    .filter((point) => point.coordMode === "native")
    .forEach((point) => {
      const el = document.createElement("button");
      el.className = "native-map-point";
      el.title = point.name;
      el.style.left = `${point.px}%`;
      el.style.top = `${point.py}%`;
      el.innerHTML = "<span></span>";
      el.addEventListener("click", () => showToast(`${point.name}${point.area ? " • " + point.area : ""}`));
      ui.nativePointsLayer.appendChild(el);
    });
}

async function renderPointsList() {
  if (!currentMap) return;
  const points = await getPointsByMap(currentMap.id);
  points.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  ui.emptyPointsState.style.display = points.length ? "none" : "grid";
  ui.pointsList.innerHTML = "";

  for (const point of points) {
    const label = point.source === "gps"
      ? `GPS • Página ${point.page} • ±${Math.round(point.accuracy || 0)} m`
      : (point.coordMode === "pdfjs" ? `Página ${point.page}` : "Ponto nativo");
    const card = document.createElement("article");
    card.className = "point-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(point.name)}</strong>
        <span>${label}${point.area ? " • " + escapeHtml(point.area) : ""} • ${formatDate(point.createdAt)}${point.note ? "<br>" + escapeHtml(point.note) : ""}</span>
      </div>
      <div class="card-actions">
        <button class="ghost-button" data-action="go">Ir</button>
        <button class="danger-button" data-action="delete">Excluir</button>
      </div>
    `;

    card.querySelector('[data-action="go"]').addEventListener("click", async () => {
      if (viewerMode === "pdfjs" && point.coordMode === "pdfjs") {
        pageNum = point.page;
        await renderCurrentPage();
        translate = { x: ui.mapWrapper.clientWidth / 2 - point.x * zoom, y: ui.mapWrapper.clientHeight / 2 - point.y * zoom };
        applyTransform();
      } else {
        showToast(point.name);
      }
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await deleteOne(POINT_STORE, point.id);
      showToast("Ponto excluído.");
      await renderPdfJsPoints();
      await renderNativePoints();
      await renderPointsList();
    });

    ui.pointsList.appendChild(card);
  }
}

async function exportCurrentPointsCsv() {
  if (!currentMap) return;
  const points = await getPointsByMap(currentMap.id);
  if (!points.length) {
    showToast("Nenhum ponto para exportar.");
    return;
  }

  const rows = [
    ["mapa", "nome", "talhao_area", "modo", "pagina", "x", "y", "px", "py", "latitude", "longitude", "precisao_m", "origem", "observacao", "data_hora"],
    ...points.map((point) => [
      point.mapName, point.name, point.area, point.coordMode, point.page,
      point.x ?? "", point.y ?? "", point.px ?? "", point.py ?? "",
      point.lat ?? "", point.lon ?? "", point.accuracy ?? "", point.source || "manual",
      point.note, point.createdAt,
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(currentMap.name)}-pontos.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV exportado.");
}


/* -----------------------------
   GPS + GeoPDF
------------------------------ */

async function ensureMapGeoref(map) {
  if (map.georef?.views?.length) return map.georef;

  const georef = extractGeoPdfViewports(map.data);
  if (georef?.views?.length) {
    map.georef = georef;
    await put(MAP_STORE, map);
    showToast("GeoPDF detectado neste mapa.");
    return georef;
  }

  map.georef = null;
  return null;
}

function extractGeoPdfViewports(arrayBuffer) {
  try {
    const bytes = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.slice(0);
    const text = new TextDecoder("iso-8859-1").decode(bytes);
    const views = [];

    const regex = /\/BBox\s*\[([^\]]+)\][\s\S]{0,2200}?\/Name\s*\(([\s\S]*?)\)[\s\S]{0,2200}?\/Measure\s*<<[\s\S]{0,2200}?\/Subtype\s*\/GEO[\s\S]{0,2200}?\/GPTS\s*\[([^\]]+)\][\s\S]{0,2200}?\/LPTS\s*\[([^\]]+)\]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const bbox = parseNumberList(match[1]);
      const name = cleanPdfName(match[2]);
      const gpts = parseNumberList(match[3]);
      const lpts = parseNumberList(match[4]);
      const view = buildGeoView({ bbox, name, gpts, lpts, page: 1 });
      if (view) views.push(view);
    }

    // Fallback para PDFs que não trazem /Name perto do /Measure.
    if (!views.length) {
      const regexNoName = /\/BBox\s*\[([^\]]+)\][\s\S]{0,3200}?\/Measure\s*<<[\s\S]{0,3200}?\/Subtype\s*\/GEO[\s\S]{0,3200}?\/GPTS\s*\[([^\]]+)\][\s\S]{0,3200}?\/LPTS\s*\[([^\]]+)\]/g;
      while ((match = regexNoName.exec(text)) !== null) {
        const bbox = parseNumberList(match[1]);
        const gpts = parseNumberList(match[2]);
        const lpts = parseNumberList(match[3]);
        const view = buildGeoView({ bbox, name: "GeoPDF", gpts, lpts, page: 1 });
        if (view) views.push(view);
      }
    }

    if (!views.length) return null;

    views.sort((a, b) => b.area - a.area);
    return {
      type: "geopdf",
      detectedAt: new Date().toISOString(),
      views,
    };
  } catch (error) {
    console.warn("Falha ao detectar GeoPDF:", error);
    return null;
  }
}

function buildGeoView({ bbox, name, gpts, lpts, page }) {
  if (bbox.length < 4 || gpts.length < 8 || lpts.length < 8) return null;

  const src = [
    [gpts[1], gpts[0]],
    [gpts[3], gpts[2]],
    [gpts[5], gpts[4]],
    [gpts[7], gpts[6]],
  ];

  const dst = [
    [lpts[0], lpts[1]],
    [lpts[2], lpts[3]],
    [lpts[4], lpts[5]],
    [lpts[6], lpts[7]],
  ];

  const h = solveHomography(src, dst);
  if (!h) return null;

  const area = Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));

  return {
    name: name || "GeoPDF",
    page,
    bbox: bbox.slice(0, 4),
    gpts: gpts.slice(0, 8),
    lpts: lpts.slice(0, 8),
    h,
    area,
  };
}

function parseNumberList(value) {
  return (String(value).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

function cleanPdfName(value) {
  return String(value || "")
    .replaceAll("\u0000", "")
    .replace(/^þÿ/, "")
    .replace(/[^\wÀ-ÿ\s.-]/g, "")
    .trim();
}

function solveHomography(src, dst) {
  const matrix = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];

    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  const result = gaussianSolve(matrix);
  if (!result) return null;

  return [...result, 1];
}

function gaussianSolve(matrix) {
  const n = 8;
  const a = matrix.map((row) => row.slice());

  for (let col = 0; col < n; col++) {
    let pivot = col;

    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }

    if (Math.abs(a[pivot][col]) < 1e-12) return null;

    [a[col], a[pivot]] = [a[pivot], a[col]];

    const div = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= div;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row[n]);
}

function applyHomography(h, x, y) {
  const den = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;

  return {
    u: (h[0] * x + h[1] * y + h[2]) / den,
    v: (h[3] * x + h[4] * y + h[5]) / den,
  };
}

function toggleGpsTracking() {
  if (gpsWatchId !== null) {
    stopGpsTracking();
  } else {
    startGpsTracking();
  }
}

function startGpsTracking() {
  if (!("geolocation" in navigator)) {
    updateGpsUi("error", "Este navegador não tem suporte a GPS.");
    showToast("GPS não suportado neste navegador.");
    return;
  }

  if (!window.isSecureContext) {
    updateGpsUi("error", "GPS bloqueado: use HTTPS. No celular, evite abrir por file:// ou IP local sem HTTPS.");
    showToast("GPS precisa de HTTPS no celular.");
    return;
  }

  updateGpsUi("waiting", "Buscando GPS real... permita a localização no celular e aguarde alguns segundos.");

  const gpsOptions = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30000,
  };

  // Pega uma posição imediata primeiro. Em alguns celulares o watchPosition demora.
  navigator.geolocation.getCurrentPosition(handleGpsSuccess, handleGpsError, gpsOptions);

  // Depois continua acompanhando a posição.
  gpsWatchId = navigator.geolocation.watchPosition(
    handleGpsSuccess,
    handleGpsError,
    gpsOptions
  );

  ui.gpsBtn.textContent = "Parar GPS";
}

function stopGpsTracking() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  currentGps = null;
  currentGpsCanvas = null;
  gpsAutoCentered = false;
  ui.gpsLayer.innerHTML = "";
  updateGpsUi("stopped", "GPS desligado.");
  ui.gpsBtn.textContent = "Ativar GPS";
  ui.centerGpsBtn.disabled = true;
  ui.saveGpsPointBtn.disabled = true;
}

function handleGpsSuccess(position) {
  currentGps = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    heading: position.coords.heading,
    speed: position.coords.speed,
    timestamp: position.timestamp,
  };

  updateGpsForCurrentMap(true);
}

function handleGpsError(error) {
  const messages = {
    1: "Permissão de GPS negada.",
    2: "Não foi possível obter a posição.",
    3: "Tempo esgotado procurando GPS.",
  };

  updateGpsUi("error", messages[error.code] || "Erro no GPS.");
  showToast(messages[error.code] || "Erro no GPS.");
}

function updateGpsForCurrentMap(allowAutoCenter = false) {
  if (!currentGps) {
    if (gpsWatchId === null) updateGpsUi("stopped");
    return;
  }

  if (!currentMap) {
    updateGpsUi("active", `GPS ativo: ${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`);
    return;
  }

  if (viewerMode !== "pdfjs") {
    updateGpsUi("active", `GPS ativo: ${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m<br><strong>Mas o PDF está em modo nativo.</strong> Reabra com PDF.js para desenhar sua posição dentro do mapa.`);
    ui.centerGpsBtn.disabled = true;
    ui.saveGpsPointBtn.disabled = true;
    return;
  }

  if (!currentMap.georef?.views?.length) {
    ui.gpsLayer.innerHTML = "";
    currentGpsCanvas = null;
    updateGpsUi("outside", "GPS ativo, mas este PDF não tem georreferenciamento detectado.");
    ui.centerGpsBtn.disabled = true;
    ui.saveGpsPointBtn.disabled = true;
    return;
  }

  const location = geoToCanvas(currentGps.lat, currentGps.lon);
  if (!location?.inside) {
    ui.gpsLayer.innerHTML = "";
    currentGpsCanvas = null;
    updateGpsUi("outside", `Fora do perímetro do mapa • ${formatLatLon(currentGps.lat, currentGps.lon)} • ±${Math.round(currentGps.accuracy || 0)} m`);
    ui.centerGpsBtn.disabled = true;
    ui.saveGpsPointBtn.disabled = true;
    return;
  }

  currentGpsCanvas = location;
  renderGpsMarker(location);
  updateGpsUi("inside", `<strong>Dentro do mapa</strong> • ${formatLatLon(currentGps.lat, currentGps.lon)} • precisão ±${Math.round(currentGps.accuracy || 0)} m`);
  ui.centerGpsBtn.disabled = false;
  ui.saveGpsPointBtn.disabled = false;

  if (allowAutoCenter && !gpsAutoCentered) {
    gpsAutoCentered = true;
    centerOnCurrentGps();
  }
}

function geoToCanvas(lat, lon) {
  if (!currentPdfViewport || !currentMap?.georef?.views?.length) return null;

  const candidates = [];

  for (const view of currentMap.georef.views) {
    if (view.page !== pageNum) continue;

    const uv = applyHomography(view.h, lon, lat);
    if (!uv) continue;

    const tolerance = 0.015;
    const inside = uv.u >= -tolerance && uv.u <= 1 + tolerance && uv.v >= -tolerance && uv.v <= 1 + tolerance;

    if (!inside) continue;

    const bbox = view.bbox;
    const pdfX = bbox[0] + uv.u * (bbox[2] - bbox[0]);
    const pdfY = bbox[1] + uv.v * (bbox[3] - bbox[1]);
    const [x, y] = currentPdfViewport.convertToViewportPoint(pdfX, pdfY);

    candidates.push({
      inside: true,
      page: view.page,
      x,
      y,
      pdfX,
      pdfY,
      u: uv.u,
      v: uv.v,
      view,
    });
  }

  if (!candidates.length) return { inside: false };
  candidates.sort((a, b) => b.view.area - a.view.area);
  return candidates[0];
}

function renderGpsMarker(location) {
  ui.gpsLayer.innerHTML = "";

  const marker = document.createElement("div");
  marker.className = "gps-user-marker";
  marker.style.left = `${location.x}px`;
  marker.style.top = `${location.y}px`;
  marker.innerHTML = `
    <div class="gps-accuracy-circle"></div>
    <div class="gps-pulse"></div>
    <div class="gps-dot-real"></div>
  `;

  ui.gpsLayer.appendChild(marker);
  updateGpsMarkerScale();
}

function updateGpsMarkerScale() {
  const marker = ui.gpsLayer?.querySelector(".gps-user-marker");
  if (!marker) return;
  marker.style.transform = `scale(${1 / Math.max(zoom, 0.01)})`;
}

async function centerOnCurrentGps() {
  if (!currentGpsCanvas?.inside) {
    updateGpsForCurrentMap(false);
  }

  if (!currentGpsCanvas?.inside) {
    showToast("GPS ainda não está dentro do perímetro do mapa.");
    return;
  }

  if (pageNum !== currentGpsCanvas.page) {
    pageNum = currentGpsCanvas.page;
    await renderCurrentPage();
  }

  translate = {
    x: ui.mapWrapper.clientWidth / 2 - currentGpsCanvas.x * zoom,
    y: ui.mapWrapper.clientHeight / 2 - currentGpsCanvas.y * zoom,
  };

  applyTransform();
  showToast("Centralizado na sua localização.");
}

function createPointFromGps() {
  if (!currentGpsCanvas?.inside || !currentGps) {
    showToast("Ative o GPS dentro do mapa primeiro.");
    return;
  }

  pendingPoint = {
    waiting: false,
    mode: "pdfjs",
    page: currentGpsCanvas.page,
    x: currentGpsCanvas.x,
    y: currentGpsCanvas.y,
    lat: currentGps.lat,
    lon: currentGps.lon,
    accuracy: currentGps.accuracy,
    source: "gps",
  };

  openPointModal();
  ui.pointName.value = "Minha localização";
  ui.pointArea.value = "";
  ui.pointNote.value = `GPS: ${formatLatLon(currentGps.lat, currentGps.lon)} • precisão ±${Math.round(currentGps.accuracy || 0)} m`;
}

function updateGpsUi(state = "stopped", message = "") {
  ui.gpsStatus.classList.remove("active", "inside", "outside", "waiting", "error");

  if (state !== "stopped") {
    ui.gpsStatus.classList.add(state);
  }

  const labels = {
    stopped: "GPS parado",
    waiting: "GPS buscando",
    active: "GPS ativo",
    inside: "GPS no mapa",
    outside: "GPS fora",
    error: "GPS erro",
  };

  ui.gpsStatus.querySelector("span:last-child").textContent = labels[state] || "GPS";
  ui.gpsInfo.innerHTML = message || "GPS desligado. Para aparecer no mapa, o PDF precisa ser georreferenciado.";
}

function formatLatLon(lat, lon) {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}


async function clearAppCacheAndReload() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    showToast("Cache limpo. Recarregando...");
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    console.warn(error);
    showToast("Não consegui limpar tudo, mas vou recarregar.");
    setTimeout(() => location.reload(), 900);
  }
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  ui.connectionStatus.classList.toggle("online", online);
  ui.connectionStatus.querySelector("span:last-child").textContent = online ? "Online" : "Offline";
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service Worker não registrado:", error));
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function safeFileName(name) {
  return name.replace(/\.pdf$/i, "").replace(/[^\w\-]+/g, "_").slice(0, 60);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function randomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
