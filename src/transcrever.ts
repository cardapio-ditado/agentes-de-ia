/**
 * Transcrição de áudio — o cliente que manda mensagem de voz.
 *
 * Metade das mensagens de WhatsApp de bar chega em áudio: o cliente está
 * dirigindo, está na rua, ou simplesmente não gosta de digitar. Sem isto, o
 * agente responde "pode escrever?" — e uma parte dessa gente não escreve,
 * desiste, e a reserva não acontece.
 *
 * O Claude não recebe áudio, então a transcrição é um passo antes: o áudio
 * vira texto aqui e entra no agente como se a pessoa tivesse digitado.
 *
 * Usa o Groq, que roda Whisper com 2 mil transcrições por dia no plano
 * gratuito — muito além do movimento de uma casa — e responde em segundos.
 * A API é a mesma da OpenAI, então trocar de fornecedor depois é mudar a
 * URL e a chave.
 *
 * Roda no CONECTOR, na máquina que mantém a sessão do WhatsApp. Nunca na
 * Vercel: lá o tempo é limitado e o áudio nem sempre volta antes do corte.
 */

const URL_GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Turbo e não o Whisper grande: transcrever recado de bar não pede o
 * modelo mais fino, e a diferença de velocidade aparece — quem manda áudio
 * espera resposta na hora, não daqui a um minuto.
 */
const MODELO = "whisper-large-v3-turbo";

/** Teto do plano gratuito do Groq. Áudio de WhatsApp raramente passa de 1 MB. */
const LIMITE_BYTES = 25_000_000;

/** Áudio mais longo que isto quase nunca é pergunta — é desabafo ou engano. */
const LIMITE_SEGUNDOS_ESTIMADO = 600;

export class TranscricaoIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "TranscricaoIndisponivel";
  }
}

export function transcricaoConfigurada(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

/**
 * Converte a resposta do serviço em texto aproveitável.
 *
 * Exportada para teste: a regra do que é uma transcrição utilizável não
 * deveria custar uma chamada de API para ser verificada.
 */
export function textoDaResposta(bruto: unknown): string {
  const corpo = bruto as { text?: unknown } | null;
  const texto = typeof corpo?.text === "string" ? corpo.text.trim() : "";

  // Whisper devolve string vazia para silêncio, e alucina frases feitas em
  // ruído puro ("Legendas pela comunidade Amara.org" é a mais famosa). Tratar
  // isso como pergunta do cliente faria o agente responder do nada.
  if (!texto) return "";
  if (/amara\.org|legendas? (pela|por)/i.test(texto)) return "";
  return texto;
}

export async function transcreverAudio(params: {
  audio: Buffer;
  mimeType?: string;
}): Promise<string> {
  const chave = process.env.GROQ_API_KEY?.trim();
  if (!chave) {
    throw new TranscricaoIndisponivel("Transcrição de áudio não está configurada nesta instalação.");
  }
  if (params.audio.byteLength === 0) {
    throw new TranscricaoIndisponivel("O áudio chegou vazio.");
  }
  if (params.audio.byteLength > LIMITE_BYTES) {
    throw new TranscricaoIndisponivel("Áudio grande demais para transcrever.");
  }

  // O WhatsApp manda OGG/Opus; o nome do arquivo é o que diz o formato ao
  // serviço, então ele acompanha o tipo em vez de ser fixo.
  const extensao = (params.mimeType ?? "").includes("mp4") ? "m4a" : "ogg";
  const formulario = new FormData();
  formulario.append(
    "file",
    new Blob([new Uint8Array(params.audio)], { type: params.mimeType || "audio/ogg" }),
    `audio.${extensao}`,
  );
  formulario.append("model", MODELO);
  // Português declarado: sem isso o Whisper às vezes decide que um "oi, tudo
  // bem?" curto é espanhol, e transcreve torto.
  formulario.append("language", "pt");
  formulario.append("response_format", "json");

  const resposta = await fetch(URL_GROQ, {
    method: "POST",
    headers: { authorization: `Bearer ${chave}` },
    body: formulario,
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");
    if (resposta.status === 429) {
      throw new TranscricaoIndisponivel(
        "Limite de transcrições atingido por agora. O áudio não foi entendido.",
      );
    }
    throw new TranscricaoIndisponivel(
      `Falha ao transcrever (${resposta.status}). ${detalhe.slice(0, 200)}`,
    );
  }

  const texto = textoDaResposta(await resposta.json().catch(() => null));
  if (!texto) {
    throw new TranscricaoIndisponivel("Não consegui entender o que foi dito no áudio.");
  }
  return texto;
}

/** Estimativa grosseira de duração, só para recusar áudio absurdo. */
export function longoDemais(bytes: number): boolean {
  // Opus de voz no WhatsApp fica perto de 2 KB/s.
  return bytes / 2000 > LIMITE_SEGUNDOS_ESTIMADO;
}
