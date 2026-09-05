import { db } from "../supabase.js";
import { normalizar } from "./casarInsumo.js";
import { casarVenda, entraSozinho, type ApelidoDeVenda } from "./casarVenda.js";
import { impressaoDoArquivo, lerVendas, type LinhaDeVenda } from "./lerVendas.js";
import { ErroDoEstoque, traduzir } from "./estoque.js";

/**
 * Importação de vendas, do lado do servidor.
 *
 * O caminho é sempre o mesmo: arquivo → leitura → casamento → REVISÃO
 * humana → baixa. A revisão no meio não é burocracia; é o que separa "o
 * estoque baixou errado e ninguém sabe" de "a pessoa viu e concordou".
 *
 * Quem mexe em saldo é a função `cmv_baixar_vendas` no banco, nunca este
 * arquivo — a mesma regra do resto do módulo.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const cliente = () => db() as any;

export interface ItemDeVenda {
  id: string;
  linha_numero: number | null;
  produto_externo: string;
  codigo_externo: string | null;
  data_venda: string;
  quantidade: number;
  valor_total: number | null;
  ficha_id: string | null;
  insumo_id: string | null;
  confianca: number;
  como: string | null;
  status: string;
  alvo_nome?: string | null;
  impedimento?: string | null;
}

/**
 * Lê o arquivo, casa cada linha e guarda tudo para revisão.
 *
 * Não baixa nada. A importação nasce em 'revisao' de propósito: baixar na
 * hora do upload tiraria da pessoa a única chance de ver o que a IA
 * entendeu, e o erro só apareceria na contagem do mês seguinte.
 */
export async function importarVendas(params: {
  venueId: string;
  arquivo: Buffer;
  mediaType: string;
  arquivoNome: string;
  dataPadrao: string;
  criadoPor?: string | null;
}): Promise<{ importacaoId: string; total: number; casados: number; avisos: string[] }> {
  const hash = impressaoDoArquivo(params.arquivo);

  // A trava contra a baixa em dobro, conferida ANTES de gastar uma chamada de
  // IA: o mesmo relatório enviado de novo é reconhecido na porta.
  const jaExiste = await cliente()
    .from("venda_importacoes")
    .select("id, status, criado_em, arquivo_nome")
    .eq("venue_id", params.venueId)
    .eq("arquivo_hash", hash)
    .maybeSingle();
  if (jaExiste.error) throw traduzir(jaExiste.error);
  if (jaExiste.data) {
    const quando = String(jaExiste.data.criado_em).slice(0, 10).split("-").reverse().join("/");
    throw new ErroDoEstoque(
      409,
      jaExiste.data.status === "baixada"
        ? `Este mesmo relatório já foi importado e baixado em ${quando}. Importar de novo tiraria a mercadoria do estoque duas vezes.`
        : `Este mesmo relatório já foi enviado em ${quando} e está esperando revisão.`,
    );
  }

  const lido = await lerVendas({
    arquivo: params.arquivo,
    mediaType: params.mediaType,
    dataPadrao: params.dataPadrao,
  });

  const criada = await cliente()
    .from("venda_importacoes")
    .insert({
      venue_id: params.venueId,
      arquivo_nome: params.arquivoNome,
      arquivo_hash: hash,
      periodo_inicio: lido.periodoInicio,
      periodo_fim: lido.periodoFim,
      origem: params.mediaType.startsWith("image/") ? "foto" : "arquivo",
      extracao_ia: { avisos: lido.avisos, impressao: lido.impressaoDigital, linhas: lido.linhas.length },
      criado_por: params.criadoPor ?? null,
    })
    .select("id")
    .single();
  if (criada.error) throw traduzir(criada.error);
  const importacaoId = criada.data.id as string;

  const { fichas, insumos, apelidos } = await vocabulario(params.venueId);

  let casados = 0;
  const linhas = lido.linhas.map((linha: LinhaDeVenda, i: number) => {
    const c = casarVenda(linha.produto, linha.codigo, fichas, insumos, apelidos);
    const automatico = entraSozinho(c);
    if (automatico) casados += 1;
    return {
      importacao_id: importacaoId,
      venue_id: params.venueId,
      linha_numero: i + 1,
      produto_externo: linha.produto,
      produto_normalizado: normalizar(linha.produto),
      codigo_externo: linha.codigo,
      data_venda: linha.data,
      quantidade: linha.quantidade,
      valor_total: linha.valorTotal,
      // Sugestão fica gravada mesmo sem virar 'mapeado': a tela mostra o
      // palpite para a pessoa aceitar com um toque, em vez de procurar do
      // zero.
      ficha_id: c.fichaId,
      insumo_id: c.insumoId,
      confianca: c.confianca,
      como: c.como,
      // Apelido ensinado como "não baixa estoque" já entra ignorado — a
      // pessoa não precisa ignorar o chopp do patrocinador toda semana.
      status: c.ignorar ? "ignorado" : automatico ? "mapeado" : "pendente",
    };
  });

  if (linhas.length > 0) {
    const { error } = await cliente().from("venda_itens").insert(linhas);
    if (error) throw traduzir(error);
  }

  return { importacaoId, total: linhas.length, casados, avisos: lido.avisos };
}

