import { EmptyState } from '@/components/ui/EmptyState';
import type { Schedule } from '@/types';

/**
 * 【人 B 负责】课表导入与解析
 *
 * ── 输入 ──   教务系统粘贴文本 / CSV 文件 / 手动录入
 * ── 输出 ──   Schedule 对象 → patch({ schedule })
 *
 * ── 要做的事（见 docs/features.md M2）──
 *   1. 粘贴框：解析教务系统复制出来的表格文本
 *   2. CSV 导入
 *   3. 手动录入格子（兜底，必须有）
 *   4. 上课地点 → 校区推断（用 @/constants/campus 的 guessCampus）
 *
 * ── 硬性约束 ──
 *   · ⚠️ 绝不接触教务账号密码。不写登录、不写爬虫、不放后端。
 *     数据一律由用户在自己浏览器里导入，本地解析。
 *   · 教务系统 2026-08 刚升级，格式可能变。D3 前务必取到真实样本。
 *   · 解析失败要给友好提示，并且**必须能退回手动录入**。
 *     这条比解析器本身重要 —— 卡在这里超过 1.5 天就先做手动录入。
 *   · 周次要能处理 [1-16]、[1,3,5]、单双周。
 */
interface Props {
  schedule: Schedule | null;
  onSave: (s: Schedule) => void;
}

export default function ScheduleImportPage({ schedule, onSave }: Props) {
  if (schedule) {
    return (
      <div className="px-4">
        <EmptyState
          icon="📅"
          title="课表已导入"
          description={`${schedule.semesterName} · 共 ${schedule.courses.length} 门课`}
        />
      </div>
    );
  }

  return (
    <div className="px-4">
      <EmptyState
        icon="📥"
        title="TODO：课表三通道导入"
        description="人 B 负责。契约见本文件顶部注释。⚠️ 严禁涉及教务密码。"
      />
      <div className="mt-4 text-center">
        <button
          className="text-[13px] text-ink-faint underline"
          onClick={() =>
            onSave({
              semesterName: '2026–2027 学年 第一学期',
              semesterType: 'autumn',
              termStart: '2026-09-14',
              totalWeeks: 18,
              courses: [],
              source: 'demo',
            })
          }
        >
          （占位）填入一份空课表壳
        </button>
      </div>
    </div>
  );
}
