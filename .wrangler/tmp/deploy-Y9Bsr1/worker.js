var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/@cloudflare/containers/dist/lib/helpers.js
function generateId(length = 9) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}
__name(generateId, "generateId");
function parseTimeExpression(timeExpression) {
  if (typeof timeExpression === "number") {
    return timeExpression;
  }
  if (typeof timeExpression === "string") {
    const match = timeExpression.match(/^(\d+)([smh])$/);
    if (!match) {
      throw new Error(`invalid time expression ${timeExpression}`);
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      default:
        throw new Error(`unknown time unit ${unit}`);
    }
  }
  throw new Error(`invalid type for a time expression: ${typeof timeExpression}`);
}
__name(parseTimeExpression, "parseTimeExpression");

// node_modules/@cloudflare/containers/dist/lib/container.js
import { DurableObject } from "cloudflare:workers";
var NO_CONTAINER_INSTANCE_ERROR = "there is no container instance that can be provided to this durable object";
var RUNTIME_SIGNALLED_ERROR = "runtime signalled the container to exit:";
var UNEXPECTED_EXIT_ERROR = "container exited with unexpected exit code:";
var NOT_LISTENING_ERROR = "the container is not listening";
var CONTAINER_STATE_KEY = "__CF_CONTAINER_STATE";
var MAX_ALARM_RETRIES = 3;
var PING_TIMEOUT_MS = 5e3;
var DEFAULT_SLEEP_AFTER = "10m";
var INSTANCE_POLL_INTERVAL_MS = 300;
var TIMEOUT_TO_GET_CONTAINER_SECONDS = 8;
var TIMEOUT_TO_GET_PORTS = 20;
var TRIES_TO_GET_CONTAINER = Math.ceil(TIMEOUT_TO_GET_CONTAINER_SECONDS * 1e3 / INSTANCE_POLL_INTERVAL_MS);
var TRIES_TO_GET_PORTS = Math.ceil(TIMEOUT_TO_GET_PORTS * 1e3 / INSTANCE_POLL_INTERVAL_MS);
var FALLBACK_PORT_TO_CHECK = 33;
var TEMPORARY_HARDCODED_ATTEMPT_MAX = 6;
var signalToNumbers = {
  SIGINT: 2,
  SIGTERM: 15,
  SIGKILL: 9
};
function isErrorOfType(e, matchingString) {
  const errorString = e instanceof Error ? e.message : String(e);
  return errorString.toLowerCase().includes(matchingString);
}
__name(isErrorOfType, "isErrorOfType");
var isNoInstanceError = /* @__PURE__ */ __name((error) => isErrorOfType(error, NO_CONTAINER_INSTANCE_ERROR), "isNoInstanceError");
var isRuntimeSignalledError = /* @__PURE__ */ __name((error) => isErrorOfType(error, RUNTIME_SIGNALLED_ERROR), "isRuntimeSignalledError");
var isNotListeningError = /* @__PURE__ */ __name((error) => isErrorOfType(error, NOT_LISTENING_ERROR), "isNotListeningError");
var isContainerExitNonZeroError = /* @__PURE__ */ __name((error) => isErrorOfType(error, UNEXPECTED_EXIT_ERROR), "isContainerExitNonZeroError");
function getExitCodeFromError(error) {
  if (!(error instanceof Error)) {
    return null;
  }
  if (isRuntimeSignalledError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(RUNTIME_SIGNALLED_ERROR) + RUNTIME_SIGNALLED_ERROR.length + 1);
  }
  if (isContainerExitNonZeroError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(UNEXPECTED_EXIT_ERROR) + UNEXPECTED_EXIT_ERROR.length + 1);
  }
  return null;
}
__name(getExitCodeFromError, "getExitCodeFromError");
function addTimeoutSignal(existingSignal, timeoutMs) {
  const controller = new AbortController();
  if (existingSignal?.aborted) {
    controller.abort();
    return controller.signal;
  }
  existingSignal?.addEventListener("abort", () => controller.abort());
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId));
  return controller.signal;
}
__name(addTimeoutSignal, "addTimeoutSignal");
var ContainerState = class {
  static {
    __name(this, "ContainerState");
  }
  storage;
  status;
  constructor(storage) {
    this.storage = storage;
  }
  async setRunning() {
    await this.setStatusAndupdate("running");
  }
  async setHealthy() {
    await this.setStatusAndupdate("healthy");
  }
  async setStopping() {
    await this.setStatusAndupdate("stopping");
  }
  async setStopped() {
    await this.setStatusAndupdate("stopped");
  }
  async setStoppedWithCode(exitCode) {
    this.status = { status: "stopped_with_code", lastChange: Date.now(), exitCode };
    await this.update();
  }
  async getState() {
    if (!this.status) {
      const state = await this.storage.get(CONTAINER_STATE_KEY);
      if (!state) {
        this.status = {
          status: "stopped",
          lastChange: Date.now()
        };
        await this.update();
      } else {
        this.status = state;
      }
    }
    return this.status;
  }
  async setStatusAndupdate(status) {
    this.status = { status, lastChange: Date.now() };
    await this.update();
  }
  async update() {
    if (!this.status)
      throw new Error("status should be init");
    await this.storage.put(CONTAINER_STATE_KEY, this.status);
  }
};
var Container = class extends DurableObject {
  static {
    __name(this, "Container");
  }
  // =========================
  //     Public Attributes
  // =========================
  // Default port for the container (undefined means no default port)
  defaultPort;
  // Required ports that should be checked for availability during container startup
  // Override this in your subclass to specify ports that must be ready
  requiredPorts;
  // Timeout after which the container will sleep if no activity
  // The signal sent to the container by default is a SIGTERM.
  // The container won't get a SIGKILL if this threshold is triggered.
  sleepAfter = DEFAULT_SLEEP_AFTER;
  // Container configuration properties
  // Set these properties directly in your container instance
  envVars = {};
  entrypoint;
  enableInternet = true;
  // =========================
  //     PUBLIC INTERFACE
  // =========================
  constructor(ctx, env, options) {
    super(ctx, env);
    if (ctx.container === void 0) {
      throw new Error("Containers have not been enabled for this Durable Object class. Have you correctly setup your Wrangler config? More info: https://developers.cloudflare.com/containers/get-started/#configuration");
    }
    this.state = new ContainerState(this.ctx.storage);
    this.ctx.blockConcurrencyWhile(async () => {
      this.renewActivityTimeout();
      await this.scheduleNextAlarm();
    });
    this.container = ctx.container;
    if (options) {
      if (options.defaultPort !== void 0)
        this.defaultPort = options.defaultPort;
      if (options.sleepAfter !== void 0)
        this.sleepAfter = options.sleepAfter;
    }
    this.sql`
      CREATE TABLE IF NOT EXISTS container_schedules (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
        callback TEXT NOT NULL,
        payload TEXT,
        type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed')),
        time INTEGER NOT NULL,
        delayInSeconds INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `;
    if (this.container.running) {
      this.monitor = this.container.monitor();
      this.setupMonitorCallbacks();
    }
  }
  /**
   * Gets the current state of the container
   * @returns Promise<State>
   */
  async getState() {
    return { ...await this.state.getState() };
  }
  // ==========================
  //     CONTAINER STARTING
  // ==========================
  /**
   * Start the container if it's not running and set up monitoring
   *
   * This method handles the core container startup process without waiting for ports to be ready.
   * It will automatically retry if the container fails to start, up to maxTries attempts.
   *
   * It's useful when you need to:
   * - Start a container without blocking until a port is available
   * - Initialize a container that doesn't expose ports
   * - Perform custom port availability checks separately
   *
   * The method applies the container configuration from your instance properties by default, but allows
   * overriding these values for this specific startup:
   * - Environment variables (defaults to this.envVars)
   * - Custom entrypoint commands (defaults to this.entrypoint)
   * - Internet access settings (defaults to this.enableInternet)
   *
   * It also sets up monitoring to track container lifecycle events and automatically
   * calls the onStop handler when the container terminates.
   *
   * @example
   * // Basic usage in a custom Container implementation
   * async customInitialize() {
   *   // Start the container without waiting for a port
   *   await this.start();
   *
   *   // Perform additional initialization steps
   *   // that don't require port access
   * }
   *
   * @example
   * // Start with custom configuration
   * await this.start({
   *   envVars: { DEBUG: 'true', NODE_ENV: 'development' },
   *   entrypoint: ['npm', 'run', 'dev'],
   *   enableInternet: false
   * });
   *
   * @param options - Optional configuration to override instance defaults
   * @param waitOptions - Optional wait configuration with abort signal for cancellation
   * @returns A promise that resolves when the container start command has been issued
   * @throws Error if no container context is available or if all start attempts fail
   */
  async start(options, waitOptions) {
    const portToCheck = this.defaultPort ?? (this.requiredPorts ? this.requiredPorts[0] : FALLBACK_PORT_TO_CHECK);
    await this.startContainerIfNotRunning({
      abort: waitOptions?.signal,
      waitInterval: INSTANCE_POLL_INTERVAL_MS,
      retries: TRIES_TO_GET_CONTAINER,
      portToCheck
    }, options);
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.onStart();
    });
  }
  async startAndWaitForPorts(portsOrArgs, cancellationOptions, startOptions) {
    let ports;
    let resolvedCancellationOptions = {};
    let resolvedStartOptions = {};
    if (typeof portsOrArgs === "object" && portsOrArgs !== null && !Array.isArray(portsOrArgs)) {
      ports = portsOrArgs.ports;
      resolvedCancellationOptions = portsOrArgs.cancellationOptions;
      resolvedStartOptions = portsOrArgs.startOptions;
    } else {
      ports = portsOrArgs;
      resolvedCancellationOptions = cancellationOptions;
      resolvedStartOptions = startOptions;
    }
    const portsToCheck = await this.getPortsToCheck(ports);
    const state = await this.state.getState();
    if (state.status === "healthy" && this.container.running) {
      if (this.container.running && !this.monitor) {
        this.monitor = this.container.monitor();
        this.setupMonitorCallbacks();
      }
      return;
    }
    await this.syncPendingStoppedEvents();
    resolvedCancellationOptions ??= {};
    let containerGetRetries = resolvedCancellationOptions.instanceGetTimeoutMS ? Math.ceil(resolvedCancellationOptions.instanceGetTimeoutMS / INSTANCE_POLL_INTERVAL_MS) : TRIES_TO_GET_CONTAINER;
    const waitOptions = {
      abort: resolvedCancellationOptions.abort,
      retries: containerGetRetries,
      waitInterval: resolvedCancellationOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS,
      portToCheck: portsToCheck[0]
    };
    const abortedSignal = new Promise((res) => {
      waitOptions.abort?.addEventListener("abort", () => {
        res(true);
      });
    });
    const triesUsed = await this.startContainerIfNotRunning(waitOptions, resolvedStartOptions);
    let totalPortReadyTries = resolvedCancellationOptions.portReadyTimeoutMS ? Math.ceil(resolvedCancellationOptions.portReadyTimeoutMS / INSTANCE_POLL_INTERVAL_MS) : TRIES_TO_GET_PORTS;
    const triesLeft = totalPortReadyTries - triesUsed;
    for (const port of portsToCheck) {
      const tcpPort = this.container.getTcpPort(port);
      let portReady = false;
      for (let i = 0; i < triesLeft && !portReady; i++) {
        try {
          const combinedSignal = addTimeoutSignal(waitOptions.abort, PING_TIMEOUT_MS);
          await tcpPort.fetch("http://ping", { signal: combinedSignal });
          portReady = true;
          console.log(`Port ${port} is ready`);
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.debug(`Error checking ${port}: ${errorMessage}`);
          if (!this.container.running) {
            try {
              await this.onError(new Error(`Container crashed while checking for ports, did you setup the entrypoint correctly?`));
            } catch {
            }
            throw e;
          }
          if (i === triesLeft - 1) {
            try {
              await this.onError(`Failed to verify port ${port} is available after ${waitOptions.retries} attempts, last error: ${errorMessage}`);
            } catch {
            }
            throw e;
          }
          await Promise.any([
            new Promise((resolve) => setTimeout(resolve, waitOptions.waitInterval)),
            abortedSignal
          ]);
          if (waitOptions.abort?.aborted) {
            throw new Error("Container request timed out.");
          }
        }
      }
    }
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.state.setHealthy();
      await this.onStart();
    });
  }
  // =======================
  //     LIFECYCLE HOOKS
  // =======================
  /**
   * Shuts down the container.
   * @param signal - The signal to send to the container (default: 15 for SIGTERM)
   */
  async stop(signal = "SIGTERM") {
    this.container.signal(typeof signal === "string" ? signalToNumbers[signal] : signal);
  }
  /**
   * Destroys the container. It will trigger onError instead of onStop.
   */
  async destroy() {
    await this.container.destroy();
  }
  /**
   * Lifecycle method called when container starts successfully
   * Override this method in subclasses to handle container start events
   */
  onStart() {
  }
  /**
   * Lifecycle method called when container shuts down
   * Override this method in subclasses to handle Container stopped events
   * @param params - Object containing exitCode and reason for the stop
   */
  onStop(_) {
  }
  /**
   * Lifecycle method called when the container is running, and the activity timeout
   * expiration has been reached.
   *
   * If you want to shutdown the container, you should call this.stop() here
   *
   * By default, this method calls `this.stop()`
   */
  async onActivityExpired() {
    if (!this.container.running) {
      return;
    }
    await this.stop();
  }
  /**
   * Error handler for container errors
   * Override this method in subclasses to handle container errors
   * @param error - The error that occurred
   * @returns Can return any value or throw the error
   */
  onError(error) {
    console.error("Container error:", error);
    throw error;
  }
  /**
   * Renew the container's activity timeout
   *
   * Call this method whenever there is activity on the container
   */
  renewActivityTimeout() {
    const timeoutInMs = parseTimeExpression(this.sleepAfter) * 1e3;
    this.sleepAfterMs = Date.now() + timeoutInMs;
  }
  // ==================
  //     SCHEDULING
  // ==================
  /**
   * Schedule a task to be executed in the future
   * @template T Type of the payload data
   * @param when When to execute the task (Date object or number of seconds delay)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @returns Schedule object representing the scheduled task
   */
  async schedule(when, callback, payload) {
    const id = generateId(9);
    if (typeof callback !== "string") {
      throw new Error("Callback must be a string (method name)");
    }
    if (typeof this[callback] !== "function") {
      throw new Error(`this.${callback} is not a function`);
    }
    if (when instanceof Date) {
      const timestamp = Math.floor(when.getTime() / 1e3);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        time: timestamp,
        type: "scheduled"
      };
    }
    if (typeof when === "number") {
      const time = Math.floor(Date.now() / 1e3 + when);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, delayInSeconds, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${time})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        delayInSeconds: when,
        time,
        type: "delayed"
      };
    }
    throw new Error("Invalid schedule type. 'when' must be a Date or number of seconds");
  }
  // ============
  //     HTTP
  // ============
  /**
   * Send a request to the container (HTTP or WebSocket) using standard fetch API signature
   * Based on containers-starter-go implementation
   *
   * This method handles HTTP requests to the container. WebSocket requests done outside the DO*
   * won't work until https://github.com/cloudflare/workerd/issues/2319 is addressed. Until then, please use `switchPort` + `fetch()`.
   *
   * Method supports multiple signatures to match standard fetch API:
   * - containerFetch(request: Request, port?: number)
   * - containerFetch(url: string | URL, init?: RequestInit, port?: number)
   *
   * @param requestOrUrl The request object or URL string/object to send to the container
   * @param portOrInit Port number or fetch RequestInit options
   * @param portParam Optional port number when using URL+init signature
   * @returns A Response from the container, or WebSocket connection
   */
  async containerFetch(requestOrUrl, portOrInit, portParam) {
    let { request, port } = this.requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam);
    const state = await this.state.getState();
    if (!this.container.running || state.status !== "healthy") {
      try {
        await this.startAndWaitForPorts(port, { abort: request.signal });
      } catch (e) {
        if (isNoInstanceError(e)) {
          return new Response("There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count (set in wrangler config) or are you currently provisioning the Container.\nIf you are deploying your Container for the first time, check your dashboard to see provisioning status, this may take a few minutes.", { status: 503 });
        } else {
          return new Response(`Failed to start container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
        }
      }
    }
    const tcpPort = this.container.getTcpPort(port);
    const containerUrl = request.url.replace("https:", "http:");
    try {
      this.renewActivityTimeout();
      const res = await tcpPort.fetch(containerUrl, request);
      return res;
    } catch (e) {
      if (!(e instanceof Error)) {
        throw e;
      }
      if (e.message.includes("Network connection lost.")) {
        return new Response("Container suddenly disconnected, try again", { status: 500 });
      }
      console.error(`Error proxying request to container ${this.ctx.id}:`, e);
      return new Response(`Error proxying request to container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }
  }
  /**
   * Handle fetch requests to the Container
   * Default implementation forwards all HTTP and WebSocket requests to the container
   * Override this in your subclass to specify a port or implement custom request handling
   *
   * @param request The request to handle
   */
  async fetch(request) {
    if (this.defaultPort === void 0 && !request.headers.has("cf-container-target-port")) {
      throw new Error("No port configured for this container. Set the `defaultPort` in your Container subclass, or specify a port with `container.fetch(switchPort(request, port))`.");
    }
    let portValue = this.defaultPort;
    if (request.headers.has("cf-container-target-port")) {
      const portFromHeaders = parseInt(request.headers.get("cf-container-target-port") ?? "");
      if (isNaN(portFromHeaders)) {
        throw new Error("port value from switchPort is not a number");
      } else {
        portValue = portFromHeaders;
      }
    }
    return await this.containerFetch(request, portValue);
  }
  // ===============================
  // ===============================
  //     PRIVATE METHODS & ATTRS
  // ===============================
  // ===============================
  // ==========================
  //     PRIVATE ATTRIBUTES
  // ==========================
  container;
  // onStopCalled will be true when we are in the middle of an onStop call
  onStopCalled = false;
  state;
  monitor;
  monitorSetup = false;
  sleepAfterMs = 0;
  // ==========================
  //     GENERAL HELPERS
  // ==========================
  /**
   * Execute SQL queries against the Container's database
   */
  sql(strings, ...values) {
    let query = "";
    query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
    return [...this.ctx.storage.sql.exec(query, ...values)];
  }
  requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam) {
    let request;
    let port;
    if (requestOrUrl instanceof Request) {
      request = requestOrUrl;
      port = typeof portOrInit === "number" ? portOrInit : void 0;
    } else {
      const url = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.toString();
      const init = typeof portOrInit === "number" ? {} : portOrInit || {};
      port = typeof portOrInit === "number" ? portOrInit : typeof portParam === "number" ? portParam : void 0;
      request = new Request(url, init);
    }
    if (port === void 0 && this.defaultPort === void 0) {
      throw new Error("No port specified for container fetch. Set defaultPort or specify a port parameter.");
    }
    port = port ?? this.defaultPort;
    return { request, port };
  }
  async getPortsToCheck(overridePorts) {
    let portsToCheck = [];
    if (overridePorts !== void 0) {
      portsToCheck = Array.isArray(overridePorts) ? overridePorts : [overridePorts];
    } else if (this.requiredPorts && this.requiredPorts.length > 0) {
      portsToCheck = [...this.requiredPorts];
    } else {
      portsToCheck = [this.defaultPort ?? FALLBACK_PORT_TO_CHECK];
    }
    return portsToCheck;
  }
  // ===========================================
  //     CONTAINER INTERACTION & MONITORING
  // ===========================================
  // Tries to start a container if it's not running
  // Reutns the number of tries used
  async startContainerIfNotRunning(waitOptions, options) {
    if (this.container.running) {
      if (!this.monitor) {
        this.monitor = this.container.monitor();
      }
      return 0;
    }
    const abortedSignal = new Promise((res) => {
      waitOptions.abort?.addEventListener("abort", () => {
        res(true);
      });
    });
    await this.state.setRunning();
    for (let tries = 0; tries < waitOptions.retries; tries++) {
      const envVars = options?.envVars ?? this.envVars;
      const entrypoint = options?.entrypoint ?? this.entrypoint;
      const enableInternet = options?.enableInternet ?? this.enableInternet;
      const startConfig = {
        enableInternet
      };
      if (envVars && Object.keys(envVars).length > 0)
        startConfig.env = envVars;
      if (entrypoint)
        startConfig.entrypoint = entrypoint;
      this.renewActivityTimeout();
      const handleError = /* @__PURE__ */ __name(async () => {
        const err = await this.monitor?.catch((err2) => err2);
        if (typeof err === "number") {
          const toThrow = new Error(`Error starting container, early exit code 0 before we could check for healthiness, did it crash early?`);
          try {
            await this.onError(toThrow);
          } catch {
          }
          throw toThrow;
        } else if (!isNoInstanceError(err)) {
          try {
            await this.onError(err);
          } catch {
          }
          throw err;
        }
      }, "handleError");
      if (!this.container.running) {
        if (tries > 0) {
          await handleError();
        }
        await this.scheduleNextAlarm();
        this.container.start(startConfig);
        this.monitor = this.container.monitor();
      } else {
        await this.scheduleNextAlarm();
      }
      this.renewActivityTimeout();
      const port = this.container.getTcpPort(waitOptions.portToCheck);
      try {
        const combinedSignal = addTimeoutSignal(waitOptions.abort, PING_TIMEOUT_MS);
        await port.fetch("http://containerstarthealthcheck", { signal: combinedSignal });
        return tries;
      } catch (error) {
        if (isNotListeningError(error) && this.container.running) {
          return tries;
        }
        if (!this.container.running && isNotListeningError(error)) {
          await handleError();
        }
        console.debug("Error checking if container is ready:", error instanceof Error ? error.message : String(error));
        await Promise.any([
          new Promise((res) => setTimeout(res, waitOptions.waitInterval)),
          abortedSignal
        ]);
        if (waitOptions.abort?.aborted) {
          throw new Error("Aborted waiting for container to start as we received a cancellation signal");
        }
        if (TEMPORARY_HARDCODED_ATTEMPT_MAX === tries) {
          if (error instanceof Error && error.message.includes("Network connection lost")) {
            this.ctx.abort();
          }
          throw new Error(NO_CONTAINER_INSTANCE_ERROR);
        }
        continue;
      }
    }
    throw new Error(`Container did not start after ${waitOptions.retries * waitOptions.waitInterval}ms`);
  }
  setupMonitorCallbacks() {
    if (this.monitorSetup) {
      return;
    }
    this.monitorSetup = true;
    this.monitor?.then(async () => {
      await this.ctx.blockConcurrencyWhile(async () => {
        await this.state.setStoppedWithCode(0);
      });
    }).catch(async (error) => {
      if (isNoInstanceError(error)) {
        return;
      }
      const exitCode = getExitCodeFromError(error);
      if (exitCode !== null) {
        await this.state.setStoppedWithCode(exitCode);
        this.monitorSetup = false;
        this.monitor = void 0;
        return;
      }
      try {
        await this.onError(error);
      } catch {
      }
    }).finally(() => {
      this.monitorSetup = false;
      if (this.timeout) {
        if (this.resolve)
          this.resolve();
        clearTimeout(this.timeout);
      }
    });
  }
  deleteSchedules(name) {
    this.sql`DELETE FROM container_schedules WHERE callback = ${name}`;
  }
  // ============================
  //     ALARMS AND SCHEDULES
  // ============================
  /**
   * Method called when an alarm fires
   * Executes any scheduled tasks that are due
   */
  async alarm(alarmProps) {
    if (alarmProps.isRetry && alarmProps.retryCount > MAX_ALARM_RETRIES) {
      const scheduleCount = Number(this.sql`SELECT COUNT(*) as count FROM container_schedules`[0]?.count) || 0;
      const hasScheduledTasks = scheduleCount > 0;
      if (hasScheduledTasks || this.container.running) {
        await this.scheduleNextAlarm();
      }
      return;
    }
    const prevAlarm = Date.now();
    await this.ctx.storage.setAlarm(prevAlarm);
    await this.ctx.storage.sync();
    const result = this.sql`
         SELECT * FROM container_schedules;
       `;
    let minTime = Date.now() + 3 * 60 * 1e3;
    const now = Date.now() / 1e3;
    for (const row of result) {
      if (row.time > now) {
        continue;
      }
      const callback = this[row.callback];
      if (!callback || typeof callback !== "function") {
        console.error(`Callback ${row.callback} not found or is not a function`);
        continue;
      }
      const schedule = this.getSchedule(row.id);
      try {
        const payload = row.payload ? JSON.parse(row.payload) : void 0;
        await callback.call(this, payload, await schedule);
      } catch (e) {
        console.error(`Error executing scheduled callback "${row.callback}":`, e);
      }
      this.sql`DELETE FROM container_schedules WHERE id = ${row.id}`;
    }
    const resultForMinTime = this.sql`
         SELECT * FROM container_schedules;
       `;
    const minTimeFromSchedules = Math.min(...resultForMinTime.map((r) => r.time * 1e3));
    if (!this.container.running) {
      await this.syncPendingStoppedEvents();
      if (resultForMinTime.length == 0) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(minTimeFromSchedules);
      }
      return;
    }
    if (this.isActivityExpired()) {
      await this.onActivityExpired();
      this.renewActivityTimeout();
      return;
    }
    minTime = Math.min(minTimeFromSchedules, minTime, this.sleepAfterMs);
    const timeout = Math.max(0, minTime - Date.now());
    await new Promise((resolve) => {
      this.resolve = resolve;
      if (!this.container.running) {
        resolve();
        return;
      }
      this.timeout = setTimeout(() => {
        resolve();
      }, timeout);
    });
    await this.ctx.storage.setAlarm(Date.now());
  }
  timeout;
  resolve;
  // synchronises container state with the container source of truth to process events
  async syncPendingStoppedEvents() {
    const state = await this.state.getState();
    if (!this.container.running && state.status === "healthy") {
      await this.callOnStop({ exitCode: 0, reason: "exit" });
      return;
    }
    if (!this.container.running && state.status === "stopped_with_code") {
      await this.callOnStop({ exitCode: state.exitCode ?? 0, reason: "exit" });
      return;
    }
  }
  async callOnStop(onStopParams) {
    if (this.onStopCalled) {
      return;
    }
    this.onStopCalled = true;
    const promise = this.onStop(onStopParams);
    if (promise instanceof Promise) {
      await promise.finally(() => {
        this.onStopCalled = false;
      });
    } else {
      this.onStopCalled = false;
    }
    await this.state.setStopped();
  }
  /**
   * Schedule the next alarm based on upcoming tasks
   */
  async scheduleNextAlarm(ms = 1e3) {
    const nextTime = ms + Date.now();
    if (this.timeout) {
      if (this.resolve)
        this.resolve();
      clearTimeout(this.timeout);
    }
    await this.ctx.storage.setAlarm(nextTime);
    await this.ctx.storage.sync();
  }
  async listSchedules(name) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE callback = ${name} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return [];
    }
    return result.map(this.toSchedule);
  }
  toSchedule(schedule) {
    let payload;
    try {
      payload = JSON.parse(schedule.payload);
    } catch (e) {
      console.error(`Error parsing payload for schedule ${schedule.id}:`, e);
      payload = void 0;
    }
    if (schedule.type === "delayed") {
      return {
        taskId: schedule.id,
        callback: schedule.callback,
        payload,
        type: "delayed",
        time: schedule.time,
        delayInSeconds: schedule.delayInSeconds
      };
    }
    return {
      taskId: schedule.id,
      callback: schedule.callback,
      payload,
      type: "scheduled",
      time: schedule.time
    };
  }
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  async getSchedule(id) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE id = ${id} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return void 0;
    }
    const schedule = result[0];
    return this.toSchedule(schedule);
  }
  isActivityExpired() {
    return this.sleepAfterMs <= Date.now();
  }
};

