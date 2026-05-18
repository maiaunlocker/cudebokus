import express from "express";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(express.static(__dirname));

// Desabilitar verificação SSL (apenas para desenvolvimento)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Variável global do proxy
let UPSTREAM_PROXY = "";

// Função para criar agente apropriado
function getAgent(proxy) {
    if (!proxy) return undefined;

    try {
        if (proxy.startsWith('socks')) {
            return new SocksProxyAgent(proxy);
        } else {
            return new HttpsProxyAgent(proxy);
        }
    } catch (err) {
        console.error("Erro ao criar agente:", err.message);
        return undefined;
    }
}

// Servir index.html
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Endpoint para configurar proxy
app.post("/set-proxy", async (req, res) => {
    const { proxy } = req.body;

    if (!proxy) {
        UPSTREAM_PROXY = "";
        return res.json({ 
            success: true, 
            proxy: "removido",
            message: "Proxy removido com sucesso"
        });
    }

    UPSTREAM_PROXY = proxy.trim();
    const agent = getAgent(UPSTREAM_PROXY);

    // Testar proxy
    try {
        const response = await fetch("https://www.google.com", {
            agent,
            redirect: "follow",
            timeout: 10000
        });

        res.json({
            success: true,
            proxy: UPSTREAM_PROXY,
            status: response.status,
            tested: true,
            message: "Proxy testado e funcionando"
        });
    } catch (err) {
        console.error("Erro ao testar proxy:", err.message);
        res.json({
            success: false,
            proxy: UPSTREAM_PROXY,
            error: err.message,
            tested: false,
            message: "Proxy configurado mas não testado"
        });
    }
});

// Proxy principal
app.get("/proxy", async (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Erro</title>
                <style>
                    body { font-family: Arial; padding: 40px; text-align: center; background: #f8f9fa; }
                    h2 { color: #dc3545; }
                </style>
            </head>
            <body>
                <h2>❌ URL inválida ou não fornecida</h2>
                <p>Volte e digite uma URL válida.</p>
            </body>
            </html>
        `);
    }

    const agent = getAgent(UPSTREAM_PROXY);

    try {
        console.log(`[PROXY] Acessando: ${url} ${UPSTREAM_PROXY ? `via ${UPSTREAM_PROXY}` : 'direto'}`);

        const response = await fetch(url, {
            agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'follow',
            timeout: 30000
        });

        const contentType = response.headers.get('content-type') || '';

        // Se for HTML, fazer reescrita de URLs
        if (contentType.includes('text/html')) {
            let html = await response.text();

            // Reescrever URLs relativas para usar o proxy
            const baseUrl = new URL(url);
            
            // Reescrever href e src
            html = html.replace(/href=["']\/([^"']*?)["']/g, (match, path) => {
                if (path.startsWith('http')) return match;
                return `href="/proxy?url=${encodeURIComponent(baseUrl.origin + '/' + path)}"`;
            });

            html = html.replace(/src=["']\/([^"']*?)["']/g, (match, path) => {
                if (path.startsWith('http')) return match;
                return `src="/proxy?url=${encodeURIComponent(baseUrl.origin + '/' + path)}"`;
            });

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            // Para outros tipos, apenas repassar
            const buffer = await response.buffer();
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', buffer.length);
            res.send(buffer);
        }

    } catch (err) {
        console.error("[ERRO]", err.message);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Erro no Proxy</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        padding: 40px; 
                        text-align: center; 
                        background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                        color: white;
                    }
                    h2 { color: #ff6b6b; margin-bottom: 20px; }
                    .error-box {
                        background: rgba(0,0,0,0.3);
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px auto;
                        max-width: 500px;
                    }
                    .error-detail {
                        font-family: monospace;
                        background: rgba(0,0,0,0.5);
                        padding: 10px;
                        border-radius: 5px;
                        margin: 10px 0;
                        text-align: left;
                        overflow-wrap: break-word;
                    }
                </style>
            </head>
            <body>
                <h2>❌ Erro ao carregar página</h2>
                <div class="error-box">
                    <p><strong>Erro:</strong></p>
                    <div class="error-detail">${escapeHtml(err.message)}</div>
                    <p><strong>URL:</strong></p>
                    <div class="error-detail">${escapeHtml(url)}</div>
                    ${UPSTREAM_PROXY ? `
                        <p><strong>Proxy:</strong></p>
                        <div class="error-detail">${escapeHtml(UPSTREAM_PROXY)}</div>
                    ` : ''}
                    <p style="margin-top: 20px; font-size: 12px; opacity: 0.8;">
                        Verifique se a URL está correta e se o proxy está funcionando.
                    </p>
                </div>
            </body>
            </html>
        `);
    }
});

// Função para escapar HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Web Proxy Servidor Iniciado     ║
║   📡 Porta: ${PORT}                      ║
║   🌐 URL: http://localhost:${PORT}      ║
╚═══════════════════════════════════════╝
    `);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (err) => {
    console.error('[ERRO NÃO CAPTURADO]', err);
});

process.on('uncaughtException', (err) => {
    console.error('[EXCEÇÃO NÃO CAPTURADA]', err);
});
