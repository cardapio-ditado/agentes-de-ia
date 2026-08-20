import { createServer } from "node:http";
import { criarHandler, registrarConectorWhatsapp } from "./app.js";
import {
  estadoWhatsapp,
  iniciarWhatsapp,
  pararWhatsapp,
  temSessaoSalva,
} from "./channels/whatsapp.js";
import { dispararChecklistsAgendados } from "./checklists.js";
import {
  consumirComandoPonte,
  lerEstadoPonte,
  papelValido,
  primeiroVenueAtivo,
  publicarEstadoPonte,
} from "./ponteWhatsapp.js";
import { db } from "./supabase.js";

/**
 * Servidor Node de verdade: local, VPS ou container.
 *
 * Serve a API e o painel. Na Vercel o ponto de entrada é `api/index.ts` —
 * lá o CDN serve os estáticos e este arquivo não é usado.
 */
const PORTA = Number(process.env.PORT ?? 3000);
// Numa VPS atrás de um proxy HTTPS (Caddy/nginx), defina HOST=127.0.0.1 no
// .env: o Node só escuta dentro da máquina e a única porta de entrada vira o
// proxy, com certificado. Sem HOST, escuta em todas as interfaces — é o que
// permite abrir o painel pelo celular na rede do bar.
const HOST = process.env.HOST ?? "0.0.0.0";

// Aqui o conector pode existir: há processo longo e disco. Na Vercel, ninguém
// registra, e as rotas de WhatsApp caem na ponte pelo banco.
registrarConectorWhatsapp({
  estado: estadoWhatsapp,
  iniciar: iniciarWhatsapp,
  parar: pararWhatsapp,
});

// ============================================================
// Ponte com o site: comandos e estado via banco
// ============================================================
// O painel na Vercel não enxerga este processo. A cada ciclo: consome um
// comando enfileirado pelo site (conectar/desconectar) e publica o estado
// atual (status, QR, telefone) para o site mostrar. Ver src/ponteWhatsapp.ts.

const CICLO_PONTE_MS = 5_000;
let venueDaPonte: { id: string; slug: string } | null = null;
let cicloEmAndamento = false;

/**
 * Que número este processo é.
 *
 * Cada papel roda em SEU processo, com sua pasta de sessão e sua fila de
 * comandos — dois processos também isolam falha: a sessão do agente cair não
 * para o disparo de checklist.
 *
 *   WHATSAPP_PAPEL=administrativo  → só envia; mensagem recebida não é atendida
 *   WHATSAPP_PAPEL=agente (padrão) → atende o cliente com IA
 */
const PAPEL_DESTE_CONECTOR = papelValido(process.env.WHATSAPP_PAPEL);

async function cicloDaPonte(): Promise<void> {
  if (cicloEmAndamento) return;
  cicloEmAndamento = true;
  try {
    const recebido = await consumirComandoPonte(PAPEL_DESTE_CONECTOR);
    if (recebido) {
      venueDaPonte = { id: recebido.venueId, slug: recebido.venueSlug };
      const { comando } = recebido;
      console.log(`[ponte] comando "${comando.acao}" recebido do site.`);

      if (comando.acao === "conectar") {
        // Reiniciar em vez de empilhar: um segundo iniciar() com socket vivo
        // criaria duas conexões brigando pela mesma sessão.
        if (estadoWhatsapp().status !== "desconectado") await pararWhatsapp();
        await iniciarWhatsapp({
          // No administrativo não há agente — e não precisa: ninguém responde.
          agentSlug: comando.agent ?? "",
          venueSlug: recebido.venueSlug,
          papel: PAPEL_DESTE_CONECTOR,
        });
      } else if (comando.acao === "desconectar") {
        await pararWhatsapp();
      }
    }

    // Sem comando ainda? Publica mesmo assim no único venue: é o heartbeat
    // que diz ao site "tem conector vivo aqui".
    if (!venueDaPonte) venueDaPonte = await primeiroVenueAtivo();
    if (venueDaPonte) {
      const e = estadoWhatsapp();
      await publicarEstadoPonte(venueDaPonte.id, PAPEL_DESTE_CONECTOR, {
        status: e.status,
        qr: e.qr,
        telefone: e.telefone,
        agentSlug: e.agentSlug,
        venueSlug: e.venueSlug,
      });
    }
  } catch (e) {
    // Banco fora do ar não pode derrubar o atendimento — só a ponte espera.
    console.error("[ponte] ciclo falhou:", e instanceof Error ? e.message : e);
  } finally {
    cicloEmAndamento = false;
  }
}

/**
 * Religa sozinho depois de um reinício.
 *
 * Sem isto, reiniciar o serviço (ou a máquina) deixa o WhatsApp mudo até
 * alguém abrir o painel e clicar em Conectar — e ninguém fica olhando o
 * painel. Um reboot de madrugada significaria o agente fora do ar até o
 * primeiro cliente reclamar de não ter sido respondido.
 *
 * A sessão em disco continua pareada, então religar não pede QR nenhum. Se
 * não houver sessão salva, não faz nada: aí é uma instalação nova mesmo, e o
 * QR é o caminho certo.
 */
async function religarSeJaPareado(): Promise<void> {
  try {
    if (!(await temSessaoSalva(PAPEL_DESTE_CONECTOR))) return;

    const venue = await primeiroVenueAtivo();
    if (!venue) return;
    venueDaPonte = venue;

    // O agente que atendia antes: fica gravado no último estado publicado na
    // ponte. No papel administrativo não há agente e o campo é ignorado.
    const { data } = await db().from("venues").select("settings").eq("id", venue.id).single();
    const anterior = lerEstadoPonte(data?.settings ?? null, PAPEL_DESTE_CONECTOR);

    console.log(`[ponte] sessão salva encontrada — religando o WhatsApp (${PAPEL_DESTE_CONECTOR}).`);
    await iniciarWhatsapp({
      agentSlug: anterior?.agentSlug ?? "",
      venueSlug: anterior?.venueSlug ?? venue.slug,
      papel: PAPEL_DESTE_CONECTOR,
    });
  } catch (e) {
    // Falhar aqui não pode impedir o servidor de subir: sem religar, o painel
    // ainda tem o botão Conectar.
    console.error("[ponte] não consegui religar sozinho:", e instanceof Error ? e.message : e);
  }
}

setInterval(() => void cicloDaPonte(), CICLO_PONTE_MS);
void religarSeJaPareado().then(() => cicloDaPonte());

// ============================================================
// Agendador de checklists
// ============================================================
// A cada minuto: cria as execuções cujo horário chegou e enfileira o link
// no WhatsApp do responsável — a fila de notificações (acima) entrega.
// Vive aqui porque a Vercel não tem processo de pé; é o mesmo motivo da
// fila. Idempotente: rodar de novo no mesmo dia não duplica nada.

let agendadorEmAndamento = false;
async function cicloDosChecklists(): Promise<void> {
  if (agendadorEmAndamento) return;
  agendadorEmAndamento = true;
  try {
    await dispararChecklistsAgendados();
  } catch (e) {
    console.error("[checklists] agendador falhou:", e instanceof Error ? e.message : e);
  } finally {
    agendadorEmAndamento = false;
  }
}
setInterval(() => void cicloDosChecklists(), 60_000);
void cicloDosChecklists();

const server = createServer(criarHandler({ servirEstaticos: true }));

server.listen(PORTA, HOST, () => {
  console.log(`API e painel em http://localhost:${PORTA}`);
  console.log(`Health check: http://localhost:${PORTA}/health`);
});
