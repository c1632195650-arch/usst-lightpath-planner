import { useCallback, useEffect, useState } from 'react';
import {
  decideFact, deleteFact, memoryFacts,
  type MemoryFact,
} from '@/lib/api';
import { applyObjectiveFact, objectiveKeyToField } from '@/lib/identity';

/**
 * 记忆面板（M3）：梨宝记住了什么，在这里全部可见、可确认、可撤销、可删。
 * 与 LearnedPreferencesPanel（Ray 的反馈面板）同一交互范式：置灰 + 撤销 + 删除。
 */

/** facts 的 key → 中文标签（面板与对话建议卡共用）。 */
export function factLabel(key: string): string {
  if (key === 'grade') return '年级';
  if (key === 'college') return '学院';
  if (key === 'major') return '专业';
  if (key.startsWith('preferences.')) return `偏好 · ${key.slice('preferences.'.length)}`;
  if (key.startsWith('weak.')) return `自认薄弱 · ${key.slice('weak.'.length)}`;
  if (key.startsWith('course.')) return `在学 · ${key.slice('course.'.length)}`;
  return key;
}

interface Props {
  open: boolean;
  userId: string;
  onClose: () => void;
}

export function MemoryPanel({ open, userId, onClose }: Props) {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await memoryFacts(userId);
      setFacts(r.facts ?? []);
      setError('');
    } catch {
      setError('记忆服务未连接，稍后再试。');
    }
  }, [userId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const act = async (fact: MemoryFact, action: 'confirm' | 'reject' | 'undo') => {
    setBusyId(fact.id);
    try {
      await decideFact(userId, fact.id, action);
      // 客观事实确认 → 同步写进本地基础信息（对 AI 只提议、用户拍板的落地）
      if (action === 'confirm' && objectiveKeyToField(fact.key)) {
        applyObjectiveFact(fact.key, fact.value);
      }
      await refresh();
    } catch {
      setError('这次操作没成功，稍后再试。');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (fact: MemoryFact) => {
    setBusyId(fact.id);
    try {
      await deleteFact(userId, fact.id);
      await refresh();
    } catch {
      setError('这次操作没成功，稍后再试。');
    } finally {
      setBusyId(null);
    }
  };

  const pending = facts.filter((f) => f.status === 'pending');
  const applied = facts.filter((f) => f.status === 'applied');

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="梨宝的记忆">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_44px_rgba(22,35,63,0.18)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">梨宝的记忆</h2>
            <p className="mt-1 text-xs leading-5 text-ink-faint">
              身份类信息（年级/学院/专业）由你确认后生效；偏好自动生效但可撤销；一切可删。
            </p>
          </div>
          <button onClick={onClose} className="min-h-9 rounded-xl border border-ink/15 px-3 text-xs text-ink-soft transition-colors hover:border-ink/30">
            关闭
          </button>
        </div>

        {error && <p className="mt-3 rounded-xl border border-accent/25 bg-accent-light px-3 py-2 text-xs text-ink-soft">{error}</p>}

        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">待你确认（{pending.length}）</h3>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-ink-faint">暂时没有需要你拍板的。梨宝听到你的年级、学院、专业时，会先问过你再记。</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {pending.map((f) => (
                <li key={f.id} className="rounded-xl border border-ink/10 bg-paper px-3 py-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{factLabel(f.key)}：{f.value}</span>
                    <span className="flex shrink-0 gap-2">
                      <button disabled={busyId === f.id} onClick={() => void act(f, 'confirm')} className="button-primary px-3 py-1.5 text-xs disabled:opacity-40">记下来</button>
                      <button disabled={busyId === f.id} onClick={() => void act(f, 'reject')} className="rounded-xl border border-ink/15 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink/30 disabled:opacity-40">不记</button>
                    </span>
                  </div>
                  {f.source && <p className="mt-1 text-[11.5px] text-ink-faint">出处：「{f.source}」</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">已生效（{applied.length}）</h3>
          {applied.length === 0 ? (
            <p className="mt-2 text-sm text-ink-faint">还没有已生效的记忆。</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {applied.map((f) => (
                <li key={f.id} className="rounded-xl border border-ink/10 bg-paper px-3 py-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">
                      {factLabel(f.key)}：{f.value}
                      {f.kind === 'objective' && <span className="ml-2 text-[11px] font-normal text-ink-faint">你确认过的</span>}
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <button disabled={busyId === f.id} onClick={() => void act(f, 'undo')} className="rounded-xl border border-ink/15 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink/30 disabled:opacity-40">撤销</button>
                      <button disabled={busyId === f.id} onClick={() => void remove(f)} className="rounded-xl border border-ink/15 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink/30 disabled:opacity-40">删除</button>
                    </span>
                  </div>
                  {f.source && <p className="mt-1 text-[11.5px] text-ink-faint">出处：「{f.source}」</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
