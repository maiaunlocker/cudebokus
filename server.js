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

// Servir arquivos do Ultraviolet
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
        return res.json({ success: true, proxy: "removido" });
    }

    UPSTREAM_PROXY = proxy.trim();
    const agent = getAgent(UPSTREAM_PROXY);

    try {
        const resp = await fetch("https://www.google.com", {
            agent,
            redirect: "follow",
            timeout: 10000
        });
        res.json({
            success: true,
            proxy: UPSTREAM_PROXY,
            status: resp.status,
            tested: true
        });
    } catch (err) {
        res.json({
            success: false,
            proxy: UPSTREAM_PROXY,
            error: err.message,
            tested: false
        });
    }
});

// ==================== BARE SERVER ====================
// Intercepta as requisições do UV e aplica o proxy upstream
app.use("/uv/service/", async (req, res) => {
    // Só aceitar requisições do UV (com header X-Bare-URL)
    const bareURL = req.headers["x-bare-url"];
    if (!bareURL) {
        return res.status(400).send("Missing X-Bare-URL header");
    }

    // Decodificar URL alvo
    const targetURL = decodeURIComponent(bareURL);

    // Recuperar agent do proxy configurado
    const agent = getAgent(UPSTREAM_PROXY);

    try {
        // Construir headers para a requisição real
        const reqHeaders = {};
        if (req.headers["x-bare-headers"]) {
            try {
                const bareHeaders = JSON.parse(req.headers["x-bare-headers"]);
                Object.assign(reqHeaders, bareHeaders);
            } catch (e) {}
        }

        // Adicionar user-agent se necessário
        if (!reqHeaders["user-agent"]) {
            reqHeaders["user-agent"] =
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        }

        // Opções da requisição
        const fetchOptions = {
            method: req.method,
            headers: reqHeaders,
            agent,
            redirect: "follow",
            timeout: 30000
        };

        // Se houver body, incluir
        if (req.method === "POST" || req.method === "PUT") {
            fetchOptions.body = req.body; // express já parseou
        }

        // Fazer a requisição real
        const response = await fetch(targetURL, fetchOptions);

        // Construir headers de resposta (removendo bloqueadores)
        const resHeaders = {};
        response.headers.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            // Remover headers que quebram o proxy
            if (
                lowerKey === "content-encoding" ||
                lowerKey === "content-security-policy" ||
                lowerKey === "content-security-policy-report-only" ||
                lowerKey === "x-frame-options" ||
                lowerKey === "access-control-allow-origin" ||
                lowerKey === "access-control-allow-credentials"
            ) {
                return;
            }
            resHeaders[key] = value;
        });

        // Adicionar headers do bare protocol
        resHeaders["x-bare-status"] = response.status;
        resHeaders["x-bare-status-text"] = response.statusText;

        // Enviar resposta
        res.writeHead(response.status, response.statusText, resHeaders);

        // Pipe do corpo
        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(buffer);
    } catch (err) {
        console.error("[BARE-ERROR]", err.message);
        res.writeHead(500, {
            "x-bare-status": 500,
            "x-bare-status-text": "Internal Server Error",
            "content-type": "text/plain"
        });
        res.end("Bare server error: " + err.message);
    }
});

// ==================== SERVIDOR HTTP/WISP ====================
const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
    if (req.url.endsWith("/wisp/")) {
        wisp.routeRequest(req, socket, head);
    }
});

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Web Proxy (UV + Proxy Upstream) ║
║   📡 Porta: ${PORT}                      ║
║   🌐 URL: http://localhost:${PORT}      ║
╚═══════════════════════════════════════╝
    `);
});
