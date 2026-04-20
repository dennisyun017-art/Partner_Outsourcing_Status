(function () {
  const BOOT = window.APP_BOOTSTRAP || {};
  const META = BOOT.meta || {};
  const CURRENT_USER = BOOT.current_user || {};
  const TODAY_STR = META.base_date || "";
  const ROW_HEIGHT = 38;
  const BUFFER_ROWS = 10;
  const COLUMN_CONFIGS = [
    { key: "상태",       fixed: true,  hideable: false, minWidth: 120, maxWidth: 120 },
    { key: "Lot",        fixed: true,  hideable: false, minWidth: 110, maxWidth: 150 },
    { key: "CODE",       fixed: true,  hideable: false, minWidth: 110, maxWidth: 150 },
    { key: "WO",         fixed: true,  hideable: false, minWidth: 140, maxWidth: 200 },
    { key: "S/N",        fixed: true,  hideable: false, minWidth: 130, maxWidth: 220 },
    { key: "Customer",   fixed: true,  hideable: false, minWidth: 150, maxWidth: 340 },
    { key: "Line",       fixed: true,  hideable: false, minWidth: 140, maxWidth: 240 },
    { key: "Model",      fixed: true,  hideable: false, minWidth: 150, maxWidth: 340 },
    { key: "FSC",        fixed: false, hideable: true,  minWidth: 100, maxWidth: 220 },
    { key: "EFEM",       fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "TM",         fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "PM",         fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "SU",         fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "Harness",    fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "Stage",      fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "Tuning",     fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "생산시작일",  fixed: false, hideable: true,  minWidth: 140, maxWidth: 140 },
    { key: "Tuning시작일",fixed: false, hideable: true,  minWidth: 140, maxWidth: 140 },
    { key: "생산완료일",  fixed: false, hideable: true,  minWidth: 140, maxWidth: 140 },
    { key: "Remark",     fixed: false, hideable: true,  minWidth: 360, maxWidth: 900 }
  ];
  const ALL_COLUMNS = COLUMN_CONFIGS.map(c => c.key);
  const FIXED_COLUMNS = COLUMN_CONFIGS.filter(c => c.fixed).map(c => c.key);
  const NON_HIDEABLE_COLUMNS = new Set(COLUMN_CONFIGS.filter(c => !c.hideable).map(c => c.key));

  let rawData = [];
  let filteredData = [];
  let visibleColumns = new Set(ALL_COLUMNS);
  let columnFilters = {};
  ALL_COLUMNS.forEach(c => { columnFilters[c] = ""; });

  let sortState = { column: null, direction: null };
  let columnWidths = {};
  let stickyLeftMap = {};
  let currentRenderedRange = { start: -1, end: -1 };
  let isComposing = false;

  // ★ 열 너비 드래그 리사이즈 상태
  let resizeState = null;

  const textMeasureCanvas = document.createElement("canvas");
  const textMeasureCtx = textMeasureCanvas.getContext("2d");
  textMeasureCtx.font = "12px Malgun Gothic, Segoe UI, sans-serif";

  function normalizeText(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim().toLowerCase().replace(/[^0-9a-zA-Z가-힣]+/g, "");
  }

  function debounce(fn, delay) {
    let t = null;
    return function () {
      const a = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, a), delay);
    };
  }

  function safeText(v) { return v === null || v === undefined ? "" : String(v); }

  function setUserBadge() {
    const b = document.getElementById("userBadge");
    if (!b) return;
    b.textContent = CURRENT_USER.role === "admin"
      ? `${CURRENT_USER.name} (admin)`
      : `${CURRENT_USER.name} / ${CURRENT_USER.partner || ""}`;
  }

  async function loadData() {
    const res = await fetch("/api/dashboard-data", { credentials: "same-origin" });
    if (!res.ok) { alert("데이터 조회에 실패했습니다."); return; }
    const json = await res.json();
    rawData = json.records || [];
    setUserBadge();
    buildColumnToggleUI();
    computeColumnWidths();
    renderTableStructure();
    document.getElementById("filterDate").value = TODAY_STR;
    applyFilters({ resetScrollTop: true });
  }

  function getVisibleColumns() {
    return COLUMN_CONFIGS.map(c => c.key).filter(c => visibleColumns.has(c));
  }

  function estimateTextWidth(text, minW, maxW) {
    const m = Math.ceil(textMeasureCtx.measureText(String(text || "")).width) + 24;
    return Math.max(minW, Math.min(maxW, m));
  }

  function computeColumnWidths() {
    ALL_COLUMNS.forEach(col => {
      if (columnWidths[col]) return; // 사용자가 조절한 너비 유지
      const cfg = COLUMN_CONFIGS.find(c => c.key === col);
      const minW = cfg ? cfg.minWidth : 100;
      const maxW = cfg ? cfg.maxWidth : 260;
      let w = estimateTextWidth(col, minW, maxW);
      for (const row of rawData) {
        w = Math.max(w, estimateTextWidth(row[col] || "", minW, maxW));
        if (w >= maxW) break;
      }
      columnWidths[col] = w;
    });
    rebuildStickyLeftMap();
  }

  function rebuildStickyLeftMap() {
    stickyLeftMap = {};
    let left = 0;
    for (const col of ALL_COLUMNS) {
      if (!visibleColumns.has(col)) continue;
      if (FIXED_COLUMNS.includes(col)) {
        stickyLeftMap[col] = left;
        left += columnWidths[col] || 120;
      }
    }
  }

  function getColumnWidth(col) { return columnWidths[col] || 120; }
  function isStickyCol(col) { return FIXED_COLUMNS.includes(col) && visibleColumns.has(col); }
  function isLastStickyCol(col) {
    const vs = FIXED_COLUMNS.filter(c => visibleColumns.has(c));
    return vs.length > 0 && vs[vs.length - 1] === col;
  }

  function applyStickyStyles(cell, col, rowType) {
    if (!isStickyCol(col)) return;
    cell.classList.add("sticky-col");
    cell.style.left = (stickyLeftMap[col] || 0) + "px";
    if (isLastStickyCol(col)) {
      cell.classList.add(rowType === "filter" ? "sticky-divider" : "sticky-shadow");
    }
  }

  function buildColumnToggleUI() {
    const box = document.getElementById("columnToggleBox");
    box.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "column-chip-bar";
    let fixedDone = false;
    COLUMN_CONFIGS.forEach(cfg => {
      const col = cfg.key;
      if (cfg.hideable && !fixedDone) {
        fixedDone = true;
        const d = document.createElement("div");
        d.className = "col-chip-divider";
        bar.appendChild(d);
      }
      const chip = document.createElement("span");
      chip.className = "col-chip" + (NON_HIDEABLE_COLUMNS.has(col) ? " fixed" : (visibleColumns.has(col) ? " on" : ""));
      chip.textContent = col;
      chip.dataset.column = col;
      if (!NON_HIDEABLE_COLUMNS.has(col)) {
        chip.onclick = function () {
          if (visibleColumns.has(col)) { visibleColumns.delete(col); chip.classList.remove("on"); }
          else { visibleColumns.add(col); chip.classList.add("on"); }
          rebuildStickyLeftMap();
          renderTableStructure();
          applyFilters({ resetScrollTop: false });
        };
      }
      bar.appendChild(chip);
    });
    box.appendChild(bar);
  }

  function getSortIndicator(col) {
    if (sortState.column !== col || !sortState.direction) return "";
    return sortState.direction === "asc" ? " ▲" : " ▼";
  }

  function cycleSort(col) {
    if (sortState.column !== col) sortState = { column: col, direction: "asc" };
    else if (sortState.direction === "asc") sortState = { column: col, direction: "desc" };
    else sortState = { column: null, direction: null };
    renderHeaderRow();
    applyFilters({ resetScrollTop: true });
  }

  // ★ 헤더 셀 + 리사이즈 핸들
  function buildHeaderRow() {
    const row = document.createElement("div");
    row.className = "table-row header-row";
    getVisibleColumns().forEach(col => {
      const cell = document.createElement("div");
      cell.className = "table-cell header-cell";
      cell.dataset.col = col;
      cell.style.width = getColumnWidth(col) + "px";
      cell.style.minWidth = getColumnWidth(col) + "px";
      cell.style.position = "relative";
      applyStickyStyles(cell, col, "header");

      const label = document.createElement("span");
      label.textContent = col + getSortIndicator(col);
      label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;cursor:pointer;";
      label.onclick = () => cycleSort(col);
      cell.appendChild(label);

      // ★ 리사이즈 핸들
      const handle = document.createElement("div");
      handle.className = "col-resize-handle";
      handle.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        resizeState = { col, startX: e.clientX, startW: getColumnWidth(col) };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      });
      cell.appendChild(handle);
      row.appendChild(cell);
    });
    return row;
  }

  // ★ 전역 mousemove/mouseup 리사이즈 처리
  document.addEventListener("mousemove", function (e) {
    if (!resizeState) return;
    const diff = e.clientX - resizeState.startX;
    const cfg = COLUMN_CONFIGS.find(c => c.key === resizeState.col);
    const minW = cfg ? cfg.minWidth : 60;
    const newW = Math.max(minW, resizeState.startW + diff);
    columnWidths[resizeState.col] = newW;
    // 해당 컬럼 셀 즉시 업데이트
    document.querySelectorAll(`[data-col="${resizeState.col}"]`).forEach(c => {
      c.style.width = newW + "px";
      c.style.minWidth = newW + "px";
    });
    rebuildStickyLeftMap();
    syncTableInnerWidth();
  });

  document.addEventListener("mouseup", function () {
    if (!resizeState) return;
    resizeState = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    rebuildStickyLeftMap();
    renderTableStructure();
    applyFilters({ resetScrollTop: false });
  });

  // 컬럼 필터 행: 단순 텍스트 입력 (이전 스타일)
  function buildFilterRow() {
    const row = document.createElement("div");
    row.className = "table-row filter-row";
    getVisibleColumns().forEach(col => {
      const cell = document.createElement("div");
      cell.className = "table-cell filter-cell";
      cell.dataset.col = col;
      cell.style.width = getColumnWidth(col) + "px";
      cell.style.minWidth = getColumnWidth(col) + "px";
      applyStickyStyles(cell, col, "filter");

      const inp = document.createElement("input");
      inp.className = "filter-input";
      inp.type = "text";
      inp.placeholder = "필터";
      inp.value = columnFilters[col] || "";
      inp.dataset.column = col;

      inp.addEventListener("compositionstart", () => { isComposing = true; });
      inp.addEventListener("compositionend", e => {
        isComposing = false;
        columnFilters[col] = e.target.value || "";
        debouncedApplyColumnFilters();
      });
      inp.addEventListener("input", e => {
        columnFilters[col] = e.target.value || "";
        if (isComposing) return;
        debouncedApplyColumnFilters();
      });

      cell.appendChild(inp);
      row.appendChild(cell);
    });
    return row;
  }

  function renderHeaderRow() {
    const header = document.getElementById("tableHeader");
    const cur = header.querySelector(".header-row");
    const newRow = buildHeaderRow();
    if (cur) header.replaceChild(newRow, cur); else header.prepend(newRow);
  }

  function renderFilterRow() {
    const header = document.getElementById("tableHeader");
    const cur = header.querySelector(".filter-row");
    const focusCol = document.activeElement?.dataset?.column || null;
    const focusPos = document.activeElement?.selectionStart ?? null;
    const newRow = buildFilterRow();
    if (cur) header.replaceChild(newRow, cur); else header.appendChild(newRow);
    if (focusCol) {
      const t = header.querySelector(`.filter-input[data-column="${CSS.escape(focusCol)}"]`);
      if (t) { t.focus(); try { if (focusPos !== null) t.setSelectionRange(focusPos, focusPos); } catch(e){} }
    }
  }

  function syncTableInnerWidth() {
    const inner = document.getElementById("tableInner");
    let total = 0;
    getVisibleColumns().forEach(col => { total += getColumnWidth(col); });
    inner.style.width = total + "px";
  }

  function renderTableStructure() {
    const header = document.getElementById("tableHeader");
    header.innerHTML = "";
    header.appendChild(buildHeaderRow());
    header.appendChild(buildFilterRow());
    syncTableInnerWidth();
  }

  function getStatusClass(s) {
    if (s === "생산완료") return "status-pill status-done";
    if (s === "Tuning중") return "status-pill status-tuning";
    if (s === "조립중")   return "status-pill status-assembly";
    if (s === "생산예정") return "status-pill status-plan";
    return "status-pill status-unknown";
  }

  function fillDetail(targetId, pairs, rowData) {
    const el = document.getElementById(targetId);
    el.innerHTML = "";
    pairs.forEach(p => {
      const lab = document.createElement("div"); lab.className = "detail-label"; lab.textContent = p[0];
      const val = document.createElement("div"); val.textContent = rowData[p[1]] || "";
      el.appendChild(lab); el.appendChild(val);
    });
  }

  function openDetailModal(rowData) {
    document.getElementById("modalTitle").textContent = "WO 상세 - " + (rowData["WO"] || "");
    fillDetail("detailBasic", [["상태","상태"],["Lot","Lot"],["CODE","CODE"],["WO","WO"],["S/N","S/N"],["Customer","Customer"],["Line","Line"],["Model","Model"],["FSC","FSC"]], rowData);
    fillDetail("detailProcess", [["EFEM","EFEM"],["TM","TM"],["PM","PM"],["SU","SU"],["Harness","Harness"],["Stage","Stage"],["Tuning","Tuning"]], rowData);
    fillDetail("detailSchedule", [["생산시작일","생산시작일"],["Tuning시작일","Tuning시작일"],["생산완료일","생산완료일"]], rowData);
    document.getElementById("detailRemark").textContent = rowData["Remark"] || "";
    document.getElementById("detailModal").classList.add("show");
  }

  function closeDetailModal() { document.getElementById("detailModal").classList.remove("show"); }
  window.closeDetailModal = closeDetailModal;

  function buildDataRow(rowData, rowIndex) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.style.cssText = `position:absolute;top:${rowIndex * ROW_HEIGHT}px;height:${ROW_HEIGHT}px;`;
    getVisibleColumns().forEach(col => {
      const cell = document.createElement("div");
      cell.className = "table-cell data-cell";
      cell.dataset.col = col;
      cell.style.width = getColumnWidth(col) + "px";
      cell.style.minWidth = getColumnWidth(col) + "px";
      applyStickyStyles(cell, col, "data");
      if (col === "상태") {
        const span = document.createElement("span");
        span.className = getStatusClass(rowData[col] || "");
        span.textContent = rowData[col] || "";
        cell.appendChild(span);
      } else if (col === "WO") {
        const link = document.createElement("span");
        link.className = "wo-link";
        link.textContent = rowData[col] || "";
        link.onclick = e => { e.stopPropagation(); openDetailModal(rowData); };
        cell.appendChild(link);
      } else {
        cell.textContent = safeText(rowData[col]);
      }
      row.appendChild(cell);
    });
    return row;
  }

  function renderVirtualRows(forceReset) {
    const scroll = document.getElementById("tableScroll");
    const body = document.getElementById("tableBody");
    const cnt = Math.ceil(scroll.clientHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    const start = Math.max(0, Math.floor(scroll.scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const end = Math.min(filteredData.length, start + cnt);
    if (!forceReset && start === currentRenderedRange.start && end === currentRenderedRange.end) return;
    currentRenderedRange = { start, end };
    body.innerHTML = "";
    body.style.height = filteredData.length * ROW_HEIGHT + "px";
    for (let i = start; i < end; i++) body.appendChild(buildDataRow(filteredData[i], i));
  }

  function sortData(data) {
    if (!sortState.column || !sortState.direction) return data.slice();
    const col = sortState.column, dir = sortState.direction;
    return data.slice().sort((a, b) => {
      const av = a[col] || "", bv = b[col] || "";
      const ad = Date.parse(av), bd = Date.parse(bv);
      let r = 0;
      if (!isNaN(ad) && !isNaN(bd) && String(av).length >= 8 && String(bv).length >= 8) r = ad - bd;
      else {
        const an = Number(av), bn = Number(bv);
        if (!isNaN(an) && !isNaN(bn) && String(av).trim() && String(bv).trim()) r = an - bn;
        else r = String(av).localeCompare(String(bv), "ko");
      }
      return dir === "asc" ? r : -r;
    });
  }

  function applyFilters(options) {
    const opts = Object.assign({ resetScrollTop: true }, options || {});

    const searchText     = normalizeText(document.getElementById("searchText").value);
    const filterLot      = normalizeText(document.getElementById("filterLot").value);
    const filterCode     = normalizeText(document.getElementById("filterCode").value);
    const filterWo       = normalizeText(document.getElementById("filterWo").value);
    // ★ Assembly BP사: EFEM, TM, PM, SU 검색
    const filterAssembly = normalizeText(document.getElementById("filterAssemblyBp").value);
    // ★ Tuning BP사: Tuning 컬럼만 검색
    const filterTuning   = normalizeText(document.getElementById("filterTuningBp").value);
    const filterDate     = document.getElementById("filterDate").value;
    const filterDateFrom = document.getElementById("filterDateFrom").value;
    const filterDateTo   = document.getElementById("filterDateTo").value;

    const data = rawData.filter(row => {
      // 통합검색
      if (searchText) {
        const full = normalizeText(ALL_COLUMNS.map(c => row[c] || "").join(" "));
        if (!full.includes(searchText)) return false;
      }
      // Lot / CODE / WO
      if (filterLot  && !normalizeText(row["Lot"] || "").includes(filterLot))  return false;
      if (filterCode && !normalizeText(row["CODE"] || "").includes(filterCode)) return false;
      if (filterWo   && !normalizeText(row["WO"] || "").includes(filterWo))    return false;

      // ★ Assembly BP사: EFEM, TM, PM, SU 중 하나라도 포함
      if (filterAssembly) {
        const assemblyVal = normalizeText(
          [row["EFEM"], row["TM"], row["PM"], row["SU"]].map(v => v || "").join(" ")
        );
        if (!assemblyVal.includes(filterAssembly)) return false;
      }

      // ★ Tuning BP사: Tuning 컬럼만
      if (filterTuning) {
        if (!normalizeText(row["Tuning"] || "").includes(filterTuning)) return false;
      }

      // 단일 날짜
      if (filterDate) {
        const s = row["생산시작일"] || "", e = row["생산완료일"] || "";
        if (!(s <= filterDate && filterDate <= e) && s !== filterDate && e !== filterDate) return false;
      }
      // 날짜 범위
      if (filterDateFrom || filterDateTo) {
        const s = row["생산시작일"] || "", e = row["생산완료일"] || "";
        if (filterDateFrom && filterDateTo) { if (e < filterDateFrom || s > filterDateTo) return false; }
        else if (filterDateFrom) { if (e && e < filterDateFrom) return false; }
        else if (filterDateTo)   { if (s && s > filterDateTo) return false; }
      }

      // 컬럼 필터 (단순 부분일치)
      for (const col of ALL_COLUMNS) {
        const f = normalizeText(columnFilters[col] || "");
        if (!f) continue;
        if (!normalizeText(row[col] || "").includes(f)) return false;
      }
      return true;
    });

    filteredData = sortData(data);
    rebuildStickyLeftMap();
    syncTableInnerWidth();
    renderHeaderRow();
    renderFilterRow();
    renderVirtualRows(true);
    renderKpis();
    renderTimeline();
    if (opts.resetScrollTop) document.getElementById("tableScroll").scrollTop = 0;
  }

  function renderKpis() {
    document.getElementById("kpiTotal").textContent    = filteredData.length.toLocaleString();
    document.getElementById("kpiPlan").textContent     = filteredData.filter(r => r["상태"] === "생산예정").length.toLocaleString();
    document.getElementById("kpiAssembly").textContent = filteredData.filter(r => r["상태"] === "조립중").length.toLocaleString();
    document.getElementById("kpiTuning").textContent   = filteredData.filter(r => r["상태"] === "Tuning중").length.toLocaleString();
  }

  function toDateObj(s) {
    if (!s) return null;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0); return d;
  }
  function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); x.setHours(0,0,0,0); return x; }
  function diffDays(a, b) { return Math.round((b-a)/(24*60*60*1000)); }
  function isBetween(t, s, e) { return !!(t && s && e && s <= t && t <= e); }

  function renderTimeline() {
    const wrap = document.getElementById("timelineWrap");
    wrap.innerHTML = "";
    const rows = filteredData.map(r => ({
      label: `${r["Lot"]||""} / ${r["WO"]||""}`, status: r["상태"]||"",
      gS: toDateObj(r["phase_green_start"]), gE: toDateObj(r["phase_green_end"]),
      bS: toDateObj(r["phase_blue_start"]),  bE: toDateObj(r["phase_blue_end"])
    })).filter(r => r.gS || r.bS || r.bE).slice(0, 100);

    if (!rows.length) { wrap.innerHTML = "<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>"; return; }

    let minDate = null, maxDate = null;
    rows.forEach(r => {
      [r.gS, r.bS].filter(Boolean).forEach(d => { if (!minDate || d < minDate) minDate = d; });
      [r.gE, r.bE].filter(Boolean).forEach(d => { if (!maxDate || d > maxDate) maxDate = d; });
    });
    if (!minDate || !maxDate) { wrap.innerHTML = "<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>"; return; }

    const total = diffDays(minDate, maxDate), capped = Math.min(total, 45);
    const tbl = document.createElement("table"); tbl.className = "timeline-table";
    const thead = document.createElement("thead"), hr = document.createElement("tr");
    const fth = document.createElement("th"); fth.className = "label-col"; fth.textContent = "Lot / WO"; hr.appendChild(fth);
    const today = toDateObj(TODAY_STR);
    for (let i = 0; i <= capped; i++) {
      const cur = addDays(minDate, i); const th = document.createElement("th");
      th.textContent = formatDate(cur).slice(5);
      if (today && cur.getTime() === today.getTime()) th.classList.add("today-col");
      hr.appendChild(th);
    }
    thead.appendChild(hr); tbl.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach(r => {
      const tr = document.createElement("tr");
      const tdL = document.createElement("td"); tdL.className = "label-col";
      tdL.textContent = `${r.label} (${r.status})`; tr.appendChild(tdL);
      for (let i = 0; i <= capped; i++) {
        const cur = addDays(minDate, i); const td = document.createElement("td");
        if (today && cur.getTime() === today.getTime()) td.classList.add("today-col");
        const inner = document.createElement("div"); inner.className = "timeline-cell-inner";
        if (isBetween(cur, r.bS, r.bE)) {
          const p = document.createElement("div"); p.className = "timeline-pill pill-blue"; inner.appendChild(p);
        } else if (isBetween(cur, r.gS, r.gE)) {
          const p = document.createElement("div"); p.className = "timeline-pill pill-green"; inner.appendChild(p);
        }
        td.appendChild(inner); tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody); wrap.appendChild(tbl);
    if (total > capped) {
      const note = document.createElement("div"); note.className = "timeline-note";
      note.textContent = `일정 범위가 길어 최초 46일 구간만 표시했습니다. 전체 범위: ${formatDate(minDate)} ~ ${formatDate(maxDate)}`;
      wrap.appendChild(note);
    }
  }

  const debouncedApplyFilters = debounce(() => applyFilters({ resetScrollTop: true }), 200);
  const debouncedApplyColumnFilters = debounce(() => applyFilters({ resetScrollTop: false }), 300);

  document.getElementById("searchText").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterLot").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterCode").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterWo").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterAssemblyBp").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterTuningBp").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterDate").addEventListener("change", () => applyFilters({ resetScrollTop: true }));
  document.getElementById("filterDateFrom").addEventListener("change", () => applyFilters({ resetScrollTop: true }));
  document.getElementById("filterDateTo").addEventListener("change", () => applyFilters({ resetScrollTop: true }));
  document.getElementById("tableScroll").addEventListener("scroll", () => renderVirtualRows(false));
  document.getElementById("detailModal").addEventListener("click", closeDetailModal);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDetailModal(); });

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", async function () {
      const res = await fetch("/api/reload-data", { method: "POST", body: new FormData(), credentials: "same-origin" });
      if (!res.ok) { alert("데이터 재로딩 실패"); return; }
      await loadData(); alert("데이터 재로딩 완료");
    });
  }

  loadData();
})();
