import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import wisp from "wisp-server-node";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

const app = express();
const PORT = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== MIDDLEWARES ====================
app.use(compression());
app.use(express.json());
app.use(express.static(__dirname));

// ==================== ULTRAVIOLET ====================
// Servir arquivos estáticos do UV
app.use("/uv/", express.static(uvPath));

// ==================== PROXY UPSTREAM ====================
let UPSTREAM_PROXY = "";

function getAgent(proxy) {
    if (!proxy) return undefined;
    try {
        if (proxy.startsWith('socks')) {
            return new SocksProxyAgent(proxy);
        } else {
            return new HttpsProxyAgent(proxy);
        }
    } catch (err) {
        console.error("[AGENTE] Erro:", err.message);
        return undefined;
    }
}

// ==================== ROTA PRINCIPAL ====================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ==================== VALIDAÇÃO DO PROXY ====================
app.post("/set-proxy", async (req, res) => {
    const { proxy } = req.body;

    if (!proxy) {
        UPSTREAM_PROXY = "";
        console.log('[PROXY] Proxy removido');
        return res.json({ success: true, proxy: "removido" });
    }

    UPSTREAM_PROXY = proxy.trim();
    console.log('[PROXY] Configurado:', UPSTREAM_PROXY);

    const agent = getAgent(UPSTREAM_PROXY);

    try {
        const resp = await fetch("https://www.google.com", {
            agent,
            redirect: "follow",
            timeout: 10000
        });
        console.log('[PROXY] ✅ Testado com sucesso. Status:', resp.status);
        res.json({
            success: true,
            proxy: UPSTREAM_PROXY,
            status: resp.status,
            tested: true
        });
    } catch (err) {
        console.error('[PROXY] ❌ Falhou:', err.message);
        res.json({
            success: false,
            proxy: UPSTREAM_PROXY,
            error: err.message,
            tested: false
        });
    }
});

// ==================== SERVIDOR HTTP + WISP ====================
const server = createServer(app);

// O Wisp intercepta WebSocket e o UV usa isso para fazer
// todas as requisições (CSS, JS, imagens, etc)
server.on("upgrade", (req, socket, head) => {
    if (req.url.endsWith("/wisp/")) {
        console.log('[WISP] Conexão WebSocket recebida');
        wisp.routeRequest(req, socket, head);
    } else {
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Web Proxy (UV + Wisp)           ║
║   📡 Porta: ${PORT}                      ║
║   🌐 URL: http://localhost:${PORT}      ║
╚═══════════════════════════════════════╝
    `);
});

// ==================== ERROS GLOBAIS ====================
process.on('unhandledRejection', (err) => {
    console.error('[ERRO]', err.message);
});

process.on('uncaughtException', (err) => {
    console.error('[EXCEÇÃO]', err.message);
});
