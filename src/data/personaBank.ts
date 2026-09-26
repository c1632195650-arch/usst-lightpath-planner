import type { PersonaItem } from '@/types';

/**
 * 35 题画像题库（源自 persona-items.json，版本 2026.09.01）
 * A 性格内核(12) + B 价值动机(5) + C 认知决策(5) + D 行为倾向(5) + E 校园场景(8)
 *
 * v2 方案 WP2（2026-09-27）：
 *  · 每题可带 grades（缺省 = 全年级适用）与 sceneTag（上理场景溯源标记）；
 *  · 题面逐条上理场景化改写 —— 只动 text 文案，dim/reverse/trait/var/motif/
 *    options 的 key 与 value 等计分逻辑一个字符都没动（tests 机械比对保证）；
 *  · 出卷序列 = buildPersonaSequence(grade)：缺省题 + 适配年级的题按 order 排列，
 *    A03 一致性题锚定固定序位恒插入。
 *  · 分层口径（2026-09-27 夜班按轴覆盖数学核定，待 CY 复核）：
 *      「分层后总题数 8~14」按【带 grades 标签的分层题总数】实现（10 题 ∈ 8~14）；
 *      若按「每份卷总题数 8~14」口径，8 轴中多数轴会塌到兜底值 50（buildProfile
 *      名义可用、实际失真），且与「dim 与计分逻辑一个字符都不许动」冲突 —— 故取保守口径。
 *      分层题（10）：B01[2,3,4] C01[3,4] C02[2,3,4] C05[1,2] D01[1,2] D02[3,4]
 *                    D03[1,2,3] E03[1,2] E08[1,2] A12[1,2]
 *      每份卷 = 全库 35 题 − 不适年级的分层题（大一 31 / 大二 33 / 大三 30 / 大四 29 题）。
 */
export const PERSONA_VERSION = '2026.09.27';

/** 年级（与 identity.ts 的 Grade 同域，本地声明避免反向依赖） */
export type PersonaGrade = 1 | 2 | 3 | 4;

/** WP2 扩展字段：grades = 适用年级（缺省全年级）；sceneTag = 上理场景溯源 */
export interface TieredPersonaItem extends PersonaItem {
  grades?: readonly PersonaGrade[];
  sceneTag?: string;
}

export const SECTION_META: Record<string, { name: string; hint: string }> = {
  A: { name: '🧬 性格内核', hint: '看看你平时的样子' },
  B: { name: '💎 价值与动机', hint: '什么对你更重要' },
  C: { name: '🧠 认知与决策', hint: '你怎么做决定' },
  D: { name: '⚡ 行为倾向', hint: '机会来了你怎么反应' },
  E: { name: '🏫 校园场景', hint: '直接告诉我们你的习惯' },
};

