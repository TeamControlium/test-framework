import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';

import { APIUtils } from '@controlium/utils';

import { API_AUTWrapper } from './API_AUTWrapper';

// ─── Mock @controlium/utils ───────────────────────────────────────────────────

vi.mock('@controlium/utils', () => ({
  Log: { writeLine: vi.fn() },
  LogLevels: {
    Maximum: Number.MAX_SAFE_INTEGER,
    Verbose: Number.MAX_SAFE_INTEGER,
    FrameworkDebug: 6,
    FrameworkInformation: 5,
    TestDebug: 4,
    TestInformation: 3,
    Warning: 2,
    Error: 1,
    NoOutput: 0,
  },
  Utils: {
    isUndefined:       (val: unknown): val is undefined        => val === undefined,
    isNullOrUndefined: (val: unknown): val is null | undefined => val === null || val === undefined,
  },
  APIUtils: {
    performHTTPOperation: vi.fn(),
    APPLICATION_JSON: 'application/json',
  },
}));

const mockPerform = vi.mocked(APIUtils.performHTTPOperation);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_PORT    = 14000;
const RAW_SERVER_PORT = 14001;

/** Shorthand for a successful HTTP response */
const makeResponse = (
  status  = 200,
  body    = '{"ok":true}',
  headers: Record<string, string> = {},
): APIUtils.HTTPResponse => ({
  status,
  statusMessage: status === 200 ? 'OK' : String(status),
  headers,
  body,
});

/** Creates a minimal stub AUT handle (no real server) */
function makeStubAUT(options: { getUrlResult?: string; closeShouldFail?: boolean } = {}): API_AUTWrapper.AUT {
  return {
    close:  options.closeShouldFail
      ? vi.fn().mockRejectedValue(new Error('close failed'))
      : vi.fn().mockResolvedValue(undefined),
    getUrl: options.getUrlResult === ''
      ? vi.fn().mockResolvedValue('')
      : vi.fn().mockResolvedValue(options.getUrlResult ?? `http://localhost:${DEFAULT_PORT}`),
  };
}

/** Creates a stub bootstrapper — optionally fails at startup */
function makeStubBootstrapper(options: {
  aut?: API_AUTWrapper.AUT;
  failToStart?: boolean;
} = {}): API_AUTWrapper.Bootstrapper {
  const aut = options.aut ?? makeStubAUT();
  return options.failToStart
    ? vi.fn().mockRejectedValue(new Error('Bootstrap failed'))
    : vi.fn().mockResolvedValue(aut);
}

/**
 * Creates a real Node.js HTTP server bootstrapper.
 * The handler defaults to returning 200 {"ok":true}.
 */
