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
  /** 场景题保留原始语义，让学生知道这些答案会影响哪些推荐。 */
  const scenarioEntries = Object.entries(SCENARIO_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    value: meta.values[profile.scenarios[key as keyof typeof profile.scenarios]] ?? '待补充',
  }));

  return (
    <div className="min-h-full">
      <div className="page-shell px-4 py-6 sm:px-6 sm:py-8">
        <section className="hero-surface overflow-hidden rounded-2xl border border-white/10 text-white shadow-[0_18px_44px_rgba(22,35,63,0.18)]">
          <div className="grid gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12 lg:px-10 lg:py-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">YOUR PLANNING PROFILE</p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">你的节奏，已经有了轮廓。</h1>
              {primary ? (
                <>
                  <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="text-xl font-semibold text-brand-light">{primary.name}</p>
                    <p className="text-sm text-white/55">{primary.tagline}</p>
                  </div>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-white/75">{primary.desc}</p>
                </>
              ) : (
                <p className="mt-5 max-w-xl text-sm leading-6 text-white/70">目前的答案还不足以稳定归类；你可以继续使用应用，或重新完成几道题进行校准。</p>
              )}
              {secondary && (
                <p className="mt-6 border-t border-white/10 pt-4 text-sm leading-6 text-white/60">
                  另一个接近的节奏是 <strong className="font-semibold text-white">{secondary.name}</strong> · {secondary.tagline}
                </p>
              )}
            </div>

            <dl className="grid content-start gap-4 border-t border-white/10 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div className="border-b border-white/10 pb-4">
                <dt className="text-xs text-white/45">画像状态</dt>
                <dd className="mt-1 text-sm font-semibold text-white">{profile.quality === 'ok' ? '可用于推荐' : '建议复测'}</dd>
              </div>
              <div className="border-b border-white/10 pb-4">
                <dt className="text-xs text-white/45">画像版本</dt>
                <dd className="mt-1 text-sm font-semibold text-white">{profile.version}</dd>
              </div>
              <div>
                <dt className="text-xs text-white/45">会影响什么</dt>
                <dd className="mt-1 text-sm leading-6 text-white/70">本周的学习、休息和校园生活建议；不会用于排名。</dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
            <p className="text-sm text-white/55">这是一份可随使用慢慢校准的排程输入。</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={onRetake} className="min-h-11 px-3 text-sm font-medium text-white/65 transition-colors hover:text-white">重新完成测评</button>
              <button onClick={onEnter} className="min-h-11 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-brand-light">进入我的本周安排</button>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <section className="panel overflow-hidden">
            <header className="border-b border-ink/10 px-5 py-5 sm:px-7 sm:py-6">
              <p className="section-label">EIGHT DIMENSIONS</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">你的倾向分布</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-soft">八个维度共同决定建议的初始方向，数值不代表好坏。</p>
            </header>
            <div className="px-5 py-5 sm:px-7 sm:py-6">
              <Radar axes={profile.axes} size={320} />
              <div className="mt-4 grid grid-cols-2 border-t border-ink/10 pt-4 text-sm sm:grid-cols-4">
                {AXIS_KEYS.map((key) => (
                  <div key={key} className="py-2">
                    <span className="text-ink-faint">{AXIS_META[key].short}</span>
                    <strong className="ml-2 font-semibold text-ink tabular-nums">{Math.round(profile.axes[key])}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <header className="border-b border-ink/10 px-5 py-5 sm:px-7 sm:py-6">
              <p className="section-label">PLANNING INPUTS</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">排程会参考这些信号</h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft">稳定度只说明本轮回答的参考程度；以后可以重新测评或继续校准。</p>
            </header>
            <dl className="px-5 sm:px-7">
              {AXIS_KEYS.map((key) => {
                const value = Math.round(profile.axes[key]);
                const confidence = profile.confidence[key] ?? 'mid';
                return (
                  <div key={key} className="grid grid-cols-[72px_minmax(0,1fr)_40px] items-center gap-3 border-b border-ink/10 py-4 last:border-0 sm:grid-cols-[88px_minmax(0,1fr)_44px_52px]">
                    <dt className="text-sm font-medium text-ink">{AXIS_META[key].short}</dt>
                    <dd className="h-1.5 overflow-hidden rounded-full bg-paper-sunken">
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

        <section className="panel mt-6 overflow-hidden">
          <div className="flex flex-col justify-between gap-3 border-b border-ink/10 px-5 py-5 sm:flex-row sm:items-end sm:px-7 sm:py-6">
            <div>
              <p className="section-label">EVERYDAY PREFERENCES</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">你给出的日常偏好</h2>
            </div>
            <p className="max-w-lg text-sm leading-6 text-ink-soft">这些具体选择会直接影响推荐地点、活动与休息时间。</p>
          </div>
          <dl className="grid sm:grid-cols-2 lg:grid-cols-4">
            {scenarioEntries.map((entry) => (
              <div key={entry.key} className="border-b border-ink/10 px-5 py-4 last:border-b-0 sm:odd:border-r sm:px-6 lg:border-b-0 lg:border-r lg:px-7 lg:last:border-r-0">
                <dt className="text-sm text-ink-faint">{entry.label}</dt>
                <dd className="mt-2 text-sm font-semibold text-ink">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
