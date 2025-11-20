// State and persistence
const STORAGE_KEY = "zandaka/v1";

const state = {
	baseDate: null,
	baseAmount: 0,
	rangeStart: null,
	rangeEnd: null,
	showRecurringInMonthly: true,
	timelineCollapsedMonths: [], // array of 'YYYY-MM'
	entries: [], // {id, date, kind, amount, note, recurring, endDate}
	// UI prefs
	entriesSearch: "",
	entriesKindFilter: "",
	entriesCompact: false,
	entriesSort: "custom", // 'custom' | 'date'
};

const byId = (id) => document.getElementById(id);
const $ = byId;

function save() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function load() {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return;
	try {
		const obj = JSON.parse(raw);
		Object.assign(state, obj);
	} catch {}
}

// Utils
const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const fmt = (n) => yen.format(n);
const toInt = (s) => {
	if (typeof s === "number") return Math.round(s);
	if (!s) return 0;
	return Math.round(Number(String(s).replace(/[^\d-]/g, "")) || 0);
};
const todayStr = () => {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
};
const toDate = (s) => new Date(s + "T00:00:00");
const ymd = (d) => {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
};
const addMonthsClamp = (date, months) => {
	const d = new Date(date);
	const day = d.getDate();
	d.setDate(1);
	d.setMonth(d.getMonth() + months);
	const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	d.setDate(Math.min(day, last));
	return d;
};
const cmpDate = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Business day helpers (JP)
function nthMondayOfMonth(year, month0, n) {
	let d = new Date(year, month0, 1);
	const day = d.getDay();
	const offset = (8 - day) % 7; // days to first Monday
	d.setDate(1 + offset + (n - 1) * 7);
	return d;
}
function calcVernalEquinoxDay(year) {
	// valid roughly for 1900-2099
	const day = Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
	return new Date(year, 2, day); // March
}
function calcAutumnEquinoxDay(year) {
	const day = Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
	return new Date(year, 8, day); // September
}
function buildJapaneseHolidays(year) {
	const days = [];
	// Fixed-date holidays
	days.push(new Date(year, 0, 1)); // 1/1 元日
	days.push(new Date(year, 1, 11)); // 2/11 建国記念の日
	days.push(new Date(year, 1, 23)); // 2/23 天皇誕生日
	days.push(calcVernalEquinoxDay(year)); // 春分
	days.push(new Date(year, 3, 29)); // 4/29 昭和の日
	days.push(new Date(year, 4, 3)); // 5/3 憲法記念日
	days.push(new Date(year, 4, 4)); // 5/4 みどりの日
	days.push(new Date(year, 4, 5)); // 5/5 こどもの日
	days.push(new Date(year, 7, 11)); // 8/11 山の日
	days.push(calcAutumnEquinoxDay(year)); // 秋分
	days.push(new Date(year, 10, 3)); // 11/3 文化の日
	days.push(new Date(year, 10, 23)); // 11/23 勤労感謝の日
	// Happy Monday holidays
	days.push(nthMondayOfMonth(year, 0, 2)); // 1月第2月曜 成人の日
	days.push(nthMondayOfMonth(year, 6, 3)); // 7月第3月曜 海の日
	days.push(nthMondayOfMonth(year, 8, 3)); // 9月第3月曜 敬老の日
	days.push(nthMondayOfMonth(year, 9, 2)); // 10月第2月曜 スポーツの日
	// Build set of ymd strings and add substitute holidays (if the day is Sun)
	const set = new Set();
	for (const d of days) {
		const s = ymd(d);
		set.add(s);
		// Substitute holiday (振替休日) when holiday falls on Sunday -> next non-holiday weekday
		if (d.getDay() === 0) {
			let sub = new Date(d);
			do {
				sub.setDate(sub.getDate() + 1);
			} while (sub.getDay() === 0 || set.has(ymd(sub))); // skip Sundays or other holidays
			set.add(ymd(sub));
		}
	}
	return set;
}
function isWeekend(dateObj) {
	const wd = dateObj.getDay();
	return wd === 0 || wd === 6;
}
function adjustToBusinessDay(dateObj, holidaysSet) {
	const d = new Date(dateObj);
	while (isWeekend(d) || holidaysSet.has(ymd(d))) {
		d.setDate(d.getDate() + 1); // move forward to next business day
	}
	return d;
}

function uid() {
	return Math.random().toString(36).slice(2, 10);
}

// Initial defaults
function ensureDefaults() {
	const t = todayStr();
	if (!state.baseDate) state.baseDate = t;
	if (!state.rangeStart) state.rangeStart = t;
	if (!state.rangeEnd) state.rangeEnd = ymd(addMonthsClamp(toDate(t), 2));
	if (!Array.isArray(state.timelineCollapsedMonths)) state.timelineCollapsedMonths = [];
	ensureUiOrder();
	if (typeof state.showRecurringInMonthly !== "boolean") state.showRecurringInMonthly = true;
	if (typeof state.entriesSearch !== "string") state.entriesSearch = "";
	if (typeof state.entriesKindFilter !== "string") state.entriesKindFilter = "";
	if (typeof state.entriesCompact !== "boolean") state.entriesCompact = false;
	if (state.entriesSort !== "custom" && state.entriesSort !== "date") state.entriesSort = "custom";
}

