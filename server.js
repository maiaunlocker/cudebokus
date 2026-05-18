import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
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

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ==================== PROXY UPSTREAM ====================
let UPSTREAM_PROXY = "";

function getAgent(proxy) {
    if (!proxy) return undefined;
    try {
        if (proxy.startsWith('socks')) return new SocksProxyAgent(proxy);
        return new HttpsProxyAgent(proxy);
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
            agent, redirect: "follow", timeout: 10000
        });
        res.json({ success: true, proxy: UPSTREAM_PROXY, status: resp.status, tested: true });
    } catch (err) {
        res.json({ success: false, proxy: UPSTREAM_PROXY, error: err.message, tested: false });
    }
});

// ==================== PROXY REVERSO ====================
app.get("/proxy", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("URL não fornecida");

    const agent = getAgent(UPSTREAM_PROXY);

    try {
        console.log(`[PROXY] Acessando: ${url}`);

        const response = await fetch(url, {
            agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            },
            redirect: 'follow',
            timeout: 30000
        });

        const contentType = response.headers.get('content-type') || '';

        // ========== Montar headers limpos ==========
        const headersPermitidos = [
            'content-type', 'content-length', 'last-modified',
            'etag', 'vary', 'date'
        ];

        headersPermitidos.forEach(h => {
            const val = response.headers.get(h);
            if (val) res.setHeader(h, val);
        });

        // ========== HTML: reescrever URLs ==========
        if (contentType.includes('text/html')) {
            let html = await response.text();
            const baseUrl = new URL(url);

            // Remove atributos de segurança
            html = html
                .replace(/integrity="[^"]*"/gi, '')
                .replace(/nonce="[^"]*"/gi, '')
                .replace(/crossorigin="[^"]*"/gi, '')
                .replace(/<meta[^>]*content-security-policy[^>]*>/gi, '');

            // Função para proxificar URL
            function proxify(u) {
                if (!u) return u;
                if (u.startsWith('data:') || u.startsWith('javascript:') || u.startsWith('#') || u.startsWith('mailto:') || u.startsWith('blob:')) return u;
                try {
                    if (u.startsWith('//')) u = baseUrl.protocol + u;
                    else if (u.startsWith('/')) u = baseUrl.origin + u;
                    else if (!u.startsWith('http')) u = new URL(u, baseUrl).href;
                    return `/proxy?url=${encodeURIComponent(u)}`;
                } catch { return u; }
            }

            // Reescrever src, href, srcset, action, url() CSS
            html = html
                .replace(/src=["']([^"']+)["']/gi, (_, u) => `src="${proxify(u)}"`)
                .replace(/href=["']([^"']+)["']/gi, (_, u) => `href="${proxify(u)}"`)
                .replace(/action=["']([^"']+)["']/gi, (_, u) => `action="${proxify(u)}"`)
                .replace(/srcset=["']([^"']+)["']/gi, (_, s) => {
                    const rewritten = s.split(',').map(part => {
                        const [u, ...rest] = part.trim().split(/\s+/);
                        return `${proxify(u)} ${rest.join(' ')}`.trim();
                    }).join(', ');
                    return `srcset="${rewritten}"`;
                })
                .replace(/url\(["']?([^"')]+)["']?\)/gi, (_, u) => `url(${proxify(u)})`);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        }

        // ========== CSS: reescrever URLs ==========
        if (contentType.includes('text/css')) {
            let css = await response.text();
            const baseUrl = new URL(url);

            css = css
                .replace(/url\(["']?([^"')]+)["']?\)/gi, (_, u) => {
                    if (!u || u.startsWith('data:')) return `url(${u})`;
                    try {
                        if (u.startsWith('//')) u = baseUrl.protocol + u;
                        else if (u.startsWith('/')) u = baseUrl.origin + u;
                        else if (!u.startsWith('http')) u = new URL(u, baseUrl).href;
                        return `url(/proxy?url=${encodeURIComponent(u)})`;
                    } catch { return `url(${u})`; }
                })
                .replace(/@import\s+["']([^"']+)["']/gi, (_, u) => {
                    try {
                        if (u.startsWith('/')) u = new URL(url).origin + u;
                        else if (!u.startsWith('http')) u = new URL(u, url).href;
                        return `@import "/proxy?url=${encodeURIComponent(u)}"`;
                    } catch { return `@import "${u}"`; }
                });

            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            return res.send(css);
        }

        // ========== Outros tipos: repassar direto ==========
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);

    } catch (err) {
        console.error("[ERRO PROXY]", err.message);
        res.status(500).send(`
            <html>
            <head><meta charset="UTF-8"></head>
            <body style="font-family:Arial;padding:40px;text-align:center;background:#1e3c72;color:white;">
                <h2>❌ Erro ao carregar página</h2>
                <p>${err.message}</p>
                <p><small>URL: ${url}</small></p>
            </body>
            </html>
        `);
    }
});

// ==================== SERVIDOR ====================
const server = createServer(app);

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Web Proxy Iniciado              ║
║   📡 Porta: ${PORT}                      ║
║   🌐 URL: http://localhost:${PORT}      ║
╚═══════════════════════════════════════╝
    `);
});

process.on('unhandledRejection', (err) => console.error('[ERRO]', err.message));
process.on('uncaughtException', (err) => console.error('[EXCEÇÃO]', err.message));
