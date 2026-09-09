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
    <div className="flex flex-col gap-4">
      <section className="sticker p-4">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              online === null ? 'bg-ink-faint' : online ? 'bg-brand' : 'bg-red-500'
            }`}
          />
          <h2 className="font-bold text-[15px] text-ink">课表解析服务</h2>
          <span className="text-[12px] text-ink-faint">
            {online === null ? '探测中…' : online ? '127.0.0.1:8765 已连通' : '未连通 —— 先跑 python server.py 8765'}
          </span>
          <button onClick={() => void probe()} className="ml-auto text-[12px] text-brand font-bold">
            重试
          </button>
        </div>
        <div className="text-[12px] text-ink-faint leading-relaxed">
          浏览器走同源代理 <code className="bg-paper px-1 rounded">/timetable</code>，Vite 转发到 8765，所以没有跨域问题。
        </div>
      </section>

      <section className="sticker p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={busy || !online}
            onClick={() => void run(() => fetchSchedule(meta))}
            className="px-4 py-2 rounded-full bg-brand text-white text-[13px] font-bold shadow-sticker-brand disabled:opacity-40"
          >
            {busy ? '解析中…' : '拉取当前课表'}
          </button>

          <label
            className={`px-4 py-2 rounded-full border-2 border-brand/25 text-brand text-[13px] font-bold ${
              busy || !online ? 'opacity-40 pointer-events-none' : 'cursor-pointer hover:bg-brand-light'
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
            className="flex-1 min-w-[180px] px-3 py-2 rounded-full bg-paper text-[13px] text-ink placeholder:text-ink-faint outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div className="text-[11.5px] text-ink-faint leading-relaxed">
          学期 key 留空时：优先用 PDF 文件名里的学期（教务默认名形如「姓名(2026-2027-1)课表.pdf」），
          再退化到校历常量表。<strong className="text-ink-soft">termStart 不用手填。</strong>
        </div>
      </section>

      {err && (
        <section className="sticker p-4 border-2 border-red-300">
          <div className="font-bold text-[13.5px] text-red-600 mb-1">导入失败</div>
          <div className="text-[12.5px] text-ink-soft whitespace-pre-wrap">{err}</div>
        </section>
      )}

      {result && (
        <>
          <section className="sticker p-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h3 className="font-bold text-[14px] text-ink">{result.schedule.semesterName || '（未命名学期）'}</h3>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  result.term.exact ? 'bg-brand-light text-brand' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {result.term.exact ? '校历精确' : '估算 · 待核对'}
              </span>
              <span className="text-[12px] text-ink-faint">{result.schedule.semesterType}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
              <div className="text-ink-soft">学期起始（第1周周一）</div>
              <div className="font-bold text-ink">{result.schedule.termStart || '—— 无法解析 ——'}</div>
              <div className="text-ink-soft">总周数</div>
              <div className="font-bold text-ink">{result.schedule.totalWeeks}</div>
              <div className="text-ink-soft">课程数 / 原始记录</div>
              <div className="font-bold text-ink">
                {result.schedule.courses.length} 门 / {result.schedule.courses.length + result.skipped.length} 条
              </div>
            </div>
            <div className="mt-2 text-[11.5px] text-ink-faint leading-relaxed border-t border-paper-line pt-2">
              来源：{result.term.source}
            </div>
          </section>

          {result.schedule.courses.map((c) => (
            <section key={c.id} className="sticker p-4">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-bold text-[14px] text-ink">{c.name}</span>
                <span className="text-[11.5px] text-ink-faint">{c.credit} 学分 · {c.teacher ?? '—'}</span>
                <span className="ml-auto text-[11.5px] text-ink-faint">
                  {c.campus}
                  {c.building ? ` · ${c.building}${c.room ?? ''}` : ' · 未排地点'}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
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
            <section className="sticker p-4 border-2 border-amber-300">
              <div className="font-bold text-[13.5px] text-amber-700 mb-1">
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
            <section className="sticker p-4 border-2 border-amber-300">
              <div className="font-bold text-[13.5px] text-amber-700 mb-1">
                跳过 {result.skipped.length} 条（解析不出来，未静默丢弃）
              </div>
              {result.skipped.map((s, i) => (
                <div key={i} className="text-[12.5px] text-ink-soft">
                  {s.reason}
                </div>
              ))}
            </section>
          )}

          <section className="sticker p-4">
            <div className="font-bold text-[13.5px] text-ink mb-2">
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
            className="py-3 rounded-full bg-brand text-white font-bold text-[14px] shadow-sticker-brand disabled:opacity-40"
          >
            {applied ? '已写入我的课表 ✓' : errors.length > 0 ? '先修完 error 才能写入' : '写入我的课表 →'}
          </button>
        </>
      )}
    </div>
  );
}
