(function () {
    const BOOT = window.APP_BOOTSTRAP || {};
    const META = BOOT.meta || {};
    const CURRENT_USER = BOOT.current_user || {};
    const TODAY_STR = META.base_date || "";

    let rawRecords = [];
    let stageRows = [];
    let dailyRows = [];
    let selectedDate = "";
    let currentMonth = "";

    function normalizeText(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim().toLowerCase().replace(/[^0-9a-zA-Z가-힣]+/g, "");
    }

    function cleanStageValue(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
    }

    function debounce(fn, delay) {
        let t = null;
        return function () {
            const args = arguments;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(null, args); }, delay);
        };
    }
    const debouncedApplyFilters = debounce(applyFilters, 200);

    function setUserBadge() {
        const badge = document.getElementById("userBadge");
        if (!badge) return;
        badge.textContent = CURRENT_USER.role === "admin"
            ? `${CURRENT_USER.name} (admin)`
            : `${CURRENT_USER.name} / ${CURRENT_USER.partner || ""}`;
    }

    async function loadData() {
        const res = await fetch("/api/stage-data", { credentials: "same-origin" });
        if (!res.ok) {
            alert("Stage 데이터 조회에 실패했습니다.");
            return;
        }
        const json = await res.json();
        rawRecords = json.records || [];
        setUserBadge();
        buildStageOptions();
        document.getElementById("filterDate").value = TODAY_STR;
        currentMonth = TODAY_STR.slice(0, 7);
        applyFilters();
    }

    function getKoreanWeekday(dateStr) {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    }
    function formatDateWithWeekday(dateStr) {
        const w = getKoreanWeekday(dateStr);
        return w ? `${dateStr} (${w})` : dateStr;
    }

    function buildStageOptions() {
        const stageSelect = document.getElementById("filterStage");
        const stageValues = Array.from(new Set(rawRecords.map((r) => cleanStageValue(r["Stage"])).filter((v) => v && v !== "-" && v !== "--"))).sort((a, b) => a.localeCompare(b, "ko"));
        stageSelect.innerHTML = "";
        stageValues.forEach(function (stage) {
            const opt = document.createElement("option");
            opt.value = stage;
            opt.textContent = stage;
            stageSelect.appendChild(opt);
        });
        const preferred = stageValues.includes("M-FAB") ? "M-FAB" : (stageValues[0] || "");
        stageSelect.value = preferred;
    }

    function buildStageRows() {
        const selectedStage = cleanStageValue(document.getElementById("filterStage").value);
        const searchText = normalizeText(document.getElementById("searchText").value);
        const woMap = new Map();
        rawRecords.forEach(function (row) {
            const stageValue = cleanStageValue(row["Stage"]);
            if (!selectedStage || stageValue !== selectedStage) return;
            const wo = String(row["WO"] || "").trim();
            if (!wo) return;
            const tuningStart = row["Tuning시작일"] || "";
            const endDate = row["생산완료일"] || "";
            if (!tuningStart || !endDate || tuningStart > endDate) return;
            const searchTarget = normalizeText([row["WO"], row["Lot"], row["Customer"], row["Line"], row["Model"], row["Stage"]].join(" "));
            if (searchText && !searchTarget.includes(searchText)) return;
            if (!woMap.has(wo)) woMap.set(wo, row);
        });
        stageRows = Array.from(woMap.values());
    }

    function buildDailyRows() {
        if (!stageRows.length) { dailyRows = []; return; }
        let minDate = null;
        let maxDate = null;
        stageRows.forEach(function (row) {
            const s = row["Tuning시작일"] || "";
            const e = row["생산완료일"] || "";
            if (!s || !e) return;
            if (!minDate || s < minDate) minDate = s;
            if (!maxDate || e > maxDate) maxDate = e;
        });
        if (!minDate || !maxDate) { dailyRows = []; return; }
        const rows = [];
        let cur = minDate;
        while (cur <= maxDate) {
            const details = stageRows.filter(function (row) {
                const s = row["Tuning시작일"] || "";
                const e = row["생산완료일"] || "";
                return s <= cur && cur <= e;
            });
            rows.push({ date: cur, count: details.length, warn: details.length >= 11, details: details });
            const d = new Date(cur);
            d.setDate(d.getDate() + 1);
            cur = d.toISOString().slice(0, 10);
        }
        dailyRows = rows;
    }

    function renderKpis() {
        const maxCount = dailyRows.length ? Math.max.apply(null, dailyRows.map((r) => r.count)) : 0;
        const warnDays = dailyRows.filter((r) => r.warn).length;
        const todayRow = dailyRows.find((r) => r.date === TODAY_STR);
        document.getElementById("kpiTotalWo").textContent = stageRows.length.toLocaleString();
        document.getElementById("kpiMaxCount").textContent = maxCount.toLocaleString();
        document.getElementById("kpiWarnDays").textContent = warnDays.toLocaleString();
        document.getElementById("kpiTodayCount").textContent = (todayRow ? todayRow.count : 0).toLocaleString();
    }

    function getHeatClass(count) {
        if (count >= 11) return "heat-6";
        if (count >= 8) return "heat-5";
        if (count >= 6) return "heat-4";
        if (count >= 4) return "heat-3";
        if (count >= 2) return "heat-2";
        if (count >= 1) return "heat-1";
        return "heat-0";
    }

    function renderHeatmap() {
        const area = document.getElementById("heatmapArea");
        area.innerHTML = "";
        if (!currentMonth) { area.innerHTML = '<div class="muted">표시할 월이 없습니다.</div>'; return; }
        const parts = currentMonth.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        if (!year || !month) { area.innerHTML = '<div class="muted">표시할 월이 없습니다.</div>'; return; }
        document.getElementById("monthTitle").textContent = `${year}-${String(month).padStart(2, "0")}`;
        const headers = document.createElement("div");
        headers.className = "heatmap-wrap";
        ["일", "월", "화", "수", "목", "금", "토"].forEach(function (d) {
            const h = document.createElement("div");
            h.className = "weekday-header";
            h.textContent = d;
            headers.appendChild(h);
        });
        area.appendChild(headers);
        const grid = document.createElement("div");
        grid.className = "heatmap-wrap";
        const firstDate = new Date(year, month - 1, 1);
        const lastDate = new Date(year, month, 0);
        const startWeekday = firstDate.getDay();
        const lastDay = lastDate.getDate();
        const dailyMap = new Map(dailyRows.map((r) => [r.date, r]));
        for (let i = 0; i < startWeekday; i++) {
            const empty = document.createElement("div");
            empty.className = "heat-cell heat-empty";
            grid.appendChild(empty);
        }
        for (let day = 1; day <= lastDay; day++) {
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const data = dailyMap.get(dateStr);
            const count = data ? data.count : 0;
            const cell = document.createElement("div");
            cell.className = `heat-cell ${getHeatClass(count)}`;
            if (selectedDate === dateStr) cell.classList.add("heat-active");
            cell.onclick = function () {
                selectedDate = dateStr;
                document.getElementById("filterDate").value = dateStr;
                applyFilters();
            };
            const dateDiv = document.createElement("div");
            dateDiv.className = "heat-date";
            dateDiv.textContent = `${day} (${getKoreanWeekday(dateStr)})`;
            const countDiv = document.createElement("div");
            countDiv.className = "heat-count";
            countDiv.textContent = count;
            const labelDiv = document.createElement("div");
            labelDiv.className = "heat-label";
            labelDiv.textContent = count >= 11 ? "경고" : "정상";
            cell.appendChild(dateDiv);
            cell.appendChild(countDiv);
            cell.appendChild(labelDiv);
            grid.appendChild(cell);
        }
        area.appendChild(grid);
    }

    function renderDailyTable(rows) {
        const body = document.getElementById("dailyBody");
        body.innerHTML = "";
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="3">조건에 맞는 데이터가 없습니다.</td></tr>';
            return;
        }
        rows.forEach(function (row) {
            const tr = document.createElement("tr");
            tr.onclick = function () { showDetail(row.date); };
            const tdDate = document.createElement("td");
            tdDate.textContent = formatDateWithWeekday(row.date);
            const tdCount = document.createElement("td");
            tdCount.textContent = row.count.toLocaleString();
            const tdWarn = document.createElement("td");
            tdWarn.innerHTML = row.warn ? '<span class="warn-badge warn-ng">경고</span>' : '<span class="warn-badge warn-ok">정상</span>';
            tr.appendChild(tdDate); tr.appendChild(tdCount); tr.appendChild(tdWarn);
            body.appendChild(tr);
        });
    }

    function showDetail(dateStr) {
        selectedDate = dateStr;
        renderHeatmap();
        const title = document.getElementById("detailTitle");
        const body = document.getElementById("detailBody");
        const row = dailyRows.find((r) => r.date === dateStr);
        if (!row) {
            title.textContent = "WO 상세";
            body.innerHTML = '<tr><td colspan="15">선택된 날짜가 없습니다.</td></tr>';
            return;
        }
        title.textContent = `WO 상세 - ${formatDateWithWeekday(dateStr)} / 동시 생산 ${row.count}대`;
        body.innerHTML = "";
        if (!row.details.length) {
            body.innerHTML = '<tr><td colspan="15">해당 날짜 데이터가 없습니다.</td></tr>';
            return;
        }
        row.details.forEach(function (item) {
            const tr = document.createElement("tr");
            ["WO", "Lot", "Customer", "Line", "Model", "Stage", "EFEM", "TM", "PM", "SU", "Harness", "Tuning", "생산시작일", "Tuning시작일", "생산완료일"].forEach(function (col) {
                const td = document.createElement("td");
                td.textContent = item[col] || "";
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    }

    function applyFilters() {
        buildStageRows();
        buildDailyRows();
        const warnOnly = document.getElementById("filterWarnOnly").value;
        const dateFilter = document.getElementById("filterDate").value;
        const selectedStage = cleanStageValue(document.getElementById("filterStage").value);
        document.getElementById("pageTitle").textContent = selectedStage ? `Stage 현황 Dashboard - ${selectedStage}` : "Stage 현황 Dashboard";
        let viewRows = dailyRows.slice();
        if (warnOnly === "Y") viewRows = viewRows.filter((r) => r.warn);
        if (dateFilter) {
            viewRows = viewRows.filter((r) => r.date === dateFilter);
            currentMonth = dateFilter.slice(0, 7);
        } else if (!currentMonth) {
            currentMonth = TODAY_STR.slice(0, 7);
        }
        renderKpis();
        renderHeatmap();
        renderDailyTable(viewRows);
        const todayRow = dailyRows.find((r) => r.date === TODAY_STR);
        if (dateFilter) showDetail(dateFilter);
        else if (selectedDate) showDetail(selectedDate);
        else if (todayRow) showDetail(TODAY_STR);
        else if (viewRows.length > 0) showDetail(viewRows[0].date);
        else showDetail("");
    }

    function moveMonth(offset) {
        if (!currentMonth) return;
        const parts = currentMonth.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const d = new Date(year, month - 1 + offset, 1);
        currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        renderHeatmap();
    }
    window.moveMonth = moveMonth;

    document.getElementById("searchText").addEventListener("input", debouncedApplyFilters);
    document.getElementById("filterWarnOnly").addEventListener("change", applyFilters);
    document.getElementById("filterDate").addEventListener("change", applyFilters);
    document.getElementById("filterStage").addEventListener("change", applyFilters);

    loadData();
})();
