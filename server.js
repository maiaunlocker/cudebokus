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
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ==================== VARIÁVEIS GLOBAIS ====================
let UPSTREAM_PROXY = "";

// ==================== FUNÇÕES UTILITÁRIAS ====================

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

/**
 * Converte URL relativa em absoluta
 */
function resolverUrl(urlAtributo, baseUrl) {
    if (!urlAtributo) return null;
    
    // URLs que não devem ser reescritas
    if (urlAtributo.startsWith('data:') || 
        urlAtributo.startsWith('javascript:') || 
        urlAtributo.startsWith('#') || 
        urlAtributo.startsWith('mailto:') ||
        urlAtributo.startsWith('tel:')) {
        return null;
    }

    let urlCompleta;
    
    if (urlAtributo.startsWith('http://') || urlAtributo.startsWith('https://')) {
        // URL absoluta
        urlCompleta = urlAtributo;
    } else if (urlAtributo.startsWith('//')) {
        // URL relativa ao protocolo
        urlCompleta = baseUrl.protocol + urlAtributo;
    } else if (urlAtributo.startsWith('/')) {
        // URL relativa à raiz
        urlCompleta = baseUrl.origin + urlAtributo;
    } else {
        // URL relativa ao caminho atual
        try {
            urlCompleta = new URL(urlAtributo, baseUrl).href;
        } catch {
            return null;
        }
    }

    return urlCompleta;
}

/**
 * Reescreve URLs em HTML e CSS
 */
function reescreverUrls(html, baseUrl) {
    console.log('[REESCREVER] Iniciando reescrita de URLs...');

    // ========== REESCREVER HREF ==========
    html = html.replace(/href=["']([^"']*?)["']/g, (match, urlAtributo) => {
        const urlCompleta = resolverUrl(urlAtributo, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[HREF] ${urlAtributo}`);
        return `href="/proxy?url=${encodeURIComponent(urlCompleta)}"`;
    });

    // ========== REESCREVER SRC (imagens, scripts, etc) ==========
    html = html.replace(/src=["']([^"']*?)["']/g, (match, urlAtributo) => {
        const urlCompleta = resolverUrl(urlAtributo, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[SRC] ${urlAtributo}`);
        return `src="/proxy?url=${encodeURIComponent(urlCompleta)}"`;
    });

    // ========== REESCREVER SRCSET (imagens responsivas) ==========
    html = html.replace(/srcset=["']([^"']*?)["']/g, (match, srcset) => {
        const urls = srcset.split(',').map(item => {
            const [url, size] = item.trim().split(/\s+/);
            const urlCompleta = resolverUrl(url, baseUrl);
            
            if (!urlCompleta) return item;
            
            const novoUrl = `/proxy?url=${encodeURIComponent(urlCompleta)}`;
            return size ? `${novoUrl} ${size}` : novoUrl;
        }).join(', ');

        console.log(`[SRCSET] Reescrito`);
        return `srcset="${urls}"`;
    });

    // ========== REESCREVER ACTION (formulários) ==========
    html = html.replace(/action=["']([^"']*?)["']/g, (match, urlAtributo) => {
        const urlCompleta = resolverUrl(urlAtributo, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[ACTION] ${urlAtributo}`);
        return `action="/proxy?url=${encodeURIComponent(urlCompleta)}"`;
    });

    // ========== REESCREVER LINK TAGS (CSS, favicon) ==========
    html = html.replace(/<link\s+([^>]*?)href=["']([^"']*?)["']([^>]*?)>/gi, (match, antes, urlAtributo, depois) => {
        const urlCompleta = resolverUrl(urlAtributo, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[LINK] ${urlAtributo}`);
        return `<link ${antes}href="/proxy?url=${encodeURIComponent(urlCompleta)}"${depois}>`;
    });

    // ========== REESCREVER STYLE TAGS (CSS inline) ==========
    html = html.replace(/<style[^>]*?>([\s\S]*?)<\/style>/gi, (match, css) => {
        console.log('[STYLE] Reescrevendo CSS inline...');
        const cssReescrito = reescreverCSS(css, baseUrl);
        return `<style>${cssReescrito}</style>`;
    });

    // ========== REESCREVER ATRIBUTOS STYLE (CSS inline) ==========
    html = html.replace(/style=["']([^"']*?)["']/g, (match, style) => {
        console.log('[STYLE-ATTR] Reescrevendo atributo style...');
        const styleReescrito = reescreverCSS(style, baseUrl);
        return `style="${styleReescrito}"`;
    });

    console.log('[REESCREVER] ✅ Reescrita de HTML completa!');
    return html;
}

/**
 * Reescreve URLs dentro de CSS
 */
function reescreverCSS(css, baseUrl) {
    // ========== REESCREVER url() ==========
    css = css.replace(/url\(['"]?([^'")]+)['"]?\)/gi, (match, urlCss) => {
        const urlCompleta = resolverUrl(urlCss.trim(), baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[CSS-URL] ${urlCss} -> ${urlCompleta}`);
        return `url('/proxy?url=${encodeURIComponent(urlCompleta)}')`;
    });

    // ========== REESCREVER @import ==========
    css = css.replace(/@import\s+(?:url\(['"]?|['"])(https?:\/\/[^'")]+|[^'")]+)['"]?\)?/gi, (match, urlImport) => {
        const urlCompleta = resolverUrl(urlImport.trim(), baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[CSS-IMPORT] ${urlImport} -> ${urlCompleta}`);
        return `@import url('/proxy?url=${encodeURIComponent(urlCompleta)}')`;
    });

    return css;
}

// ==================== ROTAS ====================

app.get("/", (req, res) => {
    console.log('[ROTA] GET / - Servindo index.html');
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/set-proxy", async (req, res) => {
    console.log('[ROTA] POST /set-proxy');
    
    const { proxy } = req.body;

    if (!proxy) {
        UPSTREAM_PROXY = "";
        console.log('[PROXY] Proxy removido');
        return res.json({ 
            success: true, 
            proxy: "removido",
            message: "Proxy removido com sucesso"
        });
    }

    UPSTREAM_PROXY = proxy.trim();
    console.log('[PROXY] Novo proxy configurado:', UPSTREAM_PROXY);
    
    const agent = getAgent(UPSTREAM_PROXY);

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

app.get("/proxy", async (req, res) => {
    const url = req.query.url;

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
            console.log('[HTML] Processando HTML...');
            
            let html = await response.text();
            const baseUrl = new URL(url);

            // Usar função melhorada de reescrita
            html = reescreverUrls(html, baseUrl);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
            console.log('[HTML] ✅ HTML servido com sucesso');

        } else if (contentType.includes('text/css')) {
            // ========== Se for CSS puro, reescrever URLs ==========
            console.log('[CSS] Processando CSS...');
            
            let css = await response.text();
            const baseUrl = new URL(url);
            
            css = reescreverCSS(css, baseUrl);
            
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.send(css);
            console.log('[CSS] ✅ CSS servido com sucesso');

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

process.on('unhandledRejection', (err) => {
    console.error('[ERRO NÃO CAPTURADO] Promessa rejeitada:', err);
});

process.on('uncaughtException', (err) => {
    console.error('[EXCEÇÃO NÃO CAPTURADA]:', err);
});
