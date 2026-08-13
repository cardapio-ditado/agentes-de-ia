import { criarHandler } from "../src/app.js";

/**
 * Ponto de entrada da Vercel.
 *
 * Os arquivos de `public/` são servidos pelo CDN antes de esta função ser
 * chamada, então aqui o servidor de estáticos fica desligado.
 *
 * ⚠️ O conector do WhatsApp (Baileys) NÃO roda aqui. Ele precisa de um
 * WebSocket aberto e de disco para a sessão; funções serverless são efêmeras.
 * Rode `npm run whatsapp` num host sempre ligado (Railway, Render, Fly, VPS).
 */
export default criarHandler({ servirEstaticos: false });
