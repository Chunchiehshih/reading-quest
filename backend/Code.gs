/**
 * 閱讀闖關站：班級繳交後端（Google Apps Script + Google 試算表）
 *
 * 安裝：見 backend/README.md。只要改下面的 TEACHER_KEY，然後「部署 → 新增部署作業 → 網頁應用程式」，
 * 執行身分選「我」，存取權選「所有人」。
 *
 * 學生只能「讀取班級資訊」和「繳交紀錄」；建立班級、讀取全班紀錄都需要教師密碼。
 */
const TEACHER_KEY = '請改成你自己的教師密碼';

const SHEET_CLASSES = 'classes';
const SHEET_SUBS = 'submissions';
const CLASS_HEAD = ['班級代碼', '班級名稱', '年級', '指派關卡', '建立時間'];
const SUB_HEAD = ['繳交時間', '班級代碼', '座號', '姓名', '關卡', '分數',
  '層次一', '層次二', '層次三', '層次四', '錯題數', '反思', '紀錄JSON'];

function doGet(e) {
  const p = e.parameter || {};
  // 沒有 action 時，直接提供闖關網站本身（Index.html），學生掃 QR code 就會到這裡
  if (!p.action) return page_(p);
  return json_(handle_(p));
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  return json_(handle_(body));
}

/** 網頁在 Apps Script 裡執行時，透過 google.script.run 呼叫這個函式 */
function rpc(req) {
  return handle_(req || {});
}

function handle_(req) {
  const writes = { createClass: 1, submit: 1 };
  const lock = writes[req.action] ? LockService.getScriptLock() : null;
  try {
    if (lock) lock.waitLock(20000);
    switch (req.action) {
      case 'ping': return { ok: true };
      case 'class': return getClass_(req.code);
      case 'classes': checkKey_(req.key); return { ok: true, classes: listClasses_() };
      case 'list': checkKey_(req.key); return { ok: true, submissions: listSubs_(req.code) };
      case 'createClass': checkKey_(req.key); return createClass_(req);
      case 'submit': return submit_(req);
      default: return { ok: false, error: 'unknown_action' };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function page_(p) {
  const url = ScriptApp.getService().getUrl();
  const launch = { c: String(p.c || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) };
  const head = '<script>window.RLQ_CONFIG = { apiUrl: ' + JSON.stringify(url) + ', siteUrl: ' + JSON.stringify(url) +
    ' }; window.RLQ_LAUNCH = ' + JSON.stringify(launch) + ';</script>';
  return HtmlService.createHtmlOutput(head)
    .append(HtmlService.createHtmlOutputFromFile('Index').getContent())
    .setTitle('閱讀闖關站')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function checkKey_(key) {
  if (!key || key !== TEACHER_KEY) throw new Error('wrong_key');
}

function sheet_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function newCode_(existing) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (existing.indexOf(code) >= 0);
  return code;
}

function listClasses_() {
  const rows = sheet_(SHEET_CLASSES, CLASS_HEAD).getDataRange().getValues().slice(1);
  return rows.filter(r => r[0]).map(r => ({
    code: String(r[0]), name: String(r[1]), grade: Number(r[2]) || 5,
    quests: String(r[3]).split(',').filter(String), created: String(r[4])
  }));
}

function getClass_(code) {
  code = String(code || '').trim().toUpperCase();
  const c = listClasses_().filter(x => x.code === code)[0];
  return c ? { ok: true, class: c } : { ok: false, error: 'class_not_found' };
}

function createClass_(b) {
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) throw new Error('missing_name');
  const quests = (b.quests || []).map(String).filter(String);
  if (!quests.length) throw new Error('missing_quests');
  const code = newCode_(listClasses_().map(c => c.code));
  sheet_(SHEET_CLASSES, CLASS_HEAD).appendRow([code, name, Number(b.grade) || 5, quests.join(','), new Date()]);
  return { ok: true, class: { code: code, name: name, grade: Number(b.grade) || 5, quests: quests } };
}

function submit_(b) {
  const cls = getClass_(b.code);
  if (!cls.ok) throw new Error('class_not_found');
  const seat = String(b.seat || '').trim().slice(0, 10);
  const name = String(b.name || '').trim().slice(0, 20);
  const questId = String(b.questId || '');
  if (!seat || !name || !questId) throw new Error('missing_fields');
  if (cls.class.quests.indexOf(questId) < 0) throw new Error('quest_not_assigned');
  const rec = b.record || {};
  const lv = rec.levels || {};
  const rate = L => (lv[L] && lv[L].n) ? Math.round(lv[L].first / lv[L].n * 100) + '%' : '';
  const raw = JSON.stringify(rec);
  if (raw.length > 45000) throw new Error('record_too_large');
  const row = [new Date(), cls.class.code, seat, name, questId, Number(rec.score) || 0,
    rate(1), rate(2), rate(3), rate(4), Number(rec.wrongCount) || 0, String(rec.reflectionText || ''), raw];
  const sh = sheet_(SHEET_SUBS, SUB_HEAD);
  const data = sh.getDataRange().getValues();
  // 同一班、同座號、同關卡再次繳交時，覆蓋舊的那一列
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === cls.class.code && String(data[i][2]) === seat && String(data[i][4]) === questId) {
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { ok: true, at: row[0].toISOString(), replaced: true };
    }
  }
  sh.appendRow(row);
  return { ok: true, at: row[0].toISOString() };
}

function listSubs_(code) {
  code = String(code || '').trim().toUpperCase();
  const rows = sheet_(SHEET_SUBS, SUB_HEAD).getDataRange().getValues().slice(1);
  return rows.filter(r => String(r[1]) === code).map(r => {
    let record = {};
    try { record = JSON.parse(r[12]); } catch (err) { /* keep empty */ }
    return { at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), code: String(r[1]), seat: String(r[2]), name: String(r[3]), questId: String(r[4]), score: r[5], record: record };
  });
}