/** Fichas, insumos e apelidos da casa — o vocabulário do casamento. */
async function vocabulario(venueId: string) {
  const [f, i, a] = await Promise.all([
    cliente()
      .from("fichas_tecnicas")
      .select("id, nome, confirmada_em")
      .eq("venue_id", venueId)
      .eq("ativa", true),
    cliente().from("insumos").select("id, nome, codigo").eq("venue_id", venueId).eq("ativo", true),
    cliente()
      .from("venda_apelidos")
      .select("apelido_normalizado, ficha_id, insumo_id, ignorar")
      .eq("venue_id", venueId),
  ]);
  if (f.error) throw traduzir(f.error);
  if (i.error) throw traduzir(i.error);
  if (a.error) throw traduzir(a.error);

  return {
    fichas: (f.data ?? []).map((x: any) => ({
      id: x.id,
      nome: x.nome,
      confirmada: x.confirmada_em !== null,
    })),
    insumos: (i.data ?? []).map((x: any) => ({ id: x.id, nome: x.nome, codigo: x.codigo })),
    apelidos: (a.data ?? []).map(
      (x: any): ApelidoDeVenda => ({
        apelidoNormalizado: x.apelido_normalizado,
        fichaId: x.ficha_id,
        insumoId: x.insumo_id,
        ignorar: x.ignorar === true,
      }),
    ),
  };
}

export async function listarImportacoes(venueId: string): Promise<unknown[]> {
  const { data, error } = await cliente()
    .from("venda_importacoes")
    .select("id, arquivo_nome, periodo_inicio, periodo_fim, status, origem, criado_em, baixada_em")
    .eq("venue_id", venueId)
    .order("criado_em", { ascending: false })
    .limit(40);
  if (error) throw traduzir(error);
  return data ?? [];
}

/**
 * Uma importação com as linhas e os nomes dos alvos — o que a tela de
 * revisão precisa numa ida só.
 */