function ensureUiOrder() {
	// assign uiOrder if missing, preserving chronological order
	let maxOrder = state.entries.reduce((m, e) => Math.max(m, typeof e.uiOrder === "number" ? e.uiOrder : -1), -1);
	const need = state.entries.filter((e) => typeof e.uiOrder !== "number");
	need.sort((a, b) => {
		const c = cmpDate(a.date, b.date);
		return c !== 0 ? c : a.kind.localeCompare(b.kind);
	});
	for (const e of need) {
		maxOrder += 1;
		e.uiOrder = maxOrder;
	}
}

// CRUD
function addEntry(entry) {
	state.entries.push(entry);
	save();
	renderAll();
}
function updateEntry(id, patch) {
	const idx = state.entries.findIndex((e) => e.id === id);
	if (idx >= 0) {
		state.entries[idx] = { ...state.entries[idx], ...patch };
		save();
		renderAll();
	}
}
function removeEntry(id) {
	state.entries = state.entries.filter((e) => e.id !== id);
	save();
	renderAll();
}
function clearAll() {
	if (!confirm("本当に全てを削除しますか？")) return;
	state.entries = [];
	save();
	renderAll();
}

// Recurrence expansion
function expandEntriesInRange(rangeStart, rangeEnd) {
	const start = toDate(rangeStart);
	const end = toDate(rangeEnd);
	const results = [];
	// cache of holidays by year
	const holidaysCache = {};
	for (const e of state.entries) {
		if (!e.recurring) {
			if (cmpDate(e.date, rangeStart) >= 0 && cmpDate(e.date, rangeEnd) <= 0) {
				// single item: also apply business-day adjust if desired? Keep as-is for singles
				results.push(e);
			}
			continue;
		}
		// recurring monthly
		let cur = toDate(e.date);
		const endLimit = e.endDate ? toDate(e.endDate) : end;
		while (cur <= endLimit) {
			// shift to business day if weekend/holiday (that month only)
			const year = cur.getFullYear();
			if (!holidaysCache[year]) holidaysCache[year] = buildJapaneseHolidays(year);
			const adjusted = adjustToBusinessDay(cur, holidaysCache[year]);
			const ymdCur = ymd(adjusted);
			if (cmpDate(ymdCur, rangeStart) >= 0 && cmpDate(ymdCur, rangeEnd) <= 0) {
				results.push({ ...e, date: ymdCur, _recurrenceInstance: true });
			}
			// next month based on original anchor day
			cur = addMonthsClamp(new Date(cur), 1);
		}
	}
	return results;
}

// Ledger computation
function computeLedger() {
	const rangeStart = state.rangeStart;
	const rangeEnd = state.rangeEnd;

	// base balance derived from current settings (snapshots無効)
	let baseAmount = toInt(state.baseAmount);
	let baseDate = state.baseDate;

	// collect items in range, including recurring
	let entries = expandEntriesInRange(rangeStart, rangeEnd);
	// Always exclude planned future expenses from calculation
	entries = entries.filter((e) => e.kind !== "future-small" && e.kind !== "future-large" && e.kind !== "snapshot");

	// sort by date, with snapshot applied first on that date
	entries.sort((a, b) => {
		const c = cmpDate(a.date, b.date);
		if (c !== 0) return c;
		return 0;
	});

	// Build daily groups and running balance
	const days = {};
	for (const e of entries) {
		if (!days[e.date]) days[e.date] = { date: e.date, items: [], balanceAfter: null };
		days[e.date].items.push(e);
	}
	const orderedDays = Object.values(days).sort((a, b) => cmpDate(a.date, b.date));

	let running = baseAmount;
	// apply any operations between baseDate exclusive and first day less than rangeStart? We already filtered within range for non-snapshots. Only snapshots can appear within range; snapshot sets running to its amount that day.

	for (const day of orderedDays) {
		// apply day items
		for (const it of day.items) {
			const amt = toInt(it.amount);
			if (it.kind === "income") running += amt;
			else running -= amt; // expense, future-small, future-large
		}
		day.balanceAfter = running;
	}

	// Monthly summary
	const monthly = {};
	for (const day of orderedDays) {
		const monthKey = day.date.slice(0, 7);
		if (!monthly[monthKey]) {
			monthly[monthKey] = { month: monthKey, income: 0, expense: 0, endBalance: day.balanceAfter };
		}
		// sum entries of the day
		for (const it of day.items) {
			if (it.kind === "income") monthly[monthKey].income += toInt(it.amount);
			if (it.kind === "expense" || it.kind === "future-small" || it.kind === "future-large") monthly[monthKey].expense += toInt(it.amount);
		}
		monthly[monthKey].endBalance = day.balanceAfter;
	}

	return {
		base: { date: baseDate, amount: baseAmount },
		days: orderedDays,
		monthly: Object.values(monthly).sort((a, b) => (a.month < b.month ? -1 : 1)),
	};
}

