const CONVERSATIONS_DIR = path.join(os.homedir(), '.gemini/antigravity/conversations');
const metricsCache = new Map(); // cascadeId -> { sig, payload }
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Decode supported protobuf wire fields; reject truncation and unsafe numeric values. */
function parseProto(buf) {
  if (!ArrayBuffer.isView(buf) || buf.BYTES_PER_ELEMENT !== 1) throw new TypeError('Expected protobuf bytes');
  let offset = 0;
  const fields = new Map();

  /** Read at most ten bytes; never allow bitwise truncation to wrap a length negative. */
  function readVarint() {
    let value = 0n;
    for (let byteIndex = 0; byteIndex < 10; byteIndex += 1) {
      if (offset >= buf.length) throw new RangeError('Truncated protobuf varint');
      const byte = buf[offset++];
      if (byteIndex === 9 && byte > 1) throw new RangeError('Invalid protobuf varint');
      value |= BigInt(byte & 0x7f) << BigInt(byteIndex * 7);
      if (!(byte & 0x80)) {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Unsafe protobuf integer');
        return Number(value);
      }
    }
    throw new RangeError('Invalid protobuf varint');
  }

  while (offset < buf.length) {
    const tag = readVarint();
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag % 8;
    if (fieldNumber < 1 || fieldNumber > 0x1fffffff) throw new RangeError('Invalid protobuf field');
    if (wireType === 0) {
      fields.set(fieldNumber, readVarint());
      continue;
    }
    let length;
    if (wireType === 2) length = readVarint();
    else if (wireType === 1) length = 8;
    else if (wireType === 5) length = 4;
    else throw new RangeError('Unsupported protobuf wire type');
    if (length > buf.length - offset) throw new RangeError('Truncated protobuf field');
    fields.set(fieldNumber, buf.subarray(offset, offset + length));
    offset += length;
  }
  return fields;
}

/** Read a token/duration scalar without allowing bytes or non-numeric data into rendered HTML. */
function numericField(fields, fieldNumber) {
  if (!fields.has(fieldNumber)) return 0;
  const value = fields.get(fieldNumber);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid numeric telemetry field');
  return value;
}

