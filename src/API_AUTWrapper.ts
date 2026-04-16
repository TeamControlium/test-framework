// NOTE: Requires APIUtils to be exported from @controlium/utils.
// It exists in the utils source (src/apiUtils/APIUtils.ts) but is not yet in the package index.

import { APIUtils, Log, LogLevels, Utils } from '@controlium/utils';

export class API_AUTWrapper {

  // ─── Static configuration ─────────────────────────────────────────────────

  private static _appName: string = 'AUT';
  private static _host: string = 'localhost';
  private static _port?: number;
  private static _protocol: 'http' | 'https' = 'http';
  private static _timeout: number = 30_000;
  private static _proxy?: string;
  private static _resourcePathPreamble?: string;
  private static _headers: APIUtils.HTTPHeaders = {};

  // ─── Static state ─────────────────────────────────────────────────────────

  private static _bootstrapper?: API_AUTWrapper.Bootstrapper;
  private static _instance?: API_AUTWrapper;
  private static _isControlled: boolean = false;
  private static _transactions: API_AUTWrapper.Transaction[] = [];

  // ─── Instance state ───────────────────────────────────────────────────────

  private _aut?: API_AUTWrapper.AUT;
  private _bootstrapper?: API_AUTWrapper.Bootstrapper;

  // ─── Config: appName ──────────────────────────────────────────────────────

  public static set appName(value: string) {
    API_AUTWrapper._appName = value;
  }
  public static get appName(): string {
    return API_AUTWrapper._appName;
  }

  // ─── Config: host ─────────────────────────────────────────────────────────

  public static set host(value: string) {
    API_AUTWrapper._host = value;
  }
  public static get host(): string {
    return API_AUTWrapper._host;
  }

  // ─── Config: port ─────────────────────────────────────────────────────────

  public static set port(value: number) {
    API_AUTWrapper._port = value;
  }
  public static get port(): number | undefined {
    return API_AUTWrapper._port;
  }

  // ─── Config: protocol ─────────────────────────────────────────────────────

  public static set protocol(value: 'http' | 'https') {
    API_AUTWrapper._protocol = value;
  }
  public static get protocol(): 'http' | 'https' {
    return API_AUTWrapper._protocol;
  }

  // ─── Config: timeout ──────────────────────────────────────────────────────

  public static set timeout(value: number) {
    API_AUTWrapper._timeout = value;
  }
  public static get timeout(): number {
    return API_AUTWrapper._timeout;
  }

  // ─── Config: proxy ────────────────────────────────────────────────────────

  public static set proxy(value: string | undefined) {
    API_AUTWrapper._proxy = value;
  }
  public static get proxy(): string | undefined {
    return API_AUTWrapper._proxy;
  }

  // ─── Config: resourcePathPreamble ─────────────────────────────────────────

  public static set resourcePathPreamble(value: string | undefined) {
    API_AUTWrapper._resourcePathPreamble = value;
  }
  public static get resourcePathPreamble(): string | undefined {
    return API_AUTWrapper._resourcePathPreamble;
  }

  // ─── Config: bootstrap (pre-set before startApplication) ─────────────────

  public static set bootstrap(value: API_AUTWrapper.Bootstrapper) {
    API_AUTWrapper._bootstrapper = value;
  }

  // ─── State: isControlled ──────────────────────────────────────────────────

  public static get isControlled(): boolean {
    return API_AUTWrapper._isControlled;
  }

  // ─── State: instance ──────────────────────────────────────────────────────

  public static get instance(): API_AUTWrapper {
    if (Utils.isUndefined(API_AUTWrapper._instance)) {
      const errText = `[${API_AUTWrapper._appName}] has not been started — call startApplication first`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }
    return API_AUTWrapper._instance as API_AUTWrapper;
  }

  // ─── Headers ──────────────────────────────────────────────────────────────

  /**
   * Replaces all current request headers with the provided set.
   */
  public static setHeaders(headers: APIUtils.HTTPHeaders): void {
    API_AUTWrapper._headers = { ...headers };
    Log.writeLine(LogLevels.FrameworkInformation, `[${API_AUTWrapper._appName}] request headers set to:\n${JSON.stringify(API_AUTWrapper._headers, null, 2)}`, { suppressMultilinePreamble: true });
  }

