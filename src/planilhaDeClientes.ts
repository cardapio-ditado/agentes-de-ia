import ExcelJS from "exceljs";
import { telefoneLimpo } from "./pesquisa.js";

/**
 * A planilha vira gente na base da casa.
 *
 * Para a casa sem Zig — e para a que tem, mas guardou anos de cliente em
 * outro lugar: exporta a lista de onde estiver (o sistema de reservas, o
 * caderninho passado a limpo, o próprio Excel) e importa aqui. O leitor
 * procura as colunas pelo CABEÇALHO, então a ordem não importa e coluna a
 * mais é ignorada.
 *
 * Quem não presta é dito, não descartado em silêncio: cada linha recusada
 * volta com o número dela e o motivo, porque "importei 80 mas eram 100" sem
 * explicação vira suporte no WhatsApp.
 *
 * Serve a dois donos: a base de clientes (que quer tudo que a planilha
 * trouxer) e os convites da pesquisa (que só olham nome e telefone). Por isso
 * o nome do arquivo não fala de pesquisa: quem lê planilha de gente é isto
 * aqui, e cada lado pega o que precisa.
 */

export interface LinhaRecusada {
  linha: number;
  motivo: string;
}

/**
 * Uma pessoa da planilha.
 *
 * Só o telefone é obrigatório — é a chave da base, e sem ele a linha não vira
 * ninguém. Todo o resto é bônus: planilha de gente real vem com buraco, e
 * recusar a linha inteira porque faltou o e-mail perderia o cliente junto.
 */
export interface PessoaDaPlanilha {
  telefone: string;
  nome: string | null;
  /** Como veio escrito na planilha; quem interpreta é `lerNascimento`. */
  nascimento: string | null;
  email: string | null;
  observacoes: string | null;
}

export interface PlanilhaLida {
  pessoas: PessoaDaPlanilha[];
  recusadas: LinhaRecusada[];
}

/** Cabeçalhos aceitos para cada campo, minúsculos e sem acento. */
const CABECALHOS_TELEFONE = ["telefone", "celular", "whatsapp", "fone", "tel", "numero", "contato", "phone"];
const CABECALHOS_NOME = ["nome", "cliente", "name"];
// "aniversario" sem acento porque `normalizar` tira o acento antes de comparar.
const CABECALHOS_NASCIMENTO = [
  "nascimento", "aniversario", "data de nascimento", "data nascimento",
  "dt nascimento", "nasc", "birthday", "aniversarios",
];
const CABECALHOS_EMAIL = ["email", "e-mail", "mail", "correio"];
const CABECALHOS_OBSERVACOES = ["observacoes", "observacao", "obs", "anotacoes", "nota", "notas", "comentario"];

const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Excel devolve célula como número, data, fórmula, richtext… aqui vira texto. */
function textoDaCelula(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  if (typeof v === "object" && "richText" in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
  }
  if (typeof v === "object" && "text" in v) return String(v.text ?? "");
  return String(v);
}

/**
 * Transforma linhas de células em pessoas.
 *
 * A primeira linha que contiver um cabeçalho de telefone define o mapa de
 * colunas. Sem cabeçalho reconhecível, vale o plano B: a coluna com mais
 * cara de telefone vira telefone, e a primeira coluna de texto vira nome.
 */
