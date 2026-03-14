function formatDuration(seconds) {
    const s = Number(seconds || 0);
    if (!Number.isFinite(s) || s <= 0) return "0 min";
    const mins = Math.round(s / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
}

async function loadStats() {
    const container = document.getElementById("statsCards");
    if (!container) return;

    try {
        const resp = await fetch("/api/stats", { headers: { "Accept": "application/json" } });
        if (!resp.ok) throw new Error(`Stats failed: ${resp.status}`);
        const data = await resp.json();

        setText("statPatientsTotal", data?.patients?.total ?? "—");
        setText("statPatientsNewToday", data?.patients?.newToday ?? "—");
        setText("statPatientsNewMonth", data?.patients?.newThisMonth ?? "—");

        setText("statSessionsTotal", data?.sessions?.total ?? "—");
        setText("statSessionsActive", data?.sessions?.active ?? "—");
        setText("statSessionsCompleted", data?.sessions?.completed ?? "—");
        setText("statSessionsToday", data?.sessions?.created?.today ?? "—");
        setText("statSessionsWeek", data?.sessions?.created?.thisWeek ?? "—");
        setText("statSessionsMonth", data?.sessions?.created?.thisMonth ?? "—");

        setText("statSessionsAvgDuration", formatDuration(data?.sessions?.avgDurationSeconds));
        const rate = Number(data?.sessions?.completionRatePct ?? 0);
        setText("statSessionsCompletionRate", Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "—");
    } catch (err) {
        console.error(err);
        setText("statPatientsTotal", "—");
        setText("statPatientsNewToday", "—");
        setText("statPatientsNewMonth", "—");
        setText("statSessionsTotal", "—");
        setText("statSessionsActive", "—");
        setText("statSessionsCompleted", "—");
        setText("statSessionsToday", "—");
        setText("statSessionsWeek", "—");
        setText("statSessionsMonth", "—");
        setText("statSessionsAvgDuration", "—");
        setText("statSessionsCompletionRate", "—");
    }
}

document.addEventListener("DOMContentLoaded", loadStats);
