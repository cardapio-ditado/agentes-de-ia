import assert from "node:assert/strict";
import test from "node:test";
import {
  codigoDaReserva,
  escolherReserva,
  interpretarComando,
  mesmoTelefone,
  type ComandoDeReserva,
} from "./comandosDeReserva.js";
import type { Reservation } from "./venues.js";

/* ---------- o que decide e o que não decide ---------- */

test("as palavras que confirmam", () => {
  for (const palavra of ["confirmar", "confirmado", "confirma", "aprovar", "aprovado", "CONFIRMADO"]) {
    assert.equal(interpretarComando(palavra)?.acao, "aprovar", palavra);
  }
});

test("as palavras que recusam", () => {
  for (const palavra of ["recusar", "recusado", "negar", "cancelar", "RECUSAR"]) {
    assert.equal(interpretarComando(palavra)?.acao, "recusar", palavra);
  }
});

test('"ok", "sim" e "blz" NÃO confirmam nada', () => {
  // A decisão mais importante deste arquivo. Um "ok" solto é a coisa mais
  // fácil de digitar por engano no WhatsApp, e aprovar por engano é prometer
  // mesa que a casa pode não ter.
  for (const palavra of ["ok", "sim", "blz", "beleza", "👍", "isso", "certo", "pode"]) {
    assert.equal(interpretarComando(palavra), null, palavra);
  }
});

test("conversa comum continua sendo silêncio", () => {
  for (const texto of ["bom dia", "não abre o link", "quantas pessoas?", ""]) {
    assert.equal(interpretarComando(texto), null, texto);
  }
});

test("acento e caixa não mudam o comando", () => {
  // Quem digita no celular erra acento. "confirmá" é claramente confirmar.
  assert.equal(interpretarComando("confirmá")?.acao, "aprovar");
  assert.equal(interpretarComando("NEGA")?.acao, "recusar");
  assert.equal(interpretarComando("  Confirmar  ")?.acao, "aprovar");
});

/* ---------- o código ---------- */

test("o código vem junto do verbo quando o gestor diz qual", () => {
  const c = interpretarComando("confirmar a7f3");
  assert.equal(c?.acao, "aprovar");
  assert.equal(c?.codigo, "a7f3");
});

test("sem código, o comando vale para a única pendente", () => {
  assert.equal(interpretarComando("confirmar")?.codigo, null);
});

test("o que não é código de 4 dígitos hexadecimais vira motivo", () => {
  // "confirmar amanhã" não tem código: "amanhã" não é hexadecimal.
  const c = interpretarComando("recusar sem mesa disponível");
  assert.equal(c?.codigo, null);
  assert.equal(c?.motivo, "sem mesa disponível");
});

test("o motivo preserva a caixa e o acento — o cliente vai ler", () => {
  const c = interpretarComando("Recusar A7F3 Casa fechada para evento privado");
  assert.equal(c?.codigo, "a7f3");
  assert.equal(c?.motivo, "Casa fechada para evento privado");
});

test("confirmação não carrega motivo para lugar nenhum", () => {
  assert.equal(interpretarComando("confirmar a7f3")?.motivo, null);
});

test("o código sai do id sem os hífens e em maiúscula", () => {
  assert.equal(codigoDaReserva("a7f3b2c1-0000-0000-0000-000000000000"), "A7F3");
});

/* ---------- de quem é o número ---------- */

test("o mesmo número escrito de três jeitos é o mesmo número", () => {
  // O gestor cadastra de um jeito e o WhatsApp entrega de outro. Comparar
  // texto com texto nunca casaria, e o comando dele seria ignorado sem
  // explicação nenhuma.
  const cadastrado = "(65) 99999-8888";
  for (const doWhatsapp of ["5565999998888", "65999998888", "6599998888", "+55 65 99999-8888"]) {
    assert.ok(mesmoTelefone(cadastrado, doWhatsapp), doWhatsapp);
  }
});

test("números diferentes não casam", () => {
  assert.equal(mesmoTelefone("65999998888", "65999997777"), false);
  // Mesmo final, DDD diferente: são linhas de cidades diferentes.
  assert.equal(mesmoTelefone("65999998888", "11999998888"), false);
});

test("vazio nunca casa com nada", () => {
  // O caso perigoso: casa sem gestor cadastrado não pode aceitar comando de
  // um remetente com o campo também vazio.
  assert.equal(mesmoTelefone(null, null), false);
  assert.equal(mesmoTelefone("", "65999998888"), false);
  assert.equal(mesmoTelefone("65999998888", ""), false);
  assert.equal(mesmoTelefone(undefined, undefined), false);
});

test("número curto demais não é telefone", () => {
  assert.equal(mesmoTelefone("998888", "998888"), false);
});

/* ---------- qual reserva o comando decide ---------- */

const pendente = (id: string, nome: string): Reservation =>
  ({ id, customer_name: nome, party_size: 2, status: "pending" }) as Reservation;

const MARIANA = pendente("a7f3b2c1-0000-0000-0000-000000000000", "Mariana Prado");
const RODRIGO = pendente("b104ffff-0000-0000-0000-000000000000", "Rodrigo Alencar");

const comando = (over: Partial<ComandoDeReserva> = {}): ComandoDeReserva => ({
  acao: "aprovar",
  codigo: null,
  motivo: null,
  ...over,
});

test("uma pendente só: 'confirmar' sem código já é sem ambiguidade", () => {
  const escolha = escolherReserva(comando(), [MARIANA]);
  assert.equal(escolha.tipo, "unica");
  assert.equal(escolha.tipo === "unica" && escolha.reserva.id, MARIANA.id);
});

test("várias pendentes sem código: PERGUNTA, não chuta", () => {
  // O erro que não aparece: escolher "a mais próxima" aprova a mesa errada,
  // avisa o cliente errado, e ninguém descobre até alguém chegar na porta.
  const escolha = escolherReserva(comando(), [MARIANA, RODRIGO]);
  assert.equal(escolha.tipo, "ambigua");
  assert.equal(escolha.tipo === "ambigua" && escolha.candidatas.length, 2);
});

test("o código escolhe a reserva mesmo com outras esperando", () => {
  const escolha = escolherReserva(comando({ codigo: "b104" }), [MARIANA, RODRIGO]);
  assert.equal(escolha.tipo, "unica");
  assert.equal(escolha.tipo === "unica" && escolha.reserva.id, RODRIGO.id);
});

test("código que não é de nenhuma pendente não decide nada", () => {
  // Digitou errado. Aprovar "a que sobrou" seria decidir por ele.
  const escolha = escolherReserva(comando({ codigo: "9999" }), [MARIANA, RODRIGO]);
  assert.equal(escolha.tipo, "nao_achou");
});

test("código errado com uma pendente só também não decide", () => {
  assert.equal(escolherReserva(comando({ codigo: "9999" }), [MARIANA]).tipo, "nao_achou");
});

test("dois ids com o mesmo prefixo continuam sendo pergunta", () => {
  const gemea = pendente("a7f3ffff-0000-0000-0000-000000000000", "Outro cliente");
  const escolha = escolherReserva(comando({ codigo: "a7f3" }), [MARIANA, gemea]);
  assert.equal(escolha.tipo, "ambigua");
});

test("recusar segue exatamente a mesma regra de escolha", () => {
  const escolha = escolherReserva(comando({ acao: "recusar" }), [MARIANA, RODRIGO]);
  assert.equal(escolha.tipo, "ambigua");
});
