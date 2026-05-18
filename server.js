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
        urlAtributo.startsWith('tel:') ||
        urlAtributo.startsWith('blob:')) {
        return null;
    }

    let urlCompleta;
    
    if (urlAtributo.startsWith('http://') || urlAtributo.startsWith('https://')) {
        urlCompleta = urlAtributo;
    } else if (urlAtributo.startsWith('//')) {
        urlCompleta = baseUrl.protocol + urlAtributo;
    } else if (urlAtributo.startsWith('/')) {
        urlCompleta = baseUrl.origin + urlAtributo;
    } else {
        try {
            urlCompleta = new URL(urlAtributo, baseUrl).href;
        } catch {
            return null;
        }
    }

    return urlCompleta;
}

/**
 * Remove headers de segurança que podem bloquear o proxy
 */
function removerHeadersBlockeadores(headers) {
    const headersLimpos = new Map(headers);
    
    // Remove CSP (Content Security Policy)
    headersLimpos.delete('content-security-policy');
    headersLimpos.delete('content-security-policy-report-only');
    
    // Remove bloqueio de frames
    headersLimpos.delete('x-frame-options');
    
    // Remove headers CORS restritivos
    headersLimpos.delete('access-control-allow-origin');
    headersLimpos.delete('access-control-allow-credentials');
    
    // Remove compressão (já descomprimido)
    headersLimpos.delete('content-encoding');
    
    // Remove cache para evitar problemas
    headersLimpos.delete('cache-control');
    headersLimpos.delete('expires');
    headersLimpos.delete('pragma');
    
    // Remove headers que podem interferir nos tipos MIME
    headersLimpos.delete('x-content-type-options');
    
    console.log('[HEADERS] Headers de segurança removidos');
    return headersLimpos;
}

/**
 * Remove atributos de segurança incompatíveis com proxy (integrity, nonce)
 */
function removerAtributosSeguranca(html) {
    // Remove atributos integrity (causam bloqueios de CSS/JS)
    let resultado = html.replace(/integrity="[^"]*"/gi, '');
    
    // Remove atributos nonce (incompatíveis com CSP após reescrita)
    resultado = resultado.replace(/nonce="[^"]*"/gi, '');
    
    // Remove atributos crossorigin se estiverem "anonymous" (pode causar bloqueios)
    resultado = resultado.replace(/crossorigin="anonymous"/gi, '');
    
    // Remove atributo referrerpolicy que pode bloquear carregamento
    resultado = resultado.replace(/referrerpolicy="[^"]*"/gi, '');
    
    console.log('[ATRIBUTOS] Atributos de segurança removidos/limpos');
    return resultado;
}

/**
 * Reescreve URLs em HTML
 */