function fmtTok(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
const fmtNum = (n) => (n || 0).toLocaleString('en-US');

// 通过比对 .db 与 .db-wal 的 mtimeMs + size 实现零开销增量感知
function getDbSignature(cascadeId) {
  if (typeof cascadeId !== 'string' || !CONVERSATION_ID_PATTERN.test(cascadeId)) return null;
  try {
    const dbPath = path.join(CONVERSATIONS_DIR, `${cascadeId}.db`);
    if (!fs.existsSync(dbPath)) return null;
    const st = fs.statSync(dbPath);
    const walPath = `${dbPath}-wal`;
    const walSig = fs.existsSync(walPath)
      ? `${fs.statSync(walPath).mtimeMs}:${fs.statSync(walPath).size}`
      : '0:0';
    return `${st.mtimeMs}:${st.size}|${walSig}`;
  } catch { return null; }
}

function readConversationMetrics(cascadeId) {
  if (typeof cascadeId !== 'string' || !CONVERSATION_ID_PATTERN.test(cascadeId)) return null;
  const sig = getDbSignature(cascadeId);
  if (!sig) return { cascadeId, hasData: false };
  const cached = metricsCache.get(cascadeId);
  if (cached && cached.sig === sig) return cached.payload;

  const dbPath = path.join(CONVERSATIONS_DIR, `${cascadeId}.db`);
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    if (!rows || rows.length === 0) {
      db.close(); db = null;
      const emptyPayload = { cascadeId, hasData: false, sig };
      metricsCache.set(cascadeId, { sig, payload: emptyPayload });
      return emptyPayload;
    }
    const userSteps = db.prepare('SELECT idx FROM steps WHERE step_type = 14 ORDER BY idx ASC').all();
    const plannerSteps = db.prepare('SELECT idx FROM steps WHERE step_type = 15 ORDER BY idx ASC').all();
    db.close(); db = null;

    const lastUserStepIdx = userSteps.length > 0 ? userSteps[userSteps.length - 1].idx : -1;
    let totalIn = 0, totalCache = 0, totalOut = 0, totalThink = 0, totalResp = 0;
    let turnSteps = 0, turnOut = 0, turnThink = 0, turnResp = 0, turnDur = 0;

    const parsed = rows.map((r, i) => {
      const top = parseProto(r.data);
      const chat = top.has(1) ? parseProto(top.get(1)) : new Map();
      const usage = chat.has(4) ? parseProto(chat.get(4)) : new Map();
      // 字段路径来自当前客户端 Protobuf 定义：chat_start_metadata.context_window_metadata。
      const chatStart = chat.has(9) ? parseProto(chat.get(9)) : new Map();
      const contextMetadata = chatStart.has(10) ? parseProto(chatStart.get(10)) : new Map();
      const recordedLimit = contextMetadata.get(4);
      const maxContextTokens = Number.isSafeInteger(recordedLimit) && recordedLimit > 0 ? recordedLimit : null;
      const estimatedContextTokens = contextMetadata.has(1) ? numericField(contextMetadata, 1) : null;
      const modelId = chat.has(3) ? numericField(chat, 3) : null;
      const ttftMap = chat.has(11) ? parseProto(chat.get(11)) : new Map();
      const streamMap = chat.has(12) ? parseProto(chat.get(12)) : new Map();

      const inTok = numericField(usage, 2), outTok = numericField(usage, 3), cacheRead = numericField(usage, 5);
      const thinkTok = numericField(usage, 9), respTok = numericField(usage, 10);
      const ttft = numericField(ttftMap, 1) + numericField(ttftMap, 2) / 1e9;
      const stream = numericField(streamMap, 1) + numericField(streamMap, 2) / 1e9;
      const stepIdx = plannerSteps[i] ? plannerSteps[i].idx : i;

      totalIn += inTok; totalCache += cacheRead; totalOut += outTok;
      totalThink += thinkTok; totalResp += respTok;
      if (stepIdx > lastUserStepIdx) {
        turnSteps += 1; turnOut += outTok; turnThink += thinkTok;
        turnResp += respTok; turnDur += (ttft + stream);
      }
      return { idx: r.idx, modelId, hasUsage:chat.has(4), inTok, outTok, cacheRead, ctx: inTok + cacheRead, maxContextTokens, estimatedContextTokens, thinkTok, respTok, ttft, stream, totDur: ttft + stream };
    });

    const last = parsed[parsed.length - 1];
    // An unfinished generation may have configuration but no reported usage yet.
    if (!last.hasUsage) {
      const payload = {cascadeId,hasData:false,sig};
      metricsCache.set(cascadeId,{sig,payload});
      return payload;
    }
    const streamTps = last.stream >= 0.25 ? (last.outTok / last.stream) : 0;
    const e2eTps = last.totDur > 0 ? (last.outTok / last.totDur) : 0;
    const displayTps = (streamTps > 0 && streamTps <= 600) ? streamTps : e2eTps;
    const lastCacheRate = last.ctx > 0 ? ((last.cacheRead / last.ctx) * 100).toFixed(1) : '0.0';
    const sessionCacheRate = (totalIn + totalCache) > 0 ? ((totalCache / (totalIn + totalCache)) * 100).toFixed(1) : '0.0';
    // 只使用同次调用记录的预算；不能用当前选中模型或固定值替代历史调用配置。
    const contextLabel = last.maxContextTokens
      ? `${fmtTok(last.ctx)}/${fmtTok(last.maxContextTokens)} (${Math.round(last.ctx / last.maxContextTokens * 100)}%)`
      : fmtTok(last.ctx);
    const contextBudget = last.maxContextTokens ? `${fmtNum(last.maxContextTokens)} tokens（客户端调用记录）` : '未获取';

    const inlineHtml = [
      `<span>${Math.round(displayTps)} tok/s</span><span class="ag-sep">·</span>`,
      `<span>TTFT ${last.ttft.toFixed(1)}s</span><span class="ag-sep">·</span>`,
      `<span>Ctx ${contextLabel}</span><span class="ag-sep">·</span>`,
      `<span>Out ${fmtTok(last.outTok)}</span>`
    ].join('');

    const turnRowHtml = turnSteps > 1
      ? `<div class="ag-tt-row"><span class="ag-tt-lbl">本轮合计 (${turnSteps}步)</span><span class="ag-tt-val">输出 ${fmtNum(turnOut)} (思考 ${fmtNum(turnThink)} + 响应 ${fmtNum(turnResp)}) | 耗时 ${turnDur.toFixed(1)}s</span></div>`
      : '';

    const tooltipHtml = [
      `<div class="ag-tt-hdr">本轮最新调用 (Gen #${last.idx + 1})</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">${streamTps > 0 && streamTps <= 600 ? `流式 ${streamTps.toFixed(1)} tok/s | ` : ''}端到端 ${e2eTps.toFixed(1)} tok/s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">响应耗时</span><span class="ag-tt-val">TTFT ${last.ttft.toFixed(2)}s | 流式 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">最近调用上下文</span><span class="ag-tt-val">${fmtNum(last.ctx)} (新增 ${fmtNum(last.inTok)} + 缓存 ${fmtNum(last.cacheRead)}, ${lastCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">本步输出量</span><span class="ag-tt-val">${fmtNum(last.outTok)} (思考链 ${fmtNum(last.thinkTok)} + 正文/工具 ${fmtNum(last.respTok)})</span></div>`,
      turnRowHtml,
      `<div class="ag-tt-hdr ag-tt-sec">当前会话累计 (${userSteps.length} 轮提问 / ${parsed.length} 次模型调用)</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">最近调用上下文预算</span><span class="ag-tt-val">${contextBudget}</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输入量</span><span class="ag-tt-val">新增 ${fmtTok(totalIn)} + 缓存读取 ${fmtTok(totalCache)} (命中率 ${sessionCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(totalOut)} (思考链 ${fmtTok(totalThink)} + 正文/工具 ${fmtTok(totalResp)})</span></div>`
    ].join('');

    const payload = { cascadeId, hasData: true, sig, inlineHtml, tooltipHtml,
      generationIndex: last.idx ?? null, modelId: last.modelId,
      contextTokens: last.ctx, maxContextTokens: last.maxContextTokens,
      estimatedContextTokens: last.estimatedContextTokens,
      contextLimitSource: last.maxContextTokens ? 'ChatStartMetadata.context_window_metadata.max_context_tokens' : null };
    metricsCache.set(cascadeId, { sig, payload });
    return payload;
  } catch {
    if (db) { try { db.close(); } catch {} }
    return null;
  }
}

