/* ============================================================
   NEON RIFT — bg.js
   赛博都市天台:离屏预渲染 + 多层视差 + 雨/飞行车/霓虹反射
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;
  const { W, H, GROUND_Y } = G.CFG;
  const U = G.U;

  const TILE_W = 1600;
  const TILE_H = H;

  let farCv = null, midCv = null, nearCv = null;
  let _vig = null, _scan = null;
  let built = false;
  let rng = G.makeRng(0x51f0a3);

  // 动态元素
  let signs = [];       // 闪烁招牌
  let flyers = [];      // 飞行车
  let raindrops = [];
  let puddles = [];     // 地面霓虹光斑
  let particles = [];   // 空气中的浮尘

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /* ---------------- 构建远景 ---------------- */
  function buildFar() {
    const cv = mkCanvas(TILE_W, TILE_H);
    const c = cv.getContext('2d');

    // 天空渐变
    const sky = c.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#05030f');
    sky.addColorStop(0.28, '#0d0620');
    sky.addColorStop(0.52, '#1a0a2e');
    sky.addColorStop(0.74, '#2a0f33');
    sky.addColorStop(1, '#0a0512');
    c.fillStyle = sky;
    c.fillRect(0, 0, TILE_W, TILE_H);

    // 天顶大面积辉光(城市光污染)
    const glow = c.createRadialGradient(TILE_W * 0.62, GROUND_Y * 0.92, 20, TILE_W * 0.62, GROUND_Y * 0.92, 700);
    glow.addColorStop(0, 'rgba(255,62,165,0.20)');
    glow.addColorStop(0.45, 'rgba(120,40,200,0.10)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, TILE_W, TILE_H);

    const glow2 = c.createRadialGradient(TILE_W * 0.18, GROUND_Y * 0.85, 10, TILE_W * 0.18, GROUND_Y * 0.85, 520);
    glow2.addColorStop(0, 'rgba(62,242,255,0.13)');
    glow2.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow2;
    c.fillRect(0, 0, TILE_W, TILE_H);

    // 远景建筑群(两层,越远越暗越蓝)
    for (let layer = 0; layer < 2; layer++) {
      const baseH = layer === 0 ? 300 : 240;
      const alphaBase = layer === 0 ? 1 : 1;
      let x = -60;
      while (x < TILE_W + 60) {
        const w = 40 + rng() * 130;
        const h = baseH * (0.45 + rng() * 0.95);
        const top = GROUND_Y - h;
        const tone = layer === 0 ? 12 + rng() * 8 : 20 + rng() * 12;
        c.fillStyle = 'rgb(' + Math.round(tone * 0.7) + ',' + Math.round(tone * 0.85) + ',' + Math.round(tone * 2.1) + ')';
        c.fillRect(x, top, w, h);

        // 建筑霓虹边缘
        if (rng() < 0.28) {
          const col = rng() < 0.5 ? 'rgba(62,242,255,0.30)' : 'rgba(255,62,165,0.28)';
          c.fillStyle = col;
          c.fillRect(x + w - 2, top, 2, h);
        }
        // 顶部天线
        if (rng() < 0.3) {
          const ah = 20 + rng() * 80;
          c.fillStyle = 'rgba(60,80,120,0.75)';
          c.fillRect(x + w * 0.5, top - ah, 2, ah);
          if (rng() < 0.5) {
            c.fillStyle = 'rgba(255,80,80,0.9)';
            c.beginPath();
            c.arc(x + w * 0.5 + 1, top - ah, 2.2, 0, 6.283);
            c.fill();
          }
        }
        // 窗户
        const cols = Math.floor(w / 11);
        const rows = Math.floor(h / 15);
        for (let cx = 0; cx < cols; cx++) {
          for (let cy = 0; cy < rows; cy++) {
            if (rng() > 0.16) continue;
            const wx = x + 4 + cx * 11;
            const wy = top + 6 + cy * 15;
            if (wy > GROUND_Y - 12) continue;
            const r = rng();
            c.fillStyle =
              r < 0.45 ? 'rgba(255,214,140,0.55)'
                : r < 0.72 ? 'rgba(120,220,255,0.45)'
                  : 'rgba(255,120,200,0.40)';
            c.fillRect(wx, wy, 4, 6);
          }
        }
        x += w + 3 + rng() * 16;
      }
    }
    return cv;
  }

  /* ---------------- 构建中景 ---------------- */
  function buildMid() {
    const cv = mkCanvas(TILE_W, TILE_H);
    const c = cv.getContext('2d');
    signs = [];

    let x = -80;
    while (x < TILE_W + 80) {
      const w = 90 + rng() * 150;
      const h = 150 + rng() * 260;
      const top = GROUND_Y - h + 40;

      // 楼体
      const g = c.createLinearGradient(x, top, x + w, GROUND_Y);
      g.addColorStop(0, '#0a0818');
      g.addColorStop(0.6, '#07050f');
      g.addColorStop(1, '#04030a');
      c.fillStyle = g;
      c.fillRect(x, top, w, h - 30);

      // 楼体边缘霓虹
      const edgeCol = rng() < 0.5 ? '#3ef2ff' : '#ff3ea5';
      c.strokeStyle = G.hexA(edgeCol, 0.35);
      c.lineWidth = 1.6;
      c.strokeRect(x + 0.5, top + 0.5, w - 1, h - 31);

      // 竖向招牌
      if (rng() < 0.55) {
        const sw = 16 + rng() * 10;
        const sh = 60 + rng() * 110;
        const sx2 = x + 8 + rng() * (w - sw - 16);
        const sy2 = top + 20 + rng() * 40;
        const col = rng() < 0.5 ? '#ff3ea5' : '#3ef2ff';
        signs.push({
          x: sx2, y: sy2, w: sw, h: sh, col,
          phase: rng() * 6.283, speed: 0.6 + rng() * 2.4,
          flicker: rng() < 0.35,
          chars: Math.max(2, Math.floor(sh / 26)),
        });
      }
      // 横向招牌
      if (rng() < 0.3 && w > 120) {
        signs.push({
          x: x + 12, y: top + h - 90, w: w - 24, h: 18,
          col: rng() < 0.5 ? '#ffd23e' : '#3ef2ff',
          phase: rng() * 6.283, speed: 0.3 + rng(),
          flicker: rng() < 0.4, horizontal: true,
        });
      }
      // 窗格
      const cols = Math.floor(w / 22);
      const rows = Math.floor(h / 26);
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          if (rng() > 0.13) continue;
          const wx = x + 8 + cx * 22;
          const wy = top + 12 + cy * 26;
          if (wy > GROUND_Y - 40) continue;
          const r = rng();
          c.fillStyle =
            r < 0.5 ? 'rgba(180,230,255,0.30)'
              : r < 0.78 ? 'rgba(255,200,130,0.28)'
                : 'rgba(255,100,180,0.24)';
          c.fillRect(wx, wy, 9, 13);
        }
      }
      // 楼顶设备
      if (rng() < 0.4) {
        c.fillStyle = 'rgba(12,10,24,1)';
        c.fillRect(x + w * 0.3, top - 18, w * 0.4, 18);
      }
      x += w + 10 + rng() * 40;
    }
    return cv;
  }

  /* ---------------- 构建近景(前景栏杆,画在角色之前) ---------------- */
  function buildNear() {
    const cv = mkCanvas(TILE_W, TILE_H);
    const c = cv.getContext('2d');
    // 天台地面
    const gy = GROUND_Y;
    const gg = c.createLinearGradient(0, gy - 10, 0, TILE_H);
    gg.addColorStop(0, '#0c1120');
    gg.addColorStop(0.18, '#080c18');
    gg.addColorStop(1, '#03050b');
    c.fillStyle = gg;
    c.fillRect(0, gy, TILE_W, TILE_H - gy);

    // 地面网格线(赛博感)
    c.strokeStyle = 'rgba(62,242,255,0.055)';
    c.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const yy = gy + 6 + i * i * 1.1;
      if (yy > TILE_H) break;
      c.beginPath();
      c.moveTo(0, yy);
      c.lineTo(TILE_W, yy);
      c.stroke();
    }
    for (let i = -14; i < 32; i++) {
      const bx = i * 90;
      c.beginPath();
      c.moveTo(bx, gy);
      c.lineTo(bx + (bx - TILE_W / 2) * 5.2, TILE_H);
      c.stroke();
    }

    // 地面前缘高光
    c.strokeStyle = 'rgba(140,220,255,0.30)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(0, gy + 0.5);
    c.lineTo(TILE_W, gy + 0.5);
    c.stroke();

    return cv;
  }

  /* ---------------- 初始化 ---------------- */
  function build() {
    farCv = buildFar();
    midCv = buildMid();
    nearCv = buildNear();
    built = true;

    // 雨
    raindrops = [];
    for (let i = 0; i < 96; i++) {
      raindrops.push({
        x: Math.random() * W * 1.4 - W * 0.2,
        y: Math.random() * H,
        len: 12 + Math.random() * 26,
        sp: 9 + Math.random() * 11,
        a: 0.06 + Math.random() * 0.16,
      });
    }
    // 地面霓虹光斑
    puddles = [];
    const cols = ['#3ef2ff', '#ff3ea5', '#a32bff', '#ffd23e'];
    for (let i = 0; i < 22; i++) {
      puddles.push({
        x: -1400 + Math.random() * 2800,
        w: 40 + Math.random() * 130,
        col: cols[(Math.random() * cols.length) | 0],
        a: 0.05 + Math.random() * 0.08,
        ph: Math.random() * 6.28,
      });
    }
    // 飞行车
    flyers = [];
    for (let i = 0; i < 9; i++) {
      flyers.push({
        x: Math.random() * TILE_W,
        y: 60 + Math.random() * 300,
        sp: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1.6),
        w: 6 + Math.random() * 12,
        col: Math.random() < 0.5 ? '#ffd23e' : '#ff5470',
        trail: 20 + Math.random() * 60,
      });
    }
    // 浮尘
    particles = [];
    for (let i = 0; i < 26; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * GROUND_Y,
        r: 0.6 + Math.random() * 1.7,
        sp: 0.1 + Math.random() * 0.5,
        ph: Math.random() * 6.28,
        col: Math.random() < 0.7 ? '#3ef2ff' : '#ff3ea5',
      });
    }
  }

  /* ---------------- 状态 ---------------- */
  let t = 0;
  let scrollFar = 0, scrollMid = 0, scrollNear = 0;

  function tileDraw(ctx, cv, offX, offY, scale) {
    const w = TILE_W * (scale || 1);
    let x = -(((offX % w) + w) % w);
    const y = (offY || 0);
    ctx.drawImage(cv, x, y, w, TILE_H * (scale || 1));
    ctx.drawImage(cv, x + w - 1, y, w, TILE_H * (scale || 1));
    if (x + w * 2 < W + w) return;
  }

  const BG = (G.BG = {
    build,
    get built() { return built; },

    update(dt) {
      t += dt;
      const camX = G.CAM.x;
      scrollFar = camX * 0.10;
      scrollMid = camX * 0.30;
      scrollNear = camX * 1.0;

      for (let i = 0; i < flyers.length; i++) {
        const f = flyers[i];
        f.x += f.sp * dt * 60;
        if (f.x < -80) f.x = TILE_W + 80;
        if (f.x > TILE_W + 80) f.x = -80;
      }
      for (let i = 0; i < raindrops.length; i++) {
        const r = raindrops[i];
        r.y += r.sp * dt * 60;
        r.x -= r.sp * dt * 60 * 0.22;
        if (r.y > H + 30) {
          r.y = -30;
          r.x = Math.random() * W * 1.4 - W * 0.2;
        }
        if (r.x < -60) r.x = W + 60;
      }
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.y -= p.sp * dt * 60 * 0.6;
        p.x += Math.sin(t * 0.6 + p.ph) * 0.25;
        if (p.y < -10) {
          p.y = GROUND_Y + 10;
          p.x = Math.random() * W;
        }
      }
    },

    /* ---- 背景层(角色之前) ---- */
    render(ctx) {
      if (!built) build();

      // 轻量缩放,让 zoom 变化时背景有一点点跟随
      const zs = 0.94 + (G.CAM.zoom - 0.7) * 0.24;
      ctx.save();
      ctx.translate(W / 2, H);
      ctx.scale(zs, zs);
      ctx.translate(-W / 2, -H + (1 - zs) * 0);

      // 远景
      ctx.save();
      ctx.globalAlpha = 1;
      let fx = -(((scrollFar % TILE_W) + TILE_W) % TILE_W);
      ctx.drawImage(farCv, fx, 0);
      ctx.drawImage(farCv, fx + TILE_W - 1, 0);
      ctx.restore();

      // 飞行车(在远景之上)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < flyers.length; i++) {
        const f = flyers[i];
        const px = ((f.x - scrollFar) % TILE_W + TILE_W) % TILE_W;
        const drawX = px - (TILE_W - W) / 2;
        if (drawX < -200 || drawX > W + 200) {
          // 二次贴图
          const dx2 = drawX + TILE_W;
          drawFlyer(ctx, dx2, f);
          continue;
        }
        drawFlyer(ctx, drawX, f);
      }
      ctx.restore();

      // 中景
      let mx = -(((scrollMid % TILE_W) + TILE_W) % TILE_W);
      ctx.drawImage(midCv, mx, 0);
      ctx.drawImage(midCv, mx + TILE_W - 1, 0);

      // 招牌发光(动态)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i];
        // 该招牌在屏幕上的位置(要考虑两张 tile)
        for (let rep = 0; rep < 2; rep++) {
          const px = s.x + mx + rep * TILE_W;
          if (px < -200 || px > W + 200) continue;
          drawSign(ctx, s, px);
        }
      }
      ctx.restore();

      // 雨
      ctx.save();
      ctx.strokeStyle = '#9fd8ff';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (let i = 0; i < raindrops.length; i++) {
        const r = raindrops[i];
        ctx.globalAlpha = r.a;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(r.x - r.len * 0.22, r.y + r.len);
        ctx.stroke();
      }
      ctx.restore();

      ctx.restore(); // zs
    },

    /* ---- 地面 & 前景 ---- */
    renderGround(ctx) {
      const gy = G.CAM.sy(0);

      // 地面填充(用近景 canvas 的地面部分)
      ctx.save();
      const z = G.CAM.zoom;
      ctx.translate(W / 2, gy);
      ctx.scale(z, z);

      // 地面底色渐变
      const gg = ctx.createLinearGradient(0, 0, 0, (H - gy) / z + 40);
      gg.addColorStop(0, '#0c1526');
      gg.addColorStop(0.2, '#070b15');
      gg.addColorStop(1, '#02040a');
      ctx.fillStyle = gg;
      ctx.fillRect(-W / z, 0, (W / z) * 2, (H - gy) / z + 60);

      // 透视网格
      ctx.strokeStyle = 'rgba(62,242,255,0.07)';
      ctx.lineWidth = 1 / z;
      const camX = G.CAM.x;
      for (let i = 0; i < 20; i++) {
        const yy = 10 + i * i * 2.4;
        ctx.beginPath();
        ctx.moveTo(-W / z, yy);
        ctx.lineTo(W / z, yy);
        ctx.stroke();
      }
      const spacing = 120;
      const startX = Math.floor((camX - W / z) / spacing) * spacing;
      for (let gx = startX; gx < camX + W / z; gx += spacing) {
        ctx.beginPath();
        ctx.moveTo(gx - camX, 0);
        ctx.lineTo((gx - camX) * 2.4, (H - gy) / z + 40);
        ctx.stroke();
      }

      // 霓虹倒影光斑
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < puddles.length; i++) {
        const p = puddles[i];
        const px = p.x - camX;
        if (Math.abs(px) > W / z) continue;
        const a = p.a * (0.7 + Math.sin(t * 1.6 + p.ph) * 0.3);
        const g2 = ctx.createLinearGradient(px, 0, px, 90);
        g2.addColorStop(0, G.hexA(p.col, a));
        g2.addColorStop(1, G.hexA(p.col, 0));
        ctx.fillStyle = g2;
        ctx.fillRect(px - p.w / 2, 2, p.w, 90);
      }
      ctx.globalCompositeOperation = 'source-over';

      // 地平线光边
      ctx.strokeStyle = 'rgba(150,230,255,0.22)';
      ctx.lineWidth = 1.6 / z;
      ctx.beginPath();
      ctx.moveTo(-W / z, 0.5);
      ctx.lineTo(W / z, 0.5);
      ctx.stroke();

      ctx.restore();
    },

    /* ---- 最前景(压在所有之上) ---- */
    renderFore(ctx) {
      // 浮尘
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.globalAlpha = 0.25 + Math.sin(t * 2 + p.ph) * 0.18;
        ctx.fillStyle = p.col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();

      // 暗角(缓存,坐标固定)
      if (!_vig) {
        _vig = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.34, W / 2, H * 0.5, H * 0.95);
        _vig.addColorStop(0, 'rgba(0,0,0,0)');
        _vig.addColorStop(1, 'rgba(0,0,0,0.58)');
      }
      ctx.fillStyle = _vig;
      ctx.fillRect(0, 0, W, H);

      // 扫描线(预渲染 pattern,原来每帧 240 次 fillRect)
      if (!_scan) {
        const c = document.createElement('canvas');
        c.width = 4;
        c.height = 3;
        const g2 = c.getContext('2d');
        g2.fillStyle = '#000';
        g2.fillRect(0, 0, 4, 1);
        _scan = ctx.createPattern(c, 'repeat');
      }
      if (_scan) {
        ctx.globalAlpha = 0.035;
        ctx.fillStyle = _scan;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    },
  });

  function drawFlyer(ctx, x, f) {
    const g = ctx.createLinearGradient(x - f.trail, f.y, x, f.y);
    g.addColorStop(0, G.hexA(f.col, 0));
    g.addColorStop(1, G.hexA(f.col, 0.5));
    ctx.fillStyle = g;
    const dir = f.sp > 0 ? 1 : -1;
    ctx.fillRect(x - f.trail * (dir > 0 ? 1 : 0), f.y - 1, f.trail * (dir > 0 ? 1 : -1) || f.trail, 2);
    ctx.fillStyle = f.col;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, f.y, 2 + f.w * 0.12, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawSign(ctx, s, px) {
    const blink = s.flicker
      ? (Math.sin(t * s.speed * 9 + s.phase) > -0.15 ? 1 : 0.15)
      : 0.65 + Math.sin(t * s.speed + s.phase) * 0.35;
    const a = blink * 0.85;
    if (a < 0.05) return;

    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = s.col;
    ctx.shadowColor = s.col;
    ctx.shadowBlur = 22;
    if (s.horizontal) {
      G.roundRect(ctx, px, s.y, s.w, s.h, 3);
      ctx.fill();
      ctx.globalAlpha = a * 0.9;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      // 横排字符块
      for (let i = 0; i < Math.floor(s.w / 14); i++) {
        ctx.fillRect(px + 6 + i * 14, s.y + 5, 6, s.h - 10);
      }
    } else {
      G.roundRect(ctx, px, s.y, s.w, s.h, 3);
      ctx.fill();
      ctx.globalAlpha = a * 0.85;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      const n = s.chars || 3;
      for (let i = 0; i < n; i++) {
        ctx.fillRect(px + 4, s.y + 6 + i * ((s.h - 12) / n), s.w - 8, ((s.h - 12) / n) * 0.55);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
})();