// Rendering
function renderControls() {
	$("base-date").value = state.baseDate || "";
	$("base-amount").value = state.baseAmount ? toInt(state.baseAmount).toLocaleString("ja-JP") : "";
	$("range-start").value = state.rangeStart || "";
	$("range-end").value = state.rangeEnd || "";
	const tmr = $("toggle-monthly-recurring");
	if (tmr) tmr.checked = !!state.showRecurringInMonthly;
	// entries controls
	const s = $("entries-search");
	if (s) s.value = state.entriesSearch || "";
	const k = $("entries-kind-filter");
	if (k) k.value = state.entriesKindFilter || "";
	const seg = document.getElementById("entries-kind-seg");
	if (seg) {
		seg.querySelectorAll(".seg").forEach((btn) => {
			const val = btn.getAttribute("data-value") || "";
			btn.classList.toggle("active", val === (state.entriesKindFilter || ""));
		});
	}
	const c = $("entries-compact");
	if (c) c.checked = !!state.entriesCompact;
	const sortBtn = $("entries-sort-toggle");
	if (sortBtn) sortBtn.textContent = `並び: ${state.entriesSort === "date" ? "日付" : "カスタム"}`;
}

function kindLabel(kind) {
	switch (kind) {
		case "income": return "収入";
		case "expense": return "支出";
		case "future-small": return "未来予定支出";
		case "future-large": return "未来予定支出";
		default: return kind;
	}
}
function amountSignClass(kind) {
	if (kind === "income") return "plus";
	if (kind === "expense" || kind === "future-small" || kind === "future-large") return "minus";
	return "";
}

function renderEntries() {
	const list = $("entries-list");
	const normal = state.entries.filter((e) => e.kind !== "future-small" && e.kind !== "future-large");
	if (!normal.length) {
		list.innerHTML = `<div class="tiny muted">エントリーがありません。上のフォームから追加してください。</div>`;
		return;
	}
	// filter by kind and search
	const q = (state.entriesSearch || "").toLowerCase();
	const kindFilter = state.entriesKindFilter || "";
	let view = normal.filter((e) => {
		if (kindFilter && e.kind !== kindFilter) return false;
		if (q && !(String(e.note || "").toLowerCase().includes(q) || String(e.date || "").includes(q))) return false;
		return true;
	});
	// sort
	let sorted;
	if (state.entriesSort === "date") {
		sorted = [...view].sort((a, b) => {
			const c = cmpDate(a.date, b.date);
			if (c !== 0) return c;
			return a.kind.localeCompare(b.kind);
		});
	} else {
		sorted = [...view].sort((a, b) => {
			const ao = typeof a.uiOrder === "number" ? a.uiOrder : Number.MAX_SAFE_INTEGER;
			const bo = typeof b.uiOrder === "number" ? b.uiOrder : Number.MAX_SAFE_INTEGER;
			if (ao !== bo) return ao - bo;
			const c = cmpDate(a.date, b.date);
			return c !== 0 ? c : a.kind.localeCompare(b.kind);
		});
	}
	list.innerHTML = "";
	list.classList.toggle("compact", !!state.entriesCompact);
	for (const e of sorted) {
		const row = document.createElement("div");
		row.className = "entry";
		row.setAttribute("draggable", "true");
		row.dataset.id = e.id;
		const detailsHtml = e.recurring
			? `<div class="tiny muted"><div>毎月</div><div class="date-range"><span class="date-badge">${e.date}</span>${e.endDate ? ` <span class="arrow">→</span> <span class="date-badge">${e.endDate}</span>` : ""}</div></div>`
			: `<div class="tiny muted"><span class="date-badge">${e.date}</span></div>`;
		row.innerHTML = `
			<span class="tag ${e.kind}">${kindLabel(e.kind)}</span>
			<div>
				<div>${e.note ? escapeHtml(e.note) : "<span class='muted'>（メモなし）</span>"}</div>
				${detailsHtml}
			</div>
			<div class="amount ${amountSignClass(e.kind)}">${fmt(e.kind === "income" ? toInt(e.amount) : -toInt(e.amount))}</div>
			<div class="actions">
				<button data-act="edit" data-id="${e.id}">編集</button>
				<button class="danger" data-act="del" data-id="${e.id}">削除</button>
			</div>
		`;
		list.appendChild(row);
	}
	// Delegate actions (bind once)
	if (!list.dataset.bound) {
		list.dataset.bound = "1";
		list.addEventListener("click", (ev) => {
			const btn = ev.target.closest && ev.target.closest("button[data-act]");
			if (!btn) return;
			const id = btn.dataset.id;
			const act = btn.dataset.act;
			if (act === "del") removeEntry(id);
			if (act === "edit") openEditModal(id);
		});
		// DnD handlers
		let draggingEl = null;
		list.addEventListener("dragstart", (ev) => {
			const row = ev.target.closest && ev.target.closest(".entry");
			if (!row) return;
			draggingEl = row;
			row.classList.add("dragging");
			ev.dataTransfer.effectAllowed = "move";
		});
		list.addEventListener("dragend", () => {
			if (draggingEl) draggingEl.classList.remove("dragging");
			draggingEl = null;
		});
		list.addEventListener("dragover", (ev) => {
			ev.preventDefault();
			const after = getDragAfterElement(list, ev.clientY);
			if (!draggingEl) return;
			if (after == null) list.appendChild(draggingEl);
			else list.insertBefore(draggingEl, after);
		});
		list.addEventListener("drop", () => {
			// persist new order
			const ids = Array.from(list.querySelectorAll(".entry")).map((el) => el.dataset.id);
			let order = 0;
			for (const id of ids) {
				const entry = state.entries.find((e) => e.id === id);
				if (entry && entry.kind !== "future-small" && entry.kind !== "future-large") {
					entry.uiOrder = order++;
				}
			}
			save();
		});
	}
}

