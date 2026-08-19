// @ts-check
/** @typedef {'checker'|'receiving'|'driver'|'logist'|'admin'} RoleKey */
const roles = {
  checker: {
    kicker: 'Сборка и проверка',
    title: 'Заказы своего склада — в одном списке',
    text: 'Сборщик открывает заказ, видит плановую дату, проходит инструкцию и фиксирует результат фотографиями.',
    list: ['Актуальный список заказов', 'Пошаговая проверка', 'История результата'],
    image: './assets/real-checker-orders.png',
  },
  receiving: {
    kicker: 'Приёмка',
    title: 'Новая поставка начинается с Excel',
    text: 'Сотрудник загружает актуальный файл, сверяет план и факт, указывает срок годности и размещение.',
    list: ['XLSX и CSV', 'Повторная загрузка без конфликтов', 'Факт, срок и ячейка хранения'],
    image: './assets/real-receiving.png',
  },
  driver: {
    kicker: 'Доставка',
    title: 'Только свои рейсы и нужные данные',
    text: 'Водитель видит заказы на сегодня и завтра, открывает адрес и контакт, а завершённые рейсы находит в истории.',
    list: ['Сегодня, завтра и история', 'Данные доставки из Bitrix24', 'Подтверждение отправки'],
    image: './assets/real-driver-today.png',
  },
  logist: {
    kicker: 'Логистика',
    title: 'Контроль до и после отправки',
    text: 'Логист просматривает заказ, проверяет данные, исправляет доступные поля и меняет назначенного водителя.',
    list: ['Поиск по заказам', 'Контроль данных Bitrix24', 'Управление назначениями'],
    image: './assets/real-logist.png',
  },
  admin: {
    kicker: 'Управление',
    title: 'Пользователи, роли и интеграции',
    text: 'Администратор управляет доступом, привязывает точные имена из таблицы и выбирает Telegram-группы.',
    list: ['Пользователи и роли', 'Привязка водителей', 'Раздельные Telegram-каналы'],
    image: './assets/real-admin-users.png',
  },
};
/** @param {string} s @returns {HTMLElement} */
const q = (s) => {
  const found = document.querySelector(s);
  if (!(found instanceof window.HTMLElement)) throw new Error(`Missing element: ${s}`);
  return found;
};
/** @param {RoleKey} key */
function setRole(key) {
  const r = roles[key];
  if (!r) return;
  q('#roleKicker').textContent = r.kicker;
  q('#roleTitle').textContent = r.title;
  q('#roleText').textContent = r.text;
  q('#roleList').innerHTML = r.list.map((x) => `<li>${x}</li>`).join('');
  const image = /** @type {HTMLImageElement} */ (q('#roleImage'));
  image.classList.add('switching');
  setTimeout(() => {
    image.src = r.image;
    image.classList.remove('switching');
  }, 180);
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
const observer = new window.IntersectionObserver(
  (entries) =>
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add('visible');
    }),
  { threshold: 0.1 }
);
document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
setTimeout(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible')), 1600);
