// 前后端接口联调脚本：镜像 src/lib/api.ts 的全部请求（路径 / 字段名 / 错误语义），
// 对运行中的后端做端到端校验。用法：
//
//   node scripts/api-e2e.mjs                 # 默认 http://127.0.0.1:8000
//   E2E_BASE_URL=http://127.0.0.1:8001 node scripts/api-e2e.mjs
//
// 会向后端写入带 e2e 前缀的数据（用户 / 批次 / 标签 / 标注 / 边），并在结束时回滚到
// e2e 基线标签撤销可回滚的变更；标注为追加式、会保留。脚本自身不写 change_log 之外
// 的全局状态，可重复执行。

const BASE = (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

let pass = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 与 api.ts::request 相同的错误体解析（detail 字符串 / 422 数组）。 */
function readErrorDetail(payload, status) {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const d = payload.detail;
    if (typeof d === 'string' && d.trim()) return d;
    if (Array.isArray(d)) {
      const msgs = d
        .map((item) => (item && typeof item === 'object' && 'msg' in item ? String(item.msg) : ''))
        .filter(Boolean);
      if (msgs.length) return msgs.join('；');
    }
  }
  return `HTTP ${status}`;
}

async function req(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let payload = null;
  if (res.status !== 204) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }
  return { status: res.status, payload, res };
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 断言对象字段齐全且类型匹配；返回 null 或缺失说明。 */
function hasShape(obj, shape) {
  const missing = Object.entries(shape).filter(([key, type]) => {
    const v = obj?.[key];
    if (type === 'array') return !Array.isArray(v);
    if (type === 'object') return !isObject(v);
    if (type === 'string|null') return v !== null && typeof v !== 'string';
    if (type === 'number|null') return v !== null && typeof v !== 'number';
    if (type === 'string') return typeof v !== 'string';
    if (type === 'number') return typeof v !== 'number';
    if (type === 'boolean') return typeof v !== 'boolean';
    return true;
  }).map(([key]) => key);
  return missing.length === 0 ? null : `缺字段或类型不符: ${missing.join(', ')}`;
}

async function expectStatus(name, promiseOrRes, wantStatus, wantDetailIncludes) {
  const r = await promiseOrRes;
  const okStatus = r.status === wantStatus;
  let ok = okStatus;
  let detail = `实际 ${r.status}`;
  if (okStatus && wantDetailIncludes) {
    const msg = readErrorDetail(r.payload, r.status);
    ok = msg.includes(wantDetailIncludes);
    detail = `detail="${msg}"`;
  }
  check(name, ok, ok ? '' : detail);
  return r;
}

const ts = Date.now();
const TAG_BASE = `e2e-baseline-${ts}`;
const TAG_MID = `e2e-mid-${ts}`;
const DS_E2E = `e2e_ds_${ts}`;
const EDITOR_NAME = `e2e_ed_${ts}`;
const VIEWER_NAME = `e2e_vw_${ts}`;

// ---------- 会话 ----------
let T = null; // admin token
let editor = null;
let viewer = null;