  /**
   * Merges the provided headers into the current set, overwriting any matching keys.
   */
  public static mergeHeaders(headers: APIUtils.HTTPHeaders): void {
    API_AUTWrapper._headers = { ...API_AUTWrapper._headers, ...headers };
    Log.writeLine(LogLevels.FrameworkInformation, `[${API_AUTWrapper._appName}] request headers merged to:\n${JSON.stringify(API_AUTWrapper._headers, null, 2)}`, { suppressMultilinePreamble: true });
  }

  public static clearHeaders(): void {
    API_AUTWrapper._headers = {};
    Log.writeLine(LogLevels.FrameworkDebug, `[${API_AUTWrapper._appName}] request headers cleared`);
  }

  public static getHeaders(): APIUtils.HTTPHeaders {
    return { ...API_AUTWrapper._headers };
  }

  // ─── Transactions ─────────────────────────────────────────────────────────

  /**
   * All recorded HTTP transactions (requests and their outcomes) for this AUT session.
   * A transaction with no `response` and a populated `error` indicates the AUT did not respond
   * (e.g. it crashed or was not reachable).
   */
  public static get transactions(): ReadonlyArray<API_AUTWrapper.Transaction> {
    return API_AUTWrapper._transactions;
  }

  /**
   * The most recent transaction. Throws if no requests have been made.
   */
  public static get lastTransaction(): API_AUTWrapper.Transaction {
    if (API_AUTWrapper._transactions.length === 0) {
      const errText = `No HTTP transactions recorded for [${API_AUTWrapper._appName}]`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }
    return API_AUTWrapper._transactions[API_AUTWrapper._transactions.length - 1];
  }

  /**
   * The HTTP response from the most recent transaction.
   * Throws if there is no response — either no requests have been made, or the AUT did not respond.
   */
  public static get lastResponse(): APIUtils.HTTPResponse {
    const last = API_AUTWrapper.lastTransaction;
    if (Utils.isUndefined(last.response)) {
      const errText = `[${API_AUTWrapper._appName}] last transaction has no response — AUT may have crashed. Error: ${last.error ?? 'unknown'}`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }
    return last.response as APIUtils.HTTPResponse;
  }

