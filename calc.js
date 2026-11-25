/* ============================================================
 * ニューキングハナハナV-30 設定判別エンジン（プロ仕様ベイズ推定）
 * ------------------------------------------------------------
 * 【設定別理論値テーブル】（実戦解析データ準拠・分母表記）
 *   設定1 : BIG 1/299  REG 1/496  ベル 1/7.59  REG中スイカ 1/110
 *   設定2 : BIG 1/290  REG 1/475  ベル 1/47.47→1/7.47  REG中スイカ 1/95
 *   設定3 : BIG 1/278  REG 1/450  ベル 1/7.43  REG中スイカ 1/90
 *   設定4 : BIG 1/266  REG 1/415  ベル 1/7.33  REG中スイカ 1/80
 *   設定V : BIG 1/253  REG 1/372  ベル 1/7.28  REG中スイカ 1/64
 *   BIG前半スイカは全設定で約1/48〜1/50と差が小さいため微調整扱い。
 *
 * 中間設定（1.5 / 2.5 / 3.5 / V-1.5）は隣接設定の分母を線形補間。
 * ============================================================ */

const SETTING_ORDER = [
  'setting1', 'setting1_5', 'setting2', 'setting2_5',
  'setting3', 'setting3_5', 'setting4', 'settingV_1_5', 'settingV'
];

// 既知設定の理論値（分母。prob = 1/denominator）
const HANAHANA_BASE_SETTINGS = {
  setting1: { name: '設定1', BIG: 299,  REG: 496, BEL: 7.59, REG_SUIKA: 110, BIG_SUIKA: 50.0 },
  setting2: { name: '設定2', BIG: 290,  REG: 475, BEL: 7.47, REG_SUIKA: 95,  BIG_SUIKA: 49.5 },
  setting3: { name: '設定3', BIG: 278,  REG: 450, BEL: 7.43, REG_SUIKA: 90,  BIG_SUIKA: 49.0 },
  setting4: { name: '設定4', BIG: 266,  REG: 415, BEL: 7.33, REG_SUIKA: 80,  BIG_SUIKA: 48.5 },
  settingV:  { name: '設定V',  BIG: 253,  REG: 372, BEL: 7.28, REG_SUIKA: 64,  BIG_SUIKA: 48.0 }
};

const INTERPOLATED_SETTINGS = {
  setting1_5:   { name: '設定1.5',  from: 'setting1', to: 'setting2', t: 0.5 },
  setting2_5:   { name: '設定2.5',  from: 'setting2', to: 'setting3', t: 0.5 },
  setting3_5:   { name: '設定3.5',  from: 'setting3', to: 'setting4', t: 0.5 },
  settingV_1_5: { name: '設定V-1.5', from: 'setting4', to: 'settingV',  t: 0.5 }
};

/* ============================================================
 * 【尤度ウェイト・事前確率定数】（実戦データで調整可能）
 * ============================================================ */
const HANAHANA_WEIGHTS = {
  bell:        0.35,  // ベルは1日単位で荒れるため過信防止で弱める
  regSuika:    1.0,   // REG中スイカ（REG回数×10Gを母数）
  bigSuika:    0.15,  // BIG前半スイカは設定差が小さいため微調整係数
  specialBlink:0.5,   // 特殊点滅（回数×log重みで加算）
  retroSound:  0.5    // レトロサウンド（回数×log重みで加算）
};