// node_modules/@cloudflare/containers/dist/lib/utils.js
var singletonContainerId = "cf-singleton-container";
function getContainer(binding, name) {
  const objectId = binding.idFromName(name ?? singletonContainerId);
  return binding.get(objectId);
}
__name(getContainer, "getContainer");

// cloudflare/auth.ts
var SESSION_COOKIE = "pagelm_session";
var SESSION_DAYS = 30;
function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
__name(json, "json");
function uuid() {
  return crypto.randomUUID();
}
__name(uuid, "uuid");
function sessionExpiryIso() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1e3).toISOString();
}
__name(sessionExpiryIso, "sessionExpiryIso");
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
__name(validEmail, "validEmail");
function validPassword(password) {
  return typeof password === "string" && password.length >= 8;
}
__name(validPassword, "validPassword");
function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    if (key === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return null;
}
__name(getCookie, "getCookie");
function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
__name(sessionCookie, "sessionCookie");
function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
__name(clearSessionCookie, "clearSessionCookie");
function bytesToB64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
__name(bytesToB64, "bytesToB64");
function b64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
__name(b64ToBytes, "b64ToBytes");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `pbkdf2$100000$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(derived))}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    expected.length * 8
  );
  const actual = new Uint8Array(derived);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
__name(verifyPassword, "verifyPassword");
async function createSession(db, userId) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToB64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, sessionExpiryIso()).run();
  return token;
}
__name(createSession, "createSession");
async function getSessionUser(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db.prepare(
    `SELECT u.id, u.email, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
    return null;
  }
  return { id: row.id, email: row.email };
}
__name(getSessionUser, "getSessionUser");
async function migrateLegacyKvToUser(db, userId) {
  const rows = await db.prepare("SELECT key, value FROM kv WHERE key NOT LIKE 'keyv:user:%'").all();
  if (!rows.results?.length) return;
  for (const row of rows.results) {
    const rawKey = row.key.startsWith("keyv:") ? row.key.slice(5) : row.key;
    if (rawKey.startsWith(`user:${userId}:`)) continue;
    const scoped = `keyv:user:${userId}:${rawKey}`;
    const exists = await db.prepare("SELECT 1 FROM kv WHERE key = ?").bind(scoped).first();
    if (exists) continue;
    await db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").bind(scoped, row.value).run();
  }
}
__name(migrateLegacyKvToUser, "migrateLegacyKvToUser");
async function handleAuthRoutes(request, db, pathname, options = {}) {
  if (pathname === "/auth/me" && request.method === "GET") {
    const user = await getSessionUser(request, db);
    if (!user) return json({ error: "unauthorized" }, { status: 401 });
    return json({ ok: true, user });
  }
  if (pathname === "/auth/logout" && request.method === "POST") {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
    }
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
  }
  if (pathname === "/auth/register" && request.method === "POST") {
    if (!options.allowSignup) {
      return json({ error: "account creation is disabled" }, { status: 403 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json" }, { status: 400 });
    }
    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    if (!validEmail(email)) return json({ error: "invalid email" }, { status: 400 });
    if (!validPassword(password)) return json({ error: "password must be at least 8 characters" }, { status: 400 });
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) return json({ error: "email already registered" }, { status: 409 });
    const userCount = await db.prepare("SELECT COUNT(*) AS c FROM users").first();
    const isFirstUser = (userCount?.c ?? 0) === 0;
    const id = uuid();
    const passwordHash = await hashPassword(password);
    await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").bind(id, email, passwordHash).run();
    if (isFirstUser) {
      await migrateLegacyKvToUser(db, id);
    }
    const token = await createSession(db, id);
    return json(
      { ok: true, user: { id, email } },
      { status: 201, headers: { "Set-Cookie": sessionCookie(token, request) } }
    );
  }
  if (pathname === "/auth/login" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json" }, { status: 400 });
    }
    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    if (!validEmail(email) || !password) return json({ error: "invalid credentials" }, { status: 401 });
    const row = await db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").bind(email).first();
    if (!row || !await verifyPassword(password, row.password_hash)) {
      return json({ error: "invalid credentials" }, { status: 401 });
    }
    const token = await createSession(db, row.id);
    return json(
      { ok: true, user: { id: row.id, email: row.email } },
      { headers: { "Set-Cookie": sessionCookie(token, request) } }
    );
  }
  return null;
}
__name(handleAuthRoutes, "handleAuthRoutes");
function injectUserHeaders(request, user) {
  const headers = new Headers(request.headers);
  headers.delete("X-User-Id");
  headers.delete("X-User-Email");
  headers.set("X-User-Id", user.id);
  headers.set("X-User-Email", user.email);
  return new Request(request, { headers });
}
__name(injectUserHeaders, "injectUserHeaders");

