'use strict';

class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseRequest(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (err) {
    return {
      ok: false,
      id: null,
      code: 'bad_json',
      message: 'Expected one JSON object per line'
    };
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { ok: false, id: null, code: 'bad_request', message: 'Request must be a JSON object' };
  }
  if (typeof message.id !== 'string' && typeof message.id !== 'number') {
    return { ok: false, id: null, code: 'bad_request', message: 'Request id is required' };
  }
  if (typeof message.method !== 'string' || message.method.length === 0) {
    return {
      ok: false,
      id: String(message.id),
      code: 'bad_request',
      message: 'Request method is required'
    };
  }
  const params = message.params === undefined ? {} : message.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {
      ok: false,
      id: String(message.id),
      code: 'bad_request',
      message: 'Params must be an object'
    };
  }
  return {
    ok: true,
    request: {
      id: String(message.id),
      method: message.method,
      params
    }
  };
}

function okLine(id, result) {
  return JSON.stringify({ id, ok: true, result });
}

function errorLine(id, code, message) {
  return JSON.stringify({
    id,
    ok: false,
    error: { code, message }
  });
}

module.exports = {
  CommandError,
  parseRequest,
  okLine,
  errorLine
};