// ハイビスカスランプ色別の設定別対数重み（回数×この値を尤度へ加算）
// REG終了時: 白以外(青以上)が1回でも出れば設定1は実質除外（別途ハード除外あり）
//            虹は設定4・Vへ大幅ブースト
const HIBISCUS_REG_LOGW = {
  setting1:   { white: 0.15, blue: -0.7, yellow: -0.9, green: -1.1, purple: -1.5, rainbow: -2.2 },
  setting1_5: { white: 0.08, blue: -0.5, yellow: -0.7, green: -0.9, purple: -1.2, rainbow: -1.8 },
  setting2:   { white: 0.00, blue: -0.3, yellow: -0.5, green: -0.7, purple: -1.0, rainbow: -1.5 },
  setting2_5: { white: -0.05,blue: -0.1, yellow: -0.3, green: -0.5, purple: -0.8, rainbow: -1.2 },
  setting3:   { white: -0.10,blue:  0.10, yellow: -0.1, green: -0.3, purple: -0.6, rainbow: -1.0 },
  setting3_5: { white: -0.15,blue:  0.15, yellow:  0.05,green: -0.1, purple: -0.4, rainbow: -0.8 },
  setting4:   { white: -0.20,blue:  0.20, yellow:  0.10,green:  0.05,purple: -0.2, rainbow:  0.2 },
  settingV_1_5:{ white: -0.25,blue:  0.25, yellow:  0.15,green:  0.10,purple: -0.05,rainbow:  0.5 },
  settingV:   { white: -0.30,blue:  0.30, yellow:  0.20,green:  0.15,purple:  0.10,rainbow:  0.9 }
};

// BIG終了時ハイビスカス: 同方向だがやや穏やかな重み
const HIBISCUS_BIG_LOGW = {
  setting1:   { white: 0.10, blue: -0.5, yellow: -0.7, green: -0.9, purple: -1.2, rainbow: -1.8 },
  setting1_5: { white: 0.05, blue: -0.35,yellow: -0.55,green: -0.75,purple: -1.0, rainbow: -1.5 },
  setting2:   { white: 0.00, blue: -0.2, yellow: -0.4, green: -0.6, purple: -0.8, rainbow: -1.2 },
  setting2_5: { white: -0.05,blue: -0.1, yellow: -0.2, green: -0.4, purple: -0.6, rainbow: -1.0 },
  setting3:   { white: -0.10,blue:  0.08, yellow: -0.05,green: -0.2, purple: -0.4, rainbow: -0.7 },
  setting3_5: { white: -0.12,blue:  0.12, yellow:  0.03,green: -0.05,purple: -0.2, rainbow: -0.5 },
  setting4:   { white: -0.15,blue:  0.15, yellow:  0.08,green:  0.03,purple: -0.1, rainbow:  0.1 },
  settingV_1_5:{ white: -0.20,blue:  0.20, yellow:  0.12,green:  0.08,purple: -0.02,rainbow:  0.3 },
  settingV:   { white: -0.25,blue:  0.25, yellow:  0.15,green:  0.10,purple:  0.05,rainbow:  0.6 }
};

// BIG後半サイドランプ: [寒色(青+緑), 暖色(黄+赤), 虹] の多項分布確率
// 最新実戦傾向: 設定4は暖色寄り / 設定Vは寒色寄り / 虹は高設定濃厚
const SIDE_LAMP_CAT = {
  setting1:   { cold: 0.42, warm: 0.46, rainbow: 0.12 },
  setting1_5: { cold: 0.40, warm: 0.46, rainbow: 0.14 },
  setting2:   { cold: 0.38, warm: 0.47, rainbow: 0.15 },
  setting2_5: { cold: 0.36, warm: 0.47, rainbow: 0.17 },
  setting3:   { cold: 0.34, warm: 0.48, rainbow: 0.18 },
  setting3_5: { cold: 0.32, warm: 0.48, rainbow: 0.20 },
  setting4:   { cold: 0.28, warm: 0.52, rainbow: 0.20 },
  settingV_1_5:{ cold: 0.36, warm: 0.42, rainbow: 0.22 },
  settingV:   { cold: 0.44, warm: 0.34, rainbow: 0.22 }
};
const SIDE_LAMP_COLORS = ['blue', 'yellow', 'green', 'red', 'rainbow'];
const SIDE_LAMP_CAT_OF = { blue: 'cold', green: 'cold', yellow: 'warm', red: 'warm', rainbow: 'rainbow' };

