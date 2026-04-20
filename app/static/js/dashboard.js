(function () {
  const BOOT = window.APP_BOOTSTRAP || {};
  const META = BOOT.meta || {};
  const CURRENT_USER = BOOT.current_user || {};
  const TODAY_STR = META.base_date || "";
  const ROW_HEIGHT = 38;
  const BUFFER_ROWS = 10;
  const COLUMN_CONFIGS = [
    { key: "상태", fixed: true, hideable: false, minWidth: 120, maxWidth: 120 },
    { key: "Lot", fixed: true, hideable: false, minWidth: 110, maxWidth: 150 },
    { key: "CODE", fixed: true, hideable: false, minWidth: 110, maxWidth: 150 },
    { key: "WO", fixed: true, hideable: false, minWidth: 140, maxWidth: 200 },
    { key: "S/N", fixed: true, hideable: false, minWidth: 130, maxWidth: 220 },
    { key: "Customer", fixed: true, hideable: false, minWidth: 150, maxWidth: 340 },
    { key: "Line", fixed: true, hideable: false, minWidth: 140, maxWidth: 240 },
    { key: "Model", fixed: true, hideable: false, minWidth: 150, maxWidth: 340 },
    { key: "FSC", fixed: false, hideable: true, minWidth: 130, maxWidth: 220 },
    { key: "EFEM", fixed: false, hideable: true, minWidth: 110, maxWidth: 180 },
    { key: "TM", fixed: false, hideable: true, minWidth: 110, maxWidth: 180 },
    { key: "PM", fixed: false, hideable: true, minWidth: 110, maxWidth: 180 },
    { key: "SU", fixed: false, hideable: true, minWidth: 110, maxWidth: 180 },
    { key: "Harness", fixed: false, hideable: true, minWidth: 110, maxWidth: 180 },
    { key: "Stage", fixed: false, hideable: true, minWidth: 110, maxWidth: 180 },
    { key: "Tuning", fixed: false, hideable: true, minWidth: 110, maxWidth: 180 },
    { key: "생산시작일", fixed: false, hideable: true, minWidth: 140, maxWidth: 140 },
    { key: "Tuning시작일", fixed: false, hideable: true, minWidth: 140, maxWidth: 140 },
    { key: "생산완료일", fixed: false, hideable: true, minWidth: 140, maxWidth: 140 },
    { key: "Remark", fixed: false, hideable: true, minWidth: 360, maxWidth: 900 }
  ];
  const ALL_COLUMNS = COLUMN_CONFIGS.map(col => col.key);
  const FIXED_COLUMNS = COLUMN_CONFIGS.filter(col => col.fixed).map(col => col.key);
  const NON_HIDEABLE_COLUMNS = new Set(
    COLUMN_CONFIGS.filter(col => col.hideable === false).map(col => col.key)
  );

  let rawData = [];
  let filteredData = [];
  let visibleColumns = new Set(ALL_COLUMNS);

  // ★ 컬럼 필터: 각 컬럼마다 태그 배열로 관리 (다중 OR 부분일치)
  let columnTagFilters = {};
  ALL_COLUMNS.forEach(col => { columnTagFilters[col] = []; });

  let sortState = { column: null, direction: null };
  let columnWidths = {};
  let stickyLeftMap = {};
  let currentRenderedRange = { start: -1, end: -1 };

  const textMeasureCanvas = document.createElement("canvas");
  const textMeasureCtx = textMeasureCanvas.getContext("2d");
  textMeasureCtx.font = "13px Malgun Gothic, Segoe UI, sans-serif";

  function normalizeText(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim().toLowerCase().replace(/[^0-9a-zA-Z가-힣]+/g, "");
  }

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, delay);
    };
  }

  function safeText(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function setUserBadge() {
    const badge = document.getElementById("userBadge");
    if (!badge) return;
    badge.textContent = CURRENT_USER.role === "admin"
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
    return COLUMN_CONFIGS.map(col => col.key).filter(col => visibleColumns.has(col));
  }

  function estimateTextWidth(text, minWidth, maxWidth) {
    const measured = Math.ceil(textMeasureCtx.measureText(String(text || "")).width) + 28;
    return Math.max(minWidth, Math.min(maxWidth, measured));
  }

  function getColumnWidthRange(col) {
    const config = COLUMN_CONFIGS.find(item => item.key === col);
    if (!config) return { minWidth: 100, maxWidth: 260 };
    return { minWidth: config.minWidth, maxWidth: config.maxWidth };
  }

  function computeColumnWidths() {
    const widths = {};
    ALL_COLUMNS.forEach(function (col) {
      const range = getColumnWidthRange(col);
      let width = estimateTextWidth(col, range.minWidth, range.maxWidth);
      for (const row of rawData) {
        width = Math.max(width, estimateTextWidth(row[col] || "", range.minWidth, range.maxWidth));
        if (width >= range.maxWidth) break;
      }
      widths[col] = width;
    });
    columnWidths = widths;
    rebuildStickyLeftMap();
  }

  function rebuildStickyLeftMap() {
    stickyLeftMap = {};
    let left = 0;
    for (const col of ALL_COLUMNS) {
      if (!visibleColumns.has(col)) continue;
      if (FIXED_COLUMNS.includes(col)) {
        stickyLeftMap[col] = left;
        left += getColumnWidth(col);
      }
    }
  }

  function getColumnWidth(col) { return columnWidths[col] || 120; }
  function isStickyColumn(col) { return FIXED_COLUMNS.includes(col) && visibleColumns.has(col); }
  function isLastStickyColumn(col) {
    const vs = FIXED_COLUMNS.filter(c => visibleColumns.has(c));
    return vs.length > 0 && vs[vs.length - 1] === col;
  }

  function applyStickyStyles(cell, col, rowType) {
    if (!isStickyColumn(col)) return;
    cell.classList.add("sticky-col");
    cell.style.left = String(stickyLeftMap[col] || 0) + "px";
    if (isLastStickyColumn(col)) {
      if (rowType === "filter") cell.classList.add("sticky-divider");
      else cell.classList.add("sticky-shadow");
    }
  }

  function buildColumnToggleUI() {
    const box = document.getElementById("columnToggleBox");
    box.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "column-chip-bar";
    let fixedDone = false;
    COLUMN_CONFIGS.forEach(function (colConfig) {
      const col = colConfig.key;
      if (colConfig.hideable && !fixedDone) {
        fixedDone = true;
        const div = document.createElement("div");
        div.className = "col-chip-divider";
        bar.appendChild(div);
      }
      const chip = document.createElement("span");
      chip.className = "col-chip" + (NON_HIDEABLE_COLUMNS.has(col) ? " fixed" : (visibleColumns.has(col) ? " on" : ""));
      chip.textContent = col;
      chip.dataset.column = col;
      if (!NON_HIDEABLE_COLUMNS.has(col)) {
        chip.onclick = function () {
          if (visibleColumns.has(col)) { visibleColumns.delete(col); chip.classList.remove("on"); }
          else { visibleColumns.add(col); chip.classList.add("on"); }
          computeColumnWidths();
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
    else if (sortState.direction === "desc") sortState = { column: null, direction: null };
    else sortState = { column: col, direction: "asc" };
    renderHeaderRow();
    applyFilters({ resetScrollTop: true });
  }

  function buildHeaderRow() {
    const row = document.createElement("div");
    row.className = "table-row header-row";
    getVisibleColumns().forEach(function (col) {
      const cell = document.createElement("div");
      cell.className = "table-cell header-cell";
      cell.style.width = getColumnWidth(col) + "px";
      cell.style.minWidth = getColumnWidth(col) + "px";
      applyStickyStyles(cell, col, "header");
      cell.textContent = col + getSortIndicator(col);
      cell.onclick = function () { cycleSort(col); };
      row.appendChild(cell);
    });
    return row;
  }

  // ★ 컬럼 필터 행: 태그 방식으로 변경
  function buildFilterRow() {
    const row = document.createElement("div");
    row.className = "table-row filter-row";
    getVisibleColumns().forEach(function (col) {
      const cell = document.createElement("div");
      cell.className = "table-cell filter-cell";
      cell.style.width = getColumnWidth(col) + "px";
      cell.style.minWidth = getColumnWidth(col) + "px";
      applyStickyStyles(cell, col, "filter");

      // 태그 래퍼
      const wrap = document.createElement("div");
      wrap.className = "col-tag-wrap";
      wrap.dataset.col = col;

      // 태그 목록 영역
      const tagList = document.createElement("div");
      tagList.className = "col-tag-list";
      tagList.id = "colTagList_" + col;

      // 텍스트 입력
      const inp = document.createElement("input");
      inp.className = "col-tag-input";
      inp.type = "text";
      inp.placeholder = "필터";
      inp.dataset.column = col;

      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          const val = inp.value.trim().replace(/,$/, "");
          if (val && !columnTagFilters[col].includes(val)) {
            columnTagFilters[col].push(val);
            renderColTags(col);
            applyFilters({ resetScrollTop: false });
          }
          inp.value = "";
        } else if (e.key === "Backspace" && inp.value === "" && columnTagFilters[col].length > 0) {
          columnTagFilters[col].pop();
          renderColTags(col);
          applyFilters({ resetScrollTop: false });
        }
      });

      // 한글 조합 중 Enter 방지
      let composing = false;
      inp.addEventListener("compositionstart", () => { composing = true; });
      inp.addEventListener("compositionend", () => { composing = false; });

      wrap.addEventListener("click", function () { inp.focus(); });
      wrap.appendChild(tagList);
      wrap.appendChild(inp);
      cell.appendChild(wrap);
      row.appendChild(cell);
    });
    return row;
  }

  // ★ 컬럼 태그 렌더링
  function renderColTags(col) {
    const list = document.getElementById("colTagList_" + col);
    if (!list) return;
    list.innerHTML = "";
    columnTagFilters[col].forEach(function (tag, idx) {
      const item = document.createElement("span");
      item.className = "tag-item";
      const text = document.createTextNode(tag + " ");
      const btn = document.createElement("span");
      btn.className = "tag-remove";
      btn.textContent = "×";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        columnTagFilters[col].splice(idx, 1);
        renderColTags(col);
        applyFilters({ resetScrollTop: false });
      });
      item.appendChild(text);
      item.appendChild(btn);
      list.appendChild(item);
    });
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
    const newRow = buildFilterRow();
    if (cur) header.replaceChild(newRow, cur); else header.appendChild(newRow);
    // 태그 재렌더링
    ALL_COLUMNS.forEach(col => renderColTags(col));
  }

  function syncTableInnerWidth() {
    const inner = document.getElementById("tableInner");
    let totalWidth = 0;
    getVisibleColumns().forEach(function (col) { totalWidth += getColumnWidth(col); });
    inner.style.width = totalWidth + "px";
  }

  function renderTableStructure() {
    const header = document.getElementById("tableHeader");
    header.innerHTML = "";
    header.appendChild(buildHeaderRow());
    header.appendChild(buildFilterRow());
    ALL_COLUMNS.forEach(col => renderColTags(col));
    syncTableInnerWidth();
  }

  function getStatusClass(status) {
    if (status === "생산완료") return "status-pill status-done";
    if (status === "Tuning중") return "status-pill status-tuning";
    if (status === "조립중") return "status-pill status-assembly";
    if (status === "생산예정") return "status-pill status-plan";
    return "status-pill status-unknown";
  }

  function fillDetail(targetId, pairs, rowData) {
    const el = document.getElementById(targetId);
    el.innerHTML = "";
    pairs.forEach(function (pair) {
      const lab = document.createElement("div");
      lab.className = "detail-label";
      lab.textContent = pair[0];
      const val = document.createElement("div");
      val.textContent = rowData[pair[1]] || "";
      el.appendChild(lab);
      el.appendChild(val);
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

  function closeDetailModal() {
    document.getElementById("detailModal").classList.remove("show");
  }
  window.closeDetailModal = closeDetailModal;

  function buildDataRow(rowData, rowIndex) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.style.position = "absolute";
    row.style.top = rowIndex * ROW_HEIGHT + "px";
    row.style.height = ROW_HEIGHT + "px";
    getVisibleColumns().forEach(function (col) {
      const cell = document.createElement("div");
      cell.className = "table-cell data-cell";
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
        link.onclick = function (e) { e.stopPropagation(); openDetailModal(rowData); };
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
    const visibleCount = Math.ceil(scroll.clientHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
    const start = Math.max(0, Math.floor(scroll.scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const end = Math.min(filteredData.length, start + visibleCount);
    if (!forceReset && start === currentRenderedRange.start && end === currentRenderedRange.end) return;
    currentRenderedRange = { start, end };
    body.innerHTML = "";
    body.style.height = filteredData.length * ROW_HEIGHT + "px";
    for (let i = start; i < end; i++) { body.appendChild(buildDataRow(filteredData[i], i)); }
  }

  function sortData(data) {
    if (!sortState.column || !sortState.direction) return data.slice();
    const col = sortState.column;
    const dir = sortState.direction;
    return data.slice().sort(function (a, b) {
      const av = a[col] || ""; const bv = b[col] || "";
      const ad = Date.parse(av); const bd = Date.parse(bv);
      let result = 0;
      if (!Number.isNaN(ad) && !Number.isNaN(bd) && String(av).length >= 8 && String(bv).length >= 8) {
        result = ad - bd;
      } else {
        const an = Number(av); const bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== "" && String(bv).trim() !== "") {
          result = an - bn;
        } else { result = String(av).localeCompare(String(bv), "ko"); }
      }
      return dir === "asc" ? result : -result;
    });
  }

  function applyFilters(options) {
    const opts = Object.assign({ resetScrollTop: true }, options || {});

    // 상단 필터값 수집
    const searchText = normalizeText(document.getElementById("searchText").value);
    const filterLot = normalizeText(document.getElementById("filterLot").value);
    const filterCode = normalizeText(document.getElementById("filterCode").value);
    const filterWo = normalizeText(document.getElementById("filterWo").value);
    const filterPartnerText = normalizeText(document.getElementById("filterPartnerText").value);
    const filterDate = document.getElementById("filterDate").value;
    const filterDateFrom = document.getElementById("filterDateFrom").value;
    const filterDateTo = document.getElementById("filterDateTo").value;

    const data = rawData.filter(function (row) {
      // 통합검색
      if (searchText) {
        const fullText = normalizeText([
          row["상태"], row["Lot"], row["CODE"], row["WO"], row["S/N"],
          row["Customer"], row["Line"], row["Model"], row["FSC"],
          row["EFEM"], row["TM"], row["PM"], row["SU"],
          row["Harness"], row["Stage"], row["Tuning"], row["Remark"]
        ].join(" "));
        if (!fullText.includes(searchText)) return false;
      }

      // 개별 상단 필터 (부분일치)
      if (filterLot && !normalizeText(row["Lot"]).includes(filterLot)) return false;
      if (filterCode && !normalizeText(row["CODE"]).includes(filterCode)) return false;
      if (filterWo && !normalizeText(row["WO"]).includes(filterWo)) return false;

      // Partner 공정 포함값
      if (filterPartnerText) {
        const partnerText = ["EFEM","TM","PM","SU","Harness","Stage","Tuning","Remark"]
          .map(f => normalizeText(row[f] || "")).join("");
        if (!partnerText.includes(filterPartnerText)) return false;
      }

      // 단일 날짜 필터
      if (filterDate) {
        const s = row["생산시작일"] || "";
        const e = row["생산완료일"] || "";
        if (!(s <= filterDate && filterDate <= e) && s !== filterDate && e !== filterDate) return false;
      }

      // 날짜 범위 필터
      if (filterDateFrom || filterDateTo) {
        const s = row["생산시작일"] || "";
        const e = row["생산완료일"] || "";
        if (filterDateFrom && filterDateTo) {
          if (e < filterDateFrom || s > filterDateTo) return false;
        } else if (filterDateFrom) {
          if (e && e < filterDateFrom) return false;
        } else if (filterDateTo) {
          if (s && s > filterDateTo) return false;
        }
      }

      // ★ 컬럼 태그 필터: OR 부분일치
      for (const col of ALL_COLUMNS) {
        const tags = columnTagFilters[col];
        if (!tags || tags.length === 0) continue;
        const cellVal = normalizeText(row[col] || "");
        // 태그 중 하나라도 포함되면 통과 (OR 조건)
        const matched = tags.some(tag => cellVal.includes(normalizeText(tag)));
        if (!matched) return false;
      }

      return true;
    });

    filteredData = sortData(data);
    computeColumnWidths();
    syncTableInnerWidth();
    renderHeaderRow();
    renderFilterRow();
    renderVirtualRows(true);
    renderKpis();
    renderTimeline();

    if (opts.resetScrollTop) document.getElementById("tableScroll").scrollTop = 0;
  }

  function renderKpis() {
    document.getElementById("kpiTotal").textContent = filteredData.length.toLocaleString();
    document.getElementById("kpiPlan").textContent = filteredData.filter(r => r["상태"] === "생산예정").length.toLocaleString();
    document.getElementById("kpiAssembly").textContent = filteredData.filter(r => r["상태"] === "조립중").length.toLocaleString();
    document.getElementById("kpiTuning").textContent = filteredData.filter(r => r["상태"] === "Tuning중").length.toLocaleString();
  }

  function toDateObj(s) {
    if (!s) return null;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function addDays(d, n) {
    const x = new Date(d); x.setDate(x.getDate() + n); x.setHours(0,0,0,0); return x;
  }

  function diffDays(a, b) { return Math.round((b - a) / (24*60*60*1000)); }

  function isBetween(target, start, end) {
    return !!(target && start && end && start <= target && target <= end);
  }

  function renderTimeline() {
    const wrap = document.getElementById("timelineWrap");
    wrap.innerHTML = "";
    const rows = filteredData.map(r => ({
      label: `${r["Lot"]||""} / ${r["WO"]||""}`,
      status: r["상태"]||"",
      greenStart: toDateObj(r["phase_green_start"]),
      greenEnd: toDateObj(r["phase_green_end"]),
      blueStart: toDateObj(r["phase_blue_start"]),
      blueEnd: toDateObj(r["phase_blue_end"])
    })).filter(r => r.greenStart || r.blueStart || r.blueEnd).slice(0, 100);

    if (!rows.length) { wrap.innerHTML = "<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>"; return; }

    let minDate = null, maxDate = null;
    rows.forEach(r => {
      [r.greenStart, r.blueStart].filter(Boolean).forEach(d => { if (!minDate || d < minDate) minDate = d; });
      [r.greenEnd, r.blueEnd].filter(Boolean).forEach(d => { if (!maxDate || d > maxDate) maxDate = d; });
    });
    if (!minDate || !maxDate) { wrap.innerHTML = "<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>"; return; }

    const totalDays = diffDays(minDate, maxDate);
    const cappedDays = Math.min(totalDays, 45);
    const table = document.createElement("table");
    table.className = "timeline-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const firstTh = document.createElement("th");
    firstTh.className = "label-col"; firstTh.textContent = "Lot / WO";
    hr.appendChild(firstTh);
    const today = toDateObj(TODAY_STR);
    for (let i = 0; i <= cappedDays; i++) {
      const cur = addDays(minDate, i);
      const th = document.createElement("th");
      th.textContent = formatDate(cur).slice(5);
      if (today && cur.getTime() === today.getTime()) th.classList.add("today-col");
      hr.appendChild(th);
    }
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach(r => {
      const tr = document.createElement("tr");
      const tdLabel = document.createElement("td");
      tdLabel.className = "label-col";
      tdLabel.textContent = `${r.label} (${r.status})`;
      tr.appendChild(tdLabel);
      for (let i = 0; i <= cappedDays; i++) {
        const cur = addDays(minDate, i);
        const td = document.createElement("td");
        if (today && cur.getTime() === today.getTime()) td.classList.add("today-col");
        const inner = document.createElement("div");
        inner.className = "timeline-cell-inner";
        if (isBetween(cur, r.blueStart, r.blueEnd)) {
          const p = document.createElement("div"); p.className = "timeline-pill pill-blue"; inner.appendChild(p);
        } else if (isBetween(cur, r.greenStart, r.greenEnd)) {
          const p = document.createElement("div"); p.className = "timeline-pill pill-green"; inner.appendChild(p);
        }
        td.appendChild(inner); tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table);
    if (totalDays > cappedDays) {
      const note = document.createElement("div");
      note.className = "timeline-note";
      note.textContent = `일정 범위가 길어 최초 46일 구간만 표시했습니다. 전체 범위: ${formatDate(minDate)} ~ ${formatDate(maxDate)}`;
      wrap.appendChild(note);
    }
  }

  const debouncedApplyFilters = debounce(function () {
    applyFilters({ resetScrollTop: true });
  }, 200);

  // 상단 필터 이벤트
  document.getElementById("searchText").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterLot").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterCode").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterWo").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterPartnerText").addEventListener("input", debouncedApplyFilters);
  document.getElementById("filterDate").addEventListener("change", function () { applyFilters({ resetScrollTop: true }); });
  document.getElementById("filterDateFrom").addEventListener("change", function () { applyFilters({ resetScrollTop: true }); });
  document.getElementById("filterDateTo").addEventListener("change", function () { applyFilters({ resetScrollTop: true }); });

  document.getElementById("tableScroll").addEventListener("scroll", function () { renderVirtualRows(false); });
  document.getElementById("detailModal").addEventListener("click", closeDetailModal);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetailModal(); });

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", async function () {
      const res = await fetch("/api/reload-data", { method: "POST", body: new FormData(), credentials: "same-origin" });
      if (!res.ok) { alert("데이터 재로딩 실패"); return; }
      await loadData();
      alert("데이터 재로딩 완료");
    });
  }

  loadData();
})();
