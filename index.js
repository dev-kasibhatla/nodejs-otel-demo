// index.js
require('./otel');  // must be first

const { context, trace } = require('@opentelemetry/api');
const { metrics } = require('@opentelemetry/api');

const meter = metrics.getMeter('example-meter');
const counter = meter.createCounter('dummy_counter', {
  description: 'Counts dummy iterations',
});

const tracer = trace.getTracer('example-tracer');

console.log('🚀 Server running. Logs/metrics/traces will emit every 5s.');

setInterval(() => {
  const span = tracer.startSpan('dummy-operation');
  context.with(trace.setSpan(context.active(), span), () => {
    console.log('Running dummy workload at', new Date().toISOString());
    counter.add(1, { 'iteration.timestamp': new Date().toISOString() });
    span.addEvent('Did some work');
    span.end();
  });
}, 5000);