async function main() {
  console.log(`\n== 0. 登录与会话（POST /auth/login、GET /auth/me）==`);
  const login = await req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  check('登录 200 且返回 access_token/username/role', login.status === 200 &&
    hasShape(login.payload, { access_token: 'string', token_type: 'string', username: 'string', role: 'string' }) === null,
    `实际 ${login.status}`);
  T = login.payload?.access_token;
  await expectStatus('错误密码 401', req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } }), 401);
  const me = await req('/auth/me', { token: T });
  check('GET /auth/me 200 返回 username/role', me.status === 200 && hasShape(me.payload, { username: 'string', role: 'string' }) === null, `实际 ${me.status}`);
  await expectStatus('无凭据 401（前端据此回登录页）', req('/datasets'), 401);

  console.log(`\n== 1. 浏览：数据集 / 子图 / 回源预览（viewer 读路径）==`);
  const ds = await req('/datasets', { token: T });
  check('GET /datasets 200 且元素含 id/name/field_count/field_names',
    ds.status === 200 && Array.isArray(ds.payload) && ds.payload.length > 0 &&
    hasShape(ds.payload[0], { id: 'string', name: 'string|null', field_count: 'number', field_names: 'array' }) === null,
    `实际 ${ds.status}`);
  const seedDs = ds.payload.find((d) => !d.id.startsWith('e2e'));
  const seedId = seedDs?.id ?? 'd0';

  const detail = await req(`/datasets/${encodeURIComponent(seedId)}`, { token: T });
  const seedDesc = detail.payload?.fields?.find((f) => f.name === 'order_id')?.description ?? null;
  check('GET /datasets/{id} 200 字段含定位器信封与来源文件名',
    detail.status === 200 && isObject(detail.payload) &&
    detail.payload.fields?.[0]?.src_locator != null && 'input' in detail.payload.fields[0].src_locator &&
    typeof detail.payload.fields[0].source_file_name === 'string',
    `实际 ${detail.status}`);

  const sub = await req(`/lineage/subgraph?dataset=${seedId}&hops=3&direction=both`, { token: T });
  const subOk = sub.status === 200 && isObject(sub.payload) && Array.isArray(sub.payload.datasets) && Array.isArray(sub.payload.edges);
  check('GET /lineage/subgraph 200 返回 datasets[]/edges[]', subOk, `实际 ${sub.status}`);
  if (subOk) {
    const f = sub.payload.datasets.flatMap((d) => d.fields ?? [])[0];
    check('子图字段含 name/field_type/description/src_locator 信封/source_file',
      f && hasShape(f, { name: 'string', field_type: 'string|null', description: 'string|null' }) === null &&
      isObject(f.src_locator) && 'input' in f.src_locator && 'resolved' in f.src_locator &&
      isObject(f.source_file) && typeof f.source_file.original_name === 'string');
    const e = sub.payload.edges[0];
    check('子图边含 id 与 8 个业务字段（附录 A2）',
      e && hasShape(e, { id: 'number', from_dataset: 'string', from_field: 'string|null', to_dataset: 'string', to_field: 'string|null', transform: 'string|null', confidence: 'number|null', source: 'string', note: 'string|null' }) === null);
  }
  const fieldSub = await req(`/lineage/subgraph?dataset=${seedId}&field=order_id&hops=2&direction=up`, { token: T });
  check('字段级子图 200', fieldSub.status === 200, `实际 ${fieldSub.status}`);
  await expectStatus('子图未知数据集 404', req(`/lineage/subgraph?dataset=nope_${ts}&hops=3`, { token: T }), 404);
  await expectStatus('子图 hops=9 越界 422', req(`/lineage/subgraph?dataset=${seedId}&hops=9`, { token: T }), 422);

  // 三种定位器各挑一个字段做回源预览
  for (const [dsId, field, kind] of [[seedId, 'order_id', 'csv'], ['d1', 'order_id', 'xlsx'], ['d2', 'order_id', 'json']]) {
    const p = await req(`/fields/${encodeURIComponent(dsId)}/${encodeURIComponent(field)}/preview`, { token: T });
    const shapeOk = p.status === 200 && isObject(p.payload) &&
      hasShape(p.payload, { file: 'object', locator: 'object', preview: 'object' }) === null &&
      (p.payload.verification === null || hasShape(p.payload.verification, { status: 'string', version_no: 'number', checked_by: 'string', checked_at: 'string' }) === null);
    check(`GET /fields/${dsId}/${field}/preview（${kind}）200 且结构正确`, shapeOk, `实际 ${p.status}`);
    if (p.status === 200) {
      const pv = p.payload.preview;
      const want = {
        csv: ['header', 'column_index', 'rows'],
        xlsx: ['sheet', 'header_rows', 'merged_ranges', 'column_index', 'row_start', 'row_end', 'rows'],
        json: ['json_path', 'hits', 'samples'],
      }[kind];
      check(`  ${kind} preview 形态字段 ${want.join('/')}`, want.every((k) => k in pv));
    }
  }
  await expectStatus('未知字段预览 404', req(`/fields/${seedId}/nope_${ts}/preview`, { token: T }), 404);

  console.log(`\n== 2. 用户管理（admin）==`);
  const users0 = await req('/users', { token: T });
  check('GET /users 200 元素含 username/display_name/role',
    users0.status === 200 && Array.isArray(users0.payload) &&
    hasShape(users0.payload[0], { username: 'string', display_name: 'string|null', role: 'string' }) === null,
    `实际 ${users0.status}`);
  const mkUser = await req('/users', { method: 'POST', token: T, body: { username: EDITOR_NAME, password: 'e2e-pass-123', display_name: '联调编辑', role: 'editor' } });
  check('POST /users editor 201', mkUser.status === 201 && hasShape(mkUser.payload, { username: 'string', display_name: 'string|null', role: 'string' }) === null, `实际 ${mkUser.status}`);
  const mkViewer = await req('/users', { method: 'POST', token: T, body: { username: VIEWER_NAME, password: 'e2e-pass-123', role: 'viewer' } });
  check('POST /users viewer 201', mkViewer.status === 201, `实际 ${mkViewer.status}`);
  await expectStatus('重名用户 409', req('/users', { method: 'POST', token: T, body: { username: EDITOR_NAME, password: 'e2e-pass-123', role: 'editor' } }), 409);
  await expectStatus('非法角色 422', req('/users', { method: 'POST', token: T, body: { username: `e2e_x_${ts}`, password: 'e2e-pass-123', role: 'root' } }), 422);
  editor = (await req('/auth/login', { method: 'POST', body: { username: EDITOR_NAME, password: 'e2e-pass-123' } })).payload?.access_token;
  viewer = (await req('/auth/login', { method: 'POST', body: { username: VIEWER_NAME, password: 'e2e-pass-123' } })).payload?.access_token;
  check('新用户可登录换取 token', Boolean(editor) && Boolean(viewer));

  console.log(`\n== 3. RBAC：viewer 只读（写操作 403）==`);
  await expectStatus('viewer GET /datasets 200', req('/datasets', { token: viewer }), 200);
  await expectStatus('viewer POST /files 403', req('/files', { method: 'POST', token: viewer, form: new FormData() }), 403);
  await expectStatus('viewer POST /edges 403', req('/edges', { method: 'POST', token: viewer, body: { from_dataset: seedId, to_dataset: seedId } }), 403);
  await expectStatus('viewer POST /annotations 403', req('/annotations', { method: 'POST', token: viewer, body: { target_kind: 'dataset', target_id: seedId, body: 'x' } }), 403);
  await expectStatus('viewer GET /users 403', req('/users', { token: viewer }), 403);
  await expectStatus('viewer POST /ai/suggest 403', req('/ai/suggest', { method: 'POST', token: viewer, body: { dataset: seedId } }), 403);

  console.log(`\n== 4. 导入向导三步：上传 → 导入 → 批次（POST /files、POST /import、GET /import/batches）==`);
  const csv1 = 'order_id,amount,region\nSO-1,19.9,华东\nSO-2,42.0,华北\n';
  const csv2 = 'product_id,region,qty\nP-1,华东,3\nP-2,华北,7\n';
  const form1 = new FormData();
  form1.append('files', new File([csv1], 'e2e_orders.csv', { type: 'text/csv' }));
  form1.append('files', new File([csv2], 'e2e_products.csv', { type: 'text/csv' }));
  const up = await req('/files', { method: 'POST', token: editor, form: form1 });
  const upOk = up.status === 201 && Array.isArray(up.payload) && up.payload.length === 2 &&
    hasShape(up.payload[0], { id: 'number', original_name: 'string', storage_path: 'string', sha256: 'string', size_bytes: 'number', src_type: 'string', uploaded_by: 'string', created_at: 'string', deduped: 'boolean' }) === null;
  check('POST /files 201 返回登记记录（含 storage_path/deduped）', upOk, `实际 ${up.status}`);
  const [fileA, fileB] = up.payload ?? [];
  const formDup = new FormData();
  formDup.append('files', new File([csv1], 'e2e_orders_again.csv', { type: 'text/csv' }));
  const upDup = await req('/files', { method: 'POST', token: editor, form: formDup });
  check('同内容重复上传 sha256 去重 deduped=true', upDup.status === 201 && upDup.payload?.[0]?.deduped === true, `实际 ${upDup.status}`);

  const dsManifest = [
    'dataset_id,dataset_name,field_name,field_type,src_file,src_type,src_locator,description',
    `${DS_E2E},E2E测试集,order_id,STRING,${fileA.id},csv,"{""header"":""order_id""}",订单号`,
    `${DS_E2E},E2E测试集,amount,DECIMAL,${fileA.id},csv,"{""header"":""amount""}",订单金额`,
    `${DS_E2E},E2E测试集,bad_field,STRING,${fileA.id},csv,"{""header"":""no_such_header""}",应被行级拒绝`,
    `${DS_E2E},E2E测试集,region,STRING,${fileB.id},csv,"{""column"":2}",销售地区`,
  ].join('\n');
  const edgeManifest = [
    'from_dataset,from_field,to_dataset,to_field,transform,confidence,note',
    `${DS_E2E},order_id,${seedId},order_id,trim,0.9,e2e导入边`,
    `${DS_E2E},amount,${seedId},amount,cast,not-a-number,置信度非法应拒绝`,
  ].join('\n');
  const importForm = new FormData();
  importForm.append('format', 'csv');
  importForm.append('source_file_ids', `${fileA.id},${fileB.id}`);
  importForm.append('manifest_datasets', new File([dsManifest], 'datasets.csv', { type: 'text/csv' }));
  importForm.append('manifest_lineage', new File([edgeManifest], 'lineage.csv', { type: 'text/csv' }));
  const imp = await req('/import', { method: 'POST', token: editor, form: importForm });
  const impOk = imp.status === 201 && isObject(imp.payload) &&
    hasShape(imp.payload, { batch_id: 'number', version_no: 'number', report: 'object' }) === null &&
    hasShape(imp.payload.report, { summary: 'object', items: 'array' }) === null;
  check('POST /import 201 返回 batch_id/version_no/report', impOk, `实际 ${imp.status} ${JSON.stringify(imp.payload ?? '')?.slice(0, 200)}`);
  if (impOk) {
    const { summary, items } = imp.payload.report;
    check(`导入报告行级拒绝生效（rejected>=2，实际 ${JSON.stringify(summary)}）`, summary.rejected >= 2 && items.some((i) => i.status === 'rejected'));
  }
  const batchId = imp.payload?.batch_id;
  const batches = await req('/import/batches', { token: T });
  const batchRow = batches.payload?.find((b) => b.id === batchId);
  check('GET /import/batches 含新批次（file_names 数组、rolled_back_at null）',
    batches.status === 200 && batchRow &&
    hasShape(batchRow, { id: 'number', version_no: 'number', file_names: 'array', format: 'string', created_by: 'string', created_at: 'string', rolled_back_at: 'string|null' }) === null,
    `实际 ${batches.status}`);
  const subNew = await req(`/lineage/subgraph?dataset=${DS_E2E}&hops=1&direction=both`, { token: T });
  check('导入后新数据集可查询子图', subNew.status === 200 && subNew.payload?.datasets?.some((d) => d.id === DS_E2E), `实际 ${subNew.status}`);
  const pvNew = await req(`/fields/${DS_E2E}/order_id/preview`, { token: T });
  check('导入字段的回源预览 200 且 verification.passed', pvNew.status === 200 && pvNew.payload?.verification?.status === 'passed', `实际 ${pvNew.status}`);
  await expectStatus('缺清单文件 400', req('/import', {
    method: 'POST', token: editor,
    form: (() => { const f = new FormData(); f.append('format', 'csv'); f.append('source_file_ids', String(fileA.id)); return f; })(),
  }), 400);

  console.log(`\n== 5. 批次回滚（admin）+ 建立可回滚基线标签 ==`);
  await expectStatus('editor 批次回滚 403', req(`/import/batches/${batchId}/rollback`, { method: 'POST', token: editor }), 403);
  const rb = await req(`/import/batches/${batchId}/rollback`, { method: 'POST', token: T });
  check('admin 批次回滚 200 {batch_id,reverted}', rb.status === 200 && rb.payload?.batch_id === batchId && rb.payload?.reverted > 0, `实际 ${rb.status}`);
  await expectStatus('重复批次回滚 409', req(`/import/batches/${batchId}/rollback`, { method: 'POST', token: T }), 409);
  const subGone = await req(`/lineage/subgraph?dataset=${DS_E2E}&hops=1`, { token: T });
  check('回滚后 e2e_ds 子图 404（数据已撤销）', subGone.status === 404, `实际 ${subGone.status}`);
  const batches2 = await req('/import/batches', { token: T });
  check('批次列表 rolled_back_at 已写入', batches2.payload?.find((b) => b.id === batchId)?.rolled_back_at != null);

  const tag0 = await req('/version-tags', { method: 'POST', token: T, body: { name: TAG_BASE, note: 'e2e 基线（本轮联调后续写入之前）' } });
  check('POST /version-tags 201 {name,change_seq,…}', tag0.status === 201 && hasShape(tag0.payload, { name: 'string', note: 'string|null', change_seq: 'number', created_by: 'string', created_at: 'string' }) === null, `实际 ${tag0.status}`);
  await expectStatus('标签重名 409', req('/version-tags', { method: 'POST', token: T, body: { name: TAG_BASE } }), 409);

  console.log(`\n== 6. 字段编辑（PATCH /fields/{ds}/{f}）==`);
  const pf = await req(`/fields/${seedId}/order_id`, { method: 'PATCH', token: editor, body: { description: `E2E 口径说明 ${ts}` } });
  check('editor 改描述 200 返回字段对象（含 src_locator）', pf.status === 200 && isObject(pf.payload) && pf.payload.description === `E2E 口径说明 ${ts}` && 'src_locator' in pf.payload, `实际 ${pf.status}`);
  await expectStatus('定位器类型与源文件不一致 409', req(`/fields/${seedId}/order_id`, { method: 'PATCH', token: editor, body: { src_locator: { type: 'json', input: { json_path: '$.x' } } } }), 409);
  await expectStatus('显式 src_locator:null 400', req(`/fields/${seedId}/order_id`, { method: 'PATCH', token: editor, body: { src_locator: null } }), 400);
  await expectStatus('空编辑体 400', req(`/fields/${seedId}/order_id`, { method: 'PATCH', token: editor, body: {} }), 400);
  await expectStatus('viewer 改字段 403', req(`/fields/${seedId}/order_id`, { method: 'PATCH', token: viewer, body: { description: 'x' } }), 403);

  console.log(`\n== 7. 标注（追加式，不随回滚删除）==`);
  const ano = await req('/annotations', { method: 'POST', token: editor, body: { target_kind: 'field', target_id: `${seedId}.order_id`, body: `E2E 标注 ${ts}` } });
  check('POST /annotations 201 返回 id/author', ano.status === 201 && hasShape(ano.payload, { id: 'number', target_kind: 'string', target_id: 'string', body: 'string', author: 'string', created_at: 'string' }) === null, `实际 ${ano.status}`);
  const anoList = await req(`/annotations?target_kind=field&target_id=${encodeURIComponent(`${seedId}.order_id`)}`, { token: viewer });
  check('GET /annotations 按目标过滤可读到新标注', anoList.status === 200 && Array.isArray(anoList.payload) && anoList.payload.some((a) => a.body === `E2E 标注 ${ts}`), `实际 ${anoList.status}`);
  await expectStatus('空白 body 400', req('/annotations', { method: 'POST', token: editor, body: { target_kind: 'field', target_id: `${seedId}.order_id`, body: '   ' } }), 400);
  await expectStatus('目标不存在 404', req('/annotations', { method: 'POST', token: editor, body: { target_kind: 'dataset', target_id: `nope_${ts}`, body: 'x' } }), 404);

  console.log(`\n== 8. 血缘边 CRUD（POST/PATCH/DELETE /edges）==`);
  // 种子边为 d0→d1→…→d4 单向；反向 d3.order_id→d2.order_id 是新的自然键
  const ek = { from_dataset: 'd3', from_field: 'order_id', to_dataset: 'd2', to_field: 'order_id' };
  const eNew = await req('/edges', { method: 'POST', token: editor, body: { ...ek, transform: 'e2e 反向边', confidence: 0.9, note: 'e2e' } });
  const eNewOk = eNew.status === 201 && hasShape(eNew.payload, { id: 'number', from_dataset: 'string', from_field: 'string|null', to_dataset: 'string', to_field: 'string|null', transform: 'string|null', confidence: 'number|null', source: 'string', note: 'string|null' }) === null;
  check('POST /edges 201 source=manual', eNewOk && eNew.payload.source === 'manual', `实际 ${eNew.status}`);
  const edgeId = eNew.payload?.id;
  await expectStatus('同自然键重复建边 409', req('/edges', { method: 'POST', token: editor, body: { ...ek } }), 409);
  await expectStatus('字段级/表级一空一非空 400', req('/edges', { method: 'POST', token: editor, body: { from_dataset: 'd3', from_field: 'order_id', to_dataset: 'd2', to_field: null } }), 400);
  await expectStatus('confidence 超界 422', req('/edges', { method: 'POST', token: editor, body: { ...ek, confidence: 1.5 } }), 422);
  await expectStatus('不存在的数据集 404', req('/edges', { method: 'POST', token: editor, body: { from_dataset: `nope_${ts}`, to_dataset: 'd2' } }), 404);
  const ep = await req(`/edges/${edgeId}`, { method: 'PATCH', token: editor, body: { transform: 'e2e 反向边 v2', note: 'e2e 核对', confidence: 0.8 } });
  check('PATCH /edges 200 更新生效', ep.status === 200 && ep.payload?.transform === 'e2e 反向边 v2' && ep.payload?.confidence === 0.8, `实际 ${ep.status}`);
  const ch = await req(`/changes?entity_kind=edge&entity_key=${encodeURIComponent('d3.order_id-->d2.order_id')}&limit=10`, { token: viewer });
  check('GET /changes 边历史含 added/updated 且 before/after 为对象',
    ch.status === 200 && Array.isArray(ch.payload) && ch.payload.length >= 2 &&
    ch.payload.every((c) => hasShape(c, { id: 'number', op: 'string', actor: 'string', created_at: 'string' }) === null && (c.before === null || isObject(c.before)) && (c.after === null || isObject(c.after))),
    `实际 ${ch.status}`);
  await expectStatus('viewer 删边 403', req(`/edges/${edgeId}`, { method: 'DELETE', token: viewer }), 403);
  const del = await req(`/edges/${edgeId}`, { method: 'DELETE', token: editor });
  check('DELETE /edges 204 无响应体', del.status === 204, `实际 ${del.status}`);
  await expectStatus('重复删边 404', req(`/edges/${edgeId}`, { method: 'DELETE', token: editor }), 404);

  console.log(`\n== 9. AI：状态 / 对话 / 启发式建议 ==`);
  const st = await req('/ai/status', { token: viewer });
  check('GET /ai/status 200 {configured,model}', st.status === 200 && hasShape(st.payload, { configured: 'boolean' }) === null && 'model' in st.payload, `实际 ${st.status}`);
  const chat = await req('/ai/chat', { method: 'POST', token: viewer, body: { messages: [{ role: 'user', content: `d0 的 order_id 从哪来？` }], focus: { dataset: seedId } } });
  if (st.payload?.configured === false) {
    check('未配置 LLM 时 /ai/chat 503', chat.status === 503, `实际 ${chat.status}`);
  } else {
    check('已配置 LLM 时 /ai/chat 200 {answer,tool_trace}', chat.status === 200 && typeof chat.payload?.answer === 'string' && Array.isArray(chat.payload?.tool_trace), `实际 ${chat.status}`);
  }
  await expectStatus('消息 role=system 422', req('/ai/chat', { method: 'POST', token: viewer, body: { messages: [{ role: 'system', content: 'x' }] } }), 422);
  const sug = await req('/ai/suggest', { method: 'POST', token: editor, body: { dataset: seedId, field: null } });
  const sugOk = sug.status === 200 && Array.isArray(sug.payload?.candidates);
  check('POST /ai/suggest 200 candidates（confidence/reason）', sugOk && (sug.payload.candidates.length === 0 ||
    hasShape(sug.payload.candidates[0], { from_dataset: 'string', from_field: 'string|null', to_dataset: 'string', to_field: 'string|null', confidence: 'number', reason: 'string' }) === null), `实际 ${sug.status}`);
  const candidates = sug.payload?.candidates ?? [];
  if (candidates.length > 0) {
    const key = (({ from_dataset, from_field, to_dataset, to_field }) => ({ from_dataset, from_field, to_dataset, to_field }))(candidates[0]);
    const cf = await req('/ai/suggest/confirm', { method: 'POST', token: editor, body: key });
    check('confirm 候选边转 manual 200 {edge}', cf.status === 200 && cf.payload?.edge?.source === 'manual' && typeof cf.payload.edge.id === 'number', `实际 ${cf.status}`);
    const cfAgain = await req('/ai/suggest/confirm', { method: 'POST', token: editor, body: key });
    check('重复 confirm 404（已处理）', cfAgain.status === 404, `实际 ${cfAgain.status}`);
    if (candidates.length > 1) {
      const key2 = (({ from_dataset, from_field, to_dataset, to_field }) => ({ from_dataset, from_field, to_dataset, to_field }))(candidates[1]);
      const rj = await req('/ai/suggest/reject', { method: 'POST', token: editor, body: key2 });
      check('reject 候选边 204', rj.status === 204, `实际 ${rj.status}`);
      const rjAgain = await req('/ai/suggest/reject', { method: 'POST', token: editor, body: key2 });
      check('重复 reject 404', rjAgain.status === 404, `实际 ${rjAgain.status}`);
    }
  } else {
    check('存在可用的启发式候选（种子数据同名字段应命中）', false, 'candidates 为空');
  }

  console.log(`\n== 10. 版本标签：diff / 回滚到基线（撤销第 6、8、9 步写入）==`);
  const tag1 = await req('/version-tags', { method: 'POST', token: editor, body: { name: TAG_MID } });
  check('第二个标签 201', tag1.status === 201, `实际 ${tag1.status}`);
  const tags = await req('/version-tags', { token: viewer });
  check('GET /version-tags 列表元素含 id/batch_id/change_seq',
    tags.status === 200 && tags.payload.some((t) => t.name === TAG_MID) &&
    hasShape(tags.payload[0], { id: 'number', name: 'string', note: 'string|null', batch_id: 'number|null', change_seq: 'number', created_by: 'string', created_at: 'string' }) === null,
    `实际 ${tags.status}`);
  const diff = await req(`/version-tags/diff?from=${encodeURIComponent(TAG_BASE)}&to=${encodeURIComponent(TAG_MID)}`, { token: viewer });
  const diffOk = diff.status === 200 && hasShape(diff.payload, { summary: 'object', items: 'array' }) === null;
  check('GET /version-tags/diff 200 summary/items 且区间内有净变更', diffOk && (diff.payload?.items?.length ?? 0) >= 1, `实际 ${diff.status}`);
  if (diffOk) {
    check('diff 汇总含 added/updated/deleted 三个计数', ['added', 'updated', 'deleted'].every((k) => typeof diff.payload.summary[k] === 'number'));
  }
  await expectStatus('diff 方向颠倒 400', req(`/version-tags/diff?from=${encodeURIComponent(TAG_MID)}&to=${encodeURIComponent(TAG_BASE)}`, { token: viewer }), 400);
  await expectStatus('diff 未知标签 404', req(`/version-tags/diff?from=nope_${ts}&to=${encodeURIComponent(TAG_MID)}`, { token: viewer }), 404);
  await expectStatus('editor 标签回滚 403', req(`/version-tags/${encodeURIComponent(TAG_MID)}/rollback`, { method: 'POST', token: editor }), 403);
  const trb = await req(`/version-tags/${encodeURIComponent(TAG_BASE)}/rollback`, { method: 'POST', token: T });
  check('admin 回滚到基线 200 {reverted>0}', trb.status === 200 && trb.payload?.reverted > 0, `实际 ${trb.status} ${JSON.stringify(trb.payload ?? '')}`);
  const trb2 = await req(`/version-tags/${encodeURIComponent(TAG_BASE)}/rollback`, { method: 'POST', token: T });
  check('重复标签回滚幂等（reverted=0）', trb2.status === 200 && trb2.payload?.reverted === 0, `实际 ${trb2.status}`);
  const detailBack = await req(`/datasets/${encodeURIComponent(seedId)}`, { token: T });
  check('回滚后字段描述已还原为基线值', detailBack.status === 200 &&
    detailBack.payload?.fields?.find((f) => f.name === 'order_id')?.description === seedDesc,
    `实际 ${detailBack.status}`);

  console.log(`\n== 11. 源文件列表与受控下载 ==`);
  const fl = await req('/files', { token: viewer });
  check('GET /files 200 且不含 storage_path（业务规则#8）',
    fl.status === 200 && Array.isArray(fl.payload) && fl.payload.length > 0 &&
    hasShape(fl.payload[0], { id: 'number', original_name: 'string', sha256: 'string', size_bytes: 'number', src_type: 'string', uploaded_by: 'string', created_at: 'string' }) === null &&
    !('storage_path' in fl.payload[0]),
    `实际 ${fl.status}`);
  const dl = await fetch(`${BASE}/files/${fl.payload[0].id}/download`, { headers: { Authorization: `Bearer ${viewer}` } });
  check('GET /files/{id}/download 200 二进制流（Content-Disposition）', dl.status === 200 && (dl.headers.get('content-disposition') ?? '').length > 0, `实际 ${dl.status}`);
  await dl.body?.cancel();
  await expectStatus('下载不存在文件 404', req('/files/999999999/download', { token: viewer }), 404);

  console.log(`\n=========================================`);
  console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    console.log('\n失败明细:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('联调脚本异常中断:', err);
  process.exit(2);
});
