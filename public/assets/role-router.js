(() => {
  const route = user => {
    if (user?.role === 'driver' && location.pathname !== '/driver/') location.replace('/driver/');
    if (user?.role === 'logist' && location.pathname !== '/logist/') location.replace('/logist/');
  };
  fetch('/api/session', { cache: 'no-store' }).then(async response => { if (response.ok) route((await response.json()).user); }).catch(() => {});
  addEventListener('submit', event => {
    if (event.target?.id !== 'loginForm') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const error = document.querySelector('#authError');
    fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: document.querySelector('#login').value, pin: document.querySelector('#pin').value }) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(); if (['driver','logist'].includes(data.user.role)) route(data.user); else location.reload(); })
      .catch(() => { if (error) error.textContent = 'Неверный логин или PIN-код'; });
  }, true);
})();
