import { createServer } from "node:http";
import { criarHandler, registrarConectorWhatsapp } from "./app.js";
import { estadoWhatsapp, iniciarWhatsapp, pararWhatsapp } from "./channels/whatsapp.js";

/**
 * Servidor Node de verdade: local, VPS ou container.
 *
 * Serve a API e o painel. Na Vercel o ponto de entrada é `api/index.ts` —
 * lá o CDN serve os estáticos e este arquivo não é usado.
 */
const PORTA = Number(process.env.PORT ?? 3000);

// Aqui o conector pode existir: há processo longo e disco. Na Vercel, ninguém
// registra, e as rotas de WhatsApp respondem 501 explicando o porquê.
registrarConectorWhatsapp({
  estado: estadoWhatsapp,
  iniciar: iniciarWhatsapp,
  parar: pararWhatsapp,
});

const server = createServer(criarHandler({ servirEstaticos: true }));

server.listen(PORTA, () => {
  console.log(`API e painel em http://localhost:${PORTA}`);
  console.log(`Health check: http://localhost:${PORTA}/health`);
});
