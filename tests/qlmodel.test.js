// 快捷书签同步模型的单测：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toList, diffList, mergeRecords, newer, appendRecord, importRecords, missingOnly, hash53, META_MIGRATED,
} from '../shared/qlmodel.js';

let seq = 0;
const ids = () => `n${++seq}`;
const opts = (device, now) => ({ device, now, newId: ids });

// 界面列表 → 一份全新的记录表（模拟第一次保存）
const fromList = (list, device = 'A', now = 100) => diffList(structuredClone(list), [], {}, opts(device, now));

const SAMPLE = [
  { title: '书房', url: 'https://a.example/' },
  { type: 'group', name: 'hiwi', items: [
    { title: 'Jira', url: 'https://jira.example/' },
    { title: 'Slack', url: 'https://slack.example/' },
  ] },
  { title: 'LISTSERV', url: 'https://list.example/' },
];

const strip = (list) => list.map((it) => (it.type === 'group'
  ? { type: 'group', name: it.name, items: it.items.map(({ title, url }) => ({ title, url })) }
  : { title: it.title, url: it.url }));

test('列表 → 记录 → 列表 往返不丢东西、顺序不变', () => {
  const records = fromList(SAMPLE);
  assert.equal(Object.keys(records).length, 5);
  assert.deepEqual(strip(toList(records)), SAMPLE);
});

test('没改动不产生写入；改名只写一条', () => {
  const records = fromList(SAMPLE);
  const list = toList(records);
  assert.deepEqual(diffList(structuredClone(list), list, records, opts('A', 200)), {});

  const renamed = structuredClone(list);
  renamed[0].title = '我的书房';
  const changes = diffList(renamed, list, records, opts('A', 200));
  assert.deepEqual(Object.keys(changes), [list[0].id]);
  assert.equal(changes[list[0].id].title, '我的书房');
  assert.equal(changes[list[0].id].t, 200);
});

test('删除留墓碑，合并后不再显示', () => {
  const records = fromList(SAMPLE);
  const list = toList(records);
  const next = structuredClone(list).filter((it) => it.title !== 'LISTSERV');
  const changes = diffList(next, list, records, opts('A', 200));
  const gone = list[2].id;
  assert.equal(changes[gone].deleted, true);
  const merged = mergeRecords(records, changes);
  assert.equal(toList(merged).length, 2);
  assert.ok(merged[gone], '墓碑仍在记录表里');
});

test('解散分组：分组写墓碑，成员挪到顶层', () => {
  const records = fromList(SAMPLE);
  const list = toList(records);
  const next = structuredClone(list);
  next.splice(1, 1, ...next[1].items);
  const merged = mergeRecords(records, diffList(next, list, records, opts('A', 200)));
  assert.deepEqual(toList(merged).map((it) => it.title), ['书房', 'Jira', 'Slack', 'LISTSERV']);
});

test('父分组被别处删掉时，成员放回顶层而不是消失', () => {
  const records = fromList(SAMPLE);
  const group = Object.values(records).find((r) => r.kind === 'group');
  const merged = mergeRecords(records, { [group.id]: { ...group, deleted: true, t: 300, d: 'B' } });
  const titles = toList(merged).map((it) => it.title);
  assert.ok(titles.includes('Jira') && titles.includes('Slack'));
});

test('两台机器同时改不同书签：两边的改动都保留', () => {
  const base = fromList(SAMPLE);
  const list = toList(base);

  const onA = structuredClone(list);
  onA[0].title = 'A 改的名';
  const fromA = diffList(onA, list, base, opts('A', 500));

  const onB = structuredClone(list).filter((it) => it.title !== 'LISTSERV');
  onB.push({ title: 'B 新加的', url: 'https://b.example/' });
  const fromB = diffList(onB, list, base, opts('B', 510));

  const titles = toList(mergeRecords(base, fromA, fromB)).map((it) => it.title || it.name);
  assert.ok(titles.includes('A 改的名'));
  assert.ok(titles.includes('B 新加的'));
  assert.ok(!titles.includes('LISTSERV'));
});

