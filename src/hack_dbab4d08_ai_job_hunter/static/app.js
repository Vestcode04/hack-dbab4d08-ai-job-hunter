// Frontend работает на том же домене, что и FastAPI — никаких API-ключей и CORS.
const form = document.getElementById('searchForm');
const container = document.getElementById('resultsContainer');
const feedback = document.getElementById('feedback');
const countBadge = document.getElementById('resultsCount');
const subtitle = document.getElementById('resultsSubtitle');
const submitButton = document.getElementById('submitButton');
const submitText = document.getElementById('submitText');
const statusNode = document.getElementById('serviceStatus');
const prefs = document.getElementById('preferences');
const charCounter = document.getElementById('charCounter');
const defaultEmptyHTML = container.innerHTML;
const moneyFormatter = new Intl.NumberFormat('ru-RU');

// Экранируем данные API перед вставкой в HTML.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${moneyFormatter.format(amount)} ₸` : 'Цена не указана';
}

function showError(text) {
  feedback.textContent = text;
  feedback.classList.remove('hidden');
}

function hideError() {
  feedback.textContent = '';
  feedback.classList.add('hidden');
}

function updateCount(n) {
  countBadge.textContent = String(n);
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  document.getElementById('resetButton').disabled = isLoading;
  submitText.textContent = isLoading ? 'Подбираем...' : 'Найти подрядчиков';
}

function showLoading() {
  updateCount(0);
  subtitle.textContent = 'Анализируем параметры мероприятия...';
  container.innerHTML = `
    <div class="loading-state" role="status">
      <div class="loading-wheel" aria-hidden="true"></div>
      <h3>Подбираем лучших кандидатов</h3>
      <p>Проверяем бюджет, дату, формат и учитываем твои пожелания.</p>
    </div>`;
}

function renderContractor(contractor, index) {
  const name = escapeHtml(contractor.name || 'Подрядчик');
  const category = escapeHtml(contractor.category || 'Подрядчик');
  const city = escapeHtml(contractor.city || '');
  const id = escapeHtml(contractor.id || '');
  const explanation = escapeHtml(contractor.explanation || 'Объяснение пока недоступно.');
  const score = Number(contractor.score);
  const scoreDisplay = Number.isFinite(score) ? score.toFixed(2) : '—';
  const languages = Array.isArray(contractor.languages) ? contractor.languages : [];
  const initials = Array.from(String(contractor.name || '?').trim())[0] || '?';
  const chips = languages.map((language) => `<span class="mini-chip">${escapeHtml(language)}</span>`).join('');

  return `
    <article class="result-card ${index === 0 ? 'highlight' : ''}">
      <div class="card-top">
        <span class="card-label">${index === 0 ? 'Лучшее совпадение' : 'Подходящий вариант'}</span>
        <span class="card-rank">#${index + 1}</span>
      </div>
      <div class="card-avatar" aria-hidden="true">${escapeHtml(initials.toUpperCase())}</div>
      <div class="card-main">
        <h3>${name}</h3>
        <div class="card-details">${category} · ${city} · ${id}</div>
      </div>
      <div class="card-divider"></div>
      <div class="card-stat-row">
        <div><span class="stat-label">Стоимость от</span><strong class="stat-value">${formatMoney(contractor.price_from_kzt)}</strong></div>
        <div><span class="stat-label">Рейтинг системы</span><strong class="score-tag">✦ ${scoreDisplay} <span>балла</span></strong></div>
      </div>
      <div class="card-explanation">
        <b>✦ Почему рекомендуем</b>
        <p>${explanation}</p>
      </div>
      <div class="card-bottom">${chips}</div>
    </article>`;
}

const rejectionLabels = {
  wrong_format: 'Другой формат мероприятия',
  over_budget: 'Выше бюджета',
  busy: 'Заняты в выбранную дату',
  duration: 'Не подходят по длительности'
};

function renderNoMatches(result) {
  const message = escapeHtml(result.message || 'Попробуй изменить параметры поиска.');
  const stats = result.rejection_stats || {};
  const reasons = Object.entries(rejectionLabels)
    .filter(([key]) => Number(stats[key]) > 0)
    .map(([key, label]) => `<div class="reason">${escapeHtml(label)}: <b>${Number(stats[key])}</b></div>`)
    .join('');

  container.innerHTML = `
    <div class="no-match-state">
      <div class="no-match-icon" aria-hidden="true">⌕</div>
      <h3>Пока нет подходящих вариантов</h3>
      <p>${message}</p>
      ${reasons ? `<div class="reason-list">${reasons}</div>` : ''}
    </div>`;
}

