import express from "express";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

// ==================== CONFIGURAÇÕES INICIAIS ====================
const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== MIDDLEWARES ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(express.static(__dirname));

// ==================== CONFIGURAÇÕES DE SEGURANÇA ====================
// Desabilitar verificação SSL (apenas para desenvolvimento)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ==================== VARIÁVEIS GLOBAIS ====================
let UPSTREAM_PROXY = "";

// ==================== FUNÇÕES UTILITÁRIAS ====================

/**
 * Cria um agente HTTP/HTTPS apropriado baseado no tipo de proxy
 * @param {string} proxy - URL do proxy (http://, https://, ou socks5://)
 * @returns {Object|undefined} - Agente ou undefined se não houver proxy
 */
function getAgent(proxy) {
    if (!proxy) return undefined;

    try {
        if (proxy.startsWith('socks')) {
            console.log('[AGENTE] Criando agente SOCKS5');
            return new SocksProxyAgent(proxy);
        } else {
            console.log('[AGENTE] Criando agente HTTPS/HTTP');
            return new HttpsProxyAgent(proxy);
        }
    } catch (err) {
        console.error("[AGENTE] Erro ao criar agente:", err.message);
        return undefined;
    }
}

/**
 * Escapa caracteres HTML perigosos para evitar injeção
 * @param {string} text - Texto a ser escapado
 * @returns {string} - Texto escapado
 */
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

/**
 * Gera uma página HTML de erro formatada
 * @param {string} mensagem - Mensagem de erro
 * @param {string} url - URL que causou o erro
 * @param {string} proxy - Proxy usado (opcional)
 * @returns {string} - HTML formatado
 */
function gerarPaginaErro(mensagem, url, proxy = null) {
    return `
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
                <div class="error-detail">${escapeHtml(mensagem)}</div>
                <p><strong>URL:</strong></p>
                <div class="error-detail">${escapeHtml(url)}</div>
                ${proxy ? `
                    <p><strong>Proxy:</strong></p>
                    <div class="error-detail">${escapeHtml(proxy)}</div>
                ` : ''}
                <p style="margin-top: 20px; font-size: 12px; opacity: 0.8;">
                    Verifique se a URL está correta e se o proxy está funcionando.
                </p>
            </div>
        </body>
        </html>
    `;
}

// ==================== ROTAS ====================

/**
 * ROTA GET /
 * Serve o arquivo index.html na raiz
 */
app.get("/", (req, res) => {
    console.log('[ROTA] GET / - Servindo index.html');
    res.sendFile(path.join(__dirname, "index.html"));
});

/**
 * ROTA POST /set-proxy
 * Configura o proxy upstream e testa sua conexão
 * 
 * Body esperado: { proxy: "http://user:pass@host:port" }
 * 
 * Resposta:
 * - success: true - Proxy funciona
 * - success: false - Proxy não funciona
 */
app.post("/set-proxy", async (req, res) => {
    console.log('[ROTA] POST /set-proxy');
    
    const { proxy } = req.body;

    // ========== Se vazio, remover proxy ==========
    if (!proxy) {
        UPSTREAM_PROXY = "";
        console.log('[PROXY] Proxy removido');
        return res.json({ 
            success: true, 
            proxy: "removido",
            message: "Proxy removido com sucesso"
        });
    }

    // ========== Configurar novo proxy ==========
    UPSTREAM_PROXY = proxy.trim();
    console.log('[PROXY] Novo proxy configurado:', UPSTREAM_PROXY);
    
    const agent = getAgent(UPSTREAM_PROXY);

    // ========== Testar proxy ==========
    try {
        console.log('[TESTE] Testando proxy com Google...');
        
        const response = await fetch("https://www.google.com", {
            agent,
            redirect: "follow",
            timeout: 10000
        });

        console.log('[TESTE] ✅ Sucesso! Status:', response.status);
        
        res.json({
            success: true,
            proxy: UPSTREAM_PROXY,
            status: response.status,
            tested: true,
            message: "Proxy testado e funcionando"
        });

    } catch (err) {
        console.error("[TESTE] ❌ Falha ao testar proxy:", err.message);
        
        res.json({
            success: false,
            proxy: UPSTREAM_PROXY,
            error: err.message,
            tested: false,
            message: "Proxy configurado mas não testado"
        });
    }
});

