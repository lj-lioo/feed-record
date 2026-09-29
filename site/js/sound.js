// App 内铃声（WebAudio 合成，无需音频文件）。iOS 需要先有一次用户点击来“解锁”声音。夜里喂奶：音量适中、持续。
let ctx = null, loop = null;
export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch (e) { /* ignore */ }
}
function chime() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  [[784, 0], [988, 0.2], [1175, 0.4], [988, 0.6]].forEach(([f, dt]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + dt + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0 + dt); o.stop(t0 + dt + 0.55);
  });
}
export function startAlarmSound() {
  stopAlarmSound();
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return false;
  chime();
  let n = 0;
  loop = setInterval(() => { chime(); if (++n > 80) stopAlarmSound(); }, 1400);
  if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
  return true;
}
export function stopAlarmSound() { if (loop) clearInterval(loop); loop = null; }