// cloudflare/rate-limit.ts
function envInt(env, name, fallback) {
  const raw = env[name];
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
__name(envInt, "envInt");
function isPromptRequest(method, pathname) {
  if (method !== "POST") return false;
  if (pathname === "/chat" || pathname === "/quiz" || pathname === "/podcast" || pathname === "/smartnotes" || pathname === "/exam" || pathname === "/transcriber" || pathname === "/api/companion/ask" || pathname === "/tasks" || pathname === "/tasks/ingest" || pathname === "/planner/weekly" || pathname === "/debate/start") {
    return true;
  }
  if (/^\/debate\/[^/]+\/(argue|analyze)$/.test(pathname)) return true;
  if (/^\/tasks\/[^/]+\/(plan|replan|materials)$/.test(pathname)) return true;
  return false;
}
__name(isPromptRequest, "isPromptRequest");
async function loadWindow(db, key, limit, windowMs, now) {
  const row = await db.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?").bind(key).first();
  if (!row || row.reset_at <= now) {
    return { key, count: 0, limit, resetAt: now + windowMs, windowMs };
  }
  return { key, count: row.count, limit, resetAt: row.reset_at, windowMs };
}
__name(loadWindow, "loadWindow");
async function saveWindow(db, window) {
  await db.prepare(
    "INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at"
  ).bind(window.key, window.count, window.resetAt).run();
}
__name(saveWindow, "saveWindow");
function secondsUntil(resetAt, now) {
  return Math.max(1, Math.ceil((resetAt - now) / 1e3));
}
__name(secondsUntil, "secondsUntil");
async function consumePromptQuota(db, userId, env) {
  const now = Date.now();
  const userMinute = envInt(env, "RATE_LIMIT_USER_MINUTE", 5);
  const userQuarter = envInt(env, "RATE_LIMIT_USER_QUARTER", 15);
  const userHour = envInt(env, "RATE_LIMIT_USER_HOUR", 40);
  const globalMinute = envInt(env, "RATE_LIMIT_GLOBAL_MINUTE", 20);
  const globalHour = envInt(env, "RATE_LIMIT_GLOBAL_HOUR", 120);
  await db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").bind(now).run();
  const minuteBucket = Math.floor(now / 6e4);
  const quarterBucket = Math.floor(now / 9e5);
  const hourBucket = Math.floor(now / 36e5);
  const windows = await Promise.all([
    loadWindow(db, `user:${userId}:m:${minuteBucket}`, userMinute, 6e4, now),
    loadWindow(db, `user:${userId}:q:${quarterBucket}`, userQuarter, 9e5, now),
    loadWindow(db, `user:${userId}:h:${hourBucket}`, userHour, 36e5, now),
    loadWindow(db, `global:m:${minuteBucket}`, globalMinute, 6e4, now),
    loadWindow(db, `global:h:${hourBucket}`, globalHour, 36e5, now)
  ]);
  const blocked = windows.find((w) => w.count >= w.limit);
  if (blocked) {
    const globalHit = blocked.key.startsWith("global:");
    return {
      allowed: false,
      warning: false,
      retryAfter: secondsUntil(blocked.resetAt, now),
      limit: blocked.limit,
      remaining: 0,
      message: globalHit ? "The service is handling a lot of requests right now. Please slow down and try again shortly." : "You're sending prompts too quickly. Please slow down and try again in a moment."
    };
  }
  for (const window of windows) window.count += 1;
  await Promise.all(windows.map((window) => saveWindow(db, window)));
  const userWindows = windows.slice(0, 3);
  const tightest = userWindows.reduce(
    (best, next) => next.limit - next.count < best.limit - best.count ? next : best
  );
  const remaining = Math.min(...userWindows.map((w) => w.limit - w.count));
  const warning = userWindows.some((w) => w.count / w.limit >= 0.7);
  return {
    allowed: true,
    warning,
    retryAfter: 0,
    limit: tightest.limit,
    remaining,
    message: warning ? "You're sending a lot of prompts. Please slow down so we don't run out of AI usage." : ""
  };
}
__name(consumePromptQuota, "consumePromptQuota");
function rateLimitedResponse(decision) {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: decision.message,
      retryAfter: decision.retryAfter
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(decision.retryAfter),
        "X-RateLimit-Limit": String(decision.limit),
        "X-RateLimit-Remaining": "0"
      }
    }
  );
}
__name(rateLimitedResponse, "rateLimitedResponse");
function applyRateLimitHeaders(headers, decision) {
  headers.set("X-RateLimit-Limit", String(decision.limit));
  headers.set("X-RateLimit-Remaining", String(decision.remaining));
  if (decision.warning) headers.set("X-RateLimit-Warning", "slow_down");
}
__name(applyRateLimitHeaders, "applyRateLimitHeaders");

