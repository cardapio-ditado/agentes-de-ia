import { createServer } from "node:http";
import { criarHandler, registrarConectorWhatsapp } from "./app.js";
import {
  estadoWhatsapp,
  iniciarWhatsapp,
  pararWhatsapp,
  temSessaoSalva,
} from "./channels/whatsapp.js";
import { varrerAniversarios } from "./aniversarios.js";
import { varrerAvisosEncalhados } from "./avisosEncalhados.js";
import { cicloDaHora, cicloDasAvaliacoesDoGoogle, cicloDoMinuto } from "./ciclos.js";
import { cicloDasVendasDaZig } from "./cmv/vendasZig.js";
import { varrerHistorico } from "./historicoZig.js";
import { cicloDiarioDoCmv } from "./cmv/avisos.js";
import { cicloDaExperiencia } from "./rhPessoa.js";
import { cicloDaPesquisaZig, varrerBaseDeClientes } from "./pesquisaZig.js";
import { listAgentsInOrg } from "./repository.js";
import {
  BATIDA_DA_PONTE_MS,
  consumirComandoPonte,
  lerEstadoPonte,
  papelValido,
  publicarEstadoPonte,
  venueDoConector,
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

// O ciclo procura o "Conectar" clicado no painel. Era de 5 em 5 segundos,
// lendo e regravando as configurações da casa a cada volta, em cada processo
// do VPS: em 20 dias isso sozinho passou da cota de tráfego do Supabase e o
// sistema inteiro saiu do ar. Agora: o comando a cada 10 s (resposta quase
// sempre vazia) e o "estou vivo" a cada minuto — ou na hora, se o estado
// mudou (QR novo, conectou, caiu).
const CICLO_PONTE_MS = 10_000;
// Conectado, o "Conectar"/"Desconectar" do painel é raro: procura a cada 30 s.
// Desconectado ou esperando o QR, a cada volta (10 s) — é quando alguém está
// olhando a tela esperando.
const BUSCA_COMANDO_CONECTADO_MS = 30_000;
let ultimaBuscaDeComando = 0;
let ultimaBatida = 0;
let ultimoEstadoPublicado = "";
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
    // A casa deste processo se resolve ANTES de consumir comando: sem isso,
    // o conector do Ditado engoliria o "conectar" clicado no painel do The 20
    // e parearia o número da casa errada. Com WHATSAPP_VENUE no .env, cada
    // processo só enxerga a fila da sua casa.
    if (!venueDaPonte) venueDaPonte = await venueDoConector();
    const calmo = estadoWhatsapp().status === "conectado" && Date.now() - ultimaBuscaDeComando < BUSCA_COMANDO_CONECTADO_MS;
    const recebido = calmo ? null : await consumirComandoPonte(PAPEL_DESTE_CONECTOR, venueDaPonte?.id);
    if (!calmo) ultimaBuscaDeComando = Date.now();
    if (recebido) {
      venueDaPonte = { id: recebido.venueId, slug: recebido.venueSlug };
      const { comando } = recebido;
      console.log(`[ponte] comando "${comando.acao}" recebido do site.`);

      if (comando.acao === "conectar") {
        // Reiniciar em vez de empilhar: um segundo iniciar() com socket vivo
        // criaria duas conexões brigando pela mesma sessão. Aqui a sessão
        // salva é PRESERVADA — este é um reinício técnico, e apagar as
        // credenciais faria pedir QR a cada Conectar, inclusive quando a
        // pessoa só queria religar o mesmo número.
        if (estadoWhatsapp().status !== "desconectado") await pararWhatsapp();
        await iniciarWhatsapp({
          // No administrativo não há agente — e não precisa: ninguém responde.
          agentSlug: comando.agent ?? "",
          venueSlug: recebido.venueSlug,
          venueId: recebido.venueId,
          papel: PAPEL_DESTE_CONECTOR,
        });
      } else if (comando.acao === "desconectar") {
        // Aqui é a pessoa dizendo "não quero mais este número". As
        // credenciais vão junto: guardá-las faria o próximo Conectar tentar
        // religar o chip antigo em vez de gerar QR para o novo.
        await pararWhatsapp({ esquecerSessao: true });
      }
    }

    // Sem comando ainda? Publica mesmo assim na casa deste processo: é o
    // heartbeat que diz ao site "tem conector vivo aqui".
    if (venueDaPonte) {
      const e = estadoWhatsapp();
      const estado = { status: e.status, qr: e.qr, telefone: e.telefone, agentSlug: e.agentSlug, venueSlug: e.venueSlug };
      const assinatura = JSON.stringify(estado);
      if (assinatura !== ultimoEstadoPublicado || Date.now() - ultimaBatida >= BATIDA_DA_PONTE_MS) {
        await publicarEstadoPonte(venueDaPonte.id, PAPEL_DESTE_CONECTOR, estado);
        ultimoEstadoPublicado = assinatura;
        ultimaBatida = Date.now();
      }
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

    // A casa deste processo — a fixada por WHATSAPP_VENUE, ou a única ativa.
    const venue = await venueDoConector();
    if (!venue) return;
    venueDaPonte = venue;

    // O agente que atendia antes: fica gravado no último estado publicado na
    // ponte. No papel administrativo não há agente e o campo é ignorado.
    const { data } = await db().from("venues").select("settings").eq("id", venue.id).single();
    const anterior = lerEstadoPonte(data?.settings ?? null, PAPEL_DESTE_CONECTOR);

    // Sem agente gravado, o do papel `agente` é buscado no cadastro em vez de
    // ir vazio. Instalação que religou antes desta versão (ou casa cujo
    // estado veio do formato anterior, sem o campo) subia com slug em branco:
    // a sessão conectava, o cliente mandava mensagem e o log dizia
    // 'Agente "" não encontrado' — parece agente apagado, e é só o religamento
    // que não sabia por quem perguntar.
    let agentSlug = anterior?.agentSlug ?? "";
    if (!agentSlug && PAPEL_DESTE_CONECTOR === "agente") {
      const [primeiro] = await listAgentsInOrg(venue.org_id);
      if (!primeiro) {
        console.warn("[ponte] nenhum agente ativo nesta organização — não religo sozinho.");
        return;
      }
      agentSlug = primeiro.slug;
      console.log(`[ponte] sem agente gravado; usando "${agentSlug}", o primeiro ativo da casa.`);
    }

    console.log(`[ponte] sessão salva encontrada — religando o WhatsApp (${PAPEL_DESTE_CONECTOR}).`);
    await iniciarWhatsapp({
      agentSlug,
      venueSlug: anterior?.venueSlug ?? venue.slug,
      venueId: venue.id,
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
// Os ciclos de fundo: de minuto em minuto e de hora em hora
// ============================================================
// O QUE cada ciclo faz mora em `src/ciclos.ts` — saiu daqui para que a rota
// `/v1/rotinas/ciclo/…` (batida pelo cron da Vercel) rode exatamente a mesma
// coisa quando este processo estiver fora do ar. Aqui ficou só o relógio.
// Os dois lados podem bater ao mesmo tempo: a trava (`reivindicar`) deixa
// passar um só por janela.
//
// O que NÃO foi para lá, e não pode ir: a ponte com o painel (acima) e a
// entrega da fila de avisos pelo número conectado por QR
// (`channels/whatsapp.ts`). As duas precisam do socket do Baileys aberto
// neste processo — coisa que uma função serverless não tem.
setInterval(() => void cicloDoMinuto().catch((e) => console.error("[ciclo] minuto:", e instanceof Error ? e.message : e)), 60_000);

// De hora em hora: a foto diária do estoque e o lembrete de contagem. Pode
// rodar mais de uma vez por dia sem estrago — o snapshot é upsert por dia e o
// lembrete tem índice único; a repetição é a resiliência contra o conector
// ter estado fora do ar na hora "certa".
setInterval(() => void cicloDaHora().catch((e) => console.error("[ciclo] hora:", e instanceof Error ? e.message : e)), 60 * 60_000);

// Na subida, sem esperar a primeira hora (e sem trava: reiniciar é raro, e
// tudo abaixo é idempotente).
void cicloDasAvaliacoesDoGoogle().catch((e) => console.error("[google] sincronização das recentes:", e));

void cicloDiarioDoCmv().catch((e) => console.error("[cmv] varredura diária:", e));
void cicloDaPesquisaZig().catch((e) => console.error("[pesquisa-zig] varredura:", e));
void varrerAniversarios().catch((e) => console.error("[aniversarios] varredura:", e));
void varrerBaseDeClientes().catch((e) => console.error("[clientes-zig] varredura:", e));
void varrerAvisosEncalhados().catch((e) => console.error("[encalhados] varredura:", e));
void varrerHistorico().catch((e) => console.error("[historico-zig] varredura:", e));
void cicloDasVendasDaZig().catch((e) => console.error("[vendas-zig] varredura:", e));
void cicloDaExperiencia().catch((e) => console.error("[rh] aviso de experiência:", e));
void cicloDoMinuto().catch((e) => console.error("[ciclo] minuto:", e instanceof Error ? e.message : e));

const server = createServer(criarHandler({ servirEstaticos: true }));

server.listen(PORTA, HOST, () => {
  console.log(`API e painel em http://localhost:${PORTA}`);
  console.log(`Health check: http://localhost:${PORTA}/health`);
});
