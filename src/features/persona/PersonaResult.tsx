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

const SCENARIO_EMOJI: Record<string, string> = {
  meal_radius: '🍜', planning: '📅', event_breadth: '🎪', social_radius: '👥',
  night_supply: '🌙', exercise_trigger: '🏃', study_place: '📖', info_channel: '📡',
};

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
      <div className="page-shell px-5 py-8 flex flex-col gap-5">
        <header className="text-center pt-2 fade-item">
          <p className="section-label mb-1">YOUR USST PROFILE</p>
          <h1 className="text-[26px] font-black text-ink">你的上理人设</h1>
          {primary ? (
            <>
              <div className="mt-4 text-[52px] animate-bounce-soft select-none">{primaryEmoji}</div>
              <p className="mt-2 text-[17px] font-bold text-ink">
                鉴定完毕，你是一只 <span className="text-brand">{primaryEmoji} {primary.name}</span>
              </p>
              <p className="mt-1 text-[13.5px] text-ink-soft">「{primary.tagline}」</p>
            </>
          ) : (
            <p className="mt-3 text-[15px] text-ink-soft">画像还差一点火候，再答几题或使用中慢慢校准。</p>
          )}
        </header>

        {/* 雷达 */}
        <Card className="fade-item">
          <Radar axes={profile.axes} size={300} />
          <div className="flex justify-center gap-2 mt-3 flex-wrap">
            {AXIS_KEYS.map((k) => (
              <span key={k} className="text-[11px] text-ink-faint">
                {AXIS_META[k].short} <strong className="text-ink">{Math.round(profile.axes[k])}</strong>
              </span>
            ))}
          </div>
        </Card>

        {/* 原型 */}
        <Card title="校园原型" subtitle="用于冷启动推荐，后续可随时在「我的画像」里修正" className="fade-item">
          <div className="rounded-2xl bg-brand-light border-2 border-brand/10 p-4">
            <div className="flex items-center gap-3">
              <span className="text-[28px]">{primaryEmoji}</span>
              <div>
                <div className="font-bold text-[16px] text-brand">{primary?.name ?? '画像尚不清晰'}</div>
                <div className="text-[12.5px] text-ink-soft">{primary?.tagline ?? '再答几题，或使用中慢慢校准'}</div>
              </div>
            </div>
            <p className="mt-2.5 text-[13px] text-ink-soft leading-relaxed">{primary?.desc ?? '目前的答题还不足以稳定归类，多使用后会更准。'}</p>
          </div>
          {secondary && (
            <p className="mt-3 text-[13px] text-ink-faint">
              次接近 <strong className="text-ink-soft">{secondary.name}</strong>（{secondary.tagline}）
            </p>
          )}
        </Card>

        {/* 八轴条形 */}
        <Card title="八轴画像" subtitle="值越高倾向越强，仅供个性化服务，不用于任何排名" className="fade-item">
          <div className="flex flex-col gap-3">
            {AXIS_KEYS.map((k) => {
              const v = Math.round(profile.axes[k]);
              const conf = profile.confidence[k] ?? 'mid';
              return (
                <div key={k} className="flex items-center gap-3">
                  <div className="w-[92px] shrink-0 text-[13px] font-medium text-ink">{AXIS_META[k].label}</div>
                  <div className="flex-1 h-2.5 rounded-full bg-paper overflow-hidden">
                    <div className="h-full bg-brand rounded-full" style={{ width: `${v}%` }} />
                  </div>
                  <div className="w-8 text-right text-[13px] font-bold text-ink tabular-nums">{v}</div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${CONF_COLOR[conf]}`}>{CONF_LABEL[conf]}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* 场景字段 */}
        <Card title="你的校园习惯" subtitle="这些直接驱动推荐，最准" className="fade-item">
          <div className="grid grid-cols-2 gap-2.5">
            {scenarioEntries.map((s) => (
              <div key={s.key} className="rounded-xl bg-paper px-3 py-2.5 border border-paper-line">
                <div className="text-[11px] text-ink-faint">
                  {SCENARIO_EMOJI[s.key] ?? '📌'} {s.label}
                </div>
                <div className="text-[13.5px] font-semibold text-ink mt-0.5">{s.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-3 pb-10">
          <button onClick={onEnter} className="py-3.5 rounded-full bg-brand text-white font-bold text-[15px] shadow-sticker-brand hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none transition-all">
            进入我的上理 →
          </button>
          <button onClick={onRetake} className="py-3 text-[13.5px] text-ink-faint hover:text-ink">
            重新测评
          </button>
        </div>
      </div>
    </div>
  );
}
