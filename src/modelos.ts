/**
 * Qual modelo de IA cada tarefa interna usa.
 *
 * Antes, o nome do modelo estava escrito à mão em cinco arquivos. Trocar o
 * motor de UMA tarefa — para testar um mais barato, ou porque um novo saiu —
 * era caçar linhas pelo projeto; e quando a caça esquecia uma, o sistema
 * rodava com dois modelos diferentes achando que rodava com um.
 *
 * Agora cada tarefa tem um nome aqui e uma variável de ambiente que a
 * sobrescreve. Testar o Haiku na leitura de programação vira configuração na
 * Vercel (MODELO_LER_PROGRAMACAO=claude-haiku-4-5), não deploy — e voltar
 * atrás é apagar a variável.
 *
 * O AGENTE NÃO ESTÁ AQUI de propósito: o modelo dele é escolhido por agente,
 * no painel, e gravado no banco. É decisão de quem configura a casa, não
 * nossa.
 */

/** O padrão das tarefas internas. Sonnet: bom o bastante, sem preço de Opus. */
const PADRAO = "claude-sonnet-5";

const TAREFAS = {
  /** Redigir resposta pública para avaliação do Google. */
  avaliacoes: "MODELO_AVALIACOES",
  /** Montar checklist conversando e analisar o preenchido. */
  checklists: "MODELO_CHECKLISTS",
  /** Montar a pesquisa de satisfação conversando. */
  pesquisa: "MODELO_PESQUISA",
  /** Ler arquivo de programação (Excel, foto, PDF) e extrair os eventos. */
  lerProgramacao: "MODELO_LER_PROGRAMACAO",
  /** Transcrever material de treinamento do agente. */
  treinamento: "MODELO_TREINAMENTO",
} as const;

export type TarefaDeIA = keyof typeof TAREFAS;

/**
 * O modelo desta tarefa.
 *
 * Lido a cada chamada, e não no carregamento do módulo: na Vercel a variável
 * pode mudar entre deploys sem o processo reiniciar do zero, e um valor
 * congelado na primeira leitura faria a troca "não funcionar" sem pista.
 */
export function modeloDaTarefa(tarefa: TarefaDeIA): string {
  const valor = process.env[TAREFAS[tarefa]]?.trim();
  return valor || PADRAO;
}
