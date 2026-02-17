const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTlWVa7_Fb6Ti-uFli1ThK0q8E1jyHenz6hdYTlNmPq14_icpSzpQmU4vniWpnqXfjpIeZeLz4dLZqp/pub?gid=0&single=true&output=csv';

const PROXIES = [
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&t=${Date.now()}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url + '&t=' + Date.now())}`
];

let dashboardData = {
    units: [],
    dates: [],
    overallTotal: 0,
    totalTellers: 0,
    avgDaily: 0
};

let chartInstance = null;
let comparisonChartInstance = null;

// Initial application state
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});


async function initApp() {
    setupTabSwitching();
    setupSearch();
    setupRefresh();
    setupLogout();

    if (localStorage.getItem('isLoggedIn') === 'true') {
        await fetchData();
    }
}


function setupLogout() {
    document.getElementById('logout-btn').addEventListener('click', () => {
        const appContainer = document.querySelector('.app-container');
        appContainer.classList.add('exit-animation');

        setTimeout(() => {
            localStorage.removeItem('isLoggedIn');
            window.location.href = 'login.html';
        }, 600);
    });
}

function setupTabSwitching() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabs = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = item.getAttribute('data-tab');

            navItems.forEach(ni => ni.classList.remove('active'));
            item.classList.add('active');

            tabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.id === `${targetTab}-tab`) {
                    tab.classList.add('active');
                }
            });
        });
    });
}

function setupSearch() {
    const searchInput = document.getElementById('teller-search');
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        filterTable(term);
    });
}

function setupRefresh() {
    document.getElementById('refresh-btn').addEventListener('click', fetchData);
}

async function fetchData() {
    showLoading(true);
    let success = false;
    let lastError = null;

    for (let i = 0; i < PROXIES.length; i++) {
        try {
            const progress = 10 + (i * 25);
            setProgress(progress, `Attempting Data Connection (Node ${i + 1})...`);
            console.log(`Trying Proxy ${i + 1}...`);
            const proxyUrl = PROXIES[i](SHEET_URL);
            const response = await fetch(proxyUrl);

            setProgress(progress + 15, 'Handshaking with Data Server...');

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            let csvText = '';
            if (proxyUrl.includes('allorigins.win')) {
                const data = await response.json();
                csvText = data.contents;
            } else {
                csvText = await response.text();
            }

            if (csvText && csvText.length > 50) {
                setProgress(90, 'Filtering & Structuring Dataset...');
                Papa.parse(csvText, {
                    complete: (results) => {
                        processCSV(results.data);
                        renderDashboard();
                        showLoading(false);
                        updateSyncTime();
                    }
                });
                success = true;
                console.log(`Success with Proxy ${i + 1}`);
                break;
            }
        } catch (error) {
            console.warn(`Proxy ${i + 1} failed`, error);
            lastError = error;
        }
    }

    if (!success) {
        showLoading(false);
        alert('CORS Error: Unable to fetch data. Please try again later.');
    }
}

function processCSV(rows) {
    let units = [];
    let currentUnit = null;
    let dates = [];

    rows.forEach((row, index) => {
        if (!row[0]) return;

        // Detect new header/unit
        if (row[1] && row[1].toLowerCase() === 'teller') {
            if (currentUnit) units.push(currentUnit);

            dates = row.slice(2).filter(d => d);
            currentUnit = {
                name: row[0],
                tellers: [],
                total: 0,
                dailyTotals: new Array(dates.length).fill(0)
            };
            dashboardData.dates = dates;
        } else if (row[0].toLowerCase() === 'total') {
            // End of current unit group is usually marked by TOTAL row
            // We'll capture it just to be safe, but we also calculate our own
        } else if (currentUnit) {
            // Teller row
            const tellerName = row[0];
            const dailyValues = row.slice(2).map(val => parseFloat(val) || 0);

            if (dailyValues.some(v => v > 0)) {
                const tellerTotal = dailyValues.reduce((a, b) => a + b, 0);

                currentUnit.tellers.push({
                    name: tellerName,
                    daily: dailyValues,
                    total: tellerTotal
                });

                currentUnit.total += tellerTotal;
                dailyValues.forEach((val, i) => {
                    if (i < currentUnit.dailyTotals.length) {
                        currentUnit.dailyTotals[i] += val;
                    }
                });
            }
        }
    });

    if (currentUnit) units.push(currentUnit);

    dashboardData.units = units;

    // Overall Stats
    dashboardData.overallTotal = units.reduce((sum, u) => sum + u.total, 0);
    dashboardData.totalTellers = units.reduce((count, u) => count + u.tellers.length, 0);

    const totalDays = dashboardData.dates.length;
    dashboardData.avgDaily = totalDays > 0 ? (dashboardData.overallTotal / totalDays) : 0;
}

function renderDashboard() {
    updateSummaryStats();
    renderChart();
    renderUnitCards();
    renderTable();
    renderComparison();
}

function updateSummaryStats() {
    document.getElementById('total-gross-val').textContent = formatCurrency(dashboardData.overallTotal);
    document.getElementById('total-tellers-val').textContent = dashboardData.totalTellers;
    document.getElementById('avg-daily-val').textContent = formatCurrency(dashboardData.avgDaily);

    if (dashboardData.dates.length > 0) {
        document.getElementById('current-range').textContent = `${dashboardData.dates[0]} - ${dashboardData.dates[dashboardData.dates.length - 1]}`;
    }
}

function renderChart() {
    const ctx = document.getElementById('grossChart').getContext('2d');

    // Aggregate daily totals across all units
    const dailyAggregated = new Array(dashboardData.dates.length).fill(0);
    dashboardData.units.forEach(unit => {
        unit.dailyTotals.forEach((val, i) => {
            dailyAggregated[i] += val;
        });
    });

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dashboardData.dates,
            datasets: [{
                label: 'Global Gross',
                data: dailyAggregated,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#8b5cf6',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}

function renderUnitCards() {
    const container = document.getElementById('groups-container');
    container.innerHTML = '';

    dashboardData.units.forEach((unit, index) => {
        const card = document.createElement('div');
        card.className = 'group-card animate-up';
        card.style.animationDelay = `${Math.min(0.3 + (index * 0.1), 1.5)}s`;

        // Pick top performers for the card summary
        const topTellers = [...unit.tellers]
            .sort((a, b) => b.total - a.total)
            .slice(0, 3);

        card.innerHTML = `
            <div class="group-header">
                <span class="group-name">${unit.name}</span>
                <span class="group-total">${formatCurrency(unit.total)}</span>
            </div>
            <div class="teller-list">
                ${topTellers.map(t => `
                    <div class="teller-item">
                        <span class="teller-info">${t.name}</span>
                        <span>${formatCurrency(t.total)}</span>
                    </div>
                `).join('')}
                ${unit.tellers.length > 3 ? `<div class="teller-item" style="justify-content: center; font-size: 0.75rem; color: #64748b;">+ ${unit.tellers.length - 3} more tellers</div>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function renderTable() {
    const headRow = document.getElementById('table-head-row');
    const body = document.getElementById('table-body');

    // Reset headers (except Teller and Unit)
    headRow.innerHTML = '<th>Teller</th><th>Unit</th>';
    dashboardData.dates.forEach(date => {
        const th = document.createElement('th');
        th.textContent = date;
        th.className = 'text-right';
        headRow.appendChild(th);
    });
    const totalTh = document.createElement('th');
    totalTh.textContent = 'Grand Total';
    totalTh.className = 'text-right';
    headRow.appendChild(totalTh);

    // Populate rows
    body.innerHTML = '';
    dashboardData.units.forEach((unit, uIdx) => {
        unit.tellers.forEach((teller, tIdx) => {
            const tr = document.createElement('tr');
            tr.className = 'animate-fade';
            tr.style.animationDelay = `${Math.min(0.1 + (tIdx * 0.03), 1.2)}s`;
            tr.innerHTML = `
                <td><strong>${teller.name}</strong></td>
                <td><span class="badge">${unit.name}</span></td>
                ${teller.daily.map(v => `<td class="text-right">${v > 0 ? v.toLocaleString() : '-'}</td>`).join('')}
                <td class="text-right"><strong>${teller.total.toLocaleString()}</strong></td>
            `;
            body.appendChild(tr);
        });
    });
}

function filterTable(term) {
    const rows = document.querySelectorAll('#table-body tr');
    rows.forEach(row => {
        const name = row.cells[0].textContent.toLowerCase();
        const unit = row.cells[1].textContent.toLowerCase();
        if (name.includes(term) || unit.includes(term)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(val);
}

function showLoading(show) {
    const loader = document.getElementById('loading-overlay');
    if (show) {
        setProgress(0, 'Initializing Security Protocol...');
        loader.style.display = 'flex';
        loader.style.opacity = '1';
    } else {
        setProgress(100, 'Data Synchronization Complete');
        loader.style.transition = 'opacity 0.5s ease-out';
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }
}

function setProgress(percent, status) {
    const bar = document.getElementById('progress-bar');
    const statusText = document.getElementById('loading-status');
    const percentText = document.getElementById('loading-percent');

    if (bar) bar.style.width = `${percent}%`;
    if (statusText) statusText.textContent = status;
    if (percentText) percentText.textContent = `${Math.round(percent)}%`;
}

function updateSyncTime() {
    const now = new Date();
    document.getElementById('sync-time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderComparison() {
    if (dashboardData.dates.length < 2) return;

    // We assume 14 days of data based on the CSV (7 prev vs 7 current)
    // If more, we take the last 14
    const totalDays = dashboardData.dates.length;
    const currentPeriodStart = Math.max(0, totalDays - 7);
    const prevPeriodStart = Math.max(0, currentPeriodStart - 7);

    const currentDates = dashboardData.dates.slice(currentPeriodStart, totalDays);
    const prevDates = dashboardData.dates.slice(prevPeriodStart, currentPeriodStart);

    document.getElementById('prev-period-label').textContent = `${prevDates[0]} - ${prevDates[prevDates.length - 1]}`;
    document.getElementById('curr-period-label').textContent = `${currentDates[0]} - ${currentDates[currentDates.length - 1]}`;

    let totalPrev = 0;
    let totalCurr = 0;
    let unitComparisonData = [];

    dashboardData.units.forEach(unit => {
        const unitPrev = unit.dailyTotals.slice(prevPeriodStart, currentPeriodStart).reduce((a, b) => a + b, 0);
        const unitCurr = unit.dailyTotals.slice(currentPeriodStart, totalDays).reduce((a, b) => a + b, 0);

        totalPrev += unitPrev;
        totalCurr += unitCurr;

        unitComparisonData.push({
            name: unit.name,
            prev: unitPrev,
            curr: unitCurr,
            change: unitCurr - unitPrev,
            percent: unitPrev > 0 ? ((unitCurr - unitPrev) / unitPrev * 100) : 0
        });
    });

    document.getElementById('prev-period-total').textContent = formatCurrency(totalPrev);
    document.getElementById('curr-period-total').textContent = formatCurrency(totalCurr);

    const growth = totalPrev > 0 ? ((totalCurr - totalPrev) / totalPrev * 100) : 0;
    const growthBadge = document.getElementById('growth-badge');
    const growthPercent = document.getElementById('growth-percent');

    growthPercent.textContent = `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`;
    growthBadge.className = `growth-indicator ${growth >= 0 ? 'positive' : 'negative'}`;

    // Comparison Chart
    const ctx = document.getElementById('comparisonChart').getContext('2d');
    if (comparisonChartInstance) comparisonChartInstance.destroy();

    // Aggregate daily totals for the two 7-day windows
    const prevDaily = new Array(7).fill(0);
    const currDaily = new Array(7).fill(0);

    dashboardData.units.forEach(unit => {
        unit.dailyTotals.slice(prevPeriodStart, currentPeriodStart).forEach((v, i) => prevDaily[i] += v);
        unit.dailyTotals.slice(currentPeriodStart, totalDays).forEach((v, i) => currDaily[i] += v);
    });

    comparisonChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
            datasets: [
                {
                    label: 'Previous Period',
                    data: prevDaily,
                    backgroundColor: 'rgba(148, 163, 184, 0.5)',
                    borderRadius: 4
                },
                {
                    label: 'Current Period',
                    data: currDaily,
                    backgroundColor: '#8b5cf6',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { ticks: { color: '#94a3b8' } }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc' } }
            }
        }
    });

    // Comparison Table
    const tableBody = document.getElementById('unit-comparison-body');
    tableBody.innerHTML = '';

    unitComparisonData.sort((a, b) => b.curr - a.curr).forEach((data, index) => {
        const tr = document.createElement('tr');
        tr.className = 'animate-fade';
        tr.style.animationDelay = `${Math.min(0.2 + (index * 0.05), 1)}s`;
        tr.innerHTML = `
            <td><strong>${data.name}</strong></td>
            <td class="text-right">${formatCurrency(data.prev)}</td>
            <td class="text-right">${formatCurrency(data.curr)}</td>
            <td class="text-right ${data.change >= 0 ? 'trend-up' : 'trend-down'}">
                ${data.change >= 0 ? '+' : ''}${formatCurrency(data.change)}
            </td>
            <td class="text-right">
                <span class="trend-badge ${data.percent >= 0 ? 'trend-up' : 'trend-down'}">
                    ${data.percent >= 0 ? '↑' : '↓'} ${Math.abs(data.percent).toFixed(1)}%
                </span>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}
