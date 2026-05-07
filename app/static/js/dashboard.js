// Partner Outsourcing Status 메인 대시보드 JS
(function () {
  const BOOT = window.APP_BOOTSTRAP || {};
  const META = BOOT.meta || {};
  const CURRENT_USER = BOOT.current_user || {};
  const TODAY_STR = META.base_date || "";
  const ROW_HEIGHT = 38;
  const BUFFER_ROWS = 10;
  const COLUMN_CONFIGS = [
    { key: "상태",        fixed: true,  hideable: false, minWidth: 120, maxWidth: 120 },
    { key: "Lot",         fixed: true,  hideable: false, minWidth: 110, maxWidth: 150 },
    { key: "CODE",        fixed: true,  hideable: false, minWidth: 110, maxWidth: 150 },
    { key: "WO",          fixed: true,  hideable: false, minWidth: 140, maxWidth: 200 },
    { key: "S/N",         fixed: true,  hideable: false, minWidth: 130, maxWidth: 220 },
    { key: "Customer",    fixed: true,  hideable: false, minWidth: 150, maxWidth: 340 },
    { key: "Line",        fixed: true,  hideable: false, minWidth: 140, maxWidth: 240 },
    { key: "Model",       fixed: true,  hideable: false, minWidth: 150, maxWidth: 340 },
    { key: "FSC",         fixed: false, hideable: true,  minWidth: 100, maxWidth: 220 },
    { key: "EFEM",        fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "TM",          fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "PM",          fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "SU",          fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "Harness",     fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "Stage",       fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "Tuning",      fixed: false, hideable: true,  minWidth: 100, maxWidth: 180 },
    { key: "생산시작일",   fixed: false, hideable: true,  minWidth: 140, maxWidth: 140 },
    { key: "Tuning시작일", fixed: false, hideable: true,  minWidth: 140, maxWidth: 140 },
    { key: "생산완료일",   fixed: false, hideable: true,  minWidth: 140, maxWidth: 140 },
    { key: "Remark",      fixed: false, hideable: true,  minWidth: 360, maxWidth: 900 }
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
    return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), delay); };
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
      if (columnWidths[col]) return;
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
        const d = document.createElement("div"); d.className = "col-chip-divider"; bar.appendChild(d);
      }
      const chip = document.createElement("span");
      chip.className = "col-chip" + (NON_HIDEABLE_COLUMNS.has(col) ? " fixed" : (visibleColumns.has(col) ? " on" : ""));
      chip.textContent = col; chip.dataset.column = col;
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

  function buildHeaderRow() {
    const row = document.createElement("div");
    row.className = "table-row header-row";
    getVisibleColumns().forEach(col => {
      const cell = document.createElement("div");
      cell.className = "table-cell header-cell";
      cell.dataset.col = col;
      const w = getColumnWidth(col);
      cell.style.width = w + "px";
      cell.style.minWidth = w + "px";
      cell.style.maxWidth = w + "px";
      cell.style.flexShrink = "0";
      cell.style.flexGrow = "0";
      cell.style.boxSizing = "border-box";
      cell.style.overflow = "hidden";
      applyStickyStyles(cell, col, "header");

      const label = document.createElement("span");
      label.textContent = col + getSortIndicator(col);
      label.style.cssText = "display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;flex:1;min-width:0;padding-right:10px;box-sizing:border-box;";
      label.onclick = () => cycleSort(col);
      cell.appendChild(label);

      const handle = document.createElement("div");
      handle.style.position = "absolute";
      handle.style.right = "0";
      handle.style.top = "0";
      handle.style.width = "5px";
      handle.style.height = "100%";
      handle.style.cursor = "col-resize";
      handle.style.zIndex = "50";
      handle.style.background = "transparent";
      handle.addEventListener("mouseenter", () => { handle.style.background = "rgba(124,58,237,0.35)"; });
      handle.addEventListener("mouseleave", () => { if (!resizeState) handle.style.background = "transparent"; });
      handle.addEventListener("mousedown", function(e) {
        e.preventDefault(); e.stopPropagation();
        resizeState = { col, startX: e.clientX, startW: getColumnWidth(col), handle };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      });
      cell.appendChild(handle);
      row.appendChild(cell);
    });
    return row;
  }

  function ensureRelativeForHandle(cell, col) {
    if (!isStickyCol(col)) { cell.style.position = "relative"; }
  }

  document.addEventListener("mousemove", function(e) {
    if (!resizeState) return;
    const diff = e.clientX - resizeState.startX;
    const cfg = COLUMN_CONFIGS.find(c => c.key === resizeState.col);
    const minW = cfg ? cfg.minWidth : 60;
    const newW = Math.max(minW, resizeState.startW + diff);
    columnWidths[resizeState.col] = newW;
    document.querySelectorAll(`[data-col="${resizeState.col}"]`).forEach(c => {
      c.style.width = newW + "px";
      c.style.minWidth = newW + "px";
      c.style.maxWidth = newW + "px";
    });
    rebuildStickyLeftMap();
    syncTableInnerWidth();
  });

  document.addEventListener("mouseup", function() {
    if (!resizeState) return;
    if (resizeState.handle) resizeState.handle.style.background = "transparent";
    resizeState = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    rebuildStickyLeftMap();
    renderTableStructure();
    applyFilters({ resetScrollTop: false });
  });

  function buildFilterRow() {
    const row = document.createElement("div");
    row.className = "table-row filter-row";
    getVisibleColumns().forEach(col => {
      const cell = document.createElement("div");
      cell.className = "table-cell filter-cell";
      cell.dataset.col = col;
      const w = getColumnWidth(col);
      cell.style.width = w + "px";
      cell.style.minWidth = w + "px";
      cell.style.maxWidth = w + "px";
      cell.style.flexShrink = "0";
      cell.style.flexGrow = "0";
      cell.style.boxSizing = "border-box";
      applyStickyStyles(cell, col, "filter");

      const inp = document.createElement("input");
      inp.className = "filter-input";
      inp.placeholder = "필터 (콤마로 OR)";
      inp.value = columnFilters[col] || "";
      inp.dataset.column = col;
      inp.addEventListener("compositionstart", () => { isComposing = true; });
      inp.addEventListener("compositionend", e => {
        isComposing = false; columnFilters[col] = e.target.value || "";
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
    getVisibleColumns().forEach((col, i) => {
      const cell = newRow.querySelectorAll('.table-cell')[i];
      if (cell && !isStickyCol(col)) cell.style.position = "relative";
    });
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
    const hRow = buildHeaderRow();
    getVisibleColumns().forEach((col, i) => {
      const cell = hRow.querySelectorAll('.table-cell')[i];
      if (cell && !isStickyCol(col)) cell.style.position = "relative";
    });
    header.appendChild(hRow);
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
    const el = document.getElementById(targetId); el.innerHTML = "";
    pairs.forEach(p => {
      const lab = document.createElement("div"); lab.className = "detail-label"; lab.textContent = p[0];
      const val = document.createElement("div"); val.textContent = rowData[p[1]] || "";
      el.appendChild(lab); el.appendChild(val);
    });
  }

  function openDetailModal(rowData) {
    document.getElementById("modalTitle").textContent = "WO 상세 - " + (rowData["WO"] || "");
    fillDetail("detailBasic",[["상태","상태"],["Lot","Lot"],["CODE","CODE"],["WO","WO"],["S/N","S/N"],["Customer","Customer"],["Line","Line"],["Model","Model"],["FSC","FSC"]], rowData);
    fillDetail("detailProcess",[["EFEM","EFEM"],["TM","TM"],["PM","PM"],["SU","SU"],["Harness","Harness"],["Stage","Stage"],["Tuning","Tuning"]], rowData);
    fillDetail("detailSchedule",[["생산시작일","생산시작일"],["Tuning시작일","Tuning시작일"],["생산완료일","생산완료일"]], rowData);
    document.getElementById("detailRemark").textContent = rowData["Remark"] || "";
    document.getElementById("detailModal").classList.add("show");
  }
  function closeDetailModal() { document.getElementById("detailModal").classList.remove("show"); }
  window.closeDetailModal = closeDetailModal;

  function buildDataRow(rowData, rowIndex) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.style.cssText = `position:absolute;top:${rowIndex*ROW_HEIGHT}px;height:${ROW_HEIGHT}px;`;
    getVisibleColumns().forEach(col => {
      const cell = document.createElement("div");
      cell.className = "table-cell data-cell";
      cell.dataset.col = col;
      const w = getColumnWidth(col);
      cell.style.width = w + "px";
      cell.style.minWidth = w + "px";
      cell.style.maxWidth = w + "px";
      cell.style.flexShrink = "0";
      cell.style.flexGrow = "0";
      cell.style.boxSizing = "border-box";
      applyStickyStyles(cell, col, "data");
      if (col === "상태") {
        const span = document.createElement("span");
        span.className = getStatusClass(rowData[col] || "");
        span.textContent = rowData[col] || "";
        cell.appendChild(span);
      } else if (col === "WO") {
        const link = document.createElement("span");
        link.className = "wo-link"; link.textContent = rowData[col] || "";
        link.onclick = e => { e.stopPropagation(); openDetailModal(rowData); };
        cell.appendChild(link);
      } else { cell.textContent = safeText(rowData[col]); }
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
      const av = a[col]||"", bv = b[col]||"";
      const ad = Date.parse(av), bd = Date.parse(bv);
      let r = 0;
      if (!isNaN(ad)&&!isNaN(bd)&&String(av).length>=8&&String(bv).length>=8) r=ad-bd;
      else {
        const an=Number(av), bn=Number(bv);
        if (!isNaN(an)&&!isNaN(bn)&&String(av).trim()&&String(bv).trim()) r=an-bn;
        else r=String(av).localeCompare(String(bv),"ko");
      }
      return dir==="asc"?r:-r;
    });
  }

  function applyFilters(options) {
    const opts = Object.assign({ resetScrollTop: true }, options || {});
    const searchText    = normalizeText(document.getElementById("searchText").value);
    const filterLot     = normalizeText(document.getElementById("filterLot").value);
    const filterCode    = normalizeText(document.getElementById("filterCode").value);
    const filterWo      = normalizeText(document.getElementById("filterWo").value);
    const filterAssembly= normalizeText(document.getElementById("filterAssemblyBp").value);
    const filterTuning  = normalizeText(document.getElementById("filterTuningBp").value);
    const filterDate    = document.getElementById("filterDate").value;
    const filterDateFrom= document.getElementById("filterDateFrom").value;
    const filterDateTo  = document.getElementById("filterDateTo").value;

    const data = rawData.filter(row => {
      if (searchText) {
        const full = normalizeText(ALL_COLUMNS.map(c=>row[c]||"").join(" "));
        if (!full.includes(searchText)) return false;
      }
      if (filterLot   && !normalizeText(row["Lot"]||"").includes(filterLot))   return false;
      if (filterCode  && !normalizeText(row["CODE"]||"").includes(filterCode))  return false;
      if (filterWo    && !normalizeText(row["WO"]||"").includes(filterWo))      return false;
      if (filterAssembly) {
        const val = normalizeText([row["EFEM"],row["TM"],row["PM"],row["SU"]].map(v=>v||"").join(" "));
        if (!val.includes(filterAssembly)) return false;
      }
      if (filterTuning && !normalizeText(row["Tuning"]||"").includes(filterTuning)) return false;
      if (filterDate) {
        const s=row["생산시작일"]||"", e=row["생산완료일"]||"";
        if (!(s<=filterDate&&filterDate<=e)&&s!==filterDate&&e!==filterDate) return false;
      }
      if (filterDateFrom||filterDateTo) {
        const s=row["생산시작일"]||"", e=row["생산완료일"]||"";
        if (filterDateFrom&&filterDateTo){if(e<filterDateFrom||s>filterDateTo)return false;}
        else if (filterDateFrom){if(e&&e<filterDateFrom)return false;}
        else if (filterDateTo){if(s&&s>filterDateTo)return false;}
      }
      for (const col of ALL_COLUMNS) {
        const raw = (columnFilters[col] || "").trim();
        if (!raw) continue;
        const terms = raw.split(",").map(t => normalizeText(t.trim())).filter(t => t.length > 0);
        if (terms.length === 0) continue;
        const cellVal = normalizeText(row[col] || "");
        const matched = terms.some(t => cellVal.includes(t));
        if (!matched) return false;
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
    document.getElementById("kpiPlan").textContent     = filteredData.filter(r=>r["상태"]==="생산예정").length.toLocaleString();
    document.getElementById("kpiAssembly").textContent = filteredData.filter(r=>r["상태"]==="조립중").length.toLocaleString();
    document.getElementById("kpiTuning").textContent   = filteredData.filter(r=>r["상태"]==="Tuning중").length.toLocaleString();
  }

  function toDateObj(s) {
    if (!s) return null; const d=new Date(s);
    if (isNaN(d.getTime())) return null; d.setHours(0,0,0,0); return d;
  }
  function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);x.setHours(0,0,0,0);return x;}
  function diffDays(a,b){return Math.round((b-a)/(24*60*60*1000));}
  function isBetween(t,s,e){return !!(t&&s&&e&&s<=t&&t<=e);}

  function renderTimeline() {
    const wrap=document.getElementById("timelineWrap"); wrap.innerHTML="";
    const rows=filteredData.map(r=>({
      label:`${r["Lot"]||""} / ${r["WO"]||""}`,status:r["상태"]||"",
      gS:toDateObj(r["phase_green_start"]),gE:toDateObj(r["phase_green_end"]),
      bS:toDateObj(r["phase_blue_start"]),bE:toDateObj(r["phase_blue_end"])
    })).filter(r=>r.gS||r.bS||r.bE).slice(0,100);
    if(!rows.length){wrap.innerHTML="<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>";return;}
    let minDate=null,maxDate=null;
    rows.forEach(r=>{
      [r.gS,r.bS].filter(Boolean).forEach(d=>{if(!minDate||d<minDate)minDate=d;});
      [r.gE,r.bE].filter(Boolean).forEach(d=>{if(!maxDate||d>maxDate)maxDate=d;});
    });
    if(!minDate||!maxDate){wrap.innerHTML="<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>";return;}
    const total=diffDays(minDate,maxDate),capped=Math.min(total,45);
    const tbl=document.createElement("table");tbl.className="timeline-table";
    const thead=document.createElement("thead"),hr=document.createElement("tr");
    const fth=document.createElement("th");fth.className="label-col";fth.textContent="Lot / WO";hr.appendChild(fth);
    const today=toDateObj(TODAY_STR);
    for(let i=0;i<=capped;i++){
      const cur=addDays(minDate,i);const th=document.createElement("th");
      th.textContent=formatDate(cur).slice(5);
      if(today&&cur.getTime()===today.getTime())th.classList.add("today-col");
      hr.appendChild(th);
    }
    thead.appendChild(hr);tbl.appendChild(thead);
    const tbody=document.createElement("tbody");
    rows.forEach(r=>{
      const tr=document.createElement("tr");
      const tdL=document.createElement("td");tdL.className="label-col";
      tdL.textContent=`${r.label} (${r.status})`;tr.appendChild(tdL);
      for(let i=0;i<=capped;i++){
        const cur=addDays(minDate,i);const td=document.createElement("td");
        if(today&&cur.getTime()===today.getTime())td.classList.add("today-col");
        const inner=document.createElement("div");inner.className="timeline-cell-inner";
        if(isBetween(cur,r.bS,r.bE)){const p=document.createElement("div");p.className="timeline-pill pill-blue";inner.appendChild(p);}
        else if(isBetween(cur,r.gS,r.gE)){const p=document.createElement("div");p.className="timeline-pill pill-green";inner.appendChild(p);}
        td.appendChild(inner);tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);wrap.appendChild(tbl);
    if(total>capped){
      const note=document.createElement("div");note.className="timeline-note";
      note.textContent=`일정 범위가 길어 최초 46일 구간만 표시했습니다. 전체 범위: ${formatDate(minDate)} ~ ${formatDate(maxDate)}`;
      wrap.appendChild(note);
    }
  }

  const debouncedApplyFilters=debounce(()=>applyFilters({resetScrollTop:true}),200);
  const debouncedApplyColumnFilters=debounce(()=>applyFilters({resetScrollTop:false}),300);

  document.getElementById("searchText").addEventListener("input",debouncedApplyFilters);
  document.getElementById("filterLot").addEventListener("input",debouncedApplyFilters);
  document.getElementById("filterCode").addEventListener("input",debouncedApplyFilters);
  document.getElementById("filterWo").addEventListener("input",debouncedApplyFilters);
  document.getElementById("filterAssemblyBp").addEventListener("input",debouncedApplyFilters);
  document.getElementById("filterTuningBp").addEventListener("input",debouncedApplyFilters);
  document.getElementById("filterDate").addEventListener("change",()=>applyFilters({resetScrollTop:true}));
  document.getElementById("filterDateFrom").addEventListener("change",()=>applyFilters({resetScrollTop:true}));
  document.getElementById("filterDateTo").addEventListener("change",()=>applyFilters({resetScrollTop:true}));
  document.getElementById("tableScroll").addEventListener("scroll",()=>renderVirtualRows(false));
  document.getElementById("detailModal").addEventListener("click",closeDetailModal);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDetailModal();});

  const reloadBtn=document.getElementById("reloadBtn");
  if(reloadBtn){
    reloadBtn.addEventListener("click",async function(){
      const res=await fetch("/api/reload-data",{method:"POST",body:new FormData(),credentials:"same-origin"});
      if(!res.ok){alert("데이터 재로딩 실패");return;}
      await loadData();alert("데이터 재로딩 완료");
    });
  }

  // ═══ BP사 현황 ═══════════════════════════════════════════════
  const BP_PROCESSES = ["EFEM", "TM", "PM", "SU", "Harness", "Tuning"];
  const BP_ORDER = ["이지스", "SAM", "아셈", "SE&T", "HTC", "나우", "금송"];
  const CARD_COLORS = ["#7C3AED","#1D9E75","#D85A30","#378ADD","#BA7517","#D4537E","#6B7280"];

  let bpCurrentGroup = "all";
  let bpCurrentLot = "";
  let bpDateFrom = "";
  let bpDateTo = "";

  function getWoGroup(wo) {
    const w = String(wo || "").toUpperCase();
    if (w.startsWith("WC")) return "PSK";
    if (w.startsWith("HC")) return "PSKH";
    return "other";
  }

  // partner 역할 여부 확인 (한 곳에서 관리)
  function getMyPartner() {
    return (CURRENT_USER.role === "partner" && CURRENT_USER.partner)
      ? CURRENT_USER.partner : null;
  }

  // BP사 현황 소스 데이터 필터링
  function getBpSource(group) {
    const myPartner = getMyPartner();
    return rawData.filter(row => {
      if (group !== "all" && getWoGroup(row["WO"]) !== group) return false;
      if (bpCurrentLot) {
        if (!String(row["Lot"] || "").toLowerCase().includes(bpCurrentLot.toLowerCase())) return false;
      }
      if (bpDateFrom || bpDateTo) {
        const s = row["생산시작일"] || "";
        const e = row["생산완료일"] || "";
        if (bpDateFrom && bpDateTo) { if (e < bpDateFrom || s > bpDateTo) return false; }
        else if (bpDateFrom) { if (e && e < bpDateFrom) return false; }
        else if (bpDateTo)   { if (s && s > bpDateTo)   return false; }
      }
      return true;
    });
  }

  function computeBpSummary(group) {
    const myPartner = getMyPartner();
    const source = getBpSource(group);
    const summary = {};
    source.forEach(row => {
      BP_PROCESSES.forEach(proc => {
        const bp = String(row[proc] || "").trim();
        if (!bp) return;
        if (myPartner && bp !== myPartner) return; // partner는 자기 BP사만
        if (!summary[bp]) {
          summary[bp] = {};
          BP_PROCESSES.forEach(p => { summary[bp][p] = 0; });
        }
        summary[bp][proc]++;
      });
    });
    return summary;
  }

  // BP사 현황 공정 건수 카운트 (partner 필터 적용)
  function countProcesses(rows) {
    const myPartner = getMyPartner();
    return rows.reduce((s, row) => {
      return s + BP_PROCESSES.filter(p => {
        const bp = String(row[p] || "").trim();
        return bp && (!myPartner || bp === myPartner);
      }).length;
    }, 0);
  }

  function getBpOrdered(summary) {
    const allBp = Object.keys(summary).filter(bp => bp && bp !== "-");
    return [
      ...BP_ORDER.filter(bp => allBp.includes(bp)),
      ...allBp.filter(bp => !BP_ORDER.includes(bp)).sort()
    ];
  }

  function renderBpKpis() {
    const allSource = getBpSource("all");
    const pskSource = allSource.filter(r => getWoGroup(r["WO"]) === "PSK");
    const pskhSource = allSource.filter(r => getWoGroup(r["WO"]) === "PSKH");
    document.getElementById("bpKpiTotal").textContent = countProcesses(allSource);
    document.getElementById("bpKpiPsk").textContent   = countProcesses(pskSource);
    document.getElementById("bpKpiPskh").textContent  = countProcesses(pskhSource);
  }

  function renderBpCards(summary) {
    const container = document.getElementById("bpCards");
    container.innerHTML = "";
    const ordered = getBpOrdered(summary);
    if (!ordered.length) {
      container.innerHTML = "<div style='padding:16px;color:#6b7280;'>데이터가 없습니다.</div>";
      return;
    }
    ordered.forEach((bp, idx) => {
      const data = summary[bp];
      const total = BP_PROCESSES.reduce((s, p) => s + data[p], 0);
      const maxVal = Math.max(...BP_PROCESSES.map(p => data[p]), 1);
      const color = CARD_COLORS[idx % CARD_COLORS.length];

      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "padding:0;overflow:hidden;";

      const header = document.createElement("div");
      header.style.cssText = `background:${color}18;border-bottom:2px solid ${color};padding:10px 14px;display:flex;justify-content:space-between;align-items:center;`;
      header.innerHTML = `
        <span style="font-size:14px;font-weight:600;color:${color};">${bp}</span>
        <span style="font-size:18px;font-weight:700;color:${color};">${total}</span>
      `;
      card.appendChild(header);

      const body = document.createElement("div");
      body.style.cssText = "padding:10px 14px;";
      BP_PROCESSES.forEach(proc => {
        const cnt = data[proc];
        const pct = Math.round((cnt / maxVal) * 100);
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:0.5px solid #f0f0f0;";
        row.innerHTML = `
          <span style="font-size:12px;color:#6b7280;min-width:52px;">${proc}</span>
          <div style="flex:1;height:5px;background:#f3f4f6;border-radius:3px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
          </div>
          <span style="font-size:12px;font-weight:600;min-width:20px;text-align:right;">${cnt}</span>
        `;
        body.appendChild(row);
      });
      card.appendChild(body);
      container.appendChild(card);
    });
  }

  function renderBpMatrix(summary) {
    const table = document.getElementById("bpMatrix");
    table.innerHTML = "";
    const ordered = getBpOrdered(summary);

    const thead = document.createElement("thead");
    const hRow = document.createElement("tr");
    ["BP사", ...BP_PROCESSES, "합계"].forEach((h, i) => {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.cssText = `padding:8px 12px;text-align:${i===0?"left":"center"};background:#7c3aed;color:white;font-size:13px;white-space:nowrap;`;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const colTotals = {};
    BP_PROCESSES.forEach(p => { colTotals[p] = 0; });

    ordered.forEach((bp, idx) => {
      const data = summary[bp];
      const total = BP_PROCESSES.reduce((s, p) => s + data[p], 0);
      const maxVal = Math.max(...BP_PROCESSES.map(p => data[p]), 1);
      const color = CARD_COLORS[idx % CARD_COLORS.length];
      // Tuning은 amber 색상으로 구분
      const tuningColor = "#D97706";

      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "padding:0;overflow:hidden;";

      // 카드 헤더
      const header = document.createElement("div");
      header.style.cssText = `background:${color}18;border-bottom:2px solid ${color};padding:10px 14px;display:flex;justify-content:space-between;align-items:center;`;
      header.innerHTML = `
        <span style="font-size:13px;font-weight:500;color:${color};">${bp}</span>
        <span style="font-size:20px;font-weight:500;color:${color};">${total}</span>
      `;
      card.appendChild(header);

      // 세로 바 차트 영역
      const body = document.createElement("div");
      body.style.cssText = "padding:12px 14px 10px;";

      const barGroup = document.createElement("div");
      barGroup.style.cssText = "display:flex;gap:6px;align-items:flex-end;height:80px;justify-content:space-around;margin-bottom:6px;";

      BP_PROCESSES.forEach(proc => {
        const cnt = data[proc];
        const pct = Math.round((cnt / maxVal) * 100);
        const barColor = proc === "Tuning" ? tuningColor : color;

        const col = document.createElement("div");
        col.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;";

        // 수치
        const valEl = document.createElement("span");
        valEl.style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-primary);line-height:1;";
        valEl.textContent = cnt;

        // 바 래퍼 (높이 고정 60px)
        const barWrap = document.createElement("div");
        barWrap.style.cssText = "width:100%;display:flex;align-items:flex-end;height:60px;";

        const bar = document.createElement("div");
        bar.style.cssText = `width:100%;height:${Math.max(pct, cnt > 0 ? 2 : 0)}%;background:${barColor};border-radius:3px 3px 0 0;`;

        barWrap.appendChild(bar);

        // 공정 라벨
        const labelEl = document.createElement("span");
        labelEl.style.cssText = "font-size:10px;color:var(--color-text-secondary);white-space:nowrap;";
        labelEl.textContent = proc === "Harness" ? "Hrn" : proc === "Tuning" ? "Tng" : proc;

        col.appendChild(valEl);
        col.appendChild(barWrap);
        col.appendChild(labelEl);
        barGroup.appendChild(col);
      });

      body.appendChild(barGroup);

      // 베이스라인
      const baseline = document.createElement("div");
      baseline.style.cssText = "border-top:0.5px solid var(--color-border-tertiary);margin:0 -14px;";
      body.appendChild(baseline);

      card.appendChild(body);
      container.appendChild(card);
    });

      const tdTotal = document.createElement("td");
      tdTotal.textContent = rowTotal;
      tdTotal.style.cssText = "padding:8px 12px;text-align:center;font-size:13px;font-weight:700;border-bottom:0.5px solid #e5e7eb;background:#f3f0ff;color:#7c3aed;";
      tr.appendChild(tdTotal);
      tbody.appendChild(tr);
    });

    if (ordered.length > 0) {
      const trSum = document.createElement("tr");
      trSum.style.background = "#ede9fe";
      const tdLabel = document.createElement("td");
      tdLabel.textContent = "합계";
      tdLabel.style.cssText = "padding:8px 12px;font-weight:700;font-size:13px;border-top:2px solid #7c3aed;";
      trSum.appendChild(tdLabel);
      let grandTotal = 0;
      BP_PROCESSES.forEach(proc => {
        const td = document.createElement("td");
        td.textContent = colTotals[proc];
        td.style.cssText = "padding:8px 12px;text-align:center;font-size:13px;font-weight:700;border-top:2px solid #7c3aed;";
        grandTotal += colTotals[proc];
        trSum.appendChild(td);
      });
      const tdGrand = document.createElement("td");
      tdGrand.textContent = grandTotal;
      tdGrand.style.cssText = "padding:8px 12px;text-align:center;font-size:13px;font-weight:700;border-top:2px solid #7c3aed;background:#ddd6fe;color:#5b21b6;";
      trSum.appendChild(tdGrand);
      tbody.appendChild(trSum);
    }
    table.appendChild(tbody);
  }

  function refreshBpView() {
    const summary = computeBpSummary(bpCurrentGroup);
    renderBpKpis();
    renderBpCards(summary);
    renderBpMatrix(summary);
  }

  function showBpView() {
    document.getElementById("bpView").style.display = "block";
    document.querySelectorAll(".app-shell > .card, .kpis").forEach(el => {
      el.style.display = "none";
    });
    refreshBpView();
  }

  function showMainView() {
    document.getElementById("bpView").style.display = "none";
    document.querySelectorAll(".app-shell > .card, .kpis").forEach(el => {
      el.style.display = "";
    });
  }

  (function initBpEvents() {
    const bpViewBtn = document.getElementById("bpViewBtn");
    if (bpViewBtn) bpViewBtn.addEventListener("click", showBpView);

    const bpBackBtn = document.getElementById("bpBackBtn");
    if (bpBackBtn) bpBackBtn.addEventListener("click", showMainView);

    const filterBtns = document.querySelectorAll(".bp-filter-btn");
    filterBtns.forEach(btn => {
      btn.addEventListener("click", function () {
        filterBtns.forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        bpCurrentGroup = this.dataset.group;
        refreshBpView();
      });
    });

    const lotInput = document.getElementById("bpLotFilter");
    if (lotInput) {
      lotInput.addEventListener("input", function () {
        bpCurrentLot = this.value.trim();
        refreshBpView();
      });
    }

    const dateFrom = document.getElementById("bpDateFrom");
    if (dateFrom) {
      dateFrom.addEventListener("change", function () {
        bpDateFrom = this.value;
        refreshBpView();
      });
    }

    const dateTo = document.getElementById("bpDateTo");
    if (dateTo) {
      dateTo.addEventListener("change", function () {
        bpDateTo = this.value;
        refreshBpView();
      });
    }

    const dateReset = document.getElementById("bpDateReset");
    if (dateReset) {
      dateReset.addEventListener("click", function () {
        bpDateFrom = ""; bpDateTo = "";
        if (dateFrom) dateFrom.value = "";
        if (dateTo) dateTo.value = "";
        refreshBpView();
      });
    }
  })();
  // ═══ BP사 현황 끝 ═══════════════════════════════════════════

  // ═══ PDF 인쇄 ═══════════════════════════════════════════════
  function buildPrintTable() {
    const container = document.getElementById("printTable");
    container.innerHTML = "";

    const title = document.createElement("div");
    title.style.cssText = "margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #7c3aed;";
    title.innerHTML = `
      <div style="font-size:16px;font-weight:700;color:#7c3aed;">Partner Outsourcing Status</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">
        기준일: ${TODAY_STR} &nbsp;|&nbsp; 총 ${filteredData.length}건
        &nbsp;|&nbsp; 조립중: ${filteredData.filter(r=>r["상태"]==="조립중").length}건
        &nbsp;|&nbsp; Tuning중: ${filteredData.filter(r=>r["상태"]==="Tuning중").length}건
        &nbsp;|&nbsp; 출력일시: ${new Date().toLocaleString("ko-KR")}
      </div>
    `;
    container.appendChild(title);

    const printCols = getVisibleColumns().filter(c => c !== "Remark");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const hRow = document.createElement("tr");
    printCols.forEach(col => {
      const th = document.createElement("th");
      th.textContent = col;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    filteredData.forEach(rowData => {
      const tr = document.createElement("tr");
      printCols.forEach(col => {
        const td = document.createElement("td");
        td.textContent = rowData[col] || "";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function printMainDashboard() {
    buildPrintTable();
    document.getElementById("printTable").style.display = "block";
    const tableCard = document.querySelector(".card:has(#tableScroll)");
    if (tableCard) tableCard.style.display = "none";
    window.print();
    document.getElementById("printTable").style.display = "none";
    if (tableCard) tableCard.style.display = "";
  }

  function printBpDashboard() {
    window.print();
  }

  (function initPrintEvents() {
    const mainPdfBtn = document.getElementById("mainPdfBtn");
    if (mainPdfBtn) mainPdfBtn.addEventListener("click", printMainDashboard);

    const bpPdfBtn = document.getElementById("bpPdfBtn");
    if (bpPdfBtn) bpPdfBtn.addEventListener("click", printBpDashboard);
  })();
  // ═══ PDF 인쇄 끝 ═══════════════════════════════════════════

  loadData();
})();
