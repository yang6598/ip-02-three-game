/* ============================================================
   NEON RIFT — rig.js (v2)
   程序化骨骼:两段 IK + 关键姿势库 + 每角色差异化造型
   性能:肢体不再逐段 shadowBlur(那是 2D canvas 最大的开销),
        改为躯干/头/武器三处重点发光 + 缓存渐变
   ============================================================ */
(function () {
  'use strict';
  const G = window.G;
  const { clamp, lerp } = G.U;

  /* ---------------- 骨骼尺寸(基准 s=1) ---------------- */
  const BONE = {
    torso: 54,
    neck: 16,
    headR: 15,
    upperArm: 40,
    foreArm: 38,
    thigh: 48,
    shin: 44,
    hipW: 15,
    shoulderW: 19,
  };

  function boneOf(char) {
    const s = (char && char.build && char.build.s) || 1;
    if (char && (!char._bone || char._boneS !== s)) {
      const b = {};
      for (const k in BONE) b[k] = BONE[k] * s;
      char._bone = b;
      char._boneS = s;
    }
    return (char && char._bone) || BONE;
  }

  /* ---------------- 基础姿势 ---------------- */
  const BASE = {
    hip: [0, 92],
    torso: 1.47,
    headTilt: 0,
    headOff: [0, 0],
    footL: [-27, 0],
    footR: [24, 0],
    handL: [-44, 124],
    handR: [56, 106],
    kneeL: 1,
    kneeR: 1,
    elbowL: -1,
    elbowR: -1,
    bodyRot: 0,
    eyeOpen: 1,
  };

  const POSE_KEYS = Object.keys(BASE);

  function clonePose(p) {
    return {
      hip: [p.hip[0], p.hip[1]],
      torso: p.torso,
      headTilt: p.headTilt,
      headOff: [p.headOff[0], p.headOff[1]],
      footL: [p.footL[0], p.footL[1]],
      footR: [p.footR[0], p.footR[1]],
      handL: [p.handL[0], p.handL[1]],
      handR: [p.handR[0], p.handR[1]],
      kneeL: p.kneeL,
      kneeR: p.kneeR,
      elbowL: p.elbowL,
      elbowR: p.elbowR,
      bodyRot: p.bodyRot,
      eyeOpen: p.eyeOpen,
    };
  }

  /** 整体缩放到角色体型(坐标是绝对值,所以要在最后统一缩放) */
  function scalePose(p, s) {
    if (s === 1) return p;
    p.hip[0] *= s; p.hip[1] *= s;
    p.headOff[0] *= s; p.headOff[1] *= s;
    p.footL[0] *= s; p.footL[1] *= s;
    p.footR[0] *= s; p.footR[1] *= s;
    p.handL[0] *= s; p.handL[1] *= s;
    p.handR[0] *= s; p.handR[1] *= s;
    return p;
  }

  function applyPatch(base, patch) {
    const out = clonePose(base);
    if (!patch) return out;
    for (const k in patch) {
      const v = patch[k];
      if (Array.isArray(v)) out[k] = [v[0], v[1]];
      else out[k] = v;
    }
    return out;
  }

  function lerpPose(a, b, t) {
    const out = clonePose(a);
    for (const k in b) {
      const av = a[k], bv = b[k];
      if (Array.isArray(bv)) out[k] = [lerp(av[0], bv[0], t), lerp(av[1], bv[1], t)];
      else if (typeof bv === 'number') out[k] = lerp(av, bv, t);
      else out[k] = bv;
    }
    return out;
  }

  /* ============================================================
     关键帧库
     ============================================================ */
  const K = {
    idle: [
      [0.0, {}],
      [0.5, { hip: [0, 89], handR: [57, 104], handL: [-43, 122], headOff: [0, -1.5] }],
      [1.0, {}],
    ],
    walkF: [
      [0.0, { hip: [0, 91], footL: [-30, 0], footR: [26, 0] }],
      [0.5, { hip: [3, 88], footL: [-16, 8], footR: [34, 0] }],
      [1.0, { hip: [0, 91], footL: [-30, 0], footR: [26, 0] }],
    ],
    walkB: [
      [0.0, { hip: [0, 91], footL: [-30, 0], footR: [26, 0] }],
      [0.5, { hip: [-3, 88], footL: [-34, 0], footR: [14, 7] }],
      [1.0, { hip: [0, 91], footL: [-30, 0], footR: [26, 0] }],
    ],
    crouch: [
      [0.0, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84], headOff: [0, -2] }],
      [1.0, { hip: [0, 58], torso: 1.31, footL: [-34, 0], footR: [30, 0], handL: [-30, 90], handR: [46, 82], headOff: [0, -3] }],
    ],
    jumpUp: [
      [0.0, { hip: [0, 96], footL: [-24, 22], footR: [26, 34], handL: [-38, 138], handR: [40, 132], torso: 1.5 }],
      [1.0, { hip: [0, 100], footL: [-20, 34], footR: [22, 44], handL: [-34, 146], handR: [44, 140], torso: 1.52 }],
    ],
    jumpFall: [
      [0.0, { hip: [0, 98], footL: [-26, 18], footR: [28, 10], handL: [-46, 96], handR: [58, 92], torso: 1.38 }],
      [1.0, { hip: [0, 96], footL: [-30, 6], footR: [34, 0], handL: [-50, 88], handR: [62, 84], torso: 1.34 }],
    ],
    land: [
      [0.0, { hip: [0, 74], footL: [-32, 0], footR: [30, 0], torso: 1.34, handL: [-40, 96], handR: [50, 88] }],
      [1.0, {}],
    ],
    punchL: [
      [0.0, {}],
      [0.30, { handR: [30, 118], torso: 1.42, handL: [-38, 128], hip: [-3, 92] }],
      [0.48, { handR: [104, 120], torso: 1.60, handL: [-36, 126], hip: [6, 91], footR: [28, 0] }],
      [0.62, { handR: [106, 119], torso: 1.59, handL: [-36, 126], hip: [6, 91], footR: [28, 0] }],
      [1.00, {}],
    ],
    punchH: [
      [0.0, {}],
      [0.26, { handR: [22, 124], torso: 1.34, handL: [-52, 116], hip: [-8, 90], footL: [-34, 0], footR: [22, 0] }],
      [0.46, { handR: [130, 116], torso: 1.78, handL: [-30, 118], hip: [14, 88], footL: [-40, 0], footR: [40, 0], headOff: [3, 0] }],
      [0.60, { handR: [132, 115], torso: 1.78, handL: [-30, 118], hip: [14, 88], footL: [-40, 0], footR: [40, 0], headOff: [3, 0] }],
      [1.00, {}],
    ],
    kickL: [
      [0.0, {}],
      [0.28, { footR: [40, 34], hip: [-6, 92], torso: 1.36, handL: [-48, 128] }],
      [0.46, { footR: [106, 88], hip: [-8, 92], torso: 1.30, handL: [-56, 118], handR: [34, 122], kneeR: 1 }],
      [0.64, { footR: [108, 87], hip: [-8, 92], torso: 1.30, handL: [-56, 118], handR: [34, 122], kneeR: 1 }],
      [1.00, {}],
    ],
    kickH: [
      [0.0, {}],
      [0.28, { footR: [26, 46], hip: [-10, 94], torso: 1.28, handL: [-60, 130], handR: [18, 132], footL: [-30, 0] }],
      [0.44, { footR: [132, 108], hip: [-6, 96], torso: 1.16, handL: [-66, 112], handR: [8, 140], footL: [-32, 0], headOff: [4, 0] }],
      [0.58, { footR: [134, 106], hip: [-6, 96], torso: 1.16, handL: [-66, 112], handR: [8, 140], footL: [-32, 0], headOff: [4, 0] }],
      [1.00, {}],
    ],
    crouchPunch: [
      [0.0, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84] }],
      [0.32, { hip: [-3, 60], torso: 1.26, footL: [-34, 0], footR: [30, 0], handL: [-32, 90], handR: [20, 92] }],
      [0.50, { hip: [4, 59], torso: 1.44, footL: [-36, 0], footR: [34, 0], handL: [-30, 92], handR: [92, 96] }],
      [0.66, { hip: [4, 59], torso: 1.44, footL: [-36, 0], footR: [34, 0], handL: [-30, 92], handR: [94, 96] }],
      [1.00, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84] }],
    ],
    crouchKick: [
      [0.0, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84] }],
      [0.30, { hip: [-2, 62], torso: 1.24, footL: [-36, 0], footR: [22, 20], handL: [-34, 96], handR: [40, 88] }],
      [0.48, { hip: [-4, 60], torso: 1.20, footL: [-38, 0], footR: [80, 30], handL: [-40, 90], handR: [28, 96] }],
      [0.64, { hip: [-4, 60], torso: 1.20, footL: [-38, 0], footR: [82, 30], handL: [-40, 90], handR: [28, 96] }],
      [1.00, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84] }],
    ],
    sweep: [
      [0.0, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84] }],
      [0.24, { hip: [-10, 52], torso: 1.10, footL: [-38, 0], footR: [16, 12], handL: [-50, 62], handR: [30, 66] }],
      [0.44, { hip: [-6, 40], torso: 0.94, footL: [-40, 0], footR: [124, 10], handL: [-58, 16], handR: [6, 30], headOff: [-4, 0] }],
      [0.60, { hip: [-6, 39], torso: 0.94, footL: [-40, 0], footR: [126, 10], handL: [-58, 14], handR: [6, 28], headOff: [-4, 0] }],
      [1.00, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84] }],
    ],
    jumpKickL: [
      [0.0, { hip: [0, 98], footL: [-26, 18], footR: [28, 10], handL: [-46, 96], handR: [58, 92], torso: 1.38 }],
      [0.30, { hip: [0, 98], footL: [-22, 26], footR: [40, 42], handL: [-48, 104], handR: [44, 100], torso: 1.34 }],
      [0.52, { hip: [2, 96], footL: [-26, 30], footR: [94, 56], handL: [-54, 96], handR: [30, 108], torso: 1.26 }],
      [1.00, { hip: [0, 98], footL: [-26, 18], footR: [28, 10], handL: [-46, 96], handR: [58, 92], torso: 1.38 }],
    ],
    jumpKickH: [
      [0.0, { hip: [0, 98], footL: [-26, 18], footR: [28, 10], handL: [-46, 96], handR: [58, 92], torso: 1.38 }],
      [0.26, { hip: [-4, 102], footL: [-20, 40], footR: [26, 48], handL: [-56, 128], handR: [26, 130], torso: 1.24 }],
      [0.46, { hip: [4, 96], footL: [-30, 24], footR: [106, 30], handL: [-60, 92], handR: [16, 120], torso: 1.14, headOff: [4, 0] }],
      [0.62, { hip: [4, 95], footL: [-30, 24], footR: [108, 28], handL: [-60, 90], handR: [16, 120], torso: 1.14, headOff: [4, 0] }],
      [1.00, { hip: [0, 98], footL: [-26, 18], footR: [28, 10], handL: [-46, 96], handR: [58, 92], torso: 1.38 }],
    ],
    blockStand: [
      [0.0, { hip: [-8, 90], torso: 1.55, footL: [-34, 0], footR: [18, 0], handL: [34, 132], handR: [44, 118], headOff: [-3, 0] }],
      [1.0, { hip: [-9, 89], torso: 1.56, footL: [-35, 0], footR: [18, 0], handL: [35, 130], handR: [45, 116], headOff: [-3, 0] }],
    ],
    blockCrouch: [
      [0.0, { hip: [-10, 58], torso: 1.34, footL: [-38, 0], footR: [24, 0], handL: [28, 96], handR: [40, 84], headOff: [-4, 0] }],
      [1.0, { hip: [-11, 57], torso: 1.35, footL: [-39, 0], footR: [24, 0], handL: [29, 95], handR: [41, 83], headOff: [-4, 0] }],
    ],
    hitStand: [
      [0.0, { hip: [-10, 90], torso: 1.72, footL: [-40, 0], footR: [14, 0], handL: [-58, 130], handR: [30, 140], headOff: [-8, 0], headTilt: -0.24 }],
      [0.4, { hip: [-6, 86], torso: 1.62, footL: [-38, 0], footR: [16, 0], handL: [-54, 120], handR: [36, 124], headOff: [-5, 0], headTilt: -0.14 }],
      [1.0, {}],
    ],
    hitCrouch: [
      [0.0, { hip: [-10, 54], torso: 1.44, footL: [-42, 0], footR: [18, 0], handL: [-46, 82], handR: [24, 96], headOff: [-8, 0], headTilt: -0.3 }],
      [0.5, { hip: [-6, 58], torso: 1.36, handL: [-40, 88], handR: [34, 90], headOff: [-4, 0], headTilt: -0.12 }],
      [1.0, { hip: [0, 60], torso: 1.30, footL: [-34, 0], footR: [30, 0], handL: [-30, 92], handR: [46, 84] }],
    ],
    hitAir: [
      [0.0, { hip: [0, 96], torso: 1.75, footL: [-34, 26], footR: [8, 14], handL: [-62, 128], handR: [26, 148], headOff: [-8, 0], headTilt: -0.28 }],
      [1.0, { hip: [0, 94], torso: 1.68, footL: [-38, 20], footR: [4, 10], handL: [-66, 120], handR: [22, 142], headOff: [-6, 0], headTilt: -0.2 }],
    ],
    knockdown: [
      [0.0, { hip: [6, 34], torso: 1.9, footL: [-46, 6], footR: [-14, 12], handL: [-64, 60], handR: [-30, 74], headOff: [-14, 0], headTilt: -0.5 }],
      [1.0, { hip: [12, 22], torso: 2.0, footL: [-52, 4], footR: [-20, 8], handL: [-72, 40], handR: [-38, 52], headOff: [-18, 0], headTilt: -0.6 }],
    ],
    wakeup: [
      [0.0, { hip: [10, 26], torso: 1.9, footL: [-48, 4], footR: [-16, 8], handL: [-66, 44], handR: [-36, 56], headOff: [-14, 0], headTilt: -0.5 }],
      [0.6, { hip: [-4, 62], torso: 1.36, footL: [-36, 0], footR: [24, 0], handL: [-40, 90], handR: [38, 92], headOff: [-4, 0], headTilt: -0.1 }],
      [1.0, {}],
    ],
    dashF: [
      [0.0, { hip: [-10, 86], torso: 1.30, footL: [-44, 0], footR: [30, 0], handL: [-64, 106], handR: [30, 120], headOff: [3, 0] }],
      [0.5, { hip: [-2, 84], torso: 1.24, footL: [-30, 10], footR: [44, 0], handL: [-58, 112], handR: [36, 116], headOff: [4, 0] }],
      [1.0, { hip: [-10, 86], torso: 1.30, footL: [-44, 0], footR: [30, 0], handL: [-64, 106], handR: [30, 120], headOff: [3, 0] }],
    ],
    dashB: [
      [0.0, { hip: [-6, 92], torso: 1.62, footL: [-30, 12], footR: [22, 0], handL: [-40, 134], handR: [46, 126], headOff: [-2, 0] }],
      [1.0, { hip: [-4, 94], torso: 1.64, footL: [-26, 18], footR: [18, 0], handL: [-36, 138], handR: [48, 130], headOff: [-2, 0] }],
    ],
    castBolt: [
      [0.0, {}],
      [0.28, { hip: [-10, 90], torso: 1.30, footL: [-38, 0], footR: [22, 0], handL: [-56, 96], handR: [-16, 104], headOff: [-2, 0] }],
      [0.50, { hip: [8, 88], torso: 1.66, footL: [-40, 0], footR: [36, 0], handL: [-20, 112], handR: [72, 118], headOff: [4, 0] }],
      [0.68, { hip: [8, 88], torso: 1.66, footL: [-40, 0], footR: [36, 0], handL: [-20, 112], handR: [74, 118], headOff: [4, 0] }],
      [1.00, {}],
    ],
    risingUppercut: [
      [0.0, { hip: [-4, 78], torso: 1.30, footL: [-30, 0], footR: [22, 0], handL: [-30, 96], handR: [10, 108] }],
      [0.22, { hip: [0, 104], footL: [-16, 18], footR: [16, 10], handL: [-46, 132], handR: [34, 168], torso: 1.66 }],
      [0.48, { hip: [4, 118], torso: 1.72, footL: [-24, 34], footR: [22, 26], handL: [-56, 118], handR: [30, 208], headOff: [0, 4] }],
      [0.72, { hip: [0, 108], torso: 1.56, footL: [-30, 16], footR: [28, 12], handL: [-46, 128], handR: [44, 176] }],
      [1.00, {}],
    ],
    rushSlash: [
      [0.0, { hip: [-8, 86], torso: 1.32, footL: [-40, 0], footR: [24, 0], handL: [-58, 108], handR: [26, 116] }],
      [0.24, { hip: [-2, 84], torso: 1.24, footL: [-34, 12], footR: [38, 0], handL: [-64, 100], handR: [44, 104], headOff: [5, 0] }],
      [0.46, { hip: [10, 84], torso: 1.62, footL: [-30, 16], footR: [44, 0], handL: [-46, 116], handR: [106, 118], headOff: [6, 0] }],
      [0.66, { hip: [8, 86], torso: 1.58, footL: [-32, 12], footR: [42, 0], handL: [-48, 112], handR: [102, 114], headOff: [5, 0] }],
      [1.00, {}],
    ],
    shadowEdge: [
      [0.0, {}],
      [0.26, { hip: [-12, 90], torso: 1.30, footL: [-40, 0], footR: [22, 0], handL: [-62, 132], handR: [-30, 148], headOff: [-4, 0] }],
      [0.46, { hip: [12, 86], torso: 1.86, footL: [-34, 0], footR: [42, 0], handL: [-30, 118], handR: [120, 104], headOff: [6, 0] }],
      [0.64, { hip: [12, 86], torso: 1.86, footL: [-34, 0], footR: [42, 0], handL: [-30, 118], handR: [122, 102], headOff: [6, 0] }],
      [1.00, {}],
    ],
    commandGrab: [
      [0.0, {}],
      [0.26, { hip: [-6, 84], torso: 1.36, footL: [-36, 0], footR: [26, 0], handL: [-20, 118], handR: [30, 126] }],
      [0.46, { hip: [14, 82], torso: 1.70, footL: [-38, 0], footR: [44, 0], handL: [30, 122], handR: [98, 132], headOff: [5, 0] }],
      [0.68, { hip: [14, 82], torso: 1.70, footL: [-38, 0], footR: [44, 0], handL: [30, 122], handR: [100, 132], headOff: [5, 0] }],
      [1.00, {}],
    ],
    throwExec: [
      [0.0, { hip: [8, 84], torso: 1.62, handL: [26, 118], handR: [70, 126], footL: [-34, 0], footR: [34, 0] }],
      [0.30, { hip: [-6, 90], torso: 1.30, handL: [10, 128], handR: [56, 138], footL: [-38, 0], footR: [30, 0] }],
      [0.55, { hip: [10, 80], torso: 1.78, handL: [40, 90], handR: [86, 96], footL: [-36, 0], footR: [42, 0], headOff: [6, 0] }],
      [1.00, {}],
    ],
    superRain: [
      [0.0, { hip: [0, 88], torso: 1.44, handL: [-30, 120], handR: [40, 124] }],
      [0.16, { hip: [0, 92], torso: 1.58, footL: [-32, 0], footR: [26, 0], handL: [-46, 168], handR: [36, 176], headOff: [0, 3] }],
      [0.40, { hip: [0, 96], torso: 1.60, footL: [-30, 0], footR: [28, 0], handL: [-40, 196], handR: [42, 200], headOff: [0, 4] }],
      [0.72, { hip: [0, 94], torso: 1.60, footL: [-30, 0], footR: [28, 0], handL: [-40, 192], handR: [42, 196], headOff: [0, 4] }],
      [1.00, {}],
    ],
    superGrab: [
      [0.0, {}],
      [0.18, { hip: [-10, 86], torso: 1.40, footL: [-38, 0], footR: [24, 0], handL: [-56, 116], handR: [46, 112] }],
      [0.36, { hip: [6, 82], torso: 1.66, footL: [-36, 0], footR: [38, 0], handL: [10, 128], handR: [80, 134], headOff: [4, 0] }],
      [0.78, { hip: [6, 82], torso: 1.66, footL: [-36, 0], footR: [38, 0], handL: [10, 128], handR: [80, 134], headOff: [4, 0] }],
      [1.00, {}],
    ],
    win: [
      [0.0, {}],
      [0.25, { hip: [0, 96], torso: 1.52, handR: [40, 172], handL: [-40, 116], headOff: [0, 2] }],
      [0.55, { hip: [0, 98], torso: 1.54, handR: [34, 188], handL: [-46, 120], headOff: [0, 3] }],
      [1.00, { hip: [0, 96], torso: 1.52, handR: [38, 178], handL: [-44, 118], headOff: [0, 2] }],
    ],
    ko: [
      [0.0, { hip: [0, 40], torso: 1.9, footL: [-44, 2], footR: [-16, 6], handL: [-64, 50], handR: [-34, 62], headOff: [-14, 0], headTilt: -0.6 }],
      [1.0, { hip: [16, 16], torso: 2.1, footL: [-56, 1], footR: [-26, 4], handL: [-78, 30], handR: [-46, 40], headOff: [-20, 0], headTilt: -0.8 }],
    ],
  };

  const ANIM_MAP = {
    idle: 'idle', walkF: 'walkF', walkB: 'walkB', crouch: 'crouch',
    jumpUp: 'jumpUp', jumpFall: 'jumpFall', land: 'land',
    punchL: 'punchL', punchH: 'punchH', kickL: 'kickL', kickH: 'kickH',
    crouchPunch: 'crouchPunch', crouchKick: 'crouchKick', sweep: 'sweep',
    jumpKickL: 'jumpKickL', jumpKickH: 'jumpKickH',
    blockStand: 'blockStand', blockCrouch: 'blockCrouch',
    hitStand: 'hitStand', hitCrouch: 'hitCrouch', hitAir: 'hitAir',
    knockdown: 'knockdown', wakeup: 'wakeup',
    dashF: 'dashF', dashB: 'dashB',
    castBolt: 'castBolt', risingUppercut: 'risingUppercut',
    rushSlash: 'rushSlash', shadowEdge: 'shadowEdge',
    commandGrab: 'commandGrab', throwExec: 'throwExec',
    superRain: 'superRain', superGrab: 'superGrab',
    win: 'win', ko: 'ko',
  };

  function sampleKeys(keys, t) {
    if (!keys || !keys.length) return clonePose(BASE);
    if (t <= keys[0][0]) return applyPatch(BASE, keys[0][1]);
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t >= a[0] && t <= b[0]) {
        const span = b[0] - a[0] || 1;
        let u = (t - a[0]) / span;
        u = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        return lerpPose(applyPatch(BASE, a[1]), applyPatch(BASE, b[1]), u);
      }
    }
    return applyPatch(BASE, keys[keys.length - 1][1]);
  }

  /* ---------------- 两段 IK ---------------- */
  function solveIK(root, target, l1, l2, bend) {
    let dx = target[0] - root[0], dy = target[1] - root[1];
    let d = Math.hypot(dx, dy);
    const maxD = l1 + l2 - 0.5;
    const minD = Math.abs(l1 - l2) + 0.5;
    if (d > maxD) {
      const s = maxD / (d || 1); dx *= s; dy *= s; d = maxD;
    } else if (d < minD) {
      const s = minD / (d || 1); dx *= s; dy *= s; d = minD;
    }
    const base = Math.atan2(dy, dx);
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const ang = base + Math.acos(cosA) * bend;
    return [root[0] + Math.cos(ang) * l1, root[1] + Math.sin(ang) * l1];
  }

  function solveSkeleton(pose, char) {
    const B = boneOf(char);
    const hip = pose.hip;
    const sh = [hip[0] + Math.cos(pose.torso) * B.torso, hip[1] + Math.sin(pose.torso) * B.torso];
    const neck = [hip[0] + Math.cos(pose.torso) * (B.torso + B.neck), hip[1] + Math.sin(pose.torso) * (B.torso + B.neck)];
    const head = [
      neck[0] + Math.cos(pose.torso + pose.headTilt) * (B.headR * 0.9) + pose.headOff[0],
      neck[1] + Math.sin(pose.torso + pose.headTilt) * (B.headR * 0.9) + pose.headOff[1],
    ];
    const kneeL = solveIK(hip, pose.footL, B.thigh, B.shin, pose.kneeL);
    const kneeR = solveIK(hip, pose.footR, B.thigh, B.shin, pose.kneeR);
    const elbowL = solveIK(sh, pose.handL, B.upperArm, B.foreArm, pose.elbowL);
    const elbowR = solveIK(sh, pose.handR, B.upperArm, B.foreArm, pose.elbowR);
    return { hip, sh, neck, head, kneeL, kneeR, elbowL, elbowR, B };
  }

  /* ---------------- 绘制基元 ---------------- */
  function taper(ctx, p1, p2, r1, r2) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const a = Math.atan2(dy, dx);
    const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
    ctx.beginPath();
    ctx.arc(p1[0], p1[1], r1, a + Math.PI / 2, a - Math.PI / 2, true);
    ctx.lineTo(p2[0] + px * r2, p2[1] + py * r2);
    ctx.arc(p2[0], p2[1], r2, a - Math.PI / 2, a + Math.PI / 2, true);
    ctx.closePath();
  }

  /* 渐变缓存(每个角色一份,避免每帧 createGradient) */
  function bodyGrad(ctx, char) {
    const s = char.build ? char.build.s : 1;
    const key = 190 * s;
    if (char._grad && char._gradKey === key) return char._grad;
    const g = ctx.createLinearGradient(0, 0, 0, key);
    g.addColorStop(0, '#16293c');
    g.addColorStop(0.5, '#132436');
    g.addColorStop(1, '#0a1420');
    char._grad = g;
    char._gradKey = key;
    return g;
  }

  /* ============================================================
     主绘制
     ============================================================ */
  function drawBody(ctx, pose, char, o) {
    o = o || {};
    const s = solveSkeleton(pose, char);
    const B = s.B;
    const col = char.color;
    const col2 = char.color2;
    const style = char.style || {};
    const glowMul = o.glowMul == null ? 1 : o.glowMul;
    const wf = (char.build && char.build.w) || 1;   // 粗细
    const lite = !!o.lite;                          // 残影/低画质:跳过发光

    function part(p1, p2, r1, r2, fill, stroke, lw) {
      taper(ctx, p1, p2, r1 * wf, r2 * wf);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw || 2.2;
        ctx.stroke();
      }
    }

    // ---- 背部装饰(画在身体后面)----
    drawBack(ctx, pose, s, char, style, glowMul, lite);

    // ---- 后腿(远端) ----
    part(s.hip, s.kneeL, 15, 11.5, '#14283c', lite ? null : col2, 1.8);
    part(s.kneeL, pose.footL, 11.5, 7.5, '#14283c', lite ? null : col2, 1.8);
    drawFoot(ctx, pose.footL, '#16293e', col2, lite);

    // ---- 后臂 ----
    part(s.sh, s.elbowL, 11, 8.5, '#152c40', lite ? null : col2, 1.8);
    part(s.elbowL, pose.handL, 8.5, 6, '#152c40', lite ? null : col2, 1.8);
    ctx.beginPath();
    ctx.arc(pose.handL[0], pose.handL[1], 6.5 * wf, 0, Math.PI * 2);
    ctx.fillStyle = col2;
    ctx.fill();

    // ---- 躯干 ----
    taper(ctx, s.hip, s.sh, 19 * wf, (B.shoulderW + 2) * wf);
    ctx.fillStyle = bodyGrad(ctx, char);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    if (!lite) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 13 * glowMul;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 躯干内部霓虹纹理
    drawChest(ctx, s, char, style, B, wf, lite);

    // 腰带
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3 * wf;
    if (!lite) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 9 * glowMul;
    }
    ctx.beginPath();
    ctx.moveTo(s.hip[0] - 15 * wf, s.hip[1] + 3);
    ctx.lineTo(s.hip[0] + 15 * wf, s.hip[1] + 1);
    ctx.stroke();
    ctx.restore();

    // ---- 前腿 ----
    part(s.hip, s.kneeR, 16, 12, '#19304a', lite ? null : col, 2.2);
    part(s.kneeR, pose.footR, 12, 8, '#19304a', lite ? null : col, 2.2);
    drawFoot(ctx, pose.footR, '#12202e', col, lite);

    // ---- 头 ----
    drawHead(ctx, pose, s, char, o);

    // ---- 前臂 ----
    part(s.sh, s.elbowR, 12, 9, '#1a334c', lite ? null : col, 2.2);
    part(s.elbowR, pose.handR, 9, 6.5, '#1a334c', lite ? null : col, 2.2);

    // ---- 手 / 武器 ----
    drawWeapon(ctx, pose.handR, char, style, glowMul, lite, wf);

    // ---- 护肩 ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.sh[0], s.sh[1], B.shoulderW * wf, 0, Math.PI * 2);
    ctx.fillStyle = '#122132';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    if (!lite) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 11 * glowMul;
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFoot(ctx, foot, fill, stroke, lite) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    G.roundRect(ctx, foot[0] - 9, foot[1] - 3, 32, 12, 4.5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 胸口部件 ---------------- */
  function drawChest(ctx, s, char, style, B, wf, lite) {
    const col = char.color;
    const type = style.chest || 'lines';
    ctx.save();
    taper(ctx, s.hip, s.sh, 17 * wf, B.shoulderW * wf);
    ctx.clip();
    if (type === 'lines') {
      const cg = ctx.createLinearGradient(0, 90, 0, 150);
      cg.addColorStop(0, 'rgba(255,255,255,0)');
      cg.addColorStop(0.6, col + 'aa');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(-30, 70, 60, 90);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-20 + i * 8, 78 + i * 16);
        ctx.lineTo(18 + i * 8, 92 + i * 16);
        ctx.stroke();
      }
    } else if (type === 'vent') {
      // 重装:横向散热格栅
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      for (let i = 0; i < 4; i++) ctx.fillRect(-22, 96 + i * 11, 44, 6);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-20, 94); ctx.lineTo(22, 94);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-20, 146); ctx.lineTo(22, 146);
      ctx.stroke();
    } else if (type === 'orb') {
      // 星:胸口能量球
      const r = 11;
      const g = ctx.createRadialGradient(0, 120, 0, 0, 120, r * 2.4);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 120, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, 120, r * 2.2, r * 0.7, 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- 背部装饰 ---------------- */
  function drawBack(ctx, pose, s, char, style, glowMul, lite) {
    const col = char.color;
    const t = style.back || 'none';
    if (t === 'none') return;
    ctx.save();
    if (!lite) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 * glowMul;
    }
    if (t === 'antenna') {
      // 两根向后上的光羽
      ctx.strokeStyle = char.hairColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.85;
      const h = s.head;
      ctx.beginPath();
      ctx.moveTo(h[0] - 6, h[1] + 6);
      ctx.quadraticCurveTo(h[0] - 40, h[1] + 22, h[0] - 62, h[1] - 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(h[0] - 4, h[1] - 2);
      ctx.quadraticCurveTo(h[0] - 34, h[1] + 6, h[0] - 52, h[1] - 16);
      ctx.stroke();
    } else if (t === 'scarf') {
      // 飘带:两段折线,带摆动
      const ph = Math.sin(pose.torso * 3 + performance.now() * 0.004) * 4;
      ctx.strokeStyle = col;
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.moveTo(s.sh[0] - 6, s.sh[1] + 4);
      ctx.quadraticCurveTo(s.sh[0] - 40, s.sh[1] + 6 + ph, s.sh[0] - 70, s.sh[1] - 14 + ph);
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(s.sh[0] - 4, s.sh[1] - 2);
      ctx.quadraticCurveTo(s.sh[0] - 34, s.sh[1] - 14 - ph, s.sh[0] - 58, s.sh[1] - 32 - ph);
      ctx.stroke();
    } else if (t === 'plating') {
      // 背甲:厚重弧形
      ctx.fillStyle = '#1b2a3c';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(s.sh[0] - 4, s.sh[1] + 6);
      ctx.quadraticCurveTo(s.sh[0] - 34, s.sh[1] - 4, s.sh[0] - 30, s.sh[1] - 44);
      ctx.quadraticCurveTo(s.sh[0] - 14, s.sh[1] - 30, s.sh[0] - 2, s.sh[1] - 24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (t === 'cape') {
      // 披风:大三角,下摆飘
      const ph = Math.sin(performance.now() * 0.003) * 5;
      ctx.fillStyle = char.colorDim;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(s.sh[0] + 2, s.sh[1] + 8);
      ctx.quadraticCurveTo(s.sh[0] - 46, s.sh[1] - 20, s.sh[0] - 54 + ph, s.hip[1] - 26);
      ctx.lineTo(s.hip[0] - 26, s.hip[1] + 4);
      ctx.quadraticCurveTo(s.hip[0] - 8, s.sh[1], s.sh[0] + 2, s.sh[1] + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (t === 'wing') {
      // 光翼:两片羽,半透明
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = col;
      for (let i = 0; i < 2; i++) {
        const off = i * 12;
        ctx.beginPath();
        ctx.moveTo(s.sh[0] - 4, s.sh[1] - 4 - off);
        ctx.quadraticCurveTo(s.sh[0] - 50, s.sh[1] - 34 - off, s.sh[0] - 74, s.sh[1] - 8 - off);
        ctx.quadraticCurveTo(s.sh[0] - 44, s.sh[1] - 10 - off, s.sh[0] - 4, s.sh[1] + 6 - off);
        ctx.closePath();
        ctx.fill();
      }
    } else if (t === 'ribbon') {
      const ph = Math.sin(performance.now() * 0.005) * 6;
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(s.sh[0] - 2, s.sh[1] + 2);
      ctx.quadraticCurveTo(s.sh[0] - 38, s.sh[1] + 10 + ph, s.sh[0] - 66, s.sh[1] - 8 + ph);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- 头部 ---------------- */
  function drawHead(ctx, pose, s, char, o) {
    const col = char.color;
    const style = char.style || {};
    const kind = style.head || 'visor';
    const hs = (char.build && char.build.head) || 1;
    const tilt = pose.torso + pose.headTilt;
    const h = s.head;
    const glowMul = o.glowMul == null ? 1 : o.glowMul;

    ctx.save();
    ctx.translate(h[0], h[1]);
    ctx.rotate(tilt - Math.PI / 2);
    ctx.scale(hs, hs);

    const eyeOpen = pose.eyeOpen;

    if (kind === 'hood') {
      // 兜帽:上方尖锥 + 前方开口
      ctx.beginPath();
      ctx.moveTo(-2, -18);
      ctx.quadraticCurveTo(-20, -6, -16, 12);
      ctx.quadraticCurveTo(-6, 18, 4, 14);
      ctx.quadraticCurveTo(14, 6, 12, -6);
      ctx.quadraticCurveTo(8, -18, -2, -18);
      ctx.closePath();
      const hg = ctx.createLinearGradient(0, -18, 0, 14);
      hg.addColorStop(0, '#1b1230');
      hg.addColorStop(1, '#0b0818');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 * glowMul;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 眼缝
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(11, -1);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.6;
      ctx.globalAlpha = eyeOpen;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (kind === 'helm') {
      // 重盔:方头 + 单眼横条 + 两侧护耳
      ctx.beginPath();
      ctx.moveTo(-14, -14);
      ctx.lineTo(8, -16);
      ctx.lineTo(15, -4);
      ctx.lineTo(12, 14);
      ctx.lineTo(-12, 15);
      ctx.lineTo(-16, 4);
      ctx.closePath();
      const hg = ctx.createLinearGradient(0, -16, 0, 15);
      hg.addColorStop(0, '#2a2216');
      hg.addColorStop(1, '#12100a');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.6;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 * glowMul;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 眼条
      ctx.fillStyle = col;
      ctx.globalAlpha = eyeOpen;
      ctx.fillRect(-2, -6, 15, 5);
      ctx.globalAlpha = 1;
      // 护耳
      ctx.fillStyle = '#1a1710';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(-4, 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'crown') {
      // 尖冠 + 竖眼
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 15.5, 0, 0, Math.PI * 2);
      const hg = ctx.createLinearGradient(0, -16, 0, 14);
      hg.addColorStop(0, '#16283e');
      hg.addColorStop(1, '#0a1420');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 * glowMul;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 冠
      ctx.beginPath();
      ctx.moveTo(-11, -12);
      ctx.lineTo(-7, -27);
      ctx.lineTo(-1, -15);
      ctx.lineTo(4, -28);
      ctx.lineTo(9, -13);
      ctx.lineTo(13, -22);
      ctx.lineTo(12, -10);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 竖眼
      ctx.beginPath();
      ctx.ellipse(7, 0, 3, 7.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = eyeOpen;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (kind === 'halo') {
      // 光环
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 15, 0, 0, Math.PI * 2);
      const hg = ctx.createLinearGradient(0, -16, 0, 14);
      hg.addColorStop(0, '#1b2b22');
      hg.addColorStop(1, '#0a1410');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 * glowMul;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 眼带
      ctx.beginPath();
      ctx.moveTo(-9, 3);
      ctx.quadraticCurveTo(0, 8, 11, 2);
      ctx.quadraticCurveTo(0, 3, -9, 0.5);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = eyeOpen;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 头顶光环
      ctx.beginPath();
      ctx.ellipse(0, -26, 15, 4.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = char.hairColor;
      ctx.lineWidth = 2.6;
      ctx.globalAlpha = 0.9;
      ctx.shadowColor = char.hairColor;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    } else if (kind === 'band') {
      // 头带 + 短刺发
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 15, 0, 0, Math.PI * 2);
      const hg = ctx.createLinearGradient(0, -16, 0, 14);
      hg.addColorStop(0, '#1a2a3c');
      hg.addColorStop(1, '#0a1622');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 * glowMul;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 眼带
      ctx.beginPath();
      ctx.moveTo(-9, 2);
      ctx.quadraticCurveTo(0, 7, 11, 1.5);
      ctx.quadraticCurveTo(1, 2.5, -9, -0.5);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = eyeOpen;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 头带结
      ctx.fillStyle = char.hairColor;
      ctx.fillRect(-13, -6, 27, 4);
      ctx.beginPath();
      ctx.moveTo(-13, -4);
      ctx.lineTo(-24, -12);
      ctx.lineTo(-21, -3);
      ctx.closePath();
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // visor:圆头盔 + 横向眼带
      ctx.beginPath();
      ctx.ellipse(0, 0, 13.5, 16, 0, 0, Math.PI * 2);
      const hg = ctx.createLinearGradient(0, -16, 0, 16);
      hg.addColorStop(0, '#14273c');
      hg.addColorStop(1, '#0a1622');
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 13 * glowMul;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(-9, 3);
      ctx.quadraticCurveTo(0, 7.5, 11, 2);
      ctx.quadraticCurveTo(0, 2.5, -9, 0.5);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = eyeOpen;
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      // 高光
      ctx.beginPath();
      ctx.moveTo(-6, 3.2);
      ctx.quadraticCurveTo(1, 6, 9, 2.6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 0.85 * eyeOpen;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 发型(按 style.hair)
    const hair = style.hair || 'spike';
    if (hair !== 'none') {
      ctx.fillStyle = char.hairColor;
      ctx.globalAlpha = 0.85;
      if (hair === 'long') {
        ctx.beginPath();
        ctx.moveTo(-8, -10);
        ctx.quadraticCurveTo(-24, -6, -30, 22);
        ctx.quadraticCurveTo(-16, 12, -8, 8);
        ctx.closePath();
        ctx.fill();
      } else if (hair === 'bob') {
        ctx.beginPath();
        ctx.ellipse(-4, -8, 15, 11, 0.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (hair === 'tied') {
        ctx.beginPath();
        ctx.moveTo(-6, -12);
        ctx.quadraticCurveTo(-26, -18, -30, -2);
        ctx.quadraticCurveTo(-18, -10, -6, -6);
        ctx.closePath();
        ctx.fill();
      } else {
        // spike
        ctx.beginPath();
        ctx.moveTo(-8, -12);
        ctx.quadraticCurveTo(-18, -22, -26, -12);
        ctx.quadraticCurveTo(-16, -18, -7, -8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /* ---------------- 手 / 武器 ---------------- */
  function drawWeapon(ctx, hand, char, style, glowMul, lite, wf) {
    const col = char.color;
    const kind = style.weapon || 'fist';
    ctx.save();
    ctx.translate(hand[0], hand[1]);

    if (kind === 'blade') {
      // 细长刀锋:向后延伸 + 白芯
      ctx.rotate(-0.35);
      ctx.beginPath();
      ctx.moveTo(-4, -3);
      ctx.lineTo(74, -9);
      ctx.lineTo(86, 0);
      ctx.lineTo(72, 5);
      ctx.lineTo(-4, 3);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.9;
      if (!lite) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 16 * glowMul;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(4, -2);
      ctx.lineTo(78, -5);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.95;
      ctx.stroke();
      // 护手
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1a2a3c';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'gauntlet') {
      // 重型护手 + 三根尖刺
      ctx.beginPath();
      G.roundRect(ctx, -10, -11, 26, 22, 5);
      ctx.fillStyle = '#241d10';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.6;
      if (!lite) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 14 * glowMul;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(14, -8 + i * 8);
        ctx.lineTo(26, -5 + i * 8);
        ctx.lineTo(14, -2 + i * 8);
        ctx.closePath();
        ctx.fill();
      }
    } else if (kind === 'staff') {
      // 法杖:长杆 + 顶端菱形
      ctx.rotate(0.15);
      ctx.strokeStyle = '#20303f';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-14, 26);
      ctx.lineTo(16, -34);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-14, 26);
      ctx.lineTo(16, -34);
      ctx.stroke();
      ctx.save();
      ctx.translate(16, -34);
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(9, 0);
      ctx.lineTo(0, 12);
      ctx.lineTo(-9, 0);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      if (!lite) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 18 * glowMul;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    } else {
      // fist:圆拳 + 高光
      ctx.beginPath();
      ctx.arc(0, 0, 7 * wf, 0, Math.PI * 2);
      ctx.fillStyle = col;
      if (!lite) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 16 * glowMul;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(0, 0, 4 * wf, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ============================================================
     对外接口
     ============================================================ */
  const Rig = (G.Rig = {
    BASE,
    BONE,
    KEYS: K,
    ANIM_MAP,

    poseFor(char, anim, f, total, gf) {
      const key = ANIM_MAP[anim] || 'idle';
      const keys = K[key] || K.idle;
      let p;
      if (key === 'walkF' || key === 'walkB' || key === 'dashF') {
        const period = key === 'dashF' ? 10 : 20;
        p = sampleKeys(keys, (gf % period) / period);
      } else if (key === 'idle') {
        p = sampleKeys(keys, (gf % 100) / 100);
      } else {
        let t = total > 0 ? f / total : 0;
        p = sampleKeys(keys, clamp(t, 0, 1));
      }
      return scalePose(p, (char.build && char.build.s) || 1);
    },

    solve(pose, char) {
      return solveSkeleton(pose, char);
    },

    draw(ctx, pose, char, opts) {
      drawBody(ctx, pose, char, opts);
    },

    drawSkeletonDebug(ctx, pose, char, color) {
      const s = solveSkeleton(pose, char);
      const pts = [
        [s.hip, s.sh], [s.sh, s.head], [s.sh, s.elbowL], [s.elbowL, pose.handL],
        [s.sh, s.elbowR], [s.elbowR, pose.handR], [s.hip, s.kneeL], [s.kneeL, pose.footL],
        [s.hip, s.kneeR], [s.kneeR, pose.footR],
      ];
      ctx.save();
      ctx.strokeStyle = color || '#00ffc8';
      ctx.lineWidth = 1.5;
      pts.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      });
      [s.hip, s.sh, s.head, s.elbowL, s.elbowR, s.kneeL, s.kneeR].forEach((p) => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      });
      ctx.restore();
    },
  });
})();
