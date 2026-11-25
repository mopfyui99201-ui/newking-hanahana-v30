/* ============================================================
 * ニューキングハナハナV 設定判別エンジン
 * ------------------------------------------------------------
 * 【設定理論値定数テーブル】（実戦値に合わせてここを書き換える）
 *   設定1 : BIG 1/299  REG 1/496  合算 1/186  ベル(通常時) 1/7.63
 *   設定2 : 合算 1/180 のみ判明（BIG/REG/ベル内訳なし）
 *   設定3 : 合算 1/172 のみ判明
 *   設定4 : 合算 1/162 のみ判明
 *   設定V : BIG 1/253  REG 1/372  合算 1/150  ベル(通常時) 1/7.27
 *
 * 中間設定（1.5 / 2.5 / 3.5 / V-1.5 など）は SETTING_ORDER の
 * 隣接2設定の理論値を線形補間して自動生成する。
 * ============================================================ */

// 設定の並び順（線形補間・表示順に使用）
const SETTING_ORDER = [
  'setting1', 'setting1_5', 'setting2', 'setting2_5',
  'setting3', 'setting3_5', 'setting4', 'settingV_1_5', 'settingV'
];

// 既知の設定理論値（分母。prob = 1/denominator）
// null = そのイベントの理論値が未判明（尤度計算から除外される）
const HANAHANA_BASE_SETTINGS = {
  setting1:   { name: '設定1',   BIG: 299, REG: 496, COMB: 186, BELL: 7.63 },
  setting2:   { name: '設定2',   BIG: null, REG: null, COMB: 180, BELL: null },
  setting3:   { name: '設定3',   BIG: null, REG: null, COMB: 172, BELL: null },
  setting4:   { name: '設定4',   BIG: null, REG: null, COMB: 162, BELL: null },
  settingV:   { name: '設定V',   BIG: 253, REG: 372, COMB: 150, BELL: 7.27 }
};

// 中間設定の補間アンカー（前後どの既知設定を使うか）
const INTERPOLATED_SETTINGS = {
  setting1_5:  { name: '設定1.5',  from: 'setting1', to: 'setting2',   t: 0.5 },
  setting2_5:  { name: '設定2.5',  from: 'setting2', to: 'setting3',   t: 0.5 },
  setting3_5:  { name: '設定3.5',  from: 'setting3', to: 'setting4',   t: 0.5 },
  settingV_1_5:{ name: '設定V-1.5', from: 'setting4', to: 'settingV',   t: 0.5 }
};

/* ============================================================
 * 【ランプ・スイカ示唆の重み定数】
 *   尤度に対して「回数 × log(重み)」を加算する。
 *   1.0 = ニュートラル。>1 でその設定を支持、<1 でその設定を弱める。
 *   各色ごとに「その色が出た回数」だけ効果が乗る。
 *   ※実戦データが溜まったらここを調整する。
 * ============================================================ */
const HANAHANA_HINT_WEIGHTS = {
  // ボーナス終了時ハイビスカスランプ（色別）
  hibiscusLamp: {
    white:  { weight: 1.0, label: '白'   },
    blue:   { weight: 1.0, label: '青'   },
    yellow: { weight: 1.0, label: '黄'   },
    green:  { weight: 1.0, label: '緑'   },
    purple: { weight: 1.0, label: '紫'   },
    rainbow:{ weight: 1.0, label: '虹'   }
  },
  // BIG後半 ビタ押しサイドランプ（色別）
  bigSideLamp: {
    blue:    { weight: 1.0, label: '青'   },
    yellow:  { weight: 1.0, label: '黄'   },
    green:   { weight: 1.0, label: '緑'   },
    red:     { weight: 1.0, label: '赤'   },
    rainbow: { weight: 1.0, label: '虹'   }
  },
  // REG中 サイドランプ赤緑フラッシュ時のスイカ揃い回数（1回あたりの重み）
  regMiddleSuika:    { weight: 1.0 },
  // BIG前半中のスイカ出現回数（1回あたりの重み）
  bigFirstHalfSuika: { weight: 1.0 },
  // ベルカウントを尤度に含める強さ（0=無視, 1=通常）
  bellWeight: 1.0,
  // 合算カウントを尤度に含める強さ（0=無視, 1=通常）
  combWeight: 1.0
};

/* ============================================================
 * 数学ユーティリティ
 * ============================================================ */

// Lanczos近似による対数ガンマ関数
function lgamma(x) {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

// 対数二項分布確率質量: log C(n,k) + k*log(p) + (n-k)*log(1-p)
function logBinomial(n, k, p) {
  if (n <= 0 || k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 0 : -Infinity;
  if (p >= 1) return k === n ? 0 : -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)
       + k * Math.log(p) + (n - k) * Math.log(1 - p);
}

// 2つの分母値を線形補間して新しい分母を返す（null同士はnull）
function lerpDenom(a, b, t) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * t;
}

// 全設定（既知＋中間補間）を生成
function buildSettings() {
  const settings = {};
  for (const key of Object.keys(HANAHANA_BASE_SETTINGS)) {
    const s = HANAHANA_BASE_SETTINGS[key];
    settings[key] = {
      name: s.name,
      BIG: s.BIG == null ? null : 1 / s.BIG,
      REG: s.REG == null ? null : 1 / s.REG,
      COMB: s.COMB == null ? null : 1 / s.COMB,
      BELL: s.BELL == null ? null : 1 / s.BELL
    };
  }
  for (const key of Object.keys(INTERPOLATED_SETTINGS)) {
    const spec = INTERPOLATED_SETTINGS[key];
    const a = HANAHANA_BASE_SETTINGS[spec.from];
    const b = HANAHANA_BASE_SETTINGS[spec.to];
    const denom = f => lerpDenom(a[f], b[f], spec.t);
    settings[key] = {
      name: spec.name,
      BIG: denom('BIG'), REG: denom('REG'), COMB: denom('COMB'), BELL: denom('BELL')
    };
  }
  return settings;
}

