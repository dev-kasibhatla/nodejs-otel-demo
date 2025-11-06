# nodejs-otel-demo

Minimal OpenTelemetry demo for Node.js with OTLP exporters and VictoriaLogs compatibility.

This repository contains a small Node.js app instrumented with the OpenTelemetry SDK. The `otel.js` module configures OTLP exporters for traces, metrics, and logs. The project is configured to send logs using the protobuf-based exporters so VictoriaLogs can accept them on the `/insert/opentelemetry/v1/logs` endpoint.

## Files of interest

- `otel.js` — OpenTelemetry SDK setup and exporters (traces, metrics, logs). This file also intercepts global `console` methods and emits OTel log records.
- `index.js` — (app entry) example application file. Run your normal app entry point to use the instrumentation.
- `docker-compose.yml` — optional local environment with services (if present).

## Requirements

- Node.js 18+ recommended
- npm or yarn
- VictoriaLogs (or a compatible OTLP collector) configured to accept OTLP/HTTP+protobuf on the logs endpoint

## Important environment variables

Set environment variables in your shell or in a `.env` file. Key variables used by `otel.js`:

- `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`
  - Purpose: Select the transport and encoding for logs.
  - Recommended value for VictoriaLogs: `http/protobuf`
  - Valid values: `grpc`, `http/protobuf`, `http/json`
  - Example: `export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf`

- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
  - Purpose: Full URL of the OTLP logs endpoint. Example: `http://localhost:4318/v1/logs` or the base collector URL depending on SDK.
  - When empty, the SDK may derive a default.

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
  - Purpose: Endpoint used by the traces exporter.

- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`
  - Purpose: Endpoint used by the metrics exporter.

- `METRIC_EXPORT_INTERVAL_MS`
  - Purpose: Interval in milliseconds for metrics export. Defaults to `10000` in `otel.js`.

- `DISABLE_OTLP`
  - Purpose: When set to `true`, `otel.js` will use console-based stub exporters instead of OTLP.
  - Example: `export DISABLE_OTLP=true`

- `OTEL_SERVICE_NAME`
  - Purpose: Sets the service name attached to telemetry resources. The SDK can also derive a default if not set.

## What `otel.js` does (concise)

- Creates OTLP exporters for traces, metrics, and logs.
- Uses the protobuf exporters by default so logs are sent using protobuf encoding.
- Registers a `BatchLogRecordProcessor` for the log exporter with reasonable defaults (`maxExportBatchSize: 512`, `scheduledDelayMillis: 2000`).
- Intercepts global console methods (`debug`, `info`, `log`, `warn`, `error`) and emits corresponding OpenTelemetry log records with matching severity (`DEBUG`, `INFO`, `WARN`, `ERROR`). The original console behavior is preserved.
- Provides graceful shutdown handling on `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection`.

## How to run locally

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables. For VictoriaLogs compatibility add at least:

```bash
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://<victoria-logs-host>:4318/v1/logs
# Optional:
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://<collector-host>:4318/v1/traces
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://<collector-host>:4318/v1/metrics
```

3. Start your app (example):

```bash
node index.js
```

If you use `docker-compose`, bring up the stack with `docker-compose up` and ensure the VictoriaLogs container is reachable from your Node app.

## Verification and troubleshooting

1. VictoriaLogs warning seen when logs are JSON

If you see a warning like:

```
json encoding isn't supported for opentelemetry format. Use protobuf encoding
```

Then the SDK is sending logs in JSON encoding. Confirm the SDK transport selection by setting `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf` and restart the app.

2. Confirm the app is sending logs

- Tail VictoriaLogs or collector logs to see incoming inserts.
- If running locally, use `docker logs -f <victoria-logs-container>` or the collector logs.
- Inspect the app console output: `otel.js` preserves the original `console` output and also emits OTel logs.

3. Confirm correct exporter configuration

- Ensure `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` points to the correct host and port and that the service can reach it.
- When `DISABLE_OTLP=true`, the SDK uses console exporters and will not send OTLP data.

## Notes and tips

- Using `http/protobuf` is the simplest way to ensure VictoriaLogs accepts the logs on the HTTP OTLP path.
- The repository includes a pragmatic default for batch sizes and delays for log export. Tune these values for production.
- The app intercepts console calls. Avoid emitting extremely large objects to console on production paths to prevent high memory usage when serializing.

## Example `.env` snippet

```
OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
METRIC_EXPORT_INTERVAL_MS=10000
DISABLE_OTLP=false
OTEL_SERVICE_NAME=nodejs-otel-demo
```

## Further work

- Add a small smoke test that emits a test log and verifies reception in VictoriaLogs.
- Add CI checks to ensure the app starts and the SDK initializes without errors.

---

If you want, I can also add a small verification script that emits a test log record and checks the collector or VictoriaLogs for receipt. Tell me which collector endpoint you want to target and I will add it.
