/**
 * 技能运行时状态回归(`lib/skillRuntime.ts`,纯模块级状态,不需要浏览器 stub)。
 *
 * 契约:已载入记录按**内容指纹**判断 —— 同一版本第二次返回 true(调用方据此只回
 * "already loaded",不再注入正文);正文变化后返回 false 并更新指纹(旧指令已过时,
 * 必须重新注入当前版本);记录按会话隔离。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLoadedSkills, markSkillLoaded } from '../lib/skillRuntime';

test('已载入记录:同一版本第二次为 true,正文变化后为 false', () => {
  clearLoadedSkills('sess-rt');
  assert.equal(markSkillLoaded('sess-rt', 'demo', 'BODY-1'), false, '首次载入:此前没见过');
  assert.equal(markSkillLoaded('sess-rt', 'demo', 'BODY-1'), true, '同一版本:已载入过');
  assert.equal(markSkillLoaded('sess-rt', 'demo', 'BODY-2'), false, '正文变了:必须重新注入');
  assert.equal(markSkillLoaded('sess-rt', 'another', 'BODY-1'), false, '不同技能各自记账');
});

test('已载入记录:按会话隔离,清空后重新计', () => {
  clearLoadedSkills('sess-a');
  clearLoadedSkills('sess-b');
  markSkillLoaded('sess-a', 'demo', 'BODY');
  assert.equal(markSkillLoaded('sess-b', 'demo', 'BODY'), false, '别的会话不算已载入');
  clearLoadedSkills('sess-a');
  assert.equal(markSkillLoaded('sess-a', 'demo', 'BODY'), false, '清掉之后重新计');
});