export function interpretarLinhas(linhas: string[][]): PlanilhaLida {
  let colTelefone = -1;
  let colNome = -1;
  let colNascimento = -1;
  let colEmail = -1;
  let colObservacoes = -1;
  let linhaDoCabecalho = -1;

  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const celulas = (linhas[i] ?? []).map(normalizar);
    const t = celulas.findIndex((c) => CABECALHOS_TELEFONE.includes(c));
    if (t >= 0) {
      const acharColuna = (aceitos: string[]) => celulas.findIndex((c) => aceitos.includes(c));
      colTelefone = t;
      colNome = acharColuna(CABECALHOS_NOME);
      colNascimento = acharColuna(CABECALHOS_NASCIMENTO);
      colEmail = acharColuna(CABECALHOS_EMAIL);
      colObservacoes = acharColuna(CABECALHOS_OBSERVACOES);
      linhaDoCabecalho = i;
      break;
    }
  }

  // Sem cabeçalho reconhecível não há como saber qual coluna é aniversário —
  // e chutar aqui é pior do que não trazer: gravaria data errada na ficha de
  // gente de verdade, e a casa só descobriria quando o parabéns saísse no dia
  // errado. Nome e telefone o plano B ainda tenta, porque telefone tem cara
  // de telefone; data não tem cara de nada.
  if (colTelefone < 0) {
    // Plano B: a coluna onde mais linhas parecem telefone.
    const larguras = linhas.reduce((m, l) => Math.max(m, l.length), 0);
    let melhor = -1;
    let melhorContagem = 0;
    for (let c = 0; c < larguras; c++) {
      const contagem = linhas.filter((l) => {
        const d = telefoneLimpo(l[c] ?? "");
        return d.length >= 10 && d.length <= 15;
      }).length;
      if (contagem > melhorContagem) {
        melhor = c;
        melhorContagem = contagem;
      }
    }
    if (melhor < 0 || melhorContagem === 0) {
      return {
        pessoas: [],
        recusadas: [{ linha: 1, motivo: "Nenhuma coluna de telefone encontrada. Use um cabeçalho chamado 'telefone' ou 'whatsapp'." }],
      };
    }
    colTelefone = melhor;
    // Nome: a primeira coluna diferente da do telefone com texto não numérico.
    colNome = linhas.length
      ? (linhas[0] ?? []).findIndex((v, i2) => i2 !== melhor && v.trim() !== "" && telefoneLimpo(v).length < 8)
      : -1;
  }

  const pessoas: PessoaDaPlanilha[] = [];
  const recusadas: LinhaRecusada[] = [];
  const vistos = new Set<string>();

  /** Célula de uma coluna que pode nem existir na planilha. */
  const campo = (celulas: string[], coluna: number) =>
    coluna >= 0 ? (celulas[coluna] ?? "").trim() || null : null;

  linhas.forEach((celulas, i) => {
    if (i === linhaDoCabecalho) return;
    if (celulas.every((c) => c.trim() === "")) return;

    const telefone = telefoneLimpo(celulas[colTelefone] ?? "");
    if (telefone.length < 10 || telefone.length > 15) {
      recusadas.push({
        linha: i + 1,
        motivo: `"${(celulas[colTelefone] ?? "").trim() || "(vazio)"}" não parece um telefone com DDD.`,
      });
      return;
    }
    // A mesma pessoa duas vezes na planilha é UMA pessoa — repetir no mesmo
    // arquivo é quase sempre linha duplicada do export.
    if (vistos.has(telefone)) return;
    vistos.add(telefone);
    pessoas.push({
      telefone,
      nome: campo(celulas, colNome),
      nascimento: campo(celulas, colNascimento),
      email: campo(celulas, colEmail),
      observacoes: campo(celulas, colObservacoes),
    });
  });

  return { pessoas, recusadas };
}

/** O arquivo começa com "PK"? Então é zip — e .xlsx é um zip. */
function pareceXlsx(arquivo: Buffer): boolean {
  return arquivo.length > 1 && arquivo[0] === 0x50 && arquivo[1] === 0x4b;
}

/** CSV simples: vírgula ou ponto-e-vírgula (o Excel brasileiro exporta com ;). */
function linhasDoCsv(textoBruto: string): string[][] {
  const separador = (textoBruto.match(/;/g)?.length ?? 0) > (textoBruto.match(/,/g)?.length ?? 0) ? ";" : ",";
  return textoBruto
    .split(/\r?\n/)
    .map((l) => l.split(separador).map((c) => c.replace(/^"|"$/g, "").trim()));
}

/** Lê .xlsx ou .csv e devolve a lista de pessoas e as linhas recusadas. */
export async function lerPlanilhaDeClientes(arquivo: Buffer): Promise<PlanilhaLida> {
  let linhas: string[][];

  if (pareceXlsx(arquivo)) {
    const livro = new ExcelJS.Workbook();
    // exceljs declara um `Buffer` global próprio que se funde com o do Node —
    // o valor é um Buffer de verdade, só a declaração está errada (mesmo caso
    // de lerVendas.ts e training.ts).
    await livro.xlsx.load(arquivo as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    linhas = [];
    const aba = livro.worksheets[0];
    aba?.eachRow((linha) => {
      const celulas = (linha.values as ExcelJS.CellValue[]).slice(1).map(textoDaCelula);
      linhas.push(celulas);
    });
  } else {
    linhas = linhasDoCsv(arquivo.toString("utf8"));
  }

  return interpretarLinhas(linhas);
}