// cloudflare/dap-rate-limit.ts
var RULES = {
  "dap.get.query.table": {
    limit: 5,
    windowMs: 6e4,
    message: "Table listing is limited to 5 requests per minute. Please wait before trying again."
  },
  "dap.get.query.table.schema": {
    limit: 500,
    windowMs: 6e4,
    message: "Schema requests are limited to 500 per minute. Please slow down."
  },
  "dap.get.job": {
    limit: 500,
    windowMs: 6e4,
    minIntervalMs: 5e3,
    message: "Job status checks are limited. Wait at least 5 seconds between polls."
  },
  "dap.post.query.canvas.data": {
    limit: 500,
    windowMs: 6e4,
    message: "Canvas data queries are limited to 500 per minute. Please slow down."
  },
  "dap.post.query.canvas_logs.data": {
    limit: 5,
    windowMs: 6e4,
    message: "Canvas logs queries are limited to 5 per minute. Please wait before retrying."
  },
  "dap.post.object.url": {
    limit: 200,
    windowMs: 6e4,
    message: "Pre-signed URL requests are limited to 200 per minute. Please slow down."
  },
  "canvas.lms.list": {
    limit: 60,
    windowMs: 6e4,
    message: "Canvas listing requests are limited to 60 per minute. Please wait before trying again."
  },
  "canvas.lms.download": {
    limit: 30,
    windowMs: 6e4,
    message: "Canvas file downloads are limited to 30 per minute. Please wait before importing more."
  }
};
function secondsUntil2(resetAt, now) {
  return Math.max(1, Math.ceil((resetAt - now) / 1e3));
}
__name(secondsUntil2, "secondsUntil");
async function loadWindow2(db, key, limit, windowMs, now) {
  const row = await db.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?").bind(key).first();
  if (!row || row.reset_at <= now) {
    return { key, count: 0, limit, resetAt: now + windowMs };
  }
  return { key, count: row.count, limit, resetAt: row.reset_at };
}
__name(loadWindow2, "loadWindow");
async function saveWindow2(db, window) {
  await db.prepare(
    "INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at"
  ).bind(window.key, window.count, window.resetAt).run();
}
__name(saveWindow2, "saveWindow");
async function consumeExternalQuota(db, userId, endpoint) {
  const rule = RULES[endpoint];
  const now = Date.now();
  const minuteBucket = Math.floor(now / 6e4);
  const windowKey = `ext:${userId}:${endpoint}:m:${minuteBucket}`;
  if (rule.minIntervalMs) {
    const spacingKey = `ext:${userId}:${endpoint}:last`;
    const lastRow = await db.prepare("SELECT reset_at FROM rate_limits WHERE key = ?").bind(spacingKey).first();
    if (lastRow && lastRow.reset_at > now) {
      const retryAfter = secondsUntil2(lastRow.reset_at, now);
      return {
        allowed: false,
        retryAfter,
        message: rule.message,
        limit: rule.limit,
        remaining: 0
      };
    }
  }
  const window = await loadWindow2(db, windowKey, rule.limit, rule.windowMs, now);
  if (window.count >= window.limit) {
    return {
      allowed: false,
      retryAfter: secondsUntil2(window.resetAt, now),
      message: rule.message,
      limit: rule.limit,
      remaining: 0
    };
  }
  window.count += 1;
  await saveWindow2(db, window);
  if (rule.minIntervalMs) {
    const spacingKey = `ext:${userId}:${endpoint}:last`;
    await saveWindow2(db, {
      key: spacingKey,
      count: 1,
      limit: 1,
      resetAt: now + rule.minIntervalMs
    });
  }
  return {
    allowed: true,
    retryAfter: 0,
    message: "",
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - window.count)
  };
}
__name(consumeExternalQuota, "consumeExternalQuota");
function externalRateLimitedResponse(decision) {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: decision.message,
      retryAfter: decision.retryAfter
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(decision.retryAfter),
        "X-RateLimit-Limit": String(decision.limit),
        "X-RateLimit-Remaining": "0"
      }
    }
  );
}
__name(externalRateLimitedResponse, "externalRateLimitedResponse");

// cloudflare/replay-request.ts
async function makeReplayableRequest(request) {
  const url = request.url;
  const method = request.method;
  const headers = new Headers(request.headers);
  const canHaveBody = method !== "GET" && method !== "HEAD";
  const body = canHaveBody ? await request.arrayBuffer() : void 0;
  return () => new Request(url, {
    method,
    headers,
    body: body ? body.slice(0) : void 0
  });
}
__name(makeReplayableRequest, "makeReplayableRequest");