export async function obterImportacao(venueId: string, importacaoId: string): Promise<unknown> {
  const cabecalho = await cliente()
    .from("venda_importacoes")
    .select("*")
    .eq("venue_id", venueId)
    .eq("id", importacaoId)
    .maybeSingle();
  if (cabecalho.error) throw traduzir(cabecalho.error);
  if (!cabecalho.data) throw new ErroDoEstoque(404, "Importação não encontrada.");

  const itens = await cliente()
    .from("venda_itens")
    .select("*, fichas_tecnicas(nome, confirmada_em), insumos(nome, unidade)")
    .eq("importacao_id", importacaoId)
    .order("linha_numero");
  if (itens.error) throw traduzir(itens.error);

  const linhas = (itens.data ?? []).map((it: any) => ({
    ...it,
    alvo_nome: it.fichas_tecnicas?.nome ?? it.insumos?.nome ?? null,
    // A ficha existe mas ninguém conferiu: o vínculo está certo, o que falta
    // é a receita valer.
    impedimento:
      it.ficha_id && it.fichas_tecnicas && it.fichas_tecnicas.confirmada_em === null
        ? "ficha_nao_confirmada"
        : null,
  }));

  const mapeados = linhas.filter((l: any) => l.status === "mapeado" || l.status === "baixado");
  const cobertura = linhas.length === 0 ? 0 : Math.round((mapeados.length / linhas.length) * 100);

  return { ...cabecalho.data, itens: linhas, cobertura };
}

/**
 * Corrige o alvo de uma linha — e ENSINA.
 *
 * A correção é o que faz o sistema melhorar: gravar o apelido aqui é a
 * diferença entre uma importação que sempre custa vinte minutos e uma que
 * vira um toque na terceira vez.
 */
export async function corrigirItem(params: {
  venueId: string;
  itemId: string;
  fichaId?: string | null;
  insumoId?: string | null;
  ignorar?: boolean;
  aprender?: boolean;
}): Promise<void> {
  const item = await cliente()
    .from("venda_itens")
    .select("id, produto_externo, produto_normalizado, status, importacao_id")
    .eq("venue_id", params.venueId)
    .eq("id", params.itemId)
    .maybeSingle();
  if (item.error) throw traduzir(item.error);
  if (!item.data) throw new ErroDoEstoque(404, "Linha não encontrada.");
  if (item.data.status === "baixado") {
    throw new ErroDoEstoque(409, "Esta linha já baixou o estoque — corrigir agora não desfaz o movimento.");
  }

  if (params.ignorar) {
    const { error } = await cliente()
      .from("venda_itens")
      .update({ status: "ignorado", ficha_id: null, insumo_id: null })
      .eq("id", params.itemId);
    if (error) throw traduzir(error);

    // Ignorar também se aprende: o item que não baixa hoje não baixa na
    // semana que vem. E as outras linhas iguais deste relatório vão junto.
    if (params.aprender !== false) {
      await aprenderApelidoDeVenda({
        venueId: params.venueId,
        apelido: item.data.produto_externo,
        fichaId: null,
        insumoId: null,
        ignorar: true,
      });
      const { error: erroLote } = await cliente()
        .from("venda_itens")
        .update({ status: "ignorado", ficha_id: null, insumo_id: null, como: "apelido", confianca: 1 })
        .eq("importacao_id", item.data.importacao_id)
        .eq("produto_normalizado", item.data.produto_normalizado)
        .eq("status", "pendente");
      if (erroLote) throw traduzir(erroLote);
    }
    return;
  }

  const temFicha = !!params.fichaId;
  const temInsumo = !!params.insumoId;
  if (temFicha === temInsumo) {
    throw new ErroDoEstoque(400, "Escolha uma ficha OU um insumo para esta linha.");
  }

  // Ficha não conferida não baixa — o banco recusaria depois, e recusar aqui
  // diz o porquê enquanto a pessoa ainda está olhando a linha.
  if (temFicha) {
    const ficha = await cliente()
      .from("fichas_tecnicas")
      .select("confirmada_em")
      .eq("venue_id", params.venueId)
      .eq("id", params.fichaId)
      .maybeSingle();
    if (ficha.error) throw traduzir(ficha.error);
    if (!ficha.data) throw new ErroDoEstoque(404, "Ficha não encontrada.");
    if (ficha.data.confirmada_em === null) {
      throw new ErroDoEstoque(
        400,
        "Essa ficha ainda não foi conferida — sem isso ela não baixa estoque. Confira a receita em Fichas técnicas e volte aqui.",
      );
    }
  }

  const { error } = await cliente()
    .from("venda_itens")
    .update({
      ficha_id: params.fichaId ?? null,
      insumo_id: params.insumoId ?? null,
      status: "mapeado",
      como: "humano",
      confianca: 1,
    })
    .eq("id", params.itemId);
  if (error) throw traduzir(error);

  if (params.aprender !== false) {
    await aprenderApelidoDeVenda({
      venueId: params.venueId,
      apelido: item.data.produto_externo,
      fichaId: params.fichaId ?? null,
      insumoId: params.insumoId ?? null,
    });
    // O mesmo produto costuma aparecer em várias linhas do mesmo relatório
    // (dias diferentes). Ensinar uma vez resolve todas — senão a pessoa
    // corrige "Isca de tilápia" sete vezes seguidas e desiste.
    await aplicarApelidoNaImportacao({
      venueId: params.venueId,
      importacaoId: item.data.importacao_id,
      produtoNormalizado: item.data.produto_normalizado,
      fichaId: params.fichaId ?? null,
      insumoId: params.insumoId ?? null,
    });
  }
}

