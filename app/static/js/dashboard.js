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
    let columnFilters = createEmptyColumnFilters();
    let sortState = { column: null, direction: null };
    let columnWidths = {};
    let stickyLeftMap = {};
    let currentRenderedRange = { start: -1, end: -1 };
    let isColumnFilterComposing = false;

    const textMeasureCanvas = document.createElement("canvas");
    const textMeasureCtx = textMeasureCanvas.getContext("2d");
    textMeasureCtx.font = "13px Malgun Gothic, Segoe UI, sans-serif";

    function createEmptyColumnFilters() {
        const result = {};
        ALL_COLUMNS.forEach(function (col) {
            result[col] = "";
        });
        return result;
    }

    function getColumnConfig(col) {
        return COLUMN_CONFIGS.find(item => item.key === col) || null;
    }

    function normalizeText(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim().toLowerCase().replace(/[^0-9a-zA-Z가-힣]+/g, "");
    }

    function debounce(fn, delay) {
        let timer = null;
        return function () {
            const args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(null, args);
            }, delay);
        };
    }

    function uniqueSorted(values) {
        return Array.from(
            new Set(values.filter((v) => String(v || "").trim() !== ""))
        ).sort((a, b) => String(a).localeCompare(String(b), "ko"));
    }

    function fillSelect(selectEl, allLabel, items) {
        selectEl.innerHTML = "";
        const allOpt = document.createElement("option");
        allOpt.value = "";
        allOpt.textContent = allLabel;
        selectEl.appendChild(allOpt);

        items.forEach(function (item) {
            const opt = document.createElement("option");
            opt.value = item;
            opt.textContent = item;
            selectEl.appendChild(opt);
        });
    }

    function getRowCombinedPartnerText(row) {
        const fields = ["EFEM", "TM", "PM", "SU", "Harness", "Stage", "Tuning", "Remark"];
        return fields.map((f) => normalizeText(row[f] || "")).join("");
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
        if (!res.ok) {
            alert("데이터 조회에 실패했습니다.");
            return;
        }

        const json = await res.json();
        rawData = json.records || [];

        setUserBadge();
        buildFilterOptions();
        buildColumnToggleUI();
        computeColumnWidths();
        renderTableStructure();

        document.getElementById("filterDate").value = TODAY_STR;
        applyFilters({ resetScrollTop: true });
    }

    function buildFilterOptions() {
        fillSelect(document.getElementById("filterStatus"), "전체", uniqueSorted(rawData.map((r) => r["상태"])));
        fillSelect(document.getElementById("filterCustomer"), "전체", uniqueSorted(rawData.map((r) => r["Customer"])));
        fillSelect(document.getElementById("filterLine"), "전체", uniqueSorted(rawData.map((r) => r["Line"])));
    }

    function getVisibleColumns() {
        return COLUMN_CONFIGS
            .map(col => col.key)
            .filter(col => visibleColumns.has(col));
    }

    function estimateTextWidth(text, minWidth, maxWidth) {
        const measured = Math.ceil(textMeasureCtx.measureText(String(text || "")).width) + 28;
        return Math.max(minWidth, Math.min(maxWidth, measured));
    }

    function getColumnWidthRange(col) {
        const config = getColumnConfig(col);
        if (!config) {
            return { minWidth: 100, maxWidth: 260 };
        }
        return {
            minWidth: config.minWidth,
            maxWidth: config.maxWidth
        };
    }

    function computeColumnWidths() {
        const widths = {};
        const sourceRows = rawData;

        ALL_COLUMNS.forEach(function (col) {
            const range = getColumnWidthRange(col);
            let width = estimateTextWidth(col, range.minWidth, range.maxWidth);

            for (const row of sourceRows) {
                width = Math.max(
                    width,
                    estimateTextWidth(row[col] || "", range.minWidth, range.maxWidth)
                );
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

    function getColumnWidth(col) {
        return columnWidths[col] || 120;
    }

    function isStickyColumn(col) {
        return FIXED_COLUMNS.includes(col) && visibleColumns.has(col);
    }

    function isLastStickyColumn(col) {
        const visibleSticky = FIXED_COLUMNS.filter((c) => visibleColumns.has(c));
        return visibleSticky.length > 0 && visibleSticky[visibleSticky.length - 1] === col;
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

        COLUMN_CONFIGS.forEach(function (colConfig) {
            const col = colConfig.key;

            const label = document.createElement("label");
            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.checked = visibleColumns.has(col);
            chk.disabled = NON_HIDEABLE_COLUMNS.has(col);

            chk.onchange = function () {
                if (chk.checked) visibleColumns.add(col);
                else visibleColumns.delete(col);

                computeColumnWidths();
                renderTableStructure();
                applyFilters({ preserveColumnFilterFocus: true, resetScrollTop: false });
            };

            const span = document.createElement("span");
            span.textContent = col;

            label.appendChild(chk);
            label.appendChild(span);
            box.appendChild(label);
        });
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
        applyFilters({ preserveColumnFilterFocus: true, resetScrollTop: true });
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

    function buildFilterRow() {
        const row = document.createElement("div");
        row.className = "table-row filter-row";

        getVisibleColumns().forEach(function (col) {
            const cell = document.createElement("div");
            cell.className = "table-cell filter-cell";
            cell.style.width = getColumnWidth(col) + "px";
            cell.style.minWidth = getColumnWidth(col) + "px";

            applyStickyStyles(cell, col, "filter");

            const inp = document.createElement("input");
            inp.className = "filter-input";
            inp.type = "text";
            inp.placeholder = "필터";
            inp.value = columnFilters[col] || "";
            inp.dataset.column = col;

            inp.addEventListener("compositionstart", function () {
                isColumnFilterComposing = true;
            });

            inp.addEventListener("compositionend", function (e) {
                isColumnFilterComposing = false;
                columnFilters[col] = e.target.value || "";
                debouncedApplyColumnFilters();
            });

            inp.addEventListener("input", function (e) {
                columnFilters[col] = e.target.value || "";
                if (e.isComposing || isColumnFilterComposing) return;
                debouncedApplyColumnFilters();
            });

            cell.appendChild(inp);
            row.appendChild(cell);
        });

        return row;
    }

    function renderHeaderRow() {
        const header = document.getElementById("tableHeader");
        const currentHeaderRow = header.querySelector(".header-row");
        const newHeaderRow = buildHeaderRow();

        if (currentHeaderRow) header.replaceChild(newHeaderRow, currentHeaderRow);
        else header.prepend(newHeaderRow);
    }

    function renderFilterRow() {
        const header = document.getElementById("tableHeader");
        const currentFilterRow = header.querySelector(".filter-row");
        const newFilterRow = buildFilterRow();

        if (currentFilterRow) header.replaceChild(newFilterRow, currentFilterRow);
        else header.appendChild(newFilterRow);
    }

    function syncTableInnerWidth() {
        const inner = document.getElementById("tableInner");
        let totalWidth = 0;

        getVisibleColumns().forEach(function (col) {
            totalWidth += getColumnWidth(col);
        });

        inner.style.width = totalWidth + "px";
    }

    function renderTableStructure() {
        const header = document.getElementById("tableHeader");
        header.innerHTML = "";
        header.appendChild(buildHeaderRow());
        header.appendChild(buildFilterRow());
        syncTableInnerWidth();
    }

    function captureColumnFilterFocusState() {
        const active = document.activeElement;
        if (!active || !active.classList || !active.classList.contains("filter-input")) return null;

        return {
            column: active.dataset.column || "",
            start: typeof active.selectionStart === "number" ? active.selectionStart : null,
            end: typeof active.selectionEnd === "number" ? active.selectionEnd : null
        };
    }

    function restoreColumnFilterFocusState(state) {
        if (!state || !state.column) return;

        const target = document.querySelector(`.filter-input[data-column="${CSS.escape(state.column)}"]`);
        if (!target) return;

        target.focus();

        if (typeof state.start === "number" && typeof state.end === "number") {
            try {
                target.setSelectionRange(state.start, state.end);
            } catch (err) {
                // ignore selection restore failures
            }
        }
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
        fillDetail(
            "detailBasic",
            [["상태", "상태"], ["Lot", "Lot"], ["CODE", "CODE"], ["WO", "WO"], ["S/N", "S/N"], ["Customer", "Customer"], ["Line", "Line"], ["Model", "Model"], ["FSC", "FSC"]],
            rowData
        );
        fillDetail(
            "detailProcess",
            [["EFEM", "EFEM"], ["TM", "TM"], ["PM", "PM"], ["SU", "SU"], ["Harness", "Harness"], ["Stage", "Stage"], ["Tuning", "Tuning"]],
            rowData
        );
        fillDetail(
            "detailSchedule",
            [["생산시작일", "생산시작일"], ["Tuning시작일", "Tuning시작일"], ["생산완료일", "생산완료일"]],
            rowData
        );

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
                link.onclick = function (e) {
                    e.stopPropagation();
                    openDetailModal(rowData);
                };
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

        currentRenderedRange = { start: start, end: end };
        body.innerHTML = "";
        body.style.height = filteredData.length * ROW_HEIGHT + "px";

        for (let i = start; i < end; i++) {
            body.appendChild(buildDataRow(filteredData[i], i));
        }
    }

    function sortData(data) {
        if (!sortState.column || !sortState.direction) return data.slice();

        const col = sortState.column;
        const direction = sortState.direction;

        return data.slice().sort(function (a, b) {
            const av = a[col] || "";
            const bv = b[col] || "";
            const ad = Date.parse(av);
            const bd = Date.parse(bv);
            let result = 0;

            if (!Number.isNaN(ad) && !Number.isNaN(bd) && String(av).length >= 8 && String(bv).length >= 8) {
                result = ad - bd;
            } else {
                const an = Number(av);
                const bn = Number(bv);

                if (!Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== "" && String(bv).trim() !== "") {
                    result = an - bn;
                } else {
                    result = String(av).localeCompare(String(bv), "ko");
                }
            }

            return direction === "asc" ? result : -result;
        });
    }

    function applyFilters(options) {
        const opts = Object.assign(
            { preserveColumnFilterFocus: false, resetScrollTop: true },
            options || {}
        );
        const focusState = opts.preserveColumnFilterFocus
            ? captureColumnFilterFocusState()
            : null;

        const searchText = normalizeText(document.getElementById("searchText").value);
        const filterStatus = document.getElementById("filterStatus").value;
        const filterCustomer = document.getElementById("filterCustomer").value;
        const filterLine = document.getElementById("filterLine").value;
        const filterPartnerText = normalizeText(document.getElementById("filterPartnerText").value);
        const filterDate = document.getElementById("filterDate").value;

        const data = rawData.filter(function (row) {
            const fullText = normalizeText([
                row["상태"], row["Lot"], row["CODE"], row["WO"], row["S/N"],
                row["Customer"], row["Line"], row["Model"], row["FSC"],
                row["EFEM"], row["TM"], row["PM"], row["SU"], row["Harness"],
                row["Stage"], row["Tuning"], row["Remark"]
            ].join(" "));

            const partnerText = getRowCombinedPartnerText(row);

            if (searchText && !fullText.includes(searchText)) return false;
            if (filterStatus && row["상태"] !== filterStatus) return false;
            if (filterCustomer && row["Customer"] !== filterCustomer) return false;
            if (filterLine && row["Line"] !== filterLine) return false;
            if (filterPartnerText && !partnerText.includes(filterPartnerText)) return false;

            if (filterDate) {
                const s = row["생산시작일"] || "";
                const e = row["생산완료일"] || "";
                if (!(s <= filterDate && filterDate <= e) && s !== filterDate && e !== filterDate) {
                    return false;
                }
            }

            for (const col of ALL_COLUMNS) {
                const f = normalizeText(columnFilters[col] || "");
                if (!f) continue;

                const cell = normalizeText(row[col] || "");
                if (!cell.includes(f)) return false;
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

        const tableScroll = document.getElementById("tableScroll");
        if (opts.resetScrollTop) {
            tableScroll.scrollTop = 0;
        }

        if (focusState) {
            requestAnimationFrame(function () {
                restoreColumnFilterFocusState(focusState);
            });
        }
    }

    function renderKpis() {
        document.getElementById("kpiTotal").textContent = filteredData.length.toLocaleString();
        document.getElementById("kpiPlan").textContent = filteredData.filter((r) => r["상태"] === "생산예정").length.toLocaleString();
        document.getElementById("kpiAssembly").textContent = filteredData.filter((r) => r["상태"] === "조립중").length.toLocaleString();
        document.getElementById("kpiTuning").textContent = filteredData.filter((r) => r["상태"] === "Tuning중").length.toLocaleString();
    }

    function toDateObj(s) {
        if (!s) return null;
        const d = new Date(s);
        if (isNaN(d.getTime())) return null;
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function formatDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    function addDays(d, n) {
        const x = new Date(d);
        x.setDate(x.getDate() + n);
        x.setHours(0, 0, 0, 0);
        return x;
    }

    function diffDays(a, b) {
        return Math.round((b - a) / (24 * 60 * 60 * 1000));
    }

    function isBetween(target, start, end) {
        return !!(target && start && end && start <= target && target <= end);
    }

    function renderTimeline() {
        const wrap = document.getElementById("timelineWrap");
        wrap.innerHTML = "";

        const rows = filteredData.map(function (r) {
            return {
                label: `${r["Lot"] || ""} / ${r["WO"] || ""}`,
                status: r["상태"] || "",
                greenStart: toDateObj(r["phase_green_start"]),
                greenEnd: toDateObj(r["phase_green_end"]),
                blueStart: toDateObj(r["phase_blue_start"]),
                blueEnd: toDateObj(r["phase_blue_end"])
            };
        }).filter((r) => r.greenStart || r.blueStart || r.blueEnd).slice(0, 100);

        if (!rows.length) {
            wrap.innerHTML = "<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>";
            return;
        }

        let minDate = null;
        let maxDate = null;

        rows.forEach(function (r) {
            [r.greenStart, r.blueStart].filter(Boolean).forEach((d) => {
                if (!minDate || d < minDate) minDate = d;
            });
            [r.greenEnd, r.blueEnd].filter(Boolean).forEach((d) => {
                if (!maxDate || d > maxDate) maxDate = d;
            });
        });

        if (!minDate || !maxDate) {
            wrap.innerHTML = "<div style='padding:12px;'>표시할 일정 데이터가 없습니다.</div>";
            return;
        }

        const totalDays = diffDays(minDate, maxDate);
        const cappedDays = Math.min(totalDays, 45);

        const table = document.createElement("table");
        table.className = "timeline-table";

        const thead = document.createElement("thead");
        const hr = document.createElement("tr");
        const firstTh = document.createElement("th");
        firstTh.className = "label-col";
        firstTh.textContent = "Lot / WO";
        hr.appendChild(firstTh);

        const today = toDateObj(TODAY_STR);
        for (let i = 0; i <= cappedDays; i++) {
            const cur = addDays(minDate, i);
            const th = document.createElement("th");
            th.textContent = formatDate(cur).slice(5);
            if (today && cur.getTime() === today.getTime()) th.classList.add("today-col");
            hr.appendChild(th);
        }

        thead.appendChild(hr);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        rows.forEach(function (r) {
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

                const inGreen = isBetween(cur, r.greenStart, r.greenEnd);
                const inBlue = isBetween(cur, r.blueStart, r.blueEnd);

                if (inBlue) {
                    const pill = document.createElement("div");
                    pill.className = "timeline-pill pill-blue";
                    inner.appendChild(pill);
                } else if (inGreen) {
                    const pill = document.createElement("div");
                    pill.className = "timeline-pill pill-green";
                    inner.appendChild(pill);
                }

                td.appendChild(inner);
                tr.appendChild(td);
            }

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        wrap.appendChild(table);

        if (totalDays > cappedDays) {
            const note = document.createElement("div");
            note.className = "timeline-note";
            note.textContent = `일정 범위가 길어 최초 46일 구간만 표시했습니다. 전체 범위: ${formatDate(minDate)} ~ ${formatDate(maxDate)}`;
            wrap.appendChild(note);
        }
    }

    const debouncedApplyFilters = debounce(function () {
        applyFilters({ preserveColumnFilterFocus: false, resetScrollTop: true });
    }, 200);

    const debouncedApplyColumnFilters = debounce(function () {
        applyFilters({ preserveColumnFilterFocus: true, resetScrollTop: false });
    }, 300);

    document.getElementById("searchText").addEventListener("input", debouncedApplyFilters);
    document.getElementById("filterPartnerText").addEventListener("input", debouncedApplyFilters);
    document.getElementById("filterStatus").addEventListener("change", function () {
        applyFilters({ resetScrollTop: true });
    });
    document.getElementById("filterCustomer").addEventListener("change", function () {
        applyFilters({ resetScrollTop: true });
    });
    document.getElementById("filterLine").addEventListener("change", function () {
        applyFilters({ resetScrollTop: true });
    });
    document.getElementById("filterDate").addEventListener("change", function () {
        applyFilters({ resetScrollTop: true });
    });
    document.getElementById("tableScroll").addEventListener("scroll", function () {
        renderVirtualRows(false);
    });
    document.getElementById("detailModal").addEventListener("click", closeDetailModal);
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeDetailModal();
    });

    const reloadBtn = document.getElementById("reloadBtn");
    if (reloadBtn) {
        reloadBtn.addEventListener("click", async function () {
            const formData = new FormData();
            const res = await fetch("/api/reload-data", {
                method: "POST",
                body: formData,
                credentials: "same-origin"
            });

            if (!res.ok) {
                alert("데이터 재로딩 실패");
                return;
            }

            await loadData();
            alert("데이터 재로딩 완료");
        });
    }

    loadData();
})();