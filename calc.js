/* ============================================================
 * ニューキングハナハナV-30 設定判別エンジン（プロ仕様ベイズ推定）
 * ------------------------------------------------------------
 * 【設定別理論値テーブル】（実戦解析データ準拠・分母表記・実機5段階）
 *   設定1 : BIG 1/299  REG 1/496  ベル 1/7.59  REG中スイカ 1/110
 *   設定2 : BIG 1/290  REG 1/475  ベル 1/7.47  REG中スイカ 1/95
 *   設定3 : BIG 1/278  REG 1/450  ベル 1/7.43  REG中スイカ 1/90
 *   設定4 : BIG 1/266  REG 1/415  ベル 1/7.33  REG中スイカ 1/80
 *   設定V : BIG 1/253  REG 1/372  ベル 1/7.28  REG中スイカ 1/64
 *   BIG前半スイカは全設定で約1/48〜1/50と差が小さいため微調整扱い。
 * ============================================================ */

// 実機通りの5段階のみ
const SETTING_ORDER = ['setting1', 'setting2', 'setting3', 'setting4', 'settingV'];

// 既知設定の理論値（分母。prob = 1/denominator）
const HANAHANA_BASE_SETTINGS = {
  setting1: { name: '設定1', BIG: 299, REG: 496, BEL: 7.59, REG_SUIKA: 110, BIG_SUIKA: 50.0 },
  setting2: { name: '設定2', BIG: 290, REG: 475, BEL: 7.47, REG_SUIKA: 95,  BIG_SUIKA: 49.5 },
  setting3: { name: '設定3', BIG: 278, REG: 450, BEL: 7.43, REG_SUIKA: 90,  BIG_SUIKA: 49.0 },
  setting4: { name: '設定4', BIG: 266, REG: 415, BEL: 7.33, REG_SUIKA: 80,  BIG_SUIKA: 48.5 },
  settingV:  { name: '設定V',  BIG: 253, REG: 372, BEL: 7.28, REG_SUIKA: 64,  BIG_SUIKA: 48.0 }
};

/* ============================================================
 * 【尤度ウェイト・事前確率・信頼度定数】（実戦データで調整可能）
 * ============================================================ */
const HANAHANA_WEIGHTS = {
  bell:        0.35,  // ベルは1日単位で荒れるため過信防止で弱める
  regSuika:    1.0,   // REG中スイカ（REG回数×10Gを母数）
  bigSuika:    0.15,  // BIG前半スイカは設定差が小さいため微調整係数
  specialBlink:0.5,   // 特殊点滅（回数×log重みで加算）
  retroSound:  0.5    // レトロサウンド（回数×log重みで加算）
};

// サンプル信頼度: 総G数に応じた事後確率と事前分布の混合率
// 0〜500G≒低信頼 / 2000G≒中信頼 / 4000G以上≒高信頼(90%)
function confidenceFor(totalG) {
  const g = Number(totalG);
  if (!isFinite(g) || g <= 0) return 0;
  return Math.min(0.9, 0.2 + (g / 4000) * 0.7);
}