export async function aprenderApelidoDeVenda(params: {
  venueId: string;
  apelido: string;
  fichaId: string | null;
  insumoId: string | null;
  /** "Não baixa estoque": sem ficha, sem insumo, e o item nunca mais fica pendente. */
  ignorar?: boolean;
}): Promise<void> {
  const alvo = normalizar(params.apelido);
  if (!alvo) return;
  const ignorar = params.ignorar === true;

  const existente = await cliente()
    .from("venda_apelidos")
    .select("id, usos")
    .eq("venue_id", params.venueId)
    .eq("apelido_normalizado", alvo)
    .maybeSingle();
  if (existente.error) throw traduzir(existente.error);

  if (existente.data) {
    // Reaponta: a casa mudou o cardápio e o mesmo nome agora é outra coisa.
    const { error } = await cliente()
      .from("venda_apelidos")
      .update(semColunaSeFaltar({
        ficha_id: ignorar ? null : params.fichaId,
        insumo_id: ignorar ? null : params.insumoId,
        ignorar,
        usos: (existente.data.usos ?? 1) + 1,
        ultimo_uso: new Date().toISOString(),
      }, ignorar))
      .eq("id", existente.data.id);
    if (error) throw traduzir(error);
    return;
  }

  const { error } = await cliente().from("venda_apelidos").insert(semColunaSeFaltar({
    venue_id: params.venueId,
    apelido: params.apelido.trim(),
    ficha_id: ignorar ? null : params.fichaId,
    insumo_id: ignorar ? null : params.insumoId,
    ignorar,
  }, ignorar));
  if (error) throw traduzir(error);
}

/**
 * O CÓDIGO SOBE ANTES DO SQL RODAR: enquanto `venda_apelidos.ignorar` não
 * existe, gravar a coluna quebraria TODO aprendizado de apelido — inclusive
 * o de ficha, que sempre funcionou. Sem a marca ligada, a coluna nem vai.
 * Com a marca ligada e a coluna ausente, o insert falha (a constraint
 * antiga exige um alvo) e a mensagem diz para rodar a migração.
 */
function semColunaSeFaltar<T extends { ignorar: boolean }>(linha: T, precisa: boolean): Omit<T, "ignorar"> | T {
  if (precisa) return linha;
  const resto: Record<string, unknown> = { ...linha };
  delete resto.ignorar;
  return resto as Omit<T, "ignorar">;
}

/** Aplica o aprendizado às outras linhas iguais da mesma importação. */
async function aplicarApelidoNaImportacao(params: {
  venueId: string;
  importacaoId: string;
  produtoNormalizado: string;
  fichaId: string | null;
  insumoId: string | null;
}): Promise<void> {
  const { error } = await cliente()
    .from("venda_itens")
    .update({
      ficha_id: params.fichaId,
      insumo_id: params.insumoId,
      status: "mapeado",
      como: "apelido",
      confianca: 1,
    })
    .eq("importacao_id", params.importacaoId)
    .eq("produto_normalizado", params.produtoNormalizado)
    .eq("status", "pendente");
  if (error) throw traduzir(error);
}

