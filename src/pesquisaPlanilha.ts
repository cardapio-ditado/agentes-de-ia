import ExcelJS from "exceljs";
import { telefoneLimpo } from "./pesquisa.js";

/**
 * A planilha de clientes vira lista de convites.
 *
 * Para a casa sem Zig: exporta a lista de clientes de onde tiver — o sistema
 * de reservas, o caderninho passado a limpo, o próprio Excel — e importa
 * aqui. O leitor procura as colunas pelo CABEÇALHO (nome, telefone), então a
 * ordem das colunas não importa e colunas a mais são ignoradas.
 *
 * Quem não presta é dito, não descartado em silêncio: cada linha recusada
 * volta com o número dela e o motivo, porque "importei 80 mas eram 100" sem
 * explicação vira suporte no WhatsApp.
 */

export interface LinhaRecusada {
  linha: number;
  motivo: string;
}

export interface PlanilhaLida {
  convidados: { nome: string | null; telefone: string }[];
  recusadas: LinhaRecusada[];
}

/** Cabeçalhos aceitos para cada campo, minúsculos e sem acento. */
const CABECALHOS_TELEFONE = ["telefone", "celular", "whatsapp", "fone", "tel", "numero", "contato", "phone"];
const CABECALHOS_NOME = ["nome", "cliente", "name"];

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
 * Transforma linhas de células em convidados.
 *
 * A primeira linha que contiver um cabeçalho de telefone define o mapa de
 * colunas. Sem cabeçalho reconhecível, vale o plano B: a coluna com mais
 * cara de telefone vira telefone, e a primeira coluna de texto vira nome.
 */
export function interpretarLinhas(linhas: string[][]): PlanilhaLida {
  let colTelefone = -1;
  let colNome = -1;
  let linhaDoCabecalho = -1;

  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const celulas = (linhas[i] ?? []).map(normalizar);
    const t = celulas.findIndex((c) => CABECALHOS_TELEFONE.includes(c));
    if (t >= 0) {
      colTelefone = t;
      colNome = celulas.findIndex((c) => CABECALHOS_NOME.includes(c));
      linhaDoCabecalho = i;
      break;
    }
  }

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
        convidados: [],
        recusadas: [{ linha: 1, motivo: "Nenhuma coluna de telefone encontrada. Use um cabeçalho chamado 'telefone' ou 'whatsapp'." }],
      };
    }
    colTelefone = melhor;
    // Nome: a primeira coluna diferente da do telefone com texto não numérico.
    colNome = linhas.length
      ? (linhas[0] ?? []).findIndex((v, i2) => i2 !== melhor && v.trim() !== "" && telefoneLimpo(v).length < 8)
      : -1;
  }

  const convidados: { nome: string | null; telefone: string }[] = [];
  const recusadas: LinhaRecusada[] = [];
  const vistos = new Set<string>();

  linhas.forEach((celulas, i) => {
    if (i === linhaDoCabecalho) return;
    if (celulas.every((c) => c.trim() === "")) return;

    const telefone = telefoneLimpo(celulas[colTelefone] ?? "");
    const nome = colNome >= 0 ? (celulas[colNome] ?? "").trim() || null : null;
    if (telefone.length < 10 || telefone.length > 15) {
      recusadas.push({
        linha: i + 1,
        motivo: `"${(celulas[colTelefone] ?? "").trim() || "(vazio)"}" não parece um telefone com DDD.`,
      });
      return;
    }
    // A mesma pessoa duas vezes na planilha é UM convite — repetir no mesmo
    // arquivo é quase sempre linha duplicada do export.
    if (vistos.has(telefone)) return;
    vistos.add(telefone);
    convidados.push({ nome, telefone });
  });

  return { convidados, recusadas };
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

/** Lê .xlsx ou .csv e devolve a lista de convidados e as linhas recusadas. */
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
