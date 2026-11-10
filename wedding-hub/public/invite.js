const $ = (s, r = document) => r.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let settings = {};

/* ---- content from the server (falls back to the text already in the HTML) ---- */
async function loadSettings() {
  try {
    settings = await (await fetch('/api/settings')).json();
    const short = (full) => full.replace(/^[A-Z]\.\s*/, '').split(' ')[0];
    const map = { ...settings, bride_short: short(settings.bride || ''), groom_short: short(settings.groom || '') };
    for (const el of document.querySelectorAll('[data-bind]')) {
      const v = map[el.dataset.bind];
      if (v) el.textContent = v;
    }
    if (settings.couple) document.title = `Wedding Invitation · ${settings.couple}`;
  } catch { /* keep static text */ }
  $('#dir').href = settings.maps_url || 'https://www.google.com/maps/search/?api=1&query=Sri+Sai+Balaji+Function+Hall+Vizianagaram';
}

/* ---- mandala drawn once, reused ---- */
function mandala() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  const add = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.append(e); return e; };
  const g = add('g', { fill: 'none', stroke: '#d9b25f', 'stroke-width': '.8' });
  for (const r of [96, 78, 52, 30, 12]) add('circle', { r }, g);
  for (let i = 0; i < 24; i++) add('ellipse', { cx: 0, cy: -87, rx: 4, ry: 9, transform: `rotate(${i * 15})` }, g);
  for (let i = 0; i < 16; i++) add('path', { d: 'M0 -52 C 10 -62, 10 -74, 0 -80 C -10 -74, -10 -62, 0 -52 Z', transform: `rotate(${i * 22.5})` }, g);
  for (let i = 0; i < 8; i++) add('path', { d: 'M0 -12 C 8 -20, 8 -28, 0 -32 C -8 -28, -8 -20, 0 -12 Z', transform: `rotate(${i * 45})` }, g);
  return svg;
}
for (const host of document.querySelectorAll('[data-mandala]')) host.append(mandala());

/* ---- falling petals ---- */
if (!reduced) {
  const box = $('#petals');
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('i'); p.className = 'petal';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = 9 + Math.random() * 9 + 's';
    p.style.animationDelay = -Math.random() * 14 + 's';
    p.style.transform = `scale(${0.6 + Math.random() * 0.9})`;
    box.append(p);
  }
}

/* ---- countdown ---- */
function tick() {
  const t = Date.parse(settings.event_start || '2027-02-13T00:15:00+05:30');
  let ms = t - Date.now();
  const box = $('#count');
  if (Number.isNaN(t)) { box.hidden = true; return; }
  if (ms <= 0) { box.textContent = Date.now() < t + 5400000 ? '💍 The wedding is happening now!' : '🎉 Thank you for celebrating with us'; return; }
  const s = Math.floor(ms / 1000);
  $('#cd-d').textContent = Math.floor(s / 86400);
  $('#cd-h').textContent = String(Math.floor(s % 86400 / 3600)).padStart(2, '0');
  $('#cd-m').textContent = String(Math.floor(s % 3600 / 60)).padStart(2, '0');
  $('#cd-s').textContent = String(s % 60).padStart(2, '0');
}

/* ---- open the invitation ---- */
$('#open').addEventListener('click', () => {
  $('#gate').classList.add('go');
  $('#main').hidden = false;
  document.body.classList.remove('locked');
  setTimeout(() => { $('#gate').hidden = true; }, reduced ? 0 : 900);
  observer();
  window.scrollTo(0, 0);
});

function observer() {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

/* ---- share ---- */
$('#share').addEventListener('click', async () => {
  const text = `You are invited to the wedding of ${settings.couple || 'Bhuvaneswari & Akhil'}: ${settings.date || ''}, ${settings.venue || ''}.`;
  const url = location.origin + '/';
  if (navigator.share) { try { await navigator.share({ title: 'Wedding Invitation', text, url }); return; } catch { return; } }
  window.open('https://wa.me/?text=' + encodeURIComponent(`${text} ${url}`), '_blank', 'noopener');
});

await loadSettings();
tick(); setInterval(tick, 1000);
