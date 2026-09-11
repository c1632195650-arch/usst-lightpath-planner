/**
 * 课表导入联调页（开发用）
 *
 * 用途：验证「浏览器 → Vite 代理 /timetable → 127.0.0.1:8765 课表解析服务 → 适配层 → Schedule」整条链路。
 * 只在 dev 环境的顶栏出现，不影响正式流程。
 *
 * 这里允许 fetch 和读文件 —— 真正的纯函数在 src/lib/parseSchedule.ts，测试逻辑不掺进去。
 */

import { useCallback, useEffect, useState } from 'react';
import type { Schedule } from '@/types';
import {
  fetchSchedule,
  importPdfToSchedule,
  pingTimetableService,
  type ScheduleImportResult,
} from '@/lib/timetableClient';
import { periodStartMin, periodEndMin, toHHmm } from '@/constants/time';

const DAY = ['', '一', '二', '三', '四', '五', '六', '日'];

interface Props {
  /** 把导入结果写进 AppState.schedule，让周视图用真实课表渲染 */
  onApply: (s: Schedule) => void;
}

export function ImportTester({ onApply }: Props) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScheduleImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [semesterKey, setSemesterKey] = useState('');
  const [applied, setApplied] = useState(false);

  const probe = useCallback(async () => setOnline(await pingTimetableService()), []);
  useEffect(() => { void probe(); }, [probe]);

  // 手填学期 key 只是**覆盖**用；不填则从 PDF 文件名或校历自动解
  const meta = semesterKey.trim() ? { semesterKey: semesterKey.trim() } : {};

  const run = async (fn: () => Promise<ScheduleImportResult>) => {
    setBusy(true);
    setErr(null);
    setApplied(false);
    try {
      setResult(await fn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const errors = result?.issues.filter((i) => i.level === 'error') ?? [];
  const warns = result?.issues.filter((i) => i.level === 'warn') ?? [];

  return (
    <div className="content-shell flex flex-col gap-5">
      <section className="panel p-5">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              online === null ? 'bg-ink-faint' : online ? 'bg-brand' : 'bg-red-500'
            }`}
          />
          <h2 className="text-base font-semibold tracking-tight text-ink">课表解析服务</h2>
          <span className="text-xs text-ink-faint">
            {online === null ? '探测中…' : online ? '127.0.0.1:8765 已连通' : '未连通 —— 先跑 python server.py 8765'}
          </span>
          <button onClick={() => void probe()} className="ml-auto text-xs font-semibold text-brand transition-colors hover:text-brand-dark">
            重试
          </button>
        </div>
        <div className="text-xs leading-relaxed text-ink-faint">
          浏览器走同源代理 <code className="rounded bg-paper px-1.5 py-0.5 text-ink-soft">/timetable</code>，Vite 转发到 8765，所以没有跨域问题。
        </div>
      </section>

      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={busy || !online}
            onClick={() => void run(() => fetchSchedule(meta))}
            className="button-primary px-4 py-2 text-[13px]"
          >
            {busy ? '解析中…' : '拉取当前课表'}
          </button>

          <label
            className={`button-secondary px-4 py-2 text-[13px] ${
              busy || !online ? 'pointer-events-none opacity-40' : 'cursor-pointer'
            }`}
          >
            上传 PDF 课表
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void run(() => importPdfToSchedule(f, meta));
                e.target.value = '';
              }}
            />
          </label>

          <input
            value={semesterKey}
            onChange={(e) => setSemesterKey(e.target.value)}
            placeholder="学期 key（可留空，如 2026-2027-1）"
            className="min-w-[180px] flex-1 rounded-xl border border-ink/10 bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>
        <div className="text-[11.5px] leading-relaxed text-ink-faint">
          学期 key 留空时：优先用 PDF 文件名里的学期（教务默认名形如「姓名(2026-2027-1)课表.pdf」），
          再退化到校历常量表。<strong className="text-ink-soft">termStart 不用手填。</strong>
        </div>
      </section>

      {err && (
        <section className="panel border-danger/25 bg-danger-light p-5">
          <div className="mb-1 text-[13.5px] font-semibold text-danger">导入失败</div>
          <div className="text-[12.5px] text-ink-soft whitespace-pre-wrap">{err}</div>
        </section>
      )}

      {result && (
        <>
          <section className="panel p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-ink">{result.schedule.semesterName || '（未命名学期）'}</h3>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  result.term.exact ? 'bg-brand-light text-brand' : 'bg-warn-light text-warn'
                }`}
              >
                {result.term.exact ? '校历精确' : '估算 · 待核对'}
              </span>
              <span className="text-[12px] text-ink-faint">{result.schedule.semesterType}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <div className="text-ink-soft">学期起始（第1周周一）</div>
              <div className="font-bold text-ink">{result.schedule.termStart || '—— 无法解析 ——'}</div>
              <div className="text-ink-soft">总周数</div>
              <div className="font-bold text-ink">{result.schedule.totalWeeks}</div>
              <div className="text-ink-soft">课程数 / 原始记录</div>
              <div className="font-bold text-ink">
                {result.schedule.courses.length} 门 / {result.schedule.courses.length + result.skipped.length} 条
              </div>
            </div>
            <div className="mt-3 border-t border-ink/10 pt-3 text-[11.5px] leading-relaxed text-ink-faint">
              来源：{result.term.source}
            </div>
          </section>

          {result.schedule.courses.map((c) => (
            <section key={c.id} className="panel p-5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[14px] font-semibold text-ink">{c.name}</span>
                <span className="text-[11.5px] text-ink-faint">{c.credit} 学分 · {c.teacher ?? '—'}</span>
                <span className="ml-auto text-[11.5px] text-ink-faint">
                  {c.campus}
                  {c.building ? ` · ${c.building}${c.room ?? ''}` : ' · 未排地点'}
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                {c.slots.map((s, i) => (
                  <div key={i} className="text-[12.5px] text-ink-soft">
                    周{DAY[s.dayOfWeek]} 第{s.startPeriod}-{s.endPeriod}节
                    <span className="text-ink-faint">
                      {' '}
                      {toHHmm(periodStartMin(s.startPeriod))}–{toHHmm(periodEndMin(s.endPeriod))}
                    </span>
                    <span className="text-ink-faint"> · {s.weeks.length ? `${s.weeks.length} 周` : '全学期'}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {result.roomConflicts.length > 0 && (
            <section className="panel border-warn/25 bg-warn-light p-5">
              <div className="mb-1 text-[13.5px] font-semibold text-warn">
                教室冲突 {result.roomConflicts.length} 条（一门课应只有一个教室）
              </div>
              {result.roomConflicts.map((rc) => (
                <div key={rc.courseName} className="text-[12.5px] text-ink-soft">
                  {rc.courseName}：{rc.rooms.join(' / ')}
                </div>
              ))}
            </section>
          )}

          {result.skipped.length > 0 && (
            <section className="panel border-warn/25 bg-warn-light p-5">
              <div className="mb-1 text-[13.5px] font-semibold text-warn">
                跳过 {result.skipped.length} 条（解析不出来，未静默丢弃）
              </div>
              {result.skipped.map((s, i) => (
                <div key={i} className="text-[12.5px] text-ink-soft">
                  {s.reason}
                </div>
              ))}
            </section>
          )}

          <section className="panel p-5">
            <div className="mb-3 text-[13.5px] font-semibold text-ink">
              自检：{errors.length} 个 error，{warns.length} 个 warn
            </div>
            {errors.map((i, k) => (
              <div key={`e${k}`} className="text-[12.5px] text-red-600">[error] {i.message}</div>
            ))}
            {warns.map((i, k) => (
              <div key={`w${k}`} className="text-[12.5px] text-amber-700">[warn] {i.message}</div>
            ))}
            {errors.length + warns.length === 0 && (
              <div className="text-[12.5px] text-ink-faint">没有问题</div>
            )}
          </section>

          <button
            disabled={errors.length > 0 || applied}
            onClick={() => { onApply(result.schedule); setApplied(true); }}
            className="button-primary py-3 text-[14px] disabled:cursor-not-allowed"
          >
            {applied ? '已写入我的课表 ✓' : errors.length > 0 ? '先修完 error 才能写入' : '写入我的课表 →'}
          </button>
        </>
      )}
    </div>
  );
}
