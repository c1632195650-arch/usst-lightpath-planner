import type { Campus, CampusId } from '@/types';
import { CAMPUS_TRANSFER_MIN } from '@/types';

/**
 * 上理工五校区
 * 数据来源：校区分布依据后勤处《节假日后勤服务开放安排》、
 * 保卫处《校内建筑消防电气检测楼宇清单》、研究生院选课通知。
 */
export const CAMPUSES: Record<CampusId, Campus> = {
  JG516: {
    id: 'JG516',
    name: '军工路 516 号',
    short: '516',
    address: '上海市杨浦区军工路 516 号',
  },
  JG334: {
    id: 'JG334',
    name: '军工路 334 号',
    short: '334',
    address: '上海市杨浦区军工路 334 号',
  },
  JG1100: {
    id: 'JG1100',
    name: '军工路 1100 号',
    short: '1100',
    address: '上海市杨浦区军工路 1100 号',
  },
  FUXING: {
    id: 'FUXING',
    name: '复兴路校区',
    short: '复兴路',
    address: '上海市徐汇区复兴中路 1195 号',
  },
  YINGKOU: {
    id: 'YINGKOU',
    name: '营口路校区',
    short: '营口路',
    address: '上海市杨浦区营口路',
  },
  UNKNOWN: { id: 'UNKNOWN', name: '未知校区', short: '?', address: '' },
};

/**
 * 教学楼 → 校区 映射表
 * 用途：从教务系统里的上课地点字符串（如「第一教学楼301」）反推校区。
 * ⚠️ 这张表是 guesses，宁可猜不准也不要给用户错误确定性 —— 见 guessCampus 返回 UNKNOWN 的策略。
 */
export const BUILDING_CAMPUS_MAP: Array<{ keyword: string; campus: CampusId }> = [
  // 军工路 516 号
  { keyword: '第一教学楼', campus: 'JG516' },
  { keyword: '第三教学楼', campus: 'JG516' },
  { keyword: '第五教学楼', campus: 'JG516' },
  { keyword: '综合楼', campus: 'JG516' },
  { keyword: '仪表', campus: 'JG516' },
  { keyword: '动力', campus: 'JG516' },
  // 军工路 334 号
  { keyword: '卓越楼', campus: 'JG334' },
  { keyword: '国合楼', campus: 'JG334' },
  { keyword: '第四教学楼', campus: 'JG334' },
  { keyword: '理科实验中心', campus: 'JG334' },
  // 军工路 1100 号
  { keyword: '申一教', campus: 'JG1100' },
  { keyword: '申二教', campus: 'JG1100' },
  { keyword: '申图教', campus: 'JG1100' },
  { keyword: '阶梯教室', campus: 'JG1100' },
  // 复兴路
  { keyword: '复兴', campus: 'FUXING' },
  // 营口路
  { keyword: '营口', campus: 'YINGKOU' },
];

/**
 * 从上课地点字符串推断校区。
 * 识别不了就返回 UNKNOWN —— 让上层去问用户，而不是瞎猜。
 */
export function guessCampus(rawLocation: string): CampusId {
  if (!rawLocation) return 'UNKNOWN';
  const loc = rawLocation.trim();
  for (const item of BUILDING_CAMPUS_MAP) {
    if (loc.includes(item.keyword)) return item.campus;
  }
  return 'UNKNOWN';
}

/** 取两个校区之间的转场分钟数 */
export function transferMinutes(from: CampusId, to: CampusId): number {
  return CAMPUS_TRANSFER_MIN[from]?.[to] ?? 20;
}
