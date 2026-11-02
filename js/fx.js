/* ============================================================
   NEON RIFT — fx.js
   粒子池 / 命中特效 / 残影 / 屏幕效果
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;
  const { clamp, lerp } = G.U;
  const CAM = G.CAM;

  const MAX_P = 300;
  const pool = [];
  for (let i = 0; i < MAX_P; i++) {
    pool.push({
      alive: false, type: '', x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1, size: 0, size2: 0, color: '', color2: '',
      rot: 0, vr: 0, grav: 0, drag: 1, alpha: 1, width: 0, txt: '', seed: 0,
    });
  }
  let cursor = 0;

  function take() {
    for (let i = 0; i < MAX_P; i++) {
      const idx = (cursor + i) % MAX_P;
      if (!pool[idx].alive) {
        cursor = (idx + 1) % MAX_P;
        return pool[idx];
      }
    }
    // 全满:复用最老的
    const p = pool[cursor];
    cursor = (cursor + 1) % MAX_P;
    return p;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  /* 渐变缓存:按 (颜色 + 尺寸桶 + 透明度桶) 复用,坐标以原点为中心 */
  const gradCache = new Map();
  function radialGrad(ctx, key, r, c0, c1) {
    let g = gradCache.get(key);
    if (!g) {
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, c0);
      g.addColorStop(0.35, c1);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      if (gradCache.size > 220) gradCache.clear();
      gradCache.set(key, g);
    }
    return g;
  }
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ---------------- 屏幕级效果 ---------------- */
  const Screen = {
    flashColor: '#ffffff',
    flash: 0,
    flashDecay: 0.14,
    chroma: 0,
    vor: {},
  };

  /* ---------------- 残影 ---------------- */
  // 每个 fighter 一条轨迹:{pose, x, y, facing, alpha}
  function makeTrail() {
    return { list: [] };
  }

  /* ============================================================
     对外 API
     ============================================================ */
  const FX = (G.FX = {
    Screen,

    reset() {
      for (let i = 0; i < MAX_P; i++) pool[i].alive = false;
      Screen.flash = 0;
    },

    update(dt) {
      const f = dt * 60;
      for (let i = 0; i < MAX_P; i++) {
        const p = pool[i];
        if (!p.alive) continue;
        p.life -= f;
        if (p.life <= 0) {
          p.alive = false;
          continue;
        }
        p.vy -= p.grav * f;
        p.vx *= Math.pow(p.drag, f);
        p.vy *= Math.pow(p.drag, f);
        p.x += p.vx * f;
        p.y += p.vy * f;
        p.rot += p.vr * f;
      }
      if (Screen.flash > 0) {
        Screen.flash = Math.max(0, Screen.flash - Screen.flashDecay * f);
      }
      if (Screen.chroma > 0) {
        Screen.chroma = Math.max(0, Screen.chroma - 0.05 * f);
      }
    },

    /* ---------- 命中 ---------- */
    hit(x, y, dir, color, power) {
      const n = Math.round(6 + power * 7);
      for (let i = 0; i < n; i++) {
        const p = take();
        p.alive = true;
        p.type = 'spark';
        p.x = x + rnd(-8, 8);
        p.y = y + rnd(-10, 10);
        const a = rnd(-0.9, 0.9) + (dir > 0 ? 0 : Math.PI);
        const sp = rnd(4, 15) * (0.6 + power * 0.8);
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp + rnd(1, 5);
        p.life = rnd(9, 20);
        p.maxLife = p.life;
        p.size = rnd(2, 5) * (0.7 + power * 0.5);
        p.color = Math.random() < 0.45 ? '#ffffff' : color;
        p.grav = 0.32;
        p.drag = 0.9;
        p.width = rnd(1.2, 3);
      }
      // 中心光斑
      const core = take();
      core.alive = true;
      core.type = 'glow';
      core.x = x;
      core.y = y;
      core.life = 7 + power * 4;
      core.maxLife = core.life;
      core.size = 16 + power * 22;
      core.color = '#ffffff';
      core.color2 = color;
      core.vx = core.vy = 0;
      core.grav = 0;
      core.drag = 1;

      // 冲击环
      const ring = take();
      ring.alive = true;
      ring.type = 'ring';
      ring.x = x;
      ring.y = y;
      ring.life = 12 + power * 6;
      ring.maxLife = ring.life;
      ring.size = 10;
      ring.size2 = 60 + power * 70;
      ring.color = color;
      ring.vx = ring.vy = 0;
      ring.grav = 0;
      ring.drag = 1;
      ring.width = 2 + power * 2;

      // 碎片
      if (power > 0.5) {
        for (let i = 0; i < 5 + power * 6; i++) {
          const p = take();
          p.alive = true;
          p.type = 'shard';
          p.x = x;
          p.y = y;
          const a = rnd(0, Math.PI * 2);
          const sp = rnd(2, 9);
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp + 2;
          p.life = rnd(14, 26);
          p.maxLife = p.life;
          p.size = rnd(3, 8);
          p.rot = rnd(0, 6.28);
          p.vr = rnd(-0.4, 0.4);
          p.color = color;
          p.grav = 0.5;
          p.drag = 0.94;
        }
      }

      G.CAM.shake(3 + power * 7);
      Screen.flash = Math.min(1, 0.10 + power * 0.24);
      Screen.flashColor = '#ffffff';
      Screen.chroma = Math.min(1, power * 0.8);
    },

    /* ---------- 防御 ---------- */
    block(x, y, dir, color) {
      for (let i = 0; i < 9; i++) {
        const p = take();
        p.alive = true;
        p.type = 'spark';
        p.x = x + rnd(-6, 6);
        p.y = y + rnd(-8, 8);
        const a = rnd(-0.7, 0.7) + (dir > 0 ? 0 : Math.PI);
        const sp = rnd(3, 9);
        p.vx = Math.cos(a) * sp * 0.6;
        p.vy = Math.sin(a) * sp;
        p.life = rnd(7, 14);
        p.maxLife = p.life;
        p.size = rnd(1.6, 3.2);
        p.color = i % 3 === 0 ? color : '#cfe9ff';
        p.grav = 0.2;
        p.drag = 0.88;
        p.width = 1.6;
      }
      const ring = take();
      ring.alive = true;
      ring.type = 'ring';
      ring.x = x;
      ring.y = y;
      ring.life = 9;
      ring.maxLife = 9;
      ring.size = 8;
      ring.size2 = 34;
      ring.color = '#9fd8ff';
      ring.vx = ring.vy = 0;
      ring.grav = 0;
      ring.drag = 1;
      ring.width = 1.8;

      G.CAM.shake(1.6);
      Screen.flash = Math.max(Screen.flash, 0.06);
      Screen.flashColor = '#a8d8ff';
    },

    /* ---------- 尘土 ---------- */
    dust(x, y, dir, amount) {
      amount = amount || 6;
      for (let i = 0; i < amount; i++) {
        const p = take();
        p.alive = true;
        p.type = 'dust';
        p.x = x + rnd(-18, 18);
        p.y = y + rnd(0, 6);
        p.vx = rnd(-2.5, 2.5) + dir * rnd(0, 3);
        p.vy = rnd(0.4, 2.4);
        p.life = rnd(14, 26);
        p.maxLife = p.life;
        p.size = rnd(4, 11);
        p.color = '#7f9fc4';
        p.grav = -0.02;
        p.drag = 0.94;
      }
    },

    /* ---------- 冲刺速度线 ---------- */
    speedLines(x, y, dir, n) {
      n = n || 5;
      for (let i = 0; i < n; i++) {
        const p = take();
        p.alive = true;
        p.type = 'line';
        p.x = x + rnd(-30, 30);
        p.y = y + rnd(10, 190);
        p.vx = -dir * rnd(9, 20);
        p.vy = 0;
        p.life = rnd(6, 13);
        p.maxLife = p.life;
        p.size = rnd(20, 60);
        p.color = '#9fd8ff';
        p.grav = 0;
        p.drag = 1;
        p.width = rnd(0.8, 2);
      }
    },

    /* ---------- 扩散环 ---------- */
    ring(x, y, color, r0, r1, life) {
      const p = take();
      p.alive = true;
      p.type = 'ring';
      p.x = x;
      p.y = y;
      p.life = life || 16;
      p.maxLife = p.life;
      p.size = r0 || 8;
      p.size2 = r1 || 90;
      p.color = color || '#ffffff';
      p.vx = p.vy = 0;
      p.grav = 0;
      p.drag = 1;
      p.width = 2.5;
    },

    /* ---------- 刀光弧 ---------- */
    slash(x, y, dir, color, radius, spread) {
      const p = take();
      p.alive = true;
      p.type = 'slash';
      p.x = x;
      p.y = y;
      p.life = 11;
      p.maxLife = 11;
      p.size = radius || 90;
      p.size2 = spread == null ? 1.9 : spread;
      p.color = color;
      p.rot = dir > 0 ? -0.45 : Math.PI + 0.45;
      p.vr = 0;
      p.vx = 0;
      p.vy = 0;
      p.grav = 0;
      p.drag = 1;
      p.width = 5;
    },

    /* ---------- 闪电 ---------- */
    lightning(x1, y1, x2, y2, color, segments) {
      const p = take();
      p.alive = true;
      p.type = 'bolt';
      p.x = x1;
      p.y = y1;
      p.vx = x2;
      p.vy = y2;
      p.life = 9;
      p.maxLife = 9;
      p.color = color || '#3ef2ff';
      p.seed = Math.random() * 1000;
      p.size = segments || 7;
      p.width = 3;
      p.grav = 0;
      p.drag = 1;
    },

    /* ---------- 伤害数字 ---------- */
    damageText(x, y, num, color, big) {
      const p = take();
      p.alive = true;
      p.type = 'text';
      p.x = x;
      p.y = y;
      p.vx = rnd(-0.6, 0.6);
      p.vy = 2.6;
      p.life = 46;
      p.maxLife = 46;
      p.txt = String(num);
      p.color = color || '#ffffff';
      p.size = big ? 34 : 24;
      p.grav = 0;
      p.drag = 0.96;
    },

    /* ---------- 冲击柱(超必杀) ---------- */
    pillar(x, y, w, h, color, life) {
      const p = take();
      p.alive = true;
      p.type = 'pillar';
      p.x = x;
      p.y = y;
      p.life = life || 14;
      p.maxLife = p.life;
      p.size = w;
      p.size2 = h;
      p.color = color;
      p.vx = p.vy = 0;
      p.grav = 0;
      p.drag = 1;
    },

    /* ============================================================
       超必杀专属演出:每个角色完全不同的视觉语言
       kind: storm | shadow | quake | frost | meteor | tide
       每次判定帧调用一次;cx/cy 为判定中心
       ============================================================ */
    superPresent(kind, char, sx, sy, dir, ox, oy) {
      const C = char.color, C2 = char.color2;
      switch (kind) {

        /* ---- VOLT · 万雷天牢:多道天雷锁定对手 ---- */
        case 'storm': {
          const tx = ox + rnd(-40, 40);
          G.FX.lightning(tx, oy + 470, tx, oy + 10, '#d8f6ff', 9);
          G.FX.lightning(tx + rnd(-26, 26), oy + 470, tx, 0, C, 7);
          G.FX.pillar(tx, oy + 6, 22, 300, C, 9);
          G.FX.ring(tx, oy + 90, '#ffffff', 8, 80, 12);
          for (let i = 0; i < 3; i++) {
            const p = take();
            p.alive = true;
            p.type = 'spark';
            p.x = tx + rnd(-16, 16);
            p.y = oy + rnd(20, 160);
            p.vx = rnd(-7, 7);
            p.vy = rnd(-4, 6);
            p.life = rnd(7, 14);
            p.maxLife = p.life;
            p.size = rnd(2, 4.5);
            p.color = Math.random() < 0.5 ? '#ffffff' : C;
            p.grav = 0.1;
            p.drag = 0.92;
            p.width = 1.6;
          }
          G.CAM.shake(4.5);
          Screen.flash = 0.30;
          Screen.flashColor = '#d8f6ff';
          Screen.chroma = 0.5;
          break;
        }

        /* ---- KAGE · 暗影领域:黑幕落下,影刃从四面八方绞杀 ---- */
        case 'shadow': {
          // 落幕:暗色闪屏(用深色 pillar 罩住对手)
          G.FX.pillar(ox - 90, 0, 180, 430, 'rgba(20,4,32,0.82)', 10);
          // 影刃交叉绞杀
          G.FX.slash(ox + rnd(-30, 30), oy + rnd(40, 150), Math.random() < 0.5 ? 1 : -1, C, rnd(70, 120), rnd(1.4, 2.8));
          G.FX.slash(ox + rnd(-30, 30), oy + rnd(40, 150), Math.random() < 0.5 ? 1 : -1, '#b45aff', rnd(60, 110), rnd(1.2, 2.4));
          // 影刺从地底穿出
          for (let i = 0; i < 4; i++) {
            const p = take();
            p.alive = true;
            p.type = 'shard';
            p.x = ox + rnd(-70, 70);
            p.y = oy + rnd(90, 130);
            p.vx = rnd(-1, 1);
            p.vy = rnd(-14, -8);
            p.life = rnd(12, 20);
            p.maxLife = p.life;
            p.size = rnd(4, 10);
            p.rot = rnd(-0.15, 0.15);
            p.vr = 0;
            p.color = Math.random() < 0.6 ? '#3a0f52' : C;
            p.grav = 0.55;
            p.drag = 0.97;
          }
          G.FX.ring(ox, oy + 100, C2, 14, 130, 13);
          G.CAM.shake(3.5);
          Screen.flash = 0.22;
          Screen.flashColor = '#8a2be2';
          break;
        }

        /* ---- AXEL · 超载爆破:大地开裂,熔岩碎石喷发 ---- */
        case 'quake': {
          // 地面冲击波前段(沿攻击方向推进)
          const wx = sx + dir * rnd(20, 200);
          G.FX.ring(wx, 8, '#ffcf7a', 10, 120, 12);
          G.FX.ring(wx + dir * 30, 8, C2, 6, 90, 10);
          // 岩石喷发
          for (let i = 0; i < 6; i++) {
            const p = take();
            p.alive = true;
            p.type = 'shard';
            p.x = wx + rnd(-50, 50);
            p.y = rnd(0, 16);
            p.vx = rnd(-3.5, 3.5);
            p.vy = rnd(-16, -7);
            p.life = rnd(14, 26);
            p.maxLife = p.life;
            p.size = rnd(4, 12);
            p.rot = rnd(0, 6.28);
            p.vr = rnd(-0.35, 0.35);
            p.color = Math.random() < 0.55 ? '#5a4433' : (Math.random() < 0.5 ? '#ffb03a' : '#ff5a1f');
            p.grav = 0.62;
            p.drag = 0.97;
          }
          // 熔岩火花
          for (let i = 0; i < 5; i++) {
            const p = take();
            p.alive = true;
            p.type = 'spark';
            p.x = wx + rnd(-40, 40);
            p.y = rnd(0, 40);
            p.vx = rnd(-6, 6);
            p.vy = rnd(-12, -4);
            p.life = rnd(8, 16);
            p.maxLife = p.life;
            p.size = rnd(2, 5);
            p.color = Math.random() < 0.5 ? '#ffd88a' : '#ff5a1f';
            p.grav = 0.4;
            p.drag = 0.94;
            p.width = 2.2;
          }
          G.CAM.shake(9);
          Screen.flash = 0.20;
          Screen.flashColor = '#ffb03a';
          break;
        }

        /* ---- LYRA · 绝对零度:冰晶尖刺破土,霜花炸裂 ---- */
        case 'frost': {
          const tx = ox + rnd(-50, 50);
          // 冰柱(比落雷矮而锋利,从地面向上)
          G.FX.pillar(tx, 0, 16, rnd(200, 330), 'rgba(200,240,255,0.85)', 11);
          G.FX.pillar(tx + dir * 34, 0, 10, rnd(120, 220), 'rgba(150,210,255,0.7)', 9);
          // 冰晶环
          G.FX.ring(tx, oy + 80, '#e8f9ff', 6, 100, 14);
          // 冰晶碎片(棱形,慢速飘落)
          for (let i = 0; i < 5; i++) {
            const p = take();
            p.alive = true;
            p.type = 'shard';
            p.x = tx + rnd(-60, 60);
            p.y = oy + rnd(30, 140);
            p.vx = rnd(-2, 2);
            p.vy = rnd(-3, 3);
            p.life = rnd(18, 32);
            p.maxLife = p.life;
            p.size = rnd(3, 7);
            p.rot = Math.PI / 4;
            p.vr = rnd(-0.06, 0.06);
            p.color = Math.random() < 0.6 ? '#cfeeff' : C;
            p.grav = 0.02;
            p.drag = 0.985;
          }
          // 霜尘
          G.FX.dust(tx, 0, 0, 3);
          G.CAM.shake(3);
          Screen.flash = 0.24;
          Screen.flashColor = '#cfeeff';
          break;
        }

        /* ---- NOVA · 超新星:流星从天而降,砸出星环 ---- */
        case 'meteor': {
          const tx = ox + rnd(-60, 60);
          // 流星拖尾(斜向速度线)
          for (let i = 0; i < 4; i++) {
            const p = take();
            p.alive = true;
            p.type = 'line';
            p.x = tx + rnd(-90, 90);
            p.y = rnd(60, 220);
            p.vx = rnd(4, 9);
            p.vy = rnd(10, 16);
            p.life = rnd(7, 12);
            p.maxLife = p.life;
            p.size = rnd(30, 70);
            p.color = Math.random() < 0.5 ? '#eaffb0' : C;
            p.grav = 0;
            p.drag = 1;
            p.width = rnd(1.5, 3);
          }
          // 落点星爆
          G.FX.ring(tx, oy + rnd(40, 130), '#ffffff', 8, 110, 12);
          G.FX.ring(tx, oy + 90, C, 4, 70, 10);
          const core = take();
          core.alive = true;
          core.type = 'glow';
          core.x = tx;
          core.y = oy + rnd(50, 130);
          core.life = 10;
          core.maxLife = 10;
          core.size = 26;
          core.color = '#ffffff';
          core.color2 = C;
          core.vx = core.vy = 0;
          core.grav = 0;
          core.drag = 1;
          // 星尘
          for (let i = 0; i < 4; i++) {
            const p = take();
            p.alive = true;
            p.type = 'spark';
            p.x = tx + rnd(-30, 30);
            p.y = oy + rnd(30, 140);
            p.vx = rnd(-5, 5);
            p.vy = rnd(-6, 2);
            p.life = rnd(8, 15);
            p.maxLife = p.life;
            p.size = rnd(1.5, 3.5);
            p.color = Math.random() < 0.5 ? '#eaffb0' : '#ffffff';
            p.grav = 0.15;
            p.drag = 0.93;
            p.width = 1.4;
          }
          G.CAM.shake(4);
          Screen.flash = 0.22;
          Screen.flashColor = '#eaffb0';
          Screen.chroma = 0.4;
          break;
        }

        /* ---- RUE · 深渊潮:巨浪横扫全场,水花四溅 ---- */
        case 'tide': {
          // 浪头(沿方向推进的一串光脊)
          const front = sx + dir * (60 + rnd(0, 220));
          for (let i = 0; i < 3; i++) {
            const p = take();
            p.alive = true;
            p.type = 'glow';
            p.x = front - dir * i * 26;
            p.y = rnd(10, 60);
            p.life = 12 - i * 2;
            p.maxLife = p.life;
            p.size = 40 - i * 8;
            p.color = '#ffffff';
            p.color2 = i === 0 ? '#bff0ff' : (i === 1 ? C : C2);
            p.vx = dir * rnd(2, 5);
            p.vy = 0;
            p.grav = 0;
            p.drag = 0.99;
          }
          // 水花
          for (let i = 0; i < 6; i++) {
            const p = take();
            p.alive = true;
            p.type = 'spark';
            p.x = front + rnd(-40, 40);
            p.y = rnd(0, 90);
            p.vx = dir * rnd(2, 8) + rnd(-2, 2);
            p.vy = rnd(-11, -3);
            p.life = rnd(10, 20);
            p.maxLife = p.life;
            p.size = rnd(1.5, 4);
            p.color = Math.random() < 0.6 ? '#bff0ff' : '#ffffff';
            p.grav = 0.38;
            p.drag = 0.96;
            p.width = 1.6;
          }
          G.FX.ring(front, 40, C, 10, 100, 12);
          G.CAM.shake(5);
          Screen.flash = 0.18;
          Screen.flashColor = '#5ad7ff';
          break;
        }

        /* 兜底:天雷 */
        default: {
          const tx = ox || sx;
          G.FX.lightning(tx, oy + 460, tx, 0, C, 8);
          G.FX.pillar(tx, 0, 24, 440, C, 10);
          G.CAM.shake(5);
          break;
        }
      }
    },

    /* ---------- 超必杀起手蓄力(按角色形态) ---------- */
    superCharge(charId, char, x, y) {
      const C = char.color;
      G.FX.absorb(x, y, C, 2);
      switch (charId) {
        case 'volt': // 电弧缠绕
          if (Math.random() < 0.5) G.FX.lightning(x + rnd(-40, 40), y + rnd(30, 170), x + rnd(-40, 40), y + rnd(30, 170), C, 4);
          break;
        case 'kage': // 黑雾升腾
          G.FX.dust(x, y, 0, 2);
          break;
        case 'axel': // 蓄力震地
          if (Math.random() < 0.6) G.FX.ring(x, 8, C, 6, 60, 9);
          break;
        case 'lyra': // 霜花旋转
          if (Math.random() < 0.6) G.FX.ring(x, y + 90, '#cfeeff', 70, 20, 10);
          break;
        case 'nova': // 星轨环绕
          if (Math.random() < 0.6) G.FX.ring(x, y + 100, C, 90, 40, 10);
          break;
        case 'rue': // 水汽上升
          G.FX.dust(x, y, 0, 2);
          break;
      }
    },

    /* ---------- 能量吸收(蓄力) ---------- */
    absorb(x, y, color, n) {
      for (let i = 0; i < (n || 3); i++) {
        const p = take();
        p.alive = true;
        p.type = 'absorb';
        const a = rnd(0, Math.PI * 2);
        const r = rnd(50, 110);
        p.x = x + Math.cos(a) * r;
        p.y = y + 100 + Math.sin(a) * r;
        p.vx = -Math.cos(a) * r * 0.09;
        p.vy = -Math.sin(a) * r * 0.09;
        p.life = 12;
        p.maxLife = 12;
        p.size = rnd(2, 4.5);
        p.color = color;
        p.grav = 0;
        p.drag = 1;
        p.width = 2;
      }
    },

    /* ============================================================
       渲染
       ============================================================ */
    render(ctx) {
      const S = CAM;
      ctx.save();
      for (let i = 0; i < MAX_P; i++) {
        const p = pool[i];
        if (!p.alive) continue;
        const k = p.life / p.maxLife;
        const sx = S.sx(p.x);
        const sy = S.sy(p.y);
        const Z = S.zoom;

        switch (p.type) {
          case 'spark': {
            ctx.globalAlpha = k;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = Math.max(0.7, p.width * Z);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - p.vx * Z * 1.6, sy + p.vy * Z * 1.6);
            ctx.stroke();
            break;
          }
          case 'dust': {
            ctx.globalAlpha = k * 0.42;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(sx, sy, p.size * (2 - k) * Z, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case 'glow': {
            const r = p.size * (0.7 + (1 - k) * 0.9) * Z;
            const rb = Math.round(r / 5) * 5;
            const ab = Math.round(k * 8) / 8;
            ctx.globalAlpha = 1;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.fillStyle = radialGrad(
              ctx,
              'gl|' + p.color2 + '|' + rb + '|' + ab,
              rb,
              'rgba(255,255,255,' + ab * 0.95 + ')',
              hexA(p.color2, ab * 0.7)
            );
            ctx.beginPath();
            ctx.arc(0, 0, rb, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            break;
          }
          case 'ring': {
            const r = lerp(p.size, p.size2, 1 - k) * Z;
            ctx.globalAlpha = k * k;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * k * Z;
            ctx.beginPath();
            ctx.ellipse(sx, sy, r, r * 0.82, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'shard': {
            ctx.globalAlpha = k;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            const s = p.size * Z * (0.5 + k * 0.7);
            ctx.beginPath();
            ctx.moveTo(-s, -s * 0.35);
            ctx.lineTo(s * 1.4, 0);
            ctx.lineTo(-s, s * 0.35);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            break;
          }
          case 'line': {
            ctx.globalAlpha = k * 0.8;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * Z;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - p.size * Z * (1 - k * 0.3), sy);
            ctx.stroke();
            break;
          }
          case 'slash': {
            const a0 = p.rot - p.size2 / 2;
            const a1 = p.rot + p.size2 / 2;
            const rr = p.size * Z * (0.6 + (1 - k) * 0.5);
            ctx.globalAlpha = k;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * Z * k + 1;
            ctx.lineCap = 'round';
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(sx, sy, rr, a0, a1);
            ctx.stroke();
            // 内侧白芯
            ctx.globalAlpha = k * 0.9;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1, p.width * Z * k * 0.4);
            ctx.beginPath();
            ctx.arc(sx, sy, rr, a0 + 0.15, a1 - 0.15);
            ctx.stroke();
            ctx.shadowBlur = 0;
            break;
          }
          case 'bolt': {
            ctx.globalAlpha = k;
            const x2 = S.sx(p.vx),
              y2 = S.sy(p.vy);
            const seg = Math.round(p.size);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * Z * k + 0.6;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            for (let s = 1; s < seg; s++) {
              const t = s / seg;
              const nx = lerp(sx, x2, t) + Math.sin(p.seed + s * 3.7) * 14 * (1 - Math.abs(t - 0.5) * 2);
              const ny = lerp(sy, y2, t) + Math.cos(p.seed + s * 2.3) * 10;
              ctx.lineTo(nx, ny);
            }
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            break;
          }
          case 'text': {
            ctx.globalAlpha = Math.min(1, k * 2.2);
            ctx.font = '900 ' + Math.round(p.size * Z) + 'px "Orbitron", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 12;
            ctx.fillText(p.txt, sx, sy);
            ctx.shadowBlur = 0;
            break;
          }
          case 'pillar': {
            const w = p.size * Z;
            const h = p.size2 * Z;
            const g = ctx.createLinearGradient(sx, sy, sx, sy - h);
            g.addColorStop(0, hexA(p.color, k * 0.9));
            g.addColorStop(0.5, hexA(p.color, k * 0.35));
            g.addColorStop(1, hexA(p.color, 0));
            ctx.globalAlpha = 1;
            ctx.fillStyle = g;
            ctx.fillRect(sx - w / 2, sy - h, w, h);
            break;
          }
          case 'absorb': {
            ctx.globalAlpha = k;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * Z;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - p.vx * Z * 3, sy + p.vy * Z * 3);
            ctx.stroke();
            break;
          }
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    },

    /* ---------- 屏幕叠加(在最后绘制) ---------- */
    renderScreen(ctx) {
      if (Screen.flash > 0.005) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.55, Screen.flash * 0.5);
        ctx.fillStyle = Screen.flashColor;
        ctx.fillRect(0, 0, G.CFG.W, G.CFG.H);
        ctx.restore();
      }
    },
  });

  function hexA(hex, a) {
    if (!hex) return 'rgba(255,255,255,' + a + ')';
    if (hex[0] === '#') {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    return hex;
  }
  G.hexA = hexA;

  /* ---------------- 残影 ---------- */
  G.Trail = class Trail {
    constructor() {
      this.pts = [];
    }
    push(pose, x, y, facing, extra) {
      this.pts.push({
        pose: {
          hip: [pose.hip[0], pose.hip[1]],
          torso: pose.torso, headTilt: pose.headTilt,
          headOff: [pose.headOff[0], pose.headOff[1]],
          footL: [pose.footL[0], pose.footL[1]],
          footR: [pose.footR[0], pose.footR[1]],
          handL: [pose.handL[0], pose.handL[1]],
          handR: [pose.handR[0], pose.handR[1]],
          kneeL: pose.kneeL, kneeR: pose.kneeR,
          elbowL: pose.elbowL, elbowR: pose.elbowR,
          bodyRot: pose.bodyRot, eyeOpen: pose.eyeOpen,
        },
        x, y, facing, t: 0, extra,
      });
      if (this.pts.length > 5) this.pts.shift();
    }
    update(dt) {
      const f = dt * 60;
      for (let i = this.pts.length - 1; i >= 0; i--) {
        this.pts[i].t += f;
        if (this.pts[i].t > 8) this.pts.splice(i, 1);
      }
    }
    render(ctx, char) {
      for (let i = 0; i < this.pts.length; i++) {
        const p = this.pts[i];
        const a = (1 - p.t / 8) * 0.26 * ((i + 1) / this.pts.length);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(G.CAM.sx(p.x), G.CAM.sy(p.y));
        ctx.scale(G.CAM.zoom * p.facing, -G.CAM.zoom);
        // 简化绘制:只画大块
        const s = G.Rig.solve(p.pose, char);
        ctx.fillStyle = char.color;
        ctx.strokeStyle = char.color;
        ctx.lineCap = 'round';
        const segs = [
          [s.hip, s.sh, 16], [s.hip, s.kneeL, 11], [s.kneeL, p.pose.footL, 8],
          [s.hip, s.kneeR, 12], [s.kneeR, p.pose.footR, 8],
          [s.sh, s.elbowR, 9], [s.elbowR, p.pose.handR, 6],
        ];
        segs.forEach(([a1, b1, w]) => {
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(a1[0], a1[1]);
          ctx.lineTo(b1[0], b1[1]);
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.arc(s.head[0], s.head[1], 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    clear() {
      this.pts.length = 0;
    }
  };
})();