// cloudflare/files.ts
function json2(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
__name(json2, "json");
function guessMime(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
__name(guessMime, "guessMime");
function displayName(key, prefix) {
  const raw = key.startsWith(prefix) ? key.slice(prefix.length) : key.split("/").pop() || key;
  return raw.replace(/^\d+-/, "") || raw;
}
__name(displayName, "displayName");
function isExtractSidecar(key) {
  return /\.(pdf|docx?|odt|md|markdown)\.txt$/i.test(key);
}
__name(isExtractSidecar, "isExtractSidecar");
function userUploadsPrefix(userId) {
  return `users/${userId}/uploads/`;
}
__name(userUploadsPrefix, "userUploadsPrefix");
function groupFilesPrefix(groupId) {
  return `groups/${groupId}/files/`;
}
__name(groupFilesPrefix, "groupFilesPrefix");
function sanitizeFileName(filename) {
  return filename.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").trim().slice(0, 180) || "file";
}
__name(sanitizeFileName, "sanitizeFileName");
async function putUserUpload(env, userId, file, source = "upload") {
  const name = sanitizeFileName(file.filename);
  const key = `${userUploadsPrefix(userId)}${Date.now()}-${name}`;
  await env.STORAGE.put(key, file.bytes, {
    httpMetadata: { contentType: file.mimeType || guessMime(name) },
    customMetadata: { source, filename: name }
  });
  return {
    id: key,
    filename: name,
    mimeType: file.mimeType || guessMime(name),
    size: file.bytes.byteLength,
    chatId: "",
    source,
    created: Date.now()
  };
}
__name(putUserUpload, "putUserUpload");
function unwrapKeyv(raw) {
  let cur = raw;
  for (let i = 0; i < 5; i++) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
        continue;
      } catch {
        return cur;
      }
    }
    if (cur && typeof cur === "object" && !Array.isArray(cur) && "value" in cur) {
      cur = cur.value;
      continue;
    }
    return cur;
  }
  return cur;
}
__name(unwrapKeyv, "unwrapKeyv");
async function loadLibraryIndex(db, userId) {
  const keys = [`keyv:user:${userId}:library-files`, `user:${userId}:library-files`];
  for (const key of keys) {
    const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first();
    const parsed = unwrapKeyv(row?.value);
    if (!Array.isArray(parsed)) continue;
    return parsed.map((item) => {
      const file = item;
      const filename = String(file.filename || "").trim();
      if (!filename) return null;
      return {
        id: String(file.id || filename),
        filename,
        mimeType: String(file.mimeType || guessMime(filename)),
        size: Number(file.size || 0),
        chatId: String(file.chatId || ""),
        source: file.source === "canvas" ? "canvas" : "upload",
        created: Number(file.created || Date.now())
      };
    }).filter((file) => Boolean(file));
  }
  return [];
}
__name(loadLibraryIndex, "loadLibraryIndex");
async function listR2Uploads(env, userId) {
  const prefix = userUploadsPrefix(userId);
  const files = [];
  let cursor;
  do {
    const page = await env.STORAGE.list({ prefix, cursor, limit: 100 });
    for (const obj of page.objects) {
      if (!obj.key || obj.key.endsWith("/") || isExtractSidecar(obj.key)) continue;
      const meta = obj.customMetadata || {};
      const filename = meta.filename || displayName(obj.key, prefix);
      files.push({
        id: obj.key,
        filename,
        mimeType: obj.httpMetadata?.contentType || guessMime(filename),
        size: obj.size,
        chatId: meta.chatId || "",
        source: meta.source === "canvas" ? "canvas" : "upload",
        created: obj.uploaded?.getTime?.() || Date.now()
      });
    }
    cursor = page.truncated ? page.cursor : void 0;
  } while (cursor);
  return files;
}
__name(listR2Uploads, "listR2Uploads");
async function listUserUploads(env, userId) {
  const [fromR2, fromIndex] = await Promise.all([
    listR2Uploads(env, userId),
    loadLibraryIndex(env.DB, userId)
  ]);
  const byName = /* @__PURE__ */ new Map();
  for (const file of fromIndex) byName.set(file.filename.toLowerCase(), file);
  for (const file of fromR2) {
    const name = file.filename.toLowerCase();
    const prev = byName.get(name);
    byName.set(name, prev ? { ...prev, ...file, chatId: file.chatId || prev.chatId } : file);
  }
  return [...byName.values()].sort((a, b) => b.created - a.created);
}
__name(listUserUploads, "listUserUploads");
function candidateKeys(userId, rawKey) {
  const clean = decodeURIComponent(rawKey).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return [];
  const prefix = userUploadsPrefix(userId);
  const keys = [];
  if (clean.startsWith(prefix) || clean.startsWith(`users/${userId}/`)) keys.push(clean);
  if (clean.startsWith("uploads/")) {
    keys.push(`${prefix}${clean.slice("uploads/".length)}`);
    keys.push(`users/${userId}/${clean}`);
    keys.push(clean);
  }
  if (!clean.includes("/")) keys.push(`${prefix}${clean}`);
  return [...new Set(keys)];
}
__name(candidateKeys, "candidateKeys");
async function resolveOwnedKey(env, userId, rawKey) {
  const wanted = decodeURIComponent(rawKey || "");
  const files = await listUserUploads(env, userId);
  const match = files.find((file) => file.id === wanted || file.id.endsWith(`/${wanted}`) || file.filename === wanted);
  const tryKeys = [
    ...candidateKeys(userId, rawKey),
    ...match ? candidateKeys(userId, match.id) : [],
    ...match?.id && !match.id.includes("..") ? [match.id] : []
  ];
  for (const key of [...new Set(tryKeys)]) {
    const obj = await env.STORAGE.head(key);
    if (obj) return key;
  }
  return null;
}
__name(resolveOwnedKey, "resolveOwnedKey");
async function handleFileLibraryRoutes(request, env, pathname) {
  const isApi = pathname === "/api/files" || pathname.startsWith("/api/files/");
  const isLegacy = pathname === "/files" || pathname.startsWith("/files/");
  if (!isApi && !isLegacy) return null;
  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return json2({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  if ((pathname === "/api/files" || pathname === "/files") && request.method === "GET") {
    const files = await listUserUploads(env, user.id);
    return json2({ ok: true, files });
  }
  if ((pathname === "/api/files" || pathname === "/files") && request.method === "DELETE") {
    const files = await listUserUploads(env, user.id);
    await Promise.all(files.map((file) => env.STORAGE.delete(file.id)));
    return json2({ ok: true });
  }
  if (pathname === "/api/files/object" || pathname === "/files/object") {
    const key = await resolveOwnedKey(env, user.id, url.searchParams.get("key") || "");
    if (!key) return json2({ error: "not found" }, { status: 404 });
    if (request.method === "DELETE") {
      await env.STORAGE.delete(key);
      return json2({ ok: true });
    }
    if (request.method === "GET") {
      const obj = await env.STORAGE.get(key);
      if (!obj) return json2({ error: "not found" }, { status: 404 });
      const name = obj.customMetadata?.filename || displayName(key, userUploadsPrefix(user.id));
      const headers = new Headers();
      headers.set("Content-Type", obj.httpMetadata?.contentType || guessMime(name));
      headers.set("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
      return new Response(obj.body, { headers });
    }
  }
  return json2({ error: "not found" }, { status: 404 });
}
__name(handleFileLibraryRoutes, "handleFileLibraryRoutes");

// cloudflare/canvas.ts
var MAX_IMPORT_FILES = 5;
var MAX_FILE_BYTES = 15 * 1024 * 1024;
var MAX_LIST_PAGES = 5;
var IMPORTABLE_TYPES = /* @__PURE__ */ new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text"
]);
function json3(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
__name(json3, "json");
function unauthorized() {
  return json3({ error: "unauthorized" }, { status: 401 });
}
__name(unauthorized, "unauthorized");
function hexToBytes(hex) {
  const clean = hex.trim().replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length !== 64) {
    throw new Error("CANVAS_TOKEN_KEY must be 32 bytes as 64 hex characters");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
__name(hexToBytes, "hexToBytes");
function bytesToB642(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
__name(bytesToB642, "bytesToB64");
function b64ToBytes2(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
__name(b64ToBytes2, "b64ToBytes");
async function importKey(env) {
  const raw = hexToBytes(String(env.CANVAS_TOKEN_KEY || ""));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(importKey, "importKey");
async function encryptToken(env, token) {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertext: bytesToB642(new Uint8Array(cipher)),
    iv: bytesToB642(iv)
  };
}
__name(encryptToken, "encryptToken");
async function decryptToken(env, row) {
  const key = await importKey(env);
  const iv = b64ToBytes2(row.iv);
  const cipher = b64ToBytes2(row.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}
__name(decryptToken, "decryptToken");
function normalizeCanvasHost(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host.includes(" ")) return null;
  return `https://${host}`;
}
__name(normalizeCanvasHost, "normalizeCanvasHost");
function canvasFileName(file) {
  return file.display_name || file.filename || `File ${file.id}`;
}
__name(canvasFileName, "canvasFileName");
function canvasFileContentType(file) {
  const fromApi = file["content-type"] || file.content_type || "";
  const ct = String(fromApi).split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream" && ct !== "binary/octet-stream") return ct;
  const name = canvasFileName(file).toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";
  const mimeClass = String(file.mime_class || "").toLowerCase();
  if (mimeClass === "pdf") return "application/pdf";
  if (mimeClass === "doc") return "application/msword";
  if (mimeClass === "text") return "text/plain";
  return ct || "application/octet-stream";
}
__name(canvasFileContentType, "canvasFileContentType");
function isImportableFile(contentType, filename) {
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (IMPORTABLE_TYPES.has(ct)) return true;
  if (ct.endsWith(".document")) return true;
  const name = filename.toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".odt") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
}
__name(isImportableFile, "isImportableFile");
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/i);
    if (match?.[1]) return match[1];
  }
  return null;
}
__name(parseNextLink, "parseNextLink");
async function loadStoredToken(db, userId) {
  return db.prepare("SELECT user_id, host, ciphertext, iv, last4 FROM canvas_tokens WHERE user_id = ?").bind(userId).first();
}
__name(loadStoredToken, "loadStoredToken");
async function getCredentials(env, userId) {
  const row = await loadStoredToken(env.DB, userId);
  if (!row) return null;
  try {
    const token = await decryptToken(env, row);
    return { host: row.host, token, last4: row.last4 };
  } catch {
    await env.DB.prepare("DELETE FROM canvas_tokens WHERE user_id = ?").bind(userId).run();
    return null;
  }
}
__name(getCredentials, "getCredentials");
async function clearStoredToken(db, userId) {
  await db.prepare("DELETE FROM canvas_tokens WHERE user_id = ?").bind(userId).run();
}
__name(clearStoredToken, "clearStoredToken");
function canvasHost(creds) {
  return new URL(creds.host).hostname;
}
__name(canvasHost, "canvasHost");
async function canvasFetch(creds, path, init = {}) {
  const url = path.startsWith("http") ? path : `${creds.host}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${creds.token}`);
  return fetch(url, { ...init, headers });
}
__name(canvasFetch, "canvasFetch");
async function canvasDownload(creds, target) {
  let parsed;
  try {
    const url = target.startsWith("http") ? target : `${creds.host}${target.startsWith("/") ? "" : "/"}${target}`;
    parsed = new URL(url);
  } catch {
    return new Response(null, { status: 400 });
  }
  const headers = new Headers();
  if (parsed.hostname === canvasHost(creds)) {
    headers.set("Authorization", `Bearer ${creds.token}`);
  }
  return fetch(parsed.toString(), { headers, redirect: "follow" });
}
__name(canvasDownload, "canvasDownload");
async function probeCanvasToken(db, userId, host, token) {
  const quota = await consumeExternalQuota(db, userId, "canvas.lms.list");
  if (!quota.allowed) {
    return { ok: false, status: 429, message: quota.message, retryAfter: quota.retryAfter };
  }
  const res = await fetch(`${host}/api/v1/users/self`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.ok) return { ok: true };
  let message = "Invalid or expired Canvas token. Generate a new token in Canvas \u2192 Profile \u2192 Approved Integrations.";
  if (res.status === 401 || res.status === 403) {
    message = "Canvas rejected this token. Check your school URL and generate a new access token.";
  }
  try {
    const body = await res.json();
    const errMsg = body?.errors?.[0]?.message || body?.message;
    if (errMsg) message = errMsg;
  } catch {
  }
  return { ok: false, status: res.status, message };
}
__name(probeCanvasToken, "probeCanvasToken");
async function fetchPaginated(creds, initialPath) {
  const items = [];
  let nextUrl = `${creds.host}${initialPath}`;
  let pages = 0;
  while (nextUrl && pages < MAX_LIST_PAGES) {
    const res = await canvasFetch(creds, nextUrl);
    if (res.status === 401 || res.status === 403) {
      return { items, authFailed: true };
    }
    if (!res.ok) break;
    let batch;
    try {
      batch = await res.json();
    } catch {
      return { items, authFailed: false, badResponse: true };
    }
    if (!Array.isArray(batch)) {
      return { items, authFailed: false, badResponse: true };
    }
    items.push(...batch);
    nextUrl = parseNextLink(res.headers.get("Link"));
    pages += 1;
  }
  return { items, authFailed: false };
}
__name(fetchPaginated, "fetchPaginated");
async function downloadCanvasFile(creds, fileId, courseId, meta) {
  const name = canvasFileName(meta);
  const attempts = [
    `${creds.host}/api/v1/files/${fileId}/download`,
    `${creds.host}/api/v1/courses/${courseId}/files/${fileId}/download`,
    meta.url
  ].filter(Boolean);
  let lastStatus = 0;
  for (const target of attempts) {
    const res = await canvasDownload(creds, target);
    lastStatus = res.status;
    if (res.status === 401 || res.status === 403) {
      throw new Error("auth");
    }
    if (!res.ok) continue;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) continue;
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`size:${name}`);
    }
    return bytes;
  }
  throw new Error(`download:${lastStatus}:${name}`);
}
__name(downloadCanvasFile, "downloadCanvasFile");
async function fetchContainerWithRetry(container, request) {
  const replay = await makeReplayableRequest(request);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await container.fetch(replay());
      if (res.ok) return res;
      const text = await res.clone().text().catch(() => "");
      if (!/no Container instance available|currently provisioning|suddenly disconnected/i.test(text)) {
        return res;
      }
    } catch (err) {
      const text = String(err instanceof Error ? err.message : err);
      if (!/no Container instance available|currently provisioning|suddenly disconnected|used body/i.test(
        text
      )) {
        throw err;
      }
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 2e3 * (attempt + 1)));
  }
  return new Response(JSON.stringify({ error: "The app is still starting up. Please try again in a few seconds." }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Retry-After": "8" }
  });
}
__name(fetchContainerWithRetry, "fetchContainerWithRetry");
async function proxyImportToBackend(env, request, user, files, chatId, title) {
  const origin = env.WORKER_PUBLIC_URL || new URL(request.url).origin;
  const form = new FormData();
  if (chatId) form.append("chatId", chatId);
  if (title) form.append("title", title);
  for (const file of files) {
    form.append("file", new Blob([file.bytes], { type: file.mimeType }), file.filename);
  }
  const headers = new Headers();
  headers.set("X-User-Id", user.id);
  headers.set("X-User-Email", user.email);
  const importRequest = new Request(new URL("/chat/import", origin), {
    method: "POST",
    body: form,
    headers
  });
  const container = getContainer(env.PAGELM_BACKEND, "pagelm");
  return fetchContainerWithRetry(container, importRequest);
}
__name(proxyImportToBackend, "proxyImportToBackend");
function humanizeCanvasException(msg) {
  if (msg.includes("CANVAS_TOKEN_KEY")) {
    return "Canvas encryption is misconfigured on the server.";
  }
  if (/container|provisioning|disconnected|starting up/i.test(msg)) {
    return "The app backend is still starting. Please wait a few seconds and try again.";
  }
  if (/invalid url|failed to parse url/i.test(msg)) {
    return "Canvas returned an invalid file download link.";
  }
  if (/used body|could not.*body|formdata|multipart|readablestream/i.test(msg)) {
    return "Import failed while sending files to the app. Please try again.";
  }
  if (/fetch|network|timed out|timeout|ECONNREFUSED/i.test(msg)) {
    return "Could not reach the app backend. Wait a few seconds and try again.";
  }
  if (msg && msg.length <= 180) return msg;
  return "Canvas request failed. Check your school URL and token, then try again.";
}
__name(humanizeCanvasException, "humanizeCanvasException");
function canvasRouteError(message, status = 500) {
  return json3({ error: message, canvasError: true }, { status });
}
__name(canvasRouteError, "canvasRouteError");
async function handleCanvasRoutes(request, env, pathname) {
  try {
    return await handleCanvasRoutesInner(request, env, pathname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[canvas]", err);
    if (msg.includes("CANVAS_TOKEN_KEY")) {
      return canvasRouteError("Canvas encryption is misconfigured on the server.", 503);
    }
    if (msg.includes("Container")) {
      return canvasRouteError("The app backend is still starting. Please wait a few seconds and try again.", 503);
    }
    return canvasRouteError(humanizeCanvasException(msg), 500);
  }
}
__name(handleCanvasRoutes, "handleCanvasRoutes");
async function handleCanvasRoutesInner(request, env, pathname) {
  if (!pathname.startsWith("/api/canvas")) return null;
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!env.CANVAS_TOKEN_KEY) {
    return json3({ error: "Canvas integration is not configured on the server." }, { status: 503 });
  }
  if (pathname === "/api/canvas/status" && request.method === "GET") {
    const row = await loadStoredToken(env.DB, user.id);
    return json3({
      ok: true,
      connected: Boolean(row),
      last4: row?.last4 || null,
      host: row?.host || null
    });
  }
  if (pathname === "/api/canvas/token" && request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json3({ error: "Invalid JSON body" }, { status: 400 });
    }
    const host = normalizeCanvasHost(String(body?.host || ""));
    const token = String(body?.token || "").trim();
    if (!host) return json3({ error: "Valid Canvas school URL required (e.g. yourschool.instructure.com)" }, { status: 400 });
    if (!token) return json3({ error: "token required" }, { status: 400 });
    const probe = await probeCanvasToken(env.DB, user.id, host, token);
    if (!probe.ok) {
      if (probe.status === 429) {
        return externalRateLimitedResponse({
          allowed: false,
          retryAfter: probe.retryAfter || 60,
          message: probe.message,
          limit: 60,
          remaining: 0
        });
      }
      return json3({ error: probe.message, canvasAuth: true }, { status: 400 });
    }
    const last4 = token.slice(-4);
    const { ciphertext, iv } = await encryptToken(env, token);
    await env.DB.prepare(
      `INSERT INTO canvas_tokens (user_id, host, ciphertext, iv, last4)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         host = excluded.host,
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         last4 = excluded.last4,
         created_at = datetime('now')`
    ).bind(user.id, host, ciphertext, iv, last4).run();
    return json3({ ok: true, connected: true, last4, host });
  }
  if (pathname === "/api/canvas/token" && request.method === "DELETE") {
    await clearStoredToken(env.DB, user.id);
    return json3({ ok: true, connected: false });
  }
  const creds = await getCredentials(env, user.id);
  if (!creds) {
    if (pathname === "/api/canvas/courses" || pathname.startsWith("/api/canvas/courses/")) {
      return json3({ error: "Canvas is not connected. Add your school URL and access token first.", canvasAuth: true }, { status: 404 });
    }
    if (pathname === "/api/canvas/import") {
      return json3({ error: "Canvas is not connected. Add your school URL and access token first.", canvasAuth: true }, { status: 404 });
    }
  }
  if (pathname === "/api/canvas/courses" && request.method === "GET" && creds) {
    const quota = await consumeExternalQuota(env.DB, user.id, "canvas.lms.list");
    if (!quota.allowed) return externalRateLimitedResponse(quota);
    const { items, authFailed, badResponse } = await fetchPaginated(
      creds,
      "/api/v1/courses?enrollment_state=active&per_page=50"
    );
    if (badResponse) {
      return json3(
        {
          error: "Canvas returned an unexpected response. Double-check your school URL (e.g. yourschool.instructure.com).",
          canvasAuth: true
        },
        { status: 400 }
      );
    }
    if (authFailed) {
      await clearStoredToken(env.DB, user.id);
      return json3(
        { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
        { status: 400 }
      );
    }
    const courses = items.map((course) => ({
      id: course.id,
      name: course.name || course.course_code || `Course ${course.id}`,
      code: course.course_code || null
    }));
    return json3({ ok: true, items: courses });
  }
  const filesMatch = pathname.match(/^\/api\/canvas\/courses\/(\d+)\/files$/);
  if (filesMatch && request.method === "GET" && creds) {
    const courseId = filesMatch[1];
    const quota = await consumeExternalQuota(env.DB, user.id, "canvas.lms.list");
    if (!quota.allowed) return externalRateLimitedResponse(quota);
    const { items, authFailed, badResponse } = await fetchPaginated(
      creds,
      `/api/v1/courses/${courseId}/files?per_page=50&sort=updated_at&order=desc`
    );
    if (badResponse) {
      return json3(
        {
          error: "Canvas returned an unexpected response for this course. Check your token can access course files.",
          canvasAuth: true
        },
        { status: 400 }
      );
    }
    if (authFailed) {
      await clearStoredToken(env.DB, user.id);
      return json3(
        { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
        { status: 400 }
      );
    }
    const files = items.map((file) => {
      const name = canvasFileName(file);
      const contentType = canvasFileContentType(file);
      return {
        id: file.id,
        name,
        contentType,
        size: file.size || 0,
        updatedAt: file.updated_at || null,
        importable: isImportableFile(contentType, name)
      };
    });
    return json3({ ok: true, items: files });
  }
  if (pathname === "/api/canvas/import" && request.method === "POST" && creds) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json3({ error: "Invalid JSON body" }, { status: 400 });
    }
    const courseId = String(body?.courseId || "").trim();
    const fileIds = (body?.fileIds || []).map((id) => String(id)).filter(Boolean);
    if (!courseId) return json3({ error: "courseId required" }, { status: 400 });
    if (fileIds.length === 0) return json3({ error: "Select at least one file to import" }, { status: 400 });
    if (fileIds.length > MAX_IMPORT_FILES) {
      return json3({ error: `Import up to ${MAX_IMPORT_FILES} files at a time` }, { status: 400 });
    }
    const downloaded = [];
    for (const fileId of fileIds) {
      const quota = await consumeExternalQuota(env.DB, user.id, "canvas.lms.download");
      if (!quota.allowed) return externalRateLimitedResponse(quota);
      const metaRes = await canvasFetch(creds, `/api/v1/files/${fileId}`);
      if (metaRes.status === 401 || metaRes.status === 403) {
        await clearStoredToken(env.DB, user.id);
        return json3(
          { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
          { status: 400 }
        );
      }
      if (!metaRes.ok) {
        return json3({ error: `Could not load Canvas file ${fileId}` }, { status: metaRes.status });
      }
      let meta;
      try {
        meta = await metaRes.json();
      } catch {
        return json3({ error: `Could not read metadata for Canvas file ${fileId}.` }, { status: 502 });
      }
      const name = canvasFileName(meta);
      const contentType = canvasFileContentType(meta);
      if (!isImportableFile(contentType, name)) {
        return json3({ error: `"${name}" is not a supported file type for import.` }, { status: 400 });
      }
      if ((meta.size || 0) > MAX_FILE_BYTES) {
        return json3({ error: `"${name}" exceeds the 15 MB import limit.` }, { status: 400 });
      }
      let bytes;
      try {
        bytes = await downloadCanvasFile(creds, fileId, courseId, meta);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "download_failed";
        if (msg === "auth") {
          await clearStoredToken(env.DB, user.id);
          return json3(
            { error: "Canvas token expired or revoked. Paste a new access token.", expired: true, canvasAuth: true },
            { status: 400 }
          );
        }
        if (msg.startsWith("size:")) {
          return json3({ error: `"${msg.slice(5)}" exceeds the 15 MB import limit.` }, { status: 400 });
        }
        return json3({ error: `Could not download "${name}" from Canvas.` }, { status: 502 });
      }
      downloaded.push({
        filename: name,
        mimeType: contentType,
        bytes
      });
    }
    const importTitle = String(body?.title || "").trim() || `Canvas course ${courseId}`;
    let backendRes = null;
    try {
      backendRes = await proxyImportToBackend(
        env,
        request,
        user,
        downloaded,
        body?.chatId ? String(body.chatId) : void 0,
        importTitle
      );
    } catch (err) {
      console.error("[canvas/import] proxy failed", err);
    }
    let chatId = String(body?.chatId || "");
    if (backendRes?.ok) {
      try {
        const parsed = JSON.parse(await backendRes.text());
        if (parsed.chatId) chatId = parsed.chatId;
      } catch {
      }
    }
    const wanted = new Set(downloaded.map((file) => file.filename.toLowerCase()));
    const stored = [];
    const existing = await listUserUploads(env, user.id);
    const have = new Set(
      existing.filter((file) => wanted.has(file.filename.toLowerCase()) && file.id.startsWith(userUploadsPrefix(user.id))).map((file) => {
        stored.push(file);
        return file.filename.toLowerCase();
      })
    );
    for (const file of downloaded) {
      if (have.has(file.filename.toLowerCase())) continue;
      stored.push(await putUserUpload(env, user.id, file, "canvas"));
    }
    return json3({
      ok: true,
      chatId,
      imported: stored.length || downloaded.length,
      files: stored,
      warning: backendRes?.ok ? void 0 : "Files are in your learning bag. Chat processing is still catching up \u2014 try asking about them in a minute."
    });
  }
  return json3({ error: "not found" }, { status: 404 });
}
__name(handleCanvasRoutesInner, "handleCanvasRoutesInner");