function getDragAfterElement(container, y) {
	const els = [...container.querySelectorAll(".entry:not(.dragging)")];
	let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
	for (const el of els) {
		const box = el.getBoundingClientRect();
		const offset = y - box.top - box.height / 2;
		if (offset < 0 && offset > closest.offset) {
			closest = { offset, element: el };
		}
	}
	return closest.element;
}

function renderPlanned() {
	const root = $("planned-list");
	if (!root) return;
	const planned = state.entries.filter((e) => e.kind === "future-small" || e.kind === "future-large");
	if (!planned.length) {
		root.innerHTML = `<div class="tiny muted">未来予定支出のメモはまだありません。</div>`;
		return;
	}
	const sorted = [...planned].sort((a, b) => {
		const c = (a.date || "").localeCompare(b.date || "");
		if (c !== 0) return c;
		return a.kind.localeCompare(b.kind);
	});
	const total = planned.reduce((sum, e) => sum + toInt(e.amount), 0);
	const frag = [];
	frag.push(`<div class="tiny muted">合計予定支出: <strong>${fmt(total)}</strong></div>`);
	for (const e of sorted) {
		const row = document.createElement("div");
		row.className = "entry";
		row.innerHTML = `
			<span class="tag ${e.kind}">${kindLabel(e.kind)}</span>
			<div>
				<div>${e.note ? escapeHtml(e.note) : "<span class='muted'>（メモなし）</span>"}</div>
				<div class="tiny muted"><span class="date-badge">${e.date || "日付未定"}</span></div>
			</div>
			<div class="amount minus">-${fmt(toInt(e.amount))}</div>
			<div class="actions">
				<button data-act="edit" data-id="${e.id}">編集</button>
				<button class="danger" data-act="del" data-id="${e.id}">削除</button>
			</div>
		`;
		root.appendChild(row);
	}
	// actions
	if (!root.dataset.bound) {
		root.dataset.bound = "1";
		root.addEventListener("click", (ev) => {
			const btn = ev.target.closest && ev.target.closest("button[data-act]");
			if (!btn) return;
			const id = btn.dataset.id;
			const act = btn.dataset.act;
			if (act === "del") removeEntry(id);
			if (act === "edit") openEditModal(id);
		});
	}
}

function renderTimeline() {
	const { base, days } = computeLedger();
	const root = $("timeline");
	if (!days.length) {
		root.innerHTML = `<div class="tiny muted">期間内に表示できるイベントがありません。</div>`;
		return;
	}
	const baseInfo = base.date ? `${base.date} 時点: ${fmt(base.amount)}` : `設定: ${fmt(base.amount)}`;
	const frags = [];
	frags.push(`<div class="muted base-info">現在の口座残高 — ${baseInfo}</div>`);
	// group days by month
	const groups = {};
	for (const d of days) {
		const key = d.date.slice(0, 7);
		(groups[key] ||= []).push(d);
	}
	const months = Object.keys(groups).sort();
	for (const m of months) {
		const collapsed = state.timelineCollapsedMonths.includes(m);
		const daysHtml = groups[m].map((d) => {
			const lines = d.items.map((it) => {
				const sign = it.kind === "income" ? "+" : (it.kind === "snapshot" ? "" : "-");
				const amt = fmt(toInt(it.amount));
				const shown = it.kind === "income" ? `<span class="amount plus">${sign}${amt}</span>`
					: it.kind === "snapshot" ? `<span class="tag snapshot">スナップ</span> <span class="muted">${amt}</span>`
					: `<span class="amount minus">${sign}${amt}</span>`;
				const note = it.note ? escapeHtml(it.note) : "";
				return `<div class="tiny">${shown} <span class="muted">— ${kindLabel(it.kind)}</span> ${note ? `・${note}` : ""}</div>`;
			}).join("");
			return `
				<div class="day">
					<div class="day-head">
						<div class="muted">${d.date}</div>
						<div class="muted"></div>
						<div class="balance"><span class="label">残高:</span><span class="value">${fmt(d.balanceAfter)}</span></div>
					</div>
					<div class="day-entries">
						${lines}
					</div>
				</div>
			`;
		}).join("");
		frags.push(`
			<div class="month-group ${collapsed ? "collapsed" : ""}" data-month="${m}">
				<button class="month-toggle" type="button" data-month="${m}" aria-expanded="${collapsed ? "false" : "true"}">
					<span class="chev">▾</span>${m}
				</button>
				<div class="month-days">
					${daysHtml}
				</div>
			</div>
		`);
	}
	root.innerHTML = frags.join("");
	// bind toggle once
	if (!root.dataset.bound) {
		root.dataset.bound = "1";
		root.addEventListener("click", (ev) => {
			const btn = ev.target.closest && ev.target.closest(".month-toggle");
			if (!btn) return;
			const m = btn.getAttribute("data-month");
			const i = state.timelineCollapsedMonths.indexOf(m);
			if (i >= 0) state.timelineCollapsedMonths.splice(i, 1);
			else state.timelineCollapsedMonths.push(m);
			save();
			renderTimeline();
		});
	}
}