export const PERSONA_ITEMS: TieredPersonaItem[] = [
  // ---- A 性格内核（全部全年级；分层题：A12 大一大二） ----
  { id: 'A01', order: 1, section: 'A', type: 'L5', text: '社团招新摆摊前，我也能很快和陌生同学聊起来', reverse: false, trait: 'E', sceneTag: '社团招新' },
  { id: 'A02', order: 2, section: 'A', type: 'L5', text: '周末不去军工路商圈凑热闹，一个人待一整天对我来说是充电，不是消耗', reverse: true, trait: 'E', sceneTag: '军工路' },
  { id: 'A03', order: 3, section: 'A', type: 'L5', text: '小组讨论（比如光电杯备赛讨论）时我通常是发言比较多的那个', reverse: false, trait: 'E', consistency_with: 'A01', sceneTag: '光电杯' },
  { id: 'A04', order: 4, section: 'A', type: 'L5', text: '面对实验报告或毕设的截止日期，我会提前几天开始做', reverse: false, trait: 'C', sceneTag: '毕设' },
  { id: 'A05', order: 5, section: 'A', type: 'L5', text: '我宿舍桌面和电脑里的课程文件夹经常是乱的', reverse: true, trait: 'C', sceneTag: '宿舍' },
  { id: 'A06', order: 6, section: 'A', type: 'L5', text: '答应帮同学在食堂带饭、图书馆占座这种事，我基本都会做到', reverse: false, trait: 'C', sceneTag: '食堂' },
  { id: 'A07', order: 7, section: 'A', type: 'L5', text: '期中周事情一多，我容易焦虑到在宿舍翻来覆去睡不着', reverse: true, trait: 'ES', sceneTag: '宿舍' },
  { id: 'A08', order: 8, section: 'A', type: 'L5', text: '就算早八迟到被点名，我的情绪起伏也比较小', reverse: false, trait: 'ES', sceneTag: '早八' },
  { id: 'A09', order: 9, section: 'A', type: 'L5', text: '课设被老师当面指出问题之后，我会反复想很久', reverse: true, trait: 'ES', sceneTag: '课设' },
  { id: 'A10', order: 10, section: 'A', type: 'L5', text: '我愿意为了军工路食堂「没吃过的窗口」多走十分钟', reverse: false, trait: 'O', sceneTag: '军工路食堂' },
  { id: 'A11', order: 11, section: 'A', type: 'L5', text: '就算图书馆的占座流程已经很熟了，我还是会想试试新方法', reverse: false, trait: 'O', sceneTag: '图书馆' },
  { id: 'A12', order: 12, section: 'A', type: 'L5', text: '社团同学找我帮忙时我很难说「不」', reverse: false, trait: 'A', grades: [1, 2], sceneTag: '社团' },

  // ---- B 价值与动机（分层题：B01 大二起；B02-B05 全年级） ----
  { id: 'B01', order: 13, section: 'B', type: 'L5', text: '小A：绩点和履历是ta最在意的事，选课、光电杯、保研实习都围着这个转。这个人像你吗？', motif: 'ACH', grades: [2, 3, 4], sceneTag: '光电杯' },
  { id: 'B02', order: 14, section: 'B', type: 'L5', text: '小B：大学最重要的是认识有意思的人，社团活动能去的都去。这个人像你吗？', motif: 'SOC', sceneTag: '社团' },
  { id: 'B03', order: 15, section: 'B', type: 'L5', text: '小C：把身体和作息管好是第一位的，再忙也要赶上校园跑。这个人像你吗？', motif: 'HEA', sceneTag: '校园跑' },
  { id: 'B04', order: 16, section: 'B', type: 'L5', text: '小D：从光电杯到路演摆摊，什么都想试一试，新鲜感最重要。这个人像你吗？', motif: 'EXP', sceneTag: '光电杯' },
  {
    id: 'B05', order: 17, section: 'B', type: 'SORT',
    text: '选课、社团、竞赛都在抢你的时间：把下面 5 张卡片按对你的重要程度排序（最重要放最上面）',
    options: [
      { key: 'ACH', text: '绩点与履历' },
      { key: 'SOC', text: '朋友与圈子' },
      { key: 'HEA', text: '身体与作息' },
      { key: 'EXP', text: '新鲜体验' },
      { key: 'STA', text: '少折腾、稳一点' },
    ],
    sceneTag: '选课',
  },

  // ---- C 认知与决策（分层题：C01 大三大四 / C02 大二起 / C05 大一大二；C03 C04 全年级） ----
  {
    id: 'C01', order: 18, section: 'C', type: 'FC', text: '秋招 offer 和考研院校二选一的时候',
    grades: [3, 4], sceneTag: '秋招',
    options: [
      { key: 'A', text: '我更信数据和对比', value: 100 },
      { key: 'B', text: '我更信第一感觉', value: 0 },
    ], var: 'rationality',
  },
  { id: 'C02', order: 19, section: 'C', type: 'L5', text: '看到一篇很长的上理选课或考研攻略，我会认真读完', var: 'nfc', grades: [2, 3, 4], sceneTag: '选课' },
  { id: 'C03', order: 20, section: 'C', type: 'L5', text: '计划好的军工路食堂探店临时被打乱，我会明显不舒服', var: 'nfcc', sceneTag: '军工路食堂' },
  { id: 'C04', order: 21, section: 'C', type: 'L5', text: '买稍微贵一点的东西（比如通勤单车），我总要货比三家才下手', var: 'maximizing', sceneTag: '通勤' },
  {
    id: 'C05', order: 22, section: 'C', type: 'MC', text: '高数题卡住或选课系统不会用，我的第一反应是',
    grades: [1, 2], sceneTag: '高数',
    options: [
      { key: 'A', text: '自己搜攻略', output: 'search_self' },
      { key: 'B', text: '问身边的朋友', output: 'ask_friend' },
      { key: 'C', text: '先自己试试', output: 'try_self' },
      { key: 'D', text: '先放一放', output: 'defer' },
    ], output_field: 'help_path',
  },

  // ---- D 行为倾向（分层题：D01 大一大二 / D02 大三大四 / D03 大一大二大三；D04 D05 全年级） ----
  {
    id: 'D01', order: 23, section: 'D', type: 'FC', text: '看到光电杯、大创或者兼职的机会，我第一反应是',
    grades: [1, 2], sceneTag: '光电杯',
    options: [
      { key: 'A', text: '兴奋，想报名', value: 100 },
      { key: 'B', text: '先想风险大不大', value: 0 },
    ], var: 'approach',
  },
  { id: 'D02', order: 24, section: 'D', type: 'L5', text: '我愿意为了保研或秋招这种长远目标，放弃眼下的享乐', var: 'cfc', grades: [3, 4], sceneTag: '保研' },
  {
    id: 'D03', order: 25, section: 'D', type: 'FC', text: '上理选课的时候我会',
    grades: [1, 2, 3], sceneTag: '选课',
    options: [
      { key: 'A', text: '选给分高但没那么感兴趣的', value: 0 },
      { key: 'B', text: '选难但真想学的', value: 100 },
    ], var: 'risk_study',
  },
  { id: 'D04', order: 26, section: 'D', type: 'L5', text: '在班级群发言、或者张罗一次社团活动，对我来说没什么心理负担', var: 'risk_social', sceneTag: '班级群' },
  { id: 'D05', order: 27, section: 'D', type: 'L5', text: '我通常是晚上在图书馆通宵区效率更高', var: 'nightness', sceneTag: '图书馆通宵区' },

  // ---- E 校园场景（分层题：E03 大一大二 / E08 大一大二；其余全年级） ----
  {
    id: 'E01', order: 28, section: 'E', type: 'FC', text: '军工路食堂高峰期，中午只有 40 分钟，你会',
    sceneTag: '军工路食堂',
    options: [
      { key: 'A', text: '就近快吃回宿舍', output: 'near' },
      { key: 'B', text: '走去远一点那家想吃的', output: 'far' },
    ], output_field: 'meal_radius',
  },
  {
    id: 'E02', order: 29, section: 'E', type: 'FC', text: '周末不用在 1100 和本部之间通勤，空出一整天',
    sceneTag: '1100通勤',
    options: [
      { key: 'A', text: '提前排满计划', output: 'planned' },
      { key: 'B', text: '睡到自然醒再说', output: 'flexible' },
    ], output_field: 'planning',
  },
  {
    id: 'E03', order: 30, section: 'E', type: 'FC', text: '上理公众号发了活动通知',
    grades: [1, 2], sceneTag: '上理公众号',
    options: [
      { key: 'A', text: '只看跟学分专业相关的', output: 'narrow' },
      { key: 'B', text: '什么都点开看看', output: 'broad' },
    ], output_field: 'event_breadth',
  },
  {
    id: 'E04', order: 31, section: 'E', type: 'FC', text: '想去军工路食堂探店，想找人一起吃饭',
    sceneTag: '军工路食堂',
    options: [
      { key: 'A', text: '群里喊一声', output: 'wide' },
      { key: 'B', text: '私聊固定的一两个', output: 'close' },
    ], output_field: 'social_radius',
  },
  {
    id: 'E05', order: 32, section: 'E', type: 'MC', text: '在图书馆通宵区学到很晚饿了',
    sceneTag: '图书馆通宵区',
    options: [
      { key: 'A', text: '点外卖', output: 'delivery' },
      { key: 'B', text: '便利店速食', output: 'convenience' },
      { key: 'C', text: '忍着', output: 'none' },
    ], output_field: 'night_supply',
  },
  {
    id: 'E06', order: 33, section: 'E', type: 'FC', text: '关于体育大课和校园跑',
    sceneTag: '体育大课',
    options: [
      { key: 'A', text: '有人约才去', output: 'with_others' },
      { key: 'B', text: '自己按计划去', output: 'self_plan' },
    ], output_field: 'exercise_trigger',
  },
  {
    id: 'E07', order: 34, section: 'E', type: 'MC', text: '不在宿舍摸鱼的话，平时自习去哪',
    sceneTag: '宿舍',
    options: [
      { key: 'A', text: '图书馆', output: 'library' },
      { key: 'B', text: '教学楼空教室', output: 'classroom' },
      { key: 'C', text: '宿舍', output: 'dorm' },
      { key: 'D', text: '咖啡馆', output: 'cafe' },
    ], output_field: 'study_place',
  },
  {
    id: 'E08', order: 35, section: 'E', type: 'MC', text: '上理校园信息（校历、讲座、抢票）的第一入口',
    grades: [1, 2], sceneTag: '校历',
    options: [
      { key: 'A', text: '班级群通知', output: 'group_chat' },
      { key: 'B', text: '公众号', output: 'wechat_mp' },
      { key: 'C', text: '同学口口相传', output: 'word_of_mouth' },
      { key: 'D', text: '自己搜', output: 'self_search' },
    ], output_field: 'info_channel',
  },
];

/**
 * 按年级出卷（v2 方案 WP2）：缺省题 + 适配年级的题，按 order 排列；
 * A03 一致性题锚定固定序位恒插入 —— 即使将来被年级标签误伤也不允许缺席。
 * grade 未知（未填基础信息/跳过引导）→ 全库出卷，行为与分层前一致。
 */
export function buildPersonaSequence(grade?: PersonaGrade): PersonaItem[] {
  const sorted = [...PERSONA_ITEMS].sort((a, b) => a.order - b.order);
  const applicable = sorted.filter(
    (item) => !item.grades || grade === undefined || item.grades.includes(grade),
  );
  if (!applicable.some((item) => item.id === 'A03')) {
    const a03 = sorted.find((item) => item.id === 'A03');
    if (a03) {
      const anchor = applicable.findIndex((item) => item.order > a03.order);
      applicable.splice(anchor < 0 ? applicable.length : anchor, 0, a03);
    }
  }
  return applicable;
}
