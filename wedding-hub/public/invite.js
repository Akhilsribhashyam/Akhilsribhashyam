const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let settings = {};

const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.append(e); return e; };

/* ---- content from the server (falls back to the text already in the HTML) ---- */
async function loadSettings() {
  try {
    settings = await (await fetch('/api/settings')).json();
    const short = (full = '') => full.replace(/^([A-Z]\.\s*)+/, '').split(' ')[0];
    const b = short(settings.bride), g = short(settings.groom);
    const city = /([A-Za-z]+)\s*,\s*A\.?P/.exec(settings.venue_address || '')?.[1];
    const map = { ...settings, bride_short: b, groom_short: g, bride_initial: b[0], groom_initial: g[0], venue_city: city };
    for (const el of $$('[data-bind]')) { const v = map[el.dataset.bind]; if (v) el.textContent = v; }
    if (settings.couple) document.title = `Wedding Invitation · ${settings.couple}`;
    // "Friday, 12th February 2027" -> big date block; hide the block if the text has another shape
    const m = /^\s*([A-Za-z]+)[,\s]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/.exec(settings.date || '');
    if (m) { $('#db-dow').textContent = m[1]; $('#db-day').textContent = m[2]; $('#db-my').textContent = `${m[3]} ${m[4]}`; }
    else if (settings.date) { $('#dateblock').hidden = true; $('.hero .sr').className = 'time'; }
  } catch { /* keep static text */ }
  const dir = settings.maps_url || 'https://www.google.com/maps/search/?api=1&query=Sri+Sai+Balaji+Function+Hall+Vizianagaram';
  for (const a of $$('.js-dir')) a.href = dir;
}

/* ---- ornaments ---- */
function mandala() {
  const svg = svgEl('svg', { viewBox: '-100 -100 200 200' });
  const g = svgEl('g', { fill: 'none', stroke: '#d6ad5c', 'stroke-width': '.7' }, svg);
  for (const r of [97, 80, 54, 31, 12]) svgEl('circle', { r }, g);
  for (let i = 0; i < 32; i++) svgEl('path', { d: 'M0 -80 C 5 -86, 5 -92, 0 -97 C -5 -92, -5 -86, 0 -80 Z', transform: `rotate(${i * 11.25})` }, g);
  for (let i = 0; i < 16; i++) svgEl('path', { d: 'M0 -54 C 11 -63, 11 -74, 0 -80 C -11 -74, -11 -63, 0 -54 Z', transform: `rotate(${i * 22.5})` }, g);
  for (let i = 0; i < 16; i++) svgEl('circle', { cx: 0, cy: -42.5, r: 2.2, transform: `rotate(${i * 22.5 + 11.25})` }, g);
  for (let i = 0; i < 8; i++) svgEl('path', { d: 'M0 -12 C 9 -20, 9 -27, 0 -31 C -9 -27, -9 -20, 0 -12 Z', transform: `rotate(${i * 45})` }, g);
  return svg;
}
for (const host of $$('[data-mandala]')) host.append(mandala());

/* A toran: the garland of marigolds and mango leaves hung over a doorway for auspicious occasions. */
function toran() {
  const W = 390, n = 9, step = W / n;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} 58`, preserveAspectRatio: 'xMidYMin slice' });
  const g = svgEl('g', { fill: 'none', stroke: '#d6ad5c', 'stroke-width': '1', 'stroke-linecap': 'round' }, svg);
  svgEl('path', { d: `M0 3 H${W}` }, g);
  for (let i = 0; i < n; i++) {
    const x0 = i * step, x1 = x0 + step, mid = x0 + step / 2;
    svgEl('path', { d: `M${x0} 3 Q ${mid} 30 ${x1} 3` }, g);                                      // swag
    svgEl('path', { d: `M${mid} 17 C ${mid + 7} 26, ${mid + 6} 40, ${mid} 50 C ${mid - 6} 40, ${mid - 7} 26, ${mid} 17 Z`, fill: '#d6ad5c22' }, g); // mango leaf
    svgEl('path', { d: `M${mid} 20 V46`, 'stroke-width': '.6' }, g);
    svgEl('circle', { cx: x0, cy: 5, r: 3.4, fill: '#d6ad5c' }, g);                               // marigold
    for (const t of [0.25, 0.75]) { const x = x0 + step * t, y = 3 + 2 * 13.5 * t * (1 - t) * 2; svgEl('circle', { cx: x, cy: y, r: 1.7, fill: '#d6ad5c' }, g); }
  }
  svgEl('circle', { cx: W, cy: 5, r: 3.4, fill: '#d6ad5c' }, g);
  return svg;
}
for (const host of $$('[data-toran]')) host.append(toran());

/* ---- gold dust ---- */
if (!reduced) {
  const box = $('#dust');
  for (let i = 0; i < 26; i++) {
    const d = document.createElement('i');
    d.style.left = Math.random() * 100 + '%';
    d.style.top = Math.random() * 100 + '%';
    d.style.animationDuration = 3.5 + Math.random() * 5 + 's';
    d.style.animationDelay = -Math.random() * 8 + 's';
    const s = 0.5 + Math.random() * 1.1; d.style.width = d.style.height = 3 * s + 'px';
    box.append(d);
  }
}

/* ---- countdown ---- */
function tick() {
  const t = Date.parse(settings.event_start || '2027-02-13T00:15:00+05:30');
  const box = $('#count');
  if (Number.isNaN(t)) { box.hidden = true; return; }
  const ms = t - Date.now();
  if (ms <= 0) { box.classList.add('done'); box.textContent = Date.now() < t + 5400000 ? 'The wedding is happening now' : 'Thank you for celebrating with us'; return; }
  const s = Math.floor(ms / 1000), set = (id, v) => { const el = $(id); if (el.textContent !== v) el.textContent = v; };
  set('#cd-d', String(Math.floor(s / 86400)));
  set('#cd-h', String(Math.floor(s % 86400 / 3600)).padStart(2, '0'));
  set('#cd-m', String(Math.floor(s % 3600 / 60)).padStart(2, '0'));
  set('#cd-s', String(s % 60).padStart(2, '0'));
}

/* ---- open the doors ---- */
function open() {
  const gate = $('#gate'), main = $('#main'), dock = $('#dock');
  if (gate.classList.contains('go')) return;
  main.hidden = false; dock.hidden = false;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => { gate.classList.add('go'); main.classList.add('on'); });
  document.body.classList.remove('locked');
  setTimeout(() => { gate.hidden = true; }, reduced ? 0 : 1700);
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));
  // the quick-action dock appears once the guest scrolls past the first screen
  const onScroll = () => dock.classList.toggle('show', window.scrollY > window.innerHeight * 0.55);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  navigator.vibrate?.(12);
}
$('#open').addEventListener('click', open);

/* ---- share ---- */
$('#share').addEventListener('click', async () => {
  const text = `You are invited to the wedding of ${settings.couple || 'Bhuvaneswari & Akhil'}: ${settings.date || ''}, ${settings.venue || ''}.`;
  const url = location.origin + '/';
  if (navigator.share) { try { await navigator.share({ title: 'Wedding Invitation', text, url }); } catch { /* cancelled */ } return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(`${text} ${url}`), '_blank', 'noopener');
});

await loadSettings();
tick(); setInterval(tick, 1000);
