import { mondayOfWeekNo, weekDates } from '@/lib/date';

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

interface Props {
  /** 本周 7 天的 ISO（周一 → 周日）。 */
  days: string[];
  /** 高亮哪一天（1=周一 … 7=周日）。 */
  selectedDow: number;
  /** 今天（1–7）；不在本周时为 null —— 那就不描红。 */
  todayDow: number | null;
  onSelect: (dow: number) => void;
}

/**
 * 顶部横向日期条（设计总成 §11.8 ②）
 * ============================================================
 * 规范对移动端的原文：**「顶部日期条可横向滑动替代周网格」**，并且
 * 「不做横向滚动的内容区（除日期条这一处明确例外）」—— 所以这里是全站唯一
 * 允许横滑的地方（`overflow-x-auto` + `no-scrollbar`）。
 *
 * 2026-10-08（页面模板批）：今天 / 本周两个页签合并为一个「日程」屏 —— 日期条承担
 * 「换一天看」的职责，周网格（WeekBoard）按 §11.8 退出移动端。今天用上理红描边
 * （身份色配额位③），选中用品牌靛蓝实底，两者可同时出现（选中今天）。
 *
 * 2026-10-08 二改（CY 指令）：**删掉「回到今天」按钮** —— 视图总共就一周 7 天，
 * 点日期条上"今天"那一格即可返回，固定按钮既占宽度又有实测 bug；今天的格子上
 * 仍保留上理红描边（身份锚点没丢）。
 *
 * 命中区：每格 min-h-[44px]（§11.8 硬约束①）。
 */
export default function DayStrip({ days, selectedDow, todayDow, onSelect }: Props) {
  return (
    <div className="flex items-center gap-2 pb-1">
      {/* 日期条：唯一允许横滑的区域 */}
      <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1" data-testid="m-day-strip" role="list">
        {days.map((iso, i) => {
          const dow = i + 1;
          const selected = dow === selectedDow;
          const isToday = dow === todayDow;
          const dayNum = Number(iso.slice(8, 10));
          return (
            <button
              key={iso}
              type="button"
              role="listitem"
              data-testid="m-day-chip"
              data-dow={dow}
              aria-pressed={selected}
              aria-label={`周${DAY_LABELS[i]} ${dayNum} 日，${selected ? '当前查看' : '切换到这一天'}`}
              onClick={() => onSelect(dow)}
              className={[
                'flex min-h-[44px] w-[52px] shrink-0 flex-col items-center justify-center rounded-xl border transition-colors duration-fast',
                selected
                  ? 'border-brand bg-brand text-white'
                  : isToday
                    ? 'border-school-red bg-school-light text-school-red'
                    : 'border-ink/10 bg-paper-card text-ink-soft',
              ].join(' ')}
            >
              <span className="text-[10.5px] font-medium leading-tight">周{DAY_LABELS[i]}</span>
              <span className="font-mono text-[14px] font-semibold leading-tight tabular-nums">{dayNum}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 某一教学周的 7 天（周一 → 周日）：由宿主给的 termStart + weekNo 折算，本函数只做日期步进。 */
export function weekDaysOf(termStart: string, weekNo: number): string[] {
  return weekDates(mondayOfWeekNo(termStart, weekNo));
}
