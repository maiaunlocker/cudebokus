import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import wisp from "wisp-server-node";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(compression());
app.use(express.static(__dirname));

// Servir arquivos do Ultraviolet (frontend)
app.use("/uv/", express.static(uvPath));

// Página inicial
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Criar servidor HTTP + WebSocket
const server = createServer(app);

// Wisp – encaminha WebSocket para o Ultraviolet
server.on("upgrade", (req, socket, head) => {
    if (req.url.endsWith("/wisp/")) {
        wisp.routeRequest(req, socket, head);
    }
});

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Web Proxy (UV) Iniciado         ║
║   📡 Porta: ${PORT}                      ║
║   🌐 URL: http://localhost:${PORT}      ║
╚═══════════════════════════════════════╝
    `);
});
