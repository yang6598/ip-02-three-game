/* ============================================================
   NEON RIFT — moves.js  (v2: 6 角色 / 提速 / 独有机制)
   帧数据单位 = 逻辑帧(60fps),距离单位 = 世界单位

   节奏基调(全部角色通用):
     普通技起手 4~8 帧, 收招 6~18 帧 —— 比 v1 全面提速约 30%
     hitstop 4~9 帧(原 6~13) —— 靠特效做打击感,不靠长定格卡手感

   guard: MID = 站/蹲都能防 | LOW = 只能蹲防 | OVERHEAD = 只能站防
   特殊字段:
     armor:[a,b]  该帧段内受击进入"霸体"(扣血但不打断)
     pull:n       命中后把对手向自己拉 n 距离
     rehit:n/gap  同一招可重复命中 n 次, 间隔 gap 帧
     airJumps     角色可二段跳(在 char 上)
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;

  /* ============================================================
     一、通用普通技模板(以 VOLT 为基准, 各角色按系数缩放)
     ============================================================ */
  function tpl() {
    return {
      LP: {
        name: '轻拳', cmd: 'LP', startup: 4, active: 3, recovery: 6,
        dmg: 30, chip: 2, guard: 'MID',
        hitstun: 14, blockstun: 10, hitstop: 4, blockstop: 3,
        hitbox: { x: 22, y: 128, w: 64, h: 26 },
        cancel: ['LP', 'HP', 'LK', 'HK', 'SP1', 'SP2', 'SP3', 'SU'],
        meterGain: 7, anim: 'punchL', sfxWhiff: 'whiff_light', sfxHit: 'hit_light',
        pushback: 2.4, blockPushback: 5.0, level: 0,
      },
      HP: {
        name: '重拳', cmd: 'HP', startup: 8, active: 4, recovery: 13,
        dmg: 78, chip: 6, guard: 'MID',
        hitstun: 21, blockstun: 14, hitstop: 8, blockstop: 5,
        hitbox: { x: 16, y: 118, w: 88, h: 38 },
        cancel: ['SP1', 'SP2', 'SP3', 'SU'],
        meterGain: 14, anim: 'punchH', sfxWhiff: 'whiff_heavy', sfxHit: 'hit_heavy',
        pushback: 5.0, blockPushback: 9.0, level: 1,
      },
      LK: {
        name: '轻脚', cmd: 'LK', startup: 4, active: 3, recovery: 8,
        dmg: 34, chip: 2, guard: 'MID',
        hitstun: 15, blockstun: 11, hitstop: 4, blockstop: 3,
        hitbox: { x: 24, y: 78, w: 68, h: 30 },
        cancel: ['LP', 'HP', 'LK', 'HK', 'SP1', 'SP2', 'SP3', 'SU'],
        meterGain: 8, anim: 'kickL', sfxWhiff: 'whiff_light', sfxHit: 'hit_light',
        pushback: 2.8, blockPushback: 5.5, level: 0,
      },
      HK: {
        name: '重脚', cmd: 'HK', startup: 10, active: 5, recovery: 15,
        dmg: 90, chip: 7, guard: 'MID',
        hitstun: 24, blockstun: 15, hitstop: 9, blockstop: 6,
        hitbox: { x: 10, y: 96, w: 98, h: 46 },
        cancel: ['SP1', 'SP2', 'SP3', 'SU'],
        meterGain: 16, anim: 'kickH', sfxWhiff: 'whiff_heavy', sfxHit: 'hit_heavy',
        pushback: 6.0, blockPushback: 10.0, level: 1, knockdown: true,
      },
      CLP: {
        name: '下段拳', cmd: 'CLP', startup: 4, active: 3, recovery: 7,
        dmg: 28, chip: 2, guard: 'MID',
        hitstun: 14, blockstun: 10, hitstop: 4, blockstop: 3,
        hitbox: { x: 20, y: 84, w: 62, h: 24 },
        cancel: ['LP', 'HP', 'LK', 'HK', 'CLK', 'CHK', 'SP1', 'SP2', 'SU'],
        meterGain: 7, anim: 'crouchPunch', sfxWhiff: 'whiff_light', sfxHit: 'hit_light',
        pushback: 2.2, blockPushback: 4.6, level: 0, crouch: true,
      },
      CLK: {
        name: '下段脚', cmd: 'CLK', startup: 4, active: 3, recovery: 7,
        dmg: 26, chip: 2, guard: 'LOW',
        hitstun: 13, blockstun: 10, hitstop: 4, blockstop: 3,
        hitbox: { x: 20, y: 14, w: 66, h: 24 },
        cancel: ['CLK', 'CLP', 'CHK', 'SP1', 'SP2', 'SU'],
        meterGain: 7, anim: 'crouchKick', sfxWhiff: 'whiff_light', sfxHit: 'hit_light',
        pushback: 2.2, blockPushback: 4.6, level: 0, crouch: true,
      },
      CHK: {
        name: '扫腿', cmd: 'CHK', startup: 7, active: 4, recovery: 18,
        dmg: 70, chip: 6, guard: 'LOW',
        hitstun: 23, blockstun: 14, hitstop: 9, blockstop: 5,
        hitbox: { x: 8, y: 6, w: 108, h: 26 },
        cancel: ['SU'],
        meterGain: 15, anim: 'sweep', sfxWhiff: 'whiff_heavy', sfxHit: 'hit_heavy',
        pushback: 5.5, blockPushback: 9.0, level: 1, crouch: true, knockdown: true,
      },
      JLK: {
        name: '空踢', cmd: 'JLK', startup: 5, active: 6, recovery: 7,
        dmg: 40, chip: 3, guard: 'OVERHEAD',
        hitstun: 17, blockstun: 12, hitstop: 5, blockstop: 4,
        hitbox: { x: 18, y: 34, w: 72, h: 42 },
        cancel: [], meterGain: 7, anim: 'jumpKickL',
        sfxWhiff: 'whiff_light', sfxHit: 'hit_light',
        pushback: 3.0, blockPushback: 5.0, level: 0, air: true,
      },
      JHK: {
        name: '空重踢', cmd: 'JHK', startup: 7, active: 8, recovery: 9,
        dmg: 72, chip: 6, guard: 'OVERHEAD',
        hitstun: 23, blockstun: 15, hitstop: 8, blockstop: 5,
        hitbox: { x: 8, y: 20, w: 86, h: 54 },
        cancel: [], meterGain: 14, anim: 'jumpKickH',
        sfxWhiff: 'whiff_heavy', sfxHit: 'hit_heavy',
        pushback: 5.0, blockPushback: 8.0, level: 1, air: true,
      },
      THROW: {
        name: '投技', cmd: 'THROW', startup: 5, active: 2, recovery: 20,
        dmg: 105, chip: 0, guard: 'THROW',
        hitstun: 38, blockstun: 0, hitstop: 10, blockstop: 0,
        hitbox: { x: 10, y: 60, w: 58, h: 90 },
        cancel: [], meterGain: 18, anim: 'throwExec',
        sfxWhiff: 'whiff_light', sfxHit: 'hit_heavy', fx: 'throwFx',
        pushback: 0, blockPushback: 0, level: 2, isThrow: true,
      },
    };
  }

  /* ============================================================
     二、按角色系数生成完整招式表
     cfg: { dmg, spd, reach, hMul, hitstopMul, names:{}, cancelX }
     ============================================================ */
  function buildMoves(cfg) {
    const base = tpl();
    const d = cfg.dmg || 1;
    const sp = cfg.spd || 1;      // >1 更快
    const rc = cfg.reach || 1;
    const hm = cfg.hMul || 1;
    const hs = cfg.hitstopMul || 1;
    const out = {};

    const fs = (n, min) => Math.max(min || 2, Math.round(n / sp));

    Object.keys(base).forEach((id) => {
      const t = base[id];
      const m = {};
      for (const k in t) m[k] = t[k];
      m.id = id;
      m.hitbox = t.hitbox ? {
        x: Math.round(t.hitbox.x * rc),
        y: Math.round(t.hitbox.y * hm),
        w: Math.round(t.hitbox.w * rc),
        h: Math.round(t.hitbox.h * hm),
      } : null;
      m.startup = fs(t.startup, 2);
      m.active = fs(t.active, 2);
      m.recovery = fs(t.recovery, 4);
      m.dmg = Math.round(t.dmg * d);
      m.chip = Math.round((t.chip || 0) * d);
      m.hitstun = Math.round(t.hitstun * (cfg.stunMul || 1));
      m.blockstun = Math.round(t.blockstun * (cfg.stunMul || 1));
      m.hitstop = Math.max(3, Math.round(t.hitstop * hs));
      m.blockstop = Math.max(2, Math.round(t.blockstop * hs));
      m.cancel = (t.cancel || []).slice();
      m.pushback = t.pushback * (cfg.pushMul || 1);
      m.blockPushback = t.blockPushback * (cfg.pushMul || 1);
      if (m.isThrow) { m.dmg = Math.round(m.dmg * (cfg.throwMul || 1)); }
      if (cfg.names && cfg.names[id]) m.name = cfg.names[id];
      out[id] = m;
    });
    return out;
  }

  /* 必杀技快捷构造 */
  function sp(o) {
    const m = {
      id: o.id, name: o.name, cmd: o.cmd,
      startup: o.startup, active: o.active, recovery: o.recovery,
      dmg: o.dmg || 0, chip: o.chip || 6, guard: o.guard || 'MID',
      hitstun: o.hitstun || 24, blockstun: o.blockstun || 14,
      hitstop: o.hitstop || 8, blockstop: o.blockstop || 5,
      hitbox: o.hitbox || null,
      cancel: o.cancel || ['SU'],
      meterGain: o.meterGain || 13, meterCost: 0,
      anim: o.anim, sfxWhiff: o.sfxWhiff || 'special', sfxHit: o.sfxHit || 'hit_heavy',
      fx: o.fx || 'burstC',
      pushback: o.pushback == null ? 5 : o.pushback,
      blockPushback: o.blockPushback == null ? 9 : o.blockPushback,
      level: o.level == null ? 1 : o.level,
    };
    ['proj', 'invuln', 'vx', 'vy', 'gravity', 'dashMove', 'knockdown',
      'armor', 'pull', 'rehit', 'rehitGap', 'isThrow', 'commandThrow',
      'passThrough', 'superStrike', 'airOnly', 'landCancel'].forEach((k) => {
      if (o[k] != null) m[k] = o[k];
    });
    if (o.meterCost) m.meterCost = o.meterCost;
    if (o.id === 'SU') { m.level = 3; m.meterCost = 1; m.sfxHit = 'super'; m.sfxWhiff = 'super'; m.fx = 'superFx'; }
    return m;
  }

  /* ============================================================
     三、六个角色
     ============================================================ */

  /* ---------- 1. VOLT 伏特 · 电光特务(速度型) ---------- */
  function voltMoves() {
    const m = buildMoves({
      dmg: 0.94, spd: 1.12, reach: 1.0, hMul: 1.0, hitstopMul: 0.9,
      names: { LP: '光刃', HP: '雷贯', LK: '侧闪踢', HK: '回旋斩', THROW: '过肩摔' },
    });
    m.SP1 = sp({
      id: 'SP1', name: '电弧弹', cmd: '236P', anim: 'castBolt', fx: 'sparkC',
      startup: 10, active: 2, recovery: 18, dmg: 0, chip: 8, level: 1,
      proj: {
        type: 'bolt', speed: 13.0, dmg: 62, chip: 9,
        hitstun: 20, blockstun: 16, hitstop: 8, guard: 'MID',
        w: 34, h: 34, yOff: 118, life: 140, level: 1,
      },
    });
    m.SP2 = sp({
      id: 'SP2', name: '雷升', cmd: '623P', anim: 'risingUppercut', fx: 'burstC',
      startup: 3, active: 12, recovery: 20, dmg: 92, guard: 'MID', level: 2,
      hitstun: 28, blockstun: 12, hitstop: 9, blockstop: 5,
      hitbox: { x: 4, y: 96, w: 66, h: 118 },
      knockdown: true, invuln: [0, 8],
      vx: [0, '*', 2.4], vy: [0, '*', 17.0], gravity: true,
    });
    m.SP3 = sp({
      id: 'SP3', name: '电光突', cmd: '214K', anim: 'rushSlash', fx: 'burstC',
      startup: 5, active: 8, recovery: 13, dmg: 70, level: 1,
      hitbox: { x: 12, y: 70, w: 80, h: 64 },
      vx: [0, '*', 11.0], gravity: false, dashMove: true,
    });
    m.SU = sp({
      id: 'SU', name: '万雷天牢', cmd: '236236P', anim: 'superRain', fx: 'superFx',
      startup: 6, active: 32, recovery: 26, dmg: 0, guard: 'MID',
      superStrike: {
        count: 12, interval: 3, dmg: 26, guard: 'MID',
        hitstun: 28, blockstun: 12, hitstop: 3,
        width: 330, height: 430, yOff: 0, chipRatio: 0.25,
      },
    });
    return m;
  }

  /* ---------- 2. KAGE 影 · 影流刺客(投技型) ---------- */
  function kageMoves() {
    const m = buildMoves({
      dmg: 1.06, spd: 1.0, reach: 0.96, hMul: 1.02, hitstopMul: 1.0,
      throwMul: 1.2,
      names: { LP: '影刺', HP: '裂爪', LK: '膝撞', HK: '断骨踢', CHK: '足刈', THROW: '影缚' },
    });
    m.SP1 = sp({
      id: 'SP1', name: '影刃', cmd: '236K', anim: 'shadowEdge', fx: 'burstM',
      startup: 8, active: 8, recovery: 17, dmg: 86, level: 1,
      hitstun: 24, blockstun: 14, hitstop: 9,
      hitbox: { x: 10, y: 84, w: 98, h: 72 },
      vx: [0, 0, 12.5], gravity: false, dashMove: true,
    });
    m.SP2 = sp({
      id: 'SP2', name: '断空踢', cmd: '623K', anim: 'risingUppercut', fx: 'burstM',
      startup: 4, active: 10, recovery: 22, dmg: 100, level: 2,
      hitstun: 30, blockstun: 12, hitstop: 10,
      hitbox: { x: 2, y: 88, w: 74, h: 130 },
      knockdown: true, invuln: [0, 7],
      vx: [0, '*', 2.8], vy: [0, '*', 16.0], gravity: true,
    });
    m.SP3 = sp({
      id: 'SP3', name: '影缝', cmd: '214P', anim: 'commandGrab', fx: 'throwFx',
      startup: 6, active: 3, recovery: 24, dmg: 128, guard: 'THROW', level: 2,
      hitstun: 42, hitstop: 12, hitbox: { x: 4, y: 40, w: 66, h: 122 },
      isThrow: true, commandThrow: true, pushback: 0, blockPushback: 0,
    });
    // 影针:掷出苦无,速度极快但判定窄(远程牵制 / 掩护突进)
    m.SP4 = sp({
      id: 'SP4', name: '影针', cmd: '一键 / 236+脚', anim: 'castBolt', fx: 'sparkM',
      startup: 7, active: 2, recovery: 13, dmg: 0, chip: 7, level: 1,
      proj: {
        type: 'needle', speed: 16.0, dmg: 46, chip: 7,
        hitstun: 18, blockstun: 13, hitstop: 6, guard: 'MID',
        w: 26, h: 16, yOff: 116, life: 130, level: 1,
      },
    });
    m.SU = sp({
      id: 'SU', name: '暗影领域', cmd: '214214P', anim: 'superGrab', fx: 'superFx',
      startup: 8, active: 26, recovery: 30, dmg: 0, guard: 'THROW',
      superStrike: {
        count: 10, interval: 4, dmg: 42, guard: 'THROW',
        hitstun: 38, blockstun: 0, hitstop: 5,
        width: 160, height: 260, yOff: 40, chipRatio: 0, isThrow: true,
      },
    });
    return m;
  }

  /* ---------- 3. AXEL 钢 · 铁壁重工(重装/霸体型) ---------- */
  function axelMoves() {
    const m = buildMoves({
      dmg: 1.26, spd: 0.88, reach: 1.14, hMul: 1.06, hitstopMul: 1.25,
      stunMul: 1.08, pushMul: 1.25, throwMul: 1.1,
      names: { LP: '短肘', HP: '崩拳', LK: '前踢', HK: '碎膝锤', CLK: '足踏', CHK: '地裂扫', THROW: '铁壁投' },
    });
    // 震地拳:带霸体(armor)的前进重拳, 起手慢但能硬吃一下
    m.SP1 = sp({
      id: 'SP1', name: '震地拳', cmd: '236P', anim: 'punchH', fx: 'burstM',
      startup: 13, active: 6, recovery: 17, dmg: 118, level: 2,
      hitstun: 30, blockstun: 18, hitstop: 12, blockstop: 8,
      hitbox: { x: 10, y: 82, w: 108, h: 78 },
      armor: [0, 20], knockdown: true,
      vx: [0, '*', 7.5], gravity: false, dashMove: true,
    });
    // 铁山靠:大力位移 + 撞飞
    m.SP2 = sp({
      id: 'SP2', name: '铁山靠', cmd: '623P', anim: 'rushSlash', fx: 'burstM',
      startup: 7, active: 9, recovery: 20, dmg: 104, level: 2,
      hitstun: 28, blockstun: 16, hitstop: 11,
      hitbox: { x: 6, y: 74, w: 96, h: 96 },
      knockdown: true, invuln: [0, 5],
      vx: [0, 0, 13.0], vy: [0, '*', 5.0], gravity: true, dashMove: true,
    });
    // 磁力钳:无伤害判定, 把对手硬拉过来 → 立刻接指令投/连段
    m.SP3 = sp({
      id: 'SP3', name: '磁力钳', cmd: '214P', anim: 'commandGrab', fx: 'sparkM',
      startup: 9, active: 6, recovery: 14, dmg: 18, level: 1,
      hitstun: 26, blockstun: 12, hitstop: 6,
      hitbox: { x: 20, y: 40, w: 250, h: 170 },
      guard: 'THROW', pull: 210, pushback: 0, blockPushback: 0,
      cancel: ['LP', 'HP', 'SP1', 'SP2', 'SU'],
    });
    // 地裂波:贴地推进的震波,必须蹲防(逼对手从蹲防里起来)
    m.SP4 = sp({
      id: 'SP4', name: '地裂波', cmd: '一键', anim: 'sweep', fx: 'burstM',
      startup: 10, active: 2, recovery: 19, dmg: 0, chip: 11, level: 2,
      proj: {
        type: 'wave', speed: 7.0, dmg: 76, chip: 12,
        hitstun: 24, blockstun: 16, hitstop: 9, guard: 'LOW',
        w: 48, h: 58, yOff: 32, life: 210, level: 2,
      },
    });
    m.SU = sp({
      id: 'SU', name: '超载爆破', cmd: '236236P', anim: 'superRain', fx: 'superFx',
      startup: 9, active: 24, recovery: 26, dmg: 0, guard: 'MID',
      superStrike: {
        count: 8, interval: 3, dmg: 46, guard: 'MID',
        hitstun: 30, blockstun: 14, hitstop: 5,
        width: 200, height: 250, yOff: 0, chipRatio: 0.3,
      },
    });
    return m;
  }

  /* ---------- 4. LYRA 璃 · 霜华术士(设置/牵制型) ---------- */
  function lyraMoves() {
    const m = buildMoves({
      dmg: 0.9, spd: 1.04, reach: 1.06, hMul: 0.99, hitstopMul: 0.85,
      names: { LP: '霜指', HP: '冰掌', LK: '滑步踢', HK: '霜弧', THROW: '寒锁' },
    });
    // 霜棱:慢速冰锥, 命中后超长硬直(起手快, 适合做连段起手)
    m.SP1 = sp({
      id: 'SP1', name: '霜棱', cmd: '236P', anim: 'castBolt', fx: 'sparkC',
      startup: 9, active: 2, recovery: 16, dmg: 0, chip: 7, level: 1,
      proj: {
        type: 'ice', speed: 8.0, dmg: 58, chip: 8,
        hitstun: 30, blockstun: 20, hitstop: 8, guard: 'MID',
        w: 30, h: 46, yOff: 106, life: 160, level: 1,
      },
    });
    // 寒风升:冰柱从地面拔起, 覆盖低位到高空(强对空)
    m.SP2 = sp({
      id: 'SP2', name: '寒风升', cmd: '623P', anim: 'risingUppercut', fx: 'burstC',
      startup: 5, active: 9, recovery: 22, dmg: 88, level: 2,
      hitstun: 30, blockstun: 14, hitstop: 9,
      hitbox: { x: 6, y: 0, w: 84, h: 210 },
      knockdown: true, invuln: [0, 6],
      vy: [0, '*', 6.0], gravity: true,
    });
    // 冰镜:原地放一面冰镜, 持续多段判定(设罝型压制)
    m.SP3 = sp({
      id: 'SP3', name: '冰镜', cmd: '214P', anim: 'castBolt', fx: 'sparkC',
      startup: 8, active: 30, recovery: 10, dmg: 26, level: 1,
      hitstun: 18, blockstun: 14, hitstop: 5, blockstop: 4,
      hitbox: { x: 40, y: 20, w: 96, h: 190 },
      rehit: 4, rehitGap: 8, pushback: 1.5, blockPushback: 4,
      cancel: ['SU'],
    });
    m.SU = sp({
      id: 'SU', name: '绝对零度', cmd: '236236P', anim: 'superRain', fx: 'superFx',
      startup: 8, active: 30, recovery: 26, dmg: 0, guard: 'MID',
      superStrike: {
        count: 7, interval: 4, dmg: 54, guard: 'MID',
        hitstun: 36, blockstun: 16, hitstop: 6,
        width: 280, height: 340, yOff: 0, chipRatio: 0.25,
      },
    });
    return m;
  }

  /* ---------- 5. NOVA 星 · 轨道游侠(空中型 / 二段跳) ---------- */
  function novaMoves() {
    const m = buildMoves({
      dmg: 0.86, spd: 1.16, reach: 0.98, hMul: 0.97, hitstopMul: 0.85,
      names: { LP: '星刺', HP: '流陨', LK: '轻跃踢', HK: '环轨斩', JLK: '星羽', JHK: '坠星' },
    });
    // 星矢:极快的轻型弹, 伤害低但能连着放
    m.SP1 = sp({
      id: 'SP1', name: '星矢', cmd: '236P', anim: 'castBolt', fx: 'sparkC',
      startup: 7, active: 2, recovery: 12, dmg: 0, chip: 5, level: 1,
      proj: {
        type: 'star', speed: 16.0, dmg: 42, chip: 6,
        hitstun: 17, blockstun: 12, hitstop: 6, guard: 'MID',
        w: 26, h: 26, yOff: 122, life: 120, level: 1,
      },
    });
    // 轨道跃:垂直上升带判定, 空中还能再出一次
    m.SP2 = sp({
      id: 'SP2', name: '轨道跃', cmd: '623P', anim: 'risingUppercut', fx: 'burstC',
      startup: 3, active: 10, recovery: 18, dmg: 78, level: 2,
      hitstun: 26, blockstun: 12, hitstop: 8,
      hitbox: { x: 2, y: 90, w: 70, h: 124 },
      knockdown: true, invuln: [0, 7],
      vx: [0, '*', 2.0], vy: [0, '*', 19.0], gravity: true,
    });
    // 引力井:自身后跳, 同时把对手拽向自己(逆向位移)
    m.SP3 = sp({
      id: 'SP3', name: '引力井', cmd: '214K', anim: 'shadowEdge', fx: 'sparkC',
      startup: 8, active: 6, recovery: 16, dmg: 30, level: 1,
      hitstun: 24, blockstun: 12, hitstop: 6,
      hitbox: { x: 40, y: 30, w: 240, h: 190 },
      guard: 'THROW', pull: 170, pushback: 0, blockPushback: 0,
      cancel: ['LP', 'HP', 'SP2', 'SU'],
    });
    m.SU = sp({
      id: 'SU', name: '超新星', cmd: '236236P', anim: 'superRain', fx: 'superFx',
      startup: 7, active: 26, recovery: 24, dmg: 0, guard: 'MID',
      superStrike: {
        count: 9, interval: 3, dmg: 34, guard: 'MID',
        hitstun: 26, blockstun: 12, hitstop: 4,
        width: 360, height: 380, yOff: 40, chipRatio: 0.25,
      },
    });
    return m;
  }

  /* ---------- 6. RUE 澜 · 潮汐拳手(连打/多段型) ---------- */
  function rueMoves() {
    const m = buildMoves({
      dmg: 0.9, spd: 1.08, reach: 0.94, hMul: 1.0, hitstopMul: 0.8,
      names: { LP: '浪指', HP: '涌掌', LK: '拍水踢', HK: '潮回旋', THROW: '逆流投' },
    });
    // 潮涌:三段连打, 按住不放会连续命中(真正的"多段")
    m.SP1 = sp({
      id: 'SP1', name: '潮涌', cmd: '236P', anim: 'rushSlash', fx: 'burstC',
      startup: 6, active: 24, recovery: 12, dmg: 34, level: 1,
      hitstun: 20, blockstun: 13, hitstop: 5, blockstop: 4,
      hitbox: { x: 14, y: 76, w: 92, h: 84 },
      rehit: 3, rehitGap: 8, pushback: 1.8, blockPushback: 5,
      vx: [0, '*', 4.0], gravity: false, dashMove: true,
    });
    // 逆流升:上挑后下落, 打中可继续接
    m.SP2 = sp({
      id: 'SP2', name: '逆流升', cmd: '623P', anim: 'risingUppercut', fx: 'burstC',
      startup: 4, active: 8, recovery: 20, dmg: 82, level: 2,
      hitstun: 26, blockstun: 12, hitstop: 8,
      hitbox: { x: 4, y: 84, w: 72, h: 122 },
      knockdown: true, invuln: [0, 6],
      vx: [0, '*', 2.2], vy: [0, '*', 16.5], gravity: true,
    });
    // 漩涡:原地生成吸附漩涡, 多段拉扯(压起身 / 封跳)
    m.SP3 = sp({
      id: 'SP3', name: '漩涡', cmd: '214P', anim: 'castBolt', fx: 'sparkC',
      startup: 9, active: 26, recovery: 12, dmg: 24, level: 1,
      hitstun: 16, blockstun: 13, hitstop: 4, blockstop: 3,
      hitbox: { x: 30, y: 20, w: 130, h: 170 },
      rehit: 5, rehitGap: 6, pull: 46, pushback: 1.2, blockPushback: 3.5,
      cancel: ['SU'],
    });
    // 浪刃:中速水刃,判幅宽,适合在潮涌够不到的距离起手
    m.SP4 = sp({
      id: 'SP4', name: '浪刃', cmd: '一键', anim: 'castBolt', fx: 'sparkC',
      startup: 8, active: 3, recovery: 14, dmg: 0, chip: 6, level: 1,
      proj: {
        type: 'wave', speed: 10.5, dmg: 52, chip: 8,
        hitstun: 20, blockstun: 14, hitstop: 7, guard: 'MID',
        w: 56, h: 44, yOff: 96, life: 150, level: 1,
      },
    });
    m.SU = sp({
      id: 'SU', name: '深渊潮', cmd: '236236P', anim: 'superRain', fx: 'superFx',
      startup: 8, active: 34, recovery: 24, dmg: 0, guard: 'MID',
      superStrike: {
        count: 14, interval: 2, dmg: 21, guard: 'MID',
        hitstun: 24, blockstun: 10, hitstop: 2,
        width: 320, height: 400, yOff: 0, chipRatio: 0.2,
      },
    });
    return m;
  }

  /* ============================================================
     四、角色定义
     build: s=整体高度系数  w=粗细系数  head=头身比
     ============================================================ */
  function charDef(o) {
    const s = o.build.s, w = o.build.w;
    const H = G.HURTBOX_BASE;
    return {
      id: o.id, name: o.name, cn: o.cn, title: o.title, desc: o.desc,
      color: o.color, color2: o.color2, colorDim: o.colorDim,
      hairColor: o.hairColor, skin: o.skin || '#2a3f52',
      hp: o.hp,
      walkF: o.walkF, walkB: o.walkB,
      dashSpeed: o.dashSpeed, dashFrames: o.dashFrames,
      backdashSpeed: o.backdashSpeed, backdashFrames: o.backdashFrames,
      jumpV: o.jumpV, jumpVx: o.jumpVx,
      weight: o.weight, jumpSquat: o.jumpSquat,
      airJumps: o.airJumps || 0,
      build: o.build,
      style: o.style,
      moves: o.moves,
      hurt: {
        stand: { x: Math.round(H.stand.x * w), y: 0, w: Math.round(H.stand.w * w), h: Math.round(H.stand.h * s) },
        crouch: { x: Math.round(H.crouch.x * w), y: 0, w: Math.round(H.crouch.w * w), h: Math.round(H.crouch.h * s) },
        air: { x: Math.round(H.air.x * w), y: 0, w: Math.round(H.air.w * w), h: Math.round(H.air.h * s) },
      },
      cmdTable: o.cmdTable,
      tags: o.tags || [],
    };
  }

  G.HURTBOX_BASE = {
    stand: { x: -30, y: 0, w: 60, h: 188 },
    crouch: { x: -36, y: 0, w: 72, h: 112 },
    air: { x: -28, y: 0, w: 56, h: 150 },
  };

  const CHARS = {};

  /* ---- VOLT ---- */
  CHARS.volt = charDef({
    id: 'volt', name: 'VOLT', cn: '伏特', title: '电光特务',
    desc: '速度最快。电弧弹牵制、雷升无敌反击,靠密集连段滚雪球。',
    color: '#3ef2ff', color2: '#0a86ff', colorDim: '#0b3a52',
    hairColor: '#b9fbff', skin: '#2a3f52',
    hp: 950,
    walkF: 5.6, walkB: 4.6, dashSpeed: 13.5, dashFrames: 11,
    backdashSpeed: 11.5, backdashFrames: 14,
    jumpV: 17.2, jumpVx: 4.6, weight: 0.9, jumpSquat: 3,
    build: { s: 1.0, w: 0.94, head: 1.0 },
    style: { head: 'visor', back: 'antenna', weapon: 'fist', hair: 'spike', chest: 'lines' },
    tags: ['速度', '弹道', '升龙'],
    moves: voltMoves(),
    cmdTable: [
      { cmd: '236+拳 / L', label: '电弧弹(远程)', type: 'proj' },
      { cmd: '623 + 拳', label: '雷升(无敌)', type: 'dp' },
      { cmd: '214 + 脚', label: '电光突', type: 'rush' },
      { cmd: '236236 + 拳', label: '万雷天牢', type: 'super' },
    ],
  });

  /* ---- KAGE ---- */
  CHARS.kage = charDef({
    id: 'kage', name: 'KAGE', cn: '影', title: '影流刺客',
    desc: '中距离爆发。影刃突进、影缝抓投,读对一次就是半条血。',
    color: '#ff3ea5', color2: '#a32bff', colorDim: '#4a0f33',
    hairColor: '#ffb3dd', skin: '#3a2430',
    hp: 1050,
    walkF: 5.1, walkB: 4.2, dashSpeed: 12.4, dashFrames: 11,
    backdashSpeed: 10.6, backdashFrames: 15,
    jumpV: 16.8, jumpVx: 4.2, weight: 1.05, jumpSquat: 3,
    build: { s: 1.02, w: 1.0, head: 1.0 },
    style: { head: 'hood', back: 'scarf', weapon: 'blade', hair: 'long', chest: 'none' },
    tags: ['突进', '指令投', '高伤'],
    moves: kageMoves(),
    cmdTable: [
      { cmd: '236 + 脚', label: '影刃(突进)', type: 'rush' },
      { cmd: '623 + 脚', label: '断空踢(对空)', type: 'dp' },
      { cmd: '214 + 拳', label: '影缝(指令投)', type: 'grab' },
      { cmd: 'L 一键', label: '影针(远程)', type: 'proj' },
      { cmd: '214214 + 拳', label: '暗影领域', type: 'super' },
    ],
  });

  /* ---- AXEL ---- */
  CHARS.axel = charDef({
    id: 'axel', name: 'AXEL', cn: '钢', title: '铁壁重工',
    desc: '慢但硬。震地拳带霸体能硬吃一下,磁力钳把对手拽过来打。',
    color: '#ffb03a', color2: '#ff5a1f', colorDim: '#4a2c08',
    hairColor: '#ffd89a', skin: '#3a3228',
    hp: 1320,
    walkF: 4.0, walkB: 3.4, dashSpeed: 10.5, dashFrames: 13,
    backdashSpeed: 8.6, backdashFrames: 18,
    jumpV: 15.6, jumpVx: 3.4, weight: 1.45, jumpSquat: 5,
    build: { s: 1.08, w: 1.28, head: 1.06 },
    style: { head: 'helm', back: 'plating', weapon: 'gauntlet', hair: 'none', chest: 'vent' },
    tags: ['霸体', '高血量', '拉人'],
    moves: axelMoves(),
    cmdTable: [
      { cmd: '236 + 拳', label: '震地拳(霸体)', type: 'armor' },
      { cmd: '623 + 拳', label: '铁山靠(撞飞)', type: 'rush' },
      { cmd: '214 + 拳', label: '磁力钳(拉近)', type: 'grab' },
      { cmd: 'L 一键', label: '地裂波(远程·下段)', type: 'proj' },
      { cmd: '236236 + 拳', label: '超载爆破', type: 'super' },
    ],
  });

  /* ---- LYRA ---- */
  CHARS.lyra = charDef({
    id: 'lyra', name: 'LYRA', cn: '璃', title: '霜华术士',
    desc: '设置型。慢速霜棱做连段起手,冰镜持续压制,靠封锁推进。',
    color: '#a8e8ff', color2: '#4a7bff', colorDim: '#132a52',
    hairColor: '#e8f9ff', skin: '#33415a',
    hp: 930,
    walkF: 4.8, walkB: 4.1, dashSpeed: 11.0, dashFrames: 12,
    backdashSpeed: 9.8, backdashFrames: 16,
    jumpV: 17.8, jumpVx: 3.8, weight: 0.85, jumpSquat: 4,
    build: { s: 0.99, w: 0.9, head: 0.97 },
    style: { head: 'crown', back: 'cape', weapon: 'staff', hair: 'long', chest: 'lines' },
    tags: ['设置', '牵制', '长硬直'],
    moves: lyraMoves(),
    cmdTable: [
      { cmd: '236+拳 / L', label: '霜棱(远程)', type: 'proj' },
      { cmd: '623 + 拳', label: '寒风升(对空)', type: 'dp' },
      { cmd: '214 + 拳', label: '冰镜(压制)', type: 'set' },
      { cmd: '236236 + 拳', label: '绝对零度', type: 'super' },
    ],
  });

  /* ---- NOVA ---- */
  CHARS.nova = charDef({
    id: 'nova', name: 'NOVA', cn: '星', title: '轨道游侠',
    desc: '唯一能二段跳。星矢连发、引力井拽人,空战压制力最强。',
    color: '#c8ff5a', color2: '#25c47a', colorDim: '#2a4a12',
    hairColor: '#eaffb0', skin: '#2f3a2a',
    hp: 900,
    walkF: 5.4, walkB: 4.4, dashSpeed: 13.0, dashFrames: 10,
    backdashSpeed: 11.2, backdashFrames: 13,
    jumpV: 17.6, jumpVx: 4.8, weight: 0.82, jumpSquat: 3,
    airJumps: 1,
    build: { s: 0.97, w: 0.88, head: 0.96 },
    style: { head: 'halo', back: 'wing', weapon: 'fist', hair: 'bob', chest: 'orb' },
    tags: ['二段跳', '空战', '连射'],
    moves: novaMoves(),
    cmdTable: [
      { cmd: '236+拳 / L', label: '星矢(远程)', type: 'proj' },
      { cmd: '623 + 拳', label: '轨道跃(无敌)', type: 'dp' },
      { cmd: '214 + 脚', label: '引力井(吸人)', type: 'grab' },
      { cmd: '236236 + 拳', label: '超新星', type: 'super' },
    ],
  });

  /* ---- RUE ---- */
  CHARS.rue = charDef({
    id: 'rue', name: 'RUE', cn: '澜', title: '潮汐拳手',
    desc: '多段连打。潮涌三段、漩涡吸附,贴着人打能把对手锁死在角落。',
    color: '#5ad7ff', color2: '#1f6bff', colorDim: '#0e2a4a',
    hairColor: '#bff0ff', skin: '#2a3540',
    hp: 1020,
    walkF: 5.3, walkB: 4.3, dashSpeed: 12.8, dashFrames: 11,
    backdashSpeed: 10.8, backdashFrames: 15,
    jumpV: 17.0, jumpVx: 4.3, weight: 1.0, jumpSquat: 3,
    build: { s: 1.0, w: 1.02, head: 1.0 },
    style: { head: 'band', back: 'ribbon', weapon: 'fist', hair: 'tied', chest: 'none' },
    tags: ['多段', '吸附', '近身'],
    moves: rueMoves(),
    cmdTable: [
      { cmd: '236 + 拳', label: '潮涌(三段)', type: 'multi' },
      { cmd: '623 + 拳', label: '逆流升', type: 'dp' },
      { cmd: '214 + 拳', label: '漩涡(吸附)', type: 'set' },
      { cmd: 'L 一键', label: '浪刃(远程)', type: 'proj' },
      { cmd: '236236 + 拳', label: '深渊潮', type: 'super' },
    ],
  });

  G.CHARS = CHARS;

  /* ============================================================
     世界观 / 剧情 / 连招表 / 开场对话
     ============================================================ */
  G.LORE = {
    title: 'THE RIFT GATE',
    cn: '裂隙之门 · 世界观',
    paras: [
      '2149 年,空间对撞实验失控,一道永不闭合的光痕撕裂了夜空 —— 人们叫它「霓虹裂隙」。',
      '裂隙的能量渗入这座雨城。极少数人因此觉醒,能把自己的意志具现成电光、寒冰、暗影与潮汐 —— 他们被称为「共鸣者」。',
      '地下格斗联盟「RIFT GATE」在废墟中成立。规则只有一条:在擂台上打倒所有对手,胜者可以进入裂隙核心,实现一个愿望。',
      '六名格斗家,六种理由,在同一个雨夜走向了同一座擂台。',
    ],
  };

  G.CHAR_LORE = {
    volt: {
      line: '前企业黑客。当年正是他按下了对撞实验的启动键 —— 为了抹掉污点,也为了赎罪,他重新走进裂隙。',
      goal: '愿望:删除实验记录,让 2149 年的悲剧不再重演。',
    },
    kage: {
      line: '没有档案、没有名字的影流刺客。有人雇他来毁掉联盟,也有人说他就是联盟培养的最后一件武器。',
      goal: '愿望:斩断躲在幕后操纵这一切的那只手。',
    },
    axel: {
      line: '重工集团的保镖。他的家园被裂隙能量污染成禁区,他把自己改造成了能硬吃冲击的钢铁之躯。',
      goal: '愿望:净化家园,让被疏散的人们回家。',
    },
    lyra: {
      line: '裂隙研究所的首席研究员。她比任何人都清楚裂隙终将吞噬整座城市 —— 而上面的人只想独占它。',
      goal: '愿望:用绝对零度冻结裂隙,终结这场闹剧。',
    },
    nova: {
      line: '轨道站「晨昏线」的最后一名住民。联盟垄断了升空权,而她握着一把能撕开大气层的拳头。',
      goal: '愿望:夺回升空权,让所有人都能回到星星身边。',
    },
    rue: {
      line: '港区的老拳手。裂隙事故吞没了他的拳馆和师兄弟,而官方档案里只写了一行:事故,无人幸存。',
      goal: '愿望:让真相浮出水面,哪怕用拳头砸开。',
    },
  };

  /* 每个角色的推荐连招(选人卡片 / 说明页共用) */
  G.COMBOS = {
    volt: ['跳重脚 → 蹲轻拳 → 站重拳 → 雷升', '轻拳 → 重拳 → 超必杀(P)', '电弧弹牵制 → 前冲投技'],
    kage: ['影刃突进 → 蹲轻脚 → 扫堂腿', '影缝抓中 → 超必杀(P)', '影针(L) → 前冲 → 影缚投技'],
    axel: ['震地拳(霸体)对拼 → 超载爆破(P)', '磁力钳拉近 → 重拳 → 铁山靠', '地裂波压制 → 前冲重拳'],
    lyra: ['霜棱 → 前冲蹲轻拳 → 站重拳 → 寒风升', '冰镜封位 → 跳重脚 → 扫堂腿', '轻拳 → 重拳 → 绝对零度(P)'],
    nova: ['跳重脚 → 蹲轻拳 → 站重拳 → 轨道跃', '星矢 → 二段跳 → 空中重脚', '引力井吸中 → 连打 → 超新星(P)'],
    rue: ['轻拳 → 轻拳 → 潮涌三段 → 深渊潮(P)', '漩涡吸附 → 蹲轻脚×2 → 扫堂腿', '浪刃(L) → 前冲 → 三段连打'],
  };

  /* 开场 VS 对话(街机/双人通用,intro 阶段显示) */
  G.BANTER = {
    volt: ['裂隙里没有信号,只有电压。', '你出招的那一帧,我已经看穿了。'],
    kage: ['影子先动,刀后到。', '你逃不开自己的影子。'],
    axel: ['钢筋铁骨,谈判桌上也一样硬。', '我的霸体,是你打不穿的现实。'],
    lyra: ['零度以下,连心跳都会结冰。', '冻结的不止是你,还有你的下一招。'],
    nova: ['轨道已锁定,坠落不可避免。', '从天上看,你只是一粒尘埃。'],
    rue: ['潮水涨起来的时候,谁都挡不住。', '你的节奏?现在是我的了。'],
  };
  G.CHAR_IDS = Object.keys(CHARS);

  /* ============================================================
     五、指令定义(带宽容输入)
     ============================================================ */
  const QCF = [[2, 3, 6], [2, 6], [3, 6]];
  const DP = [[6, 2, 3], [3, 2, 3], [6, 2]];
  const QCB = [[2, 1, 4], [2, 4]];

  G.CMD_DEFS = {
    SP1: { patterns: QCF, kinds: 'p' },
    SP1K: { patterns: QCF, kinds: 'k' },
    SP2: { patterns: DP, kinds: 'p' },
    SP2K: { patterns: DP, kinds: 'k' },
    SP3: { patterns: QCB, kinds: 'k' },
    SP3P: { patterns: QCB, kinds: 'p' },
    SU: { patterns: [[2, 3, 6, 2, 3, 6], [2, 6, 2, 6]], kinds: 'p', cost: 1 },
    SU_ALT: { patterns: [[2, 1, 4, 2, 1, 4], [2, 4, 2, 4]], kinds: 'p', cost: 1 },
    SU_K: { patterns: [[2, 3, 6, 2, 3, 6], [2, 6, 2, 6]], kinds: 'k', cost: 1 },
    SU_KALT: { patterns: [[2, 1, 4, 2, 1, 4], [2, 4, 2, 4]], kinds: 'k', cost: 1 },
  };

  G.CHAR_CMDS = {
    volt: [
      { out: 'SP1', def: 'SP1' },
      { out: 'SP2', def: 'SP2' },
      { out: 'SP3', def: 'SP3' },
      { out: 'SU', def: 'SU' },
    ],
    kage: [
      { out: 'SP1', def: 'SP1K' },
      { out: 'SP2', def: 'SP2K' },
      { out: 'SP3', def: 'SP3P' },
      { out: 'SU', def: 'SU_ALT' },
    ],
    axel: [
      { out: 'SP1', def: 'SP1' },
      { out: 'SP2', def: 'SP2' },
      { out: 'SP3', def: 'SP3P' },
      { out: 'SU', def: 'SU' },
    ],
    lyra: [
      { out: 'SP1', def: 'SP1' },
      { out: 'SP2', def: 'SP2' },
      { out: 'SP3', def: 'SP3P' },
      { out: 'SU', def: 'SU' },
    ],
    nova: [
      { out: 'SP1', def: 'SP1' },
      { out: 'SP2', def: 'SP2' },
      { out: 'SP3', def: 'SP3' },
      { out: 'SU', def: 'SU' },
    ],
    rue: [
      { out: 'SP1', def: 'SP1' },
      { out: 'SP2', def: 'SP2' },
      { out: 'SP3', def: 'SP3P' },
      { out: 'SU', def: 'SU' },
    ],
  };

  /* AI 用:每个角色的指令序列与按键 */
  G.CHAR_AI = {
    volt: { proj: [2, 3, 6], projBtn: 'lp', dp: [6, 2, 3], dpBtn: 'lp', rush: [2, 1, 4], rushBtn: 'lk', superCmd: [2, 3, 6, 2, 3, 6], superBtn: 'lp' },
    kage: { proj: null, dp: [6, 2, 3], dpBtn: 'lk', rush: [2, 3, 6], rushBtn: 'lk', superCmd: [2, 1, 4, 2, 1, 4], superBtn: 'lp' },
    axel: { proj: null, dp: [6, 2, 3], dpBtn: 'lp', rush: [2, 3, 6], rushBtn: 'lp', superCmd: [2, 3, 6, 2, 3, 6], superBtn: 'lp' },
    lyra: { proj: [2, 3, 6], projBtn: 'lp', dp: [6, 2, 3], dpBtn: 'lp', rush: [2, 1, 4], rushBtn: 'lp', superCmd: [2, 3, 6, 2, 3, 6], superBtn: 'lp' },
    nova: { proj: [2, 3, 6], projBtn: 'lp', dp: [6, 2, 3], dpBtn: 'lp', rush: [2, 1, 4], rushBtn: 'lk', superCmd: [2, 3, 6, 2, 3, 6], superBtn: 'lp' },
    rue: { proj: null, dp: [6, 2, 3], dpBtn: 'lp', rush: [2, 3, 6], rushBtn: 'lp', superCmd: [2, 3, 6, 2, 3, 6], superBtn: 'lp' },
  };

  /* 兼容旧接口 */
  G.HURTBOX = G.HURTBOX_BASE;

  /* ============================================================
     六、帧总数缓存
     ============================================================ */
  Object.keys(CHARS).forEach((cid) => {
    const c = CHARS[cid];
    Object.keys(c.moves).forEach((mid) => {
      const m = c.moves[mid];
      m.total = m.startup + m.active + m.recovery;
      m.charId = cid;
      if (!m.cancel) m.cancel = [];
      if (m.level == null) m.level = 0;
      if (m.hitstop == null) m.hitstop = 6;
      if (m.blockPushback == null) m.blockPushback = m.pushback || 4;
      if (m.blockstop == null) m.blockstop = 3;
      if (m.guard == null) m.guard = 'MID';
    });
  });
})();