const HANAHANA_SETTINGS = buildSettings();

/* ============================================================
 * 尤度計算
 * state 形式:
 * {
 *   startG, currentG,           // 打ち始めG / 現在G（総G = currentG - startG）
 *   big, reg, bell,             // 回数（未入力は0扱い、bell=nullでベル項を無視）
 *   lamps: {
 *     hibiscus: { white, blue, yellow, green, purple, rainbow },
 *     side:     { blue, yellow, green, red, rainbow },
 *     regSuika, bigSuika
 *   }
 * }
 * 戻り値: { probabilities: {settingKey: 0〜1の確率(合計1)}, logLikelihoods }
 * ============================================================ */
function calculateHanahanaProbabilities(state, options) {
  const opts = Object.assign({ excluded: [] }, options || {});
  const excluded = new Set(opts.excluded || []);
  const w = HANAHANA_HINT_WEIGHTS;
  const lamps = (state && state.lamps) || {};

  // 総ゲーム数（打ち始めG→現在Gの差分。直接 totalG を渡しても可）
  const n = (state && state.totalG != null)
    ? state.totalG
    : Math.max(0, ((state && state.currentG) || 0) - ((state && state.startG) || 0));

  const big = Math.max(0, (state && state.big) || 0);
  const reg = Math.max(0, (state && state.reg) || 0);
  const bell = state && state.bell != null ? Math.max(0, state.bell) : null;

  const logLikelihoods = {};
  const probabilities = {};

  for (const key of SETTING_ORDER) {
    if (excluded.has(key)) {
      logLikelihoods[key] = -Infinity;
      probabilities[key] = 0;
      continue;
    }
    const s = HANAHANA_SETTINGS[key];
    let ll = 0;

    if (n > 0) {
      // BIG / REG を個別に持つ設定（1, 1.5, V-1.5, V）は個別二項尤度
      if (s.BIG != null && s.REG != null) {
        ll += logBinomial(n, big, s.BIG);
        ll += logBinomial(n, reg, s.REG);
      } else if (s.COMB != null) {
        // 合算のみ判明の設定（2〜4系）は BIG+REG 合算で二項尤度
        ll += (w.combWeight == null ? 1 : w.combWeight)
            * logBinomial(n, big + reg, s.COMB);
      }
      // 通常時ベル（理論値がある設定のみ、bellWeight倍で加算）
      if (bell != null && s.BELL != null) {
        ll += (w.bellWeight == null ? 1 : w.bellWeight)
            * logBinomial(n, bell, s.BELL);
      }
    }

    // ---- 示唆カウントによる重み補正（回数 × log(重み)）----
    const hib = (lamps.hibiscus) || {};
    for (const color of Object.keys(w.hibiscusLamp)) {
      const cnt = Math.max(0, hib[color] || 0);
      if (cnt > 0) ll += cnt * Math.log(w.hibiscusLamp[color].weight);
    }
    const side = (lamps.side) || {};
    for (const color of Object.keys(w.bigSideLamp)) {
      const cnt = Math.max(0, side[color] || 0);
      if (cnt > 0) ll += cnt * Math.log(w.bigSideLamp[color].weight);
    }
    const regSuika = Math.max(0, lamps.regSuika || 0);
    if (regSuika > 0) ll += regSuika * Math.log(w.regMiddleSuika.weight);
    const bigSuika = Math.max(0, lamps.bigSuika || 0);
    if (bigSuika > 0) ll += bigSuika * Math.log(w.bigFirstHalfSuika.weight);

    logLikelihoods[key] = ll;
  }

  // ソフトマックス正規化（合計100%）
  const finite = SETTING_ORDER.filter(k => isFinite(logLikelihoods[k]));
  if (finite.length === 0) {
    // 全設定除外時は均等表示
    for (const k of SETTING_ORDER) probabilities[k] = 1 / SETTING_ORDER.length;
    return { probabilities, logLikelihoods };
  }
  const maxLL = Math.max(...finite.map(k => logLikelihoods[k]));
  let sum = 0;
  for (const k of finite) sum += Math.exp(logLikelihoods[k] - maxLL);
  for (const k of SETTING_ORDER) {
    probabilities[k] = isFinite(logLikelihoods[k])
      ? Math.exp(logLikelihoods[k] - maxLL) / sum
      : 0;
  }
  return { probabilities, logLikelihoods };
}

// Node / ブラウザ両対応のエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SETTING_ORDER, HANAHANA_BASE_SETTINGS, INTERPOLATED_SETTINGS,
    HANAHANA_SETTINGS, HANAHANA_HINT_WEIGHTS,
    lgamma, logBinomial, calculateHanahanaProbabilities
  };
}
if (typeof window !== 'undefined') {
  window.HanahanaCalc = {
    SETTING_ORDER, HANAHANA_BASE_SETTINGS, INTERPOLATED_SETTINGS,
    HANAHANA_SETTINGS, HANAHANA_HINT_WEIGHTS,
    lgamma, logBinomial, calculateHanahanaProbabilities
  };
}
