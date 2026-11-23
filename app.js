const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const imagePreview = document.getElementById('image-preview');
const uploadPreview = document.getElementById('upload-preview');
const removeImage = document.getElementById('remove-image');
const analyzeButton = document.getElementById('analyze-button');
const buttonLabel = document.getElementById('button-label');
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const resultElement = document.getElementById('analysis-result');
const reportBadge = document.getElementById('report-badge');
const toast = document.getElementById('toast');
let selectedFile = null;
let lastRequest = null;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function setState(state) {
  emptyState.hidden = state !== 'empty';
  loadingState.hidden = state !== 'loading';
  errorState.hidden = state !== 'error';
  resultElement.hidden = state !== 'result';
  analyzeButton.disabled = !selectedFile || state === 'loading';
  analyzeButton.classList.toggle('is-loading', state === 'loading');
  buttonLabel.textContent = state === 'loading' ? 'Analyzing chart…' : 'Analyze screenshot';
  if (state === 'loading') reportBadge.textContent = 'READING CHART';
  else if (state === 'result') reportBadge.textContent = 'ANALYSIS READY';
  else if (state === 'error') reportBadge.textContent = 'NEEDS A RETRY';
  else reportBadge.textContent = 'AWAITING CHART';
}

function acceptFile(file) {
  if (!file) return;
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(file.type)) return showToast('Choose a PNG, JPG, or WebP screenshot.');
  if (file.size > 8 * 1024 * 1024) return showToast('That image is over 8 MB. Choose a smaller screenshot.');
  selectedFile = file;
  imagePreview.src = URL.createObjectURL(file);
  imagePreview.hidden = false;
  uploadPreview.hidden = true;
  removeImage.hidden = false;
  analyzeButton.disabled = false;
  if (!resultElement.hidden || !errorState.hidden) setState('empty');
}

function clearImage() {
  if (imagePreview.src.startsWith('blob:')) URL.revokeObjectURL(imagePreview.src);
  imagePreview.removeAttribute('src');
  imagePreview.hidden = true;
  uploadPreview.hidden = false;
  removeImage.hidden = true;
  selectedFile = null;
  fileInput.value = '';
  analyzeButton.disabled = true;
  setState('empty');
}

fileInput.addEventListener('change', () => acceptFile(fileInput.files[0]));
dropzone.addEventListener('click', event => {
  if (!event.target.closest('.remove-image')) fileInput.click();
});
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
});
removeImage.addEventListener('click', event => { event.stopPropagation(); clearImage(); });
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('drag-over'); });
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('drag-over'); });
dropzone.addEventListener('drop', event => acceptFile(event.dataTransfer.files[0]));

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file. Please try another screenshot.'));
    reader.readAsDataURL(file);
  });
}

function safeText(value, fallback = 'Not clearly visible in this screenshot.') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function listItems(values, fallback) {
  const items = Array.isArray(values) ? values.filter(item => typeof item === 'string' && item.trim()) : [];
  return (items.length ? items : [fallback]).map(item => `<li>${escapeHtml(item)}</li>`).join('');
}
function renderAnalysis(data) {
  const bias = ['Bullish', 'Bearish', 'Range', 'Unclear'].includes(data.bias) ? data.bias : 'Unclear';
  const confidence = Number.isFinite(Number(data.confidence)) ? Math.max(0, Math.min(100, Number(data.confidence))) : 0;
  const levels = Array.isArray(data.keyLevels) ? data.keyLevels.filter(level => level && typeof level === 'object').slice(0, 8) : [];
  const scenarios = Array.isArray(data.scenarios) ? data.scenarios.filter(item => item && typeof item === 'object').slice(0, 4) : [];
  resultElement.innerHTML = `
    <div class="report-meta"><span class="bias-pill bias-${bias.toLowerCase()}"><i></i>${escapeHtml(bias)} bias</span><span class="confidence-label">IMAGE / SETUP CLARITY <strong>${confidence}%</strong></span></div>
    <div class="confidence-track"><span style="width:${confidence}%"></span></div>
    <p class="report-summary">${escapeHtml(safeText(data.summary))}</p>
    <div class="insight-grid">
      <article class="insight-card"><span class="insight-kicker">MARKET TREND</span><p>${escapeHtml(safeText(data.trend))}</p></article>
      <article class="insight-card"><span class="insight-kicker">PRICE STRUCTURE</span><p>${escapeHtml(safeText(data.structure))}</p></article>
    </div>
    <section class="report-section"><div class="section-heading"><h3>Key levels</h3><span>VISIBLE ON CHART</span></div>${levels.length ? `<div class="levels-list">${levels.map(level => `<div class="level-row"><span>${escapeHtml(safeText(level.label, 'Level'))}</span><strong>${escapeHtml(safeText(level.value, 'Not legible'))}</strong></div>`).join('')}</div>` : '<p class="muted-copy">No readable price levels detected. Check that the price scale is included.</p>'}</section>
    <section class="report-section"><div class="section-heading"><h3>Possible scenarios</h3><span>CONDITIONAL · NOT SIGNALS</span></div>${scenarios.length ? `<div class="scenario-list">${scenarios.map((scenario, i) => `<article class="scenario-card"><span class="scenario-index">0${i + 1}</span><div><strong>${escapeHtml(safeText(scenario.name, 'Scenario'))}</strong><p><b>If:</b> ${escapeHtml(safeText(scenario.condition))}</p><p><b>Watch:</b> ${escapeHtml(safeText(scenario.observation))}</p></div></article>`).join('')}</div>` : '<p class="muted-copy">No clear scenarios could be inferred from this image.</p>'}</section>
    <section class="invalidation-box"><span class="invalidation-icon">↯</span><div><strong>What would challenge this read</strong><p>${escapeHtml(safeText(data.invalidation))}</p></div></section>
    <div class="insight-grid lower-grid"><section class="report-section"><div class="section-heading"><h3>Risk &amp; context</h3></div><ul class="report-list">${listItems(data.riskNotes, 'Verify the chart and context independently.')}</ul></section><section class="report-section"><div class="section-heading"><h3>What is visible</h3></div><ul class="report-list">${listItems(data.observations, 'No additional clear observations.')}</ul></section></div>
    <div class="report-disclaimer">AI can misread chart images and does not have live market data. Educational analysis only—not a recommendation to buy, sell, or hold.</div>`;
  setState('result');
}

async function analyze(file = selectedFile) {
  if (!file) return showToast('Add a chart screenshot first.');
  selectedFile = file;
  setState('loading');
  try {
    const image = await readAsDataUrl(file);
    lastRequest = { image, mimeType: file.type, asset: document.getElementById('asset').value, timeframe: document.getElementById('timeframe').value };
    const response = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastRequest)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The analysis service is unavailable. Please try again.');
    renderAnalysis(body.analysis || {});
    document.getElementById('results-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    document.getElementById('error-message').textContent = error.message || 'Something went wrong. Please try again.';
    setState('error');
  }
}

analyzeButton.addEventListener('click', () => analyze());
document.getElementById('retry-button').addEventListener('click', () => analyze());
document.getElementById('history-link').addEventListener('click', () => showToast('Recent screenshots are not saved to protect your privacy.'));
document.getElementById('menu-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('sidebar-open'));