test('同时改同一个书签：后改的胜；时间相同按写入方排序，结果与合并顺序无关', () => {
  const r = { id: 'x', kind: 'link', title: 'old', url: 'u', parent: '', order: 0 };
  const a = { ...r, title: 'A', t: 10, d: 'A' };
  const b = { ...r, title: 'B', t: 20, d: 'B' };
  assert.equal(mergeRecords({ x: a }, { x: b }).x.title, 'B');
  assert.equal(mergeRecords({ x: b }, { x: a }).x.title, 'B');
  const tieA = { ...a, t: 20 };
  assert.equal(mergeRecords({ x: tieA }, { x: b }).x.title, mergeRecords({ x: b }, { x: tieA }).x.title);
  assert.ok(newer(b, a) && !newer(a, b));
});

test('追加：放到顶层末尾；网址已存在返回 null', () => {
  const records = fromList(SAMPLE);
  assert.equal(appendRecord(records, { title: 'x', url: 'https://jira.example/' }, opts('A', 600)), null);
  const add = appendRecord(records, { title: '新', url: 'https://new.example/' }, opts('A', 600));
  const list = toList(mergeRecords(records, add));
  assert.equal(list.at(-1).title, '新');
});

test('导入是确定性的：两台机器各导一次不会重复', () => {
  const a = importRecords(structuredClone(SAMPLE), { device: 'A' });
  const b = importRecords(structuredClone(SAMPLE), { device: 'B' });
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  assert.equal(toList(mergeRecords(a, b)).length, 3);
});

test('同名分组（比如两个「分组」）导入成不同的分组', () => {
  const list = [
    { type: 'group', name: '分组', items: [{ title: '1', url: 'https://1/' }] },
    { type: 'group', name: '分组', items: [{ title: '2', url: 'https://2/' }] },
  ];
  const out = toList(importRecords(list, { device: 'A' }));
  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, out[1].id);
});

test('补导入只加从没出现过的：用户删过（墓碑）、改过的都不动', () => {
  const imported = importRecords(structuredClone(SAMPLE), { device: 'A' });
  const [firstId] = Object.keys(imported);
  const records = {
    ...imported,
    [firstId]: { ...imported[firstId], deleted: true, t: 900, d: 'A' },
    [META_MIGRATED]: { id: META_MIGRATED, kind: 'meta', t: 1, d: 'A' },
  };
  const again = importRecords(structuredClone(SAMPLE), { device: 'B' });
  assert.deepEqual(missingOnly(again, records), {});
  // 导入记录 t=1，任何真实修改都比它新
  assert.equal(mergeRecords(records, again)[firstId].deleted, true);
});

test('meta 记录不出现在列表里', () => {
  const records = { ...fromList(SAMPLE), [META_MIGRATED]: { id: META_MIGRATED, kind: 'meta', t: 1, d: 'A' } };
  assert.equal(toList(records).length, 3);
});

test('hash53 稳定', () => {
  assert.equal(hash53('hello'), hash53('hello'));
  assert.notEqual(hash53('hello'), hash53('hellp'));
});

test('图标记录：按网站一条，不影响书签列表；缺的、过期的才需要补', async () => {
  const { iconsFrom, originsNeedingIcons, iconRecord, originOf } = await import('../shared/qlmodel.js');
  const records = fromList(SAMPLE);
  const list = toList(records);
  assert.deepEqual(originsNeedingIcons(list, records, { now: 1000 }).sort(),
    ['https://a.example', 'https://jira.example', 'https://list.example', 'https://slack.example']);
  const withIcon = mergeRecords(records, iconRecord('https://a.example', 'data:image/webp;base64,AAA', { now: 1000, device: 'A' }));
  assert.equal(toList(withIcon).length, 3, '图标不出现在列表里');
  assert.deepEqual(iconsFrom(withIcon), { 'https://a.example': 'data:image/webp;base64,AAA' });
  assert.ok(!originsNeedingIcons(list, withIcon, { now: 2000 }).includes('https://a.example'));
  assert.ok(originsNeedingIcons(list, withIcon, { now: 1000 + 31 * 86400e3 }).includes('https://a.example'), '30 天后刷新');
  assert.equal(originOf('chrome://settings'), '');
});
