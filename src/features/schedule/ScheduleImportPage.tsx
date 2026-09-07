import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { CAMPUSES } from '@/constants/campus';
import { DEMO_SCHEDULE } from '@/mocks/demo';
import type { Course } from '@/types';

/**
 * 课表导入（演示版）
 * 真实版：pdfjs-dist 前端解析教务导出的 PDF → Course[]。
 * 这里点击即载入演示课表，展示解析后的周课表网格。
 */

const ROWS = [
  { label: '1–2 节', min: 1, max: 2 },
  { label: '3–4 节', min: 3, max: 4 },
  { label: '5–6 节', min: 5, max: 6 },
  { label: '7–8 节', min: 7, max: 99 },
];

function coursesAt(day: number, min: number, max: number): Course[] {
  return DEMO_SCHEDULE.courses.filter((c) =>
    c.slots.some((s) => s.dayOfWeek === day && s.startPeriod >= min && s.startPeriod <= max),
  );
}

export default function ScheduleImportPage() {
  const [loaded, setLoaded] = useState(false);
  const cross = DEMO_SCHEDULE.courses.filter((c) => c.campus !== 'JG516').length;

  if (!loaded) {
    return (
      <div className="px-4">
        <span className="section-label">课表导入</span>
        <button
          type="button"
          onClick={() => setLoaded(true)}
          className="mt-4 w-full rounded-2xl border-2 border-dashed border-paper-line bg-paper-card
                     py-12 px-6 flex flex-col items-center gap-3 hover:border-brand/40 transition-colors"
        >
          <div className="text-[32px]">📄</div>
          <div className="text-[15px] font-semibold text-ink">拖入教务导出的 PDF 课表</div>
          <div className="text-[12.5px] text-ink-faint text-center leading-relaxed">
            解析完全在本地浏览器完成，不上传、不碰账号密码<br />
            <span className="text-brand font-medium">（演示版：点击即载入示例课表）</span>
          </div>
        </button>
        <p className="mt-3 text-center text-[12px] text-ink-faint">
          支持 PDF / 粘贴文本 / 手动录入，解析失败会自动退回手动录入
        </p>
      </div>
    );
  }

  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-3">
        <span className="section-label">课表导入</span>
        <button onClick={() => setLoaded(false)} className="text-[12.5px] text-ink-faint underline">
          重新导入
        </button>
      </div>

      <Card
        title={DEMO_SCHEDULE.semesterName}
        subtitle={`共 ${DEMO_SCHEDULE.courses.length} 门课 · ${cross} 门跨校区 · 已解析成功`}
      >
        {/* 周课表网格 */}
        <div className="overflow-x-auto no-scrollbar -mx-1">
          <table className="w-full border-collapse text-[12px] min-w-[460px]">
            <thead>
              <tr>
                <th className="w-14 py-1.5 text-left text-ink-faint font-medium" />
                {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d) => (
                  <th key={d} className="py-1.5 text-center text-ink-faint font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <td className="py-1 pr-1 text-[11px] text-ink-faint align-top">{row.label}</td>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                    const list = coursesAt(day, row.min, row.max);
                    return (
                      <td key={day} className="p-0.5 align-top">
                        {list.map((c) => {
                          const crossCampus = c.campus !== 'JG516';
                          return (
                            <div
                              key={c.id}
                              className={`mb-0.5 rounded-md px-1.5 py-1 leading-tight ${
                                crossCampus ? 'bg-accent-light text-accent' : 'bg-brand-light text-brand-dark'
                              }`}
                            >
                              <div className="font-semibold truncate">{c.name}</div>
                              {c.building && (
                                <div className="text-[10.5px] opacity-80 truncate">
                                  {c.building}{c.room}
                                  {crossCampus && <span> · {CAMPUSES[c.campus].short}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-ink-faint">
          蓝色 = 跨校区课程（系统已自动识别，将在排程中预留转场时间）
        </p>
      </Card>

      <Card className="mt-4" title="本表识别到的跨校区" subtitle="排程时自动插入转场缓冲">
        {DEMO_SCHEDULE.courses.filter((c) => c.campus !== 'JG516').map((c) => (
          <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-paper-line last:border-0 text-[13px]">
            <span className="text-ink">{c.name}</span>
            <span className="text-accent font-medium">{CAMPUSES[c.campus].name}</span>
          </div>
        ))}
        {cross === 0 && <p className="text-[12.5px] text-ink-faint">本表无跨校区课程</p>}
      </Card>
    </div>
  );
}
