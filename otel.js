// otel.js
require('dotenv').config();

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

// Exporters (HTTP OTLP). Provide sensible defaults for local dev (collector on 4318).
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');

const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { logs } = require('@opentelemetry/api-logs');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto'); // ✅ use the protobuf exporter

// don't require sdk-trace-base to keep dependencies minimal; provide a small console stub when OTLP is disabled

// service name can be provided via OTEL_SERVICE_NAME env var; NodeSDK will derive the resource automatically.

// Build exporter URLs with defaults to local collector (4318)
const tracesUrl = (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || '').trim();
const metricsUrl = (process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || '').trim();
const logsUrl = (process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || '').trim();

console.log('OTEL endpoints:', { tracesUrl, metricsUrl, logsUrl });


// Create exporters. If the environment explicitly disables OTLP (DISABLE_OTLP=true), fall back to console exporters.
const disableOtlp = String(process.env.DISABLE_OTLP || '').toLowerCase() === 'true';

let traceExporter;
let metricExporter;
let logExporter;

if (disableOtlp) {
  traceExporter = {
    export: (spans, resultCallback) => {
      try {
        console.log('[OTEL DEBUG] exporting spans batch');
        resultCallback({ code: 0 });
      } catch (e) {
        resultCallback({ code: 1, error: e });
      }
    },
    shutdown: async () => {},
  };
  // simple console metric exporter stub (implements export(metrics, resultCallback))
  metricExporter = {
    export: (metrics, resultCallback) => {
      try {
        // metrics is a collection; print a summary message to avoid huge output
        console.log('[OTEL DEBUG] exporting metrics batch, items:', (metrics && metrics.resourceMetrics) ? metrics.resourceMetrics.length : '(unknown)');
        resultCallback({ code: 0 });
      } catch (e) {
        resultCallback({ code: 1, error: e });
      }
    },
    shutdown: async () => {},
  };
  // log exporter will be handled below by a simple console exporter object
} else {
  traceExporter = new OTLPTraceExporter({ url: tracesUrl });
  metricExporter = new OTLPMetricExporter({ url: metricsUrl });
  logExporter = new OTLPLogExporter({
    url: logsUrl,
  });
}

// --- Logs setup (new API). Use Batch processor for scalability.
const loggerProvider = new LoggerProvider();
if (logExporter) {
  // register a batch processor on the provider (SDK version may not expose an addProcessor helper)
  const batchProcessor = new BatchLogRecordProcessor(logExporter, {
    // tune for reasonable latency and throughput
    maxExportBatchSize: 512,
    scheduledDelayMillis: 2000,
  });
  loggerProvider._sharedState.registeredLogRecordProcessors.push(batchProcessor);
  loggerProvider._sharedState.activeProcessor = batchProcessor;
} 
// If we didn't create a real OTLP log exporter above (disableOtlp case), create a console exporter object
if (!logExporter) {
  const { SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs');
  const consoleLogExporter = {
    export: (logRecords, resultCallback) => {
      try {
        for (const lr of logRecords) {
          // keep output concise
          const body = typeof lr.body === 'string' ? lr.body : JSON.stringify(lr.body);
          console.log(`[log:${lr.severityText}]`, body);
        }
        resultCallback({ code: 0 });
      } catch (e) {
        resultCallback({ code: 1, error: e });
      }
    },
    shutdown: async () => {},
  };
  const simpleProcessor = new SimpleLogRecordProcessor(consoleLogExporter);
  loggerProvider._sharedState.registeredLogRecordProcessors.push(simpleProcessor);
  loggerProvider._sharedState.activeProcessor = simpleProcessor;
}
logs.setGlobalLoggerProvider(loggerProvider);
const logger = logs.getLogger('global-logger');

// --- SDK setup
const sdk = new NodeSDK({
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()],
  metrics: {
    reader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: Number(process.env.METRIC_EXPORT_INTERVAL_MS) || 10000,
    }),
  },
});

// Start SDK with error handling
const sdkStartResult = sdk.start();
if (sdkStartResult && typeof sdkStartResult.then === 'function') {
  sdkStartResult
    .then(() => console.log('✅ OpenTelemetry initialized'))
    .catch((err) => console.error('❌ Failed to start OpenTelemetry SDK', err));
} else {
  // synchronous start (older/newer SDK behavior) — assume success
  console.log('✅ OpenTelemetry initialized 2');
}

// --- Intercept console methods globally: emit to OTel logs and preserve original behavior
const originalConsole = {
  log: console.log.bind(console),
  debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  info: console.info ? console.info.bind(console) : console.log.bind(console),
  warn: console.warn ? console.warn.bind(console) : console.log.bind(console),
  error: console.error ? console.error.bind(console) : console.log.bind(console),
};

const emitOtelLog = (severityText, args) => {
  try {
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logger.emit({ severityText, body: msg });
  } catch (e) {
    // swallow logging errors to avoid infinite loops
    originalConsole.log('otel console emit error', e);
  }
};

console.debug = (...args) => {
  emitOtelLog('DEBUG', args);
  originalConsole.debug(...args);
};
console.info = (...args) => {
  emitOtelLog('INFO', args);
  originalConsole.info(...args);
};
console.log = (...args) => {
  emitOtelLog('INFO', args);
  originalConsole.log(...args);
};
console.warn = (...args) => {
  emitOtelLog('WARN', args);
  originalConsole.warn(...args);
};
console.error = (...args) => {
  emitOtelLog('ERROR', args);
  originalConsole.error(...args);
};

// --- Graceful shutdown / flush on signals and uncaught errors
const shutdown = async (signal) => {
  try {
    console.log(`🛑 Shutting down OTel due to ${signal}...`);
    await sdk.shutdown();
  } catch (err) {
    console.error('Error during OpenTelemetry shutdown', err);
  } finally {
    // allow process to exit naturally after cleanup
    process.exit(0);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', async (err) => {
  console.error('Uncaught exception', err);
  await shutdown('uncaughtException');
});
process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled rejection', reason);
  await shutdown('unhandledRejection');
});
