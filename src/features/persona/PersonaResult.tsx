import type { PersonaProfile } from '@/types';
import { AXIS_KEYS, AXIS_META, SCENARIO_META, ARCH_EMOJI } from '@/lib/persona';
import { Radar } from '@/components/Radar';
import { Card } from '@/components/ui/Card';

interface Props {
  profile: PersonaProfile;
  onEnter: () => void;
  onRetake: () => void;
}

const CONF_LABEL = { high: '高置信', mid: '中置信', low: '低置信' } as const;
const CONF_COLOR = { high: 'text-ok bg-ok-light', mid: 'text-warn bg-warn-light', low: 'text-ink-faint bg-paper' } as const;

export function PersonaResult({ profile, onEnter, onRetake }: Props) {
  const { primary, secondary } = profile.archetype;
  const primaryEmoji = primary ? ARCH_EMOJI[primary.id] ?? '🎓' : '🎓';
  const scenarioEntries = Object.entries(SCENARIO_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    value: meta.values[profile.scenarios[key as keyof typeof profile.scenarios]] ?? '—',
  }));

  return (
    <div className="min-h-screen bg-paper">
      <div className="content-shell flex flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
        <header className="fade-item pt-2 text-center">
          <p className="section-label">PROFILE COMPLETE</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">你的校园画像</h1>
          {primary ? (
            <>
              <div className="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-brand-light text-2xl">{primaryEmoji}</div>
              <p className="mt-4 text-lg font-semibold text-ink">
                你更接近 <span className="text-brand">{primary.name}</span>
              </p>
              <p className="mt-2 text-sm text-ink-soft">{primary.tagline}</p>
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-ink-soft">画像还需要一点时间校准；重答几题，或在使用中慢慢完善。</p>
          )}
        </header>

        {/* The radar remains the data focal point; surrounding copy is intentionally restrained. */}
        <Card className="fade-item">
          <Radar axes={profile.axes} size={300} />
          <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
            {AXIS_KEYS.map((k) => (
              <span key={k} className="text-[11px] text-ink-faint">
                {AXIS_META[k].short} <strong className="text-ink">{Math.round(profile.axes[k])}</strong>
              </span>
            ))}
          </div>
        </Card>

        <Card title="推荐起点" subtitle="用于提供初始建议；之后可随你的使用习惯持续校准。" className="fade-item">
          <div className="rounded-xl border border-brand/15 bg-brand-light/60 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/70 text-xl">{primaryEmoji}</span>
              <div>
                <div className="text-base font-semibold tracking-tight text-brand">{primary?.name ?? '画像尚不清晰'}</div>
                <div className="mt-1 text-xs text-ink-soft">{primary?.tagline ?? '再答几题，或在使用中慢慢校准'}</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-soft">{primary?.desc ?? '目前的答题还不足以稳定归类，多使用后会更准确。'}</p>
          </div>
          {secondary && (
            <p className="mt-4 text-xs leading-5 text-ink-faint">
              另一种接近的倾向是 <strong className="font-semibold text-ink-soft">{secondary.name}</strong>：{secondary.tagline}
            </p>
          )}
        </Card>

        <Card title="八个生活维度" subtitle="数值越高，表示这项倾向更明显；它不用于任何排名。" className="fade-item">
          <div className="flex flex-col gap-4">
            {AXIS_KEYS.map((k) => {
              const v = Math.round(profile.axes[k]);
              const conf = profile.confidence[k] ?? 'mid';
              return (
                <div key={k} className="grid grid-cols-[88px_minmax(0,1fr)_28px] items-center gap-3 sm:grid-cols-[100px_minmax(0,1fr)_32px_44px]">
                  <div className="text-xs font-medium text-ink">{AXIS_META[k].label}</div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${v}%` }} />
                  </div>
                  <div className="text-right text-xs font-semibold text-ink tabular-nums">{v}</div>
                  <span className={`hidden rounded-md px-1.5 py-1 text-center text-[10px] sm:inline ${CONF_COLOR[conf]}`}>{CONF_LABEL[conf]}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="日常习惯" subtitle="这些偏好会直接影响之后的校园生活推荐。" className="fade-item">
          <div className="grid grid-cols-2 gap-3">
            {scenarioEntries.map((s) => (
              <div key={s.key} className="rounded-xl border border-ink/10 bg-paper px-3 py-3">
                <div className="text-[11px] font-medium text-ink-faint">{s.label}</div>
                <div className="mt-1 text-sm font-semibold text-ink">{s.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-3 pb-10 pt-1">
          <button onClick={onEnter} className="button-primary w-full">
            进入应用
          </button>
          <button onClick={onRetake} className="py-3 text-sm font-medium text-ink-faint transition-colors hover:text-ink">
            重新测评
          </button>
        </div>
      </div>
    </div>
  );
}
