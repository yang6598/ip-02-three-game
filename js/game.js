/* ============================================================
   NEON RIFT — game.js
   战斗结算 / 回合 / 模式 / HUD / 渲染主入口
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const CFG = G.CFG;
  const ST = G.ST;
  const CAM = G.CAM;

  let ctx = null;
  let canvas = null;

  const S = {
    screen: 'title',   // title | select | play | help
    mode: 'arcade',    // arcade | versus | training | challenge
    phase: 'idle',     // idle | intro | fight | ko | roundEnd | matchEnd
    phaseT: 0,
    round: 1,
    timer: 99 * 60,
    gf: 0,
    hitstopGlobal: 0,
    p1Char: 'volt',
    p2Char: 'kage',
    level: 'normal',
    paused: false,

    f1: null,
    f2: null,
    ai: null,
    dummy: null,

    // 选人界面
    selP1: 'volt',
    selP2: 'kage',
    selStep: 0,

    // 训练
    showBoxes: true,
    showFrames: true,
    showInput: true,
    dummyMode: 'stand',
    frameAdv: 0,
    lastFrameAdv: 0,
    advLog: [],

    // 挑战
    challengeIdx: 0,
    challengeDone: [],
    challengeCombo: [],

    // 计时
    slowmo: 0,
    superFreeze: 0,
    hitFlash: 0,
    lastCombo: 0,

    banner: '',
    bannerSub: '',
    bannerT: 0,
  };
  G.S = S;

  /* ============================================================
     挑战任务
     ============================================================ */
  const CHALLENGES = [
    {
      title: '基础连段',
      desc: '轻拳 → 轻拳 → 重拳',
      seq: ['LP', 'LP', 'HP'],
      hint: '轻拳命中后立刻再按一次轻拳,可以取消收招。',
    },
    {
      title: '轻重取消',
      desc: '轻拳 → 重脚',
      seq: ['LP', 'HK'],
      hint: '轻技命中(或防御)后才能取消到重技。',
    },
    {
      title: '下段起手',
      desc: '蹲轻脚 → 蹲轻脚 → 扫堂腿',
      seq: ['CLK', 'CLK', 'CHK'],
      hint: '下段必须蹲防才能挡,站防会被打中。',
    },
    {
      title: '必杀取消',
      desc: '轻拳 → 重拳 → 雷升',
      seq: ['LP', 'HP', 'SP2'],
      hint: '236236 输入的超必杀不消耗,623 的雷升起手无敌。',
    },
    {
      title: '跳跃起手',
      desc: '跳重脚 → 蹲轻脚 → 扫堂腿',
      seq: ['JHK', 'CLK', 'CHK'],
      hint: '跳攻落地后有短暂优势,要接得紧。',
    },
    {
      title: '四段连击',
      desc: '轻拳 → 轻拳 → 重拳 → 雷升',
      seq: ['LP', 'LP', 'HP', 'SP2'],
      hint: '注意伤害递减,第四段只有 78% 伤害。',
    },
    {
      title: '五段连击',
      desc: '任意五段以上连段',
      seq: null,
      minCombo: 5,
      hint: '把轻攻击接重攻击再取消必杀,就能堆到五段。',
    },
    {
      title: '超必杀收尾',
      desc: '轻拳 → 重拳 → 超必杀',
      seq: ['LP', 'HP', 'SU'],
      hint: '需要 2 格能量。236236 + 拳,或直接按超必杀键。',
    },
  ];
  G.CHALLENGES = CHALLENGES;

  /* ============================================================
     初始化
     ============================================================ */
  const Game = (G.Game = {
    S,

    init(cv) {
      canvas = cv;
      ctx = G.setupCanvas(cv);
      G.BG.build();
      this.bindUI();
      this.toTitle();
      G.Loop.start(
        (dt) => this.update(dt),
        (a) => this.render(a)
      );
    },

    /* ---------------- UI 绑定 ---------------- */
    bindUI() {
      const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => {
          G.SFX.init(); G.SFX.resume();
          G.SFX.play('ui_ok', 0.8);
          fn();
        });
      };
      bind('mArcade', () => this.gotoSelect('arcade'));
      bind('mVersus', () => this.gotoSelect('versus'));
      bind('mTraining', () => this.gotoTraining());
      bind('mChallenge', () => this.gotoChallenge());
      bind('mStory', () => this.showStory());
      bind('mHelp', () => this.showHelp());

      bind('hBack', () => this.toTitle());
      bind('selFight', () => this.confirmSelect());
      bind('selBack', () => this.toTitle());

      bind('trBack', () => this.toTitle());
      bind('chBack', () => this.toTitle());
      bind('btnReset', () => this.resetTraining());
      bind('btnBoxes', () => this.toggleBoxes());
      bind('btnFrames', () => this.toggleFrames());

      document.getElementById('storyClose')?.addEventListener('click', () => {
        document.getElementById('storyScreen')?.classList.remove('on');
        G.SFX.play('ui_back', 0.6);
      });
      document.getElementById('helpClose')?.addEventListener('click', () => {
        document.getElementById('helpScreen').classList.remove('on');
      });

      // 假人行为按钮
      document.querySelectorAll('[data-dummy]').forEach((el) => {
        el.addEventListener('click', () => {
          document.querySelectorAll('[data-dummy]').forEach((e) => e.classList.remove('on'));
          el.classList.add('on');
          S.dummyMode = el.dataset.dummy;
          if (S.dummy) S.dummy.setMode(S.dummyMode);
          G.SFX.play('ui_move', 0.7);
        });
      });

      // 难度按钮
      document.querySelectorAll('[data-lv]').forEach((el) => {
        el.addEventListener('click', () => {
          document.querySelectorAll('[data-lv]').forEach((e) => e.classList.remove('on'));
          el.classList.add('on');
          S.level = el.dataset.lv;
          G.SFX.play('ui_move', 0.7);
        });
      });

      G.onKey = (code) => {
        if (code === 'Escape') {
          if (S.screen === 'select') this.toTitle();
          else if (S.screen === 'play' || S.screen === 'training' || S.screen === 'challenge') {
            if (S.mode === 'training' || S.mode === 'challenge') this.toTitle();
            else this.togglePause();
          }
          return;
        }
        if (S.screen === 'select') this.selectKey(code);

        // 训练快捷键
        if (S.screen === 'training' || S.screen === 'challenge') {
          if (code === 'KeyR') {
            this.resetTraining();
            G.SFX.play('ui_move', 0.7);
          }
          if (code === 'KeyB') this.toggleBoxes();
          if (code === 'KeyF') this.toggleFrames();
        }
      };
    },

    /* ---------------- 屏幕切换 ---------------- */
    showScreen(name) {
      ['titleScreen', 'selectScreen', 'trainingUI', 'challengeUI', 'hud', 'pauseScreen'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('on');
      });
      const map = {
        title: 'titleScreen',
        select: 'selectScreen',
        training: 'trainingUI',
        challenge: 'challengeUI',
      };
      if (name === 'play') {
        document.getElementById('hud')?.classList.add('on');
      } else if (map[name]) {
        document.getElementById(map[name])?.classList.add('on');
      }
      if (name === 'training' || name === 'challenge') {
        document.getElementById('hud')?.classList.add('on');
      }
    },

    toTitle() {
      if (G.Music) G.Music.setIntensity(0);
      S.screen = 'title';
      S.phase = 'idle';
      S.paused = false;
      ['pauseScreen', 'endScreen', 'helpScreen', 'storyScreen'].forEach((id) => {
        document.getElementById(id)?.classList.remove('on');
      });
      this.showScreen('title');
      document.body.classList.add('in-menu');
      if (S.f1) { S.f1.trail.clear(); }
      if (S.f2) { S.f2.trail.clear(); }
    },

    showStory() {
      G.SFX.play('ui_ok', 0.7);
      const ps = document.getElementById('storyParas');
      if (ps && !ps.dataset.done) {
        ps.innerHTML = G.LORE.paras.map((t) => '<p>' + t + '</p>').join('');
        ps.dataset.done = '1';
      }
      const rs = document.getElementById('storyRoster');
      if (rs && !rs.dataset.done) {
        rs.innerHTML = G.CHAR_IDS.map((id) => {
          const c = G.CHARS[id];
          const l = G.CHAR_LORE[id];
          return '<div class="story-char" style="--cc:' + c.color + '">' +
            '<div class="sc-name">' + c.name + ' · ' + c.cn + '「' + c.title + '」</div>' +
            '<div class="sc-goal">' + l.goal + '</div>' +
            '<div class="sc-line">' + l.line + '</div></div>';
        }).join('');
        rs.dataset.done = '1';
      }
      document.getElementById('storyScreen')?.classList.add('on');
    },

    showHelp() {
      G.SFX.play('ui_ok', 0.7);
      document.getElementById('helpScreen')?.classList.add('on');
    },

    gotoSelect(mode) {
      S.mode = mode;
      S.screen = 'select';
      S.selStep = 0;
      this.showScreen('select');
      this.renderSelect();
    },

    gotoTraining() {
      S.mode = 'training';
      S.screen = 'training';
      S.dummyMode = 'stand';
      this.startMatch('training', S.selP1, S.selP2, 'normal');
      this.showScreen('training');
    },

    gotoChallenge() {
      S.mode = 'challenge';
      S.screen = 'challenge';
      S.challengeIdx = 0;
      S.challengeDone = CHALLENGES.map(() => false);
      S.dummyMode = 'stand';
      this.startMatch('challenge', S.selP1, S.selP2, 'normal');
      this.showScreen('challenge');
      this.renderChallenge();
    },

    /* ---------------- 选人 ---------------- */
    renderSelect() {
      const list = document.getElementById('charList');
      if (!list) return;
      const ids = G.CHAR_IDS || Object.keys(G.CHARS);
      list.innerHTML = '';
      ids.forEach((id) => {
        const c = G.CHARS[id];
        const d = document.createElement('div');
        d.className = 'char-card' + (S.selP1 === id ? ' p1' : '') + (S.selP2 === id ? ' p2' : '');
        d.style.setProperty('--cc', c.color);
        const tags = (c.tags || []).map((t) => '<i>' + t + '</i>').join('');
        const mv = (c.cmdTable || [])
          .map((m) => '<li><b>' + m.cmd + '</b><span>' + m.label + '</span></li>')
          .join('');
        const cb = (G.COMBOS[id] || [])
          .map((t, i) => '<li><b>连招' + (i + 1) + '</b><span>' + t + '</span></li>')
          .join('');
        d.innerHTML =
          '<div class="cc-glow"></div>' +
          '<div class="cc-top"><span class="cc-name">' + c.name + '</span>' +
          '<span class="cc-hp">HP ' + c.hp + '</span></div>' +
          '<div class="cc-cn">' + c.cn + ' · ' + c.title + '</div>' +
          '<div class="cc-desc">' + c.desc + '</div>' +
          '<div class="cc-tags">' + tags + '</div>' +
          '<ul class="cc-moves">' + mv + '</ul>' +
          '<ul class="cc-moves cc-combos">' + cb + '</ul>';
        d.addEventListener('click', () => {
          G.SFX.play('ui_move', 0.8);
          if (S.selStep === 0) {
            S.selP1 = id;
            S.selStep = 1;
          } else {
            S.selP2 = id;
          }
          this.renderSelect();
          this.updateSelectHint();
        });
        list.appendChild(d);
      });
      this.updateSelectHint();
    },

    updateSelectHint() {
      const el = document.getElementById('selHint');
      if (el) {
        el.textContent =
          S.selStep === 0
            ? '选择 P1 角色'
            : '选择 P2 角色(已选 P1:' + G.CHARS[S.selP1].name + ')';
      }
    },

    selectKey(code) {
      const ids = G.CHAR_IDS || Object.keys(G.CHARS);
      const n = ids.length;
      const move = (step) => {
        const cur = S.selStep === 0 ? S.selP1 : S.selP2;
        let i = ids.indexOf(cur);
        if (i < 0) i = 0;
        i = (i + step + n * 4) % n;
        if (S.selStep === 0) S.selP1 = ids[i]; else S.selP2 = ids[i];
        G.SFX.play('ui_move', 0.7);
        this.renderSelect();
      };
      if (code === 'KeyA' || code === 'ArrowLeft') move(-1);
      else if (code === 'KeyD' || code === 'ArrowRight') move(1);
      else if (code === 'KeyW' || code === 'ArrowUp') move(-3);
      else if (code === 'KeyS' || code === 'ArrowDown') move(3);
      else if (code === 'Enter' || code === 'Space') this.confirmSelect();
    },

    confirmSelect() {
      if (S.selStep === 0) {
        S.selStep = 1;
        G.SFX.play('ui_ok', 0.8);
        this.renderSelect();
        return;
      }
      this.startMatch(S.mode, S.selP1, S.selP2, S.level);
      S.screen = 'play';
      this.showScreen('play');
      document.body.classList.remove('in-menu');
    },

    /* ============================================================
       开始比赛
       ============================================================ */
    startMatch(mode, c1, c2, level) {
      if (G.Music) G.Music.setIntensity(1);
      S.mode = mode;
      S.level = level;
      S.round = 1;
      S.phase = 'intro';
      S.phaseT = 0;
      S.timer = 99 * 60;
      S.paused = false;
      S.frameAdv = 0;
      S.advLog.length = 0;
      S.challengeCombo.length = 0;
      S.fightFrames = 0;
      S.vsT1 = 0;
      S.vsT2 = 0;
      G.FX.reset();
      document.getElementById('vsBox')?.classList.remove('on');

      G.pads.p1.enabled = true;
      G.pads.p2.enabled = mode === 'versus';
      G.pads.p1.reset();
      G.pads.p2.reset();

      S.f1 = new G.Fighter(c1, G.pads.p1, 1, -170, 1);
      S.f2 = new G.Fighter(c2, G.pads.p2, 2, 170, -1);
      // KOF 式:开局就有 1 格能量,不用"攒满才能放";训练模式直接给满
      const startMeter = mode === 'training' ? 300 : 100;
      S.f1.meter = startMeter;
      S.f2.meter = startMeter;

      const hudEl = document.getElementById('hud');
      if (hudEl) {
        const cc1 = G.CHARS[c1], cc2 = G.CHARS[c2];
        hudEl.style.setProperty('--f1', cc1.color);
        hudEl.style.setProperty('--f1d', cc1.color2);
        hudEl.style.setProperty('--f2', cc2.color);
        hudEl.style.setProperty('--f2d', cc2.color2);
      }
      ['name1', 'name2'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.dataset.ch = ''; }
      });

      // VS 开场对话
      const vb = document.getElementById('vsBox');
      if (vb) {
        vb.classList.remove('on');
        ['p1l', 'p2l'].forEach((c) => vb.querySelector('.' + c)?.classList.remove('show'));
      }
      S.vsT1 = 0;
      S.vsT2 = 0;
      if (mode === 'arcade' || mode === 'versus') {
        const b1 = G.BANTER[c1] || ['', ''];
        const b2 = G.BANTER[c2] || ['', ''];
        S.vsL1 = b1[Math.floor(Math.random() * b1.length)];
        S.vsL2 = b2[Math.floor(Math.random() * b2.length)];
        S.vsName1 = G.CHARS[c1].name + ' · ' + G.CHARS[c1].cn;
        S.vsName2 = G.CHARS[c2].name + ' · ' + G.CHARS[c2].cn;
      } else {
        S.vsL1 = '';
        S.vsL2 = '';
      }

      if (mode === 'arcade') {
        S.ai = new G.AI(S.f2, level);
        S.dummy = null;
      } else if (mode === 'versus') {
        S.ai = null;
        S.dummy = null;
      } else {
        S.ai = null;
        S.f2.pad = null;
        S.dummy = new G.Dummy(S.f2, S.dummyMode);
      }

      this.banner('ROUND 1', '');
      S.bannerT = 0;
      CAM.x = 0;
      CAM.tx = 0;
      CAM.zoom = 0.85;
      CAM.tzoom = 0.85;
      G.SFX.init();
      G.SFX.resume();
    },

    resetTraining() {
      G.FX.reset();
      S.f1.resetForRound(-170, 1);
      S.f2.resetForRound(170, -1);
      S.timer = 99 * 60;
      S.advLog.length = 0;
      S.challengeCombo.length = 0;
      CAM.x = 0;
      CAM.tx = 0;
    },

    togglePause() {
      S.paused = !S.paused;
      document.getElementById('pauseScreen')?.classList.toggle('on', S.paused);
      G.SFX.play('ui_back', 0.7);
    },

    toggleBoxes() {
      S.showBoxes = !S.showBoxes;
      document.getElementById('btnBoxes')?.classList.toggle('on', S.showBoxes);
    },
    toggleFrames() {
      S.showFrames = !S.showFrames;
      document.getElementById('btnFrames')?.classList.toggle('on', S.showFrames);
    },

    banner(text, sub, cls) {
      S.banner = text;
      S.bannerSub = sub || '';
      S.bannerT = 0;
      const el = document.getElementById('banner');
      if (el) {
        el.className = cls || '';
        el.innerHTML = '<div class="bn-main">' + text + '</div>' +
          (sub ? '<div class="bn-sub">' + sub + '</div>' : '');
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
      }
    },

    /* ============================================================
       更新
       ============================================================ */
    update(dt) {
      S.gf++;
      G.pads.p1.poll();
      G.pads.p2.poll();

      if (S.screen === 'title' || S.screen === 'select') {
        this.updateMenu(dt);
        return;
      }

      if (S.paused) return;

      G.BG.update(dt);
      G.FX.update(dt);
      CAM.update(dt);
      S.bannerT += dt;

      if (S.screen === 'play' || S.screen === 'training' || S.screen === 'challenge') {
        this.stepBattle(dt);
      }
    },

    updateMenu(dt) {
      // 菜单里的相机缓慢环绕
      S.gf++;
      G.BG.update(dt);
      G.FX.update(dt);
      CAM.tx = Math.sin(S.gf * 0.004) * 320;
      CAM.tzoom = 0.80;
      CAM.update(dt);
    },

    stepBattle(dt) {
      const f1 = S.f1,
        f2 = S.f2;
      if (!f1 || !f2) return;

      // KO 慢动作:前 1.3 秒隔帧更新,营造定格感
      if (S.phase === 'ko' && S.phaseT < 1.3) {
        S.koSkip = !S.koSkip;
        if (S.koSkip) {
          G.FX.update(dt);
          CAM.update(dt);
          f1.trail.update(dt);
          f2.trail.update(dt);
          return;
        }
      }

      // 暂停/演出阶段
      if (S.phase === 'intro') {
        S.phaseT += dt;
        // VS 对话逐条浮现
        const vb = document.getElementById('vsBox');
        const hasTalk = !!(S.vsL1 || S.vsL2);
        if (vb && hasTalk) {
          vb.classList.add('on');
          if (S.vsL1 && !S.vsT1 && S.phaseT > 0.35) {
            S.vsT1 = 1;
            const el = vb.querySelector('.p1l');
            document.getElementById('vsName1').textContent = S.vsName1;
            document.getElementById('vsText1').textContent = S.vsL1;
            el?.classList.add('show');
          }
          if (S.vsL2 && !S.vsT2 && S.phaseT > 1.45) {
            S.vsT2 = 1;
            const el = vb.querySelector('.p2l');
            document.getElementById('vsName2').textContent = S.vsName2;
            document.getElementById('vsText2').textContent = S.vsL2;
            el?.classList.add('show');
          }
        }
        const introDur = hasTalk ? 3.4 : 1.9;
        if (S.phaseT > introDur - 0.6 && S.phaseT < introDur - 0.55) {
          this.banner('FIGHT!', '');
          G.SFX.play('fight', 1);
        }
        if (S.phaseT > introDur) {
          S.phase = 'fight';
          S.phaseT = 0;
          vb?.classList.remove('on');
          ['p1l', 'p2l'].forEach((c) => vb?.querySelector('.' + c)?.classList.remove('show'));
        }
        // intro 期间仍然更新动画,但禁止输入
        G.pads.p1.enabled = false;
        G.pads.p2.enabled = false;
      } else if (S.phase === 'fight') {
        G.pads.p1.enabled = true;
        G.pads.p2.enabled = S.mode === 'versus';
        S.fightFrames = (S.fightFrames || 0) + 1;
      } else if (S.phase === 'ko') {
        S.phaseT += dt;
        G.pads.p1.enabled = false;
        G.pads.p2.enabled = false;
        if (S.phaseT > 2.4) this.afterRound();
      } else if (S.phase === 'roundEnd') {
        S.phaseT += dt;
        if (S.phaseT > 1.8) this.startNextRound();
      }

      // 计时
      if (S.phase === 'fight' && S.mode !== 'training' && S.mode !== 'challenge') {
        S.timer -= 1;
        if (S.timer <= 0) {
          S.timer = 0;
          this.endRoundByTime();
        }
      }

      // AI
      const sys = this.sys;
      if (S.ai) S.ai.update(dt, f1, sys);
      if (S.dummy) S.dummy.update(dt, f1, sys);

      // 清除 AI pad 的招式按键(避免一直按住)
      const wasHitstop = f1.hitstop > 0 || f2.hitstop > 0;

      // 更新角色
      f1.update(f2, sys);
      f2.update(f1, sys);

      // 能量槽自然回复(KOF 式):每帧少量积累,保证一回合至少能攒满两格
      if (S.phase === 'fight') {
        if (f1.hp > 0) f1.meter = Math.min(300, f1.meter + 0.05);
        if (f2.hp > 0) f2.meter = Math.min(300, f2.meter + 0.05);
      }

      // 判定结算
      if (!wasHitstop) this.resolveHits();

      // 投射物
      this.updateProjectiles();

      // 推挤
      this.pushApart();

      // 相机
      const mid = (f1.x + f2.x) / 2;
      const dist = Math.abs(f1.x - f2.x);
      let zoom = U.lerp(1.02, 0.72, U.clamp((dist - 90) / 820, 0, 1));
      // 垂直:有人跳高时拉远
      const maxY = Math.max(f1.y, f2.y);
      if (maxY > 80) zoom *= 0.94;
      CAM.tx = U.clamp(mid, -CFG.STAGE_HALF + 280, CFG.STAGE_HALF - 280);
      CAM.tzoom = zoom;

      // 回合结束判定
      if (S.phase === 'fight' && (f1.hp <= 0 || f2.hp <= 0)) {
        this.endRound();
      }

      // 连段结束 → 记录帧优势
      this.trackCombo();

      // 挑战检测
      if (S.mode === 'challenge') this.checkChallenge();
    },

    sys: {
      get gf() { return S.gf; },
      startSuperFreeze(attacker, frames) {
        const other = attacker === S.f1 ? S.f2 : S.f1;
        if (other) other.hitstop = Math.max(other.hitstop, frames);
        G.FX.Screen.flash = 0.55;
        G.FX.Screen.flashColor = attacker.char.color;
        G.CAM.shake(7);
        S.superFreeze = frames;
        if (G.Music) G.Music.duck(0.18, 1.4);
        // 招式名牌:滚动闪现超必杀名
        const nm = attacker.move ? attacker.move.name : '';
        const cn = attacker.char.cn || '';
        if (nm) G.Game.banner(nm, cn + ' · SUPER ART', 'super');
      },
      applySuperHit(attacker, defender, st) {
        applyDamage(attacker, defender, {
          dmg: st.dmg,
          hitstun: st.hitstun,
          blockstun: st.blockstun,
          hitstop: st.hitstop,
          guard: st.guard,
          pushback: 2,
          blockPushback: 2,
          isSuper: true,
          isThrow: !!st.isThrow,
          knockdown: defender.combo >= 8,
        }, { x: defender.x, y: defender.y + 100 });
      },
    },

    /* ============================================================
       判定结算
       ============================================================ */
    resolveHits() {
      const f1 = S.f1,
        f2 = S.f2;
      const events = [];

      const collect = (att, def) => {
        if (!att.move || att.moveHitDone) return;
        const hb = att.hitboxes;
        if (!hb.length) return;
        const hurt = def.hurtbox || def.hurtBox();
        if (!hurt) return;
        // 无敌 / 已 KO 不判定
        if (def.invuln > 0 || def.st === ST.KO) return;
        for (let i = 0; i < hb.length; i++) {
          if (U.overlap(hb[i], hurt)) {
            if (window.__dbg) window.__dbg.events++;
            events.push({ att, def, box: hb[i], move: att.move });
            att.moveHitDone = true;
            break;
          }
        }
      };

      collect(f1, f2);
      collect(f2, f1);

      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        const box = e.box;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        applyDamage(e.att, e.def, e.move, { x: cx, y: cy });
      }
    },

    updateProjectiles() {
      const all = [];
      [S.f1, S.f2].forEach((f) => {
        if (!f) return;
        for (let i = f.projectiles.length - 1; i >= 0; i--) {
          const p = f.projectiles[i];
          p.update();
          if (p.dead) {
            f.projectiles.splice(i, 1);
            G.FX.ring(p.x, p.y, p.owner.char.color, 6, 40, 12);
            continue;
          }
          // 与对手碰撞
          const opp = f === S.f1 ? S.f2 : S.f1;
          if (!opp || p.hitOnce) continue;
          const hurt = opp.hurtbox || opp.hurtBox();
          if (!hurt) continue;
          if (U.overlap(p.box(), hurt)) {
            p.hitOnce = true;
            p.dead = true;
            applyDamage(p.owner, opp, p.def, { x: p.x, y: p.y });
            G.FX.ring(p.x, p.y, p.owner.char.color, 10, 70, 14);
          }
          // 弹道对消
          all.push(p);
        }
      });
      // 两个弹道相撞
      if (S.f1 && S.f2) {
        const a = S.f1.projectiles,
          b = S.f2.projectiles;
        for (let i = a.length - 1; i >= 0; i--) {
          for (let j = b.length - 1; j >= 0; j--) {
            if (U.overlap(a[i].box(), b[j].box())) {
              G.FX.ring(a[i].x, a[i].y, '#ffffff', 10, 90, 16);
              G.CAM.shake(4);
              a[i].dead = true;
              b[j].dead = true;
            }
          }
        }
      }
    },

    pushApart() {
      const f1 = S.f1,
        f2 = S.f2;
      if (!f1 || !f2) return;
      // 倒地和被投时不推
      if (f1.st === ST.KNOCKDOWN || f2.st === ST.KNOCKDOWN) return;
      const dx = f2.x - f1.x;
      const minD = 54;
      const ad = Math.abs(dx);
      if (ad < minD && ad > 0.01) {
        const push = (minD - ad) / 2;
        const s = dx > 0 ? 1 : -1;
        f1.x -= push * s;
        f2.x += push * s;
      } else if (ad <= 0.01) {
        f1.x -= minD / 2;
        f2.x += minD / 2;
      }
      const lim = CFG.STAGE_HALF;
      f1.x = U.clamp(f1.x, -lim, lim);
      f2.x = U.clamp(f2.x, -lim, lim);
    },

    /* ============================================================
       连段追踪 & 帧优势
       ============================================================ */
    trackCombo() {
      const f1 = S.f1,
        f2 = S.f2;
      if (!f1 || !f2) return;

      // 连段进行中:记录招式
      const def = f2;
      if (def.combo > 0 && (def.st === ST.HIT || def.st === ST.HIT_AIR || def.st === ST.KNOCKDOWN)) {
        const last = S.challengeCombo[S.challengeCombo.length - 1];
        // 记录攻击方最近的招式
        const att = f1;
        if (att.st === ST.ATTACK && att.move && att.moveHitDone) {
          const id = att.move.id;
          if (last !== id) S.challengeCombo.push(id);
        }
      }
      // 连段结束
      if (
        S.lastCombo > 0 &&
        def.combo === 0
      ) {
        // 结算连段
        S.lastCombo = 0;
      }
      if (def.combo > 0) S.lastCombo = def.combo;

      // 帧优势:在对手离开 blockstun/hitstun 的瞬间计算
      const f1Stun = f1.st === ST.HIT || f1.st === ST.BLOCK || (f1.st === ST.ATTACK);
      // 简化:记录双方"恢复自由"的帧数差
      if (S.phase === 'fight') {
        const a = f1.canAct ? 0 : 1;
        const b = f2.canAct ? 0 : 1;
        if (a === 0 && b === 1 && f2.stFrame === 1) {
          S.frameAdv = -f2.stunTimer;
          S.advLog.unshift(S.frameAdv);
          if (S.advLog.length > 6) S.advLog.pop();
        }
      }
    },

    /* ============================================================
       回合流程
       ============================================================ */
    endRound() {
      const f1 = S.f1,
        f2 = S.f2;
      S.phase = 'ko';
      S.phaseT = 0;
      S.slowmo = 0.6;
      G.FX.Screen.flash = 0.8;
      G.FX.Screen.flashColor = '#ffffff';
      G.CAM.shake(16);
      G.SFX.play('ko', 1);

      if (f1.hp <= 0) {
        f1.roundWins = f1.roundWins || 0;
        f2.roundWins = (f2.roundWins || 0) + 1;
        if (f2.st !== ST.KO) { f2.st = ST.WIN; f2.stFrame = 0; f2.move = null; }
        this.banner('K.O.', G.CHARS[f2.charId].name + ' WINS');
      } else if (f2.hp <= 0) {
        f1.roundWins = (f1.roundWins || 0) + 1;
        if (f1.st !== ST.KO) { f1.st = ST.WIN; f1.stFrame = 0; f1.move = null; }
        this.banner('K.O.', G.CHARS[f1.charId].name + ' WINS');
      }
    },

    endRoundByTime() {
      const f1 = S.f1,
        f2 = S.f2;
      S.phase = 'ko';
      S.phaseT = 0;
      if (f1.hp === f2.hp) {
        this.banner('TIME UP', 'DRAW');
      } else if (f1.hp > f2.hp) {
        f1.roundWins = (f1.roundWins || 0) + 1;
        this.banner('TIME UP', G.CHARS[f1.charId].name + ' WINS');
      } else {
        f2.roundWins = (f2.roundWins || 0) + 1;
        this.banner('TIME UP', G.CHARS[f2.charId].name + ' WINS');
      }
      G.SFX.play('ko', 0.8);
    },

    afterRound() {
      const f1 = S.f1,
        f2 = S.f2;
      if (S.mode === 'training' || S.mode === 'challenge') {
        // 训练模式:直接重置
        this.resetTraining();
        S.phase = 'fight';
        S.phaseT = 0;
        return;
      }
      if ((f1.roundWins || 0) >= 2 || (f2.roundWins || 0) >= 2) {
        S.phase = 'matchEnd';
        const winner = (f1.roundWins || 0) >= 2 ? f1 : f2;
        this.banner('YOU ' + (winner === f1 ? 'WIN' : 'LOSE'), G.CHARS[winner.charId].name);
        const el = document.getElementById('endScreen');
        if (el) {
          el.querySelector('.end-title').textContent = winner === f1 ? 'VICTORY' : 'DEFEAT';
          el.querySelector('.end-sub').textContent =
            G.CHARS[winner.charId].name + ' · ' + G.CHARS[winner.charId].cn;
          el.classList.add('on');
        }
        return;
      }
      S.phase = 'roundEnd';
      S.phaseT = 0;
    },

    startNextRound() {
      S.round++;
      S.f1.resetForRound(-170, 1);
      S.f2.resetForRound(170, -1);
      S.timer = 99 * 60;
      S.phase = 'intro';
      S.phaseT = 0;
      S.challengeCombo.length = 0;
      this.banner('ROUND ' + S.round, '');
      G.FX.reset();
    },

    /* ============================================================
       挑战检测
       ============================================================ */
    checkChallenge() {
      const idx = S.challengeIdx;
      if (idx >= CHALLENGES.length) return;
      const ch = CHALLENGES[idx];
      const def = S.f2;
      if (def.combo > 0) return; // 还在连段中

      if (!S.challengeCombo.length) return;

      const seq = S.challengeCombo.slice();
      let ok = false;

      if (ch.seq) {
        // 子序列匹配(允许前面有其他招)
        const target = ch.seq;
        const alt = ch.altSeq;
        ok = matchSeq(seq, target) || (alt && matchSeq(seq, alt));
      } else if (ch.minCombo) {
        ok = seq.length >= ch.minCombo;
      }

      if (ok) {
        S.challengeDone[idx] = true;
        G.SFX.play('ui_ok', 1);
        G.FX.Screen.flash = 0.5;
        G.FX.Screen.flashColor = '#7dffb0';
        this.banner('CHALLENGE CLEAR', ch.title);
        S.challengeIdx = Math.min(idx + 1, CHALLENGES.length - 1);
        this.renderChallenge();
      }
      S.challengeCombo.length = 0;
    },

    renderChallenge() {
      const list = document.getElementById('chList');
      if (!list) return;
      list.innerHTML = '';
      CHALLENGES.forEach((c, i) => {
        const d = document.createElement('div');
        d.className = 'ch-item' + (S.challengeDone[i] ? ' done' : '') + (i === S.challengeIdx ? ' cur' : '');
        d.innerHTML =
          '<span class="ch-i">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="ch-t">' + c.title + '</span>' +
          '<span class="ch-d">' + c.desc + '</span>';
        list.appendChild(d);
      });
      const hint = document.getElementById('chHint');
      if (hint && CHALLENGES[S.challengeIdx]) {
        hint.textContent = CHALLENGES[S.challengeIdx].hint;
      }
    },

    /* ============================================================
       渲染
       ============================================================ */
    render(alpha) {
      const W = CFG.W,
        H = CFG.H;
      if (!ctx) return;

      ctx.save();
      ctx.clearRect(0, 0, W, H);

      // 背景
      G.BG.render(ctx);

      const inBattle = S.f1 && S.f2 && (S.screen === 'play' || S.screen === 'training' || S.screen === 'challenge');

      if (!inBattle) {
        // 菜单背景:画两个角色对峙剪影
        this.renderMenuScene(ctx);
        G.BG.renderFore(ctx);
        ctx.restore();
        return;
      }

      // 地面
      G.BG.renderGround(ctx);

      const f1 = S.f1,
        f2 = S.f2;

      // 远端角色阴影
      this.drawShadow(ctx, f1);
      this.drawShadow(ctx, f2);

      // 角色(P2 先画,在后面)
      this.drawFighter(ctx, f2, alpha);
      this.drawFighter(ctx, f1, alpha);

      // 投射物
      this.drawProjectiles(ctx, f1);
      this.drawProjectiles(ctx, f2);

      // 特效
      G.FX.render(ctx);

      // 判定框
      if (S.showBoxes && (S.mode === 'training' || S.mode === 'challenge')) {
        this.drawDebugBoxes(ctx, f1, f2);
      }

      // 前景
      G.BG.renderFore(ctx);

      // 训练模式覆盖面板
      if (S.mode === 'training' || S.mode === 'challenge') {
        this.drawTrainingOverlay(ctx);
      }

      // 屏幕效果
      G.FX.renderScreen(ctx);

      // 暂停遮罩
      if (S.paused) {
        ctx.fillStyle = 'rgba(3,5,12,0.55)';
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();

      // HUD
      if (S.mode !== 'training' && S.mode !== 'challenge') this.updateHUD();
      else this.updateHUD(true);
    },

    renderMenuScene(ctx) {
      // 两个角色站在中间,缓慢呼吸
      const t = S.gf;
      const fake = [{ x: -120, f: 1, c: S.selP1 || 'volt' }, { x: 120, f: -1, c: S.selP2 || 'kage' }];
      fake.forEach((o, i) => {
        const ch = G.CHARS[o.c];
        const pose = G.Rig.poseFor(ch, 'idle', t % 100, 100, t + i * 37);
        ctx.save();
        // 脚底
        const sx = CFG.W / 2 + (o.x - CAM.x) * CAM.zoom;
        const sy = CFG.GROUND_Y + 90;
        ctx.globalAlpha = 0.92;
        ctx.translate(sx, sy);
        ctx.scale(CAM.zoom * o.f, -CAM.zoom);
        G.Rig.draw(ctx, pose, ch, { glowMul: 1 });
        ctx.restore();
      });
      // 地面
      const gy = CFG.GROUND_Y + 90;
      const g = ctx.createLinearGradient(0, gy, 0, CFG.H);
      g.addColorStop(0, 'rgba(10,16,30,0.9)');
      g.addColorStop(1, 'rgba(2,4,10,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, gy, CFG.W, CFG.H - gy);
      ctx.strokeStyle = 'rgba(150,230,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(CFG.W, gy);
      ctx.stroke();
    },

    drawShadow(ctx, f) {
      const sx = CAM.sx(f.x);
      const gy = CAM.sy(0);
      const h = U.clamp(1 - f.y / 420, 0.35, 1);
      const w = 56 * h * CAM.zoom;
      ctx.save();
      ctx.globalAlpha = 0.42 * h;
      const g = ctx.createRadialGradient(sx, gy, 0, sx, gy, w);
      g.addColorStop(0, 'rgba(0,0,0,0.9)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(sx, gy + 2, w, w * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    drawFighter(ctx, f, alpha) {
      if (!f) return;
      const pose = f.getPose(S.gf);

      // 残影
      f.trail.render(ctx, f.char);

      // 脚下光环(区分 P1/P2)
      const sx = CAM.sx(f.x);
      const gy = CAM.sy(0);
      if (f.y < 6) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.30;
        const col = f.char.color;
        const g = ctx.createRadialGradient(sx, gy, 0, sx, gy, 46 * CAM.zoom);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(sx, gy, 46 * CAM.zoom, 12 * CAM.zoom, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      // hitstop 抖动
      const sh = f.hitstop > 0 ? f.shakeOffset : 0;
      ctx.translate(CAM.sx(f.x) + sh, CAM.sy(f.y));
      ctx.scale(CAM.zoom * f.facing, -CAM.zoom);

      const opts = {
        glowMul: f.hitstop > 0 ? 2.2 : 1,
        flash: f.flashTimer > 0,
      };
      G.Rig.draw(ctx, pose, f.char, opts);

      // 受击白闪
      if (f.flashTimer > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (f.flashTimer / 6) * 0.7;
        G.Rig.draw(ctx, pose, f.char, { glowMul: 3 });
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      // 蓄力 / 无敌提示
      if (f.invuln > 0 && f.st !== ST.WAKEUP) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18 + Math.sin(S.gf * 0.4) * 0.1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        const s = G.Rig.solve(pose, f.char);
        ctx.beginPath();
        ctx.arc(s.hip[0], s.hip[1] + 30, 70, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      // 攻击判定帧:挥击光刃
      if (
        f.st === ST.ATTACK && f.move && f.move.hitbox &&
        f.moveFrame >= f.move.startup &&
        f.moveFrame < f.move.startup + f.move.active
      ) {
        const hb = f.move.hitbox;
        const cx = hb.x + hb.w / 2;
        const cy = hb.y + hb.h / 2;
        const r = Math.max(hb.w, hb.h) * 0.66;
        const prog = (f.moveFrame - f.move.startup) / Math.max(1, f.move.active);
        const a1 = -1.25 + prog * 2.5;
        const a0 = a1 - 1.5;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = f.char.color;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 5;
        ctx.shadowColor = f.char.color;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a1 - 0.5, a1);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    },

    drawProjectiles(ctx, f) {
      if (!f) return;
      for (let i = 0; i < f.projectiles.length; i++) {
        const p = f.projectiles[i];
        const sx = CAM.sx(p.x),
          sy = CAM.sy(p.y);
        const z = CAM.zoom;
        const col = p.owner.char.color;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // 拖尾
        const tx = CAM.sx(p.x - p.dir * 46);
        const g = ctx.createLinearGradient(tx, sy, sx, sy);
        g.addColorStop(0, G.hexA(col, 0));
        g.addColorStop(1, G.hexA(col, 0.55));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(tx, sy - 12 * z);
        ctx.lineTo(sx, sy - 16 * z);
        ctx.lineTo(sx, sy + 16 * z);
        ctx.lineTo(tx, sy + 12 * z);
        ctx.fill();

        // 核心
        const r = (p.w / 2) * z * (1 + Math.sin(S.gf * 0.5) * 0.08);
        const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.8);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.35, col);
        rg.addColorStop(1, G.hexA(col, 0));
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 1.8, 0, Math.PI * 2);
        ctx.fill();

        // 电弧环
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.6 * z;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 1.1, S.gf * 0.2, S.gf * 0.2 + 4.2);
        ctx.stroke();
        ctx.restore();
      }
    },

    /* ---------------- 判定框调试 ---------------- */
    drawDebugBoxes(ctx, f1, f2) {
      const drawBox = (b, col, label, fillA) => {
        if (!b) return;
        const x = CAM.sx(b.x);
        const y = CAM.sy(b.y + b.h);
        const w = b.w * CAM.zoom;
        const h = b.h * CAM.zoom;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.fillStyle = G.hexA(col, fillA || 0.14);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        if (label) {
          ctx.fillStyle = col;
          ctx.font = '700 10px "Orbitron", monospace';
          ctx.fillText(label, x + 2, y - 3);
        }
        ctx.restore();
      };

      // 受击框
      drawBox(f1.hurtbox, '#3ef2ff', 'P1 HURT', 0.12);
      drawBox(f2.hurtbox, '#ff3ea5', 'P2 HURT', 0.12);
      // 攻击框
      (f1.hitboxes || []).forEach((b) => drawBox(b, '#ff3355', 'HIT', 0.3));
      (f2.hitboxes || []).forEach((b) => drawBox(b, '#ff3355', 'HIT', 0.3));
      // 投射物框
      [...f1.projectiles, ...f2.projectiles].forEach((p) => drawBox(p.box(), '#ffaa00', '', 0.25));
    },

    /* ---------------- 训练覆盖层 ---------------- */
    drawTrainingOverlay(ctx) {
      const f1 = S.f1,
        f2 = S.f2;
      if (!f1) return;

      // 帧数据面板
      if (S.showFrames) {
        const info = f1.frameInfo();
        const x = 24,
          y = 300;
        ctx.save();
        ctx.fillStyle = 'rgba(6,10,20,0.72)';
        G.roundRect(ctx, x, y, 232, info ? 156 : 74, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(62,242,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = '700 11px "Orbitron", monospace';
        ctx.fillStyle = 'rgba(140,200,230,0.9)';
        ctx.fillText('FRAME DATA', x + 14, y + 20);

        if (info) {
          ctx.font = '900 18px "Orbitron", sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(info.name, x + 14, y + 46);

          // 帧条
          const barY = y + 60;
          const barW = 204;
          const total = info.total;
          const sx = (n) => (n / total) * barW;
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(x + 14, barY, barW, 10);
          ctx.fillStyle = 'rgba(255,214,60,0.75)';
          ctx.fillRect(x + 14, barY, sx(info.startup), 10);
          ctx.fillStyle = 'rgba(255,60,90,0.92)';
          ctx.fillRect(x + 14 + sx(info.startup), barY, sx(info.active), 10);
          ctx.fillStyle = 'rgba(90,140,200,0.7)';
          ctx.fillRect(x + 14 + sx(info.startup + info.active), barY, sx(info.recovery), 10);
          // 游标
          const cx = x + 14 + sx(info.frame);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(cx - 1, barY - 3, 2.4, 16);

          ctx.font = '700 10px "Orbitron", monospace';
          ctx.fillStyle = 'rgba(255,214,60,0.95)';
          ctx.fillText('起手 ' + info.startup, x + 14, barY + 26);
          ctx.fillStyle = 'rgba(255,60,90,0.95)';
          ctx.fillText('判定 ' + info.active, x + 74, barY + 26);
          ctx.fillStyle = 'rgba(120,170,230,0.95)';
          ctx.fillText('收招 ' + info.recovery, x + 134, barY + 26);

          ctx.fillStyle = 'rgba(200,230,255,0.85)';
          ctx.font = '700 11px "Orbitron", monospace';
          ctx.fillText(
            'F' + info.frame + '/' + info.total + '  ' + (info.phase === 'startup' ? '起手' : info.phase === 'active' ? '判定中' : '收招'),
            x + 14, barY + 48
          );
          const gLabel = info.guard === 'LOW' ? '下段(须蹲防)' : info.guard === 'OVERHEAD' ? '中段(须站防)' : info.guard === 'THROW' ? '投技(不可防)' : '中段(站蹲皆可)';
          ctx.fillStyle = info.guard === 'LOW' ? '#7dd2ff' : info.guard === 'OVERHEAD' ? '#ffb060' : '#c8e6ff';
          ctx.fillText('防御: ' + gLabel, x + 14, barY + 66);
        } else {
          ctx.font = '700 12px "Orbitron", monospace';
          ctx.fillStyle = 'rgba(150,190,220,0.6)';
          ctx.fillText('— 待机 —', x + 14, y + 48);
        }
        ctx.restore();
      }

      // 连段计数
      if (f2 && f2.combo > 0) {
        const x = CFG.W - 60;
        ctx.save();
        ctx.textAlign = 'right';
        const scale = 1 + Math.min(f2.combo, 8) * 0.04;
        ctx.font = '900 ' + Math.round(46 * scale) + 'px "Orbitron", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = f1.char.color;
        ctx.shadowBlur = 18;
        ctx.fillText(f2.combo + '', x, 200);
        ctx.font = '900 15px "Orbitron", sans-serif';
        ctx.fillText('HITS', x, 222);
        ctx.font = '700 13px "Orbitron", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(Math.round(f2.comboDmg) + ' DMG', x, 244);
        ctx.restore();
      }

      // 输入历史
      if (S.showInput) {
        this.drawInputHistory(ctx);
      }

      // 战斗速度 / 简易提示
      ctx.save();
      ctx.font = '700 11px "Orbitron", monospace';
      ctx.fillStyle = 'rgba(120,170,200,0.55)';
      ctx.fillText('ESC 菜单  ·  R 重置  ·  B 判定框  ·  F 帧数据', 24, CFG.H - 24);
      ctx.restore();
    },

    drawInputHistory(ctx) {
      const pad = G.pads.p1;
      const x = 24,
        y = CFG.H - 190;
      ctx.save();
      ctx.font = '700 10px "Orbitron", monospace';
      ctx.fillStyle = 'rgba(140,200,230,0.7)';
      ctx.fillText('INPUT', x, y - 8);

      const n = 14;
      const h = pad.dirHist;
      for (let i = 0; i < n; i++) {
        const idx = h.length - n + i;
        if (idx < 0) continue;
        const d = h[idx];
        const bx = x + i * 22;
        const by = y + 4;
        ctx.fillStyle = d === 5 ? 'rgba(255,255,255,0.06)' : 'rgba(62,242,255,0.16)';
        G.roundRect(ctx, bx, by, 18, 18, 3);
        ctx.fill();
        if (d !== 5) drawDirArrow(ctx, bx + 9, by + 9, d, 'rgba(62,242,255,0.95)');
      }

      // 按钮
      const labels = { lp: 'LP', hp: 'HP', lk: 'LK', hk: 'HK' };
      let k = 0;
      ['lp', 'hp', 'lk', 'hk'].forEach((b) => {
        const on = pad.recent(b, 8);
        const bx = x + k * 34;
        const by = y + 28;
        ctx.fillStyle = on ? 'rgba(255,62,165,0.85)' : 'rgba(255,255,255,0.07)';
        G.roundRect(ctx, bx, by, 30, 18, 3);
        ctx.fill();
        ctx.fillStyle = on ? '#fff' : 'rgba(180,210,230,0.5)';
        ctx.font = '700 10px "Orbitron", monospace';
        ctx.fillText(labels[b], bx + 6, by + 13);
        k++;
      });
      ctx.restore();
    },

    /* ---------------- HUD ---------------- */
    updateHUD(isTraining) {
      const f1 = S.f1,
        f2 = S.f2;
      if (!f1 || !f2) return;

      const setBar = (id, ratio, trailRatio) => {
        const el = document.getElementById(id);
        if (el) el.style.transform = 'scaleX(' + U.clamp(ratio, 0, 1) + ')';
        const tr = document.getElementById(id + 'Trail');
        if (tr) tr.style.transform = 'scaleX(' + U.clamp(trailRatio, 0, 1) + ')';
      };

      // 延迟血条
      f1.trailHp = f1.trailHp == null ? 1 : U.lerp(f1.trailHp, f1.hp / f1.maxHp, 0.06);
      f2.trailHp = f2.trailHp == null ? 1 : U.lerp(f2.trailHp, f2.hp / f2.maxHp, 0.06);
      if (f1.hp / f1.maxHp > f1.trailHp) f1.trailHp = f1.hp / f1.maxHp;
      if (f2.hp / f2.maxHp > f2.trailHp) f2.trailHp = f2.hp / f2.maxHp;

      setBar('hp1', f1.hp / f1.maxHp, f1.trailHp);
      setBar('hp2', f2.hp / f2.maxHp, f2.trailHp);

      const m1 = document.getElementById('meter1');
      const m2 = document.getElementById('meter2');
      if (m1) m1.style.transform = 'scaleX(' + U.clamp(f1.meter / 300, 0, 1) + ')';
      if (m2) m2.style.transform = 'scaleX(' + U.clamp(f2.meter / 300, 0, 1) + ')';
      // 满一格就能放超必杀 → 高亮提示
      const box1 = document.getElementById('mbox1');
      const box2 = document.getElementById('mbox2');
      if (box1) box1.classList.toggle('ready', f1.meter >= 100);
      if (box2) box2.classList.toggle('ready', f2.meter >= 100);

      const kh = document.getElementById('keyHint');
      if (kh) {
        const showHint =
          (S.screen === 'play' || S.screen === 'training') &&
          S.phase === 'fight' &&
          (S.fightFrames || 0) < 420;
        kh.classList.toggle('on', showHint);
      }

      const t = document.getElementById('timerVal');
      if (t) t.textContent = String(Math.ceil(S.timer / 60)).padStart(2, '0');

      // 连段
      const cEl = document.getElementById('comboDisp');
      if (cEl) {
        const cmb = f2.combo;
        if (cmb >= 2) {
          cEl.classList.add('on');
          cEl.querySelector('.cb-n').textContent = cmb;
          const dmgEl = cEl.querySelector('.cb-d');
          if (dmgEl) dmgEl.textContent = f2.comboDmg + ' DMG';
        } else {
          cEl.classList.remove('on');
        }
      }

      // 回合灯
      [1, 2].forEach((n) => {
        const el = document.getElementById('pips' + n);
        if (!el) return;
        const wins = (n === 1 ? f1.roundWins : f2.roundWins) || 0;
        el.querySelectorAll('.pip').forEach((p, i) => {
          p.classList.toggle('lit', i < wins);
        });
      });

      // 角色名
      const n1 = document.getElementById('name1');
      const n2 = document.getElementById('name2');
      if (n1 && n1.dataset.ch !== f1.charId) {
        const cc = G.CHARS[f1.charId];
        n1.textContent = cc.name;
        n1.style.color = cc.color;
        n1.dataset.ch = f1.charId;
        n1.dataset.set = '1';
      }
      if (n2 && n2.dataset.ch !== f2.charId) {
        const cc = G.CHARS[f2.charId];
        n2.textContent = cc.name;
        n2.style.color = cc.color;
        n2.dataset.ch = f2.charId;
        n2.dataset.set = '1';
      }
    },
  });

  /* ============================================================
     伤害应用(全局)
     ============================================================ */
  function applyDamage(att, def, move, point) {
    if (window.__dbg) window.__dbg.applied++;
    if (!att || !def || !move) return;
    if (def.st === ST.KO) return;
    if (def.invuln > 0) return;

    const dir = att.facing;
    const px = point ? point.x : def.x;
    const py = point ? point.y : def.y + 110;

    // ---- 防御判定 ----
    let blocked = false;
    const gt = def.guardType();
    const isThrow = move.guard === 'THROW' || move.isThrow;

    if (!isThrow && !def.isAir && gt !== 'none') {
      if (move.guard === 'LOW') blocked = gt === 'crouch';
      else if (move.guard === 'OVERHEAD') blocked = gt === 'stand';
      else blocked = true;
    }
    // 空中攻击落地前不防 / 投技不防
    if (isThrow) blocked = false;

    // ---- 防御成功 ----
    if (blocked) {
      const chip = move.chip || 0;
      if (chip > 0) def.hp = Math.max(1, def.hp - chip);
      def.enterBlockstun(move.blockstun || 8, { dir, pushback: move.blockPushback || 5 });
      def.combo = 0;
      def.comboDmg = 0;
      const stop = move.blockstop || 4;
      def.hitstop = stop;
      att.hitstop = stop;
      att.vx = -dir * 2.2;
      att.blockedConfirmed = true;
      if (!move.isSuper) att.meter = Math.min(300, att.meter + Math.max(3, (move.meterGain || 6) * 0.5));
      def.meter = Math.min(300, def.meter + 5);
      G.FX.block(px, py, dir, att.char.color);
      G.SFX.play('block', 0.9);
      S.hitFlash = 3;
      return;
    }

    // ---- 命中 ----
    if (def.st !== ST.HIT && def.st !== ST.HIT_AIR && def.st !== ST.KNOCKDOWN) {
      def.combo = 0;
      def.comboDmg = 0;
    }
    def.combo++;
    def.comboTimer = 100;

    const maxScaleIdx = G.COMBO_SCALE.length - 1;
    const scale = G.COMBO_SCALE[Math.min(def.combo - 1, maxScaleIdx)];
    const dmg = Math.max(1, Math.round((move.dmg || 0) * scale + (move.isSuper ? 8 : 0)));
    def.comboDmg += dmg;

    const power0 = move.level === 3 ? 1.4 : move.level === 2 ? 1.0 : move.level === 1 ? 0.7 : 0.4;

    // ---- 霸体(AXEL 的震地拳):扣血但不进硬直 ----
    if (def.isArmored && def.isArmored() && def.hp - dmg > 0) {
      def.hp -= dmg;
      def.armorFlash = 12;
      def.hitstop = Math.max(2, Math.round((move.hitstop || 6) * 0.5));
      att.hitstop = move.hitstop || 6;
      att.hitConfirmed = true;
      att.meter = Math.min(300, att.meter + (move.meterGain || 8) * 1.2);
      def.meter = Math.min(300, def.meter + 8);
      def.vx *= 0.4;
      G.FX.hit(px, py, dir, '#ffd479', power0 * 0.7);
      G.FX.ring(px, py, '#ffb03a', 10, 78, 12);
      G.SFX.play('block', 1);
      S.hitFlash = 3;
      return;
    }

    const knockdown = !!move.knockdown || def.combo >= 10;
    def.enterHitstun(dmg, move.hitstun || 16, {
      dir,
      pushback: move.pushback || 3,
      crouch: def.st === ST.CROUCH || def.st === ST.BLOCK,
      knockdown,
      by: att,
    });

    // ---- 吸附(磁力钳 / 引力井 / 漩涡):把对手拽向自己 ----
    if (move.pull && def.st !== ST.KO) {
      const target = att.x + att.facing * 56;
      const delta = target - def.x;
      def.x += U.clamp(delta, -move.pull, move.pull);
      def.vx = 0;
      G.FX.ring(def.x, def.y + 70, att.char.color, 12, 96, 16);
    }

    // hitstop
    const stop = move.hitstop || 6;
    att.hitstop = stop;
    def.hitstop = stop;

    att.hitConfirmed = true;
    // 超必杀自身的命中不回能量(否则可以无限连放)
    if (!move.isSuper) att.meter = Math.min(300, att.meter + (move.meterGain || 8) * 1.2);
    def.meter = Math.min(300, def.meter + 2 + dmg * 0.06);

    // 视觉
    const power = move.level === 3 ? 1.4 : move.level === 2 ? 1.0 : move.level === 1 ? 0.7 : 0.4;
    G.FX.hit(px, py, dir, att.char.color, power);
    G.SFX.play(move.sfxHit || 'hit_light', move.level >= 1 ? 1 : 0.8);
    S.hitFlash = Math.round(2 + power * 4);

    if (move.level >= 2) {
      G.FX.slash(px, py, dir, att.char.color, 80 + power * 40, 2.2);
    }

    // 挑空
    if (move.knockdown && move.level >= 2) {
      def.vy = Math.max(def.vy, 6);
      def.y = Math.max(def.y, 2);
    }
  }

  function matchSeq(have, target) {
    let i = 0;
    for (let j = 0; j < have.length && i < target.length; j++) {
      if (have[j] === target[i]) i++;
    }
    return i >= target.length;
  }

  function drawDirArrow(ctx, cx, cy, d, color) {
    const map = {
      1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0], 6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1],
    };
    const v = map[d];
    if (!v) return;
    ctx.save();
    ctx.fillStyle = color;
    const len = 5;
    const ang = Math.atan2(v[1], v[0]);
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.7, -len * 0.7);
    ctx.lineTo(-len * 0.7, len * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  G.applyDamage = applyDamage;
})();
