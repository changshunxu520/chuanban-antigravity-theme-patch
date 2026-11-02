(() => {
  'use strict';
  const VERSION = '20261102-gemini4-context-v4';
  const CONTEXT_WINDOW = 1048576;
  const RPC_PATH = '/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage';
  const GEMINI_MODELS = new Set([1417,1418,1419,'1417','1418','1419','MODEL_PLACEHOLDER_M417','MODEL_PLACEHOLDER_M418','MODEL_PLACEHOLDER_M419']);
  if (window.__agGeminiContext?.version === VERSION) return;
  window.__agGeminiContext?.uninstall?.();
  const originalFetch = window.fetch;
  const originalSend = WebSocket.prototype.send;
  const state = {version:VERSION,windowTokens:CONTEXT_WINDOW,applied:0,lastApplied:null};

  /** Apply the default only to explicitly identified Gemini 4 requests; preserve other settings. */
  function updateRequest(payload, transport) {
    if (!payload || typeof payload !== 'object') return false;
    const planner = payload.cascadeConfig?.plannerConfig;
    const model = planner?.planModel ?? planner?.requestedModel?.model;
    if (!GEMINI_MODELS.has(model)) return false;
    const checkpoint = payload.cascadeConfig.checkpointConfig || {};
    // A future explicit UI window choice takes precedence over this local default.
    if (checkpoint.contextWindow && checkpoint.contextWindow !== 'Default') return false;
    payload.cascadeConfig.checkpointConfig = {...checkpoint,maxTokenLimit:CONTEXT_WINDOW};
    delete payload.cascadeConfig.checkpointConfig.contextWindow;
    state.applied += 1;
    // Diagnostics retain only model and conversation identifiers, never prompts or credentials.
    state.lastApplied = {model,cascadeId:payload.cascadeId,transport,windowTokens:CONTEXT_WINDOW};
    return true;
  }

  /** Restrict interception to the installed client's same-origin message RPC. */
  function isMessageRequest(input) {
    try {
      const url = new URL(input instanceof Request ? input.url : input,location.href);
      return url.origin === location.origin && url.pathname === RPC_PATH;
    } catch { return false; }
  }

  /** Support the normal HTTP fallback without consuming the caller's original request body. */
  async function patchedFetch(input, options) {
    if (!isMessageRequest(input)) return originalFetch.call(this,input,options);
    const request = new Request(input instanceof Request ? input.clone() : input,options);
    const contentType = request.headers.get('content-type') || '';
    if (request.method !== 'POST' || !/application\/(?:(?:connect|grpc-web)\+)?json/.test(contentType)) {
      return originalFetch.call(this,input,options);
    }
    // Connect and gRPC-Web JSON wrap each message in a flag byte and a four-byte length.
    if (contentType.includes('application/connect+json') || contentType.includes('application/grpc-web+json')) {
      const bytes = new Uint8Array(await request.clone().arrayBuffer());
      const frames = [];
      let offset = 0;
      let changed = false;
      try {
        while (offset < bytes.length) {
          if (offset + 5 > bytes.length) throw new Error('Incomplete Connect frame');
          const length = new DataView(bytes.buffer,bytes.byteOffset + offset + 1,4).getUint32(0);
          if (offset + 5 + length > bytes.length) throw new Error('Incomplete Connect payload');
          let frame = bytes.slice(offset,offset + 5 + length);
          // Compressed frames and stream trailers retain their original bytes.
          if (bytes[offset] === 0) {
            const payload = JSON.parse(new TextDecoder().decode(frame.subarray(5)));
            if (updateRequest(payload,contentType.includes('grpc-web') ? 'http-grpc-web' : 'http-connect')) {
              const encoded = new TextEncoder().encode(JSON.stringify(payload));
              frame = new Uint8Array(5 + encoded.length);
              new DataView(frame.buffer).setUint32(1,encoded.length);
              frame.set(encoded,5);
              changed = true;
            }
          }
          frames.push(frame);
          offset += 5 + length;
        }
      } catch { return originalFetch.call(this,input,options); }
      if (!changed) return originalFetch.call(this,input,options);
      const body = new Uint8Array(frames.reduce((total,frame)=>total+frame.length,0));
      offset = 0;
      for (const frame of frames) {body.set(frame,offset);offset+=frame.length;}
      return originalFetch.call(this,new Request(request,{body}));
    }
    let payload;
    try { payload=JSON.parse(await request.clone().text()); }
    catch { return originalFetch.call(this,input,options); }
    if (!updateRequest(payload,'http')) return originalFetch.call(this,input,options);
    return originalFetch.call(this,new Request(request,{body:JSON.stringify(payload)}));
  }

  /** Support the client's multiplexed JSON WebSocket RPC transport, including existing sockets. */
  function patchedSend(data) {
    try {
      const url = new URL(this.url);
      if (url.host === location.host && url.pathname === '/connect-websocket' && typeof data === 'string') {
        const frame = JSON.parse(data);
        if (frame.type === 'start' && frame.procedure === RPC_PATH && updateRequest(frame.payload,'websocket')) {
          data = JSON.stringify(frame);
        }
      }
    } catch { /* Non-JSON frames and unrelated sockets must pass through unchanged. */ }
    return originalSend.call(this,data);
  }

  /** Restore only wrappers owned by this module; do not disturb later client hooks. */
  state.uninstall = () => {
    if (window.fetch === patchedFetch) window.fetch = originalFetch;
    if (WebSocket.prototype.send === patchedSend) WebSocket.prototype.send = originalSend;
    if (window.__agGeminiContext === state) delete window.__agGeminiContext;
  };
  window.fetch = patchedFetch;
  WebSocket.prototype.send = patchedSend;
  window.__agGeminiContext = state;
})();
