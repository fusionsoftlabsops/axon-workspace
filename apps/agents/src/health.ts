/**
 * Endpoint de salud mínimo (node:http, sin frameworks) para que fusion-infra
 * pueda health-checkear el worker (healthCheckPath=/health). Refleja el estado
 * real: enabled + suscripción activa + contadores básicos.
 */
import { createServer, type Server } from 'node:http';

export interface HealthState {
  enabled: boolean;
  subscribed: boolean;
  eventsReceived: number;
  eventsDispatched: number;
  startedAt: string;
}

export function createHealthServer(state: HealthState, port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'axon-agents', ...state }));
      return;
    }
    if (req.url === '/pong') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pong: true }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(port, () => console.log(`[agents] health on :${port}/health`));
  return server;
}
