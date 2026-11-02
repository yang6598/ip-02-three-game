/* ============================================================
   NEON RIFT — core.js
   引擎骨架:数学 / 输入缓冲 / 指令识别 / 相机 / 音效 / 主循环
   ============================================================ */
(function () {
  'use strict';

  const G = (window.G = window.G || {});

  /* ---------------- 全局配置 ---------------- */
  G.CFG = {
    W: 1280,          // 逻辑分辨率
    H: 720,
    GROUND_Y: 560,    // 屏幕空间地面线
    STEP: 1 / 60,     // 固定逻辑步长
    GRAVITY: 0.92,    // 世界单位 / 帧²
    MAX_ZOOM: 1.0,
    MIN_ZOOM: 0.70,
    STAGE_HALF: 1250, // 舞台半宽
    INPUT_WINDOW: 20, // 指令识别回溯帧数(放宽:KOF 手感,搓招不再要求精准)
  };

  /* ---------------- 数学工具 ---------------- */
  const U = (G.U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    lerpD: (a, b, t, dt) => a + (b - a) * (1 - Math.pow(1 - t, dt * 60)),
    sign: (v) => (v < 0 ? -1 : v > 0 ? 1 : 0),
    approach: (v, target, step) => {
      if (v < target) return Math.min(v + step, target);
      if (v > target) return Math.max(v - step, target);
      return target;
    },
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    easeIn: (t) => t * t * t,
    easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeOutBack: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
    // 矩形重叠(AABB),rect = {x, y, w, h},x/y 为左下角
    overlap: (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
    // 角度插值(处理跨越)
    lerpAngle: (a, b, t) => {
      let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      return a + d * t;
    },
    pointInRect: (px, py, r) =>
      px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
  });

  /* ---------------- 确定性随机(用于背景/粒子,不影响战斗判定) ---------------- */
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  G.makeRng = makeRng;
  G.rng = makeRng(0x9e3779b9);

  /* ---------------- 输入系统 ---------------- */
  const KEYMAP = {
    p1: {
      up: ['KeyW'],
      down: ['KeyS'],
      left: ['KeyA'],
      right: ['KeyD'],
      lp: ['KeyJ'],
      hp: ['KeyK'],
      lk: ['KeyU'],
      hk: ['KeyI'],
      sp: ['KeyO'],
      ex: ['KeyL'],
      su: ['KeyP'],
    },
    p2: {
      up: ['ArrowUp'],
      down: ['ArrowDown'],
      left: ['ArrowLeft'],
      right: ['ArrowRight'],
      lp: ['Numpad1', 'KeyB'],
      hp: ['Numpad2', 'KeyN'],
      lk: ['Numpad4', 'KeyM'],
      hk: ['Numpad5', 'Comma'],
      sp: ['Numpad7', 'Period'],
      ex: ['Numpad9', 'Semicolon'],
      su: ['Numpad8', 'Slash'],
    },
  };

  const BTN = ['lp', 'hp', 'lk', 'hk', 'sp', 'ex', 'su'];

  class Pad {
    constructor(which) {
      this.which = which;
      this.map = KEYMAP[which];
      this.raw = {}; // 物理按键状态
      this.held = {}; // 逻辑按钮按住
      this.pressed = {}; // 逻辑按钮本帧刚按下
      this.released = {};
      BTN.forEach((b) => {
        this.held[b] = false;
        this.pressed[b] = false;
        this.released[b] = false;
      });
      // 方向历史,存数字键盘记法 1-9(不含 5)
      this.dirHist = [];
      this.dir = 5;
      this.prevDir = 5;
      this.buf = []; // 输入缓冲:{b, frame}
      this.frame = 0;
      this.enabled = true;
    }

    _isDown(action) {
      const codes = this.map[action];
      for (let i = 0; i < codes.length; i++) if (this.raw[codes[i]]) return true;
      return false;
    }

    setKey(code, down) {
      this.raw[code] = down;
    }

    // 每逻辑帧调用
    poll() {
      if (!this.enabled) {
        BTN.forEach((b) => {
          this.pressed[b] = false;
          this.released[b] = false;
          this.held[b] = false;
        });
        this.prevDir = this.dir;
        this.dir = 5;
        this.dirHist.push(5);
        if (this.dirHist.length > 40) this.dirHist.shift();
        return;
      }

      // 方向 → 数字键盘记法
      let h = 0;
      if (this._isDown('left')) h -= 1;
      if (this._isDown('right')) h += 1;
      let v = 0;
      if (this._isDown('down')) v -= 1;
      if (this._isDown('up')) v += 1;
      this.prevDir = this.dir;
      // 1-9 布局:7 8 9 / 4 5 6 / 1 2 3
      const num = 5 + h + v * 3;
      this.dir = num;

      this.dirHist.push(num);
      if (this.dirHist.length > 40) this.dirHist.shift();

      // 按钮边缘检测
      for (let i = 0; i < BTN.length; i++) {
        const b = BTN[i],
          now = this._isDown(b);
        this.pressed[b] = now && !this.held[b];
        this.released[b] = !now && this.held[b];
        this.held[b] = now;
        if (this.pressed[b]) this.buf.push({ b, frame: this.frame });
      }
      // 缓冲清理(保留 20 帧)
      while (this.buf.length && this.frame - this.buf[0].frame > 20) this.buf.shift();
      this.frame++;
    }

    // 该按钮是否在最近 n 帧内按下过
    recent(b, n) {
      for (let i = this.buf.length - 1; i >= 0; i--) {
        const e = this.buf[i];
        if (this.frame - e.frame > n) break;
        if (e.b === b) return true;
      }
      return false;
    }

    consume(b) {
      const idx = this.buf.findIndex((e) => e.b === b);
      if (idx >= 0) this.buf.splice(idx, 1);
    }

    /**
     * 指令匹配:从最近帧向前回溯,按 pattern 倒序匹配方向序列
     * pattern 例:[2,3,6] 表示 236
     * 返回消耗的帧数,不匹配返回 -1
     */
    motion(pattern, win) {
      win = win || G.CFG.INPUT_WINDOW;
      const h = this.dirHist;
      let pi = pattern.length - 1;
      let i = h.length - 1;
      let start = -1;
      const stop = Math.max(0, h.length - win);
      while (i >= stop) {
        if (h[i] === pattern[pi]) {
          if (start === -1) start = i;
          pi--;
          if (pi < 0) return h.length - start;
          // 跳过同方向的连续帧
          while (i - 1 >= stop && h[i - 1] === h[i]) i--;
        }
        i--;
      }
      return -1;
    }

    /**
     * 冲刺双击检测:两次按下同方向,且中间只允许「中性」帧。
     * 这样 4,2,4(搓招中间夹了下方向)不会误触发后冲刺 —— 拳皇规则。
     */
    dashTap(dirNum, win) {
      win = win || 15;
      const h = this.dirHist;
      const stop = Math.max(0, h.length - win);
      let i = h.length - 1;
      // 当前帧必须正按着该方向(第二次按下)
      if (h[i] !== dirNum) return false;
      let sawNeutral = false;
      i--;
      while (i >= stop) {
        const d = h[i];
        if (d === dirNum) return sawNeutral; // 第二次按下:中间只隔过中性才算
        if (d === 5) {
          sawNeutral = true;
        } else {
          return false; // 中间夹了别的方向 → 是搓招不是冲刺
        }
        i--;
      }
      return false;
    }

    // 最近是否出现过某个方向(用于 2 次按下类指令)
    motionRepeat(dirNum, times, win) {
      win = win || G.CFG.INPUT_WINDOW + 6;
      const h = this.dirHist;
      const stop = Math.max(0, h.length - win);
      let count = 0;
      let prev = -1;
      for (let i = h.length - 1; i >= stop; i--) {
        if (h[i] === dirNum && prev !== dirNum) count++;
        prev = h[i];
      }
      return count >= times;
    }

    reset() {
      BTN.forEach((b) => {
        this.held[b] = false;
        this.pressed[b] = false;
        this.released[b] = false;
      });
      this.dirHist.length = 0;
      this.buf.length = 0;
    }
  }

  G.Pad = Pad;
  G.BTN = BTN;

  const pads = (G.pads = { p1: new Pad('p1'), p2: new Pad('p2') });

  window.addEventListener('keydown', (e) => {
    // 阻止方向键滚动 / 空格滚动
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
        'Tab',
      ].includes(e.code)
    ) {
      e.preventDefault();
    }
    pads.p1.setKey(e.code, true);
    pads.p2.setKey(e.code, true);
    if (G.onKey) G.onKey(e.code, e);
  });

  window.addEventListener('keyup', (e) => {
    pads.p1.setKey(e.code, false);
    pads.p2.setKey(e.code, false);
  });

  window.addEventListener('blur', () => {
    pads.p1.raw = {};
    pads.p2.raw = {};
  });

  /* ---------------- 相机 ---------------- */
  const CAM = (G.CAM = {
    x: 0,
    y: 0,
    zoom: 1,
    tx: 0,
    tzoom: 1,
    shakeX: 0,
    shakeY: 0,
    shakeAmt: 0,
    shakeT: 0,
    baseY: 0,

    update(dt) {
      const k = 1 - Math.pow(0.001, dt);
      this.x = U.lerp(this.x, this.tx, k * 0.9);
      this.zoom = U.lerp(this.zoom, this.tzoom, k * 0.7);
      // 震动衰减
      if (this.shakeAmt > 0.2) {
        this.shakeAmt *= Math.pow(0.82, dt * 60);
        this.shakeT += dt * 60;
        const a = this.shakeAmt;
        this.shakeX = Math.sin(this.shakeT * 2.1) * a * 0.7 + (G.rng() - 0.5) * a;
        this.shakeY = Math.cos(this.shakeT * 2.7) * a * 0.55 + (G.rng() - 0.5) * a;
      } else {
        this.shakeAmt = 0;
        this.shakeX = 0;
        this.shakeY = 0;
      }
    },

    shake(amount) {
      this.shakeAmt = Math.max(this.shakeAmt, amount);
    },

    // 世界 → 屏幕
    sx(wx) {
      return G.CFG.W / 2 + (wx - this.x) * this.zoom + this.shakeX;
    },
    sy(wy) {
      return G.CFG.GROUND_Y - (wy - this.y) * this.zoom + this.shakeY;
    },
    scale(v) {
      return v * this.zoom;
    },
  });

  /* ---------------- 音效(WebAudio 程序化) ---------------- */
  const SFX = (G.SFX = {
    ctx: null,
    master: null,
    enabled: true,
    _noiseBuf: null,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      // 预生成噪声
      const len = this.ctx.sampleRate * 0.6;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    _noise(dur, freq, q, gain, type) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this._noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type || 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start();
      src.stop(c.currentTime + dur);
    },

    _tone(freq, dur, type, gain, slideTo) {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g);
      g.connect(this.master);
      o.start();
      o.stop(c.currentTime + dur);
    },

    play(name, vol) {
      if (!this.enabled || !this.ctx) return;
      vol = vol == null ? 1 : vol;
      try {
        switch (name) {
          case 'whiff_light':
            this._noise(0.11, 1900, 1.6, 0.1 * vol, 'bandpass');
            break;
          case 'whiff_heavy':
            this._noise(0.2, 900, 1.1, 0.18 * vol, 'bandpass');
            break;
          case 'hit_light':
            this._noise(0.09, 2600, 0.9, 0.32 * vol, 'bandpass');
            this._tone(180, 0.08, 'square', 0.09 * vol, 90);
            break;
          case 'hit_heavy':
            this._noise(0.18, 700, 0.7, 0.42 * vol, 'lowpass');
            this._tone(110, 0.18, 'sawtooth', 0.16 * vol, 44);
            break;
          case 'block':
            this._noise(0.09, 3600, 3.2, 0.16 * vol, 'bandpass');
            this._tone(760, 0.06, 'square', 0.06 * vol, 620);
            break;
          case 'jump':
            this._tone(320, 0.1, 'sine', 0.1 * vol, 620);
            break;
          case 'land':
            this._noise(0.13, 220, 0.6, 0.2 * vol, 'lowpass');
            break;
          case 'dash':
            this._noise(0.16, 1500, 0.8, 0.14 * vol, 'bandpass');
            break;
          case 'special':
            this._tone(220, 0.3, 'sawtooth', 0.1 * vol, 880);
            this._noise(0.3, 2200, 1.4, 0.12 * vol, 'bandpass');
            break;
          case 'super':
            this._tone(80, 0.9, 'sawtooth', 0.2 * vol, 1200);
            this._tone(160, 0.9, 'square', 0.08 * vol, 900);
            this._noise(0.9, 800, 0.8, 0.16 * vol, 'lowpass');
            break;
          case 'ko':
            this._tone(200, 1.4, 'sawtooth', 0.24 * vol, 36);
            this._noise(1.2, 400, 0.5, 0.24 * vol, 'lowpass');
            break;
          case 'ui_move':
            this._tone(880, 0.045, 'square', 0.045 * vol, 1100);
            break;
          case 'ui_ok':
            this._tone(660, 0.07, 'square', 0.07 * vol);
            setTimeout(() => this._tone(990, 0.1, 'square', 0.06 * vol), 55);
            break;
          case 'ui_back':
            this._tone(500, 0.08, 'square', 0.06 * vol, 330);
            break;
          case 'meter':
            this._tone(1200, 0.14, 'sine', 0.07 * vol, 1700);
            break;
          case 'round':
            this._tone(440, 0.16, 'square', 0.1 * vol);
            setTimeout(() => this._tone(660, 0.24, 'square', 0.1 * vol), 150);
            break;
          case 'fight':
            this._tone(330, 0.1, 'sawtooth', 0.14 * vol, 660);
            setTimeout(() => this._tone(660, 0.28, 'sawtooth', 0.14 * vol, 990), 100);
            break;
        }
      } catch (e) {
        /* 静默失败 */
      }
    },
  });

  /* ---------------- 主循环 ---------------- */
  const Loop = (G.Loop = {
    acc: 0,
    last: 0,
    fps: 60,
    _fpsAcc: 0,
    _fpsCount: 0,
    fixed: null,
    render: null,
    running: false,

    start(fixed, render) {
      this.fixed = fixed;
      this.render = render;
      this.last = performance.now();
      this.running = true;
      requestAnimationFrame(this._frame.bind(this));
    },

    stop() {
      this.running = false;
    },

    _frame(now) {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25; // 切标签页回来不要瞬移

      // FPS 统计 + 自动降档(连续掉帧就把后备分辨率往下调,保帧率)
      this._fpsAcc += dt;
      this._fpsCount++;
      if (this._fpsAcc >= 0.5) {
        this.fps = Math.round(this._fpsCount / this._fpsAcc);
        this._fpsAcc = 0;
        this._fpsCount = 0;
        this._qTick = (this._qTick || 0) + 1;
        if (this._qTick >= 4) {
          if (this.fps < 48 && G._backMax > 1.0) {
            G._backMax = Math.max(1.0, Math.round((G._backMax - 0.12) * 100) / 100);
            if (G._resizeCanvas) G._resizeCanvas();
            this._qTick = 0;
          } else if (this.fps > 58) {
            this._qTick = 0;
          }
        }
      }

      this.acc += dt;
      let guard = 0;
      while (this.acc >= G.CFG.STEP && guard < 5) {
        this.fixed(G.CFG.STEP);
        this.acc -= G.CFG.STEP;
        guard++;
      }
      if (guard >= 5) this.acc = 0;

      this.render(this.acc / G.CFG.STEP);
      requestAnimationFrame(this._frame.bind(this));
    },
  });

  /* ---------------- 画布 & 缩放 ---------------- */
  G.setupCanvas = function (canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const CFG = G.CFG;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const wrap = canvas.parentElement;
      const availW = wrap.clientWidth;
      const availH = wrap.clientHeight;
      const scale = Math.min(availW / CFG.W, availH / CFG.H);
      const cssW = Math.floor(CFG.W * scale);
      const cssH = Math.floor(CFG.H * scale);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      // 内部缓冲:逻辑分辨率 × 缩放后的实际像素密度,上限控制
      if (G._backMax == null) G._backMax = 1.3;
      const back = Math.min(scale * dpr, G._backMax);
      canvas.width = Math.round(CFG.W * back);
      canvas.height = Math.round(CFG.H * back);
      ctx.setTransform(back, 0, 0, back, 0, 0);
      ctx.imageSmoothingEnabled = true;
      G._backScale = back;
    }
    resize();
    window.addEventListener('resize', resize);
    G._resizeCanvas = resize;
    return ctx;
  };

  /* ---------------- 便捷绘图 ---------------- */
  G.roundRect = function (ctx, x, y, w, h, r) {
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // 胶囊(两圆 + 矩形),用于肢体
  G.capsule = function (ctx, x1, y1, x2, y2, r) {
    const dx = x2 - x1,
      dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 0.001;
    const nx = (-dy / len) * r,
      ny = (dx / len) * r;
    ctx.beginPath();
    ctx.arc(x1, y1, r, Math.atan2(dy, dx) + Math.PI / 2, Math.atan2(dy, dx) - Math.PI / 2);
    ctx.lineTo(x2 + nx, y2 + ny);
    ctx.arc(x2, y2, r, Math.atan2(dy, dx) - Math.PI / 2, Math.atan2(dy, dx) + Math.PI / 2);
    ctx.closePath();
  };

  // 发光描边
  G.glowStroke = function (ctx, color, blur, width) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
  };
})();
