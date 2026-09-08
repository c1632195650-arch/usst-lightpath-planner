import type { PersonaItem } from '@/types';

/**
 * 35 题画像题库（源自 persona-items.json，版本 2026.09.01）
 * A 性格内核(12) + B 价值动机(5) + C 认知决策(5) + D 行为倾向(5) + E 校园场景(8)
 */
export const PERSONA_VERSION = '2026.09.01';

export const SECTION_META: Record<string, { name: string; hint: string }> = {
  A: { name: '🧬 性格内核', hint: '看看你平时的样子' },
  B: { name: '💎 价值与动机', hint: '什么对你更重要' },
  C: { name: '🧠 认知与决策', hint: '你怎么做决定' },
  D: { name: '⚡ 行为倾向', hint: '机会来了你怎么反应' },
  E: { name: '🏫 校园场景', hint: '直接告诉我们你的习惯' },
};

export const PERSONA_ITEMS: PersonaItem[] = [
  // ---- A 性格内核 ----
  { id: 'A01', order: 1, section: 'A', type: 'L5', text: '在陌生场合我也能很快和人聊起来', reverse: false, trait: 'E' },
  { id: 'A02', order: 2, section: 'A', type: 'L5', text: '周末一个人待一整天对我来说是充电，不是消耗', reverse: true, trait: 'E' },
  { id: 'A03', order: 3, section: 'A', type: 'L5', text: '小组讨论时我通常是发言比较多的那个', reverse: false, trait: 'E', consistency_with: 'A01' },
  { id: 'A04', order: 4, section: 'A', type: 'L5', text: '有截止日期的事我会提前几天开始做', reverse: false, trait: 'C' },
  { id: 'A05', order: 5, section: 'A', type: 'L5', text: '我的桌面或文件夹经常是乱的', reverse: true, trait: 'C' },
  { id: 'A06', order: 6, section: 'A', type: 'L5', text: '答应别人的事我基本都会做到', reverse: false, trait: 'C' },
  { id: 'A07', order: 7, section: 'A', type: 'L5', text: '事情一多我就容易焦虑到影响睡眠', reverse: true, trait: 'ES' },
  { id: 'A08', order: 8, section: 'A', type: 'L5', text: '我的情绪起伏比较小', reverse: false, trait: 'ES' },
  { id: 'A09', order: 9, section: 'A', type: 'L5', text: '被批评之后我会反复想很久', reverse: true, trait: 'ES' },
  { id: 'A10', order: 10, section: 'A', type: 'L5', text: '我愿意为了「没吃过的窗口」多走十分钟', reverse: false, trait: 'O' },
  { id: 'A11', order: 11, section: 'A', type: 'L5', text: '有熟悉的流程时，我还是会想试试新方法', reverse: false, trait: 'O' },
  { id: 'A12', order: 12, section: 'A', type: 'L5', text: '朋友找我帮忙时我很难说「不」', reverse: false, trait: 'A' },

  // ---- B 价值与动机 ----
  { id: 'B01', order: 13, section: 'B', type: 'L5', text: '小A：成绩和履历是ta最在意的事，选课、竞赛、实习都围着这个转。这个人像你吗？', motif: 'ACH' },
  { id: 'B02', order: 14, section: 'B', type: 'L5', text: '小B：大学最重要的是认识有意思的人，能去的活动都去。这个人像你吗？', motif: 'SOC' },
  { id: 'B03', order: 15, section: 'B', type: 'L5', text: '小C：把身体和作息管好是第一位的，别的可以往后排。这个人像你吗？', motif: 'HEA' },
  { id: 'B04', order: 16, section: 'B', type: 'L5', text: '小D：什么都想试一试，新鲜感最重要。这个人像你吗？', motif: 'EXP' },
  {
    id: 'B05', order: 17, section: 'B', type: 'SORT',
    text: '把下面 5 张卡片按对你的重要程度排序（最重要放最上面）',
    options: [
      { key: 'ACH', text: '绩点与履历' },
      { key: 'SOC', text: '朋友与圈子' },
      { key: 'HEA', text: '身体与作息' },
      { key: 'EXP', text: '新鲜体验' },
      { key: 'STA', text: '少折腾、稳一点' },
    ],
  },

  // ---- C 认知与决策 ----
  {
    id: 'C01', order: 18, section: 'C', type: 'FC', text: '做一个决定的时候',
    options: [
      { key: 'A', text: '我更信数据和对比', value: 100 },
      { key: 'B', text: '我更信第一感觉', value: 0 },
    ], var: 'rationality',
  },
  { id: 'C02', order: 19, section: 'C', type: 'L5', text: '看到一篇很长的选课或考研攻略，我会认真读完', var: 'nfc' },
  { id: 'C03', order: 20, section: 'C', type: 'L5', text: '计划临时被打乱，我会明显不舒服', var: 'nfcc' },
  { id: 'C04', order: 21, section: 'C', type: 'L5', text: '买稍微贵一点的东西，我总要货比三家才下手', var: 'maximizing' },
  {
    id: 'C05', order: 22, section: 'C', type: 'MC', text: '遇到一个不懂的问题，我的第一反应是',
    options: [
      { key: 'A', text: '自己搜攻略', output: 'search_self' },
      { key: 'B', text: '问身边的朋友', output: 'ask_friend' },
      { key: 'C', text: '先自己试试', output: 'try_self' },
      { key: 'D', text: '先放一放', output: 'defer' },
    ], output_field: 'help_path',
  },

  // ---- D 行为倾向 ----
  {
    id: 'D01', order: 23, section: 'D', type: 'FC', text: '看到一个机会（比赛 / 活动 / 兼职），我第一反应是',
    options: [
      { key: 'A', text: '兴奋，想报名', value: 100 },
      { key: 'B', text: '先想风险大不大', value: 0 },
    ], var: 'approach',
  },
  { id: 'D02', order: 24, section: 'D', type: 'L5', text: '我愿意为了长远的目标，放弃现在的享乐', var: 'cfc' },
  {
    id: 'D03', order: 25, section: 'D', type: 'FC', text: '选课的时候我会',
    options: [
      { key: 'A', text: '选给分高但没那么感兴趣的', value: 0 },
      { key: 'B', text: '选难但真想学的', value: 100 },
    ], var: 'risk_study',
  },
  { id: 'D04', order: 26, section: 'D', type: 'L5', text: '在群里发言、或者张罗一次活动，对我来说没什么心理负担', var: 'risk_social' },
  { id: 'D05', order: 27, section: 'D', type: 'L5', text: '我通常是晚上效率更高', var: 'nightness' },

  // ---- E 校园场景 ----
  {
    id: 'E01', order: 28, section: 'E', type: 'FC', text: '中午只有 40 分钟，你会',
    options: [
      { key: 'A', text: '就近快吃回宿舍', output: 'near' },
      { key: 'B', text: '走去远一点那家想吃的', output: 'far' },
    ], output_field: 'meal_radius',
  },
  {
    id: 'E02', order: 29, section: 'E', type: 'FC', text: '周末空出一整天',
    options: [
      { key: 'A', text: '提前排满计划', output: 'planned' },
      { key: 'B', text: '睡到自然醒再说', output: 'flexible' },
    ], output_field: 'planning',
  },
  {
    id: 'E03', order: 30, section: 'E', type: 'FC', text: '学校发了活动通知',
    options: [
      { key: 'A', text: '只看跟学分专业相关的', output: 'narrow' },
      { key: 'B', text: '什么都点开看看', output: 'broad' },
    ], output_field: 'event_breadth',
  },
  {
    id: 'E04', order: 31, section: 'E', type: 'FC', text: '想找人一起吃饭',
    options: [
      { key: 'A', text: '群里喊一声', output: 'wide' },
      { key: 'B', text: '私聊固定的一两个', output: 'close' },
    ], output_field: 'social_radius',
  },
  {
    id: 'E05', order: 32, section: 'E', type: 'MC', text: '学到很晚饿了',
    options: [
      { key: 'A', text: '点外卖', output: 'delivery' },
      { key: 'B', text: '便利店速食', output: 'convenience' },
      { key: 'C', text: '忍着', output: 'none' },
    ], output_field: 'night_supply',
  },
  {
    id: 'E06', order: 33, section: 'E', type: 'FC', text: '关于运动',
    options: [
      { key: 'A', text: '有人约才去', output: 'with_others' },
      { key: 'B', text: '自己按计划去', output: 'self_plan' },
    ], output_field: 'exercise_trigger',
  },
  {
    id: 'E07', order: 34, section: 'E', type: 'MC', text: '平时自习去哪',
    options: [
      { key: 'A', text: '图书馆', output: 'library' },
      { key: 'B', text: '教学楼空教室', output: 'classroom' },
      { key: 'C', text: '宿舍', output: 'dorm' },
      { key: 'D', text: '咖啡馆', output: 'cafe' },
    ], output_field: 'study_place',
  },
  {
    id: 'E08', order: 35, section: 'E', type: 'MC', text: '校园信息的第一入口',
    options: [
      { key: 'A', text: '班级群通知', output: 'group_chat' },
      { key: 'B', text: '公众号', output: 'wechat_mp' },
      { key: 'C', text: '同学口口相传', output: 'word_of_mouth' },
      { key: 'D', text: '自己搜', output: 'self_search' },
    ], output_field: 'info_channel',
  },
];