// BIG前半スイカ: 設定差が小さいため回数あたりの微小な対数重み
const BIG_SUIKA_LOGW = {
  setting1: 0.04, setting1_5: 0.02, setting2: 0.00, setting2_5: -0.02,
  setting3: -0.04, setting3_5: -0.06, setting4: -0.08, settingV_1_5: -0.10, settingV: -0.12
};

// ホール営業モード別の事前確率（合計1に正規化済み）
const BIZ_PRIORS = {
  normal: { // 通常営業: 低設定ベース
    setting1: 0.30, setting1_5: 0.17, setting2: 0.16, setting2_5: 0.10,
    setting3: 0.08, setting3_5: 0.06, setting4: 0.05, settingV_1_5: 0.04, settingV: 0.04
  },
  event: { // 特日・イベント日: 高設定期待
    setting1: 0.05, setting1_5: 0.06, setting2: 0.10, setting2_5: 0.12,
    setting3: 0.15, setting3_5: 0.14, setting4: 0.16, settingV_1_5: 0.10, settingV: 0.12
  },
  flat: { // 均等フラット
    setting1: 1/9, setting1_5: 1/9, setting2: 1/9, setting2_5: 1/9,
    setting3: 1/9, setting3_5: 1/9, setting4: 1/9, settingV_1_5: 1/9, settingV: 1/9
  }
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
// 不可能な組み合わせ(k<0, k>n, p範囲外)は -Infinity
function logBinomial(n, k, p) {
  n = Math.floor(n); k = Math.floor(k);
  if (!isFinite(n) || !isFinite(k) || n < 0 || k < 0 || k > n) return -Infinity;
  if (n === 0) return k === 0 ? 0 : -Infinity;
  if (p <= 0) return k === 0 ? 0 : -Infinity;
  if (p >= 1) return k === n ? 0 : -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)
       + k * Math.log(p) + (n - k) * Math.log(1 - p);
}

// 分母の線形補間
function lerpDenom(a, b, t) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * t;
}

function buildSettings() {
  const settings = {};
  for (const key of Object.keys(HANAHANA_BASE_SETTINGS)) {
    const s = HANAHANA_BASE_SETTINGS[key];
    settings[key] = {
      name: s.name,
      BIG: 1 / s.BIG, REG: 1 / s.REG, BEL: 1 / s.BEL,
      REG_SUIKA: 1 / s.REG_SUIKA, BIG_SUIKA: 1 / s.BIG_SUIKA
    };
  }
  for (const key of Object.keys(INTERPOLATED_SETTINGS)) {
    const spec = INTERPOLATED_SETTINGS[key];
    const a = HANAHANA_BASE_SETTINGS[spec.from];
    const b = HANAHANA_BASE_SETTINGS[spec.to];
    const d = f => lerpDenom(a[f], b[f], spec.t);
    settings[key] = {
      name: spec.name,
      BIG: d('BIG') == null ? null : 1 / d('BIG'),
      REG: d('REG') == null ? null : 1 / d('REG'),
      BEL: d('BEL') == null ? null : 1 / d('BEL'),
      REG_SUIKA: d('REG_SUIKA') == null ? null : 1 / d('REG_SUIKA'),
      BIG_SUIKA: d('BIG_SUIKA') == null ? null : 1 / d('BIG_SUIKA')
    };
  }
  // 補間設定のランプ重み・事前確率も線形補間
  for (const key of Object.keys(INTERPOLATED_SETTINGS)) {
    const spec = INTERPOLATED_SETTINGS[key];
    const lerpObj = (oa, ob) => {
      const out = {};
      for (const c of Object.keys(oa)) out[c] = oa[c] + (ob[c] - oa[c]) * spec.t;
      return out;
    };
    const lerpNum = (a, b) => a + (b - a) * spec.t;
    const specKey = key;
    HIBISCUS_REG_LOGW[specKey] = lerpObj(HIBISCUS_REG_LOGW[spec.from], HIBISCUS_REG_LOGW[spec.to]);
    HIBISCUS_BIG_LOGW[specKey] = lerpObj(HIBISCUS_BIG_LOGW[spec.from], HIBISCUS_BIG_LOGW[spec.to]);
    SIDE_LAMP_CAT[specKey] = {
      cold: lerpNum(SIDE_LAMP_CAT[spec.from].cold, SIDE_LAMP_CAT[spec.to].cold),
      warm: lerpNum(SIDE_LAMP_CAT[spec.from].warm, SIDE_LAMP_CAT[spec.to].warm),
      rainbow: lerpNum(SIDE_LAMP_CAT[spec.from].rainbow, SIDE_LAMP_CAT[spec.to].rainbow)
    };
    BIG_SUIKA_LOGW[specKey] = lerpNum(BIG_SUIKA_LOGW[spec.from], BIG_SUIKA_LOGW[spec.to]);
  }
  return settings;
}