function makeRawBootstrapper(
  handler?: (req: IncomingMessage, res: ServerResponse) => void
): API_AUTWrapper.Bootstrapper {
  return async (port: number): Promise<API_AUTWrapper.AUT> => {
    const server = createServer(handler ?? ((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    }));
    await new Promise<void>((resolve) => server.listen(port, resolve));
    return {
      close:  () => new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
      getUrl: async () => `http://localhost:${port}`,
    };
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('API_AUTWrapper', () => {

  beforeEach(async () => {
    await API_AUTWrapper.reset();
    API_AUTWrapper.port = DEFAULT_PORT;
    mockPerform.mockReset();
  });

  afterEach(async () => {
    // Ensure any running AUT (including real servers) is closed after each test
    await API_AUTWrapper.close();
  });

  // ─── Lifecycle: stub bootstrapper ──────────────────────────────────────────

  describe('Lifecycle — stub bootstrapper', () => {

    it('starts when bootstrapper is passed to startApplication', async () => {
      await API_AUTWrapper.startApplication({
        appName: 'TestApp',
        bootstrapper: makeStubBootstrapper(),
      });
      expect(API_AUTWrapper.isControlled).toBe(true);
      expect(API_AUTWrapper.appName).toBe('TestApp');
    });

    it('starts when bootstrapper was pre-set via the bootstrap setter', async () => {
      API_AUTWrapper.bootstrap = makeStubBootstrapper();
      await API_AUTWrapper.startApplication({ appName: 'TestApp' });
      expect(API_AUTWrapper.isControlled).toBe(true);
    });

    it('startApplication bootstrapper argument takes priority over pre-set bootstrap', async () => {
      const preSet   = makeStubBootstrapper();
      const explicit = makeStubBootstrapper();
      API_AUTWrapper.bootstrap = preSet;
      await API_AUTWrapper.startApplication({ appName: 'TestApp', bootstrapper: explicit });
      expect(vi.mocked(explicit)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(preSet)).not.toHaveBeenCalled();
    });

    it('throws when no bootstrapper has been set', async () => {
      await expect(
        API_AUTWrapper.startApplication({ appName: 'TestApp' })
      ).rejects.toThrow(/No bootstrapper set/);
    });

    it('throws when port has not been set', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (API_AUTWrapper as any)['_port'] = undefined;
      await expect(
        API_AUTWrapper.startApplication({ appName: 'TestApp', bootstrapper: makeStubBootstrapper() })
      ).rejects.toThrow(/No port set/);
    });

    it('throws when host is not localhost', async () => {
      API_AUTWrapper.host = 'remote.example.com';
      await expect(
        API_AUTWrapper.startApplication({ appName: 'TestApp', bootstrapper: makeStubBootstrapper() })
      ).rejects.toThrow(/must be 'localhost'/);
    });

    it('propagates bootstrapper failure and leaves isControlled false', async () => {
      await expect(
        API_AUTWrapper.startApplication({
          appName: 'TestApp',
          bootstrapper: makeStubBootstrapper({ failToStart: true }),
        })
      ).rejects.toThrow('Bootstrap failed');
      expect(API_AUTWrapper.isControlled).toBe(false);
    });

    it('closes the previous instance before starting a new one', async () => {
      const firstBootstrapper  = makeStubBootstrapper();
      const secondBootstrapper = makeStubBootstrapper();
      await API_AUTWrapper.startApplication({ appName: 'TestApp', bootstrapper: firstBootstrapper });
      await API_AUTWrapper.startApplication({ appName: 'TestApp', bootstrapper: secondBootstrapper });
      expect(vi.mocked(firstBootstrapper)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(secondBootstrapper)).toHaveBeenCalledTimes(1);
      expect(API_AUTWrapper.isControlled).toBe(true);
    });

    it('close resets isControlled and removes the instance', async () => {
      await API_AUTWrapper.startApplication({ appName: 'TestApp', bootstrapper: makeStubBootstrapper() });
      await API_AUTWrapper.close();
      expect(API_AUTWrapper.isControlled).toBe(false);
      expect(() => API_AUTWrapper.instance).toThrow(/has not been started/);
    });

    it('close is safe when nothing is running', async () => {
      await expect(API_AUTWrapper.close()).resolves.not.toThrow();
    });

    it('propagates AUT close() failure', async () => {
      const aut = makeStubAUT({ closeShouldFail: true });
      await API_AUTWrapper.startApplication({
        appName: 'TestApp',
        bootstrapper: makeStubBootstrapper({ aut }),
      });
      await expect(API_AUTWrapper.close()).rejects.toThrow('close failed');
    });

    it('instance getter throws when AUT has not been started', () => {
      expect(() => API_AUTWrapper.instance).toThrow(/has not been started/);
    });
  });

  // ─── Lifecycle: raw HTTP server bootstrapper ───────────────────────────────

  describe('Lifecycle — raw HTTP server bootstrapper', () => {

    beforeEach(() => { API_AUTWrapper.port = RAW_SERVER_PORT; });

    it('starts a real Node.js HTTP server and reports live', async () => {
      await API_AUTWrapper.startApplication({
        appName: 'RawApp',
        bootstrapper: makeRawBootstrapper(),
      });
      expect(API_AUTWrapper.isControlled).toBe(true);
      await expect(API_AUTWrapper.instance.isLive()).resolves.toBe(true);
    });

    it('autURL returns the correct URL from the real server', async () => {
      await API_AUTWrapper.startApplication({
        appName: 'RawApp',
        bootstrapper: makeRawBootstrapper(),
      });
      await expect(API_AUTWrapper.instance.autURL()).resolves.toBe(`http://localhost:${RAW_SERVER_PORT}`);
    });

    it('closes the real server cleanly', async () => {
      await API_AUTWrapper.startApplication({
        appName: 'RawApp',
        bootstrapper: makeRawBootstrapper(),
      });
      await expect(API_AUTWrapper.close()).resolves.not.toThrow();
      expect(API_AUTWrapper.isControlled).toBe(false);
    });
  });

  // ─── isLive / autURL edge cases ────────────────────────────────────────────

  describe('isLive / autURL', () => {

    it('isLive returns false when _aut is not set', async () => {
      const wrapper = new API_AUTWrapper();
      await expect(wrapper.isLive()).resolves.toBe(false);
    });

    it('isLive returns false when getUrl returns empty string', async () => {
      await API_AUTWrapper.startApplication({
        appName: 'TestApp',
        bootstrapper: makeStubBootstrapper({ aut: makeStubAUT({ getUrlResult: '' }) }),
      });
      await expect(API_AUTWrapper.instance.isLive()).resolves.toBe(false);
    });

    it('isLive returns false when getUrl throws', async () => {
      const aut: API_AUTWrapper.AUT = {
        close:  vi.fn().mockResolvedValue(undefined),
        getUrl: vi.fn().mockRejectedValue(new Error('getUrl exploded')),
      };
      await API_AUTWrapper.startApplication({
        appName: 'TestApp',
        bootstrapper: makeStubBootstrapper({ aut }),
      });
      await expect(API_AUTWrapper.instance.isLive()).resolves.toBe(false);
    });

    it('autURL throws when _aut is not set', async () => {
      const wrapper = new API_AUTWrapper();
      await expect(wrapper.autURL()).rejects.toThrow(/is not running/);
    });

    it('autURL propagates getUrl() errors', async () => {
      const aut: API_AUTWrapper.AUT = {
        close:  vi.fn().mockResolvedValue(undefined),
        getUrl: vi.fn().mockRejectedValue(new Error('getUrl exploded')),
      };
      await API_AUTWrapper.startApplication({
        appName: 'TestApp',
        bootstrapper: makeStubBootstrapper({ aut }),
      });
      await expect(API_AUTWrapper.instance.autURL()).rejects.toThrow(/getUrl\(\) threw/);
    });
  });

  // ─── Header management ─────────────────────────────────────────────────────

  describe('Header management', () => {

    it('setHeaders replaces all existing headers', () => {
      API_AUTWrapper.mergeHeaders({ existing: 'old' });
      API_AUTWrapper.setHeaders({ 'x-new': 'header' });
      expect(API_AUTWrapper.getHeaders()).toEqual({ 'x-new': 'header' });
    });

    it('mergeHeaders adds to existing headers', () => {
      API_AUTWrapper.setHeaders({ a: '1' });
      API_AUTWrapper.mergeHeaders({ b: '2' });
      expect(API_AUTWrapper.getHeaders()).toEqual({ a: '1', b: '2' });
    });

    it('mergeHeaders overwrites matching keys', () => {
      API_AUTWrapper.setHeaders({ token: 'old' });
      API_AUTWrapper.mergeHeaders({ token: 'new' });
      expect(API_AUTWrapper.getHeaders()['token']).toBe('new');
    });

    it('clearHeaders empties the header set', () => {
      API_AUTWrapper.setHeaders({ a: '1' });
      API_AUTWrapper.clearHeaders();
      expect(API_AUTWrapper.getHeaders()).toEqual({});
    });

    it('getHeaders returns a copy — external mutations do not affect wrapper state', () => {
      API_AUTWrapper.setHeaders({ a: '1' });
      const copy = API_AUTWrapper.getHeaders();
      copy['b'] = '2';
      expect(API_AUTWrapper.getHeaders()).toEqual({ a: '1' });
    });

    it('close clears headers', async () => {
      API_AUTWrapper.setHeaders({ a: '1' });
      await API_AUTWrapper.close();
      expect(API_AUTWrapper.getHeaders()).toEqual({});
    });
  });

  // ─── Transaction recording ─────────────────────────────────────────────────

  describe('Transaction recording', () => {

    it('transactions is empty before any requests', () => {
      expect(API_AUTWrapper.transactions).toHaveLength(0);
    });

    it('lastTransaction throws when no transactions recorded', () => {
      expect(() => API_AUTWrapper.lastTransaction).toThrow(/No HTTP transactions/);
    });

    it('lastResponse throws when no transactions recorded', () => {
      expect(() => API_AUTWrapper.lastResponse).toThrow(/No HTTP transactions/);
    });

    it('clearTransactions empties the transaction list', async () => {
      mockPerform.mockResolvedValue(makeResponse());
      await API_AUTWrapper.request('GET', '/test');
      API_AUTWrapper.clearTransactions();
      expect(API_AUTWrapper.transactions).toHaveLength(0);
    });

    it('close clears transactions', async () => {
      mockPerform.mockResolvedValue(makeResponse());
      await API_AUTWrapper.request('GET', '/test');
      await API_AUTWrapper.close();
      expect(API_AUTWrapper.transactions).toHaveLength(0);
    });
  });

  // ─── request() ─────────────────────────────────────────────────────────────

  describe('request()', () => {

    beforeEach(() => {
      mockPerform.mockResolvedValue(makeResponse());
    });

    it('throws immediately when port is not set', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (API_AUTWrapper as any)['_port'] = undefined;
      await expect(API_AUTWrapper.request('GET', '/test')).rejects.toThrow(/port is not set/);
    });

    it('passes correct HTTP method to performHTTPOperation', async () => {
      await API_AUTWrapper.request('DELETE', '/items/1');
      const [req] = mockPerform.mock.calls[0];
      expect(req.method).toBe('DELETE');
    });

    it('passes correct resource path to performHTTPOperation', async () => {
      await API_AUTWrapper.request('GET', '/api/users');
      const [req] = mockPerform.mock.calls[0];
      expect(req.resourcePath).toBe('/api/users');
    });

    it('builds host string from wrapper host and port', async () => {
      await API_AUTWrapper.request('GET', '/');
      const [req] = mockPerform.mock.calls[0];
      expect(req.host).toBe(`localhost:${DEFAULT_PORT}`);
    });

    it('passes protocol, proxy and timeout to the HTTP request', async () => {
      API_AUTWrapper.protocol = 'https';
      API_AUTWrapper.proxy    = 'http://proxy:8080';
      API_AUTWrapper.timeout  = 5_000;
      await API_AUTWrapper.request('GET', '/');
      const [req] = mockPerform.mock.calls[0];
      expect(req.protocol).toBe('https');
      expect(req.proxy).toBe('http://proxy:8080');
      expect(req.timeout).toBe(5_000);
    });

    it('prepends resourcePathPreamble to the path', async () => {
      API_AUTWrapper.resourcePathPreamble = '/api/v2';
      await API_AUTWrapper.request('GET', '/users');
      const [req] = mockPerform.mock.calls[0];
      expect(req.resourcePath).toBe('/api/v2/users');
    });

    it('merges session headers into the request', async () => {
      API_AUTWrapper.setHeaders({ 'x-session': 'abc' });
      await API_AUTWrapper.request('GET', '/');
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['x-session']).toBe('abc');
    });

    it('merges per-request headers on top of session headers', async () => {
      API_AUTWrapper.setHeaders({ 'x-session': 'abc' });
      await API_AUTWrapper.request('GET', '/', { headers: { 'x-request': 'xyz' } });
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['x-session']).toBe('abc');
      expect(req.headers['x-request']).toBe('xyz');
    });

    it('per-request headers override session headers for matching keys', async () => {
      API_AUTWrapper.setHeaders({ 'x-token': 'session' });
      await API_AUTWrapper.request('GET', '/', { headers: { 'x-token': 'request' } });
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['x-token']).toBe('request');
    });

    it('infers Content-Type: application/json for an object body', async () => {
      await API_AUTWrapper.request('POST', '/', { body: { foo: 'bar' } });
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['Content-Type']).toBe('application/json');
    });

    it('infers Content-Type: application/json for a JSON string body', async () => {
      await API_AUTWrapper.request('POST', '/', { body: '{"foo":"bar"}' });
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['Content-Type']).toBe('application/json');
    });

    it('infers Content-Type: application/json for a JSON array string body', async () => {
      await API_AUTWrapper.request('POST', '/', { body: '[1,2,3]' });
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['Content-Type']).toBe('application/json');
    });

    it('does not override an explicit Content-Type when body is JSON', async () => {
      await API_AUTWrapper.request('POST', '/', {
        headers: { 'Content-Type': 'text/plain' },
        body: { foo: 'bar' },
      });
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['Content-Type']).toBe('text/plain');
    });

    it('does not set Content-Type for a plain-text string body', async () => {
      await API_AUTWrapper.request('POST', '/', { body: 'plain text' });
      const [req] = mockPerform.mock.calls[0];
      expect(req.headers['Content-Type']).toBeUndefined();
    });

    it('records a successful transaction', async () => {
      mockPerform.mockResolvedValueOnce(makeResponse(201, '{"id":1}'));
      await API_AUTWrapper.request('POST', '/items');
      expect(API_AUTWrapper.transactions).toHaveLength(1);
      expect(API_AUTWrapper.transactions[0].response?.status).toBe(201);
      expect(API_AUTWrapper.transactions[0].error).toBeUndefined();
    });

    it('lastResponse returns the response from the last successful transaction', async () => {
      mockPerform.mockResolvedValueOnce(makeResponse(200, '{"data":"x"}'));
      await API_AUTWrapper.request('GET', '/data');
      expect(API_AUTWrapper.lastResponse.status).toBe(200);
      expect(API_AUTWrapper.lastResponse.body).toBe('{"data":"x"}');
    });

    it('records multiple transactions in order and lastResponse reflects the latest', async () => {
      mockPerform
        .mockResolvedValueOnce(makeResponse(200))
        .mockResolvedValueOnce(makeResponse(404));
      await API_AUTWrapper.request('GET', '/a');
      await API_AUTWrapper.request('GET', '/b');
      expect(API_AUTWrapper.transactions).toHaveLength(2);
      expect(API_AUTWrapper.lastResponse.status).toBe(404);
    });

    it('records a failed transaction without throwing when AUT does not respond', async () => {
      mockPerform.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(API_AUTWrapper.request('GET', '/crash')).resolves.not.toThrow();
      expect(API_AUTWrapper.transactions).toHaveLength(1);
      expect(API_AUTWrapper.transactions[0].response).toBeUndefined();
      expect(API_AUTWrapper.transactions[0].error).toContain('ECONNREFUSED');
    });

    it('lastResponse throws when the last transaction has no response', async () => {
      mockPerform.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await API_AUTWrapper.request('GET', '/crash');
      expect(() => API_AUTWrapper.lastResponse).toThrow(/AUT may have crashed/);
    });

    it('lastTransaction.error contains the error message from a failed request', async () => {
      mockPerform.mockRejectedValueOnce(new Error('connection reset'));
      await API_AUTWrapper.request('GET', '/unstable');
      expect(API_AUTWrapper.lastTransaction.error).toContain('connection reset');
    });

    it('a failed request followed by a successful one does not pollute lastResponse', async () => {
      mockPerform
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(makeResponse(200));
      await API_AUTWrapper.request('GET', '/crash');
      await API_AUTWrapper.request('GET', '/ok');
      expect(API_AUTWrapper.lastResponse.status).toBe(200);
    });
  });
});