/**
 * ROTA GET /proxy
 * Proxy principal que carrega URLs através do proxy upstream
 * 
 * Query params: ?url=<URL_CODIFICADA>
 * 
 * Funcionalidades:
 * - Reescreve URLs relativas em HTML
 * - Passa através de arquivos (imagens, CSS, JS)
 * - Trata erros apropriadamente
 */
app.get("/proxy", async (req, res) => {
    const url = req.query.url;

    // ========== Validar URL ==========
    if (!url) {
        console.log('[PROXY] ❌ URL inválida');
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
        console.log(`[PROXY] Acessando: ${url}`);
        if (UPSTREAM_PROXY) {
            console.log(`[PROXY] Usando proxy: ${UPSTREAM_PROXY}`);
        } else {
            console.log('[PROXY] Acesso direto (sem proxy)');
        }

        // ========== Fazer requisição ==========
        const response = await fetch(url, {
            agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'follow',
            timeout: 30000
        });

        const contentType = response.headers.get('content-type') || '';
        console.log(`[RESPOSTA] Content-Type: ${contentType}`);

        // ========== Se for HTML, reescrever URLs ==========
        if (contentType.includes('text/html')) {
            console.log('[HTML] Reescrevendo URLs relativas...');
            
            let html = await response.text();
            const baseUrl = new URL(url);

            // Reescrever href
            html = html.replace(/href=["']\/([^"']*?)["']/g, (match, path) => {
                if (path.startsWith('http')) return match;
                const novaUrl = baseUrl.origin + '/' + path;
                console.log(`[REESCREVER] href: /${path} -> ${novaUrl}`);
                return `href="/proxy?url=${encodeURIComponent(novaUrl)}"`;
            });

            // Reescrever src
            html = html.replace(/src=["']\/([^"']*?)["']/g, (match, path) => {
                if (path.startsWith('http')) return match;
                const novaUrl = baseUrl.origin + '/' + path;
                console.log(`[REESCREVER] src: /${path} -> ${novaUrl}`);
                return `src="/proxy?url=${encodeURIComponent(novaUrl)}"`;
            });

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
            console.log('[HTML] ✅ HTML servido com sucesso');

        } else {
            // ========== Para outros tipos, apenas repassar ==========
            console.log('[ARQUIVO] Servindo arquivo direto...');
            
            const buffer = await response.buffer();
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', buffer.length);
            res.send(buffer);
            
            console.log('[ARQUIVO] ✅ Arquivo servido com sucesso');
        }

    } catch (err) {
        console.error("[ERRO PROXY]", err.message);
        
        const paginaErro = gerarPaginaErro(err.message, url, UPSTREAM_PROXY);
        res.status(500).send(paginaErro);
    }
});

// ==================== INICIALIZAÇÃO DO SERVIDOR ====================
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Web Proxy Servidor Iniciado     ║
║   📡 Porta: ${PORT}                      ║
║   🌐 URL: http://localhost:${PORT}      ║
╚═══════════════════════════════════════╝
    `);
});

// ==================== TRATAMENTO DE ERROS GLOBAIS ====================

/**
 * Tratamento de promessas rejeitadas não capturadas
 */
process.on('unhandledRejection', (err) => {
    console.error('[ERRO NÃO CAPTURADO] Promessa rejeitada:', err);
});

/**
 * Tratamento de exceções não capturadas
 */
process.on('uncaughtException', (err) => {
    console.error('[EXCEÇÃO NÃO CAPTURADA]:', err);
});