async function pushMetricsToSession(session, cascadeId, force = false) {
  if (!session || session.ws?.readyState !== 1 || !cascadeId) return;
  try {
    const sig = getDbSignature(cascadeId) || 'empty';
    const sessionKey = `${cascadeId}@${sig}`;
    if (!force && session.lastPushedSig === sessionKey) return;
    const payload = readConversationMetrics(cascadeId);
    if (!payload) return;
    await sendCDP(session, 'Runtime.evaluate', {
      expression: `window.__ag_render_metrics && window.__ag_render_metrics(${JSON.stringify(payload)})`,
      returnByValue: false
    });
    // A failed push must remain retryable even when the underlying database has not changed.
    session.lastPushedSig = sessionKey;
  } catch {}
}

async function syncMetricsForSession(session) {
  if (!session || session.isInjecting || session.ws?.readyState !== 1) return;
  try {
    const res = await sendCDP(session, 'Runtime.evaluate', {
      expression: 'window.__ag_watched_cascade_id || ""',
      returnByValue: true
    });
    const cid = res?.result?.value;
    if (cid) await pushMetricsToSession(session, cid, false);
  } catch {}
}

async function syncAllMetrics() {
  for (const session of activeSockets.values()) {
    await syncMetricsForSession(session);
  }
}
