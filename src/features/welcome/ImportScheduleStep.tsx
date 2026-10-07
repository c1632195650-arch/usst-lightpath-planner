import { useCallback, useEffect, useState } from 'react';
import type { Schedule } from '@/types';
import {
  importPdfToSchedule,
  pingTimetableService,
  type ScheduleImportResult,
} from '@/lib/timetableClient';
import { Icon } from '@/components/icons/Icon';

interface Props {
  /** 把导入结果写进 AppState.schedule（与 ImportTester 同一通道） */
  onApply: (s: Schedule) => void;
  /** 下一步（= 问卷）。跳过与完成走同一个出口 —— 导入是可选的，绝不阻塞 */
  onNext: () => void;
  onBack: () => void;
  /** 已有一份真实课表时的课程数；>0 时提示「重新导入会覆盖」 */
  existingCourseCount: number;
}

/**
 * 引导步 · 导入你的课表（2026-10-07，RAY：「一开始就在个人信息后提供导入窗口」）。
 * ============================================================
 * 位置：基础信息之后、问卷之前 —— 课表不依赖画像，越早进来，问卷之后的
 * 画像结果页 / 今天页 / 周计划就全部直接围绕真实上课时间安排（原先要
 * 进主界面看到样例后才能绕到导入页）。
 *
 * 与 `features/import/ImportTester.tsx` 的关系：那是**联调页**（结果全量
 * 展开、逐门课列slot、自检清单， dev 导航里的「导入课表」），本步是它的
 * onboarding 瘦身版 —— 只保留「上传 PDF → 摘要 → 写入」主干，不逐门展开。
 * 解析/网络全在 `@/lib/timetableClient`，两处共用，不分叉。
 *
 * 纪律：
 * · **可跳过不阻塞**（弹窗三纪律同款）——「跳过，先不导」与「下一步」等效；
 * · **诚实**：解析服务不在时明说 + 给跳过出口（设计原则 6「后端不可用要显示」）；
 * · 已有真实课表时重导 = 覆盖，必须提前一句话告知（不猜、不静默覆盖）。
 */
export function ImportScheduleStep({ onApply, onNext, onBack, existingCourseCount }: Props) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScheduleImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const probe = useCallback(async () => setOnline(await pingTimetableService()), []);
  useEffect(() => { void probe(); }, [probe]);

  const run = async (file: File) => {
    setBusy(true);
    setErr(null);
    setApplied(false);
    try {
      setResult(await importPdfToSchedule(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const errors = result?.issues.filter((i) => i.level === 'error') ?? [];
  const warns = result?.issues.filter((i) => i.level === 'warn') ?? [];
  const canWrite = result != null && errors.length === 0;

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8">
      <div className="page-shell mx-auto max-w-2xl">
        <div className="panel rounded-2xl border border-ink/[0.07] bg-white px-6 py-8 sm:px-10">
          <p className="section-label">FIRST SETUP · 课表</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">导入你的课表</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-ink-soft">
            传一份教务系统导出的 PDF 课表，梨宝就能围着你的真实上课时间安排三餐、
            自习和运动。也可以先跳过 —— 之后随时在「课表」页补导。
          </p>

          {online === null && (
            <p className="mt-8 text-sm text-ink-faint">正在探测课表解析服务…</p>
          )}

          {online === false && (
            <div className="mt-8 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm leading-6 text-ink-soft">
              <strong className="text-warn-text">课表解析服务没连上。</strong>
              解析随后端一起提供（先启动后端即可：{' '}
              <code className="rounded bg-paper px-1.5 py-0.5 text-ink-soft">python server/app.py</code>
              ）；先跳过也不影响继续设置，之后在服务连上时随时回「课表」页导入。
            </div>
          )}

          {online && (
            <div className="mt-8">
              <label
                className={`button-secondary inline-block px-4 py-2 text-[13px] ${
                  busy ? 'pointer-events-none opacity-40' : 'cursor-pointer'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon
                    name={busy ? 'rotate' : 'upload'}
                    size="sm"
                    className={busy ? 'animate-spin [animation-duration:1.2s]' : ''}
                  />
                  {busy ? '解析中…' : '上传 PDF 课表'}
                </span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void run(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="mt-3 text-xs leading-5 text-ink-faint">
                从教务系统导出课表 PDF（文件名形如「姓名(2026-2027-1)课表.pdf」，学期信息自动识别）。
                {existingCourseCount > 0 && (
                  <strong className="text-ink-soft">
                    你已有一份 {existingCourseCount} 门课的课表，重新导入会覆盖它。
                  </strong>
                )}
              </p>
            </div>
          )}

          {err && (
            <div className="mt-5 rounded-xl border border-danger/25 bg-danger-light px-4 py-3">
              <div className="text-[13.5px] font-semibold text-danger-text">导入失败</div>
              <div className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-soft">{err}</div>
            </div>
          )}

          {result && (
            <div className="mt-5 rounded-xl border border-ink/10 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[14px] font-semibold text-ink">
                  {result.schedule.semesterName || '（未命名学期）'}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    result.term.exact ? 'bg-brand-light text-brand' : 'bg-warn-light text-warn-text'
                  }`}
                >
                  {result.term.exact ? '校历精确' : '估算 · 待核对'}
                </span>
              </div>
              <div className="mt-2 text-[12.5px] leading-6 text-ink-soft">
                第 1 周起于 {result.schedule.termStart || '—— 无法解析 ——'} · 共 {result.schedule.totalWeeks} 周 ·{' '}
                {result.schedule.courses.length} 门课
                {result.schedule.courses.length > 0 && (
                  <span className="text-ink-faint">
                    （{result.schedule.courses.slice(0, 4).map((c) => c.name).join('、')}
                    {result.schedule.courses.length > 4 ? ' 等' : ''}）
                  </span>
                )}
              </div>
              {errors.length + warns.length > 0 && (
                <div className="mt-2 text-[12px] leading-6">
                  {errors.map((i, k) => (
                    <div key={`e${k}`} className="text-danger-text">[error] {i.message}</div>
                  ))}
                  {warns.slice(0, 3).map((i, k) => (
                    <div key={`w${k}`} className="text-warn-text">[warn] {i.message}</div>
                  ))}
                  {warns.length > 3 && <div className="text-ink-faint">… 还有 {warns.length - 3} 条 warn</div>}
                </div>
              )}
              <div className="mt-3">
                <button
                  disabled={!canWrite || applied}
                  onClick={() => { onApply(result.schedule); setApplied(true); }}
                  className="button-primary px-4 py-2 text-[13px] disabled:cursor-not-allowed"
                >
                  {applied ? (
                    <span className="inline-flex items-center gap-1.5">
                      已收下课表
                      <Icon name="check" size="sm" />
                    </span>
                  ) : errors.length > 0 ? (
                    '先修完 error 才能写入'
                  ) : (
                    '使用这份课表'
                  )}
                </button>
                {applied && (
                  <span className="ml-2 text-xs text-ink-faint">想换一份就重传，会覆盖这份。</span>
                )}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button onClick={onBack} className="button-secondary flex-1">返回</button>
            <button onClick={onNext} className="button-secondary flex-1">跳过，先不导</button>
            <button onClick={onNext} className="button-primary flex-1">
              {applied ? (
                <span className="inline-flex items-center gap-1.5">
                  下一步：开始画像
                  <Icon name="check" size="sm" />
                </span>
              ) : (
                '下一步：开始画像'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