/** Baixa o estoque. Só o que está mapeado; o resto fica visível como buraco. */
export async function baixarVendas(params: {
  venueId: string;
  importacaoId: string;
  usuario?: string | null;
}): Promise<{ itens: number; movimentos: number; faturamento_por_dia: Array<{ data: string; valor: number }> }> {
  const dono = await cliente()
    .from("venda_importacoes")
    .select("id")
    .eq("venue_id", params.venueId)
    .eq("id", params.importacaoId)
    .maybeSingle();
  if (dono.error) throw traduzir(dono.error);
  if (!dono.data) throw new ErroDoEstoque(404, "Importação não encontrada.");

  const { data, error } = await cliente().rpc("cmv_baixar_vendas", {
    p_importacao_id: params.importacaoId,
    p_usuario: params.usuario ?? null,
  });
  if (error) throw traduzir(error);

  const linha = Array.isArray(data) ? data[0] : data;

  // O faturamento por dia sai da mesma importação: o relatório do PDV já
  // trouxe o valor de cada linha, e obrigar alguém a digitar de novo o total
  // que acabou de importar é pedir dado dobrado — que diverge e ninguém sabe
  // qual vale. A tela OFERECE lançar; quem confirma é a pessoa, porque o
  // total do PDV pode incluir gorjeta e taxa que o CMV não quer.
  const { data: valores } = await cliente()
    .from("venda_itens")
    .select("data_venda, valor_total")
    .eq("importacao_id", params.importacaoId)
    .not("valor_total", "is", null);

  const porDia = new Map<string, number>();
  for (const v of (valores ?? []) as Array<{ data_venda: string; valor_total: number }>) {
    porDia.set(v.data_venda, (porDia.get(v.data_venda) ?? 0) + Number(v.valor_total));
  }

  return {
    itens: Number(linha?.itens_baixados ?? 0),
    movimentos: Number(linha?.insumos_movidos ?? 0),
    faturamento_por_dia: [...porDia.entries()]
      .map(([data, valor]) => ({ data, valor: Math.round(valor * 100) / 100 }))
      .sort((a, b) => a.data.localeCompare(b.data)),
  };
}

/** Descarta a importação sem baixar — o arquivo errado, o mês errado. */
export async function descartarImportacao(venueId: string, importacaoId: string): Promise<void> {
  const atual = await cliente()
    .from("venda_importacoes")
    .select("status")
    .eq("venue_id", venueId)
    .eq("id", importacaoId)
    .maybeSingle();
  if (atual.error) throw traduzir(atual.error);
  if (!atual.data) throw new ErroDoEstoque(404, "Importação não encontrada.");
  if (atual.data.status === "baixada") {
    throw new ErroDoEstoque(409, "Esta importação já baixou o estoque — descartar não desfaz os movimentos.");
  }

  // Apaga de vez: importação não baixada não deixou rastro no razão, e
  // guardá-la só encheria a lista. O hash sai junto, então o arquivo pode ser
  // reenviado depois de corrigido.
  const { error } = await cliente()
    .from("venda_importacoes")
    .delete()
    .eq("venue_id", venueId)
    .eq("id", importacaoId);
  if (error) throw traduzir(error);
}

/** Teórico × real: o que as fichas dizem contra o que sumiu de verdade. */
export async function teoricoVersusReal(params: {
  venueId: string;
  inicio: string;
  fim: string;
}): Promise<unknown[]> {
  const { data, error } = await cliente().rpc("cmv_teorico_versus_real", {
    p_venue_id: params.venueId,
    p_inicio: params.inicio,
    p_fim: params.fim,
  });
  if (error) throw traduzir(error);
  return data ?? [];
}
