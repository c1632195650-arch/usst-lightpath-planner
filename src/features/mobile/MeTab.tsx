/**
 * 光溯移动端 · 我的页签（2026-10-08 底部导航批次拆出）
 * ============================================================
 * 内容：账号（用户名/退出）→ 通知状态（NotifyStatus，含「重排提醒」）→ 提醒与帮助
 * （ICS + 白名单，沿用 m-more-toggle 锚点）→ 执行力评估（EvalSection）。
 * 这些原先堆在 Today 页尾 —— 拆到这里，今天页只留今天。
 * 数据来自宿主传入的 d；displayed 用于通知排程视图。
 */
import type { TodayData } from './lib/useTodayData.ts';
import type { MobileIdentity } from './lib/auth.ts';
import type { Displayed } from './TodayTab.tsx';
import NotifyStatus from './NotifyStatus.tsx';
import IcsGuide from './IcsGuide.tsx';
import WhitelistGuide from './WhitelistGuide.tsx';
import EvalSection from './EvalSection.tsx';
import { Icon } from '@/components/icons/Icon';

export default function MeTab({ d, displayed, nowMin, identity, onLogout }: {
  d: TodayData;
  displayed: Displayed | null;
  nowMin: number;
  identity: MobileIdentity;
  onLogout: () => void;
}) {
  return (
    <>
      {/* 账号 */}
      <section className="rounded-card border border-ink/5 bg-paper-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-light text-brand">
            <Icon name="user-round" size="md" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{identity.username}</p>
            <p className="text-xs text-ink-faint">网页端与手机端同一账号，数据自动同步</p>
          </div>
          <button
            type="button"
            data-testid="m-logout"
            onClick={() => { onLogout(); }}
            className="h-11 rounded-xl border border-ink/10 px-3 text-sm text-ink-soft"
          >
            退出登录
          </button>
        </div>
      </section>

      {/* 通知状态（今天提醒的排程 + 重排按钮；m-notify-reshuffle 锚点保留） */}
      {d.phase === 'ready' && (
        <NotifyStatus
          blocks={displayed?.blocks ?? []}
          nowMin={nowMin}
          dateKey={d.todayKey}
          permDenied={d.permDenied}
        />
      )}

      {/* 提醒与帮助：ICS 订阅 + 后台白名单（M4/M5；常展开展示 —— 低频入口不再折叠藏起来） */}
      <section className="space-y-3 rounded-card border border-ink/5 bg-paper-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">提醒与帮助</p>
          <span className="text-xs text-ink-faint">日历订阅 · 后台保活</span>
        </div>
        <IcsGuide icsToken={identity.icsToken} />
        <WhitelistGuide />
      </section>

      {/* 任务二 · 执行力评估（折叠面板 + 每日采集弹窗，副作用在组件内） */}
      <EvalSection
        plan={d.plan} serverState={d.serverState} layer={d.layer} phase={d.phase}
        todayKey={d.todayKey} behaviorEvents={d.behaviorEvents}
      />
    </>
  );
}
