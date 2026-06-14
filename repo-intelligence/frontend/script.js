function parseGitHubUrl(url) {
  url = url.trim();
  const m = url.match(/github\.com\/([^\/]+)\/([^\/\s?#]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function setStatus(msg) {
  document.getElementById('statusBar').className = 'status-bar show';
  document.getElementById('statusText').textContent = msg;
}

function hideStatus() {
  document.getElementById('statusBar').className = 'status-bar';
}

function showError(msg) {
  const el = document.getElementById('errorBox');
  el.textContent = msg;
  el.className = 'error-box show';
}

function hideError() {
  document.getElementById('errorBox').className = 'error-box';
}

function colorConfig(c) {
  const map = {
    teal:  { bg: '#e0f5ee', text: '#0f6e56', border: '#5dcaa5' },
    green: { bg: '#eaf3de', text: '#3b6d11', border: '#97c459' },
    amber: { bg: '#faeeda', text: '#854f0b', border: '#ef9f27' },
    red:   { bg: '#fcebeb', text: '#a32d2d', border: '#f09595' },
    blue:  { bg: '#e6f1fb', text: '#185fa5', border: '#85b7eb' },
  };
  return map[c] || map.blue;
}

function renderReport(ai, repo) {
  const cfg = colorConfig(ai.scoreColor);
  const daysSincePush = Math.round((Date.now() - new Date(repo.pushed_at)) / 86400000);

  document.getElementById('scoreBanner').innerHTML = `
    <div class="score-circle" style="border-color:${cfg.border};background:${cfg.bg};">
      <span class="score-num" style="color:${cfg.text}">${ai.investorScore}</span>
      <span class="score-lbl" style="color:${cfg.text}">/ 100</span>
    </div>
    <div class="score-info">
      <h2>${repo.full_name}</h2>
      <p>${ai.oneLiner}</p>
      <div style="margin-top:8px">${(ai.badges||[]).map(b=>`<span class="badge" style="background:${cfg.bg};color:${cfg.text};border-color:${cfg.border}">${b}</span>`).join('')}</div>
    </div>`;

  document.getElementById('metricsGrid').innerHTML = [
    { label: 'Stars',           value: repo.stargazers_count.toLocaleString(), sub: 'GitHub stars' },
    { label: 'Forks',           value: repo.forks_count.toLocaleString(),      sub: 'Community forks' },
    { label: 'Days since push', value: daysSincePush,                           sub: 'Recency' },
    { label: 'Releases',        value: ai.investorSummary ? repo.forks_count : '—', sub: 'Version history' },
  ].map(m => `
    <div class="metric-card">
      <div class="m-label">${m.label}</div>
      <div class="m-value">${m.value}</div>
      <div class="m-sub">${m.sub}</div>
    </div>`).join('');

  const qCfg = colorConfig(
    ai.codeQuality?.score === 'Excellent' ? 'teal' :
    ai.codeQuality?.score === 'Good'      ? 'green' : 'amber'
  );
  document.getElementById('codeQualityCard').innerHTML = `
    <h3>Code Quality <span style="font-size:12px;font-weight:400;padding:3px 10px;border-radius:20px;background:${qCfg.bg};color:${qCfg.text};margin-left:auto">${ai.codeQuality?.score||'—'}</span></h3>
    <ul class="insight-list">${(ai.codeQuality?.points||[]).map(p=>`<li>• ${p}</li>`).join('')}</ul>`;

  const sCfg = colorConfig(
    ai.security?.score === 'High'   ? 'teal' :
    ai.security?.score === 'Medium' ? 'amber' : 'red'
  );
  document.getElementById('securityCard').innerHTML = `
    <h3>Security <span style="font-size:12px;font-weight:400;padding:3px 10px;border-radius:20px;background:${sCfg.bg};color:${sCfg.text};margin-left:auto">${ai.security?.score||'—'}</span></h3>
    <ul class="insight-list">${(ai.security?.points||[]).map(p=>`<li>• ${p}</li>`).join('')}</ul>`;

  document.getElementById('aiInsightsCard').innerHTML = `
    <h3>AI Insights</h3>
    <ul class="insight-list">${(ai.aiInsights||[]).map(p=>`<li>✦ ${p}</li>`).join('')}</ul>`;

  document.getElementById('techStackCard').innerHTML = `
    <h3>Tech Stack</h3>
    <div class="tag-cloud">${(ai.techStack||[]).map(t=>`<span class="tech-tag">${t}</span>`).join('')}</div>`;

  const recColor =
    ai.investorSummary?.recommendation?.toLowerCase().startsWith('buy')   ? 'teal' :
    ai.investorSummary?.recommendation?.toLowerCase().startsWith('watch') ? 'amber' : 'red';
  const recCfg = colorConfig(recColor);

  document.getElementById('investorSummaryCard').innerHTML = `
    <h3>Investor Summary</h3>
    <p style="font-size:13px;color:#555;margin-bottom:12px">${ai.verdict}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <p style="font-size:12px;color:#888;margin-bottom:6px;font-weight:600">Strengths</p>
        <ul class="insight-list">${(ai.investorSummary?.strengths||[]).map(s=>`<li>✓ ${s}</li>`).join('')}</ul>
      </div>
      <div>
        <p style="font-size:12px;color:#888;margin-bottom:6px;font-weight:600">Risks</p>
        <ul class="insight-list">${(ai.investorSummary?.risks||[]).map(r=>`<li>⚠ ${r}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="rec-box" style="background:${recCfg.bg};border:1px solid ${recCfg.border}">
      <span style="font-weight:600;color:${recCfg.text}">Recommendation: </span>
      <span style="color:${recCfg.text}">${ai.investorSummary?.recommendation||'—'}</span>
    </div>`;

  document.getElementById('report').className = 'report show';
}

async function analyzeRepo() {
  hideError();
  document.getElementById('report').className = 'report';

  const url = document.getElementById('repoUrl').value;
  if (!url.trim()) { showError('Please enter a GitHub repository URL.'); return; }

  const parsed = parseGitHubUrl(url);
  if (!parsed) { showError('Invalid GitHub URL. Format: https://github.com/owner/repository'); return; }

  try {
    setStatus('Fetching repository data...');
   const res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: parsed.owner, repo: parsed.repo }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    setStatus('Generating report...');
    hideStatus();
    renderReport(data.ai, data.github);
  } catch (e) {
    hideStatus();
    showError(e.message || 'Something went wrong. Make sure backend is running.');
  }
}

function resetTool() {
  document.getElementById('repoUrl').value = '';
  document.getElementById('report').className = 'report';
  hideError();
  hideStatus();
}

function downloadPDF() {
  window.print();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('repoUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') analyzeRepo();
  });
});
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  document.getElementById('themeToggle').textContent = isDark ? '☀️ Light' : '🌙 Dark';
}