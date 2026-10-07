import { useEffect, useState } from 'react';
import { loadBasicInfo } from '@/lib/identity';
import { Icon, type IconName } from '@/components/icons/Icon';
import { loadIdentity } from '@/features/mobile/lib/auth';
import { LAST_SYNC_KEY, SWITCH_KEY } from '@/features/mobile/lib/webSync';

/**
 * 设置面板（UI v2 批次 D5，设计稿 §11 /settings 的网页落地）
 * ============================================================
 * 分组列表 + 行上直显当前值。**没有的功能不上占位行**（防假按钮）——
 * 每一行都读真实状态源：
 *   校区     ← 画像档案（persona.campus）
 *   日程视图 ← usst.scheduleViewV2（D2 双层开关，显式 '0' 关）
 *   云同步   ← usst.mobile.cloudSync（默认关）+ usst.mobile.webSyncAt 上次同步
 *   日历订阅 ← 登录身份的 icsToken（复用既有 /api/sync/plan.ics 端点输出）
 * 挂载点：画像 Tab 底部（App 渲染）；不新增路由（D2 决策）。
 */
export function SettingsPanel() {
  const [v2Enabled, setV2Enabled] = useState(true);
  const [syncOn, setSyncOn] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [identity, setIdentity] = useState<ReturnType<typeof loadIdentity>>(null);
  const [campus, setCampus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setV2Enabled(localStorage.getItem('usst.scheduleViewV2') !== '0');
      setSyncOn(localStorage.getItem(SWITCH_KEY) === '1');
      const at = localStorage.getItem(LAST_SYNC_KEY);
      setLastSync(at ? new Date(Number(at)).toLocaleString() : null);
    } catch { /* 隐私模式等不可写场景：按默认值陈列 */ }
    setIdentity(loadIdentity());
    setCampus(loadBasicInfo().campus ?? null);
  }, []);

  const toggleV2 = () => {
    const next = !v2Enabled;
    setV2Enabled(next);
    try { localStorage.setItem('usst.scheduleViewV2', next ? '1' : '0'); } catch { /* 同上 */ }
  };

  const icsUrl = identity?.icsToken ? `${window.location.origin}/api/sync/plan.ics?token=${identity.icsToken}` : null;

  const row = (label: string, value: React.ReactNode, key: string, icon?: IconName) => (
    <div key={key} className="flex min-h-11 items-center justify-between gap-3 border-t border-ink/[0.06] px-1 py-2 transition-colors duration-200 first:border-t-0 hover:bg-ink/[0.02]">
      <span className="flex items-center gap-2 text-[13px] text-ink">
        {icon && <Icon name={icon} size="md" className="shrink-0 text-ink-soft" />}
        {label}
      </span>
      <span className="text-right text-[12.5px] font-medium text-ink-soft" data-testid={`settings-value-${key}`}>{value}</span>
    </div>
  );

  return (
    <section className="panel p-4 sm:p-5" data-testid="settings-panel">
      <p className="section-label-zh">设置</p>

      <div className="mt-3">
        <p className="px-1 pb-1 text-[11px] font-semibold text-ink-faint">通用</p>
        {row('校区', campus || '未设置（完成画像后带入）', 'campus', 'map-pin')}
        {row(
          '日程双层视图',
          <button
            type="button"
            role="switch"
            aria-checked={v2Enabled}
            data-testid="settings-v2-toggle"
            onClick={toggleV2}
            className={`relative h-6 w-10 rounded-full border transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1] ${v2Enabled ? 'border-brand bg-brand' : 'border-ink/15 bg-paper'}`}
          >
            <span
              className="absolute left-0.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-fast ease-out"
              style={{ transform: v2Enabled ? 'translate(16px, -50%)' : 'translate(0, -50%)' }}
            />
            <span className="sr-only">{v2Enabled ? '已开启' : '已关闭'}</span>
          </button>,
          'schedule-view',
          'layers',
        )}
      </div>

      <div className="mt-4">
        <p className="px-1 pb-1 text-[11px] font-semibold text-ink-faint">同步与账户</p>
        {row('云同步', syncOn ? `已开启${lastSync ? ` · 上次同步 ${lastSync}` : ' · 尚未同步'}` : '已关闭（默认关）', 'cloud-sync', syncOn ? 'cloud' : 'cloud-off')}
        {row('账户', identity ? `已登录 · ${identity.username}` : '未登录（移动端云同步与 ICS 订阅需要登录）', 'account', 'lock')}
      </div>

      <div className="mt-4">
        <p className="px-1 pb-1 text-[11px] font-semibold text-ink-faint">日历订阅</p>
        {icsUrl ? (
          <div className="border-t border-ink/[0.06] px-1 py-2">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px] text-ink"><Icon name="download" size="md" className="shrink-0 text-ink-soft" />ICS 订阅链接</span>
              <button
                type="button"
                data-testid="settings-ics-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(icsUrl).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  }).catch(() => { /* 剪贴板不可用：链接仍完整可见可手动复制 */ });
                }}
                className="rounded-lg border border-ink/10 bg-white px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:border-brand/30 hover:text-brand focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]"
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-[10.5px] leading-4 text-ink-faint">{icsUrl}</p>
          </div>
        ) : (
          row('ICS 订阅链接', '登录后生成（系统日历免备案提醒通道）', 'ics', 'download')
        )}
      </div>
    </section>
  );
}
