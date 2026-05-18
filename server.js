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
        return res.json({ success: true, proxy: "removido" });
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

// Proxy principal
app.get("/proxy", async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).send("❌ URL inválida ou não fornecida");
    }

    const agent = getAgent(UPSTREAM_PROXY);

    try {
        console.log(`Acessando: ${url} ${UPSTREAM_PROXY ? `via proxy ${UPSTREAM_PROXY}` : 'direto'}`);
        
        const response = await fetch(url, { 
            agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            redirect: 'follow',
            timeout: 30000
        });

        const contentType = response.headers.get('content-type') || '';
        
        // Se for HTML, fazer reescrita de URLs
        if (contentType.includes('text/html')) {
            let html = await response.text();
            
            // Reescrever URLs relativas
            const baseUrl = new URL(url);
            html = html.replace(/(href|src)="\/([^"]*)"/g, 
                `$1="${baseUrl.origin}/$2"`);
            
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            // Para outros tipos, apenas repassar
            const buffer = await response.buffer();
            res.setHeader('Content-Type', contentType);
            res.send(buffer);
        }
        
    } catch (err) {
        console.error("Erro no proxy:", err.message);
        res.status(500).send(`
            <div style="font-family: Arial; padding: 40px; text-align: center;">
                <h2>❌ Erro ao carregar página</h2>
                <p>${err.message}</p>
                <p style="color: #666;">URL: ${url}</p>
                ${UPSTREAM_PROXY ? `<p style="color: #666;">Proxy: ${UPSTREAM_PROXY}</p>` : ''}
            </div>
        `);
    }
});

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
