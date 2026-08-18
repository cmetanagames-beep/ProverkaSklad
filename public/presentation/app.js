const slides = [...document.querySelectorAll('.slide')];
const progress = document.querySelector('#progress');
const counter = document.querySelector('#counter');
let index = 0,
  touchStart = 0,
  locked = false;

function show(next) {
  if (locked || next === index || next < 0 || next >= slides.length) return;
  locked = true;
  const previous = slides[index];
  previous.classList.add('leaving');
  previous.classList.remove('active');
  index = next;
  slides[index].classList.add('active');
  progress.style.width = `${((index + 1) / slides.length) * 100}%`;
  counter.textContent = `${index + 1} / ${slides.length}`;
  window.history.replaceState(null, '', `#${index + 1}`);
  setTimeout(() => {
    previous.classList.remove('leaving');
    locked = false;
  }, 760);
}
function forward() {
  show(Math.min(index + 1, slides.length - 1));
}
function back() {
  show(Math.max(index - 1, 0));
}
document.querySelector('#next').onclick = forward;
document.querySelector('#prev').onclick = back;
document.querySelector('#fullscreen').onclick = () =>
  document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
addEventListener('keydown', (event) => {
  if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
    event.preventDefault();
    forward();
  }
  if (['ArrowLeft', 'PageUp'].includes(event.key)) {
    event.preventDefault();
    back();
  }
  if (event.key === 'Home') show(0);
  if (event.key === 'End') show(slides.length - 1);
});
addEventListener(
  'wheel',
  (event) => {
    if (Math.abs(event.deltaY) < 20) return;
    event.deltaY > 0 ? forward() : back();
  },
  { passive: true }
);
addEventListener('touchstart', (event) => (touchStart = event.touches[0].clientX), { passive: true });
addEventListener(
  'touchend',
  (event) => {
    const delta = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 45) (delta < 0 ? forward : back)();
  },
  { passive: true }
);
const requested = Number(location.hash.slice(1)) - 1;
if (Number.isInteger(requested) && requested >= 0 && requested < slides.length) {
  slides[0].classList.remove('active');
  index = requested;
  slides[index].classList.add('active');
}
progress.style.width = `${((index + 1) / slides.length) * 100}%`;
counter.textContent = `${index + 1} / ${slides.length}`;
