/**
 * 基础信息与身份单一来源（M1）—— tests/identity.test.ts
 * node --test 直跑；localStorage 用内存桩（Node 无 DOM）。
 * 反向验证：破坏 applyObjectiveFact 的字段映射（见 objective-mapping 用例的注释），
 * 映射错了「确认客观事实」就写不进对应字段 —— 用例会红。
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyObjectiveFact,
  basicInfoContext,
  getUserId,
  loadBasicInfo,
  objectiveKeyToField,
  saveBasicInfo,
} from '@/lib/identity';

/** 内存版 localStorage（Node --test 环境没有 DOM storage） */
function installStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).localStorage = stub;
  (globalThis as Record<string, unknown>).sessionStorage = stub;
  return store;
}

beforeEach(() => {
  installStorageStub();
});

test('getUserId 生成并持久复用同一设备标识', () => {
  const a = getUserId();
  assert.ok(a.startsWith('u-'), '设备标识应带 u- 前缀');
  assert.equal(getUserId(), a, '同一次安装必须复用同一 id（跨会话记忆的前提）');
});

test('getUserId 在 localStorage 不可用时降级为 anon 而不抛错', () => {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => { throw new Error('隐私模式'); },
    setItem: () => { throw new Error('隐私模式'); },
  };
  assert.equal(getUserId(), 'anon');
});

test('基础信息保存与读取闭环；非法形状被丢弃', () => {
  saveBasicInfo({ grade: '大二', nickname: '阿 C' });
  assert.deepEqual(loadBasicInfo(), { grade: '大二', nickname: '阿 C' });

  // 脏数据：数字/空串一律不认
  const dirty = installStorageStub();
  dirty.set('usst.libao.basic_info', JSON.stringify({ grade: 42, major: '' }));
  assert.deepEqual(loadBasicInfo(), {}, '非字符串字段必须被丢弃');

  // 坏 JSON 不炸
  const store = installStorageStub();
  store.set('usst.libao.basic_info', '{not-json');
  assert.deepEqual(loadBasicInfo(), {});
});

test('objectiveKeyToField 只认三个身份字段', () => {
  assert.equal(objectiveKeyToField('grade'), 'grade');
  assert.equal(objectiveKeyToField('college'), 'college');
  assert.equal(objectiveKeyToField('major'), 'major');
  // 偏好类不是客观事实 —— 这里返回 null 是「建议卡只写基础信息」的闸门
  assert.equal(objectiveKeyToField('preferences.忌口'), null);
  assert.equal(objectiveKeyToField('weak.高数'), null);
  assert.equal(objectiveKeyToField('course.C语言'), null);
});

test('applyObjectiveFact 只覆盖对应单字段（用户确认才落地）', () => {
  saveBasicInfo({ nickname: '阿 C', grade: '大一' });
  const next = applyObjectiveFact('grade', '大二');
  assert.equal(next.grade, '大二');
  assert.equal(next.nickname, '阿 C', '确认一条事实不能碰别的字段');
  assert.deepEqual(loadBasicInfo(), { nickname: '阿 C', grade: '大二' });
});

test('basicInfoContext 拼出档案段落；空信息返回空串', () => {
  assert.equal(basicInfoContext(), '');
  saveBasicInfo({ nickname: '阿 C', grade: '大二', college: '光电学院' });
  const ctx = basicInfoContext();
  assert.ok(ctx.startsWith('[用户基础信息]'));
  assert.ok(ctx.includes('称呼：阿 C'));
  assert.ok(ctx.includes('年级：大二'));
  assert.ok(ctx.includes('学院：光电学院'));
  assert.ok(!ctx.includes('专业'), '没填的字段不该出现占位');
});

/* ---------------- 闸门测试（对应后端反向验证的前端半边） ----------------
 * 若 objectiveKeyToField 的映射被写坏成「什么都认」（变异体），
 * 偏好类 key 也会写进基础信息 —— 下面这条闸门用例就会红。
 * 与后端 test_memory_facts.py --reverse（关分流 → 用例变红）互为两面。 */
test('闸门：偏好类 key 绝不能写进基础信息', () => {
  saveBasicInfo({ grade: '大一' });
  applyObjectiveFact('preferences.忌口', '香菜');
  applyObjectiveFact('weak.高数', '高数');
  applyObjectiveFact('course.C语言', 'C语言');
  assert.deepEqual(loadBasicInfo(), { grade: '大一' },
    '偏好/薄弱/课程不是客观事实，确认动作不得触碰基础信息');
});