const HANAHANA_SETTINGS = buildSettings();

/* ============================================================
 * 尤度計算
 * state 形式:
 * {
 *   totalG, big, reg, bell,          // bell は null で無視
 *   lamps: {
 *     hibiscusBig: {white..rainbow}, // BIG終了時ハイビスカス
 *     hibiscusReg: {white..rainbow}, // REG終了時ハイビスカス
 *     side: {blue,yellow,green,red,rainbow},
 *     regSuika, bigSuika, retroFlash, retroSound
 *   }
 * }
 * options: { excluded: [keys], bizMode: 'normal'|'event'|'flat' }
 * 戻り値: { probabilities, logLikelihoods, autoExcluded }
 * ============================================================ */
function calculateHanahanaProbabilities(state, options) {
  const opts = Object.assign({ excluded: [], bizMode: 'normal' }, options || {});
  const w = HANAHANA_WEIGHTS;
  const lamps = (state && state.lamps) || {};

  const n = Math.max(0, (state && state.totalG) || 0);
  const big = Math.max(0, (state && state.big) || 0);
  const reg = Math.max(0, (state && state.reg) || 0);
  const bell = state && state.bell != null ? Math.max(0, state.bell) : null;

  // REG中スイカの母数は REG回数 × 10G
  const regSuikaN = reg * 10;
  const regSuikaK = Math.max(0, lamps.regSuika || 0);
  const bigSuikaK = Math.max(0, lamps.bigSuika || 0);
  const retroFlashK = Math.max(0, lamps.retroFlash || 0);
  const retroSoundK = Math.max(0, lamps.retroSound || 0);

  // サイドランプ色別カウント → 3カテゴリ集計
  const side = lamps.side || {};
  const sideCat = { cold: 0, warm: 0, rainbow: 0 };
  for (const color of SIDE_LAMP_COLORS) {
    sideCat[SIDE_LAMP_CAT_OF[color]] += Math.max(0, side[color] || 0);
  }

  // REG終了時ハイビスカス: 白以外が1回でもあれば設定1・1.5をハード除外（設定2以上濃厚法則）
  const hibReg = lamps.hibiscusReg || {};
  const nonWhiteReg = ['blue','yellow','green','purple','rainbow']
    .some(c => (hibReg[c] || 0) > 0);
  const hardExcluded = new Set(opts.excluded || []);
  if (nonWhiteReg) { hardExcluded.add('setting1'); hardExcluded.add('setting1_5'); }

  const prior = BIZ_PRIORS[opts.bizMode] || BIZ_PRIORS.flat;
  const logLikelihoods = {};
  const probabilities = {};

  for (const key of SETTING_ORDER) {
    if (hardExcluded.has(key)) {
      logLikelihoods[key] = -Infinity;
      probabilities[key] = 0;
      continue;
    }
    const s = HANAHANA_SETTINGS[key];
    let ll = 0;

    if (n > 0) {
      // BIG / REG: 各設定が個別確率を持つため個別二項尤度
      if (s.BIG != null) ll += logBinomial(n, big, s.BIG);
      if (s.REG != null) ll += logBinomial(n, reg, s.REG);
      // ベル: 1日単位で荒れるため weight=0.35 で弱める
      if (bell != null && s.BEL != null) {
        ll += w.bell * logBinomial(n, bell, s.BEL);
      }
    }
    // REG中スイカ: 母数 = REG回数×10G
    if (regSuikaN > 0 && s.REG_SUIKA != null) {
      ll += w.regSuika * logBinomial(regSuikaN, regSuikaK, s.REG_SUIKA);
    }
    // BIG前半スイカ: 微調整係数
    if (bigSuikaK > 0) ll += bigSuikaK * BIG_SUIKA_LOGW[key] * w.bigSuika * 10;

    // ハイビスカス（BIG終了時 / REG終了時）色別対数重み
    const hibBig = lamps.hibiscusBig || {};
    for (const c of ['white','blue','yellow','green','purple','rainbow']) {
      const cb = Math.max(0, hibBig[c] || 0);
      if (cb > 0) ll += cb * HIBISCUS_BIG_LOGW[key][c];
      const cr = Math.max(0, hibReg[c] || 0);
      if (cr > 0) ll += cr * HIBISCUS_REG_LOGW[key][c];
    }
    // サイドランプ多項分布（カテゴリ別 log p × 回数）
    const cats = SIDE_LAMP_CAT[key];
    if (cats) {
      if (sideCat.cold > 0)    ll += sideCat.cold    * Math.log(cats.cold);
      if (sideCat.warm > 0)    ll += sideCat.warm    * Math.log(cats.warm);
      if (sideCat.rainbow > 0) ll += sideCat.rainbow * Math.log(cats.rainbow);
    }
    // 特殊点滅・レトロサウンド（回数×log重み）
    if (retroFlashK > 0) ll += retroFlashK * w.specialBlink * Math.log(1.15);
    if (retroSoundK > 0) ll += retroSoundK * w.retroSound  * Math.log(1.15);

    // 事前確率（営業モード）
    if (prior[key] > 0) ll += Math.log(prior[key]);

    logLikelihoods[key] = ll;
  }

  // ソフトマックス正規化（合計100%）
  const finite = SETTING_ORDER.filter(k => isFinite(logLikelihoods[k]));
  if (finite.length === 0) {
    for (const k of SETTING_ORDER) probabilities[k] = 1 / SETTING_ORDER.length;
    return { probabilities, logLikelihoods, autoExcluded: [...hardExcluded] };
  }
  const maxLL = Math.max(...finite.map(k => logLikelihoods[k]));
  let sum = 0;
  for (const k of finite) sum += Math.exp(logLikelihoods[k] - maxLL);
  for (const k of SETTING_ORDER) {
    probabilities[k] = isFinite(logLikelihoods[k])
      ? Math.exp(logLikelihoods[k] - maxLL) / sum
      : 0;
  }
  return { probabilities, logLikelihoods, autoExcluded: [...hardExcluded] };
}

// Node / ブラウザ両対応のエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SETTING_ORDER, HANAHANA_BASE_SETTINGS, INTERPOLATED_SETTINGS,
    HANAHANA_SETTINGS, HANAHANA_WEIGHTS, BIZ_PRIORS,
    HIBISCUS_REG_LOGW, HIBISCUS_BIG_LOGW, SIDE_LAMP_CAT,
    lgamma, logBinomial, calculateHanahanaProbabilities
  };
}
if (typeof window !== 'undefined') {
  window.HanahanaCalc = {
    SETTING_ORDER, HANAHANA_BASE_SETTINGS, INTERPOLATED_SETTINGS,
    HANAHANA_SETTINGS, HANAHANA_WEIGHTS, BIZ_PRIORS,
    HIBISCUS_REG_LOGW, HIBISCUS_BIG_LOGW, SIDE_LAMP_CAT,
    lgamma, logBinomial, calculateHanahanaProbabilities
  };
}