// Aggregate monthly with option to include/exclude recurring entries
function aggregateMonthly(days, baseAmount, includeRecurring) {
	const monthly = {};
	let running = baseAmount;
	for (const day of days) {
		const monthKey = day.date.slice(0, 7);
		if (!monthly[monthKey]) {
			monthly[monthKey] = { month: monthKey, income: 0, expense: 0, endBalance: running };
		}
		for (const it of day.items) {
			if (!includeRecurring && it.recurring) {
				// skip recurring movements from both totals and running
				if (it.kind === "snapshot") {
					// snapshots always apply
					running = toInt(it.amount);
				}
				continue;
			}
			if (it.kind === "snapshot") {
				running = toInt(it.amount);
				continue;
			}
			const amt = toInt(it.amount);
			if (it.kind === "income") {
				running += amt;
				monthly[monthKey].income += amt;
			} else if (it.kind === "expense" || it.kind === "future-small" || it.kind === "future-large") {
				running -= amt;
				monthly[monthKey].expense += amt;
			}
		}
		monthly[monthKey].endBalance = running;
	}
	return Object.values(monthly).sort((a, b) => (a.month < b.month ? -1 : 1));
}
function renderMonthly() {
	const { base, days } = computeLedger();
	const root = $("monthly");
	const includeRecurring = !!state.showRecurringInMonthly;
	const monthly = aggregateMonthly(days, base.amount, includeRecurring);
	if (!monthly.length) {
		root.innerHTML = `<div class="tiny muted">表示できる月次データがありません。</div>`;
		return;
	}
	const frags = [];
	for (const m of monthly) {
		frags.push(`
			<div class="month">
				<div class="muted">${m.month}</div>
				<div class="muted kv"><span class="label">収入:</span><span class="value">${fmt(m.income)}</span></div>
				<div class="muted kv"><span class="label">支出:</span><span class="value">${fmt(m.expense)}</span></div>
				<div class="kv"><span class="label">月末残高:</span><span class="value">${fmt(m.endBalance)}</span></div>
			</div>
		`);
	}
	root.innerHTML = frags.join("");
}

function renderAll() {
	renderControls();
	renderEntries();
	const planned = $("planned-list");
	if (planned) {
		planned.innerHTML = "";
		renderPlanned();
	}
	renderTimeline();
	renderMonthly();
	// Update summary link with inline data as fallback (for environments where localStorage isn't shared across files)
	const fab = document.querySelector(".fab-summary");
	if (fab) {
		try {
			const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ entries: state.entries }))));
			const url = new URL(fab.getAttribute("href"), location.href);
			url.hash = "d=" + payload;
			fab.setAttribute("href", url.toString());
		} catch {}
	}
}

