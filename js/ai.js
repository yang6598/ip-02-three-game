/* ============================================================
   NEON RIFT — ai.js
   虚拟手柄 + 分级对手 AI
   设计原则:AI 必须"经过输入系统"出手,不能直接调用招式
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;

  class AIPad {
    constructor() {
      this.dir = 5;
      this.dirHist = [];
      for (let i = 0; i < 40; i++) this.dirHist.push(5);
      this.held = { lp: false, hp: false, lk: false, hk: false, sp: false, ex: false, su: false };
      this.pressed = { lp: false, hp: false, lk: false, hk: false, sp: false, ex: false, su: false };
      this.released = { lp: false, hp: false, lk: false, hk: false, sp: false, ex: false, su: false };
      this.buf = [];
      this.frame = 0;
      this.enabled = true;
    }
    setKey() {}
    poll() {} // AI 不需要 poll,由 ai.update 写入

    setDir(d) {
      if (this.dir !== d) {
        // 去掉连续重复,保留切换点
        this.dir = d;
      }
      this.dirHist.push(d);
      if (this.dirHist.length > 40) this.dirHist.shift();
    }
    forceDirHistory(seq) {
      for (let i = 0; i < seq.length; i++) {
        this.dirHist.push(seq[i]);
        if (this.dirHist.length > 40) this.dirHist.shift();
      }
    }
    press(btn) {
      this.pressed[btn] = true;
      this.held[btn] = true;
      this.buf.push({ b: btn, frame: this.frame });
    }
    clearFrame() {
      for (const k in this.pressed) {
        this.released[k] = this.pressed[k] && !this.held[k];
        this.pressed[k] = false;
      }
      this.frame++;
      while (this.buf.length && this.frame - this.buf[0].frame > 20) this.buf.shift();
    }
    releaseAll() {
      for (const k in this.held) this.held[k] = false;
      this.dir = 5;
    }
    recent(b, n) {
      for (let i = this.buf.length - 1; i >= 0; i--) {
        const e = this.buf[i];
        if (this.frame - e.frame > n) break;
        if (e.b === b) return true;
      }
      return false;
    }
    consume(b) {
      const i = this.buf.findIndex((e) => e.b === b);
      if (i >= 0) this.buf.splice(i, 1);
    }
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
          while (i - 1 >= stop && h[i - 1] === h[i]) i--;
        }
        i--;
      }
      return -1;
    }
    /** AI 冲刺由自身决策触发,不靠双击识别 */
    dashTap() {
      return false;
    }
    motionRepeat(dirNum, times, win) {
      win = win || 18;
      const h = this.dirHist;
      const stop = Math.max(0, h.length - win);
      let count = 0,
        prev = -1;
      for (let i = h.length - 1; i >= stop; i--) {
        if (h[i] === dirNum && prev !== dirNum) count++;
        prev = h[i];
      }
      return count >= times;
    }
    reset() {
      this.dir = 5;
      this.dirHist.length = 0;
      for (let i = 0; i < 40; i++) this.dirHist.push(5);
      for (const k in this.held) this.held[k] = false;
      for (const k in this.pressed) this.pressed[k] = false;
      this.buf.length = 0;
    }
  }
  G.AIPad = AIPad;

  /* ---------------- 难度配置 ---------------- */
  const LEVELS = {
    easy: {
      name: '简单',
      react: 22,        // 反应延迟(帧)
      blockRate: 0.28,  // 危险时防御概率
      aggro: 0.38,      // 近身进攻概率
      antiAir: 0.10,
      combo: 0,         // 连段长度
      punish: 0.15,
      specialRate: 0.10,
      jumpRate: 0.10,
      thinkInterval: 14,
      idleRate: 0.22,
    },
    normal: {
      name: '普通',
      react: 14,
      blockRate: 0.56,
      aggro: 0.52,
      antiAir: 0.30,
      combo: 1,
      punish: 0.38,
      specialRate: 0.18,
      jumpRate: 0.12,
      thinkInterval: 10,
      idleRate: 0.10,
    },
    hard: {
      name: '困难',
      react: 8,
      blockRate: 0.80,
      aggro: 0.64,
      antiAir: 0.55,
      combo: 2,
      punish: 0.68,
      specialRate: 0.24,
      jumpRate: 0.10,
      thinkInterval: 7,
      idleRate: 0.04,
    },
    hell: {
      name: '地狱',
      react: 4,
      blockRate: 0.92,
      aggro: 0.74,
      antiAir: 0.78,
      combo: 3,
      punish: 0.88,
      specialRate: 0.30,
      jumpRate: 0.08,
      thinkInterval: 5,
      idleRate: 0.02,
    },
  };
  G.AI_LEVELS = LEVELS;

  class AI {
    constructor(fighter, level) {
      this.f = fighter;
      this.level = LEVELS[level] ? level : 'normal';
      this.cfg = LEVELS[this.level];
      this.pad = new AIPad();
      fighter.pad = this.pad;

      this.thinkTimer = 0;
      this.plan = null;          // {type, frames, btn, dir, motion}
      this.planFrame = 0;
      this.reactBuf = [];        // 延迟队列:{oppSt, oppMoveFrame}
      this.history = [];         // 玩家行为采样
      this.lastOppSt = '';
      this.cooldown = 0;
      this.motionPending = null;
      this.comboQueue = [];
      this.mood = 'neutral';
      this.moodTimer = 0;
      this.idleT = 0;
    }

    reset() {
      this.thinkTimer = 0;
      this.plan = null;
      this.cooldown = 0;
      this.motionPending = null;
      this.comboQueue.length = 0;
      this.mood = 'neutral';
      this.moodTimer = 0;
      this.pad.reset();
    }

    /* ---------------- 感知(带反应延迟) ---------------- */
    sense(opp) {
      this.reactBuf.push({
        x: opp.x,
        y: opp.y,
        st: opp.st,
        move: opp.move ? opp.move.id : null,
        moveFrame: opp.moveFrame,
        facing: opp.facing,
        panim: opp.anim,
        vy: opp.vy,
      });
      // 保持长度 = react + 2
      const maxLen = this.cfg.react + 2;
      while (this.reactBuf.length > maxLen) this.reactBuf.shift();
      return this.reactBuf[0] || this.reactBuf[this.reactBuf.length - 1];
    }

    /* ---------------- 主循环 ---------------- */
    update(dt, opp, sys) {
      const pad = this.pad;
      pad.clearFrame();

      if (!opp || this.f.st === G.ST.KO || this.f.st === G.ST.WIN) {
        pad.releaseAll();
        pad.setDir(5);
        return;
      }

      const seen = this.sense(opp);
      const me = this.f;
      const dist = Math.abs(opp.x - me.x);
      const dirToOpp = opp.x >= me.x ? 1 : -1;
      const relFwd = me.facing; // 面朝方向

      // ---- 处理多帧动作队列(搓招 / 连段输入) ----
      if (this.motionPending) {
        this._stepMotion(dist, dirToOpp, relFwd);
        return;
      }

      // ---- 危险感知:对手正在出招 ----
      const oppAttacking = seen && seen.st === G.ST.ATTACK && seen.move;
      const oppIsActive = oppAttacking && opp.move && seen.moveFrame >= opp.move.startup - 2;

      // 冷却
      if (this.cooldown > 0) this.cooldown--;

      // ---- 防御决策(高优先级,反应延迟后) ----
      if (oppAttacking && dist < 260 && me.canAct) {
        const willBlock = Math.random() < this.cfg.blockRate;
        if (willBlock) {
          // 判断该用什么姿势防
          const mv = opp.move;
          const g = mv ? mv.guard : 'MID';
          let d;
          if (g === 'LOW') d = me.backDown;
          else if (g === 'OVERHEAD') d = me.back;
          else d = Math.random() < 0.3 ? me.backDown : me.back;
          // 投技无法防御 → 尝试跳开
          if (g === 'THROW' && dist < 120) {
            this._startJump(dirToOpp > 0 ? 9 : 7);
            return;
          }
          pad.setDir(d);
          return;
        } else if (this.cfg.punish > Math.random() && me.canAct && dist < 200) {
          // 尝试用无敌技反击
          if (this.cfg.antiAir > Math.random()) {
            this._queueSpecial(this._dragonCmd(), 'lp');
            return;
          }
        }
      }

      // ---- 确反:对手收招 ----
      if (
        oppAttacking &&
        opp.move &&
        seen.moveFrame > opp.move.startup + opp.move.active &&
        dist < 190 &&
        me.canAct &&
        Math.random() < this.cfg.punish
      ) {
        this._queueCombo(dist);
        return;
      }

      // ---- 定期思考 ----
      this.thinkTimer--;
      if (this.thinkTimer <= 0 && me.canAct) {
        this.thinkTimer = this.cfg.thinkInterval + Math.floor(Math.random() * this.cfg.thinkInterval);
        this._think(dist, dirToOpp, opp, seen);
      }

      // ---- 执行计划 ----
      if (this.plan) {
        this._execPlan(dist, dirToOpp, opp);
      } else {
        // 默认:面向对手,轻微调整距离
        if (dist > 380) {
          pad.setDir(relFwd === 1 ? 6 : 4);
        } else if (dist < 110 && Math.random() < 0.02) {
          pad.setDir(relFwd === 1 ? 4 : 6);
        } else {
          pad.setDir(5);
        }
      }
    }

    _think(dist, dirToOpp, opp, seen) {
      const cfg = this.cfg;
      const me = this.f;
      const r = Math.random();

      // 对手在空中 → 对空
      if (seen && seen.y > 30 && dist < 220 && Math.random() < cfg.antiAir) {
        this._queueSpecial(this._dragonCmd(), this._dragonBtn());
        return;
      }

      // 远距离
      if (dist > 400) {
        if (r < cfg.specialRate && this._hasProjectile()) {
          this._doRanged();
        } else if (r < 0.62) {
          this.plan = { type: 'approach', frames: 20 + Math.random() * 20 };
          this.planFrame = 0;
        } else if (r < 0.78) {
          this._startJump(9);
        } else {
          this.plan = { type: 'wait', frames: 16 };
          this.planFrame = 0;
        }
        return;
      }

      // 中距离
      if (dist > 190) {
        if (r < 0.30) {
          this.plan = { type: 'approach', frames: 14 };
          this.planFrame = 0;
        } else if (r < 0.30 + cfg.specialRate * 1.6) {
          // 突进技(每个角色的指令/按键不同)
          const ai = this._charAI();
          this._queueSpecial(ai.rush, ai.rushBtn);
        } else if (r < 0.62) {
          this._startJump(9);
        } else {
          this.plan = { type: 'wait', frames: 12 + Math.random() * 14 };
          this.planFrame = 0;
        }
        return;
      }

      // 近距离(超出手boss攻击距离就先接近,不空挥)
      if (dist > 175) {
        if (r < 0.75) {
          this.plan = { type: 'approach', frames: 16 + Math.random() * 14 };
          this.planFrame = 0;
        } else if (r < 0.85) {
          this._startJump(9);
        } else {
          this.plan = { type: 'wait', frames: 10 };
          this.planFrame = 0;
        }
        return;
      }
      if (r < cfg.aggro) {
        this._queueCombo(dist);
      } else if (r < cfg.aggro + 0.10) {
        // 投技
        this._queueGrab(dist);
      } else if (r < cfg.aggro + 0.22) {
        this.plan = { type: 'retreat', frames: 12 + Math.random() * 12 };
        this.planFrame = 0;
      } else if (r < cfg.aggro + 0.30) {
        this._startJump(9);
      } else {
        this.plan = { type: 'wait', frames: 10 + Math.random() * 16 };
        this.planFrame = 0;
      }
    }

    _execPlan(dist, dirToOpp, opp) {
      const p = this.plan;
      const pad = this.pad;
      const me = this.f;
      p.frames--;
      if (p.frames <= 0) {
        this.plan = null;
        pad.setDir(5);
        return;
      }
      if (p.type === 'approach') {
        pad.setDir(me.facing === 1 ? 6 : 4);
        // 靠近到一定距离后停下,准备出招
        if (dist < 165) {
          this.plan = null;
          this.thinkTimer = 0;
          pad.setDir(5);
        }
      } else if (p.type === 'retreat') {
        pad.setDir(me.facing === 1 ? 4 : 6);
      } else if (p.type === 'wait') {
        pad.setDir(5);
        // 等待时偶尔蹲一下,表现"思考"
        if (p.frames % 24 < 6) pad.setDir(me.facing === 1 ? 4 : 6);
      }
    }

    /* ---------------- 出招:普通连段 ---------------- */
    _queueCombo(dist) {
      const me = this.f;
      const cfg = this.cfg;
      const steps = [];
      // 起手:近用轻攻击,远用重攻击
      if (dist < 120) {
        steps.push({ btn: Math.random() < 0.55 ? 'lk' : 'lp', dir: 5, wait: 0 });
      } else if (dist < 170) {
        steps.push({ btn: 'hk', dir: 5, wait: 0 });
      } else {
        steps.push({ btn: 'hp', dir: 5, wait: 0 });
        steps.push({ btn: 'hk', dir: 5, wait: 0 });
      }

      // 追加连段(按难度)
      const extra = cfg.combo;
      if (extra >= 1) steps.push({ btn: 'hp', dir: 5, wait: 0 });
      if (extra >= 2) {
        steps.push({ btn: 'lk', dir: 5, wait: 0 });
        steps.push({ btn: 'hk', dir: 5, wait: 0 });
      }
      if (extra >= 3) {
        // 收尾:必杀 / 超必杀
        if (this.f.meter >= 100 && Math.random() < 0.6) {
          steps.push({ cmd: this._superCmd(), btn: this._superBtn(), wait: 0 });
        } else {
          steps.push({ cmd: this._dragonCmd(), btn: this._dragonBtn(), wait: 0 });
        }
      }

      this.comboQueue = steps;
      this._nextComboStep();
    }

    _nextComboStep() {
      if (!this.comboQueue.length) return;
      const s = this.comboQueue.shift();
      if (s.cmd) {
        this._queueSpecial(s.cmd, s.btn);
        this.comboQueue.length = 0;
      } else {
        this.pad.setDir(s.dir || 5);
        this.pad.press(s.btn);
        this.cooldown = 2;
      }
    }

    _queueGrab(dist) {
      if (dist > 110) {
        this.plan = { type: 'approach', frames: 10 };
        this.planFrame = 0;
        return;
      }
      const pad = this.pad;
      const me = this.f;
      pad.setDir(me.facing === 1 ? 6 : 4);
      pad.press('lp');
      pad.press('lk');
      this.cooldown = 20;
    }

    /* ---------------- 出招:必杀(模拟搓招) ---------------- */
    _queueSpecial(motion, btn) {
      this.motionPending = { motion, btn, i: 0, hold: 0 };
    }

    _stepMotion(dist, dirToOpp, relFwd) {
      const pad = this.pad;
      const mp = this.motionPending;
      if (!mp) return;
      // 每个方向停留 2 帧,保证能识别
      const seq = [];
      for (let i = 0; i < mp.motion.length; i++) {
        const d = mp.motion[i];
        const real = this._mirrorDir(d);
        seq.push(real, real);
      }
      // 一次性推入历史 + 当前方向
      if (mp.i === 0) {
        for (let i = 0; i < seq.length - 1; i++) {
          pad.dirHist.push(seq[i]);
          if (pad.dirHist.length > 40) pad.dirHist.shift();
        }
      }
      mp.i++;
      const cur = seq[seq.length - 1];
      pad.setDir(cur);

      if (mp.i >= 2) {
        // 方向已到位 → 按键
        pad.press(mp.btn);
        this.motionPending = null;
        this.cooldown = 10;
      }
    }

    // 数字键盘方向按当前面向镜像
    _mirrorDir(d) {
      if (this.f.facing === 1) return d;
      const map = { 1: 3, 2: 2, 3: 1, 4: 6, 6: 4, 7: 9, 9: 7, 8: 8, 5: 5 };
      return map[d] || d;
    }

    _charAI() {
      return G.CHAR_AI[this.f.charId] || G.CHAR_AI.volt;
    }
    _dragonCmd() {
      return this._charAI().dp;
    }
    _dragonBtn() {
      return this._charAI().dpBtn;
    }
    _superCmd() {
      return this._charAI().superCmd;
    }
    _superBtn() {
      return this._charAI().superBtn;
    }
    _hasProjectile() {
      return !!this._rangedInfo();
    }
    /** 远程手段:返回 { direct:true } 表示用一键键直发 */
    _rangedInfo() {
      const mv = this.f.char.moves;
      if (mv.SP1 && mv.SP1.proj) return { direct: false };
      if (mv.SP4) return { direct: true };
      return null;
    }
    /** 出远程 */
    _doRanged() {
      const info = this._rangedInfo();
      if (!info) return;
      if (info.direct) {
        this.pad.press('ex');
        this.cooldown = 22;
      } else {
        const ai = this._charAI();
        this._queueSpecial(ai.proj, ai.projBtn);
      }
    }

    _startJump(dirNum) {
      const real = this._mirrorDir(dirNum);
      this.pad.setDir(real);
      this.cooldown = 14;
    }
  }

  G.AI = AI;

  /* ============================================================
     训练模式假人:行为固定,方便练连段
     ============================================================ */
  class Dummy {
    constructor(fighter, mode) {
      this.f = fighter;
      this.mode = mode || 'stand'; // stand | crouch | block | blockAll | counter | jump
      this.pad = new AIPad();
      fighter.pad = this.pad;
      this.timer = 0;
    }
    setMode(m) {
      this.mode = m;
      this.timer = 0;
    }
    reset() {
      this.pad.reset();
      this.timer = 0;
    }
    update(dt, opp, sys) {
      const pad = this.pad;
      pad.clearFrame();
      const me = this.f;
      if (!opp) {
        pad.setDir(5);
        return;
      }
      const dirToOpp = opp.x >= me.x ? 1 : -1;
      const facing = me.facing;
      const back = facing === 1 ? 4 : 6;
      const fwd = facing === 1 ? 6 : 4;
      const backDown = facing === 1 ? 1 : 3;

      // 面向对手
      if (me.canAct) me.facing = dirToOpp;

      const oppAttacking = opp.st === G.ST.ATTACK && opp.move;
      this.timer++;

      switch (this.mode) {
        case 'stand':
          pad.setDir(5);
          break;
        case 'crouch':
          pad.setDir(2);
          break;
        case 'block':
          pad.setDir(oppAttacking ? back : 5);
          break;
        case 'blockAll':
          pad.setDir(oppAttacking ? back : 5);
          break;
        case 'crouchBlock':
          pad.setDir(oppAttacking ? backDown : 2);
          break;
        case 'jump':
          pad.setDir(5);
          if (this.timer % 40 === 0 && me.canAct) pad.setDir(facing === 1 ? 9 : 7);
          break;
        case 'counter':
          if (oppAttacking && me.canAct) {
            pad.setDir(fwd);
            pad.press('hp');
          } else {
            pad.setDir(5);
          }
          break;
        case 'walk':
          pad.setDir(this.timer % 60 < 30 ? fwd : back);
          break;
      }
    }
  }
  G.Dummy = Dummy;
})();