function reescreverUrlsHTML(html, baseUrl) {
    console.log('[REESCREVER-HTML] Iniciando reescrita de URLs...');

    // Primeiro remove atributos problematicos
    html = removerAtributosSeguranca(html);

    // ========== REESCREVER HREF ==========
    html = html.replace(/href=["']([^"']*?)["']/g, (match, urlAtributo) => {
        const urlCompleta = resolverUrl(urlAtributo, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[HREF] ${urlAtributo.substring(0, 50)}`);
        return `href="/proxy?url=${encodeURIComponent(urlCompleta)}"`;
    });

    // ========== REESCREVER SRC (imagens, scripts, etc) ==========
    html = html.replace(/src=["']([^"']*?)["']/g, (match, urlAtributo) => {
        const urlCompleta = resolverUrl(urlAtributo, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[SRC] ${urlAtributo.substring(0, 50)}`);
        return `src="/proxy?url=${encodeURIComponent(urlCompleta)}"`;
    });

    // ========== REESCREVER SRCSET (imagens responsivas) ==========
    html = html.replace(/srcset=["']([^"']*?)["']/g, (match, srcset) => {
        const urls = srcset.split(',').map(item => {
            const parts = item.trim().split(/\s+/);
            const url = parts[0];
            const size = parts.slice(1).join(' ');
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
        
        console.log(`[ACTION] ${urlAtributo.substring(0, 50)}`);
        return `action="/proxy?url=${encodeURIComponent(urlCompleta)}"`;
    });

    // ========== REESCREVER LINK TAGS (CSS, favicon) ==========
    html = html.replace(/<link\s+([^>]*?)href=["']([^"']*?)["']([^>]*?)>/gi, (match, antes, urlAtributo, depois) => {
        const urlCompleta = resolverUrl(urlAtributo, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[LINK] ${urlAtributo.substring(0, 50)}`);
        // Remove integridade/nonce destes específicos novamente (garantia)
        let tagAntes = antes.replace(/integrity="[^"]*"/gi, '').replace(/nonce="[^"]*"/gi, '');
        let tagDepois = depois.replace(/integrity="[^"]*"/gi, '').replace(/nonce="[^"]*"/gi, '');
        return `<link ${tagAntes}href="/proxy?url=${encodeURIComponent(urlCompleta)}"${tagDepois}>`;
    });

    // ========== REESCREVER STYLE TAGS (CSS inline) ==========
    html = html.replace(/<style[^>]*?>([\s\S]*?)<\/style>/gi, (match, css) => {
        console.log('[STYLE] Reescrevendo CSS inline...');
        // Remove nonce se houver
        let tagAberta = match.split('>')[0];
        tagAberta = tagAberta.replace(/nonce="[^"]*"/gi, '');
        const cssReescrito = reescreverUrlsCSS(css, baseUrl);
        return `${tagAberta}>${cssReescrito}</style>`;
    });

    // ========== REMOVER CSP META TAGS ==========
    html = html.replace(/<meta\s+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');

    console.log('[REESCREVER-HTML] ✅ Reescrita de HTML completa!');
    return html;
}

/**
 * Reescreve URLs dentro de CSS
 */
function reescreverUrlsCSS(css, baseUrl) {
    console.log('[REESCREVER-CSS] Iniciando reescrita de CSS...');

    // ========== REESCREVER url() ==========
    css = css.replace(/url\(['"]?([^'")]+)['"]?\)/gi, (match, urlCss) => {
        const urlTrimmed = urlCss.trim();
        const urlCompleta = resolverUrl(urlTrimmed, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[CSS-URL] ${urlTrimmed.substring(0, 40)}`);
        return `url('/proxy?url=${encodeURIComponent(urlCompleta)}')`;
    });

    // ========== REESCREVER @import ==========
    css = css.replace(/@import\s+(?:url\(['"]?|['"])(https?:\/\/[^'")]+|[^'")]+)['"]?\)?/gi, (match, urlImport) => {
        const urlTrimmed = urlImport.trim();
        const urlCompleta = resolverUrl(urlTrimmed, baseUrl);
        if (!urlCompleta) return match;
        
        console.log(`[CSS-IMPORT] ${urlTrimmed.substring(0, 40)}`);
        return `@import url('/proxy?url=${encodeURIComponent(urlCompleta)}')`;
    });

    console.log('[REESCREVER-CSS] ✅ Reescrita de CSS completa!');
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

        // ========== FAZER REQUISIÇÃO COM HEADERS CUSTOMIZADOS ==========
        const response = await fetch(url, {
            agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'pt-BR,pt;q=0.9',
                'Referer': new URL(url).origin + '/'
            },
            redirect: 'follow',
            timeout: 30000
        });

        // ========== CAPTURAR CONTENT-TYPE ==========
        const contentType = response.headers.get('content-type') || 'text/html';
        const contentEncoding = response.headers.get('content-encoding');
        
        console.log(`[RESPOSTA] Content-Type: ${contentType}`);
        console.log(`[RESPOSTA] Content-Encoding: ${contentEncoding || 'none'}`);

        // ========== REMOVER HEADERS BLOQUEADORES ==========
        const headersLimpos = removerHeadersBlockeadores(response.headers);

        // ========== SE FOR HTML, REESCREVER URLS ==========
        if (contentType.includes('text/html')) {
            console.log('[HTML] Processando HTML...');
            
            let html = await response.text();
            const baseUrl = new URL(url);

            // Reescrever URLs
            html = reescreverUrlsHTML(html, baseUrl);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            
            // Copiar headers permitidos
            headersLimpos.forEach((value, key) => {
                if (key !== 'content-length') {
                    res.setHeader(key, value);
                }
            });

            res.send(html);
            console.log('[HTML] ✅ HTML servido com sucesso');

        } else if (contentType.includes('text/css')) {
            // ========== SE FOR CSS PURO, REESCREVER URLS ==========
            console.log('[CSS] Processando CSS...');
            
            let css = await response.text();
            const baseUrl = new URL(url);
            
            css = reescreverUrlsCSS(css, baseUrl);
            
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            
            // Copiar headers permitidos
            headersLimpos.forEach((value, key) => {
                if (key !== 'content-length') {
                    res.setHeader(key, value);
                }
            });
            
            res.send(css);
            console.log('[CSS] ✅ CSS servido com sucesso');

        } else {
            // ========== PARA OUTROS TIPOS (imagens, fonts, JS, etc) ==========
            console.log('[ARQUIVO] Servindo arquivo direto...');
            
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', buffer.length);
            
            // Copiar headers permitidos
            headersLimpos.forEach((value, key) => {
                if (key !== 'content-length') {
                    res.setHeader(key, value);
                }
            });
            
            res.send(buffer);
            
            console.log(`[ARQUIVO] ✅ Arquivo (${(buffer.length / 1024).toFixed(2)}KB) servido com sucesso`);
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
