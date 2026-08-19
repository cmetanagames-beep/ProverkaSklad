// @ts-check
/** @typedef {'checker'|'receiving'|'driver'|'logist'|'admin'} RoleKey */
/** @typedef {[string,string,string[]]} RoleContent */
/** @type {Record<RoleKey, RoleContent>} */
const roles = {
  checker: [
    'Сборщик видит заказы своего склада',
    'Открывает заказ, проверяет товар и документы, делает обязательные фотографии и завершает проверку.',
    ['Список текущих заказов', 'Плановая дата отгрузки', 'Фото и история результата'],
  ],
  receiving: [
    'Приёмка начинается с актуального Excel',
    'Сотрудник загружает новый файл, сверяет план и факт, указывает месяц и год срока годности и ячейку хранения.',
    ['Повторная загрузка файла', 'Факт и план по позиции', 'Срок годности и размещение'],
  ],
  driver: [
    'Водитель получает только свои рейсы',
    'На сегодня, завтра и в истории. Внутри — номер заказа и актуальная информация доставки из Bitrix24.',
    ['Адрес и контакт получателя', 'Условия и название ТК', 'Фото экспедиторской расписки'],
  ],
  logist: [
    'Логист контролирует данные до отправки',
    'Проверяет заказ, исправляет доступные поля Bitrix24, меняет водителя и видит расписку.',
    ['Поиск и просмотр заказа', 'Корректировка данных', 'Назначение водителя'],
  ],
  admin: [
    'Администратор управляет доступом и связями',
    'Создаёт сотрудников, связывает имя водителя с таблицей и выбирает отдельные Telegram-группы.',
    ['Пользователи и роли', 'Привязка имени водителя', 'Две Telegram-группы'],
  ],
};
/** @type {Record<RoleKey, string[]>} */
const screens = {
  checker: ['Заказы на проверку', 'АФУТ-003428', 'ИНДЭКС ООО', 'Плановая отгрузка · Завтра'],
  receiving: ['Поставка № 00456', 'CA032', 'Химический анкер, 300 мл', 'Срок годности · 08.2028'],
  driver: ['Мои рейсы', 'Заказ № 3424', 'Вагнермайер Руссланд', 'ТК Деловые линии · Сегодня'],
  logist: ['Управление отгрузками', '3424 · Вагнермайер', 'Магомедов Шамиль', 'Водитель назначен'],
  admin: ['Настройки приложения', 'Пользователи', 'Telegram · 2 канала', 'Bitrix24 · подключён'],
};
/** @param {string} selector */
function element(selector) {
  const found = document.querySelector(selector);
  if (!(found instanceof window.HTMLElement)) throw new Error(`Missing element: ${selector}`);
  return found;
}
/** @param {RoleKey} key */
function setRole(key) {
  const r = roles[key],
    s = screens[key];
  element('#roleTitle').textContent = r[0];
  element('#roleText').textContent = r[1];
  element('#roleList').innerHTML = r[2].map((x) => '<li>' + x + '</li>').join('');
  element('#roleDevice').innerHTML =
    '<div class="mini-app"><header><img src="/assets/logo.svg"><span>' +
    key +
    '</span></header><h4>' +
    s[0] +
    '</h4><div class="mini-row"><b>' +
    s[1] +
    '</b><small>' +
    s[2] +
    '</small><em>' +
    s[3] +
    '</em></div><div class="mini-row muted"><b>Следующая задача</b><small>Данные загружены</small></div><nav>Заказы　 История　 Профиль</nav></div>';
  document.querySelectorAll('.role-tabs button').forEach((b) => {
    if (b instanceof window.HTMLButtonElement) b.classList.toggle('active', b.dataset.role === key);
  });
}
document.querySelectorAll('.role-tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b instanceof window.HTMLButtonElement) setRole(/** @type {RoleKey} */ (b.dataset.role));
  })
);
setRole('checker');
/** @type {HTMLElement[]} */
const steps = [...document.querySelectorAll('#automationSteps button')].filter((b) => b instanceof window.HTMLElement);
/** @type {ReturnType<typeof setInterval>|undefined} */
let timer;
/** @param {number} i */
function setStep(i) {
  steps.forEach((b, n) => b.classList.toggle('active', n === i));
  element('#receiptCard').classList.toggle('active', i === 0);
  element('#telegramCard').classList.toggle('active', i === 2);
  element('#bitrixCard').classList.toggle('active', i === 1 || i === 3);
}
steps.forEach((b, i) => b.addEventListener('click', () => setStep(i)));
function play() {
  if (timer !== undefined) clearInterval(timer);
  let i = 0;
  setStep(i);
  timer = setInterval(() => {
    if (++i > 3) return clearInterval(timer);
    setStep(i);
  }, 1050);
}
element('#runAutomation').addEventListener('click', play);
element('#playDemo').addEventListener('click', () => {
  element('#automation').scrollIntoView({ behavior: 'smooth' });
  setTimeout(play, 650);
});
const observer = new window.IntersectionObserver(
  (es) => es.forEach((e) => e.target.classList.toggle('visible', e.isIntersecting)),
  { threshold: 0.14 }
);
document.querySelectorAll('.reveal').forEach((e) => observer.observe(e));