// Input handlers
function wireControls() {
	$("base-date").addEventListener("change", (e) => {
		state.baseDate = e.target.value || null;
		save(); renderAll();
	});
	$("base-amount").addEventListener("input", (e) => {
		const n = toInt(e.target.value);
		e.target.value = n ? n.toLocaleString("ja-JP") : "";
	});
	$("base-amount").addEventListener("change", (e) => {
		state.baseAmount = toInt(e.target.value);
		save(); renderAll();
	});
	// Live thousands separator for entry amount
	const entryAmt = $("entry-amount");
	if (entryAmt) {
		entryAmt.addEventListener("input", (e) => {
			const n = toInt(e.target.value);
			e.target.value = n ? n.toLocaleString("ja-JP") : "";
		});
	}
	const rangeHandler = (key) => (e) => {
		state[key] = e.target.value || null;
		save(); renderAll();
	};
	$("range-start").addEventListener("change", rangeHandler("rangeStart"));
	$("range-end").addEventListener("change", rangeHandler("rangeEnd"));

	$("entry-form").addEventListener("submit", (e) => {
		e.preventDefault();
		const date = $("entry-date").value;
		// read kind from custom trigger if present, else from hidden select
		let kind = $("entry-kind").value;
		const kindTrigger = document.getElementById("kind-trigger");
		if (kindTrigger && kindTrigger.dataset && kindTrigger.dataset.value) {
			kind = kindTrigger.dataset.value;
		}
		const amount = toInt($("entry-amount").value);
		const note = $("entry-note").value.trim();
		const recurring = $("entry-recurring").checked;
		const endDate = recurring ? ($("entry-end").value || null) : null;
		if (!date || !amount) return;
		addEntry({ id: uid(), date, kind, amount, note, recurring, endDate });
		$("entry-form").reset();
		// reset disabled state after form reset
		const rec = $("entry-recurring");
		const end = $("entry-end");
		if (rec && end) {
			end.disabled = !rec.checked;
			if (end.disabled) end.value = "";
			const btn = end.closest(".field")?.querySelector(".calendar-btn");
			if (btn) btn.toggleAttribute("disabled", end.disabled);
		}
		// reset kind trigger label/value
		if (kindTrigger) {
			kindTrigger.dataset.value = $("entry-kind").value || "income";
			kindTrigger.textContent = kindTrigger.dataset.value === "expense" ? "支出" : (kindTrigger.dataset.value === "future-large" ? "未来予定支出" : "収入");
		}
	});

	$("btn-reset").addEventListener("click", clearAll);
	$("btn-export").addEventListener("click", doExport);

	// Disable "end date" unless recurring is checked
	const rec = $("entry-recurring");
	const end = $("entry-end");
	const endClear = $("entry-end-clear");
	const syncRecurring = () => {
		if (!end) return;
		const on = !!rec?.checked;
		end.disabled = !on;
		if (!on) end.value = "";
		const btn = end.closest(".field")?.querySelector(".calendar-btn");
		if (btn) btn.toggleAttribute("disabled", !on);
		if (endClear) endClear.toggleAttribute("disabled", !on);
	};
	// Disable recurring when kind is future planned expense
	const syncKindRecurring = () => {
		if (!rec) return;
		const trigger = document.getElementById("kind-trigger");
		const currentKind = (trigger && trigger.dataset && trigger.dataset.value)
			? trigger.dataset.value
			: ($("entry-kind")?.value || "income");
		const disallow = currentKind === "future-large";
		rec.disabled = disallow;
		if (disallow && rec.checked) rec.checked = false;
		syncRecurring();
	};
	if (rec && end) {
		syncRecurring();
		syncKindRecurring();
		rec.addEventListener("change", syncRecurring);
	}
	// watch kind changes (custom popover dispatches change on hidden select)
	const kindSelect = $("entry-kind");
	if (kindSelect) {
		kindSelect.addEventListener("change", syncKindRecurring);
	}
	if (end && endClear) {
		endClear.addEventListener("click", () => {
			if (end.disabled) return;
			end.value = "";
			end.dispatchEvent(new Event("change"));
		});
	}

	// Monthly recurring include toggle
	const tmr = $("toggle-monthly-recurring");
	if (tmr) {
		tmr.addEventListener("change", (e) => {
			state.showRecurringInMonthly = e.target.checked;
			save();
			renderMonthly();
		});
	}

	// removed fancy select wrapper syncing
	// Entries controls
	const s = $("entries-search");
	if (s) {
		s.addEventListener("input", (e) => {
			state.entriesSearch = e.target.value;
			save(); renderEntries();
		});
	}
	const k = $("entries-kind-filter");
	if (k) {
		k.addEventListener("change", (e) => {
			state.entriesKindFilter = e.target.value || "";
			save(); renderEntries();
			// sync segmented UI
			const seg = document.getElementById("entries-kind-seg");
			if (seg) {
				seg.querySelectorAll(".seg").forEach((btn) => {
					btn.classList.toggle("active", (btn.getAttribute("data-value") || "") === state.entriesKindFilter);
				});
			}
		});
	}
	const seg = document.getElementById("entries-kind-seg");
	if (seg) {
		seg.addEventListener("click", (e) => {
			const btn = e.target.closest && e.target.closest(".seg");
			if (!btn) return;
			const val = btn.getAttribute("data-value") || "";
			state.entriesKindFilter = val;
			// keep hidden select in sync for future compatibility
			const k = $("entries-kind-filter");
			if (k) k.value = val;
			save();
			renderControls();
			renderEntries();
		});
	}
	const c = $("entries-compact");
	if (c) {
		c.addEventListener("change", (e) => {
			state.entriesCompact = !!e.target.checked;
			save(); renderEntries();
		});
	}
	const sortBtn = $("entries-sort-toggle");
	if (sortBtn) {
		sortBtn.addEventListener("click", () => {
			state.entriesSort = state.entriesSort === "date" ? "custom" : "date";
			save();
			renderControls();
			renderEntries();
		});
	}
}

function openEdit(id) {
	const e = state.entries.find((x) => x.id === id);
	if (!e) return;
	const date = prompt("日付 (YYYY-MM-DD)", e.date);
	if (!date) return;
	const kind = prompt("種類 (income|expense|future-small|future-large|snapshot)", e.kind);
	if (!kind) return;
	const amountStr = prompt("金額 (数値のみ)", String(toInt(e.amount)));
	const amount = toInt(amountStr);
	const note = prompt("メモ", e.note || "") || "";
	const recurring = confirm("毎月くり返しにしますか？（OK=はい / キャンセル=いいえ）");
	let endDate = null;
	if (recurring) {
		endDate = prompt("くり返し終了日 (YYYY-MM-DD、未入力可)", e.endDate || "") || null;
	}
	updateEntry(id, { date, kind, amount, note, recurring, endDate });
}

// Modal editor
let currentEditId = null;
let editModal, editForm, editNote, editDate, editAmount, editCancel, editClose;
function initEditModal() {
	editModal = document.getElementById("edit-modal");
	if (!editModal) return;
	editForm = document.getElementById("edit-form");
	editNote = editModal.querySelector("input[data-edit='note']");
	editDate = editModal.querySelector("input[data-edit='date']");
	editAmount = editModal.querySelector("input[data-edit='amount']");
	editCancel = document.getElementById("edit-cancel");
	editClose = document.getElementById("edit-close");

	const close = () => closeEditModal();
	editCancel.addEventListener("click", close);
	editClose.addEventListener("click", close);
	editModal.addEventListener("click", (e) => {
		if (e.target === editModal) close();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !editModal.hasAttribute("hidden")) close();
	});
	editForm.addEventListener("submit", (e) => {
		e.preventDefault();
		if (!currentEditId) return;
		const note = editNote.value.trim();
		const date = editDate.value;
		const amount = toInt(editAmount.value);
		if (!date || !amount) { alert("日付と金額は必須です。"); return; }
		updateEntry(currentEditId, { note, date, amount });
		closeEditModal();
	});
	// format amount live
	editAmount.addEventListener("input", (e) => {
		const n = toInt(e.target.value);
		e.target.value = n ? n.toLocaleString("ja-JP") : "";
	});
}
function openEditModal(id) {
	const e = state.entries.find((x) => x.id === id);
	if (!e || !editModal) return;
	currentEditId = id;
	editNote.value = e.note || "";
	editDate.value = e.date || "";
	editAmount.value = toInt(e.amount) ? toInt(e.amount).toLocaleString("ja-JP") : "";
	editModal.removeAttribute("hidden");
	editNote.focus();
	document.body.classList.add("no-scroll");
}
function closeEditModal() {
	if (!editModal) return;
	editModal.setAttribute("hidden", "");
	currentEditId = null;
	document.body.classList.remove("no-scroll");
}