function renderResults(result) {
  const contractors = Array.isArray(result.contractors) ? result.contractors : [];
  if (result.status !== 'success' || !contractors.length) {
    updateCount(0);
    subtitle.textContent = 'Попробуй изменить бюджет, категорию или дату мероприятия.';
    renderNoMatches(result);
    return;
  }

  updateCount(contractors.length);
  subtitle.textContent = `Подобрано ${contractors.length} ${contractors.length === 1 ? 'вариант' : 'варианта'} по твоим параметрам.`;
  container.innerHTML = `
    <div class="result-grid">${contractors.map(renderContractor).join('')}</div>
    <p class="results-note">Рейтинг — внутренние баллы системы, а не процент вероятности успеха. Цены указаны «от». Подбор не создаёт бронирование.</p>`;
}

function getRequestData() {
  const data = new FormData(form);
  const duration = data.get('duration_hours');
  const language = data.get('language');
  const preferences = String(data.get('preferences') || '').trim();

  return {
    city: String(data.get('city')),
    date: String(data.get('date')),
    event_format: String(data.get('event_format')),
    category: String(data.get('category')).trim(),
    budget: Number(data.get('budget')),
    duration_hours: duration ? Number(duration) : null,
    language: language || null,
    preferences: preferences || null
  };
}

async function searchContractors(event) {
  event.preventDefault();
  hideError();
  const body = getRequestData();
  if (!body.category) {
    showError('Укажи категорию подрядчика.');
    document.getElementById('category').focus();
    return;
  }

  setLoading(true);
  showLoading();
  try {
    const response = await fetch('/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 422) {
        throw new Error('Проверь правильность заполнения полей. Даты в каталоге: 23.09–31.12.2026.');
      }
      throw new Error(`Ошибка сервера (${response.status}). Повтори попытку.`);
    }
    renderResults(result);
  } catch (error) {
    updateCount(0);
    subtitle.textContent = 'Не получилось загрузить рекомендации.';
    container.innerHTML = defaultEmptyHTML;
    bindExampleButton();
    showError(error instanceof TypeError ? 'Нет связи с сервером. Проверь Render и попробуй ещё раз.' : error.message);
  } finally {
    setLoading(false);
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function checkServer() {
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('offline');
    const status = await response.json();
    statusNode.classList.remove('offline');
    statusNode.classList.add('online');
    const loaded = Number(status.contractors_loaded);
    statusNode.lastElementChild.textContent = Number.isFinite(loaded)
      ? `Сервер онлайн · ${loaded} в каталоге`
      : 'Сервер онлайн';
  } catch (error) {
    statusNode.classList.remove('online');
    statusNode.classList.add('offline');
    statusNode.lastElementChild.textContent = 'Сервер недоступен';
  }
}

function bindExampleButton() {
  const button = document.getElementById('exampleButton');
  if (!button) return;
  button.addEventListener('click', () => {
    form.elements.city.value = 'Алматы';
    form.elements.date.value = '2026-10-15';
    form.elements.event_format.value = 'свадьба';
    form.elements.category.value = 'Ведущий';
    form.elements.budget.value = '1200000';
    form.elements.duration_hours.value = '8';
    form.elements.language.value = 'русский';
    prefs.value = 'Спокойный ведущий с ненавязчивым юмором';
    charCounter.textContent = `${prefs.value.length} / 500`;
    form.requestSubmit();
  });
}

prefs.addEventListener('input', () => {
  charCounter.textContent = `${prefs.value.length} / 500`;
});
form.addEventListener('submit', searchContractors);
form.addEventListener('reset', () => {
  // Сброс формы происходит после события reset.
  setTimeout(() => {
    prefs.dispatchEvent(new Event('input'));
    hideError();
    updateCount(0);
    subtitle.textContent = 'Заполни форму и запусти подбор.';
    container.innerHTML = defaultEmptyHTML;
    bindExampleButton();
  }, 0);
});
bindExampleButton();
checkServer();
