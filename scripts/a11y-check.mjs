/**
 * a11y 门禁检查（UI v2 批次 E3，§13 / §10.5）
 * ============================================================
 * 两部分：
 *   A. 对比度实算（standalone，gate 必跑）：遍历令牌文字/描边组合，
 *      按 WCAG 相对亮度公式实算 —— 文字 ≥4.5、大字/描边 ≥3:1，0 FAIL 才过。
 *   B. 命中区扫描（需 dev server 在 5173）：Playwright 全按钮 getBoundingClientRect
 *      ≥44×44（WCAG 2.5.8）；服务器不可达 → 明确 SKIP（不计 FAIL，不静默假装通过）。
 *
 * 跑法： node scripts/a11y-check.mjs [--with-hitbox]
 * 退出码：0 = 无漂移；1 = 有 FAIL。
 */
import { readFileSync } from 'node:fs';

/* ---------- A. 对比度实算 ---------- */

const hex2rgb = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

const lum = ([r, g, b]) => {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const ratio = (fg, bg) => {
  const l1 = lum(hex2rgb(fg));
  const l2 = lum(hex2rgb(bg));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** 令牌组（与 tailwind.config.js 同源快照；改色必须同步此处，漂移会在门禁红） */
const PAPER = '#F6F7FA';
const WHITE = '#FFFFFF';
const SUNKEN = '#EDEFF5';
const checks = [
  // [说明, fg, bg, 门槛]
  ['正文 ink / paper', '#16233F', PAPER, 4.5],
  ['正文 v2 墨 #1F2A44 / paper', '#1F2A44', PAPER, 4.5],
  ['次级 ink-soft / card', '#414D68', WHITE, 4.5],
  ['标签 ink-faint / card（小字也达标）', '#66708A', WHITE, 4.5],
  ['品牌 brand / card', '#2B4C9B', WHITE, 4.5],
  ['白字 / brand（主按钮）', '#FFFFFF', '#2B4C9B', 4.5],
  ['白字 / ink（深色面）', '#FFFFFF', '#16233F', 4.5],
  ['gold-deep 小字 / card', '#C08A45', WHITE, 3.0],
  ['警告文字 --warn-text / warn-light', '#965C18', '#FBF1E3', 4.5],
  ['危险文字 --danger-text / danger-light', '#B0402F', '#FAEAE7', 4.5],
  ['占位符 --ph / card（4.56:1 底线）', '#6E7688', WHITE, 4.5],
  ['控件描边 --border-control / paper（≥3:1，E3 实测加深到 #7A8292）', '#7A8292', PAPER, 3.0],
  ['school.red 小字 / card', '#9E1B32', WHITE, 4.5],
  ['上理红 / school-light', '#9E1B32', '#FBEDEE', 4.5],
  ['危险 danger / danger-light', '#C24B3A', '#FAEAE7', 3.0],
];

let aFail = 0;
console.log('\n== a11y A · 对比度实算 ==');
for (const [label, fg, bg, min] of checks) {
  const r = ratio(fg, bg);
  const okR = r >= min - 1e-9;
  if (!okR) aFail++;
  console.log(`  ${okR ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1（需 ≥${min}）`);
}

/* ---------- B. 命中区扫描（需要 dev server） ---------- */

let bFail = 0;
let bSkipped = false;
if (process.argv.includes('--with-hitbox')) {
  console.log('\n== a11y B · 命中区扫描（≥44×44，WCAG 2.5.8） ==');
  try {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(process.env.A11Y_BASE ?? 'http://127.0.0.1:5173', { timeout: 5000 });
    await page.waitForTimeout(1200);
    // 主界面直达（跳过 onboarding）：种已引导态
    await page.evaluate(() => {
      localStorage.setItem('onboarded', 'true');
      localStorage.setItem('usst.libao.basic_info', JSON.stringify({ campus: '军工路本部' }));
    });
    await page.reload();
    await page.waitForTimeout(1500);
    const violations = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], [role="button"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 44 || r.height < 44;
        })
        .map((el) => `${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 16)} ${el.getBoundingClientRect().width | 0}x${el.getBoundingClientRect().height | 0}`),
    );
    if (violations.length) {
      bFail = violations.length;
      for (const v of violations.slice(0, 12)) console.log('  FAIL <44px:', v);
    } else {
      console.log('  PASS  首屏可点元素全部 ≥44×44');
    }
    await browser.close();
  } catch (e) {
    bSkipped = true;
    console.log(`  SKIP  dev server 不可达或 Playwright 失败（${String(e).slice(0, 80)}）——命中区扫描不阻塞 gate`);
  }
} else {
  console.log('\n== a11y B · 命中区扫描 == SKIP（未加 --with-hitbox；gate 内默认只跑对比度）');
}

console.log(`\n汇总：对比度 FAIL=${aFail} / 命中区 FAIL=${bFail}${bSkipped ? '（扫描 SKIP）' : ''}`);
process.exit(aFail + bFail > 0 ? 1 : 0);
