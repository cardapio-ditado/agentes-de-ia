/**
 * Página de vendas: fagulhas, barra do topo e o formulário de contato.
 *
 * Sem framework e sem dependência — é a primeira página que um cliente novo
 * carrega, muitas vezes no 4G do celular dentro do restaurante.
 */

// ---------- Fagulhas do herói ----------
const brasas = document.querySelector(".lp-brasas");
if (brasas && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (let i = 0; i < 26; i += 1) {
    const f = document.createElement("span");
    f.className = "lp-fagulha";
    const tamanho = 2 + Math.random() * 4;
    f.style.width = `${tamanho}px`;
    f.style.height = `${tamanho}px`;
    f.style.left = `${Math.random() * 100}%`;
    f.style.animationDuration = `${5 + Math.random() * 7}s`;
    f.style.animationDelay = `${Math.random() * 9}s`;
    f.style.opacity = String(0.3 + Math.random() * 0.5);
    brasas.append(f);
  }
}

// ---------- Barra do topo ganha fundo ao rolar ----------
const topo = document.getElementById("lp-topo");
if (topo) {
  const marcar = () => topo.setAttribute("data-rolou", window.scrollY > 20 ? "1" : "0");
  marcar();
  addEventListener("scroll", marcar, { passive: true });
}

// ---------- Formulário de contato ----------
//
// Ainda não existe rota para receber lead: guardar contato de gente é
// responsabilidade que pede consentimento e um lugar seguro para o dado. Até
// isso existir, o formulário monta uma mensagem de WhatsApp — o que aliás
// converte melhor, porque a conversa começa no canal em que o dono já vive.
const WHATSAPP_COMERCIAL = "5565981382139";

const form = document.getElementById("lp-form");
form?.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const dados = new FormData(form);
  const nome = String(dados.get("nome") ?? "").trim();
  const restaurante = String(dados.get("restaurante") ?? "").trim();
  const whatsapp = String(dados.get("whatsapp") ?? "").trim();

  const mensagem =
    `Olá! Sou ${nome}, do ${restaurante}.\n` +
    `Quero uma demonstração do Brasa Food.\n` +
    `Meu WhatsApp: ${whatsapp}`;

  const url = `https://wa.me/${WHATSAPP_COMERCIAL}?text=${encodeURIComponent(mensagem)}`;
  window.open(url, "_blank", "noopener");

  form.innerHTML = `
    <div class="lp-form-ok">
      <strong>Abrimos seu WhatsApp 🔥</strong>
      <p>É só enviar a mensagem que já está escrita. Se não abriu,
         chame no <a href="${url}" target="_blank" rel="noopener">wa.me/${WHATSAPP_COMERCIAL}</a>.</p>
    </div>`;
});
