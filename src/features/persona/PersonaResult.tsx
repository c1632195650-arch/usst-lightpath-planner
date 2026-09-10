import type { PersonaProfile } from '@/types';
import { AXIS_KEYS, AXIS_META, SCENARIO_META } from '@/lib/persona';
import { Radar } from '@/components/Radar';

interface Props {
  profile: PersonaProfile;
  onEnter: () => void;
  onRetake: () => void;
}

const CONF_LABEL = { high: '较稳定', mid: '待校准', low: '参考' } as const;
const CONF_COLOR = { high: 'text-ok', mid: 'text-warn', low: 'text-ink-faint' } as const;

/** 将 35 题的输出收束为可用于排程的个人信号，而不是一张“人格报告”。 */
export function PersonaResult({ profile, onEnter, onRetake }: Props) {
  const { primary, secondary } = profile.archetype;
  const scenarioEntries = Object.entries(SCENARIO_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    value: meta.values[profile.scenarios[key as keyof typeof profile.scenarios]] ?? '待补充',
  }));

  return (
    <div className="min-h-full">
      <div className="page-shell px-4 py-6 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-2xl bg-ink text-white shadow-sm">
          <div className="grid gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end lg:gap-12 lg:px-10 lg:py-10">
            <div>
              <p className="section-label text-white/50">PROFILE READY</p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">你的节奏，已经有了轮廓。</h1>
              {primary ? (
                <>
                  <p className="mt-5 text-xl font-semibold text-brand-light">{primary.name}</p>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/65">{primary.tagline}</p>
                  <p className="mt-5 max-w-2xl text-sm leading-7 text-white/80">{primary.desc}</p>
                </>
              ) : (
                <p className="mt-5 max-w-xl text-sm leading-6 text-white/70">目前的答案还不足以稳定归类；你可以继续使用应用，或重新完成几道题进行校准。</p>
              )}
              {secondary && (
                <p className="mt-6 border-t border-white/10 pt-4 text-sm text-white/60">
                  也接近 <strong className="font-semibold text-white">{secondary.name}</strong> · {secondary.tagline}
                </p>
              )}
            </div>

            <div className="border-t border-white/10 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/45">PROFILE SIGNAL</p>
              <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
                <div>
                  <p className="text-xs text-white/50">画像版本</p>
                  <p className="mt-1 text-sm font-semibold text-white">{profile.version}</p>
                </div>
                <div>
                  <p className="text-xs text-white/50">结果状态</p>
                  <p className="mt-1 text-sm font-semibold text-white">{profile.quality === 'ok' ? '可用于推荐' : '建议复测'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-white/50">用途</p>
                  <p className="mt-1 text-sm leading-6 text-white/75">用于安排学习、休息与校园生活建议，不参与任何排名。</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="border border-ink/10 bg-white px-5 py-6 sm:px-8">
            <p className="section-label">EIGHT DIMENSIONS</p>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">你的倾向分布</h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">八个维度共同决定建议的初始方向，数值不代表好坏。</p>
            <div className="mt-6 flex justify-center border-y border-ink/10 py-5">
              <Radar axes={profile.axes} size={300} />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2">
              {AXIS_KEYS.map((key) => (
                <span key={key} className="text-sm text-ink-soft">
                  {AXIS_META[key].short} <strong className="ml-1 font-semibold text-ink tabular-nums">{Math.round(profile.axes[key])}</strong>
                </span>
              ))}
            </div>
          </section>

          <section className="border border-ink/10 bg-white px-5 py-6 sm:px-8">
            <p className="section-label">PLANNING INPUTS</p>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">排程会参考这些信号</h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">以后可以重新测评，或在使用中慢慢校准。</p>
            <dl className="mt-6 divide-y divide-ink/10 border-y border-ink/10">
              {AXIS_KEYS.map((key) => {
                const value = Math.round(profile.axes[key]);
                const confidence = profile.confidence[key] ?? 'mid';
                return (
                  <div key={key} className="grid grid-cols-[88px_minmax(0,1fr)_40px] items-center gap-3 py-3 sm:grid-cols-[104px_minmax(0,1fr)_48px_48px]">
                    <dt className="text-sm font-medium text-ink">{AXIS_META[key].short}</dt>
                    <dd className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${value}%` }} />
                    </dd>
                    <dd className="text-right text-sm font-semibold text-ink tabular-nums">{value}</dd>
                    <dd className={`hidden text-right text-xs font-medium sm:block ${CONF_COLOR[confidence]}`}>{CONF_LABEL[confidence]}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>

        <section className="mt-6 border border-ink/10 bg-white px-5 py-6 sm:px-8">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="section-label">EVERYDAY PREFERENCES</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">日常选择</h2>
            </div>
            <p className="max-w-lg text-sm leading-6 text-ink-soft">这些具体偏好会直接影响推荐地点、活动与休息时间。</p>
          </div>
          <dl className="mt-6 grid border-t border-ink/10 sm:grid-cols-2 lg:grid-cols-4">
            {scenarioEntries.map((entry) => (
              <div key={entry.key} className="border-b border-ink/10 py-4 sm:pr-5 lg:pr-6">
                <dt className="text-sm text-ink-faint">{entry.label}</dt>
                <dd className="mt-2 text-sm font-semibold text-ink">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-6 flex flex-col-reverse gap-3 pb-8 sm:flex-row sm:items-center sm:justify-between">
          <button onClick={onRetake} className="min-h-11 px-3 text-sm font-medium text-ink-soft transition-colors hover:text-ink">
            重新完成测评
          </button>
          <button onClick={onEnter} className="button-primary min-h-11 px-5">
            进入我的本周安排
          </button>
        </div>
      </div>
    </div>
  );
}
