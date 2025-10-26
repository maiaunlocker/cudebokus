import express from "express";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = 8080;

// Caminhos para servir arquivos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Ignorar checagem de certificado SSL (somente teste)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Proxy configurável
let UPSTREAM_PROXY = "";

// Cria agente HTTP/HTTPS
function getAgent(proxy) {
  if (!proxy) return undefined;

  return new HttpsProxyAgent(proxy, { timeout: 20000 });
}

// Serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Atualiza proxy
app.post("/set-proxy", async (req, res) => {
  const { proxy } = req.body;
  if (!proxy) return res.json({ success: false, error: "Envie um proxy válido" });

  UPSTREAM_PROXY = proxy.trim();
  const agent = getAgent(UPSTREAM_PROXY);

  try {
    const response = await fetch("https://www.google.com", { agent, redirect: "follow" });
    res.json({
      success: true,
      proxy: UPSTREAM_PROXY,
      status: response.ok ? response.status : "Falha ao acessar Google"
    });
  } catch (err) {
    // Retorna sucesso false, mas inclui o proxy para alert na interface
    res.json({
      success: false,
      proxy: UPSTREAM_PROXY,
      error: err.message
    });
  }
});

// Proxy para iframe
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL inválida");

  const agent = getAgent(UPSTREAM_PROXY);

  try {
    const response = await fetch(url, { agent });
    const html = await response.text();
    res.send(html);
  } catch (err) {
    res.status(500).send("Erro no proxy: " + err.message);
  }
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
