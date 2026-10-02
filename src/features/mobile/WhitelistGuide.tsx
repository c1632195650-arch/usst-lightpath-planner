/**
 * 光溯移动端 · 提醒白名单引导（F17 · 方案 §8.3）
 * ============================================================
 * ROM 杀后台是本地通知的最大杀手（调研事实 F4）。素材口径按 dontkillmyapp.com
 * 改写（文字自写，不搬运页面）；机型路径覆盖：华为/鸿蒙、小米、通用。
 * 入口：本页常驻折叠区「提醒不响？点这里」（APK 首启弹层留 M4 联调时验证）。
 */
import { useState } from 'react';

const PATHS: Array<{ vendor: string; steps: string[] }> = [
  {
    vendor: '华为 / 鸿蒙',
    steps: [
      '设置 → 电池 → 启动管理 → 光溯 → 关掉「自动管理」',
      '手动管理里把三个开关都打开：允许自启动、允许关联启动、允许后台活动',
      '设置 → 通知 → 光溯 → 允许通知',
    ],
  },
  {
    vendor: '小米 / Redmi',
    steps: [
      '设置 → 应用设置 → 应用管理 → 光溯',
      '省电策略 → 改成「无限制」',
      '通知管理 → 允许通知',
    ],
  },
  {
    vendor: '其他安卓 / iOS / 鸿蒙 NEXT',
    steps: [
      '重点看「电池优化」里有没有把光溯设为不受限',
      'iOS 与鸿蒙 NEXT 用系统日历订阅即可（见下方 ICS 订阅），不用装 APK',
      '拿不准的机型去 dontkillmyapp.com 搜对应品牌，按它的图解走',
    ],
  },
];

export default function WhitelistGuide() {
  const [open, setOpen] = useState(false);
  return (
    <section data-testid="m-whitelist-guide" className="rounded-card bg-paper-card p-4 shadow-sm">
      <button type="button" data-testid="m-whitelist-toggle" className="flex w-full items-center justify-between" onClick={() => setOpen(!open)}>
        <h3 className="text-sm font-semibold text-ink-soft">提醒不响？点这里</h3>
        <span className="text-ink-faint">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <p className="text-[11px] leading-5 text-ink-faint">
            大多数「收不到提醒」不是 App 的问题，是手机厂商为了省电把后台拦了。
            按你手机的牌子做一遍下面几步（一次性，做完就正常了）：
          </p>
          {PATHS.map((p) => (
            <div key={p.vendor}>
              <p className="text-xs font-semibold text-ink">{p.vendor}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs leading-5 text-ink-soft">
                {p.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
          <p className="text-[11px] leading-5 text-ink-faint">
            手机重启后提醒排程会清空 —— 重新打开一次光溯就会自动恢复。
          </p>
        </div>
      )}
    </section>
  );
}