// Export
function doExport() {
	const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `zandaka-${todayStr()}.json`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

// Sample import removed by user request

// HTML escaping
function escapeHtml(s) {
	return String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

// Boot
load();
ensureDefaults();
wireControls();
renderAll();
initEditModal();

// Enhance native date inputs: clicking anywhere on the field opens the picker
(function enhanceNativeDatePickers(){
  if (window.__customCalendarEnabled) return; // use custom calendar if enabled
  const ids = ["base-date","range-start","range-end","entry-date","entry-end"];
  ids.forEach((id)=>{
    const el = document.getElementById(id);
    if (!el) return;
    const container = el.closest('.date-field') || el.parentElement || el;
    // Make whole field clickable
    container.style.cursor = 'pointer';
    container.addEventListener('click', (e)=>{
      // Prevent document-level click handler from immediately closing custom popover
      e.stopPropagation();
      if (e.target !== el) el.focus();
      if (window.__customCalendarEnabled) {
        // focus event opens custom calendar; ensure it runs within this turn
        try { el.dispatchEvent(new Event('focus', { bubbles: false })); } catch {}
      } else if (typeof el.showPicker === 'function') {
        // fallback to native picker if custom disabled
        try { el.showPicker(); } catch {}
      }
    });
  });
})();

// --- Custom Calendar Popover (for better UX) ---
(function initCustomCalendar() {
	// Enable custom calendar popover
	window.__customCalendarEnabled = true;
	document.body.classList.add("custom-calendar");
	// Cleanup any previously injected custom elements if present (idempotency)
	try {
		document.querySelectorAll(".calendar-popover, .calendar-btn").forEach((el) => el.remove());
	} catch {}
	// enhance all date inputs on the page and future ones
	const inputs = Array.from(document.querySelectorAll("input[type='date']"));

	// create single popover
	let pop = document.createElement("div");
	pop.className = "calendar-popover";
	pop.style.display = "none";
	pop.innerHTML = `
		<div class="calendar-header">
			<button type="button" class="calendar-nav" data-cal="prev" aria-label="前の月">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
			</button>
			<div class="title"></div>
			<button type="button" class="calendar-nav" data-cal="next" aria-label="次の月">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
			</button>
		</div>
		<div class="calendar-grid weekdays"></div>
		<div class="calendar-grid days"></div>
	`;
	document.body.appendChild(pop);

	const titleEl = pop.querySelector(".title");
	const weekdaysEl = pop.querySelector(".weekdays");
	const daysEl = pop.querySelector(".days");
	["日","月","火","水","木","金","土"].forEach((w) => {
		const d = document.createElement("div");
		d.className = "weekday";
		d.textContent = w;
		weekdaysEl.appendChild(d);
	});

	let activeInput = null;
	let viewYear = new Date().getFullYear();
	let viewMonth = new Date().getMonth(); // 0-11

	function parseInputDate(input) {
		const v = input.value;
		if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
			const d = toDate(v);
			return d;
		}
		return new Date();
	}
	function getMonthMatrix(year, month) {
		// Robust Sunday-first 6-week grid using UTC stepping to avoid DST drift
		const firstLocal = new Date(year, month, 1);
		const dowLocal = firstLocal.getDay(); // 0=Sun..6=Sat
		const back = dowLocal; // distance back to Sunday
		const startUTC = Date.UTC(year, month, 1 - back);
		const MS_DAY = 24 * 60 * 60 * 1000;
		const holidays = buildJapaneseHolidays(year);
		const cells = [];
		for (let i = 0; i < 42; i++) {
			const dUTC = new Date(startUTC + i * MS_DAY);
			const d = new Date(dUTC.getUTCFullYear(), dUTC.getUTCMonth(), dUTC.getUTCDate());
			const out = dUTC.getUTCMonth() !== month;
			const day = dUTC.getUTCDate();
			const holiday = (!out && (d.getDay() === 0 || holidays.has(ymd(d))));
			cells.push({ year, month, day, out, date: d, holiday });
		}
		return cells;
	}
	function renderCalendar() {
		const monthName = `${viewYear}年 ${String(viewMonth + 1).padStart(2, "0")}月`;
		titleEl.textContent = monthName;
		daysEl.innerHTML = "";
		const cells = getMonthMatrix(viewYear, viewMonth);
		const today = new Date();
		const todayStr = ymd(today);
		const selectedStr = activeInput ? activeInput.value : "";
		for (const c of cells) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "daycell";
			if (c.out) btn.classList.add("out");
			const dstr = ymd(c.date);
			if (dstr === todayStr) btn.classList.add("today");
			if (selectedStr && dstr === selectedStr) btn.classList.add("selected");
			if (!c.out && c.holiday) btn.classList.add("holiday");
			btn.textContent = String(c.day);
			btn.addEventListener("click", () => {
				if (!activeInput) return;
				activeInput.value = dstr;
				activeInput.dispatchEvent(new Event("change"));
				closeCalendar();
			});
			daysEl.appendChild(btn);
		}
	}
	function openCalendarFor(input) {
		activeInput = input;
		const d = parseInputDate(input);
		viewYear = d.getFullYear();
		viewMonth = d.getMonth();
		renderCalendar();
		pop.style.display = "block";
		pop.classList.add("open");
		// position
		const r = input.getBoundingClientRect();
		const pad = 6;
		let left = r.left;
		let top = r.bottom + pad;
		const width = pop.offsetWidth || Math.min(window.innerWidth * 0.92, 384);
		if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
		if (left < 8) left = 8;
		if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top - pop.offsetHeight - pad;
		if (top < 8) top = 8;
		pop.style.left = `${left}px`;
		pop.style.top = `${top}px`;
	}
	function closeCalendar() {
		pop.style.display = "none";
		pop.classList.remove("open");
		activeInput = null;
	}

	pop.addEventListener("click", (e) => e.stopPropagation());
	document.addEventListener("click", (e) => {
		if (pop.style.display === "none") return;
		if (activeInput && (e.target === activeInput)) return;
		closeCalendar();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") closeCalendar();
	});
	pop.querySelector("[data-cal='prev']").addEventListener("click", () => {
		viewMonth -= 1;
		if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
		renderCalendar();
	});
	pop.querySelector("[data-cal='next']").addEventListener("click", () => {
		viewMonth += 1;
		if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
		renderCalendar();
	});

	function addButtonFor(input) {
		if (input.dataset.enhanced === "1") return;
		input.dataset.enhanced = "1";
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "calendar-btn";
		btn.setAttribute("aria-label", "日付を選択");
		btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<rect x="3" y="5" width="18" height="16" rx="2"></rect>
			<path d="M16 3v4M8 3v4M3 11h18"></path>
		</svg>`;
		// place inside same field container
		const parent = input.closest(".field") || input.parentElement;
		if (parent) {
			parent.appendChild(btn);
      btn.addEventListener("click", (e) => {
        e.stopPropagation(); // don't let document click close it right away
				if (input.disabled) return;
				openCalendarFor(input);
			});
		}
		input.addEventListener("focus", () => {
			if (input.disabled) return;
			openCalendarFor(input);
		});
	}

	inputs.forEach(addButtonFor);

	// Observe DOM for dynamically added date inputs (e.g., inline editor)
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			if (m.type === "childList") {
				m.addedNodes.forEach((node) => {
					if (!(node instanceof HTMLElement)) return;
					if (node.matches && node.matches("input[type='date']")) {
						addButtonFor(node);
					}
					node.querySelectorAll?.("input[type='date']").forEach((el) => addButtonFor(el));
				});
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
})();


// --- Custom Kind Select Popover ---
(function initKindSelect() {
  const trigger = document.getElementById("kind-trigger");
  const selectEl = document.getElementById("entry-kind");
  if (!trigger || !selectEl) return;

  const options = [
    { value: "income", label: "収入", icon: "<svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M12 19V5M5 12l7-7 7 7'/></svg>" },
    { value: "expense", label: "支出", icon: "<svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M19 12H5'/></svg>" },
    { value: "future-large", label: "未来予定支出", icon: "<svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 3'/></svg>" }
  ];

  // popover
  const pop = document.createElement("div");
  pop.className = "kind-popover";
  pop.style.display = "none";
  pop.innerHTML = options.map(o => `
    <div class="kind-option" data-value="${o.value}">
      <span class="kind-icon">${o.icon}</span>
      <span>${o.label}</span>
    </div>
  `).join("");
  document.body.appendChild(pop);

  function positionPopover() {
    const r = trigger.getBoundingClientRect();
    const pad = 6;
    let left = r.left;
    let top = r.bottom + pad;
    const width = Math.max(220, r.width);
    pop.style.minWidth = width + "px";
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top - pop.offsetHeight - pad;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
  function open() {
    pop.style.display = "block";
    positionPopover();
  }
  function close() { pop.style.display = "none"; }
  function isOpen() { return pop.style.display !== "none"; }

  function setValue(v) {
    selectEl.value = v;
    const found = options.find(o => o.value === v);
    trigger.textContent = found ? found.label : v;
    trigger.dataset.value = v;
    // fire change for any listeners (future use)
    selectEl.dispatchEvent(new Event("change"));
  }

  trigger.addEventListener("click", () => {
    if (isOpen()) close(); else open();
  });
  document.addEventListener("click", (e) => {
    if (e.target === trigger || trigger.contains(e.target)) return;
    if (pop.contains(e.target)) return;
    if (isOpen()) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  pop.querySelectorAll(".kind-option").forEach(el => {
    el.addEventListener("click", () => { setValue(el.getAttribute("data-value")); close(); });
  });

  // initialize label from current select
  setValue(selectEl.value || "income");
})();