  public static clearTransactions(): void {
    API_AUTWrapper._transactions.length = 0;
    Log.writeLine(LogLevels.FrameworkDebug, `[${API_AUTWrapper._appName}] transactions cleared`);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Closes any running AUT, resets all session state, then starts the application.
   *
   * The caller is responsible for setting host, port, protocol, timeout etc. before
   * calling this method (typically done in a Cucumber Before hook or equivalent).
   * Dotenv loading and any parallel-worker port offset should also be applied by the
   * caller before invoking this.
   */
  public static async startApplication(appDetails: {
    appName: string;
    bootstrapper?: API_AUTWrapper.Bootstrapper;
  }): Promise<void> {
    await API_AUTWrapper.close();

    API_AUTWrapper._appName = appDetails.appName;
    Log.writeLine(LogLevels.FrameworkInformation, `Preparing to start [${API_AUTWrapper._appName}]`);

    API_AUTWrapper._instance = new API_AUTWrapper(appDetails.bootstrapper ?? API_AUTWrapper._bootstrapper);
    await API_AUTWrapper._instance.startAUT();
  }

  /**
   * Closes the AUT (if running), resets all session state, and restores all
   * configuration properties to their default values.
   * Safe to call when nothing is running.
   */
  public static async reset(): Promise<void> {
    await API_AUTWrapper.close();
    API_AUTWrapper._bootstrapper = undefined;
    API_AUTWrapper._appName      = 'AUT';
    API_AUTWrapper._host         = 'localhost';
    API_AUTWrapper._port         = undefined;
    API_AUTWrapper._protocol     = 'http';
    API_AUTWrapper._timeout      = 30_000;
    API_AUTWrapper._proxy        = undefined;
    Log.writeLine(LogLevels.FrameworkDebug, 'API_AUTWrapper reset to defaults');
  }

  /**
   * Closes the AUT (if running) and resets all session state.
   * Configuration properties (host, port, protocol etc.) are preserved.
   * Safe to call when nothing is running.
   */
  public static async close(): Promise<void> {
    API_AUTWrapper.clearTransactions();
    API_AUTWrapper.clearHeaders();
    API_AUTWrapper._resourcePathPreamble = undefined;
    API_AUTWrapper._isControlled = false;

    if (!Utils.isUndefined(API_AUTWrapper._instance)) {
      Log.writeLine(LogLevels.FrameworkDebug, `Closing [${API_AUTWrapper._appName}]`);
      await API_AUTWrapper._instance.closeAUT();
      API_AUTWrapper._instance = undefined;
    }
  }

  // ─── HTTP communication ───────────────────────────────────────────────────

  /**
   * Sends an HTTP request to the AUT and records the transaction.
   *
   * If the AUT does not respond (e.g. it has crashed), the error is recorded in the
   * transaction but this method does NOT throw — callers can inspect `lastTransaction.error`
   * or call `lastResponse` (which will throw) to surface the failure.
   *
   * Per-call headers are merged on top of the current session headers.
   * If the body is a JSON object (or a JSON string), Content-Type is inferred automatically
   * unless the caller has explicitly set it.
   */
  public static async request(
    method: string,
    resourcePath: string,
    options: API_AUTWrapper.RequestOptions = {}
  ): Promise<void> {
    if (Utils.isUndefined(API_AUTWrapper._port)) {
      const errText = `Cannot make request — [${API_AUTWrapper._appName}] port is not set`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }

    const fullPath = (API_AUTWrapper._resourcePathPreamble ?? '') + resourcePath;

    const mergedHeaders: APIUtils.HTTPHeaders = {
      ...API_AUTWrapper._headers,
      ...(options.headers ?? {}),
    };

    // Infer Content-Type for JSON bodies unless already set
    if (!mergedHeaders['Content-Type']) {
      const bodyIsJsonObject = typeof options.body === 'object' && !Utils.isNullOrUndefined(options.body);
      const bodyIsJsonString = typeof options.body === 'string' && isJsonString(options.body);
      if (bodyIsJsonObject || bodyIsJsonString) {
        mergedHeaders['Content-Type'] = APIUtils.APPLICATION_JSON;
      }
    }

    const httpRequest: APIUtils.HTTPRequest = {
      method,
      protocol: API_AUTWrapper._protocol,
      host: `${API_AUTWrapper._host}:${API_AUTWrapper._port}`,
      resourcePath: fullPath,
      headers: mergedHeaders,
      body: options.body,
      proxy: API_AUTWrapper._proxy,
      timeout: API_AUTWrapper._timeout,
    };

    Log.writeLine(
      LogLevels.FrameworkInformation,
      `HTTP [${method}] → ${API_AUTWrapper._protocol}://${httpRequest.host}${fullPath}`
    );

    try {
      const response = await APIUtils.performHTTPOperation(httpRequest);
      API_AUTWrapper._transactions.push({ request: httpRequest, response });
      Log.writeLine(
        LogLevels.FrameworkInformation,
        `[${API_AUTWrapper._appName}] responded: ${response.status} ${response.statusMessage}`
      );
    } catch (err) {
      const errorMessage = (err as Error).message ?? String(err);
      Log.writeLine(LogLevels.Error, `[${API_AUTWrapper._appName}] did not respond to [${method} ${fullPath}]: ${errorMessage}`);
      API_AUTWrapper._transactions.push({ request: httpRequest, error: errorMessage });
    }
  }

  // ─── Instance: URL and liveness ───────────────────────────────────────────

  /**
   * Returns the URL the AUT reports it is listening on.
   */
  public async autURL(): Promise<string> {
    if (Utils.isUndefined(this._aut)) {
      const errText = `[${API_AUTWrapper._appName}] is not running`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }
    try {
      return await this._aut.getUrl();
    } catch (err) {
      const errText = `[${API_AUTWrapper._appName}].getUrl() threw: ${(err as Error).message}`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }
  }

  /**
   * Returns true if the AUT is running and reporting a valid URL.
   */
  public async isLive(): Promise<boolean> {
    if (Utils.isUndefined(this._aut)) {
      Log.writeLine(LogLevels.FrameworkInformation, `[${API_AUTWrapper._appName}] is not running`);
      return false;
    }
    try {
      const url = await this.autURL();
      if (!url) {
        Log.writeLine(LogLevels.Error, `[${API_AUTWrapper._appName}] running but getUrl() returned empty`);
        return false;
      }
      Log.writeLine(LogLevels.FrameworkInformation, `[${API_AUTWrapper._appName}] is live at ${url}`);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Instance: internal lifecycle ────────────────────────────────────────

  private async startAUT(bootstrapper?: API_AUTWrapper.Bootstrapper): Promise<void> {
    if (!Utils.isUndefined(bootstrapper)) this._bootstrapper = bootstrapper;

    if (Utils.isUndefined(this._bootstrapper)) {
      const errText = `No bootstrapper set for [${API_AUTWrapper._appName}] — provide one via startApplication or set API_AUTWrapper.bootstrap`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }

    if (Utils.isUndefined(API_AUTWrapper._port)) {
      const errText = `No port set for [${API_AUTWrapper._appName}] — set API_AUTWrapper.port before calling startApplication`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }

    if (API_AUTWrapper._host !== 'localhost') {
      const errText = `Host is [${API_AUTWrapper._host}] — must be 'localhost' for controlled local execution`;
      Log.writeLine(LogLevels.Error, errText);
      throw new Error(errText);
    }

    if (!Utils.isUndefined(this._aut)) {
      Log.writeLine(LogLevels.FrameworkDebug, `[${API_AUTWrapper._appName}] already running — closing before restart`);
      await this.closeAUT();
    }

    Log.writeLine(LogLevels.FrameworkInformation, `Starting [${API_AUTWrapper._appName}] on port ${API_AUTWrapper._port}`);
    try {
      this._aut = await (this._bootstrapper as API_AUTWrapper.Bootstrapper)(API_AUTWrapper._port as number);
    } catch (err) {
      Log.writeLine(LogLevels.Error, `Failed to start [${API_AUTWrapper._appName}]: ${(err as Error).message}`);
      throw err;
    }

    API_AUTWrapper._isControlled = true;
    Log.writeLine(LogLevels.FrameworkInformation, `[${API_AUTWrapper._appName}] started successfully`);
  }

  private async closeAUT(): Promise<void> {
    if (!Utils.isUndefined(this._aut)) {
      Log.writeLine(LogLevels.FrameworkDebug, `Calling close() on [${API_AUTWrapper._appName}]`);
      try {
        await this._aut.close();
        Log.writeLine(LogLevels.FrameworkDebug, `[${API_AUTWrapper._appName}] closed`);
      } catch (err) {
        const errText = `[${API_AUTWrapper._appName}].close() threw: ${(err as Error).message}`;
        Log.writeLine(LogLevels.Error, errText);
        throw new Error(errText);
      } finally {
        this._aut = undefined;
      }
    }
  }

  constructor(bootstrapper?: API_AUTWrapper.Bootstrapper) {
    if (!Utils.isUndefined(bootstrapper)) this._bootstrapper = bootstrapper;
  }
}

// ─── Namespace ────────────────────────────────────────────────────────────────

export namespace API_AUTWrapper {

  /**
   * The handle returned by a Bootstrapper. Must support close() and getUrl().
   * NestJS INestApplication satisfies this interface directly.
   */
  export interface AUT {
    close(): Promise<unknown> | unknown;
    getUrl(): Promise<string>;
  }

  /**
   * A function that starts the application on the given port and returns an AUT handle.
   * The framework calls this; the consumer provides it (e.g. wrapping NestFactory.create).
   */
  export type Bootstrapper = (port: number) => Promise<API_AUTWrapper.AUT>;

  /**
   * Per-request options. Headers here are merged on top of the session headers.
   */
  export interface RequestOptions {
    headers?: APIUtils.HTTPHeaders;
    body?: string | object;
  }

  /**
   * A recorded HTTP interaction with the AUT.
   * If the AUT did not respond, `response` will be undefined and `error` will be populated.
   */
  export interface Transaction {
    request: APIUtils.HTTPRequest;
    response?: APIUtils.HTTPResponse;
    error?: string;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function isJsonString(value: string): boolean {
  try {
    const trimmed = value.trim();
    return (trimmed.startsWith('{') || trimmed.startsWith('['));
  } catch {
    return false;
  }
}
