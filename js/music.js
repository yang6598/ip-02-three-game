/* ============================================================
   NEON RIFT — music.js
   程序化合成波 BGM(WebAudio,与 SFX 共用 AudioContext)
   · 124 BPM,Am-F-C-G 走向
   · 图层:底鼓/军鼓/镲/贝斯/和弦垫/琶音主奏
   · 强度分级:标题 = 半开,战斗 = 全开;超必杀时闪避压低
   · M 键静音
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;

  const BPM = 124;
  const SPB = 60 / BPM;          // 一拍秒数
  const STEP = SPB / 4;          // 16 分音符
  const BAR = SPB * 4;

  // A 小调走向(Am F C G),根音 MIDI
  const PROG = [
    { root: 45, chord: [45, 48, 52] }, // Am
    { root: 41, chord: [41, 45, 48] }, // F
    { root: 36, chord: [36, 40, 43] }, // C
    { root: 43, chord: [43, 47, 50] }, // G
  ];
  const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const Music = (G.Music = {
    started: false,
    muted: false,
    intensity: 0,       // 0 标题 / 1 战斗
    step: 0,
    nextTime: 0,
    timer: null,
    gain: null,
    delay: null,

    init() {
      if (this.gain) return;
      if (!G.SFX) return;
      if (!G.SFX.ctx) {
        G.SFX.init();
        G.SFX.resume();
      }
      if (!G.SFX.ctx) return;
      const c = G.SFX.ctx;
      this.gain = c.createGain();
      this.gain.gain.value = 0.32;
      this.gain.connect(G.SFX.master);
      // 主奏琶音的回声
      this.delay = c.createDelay(0.6);
      this.delay.delayTime.value = STEP * 3;
      const fb = c.createGain();
      fb.gain.value = 0.3;
      const wet = c.createGain();
      wet.gain.value = 0.35;
      this.delay.connect(fb);
      fb.connect(this.delay);
      this.delay.connect(wet);
      wet.connect(this.gain);
      // M 键静音
      const self = this;
      window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyM' && !e.repeat) self.toggle();
      });
    },

    start() {
      this.init();
      if (!this.gain || this.started) return;
      this.started = true;
      this.nextTime = G.SFX.ctx.currentTime + 0.1;
      const self = this;
      this.timer = setInterval(function () { self._sched(); }, 30);
    },

    toggle() {
      if (!this.gain) return;
      this.muted = !this.muted;
      const t = G.SFX.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.linearRampToValueAtTime(this.muted ? 0 : 0.32, t + 0.15);
    },

    /** 0=标题半开 1=战斗全开 */
    setIntensity(x) {
      this.intensity = x;
      this.start();
    },

    /** 超必杀/演出时压低音乐 */
    duck(amount, dur) {
      if (!this.gain || this.muted) return;
      const t = G.SFX.ctx.currentTime;
      const g = this.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.32 * (amount || 0.3), t + 0.06);
      g.linearRampToValueAtTime(0.32, t + (dur || 1.2));
    },

    /* ---------- 调度器:每次把 0.15s 内的音符排进队列 ---------- */
    _sched() {
      const c = G.SFX.ctx;
      while (this.nextTime < c.currentTime + 0.15) {
        this._playStep(this.step, this.nextTime);
        this.step = (this.step + 1) % 64; // 4 小节循环
        this.nextTime += STEP;
      }
    },

    _playStep(s, t) {
      const bar = Math.floor(s / 16);
      const pos = s % 16;              // 一小节 16 步
      const ch = PROG[bar];
      const inten = this.intensity;

      // ---- 底鼓:每拍(0,4,8,12) ----
      if (pos % 4 === 0) this._kick(t, pos === 0 ? 1 : 0.85);
      // ---- 军鼓:第 2/4 拍(战斗层) ----
      if (inten >= 1 && (pos === 4 || pos === 12)) this._snare(t);
      // ---- 镲:8 分反拍(战斗层) + 16 分碎镲(hell 层可再加) ----
      if (inten >= 1 && pos % 2 === 1) this._hat(t, pos % 4 === 3 ? 0.16 : 0.08);

      // ---- 贝斯:16 分律动,根音+八度 ----
      const bassPat = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 7, 0, 12, 0];
      if (pos % 1 === 0) {
        const semi = bassPat[pos];
        if (semi != null) this._bass(t, NOTE(ch.root - 12 + semi), STEP * 0.9);
      }

      // ---- 和弦垫:每小节起音,长音 ----
      if (pos === 0) this._pad(t, ch.chord, BAR * 0.98);

      // ---- 琶音主奏(战斗层):16 分上下行 ----
      if (inten >= 1) {
        const arp = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1];
        const note = ch.chord[arp[pos] % 3] + 12;
        this._arp(t, NOTE(note), STEP * 0.8);
      }
    },

    /* ---------- 乐器 ---------- */
    _kick(t, v) {
      const c = G.SFX.ctx;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
      const g = c.createGain();
      g.gain.setValueAtTime(0.5 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g);
      g.connect(this.gain);
      o.start(t);
      o.stop(t + 0.18);
    },

    _snare(t) {
      const c = G.SFX.ctx;
      const src = c.createBufferSource();
      src.buffer = G.SFX._noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1900;
      f.Q.value = 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      src.connect(f);
      f.connect(g);
      g.connect(this.gain);
      src.start(t);
      src.stop(t + 0.15);
    },

    _hat(t, v) {
      const c = G.SFX.ctx;
      const src = c.createBufferSource();
      src.buffer = G.SFX._noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7500;
      const g = c.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(f);
      f.connect(g);
      g.connect(this.gain);
      src.start(t);
      src.stop(t + 0.05);
    },

    _bass(t, freq, dur) {
      const c = G.SFX.ctx;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(700, t);
      f.frequency.exponentialRampToValueAtTime(220, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(f);
      f.connect(g);
      g.connect(this.gain);
      o.start(t);
      o.stop(t + dur + 0.02);
    },

    _pad(t, chord, dur) {
      const c = G.SFX.ctx;
      chord.forEach((m) => {
        [-6, 5].forEach((det) => {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = NOTE(m) * Math.pow(2, det / 1200);
          const f = c.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.setValueAtTime(500, t);
          f.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.028, t + dur * 0.3);
          g.gain.linearRampToValueAtTime(0.0001, t + dur);
          o.connect(f);
          f.connect(g);
          g.connect(this.gain);
          o.start(t);
          o.stop(t + dur + 0.05);
        });
      });
    },

    _arp(t, freq, dur) {
      const c = G.SFX.ctx;
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(this.gain);
      g.connect(this.delay); // 送回声
      o.start(t);
      o.stop(t + dur + 0.02);
    },
  });

  // 首次交互自动开播(标题界面 = 半强度)
  const kick = function () {
    if (!G.Music.started) G.Music.setIntensity(0);
    window.removeEventListener('keydown', kick);
    window.removeEventListener('pointerdown', kick);
  };
  window.addEventListener('keydown', kick);
  window.addEventListener('pointerdown', kick);
})();
