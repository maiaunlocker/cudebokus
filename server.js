import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import http from "http";
import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { PassThrough } from "stream";
import tls from "tls";

const app = express();
const PORT = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());
app.use(express.static(__dirname));

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let UPSTREAM_PROXY = "";

function getAgent(proxy) {
    if (!proxy) return undefined;
    try {
        if (proxy.startsWith('socks')) return new SocksProxyAgent(proxy);
        if (proxy.startsWith('http')) return new HttpsProxyAgent(proxy);
        return new HttpsProxyAgent('http://' + proxy);
    } catch (err) {
        console.error("[AGENTE]", err.message);
        return undefined;
    }
}

function makeProxyUrl(u) {
    return `/proxy?url=${encodeURIComponent(u)}`;
}

function proxify(u, baseUrl) {
    if (!u || typeof u !== 'string') return u;
    if (/^(data:|javascript:|#|mailto:|blob:|about:|none)/i.test(u)) return u;
    if (u.includes('/proxy?url=')) return u;
    try {
        if (u.startsWith('//')) u = baseUrl.protocol + u;
        else if (u.startsWith('/')) u = baseUrl.origin + u;
        else if (!u.startsWith('http')) u = new URL(u, baseUrl).href;
        return makeProxyUrl(u);
    } catch { return u; }
}

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept-Encoding': 'identity',
};

const BLOCKED_DOMAINS = [
    'holahupa.com', 'coosync.com', 'ukankingwithea.com',
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'adservice.google.com', 'pagead2.googlesyndication.com',
    'analytics.google.com', 'googletagmanager.com',
    'facebook.net', 'connect.facebook.net',
    'taboola.com', 'outbrain.com', 'taboola.com',
    'criteo.com', 'criteo.net',
    'amazon-adsystem.com',
    'adsco.re', 'c.adsco.re', 'mdstats.info', 'xadsmart.com',
    'usrpubtrk.com', 'workdeadlinededicate.com', 'adexchangerapid.com',
    'tracylocalschool.com', 'pz.eerfumerel.com',
    'iaarvpjzfnbxr.online',
];

function isBlockedDomain(url) {
    try {
        const host = new URL(url).hostname;
        return BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    } catch { return false; }
}

function makeInterceptorScript(pageUrl) {
    let originalOrigin = '';
    try {
        const urlObj = new URL(pageUrl);
        if (urlObj.searchParams.has('url')) {
            const targetUrl = urlObj.searchParams.get('url');
            if (targetUrl) originalOrigin = new URL(targetUrl).origin;
        } else {
            originalOrigin = urlObj.origin;
        }
    } catch {}

    return `
<script>
(function() {
    var P = '/proxy?url=';
    var ORIGIN = ('${originalOrigin}' && '${originalOrigin}' !== 'undefined') ? '${originalOrigin}' : location.origin;

    var BLOCKED = ['holahupa.com','coosync.com','ukankingwithea.com','doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com','pagead2.googlesyndication.com','analytics.google.com','googletagmanager.com','facebook.net','connect.facebook.net','taboola.com','outbrain.com','criteo.com','criteo.net','amazon-adsystem.com'];

    function isBlocked(url) {
        try {
            var h = new URL(url).hostname;
            return BLOCKED.some(function(d) { return h === d || h.endsWith('.' + d); });
        } catch(e) { return false; }
    }

    function fixUrl(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.startsWith(P) || url.startsWith('data:') || url.startsWith('blob:') ||
            url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('mailto:')) return url;
        if (/\\/undefined\\//i.test(url)) return '';
        if (isBlocked(url)) return '';
        if (url.startsWith('//')) return P + encodeURIComponent(location.protocol + url);
        if (url.startsWith('/')) return P + encodeURIComponent(ORIGIN + url);
        try { return P + encodeURIComponent(new URL(url, ORIGIN + '/').href); }
        catch(e) { return P + encodeURIComponent(url); }
    }

    var oFetch = window.fetch;
    window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
        if (url && !url.startsWith(P) && !url.startsWith('data:') && !url.startsWith('blob:')) {
            url = fixUrl(url);
            if (!url) return Promise.resolve(new Response('', {status: 204}));
            if (input instanceof Request) { input = new Request(url, input); }
            else input = url;
        }
        return oFetch.call(this, input, init);
    };

    var oOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (url && typeof url === 'string' && !url.startsWith(P) && !url.startsWith('data:')) {
            var fixed = fixUrl(url);
            if (!fixed) { arguments[1] = 'about:blank'; return oOpen.apply(this, arguments); }
            arguments[1] = fixed;
        }
        return oOpen.apply(this, arguments);
    };

    if (navigator.sendBeacon) {
        var oBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) {
            if (url && typeof url === 'string' && !url.startsWith(P) && !url.startsWith('data:') && !url.startsWith('blob:')) {
                var fixed = fixUrl(url);
                if (!fixed) return true;
                url = fixed;
            }
            return oBeacon(url, data);
        };
    }

    var oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        try {
            var url = this._proxyUrl || this.responseURL || '';
        } catch(e) {}
        return oSend.apply(this, arguments);
    };

    var oCreate = document.createElement.bind(document);
    document.createElement = function(tag) {
        var el = oCreate(tag);
        var t = tag.toLowerCase();
        var srcTags = {script:'src', iframe:'src', img:'src', video:'src', audio:'src', source:'src', embed:'src', track:'src'};
        if (srcTags[t]) {
            var proto = t === 'script' ? HTMLScriptElement.prototype :
                        t === 'iframe' ? HTMLIFrameElement.prototype :
                        t === 'video' ? HTMLVideoElement.prototype :
                        t === 'audio' ? HTMLAudioElement.prototype :
                        HTMLElement.prototype;
            var desc = Object.getOwnPropertyDescriptor(proto, 'src');
            if (desc) {
                Object.defineProperty(el, 'src', {
                    get: function() { return desc.get.call(this); },
                    set: function(v) {
                        if (v && typeof v === 'string' && !v.startsWith(P) && !v.startsWith('data:') && !v.startsWith('blob:')) {
                            v = fixUrl(v);
                            if (!v) return;
                        }
                        return desc.set.call(this, v);
                    }
                });
            }
        }
        if (t === 'link') {
            var ld = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
            if (ld) {
                Object.defineProperty(el, 'href', {
                    get: function() { return ld.get.call(this); },
                    set: function(v) {
                        if (v && typeof v === 'string' && !v.startsWith(P) && !v.startsWith('data:') && !v.startsWith('blob:')) {
                            v = fixUrl(v);
                            if (!v) return;
                        }
                        return ld.set.call(this, v);
                    }
                });
            }
        }
        return el;
    };

    var oAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function(child) {
        if (child && child.nodeType === 1) fixEl(child);
        return oAppend.call(this, child);
    };
    var oInsert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function(n, r) {
        if (n && n.nodeType === 1) fixEl(n);
        return oInsert.call(this, n, r);
    };

    function fixEl(el) {
        if (!el || !el.getAttribute) return;
        ['src','data-src','href','poster','srcset','data-srcset','data-poster','background','action'].forEach(function(attr) {
            var v = el.getAttribute(attr);
            if (v && typeof v === 'string' && !v.startsWith(P) && !v.startsWith('data:') && !v.startsWith('blob:')) {
                if (attr === 'srcset' || attr === 'data-srcset') {
                    var fixed = v.split(',').map(function(p) {
                        var parts = p.trim().split(/\\s+/);
                        parts[0] = fixUrl(parts[0]);
                        return parts.join(' ');
                    }).join(', ');
                    el.setAttribute(attr, fixed);
                } else {
                    var fixed = fixUrl(v);
                    if (!fixed) { el.parentNode && el.parentNode.removeChild(el); return; }
                    el.setAttribute(attr, fixed);
                }
            }
        });
    }

    function rewriteData(obj) {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'string') {
            if (/^https?:\\/\\//i.test(obj) && !obj.startsWith(P)) return fixUrl(obj);
            return obj;
        }
        if (Array.isArray(obj)) return obj.map(rewriteData);
        if (typeof obj === 'object') {
            var result = {};
            for (var key in obj) {
                if (obj.hasOwnProperty(key)) result[key] = rewriteData(obj[key]);
            }
            return result;
        }
        return obj;
    }

    var oParse = JSON.parse;
    JSON.parse = function(text, reviver) {
        var data = oParse.call(this, text, reviver);
        return rewriteData(data);
    };

    var oAssign = Object.assign;
    if (oAssign) {
        Object.assign = function(target) {
            var args = Array.prototype.slice.call(arguments).map(function(a) {
                return (a && typeof a === 'object') ? rewriteData(a) : a;
            });
            return oAssign.apply(this, args);
        };
    }

    var videoSrcDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'src');
    if (videoSrcDesc) {
        Object.defineProperty(HTMLVideoElement.prototype, 'src', {
            get: function() { return videoSrcDesc.get.call(this); },
            set: function(v) {
                if (v && typeof v === 'string' && !v.startsWith(P) && !v.startsWith('data:') && !v.startsWith('blob:')) {
                    v = fixUrl(v);
                    if (!v) return;
                }
                return videoSrcDesc.set.call(this, v);
            }
        });
    }
    var audioSrcDesc = Object.getOwnPropertyDescriptor(HTMLAudioElement.prototype, 'src');
    if (audioSrcDesc) {
        Object.defineProperty(HTMLAudioElement.prototype, 'src', {
            get: function() { return audioSrcDesc.get.call(this); },
            set: function(v) {
                if (v && typeof v === 'string' && !v.startsWith(P) && !v.startsWith('data:') && !v.startsWith('blob:')) {
                    v = fixUrl(v);
                    if (!v) return;
                }
                return audioSrcDesc.set.call(this, v);
            }
        });
    }

    console.log('[PROXY] OK');
})();
</script>
`;
}

function rewriteHTML(html, url) {
    const baseUrl = new URL(url);

    html = html
        .replace(/<meta[^>]*content-security-policy[^>]*>/gi, '')
        .replace(/<meta[^>]*http-equiv\s*=\s*["']?\s*Content-Security-Policy\s*["']?[^>]*>/gi, '')
        .replace(/<meta[^>]*http-equiv\s*=\s*["']?\s*X-Frame-Options\s*["']?[^>]*>/gi, '')
        .replace(/<meta[^>]*http-equiv\s*=\s*["']?\s*Content-Security-Policy-Report-Only\s*["']?[^>]*>/gi, '')
        .replace(/<link[^>]*dns-prefetch[^>]*>/gi, '')
        .replace(/<link[^>]*preconnect[^>]*>/gi, '')
        .replace(/\s+integrity="[^"]*"/gi, '')
        .replace(/\s+crossorigin="[^"]*"/gi, '')
        .replace(/\s+nonce="[^"]*"/gi, '');

    const blockedPattern = BLOCKED_DOMAINS.map(d => d.replace(/\./g, '\\.')).join('|');
    if (blockedPattern) {
        html = html.replace(new RegExp(`<script[^>]*src=["'][^"']*(?:${blockedPattern})[^"']*["'][^>]*>\\s*</script>`, 'gi'), '');
        html = html.replace(new RegExp(`<script[^>]*src=["'][^"']*(?:${blockedPattern})[^"']*["'][^>]*\\/?>`, 'gi'), '');
        html = html.replace(new RegExp(`<link[^>]*href=["'][^"']*(?:${blockedPattern})[^"']*["'][^>]*>`, 'gi'), '');
    }

    html = html.replace(/<iframe[^>]*src=["'][^"']*undefined[^"']*["'][^>]*>/gi, '');
    html = html.replace(/<script[^>]*src=["'][^"']*undefined[^"']*["'][^>]*>\s*<\/script>/gi, '');

    html = html.replace(/(<iframe[^>]*?)\ssandbox="[^"]*"/gi, '$1');
    html = html.replace(/(<iframe[^>]*?)\ssandbox(?=[\s>])/gi, '$1');

    html = html.replace(/(<video[\s\S]*?<\/video>)/gi, (match) => {
        return match
            .replace(/src=["']([^"']+)["']/gi, (_, u) => `src="${proxify(u, baseUrl)}"`)
            .replace(/poster=["']([^"']+)["']/gi, (_, u) => `poster="${proxify(u, baseUrl)}"`)
            .replace(/data-src=["']([^"']+)["']/gi, (_, u) => `data-src="${proxify(u, baseUrl)}"`);
    });

    html = html.replace(/(<audio[\s\S]*?<\/audio>)/gi, (match) => {
        return match.replace(/src=["']([^"']+)["']/gi, (_, u) => `src="${proxify(u, baseUrl)}"`);
    });

    html = html.replace(/(<source[\s>][^>]*\/?>)/gi, (match) => {
        return match
            .replace(/src=["']([^"']+)["']/gi, (_, u) => `src="${proxify(u, baseUrl)}"`)
            .replace(/srcset=["']([^"']+)["']/gi, (_, s) => {
                const rewritten = s.split(',').map(p => {
                    const [u, ...rest] = p.trim().split(/\s+/);
                    return `${proxify(u, baseUrl)} ${rest.join(' ')}`.trim();
                }).join(', ');
                return `srcset="${rewritten}"`;
            });
    });

    html = html.replace(/(<iframe[\s>][^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (_, pre, u, post) => {
        if (u.includes('/proxy?url=')) return `${pre}${u}${post}`;
        return `${pre}${proxify(u, baseUrl)}${post}`;
    });

    html = html.replace(/(<script[\s>][^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (_, pre, u, post) => {
        if (u.includes('/proxy?url=')) return `${pre}${u}${post}`;
        return `${pre}${proxify(u, baseUrl)}${post}`;
    });

    html = html.replace(/(<link[\s>][^>]*?\bhref=["'])([^"']+)(["'][^>]*>)/gi, (_, pre, u, post) => {
        if (u.includes('/proxy?url=')) return `${pre}${u}${post}`;
        return `${pre}${proxify(u, baseUrl)}${post}`;
    });

    html = html.replace(/(data-href=["'])([^"']+)(["'])/gi, (_, pre, u, post) => {
        if (u.includes('/proxy?url=')) return `${pre}${u}${post}`;
        return `${pre}${proxify(u, baseUrl)}${post}`;
    });

    html = html.replace(/(?<![-a-zA-Z])src=["']([^"']+)["']/gi, (_, u) => {
        if (u.includes('/proxy?url=') || /^(data:|blob:|javascript:|#|none)/.test(u)) return `src="${u}"`;
        return `src="${proxify(u, baseUrl)}"`;
    });

    html = html.replace(/(?<![-a-zA-Z])href=["']([^"']+)["']/gi, (_, u) => {
        if (u.includes('/proxy?url=') || /^(data:|blob:|javascript:|#|none)/.test(u)) return `href="${u}"`;
        return `href="${proxify(u, baseUrl)}"`;
    });

    html = html.replace(/(?<![-a-zA-Z])action=["']([^"']+)["']/gi, (_, u) => {
        if (u.includes('/proxy?url=')) return `action="${u}"`;
        return `action="${proxify(u, baseUrl)}"`;
    });

    html = html.replace(/(?<![-a-zA-Z])srcset=["']([^"']+)["']/gi, (_, s) => {
        if (s.includes('/proxy?url=')) return `srcset="${s}"`;
        const rewritten = s.split(',').map(p => {
            const [u, ...rest] = p.trim().split(/\s+/);
            return `${proxify(u, baseUrl)} ${rest.join(' ')}`.trim();
        }).join(', ');
        return `srcset="${rewritten}"`;
    });

    html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (_, u) => {
        if (u.includes('/proxy?url=') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')) return `url(${u})`;
        try { return `url(${proxify(u, baseUrl)})`; }
        catch { return `url(${u})`; }
    });

    html = html.replace(/@import\s+["']([^"']+)["']/gi, (_, u) => {
        if (u.includes('/proxy?url=')) return `@import "${u}"`;
        return `@import "${proxify(u, baseUrl)}"`;
    });

    const interceptorScript = makeInterceptorScript(url);
    if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => m + interceptorScript);
    } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, (m) => m + interceptorScript);
    } else {
        html = interceptorScript + html;
    }

    return html;
}

function rewriteHLS(playlist, baseUrl) {
    return playlist
        .replace(/^(?!#)(.+\.ts[^\n]*)$/gm, (m) => `/proxy?url=${encodeURIComponent(new URL(m.trim(), baseUrl).href)}`)
        .replace(/^(?!#)(.+\.m3u8[^\n]*)$/gm, (m) => `/proxy?url=${encodeURIComponent(new URL(m.trim(), baseUrl).href)}`)
        .replace(/URI="([^"]+)"/gi, (_, u) => {
            if (u.startsWith('data:') || u.startsWith('/')) return `URI="${u}"`;
            try { return `URI="/proxy?url=${encodeURIComponent(new URL(u, baseUrl).href)}"`; }
            catch { return `URI="${u}"`; }
        });
}

// Native HTTP/HTTPS request with proxy support and direct fallback
function nativeFetch(url, options = {}) {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';

    function doRequest(agent) {
        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: options.method || 'GET',
                headers: options.headers || {},
                agent: agent,
                timeout: options.timeout || 30000,
                rejectUnauthorized: false,
            };

            const transport = isHttps ? https : http;

            const req = transport.request(reqOptions, (res) => {
                resolve(res);
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                if (typeof options.body === 'string') {
                    req.write(options.body);
                } else if (Buffer.isBuffer(options.body)) {
                    req.write(options.body);
                }
            }
            req.end();
        });
    }

    const agent = options.agent;
    if (agent) {
        return doRequest(agent).catch((err) => {
            console.log(`[FALLBACK] Proxy falhou (${err.message}), tentando direto...`);
            return doRequest(undefined);
        });
    }
    return doRequest(undefined);
}

async function proxyRequest(req, res, url) {
    if (isBlockedDomain(url)) {
        return res.status(204).end();
    }

    if (/\/undefined\//i.test(url) || /ghecriedhereisnot/i.test(url)) {
        return res.status(204).end();
    }

    let parsedUrl;
    try { parsedUrl = new URL(url); }
    catch {
        const referer = req.headers.referer || '';
        const refMatch = referer.match(/[?&]url=([^&]+)/);
        if (refMatch) {
            try {
                const base = decodeURIComponent(refMatch[1]);
                url = new URL(url, base).href;
                parsedUrl = new URL(url);
            } catch {}
        }
        if (!parsedUrl) {
            try { parsedUrl = new URL(url); } catch {}
        }
        if (!parsedUrl) return res.status(400).send("URL invalida");
    }

    const agent = getAgent(UPSTREAM_PROXY);

    try {
        console.log(`[${req.method}] ${url.substring(0, 120)}`);

        let refererOrigin = parsedUrl.origin + '/';
        let originHeader = parsedUrl.origin;
        const referer = req.headers.referer || '';
        const refUrlMatch = referer.match(/[?&]url=([^&]+)/);
        if (refUrlMatch) {
            try {
                const parentUrl = decodeURIComponent(refUrlMatch[1]);
                const parentOrigin = new URL(parentUrl).origin;
                refererOrigin = parentUrl;
                originHeader = parentOrigin;
            } catch {}
        }

        const headers = {
            ...FETCH_HEADERS,
            'Host': parsedUrl.host,
            'Referer': refererOrigin,
            'Origin': originHeader,
        };

        const forwardHeaders = ['content-type', 'content-length', 'authorization', 'cookie', 'x-requested-with', 'accept', 'accept-language', 'if-none-match', 'if-modified-since', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site'];
        forwardHeaders.forEach(h => {
            if (req.headers[h]) headers[h] = req.headers[h];
        });

        const fetchOptions = {
            method: req.method,
            agent,
            headers,
            timeout: 30000,
        };

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            if (typeof req.body === 'string') {
                fetchOptions.body = req.body;
            } else if (Buffer.isBuffer(req.body)) {
                fetchOptions.body = req.body;
            } else {
                fetchOptions.body = JSON.stringify(req.body);
            }
        }

        if (req.headers.range && !fetchOptions.headers['Range']) {
            fetchOptions.headers['Range'] = req.headers.range;
        }

        const response = await nativeFetch(url, fetchOptions);
        const contentType = response.headers['content-type'] || '';

        [
            'content-security-policy', 'content-security-policy-report-only',
            'x-frame-options', 'x-content-type-options', 'x-xss-protection',
            'strict-transport-security', 'permissions-policy', 'referrer-policy',
            'x-permitted-cross-domain-policies', 'cross-origin-embedder-policy',
            'cross-origin-opener-policy', 'cross-origin-resource-policy'
        ].forEach(h => res.removeHeader(h));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        ['content-length', 'accept-ranges', 'content-range', 'content-disposition',
         'last-modified', 'etag', 'cache-control', 'expires', 'vary', 'date'
        ].forEach(h => {
            const val = response.headers[h];
            if (val) res.setHeader(h, val);
        });

        const setCookies = response.headers['set-cookie'];
        if (setCookies) {
            const cleaned = (Array.isArray(setCookies) ? setCookies : [setCookies]).map(c =>
                c.replace(/domain=[^;]+;?/gi, '').replace(/secure;?/gi, '').replace(/SameSite=None/gi, 'SameSite=Lax')
            );
            res.setHeader('Set-Cookie', cleaned);
        }

        if (response.statusCode >= 300 && response.statusCode < 400) {
            const location = response.headers['location'];
            if (location) {
                let redirectUrl;
                try {
                    redirectUrl = new URL(location, url).href;
                } catch {
                    redirectUrl = location;
                }
                return res.redirect(`/proxy?url=${encodeURIComponent(redirectUrl)}`);
            }
        }

        res.status(response.statusCode === 206 ? 206 : response.statusCode);

        if (contentType.includes('mpegurl') || contentType.includes('x-mpegURL') ||
            url.includes('.m3u8') || url.includes('.m3u')) {
            let playlist = '';
            for await (const chunk of response) playlist += chunk.toString();
            playlist = rewriteHLS(playlist, new URL(url));
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(playlist);
        }

        if (contentType.startsWith('video/') || contentType.startsWith('audio/') ||
            url.includes('googlevideo.com') || url.includes('videoplayback') ||
            url.includes('mixdrop') || url.includes('miixdrop') || url.includes('bysebuho') || url.includes('dood') ||
            /\.(ts|mp4|webm|m4s|m4v|m4a|mp3|aac|ogg|mkv|flv|cmfv|cmfa|mpd)(\?|$)/i.test(url)) {
            console.log(`[STREAM] ${contentType || '?'} | ${response.headers['content-length'] || 'chunked'}`);
            res.setHeader('Content-Type', contentType || 'video/mp4');
            const passthrough = new PassThrough();
            response.pipe(passthrough);
            passthrough.pipe(res);
            return;
        }

        if (contentType.startsWith('image/')) {
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            return res.send(Buffer.concat(chunks));
        }

        if (contentType.includes('text/html')) {
            let html = '';
            for await (const chunk of response) html += chunk.toString();
            html = rewriteHTML(html, url);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        }

        if (contentType.includes('text/css')) {
            let css = '';
            for await (const chunk of response) css += chunk.toString();
            const base = new URL(url);
            css = css
                .replace(/url\(["']?([^"')]+)["']?\)/gi, (_, u) => {
                    if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#') || u.includes('/proxy?url=')) return `url(${u})`;
                    try { return `url(${proxify(u, base)})`; }
                    catch { return `url(${u})`; }
                })
                .replace(/@import\s+["']([^"']+)["']/gi, (_, u) => {
                    if (u.includes('/proxy?url=')) return `@import "${u}"`;
                    try { return `@import "${proxify(u, base)}"`; }
                    catch { return `@import "${u}"`; }
                });
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            return res.send(css);
        }

        // JS/JSON pass-through without server-side URL rewriting (let interceptor handle it)
        // to avoid breaking escaped URLs like https:\/\/ in JSON
        if (contentType.includes('javascript') || contentType.includes('ecmascript') ||
            url.match(/\.(js|mjs|cjs)(\?|$)/i) ||
            contentType.includes('application/json') || contentType.includes('text/plain')) {
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            // preserve original content-type
            if (contentType) res.setHeader('Content-Type', contentType);
            return res.send(Buffer.concat(chunks));
        }

        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        res.send(Buffer.concat(chunks));

    } catch (err) {
        console.error("[ERRO]", err.message);
        if (!res.headersSent) {
            res.status(500).send(`<html><body style="background:#111;color:#fff;padding:40px;text-align:center;">
                <h2>Erro</h2><p>${err.message}</p></body></html>`);
        }
    }
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.options("/proxy", (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
});

app.post("/set-proxy", async (req, res) => {
    const { proxy } = req.body;
    if (!proxy) {
        UPSTREAM_PROXY = "";
        return res.json({ success: true, proxy: "removido" });
    }
    let proxyUrl = proxy.trim();
    proxyUrl = proxyUrl.replace(/^socka5:\/\//i, 'socks5://');
    proxyUrl = proxyUrl.replace(/^socks4:\/\//i, 'socks5://');
    UPSTREAM_PROXY = proxyUrl;
    const agent = getAgent(UPSTREAM_PROXY);
    try {
        const resp = await nativeFetch("https://www.google.com", {
            agent,
            method: 'GET',
            headers: FETCH_HEADERS,
            timeout: 15000,
        });
        res.json({ success: true, proxy: UPSTREAM_PROXY, status: resp.statusCode });
    } catch (err) {
        res.json({ success: false, proxy: UPSTREAM_PROXY, error: err.message });
    }
});

app.get("/jserror", (req, res) => res.sendStatus(204));

app.all("/proxy", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("URL nao fornecida");
    return proxyRequest(req, res, url);
});

const server = createServer(app);
server.listen(PORT, () => {
    console.log(`\n  Proxy: http://localhost:${PORT}\n`);
});
process.on('unhandledRejection', (err) => console.error('[ERRO]', err.message));
process.on('uncaughtException', (err) => console.error('[EXCECAO]', err.message));
