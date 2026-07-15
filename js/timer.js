/* Rest timer: circular countdown ring. Time is computed from an absolute end
   timestamp, so it stays correct even if the phone screen sleeps mid-rest.
   Vibrates and beeps when the rest is over. */

class RestTimer {
  /**
   * @param {HTMLElement} ringEl  svg circle with class .timer-progress
   * @param {HTMLElement} labelEl element showing remaining seconds
   * @param {Function} onDone     called once when the countdown finishes
   */
  constructor(ringEl, labelEl, onDone) {
    this.ring = ringEl;
    this.label = labelEl;
    this.onDone = onDone;
    this.circumference = 2 * Math.PI * Number(ringEl.getAttribute('r'));
    this.ring.style.strokeDasharray = String(this.circumference);
    this.interval = null;
  }

  start(seconds) {
    this.stop();
    this.total = Math.max(1, seconds);
    this.endsAt = Date.now() + this.total * 1000;
    this.finished = false;
    this.tick();
    this.interval = setInterval(() => this.tick(), 250);
  }

  addSeconds(extra) {
    if (this.finished) return;
    this.endsAt += extra * 1000;
    this.total += extra;
    this.tick();
  }

  remaining() {
    return Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
  }

  tick() {
    const left = this.remaining();
    this.label.textContent = left >= 60
      ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
      : String(left);
    const fraction = Math.max(0, (this.endsAt - Date.now()) / (this.total * 1000));
    this.ring.style.strokeDashoffset = String(this.circumference * (1 - fraction));
    if (left <= 0 && !this.finished) {
      this.finished = true;
      this.stop();
      this.notify();
      this.onDone();
    }
  }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  notify() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const beep = (t, freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain).connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.35);
      };
      beep(0, 880);
      beep(0.4, 1100);
    } catch (_) { /* sound is best-effort */ }
  }
}

/* Keeps the phone screen awake while training (where supported). */
const WakeLock = {
  sentinel: null,
  async on() {
    try {
      if ('wakeLock' in navigator && !this.sentinel) {
        this.sentinel = await navigator.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => (this.sentinel = null));
      }
    } catch (_) { /* not critical */ }
  },
  off() {
    if (this.sentinel) { this.sentinel.release(); this.sentinel = null; }
  },
};

document.addEventListener('visibilitychange', () => {
  // Re-acquire the wake lock when returning to the app mid-workout.
  if (document.visibilityState === 'visible' && document.body.dataset.screen === 'player') {
    WakeLock.on();
  }
});