// cloudflare/skills.ts
var EXAMPLE_SKILLS = [
  {
    name: "Make flashcards",
    prompt: "Using the attached file, create 12 numbered flashcards. For each card, give a clear question and a concise answer. Format as Q/A pairs I can study from."
  },
  {
    name: "Quiz me",
    prompt: "Using the attached file, write a short multiple-choice quiz with 8 questions. Include 4 options per question, mark the correct answer, and add a one-sentence explanation for each."
  },
  {
    name: "Summarize",
    prompt: "Using the attached file, write a study-guide summary with key concepts, definitions, and a short list of things to review before an exam."
  }
];
function isExampleSkill(skill) {
  const name = String(skill.name || "").trim();
  const prompt = String(skill.prompt || "").trim();
  return EXAMPLE_SKILLS.some((example) => example.name === name && example.prompt === prompt);
}
__name(isExampleSkill, "isExampleSkill");
function json4(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
__name(json4, "json");
function skillsKey(userId) {
  return `keyv:user:${userId}:skills`;
}
__name(skillsKey, "skillsKey");
async function loadSkills(db, userId) {
  const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(skillsKey(userId)).first();
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(loadSkills, "loadSkills");
async function saveSkills(db, userId, skills) {
  await db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(skillsKey(userId), JSON.stringify(skills)).run();
}
__name(saveSkills, "saveSkills");
function parseSkillBody(body) {
  const rec = body && typeof body === "object" ? body : {};
  const name = String(rec.name || "").trim();
  const prompt = String(rec.prompt || "").trim();
  if (!name) return json4({ error: "name required" }, { status: 400 });
  if (!prompt) return json4({ error: "prompt required" }, { status: 400 });
  return { name, prompt };
}
__name(parseSkillBody, "parseSkillBody");
async function handleSkillRoutes(request, env, pathname) {
  if (pathname !== "/skills" && !pathname.startsWith("/skills/")) return null;
  const user = await getSessionUser(request, env.DB);
  if (!user) return json4({ error: "unauthorized" }, { status: 401 });
  if (pathname === "/skills" && request.method === "GET") {
    const stored = await loadSkills(env.DB, user.id);
    const skills = stored.filter((skill) => !isExampleSkill(skill));
    if (skills.length !== stored.length) {
      await saveSkills(env.DB, user.id, skills);
    }
    return json4({ ok: true, skills });
  }
  if (pathname === "/skills" && request.method === "POST") {
    const parsed = parseSkillBody(await request.json().catch(() => ({})));
    if (parsed instanceof Response) return parsed;
    const skill = {
      id: crypto.randomUUID(),
      name: parsed.name,
      prompt: parsed.prompt,
      created: Date.now()
    };
    const skills = (await loadSkills(env.DB, user.id)).filter((item) => !isExampleSkill(item));
    skills.unshift(skill);
    await saveSkills(env.DB, user.id, skills);
    return json4({ ok: true, skill });
  }
  const id = decodeURIComponent(pathname.slice("/skills/".length)).trim();
  if (!id || id.includes("/")) return json4({ error: "not found" }, { status: 404 });
  if (request.method === "PUT") {
    const parsed = parseSkillBody(await request.json().catch(() => ({})));
    if (parsed instanceof Response) return parsed;
    const skills = (await loadSkills(env.DB, user.id)).filter((item) => !isExampleSkill(item));
    const idx = skills.findIndex((s) => s.id === id);
    if (idx < 0) return json4({ error: "not found" }, { status: 404 });
    const updated = { ...skills[idx], name: parsed.name, prompt: parsed.prompt };
    skills[idx] = updated;
    await saveSkills(env.DB, user.id, skills);
    return json4({ ok: true, skill: updated });
  }
  if (request.method === "DELETE") {
    const skills = (await loadSkills(env.DB, user.id)).filter((s) => s.id !== id && !isExampleSkill(s));
    await saveSkills(env.DB, user.id, skills);
    return json4({ ok: true });
  }
  return json4({ error: "not found" }, { status: 404 });
}
__name(handleSkillRoutes, "handleSkillRoutes");

// cloudflare/groups.ts
function cardFolder(card) {
  if (card.tag === "note") return "Notes";
  return String(card.group || "").trim() || "Ungrouped";
}
__name(cardFolder, "cardFolder");
function json5(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
__name(json5, "json");
function unwrapKeyv2(raw) {
  let cur = raw;
  for (let i = 0; i < 5; i++) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
        continue;
      } catch {
        return cur;
      }
    }
    if (cur && typeof cur === "object" && !Array.isArray(cur) && "value" in cur) {
      cur = cur.value;
      continue;
    }
    return cur;
  }
  return cur;
}
__name(unwrapKeyv2, "unwrapKeyv");
function flashcardsKey(userId) {
  return `keyv:user:${userId}:flashcards`;
}
__name(flashcardsKey, "flashcardsKey");
function flashcardItemKey(userId, id) {
  return `keyv:user:${userId}:flashcard:${id}`;
}
__name(flashcardItemKey, "flashcardItemKey");
function chatKey(groupId) {
  return `study-group-chat:${groupId}`;
}
__name(chatKey, "chatKey");
async function loadMessages(db, groupId) {
  const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(chatKey(groupId)).first();
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(loadMessages, "loadMessages");
async function saveMessages(db, groupId, messages) {
  await kvSet(db, chatKey(groupId), messages.slice(-200));
}
__name(saveMessages, "saveMessages");
async function kvSet(db, key, value) {
  await db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, JSON.stringify(value)).run();
}
__name(kvSet, "kvSet");
async function loadFlashcards(db, userId) {
  const keys = [flashcardsKey(userId), `user:${userId}:flashcards`];
  for (const key of keys) {
    const row = await db.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first();
    const parsed = unwrapKeyv2(row?.value);
    if (Array.isArray(parsed)) return parsed;
  }
  return [];
}
__name(loadFlashcards, "loadFlashcards");
async function saveFlashcards(db, userId, cards) {
  await kvSet(db, flashcardsKey(userId), cards);
}
__name(saveFlashcards, "saveFlashcards");
function makeJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
__name(makeJoinCode, "makeJoinCode");
function normalizeCode(raw) {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
__name(normalizeCode, "normalizeCode");
async function uniqueJoinCode(db) {
  for (let i = 0; i < 8; i++) {
    const code = makeJoinCode();
    const existing = await db.prepare("SELECT id FROM study_groups WHERE join_code = ?").bind(code).first();
    if (!existing) return code;
  }
  return `${makeJoinCode()}${makeJoinCode()}`.slice(0, 8);
}
__name(uniqueJoinCode, "uniqueJoinCode");
async function getMembership(db, groupId, userId) {
  return await db.prepare("SELECT user_id, role FROM study_group_members WHERE group_id = ? AND user_id = ?").bind(groupId, userId).first() || null;
}
__name(getMembership, "getMembership");
async function requireMember(db, groupId, user) {
  const member = await getMembership(db, groupId, user.id);
  if (!member) return json5({ error: "not found" }, { status: 404 });
  return member;
}
__name(requireMember, "requireMember");
async function getGroup(db, groupId) {
  return await db.prepare("SELECT id, name, join_code, owner_id, created_at FROM study_groups WHERE id = ?").bind(groupId).first() || null;
}
__name(getGroup, "getGroup");
async function listUserGroups(db, userId) {
  return db.prepare(
    `SELECT g.id, g.name, g.join_code, g.owner_id, g.created_at, m.role
       FROM study_group_members m
       JOIN study_groups g ON g.id = m.group_id
       WHERE m.user_id = ?
       ORDER BY g.created_at DESC`
  ).bind(userId).all();
}
__name(listUserGroups, "listUserGroups");
async function loadGroupDetail(db, group) {
  const members = await db.prepare(
    `SELECT m.user_id AS id, m.role, u.email, m.joined_at
       FROM study_group_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY m.joined_at ASC`
  ).bind(group.id).all();
  const items = await db.prepare(
    `SELECT i.id, i.kind, i.title, i.payload, i.r2_key, i.shared_by, i.created_at, u.email AS shared_by_email
       FROM study_group_items i
       JOIN users u ON u.id = i.shared_by
       WHERE i.group_id = ?
       ORDER BY i.created_at DESC`
  ).bind(group.id).all();
  return {
    ok: true,
    group: {
      id: group.id,
      name: group.name,
      joinCode: group.join_code,
      ownerId: group.owner_id,
      createdAt: group.created_at
    },
    members: members.results || [],
    items: (items.results || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      payload: safeParse(item.payload),
      r2Key: item.r2_key,
      sharedBy: item.shared_by,
      sharedByEmail: item.shared_by_email,
      created: item.created_at
    }))
  };
}
__name(loadGroupDetail, "loadGroupDetail");
function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
__name(safeParse, "safeParse");
async function deletePrefix(env, prefix) {
  let cursor;
  do {
    const page = await env.STORAGE.list({ prefix, cursor, limit: 100 });
    if (page.objects.length) {
      await Promise.all(page.objects.map((obj) => env.STORAGE.delete(obj.key)));
    }
    cursor = page.truncated ? page.cursor : void 0;
  } while (cursor);
}
__name(deletePrefix, "deletePrefix");
function parsePath(pathname) {
  return pathname.replace(/^\/api\/groups\/?/, "").split("/").map((part) => decodeURIComponent(part)).filter(Boolean);
}
__name(parsePath, "parsePath");
async function shareSkill(env, user, groupId, sourceId) {
  const skills = await loadSkills(env.DB, user.id);
  const skill = skills.find((s) => s.id === sourceId);
  if (!skill) return json5({ error: "skill not found" }, { status: 404 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'skill', ?, ?, NULL, ?, ?)`
  ).bind(id, groupId, skill.name, JSON.stringify({ name: skill.name, prompt: skill.prompt }), user.id, Date.now()).run();
  return json5({ ok: true, itemId: id });
}
__name(shareSkill, "shareSkill");
function normalizeFolder(name) {
  try {
    return decodeURIComponent(name).trim();
  } catch {
    return name.trim();
  }
}
__name(normalizeFolder, "normalizeFolder");
function cardsFromUnknown(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item && typeof item === "object" ? item : {};
    return {
      question: String(row.question || row.q || "").trim(),
      answer: String(row.answer || row.a || "").trim(),
      tag: String(row.tag || "core")
    };
  }).filter((card) => card.question && card.answer).slice(0, 300);
}
__name(cardsFromUnknown, "cardsFromUnknown");
async function shareDeck(env, user, groupId, sourceId, extraCards) {
  const folder = normalizeFolder(sourceId);
  if (!folder || folder === "Notes") return json5({ error: "folder not found" }, { status: 404 });
  let cards = (await loadFlashcards(env.DB, user.id)).filter((card) => card.tag !== "note" && cardFolder(card) === folder).map((card) => ({
    question: String(card.question || "").trim(),
    answer: String(card.answer || "").trim(),
    tag: String(card.tag || "core")
  })).filter((card) => card.question && card.answer).slice(0, 300);
  if (!cards.length) cards = cardsFromUnknown(extraCards);
  if (!cards.length) return json5({ error: "folder not found" }, { status: 404 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'note', ?, ?, NULL, ?, ?)`
  ).bind(id, groupId, folder, JSON.stringify({ type: "deck", group: folder, cards }), user.id, Date.now()).run();
  return json5({ ok: true, itemId: id });
}
__name(shareDeck, "shareDeck");
async function shareNote(env, user, groupId, sourceId) {
  const cards = await loadFlashcards(env.DB, user.id);
  const card = cards.find((c) => c.id === sourceId);
  if (!card) return json5({ error: "note not found" }, { status: 404 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'note', ?, ?, NULL, ?, ?)`
  ).bind(
    id,
    groupId,
    card.question,
    JSON.stringify({ question: card.question, answer: card.answer, tag: card.tag || "flashcard" }),
    user.id,
    Date.now()
  ).run();
  return json5({ ok: true, itemId: id });
}
__name(shareNote, "shareNote");
async function shareFile(env, user, groupId, sourceId) {
  const clean = decodeURIComponent(sourceId);
  if (clean.includes("..") || !clean.startsWith(userUploadsPrefix(user.id))) {
    return json5({ error: "file not found" }, { status: 404 });
  }
  const obj = await env.STORAGE.get(clean);
  if (!obj) return json5({ error: "file not found" }, { status: 404 });
  const filename = sanitizeFileName(obj.customMetadata?.filename || clean.split("/").pop() || "file");
  const destKey = `${groupFilesPrefix(groupId)}${Date.now()}-${filename}`;
  await env.STORAGE.put(destKey, obj.body, {
    httpMetadata: obj.httpMetadata,
    customMetadata: {
      source: obj.customMetadata?.source || "upload",
      filename,
      sharedFrom: clean
    }
  });
  const id = crypto.randomUUID();
  const mimeType = obj.httpMetadata?.contentType || guessMime(filename);
  await env.DB.prepare(
    `INSERT INTO study_group_items (id, group_id, kind, title, payload, r2_key, shared_by, created_at)
     VALUES (?, ?, 'file', ?, ?, ?, ?, ?)`
  ).bind(
    id,
    groupId,
    filename,
    JSON.stringify({
      filename,
      mimeType,
      size: obj.size,
      source: obj.customMetadata?.source === "canvas" ? "canvas" : "upload"
    }),
    destKey,
    user.id,
    Date.now()
  ).run();
  return json5({ ok: true, itemId: id });
}
__name(shareFile, "shareFile");
async function saveItemToBag(env, user, groupId, itemId) {
  const item = await env.DB.prepare(
    "SELECT id, kind, title, payload, r2_key FROM study_group_items WHERE id = ? AND group_id = ?"
  ).bind(itemId, groupId).first();
  if (!item) return json5({ error: "not found" }, { status: 404 });
  const payload = safeParse(item.payload);
  if (item.kind === "skill") {
    const skill = {
      id: crypto.randomUUID(),
      name: String(payload.name || item.title || "Skill"),
      prompt: String(payload.prompt || ""),
      created: Date.now()
    };
    if (!skill.prompt) return json5({ error: "invalid skill" }, { status: 400 });
    const skills = await loadSkills(env.DB, user.id);
    skills.unshift(skill);
    await saveSkills(env.DB, user.id, skills);
    return json5({ ok: true, kind: "skill", id: skill.id });
  }
  if (item.kind === "note" && !Array.isArray(payload.cards) && payload.type !== "deck") {
    const card = {
      id: crypto.randomUUID(),
      question: String(payload.question || item.title || "Note"),
      answer: String(payload.answer || ""),
      tag: String(payload.tag || "note"),
      created: Date.now()
    };
    const cards = await loadFlashcards(env.DB, user.id);
    cards.unshift(card);
    await saveFlashcards(env.DB, user.id, cards);
    await kvSet(env.DB, flashcardItemKey(user.id, card.id), card);
    return json5({ ok: true, kind: "note", id: card.id });
  }
  if (item.kind === "deck" || payload.type === "deck" || Array.isArray(payload.cards)) {
    const folder = String(payload.group || item.title || "Shared").trim() || "Shared";
    const incoming = Array.isArray(payload.cards) ? payload.cards : [];
    const cards = await loadFlashcards(env.DB, user.id);
    const seen = new Set(
      cards.filter((card) => cardFolder(card) === folder).map((card) => String(card.question || "").trim().toLowerCase())
    );
    const added = [];
    for (const raw of incoming) {
      const row = raw && typeof raw === "object" ? raw : {};
      const question = String(row.question || "").trim();
      const answer = String(row.answer || "").trim();
      if (!question || !answer) continue;
      const key = question.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const card = {
        id: crypto.randomUUID(),
        question,
        answer,
        tag: String(row.tag || "core"),
        group: folder,
        created: Date.now()
      };
      cards.unshift(card);
      added.push(card);
      await kvSet(env.DB, flashcardItemKey(user.id, card.id), card);
    }
    if (added.length) await saveFlashcards(env.DB, user.id, cards);
    return json5({ ok: true, kind: "deck", id: added[0]?.id || "", count: added.length, group: folder });
  }
  if (item.kind === "file") {
    if (!item.r2_key || !item.r2_key.startsWith(groupFilesPrefix(groupId))) {
      return json5({ error: "file not found" }, { status: 404 });
    }
    const obj = await env.STORAGE.get(item.r2_key);
    if (!obj) return json5({ error: "file not found" }, { status: 404 });
    const bytes = await obj.arrayBuffer();
    const file = await putUserUpload(env, user.id, {
      filename: String(payload.filename || item.title || "file"),
      mimeType: String(payload.mimeType || obj.httpMetadata?.contentType || "application/octet-stream"),
      bytes
    }, payload.source === "canvas" ? "canvas" : "upload");
    return json5({ ok: true, kind: "file", id: file.id });
  }
  return json5({ error: "not found" }, { status: 404 });
}
__name(saveItemToBag, "saveItemToBag");
async function handleGroupRoutes(request, env, pathname) {
  if (pathname !== "/api/groups" && !pathname.startsWith("/api/groups/")) return null;
  const user = await getSessionUser(request, env.DB);
  if (!user) return json5({ error: "unauthorized" }, { status: 401 });
  const parts = parsePath(pathname);
  const url = new URL(request.url);
  if (parts.length === 0 && request.method === "GET") {
    const { results } = await listUserGroups(env.DB, user.id);
    return json5({
      ok: true,
      groups: (results || []).map((g) => ({
        id: g.id,
        name: g.name,
        joinCode: g.join_code,
        ownerId: g.owner_id,
        createdAt: g.created_at,
        role: g.role
      }))
    });
  }
  if (parts.length === 0 && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return json5({ error: "name required" }, { status: 400 });
    const id = crypto.randomUUID();
    const joinCode = await uniqueJoinCode(env.DB);
    await env.DB.prepare("INSERT INTO study_groups (id, name, join_code, owner_id) VALUES (?, ?, ?, ?)").bind(id, name, joinCode, user.id).run();
    await env.DB.prepare("INSERT INTO study_group_members (group_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id).run();
    return json5({ ok: true, group: { id, name, joinCode, ownerId: user.id, role: "owner" } });
  }
  if (parts[0] === "join" && parts.length === 1 && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const code = normalizeCode(String(body.code || ""));
    if (!code) return json5({ error: "code required" }, { status: 400 });
    const group2 = await env.DB.prepare(
      "SELECT id, name, join_code, owner_id, created_at FROM study_groups WHERE join_code = ?"
    ).bind(code).first();
    if (!group2) return json5({ error: "No group uses that code." }, { status: 404 });
    const existing = await getMembership(env.DB, group2.id, user.id);
    if (!existing) {
      await env.DB.prepare("INSERT INTO study_group_members (group_id, user_id, role) VALUES (?, ?, 'member')").bind(group2.id, user.id).run();
    }
    return json5({ ok: true, groupId: group2.id });
  }
  const groupId = parts[0];
  if (!groupId) return json5({ error: "not found" }, { status: 404 });
  const group = await getGroup(env.DB, groupId);
  if (!group) return json5({ error: "not found" }, { status: 404 });
  const member = await requireMember(env.DB, groupId, user);
  if (member instanceof Response) return member;
  if (parts.length === 1 && request.method === "GET") {
    return json5(await loadGroupDetail(env.DB, group));
  }
  if (parts.length === 1 && request.method === "DELETE") {
    if (member.role !== "owner") return json5({ error: "forbidden" }, { status: 403 });
    await deletePrefix(env, groupFilesPrefix(groupId));
    await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(chatKey(groupId)).run();
    await env.DB.prepare("DELETE FROM study_group_items WHERE group_id = ?").bind(groupId).run();
    await env.DB.prepare("DELETE FROM study_group_members WHERE group_id = ?").bind(groupId).run();
    await env.DB.prepare("DELETE FROM study_groups WHERE id = ?").bind(groupId).run();
    return json5({ ok: true });
  }
  if (parts[1] === "leave" && parts.length === 2 && request.method === "POST") {
    if (member.role === "owner") {
      return json5({ error: "Owners can delete the group instead of leaving." }, { status: 400 });
    }
    await env.DB.prepare("DELETE FROM study_group_members WHERE group_id = ? AND user_id = ?").bind(groupId, user.id).run();
    return json5({ ok: true });
  }
  if (parts[1] === "members" && parts.length === 3 && request.method === "DELETE") {
    if (member.role !== "owner") return json5({ error: "forbidden" }, { status: 403 });
    const targetId = parts[2];
    if (targetId === user.id) return json5({ error: "Owners cannot remove themselves." }, { status: 400 });
    await env.DB.prepare("DELETE FROM study_group_members WHERE group_id = ? AND user_id = ?").bind(groupId, targetId).run();
    return json5({ ok: true });
  }
  if (parts[1] === "files" && parts[2] === "object" && parts.length === 3 && request.method === "GET") {
    const key = decodeURIComponent(url.searchParams.get("key") || "");
    if (!key || key.includes("..") || !key.startsWith(groupFilesPrefix(groupId))) {
      return json5({ error: "not found" }, { status: 404 });
    }
    const obj = await env.STORAGE.get(key);
    if (!obj) return json5({ error: "not found" }, { status: 404 });
    const name = obj.customMetadata?.filename || key.split("/").pop() || "file";
    const headers = new Headers();
    headers.set("Content-Type", obj.httpMetadata?.contentType || guessMime(name));
    headers.set("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
    return new Response(obj.body, { headers });
  }
  if (parts[1] === "items" && parts.length === 2 && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || "").trim();
    const sourceId = String(body.sourceId || "").trim();
    if (!sourceId) return json5({ error: "sourceId required" }, { status: 400 });
    if (kind === "skill") return shareSkill(env, user, groupId, sourceId);
    if (kind === "file") return shareFile(env, user, groupId, sourceId);
    if (kind === "note") return shareNote(env, user, groupId, sourceId);
    if (kind === "deck") return shareDeck(env, user, groupId, sourceId, body.cards);
    return json5({ error: "kind must be skill, file, note, or deck" }, { status: 400 });
  }
  if (parts[1] === "items" && parts.length === 3 && request.method === "DELETE") {
    const item = await env.DB.prepare("SELECT id, shared_by, r2_key FROM study_group_items WHERE id = ? AND group_id = ?").bind(parts[2], groupId).first();
    if (!item) return json5({ error: "not found" }, { status: 404 });
    if (item.shared_by !== user.id && member.role !== "owner") {
      return json5({ error: "forbidden" }, { status: 403 });
    }
    if (item.r2_key) await env.STORAGE.delete(item.r2_key);
    await env.DB.prepare("DELETE FROM study_group_items WHERE id = ?").bind(item.id).run();
    return json5({ ok: true });
  }
  if (parts[1] === "items" && parts[3] === "save" && parts.length === 4 && request.method === "POST") {
    return saveItemToBag(env, user, groupId, parts[2]);
  }
  if (parts[1] === "messages" && parts.length === 2 && request.method === "GET") {
    return json5({ ok: true, messages: await loadMessages(env.DB, groupId) });
  }
  if (parts[1] === "messages" && parts.length === 2 && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const text = String(body.text || "").trim().slice(0, 2e3);
    if (!text) return json5({ error: "text required" }, { status: 400 });
    const messages = await loadMessages(env.DB, groupId);
    const message = {
      id: crypto.randomUUID(),
      userId: user.id,
      email: user.email,
      text,
      created: Date.now()
    };
    messages.push(message);
    await saveMessages(env.DB, groupId, messages);
    return json5({ ok: true, message });
  }
  return json5({ error: "not found" }, { status: 404 });
}
__name(handleGroupRoutes, "handleGroupRoutes");

// cloudflare/worker.ts
var BACKEND_PREFIXES = [
  "/_cf/",
  "/api/",
  "/ws/",
  "/chat",
  "/chats",
  "/quiz",
  "/flashcards",
  "/files",
  "/skills",
  "/podcast",
  "/smartnotes",
  "/exam",
  "/exams",
  "/debate",
  "/debates",
  "/tasks",
  "/planner",
  "/sessions",
  "/reminders",
  "/slots",
  "/transcriber",
  "/storage/",
  "/health"
];
var SPA_GET_PATHS = /* @__PURE__ */ new Set(["/chat", "/quiz", "/planner", "/debate", "/exam", "/login", "/signup", "/canvas", "/groups", "/groups/join", "/cards", "/study"]);
function isBackendRoute(pathname, method = "GET") {
  if (method === "GET" && SPA_GET_PATHS.has(pathname)) return false;
  return BACKEND_PREFIXES.some(
    (p) => p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/")
  );
}
__name(isBackendRoute, "isBackendRoute");
function unauthorized2() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
__name(unauthorized2, "unauthorized");
function checkStoreAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(env.CF_STORE_TOKEN && token === env.CF_STORE_TOKEN);
}
__name(checkStoreAuth, "checkStoreAuth");
async function handleKvRoutes(request, env) {
  if (!checkStoreAuth(request, env)) return unauthorized2();
  const url = new URL(request.url);
  const sub = url.pathname.slice("/_cf/kv/".length);
  if (request.method === "GET" && sub && !sub.includes("/")) {
    const row = await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(decodeURIComponent(sub)).first();
    if (!row) {
      return new Response(JSON.stringify({ value: void 0 }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ value: row.value }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (request.method === "PUT" && sub && !sub.includes("/")) {
    const body = await request.json();
    if (body.value === void 0) {
      return new Response(JSON.stringify({ error: "value required" }), { status: 400 });
    }
    await env.DB.prepare(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(decodeURIComponent(sub), body.value).run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (request.method === "DELETE" && sub && !sub.includes("/")) {
    await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(decodeURIComponent(sub)).run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
}
__name(handleKvRoutes, "handleKvRoutes");
function buildContainerEnv(request, env) {
  const origin = env.WORKER_PUBLIC_URL || new URL(request.url).origin;
  const vars = {
    STORAGE_BACKEND: "cloudflare",
    HOST: "0.0.0.0",
    PORT: "5000",
    CF_KV_BASE_URL: origin,
    CF_STORE_TOKEN: String(env.CF_STORE_TOKEN || ""),
    VITE_BACKEND_URL: origin,
    VITE_FRONTEND_URL: origin,
    db_mode: String(env.db_mode || "json"),
    LLM_PROVIDER: String(env.LLM_PROVIDER || "gemini"),
    EMB_PROVIDER: String(env.EMB_PROVIDER || "gemini"),
    TTS_PROVIDER: String(env.TTS_PROVIDER || "gemini")
  };
  if (env.R2_BUCKET_NAME) vars.R2_BUCKET_NAME = String(env.R2_BUCKET_NAME);
  const secretKeys = [
    "gemini",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_EMBED_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
    "MINIMAX_API_KEY",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "ELEVEN_API_KEY",
    "ASSEMBLYAI_API_KEY",
    "gemini_model",
    "gemini_embed_model",
    "GEMINI_TTS_MODEL",
    "TTS_VOICE_GEMINI",
    "TTS_VOICE_ALT_GEMINI",
    "TTS_PROVIDER",
    "TRANSCRIPTION_PROVIDER",
    "ELEVEN_VOICE_A",
    "ELEVEN_VOICE_B"
  ];
  for (const key of secretKeys) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0) vars[key] = val;
  }
  return vars;
}
__name(buildContainerEnv, "buildContainerEnv");
function isWebSocketRequest(request) {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}
__name(isWebSocketRequest, "isWebSocketRequest");
function isContainerWarmupError(text) {
  return /no Container instance available|currently provisioning|suddenly disconnected|Network connection lost|not running|reset because its code was updated|The app is still starting/i.test(text);
}
__name(isContainerWarmupError, "isContainerWarmupError");
var PageLMContainer = class extends Container {
  static {
    __name(this, "PageLMContainer");
  }
  defaultPort = 5e3;
  sleepAfter = "1h";
  enableInternet = true;
  pingEndpoint = "/health";
  onError(error) {
    console.error("[container] error", error);
  }
  async fetch(request) {
    this.envVars = buildContainerEnv(request, this.env);
    try {
      return await super.fetch(request);
    } catch (err) {
      const text = String(err instanceof Error ? err.message : err);
      console.error("[container] fetch failed", err);
      if (!isContainerWarmupError(text)) throw err;
      try {
        await this.startAndWaitForPorts({
          ports: [5e3],
          startOptions: { envVars: this.envVars, enableInternet: true },
          cancellationOptions: {
            instanceGetTimeoutMS: 6e4,
            portReadyTimeoutMS: 9e4
          }
        });
        return await super.fetch(request);
      } catch (startErr) {
        console.error("[container] start wait failed", startErr);
        return containerWarmupResponse();
      }
    }
  }
};
function containerWarmupResponse() {
  return new Response(
    JSON.stringify({
      error: "The app is still starting up. Please wait a few seconds and try again."
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "8"
      }
    }
  );
}
__name(containerWarmupResponse, "containerWarmupResponse");
async function fetchContainer(container, request) {
  if (isWebSocketRequest(request)) {
    return container.fetch(request);
  }
  const replay = await makeReplayableRequest(request);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const last = await container.fetch(replay());
      if (last.ok) return last;
      const text = await last.clone().text().catch(() => "");
      if (!isContainerWarmupError(text) && last.status !== 503) return last;
    } catch (err) {
      const text = String(err instanceof Error ? err.message : err);
      if (!isContainerWarmupError(text) && !/used body/i.test(text)) throw err;
    }
    if (attempt < 7) await scheduler.wait(Math.min(4e3, 800 * (attempt + 1)));
  }
  return containerWarmupResponse();
}
__name(fetchContainer, "fetchContainer");
async function proxyToBackend(request, env, pathname) {
  const container = getContainer(env.PAGELM_BACKEND, "pagelm");
  if (pathname === "/health") {
    return fetchContainer(container, request);
  }
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized2();
  if (request.method === "POST" && pathname === "/transcriber") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "YouTube transcription is temporarily unavailable. Upload an audio or video file instead."
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
  }
  const forwarded = injectUserHeaders(request, user);
  if (!isPromptRequest(request.method, pathname)) {
    return fetchContainer(container, forwarded);
  }
  const quota = await consumePromptQuota(env.DB, user.id, env);
  if (!quota.allowed) return rateLimitedResponse(quota);
  const response = await fetchContainer(container, forwarded);
  if (!quota.warning) return response;
  const headers = new Headers(response.headers);
  applyRateLimitHeaders(headers, quota);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(proxyToBackend, "proxyToBackend");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_cf/kv")) {
      return handleKvRoutes(request, env);
    }
    if (url.pathname.startsWith("/auth")) {
      try {
        const allowSignup = String(env.ALLOW_SIGNUP || "").toLowerCase() === "true";
        const authResponse = await handleAuthRoutes(request, env.DB, url.pathname, { allowSignup });
        if (authResponse) return authResponse;
      } catch (err) {
        console.error("[auth]", err);
        return new Response(JSON.stringify({ error: "auth_failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/canva") {
      return Response.redirect(new URL("/canvas", request.url), 302);
    }
    if (url.pathname === "/files" || url.pathname.startsWith("/files/") || url.pathname.startsWith("/api/files")) {
      try {
        const filesResponse = await handleFileLibraryRoutes(request, env, url.pathname);
        if (filesResponse) return filesResponse;
      } catch (err) {
        console.error("[files]", err);
        return new Response(JSON.stringify({ error: "Could not load files from storage." }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    if (url.pathname === "/skills" || url.pathname.startsWith("/skills/")) {
      try {
        const skillsResponse = await handleSkillRoutes(request, env, url.pathname);
        if (skillsResponse) return skillsResponse;
      } catch (err) {
        console.error("[skills]", err);
        return new Response(JSON.stringify({ error: "Could not load skills." }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    if (url.pathname === "/api/groups" || url.pathname.startsWith("/api/groups/")) {
      try {
        const groupsResponse = await handleGroupRoutes(request, env, url.pathname);
        if (groupsResponse) return groupsResponse;
      } catch (err) {
        console.error("[groups]", err);
        return new Response(JSON.stringify({ error: "Could not load study groups." }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    if (url.pathname.startsWith("/api/canvas")) {
      try {
        const canvasResponse = await handleCanvasRoutes(request, env, url.pathname);
        if (canvasResponse) return canvasResponse;
      } catch (err) {
        console.error("[canvas]", err);
        const msg = err instanceof Error ? err.message : "canvas_failed";
        return new Response(JSON.stringify({ error: msg, canvasError: true }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() === "websocket" || isBackendRoute(url.pathname, request.method)) {
      return proxyToBackend(request, env, url.pathname);
    }
    if (request.method === "GET" && SPA_GET_PATHS.has(url.pathname)) {
      return env.ASSETS.fetch(new URL("/", request.url));
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  PageLMContainer,
  worker_default as default
};
//# sourceMappingURL=worker.js.map
