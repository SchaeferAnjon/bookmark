// 新标签页搜索只搜快捷书签（含分组里的每一条）：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchQuickLinks } from '../shared/fuzzy.js';

const QUICK = [
  { title: 'Quick Mail', url: 'https://mail.example/' },
  { type: 'group', name: '学校', items: [
    { title: 'Moodle', url: 'https://moodle.example/' },
    { title: 'Uni Portal', url: 'https://portal.uni.example/' },
  ] },
  { type: 'group', name: 'hiwi2', items: [
    { title: 'Jira', url: 'https://jira.example/' },
    { title: 'Slack', url: 'https://slack.example/' },
  ] },
];
const titles = (rs) => rs.map((r) => r.title);

test('分组里的书签能搜到，结果带上所在分组', () => {
  const rs = searchQuickLinks('moodle', QUICK);
  assert.deepEqual(titles(rs), ['Moodle']);
  assert.equal(rs[0].path, '学校');
  assert.equal(rs[0].url, 'https://moodle.example/');
});

test('顶层快捷书签能搜到，没有分组名', () => {
  const rs = searchQuickLinks('mail', QUICK);
  assert.deepEqual(titles(rs), ['Quick Mail']);
  assert.equal(rs[0].path, '');
});

test('按分组名搜，出分组里的每一条', () => {
  assert.deepEqual(titles(searchQuickLinks('hiwi2', QUICK)).sort(), ['Jira', 'Slack']);
});

test('快捷书签以外的东西搜不到；空查询、空列表不出结果', () => {
  assert.deepEqual(searchQuickLinks('archive', QUICK), []);
  assert.deepEqual(searchQuickLinks('  ', QUICK), []);
  assert.deepEqual(searchQuickLinks('mail', []), []);
  assert.deepEqual(searchQuickLinks('mail', null), []);
});

test('同一个网址既在顶层又在分组里，只出一条', () => {
  const dup = [{ title: 'Jira', url: 'https://jira.example/' }, QUICK[2]];
  assert.equal(searchQuickLinks('jira', dup).length, 1);
});
