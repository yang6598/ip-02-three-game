/* ============================================================
   NEON RIFT — fighter.js
   角色状态机 / 物理 / 判定盒 / 取消系统 / 连段与伤害递减
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const CFG = G.CFG;

  /* 超必杀演出类型:决定判定段调用哪套专属特效 */
  const SUPER_KIND = {
    volt: 'storm',
    kage: 'shadow',
    axel: 'quake',
    lyra: 'frost',
    nova: 'meteor',
    rue: 'tide',
  };

  const ST = (G.ST = {
    IDLE: 'idle',
    WALK_F: 'walkF',
    WALK_B: 'walkB',
    CROUCH: 'crouch',
    JUMP_SQUAT: 'jumpSquat',
    AIR: 'air',
    LAND: 'land',
    ATTACK: 'attack',
    BLOCK: 'block',
    HIT: 'hit',
    HIT_AIR: 'hitAir',
    KNOCKDOWN: 'knockdown',
    WAKEUP: 'wakeup',
    DASH_F: 'dashF',
    DASH_B: 'dashB',
    THROWN: 'thrown',
    SUPER: 'super',
    WIN: 'win',
    KO: 'ko',
    INTRO: 'intro',
  });

  // 伤害递减表(连段第 n 段的倍率)
  const COMBO_SCALE = [1, 0.92, 0.85, 0.78, 0.72, 0.67, 0.62, 0.58, 0.54, 0.5, 0.46, 0.43, 0.4, 0.37, 0.35];

  const PUSH_W = 52;

  class Projectile {
    constructor(owner, def, x, y, dir) {
      this.owner = owner;
      this.def = def;
      this.x = x;
      this.y = y;
      this.dir = dir;
      this.vx = def.speed * dir;
      this.life = def.life || 150;
      this.dead = false;
      this.t = 0;
      this.hitOnce = false;
      this.w = def.w;
      this.h = def.h;
    }
    box() {
      return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
    }
    update() {
      this.x += this.vx;
      this.t++;
      this.life--;
      if (this.life <= 0) this.dead = true;
      if (Math.abs(this.x) > CFG.STAGE_HALF + 200) this.dead = true;
    }
  }
  G.Projectile = Projectile;

  class Fighter {
    constructor(charId, padRef, side, x, facing) {
      this.charId = charId;
      this.char = G.CHARS[charId];
      this.pad = padRef;
      this.side = side; // 1 = P1, 2 = P2
      this.x = x;
      this.y = 0;
      this.vx = 0;
      this.vy = 0;
      this.facing = facing;

      this.maxHp = this.char.hp;
      this.hp = this.char.hp;
      this.meter = 0; // 0 ~ 300(3 格)

      this.st = ST.IDLE;
      this.stFrame = 0;
      this.anim = 'idle';
      this.animFrame = 0;
      this.animTotal = 100;
      this.stunCrouch = false;

      this.move = null;
      this.moveFrame = 0;
      this.moveHitDone = false;
      this.hitConfirmed = false; // 本招是否已命中(用于取消)
      this.blockedConfirmed = false;

      this.hitstop = 0;
      this.invuln = 0;
      this.stunTimer = 0;

      this.combo = 0;
      this.comboDmg = 0;
      this.comboTimer = 0;
      this.comboShown = 0;

      this.hitboxes = [];
      this.hurtbox = null;

      this.trail = new G.Trail();
      this.ghostTimer = 0;

      this.hasJumped = false;
      this.airAttackUsed = false;
      this.jumpDir = 0;
      this.airJumpsLeft = this.char.airJumps || 0;
      this.shortHop = false;

      this._rehitCount = 0;
      this.armorFlash = 0;
      this.lastCancel = '';

      this.projectiles = [];
      this.superTimer = 0;
      this.superTick = 0;
      this.superHitCount = 0;
      this.superActive = false;

      this.flashTimer = 0;
      this.dizzy = 0;

      this.roundWins = 0;
      this.lastHitBy = null;

      // 训练模式统计
      this.frameAdvantage = 0;
      this.lastMoveName = '';

      this.walkPhase = 0;
      this.shakeOffset = 0;
      this.knockbackVx = 0;
      this._hitLock = false;
    }

    /* ---------------- 便捷查询 ---------------- */
    get fwd() {
      return this.facing === 1 ? 6 : 4;
    }
    get back() {
      return this.facing === 1 ? 4 : 6;
    }
    get fwdDown() {
      return this.facing === 1 ? 3 : 1;
    }
    get backDown() {
      return this.facing === 1 ? 1 : 3;
    }
    get isAir() {
      return this.y > 0.5 || this.st === ST.AIR || this.st === ST.HIT_AIR;
    }
    get canAct() {
      return (
        this.st !== ST.ATTACK &&
        this.st !== ST.HIT &&
        this.st !== ST.HIT_AIR &&
        this.st !== ST.KNOCKDOWN &&
        this.st !== ST.WAKEUP &&
        this.st !== ST.THROWN &&
        this.st !== ST.KO &&
        this.st !== ST.WIN &&
        this.st !== ST.SUPER &&
        this.st !== ST.LAND &&
        this.st !== ST.JUMP_SQUAT &&
        this.hitstop === 0
      );
    }
    get alive() {
      return this.hp > 0;
    }

    /* ---------------- 输入意图解析 ---------------- */
    /** 返回 {hi, lo, crouch, backward, forward, up, down} */
    readDir() {
      const d = this.pad.dir;
      return {
        up: d === 7 || d === 8 || d === 9,
        down: d === 1 || d === 2 || d === 3,
        back: d === this.back || d === this.backDown || (this.facing === 1 ? d === 7 : d === 9),
        forward: d === this.fwd || d === this.fwdDown,
        crouchBack: d === this.backDown,
        crouch: d === 1 || d === 2 || d === 3,
      };
    }

    guardType() {
      if (this.isAir) return 'none';
      const d = this.pad.dir;
      if (d === this.backDown) return 'crouch';
      if (d === this.back) return 'stand';
      // 7/9 方向:上后 = 站防(但会跳)
      return 'none';
    }

    /* ---------------- 主更新 ---------------- */
    update(opp, sys) {
      if (this.hitstop > 0) {
        this.hitstop--;
        this.shakeOffset = (Math.random() - 0.5) * 6;
        return;
      }
      this.stFrame++;
      this.animFrame++;
      if (this.invuln > 0) this.invuln--;
      if (this.flashTimer > 0) this.flashTimer--;
      if (this.armorFlash > 0) this.armorFlash--;
      if (this.comboTimer > 0) {
        this.comboTimer--;
        if (this.comboTimer === 0) {
          this.combo = 0;
          this.comboDmg = 0;
        }
      }
      if (this.dizzy > 0) this.dizzy--;

      this.shakeOffset *= 0.6;

      if (this.st === ST.KO) {
        this._physics(opp);
        return;
      }

      // 面向:不在攻击/硬直时朝向对手
      if (
        opp &&
        (this.st === ST.IDLE || this.st === ST.WALK_F || this.st === ST.WALK_B ||
          this.st === ST.CROUCH || this.st === ST.BLOCK)
      ) {
        this.facing = opp.x >= this.x ? 1 : -1;
      }

      switch (this.st) {
        case ST.IDLE:
        case ST.WALK_F:
        case ST.WALK_B:
        case ST.CROUCH:
        case ST.BLOCK:
          this._ground(opp, sys);
          break;
        case ST.JUMP_SQUAT:
          this._jumpSquat(opp, sys);
          break;
        case ST.AIR:
        case ST.HIT_AIR:
          this._air(opp, sys);
          break;
        case ST.LAND:
          if (this.stFrame >= 5) this._toIdle();
          break;
        case ST.ATTACK:
          this._attack(opp, sys);
          break;
        case ST.SUPER:
          this._super(opp, sys);
          break;
        case ST.HIT:
          this._hitstun(opp, sys);
          break;
        case ST.KNOCKDOWN:
          this._knockdown(opp, sys);
          break;
        case ST.WAKEUP:
          if (this.stFrame >= 18) this._toIdle();
          else if (this.stFrame < 10) this.invuln = Math.max(this.invuln, 1);
          break;
        case ST.DASH_F:
          this._dash(opp, sys, 1);
          break;
        case ST.DASH_B:
          this._dash(opp, sys, -1);
          break;
        case ST.WIN:
        case ST.INTRO:
        case ST.THROWN:
          break;
      }

      this._physics(opp);
      this._updateBoxes();
      this._updateAnim();

      // 残影
      if (this.st === ST.DASH_F || this.st === ST.ATTACK && this.move && this.move.level >= 2) {
        this.ghostTimer++;
        if (this.ghostTimer % 2 === 0) {
          const pose = G.Rig.poseFor(this.char, this.anim, this.animFrame, this.animTotal, sys.gf);
          this.trail.push(pose, this.x, this.y, this.facing);
        }
      }
      this.trail.update(1 / 60);
    }

    _updateAnim() {
      if (this.st === ST.ATTACK) {
        if (this.move) {
          this.anim = this.move.anim;
          this.animFrame = this.moveFrame;
          this.animTotal = this.move.total;
        }
      } else if (this.st === ST.SUPER) {
        this.anim = (this.move && this.move.anim) || 'superRain';
        this.animFrame = this.superTimer;
        this.animTotal = this.move ? this.move.total : 70;
      } else if (this.st === ST.HIT) {
        this.anim = this.stunCrouch ? 'hitCrouch' : 'hitStand';
        this.animFrame = this.stunTimer - this.stFrame;
        this.animTotal = this.stunTimer;
      } else if (this.st === ST.HIT_AIR) {
        this.anim = 'hitAir';
        this.animFrame = 4;
        this.animTotal = 10;
      } else if (this.st === ST.KNOCKDOWN) {
        this.anim = 'knockdown';
        this.animFrame = Math.min(this.stFrame, 30);
        this.animTotal = 30;
      } else if (this.st === ST.WAKEUP) {
        this.anim = 'wakeup';
        this.animFrame = this.stFrame;
        this.animTotal = 18;
      } else if (this.st === ST.LAND) {
        this.anim = 'land';
        this.animFrame = this.stFrame;
        this.animTotal = 6;
      } else if (this.st === ST.JUMP_SQUAT) {
        this.anim = 'land';
        this.animFrame = 3;
        this.animTotal = 6;
      } else if (this.st === ST.AIR) {
        this.anim = this.vy > 1 ? 'jumpUp' : 'jumpFall';
        this.animFrame = 5;
        this.animTotal = 10;
      } else if (this.st === ST.DASH_F) {
        this.anim = 'dashF';
      } else if (this.st === ST.DASH_B) {
        this.anim = 'dashB';
      } else if (this.st === ST.WIN) {
        this.anim = 'win';
        this.animFrame = Math.min(this.stFrame, 60);
        this.animTotal = 60;
      } else if (this.st === ST.KO) {
        this.anim = 'ko';
        this.animFrame = Math.min(this.stFrame, 40);
        this.animTotal = 40;
      } else if (this.st === ST.CROUCH || this.st === ST.BLOCK) {
        this.anim = this.st === ST.CROUCH ? 'crouch' : 'blockCrouch';
        this.animFrame = 4;
        this.animTotal = 8;
      } else if (this.st === ST.WALK_B) {
        this.anim = 'walkB';
      } else if (this.st === ST.WALK_F) {
        this.anim = 'walkF';
      } else {
        this.anim = 'idle';
      }
    }

    _toIdle() {
      this.st = ST.IDLE;
      this.stFrame = 0;
      this.move = null;
      this.moveFrame = 0;
      this.hitboxes.length = 0;
      this.vx = 0;
    }

    /* ============================================================
       地面行动
       ============================================================ */
    _ground(opp, sys) {
      const pad = this.pad;
      const dir = this.readDir();

      // ---- 尝试出招(优先级:超必杀 > 必杀 > 投技 > 普通技)----
      if (this._trySpecial(opp, sys)) return;
      if (this._tryNormal(opp, sys)) return;

      // ---- 跳跃 ----
      if (dir.up) {
        this._startJump(opp, sys, dir);
        return;
      }

      // ---- 冲刺(双击前)----
      if (dir.forward && pad.dashTap(this.fwd, 15) && this.stFrame > 3) {
        this._startDash(1);
        return;
      }
      if (dir.back && pad.dashTap(this.back, 15) && this.stFrame > 3) {
        this._startDash(-1);
        return;
      }

      // ---- 移动 ----
      if (dir.crouchBack) {
        this.st = ST.BLOCK;
        this.vx = 0;
        this.anim = 'blockCrouch';
      } else if (dir.back) {
        this.st = ST.WALK_B;
        this.vx = -this.char.walkB * this.facing;
        this.anim = opp && opp.st === ST.ATTACK ? 'blockStand' : 'walkB';
        if (opp && opp.st === ST.ATTACK) this.vx *= 0.45;
      } else if (dir.crouch) {
        this.st = ST.CROUCH;
        this.vx = 0;
        this.anim = 'crouch';
      } else if (dir.forward) {
        this.st = ST.WALK_F;
        this.vx = this.char.walkF * this.facing;
        this.anim = 'walkF';
      } else {
        this.st = ST.IDLE;
        this.vx = 0;
        this.anim = 'idle';
      }
    }

    /* ---------------- 普通技 ---------------- */
    _ok(move, allow) {
      return !!move && (!allow || allow.indexOf(move.id) >= 0);
    }

    _tryNormal(opp, sys, allow) {
      const pad = this.pad;
      const mv = this.char.moves;
      const dir = this.readDir();
      // 取消窗口内放宽到最近 5 帧(玩家通常在收招前就按键了)
      const hit = (b) => (allow ? pad.pressed[b] || pad.recent(b, 5) : pad.pressed[b]);

      // 投技:LP + LK 同时
      if (this._ok(mv.THROW, allow) && pad.recent('lp', 3) && pad.recent('lk', 3)) {
        if (this._startMove(mv.THROW, sys)) {
          pad.consume('lp');
          pad.consume('lk');
          return true;
        }
      }

      let target = null;
      if (dir.down) {
        if (hit('lp') || hit('hp')) target = mv.CLP;
        else if (hit('lk')) target = mv.CLK;
        else if (hit('hk')) target = mv.CHK;
      } else {
        if (hit('lp')) target = mv.LP;
        else if (hit('hp')) target = mv.HP;
        else if (hit('lk')) target = mv.LK;
        else if (hit('hk')) target = mv.HK;
      }
      if (target && this._ok(target, allow)) {
        if (allow) {
          pad.consume('lp'); pad.consume('hp'); pad.consume('lk'); pad.consume('hk');
          this.lastCancel = target.id;
        }
        return this._startMove(target, sys);
      }
      return false;
    }

    /* ---------------- 一键出招(KOF 简易输入) ---------------- */
    /** 该角色的远程技:优先 SP4,没有则用带弹道的 SP1 */
    rangedMove() {
      const mv = this.char.moves;
      if (mv.SP4) return mv.SP4;
      if (mv.SP1 && mv.SP1.proj) return mv.SP1;
      return null;
    }

    /** L = 远程弹 / O = 招牌必杀,不需要搓招 */
    _tryDirect(sys) {
      const pad = this.pad;
      if (!pad) return false;
      if (pad.recent('ex', 2)) {
        const r = this.rangedMove();
        if (r) {
          pad.consume('ex');
          return this._startMove(r, sys);
        }
      }
      if (pad.recent('sp', 2)) {
        const m = this.char.moves.SP1;
        if (m) {
          pad.consume('sp');
          return this._startMove(m, sys);
        }
      }
      return false;
    }

    /* ---------------- 必杀技 ---------------- */
    _trySpecial(opp, sys, allow) {
      const pad = this.pad;
      const cmds = G.CHAR_CMDS[this.charId] || [];
      const pPressed = pad.recent('lp', 2) || pad.recent('hp', 2) || (allow && (pad.recent('lp', 6) || pad.recent('hp', 6)));
      const kPressed = pad.recent('lk', 2) || pad.recent('hk', 2) || (allow && (pad.recent('lk', 6) || pad.recent('hk', 6)));
      const suPressed = pad.recent('su', 2);

      const matchMotion = (def, win) => {
        const pats = def.patterns || (def.motion ? [def.motion] : []);
        for (let i = 0; i < pats.length; i++) {
          if (pad.motion(pats[i], win) >= 0) return true;
        }
        return false;
      };

      // 一键出招(不参与取消,避免和连段抢输入)
      if (!allow && this._tryDirect(sys)) return true;

      // 超必杀:两条指令,或直接按超必杀键
      if (!allow || allow.indexOf('SU') >= 0) {
        for (let i = 0; i < cmds.length; i++) {
          const c = cmds[i];
          if (c.out !== 'SU') continue;
          const def = G.CMD_DEFS[c.def];
          if (!def) continue;
          if (this.meter < def.cost * 100) continue;
          const canP = def.kinds === 'p' ? pPressed : kPressed;
          if (!canP && !suPressed) continue;
          if (suPressed || matchMotion(def, 24)) {
            pad.consume('su');
            pad.consume('lp'); pad.consume('hp');
            return this._startSuper(this.char.moves.SU, sys);
          }
        }
      }

      // 普通必杀
      for (let i = 0; i < cmds.length; i++) {
        const c = cmds[i];
        if (c.out === 'SU') continue;
        const def = G.CMD_DEFS[c.def];
        if (!def) continue;
        const isP = def.kinds === 'p';
        if (isP ? !pPressed : !kPressed) continue;
        if (!matchMotion(def, allow ? 20 : 16)) continue;
        const m = this.char.moves[c.out];
        if (!m) continue;
        if (allow && allow.indexOf(c.out) < 0) continue;
        pad.consume('lp'); pad.consume('hp'); pad.consume('lk'); pad.consume('hk');
        if (allow) this.lastCancel = c.out;
        return this._startMove(m, sys);
      }
      return false;
    }

    /* ---------------- 起手 ---------------- */
    _startMove(move, sys) {
      if (!move) return false;
      this.st = ST.ATTACK;
      this.stFrame = 0;
      this.move = move;
      this.moveFrame = 0;
      this.moveHitDone = false;
      this.hitConfirmed = false;
      this.blockedConfirmed = false;
      this._rehitCount = 0;
      this.lastMoveName = move.name;
      this.anim = move.anim;
      this.animFrame = 0;
      this.animTotal = move.total;
      this.hitboxes.length = 0;

      // 位移
      if (move.vx != null) {
        const v = Array.isArray(move.vx) ? move.vx[move.vx.length - 1] : move.vx;
        this.vx = v * this.facing;
      }
      if (move.vy != null) {
        const v = Array.isArray(move.vy) ? move.vy[move.vy.length - 1] : move.vy;
        this.vy = v;
        this.y = Math.max(this.y, 1);
      }
      if (move.invuln && move.invuln[1] > 0) this.invuln = Math.max(this.invuln, move.invuln[1]);

      G.SFX.play(move.sfxWhiff || 'whiff_light', 0.9);
      return true;
    }

    _startSuper(move, sys) {
      if (!move) return false;
      this.meter -= move.meterCost * 100;
      if (this.meter < 0) this.meter = 0;
      this.st = ST.SUPER;
      this.stFrame = 0;
      this.move = move;
      this.superTimer = 0;
      this.superTick = 0;
      this.superHitCount = 0;
      this.superActive = false;
      this.hitboxes.length = 0;
      this.vx = 0;
      this.invuln = move.startup + 6;
      sys.startSuperFreeze(this, 26);
      G.SFX.play('super', 1);
      G.FX.ring(this.x, this.y + 100, this.char.color, 10, 220, 30);
      return true;
    }

    _startJump(opp, sys, dir) {
      this.st = ST.JUMP_SQUAT;
      this.stFrame = 0;
      this.jumpDir = dir.forward ? 1 : dir.back ? -1 : 0;
      this.hasJumped = false;
      this.airAttackUsed = false;
    }

    _jumpSquat(opp, sys) {
      if (this.stFrame >= this.char.jumpSquat) {
        this.st = ST.AIR;
        this.stFrame = 0;
        // KOF 小跳:跳前松开「上」= 小跳(低空快攻),一直按住 = 大跳
        const pad = this.pad;
        const stillUp = !!pad && (pad.dir === 7 || pad.dir === 8 || pad.dir === 9);
        this.shortHop = !stillUp;
        const hMul = this.shortHop ? 0.74 : 1;
        this.vy = this.char.jumpV * hMul;
        const jd = this.jumpDir;
        this.vx = jd === 0 ? 0 : this.char.jumpVx * jd * this.facing * (this.shortHop ? 1.15 : 1);
        this.y = Math.max(this.y, 1);
        this.hasJumped = true;
        G.SFX.play('jump', this.shortHop ? 0.55 : 0.7);
        G.FX.dust(this.x, 0, -this.facing, this.shortHop ? 3 : 5);
      }
    }

    _air(opp, sys) {
      const pad = this.pad;

      // ---- 二段跳(NOVA 专有) ----
      if (this.st === ST.AIR && this.char.airJumps && this.airJumpsLeft > 0 && pad.pressed.up) {
        this.airJumpsLeft--;
        this.vy = this.char.jumpV * 0.94;
        this.vx = this.jumpDir === 0 ? this.vx * 0.4 : this.char.jumpVx * this.jumpDir * this.facing;
        this.airAttackUsed = false;
        this.hasJumped = true;
        G.SFX.play('jump', 0.85);
        G.FX.ring(this.x, this.y + 24, this.char.color, 10, 74, 16);
        G.FX.dust(this.x, this.y, 0, 6);
      }

      // 空中远程(一键 L):从空中也能牵制,落地前不受限制
      if (this.st === ST.AIR && !this.airAttackUsed && pad.recent('ex', 2)) {
        if (this._tryDirect(sys)) {
          this.airAttackUsed = true;
          return;
        }
      }

      // 空中攻击
      if (this.st === ST.AIR && !this.airAttackUsed) {
        const mv = this.char.moves;
        let target = null;
        if (pad.pressed.lk || pad.pressed.hk) target = pad.pressed.hk ? mv.JHK : mv.JLK;
        else if (pad.pressed.lp || pad.pressed.hp) target = pad.pressed.hp ? mv.JHK : mv.JLK;
        if (target) {
          this.airAttackUsed = true;
          this.st = ST.ATTACK;
          this.stFrame = 0;
          this.move = target;
          this.moveFrame = 0;
          this.moveHitDone = false;
          this.hitConfirmed = false;
          this._rehitCount = 0;
          this.anim = target.anim;
          this.animTotal = target.total;
          G.SFX.play('whiff_light', 0.7);
          return;
        }
      }
    }

    _startDash(direction) {
      this.st = direction > 0 ? ST.DASH_F : ST.DASH_B;
      this.stFrame = 0;
      this.vx = (direction > 0 ? this.char.dashSpeed : -this.char.backdashSpeed) * this.facing;
      if (direction < 0) this.invuln = Math.max(this.invuln, 6);
      G.SFX.play('dash', 0.8);
      G.FX.dust(this.x, 0, -this.facing * direction, 6);
    }

    _dash(opp, sys, direction) {
      const frames = direction > 0 ? this.char.dashFrames : this.char.backdashFrames;
      this.vx *= 0.88;
      if (this.stFrame >= frames) this._toIdle();
      // 冲刺可取消为攻击
      if (direction > 0 && this.stFrame > 2) {
        if (this._tryNormal(opp, sys)) return;
        if (this._trySpecial(opp, sys)) return;
      }
    }

    /* ============================================================
       攻击推进
       ============================================================ */
    _attack(opp, sys) {
      const m = this.move;
      if (!m) {
        this._toIdle();
        return;
      }
      this.moveFrame++;
      this.animFrame = this.moveFrame;

      // 位移衰减(突进技)
      if (m.dashMove) {
        if (this.moveFrame > m.startup + m.active) this.vx *= 0.82;
      } else {
        this.vx *= 0.86;
      }

      // 投射物
      if (m.proj && this.moveFrame === m.startup) {
        const pd = m.proj;
        const p = new Projectile(this, pd, this.x + 40 * this.facing, pd.yOff, this.facing);
        this.projectiles.push(p);
        G.FX.ring(this.x + 40 * this.facing, pd.yOff, this.char.color, 8, 46, 12);
      }

      // 判定盒
      this.hitboxes.length = 0;
      if (this.moveFrame >= m.startup && this.moveFrame < m.startup + m.active) {
        if (m.hitbox) this.hitboxes.push(this._worldBox(m.hitbox));
      }

      // 多段判定:每隔 rehitGap 帧重置一次命中标记
      if (m.rehit && m.rehitGap && this.moveFrame > m.startup) {
        const k = Math.floor((this.moveFrame - m.startup) / m.rehitGap);
        if (k > this._rehitCount && k < m.rehit + 1) {
          this._rehitCount = k;
          this.moveHitDone = false;
        }
      }

      // ---- 取消:判定结束后且已命中/被防,可取消到 cancel 列表 ----
      if (
        m.cancel && m.cancel.length &&
        this.moveFrame >= m.startup + m.active &&
        this.moveFrame < m.total &&
        (this.hitConfirmed || this.blockedConfirmed)
      ) {
        if (this._trySpecial(opp, sys, m.cancel)) return;
        if (this._tryNormal(opp, sys, m.cancel)) return;
      }

      // 结束
      if (this.moveFrame >= m.total) {
        if (this.y > 0.5) {
          this.st = ST.AIR;
          this.stFrame = 0;
          this.move = null;
          this.hitboxes.length = 0;
        } else {
          this._toIdle();
        }
      }
    }

    _worldBox(b) {
      const x = this.facing === 1 ? this.x + b.x : this.x - b.x - b.w;
      return { x, y: this.y + b.y, w: b.w, h: b.h };
    }

    /* ============================================================
       超必杀
       ============================================================ */
    _super(opp, sys) {
      const m = this.move;
      if (!m) {
        this._toIdle();
        return;
      }
      this.superTimer++;
      this.animFrame = this.superTimer;
      this.vx *= 0.9;

      const st = m.superStrike;
      if (!st) {
        if (this.superTimer >= m.total) this._toIdle();
        return;
      }

      // 起手阶段蓄力特效
      if (this.superTimer < m.startup) {
        if (this.superTimer % 2 === 0) {
          G.FX.superCharge(this.charId, this.char, this.x, this.y);
        }
        return;
      }

      // 判定阶段
      this.superActive = true;
      const elapsed = this.superTimer - m.startup;
      if (elapsed % st.interval === 0 && this.superHitCount < st.count) {
        const dir = this.facing;
        const cx = this.x + dir * (st.width * 0.42);
        const cy = this.y + st.yOff;

        // 视觉:每个角色的专属演出
        G.FX.superPresent(SUPER_KIND[this.charId] || 'storm', this.char, cx, cy, dir,
          opp ? opp.x : cx, opp ? opp.y : this.y);
        G.SFX.play('hit_heavy', 0.8);

        // 判定
        const r = {
          x: this.x + (dir > 0 ? 0 : -st.width),
          y: this.y + st.yOff,
          w: st.width,
          h: st.height,
        };
        if (opp && !opp.isDeadState() && U.overlap(r, opp.hurtbox || opp._hurtBox())) {
          sys.applySuperHit(this, opp, st);
        }
        this.superHitCount++;
      }

      if (this.superTimer >= m.startup + m.active) {
        this.superActive = false;
        if (this.superTimer >= m.total) this._toIdle();
      }
    }

    isDeadState() {
      return this.st === ST.KO;
    }

    /** 霸体:该帧段内受击不进入硬直(只扣血) */
    isArmored() {
      const m = this.move;
      if (!m || !m.armor || this.st !== ST.ATTACK) return false;
      return this.moveFrame >= m.armor[0] && this.moveFrame <= m.armor[1];
    }

    /* ============================================================
       受击 / 硬直
       ============================================================ */
    enterHitstun(dmg, stun, opts) {
      this.hp = Math.max(0, this.hp - dmg);
      this.stunTimer = stun;
      this.stFrame = 0;
      this.stunCrouch = !!opts.crouch;
      this.vx = (opts.dir || 1) * (opts.pushback || 3);
      this.hitboxes.length = 0;
      this.move = null;
      this.flashTimer = 6;
      this.lastHitBy = opts.by;

      if (this.hp <= 0) {
        this.st = ST.KO;
        this.stFrame = 0;
        this.vx = (opts.dir || 1) * 7;
        this.vy = 5;
        this.y = Math.max(this.y, 2);
        return;
      }

      if (opts.knockdown) {
        this.st = ST.KNOCKDOWN;
        this.stFrame = 0;
        this.vy = 7.5;
        this.y = Math.max(this.y, 2);
        this.vx = (opts.dir || 1) * 6;
      } else if (this.y > 0.5) {
        this.st = ST.HIT_AIR;
        this.stFrame = 0;
      } else {
        this.st = ST.HIT;
        this.stFrame = 0;
        if (opts.crouch) this.y = 0;
      }
    }

    enterBlockstun(stun, opts) {
      this.stunTimer = stun;
      this.stFrame = 0;
      this.vx = (opts.dir || 1) * (opts.pushback || 4);
      this.move = null;
    }

    _hitstun(opp, sys) {
      this.vx *= 0.85;
      if (this.stFrame >= this.stunTimer) {
        this._toIdle();
      }
    }

    _knockdown(opp, sys) {
      this.vx *= 0.9;
      if (this.y <= 0.01 && this.stFrame > 8) {
        this.vx *= 0.7;
        if (this.stFrame > 34) {
          this.st = ST.WAKEUP;
          this.stFrame = 0;
          this.invuln = 12;
        }
      }
    }

    /* ============================================================
       物理
       ============================================================ */
    _physics(opp) {
      // 重力
      if (this.y > 0 || this.vy > 0) {
        this.vy -= CFG.GRAVITY;
        this.y += this.vy;
        if (this.y <= 0) {
          this.y = 0;
          const wasAir = this.st === ST.AIR || this.st === ST.HIT_AIR || this.st === ST.ATTACK;
          this.vy = 0;
          this.airJumpsLeft = this.char.airJumps || 0;
          if (this.st === ST.AIR) {
            this.st = ST.LAND;
            this.stFrame = 0;
            G.FX.dust(this.x, 0, 0, 7);
            G.SFX.play('land', 0.7);
          } else if (this.st === ST.HIT_AIR) {
            this.st = ST.KNOCKDOWN;
            this.stFrame = 0;
            G.FX.dust(this.x, 0, 0, 10);
            G.SFX.play('land', 1);
            G.CAM.shake(5);
          } else if (this.st === ST.ATTACK && this.move && this.move.air) {
            this.st = ST.LAND;
            this.stFrame = 0;
            G.FX.dust(this.x, 0, 0, 5);
          }
          if (this.st === ST.KO && this.y <= 0) {
            this.vy = 0;
          }
        }
      } else {
        this.vy = 0;
      }

      this.x += this.vx;

      // 舞台边界
      const lim = CFG.STAGE_HALF;
      if (this.x < -lim) {
        this.x = -lim;
        this.vx = Math.max(0, this.vx);
      }
      if (this.x > lim) {
        this.x = lim;
        this.vx = Math.min(0, this.vx);
      }
    }

    /* ============================================================
       判定盒
       ============================================================ */
    hurtBox() {
      if (this.invuln > 0) return null;
      const H = this.char.hurt || G.HURTBOX;
      const bs = (this.char.build && this.char.build.s) || 1;
      const bw = (this.char.build && this.char.build.w) || 1;
      let b;
      if (this.st === ST.KNOCKDOWN) {
        b = { x: -54 * bw, y: 0, w: 108 * bw, h: 52 * bs };
      } else if (this.st === ST.CROUCH || (this.st === ST.BLOCK && this._isCrouchBlock())) {
        b = H.crouch;
      } else if (this.isAir) {
        b = H.air;
      } else if (this.st === ST.HIT && this.stunCrouch) {
        b = H.crouch;
      } else {
        b = H.stand;
      }
      const x = this.facing === 1 ? this.x + b.x : this.x - b.x - b.w;
      return { x, y: this.y + b.y, w: b.w, h: b.h };
    }

    _hurtBox() {
      return this.hurtBox();
    }

    _isCrouchBlock() {
      return this.pad.dir === this.backDown;
    }

    _updateBoxes() {
      this.hurtbox = this.hurtBox();
    }

    /* ---------------- 回合控制 ---------------- */
    resetForRound(x, facing) {
      this.x = x;
      this.y = 0;
      this.vx = 0;
      this.vy = 0;
      this.facing = facing;
      this.hp = this.maxHp;
      this.st = ST.IDLE;
      this.stFrame = 0;
      this.move = null;
      this.moveFrame = 0;
      this.hitboxes.length = 0;
      this.hitstop = 0;
      this.invuln = 0;
      this.combo = 0;
      this.comboDmg = 0;
      this.comboTimer = 0;
      this.projectiles.length = 0;
      this.trail.clear();
      this.flashTimer = 0;
      this.stunTimer = 0;
      this.superTimer = 0;
      this.superHitCount = 0;
      this.anim = 'idle';
      this.animFrame = 0;
      this.animTotal = 100;
      this.airJumpsLeft = this.char.airJumps || 0;
      this.airAttackUsed = false;
      this.armorFlash = 0;
      this._rehitCount = 0;
      this.pad.reset();
    }

    /* ---------------- 渲染数据 ---------------- */
    getPose(gf) {
      return G.Rig.poseFor(this.char, this.anim, this.animFrame, this.animTotal || 100, gf);
    }

    /* ---------------- 调试 ----------------
       帧数据:当前招式 + 处于哪一阶段 */
    frameInfo() {
      if (this.st !== ST.ATTACK || !this.move) return null;
      const m = this.move;
      const f = this.moveFrame;
      let phase = 'startup';
      let phaseFrame = f;
      if (f >= m.startup && f < m.startup + m.active) {
        phase = 'active';
        phaseFrame = f - m.startup;
      } else if (f >= m.startup + m.active) {
        phase = 'recovery';
        phaseFrame = f - m.startup - m.active;
      }
      return {
        name: m.name,
        id: m.id,
        frame: f,
        total: m.total,
        phase,
        phaseFrame,
        startup: m.startup,
        active: m.active,
        recovery: m.recovery,
        guard: m.guard,
        dmg: m.dmg,
      };
    }

    totalFrames() {
      return this.move ? this.move.total : 0;
    }
  }

  G.Fighter = Fighter;
  G.COMBO_SCALE = COMBO_SCALE;
  G.PUSH_W = PUSH_W;
})();