// 非負整数への安全な変換（NaN / Infinity / 負数 / 非数値文字列を 0 に正規化）
function toNonNegInt(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ハイビスカスランプ色別の設定別対数重み（回数×この値を尤度へ加算）
// REG終了時: 白以外(青以上)が1回でも出れば設定1はハード除外（設定2以上濃厚法則）
//            虹は設定4・Vへ大幅ブースト
const HIBISCUS_REG_LOGW = {
  setting1: { white: 0.15, blue: -0.7, yellow: -0.9, green: -1.1, purple: -1.5, rainbow: -2.2 },
  setting2: { white: 0.00, blue: -0.3, yellow: -0.5, green: -0.7, purple: -1.0, rainbow: -1.5 },
  setting3: { white: -0.10,blue:  0.10, yellow: -0.1, green: -0.3, purple: -0.6, rainbow: -1.0 },
  setting4: { white: -0.20,blue:  0.20, yellow:  0.10,green:  0.05,purple: -0.2, rainbow:  0.2 },
  settingV:  { white: -0.30,blue:  0.30, yellow:  0.20,green:  0.15,purple:  0.10,rainbow:  0.9 }
};

// BIG終了時ハイビスカス: 同方向だがやや穏やかな重み
const HIBISCUS_BIG_LOGW = {
  setting1: { white: 0.10, blue: -0.5, yellow: -0.7, green: -0.9, purple: -1.2, rainbow: -1.8 },
  setting2: { white: 0.00, blue: -0.2, yellow: -0.4, green: -0.6, purple: -0.8, rainbow: -1.2 },
  setting3: { white: -0.10,blue:  0.08, yellow: -0.05,green: -0.2, purple: -0.4, rainbow: -0.7 },
  setting4: { white: -0.15,blue:  0.15, yellow:  0.08,green:  0.03,purple: -0.1, rainbow:  0.1 },
  settingV:  { white: -0.25,blue:  0.25, yellow:  0.15,green:  0.10,purple:  0.05,rainbow:  0.6 }
};

// BIG後半サイドランプ: [寒色(青+緑), 暖色(黄+赤), 虹] の多項分布確率
// 最新実戦傾向: 設定4は暖色寄り / 設定Vは寒色寄り / 虹は高設定濃厚
const SIDE_LAMP_CAT = {
  setting1: { cold: 0.42, warm: 0.46, rainbow: 0.12 },
  setting2: { cold: 0.37, warm: 0.47, rainbow: 0.16 },
  setting3: { cold: 0.33, warm: 0.48, rainbow: 0.19 },
  setting4: { cold: 0.28, warm: 0.52, rainbow: 0.20 },
  settingV:  { cold: 0.44, warm: 0.34, rainbow: 0.22 }
};
const SIDE_LAMP_COLORS = ['blue', 'yellow', 'green', 'red', 'rainbow'];
const SIDE_LAMP_CAT_OF = { blue: 'cold', green: 'cold', yellow: 'warm', red: 'warm', rainbow: 'rainbow' };

// BIG前半スイカ: 設定差が小さいため回数あたりの微小な対数重み
const BIG_SUIKA_LOGW = {
  setting1: 0.04, setting2: 0.00, setting3: -0.04, setting4: -0.08, settingV: -0.12
};

// 各設定の理論機械割（%・解析目安値。実機値に合わせて調整）
const THEORETICAL_PAYOUT = {
  setting1: 97.0, setting2: 98.0, setting3: 100.0, setting4: 103.0, settingV: 112.0
};

// ホール営業モード別の事前確率（合計1に正規化済み）
const BIZ_PRIORS = {
  normal: { // 通常営業: 低設定ベース
    setting1: 0.35, setting2: 0.25, setting3: 0.16, setting4: 0.13, settingV: 0.11
  },
  event: { // 特日・イベント日: 高設定期待
    setting1: 0.08, setting2: 0.14, setting3: 0.20, setting4: 0.26, settingV: 0.32
  },
  flat: { // 均等フラット
    setting1: 0.2, setting2: 0.2, setting3: 0.2, setting4: 0.2, settingV: 0.2
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

const HANAHANA_SETTINGS = {};
for (const key of SETTING_ORDER) {
  const s = HANAHANA_BASE_SETTINGS[key];
  HANAHANA_SETTINGS[key] = {
    name: s.name,
    BIG: 1 / s.BIG, REG: 1 / s.REG, BEL: 1 / s.BEL,
    REG_SUIKA: 1 / s.REG_SUIKA, BIG_SUIKA: 1 / s.BIG_SUIKA
  };
}

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
 * options: {
 *   excluded: [keys],
 *   bizMode: 'normal'|'event'|'flat',
 *   autoEx: true|false   // false で自動除外（設定1/1.5→設定1、虹→1,2,3）を無効化
 * }
 * 戻り値: { probabilities, logLikelihoods, autoExcluded, confidence }
 *   probabilities は信頼度スムージング適用後・合計100%
 * ============================================================ */
function calculateHanahanaProbabilities(state, options) {
  const opts = Object.assign({ excluded: [], bizMode: 'normal', autoEx: true }, options || {});
  const w = HANAHANA_WEIGHTS;
  const lamps = (state && state.lamps) || {};

  const n = toNonNegInt(state && state.totalG);
  const rawBig = toNonNegInt(state && state.big);
  const rawReg = toNonNegInt(state && state.reg);
  const rawBell = state && state.bell != null && state.bell !== '' ? toNonNegInt(state.bell) : null;
  // 入力途中の整合性崩れ（k > n）で全設定が -Infinity になるのを防ぐためクランプ
  const big = n > 0 ? Math.min(n, rawBig) : rawBig;
  const reg = n > 0 ? Math.min(n, rawReg) : rawReg;
  const bell = rawBell != null && n > 0 ? Math.min(n, rawBell) : rawBell;

  // REG中スイカの母数は REG回数 × 10G
  const regSuikaN = reg * 10;
  const rawRegSuikaK = toNonNegInt(lamps.regSuika);
  const regSuikaK = regSuikaN > 0 ? Math.min(regSuikaN, rawRegSuikaK) : rawRegSuikaK;
  const bigSuikaK = toNonNegInt(lamps.bigSuika);
  const retroFlashK = toNonNegInt(lamps.retroFlash);
  const retroSoundK = toNonNegInt(lamps.retroSound);

  // サイドランプ色別カウント → 3カテゴリ集計
  const side = lamps.side || {};
  const sideCat = { cold: 0, warm: 0, rainbow: 0 };
  for (const color of SIDE_LAMP_COLORS) {
    sideCat[SIDE_LAMP_CAT_OF[color]] += toNonNegInt(side[color]);
  }

  // REG終了時ハイビスカスによる自動除外（設定2以上濃厚法則）
  //  - 白以外(青以上)が1回でも → 設定1を除外
  //  - 虹が1回でも           → 設定1・2・3を除外（設定4・Vのみで再計算）
  const hibReg = lamps.hibiscusReg || {};
  const nonWhiteReg = ['blue','yellow','green','purple','rainbow']
    .some(c => toNonNegInt(hibReg[c]) > 0);
  const rainbowReg = toNonNegInt(hibReg.rainbow) > 0;
  const hardExcluded = new Set(opts.excluded || []);
  if (opts.autoEx !== false) {
    if (nonWhiteReg) hardExcluded.add('setting1');
    if (rainbowReg) ['setting1', 'setting2', 'setting3'].forEach(k => hardExcluded.add(k));
  }

  const prior = BIZ_PRIORS[opts.bizMode] || BIZ_PRIORS.flat;
  const logLikelihoods = {};

  for (const key of SETTING_ORDER) {
    if (hardExcluded.has(key)) {
      logLikelihoods[key] = -Infinity;
      continue;
    }
    const s = HANAHANA_SETTINGS[key];
    let ll = 0;

    if (n > 0) {
      if (s.BIG != null) ll += logBinomial(n, big, s.BIG);
      if (s.REG != null) ll += logBinomial(n, reg, s.REG);
      if (bell != null && s.BEL != null) {
        ll += w.bell * logBinomial(n, bell, s.BEL);
      }
    }
    if (regSuikaN > 0 && s.REG_SUIKA != null) {
      ll += w.regSuika * logBinomial(regSuikaN, regSuikaK, s.REG_SUIKA);
    }
    if (bigSuikaK > 0) ll += bigSuikaK * BIG_SUIKA_LOGW[key] * w.bigSuika * 10;

    const hibBig = lamps.hibiscusBig || {};
    for (const c of ['white','blue','yellow','green','purple','rainbow']) {
      const cb = toNonNegInt(hibBig[c]);
      if (cb > 0) ll += cb * HIBISCUS_BIG_LOGW[key][c];
      const cr = toNonNegInt(hibReg[c]);
      if (cr > 0) ll += cr * HIBISCUS_REG_LOGW[key][c];
    }
    const cats = SIDE_LAMP_CAT[key];
    if (cats) {
      if (sideCat.cold > 0)    ll += sideCat.cold    * Math.log(cats.cold);
      if (sideCat.warm > 0)    ll += sideCat.warm    * Math.log(cats.warm);
      if (sideCat.rainbow > 0) ll += sideCat.rainbow * Math.log(cats.rainbow);
    }
    if (retroFlashK > 0) ll += retroFlashK * w.specialBlink * Math.log(1.15);
    if (retroSoundK > 0) ll += retroSoundK * w.retroSound  * Math.log(1.15);

    if (prior[key] > 0) ll += Math.log(prior[key]);
    logLikelihoods[key] = ll;
  }

  // ソフトマックス正規化（尤度のみ）
  const allowed = SETTING_ORDER.filter(k => isFinite(logLikelihoods[k]));
  const probabilities = {};
  let confidence = 0;

  if (allowed.length === 0) {
    for (const k of SETTING_ORDER) probabilities[k] = 1 / SETTING_ORDER.length;
    confidence = 0;
  } else {
    const maxLL = Math.max(...allowed.map(k => logLikelihoods[k]));
    let sum = 0;
    const post = {};
    for (const k of allowed) {
      post[k] = Math.exp(logLikelihoods[k] - maxLL);
      sum += post[k];
    }
    for (const k of allowed) post[k] /= sum;
    for (const k of SETTING_ORDER) probabilities[k] = post[k] || 0;

    // 信頼度スムージング: conf×事後 + (1-conf)×事前（除外設定は0のまま、許可集合で再正規化）
    confidence = confidenceFor(n);
    if (confidence < 0.999) {
      // 事前を許可集合で正規化
      let psum = 0;
      const pnorm = {};
      for (const k of allowed) { pnorm[k] = prior[k] || 0; psum += pnorm[k]; }
      if (psum > 0) for (const k of allowed) pnorm[k] /= psum;
      let fsum = 0;
      for (const k of allowed) {
        probabilities[k] = confidence * post[k] + (1 - confidence) * (pnorm[k] || 0);
        fsum += probabilities[k];
      }
      if (fsum > 0 && isFinite(fsum)) {
        for (const k of allowed) probabilities[k] /= fsum;
      } else {
        for (const k of allowed) probabilities[k] = 1 / allowed.length;
      }
      for (const k of SETTING_ORDER) if (!allowed.includes(k)) probabilities[k] = 0;
    }
  }

  return { probabilities, logLikelihoods, autoExcluded: [...hardExcluded], confidence };
}

// Node / ブラウザ両対応のエクスポート
const EXPORTS = {
  SETTING_ORDER, HANAHANA_BASE_SETTINGS, HANAHANA_SETTINGS,
  HANAHANA_WEIGHTS, BIZ_PRIORS, SIDE_LAMP_CAT, SIDE_LAMP_COLORS,
  HIBISCUS_REG_LOGW, HIBISCUS_BIG_LOGW, BIG_SUIKA_LOGW, THEORETICAL_PAYOUT,
  confidenceFor, lgamma, logBinomial, calculateHanahanaProbabilities
};
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (typeof window !== 'undefined') window.HanahanaCalc = EXPORTS;
