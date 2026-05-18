<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>O Cu de B0kus</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            padding: 20px;
        }

        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }

        .header h1 {
            font-size: 3em;
            text-shadow: 3px 3px 6px rgba(0,0,0,0.3);
            margin-bottom: 10px;
            letter-spacing: 2px;
        }

        .controls {
            max-width: 900px;
            width: 100%;
            margin: 0 auto 20px;
        }

        .input-group {
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            margin-bottom: 15px;
        }

        .input-group label {
            display: block;
            font-weight: 600;
            margin-bottom: 10px;
            color: #333;
            font-size: 14px;
        }

        .input-wrapper {
            display: flex;
            gap: 10px;
        }

        input[type="text"] {
            flex: 1;
            padding: 14px 18px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s;
        }

        input[type="text"]:focus {
            outline: none;
            border-color: #2a5298;
            box-shadow: 0 0 0 3px rgba(42, 82, 152, 0.1);
        }

        button {
            padding: 14px 30px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(42, 82, 152, 0.4);
        }

        button:active {
            transform: translateY(0);
        }

        .iframe-container {
            flex: 1;
            max-width: 900px;
            width: 100%;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            padding: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }

        iframe {
            width: 100%;
            height: 100%;
            min-height: 600px;
            border: none;
            border-radius: 8px;
        }

        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            box-shadow: 0 5px 20px rgba(0,0,0,0.3);
            z-index: 1000;
            animation: slideIn 0.3s ease;
            display: none;
        }

        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        .toast.success { background: #28a745; }
        .toast.error { background: #dc3545; }
        .toast.warning { background: #ffc107; color: #333; }

        @media (max-width: 768px) {
            .header h1 { 
                font-size: 2em; 
            }
            
            .input-wrapper { 
                flex-direction: column; 
            }
            
            button {
                width: 100%;
            }

            iframe {
                min-height: 400px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>O Cu de B0kus</h1>
    </div>

    <div class="controls">
        <div class="input-group">
            <label>🔧 Proxy</label>
            <div class="input-wrapper">
                <input id="proxy" type="text" placeholder="http://usuario:senha@IP:PORT ou socks5://IP:PORT">
                <button id="setProxy">Definir</button>
            </div>
        </div>

        <div class="input-group">
            <label>🌐 Endereço</label>
            <div class="input-wrapper">
                <input id="url" type="text" placeholder="https://exemplo.com">
                <button id="go">Ir</button>
            </div>
        </div>
    </div>

    <div class="iframe-container">
        <iframe id="frame"></iframe>
    </div>

    <div class="toast" id="toast"></div>

    <script>
        const proxyInput = document.getElementById("proxy");
        const urlInput = document.getElementById("url");
        const iframe = document.getElementById("frame");
        const toast = document.getElementById("toast");

        // Função de notificação
        function showToast(message, type = 'success') {
            toast.textContent = message;
            toast.className = `toast ${type}`;
            toast.style.display = 'block';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 3000);
        }

        // Configurar proxy
        document.getElementById("setProxy").addEventListener("click", async () => {
            const proxy = proxyInput.value.trim();
            if (!proxy) return showToast("Digite um proxy válido", "warning");

            try {
                const res = await fetch("/set-proxy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ proxy })
                });
                const data = await res.json();
                
                if (data.success) {
                    showToast("✅ Proxy configurado!", "success");
                } else {
                    showToast("⚠️ Proxy configurado (não testado)", "warning");
                }
            } catch (err) {
                showToast("❌ Erro: " + err.message, "error");
            }
        });

        // Carregar URL
        document.getElementById("go").addEventListener("click", () => {
            const url = urlInput.value.trim();
            if (!url) return showToast("Digite uma URL!", "warning");
            
            let finalUrl = url;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                finalUrl = 'https://' + url;
            }
            
            iframe.src = "/proxy?url=" + encodeURIComponent(finalUrl);
            showToast("Carregando...", "success");
        });

        // Enter para enviar
        urlInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") document.getElementById("go").click();
        });

        proxyInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") document.getElementById("setProxy").click();
        });
    </script>
</body>
</html>
