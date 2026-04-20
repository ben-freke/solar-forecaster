import { createServer, type Server } from "node:http";
import { register } from "./metrics.js";
import type { Logger } from "./logger.js";

export function createMetricsServer(logger: Logger): Server {
  return createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return;
    }
    if (url === "/metrics") {
      register
        .metrics()
        .then((body) => {
          res.statusCode = 200;
          res.setHeader("Content-Type", register.contentType);
          res.end(body);
        })
        .catch((err: Error) => {
          logger.error({ err: err.message }, "failed to render metrics");
          res.statusCode = 500;
          res.end(err.message);
        });
      return;
    }
    if (url === "/healthz") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("ok");
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}
